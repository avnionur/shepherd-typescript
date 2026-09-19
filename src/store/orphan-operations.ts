import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import { canonicalizeRecord, type SemanticRecord } from "../canonical/canonical-record.ts";
import { orphanRepairProtocolConfig } from "../protocol/config.ts";
import {
    ORPHAN_REPAIR_BLOCKERS,
    ORPHAN_REPAIR_ERROR_CODES,
    ORPHAN_REPAIR_PRE_RUN_STATUSES,
    ORPHAN_REPAIR_SESSION_STATUSES,
} from "../protocol/values.generated.ts";
import { assertRecordId } from "../record/guards.ts";
import { ROOT_WITNESS_ID } from "../record/root-witness.ts";
import type { RecordBody, RecordId } from "../record/types.ts";
import { OrphanRepairError } from "../repair/errors.ts";
import type {
    OperationBookkeepingDefinition,
    OperationSessionDeathEvidence,
    OrphanOperationDiagnosis,
    OrphanOperationDiagnosisOptions,
    OrphanOperationDiagnosisReport,
    OrphanPreRunReclaimResult,
    OrphanRepairCommand,
    OrphanRepairPreparation,
    OrphanRepairReceipt,
} from "../repair/types.ts";
import { rollbackFailedTransaction } from "../runtime/sqlite-transaction.ts";
import { appendToTraceStore, appendWithinTraceStoreTransaction } from "./append.ts";
import { STORE_READ_TRANSACTION_SQL, STORE_TABLES, STORE_TRANSACTION_SQL } from "./constants.ts";
import { AppendIntentConflictError } from "./errors.ts";
import { readStoredRecord } from "./read.ts";

type OrphanOperationRow = {
    readonly death_evidence_id: string | null;
    readonly operation_digest: string;
    readonly operation_id: string;
    readonly operation_json: string;
    readonly owner_id: string;
    readonly session_dead: number;
    readonly session_id: string;
};

type OrphanRepairReceiptEvidence = Omit<OrphanRepairReceipt, "receipt_record_id">;

const CONFIG = orphanRepairProtocolConfig;

/** Retains or idempotently replays exact open-operation bookkeeping. @internal */
export function retainOpenOperation(
    database: DatabaseSync,
    definition: OperationBookkeepingDefinition,
): OperationBookkeepingDefinition {
    const operation = normalizeOperation(definition);
    const operationJson = boundedCanonicalize(operation, "operation bookkeeping");
    const operationDigest = digest(operationJson);
    database.exec(STORE_TRANSACTION_SQL.begin);
    try {
        const count = Number(
            database.prepare(`SELECT COUNT(*) AS count FROM ${STORE_TABLES.orphanOperations}`).get()
                ?.count,
        );
        const existing = database
            .prepare(
                `SELECT operation_digest, operation_json FROM ${STORE_TABLES.orphanOperations} WHERE operation_id = ?`,
            )
            .get(operation.operation_id) as
            | { readonly operation_digest: string; readonly operation_json: string }
            | undefined;
        if (existing !== undefined) {
            if (
                existing.operation_digest !== operationDigest ||
                existing.operation_json !== operationJson
            ) {
                throw corrupt("operation identity already names different bookkeeping");
            }
            database.exec(STORE_TRANSACTION_SQL.commit);
            return operation;
        }
        if (count >= CONFIG.limits.maxOperations) {
            throw new TypeError("open operation count exceeds the configured maximum");
        }
        if (
            operation.cause_record_id !== null &&
            readStoredRecord(database, operation.cause_record_id) === undefined
        ) {
            throw new TypeError("cause_record_id must identify retained canonical evidence");
        }
        database
            .prepare(
                `INSERT INTO ${STORE_TABLES.orphanOperations}(
                    operation_id, owner_id, session_id, operation_digest, operation_json
                 ) VALUES (?, ?, ?, ?, ?)`,
            )
            .run(
                operation.operation_id,
                operation.owner_id,
                operation.session_id,
                operationDigest,
                operationJson,
            );
        database.exec(STORE_TRANSACTION_SQL.commit);
        return operation;
    } catch (error) {
        rollbackFailedTransaction(database, STORE_TRANSACTION_SQL.rollback);
        throw error;
    }
}

