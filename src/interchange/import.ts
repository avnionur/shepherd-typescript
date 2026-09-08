import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { BlobFilesystem } from "../blob/filesystem.ts";
import { kernelProtocolConfig } from "../protocol/config.ts";
import { ROOT_WITNESS_ID } from "../record/root-witness.ts";
import { assertSQLiteDefensiveSupport } from "../runtime/sqlite.ts";
import { STORE_PRAGMA_SQL, STORE_TABLES, STORE_TRANSACTION_SQL } from "../store/constants.ts";
import { TraceStoreError } from "../store/errors.ts";
import { scanTraceStoreIntegrity, verifyTraceStoreIntegrity } from "../store/integrity.ts";
import { migrateTraceStore } from "../store/migrations.ts";
import { decodeTraceArchive } from "./decode.ts";
import { writeTraceArchive } from "./storage.ts";
import type { DecodedTraceArchive, TraceImportReceipt } from "./types.ts";

/** Validates and atomically imports one native archive into a pristine trace store. */
export function importTraceArchive(
    database: DatabaseSync,
    filesystem: BlobFilesystem,
    serialized: string,
): TraceImportReceipt {
    const archive = decodeTraceArchive(serialized);
    validateInStagingStore(archive);
    database.exec(STORE_TRANSACTION_SQL.begin);
    try {
        if (!scanTraceStoreIntegrity(database, filesystem).ok) {
            throw new TraceStoreError("trace archives require an intact target store");
        }
        assertPristineStore(database);
        writeTraceArchive(database, filesystem, archive, true);
        database.exec(STORE_TRANSACTION_SQL.commit);
    } catch (error) {
        database.exec(STORE_TRANSACTION_SQL.rollback);
        throw error;
    }
    return Object.freeze({
        imported_append_intent_count: archive.appendIntents.length,
        imported_blob_count: archive.blobs.length,
        imported_cut_count: archive.cuts.length,
        imported_record_count: archive.records.length,
        imported_record_view_count: archive.recordViews.length,
    });
}

function validateInStagingStore(archive: DecodedTraceArchive): void {
    assertSQLiteDefensiveSupport(kernelProtocolConfig.store.defensive);
    const directory = mkdtempSync(path.join(tmpdir(), "shepherd-import-stage-"));
    const database = new DatabaseSync(":memory:", {
        defensive: kernelProtocolConfig.store.defensive,
        timeout: kernelProtocolConfig.store.busyTimeoutMilliseconds,
    });
    try {
        database.exec(STORE_PRAGMA_SQL.foreignKeys);
        migrateTraceStore(database);
        const filesystem = new BlobFilesystem(realpathSync(directory));
        database.exec(STORE_TRANSACTION_SQL.begin);
        try {
            writeTraceArchive(database, filesystem, archive);
            database.exec(STORE_TRANSACTION_SQL.commit);
        } catch (error) {
            database.exec(STORE_TRANSACTION_SQL.rollback);
            throw error;
        }
        if (!verifyTraceStoreIntegrity(database, filesystem).ok) {
            throw new TypeError("trace archive failed retained-state verification");
        }
    } catch (error) {
        if (error instanceof TypeError) {
            throw error;
        }
        throw new TypeError("trace archive contains inconsistent retained state", { cause: error });
    } finally {
        database.close();
        rmSync(directory, { force: true, recursive: true });
    }
}

function assertPristineStore(database: DatabaseSync): void {
    const state = database
        .prepare(
            `SELECT
                (SELECT COUNT(*) FROM ${STORE_TABLES.records}) AS records,
                (SELECT COUNT(*) FROM ${STORE_TABLES.records}
                    WHERE record_id = ?) AS root_witnesses,
                (SELECT COUNT(*) FROM ${STORE_TABLES.recordViews}) AS record_views,
                (SELECT COUNT(*) FROM ${STORE_TABLES.appendIntents}) AS append_intents,
                (SELECT COUNT(*) FROM ${STORE_TABLES.cuts}) AS cuts,
                (SELECT COUNT(*) FROM ${STORE_TABLES.blobs}) AS blobs`,
        )
        .get(ROOT_WITNESS_ID) as Record<string, unknown>;
    if (
        state.records !== 1 ||
        state.root_witnesses !== 1 ||
        state.record_views !== 0 ||
        state.append_intents !== 0 ||
        state.cuts !== 0 ||
        state.blobs !== 0
    ) {
        throw new TraceStoreError("trace archives can only be imported into a pristine store");
    }
}
