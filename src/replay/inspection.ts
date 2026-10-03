import { canonicalizeSemanticValue, type SemanticValue } from "../canonical/canonical-record.ts";
import { kernelProtocolConfig, replayProtocolConfig } from "../protocol/config.ts";
import {
    RECORD_MODES,
    REPLAY_CHECKPOINT_CLASSIFICATIONS,
    REPLAY_CHECKPOINT_CONSTITUENT_KINDS,
    REPLAY_CHECKPOINT_EVIDENCE_STATUSES,
    REPLAY_EFFECT_DISPOSITIONS,
    REPLAY_MODES,
    REPLAY_RECOVERY_CLASSIFICATIONS,
    REPLAY_STEP_KINDS,
    REPLAY_STEP_SOURCES,
    REPLAY_TERMINAL_STATUSES,
} from "../protocol/values.generated.ts";
import { ROOT_WITNESS_ID } from "../record/root-witness.ts";
import type { RecordId } from "../record/types.ts";
import { assertScopeText, readScopeDataObject } from "../scope/validation.ts";
import type { ReplaySessionRow } from "../store/replay-sessions.ts";
import type { SQLiteTraceStore } from "../store/sqlite-trace-store.ts";
import type { OwnerRecord } from "../store/types.ts";
import { inspectReplayBranchRequest } from "./branch-request.ts";
import { ReplayCompatibilityError, ReplayEvidenceError } from "./errors.ts";
import { classifyReplaySessionProof } from "./proof-lowering.ts";
import {
    createReplayContextPrefixId,
    createReplayCutId,
    createReplayFrontierId,
    createReplayPrefixId,
    type ReplaySessionBody,
    type ReplayStepBody,
    readReplayAdmissionBody,
    readReplayCheckpointBody,
    readReplayRestoreBody,
    readReplaySessionBody,
    readReplayStepBody,
    readReplayTerminalBody,
} from "./records.ts";
import type {
    ReplayCheckpointInspection,
    ReplayConstituent,
    ReplayRecoveryClassification,
    ReplayRestoreInspection,
    ReplaySessionInspection,
    ReplayStepInspection,
    ReplayTerminalInspection,
} from "./types.ts";

const config = replayProtocolConfig;
const [CAPTURE_MODE, DECLARATION_MODE] = RECORD_MODES;
const [, REWIND_MODE] = REPLAY_MODES;
const [, EFFECT_KIND] = REPLAY_STEP_KINDS;
const [, RECORDED_SOURCE] = REPLAY_STEP_SOURCES;
const [MATERIALIZED, MATERIALIZATION_FAILED, REFUSED] = REPLAY_EFFECT_DISPOSITIONS;
const [TRACE_CUT_KIND, WORLD_KIND, PROVIDER_SESSION_KIND, PROCESS_KIND, IRREVERSIBLE_KIND] =
    REPLAY_CHECKPOINT_CONSTITUENT_KINDS;
const [VERIFIED, RECONSTRUCTIVE, NOT_APPLICABLE, UNAVAILABLE] = REPLAY_CHECKPOINT_EVIDENCE_STATUSES;
const [, , UNAVAILABLE_CLASSIFICATION] = REPLAY_CHECKPOINT_CLASSIFICATIONS;
const [TERMINAL_CLASSIFICATION, RUNNING, INTERRUPTED, UNCERTAIN] = REPLAY_RECOVERY_CLASSIFICATIONS;
const [, FAILED_STATUS, , REWOUND_STATUS] = REPLAY_TERMINAL_STATUSES;

/** Options for {@link inspectReplaySession}. */
export type InspectReplaySessionOptions = {
    /** Clock used to classify live leases; defaults to `Date.now`. */
    readonly clock?: () => number;
    /**
     * Whether to lower an eligible static session into Core-A reference records and classify the
     * lowered trace with the executable reference machine; defaults to `false`.
     */
    readonly lowerProof?: boolean;
    /** Replay session identity. */
    readonly sessionId: string;
};

