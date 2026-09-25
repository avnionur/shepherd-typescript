import { once } from "node:events";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { run } from "node:test";
import { spec } from "node:test/reporters";
import { fileURLToPath } from "node:url";

import { collectRepositoryCoverage, evaluateCoverage } from "./coverage-merge.ts";

type TestRunnerConfiguration = {
    readonly coverage: {
        readonly branches: number;
        readonly functions: number;
        readonly include: readonly string[];
        readonly lines: number;
    };
    readonly serialPriorityPatterns: readonly string[];
    readonly testRoot: string;
    readonly testSuffix: string;
};

/** Supported repository test execution mode. */
export type RepositoryTestMode = "parallel" | "serial";

/** Test-runner mode and output destination supplied by the command adapter. */
export type RepositoryTestOptions = {
    /** Whether test files run concurrently or in configured serial-priority order. */
    readonly mode: RepositoryTestMode;
    /** Destination for the Node specification reporter and the merged coverage report. */
    readonly output: NodeJS.WritableStream;
};

/**
 * Runs the configured repository tests in parallel or serial-priority order.
 *
 * Child test processes write raw V8 coverage to a temporary `NODE_V8_COVERAGE` directory, which
 * is merged by {@link collectRepositoryCoverage} and removed afterwards.
 *
 * @param options - Typed execution mode and reporter output destination.
 * @returns Whether the complete run and configured coverage thresholds succeeded.
 * @throws {Error} If configuration, test discovery, or the Node test runner fails.
 */
export async function runRepositoryTests(options: RepositoryTestOptions): Promise<boolean> {
    const repositoryRoot = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
    const configuration = JSON.parse(
        await readFile(path.join(repositoryRoot, "config/test-runner.config.json"), "utf8"),
    ) as TestRunnerConfiguration;
    const testRoot = path.resolve(repositoryRoot, configuration.testRoot);
    const discovered = (await readdir(testRoot, { recursive: true, withFileTypes: true }))
        .filter((entry) => entry.isFile() && entry.name.endsWith(configuration.testSuffix))
        .map((entry) => path.join(entry.parentPath, entry.name));
    const files = discovered.sort((left, right) => {
        const leftRelative = portableRelative(repositoryRoot, left);
        const rightRelative = portableRelative(repositoryRoot, right);
        const leftPriority = priorityOf(
            leftRelative,
            options.mode,
            configuration.serialPriorityPatterns,
        );
        const rightPriority = priorityOf(
            rightRelative,
            options.mode,
            configuration.serialPriorityPatterns,
        );
        return leftPriority - rightPriority || leftRelative.localeCompare(rightRelative, "en");
    });
    const coverageDirectory = await mkdtemp(path.join(tmpdir(), "repository-coverage-"));
    try {
        // Node's built-in merge drops zero-count ranges depending on process order, so child
        // processes write raw V8 coverage and the repository merge sums it soundly.
        const stream = run({
            concurrency: options.mode === "parallel",
            cwd: repositoryRoot,
            env: { ...process.env, NODE_V8_COVERAGE: coverageDirectory },
            files,
        });
        let succeeded = false;
        stream.on("test:summary", ({ success }) => {
            succeeded = success;
        });
        const reporter = stream.compose(spec);
        reporter.pipe(options.output, { end: false });
        await once(reporter, "end");
        const coverage = evaluateCoverage(
            await collectRepositoryCoverage({
                coverageDirectory,
                include: configuration.coverage.include,
                repositoryRoot,
            }),
            configuration.coverage,
        );
        options.output.write(coverage.report);
        return succeeded && coverage.passed;
    } finally {
        await rm(coverageDirectory, { force: true, recursive: true });
    }
}

function portableRelative(repositoryRoot: string, file: string): string {
    return path.relative(repositoryRoot, file).split(path.sep).join("/");
}

function priorityOf(
    file: string,
    mode: RepositoryTestMode,
    serialPriorityPatterns: readonly string[],
): number {
    if (mode === "parallel") return serialPriorityPatterns.length;
    const priority = serialPriorityPatterns.findIndex((pattern) => path.matchesGlob(file, pattern));
    return priority === -1 ? serialPriorityPatterns.length : priority;
}
