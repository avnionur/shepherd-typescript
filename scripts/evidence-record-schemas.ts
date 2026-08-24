import type { ProtocolConfig } from "../src/protocol/config-types.ts";

/** Renders the versioned exact retained-output citation projection schema. */
export function renderOutputCitationEntrySchema(
    config: ProtocolConfig,
): Readonly<Record<string, unknown>> {
    const policy = config.projections.evidenceRecords;
    const ledgerId = config.projections.taskRunLedgers.schemas.runEntryId;
    const text = { minLength: 1, type: "string" } as const;
    return {
        $id: policy.schemas.outputCitationId,
        $schema: config.kernel.schemas.dialect,
        $comment: "Generated from protocol.config.json. Do not edit directly.",
        ...closed({
            compatibility_version: { const: policy.compatibilityVersion, type: "string" },
            output: {
                allOf: [{ $ref: `${ledgerId}#/properties/output` }, { type: "object" }],
            },
            output_citation_version: { const: policy.version, type: "integer" },
            run_created_record_id: text,
            run_id: text,
            settlements: {
                items: { $ref: `${ledgerId}#/$defs/settlement` },
                type: "array",
            },
            task_artifact_lock: { $ref: config.tasks.schemas.artifactLockId },
            world_capture: { $ref: `${ledgerId}#/$defs/worldCapture` },
        }),
        "x-shepherd-max-canonical-bytes": policy.maxCanonicalEntryBytes,
    };
}

/** Renders the versioned immutable published-cut trace-revision projection schema. */
export function renderTraceRevisionEntrySchema(
    config: ProtocolConfig,
): Readonly<Record<string, unknown>> {
    const policy = config.projections.evidenceRecords;
    const ledgerId = config.projections.taskRunLedgers.schemas.runEntryId;
    const text = { minLength: 1, type: "string" } as const;
    const recordIdArray = { items: text, type: "array" } as const;
    return {
        $defs: {
            externalAnchor: closed({
                hidden_reason: { const: "outside_slice", type: "string" },
                ref: text,
            }),
            recordShape: closed(
                {
                    envelope: { $ref: config.kernel.schemas.recordEnvelopeId },
                    hidden_reason: { const: "payload_hidden", type: "string" },
                    view: { $ref: config.kernel.schemas.recordViewId },
                },
                ["envelope", "hidden_reason"],
            ),
            sliceRecord: closed(
                {
                    body: { $ref: config.kernel.schemas.recordBodyId },
                    envelope: { $ref: config.kernel.schemas.recordEnvelopeId },
                    view: { $ref: config.kernel.schemas.recordViewId },
                },
                ["body", "envelope"],
            ),
            witnessAnchor: closed({
                hidden_reason: { const: "hidden_by_visibility", type: "string" },
                visible_shape: closed({ schema_ref: text, witness_ref: { type: "string" } }),
                witness_ref: text,
            }),
        },
        $id: policy.schemas.traceRevisionId,
        $schema: config.kernel.schemas.dialect,
        $comment: "Generated from protocol.config.json. Do not edit directly.",
        ...closed({
            compatibility_version: { const: policy.compatibilityVersion, type: "string" },
            cut: { $ref: `${ledgerId}#/$defs/cut` },
            slice: closed({
                causal_edges: {
                    items: {
                        items: text,
                        maxItems: 2,
                        minItems: 2,
                        type: "array",
                    },
                    type: "array",
                },
                external_anchors: {
                    items: { $ref: "#/$defs/externalAnchor" },
                    type: "array",
                },
                mode_filter: { enum: config.kernel.queries.modeFilters, type: "string" },
                owner_paths: {
                    additionalProperties: recordIdArray,
                    type: "object",
                },
                read_address: { $ref: `${ledgerId}#/$defs/cut` },
                visible_records_by_id: {
                    additionalProperties: {
                        oneOf: [{ $ref: "#/$defs/recordShape" }, { $ref: "#/$defs/sliceRecord" }],
                    },
                    type: "object",
                },
                visible_witnesses_by_id: {
                    additionalProperties: { $ref: "#/$defs/sliceRecord" },
                    type: "object",
                },
                visibility_profile: {
                    enum: config.kernel.queries.visibilityProfiles,
                    type: "string",
                },
                witness_anchors: {
                    items: { $ref: "#/$defs/witnessAnchor" },
                    type: "array",
                },
            }),
            trace_revision_version: { const: policy.version, type: "integer" },
        }),
        "x-shepherd-max-canonical-bytes": policy.maxCanonicalEntryBytes,
    };
}

