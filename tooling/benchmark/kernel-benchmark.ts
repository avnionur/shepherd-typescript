import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statfsSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { openTraceSubscription, ROOT_WITNESS_ID, SQLiteTraceStore } from "../../src/index.ts";
import {
    buildKernelDataset,
    type KernelDatasetNaming,
    type KernelDatasetShape,
} from "./kernel-dataset.ts";

/** Whether a smaller or a larger measured value is better. */
export type MetricDirection = "higher" | "lower";

/** Static description of one kernel benchmark metric. */
export type KernelMetricDefinition = {
    /** Direction in which the metric improves. */
    readonly better: MetricDirection;
    /** What one sample measures. */
    readonly description: string;
    /** Unit of every sample. */
    readonly unit: string;
};

/** Metrics measured by `runKernelBenchmark`, keyed by stable metric name. */
export const KERNEL_METRICS = Object.freeze({
    append_latency_ms: {
        better: "lower",
        description: "one single-record append committed with synchronous FULL durability",
        unit: "ms",
    },
    append_throughput_records_per_second: {
        better: "higher",
        description: "sequential single-record appends per second over one sample batch",
        unit: "records/s",
    },
    cli_startup_ms: {
        better: "lower",
        description: "wall time of one packaged CLI process printing its help",
        unit: "ms",
    },
    cut_resolve_ms: {
        better: "lower",
        description: "resolveCut of the deep-chain owner's last published cut",
        unit: "ms",
    },
    export_ms: {
        better: "lower",
        description: "exportTrace of the whole dataset",
        unit: "ms",
    },
    gc_inspect_ms: {
        better: "lower",
        description: "collectBlobOrphans inspection, including registered-blob verification",
        unit: "ms",
    },
    import_ms: {
        better: "lower",
        description: "importTrace of the dataset archive into a fresh file store",
        unit: "ms",
    },
    slice_read_ms: {
        better: "lower",
        description: "readOwnerPrefix of one whole regular owner path",
        unit: "ms",
    },
    subscription_pull_ms: {
        better: "lower",
        description: "ephemeral subscription pulling one whole regular owner path from origin",
        unit: "ms",
    },
    verify_ms: {
        better: "lower",
        description: "verifyIntegrity of the whole store",
        unit: "ms",
    },
} as const satisfies Readonly<Record<string, KernelMetricDefinition>>);

/** Stable name of one kernel benchmark metric. */
export type KernelMetricName = keyof typeof KERNEL_METRICS;

/** Validated `config/kernel-benchmark.config.json`. */
export type KernelBenchmarkConfiguration = {
    /** Appends per append-throughput sample. */
    readonly appendThroughputAppends: number;
    /** CLI entry, relative to the repository root, and arguments timed by `cli_startup_ms`. */
    readonly cliStartup: { readonly arguments: readonly string[]; readonly entry: string };
    /** Synthetic dataset measured by every store metric. */
    readonly dataset: KernelDatasetShape;
    /** Identity prefix, schema, and record padding of the dataset. */
    readonly naming: KernelDatasetNaming;
    /** Repository-relative directory of committed result artifacts. */
    readonly resultDirectory: string;
    /** Result artifact format identity. */
    readonly resultFormat: string;
    /** Result artifact format version. */
    readonly resultFormatVersion: number;
    /** Recorded samples per metric. */
    readonly sampleCount: number;
    /** Prefix of the scratch directory created under the host temporary directory. */
    readonly temporaryDirectoryPrefix: string;
    /** Unrecorded iterations per metric before sampling. */
    readonly warmupIterations: number;
};

/** One budget on one statistic of one metric. */
export type SloBudget = {
    /** Inclusive upper bound, for metrics where lower is better. */
    readonly max?: number;
    /** Inclusive lower bound, for metrics where higher is better. */
    readonly min?: number;
    /** Summary statistic the bound applies to. */
    readonly statistic: "median" | "p95";
};

