import type { DatabaseSync } from "node:sqlite";
import type { AppendBatchDraft } from "../append/types.ts";
import { kernelProtocolConfig, supervisionProtocolConfig } from "../protocol/config.ts";
import { SUPERVISION_APPROVAL_PHASES } from "../protocol/values.generated.ts";
import type { RecordId } from "../record/types.ts";
import { rollbackFailedTransaction } from "../runtime/sqlite-transaction.ts";
import {
    SupervisionApprovalConflictError,
    SupervisionEvidenceError,
    SupervisionLeaseConflictError,
    SupervisionLeaseFencedError,
} from "../supervision/errors.ts";
import { readSupervisionApprovalBody } from "../supervision/records.ts";
import { appendWithinTraceStoreTransaction } from "./append.ts";
import { STORE_TABLES, STORE_TRANSACTION_SQL } from "./constants.ts";
import { assertNonNegativeMilliseconds } from "./durable-execution-claims.ts";
import { TraceStoreError } from "./errors.ts";
import { readOwnerRecordAtOrdinal } from "./read.ts";
import { hasAppendIntent, readScopeHead } from "./scope-registrations.ts";
import type { AppendReceipt, StoreAppendRequest } from "./types.ts";

const [REQUESTED_PHASE] = SUPERVISION_APPROVAL_PHASES;

/** Live registration and decision-lease row of one supervised dispatch. @internal */
export type SupervisedDispatchRow = {
    /** Current lease holder. */
    readonly claim_id: string;
    /** Dispatch identity and owner path. */
    readonly dispatch_id: string;
    /** First retained dispatch record. */
    readonly dispatch_record_id: RecordId;
    /** Monotonic fencing token. */
    readonly fencing_token: number;
    /** Lease expiry in Unix milliseconds. */
    readonly lease_expires_at: number;
    /** Whether the lease is released. */
    readonly released: boolean;
    /** Whether a resolution record is retained. */
    readonly resolved: boolean;
};

/** Exact dispatcher authority presented with a dispatch append. @internal */
export type SupervisionFence = {
    /** Exact claim identity. */
    readonly claimId: string;
    /** Exact monotonic fencing token. */
    readonly fencingToken: number;
};

/** Result of one fenced dispatch append. @internal */
export type SupervisedDispatchAppend =
    | { readonly receipt: AppendReceipt; readonly status: "appended" }
    | { readonly status: "head_moved" };

/**
 * Atomically retains or replays the dispatch record and admits a decision lease.
 *
 * A resolved dispatch returns its row without claiming. An imported dispatch has no row and
 * cannot be resumed in this store.
 *
 * @internal
 */
export function openSupervisedDispatchInStore(
    database: DatabaseSync,
    dispatchId: string,
    claimId: string,
    nowMilliseconds: number,
    citedRecordIds: readonly RecordId[],
    request: StoreAppendRequest,
): SupervisedDispatchRow {
    assertNonNegativeMilliseconds(nowMilliseconds, "clock");
    const leaseExpiresAt = readLeaseExpiry(nowMilliseconds);
    database.exec(STORE_TRANSACTION_SQL.begin);
    try {
        const replay = hasAppendIntent(database, request.append_intent_id);
        if (!replay) {
            if (readScopeHead(database, dispatchId) !== undefined) {
                throw new SupervisionEvidenceError(
                    `owner path ${dispatchId} already retains records`,
                );
            }
            assertCitationsRetained(database, citedRecordIds);
        }
        const receipt = appendWithinTraceStoreTransaction(database, request);
        let row = readSupervisedDispatchRow(database, dispatchId);
        if (!replay) {
            database
                .prepare(
                    `INSERT INTO ${STORE_TABLES.supervisedDispatches}(dispatch_id, dispatch_record_id, resolved, claim_id, fencing_token, lease_expires_at, released) VALUES (?, ?, 0, ?, 1, ?, 0)`,
                )
                .run(dispatchId, receipt.record_ids[0] as string, claimId, leaseExpiresAt);
        } else if (row === undefined) {
            throw new SupervisionEvidenceError(
                `dispatch ${dispatchId} is not registered for mutation in this store`,
            );
        } else if (!row.resolved) {
            if (
                row.claim_id !== claimId &&
                !row.released &&
                row.lease_expires_at > nowMilliseconds
            ) {
                throw new SupervisionLeaseConflictError(dispatchId, row.claim_id);
            }
            // Every reopen mints a new fence, even for the same claim identity, so two dispatchers
            // sharing a claim identity can never both hold authority.
            database
                .prepare(
                    `UPDATE ${STORE_TABLES.supervisedDispatches} SET claim_id = ?, fencing_token = fencing_token + 1, lease_expires_at = ?, released = 0 WHERE dispatch_id = ?`,
                )
                .run(claimId, leaseExpiresAt, dispatchId);
        }
        row = readSupervisedDispatchRow(database, dispatchId) as SupervisedDispatchRow;
        database.exec(STORE_TRANSACTION_SQL.commit);
        return row;
    } catch (error) {
        rollbackFailedTransaction(database, STORE_TRANSACTION_SQL.rollback);
        throw error;
    }
}

