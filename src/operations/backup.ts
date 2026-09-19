import path from "node:path";
import * as sqlite from "node:sqlite";

import { backupProtocolConfig, kernelProtocolConfig } from "../protocol/config.ts";
import {
    STORE_BACKUP_BLOB_LOCATIONS,
    STORE_BACKUP_FAILURE_REASONS,
} from "../protocol/values.generated.ts";
import { createFilesystemBlobStoreBackend } from "../storage/filesystem-blob-backend.ts";
import type { BlobStoreBackend } from "../storage/types.ts";
import { prepareOwnerOnlyDatabaseFile } from "../store/file-mode.ts";
import type { SQLiteTraceStore } from "../store/sqlite-trace-store.ts";
import {
    blobListDigest,
    encodeBackupManifest,
    readBackupSnapshot,
    readPackageVersion,
    sealBackupManifest,
    type TraceStoreBackupManifest,
} from "./backup-manifest.ts";
import {
    createOwnerOnlyDirectory,
    createStagingDirectory,
    materializeBlobs,
    removeStagingDirectory,
    resolveSQLiteBackup,
    stageVerifiedStore,
    writeOwnerOnlyFileAtomically,
} from "./backup-staging.ts";

const [, DESTINATION_EXISTS] = STORE_BACKUP_FAILURE_REASONS;
const [DIRECTORY_LOCATION, BACKEND_LOCATION] = STORE_BACKUP_BLOB_LOCATIONS;

/** Where and how `backupTraceStore` writes one backup. */
export type TraceStoreBackupOptions = {
    /**
     * New backup directory. Its parent must exist and the directory itself must not; it is created
     * owner-only and never reused.
     */
    readonly destination: string;
    /**
     * Optional content-addressed backend that receives the blob bytes instead of the backup
     * directory's blob directory. Verification and restore must then be given the same backend.
     */
    readonly blobBackend?: BlobStoreBackend;
};

/**
 * Writes one verified, self-describing backup of an open trace store.
 *
 * The database is copied online with `node:sqlite` `backup()` into an owner-only file, so the
 * copy is one consistent snapshot even while the store is in use; the copy is converted to a
 * self-contained rollback-journal file. Every blob the snapshot registers is then copied into the
 * backup's blob directory or `blobBackend`. The backup is proven before it is declared complete:
 * the copy is staged, opened as a trace store, and must pass `verifyIntegrity`, `verifyBlobs`, and
 * a native export whose digest the manifest records. The `shepherd.store.backup` v1 manifest is
 * written last, owner-only, through a temporary name and an atomic rename; a backup directory
 * without a manifest is incomplete and every verifier refuses it.
 *
 * Only this call's staging directory is removed on failure; a partial backup directory is left in
 * place for the operator to inspect and delete.
 *
 * @param store - Open trace store to back up; it may be read-only.
 * @param options - New destination directory and optional blob backend.
 * @returns The frozen sealed manifest; its `manifest_id` is the identity a restore must name.
 * @throws {TraceStoreBackupError} With `backup-unsupported` when the runtime lacks
 * `node:sqlite` `backup()`, `destination-exists` when the destination exists, `blob-mismatch`
 * when a registered blob cannot be read, or the reason of the failed verification step.
 * @throws {TraceStoreError} If the store is closed.
 * @throws {TypeError} If options are malformed.
 * @example
 * ```ts
 * const manifest = await backupTraceStore(store, { destination: "/backups/2026-09-18" });
 * console.log(manifest.manifest_id);
 * ```
 */
export async function backupTraceStore(
    store: SQLiteTraceStore,
    options: TraceStoreBackupOptions,
): Promise<TraceStoreBackupManifest> {
    const copy = resolveSQLiteBackup(sqlite);
    const { blobBackend, destination } = readBackupOptions(options);
    const root = createOwnerOnlyDirectory(destination, DESTINATION_EXISTS);
    const layout = backupProtocolConfig.layout;
    const databasePath = path.join(root, layout.database);
    prepareOwnerOnlyDatabaseFile(databasePath);
    await store.backupDatabase(databasePath, copy, backupProtocolConfig.limits.pagesPerStep);
    const database = new sqlite.DatabaseSync(databasePath, {
        defensive: kernelProtocolConfig.store.defensive,
    });
    try {
        database.exec(`PRAGMA journal_mode = ${backupProtocolConfig.databaseJournalMode}`);
    } finally {
        database.close();
    }
    const snapshot = readBackupSnapshot(databasePath);
    const backend =
        blobBackend ?? createFilesystemBlobStoreBackend(path.join(root, layout.blobDirectory));
    await materializeBlobs(
        snapshot.blobIds,
        { get: async (blobId) => store.readBlob(blobId) },
        backend,
    );
    const staging = createStagingDirectory(root);
    let staged: Awaited<ReturnType<typeof stageVerifiedStore>>;
    try {
        staged = await stageVerifiedStore({
            backupRoot: root,
            blobSource: backend,
            databaseName: layout.database,
            manifest: undefined,
            stagingRoot: staging,
        });
    } finally {
        removeStagingDirectory(staging);
    }
    const manifest = sealBackupManifest({
        archive_format: kernelProtocolConfig.interchange.format,
        archive_format_version: kernelProtocolConfig.interchange.formatVersion,
        backup_compatibility_version: backupProtocolConfig.compatibilityVersion,
        blobs: {
            byte_length: snapshot.blobByteLength,
            count: snapshot.blobIds.length,
            directory: layout.blobDirectory,
            list_digest: blobListDigest(snapshot.blobIds),
            location: blobBackend === undefined ? DIRECTORY_LOCATION : BACKEND_LOCATION,
        },
        cut_count: snapshot.cutCount,
        cut_heads: snapshot.heads,
        database: {
            byte_length: staged.database.byteLength,
            digest: staged.database.digest,
            file: layout.database,
        },
        export_digest: staged.exportDigest,
        format: backupProtocolConfig.manifest.format,
        format_version: backupProtocolConfig.manifest.formatVersion,
        package_version: readPackageVersion(),
        record_count: snapshot.recordCount,
        store_schema_version: snapshot.schemaVersion,
    });
    writeOwnerOnlyFileAtomically(root, layout.manifest, encodeBackupManifest(manifest));
    return manifest;
}

function readBackupOptions(options: TraceStoreBackupOptions): {
    readonly blobBackend: BlobStoreBackend | undefined;
    readonly destination: string;
} {
    if (options === null || typeof options !== "object") {
        throw new TypeError("backup options must be an object");
    }
    const { blobBackend, destination } = options;
    if (typeof destination !== "string" || destination.length === 0) {
        throw new TypeError("backup destination must be a non-empty path");
    }
    return { blobBackend: readOptionalBlobBackend(blobBackend), destination };
}

/**
 * Validates an optional caller-supplied blob backend.
 *
 * @throws {TypeError} If the value is not a blob-store backend.
 * @internal
 */
export function readOptionalBlobBackend(value: unknown): BlobStoreBackend | undefined {
    if (value === undefined) {
        return undefined;
    }
    const backend = value as Partial<BlobStoreBackend> | null;
    if (
        backend === null ||
        typeof backend !== "object" ||
        typeof backend.get !== "function" ||
        typeof backend.put !== "function"
    ) {
        throw new TypeError("blobBackend must be a blob-store backend");
    }
    return value as BlobStoreBackend;
}
