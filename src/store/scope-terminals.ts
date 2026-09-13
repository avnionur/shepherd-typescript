import type { DatabaseSync } from "node:sqlite";

import { scopeProtocolConfig } from "../protocol/config.ts";
import { SCOPE_STATES } from "../protocol/values.generated.ts";
import { assertNonEmptyString, assertRecordId } from "../record/guards.ts";
import type { RecordId } from "../record/types.ts";
import { ScopeEvidenceError, ScopeQuiescenceError } from "../scope/errors.ts";
import type { ScopeHeadAddress } from "../scope/types.ts";
import { appendWithinTraceStoreTransaction } from "./append.ts";
import { STORE_READ_TRANSACTION_SQL, STORE_TABLES, STORE_TRANSACTION_SQL } from "./constants.ts";
import { publishStoredCutWithinTransaction, readStoredCut } from "./cuts.ts";
import { AppendIntentConflictError } from "./errors.ts";
import { readOwnerRecordAtOrdinal } from "./read.ts";
import {
    assertCurrentFence,
    assertExpectedHead,
    assertForkCompleteOrAbsent,
    assertNoMergeReservation,
    assertNoPendingMergeInto,
    assertOpenRegistration,
    hasAppendIntent,
    readScopeHead,
    readScopeRegistrationRow,
    readScopeWriterClaimRow,
    type ScopeWriterFence,
} from "./scope-registrations.ts";
import type { AppendReceipt, Cut, OwnerRecord, StoreAppendRequest } from "./types.ts";

const [OPEN_STATE, MERGED_STATE, DISCARDED_STATE] = SCOPE_STATES;

/** Exact inputs reserving one consume-once child merge under both writer fences. @internal */
export type ScopeMergeAdmission = {
    /** Exact child head the fixed merge cut is published through. */
    readonly childExpectedHeadRecordId: RecordId;
    /** Exact live child writer authority proving child quiescence. */
    readonly childFence: ScopeWriterFence;
    /** Consumed child scope identity. */
    readonly childScopeId: string;
    /** Append intent naming the merge command. */
    readonly commandAppendIntentId: string;
    /** Deterministic fixed child-cut identity. */
    readonly mergeCutId: string;
    /** Unix time used for deterministic fence evaluation. */
    readonly nowMilliseconds: number;
    /** Exact parent head the merge integrates against. */
    readonly parentExpectedHeadRecordId: RecordId;
    /** Exact live parent writer authority. */
    readonly parentFence: ScopeWriterFence;
    /** Owning parent scope identity. */
    readonly parentScopeId: string;
    /** Canonical reservation request derived from the published child cut. */
    readonly prepared: (cut: Cut) => StoreAppendRequest;
};

/** Exact evidence proving a reserved merge is at its safe publication boundary. @internal */
export type ScopeMergeBoundary = {
    /** Consumed child scope identity. */
    readonly childScopeId: string;
    /** Unix time used for deterministic fence evaluation. */
    readonly nowMilliseconds: number;
    /** Exact parent head retained by the reservation. */
    readonly parentExpectedHeadRecordId: RecordId;
    /** Exact live parent writer authority. */
    readonly parentFence: ScopeWriterFence;
    /** Owning parent scope identity. */
    readonly parentScopeId: string;
    /** Reservation record that must still be the child head. */
    readonly preparedRecordId: RecordId;
};

/** One scope of a discarded subtree observed inside the decision transaction. @internal */
export type ScopeDiscardSubtreeScope = {
    /** First retained fork journal occurrence, when the scope owns reference-copy custody. */
    readonly forkPrepared: OwnerRecord | undefined;
    /** Retained merge reservation, whose protected application custody the subtree also owns. */
    readonly mergePrepared: OwnerRecord | undefined;
    /** Current head of the scope path. */
    readonly head: ScopeHeadAddress;
    /** Scope identity. */
    readonly scopeId: string;
    /** Current configured branch-lifecycle state. */
    readonly state: string;
};

/** Exact inputs admitting one logical subtree discard under the owning parent fence. @internal */
export type ScopeDiscardAdmission = {
    /** Append intent naming the discard command. */
    readonly commandAppendIntentId: string;
    /** Canonical decision request built from the observed subtree, subtree root first. */
    readonly decide: (subtree: readonly ScopeDiscardSubtreeScope[]) => StoreAppendRequest;
    /** Exact current head of the discarded subtree root. */
    readonly expectedHeadRecordId: RecordId;
    /** Unix time used for deterministic fence evaluation. */
    readonly nowMilliseconds: number;
    /** Exact live parent writer authority. */
    readonly parentFence: ScopeWriterFence;
    /** Owning parent of the subtree root. */
    readonly parentScopeId: string;
    /** Discarded subtree root. */
    readonly scopeId: string;
};

