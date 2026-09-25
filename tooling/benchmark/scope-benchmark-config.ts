import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import type { HostClass, SloBudget } from "./kernel-benchmark.ts";

/** Timed metric families of the scope benchmark; every one improves downwards. */
export const SCOPE_METRIC_FAMILIES = Object.freeze({
    fork_ms: "forkScope of one child scope with carrier custody of the source binding",
    observe_ms: "one observer pulling the records of one effect event through a trace subscription",
    record_ms: "one dispatchEffect call of a replay session, committed and recorded",
    revert_ms: "discardScope of one mutated child scope, including carrier custody cleanup",
} as const);

/** Name of one timed metric family. */
export type ScopeMetricFamily = keyof typeof SCOPE_METRIC_FAMILIES;

/** One synthetic world bound as the source workspace binding. */
export type ScopeBenchmarkWorld = {
    /** Bytes of each file. */
    readonly fileBytes: number;
    /** Number of files. */
    readonly files: number;
    /** Stable world label used in metric names. */
    readonly id: string;
};

/** Validated `benchmark` section of `config/scope-benchmark.config.json`. */
export type ScopeBenchmarkConfiguration = {
    /** K-branch pattern: baseline writes in the parent, then one fork plus writes per sibling. */
    readonly branching: {
        /** Writes into the parent custody before its checkpoint. */
        readonly baselineWrites: number;
        /** K: the parent plus K - 1 sibling branches forked from its checkpoint. */
        readonly branchCount: number;
        /** Writes into each sibling after its fork. */
        readonly branchWrites: number;
        /** Bytes per write outside the mutation sweep. */
        readonly defaultWriteBytes: number;
        /** Repetitions of each branching measurement. */
        readonly repetitions: number;
    };
    /** Fork/revert latency sampling. */
    readonly fork: { readonly repetitions: number; readonly warmupIterations: number };
    /** Per-write size sweep run on one configured world. */
    readonly mutationSweep: { readonly world: string; readonly writeBytes: readonly number[] };
    /** Identity prefixes and literals used by the synthetic workloads. */
    readonly naming: {
        readonly claimPrefix: string;
        readonly commandPrefix: string;
        readonly effectKind: string;
        readonly handlerId: string;
        /** Logical clock passed to every scope command so writer leases never expire mid-run. */
        readonly logicalTimeMilliseconds: number;
        readonly programId: string;
        readonly sourceBinding: string;
    };
    /** Per-event record and observe overhead sampling. */
    readonly observation: {
        readonly observerCounts: readonly number[];
        readonly sessionRepetitions: number;
        readonly steps: readonly number[];
    };
    /** Repository-relative directory of result artifacts. */
    readonly resultDirectory: string;
    readonly resultFormat: string;
    readonly resultFormatVersion: number;
    /** File name prefix of result artifacts, followed by the host class id. */
    readonly resultPrefix: string;
    /** Free-space measurement procedure. */
    readonly storage: {
        /** Command run before each free-space reading to flush dirty data. */
        readonly flushCommand: readonly string[];
        readonly settleAttempts: number;
        readonly settleDelayMilliseconds: number;
        /** Free-space change between readings below which the filesystem counts as settled. */
        readonly settleToleranceBytes: number;
    };
    /** Prefix of the scratch directory created under the host temporary directory. */
    readonly temporaryDirectoryPrefix: string;
    readonly worlds: readonly ScopeBenchmarkWorld[];
};

/** Validated `slo` section of `config/scope-benchmark.config.json`. */
export type ScopeSloConfiguration = {
    /** How budgets were derived from measured results. */
    readonly budgetPolicy: string;
    /** Host classes; budget keys are full scope metric names. */
    readonly hostClasses: readonly HostClass[];
};

/** Both validated sections of the scope benchmark configuration file. */
export type ScopeBenchmarkConfigurationFile = {
    readonly benchmark: ScopeBenchmarkConfiguration;
    readonly slo: ScopeSloConfiguration;
};

/**
 * Reads and validates the scope benchmark configuration file.
 *
 * @param file - Configuration JSON path.
 * @returns The validated benchmark procedure and SLO host classes.
 * @throws {TypeError} If a field is missing or malformed, the sweep names an unknown world, or a
 * budget names an unknown metric family or does not set only a positive `max`.
 */
