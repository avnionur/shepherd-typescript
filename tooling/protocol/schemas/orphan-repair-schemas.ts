import type { ProtocolConfig } from "../../../src/protocol/config-types.ts";

/**
 * Renders the configured bounded orphaned-operation diagnosis schema.
 *
 * @param config - Validated protocol configuration.
 * @returns The configured closed diagnosis schema.
 */
export function renderOrphanOperationDiagnosisSchema(
    config: ProtocolConfig,
): Readonly<Record<string, unknown>> {
    const policy = config.orphanRepair;
    const text = boundedText(policy.limits.maxIdentifierBytes);
    const nullableText = { oneOf: [{ type: "null" }, text] } as const;
    const recordId = {
        pattern: `^${escapeRegularExpression(config.recordId.prefix)}[0-9a-f]{${config.recordId.hexLength}}$`,
        type: "string",
    } as const;
    const nullableRecordId = { oneOf: [{ type: "null" }, recordId] } as const;
    return {
        $id: policy.schemas.diagnosisId,
        $schema: config.kernel.schemas.dialect,
        $comment: "Generated from protocol.config.json. Do not edit directly.",
        title: "Shepherd Orphaned Operation Diagnosis v1",
        ...closed(
            [
                "basis_id",
                "blocked_count",
                "diagnosis_version",
                "limit",
                "offset",
                "operations",
                "repairable_count",
                "total_count",
            ],
            {
                basis_id: digestId(policy.identity.diagnosisPrefix, policy.identity.hexLength),
                blocked_count: count(policy.limits.maxOperations),
                diagnosis_version: { const: policy.versions.diagnosis, type: "integer" },
                limit: { maximum: policy.limits.maxPageSize, minimum: 1, type: "integer" },
                offset: {
                    maximum: policy.limits.maxOperations,
                    minimum: 0,
                    type: "integer",
                },
                operations: {
                    items: closed(
                        [
                            "blockers",
                            "cause_record_id",
                            "death_evidence_id",
                            "operation_id",
                            "operation_version",
                            "owner_id",
                            "provider_call_started",
                            "repairable",
                            "retained_cause",
                            "scope_id",
                            "scope_owned",
                            "session_id",
                            "session_status",
                        ],
                        {
                            blockers: {
                                items: { enum: Object.values(policy.blockers), type: "string" },
                                maxItems: Object.keys(policy.blockers).length,
                                type: "array",
                                uniqueItems: true,
                            },
                            cause_record_id: nullableRecordId,
                            death_evidence_id: nullableText,
                            operation_id: text,
                            operation_version: {
                                const: policy.versions.operation,
                                type: "integer",
                            },
                            owner_id: text,
                            provider_call_started: { type: "boolean" },
                            repairable: { type: "boolean" },
                            retained_cause: boundedText(policy.limits.maxCauseBytes),
                            scope_id: nullableText,
                            scope_owned: { type: "boolean" },
                            session_id: text,
                            session_status: {
                                enum: Object.values(policy.statuses.session),
                                type: "string",
                            },
                        },
                    ),
                    maxItems: policy.limits.maxPageSize,
                    type: "array",
                },
                repairable_count: count(policy.limits.maxOperations),
                total_count: count(policy.limits.maxOperations),
            },
        ),
        "x-shepherd-max-canonical-bytes": policy.limits.maxCanonicalBytes,
    };
}

/**
 * Renders the configured exact orphan-repair command schema.
 *
 * @param config - Validated protocol configuration.
 * @returns The configured closed repair-command schema.
 */
export function renderOrphanRepairCommandSchema(
    config: ProtocolConfig,
): Readonly<Record<string, unknown>> {
    const policy = config.orphanRepair;
    return {
        $id: policy.schemas.commandId,
        $schema: config.kernel.schemas.dialect,
        $comment: "Generated from protocol.config.json. Do not edit directly.",
        title: "Shepherd Orphan Repair Command v1",
        ...closed(["basis_id", "command_id", "command_version", "operation_ids"], {
            basis_id: digestId(policy.identity.diagnosisPrefix, policy.identity.hexLength),
            command_id: boundedText(policy.limits.maxIdentifierBytes),
            command_version: { const: policy.versions.command, type: "integer" },
            operation_ids: {
                items: boundedText(policy.limits.maxIdentifierBytes),
                maxItems: policy.limits.maxOperations,
                type: "array",
                uniqueItems: true,
            },
        }),
        "x-shepherd-max-canonical-bytes": policy.limits.maxCanonicalBytes,
    };
}

/**
 * Renders the configured successful orphan-repair receipt schema.
 *
 * @param config - Validated protocol configuration.
 * @returns The configured closed repair-receipt schema.
 */
export function renderOrphanRepairReceiptSchema(
    config: ProtocolConfig,
): Readonly<Record<string, unknown>> {
    const policy = config.orphanRepair;
    const recordId = {
        pattern: `^${escapeRegularExpression(config.recordId.prefix)}[0-9a-f]{${config.recordId.hexLength}}$`,
        type: "string",
    } as const;
    return {
        $id: policy.schemas.receiptId,
        $schema: config.kernel.schemas.dialect,
        $comment: "Generated from protocol.config.json. Do not edit directly.",
        title: "Shepherd Orphan Repair Receipt v1",
        ...closed(
            [
                "basis_id",
                "command_id",
                "command_record_id",
                "operation_ids",
                "receipt_id",
                "receipt_record_id",
                "receipt_version",
                "repaired_count",
            ],
            {
                basis_id: digestId(policy.identity.diagnosisPrefix, policy.identity.hexLength),
                command_id: boundedText(policy.limits.maxIdentifierBytes),
                command_record_id: recordId,
                operation_ids: {
                    items: boundedText(policy.limits.maxIdentifierBytes),
                    maxItems: policy.limits.maxOperations,
                    type: "array",
                    uniqueItems: true,
                },
                receipt_id: digestId(policy.identity.receiptPrefix, policy.identity.hexLength),
                receipt_record_id: recordId,
                receipt_version: { const: policy.versions.receipt, type: "integer" },
                repaired_count: count(policy.limits.maxOperations),
            },
        ),
        "x-shepherd-max-canonical-bytes": policy.limits.maxCanonicalBytes,
    };
}

function closed(
    required: readonly string[],
    properties: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
    return { additionalProperties: false, properties, required, type: "object" };
}

function boundedText(maxLength: number): Readonly<Record<string, unknown>> {
    return {
        maxLength,
        minLength: 1,
        type: "string",
        "x-shepherd-max-utf8-bytes": maxLength,
    };
}

function count(maximum: number): Readonly<Record<string, unknown>> {
    return { maximum, minimum: 0, type: "integer" };
}

function digestId(prefix: string, hexLength: number): Readonly<Record<string, unknown>> {
    return {
        pattern: `^${escapeRegularExpression(prefix)}[0-9a-f]{${hexLength}}$`,
        type: "string",
    };
}

function escapeRegularExpression(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
