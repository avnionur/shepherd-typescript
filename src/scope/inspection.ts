import { readOwnerEffectResidualRisks } from "../effect/reconciliation-inspection.ts";
import { kernelProtocolConfig, scopeProtocolConfig } from "../protocol/config.ts";
import {
    SCOPE_COMMAND_KINDS,
    SCOPE_DISCARD_PHASES,
    SCOPE_EVIDENCE_KINDS,
    SCOPE_FORK_PHASES,
    SCOPE_MERGE_PHASES,
    SCOPE_STATES,
    SCOPE_WORLD_CAPABILITIES,
} from "../protocol/values.generated.ts";
import type { RecordId } from "../record/types.ts";
import type { SQLiteTraceStore } from "../store/sqlite-trace-store.ts";
import type { OwnerRecord } from "../store/types.ts";
import { ScopeEvidenceError } from "./errors.ts";
import {
    createScopeCommandAppendIntentId,
    readScopeChildRegisteredRecord,
    readScopeEmissionRecord,
    readScopeRegistrationRecord,
} from "./records.ts";
import {
    createScopeDiscardAppendIntentId,
    createScopeMergeAppendIntentId,
    readScopeChildMergedRecord,
    readScopeDiscardRecord,
    readScopeMergeRecord,
    scopeContributionKey,
} from "./terminal-records.ts";
import type {
    ScopeChildMergedRecord,
    ScopeContribution,
    ScopeDiscardDecidedRecord,
    ScopeHistoryEntry,
    ScopeInspection,
    ScopeMergePreparedRecord,
    ScopeState,
    ScopeTerminalInspection,
    ScopeWorldInspection,
} from "./types.ts";
import { assertScopeId } from "./validation.ts";
import { readScopeWorld } from "./world.ts";

const [
    REGISTRATION_KIND,
    ORIGIN_CUT_KIND,
    CHILD_REGISTERED_KIND,
    EMISSION_KIND,
    FORK_PREPARED_KIND,
    FORK_COMPLETED_KIND,
    MERGE_CUT_KIND,
    MERGE_PREPARED_KIND,
    MERGE_COMPLETED_KIND,
    CHILD_MERGED_KIND,
    DISCARD_DECIDED_KIND,
    DISCARD_CLEANED_KIND,
] = SCOPE_EVIDENCE_KINDS;
const [OPEN_STATE, MERGED_STATE, DISCARDED_STATE] = SCOPE_STATES;
const [, REFERENCE_COPY_CAPABILITY] = SCOPE_WORLD_CAPABILITIES;
const [, FORK_COMPLETED_STATUS] = SCOPE_FORK_PHASES;
const [MERGE_PREPARED_PHASE, MERGE_COMPLETED_PHASE] = SCOPE_MERGE_PHASES;
const [DISCARD_DECIDED_PHASE, DISCARD_CLEANED_PHASE] = SCOPE_DISCARD_PHASES;
const [, , , , MERGE_COMMAND, DISCARD_COMMAND] = SCOPE_COMMAND_KINDS;

/**
 * Reconstructs and validates one scope from its retained owner path without mutation.
 *
 * The projection is derived from canonical records, so a read-only reopen or a native archive
 * import produces the same result. Live registration admitting mutation is reported separately:
 * an imported archive carries inspection evidence only and reports `registered_for_mutation`
 * false. The branch state is derived from retained merge and discard evidence, and the selected
 * history lists this scope's own emissions plus contributions integrated by completed child
 * merges, each exact occurrence once.
 *
 * @param store - Open trace store, writable or read-only.
 * @param scopeId - Exact configured scope identity.
 * @returns Frozen validated inspection, or `undefined` when the owner path retains nothing.
 * @throws {ScopeEvidenceError} If retained scope evidence is malformed or inconsistent.
 * @throws {TraceStoreError} If the store is closed or a cited cut is absent or corrupt.
 * @throws {TypeError} If the scope identity is malformed.
 *
 * @example
 * ```ts
 * const inspection = inspectScope(store, root.scope_id);
 * console.log(inspection?.state, inspection?.selected_history.length);
 * ```
 *
 * @public
 */
