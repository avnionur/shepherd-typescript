import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { runApplicationEvaluation, SQLiteTraceStore } from "../../../src/index.ts";
import {
    evaluateSlo,
    readKernelBenchmarkConfiguration,
    readPerformanceSloConfiguration,
    runKernelBenchmark,
} from "../../../tooling/benchmark/kernel-benchmark.ts";
import { runScopeBenchmark } from "../../../tooling/benchmark/scope-benchmark.ts";
import { readScopeBenchmarkConfiguration } from "../../../tooling/benchmark/scope-benchmark-config.ts";
import { resolveRepositoryEvaluation } from "../../../tooling/evaluation/harness.ts";

const studyRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(studyRoot, "../../..");
const configuration = JSON.parse(readFileSync(path.join(studyRoot, "study.config.json"), "utf8"));
if (process.version !== configuration.node) {
    throw new Error(`Use the study runtime ${configuration.node}; received ${process.version}`);
}
const output = path.resolve(studyRoot, process.argv[2] ?? "raw");
if (existsSync(path.join(output, "provenance.json"))) {
    throw new Error("Use a fresh output directory to preserve prior measurements");
}
mkdirSync(path.join(output, "docs/generated/benchmarks"), { recursive: true });
mkdirSync(path.join(output, "configuration"), { recursive: true });
const journal = [];
const configurationDigests = {};
for (const file of configuration.snapshotConfigurations) {
    const bytes = readFileSync(path.join(repositoryRoot, file));
    writeFileSync(path.join(output, "configuration", path.basename(file)), bytes);
    configurationDigests[file] = createHash("sha256").update(bytes).digest("hex");
}
const git = (args) => {
    const result = spawnSync("git", args, { cwd: repositoryRoot, encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr);
    return result.stdout.trim();
};
writeJson("provenance.json", {
    started_at: new Date().toISOString(),
    study_date: configuration.date,
    revision: git(["rev-parse", "HEAD"]),
    initial_status: git(["status", "--short"]),
    runtime_diff: git([
        "diff",
        "--",
        "src",
        "scripts",
        "tooling",
        "config",
        "protocol.config.json",
    ]),
    configuration_sha256: configurationDigests,
    study_configuration: configuration,
});
const paths = (file) => path.join(repositoryRoot, file);
const now = new Date(`${configuration.date}T12:00:00Z`);
const kernel = readKernelBenchmarkConfiguration(paths(configuration.kernelConfiguration));
const kernelSlo = readPerformanceSloConfiguration(paths(configuration.kernelSloConfiguration));
for (let run = 1; run <= configuration.kernelRuns; run += 1) {
    await measure(`kernel-${run}`, async () => {
        const result = await runKernelBenchmark(kernel, { now, repositoryRoot, slo: kernelSlo });
        writeJson(`kernel-${run}.json`, result);
        const host = kernelSlo.hostClasses.find(({ id }) => id === result.host_class);
        if (host) writeJson(`kernel-${run}-slo.json`, evaluateSlo(result, host));
    });
}
const scope = readScopeBenchmarkConfiguration(paths(configuration.scopeConfiguration));
for (let run = 1; run <= configuration.scopeRuns; run += 1) {
    await measure(`scope-${run}`, async () => {
        const result = await runScopeBenchmark(scope.benchmark, {
            now,
            repositoryRoot,
            slo: scope.slo,
        });
        writeJson(`scope-${run}.json`, result);
        const host = scope.slo.hostClasses.find(({ id }) => id === result.host_class);
        if (host) writeJson(`scope-${run}-slo.json`, evaluateSlo(result, host));
    });
}
for (const script of configuration.scripts) {
    await measure(script.id, async () => {
        const result = spawnSync(process.execPath, [paths(script.entry)], {
            cwd: output,
            encoding: "utf8",
            maxBuffer: 16 * 1024 * 1024,
        });
        writeFileSync(path.join(output, `${script.id}.stdout.json`), result.stdout ?? "");
        writeFileSync(path.join(output, `${script.id}.stderr.txt`), result.stderr ?? "");
        if (result.status !== 0) {
            throw new Error(`exit=${result.status}, signal=${result.signal}: ${result.stderr}`);
        }
    });
}
await measure("offline-applications", async () => {
    const evaluation = resolveRepositoryEvaluation(
        JSON.parse(readFileSync(paths(configuration.applicationConfiguration), "utf8")),
    );
    const store = new SQLiteTraceStore();
    try {
        writeJson(
            "offline-applications.json",
            await runApplicationEvaluation(store, {
                bind: evaluation.bind,
                definition: evaluation.definition,
            }),
        );
    } finally {
        store.close();
    }
});

/** Saves an independent study artifact without rewriting historical reference results. */
function writeJson(file, value) {
    writeFileSync(path.join(output, file), `${JSON.stringify(value, null, 4)}\n`);
}

/** Records every suite's elapsed time and failure, and continues collecting other suites. */
async function measure(id, operation) {
    process.stdout.write(`Starting ${id}\n`);
    const started = performance.now();
    const startedAt = new Date().toISOString();
    try {
        await operation();
        journal.push({
            id,
            started_at: startedAt,
            elapsed_ms: performance.now() - started,
            ok: true,
        });
    } catch (error) {
        journal.push({
            id,
            started_at: startedAt,
            elapsed_ms: performance.now() - started,
            ok: false,
            error: String(error),
        });
        process.exitCode = 1;
    }
    writeJson("journal.json", journal);
    process.stdout.write(`Finished ${id}: ${journal.at(-1).ok ? "pass" : "FAIL"}\n`);
}
