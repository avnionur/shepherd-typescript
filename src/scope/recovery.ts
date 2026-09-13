import {
    SCOPE_COMMAND_KINDS,
    SCOPE_DISCARD_PHASES,
    SCOPE_EVIDENCE_KINDS,
    SCOPE_FORK_PHASES,
    SCOPE_MERGE_PHASES,
    SCOPE_RECOVERY_CLASSIFICATIONS,
    SCOPE_RECOVERY_RESUME_KINDS,
    SCOPE_STATES,
} from "../protocol/values.generated.ts";
import type { RecordId } from "../record/types.ts";
import type { SQLiteTraceStore } from "../store/sqlite-trace-store.ts";
import { inspectScope } from "./inspection.ts";
import { readScopeCommandReceipt } from "./replay.ts";
import { readScopeDiscardRecord } from "./terminal-records.ts";
import type {
    InspectScopeRecoveryOptions,
    ScopeInspection,
    ScopeRecoveryEntry,
    ScopeRecoveryReport,
} from "./types.ts";
import { readNowMilliseconds, readScopeDataObject } from "./validation.ts";

const [OPEN_STATE, MERGED_STATE] = SCOPE_STATES;
const [
    TERMINAL_CLASS,
    CLEANUP_PENDING_CLASS,
    MERGE_PENDING_CLASS,
    FORK_PENDING_CLASS,
    WRITER_EXPIRED_CLASS,
    WRITER_HELD_CLASS,
    IDLE_CLASS,
] = SCOPE_RECOVERY_CLASSIFICATIONS;
const [FORK_RESUME, MERGE_RESUME, DISCARD_RESUME, CLAIM_RESUME] = SCOPE_RECOVERY_RESUME_KINDS;
const [, , , , MERGE_COMMAND] = SCOPE_COMMAND_KINDS;
const [FORK_PREPARED_PHASE] = SCOPE_FORK_PHASES;
const [MERGE_PREPARED_PHASE] = SCOPE_MERGE_PHASES;
const [DISCARD_DECIDED_PHASE] = SCOPE_DISCARD_PHASES;
const DISCARD_DECIDED_KIND = SCOPE_EVIDENCE_KINDS[10];

/**
 * Classifies every live scope in this store for restart recovery and orphan detection.
 *
 * The report is derived from live registration rows, writer claims, and validated retained
 * records only; it never scans directories, infers ownership from projections, appends, or
 * repairs. Each scope receives exactly one configured classification in precedence order:
 * terminal, cleanup pending, merge pending, fork pending, writer expired, writer held, or idle.
 * Structural orphans cannot exist: registration rows require their parent row, and a discard seals
 * every open descendant in the same transaction. Orphaned work is therefore detected as a writer
 * expired classification, an unreleased claim past its lease whose holder may still be running.
 * Every classification that needs work names the single scope whose writer owns recovery and the
 * exact retained command to resume: the parent for an incomplete fork, a reserved merge, or the
 * discarded subtree root's pending cleanup, and the scope itself for an expired writer, which must
 * be superseded by a new claim. Imported stores hold no live rows and report no scopes.
 *
 * @param store - Open trace store holding live scope registrations.
 * @param options - Optional deterministic evaluation time for writer leases.
 * @returns Frozen report ordered by scope identity.
 * @throws {ScopeEvidenceError} If retained scope evidence is malformed or inconsistent.
 * @throws {TraceStoreError} If the store is closed.
 * @throws {TypeError} If options are malformed.
 *
 * @example
 * ```ts
 * const report = inspectScopeRecovery(store);
 * for (const entry of report.scopes.filter((scope) => scope.resume !== null)) {
 *     console.log(entry.scope_id, entry.classification, entry.resume);
 * }
 * ```
 *
 * @public
 */