export function inspectScope(
    store: SQLiteTraceStore,
    scopeId: string,
): ScopeInspection | undefined {
    assertScopeId(scopeId, "scopeId");
    const records = store.readOwner(scopeId);
    const first = records[0];
    if (first === undefined) {
        return undefined;
    }
    assertSchema(first, scopeProtocolConfig.traceSchemas.registration, "first scope record");
    const registration = readScopeRegistrationRecord(first.body);
    if (registration.scope_id !== scopeId) {
        throw new ScopeEvidenceError("scope registration names another scope");
    }
    assertCommandIntent(first, registration.command_id);
    const history: ScopeHistoryEntry[] = [
        {
            command_id: registration.command_id,
            kind: REGISTRATION_KIND,
            owner_ordinal: first.view.owner_ordinal,
            record_id: first.envelope.record_id,
        },
    ];
    const children: string[] = [];
    let previous = first;
    let nextIndex = 1;
    if (registration.parent !== null) {
        const originRecord = records[1];
        if (originRecord === undefined) {
            throw new ScopeEvidenceError("child scope lacks its origin-cut publication");
        }
        assertSchema(originRecord, kernelProtocolConfig.queries.cutSchemaRef, "scope origin cut");
        const cut = store.readCut(registration.parent.origin_cut_id);
        if (
            originRecord.view.append_intent_id !==
            `${kernelProtocolConfig.queries.cutAppendIntentPrefix}${cut.cut_id}`
        ) {
            throw new ScopeEvidenceError("scope origin cut is not retained by its own intent");
        }
        if (
            cut.created_by_record_id !== originRecord.envelope.record_id ||
            cut.publisher_owner_id !== scopeId ||
            cut.target_owner_id !== registration.parent.scope_id ||
            cut.through_record_id !== registration.parent.origin_record_id ||
            first.envelope.caused_by_record_ids[0] !==
                registration.parent.child_registered_record_id
        ) {
            throw new ScopeEvidenceError("child scope origin disagrees with its retained cut");
        }
        history.push({
            cut_id: cut.cut_id,
            kind: ORIGIN_CUT_KIND,
            owner_ordinal: originRecord.view.owner_ordinal,
            record_id: originRecord.envelope.record_id,
        });
        previous = originRecord;
        nextIndex = 2;
    }
    const parentScopeId = registration.parent?.scope_id ?? null;
    const forked = registration.world_capability === REFERENCE_COPY_CAPABILITY;
    const selected: ScopeContribution[] = [];
    const merged = new Set<string>();
    let world: ScopeWorldInspection | null = null;
    let preparedRecord: OwnerRecord | null = null;
    let mergeCut: { readonly cutId: string; readonly record: OwnerRecord } | null = null;
    let mergePrepared: ScopeMergePreparedRecord | null = null;
    let discardDecided: ScopeDiscardDecidedRecord | null = null;
    let terminal: ScopeTerminalInspection | null = null;
    let sealed = false;
    for (const record of records.slice(nextIndex)) {
        if (record.envelope.caused_by_record_ids[0] !== previous.envelope.record_id) {
            throw new ScopeEvidenceError("scope record is not caused by the previous head");
        }
        const schemaRef = record.envelope.schema_ref;
        const isDiscard = schemaRef === scopeProtocolConfig.traceSchemas.discard;
        if (sealed && !(isDiscard && discardDecided !== null)) {
            throw new ScopeEvidenceError("scope path retains evidence after its terminal decision");
        }
        if (mergeCut !== null && mergePrepared === null) {
            mergePrepared = readMergeReservation(record, mergeCut, scopeId, parentScopeId);
            terminal = merge(mergePrepared.command_id, MERGE_PREPARED_PHASE, record);
            history.push(
                entry(MERGE_CUT_KIND, mergePrepared.command_id, mergeCut.record),
                entry(MERGE_PREPARED_KIND, mergePrepared.command_id, record),
            );
            previous = record;
            continue;
        }
        if (mergePrepared !== null && !(isDiscard && discardDecided === null)) {
            readMergeSeal(record, mergePrepared);
            terminal = merge(mergePrepared.command_id, MERGE_COMPLETED_PHASE, record);
            history.push(entry(MERGE_COMPLETED_KIND, mergePrepared.command_id, record));
            sealed = true;
            previous = record;
            continue;
        }
        const isFork = schemaRef === scopeProtocolConfig.traceSchemas.fork;
        if (
            forked &&
            (world === null || world.status !== FORK_COMPLETED_STATUS) &&
            !isFork &&
            !(isDiscard && world !== null)
        ) {
            throw new ScopeEvidenceError("scope world fork is not complete");
        }
        if (isDiscard) {
            if (discardDecided === null) {
                discardDecided = readDiscardDecision(store, record, scopeId, parentScopeId);
                terminal = discard(discardDecided.command_id, DISCARD_DECIDED_PHASE, record);
                history.push(entry(DISCARD_DECIDED_KIND, discardDecided.command_id, record));
                sealed = true;
            } else {
                readDiscardCleanup(record, discardDecided, terminal);
                terminal = discard(discardDecided.command_id, DISCARD_CLEANED_PHASE, record);
                history.push(entry(DISCARD_CLEANED_KIND, discardDecided.command_id, record));
            }
        } else if (isFork) {
            if (!forked || world?.status === FORK_COMPLETED_STATUS) {
                throw new ScopeEvidenceError("scope path retains an unexpected fork record");
            }
            world =
                preparedRecord === null
                    ? readScopeWorld(record, null, scopeId, registration.command_id)
                    : readScopeWorld(preparedRecord, record, scopeId, registration.command_id);
            preparedRecord = preparedRecord ?? record;
            history.push({
                command_id: registration.command_id,
                custody_id: world.custody_id,
                kind:
                    world.status === FORK_COMPLETED_STATUS
                        ? FORK_COMPLETED_KIND
                        : FORK_PREPARED_KIND,
                owner_ordinal: record.view.owner_ordinal,
                record_id: record.envelope.record_id,
            });
        } else if (schemaRef === scopeProtocolConfig.traceSchemas.emission) {
            const emission = readScopeEmissionRecord(record.body);
            assertCommandIntent(record, emission.command_id);
            if (
                emission.scope_id !== scopeId ||
                emission.expected_head_record_id !== previous.envelope.record_id
            ) {
                throw new ScopeEvidenceError("scope emission disagrees with its retained head");
            }
            selected.push({
                owner_id: scopeId,
                owner_ordinal: record.view.owner_ordinal,
                record_id: record.envelope.record_id,
            });
            history.push({
                cited_record_ids: emission.cited_record_ids,
                command_id: emission.command_id,
                kind: EMISSION_KIND,
                owner_ordinal: record.view.owner_ordinal,
                record_id: record.envelope.record_id,
            });
        } else if (schemaRef === scopeProtocolConfig.traceSchemas.childRegistered) {
            const childRegistered = readScopeChildRegisteredRecord(record.body);
            assertCommandIntent(record, childRegistered.command_id);
            if (
                childRegistered.parent_scope_id !== scopeId ||
                childRegistered.origin_record_id !== previous.envelope.record_id
            ) {
                throw new ScopeEvidenceError(
                    "scope child registration disagrees with its retained head",
                );
            }
            children.push(childRegistered.child_scope_id);
            history.push({
                child_scope_id: childRegistered.child_scope_id,
                command_id: childRegistered.command_id,
                kind: CHILD_REGISTERED_KIND,
                owner_ordinal: record.view.owner_ordinal,
                record_id: record.envelope.record_id,
            });
        } else if (schemaRef === scopeProtocolConfig.traceSchemas.childMerged) {
            const integration = readScopeChildMergedRecord(record.body);
            const reservation = readChildReservation(store, record, integration);
            if (
                integration.parent_scope_id !== scopeId ||
                !children.includes(integration.child_scope_id) ||
                merged.has(integration.child_scope_id) ||
                reservation.scope_id !== integration.child_scope_id ||
                reservation.parent_scope_id !== scopeId ||
                reservation.parent_head_record_id !== previous.envelope.record_id ||
                reservation.merge_cut_id !== integration.child_cut_id ||
                (reservation.world === null) !== (integration.merged_content_id === null) ||
                JSON.stringify(reservation.contributions) !==
                    JSON.stringify(integration.contributions) ||
                integration.contributions.some(
                    (contribution) =>
                        store.readOwner(contribution.owner_id)[contribution.owner_ordinal]?.envelope
                            .record_id !== contribution.record_id,
                )
            ) {
                throw new ScopeEvidenceError(
                    "scope child integration disagrees with its reservation",
                );
            }
            merged.add(integration.child_scope_id);
            selected.push(...integration.contributions);
            history.push({
                child_scope_id: integration.child_scope_id,
                command_id: integration.command_id,
                kind: CHILD_MERGED_KIND,
                owner_ordinal: record.view.owner_ordinal,
                record_id: record.envelope.record_id,
            });
        } else if (
            schemaRef === kernelProtocolConfig.queries.cutSchemaRef &&
            String(record.view.append_intent_id).startsWith(
                `${kernelProtocolConfig.queries.cutAppendIntentPrefix}${scopeProtocolConfig.identity.mergeCutIdPrefix}`,
            )
        ) {
            const cutId = String(record.view.append_intent_id).slice(
                kernelProtocolConfig.queries.cutAppendIntentPrefix.length,
            );
            const cut = store.readCut(cutId);
            if (
                cut.created_by_record_id !== record.envelope.record_id ||
                cut.publisher_owner_id !== scopeId ||
                cut.target_owner_id !== scopeId ||
                cut.through_record_id !== previous.envelope.record_id
            ) {
                throw new ScopeEvidenceError("scope merge cut disagrees with its retained head");
            }
            mergeCut = { cutId, record };
        } else {
            throw new ScopeEvidenceError(
                `scope path retains unsupported record schema ${schemaRef}`,
            );
        }
        previous = record;
    }
    if (mergeCut !== null && mergePrepared === null) {
        throw new ScopeEvidenceError("scope merge cut lacks its reservation");
    }
    if (forked && world === null) {
        throw new ScopeEvidenceError("reference-copy scope lacks its prepared fork record");
    }
    const state: ScopeState =
        terminal === null || terminal.phase === MERGE_PREPARED_PHASE
            ? OPEN_STATE
            : terminal.kind === MERGE_COMMAND
              ? MERGED_STATE
              : DISCARDED_STATE;
    const row = store.readScopeRegistration(scopeId);
    if (
        row !== undefined &&
        (row.registration_record_id !== first.envelope.record_id ||
            row.parent_scope_id !== parentScopeId ||
            row.state !== state)
    ) {
        throw new ScopeEvidenceError("scope registration row disagrees with retained records");
    }
    const residualRisks = readOwnerEffectResidualRisks(store, scopeId);
    return Object.freeze({
        ...(residualRisks.length === 0 ? {} : { residual_risks: residualRisks }),
        authority: registration.authority,
        children: Object.freeze(children),
        execution_id: registration.execution_id,
        head: Object.freeze({
            owner_ordinal: previous.view.owner_ordinal,
            record_id: previous.envelope.record_id as RecordId,
        }),
        history: Object.freeze(history.map((historyEntry) => Object.freeze(historyEntry))),
        kind: registration.kind,
        parent: registration.parent,
        registered_for_mutation: row !== undefined,
        registration_record_id: first.envelope.record_id,
        scope_id: scopeId,
        // Keyed by exact occurrence, so an occurrence reached twice keeps its first position.
        selected_history: Object.freeze([
            ...new Map(
                selected.map((contribution) => [
                    scopeContributionKey(contribution),
                    Object.freeze({ ...contribution }),
                ]),
            ).values(),
        ]),
        state,
        terminal,
        world,
        world_capability: registration.world_capability,
    });
}

