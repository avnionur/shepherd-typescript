import { createHash } from "node:crypto";
import { createReadStream, existsSync, lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { canonicalizeRecord, type SemanticRecord } from "../canonical/canonical-record.ts";
import { backupProtocolConfig, kernelProtocolConfig, recordIdConfig } from "../protocol/config.ts";
import { deepFreeze } from "../protocol/config-value-readers.ts";
import {
    STORE_BACKUP_BLOB_LOCATIONS,
    STORE_BACKUP_FAILURE_REASONS,
} from "../protocol/values.generated.ts";
import { STORE_TABLES } from "../store/constants.ts";
import type { BlobId } from "../store/types.ts";
import { TraceStoreBackupError } from "./errors.ts";

const [, , MANIFEST_MISSING, MANIFEST_INVALID, , SCHEMA_UNSUPPORTED, DATABASE_MISMATCH] =
    STORE_BACKUP_FAILURE_REASONS;

const SEMANTIC_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const MANIFEST_KEYS = [
    "archive_format",
    "archive_format_version",
    "backup_compatibility_version",
    "blobs",
    "cut_count",
    "cut_heads",
    "database",
    "export_digest",
    "format",
    "format_version",
    "manifest_id",
    "package_version",
    "record_count",
    "store_schema_version",
];

/**
 * Where a backup's blob bytes were written: the backup directory's configured blob directory or a
 * caller-supplied blob-store backend.
 */
export type TraceStoreBackupBlobLocation = (typeof STORE_BACKUP_BLOB_LOCATIONS)[number];

/** Latest owner-local occurrence of one owner in the backed-up snapshot. */
export type TraceStoreBackupHead = {
    /** Owner whose head this is. */
    readonly owner_id: string;
    /** Highest owner ordinal in the snapshot. */
    readonly owner_ordinal: number;
    /** Record occupying that ordinal. */
    readonly record_id: string;
};

/**
 * Store backup manifest `shepherd.store.backup` v1 (`store-backup-manifest-v1`).
 *
 * The manifest is written last, owner-only, through a temporary file and an atomic rename, so its
 * presence marks a complete backup. `manifest_id` is the configured digest of the canonical JSON
 * of every other member and is the identity a restore must name.
 */
export type TraceStoreBackupManifest = {
    /** Native archive format whose export digest the manifest records. */
    readonly archive_format: string;
    /** Native archive format version whose export digest the manifest records. */
    readonly archive_format_version: number;
    /** Configured backup compatibility namespace. */
    readonly backup_compatibility_version: string;
    /** Backed-up blob set. */
    readonly blobs: {
        /** Sum of every backed-up blob's byte length. */
        readonly byte_length: number;
        /** Number of registered blobs in the snapshot. */
        readonly count: number;
        /** Configured blob directory name inside the backup directory. */
        readonly directory: string;
        /** Configured digest of the newline-joined ascending blob identifiers. */
        readonly list_digest: string;
        /** Where the blob bytes were written. */
        readonly location: TraceStoreBackupBlobLocation;
    };
    /** Number of published cuts in the snapshot. */
    readonly cut_count: number;
    /** Latest occurrence of every owner, ordered by owner identity. */
    readonly cut_heads: readonly TraceStoreBackupHead[];
    /** Copied SQLite database file. */
    readonly database: {
        /** Byte length of the copied database file. */
        readonly byte_length: number;
        /** Configured digest of the copied database file bytes. */
        readonly digest: string;
        /** Configured database file name inside the backup directory. */
        readonly file: string;
    };
    /** Configured digest of the UTF-8 native archive exported from the verified copy. */
    readonly export_digest: string;
    /** Configured manifest format. */
    readonly format: string;
    /** Configured manifest format version. */
    readonly format_version: number;
    /** Configured digest of the canonical JSON of every other manifest member. */
    readonly manifest_id: string;
    /** Version of the package that wrote the backup. */
    readonly package_version: string;
    /** Number of retained records in the snapshot, including the root witness. */
    readonly record_count: number;
    /** Trace-store schema version of the copied database. */
    readonly store_schema_version: number;
};

/** Read-only facts of one copied database file. @internal */
export type BackupSnapshot = {
    readonly blobByteLength: number;
    readonly blobIds: readonly BlobId[];
    readonly cutCount: number;
    readonly heads: readonly TraceStoreBackupHead[];
    readonly recordCount: number;
    readonly schemaVersion: number;
};

/** Returns the configured backup digest of text or bytes. @internal */
export function backupDigest(content: string | Uint8Array): string {
    return `${backupProtocolConfig.digestPrefix}${createHash(backupProtocolConfig.digestAlgorithm).update(content).digest("hex")}`;
}

/** Streams one regular file through the configured backup digest. @internal */
export async function digestBackupFile(
    filePath: string,
): Promise<{ readonly byteLength: number; readonly digest: string }> {
    const hash = createHash(backupProtocolConfig.digestAlgorithm);
    let byteLength = 0;
    for await (const chunk of createReadStream(filePath)) {
        hash.update(chunk as Buffer);
        byteLength += (chunk as Buffer).byteLength;
    }
    return { byteLength, digest: `${backupProtocolConfig.digestPrefix}${hash.digest("hex")}` };
}

/** Returns the configured digest of an ascending blob-identifier list. @internal */
export function blobListDigest(blobIds: readonly BlobId[]): string {
    return backupDigest(blobIds.join("\n"));
}

/** Adds the content-derived identity to a manifest body and freezes it. @internal */
export function sealBackupManifest(
    body: Omit<TraceStoreBackupManifest, "manifest_id">,
): TraceStoreBackupManifest {
    const manifestId = backupDigest(canonicalizeRecord(body as unknown as SemanticRecord));
    return deepFreeze({ ...body, manifest_id: manifestId });
}

/** Encodes a sealed manifest as canonical JSON followed by a newline. @internal */
export function encodeBackupManifest(manifest: TraceStoreBackupManifest): string {
    return `${canonicalizeRecord(manifest as unknown as SemanticRecord)}\n`;
}

/**
 * Reads, validates, and re-derives the identity of one backup directory's manifest.
 *
 * @throws {TraceStoreBackupError} With `manifest-missing` when no manifest exists and
 * `manifest-invalid` when it is not a bounded regular file, not JSON, not the configured shape,
 * or its identity does not match its content.
 * @internal
 */
export function readBackupManifest(backupDirectory: string): TraceStoreBackupManifest {
    const manifestPath = path.join(backupDirectory, backupProtocolConfig.layout.manifest);
    const stats = lstatSync(manifestPath, { throwIfNoEntry: false });
    if (stats === undefined) {
        throw new TraceStoreBackupError(
            MANIFEST_MISSING,
            "backup has no manifest; it is incomplete or was interrupted",
        );
    }
    if (!stats.isFile() || stats.size > backupProtocolConfig.limits.maxManifestBytes) {
        throw new TraceStoreBackupError(
            MANIFEST_INVALID,
            "backup manifest is not a bounded regular file",
        );
    }
    return parseBackupManifest(readFileSync(manifestPath, "utf8"));
}

/**
 * Parses manifest text strictly and re-derives its identity.
 *
 * The text must be exactly the canonical encoding the writer produces, so repeated keys,
 * alternative spellings, and trailing content cannot make two readers see different manifests.
 *
 * @throws {TraceStoreBackupError} With `manifest-invalid` for any malformed, non-canonical, or
 * inconsistent input.
 * @internal
 */
export function parseBackupManifest(text: string): TraceStoreBackupManifest {
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch (error) {
        throw new TraceStoreBackupError(MANIFEST_INVALID, "backup manifest is not JSON", {
            cause: error,
        });
    }
    const manifest = readClosed(value, MANIFEST_KEYS, "manifest");
    const layout = backupProtocolConfig.layout;
    const blobs = readClosed(
        manifest.blobs,
        ["byte_length", "count", "directory", "list_digest", "location"],
        "blobs",
    );
    const database = readClosed(manifest.database, ["byte_length", "digest", "file"], "database");
    const location = STORE_BACKUP_BLOB_LOCATIONS.find((entry) => entry === blobs.location);
    if (
        manifest.format !== backupProtocolConfig.manifest.format ||
        manifest.format_version !== backupProtocolConfig.manifest.formatVersion ||
        manifest.backup_compatibility_version !== backupProtocolConfig.compatibilityVersion ||
        manifest.archive_format !== kernelProtocolConfig.interchange.format ||
        manifest.archive_format_version !== kernelProtocolConfig.interchange.formatVersion ||
        typeof manifest.package_version !== "string" ||
        !SEMANTIC_VERSION.test(manifest.package_version) ||
        !isCount(manifest.store_schema_version, 1) ||
        !isCount(manifest.record_count, 1) ||
        !isCount(manifest.cut_count, 0) ||
        !isDigest(manifest.export_digest) ||
        !isDigest(manifest.manifest_id) ||
        database.file !== layout.database ||
        !isCount(database.byte_length, 1) ||
        !isDigest(database.digest) ||
        blobs.directory !== layout.blobDirectory ||
        location === undefined ||
        !isCount(blobs.count, 0) ||
        !isCount(blobs.byte_length, 0) ||
        !isDigest(blobs.list_digest) ||
        !Array.isArray(manifest.cut_heads)
    ) {
        throw new TraceStoreBackupError(MANIFEST_INVALID, "backup manifest has an invalid field");
    }
    const cutHeads = manifest.cut_heads.map((entry: unknown) => {
        const head = readClosed(entry, ["owner_id", "owner_ordinal", "record_id"], "cut_heads");
        if (
            typeof head.owner_id !== "string" ||
            head.owner_id.length === 0 ||
            // Trace-store owner identities never contain surrogates (assertNonEmptyString).
            /[\uD800-\uDFFF]/u.test(head.owner_id) ||
            !isCount(head.owner_ordinal, 0) ||
            typeof head.record_id !== "string" ||
            !isRecordId(head.record_id)
        ) {
            throw new TraceStoreBackupError(
                MANIFEST_INVALID,
                "backup manifest has an invalid head",
            );
        }
        return {
            owner_id: head.owner_id,
            owner_ordinal: head.owner_ordinal,
            record_id: head.record_id,
        };
    });
    const sealed = sealBackupManifest({
        archive_format: manifest.archive_format,
        archive_format_version: manifest.archive_format_version,
        backup_compatibility_version: manifest.backup_compatibility_version,
        blobs: {
            byte_length: blobs.byte_length,
            count: blobs.count,
            directory: blobs.directory,
            list_digest: blobs.list_digest,
            location,
        },
        cut_count: manifest.cut_count,
        cut_heads: cutHeads,
        database: {
            byte_length: database.byte_length,
            digest: database.digest,
            file: database.file,
        },
        export_digest: manifest.export_digest,
        format: manifest.format,
        format_version: manifest.format_version,
        package_version: manifest.package_version,
        record_count: manifest.record_count,
        store_schema_version: manifest.store_schema_version,
    });
    if (sealed.manifest_id !== manifest.manifest_id) {
        throw new TraceStoreBackupError(
            MANIFEST_INVALID,
            "backup manifest identity does not match its content",
        );
    }
    if (text !== encodeBackupManifest(sealed)) {
        throw new TraceStoreBackupError(MANIFEST_INVALID, "backup manifest is not canonical");
    }
    return sealed;
}

/**
 * Reads the schema version, blob set, owner heads, and counts of one copied database without
 * modifying it.
 *
 * @throws {TraceStoreBackupError} With `database-mismatch` when the file is not a readable trace
 * store and `schema-unsupported` when its schema is newer than this package supports.
 * @internal
 */
export function readBackupSnapshot(databasePath: string): BackupSnapshot {
    let database: DatabaseSync;
    try {
        // Backup databases are untrusted input; open them with the store's defensive setting.
        database = new DatabaseSync(databasePath, {
            defensive: kernelProtocolConfig.store.defensive,
            readOnly: true,
        });
    } catch (error) {
        throw new TraceStoreBackupError(DATABASE_MISMATCH, "backup database is unreadable", {
            cause: error,
        });
    }
    let snapshot: BackupSnapshot;
    try {
        snapshot = querySnapshot(database);
    } catch (error) {
        database.close();
        if (error instanceof TraceStoreBackupError) {
            throw error;
        }
        throw new TraceStoreBackupError(DATABASE_MISMATCH, "backup database is not a trace store", {
            cause: error,
        });
    }
    database.close();
    return snapshot;
}

function querySnapshot(database: DatabaseSync): BackupSnapshot {
    const tables = STORE_TABLES;
    const schemaVersion = Number(
        database
            .prepare(`SELECT COALESCE(MAX(version), 0) AS version FROM ${tables.migrations}`)
            .get()?.version,
    );
    if (schemaVersion > kernelProtocolConfig.store.schemaVersion) {
        throw new TraceStoreBackupError(
            SCHEMA_UNSUPPORTED,
            `backup store schema ${schemaVersion} is newer than supported schema ${kernelProtocolConfig.store.schemaVersion}`,
        );
    }
    // Blobs and cuts arrived in later schemas; an older copy simply has none.
    const blobRows = hasTable(database, tables.blobs)
        ? database
              .prepare(`SELECT blob_id, byte_length FROM ${tables.blobs} ORDER BY blob_id`)
              .all()
        : [];
    const heads = database
        .prepare(
            `SELECT owner_id, owner_ordinal, record_id FROM ${tables.recordViews} AS view
                 WHERE owner_ordinal = (
                     SELECT MAX(owner_ordinal) FROM ${tables.recordViews}
                     WHERE owner_id = view.owner_id
                 )
                 ORDER BY owner_id`,
        )
        .all()
        .map((row) => ({
            owner_id: String(row.owner_id),
            owner_ordinal: Number(row.owner_ordinal),
            record_id: String(row.record_id),
        }));
    return {
        blobByteLength: blobRows.reduce((total, row) => total + Number(row.byte_length), 0),
        blobIds: blobRows.map((row) => String(row.blob_id)),
        cutCount: hasTable(database, tables.cuts) ? countRows(database, tables.cuts) : 0,
        heads,
        recordCount: countRows(database, tables.records),
        schemaVersion,
    };
}

function hasTable(database: DatabaseSync, table: string): boolean {
    return (
        database
            .prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?")
            .get(table) !== undefined
    );
}

/**
 * Reads the version of the nearest enclosing package manifest of this module.
 *
 * @throws {TypeError} If no package manifest with a semantic version encloses the module.
 * @internal
 */
export function readPackageVersion(moduleUrl: string = import.meta.url): string {
    let directory = path.dirname(fileURLToPath(moduleUrl));
    while (!existsSync(path.join(directory, "package.json"))) {
        const parent = path.dirname(directory);
        if (parent === directory) {
            throw new TypeError("package manifest is unavailable");
        }
        directory = parent;
    }
    const manifest: unknown = JSON.parse(
        readFileSync(path.join(directory, "package.json"), "utf8"),
    );
    const version = (manifest as { readonly version?: unknown } | null)?.version;
    if (typeof version !== "string" || !SEMANTIC_VERSION.test(version)) {
        throw new TypeError("package manifest has no semantic version");
    }
    return version;
}

function countRows(database: DatabaseSync, table: string): number {
    return Number(database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count);
}

function readClosed(
    value: unknown,
    keys: readonly string[],
    context: string,
): Record<string, unknown> {
    if (
        value === null ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        Object.keys(value).length !== keys.length ||
        keys.some((key) => !Object.hasOwn(value, key))
    ) {
        throw new TraceStoreBackupError(
            MANIFEST_INVALID,
            `backup manifest ${context} must contain exactly its configured members`,
        );
    }
    return value as Record<string, unknown>;
}

function isCount(value: unknown, minimum: number): value is number {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum;
}

function isDigest(value: unknown): value is string {
    const prefix = backupProtocolConfig.digestPrefix;
    const hexLength = createHash(backupProtocolConfig.digestAlgorithm).digest("hex").length;
    return (
        typeof value === "string" &&
        value.startsWith(prefix) &&
        new RegExp(`^[0-9a-f]{${hexLength}}$`, "u").test(value.slice(prefix.length))
    );
}

function isRecordId(value: string): boolean {
    return (
        value.startsWith(recordIdConfig.prefix) &&
        new RegExp(`^[0-9a-f]{${recordIdConfig.hexLength}}$`, "u").test(
            value.slice(recordIdConfig.prefix.length),
        )
    );
}
