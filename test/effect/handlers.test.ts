import assert from "node:assert/strict";
import { test } from "node:test";

import {
    createEffectHandlerStack,
    createEffectIntent,
    EffectHandlerNotFoundError,
    validateEffectCorrelation,
} from "../../src/index.ts";

test("effect handler stack dispatches through the last exact matching handler", async () => {
    const calls: string[] = [];
    const intent = createIntent();
    const handlers = createEffectHandlerStack([
        {
            handle: () => {
                calls.push("outer");
                return { ok: true, value: "outer" };
            },
            handlerId: "handler.outer",
            kind: "tool.call",
        },
        {
            handle: async (current) => {
                calls.push("inner");
                return { ok: true, value: current.effect_id };
            },
            handlerId: "handler.inner",
            kind: "tool.call",
        },
        {
            handle: () => {
                calls.push("other");
                return { ok: true, value: null };
            },
            handlerId: "handler.other",
            kind: "model.call",
        },
    ]);

    const dispatch = await handlers.dispatch(intent);

    assert.equal(dispatch.handlerId, "handler.inner");
    assert.equal(dispatch.outcome.result.ok, true);
    if (dispatch.outcome.result.ok) {
        assert.equal(dispatch.outcome.result.value, "effect:tool:1");
    }
    assert.deepEqual(calls, ["inner"]);
    assert.equal(validateEffectCorrelation(intent, dispatch.outcome), dispatch.outcome);
    assert.equal(Object.isFrozen(dispatch), true);
    assert.equal(Object.isFrozen(dispatch.outcome), true);
});

test("effect handler stack snapshots definitions and supports failure results", async () => {
    const definition = {
        handle: () => ({ error: { code: "denied" }, ok: false as const }),
        handlerId: "handler.failure",
        kind: "tool.call",
    };
    const handlers = createEffectHandlerStack([definition]);
    definition.handlerId = "mutated";
    definition.kind = "model.call";

    const dispatch = await handlers.dispatch(createIntent());

    assert.equal(dispatch.handlerId, "handler.failure");
    assert.equal(dispatch.outcome.result.ok, false);
    if (!dispatch.outcome.result.ok) {
        assert.deepEqual(dispatch.outcome.result.error, { code: "denied" });
    }
});

test("effect handler stack rejects unhandled intents and preserves handler failures", async () => {
    const intent = createIntent();
    const empty = createEffectHandlerStack([]);

    await assert.rejects(
        empty.dispatch(intent),
        (error: unknown) =>
            error instanceof EffectHandlerNotFoundError &&
            error.effectId === intent.effect_id &&
            error.kind === intent.kind,
    );

    const failure = new Error("handler failed");
    const throwing = createEffectHandlerStack([
        {
            handle: () => {
                throw failure;
            },
            handlerId: "handler.throwing",
            kind: "tool.call",
        },
    ]);
    await assert.rejects(throwing.dispatch(intent), (error: unknown) => error === failure);
});

test("effect handler stack validates intents before invoking handlers", async () => {
    let called = false;
    const handlers = createEffectHandlerStack([
        {
            handle: () => {
                called = true;
                return { ok: true, value: null };
            },
            handlerId: "handler.safe",
            kind: "tool.call",
        },
    ]);
    const malformed = { ...createIntent(), intent_version: 2 };

    await assert.rejects(handlers.dispatch(malformed as never), TypeError);
    assert.equal(called, false);
});

test("effect handler stack rejects malformed definitions, arrays, and results", async () => {
    for (const invalid of [
        null,
        {},
        [new Date()],
        [["nested"]],
        [{ [Symbol("invalid")]: true }],
        [{ handlerId: "", kind: "tool.call", handle: () => ({ ok: true, value: null }) }],
        [{ handlerId: "handler", kind: "", handle: () => ({ ok: true, value: null }) }],
        [{ handlerId: "handler", kind: "tool.call", handle: null }],
        [
            {
                extra: true,
                handlerId: "handler",
                kind: "tool.call",
                handle: () => ({ ok: true, value: null }),
            },
        ],
        [
            {
                handlerId: "duplicate",
                kind: "tool.call",
                handle: () => ({ ok: true, value: null }),
            },
            {
                handlerId: "duplicate",
                kind: "model.call",
                handle: () => ({ ok: true, value: null }),
            },
        ],
    ]) {
        assert.throws(() => createEffectHandlerStack(invalid as never), TypeError);
    }

    const sparse = new Array(1);
    assert.throws(() => createEffectHandlerStack(sparse as never), TypeError);
    const custom = [] as unknown[] & { custom?: boolean };
    custom.custom = true;
    assert.throws(() => createEffectHandlerStack(custom as never), TypeError);
    const symbolArray = Object.assign([], { [Symbol("invalid")]: true });
    assert.throws(() => createEffectHandlerStack(symbolArray as never), TypeError);
    const accessorDefinition = {
        handle: () => ({ ok: true, value: null }),
        kind: "tool.call",
    };
    const accessor = [
        Object.defineProperty(accessorDefinition, "handlerId", {
            enumerable: true,
            get: () => "handler.accessor",
        }),
    ];
    assert.throws(() => createEffectHandlerStack(accessor as never), TypeError);

    const invalidResult = createEffectHandlerStack([
        {
            handle: () => ({ ok: true }) as never,
            handlerId: "handler.invalid-result",
            kind: "tool.call",
        },
    ]);
    await assert.rejects(invalidResult.dispatch(createIntent()), TypeError);
});

function createIntent() {
    return createEffectIntent({
        effectId: "effect:tool:1",
        kind: "tool.call",
        payload: { command: "pnpm test" },
        reversibility: "irreversible",
    });
}