function readMergeReservation(
    record: OwnerRecord,
    mergeCut: { readonly cutId: string; readonly record: OwnerRecord },
    scopeId: string,
    parentScopeId: string | null,
): ScopeMergePreparedRecord {
    assertSchema(record, scopeProtocolConfig.traceSchemas.merge, "scope merge reservation");
    const prepared = readScopeMergeRecord(record.body);
    if (prepared.phase !== MERGE_PREPARED_PHASE) {
        throw new ScopeEvidenceError("scope merge cut is not followed by its reservation");
    }
    assertCommandIntent(record, prepared.command_id);
    if (
        prepared.scope_id !== scopeId ||
        prepared.parent_scope_id !== parentScopeId ||
        prepared.merge_cut_id !== mergeCut.cutId ||
        prepared.child_head_record_id !== mergeCut.record.envelope.caused_by_record_ids[0]
    ) {
        throw new ScopeEvidenceError("scope merge reservation disagrees with its cut");
    }
    return prepared;
}

function readMergeSeal(record: OwnerRecord, prepared: ScopeMergePreparedRecord): void {
    assertSchema(record, scopeProtocolConfig.traceSchemas.merge, "scope merge seal");
    const completed = readScopeMergeRecord(record.body);
    if (
        completed.phase !== MERGE_COMPLETED_PHASE ||
        completed.command_id !== prepared.command_id ||
        completed.scope_id !== prepared.scope_id ||
        completed.parent_scope_id !== prepared.parent_scope_id ||
        (completed.publication_revision_id === null) !== (prepared.world === null) ||
        record.view.append_intent_id !==
            createScopeMergeAppendIntentId(prepared.command_id, MERGE_COMPLETED_PHASE)
    ) {
        throw new ScopeEvidenceError("scope merge seal disagrees with its reservation");
    }
}

