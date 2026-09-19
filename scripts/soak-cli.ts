import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

import { runSoak } from "../test/faults/soak.ts";
import { soakSettings } from "../test/faults/workload.ts";

const usage =
    "Usage: soak-cli.ts [--duration SECONDS] [--operations N] [--seed N] [--directory DIR] [--keep] [--json]";
const { values } = parseArgs({
    options: {
        directory: { type: "string" },
        duration: { type: "string" },
        json: { type: "boolean" },
        keep: { type: "boolean" },
        operations: { type: "string" },
        seed: { type: "string" },
    },
    strict: true,
});

function positiveInteger(text: string, name: string): number {
    const value = Number(text);
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new TypeError(`${name} must be a positive integer. ${usage}`);
    }
    return value;
}

const operations =
    values.operations === undefined
        ? undefined
        : positiveInteger(values.operations, "--operations");
const durationSeconds =
    values.duration === undefined
        ? operations === undefined
            ? soakSettings.defaultDurationSeconds
            : undefined
        : positiveInteger(values.duration, "--duration");
const directory =
    values.directory === undefined
        ? mkdtempSync(path.join(tmpdir(), "shepherd-soak-"))
        : path.resolve(values.directory);
mkdirSync(directory, { recursive: true });
const log = values.json === true ? undefined : (line: string) => process.stdout.write(`${line}\n`);

try {
    const report = await runSoak({
        directory,
        ...(durationSeconds === undefined ? {} : { durationSeconds }),
        ...(log === undefined ? {} : { log }),
        ...(operations === undefined ? {} : { operations }),
        ...(values.seed === undefined ? {} : { seed: positiveInteger(values.seed, "--seed") }),
    });
    process.stdout.write(
        values.json === true
            ? `${JSON.stringify(report, null, 2)}\n`
            : `soak passed: ${JSON.stringify(report)}\n`,
    );
} catch (error) {
    process.stderr.write(`soak failed in ${directory}: ${String(error)}\n`);
    if (error instanceof Error && error.stack !== undefined)
        process.stderr.write(`${error.stack}\n`);
    process.exitCode = 1;
} finally {
    // Only a directory this run created is removed, and never after a failure.
    if (values.keep !== true && values.directory === undefined && process.exitCode !== 1) {
        rmSync(directory, { force: true, recursive: true });
    }
}
