import {
    chmodSync,
    closeSync,
    constants,
    copyFileSync,
    fsyncSync,
    lstatSync,
    mkdirSync,
    mkdtempSync,
    openSync,
    realpathSync,
    renameSync,
    writeFileSync,
} from "node:fs";
import path from "node:path";

import { syncDirectory } from "../blob/directory-durability.ts";
import { createBlobId } from "../blob/identity.ts";
import {
    backupProtocolConfig,
    kernelProtocolConfig,
    retentionProtocolConfig,
} from "../protocol/config.ts";
import { STORE_BACKUP_FAILURE_REASONS } from "../protocol/values.generated.ts";
import { removePathSync } from "../runtime/remove-path.ts";
import { createFilesystemBlobStoreBackend } from "../storage/filesystem-blob-backend.ts";
import type { BlobStoreBackend } from "../storage/types.ts";
import { type SQLiteDatabaseBackup, SQLiteTraceStore } from "../store/sqlite-trace-store.ts";
import type { BlobId } from "../store/types.ts";
import {
    type BackupSnapshot,
    backupDigest,
    blobListDigest,
    digestBackupFile,
    readBackupSnapshot,
    type TraceStoreBackupManifest,
} from "./backup-manifest.ts";
import { TraceStoreBackupError } from "./errors.ts";

const [
    BACKUP_UNSUPPORTED,
    ,
    ,
    MANIFEST_INVALID,
    ,
    ,
    DATABASE_MISMATCH,
    BLOB_MISMATCH,
    INTEGRITY_FAILED,
    EXPORT_MISMATCH,
] = STORE_BACKUP_FAILURE_REASONS;

/** A verified store copy in a staging directory. @internal */
export type StagedStore = {
    /** Staged database path. */
    readonly databasePath: string;
    /** Staged blob directory beside the database. */
    readonly blobDirectory: string;
    /** Digest and byte length of the copied database before it was opened. */
    readonly database: { readonly byteLength: number; readonly digest: string };
    /** Configured digest of the staged store's native export. */
    readonly exportDigest: string;
    /** Schema version after the staged store was opened and migrated. */
    readonly schemaVersion: number;
    /** Facts of the copied database before migration. */
    readonly snapshot: BackupSnapshot;
};

/**
 * Returns the runtime's online SQLite backup function.
 *
 * @param sqliteModule - The `node:sqlite` module namespace.
 * @throws {TraceStoreBackupError} With `backup-unsupported` when the runtime has no `backup`.
 * @internal
 */
export function resolveSQLiteBackup(sqliteModule: {
    readonly backup?: unknown;
}): SQLiteDatabaseBackup {
    if (typeof sqliteModule.backup !== "function") {
        throw new TraceStoreBackupError(
            BACKUP_UNSUPPORTED,
            "this Node.js runtime has no node:sqlite online backup",
        );
    }
    return sqliteModule.backup as SQLiteDatabaseBackup;
}

/**
 * Creates one new owner-only directory and returns its canonical path.
 *
 * @throws {TraceStoreBackupError} With `reason` when the path already exists.
 * @internal
 */
export function createOwnerOnlyDirectory(
    directoryPath: string,
    reason: TraceStoreBackupError["reason"],
): string {
    try {
        mkdirSync(directoryPath, { mode: backupProtocolConfig.directoryMode });
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") {
            throw new TraceStoreBackupError(reason, "refusing to write over an existing path", {
                cause: error,
            });
        }
        throw error;
    }
    chmodSync(directoryPath, backupProtocolConfig.directoryMode);
    syncDirectory(path.dirname(path.resolve(directoryPath)));
    return realpathSync(directoryPath);
}

/**
 * Writes one owner-only file through a temporary name, a flush, and an atomic rename.
 *
 * @internal
 */
export function writeOwnerOnlyFileAtomically(
    directory: string,
    name: string,
    content: string,
): void {
    const finalPath = path.join(directory, name);
    const temporaryPath = `${finalPath}${backupProtocolConfig.layout.temporarySuffix}`;
    const descriptor = openSync(temporaryPath, "wx", retentionProtocolConfig.storeFiles.mode);
    try {
        writeFileSync(descriptor, content);
        fsyncSync(descriptor);
    } finally {
        closeSync(descriptor);
    }
    renameSync(temporaryPath, finalPath);
    syncDirectory(directory);
}

/**
 * Returns the blob source a verification reads: the caller's backend, or the backup directory's
 * blob directory when it exists.
 *
 * @internal
 */
export function backupBlobSource(
    backupRoot: string,
    blobBackend: BlobStoreBackend | undefined,
): BlobStoreBackend | undefined {
    if (blobBackend !== undefined) {
        return blobBackend;
    }
    const directory = path.join(backupRoot, backupProtocolConfig.layout.blobDirectory);
    return lstatSync(directory, { throwIfNoEntry: false })?.isDirectory() === true
        ? createFilesystemBlobStoreBackend(directory)
        : undefined;
}

/**
 * Copies every listed blob from `source` into `target`, proving each identity first.
 *
 * @throws {TraceStoreBackupError} With `blob-mismatch` when a blob is absent, unreadable, or its
 * bytes do not hash to its identifier.
 * @internal
 */