/** Records externally proven session death without altering operation or world evidence. @internal */
export function retainOperationSessionDeath(
    database: DatabaseSync,
    evidence: OperationSessionDeathEvidence,
): number {
    const normalized = normalizeDeathEvidence(evidence);
    database.exec(STORE_TRANSACTION_SQL.begin);
    try {
        const rows = database
            .prepare(
                `SELECT session_dead, death_evidence_id FROM ${STORE_TABLES.orphanOperations} WHERE session_id = ?`,
            )
            .all(normalized.session_id);
        for (const row of rows) {
            if (
                Number(row.session_dead) === 1 &&
                row.death_evidence_id !== normalized.death_evidence_id
            ) {
                throw corrupt("session death evidence conflicts with retained bookkeeping");
            }
        }
        database
            .prepare(
                `UPDATE ${STORE_TABLES.orphanOperations}
                 SET session_dead = 1, death_evidence_id = ?
                 WHERE session_id = ? AND session_dead = 0`,
            )
            .run(normalized.death_evidence_id, normalized.session_id);
        database.exec(STORE_TRANSACTION_SQL.commit);
        return rows.length;
    } catch (error) {
        rollbackFailedTransaction(database, STORE_TRANSACTION_SQL.rollback);
        throw error;
    }
}

/** Removes normally completed bookkeeping only for its exact owning session. @internal */
export function completeOpenOperation(
    database: DatabaseSync,
    operationId: string,
    sessionId: string,
): boolean {
    assertBoundedIdentifier(operationId, "operationId");
    assertBoundedIdentifier(sessionId, "sessionId");
    return (
        database
            .prepare(
                `DELETE FROM ${STORE_TABLES.orphanOperations} WHERE operation_id = ? AND session_id = ?`,
            )
            .run(operationId, sessionId).changes === 1
    );
}

/** Reads one coherent bounded orphaned-operation diagnosis. @internal */
export function diagnoseOpenOperations(
    database: DatabaseSync,
    options: OrphanOperationDiagnosisOptions = {},
): OrphanOperationDiagnosisReport {
    const normalizedOptions = normalizeDiagnosisOptions(options);
    database.exec(STORE_READ_TRANSACTION_SQL.begin);
    try {
        const report = diagnoseWithinTransaction(database, normalizedOptions);
        database.exec(STORE_READ_TRANSACTION_SQL.commit);
        return report;
    } catch (error) {
        rollbackFailedTransaction(database, STORE_READ_TRANSACTION_SQL.rollback);
        throw error;
    }
}

/** Durably prepares canonical command evidence without mutating operation bookkeeping. @internal */
export function prepareOpenOperationRepair(
    database: DatabaseSync,
    command: OrphanRepairCommand,
): OrphanRepairPreparation {
    const normalized = normalizeCommand(command);
    try {
        const receipt = appendToTraceStore(database, {
            append_intent_id: `${CONFIG.identity.commandAppendIntentPrefix}${normalized.command_id}`,
            batch: {
                groups: [
                    {
                        owner_id: repairOwner(normalized.command_id),
                        records: [
                            {
                                body: normalized as RecordBody,
                                mode: "capture",
                                schema_ref: CONFIG.traceSchemas.command,
                                witness_ref: ROOT_WITNESS_ID,
                            },
                        ],
                    },
                ],
            },
        });
        const commandRecordId = receipt.record_ids[0];
        // Append contract always returns the one requested record.
        /* node:coverage disable */
        if (commandRecordId === undefined) {
            throw corrupt("prepared command receipt contains no canonical record");
        }
        /* node:coverage enable */
        return Object.freeze({ command: normalized, command_record_id: commandRecordId });
    } catch (error) {
        if (error instanceof AppendIntentConflictError) {
            throw new OrphanRepairError(
                ORPHAN_REPAIR_ERROR_CODES.commandConflict,
                CONFIG.errors.commandConflictMessage,
                { cause: error },
            );
        }
        throw error;
    }
}

