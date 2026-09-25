import type { SemanticRecord, SemanticValue } from "../canonical/canonical-record.ts";
import { acceptChildRunResult } from "../delegation/commands.ts";
import { openChildRun, runChildRun } from "../delegation/handle.ts";
import { inspectChildRun } from "../delegation/inspection.ts";
import { projectChildRunResult } from "../delegation/projection.ts";
import { createChildRunHandleId } from "../delegation/records.ts";
import type {
    ChildRunCompletionInspection,
    ChildRunProgramContext,
    RunChildRunOptions,
} from "../delegation/types.ts";
import {
    applicationsProtocolConfig,
    kernelProtocolConfig,
    replayProtocolConfig,
} from "../protocol/config.ts";
import {
    APPLICATION_COMPRESSION_BASELINE_KINDS,
    APPLICATION_COMPRESSION_CANDIDATE_KINDS,
    APPLICATION_COMPRESSION_CANDIDATE_STATUSES,
    APPLICATION_COMPRESSION_OUTCOMES,
    APPLICATION_COMPRESSION_PHASES,
    APPLICATION_COMPRESSION_VERDICTS,
    APPLICATION_KINDS,
    APPLICATION_PROTOCOL_SURFACES,
    RECORD_MODES,
    REPLAY_CHECKPOINT_CLASSIFICATIONS,
    REPLAY_CHECKPOINT_CONSTITUENT_KINDS,
    REPLAY_CHECKPOINT_EVIDENCE_STATUSES,
    REPLAY_RECOVERY_CLASSIFICATIONS,
    REPLAY_SOURCE_DISPOSITIONS,
    REPLAY_STEP_KINDS,
    REPLAY_TERMINAL_STATUSES,
    RUN_TERMINAL_STATUSES,
} from "../protocol/values.generated.ts";
import { ROOT_WITNESS_ID } from "../record/root-witness.ts";
import type { RecordId } from "../record/types.ts";
import { classifyReplayCheckpoint } from "../replay/analysis.ts";
import { replayReplaySession, rewindReplaySession } from "../replay/branch.ts";
import { ReplaySessionInterruptedError } from "../replay/errors.ts";
import { inspectReplaySession } from "../replay/inspection.ts";
import { deriveReplaySessionId, runReplaySession } from "../replay/session.ts";
import type {
    ReplayConstituent,
    ReplayRestoreInspection,
    ReplaySessionInspection,
    ReplaySessionProgram,
    ReplaySessionReceipt,
    ReplayTarget,
    ReplayTerminalInspection,
} from "../replay/types.ts";
import type { DurableTaskExecutionInspection } from "../run/durable-execution-inspection-types.ts";
import type { RunUsage } from "../run/usage-types.ts";
import { assertScopeText, readScopeDataObject } from "../scope/validation.ts";
import type { SQLiteTraceStore } from "../store/sqlite-trace-store.ts";
import type { OwnerRecord } from "../store/types.ts";
import {
    type CompressionCandidateBody,
    type CompressionOpenedBody,
    type CompressionOutcomeBody,
    canonical,
    readChildOutputText,
    readCompressionBaselines,
    readCompressionCandidateBody,
    readCompressionOpenedBody,
    readCompressionOutcomeBody,
    readTrajectoryProposal,
    readTrajectoryVerdict,
    resolveTrajectoryProposal,
    snapshot,
    stepCountRatio,
} from "./compression-records.ts";
import type {
    RunTrajectoryCompressionOptions,
    TrajectoryCompressionBaselineKind,
    TrajectoryCompressionCandidateInspection,
    TrajectoryCompressionCandidateKind,
    TrajectoryCompressionCandidateRecord,
    TrajectoryCompressionFailure,
    TrajectoryCompressionInspection,
    TrajectoryCompressionOutcomeRecord,
    TrajectoryCompressionReceipt,
    TrajectoryCompressionWorkflow,
    TrajectoryForkClamp,
    TrajectoryForkPoint,
    TrajectoryForkStepPolicy,
    TrajectoryHint,
    TrajectoryRestoreEvidence,
} from "./compression-types.ts";
import {
    ApplicationBudgetError,
    ApplicationEvidenceError,
    ApplicationProtocolError,
    ApplicationVerificationError,
} from "./errors.ts";
import {
    applicationProtocolId,
    createApplicationManifest,
    deriveApplicationOwnerId,
    readApplicationProtocol,
    readRetainedManifest,
    retainApplicationManifest,
} from "./manifest.ts";
import {
    type ApplicationSchemaSurface,
    assertApplicationMessage,
    compileApplicationSchemaSurfaces,
} from "./protocol-schemas.ts";
import {
    addApplicationCosts,
    applicationDigest,
    assertApplicationDigest,
    createApplicationAppendIntentId,
    createApplicationAppendRequest,
    createApplicationCommandId,
    createVersionedApplicationBody,
    foldApplicationCosts,
    measureReplaySessionCost,
    prefixedApplicationId,
} from "./records.ts";
import type {
    ApplicationArtifactSource,
    ApplicationCostSummary,
    ApplicationProtocolDefinition,
} from "./types.ts";

const config = applicationsProtocolConfig;
const compression = config.compression;
const [CAPTURE_MODE] = RECORD_MODES;
const [, , COMPRESSION_KIND] = APPLICATION_KINDS;
const [PROMPT_KIND, SCHEMA_KIND] = APPLICATION_PROTOCOL_SURFACES;
const [OPENED_PHASE, CANDIDATE_PHASE, OUTCOME_PHASE] = APPLICATION_COMPRESSION_PHASES;
const [COMPRESSION_CANDIDATE, CONTROL_CANDIDATE] = APPLICATION_COMPRESSION_CANDIDATE_KINDS;
const [PROPOSED, REWOUND, SETTLED, REJECTED] = APPLICATION_COMPRESSION_CANDIDATE_STATUSES;
const [PRUNED, NO_PRUNE, RESTORED] = APPLICATION_COMPRESSION_OUTCOMES;
const [ACCEPTED] = APPLICATION_COMPRESSION_VERDICTS;
const [NO_COMPRESSION] = APPLICATION_COMPRESSION_BASELINE_KINDS;
const [, , UNAVAILABLE] = REPLAY_CHECKPOINT_CLASSIFICATIONS;
const [FINISHED_SESSION, , , REWOUND_SESSION] = REPLAY_TERMINAL_STATUSES;
const [, RUNNING_SESSION] = REPLAY_RECOVERY_CLASSIFICATIONS;
const [, RETAIN_SOURCE] = REPLAY_SOURCE_DISPOSITIONS;
const [FINISHED_CHILD] = RUN_TERMINAL_STATUSES;
const [PROVIDER_STEP] = REPLAY_STEP_KINDS;
const [, WORLD_CONSTITUENT, , PROCESS_CONSTITUENT] = REPLAY_CHECKPOINT_CONSTITUENT_KINDS;
const [, , , UNAVAILABLE_STATUS] = REPLAY_CHECKPOINT_EVIDENCE_STATUSES;
const SOURCE_STEP = "source";
const OPENED_STEP = "opened";
const COMPRESSOR_STEP = "compressor";
const VERIFIER_STEP = "verifier";
const ACCEPT_STEP = "accept";
const REWIND_STEP = "rewind";
const COMPRESSED_STEP = "compressed";
const RESTORATION_STEP = "restoration";
const CONTROL_STEP = "control";
const OUTCOME_STEP = "outcome";

type CompressionProtocol = {
    readonly bestOfN: number;
    readonly definition: ApplicationProtocolDefinition;
    readonly proposal: readonly ApplicationSchemaSurface[];
    readonly providerCalls: number;
};

type ChildDefinition = {
    readonly budget: unknown;
    readonly grant: unknown;
    readonly program: ((context: never) => unknown) | undefined;
    readonly provenance: unknown;
    readonly provider: unknown;
    readonly task: unknown;
};

type RetainedEntry<T> = {
    readonly body: T;
    readonly record_id: RecordId;
};

type CandidateState = {
    outcome?: RetainedEntry<CompressionCandidateBody> | undefined;
    proposed?: RetainedEntry<CompressionCandidateBody> | undefined;
    rewound?: RetainedEntry<CompressionCandidateBody> | undefined;
};

