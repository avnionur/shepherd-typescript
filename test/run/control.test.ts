import assert from "node:assert/strict";
import { test } from "node:test";

import {
    createRunControl,
    RunBudgetExhaustedError,
    RunCancelledError,
    type RunControlSnapshot,
} from "../../src/index.ts";

test("createRunControl aborts with an immutable snapshot when consumption exceeds budget", () => {
    const control = createRunControl({ budget: { maxEffects: 4, maxTurns: 2 } });
    try {
        assert.deepEqual(control.consume({ effects: 2, turns: 1 }), {
            consumed: {
                costUsd: 0,
                effects: 2,
                inputTokens: 0,
                outputTokens: 0,
                turns: 1,
            },
            reason: null,
            status: "active",
        } satisfies RunControlSnapshot);

        const exhausted = control.consume({ effects: 1, turns: 2 });
        assert.deepEqual(exhausted, {
            consumed: {
                costUsd: 0,
                effects: 3,
                inputTokens: 0,
                outputTokens: 0,
                turns: 3,
            },
            reason: {
                limit: 2,
                metric: "turns",
                observed: 3,
                type: "budget_exhausted",
            },
            status: "exhausted",
        } satisfies RunControlSnapshot);
        assert.equal(control.signal.aborted, true);
        assert.equal(control.signal.reason instanceof RunBudgetExhaustedError, true);
        assert.equal(Object.isFrozen(exhausted), true);
        assert.equal(Object.isFrozen(exhausted.consumed), true);
        assert.equal(Object.isFrozen(exhausted.reason), true);
    } finally {
        control.dispose();
    }
});

test("caller AbortSignal cancellation wins once and rejects later consumption", () => {
    const caller = new AbortController();
    const control = createRunControl({ budget: { maxTurns: 2 }, signal: caller.signal });
    caller.abort("user requested stop");

    assert.deepEqual(control.snapshot(), {
        consumed: {
            costUsd: 0,
            effects: 0,
            inputTokens: 0,
            outputTokens: 0,
            turns: 0,
        },
        reason: { message: "run cancelled by caller", type: "cancelled" },
        status: "cancelled",
    } satisfies RunControlSnapshot);
    assert.equal(control.signal.reason instanceof RunCancelledError, true);
    assert.equal(control.signal.reason.cause, "user requested stop");
    assert.throws(() => control.consume({ turns: 1 }), RunCancelledError);

    caller.abort("ignored second reason");
    assert.equal(control.signal.reason.cause, "user requested stop");
    control.dispose();
});

test("duration budget aborts cooperatively and disposal cancels active control", async () => {
    const timed = createRunControl({ budget: { maxDurationMilliseconds: 5 } });
    await new Promise<void>((resolve) => {
        timed.signal.addEventListener("abort", () => resolve(), { once: true });
    });
    const timedSnapshot = timed.snapshot();
    assert.equal(timedSnapshot.status, "exhausted");
    assert.equal(timedSnapshot.reason?.type, "budget_exhausted");
    if (timedSnapshot.reason?.type === "budget_exhausted") {
        assert.equal(timedSnapshot.reason.metric, "duration_milliseconds");
        assert.equal(timedSnapshot.reason.limit, 5);
        assert.equal(timedSnapshot.reason.observed > 5, true);
    }

    const disposed = createRunControl({ budget: {} });
    disposed.dispose();
    disposed.dispose();
    assert.deepEqual(disposed.snapshot().reason, {
        message: "run control disposed",
        type: "cancelled",
    });
    assert.equal(disposed.signal.reason instanceof RunCancelledError, true);
});

test("every configured counter allows equality and exhausts on the next increment", () => {
    const cases = [
        ["turns", "maxTurns", 2],
        ["effects", "maxEffects", 3],
        ["inputTokens", "maxInputTokens", 4],
        ["outputTokens", "maxOutputTokens", 5],
        ["costUsd", "maxCostUsd", 0.25],
    ] as const;

    for (const [consumptionKey, budgetKey, limit] of cases) {
        const control = createRunControl({ budget: { [budgetKey]: limit } });
        assert.equal(control.consume({ [consumptionKey]: limit }).status, "active");
        const snapshot = control.consume({
            [consumptionKey]: consumptionKey === "costUsd" ? 0.01 : 1,
        });
        assert.equal(snapshot.status, "exhausted");
        if (snapshot.reason?.type === "budget_exhausted") {
            assert.equal(snapshot.reason.limit, limit);
        }
        control.dispose();
    }
});

test("the first terminal transition wins across pre-abort and exhaustion races", () => {
    const preAborted = new AbortController();
    preAborted.abort(new Error("already stopped"));
    const cancelled = createRunControl({
        budget: { maxDurationMilliseconds: 10 },
        signal: preAborted.signal,
    });
    assert.equal(cancelled.snapshot().status, "cancelled");
    assert.equal(cancelled.signal.reason.cause, preAborted.signal.reason);

    const caller = new AbortController();
    const exhausted = createRunControl({ budget: { maxTurns: 0 }, signal: caller.signal });
    exhausted.consume({ turns: 1 });
    caller.abort("too late");
    assert.equal(exhausted.snapshot().status, "exhausted");
    assert.equal(exhausted.signal.reason instanceof RunBudgetExhaustedError, true);
    exhausted.dispose();
    cancelled.dispose();
});

test("createRunControl rejects malformed options, limits, and consumption", () => {
    const invalidOptions: unknown[] = [
        null,
        [],
        {},
        { budget: {}, extra: true },
        { budget: null },
        { budget: [] },
        { budget: { unknown: 1 } },
        { budget: {}, signal: {} },
        { budget: { maxTurns: -1 } },
        { budget: { maxTurns: 0.5 } },
        { budget: { maxEffects: Number.MAX_SAFE_INTEGER + 1 } },
        { budget: { maxInputTokens: "1" } },
        { budget: { maxOutputTokens: Number.NaN } },
        { budget: { maxCostUsd: -1 } },
        { budget: { maxCostUsd: Number.POSITIVE_INFINITY } },
        { budget: { maxDurationMilliseconds: 0 } },
        { budget: { maxDurationMilliseconds: 2_147_483_647 } },
    ];
    const accessorOptions = { budget: {} };
    Object.defineProperty(accessorOptions, "signal", { get: () => undefined });
    invalidOptions.push(accessorOptions);

    for (const options of invalidOptions) {
        assert.throws(
            () => createRunControl(options as Parameters<typeof createRunControl>[0]),
            TypeError,
        );
    }

    const control = createRunControl({ budget: {} });
    for (const consumption of [
        null,
        [],
        { extra: 1 },
        { turns: -1 },
        { turns: 0.5 },
        { effects: "1" },
        { inputTokens: Number.MAX_SAFE_INTEGER + 1 },
        { outputTokens: Number.NaN },
        { costUsd: -1 },
        { costUsd: Number.POSITIVE_INFINITY },
    ]) {
        assert.throws(
            () => control.consume(consumption as Parameters<typeof control.consume>[0]),
            TypeError,
        );
    }
    control.consume({ effects: Number.MAX_SAFE_INTEGER });
    assert.throws(() => control.consume({ effects: 1 }), TypeError);
    control.dispose();

    const cost = createRunControl({ budget: {} });
    cost.consume({ costUsd: Number.MAX_VALUE });
    assert.throws(() => cost.consume({ costUsd: Number.MAX_VALUE }), TypeError);
    cost.dispose();
});
