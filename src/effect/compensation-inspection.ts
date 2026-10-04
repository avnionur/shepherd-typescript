import { canonicalizeSemanticValue } from "../canonical/canonical-record.ts";
import { createCanonicalSnapshot } from "../canonical/snapshot.ts";
import { effectProtocolConfig } from "../protocol/config.ts";
import {
    EFFECT_COMPENSATION_OUTCOMES,
    EFFECT_COMPENSATION_PHASES,
    EFFECT_COMPENSATION_STATUSES,
    RECORD_MODES,
} from "../protocol/values.generated.ts";
import { ROOT_WITNESS_ID } from "../record/root-witness.ts";
import type { RecordId } from "../record/types.ts";
import type { SQLiteTraceStore } from "../store/sqlite-trace-store.ts";
import type { OwnerRecord } from "../store/types.ts";
import { EffectCompensationEvidenceError } from "./compensation-errors.ts";
import {
    type EffectCompensationRecordBody,
    readCompensationRecordBody,
} from "./compensation-records.ts";
import type {
    EffectCompensationAttemptInspection,
    EffectCompensationInspection,
    EffectCompensationTrigger,
} from "./compensation-types.ts";

import {
    readReconciliationRecord,
    reconciliationCauses,
    reconciliationCommandOwner,
    reconciliationOwner,
} from "./reconciliation-records.ts";

const config = effectProtocolConfig.compensation;
const [CAPTURE_MODE] = RECORD_MODES;
const [INTENT_PHASE, ATTEMPT_PHASE] = EFFECT_COMPENSATION_PHASES;
const [COMPENSATED] = EFFECT_COMPENSATION_OUTCOMES;
const [PENDING, UNCERTAIN, FAILED_STATUS, COMPENSATED_STATUS] = EFFECT_COMPENSATION_STATUSES;

/** Validates and folds immutable compensation records without live ownership or operator policy. @internal */
export function foldCompensation(
    store: SQLiteTraceStore,
    compensationId: string,
    records: readonly OwnerRecord[],
): EffectCompensationInspection | undefined {
    const read = (record: OwnerRecord): EffectCompensationRecordBody => {
        if (
            record.envelope.schema_ref !== config.traceSchema ||
            record.envelope.mode !== CAPTURE_MODE
        ) {
            throw new EffectCompensationEvidenceError(
                `compensation ${compensationId} retains a foreign record`,
            );
        }
        return readCompensationRecordBody(record.body, compensationId);
    };
    let intent: Extract<EffectCompensationRecordBody, { phase: typeof INTENT_PHASE }> | undefined;
    let intentRecordId: RecordId | undefined;
    const attempts: {
        attempt: number;
        handler_id: string;
        outcome: EffectCompensationAttemptInspection["outcome"];
        record_id: RecordId;
        trigger: EffectCompensationTrigger;
    }[] = [];
    let previous: OwnerRecord | undefined;
    for (const record of records) {
        const last = attempts.at(-1);
        if (record.envelope.schema_ref === config.reconciliation.traceSchema) {
            const guard = readReconciliationRecord(record.body);
            if (
                record.envelope.mode !== CAPTURE_MODE ||
                record.envelope.witness_ref !== ROOT_WITNESS_ID ||
                guard.compensation_id !== compensationId ||
                guard.compensation_head_record_id !== (previous?.envelope.record_id ?? null) ||
                last?.outcome?.status === COMPENSATED ||
                canonicalizeSemanticValue(record.envelope.caused_by_record_ids) !==
                    canonicalizeSemanticValue(reconciliationCauses(guard)) ||
                !store
                    .readOwner(reconciliationOwner(guard.target_record_id))
                    .some((entry) => entry.envelope.record_id === record.envelope.record_id) ||
                store.readOwner(reconciliationCommandOwner(guard.command_id)).length !== 1 ||
                store.readOwner(reconciliationCommandOwner(guard.command_id))[0]?.envelope
                    .record_id !== record.envelope.record_id
            )
                throw new EffectCompensationEvidenceError(
                    `compensation ${compensationId} retains an invalid reconciliation guard`,
                );
            previous = record;
            continue;
        }
        const body = read(record);
        if (intent === undefined) {
            if (
                body.phase !== INTENT_PHASE ||
                canonicalizeSemanticValue(record.envelope.caused_by_record_ids) !==
                    canonicalizeSemanticValue([
                        ...new Set([
                            body.materialization.record_id,
                            ...(previous === undefined ? [] : [previous.envelope.record_id]),
                        ]),
                    ])
            ) {
                throw new EffectCompensationEvidenceError(
                    `compensation ${compensationId} does not start with its intent`,
                );
            }
            intent = body;
            intentRecordId = record.envelope.record_id;
            previous = record;
            continue;
        }
        if (
            record.envelope.caused_by_record_ids.join("\0") !== previous?.envelope.record_id ||
            last?.outcome?.status === COMPENSATED ||
            (body.phase === ATTEMPT_PHASE
                ? body.attempt !== attempts.length + 1
                : body.phase === INTENT_PHASE ||
                  last === undefined ||
                  last.outcome !== null ||
                  body.attempt !== last.attempt)
        ) {
            throw new EffectCompensationEvidenceError(
                `compensation ${compensationId} retains an out-of-order record`,
            );
        }
        if (body.phase === ATTEMPT_PHASE) {
            attempts.push({
                attempt: body.attempt,
                handler_id: body.handler_id,
                outcome: null,
                record_id: record.envelope.record_id as RecordId,
                trigger: body.trigger,
            });
        } else if (body.phase !== INTENT_PHASE) {
            (last as NonNullable<typeof last>).outcome = Object.freeze({
                record_id: record.envelope.record_id as RecordId,
                result: body.result,
                status: body.status,
            });
        }
        previous = record;
    }
    if (intent === undefined || previous === undefined) return undefined;
    const latest = attempts.at(-1);
    return createCanonicalSnapshot({
        attempts: attempts.map((entry) => ({ ...entry })),
        compensation_id: compensationId,
        effect_intent: intent.effect_intent,
        effect_outcome: intent.effect_outcome,
        head_record_id: previous.envelope.record_id,
        intent_record_id: intentRecordId,
        materialization: intent.materialization,
        status:
            latest === undefined
                ? PENDING
                : latest.outcome === null
                  ? UNCERTAIN
                  : latest.outcome.status === COMPENSATED
                    ? COMPENSATED_STATUS
                    : FAILED_STATUS,
    }) as unknown as EffectCompensationInspection;
}
