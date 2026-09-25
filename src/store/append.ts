import type { DatabaseSync } from "node:sqlite";

import { planAppendBatch } from "../append/plan.ts";
import { normalizeAppendBatchDraft } from "../append/validation.ts";
import { canonicalizeRecord } from "../canonical/canonical-record.ts";
import { kernelProtocolConfig } from "../protocol/config.ts";
import type { RecordId } from "../record/types.ts";
import { rollbackFailedTransaction } from "../runtime/sqlite-transaction.ts";
import {
    createAppendReceipt,
    createBatchDigest,
    decodeAppendReceipt,
    encodeAppendReceipt,
} from "./codec.ts";
import { STORE_TABLES, STORE_TRANSACTION_SQL } from "./constants.ts";
import { AppendIntentConflictError, TraceStoreError } from "./errors.ts";
import { readStoredRecord } from "./read.ts";
import { assertStoredReceiptMatches } from "./receipt-integrity.ts";
import { refuseSecretBearingBodies } from "./secret-scanning.ts";
import { HOT_PATH_SQL } from "./statements.ts";
import type { AppendReceipt, StoreAppendRequest } from "./types.ts";
import { normalizeStoreAppendRequest } from "./validation.ts";

/**
 * Commits or idempotently replays one append request.
 *
 * A store scanning in `refuse` mode rejects secret-bearing bodies before the transaction begins.
 */
export function appendToTraceStore(
    database: DatabaseSync,
    request: StoreAppendRequest,
): AppendReceipt {
    refuseSecretBearingAppend(database, request);
    database.exec(STORE_TRANSACTION_SQL.begin);
    try {
        const receipt = appendScannedWithinTransaction(database, request);
        database.exec(STORE_TRANSACTION_SQL.commit);
        return receipt;
    } catch (error) {
        rollbackFailedTransaction(database, STORE_TRANSACTION_SQL.rollback);
        throw error;
    }
}

/**
 * Commits or replays an append inside a transaction owned by the caller.
 *
 * A store scanning in `refuse` mode rejects secret-bearing bodies before this append writes.
 */
export function appendWithinTraceStoreTransaction(
    database: DatabaseSync,
    request: StoreAppendRequest,
): AppendReceipt {
    refuseSecretBearingAppend(database, request);
    return appendScannedWithinTransaction(database, request);
}

function refuseSecretBearingAppend(database: DatabaseSync, request: StoreAppendRequest): void {
    refuseSecretBearingBodies(database, () =>
        normalizeAppendBatchDraft(normalizeStoreAppendRequest(request).batch).groups.flatMap(
            (group, groupIndex) =>
                group.records.map((record, recordIndex) => ({
                    body: record.body,
                    pointer: `/batch/groups/${groupIndex}/records/${recordIndex}/body`,
                })),
        ),
    );
}

