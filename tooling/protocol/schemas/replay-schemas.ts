import type { ProtocolConfig } from "../../../src/protocol/config-types.ts";
import { taskArtifactLockSchema } from "./run-protocol-schema.ts";

type Schema = Readonly<Record<string, unknown>>;

/**
 * Renders the configured replay session record JSON Schema.
 *
 * @param config - Validated protocol configuration.
 * @returns The configured closed session schema.
 */
export function renderReplaySessionSchema(config: ProtocolConfig): Schema {
    const replay = config.replay;
    return record(config, replay.schemas.sessionId, "Session", {
        description:
            "First record of one replay session: program, provider, task, bound worlds and processes, and branch origin.",
        required: [
            "command_id",
            "mode",
            "origin",
            "processes",
            "program_id",
            "provider",
            "provider_session_adapter_id",
            "session_id",
            "task",
            "worlds",
        ],
        properties: {
            command_id: text(),
            mode: { enum: [...replay.modes] },
            origin: {
                oneOf: [
                    { type: "null" },
                    {
                        type: "object",
                        required: [
                            "changes",
                            "replacement_task",
                            "source_session_id",
                            "source_session_record_id",
                            "target_checkpoint_id",
                            "target_step_count",
                            "target_trace_cut_id",
                        ],
                        properties: {
                            changes: {
                                type: "array",
                                items: { enum: [...replay.changes] },
                                maxItems: replay.changes.length,
                                uniqueItems: true,
                            },
                            replacement_task: nullable({ $ref: "#/$defs/task" }),
                            source_session_id: { $ref: "#/$defs/sessionId" },
                            source_session_record_id: { $ref: "#/$defs/recordId" },
                            target_checkpoint_id: nullable(
                                prefixed(replay.identity.checkpointIdPrefix, config),
                            ),
                            target_step_count: stepCount(config),
                            target_trace_cut_id: prefixed(replay.identity.cutIdPrefix, config),
                        },
                        additionalProperties: false,
                    },
                ],
            },
            processes: {
                type: "array",
                maxItems: replay.limits.maxProcesses,
                items: {
                    type: "object",
                    required: ["backend", "process_id"],
                    properties: {
                        backend: { enum: [...replay.processes.backends] },
                        process_id: text(),
                    },
                    additionalProperties: false,
                },
            },
            program_id: text(),
            provider: nullable({
                type: "object",
                required: ["capabilities", "id", "kind", "model"],
                properties: {
                    capabilities: {
                        type: "object",
                        required: ["streaming", "structuredOutput", "tools"],
                        properties: {
                            streaming: { type: "boolean" },
                            structuredOutput: { type: "boolean" },
                            tools: { type: "boolean" },
                        },
                        additionalProperties: false,
                    },
                    id: text(),
                    kind: { enum: [...config.providers.kinds] },
                    model: nullable(text()),
                },
                additionalProperties: false,
            }),
            provider_session_adapter_id: nullable(text()),
            session_id: { $ref: "#/$defs/sessionId" },
            task: nullable({ $ref: "#/$defs/task" }),
            worlds: {
                type: "array",
                items: text(),
                maxItems: replay.limits.maxWorlds,
                uniqueItems: true,
            },
        },
    });
}

/**
 * Renders the configured replay step record JSON Schema.
 *
 * @param config - Validated protocol configuration.
 * @returns The configured closed step schema.
 */