/** Renews the current decision lease or fails closed when fenced. @internal */
export function renewSupervisedDispatchLeaseInStore(
    database: DatabaseSync,
    dispatchId: string,
    fence: SupervisionFence,
    nowMilliseconds: number,
): SupervisedDispatchRow {
    assertNonNegativeMilliseconds(nowMilliseconds, "clock");
    const leaseExpiresAt = readLeaseExpiry(nowMilliseconds);
    database.exec(STORE_TRANSACTION_SQL.begin);
    try {
        assertCurrentFence(database, dispatchId, fence, nowMilliseconds);
        database
            .prepare(
                `UPDATE ${STORE_TABLES.supervisedDispatches} SET lease_expires_at = ? WHERE dispatch_id = ?`,
            )
            .run(leaseExpiresAt, dispatchId);
        const row = readSupervisedDispatchRow(database, dispatchId) as SupervisedDispatchRow;
        database.exec(STORE_TRANSACTION_SQL.commit);
        return row;
    } catch (error) {
        rollbackFailedTransaction(database, STORE_TRANSACTION_SQL.rollback);
        throw error;
    }
}

/**
 * Appends one dispatcher record under the current fence and exact head.
 *
 * The fence is checked before anything else, so a stale dispatcher is refused even when its
 * append would equal retained evidence. A resolving append marks the row resolved and releases
 * the lease in the same transaction.
 *
 * @internal
 */
export function appendSupervisedDispatchRecordInStore(
    database: DatabaseSync,
    dispatchId: string,
    fence: SupervisionFence,
    expectedHeadRecordId: RecordId,
    nowMilliseconds: number,
    request: StoreAppendRequest,
    resolves: boolean,
): SupervisedDispatchAppend {
    assertNonNegativeMilliseconds(nowMilliseconds, "clock");
    database.exec(STORE_TRANSACTION_SQL.begin);
    try {
        assertCurrentFence(database, dispatchId, fence, nowMilliseconds);
        if (readScopeHead(database, dispatchId)?.record_id !== expectedHeadRecordId) {
            database.exec(STORE_TRANSACTION_SQL.commit);
            return Object.freeze({ status: "head_moved" });
        }
        const receipt = appendWithinTraceStoreTransaction(database, request);
        if (resolves) {
            database
                .prepare(
                    `UPDATE ${STORE_TABLES.supervisedDispatches} SET resolved = 1, released = 1, lease_expires_at = 0 WHERE dispatch_id = ?`,
                )
                .run(dispatchId);
        }
        database.exec(STORE_TRANSACTION_SQL.commit);
        return Object.freeze({ receipt, status: "appended" });
    } catch (error) {
        rollbackFailedTransaction(database, STORE_TRANSACTION_SQL.rollback);
        throw error;
    }
}

/**
 * Appends one approver verdict when the exact request is the current dispatch head.
 *
 * @internal
 */
export function resolveSupervisedApprovalInStore(
    database: DatabaseSync,
    dispatchId: string,
    requestRecordId: RecordId,
    request: StoreAppendRequest,
): AppendReceipt {
    database.exec(STORE_TRANSACTION_SQL.begin);
    try {
        if (!hasAppendIntent(database, request.append_intent_id)) {
            const row = readSupervisedDispatchRow(database, dispatchId);
            if (row === undefined) {
                throw new SupervisionEvidenceError(
                    `dispatch ${dispatchId} is not registered for mutation in this store`,
                );
            }
            // A registration row is inserted with its dispatch record, so the head always exists.
            const head = readScopeHead(database, dispatchId) as { readonly owner_ordinal: number };
            const record = readOwnerRecordAtOrdinal(database, dispatchId, head.owner_ordinal);
            if (
                row.resolved ||
                record.envelope.record_id !== requestRecordId ||
                record.envelope.schema_ref !== supervisionProtocolConfig.traceSchemas.approval ||
                readSupervisionApprovalBody(record.body).phase !== REQUESTED_PHASE
            ) {
                throw new SupervisionApprovalConflictError(dispatchId);
            }
        }
        const receipt = appendWithinTraceStoreTransaction(database, request);
        database.exec(STORE_TRANSACTION_SQL.commit);
        return receipt;
    } catch (error) {
        rollbackFailedTransaction(database, STORE_TRANSACTION_SQL.rollback);
        throw error;
    }
}

