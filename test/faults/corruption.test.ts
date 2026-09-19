import assert from "node:assert/strict";
import {
    cpSync,
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    renameSync,
    rmSync,
    statSync,
    truncateSync,
    writeFileSync,
} from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import {
    AppendIntentConflictError,
    backupTraceStore,
    openTraceSubscription,
    restoreTraceStoreBackup,
    SQLiteTraceStore,
    TraceStoreBackupError,
    TraceStoreError,
    verifyTraceStoreBackup,
} from "../../src/index.ts";
import { kernelProtocolConfig } from "../../src/protocol/config.ts";
import { createPrng, deriveSeed, type Prng } from "../support/prng.ts";
import {
    appendRequestFor,
    blobContentFor,
    blobIdOf,
    cutIdFor,
    faultSeeds,
    faultSettings,
    inRange,
    inspectHealth,
} from "./workload.ts";

const settings = faultSettings.corruption;
const DATABASE = "trace.sqlite";
const BLOB_SUFFIX = kernelProtocolConfig.store.blobs.directorySuffix;

/**
 * Classification of one corruption case:
 * - `refused`: the store (or backup) does not open or verify, with a typed error;
 * - `detected`: it opens, and `verifyIntegrity`, `verifyBlobs`, `maintain` inspect
 *   `quick_check`, or a read reports the defect;
 * - `recovered`: every check passes and the export and read surface equal the golden copy;
 * - `rolled-back`: every check passes and the export equals the store at an earlier commit
 *   (only possible when the write-ahead log loses frames);
 * - `residual`: every check passes and the export differs from the golden copy only in an append
 *   intent's well-formed batch digest (F-018).
 */
type Outcome = "detected" | "recovered" | "refused" | "residual" | "rolled-back";

function differsOnlyInBatchDigests(expected: string, actual: string): boolean {
    const strip = (text: string): string => {
        const archive = JSON.parse(text) as { append_intents: { batch_digest: string }[] };
        for (const intent of archive.append_intents) intent.batch_digest = "";
        return JSON.stringify(archive);
    };
    return strip(expected) === strip(actual);
}

type Classified = { readonly detail: string; readonly outcome: Outcome };

type Golden = {
    readonly blobIds: readonly string[];
    readonly commitExports: readonly string[];
    readonly cutIds: readonly string[];
    readonly export: string;
    readonly owners: readonly string[];
    readonly surface: string;
};

function errorName(error: unknown): string {
    if (!(error instanceof Error)) return `non-Error ${typeof error}`;
    const coded = error as Error & { code?: unknown; errcode?: unknown; reason?: unknown };
    const suffix = [coded.code, coded.errcode, coded.reason]
        .filter((part) => part !== undefined)
        .join("/");
    return suffix.length === 0 ? error.constructor.name : `${error.constructor.name}(${suffix})`;
}

function readSurface(store: SQLiteTraceStore, golden: Omit<Golden, "surface">): string {
    return JSON.stringify({
        blobs: golden.blobIds.map((blobId) => {
            const bytes = store.readBlob(blobId);
            return bytes === undefined ? null : blobIdOf(bytes);
        }),
        cuts: golden.cutIds.map((cutId) => store.readCut(cutId)),
        owners: golden.owners.map((owner) => store.readOwner(owner)),
        records: golden.owners.flatMap((owner) =>
            store.readOwner(owner).map((record) => store.readRecord(record.envelope.record_id)),
        ),
    });
}

