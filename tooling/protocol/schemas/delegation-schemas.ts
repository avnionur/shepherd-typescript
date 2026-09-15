import type { ProtocolConfig } from "../../../src/protocol/config-types.ts";
import { taskValueDefinitions } from "./task-protocol-schemas.ts";

type Schema = Readonly<Record<string, unknown>>;

/**
 * Renders the configured child run handle opened record JSON Schema.
 *
 * @param config - Validated protocol configuration.
 * @returns The configured closed opened-record schema.
 */
export function renderDelegationOpenedSchema(config: ProtocolConfig): Schema {
    const delegation = config.delegation;
    const [rootKind, handleKind] = delegation.parentKinds;
    const [declaredKind, revisedKind, synthesizedKind] = delegation.provenanceKinds;
    return record(config, delegation.schemas.openedId, "Opened", {
        description:
            "First record of one child run handle: supervisor, parent, task value, provenance, validated input, requested grant and budget, derived authority, nesting depth, and the discarded predecessor of a retry.",
        required: [
            "authority",
            "budget",
            "budget_ceiling",
            "child_run_id",
            "command_id",
            "depth",
            "grant",
            "handle_id",
            "input",
            "parent",
            "predecessor",
            "provenance",
            "supervisor_id",
            "task",
        ],
        properties: {
            authority: {
                type: "object",
                required: ["ceiling", "effective"],
                properties: {
                    ceiling: { $ref: "#/$defs/grants" },
                    effective: { $ref: "#/$defs/grants" },
                },
                additionalProperties: false,
            },
            budget: { $ref: "#/$defs/budget" },
            budget_ceiling: { $ref: "#/$defs/budget" },
            child_run_id: prefixed(delegation.identity.childRunIdPrefix, config),
            command_id: text(),
            depth: { type: "integer", minimum: 1, maximum: delegation.limits.maxNestingDepth },
            grant: { $ref: "#/$defs/grants" },
            handle_id: { $ref: "#/$defs/handleId" },
            input: { $ref: "#/$defs/semanticValue" },
            parent: {
                oneOf: [
                    {
                        type: "object",
                        required: ["kind"],
                        properties: { kind: { const: rootKind } },
                        additionalProperties: false,
                    },
                    {
                        type: "object",
                        required: ["handle_id", "kind", "origin_cut_id", "origin_record_id"],
                        properties: {
                            handle_id: { $ref: "#/$defs/handleId" },
                            kind: { const: handleKind },
                            origin_cut_id: prefixed(delegation.identity.originCutIdPrefix, config),
                            origin_record_id: { $ref: "#/$defs/recordId" },
                        },
                        additionalProperties: false,
                    },
                ],
            },
            predecessor: nullable({
                type: "object",
                required: ["cut_id", "decision_record_id", "handle_id"],
                properties: {
                    cut_id: prefixed(delegation.identity.retryCutIdPrefix, config),
                    decision_record_id: { $ref: "#/$defs/recordId" },
                    handle_id: { $ref: "#/$defs/handleId" },
                },
                additionalProperties: false,
            }),
            provenance: {
                oneOf: [
                    {
                        type: "object",
                        required: ["kind"],
                        properties: { kind: { const: declaredKind } },
                        additionalProperties: false,
                    },
                    {
                        type: "object",
                        required: ["fields", "kind", "source_task"],
                        properties: {
                            fields: {
                                type: "array",
                                items: { enum: [...delegation.revisionFields] },
                                minItems: 1,
                                maxItems: delegation.revisionFields.length,
                                uniqueItems: true,
                            },
                            kind: { const: revisedKind },
                            source_task: { $ref: "#/$defs/taskValue" },
                        },
                        additionalProperties: false,
                    },
                    {
                        type: "object",
                        required: ["kind", "source_record_id", "source_run_id"],
                        properties: {
                            kind: { const: synthesizedKind },
                            source_record_id: { $ref: "#/$defs/recordId" },
                            source_run_id: text(),
                        },
                        additionalProperties: false,
                    },
                ],
            },
            supervisor_id: { $ref: "#/$defs/supervisorId" },
            task: { $ref: "#/$defs/taskValue" },
        },
    });
}