/** Applies or idempotently replays one exact bookkeeping-only repair. @internal */
export function repairOpenOperations(
    database: DatabaseSync,
    command: OrphanRepairCommand,
): OrphanRepairReceipt {
    const prepared = prepareOpenOperationRepair(database, command);
    const normalized = prepared.command;
    database.exec(STORE_TRANSACTION_SQL.begin);
    try {
        const existing = readExistingReceipt(database, normalized, prepared.command_record_id);
        if (existing !== undefined) {
            database.exec(STORE_TRANSACTION_SQL.commit);
            return existing;
        }
        const diagnosis = diagnoseWithinTransaction(database, {
            limit: CONFIG.limits.maxOperations,
            offset: 0,
        });
        if (diagnosis.basis_id !== normalized.basis_id) {
            throw stale();
        }
        if (diagnosis.blocked_count !== 0) {
            throw new OrphanRepairError(
                ORPHAN_REPAIR_ERROR_CODES.blocked,
                CONFIG.errors.blockedMessage,
            );
        }
        const diagnosedIds = diagnosis.operations.map(({ operation_id }) => operation_id);
        if (!sameStrings(diagnosedIds, normalized.operation_ids)) {
            throw stale();
        }
        for (const operationId of diagnosedIds) {
            const result = database
                .prepare(`DELETE FROM ${STORE_TABLES.orphanOperations} WHERE operation_id = ?`)
                .run(operationId);
            // The write lock and exact basis make disappearance impossible.
            /* node:coverage disable */
            if (result.changes !== 1) {
                throw stale();
            }
            /* node:coverage enable */
        }
        const receiptBase = {
            basis_id: normalized.basis_id,
            command_id: normalized.command_id,
            command_record_id: prepared.command_record_id,
            operation_ids: normalized.operation_ids,
            repaired_count: normalized.operation_ids.length,
            receipt_version: CONFIG.versions.receipt,
        };
        const receiptId = `${CONFIG.identity.receiptPrefix}${digest(boundedCanonicalize(receiptBase, "repair receipt"))}`;
        const evidence: OrphanRepairReceiptEvidence = Object.freeze({
            ...receiptBase,
            receipt_id: receiptId,
        });
        const appendReceipt = appendWithinTraceStoreTransaction(database, {
            append_intent_id: `${CONFIG.identity.receiptAppendIntentPrefix}${normalized.command_id}`,
            batch: {
                groups: [
                    {
                        caused_by_record_ids: [prepared.command_record_id],
                        owner_id: repairOwner(normalized.command_id),
                        records: [
                            {
                                body: evidence as RecordBody,
                                mode: "capture",
                                schema_ref: CONFIG.traceSchemas.receipt,
                                witness_ref: ROOT_WITNESS_ID,
                            },
                        ],
                    },
                ],
            },
        });
        const receiptRecordId = appendReceipt.record_ids[0];
        // Append contract always returns the one requested record.
        /* node:coverage disable */
        if (receiptRecordId === undefined) {
            throw corrupt("repair receipt append contains no canonical record");
        }
        /* node:coverage enable */
        database
            .prepare(
                `INSERT INTO ${STORE_TABLES.orphanOperationRepairs}(
                    command_id, basis_id, command_record_id, receipt_record_id, receipt_json
                 ) VALUES (?, ?, ?, ?, ?)`,
            )
            .run(
                normalized.command_id,
                normalized.basis_id,
                prepared.command_record_id,
                receiptRecordId,
                boundedCanonicalize(evidence, "repair receipt"),
            );
        database.exec(STORE_TRANSACTION_SQL.commit);
        return Object.freeze({ ...evidence, receipt_record_id: receiptRecordId });
    } catch (error) {
        rollbackFailedTransaction(database, STORE_TRANSACTION_SQL.rollback);
        throw error;
    }
}