type RetainedRecords = {
    readonly compression: CandidateState;
    readonly controls: ReadonlyMap<number, RetainedEntry<CompressionCandidateBody>>;
    readonly head: RecordId;
    readonly manifest: ReturnType<typeof readRetainedManifest>;
    readonly opened: RetainedEntry<CompressionOpenedBody>;
    readonly outcome: RetainedEntry<CompressionOutcomeBody> | null;
};

type Run = {
    readonly applicationId: string;
    readonly claimId: string;
    readonly clock: { readonly clock?: () => number };
    readonly compressor: ChildDefinition;
    readonly controlProvider: ((seed: number) => unknown) | null;
    head: RecordId;
    readonly parent: unknown;
    readonly protocol: CompressionProtocol;
    source: ReplaySessionInspection;
    spent: number;
    readonly store: SQLiteTraceStore;
    readonly supervisorId: string;
    readonly verifier: ChildDefinition;
    readonly workflow: TrajectoryCompressionWorkflow;
};

type ChildResult = {
    readonly cost: ApplicationCostSummary;
    /** Acceptance record of a finished child, or the completion record of a failed one. */
    readonly decisionRecordId: RecordId;
    readonly handleId: string;
    /** Terminal status of the child outcome. */
    readonly status: string;
    /** Projected output of a finished child; undefined for a failed one. */
    readonly value: unknown;
};

/**
 * Runs hindsight trajectory compression (Appendix D) over a recorded replay session.
 *
 * The source workflow is recorded once through `runReplaySession` with `program(null)`. A
 * compressor runs as a delegated child through `openChildRun`, `runChildRun`, and
 * `acceptChildRunResult`; it receives the canonical source evidence and returns a proposal
 * `{ fork_point, hint }` as canonical JSON text in the configured output field. The proposal is
 * validated against every protocol `schema` surface of the compression role (`compileJSONSchema`),
 * then against the closed fork-point and hint grammar and the source (Appendix D.5 and D.6): the
 * fork point must name the source session; a step index in `[0, n - 1]` of the `n`-step source must
 * carry the retained prefix identity (null at step `0`, which restarts from the initial prefix with
 * the hint applied); an index outside that range is clamped to the nearest bound under the
 * configured `clamp` fork-step policy, with the proposed step and prefix retained as `fork_clamp`
 * evidence, or refused under the `reject` policy. An absent or null fork point, or one without a
 * step index, is a missing fork step: it settles `no_prune` and the source is the result. A fork point
 * at a retained checkpoint is classified with `classifyReplayCheckpoint`; an `unavailable`
 * classification refuses the prune, retains the classification, constituents, and reason, and
 * settles `no_prune`. Otherwise `rewindReplaySession` restores the fork point, its restore
 * classification and constituents are retained as `rewound`, and `replayReplaySession` re-executes
 * the suffix with `program(guidance)`. A compressed session that finished with strictly fewer steps
 * is gated by a delegated verifier returning `{ verdict, score, reason }`: `accepted` settles
 * `pruned` with the compressed session as the result, and `rejected` settles `restored` after
 * re-running the original suffix with `program(null)` from the same fork point and retains the
 * reason. A compressed session that is not admissible is restored without consulting the verifier.
 * Up to the protocol's best-of-N budget, seeded plain reruns of `program(null)` run as root sessions
 * and are verified as controls. A restoration or control session that ended failed or cancelled is
 * retained as a rejected candidate with the evidence failure and the run stops; a control is never
 * verified unless its session finished. The aggregate outcome record reports measured step-count ratios
 * only, and the manifest is retained last with the terminal cut. Repeating the command resumes from
 * retained evidence: sessions, children, and the rewind are never executed twice, and a completed
 * run returns its retained manifest. A replay session left non-terminal by a dead writer whose
 * lease expired is admitted from its retained records: a rewind with a retained restore record is
 * retained as `rewound` without a second restore, an interrupted compressed session is not
 * admissible and is restored, and an interrupted restoration or control session rejects its
 * candidate. Delegation, lease, and store refusals at a child seam raise without a record; only a
 * child that terminally failed, including one settled by the cancellation path, or an output the
 * grammar refuses is retained as `rejected`.
 *
 * @param store - Open writable trace store.
 * @param options - Command, claim, supervisor, root declaration, protocol, workflow, compressor,
 * verifier, and optional baselines, control provider, and clock.
 * @returns The retained manifest and the record-derived inspection.
 * @throws {ApplicationProtocolError} If the protocol is malformed, is not a trajectory compression
 * protocol, lacks a required surface or budget, declares fewer seeds than its best-of-N budget, or
 * the run was opened under another protocol. Nothing is written.
 * @throws {ApplicationBudgetError} If the best-of-N budget exceeds `limits.maxBestOfN` (nothing is
 * written), the measured source exceeds the provider-call budget (before any application record),
 * a new session or child would exceed it by projection, or a suffix, restoration, or control
 * session's measured calls exceeded it (the session is retained, the candidate is not settled).
 * @throws {ApplicationEvidenceError} If the source did not finish, the compressor terminally fails
 * or returns a proposal the compression schema surface, the grammar, or the source refuses (the
 * cause carries the path-level issues), the rewind fails or retains no restore
 * record, a restoration or control session ended failed or cancelled or was interrupted by a dead
 * writer whose lease expired (the candidate is retained as rejected first), or retained evidence is inconsistent.
 * @throws {ApplicationVerificationError} If a verifier terminally fails or returns a malformed
 * verdict; the candidate is retained as rejected and nothing is pruned.
 * @throws {DelegationCommandConflictError} If a child command is rerun under another supervisor
 * or content; nothing is written.
 * @throws {DelegationStatusError} If a child was left running by a dead process; nothing is
 * written until the cancellation path settles it.
 * @throws {ReplayLeaseConflictError} If a session is held by another writer.
 * @throws {ReplaySessionInterruptedError} If the source session was left non-terminal by a crash
 * (every rerun raises it), or a session is still `running` under a live lease; nothing is written.
 * @throws {TraceStoreError} If the store is closed.
 * @throws {TypeError} If options or a child definition are malformed.
 *
 * @example
 * ```ts
 * const { inspection } = await runTrajectoryCompression(store, {
 *     claimId: "compression",
 *     commandId: "application:compression:1",
 *     compressor: { budget: { maxTurns: 1 }, grant: [], program: propose, task: compressorTask },
 *     parent: { budget: { maxTurns: 8 }, ceiling: [], kind: "root" },
 *     protocol,
 *     supervisorId: "supervisor:compression",
 *     verifier: { budget: { maxTurns: 1 }, grant: [], program: verify, task: verifierTask },
 *     workflow: { program: (guidance) => workflow(guidance), programId: "workflow.v1", provider },
 * });
 * console.log(inspection.outcome?.outcome, inspection.outcome?.step_count_ratio);
 * ```
 */
