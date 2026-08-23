import assert from "node:assert/strict";
import { test } from "node:test";

import {
    createRunArtifact,
    createRunControl,
    createRunOutcome,
    createRunUsage,
    RunBudgetExhaustedError,
    schema,
    task,
} from "../../src/index.ts";
import { readRunControlSnapshot } from "../../src/run/control-validation.ts";
import {
    readDurableCreation,
    readDurableExecutionResult,
} from "../../src/run/durable-execution-codec.ts";

const fixtureTask = task({
    input: schema.void(),
    instruction: "Return nothing.",
    name: "durable-codec",
    output: schema.void(),
    version: "1.0.0",
});
const provider = {
    capabilities: { streaming: false, structuredOutput: true, tools: false },
    id: "durable-codec",
    kind: "static" as const,
    model: "offline-v1",
};
const consumed = { costUsd: 0, effects: 0, inputTokens: 0, outputTokens: 0, turns: 0 };
const activeControl = { consumed, reason: null, status: "active" as const };

function creation(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
    return {
        budget: {},
        execution_id: "run:codec",
        inputs: { value: null },
        parent_execution_id: null,
        provider,
        task_artifact_lock: fixtureTask.artifactLock,
        task_ref: fixtureTask.artifactLock.artifact_digest,
        ...overrides,
    };
}

test("durable creation codec validates identity, ancestry, lock, and canonical input", () => {
    const decoded = readDurableCreation(creation(), "run:codec");
    assert.deepEqual(Object.keys(decoded.budget), []);
    assert.equal(decoded.input, null);
    assert.deepEqual(decoded.provider, provider);
    assert.deepEqual(decoded.taskArtifactLock, fixtureTask.artifactLock);
    for (const value of [
        creation({ execution_id: "run:other" }),
        creation({ parent_execution_id: "run:parent" }),
        creation({ task_ref: "sha256:wrong" }),
        creation({ inputs: null }),
        creation({ inputs: {} }),
        creation({ inputs: { value: Number.NaN } }),
    ]) {
        assert.throws(() => readDurableCreation(value, "run:codec"), TypeError);
    }
});

test("durable result codec rejects inconsistent terminal records", () => {
    const failed = createRunOutcome({
        outcome: { errorType: "FixtureError", message: "failed", status: "failed" },
        runId: "run:codec",
        taskArtifactLock: fixtureTask.artifactLock,
    });
    const exhausted = createRunOutcome({
        outcome: { reason: "budget", status: "exhausted" },
        runId: "run:codec",
        taskArtifactLock: fixtureTask.artifactLock,
    });
    const usage = createRunUsage({
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        runId: "run:codec",
    });
    const malformed = [
        [{ ...failed, outcome_version: 2 }, null, activeControl],
        [{ ...failed, run_id: "run:other" }, null, activeControl],
        [{ ...failed, outcome: { ...failed.outcome, retryable: "yes" } }, null, activeControl],
        [{ ...failed, outcome: { status: "unknown" } }, null, activeControl],
        [exhausted, null, activeControl],
        [failed, { ...usage, usage_version: 2 }, activeControl],
        [failed, { ...usage, run_id: "run:other" }, activeControl],
    ] as const;
    for (const [outcome, retainedUsage, control] of malformed) {
        assert.throws(
            () =>
                readDurableExecutionResult(
                    [],
                    outcome,
                    retainedUsage,
                    provider,
                    control,
                    {},
                    true,
                    "run:codec",
                ),
            TypeError,
        );
    }
    const artifact = createRunArtifact({
        artifactOrdinal: 0,
        content: { text: "codec", type: "text" },
        kind: "report",
        metadata: {},
        name: "codec.txt",
        runId: "run:codec",
    });
    assert.throws(
        () =>
            readDurableExecutionResult(
                [{ ...artifact, content: { type: "unknown" } }],
                failed,
                null,
                provider,
                activeControl,
                {},
                true,
                "run:codec",
            ),
        TypeError,
    );
});