function readChildReservation(
    store: SQLiteTraceStore,
    record: OwnerRecord,
    integration: ScopeChildMergedRecord,
): ScopeMergePreparedRecord {
    const commandId = integration.command_id;
    const reservations = store.readAppendIntentRecords(createScopeCommandAppendIntentId(commandId));
    const completion = store.readAppendIntentRecords(
        createScopeMergeAppendIntentId(commandId, MERGE_COMPLETED_PHASE),
    );
    const [reservation] = reservations;
    const [integrationOccurrence, seal] = completion;
    const prepared =
        reservation?.envelope.schema_ref === scopeProtocolConfig.traceSchemas.merge
            ? readScopeMergeRecord(reservation.body)
            : undefined;
    const sealed =
        seal?.envelope.schema_ref === scopeProtocolConfig.traceSchemas.merge
            ? readScopeMergeRecord(seal.body)
            : undefined;
    // The reservation, integration, and seal must be exactly the retained journal of one command.
    if (
        reservations.length !== 1 ||
        completion.length !== 2 ||
        prepared?.phase !== MERGE_PREPARED_PHASE ||
        prepared.command_id !== commandId ||
        reservation?.view.owner_id !== integration.child_scope_id ||
        record.envelope.caused_by_record_ids[1] !== reservation.envelope.record_id ||
        integrationOccurrence?.envelope.record_id !== record.envelope.record_id ||
        sealed?.phase !== MERGE_COMPLETED_PHASE ||
        sealed.publication_revision_id !== integration.publication_revision_id ||
        seal?.envelope.caused_by_record_ids[0] !== reservation.envelope.record_id
    ) {
        throw new ScopeEvidenceError("scope child integration lacks its exact merge journal");
    }
    return prepared;
}

