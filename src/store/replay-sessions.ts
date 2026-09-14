import type { DatabaseSync } from "node:sqlite";
import type { AppendBatchDraft } from "../append/types.ts";
import { kernelProtocolConfig, replayProtocolConfig } from "../protocol/config.ts";
import type { RecordId } from "../record/types.ts";
import {
    ReplayEvidenceError,
    ReplayLeaseConflictError,
    ReplayLeaseFencedError,
} from "../replay/errors.ts";
import { appendWithinTraceStoreTransaction } from "./append.ts";
import { STORE_TABLES, STORE_TRANSACTION_SQL } from "./constants.ts";
import { publishStoredCutWithinTransaction } from "./cuts.ts";
import { assertNonNegativeMilliseconds } from "./durable-execution-claims.ts";
import { TraceStoreError } from "./errors.ts";
import { readOwnerRecordAtOrdinal } from "./read.ts";
import { hasAppendIntent, readScopeHead } from "./scope-registrations.ts";
import type { AppendReceipt, Cut, CutSpec, StoreAppendRequest } from "./types.ts";

/** Live registration and writer-lease row of one replay session. @internal */
export type ReplaySessionRow = {
    /** Current lease holder. */
    readonly claim_id: string;
    /** Monotonic fencing token. */
    readonly fencing_token: number;
    /** Lease expiry in Unix milliseconds. */
    readonly lease_expires_at: number;
    /** Whether the lease is released. */
    readonly released: boolean;
    /** Session identity and owner path. */
    readonly session_id: string;
    /** First retained session record. */
    readonly session_record_id: RecordId;
    /** Whether a terminal record is retained. */
    readonly terminal: boolean;
};

/** Exact writer authority presented with a session append. @internal */
export type ReplaySessionFence = {
    /** Exact claim identity. */
    readonly claimId: string;
    /** Exact monotonic fencing token. */
    readonly fencingToken: number;
};

/** Result of one fenced session append. @internal */
export type ReplaySessionAppend =
    | { readonly cut: Cut | null; readonly receipt: AppendReceipt; readonly status: "appended" }
    | { readonly status: "head_moved" };

/** One fenced session append with an optional cut published first in the same transaction. @internal */
export type ReplaySessionAppendRequest = {
    /** Cut published before the record, or null. */
    readonly cut: CutSpec | null;
    /** Exact current session head. */
    readonly expectedHeadRecordId: RecordId;
    /** Builds the record append from the published cut. */
    readonly request: (cut: Cut | null) => StoreAppendRequest;
    /** Whether the append retains the terminal record and releases the lease. */
    readonly terminal: boolean;
};

/**
 * Atomically retains a new session record and admits its first writer lease.
 *
 * An existing session is returned unchanged: sessions are never re-claimed, so a live lease of
 * another holder is a conflict and every other non-terminal state is left to the caller's
 * classification. An imported session has no row.
 *
 * @internal
 */
export function openReplaySessionInStore(
    database: DatabaseSync,
    sessionId: string,
    claimId: string,
    nowMilliseconds: number,
    request: StoreAppendRequest,
): { readonly created: boolean; readonly row: ReplaySessionRow | undefined } {
    assertNonNegativeMilliseconds(nowMilliseconds, "clock");
    const leaseExpiresAt = readLeaseExpiry(nowMilliseconds);
    database.exec(STORE_TRANSACTION_SQL.begin);
    try {
        const replay = hasAppendIntent(database, request.append_intent_id);
        if (!replay && readScopeHead(database, sessionId) !== undefined) {
            throw new ReplayEvidenceError(`owner path ${sessionId} already retains records`);
        }
        const receipt = appendWithinTraceStoreTransaction(database, request);
        if (!replay) {
            database
                .prepare(
                    `INSERT INTO ${STORE_TABLES.replaySessions}(session_id, session_record_id, terminal, claim_id, fencing_token, lease_expires_at, released) VALUES (?, ?, 0, ?, 1, ?, 0)`,
                )
                .run(sessionId, receipt.record_ids[0] as string, claimId, leaseExpiresAt);
        }
        const row = readReplaySessionRow(database, sessionId);
        if (
            replay &&
            row !== undefined &&
            !row.terminal &&
            !row.released &&
            row.claim_id !== claimId &&
            row.lease_expires_at > nowMilliseconds
        ) {
            throw new ReplayLeaseConflictError(sessionId, row.claim_id);
        }
        database.exec(STORE_TRANSACTION_SQL.commit);
        return Object.freeze({ created: !replay, row });
    } catch (error) {
        database.exec(STORE_TRANSACTION_SQL.rollback);
        throw error;
    }
}

/** Renews the current session lease or fails closed when fenced. @internal */
export function renewReplaySessionLeaseInStore(
    database: DatabaseSync,
    sessionId: string,
    fence: ReplaySessionFence,
    nowMilliseconds: number,
): ReplaySessionRow {
    assertNonNegativeMilliseconds(nowMilliseconds, "clock");
    const leaseExpiresAt = readLeaseExpiry(nowMilliseconds);
    database.exec(STORE_TRANSACTION_SQL.begin);
    try {
        assertCurrentFence(database, sessionId, fence, nowMilliseconds);
        database
            .prepare(
                `UPDATE ${STORE_TABLES.replaySessions} SET lease_expires_at = ? WHERE session_id = ?`,
            )
            .run(leaseExpiresAt, sessionId);
        const row = readReplaySessionRow(database, sessionId) as ReplaySessionRow;
        database.exec(STORE_TRANSACTION_SQL.commit);
        return row;
    } catch (error) {
        database.exec(STORE_TRANSACTION_SQL.rollback);
        throw error;
    }
}

