import type {
    ChildRunProgramContext,
    ChildRunProvenanceDeclaration,
    ChildRunRootParent,
} from "../delegation/types.ts";
import type { EffectHandlerStack } from "../effect/handler-types.ts";
import type {
    APPLICATION_COMPRESSION_BASELINE_KINDS,
    APPLICATION_COMPRESSION_CANDIDATE_KINDS,
    APPLICATION_COMPRESSION_CANDIDATE_STATUSES,
    APPLICATION_COMPRESSION_FORK_STEP_POLICIES,
    APPLICATION_COMPRESSION_OUTCOMES,
    APPLICATION_COMPRESSION_PHASES,
    APPLICATION_COMPRESSION_VERDICTS,
} from "../protocol/values.generated.ts";
import type { ModelProvider } from "../provider/types.ts";
import type { RecordId } from "../record/types.ts";
import type {
    ReplayCheckpointClassification,
    ReplayCheckpointConstituentKind,
    ReplayCheckpointEvidenceStatus,
    ReplayCheckpointPolicy,
    ReplayProcessAdapter,
    ReplayProviderSessionAdapter,
    ReplaySessionInspection,
    ReplaySessionProgram,
    ReplaySessionTaskDefinition,
    ReplayWorldBinding,
} from "../replay/types.ts";
import type { RunBudgetDefinition } from "../run/control-types.ts";
import type { ScopeResourceGrantRequest } from "../scope/types.ts";
import type { CutId } from "../store/types.ts";
import type { TaskSchema } from "../task/schema.ts";
import type { TaskDescriptor, TaskValue } from "../task/types.ts";
import type {
    ApplicationCostSummary,
    ApplicationKind,
    ApplicationManifest,
    ApplicationProtocolDefinition,
} from "./types.ts";

/** Configured trajectory compression record phase: opened, candidate, or outcome. */
export type TrajectoryCompressionPhase = (typeof APPLICATION_COMPRESSION_PHASES)[number];

/** Configured candidate kind: the fork-point compression or one seeded best-of-N control. */
export type TrajectoryCompressionCandidateKind =
    (typeof APPLICATION_COMPRESSION_CANDIDATE_KINDS)[number];

/** Configured candidate status: proposed, rewound, settled, or rejected. */
export type TrajectoryCompressionCandidateStatus =
    (typeof APPLICATION_COMPRESSION_CANDIDATE_STATUSES)[number];

/** Configured compression outcome: pruned, no prune, or restored. */
export type TrajectoryCompressionOutcome = (typeof APPLICATION_COMPRESSION_OUTCOMES)[number];

/** Configured verifier verdict: accepted or rejected. */
export type TrajectoryCompressionVerdict = (typeof APPLICATION_COMPRESSION_VERDICTS)[number];

/** Configured comparison baseline kind. */
export type TrajectoryCompressionBaselineKind =
    (typeof APPLICATION_COMPRESSION_BASELINE_KINDS)[number];

/** Configured fork-step policy: clamp an out-of-range proposed step, or reject the proposal. */
export type TrajectoryForkStepPolicy = (typeof APPLICATION_COMPRESSION_FORK_STEP_POLICIES)[number];

/**
 * Step boundary of the source session a compressor proposes to fork from.
 *
 * In a proposal `step_index` is any safe integer; it is resolved against an `n`-step source under
 * the configured fork-step policy. A retained (resolved) fork point always satisfies
 * `0 <= step_index <= n - 1`; step `0` restarts from the initial prefix.
 */
export type TrajectoryForkPoint = {
    /**
     * Prefix identity of the source through the retained prefix, or null for step `0`; within
     * range it must equal the retained one.
     */
    readonly prefix_id: string | null;
    /** Source session identity. */
    readonly session_id: string;
    /** Number of retained source steps; in `[0, n - 1]` once resolved. */
    readonly step_index: number;
};

/**
 * Retained evidence that the configured policy clamped an out-of-range proposed fork step to the
 * nearest bound of `[0, n - 1]` (Appendix D.6).
 */