/**
 * Reads one replay session as an immutable, fully validated, record-derived view.
 *
 * Every record on the session owner path is checked: versions, schemas, modes, causal parents,
 * step order and dependencies, chained prefix and context prefix identities, cache evidence,
 * admission-before-materialization, recorded steps against their source records, checkpoint cuts
 * and constituents, restore evidence, and terminal consistency. Inspection appends nothing and works
 * on read-only and imported stores; an imported session has no live row and is never `running`.
 *
 * The inspection carries a `proof` envelope: `runtime_only` for root sessions and the configured
 * `extension` profile for branch sessions, whose rewind and replay are publication controls. With
 * `lowerProof`, an eligible static root session (finished, effect steps only, every effect
 * materialized) is lowered into Core-A records; the envelope is then whatever the executable
 * reference machine accepts (`reference_core_a` / `reference_validated`), never proof-backed. An
 * ineligible session keeps its envelope and reports `metadata.lowering_ineligible`.
 *
 * @param store - Open trace store, writable or read-only.
 * @param options - Session identity and optional clock.
 * @returns The validated inspection.
 * @throws {ReplayCompatibilityError} If retained evidence names an unsupported replay version.
 * @throws {ReplayEvidenceError} If the session is absent or its evidence is inconsistent.
 * @throws {TraceStoreError} If the store is closed.
 * @throws {TypeError} If options are malformed.
 *
 * @example
 * ```ts
 * const inspection = inspectReplaySession(store, { sessionId });
 * console.log(inspection.classification, inspection.steps.length);
 * ```
 */
export function inspectReplaySession(
    store: SQLiteTraceStore,
    options: InspectReplaySessionOptions,
): ReplaySessionInspection {
    const fields = readScopeDataObject(options, ["sessionId"], "inspectReplaySession options", [
        "clock",
        "lowerProof",
    ]);
    assertScopeText(fields.sessionId, "sessionId");
    const clock = (fields.clock ?? Date.now) as () => number;
    if (typeof clock !== "function") {
        throw new TypeError("clock must be a function");
    }
    const lowerProof = fields.lowerProof ?? false;
    if (typeof lowerProof !== "boolean") {
        throw new TypeError("lowerProof must be a boolean");
    }
    const inspection = foldReplaySession(
        store,
        fields.sessionId,
        store.readOwner(fields.sessionId),
        store.readReplaySession(fields.sessionId),
        clock(),
    );
    return lowerProof
        ? Object.freeze({ ...inspection, proof: classifyReplaySessionProof(inspection, true) })
        : inspection;
}

/** Folds retained session records into a validated inspection. @internal */
export function foldReplaySession(
    store: SQLiteTraceStore,
    sessionId: string,
    records: readonly OwnerRecord[],
    row: ReplaySessionRow | undefined,
    nowMilliseconds: number,
): ReplaySessionInspection {
    const [first] = records;
    if (first === undefined) {
        throw new ReplayEvidenceError(`session ${sessionId} is not retained`);
    }
    try {
        return fold(store, sessionId, records, first, row, nowMilliseconds);
    } catch (error) {
        if (error instanceof ReplayEvidenceError || error instanceof ReplayCompatibilityError) {
            throw error;
        }
        throw new ReplayEvidenceError(`session ${sessionId} evidence is inconsistent`, {
            cause: error,
        });
    }
}

/** Returns the record at which a session holds exactly `stepCount` steps. @internal */
export function readReplayBoundaryRecordId(
    inspection: ReplaySessionInspection,
    stepCount: number,
): RecordId {
    return stepCount > 0
        ? (inspection.steps[stepCount - 1] as ReplayStepInspection).record_id
        : (inspection.restore?.record_id ?? inspection.session_record_id);
}

/** Derives the irreversible-effect frontier of the first `stepCount` steps. @internal */
export function readReplayFrontier(
    steps: readonly ReplayStepInspection[],
    stepCount: number,
): {
    readonly entries: readonly {
        readonly effect_id: string;
        readonly intent_ref: string;
        readonly step_index: number;
    }[];
    readonly frontier_id: string;
} {
    const entries = steps
        .slice(0, stepCount)
        .filter(
            (step) =>
                step.effect?.disposition === MATERIALIZED &&
                config.effects.approvalRequiredTiers.includes(step.effect.intent.reversibility),
        )
        .map((step) =>
            Object.freeze({
                effect_id: (step.effect as NonNullable<ReplayStepInspection["effect"]>).intent
                    .effect_id,
                intent_ref: (step.effect as NonNullable<ReplayStepInspection["effect"]>).intent_ref,
                step_index: step.index,
            }),
        );
    return Object.freeze({
        entries: Object.freeze(entries),
        frontier_id: createReplayFrontierId(entries),
    });
}

