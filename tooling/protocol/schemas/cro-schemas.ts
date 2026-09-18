import { createHash } from "node:crypto";

import type { ProtocolConfig } from "../../../src/protocol/config-types.ts";

type Schema = Readonly<Record<string, unknown>>;

/**
 * Renders the configured counterfactual optimizer record JSON Schema: the opened record naming the
 * baseline session and the declared candidate plan, and the candidate record retaining one
 * candidate's status, lineage, target, affected steps, branch identity, divergence summary,
 * verdict, failure, measured cost, and whole-workflow comparison.
 *
 * @param config - Validated protocol configuration.
 * @returns The configured closed candidate record schema.
 */
export function renderApplicationCroCandidateSchema(config: ProtocolConfig): Schema {
    const applications = config.applications;
    const cro = applications.cro;
    const [, croKind] = applications.kinds;
    const [openedPhase, candidatePhase] = cro.phases;
    const versions = {
        application_version: { const: applications.recordVersion },
        compatibility_version: { const: applications.compatibilityVersion },
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
        edited_step_index: count(),
        name: text(),
        parent_candidate_id: nullable({ $ref: "#/$defs/candidateId" }),
    };
    const planKeys = Object.keys(planProperties);
    return {
        $schema: config.kernel.schemas.dialect,
        $id: applications.schemas.croCandidateId,
        $comment: "Generated from protocol.config.json. Do not edit directly.",
        title: `Shepherd Application Counterfactual Candidate v${applications.recordVersion}`,
        description:
            "Counterfactual optimizer records on the application owner path: the opened record naming the baseline session, comparison baselines, and declared candidate plan, and one record per candidate status retaining lineage, the affected-suffix target, the branch session, the divergence proof summary, the evaluator verdict or failure, measured cost, and the whole-workflow comparison.",
        oneOf: [
            {
                type: "object",
                required: [
                    "application_id",
                    "application_version",
                    "baseline_session_id",
                    "baselines",
                    "candidates",
                    "command_id",
                    "compatibility_version",
                    "kind",
                    "phase",
                    "protocol_id",
                ],
                properties: {
                    ...versions,
                    application_id: prefixed(applications.identity.applicationIdPrefix, config),
                    baseline_session_id: { $ref: "#/$defs/sessionId" },
                    baselines: {
                        type: "array",
                        items: { enum: [...cro.baselineKinds] },
                        uniqueItems: true,
                    },
                    candidates: {
                        type: "array",
                        minItems: 1,
                        maxItems: applications.limits.maxCandidates,
                        items: {
                            type: "object",
                            required: planKeys,
                            properties: planProperties,
                            additionalProperties: false,
                        },
                    },
                    command_id: text(),
                    kind: { const: croKind },
                    phase: { const: openedPhase },
                    protocol_id: prefixed(applications.identity.protocolIdPrefix, config),
                },
                additionalProperties: false,
            },
            {
                type: "object",
                required: [
                    ...planKeys,
                    "affected_steps",
                    "application_id",
                    "application_version",
                    "baseline",
                    "branch_session_id",
                    "compatibility_version",
                    "cost",
                    "divergence",
                    "evaluation",
                    "failure",
                    "phase",
                    "status",
                    "target",
                ].sort(),
                properties: {
                    ...versions,
                    ...planProperties,
                    affected_steps: { $ref: "#/$defs/indices" },
                    application_id: prefixed(applications.identity.applicationIdPrefix, config),
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
                    branch_session_id: { $ref: "#/$defs/sessionId" },
                    cost: nullable({
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
                    }),
                    divergence: nullable({
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
                    }),
                    evaluation: nullable({
                        type: "object",
                        required: ["passed", "reason", "score"],
                        properties: {
                            passed: { type: "boolean" },
                            reason: reason(config),
                            score: { type: "number" },
                        },
                        additionalProperties: false,
                    }),
                    failure: nullable({
                        type: "object",
                        required: ["code", "reason"],
                        properties: {
                            code: {
                                enum: [
                                    applications.errors.evidenceCode,
                                    applications.errors.verificationCode,
                                ],
                            },
                            reason: reason(config),
                        },
                        additionalProperties: false,
                    }),
                    phase: { const: candidatePhase },
                    status: { enum: [...cro.candidateStatuses] },
                    target: {
                        type: "object",
                        required: ["prefix_id", "source_session_id", "step_index"],
                        properties: {
                            prefix_id: { $ref: "#/$defs/prefixId" },
                            source_session_id: { $ref: "#/$defs/sessionId" },
                            step_index: { type: "integer", minimum: 1 },
                        },
                        additionalProperties: false,
                    },
                },
                additionalProperties: false,
            },
        ],
        $defs: {
            candidateId: prefixed(applications.identity.candidateIdPrefix, config),
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
    const hexLength = createHash(config.applications.identity.digestAlgorithm).digest("hex").length;
    return {
        type: "string",
        pattern: `^${escapePattern(prefix)}[0-9a-f]{${hexLength}}$`,
    };
}

function text(): Schema {
    return { type: "string", minLength: 1 };
}

function escapePattern(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
