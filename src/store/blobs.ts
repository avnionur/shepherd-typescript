import type { DatabaseSync } from "node:sqlite";

import type { BlobFilesystem } from "../blob/filesystem.ts";
import { assertBlobId, createBlobId } from "../blob/identity.ts";
import { BLOB_STORAGE_RECEIPT_VERSION, STORE_TABLES, STORE_TRANSACTION_SQL } from "./constants.ts";
import { BlobIntegrityError } from "./errors.ts";
import type {
    BlobId,
    BlobIntegrityIssue,
    BlobIntegrityReport,
    BlobStorageReceipt,
} from "./types.ts";

/** Retains bytes before atomically publishing their durable storage receipt. */
export function putStoredBlob(
    database: DatabaseSync,
    filesystem: BlobFilesystem,
    content: Uint8Array,
): BlobStorageReceipt {
    if (!(content instanceof Uint8Array)) {
        throw new TypeError("content must be a Uint8Array");
    }
    const snapshot = new Uint8Array(content);
    const blobId = createBlobId(snapshot);
    const { storageKey } = filesystem.put(blobId, snapshot);
    database.exec(STORE_TRANSACTION_SQL.begin);
    try {
        database
            .prepare(
                `INSERT OR IGNORE INTO ${STORE_TABLES.blobs}(blob_id, byte_length) VALUES (?, ?)`,
            )
            .run(blobId, snapshot.byteLength);
        database
            .prepare(
                `INSERT OR IGNORE INTO ${STORE_TABLES.storageReceipts}(
                    blob_id, storage_key, byte_length, receipt_version
                 ) VALUES (?, ?, ?, ?)`,
            )
            .run(blobId, storageKey, snapshot.byteLength, BLOB_STORAGE_RECEIPT_VERSION);
        assertReceiptRow(database, filesystem, blobId, snapshot.byteLength);
        database.exec(STORE_TRANSACTION_SQL.commit);
        return Object.freeze({ blob_id: blobId, byte_length: snapshot.byteLength });
    } catch (error) {
        database.exec(STORE_TRANSACTION_SQL.rollback);
        throw error;
    }
}

/** Reads bytes only when a valid durable storage receipt exists. */
export function readStoredBlob(
    database: DatabaseSync,
    filesystem: BlobFilesystem,
    blobId: BlobId,
): Uint8Array | undefined {
    assertBlobId(blobId, "blobId");
    const row = database
        .prepare(
            `SELECT
                EXISTS(
                    SELECT 1 FROM ${STORE_TABLES.blobs} WHERE blob_id = ?
                ) AS has_blob,
                EXISTS(
                    SELECT 1 FROM ${STORE_TABLES.storageReceipts} WHERE blob_id = ?
                ) AS has_receipt,
                (SELECT byte_length FROM ${STORE_TABLES.blobs} WHERE blob_id = ?) AS byte_length,
                (
                    SELECT storage_key FROM ${STORE_TABLES.storageReceipts} WHERE blob_id = ?
                ) AS storage_key,
                (
                    SELECT byte_length FROM ${STORE_TABLES.storageReceipts} WHERE blob_id = ?
                ) AS receipt_byte_length,
                (
                    SELECT receipt_version
                    FROM ${STORE_TABLES.storageReceipts}
                    WHERE blob_id = ?
                ) AS receipt_version`,
        )
        .get(blobId, blobId, blobId, blobId, blobId, blobId) as Record<string, unknown>;
    const hasBlob = row.has_blob === 1;
    const hasReceipt = row.has_receipt === 1;
    if (!hasBlob && !hasReceipt) {
        return undefined;
    }
    if (!hasBlob || !hasReceipt) {
        throw new BlobIntegrityError(`blob ${blobId} has incomplete storage receipt metadata`);
    }
    const byteLength = readReceiptRow(row, filesystem, blobId);
    const content = filesystem.read(blobId, byteLength);
    if (content === undefined) {
        throw new BlobIntegrityError(`blob ${blobId} is missing despite its storage receipt`);
    }
    return content;
}

/** Verifies every registered blob receipt and filesystem object. */
export function verifyStoredBlobs(
    database: DatabaseSync,
    filesystem: BlobFilesystem,
): BlobIntegrityReport {
    const rows = database
        .prepare(
            `SELECT b.blob_id, b.blob_id AS registered_blob_id, b.byte_length, r.storage_key,
                    r.byte_length AS receipt_byte_length, r.receipt_version
             FROM ${STORE_TABLES.blobs} b
             LEFT JOIN ${STORE_TABLES.storageReceipts} r ON r.blob_id = b.blob_id
             UNION ALL
             SELECT r.blob_id, NULL AS registered_blob_id, NULL AS byte_length, r.storage_key,
                    r.byte_length AS receipt_byte_length, r.receipt_version
             FROM ${STORE_TABLES.storageReceipts} r
             LEFT JOIN ${STORE_TABLES.blobs} b ON b.blob_id = r.blob_id
             WHERE b.blob_id IS NULL
             ORDER BY 1`,
        )
        .all();
    const issues: BlobIntegrityIssue[] = [];
    for (const row of rows) {
        const blobId = String(row.blob_id);
        try {
            assertBlobId(blobId, "stored blob_id");
            if (row.registered_blob_id === null) {
                throw new BlobIntegrityError(`blob ${blobId} has a receipt without metadata`);
            }
            const byteLength = readReceiptRow(row, filesystem, blobId);
            const kind = filesystem.verify(blobId, byteLength);
            if (kind !== undefined) {
                issues.push(Object.freeze({ blob_id: blobId, kind }));
            }
        } catch (error) {
            if (!(error instanceof TypeError || error instanceof BlobIntegrityError)) {
                throw error;
            }
            issues.push(Object.freeze({ blob_id: blobId, kind: "receipt_mismatch" }));
        }
    }
    return Object.freeze({
        checked_blob_count: rows.length,
        issues: Object.freeze(issues),
        ok: issues.length === 0,
    });
}

function assertReceiptRow(
    database: DatabaseSync,
    filesystem: BlobFilesystem,
    blobId: BlobId,
    expectedByteLength: number,
): void {
    const row = database
        .prepare(
            `SELECT b.byte_length, r.storage_key, r.byte_length AS receipt_byte_length,
                    r.receipt_version
             FROM ${STORE_TABLES.blobs} b
             JOIN ${STORE_TABLES.storageReceipts} r ON r.blob_id = b.blob_id
             WHERE b.blob_id = ?`,
        )
        .get(blobId);
    if (readReceiptRow(row as Record<string, unknown>, filesystem, blobId) !== expectedByteLength) {
        throw new BlobIntegrityError(`blob ${blobId} has an inconsistent storage receipt`);
    }
}

function readReceiptRow(
    row: Record<string, unknown>,
    filesystem: BlobFilesystem,
    blobId: BlobId,
): number {
    const byteLength = Number(row.byte_length);
    if (
        !Number.isSafeInteger(byteLength) ||
        byteLength < 0 ||
        Number(row.receipt_byte_length) !== byteLength ||
        Number(row.receipt_version) !== BLOB_STORAGE_RECEIPT_VERSION ||
        row.storage_key !== filesystem.storageKey(blobId)
    ) {
        throw new BlobIntegrityError(`blob ${blobId} has an inconsistent storage receipt`);
    }
    return byteLength;
}