/** Source effects that a branch suffix may re-materialize. @internal */
export type ReplaySourceEffects = {
    /** First step index of each approval-tier intent that materialized or failed after admission. */
    readonly materialized: ReadonlyMap<string, number>;
    /** Step index of an intent admitted without a retained step. */
    readonly uncertain: ReadonlyMap<string, number>;
};

/**
 * Collects the source effects a branch suffix must treat as possibly materialized.
 *
 * Approval-tier effects that materialized or failed after admission may have changed the world, and
 * an admission without a step may have materialized regardless of tier.
 *
 * @internal
 */
export function readReplaySourceEffects(
    store: SQLiteTraceStore,
    source: ReplaySessionInspection,
): ReplaySourceEffects {
    const materialized = new Map<string, number>();
    for (const step of source.steps) {
        const effect = step.effect;
        if (
            effect !== null &&
            (effect.disposition === MATERIALIZED ||
                effect.disposition === MATERIALIZATION_FAILED) &&
            config.effects.approvalRequiredTiers.includes(effect.intent.reversibility) &&
            !materialized.has(effect.intent_ref)
        ) {
            materialized.set(effect.intent_ref, step.index);
        }
    }
    const uncertain = new Map<string, number>();
    if (source.pending_admission_record_id !== null) {
        const admission = readReplayAdmissionBody(
            (
                store.readRecord(source.pending_admission_record_id) as NonNullable<
                    ReturnType<SQLiteTraceStore["readRecord"]>
                >
            ).body,
        );
        uncertain.set(admission.intent_ref, admission.index);
    }
    return Object.freeze({ materialized, uncertain });
}

/** Whether a branch suffix effect needs replay policy approval. @internal */
export function replayEffectNeedsApproval(
    effects: ReplaySourceEffects,
    intentRef: string,
    reversibility: string,
): boolean {
    return (
        config.effects.approvalRequiredTiers.includes(reversibility) ||
        effects.uncertain.has(intentRef)
    );
}

type FoldState = {
    admission: {
        readonly index: number;
        readonly intentRef: string;
        readonly recordId: RecordId;
    } | null;
    readonly checkpoints: ReplayCheckpointInspection[];
    contextPrefixId: string | null;
    cut: OwnerRecord | null;
    cutThrough: RecordId | null;
    head: RecordId;
    prefixId: string | null;
    restore: ReplayRestoreInspection | null;
    readonly source: ReplaySessionInspection | null;
    readonly sourceEffects: ReplaySourceEffects | null;
    readonly steps: ReplayStepInspection[];
    terminal: ReplayTerminalInspection | null;
};

