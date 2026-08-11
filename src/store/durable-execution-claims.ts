import type { DatabaseSync } from "node:sqlite";
import { createRecordId, type SemanticRecord } from "../canonical/canonical-record.ts";
import { projectionProtocolConfig, runProtocolConfig } from "../protocol/config.ts";
import {
    DURABLE_EXECUTION_CLAIMED_APPEND_STATUSES,
    DURABLE_EXECUTION_INVOCATION_CLAIM_STATUSES,
    RECORD_MODES,
} from "../protocol/values.generated.ts";
import { assertNonEmptyString, assertRecordId } from "../record/guards.ts";
import { ROOT_WITNESS_ID } from "../record/root-witness.ts";
import type { RecordId } from "../record/types.ts";
import { appendWithinTraceStoreTransaction } from "./append.ts";
import { STORE_TABLES, STORE_TRANSACTION_SQL } from "./constants.ts";
import type {
    DurableExecutionClaimedAppend,
    DurableExecutionInvocationClaim,
    StoreAppendRequest,
} from "./types.ts";

const [ACQUIRED_CLAIM_STATUS, LOST_CLAIM_STATUS] = DURABLE_EXECUTION_INVOCATION_CLAIM_STATUSES;
const [COMMITTED_APPEND_STATUS, FENCED_APPEND_STATUS] = DURABLE_EXECUTION_CLAIMED_APPEND_STATUSES;
const [CAPTURE_MODE] = RECORD_MODES;

type DurableExecutionClaimRow = {
    readonly claim_id: string;
    readonly fencing_token: number;
    readonly lease_expires_at: number;
    readonly started: number;
};

/** Atomically admits at most one claim identity for one durable run. */
export function claimDurableExecutionInvocation(
    database: DatabaseSync,
    runId: string,
    createdRecordId: RecordId,
    claimId: string,
    nowMilliseconds: number,
    leaseDurationMilliseconds: number,
    allowExpiredTakeover: boolean,
): DurableExecutionInvocationClaim {
    assertNonEmptyString(runId, "runId");
    assertRecordId(createdRecordId, "createdRecordId");
    assertNonEmptyString(claimId, "claimId");
    assertNonNegativeMilliseconds(nowMilliseconds, "nowMilliseconds");
    if (typeof allowExpiredTakeover !== "boolean") {
        throw new TypeError("allowExpiredTakeover must be a boolean");
    }
    const leaseExpiresAt = nowMilliseconds + leaseDurationMilliseconds;
    if (!Number.isSafeInteger(leaseExpiresAt)) {
        throw new TypeError("durable execution claim lease expiry exceeds safe integer bounds");
    }
    database.exec(STORE_TRANSACTION_SQL.begin);
    try {
        const creation = database
            .prepare(
                `SELECT 1 FROM ${STORE_TABLES.recordViews} AS view INNER JOIN ${STORE_TABLES.records} AS record ON record.record_id = view.record_id WHERE view.owner_id = ? AND view.record_id = ? AND record.schema_ref = ?`,
            )
            .get(
                runId,
                createdRecordId,
                projectionProtocolConfig.executionHistory.executionSchemas.created,
            );
        if (creation === undefined) {
            throw new TypeError(
                "durable execution claim requires creation evidence owned by the run",
            );
        }
        database
            .prepare(
                `INSERT INTO ${STORE_TABLES.durableExecutionClaims}(run_id, claim_id, created_record_id, lease_expires_at, fencing_token) VALUES (?, ?, ?, ?, 1) ON CONFLICT(run_id) DO NOTHING`,
            )
            .run(runId, claimId, createdRecordId, leaseExpiresAt);
        const row = database
            .prepare(
                `SELECT claim_id, created_record_id, fencing_token, lease_expires_at, started FROM ${STORE_TABLES.durableExecutionClaims} WHERE run_id = ?`,
            )
            .get(runId) as DurableExecutionClaimRow & { readonly created_record_id: string };
        if (row.created_record_id !== createdRecordId)
            throw new TypeError("durable execution claim disagrees with creation evidence");
        if (allowExpiredTakeover && row.started === 0 && row.lease_expires_at <= nowMilliseconds) {
            database
                .prepare(
                    `UPDATE ${STORE_TABLES.durableExecutionClaims} SET claim_id = ?, lease_expires_at = ?, fencing_token = fencing_token + 1 WHERE run_id = ? AND claim_id = ? AND lease_expires_at <= ?`,
                )
                .run(claimId, leaseExpiresAt, runId, row.claim_id, nowMilliseconds);
        }
        const current = database
            .prepare(
                `SELECT claim_id, fencing_token, lease_expires_at, started FROM ${STORE_TABLES.durableExecutionClaims} WHERE run_id = ?`,
            )
            .get(runId) as DurableExecutionClaimRow;
        database.exec(STORE_TRANSACTION_SQL.commit);
        const acquired =
            current.claim_id === claimId &&
            current.lease_expires_at > nowMilliseconds &&
            current.started === 0;
        return Object.freeze({
            claim_id: current.claim_id,
            created_record_id: createdRecordId,
            fencing_token: current.fencing_token,
            lease_expires_at: current.lease_expires_at,
            run_id: runId,
            status: acquired ? ACQUIRED_CLAIM_STATUS : LOST_CLAIM_STATUS,
        });
    } catch (error) {
        database.exec(STORE_TRANSACTION_SQL.rollback);
        throw error;
    }
}

