import assert from "node:assert/strict";
import { test } from "node:test";
import * as runs from "../../src/facades/runs.ts";

test("run facade exposes only run-owned runtime symbols", () => {
    const expected = [
        "DurableExecutionClaimFencedError",
        "DurableExecutionClaimLostError",
        "DurableExecutionRecoveryAbsentError",
        "DurableExecutionRecoveryCommandRequiredError",
        "DurableExecutionRecoveryError",
        "RunBudgetExhaustedError",
        "RunCancelledError",
        "acknowledgeDurableTaskCancellation",
        "acknowledgeDurableTaskSuspension",
        "acknowledgeDurableTaskWaiting",
        "cancelDurableTask",
        "captureRunContinuationCheckpoints",
        "createRunArtifact",
        "createRunControl",
        "createRunLifecycleTransition",
        "createRunOutcome",
        "createRunUsage",
        "executeTask",
        "executeTaskDurably",
        "inspectDurableTaskExecution",
        "readDurableTaskExecution",
        "recoverTaskDurably",
        "requestDurableTaskCancellation",
        "requestDurableTaskPause",
        "resumeDurableTask",
    ] as const;

    assert.deepEqual(Object.keys(runs), expected);
    for (const excluded of [
        "createStaticProvider",
        "SQLiteTaskRegistry",
        "SQLiteTraceStore",
        "captureTaskWorldDurably",
    ]) {
        assert.equal(excluded in runs, false);
    }
});