/** Attempts fail-soft pre-run reclaim while preserving exact diagnosis on refusal. @internal */
export function reclaimOpenOperationsBeforeRun(
    database: DatabaseSync,
    commandId: string,
): OrphanPreRunReclaimResult {
    let diagnosis: OrphanOperationDiagnosisReport;
    try {
        diagnosis = diagnoseOpenOperations(database, {
            limit: CONFIG.limits.maxOperations,
            offset: 0,
        });
    } catch (error) {
        return Object.freeze({
            diagnosis: null,
            error_code:
                error instanceof OrphanRepairError ? error.code : ORPHAN_REPAIR_ERROR_CODES.corrupt,
            status: ORPHAN_REPAIR_PRE_RUN_STATUSES.declined,
        });
    }
    if (diagnosis.blocked_count !== 0) {
        return Object.freeze({
            diagnosis,
            error_code: ORPHAN_REPAIR_ERROR_CODES.blocked,
            status: ORPHAN_REPAIR_PRE_RUN_STATUSES.declined,
        });
    }
    try {
        const receipt = repairOpenOperations(database, {
            basis_id: diagnosis.basis_id,
            command_id: commandId,
            command_version: CONFIG.versions.command,
            operation_ids: diagnosis.operations.map(({ operation_id }) => operation_id),
        });
        return Object.freeze({
            diagnosis,
            receipt,
            status: ORPHAN_REPAIR_PRE_RUN_STATUSES.repaired,
        });
    } catch (error) {
        return Object.freeze({
            diagnosis,
            error_code:
                error instanceof OrphanRepairError ? error.code : ORPHAN_REPAIR_ERROR_CODES.corrupt,
            status: ORPHAN_REPAIR_PRE_RUN_STATUSES.declined,
        });
    }
}

function diagnoseWithinTransaction(
    database: DatabaseSync,
    options: Required<OrphanOperationDiagnosisOptions>,
): OrphanOperationDiagnosisReport {
    const rows = database
        .prepare(
            `SELECT operation_id, owner_id, session_id, operation_digest, operation_json,
                    session_dead, death_evidence_id
             FROM ${STORE_TABLES.orphanOperations} ORDER BY operation_id LIMIT ?`,
        )
        .all(CONFIG.limits.maxOperations + 1) as OrphanOperationRow[];
    if (rows.length > CONFIG.limits.maxOperations) {
        throw corrupt("open operation count exceeds the configured maximum");
    }
    const operations = rows.map(decodeDiagnosis);
    const basisPayload = {
        compatibility_version: CONFIG.compatibilityVersion,
        diagnosis_version: CONFIG.versions.diagnosis,
        operations,
    };
    const basisId = `${CONFIG.identity.diagnosisPrefix}${digest(boundedCanonicalize(basisPayload, "orphan diagnosis"))}`;
    const page = operations.slice(options.offset, options.offset + options.limit);
    return Object.freeze({
        basis_id: basisId,
        blocked_count: operations.filter(({ repairable }) => !repairable).length,
        diagnosis_version: CONFIG.versions.diagnosis,
        limit: options.limit,
        offset: options.offset,
        operations: Object.freeze(page),
        repairable_count: operations.filter(({ repairable }) => repairable).length,
        total_count: operations.length,
    });
}

function decodeDiagnosis(row: OrphanOperationRow): OrphanOperationDiagnosis {
    let parsed: unknown;
    try {
        parsed = JSON.parse(row.operation_json) as unknown;
    } catch (error) {
        throw corrupt("operation bookkeeping JSON is malformed", error);
    }
    const operation = normalizeOperation(parsed);
    const canonical = boundedCanonicalize(operation, "operation bookkeeping");
    if (
        row.operation_id !== operation.operation_id ||
        row.owner_id !== operation.owner_id ||
        row.session_id !== operation.session_id ||
        row.operation_json !== canonical ||
        row.operation_digest !== digest(canonical) ||
        (row.session_dead !== 0 && row.session_dead !== 1) ||
        (row.session_dead === 0 && row.death_evidence_id !== null) ||
        (row.session_dead === 1 && row.death_evidence_id === null)
    ) {
        throw corrupt("operation bookkeeping columns disagree with canonical evidence");
    }
    const blockers = [
        ...(row.session_dead === 0 ? [ORPHAN_REPAIR_BLOCKERS.liveSession] : []),
        ...(operation.provider_call_started ? [ORPHAN_REPAIR_BLOCKERS.providerStarted] : []),
        ...(operation.scope_owned ? [ORPHAN_REPAIR_BLOCKERS.scopeOwned] : []),
    ];
    return Object.freeze({
        ...operation,
        blockers: Object.freeze(blockers),
        death_evidence_id: row.death_evidence_id,
        repairable: blockers.length === 0,
        session_status:
            row.session_dead === 1
                ? ORPHAN_REPAIR_SESSION_STATUSES.dead
                : ORPHAN_REPAIR_SESSION_STATUSES.live,
    });
}