/** Opens a (possibly corrupt) store copy and classifies it; throws on a silent difference. */
function classifyStore(databasePath: string, golden: Golden, allowRollback: boolean): Classified {
    let store: SQLiteTraceStore;
    try {
        store = new SQLiteTraceStore(databasePath);
    } catch (error) {
        assert.ok(error instanceof Error, `open threw ${String(error)}`);
        return { detail: `open: ${errorName(error)}`, outcome: "refused" };
    }
    try {
        let issues: readonly string[];
        try {
            issues = inspectHealth(store).issues;
        } catch (error) {
            assert.ok(error instanceof Error, `checks threw ${String(error)}`);
            return { detail: `checks threw ${errorName(error)}`, outcome: "detected" };
        }
        if (issues.length > 0) {
            return { detail: issues.slice(0, 3).join(", "), outcome: "detected" };
        }
        let exported: string;
        let surface: string;
        try {
            exported = store.exportTrace();
            surface = readSurface(store, golden);
        } catch (error) {
            assert.ok(error instanceof Error, `read threw ${String(error)}`);
            return { detail: `read: ${errorName(error)}`, outcome: "detected" };
        }
        if (exported === golden.export && surface === golden.surface) {
            const orphans = store.collectBlobOrphans();
            const residue = orphans.orphan_blob_ids.length + orphans.orphan_temporary_file_count;
            return {
                detail: residue === 0 ? "identical" : `identical; ${residue} orphan(s) inspected`,
                outcome: "recovered",
            };
        }
        if (differsOnlyInBatchDigests(golden.export, exported)) {
            // Accepted residual F-018: a batch digest altered to another well-formed digest is not
            // derivable from retained records; a retry of that intent fails closed.
            return { detail: "only an append intent batch digest differs", outcome: "residual" };
        }
        const commit = golden.commitExports.indexOf(exported);
        assert.ok(
            allowRollback && commit >= 0,
            `silent difference: every check passed but the export differs from the golden copy (${databasePath})`,
        );
        return {
            detail: `export equals commit ${commit} of ${golden.commitExports.length - 1}`,
            outcome: "rolled-back",
        };
    } finally {
        store.close();
    }
}

/** Builds the golden store: records on several owners, blobs, cuts, and a durable cursor. */
async function buildGolden(directory: string, seed: number): Promise<Golden> {
    const databasePath = path.join(directory, DATABASE);
    const store = new SQLiteTraceStore(databasePath);
    try {
        const owners = new Set<string>();
        const cutIds: string[] = [];
        for (let index = 0; index < 24; index += 1) {
            const request = appendRequestFor(seed, "golden", index);
            const receipt = store.append(request);
            const owner = request.batch.groups[0]?.owner_id as string;
            owners.add(owner);
            if (index % 8 === 7) {
                const cutId = cutIdFor("golden", index);
                store.publishCut({
                    cut_id: cutId,
                    target_owner_id: owner,
                    through_record_id: receipt.record_ids.at(-1) as string,
                });
                cutIds.push(cutId);
            }
        }
        const blobIds = Array.from(
            { length: 6 },
            (_, index) => store.putBlob(blobContentFor(seed, "golden", index)).blob_id,
        );
        const [firstOwner] = owners;
        const subscription = openTraceSubscription(store, {
            owners: [firstOwner as string],
            subscriptionId: "fault:golden",
        });
        const delivery = await subscription.next();
        subscription.acknowledge(
            delivery?.cursor as Parameters<typeof subscription.acknowledge>[0],
        );
        subscription.close();
        store.maintain({ mode: "checkpoint" });
        const base = {
            blobIds,
            commitExports: [],
            cutIds,
            export: store.exportTrace(),
            owners: [...owners].sort(),
        };
        return { ...base, surface: readSurface(store, base) };
    } finally {
        store.close();
    }
}

function copyStore(from: string, to: string): string {
    mkdirSync(to);
    for (const name of readdirSync(from)) {
        if (name.startsWith(DATABASE)) {
            cpSync(path.join(from, name), path.join(to, name), { recursive: true });
        }
    }
    return path.join(to, DATABASE);
}

function flipBytes(filePath: string, random: Prng, offset: number, count: number): void {
    const bytes = readFileSync(filePath);
    for (let index = 0; index < count && offset + index < bytes.length; index += 1) {
        bytes[offset + index] = (bytes[offset + index] as number) ^ (1 + random.int(255));
    }
    writeFileSync(filePath, bytes);
}

function blobPath(databasePath: string, blobId: string): string {
    const digest = blobId.slice(blobId.indexOf(":") + 1);
    return path.join(`${databasePath}${BLOB_SUFFIX}`, digest.slice(0, 2), digest);
}