export type TrajectoryForkClamp = {
    /** Policy that clamped the step. */
    readonly policy: TrajectoryForkStepPolicy;
    /** Prefix identity the compressor proposed, or null. */
    readonly proposed_prefix_id: string | null;
    /** Out-of-range step index the compressor proposed. */
    readonly proposed_step_index: number;
};

/** Hint a compressor attaches to its fork point. */
export type TrajectoryHint = {
    /** Source step indices the hint cites, strictly ascending. */
    readonly cited_step_indices: readonly number[];
    /** Hint text within the configured prompt byte bound. */
    readonly text: string;
};

/**
 * Validated compressor proposal: a fork point and hint. A proposal whose fork point or fork step is
 * absent or null is a missing fork step and settles `no_prune`.
 */
export type TrajectoryCompressionProposal = {
    /** Fork point, or null when the compressor proposed no fork step. */
    readonly fork_point: TrajectoryForkPoint | null;
    /** Hint, or null; a hint without a fork step is retained by digest and prunes nothing. */
    readonly hint: TrajectoryHint | null;
};

/** Guidance a workflow program receives when it re-executes the suffix under a proposal. */
export type TrajectoryCompressionGuidance = {
    /** Validated fork point. */
    readonly fork_point: TrajectoryForkPoint;
    /** Validated hint, or null. */
    readonly hint: TrajectoryHint | null;
};

/**
 * Workflow program factory. `program(null)` is the recorded workflow and every plain rerun;
 * `program(guidance)` re-executes the same workflow under a fork point and hint. The guided program
 * must issue the recorded prefix unchanged; only steps at or after the fork point may use the hint.
 *
 * @param guidance - Fork point and hint, or null for the unguided workflow.
 * @returns The deterministic replay session program.
 */
export type TrajectoryCompressionProgram = (
    guidance: TrajectoryCompressionGuidance | null,
) => ReplaySessionProgram;

/** Session a workflow `bindings` factory is asked to bind. */
export type TrajectoryCompressionBindingsContext = {
    /** Application identity. */
    readonly application_id: string;
    /**
     * Session role: `source` (the recorded workflow), `rewind` (empty restoration roots),
     * `compressed` and `restoration` (suffix replays restored from the fork point), or `control`
     * (a seeded plain rerun from the initial state).
     */
    readonly role: string;
    /** Seed of a control rerun, otherwise null. */
    readonly seed: number | null;
};

/** Worlds, processes, and handler stack bound to one workflow session. */
export type TrajectoryCompressionBindings = {
    /** Handler stack bound to this session's worlds; defaults to the workflow handler stack. */
    readonly handlers?: EffectHandlerStack;
    /** Process adapters, one per source process. */
    readonly processes?: readonly ReplayProcessAdapter[];
    /**
     * World bindings: the live worlds of the source and each control, and fresh empty restoration
     * roots for the rewind and every suffix replay.
     */
    readonly worlds?: readonly ReplayWorldBinding[];
};

/**
 * Source workflow recorded once through a root replay session.
 *
 * A workflow without `bindings` binds no worlds or processes, so every step boundary is an
 * admissible fork point. A world- or process-bound workflow is restorable only at the checkpoints
 * its `checkpointPolicy` retains; a fork point elsewhere settles `no_prune` as unavailable. The
 * provider, handler stack, task, and provider-session adapter service the source session, every
 * suffix replay, and every control rerun, so the provider must answer repeated sessions.
 */
