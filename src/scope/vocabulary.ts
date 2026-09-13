import {
    SCOPE_COMMAND_KINDS,
    SCOPE_DISCARD_PHASES,
    SCOPE_EVIDENCE_KINDS,
    SCOPE_FORK_PHASES,
    SCOPE_MERGE_PHASES,
    SCOPE_VOCABULARY_STATUSES,
    SCOPE_VOCABULARY_TERMS,
    SCOPE_VOCABULARY_VERSION,
} from "../protocol/values.generated.ts";
import type { RecordId } from "../record/types.ts";
import type { SQLiteTraceStore } from "../store/sqlite-trace-store.ts";
import type { RetainedRecord } from "../store/types.ts";
import { inspectScope } from "./inspection.ts";
import { readScopeChildMergedRecord, readScopeDiscardRecord } from "./terminal-records.ts";
import type { ScopeInspection, ScopeVocabularyEntry, ScopeVocabularyProjection } from "./types.ts";

const [, , CHILD_REGISTERED_KIND, , , , , , , CHILD_MERGED_KIND, DISCARD_DECIDED_KIND] =
    SCOPE_EVIDENCE_KINDS;
const [SPAWN_TERM, ADOPT_TERM, ABANDON_TERM, PUBLISH_TERM] = SCOPE_VOCABULARY_TERMS;
const [PENDING_STATUS, COMPLETED_STATUS] = SCOPE_VOCABULARY_STATUSES;
const [, FORK_COMPLETED_PHASE] = SCOPE_FORK_PHASES;
const [MERGE_PREPARED_PHASE] = SCOPE_MERGE_PHASES;
const [DISCARD_DECIDED_PHASE] = SCOPE_DISCARD_PHASES;
const [, , , , MERGE_COMMAND, DISCARD_COMMAND] = SCOPE_COMMAND_KINDS;

/**
 * Maps the spawn, adopt, abandon, and publish vocabulary onto one scope's retained evidence.
 *
 * The mapping is a disposable read of validated scope records, never an alias or a second event
 * stream: `spawn` cites a child registration, `adopt` a consume-once merge selecting a verified
 * child cut, `abandon` a logical discard decision removing a child from effective selection
 * (cleanup progress is reported separately), and `publish` an exact child occurrence made
 * parent-visible by a completed merge. It is not user-workspace materialization. A reserved merge
 * or an incomplete fork maps as pending. Version-1 execution-history relation and publication
 * projections keep their own semantics and are neither produced nor reinterpreted. The mapping
 * appends nothing, grants no authority, and reads the same after reopen or import.
 *
 * @param store - Open trace store, writable or read-only.
 * @param scopeId - Exact configured parent scope identity.
 * @returns Frozen vocabulary projection, or `undefined` when the scope retains nothing.
 * @throws {ScopeEvidenceError} If retained scope evidence is malformed or inconsistent.
 * @throws {TraceStoreError} If the store is closed or a cited cut is absent or corrupt.
 * @throws {TypeError} If the scope identity is malformed.
 *
 * @example
 * ```ts
 * const vocabulary = projectScopeVocabulary(store, parent.scope_id);
 * const adopted = vocabulary?.entries.filter((entry) => entry.term === "adopt");
 * ```
 *
 * @public
 */
export function projectScopeVocabulary(
    store: SQLiteTraceStore,
    scopeId: string,
): ScopeVocabularyProjection | undefined {
    const scope = inspectScope(store, scopeId);
    if (scope === undefined) {
        return undefined;
    }
    const children = new Map(
        scope.children.map((childScopeId) => [
            childScopeId,
            inspectScope(store, childScopeId) as ScopeInspection,
        ]),
    );
    const entries: ScopeVocabularyEntry[] = [];
    for (const entry of scope.history) {
        if (entry.kind === CHILD_REGISTERED_KIND) {
            const child = children.get(entry.child_scope_id) as ScopeInspection;
            entries.push({
                child_scope_id: entry.child_scope_id,
                command_id: entry.command_id,
                record_id: entry.record_id,
                status:
                    child.world === null || child.world.status === FORK_COMPLETED_PHASE
                        ? COMPLETED_STATUS
                        : PENDING_STATUS,
                term: SPAWN_TERM,
                world_capability: child.world_capability,
            });
        } else if (entry.kind === CHILD_MERGED_KIND) {
            entries.push({
                child_scope_id: entry.child_scope_id,
                command_id: entry.command_id,
                record_id: entry.record_id,
                status: COMPLETED_STATUS,
                term: ADOPT_TERM,
            });
            // Inspection already validated this integration against its reservation.
            const integration = readScopeChildMergedRecord(
                (store.readRecord(entry.record_id) as RetainedRecord).body,
            );
            for (const contribution of integration.contributions) {
                entries.push({
                    command_id: entry.command_id,
                    contribution,
                    record_id: entry.record_id,
                    status: COMPLETED_STATUS,
                    term: PUBLISH_TERM,
                });
            }
        }
    }
    for (const child of children.values()) {
        const terminal = child.terminal;
        if (terminal?.kind === MERGE_COMMAND && terminal.phase === MERGE_PREPARED_PHASE) {
            entries.push({
                child_scope_id: child.scope_id,
                command_id: terminal.command_id,
                record_id: terminal.record_id,
                status: PENDING_STATUS,
                term: ADOPT_TERM,
            });
        } else if (terminal?.kind === DISCARD_COMMAND) {
            const decisionRecordId = (
                child.history.find((entry) => entry.kind === DISCARD_DECIDED_KIND) as {
                    readonly record_id: RecordId;
                }
            ).record_id;
            const decision = readScopeDiscardRecord(
                (store.readRecord(decisionRecordId) as RetainedRecord).body,
            );
            // A scope sealed by an ancestor's discard was not abandoned by this parent.
            if (
                decision.phase === DISCARD_DECIDED_PHASE &&
                decision.discard_scope_id === child.scope_id
            ) {
                entries.push({
                    child_scope_id: child.scope_id,
                    cleanup_phase: terminal.phase,
                    command_id: terminal.command_id,
                    record_id: decisionRecordId,
                    status: COMPLETED_STATUS,
                    term: ABANDON_TERM,
                });
            }
        }
    }
    return Object.freeze({
        entries: Object.freeze(entries.map((entry) => Object.freeze(entry))),
        scope_id: scope.scope_id,
        vocabulary_version: SCOPE_VOCABULARY_VERSION,
    });
}