export async function materializeBlobs(
    blobIds: readonly BlobId[],
    source: Pick<BlobStoreBackend, "get"> | undefined,
    target: BlobStoreBackend,
): Promise<void> {
    for (const blobId of blobIds) {
        let content: Uint8Array | undefined;
        try {
            content = await source?.get(blobId);
        } catch (error) {
            throw new TraceStoreBackupError(BLOB_MISMATCH, `backup blob ${blobId} is unreadable`, {
                cause: error,
            });
        }
        if (content === undefined || createBlobId(content) !== blobId) {
            throw new TraceStoreBackupError(
                BLOB_MISMATCH,
                `backup blob ${blobId} is missing or does not match its identifier`,
            );
        }
        await target.put(blobId, content);
    }
}

/**
 * Copies a backup database into a new owner-only staging directory, proves it against the
 * manifest, materializes its blobs, opens it as a writable trace store (applying forward
 * migrations), and requires integrity, blob verification, and an equal export digest.
 *
 * The caller owns the returned staging directory and must publish or remove it.
 *
 * @throws {TraceStoreBackupError} With the configured reason of the first failed check.
 * @internal
 */
export async function stageVerifiedStore(request: {
    readonly backupRoot: string;
    readonly blobSource: BlobStoreBackend | undefined;
    readonly databaseName: string;
    readonly manifest: TraceStoreBackupManifest | undefined;
    readonly stagingRoot: string;
}): Promise<StagedStore> {
    const { manifest } = request;
    const databasePath = path.join(request.stagingRoot, request.databaseName);
    const blobDirectory = `${databasePath}${kernelProtocolConfig.store.blobs.directorySuffix}`;
    try {
        copyFileSync(
            path.join(request.backupRoot, backupProtocolConfig.layout.database),
            databasePath,
            constants.COPYFILE_EXCL,
        );
    } catch (error) {
        throw new TraceStoreBackupError(DATABASE_MISMATCH, "backup database is unavailable", {
            cause: error,
        });
    }
    chmodSync(databasePath, retentionProtocolConfig.storeFiles.mode);
    const database = await digestBackupFile(databasePath);
    const snapshot = readBackupSnapshot(databasePath);
    if (manifest !== undefined) {
        assertSnapshotMatchesManifest(database, snapshot, manifest);
    }
    await materializeBlobs(
        snapshot.blobIds,
        request.blobSource,
        createFilesystemBlobStoreBackend(blobDirectory),
    );
    let exportDigest: string;
    let schemaVersion: number;
    try {
        using store = new SQLiteTraceStore(databasePath, { blobDirectory });
        if (!store.verifyIntegrity().ok || !store.verifyBlobs().ok) {
            throw new TraceStoreBackupError(
                INTEGRITY_FAILED,
                "restored store copy failed integrity verification",
            );
        }
        exportDigest = backupDigest(store.exportTrace());
        schemaVersion = store.schemaVersion;
    } catch (error) {
        if (error instanceof TraceStoreBackupError) {
            throw error;
        }
        throw new TraceStoreBackupError(
            INTEGRITY_FAILED,
            "restored store copy cannot be opened, verified, or exported",
            { cause: error },
        );
    }
    if (manifest !== undefined && exportDigest !== manifest.export_digest) {
        throw new TraceStoreBackupError(
            EXPORT_MISMATCH,
            "restored store copy does not export the backed-up trace",
        );
    }
    return { blobDirectory, database, databasePath, exportDigest, schemaVersion, snapshot };
}

function assertSnapshotMatchesManifest(
    database: { readonly byteLength: number; readonly digest: string },
    snapshot: BackupSnapshot,
    manifest: TraceStoreBackupManifest,
): void {
    if (
        database.digest !== manifest.database.digest ||
        database.byteLength !== manifest.database.byte_length
    ) {
        throw new TraceStoreBackupError(
            DATABASE_MISMATCH,
            "backup database bytes do not match the manifest",
        );
    }
    if (
        snapshot.schemaVersion !== manifest.store_schema_version ||
        snapshot.recordCount !== manifest.record_count ||
        snapshot.cutCount !== manifest.cut_count ||
        JSON.stringify(snapshot.heads) !== JSON.stringify(manifest.cut_heads)
    ) {
        throw new TraceStoreBackupError(
            MANIFEST_INVALID,
            "backup manifest does not describe its database",
        );
    }
    if (
        snapshot.blobIds.length !== manifest.blobs.count ||
        snapshot.blobByteLength !== manifest.blobs.byte_length ||
        blobListDigest(snapshot.blobIds) !== manifest.blobs.list_digest
    ) {
        throw new TraceStoreBackupError(
            BLOB_MISMATCH,
            "backup database blob set does not match the manifest",
        );
    }
}

/**
 * Creates one owner-only staging directory beneath `parent`.
 *
 * @internal
 */
export function createStagingDirectory(parent: string): string {
    const staging = mkdtempSync(path.join(parent, backupProtocolConfig.layout.stagingPrefix));
    chmodSync(staging, backupProtocolConfig.directoryMode);
    return realpathSync(staging);
}

/** Removes a staging directory this module created. @internal */
export function removeStagingDirectory(staging: string): void {
    removePathSync(staging, { force: true, recursive: true });
}