/**
 * Renders the configured child run context injection record JSON Schema.
 *
 * @param config - Validated protocol configuration.
 * @returns The configured closed context schema.
 */
export function renderDelegationContextSchema(config: ProtocolConfig): Schema {
    const delegation = config.delegation;
    const [injectedPhase, consumedPhase] = delegation.contextPhases;
    const base = {
        $schema: config.kernel.schemas.dialect,
        $id: delegation.schemas.contextId,
        $comment: "Generated from protocol.config.json. Do not edit directly.",
        title: `Shepherd Delegation Context v${delegation.recordVersion}`,
        description:
            "Ordered supervisor context injection on one child run handle citing retained records, or the consumption record listing the injections folded into the composed provider request before the child started.",
    };
    const common = {
        compatibility_version: { const: delegation.compatibilityVersion },
        delegation_version: { const: delegation.recordVersion },
        command_id: text(),
        handle_id: { $ref: "#/$defs/handleId" },
        supervisor_id: { $ref: "#/$defs/supervisorId" },
    };
    return {
        ...base,
        oneOf: [
            {
                type: "object",
                required: [
                    "compatibility_version",
                    "delegation_version",
                    "cited_record_ids",
                    "command_id",
                    "data",
                    "handle_id",
                    "phase",
                    "supervisor_id",
                ],
                properties: {
                    ...common,
                    cited_record_ids: {
                        type: "array",
                        items: { $ref: "#/$defs/recordId" },
                        minItems: 1,
                        maxItems: delegation.limits.maxCitedRecords,
                        uniqueItems: true,
                    },
                    data: {
                        type: "object",
                        additionalProperties: { $ref: "#/$defs/semanticValue" },
                    },
                    phase: { const: injectedPhase },
                },
                additionalProperties: false,
            },
            {
                type: "object",
                required: [
                    "compatibility_version",
                    "delegation_version",
                    "command_id",
                    "consumed_record_ids",
                    "handle_id",
                    "phase",
                    "request_digest",
                    "supervisor_id",
                ],
                properties: {
                    ...common,
                    consumed_record_ids: {
                        type: "array",
                        items: { $ref: "#/$defs/recordId" },
                        minItems: 1,
                        maxItems: delegation.limits.maxInjections,
                        uniqueItems: true,
                    },
                    phase: { const: consumedPhase },
                    request_digest: { $ref: "#/$defs/recordId" },
                },
                additionalProperties: false,
            },
        ],
        $defs: definitions(config),
    };
}

/**
 * Renders the configured child run completion record JSON Schema.
 *
 * @param config - Validated protocol configuration.
 * @returns The configured closed completion schema.
 */
export function renderDelegationCompletionSchema(config: ProtocolConfig): Schema {
    const delegation = config.delegation;
    return record(config, delegation.schemas.completionId, "Completion", {
        description:
            "Completion of one child run: cites the child's terminal record and published cut.",
        required: [
            "child_cut_id",
            "child_run_id",
            "child_terminal_record_id",
            "execution_kind",
            "handle_id",
            "status",
            "supervisor_id",
        ],
        properties: {
            child_cut_id: text(),
            child_run_id: prefixed(delegation.identity.childRunIdPrefix, config),
            child_terminal_record_id: { $ref: "#/$defs/recordId" },
            execution_kind: { enum: [...delegation.executionKinds] },
            handle_id: { $ref: "#/$defs/handleId" },
            status: { enum: [...config.runs.terminalStatuses] },
            supervisor_id: { $ref: "#/$defs/supervisorId" },
        },
    });
}

/**
 * Renders the configured task approval record JSON Schema.
 *
 * @param config - Validated protocol configuration.
 * @returns The configured closed approval schema.
 */
export function renderDelegationApprovalSchema(config: ProtocolConfig): Schema {
    const delegation = config.delegation;
    return record(config, delegation.schemas.approvalId, "Approval", {
        description:
            "Explicit approval or rejection of a revised or synthesized task value before execution.",
        required: [
            "approver_id",
            "command_id",
            "handle_id",
            "reason",
            "supervisor_id",
            "task_artifact_digest",
            "verdict",
        ],
        properties: {
            approver_id: text(),
            command_id: text(),
            handle_id: { $ref: "#/$defs/handleId" },
            reason: nullable(reason(config)),
            supervisor_id: { $ref: "#/$defs/supervisorId" },
            task_artifact_digest: {
                type: "string",
                pattern: `^${escapePattern(config.tasks.digestPrefix)}[0-9a-f]{${config.tasks.hexLength}}$`,
            },
            verdict: { enum: [...delegation.approvalVerdicts] },
        },
    });
}

