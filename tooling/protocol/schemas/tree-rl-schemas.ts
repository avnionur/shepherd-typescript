import { createHash } from "node:crypto";

import type { ProtocolConfig } from "../../../src/protocol/config-types.ts";

type Schema = Readonly<Record<string, unknown>>;

/**
 * Renders the configured Tree-RL rollout record JSON Schema: the opened record naming the source
 * session, the trace-selected fork points with their transitive dependent counts, the branch seeds,
 * and the comparison baselines; one record per rollout retaining its identity, fork point, branch,
 * seed, replay session, status, reward, step count, measured cost, and any failure; and the batch
 * record retaining the training batch format, digest, and line count with the optional
 * single-rollout baseline batch. `$defs.batchLine` is the closed grammar of one `jsonl_v1` training
 * batch line.
 *
 * @param config - Validated protocol configuration.
 * @returns The configured closed Tree-RL record schema.
 */
export function renderApplicationTreeRlRolloutSchema(config: ProtocolConfig): Schema {
    const applications = config.applications;
    const treeRl = applications.treeRl;
    const [, , , treeRlKind] = applications.kinds;
    const [openedPhase, rolloutPhase, batchPhase] = treeRl.phases;
    const [completed, failed] = treeRl.rolloutStatuses;
    const limits = applications.limits;
    const versions = {
        application_version: { const: applications.recordVersion },
        compatibility_version: { const: applications.compatibilityVersion },
    };
    const applicationId = prefixed(applications.identity.applicationIdPrefix, config);
    const digest = prefixed(`${applications.identity.digestAlgorithm}:`, config);
    const rolloutRequired = [
        "application_id",
        "application_version",
        "branch",
        "compatibility_version",
        "cost",
        "failure",
        "fork_point",
        "phase",
        "replay_session_id",
        "reward",
        "rollout_id",
        "seed",
        "status",
        "step_count",
    ];
    const rolloutProperties = {
        ...versions,
        application_id: applicationId,
        branch: { type: "integer", minimum: 0, maximum: limits.maxBranches - 1 },
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
        fork_point: { $ref: "#/$defs/forkPoint" },
        phase: { const: rolloutPhase },
        replay_session_id: { $ref: "#/$defs/sessionId" },
        rollout_id: prefixed(applications.identity.rolloutIdPrefix, config),
        seed: { type: "integer" },
        step_count: count(),
    };
    const batchSummary = {
        batch_digest: digest,
        format: { enum: [...treeRl.batchFormats] },
        line_count: { type: "integer", minimum: 0, maximum: limits.maxRollouts },
    };
    return {
        $schema: config.kernel.schemas.dialect,
        $id: applications.schemas.treeRlRolloutId,
        $comment: "Generated from protocol.config.json. Do not edit directly.",
        title: `Shepherd Application Tree-RL Rollout v${applications.recordVersion}`,
        description:
            "Tree-RL records on the application owner path: the opened record naming the source session, the trace-selected fork points, the branch seeds, and the baselines; one record per rollout retaining its fork point, branch, seed, replay session, status, reward, step count, measured cost, and any failure; and the batch record retaining the jsonl_v1 training batch digest and line count with the optional single-rollout baseline batch.",
        oneOf: [
            {
                type: "object",
                required: [
                    "application_id",
                    "application_version",
                    "baselines",
                    "command_id",
                    "compatibility_version",
                    "fork_points",
                    "kind",
                    "phase",
                    "protocol_id",
                    "seeds",
                    "source_session_id",
                ],
                properties: {
                    ...versions,
                    application_id: applicationId,
                    baselines: {
                        type: "array",
                        items: { enum: [...treeRl.baselineKinds] },
                        uniqueItems: true,
                    },
                    command_id: { type: "string", minLength: 1 },
                    fork_points: {
                        type: "array",
                        minItems: 1,
                        maxItems: limits.maxForkPoints,
                        items: {
                            type: "object",
                            required: ["dependents", "prefix_id", "step_index"],
                            properties: {
                                dependents: count(),
                                prefix_id: nullable(
                                    prefixed(config.replay.identity.prefixIdPrefix, config),
                                ),
                                step_index: count(),
                            },
                            additionalProperties: false,
                        },
                    },
                    kind: { const: treeRlKind },
                    phase: { const: openedPhase },
                    protocol_id: prefixed(applications.identity.protocolIdPrefix, config),
                    seeds: {
                        type: "array",
                        minItems: 1,
                        maxItems: limits.maxBranches,
                        items: { type: "integer" },
                        uniqueItems: true,
                    },
                    source_session_id: { $ref: "#/$defs/sessionId" },
                },
                additionalProperties: false,
            },
            {
                type: "object",
                required: rolloutRequired,
                properties: {
                    ...rolloutProperties,
                    failure: { type: "null" },
                    reward: { type: "number" },
                    status: { const: completed },
                },
                additionalProperties: false,
            },
            {
                type: "object",
                required: rolloutRequired,
                properties: {
                    ...rolloutProperties,
                    failure: {
                        type: "object",
                        required: ["code", "reason"],
                        properties: {
                            code: {
                                enum: [
                                    applications.errors.evidenceCode,
                                    applications.errors.verificationCode,
                                ],
                            },
                            reason: {
                                type: "string",
                                minLength: 1,
                                maxLength: limits.maxReasonLength,
                            },
                        },
                        additionalProperties: false,
                    },
                    reward: { type: "null" },
                    status: { const: failed },
                },
                additionalProperties: false,
            },
            {
                type: "object",
                required: [
                    "application_id",
                    "application_version",
                    "baseline",
                    "batch_digest",
                    "compatibility_version",
                    "format",
                    "line_count",
                    "phase",
                ],
                properties: {
                    ...versions,
                    ...batchSummary,
                    application_id: applicationId,
                    baseline: nullable({
                        type: "object",
                        required: ["batch_digest", "format", "kind", "line_count"],
                        properties: {
                            ...batchSummary,
                            kind: { enum: [...treeRl.baselineKinds] },
                        },
                        additionalProperties: false,
                    }),
                    phase: { const: batchPhase },
                },
                additionalProperties: false,
            },
        ],
        $defs: {
            batchLine: {
                type: "object",
                required: [
                    "fork_point",
                    "inter_branch_advantage",
                    "intra_branch_advantage",
                    "replay_session_id",
                    "reward",
                    "rollout_id",
                    "seed",
                    "session_id",
                    "step_count",
                ],
                properties: {
                    fork_point: { $ref: "#/$defs/forkPoint" },
                    inter_branch_advantage: { type: "number" },
                    intra_branch_advantage: { type: "number" },
                    replay_session_id: { $ref: "#/$defs/sessionId" },
                    reward: { type: "number" },
                    rollout_id: prefixed(applications.identity.rolloutIdPrefix, config),
                    seed: { type: "integer" },
                    session_id: { $ref: "#/$defs/sessionId" },
                    step_count: count(),
                },
                additionalProperties: false,
            },
            forkPoint: {
                type: "object",
                required: ["prefix_id", "step_index"],
                properties: {
                    prefix_id: nullable(prefixed(config.replay.identity.prefixIdPrefix, config)),
                    step_index: count(),
                },
                additionalProperties: false,
            },
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

function prefixed(prefix: string, config: ProtocolConfig): Schema {
    const hexLength = createHash(config.applications.identity.digestAlgorithm).digest("hex").length;
    return {
        type: "string",
        pattern: `^${escapePattern(prefix)}[0-9a-f]{${hexLength}}$`,
    };
}

function escapePattern(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
