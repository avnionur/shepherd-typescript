import type { DatabaseSync } from "node:sqlite";

import { planAppendBatch } from "../append/plan.ts";
import { normalizeAppendBatchDraft } from "../append/validation.ts";
import { canonicalizeRecord } from "../canonical/canonical-record.ts";
import type { RecordId } from "../record/types.ts";
import {
    createAppendReceipt,
    createBatchDigest,
    decodeAppendReceipt,
    encodeAppendReceipt,
} from "./codec.ts";
import { AppendIntentConflictError, TraceStoreError } from "./errors.ts";
import { readStoredRecord } from "./read.ts";
import { assertStoredReceiptMatches } from "./receipt-integrity.ts";
import type { AppendReceipt, StoreAppendRequest } from "./types.ts";
import { normalizeStoreAppendRequest } from "./validation.ts";

/** Commits or idempotently replays one append request. */
export function appendToTraceStore(
    database: DatabaseSync,
    request: StoreAppendRequest,
): AppendReceipt {
    const normalizedRequest = normalizeStoreAppendRequest(request);
    const batch = normalizeAppendBatchDraft(normalizedRequest.batch);
    const batchDigest = createBatchDigest(batch);
    database.exec("BEGIN IMMEDIATE");
    try {
        const existingIntent = database
            .prepare(
                "SELECT batch_digest, receipt_json FROM append_intents WHERE append_intent_id = ?",
            )
            .get(normalizedRequest.append_intent_id);
        if (existingIntent !== undefined) {
            if (existingIntent.batch_digest !== batchDigest) {
                throw new AppendIntentConflictError(
                    `append intent ${normalizedRequest.append_intent_id} already committed different content`,
                );
            }
            if (typeof existingIntent.receipt_json !== "string") {
                throw new TraceStoreError("stored append receipt must be JSON text");
            }
            const receipt = decodeAppendReceipt(
                existingIntent.receipt_json,
                normalizedRequest.append_intent_id,
            );
            assertStoredReceiptMatches(database, receipt);
            database.exec("COMMIT");
            return receipt;
        }

        const knownRecordIds = new Set(
            database
                .prepare("SELECT record_id FROM records")
                .all()
                .map((row) => String(row.record_id)),
        );
        const nextOwnerOrdinals = new Map(
            database
                .prepare("SELECT owner_id, next_ordinal FROM owner_ordinals")
                .all()
                .map((row) => [String(row.owner_id), Number(row.next_ordinal)] as const),
        );
        const plan = planAppendBatch(batch, {
            known_record_ids: knownRecordIds,
            next_owner_ordinals: nextOwnerOrdinals,
        });
        validateWitnesses(plan.records, knownRecordIds);
        const receipt = createAppendReceipt(normalizedRequest.append_intent_id, plan);
        database
            .prepare(
                `INSERT INTO append_intents(append_intent_id, batch_digest, receipt_json)
                 VALUES (?, ?, ?)`,
            )
            .run(normalizedRequest.append_intent_id, batchDigest, encodeAppendReceipt(receipt));

        const insertRecord = database.prepare(
            `INSERT OR IGNORE INTO records(
                record_id, digest, schema_ref, mode, witness_ref, caused_by_json, body_json
             ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        );
        const insertParent = database.prepare(
            `INSERT OR IGNORE INTO record_parents(
                child_record_id, parent_record_id, parent_position
             ) VALUES (?, ?, ?)`,
        );
        const insertView = database.prepare(
            `INSERT INTO record_views(
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
            `INSERT INTO owner_ordinals(owner_id, next_ordinal) VALUES (?, ?)
             ON CONFLICT(owner_id) DO UPDATE SET next_ordinal = excluded.next_ordinal`,
        );
        for (const [ownerId, [, lastOrdinal]] of plan.owner_ordinal_ranges) {
            setNextOrdinal.run(ownerId, lastOrdinal + 1);
        }
        database.exec("COMMIT");
        return receipt;
    } catch (error) {
        database.exec("ROLLBACK");
        throw error;
    }
}

function validateWitnesses(
    records: readonly {
        readonly envelope: { readonly record_id: RecordId; readonly witness_ref: RecordId | "" };
    }[],
    knownRecordIds: ReadonlySet<RecordId>,
): void {
    const available = new Set(knownRecordIds);
    for (const record of records) {
        if (!available.has(record.envelope.witness_ref)) {
            throw new TraceStoreError(`unknown witness record: ${record.envelope.witness_ref}`);
        }
        available.add(record.envelope.record_id);
    }
}