type Row = { readonly caseName: string } & Classified;

function tally(rows: readonly Row[]): Record<Outcome, number> {
    const counts: Record<Outcome, number> = {
        detected: 0,
        recovered: 0,
        refused: 0,
        residual: 0,
        "rolled-back": 0,
    };
    for (const row of rows) counts[row.outcome] += 1;
    return counts;
}

for (const seed of faultSeeds()) {
    test(`seeded database page flips fail typed or are detected, never silently (seed ${seed})`, {
        timeout: faultSettings.testTimeoutMilliseconds,
    }, async (context) => {
        const directory = await mkdtemp(path.join(tmpdir(), "shepherd-corruption-pages-"));
        context.after(() => rm(directory, { force: true, recursive: true }));
        const goldenDirectory = path.join(directory, "golden");
        mkdirSync(goldenDirectory);
        const golden = await buildGolden(goldenDirectory, seed);
        const databaseBytes = readFileSync(path.join(goldenDirectory, DATABASE));
        const pageSize =
            databaseBytes.readUInt16BE(16) === 1 ? 65536 : databaseBytes.readUInt16BE(16);
        const pages = databaseBytes.length / pageSize;
        const random = createPrng(deriveSeed(seed, "corruption:pages", 0));
        const rows: Row[] = [];
        for (let index = 0; index < settings.pageFlipCases; index += 1) {
            const databasePath = copyStore(goldenDirectory, path.join(directory, `case-${index}`));
            const page = random.int(pages);
            const offset = page * pageSize + random.int(pageSize);
            const count = inRange(random.next, settings.bytesPerFlip);
            flipBytes(databasePath, random, offset, count);
            rows.push({
                caseName: `page ${page + 1}/${pages} offset ${offset} x${count}`,
                ...classifyStore(databasePath, golden, false),
            });
            rmSync(path.dirname(databasePath), { force: true, recursive: true });
        }
        for (const row of rows)
            context.diagnostic(`${row.caseName}: ${row.outcome} (${row.detail})`);
        context.diagnostic(`page flips: ${JSON.stringify(tally(rows))}`);
        assert.equal(tally(rows)["rolled-back"], 0);
    });

    test(`truncated, deleted, or altered WAL and SHM files are refused, detected, recovered, or rolled back to a commit (seed ${seed})`, {
        timeout: faultSettings.testTimeoutMilliseconds,
    }, async (context) => {
        const directory = await mkdtemp(path.join(tmpdir(), "shepherd-corruption-wal-"));
        context.after(() => rm(directory, { force: true, recursive: true }));
        const goldenDirectory = path.join(directory, "golden");
        mkdirSync(goldenDirectory);
        const base = await buildGolden(goldenDirectory, seed);
        // Commit more appends into the write-ahead log and copy the files while the store is
        // open: the copy is the crash image of a store whose log holds committed frames.
        const imageDirectory = path.join(directory, "image");
        mkdirSync(imageDirectory);
        const liveDirectory = path.join(directory, "live");
        const livePath = copyStore(goldenDirectory, liveDirectory);
        const live = new SQLiteTraceStore(livePath);
        const commitExports = [live.exportTrace()];
        for (let index = 0; index < 6; index += 1) {
            live.append(appendRequestFor(seed, "wal", index));
            commitExports.push(live.exportTrace());
        }
        for (const name of readdirSync(liveDirectory)) {
            cpSync(path.join(liveDirectory, name), path.join(imageDirectory, name), {
                recursive: true,
            });
        }
        live.close();
        const walPath = (databasePath: string) => `${databasePath}-wal`;
        const shmPath = (databasePath: string) => `${databasePath}-shm`;
        assert.ok(statSync(walPath(path.join(imageDirectory, DATABASE))).size > 0);
        const imageStore = new SQLiteTraceStore(
            path.join(copyStore(imageDirectory, path.join(directory, "golden-image"))),
        );
        const imageExport = imageStore.exportTrace();
        const golden: Golden = {
            ...base,
            commitExports,
            export: imageExport,
            surface: readSurface(imageStore, base),
        };
        imageStore.close();
        assert.equal(imageExport, commitExports.at(-1));

        const random = createPrng(deriveSeed(seed, "corruption:wal", 0));
        const walSize = statSync(walPath(path.join(imageDirectory, DATABASE))).size;
        const cases: [string, (databasePath: string) => void][] = [
            ["WAL deleted", (databasePath) => rmSync(walPath(databasePath))],
            [
                "WAL and SHM deleted",
                (databasePath) => {
                    rmSync(walPath(databasePath));
                    rmSync(shmPath(databasePath), { force: true });
                },
            ],
            ["SHM deleted", (databasePath) => rmSync(shmPath(databasePath), { force: true })],
            ["SHM truncated to zero", (databasePath) => truncateSync(shmPath(databasePath), 0)],
            [
                "SHM overwritten with seeded bytes",
                (databasePath) => {
                    const size = statSync(shmPath(databasePath)).size;
                    writeFileSync(
                        shmPath(databasePath),
                        Uint8Array.from({ length: size }, () => random.int(256)),
                    );
                },
            ],
            [
                "WAL header flipped",
                (databasePath) => flipBytes(walPath(databasePath), random, random.int(32), 1),
            ],
            [
                "stray garbage rollback journal",
                (databasePath) =>
                    writeFileSync(
                        `${databasePath}-journal`,
                        Uint8Array.from({ length: 4096 }, () => random.int(256)),
                    ),
            ],
        ];
        for (let index = 0; index < settings.walCases; index += 1) {
            const offset = 32 + random.int(walSize - 32);
            cases.push(
                index % 2 === 0
                    ? [
                          `WAL truncated at ${offset}`,
                          (databasePath) => truncateSync(walPath(databasePath), offset),
                      ]
                    : [
                          `WAL flipped at ${offset}`,
                          (databasePath) => flipBytes(walPath(databasePath), random, offset, 1),
                      ],
            );
        }
        const rows: Row[] = [];
        for (const [index, [caseName, corrupt]] of cases.entries()) {
            const databasePath = copyStore(imageDirectory, path.join(directory, `case-${index}`));
            corrupt(databasePath);
            rows.push({ caseName, ...classifyStore(databasePath, golden, true) });
        }
        for (const row of rows)
            context.diagnostic(`${row.caseName}: ${row.outcome} (${row.detail})`);
        context.diagnostic(`WAL/SHM: ${JSON.stringify(tally(rows))}`);
        const byName = new Map(rows.map((row) => [row.caseName, row.outcome]));
        assert.equal(byName.get("SHM deleted"), "recovered");
        assert.equal(byName.get("SHM truncated to zero"), "recovered");
        assert.equal(byName.get("WAL deleted"), "rolled-back");
    });

    test(`altered, truncated, renamed, or missing blobs and stray temporaries are detected or inspected (seed ${seed})`, {
        timeout: faultSettings.testTimeoutMilliseconds,
    }, async (context) => {
        const directory = await mkdtemp(path.join(tmpdir(), "shepherd-corruption-blobs-"));
        context.after(() => rm(directory, { force: true, recursive: true }));
        const goldenDirectory = path.join(directory, "golden");
        mkdirSync(goldenDirectory);
        const golden = await buildGolden(goldenDirectory, seed);
        const random = createPrng(deriveSeed(seed, "corruption:blobs", 0));
        const target = golden.blobIds[random.int(golden.blobIds.length)] as string;
        const strayId = blobIdOf(blobContentFor(seed, "stray", 0));
        const cases: [string, Outcome, (databasePath: string) => void][] = [
            [
                "blob truncated",
                "detected",
                (p) =>
                    truncateSync(
                        blobPath(p, target),
                        Math.max(0, statSync(blobPath(p, target)).size - 1),
                    ),
            ],
            [
                "blob byte altered",
                "detected",
                (p) =>
                    flipBytes(
                        blobPath(p, target),
                        random,
                        random.int(statSync(blobPath(p, target)).size),
                        1,
                    ),
            ],
            ["blob deleted", "detected", (p) => rmSync(blobPath(p, target))],
            [
                "blob renamed",
                "detected",
                (p) => {
                    const source = blobPath(p, target);
                    renameSync(
                        source,
                        path.join(path.dirname(source), `${path.basename(source)}.renamed`),
                    );
                },
            ],
            [
                "blob replaced by a directory",
                "detected",
                (p) => {
                    rmSync(blobPath(p, target));
                    mkdirSync(blobPath(p, target));
                },
            ],
            [
                "stray temporary file in a bucket",
                "recovered",
                (p) =>
                    writeFileSync(
                        path.join(path.dirname(blobPath(p, target)), ".tmp-stray"),
                        "partial",
                    ),
            ],
            [
                "stray unregistered blob",
                "recovered",
                (p) => {
                    mkdirSync(path.dirname(blobPath(p, strayId)), { recursive: true });
                    writeFileSync(blobPath(p, strayId), blobContentFor(seed, "stray", 0));
                },
            ],
        ];
        const rows: Row[] = [];
        for (const [index, [caseName, expected, corrupt]] of cases.entries()) {
            const databasePath = copyStore(goldenDirectory, path.join(directory, `case-${index}`));
            corrupt(databasePath);
            const row = { caseName, ...classifyStore(databasePath, golden, false) };
            rows.push(row);
            assert.equal(row.outcome, expected, `${caseName}: ${row.detail}`);
        }
        for (const row of rows)
            context.diagnostic(`${row.caseName}: ${row.outcome} (${row.detail})`);
    });

    test(`tampered backups are refused by verification and restore (seed ${seed})`, {
        timeout: faultSettings.testTimeoutMilliseconds,
    }, async (context) => {
        const directory = await mkdtemp(path.join(tmpdir(), "shepherd-corruption-backup-"));
        context.after(() => rm(directory, { force: true, recursive: true }));
        const goldenDirectory = path.join(directory, "golden");
        mkdirSync(goldenDirectory);
        const golden = await buildGolden(goldenDirectory, seed);
        const source = new SQLiteTraceStore(path.join(goldenDirectory, DATABASE), {
            readOnly: true,
        });
        const backupDirectory = path.join(directory, "backup");
        const manifest = await backupTraceStore(source, { destination: backupDirectory });
        source.close();
        const random = createPrng(deriveSeed(seed, "corruption:backup", 0));
        const manifestPath = (root: string) => path.join(root, "manifest.json");
        const databasePath = (root: string) => path.join(root, DATABASE);
        const backupBlob = (root: string) => {
            const digest = (golden.blobIds[0] as string).split(":")[1] as string;
            return path.join(root, "blobs", digest.slice(0, 2), digest);
        };
        const cases: [string, Outcome, (root: string) => void][] = [
            [
                "manifest byte flipped",
                "refused",
                (root) =>
                    flipBytes(
                        manifestPath(root),
                        random,
                        random.int(statSync(manifestPath(root)).size),
                        1,
                    ),
            ],
            ["manifest deleted", "refused", (root) => rmSync(manifestPath(root))],
            ["manifest truncated", "refused", (root) => truncateSync(manifestPath(root), 10)],
            [
                "database page flipped",
                "refused",
                (root) =>
                    flipBytes(
                        databasePath(root),
                        random,
                        random.int(statSync(databasePath(root)).size),
                        1,
                    ),
            ],
            ["database truncated", "refused", (root) => truncateSync(databasePath(root), 4096)],
            ["database deleted", "refused", (root) => rmSync(databasePath(root))],
            ["backup blob deleted", "refused", (root) => rmSync(backupBlob(root))],
            ["backup blob altered", "refused", (root) => flipBytes(backupBlob(root), random, 0, 1)],
            [
                "stray staging directory",
                "recovered",
                (root) => mkdirSync(path.join(root, ".shepherd-restore-stray")),
            ],
        ];
        assert.ok(existsSync(backupBlob(backupDirectory)));
        const rows: Row[] = [];
        for (const [index, [caseName, expected, corrupt]] of cases.entries()) {
            const root = path.join(directory, `case-${index}`);
            cpSync(backupDirectory, root, { recursive: true });
            corrupt(root);
            let row: Row;
            try {
                await verifyTraceStoreBackup(root, { expectedManifestId: manifest.manifest_id });
                const restored = path.join(directory, `restored-${index}.sqlite`);
                await restoreTraceStoreBackup(root, restored, {
                    expectedManifestId: manifest.manifest_id,
                });
                const store = new SQLiteTraceStore(restored, { readOnly: true });
                assert.equal(
                    store.exportTrace(),
                    golden.export,
                    `${caseName} restored differently`,
                );
                store.close();
                row = {
                    caseName,
                    detail: "verified and restored identically",
                    outcome: "recovered",
                };
            } catch (error) {
                assert.ok(error instanceof TraceStoreBackupError, `${caseName}: ${String(error)}`);
                await assert.rejects(
                    restoreTraceStoreBackup(root, path.join(directory, `refused-${index}.sqlite`), {
                        expectedManifestId: manifest.manifest_id,
                    }),
                    TraceStoreBackupError,
                );
                row = { caseName, detail: errorName(error), outcome: "refused" };
            }
            rows.push(row);
            assert.equal(row.outcome, expected, `${caseName}: ${row.detail}`);
        }
        for (const row of rows)
            context.diagnostic(`${row.caseName}: ${row.outcome} (${row.detail})`);
    });
}

