import type { DatabaseSync } from "node:sqlite";
import type { AppendBatchDraft } from "../append/types.ts";
import { applicationsProtocolConfig } from "../protocol/config.ts";
import type { RecordId } from "../record/types.ts";
import { rollbackFailedTransaction } from "../runtime/sqlite-transaction.ts";
import { appendWithinTraceStoreTransaction } from "./append.ts";
import { STORE_TRANSACTION_SQL } from "./constants.ts";
import { publishStoredCutWithinTransaction } from "./cuts.ts";
import { TraceStoreError } from "./errors.ts";
import { hasAppendIntent, readScopeHead } from "./scope-registrations.ts";
import type { AppendReceipt, Cut, CutId, StoreAppendRequest } from "./types.ts";

/** Result of one head-compared application record append. @internal */
export type ApplicationRecordAppend =
    | {
          /** Terminal cut published through the appended record, or null when none was requested. */
          readonly cut: Cut | null;
          /** Durable receipt of the appended or replayed record. */
          readonly receipt: AppendReceipt;
          /** Whether the record was appended now or replayed from an earlier identical append. */
          readonly status: "appended" | "replayed";
      }
    | { readonly status: "head_moved" };

/**
 * Appends one application record when the exact application owner head is unchanged, publishing
 * the requested terminal cut through the appended record inside the same transaction.
 *
 * A command already retained replays identically regardless of the current head and republishes
 * its cut idempotently; a different body under the same intent fails as an append-intent
 * conflict. An expected head of `null` requires an empty owner path.
 *
 * @internal
 */
export function appendApplicationRecordInStore(
    database: DatabaseSync,
    applicationId: string,
    expectedHeadRecordId: RecordId | null,
    request: StoreAppendRequest,
    cutId: CutId | null,
): ApplicationRecordAppend {
    database.exec(STORE_TRANSACTION_SQL.begin);
    try {
        const replayed = hasAppendIntent(database, request.append_intent_id);
        if (
            !replayed &&
            (readScopeHead(database, applicationId)?.record_id ?? null) !== expectedHeadRecordId
        ) {
            database.exec(STORE_TRANSACTION_SQL.commit);
            return Object.freeze({ status: "head_moved" });
        }
        const receipt = appendWithinTraceStoreTransaction(database, request);
        const cut =
            cutId === null
                ? null
                : publishStoredCutWithinTransaction(database, {
                      cut_id: cutId,
                      target_owner_id: applicationId,
                      through_record_id: receipt.record_ids[0] as RecordId,
                  });
        database.exec(STORE_TRANSACTION_SQL.commit);
        return Object.freeze({ cut, receipt, status: replayed ? "replayed" : "appended" });
    } catch (error) {
        rollbackFailedTransaction(database, STORE_TRANSACTION_SQL.rollback);
        throw error;
    }
}

/**
 * Refuses a general append or cut publication to an owner path reserved for applications.
 *
 * Application paths are written only by application command transactions, so a raw append
 * cannot forge an opened, decision, or manifest record or its terminal cut.
 *
 * @internal
 */
export function assertUnreservedApplicationOwners(batch: AppendBatchDraft): void {
    for (const group of batch.groups) {
        assertUnreservedApplicationOwner(group.owner_id);
    }
}

/** Refuses one owner path reserved for application runs. @internal */
export function assertUnreservedApplicationOwner(ownerId: string): void {
    if (ownerId.startsWith(applicationsProtocolConfig.identity.applicationIdPrefix)) {
        throw new TraceStoreError(`owner path ${ownerId} is reserved for application runs`);
    }
}