export type TrajectoryCompressionWorkflow = {
    /**
     * Factory binding each session's worlds, processes, and handler stack. It is called once per
     * session start, including when a retained session is resumed, so it must return the same
     * bindings for the same role and seed.
     *
     * @param context - Application, session role, and control seed.
     * @returns The session bindings.
     */
    readonly bindings?: (
        context: TrajectoryCompressionBindingsContext,
    ) => Promise<TrajectoryCompressionBindings> | TrajectoryCompressionBindings;
    /** Automatic checkpoint policy of the source, every suffix replay, and every control. */
    readonly checkpointPolicy?: ReplayCheckpointPolicy;
    /** Effect handler stack; required when the program dispatches effects. */
    readonly handlers?: EffectHandlerStack;
    /** Program factory for the unguided and guided workflow. */
    readonly program: TrajectoryCompressionProgram;
    /** Stable program identity retained with the source session. */
    readonly programId: string;
    /** Provider; required when the program invokes a provider. */
    readonly provider?: ModelProvider;
    /** Provider-session adapter bound to every session; without one it is reconstructive. */
    readonly providerSession?: ReplayProviderSessionAdapter;
    /** Task and input bound to the source session and every control rerun. */
    readonly task?: ReplaySessionTaskDefinition;
};

/** Context a program-serviced compressor receives in addition to the child run context. */
export type TrajectoryCompressorContext = ChildRunProgramContext & {
    /** Validated terminal source session inspection. */
    readonly source: ReplaySessionInspection;
};

/**
 * Caller program servicing the compressor child. The returned output is validated against the task
 * output schema; its configured output field must carry the canonical JSON text of a proposal.
 *
 * @param context - Child run program context plus the source inspection.
 * @returns The compressor output.
 */
export type TrajectoryCompressorProgram = (
    context: TrajectoryCompressorContext,
) => Promise<unknown> | unknown;

/** Context a program-serviced verifier receives in addition to the child run context. */
export type TrajectoryVerifierContext = ChildRunProgramContext & {
    /** Candidate kind being verified. */
    readonly candidate: TrajectoryCompressionCandidateKind;
    /** Validated terminal compressed or control session inspection. */
    readonly compressed: ReplaySessionInspection;
    /** Fork point of a compression candidate, or null for a control rerun. */
    readonly fork_point: TrajectoryForkPoint | null;
    /** Hint of a compression candidate, or null. */
    readonly hint: TrajectoryHint | null;
    /** Validated terminal source session inspection. */
    readonly original: ReplaySessionInspection;
    /** Control seed, or null for the compression candidate. */
    readonly seed: number | null;
};

/**
 * Caller program servicing one verifier child. The returned output is validated against the task
 * output schema; its configured output field must carry the canonical JSON text of a verdict
 * `{ verdict, score, reason }`.
 *
 * @param context - Child run program context plus the original and candidate inspections.
 * @returns The verifier output.
 */
export type TrajectoryVerifierProgram = (
    context: TrajectoryVerifierContext,
) => Promise<unknown> | unknown;

/** Delegated compressor child: a child run definition serviced by a program or a provider. */
export type TrajectoryCompressorDefinition = {
    /** Child budget attenuated by the root declaration. */
    readonly budget: RunBudgetDefinition;
    /** Requested resource grant attenuated by the root ceiling. */
    readonly grant: ScopeResourceGrantRequest;
    /** Caller program; exactly one of `program` or `provider`. */
    readonly program?: TrajectoryCompressorProgram;
    /** Provenance of a supplied task value; a descriptor defaults to `declared`. */
    readonly provenance?: ChildRunProvenanceDeclaration;
    /** Caller-bound provider; exactly one of `program` or `provider`. */
    readonly provider?: ModelProvider;
    /** Task whose input and output are closed objects of the configured child text fields. */
    readonly task: TaskDescriptor<TaskSchema<unknown>, TaskSchema<unknown>> | TaskValue;
};

/** Delegated verifier child: a child run definition serviced by a program or a provider. */
export type TrajectoryVerifierDefinition = Omit<TrajectoryCompressorDefinition, "program"> & {
    /** Caller program; exactly one of `program` or `provider`. */
    readonly program?: TrajectoryVerifierProgram;
};

