import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

import {
    CoverageMerge,
    type CoverageSummary,
    collectRepositoryCoverage,
    evaluateCoverage,
    type V8CoverageRange,
    type V8FunctionCoverage,
    type V8ScriptCoverage,
} from "../tooling/testing/coverage-merge.ts";

const root = path.resolve("/repository");
const file = "src/branch.ts";
const source = [
    "export function pick(flag: boolean): number {",
    "    if (flag) {",
    "        return 1;",
    "    }",
    "    return 2;",
    "}",
    "",
    "pick(true);",
    "",
].join("\n");

const everywhere = { branches: 100, functions: 100, lines: 100 };

function span(text: string, snippet: string, count: number): V8CoverageRange {
    const startOffset = text.indexOf(snippet);
    assert.notEqual(startOffset, -1, `missing snippet ${snippet}`);
    return { count, endOffset: startOffset + snippet.length, startOffset };
}

function script(
    relative: string,
    functions: readonly V8FunctionCoverage[],
    url = pathToFileURL(path.join(root, relative)).href,
): V8ScriptCoverage {
    return { functions, url };
}

function body(text: string, count = 1): V8FunctionCoverage {
    return { functionName: "", isBlockCoverage: true, ranges: [span(text, text, count)] };
}

function pickFunction(
    calls: number,
    blocks: readonly V8CoverageRange[],
    isBlockCoverage = true,
): V8FunctionCoverage {
    const whole = source.slice(source.indexOf("function pick"), source.indexOf("}\n\npick") + 1);
    return {
        functionName: "pick",
        isBlockCoverage,
        ranges: [span(source, whole, calls), ...blocks],
    };
}

const thenBlock = "{\n        return 1;\n    }";
const afterIf = "\n    return 2;\n}";

/** Process that only called `pick(false)`: the `then` block has count 0. */
const falseOnly = [
    script(file, [body(source), pickFunction(1, [span(source, thenBlock, 0)])]),
] as const;

/** Process that only called `pick(true)`: V8 filters the `then` block (count equals parent). */
const trueOnly = [
    script(file, [body(source), pickFunction(1, [span(source, afterIf, 0)])]),
] as const;

function summarize(...processes: (readonly V8ScriptCoverage[])[]): CoverageSummary {
    const merge = new CoverageMerge(new Map([[file, source]]));
    for (const scripts of processes) merge.addProcess(root, scripts);
    return merge.summarize();
}

test("a zero-count range filtered in another process where it executed is covered", () => {
    const summary = summarize(falseOnly, trueOnly);
    assert.deepEqual(summary.totals, {
        coveredBranchCount: 4,
        coveredFunctionCount: 1,
        coveredLineCount: 8,
        totalBranchCount: 4,
        totalFunctionCount: 1,
        totalLineCount: 8,
    });
    assert.deepEqual(summary.files[0]?.uncoveredLines, []);
    assert.equal(evaluateCoverage(summary, everywhere).passed, true);
});

test("the merge does not depend on process order", () => {
    assert.deepEqual(summarize(falseOnly, trueOnly), summarize(trueOnly, falseOnly));
    assert.deepEqual(
        summarize(falseOnly, falseOnly, trueOnly),
        summarize(trueOnly, falseOnly, falseOnly),
    );
});