function readExistingReceipt(
    database: DatabaseSync,
    command: OrphanRepairCommand,
    commandRecordId: RecordId,
): OrphanRepairReceipt | undefined {
    const marker = database
        .prepare(
            `SELECT basis_id, command_record_id, receipt_record_id, receipt_json
             FROM ${STORE_TABLES.orphanOperationRepairs} WHERE command_id = ?`,
        )
        .get(command.command_id) as
        | {
              readonly basis_id: string;
              readonly command_record_id: RecordId;
              readonly receipt_json: string;
              readonly receipt_record_id: RecordId;
          }
        | undefined;
    if (marker === undefined) return undefined;
    if (marker.basis_id !== command.basis_id || marker.command_record_id !== commandRecordId) {
        throw corrupt("repair commit marker disagrees with its prepared command");
    }
    const row = database
        .prepare(
            `SELECT view.append_intent_id, view.record_id FROM ${STORE_TABLES.recordViews} AS view
             INNER JOIN ${STORE_TABLES.records} AS record ON record.record_id = view.record_id
             WHERE view.owner_id = ? AND view.record_id = ? AND view.append_intent_id = ?
               AND record.schema_ref = ?`,
        )
        .get(
            repairOwner(command.command_id),
            marker.receipt_record_id,
            `${CONFIG.identity.receiptAppendIntentPrefix}${command.command_id}`,
            CONFIG.traceSchemas.receipt,
        ) as { readonly append_intent_id: string; readonly record_id: RecordId } | undefined;
    if (row === undefined) {
        throw corrupt("repair commit marker has no exact canonical receipt view");
    }
    const retained = readStoredRecord(database, row.record_id);
    // The join and foreign keys make disappearance impossible inside this transaction.
    /* node:coverage disable */
    if (retained === undefined) throw corrupt("repair receipt record disappeared");
    /* node:coverage enable */
    const evidence = normalizeReceiptEvidence(retained.body);
    if (
        marker.receipt_json !== boundedCanonicalize(evidence, "repair receipt") ||
        evidence.command_id !== command.command_id ||
        evidence.command_record_id !== commandRecordId ||
        evidence.basis_id !== command.basis_id ||
        !sameStrings(evidence.operation_ids, command.operation_ids) ||
        !sameStrings(retained.envelope.caused_by_record_ids, [commandRecordId])
    ) {
        throw corrupt("repair receipt disagrees with its prepared command");
    }
    return Object.freeze({ ...evidence, receipt_record_id: row.record_id });
}

function normalizeOperation(value: unknown): OperationBookkeepingDefinition {
    const object = readClosedObject(
        value,
        [
            "cause_record_id",
            "operation_id",
            "operation_version",
            "owner_id",
            "provider_call_started",
            "retained_cause",
            "scope_id",
            "scope_owned",
            "session_id",
        ],
        "operation bookkeeping",
    );
    const operationVersion = readPositiveInteger(object.operation_version, "operation_version");
    if (operationVersion !== CONFIG.versions.operation) unsupported();
    assertBoundedIdentifier(object.operation_id, "operation_id");
    assertBoundedIdentifier(object.owner_id, "owner_id");
    assertBoundedIdentifier(object.session_id, "session_id");
    if (object.scope_id !== null) assertBoundedIdentifier(object.scope_id, "scope_id");
    if (object.cause_record_id !== null) {
        assertRecordId(object.cause_record_id, "cause_record_id");
    }
    assertBoolean(object.provider_call_started, "provider_call_started");
    assertBoolean(object.scope_owned, "scope_owned");
    const retainedCause = readBoundedText(
        object.retained_cause,
        CONFIG.limits.maxCauseBytes,
        "retained_cause",
    );
    return Object.freeze({
        cause_record_id: object.cause_record_id,
        operation_id: object.operation_id,
        operation_version: operationVersion,
        owner_id: object.owner_id,
        provider_call_started: object.provider_call_started,
        retained_cause: retainedCause,
        scope_id: object.scope_id,
        scope_owned: object.scope_owned,
        session_id: object.session_id,
    });
}