/** Options for {@link runTrajectoryCompression}. */
export type RunTrajectoryCompressionOptions = {
    /** Comparison baselines reported by the outcome; defaults to none. */
    readonly baselines?: readonly TrajectoryCompressionBaselineKind[];
    /** Writer lease holder of every replay session the run opens. */
    readonly claimId: string;
    /** Clock in Unix milliseconds for every session and child; defaults to `Date.now`. */
    readonly clock?: () => number;
    /** Globally idempotent application command identity. */
    readonly commandId: string;
    /** Delegated compressor child. */
    readonly compressor: TrajectoryCompressorDefinition;
    /** Provider of the control rerun under one seed; defaults to the workflow provider. */
    readonly controlProvider?: (seed: number) => ModelProvider;
    /** Root declaration bounding the compressor and verifier grants and budgets. */
    readonly parent: ChildRunRootParent;
    /** Trajectory compression protocol definition. */
    readonly protocol: ApplicationProtocolDefinition;
    /** Supervisor the delegated children are opened and accepted as. */
    readonly supervisorId: string;
    /** Delegated verifier child, opened once per verified candidate. */
    readonly verifier: TrajectoryVerifierDefinition;
    /** Source workflow recorded once. */
    readonly workflow: TrajectoryCompressionWorkflow;
};

/** One retained restore constituent: its kind, name, evidence status, and unavailable reason. */
export type TrajectoryRestoreConstituent = {
    /** Constituent kind. */
    readonly kind: ReplayCheckpointConstituentKind;
    /** World, process, or adapter name, or null. */
    readonly name: string | null;
    /** Reason, only when unavailable. */
    readonly reason: string | null;
    /** Evidence status. */
    readonly status: ReplayCheckpointEvidenceStatus;
};

/** Retained restore classification of a fork point. */
export type TrajectoryRestoreEvidence = {
    /** Classification from `classifyReplayCheckpoint` or the rewind restore record. */
    readonly classification: ReplayCheckpointClassification;
    /** Every classified constituent in configured order. */
    readonly constituents: readonly TrajectoryRestoreConstituent[];
    /** Rewind restore record, or null when the restore was refused as unavailable. */
    readonly restore_record_id: RecordId | null;
    /** Rewind session, or null when the restore was refused as unavailable. */
    readonly rewind_session_id: string | null;
};

/** Retained failure that rejected a candidate and stopped the run. */
export type TrajectoryCompressionFailure = {
    /** Configured error code: invalid evidence or failed verification. */
    readonly code: string;
    /** Retained failure detail. */
    readonly reason: string;
};

/** One retained candidate record. */
export type TrajectoryCompressionCandidateRecord = {
    /** Candidate kind. */
    readonly candidate: TrajectoryCompressionCandidateKind;
    /** Compressor handle, or null for a control rerun. */
    readonly compressor_handle_id: string | null;
    /** Measured cost of the candidate's sessions and children, or null before settlement. */
    readonly cost: ApplicationCostSummary | null;
    /** Failure that rejected the candidate, or null. */
    readonly failure: TrajectoryCompressionFailure | null;
    /** Clamp the configured policy applied to the proposed fork step, or null when in range. */
    readonly fork_clamp: TrajectoryForkClamp | null;
    /** Fork-point identity over the application, fork point, and hint digest, or null. */
    readonly fork_id: string | null;
    /** Resolved fork point in `[0, n - 1]`, or null. */
    readonly fork_point: TrajectoryForkPoint | null;
    /** Digest of the canonical hint, or null. */
    readonly hint_digest: string | null;
    /** Outcome of a settled compression candidate, or null. */
    readonly outcome: TrajectoryCompressionOutcome | null;
    /** Verifier or configured reason, or null. */
    readonly reason: string | null;
    /** Retained record identity. */
    readonly record_id: RecordId;
    /** Original suffix re-run after a rejected compression, or null. */
    readonly restoration_session_id: string | null;
    /** Restore classification and constituents, or null. */
    readonly restore: TrajectoryRestoreEvidence | null;
    /** Verifier score, or null. */
    readonly score: number | null;
    /** Control seed, or null for the compression candidate. */
    readonly seed: number | null;
    /** Compressed or control session, or null. */
    readonly session_id: string | null;
    /** Candidate status. */
    readonly status: TrajectoryCompressionCandidateStatus;
    /** Retained step count of the compressed or control session, or of the source for no prune. */
    readonly step_count: number | null;
    /** Verifier verdict, or null when the verifier was not consulted. */
    readonly verdict: TrajectoryCompressionVerdict | null;
    /** Verifier handle, or null. */
    readonly verifier_handle_id: string | null;
};