test("a range with zero count in every process stays uncovered", () => {
    const summary = summarize(falseOnly, falseOnly);
    const [coverage] = summary.files;
    assert.deepEqual(coverage?.uncoveredLines, [3, 4]);
    assert.deepEqual(coverage?.uncoveredBranchLines, [2]);
    assert.equal(summary.totals.coveredBranchCount, 2);
    const evaluation = evaluateCoverage(summary, everywhere);
    assert.equal(evaluation.passed, false);
    assert.match(
        evaluation.report,
        /# src\/branch\.ts +\| +75\.00 \| +66\.67 \| +100\.00 \| 3-4$/mu,
    );
    assert.match(evaluation.report, /# uncovered branches: src\/branch\.ts:2$/mu);
    assert.match(evaluation.report, /line coverage does not meet threshold of 100%/u);
    assert.match(evaluation.report, /branch coverage does not meet threshold of 100%/u);
    assert.doesNotMatch(evaluation.report, /function coverage does not meet/u);
});

test("uncalled and function-level-only functions count as uncovered functions", () => {
    const summary = summarize([
        script(file, [body(source), pickFunction(0, [], false)]),
        script("src/elsewhere.ts", [body(source)]),
        { functions: [body(source)], url: "node:internal/main" },
    ]);
    const [coverage] = summary.files;
    assert.equal(summary.files.length, 1);
    assert.equal(coverage?.totalBranchCount, 1);
    assert.equal(coverage?.totalFunctionCount, 1);
    assert.equal(coverage?.coveredFunctionCount, 0);
    assert.deepEqual(coverage?.uncoveredFunctionLines, [1]);
    assert.deepEqual(coverage?.uncoveredLines, [2, 3, 4, 5, 6]);
    const evaluation = evaluateCoverage(summary, { branches: 0, functions: 50, lines: 0 });
    assert.equal(evaluation.passed, false);
    assert.match(evaluation.report, /# uncovered functions: src\/branch\.ts:1$/mu);
    assert.match(evaluation.report, /Error: 0\.00% function coverage does not meet threshold/u);
});

test("files no process loaded are reported as never executed", () => {
    const merge = new CoverageMerge(
        new Map([
            ["src/types-only.ts", "/** Doc. */\nexport type A = { readonly b: string }; // note\n"],
            ["src/unloaded.ts", "const a = 1;\n\nconst b = 2;"],
        ]),
    );
    const summary = merge.summarize();
    assert.deepEqual(summary.files, [
        {
            coveredBranchCount: 0,
            coveredFunctionCount: 0,
            coveredLineCount: 1,
            path: "src/unloaded.ts",
            totalBranchCount: 0,
            totalFunctionCount: 0,
            totalLineCount: 3,
            uncoveredBranchLines: [],
            uncoveredFunctionLines: [],
            uncoveredLines: [1, 3],
        },
    ]);
    assert.match(evaluateCoverage(summary, everywhere).report, /\| +100\.00 \| +100\.00 \| 1 3$/mu);
});

test("lines outside every reported range fall back to Node's empty-line default", () => {
    const text = "a();\n\nb();\nc();\n";
    const merge = new CoverageMerge(new Map([[file, text]]));
    merge.addProcess(root, [
        script(file, [
            { functionName: "", isBlockCoverage: true, ranges: [span(text, "a();", 1)] },
            { functionName: "c", isBlockCoverage: true, ranges: [span(text, "c();", 2)] },
        ]),
    ]);
    const [coverage] = merge.summarize().files;
    assert.deepEqual(coverage?.uncoveredLines, [3]);
    assert.equal(coverage?.coveredFunctionCount, 1);
});

test("ignore comments follow Node's per-line rules", () => {
    const text = [
        "/* node:coverage ignore next */",
        "zero();",
        "zero();",
        "/* node:coverage ignore next 2 */",
        "zero();",
        "zero();",
        "zero();",
        "text /* node:coverage disable */",
        "zero(); /* node:coverage ignore next 5 */",
        "zero();",
        "/* node:coverage enable */",
        "zero();",
        "/* node:coverage ignore next 3 */",
        "/* node:coverage disable */ zero();",
        "zero(); /* node:coverage enable */",
        "zero();",
    ].join("\n");
    const ignoredBlock = "zero(); /* node:coverage ignore next 5 */\nzero();";
    const merge = new CoverageMerge(new Map([[file, text]]));
    merge.addProcess(root, [
        script(file, [
            {
                functionName: "",
                isBlockCoverage: true,
                ranges: [
                    span(text, text, 1),
                    span(text, "/* node:coverage ignore next */", 1),
                    span(text, ignoredBlock, 0),
                ],
            },
        ]),
    ]);
    const [coverage] = merge.summarize().files;
    assert.deepEqual(coverage?.uncoveredLines, []);
    assert.equal(coverage?.coveredBranchCount, 3);

    const zeroed = new CoverageMerge(new Map([[file, text]]));
    zeroed.addProcess(root, [script(file, [body(text, 0)])]);
    assert.deepEqual(zeroed.summarize().files[0]?.uncoveredLines, [1, 3, 4, 7, 8, 12, 13, 16]);
});

test("CRLF line endings keep Node's offsets", () => {
    const text = "a();\r\nb();\r\nc();";
    const merge = new CoverageMerge(new Map([[file, text]]));
    const gap = text.indexOf("\n");
    merge.addProcess(root, [
        script(file, [
            {
                functionName: "",
                isBlockCoverage: true,
                ranges: [
                    span(text, text, 1),
                    span(text, "c();", 0),
                    span(text, "b();", 0),
                    { count: 0, endOffset: gap + 1, startOffset: gap },
                ],
            },
        ]),
    ]);
    const [coverage] = merge.summarize().files;
    assert.deepEqual(coverage?.uncoveredLines, [2, 3]);
    assert.deepEqual(coverage?.uncoveredBranchLines, [2, 3]);
    // Node maps a range starting inside a CRLF pair to no lines and counts it as covered.
    assert.equal(coverage?.coveredBranchCount, 2);
});

test("collectRepositoryCoverage reads coverage files for the included files", async (context) => {
    const repositoryRoot = await mkdtemp(path.join(tmpdir(), "coverage-merge-root-"));
    const coverageDirectory = await mkdtemp(path.join(tmpdir(), "coverage-merge-v8-"));
    context.after(async () => {
        await rm(repositoryRoot, { force: true, recursive: true });
        await rm(coverageDirectory, { force: true, recursive: true });
    });
    await mkdir(path.join(repositoryRoot, "src"));
    await writeFile(path.join(repositoryRoot, file), source);
    await writeFile(path.join(repositoryRoot, "src/unloaded.ts"), "unused();\n");
    await writeFile(path.join(repositoryRoot, "README.md"), "not included\n");
    const url = pathToFileURL(path.join(repositoryRoot, file)).href;
    const coverageFile = (scripts: readonly V8ScriptCoverage[]) =>
        JSON.stringify({ result: scripts.map((entry) => ({ ...entry, url })) });
    await writeFile(
        path.join(coverageDirectory, "coverage-1-1790000000000-0.json"),
        coverageFile(falseOnly),
    );
    await writeFile(
        path.join(coverageDirectory, "coverage-2-1790000000001-0.json"),
        coverageFile(trueOnly),
    );
    await writeFile(path.join(coverageDirectory, "unrelated.json"), "not json");

    const summary = await collectRepositoryCoverage({
        coverageDirectory,
        include: ["src/**/*.ts"],
        repositoryRoot,
    });
    assert.deepEqual(
        summary.files.map((entry) => [entry.path, entry.uncoveredLines]),
        [
            [file, []],
            ["src/unloaded.ts", [1]],
        ],
    );

    for (const invalid of ["null", '{"result":{}}']) {
        await writeFile(path.join(coverageDirectory, "coverage-3-1790000000002-0.json"), invalid);
        await assert.rejects(
            collectRepositoryCoverage({
                coverageDirectory,
                include: ["src/**/*.ts"],
                repositoryRoot,
            }),
            /coverage-3-1790000000002-0\.json has no result array/u,
        );
    }
});
