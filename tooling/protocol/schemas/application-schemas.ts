import { createHash } from "node:crypto";

import type { ProtocolConfig } from "../../../src/protocol/config-types.ts";

type Schema = Readonly<Record<string, unknown>>;

/**
 * Renders the configured application manifest record JSON Schema.
 *
 * @param config - Validated protocol configuration.
 * @returns The configured closed manifest schema.
 */
export function renderApplicationManifestSchema(config: ProtocolConfig): Schema {
    const applications = config.applications;
    return {
        $schema: config.kernel.schemas.dialect,
        $id: applications.schemas.manifestId,
        $comment: "Generated from protocol.config.json. Do not edit directly.",
        title: `Shepherd Application Manifest v${applications.manifestVersion}`,
        description:
            "Canonical digest-bearing manifest of one application run: protocol identity over prompt, schema, and tool surfaces, budgets, optional thresholds, seeds, dataset selection, produced artifacts cited by identity, measured costs, and optional per-session computation reuse.",
        type: "object",
        required: [
            "application_id",
            "artifacts",
            "budgets",
            "compatibility_version",
            "costs",
            "dataset",
            "kind",
            "manifest_id",
            "manifest_version",
            "protocol_id",
            "protocol_version",
            "seeds",
            "surfaces",
        ],
        properties: {
            application_id: { $ref: "#/$defs/applicationId" },
            artifacts: {
                type: "array",
                maxItems: applications.limits.maxArtifacts,
                items: {
                    type: "object",
                    required: ["artifact_id", "cut_id", "digest", "record_id", "role"],
                    properties: {
                        artifact_id: prefixed(applications.identity.artifactIdPrefix, config),
                        cut_id: nullable(text()),
                        digest: { $ref: "#/$defs/digest" },
                        record_id: nullable({ $ref: "#/$defs/recordId" }),
                        role: text(),
                    },
                    additionalProperties: false,
                },
            },
            budgets: { type: "object", additionalProperties: { type: "integer", minimum: 0 } },
            compatibility_version: { const: applications.compatibilityVersion },
            computation_reuse: {
                type: "array",
                items: {
                    type: "object",
                    required: ["live_steps", "recorded_steps", "reuse_ratio", "session_index"],
                    properties: {
                        live_steps: count(),
                        recorded_steps: count(),
                        reuse_ratio: {
                            oneOf: [{ type: "null" }, { type: "number", minimum: 0, maximum: 1 }],
                        },
                        session_index: count(),
                    },
                    additionalProperties: false,
                },
            },
            costs: {
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
            dataset: {
                type: "object",
                required: ["id", "items", "revision"],
                properties: {
                    id: text(),
                    items: {
                        type: "array",
                        items: text(),
                        maxItems: applications.limits.maxDatasetItems,
                        uniqueItems: true,
                    },
                    revision: text(),
                },
                additionalProperties: false,
            },
            kind: { enum: [...applications.kinds] },
            manifest_id: prefixed(applications.identity.manifestIdPrefix, config),
            manifest_version: { const: applications.manifestVersion },
            protocol_id: prefixed(applications.identity.protocolIdPrefix, config),
            protocol_version: text(),
            seeds: {
                type: "array",
                items: { type: "integer" },
                minItems: 1,
                maxItems: applications.limits.maxSeeds,
                uniqueItems: true,
            },
            surfaces: {
                type: "array",
                minItems: 1,
                maxItems: applications.limits.maxSurfaces,
                items: {
                    type: "object",
                    required: ["digest", "id", "kind", "role"],
                    properties: {
                        digest: { $ref: "#/$defs/digest" },
                        id: text(),
                        kind: { enum: [...applications.protocolSurfaces] },
                        role: text(),
                    },
                    additionalProperties: false,
                },
            },
            thresholds: { type: "object", additionalProperties: { type: "number" } },
        },
        additionalProperties: false,
        $defs: definitions(config),
    };
}

/**
 * Renders the configured coding supervisor record JSON Schema: the opened record and the
 * per-round decision record with its observations, conflict, decision, and evidence.
 *
 * @param config - Validated protocol configuration.
 * @returns The configured closed supervision schema.
 */
export function renderApplicationSupervisionSchema(config: ProtocolConfig): Schema {
    const applications = config.applications;
    const supervision = applications.supervision;
    const [codingSupervisorKind] = applications.kinds;
    const [openedPhase, decisionPhase] = supervision.phases;
    const [observeKind, injectKind, handoffKind, discardRestartKind, acceptKind] =
        supervision.policyKinds as readonly [string, string, string, string, string];
    const versions = {
        application_version: { const: applications.recordVersion },
        compatibility_version: { const: applications.compatibilityVersion },
    };
    const workerBound = {
        minItems: applications.limits.minWorkers,
        maxItems: applications.limits.maxWorkers,
    };
    const decisionOf = (kind: string, properties: Record<string, unknown>) => ({
        type: "object",
        required: ["kind", ...Object.keys(properties)].sort(),
        properties: { kind: { const: kind }, ...properties },
        additionalProperties: false,
    });
    return {
        $schema: config.kernel.schemas.dialect,
        $id: applications.schemas.supervisionId,
        $comment: "Generated from protocol.config.json. Do not edit directly.",
        title: `Shepherd Application Supervision v${applications.recordVersion}`,
        description:
            "Coding supervisor records on the application owner path: the opened record naming the workers, and one decision record per observation round citing the observed worker evidence, the conflict classification, the policy decision, and the exact evidence it produced.",
        oneOf: [
            {
                type: "object",
                required: [
                    "application_id",
                    "application_version",
                    "command_id",
                    "compatibility_version",
                    "kind",
                    "phase",
                    "protocol_id",
                    "supervisor_id",
                    "workers",
                    "world",
                ],
                properties: {
                    ...versions,
                    application_id: { $ref: "#/$defs/applicationId" },
                    command_id: text(),
                    kind: { const: codingSupervisorKind },
                    phase: { const: openedPhase },
                    protocol_id: prefixed(applications.identity.protocolIdPrefix, config),
                    supervisor_id: { $ref: "#/$defs/supervisorId" },
                    workers: {
                        type: "array",
                        ...workerBound,
                        items: {
                            type: "object",
                            required: ["handle_id", "worker_id"],
                            properties: {
                                handle_id: { $ref: "#/$defs/handleId" },
                                worker_id: text(),
                            },
                            additionalProperties: false,
                        },
                    },
                    world: { type: "boolean" },
                },
                additionalProperties: false,
            },
            {
                type: "object",
                required: [
                    "application_id",
                    "application_version",
                    "compatibility_version",
                    "conflict",
                    "decision",
                    "evidence",
                    "observations",
                    "phase",
                    "round",
                    "supervisor_id",
                ],
                properties: {
                    ...versions,
                    application_id: { $ref: "#/$defs/applicationId" },
                    conflict: {
                        type: "object",
                        required: ["kind", "paths", "worker_ids"],
                        properties: {
                            kind: { enum: [...supervision.conflictKinds] },
                            paths: { $ref: "#/$defs/paths" },
                            worker_ids: {
                                type: "array",
                                items: text(),
                                maxItems: applications.limits.maxWorkers,
                                uniqueItems: true,
                            },
                        },
                        additionalProperties: false,
                    },
                    decision: {
                        oneOf: [
                            decisionOf(observeKind, {}),
                            decisionOf(injectKind, {
                                cited_record_ids: {
                                    type: "array",
                                    items: { $ref: "#/$defs/recordId" },
                                    minItems: 1,
                                    maxItems: config.delegation.limits.maxCitedRecords,
                                    uniqueItems: true,
                                },
                                data: {
                                    type: "object",
                                    additionalProperties: { $ref: "#/$defs/semanticValue" },
                                },
                                worker_id: text(),
                            }),
                            decisionOf(handoffKind, {
                                reason: nullable(reason(config)),
                                successor_supervisor_id: { $ref: "#/$defs/supervisorId" },
                                worker_id: text(),
                            }),
                            decisionOf(discardRestartKind, {
                                reason: reason(config),
                                worker_id: text(),
                            }),
                            decisionOf(acceptKind, { worker_id: text() }),
                        ],
                    },
                    evidence: {
                        oneOf: [
                            decisionOf(observeKind, {}),
                            decisionOf(injectKind, {
                                injection_record_id: { $ref: "#/$defs/recordId" },
                            }),
                            decisionOf(handoffKind, {
                                handoff_record_id: { $ref: "#/$defs/recordId" },
                            }),
                            decisionOf(discardRestartKind, {
                                decision_record_id: { $ref: "#/$defs/recordId" },
                                discard_receipt_id: nullable(text()),
                                fork_receipt_id: nullable(text()),
                                retry_cut_id: prefixed(
                                    config.delegation.identity.retryCutIdPrefix,
                                    config,
                                ),
                                successor_handle_id: { $ref: "#/$defs/handleId" },
                            }),
                            decisionOf(acceptKind, {
                                decision_record_id: { $ref: "#/$defs/recordId" },
                                discarded: {
                                    type: "array",
                                    maxItems: applications.limits.maxWorkers,
                                    items: {
                                        type: "object",
                                        required: [
                                            "decision_record_id",
                                            "discard_receipt_id",
                                            "worker_id",
                                        ],
                                        properties: {
                                            decision_record_id: { $ref: "#/$defs/recordId" },
                                            discard_receipt_id: nullable(text()),
                                            worker_id: text(),
                                        },
                                        additionalProperties: false,
                                    },
                                },
                                merge_receipt_id: nullable(text()),
                            }),
                        ],
                    },
                    observations: {
                        type: "array",
                        ...workerBound,
                        items: {
                            type: "object",
                            required: [
                                "attempt",
                                "changed_paths",
                                "child_run_id",
                                "completion_status",
                                "custody_id",
                                "delivered_cursor",
                                "handle_id",
                                "head_record_id",
                                "status",
                                "supervisor_id",
                                "worker_id",
                                "worker_status",
                            ],
                            properties: {
                                attempt: { type: "integer", minimum: 1 },
                                changed_paths: { $ref: "#/$defs/paths" },
                                child_run_id: prefixed(
                                    config.delegation.identity.childRunIdPrefix,
                                    config,
                                ),
                                completion_status: nullable({
                                    enum: [...config.runs.terminalStatuses],
                                }),
                                custody_id: nullable(text()),
                                delivered_cursor: cursor(config),
                                handle_id: { $ref: "#/$defs/handleId" },
                                head_record_id: { $ref: "#/$defs/recordId" },
                                status: { enum: [...config.delegation.statuses] },
                                supervisor_id: { $ref: "#/$defs/supervisorId" },
                                worker_id: text(),
                                worker_status: { enum: [...supervision.workerStatuses] },
                            },
                            additionalProperties: false,
                        },
                    },
                    phase: { const: decisionPhase },
                    round: { type: "integer", minimum: 1, maximum: applications.limits.maxRounds },
                    supervisor_id: { $ref: "#/$defs/supervisorId" },
                },
                additionalProperties: false,
            },
        ],
        $defs: definitions(config),
    };
}

function cursor(config: ProtocolConfig): Schema {
    const subscriptions = config.supervision.subscriptions;
    return {
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
    };
}

function definitions(config: ProtocolConfig): Schema {
    const applications = config.applications;
    const hexLength = createHash(applications.identity.digestAlgorithm).digest("hex").length;
    return {
        applicationId: prefixed(applications.identity.applicationIdPrefix, config),
        digest: {
            type: "string",
            pattern: `^${escapePattern(applications.identity.digestAlgorithm)}:[0-9a-f]{${hexLength}}$`,
        },
        handleId: prefixed(config.delegation.identity.handleIdPrefix, config),
        paths: {
            type: "array",
            items: text(),
            maxItems: config.workspaces.changesets.maxChanges,
            uniqueItems: true,
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
        supervisorId: {
            type: "string",
            minLength: 1,
            maxLength: config.delegation.limits.maxSupervisorIdLength,
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