/** Host class whose measured performance the SLO budgets describe. */
export type HostClass = {
    /** Budgets keyed by metric name. */
    readonly budgets: Readonly<Record<string, SloBudget>>;
    /** Human description of the class. */
    readonly description: string;
    /** Stable identifier, also the result artifact file name. */
    readonly id: string;
    /** Host properties that select this class. */
    readonly match: {
        readonly arch: string;
        /** `statfs` filesystem type numbers of the benchmark temporary directory. */
        readonly filesystemTypes: readonly number[];
        readonly platform: string;
    };
};

/** Validated `config/performance-slo.config.json`. */
export type PerformanceSloConfiguration = {
    /** How budgets were derived from measured results. */
    readonly budgetPolicy: string;
    /** Host classes with budgets. */
    readonly hostClasses: readonly HostClass[];
};

/** Summary statistics of one metric's recorded samples. */
export type SampleSummary = {
    readonly count: number;
    readonly max: number;
    readonly mean: number;
    readonly median: number;
    readonly min: number;
    /** Nearest-rank 95th percentile. */
    readonly p95: number;
    /** Sample standard deviation. */
    readonly stddev: number;
    /** Sample variance (n - 1 denominator; zero for one sample). */
    readonly variance: number;
};

/** Host facts recorded with every result. */
export type BenchmarkEnvironment = {
    readonly arch: string;
    readonly cpu_count: number;
    readonly cpu_model: string;
    readonly filesystem_type: number;
    readonly node: string;
    readonly os_release: string;
    readonly package_version: string;
    readonly platform: string;
    readonly sqlite_version: string;
    readonly total_memory_bytes: number;
};

/** One measured metric. */
export type MetricResult = KernelMetricDefinition & {
    /** Recorded samples in measurement order. */
    readonly samples: readonly number[];
    readonly summary: SampleSummary;
};

/** One SLO comparison. */
export type SloCheck = {
    readonly bound: "max" | "min";
    readonly budget: number;
    readonly metric: string;
    readonly ok: boolean;
    readonly statistic: SloBudget["statistic"];
    /** Measured statistic, or null when the metric was not measured. */
    readonly value: number | null;
};

/** SLO evaluation of one result against one host class. */
export type SloEvaluation = {
    readonly checks: readonly SloCheck[];
    readonly host_class: string;
    readonly ok: boolean;
};

/** Complete kernel benchmark result artifact. */
export type KernelBenchmarkResult = {
    readonly configuration: KernelBenchmarkConfiguration;
    /** Digest of the canonical benchmark configuration. */
    readonly configuration_digest: string;
    readonly environment: BenchmarkEnvironment;
    readonly format: string;
    readonly format_version: number;
    /** Matched host class, or null for a host without budgets. */
    readonly host_class: string | null;
    readonly metrics: Readonly<Record<string, MetricResult>>;
    /** Date the benchmark ran, as an ISO-8601 day. */
    readonly recorded_on: string;
    readonly warmup_iterations: number;
};

/**
 * Reads and validates the kernel benchmark configuration.
 *
 * @param file - Configuration JSON path.
 * @returns The validated configuration.
 * @throws {TypeError} If a field is missing or malformed.
 */