function fold(
    store: SQLiteTraceStore,
    sessionId: string,
    records: readonly OwnerRecord[],
    first: OwnerRecord,
    row: ReplaySessionRow | undefined,
    nowMilliseconds: number,
): ReplaySessionInspection {
    assertRecord(first, config.traceSchemas.session, DECLARATION_MODE);
    const session = readReplaySessionBody(first.body);
    const origin = session.origin;
    const request = origin === null ? null : inspectReplayBranchRequest(store, session.command_id);
    assert(
        request === null || canonical(request.request.session) === canonical(first.body),
        "session differs from its normalized branch request",
    );
    assert(
        session.session_id === sessionId &&
            sameIds(
                first.envelope.caused_by_record_ids,
                origin === null
                    ? []
                    : [
                          origin.source_session_record_id,
                          ...(request === null ? [] : [request.record_id]),
                      ],
            ),
        "session record identity or causes are inconsistent",
    );
    const source =
        origin === null
            ? null
            : foldReplaySession(
                  store,
                  origin.source_session_id,
                  store.readOwner(origin.source_session_id),
                  store.readReplaySession(origin.source_session_id),
                  nowMilliseconds,
              );
    assert(
        source === null ||
            (source.session_record_id === origin?.source_session_record_id &&
                origin.target_step_count <= source.steps.length),
        "branch origin differs from its source session",
    );
    const state: FoldState = {
        admission: null,
        checkpoints: [],
        contextPrefixId: null,
        cut: null,
        cutThrough: null,
        head: first.envelope.record_id,
        prefixId: null,
        restore: null,
        source,
        sourceEffects: source === null ? null : readReplaySourceEffects(store, source),
        steps: [],
        terminal: null,
    };
    for (const record of records.slice(1)) {
        assert(state.terminal === null, "records follow the terminal record");
        const schema = record.envelope.schema_ref;
        assert(
            (state.admission === null || schema === config.traceSchemas.step) &&
                (state.cut === null ||
                    schema === config.traceSchemas.checkpoint ||
                    schema === config.traceSchemas.restore),
            "admission or cut is not followed by its record",
        );
        if (schema === kernelProtocolConfig.queries.cutSchemaRef) {
            assertRecord(record, schema, CAPTURE_MODE);
            state.cut = record;
            state.cutThrough = state.head;
        } else if (schema === config.traceSchemas.restore) {
            foldRestore(store, session, record, state);
        } else if (schema === config.traceSchemas.admission) {
            assertRecord(record, schema, DECLARATION_MODE);
            const admission = readReplayAdmissionBody(record.body);
            assert(
                admission.session_id === sessionId &&
                    admission.index === state.steps.length &&
                    sameIds(record.envelope.caused_by_record_ids, [state.head]) &&
                    (origin === null || state.restore !== null),
                "admission is inconsistent",
            );
            state.admission = {
                index: admission.index,
                intentRef: admission.intent_ref,
                recordId: record.envelope.record_id,
            };
        } else if (schema === config.traceSchemas.step) {
            foldStep(store, session, record, state);
        } else if (schema === config.traceSchemas.checkpoint) {
            foldCheckpoint(session, record, state);
        } else {
            assertRecord(record, config.traceSchemas.terminal, CAPTURE_MODE);
            const terminal = readReplayTerminalBody(record.body);
            assert(
                terminal.session_id === sessionId &&
                    terminal.step_count === state.steps.length &&
                    terminal.prefix_id === state.prefixId &&
                    sameIds(record.envelope.caused_by_record_ids, [state.head]) &&
                    (terminal.status === REWOUND_STATUS ||
                        terminal.status === FAILED_STATUS ||
                        session.mode !== REWIND_MODE) &&
                    (terminal.status !== REWOUND_STATUS || session.mode === REWIND_MODE) &&
                    (terminal.status !== REWOUND_STATUS ||
                        terminal.step_count === origin?.target_step_count),
                "terminal record is inconsistent",
            );
            state.terminal = Object.freeze({
                failure: terminal.failure,
                prefix_id: terminal.prefix_id,
                record_id: record.envelope.record_id,
                result: terminal.result,
                status: terminal.status,
                step_count: terminal.step_count,
            });
        }
        state.head = record.envelope.record_id;
    }
    assert(state.cut === null, "cut publication is not followed by its record");
    const classification: ReplayRecoveryClassification =
        state.terminal !== null
            ? TERMINAL_CLASSIFICATION
            : row !== undefined && !row.released && row.lease_expires_at > nowMilliseconds
              ? RUNNING
              : state.admission !== null
                ? UNCERTAIN
                : INTERRUPTED;
    assert(
        row === undefined ||
            (row.session_record_id === first.envelope.record_id &&
                row.terminal === (state.terminal !== null)),
        "session row disagrees with its records",
    );
    const inspection = {
        checkpoints: Object.freeze(state.checkpoints),
        classification,
        command_id: session.command_id,
        head_record_id: state.head,
        live: row !== undefined,
        mode: session.mode,
        origin:
            origin === null
                ? null
                : Object.freeze({
                      changes: origin.changes,
                      replacement_task: origin.replacement_task,
                      source_session_id: origin.source_session_id,
                      source_session_record_id: origin.source_session_record_id,
                      target_checkpoint_id: origin.target_checkpoint_id,
                      target_step_count: origin.target_step_count,
                      target_trace_cut_id: origin.target_trace_cut_id,
                  }),
        pending_admission_record_id: state.admission?.recordId ?? null,
        processes: session.processes,
        program_id: session.program_id,
        provider: session.provider,
        provider_session_adapter_id: session.provider_session_adapter_id,
        restore: state.restore,
        session_id: sessionId,
        session_record_id: first.envelope.record_id,
        steps: Object.freeze(state.steps),
        task: session.task,
        terminal: state.terminal,
        worlds: session.worlds,
    };
    return Object.freeze({ ...inspection, proof: classifyReplaySessionProof(inspection, false) });
}

