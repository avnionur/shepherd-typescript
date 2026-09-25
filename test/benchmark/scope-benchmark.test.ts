import assert from "node:assert/strict";
import {
    mkdirSync,
    readFileSync,
    realpathSync,
    statfsSync,
    symlinkSync,
    writeFileSync,
} from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";
import { fileURLToPath } from "node:url";

import {
    detectHostClass,
    digestBenchmarkConfiguration,
    summarizeSamples,
} from "../../tooling/benchmark/kernel-benchmark.ts";
import {
    benchScopes,
    checkScopeSlo,
    type ScopeBenchmarkResult,
} from "../../tooling/benchmark/scope-benchmark.ts";
import {
    digestTree,
    fitLine,
    readScopeBenchmarkConfiguration,
    SCOPE_METRIC_FAMILIES,
    scopeMetricName,
    scopeResultPath,
} from "../../tooling/benchmark/scope-benchmark-config.ts";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const productionConfiguration = path.join(repositoryRoot, "config/scope-benchmark.config.json");
const production = JSON.parse(readFileSync(productionConfiguration, "utf8")) as {
    readonly benchmark: Record<string, unknown>;
    readonly slo: Record<string, unknown>;
};

const tinyBenchmark = {
    ...production.benchmark,
    branching: {
        baselineWrites: 1,
        branchCount: 2,
        branchWrites: 1,
        defaultWriteBytes: 64,
        repetitions: 1,
    },
    fork: { repetitions: 1, warmupIterations: 0 },
    mutationSweep: { world: "tiny", writeBytes: [64, 128] },
    observation: { observerCounts: [0, 1], sessionRepetitions: 1, steps: [2] },
    resultDirectory: "results",
    storage: {
        flushCommand: [process.execPath, "--version"],
        settleAttempts: 1,
        settleDelayMilliseconds: 0,
        settleToleranceBytes: Number.MAX_SAFE_INTEGER,
    },
    temporaryDirectoryPrefix: "shepherd-scope-bench-test-",
    worlds: [{ fileBytes: 32, files: 2, id: "tiny" }],
};

function hostMatch(): { arch: string; filesystemTypes: number[]; platform: string } {
    return {
        arch: process.arch,
        filesystemTypes: [statfsSync(tmpdir()).type],
        platform: process.platform,
    };
}

function withSlo(match: object, budgets: Record<string, unknown>): object {
    return {
        benchmark: tinyBenchmark,
        slo: {
            budgetPolicy: "test budgets",
            hostClasses: [{ budgets, description: "test host", id: "test-host", match }],
        },
    };
}

async function writeJson(context: TestContext, value: unknown): Promise<string> {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-scope-bench-config-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const file = path.join(directory, "config.json");
    writeFileSync(file, JSON.stringify(value));
    return file;
}

async function scratchRepository(
    context: TestContext,
    configuration: object,
): Promise<{
    readonly io: { readonly text: () => string; readonly write: (text: string) => void };
    readonly paths: { readonly configuration: string; readonly repositoryRoot: string };
}> {
    const root = realpathSync(await mkdtemp(path.join(tmpdir(), "shepherd-scope-bench-repo-")));
    context.after(() => rm(root, { force: true, recursive: true }));
    writeFileSync(path.join(root, "package.json"), JSON.stringify({ version: "0.0.0-test" }));
    writeFileSync(path.join(root, "scope.json"), JSON.stringify(configuration));
    const output: string[] = [];
    return {
        io: { text: () => output.join(""), write: (text) => output.push(text) },
        paths: { configuration: path.join(root, "scope.json"), repositoryRoot: root },
    };
}

test("production scope benchmark configuration is valid and its artifacts are current", () => {
    const { benchmark, slo } = readScopeBenchmarkConfiguration(productionConfiguration);
    assert.ok(benchmark.worlds.length >= 3);
    assert.ok(Math.max(...benchmark.observation.steps) >= 200);
    assert.ok(benchmark.observation.observerCounts.includes(0));
    assert.ok(benchmark.observation.observerCounts.some((count) => count > 0));
    assert.equal(new Set(slo.hostClasses.map(({ id }) => id)).size, slo.hostClasses.length);
    for (const hostClass of slo.hostClasses) {
        const committed = JSON.parse(
            readFileSync(
                path.join(repositoryRoot, scopeResultPath(benchmark, hostClass.id)),
                "utf8",
            ),
        ) as ScopeBenchmarkResult;
        assert.equal(committed.configuration_digest, digestBenchmarkConfiguration(benchmark));
        assert.equal(committed.host_class, hostClass.id);
        assert.equal(detectHostClass(slo, committed.environment)?.id, hostClass.id);
        assert.ok(committed.revert_checks.length > 0);
        assert.ok(committed.revert_checks.every(({ ok }) => ok));
        for (const metric of Object.keys(hostClass.budgets)) {
            assert.ok(committed.metrics[metric], `${hostClass.id} budgets unmeasured ${metric}`);
        }
        for (const metric of Object.values(committed.metrics)) {
            assert.deepEqual(metric.summary, summarizeSamples(metric.samples));
        }
    }
});