export function readKernelBenchmarkConfiguration(file: string): KernelBenchmarkConfiguration {
    const value = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    const cliStartup = requireObject(value.cliStartup, "cliStartup");
    const dataset = requireObject(value.dataset, "dataset");
    const naming = requireObject(value.naming, "naming");
    const cliArguments = cliStartup.arguments;
    if (!Array.isArray(cliArguments) || cliArguments.some((entry) => typeof entry !== "string")) {
        throw new TypeError("cliStartup.arguments must be an array of strings");
    }
    return {
        appendThroughputAppends: requireCount(
            value.appendThroughputAppends,
            "appendThroughputAppends",
            1,
        ),
        cliStartup: {
            arguments: cliArguments as string[],
            entry: requireString(cliStartup.entry, "cliStartup.entry"),
        },
        dataset: {
            batchRecords: requireCount(dataset.batchRecords, "dataset.batchRecords", 1),
            blobBytes: requireCount(dataset.blobBytes, "dataset.blobBytes", 1),
            blobs: requireCount(dataset.blobs, "dataset.blobs", 1),
            cutsPerOwner: requireCount(dataset.cutsPerOwner, "dataset.cutsPerOwner", 1),
            deepChainRecords: requireCount(dataset.deepChainRecords, "dataset.deepChainRecords", 1),
            orphanBlobs: requireCount(dataset.orphanBlobs, "dataset.orphanBlobs", 0),
            owners: requireCount(dataset.owners, "dataset.owners", 1),
            recordsPerOwner: requireCount(dataset.recordsPerOwner, "dataset.recordsPerOwner", 1),
            temporaryFiles: requireCount(dataset.temporaryFiles, "dataset.temporaryFiles", 0),
        },
        naming: {
            prefix: requireString(naming.prefix, "naming.prefix"),
            recordPaddingCharacters: requireCount(
                naming.recordPaddingCharacters,
                "naming.recordPaddingCharacters",
                0,
            ),
            schemaRef: requireString(naming.schemaRef, "naming.schemaRef"),
        },
        resultDirectory: requireString(value.resultDirectory, "resultDirectory"),
        resultFormat: requireString(value.resultFormat, "resultFormat"),
        resultFormatVersion: requireCount(value.resultFormatVersion, "resultFormatVersion", 1),
        sampleCount: requireCount(value.sampleCount, "sampleCount", 1),
        temporaryDirectoryPrefix: requireString(
            value.temporaryDirectoryPrefix,
            "temporaryDirectoryPrefix",
        ),
        warmupIterations: requireCount(value.warmupIterations, "warmupIterations", 0),
    };
}

/**
 * Reads and validates the SLO configuration; every budget must name a measured metric and bound
 * it in the metric's improving direction.
 *
 * @param file - Configuration JSON path.
 * @returns The validated configuration.
 * @throws {TypeError} If a field is missing, malformed, or bounds a metric the wrong way.
 */
export function readPerformanceSloConfiguration(file: string): PerformanceSloConfiguration {
    const value = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    if (!Array.isArray(value.hostClasses) || value.hostClasses.length === 0) {
        throw new TypeError("hostClasses must be a non-empty array");
    }
    const hostClasses = value.hostClasses.map((entry: unknown, index): HostClass => {
        const hostClass = requireObject(entry, `hostClasses[${index}]`);
        const match = requireObject(hostClass.match, `hostClasses[${index}].match`);
        const filesystemTypes = match.filesystemTypes;
        if (
            !Array.isArray(filesystemTypes) ||
            filesystemTypes.length === 0 ||
            filesystemTypes.some((type) => !Number.isSafeInteger(type))
        ) {
            throw new TypeError(`hostClasses[${index}].match.filesystemTypes must list integers`);
        }
        const budgets = requireObject(hostClass.budgets, `hostClasses[${index}].budgets`);
        return {
            budgets: Object.fromEntries(
                Object.entries(budgets).map(([metric, budget]) => [
                    metric,
                    readBudget(metric, budget, `hostClasses[${index}].budgets.${metric}`),
                ]),
            ),
            description: requireString(hostClass.description, `hostClasses[${index}].description`),
            id: requireString(hostClass.id, `hostClasses[${index}].id`),
            match: {
                arch: requireString(match.arch, `hostClasses[${index}].match.arch`),
                filesystemTypes: filesystemTypes as number[],
                platform: requireString(match.platform, `hostClasses[${index}].match.platform`),
            },
        };
    });
    return { budgetPolicy: requireString(value.budgetPolicy, "budgetPolicy"), hostClasses };
}

/**
 * Selects the host class whose platform, architecture, and filesystem type match.
 *
 * @param configuration - Validated SLO configuration.
 * @param environment - Measured host facts.
 * @returns The matching host class, or undefined for a host without budgets.
 */