/** Exact inputs retaining cleanup progress of one logical discard. @internal */
export type ScopeDiscardCleanup = {
    /** Decision record that must still be the subtree root head. */
    readonly decidedRecordId: RecordId;
    /** Unix time used for deterministic fence evaluation. */
    readonly nowMilliseconds: number;
    /** Exact live parent writer authority. */
    readonly parentFence: ScopeWriterFence;
    /** Owning parent of the subtree root. */
    readonly parentScopeId: string;
    /** Canonical cleanup request. */
    readonly request: StoreAppendRequest;
    /** Discarded subtree root. */
    readonly scopeId: string;
};

/**
 * Atomically reserves or identically replays one consume-once child merge.
 *
 * Admission requires both open scopes under their exact current fences and heads, exact
 * ownership, no other terminal decision on the child, a complete child fork, only terminal
 * grandchildren, and no other merge in flight into the parent. It publishes the fixed child cut
 * and the reservation in one transaction. @internal
 */
export function prepareScopeMergeInStore(
    database: DatabaseSync,
    admission: ScopeMergeAdmission,
): { readonly cut: Cut; readonly receipt: AppendReceipt } {
    const { childScopeId, mergeCutId, nowMilliseconds, parentScopeId } = admission;
    assertNonEmptyString(childScopeId, "childScopeId");
    assertNonEmptyString(parentScopeId, "parentScopeId");
    assertRecordId(admission.childExpectedHeadRecordId, "childExpectedHeadRecordId");
    assertRecordId(admission.parentExpectedHeadRecordId, "parentExpectedHeadRecordId");
    database.exec(STORE_TRANSACTION_SQL.begin);
    try {
        if (hasAppendIntent(database, admission.commandAppendIntentId)) {
            const retainedCut = database
                .prepare(`SELECT 1 FROM ${STORE_TABLES.cuts} WHERE cut_id = ?`)
                .get(mergeCutId);
            // Only identity reuse racing the caller's retained-evidence check reaches this branch.
            /* node:coverage ignore next 5 */
            if (retainedCut === undefined) {
                throw new AppendIntentConflictError(
                    `scope merge intent ${admission.commandAppendIntentId} names different content`,
                );
            }
            const cut = readStoredCut(database, mergeCutId);
            const receipt = appendWithinTraceStoreTransaction(database, admission.prepared(cut));
            database.exec(STORE_TRANSACTION_SQL.commit);
            return Object.freeze({ cut, receipt });
        }
        assertOpenRegistration(database, parentScopeId);
        assertCurrentFence(database, parentScopeId, admission.parentFence, nowMilliseconds);
        assertExpectedHead(database, parentScopeId, admission.parentExpectedHeadRecordId);
        const child = assertOpenRegistration(database, childScopeId);
        // Registration ownership is immutable; merge planning refuses a foreign child first.
        /* node:coverage ignore next 3 */
        if (child.parent_scope_id !== parentScopeId) {
            throw new ScopeEvidenceError(`scope ${childScopeId} is not owned by ${parentScopeId}`);
        }
        assertNoMergeReservation(database, childScopeId);
        assertNoPendingMergeInto(database, parentScopeId);
        assertCurrentFence(database, childScopeId, admission.childFence, nowMilliseconds);
        const head = assertExpectedHead(
            database,
            childScopeId,
            admission.childExpectedHeadRecordId,
        );
        assertForkCompleteOrAbsent(database, childScopeId);
        for (const grandchild of readChildRows(database, childScopeId)) {
            // A consumed child can no longer authorize a descendant's pending discard cleanup.
            if (
                grandchild.state === OPEN_STATE ||
                (grandchild.state === DISCARDED_STATE &&
                    countOwnerSchemaRecords(
                        database,
                        grandchild.scope_id,
                        scopeProtocolConfig.traceSchemas.discard,
                    ) !== scopeProtocolConfig.discardPhases.length)
            ) {
                throw new ScopeQuiescenceError(
                    childScopeId,
                    `descendant ${grandchild.scope_id} is unresolved`,
                );
            }
        }
        const cut = publishStoredCutWithinTransaction(database, {
            cut_id: mergeCutId,
            target_owner_id: childScopeId,
            through_record_id: head.record_id,
        });
        const receipt = appendWithinTraceStoreTransaction(database, admission.prepared(cut));
        database.exec(STORE_TRANSACTION_SQL.commit);
        return Object.freeze({ cut, receipt });
    } catch (error) {
        database.exec(STORE_TRANSACTION_SQL.rollback);
        throw error;
    }
}