function foldRestore(
    store: SQLiteTraceStore,
    session: ReplaySessionBody,
    record: OwnerRecord,
    state: FoldState,
): void {
    assertRecord(record, config.traceSchemas.restore, CAPTURE_MODE);
    const restore = readReplayRestoreBody(record.body);
    const origin = session.origin;
    assert(
        origin !== null &&
            state.restore === null &&
            state.steps.length === 0 &&
            state.checkpoints.length === 0 &&
            restore.session_id === session.session_id,
        "restore record is not the first evidence of a branch",
    );
    const branch = origin as NonNullable<typeof origin>;
    if (branch.target_checkpoint_id === null) {
        const cut = state.cut as OwnerRecord;
        assert(
            cut !== null &&
                cut.body.cut_id === branch.target_trace_cut_id &&
                branch.target_trace_cut_id ===
                    createReplayCutId(
                        session.session_id,
                        branch.source_session_id,
                        branch.target_step_count,
                    ) &&
                cut.body.target_owner_id === branch.source_session_id &&
                sameIds(record.envelope.caused_by_record_ids, [cut.envelope.record_id]),
            "step-boundary restore must follow its published source cut",
        );
        store.readCut(branch.target_trace_cut_id);
    } else {
        const checkpoint = store.readRecord(record.envelope.caused_by_record_ids[1] as RecordId);
        assert(
            state.cut === null &&
                record.envelope.caused_by_record_ids.length === 2 &&
                record.envelope.caused_by_record_ids[0] === state.head &&
                checkpoint !== undefined &&
                checkpoint.envelope.schema_ref === config.traceSchemas.checkpoint,
            "checkpoint restore must cite the source checkpoint",
        );
        const retained = readReplayCheckpointBody(
            (checkpoint as NonNullable<typeof checkpoint>).body,
        );
        assert(
            retained.checkpoint_id === branch.target_checkpoint_id &&
                retained.session_id === branch.source_session_id &&
                retained.step_count === branch.target_step_count &&
                retained.trace_cut_id === branch.target_trace_cut_id &&
                retained.prefix_id === restore.prefix_id &&
                retained.context_prefix_id === restore.context_prefix_id,
            "restore differs from the cited source checkpoint",
        );
    }
    const sourceSession = state.source as ReplaySessionInspection;
    const k = branch.target_step_count;
    const lastProvider = sourceSession.steps
        .slice(0, k)
        .reverse()
        .find((step) => step.provider !== null);
    const frontier = readReplayFrontier(sourceSession.steps, k);
    let expected: readonly ReplayConstituent[];
    if (branch.target_checkpoint_id === null) {
        assert(
            sourceSession.worlds.length === 0 && sourceSession.processes.length === 0,
            "step-boundary restore names a source with worlds or processes",
        );
        expected = [
            constituentOf(TRACE_CUT_KIND, null, VERIFIED, branch.target_trace_cut_id, null),
            constituentOf(
                PROVIDER_SESSION_KIND,
                null,
                sourceSession.provider === null ? NOT_APPLICABLE : RECONSTRUCTIVE,
                null,
                null,
            ),
            constituentOf(IRREVERSIBLE_KIND, null, VERIFIED, frontier.frontier_id, {
                step_indices: frontier.entries.map((entry) => entry.step_index),
            }),
        ];
    } else {
        const checkpoint = sourceSession.checkpoints.find(
            (candidate) => candidate.checkpoint_id === branch.target_checkpoint_id,
        );
        assert(
            checkpoint !== undefined &&
                checkpoint.record_id === record.envelope.caused_by_record_ids[1],
            "restore cites a checkpoint its source session does not retain",
        );
        expected = checkpoint.constituents.map((constituent) =>
            constituent.kind === PROVIDER_SESSION_KIND && constituent.status === VERIFIED
                ? { ...constituent, name: session.provider_session_adapter_id }
                : constituent,
        );
    }
    assert(
        restore.classification !== UNAVAILABLE_CLASSIFICATION &&
            restore.prefix_id === (k === 0 ? null : sourceSession.steps[k - 1]?.prefix_id) &&
            restore.context_prefix_id === (lastProvider?.provider?.context_prefix_id ?? null) &&
            canonical(restore.constituents) === canonical(expected),
        "restore constituents or prefixes differ from the source journal",
    );
    state.cut = null;
    state.restore = Object.freeze({
        classification: restore.classification,
        constituents: restore.constituents,
        context_prefix_id: restore.context_prefix_id,
        prefix_id: restore.prefix_id,
        record_id: record.envelope.record_id,
    });
}

