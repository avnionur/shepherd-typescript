import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
    backupTraceStore,
    type Cut,
    createTraceTelemetryExporter,
    SQLiteTraceStore,
    type TelemetryBatch,
    type TraceTelemetryExporter,
    verifyTraceStoreBackup,
} from "../../src/index.ts";
import { kernelProtocolConfig } from "../../src/protocol/config.ts";
import { createPrng, deriveSeed, type Prng } from "../support/prng.ts";
import { addCounts, emptyCounts, type RecoveryCounts, recoverAfterKill } from "./recovery.ts";
import {
    appendRequestFor,
    blobContentFor,
    blobIdOf,
    type FaultOperation,
    faultSettings,
    inRange,
    inspectHealth,
    ownerFor,
    runFaultProcess,
    soakSettings,
} from "./workload.ts";

/** Bounds of one soak run: stop at whichever limit is reached first. */
export type SoakOptions = {
    /** Working directory; the soak creates its store, backups, and imports inside it. */
    readonly directory: string;
    /** Wall-clock budget in seconds; omitted for an operation-bounded run. */
    readonly durationSeconds?: number;
    /** Receives one progress line per invariant check. */
    readonly log?: (line: string) => void;
    /** Operation budget; omitted for a duration-bounded run. */
    readonly operations?: number;
    /** Run seed; defaults to the configured soak seed. */
    readonly seed?: number;
};

/** Result of a soak run that held every invariant. */
export type SoakReport = {
    readonly appendIntents: number;
    readonly backupsVerified: number;
    readonly blobs: number;
    readonly cuts: number;
    readonly databaseBytes: number;
    readonly durationSeconds: number;
    readonly invariantChecks: number;
    readonly killCycles: number;
    readonly killOutcomes: RecoveryCounts;
    readonly maintenance: Readonly<Record<string, number>>;
    readonly node: string;
    readonly operations: number;
    readonly platform: string;
    readonly recordOccurrences: number;
    readonly seed: number;
    readonly telemetryBatches: number;
    readonly telemetryRecords: number;
};

const SUBSCRIPTION_ID = "soak:telemetry";

/**
 * Runs the mixed soak workload with periodic invariants. Throws on the first violated invariant:
 * a failed integrity, blob, or quick check, a committed intent, blob, or cut that is no longer
 * readable, maintenance that changes the export, a backup that does not verify, telemetry whose
 * acknowledged cursor does not reach every committed occurrence, or an unclassifiable state after
 * a kill.
 */
