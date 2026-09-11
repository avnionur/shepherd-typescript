import type { DatabaseSync } from "node:sqlite";

import { projectionProtocolConfig } from "../protocol/config.ts";
import { SCOPE_STATES } from "../protocol/values.generated.ts";
import { assertNonEmptyString, assertRecordId } from "../record/guards.ts";
import type { RecordId } from "../record/types.ts";
import {
    ScopeEvidenceError,
    ScopeHeadConflictError,
    ScopeWriterConflictError,
    ScopeWriterFencedError,
} from "../scope/errors.ts";
import type { ScopeHeadAddress } from "../scope/types.ts";
import { appendWithinTraceStoreTransaction } from "./append.ts";
import { STORE_TABLES, STORE_TRANSACTION_SQL } from "./constants.ts";
import { publishStoredCutWithinTransaction, readStoredCut } from "./cuts.ts";
import { assertNonNegativeMilliseconds } from "./durable-execution-claims.ts";
import { readOwnerRecordAtOrdinal } from "./read.ts";
import type { AppendReceipt, Cut, OwnerRecord, StoreAppendRequest } from "./types.ts";

const [OPEN_STATE] = SCOPE_STATES;

/** Durable registration row admitting one scope for mutation in this store. @internal */
export type ScopeRegistrationRow = {
    /** Owning parent scope, or null for a root scope. */
    readonly parent_scope_id: string | null;
    /** Exact registration record retained at the first owner ordinal. */
    readonly registration_record_id: RecordId;
    /** Registered scope identity and owner path. */
    readonly scope_id: string;
    /** Current configured branch-lifecycle state. */
    readonly state: string;
};

/** Durable single-writer claim row for one scope. @internal */
export type ScopeWriterClaimRow = {
    /** Current claim identity. */
    readonly claim_id: string;
    /** Monotonic token fencing earlier claim holders. */
    readonly fencing_token: number;
    /** Lease expiry in Unix milliseconds. */
    readonly lease_expires_at: number;
    /** Whether the holder explicitly released the claim. */
    readonly released: boolean;
    /** Scope owned by the claim. */
    readonly scope_id: string;
};

/** Exact live writer authority presented with a mutating scope command. @internal */
export type ScopeWriterFence = {
    /** Exact claim identity. */
    readonly claimId: string;
    /** Exact monotonic fencing token. */
    readonly fencingToken: number;
};

/** Reads one scope registration row without verifying its record. @internal */
export function readScopeRegistrationRow(
    database: DatabaseSync,
    scopeId: string,
): ScopeRegistrationRow | undefined {
    assertNonEmptyString(scopeId, "scopeId");
    const row = database
        .prepare(
            `SELECT scope_id, parent_scope_id, registration_record_id, state FROM ${STORE_TABLES.scopeRegistrations} WHERE scope_id = ?`,
        )
        .get(scopeId);
    return row === undefined ? undefined : toRegistrationRow(row);
}

/** Lists every live scope registration row in canonical scope-identity order. @internal */
export function readScopeRegistrationRows(database: DatabaseSync): readonly ScopeRegistrationRow[] {
    return Object.freeze(
        database
            .prepare(
                `SELECT scope_id, parent_scope_id, registration_record_id, state FROM ${STORE_TABLES.scopeRegistrations} ORDER BY scope_id`,
            )
            .all()
            .map(toRegistrationRow),
    );
}

function toRegistrationRow(row: Record<string, unknown>): ScopeRegistrationRow {
    return Object.freeze({
        parent_scope_id: row.parent_scope_id === null ? null : String(row.parent_scope_id),
        registration_record_id: String(row.registration_record_id),
        scope_id: String(row.scope_id),
        state: String(row.state),
    });
}

/** Reads one scope writer claim row. @internal */
export function readScopeWriterClaimRow(
    database: DatabaseSync,
    scopeId: string,
): ScopeWriterClaimRow | undefined {
    assertNonEmptyString(scopeId, "scopeId");
    const row = database
        .prepare(
            `SELECT scope_id, claim_id, fencing_token, lease_expires_at, released FROM ${STORE_TABLES.scopeWriterClaims} WHERE scope_id = ?`,
        )
        .get(scopeId);
    if (row === undefined) {
        return undefined;
    }
    return Object.freeze({
        claim_id: String(row.claim_id),
        fencing_token: Number(row.fencing_token),
        lease_expires_at: Number(row.lease_expires_at),
        released: Number(row.released) === 1,
        scope_id: String(row.scope_id),
    });
}