export async function runTrajectoryCompression(
    store: SQLiteTraceStore,
    options: RunTrajectoryCompressionOptions,
): Promise<TrajectoryCompressionReceipt> {
    const fields = readScopeDataObject(
        options,
        [
            "claimId",
            "commandId",
            "compressor",
            "parent",
            "protocol",
            "supervisorId",
            "verifier",
            "workflow",
        ],
        "runTrajectoryCompression options",
        ["baselines", "clock", "controlProvider"],
    );
    assertScopeText(fields.commandId, "commandId");
    assertScopeText(fields.claimId, "claimId");
    assertScopeText(fields.supervisorId, "supervisorId");
    const protocol = readCompressionProtocol(fields.protocol);
    const protocolId = applicationProtocolId(protocol.definition);
    const workflow = readWorkflow(fields.workflow);
    const compressor = readChild(fields.compressor, "compressor");
    const verifier = readChild(fields.verifier, "verifier");
    const baselines = readCompressionBaselines(fields.baselines ?? []);
    const controlProvider =
        fields.controlProvider === undefined
            ? null
            : (readFunction(fields.controlProvider, "controlProvider") as (
                  seed: number,
              ) => unknown);
    const clock =
        fields.clock === undefined
            ? {}
            : { clock: readFunction(fields.clock, "clock") as () => number };
    const applicationId = deriveApplicationOwnerId(fields.commandId);
    const controls = protocol.definition.seeds.slice(0, protocol.bestOfN);
    let retained =
        store.readOwner(applicationId).length === 0
            ? null
            : readCompressionRecords(store, applicationId);
    if (retained !== null) {
        const opened = retained.opened.body;
        if (opened.protocol_id !== protocolId) {
            throw new ApplicationProtocolError(
                `application ${applicationId} was opened under another protocol`,
            );
        }
        assert(
            opened.command_id === fields.commandId &&
                canonical(opened.baselines) === canonical(baselines),
            `application ${applicationId} was opened with different baselines`,
        );
        if (retained.manifest !== null) {
            return Object.freeze({
                inspection: inspectTrajectoryCompression(store, applicationId),
                manifest: retained.manifest.manifest,
            });
        }
    }
    const run: Run = {
        applicationId,
        claimId: fields.claimId,
        clock,
        compressor,
        controlProvider,
        head: "" as RecordId,
        parent: fields.parent,
        protocol,
        source: null as unknown as ReplaySessionInspection,
        spent: 0,
        store,
        supervisorId: fields.supervisorId,
        verifier,
        workflow,
    };
    const source = (
        await runReplaySession(store, {
            ...sessionBindings(run, commandOf(run, SOURCE_STEP, {})),
            ...(await boundResources(run, SOURCE_STEP, null, true)),
            ...definedFields({ task: workflow.task }),
            program: workflow.program(null),
            programId: workflow.programId,
            ...definedFields({ provider: workflow.provider }),
        })
    ).inspection;
    const sourceTerminal = source.terminal as ReplayTerminalInspection;
    if (sourceTerminal.status !== FINISHED_SESSION) {
        throw new ApplicationEvidenceError(
            `source session ${source.session_id} did not finish and cannot be compressed`,
        );
    }
    run.source = source;
    run.spent = measureReplaySessionCost(source).provider_calls;
    assertMeasuredBudget(run, source.session_id);
    if (retained === null) {
        append(
            run,
            null,
            OPENED_STEP,
            {
                application_id: applicationId,
                baselines,
                command_id: fields.commandId,
                controls,
                kind: COMPRESSION_KIND,
                phase: OPENED_PHASE,
                protocol_id: protocolId,
                source_session_id: source.session_id,
            },
            [sourceTerminal.record_id],
        );
        retained = readCompressionRecords(store, applicationId);
    }
    run.head = retained.head;
    await settleCompression(run, retained.compression);
    for (const seed of controls) {
        await settleControl(run, retained.controls.get(seed), seed);
    }
    const settled = readCompressionRecords(store, applicationId);
    if (settled.outcome === null) {
        const body = outcomeBody(run, settled, baselines);
        append(run, run.head, OUTCOME_STEP, body.fields, body.causes);
    }
    const receipt = retainApplicationManifest(store, {
        manifest: buildManifest(run, readCompressionRecords(store, applicationId)),
    });
    return Object.freeze({
        inspection: inspectTrajectoryCompression(store, applicationId),
        manifest: receipt.manifest,
    });
}

/**
 * Reads one trajectory compression run as an immutable record-derived view without mutation.
 *
 * Every record on the application owner path is validated: the opened record, the compression
 * candidate's proposed, rewound, and settled or rejected records in order with an identical
 * proposal and derived fork, session, and handle identities, each control seed's record in seed
 * order, the aggregate outcome consistent with the candidates, the manifest, and the terminal cut.
 * Inspection works on reopened, read-only, and imported stores and is identical across them.
 *
 * @param store - Open trace store, writable or read-only.
 * @param applicationId - Application identity derived by {@link deriveApplicationOwnerId}.
 * @returns The validated inspection.
 * @throws {ApplicationEvidenceError} If the application is not retained or its evidence is
 * inconsistent.
 * @throws {TraceStoreError} If the store is closed.
 * @throws {TypeError} If the application identity is malformed.
 *
 * @example
 * ```ts
 * const inspection = inspectTrajectoryCompression(store, deriveApplicationOwnerId(commandId));
 * console.log(inspection.compression.outcome?.outcome ?? "not settled");
 * ```
 */
export function inspectTrajectoryCompression(
    store: SQLiteTraceStore,
    applicationId: string,
): TrajectoryCompressionInspection {
    assertApplicationDigest(applicationId, config.identity.applicationIdPrefix, "applicationId");
    const retained = readCompressionRecords(store, applicationId);
    const opened = retained.opened.body;
    const manifest = retained.manifest;
    return Object.freeze({
        application_id: applicationId,
        baselines: opened.baselines,
        command_id: opened.command_id,
        compression: candidateInspection(COMPRESSION_CANDIDATE, null, retained.compression),
        controls: Object.freeze(
            opened.controls.map((seed) =>
                candidateInspection(CONTROL_CANDIDATE, seed, {
                    outcome: retained.controls.get(seed),
                }),
            ),
        ),
        cut_id: manifest === null ? null : manifest.cut_id,
        kind: opened.kind,
        manifest: manifest === null ? null : manifest.manifest,
        manifest_record_id: manifest === null ? null : manifest.record_id,
        opened_record_id: retained.opened.record_id,
        outcome:
            retained.outcome === null
                ? null
                : (Object.freeze({
                      ...stripRecord(retained.outcome.body),
                      record_id: retained.outcome.record_id,
                  }) as unknown as TrajectoryCompressionOutcomeRecord),
        protocol_id: opened.protocol_id,
        source_session_id: opened.source_session_id,
    });
}

