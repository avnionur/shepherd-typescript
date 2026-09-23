import assert from "node:assert/strict";
import { mkdirSync, readFileSync, realpathSync, statfsSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";
import { fileURLToPath } from "node:url";

import { SQLiteTraceStore } from "../../src/index.ts";
import {
    benchKernel,
    benchmarkResultPath,
    checkSlo,
    detectHostClass,
    digestBenchmarkConfiguration,
    evaluateSlo,
    type HostClass,
    KERNEL_METRICS,
    type KernelBenchmarkResult,
    readKernelBenchmarkConfiguration,
    readPerformanceSloConfiguration,
    renderSloEvaluation,
    runKernelBenchmark,
    summarizeSamples,
} from "../../tooling/benchmark/kernel-benchmark.ts";
import { buildKernelDataset } from "../../tooling/benchmark/kernel-dataset.ts";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const productionBenchmark = path.join(repositoryRoot, "config/kernel-benchmark.config.json");
const productionSlo = path.join(repositoryRoot, "config/performance-slo.config.json");

const tinyBenchmark = {
    appendThroughputAppends: 2,
    cliStartup: { arguments: ["--help"], entry: "cli.mjs" },
    dataset: {
        batchRecords: 3,
        blobBytes: 16,
        blobs: 2,
        cutsPerOwner: 1,
        deepChainRecords: 5,
        orphanBlobs: 1,
        owners: 2,
        recordsPerOwner: 4,
        temporaryFiles: 1,
    },
    naming: { prefix: "tiny:", recordPaddingCharacters: 4, schemaRef: "example.tiny.v1" },
    resultDirectory: "results",
    resultFormat: "shepherd.kernel-benchmark",
    resultFormatVersion: 1,
    sampleCount: 2,
    temporaryDirectoryPrefix: "shepherd-kernel-bench-test-",
    warmupIterations: 1,
};

function hostMatch(): HostClass["match"] {
    return {
        arch: process.arch,
        filesystemTypes: [statfsSync(tmpdir()).type],
        platform: process.platform,
    };
}

function sloWith(match: HostClass["match"], budgets: Record<string, unknown>): object {
    return {
        budgetPolicy: "test budgets",
        hostClasses: [{ budgets, description: "test host", id: "test-host", match }],
    };
}

const generousBudgets = Object.fromEntries(
    Object.entries(KERNEL_METRICS).map(([metric, { better }]) => [
        metric,
        better === "lower"
            ? { max: 1_000_000, statistic: "p95" }
            : { min: 0.000_001, statistic: "median" },
    ]),
);

async function scratchRepository(
    context: TestContext,
    options: { readonly cliExit?: number; readonly slo: object },
): Promise<{
    readonly io: { readonly text: () => string; readonly write: (text: string) => void };
    readonly paths: {
        readonly benchmarkConfiguration: string;
        readonly repositoryRoot: string;
        readonly sloConfiguration: string;
    };
}> {
    const root = realpathSync(await mkdtemp(path.join(tmpdir(), "shepherd-bench-repo-")));
    context.after(() => rm(root, { force: true, recursive: true }));
    writeFileSync(path.join(root, "package.json"), JSON.stringify({ version: "0.0.0-test" }));
    writeFileSync(
        path.join(root, "cli.mjs"),
        `process.stderr.write("probe"); process.exit(${options.cliExit ?? 0});\n`,
    );
    writeFileSync(path.join(root, "benchmark.json"), JSON.stringify(tinyBenchmark));
    writeFileSync(path.join(root, "slo.json"), JSON.stringify(options.slo));
    const output: string[] = [];
    return {
        io: { text: () => output.join(""), write: (text) => output.push(text) },
        paths: {
            benchmarkConfiguration: path.join(root, "benchmark.json"),
            repositoryRoot: root,
            sloConfiguration: path.join(root, "slo.json"),
        },
    };
}

async function writeJson(context: TestContext, value: unknown): Promise<string> {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-bench-config-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const file = path.join(directory, "config.json");
    writeFileSync(file, JSON.stringify(value));
    return file;
}

test("production benchmark and SLO configurations are valid and budget every metric", () => {
    const configuration = readKernelBenchmarkConfiguration(productionBenchmark);
    const slo = readPerformanceSloConfiguration(productionSlo);
    assert.equal(new Set(slo.hostClasses.map(({ id }) => id)).size, slo.hostClasses.length);
    for (const hostClass of slo.hostClasses) {
        assert.deepEqual(Object.keys(hostClass.budgets).sort(), Object.keys(KERNEL_METRICS).sort());
        const committed = JSON.parse(
            readFileSync(
                path.join(repositoryRoot, benchmarkResultPath(configuration, hostClass.id)),
                "utf8",
            ),
        ) as KernelBenchmarkResult;
        assert.equal(committed.configuration_digest, digestBenchmarkConfiguration(configuration));
        assert.equal(committed.host_class, hostClass.id);
        assert.equal(detectHostClass(slo, committed.environment)?.id, hostClass.id);
        assert.deepEqual(Object.keys(committed.metrics).sort(), Object.keys(KERNEL_METRICS).sort());
        for (const metric of Object.values(committed.metrics)) {
            assert.equal(metric.samples.length, configuration.sampleCount);
            assert.deepEqual(metric.summary, summarizeSamples(metric.samples));
        }
    }
});

test("sample summaries report median, nearest-rank p95, and sample variance", () => {
    assert.throws(() => summarizeSamples([]), RangeError);
    assert.deepEqual(summarizeSamples([4]), {
        count: 1,
        max: 4,
        mean: 4,
        median: 4,
        min: 4,
        p95: 4,
        stddev: 0,
        variance: 0,
    });
    assert.deepEqual(summarizeSamples([3, 1, 2]).median, 2);
    const even = summarizeSamples([4, 1, 3, 2]);
    assert.equal(even.median, 2.5);
    assert.equal(even.p95, 4);
    assert.equal(even.variance, 1.667);
    const twenty = summarizeSamples(Array.from({ length: 20 }, (_, index) => index + 1));
    assert.equal(twenty.p95, 19);
});

test("benchmark configuration validation rejects malformed fields", async (context) => {
    for (const [field, value] of [
        ["cliStartup", null],
        ["cliStartup", { arguments: "--help", entry: "cli.mjs" }],
        ["cliStartup", { arguments: [1], entry: "cli.mjs" }],
        ["cliStartup", { arguments: [], entry: "" }],
        ["dataset", []],
        ["sampleCount", 0],
        ["warmupIterations", -1],
        ["resultFormat", 7],
    ] as const) {
        const file = await writeJson(context, { ...tinyBenchmark, [field]: value });
        assert.throws(() => readKernelBenchmarkConfiguration(file), TypeError, field);
    }
});

test("SLO configuration validation rejects unknown metrics and wrong bounds", async (context) => {
    const match = hostMatch();
    const invalid: readonly object[] = [
        { budgetPolicy: "p", hostClasses: [] },
        { budgetPolicy: "p", hostClasses: "none" },
        sloWith({ ...match, filesystemTypes: [] }, {}),
        sloWith({ ...match, filesystemTypes: ["apfs"] as unknown as number[] }, {}),
        sloWith(match, { unknown_metric: { max: 1, statistic: "p95" } }),
        sloWith(match, { export_ms: 5 }),
        sloWith(match, { export_ms: { max: 1, statistic: "mean" } }),
        sloWith(match, { export_ms: { min: 1, statistic: "p95" } }),
        sloWith(match, { export_ms: { max: 1, min: 0.5, statistic: "p95" } }),
        sloWith(match, { export_ms: { max: 0, statistic: "p95" } }),
        sloWith(match, { append_throughput_records_per_second: { max: 1, statistic: "median" } }),
    ];
    for (const value of invalid) {
        const file = await writeJson(context, value);
        assert.throws(
            () => readPerformanceSloConfiguration(file),
            TypeError,
            JSON.stringify(value),
        );
    }
});

test("host classes match platform, architecture, and filesystem type", async (context) => {
    const slo = readPerformanceSloConfiguration(await writeJson(context, sloWith(hostMatch(), {})));
    const environment = {
        arch: process.arch,
        filesystem_type: statfsSync(tmpdir()).type,
        platform: process.platform,
    };
    assert.equal(detectHostClass(slo, environment)?.id, "test-host");
    assert.equal(detectHostClass(slo, { ...environment, arch: "other" }), undefined);
    assert.equal(detectHostClass(slo, { ...environment, filesystem_type: -1 }), undefined);
    assert.equal(detectHostClass(slo, { ...environment, platform: "other" }), undefined);
});

test("SLO evaluation bounds each statistic in its improving direction", () => {
    const hostClass: HostClass = {
        budgets: {
            append_throughput_records_per_second: { min: 100, statistic: "median" },
            export_ms: { max: 10, statistic: "p95" },
            verify_ms: { max: 10, statistic: "p95" },
        },
        description: "test",
        id: "test-host",
        match: hostMatch(),
    };
    const metric = (value: number) => ({
        ...KERNEL_METRICS.export_ms,
        samples: [value],
        summary: summarizeSamples([value]),
    });
    const passing = evaluateSlo(
        {
            metrics: {
                append_throughput_records_per_second: metric(100),
                export_ms: metric(10),
                verify_ms: metric(1),
            },
        },
        hostClass,
    );
    assert.equal(passing.ok, true);
    assert.match(renderSloEvaluation(passing), /^SLO host class: test-host\n.*SLO: pass\n$/su);
    const failing = evaluateSlo(
        { metrics: { append_throughput_records_per_second: metric(99), export_ms: metric(11) } },
        hostClass,
    );
    assert.equal(failing.ok, false);
    assert.deepEqual(
        failing.checks.map(({ ok, value }) => [ok, value]),
        [
            [false, 99],
            [false, 11],
            [false, null],
        ],
    );
    assert.match(renderSloEvaluation(failing), /FAIL verify_ms p95=missing <= 10\nSLO: FAIL\n$/u);
});

test("the dataset builder rejects malformed shapes and supports cut-free paths", async (context) => {
    const directory = realpathSync(await mkdtemp(path.join(tmpdir(), "shepherd-dataset-")));
    context.after(() => rm(directory, { force: true, recursive: true }));
    using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"), {
        blobDirectory: path.join(directory, "blobs"),
    });
    const blobDirectory = path.join(directory, "blobs");
    assert.throws(
        () =>
            buildKernelDataset(
                store,
                blobDirectory,
                { ...tinyBenchmark.dataset, owners: -1 },
                tinyBenchmark.naming,
            ),
        RangeError,
    );
    assert.throws(
        () =>
            buildKernelDataset(
                store,
                blobDirectory,
                { ...tinyBenchmark.dataset, batchRecords: 0 },
                tinyBenchmark.naming,
            ),
        RangeError,
    );
    const dataset = buildKernelDataset(
        store,
        blobDirectory,
        { ...tinyBenchmark.dataset, cutsPerOwner: 0 },
        tinyBenchmark.naming,
    );
    assert.deepEqual(dataset.cutIds, []);
    assert.equal(dataset.recordCount, 13);
    assert.equal(store.verifyIntegrity().ok, true);
    assert.deepEqual(store.collectBlobOrphans().orphan_blob_ids, dataset.orphanBlobIds);
});

