import assert from "node:assert/strict";
import { test } from "node:test";

import { type FuzzTarget, fuzzSettings, fuzzTarget, resolveRun } from "./harness.ts";

/** Registers one default-tier test per target; a finding fails the test with its inputs. */
export function registerFuzzTests(targets: readonly FuzzTarget[]): void {
    for (const target of targets) {
        const run = resolveRun(target.name);
        test(`fuzz ${target.name} (${run.tier}, ${run.iterations} cases x ${run.seeds.length} seed)`, {
            timeout: fuzzSettings.testTimeoutMilliseconds,
        }, async (context) => {
            const reports = await fuzzTarget(target);
            const skipped = reports.find((report) => report.skipped !== undefined)?.skipped;
            if (skipped !== undefined) {
                context.skip(skipped);
                return;
            }
            for (const report of reports) {
                context.diagnostic(
                    `seed ${report.seed}: ${report.accepted} accepted, rejected ${JSON.stringify(report.rejected)}, ${report.durationMilliseconds} ms`,
                );
                assert.deepEqual(report.findings, [], `fuzz findings for ${target.name}`);
            }
        });
    }
}