async function settleCompression(run: Run, state: CandidateState): Promise<void> {
    if (state.outcome !== undefined) {
        resumeSettled(run, state.outcome.body);
        return;
    }
    const { applicationId, source } = run;
    const compressorCommand = commandOf(run, COMPRESSOR_STEP, {});
    const base = {
        candidate: COMPRESSION_CANDIDATE,
        compressor_handle_id: createChildRunHandleId(compressorCommand),
        seed: null,
    };
    let forkPoint: TrajectoryForkPoint | null;
    let forkClamp: TrajectoryForkClamp | null;
    let hint: TrajectoryHint | null;
    assertChildBudget(run, compressorCommand);
    // Delegation, lease, and store refusals raise from the seam without a record: only a child
    // that terminally failed or a proposal the grammar or the source refuses is retained.
    const proposed = await runDelegatedChild(
        run,
        run.compressor,
        compressorCommand,
        { source },
        {
            application_id: applicationId,
            source: sessionEvidence(source),
        },
    );
    try {
        const proposalValue = snapshot(readChildValue(proposed, COMPRESSOR_STEP));
        assertApplicationMessage(
            run.protocol.proposal,
            proposalValue as SemanticValue,
            "compressor proposal",
        );
        const proposal = readTrajectoryProposal(proposalValue);
        const resolved = resolveTrajectoryProposal(
            proposal,
            source,
            compression.forkStepPolicy as TrajectoryForkStepPolicy,
        );
        forkPoint = resolved.fork_point;
        forkClamp = resolved.fork_clamp;
        hint = proposal.hint;
    } catch (error) {
        retainFailure(
            run,
            candidateFields({ ...base, status: REJECTED }),
            [],
            {
                code: config.errors.evidenceCode,
                reason: `compressor proposal of application ${applicationId} is invalid`,
            },
            error,
        );
    }
    const hintDigest = hint === null ? null : applicationDigest(hint as unknown as SemanticValue);
    const proposalFields = {
        ...base,
        fork_id:
            forkPoint === null
                ? null
                : prefixedApplicationId(config.identity.forkPointIdPrefix, {
                      application_id: applicationId,
                      fork_point: forkPoint,
                      hint_digest: hintDigest,
                  }),
        fork_clamp: forkClamp,
        fork_point: forkPoint,
        hint_digest: hintDigest,
    };
    const causes = [proposed.decisionRecordId];
    if (state.proposed === undefined) {
        append(
            run,
            run.head,
            candidateStep(COMPRESSION_CANDIDATE, null, PROPOSED),
            candidateFields({ ...proposalFields, status: PROPOSED }),
            causes,
        );
    }
    if (forkPoint === null) {
        settleNoPrune(run, proposalFields, null, compression.reasons.noForkPoint, proposed.cost);
        return;
    }
    const checkpoint =
        source.checkpoints.find((entry) => entry.step_count === forkPoint.step_index) ?? null;
    if (checkpoint === null && (source.worlds.length > 0 || source.processes.length > 0)) {
        // A world- or process-bound source is restorable only at a retained checkpoint.
        settleNoPrune(
            run,
            proposalFields,
            {
                classification: UNAVAILABLE,
                constituents: [
                    ...source.worlds.map((name) => ({ kind: WORLD_CONSTITUENT, name })),
                    ...source.processes.map((entry) => ({
                        kind: PROCESS_CONSTITUENT,
                        name: entry.process_id,
                    })),
                ].map((entry) => ({
                    ...entry,
                    reason: replayProtocolConfig.checkpoint.reasons.boundaryWithoutCheckpoint,
                    status: UNAVAILABLE_STATUS,
                })) as TrajectoryRestoreEvidence["constituents"],
                restore_record_id: null,
                rewind_session_id: null,
            },
            compression.reasons.restoreUnavailable,
            proposed.cost,
        );
        return;
    }
    if (checkpoint !== null) {
        const classified = classifyReplayCheckpoint(checkpoint);
        if (classified.classification === UNAVAILABLE) {
            settleNoPrune(
                run,
                proposalFields,
                {
                    classification: classified.classification,
                    constituents: restoreConstituents(checkpoint.constituents),
                    restore_record_id: null,
                    rewind_session_id: null,
                },
                compression.reasons.restoreUnavailable,
                proposed.cost,
            );
            return;
        }
    }
    const target: ReplayTarget =
        checkpoint === null
            ? { stepCount: forkPoint.step_index }
            : { checkpointId: checkpoint.checkpoint_id };
    // The rewind is restoration evidence only: a rewind left non-terminal by a dead writer after
    // its restore record is admitted from that record, never restored a second time.
    const rewindBound = await boundResources(run, REWIND_STEP, null, false);
    const rewind = await sessionOrInterrupted(run, () =>
        rewindReplaySession(run.store, {
            ...sessionBindings(run, commandOf(run, REWIND_STEP, {})),
            ...rewindBound,
            // The source stays the uncompressed trajectory the result is measured against.
            sourceDisposition: RETAIN_SOURCE,
            sourceSessionId: source.session_id,
            target,
        }),
    );
    const rewindTerminal = rewind.terminal;
    if (
        rewind.restore === null ||
        (rewindTerminal !== null && rewindTerminal.status !== REWOUND_SESSION)
    ) {
        retainFailure(
            run,
            candidateFields({ ...proposalFields, status: REJECTED }),
            // The head is the terminal record once the rewind settled, else its last evidence.
            [rewind.head_record_id],
            {
                code: config.errors.evidenceCode,
                reason: `rewind of application ${applicationId} did not restore the fork point`,
            },
        );
    }
    const restored = rewind.restore as ReplayRestoreInspection;
    const rewoundFields = {
        ...proposalFields,
        restore: {
            classification: restored.classification,
            constituents: restoreConstituents(restored.constituents),
            restore_record_id: restored.record_id,
            rewind_session_id: rewind.session_id,
        },
    };
    if (state.rewound === undefined) {
        append(
            run,
            run.head,
            candidateStep(COMPRESSION_CANDIDATE, null, REWOUND),
            candidateFields({ ...rewoundFields, status: REWOUND }),
            rewindTerminal === null
                ? [restored.record_id]
                : [restored.record_id, rewindTerminal.record_id],
        );
    }
    const compressed = await replaySuffix(
        run,
        COMPRESSED_STEP,
        target,
        forkPoint.step_index,
        run.workflow.program({ fork_point: forkPoint, hint }),
    );
    // An interrupted compressed session (dead writer, expired lease) is not admissible.
    const compressedTerminal = compressed.terminal;
    let cost = addApplicationCosts(proposed.cost, measureReplaySessionCost(compressed));
    const settledCauses: RecordId[] = [
        compressedTerminal === null ? compressed.head_record_id : compressedTerminal.record_id,
    ];
    let verdict: ReturnType<typeof readTrajectoryVerdict> | null = null;
    let verifierHandleId: string | null = null;
    if (
        compressedTerminal !== null &&
        compressedTerminal.status === FINISHED_SESSION &&
        compressedTerminal.step_count < (source.terminal as ReplayTerminalInspection).step_count
    ) {
        const verified = await verify(
            run,
            COMPRESSION_CANDIDATE,
            null,
            compressed,
            forkPoint,
            hint,
            candidateFields({
                ...rewoundFields,
                session_id: compressed.session_id,
                status: REJECTED,
            }),
            settledCauses,
        );
        verifierHandleId = verified.handleId;
        verdict = verified.verdict;
        cost = addApplicationCosts(cost, verified.cost);
        settledCauses.push(verified.decisionRecordId);
    }
    const pruned = verdict !== null && verdict.verdict === ACCEPTED;
    let restorationSessionId: string | null = null;
    if (!pruned) {
        const restoration = await replaySuffix(
            run,
            RESTORATION_STEP,
            target,
            forkPoint.step_index,
            run.workflow.program(null),
        );
        if (restoration.terminal === null) {
            retainInterruption(
                run,
                candidateFields({
                    ...rewoundFields,
                    session_id: compressed.session_id,
                    status: REJECTED,
                    verifier_handle_id: verifierHandleId,
                }),
                [...settledCauses, restoration.head_record_id],
                restoration,
            );
        }
        assertFinished(
            run,
            candidateFields({
                ...rewoundFields,
                session_id: compressed.session_id,
                status: REJECTED,
                verifier_handle_id: verifierHandleId,
            }),
            [...settledCauses, restoration.terminal.record_id],
            restoration,
        );
        restorationSessionId = restoration.session_id;
        cost = addApplicationCosts(cost, measureReplaySessionCost(restoration));
        settledCauses.push(restoration.terminal.record_id);
    }
    append(
        run,
        run.head,
        candidateStep(COMPRESSION_CANDIDATE, null, SETTLED),
        candidateFields({
            ...rewoundFields,
            cost,
            outcome: pruned ? PRUNED : RESTORED,
            reason: verdict === null ? compression.reasons.notAdmissible : verdict.reason,
            restoration_session_id: restorationSessionId,
            score: verdict === null ? null : verdict.score,
            session_id: compressed.session_id,
            status: SETTLED,
            step_count:
                compressedTerminal === null
                    ? compressed.steps.length
                    : compressedTerminal.step_count,
            verdict: verdict === null ? null : verdict.verdict,
            verifier_handle_id: verifierHandleId,
        }),
        settledCauses,
    );
}

function settleNoPrune(
    run: Run,
    proposalFields: Readonly<Record<string, unknown>>,
    restore: TrajectoryRestoreEvidence | null,
    reason: string,
    cost: ApplicationCostSummary,
): void {
    append(
        run,
        run.head,
        candidateStep(COMPRESSION_CANDIDATE, null, SETTLED),
        candidateFields({
            ...proposalFields,
            cost,
            outcome: NO_PRUNE,
            reason,
            restore,
            status: SETTLED,
            step_count: (run.source.terminal as ReplayTerminalInspection).step_count,
        }),
        [],
    );
}