export function detectHostClass(
    configuration: PerformanceSloConfiguration,
    environment: Pick<BenchmarkEnvironment, "arch" | "filesystem_type" | "platform">,
): HostClass | undefined {
    return configuration.hostClasses.find(
        ({ match }) =>
            match.platform === environment.platform &&
            match.arch === environment.arch &&
            match.filesystemTypes.includes(environment.filesystem_type),
    );
}

/**
 * Summarizes recorded samples.
 *
 * @param samples - Non-empty recorded samples.
 * @returns Count, extremes, mean, median, nearest-rank p95, sample variance, and deviation.
 * @throws {RangeError} If no sample was recorded.
 */
export function summarizeSamples(samples: readonly number[]): SampleSummary {
    if (samples.length === 0) throw new RangeError("a metric needs at least one sample");
    const sorted = [...samples].sort((left, right) => left - right);
    const count = sorted.length;
    const mean = sorted.reduce((total, sample) => total + sample, 0) / count;
    const middle = Math.floor(count / 2);
    const median =
        count % 2 === 1
            ? (sorted[middle] as number)
            : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
    const variance =
        count === 1
            ? 0
            : sorted.reduce((total, sample) => total + (sample - mean) ** 2, 0) / (count - 1);
    return {
        count,
        max: round(sorted[count - 1] as number),
        mean: round(mean),
        median: round(median),
        min: round(sorted[0] as number),
        p95: round(sorted[Math.ceil(0.95 * count) - 1] as number),
        stddev: round(Math.sqrt(variance)),
        variance: round(variance),
    };
}

/**
 * Compares a result with the budgets of one host class. A budgeted metric missing from the
 * result fails.
 *
 * @param result - Measured metrics.
 * @param hostClass - Host class whose budgets apply.
 * @returns Every comparison and whether all passed.
 */
export function evaluateSlo(
    result: Pick<KernelBenchmarkResult, "metrics">,
    hostClass: HostClass,
): SloEvaluation {
    const checks = Object.entries(hostClass.budgets)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([metric, budget]): SloCheck => {
            const value = result.metrics[metric]?.summary[budget.statistic] ?? null;
            const bound = budget.max === undefined ? "min" : "max";
            const limit = (budget.max ?? budget.min) as number;
            const ok = value !== null && (bound === "max" ? value <= limit : value >= limit);
            return { bound, budget: limit, metric, ok, statistic: budget.statistic, value };
        });
    return {
        checks,
        host_class: hostClass.id,
        ok: checks.every(({ ok }) => ok),
    };
}

/**
 * Renders an evaluation as one line per comparison.
 *
 * @param evaluation - SLO evaluation.
 * @returns Human-readable report text ending with a newline.
 */
export function renderSloEvaluation(evaluation: SloEvaluation): string {
    const lines = evaluation.checks.map(
        ({ bound, budget, metric, ok, statistic, value }) =>
            `${ok ? "pass" : "FAIL"} ${metric} ${statistic}=${value ?? "missing"} ${bound === "max" ? "<=" : ">="} ${budget}`,
    );
    return `${[`SLO host class: ${evaluation.host_class}`, ...lines, evaluation.ok ? "SLO: pass" : "SLO: FAIL"].join("\n")}\n`;
}

/**
 * Digests the canonical benchmark configuration so a result names the exact procedure.
 *
 * @param configuration - Validated benchmark configuration (kernel, scope, or any JSON value).
 * @returns `sha256:<hex>` over the key-sorted JSON.
 */
export function digestBenchmarkConfiguration(configuration: object): string {
    return `sha256:${createHash("sha256")
        .update(JSON.stringify(sortKeys(configuration)))
        .digest("hex")}`;
}

/** Options of one benchmark run. */
export type KernelBenchmarkRunOptions = {
    /** Repository root that the CLI entry and package manifest resolve against. */
    readonly repositoryRoot: string;
    /** SLO configuration used to name the host class. */
    readonly slo: PerformanceSloConfiguration;
    /** Clock for `recorded_on`; defaults to the current time. */
    readonly now?: Date;
};

