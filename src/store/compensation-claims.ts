import type { DatabaseSync } from "node:sqlite";
import {
    EffectCompensationConflictError,
    EffectCompensationEvidenceError,
} from "../effect/compensation-errors.ts";
import { readCompensationRecordBody } from "../effect/compensation-records.ts";
import { readReconciliationRecord, reconciliationOwner } from "../effect/reconciliation-records.ts";
import { effectProtocolConfig } from "../protocol/config.ts";
import {
    EFFECT_COMPENSATION_PHASES,
    EFFECT_RECONCILIATION_DISPOSITIONS,
} from "../protocol/values.generated.ts";
import type { RecordId } from "../record/types.ts";
import { runInSQLiteTransaction } from "../runtime/sqlite-transaction.ts";
import { appendWithinTraceStoreTransaction } from "./append.ts";
import type { ApplicationRecordAppend } from "./application-records.ts";
import { STORE_TABLES, STORE_TRANSACTION_SQL } from "./constants.ts";
import { assertNonNegativeMilliseconds } from "./durable-execution-claims.ts";
import { readOwnerRecordAtOrdinal } from "./read.ts";
import { hasAppendIntent, readScopeHead } from "./scope-registrations.ts";
import type { AppendReceipt, StoreAppendRequest } from "./types.ts";

const [INTENT_PHASE, ATTEMPT_PHASE, OUTCOME_PHASE] = EFFECT_COMPENSATION_PHASES;

/** Exact ownership required to renew or settle one compensation invocation. @internal */
export type CompensationFence = {
    /** Unique process-local invocation identity. */
    readonly claimId: string;
    /** Monotonic canonical attempt number. */
    readonly fencingToken: number;
};

/** Durable operational lease, deliberately separate from exportable semantic records. @internal */
export type CompensationClaim = {
    /** Exact compensation owner. */
    readonly compensation_id: string;
    /** Canonical invocation-attempt record. */
    readonly attempt_record_id: RecordId;
    /** Invocation holder. */
    readonly claim_id: string;
    /** Monotonic attempt number. */
    readonly fencing_token: number;
    /** Expiry in Unix milliseconds. */
    readonly lease_expires_at: number;
    /** Whether callback completion or failure released this lease. */
    readonly released: boolean;
};

/** Reads and validates one ownership row against its immutable attempt. @internal */
export function readCompensationClaim(
    database: DatabaseSync,
    compensationId: string,
): CompensationClaim | undefined {
    const row = database
        .prepare(`SELECT * FROM ${STORE_TABLES.compensationClaims} WHERE compensation_id = ?`)
        .get(compensationId);
    if (row === undefined) return undefined;
    const record = database
        .prepare(
            `SELECT record.body_json FROM ${STORE_TABLES.recordViews} AS view INNER JOIN ${STORE_TABLES.records} AS record ON record.record_id = view.record_id WHERE view.owner_id = ? AND view.record_id = ? AND record.schema_ref = ?`,
        )
        .get(
            compensationId,
            String(row.attempt_record_id),
            effectProtocolConfig.compensation.traceSchema,
        );
    const body =
        record === undefined
            ? null
            : readCompensationRecordBody(JSON.parse(String(record.body_json)), compensationId);
    if (
        body === null ||
        body.phase !== ATTEMPT_PHASE ||
        body.compensation_id !== compensationId ||
        body.attempt !== row.fencing_token ||
        typeof row.claim_id !== "string" ||
        row.claim_id.length === 0 ||
        !Number.isSafeInteger(row.lease_expires_at) ||
        Number(row.lease_expires_at) < 0 ||
        ![0, 1].includes(Number(row.released))
    ) {
        throw new EffectCompensationEvidenceError(
            "compensation ownership disagrees with retained attempt",
        );
    }
    // Operator guards are separate facts; the latest invocation fact still owns this row.
    const latest = database
        .prepare(
            `SELECT record.record_id, record.body_json FROM ${STORE_TABLES.recordViews} AS view INNER JOIN ${STORE_TABLES.records} AS record ON record.record_id = view.record_id WHERE view.owner_id = ? AND record.schema_ref = ? ORDER BY view.owner_ordinal DESC LIMIT 1`,
        )
        .get(compensationId, effectProtocolConfig.compensation.traceSchema) as {
        record_id: string;
        body_json: string;
    };
    if (latest.record_id !== row.attempt_record_id) {
        const last = readCompensationRecordBody(JSON.parse(latest.body_json), compensationId);
        if (
            last.phase !== OUTCOME_PHASE ||
            last.attempt !== row.fencing_token ||
            row.released !== 1
        ) {
            throw new EffectCompensationEvidenceError(
                "compensation ownership differs from the latest outcome",
            );
        }
    }
    if (
        readScopeHead(database, compensationId)?.record_id !== latest.record_id &&
        row.released !== 1
    )
        throw new EffectCompensationEvidenceError(
            "reconciliation did not release compensation ownership",
        );
    return Object.freeze({
        compensation_id: compensationId,
        attempt_record_id: String(row.attempt_record_id),
        claim_id: row.claim_id,
        fencing_token: Number(row.fencing_token),
        lease_expires_at: Number(row.lease_expires_at),
        released: row.released === 1,
    });
}

