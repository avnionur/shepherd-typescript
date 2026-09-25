import { glob, readdir, readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** One V8 source range with its execution count, as written to `NODE_V8_COVERAGE`. */
export type V8CoverageRange = {
    /** Inclusive start offset in the script source, in UTF-16 code units. */
    readonly startOffset: number;
    /** Exclusive end offset in the script source, in UTF-16 code units. */
    readonly endOffset: number;
    /** Number of times the range executed in the reporting process. */
    readonly count: number;
};

/** V8 coverage of one function; `ranges[0]` is the function itself, later ranges are blocks. */
export type V8FunctionCoverage = {
    /** Function name, empty for anonymous functions and the script body. */
    readonly functionName: string;
    /** Whether V8 reported block ranges for the function rather than only its call count. */
    readonly isBlockCoverage: boolean;
    /** Function range followed by the nested block ranges V8 did not filter. */
    readonly ranges: readonly V8CoverageRange[];
};

/** V8 coverage of one script loaded by one process. */
export type V8ScriptCoverage = {
    /** Script URL; only `file:` URLs can match repository files. */
    readonly url: string;
    /** Functions of the script in V8 source order; the first is the script body. */
    readonly functions: readonly V8FunctionCoverage[];
};

/** Minimum covered percentages; a run below any of them fails. */
export type CoverageThresholds = {
    /** Minimum branch coverage percentage. */
    readonly branches: number;
    /** Minimum function coverage percentage. */
    readonly functions: number;
    /** Minimum line coverage percentage. */
    readonly lines: number;
};

/** Covered and total counts of lines, branches, and functions. */
export type CoverageCounts = {
    /** Number of branches with a positive merged count or only ignored lines. */
    readonly coveredBranchCount: number;
    /** Number of functions with a positive merged count or only ignored lines. */
    readonly coveredFunctionCount: number;
    /** Number of lines with a positive merged count or an ignore comment. */
    readonly coveredLineCount: number;
    /** Number of distinct block ranges reported for the file by any process. */
    readonly totalBranchCount: number;
    /** Number of distinct non-script functions reported for the file by any process. */
    readonly totalFunctionCount: number;
    /** Number of source lines, ignored lines included. */
    readonly totalLineCount: number;
};

/** Merged coverage of one repository file. */
export type FileCoverage = CoverageCounts & {
    /** Repository-relative path with `/` separators. */
    readonly path: string;
    /** First line of each uncovered branch, ascending, duplicates removed. */
    readonly uncoveredBranchLines: readonly number[];
    /** First line of each uncovered function, ascending, duplicates removed. */
    readonly uncoveredFunctionLines: readonly number[];
    /** Uncovered, non-ignored line numbers, ascending. */
    readonly uncoveredLines: readonly number[];
};

/** Merged coverage of every included repository file. */
export type CoverageSummary = {
    /** Per-file coverage sorted by path. */
    readonly files: readonly FileCoverage[];
    /** Sum of the per-file counts. */
    readonly totals: CoverageCounts;
};

/** Human-readable coverage report and its threshold verdict. */
export type CoverageEvaluation = {
    /** Whether every total percentage meets its threshold. */
    readonly passed: boolean;
    /** Coverage table, uncovered branch and function locations, and threshold failures. */
    readonly report: string;
};

/** Inputs for collecting repository coverage from a `NODE_V8_COVERAGE` directory. */
export type RepositoryCoverageOptions = {
    /** Directory the instrumented processes wrote `coverage-*.json` files into. */
    readonly coverageDirectory: string;
    /** Repository-relative globs of the files that coverage is measured for. */
    readonly include: readonly string[];
    /** Absolute repository root the globs and report paths are relative to. */
    readonly repositoryRoot: string;
};

type SourceLine = {
    readonly endOffset: number;
    readonly ignore: boolean;
    readonly line: number;
    readonly startOffset: number;
};

type Query = {
    readonly end: number;
    found: boolean;
    readonly start: number;
    sum: number;
};

type KeyedRange = {
    readonly endOffset: number;
    readonly startOffset: number;
};

type FileAccumulator = {
    readonly branches: Map<string, KeyedRange>;
    readonly functions: Map<string, KeyedRange>;
    readonly processes: (readonly V8CoverageRange[])[];
};

const commentPattern = /\/\*[\s\S]*?\*\/|\/\/[^\n]*/gu;
const coverageFilePattern = /^coverage-(\d+)-(\d{13})-(\d+)\.json$/u;
const ignorePattern = /\/\* node:coverage ignore next (?<count>\d+ )?\*\//u;
const lineEndingPattern = /\r?\n$/u;
const lineSplitPattern = /(?<=\r?\n)/u;
const statusPattern = /\/\* node:coverage (?<status>enable|disable) \*\//u;

/**
 * Merges raw V8 coverage from any number of processes without losing zero-count ranges.
 *
 * V8 omits a block range whose count equals its parent's, so a range that is absent from one
 * process says nothing about whether it ran there. The count of an interval in one process is
 * therefore the count of the innermost reported range containing it, and the merged count is
 * the sum of those per-process counts. The result does not depend on process order.
 *
 * Every block range (function ranges of block-covered functions included) reported by any
 * process is a branch, and every non-script function is a function, identified by source
 * offsets. Lines, ignore comments, and the per-line rules follow Node's built-in test-runner
 * coverage.
 *
 * @example
 * ```ts
 * const merge = new CoverageMerge(new Map([["src/a.ts", source]]));
 * merge.addProcess(repositoryRoot, scriptsOfProcessA);
 * merge.addProcess(repositoryRoot, scriptsOfProcessB);
 * const summary = merge.summarize();
 * ```
 */
export class CoverageMerge {
    readonly #files = new Map<string, FileAccumulator>();
    readonly #sources: ReadonlyMap<string, string>;

    /**
     * Creates a merge over a fixed set of source files.
     *
     * @param sources - Source text of every included file, keyed by repository-relative path
     * with `/` separators. Files that no process loaded are reported as never executed, or
     * omitted when they contain only types and comments.
     */
    constructor(sources: ReadonlyMap<string, string>) {
        this.#sources = sources;
    }

    /**
     * Adds the coverage written by one process.
     *
     * Scripts that are not `file:` URLs or whose path is not an included source are ignored.
     *
     * @param repositoryRoot - Absolute root the source paths are relative to.
     * @param scripts - The `result` array of one V8 coverage file.
     */
    addProcess(repositoryRoot: string, scripts: readonly V8ScriptCoverage[]): void {
        for (const script of scripts) {
            if (!script.url.startsWith("file:")) continue;
            const relative = portableRelative(repositoryRoot, fileURLToPath(script.url));
            if (!this.#sources.has(relative)) continue;
            const accumulator = this.#accumulator(relative);
            const ranges: V8CoverageRange[] = [];
            script.functions.forEach((fn, index) => {
                for (const range of fn.ranges) {
                    ranges.push(range);
                    if (fn.isBlockCoverage) setKey(accumulator.branches, range);
                }
                const [functionRange] = fn.ranges;
                if (index > 0 && functionRange !== undefined) {
                    setKey(accumulator.functions, functionRange);
                }
            });
            // Stable sort: outer ranges first; equal ranges keep V8 order, so the later is inner.
            ranges.sort(
                (left, right) =>
                    left.startOffset - right.startOffset || right.endOffset - left.endOffset,
            );
            accumulator.processes.push(ranges);
        }
    }

    /**
     * Computes the merged coverage of every source file.
     *
     * @returns Per-file and total counts with uncovered locations.
     */
    summarize(): CoverageSummary {
        const files = [...this.#sources]
            .filter(([file, source]) => this.#files.has(file) || hasRuntimeCode(source))
            .map(([file, source]) => this.#summarizeFile(file, source))
            .sort((left, right) => left.path.localeCompare(right.path, "en"));
        const totals = {
            coveredBranchCount: 0,
            coveredFunctionCount: 0,
            coveredLineCount: 0,
            totalBranchCount: 0,
            totalFunctionCount: 0,
            totalLineCount: 0,
        };
        for (const file of files) {
            for (const key of Object.keys(totals) as (keyof CoverageCounts)[]) {
                totals[key] += file[key];
            }
        }
        return { files, totals };
    }

    #accumulator(file: string): FileAccumulator {
        const existing = this.#files.get(file);
        if (existing !== undefined) return existing;
        const created: FileAccumulator = {
            branches: new Map(),
            functions: new Map(),
            processes: [],
        };
        this.#files.set(file, created);
        return created;
    }

    #summarizeFile(file: string, source: string): FileCoverage {
        const lines = sourceLines(source);
        const accumulator = this.#files.get(file) ?? {
            branches: new Map<string, KeyedRange>(),
            functions: new Map<string, KeyedRange>(),
            processes: [],
        };
        const lineQueries = lines.map((line) =>
            query(line.startOffset, Math.max(line.endOffset, line.startOffset + 1)),
        );
        const branchRanges = [...accumulator.branches.values()];
        const functionRanges = [...accumulator.functions.values()];
        const branchQueries = branchRanges.map((range) =>
            query(range.startOffset, range.endOffset),
        );
        const functionQueries = functionRanges.map((range) =>
            query(range.startOffset, range.endOffset),
        );
        const queries = [...lineQueries, ...branchQueries, ...functionQueries].sort(
            (left, right) => left.start - right.start,
        );
        for (const ranges of accumulator.processes) addInnermostCounts(ranges, queries);

        const uncoveredLines: number[] = [];
        let coveredLineCount = 0;
        lines.forEach((line, index) => {
            const counted = lineQueries[index] as Query;
            const executed = counted.found ? counted.sum > 0 : line.startOffset === line.endOffset;
            if (executed || line.ignore) coveredLineCount++;
            else uncoveredLines.push(line.line);
        });
        const branches = rangeCoverage(branchRanges, branchQueries, lines);
        const functions = rangeCoverage(functionRanges, functionQueries, lines);
        return {
            coveredBranchCount: branches.covered,
            coveredFunctionCount: functions.covered,
            coveredLineCount,
            path: file,
            totalBranchCount: branchRanges.length,
            totalFunctionCount: functionRanges.length,
            totalLineCount: lines.length,
            uncoveredBranchLines: branches.uncoveredLines,
            uncoveredFunctionLines: functions.uncoveredLines,
            uncoveredLines,
        };
    }
}

/**
 * Reports whether TypeScript source keeps any code after type stripping and comment removal.
 *
 * A file with only type declarations is never loaded at runtime, so it produces no coverage and
 * has nothing to cover.
 */
function hasRuntimeCode(source: string): boolean {
    return stripTypeScriptTypes(source).replace(commentPattern, "").trim() !== "";
}

/**
 * Splits source text into lines and applies Node's coverage ignore comments.
 *
 * Mirrors `getLines` of Node's `lib/internal/test_runner/coverage.js`: each line keeps its
 * offsets without the line ending; `node:coverage ignore next [N]` ignores the following `N`
 * lines (default 1); `node:coverage disable` ignores every later line until
 * `node:coverage enable`, and both reset a pending ignore count.
 *
 * @param source - Complete source text.
 * @returns One entry per line, numbered from 1.
 */
function sourceLines(source: string): readonly SourceLine[] {
    let ignoreCount = 0;
    let enabled = true;
    let offset = 0;
    return source.split(lineSplitPattern).map((text, index) => {
        const startOffset = offset;
        const newlineLength = lineEndingPattern.exec(text)?.[0].length ?? 0;
        offset += text.length;
        let ignore = false;
        if (ignoreCount > 0) {
            ignoreCount--;
            ignore = true;
        } else if (!enabled) {
            ignore = true;
        }
        if (!ignore) {
            const match = ignorePattern.exec(text);
            if (match !== null) ignoreCount = Number.parseInt(match.groups?.count ?? "1", 10);
        }
        const status = statusPattern.exec(text)?.groups?.status;
        if (status !== undefined) {
            ignoreCount = 0;
            enabled = status === "enable";
        }
        return {
            endOffset: startOffset + text.length - newlineLength,
            ignore,
            line: index + 1,
            startOffset,
        };
    });
}

/**
 * Adds, for every query interval, the count of the innermost range of one process containing it.
 *
 * V8 ranges nest, so a sweep in start order keeps the chain of open ranges on a stack; the
 * containing ranges of a query are a prefix of that chain.
 */
function addInnermostCounts(ranges: readonly V8CoverageRange[], queries: readonly Query[]): void {
    const stack: V8CoverageRange[] = [];
    let next = 0;
    for (const current of queries) {
        for (; next < ranges.length; next++) {
            const range = ranges[next] as V8CoverageRange;
            if (range.startOffset > current.start) break;
            while (stack.length > 0 && !contains(stack.at(-1) as V8CoverageRange, range)) {
                stack.pop();
            }
            stack.push(range);
        }
        let innermost: V8CoverageRange | undefined;
        for (let depth = stack.length - 1; depth >= 0 && innermost === undefined; depth--) {
            const candidate = stack[depth] as V8CoverageRange;
            if (candidate.endOffset >= current.end) innermost = candidate;
        }
        if (innermost !== undefined) {
            current.found = true;
            current.sum += innermost.count;
        }
    }
}

/**
 * Counts covered ranges the way Node counts branches and functions: covered when the merged
 * count is positive or every line the range maps to is ignored.
 */
function rangeCoverage(
    ranges: readonly KeyedRange[],
    queries: readonly Query[],
    lines: readonly SourceLine[],
): { readonly covered: number; readonly uncoveredLines: readonly number[] } {
    let covered = 0;
    const uncoveredLines = new Set<number>();
    ranges.forEach((range, index) => {
        const mapped = mapRangeToLines(range, lines);
        if ((queries[index] as Query).sum > 0 || mapped.every((line) => line.ignore)) {
            covered++;
        } else {
            uncoveredLines.add((mapped[0] as SourceLine).line);
        }
    });
    return { covered, uncoveredLines: [...uncoveredLines].sort((left, right) => left - right) };
}

/**
 * Lists the lines a range touches, as Node's `mapRangeToLines` does: from the line whose offsets
 * contain the range start, through every following line that starts before the range end.
 */
function mapRangeToLines(range: KeyedRange, lines: readonly SourceLine[]): readonly SourceLine[] {
    let low = 0;
    let high = lines.length - 1;
    const mapped: SourceLine[] = [];
    while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        const line = lines[middle] as SourceLine;
        if (range.startOffset < line.startOffset) {
            high = middle - 1;
        } else if (range.startOffset > line.endOffset) {
            low = middle + 1;
        } else {
            for (const next of lines.slice(middle)) {
                if (range.endOffset <= next.startOffset) break;
                mapped.push(next);
            }
            break;
        }
    }
    return mapped;
}

/**
 * Reads the coverage files of a `NODE_V8_COVERAGE` directory and merges them for the included
 * repository files.
 *
 * Every file matching an include glob is reported, including files no process loaded, which are
 * reported as never executed unless they contain only types and comments. Directory entries not named `coverage-<pid>-<time>-<seq>.json` are
 * skipped, like Node's test runner does.
 *
 * @param options - Coverage directory, include globs, and repository root.
 * @returns The merged coverage summary.
 * @throws {Error} If the directory, a coverage file, or a source file cannot be read.
 * @throws {TypeError} If a coverage file has no `result` array.
 */
export async function collectRepositoryCoverage(
    options: RepositoryCoverageOptions,
): Promise<CoverageSummary> {
    const sources = new Map<string, string>();
    for await (const file of glob(options.include, { cwd: options.repositoryRoot })) {
        const relative = file.split(path.sep).join("/");
        sources.set(relative, await readFile(path.join(options.repositoryRoot, relative), "utf8"));
    }
    const merge = new CoverageMerge(sources);
    const entries = (await readdir(options.coverageDirectory))
        .filter((entry) => coverageFilePattern.test(entry))
        .sort();
    for (const entry of entries) {
        const document: unknown = JSON.parse(
            await readFile(path.join(options.coverageDirectory, entry), "utf8"),
        );
        const result = (document as { readonly result?: unknown } | null)?.result;
        if (!Array.isArray(result)) {
            throw new TypeError(`V8 coverage file ${entry} has no result array`);
        }
        merge.addProcess(options.repositoryRoot, result as V8ScriptCoverage[]);
    }
    return merge.summarize();
}

/**
 * Formats a coverage table and checks the total percentages against thresholds.
 *
 * The table lists every file with its line, branch, and function percentages and uncovered
 * line ranges, then the totals. Uncovered branches and functions are listed by first line, and
 * each unmet threshold is reported in Node's wording.
 *
 * @param summary - Merged coverage summary.
 * @param thresholds - Minimum total percentages.
 * @returns The report text, ending with a newline, and whether every threshold is met.
 */
export function evaluateCoverage(
    summary: CoverageSummary,
    thresholds: CoverageThresholds,
): CoverageEvaluation {
    const rows = [
        ["file", "line %", "branch %", "funcs %", "uncovered lines"],
        ...summary.files.map((file) => [
            file.path,
            ...percentages(file),
            formatLineRanges(file.uncoveredLines),
        ]),
        ["all files", ...percentages(summary.totals), ""],
    ];
    const widths = [0, 1, 2, 3].map((column) =>
        Math.max(...rows.map((row) => (row[column] as string).length)),
    );
    const output = ["start of merged coverage report"];
    for (const row of rows) {
        output.push(
            row
                .map((cell, column) =>
                    column === 0
                        ? cell.padEnd(widths[0] as number)
                        : cell.padStart(widths[column] as number),
                )
                .join(" | ")
                .trimEnd(),
        );
    }
    for (const file of summary.files) {
        if (file.uncoveredBranchLines.length > 0) {
            output.push(`uncovered branches: ${file.path}:${file.uncoveredBranchLines.join(",")}`);
        }
        if (file.uncoveredFunctionLines.length > 0) {
            output.push(
                `uncovered functions: ${file.path}:${file.uncoveredFunctionLines.join(",")}`,
            );
        }
    }
    output.push("end of merged coverage report");
    const checks = [
        [
            "line",
            percentage(summary.totals.coveredLineCount, summary.totals.totalLineCount),
            thresholds.lines,
        ],
        [
            "branch",
            percentage(summary.totals.coveredBranchCount, summary.totals.totalBranchCount),
            thresholds.branches,
        ],
        [
            "function",
            percentage(summary.totals.coveredFunctionCount, summary.totals.totalFunctionCount),
            thresholds.functions,
        ],
    ] as const;
    let passed = true;
    for (const [kind, actual, threshold] of checks) {
        if (actual < threshold) {
            passed = false;
            output.push(
                `Error: ${actual.toFixed(2)}% ${kind} coverage does not meet threshold of ${threshold}%.`,
            );
        }
    }
    return { passed, report: `${output.map((line) => `# ${line}`).join("\n")}\n` };
}

function setKey(target: Map<string, KeyedRange>, range: V8CoverageRange): void {
    target.set(`${range.startOffset}:${range.endOffset}`, {
        endOffset: range.endOffset,
        startOffset: range.startOffset,
    });
}

function query(start: number, end: number): Query {
    return { end, found: false, start, sum: 0 };
}

function contains(outer: V8CoverageRange, inner: V8CoverageRange): boolean {
    return outer.startOffset <= inner.startOffset && outer.endOffset >= inner.endOffset;
}

function percentage(covered: number, total: number): number {
    return total === 0 ? 100 : (covered / total) * 100;
}

function percentages(counts: CoverageCounts): readonly string[] {
    return [
        percentage(counts.coveredLineCount, counts.totalLineCount),
        percentage(counts.coveredBranchCount, counts.totalBranchCount),
        percentage(counts.coveredFunctionCount, counts.totalFunctionCount),
    ].map((value) => value.toFixed(2));
}

function formatLineRanges(lines: readonly number[]): string {
    const ranges: [number, number][] = [];
    for (const line of lines) {
        const last = ranges.at(-1);
        if (last !== undefined && last[1] + 1 === line) last[1] = line;
        else ranges.push([line, line]);
    }
    return ranges
        .map(([first, final]) => (first === final ? `${first}` : `${first}-${final}`))
        .join(" ");
}

function portableRelative(root: string, file: string): string {
    return path.relative(root, file).split(path.sep).join("/");
}
