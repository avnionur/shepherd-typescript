import { createRecordId, type SemanticRecord } from "../canonical/canonical-record.ts";
import { createCanonicalSnapshot } from "../canonical/snapshot.ts";
import { effectProtocolConfig, recordIdConfig } from "../protocol/config.ts";
import {
    EFFECT_RECONCILIATION_DISPOSITIONS,
    EFFECT_RECONCILIATION_SOURCE_KINDS,
} from "../protocol/values.generated.ts";
import { assertRecordId } from "../record/guards.ts";
import type { RecordId } from "../record/types.ts";
import { assertScopeText, readScopeArray, readScopeDataObject } from "../scope/validation.ts";
import { EffectCompensationEvidenceError } from "./compensation-errors.ts";
import { deriveEffectCompensationId } from "./compensation-records.ts";
import type {
    EffectReconciliationBasis,
    EffectReconciliationRecord,
} from "./reconciliation-types.ts";

const config = effectProtocolConfig.compensation.reconciliation;
const [, VERIFIED] = EFFECT_RECONCILIATION_DISPOSITIONS;

/** Derives the target's append-only operator audit owner. @internal */
export function reconciliationOwner(targetRecordId: RecordId): string {
    return config.identity.targetOwnerPrefix + targetRecordId;
}

/** Derives globally idempotent command intent identity. @internal */
export function reconciliationCommandIntent(commandId: string): string {
    return createRecordId({ [config.identity.commandIntentKind]: commandId });
}

/** Derives the command's immutable receipt owner. @internal */
export function reconciliationCommandOwner(commandId: string): string {
    return config.identity.commandOwnerPrefix + reconciliationCommandIntent(commandId);
}

/** Binds every exact head consumed by an operator decision. @internal */
export function reconciliationBasisId(basis: EffectReconciliationBasis): string {
    return (
        config.identity.basisIdPrefix +
        createRecordId(basis as unknown as SemanticRecord).slice(recordIdConfig.prefix.length)
    );
}

/** Validates bounded well-formed operator text. @internal */
export function assertReconciliationText(value: unknown, subject: string): asserts value is string {
    assertScopeText(value, subject);
    if (Buffer.byteLength(value, "utf8") > config.limits.maxTextBytes)
        throw new TypeError(`${subject} exceeds the configured byte bound`);
}

/** Reads a nonempty bounded exact evidence set without evaluating accessors. @internal */
export function readReconciliationEvidence(value: unknown): readonly RecordId[] {
    const evidence = readScopeArray(value, "reconciliation evidence");
    if (
        evidence.length === 0 ||
        evidence.length > config.limits.maxEvidenceRecords ||
        new Set(evidence).size !== evidence.length
    )
        throw new TypeError("reconciliation evidence must be nonempty, unique and bounded");
    for (const id of evidence) assertRecordId(id, "reconciliation evidence record");
    return Object.freeze([...evidence]) as readonly RecordId[];
}

/** Derives exact causal citations for one audit without claiming an external result. @internal */
export function reconciliationCauses(body: EffectReconciliationRecord): readonly RecordId[] {
    return Object.freeze([
        ...new Set([
            body.effect_record_id,
            body.target_record_id,
            body.source_head_record_id,
            ...(body.compensation_head_record_id === null
                ? []
                : [body.compensation_head_record_id]),
            ...(body.previous_record_id === null ? [] : [body.previous_record_id]),
            ...body.evidence_record_ids,
        ]),
    ]);
}

/** Decodes a closed operator audit and re-derives its exact identities. @internal */
export function readReconciliationRecord(value: unknown): EffectReconciliationRecord {
    try {
        const fields = readScopeDataObject(
            value,
            [
                "actor_id",
                "policy_id",
                "basis_id",
                "command_id",
                "disposition",
                "effect_record_id",
                "evidence_record_ids",
                "reason",
                "target_record_id",
                "compensation_id",
                "source_kind",
                "source_owner_id",
                "source_head_record_id",
                "compensation_head_record_id",
                "previous_record_id",
                "compatibility_version",
                "record_version",
                "completion_verified",
            ],
            "reconciliation record",
        );
        for (const key of [
            "actor_id",
            "policy_id",
            "command_id",
            "reason",
            "source_owner_id",
        ] as const)
            assertReconciliationText(fields[key], key);
        for (const key of [
            "effect_record_id",
            "target_record_id",
            "source_head_record_id",
        ] as const)
            assertRecordId(fields[key], key);
        for (const key of ["compensation_head_record_id", "previous_record_id"] as const)
            if (fields[key] !== null) assertRecordId(fields[key], key);
        const evidence = readReconciliationEvidence(fields.evidence_record_ids);
        if (
            fields.record_version !== config.recordVersion ||
            fields.compatibility_version !== config.compatibilityVersion ||
            !(EFFECT_RECONCILIATION_DISPOSITIONS as readonly unknown[]).includes(
                fields.disposition,
            ) ||
            !(EFFECT_RECONCILIATION_SOURCE_KINDS as readonly unknown[]).includes(
                fields.source_kind,
            ) ||
            fields.completion_verified !== (fields.disposition === VERIFIED) ||
            fields.compensation_id !== deriveEffectCompensationId(fields.target_record_id as string)
        )
            throw new TypeError(
                "reconciliation versions, disposition or identity are inconsistent",
            );
        const basis: EffectReconciliationBasis = {
            target_record_id: fields.target_record_id as string,
            compensation_id: fields.compensation_id as string,
            source_kind: fields.source_kind as EffectReconciliationBasis["source_kind"],
            source_owner_id: fields.source_owner_id as string,
            source_head_record_id: fields.source_head_record_id as string,
            compensation_head_record_id: fields.compensation_head_record_id as string | null,
            previous_record_id: fields.previous_record_id as string | null,
        };
        if (fields.basis_id !== reconciliationBasisId(basis))
            throw new TypeError("reconciliation basis identity is inconsistent");
        return createCanonicalSnapshot({
            ...fields,
            evidence_record_ids: evidence,
        } as SemanticRecord) as unknown as EffectReconciliationRecord;
    } catch (error) {
        throw new EffectCompensationEvidenceError("operator reconciliation evidence is malformed", {
            cause: error,
        });
    }
}
