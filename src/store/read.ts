import type { DatabaseSync } from "node:sqlite";

import { kernelProtocolConfig } from "../protocol/config.ts";
import { assertNonEmptyString } from "../record/guards.ts";
import { createRecordBodySnapshot } from "../record/snapshot.ts";
import type { RecordBody, RecordEnvelope, RecordId, RecordMode } from "../record/types.ts";
import { validateRecordEnvelope } from "../record/validation.ts";
import { STORE_TABLES } from "./constants.ts";
import { TraceStoreError } from "./errors.ts";
import { HOT_PATH_SQL, listOwnersBySchemaSql } from "./statements.ts";
import type { OwnerRecord, RetainedRecord } from "./types.ts";

/** Reads one semantic record and every owner-local view. */
export function readStoredRecord(
    database: DatabaseSync,
    recordId: RecordId,
): RetainedRecord | undefined {
    const row = database.prepare(HOT_PATH_SQL.record).get(recordId);
    if (row === undefined) {
        return undefined;
    }
    const record = decodeRecordRow(row);
    const views = database.prepare(HOT_PATH_SQL.recordViews).all(recordId).map(decodeViewRow);
    return Object.freeze({ ...record, views: Object.freeze(views) });
}

/** Visits every validated semantic record in record-identity order from one statement. @internal */
export function visitStoredRecords(
    database: DatabaseSync,
    visitor: (record: { readonly body: RecordBody; readonly envelope: RecordEnvelope }) => void,
): number {
    let count = 0;
    for (const row of database
        .prepare(
            `SELECT record_id, digest, schema_ref, mode, witness_ref, caused_by_json, body_json
             FROM ${STORE_TABLES.records} ORDER BY record_id`,
        )
        .iterate()) {
        visitor(decodeRecordRow(row));
        count += 1;
    }
    return count;
}

/** Reads every retained record occurrence on one owner path. */
export function readOwnerRecords(database: DatabaseSync, ownerId: string): readonly OwnerRecord[] {
    return Object.freeze(
        database
            .prepare(HOT_PATH_SQL.ownerRecords)
            .all(ownerId)
            .map((row) => {
                const record = decodeRecordRow(row);
                return Object.freeze({
                    ...record,
                    view: decodeViewRow(row),
                });
            }),
    );
}

/** Reads one required owner occurrence without retaining a cursor or loading sibling views. @internal */
export function readOwnerRecordAtOrdinal(
    database: DatabaseSync,
    ownerId: string,
    ordinal: number,
): OwnerRecord {
    const row = database.prepare(HOT_PATH_SQL.ownerRecordAtOrdinal).get(ownerId, ordinal);
    if (row === undefined) {
        throw new TraceStoreError("cut owner occurrence or its retained record is missing");
    }
    return Object.freeze({ ...decodeRecordRow(row), view: decodeViewRow(row) });
}

/** Lists a bounded owner slice by canonical creation-record/owner byte order. */
export function listOwnerIdsBySchema(
    database: DatabaseSync,
    schemaRef: string,
    limit: number,
    offset: number,
    descending: boolean,
    ownerPrefix?: string,
): readonly string[] {
    const rows = database
        .prepare(listOwnersBySchemaSql(descending, ownerPrefix !== undefined))
        .all(
            ...(ownerPrefix === undefined
                ? [schemaRef, limit, offset]
                : [schemaRef, ownerPrefix, ownerPrefix, limit, offset]),
        ) as { owner_id: string }[];
    return Object.freeze(rows.map(({ owner_id: ownerId }) => ownerId));
}

/** Lists owners whose exact-schema record contains one exact JSON text value. @internal */
export function listOwnerIdsBySchemaBodyText(
    database: DatabaseSync,
    schemaRef: string,
    jsonPath: string,
    textValue: string,
    limit: number,
): readonly string[] {
    const rows = database
        .prepare(
            `SELECT v.owner_id
             FROM ${STORE_TABLES.recordViews} AS v
             INNER JOIN ${STORE_TABLES.records} AS r ON r.record_id = v.record_id
             WHERE r.schema_ref = ?
               AND json_type(r.body_json, ?) = 'text'
               AND json_extract(r.body_json, ?) = ?
             GROUP BY v.owner_id
             ORDER BY CAST(MIN(r.record_id) AS BLOB), CAST(v.owner_id AS BLOB)
             LIMIT ?`,
        )
        .all(schemaRef, jsonPath, jsonPath, textValue, limit) as { owner_id: string }[];
    return Object.freeze(rows.map(({ owner_id: ownerId }) => ownerId));
}

function decodeRecordRow(row: Record<string, unknown>): {
    readonly body: RecordBody;
    readonly envelope: RecordEnvelope;
} {
    const causedBy = JSON.parse(readString(row, "caused_by_json")) as readonly RecordId[];
    const body = createRecordBodySnapshot(JSON.parse(readString(row, "body_json")) as RecordBody);
    const envelope: RecordEnvelope = {
        record_id: readString(row, "record_id"),
        digest: readString(row, "digest"),
        schema_ref: readString(row, "schema_ref"),
        mode: readString(row, "mode") as RecordMode,
        witness_ref: readString(row, "witness_ref"),
        caused_by_record_ids: causedBy,
    };
    validateRecordEnvelope(envelope, body);
    return {
        body,
        envelope: Object.freeze({
            ...envelope,
            caused_by_record_ids: Object.freeze(causedBy),
        }),
    };
}

function decodeViewRow(row: Record<string, unknown>) {
    const appendIntentId = readString(row, "append_intent_id");
    const ownerId = readString(row, "owner_id");
    const ownerOrdinal = readNumber(row, "owner_ordinal");
    assertNonEmptyString(appendIntentId, "stored append_intent_id");
    assertNonEmptyString(ownerId, "stored owner_id");
    if (
        !Number.isSafeInteger(ownerOrdinal) ||
        ownerOrdinal < kernelProtocolConfig.append.firstOwnerOrdinal ||
        ownerOrdinal > kernelProtocolConfig.append.lastOwnerOrdinal
    ) {
        throw new TypeError("stored owner_ordinal is outside the configured ordinal range");
    }
    return Object.freeze({
        append_intent_id: appendIntentId,
        owner_id: ownerId,
        owner_ordinal: ownerOrdinal,
    });
}

function readString(row: Record<string, unknown>, key: string): string {
    return String(row[key]);
}

function readNumber(row: Record<string, unknown>, key: string): number {
    return Number(row[key]);
}
