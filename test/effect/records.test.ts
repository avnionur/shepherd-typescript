import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
    createEffectIntent,
    createEffectOutcome,
    validateEffectCorrelation,
} from "../../src/index.ts";

const fixture = JSON.parse(
    readFileSync(new URL("../fixtures/effect-record-v1.json", import.meta.url), "utf8"),
) as Readonly<Record<string, unknown>>;

test("effect builders create immutable versioned intent and outcome records", () => {
    const intent = createFixtureIntent();
    const outcome = createEffectOutcome(intent, {
        ok: true,
        value: { exitCode: 0 },
    });

    assert.deepEqual(intent, fixture.intent);
    assert.deepEqual(outcome, fixture.outcome);
    assert.equal(Object.isFrozen(intent), true);
    assert.equal(Object.isFrozen(intent.payload), true);
    assert.equal(Object.isFrozen(outcome), true);
    assert.equal(Object.isFrozen(outcome.result), true);
    if (outcome.result.ok) {
        assert.equal(Object.isFrozen(outcome.result.value), true);
    }
});

test("effect intent references change with every semantic intent field", () => {
    const baseline = createFixtureIntent();
    const variants = [
        createEffectIntent({
            effectId: "effect:tool:2",
            kind: "tool.call",
            payload: { command: "pnpm test" },
            reversibility: "irreversible",
        }),
        createEffectIntent({
            effectId: "effect:tool:1",
            kind: "tool.other",
            payload: { command: "pnpm test" },
            reversibility: "irreversible",
        }),
        createEffectIntent({
            effectId: "effect:tool:1",
            kind: "tool.call",
            payload: { command: "pnpm lint" },
            reversibility: "irreversible",
        }),
        createEffectIntent({
            effectId: "effect:tool:1",
            kind: "tool.call",
            payload: { command: "pnpm test" },
            reversibility: "compensable",
        }),
    ];

    for (const variant of variants) {
        assert.notEqual(
            createEffectOutcome(variant, { ok: true, value: null }).intent_ref,
            createEffectOutcome(baseline, { ok: true, value: null }).intent_ref,
        );
    }
});

test("effect outcomes preserve success and failure result types", () => {
    const intent = createFixtureIntent();
    const success = createEffectOutcome(intent, { ok: true, value: { exitCode: 0 } });
    const failure = createEffectOutcome(intent, {
        error: { code: "command_failed" },
        ok: false,
    });

    assert.equal(success.result.ok, true);
    if (success.result.ok) {
        assert.deepEqual(success.result.value, { exitCode: 0 });
    }
    assert.equal(failure.result.ok, false);
    if (!failure.result.ok) {
        assert.deepEqual(failure.result.error, { code: "command_failed" });
    }
    assert.equal(validateEffectCorrelation(intent, success), success);
    assert.equal(validateEffectCorrelation(intent, failure), failure);
});

test("effect correlation rejects altered or malformed outcomes", () => {
    const intent = createFixtureIntent();
    const outcome = createEffectOutcome(intent, { ok: true, value: null });

    for (const invalidIntent of [
        { ...intent, intent_version: 2 },
        { ...intent, phase: "outcome" },
        { ...intent, reversibility: "unknown" },
    ]) {
        assert.throws(
            () => createEffectOutcome(invalidIntent as never, { ok: true, value: null }),
            TypeError,
        );
    }

    for (const invalid of [
        { ...outcome, effect_id: "effect:other" },
        { ...outcome, kind: "tool.other" },
        { ...outcome, intent_ref: outcome.intent_ref.replace(/.$/u, "0") },
        { ...outcome, outcome_version: 2 },
        { ...outcome, phase: "intent" },
        { ...outcome, extra: true },
        Object.defineProperty({ ...outcome }, "kind", { get: () => "tool.call" }),
    ]) {
        assert.throws(() => validateEffectCorrelation(intent, invalid), TypeError);
    }
});

test("effect builders reject malformed definitions and semantic values", () => {
    const intent = createFixtureIntent();
    for (const invalid of [
        null,
        [],
        new Date(),
        {},
        { effectId: "", kind: "tool.call", payload: null, reversibility: "irreversible" },
        { effectId: "effect:1", kind: "", payload: null, reversibility: "irreversible" },
        { effectId: "effect:1", kind: "tool.call", payload: null, reversibility: "unknown" },
        {
            effectId: "effect:1",
            extra: true,
            kind: "tool.call",
            payload: null,
            reversibility: "irreversible",
        },
        Object.defineProperty(
            {
                effectId: "effect:1",
                kind: "tool.call",
                payload: null,
                reversibility: "irreversible",
            },
            "kind",
            { get: () => "tool.call" },
        ),
        {
            effectId: "effect:1",
            kind: "tool.call",
            payload: Number.NaN,
            reversibility: "irreversible",
        },
        {
            effectId: "effect:1",
            kind: "tool.call",
            payload: undefined,
            reversibility: "irreversible",
        },
    ]) {
        assert.throws(() => createEffectIntent(invalid as never), TypeError);
    }
    for (const invalid of [
        null,
        {},
        { ok: true },
        { ok: true, value: null, extra: true },
        { ok: true, value: undefined },
        { error: null, ok: false, value: null },
        { error: Number.NaN, ok: false },
    ]) {
        assert.throws(() => createEffectOutcome(intent, invalid as never), TypeError);
    }
});

function createFixtureIntent() {
    return createEffectIntent({
        effectId: "effect:tool:1",
        kind: "tool.call",
        payload: { command: "pnpm test" },
        reversibility: "irreversible",
    });
}