function foldStep(
    store: SQLiteTraceStore,
    session: ReplaySessionBody,
    record: OwnerRecord,
    state: FoldState,
): void {
    assertRecord(record, config.traceSchemas.step, CAPTURE_MODE);
    const step = readReplayStepBody(record.body);
    const origin = session.origin;
    const recorded = step.source === RECORDED_SOURCE;
    const admitted =
        step.effect !== null && !recorded && step.effect.disposition !== REFUSED
            ? state.admission
            : null;
    assert(
        step.session_id === session.session_id &&
            step.index === state.steps.length &&
            (origin === null || state.restore !== null) &&
            recorded === (origin !== null && step.index < origin.target_step_count) &&
            (session.mode !== REWIND_MODE || recorded) &&
            (admitted === null) === (state.admission === null) &&
            (admitted === null ||
                (admitted.index === step.index &&
                    admitted.intentRef === step.effect?.intent_ref)) &&
            (step.kind !== EFFECT_KIND || step.effect !== null),
        "step order, source, or admission is inconsistent",
    );
    const causes = unique([
        state.head,
        ...step.depends_on.map(
            (dependency) => (state.steps[dependency] as ReplayStepInspection).record_id,
        ),
        ...(step.source_step_record_id === null ? [] : [step.source_step_record_id]),
    ]);
    assert(
        sameIds(record.envelope.caused_by_record_ids, causes) &&
            step.prefix_id === createReplayPrefixId(state.prefixId, step.step_id),
        "step causes or prefix identity are inconsistent",
    );
    if (step.provider !== null) {
        const provider = step.provider;
        assert(
            provider.context_prefix_id ===
                createReplayContextPrefixId(
                    state.contextPrefixId,
                    provider.prompt_id,
                    provider.response_id,
                ) &&
                (provider.cache === null ||
                    provider.cache.prior_context_prefix_id === state.contextPrefixId),
            "provider context prefix identity is inconsistent",
        );
        state.contextPrefixId = provider.context_prefix_id;
    }
    const effect = step.effect;
    if (effect !== null && !recorded) {
        const effects = state.sourceEffects;
        const gated =
            effects !== null &&
            replayEffectNeedsApproval(effects, effect.intent_ref, effect.intent.reversibility);
        const approval = effect.approval;
        assert(
            (effect.disposition === REFUSED
                ? gated && approval === null
                : (approval !== null) === gated) &&
                (approval === null ||
                    approval.rematerialization ===
                        ((effects as ReplaySourceEffects).materialized.has(effect.intent_ref) ||
                            (effects as ReplaySourceEffects).uncertain.has(effect.intent_ref))),
            "effect approval does not match the replay approval rule",
        );
    }
    if (recorded) {
        const retainedSource = state.source?.steps[step.index];
        assert(
            retainedSource !== undefined &&
                retainedSource.record_id === step.source_step_record_id &&
                canonical(retainedSource.provider) === canonical(step.provider) &&
                canonical(
                    retainedSource.effect === null
                        ? null
                        : { ...retainedSource.effect, admission_record_id: undefined },
                ) === canonical(step.effect),
            "recorded step content differs from its source step",
        );
        // The validated source inspection retains this record as one of its steps.
        const source = store.readRecord(step.source_step_record_id as RecordId);
        const sourceStep = readReplayStepBody((source as NonNullable<typeof source>).body);
        assert(
            sourceStep.session_id === origin?.source_session_id && sameStep(sourceStep, step),
            "recorded step differs from its source step",
        );
    }
    state.prefixId = step.prefix_id;
    state.steps.push(
        Object.freeze({
            depends_on: step.depends_on,
            effect:
                step.effect === null
                    ? null
                    : Object.freeze({
                          ...step.effect,
                          admission_record_id: admitted?.recordId ?? null,
                      }),
            index: step.index,
            kind: step.kind,
            prefix_id: step.prefix_id,
            provider: step.provider,
            record_id: record.envelope.record_id,
            source: step.source,
            source_step_record_id: step.source_step_record_id,
            step_id: step.step_id,
        }),
    );
    state.admission = null;
    if (origin !== null && state.steps.length === origin.target_step_count) {
        assert(
            state.prefixId === state.restore?.prefix_id &&
                state.contextPrefixId === state.restore?.context_prefix_id,
            "recorded prefix does not reach the restored prefix identity",
        );
    }
}

