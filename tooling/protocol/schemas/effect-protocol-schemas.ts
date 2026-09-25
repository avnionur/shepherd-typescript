import type { ProtocolConfig } from "../../../src/protocol/config-types.ts";

/**
 * Renders the normative effect intent v1 JSON Schema.
 *
 * @param config - Validated protocol configuration.
 * @returns The configured closed effect-intent schema.
 */
export function renderEffectIntentSchema(
    config: ProtocolConfig,
): Readonly<Record<string, unknown>> {
    return {
        $schema: config.kernel.schemas.dialect,
        $id: config.effects.schemas.intentId,
        $comment: "Generated from protocol.config.json. Do not edit directly.",
        title: "Shepherd Effect Intent v1",
        description: "Typed action record emitted before an effect may materialize.",
        type: "object",
        required: ["effect_id", "intent_version", "kind", "payload", "phase", "reversibility"],
        properties: {
            effect_id: { type: "string", minLength: 1 },
            intent_version: { const: config.effects.intentVersion },
            kind: { type: "string", minLength: 1 },
            payload: { $ref: "#/$defs/semanticValue" },
            phase: { const: config.effects.phases.intent },
            reversibility: { enum: [...config.effects.reversibilityTiers] },
        },
        additionalProperties: false,
        $defs: { semanticValue: semanticValueSchema() },
    };
}

/**
 * Renders the normative effect outcome v1 JSON Schema.
 *
 * @param config - Validated protocol configuration.
 * @returns The configured closed effect-outcome schema.
 */
export function renderEffectOutcomeSchema(
    config: ProtocolConfig,
): Readonly<Record<string, unknown>> {
    return {
        $schema: config.kernel.schemas.dialect,
        $id: config.effects.schemas.outcomeId,
        $comment: "Generated from protocol.config.json. Do not edit directly.",
        title: "Shepherd Effect Outcome v1",
        description: "Typed world response bound to one complete canonical effect intent.",
        type: "object",
        required: ["effect_id", "intent_ref", "kind", "outcome_version", "phase", "result"],
        properties: {
            effect_id: { type: "string", minLength: 1 },
            intent_ref: {
                type: "string",
                pattern: `^${escapeRegularExpression(config.effects.digestPrefix)}[0-9a-f]{${
                    config.effects.hexLength
                }}$`,
            },
            kind: { type: "string", minLength: 1 },
            outcome_version: { const: config.effects.outcomeVersion },
            phase: { const: config.effects.phases.outcome },
            result: {
                oneOf: [
                    {
                        type: "object",
                        required: ["ok", "value"],
                        properties: {
                            ok: { const: true },
                            value: { $ref: "#/$defs/semanticValue" },
                        },
                        additionalProperties: false,
                    },
                    {
                        type: "object",
                        required: ["error", "ok"],
                        properties: {
                            error: { $ref: "#/$defs/semanticValue" },
                            ok: { const: false },
                        },
                        additionalProperties: false,
                    },
                ],
            },
        },
        additionalProperties: false,
        $defs: { semanticValue: semanticValueSchema() },
    };
}

/**
 * Renders the normative effect compensation v1 JSON Schema: one closed branch per record phase.
 *
 * @param config - Validated protocol configuration.
 * @returns The configured compensation record schema.
 */
export function renderEffectCompensationSchema(
    config: ProtocolConfig,
): Readonly<Record<string, unknown>> {
    const compensation = config.effects.compensation;
    const [intentPhase, attemptPhase, outcomePhase] = compensation.phases;
    const recordId = {
        type: "string",
        pattern: `^${escapeRegularExpression(config.recordId.prefix)}[0-9a-f]{${
            config.recordId.hexLength
        }}$`,
    };
    const common = {
        compatibility_version: { const: compensation.compatibilityVersion },
        compensation_id: {
            type: "string",
            pattern: `^${escapeRegularExpression(
                compensation.identity.compensationIdPrefix,
            )}[0-9a-f]{${config.effects.hexLength}}$`,
        },
        record_version: { const: compensation.recordVersion },
    };
    const commonRequired = ["compatibility_version", "compensation_id", "phase", "record_version"];
    const {
        $defs: _intentDefs,
        $schema: _intentDialect,
        $id: _intentId,
        $comment: _intentComment,
        ...effectIntent
    } = renderEffectIntentSchema(config);
    const {
        $defs: _outcomeDefs,
        $schema: _outcomeDialect,
        $id: _outcomeId,
        $comment: _outcomeComment,
        ...effectOutcome
    } = renderEffectOutcomeSchema(config);
    const outcomeProperties = effectOutcome.properties as Readonly<Record<string, unknown>>;
    return {
        $schema: config.kernel.schemas.dialect,
        $id: compensation.schemaId,
        $comment: "Generated from protocol.config.json. Do not edit directly.",
        title: "Shepherd Effect Compensation v1",
        description:
            "Durable intent, attempt, and outcome of compensating one materialized compensable effect.",
        oneOf: [
            {
                type: "object",
                required: [
                    ...commonRequired,
                    "effect_intent",
                    "effect_outcome",
                    "materialization",
                ].sort(),
                properties: {
                    ...common,
                    effect_intent: { $ref: "#/$defs/effectIntent" },
                    effect_outcome: { $ref: "#/$defs/effectOutcome" },
                    materialization: {
                        type: "object",
                        required: ["kind", "record_id"],
                        properties: {
                            kind: { enum: [...compensation.evidenceKinds] },
                            record_id: recordId,
                        },
                        additionalProperties: false,
                    },
                    phase: { const: intentPhase },
                },
                additionalProperties: false,
            },
            {
                type: "object",
                required: [...commonRequired, "attempt", "handler_id", "trigger"].sort(),
                properties: {
                    ...common,
                    attempt: { type: "integer", minimum: 1 },
                    handler_id: { type: "string", minLength: 1 },
                    phase: { const: attemptPhase },
                    trigger: {
                        type: "object",
                        required: ["command_id", "kind"],
                        properties: {
                            command_id: { type: "string", minLength: 1 },
                            kind: { enum: [...compensation.triggers] },
                        },
                        additionalProperties: false,
                    },
                },
                additionalProperties: false,
            },
            {
                type: "object",
                required: [...commonRequired, "attempt", "result", "status"].sort(),
                properties: {
                    ...common,
                    attempt: { type: "integer", minimum: 1 },
                    phase: { const: outcomePhase },
                    result: outcomeProperties.result,
                    status: { enum: [...compensation.outcomes] },
                },
                additionalProperties: false,
            },
        ],
        $defs: {
            effectIntent,
            effectOutcome,
            semanticValue: semanticValueSchema(),
        },
    };
}

function semanticValueSchema(): Readonly<Record<string, unknown>> {
    return {
        anyOf: [
            { type: "boolean" },
            { type: "null" },
            { type: "number" },
            { type: "string" },
            { type: "array", items: { $ref: "#/$defs/semanticValue" } },
            { type: "object", additionalProperties: { $ref: "#/$defs/semanticValue" } },
        ],
    };
}

function escapeRegularExpression(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