function readDiscardDecision(
    store: SQLiteTraceStore,
    record: OwnerRecord,
    scopeId: string,
    parentScopeId: string | null,
): ScopeDiscardDecidedRecord {
    const decided = readScopeDiscardRecord(record.body);
    if (decided.phase !== DISCARD_DECIDED_PHASE) {
        throw new ScopeEvidenceError("scope discard cleanup precedes its decision");
    }
    assertCommandIntent(record, decided.command_id);
    // A sealed descendant must be named by the subtree root's decision under the same command.
    const [rootRecord] = store.readAppendIntentRecords(
        createScopeCommandAppendIntentId(decided.command_id),
    );
    const root = readScopeDiscardRecord((rootRecord as OwnerRecord).body);
    if (
        decided.scope_id !== scopeId ||
        root.phase !== DISCARD_DECIDED_PHASE ||
        root.scope_id !== decided.discard_scope_id ||
        !root.sealed_scope_ids.includes(scopeId) ||
        (decided.discard_scope_id === scopeId && decided.parent_scope_id !== parentScopeId)
    ) {
        throw new ScopeEvidenceError("scope discard decision disagrees with its scope");
    }
    return decided;
}

function readDiscardCleanup(
    record: OwnerRecord,
    decided: ScopeDiscardDecidedRecord,
    terminal: ScopeTerminalInspection | null,
): void {
    const cleaned = readScopeDiscardRecord(record.body);
    if (
        cleaned.phase !== DISCARD_CLEANED_PHASE ||
        terminal?.phase !== DISCARD_DECIDED_PHASE ||
        decided.discard_scope_id !== decided.scope_id ||
        cleaned.command_id !== decided.command_id ||
        cleaned.scope_id !== decided.scope_id ||
        JSON.stringify(cleaned.custody_ids) !== JSON.stringify(decided.custody_ids) ||
        record.view.append_intent_id !==
            createScopeDiscardAppendIntentId(decided.command_id, DISCARD_CLEANED_PHASE)
    ) {
        throw new ScopeEvidenceError("scope discard cleanup disagrees with its decision");
    }
}