test("bench:kernel writes a host-class artifact that check:slo accepts", async (context) => {
    const repository = await scratchRepository(context, {
        slo: sloWith(hostMatch(), generousBudgets),
    });
    assert.equal(await checkSlo(repository.paths, repository.io), false);
    assert.match(repository.io.text(), /results\/test-host\.json is missing/u);

    const written = await benchKernel(
        repository.paths,
        repository.io,
        new Date("2026-01-02T03:04:05Z"),
    );
    assert.equal(written, path.join("results", "test-host.json"));
    const result = JSON.parse(
        readFileSync(path.join(repository.paths.repositoryRoot, written as string), "utf8"),
    ) as KernelBenchmarkResult;
    assert.equal(result.recorded_on, "2026-01-02");
    assert.equal(result.environment.package_version, "0.0.0-test");
    assert.equal(result.host_class, "test-host");
    for (const [name, metric] of Object.entries(result.metrics)) {
        assert.equal(metric.samples.length, tinyBenchmark.sampleCount, name);
    }
    assert.equal(await checkSlo(repository.paths, repository.io), true);
    assert.match(repository.io.text(), /SLO: pass\n$/u);

    writeFileSync(
        path.join(repository.paths.repositoryRoot, written as string),
        JSON.stringify({ ...result, configuration_digest: "sha256:stale" }),
    );
    assert.equal(await checkSlo(repository.paths, repository.io), false);
    assert.match(repository.io.text(), /different benchmark configuration/u);
});