/** Appends one context injection after verifying every citation is retained. @internal */
export function injectSupervisionContextInStore(
    database: DatabaseSync,
    citedRecordIds: readonly RecordId[],
    request: StoreAppendRequest,
): AppendReceipt {
    database.exec(STORE_TRANSACTION_SQL.begin);
    try {
        assertCitationsRetained(database, citedRecordIds);
        const receipt = appendWithinTraceStoreTransaction(database, request);
        database.exec(STORE_TRANSACTION_SQL.commit);
        return receipt;
    } catch (error) {
        rollbackFailedTransaction(database, STORE_TRANSACTION_SQL.rollback);
        throw error;
    }
}

/** Reads one supervised dispatch row. @internal */
export function readSupervisedDispatchRow(
    database: DatabaseSync,
    dispatchId: string,
): SupervisedDispatchRow | undefined {
    const row = database
        .prepare(
            `SELECT dispatch_id, dispatch_record_id, resolved, claim_id, fencing_token, lease_expires_at, released FROM ${STORE_TABLES.supervisedDispatches} WHERE dispatch_id = ?`,
        )
        .get(dispatchId);
    if (row === undefined) {
        return undefined;
    }
    return Object.freeze({
        claim_id: String(row.claim_id),
        dispatch_id: String(row.dispatch_id),
        dispatch_record_id: String(row.dispatch_record_id),
        fencing_token: Number(row.fencing_token),
        lease_expires_at: Number(row.lease_expires_at),
        released: Number(row.released) === 1,
        resolved: Number(row.resolved) === 1,
    });
}

/** Lists every supervised dispatch identity in canonical order. @internal */
export function readSupervisedDispatchIds(database: DatabaseSync): readonly string[] {
    return database
        .prepare(
            `SELECT dispatch_id FROM ${STORE_TABLES.supervisedDispatches} ORDER BY dispatch_id`,
        )
        .all()
        .map((row) => String(row.dispatch_id));
}

/** Verifies one dispatch row against its first and last retained records. @internal */
export function verifySupervisedDispatchRow(database: DatabaseSync, dispatchId: string): void {
    const row = readSupervisedDispatchRow(database, dispatchId) as SupervisedDispatchRow;
    const first = readOwnerRecordAtOrdinal(
        database,
        dispatchId,
        kernelProtocolConfig.append.firstOwnerOrdinal,
    );
    const head = readScopeHead(database, dispatchId) as { readonly owner_ordinal: number };
    const last = readOwnerRecordAtOrdinal(database, dispatchId, head.owner_ordinal);
    if (
        first.envelope.record_id !== row.dispatch_record_id ||
        first.envelope.schema_ref !== supervisionProtocolConfig.traceSchemas.dispatch ||
        (last.envelope.schema_ref === supervisionProtocolConfig.traceSchemas.resolution) !==
            row.resolved ||
        (row.resolved && !row.released)
    ) {
        throw new SupervisionEvidenceError(`dispatch ${dispatchId} row disagrees with its records`);
    }
}

function assertCurrentFence(
    database: DatabaseSync,
    dispatchId: string,
    fence: SupervisionFence,
    nowMilliseconds: number,
): void {
    const row = readSupervisedDispatchRow(database, dispatchId);
    if (
        row === undefined ||
        row.resolved ||
        row.released ||
        row.claim_id !== fence.claimId ||
        row.fencing_token !== fence.fencingToken ||
        row.lease_expires_at <= nowMilliseconds
    ) {
        throw new SupervisionLeaseFencedError(dispatchId, fence.claimId);
    }
}

function assertCitationsRetained(
    database: DatabaseSync,
    citedRecordIds: readonly RecordId[],
): void {
    const exists = database.prepare(`SELECT 1 FROM ${STORE_TABLES.records} WHERE record_id = ?`);
    for (const recordId of citedRecordIds) {
        if (exists.get(recordId) === undefined) {
            throw new SupervisionEvidenceError(`cited record ${recordId} is not retained`);
        }
    }
}

function readLeaseExpiry(nowMilliseconds: number): number {
    const leaseExpiresAt =
        nowMilliseconds + supervisionProtocolConfig.interception.decisionLeaseMilliseconds;
    if (!Number.isSafeInteger(leaseExpiresAt)) {
        throw new TypeError("supervision lease expiry exceeds safe integer bounds");
    }
    return leaseExpiresAt;
}

/**
 * Refuses a general append to an owner path reserved for supervised dispatches or context
 * channels.
 *
 * Those paths are written only by fenced dispatch transactions and citation-checked context
 * injection, so a raw append cannot forge a decision, verdict, admission, resolution, or uncited
 * context.
 *
 * @internal
 */
export function assertUnreservedSupervisionOwners(batch: AppendBatchDraft): void {
    const reserved = [
        supervisionProtocolConfig.identity.dispatchIdPrefix,
        supervisionProtocolConfig.identity.contextChannelIdPrefix,
    ];
    for (const group of batch.groups) {
        if (reserved.some((prefix) => group.owner_id.startsWith(prefix))) {
            throw new TraceStoreError(
                `owner path ${group.owner_id} is reserved for supervision commands`,
            );
        }
    }
}