/** Reads the owner occurrences retained by one append intent in append order. @internal */
export function readAppendIntentRecords(
    database: DatabaseSync,
    appendIntentId: string,
): readonly OwnerRecord[] {
    assertNonEmptyString(appendIntentId, "appendIntentId");
    return Object.freeze(
        database
            .prepare(
                `SELECT owner_id, owner_ordinal FROM ${STORE_TABLES.recordViews} WHERE append_intent_id = ? ORDER BY append_position`,
            )
            .all(appendIntentId)
            .map((row) =>
                readOwnerRecordAtOrdinal(database, String(row.owner_id), Number(row.owner_ordinal)),
            ),
    );
}

/** Reads the current head occurrence of one owner path. @internal */
export function readScopeHead(
    database: DatabaseSync,
    scopeId: string,
): ScopeHeadAddress | undefined {
    assertNonEmptyString(scopeId, "scopeId");
    const row = database
        .prepare(
            `SELECT record_id, owner_ordinal FROM ${STORE_TABLES.recordViews} WHERE owner_id = ? ORDER BY owner_ordinal DESC LIMIT 1`,
        )
        .get(scopeId);
    if (row === undefined) {
        return undefined;
    }
    return Object.freeze({
        owner_ordinal: Number(row.owner_ordinal),
        record_id: String(row.record_id),
    });
}

/** Atomically registers or identically replays one root scope. @internal */
export function registerRootScopeInStore(
    database: DatabaseSync,
    scopeId: string,
    executionId: string | null,
    request: StoreAppendRequest,
): AppendReceipt {
    assertNonEmptyString(scopeId, "scopeId");
    database.exec(STORE_TRANSACTION_SQL.begin);
    try {
        if (hasAppendIntent(database, request.append_intent_id)) {
            const receipt = appendWithinTraceStoreTransaction(database, request);
            database.exec(STORE_TRANSACTION_SQL.commit);
            return receipt;
        }
        assertScopeUnregistered(database, scopeId);
        assertExecutionEvidence(database, executionId);
        const receipt = appendWithinTraceStoreTransaction(database, request);
        insertRegistration(database, scopeId, null, receipt.record_ids[0] as RecordId);
        database.exec(STORE_TRANSACTION_SQL.commit);
        return receipt;
    } catch (error) {
        database.exec(STORE_TRANSACTION_SQL.rollback);
        throw error;
    }
}

/** Exact inputs admitting one child registration under its parent's fence. @internal */
export type ChildScopeRegistrationRequest = {
    /** Durable execution association, or null. */
    readonly executionId: string | null;
    /** Unix time used for deterministic fence evaluation. */
    readonly nowMilliseconds: number;
    /** Deterministic origin-cut identity published through the parent head. */
    readonly originCutId: string;
    /** Exact parent head expected by the caller. */
    readonly parentExpectedHeadRecordId: RecordId;
    /** Exact live parent writer authority. */
    readonly parentFence: ScopeWriterFence;
    /** Owning parent scope identity. */
    readonly parentScopeId: string;
    /** Canonical parent control and child registration append request. */
    readonly request: StoreAppendRequest;
    /** Child scope identity and owner path. */
    readonly scopeId: string;
};

/** Atomically registers or identically replays one child scope under its parent's fence. @internal */
export function registerChildScopeInStore(
    database: DatabaseSync,
    registration: ChildScopeRegistrationRequest,
): { readonly cut: Cut; readonly receipt: AppendReceipt } {
    const {
        executionId,
        nowMilliseconds,
        originCutId,
        parentExpectedHeadRecordId,
        parentFence,
        parentScopeId,
        request,
        scopeId,
    } = registration;
    assertNonEmptyString(scopeId, "scopeId");
    assertNonEmptyString(parentScopeId, "parentScopeId");
    assertRecordId(parentExpectedHeadRecordId, "parentExpectedHeadRecordId");
    assertNonEmptyString(originCutId, "originCutId");
    database.exec(STORE_TRANSACTION_SQL.begin);
    try {
        if (hasAppendIntent(database, request.append_intent_id)) {
            const receipt = appendWithinTraceStoreTransaction(database, request);
            const cut = readStoredCut(database, originCutId);
            database.exec(STORE_TRANSACTION_SQL.commit);
            return Object.freeze({ cut, receipt });
        }
        assertOpenRegistration(database, parentScopeId);
        assertCurrentFence(database, parentScopeId, parentFence, nowMilliseconds);
        const head = assertExpectedHead(database, parentScopeId, parentExpectedHeadRecordId);
        assertScopeUnregistered(database, scopeId);
        assertExecutionEvidence(database, executionId);
        const receipt = appendWithinTraceStoreTransaction(database, request);
        const registrationRecordId = receipt.record_ids[1] as RecordId;
        const cut = publishStoredCutWithinTransaction(database, {
            caused_by_record_ids: [registrationRecordId],
            cut_id: originCutId,
            publisher_owner_id: scopeId,
            target_owner_id: parentScopeId,
            through_record_id: head.record_id,
        });
        insertRegistration(database, scopeId, parentScopeId, registrationRecordId);
        database.exec(STORE_TRANSACTION_SQL.commit);
        return Object.freeze({ cut, receipt });
    } catch (error) {
        database.exec(STORE_TRANSACTION_SQL.rollback);
        throw error;
    }
}

