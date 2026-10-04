import { replayProtocolConfig, supervisionProtocolConfig } from "../protocol/config.ts";
import {
    EFFECT_RECONCILIATION_SOURCE_KINDS,
    REPLAY_EFFECT_DISPOSITIONS,
    REPLAY_STEP_SOURCES,
    SUPERVISION_DISPOSITIONS,
} from "../protocol/values.generated.ts";
import { assertRecordId } from "../record/guards.ts";
import type { RecordId } from "../record/types.ts";
import { foldReplaySession } from "../replay/inspection.ts";
import { readReplayAdmissionBody, readReplayStepBody } from "../replay/records.ts";
import type { SQLiteTraceStore } from "../store/sqlite-trace-store.ts";
import { inspectSupervisedDispatch } from "../supervision/control.ts";
import { EffectCompensationEvidenceError } from "./compensation-errors.ts";
import { deriveEffectCompensationId } from "./compensation-records.ts";
import type { EffectReconciliationTarget } from "./reconciliation-types.ts";
import { createIntentReference } from "./records.ts";

const [REPLAY, SUPERVISED] = EFFECT_RECONCILIATION_SOURCE_KINDS;
const [MATERIALIZED, , REFUSED] = REPLAY_EFFECT_DISPOSITIONS;
const [, RECORDED] = REPLAY_STEP_SOURCES;
const [DISPATCH_MATERIALIZED] = SUPERVISION_DISPOSITIONS;

/** Resolves exact retained effect evidence without inventing a missing intent or outcome. @internal */
export function readReconciliationTarget(
    store: SQLiteTraceStore,
    requestedRecordId: RecordId,
): EffectReconciliationTarget {
    assertRecordId(requestedRecordId, "effectRecordId");
    let recordId = requestedRecordId;
    // Each validated replay fold already verifies the complete acyclic source lineage.
    for (;;) {
        const record = store.readRecord(recordId);
        if (record === undefined)
            throw new EffectCompensationEvidenceError("reconciliation source record is absent");
        if (record.envelope.schema_ref === replayProtocolConfig.traceSchemas.step) {
            const body = readReplayStepBody(record.body);
            const source = foldReplaySession(
                store,
                body.session_id,
                store.readOwner(body.session_id),
                store.readReplaySession(body.session_id),
                Date.now(),
            );
            const step = source.steps.find((entry) => entry.record_id === recordId);
            if (step?.effect === null || step === undefined || step.effect.disposition === REFUSED)
                throw new EffectCompensationEvidenceError("source is not an admitted effect");
            if (step.source === RECORDED && step.source_step_record_id !== null) {
                recordId = step.source_step_record_id;
                continue;
            }
            return Object.freeze({
                requested_record_id: requestedRecordId,
                effect_record_id: recordId,
                compensation_id: deriveEffectCompensationId(recordId),
                source_kind: REPLAY,
                source_owner_id: source.session_id,
                source_head_record_id: source.head_record_id,
                intent_ref: step.effect.intent_ref,
                intent: step.effect.intent,
                outcome: step.effect.outcome,
                successful_materialization:
                    step.effect.disposition === MATERIALIZED &&
                    step.effect.outcome?.result.ok === true,
            });
        }
        if (record.envelope.schema_ref === replayProtocolConfig.traceSchemas.admission) {
            const body = readReplayAdmissionBody(record.body);
            const source = foldReplaySession(
                store,
                body.session_id,
                store.readOwner(body.session_id),
                store.readReplaySession(body.session_id),
                Date.now(),
            );
            const completed = source.steps.find(
                (step) => step.effect?.admission_record_id === recordId,
            );
            if (completed !== undefined) {
                recordId = completed.record_id;
                continue;
            }
            if (source.pending_admission_record_id !== recordId)
                throw new EffectCompensationEvidenceError(
                    "admission is not retained by its source",
                );
            return Object.freeze({
                requested_record_id: requestedRecordId,
                effect_record_id: recordId,
                compensation_id: deriveEffectCompensationId(recordId),
                source_kind: REPLAY,
                source_owner_id: source.session_id,
                source_head_record_id: source.head_record_id,
                intent_ref: body.intent_ref,
                intent: null,
                outcome: null,
                successful_materialization: false,
            });
        }
        if (
            [
                supervisionProtocolConfig.traceSchemas.admission,
                supervisionProtocolConfig.traceSchemas.resolution,
            ].includes(record.envelope.schema_ref)
        ) {
            const owner = record.body.dispatch_id;
            if (typeof owner !== "string")
                throw new EffectCompensationEvidenceError("dispatch source has no owner");
            const source = inspectSupervisedDispatch(store, { dispatchId: owner });
            if (
                source.admission_record_id === null ||
                (source.resolution?.record_id !== recordId &&
                    source.admission_record_id !== recordId)
            )
                throw new EffectCompensationEvidenceError(
                    "dispatch evidence does not name an admitted effect",
                );
            if (source.resolution !== null && recordId !== source.resolution.record_id) {
                recordId = source.resolution.record_id;
                continue;
            }
            return Object.freeze({
                requested_record_id: requestedRecordId,
                effect_record_id: recordId,
                compensation_id: deriveEffectCompensationId(recordId),
                source_kind: SUPERVISED,
                source_owner_id: source.dispatch_id,
                source_head_record_id: source.head.record_id,
                intent_ref:
                    source.resolution?.outcome?.intent_ref ??
                    createIntentReference(source.effective_intent),
                intent: source.effective_intent,
                outcome: source.resolution?.outcome ?? null,
                successful_materialization:
                    source.resolution?.disposition === DISPATCH_MATERIALIZED &&
                    source.resolution.outcome?.result.ok === true,
            });
        }
        throw new EffectCompensationEvidenceError(
            "record is not supported effect reconciliation evidence",
        );
    }
}