/**
 * Appends one session record under the current fence and exact head.
 *
 * The fence is checked first, so a stale writer is refused even when its append would equal
 * retained evidence. An optional cut is published before the record in the same transaction, and
 * a terminal append marks the row terminal and releases the lease.
 *
 * @internal
 */
export function appendReplaySessionRecordInStore(
    database: DatabaseSync,
    sessionId: string,
    fence: ReplaySessionFence,
    nowMilliseconds: number,
    append: ReplaySessionAppendRequest,
): ReplaySessionAppend {
    assertNonNegativeMilliseconds(nowMilliseconds, "clock");
    database.exec(STORE_TRANSACTION_SQL.begin);
    try {
        assertCurrentFence(database, sessionId, fence, nowMilliseconds);
        if (readScopeHead(database, sessionId)?.record_id !== append.expectedHeadRecordId) {
            database.exec(STORE_TRANSACTION_SQL.commit);
            return Object.freeze({ status: "head_moved" });
        }
        const cut =
            append.cut === null ? null : publishStoredCutWithinTransaction(database, append.cut);
        const receipt = appendWithinTraceStoreTransaction(database, append.request(cut));
        if (append.terminal) {
            database
                .prepare(
                    `UPDATE ${STORE_TABLES.replaySessions} SET terminal = 1, released = 1, lease_expires_at = 0 WHERE session_id = ?`,
                )
                .run(sessionId);
        }
        database.exec(STORE_TRANSACTION_SQL.commit);
        return Object.freeze({ cut, receipt, status: "appended" });
    } catch (error) {
        database.exec(STORE_TRANSACTION_SQL.rollback);
        throw error;
    }
}

/** Reads one replay session row. @internal */
export function readReplaySessionRow(
    database: DatabaseSync,
    sessionId: string,
): ReplaySessionRow | undefined {
    const row = database
        .prepare(
            `SELECT session_id, session_record_id, terminal, claim_id, fencing_token, lease_expires_at, released FROM ${STORE_TABLES.replaySessions} WHERE session_id = ?`,
        )
        .get(sessionId);
    if (row === undefined) {
        return undefined;
    }
    return Object.freeze({
        claim_id: String(row.claim_id),
        fencing_token: Number(row.fencing_token),
        lease_expires_at: Number(row.lease_expires_at),
        released: Number(row.released) === 1,
        session_id: String(row.session_id),
        session_record_id: String(row.session_record_id),
        terminal: Number(row.terminal) === 1,
    });
}

/** Lists every replay session identity in canonical order. @internal */
export function readReplaySessionIds(database: DatabaseSync): readonly string[] {
    return database
        .prepare(`SELECT session_id FROM ${STORE_TABLES.replaySessions} ORDER BY session_id`)
        .all()
        .map((row) => String(row.session_id));
}

/** Verifies one session row against its first and last retained records. @internal */
export function verifyReplaySessionRow(database: DatabaseSync, sessionId: string): void {
    const row = readReplaySessionRow(database, sessionId) as ReplaySessionRow;
    const first = readOwnerRecordAtOrdinal(
        database,
        sessionId,
        kernelProtocolConfig.append.firstOwnerOrdinal,
    );
    const head = readScopeHead(database, sessionId) as { readonly owner_ordinal: number };
    const last = readOwnerRecordAtOrdinal(database, sessionId, head.owner_ordinal);
    if (
        first.envelope.record_id !== row.session_record_id ||
        first.envelope.schema_ref !== replayProtocolConfig.traceSchemas.session ||
        (last.envelope.schema_ref === replayProtocolConfig.traceSchemas.terminal) !==
            row.terminal ||
        (row.terminal && !row.released)
    ) {
        throw new ReplayEvidenceError(`session ${sessionId} row disagrees with its records`);
    }
}

/**
 * Refuses a general append or cut publication to an owner path reserved for replay sessions.
 *
 * Session paths are written only by fenced session transactions, so a raw append cannot forge a
 * step, checkpoint, restore, or terminal record.
 *
 * @internal
 */
export function assertUnreservedReplayOwners(batch: AppendBatchDraft): void {
    for (const group of batch.groups) {
        assertUnreservedReplayOwner(group.owner_id);
    }
}

/** Refuses one owner path reserved for replay sessions. @internal */
export function assertUnreservedReplayOwner(ownerId: string): void {
    if (ownerId.startsWith(replayProtocolConfig.identity.sessionIdPrefix)) {
        throw new TraceStoreError(`owner path ${ownerId} is reserved for replay sessions`);
    }
}

function assertCurrentFence(
    database: DatabaseSync,
    sessionId: string,
    fence: ReplaySessionFence,
    nowMilliseconds: number,
): void {
    const row = readReplaySessionRow(database, sessionId);
    if (
        row === undefined ||
        row.terminal ||
        row.released ||
        row.claim_id !== fence.claimId ||
        row.fencing_token !== fence.fencingToken ||
        row.lease_expires_at <= nowMilliseconds
    ) {
        throw new ReplayLeaseFencedError(sessionId, fence.claimId);
    }
}

function readLeaseExpiry(nowMilliseconds: number): number {
    const leaseExpiresAt = nowMilliseconds + replayProtocolConfig.lease.leaseMilliseconds;
    if (!Number.isSafeInteger(leaseExpiresAt)) {
        throw new TypeError("replay lease expiry exceeds safe integer bounds");
    }
    return leaseExpiresAt;
}