async function settleControl(
    run: Run,
    retained: RetainedEntry<CompressionCandidateBody> | undefined,
    seed: number,
): Promise<void> {
    if (retained !== undefined) {
        resumeSettled(run, retained.body);
        return;
    }
    const { source, workflow } = run;
    const commandId = commandOf(run, CONTROL_STEP, { seed });
    if (run.store.readOwner(deriveReplaySessionId(commandId)).length === 0) {
        assertBudget(run, providerSteps(source, 0));
    }
    const bound = await boundResources(run, CONTROL_STEP, seed, true);
    const control = await sessionOrInterrupted(run, () =>
        runReplaySession(run.store, {
            ...sessionBindings(run, commandId),
            ...bound,
            ...definedFields({
                provider:
                    run.controlProvider === null ? workflow.provider : run.controlProvider(seed),
                task: workflow.task,
            }),
            program: workflow.program(null),
            programId: workflow.programId,
        }),
    );
    const measured = measureReplaySessionCost(control);
    run.spent += measured.provider_calls;
    assertMeasuredBudget(run, control.session_id);
    const terminal = control.terminal;
    if (terminal === null) {
        retainInterruption(
            run,
            candidateFields({
                candidate: CONTROL_CANDIDATE,
                seed,
                session_id: control.session_id,
                status: REJECTED,
            }),
            [control.head_record_id],
            control,
        );
    }
    const causes: RecordId[] = [terminal.record_id];
    // A control that failed or was cancelled is never verified, so it can never be the best control.
    assertFinished(
        run,
        candidateFields({
            candidate: CONTROL_CANDIDATE,
            seed,
            session_id: control.session_id,
            status: REJECTED,
        }),
        causes,
        control,
    );
    const verified = await verify(
        run,
        CONTROL_CANDIDATE,
        seed,
        control,
        null,
        null,
        candidateFields({
            candidate: CONTROL_CANDIDATE,
            seed,
            session_id: control.session_id,
            status: REJECTED,
        }),
        causes,
    );
    append(
        run,
        run.head,
        candidateStep(CONTROL_CANDIDATE, seed, SETTLED),
        candidateFields({
            candidate: CONTROL_CANDIDATE,
            cost: addApplicationCosts(measured, verified.cost),
            reason: verified.verdict.reason,
            score: verified.verdict.score,
            seed,
            session_id: control.session_id,
            status: SETTLED,
            step_count: terminal.step_count,
            verdict: verified.verdict.verdict,
            verifier_handle_id: verified.handleId,
        }),
        [...causes, verified.decisionRecordId],
    );
}

function resumeSettled(run: Run, body: CompressionCandidateBody): void {
    if (body.failure !== null) {
        throw failureError(body.failure);
    }
    run.spent += (body.cost as ApplicationCostSummary).provider_calls;
}

async function verify(
    run: Run,
    candidate: TrajectoryCompressionCandidateKind,
    seed: number | null,
    compressed: ReplaySessionInspection,
    forkPoint: TrajectoryForkPoint | null,
    hint: TrajectoryHint | null,
    rejected: Readonly<Record<string, unknown>>,
    causes: readonly RecordId[],
): Promise<{
    readonly cost: ApplicationCostSummary;
    readonly decisionRecordId: RecordId;
    readonly handleId: string;
    readonly verdict: ReturnType<typeof readTrajectoryVerdict>;
}> {
    const commandId = commandOf(run, VERIFIER_STEP, { candidate, seed });
    const handleId = createChildRunHandleId(commandId);
    const context = {
        candidate,
        compressed,
        fork_point: forkPoint,
        hint,
        original: run.source,
        seed,
    };
    assertChildBudget(run, commandId);
    // Seam refusals raise without a record; only a failed child or a malformed verdict is retained.
    const result = await runDelegatedChild(run, run.verifier, commandId, context, {
        candidate,
        compressed: sessionEvidence(compressed),
        fork_point: forkPoint,
        hint,
        original: sessionEvidence(run.source),
        seed,
    } as unknown as SemanticRecord);
    try {
        return Object.freeze({
            cost: result.cost,
            decisionRecordId: result.decisionRecordId,
            handleId,
            verdict: readTrajectoryVerdict(snapshot(readChildValue(result, VERIFIER_STEP))),
        });
    } catch (error) {
        return retainFailure(
            run,
            { ...rejected, verifier_handle_id: handleId },
            causes,
            {
                code: config.errors.verificationCode,
                reason: `verifier of ${candidate} candidate in application ${run.applicationId} failed`,
            },
            error,
        );
    }
}

async function runDelegatedChild(
    run: Run,
    definition: ChildDefinition,
    commandId: string,
    context: object,
    evidence: SemanticRecord,
): Promise<ChildResult> {
    const { store } = run;
    const { handle } = openChildRun(store, {
        budget: definition.budget as never,
        commandId,
        grant: definition.grant as never,
        input: { [compression.childFields.input]: canonical(evidence) },
        parent: run.parent as never,
        ...definedFields({ provenance: definition.provenance }),
        supervisorId: run.supervisorId,
        task: definition.task as never,
    });
    run.spent += 1;
    const program = definition.program;
    const ran = await runChildRun(store, {
        handle,
        ...(program === undefined
            ? { provider: definition.provider }
            : {
                  program: (childContext: ChildRunProgramContext) =>
                      program(Object.freeze({ ...childContext, ...context }) as never),
              }),
    } as RunChildRunOptions);
    const usages = [(ran.inspection.child as DurableTaskExecutionInspection).usage]
        .filter((entry) => entry !== null)
        .map((entry) => entry.usage as RunUsage);
    const cost = foldApplicationCosts(usages, 1);
    const completion = ran.inspection.completion as ChildRunCompletionInspection;
    if (completion.status !== FINISHED_CHILD) {
        return Object.freeze({
            cost,
            decisionRecordId: completion.record_id,
            handleId: handle.handle_id,
            status: completion.status,
            value: undefined,
        });
    }
    const accepted = acceptChildRunResult(store, {
        commandId: commandOf(run, ACCEPT_STEP, { handle_id: handle.handle_id }),
        handle,
        supervisorId: run.supervisorId,
    });
    return Object.freeze({
        cost,
        decisionRecordId: accepted.record_id,
        handleId: handle.handle_id,
        status: completion.status,
        value: projectChildRunResult(store, handle.handle_id).value,
    });
}

/**
 * Reads a delegated child's canonical output text; a child that terminally failed (including one
 * the documented cancellation path settled) has no output and is refused.
 */
function readChildValue(result: ChildResult, subject: string): unknown {
    if (result.status !== FINISHED_CHILD) {
        throw new TypeError(`${subject} child ${result.handleId} ended ${result.status}`);
    }
    return readChildOutputText(result.value);
}

/**
 * Starts or returns one replay session. A session left non-terminal by a dead writer whose lease
 * expired is returned as retained so the caller decides what it proves; a session still held under
 * a live lease, and every other refusal, raises without a record.
 */
async function sessionOrInterrupted(
    run: Run,
    start: () => Promise<ReplaySessionReceipt>,
): Promise<ReplaySessionInspection> {
    try {
        return (await start()).inspection;
    } catch (error) {
        if (
            !(error instanceof ReplaySessionInterruptedError) ||
            error.classification === RUNNING_SESSION
        ) {
            throw error;
        }
        return inspectReplaySession(run.store, { sessionId: error.session_id, ...run.clock });
    }
}

async function replaySuffix(
    run: Run,
    step: string,
    target: ReplayTarget,
    stepIndex: number,
    program: ReplaySessionProgram,
): Promise<ReplaySessionInspection> {
    const { source, store, workflow } = run;
    const commandId = commandOf(run, step, {});
    if (store.readOwner(deriveReplaySessionId(commandId)).length === 0) {
        assertBudget(run, providerSteps(source, stepIndex));
    }
    const bound = await boundResources(run, step, null, true);
    const inspection = await sessionOrInterrupted(run, () =>
        replayReplaySession(store, {
            ...sessionBindings(run, commandId),
            ...bound,
            ...definedFields({ provider: workflow.provider }),
            program,
            sourceDisposition: RETAIN_SOURCE,
            sourceSessionId: source.session_id,
            target,
        }),
    );
    run.spent += measureReplaySessionCost(inspection).provider_calls;
    assertMeasuredBudget(run, inspection.session_id);
    return inspection;
}

