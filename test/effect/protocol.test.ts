import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { Ajv2020, type AnySchemaObject } from "ajv/dist/2020.js";

import { EFFECT_PROTOCOL_V1_CONTRACT } from "../../src/protocol/compatibility-constants.ts";
import { parseProtocolConfig } from "../../src/protocol/config-validation.ts";

const validConfig = readJson("../../protocol.config.json") as Record<string, unknown>;
const fixture = readJson("../fixtures/effect-record-v1.json") as Record<string, unknown>;
const intentSchema = readJson("../../spec/schemas/effect-intent-v1.schema.json") as AnySchemaObject;
const outcomeSchema = readJson(
    "../../spec/schemas/effect-outcome-v1.schema.json",
) as AnySchemaObject;

test("published effect schemas accept the independent intent and outcome fixture", () => {
    const validator = new Ajv2020({ strict: true });
    const validateIntent = validator.compile(intentSchema);
    const validateOutcome = validator.compile(outcomeSchema);

    assert.equal(validateIntent(fixture.intent), true, validator.errorsText(validateIntent.errors));
    assert.equal(
        validateOutcome(fixture.outcome),
        true,
        validator.errorsText(validateOutcome.errors),
    );
});

test("published effect schemas reject malformed closed records", () => {
    const validator = new Ajv2020({ strict: true });
    const validateIntent = validator.compile(intentSchema);
    const validateOutcome = validator.compile(outcomeSchema);
    const intent = fixture.intent as Record<string, unknown>;
    const outcome = fixture.outcome as Record<string, unknown>;

    assert.equal(validateIntent({ ...intent, reversibility: "unknown" }), false);
    assert.equal(validateIntent({ ...intent, extra: true }), false);
    assert.equal(validateOutcome({ ...outcome, intent_ref: "invalid" }), false);
    assert.equal(validateOutcome({ ...outcome, result: { ok: true } }), false);
    assert.equal(validateOutcome({ ...outcome, extra: true }), false);
});

test("effect protocol configuration is frozen and compatibility locked", () => {
    const parsed = parseProtocolConfig(structuredClone(validConfig));

    assert.deepEqual(parsed.effects, EFFECT_PROTOCOL_V1_CONTRACT);
    assert.equal(Object.isFrozen(parsed.effects), true);
    assert.equal(Object.isFrozen(parsed.effects.handlers), true);
    assert.equal(Object.isFrozen(parsed.effects.reversibilityTiers), true);

    for (const mutate of [
        (effects: Record<string, unknown>) => {
            effects.intentVersion = 0;
        },
        (effects: Record<string, unknown>) => {
            (effects.handlers as Record<string, unknown>).selection = "first_matching";
        },
        (effects: Record<string, unknown>) => {
            (effects.handlers as Record<string, unknown>).unhandled = "ignore";
        },
        (effects: Record<string, unknown>) => {
            effects.intentVersion = 2;
        },
        (effects: Record<string, unknown>) => {
            effects.digestPrefix = "digest:";
        },
        (effects: Record<string, unknown>) => {
            effects.hexLength = 63;
        },
        (effects: Record<string, unknown>) => {
            effects.reversibilityTiers = [];
        },
        (effects: Record<string, unknown>) => {
            const phases = effects.phases as Record<string, unknown>;
            phases.outcome = phases.intent;
        },
    ]) {
        const candidate = structuredClone(validConfig);
        mutate(candidate.effects as Record<string, unknown>);
        assert.throws(() => parseProtocolConfig(candidate), TypeError);
    }
});

function readJson(relativePath: string): unknown {
    return JSON.parse(readFileSync(new URL(relativePath, import.meta.url), "utf8")) as unknown;
}
