import { DatabaseSync } from "node:sqlite";

import { BlobFilesystem } from "../blob/filesystem.ts";
import { canonicalizeRecord } from "../canonical/canonical-record.ts";
import { exportTraceArchive } from "../interchange/export.ts";
import { importTraceArchive } from "../interchange/import.ts";
import type { TraceImportReceipt } from "../interchange/types.ts";
import { historyProjectionReadOptions } from "../projection/compatibility.ts";
import { projectExecution } from "../projection/execution.ts";
import { projectEffectiveHistory } from "../projection/history.ts";
import { activeExecutionRelations, projectExecutionRelations } from "../projection/relations.ts";
import type { EffectiveHistory, Execution } from "../projection/types.ts";
import { kernelProtocolConfig } from "../protocol/config.ts";
import { assertNonEmptyString, assertRecordId } from "../record/guards.ts";
import { createConfiguredRootWitness } from "../record/root-witness.ts";
import type { RecordId } from "../record/types.ts";
import { appendToTraceStore } from "./append.ts";
import { diagnoseStoredAppend } from "./append-recovery.ts";
import { resolveBlobDirectory } from "./blob-options.ts";
import { collectStoredBlobOrphans } from "./blob-orphans.ts";
import { putStoredBlob, readStoredBlob, verifyStoredBlobs } from "./blobs.ts";
import { DEFAULT_STORE_DATABASE_PATH, STORE_PRAGMA_SQL, STORE_TABLES } from "./constants.ts";
import { publishStoredCut, readStoredCut } from "./cuts.ts";
import { TraceStoreError } from "./errors.ts";
import { verifyTraceStoreIntegrity } from "./integrity.ts";
import type { AppendRecoveryDiagnostic, TraceIntegrityReport } from "./integrity-types.ts";
import { migrateTraceStore } from "./migrations.ts";
import { readOwnerRecords, readStoredRecord } from "./read.ts";
import { readCausalClosureSlice, readOwnerPrefixSlice } from "./slices.ts";
import type {
    AppendReceipt,
    BlobId,
    BlobIntegrityReport,
    BlobOrphanCollectionOptions,
    BlobOrphanCollectionReport,
    BlobStorageReceipt,
    CausalClosureOptions,
    Cut,
    CutId,
    CutSpec,
    OwnerRecord,
    RetainedRecord,
    Slice,
    SliceReadOptions,
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
     * Diagnoses whether an append intent is committed, retryable, or corrupt.
     *
     * The diagnosis is read-only. A missing intent is safe to retry, a consistent retained
     * receipt is committed, and inconsistent retained evidence requires manual recovery.
     *
     * @param appendIntentId - Stable append intent to inspect.
     * @returns A frozen recovery diagnosis.
     * @throws {TraceStoreError} If the store is closed.
     * @throws {TypeError} If the append intent is empty.
     *
     * @example
     * ```ts
     * const diagnosis = store.diagnoseAppend("append:task:1");
     * if (diagnosis.status === "manual_recovery_required") {
     *     console.error(diagnosis.issue);
     * }
     * ```
     *
     * @public
     */
    diagnoseAppend(appendIntentId: string): AppendRecoveryDiagnostic {
        this.#assertOpen();
        return diagnoseStoredAppend(this.#database, appendIntentId);
    }

    /**
     * Verifies every retained store area and returns classified diagnostics.
     *
     * The scan is read-only and includes SQLite integrity, canonical records, append receipts,
     * published cuts, owner paths, and registered external blobs.
     *
     * @returns A frozen whole-store integrity report.
     * @throws {TraceStoreError} If the store is closed.
     * @throws {Error} If SQLite cannot perform the diagnostic scan.
     *
     * @example
     * ```ts
     * const report = store.verifyIntegrity();
     * if (!report.ok) {
     *     console.error(report.issues);
     * }
     * ```
     *
     * @public
     */
    verifyIntegrity(): TraceIntegrityReport {
        this.#assertOpen();
        return verifyTraceStoreIntegrity(this.#database, this.#blobFilesystem);
    }

    /**
     * Exports every verified retained record, view, intent, cut, and blob.
     *
     * @returns Deterministic JSON using the configured native trace-archive format.
     * @throws {TraceStoreError} If the store is closed or fails integrity verification.
     * @throws {Error} If SQLite or blob storage cannot complete the read-only export.
     *
     * @example
     * ```ts
     * const archiveJson = store.exportTrace();
     * const parsedArchive = JSON.parse(archiveJson);
     * ```
     *
     * @public
     */
    exportTrace(): string {
        this.#assertOpen();
        return exportTraceArchive(this.#database, this.#blobFilesystem);
    }

    /**
     * Imports a complete native trace archive into a pristine store.
     *
     * The archive is fully staged and verified before one SQLite transaction publishes its
     * retained state. Semantic record identities and owner ordinals are preserved exactly.
     *
     * @param archiveJson - Versioned native archive JSON returned by `exportTrace()`.
     * @returns Frozen counts for every imported retained-state area.
     * @throws {TraceStoreError} If the store is closed or is not pristine.
     * @throws {TypeError} If the archive is malformed, incompatible, or internally inconsistent.
     * @throws {Error} If SQLite or blob storage cannot publish the validated archive.
     *
     * @example
     * ```ts
     * const receipt = targetStore.importTrace(sourceStore.exportTrace());
     * console.log(receipt.imported_record_count);
     * ```
     *
     * @public
     */
    importTrace(archiveJson: string): TraceImportReceipt {
        this.#assertOpen();
        return importTraceArchive(this.#database, this.#blobFilesystem, archiveJson);
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
     * Inspects or deletes filesystem objects that have no durable blob registration.
     *
     * Collection holds the configured store write lock, first verifies every registered blob,
     * and never removes registered content. Inspection is the configured default.
     *
     * @param options - Optional configured collection mode.
     * @returns A frozen report of discovered and deleted objects.
     * @throws {BlobIntegrityError} If registered content is corrupt or storage is unsafe.
     * @throws {TraceStoreError} If the store is closed.
     * @throws {TypeError} If options are malformed or select an unsupported mode.
     * @throws {Error} If SQLite or the filesystem cannot complete collection.
     *
     * @example
     * ```ts
     * const inspection = store.collectBlobOrphans();
     * if (inspection.orphan_blob_ids.length > 0) {
     *     store.collectBlobOrphans({ mode: "delete" });
     * }
     * ```
     *
     * @public
     */
    collectBlobOrphans(options: BlobOrphanCollectionOptions = {}): BlobOrphanCollectionReport {
        this.#assertOpen();
        return collectStoredBlobOrphans(this.#database, this.#blobFilesystem, options);
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
     * Publishes an immutable address through one retained owner-path occurrence.
     *
     * Publication appends a semantic cut record and its resolver index atomically.
     *
     * @param spec - Closed cut publication request.
     * @returns The durable cut address.
     * @throws {TraceStoreError} If the target occurrence is absent or the store is closed.
     * @throws {TypeError} If the request is malformed.
     *
     * @public
     */
    publishCut(spec: CutSpec): Cut {
        this.#assertOpen();
        return publishStoredCut(this.#database, spec);
    }

    /**
     * Reads and verifies one published cut.
     *
     * @param cutId - Stable published cut identifier.
     * @returns The verified durable cut.
     * @throws {TraceStoreError} If the cut is absent, corrupt, or the store is closed.
     * @throws {TypeError} If the identifier is malformed.
     *
     * @public
     */
    readCut(cutId: CutId): Cut {
        this.#assertOpen();
        return readStoredCut(this.#database, cutId);
    }

    /**
     * Reads an owner path through an inclusive ordinal.
     *
     * @param ownerId - Stable trace-owner identifier.
     * @param through - Inclusive owner ordinal.
     * @param options - Mode and visibility selection.
     * @returns An immutable graph-shaped slice.
     * @throws {TraceStoreError} If retained owner-path evidence is corrupt or the store is closed.
     * @throws {TypeError} If the owner, ordinal, or options are malformed.
     *
     * @public
     */
    readOwnerPrefix(ownerId: string, through: number, options: SliceReadOptions = {}): Slice {
        this.#assertOpen();
        return readOwnerPrefixSlice(this.#database, ownerId, through, options);
    }

    /**
     * Resolves a published cut without including later owner-path records.
     *
     * @param cutId - Stable published cut identifier.
     * @param options - Mode and visibility selection.
     * @returns An immutable graph-shaped slice addressed by the cut.
     * @throws {TraceStoreError} If the cut is absent, corrupt, or the store is closed.
     * @throws {TypeError} If the cut identifier or options are malformed.
     *
     * @public
     */
    resolveCut(cutId: CutId, options: SliceReadOptions = {}): Slice {
        this.#assertOpen();
        const cut = readStoredCut(this.#database, cutId);
        return readOwnerPrefixSlice(
            this.#database,
            cut.target_owner_id,
            cut.through_owner_ordinal,
            options,
            cut,
        );
    }

    /**
     * Projects one execution lifecycle at an immutable published cut.
     *
     * @param cutId - Cut addressing the execution owner prefix.
     * @returns A frozen, reproducible execution value.
     * @throws {ProjectionCompatibilityError} If configured projection requirements cannot be met.
     * @throws {TraceStoreError} If retained cut or lifecycle evidence is absent or corrupt.
     * @throws {TypeError} If the cut identifier is malformed.
     *
     * @public
     */
    projectExecution(cutId: CutId): Execution {
        this.#assertOpen();
        const cut = readStoredCut(this.#database, cutId);
        const slice = readOwnerPrefixSlice(
            this.#database,
            cut.target_owner_id,
            cut.through_owner_ordinal,
            historyProjectionReadOptions(),
            cut,
        );
        return projectExecution(slice, cut.target_owner_id, cut);
    }

    /**
     * Projects effective execution history at immutable root and child cuts.
     *
     * Active child relations resolve their published child cuts. Abandoned relations remain
     * visible in retained history but do not select an effective child.
     *
     * @param cutId - Cut addressing the root execution owner prefix.
     * @returns Frozen root, relation, child, and parent-publication projections.
     * @throws {ProjectionCompatibilityError} If configured projection requirements cannot be met.
     * @throws {TraceStoreError} If a required cut or retained record is absent or corrupt.
     * @throws {TypeError} If the cut identifier is malformed.
     *
     * @public
     */
    projectEffectiveHistory(cutId: CutId): EffectiveHistory {
        this.#assertOpen();
        const rootCut = readStoredCut(this.#database, cutId);
        const rootSlice = readOwnerPrefixSlice(
            this.#database,
            rootCut.target_owner_id,
            rootCut.through_owner_ordinal,
            historyProjectionReadOptions(),
            rootCut,
        );
        const relations = projectExecutionRelations(rootSlice, rootCut.target_owner_id);
        const childSlices = activeExecutionRelations(relations).flatMap((relation) =>
            relation.child_cut_id === null
                ? []
                : [this.resolveCut(relation.child_cut_id, historyProjectionReadOptions())],
        );
        return projectEffectiveHistory(rootSlice, rootCut.target_owner_id, childSlices);
    }

    /**
     * Reads the transitive causal closure of one or more retained root records.
     *
     * Causal traversal occurs before mode filtering. Direct omitted parents become anchors under
     * the configured default policy, and witness support is closed independently to the root.
     *
     * @param rootRecordIds - Records from which causal traversal begins.
     * @param options - Mode, visibility, and anchor policy.
     * @returns An immutable graph-shaped slice.
     * @throws {TraceStoreError} If a root, parent, or witness is absent or corrupt.
     * @throws {TypeError} If the request options or identifiers are malformed.
     *
     * @public
     */
    readCausalClosure(
        rootRecordIds: readonly RecordId[],
        options: CausalClosureOptions = {},
    ): Slice {
        this.#assertOpen();
        return readCausalClosureSlice(this.#database, rootRecordIds, options);
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
