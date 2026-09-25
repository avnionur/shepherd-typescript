import { createHash } from "node:crypto";

import type { ProtocolConfig } from "../../../src/protocol/config-types.ts";

type Schema = Readonly<Record<string, unknown>>;

/**
 * Renders the configured counterfactual optimizer record JSON Schema (applications protocol v9):
 * the opened record naming every per-example baseline session and score with the retained budgets
 * and thresholds, one proposal record per proposer iteration with its candidate plans, reflection,
 * refusals, and proposer sessions, one outcome record per candidate with its fix, guard, dev, and
 * train example results, gate verdict, and promotion reference, and the terminal selection record.
 *
 * @param config - Validated protocol configuration.
 * @returns The configured closed record schema.
 */
export function renderApplicationCroCandidateSchema(config: ProtocolConfig): Schema {
    const applications = config.applications;
    const cro = applications.cro;
    const [, croKind] = applications.kinds;
    const [openedPhase, proposalPhase, candidatePhase, selectionPhase] = cro.phases;
    const versions = {
        application_version: { const: applications.recordVersion },
        compatibility_version: { const: applications.compatibilityVersion },
    };
    const versionKeys = Object.keys(versions);
    const exampleIds = {
        type: "array",
        items: text(),
        maxItems: applications.limits.maxDatasetItems,
        uniqueItems: true,
    };
    const planProperties = {
        candidate_id: { $ref: "#/$defs/candidateId" },
        changes: {
            type: "array",
            items: { enum: [...config.replay.changes] },
            minItems: 1,
            maxItems: config.replay.changes.length,
            uniqueItems: true,
        },
        edit_scope: { enum: [...cro.editScopes] },
        edited_step_index: count(),
        fix_set: { ...exampleIds, minItems: 1 },
        guard_set: exampleIds,
        iteration: count(),
        mechanism: reason(config),
        name: text(),
        parent_candidate_id: nullable({ $ref: "#/$defs/candidateId" }),
        patch: {},
        prior: { type: "number", minimum: 0, maximum: 1 },
        rationale: reason(config),
    };
    const planKeys = Object.keys(planProperties);
    const failure = nullable({
        type: "object",
        required: ["code", "reason"],
        properties: {
            code: {
                enum: [applications.errors.evidenceCode, applications.errors.verificationCode],
            },
            reason: reason(config),
        },
        additionalProperties: false,
    });
    const results = { type: "array", items: { $ref: "#/$defs/exampleResult" } };
    const numbers = { type: "object", additionalProperties: { type: "number" } };
    return {
        $schema: config.kernel.schemas.dialect,
        $id: applications.schemas.croCandidateId,
        $comment: "Generated from protocol.config.json. Do not edit directly.",
        title: `Shepherd Application Counterfactual Candidate v${applications.recordVersion}`,
        description:
            "Counterfactual Replay Optimization records on the application owner path: the opened record naming every per-example baseline session and score, one proposal record per proposer iteration, one outcome record per candidate retaining its fix, guard, dev, and train example branches with divergence proofs, scores, parent scores, gate verdict, promotion reference, failure, and measured cost, and the terminal selection.",
        oneOf: [
            {
                type: "object",
                required: [
                    ...versionKeys,
                    "application_id",
                    "baselines",
                    "budgets",
                    "command_id",
                    "examples",
                    "kind",
                    "phase",
                    "protocol_id",
                    "thresholds",
                ].sort(),
                properties: {
                    ...versions,
                    application_id: prefixed(applications.identity.applicationIdPrefix, config),
                    baselines: {
                        type: "array",
                        items: { enum: [...cro.baselineKinds] },
                        uniqueItems: true,
                    },
                    budgets: { type: "object", additionalProperties: count() },
                    command_id: text(),
                    examples: {
                        type: "array",
                        minItems: cro.splits.length,
                        maxItems: applications.limits.maxDatasetItems,
                        items: {
                            type: "object",
                            required: [
                                "example_id",
                                "input_digest",
                                "score",
                                "session_id",
                                "split",
                            ],
                            properties: {
                                example_id: text(),
                                input_digest: { $ref: "#/$defs/digest" },
                                score: { type: "number" },
                                session_id: { $ref: "#/$defs/sessionId" },
                                split: { enum: [...cro.splits] },
                            },
                            additionalProperties: false,
                        },
                    },
                    kind: { const: croKind },
                    phase: { const: openedPhase },
                    protocol_id: prefixed(applications.identity.protocolIdPrefix, config),
                    thresholds: numbers,
                },
                additionalProperties: false,
            },
            {
                type: "object",
                required: [
                    ...versionKeys,
                    "application_id",
                    "attempts",
                    "candidates",
                    "failure",
                    "iteration",
                    "parent_candidate_id",
                    "phase",
                    "proposer_session_ids",
                    "reflection",
                    "refusals",
                ].sort(),
                properties: {
                    ...versions,
                    application_id: prefixed(applications.identity.applicationIdPrefix, config),
                    attempts: { type: "integer", minimum: 1 },
                    candidates: {
                        type: "array",
                        maxItems: applications.limits.maxCandidates,
                        items: {
                            type: "object",
                            required: planKeys,
                            properties: planProperties,
                            additionalProperties: false,
                        },
                    },
                    failure,
                    iteration: count(),
                    parent_candidate_id: nullable({ $ref: "#/$defs/candidateId" }),
                    phase: { const: proposalPhase },
                    proposer_session_ids: {
                        type: "array",
                        items: { $ref: "#/$defs/sessionId" },
                        uniqueItems: true,
                    },
                    reflection: {},
                    refusals: { type: "array", items: reason(config) },
                },
                additionalProperties: false,
            },
            {
                type: "object",
                required: [
                    ...planKeys,
                    ...versionKeys,
                    "application_id",
                    "cost",
                    "dev",
                    "dev_score",
                    "failure",
                    "gate",
                    "phase",
                    "promotion_reference",
                    "status",
                    "targeted",
                    "train",
                ].sort(),
                properties: {
                    ...versions,
                    ...planProperties,
                    application_id: prefixed(applications.identity.applicationIdPrefix, config),
                    cost: { $ref: "#/$defs/cost" },
                    dev: nullable(results),
                    dev_score: nullable({ type: "number" }),
                    failure,
                    gate: nullable({
                        type: "object",
                        required: [
                            "aggregate_lift",
                            "improve_fraction",
                            "max_guard_drop",
                            "passed",
                            "reason",
                        ],
                        properties: {
                            aggregate_lift: { type: "number" },
                            improve_fraction: { type: "number", minimum: 0, maximum: 1 },
                            max_guard_drop: { type: "number", minimum: 0 },
                            passed: { type: "boolean" },
                            reason: reason(config),
                        },
                        additionalProperties: false,
                    }),
                    phase: { const: candidatePhase },
                    promotion_reference: nullable({ type: "number" }),
                    status: { enum: [...cro.candidateStatuses] },
                    targeted: results,
                    train: nullable(results),
                },
                additionalProperties: false,
            },
            {
                type: "object",
                required: [
                    ...versionKeys,
                    "application_id",
                    "dev_score",
                    "phase",
                    "pool",
                    "selected_candidate_id",
                ].sort(),
                properties: {
                    ...versions,
                    application_id: prefixed(applications.identity.applicationIdPrefix, config),
                    dev_score: { type: "number" },
                    phase: { const: selectionPhase },
                    pool: {
                        type: "array",
                        items: { $ref: "#/$defs/candidateId" },
                        maxItems: applications.limits.maxCandidates,
                        uniqueItems: true,
                    },
                    selected_candidate_id: nullable({ $ref: "#/$defs/candidateId" }),
                },
                additionalProperties: false,
            },
        ],
        $defs: {
            candidateId: prefixed(applications.identity.candidateIdPrefix, config),
            cost: {
                type: "object",
                required: [
                    "cache_creation_input_tokens",
                    "cache_read_input_tokens",
                    "cost_usd",
                    "input_tokens",
                    "output_tokens",
                    "provider_calls",
                ],
                properties: {
                    cache_creation_input_tokens: count(),
                    cache_read_input_tokens: count(),
                    cost_usd: nullable({ type: "number", minimum: 0 }),
                    input_tokens: count(),
                    output_tokens: count(),
                    provider_calls: count(),
                },
                additionalProperties: false,
            },
            digest: {
                type: "string",
                pattern: `^${escapePattern(applications.identity.digestAlgorithm)}:[0-9a-f]{${hexLengthOf(config)}}$`,
            },
            exampleResult: {
                type: "object",
                required: [
                    "affected_steps",
                    "baseline",
                    "cost",
                    "divergence",
                    "example_id",
                    "parent_score",
                    "role",
                    "score",
                    "session_id",
                    "target",
                ],
                properties: {
                    affected_steps: { $ref: "#/$defs/indices" },
                    baseline: nullable({
                        type: "object",
                        required: [
                            "cache_read_input_tokens",
                            "kind",
                            "provider_calls",
                            "session_id",
                        ],
                        properties: {
                            cache_read_input_tokens: count(),
                            kind: { enum: [...cro.baselineKinds] },
                            provider_calls: count(),
                            session_id: { $ref: "#/$defs/sessionId" },
                        },
                        additionalProperties: false,
                    }),
                    cost: { $ref: "#/$defs/cost" },
                    divergence: {
                        type: "object",
                        required: [
                            "common_prefix_id",
                            "first_divergence_index",
                            "live_steps",
                            "recorded_steps",
                            "unexplained",
                        ],
                        properties: {
                            common_prefix_id: nullable({ $ref: "#/$defs/prefixId" }),
                            first_divergence_index: nullable(count()),
                            live_steps: count(),
                            recorded_steps: count(),
                            unexplained: { $ref: "#/$defs/indices" },
                        },
                        additionalProperties: false,
                    },
                    example_id: text(),
                    parent_score: { type: "number" },
                    role: { enum: [...cro.exampleRoles] },
                    score: { type: "number" },
                    session_id: { $ref: "#/$defs/sessionId" },
                    target: {
                        type: "object",
                        required: ["prefix_id", "source_session_id", "step_index"],
                        properties: {
                            prefix_id: nullable({ $ref: "#/$defs/prefixId" }),
                            source_session_id: { $ref: "#/$defs/sessionId" },
                            step_index: count(),
                        },
                        additionalProperties: false,
                    },
                },
                additionalProperties: false,
            },
            indices: {
                type: "array",
                items: count(),
                maxItems: config.replay.limits.maxSteps,
                uniqueItems: true,
            },
            prefixId: prefixed(config.replay.identity.prefixIdPrefix, config),
            sessionId: prefixed(config.replay.identity.sessionIdPrefix, config),
        },
    };
}

function hexLengthOf(config: ProtocolConfig): number {
    return createHash(config.applications.identity.digestAlgorithm).digest("hex").length;
}

function count(): Schema {
    return { type: "integer", minimum: 0 };
}

function nullable(schema: Schema): Schema {
    return { oneOf: [{ type: "null" }, schema] };
}

function reason(config: ProtocolConfig): Schema {
    return {
        type: "string",
        minLength: 1,
        maxLength: config.applications.limits.maxReasonLength,
    };
}

function prefixed(prefix: string, config: ProtocolConfig): Schema {
    return {
        type: "string",
        pattern: `^${escapePattern(prefix)}[0-9a-f]{${hexLengthOf(config)}}$`,
    };
}

function text(): Schema {
    return { type: "string", minLength: 1 };
}

function escapePattern(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
