import type { DatabaseSync } from "node:sqlite";

import { assertNonEmptyString } from "../record/guards.ts";
import { decodeAppendReceipt } from "./codec.ts";
import { STORE_TABLES } from "./constants.ts";
import { TraceStoreError } from "./errors.ts";
import type { AppendRecoveryDiagnostic } from "./integrity-types.ts";
import { assertStoredReceiptMatches } from "./receipt-integrity.ts";

/** Diagnoses one append intent without modifying retained state. */
export function diagnoseStoredAppend(
    database: DatabaseSync,
    appendIntentId: string,
): AppendRecoveryDiagnostic {
    assertNonEmptyString(appendIntentId, "appendIntentId");
    const row = database
        .prepare(
            `SELECT receipt_json FROM ${STORE_TABLES.appendIntents}
             WHERE append_intent_id = ?`,
        )
        .get(appendIntentId);
    if (row === undefined) {
        const orphanedEvidence = database
            .prepare(
                `SELECT 1 FROM ${STORE_TABLES.recordViews} WHERE append_intent_id = ?
                 UNION ALL
                 SELECT 1 FROM ${STORE_TABLES.cuts} WHERE append_intent_id = ?
                 LIMIT 1`,
            )
            .get(appendIntentId, appendIntentId);
        if (orphanedEvidence !== undefined) {
            return freezeDiagnostic(appendIntentId, "manual_recovery_required", "orphaned_rows");
        }
        return freezeDiagnostic(appendIntentId, "retry_safe", null);
    }
    try {
        const receipt = decodeAppendReceipt(String(row.receipt_json), appendIntentId);
        assertStoredReceiptMatches(database, receipt);
        return freezeDiagnostic(appendIntentId, "committed", null);
    } catch (error) {
        if (
            !(
                error instanceof TraceStoreError ||
                error instanceof SyntaxError ||
                error instanceof TypeError
            )
        ) {
            // Unexpected SQLite operational errors must propagate.
            throw error;
        }
        return freezeDiagnostic(appendIntentId, "manual_recovery_required", "receipt_mismatch");
    }
}

function freezeDiagnostic(
    appendIntentId: string,
    status: AppendRecoveryDiagnostic["status"],
    issue: AppendRecoveryDiagnostic["issue"],
): AppendRecoveryDiagnostic {
    return Object.freeze({ append_intent_id: appendIntentId, issue, status });
}