export function readScopeBenchmarkConfiguration(file: string): ScopeBenchmarkConfigurationFile {
    const value = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    const benchmark = requireObject(value.benchmark, "benchmark");
    const branching = requireObject(benchmark.branching, "benchmark.branching");
    const fork = requireObject(benchmark.fork, "benchmark.fork");
    const sweep = requireObject(benchmark.mutationSweep, "benchmark.mutationSweep");
    const naming = requireObject(benchmark.naming, "benchmark.naming");
    const observation = requireObject(benchmark.observation, "benchmark.observation");
    const storage = requireObject(benchmark.storage, "benchmark.storage");
    const worlds = requireArray(benchmark.worlds, "benchmark.worlds", 1).map(
        (entry, index): ScopeBenchmarkWorld => {
            const world = requireObject(entry, `benchmark.worlds[${index}]`);
            return {
                fileBytes: requireCount(world.fileBytes, `benchmark.worlds[${index}].fileBytes`, 1),
                files: requireCount(world.files, `benchmark.worlds[${index}].files`, 1),
                id: requireString(world.id, `benchmark.worlds[${index}].id`),
            };
        },
    );
    if (new Set(worlds.map(({ id }) => id)).size !== worlds.length) {
        throw new TypeError("benchmark.worlds ids must be distinct");
    }
    const sweepWorld = requireString(sweep.world, "benchmark.mutationSweep.world");
    if (!worlds.some(({ id }) => id === sweepWorld)) {
        throw new TypeError("benchmark.mutationSweep.world must name a configured world");
    }
    const flushCommand = requireArray(storage.flushCommand, "benchmark.storage.flushCommand", 1);
    if (flushCommand.some((entry) => typeof entry !== "string" || entry === "")) {
        throw new TypeError("benchmark.storage.flushCommand must list non-empty strings");
    }
    return {
        benchmark: {
            branching: {
                baselineWrites: requireCount(
                    branching.baselineWrites,
                    "benchmark.branching.baselineWrites",
                    0,
                ),
                branchCount: requireCount(
                    branching.branchCount,
                    "benchmark.branching.branchCount",
                    2,
                ),
                branchWrites: requireCount(
                    branching.branchWrites,
                    "benchmark.branching.branchWrites",
                    1,
                ),
                defaultWriteBytes: requireCount(
                    branching.defaultWriteBytes,
                    "benchmark.branching.defaultWriteBytes",
                    1,
                ),
                repetitions: requireCount(
                    branching.repetitions,
                    "benchmark.branching.repetitions",
                    1,
                ),
            },
            fork: {
                repetitions: requireCount(fork.repetitions, "benchmark.fork.repetitions", 1),
                warmupIterations: requireCount(
                    fork.warmupIterations,
                    "benchmark.fork.warmupIterations",
                    0,
                ),
            },
            mutationSweep: {
                world: sweepWorld,
                writeBytes: requireCounts(
                    sweep.writeBytes,
                    "benchmark.mutationSweep.writeBytes",
                    1,
                    2,
                ),
            },
            naming: {
                claimPrefix: requireString(naming.claimPrefix, "benchmark.naming.claimPrefix"),
                commandPrefix: requireString(
                    naming.commandPrefix,
                    "benchmark.naming.commandPrefix",
                ),
                effectKind: requireString(naming.effectKind, "benchmark.naming.effectKind"),
                handlerId: requireString(naming.handlerId, "benchmark.naming.handlerId"),
                logicalTimeMilliseconds: requireCount(
                    naming.logicalTimeMilliseconds,
                    "benchmark.naming.logicalTimeMilliseconds",
                    0,
                ),
                programId: requireString(naming.programId, "benchmark.naming.programId"),
                sourceBinding: requireString(
                    naming.sourceBinding,
                    "benchmark.naming.sourceBinding",
                ),
            },
            observation: {
                observerCounts: requireCounts(
                    observation.observerCounts,
                    "benchmark.observation.observerCounts",
                    0,
                    1,
                ),
                sessionRepetitions: requireCount(
                    observation.sessionRepetitions,
                    "benchmark.observation.sessionRepetitions",
                    1,
                ),
                steps: requireCounts(observation.steps, "benchmark.observation.steps", 1, 1),
            },
            resultDirectory: requireString(benchmark.resultDirectory, "benchmark.resultDirectory"),
            resultFormat: requireString(benchmark.resultFormat, "benchmark.resultFormat"),
            resultFormatVersion: requireCount(
                benchmark.resultFormatVersion,
                "benchmark.resultFormatVersion",
                1,
            ),
            resultPrefix: requireString(benchmark.resultPrefix, "benchmark.resultPrefix"),
            storage: {
                flushCommand: flushCommand as string[],
                settleAttempts: requireCount(
                    storage.settleAttempts,
                    "benchmark.storage.settleAttempts",
                    0,
                ),
                settleDelayMilliseconds: requireCount(
                    storage.settleDelayMilliseconds,
                    "benchmark.storage.settleDelayMilliseconds",
                    0,
                ),
                settleToleranceBytes: requireCount(
                    storage.settleToleranceBytes,
                    "benchmark.storage.settleToleranceBytes",
                    0,
                ),
            },
            temporaryDirectoryPrefix: requireString(
                benchmark.temporaryDirectoryPrefix,
                "benchmark.temporaryDirectoryPrefix",
            ),
            worlds,
        },
        slo: readScopeSlo(requireObject(value.slo, "slo")),
    };
}