export function renderReplayStepSchema(config: ProtocolConfig): Schema {
    const replay = config.replay;
    return record(config, replay.schemas.stepId, "Step", {
        description:
            "One provider exchange or effect of a replay session with declared dependencies and chained prefix identity.",
        required: [
            "depends_on",
            "effect",
            "index",
            "kind",
            "prefix_id",
            "provider",
            "session_id",
            "source",
            "source_step_record_id",
            "step_id",
        ],
        properties: {
            depends_on: {
                type: "array",
                items: stepIndex(config),
                maxItems: replay.limits.maxDependencies,
                uniqueItems: true,
            },
            effect: nullable({
                type: "object",
                required: [
                    "approval",
                    "disposition",
                    "failure",
                    "handler_id",
                    "intent",
                    "intent_ref",
                    "outcome",
                    "refusal_reason",
                ],
                properties: {
                    approval: nullable({
                        type: "object",
                        required: ["approver_id", "reason", "rematerialization"],
                        properties: {
                            approver_id: text(),
                            reason: reason(config),
                            rematerialization: { type: "boolean" },
                        },
                        additionalProperties: false,
                    }),
                    disposition: { enum: [...replay.effects.dispositions] },
                    failure: nullable({ $ref: "#/$defs/failure" }),
                    handler_id: nullable(text()),
                    intent: { $ref: "#/$defs/effectIntent" },
                    intent_ref: { $ref: "#/$defs/intentRef" },
                    outcome: nullable({ $ref: "#/$defs/effectOutcome" }),
                    refusal_reason: nullable(reason(config)),
                },
                additionalProperties: false,
            }),
            index: stepIndex(config),
            kind: { enum: [...replay.steps.kinds] },
            prefix_id: prefixed(replay.identity.prefixIdPrefix, config),
            provider: nullable({
                type: "object",
                required: [
                    "cache",
                    "context_prefix_id",
                    "failure",
                    "prompt_id",
                    "request",
                    "response",
                    "response_id",
                ],
                properties: {
                    cache: nullable({
                        type: "object",
                        required: [
                            "creation_input_tokens",
                            "identity",
                            "prior_context_prefix_id",
                            "read_input_tokens",
                            "status",
                        ],
                        properties: {
                            creation_input_tokens: { type: "integer", minimum: 0 },
                            identity: nullable(text()),
                            prior_context_prefix_id: nullable(
                                prefixed(replay.identity.contextPrefixIdPrefix, config),
                            ),
                            read_input_tokens: { type: "integer", minimum: 0 },
                            status: { enum: [...replay.cache.statuses] },
                        },
                        additionalProperties: false,
                    }),
                    context_prefix_id: prefixed(replay.identity.contextPrefixIdPrefix, config),
                    failure: nullable({ $ref: "#/$defs/failure" }),
                    prompt_id: prefixed(replay.identity.promptIdPrefix, config),
                    request: {
                        type: "object",
                        required: ["input", "instruction", "outputSchema"],
                        properties: {
                            input: { $ref: "#/$defs/semanticValue" },
                            instruction: text(),
                            outputSchema: { type: "object" },
                        },
                        additionalProperties: false,
                    },
                    response: nullable({
                        type: "object",
                        required: ["output", "usage"],
                        properties: {
                            output: { $ref: "#/$defs/semanticValue" },
                            usage: {
                                type: "object",
                                required: [
                                    "cacheCreationInputTokens",
                                    "cacheReadInputTokens",
                                    "costUsd",
                                    "inputTokens",
                                    "outputTokens",
                                ],
                                properties: {
                                    cacheCreationInputTokens: { type: "integer", minimum: 0 },
                                    cacheReadInputTokens: { type: "integer", minimum: 0 },
                                    costUsd: nullable({ type: "number", minimum: 0 }),
                                    inputTokens: { type: "integer", minimum: 0 },
                                    outputTokens: { type: "integer", minimum: 0 },
                                },
                                additionalProperties: false,
                            },
                        },
                        additionalProperties: false,
                    }),
                    response_id: prefixed(replay.identity.responseIdPrefix, config),
                },
                additionalProperties: false,
            }),
            session_id: { $ref: "#/$defs/sessionId" },
            source: { enum: [...replay.steps.sources] },
            source_step_record_id: nullable({ $ref: "#/$defs/recordId" }),
            step_id: prefixed(replay.identity.stepIdPrefix, config),
        },
    });
}

/**
 * Renders the configured replay effect admission record JSON Schema.
 *
 * @param config - Validated protocol configuration.
 * @returns The configured closed admission schema.
 */
