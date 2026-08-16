import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import { canonicalizeRecord, type SemanticRecord } from "../canonical/canonical-record.ts";
import { workspaceProtocolConfig } from "../protocol/config.ts";
import {
    RETAINED_WORLD_SETTLEMENT_ACTIONS,
    RETAINED_WORLD_SETTLEMENT_STATES,
} from "../protocol/values.generated.ts";
import { assertNonEmptyString } from "../record/guards.ts";
import { STORE_TABLES, STORE_TRANSACTION_SQL } from "./constants.ts";
import {
    RetainedWorldSettlementConflictError,
    RetainedWorldSettlementInvalidError,
} from "./errors.ts";
import {
    decodeRetainedWorldSettlementOperation,
    decodeRetainedWorldSettlementTerminalReceipt,
    encodeRetainedWorldSettlementOperation,
    encodeRetainedWorldSettlementTerminalReceipt,
    type RetainedWorldSettlementTerminalEvidence,
} from "./retained-world-settlement-codec.ts";
import type {
    RetainedWorldSettlementAdmission,
    RetainedWorldSettlementJournal,
    RetainedWorldSettlementRequest,
} from "./types.ts";

type SettlementRow = {
    readonly action: string;
    readonly cleanup_completed: number | null;
    readonly command_id: string;
    readonly operation_digest: string | null;
    readonly operation_id: string | null;
    readonly operation_json: string | null;
    readonly output_id: string;
    readonly receipt_digest: string | null;
    readonly receipt_json: string | null;
    readonly request_digest: string;
    readonly request_id: string;
    readonly request_json: string;
    readonly state: string;
};

const [PREPARED_STATE, APPLYING_STATE, SELECTED_STATE, DISCARDED_STATE] =
    RETAINED_WORLD_SETTLEMENT_STATES;
const ROW_COLUMNS = `output_id, command_id, request_id, request_digest, request_json, action, state,
                     operation_id, operation_digest, operation_json,
                     receipt_digest, receipt_json, cleanup_completed`;