/** Atomically admits, renews, or refuses one scope writer claim. @internal */
export function claimScopeWriterInStore(
    database: DatabaseSync,
    scopeId: string,
    claimId: string,
    nowMilliseconds: number,
    leaseMilliseconds: number,
): ScopeWriterClaimRow {
    assertNonEmptyString(scopeId, "scopeId");
    assertNonEmptyString(claimId, "claimId");
    assertNonNegativeMilliseconds(nowMilliseconds, "nowMilliseconds");
    const leaseExpiresAt = nowMilliseconds + leaseMilliseconds;
    if (!Number.isSafeInteger(leaseExpiresAt)) {
        throw new TypeError("scope writer lease expiry exceeds safe integer bounds");
    }
    database.exec(STORE_TRANSACTION_SQL.begin);
    try {
        assertOpenRegistration(database, scopeId);
        const existing = readScopeWriterClaimRow(database, scopeId);
        if (existing === undefined) {
            database
                .prepare(
                    `INSERT INTO ${STORE_TABLES.scopeWriterClaims}(scope_id, claim_id, fencing_token, lease_expires_at, released) VALUES (?, ?, 1, ?, 0)`,
                )
                .run(scopeId, claimId, leaseExpiresAt);
        } else if (
            existing.claim_id === claimId &&
            !existing.released &&
            existing.lease_expires_at > nowMilliseconds
        ) {
            database.exec(STORE_TRANSACTION_SQL.commit);
            return existing;
        } else if (existing.released || existing.lease_expires_at <= nowMilliseconds) {
            const result = database
                .prepare(
                    `UPDATE ${STORE_TABLES.scopeWriterClaims} SET claim_id = ?, fencing_token = fencing_token + 1, lease_expires_at = ?, released = 0 WHERE scope_id = ? AND claim_id = ? AND fencing_token = ?`,
                )
                .run(claimId, leaseExpiresAt, scopeId, existing.claim_id, existing.fencing_token);
            // The row was read under the same immediate write lock, so the guarded update matches.
            /* node:coverage ignore next 3 */
            if (result.changes !== 1) {
                throw new ScopeEvidenceError("scope writer claim changed during admission");
            }
        } else {
            throw new ScopeWriterConflictError(scopeId, existing.claim_id);
        }
        const current = readScopeWriterClaimRow(database, scopeId) as ScopeWriterClaimRow;
        database.exec(STORE_TRANSACTION_SQL.commit);
        return current;
    } catch (error) {
        database.exec(STORE_TRANSACTION_SQL.rollback);
        throw error;
    }
}

/** Atomically releases or identically replays the release of one exact writer claim. @internal */
export function releaseScopeWriterInStore(
    database: DatabaseSync,
    scopeId: string,
    fence: ScopeWriterFence,
): ScopeWriterClaimRow {
    assertNonEmptyString(scopeId, "scopeId");
    database.exec(STORE_TRANSACTION_SQL.begin);
    try {
        const existing = readScopeWriterClaimRow(database, scopeId);
        if (
            existing === undefined ||
            existing.claim_id !== fence.claimId ||
            existing.fencing_token !== fence.fencingToken
        ) {
            throw new ScopeWriterFencedError(scopeId, fence.claimId);
        }
        if (!existing.released) {
            database
                .prepare(
                    `UPDATE ${STORE_TABLES.scopeWriterClaims} SET released = 1, lease_expires_at = 0 WHERE scope_id = ? AND claim_id = ? AND fencing_token = ?`,
                )
                .run(scopeId, fence.claimId, fence.fencingToken);
        }
        const current = readScopeWriterClaimRow(database, scopeId) as ScopeWriterClaimRow;
        database.exec(STORE_TRANSACTION_SQL.commit);
        return current;
    } catch (error) {
        database.exec(STORE_TRANSACTION_SQL.rollback);
        throw error;
    }
}

