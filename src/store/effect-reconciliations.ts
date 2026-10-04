import type { DatabaseSync } from "node:sqlite";
import {
    EffectCompensationConflictError,
    EffectCompensationEvidenceError,
} from "../effect/compensation-errors.ts";
import {
    readReconciliationRecord,
    reconciliationCauses,
    reconciliationCommandIntent,
    reconciliationCommandOwner,
    reconciliationOwner,
} from "../effect/reconciliation-records.ts";
import type { EffectReconciliationRecord } from "../effect/reconciliation-types.ts";
import { effectProtocolConfig } from "../protocol/config.ts";
import { EFFECT_RECONCILIATION_SOURCE_KINDS, RECORD_MODES } from "../protocol/values.generated.ts";
import { ROOT_WITNESS_ID } from "../record/root-witness.ts";
import type { RecordBody } from "../record/types.ts";
import { runInSQLiteTransaction } from "../runtime/sqlite-transaction.ts";
import { appendWithinTraceStoreTransaction } from "./append.ts";
import { readCompensationClaim } from "./compensation-claims.ts";
import { STORE_TABLES, STORE_TRANSACTION_SQL } from "./constants.ts";
import { assertNonNegativeMilliseconds } from "./durable-execution-claims.ts";
import { readReplaySessionRow } from "./replay-sessions.ts";
import { hasAppendIntent, readScopeHead } from "./scope-registrations.ts";
import { readSupervisedDispatchRow } from "./supervised-dispatches.ts";
import type { AppendReceipt, StoreAppendRequest } from "./types.ts";

const config = effectProtocolConfig.compensation.reconciliation;
const [REPLAY] = EFFECT_RECONCILIATION_SOURCE_KINDS;
const [CAPTURE] = RECORD_MODES;

/** Publishes an authorized audit only while source, compensation and prior audit heads agree. @internal */
export function appendEffectReconciliationInStore(
    database: DatabaseSync,
    input: EffectReconciliationRecord,
    now: number,
): AppendReceipt {
    assertNonNegativeMilliseconds(now, "reconciliation clock");
    const body = readReconciliationRecord(input);
    const owner = reconciliationOwner(body.target_record_id);
    const request: StoreAppendRequest = {
        append_intent_id: reconciliationCommandIntent(body.command_id),
        batch: {
            groups: [owner, reconciliationCommandOwner(body.command_id), body.compensation_id].map(
                (ownerId) => ({
                    owner_id: ownerId,
                    records: [
                        {
                            body: body as unknown as RecordBody,
                            caused_by_record_ids: reconciliationCauses(body),
                            mode: CAPTURE,
                            schema_ref: config.traceSchema,
                            witness_ref: ROOT_WITNESS_ID,
                        },
                    ],
                }),
            ),
        },
    };
    return runInSQLiteTransaction(database, STORE_TRANSACTION_SQL, () => {
        if (hasAppendIntent(database, request.append_intent_id))
            return appendWithinTraceStoreTransaction(database, request);
        const head = readScopeHead(database, owner);
        if (
            (head?.record_id ?? null) !== body.previous_record_id ||
            (readScopeHead(database, body.compensation_id)?.record_id ?? null) !==
                body.compensation_head_record_id ||
            readScopeHead(database, body.source_owner_id)?.record_id !== body.source_head_record_id
        )
            throw new EffectCompensationConflictError(body.compensation_id);
        if (head !== undefined && head.owner_ordinal + 1 >= config.limits.maxDecisions)
            throw new EffectCompensationEvidenceError(
                "reconciliation audit exceeds configured bounds",
            );
        const claim = readCompensationClaim(database, body.compensation_id);
        const source =
            body.source_kind === REPLAY
                ? readReplaySessionRow(database, body.source_owner_id)
                : readSupervisedDispatchRow(database, body.source_owner_id);
        if (
            (claim !== undefined && !claim.released && claim.lease_expires_at > now) ||
            (source !== undefined && !source.released && source.lease_expires_at > now)
        )
            throw new EffectCompensationConflictError(body.compensation_id);
        const receipt = appendWithinTraceStoreTransaction(database, request);
        // Persistently fence expired holders: a later backwards clock must not revive them.
        database
            .prepare(
                `UPDATE ${STORE_TABLES.compensationClaims} SET released = 1 WHERE compensation_id = ?`,
            )
            .run(body.compensation_id);
        if (body.source_kind === REPLAY)
            database
                .prepare(
                    `UPDATE ${STORE_TABLES.replaySessions} SET released = 1 WHERE session_id = ?`,
                )
                .run(body.source_owner_id);
        else
            database
                .prepare(
                    `UPDATE ${STORE_TABLES.supervisedDispatches} SET released = 1 WHERE dispatch_id = ?`,
                )
                .run(body.source_owner_id);
        return receipt;
    });
}
