import { DatabaseSync } from "node:sqlite";

import { BlobFilesystem } from "../blob/filesystem.ts";
import { canonicalizeRecord } from "../canonical/canonical-record.ts";
import { kernelProtocolConfig } from "../protocol/config.ts";
import { assertNonEmptyString, assertRecordId } from "../record/guards.ts";
import { createConfiguredRootWitness } from "../record/root-witness.ts";
import type { RecordId } from "../record/types.ts";
import { appendToTraceStore } from "./append.ts";
import { resolveBlobDirectory } from "./blob-options.ts";
import { putStoredBlob, readStoredBlob, verifyStoredBlobs } from "./blobs.ts";
import { DEFAULT_STORE_DATABASE_PATH, STORE_PRAGMA_SQL, STORE_TABLES } from "./constants.ts";
import { TraceStoreError } from "./errors.ts";
import { migrateTraceStore } from "./migrations.ts";
import { readOwnerRecords, readStoredRecord } from "./read.ts";
import type {
    AppendReceipt,
    BlobId,
    BlobIntegrityReport,
    BlobStorageReceipt,
    OwnerRecord,
    RetainedRecord,
    SQLiteTraceStoreOptions,
    StoreAppendRequest,
} from "./types.ts";

/**
 * Synchronous SQLite-backed content-addressed trace store.
 *
 * Construction opens the database, enables configured durability settings,
 * applies pending migrations, and ensures the configured root witness exists.
 *
 * @public
 */
export class SQLiteTraceStore implements Disposable {
    readonly #blobFilesystem: BlobFilesystem;
    readonly #cleanupBlobDirectory: () => void;
    readonly #database: DatabaseSync;
    #closed = false;
    readonly #schemaVersion: number;

    /**
     * Opens or creates a trace-store database.
     *
     * @param databasePath - SQLite file path, or `:memory:` for an ephemeral store.
     * @param options - Optional external blob-directory configuration.
     * @throws {UnsupportedStoreSchemaError} If the database schema is newer than supported.
     * @throws {TypeError} If options or the blob-directory shape are invalid.
     * @throws {Error} If SQLite or durable blob-directory setup fails.
     *
     * @public
     */
    constructor(databasePath = DEFAULT_STORE_DATABASE_PATH, options: SQLiteTraceStoreOptions = {}) {
        const blobDirectory = resolveBlobDirectory(databasePath, options);
        this.#cleanupBlobDirectory = blobDirectory.cleanup;
        let blobFilesystem: BlobFilesystem;
        let database: DatabaseSync;
        try {
            blobFilesystem = new BlobFilesystem(blobDirectory.path);
            database = new DatabaseSync(databasePath, {
                defensive: kernelProtocolConfig.store.defensive,
                timeout: kernelProtocolConfig.store.busyTimeoutMilliseconds,
            });
        } catch (error) {
            this.#cleanupBlobDirectory();
            throw error;
        }
        this.#blobFilesystem = blobFilesystem;
        this.#database = database;
        try {
            this.#database.exec(STORE_PRAGMA_SQL.foreignKeys);
            this.#database.exec(STORE_PRAGMA_SQL.journalMode);
            this.#database.exec(STORE_PRAGMA_SQL.synchronous);
            this.#schemaVersion = migrateTraceStore(this.#database);
            this.#ensureRootWitness();
        } catch (error) {
            this.#database.close();
            this.#cleanupBlobDirectory();
            throw error;
        }
    }

    /**
     * Current migrated storage-schema version.
     *
     * @public
     */
    get schemaVersion(): number {
        return this.#schemaVersion;
    }