/**
 * Classifies whether a reserved merge is already completed or at its safe publication boundary.
 *
 * @returns Whether the merge is already completed or ready for parent publication.
 * @internal
 */
export function readScopeMergeBoundaryInStore(
    database: DatabaseSync,
    boundary: ScopeMergeBoundary,
    completedAppendIntentId: string,
): "completed" | "ready" {
    database.exec(STORE_READ_TRANSACTION_SQL.begin);
    try {
        const status = hasAppendIntent(database, completedAppendIntentId) ? "completed" : "ready";
        if (status === "ready") {
            assertMergeBoundary(database, boundary);
        }
        database.exec(STORE_READ_TRANSACTION_SQL.commit);
        return status;
    } catch (error) {
        database.exec(STORE_READ_TRANSACTION_SQL.rollback);
        throw error;
    }
}

/** Atomically completes or identically replays one reserved merge and seals the child. @internal */
export function completeScopeMergeInStore(
    database: DatabaseSync,
    completion: ScopeMergeBoundary & { readonly request: StoreAppendRequest },
): AppendReceipt {
    database.exec(STORE_TRANSACTION_SQL.begin);
    try {
        if (hasAppendIntent(database, completion.request.append_intent_id)) {
            const receipt = appendWithinTraceStoreTransaction(database, completion.request);
            database.exec(STORE_TRANSACTION_SQL.commit);
            return receipt;
        }
        assertMergeBoundary(database, completion);
        const receipt = appendWithinTraceStoreTransaction(database, completion.request);
        setScopeStates(database, [completion.childScopeId], MERGED_STATE);
        database.exec(STORE_TRANSACTION_SQL.commit);
        return receipt;
    } catch (error) {
        database.exec(STORE_TRANSACTION_SQL.rollback);
        throw error;
    }
}

/**
 * Atomically decides or identically replays one logical subtree discard.
 *
 * Admission requires the open parent under its exact current fence, the open owned subtree root
 * at its exact head without a reserved merge, and no unreleased writer claim on any open scope of
 * the subtree. Every open scope of the subtree is sealed in the same transaction; merged and
 * already discarded descendants keep their terminal evidence. @internal
 */
export function discardScopeInStore(
    database: DatabaseSync,
    admission: ScopeDiscardAdmission,
): "decided" | "replayed" {
    const { nowMilliseconds, parentScopeId, scopeId } = admission;
    assertNonEmptyString(scopeId, "scopeId");
    assertNonEmptyString(parentScopeId, "parentScopeId");
    assertRecordId(admission.expectedHeadRecordId, "expectedHeadRecordId");
    database.exec(STORE_TRANSACTION_SQL.begin);
    try {
        if (hasAppendIntent(database, admission.commandAppendIntentId)) {
            database.exec(STORE_TRANSACTION_SQL.commit);
            return "replayed";
        }
        assertOpenRegistration(database, parentScopeId);
        assertCurrentFence(database, parentScopeId, admission.parentFence, nowMilliseconds);
        const target = assertOpenRegistration(database, scopeId);
        if (target.parent_scope_id !== parentScopeId) {
            throw new ScopeEvidenceError(`scope ${scopeId} is not owned by ${parentScopeId}`);
        }
        assertNoMergeReservation(database, scopeId);
        assertExpectedHead(database, scopeId, admission.expectedHeadRecordId);
        const subtree = readSubtree(database, scopeId);
        if (subtree.length > scopeProtocolConfig.limits.maxDiscardScopes) {
            throw new ScopeEvidenceError(`scope ${scopeId} subtree exceeds the discard bound`);
        }
        const open = subtree.filter((scope) => scope.state === OPEN_STATE);
        for (const scope of open) {
            const claim = readScopeWriterClaimRow(database, scope.scopeId);
            if (claim !== undefined && !claim.released) {
                throw new ScopeQuiescenceError(
                    scope.scopeId,
                    `writer claim ${claim.claim_id} is unreleased`,
                );
            }
        }
        appendWithinTraceStoreTransaction(database, admission.decide(subtree));
        setScopeStates(
            database,
            open.map((scope) => scope.scopeId),
            DISCARDED_STATE,
        );
        database.exec(STORE_TRANSACTION_SQL.commit);
        return "decided";
    } catch (error) {
        database.exec(STORE_TRANSACTION_SQL.rollback);
        throw error;
    }
}

