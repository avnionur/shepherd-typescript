import type { ProtocolConfig } from "../../../src/protocol/config-types.ts";

/**
 * Renders the versioned registered-task ledger entry schema.
 *
 * @param config - Validated protocol configuration.
 * @returns The configured closed task-ledger entry schema.
 */
export function renderTaskLedgerEntrySchema(
    config: ProtocolConfig,
): Readonly<Record<string, unknown>> {
    const policy = config.projections.taskRunLedgers;
    return {
        $id: policy.schemas.taskEntryId,
        $schema: config.kernel.schemas.dialect,
        $comment: "Generated from protocol.config.json. Do not edit directly.",
        additionalProperties: false,
        properties: {
            artifact: { $ref: config.tasks.schemas.descriptorId },
            artifact_lock: { $ref: config.tasks.schemas.artifactLockId },
            compatibility_version: { const: policy.compatibilityVersion, type: "string" },
            ledger_version: { const: policy.version, type: "integer" },
            repository_grant: {
                oneOf: [
                    { type: "null" },
                    {
                        additionalProperties: false,
                        properties: {
                            artifact: {
                                $ref: config.workspaces.repositoryGrants.schemas
                                    .taskGrantArtifactId,
                            },
                            artifact_lock: {
                                $ref: config.workspaces.repositoryGrants.schemas
                                    .taskGrantArtifactLockId,
                            },
                        },
                        required: ["artifact", "artifact_lock"],
                        type: "object",
                    },
                ],
            },
        },
        required: [
            "artifact",
            "artifact_lock",
            "compatibility_version",
            "ledger_version",
            "repository_grant",
        ],
        type: "object",
        "x-shepherd-max-canonical-bytes": policy.maxCanonicalEntryBytes,
    };
}

/**
 * Renders the versioned durable-run ledger entry schema.
 *
 * @param config - Validated protocol configuration.
 * @returns The configured closed run-ledger entry schema.
 */