/** Atomically admits or identically replays one exact retained-world settlement request. */
export function admitRetainedWorldSettlement(
    database: DatabaseSync,
    request: RetainedWorldSettlementRequest,
): RetainedWorldSettlementAdmission {
    const retainedRequest = readRetainedWorldSettlementRequest(request);
    const requestJson = canonicalizeRecord(retainedRequest as unknown as SemanticRecord);
    const requestDigest = createHash(workspaceProtocolConfig.digestAlgorithm)
        .update(requestJson)
        .digest("hex");
    const requestId = `${workspaceProtocolConfig.settlement.requestIdPrefix}${requestDigest}`;
    database.exec(STORE_TRANSACTION_SQL.begin);
    try {
        const rows = database
            .prepare(
                `SELECT ${ROW_COLUMNS}
                 FROM ${STORE_TABLES.retainedWorldSettlements}
                 WHERE output_id = ? OR command_id = ?`,
            )
            .all(
                retainedRequest.output_id,
                retainedRequest.command_id,
            ) as unknown as SettlementRow[];
        if (rows.length > 0) {
            const row = rows[0] as SettlementRow;
            if (
                rows.length !== 1 ||
                !rowMatchesRequest(row, requestId, requestDigest, requestJson)
            ) {
                throw new RetainedWorldSettlementConflictError(
                    workspaceProtocolConfig.settlement.errors.conflictMessage,
                );
            }
            const replay = journalFromRow(row, retainedRequest).admission;
            database.exec(STORE_TRANSACTION_SQL.commit);
            return replay;
        }
        database
            .prepare(
                `INSERT INTO ${STORE_TABLES.retainedWorldSettlements}(
                    output_id, command_id, request_id, request_digest, request_json, action, state
                 ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
                retainedRequest.output_id,
                retainedRequest.command_id,
                requestId,
                requestDigest,
                requestJson,
                retainedRequest.action,
                PREPARED_STATE,
            );
        const admission = freezeAdmission(retainedRequest, requestId);
        database.exec(STORE_TRANSACTION_SQL.commit);
        return admission;
    } catch (error) {
        database.exec(STORE_TRANSACTION_SQL.rollback);
        throw error;
    }
}

/** Reads one exact retained-world settlement admission by output identity. */
export function readRetainedWorldSettlement(
    database: DatabaseSync,
    outputId: string,
): RetainedWorldSettlementAdmission | undefined {
    assertNonEmptyString(outputId, "outputId");
    const row = readRow(database, outputId);
    if (row === undefined) return undefined;
    return journalFromStoredRow(row).admission;
}

/** Reads and validates one complete settlement-journal snapshot. @internal */
export function readRetainedWorldSettlementJournal(
    database: DatabaseSync,
    outputId: string,
): RetainedWorldSettlementJournal | undefined {
    assertNonEmptyString(outputId, "outputId");
    const row = readRow(database, outputId);
    return row === undefined ? undefined : journalFromStoredRow(row);
}

/** Atomically begins or identically replays one deterministic settlement operation. @internal */
export function beginRetainedWorldSettlement(
    database: DatabaseSync,
    outputId: string,
): RetainedWorldSettlementJournal {
    assertNonEmptyString(outputId, "outputId");
    database.exec(STORE_TRANSACTION_SQL.begin);
    try {
        const row = requiredRow(database, outputId);
        const current = journalFromStoredRow(row);
        if (current.state !== PREPARED_STATE) {
            database.exec(STORE_TRANSACTION_SQL.commit);
            return current;
        }
        const operation = encodeRetainedWorldSettlementOperation(current.admission);
        const result = database
            .prepare(
                `UPDATE ${STORE_TABLES.retainedWorldSettlements}
                 SET state = ?, operation_id = ?, operation_digest = ?, operation_json = ?
                 WHERE output_id = ? AND state = ?
                   AND operation_id IS NULL AND operation_digest IS NULL AND operation_json IS NULL
                   AND receipt_digest IS NULL AND receipt_json IS NULL AND cleanup_completed IS NULL`,
            )
            .run(
                APPLYING_STATE,
                operation.id,
                operation.digest,
                operation.json,
                outputId,
                PREPARED_STATE,
            );
        // BEGIN IMMEDIATE plus the validated snapshot makes a zero-row update unreachable unless
        // SQLite violates the transaction boundary.
        /* node:coverage ignore next 1 */
        if (result.changes !== 1) throw invalidSettlement();
        const journal = journalFromStoredRow(requiredRow(database, outputId));
        database.exec(STORE_TRANSACTION_SQL.commit);
        return journal;
    } catch (error) {
        database.exec(STORE_TRANSACTION_SQL.rollback);
        throw error;
    }
}

/** Atomically retains or identically replays one action-specific terminal receipt. @internal */
export function retainRetainedWorldSettlementTerminal(
    database: DatabaseSync,
    outputId: string,
    evidence: RetainedWorldSettlementTerminalEvidence,
): RetainedWorldSettlementJournal {
    assertNonEmptyString(outputId, "outputId");
    if (evidence.action === RETAINED_WORLD_SETTLEMENT_ACTIONS[1] && evidence.cleanup_completed) {
        throw new TypeError("discard cleanup cannot precede its durable terminal decision");
    }
    database.exec(STORE_TRANSACTION_SQL.begin);
    try {
        const current = journalFromStoredRow(requiredRow(database, outputId));
        if (current.state === PREPARED_STATE) {
            throw new RetainedWorldSettlementConflictError(
                workspaceProtocolConfig.settlement.errors.conflictMessage,
            );
        }
        const operation = encodeRetainedWorldSettlementOperation(current.admission);
        const receipt = encodeRetainedWorldSettlementTerminalReceipt(operation, evidence);
        if (current.state === SELECTED_STATE || current.state === DISCARDED_STATE) {
            if (
                current.state === DISCARDED_STATE &&
                current.cleanup_completed === true &&
                evidence.action === RETAINED_WORLD_SETTLEMENT_ACTIONS[1]
            ) {
                database.exec(STORE_TRANSACTION_SQL.commit);
                return current;
            }
            if (
                current.receipt?.digest !== receipt.digest ||
                current.receipt.json !== receipt.json
            ) {
                throw new RetainedWorldSettlementConflictError(
                    workspaceProtocolConfig.settlement.errors.conflictMessage,
                );
            }
            database.exec(STORE_TRANSACTION_SQL.commit);
            return current;
        }
        // The closed journal validator and preceding prepared/terminal branches are exhaustive.
        /* node:coverage ignore next 1 */
        if (current.state !== APPLYING_STATE) throw invalidSettlement();
        const result = database
            .prepare(
                `UPDATE ${STORE_TABLES.retainedWorldSettlements}
                 SET state = ?, receipt_digest = ?, receipt_json = ?, cleanup_completed = ?
                 WHERE output_id = ? AND state = ?
                   AND operation_id = ? AND operation_digest = ? AND operation_json = ?
                   AND receipt_digest IS NULL AND receipt_json IS NULL AND cleanup_completed IS NULL`,
            )
            .run(
                receipt.value.state,
                receipt.digest,
                receipt.json,
                receipt.value.action === RETAINED_WORLD_SETTLEMENT_ACTIONS[1] ? 0 : null,
                outputId,
                APPLYING_STATE,
                operation.id,
                operation.digest,
                operation.json,
            );
        // BEGIN IMMEDIATE plus the validated snapshot makes a zero-row update unreachable unless
        // SQLite violates the transaction boundary.
        /* node:coverage ignore next 1 */
        if (result.changes !== 1) throw invalidSettlement();
        const journal = journalFromStoredRow(requiredRow(database, outputId));
        database.exec(STORE_TRANSACTION_SQL.commit);
        return journal;
    } catch (error) {
        database.exec(STORE_TRANSACTION_SQL.rollback);
        throw error;
    }
}

/** Atomically marks a discarded settlement's idempotent physical cleanup complete. @internal */
export function completeRetainedWorldSettlementCleanup(
    database: DatabaseSync,
    outputId: string,
): RetainedWorldSettlementJournal {
    assertNonEmptyString(outputId, "outputId");
    database.exec(STORE_TRANSACTION_SQL.begin);
    try {
        const current = journalFromStoredRow(requiredRow(database, outputId));
        if (
            current.state !== DISCARDED_STATE ||
            current.operation === null ||
            current.receipt === null
        ) {
            throw new RetainedWorldSettlementConflictError(
                workspaceProtocolConfig.settlement.errors.conflictMessage,
            );
        }
        if (current.cleanup_completed) {
            database.exec(STORE_TRANSACTION_SQL.commit);
            return current;
        }
        const operation = encodeRetainedWorldSettlementOperation(current.admission);
        const receipt = encodeRetainedWorldSettlementTerminalReceipt(operation, {
            action: RETAINED_WORLD_SETTLEMENT_ACTIONS[1],
            cleanup_completed: true,
            user_basis_after: current.admission.request.user_basis_before,
        });
        const result = database
            .prepare(
                `UPDATE ${STORE_TABLES.retainedWorldSettlements}
                 SET receipt_digest = ?, receipt_json = ?, cleanup_completed = 1
                 WHERE output_id = ? AND state = ? AND operation_id = ?
                   AND receipt_digest = ? AND receipt_json = ? AND cleanup_completed = 0`,
            )
            .run(
                receipt.digest,
                receipt.json,
                outputId,
                DISCARDED_STATE,
                operation.id,
                current.receipt.digest,
                current.receipt.json,
            );
        // BEGIN IMMEDIATE plus the validated snapshot makes a zero-row update unreachable unless
        // SQLite violates the transaction boundary.
        /* node:coverage ignore next 1 */
        if (result.changes !== 1) throw invalidSettlement();
        const journal = journalFromStoredRow(requiredRow(database, outputId));
        database.exec(STORE_TRANSACTION_SQL.commit);
        return journal;
    } catch (error) {
        database.exec(STORE_TRANSACTION_SQL.rollback);
        throw error;
    }
}

/** Validates and freezes one exact retained-world settlement request value. @internal */
export function readRetainedWorldSettlementRequest(value: unknown): RetainedWorldSettlementRequest {
    if (
        value === null ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    ) {
        throw new TypeError("retained world settlement request must be exact data");
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const ownKeys = Reflect.ownKeys(descriptors);
    const expectedKeys = [
        "action",
        "base_revision_id",
        "binding_id",
        "capture_record_id",
        "changeset_id",
        "command_id",
        "custody_id",
        "execution_cut_id",
        "head_revision_id",
        "output_id",
        "run_id",
        "settlement_version",
        "user_basis_before",
    ];
    if (
        ownKeys.some((key) => typeof key !== "string") ||
        ownKeys.length !== expectedKeys.length ||
        (ownKeys as string[]).sort().some((key, index) => key !== expectedKeys[index]) ||
        (ownKeys as string[]).some((key) => !("value" in (descriptors[key] as PropertyDescriptor)))
    ) {
        throw new TypeError("retained world settlement request must be exact data");
    }
    const request = Object.fromEntries(
        expectedKeys.map((key) => [key, (descriptors[key] as PropertyDescriptor).value]),
    ) as Partial<RetainedWorldSettlementRequest>;
    if (request.settlement_version !== workspaceProtocolConfig.settlement.version) {
        throw new TypeError("retained world settlement version is unsupported");
    }
    if (!RETAINED_WORLD_SETTLEMENT_ACTIONS.includes(request.action as never)) {
        throw new TypeError("retained world settlement action is unsupported");
    }
    const fields = [
        "base_revision_id",
        "binding_id",
        "capture_record_id",
        "changeset_id",
        "command_id",
        "custody_id",
        "execution_cut_id",
        "head_revision_id",
        "output_id",
        "run_id",
        "user_basis_before",
    ] as const;
    for (const field of fields) assertNonEmptyString(request[field], field);
    return Object.freeze({
        action: request.action as RetainedWorldSettlementRequest["action"],
        base_revision_id: request.base_revision_id as string,
        binding_id: request.binding_id as string,
        capture_record_id: request.capture_record_id as string,
        changeset_id: request.changeset_id as string,
        command_id: request.command_id as string,
        custody_id: request.custody_id as string,
        execution_cut_id: request.execution_cut_id as string,
        head_revision_id: request.head_revision_id as string,
        output_id: request.output_id as string,
        run_id: request.run_id as string,
        settlement_version: request.settlement_version,
        user_basis_before: request.user_basis_before as string,
    });
}

function admissionFromRow(
    row: SettlementRow,
    request: RetainedWorldSettlementRequest,
): RetainedWorldSettlementAdmission {
    const requestJson = canonicalizeRecord(request as unknown as SemanticRecord);
    const digest = createHash(workspaceProtocolConfig.digestAlgorithm)
        .update(requestJson)
        .digest("hex");
    const expectedRequestId = `${workspaceProtocolConfig.settlement.requestIdPrefix}${digest}`;
    const expectedRow = {
        action: request.action,
        command_id: request.command_id,
        output_id: request.output_id,
        request_digest: digest,
        request_id: expectedRequestId,
        request_json: requestJson,
    };
    const actualRow = {
        action: row.action,
        command_id: row.command_id,
        output_id: row.output_id,
        request_digest: row.request_digest,
        request_id: row.request_id,
        request_json: row.request_json,
    };
    if (canonicalizeRecord(actualRow) !== canonicalizeRecord(expectedRow)) {
        throw invalidSettlement();
    }
    return freezeAdmission(request, expectedRequestId);
}

function readRow(database: DatabaseSync, outputId: string): SettlementRow | undefined {
    return database
        .prepare(
            `SELECT ${ROW_COLUMNS}
             FROM ${STORE_TABLES.retainedWorldSettlements} WHERE output_id = ?`,
        )
        .get(outputId) as SettlementRow | undefined;
}

function requiredRow(database: DatabaseSync, outputId: string): SettlementRow {
    const row = readRow(database, outputId);
    if (row === undefined) throw invalidSettlement();
    return row;
}

function journalFromStoredRow(row: SettlementRow): RetainedWorldSettlementJournal {
    let value: unknown;
    try {
        value = JSON.parse(row.request_json);
    } catch (error) {
        throw invalidSettlement(error);
    }
    try {
        return journalFromRow(row, readRetainedWorldSettlementRequest(value));
    } catch (error) {
        if (error instanceof RetainedWorldSettlementInvalidError) throw error;
        throw invalidSettlement(error);
    }
}

function journalFromRow(
    row: SettlementRow,
    request: RetainedWorldSettlementRequest,
): RetainedWorldSettlementJournal {
    const admission = admissionFromRow(row, request);
    const operationColumns = [row.operation_id, row.operation_digest, row.operation_json];
    const receiptColumns = [row.receipt_digest, row.receipt_json];
    if (row.state === PREPARED_STATE) {
        if (
            operationColumns.some((value) => value !== null) ||
            receiptColumns.some((value) => value !== null) ||
            row.cleanup_completed !== null
        ) {
            throw invalidSettlement();
        }
        return freezeJournal(admission, PREPARED_STATE, null, null, null);
    }
    if (operationColumns.some((value) => typeof value !== "string")) {
        throw invalidSettlement();
    }
    const operation = decodeRetainedWorldSettlementOperation(
        row.operation_json as string,
        admission,
    );
    if (row.operation_id !== operation.id || row.operation_digest !== operation.digest) {
        throw invalidSettlement();
    }
    const retainedOperation = Object.freeze({
        digest: operation.digest,
        id: operation.id,
        json: operation.json,
    });
    if (row.state === APPLYING_STATE) {
        if (receiptColumns.some((value) => value !== null) || row.cleanup_completed !== null) {
            throw invalidSettlement();
        }
        return freezeJournal(admission, APPLYING_STATE, retainedOperation, null, null);
    }
    if (row.state !== SELECTED_STATE && row.state !== DISCARDED_STATE) {
        throw invalidSettlement();
    }
    if (receiptColumns.some((value) => typeof value !== "string")) {
        throw invalidSettlement();
    }
    const receipt = decodeRetainedWorldSettlementTerminalReceipt(
        row.receipt_json as string,
        operation,
    );
    if (
        row.receipt_digest !== receipt.digest ||
        row.state !== receipt.value.state ||
        (receipt.value.action === RETAINED_WORLD_SETTLEMENT_ACTIONS[0]
            ? row.cleanup_completed !== null
            : row.cleanup_completed !== (receipt.value.cleanup_completed ? 1 : 0))
    ) {
        throw invalidSettlement();
    }
    return freezeJournal(
        admission,
        row.state,
        retainedOperation,
        Object.freeze({ digest: receipt.digest, id: null, json: receipt.json }),
        row.cleanup_completed === null ? null : row.cleanup_completed === 1,
    );
}

function freezeJournal(
    admission: RetainedWorldSettlementAdmission,
    state: RetainedWorldSettlementJournal["state"],
    operation: RetainedWorldSettlementJournal["operation"],
    receipt: RetainedWorldSettlementJournal["receipt"],
    cleanupCompleted: boolean | null,
): RetainedWorldSettlementJournal {
    return Object.freeze({
        admission,
        cleanup_completed: cleanupCompleted,
        operation,
        receipt,
        state,
    });
}

function invalidSettlement(cause?: unknown): RetainedWorldSettlementInvalidError {
    return new RetainedWorldSettlementInvalidError(
        workspaceProtocolConfig.settlement.errors.invalidMessage,
        cause === undefined ? undefined : { cause },
    );
}

function rowMatchesRequest(
    row: SettlementRow,
    requestId: string,
    requestDigest: string,
    requestJson: string,
): boolean {
    return (
        canonicalizeRecord({
            request_digest: row.request_digest,
            request_id: row.request_id,
            request_json: row.request_json,
        }) ===
        canonicalizeRecord({
            request_digest: requestDigest,
            request_id: requestId,
            request_json: requestJson,
        })
    );
}

function freezeAdmission(
    request: RetainedWorldSettlementRequest,
    requestId: string,
): RetainedWorldSettlementAdmission {
    return Object.freeze({
        action: request.action,
        command_id: request.command_id,
        output_id: request.output_id,
        request,
        request_id: requestId,
        state: PREPARED_STATE,
    });
}