    /**
     * Atomically commits or idempotently replays one semantic append request.
     *
     * @param request - Stable append intent and semantic batch.
     * @returns The original durable receipt for this intent and content.
     * @throws {AppendIntentConflictError} If the intent already names different content.
     * @throws {TraceStoreError} If witnesses are missing or the store is closed.
     * @throws {TypeError} If the request is malformed.
     * @throws {RangeError} If a causal parent is unknown or owner ordinals are exhausted.
     *
     * @public
     */
    append(request: StoreAppendRequest): AppendReceipt {
        this.#assertOpen();
        return appendToTraceStore(this.#database, request);
    }

    /**
     * Durably retains binary content and its storage receipt.
     *
     * Equal bytes are deduplicated by their configured content digest. Blob bytes become visible
     * only after a matching SQLite receipt commits.
     *
     * @param content - Binary content to retain.
     * @returns A frozen content identity and byte-length receipt.
     * @throws {BlobIntegrityError} If existing bytes or metadata disagree with the digest.
     * @throws {TraceStoreError} If the store is closed.
     * @throws {TypeError} If content is not a `Uint8Array`.
     *
     * @public
     */
    putBlob(content: Uint8Array): BlobStorageReceipt {
        this.#assertOpen();
        return putStoredBlob(this.#database, this.#blobFilesystem, content);
    }

    /**
     * Reads binary content after verifying its durable receipt and digest.
     *
     * @param blobId - Configured content-addressed blob identifier.
     * @returns A fresh byte array, or `undefined` when no durable receipt exists.
     * @throws {BlobIntegrityError} If retained bytes or metadata are missing or corrupt.
     * @throws {TraceStoreError} If the store is closed.
     * @throws {TypeError} If the blob identifier is malformed.
     *
     * @public
     */
    readBlob(blobId: BlobId): Uint8Array | undefined {
        this.#assertOpen();
        return readStoredBlob(this.#database, this.#blobFilesystem, blobId);
    }

    /**
     * Verifies every registered blob receipt and filesystem object.
     *
     * @returns A frozen report ordered by blob identifier.
     * @throws {TraceStoreError} If the store is closed.
     *
     * @public
     */
    verifyBlobs(): BlobIntegrityReport {
        this.#assertOpen();
        return verifyStoredBlobs(this.#database, this.#blobFilesystem);
    }

    /**
     * Reads one semantic record and every owner-local occurrence.
     *
     * @param recordId - Content-addressed record identifier.
     * @returns The retained record, or `undefined` when it is absent.
     * @throws {TraceStoreError} If the store is closed.
     * @throws {TypeError} If the record identifier is malformed.
     *
     * @public
     */
    readRecord(recordId: RecordId): RetainedRecord | undefined {
        this.#assertOpen();
        assertRecordId(recordId, "recordId");
        return readStoredRecord(this.#database, recordId);
    }

    /**
     * Reads one owner path in ascending ordinal order.
     *
     * @param ownerId - Stable trace-owner identifier.
     * @returns Frozen owner-local record occurrences.
     * @throws {TraceStoreError} If the store is closed.
     * @throws {TypeError} If the owner identifier is empty or malformed.
     *
     * @public
     */
    readOwner(ownerId: string): readonly OwnerRecord[] {
        this.#assertOpen();
        assertNonEmptyString(ownerId, "ownerId");
        return readOwnerRecords(this.#database, ownerId);
    }

    /**
     * Closes the SQLite connection. Repeated calls are harmless.
     *
     * @public
     */
    close(): void {
        if (!this.#closed) {
            this.#database.close();
            this.#closed = true;
            this.#cleanupBlobDirectory();
        }
    }

    /**
     * Closes the store when used with explicit resource management.
     *
     * @public
     */
    [Symbol.dispose](): void {
        this.close();
    }

    #assertOpen(): void {
        if (this.#closed) {
            throw new TraceStoreError("trace store is closed");
        }
    }

    #ensureRootWitness(): void {
        const { body, envelope } = createConfiguredRootWitness();
        this.#database
            .prepare(
                `INSERT OR IGNORE INTO ${STORE_TABLES.records}(
                    record_id, digest, schema_ref, mode, witness_ref, caused_by_json, body_json
                 ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
                envelope.record_id,
                envelope.digest,
                envelope.schema_ref,
                envelope.mode,
                envelope.witness_ref,
                "[]",
                canonicalizeRecord(body),
            );
        readStoredRecord(this.#database, envelope.record_id);
    }
}
