import type { ProtocolConfig } from "../../../src/protocol/config-types.ts";

/** Renders the closed operator audit without representing an operator decision as an effect outcome. */
export function renderEffectReconciliationSchema(
    config: ProtocolConfig,
): Readonly<Record<string, unknown>> {
    const audit = config.effects.compensation.reconciliation;
    const [, verified] = audit.dispositions;
    const record = {
        type: "string",
        pattern: `^${escapePattern(config.recordId.prefix)}[0-9a-f]{${config.recordId.hexLength}}$`,
    };
    const text = {
        type: "string",
        minLength: 1,
        maxLength: audit.limits.maxTextBytes,
        "x-shepherd-max-utf8-bytes": audit.limits.maxTextBytes,
    };
    const nullableRecord = { oneOf: [record, { type: "null" }] };
    const properties = {
        actor_id: text,
        policy_id: text,
        command_id: text,
        reason: text,
        basis_id: {
            type: "string",
            pattern: `^${escapePattern(audit.identity.basisIdPrefix)}[0-9a-f]{${config.recordId.hexLength}}$`,
        },
        compensation_id: {
            type: "string",
            pattern: `^${escapePattern(config.effects.compensation.identity.compensationIdPrefix)}[0-9a-f]{${config.effects.hexLength}}$`,
        },
        effect_record_id: record,
        target_record_id: record,
        source_owner_id: text,
        source_head_record_id: record,
        compensation_head_record_id: nullableRecord,
        previous_record_id: nullableRecord,
        source_kind: { enum: audit.sourceKinds },
        evidence_record_ids: {
            type: "array",
            items: record,
            minItems: 1,
            maxItems: audit.limits.maxEvidenceRecords,
            uniqueItems: true,
        },
        compatibility_version: { const: audit.compatibilityVersion },
        record_version: { const: audit.recordVersion },
    };
    return {
        $schema: config.kernel.schemas.dialect,
        $id: audit.schemaId,
        $comment:
            "Generated from protocol.config.json. Runtime also validates UTF-8 byte bounds, exact source/audit heads and host policy; this schema is not proof of external completion or authorization.",
        title: `Shepherd Effect Reconciliation v${audit.recordVersion}`,
        oneOf: audit.dispositions.map((disposition) => ({
            type: "object",
            additionalProperties: false,
            properties: {
                ...properties,
                disposition: { const: disposition },
                completion_verified: { const: disposition === verified },
            },
            required: [...Object.keys(properties), "disposition", "completion_verified"].sort(),
        })),
    };
}

function escapePattern(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