/**
 * Measures every kernel metric on one freshly built dataset in a scratch directory that is
 * removed afterwards.
 *
 * @param configuration - Validated benchmark configuration.
 * @param options - Repository root, SLO configuration, and clock.
 * @returns The complete result artifact.
 * @throws {Error} If a workload fails, including a CLI process exiting non-zero.
 */
export async function runKernelBenchmark(
    configuration: KernelBenchmarkConfiguration,
    options: KernelBenchmarkRunOptions,
): Promise<KernelBenchmarkResult> {
    const root = mkdtempSync(path.join(os.tmpdir(), configuration.temporaryDirectoryPrefix));
    try {
        const environment = readBenchmarkEnvironment(root, options.repositoryRoot);
        const metrics = await measure(configuration, root, options.repositoryRoot);
        return {
            configuration,
            configuration_digest: digestBenchmarkConfiguration(configuration),
            environment,
            format: configuration.resultFormat,
            format_version: configuration.resultFormatVersion,
            host_class: detectHostClass(options.slo, environment)?.id ?? null,
            metrics,
            recorded_on: (options.now ?? new Date()).toISOString().slice(0, 10),
            warmup_iterations: configuration.warmupIterations,
        };
    } finally {
        rmSync(root, { force: true, recursive: true });
    }
}

/**
 * Repository-relative path of the committed result artifact for one host class.
 *
 * @param configuration - Validated benchmark configuration.
 * @param hostClass - Host class identifier.
 * @returns Relative artifact path.
 */
export function benchmarkResultPath(
    configuration: KernelBenchmarkConfiguration,
    hostClass: string,
): string {
    return path.join(configuration.resultDirectory, `${hostClass}.json`);
}

/** Output sink of the benchmark command functions. */
export type BenchmarkCommandIo = {
    /** Writes human-readable progress and results. */
    readonly write: (text: string) => void;
};

/** Paths used by the benchmark command functions. */
export type BenchmarkCommandPaths = {
    readonly benchmarkConfiguration: string;
    readonly repositoryRoot: string;
    readonly sloConfiguration: string;
};

/**
 * `pnpm bench:kernel`: measures, writes the result artifact for the matched host class (or
 * prints it for a host without budgets), and reports the SLO evaluation without failing on it.
 *
 * @param paths - Configuration files and repository root.
 * @param io - Output sink.
 * @param now - Clock for `recorded_on`.
 * @returns The written artifact path, or null for a host without budgets.
 */
export async function benchKernel(
    paths: BenchmarkCommandPaths,
    io: BenchmarkCommandIo,
    now?: Date,
): Promise<string | null> {
    const configuration = readKernelBenchmarkConfiguration(paths.benchmarkConfiguration);
    const slo = readPerformanceSloConfiguration(paths.sloConfiguration);
    const result = await runKernelBenchmark(configuration, {
        repositoryRoot: paths.repositoryRoot,
        slo,
        ...(now === undefined ? {} : { now }),
    });
    const text = `${JSON.stringify(result, null, 4)}\n`;
    const hostClass = slo.hostClasses.find(({ id }) => id === result.host_class);
    if (hostClass === undefined) {
        io.write(text);
        io.write("No SLO host class matches this host; the result was not written.\n");
        return null;
    }
    const relative = benchmarkResultPath(configuration, hostClass.id);
    mkdirSync(path.join(paths.repositoryRoot, configuration.resultDirectory), { recursive: true });
    writeFileSync(path.join(paths.repositoryRoot, relative), text);
    io.write(`Wrote ${relative}\n`);
    io.write(renderSloEvaluation(evaluateSlo(result, hostClass)));
    return relative;
}

/**
 * `pnpm check:slo`: requires the committed artifact of the matched host class to record the
 * current benchmark configuration, then measures afresh and evaluates the budgets. A host
 * without budgets is reported and skipped.
 *
 * @param paths - Configuration files and repository root.
 * @param io - Output sink.
 * @returns Whether the check passed or was skipped for an unbudgeted host.
 */