/** Atomically appends an attempt and admits its sole unexpired owner. @internal */
export function claimCompensationAttempt(
    database: DatabaseSync,
    compensationId: string,
    expectedHead: RecordId,
    fence: CompensationFence,
    now: number,
    request: StoreAppendRequest,
    expectedReconciliationHead: RecordId | null = null,
): AppendReceipt {
    const expiry = leaseExpiry(now);
    return runInSQLiteTransaction(database, STORE_TRANSACTION_SQL, () => {
        const previous = readCompensationClaim(database, compensationId);
        if (
            (previous !== undefined && !previous.released && previous.lease_expires_at > now) ||
            readScopeHead(database, compensationId)?.record_id !== expectedHead ||
            (previous !== undefined && fence.fencingToken <= previous.fencing_token)
        )
            throw new EffectCompensationConflictError(compensationId);
        const first = database
            .prepare(
                `SELECT record.body_json FROM ${STORE_TABLES.recordViews} AS view INNER JOIN ${STORE_TABLES.records} AS record ON record.record_id = view.record_id WHERE view.owner_id = ? AND record.schema_ref = ? ORDER BY view.owner_ordinal LIMIT 1`,
            )
            .get(compensationId, effectProtocolConfig.compensation.traceSchema);
        if (first === undefined)
            throw new EffectCompensationEvidenceError("compensation lacks its initial intent");
        const intent = readCompensationRecordBody(
            JSON.parse(String(first.body_json)),
            compensationId,
        );
        if (intent.phase !== INTENT_PHASE)
            throw new EffectCompensationEvidenceError("compensation lacks its initial intent");
        const auditOwner = reconciliationOwner(intent.materialization.record_id);
        const auditHead = readScopeHead(database, auditOwner);
        if (
            (auditHead?.record_id ?? null) !== expectedReconciliationHead ||
            (auditHead !== undefined &&
                readReconciliationRecord(
                    readOwnerRecordAtOrdinal(database, auditOwner, auditHead.owner_ordinal).body,
                ).disposition !== EFFECT_RECONCILIATION_DISPOSITIONS[0])
        )
            throw new EffectCompensationConflictError(compensationId);
        const body = request.batch.groups[0]?.records[0]?.body;
        if (
            request.batch.groups.length !== 1 ||
            request.batch.groups[0]?.owner_id !== compensationId ||
            request.batch.groups[0]?.records.length !== 1 ||
            body?.phase !== ATTEMPT_PHASE ||
            body?.attempt !== fence.fencingToken ||
            fence.claimId.length === 0
        )
            throw new TypeError("compensation claim must name its exact attempt");
        const receipt = appendWithinTraceStoreTransaction(database, request);
        database
            .prepare(
                `INSERT INTO ${STORE_TABLES.compensationClaims}(compensation_id, attempt_record_id, claim_id, fencing_token, lease_expires_at, released) VALUES (?, ?, ?, ?, ?, 0) ON CONFLICT(compensation_id) DO UPDATE SET attempt_record_id = excluded.attempt_record_id, claim_id = excluded.claim_id, fencing_token = excluded.fencing_token, lease_expires_at = excluded.lease_expires_at, released = 0`,
            )
            .run(
                compensationId,
                receipt.record_ids[0] as string,
                fence.claimId,
                fence.fencingToken,
                expiry,
            );
        return receipt;
    });
}

