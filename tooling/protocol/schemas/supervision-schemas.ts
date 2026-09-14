import type { ProtocolConfig } from "../../../src/protocol/config-types.ts";

type Schema = Readonly<Record<string, unknown>>;

/**
 * Renders the configured supervision subscription cursor JSON Schema.
 *
 * @param config - Validated protocol configuration.
 * @returns The configured closed cursor schema.
 */
export function renderSupervisionCursorSchema(config: ProtocolConfig): Schema {
    const subscriptions = config.supervision.subscriptions;
    return document(config, config.supervision.schemas.cursorId, "Cursor", {
        description:
            "Canonical subscription cursor: next owner ordinals in owner-identity order. Delivery order and time are not identity.",
        type: "object",
        required: ["compatibility_version", "cursor_id", "cursor_version", "positions"],
        properties: {
            compatibility_version: { const: config.supervision.compatibilityVersion },
            cursor_id: prefixed(config.supervision.identity.cursorIdPrefix, config),
            cursor_version: { const: subscriptions.cursorVersion },
            positions: {
                type: "array",
                minItems: 1,
                maxItems: subscriptions.maxOwners,
                items: {
                    type: "object",
                    required: ["next_ordinal", "owner_id"],
                    properties: {
                        next_ordinal: {
                            type: "integer",
                            minimum: config.kernel.append.firstOwnerOrdinal,
                        },
                        owner_id: text(),
                    },
                    additionalProperties: false,
                },
            },
        },
        additionalProperties: false,
    });
}

/**
 * Renders the configured supervised dispatch record JSON Schema.
 *
 * @param config - Validated protocol configuration.
 * @returns The configured closed dispatch schema.
 */
export function renderSupervisionDispatchSchema(config: ProtocolConfig): Schema {
    const interception = config.supervision.interception;
    return record(config, config.supervision.schemas.dispatchId, "Dispatch", {
        description:
            "First record of one supervised dispatch: the intent, canonical interceptor order, approval wait, and cited records.",
        required: [
            "approval_timeout_milliseconds",
            "cited_record_ids",
            "command_id",
            "dispatch_id",
            "intent",
            "intent_ref",
            "interceptors",
        ],
        properties: {
            approval_timeout_milliseconds: {
                type: "integer",
                minimum: 1,
                maximum: config.supervision.approval.maxWaitMilliseconds,
            },
            cited_record_ids: citations(config, 0),
            command_id: text(),
            dispatch_id: { $ref: "#/$defs/dispatchId" },
            intent: { $ref: "#/$defs/effectIntent" },
            intent_ref: { $ref: "#/$defs/intentRef" },
            interceptors: {
                type: "array",
                maxItems: interception.maxInterceptors,
                items: {
                    type: "object",
                    required: [
                        "interceptor_id",
                        "priority",
                        "timeout_milliseconds",
                        "timeout_policy",
                    ],
                    properties: {
                        interceptor_id: text(),
                        priority: { type: "integer" },
                        timeout_milliseconds: {
                            type: "integer",
                            minimum: 1,
                            maximum: interception.maxTimeoutMilliseconds,
                        },
                        timeout_policy: { enum: [...interception.timeoutPolicies] },
                    },
                    additionalProperties: false,
                },
            },
        },
    });
}

/**
 * Renders the configured interception decision record JSON Schema.
 *
 * @param config - Validated protocol configuration.
 * @returns The configured closed decision schema.
 */
export function renderSupervisionDecisionSchema(config: ProtocolConfig): Schema {
    const interception = config.supervision.interception;
    return record(config, config.supervision.schemas.decisionId, "Decision", {
        description:
            "One retained interceptor decision at one canonical position, from the interceptor, a timeout, or a failure.",
        required: [
            "applied_policy",
            "decision",
            "dispatch_id",
            "intent_ref",
            "interceptor_id",
            "position",
            "reason",
            "replacement",
            "source",
        ],
        properties: {
            applied_policy: {
                oneOf: [{ type: "null" }, { enum: [...interception.timeoutPolicies] }],
            },
            decision: { enum: [...interception.decisions] },
            dispatch_id: { $ref: "#/$defs/dispatchId" },
            intent_ref: { $ref: "#/$defs/intentRef" },
            interceptor_id: text(),
            position: { type: "integer", minimum: 0, maximum: interception.maxInterceptors - 1 },
            reason: reason(config),
            replacement: { oneOf: [{ type: "null" }, { $ref: "#/$defs/effectIntent" }] },
            source: { enum: [...interception.decisionSources] },
        },
    });
}

/**
 * Renders the configured approval request and verdict record JSON Schema.
 *
 * @param config - Validated protocol configuration.
 * @returns The configured closed approval schema.
 */