function normalizeDeathEvidence(value: unknown): OperationSessionDeathEvidence {
    const object = readClosedObject(
        value,
        ["death_evidence_id", "session_id"],
        "operation session death evidence",
    );
    assertBoundedIdentifier(object.death_evidence_id, "death_evidence_id");
    assertBoundedIdentifier(object.session_id, "session_id");
    return Object.freeze({
        death_evidence_id: object.death_evidence_id,
        session_id: object.session_id,
    });
}

function normalizeDiagnosisOptions(value: unknown): Required<OrphanOperationDiagnosisOptions> {
    const object = readOptionalClosedObject(value, ["limit", "offset"], "diagnosis options");
    const limit = object.limit ?? CONFIG.limits.defaultPageSize;
    const offset = object.offset ?? 0;
    if (
        !Number.isSafeInteger(limit) ||
        Number(limit) < 1 ||
        Number(limit) > CONFIG.limits.maxPageSize
    ) {
        throw new TypeError("diagnosis limit must be within configured bounds");
    }
    if (
        !Number.isSafeInteger(offset) ||
        Number(offset) < 0 ||
        Number(offset) > CONFIG.limits.maxOperations
    ) {
        throw new TypeError("diagnosis offset must be within configured bounds");
    }
    return { limit: Number(limit), offset: Number(offset) };
}

function normalizeCommand(value: unknown): OrphanRepairCommand {
    const object = readClosedObject(
        value,
        ["basis_id", "command_id", "command_version", "operation_ids"],
        "orphan repair command",
    );
    const commandVersion = readPositiveInteger(object.command_version, "command_version");
    if (commandVersion !== CONFIG.versions.command) unsupported();
    assertDigestIdentifier(object.basis_id, CONFIG.identity.diagnosisPrefix, "basis_id");
    assertBoundedIdentifier(object.command_id, "command_id");
    if (!Array.isArray(object.operation_ids)) {
        throw new TypeError("operation_ids must be an array");
    }
    if (object.operation_ids.length > CONFIG.limits.maxOperations) {
        throw new TypeError("operation_ids exceeds the configured maximum");
    }
    const ids = object.operation_ids.map((id, index) => {
        assertBoundedIdentifier(id, `operation_ids[${index}]`);
        return id;
    });
    if (new Set(ids).size !== ids.length) {
        throw new TypeError("operation_ids must contain unique identities");
    }
    const normalized = Object.freeze({
        basis_id: object.basis_id,
        command_id: object.command_id,
        command_version: commandVersion,
        operation_ids: Object.freeze([...ids].sort()),
    });
    boundedCanonicalize(normalized, "orphan repair command");
    return normalized;
}

function normalizeReceiptEvidence(value: unknown): OrphanRepairReceiptEvidence {
    const object = readClosedObject(
        value,
        [
            "basis_id",
            "command_id",
            "command_record_id",
            "operation_ids",
            "receipt_id",
            "receipt_version",
            "repaired_count",
        ],
        "orphan repair receipt",
    );
    const receiptVersion = readPositiveInteger(object.receipt_version, "receipt_version");
    if (receiptVersion !== CONFIG.versions.receipt) unsupported();
    const command = normalizeCommand({
        basis_id: object.basis_id,
        command_id: object.command_id,
        command_version: CONFIG.versions.command,
        operation_ids: object.operation_ids,
    });
    assertRecordId(object.command_record_id, "command_record_id");
    assertDigestIdentifier(object.receipt_id, CONFIG.identity.receiptPrefix, "receipt_id");
    if (object.repaired_count !== command.operation_ids.length) {
        throw corrupt("repair receipt count disagrees with operation identities");
    }
    const base = {
        basis_id: command.basis_id,
        command_id: command.command_id,
        command_record_id: object.command_record_id,
        operation_ids: command.operation_ids,
        repaired_count: command.operation_ids.length,
        receipt_version: receiptVersion,
    };
    const expectedId = `${CONFIG.identity.receiptPrefix}${digest(boundedCanonicalize(base, "repair receipt"))}`;
    if (object.receipt_id !== expectedId) {
        throw corrupt("repair receipt identity is invalid");
    }
    return Object.freeze({ ...base, receipt_id: expectedId });
}