export async function checkSlo(
    paths: BenchmarkCommandPaths,
    io: BenchmarkCommandIo,
): Promise<boolean> {
    const configuration = readKernelBenchmarkConfiguration(paths.benchmarkConfiguration);
    const slo = readPerformanceSloConfiguration(paths.sloConfiguration);
    const result = await runKernelBenchmark(configuration, {
        repositoryRoot: paths.repositoryRoot,
        slo,
    });
    const hostClass = slo.hostClasses.find(({ id }) => id === result.host_class);
    if (hostClass === undefined) {
        io.write(
            `SLO: skipped; no host class matches ${result.environment.platform}/${result.environment.arch} filesystem type ${result.environment.filesystem_type}\n`,
        );
        return true;
    }
    const relative = benchmarkResultPath(configuration, hostClass.id);
    let committed: KernelBenchmarkResult | undefined;
    try {
        committed = JSON.parse(
            readFileSync(path.join(paths.repositoryRoot, relative), "utf8"),
        ) as KernelBenchmarkResult;
    } catch {
        committed = undefined;
    }
    if (committed?.configuration_digest !== result.configuration_digest) {
        io.write(
            `SLO: FAIL; ${relative} is missing or was measured with a different benchmark configuration; run pnpm bench:kernel\n`,
        );
        return false;
    }
    const evaluation = evaluateSlo(result, hostClass);
    io.write(renderSloEvaluation(evaluation));
    return evaluation.ok;
}

async function measure(
    configuration: KernelBenchmarkConfiguration,
    root: string,
    repositoryRoot: string,
): Promise<Record<string, MetricResult>> {
    const blobDirectory = path.join(root, "blobs");
    using store = new SQLiteTraceStore(path.join(root, "trace.sqlite"), { blobDirectory });
    const dataset = buildKernelDataset(
        store,
        blobDirectory,
        configuration.dataset,
        configuration.naming,
    );
    const regularOwner = dataset.ownerIds[0] as string;
    const lastCut = dataset.cutIds.at(-1) as string;
    const archive = store.exportTrace();
    let appendIndex = 0;
    const appendOne = (): void => {
        store.append({
            append_intent_id: `${configuration.naming.prefix}measure:${appendIndex}`,
            batch: {
                groups: [
                    {
                        owner_id: `${configuration.naming.prefix}measure`,
                        records: [
                            {
                                body: { index: appendIndex },
                                mode: "capture",
                                schema_ref: configuration.naming.schemaRef,
                                witness_ref: ROOT_WITNESS_ID,
                            },
                        ],
                    },
                ],
            },
        });
        appendIndex += 1;
    };
    let importIndex = 0;
    const cliEntry = path.join(repositoryRoot, configuration.cliStartup.entry);
    const metrics: Record<string, MetricResult> = {};
    const record = async (
        name: KernelMetricName,
        sample: () => number | Promise<number>,
    ): Promise<void> => {
        for (let index = 0; index < configuration.warmupIterations; index += 1) await sample();
        const samples: number[] = [];
        for (let index = 0; index < configuration.sampleCount; index += 1) {
            samples.push(round(await sample()));
        }
        metrics[name] = { ...KERNEL_METRICS[name], samples, summary: summarizeSamples(samples) };
    };
    await record("append_latency_ms", () => time(appendOne));
    await record("append_throughput_records_per_second", () => {
        const elapsed = time(() => {
            for (let index = 0; index < configuration.appendThroughputAppends; index += 1)
                appendOne();
        });
        return (configuration.appendThroughputAppends * 1_000) / elapsed;
    });
    await record("cut_resolve_ms", () => time(() => store.resolveCut(lastCut)));
    await record("slice_read_ms", () =>
        time(() => store.readOwnerPrefix(regularOwner, configuration.dataset.recordsPerOwner)),
    );
    await record("subscription_pull_ms", async () => {
        const started = performance.now();
        const subscription = openTraceSubscription(store, {
            owners: [regularOwner],
            start: "origin",
        });
        for (let index = 0; index < configuration.dataset.recordsPerOwner; index += 1) {
            await subscription.next();
        }
        subscription.close();
        return performance.now() - started;
    });
    await record("export_ms", () => time(() => store.exportTrace()));
    await record("import_ms", () => {
        const target = new SQLiteTraceStore(path.join(root, `import-${importIndex}.sqlite`));
        importIndex += 1;
        try {
            return time(() => target.importTrace(archive));
        } finally {
            target.close();
        }
    });
    await record("verify_ms", () => time(() => store.verifyIntegrity()));
    await record("gc_inspect_ms", () => time(() => store.collectBlobOrphans()));
    await record("cli_startup_ms", () =>
        time(() => {
            const child = spawnSync(
                process.execPath,
                [cliEntry, ...configuration.cliStartup.arguments],
                {
                    encoding: "utf8",
                },
            );
            if (child.status !== 0) {
                throw new Error(`CLI startup probe exited with ${child.status}: ${child.stderr}`);
            }
        }),
    );
    return metrics;
}