test("durable result codec cross-validates control, usage, start, and budget evidence", () => {
    const turnReason = {
        limit: 0,
        metric: "turns" as const,
        observed: 1,
        type: "budget_exhausted" as const,
    };
    const durationReason = {
        limit: 1,
        metric: "duration_milliseconds" as const,
        observed: 2,
        type: "budget_exhausted" as const,
    };
    const caller = new AbortController();
    caller.abort();
    const cancelledSnapshot = createRunControl({ budget: {}, signal: caller.signal }).snapshot();
    assert.ok(cancelledSnapshot.reason && "message" in cancelledSnapshot.reason);
    const cancellationMessage = cancelledSnapshot.reason.message;
    const finished = createRunOutcome({
        outcome: { status: "finished", value: null },
        runId: "run:codec",
        taskArtifactLock: fixtureTask.artifactLock,
    });
    const failed = createRunOutcome({
        outcome: { errorType: "FixtureError", message: "failed", status: "failed" },
        runId: "run:codec",
        taskArtifactLock: fixtureTask.artifactLock,
    });
    const exhausted = createRunOutcome({
        outcome: {
            reason: new RunBudgetExhaustedError(turnReason).message,
            status: "exhausted",
        },
        runId: "run:codec",
        taskArtifactLock: fixtureTask.artifactLock,
    });
    const durationExhausted = createRunOutcome({
        outcome: {
            reason: new RunBudgetExhaustedError(durationReason).message,
            status: "exhausted",
        },
        runId: "run:codec",
        taskArtifactLock: fixtureTask.artifactLock,
    });
    const cancelled = createRunOutcome({
        outcome: { reason: cancellationMessage, status: "cancelled" },
        runId: "run:codec",
        taskArtifactLock: fixtureTask.artifactLock,
    });
    const usage = createRunUsage({
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        costUsd: 0.01,
        inputTokens: 2,
        outputTokens: 1,
        runId: "run:codec",
    });
    const providerConsumed = {
        costUsd: 0.01,
        effects: 0,
        inputTokens: 2,
        outputTokens: 1,
        turns: 1,
    };
    const decode = (
        outcome: unknown,
        retainedUsage: unknown,
        control: unknown,
        budget: Readonly<Record<string, number>>,
        started: boolean,
    ) =>
        readDurableExecutionResult(
            [],
            outcome,
            retainedUsage,
            provider,
            control,
            budget,
            started,
            "run:codec",
        );

    assert.equal(
        decode(
            finished,
            usage,
            { consumed: providerConsumed, reason: null, status: "active" },
            {},
            true,
        ).outcome.outcome.status,
        "finished",
    );
    assert.equal(
        decode(
            failed,
            null,
            { consumed: { ...consumed, turns: 1 }, reason: null, status: "active" },
            {},
            true,
        ).outcome.outcome.status,
        "failed",
    );
    const turnExhaustion = {
        consumed: { ...consumed, turns: 1 },
        reason: turnReason,
        status: "exhausted",
    };
    assert.equal(
        decode(exhausted, null, turnExhaustion, { maxTurns: 0 }, false).outcome.outcome.status,
        "exhausted",
    );
    for (const control of [
        {
            consumed: { ...consumed, turns: 1 },
            reason: { message: cancellationMessage, type: "cancelled" },
            status: "cancelled",
        },
        {
            consumed: { ...consumed, turns: 1 },
            reason: durationReason,
            status: "exhausted",
        },
    ]) {
        const outcome = control.status === "cancelled" ? cancelled : durationExhausted;
        const budget = control.status === "cancelled" ? {} : { maxDurationMilliseconds: 1 };
        assert.doesNotThrow(() => decode(outcome, usage, control, budget, true));
    }

    for (const [outcome, retainedUsage, control, budget, started] of [
        [
            failed,
            null,
            { consumed: { ...consumed, inputTokens: 1, turns: 1 }, reason: null, status: "active" },
            {},
            true,
        ],
        [
            finished,
            usage,
            { consumed: { ...providerConsumed, inputTokens: 1 }, reason: null, status: "active" },
            {},
            true,
        ],
        [exhausted, null, turnExhaustion, {}, false],
        [
            { ...exhausted, outcome: { ...exhausted.outcome, reason: "changed" } },
            null,
            turnExhaustion,
            { maxTurns: 0 },
            false,
        ],
        [
            { ...cancelled, outcome: { ...cancelled.outcome, reason: "changed" } },
            null,
            {
                consumed: { ...consumed, turns: 1 },
                reason: { message: cancellationMessage, type: "cancelled" },
                status: "cancelled",
            },
            {},
            true,
        ],
        [
            exhausted,
            null,
            { ...turnExhaustion, reason: { ...turnExhaustion.reason, observed: 0 } },
            { maxTurns: 0 },
            false,
        ],
        [
            exhausted,
            null,
            { ...turnExhaustion, reason: { ...turnExhaustion.reason, observed: 2 } },
            { maxTurns: 0 },
            false,
        ],
    ] as const) {
        assert.throws(() => decode(outcome, retainedUsage, control, budget, started), TypeError);
    }
});

test("persisted control codec rejects every malformed terminal discriminant", () => {
    const malformed = [
        { ...activeControl, status: "unknown" },
        { ...activeControl, reason: { message: "unexpected", type: "cancelled" } },
        {
            consumed,
            reason: { limit: 1, metric: "maxTurns", observed: 2, type: "unknown" },
            status: "exhausted",
        },
        {
            consumed,
            reason: { limit: 1, metric: "unknown", observed: 2, type: "budget_exhausted" },
            status: "exhausted",
        },
        { consumed, reason: { message: "cancelled", type: "unknown" }, status: "cancelled" },
        { consumed, reason: { message: 1, type: "cancelled" }, status: "cancelled" },
        { consumed, reason: { message: "", type: "cancelled" }, status: "cancelled" },
        { consumed, reason: { message: "\uD800", type: "cancelled" }, status: "cancelled" },
    ];
    for (const value of malformed) {
        assert.throws(() => readRunControlSnapshot(value), TypeError);
    }
});