test("check:slo fails a budget and skips a host without budgets", async (context) => {
    const tight = await scratchRepository(context, {
        slo: sloWith(hostMatch(), {
            ...generousBudgets,
            verify_ms: { max: 0.000_001, statistic: "p95" },
        }),
    });
    assert.notEqual(await benchKernel(tight.paths, tight.io), null);
    assert.equal(await checkSlo(tight.paths, tight.io), false);
    assert.match(tight.io.text(), /FAIL verify_ms/u);

    const other = await scratchRepository(context, {
        slo: sloWith({ ...hostMatch(), platform: "no-such-platform" }, {}),
    });
    assert.equal(await benchKernel(other.paths, other.io), null);
    assert.match(other.io.text(), /no SLO host class matches this host/iu);
    mkdirSync(path.join(other.paths.repositoryRoot, "results"));
    assert.equal(await checkSlo(other.paths, other.io), true);
    assert.match(other.io.text(), /SLO: skipped/u);
});

test("a failing CLI startup probe fails the benchmark", async (context) => {
    const repository = await scratchRepository(context, {
        cliExit: 1,
        slo: sloWith(hostMatch(), {}),
    });
    await assert.rejects(
        runKernelBenchmark(
            readKernelBenchmarkConfiguration(repository.paths.benchmarkConfiguration),
            {
                repositoryRoot: repository.paths.repositoryRoot,
                slo: readPerformanceSloConfiguration(repository.paths.sloConfiguration),
            },
        ),
        /CLI startup probe exited with 1: probe/u,
    );
});