function outcomeBody(
    run: Run,
    retained: RetainedRecords,
    baselines: readonly TrajectoryCompressionBaselineKind[],
): { readonly causes: readonly RecordId[]; readonly fields: Readonly<Record<string, unknown>> } {
    const { source, store } = run;
    const original = (source.terminal as ReplayTerminalInspection).step_count;
    const settled = retained.compression.outcome as RetainedEntry<CompressionCandidateBody>;
    const resultSessionId = resultSessionOf(settled.body, source.session_id);
    const result = inspectReplaySession(store, { sessionId: resultSessionId, ...run.clock });
    const resultSteps = (result.terminal as ReplayTerminalInspection).step_count;
    const best = bestControl(retained);
    return {
        causes: [
            settled.record_id,
            ...[...retained.controls.values()].map((entry) => entry.record_id),
        ],
        fields: {
            application_id: run.applicationId,
            baseline: baselines.includes(NO_COMPRESSION)
                ? {
                      kind: NO_COMPRESSION,
                      session_id: source.session_id,
                      step_count: original,
                      step_count_ratio: stepCountRatio(original, original),
                  }
                : null,
            control:
                best === null
                    ? null
                    : {
                          seed: best.seed,
                          session_id: best.session_id,
                          step_count: best.step_count,
                          step_count_ratio: stepCountRatio(best.step_count as number, original),
                      },
            original_step_count: original,
            outcome: settled.body.outcome,
            phase: OUTCOME_PHASE,
            result_session_id: resultSessionId,
            result_step_count: resultSteps,
            step_count_ratio: stepCountRatio(resultSteps, original),
        },
    };
}

function bestControl(retained: RetainedRecords): CompressionCandidateBody | null {
    return [...retained.controls.values()]
        .map((entry) => entry.body)
        .filter((body) => body.verdict === ACCEPTED)
        .reduce<CompressionCandidateBody | null>(
            (leader, body) =>
                leader !== null && (leader.step_count as number) <= (body.step_count as number)
                    ? leader
                    : body,
            null,
        );
}

function resultSessionOf(body: CompressionCandidateBody, sourceSessionId: string): string {
    if (body.outcome === PRUNED) {
        return body.session_id as string;
    }
    return body.outcome === RESTORED ? (body.restoration_session_id as string) : sourceSessionId;
}

function buildManifest(run: Run, retained: RetainedRecords) {
    const { source, store } = run;
    const roles = compression.artifactRoles;
    const artifacts: ApplicationArtifactSource[] = [sessionArtifact(roles.source, source)];
    let costs = measureReplaySessionCost(source);
    const candidates = [
        retained.compression.outcome as RetainedEntry<CompressionCandidateBody>,
        ...retained.controls.values(),
    ];
    for (const entry of candidates) {
        const body = entry.body;
        artifacts.push({
            content: body as unknown as SemanticValue,
            cut_id: null,
            record_id: entry.record_id,
            role: roles.candidate,
        });
        costs = addApplicationCosts(costs, body.cost as ApplicationCostSummary);
        for (const [role, handleId] of [
            [roles.compressor, body.compressor_handle_id],
            [roles.verifier, body.verifier_handle_id],
        ] as const) {
            if (handleId !== null) {
                artifacts.push(childArtifact(store, role, handleId));
            }
        }
        const sessionRole = body.candidate === CONTROL_CANDIDATE ? roles.control : roles.compressed;
        for (const [role, sessionId] of [
            [roles.rewind, body.restore === null ? null : body.restore.rewind_session_id],
            [sessionRole, body.session_id],
            [roles.restoration, body.restoration_session_id],
        ] as const) {
            if (sessionId !== null) {
                artifacts.push(
                    sessionArtifact(role, inspectReplaySession(store, { sessionId, ...run.clock })),
                );
            }
        }
    }
    const outcome = retained.outcome as RetainedEntry<CompressionOutcomeBody>;
    artifacts.push({
        content: outcome.body as unknown as SemanticValue,
        cut_id: null,
        record_id: outcome.record_id,
        role: roles.outcome,
    });
    return createApplicationManifest({
        applicationId: run.applicationId,
        artifacts,
        costs,
        protocol: run.protocol.definition,
    });
}

function sessionArtifact(
    role: string,
    session: ReplaySessionInspection,
): ApplicationArtifactSource {
    // A session interrupted by a dead writer is cited at its retained head.
    const terminal = session.terminal;
    return {
        content: {
            prefix_id: terminal === null ? null : terminal.prefix_id,
            session_id: session.session_id,
            status: terminal === null ? null : terminal.status,
            step_count: terminal === null ? session.steps.length : terminal.step_count,
            terminal_record_id: terminal === null ? null : terminal.record_id,
        },
        cut_id: null,
        record_id: terminal === null ? session.head_record_id : terminal.record_id,
        role,
    };
}

function childArtifact(
    store: SQLiteTraceStore,
    role: string,
    handleId: string,
): ApplicationArtifactSource {
    const inspection = inspectChildRun(store, handleId);
    const cutId = (inspection.completion as ChildRunCompletionInspection).child_cut_id;
    return {
        content: {
            child_cut_id: cutId,
            handle_id: handleId,
            head_record_id: inspection.head_record_id,
            status: inspection.status,
        },
        cut_id: cutId,
        record_id: inspection.head_record_id,
        role,
    };
}

function sessionEvidence(session: ReplaySessionInspection): SemanticRecord {
    // Only finished sessions reach child evidence, and a finished terminal always retains a result.
    const terminal = session.terminal as ReplayTerminalInspection;
    return {
        checkpoints: session.checkpoints.map((checkpoint) => ({
            checkpoint_id: checkpoint.checkpoint_id,
            classification: checkpoint.classification,
            prefix_id: checkpoint.prefix_id,
            step_count: checkpoint.step_count,
        })),
        result: (terminal.result as { readonly value: SemanticValue }).value,
        session_id: session.session_id,
        status: terminal.status,
        step_count: terminal.step_count,
        steps: session.steps.map((step) => ({
            depends_on: step.depends_on,
            index: step.index,
            intent: step.effect === null ? null : step.effect.intent,
            kind: step.kind,
            prefix_id: step.prefix_id,
            request: step.provider === null ? null : step.provider.request,
            response:
                step.provider === null || step.provider.response === null
                    ? null
                    : step.provider.response.output,
            source: step.source,
        })),
    } as unknown as SemanticRecord;
}

function restoreConstituents(
    constituents: readonly ReplayConstituent[],
): TrajectoryRestoreEvidence["constituents"] {
    return constituents.map((constituent) => ({
        kind: constituent.kind,
        name: constituent.name,
        reason: constituent.reason,
        status: constituent.status,
    }));
}

function candidateFields(
    fields: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
    return {
        compressor_handle_id: null,
        cost: null,
        failure: null,
        fork_clamp: null,
        fork_id: null,
        fork_point: null,
        hint_digest: null,
        outcome: null,
        reason: null,
        restoration_session_id: null,
        restore: null,
        score: null,
        session_id: null,
        step_count: null,
        verdict: null,
        verifier_handle_id: null,
        ...fields,
        phase: CANDIDATE_PHASE,
    };
}

function candidateStep(
    candidate: TrajectoryCompressionCandidateKind,
    seed: number | null,
    status: string,
): string {
    return `${candidate}:${String(seed)}:${status}`;
}

function retainFailure(
    run: Run,
    fields: Readonly<Record<string, unknown>>,
    causes: readonly RecordId[],
    failure: TrajectoryCompressionFailure,
    cause?: unknown,
): never {
    append(
        run,
        run.head,
        candidateStep(
            fields.candidate as TrajectoryCompressionCandidateKind,
            fields.seed as number | null,
            REJECTED,
        ),
        { ...fields, failure },
        causes,
    );
    throw failureError(failure, cause);
}

/**
 * Retains the candidate as rejected with the evidence failure and raises when a restoration or
 * control session ended with any terminal status other than finished.
 */
function assertFinished(
    run: Run,
    fields: Readonly<Record<string, unknown>>,
    causes: readonly RecordId[],
    session: ReplaySessionInspection,
): void {
    const status = (session.terminal as ReplayTerminalInspection).status;
    if (status !== FINISHED_SESSION) {
        retainFailure(run, fields, causes, {
            code: config.errors.evidenceCode,
            reason: `${fields.candidate as string} candidate session ${session.session_id} ended ${status} instead of finished`,
        });
    }
}

