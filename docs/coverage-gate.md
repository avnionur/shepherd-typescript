# Coverage gate

`pnpm test` and `pnpm test:serial` fail unless the configured sources reach the line, branch, and
function thresholds in [`config/test-runner.config.json`](../config/test-runner.config.json)
(`coverage.lines`, `coverage.branches`, `coverage.functions`, and the `coverage.include` globs).

Entry point: [`tooling/testing/test-runner.ts`](../tooling/testing/test-runner.ts) runs the tests
and [`tooling/testing/coverage-merge.ts`](../tooling/testing/coverage-merge.ts) merges and
evaluates coverage. Tests: [`test/tooling-coverage-merge.test.ts`](../test/tooling-coverage-merge.test.ts).

## Why the repository merges coverage itself

Node's built-in test-runner coverage merges per-process results with `mergeCoverageRanges`, which
drops zero-count ranges depending on the order in which it reads the coverage files. A parallel run
could report 100% for code no test executes, and flag a different file on each run (#232).

## How it works

1. The runner starts `node:test` with coverage disabled and passes a temporary
   `NODE_V8_COVERAGE` directory in the environment, so every test process and every process it
   spawns writes raw V8 block coverage. The directory is removed after the run.
2. Scripts whose repository-relative path matches `coverage.include` are kept; `node:` and other
   non-file scripts are ignored.
3. V8 omits a block range whose count equals its parent's, so a range absent from one process is
   not evidence that it did not run. For each process, the count of a line, branch, or function is
   the count of the innermost reported range that contains it; those counts are summed across
   processes. The result does not depend on process order, so parallel and serial runs agree.
4. Branches are the block ranges of every function (keyed by source offsets), and functions are
   the named function ranges; each is covered when its summed count is above zero.
5. Lines, ignore comments (`/* node:coverage ignore next [N] */`, `disable`, `enable`), and
   threshold messages follow Node v24's test-runner semantics.
6. An included file that no process loaded is reported as fully uncovered, unless it contains only
   types and comments. That check uses `node:module` `stripTypeScriptTypes`, which prints one
   experimental warning per run on Node 24.

The report lists every file with line, branch, and function percentages, uncovered line ranges,
and the first line of each uncovered branch and function.

## Limits

- Branches and functions are counted once per unique source range, not once per duplicate V8 entry,
  so totals differ slightly from Node's report.
- Scripts are merged by file path; query strings on module URLs are ignored.