test("scope metric names, result paths, and line fits", () => {
    assert.equal(scopeMetricName("fork_ms", "copy", "large"), "fork_ms/copy/large");
    assert.deepEqual(Object.keys(SCOPE_METRIC_FAMILIES).sort(), [
        "fork_ms",
        "observe_ms",
        "record_ms",
        "revert_ms",
    ]);
    const { benchmark } = readScopeBenchmarkConfiguration(productionConfiguration);
    assert.equal(
        scopeResultPath(benchmark, "host"),
        path.join(benchmark.resultDirectory, `${benchmark.resultPrefix}host.json`),
    );
    assert.deepEqual(
        fitLine([
            { x: 0, y: 5 },
            { x: 10, y: 25 },
            { x: 20, y: 45 },
        ]),
        { intercept: 5, r_squared: 1, slope: 2 },
    );
    assert.deepEqual(
        fitLine([
            { x: 1, y: 7 },
            { x: 2, y: 7 },
        ]),
        { intercept: 7, r_squared: 1, slope: 0 },
    );
    const noisy = fitLine([
        { x: 0, y: 0 },
        { x: 1, y: 2 },
        { x: 2, y: 1 },
    ]);
    assert.ok(noisy.r_squared > 0 && noisy.r_squared < 1);
    assert.throws(() => fitLine([{ x: 1, y: 1 }]), RangeError);
    assert.throws(
        () =>
            fitLine([
                { x: 1, y: 1 },
                { x: 1, y: 2 },
            ]),
        RangeError,
    );
});

test("tree digests cover nested file paths and contents but not directories or links", async (context) => {
    const root = await mkdtemp(path.join(tmpdir(), "shepherd-scope-digest-"));
    context.after(() => rm(root, { force: true, recursive: true }));
    mkdirSync(path.join(root, "nested"));
    writeFileSync(path.join(root, "a.bin"), "alpha");
    writeFileSync(path.join(root, "nested", "b.bin"), "beta");
    const first = digestTree(root);
    assert.match(first, /^sha256:[0-9a-f]{64}$/u);
    mkdirSync(path.join(root, "empty"));
    symlinkSync("a.bin", path.join(root, "link"));
    assert.equal(digestTree(root), first);
    writeFileSync(path.join(root, "nested", "b.bin"), "beta!");
    assert.notEqual(digestTree(root), first);
    writeFileSync(path.join(root, "nested", "b.bin"), "beta");
    assert.equal(digestTree(root), first);
    writeFileSync(path.join(root, "c.bin"), "");
    assert.notEqual(digestTree(root), first);
});

test("scope benchmark configuration validation rejects malformed fields", async (context) => {
    const reject = async (mutate: (value: Record<string, unknown>) => void, pattern: RegExp) => {
        const value = structuredClone(production) as unknown as Record<string, unknown>;
        mutate(value);
        await assert.rejects(
            async () => readScopeBenchmarkConfiguration(await writeJson(context, value)),
            (error: unknown) => error instanceof TypeError && pattern.test(error.message),
        );
    };
    type Json = Record<string, unknown>;
    const benchmark = (value: Record<string, unknown>) => value.benchmark as Json;
    await reject((value) => {
        value.benchmark = [];
    }, /^benchmark must be an object/u);
    await reject((value) => {
        benchmark(value).worlds = [];
    }, /benchmark\.worlds must be an array of at least 1/u);
    await reject((value) => {
        benchmark(value).worlds = [null];
    }, /benchmark\.worlds\[0\] must be an object/u);
    await reject((value) => {
        benchmark(value).worlds = [
            { fileBytes: 1, files: 1, id: "same" },
            { fileBytes: 1, files: 1, id: "same" },
        ];
    }, /ids must be distinct/u);
    await reject((value) => {
        (benchmark(value).mutationSweep as Record<string, unknown>).world = "missing";
    }, /must name a configured world/u);
    await reject((value) => {
        (benchmark(value).mutationSweep as Record<string, unknown>).writeBytes = [1, 1];
    }, /must not repeat a value/u);
    await reject((value) => {
        (benchmark(value).mutationSweep as Record<string, unknown>).writeBytes = [1];
    }, /at least 2 entries/u);
    await reject((value) => {
        (benchmark(value).storage as Record<string, unknown>).flushCommand = ["sync", ""];
    }, /flushCommand must list non-empty strings/u);
    await reject((value) => {
        (benchmark(value).storage as Record<string, unknown>).flushCommand = [7];
    }, /flushCommand must list non-empty strings/u);
    await reject((value) => {
        (benchmark(value).branching as Record<string, unknown>).branchCount = 1;
    }, /branchCount must be an integer of at least 2/u);
    await reject((value) => {
        (benchmark(value).fork as Record<string, unknown>).repetitions = 1.5;
    }, /fork\.repetitions must be an integer/u);
    await reject((value) => {
        (benchmark(value).naming as Record<string, unknown>).programId = "";
    }, /programId must be a non-empty string/u);
    await reject((value) => {
        (value.slo as Record<string, unknown>).hostClasses = [];
    }, /slo\.hostClasses must be an array/u);
    const hostClass = (value: Record<string, unknown>) =>
        (
            (value.slo as Record<string, unknown>).hostClasses as Record<string, unknown>[]
        )[0] as Record<string, unknown>;
    await reject((value) => {
        (hostClass(value).match as Record<string, unknown>).filesystemTypes = ["apfs"];
    }, /filesystemTypes must list integers/u);
    const budget = (metric: string, entry: unknown) => (value: Record<string, unknown>) => {
        hostClass(value).budgets = { [metric]: entry };
    };
    await reject(budget("verify_ms/copy", { max: 1, statistic: "p95" }), /unknown metric/u);
    await reject(budget("fork_ms", { max: 1, statistic: "p95" }), /unknown metric/u);
    await reject(budget("fork_ms/copy/", { max: 1, statistic: "p95" }), /unknown metric/u);
    await reject(budget("fork_ms/copy/small", { max: 1, statistic: "p50" }), /median or p95/u);
    await reject(
        budget("fork_ms/copy/small", { min: 1, statistic: "p95" }),
        /only a positive max/u,
    );
    await reject(
        budget("fork_ms/copy/small", { max: 0, statistic: "p95" }),
        /only a positive max/u,
    );
    await reject(
        budget("fork_ms/copy/small", { max: 1, min: 0, statistic: "p95" }),
        /only a positive max/u,
    );
    await reject(budget("fork_ms/copy/small", 3), /must be an object/u);
});