/** Renews only a live exact holder; expired holders cannot revive themselves. @internal */
export function renewCompensationClaim(
    database: DatabaseSync,
    compensationId: string,
    fence: CompensationFence,
    now: number,
): void {
    const expiry = leaseExpiry(now);
    runInSQLiteTransaction(database, STORE_TRANSACTION_SQL, () => {
        assertCurrent(database, compensationId, fence, now);
        database
            .prepare(
                `UPDATE ${STORE_TABLES.compensationClaims} SET lease_expires_at = ? WHERE compensation_id = ?`,
            )
            .run(expiry, compensationId);
    });
}

/** Commits the handler outcome and releases its exact lease in the same transaction. @internal */
export function appendCompensationOutcome(
    database: DatabaseSync,
    compensationId: string,
    fence: CompensationFence,
    now: number,
    request: StoreAppendRequest,
): AppendReceipt {
    assertNonNegativeMilliseconds(now, "clock");
    return runInSQLiteTransaction(database, STORE_TRANSACTION_SQL, () => {
        assertCurrent(database, compensationId, fence, now);
        const body = request.batch.groups[0]?.records[0]?.body;
        if (
            request.batch.groups.length !== 1 ||
            request.batch.groups[0]?.owner_id !== compensationId ||
            request.batch.groups[0]?.records.length !== 1 ||
            body?.phase !== OUTCOME_PHASE ||
            body?.attempt !== fence.fencingToken
        )
            throw new TypeError("compensation outcome must name its exact attempt");
        const receipt = appendWithinTraceStoreTransaction(database, request);
        database
            .prepare(
                `UPDATE ${STORE_TABLES.compensationClaims} SET released = 1 WHERE compensation_id = ?`,
            )
            .run(compensationId);
        return receipt;
    });
}

/** Releases a callback that ended without an outcome; never releases a replacement owner. @internal */
export function releaseCompensationClaim(
    database: DatabaseSync,
    compensationId: string,
    fence: CompensationFence,
): void {
    database
        .prepare(
            `UPDATE ${STORE_TABLES.compensationClaims} SET released = 1 WHERE compensation_id = ? AND claim_id = ? AND fencing_token = ?`,
        )
        .run(compensationId, fence.claimId, fence.fencingToken);
}

function assertCurrent(
    database: DatabaseSync,
    compensationId: string,
    fence: CompensationFence,
    now: number,
): CompensationClaim {
    const claim = readCompensationClaim(database, compensationId);
    if (
        claim === undefined ||
        claim.released ||
        claim.claim_id !== fence.claimId ||
        claim.fencing_token !== fence.fencingToken ||
        claim.lease_expires_at <= now
    )
        throw new EffectCompensationConflictError(compensationId);
    return claim;
}

function leaseExpiry(now: number): number {
    assertNonNegativeMilliseconds(now, "clock");
    const expiry = now + effectProtocolConfig.compensation.ownership.leaseMilliseconds;
    if (!Number.isSafeInteger(expiry))
        throw new TypeError("compensation lease expiry exceeds safe integer bounds");
    return expiry;
}

/** Retains initial or historical unclaimed evidence, refusing any invocation-owned path. @internal */
export function appendUnclaimedCompensationRecord(
    database: DatabaseSync,
    compensationId: string,
    expectedHead: RecordId | null,
    request: StoreAppendRequest,
): ApplicationRecordAppend {
    return runInSQLiteTransaction(database, STORE_TRANSACTION_SQL, () => {
        if (readCompensationClaim(database, compensationId) !== undefined)
            throw new EffectCompensationConflictError(compensationId);
        const replayed = hasAppendIntent(database, request.append_intent_id);
        if (
            !replayed &&
            (readScopeHead(database, compensationId)?.record_id ?? null) !== expectedHead
        )
            return Object.freeze({ status: "head_moved" });
        const receipt = appendWithinTraceStoreTransaction(database, request);
        return Object.freeze({ cut: null, receipt, status: replayed ? "replayed" : "appended" });
    });
}
