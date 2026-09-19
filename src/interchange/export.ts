import type { DatabaseSync } from "node:sqlite";

import type { BlobFilesystem } from "../blob/filesystem.ts";
import { canonicalizeRecord, type SemanticRecord } from "../canonical/canonical-record.ts";
import { kernelProtocolConfig } from "../protocol/config.ts";
import { rollbackFailedTransaction } from "../runtime/sqlite-transaction.ts";
import { readStoredBlob } from "../store/blobs.ts";
import { STORE_READ_TRANSACTION_SQL, STORE_TABLES } from "../store/constants.ts";
import { TraceStoreError } from "../store/errors.ts";
import { scanTraceStoreIntegrity } from "../store/integrity.ts";
import { readStoredRecord } from "../store/read.ts";

/** Serializes one complete, verified trace store into deterministic archive JSON. */
export function exportTraceArchive(database: DatabaseSync, filesystem: BlobFilesystem): string {
    database.exec(STORE_READ_TRANSACTION_SQL.begin);
    try {
        const archive = readTraceArchive(database, filesystem);
        database.exec(STORE_READ_TRANSACTION_SQL.commit);
        return archive;
    } catch (error) {
        rollbackFailedTransaction(database, STORE_READ_TRANSACTION_SQL.rollback);
        throw error;
    }
}

function readTraceArchive(database: DatabaseSync, filesystem: BlobFilesystem): string {
    const integrity = scanTraceStoreIntegrity(database, filesystem);
    if (!integrity.ok) {
        throw new TraceStoreError("cannot export a trace store that failed integrity verification");
    }
    const records = database
        .prepare(`SELECT record_id FROM ${STORE_TABLES.records} ORDER BY record_id`)
        .all()
        .map((row) => {
            const retained = readStoredRecord(database, String(row.record_id));
            /* node:coverage disable */
            if (retained === undefined) {
                throw new TraceStoreError("record disappeared during trace export");
            }
            /* node:coverage enable */
            return { body: retained.body, envelope: retained.envelope };
        });
    const recordViews = readRows(
        database,
        `SELECT append_intent_id, append_position, owner_id, owner_ordinal, record_id
         FROM ${STORE_TABLES.recordViews} ORDER BY owner_id, owner_ordinal`,
    );
    const appendIntents = readRows(
        database,
        `SELECT append_intent_id, batch_digest, receipt_json
         FROM ${STORE_TABLES.appendIntents} ORDER BY append_intent_id`,
    );
    const cuts = readRows(
        database,
        `SELECT append_intent_id, created_by_record_id, cut_id, publisher_owner_id,
                target_owner_id, through_owner_ordinal, through_record_id
         FROM ${STORE_TABLES.cuts} ORDER BY cut_id`,
    );
    const blobs = database
        .prepare(`SELECT blob_id, byte_length FROM ${STORE_TABLES.blobs} ORDER BY blob_id`)
        .all()
        .map((row) => {
            const blobId = String(row.blob_id);
            const content = readStoredBlob(database, filesystem, blobId);
            /* node:coverage disable */
            if (content === undefined) {
                throw new TraceStoreError("blob disappeared during trace export");
            }
            /* node:coverage enable */
            return {
                blob_id: blobId,
                byte_length: Number(row.byte_length),
                content_base64: Buffer.from(content).toString(
                    kernelProtocolConfig.interchange.blobEncoding,
                ),
            };
        });
    return canonicalizeRecord({
        append_intents: appendIntents,
        blobs,
        canonical_version: kernelProtocolConfig.canonicalVersion,
        cuts,
        format: kernelProtocolConfig.interchange.format,
        format_version: kernelProtocolConfig.interchange.formatVersion,
        kernel_abi_version: kernelProtocolConfig.abiVersion,
        record_views: recordViews,
        records,
    } as unknown as SemanticRecord);
}

function readRows(database: DatabaseSync, sql: string): Readonly<Record<string, unknown>>[] {
    return database
        .prepare(sql)
        .all()
        .map((row) => ({ ...row }));
}