/** Atomically retains or identically replays one fenced scope-local emission. @internal */
export function emitScopeRecordInStore(
    database: DatabaseSync,
    scopeId: string,
    fence: ScopeWriterFence,
    expectedHeadRecordId: RecordId,
    citedRecordIds: readonly RecordId[],
    nowMilliseconds: number,
    request: StoreAppendRequest,
): AppendReceipt {
    assertNonEmptyString(scopeId, "scopeId");
    assertRecordId(expectedHeadRecordId, "expectedHeadRecordId");
    database.exec(STORE_TRANSACTION_SQL.begin);
    try {
        if (hasAppendIntent(database, request.append_intent_id)) {
            const receipt = appendWithinTraceStoreTransaction(database, request);
            database.exec(STORE_TRANSACTION_SQL.commit);
            return receipt;
        }
        assertOpenRegistration(database, scopeId);
        assertCurrentFence(database, scopeId, fence, nowMilliseconds);
        assertExpectedHead(database, scopeId, expectedHeadRecordId);
        const recordExists = database.prepare(
            `SELECT 1 FROM ${STORE_TABLES.records} WHERE record_id = ?`,
        );
        for (const citedRecordId of citedRecordIds) {
            if (recordExists.get(citedRecordId) === undefined) {
                throw new ScopeEvidenceError(`cited record ${citedRecordId} is not retained`);
            }
        }
        const receipt = appendWithinTraceStoreTransaction(database, request);
        database.exec(STORE_TRANSACTION_SQL.commit);
        return receipt;
    } catch (error) {
        database.exec(STORE_TRANSACTION_SQL.rollback);
        throw error;
    }
}

function hasAppendIntent(database: DatabaseSync, appendIntentId: string): boolean {
    return (
        database
            .prepare(`SELECT 1 FROM ${STORE_TABLES.appendIntents} WHERE append_intent_id = ?`)
            .get(appendIntentId) !== undefined
    );
}

function assertScopeUnregistered(database: DatabaseSync, scopeId: string): void {
    if (readScopeHead(database, scopeId) !== undefined) {
        throw new ScopeEvidenceError(`owner path ${scopeId} already retains records`);
    }
}

function assertOpenRegistration(database: DatabaseSync, scopeId: string): ScopeRegistrationRow {
    const row = readScopeRegistrationRow(database, scopeId);
    if (row === undefined) {
        throw new ScopeEvidenceError(
            `scope ${scopeId} is not registered for mutation in this store`,
        );
    }
    if (row.state !== OPEN_STATE) {
        throw new ScopeEvidenceError(`scope ${scopeId} is not open`);
    }
    return row;
}

function assertCurrentFence(
    database: DatabaseSync,
    scopeId: string,
    fence: ScopeWriterFence,
    nowMilliseconds: number,
): void {
    assertNonNegativeMilliseconds(nowMilliseconds, "nowMilliseconds");
    const claim = readScopeWriterClaimRow(database, scopeId);
    if (
        claim === undefined ||
        claim.claim_id !== fence.claimId ||
        claim.fencing_token !== fence.fencingToken ||
        claim.released ||
        claim.lease_expires_at <= nowMilliseconds
    ) {
        throw new ScopeWriterFencedError(scopeId, fence.claimId);
    }
}

function assertExpectedHead(
    database: DatabaseSync,
    scopeId: string,
    expectedHeadRecordId: RecordId,
): ScopeHeadAddress {
    const head = readScopeHead(database, scopeId);
    if (head === undefined || head.record_id !== expectedHeadRecordId) {
        throw new ScopeHeadConflictError(scopeId);
    }
    return head;
}

function assertExecutionEvidence(database: DatabaseSync, executionId: string | null): void {
    if (executionId === null) {
        return;
    }
    const creation = database
        .prepare(
            `SELECT 1 FROM ${STORE_TABLES.recordViews} AS view INNER JOIN ${STORE_TABLES.records} AS record ON record.record_id = view.record_id WHERE view.owner_id = ? AND record.schema_ref = ? LIMIT 1`,
        )
        .get(executionId, projectionProtocolConfig.executionHistory.executionSchemas.created);
    if (creation === undefined) {
        throw new ScopeEvidenceError(
            `execution ${executionId} has no retained creation evidence in this store`,
        );
    }
}

function insertRegistration(
    database: DatabaseSync,
    scopeId: string,
    parentScopeId: string | null,
    registrationRecordId: RecordId,
): void {
    database
        .prepare(
            `INSERT INTO ${STORE_TABLES.scopeRegistrations}(scope_id, parent_scope_id, registration_record_id, state) VALUES (?, ?, ?, ?)`,
        )
        .run(scopeId, parentScopeId, registrationRecordId, OPEN_STATE);
}