function foldCheckpoint(session: ReplaySessionBody, record: OwnerRecord, state: FoldState): void {
    assertRecord(record, config.traceSchemas.checkpoint, CAPTURE_MODE);
    const checkpoint = readReplayCheckpointBody(record.body);
    const cut = state.cut as OwnerRecord;
    const origin = session.origin;
    const byKind = (kind: string) =>
        checkpoint.constituents.filter((constituent) => constituent.kind === kind);
    const frontier = readReplayFrontier(state.steps, state.steps.length);
    const [traceCut] = byKind(TRACE_CUT_KIND);
    const [irreversible] = byKind(IRREVERSIBLE_KIND);
    assert(
        cut !== null &&
            checkpoint.session_id === session.session_id &&
            checkpoint.step_count === state.steps.length &&
            (origin === null ||
                (state.restore !== null && checkpoint.step_count >= origin.target_step_count)) &&
            state.checkpoints.every((retained) => retained.step_count !== checkpoint.step_count) &&
            checkpoint.prefix_id === state.prefixId &&
            checkpoint.context_prefix_id === state.contextPrefixId &&
            cut.body.cut_id === checkpoint.trace_cut_id &&
            cut.body.target_owner_id === session.session_id &&
            cut.body.through_record_id === state.cutThrough &&
            sameIds(cut.envelope.caused_by_record_ids, [state.cutThrough as RecordId]) &&
            sameIds(record.envelope.caused_by_record_ids, [cut.envelope.record_id]) &&
            byKind(TRACE_CUT_KIND).length === 1 &&
            traceCut?.status === VERIFIED &&
            traceCut.receipt_id === checkpoint.trace_cut_id &&
            byKind(PROVIDER_SESSION_KIND).length === 1 &&
            byKind(IRREVERSIBLE_KIND).length === 1 &&
            irreversible?.status === VERIFIED &&
            irreversible.receipt_id === frontier.frontier_id &&
            sameIds(
                byKind(WORLD_KIND).map((constituent) => constituent.name as string),
                session.worlds,
            ) &&
            sameIds(
                byKind(PROCESS_KIND).map((constituent) => constituent.name as string),
                session.processes.map((process) => process.process_id),
            ),
        "checkpoint cut, boundary, or constituents are inconsistent",
    );
    for (const constituent of checkpoint.constituents) {
        assert(
            constituentAllowed(session, checkpoint.context_prefix_id, frontier, constituent),
            `checkpoint constituent ${constituent.kind} has an inadmissible status or evidence`,
        );
    }
    state.cut = null;
    state.checkpoints.push(
        Object.freeze({
            classification: checkpoint.classification,
            checkpoint_id: checkpoint.checkpoint_id,
            constituents: checkpoint.constituents,
            context_prefix_id: checkpoint.context_prefix_id,
            prefix_id: checkpoint.prefix_id,
            record_id: record.envelope.record_id,
            session_id: checkpoint.session_id,
            step_count: checkpoint.step_count,
            trace_cut_id: checkpoint.trace_cut_id,
        }),
    );
}

