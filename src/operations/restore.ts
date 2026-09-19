import {
    linkSync,
    lstatSync,
    mkdirSync,
    realpathSync,
    renameSync,
    rmdirSync,
    rmSync,
    unlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { syncDirectory } from "../blob/directory-durability.ts";
import {
    backupProtocolConfig,
    kernelProtocolConfig,
    retentionProtocolConfig,
} from "../protocol/config.ts";
import { STORE_BACKUP_FAILURE_REASONS } from "../protocol/values.generated.ts";
import type { BlobStoreBackend } from "../storage/types.ts";
import { SQLiteTraceStore } from "../store/sqlite-trace-store.ts";
import { readOptionalBlobBackend } from "./backup.ts";
import {
    backupDigest,
    readBackupManifest,
    type TraceStoreBackupManifest,
} from "./backup-manifest.ts";
import {
    backupBlobSource,
    createStagingDirectory,
    removeStagingDirectory,
    type StagedStore,
    stageVerifiedStore,
} from "./backup-staging.ts";
import { TraceStoreBackupError } from "./errors.ts";

const [, , , , MANIFEST_MISMATCH, , , , INTEGRITY_FAILED, EXPORT_MISMATCH, TARGET_EXISTS] =
    STORE_BACKUP_FAILURE_REASONS;

/** Options for verifying one backup directory. */
export type TraceStoreBackupVerificationOptions = {
    /** Blob backend the backup was written to; defaults to the backup's blob directory. */
    readonly blobBackend?: BlobStoreBackend;
    /** When present, the manifest identity must equal it exactly. */
    readonly expectedManifestId?: string;
    /** Existing directory that holds the temporary verification copy; defaults to the OS temp. */
    readonly stagingDirectory?: string;
};

/** Result of a successful backup verification. */
export type TraceStoreBackupVerification = {
    /** Verified sealed manifest. */
    readonly manifest: TraceStoreBackupManifest;
    /** Store schema version after the verification copy was opened and forward-migrated. */
    readonly verified_store_schema_version: number;
};

/** Options for restoring one backup into a new store. */
export type TraceStoreRestoreOptions = {
    /** Blob backend the backup was written to; defaults to the backup's blob directory. */
    readonly blobBackend?: BlobStoreBackend;
    /** Exact manifest identity the operator chose to restore. */
    readonly expectedManifestId: string;
};

/** Result of a successful, verified restore. */
export type TraceStoreRestoreReceipt = {
    /** Number of restored blobs. */
    readonly blob_count: number;
    /** Configured digest of the restored store's native export, equal to the manifest's. */
    readonly export_digest: string;
    /** Restored manifest identity. */
    readonly manifest_id: string;
    /** Number of restored records, including the root witness. */
    readonly record_count: number;
    /** Store schema version recorded by the backup. */
    readonly source_store_schema_version: number;
    /** Store schema version of the restored store after forward migration. */
    readonly store_schema_version: number;
};

/**
 * Verifies a backup directory without modifying it.
 *
 * The manifest must exist, parse, and re-derive its identity (and equal `expectedManifestId` when
 * given). A private copy of the database must match the manifest digest, schema, counts, heads,
 * and blob set; every blob must be present and hash to its identifier; and the copy, opened as a
 * trace store with forward migrations, must pass `verifyIntegrity` and `verifyBlobs` and export
 * the digest the manifest records. The copy is removed afterwards.
 *
 * @param backupDirectory - Directory written by `backupTraceStore`.
 * @param options - Optional blob backend, expected identity, and staging parent.
 * @returns The verified manifest and the schema version the copy migrated to.
 * @throws {TraceStoreBackupError} With `manifest-missing` for an incomplete or interrupted backup
 * and the configured reason of any other failed check.
 * @throws {TypeError} If options are malformed.
 * @example
 * ```ts
 * const { manifest } = await verifyTraceStoreBackup("/backups/2026-09-18");
 * ```
 */
export async function verifyTraceStoreBackup(
    backupDirectory: string,
    options: TraceStoreBackupVerificationOptions = {},
): Promise<TraceStoreBackupVerification> {
    const request = readVerificationRequest(backupDirectory, options);
    const staging = createStagingDirectory(request.stagingDirectory);
    try {
        const staged = await stageVerifiedStore({
            backupRoot: request.root,
            blobSource: backupBlobSource(request.root, request.blobBackend),
            databaseName: backupProtocolConfig.layout.database,
            manifest: request.manifest,
            stagingRoot: staging,
        });
        return Object.freeze({
            manifest: request.manifest,
            verified_store_schema_version: staged.schemaVersion,
        });
    } finally {
        removeStagingDirectory(staging);
    }
}

/**
 * Restores one verified backup into a new trace store and verifies the result before reporting
 * success.
 *
 * Restore is non-destructive: it refuses when `targetPath`, its blob directory, or a SQLite
 * sidecar exists, and it requires the operator to name the exact manifest identity. The backup
 * is first staged in an owner-only directory beside the target and fully verified as by
 * `verifyTraceStoreBackup` (older store schemas are migrated forward there). The blob directory
 * is then moved into place and the database is hard-linked to `targetPath`, which fails rather
 * than replace a concurrently created file. Finally the target is reopened read-only and must
 * pass `verifyIntegrity`, `verifyBlobs`, and export the manifest's digest; only then does the
 * call resolve. A failure after publication leaves the target in place and rejects: such a
 * target must be discarded, never used.
 *
 * @param backupDirectory - Directory written by `backupTraceStore`.
 * @param targetPath - New trace-store database path; its parent must exist.
 * @param options - Exact expected manifest identity and optional blob backend.
 * @returns A frozen receipt of the verified restore.
 * @throws {TraceStoreBackupError} With `target-exists` when any target path exists,
 * `manifest-mismatch` when the identity differs, `integrity-failed` or `export-mismatch` when
 * the published target fails its final verification, or the reason of a failed staging check.
 * @throws {TypeError} If arguments are malformed.
 * @example
 * ```ts
 * await restoreTraceStoreBackup("/backups/2026-09-18", "/var/lib/app/trace.sqlite", {
 *     expectedManifestId: manifest.manifest_id,
 * });
 * ```
 */
export async function restoreTraceStoreBackup(
    backupDirectory: string,
    targetPath: string,
    options: TraceStoreRestoreOptions,
): Promise<TraceStoreRestoreReceipt> {
    if (options === null || typeof options !== "object") {
        throw new TypeError("restore options must be an object");
    }
    if (typeof options.expectedManifestId !== "string") {
        throw new TypeError("restore requires the expected manifest identity");
    }
    if (typeof targetPath !== "string" || targetPath.length === 0) {
        throw new TypeError("restore target must be a non-empty path");
    }
    const request = readVerificationRequest(backupDirectory, {
        ...options,
        stagingDirectory: path.dirname(path.resolve(targetPath)),
    });
    const target = path.join(realpathSync(request.stagingDirectory), path.basename(targetPath));
    const targetBlobDirectory = `${target}${kernelProtocolConfig.store.blobs.directorySuffix}`;
    assertTargetAbsent(target, targetBlobDirectory);
    const staging = createStagingDirectory(request.stagingDirectory);
    try {
        const staged = await stageVerifiedStore({
            backupRoot: request.root,
            blobSource: backupBlobSource(request.root, request.blobBackend),
            databaseName: path.basename(target),
            manifest: request.manifest,
            stagingRoot: staging,
        });
        publishStagedStore(staged, target, targetBlobDirectory);
    } finally {
        removeStagingDirectory(staging);
    }
    return verifyRestoredStore(target, request.manifest);
}

/**
 * Reopens a published restore target read-only and requires integrity, blob verification, and
 * the manifest's export digest.
 *
 * @throws {TraceStoreBackupError} With `integrity-failed` or `export-mismatch`.
 * @internal
 */
export function verifyRestoredStore(
    target: string,
    manifest: TraceStoreBackupManifest,
): TraceStoreRestoreReceipt {
    using restored = new SQLiteTraceStore(target, { readOnly: true });
    if (!restored.verifyIntegrity().ok || !restored.verifyBlobs().ok) {
        throw new TraceStoreBackupError(
            INTEGRITY_FAILED,
            "restored target failed integrity verification; discard it",
        );
    }
    if (backupDigest(restored.exportTrace()) !== manifest.export_digest) {
        throw new TraceStoreBackupError(
            EXPORT_MISMATCH,
            "restored target does not export the backed-up trace; discard it",
        );
    }
    return Object.freeze({
        blob_count: manifest.blobs.count,
        export_digest: manifest.export_digest,
        manifest_id: manifest.manifest_id,
        record_count: manifest.record_count,
        source_store_schema_version: manifest.store_schema_version,
        store_schema_version: restored.schemaVersion,
    });
}

function readVerificationRequest(
    backupDirectory: string,
    options: TraceStoreBackupVerificationOptions,
): {
    readonly blobBackend: BlobStoreBackend | undefined;
    readonly manifest: TraceStoreBackupManifest;
    readonly root: string;
    readonly stagingDirectory: string;
} {
    if (typeof backupDirectory !== "string" || backupDirectory.length === 0) {
        throw new TypeError("backup directory must be a non-empty path");
    }
    if (options === null || typeof options !== "object") {
        throw new TypeError("backup verification options must be an object");
    }
    const blobBackend = readOptionalBlobBackend(options.blobBackend);
    const root = path.resolve(backupDirectory);
    const manifest = readBackupManifest(root);
    if (
        options.expectedManifestId !== undefined &&
        options.expectedManifestId !== manifest.manifest_id
    ) {
        throw new TraceStoreBackupError(
            MANIFEST_MISMATCH,
            "backup manifest is not the expected identity",
        );
    }
    return {
        blobBackend,
        manifest,
        root: realpathSync(root),
        stagingDirectory: options.stagingDirectory ?? tmpdir(),
    };
}

function assertTargetAbsent(target: string, targetBlobDirectory: string): void {
    const occupied = [
        target,
        targetBlobDirectory,
        ...retentionProtocolConfig.storeFiles.sidecarSuffixes.map((suffix) => `${target}${suffix}`),
    ].some((candidate) => lstatSync(candidate, { throwIfNoEntry: false }) !== undefined);
    if (occupied) {
        throw new TraceStoreBackupError(
            TARGET_EXISTS,
            "restore target or its blob directory already exists; restore never overwrites",
        );
    }
}

/**
 * Moves a verified staged blob directory into place and hard-links the staged database to the
 * target, refusing rather than replacing any path created concurrently.
 *
 * @throws {TraceStoreBackupError} With `target-exists`.
 * @internal
 */
export function publishStagedStore(
    staged: Pick<StagedStore, "blobDirectory" | "databasePath">,
    target: string,
    targetBlobDirectory: string,
): void {
    try {
        mkdirSync(targetBlobDirectory, { mode: backupProtocolConfig.directoryMode });
    } catch (error) {
        throw new TraceStoreBackupError(TARGET_EXISTS, "restore target blob directory exists", {
            cause: error,
        });
    }
    try {
        renameSync(staged.blobDirectory, targetBlobDirectory);
    } catch (error) {
        try {
            // Only the empty directory created above is removed; anything a concurrent process
            // placed in it keeps the directory, which the next restore then refuses.
            rmdirSync(targetBlobDirectory);
            // A concurrent writer filling the directory between mkdir and rename cannot be injected.
            /* node:coverage ignore next */
        } catch {}
        throw new TraceStoreBackupError(
            TARGET_EXISTS,
            "restore target blob directory could not be published",
            { cause: error },
        );
    }
    try {
        linkSync(staged.databasePath, target);
    } catch (error) {
        rmSync(targetBlobDirectory, { force: true, recursive: true });
        throw new TraceStoreBackupError(TARGET_EXISTS, "restore target database exists", {
            cause: error,
        });
    }
    unlinkSync(staged.databasePath);
    syncDirectory(path.dirname(target));
}