function appendScannedWithinTransaction(
    database: DatabaseSync,
    request: StoreAppendRequest,
): AppendReceipt {
    const normalizedRequest = normalizeStoreAppendRequest(request);
    const batch = normalizeAppendBatchDraft(normalizedRequest.batch);
    const batchDigest = createBatchDigest(batch);
    const existingIntent = database
        .prepare(
            `SELECT batch_digest, receipt_json FROM ${STORE_TABLES.appendIntents}
                 WHERE append_intent_id = ?`,
        )
        .get(normalizedRequest.append_intent_id);
    if (existingIntent !== undefined) {
        if (existingIntent.batch_digest !== batchDigest) {
            throw new AppendIntentConflictError(
                `append intent ${normalizedRequest.append_intent_id} already committed different content`,
            );
        }
        // The STRICT `TEXT NOT NULL` column always yields a string.
        const receipt = decodeAppendReceipt(
            String(existingIntent.receipt_json),
            normalizedRequest.append_intent_id,
        );
        assertStoredReceiptMatches(database, receipt);
        return receipt;
    }

    // Planning needs only the retained records this batch cites and the owners it extends, so
    // both are read by primary key instead of loading every record identity and owner ordinal.
    const referencedRecordIds = new Set<unknown>();
    const batchOwnerIds = new Set<string>();
    for (const group of batch.groups) {
        batchOwnerIds.add(group.owner_id);
        for (const parentId of group.caused_by_record_ids ?? []) referencedRecordIds.add(parentId);
        for (const record of group.records) {
            referencedRecordIds.add(record.witness_ref);
            for (const parentId of record.caused_by_record_ids ?? []) {
                referencedRecordIds.add(parentId);
            }
        }
    }
    const knownRecordStatement = database.prepare(HOT_PATH_SQL.appendKnownRecord);
    const knownSchemas = new Map<RecordId, string>();
    for (const recordId of referencedRecordIds) {
        const row = typeof recordId === "string" ? knownRecordStatement.get(recordId) : undefined;
        if (row !== undefined) knownSchemas.set(recordId as RecordId, String(row.schema_ref));
    }
    const knownRecordIds = new Set(knownSchemas.keys());
    const ownerOrdinalStatement = database.prepare(HOT_PATH_SQL.appendOwnerNextOrdinal);
    const nextOwnerOrdinals = new Map<string, number>();
    for (const ownerId of batchOwnerIds) {
        const row = ownerOrdinalStatement.get(ownerId);
        if (row !== undefined) nextOwnerOrdinals.set(ownerId, Number(row.next_ordinal));
    }
    const plan = planAppendBatch(batch, {
        known_record_ids: knownRecordIds,
        next_owner_ordinals: nextOwnerOrdinals,
    });
    validateWitnesses(plan.records, knownSchemas);
    const receipt = createAppendReceipt(normalizedRequest.append_intent_id, plan);
    database
        .prepare(
            `INSERT INTO ${STORE_TABLES.appendIntents}(
                    append_intent_id, batch_digest, receipt_json
                 )
                 VALUES (?, ?, ?)`,
        )
        .run(normalizedRequest.append_intent_id, batchDigest, encodeAppendReceipt(receipt));

    const insertRecord = database.prepare(
        `INSERT OR IGNORE INTO ${STORE_TABLES.records}(
                record_id, digest, schema_ref, mode, witness_ref, caused_by_json, body_json
             ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertParent = database.prepare(
        `INSERT OR IGNORE INTO ${STORE_TABLES.recordParents}(
                child_record_id, parent_record_id, parent_position
             ) VALUES (?, ?, ?)`,
    );
    const insertView = database.prepare(
        `INSERT INTO ${STORE_TABLES.recordViews}(
                owner_id, owner_ordinal, record_id, append_intent_id, append_position
             ) VALUES (?, ?, ?, ?, ?)`,
    );
    for (const [appendPosition, record] of plan.records.entries()) {
        insertRecord.run(
            record.envelope.record_id,
            record.envelope.digest,
            record.envelope.schema_ref,
            record.envelope.mode,
            record.envelope.witness_ref,
            JSON.stringify(record.envelope.caused_by_record_ids),
            canonicalizeRecord(record.body),
        );
        readStoredRecord(database, record.envelope.record_id);
        for (const [position, parentId] of record.envelope.caused_by_record_ids.entries()) {
            insertParent.run(record.envelope.record_id, parentId, position);
        }
        insertView.run(
            record.view.owner_id,
            record.view.owner_ordinal,
            record.envelope.record_id,
            normalizedRequest.append_intent_id,
            appendPosition,
        );
    }

    const setNextOrdinal = database.prepare(
        `INSERT INTO ${STORE_TABLES.ownerOrdinals}(owner_id, next_ordinal) VALUES (?, ?)
             ON CONFLICT(owner_id) DO UPDATE SET next_ordinal = excluded.next_ordinal`,
    );
    for (const [ownerId, [, lastOrdinal]] of plan.owner_ordinal_ranges) {
        setNextOrdinal.run(ownerId, lastOrdinal + 1);
    }
    return receipt;
}

/**
 * Requires every `witness_ref` to name a retained or earlier planned record whose schema is the
 * root witness or the configured witness schema, the invariant `verifyIntegrity` checks as
 * `witness_mismatch`; a refused batch writes nothing.
 */
function validateWitnesses(
    records: readonly {
        readonly envelope: {
            readonly record_id: RecordId;
            readonly schema_ref: string;
            readonly witness_ref: RecordId | "";
        };
    }[],
    knownSchemas: ReadonlyMap<RecordId, string>,
): void {
    const available = new Map<string, string>(knownSchemas);
    for (const record of records) {
        const witnessSchema = available.get(record.envelope.witness_ref);
        if (witnessSchema === undefined) {
            throw new TraceStoreError(`unknown witness record: ${record.envelope.witness_ref}`);
        }
        if (
            witnessSchema !== kernelProtocolConfig.rootWitness.schemaRef &&
            witnessSchema !== kernelProtocolConfig.queries.witnessSchemaRef
        ) {
            throw new TraceStoreError(
                `witness_ref does not name a witness record: ${record.envelope.witness_ref}`,
            );
        }
        available.set(record.envelope.record_id, record.envelope.schema_ref);
    }
}
