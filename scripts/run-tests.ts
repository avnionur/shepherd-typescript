import { once } from "node:events";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { run } from "node:test";
import { spec } from "node:test/reporters";

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

const repositoryRoot = path.resolve(new URL("../", import.meta.url).pathname);
const configuration = JSON.parse(
    await readFile(path.join(repositoryRoot, "test-runner.config.json"), "utf8"),
) as TestRunnerConfiguration;
const [mode, ...rest] = process.argv.slice(2);
if (rest.length > 0 || (mode !== "--parallel" && mode !== "--serial")) {
    throw new TypeError("Usage: run-tests.ts <--parallel|--serial>");
}

const testRoot = path.resolve(repositoryRoot, configuration.testRoot);
const discovered = (await readdir(testRoot, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(configuration.testSuffix))
    .map((entry) => path.join(entry.parentPath, entry.name));
const files = discovered.sort((left, right) => {
    const leftRelative = portableRelative(left);
    const rightRelative = portableRelative(right);
    const leftPriority = priorityOf(leftRelative);
    const rightPriority = priorityOf(rightRelative);
    return leftPriority - rightPriority || leftRelative.localeCompare(rightRelative, "en");
});
const stream = run({
    branchCoverage: configuration.coverage.branches,
    concurrency: mode === "--parallel",
    coverage: true,
    coverageIncludeGlobs: configuration.coverage.include,
    cwd: repositoryRoot,
    files,
    functionCoverage: configuration.coverage.functions,
    lineCoverage: configuration.coverage.lines,
});
stream.on("test:summary", ({ success }) => {
    if (!success) process.exitCode = 1;
});
stream.compose(spec).pipe(process.stdout);
await once(stream, "end");

function portableRelative(file: string): string {
    return path.relative(repositoryRoot, file).split(path.sep).join("/");
}

function priorityOf(file: string): number {
    if (mode === "--parallel") return configuration.serialPriorityPatterns.length;
    const priority = configuration.serialPriorityPatterns.findIndex((pattern) =>
        path.matchesGlob(file, pattern),
    );
    return priority === -1 ? configuration.serialPriorityPatterns.length : priority;
}
