import { createHash } from "node:crypto";

import type { ProtocolConfig } from "../../../src/protocol/config-types.ts";

type Schema = Readonly<Record<string, unknown>>;

/**
 * Renders the configured Tree-RL record JSON Schema: the opened record naming the prompt batch
 * with its root sessions, the branch seeds, the advantage normalization, and the comparison
 * baselines; one root record per root retaining its grading, measured cost, turns, and fork
 * decision (resolved and proposed turn, fork point, reason, and seeding tool call); one record per
 * branch rollout retaining its plan identity, status, reward, turns, step count, measured cost,
 * and any failure; and the batch record retaining the training batch format, digest, and line
 * count with the optional flat GRPO baseline batch. `$defs.batchLine` is the closed grammar of one
 * `jsonl_v2` training batch line with its per-action advantage attribution.
 *
 * @param config - Validated protocol configuration.
 * @returns The configured closed Tree-RL record schema.
 */
export function renderApplicationTreeRlRolloutSchema(config: ProtocolConfig): Schema {
    const applications = config.applications;
    const treeRl = applications.treeRl;
    const [, , , treeRlKind] = applications.kinds;
    const [openedPhase, rootPhase, rolloutPhase, batchPhase] = treeRl.phases;
    const [completed, failed] = treeRl.rolloutStatuses;
    const limits = applications.limits;
    const versions = {
        application_version: { const: applications.recordVersion },
        compatibility_version: { const: applications.compatibilityVersion },
    };
    const applicationId = prefixed(applications.identity.applicationIdPrefix, config);
    const digest = prefixed(`${applications.identity.digestAlgorithm}:`, config);
    const text = { type: "string", minLength: 1 };
    const reason = { type: "string", minLength: 1, maxLength: limits.maxReasonLength };
    const toolCall = nullable({
        type: "object",
        required: ["arguments", "name"],
        properties: { arguments: { type: "object" }, name: text },
        additionalProperties: false,
    });
    const statusVariants = [
        {
            properties: {
                failure: { type: "null" },
                reward: { type: "number" },
                status: { const: completed },
            },
        },
        {
            properties: {
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
                        reason,
                    },
                    additionalProperties: false,
                },
                reward: { type: "null" },
                status: { const: failed },
            },
        },
    ];
    const withStatus = (required: readonly string[], properties: Schema): Schema[] =>
        statusVariants.map((variant) => ({
            type: "object",
            required: [...required],
            properties: { ...properties, ...variant.properties },
            additionalProperties: false,
        }));
    const rootRequired = [
        "application_id",
        "application_version",
        "compatibility_version",
        "cost",
        "failure",
        "fork",
        "group_index",
        "phase",
        "prompt_id",
        "reward",
        "root_session_id",
        "status",
        "step_count",
        "turns",
    ];
    const rootProperties = {
        ...versions,
        application_id: applicationId,
        cost: { $ref: "#/$defs/cost" },
        fork: {
            type: "object",
            required: ["branch_turn", "fork_point", "proposed_turn", "reason", "tool_call"],
            properties: {
                branch_turn: { type: "integer", minimum: treeRl.forkTurn.first },
                fork_point: { $ref: "#/$defs/forkPoint" },
                proposed_turn: { type: "integer" },
                reason,
                tool_call: toolCall,
            },
            additionalProperties: false,
        },
        group_index: { type: "integer", minimum: 0, maximum: treeRl.limits.maxGroupSize - 1 },
        phase: { const: rootPhase },
        prompt_id: text,
        root_session_id: { $ref: "#/$defs/sessionId" },
        step_count: count(),
        turns: { $ref: "#/$defs/turns" },
    };
    const rolloutRequired = [
        "application_id",
        "application_version",
        "branch",
        "branch_turn",
        "compatibility_version",
        "cost",
        "failure",
        "fork_point",
        "group_index",
        "phase",
        "prompt_id",
        "replay_session_id",
        "reward",
        "rollout_id",
        "root_session_id",
        "seed",
        "seeded",
        "status",
        "step_count",
        "turns",
    ];
    const rolloutProperties = {
        ...versions,
        application_id: applicationId,
        branch: { type: "integer", minimum: 0, maximum: limits.maxBranches - 1 },
        branch_turn: { type: "integer", minimum: treeRl.forkTurn.first },
        cost: { $ref: "#/$defs/cost" },
        fork_point: { $ref: "#/$defs/forkPoint" },
        group_index: { type: "integer", minimum: 0, maximum: treeRl.limits.maxGroupSize - 1 },
        phase: { const: rolloutPhase },
        prompt_id: text,
        replay_session_id: { $ref: "#/$defs/sessionId" },
        rollout_id: prefixed(applications.identity.rolloutIdPrefix, config),
        root_session_id: { $ref: "#/$defs/sessionId" },
        seed: { type: "integer" },
        seeded: { type: "boolean" },
        step_count: count(),
        turns: { $ref: "#/$defs/turns" },
    };
    const batchSummary = {
        batch_digest: digest,
        format: { enum: [...treeRl.batchFormats] },
        line_count: {
            type: "integer",
            minimum: 0,
            maximum: limits.maxRollouts + treeRl.limits.maxPrompts * treeRl.limits.maxGroupSize,
        },
    };
    const nullableCount = nullable(count());
    return {
        $schema: config.kernel.schemas.dialect,
        $id: applications.schemas.treeRlRolloutId,
        $comment: "Generated from protocol.config.json. Do not edit directly.",
        title: `Shepherd Application Tree-RL Rollout v${applications.recordVersion}`,
        description:
            "Tree-RL records on the application owner path (paper Algorithm 2): the opened record naming the prompt batch with its root sessions, the branch seeds, the advantage normalization, and the baselines; one root record per root retaining its grading, turns, and fork decision; one record per branch rollout retaining its plan identity, status, reward, turns, step count, measured cost, and any failure; and the batch record retaining the jsonl_v2 training batch digest and line count with the optional flat GRPO baseline batch.",
        oneOf: [
            {
                type: "object",
                required: [
                    "application_id",
                    "application_version",
                    "baselines",
                    "command_id",
                    "compatibility_version",
                    "kind",
                    "normalization",
                    "phase",
                    "prompts",
                    "protocol_id",
                    "seeds",
                ],
                properties: {
                    ...versions,
                    application_id: applicationId,
                    baselines: {
                        type: "array",
                        items: { enum: [...treeRl.baselineKinds] },
                        uniqueItems: true,
                    },
                    command_id: text,
                    kind: { const: treeRlKind },
                    normalization: { enum: [...treeRl.advantage.normalizations] },
                    phase: { const: openedPhase },
                    prompts: {
                        type: "array",
                        minItems: 1,
                        maxItems: treeRl.limits.maxPrompts,
                        items: {
                            type: "object",
                            required: ["id", "roots"],
                            properties: {
                                id: text,
                                roots: {
                                    type: "array",
                                    minItems: 1,
                                    maxItems: treeRl.limits.maxGroupSize,
                                    items: { $ref: "#/$defs/sessionId" },
                                    uniqueItems: true,
                                },
                            },
                            additionalProperties: false,
                        },
                    },
                    protocol_id: prefixed(applications.identity.protocolIdPrefix, config),
                    seeds: {
                        type: "array",
                        minItems: 1,
                        maxItems: limits.maxBranches,
                        items: { type: "integer" },
                        uniqueItems: true,
                    },
                },
                additionalProperties: false,
            },
            ...withStatus(rootRequired, rootProperties),
            ...withStatus(rolloutRequired, rolloutProperties),
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
                    "actions",
                    "branch",
                    "branch_turn",
                    "fork_point",
                    "group_index",
                    "inter_root_advantage",
                    "intra_tree_advantage",
                    "member",
                    "prompt_id",
                    "replay_session_id",
                    "reward",
                    "rollout_id",
                    "root_session_id",
                    "seed",
                    "seeded",
                    "step_count",
                ],
                properties: {
                    actions: {
                        type: "array",
                        items: {
                            type: "object",
                            required: ["advantage", "segment", "step_index", "turn"],
                            properties: {
                                advantage: { type: "number" },
                                segment: { enum: [...treeRl.actionSegments] },
                                step_index: count(),
                                turn: { type: "integer", minimum: 1 },
                            },
                            additionalProperties: false,
                        },
                    },
                    branch: nullableCount,
                    branch_turn: { type: "integer", minimum: treeRl.forkTurn.first },
                    fork_point: { $ref: "#/$defs/forkPoint" },
                    group_index: count(),
                    inter_root_advantage: nullable({ type: "number" }),
                    intra_tree_advantage: nullable({ type: "number" }),
                    member: { enum: [...treeRl.memberKinds] },
                    prompt_id: text,
                    replay_session_id: { $ref: "#/$defs/sessionId" },
                    reward: { type: "number" },
                    rollout_id: nullable(prefixed(applications.identity.rolloutIdPrefix, config)),
                    root_session_id: { $ref: "#/$defs/sessionId" },
                    seed: nullable({ type: "integer" }),
                    seeded: { type: "boolean" },
                    step_count: count(),
                },
                additionalProperties: false,
            },
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
            turns: { type: "array", items: count() },
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
