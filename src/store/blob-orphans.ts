import type { DatabaseSync } from "node:sqlite";

import type { BlobFilesystem } from "../blob/filesystem.ts";
import { deleteBlobOrphans, findBlobOrphans } from "../blob/orphans.ts";
import { kernelProtocolConfig } from "../protocol/config.ts";
import { verifyStoredBlobs } from "./blobs.ts";
import { STORE_TABLES, STORE_TRANSACTION_SQL } from "./constants.ts";
import { BlobIntegrityError } from "./errors.ts";
import type {
    BlobId,
    BlobOrphanCollectionMode,
    BlobOrphanCollectionOptions,
    BlobOrphanCollectionReport,
} from "./types.ts";

/**
 * Finds or deletes unregistered blob objects under one serialized store lock.
 *
 * @param database - Open trace-store database.
 * @param filesystem - Blob filesystem paired with the database.
 * @param options - Validated-at-entry collection request.
 * @returns Frozen discovery and deletion report.
 * @throws {BlobIntegrityError} If retained content or the store layout is unsafe.
 * @throws {TypeError} If collection options are malformed.
 * @throws {Error} If SQLite or filesystem maintenance fails.
 *
 * @internal
 */
export function collectStoredBlobOrphans(
    database: DatabaseSync,
    filesystem: BlobFilesystem,
    options: BlobOrphanCollectionOptions,
): BlobOrphanCollectionReport {
    const mode = normalizeCollectionMode(options);
    database.exec(STORE_TRANSACTION_SQL.begin);
    try {
        if (!verifyStoredBlobs(database, filesystem).ok) {
            throw new BlobIntegrityError(
                "registered blobs must pass integrity verification before orphan collection",
            );
        }
        const retainedBlobIds = new Set(
            database
                .prepare(`SELECT blob_id FROM ${STORE_TABLES.blobs} ORDER BY blob_id`)
                .all()
                .map((row) => String(row.blob_id)),
        ) as Set<BlobId>;
        const candidates = findBlobOrphans(filesystem.rootPath(), retainedBlobIds);
        if (mode === "delete") {
            deleteBlobOrphans(filesystem.rootPath(), candidates);
        }
        database.exec(STORE_TRANSACTION_SQL.commit);
        return Object.freeze({
            deleted_blob_ids: Object.freeze(mode === "delete" ? [...candidates.blobIds] : []),
            deleted_temporary_file_count:
                mode === "delete" ? candidates.temporaryStorageKeys.length : 0,
            mode,
            orphan_blob_ids: candidates.blobIds,
            orphan_temporary_file_count: candidates.temporaryStorageKeys.length,
        });
    } catch (error) {
        database.exec(STORE_TRANSACTION_SQL.rollback);
        throw error;
    }
}

function normalizeCollectionMode(options: BlobOrphanCollectionOptions): BlobOrphanCollectionMode {
    if (
        options === null ||
        typeof options !== "object" ||
        Array.isArray(options) ||
        (Object.getPrototypeOf(options) !== Object.prototype &&
            Object.getPrototypeOf(options) !== null) ||
        Object.getOwnPropertySymbols(options).length > 0
    ) {
        throw new TypeError("blob orphan collection options must be a plain object");
    }
    const descriptors = Object.getOwnPropertyDescriptors(options);
    if (Object.keys(descriptors).some((key) => key !== "mode")) {
        throw new TypeError("blob orphan collection options contain an unsupported property");
    }
    const modeDescriptor = descriptors.mode;
    if (modeDescriptor !== undefined && !("value" in modeDescriptor)) {
        throw new TypeError("blob orphan collection mode must not be an accessor property");
    }
    const mode = modeDescriptor?.value ?? kernelProtocolConfig.store.blobs.defaultCollectionMode;
    if (
        typeof mode !== "string" ||
        !kernelProtocolConfig.store.blobs.collectionModes.includes(mode)
    ) {
        throw new TypeError("blob orphan collection mode must be configured");
    }
    return mode as BlobOrphanCollectionMode;
}