export function renderSupervisionApprovalSchema(config: ProtocolConfig): Schema {
    const approval = config.supervision.approval;
    const [requested, resolved] = approval.phases;
    const versions = versionProperties(config);
    return document(config, config.supervision.schemas.approvalId, "Approval", {
        description:
            "Approval request for one exact effective intent, or the verdict that resolves it.",
        oneOf: [
            {
                type: "object",
                required: [
                    ...Object.keys(versions),
                    "dispatch_id",
                    "gate",
                    "intent_ref",
                    "phase",
                    "position",
                    "reason",
                ],
                properties: {
                    ...versions,
                    dispatch_id: { $ref: "#/$defs/dispatchId" },
                    gate: { enum: [...approval.gates] },
                    intent_ref: { $ref: "#/$defs/intentRef" },
                    phase: { const: requested },
                    position: { oneOf: [{ type: "null" }, { type: "integer", minimum: 0 }] },
                    reason: reason(config),
                },
                additionalProperties: false,
            },
            {
                type: "object",
                required: [
                    ...Object.keys(versions),
                    "approver_id",
                    "command_id",
                    "dispatch_id",
                    "phase",
                    "reason",
                    "request_record_id",
                    "verdict",
                ],
                properties: {
                    ...versions,
                    approver_id: { oneOf: [{ type: "null" }, text()] },
                    command_id: { oneOf: [{ type: "null" }, text()] },
                    dispatch_id: { $ref: "#/$defs/dispatchId" },
                    phase: { const: resolved },
                    reason: reason(config),
                    request_record_id: { $ref: "#/$defs/recordId" },
                    verdict: { enum: [...approval.verdicts] },
                },
                additionalProperties: false,
            },
        ],
    });
}

/**
 * Renders the configured admission record JSON Schema.
 *
 * @param config - Validated protocol configuration.
 * @returns The configured closed admission schema.
 */
export function renderSupervisionAdmissionSchema(config: ProtocolConfig): Schema {
    return record(config, config.supervision.schemas.admissionId, "Admission", {
        description: "Retained immediately before the handler materializes the effective intent.",
        required: ["dispatch_id", "intent_ref"],
        properties: {
            dispatch_id: { $ref: "#/$defs/dispatchId" },
            intent_ref: { $ref: "#/$defs/intentRef" },
        },
    });
}

/**
 * Renders the configured resolution record JSON Schema.
 *
 * @param config - Validated protocol configuration.
 * @returns The configured closed resolution schema.
 */
export function renderSupervisionResolutionSchema(config: ProtocolConfig): Schema {
    return record(config, config.supervision.schemas.resolutionId, "Resolution", {
        description:
            "Terminal disposition of one supervised dispatch; only a materialized effect carries a handler and outcome.",
        required: ["dispatch_id", "disposition", "handler_id", "intent_ref", "outcome"],
        properties: {
            dispatch_id: { $ref: "#/$defs/dispatchId" },
            disposition: { enum: [...config.supervision.resolution.dispositions] },
            handler_id: { oneOf: [{ type: "null" }, text()] },
            intent_ref: { $ref: "#/$defs/intentRef" },
            outcome: { oneOf: [{ type: "null" }, { $ref: "#/$defs/effectOutcome" }] },
        },
    });
}

/**
 * Renders the configured context injection record JSON Schema.
 *
 * @param config - Validated protocol configuration.
 * @returns The configured closed context schema.
 */
export function renderSupervisionContextSchema(config: ProtocolConfig): Schema {
    return record(config, config.supervision.schemas.contextId, "Context Injection", {
        description:
            "Supervisor-injected application context on a named channel; cited records are its causal parents.",
        required: ["channel_id", "cited_record_ids", "command_id", "data", "supervisor_id"],
        properties: {
            channel_id: prefixed(config.supervision.identity.contextChannelIdPrefix, config),
            cited_record_ids: citations(config, 1),
            command_id: text(),
            data: {
                type: "object",
                additionalProperties: { $ref: "#/$defs/semanticValue" },
                "x-shepherd-max-canonical-bytes": config.supervision.limits.maxDataCanonicalBytes,
            },
            supervisor_id: text(),
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
    const versions = versionProperties(config);
    return document(config, id, title, {
        description: body.description,
        type: "object",
        required: [...Object.keys(versions), ...body.required],
        properties: { ...versions, ...body.properties },
        additionalProperties: false,
    });
}

function document(config: ProtocolConfig, id: string, title: string, body: Schema): Schema {
    return {
        $schema: config.kernel.schemas.dialect,
        $id: id,
        $comment: "Generated from protocol.config.json. Do not edit directly.",
        title: `Shepherd Supervision ${title} v${config.supervision.recordVersion}`,
        ...body,
        $defs: definitions(config),
    };
}

function versionProperties(config: ProtocolConfig): Record<string, unknown> {
    return {
        compatibility_version: { const: config.supervision.compatibilityVersion },
        supervision_version: { const: config.supervision.recordVersion },
    };
}

function definitions(config: ProtocolConfig): Schema {
    const effects = config.effects;
    return {
        dispatchId: prefixed(config.supervision.identity.dispatchIdPrefix, config),
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
    };
}

function citations(config: ProtocolConfig, minItems: number): Schema {
    return {
        type: "array",
        items: { $ref: "#/$defs/recordId" },
        minItems,
        maxItems: config.supervision.limits.maxCitedRecords,
        uniqueItems: true,
    };
}

function reason(config: ProtocolConfig): Schema {
    return {
        oneOf: [
            { type: "null" },
            {
                type: "string",
                minLength: 1,
                "x-shepherd-max-utf8-bytes": config.supervision.limits.maxReasonBytes,
            },
        ],
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