function retainInterruption(
    run: Run,
    fields: Readonly<Record<string, unknown>>,
    causes: readonly RecordId[],
    session: ReplaySessionInspection,
): never {
    return retainFailure(
        run,
        fields,
        causes,
        {
            code: config.errors.evidenceCode,
            reason: `${fields.candidate as string} candidate session ${session.session_id} was interrupted before its terminal record`,
        },
        new ReplaySessionInterruptedError(session.session_id, session.classification),
    );
}

function failureError(
    failure: TrajectoryCompressionFailure,
    cause?: unknown,
): ApplicationEvidenceError | ApplicationVerificationError {
    return failure.code === config.errors.verificationCode
        ? new ApplicationVerificationError(failure.reason, { cause })
        : new ApplicationEvidenceError(failure.reason, { cause });
}

function append(
    run: Run,
    head: RecordId | null,
    step: string,
    fields: Readonly<Record<string, unknown>>,
    causes: readonly RecordId[],
): void {
    const body = createVersionedApplicationBody({
        ...fields,
        application_id: run.applicationId,
    });
    const appended = run.store.appendApplicationRecord(
        run.applicationId,
        head,
        createApplicationAppendRequest(
            createApplicationAppendIntentId(run.applicationId, step),
            run.applicationId,
            body,
            config.traceSchemas.compression,
            [...new Set([...(head === null ? [] : [head]), ...causes])],
        ),
        null,
    );
    if (appended.status === "head_moved") {
        throw new ApplicationEvidenceError(`application ${run.applicationId} head moved`);
    }
    run.head = appended.receipt.record_ids[0] as RecordId;
}

function readCompressionRecords(store: SQLiteTraceStore, applicationId: string): RetainedRecords {
    const records = store.readOwner(applicationId);
    const [first, ...rest] = records;
    assert(first !== undefined, `application ${applicationId} is not retained`);
    assertRecord(first, config.traceSchemas.compression);
    const opened = readCompressionOpenedBody(first.body);
    const commandOfOpened = (step: string, fields: SemanticRecord) =>
        createApplicationCommandId(applicationId, step, fields);
    assert(
        opened.application_id === applicationId &&
            deriveApplicationOwnerId(opened.command_id) === applicationId &&
            opened.source_session_id === deriveReplaySessionId(commandOfOpened(SOURCE_STEP, {})),
        "opened record names another application or source session",
    );
    const manifest = readRetainedManifest(store, applicationId);
    const state: CandidateState = {};
    const controls = new Map<number, RetainedEntry<CompressionCandidateBody>>();
    let head = first.envelope.record_id;
    let outcome: RetainedEntry<CompressionOutcomeBody> | null = null;
    let stopped = false;
    let manifestSeen = false;
    let terminal = false;
    for (const record of rest) {
        const schemaRef = record.envelope.schema_ref;
        assert(!terminal, "application retains a record after its terminal cut");
        assert(
            !stopped && record.envelope.caused_by_record_ids[0] === head,
            "compression record is late or does not follow the application head",
        );
        if (schemaRef === config.traceSchemas.compression && outcome === null) {
            assertRecord(record, schemaRef);
            if (record.body.phase === OUTCOME_PHASE) {
                const body = readCompressionOutcomeBody(record.body);
                assertOutcome(body, applicationId, opened, state, controls);
                outcome = Object.freeze({ body, record_id: record.envelope.record_id });
            } else {
                const body = readCompressionCandidateBody(record.body);
                const entry = Object.freeze({ body, record_id: record.envelope.record_id });
                assert(
                    body.application_id === applicationId,
                    "candidate record names another application",
                );
                if (state.outcome === undefined) {
                    acceptCompressionRecord(state, entry, applicationId, opened);
                } else {
                    const seed = opened.controls[controls.size];
                    assert(
                        body.candidate === CONTROL_CANDIDATE &&
                            body.seed === seed &&
                            body.session_id ===
                                deriveReplaySessionId(commandOfOpened(CONTROL_STEP, { seed })) &&
                            ((body.status === REJECTED && body.verifier_handle_id === null) ||
                                body.verifier_handle_id ===
                                    createChildRunHandleId(
                                        commandOfOpened(VERIFIER_STEP, {
                                            candidate: CONTROL_CANDIDATE,
                                            seed,
                                        }),
                                    )),
                        "control record is out of seed order or names another session",
                    );
                    controls.set(seed as number, entry);
                }
                stopped = body.failure !== null;
            }
        } else if (schemaRef === config.traceSchemas.manifest) {
            assertRecord(record, schemaRef);
            assert(
                outcome !== null &&
                    manifest !== null &&
                    manifest.record_id === record.envelope.record_id &&
                    manifest.manifest.protocol_id === opened.protocol_id &&
                    manifest.manifest.kind === COMPRESSION_KIND,
                "manifest record does not follow the compression outcome",
            );
            manifestSeen = true;
        } else {
            assertRecord(record, kernelProtocolConfig.queries.cutSchemaRef);
            assert(
                manifestSeen &&
                    record.body.cut_id === (manifest as { readonly cut_id: string }).cut_id,
                "application retains an unsupported record",
            );
            terminal = true;
        }
        head = record.envelope.record_id;
    }
    return Object.freeze({
        compression: state,
        controls,
        head,
        manifest,
        opened: Object.freeze({ body: opened, record_id: first.envelope.record_id }),
        outcome,
    });
}

function acceptCompressionRecord(
    state: CandidateState,
    entry: RetainedEntry<CompressionCandidateBody>,
    applicationId: string,
    opened: CompressionOpenedBody,
): void {
    const body = entry.body;
    const commandOfOpened = (step: string, fields: SemanticRecord) =>
        createApplicationCommandId(applicationId, step, fields);
    const earlier = state.rewound ?? state.proposed;
    const forkPoint = body.fork_point;
    const settledCompressed = body.outcome === PRUNED || body.outcome === RESTORED;
    assert(
        [
            body.candidate === COMPRESSION_CANDIDATE,
            body.compressor_handle_id ===
                createChildRunHandleId(commandOfOpened(COMPRESSOR_STEP, {})),
            forkPoint === null ||
                (forkPoint.session_id === opened.source_session_id &&
                    body.fork_id ===
                        prefixedApplicationId(config.identity.forkPointIdPrefix, {
                            application_id: applicationId,
                            fork_point: forkPoint,
                            hint_digest: body.hint_digest,
                        })),
            body.status === PROPOSED
                ? earlier === undefined
                : body.status === REWOUND
                  ? state.proposed !== undefined && state.rewound === undefined
                  : (body.status === REJECTED && earlier === undefined) ||
                    (state.proposed !== undefined &&
                        (state.rewound !== undefined) ===
                            (settledCompressed ||
                                (body.status === REJECTED && body.restore !== null))),
            earlier === undefined ||
                canonical(proposalOf(earlier.body)) === canonical(proposalOf(body)),
            state.rewound === undefined ||
                canonical(state.rewound.body.restore) === canonical(body.restore),
            body.restore === null ||
                body.restore.rewind_session_id === null ||
                body.restore.rewind_session_id ===
                    deriveReplaySessionId(commandOfOpened(REWIND_STEP, {})),
            body.session_id === null ||
                body.session_id === deriveReplaySessionId(commandOfOpened(COMPRESSED_STEP, {})),
            body.restoration_session_id === null ||
                body.restoration_session_id ===
                    deriveReplaySessionId(commandOfOpened(RESTORATION_STEP, {})),
            body.verifier_handle_id === null ||
                body.verifier_handle_id ===
                    createChildRunHandleId(
                        commandOfOpened(VERIFIER_STEP, {
                            candidate: COMPRESSION_CANDIDATE,
                            seed: null,
                        }),
                    ),
        ].every(Boolean),
        "compression record is out of order or disagrees with its proposal or derived identities",
    );
    if (body.status === PROPOSED) {
        state.proposed = entry;
    } else if (body.status === REWOUND) {
        state.rewound = entry;
    } else {
        state.outcome = entry;
    }
}