/** Record-derived state of one candidate. */
export type TrajectoryCompressionCandidateInspection = {
    /** Candidate kind. */
    readonly candidate: TrajectoryCompressionCandidateKind;
    /** Settled or rejected record, or null before the candidate completed. */
    readonly outcome: TrajectoryCompressionCandidateRecord | null;
    /** Proposed record of the compression candidate, or null. */
    readonly proposed: TrajectoryCompressionCandidateRecord | null;
    /** Rewound record of the compression candidate, or null. */
    readonly rewound: TrajectoryCompressionCandidateRecord | null;
    /** Control seed, or null for the compression candidate. */
    readonly seed: number | null;
};

/** Measured step counts of one comparison session. */
export type TrajectoryCompressionComparison = {
    /** Comparison session identity. */
    readonly session_id: string;
    /** Retained steps of the comparison session. */
    readonly step_count: number;
    /** Comparison steps divided by original steps. */
    readonly step_count_ratio: number;
};

/** Aggregate outcome reporting measured step-count ratios only. */
export type TrajectoryCompressionOutcomeRecord = {
    /** `no_compression` baseline keeping the whole trajectory, or null. */
    readonly baseline:
        | (TrajectoryCompressionComparison & {
              /** Configured baseline kind. */
              readonly kind: TrajectoryCompressionBaselineKind;
          })
        | null;
    /** Shortest accepted best-of-N control rerun, or null. */
    readonly control:
        | (TrajectoryCompressionComparison & {
              /** Control seed. */
              readonly seed: number;
          })
        | null;
    /** Retained steps of the source session. */
    readonly original_step_count: number;
    /** Compression outcome. */
    readonly outcome: TrajectoryCompressionOutcome;
    /** Retained record identity. */
    readonly record_id: RecordId;
    /** Result session: compressed when pruned, restoration when restored, source otherwise. */
    readonly result_session_id: string;
    /** Retained steps of the result session. */
    readonly result_step_count: number;
    /** Result steps divided by original steps. */
    readonly step_count_ratio: number;
};

/** Immutable record-derived view of one trajectory compression run. */
export type TrajectoryCompressionInspection = {
    /** Application identity and owner path. */
    readonly application_id: string;
    /** Comparison baselines reported by the outcome. */
    readonly baselines: readonly TrajectoryCompressionBaselineKind[];
    /** Application command identity. */
    readonly command_id: string;
    /** The compression candidate. */
    readonly compression: TrajectoryCompressionCandidateInspection;
    /** Best-of-N control candidates in seed order. */
    readonly controls: readonly TrajectoryCompressionCandidateInspection[];
    /** Terminal cut, or null before the manifest was retained. */
    readonly cut_id: CutId | null;
    /** Application kind. */
    readonly kind: ApplicationKind;
    /** Retained manifest, or null. */
    readonly manifest: ApplicationManifest | null;
    /** Manifest record identity, or null. */
    readonly manifest_record_id: RecordId | null;
    /** Opened record identity. */
    readonly opened_record_id: RecordId;
    /** Aggregate outcome, or null before it was retained. */
    readonly outcome: TrajectoryCompressionOutcomeRecord | null;
    /** Protocol definition identity. */
    readonly protocol_id: string;
    /** Source session identity. */
    readonly source_session_id: string;
};

/** Result of {@link runTrajectoryCompression}. */
export type TrajectoryCompressionReceipt = {
    /** Record-derived inspection of the run. */
    readonly inspection: TrajectoryCompressionInspection;
    /** Retained manifest. */
    readonly manifest: ApplicationManifest;
};
