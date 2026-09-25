import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { cpus, release, tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

import {
    createDeviceLayerAdapters,
    type DeviceLayerAdapter,
    type DeviceLayerWorld,
    openDeviceLayerWorld,
} from "../src/index.ts";

type BenchmarkConfiguration = {
    readonly constantTime: { readonly adapters: readonly string[]; readonly maxRatio: number };
    readonly depthSweep: { readonly adapters: readonly string[]; readonly checkpoints: number };
    readonly fileBytes: number;
    readonly outputDirectory: string;
    readonly outputPrefix: string;
    readonly repetitions: number;
    readonly temporaryDirectoryPrefix: string;
    readonly warmups: number;
    readonly worldFileCounts: readonly number[];
};

type ConformanceConfiguration = {
    readonly optInAdapters: readonly string[];
    readonly optInEnvironmentVariable: string;
    readonly separator: string;
};

type Measurement = {
    readonly adapter: string;
    readonly checkpoint_median_ms: number;
    readonly checkpoint_p90_ms: number;
    readonly restore_median_ms: number;
    readonly world_bytes: number;
    readonly world_files: number;
};

const read = <T>(file: string): T =>
    JSON.parse(readFileSync(new URL(`../config/${file}`, import.meta.url), "utf8")) as T;
const configuration = read<BenchmarkConfiguration>("device-layer-benchmark.config.json");
const conformance = read<ConformanceConfiguration>("device-layer-conformance.config.json");
const optedIn = (process.env[conformance.optInEnvironmentVariable] ?? "").split(
    conformance.separator,
);
const root = mkdtempSync(path.join(tmpdir(), configuration.temporaryDirectoryPrefix));
const measurements: Measurement[] = [];
const depthSweeps: Record<string, unknown>[] = [];
const skipped: Record<string, string>[] = [];

try {
    const adapters: DeviceLayerAdapter[] = [];
    for (const adapter of createDeviceLayerAdapters()) {
        const scratch = mkdtempSync(path.join(root, "probe-"));
        const probe = await adapter.probe({ root: scratch });
        rmSync(scratch, { force: true, recursive: true });
        if (!probe.available) skipped.push({ adapter: adapter.name, reason: probe.reason });
        else if (
            conformance.optInAdapters.includes(adapter.name) &&
            !optedIn.includes(adapter.name)
        ) {
            skipped.push({ adapter: adapter.name, reason: conformance.optInEnvironmentVariable });
        } else adapters.push(adapter);
    }
    for (const fileCount of configuration.worldFileCounts) {
        const seed = createSeed(fileCount);
        for (const adapter of adapters) {
            const world = await open(adapter, seed);
            try {
                const checkpoints: number[] = [];
                const restores: number[] = [];
                for (
                    let step = 0;
                    step < configuration.warmups + configuration.repetitions;
                    step += 1
                ) {
                    await world.writeFile(`changed-${step}.bin`, contentOf(`step:${step}`));
                    const checkpointMs = await timed(() => world.checkpoint(`s${step}`));
                    await world.writeFile("discarded.bin", contentOf(`discard:${step}`));
                    const restoreMs = await timed(() => world.restore(`s${step}`));
                    if (step >= configuration.warmups) {
                        checkpoints.push(checkpointMs);
                        restores.push(restoreMs);
                    }
                }
                measurements.push({
                    adapter: adapter.name,
                    checkpoint_median_ms: round(quantile(checkpoints, 0.5)),
                    checkpoint_p90_ms: round(quantile(checkpoints, 0.9)),
                    restore_median_ms: round(quantile(restores, 0.5)),
                    world_bytes: fileCount * configuration.fileBytes,
                    world_files: fileCount,
                });
            } finally {
                await world.close();
            }
        }
        rmSync(seed, { force: true, recursive: true });
    }
    const smallest = createSeed(configuration.worldFileCounts[0] as number);
    for (const adapter of adapters.filter((candidate) =>
        configuration.depthSweep.adapters.includes(candidate.name),
    )) {
        const world = await open(adapter, smallest);
        try {
            const samples: { depth: number; ms: number; compacted: boolean }[] = [];
            for (let step = 0; step < configuration.depthSweep.checkpoints; step += 1) {
                await world.writeFile(`depth-${step}.bin`, contentOf(`depth:${step}`));
                let compacted = false;
                const ms = await timed(async () => {
                    compacted = (await world.checkpoint(`d${step}`)).compaction !== null;
                });
                samples.push({ compacted, depth: world.layers().length, ms: round(ms) });
            }
            const plain = samples.filter((sample) => !sample.compacted);
            const compactions = samples.filter((sample) => sample.compacted);
            depthSweeps.push({
                adapter: adapter.name,
                checkpoints: samples.length,
                compaction_count: compactions.length,
                compaction_median_ms: round(
                    quantile(
                        compactions.map((sample) => sample.ms),
                        0.5,
                    ),
                ),
                max_depth: world.depth.maxDepth,
                max_observed_depth: Math.max(...samples.map((sample) => sample.depth)),
                plain_median_ms_by_depth: depthBuckets(plain, world.depth.maxDepth),
                retain_newest: world.depth.retainNewest,
                world_files: configuration.worldFileCounts[0],
            });
        } finally {
            await world.close();
        }
    }
} finally {
    rmSync(root, { force: true, recursive: true });
}

const ratios = Object.fromEntries(
    [...new Set(measurements.map((measurement) => measurement.adapter))].map((adapter) => {
        const rows = measurements.filter((measurement) => measurement.adapter === adapter);
        const first = rows[0] as Measurement;
        const last = rows.at(-1) as Measurement;
        return [
            adapter,
            {
                checkpoint_ratio_largest_to_smallest: round(
                    last.checkpoint_median_ms / first.checkpoint_median_ms,
                ),
                restore_ratio_largest_to_smallest: round(
                    last.restore_median_ms / first.restore_median_ms,
                ),
                world_ratio: last.world_bytes / first.world_bytes,
            },
        ];
    }),
);
const report = {
    configuration,
    depth_sweeps: depthSweeps,
    host: {
        arch: process.arch,
        cpu: cpus()[0]?.model ?? null,
        node: process.version,
        platform: process.platform,
        release: release(),
    },
    measurements,
    method: "Each world is seeded with world_files files of fileBytes random-looking bytes. Every step writes one new changed file, times checkpoint(), writes one discarded file, and times restore() of the new checkpoint (discarding the writable layer); warmup steps are dropped. The depth sweep freezes depthSweep.checkpoints consecutive checkpoints over the smallest world under the configured depth bound, recording latency by stack depth and for checkpoints that compacted.",
    ratios,
    skipped,
};
const text = `${JSON.stringify(report, null, 2)}\n`;
mkdirSync(path.resolve(configuration.outputDirectory), { recursive: true });
writeFileSync(
    path.resolve(
        configuration.outputDirectory,
        `${configuration.outputPrefix}${process.platform}-${process.arch}.json`,
    ),
    text,
);
process.stdout.write(text);

// Constant-time claim: on the configured adapters, checkpoint latency must not grow with world size.
for (const adapter of configuration.constantTime.adapters) {
    const ratio = (ratios[adapter] as { checkpoint_ratio_largest_to_smallest: number } | undefined)
        ?.checkpoint_ratio_largest_to_smallest;
    if (ratio === undefined) continue;
    assert.ok(
        ratio <= configuration.constantTime.maxRatio,
        `${adapter} checkpoint latency grew ${ratio}x with world size`,
    );
}

function open(adapter: DeviceLayerAdapter, seed: string): Promise<DeviceLayerWorld> {
    return openDeviceLayerWorld({ adapter: adapter.name, adapters: [adapter], root, seed });
}

function createSeed(fileCount: number): string {
    const seed = mkdtempSync(path.join(root, "seed-"));
    for (let index = 0; index < fileCount; index += 1) {
        const directory = path.join(seed, `dir-${String(index % 16).padStart(2, "0")}`);
        mkdirSync(directory, { recursive: true });
        writeFileSync(path.join(directory, `file-${index}.bin`), contentOf(`seed:${index}`));
    }
    return seed;
}

async function timed(operation: () => Promise<unknown>): Promise<number> {
    const started = performance.now();
    await operation();
    return performance.now() - started;
}

function quantile(values: readonly number[], q: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((left, right) => left - right);
    return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] as number;
}

function depthBuckets(
    samples: readonly { depth: number; ms: number }[],
    maxDepth: number,
): Record<string, number> {
    const width = Math.ceil(maxDepth / 4);
    const buckets: Record<string, number[]> = {};
    for (const sample of samples) {
        const low = Math.floor((sample.depth - 1) / width) * width + 1;
        const key = `${low}-${low + width - 1}`;
        buckets[key] ??= [];
        buckets[key].push(sample.ms);
    }
    return Object.fromEntries(
        Object.entries(buckets).map(([key, values]) => [key, round(quantile(values, 0.5))]),
    );
}

function round(value: number): number {
    return Math.round(value * 100) / 100;
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
