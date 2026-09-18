import { createHash } from "node:crypto";

import type { ProtocolConfig } from "../../../src/protocol/config-types.ts";

type Schema = Readonly<Record<string, unknown>>;

/**
 * Renders the configured trajectory compression record JSON Schema: the opened record naming the
 * source session, the best-of-N control seeds, and the comparison baselines; one record per
 * candidate status retaining the candidate kind and seed, the validated fork point and hint digest,
 * the restore classification and constituents, the compressed, control, and restoration sessions,
 * the verifier verdict, the outcome, the measured step count and cost, and any failure; and the
 * aggregate outcome record reporting measured step-count ratios only. `$defs.proposal` is the
 * closed fork-point and hint grammar a compressor emits.
 *
 * @param config - Validated protocol configuration.
 * @returns The configured closed compression record schema.
 */
export function renderApplicationCompressionSchema(config: ProtocolConfig): Schema {
    const applications = config.applications;
    const compression = applications.compression;
    const [, , compressionKind] = applications.kinds;
    const [openedPhase, candidatePhase, outcomePhase] = compression.phases;
    const versions = {
        application_version: { const: applications.recordVersion },
        compatibility_version: { const: applications.compatibilityVersion },
    };
    const candidateProperties = {
        ...versions,
        application_id: prefixed(applications.identity.applicationIdPrefix, config),
        candidate: { enum: [...compression.candidateKinds] },
        compressor_handle_id: nullable({ $ref: "#/$defs/handleId" }),
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
        failure: nullable({
            type: "object",
            required: ["code", "reason"],
            properties: {
                code: {
                    enum: [applications.errors.evidenceCode, applications.errors.verificationCode],
                },
                reason: reason(config),
            },
            additionalProperties: false,
        }),
        fork_id: nullable(prefixed(applications.identity.forkPointIdPrefix, config)),
        fork_point: nullable({ $ref: "#/$defs/forkPoint" }),
        hint_digest: nullable(prefixed(`${applications.identity.digestAlgorithm}:`, config)),
        outcome: nullable({ enum: [...compression.outcomes] }),
        phase: { const: candidatePhase },
        reason: nullable(reason(config)),
        restoration_session_id: nullable({ $ref: "#/$defs/sessionId" }),
        restore: nullable({
            type: "object",
            required: ["classification", "constituents", "restore_record_id", "rewind_session_id"],
            properties: {
                classification: { enum: [...config.replay.checkpoint.classifications] },
                constituents: {
                    type: "array",
                    minItems: 1,
                    items: {
                        type: "object",
                        required: ["kind", "name", "reason", "status"],
                        properties: {
                            kind: { enum: [...config.replay.checkpoint.constituentKinds] },
                            name: nullable(text()),
                            reason: nullable(text()),
                            status: { enum: [...config.replay.checkpoint.evidenceStatuses] },
                        },
                        additionalProperties: false,
                    },
                },
                restore_record_id: nullable(text()),
                rewind_session_id: nullable({ $ref: "#/$defs/sessionId" }),
            },
            additionalProperties: false,
        }),
        score: nullable({ type: "number" }),
        seed: nullable({ type: "integer" }),
        session_id: nullable({ $ref: "#/$defs/sessionId" }),
        status: { enum: [...compression.candidateStatuses] },
        step_count: nullable(count()),
        verdict: nullable({ enum: [...compression.verdicts] }),
        verifier_handle_id: nullable({ $ref: "#/$defs/handleId" }),
    };
    const ratio = { type: "number", minimum: 0 };
    return {
        $schema: config.kernel.schemas.dialect,
        $id: applications.schemas.compressionId,
        $comment: "Generated from protocol.config.json. Do not edit directly.",
        title: `Shepherd Application Trajectory Compression v${applications.recordVersion}`,
        description:
            "Trajectory compression records on the application owner path: the opened record naming the source session, control seeds, and baselines; one record per candidate status retaining the candidate and seed, fork point, hint digest, restore classification and constituents, verifier verdict, outcome, compressed session, measured step count and cost, and any failure; and the aggregate outcome record reporting measured step-count ratios only.",
        oneOf: [
            {
                type: "object",
                required: [
                    "application_id",
                    "application_version",
                    "baselines",
                    "command_id",
                    "compatibility_version",
                    "controls",
                    "kind",
                    "phase",
                    "protocol_id",
                    "source_session_id",
                ],
                properties: {
                    ...versions,
                    application_id: prefixed(applications.identity.applicationIdPrefix, config),
                    baselines: {
                        type: "array",
                        items: { enum: [...compression.baselineKinds] },
                        uniqueItems: true,
                    },
                    command_id: text(),
                    controls: {
                        type: "array",
                        items: { type: "integer" },
                        maxItems: applications.limits.maxBestOfN,
                        uniqueItems: true,
                    },
                    kind: { const: compressionKind },
                    phase: { const: openedPhase },
                    protocol_id: prefixed(applications.identity.protocolIdPrefix, config),
                    source_session_id: { $ref: "#/$defs/sessionId" },
                },
                additionalProperties: false,
            },
            {
                type: "object",
                required: Object.keys(candidateProperties).sort(),
                properties: candidateProperties,
                additionalProperties: false,
            },
            {
                type: "object",
                required: [
                    "application_id",
                    "application_version",
                    "baseline",
                    "compatibility_version",
                    "control",
                    "original_step_count",
                    "outcome",
                    "phase",
                    "result_session_id",
                    "result_step_count",
                    "step_count_ratio",
                ],
                properties: {
                    ...versions,
                    application_id: prefixed(applications.identity.applicationIdPrefix, config),
                    baseline: nullable({
                        type: "object",
                        required: ["kind", "session_id", "step_count", "step_count_ratio"],
                        properties: {
                            kind: { enum: [...compression.baselineKinds] },
                            session_id: { $ref: "#/$defs/sessionId" },
                            step_count: count(),
                            step_count_ratio: ratio,
                        },
                        additionalProperties: false,
                    }),
                    control: nullable({
                        type: "object",
                        required: ["seed", "session_id", "step_count", "step_count_ratio"],
                        properties: {
                            seed: { type: "integer" },
                            session_id: { $ref: "#/$defs/sessionId" },
                            step_count: count(),
                            step_count_ratio: ratio,
                        },
                        additionalProperties: false,
                    }),
                    original_step_count: { type: "integer", minimum: 1 },
                    outcome: { enum: [...compression.outcomes] },
                    phase: { const: outcomePhase },
                    result_session_id: { $ref: "#/$defs/sessionId" },
                    result_step_count: count(),
                    step_count_ratio: ratio,
                },
                additionalProperties: false,
            },
        ],
        $defs: {
            forkPoint: {
                type: "object",
                required: ["prefix_id", "session_id", "step_index"],
                properties: {
                    prefix_id: prefixed(config.replay.identity.prefixIdPrefix, config),
                    session_id: { $ref: "#/$defs/sessionId" },
                    step_index: { type: "integer", minimum: 1 },
                },
                additionalProperties: false,
            },
            handleId: prefixed(config.delegation.identity.handleIdPrefix, config),
            proposal: {
                type: "object",
                required: ["fork_point", "hint"],
                properties: {
                    fork_point: nullable({ $ref: "#/$defs/forkPoint" }),
                    hint: nullable({
                        type: "object",
                        required: ["cited_step_indices", "text"],
                        properties: {
                            cited_step_indices: {
                                type: "array",
                                items: count(),
                                maxItems: config.replay.limits.maxSteps,
                                uniqueItems: true,
                            },
                            text: {
                                type: "string",
                                minLength: 1,
                                maxLength: applications.limits.maxPromptBytes,
                            },
                        },
                        additionalProperties: false,
                    }),
                },
                additionalProperties: false,
            },
            sessionId: prefixed(config.replay.identity.sessionIdPrefix, config),
            verdict: {
                type: "object",
                required: ["reason", "score", "verdict"],
                properties: {
                    reason: reason(config),
                    score: { type: "number" },
                    verdict: { enum: [...compression.verdicts] },
                },
                additionalProperties: false,
            },
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