/** Publishes canonical start evidence while the exact unexpired claim remains current. */
export function appendDurableExecutionStart(
    database: DatabaseSync,
    runId: string,
    claimId: string,
    fencingToken: number,
    nowMilliseconds: number,
    recoveryCommandRecordId: RecordId | null,
): DurableExecutionClaimedAppend {
    assertNonEmptyString(runId, "runId");
    assertNonEmptyString(claimId, "claimId");
    if (!Number.isSafeInteger(fencingToken) || fencingToken <= 0) {
        throw new TypeError("fencingToken must be a positive safe integer");
    }
    assertNonNegativeMilliseconds(nowMilliseconds, "nowMilliseconds");
    database.exec(STORE_TRANSACTION_SQL.begin);
    try {
        const row = database
            .prepare(
                `SELECT claim_id, created_record_id, fencing_token, lease_expires_at, started FROM ${STORE_TABLES.durableExecutionClaims} WHERE run_id = ?`,
            )
            .get(runId) as
            | (DurableExecutionClaimRow & { readonly created_record_id: RecordId })
            | undefined;
        if (
            row === undefined ||
            row.claim_id !== claimId ||
            row.fencing_token !== fencingToken ||
            row.lease_expires_at <= nowMilliseconds ||
            row.started !== 0
        ) {
            database.exec(STORE_TRANSACTION_SQL.commit);
            return Object.freeze({ status: FENCED_APPEND_STATUS });
        }
        if (recoveryCommandRecordId !== null) {
            assertRecordId(recoveryCommandRecordId, "recoveryCommandRecordId");
            const command = database
                .prepare(
                    `SELECT 1 FROM ${STORE_TABLES.recordViews} AS view INNER JOIN ${STORE_TABLES.records} AS record ON record.record_id = view.record_id WHERE view.owner_id = ? AND view.record_id = ? AND record.schema_ref = ?`,
                )
                .get(
                    runId,
                    recoveryCommandRecordId,
                    runProtocolConfig.execution.controlCommandSchemaId,
                );
            if (command === undefined) {
                throw new TypeError(
                    "durable execution start requires recovery command evidence owned by the run",
                );
            }
        }
        const startedSchema = projectionProtocolConfig.executionHistory.executionSchemas.started;
        const receipt = appendWithinTraceStoreTransaction(database, {
            append_intent_id: createRecordId({
                append_intent: { run_id: runId, schema_ref: startedSchema },
            }),
            batch: {
                groups: [
                    {
                        caused_by_record_ids: [
                            row.created_record_id,
                            ...(recoveryCommandRecordId === null ? [] : [recoveryCommandRecordId]),
                        ],
                        owner_id: runId,
                        records: [
                            {
                                body: { payload: { execution_id: runId } } as SemanticRecord,
                                mode: CAPTURE_MODE,
                                schema_ref: startedSchema,
                                witness_ref: ROOT_WITNESS_ID,
                            },
                        ],
                    },
                ],
            },
        });
        database
            .prepare(
                `UPDATE ${STORE_TABLES.durableExecutionClaims} SET started = 1 WHERE run_id = ? AND claim_id = ? AND fencing_token = ?`,
            )
            .run(runId, claimId, fencingToken);
        database.exec(STORE_TRANSACTION_SQL.commit);
        return Object.freeze({ receipt, status: COMMITTED_APPEND_STATUS });
    } catch (error) {
        database.exec(STORE_TRANSACTION_SQL.rollback);
        throw error;
    }
}

/**
 * Publishes terminal execution evidence only while the exact started claim remains authoritative.
 *
 * @param database - Open trace-store database inside no caller-owned transaction.
 * @param runId - Durable run whose terminal evidence is being published.
 * @param claimId - Exact current invocation claim identity.
 * @param fencingToken - Exact current monotonic fencing token.
 * @param request - Canonical terminal-ledger append request.
 * @param releaseClaim - Whether the same transaction must fence and release the worker.
 * @returns A committed receipt or a frozen fenced result.
 * @throws {TypeError} If identifiers, token, or request are malformed.
 * @internal
 */
export function appendDurableExecutionTerminal(
    database: DatabaseSync,
    runId: string,
    claimId: string,
    fencingToken: number,
    request: StoreAppendRequest,
    releaseClaim = false,
): DurableExecutionClaimedAppend {
    assertNonEmptyString(runId, "runId");
    assertNonEmptyString(claimId, "claimId");
    if (!Number.isSafeInteger(fencingToken) || fencingToken <= 0) {
        throw new TypeError("fencingToken must be a positive safe integer");
    }
    database.exec(STORE_TRANSACTION_SQL.begin);
    try {
        const row = database
            .prepare(
                `SELECT claim_id, fencing_token, started FROM ${STORE_TABLES.durableExecutionClaims} WHERE run_id = ?`,
            )
            .get(runId) as
            | Pick<DurableExecutionClaimRow, "claim_id" | "fencing_token" | "started">
            | undefined;
        if (
            row === undefined ||
            row.claim_id !== claimId ||
            row.fencing_token !== fencingToken ||
            row.started !== 1
        ) {
            database.exec(STORE_TRANSACTION_SQL.commit);
            return Object.freeze({ status: FENCED_APPEND_STATUS });
        }
        const receipt = appendWithinTraceStoreTransaction(database, request);
        if (releaseClaim) {
            database
                .prepare(
                    `UPDATE ${STORE_TABLES.durableExecutionClaims} SET lease_expires_at = 0, started = 0 WHERE run_id = ? AND claim_id = ? AND fencing_token = ?`,
                )
                .run(runId, claimId, fencingToken);
        }
        database.exec(STORE_TRANSACTION_SQL.commit);
        return Object.freeze({ receipt, status: COMMITTED_APPEND_STATUS });
    } catch (error) {
        database.exec(STORE_TRANSACTION_SQL.rollback);
        throw error;
    }
}

function assertNonNegativeMilliseconds(value: number, subject: string): void {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new TypeError(`${subject} must be a non-negative safe integer`);
    }
}
