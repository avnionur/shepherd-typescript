import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    rmSync,
    statSync,
    writeFileSync,
} from "node:fs";
import { cpus, release, tmpdir } from "node:os";
import path from "node:path";

import {
    createEffectHandlerStack,
    createEffectIntent,
    type ReplayCheckpointPolicy,
    runReplaySession,
    SQLiteTraceStore,
} from "../src/index.ts";

type BenchmarkConfiguration = {
    readonly changedFileCounts: readonly number[];
    readonly fileBytes: number;
    readonly outputDirectory: string;
    readonly outputPrefix: string;
    readonly steps: number;
    readonly temporaryDirectoryPrefix: string;
    readonly worldFileCounts: readonly number[];
};

type Footprint = { readonly blobBytes: number; readonly databaseBytes: number };

type Measurement = {
    readonly blob_bytes_per_checkpoint: number;
    readonly changed_bytes_per_step: number;
    readonly checkpoints: number;
    readonly database_bytes_per_checkpoint: number;
    readonly steps: number;
    readonly total_bytes_per_checkpoint: number;
    readonly world_bytes: number;
    readonly world_files: number;
};

const configuration = JSON.parse(
    readFileSync(new URL("../config/checkpoint-benchmark.config.json", import.meta.url), "utf8"),
) as BenchmarkConfiguration;
const every: ReplayCheckpointPolicy = { interval: 1, kind: "every_n_steps" };
const root = mkdtempSync(path.join(tmpdir(), configuration.temporaryDirectoryPrefix));
const measurements: Measurement[] = [];

try {
    for (const fileCount of configuration.worldFileCounts) {
        for (const changedFiles of configuration.changedFileCounts) {
            const label = `${fileCount}-${changedFiles}`;
            const without = await record(
                path.join(root, `${label}-none`),
                fileCount,
                changedFiles,
                {
                    kind: "none",
                },
            );
            const withCheckpoints = await record(
                path.join(root, `${label}-every`),
                fileCount,
                changedFiles,
                every,
            );
            const checkpoints = withCheckpoints.checkpoints;
            assert.equal(without.checkpoints, 0);
            assert.equal(checkpoints, configuration.steps);
            const blob =
                (withCheckpoints.footprint.blobBytes - without.footprint.blobBytes) / checkpoints;
            const database =
                (withCheckpoints.footprint.databaseBytes - without.footprint.databaseBytes) /
                checkpoints;
            measurements.push({
                blob_bytes_per_checkpoint: Math.round(blob),
                changed_bytes_per_step: changedFiles * configuration.fileBytes,
                checkpoints,
                database_bytes_per_checkpoint: Math.round(database),
                steps: configuration.steps,
                total_bytes_per_checkpoint: Math.round(blob + database),
                world_bytes: fileCount * configuration.fileBytes,
                world_files: fileCount,
            });
        }
    }
} finally {
    rmSync(root, { force: true, recursive: true });
}

const report = {
    configuration,
    host: {
        arch: process.arch,
        cpu: cpus()[0]?.model ?? null,
        node: process.version,
        platform: process.platform,
        release: release(),
    },
    measurements,
    method: "Each workload runs the same deterministic effect-only session twice, once without automatic checkpoints and once with an every-step policy; per-checkpoint growth is the on-disk difference (trace database after close, plus content-addressed blob files) divided by the checkpoint count.",
};
const text = `${JSON.stringify(report, null, 2)}\n`;
writeFileSync(
    path.resolve(
        configuration.outputDirectory,
        `${configuration.outputPrefix}${process.platform}-${process.arch}.json`,
    ),
    text,
);
process.stdout.write(text);

// Content addressing: a checkpoint stores only changed file bytes plus the manifest, never a full
// copy of an unchanged world.
for (const measurement of measurements) {
    assert.ok(
        measurement.blob_bytes_per_checkpoint < measurement.world_bytes ||
            measurement.changed_bytes_per_step * 2 >= measurement.world_bytes,
        `checkpoint blobs must not copy the whole world: ${JSON.stringify(measurement)}`,
    );
}

/**
 * Runs one effect-only session over a fresh world. Step `i` rewrites `changedFiles` files with
 * deterministic content derived from the step, so every checkpoint sees exactly that change.
 */
async function record(
    directory: string,
    fileCount: number,
    changedFiles: number,
    checkpointPolicy: ReplayCheckpointPolicy,
): Promise<{ readonly checkpoints: number; readonly footprint: Footprint }> {
    const world = path.join(directory, "world");
    mkdirSync(world, { recursive: true });
    for (let index = 0; index < fileCount; index += 1) {
        writeFileSync(path.join(world, fileName(index)), contentOf(`initial:${index}`));
    }
    const databasePath = path.join(directory, "trace.sqlite");
    const store = new SQLiteTraceStore(databasePath);
    let checkpoints: number;
    try {
        const handlers = createEffectHandlerStack([
            {
                handle: (intent) => {
                    const { step } = intent.payload as { readonly step: number };
                    for (let offset = 0; offset < changedFiles; offset += 1) {
                        const index = (step * changedFiles + offset) % fileCount;
                        writeFileSync(
                            path.join(world, fileName(index)),
                            contentOf(`step:${step}:${index}`),
                        );
                    }
                    return { ok: true, value: null };
                },
                handlerId: "handler:bench.write",
                kind: "bench.write",
            },
        ]);
        const { inspection } = await runReplaySession(store, {
            checkpointPolicy,
            claimId: "bench",
            commandId: `bench:${path.basename(directory)}`,
            handlers,
            program: async (context) => {
                for (let step = 0; step < configuration.steps; step += 1) {
                    await context.dispatchEffect(
                        createEffectIntent({
                            effectId: `effect:bench:${step}`,
                            kind: "bench.write",
                            payload: { step },
                            reversibility: "reversible",
                        }),
                    );
                }
                return null;
            },
            programId: "bench:checkpoints.v1",
            worlds: [{ name: "main", root: world }],
        });
        assert.equal(inspection.terminal?.status, "finished");
        checkpoints = inspection.checkpoints.length;
    } finally {
        store.close();
    }
    return {
        checkpoints,
        footprint: {
            blobBytes: directoryBytes(`${databasePath}.blobs`),
            databaseBytes: readdirSync(directory)
                .filter((name) => name.startsWith("trace.sqlite") && !name.endsWith(".blobs"))
                .reduce((total, name) => total + statSync(path.join(directory, name)).size, 0),
        },
    };
}

function contentOf(seed: string): Buffer {
    const chunks: Buffer[] = [];
    let block = createHash("sha256").update(seed).digest();
    let length = 0;
    while (length < configuration.fileBytes) {
        chunks.push(block);
        length += block.length;
        block = createHash("sha256").update(block).digest();
    }
    return Buffer.concat(chunks).subarray(0, configuration.fileBytes);
}

function fileName(index: number): string {
    return `file-${String(index).padStart(6, "0")}.bin`;
}

function directoryBytes(directory: string): number {
    let total = 0;
    for (const entry of readdirSync(directory, { recursive: true })) {
        const status = statSync(path.join(directory, String(entry)));
        if (status.isFile()) {
            total += status.size;
        }
    }
    return total;
}
