import type { DatabaseSync } from "node:sqlite";

import type { BlobFilesystem } from "../blob/filesystem.ts";
import { canonicalizeRecord } from "../canonical/canonical-record.ts";
import { BLOB_STORAGE_RECEIPT_VERSION, STORE_TABLES } from "../store/constants.ts";
import type { DecodedTraceArchive } from "./types.ts";

/** Writes a validated archive into an open transaction. */
export function writeTraceArchive(
    database: DatabaseSync,
    filesystem: BlobFilesystem,
    archive: DecodedTraceArchive,
    preserveExistingRoot = false,
): void {
    const insertRecord = database.prepare(
        `INSERT ${preserveExistingRoot ? "OR IGNORE " : ""}INTO ${STORE_TABLES.records}(
            record_id, digest, schema_ref, mode, witness_ref, caused_by_json, body_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const { body, envelope } of archive.records) {
        insertRecord.run(
            envelope.record_id,
            envelope.digest,
            envelope.schema_ref,
            envelope.mode,
            envelope.witness_ref,
            JSON.stringify(envelope.caused_by_record_ids),
            canonicalizeRecord(body),
        );
    }
    const insertParent = database.prepare(
        `INSERT INTO ${STORE_TABLES.recordParents}(
            child_record_id, parent_record_id, parent_position
         ) VALUES (?, ?, ?)`,
    );
    for (const { envelope } of archive.records) {
        for (const [position, parentId] of envelope.caused_by_record_ids.entries()) {
            insertParent.run(envelope.record_id, parentId, position);
        }
    }
    const insertIntent = database.prepare(
        `INSERT INTO ${STORE_TABLES.appendIntents}(
            append_intent_id, batch_digest, receipt_json
         ) VALUES (?, ?, ?)`,
    );
    for (const intent of archive.appendIntents) {
        insertIntent.run(intent.append_intent_id, intent.batch_digest, intent.receipt_json);
    }
    const insertView = database.prepare(
        `INSERT INTO ${STORE_TABLES.recordViews}(
            owner_id, owner_ordinal, record_id, append_intent_id, append_position
         ) VALUES (?, ?, ?, ?, ?)`,
    );
    const nextOrdinalByOwner = new Map<string, number>();
    for (const view of archive.recordViews) {
        insertView.run(
            view.owner_id,
            view.owner_ordinal,
            view.record_id,
            view.append_intent_id,
            view.append_position,
        );
        const nextOrdinal = view.owner_ordinal + 1;
        const retainedNextOrdinal = nextOrdinalByOwner.get(view.owner_id);
        if (retainedNextOrdinal === undefined || nextOrdinal > retainedNextOrdinal) {
            nextOrdinalByOwner.set(view.owner_id, nextOrdinal);
        }
    }
    const insertOwner = database.prepare(
        `INSERT INTO ${STORE_TABLES.ownerOrdinals}(owner_id, next_ordinal) VALUES (?, ?)`,
    );
    for (const [ownerId, nextOrdinal] of [...nextOrdinalByOwner].sort(([left], [right]) =>
        left.localeCompare(right),
    )) {
        insertOwner.run(ownerId, nextOrdinal);
    }
    const insertCut = database.prepare(
        `INSERT INTO ${STORE_TABLES.cuts}(
            cut_id, target_owner_id, through_record_id, through_owner_ordinal,
            publisher_owner_id, created_by_record_id, append_intent_id
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const cut of archive.cuts) {
        insertCut.run(
            cut.cut_id,
            cut.target_owner_id,
            cut.through_record_id,
            cut.through_owner_ordinal,
            cut.publisher_owner_id,
            cut.created_by_record_id,
            cut.append_intent_id,
        );
    }
    const insertBlob = database.prepare(
        `INSERT INTO ${STORE_TABLES.blobs}(blob_id, byte_length) VALUES (?, ?)`,
    );
    const insertReceipt = database.prepare(
        `INSERT INTO ${STORE_TABLES.storageReceipts}(
            blob_id, storage_key, byte_length, receipt_version
         ) VALUES (?, ?, ?, ?)`,
    );
    for (const blob of archive.blobs) {
        const { storageKey } = filesystem.put(blob.blob_id, blob.content);
        insertBlob.run(blob.blob_id, blob.byte_length);
        insertReceipt.run(blob.blob_id, storageKey, blob.byte_length, BLOB_STORAGE_RECEIPT_VERSION);
    }
}