function assertOutcome(
    body: CompressionOutcomeBody,
    applicationId: string,
    opened: CompressionOpenedBody,
    state: CandidateState,
    controls: ReadonlyMap<number, RetainedEntry<CompressionCandidateBody>>,
): void {
    const settled = state.outcome;
    const retained = { controls } as unknown as RetainedRecords;
    const best = bestControl(retained);
    assert(
        [
            body.application_id === applicationId,
            settled !== undefined && settled.body.failure === null,
            controls.size === opened.controls.length &&
                [...controls.values()].every((entry) => entry.body.failure === null),
            settled !== undefined &&
                body.outcome === settled.body.outcome &&
                body.result_session_id === resultSessionOf(settled.body, opened.source_session_id),
            (body.baseline !== null) === opened.baselines.includes(NO_COMPRESSION),
            body.baseline === null ||
                (body.baseline.session_id === opened.source_session_id &&
                    body.baseline.step_count === body.original_step_count),
            canonical(
                body.control === null
                    ? null
                    : [body.control.seed, body.control.session_id, body.control.step_count],
            ) === canonical(best === null ? null : [best.seed, best.session_id, best.step_count]),
        ].every(Boolean),
        "outcome record disagrees with the settled candidates",
    );
}

function proposalOf(body: CompressionCandidateBody): SemanticValue {
    return {
        compressor_handle_id: body.compressor_handle_id,
        fork_clamp: body.fork_clamp,
        fork_id: body.fork_id,
        fork_point: body.fork_point,
        hint_digest: body.hint_digest,
    } as unknown as SemanticValue;
}

function candidateInspection(
    candidate: TrajectoryCompressionCandidateKind,
    seed: number | null,
    state: CandidateState,
): TrajectoryCompressionCandidateInspection {
    return Object.freeze({
        candidate,
        outcome: toRecord(state.outcome),
        proposed: toRecord(state.proposed),
        rewound: toRecord(state.rewound),
        seed,
    });
}

function toRecord(
    entry: RetainedEntry<CompressionCandidateBody> | undefined,
): TrajectoryCompressionCandidateRecord | null {
    return entry === undefined
        ? null
        : (Object.freeze({
              ...stripRecord(entry.body),
              record_id: entry.record_id,
          }) as unknown as TrajectoryCompressionCandidateRecord);
}

function stripRecord(body: object): Readonly<Record<string, unknown>> {
    const {
        application_id: _application,
        application_version: _version,
        compatibility_version: _compatibility,
        phase: _phase,
        ...rest
    } = body as Record<string, unknown>;
    return rest;
}

function providerSteps(source: ReplaySessionInspection, from: number): number {
    return source.steps.filter((step) => step.index >= from && step.kind === PROVIDER_STEP).length;
}

function assertChildBudget(run: Run, commandId: string): void {
    if (run.store.readOwner(createChildRunHandleId(commandId)).length === 0) {
        assertBudget(run, 1);
    }
}

function assertMeasuredBudget(run: Run, sessionId: string): void {
    const budget = run.protocol.providerCalls;
    if (run.spent > budget) {
        throw new ApplicationBudgetError(
            `${run.spent} measured live provider call(s) through session ${sessionId} exceed ${compression.budgetKeys.providerCalls} ${budget}`,
        );
    }
}

function assertBudget(run: Run, projected: number): void {
    const budget = run.protocol.providerCalls;
    if (run.spent + projected > budget) {
        throw new ApplicationBudgetError(
            `${projected} projected provider call(s) after ${run.spent} exceed ${compression.budgetKeys.providerCalls} ${budget}`,
        );
    }
}

function sessionBindings(
    run: Run,
    commandId: string,
): { readonly claimId: string; readonly commandId: string } {
    return {
        claimId: run.claimId,
        ...run.clock,
        commandId,
        ...definedFields({ providerSession: run.workflow.providerSession }),
    };
}

/**
 * Resolves the handler stack, worlds, and processes of one workflow session through the workflow's
 * `bindings` factory, plus the workflow checkpoint policy of every session that runs the program.
 * Rewind sessions take restoration roots only.
 */
async function boundResources(
    run: Run,
    role: string,
    seed: number | null,
    executes: boolean,
): Promise<Record<string, unknown>> {
    const { workflow } = run;
    const bound =
        workflow.bindings === undefined
            ? {}
            : readScopeDataObject(
                  await workflow.bindings(
                      Object.freeze({ application_id: run.applicationId, role, seed }) as never,
                  ),
                  [],
                  `workflow bindings for ${role}`,
                  ["handlers", "processes", "worlds"],
              );
    return definedFields({
        checkpointPolicy: executes ? workflow.checkpointPolicy : undefined,
        handlers: executes ? (bound.handlers ?? workflow.handlers) : undefined,
        processes: bound.processes,
        worlds: bound.worlds,
    });
}

function commandOf(run: Run, step: string, fields: SemanticRecord): string {
    return createApplicationCommandId(run.applicationId, step, fields);
}

function readCompressionProtocol(value: unknown): CompressionProtocol {
    const definition = readApplicationProtocol(value);
    if (definition.kind !== COMPRESSION_KIND) {
        throw new ApplicationProtocolError(`kind must be ${COMPRESSION_KIND}`);
    }
    const roles = compression.surfaceRoles;
    for (const [kind, role] of [
        [PROMPT_KIND, roles.compressor],
        [SCHEMA_KIND, roles.compression],
        [PROMPT_KIND, roles.verifier],
    ]) {
        if (
            !definition.surfaces.some((surface) => surface.kind === kind && surface.role === role)
        ) {
            throw new ApplicationProtocolError(`a ${kind} surface with role ${role} is required`);
        }
    }
    const keys = compression.budgetKeys;
    const bestOfN = definition.budgets[keys.bestOfN];
    const providerCalls = definition.budgets[keys.providerCalls];
    if (bestOfN === undefined || providerCalls === undefined) {
        throw new ApplicationProtocolError(
            `budgets must declare ${keys.bestOfN} and ${keys.providerCalls}`,
        );
    }
    if (bestOfN > config.limits.maxBestOfN) {
        throw new ApplicationBudgetError(
            `${keys.bestOfN} ${bestOfN} exceeds the configured bound ${config.limits.maxBestOfN}`,
        );
    }
    if (bestOfN > definition.seeds.length) {
        throw new ApplicationProtocolError(
            `${keys.bestOfN} ${bestOfN} exceeds the ${definition.seeds.length} declared seed(s)`,
        );
    }
    return {
        bestOfN,
        definition,
        proposal: compileApplicationSchemaSurfaces(definition, roles.compression),
        providerCalls,
    };
}

function readWorkflow(value: unknown): TrajectoryCompressionWorkflow {
    const fields = readScopeDataObject(value, ["program", "programId"], "workflow", [
        "bindings",
        "checkpointPolicy",
        "handlers",
        "provider",
        "providerSession",
        "task",
    ]);
    readFunction(fields.program, "workflow.program");
    if (fields.bindings !== undefined) {
        readFunction(fields.bindings, "workflow.bindings");
    }
    assertScopeText(fields.programId, "workflow.programId");
    return fields as unknown as TrajectoryCompressionWorkflow;
}

function readChild(value: unknown, subject: string): ChildDefinition {
    const fields = readScopeDataObject(value, ["budget", "grant", "task"], subject, [
        "program",
        "provenance",
        "provider",
    ]);
    if ((fields.program === undefined) === (fields.provider === undefined)) {
        throw new TypeError(`${subject} must bind exactly one of program or provider`);
    }
    if (fields.program !== undefined) {
        readFunction(fields.program, `${subject}.program`);
    }
    return fields as unknown as ChildDefinition;
}

function definedFields(fields: Readonly<Record<string, unknown>>): Record<string, unknown> {
    return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
}

function readFunction(value: unknown, subject: string): (...args: never[]) => unknown {
    if (typeof value !== "function") {
        throw new TypeError(`${subject} must be a function`);
    }
    return value as (...args: never[]) => unknown;
}

function assertRecord(record: OwnerRecord, schema: string): void {
    assert(
        record.envelope.schema_ref === schema &&
            record.envelope.mode === CAPTURE_MODE &&
            record.envelope.witness_ref === ROOT_WITNESS_ID,
        `record ${record.envelope.record_id} has an unexpected schema, mode, or witness`,
    );
}

function assert(condition: boolean, message: string): asserts condition {
    if (!condition) {
        throw new ApplicationEvidenceError(message);
    }
}
