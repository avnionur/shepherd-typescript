import type { DatabaseSync } from "node:sqlite";

import { kernelProtocolConfig } from "../protocol/config.ts";
import { ROOT_WITNESS_ID } from "../record/root-witness.ts";
import { STORE_TABLES } from "./constants.ts";
import { addIntegrityIssue } from "./integrity-issues.ts";
import type { TraceIntegrityIssue } from "./integrity-types.ts";
import { readStoredRecord } from "./read.ts";
import { HOT_PATH_SQL } from "./statements.ts";

/** Verifies canonical rows, causal-parent indexes, witnesses, and retained occurrences. */
export function verifyRecordIntegrity(
    database: DatabaseSync,
    issues: TraceIntegrityIssue[],
): number {
    const rows = database
        .prepare(
            `SELECT record_id, schema_ref, witness_ref, caused_by_json
             FROM ${STORE_TABLES.records} ORDER BY record_id`,
        )
        .all();
    const recordIds = new Set(rows.map((row) => String(row.record_id)));
    const schemaByRecordId = new Map(
        rows.map((row) => [String(row.record_id), String(row.schema_ref)] as const),
    );
    if (!recordIds.has(ROOT_WITNESS_ID)) {
        addIntegrityIssue(issues, "witness_mismatch", ROOT_WITNESS_ID);
    }
    for (const row of rows) {
        const recordId = String(row.record_id);
        try {
            readStoredRecord(database, recordId);
        } catch {
            addIntegrityIssue(issues, "record_mismatch", recordId);
        }
        verifyParentIndex(database, row, recordIds, issues);
        verifyWitness(row, schemaByRecordId, issues);
        if (recordId !== ROOT_WITNESS_ID && countRecordViews(database, recordId) === 0) {
            addIntegrityIssue(issues, "orphan_record", recordId);
        }
    }
    return rows.length;
}

function verifyParentIndex(
    database: DatabaseSync,
    row: Record<string, unknown>,
    recordIds: ReadonlySet<string>,
    issues: TraceIntegrityIssue[],
): void {
    const recordId = String(row.record_id);
    let causedBy: readonly unknown[];
    try {
        const parsed: unknown = JSON.parse(String(row.caused_by_json));
        if (!Array.isArray(parsed)) {
            addIntegrityIssue(issues, "parent_index_mismatch", recordId);
            return;
        }
        causedBy = parsed;
    } catch {
        addIntegrityIssue(issues, "parent_index_mismatch", recordId);
        return;
    }
    const parentRows = database.prepare(HOT_PATH_SQL.parentsByChild).all(recordId);
    if (
        parentRows.length !== causedBy.length ||
        causedBy.some(
            (parentId, position) =>
                typeof parentId !== "string" ||
                !recordIds.has(parentId) ||
                Number(parentRows[position]?.parent_position) !== position ||
                parentRows[position]?.parent_record_id !== parentId,
        )
    ) {
        addIntegrityIssue(issues, "parent_index_mismatch", recordId);
    }
}

function verifyWitness(
    row: Record<string, unknown>,
    schemaByRecordId: ReadonlyMap<string, string>,
    issues: TraceIntegrityIssue[],
): void {
    const recordId = String(row.record_id);
    const witnessRef = String(row.witness_ref);
    if (recordId === ROOT_WITNESS_ID) {
        if (
            witnessRef !== kernelProtocolConfig.rootWitness.witnessRef ||
            row.schema_ref !== kernelProtocolConfig.rootWitness.schemaRef
        ) {
            addIntegrityIssue(issues, "witness_mismatch", recordId);
        }
        return;
    }
    const witnessSchema = schemaByRecordId.get(witnessRef);
    if (
        witnessSchema !== kernelProtocolConfig.rootWitness.schemaRef &&
        witnessSchema !== kernelProtocolConfig.queries.witnessSchemaRef
    ) {
        addIntegrityIssue(issues, "witness_mismatch", recordId);
    }
}

function countRecordViews(database: DatabaseSync, recordId: string): number {
    return Number(
        database
            .prepare(
                `SELECT COUNT(*) AS count FROM ${STORE_TABLES.recordViews}
                 WHERE record_id = ?`,
            )
            .get(recordId)?.count,
    );
}