export function renderRunLedgerEntrySchema(
    config: ProtocolConfig,
): Readonly<Record<string, unknown>> {
    const policy = config.projections.taskRunLedgers;
    const text = { minLength: 1, type: "string" } as const;
    const nullableText = {
        oneOf: [{ type: "null" }, { type: "string" }],
    } as const;
    return {
        $defs: {
            budget: closed(
                {
                    maxCostUsd: { minimum: 0, type: "number" },
                    maxDurationMilliseconds: { minimum: 0, type: "integer" },
                    maxEffects: { minimum: 0, type: "integer" },
                    maxInputTokens: { minimum: 0, type: "integer" },
                    maxOutputTokens: { minimum: 0, type: "integer" },
                    maxTurns: { minimum: 0, type: "integer" },
                },
                [],
            ),
            cut: closed({
                created_by_record_id: text,
                cut_id: text,
                publisher_owner_id: text,
                target_owner_id: text,
                through_owner_ordinal: { minimum: 0, type: "integer" },
                through_record_id: text,
            }),
            continuationInspection: closed({
                constituents: {
                    items: closed({
                        kind: {
                            enum: config.runs.execution.continuationConstituentKinds,
                            type: "string",
                        },
                        receipt_id: nullableText,
                        status: {
                            enum: config.runs.execution.continuationEvidenceStatuses,
                            type: "string",
                        },
                    }),
                    type: "array",
                },
                record_id: text,
                trace_cut: { $ref: "#/$defs/cut" },
            }),
            inspection: closed({
                artifacts: {
                    items: closed({
                        artifact: { $ref: config.runs.schemas.artifactId },
                        record_id: text,
                    }),
                    type: "array",
                },
                causal_edges: {
                    items: {
                        items: text,
                        maxItems: 2,
                        minItems: 2,
                        type: "array",
                    },
                    type: "array",
                },
                cut: { oneOf: [{ type: "null" }, { $ref: "#/$defs/cut" }] },
                lifecycle: closed({
                    created_record_id: nullableText,
                    quiescent: { oneOf: [{ type: "null" }, { $ref: "#/$defs/quiescent" }] },
                    running_continuation_record_id: nullableText,
                    started_record_id: nullableText,
                    terminal_record_id: nullableText,
                    terminal_schema_ref: nullableText,
                }),
                outcome: {
                    oneOf: [
                        { type: "null" },
                        closed({
                            outcome: { $ref: config.runs.schemas.outcomeId },
                            record_id: text,
                        }),
                    ],
                },
                proof: { $ref: "#/$defs/proofEnvelope" },
                run_id: text,
                settlements: { items: { $ref: "#/$defs/settlement" }, type: "array" },
                status: {
                    enum: config.runs.execution.recoveryStatuses,
                    type: "string",
                },
                usage: {
                    oneOf: [
                        { type: "null" },
                        closed({
                            record_id: text,
                            usage: { $ref: config.runs.schemas.usageId },
                        }),
                    ],
                },
            }),
            jsonValue: {
                oneOf: [
                    { type: "boolean" },
                    { type: "null" },
                    { type: "number" },
                    { type: "string" },
                    { items: { $ref: "#/$defs/jsonValue" }, type: "array" },
                    {
                        additionalProperties: { $ref: "#/$defs/jsonValue" },
                        type: "object",
                    },
                ],
            },
            proofEnvelope: closed({
                evidence_id: nullableText,
                excluded_runtime_surfaces: {
                    items: {
                        enum: config.formalAssurance.proofEnvelope.excludedRuntimeSurfaces,
                        type: "string",
                    },
                    type: "array",
                },
                metadata: { additionalProperties: { $ref: "#/$defs/jsonValue" }, type: "object" },
                profile: { enum: config.formalAssurance.proofEnvelope.profiles, type: "string" },
                program_ref: nullableText,
                proof_backed: { type: "boolean" },
                reference_validated: { type: "boolean" },
                schema_version: {
                    const: config.formalAssurance.proofEnvelope.schemaVersion,
                    type: "string",
                },
                strength: { enum: config.formalAssurance.proofEnvelope.strengths, type: "string" },
                theorem_ids: { items: text, type: "array" },
                trace_ref: nullableText,
                validator: {
                    const: config.formalAssurance.proofEnvelope.validator,
                    type: "string",
                },
            }),
            provider: closed({
                capabilities: closed({
                    streaming: { type: "boolean" },
                    structuredOutput: { type: "boolean" },
                    tools: { type: "boolean" },
                }),
                id: text,
                kind: { enum: config.providers.kinds, type: "string" },
                model: nullableText,
            }),
            quiescent: {
                oneOf: [
                    closed({
                        acknowledgement_record_id: text,
                        acknowledgement_schema_ref: text,
                        continuation: { $ref: "#/$defs/continuationInspection" },
                        pause_command_record_id: { type: "null" },
                        prerequisite: closed({ kind: text, prerequisite_id: text }),
                        status: {
                            const: config.runs.execution.lifecycleWaitingStatus,
                            type: "string",
                        },
                    }),
                    closed({
                        acknowledgement_record_id: text,
                        acknowledgement_schema_ref: text,
                        continuation: { $ref: "#/$defs/continuationInspection" },
                        pause_command_record_id: text,
                        prerequisite: { type: "null" },
                        status: {
                            const: config.runs.execution.lifecycleSuspendedStatus,
                            type: "string",
                        },
                    }),
                ],
            },
            settlement: closed({
                action: { enum: config.workspaces.settlement.actions, type: "string" },
                citation_cut: { $ref: "#/$defs/cut" },
                citation_record_id: text,
                citation_version: { type: "integer" },
                command_id: text,
                operation: closed({ digest: text, id: text, json: text }),
                output_id: text,
                receipt: closed({ digest: text, json: text }),
                request_id: text,
                state: { enum: config.workspaces.settlement.states, type: "string" },
                trace: closed({
                    capture_record_id: text,
                    execution_cut_id: text,
                    outcome_record_id: text,
                    terminal_record_id: text,
                }),
            }),
            worldCapture: closed({
                capture_id: nullableText,
                output_record_id: nullableText,
                recovery_status: {
                    enum: config.runs.execution.recoveryStatuses,
                    type: "string",
                },
                run_id: text,
                status: {
                    enum: [
                        config.runs.execution.recoveryStatuses[0],
                        ...config.workspaces.worldTaskCapture.journalPhases,
                        ...config.workspaces.worldTaskCapture.statuses,
                    ],
                    type: "string",
                },
                transitions: {
                    items: closed({
                        body: {
                            oneOf: config.workspaces.worldTaskCapture.journalReaders.map(
                                ({ schemaId }) => ({ $ref: schemaId }),
                            ),
                        },
                        phase: {
                            enum: config.workspaces.worldTaskCapture.journalPhases,
                            type: "string",
                        },
                        record_id: text,
                    }),
                    type: "array",
                },
            }),
        },
        $id: policy.schemas.runEntryId,
        $schema: config.kernel.schemas.dialect,
        $comment: "Generated from protocol.config.json. Do not edit directly.",
        additionalProperties: false,
        properties: {
            budget: { $ref: "#/$defs/budget" },
            compatibility_version: { const: policy.compatibilityVersion, type: "string" },
            created_record_id: { minLength: 1, type: "string" },
            input: { $ref: "#/$defs/jsonValue" },
            inspection: { $ref: "#/$defs/inspection" },
            ledger_version: { const: policy.version, type: "integer" },
            native_jail_processes: {
                items: closed({
                    body: {
                        $ref: config.workspaces.placements.nativeJails.schemas.processId,
                    },
                    record_id: text,
                }),
                type: "array",
            },
            output: {
                oneOf: [
                    { type: "null" },
                    closed({
                        base_revision_id: text,
                        binding_id: text,
                        capture_id: text,
                        capture_record_id: text,
                        custody_id: text,
                        changeset_id: text,
                        execution_cut: { $ref: "#/$defs/cut" },
                        execution_outcome_record_id: text,
                        head_revision_id: text,
                        output_id: text,
                        run_id: text,
                        schema_version: {
                            const: config.workspaces.worldTaskCapture.version,
                            type: "integer",
                        },
                        status: {
                            enum: config.workspaces.worldTaskCapture.statuses,
                            type: "string",
                        },
                        user_basis_after: text,
                        user_basis_before: text,
                    }),
                ],
            },
            provider: { $ref: "#/$defs/provider" },
            run_id: { minLength: 1, type: "string" },
            task_artifact_lock: { $ref: config.tasks.schemas.artifactLockId },
            world_capture: { $ref: "#/$defs/worldCapture" },
        },
        required: [
            "budget",
            "compatibility_version",
            "created_record_id",
            "input",
            "inspection",
            "ledger_version",
            "native_jail_processes",
            "output",
            "provider",
            "run_id",
            "task_artifact_lock",
            "world_capture",
        ],
        type: "object",
        "x-shepherd-max-canonical-bytes": policy.maxCanonicalEntryBytes,
    };
}

function closed(
    properties: Readonly<Record<string, unknown>>,
    required: readonly string[] = Object.keys(properties),
): Readonly<Record<string, unknown>> {
    return { additionalProperties: false, properties, required, type: "object" };
}
