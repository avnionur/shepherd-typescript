import type { DatabaseSync } from "node:sqlite";

import { kernelProtocolConfig } from "../protocol/config.ts";
import { assertNonEmptyString } from "../record/guards.ts";
import { createRecordBodySnapshot } from "../record/snapshot.ts";
import type { RecordBody, RecordEnvelope, RecordId, RecordMode } from "../record/types.ts";
import { validateRecordEnvelope } from "../record/validation.ts";
import { STORE_TABLES } from "./constants.ts";
import type { OwnerRecord, RetainedRecord } from "./types.ts";

/** Reads one semantic record and every owner-local view. */
export function readStoredRecord(
    database: DatabaseSync,
    recordId: RecordId,
): RetainedRecord | undefined {
    const row = database
        .prepare(
            `SELECT record_id, digest, schema_ref, mode, witness_ref, caused_by_json, body_json
             FROM ${STORE_TABLES.records} WHERE record_id = ?`,
        )
        .get(recordId);
    if (row === undefined) {
        return undefined;
    }
    const record = decodeRecordRow(row);
    const views = database
        .prepare(
            `SELECT owner_id, owner_ordinal FROM ${STORE_TABLES.recordViews}
             WHERE record_id = ? ORDER BY owner_id, owner_ordinal`,
        )
        .all(recordId)
        .map(decodeViewRow);
    return Object.freeze({ ...record, views: Object.freeze(views) });
}

/** Reads every retained record occurrence on one owner path. */
export function readOwnerRecords(database: DatabaseSync, ownerId: string): readonly OwnerRecord[] {
    return Object.freeze(
        database
            .prepare(
                `SELECT r.record_id, r.digest, r.schema_ref, r.mode, r.witness_ref,
                        r.caused_by_json, r.body_json, v.owner_id, v.owner_ordinal
                 FROM ${STORE_TABLES.recordViews} v
                 JOIN ${STORE_TABLES.records} r ON r.record_id = v.record_id
                 WHERE v.owner_id = ?
                 ORDER BY v.owner_ordinal`,
            )
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
    const ownerId = readString(row, "owner_id");
    const ownerOrdinal = readNumber(row, "owner_ordinal");
    assertNonEmptyString(ownerId, "stored owner_id");
    if (
        !Number.isSafeInteger(ownerOrdinal) ||
        ownerOrdinal < kernelProtocolConfig.append.firstOwnerOrdinal ||
        ownerOrdinal > kernelProtocolConfig.append.lastOwnerOrdinal
    ) {
        throw new TypeError("stored owner_ordinal is outside the configured ordinal range");
    }
    return Object.freeze({
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
