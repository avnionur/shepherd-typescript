import { parseArgs } from "node:util";

import { fuzzTarget, type TargetReport } from "../test/fuzz/harness.ts";
import { FUZZ_TARGETS } from "../test/fuzz/targets/index.ts";

const usage =
    "Usage: fuzz-cli.ts [--tier NAME] [--seed N]... [--iterations N] [--target NAME]... [--json]";
const { values } = parseArgs({
    options: {
        iterations: { type: "string" },
        json: { type: "boolean" },
        seed: { multiple: true, type: "string" },
        target: { multiple: true, type: "string" },
        tier: { type: "string" },
    },
    strict: true,
});

function integer(text: string, name: string): number {
    const value = Number(text);
    if (!Number.isSafeInteger(value) || value < 0)
        throw new TypeError(`${name} must be a non-negative integer. ${usage}`);
    return value;
}

const selected = values.target ?? FUZZ_TARGETS.map(({ name }) => name);
const unknown = selected.filter((name) => !FUZZ_TARGETS.some((target) => target.name === name));
if (unknown.length > 0)
    throw new TypeError(`unknown fuzz target(s): ${unknown.join(", ")}. ${usage}`);
const options = {
    ...(values.iterations === undefined
        ? {}
        : { iterations: integer(values.iterations, "--iterations") }),
    ...(values.seed === undefined
        ? {}
        : { seeds: values.seed.map((seed) => integer(seed, "--seed")) }),
    ...(values.tier === undefined ? {} : { tier: values.tier }),
};

const started = performance.now();
const reports: TargetReport[] = [];
for (const target of FUZZ_TARGETS.filter(({ name }) => selected.includes(name))) {
    const targetReports = await fuzzTarget(target, options);
    reports.push(...targetReports);
    if (values.json !== true) {
        for (const report of targetReports) {
            process.stdout.write(
                report.skipped === undefined
                    ? `${report.target} seed=${report.seed} cases=${report.cases} accepted=${report.accepted} rejected=${JSON.stringify(report.rejected)} findings=${report.findings.length} ${report.durationMilliseconds}ms\n`
                    : `${report.target} skipped: ${report.skipped}\n`,
            );
            for (const finding of report.findings) {
                process.stdout.write(
                    `  case ${finding.case}: ${finding.reason}\n    input: ${finding.input}\n`,
                );
            }
        }
    }
}
const summary = {
    cases: reports.reduce((total, report) => total + report.cases, 0),
    durationMilliseconds: Math.round(performance.now() - started),
    findings: reports.reduce((total, report) => total + report.findings.length, 0),
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    reports,
};
process.stdout.write(
    values.json === true
        ? `${JSON.stringify(summary, null, 2)}\n`
        : `total cases=${summary.cases} findings=${summary.findings} duration=${summary.durationMilliseconds}ms node=${summary.node} ${summary.platform}\n`,
);
process.exitCode = summary.findings === 0 ? 0 : 1;
