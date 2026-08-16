import { createRecordId } from "../canonical/canonical-record.ts";
import type { RecordId } from "../record/types.ts";
import type { SQLiteTraceStore } from "../store/sqlite-trace-store.ts";
import type { Cut } from "../store/types.ts";

/**
 * Publishes the deterministic immutable cut for one durable lifecycle terminal.
 *
 * @param store - Open trace store receiving the cut publication.
 * @param runId - Durable execution owner targeted by the cut.
 * @param lifecycleRecordId - Terminal lifecycle record ending the cut.
 * @param recoveryCommandRecordId - Optional recovery command causing cut repair.
 * @returns The immutable published cut.
 * @internal
 */
export function publishDurableExecutionCut(
    store: SQLiteTraceStore,
    runId: string,
    lifecycleRecordId: RecordId,
    recoveryCommandRecordId: RecordId | null = null,
): Cut {
    return store.publishCut({
        ...(recoveryCommandRecordId === null
            ? {}
            : { caused_by_record_ids: [recoveryCommandRecordId] }),
        cut_id: createDurableExecutionCutId(runId, lifecycleRecordId),
        target_owner_id: runId,
        through_record_id: lifecycleRecordId,
    });
}

/**
 * Creates the deterministic cut identity for one durable lifecycle terminal.
 *
 * @param runId - Durable execution owner targeted by the cut.
 * @param lifecycleRecordId - Terminal lifecycle record ending the cut.
 * @returns The deterministic content-addressed cut identity.
 * @internal
 */
export function createDurableExecutionCutId(runId: string, lifecycleRecordId: RecordId): string {
    return createRecordId({ run_id: runId, through_record_id: lifecycleRecordId });
}
