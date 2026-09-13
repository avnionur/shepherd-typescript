import type { DatabaseSync } from "node:sqlite";

import { kernelProtocolConfig, scopeProtocolConfig } from "../protocol/config.ts";
import { SCOPE_STATES } from "../protocol/values.generated.ts";
import { readScopeRegistrationRecord } from "../scope/records.ts";
import { STORE_TABLES } from "./constants.ts";
import { TraceStoreError } from "./errors.ts";
import { readOwnerRecordAtOrdinal } from "./read.ts";
import type { ScopeRegistrationRow } from "./scope-registrations.ts";

/** Verifies one live scope registration row against its retained registration record. @internal */
export function verifyScopeRegistrationRow(
    database: DatabaseSync,
    row: ScopeRegistrationRow,
): void {
    const first = readOwnerRecordAtOrdinal(
        database,
        row.scope_id,
        kernelProtocolConfig.append.firstOwnerOrdinal,
    );
    if (
        first.envelope.record_id !== row.registration_record_id ||
        first.envelope.schema_ref !== scopeProtocolConfig.traceSchemas.registration
    ) {
        throw new TraceStoreError(
            `scope ${row.scope_id} registration row disagrees with its record`,
        );
    }
    const registration = readScopeRegistrationRecord(first.body);
    if (
        registration.scope_id !== row.scope_id ||
        (registration.parent?.scope_id ?? null) !== row.parent_scope_id ||
        !SCOPE_STATES.includes(row.state as (typeof SCOPE_STATES)[number])
    ) {
        throw new TraceStoreError(`scope ${row.scope_id} registration row is inconsistent`);
    }
    const [openState, mergedState, discardedState] = SCOPE_STATES;
    const expectedState =
        countScopeRecords(database, row.scope_id, scopeProtocolConfig.traceSchemas.discard) > 0
            ? discardedState
            : countScopeRecords(database, row.scope_id, scopeProtocolConfig.traceSchemas.merge) ===
                scopeProtocolConfig.mergePhases.length
              ? mergedState
              : openState;
    if (row.state !== expectedState) {
        throw new TraceStoreError(
            `scope ${row.scope_id} registration state disagrees with its terminal evidence`,
        );
    }
}

function countScopeRecords(database: DatabaseSync, scopeId: string, schemaRef: string): number {
    const row = database
        .prepare(
            `SELECT COUNT(*) AS count FROM ${STORE_TABLES.recordViews} AS view INNER JOIN ${STORE_TABLES.records} AS record ON record.record_id = view.record_id WHERE view.owner_id = ? AND record.schema_ref = ?`,
        )
        .get(scopeId, schemaRef) as { readonly count: number };
    return row.count;
}