/**
 * Builds the stable name of one timed metric.
 *
 * @param family - Metric family.
 * @param qualifiers - Backend and world, or observer count and step count, in that order.
 * @returns `<family>/<qualifier>/...`.
 *
 * @example
 * ```ts
 * scopeMetricName("fork_ms", "copy", "large"); // "fork_ms/copy/large"
 * ```
 */
export function scopeMetricName(
    family: ScopeMetricFamily,
    ...qualifiers: readonly string[]
): string {
    return [family, ...qualifiers].join("/");
}

/**
 * Least-squares line through measured points, used to read how storage scales with bytes
 * written.
 *
 * @param points - At least two points with distinct x values.
 * @returns Slope, intercept, and the coefficient of determination (1 for a perfect fit, and for
 * points that all share one y value).
 * @throws {RangeError} If fewer than two points are given or every x is equal.
 */
export function fitLine(points: readonly { readonly x: number; readonly y: number }[]): {
    readonly intercept: number;
    readonly r_squared: number;
    readonly slope: number;
} {
    if (points.length < 2) throw new RangeError("a line fit needs at least two points");
    const meanX = points.reduce((total, { x }) => total + x, 0) / points.length;
    const meanY = points.reduce((total, { y }) => total + y, 0) / points.length;
    const sxx = points.reduce((total, { x }) => total + (x - meanX) ** 2, 0);
    if (sxx === 0) throw new RangeError("a line fit needs at least two distinct x values");
    const sxy = points.reduce((total, { x, y }) => total + (x - meanX) * (y - meanY), 0);
    const syy = points.reduce((total, { y }) => total + (y - meanY) ** 2, 0);
    const slope = sxy / sxx;
    return {
        intercept: round(meanY - slope * meanX),
        r_squared: syy === 0 ? 1 : round((sxy * sxy) / (sxx * syy)),
        slope: round(slope),
    };
}

/**
 * Digests the regular files beneath a directory independently of any carrier: the sorted
 * relative paths, sizes, and SHA-256 contents. Directories and symbolic links are ignored, so
 * this is a content check for benchmark worlds, not a manifest.
 *
 * @param root - Directory to digest.
 * @returns `sha256:<hex>`.
 * @throws {Error} If the directory cannot be read.
 */
export function digestTree(root: string): string {
    const hash = createHash("sha256");
    const files = readdirSync(root, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => path.relative(root, path.join(entry.parentPath, entry.name)))
        .sort();
    for (const relative of files) {
        const bytes = readFileSync(path.join(root, relative));
        hash.update(`${relative}\0${bytes.length}\0`);
        hash.update(createHash("sha256").update(bytes).digest());
    }
    return `sha256:${hash.digest("hex")}`;
}

