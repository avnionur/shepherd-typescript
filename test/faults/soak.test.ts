import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { runSoak } from "./soak.ts";
import { soakSettings } from "./workload.ts";

// The bounded soak is operation-bounded, not time-bounded, so the workload and its invariant
// checkpoints are the same on every host; only where the seeded kills land depends on speed.
test(`bounded soak: ${soakSettings.boundedOperations} mixed operations hold every invariant`, {
    timeout: soakSettings.testTimeoutMilliseconds,
}, async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-soak-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const report = await runSoak({ directory, operations: soakSettings.boundedOperations });
    context.diagnostic(JSON.stringify(report));
    const every = soakSettings.every;
    assert.equal(report.operations, soakSettings.boundedOperations);
    assert.equal(report.killCycles, Math.floor(soakSettings.boundedOperations / every.kill));
    assert.equal(report.backupsVerified, Math.floor(soakSettings.boundedOperations / every.backup));
    assert.equal(
        report.invariantChecks,
        Math.floor(soakSettings.boundedOperations / every.invariants) + 1,
    );
    assert.ok(report.telemetryRecords >= report.recordOccurrences);
});
