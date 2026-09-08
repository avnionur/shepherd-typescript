import assert from "node:assert/strict";
import { test } from "node:test";
import {
    createEffectHandlerStack,
    createEffectIntent,
    createTypedEffectHandler,
    schema,
    validateEffectCorrelation,
} from "../../src/index.ts";

test("typed handlers validate direct calls and preserve immutable inputs and result data", async () => {
    const handler = createTypedEffectHandler({
        handlerId: "direct",
        kind: "format",
        payloadSchema: schema.object({ text: schema.string() }),
        handle: (payload, intent) => {
            assert.ok(
                Object.isFrozen(payload) &&
                    Object.isFrozen(intent) &&
                    Object.isFrozen(intent.payload),
            );
            return { ok: false, error: { message: payload.text } };
        },
    });
    assert.ok(Object.isFrozen(handler));
    const intent = createEffectIntent({
        effectId: "direct",
        kind: "format",
        payload: { text: "declined" },
        reversibility: "reversible",
    });
    const result = await handler.handle(intent);
    assert.deepEqual(result, { ok: false, error: { message: "declined" } });
    assert.ok(Object.isFrozen(result));
    await assert.rejects(
        async () => handler.handle({ ...intent, kind: "other" }),
        /kind does not match/u,
    );
    await assert.rejects(async () => handler.handle({ ...intent, intent_version: -1 }), TypeError);
    const voidHandler = createTypedEffectHandler({
        handlerId: "void",
        kind: "void",
        payloadSchema: schema.void(),
        handle: (payload) => {
            assert.equal(payload, undefined);
            return { ok: true, value: null };
        },
    });
    assert.deepEqual(
        await voidHandler.handle(
            createEffectIntent({
                effectId: "void",
                kind: "void",
                payload: null,
                reversibility: "reversible",
            }),
        ),
        { ok: true, value: null },
    );
});

test("typed handlers snapshot definitions and preserve callback errors and result validation", async () => {
    const options = {
        handlerId: "snapshot",
        kind: "format",
        payloadSchema: schema.string(),
        handle: (text: string) => ({ ok: true as const, value: text }),
    };
    const handler = createTypedEffectHandler(options);
    options.kind = "changed";
    options.handlerId = "changed";
    options.handle = () => {
        throw new Error("replacement must not run");
    };
    const intent = createEffectIntent({
        effectId: "snapshot",
        kind: "format",
        payload: "kept",
        reversibility: "reversible",
    });
    assert.equal(handler.handlerId, "snapshot");
    assert.deepEqual(await handler.handle(intent), { ok: true, value: "kept" });
    const failure = new Error("callback failure");
    const throwing = createTypedEffectHandler({
        handlerId: "throws",
        kind: "format",
        payloadSchema: schema.string(),
        handle: async () => {
            throw failure;
        },
    });
    await assert.rejects(
        async () => throwing.handle(intent),
        (error: unknown) => error === failure,
    );
    const invalid = createTypedEffectHandler({
        handlerId: "invalid",
        kind: "format",
        payloadSchema: schema.string(),
        handle: () => ({ ok: true, value: Number.NaN }),
    });
    await assert.rejects(async () => invalid.handle(intent), TypeError);
});

test("typed handler construction rejects unsafe options and unauthenticated schemas", () => {
    const valid = {
        handlerId: "valid",
        kind: "format",
        payloadSchema: schema.string(),
        handle: (value: string) => ({ ok: true as const, value }),
    };
    for (const invalid of [
        null,
        [],
        { ...valid, extra: true },
        { ...valid, handlerId: "" },
        { ...valid, kind: "" },
        { ...valid, handle: "not callable" },
        {
            ...valid,
            payloadSchema: { parse: () => "forged", toJSONSchema: () => ({ type: "string" }) },
        },
        { ...valid, [Symbol("extra")]: true },
    ]) {
        assert.throws(
            () => createTypedEffectHandler(invalid as unknown as typeof valid),
            TypeError,
        );
    }
    let accessed = false;
    const accessor = {
        ...valid,
        get payloadSchema() {
            accessed = true;
            return schema.string();
        },
    };
    assert.throws(() => createTypedEffectHandler(accessor), TypeError);
    assert.equal(accessed, false);
    const nullPrototype = Object.assign(Object.create(null), valid) as typeof valid;
    assert.equal(createTypedEffectHandler(nullPrototype).kind, "format");
});

test("typed effect handlers infer payloads and reject invalid data before invocation", async () => {
    let calls = 0;
    const handler = createTypedEffectHandler({
        handlerId: "typed",
        kind: "format",
        payloadSchema: schema.object({ text: schema.string() }),
        handle: (payload) => {
            calls++;
            const text: string = payload.text;
            return { ok: true, value: text.toUpperCase() };
        },
    });
    const stack = createEffectHandlerStack([handler]);
    const intent = createEffectIntent({
        effectId: "e",
        kind: "format",
        payload: { text: "hello" },
        reversibility: "reversible",
    });
    const result = await stack.dispatch(intent);
    assert.deepEqual(result.outcome.result, { ok: true, value: "HELLO" });
    validateEffectCorrelation(intent, result.outcome);
    assert.equal(calls, 1);
    await assert.rejects(
        stack.dispatch(
            createEffectIntent({
                effectId: "bad",
                kind: "format",
                payload: { text: 1 },
                reversibility: "reversible",
            }),
        ),
        TypeError,
    );
    assert.equal(calls, 1);
});