/**
 * Repository-relative path of the result artifact for one host class.
 *
 * @param configuration - Validated benchmark procedure.
 * @param hostClass - Host class identifier.
 * @returns Relative artifact path.
 */
export function scopeResultPath(
    configuration: ScopeBenchmarkConfiguration,
    hostClass: string,
): string {
    return path.join(
        configuration.resultDirectory,
        `${configuration.resultPrefix}${hostClass}.json`,
    );
}

function readScopeSlo(value: Record<string, unknown>): ScopeSloConfiguration {
    const hostClasses = requireArray(value.hostClasses, "slo.hostClasses", 1).map(
        (entry, index): HostClass => {
            const where = `slo.hostClasses[${index}]`;
            const hostClass = requireObject(entry, where);
            const match = requireObject(hostClass.match, `${where}.match`);
            const filesystemTypes = requireArray(
                match.filesystemTypes,
                `${where}.match.filesystemTypes`,
                1,
            );
            if (filesystemTypes.some((type) => !Number.isSafeInteger(type))) {
                throw new TypeError(`${where}.match.filesystemTypes must list integers`);
            }
            const budgets = requireObject(hostClass.budgets, `${where}.budgets`);
            return {
                budgets: Object.fromEntries(
                    Object.entries(budgets).map(([metric, budget]) => [
                        metric,
                        readBudget(metric, budget, `${where}.budgets.${metric}`),
                    ]),
                ),
                description: requireString(hostClass.description, `${where}.description`),
                id: requireString(hostClass.id, `${where}.id`),
                match: {
                    arch: requireString(match.arch, `${where}.match.arch`),
                    filesystemTypes: filesystemTypes as number[],
                    platform: requireString(match.platform, `${where}.match.platform`),
                },
            };
        },
    );
    return { budgetPolicy: requireString(value.budgetPolicy, "slo.budgetPolicy"), hostClasses };
}

function readBudget(metric: string, value: unknown, where: string): SloBudget {
    const [family, ...qualifiers] = metric.split("/");
    if (
        !Object.hasOwn(SCOPE_METRIC_FAMILIES, family as string) ||
        qualifiers.length === 0 ||
        qualifiers.some((qualifier) => qualifier === "")
    ) {
        throw new TypeError(`${where} names an unknown metric`);
    }
    const budget = requireObject(value, where);
    const statistic = budget.statistic;
    if (statistic !== "median" && statistic !== "p95") {
        throw new TypeError(`${where}.statistic must be median or p95`);
    }
    const limit = budget.max;
    if (
        typeof limit !== "number" ||
        !Number.isFinite(limit) ||
        limit <= 0 ||
        Object.keys(budget).some((key) => key !== "statistic" && key !== "max")
    ) {
        throw new TypeError(`${where} must set only a positive max`);
    }
    return { max: limit, statistic };
}

function requireObject(value: unknown, where: string): Record<string, unknown> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new TypeError(`${where} must be an object`);
    }
    return value as Record<string, unknown>;
}

function requireArray(value: unknown, where: string, minimumLength: number): unknown[] {
    if (!Array.isArray(value) || value.length < minimumLength) {
        throw new TypeError(`${where} must be an array of at least ${minimumLength} entries`);
    }
    return value;
}

function requireCounts(
    value: unknown,
    where: string,
    minimum: number,
    minimumLength: number,
): number[] {
    const entries = requireArray(value, where, minimumLength).map((entry, index) =>
        requireCount(entry, `${where}[${index}]`, minimum),
    );
    if (new Set(entries).size !== entries.length) {
        throw new TypeError(`${where} must not repeat a value`);
    }
    return entries;
}

function requireString(value: unknown, where: string): string {
    if (typeof value !== "string" || value === "") {
        throw new TypeError(`${where} must be a non-empty string`);
    }
    return value;
}

function requireCount(value: unknown, where: string, minimum: number): number {
    if (!Number.isSafeInteger(value) || (value as number) < minimum) {
        throw new TypeError(`${where} must be an integer of at least ${minimum}`);
    }
    return value as number;
}

function round(value: number): number {
    return Math.round(value * 1_000) / 1_000;
}