/** Atomically retains or identically replays cleanup progress of one logical discard. @internal */
export function completeScopeDiscardCleanupInStore(
    database: DatabaseSync,
    cleanup: ScopeDiscardCleanup,
): AppendReceipt {
    database.exec(STORE_TRANSACTION_SQL.begin);
    try {
        if (hasAppendIntent(database, cleanup.request.append_intent_id)) {
            const receipt = appendWithinTraceStoreTransaction(database, cleanup.request);
            database.exec(STORE_TRANSACTION_SQL.commit);
            return receipt;
        }
        assertOpenRegistration(database, cleanup.parentScopeId);
        assertCurrentFence(
            database,
            cleanup.parentScopeId,
            cleanup.parentFence,
            cleanup.nowMilliseconds,
        );
        assertExpectedHead(database, cleanup.scopeId, cleanup.decidedRecordId);
        const receipt = appendWithinTraceStoreTransaction(database, cleanup.request);
        database.exec(STORE_TRANSACTION_SQL.commit);
        return receipt;
    } catch (error) {
        database.exec(STORE_TRANSACTION_SQL.rollback);
        throw error;
    }
}

function assertMergeBoundary(database: DatabaseSync, boundary: ScopeMergeBoundary): void {
    const { childScopeId, parentScopeId } = boundary;
    assertOpenRegistration(database, parentScopeId);
    assertCurrentFence(database, parentScopeId, boundary.parentFence, boundary.nowMilliseconds);
    assertExpectedHead(database, parentScopeId, boundary.parentExpectedHeadRecordId);
    // Ownership is immutable and was proven when the reservation was admitted.
    assertOpenRegistration(database, childScopeId);
    assertExpectedHead(database, childScopeId, boundary.preparedRecordId);
}

function readChildRows(
    database: DatabaseSync,
    parentScopeId: string,
): readonly { readonly scope_id: string; readonly state: string }[] {
    return database
        .prepare(
            `SELECT scope_id, state FROM ${STORE_TABLES.scopeRegistrations} WHERE parent_scope_id = ? ORDER BY scope_id`,
        )
        .all(parentScopeId)
        .map((row) => ({ scope_id: String(row.scope_id), state: String(row.state) }));
}

function readSubtree(database: DatabaseSync, scopeId: string): readonly ScopeDiscardSubtreeScope[] {
    const descendants: string[] = [];
    const pending = [scopeId];
    while (pending.length > 0) {
        const current = pending.shift() as string;
        for (const child of readChildRows(database, current)) {
            descendants.push(child.scope_id);
            pending.push(child.scope_id);
        }
    }
    descendants.sort();
    return Object.freeze(
        [scopeId, ...descendants].map((id) => {
            const row = readScopeRegistrationRow(database, id);
            // Every visited identity was read from the registration table in this transaction.
            /* node:coverage ignore next 3 */
            if (row === undefined) {
                throw new ScopeEvidenceError(`scope ${id} registration changed during discard`);
            }
            return Object.freeze({
                forkPrepared: readFirstSchemaRecord(
                    database,
                    id,
                    scopeProtocolConfig.traceSchemas.fork,
                ),
                mergePrepared: readFirstSchemaRecord(
                    database,
                    id,
                    scopeProtocolConfig.traceSchemas.merge,
                ),
                head: readScopeHead(database, id) as ScopeHeadAddress,
                scopeId: id,
                state: row.state,
            });
        }),
    );
}

function countOwnerSchemaRecords(
    database: DatabaseSync,
    scopeId: string,
    schemaRef: string,
): number {
    const row = database
        .prepare(
            `SELECT COUNT(*) AS count FROM ${STORE_TABLES.recordViews} AS view INNER JOIN ${STORE_TABLES.records} AS record ON record.record_id = view.record_id WHERE view.owner_id = ? AND record.schema_ref = ?`,
        )
        .get(scopeId, schemaRef) as { readonly count: number };
    return row.count;
}

function readFirstSchemaRecord(
    database: DatabaseSync,
    scopeId: string,
    schemaRef: string,
): OwnerRecord | undefined {
    const row = database
        .prepare(
            `SELECT view.owner_ordinal AS owner_ordinal FROM ${STORE_TABLES.recordViews} AS view INNER JOIN ${STORE_TABLES.records} AS record ON record.record_id = view.record_id WHERE view.owner_id = ? AND record.schema_ref = ? ORDER BY view.owner_ordinal LIMIT 1`,
        )
        .get(scopeId, schemaRef);
    return row === undefined
        ? undefined
        : readOwnerRecordAtOrdinal(database, scopeId, Number(row.owner_ordinal));
}

function setScopeStates(database: DatabaseSync, scopeIds: readonly string[], state: string): void {
    const update = database.prepare(
        `UPDATE ${STORE_TABLES.scopeRegistrations} SET state = ? WHERE scope_id = ? AND state = ?`,
    );
    for (const scopeId of scopeIds) {
        update.run(state, scopeId, OPEN_STATE);
    }
}