test("a malformed append intent batch digest is detected; a well-formed substitute fails closed on retry", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-corruption-digest-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const [seed = 0] = faultSeeds();
    const databasePath = path.join(directory, DATABASE);
    const request = appendRequestFor(seed, "digest", 0);
    const store = new SQLiteTraceStore(databasePath);
    const receipt = store.append(request);
    const exported = store.exportTrace();
    store.close();
    const setDigest = (transform: (digest: string) => string): void => {
        const database = new DatabaseSync(databasePath);
        const row = database
            .prepare("SELECT batch_digest FROM append_intents WHERE append_intent_id = ?")
            .get(request.append_intent_id) as { batch_digest: string };
        database
            .prepare("UPDATE append_intents SET batch_digest = ? WHERE append_intent_id = ?")
            .run(transform(row.batch_digest), request.append_intent_id);
        database.close();
    };

    // Regression (found by the seeded page flips): the store verified receipts but not the
    // digest beside them, so a flipped digest was exported and made the archive unimportable.
    setDigest((digest) => `${digest.slice(0, -2)} Z`);
    const malformed = new SQLiteTraceStore(databasePath);
    assert.deepEqual(malformed.diagnoseAppend(request.append_intent_id), {
        append_intent_id: request.append_intent_id,
        issue: "receipt_mismatch",
        status: "manual_recovery_required",
    });
    assert.deepEqual(
        malformed.verifyIntegrity().issues.map((issue) => issue.kind),
        ["append_receipt_mismatch"],
    );
    assert.throws(() => malformed.exportTrace(), TraceStoreError);
    malformed.close();

    // Residual (F-018): another well-formed digest is not derivable from retained records.
    const original = JSON.parse(exported).append_intents[0].batch_digest as string;
    setDigest(() => `${original.slice(0, -1)}${original.endsWith("0") ? "1" : "0"}`);
    const substituted = new SQLiteTraceStore(databasePath);
    assert.equal(substituted.verifyIntegrity().ok, true);
    assert.equal(differsOnlyInBatchDigests(exported, substituted.exportTrace()), true);
    assert.throws(() => substituted.append(request), AppendIntentConflictError);
    assert.deepEqual(
        substituted
            .readOwner(request.batch.groups[0]?.owner_id as string)
            .map((record) => record.envelope.record_id),
        receipt.record_ids,
    );
    substituted.close();
});