/** Renders the versioned durable recovery/control record projection schema. */
export function renderRecoveryRecordEntrySchema(
    config: ProtocolConfig,
): Readonly<Record<string, unknown>> {
    const policy = config.projections.evidenceRecords;
    const ledgerId = config.projections.taskRunLedgers.schemas.runEntryId;
    const text = { minLength: 1, type: "string" } as const;
    const [recover, pause, resume, cancel] = config.runs.execution.controlCommandKinds;
    const claimVerified = config.runs.execution.continuationVerifiedStatus;
    const claimUnavailable = config.runs.execution.continuationEvidenceStatuses.at(-1);
    const commandCommon = {
        command_id: text,
        execution_id: text,
    } as const;
    return {
        $defs: {
            command: {
                oneOf: [
                    closed({
                        ...commandCommon,
                        command_kind: { const: recover, type: "string" },
                    }),
                    closed({
                        ...commandCommon,
                        command_kind: { const: pause, type: "string" },
                        expected_lifecycle_record_id: text,
                        fencing_token: { minimum: 1, type: "integer" },
                        reason: text,
                    }),
                    closed(
                        {
                            ...commandCommon,
                            command_kind: { const: resume, type: "string" },
                            continuation_descriptor_id: text,
                            expected_lifecycle_record_id: text,
                            prerequisite_satisfaction: closed({
                                kind: text,
                                prerequisite_id: text,
                                receipt_id: text,
                            }),
                        },
                        [
                            "command_id",
                            "command_kind",
                            "continuation_descriptor_id",
                            "execution_id",
                            "expected_lifecycle_record_id",
                        ],
                    ),
                    closed(
                        {
                            ...commandCommon,
                            command_kind: { const: cancel, type: "string" },
                            expected_lifecycle_record_id: text,
                            fencing_token: { minimum: 1, type: "integer" },
                            reason: text,
                        },
                        [
                            "command_id",
                            "command_kind",
                            "execution_id",
                            "expected_lifecycle_record_id",
                            "reason",
                        ],
                    ),
                ],
            },
        },
        $id: policy.schemas.recoveryRecordId,
        $schema: config.kernel.schemas.dialect,
        $comment: "Generated from protocol.config.json. Do not edit directly.",
        ...closed({
            command_results: {
                items: closed({
                    command_record_id: text,
                    effect_record_ids: { items: text, type: "array" },
                }),
                type: "array",
            },
            commands: {
                items: closed({
                    caused_by_record_ids: { items: text, type: "array" },
                    command: { $ref: "#/$defs/command" },
                    record_id: text,
                }),
                type: "array",
            },
            compatibility_version: { const: policy.compatibilityVersion, type: "string" },
            invocation_claim: {
                oneOf: [
                    closed({ status: { const: claimUnavailable, type: "string" } }),
                    closed({
                        claim_id: text,
                        fencing_token: { minimum: 1, type: "integer" },
                        record_id: text,
                        status: { const: claimVerified, type: "string" },
                    }),
                ],
            },
            lifecycle: { $ref: `${ledgerId}#/$defs/inspection/properties/lifecycle` },
            lifecycle_head_record_id: text,
            recovery_record_version: { const: policy.version, type: "integer" },
            recovery_status: {
                enum: config.runs.execution.recoveryStatuses,
                type: "string",
            },
            run_id: text,
        }),
        "x-shepherd-max-canonical-bytes": policy.maxCanonicalEntryBytes,
    };
}

function closed(
    properties: Readonly<Record<string, unknown>>,
    required: readonly string[] = Object.keys(properties),
): Readonly<Record<string, unknown>> {
    return { additionalProperties: false, properties, required, type: "object" };
}
