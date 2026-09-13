import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
    closeSync,
    fsyncSync,
    lstatSync,
    mkdirSync,
    mkdtempSync,
    openSync,
    readdirSync,
    readFileSync,
    rmSync,
    statfsSync,
    writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
    createReferenceCopyCarrier,
    createWorkspaceBindings,
    initializeWorkspace,
    inspectWorkspacePlatformConformance,
    type WorldCarrierBackend,
} from "../src/index.ts";
import { workspaceProtocolConfig } from "../src/protocol/config.ts";

type BenchmarkConfiguration = {
    readonly changedFileCounts: readonly number[];
    readonly copyMinimumGrowthRatio: number;
    readonly fileBytes: number;
    readonly flushCommand: readonly string[];
    readonly optimizedBoundFactor: number;
    readonly optimizedBoundOverheadBytes: number;
    readonly repetitions: number;
    readonly temporaryDirectoryPrefix: string;
    readonly worldFileCounts: readonly number[];
};

type Measurement = {
    readonly backend: string;
    readonly branch_bytes: number;
    readonly changed_bytes: number;
    readonly upper_layer_bytes: number | null;
    readonly world_bytes: number;
};

const configuration = JSON.parse(
    readFileSync(new URL("../config/carrier-benchmark.config.json", import.meta.url), "utf8"),
) as BenchmarkConfiguration;
const backends = workspaceProtocolConfig.carrierBackends;
const root = mkdtempSync(path.join(tmpdir(), configuration.temporaryDirectoryPrefix));
const measurements: Measurement[] = [];
let available: readonly string[] = [];

try {
    for (const fileCount of configuration.worldFileCounts) {
        const workspaceRoot = path.join(root, String(fileCount));
        const sourceRoot = path.join(workspaceRoot, "source");
        mkdirSync(sourceRoot, { recursive: true });
        initializeWorkspace({ adopt: "none", initializeGit: false, rootPath: workspaceRoot });
        for (let index = 0; index < fileCount; index += 1) {
            writeDurably(path.join(sourceRoot, fileName(index)), configuration.fileBytes);
        }
        const [binding] = createWorkspaceBindings({
            bindings: [{ name: "source", root: "source" }],
            workspaceRoot,
        }).bindings;
        assert.ok(binding);
        available = [
            backends.defaultBackend,
            ...inspectWorkspacePlatformConformance({ workspaceRoot })
                .optimized_carriers.filter(
                    (evidence) => evidence.status === backends.conformance.statusRoles.conformant,
                )
                .map((evidence) => evidence.backend),
        ];
        for (const backend of available) {
            const carrier = createReferenceCopyCarrier({
                backend: backend as WorldCarrierBackend,
                workspaceRoot,
            });
            const revision = await carrier.snapshot(binding);
            for (const changedFiles of configuration.changedFileCounts) {
                const samples: { branch: number; upper: number | null }[] = [];
                for (let sample = 0; sample < configuration.repetitions; sample += 1) {
                    const before = freeBytes(workspaceRoot);
                    const custody = await carrier.fork(revision.revision_id);
                    for (let index = fileCount - changedFiles; index < fileCount; index += 1) {
                        const target = path.join(custody.path, fileName(index));
                        rmSync(target);
                        writeDurably(target, configuration.fileBytes);
                    }
                    const after = freeBytes(workspaceRoot);
                    const upper =
                        backend === backends.overlay.backend
                            ? allocatedBytes(
                                  path.join(
                                      path.dirname(custody.path),
                                      backends.overlay.upperDirectory,
                                  ),
                              )
                            : null;
                    samples.push({ branch: Math.max(0, before - after), upper });
                    await carrier.discard(custody.custody_id);
                }
                const best = [...samples].sort((left, right) => left.branch - right.branch)[
                    Math.floor(samples.length / 2)
                ];
                assert.ok(best);
                measurements.push({
                    backend,
                    branch_bytes: best.branch,
                    changed_bytes: changedFiles * configuration.fileBytes,
                    upper_layer_bytes: best.upper,
                    world_bytes: fileCount * configuration.fileBytes,
                });
            }
        }
    }
} finally {
    rmSync(root, { force: true, recursive: true });
}

process.stdout.write(
    `${JSON.stringify(
        {
            configuration,
            host: { arch: process.arch, node: process.version, platform: process.platform },
            measurements,
        },
        null,
        2,
    )}\n`,
);

const [smallWorld, largeWorld] = [
    Math.min(...configuration.worldFileCounts) * configuration.fileBytes,
    Math.max(...configuration.worldFileCounts) * configuration.fileBytes,
];
for (const measurement of measurements) {
    if (measurement.backend === backends.defaultBackend) {
        assert.ok(
            measurement.branch_bytes >=
                configuration.copyMinimumGrowthRatio * measurement.world_bytes,
            `copy branch storage must scale with world size: ${JSON.stringify(measurement)}`,
        );
        continue;
    }
    const bound =
        configuration.optimizedBoundFactor * measurement.changed_bytes +
        configuration.optimizedBoundOverheadBytes;
    assert.ok(
        measurement.branch_bytes <= bound,
        `${measurement.backend} branch storage exceeds its changed-data bound: ${JSON.stringify(measurement)}`,
    );
}
for (const changedFiles of configuration.changedFileCounts) {
    const copy = (worldBytes: number) =>
        measurements.find(
            (entry) =>
                entry.backend === backends.defaultBackend &&
                entry.world_bytes === worldBytes &&
                entry.changed_bytes === changedFiles * configuration.fileBytes,
        )?.branch_bytes ?? 0;
    assert.ok(
        copy(largeWorld) - copy(smallWorld) >=
            configuration.copyMinimumGrowthRatio * (largeWorld - smallWorld),
        "copy branch storage must grow with world size",
    );
}
assert.ok(available.length > 0);

function fileName(index: number): string {
    return `file-${String(index).padStart(6, "0")}.bin`;
}

function writeDurably(target: string, bytes: number): void {
    const descriptor = openSync(target, "wx", 0o644);
    try {
        writeSync(descriptor, randomBytes(bytes));
        fsyncSync(descriptor);
    } finally {
        closeSync(descriptor);
    }
}

function freeBytes(directory: string): number {
    const [executable, ...args] = configuration.flushCommand;
    assert.ok(executable);
    execFileSync(executable, args);
    const status = statfsSync(directory);
    return status.bavail * status.bsize;
}

function allocatedBytes(directory: string): number {
    let total = 0;
    for (const entry of readdirSync(directory, { recursive: true })) {
        total += lstatSync(path.join(directory, String(entry))).blocks * 512;
    }
    return total;
}
