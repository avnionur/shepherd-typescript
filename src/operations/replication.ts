import { closeSync, fsyncSync, openSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { createBlobId } from "../blob/identity.ts";
import { backupProtocolConfig, retentionProtocolConfig } from "../protocol/config.ts";
import { STORE_BACKUP_FAILURE_REASONS } from "../protocol/values.generated.ts";
import { createFilesystemBlobStoreBackend } from "../storage/filesystem-blob-backend.ts";
import type {
    BlobStoreBackend,
    StorageCoordinator,
    StorageFence,
    StorageRefSwapResult,
} from "../storage/types.ts";
import type { BlobId } from "../store/types.ts";
import { readOptionalBlobBackend } from "./backup.ts";
import { parseBackupManifest, readBackupSnapshot } from "./backup-manifest.ts";
import {
    backupBlobSource,
    createOwnerOnlyDirectory,
    materializeBlobs,
    writeOwnerOnlyFileAtomically,
} from "./backup-staging.ts";
import { TraceStoreBackupError } from "./errors.ts";
import { type TraceStoreBackupVerification, verifyTraceStoreBackup } from "./restore.ts";

const [
    ,
    DESTINATION_EXISTS,
    MANIFEST_MISSING,
    MANIFEST_INVALID,
    MANIFEST_MISMATCH,
    ,
    DATABASE_MISMATCH,
] = STORE_BACKUP_FAILURE_REASONS;

/** Where `replicateTraceStoreBackup` copies a verified backup. */
export type TraceStoreBackupReplicationOptions = {
    /** Content-addressed backend that receives the database, manifest, and blob objects. */
    readonly backend: BlobStoreBackend;
    /** Coordinator holding the reference that names the replicated manifest. */
    readonly coordinator: StorageCoordinator;
    /** Generation the reference must have; `0` creates it. */
    readonly expectedGeneration: number;
    /** Optional lease fence the swap must hold. */
    readonly fence?: StorageFence;
    /** Reference name, matching the configured storage name grammar. */
    readonly refName: string;
    /** Blob backend the backup was written to; defaults to the backup's blob directory. */
    readonly sourceBlobBackend?: BlobStoreBackend;
};

/** Result of one backup replication. */
export type TraceStoreBackupReplica = {
    /** Content-addressed object holding the database copy. */
    readonly database_blob_id: BlobId;
    /** Content-addressed object holding the exact manifest bytes; the reference value. */
    readonly manifest_blob_id: BlobId;
    /** Replicated manifest identity. */
    readonly manifest_id: string;
    /** Reference compare-and-swap result; only `swapped` published the replica. */
    readonly swap: StorageRefSwapResult;
};

/** Where `fetchReplicatedTraceStoreBackup` materializes a replicated backup. */
export type TraceStoreBackupFetchOptions = {
    /** Backend holding the replicated objects. */
    readonly backend: BlobStoreBackend;
    /** Coordinator holding the reference. */
    readonly coordinator: StorageCoordinator;
    /** New local backup directory; it must not exist. */
    readonly destination: string;
    /** Reference that names the replicated manifest. */
    readonly refName: string;
};

/**
 * Copies one verified backup into a content-addressed backend and publishes it by reference
 * compare-and-swap.
 *
 * The backup is verified first. The database bytes, the exact manifest bytes, and every blob are
 * stored as content-addressed objects (existing equal objects are kept), and only then is
 * `refName` swapped from `expectedGeneration` to the manifest object's identifier. A conflict or
 * fence refusal is returned, not thrown; objects already stored stay and are content-addressed,
 * so a retry is safe.
 *
 * @param backupDirectory - Directory written by `backupTraceStore`.
 * @param options - Target backend, coordinator reference, expected generation, and source blobs.
 * @returns The replica object identities and the swap result.
 * @throws {TraceStoreBackupError} With the reason of the failed verification step, or with
 * `database-mismatch` or `manifest-mismatch` when the database or manifest file read for
 * replication is not the one that was verified.
 * @throws {TypeError} If options are malformed.
 * @throws {StorageAdapterError} If an adapter cannot honor its contract.
 */
export async function replicateTraceStoreBackup(
    backupDirectory: string,
    options: TraceStoreBackupReplicationOptions,
): Promise<TraceStoreBackupReplica> {
    if (options === null || typeof options !== "object") {
        throw new TypeError("replication options must be an object");
    }
    const backend = readRequiredBackend(options.backend);
    const sourceBlobBackend = readOptionalBlobBackend(options.sourceBlobBackend);
    const { manifest } = await verifyTraceStoreBackup(backupDirectory, {
        ...(sourceBlobBackend === undefined ? {} : { blobBackend: sourceBlobBackend }),
    });
    const root = path.resolve(backupDirectory);
    const layout = backupProtocolConfig.layout;
    const databaseBytes = readFileSync(path.join(root, layout.database));
    const manifestBytes = readFileSync(path.join(root, layout.manifest));
    const databaseBlobId = createBlobId(databaseBytes);
    const manifestBlobId = createBlobId(manifestBytes);
    // The files are read again after verification; replicate only the bytes that were verified.
    if (databaseBlobId !== manifest.database.digest) {
        throw new TraceStoreBackupError(
            DATABASE_MISMATCH,
            "backup database changed after verification",
        );
    }
    if (parseBackupManifest(manifestBytes.toString("utf8")).manifest_id !== manifest.manifest_id) {
        throw new TraceStoreBackupError(
            MANIFEST_MISMATCH,
            "backup manifest changed after verification",
        );
    }
    await materializeBlobs(
        readBackupSnapshot(path.join(root, layout.database)).blobIds,
        backupBlobSource(root, sourceBlobBackend),
        backend,
    );
    await backend.put(databaseBlobId, databaseBytes);
    await backend.put(manifestBlobId, manifestBytes);
    const swap = await options.coordinator.compareAndSwapRef(
        options.refName,
        options.expectedGeneration,
        manifestBlobId,
        ...(options.fence === undefined ? [] : [options.fence]),
    );
    return Object.freeze({
        database_blob_id: databaseBlobId,
        manifest_blob_id: manifestBlobId,
        manifest_id: manifest.manifest_id,
        swap,
    });
}

/**
 * Materializes the backup a coordinator reference names into a new local backup directory and
 * verifies it.
 *
 * The manifest object must hash to the reference value and parse; the database object is found
 * by the manifest's database digest; blobs are copied into the backup's blob directory; the
 * manifest is written last. The result is then verified exactly as by `verifyTraceStoreBackup`.
 *
 * @param options - Replica backend, coordinator reference, and new destination.
 * @returns The verification of the materialized backup.
 * @throws {TraceStoreBackupError} With `manifest-missing` when the reference or manifest object
 * is absent, `manifest-invalid` when the manifest object does not match the reference,
 * `destination-exists`, `database-mismatch`, or the reason of the failed verification step.
 * @throws {TypeError} If options are malformed.
 */
export async function fetchReplicatedTraceStoreBackup(
    options: TraceStoreBackupFetchOptions,
): Promise<TraceStoreBackupVerification> {
    if (options === null || typeof options !== "object") {
        throw new TypeError("fetch options must be an object");
    }
    const backend = readRequiredBackend(options.backend);
    if (typeof options.destination !== "string" || options.destination.length === 0) {
        throw new TypeError("fetch destination must be a non-empty path");
    }
    const ref = await options.coordinator.readRef(options.refName);
    const manifestBytes = ref === undefined ? undefined : await backend.get(ref.value as BlobId);
    if (ref === undefined || manifestBytes === undefined) {
        throw new TraceStoreBackupError(
            MANIFEST_MISSING,
            "replicated backup reference or manifest object is absent",
        );
    }
    if (createBlobId(manifestBytes) !== ref.value) {
        throw new TraceStoreBackupError(
            MANIFEST_INVALID,
            "replicated manifest object does not match its reference",
        );
    }
    const manifestText = Buffer.from(manifestBytes).toString("utf8");
    const manifest = parseBackupManifest(manifestText);
    const databaseBytes = await backend.get(manifest.database.digest as BlobId);
    if (databaseBytes === undefined) {
        throw new TraceStoreBackupError(DATABASE_MISMATCH, "replicated database object is absent");
    }
    const root = createOwnerOnlyDirectory(options.destination, DESTINATION_EXISTS);
    const layout = backupProtocolConfig.layout;
    const databasePath = path.join(root, layout.database);
    const descriptor = openSync(databasePath, "wx", retentionProtocolConfig.storeFiles.mode);
    try {
        writeFileSync(descriptor, databaseBytes);
        fsyncSync(descriptor);
    } finally {
        closeSync(descriptor);
    }
    await materializeBlobs(
        readBackupSnapshot(databasePath).blobIds,
        backend,
        createFilesystemBlobStoreBackend(path.join(root, layout.blobDirectory)),
    );
    writeOwnerOnlyFileAtomically(root, layout.manifest, manifestText);
    return verifyTraceStoreBackup(root, { expectedManifestId: manifest.manifest_id });
}

function readRequiredBackend(value: unknown): BlobStoreBackend {
    const backend = readOptionalBlobBackend(value);
    if (backend === undefined) {
        throw new TypeError("backend must be a blob-store backend");
    }
    return backend;
}