export async function runSoak(options: SoakOptions): Promise<SoakReport> {
    const seed = options.seed ?? soakSettings.seed;
    if (options.durationSeconds === undefined && options.operations === undefined) {
        throw new TypeError("a soak needs a duration or an operation budget");
    }
    const started = performance.now();
    const deadline =
        options.durationSeconds === undefined
            ? Number.POSITIVE_INFINITY
            : started + options.durationSeconds * 1000;
    const operationBudget = options.operations ?? Number.POSITIVE_INFINITY;
    const random = createPrng(deriveSeed(seed, "soak", 0));
    const databasePath = path.join(options.directory, "trace.sqlite");
    const backupRoot = path.join(options.directory, "backups");
    const importRoot = path.join(options.directory, "imports");
    const childTemporary = path.join(options.directory, "tmp");
    for (const directory of [backupRoot, importRoot, childTemporary]) mkdirSync(directory);
    const owners = Array.from({ length: faultSettings.workload.owners }, (_, index) =>
        ownerFor(index),
    );

    // Committed state the soak must be able to read back at every invariant check.
    const committedIntents: string[] = [];
    const blobIds: string[] = [];
    const cuts = new Map<string, Cut>();
    const lastRecordByOwner = new Map<string, string>();
    const maintenance: Record<string, number> = {};
    const killOutcomes = emptyCounts();
    let telemetryBatches = 0;
    let telemetryRecords = 0;
    let backupsVerified = 0;
    let invariantChecks = 0;
    let killCycles = 0;
    let operations = 0;
    let appendIndex = 0;
    let blobIndex = 0;
    let cutIndex = 0;

    let store = new SQLiteTraceStore(databasePath);
    const archivePath = path.join(options.directory, "archive.json");
    writeFileSync(archivePath, store.exportTrace());
    const openExporter = (): TraceTelemetryExporter => {
        let now = 1_700_000_000_000_000_000n;
        return createTraceTelemetryExporter({
            clock: () => {
                now += 1_000_000n;
                return now;
            },
            sink: {
                write: (batch: TelemetryBatch) => {
                    telemetryBatches += 1;
                    telemetryRecords +=
                        batch.logs.resourceLogs[0]?.scopeLogs[0]?.logRecords.length ?? 0;
                },
            },
            store,
            subscription: { owners, subscriptionId: SUBSCRIPTION_ID },
        });
    };
    let exporter = openExporter();

    const drainTelemetry = async (): Promise<void> => {
        for (;;) {
            const receipt = await exporter.exportPending();
            if (receipt.record_count === 0) break;
        }
        const next = store.readOwnerNextOrdinals(owners);
        for (const position of exporter.acknowledgedCursor.positions) {
            assert.equal(
                position.next_ordinal,
                next.get(position.owner_id) ?? 0,
                `telemetry cursor behind on ${position.owner_id}`,
            );
        }
    };

    const exportDigest = (): string =>
        createHash("sha256").update(store.exportTrace()).digest("hex");

    const checkInvariants = async (): Promise<void> => {
        invariantChecks += 1;
        assert.deepEqual(inspectHealth(store).issues, [], "store health");
        const samples = sample(random, committedIntents, 32);
        for (const intent of samples) {
            assert.equal(store.diagnoseAppend(intent).status, "committed", intent);
        }
        for (const blobId of sample(random, blobIds, 8)) {
            const bytes = store.readBlob(blobId);
            assert.ok(bytes !== undefined && blobIdOf(bytes) === blobId, blobId);
        }
        for (const cutId of sample(random, [...cuts.keys()], 8)) {
            assert.deepEqual(store.readCut(cutId), cuts.get(cutId));
        }
        await drainTelemetry();
        options.log?.(
            `check ${invariantChecks}: ${operations} operations, ${killCycles} kill cycles, ${committedIntents.length} intents, ${Math.round((performance.now() - started) / 1000)} s`,
        );
    };

    const killCycle = async (): Promise<void> => {
        killCycles += 1;
        exporter.close();
        store.close();
        const operation = random.pick<FaultOperation>(faultSettings.processKill.operations);
        const args = {
            archivePath,
            backupRoot,
            databasePath,
            importRoot,
            label: `soak-kill-${killCycles}`,
            operation,
            seed,
        };
        const result = await runFaultProcess(args, {
            killAfterReady: inRange(random.next, faultSettings.processKill.killDelayMilliseconds),
            temporaryDirectory: childTemporary,
        });
        assert.equal(result.signal, "SIGKILL", result.stderr);
        addCounts(killOutcomes, await recoverAfterKill(args, result.events));
        // Bound disk use: the kill cycle's backups and import targets are verified above, and a
        // killed import's staging directory is left beside its target (F-019).
        for (const root of [backupRoot, importRoot, childTemporary]) {
            for (const name of readdirSync(root)) {
                if (
                    name.startsWith(args.label) ||
                    name.startsWith(kernelProtocolConfig.interchange.staging.directoryPrefix) ||
                    root === childTemporary
                ) {
                    rmSync(path.join(root, name), { force: true, recursive: true });
                }
            }
        }
        store = new SQLiteTraceStore(databasePath);
        exporter = openExporter();
        await drainTelemetry();
    };

    const weights = soakSettings.weights;
    const totalWeight = weights.append + weights.blob + weights.cut;
    try {
        while (operations < operationBudget && performance.now() < deadline) {
            operations += 1;
            const roll = random.int(totalWeight);
            if (roll < weights.append || lastRecordByOwner.size === 0) {
                const request = appendRequestFor(seed, "soak", appendIndex);
                appendIndex += 1;
                const receipt = store.append(request);
                committedIntents.push(request.append_intent_id);
                lastRecordByOwner.set(
                    request.batch.groups[0]?.owner_id as string,
                    receipt.record_ids.at(-1) as string,
                );
            } else if (roll < weights.append + weights.blob) {
                const content = blobContentFor(seed, "soak", blobIndex);
                blobIndex += 1;
                blobIds.push(store.putBlob(content).blob_id);
            } else {
                const [owner, recordId] = random.pick([...lastRecordByOwner.entries()]);
                const cut = store.publishCut({
                    cut_id: `cut:soak:${cutIndex}`,
                    target_owner_id: owner,
                    through_record_id: recordId,
                });
                cutIndex += 1;
                cuts.set(cut.cut_id, cut);
                // Publishing appends a record to the owner; later cuts may address it.
                lastRecordByOwner.set(owner, cut.created_by_record_id);
            }
            const every = soakSettings.every;
            if (operations % every.telemetry === 0) await exporter.exportPending();
            if (operations % every.maintenance === 0) {
                const mode = random.pick(soakSettings.maintenanceModes);
                const before = exportDigest();
                store.maintain({ mode });
                assert.equal(exportDigest(), before, `maintain ${mode} changed the export`);
                maintenance[mode] = (maintenance[mode] ?? 0) + 1;
            }
            if (operations % every.backup === 0) {
                const destination = path.join(backupRoot, `soak-${operations}`);
                const manifest = await backupTraceStore(store, { destination });
                const verified = await verifyTraceStoreBackup(destination, {
                    expectedManifestId: manifest.manifest_id,
                });
                assert.equal(verified.manifest.export_digest, manifest.export_digest);
                backupsVerified += 1;
                const retained = readdirSync(backupRoot)
                    .filter((name) => name.startsWith("soak-"))
                    .sort((left, right) => Number(left.slice(5)) - Number(right.slice(5)));
                for (const name of retained.slice(0, -soakSettings.retainedBackups)) {
                    rmSync(path.join(backupRoot, name), { force: true, recursive: true });
                }
            }
            if (operations % every.invariants === 0) await checkInvariants();
            if (operations % every.kill === 0) await killCycle();
        }
        await checkInvariants();
        const recordOccurrences = [...store.readOwnerNextOrdinals(owners).values()].reduce(
            (total, next) => total + next,
            0,
        );
        return Object.freeze({
            appendIntents: committedIntents.length,
            backupsVerified,
            blobs: blobIds.length,
            cuts: cuts.size,
            databaseBytes: statSync(databasePath).size,
            durationSeconds: Math.round((performance.now() - started) / 100) / 10,
            invariantChecks,
            killCycles,
            killOutcomes,
            maintenance,
            node: process.version,
            operations,
            platform: `${process.platform}-${process.arch}`,
            recordOccurrences,
            seed,
            telemetryBatches,
            telemetryRecords,
        });
    } finally {
        exporter.close();
        store.close();
    }
}

function sample<T>(random: Prng, values: readonly T[], count: number): readonly T[] {
    if (values.length <= count) return values;
    // The newest values plus a seeded selection of older ones.
    const newest = values.slice(-Math.ceil(count / 2));
    const older = Array.from(
        { length: Math.floor(count / 2) },
        () => values[random.int(values.length - newest.length)] as T,
    );
    return [...newest, ...older];
}