function merge(
    commandId: string,
    phase: ScopeTerminalInspection["phase"],
    record: OwnerRecord,
): ScopeTerminalInspection {
    return Object.freeze({
        command_id: commandId,
        kind: MERGE_COMMAND,
        phase: phase as (typeof SCOPE_MERGE_PHASES)[number],
        record_id: record.envelope.record_id,
    });
}

function discard(
    commandId: string,
    phase: ScopeTerminalInspection["phase"],
    record: OwnerRecord,
): ScopeTerminalInspection {
    return Object.freeze({
        command_id: commandId,
        kind: DISCARD_COMMAND,
        phase: phase as (typeof SCOPE_DISCARD_PHASES)[number],
        record_id: record.envelope.record_id,
    });
}

function entry(
    kind:
        | typeof MERGE_CUT_KIND
        | typeof MERGE_PREPARED_KIND
        | typeof MERGE_COMPLETED_KIND
        | typeof DISCARD_DECIDED_KIND
        | typeof DISCARD_CLEANED_KIND,
    commandId: string,
    record: OwnerRecord,
): ScopeHistoryEntry {
    return {
        command_id: commandId,
        kind,
        owner_ordinal: record.view.owner_ordinal,
        record_id: record.envelope.record_id,
    };
}

function assertCommandIntent(record: OwnerRecord, commandId: string): void {
    if (record.view.append_intent_id !== createScopeCommandAppendIntentId(commandId)) {
        throw new ScopeEvidenceError("scope record is not retained by its command intent");
    }
}

function assertSchema(record: OwnerRecord, schemaRef: string, subject: string): void {
    if (record.envelope.schema_ref !== schemaRef) {
        throw new ScopeEvidenceError(`${subject} uses schema ${record.envelope.schema_ref}`);
    }
}