function boundedCanonicalize(value: object, subject: string): string {
    const json = canonicalizeRecord(value as SemanticRecord);
    // Tighter configured field/count bounds cap current evidence below this ceiling.
    /* node:coverage disable */
    if (Buffer.byteLength(json, "utf8") > CONFIG.limits.maxCanonicalBytes) {
        throw new TypeError(`${subject} exceeds the configured canonical byte limit`);
    }
    /* node:coverage enable */
    return json;
}

function digest(value: string): string {
    return createHash(CONFIG.identity.algorithm).update(value, "utf8").digest("hex");
}

function repairOwner(commandId: string): string {
    return `${CONFIG.identity.commandOwnerPrefix}${commandId}`;
}

function readClosedObject(
    value: unknown,
    keys: readonly string[],
    subject: string,
): Record<string, unknown> {
    const object = readOptionalClosedObject(value, keys, subject);
    if (!keys.every((key) => Object.hasOwn(object, key))) {
        throw new TypeError(`${subject} must contain exactly its declared fields`);
    }
    return object;
}

function readOptionalClosedObject(
    value: unknown,
    keys: readonly string[],
    subject: string,
): Record<string, unknown> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new TypeError(`${subject} must be an object`);
    }
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError(`${subject} must be a plain object`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (
        Object.getOwnPropertySymbols(value).length !== 0 ||
        Object.keys(descriptors).some((key) => !keys.includes(key)) ||
        Object.values(descriptors).some((descriptor) => !("value" in descriptor))
    ) {
        throw new TypeError(`${subject} must contain only declared data fields`);
    }
    return value as Record<string, unknown>;
}

function assertBoundedIdentifier(value: unknown, subject: string): asserts value is string {
    readBoundedText(value, CONFIG.limits.maxIdentifierBytes, subject);
}

function assertDigestIdentifier(
    value: unknown,
    prefix: string,
    subject: string,
): asserts value is string {
    if (
        typeof value !== "string" ||
        !value.startsWith(prefix) ||
        value.length !== prefix.length + CONFIG.identity.hexLength ||
        !/^[0-9a-f]+$/u.test(value.slice(prefix.length))
    ) {
        throw new TypeError(`${subject} must be a configured digest identifier`);
    }
}

function readBoundedText(value: unknown, maxBytes: number, subject: string): string {
    if (typeof value !== "string" || value.length === 0 || /[\uD800-\uDFFF]/u.test(value)) {
        throw new TypeError(`${subject} must be a non-empty well-formed string`);
    }
    if (Buffer.byteLength(value, "utf8") > maxBytes) {
        throw new TypeError(`${subject} exceeds the configured byte limit`);
    }
    return value;
}

function readPositiveInteger(value: unknown, subject: string): number {
    if (!Number.isSafeInteger(value) || Number(value) < 1) {
        throw new TypeError(`${subject} must be a positive safe integer`);
    }
    return Number(value);
}

function assertBoolean(value: unknown, subject: string): asserts value is boolean {
    if (typeof value !== "boolean") throw new TypeError(`${subject} must be a boolean`);
}

function unsupported(): never {
    throw new OrphanRepairError(
        ORPHAN_REPAIR_ERROR_CODES.unsupported,
        CONFIG.errors.unsupportedMessage,
    );
}

function stale(): OrphanRepairError {
    return new OrphanRepairError(ORPHAN_REPAIR_ERROR_CODES.stale, CONFIG.errors.staleMessage);
}

function corrupt(detail: string, cause?: unknown): OrphanRepairError {
    return new OrphanRepairError(
        ORPHAN_REPAIR_ERROR_CODES.corrupt,
        `${CONFIG.errors.corruptMessage}: ${detail}`,
        cause === undefined ? undefined : { cause },
    );
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}