/** Whether two steps retain the same index, dependencies, kind, and content identity. @internal */
export function sameStep(
    left: Pick<ReplayStepBody, "depends_on" | "index" | "kind" | "step_id">,
    right: Pick<ReplayStepBody, "depends_on" | "index" | "kind" | "step_id">,
): boolean {
    return (
        left.index === right.index &&
        left.kind === right.kind &&
        left.step_id === right.step_id &&
        sameIds(left.depends_on.map(String), right.depends_on.map(String))
    );
}

function constituentAllowed(
    session: ReplaySessionBody,
    contextPrefixId: string | null,
    frontier: ReturnType<typeof readReplayFrontier>,
    constituent: ReplayConstituent,
): boolean {
    const evidence = constituent.evidence;
    const unavailable = constituent.status === UNAVAILABLE && evidence === null;
    if (constituent.kind === WORLD_KIND) {
        return (
            unavailable ||
            (constituent.status === VERIFIED &&
                sameKeys(evidence, ["entry_count", "manifest_blob_id"]) &&
                boundedCount(evidence?.entry_count, config.limits.maxWorldEntries) &&
                typeof evidence?.manifest_blob_id === "string")
        );
    }
    if (constituent.kind === PROCESS_KIND) {
        const declared = session.processes.find(
            (process) => process.process_id === constituent.name,
        );
        return (
            unavailable ||
            (constituent.status === VERIFIED &&
                sameKeys(evidence, ["backend", "byte_length"]) &&
                evidence?.backend === declared?.backend &&
                boundedCount(evidence?.byte_length, config.limits.maxProcessImageBytes))
        );
    }
    if (constituent.kind === PROVIDER_SESSION_KIND) {
        const adapterId = session.provider_session_adapter_id;
        if (adapterId === null) {
            return (
                constituent.name === null &&
                evidence === null &&
                constituent.status === (session.provider === null ? NOT_APPLICABLE : RECONSTRUCTIVE)
            );
        }
        return (
            constituent.name === adapterId &&
            (unavailable ||
                (constituent.status === VERIFIED &&
                    canonical(evidence) === canonical({ context_prefix_id: contextPrefixId })))
        );
    }
    if (constituent.kind === IRREVERSIBLE_KIND) {
        return (
            canonical(evidence) ===
            canonical({ step_indices: frontier.entries.map((entry) => entry.step_index) })
        );
    }
    return evidence === null;
}

function constituentOf(
    kind: string,
    name: string | null,
    status: string,
    receiptId: string | null,
    evidence: ReplayConstituent["evidence"],
): ReplayConstituent {
    return {
        evidence,
        kind,
        name,
        reason: null,
        receipt_id: receiptId,
        status,
    } as ReplayConstituent;
}

function sameKeys(value: unknown, keys: readonly string[]): boolean {
    return (
        value !== null &&
        typeof value === "object" &&
        sameIds(Object.keys(value).sort(), [...keys].sort())
    );
}

function boundedCount(value: unknown, maximum: number): boolean {
    return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= maximum;
}

function canonical(value: unknown): string {
    return canonicalizeSemanticValue(value as SemanticValue);
}

function assertRecord(record: OwnerRecord, schema: string, mode: string): void {
    assert(
        record.envelope.schema_ref === schema &&
            record.envelope.mode === mode &&
            record.envelope.witness_ref === ROOT_WITNESS_ID,
        `record ${record.envelope.record_id} has an unexpected schema, mode, or witness`,
    );
}

function assert(condition: boolean, message: string): asserts condition {
    if (!condition) {
        throw new ReplayEvidenceError(message);
    }
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}

function unique(values: readonly string[]): readonly string[] {
    return [...new Set(values)];
}