/**
 * Renders the configured supervisor handoff record JSON Schema.
 *
 * @param config - Validated protocol configuration.
 * @returns The configured closed handoff schema.
 */
export function renderDelegationHandoffSchema(config: ProtocolConfig): Schema {
    return record(config, config.delegation.schemas.handoffId, "Handoff", {
        description: "Transfer of handle supervisor ownership to a named successor.",
        required: ["command_id", "handle_id", "reason", "successor_id", "supervisor_id"],
        properties: {
            command_id: text(),
            handle_id: { $ref: "#/$defs/handleId" },
            reason: nullable(reason(config)),
            successor_id: { $ref: "#/$defs/supervisorId" },
            supervisor_id: { $ref: "#/$defs/supervisorId" },
        },
    });
}

/**
 * Renders the configured terminal decision record JSON Schema.
 *
 * @param config - Validated protocol configuration.
 * @returns The configured closed decision schema.
 */
export function renderDelegationDecisionSchema(config: ProtocolConfig): Schema {
    const delegation = config.delegation;
    return record(config, delegation.schemas.decisionId, "Decision", {
        description:
            "Terminal accept or discard decision for one child run handle, citing the accepted output.",
        required: [
            "child_outcome_record_id",
            "command_id",
            "handle_id",
            "kind",
            "output_id",
            "reason",
            "supervisor_id",
        ],
        properties: {
            child_outcome_record_id: nullable({ $ref: "#/$defs/recordId" }),
            command_id: text(),
            handle_id: { $ref: "#/$defs/handleId" },
            kind: { enum: [...delegation.decisionKinds] },
            output_id: nullable({ $ref: "#/$defs/recordId" }),
            reason: nullable(reason(config)),
            supervisor_id: { $ref: "#/$defs/supervisorId" },
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
        title: `Shepherd Delegation ${title} v${config.delegation.recordVersion}`,
        description: body.description,
        type: "object",
        required: ["compatibility_version", "delegation_version", ...body.required],
        properties: {
            compatibility_version: { const: config.delegation.compatibilityVersion },
            delegation_version: { const: config.delegation.recordVersion },
            ...body.properties,
        },
        additionalProperties: false,
        $defs: definitions(config),
    };
}

function definitions(config: ProtocolConfig): Schema {
    return {
        budget: {
            type: "object",
            properties: {
                maxCostUsd: { type: "number", minimum: 0 },
                maxDurationMilliseconds: { type: "integer", minimum: 1 },
                maxEffects: { type: "integer", minimum: 0 },
                maxInputTokens: { type: "integer", minimum: 0 },
                maxOutputTokens: { type: "integer", minimum: 0 },
                maxTurns: { type: "integer", minimum: 0 },
            },
            additionalProperties: false,
        },
        grants: {
            type: "array",
            maxItems: config.scopes.limits.maxResources,
            items: {
                type: "object",
                required: ["atoms", "resource_id", "resource_kind"],
                properties: {
                    atoms: {
                        type: "array",
                        items: { enum: [...config.scopes.authority.atoms] },
                        uniqueItems: true,
                    },
                    resource_id: text(),
                    resource_kind: { enum: [...config.scopes.authority.resourceKinds] },
                },
                additionalProperties: false,
            },
        },
        handleId: prefixed(config.delegation.identity.handleIdPrefix, config),
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
        supervisorId: {
            type: "string",
            minLength: 1,
            maxLength: config.delegation.limits.maxSupervisorIdLength,
        },
        ...taskValueDefinitions(config),
    };
}

function nullable(schema: Schema): Schema {
    return { oneOf: [{ type: "null" }, schema] };
}

function reason(config: ProtocolConfig): Schema {
    return { type: "string", minLength: 1, maxLength: config.delegation.limits.maxReasonLength };
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