export function renderReplayAdmissionSchema(config: ProtocolConfig): Schema {
    return record(config, config.replay.schemas.admissionId, "Admission", {
        description: "Retained immediately before a live effect handler is invoked.",
        required: ["index", "intent_ref", "session_id"],
        properties: {
            index: stepIndex(config),
            intent_ref: { $ref: "#/$defs/intentRef" },
            session_id: { $ref: "#/$defs/sessionId" },
        },
    });
}

/**
 * Renders the configured coupled checkpoint record JSON Schema.
 *
 * @param config - Validated protocol configuration.
 * @returns The configured closed checkpoint schema.
 */
export function renderReplayCheckpointSchema(config: ProtocolConfig): Schema {
    const replay = config.replay;
    return record(config, replay.schemas.checkpointId, "Checkpoint", {
        description:
            "Coupled checkpoint at one step boundary: published trace cut, world images, provider session, processes, and irreversible frontier.",
        required: [
            "checkpoint_id",
            "classification",
            "constituents",
            "context_prefix_id",
            "prefix_id",
            "session_id",
            "step_count",
            "trace_cut_id",
        ],
        properties: {
            checkpoint_id: prefixed(replay.identity.checkpointIdPrefix, config),
            classification: { enum: [...replay.checkpoint.classifications] },
            constituents: { $ref: "#/$defs/constituents" },
            context_prefix_id: nullable(prefixed(replay.identity.contextPrefixIdPrefix, config)),
            prefix_id: nullable(prefixed(replay.identity.prefixIdPrefix, config)),
            session_id: { $ref: "#/$defs/sessionId" },
            step_count: stepCount(config),
            trace_cut_id: prefixed(replay.identity.cutIdPrefix, config),
        },
    });
}

/**
 * Renders the configured branch restore record JSON Schema.
 *
 * @param config - Validated protocol configuration.
 * @returns The configured closed restore schema.
 */
export function renderReplayRestoreSchema(config: ProtocolConfig): Schema {
    const replay = config.replay;
    return record(config, replay.schemas.restoreId, "Restore", {
        description:
            "Restored constituents and derived classification of one branch, distinguishing atomic from reconstructed starts.",
        required: [
            "classification",
            "constituents",
            "context_prefix_id",
            "prefix_id",
            "session_id",
        ],
        properties: {
            classification: { enum: [...replay.checkpoint.classifications] },
            constituents: { $ref: "#/$defs/constituents" },
            context_prefix_id: nullable(prefixed(replay.identity.contextPrefixIdPrefix, config)),
            prefix_id: nullable(prefixed(replay.identity.prefixIdPrefix, config)),
            session_id: { $ref: "#/$defs/sessionId" },
        },
    });
}

/**
 * Renders the configured replay terminal record JSON Schema.
 *
 * @param config - Validated protocol configuration.
 * @returns The configured closed terminal schema.
 */
export function renderReplayTerminalSchema(config: ProtocolConfig): Schema {
    const replay = config.replay;
    return record(config, replay.schemas.terminalId, "Terminal", {
        description: "Last record of one replay session.",
        required: ["failure", "prefix_id", "result", "session_id", "status", "step_count"],
        properties: {
            failure: nullable({ $ref: "#/$defs/failure" }),
            prefix_id: nullable(prefixed(replay.identity.prefixIdPrefix, config)),
            result: nullable({
                type: "object",
                required: ["value"],
                properties: { value: { $ref: "#/$defs/semanticValue" } },
                additionalProperties: false,
            }),
            session_id: { $ref: "#/$defs/sessionId" },
            status: { enum: [...replay.terminal.statuses] },
            step_count: stepCount(config),
        },
    });
}

function record(
    config: ProtocolConfig,
    id: string,
    title: string,
    body: {
        readonly description: string;
        readonly properties: Record<string, unknown>;
        readonly required: readonly string[];
    },
): Schema {
    return {
        $schema: config.kernel.schemas.dialect,
        $id: id,
        $comment: "Generated from protocol.config.json. Do not edit directly.",
        title: `Shepherd Replay ${title} v${config.replay.recordVersion}`,
        description: body.description,
        type: "object",
        required: ["compatibility_version", "replay_version", ...body.required],
        properties: {
            compatibility_version: { const: config.replay.compatibilityVersion },
            replay_version: { const: config.replay.recordVersion },
            ...body.properties,
        },
        additionalProperties: false,
        $defs: definitions(config),
    };
}

