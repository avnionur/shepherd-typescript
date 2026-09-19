import type { DatabaseSync } from "node:sqlite";

import type { BlobFilesystem } from "../blob/filesystem.ts";
import { rollbackFailedTransaction } from "../runtime/sqlite-transaction.ts";
import { diagnoseStoredAppend } from "./append-recovery.ts";
import { verifyStoredBlobs } from "./blobs.ts";
import { STORE_READ_TRANSACTION_SQL, STORE_TABLES } from "./constants.ts";
import { readStoredCut } from "./cuts.ts";
import { addIntegrityIssue } from "./integrity-issues.ts";
import { readOrphanedAppendIntentIds, verifyOwnerOrdinalIntegrity } from "./integrity-owners.ts";
import { verifyRecordIntegrity } from "./integrity-records.ts";
import type { TraceIntegrityIssue, TraceIntegrityReport } from "./integrity-types.ts";
import { readReplaySessionIds, verifyReplaySessionRow } from "./replay-sessions.ts";
import { verifyScopeRegistrationRow } from "./scope-integrity.ts";
import { readScopeRegistrationRows } from "./scope-registrations.ts";
import { readSupervisedDispatchIds, verifySupervisedDispatchRow } from "./supervised-dispatches.ts";
import { readTraceSubscriptionIds, verifyTraceSubscriptionRow } from "./trace-subscriptions.ts";

/** Verifies every currently retained trace-store area without modifying it. */
export function verifyTraceStoreIntegrity(
    database: DatabaseSync,
    filesystem: BlobFilesystem,
): TraceIntegrityReport {
    database.exec(STORE_READ_TRANSACTION_SQL.begin);
    try {
        const report = scanTraceStoreIntegrity(database, filesystem);
        database.exec(STORE_READ_TRANSACTION_SQL.commit);
        return report;
    } catch (error) {
        rollbackFailedTransaction(database, STORE_READ_TRANSACTION_SQL.rollback);
        throw error;
    }
}

/** Scans retained state inside a transaction owned by the caller. */
export function scanTraceStoreIntegrity(
    database: DatabaseSync,
    filesystem: BlobFilesystem,
): TraceIntegrityReport {
    const issues: TraceIntegrityIssue[] = [];
    const integrityRows = database.prepare("PRAGMA integrity_check").all();
    if (
        integrityRows.length !== 1 ||
        String(integrityRows[0]?.integrity_check).toLowerCase() !== "ok"
    ) {
        addIntegrityIssue(issues, "sqlite_integrity_mismatch", "store");
    }
    if (database.prepare("PRAGMA foreign_key_check").all().length > 0) {
        addIntegrityIssue(issues, "sqlite_integrity_mismatch", "foreign_keys");
    }

    const checkedRecordCount = verifyRecordIntegrity(database, issues);
    const appendIntentIds = readSortedStrings(
        database,
        STORE_TABLES.appendIntents,
        "append_intent_id",
    );
    for (const appendIntentId of appendIntentIds) {
        if (diagnoseStoredAppend(database, appendIntentId).status === "manual_recovery_required") {
            addIntegrityIssue(issues, "append_receipt_mismatch", appendIntentId);
        }
    }
    for (const appendIntentId of readOrphanedAppendIntentIds(database)) {
        addIntegrityIssue(issues, "append_receipt_mismatch", appendIntentId);
    }

    const cutIds = readSortedStrings(database, STORE_TABLES.cuts, "cut_id");
    for (const cutId of cutIds) {
        try {
            readStoredCut(database, cutId);
        } catch {
            addIntegrityIssue(issues, "cut_mismatch", cutId);
        }
    }

    const scopeRows = readScopeRegistrationRows(database);
    for (const row of scopeRows) {
        try {
            verifyScopeRegistrationRow(database, row);
        } catch {
            addIntegrityIssue(issues, "scope_registration_mismatch", row.scope_id);
        }
    }

    for (const dispatchId of readSupervisedDispatchIds(database)) {
        try {
            verifySupervisedDispatchRow(database, dispatchId);
        } catch {
            addIntegrityIssue(issues, "supervised_dispatch_mismatch", dispatchId);
        }
    }
    for (const sessionId of readReplaySessionIds(database)) {
        try {
            verifyReplaySessionRow(database, sessionId);
        } catch {
            addIntegrityIssue(issues, "replay_session_mismatch", sessionId);
        }
    }
    for (const subscriptionId of readTraceSubscriptionIds(database)) {
        try {
            verifyTraceSubscriptionRow(database, subscriptionId);
        } catch {
            addIntegrityIssue(issues, "trace_subscription_mismatch", subscriptionId);
        }
    }

    const blobReport = verifyStoredBlobs(database, filesystem);
    for (const issue of blobReport.issues) {
        addIntegrityIssue(issues, `blob_${issue.kind}`, issue.blob_id);
    }
    return Object.freeze({
        checked_append_intent_count: appendIntentIds.length,
        checked_blob_count: blobReport.checked_blob_count,
        checked_cut_count: cutIds.length,
        checked_owner_count: verifyOwnerOrdinalIntegrity(database, issues),
        checked_record_count: checkedRecordCount,
        checked_scope_count: scopeRows.length,
        issues: Object.freeze(issues),
        ok: issues.length === 0,
    });
}

function readSortedStrings(database: DatabaseSync, table: string, column: string): string[] {
    return database
        .prepare(`SELECT ${column} FROM ${table} ORDER BY ${column}`)
        .all()
        .map((row) => String(row[column]));
}