test("bench:scopes measures every dimension and check:scopes compares it with budgets", async (context) => {
    const budgets = { "fork_ms/copy/tiny": { max: 1_000_000, statistic: "p95" } };
    const repository = await scratchRepository(context, withSlo(hostMatch(), budgets));
    const written = await benchScopes(repository.paths, repository.io);
    assert.equal(written, path.join("results", "scope-benchmark-test-host.json"));
    const result = JSON.parse(
        readFileSync(path.join(repository.paths.repositoryRoot, written as string), "utf8"),
    ) as ScopeBenchmarkResult;
    assert.equal(result.host_class, "test-host");
    assert.match(result.recorded_on, /^\d{4}-\d{2}-\d{2}$/u);
    assert.equal(result.environment.package_version, "0.0.0-test");
    assert.ok(result.backends.includes("copy"));
    for (const backend of result.backends) {
        assert.equal(result.metrics[`fork_ms/${backend}/tiny`]?.samples.length, 1);
        assert.equal(result.metrics[`revert_ms/${backend}/tiny`]?.samples.length, 1);
    }
    assert.equal(result.metrics["record_ms/observers-0/steps-2"]?.samples.length, 2);
    assert.equal(result.metrics["record_ms/observers-1/steps-2"]?.samples.length, 2);
    assert.equal(result.metrics["observe_ms/observers-1/steps-2"]?.samples.length, 2);
    assert.equal(result.metrics["observe_ms/observers-0/steps-2"], undefined);
    assert.equal(result.mutation_sweep.rows.length, 2 * result.backends.length);
    assert.equal(result.mutation_sweep.scaling.length, result.backends.length);
    assert.equal(result.branching.length, result.backends.length);
    assert.deepEqual(
        result.branching.map(({ written_bytes }) => written_bytes),
        result.backends.map(() => 2 * 64),
    );
    assert.equal(
        new Set(result.observation.map(({ records_per_event }) => records_per_event)).size,
        1,
    );
    assert.ok(result.observation.every(({ stream_bytes_per_event }) => stream_bytes_per_event > 0));
    assert.ok(result.revert_checks.length > 0);
    assert.ok(result.revert_checks.every(({ ok }) => ok));
    assert.match(repository.io.text(), /SLO: pass\n$/u);

    assert.equal(await checkScopeSlo(repository.paths, repository.io), true);
    writeFileSync(
        path.join(repository.paths.repositoryRoot, written as string),
        JSON.stringify({ ...result, configuration_digest: "sha256:stale" }),
    );
    assert.equal(await checkScopeSlo(repository.paths, repository.io), false);
    assert.match(repository.io.text(), /different benchmark configuration/u);
});

test("bench:scopes prints the result and check:scopes skips a host without a class", async (context) => {
    const repository = await scratchRepository(
        context,
        withSlo({ ...hostMatch(), platform: "no-such-platform" }, {}),
    );
    assert.equal(await benchScopes(repository.paths, repository.io), null);
    assert.match(repository.io.text(), /no scope benchmark host class matches this host/iu);
    assert.equal(await checkScopeSlo(repository.paths, repository.io), true);
    assert.match(repository.io.text(), /SLO: skipped/u);
});
