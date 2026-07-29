import { DatabaseSync } from "node:sqlite";

import { canonicalizeRecord } from "../canonical/canonical-record.ts";
import { kernelProtocolConfig } from "../protocol/config.ts";
import { assertNonEmptyString, assertRecordId } from "../record/guards.ts";
import { createConfiguredRootWitness } from "../record/root-witness.ts";
import type { RecordId } from "../record/types.ts";
import { appendToTraceStore } from "./append.ts";
import { TraceStoreError } from "./errors.ts";
import { migrateTraceStore } from "./migrations.ts";
import { readOwnerRecords, readStoredRecord } from "./read.ts";
import type { AppendReceipt, OwnerRecord, RetainedRecord, StoreAppendRequest } from "./types.ts";

/**
 * Synchronous SQLite-backed content-addressed trace store.
 *
 * Construction opens the database, enables configured durability settings,
 * applies pending migrations, and ensures the configured root witness exists.
 *
 * @public
 */
export class SQLiteTraceStore implements Disposable {
    readonly #database: DatabaseSync;
    #closed = false;
    readonly #schemaVersion: number;

    /**
     * Opens or creates a trace-store database.
     *
     * @param databasePath - SQLite file path, or `:memory:` for an ephemeral store.
     * @throws {UnsupportedStoreSchemaError} If the database schema is newer than supported.
     *
     * @public
     */
    constructor(databasePath = ":memory:") {
        this.#database = new DatabaseSync(databasePath, {
            defensive: true,
            timeout: kernelProtocolConfig.store.busyTimeoutMilliseconds,
        });
        try {
            this.#database.exec(
                `PRAGMA foreign_keys = ${Number(kernelProtocolConfig.store.foreignKeys)}`,
            );
            this.#database.exec(`PRAGMA journal_mode = ${kernelProtocolConfig.store.journalMode}`);
            this.#database.exec(`PRAGMA synchronous = ${kernelProtocolConfig.store.synchronous}`);
            this.#schemaVersion = migrateTraceStore(this.#database);
            this.#ensureRootWitness();
        } catch (error) {
            this.#database.close();
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
                `INSERT OR IGNORE INTO records(
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