/**
 * Reads the host facts recorded with every benchmark result.
 *
 * @param root - Benchmark scratch directory whose `statfs` type is recorded.
 * @param repositoryRoot - Repository root holding the `package.json` whose version is recorded.
 * @returns Platform, architecture, CPU, memory, filesystem, Node.js, SQLite, and package facts.
 * @throws {Error} If `package.json` cannot be read or the scratch directory does not exist.
 */
export function readBenchmarkEnvironment(
    root: string,
    repositoryRoot: string,
): BenchmarkEnvironment {
    const manifest = JSON.parse(
        readFileSync(path.join(repositoryRoot, "package.json"), "utf8"),
    ) as {
        readonly version: string;
    };
    const database = new DatabaseSync(":memory:");
    const sqliteVersion = String(
        database.prepare("SELECT sqlite_version() AS version").get()?.version,
    );
    database.close();
    const cpus = os.cpus();
    return {
        arch: process.arch,
        cpu_count: cpus.length,
        cpu_model: [...new Set(cpus.map(({ model }) => model))].join(", "),
        filesystem_type: statfsSync(root).type,
        node: process.version,
        os_release: os.release(),
        package_version: manifest.version,
        platform: process.platform,
        sqlite_version: sqliteVersion,
        total_memory_bytes: os.totalmem(),
    };
}

function readBudget(metric: string, value: unknown, where: string): SloBudget {
    const definition = (KERNEL_METRICS as Readonly<Record<string, KernelMetricDefinition>>)[metric];
    if (definition === undefined) throw new TypeError(`${where} names an unknown metric`);
    const budget = requireObject(value, where);
    const statistic = budget.statistic;
    if (statistic !== "median" && statistic !== "p95") {
        throw new TypeError(`${where}.statistic must be median or p95`);
    }
    const bound = definition.better === "lower" ? "max" : "min";
    const limit = budget[bound];
    if (
        typeof limit !== "number" ||
        !Number.isFinite(limit) ||
        limit <= 0 ||
        Object.keys(budget).some((key) => key !== "statistic" && key !== bound)
    ) {
        throw new TypeError(`${where} must set only a positive ${bound} for this metric`);
    }
    return { statistic, [bound]: limit };
}

function requireObject(value: unknown, where: string): Record<string, unknown> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new TypeError(`${where} must be an object`);
    }
    return value as Record<string, unknown>;
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

function sortKeys(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(sortKeys);
    if (value !== null && typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value)
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([key, entry]) => [key, sortKeys(entry)]),
        );
    }
    return value;
}

function time(operation: () => unknown): number {
    const started = performance.now();
    operation();
    return performance.now() - started;
}

function round(value: number): number {
    return Math.round(value * 1_000) / 1_000;
}