function definitions(config: ProtocolConfig): Schema {
    const effects = config.effects;
    const replay = config.replay;
    return {
        constituents: {
            type: "array",
            minItems: 1,
            items: {
                type: "object",
                required: ["evidence", "kind", "name", "reason", "receipt_id", "status"],
                properties: {
                    evidence: nullable({
                        type: "object",
                        additionalProperties: { $ref: "#/$defs/semanticValue" },
                    }),
                    kind: { enum: [...replay.checkpoint.constituentKinds] },
                    name: nullable(text()),
                    reason: nullable(reason(config)),
                    receipt_id: nullable(text()),
                    status: { enum: [...replay.checkpoint.evidenceStatuses] },
                },
                additionalProperties: false,
            },
        },
        effectIntent: {
            type: "object",
            required: ["effect_id", "intent_version", "kind", "payload", "phase", "reversibility"],
            properties: {
                effect_id: text(),
                intent_version: { const: effects.intentVersion },
                kind: text(),
                payload: { $ref: "#/$defs/semanticValue" },
                phase: { const: effects.phases.intent },
                reversibility: { enum: [...effects.reversibilityTiers] },
            },
            additionalProperties: false,
        },
        effectOutcome: {
            type: "object",
            required: ["effect_id", "intent_ref", "kind", "outcome_version", "phase", "result"],
            properties: {
                effect_id: text(),
                intent_ref: { $ref: "#/$defs/intentRef" },
                kind: text(),
                outcome_version: { const: effects.outcomeVersion },
                phase: { const: effects.phases.outcome },
                result: { $ref: "#/$defs/semanticValue" },
            },
            additionalProperties: false,
        },
        failure: {
            type: "object",
            required: ["message", "name"],
            properties: {
                message: {
                    type: "string",
                    "x-shepherd-max-utf8-bytes": replay.limits.maxErrorMessageBytes,
                },
                name: text(),
            },
            additionalProperties: false,
        },
        intentRef: {
            type: "string",
            pattern: `^${escapePattern(effects.digestPrefix)}[0-9a-f]{${effects.hexLength}}$`,
        },
        recordId: prefixed(config.recordId.prefix, config),
        semanticValue: {
            anyOf: [
                { type: "boolean" },
                { type: "null" },
                { type: "number" },
                { type: "string" },
                { type: "array", items: { $ref: "#/$defs/semanticValue" } },
                { type: "object", additionalProperties: { $ref: "#/$defs/semanticValue" } },
            ],
        },
        sessionId: prefixed(replay.identity.sessionIdPrefix, config),
        task: {
            type: "object",
            required: ["artifact_lock", "input", "instruction", "output_schema"],
            properties: {
                artifact_lock: taskArtifactLockSchema(config),
                input: { $ref: "#/$defs/semanticValue" },
                instruction: text(),
                output_schema: { type: "object" },
            },
            additionalProperties: false,
        },
    };
}

function nullable(schema: Schema): Schema {
    return { oneOf: [{ type: "null" }, schema] };
}

function stepIndex(config: ProtocolConfig): Schema {
    return { type: "integer", minimum: 0, maximum: config.replay.limits.maxSteps - 1 };
}

function stepCount(config: ProtocolConfig): Schema {
    return { type: "integer", minimum: 0, maximum: config.replay.limits.maxSteps };
}

function reason(config: ProtocolConfig): Schema {
    return {
        type: "string",
        minLength: 1,
        "x-shepherd-max-utf8-bytes": config.replay.limits.maxReasonBytes,
    };
}

function prefixed(prefix: string, config: ProtocolConfig): Schema {
    return {
        type: "string",
        pattern: `^${escapePattern(prefix)}[0-9a-f]{${config.recordId.hexLength}}$`,
    };
}

function text(): Schema {
    return { type: "string", minLength: 1 };
}

function escapePattern(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
