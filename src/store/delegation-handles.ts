import type { DatabaseSync } from "node:sqlite";
import type { AppendBatchDraft } from "../append/types.ts";
import { DelegationEvidenceError } from "../delegation/errors.ts";
import { delegationProtocolConfig } from "../protocol/config.ts";
import type { RecordId } from "../record/types.ts";
import { rollbackFailedTransaction } from "../runtime/sqlite-transaction.ts";
import { appendWithinTraceStoreTransaction } from "./append.ts";
import { STORE_TRANSACTION_SQL } from "./constants.ts";
import { publishStoredCutWithinTransaction } from "./cuts.ts";
import { TraceStoreError } from "./errors.ts";
import { hasAppendIntent, readScopeHead } from "./scope-registrations.ts";
import type { AppendReceipt, Cut, CutId, StoreAppendRequest } from "./types.ts";

/** One handle opening: the opened record and, for a handle parent or a retry, its cuts. @internal */
export type DelegationHandleOpenRequest = {
    /** Append intent naming the opening command. */
    readonly appendIntentId: string;
    /**
     * Builds the opened record append and the cut identities from the heads read inside the
     * transaction.
     *
     * @param parentHeadRecordId - Parent handle head inside the transaction, or null for a root.
     * @param predecessorHeadRecordId - Discarded predecessor head, or null when not a retry.
     * @returns The opened record append and the origin and retry cut identities, or null each.
     */
    readonly build: (
        parentHeadRecordId: RecordId | null,
        predecessorHeadRecordId: RecordId | null,
    ) => {
        readonly originCutId: CutId | null;
        readonly request: StoreAppendRequest;
        readonly retryCutId: CutId | null;
    };
    /** Parent handle owner path, or null for a root declaration. */
    readonly parentHandleId: string | null;
    /** Discarded predecessor handle owner path and its expected head, or null. */
    readonly predecessor: {
        readonly handleId: string;
        readonly headRecordId: RecordId;
    } | null;
};

/** Result of one handle opening. @internal */
export type DelegationHandleOpen =
    | { readonly created: false }
    | {
          readonly created: true;
          readonly cut: Cut | null;
          readonly receipt: AppendReceipt;
          readonly retryCut: Cut | null;
      };

/** Result of one head-compared handle append. @internal */
export type DelegationHandleAppend =
    | { readonly receipt: AppendReceipt; readonly status: "appended" | "replayed" }
    | { readonly status: "head_moved" };

/**
 * Atomically retains a new handle's opened record and publishes, in the same transaction, the
 * origin cut through the parent head for a handle parent and the retry cut through the discarded
 * predecessor head for a retry.
 *
 * A command already retained returns `created: false` without touching the store; the caller
 * compares the retained command against the request. A fresh owner path is required for a new
 * command, so a handle identity can never be reused. A predecessor whose head moved since the
 * caller inspected it is refused before any record.
 *
 * @internal
 */
export function openDelegationHandleInStore(
    database: DatabaseSync,
    handleId: string,
    open: DelegationHandleOpenRequest,
): DelegationHandleOpen {
    database.exec(STORE_TRANSACTION_SQL.begin);
    try {
        if (hasAppendIntent(database, open.appendIntentId)) {
            database.exec(STORE_TRANSACTION_SQL.commit);
            return Object.freeze({ created: false });
        }
        if (readScopeHead(database, handleId) !== undefined) {
            throw new DelegationEvidenceError(`owner path ${handleId} already retains records`);
        }
        let parentHeadRecordId: RecordId | null = null;
        if (open.parentHandleId !== null) {
            const parentHead = readScopeHead(database, open.parentHandleId);
            if (parentHead === undefined) {
                throw new DelegationEvidenceError(
                    `parent handle ${open.parentHandleId} is not retained`,
                );
            }
            parentHeadRecordId = parentHead.record_id;
        }
        let predecessorHeadRecordId: RecordId | null = null;
        if (open.predecessor !== null) {
            const predecessorHead = readScopeHead(database, open.predecessor.handleId);
            if (predecessorHead?.record_id !== open.predecessor.headRecordId) {
                throw new DelegationEvidenceError(
                    `predecessor handle ${open.predecessor.handleId} head is not the cited decision`,
                );
            }
            predecessorHeadRecordId = predecessorHead.record_id;
        }
        const built = open.build(parentHeadRecordId, predecessorHeadRecordId);
        const receipt = appendWithinTraceStoreTransaction(database, built.request);
        const openedRecordId = receipt.record_ids[0] as RecordId;
        const cut =
            built.originCutId === null
                ? null
                : publishStoredCutWithinTransaction(database, {
                      caused_by_record_ids: [openedRecordId],
                      cut_id: built.originCutId,
                      publisher_owner_id: handleId,
                      target_owner_id: open.parentHandleId as string,
                      through_record_id: parentHeadRecordId as RecordId,
                  });
        const retryCut =
            built.retryCutId === null
                ? null
                : publishStoredCutWithinTransaction(database, {
                      caused_by_record_ids: [openedRecordId],
                      cut_id: built.retryCutId,
                      publisher_owner_id: handleId,
                      target_owner_id: (open.predecessor as { readonly handleId: string }).handleId,
                      through_record_id: predecessorHeadRecordId as RecordId,
                  });
        database.exec(STORE_TRANSACTION_SQL.commit);
        return Object.freeze({ created: true, cut, receipt, retryCut });
    } catch (error) {
        rollbackFailedTransaction(database, STORE_TRANSACTION_SQL.rollback);
        throw error;
    }
}

/**
 * Appends one handle command record when the exact handle head is unchanged.
 *
 * A command already retained replays identically regardless of the current head; a different
 * body under the same intent fails as an append-intent conflict.
 *
 * @internal
 */
export function appendDelegationHandleRecordInStore(
    database: DatabaseSync,
    handleId: string,
    expectedHeadRecordId: RecordId,
    request: StoreAppendRequest,
): DelegationHandleAppend {
    database.exec(STORE_TRANSACTION_SQL.begin);
    try {
        if (hasAppendIntent(database, request.append_intent_id)) {
            const receipt = appendWithinTraceStoreTransaction(database, request);
            database.exec(STORE_TRANSACTION_SQL.commit);
            return Object.freeze({ receipt, status: "replayed" });
        }
        if (readScopeHead(database, handleId)?.record_id !== expectedHeadRecordId) {
            database.exec(STORE_TRANSACTION_SQL.commit);
            return Object.freeze({ status: "head_moved" });
        }
        const receipt = appendWithinTraceStoreTransaction(database, request);
        database.exec(STORE_TRANSACTION_SQL.commit);
        return Object.freeze({ receipt, status: "appended" });
    } catch (error) {
        rollbackFailedTransaction(database, STORE_TRANSACTION_SQL.rollback);
        throw error;
    }
}

/**
 * Refuses a general append or cut publication to an owner path reserved for child run handles.
 *
 * Handle paths are written only by delegation command transactions, so a raw append cannot forge
 * an opened, context, completion, approval, handoff, or decision record.
 *
 * @internal
 */
export function assertUnreservedDelegationOwners(batch: AppendBatchDraft): void {
    for (const group of batch.groups) {
        assertUnreservedDelegationOwner(group.owner_id);
    }
}

/** Refuses one owner path reserved for child run handles. @internal */
export function assertUnreservedDelegationOwner(ownerId: string): void {
    if (ownerId.startsWith(delegationProtocolConfig.identity.handleIdPrefix)) {
        throw new TraceStoreError(`owner path ${ownerId} is reserved for child run handles`);
    }
}