export function inspectScopeRecovery(
    store: SQLiteTraceStore,
    options: InspectScopeRecoveryOptions = {},
): ScopeRecoveryReport {
    const fields = readScopeDataObject(options, [], "inspectScopeRecovery options", [
        "nowMilliseconds",
    ]);
    const nowMilliseconds = readNowMilliseconds(fields.nowMilliseconds, "nowMilliseconds");
    const rows = store.listScopeRegistrations();
    const scopes = rows.map((row): ScopeRecoveryEntry => {
        const inspection = inspectScope(store, row.scope_id) as ScopeInspection;
        const claim = store.readScopeWriterClaim(row.scope_id);
        const base = {
            claim:
                claim === undefined
                    ? null
                    : Object.freeze({
                          claim_id: claim.claim_id,
                          fencing_token: claim.fencing_token,
                          lease_expires_at: claim.lease_expires_at,
                          released: claim.released,
                      }),
            parent_scope_id: row.parent_scope_id,
            scope_id: row.scope_id,
            state: inspection.state,
        };
        const terminal = inspection.terminal;
        if (inspection.state !== OPEN_STATE) {
            const cleanup = pendingCleanup(store, inspection);
            return cleanup === null
                ? {
                      ...base,
                      classification: TERMINAL_CLASS,
                      recovery_owner_scope_id: null,
                      resume: null,
                  }
                : { ...base, classification: CLEANUP_PENDING_CLASS, ...cleanup };
        }
        if (terminal?.kind === MERGE_COMMAND && terminal.phase === MERGE_PREPARED_PHASE) {
            return {
                ...base,
                classification: MERGE_PENDING_CLASS,
                recovery_owner_scope_id: row.parent_scope_id,
                resume: { command_id: terminal.command_id, kind: MERGE_RESUME },
            };
        }
        if (inspection.world?.status === FORK_PREPARED_PHASE) {
            return {
                ...base,
                classification: FORK_PENDING_CLASS,
                recovery_owner_scope_id: row.parent_scope_id,
                resume: {
                    // The registration entry names the fork command.
                    command_id: (inspection.history[0] as { readonly command_id: string })
                        .command_id,
                    kind: FORK_RESUME,
                },
            };
        }
        if (claim !== undefined && !claim.released) {
            return claim.lease_expires_at <= nowMilliseconds
                ? {
                      ...base,
                      classification: WRITER_EXPIRED_CLASS,
                      recovery_owner_scope_id: row.scope_id,
                      resume: { command_id: null, kind: CLAIM_RESUME },
                  }
                : {
                      ...base,
                      classification: WRITER_HELD_CLASS,
                      recovery_owner_scope_id: null,
                      resume: null,
                  };
        }
        return { ...base, classification: IDLE_CLASS, recovery_owner_scope_id: null, resume: null };
    });
    return Object.freeze({
        evaluated_at: nowMilliseconds,
        scopes: Object.freeze(
            scopes.map((entry) =>
                Object.freeze({
                    ...entry,
                    resume: entry.resume === null ? null : Object.freeze({ ...entry.resume }),
                }),
            ),
        ),
    });
}

function pendingCleanup(
    store: SQLiteTraceStore,
    inspection: ScopeInspection,
): Pick<ScopeRecoveryEntry, "recovery_owner_scope_id" | "resume"> | null {
    if (inspection.state === MERGED_STATE) {
        return null;
    }
    const decisionRecordId = (
        inspection.history.find((entry) => entry.kind === DISCARD_DECIDED_KIND) as {
            readonly record_id: RecordId;
        }
    ).record_id;
    // Inspection validated the decision; descendants report their subtree root's cleanup.
    const decision = readScopeDiscardRecord(
        (
            store.readRecord(decisionRecordId) as NonNullable<
                ReturnType<SQLiteTraceStore["readRecord"]>
            >
        ).body,
    );
    const replay = readScopeCommandReceipt(store, decision.command_id);
    if (
        replay?.command !== SCOPE_COMMAND_KINDS[5] ||
        replay.receipt.cleanup.phase !== DISCARD_DECIDED_PHASE ||
        replay.receipt.cleanup.custody_ids.length === 0
    ) {
        return null;
    }
    return {
        recovery_owner_scope_id: replay.receipt.parent_scope_id,
        resume: { command_id: decision.command_id, kind: DISCARD_RESUME },
    };
}
