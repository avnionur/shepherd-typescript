import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { Ajv2020, type AnySchemaObject } from "ajv/dist/2020.js";

import {
    EFFECT_PROTOCOL_V1_CONTRACT,
    EFFECT_PROTOCOL_V4_CONTRACT,
} from "../../src/protocol/compatibility-constants.ts";
import { parseProtocolConfig } from "../../src/protocol/config-validation.ts";

const validConfig = readJson("../../protocol.config.json") as Record<string, unknown>;
const fixture = readJson("../fixtures/effect-record-v1.json") as Record<string, unknown>;
const intentSchema = readJson("../../spec/schemas/effect-intent-v1.schema.json") as AnySchemaObject;
const outcomeSchema = readJson(
    "../../spec/schemas/effect-outcome-v1.schema.json",
) as AnySchemaObject;
const compensationSchema = readJson(
    "../../spec/schemas/effect-compensation-v1.schema.json",
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

    assert.deepEqual(parsed.effects, EFFECT_PROTOCOL_V4_CONTRACT);
    const { compensation: _compensation, ...v1 } = parsed.effects;
    assert.deepEqual(v1, EFFECT_PROTOCOL_V1_CONTRACT);
    assert.equal(Object.isFrozen(parsed.effects.compensation), true);
    assert.equal(Object.isFrozen(parsed.effects), true);
    assert.equal(Object.isFrozen(parsed.effects.handlers), true);
    assert.equal(Object.isFrozen(parsed.effects.reversibilityTiers), true);

    for (const [key, value] of [
        ["leaseMilliseconds", 0],
        ["renewalMilliseconds", 30_000],
        ["statuses", ["absent"]],
        ["claimIdPrefix", ""],
        ["leaseMilliseconds", 40_000],
    ] as const) {
        const candidate = structuredClone(validConfig);
        const compensation = (
            candidate.effects as { compensation: { ownership: Record<string, unknown> } }
        ).compensation;
        compensation.ownership[key] = value;
        assert.throws(() => parseProtocolConfig(candidate), TypeError);
    }

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
        (effects: Record<string, unknown>) => {
            delete effects.compensation;
        },
        (effects: Record<string, unknown>) => {
            (effects.compensation as Record<string, unknown>).compensableTiers = ["unknown"];
        },
        (effects: Record<string, unknown>) => {
            (effects.compensation as Record<string, unknown>).phases = ["intent", "outcome"];
        },
        (effects: Record<string, unknown>) => {
            const identity = (effects.compensation as Record<string, Record<string, unknown>>)
                .identity as Record<string, unknown>;
            identity.compensationIdPrefix = "effect-compensation:";
        },
        (effects: Record<string, unknown>) => {
            (effects.compensation as Record<string, unknown>).limits = {
                maxEffectsPerTrigger: 0,
            };
        },
        (effects: Record<string, unknown>) => {
            (effects.compensation as Record<string, Record<string, unknown>>).errors = {};
        },
        (effects: Record<string, unknown>) => {
            (effects.compensation as Record<string, unknown>).triggers = [
                "scope_discard",
                "replay_rewind",
                "replay_replay",
                "command",
                "refusal",
            ];
        },
        (effects: Record<string, unknown>) => {
            (effects.compensation as Record<string, unknown>).recordVersion = 2;
        },
    ]) {
        const candidate = structuredClone(validConfig);
        mutate(candidate.effects as Record<string, unknown>);
        assert.throws(() => parseProtocolConfig(candidate), TypeError);
    }
});

test("published compensation schema accepts each record phase and rejects malformed records", () => {
    const validator = new Ajv2020({ strict: true });
    const validate = validator.compile(compensationSchema);
    const common = {
        compatibility_version: "shepherd.effect-compensation.v1",
        compensation_id: `effect-compensation:sha256:${"a".repeat(64)}`,
        record_version: 1,
    };
    const intent = {
        ...common,
        effect_intent: fixture.intent,
        effect_outcome: fixture.outcome,
        materialization: { kind: "replay_step", record_id: `sha256:${"b".repeat(64)}` },
        phase: "intent",
    };
    const attempt = {
        ...common,
        attempt: 1,
        handler_id: "compensation:rows",
        phase: "attempt",
        trigger: { command_id: "rewind:1", kind: "replay_rewind" },
    };
    const outcome = {
        ...common,
        attempt: 1,
        phase: "outcome",
        result: { ok: true, value: null },
        status: "compensated",
    };
    for (const record of [intent, attempt, outcome]) {
        assert.equal(validate(record), true, validator.errorsText(validate.errors));
    }
    assert.equal(validate({ ...intent, extra: true }), false);
    assert.equal(
        validate({ ...intent, materialization: { kind: "other", record_id: "x" } }),
        false,
    );
    assert.equal(validate({ ...attempt, attempt: 0 }), false);
    assert.equal(validate({ ...attempt, trigger: { command_id: "x", kind: "refusal" } }), false);
    assert.equal(validate({ ...outcome, status: "partial" }), false);
    assert.equal(validate({ ...outcome, compensation_id: "effect-compensation:x" }), false);
});

function readJson(relativePath: string): unknown {
    return JSON.parse(readFileSync(new URL(relativePath, import.meta.url), "utf8")) as unknown;
}
