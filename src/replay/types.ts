import type { SemanticRecord, SemanticValue } from "../canonical/canonical-record.ts";
import type { EffectCompensationRegistry } from "../effect/compensation-types.ts";
import type { EffectHandlerStack } from "../effect/handler-types.ts";
import type { EffectReconciliationReceipt } from "../effect/reconciliation-types.ts";
import type { EffectIntent, EffectOutcome } from "../effect/types.ts";
import type { ProofEnvelope } from "../formal/types.ts";
import type {
    REPLAY_CACHE_STATUSES,
    REPLAY_CHANGE_DIMENSIONS,
    REPLAY_CHECKPOINT_CLASSIFICATIONS,
    REPLAY_CHECKPOINT_CONSTITUENT_KINDS,
    REPLAY_CHECKPOINT_EVIDENCE_STATUSES,
    REPLAY_CHECKPOINT_POLICIES,
    REPLAY_DIVERGENCE_CAUSES,
    REPLAY_DIVERGENCE_STATUSES,
    REPLAY_EFFECT_DISPOSITIONS,
    REPLAY_MODES,
    REPLAY_PROCESS_BACKENDS,
    REPLAY_RECOVERY_CLASSIFICATIONS,
    REPLAY_REGRESSION_STRATEGIES,
    REPLAY_SOURCE_DISPOSITIONS,
    REPLAY_STEP_KINDS,
    REPLAY_STEP_SOURCES,
    REPLAY_TERMINAL_STATUSES,
} from "../protocol/values.generated.ts";
import type {
    ModelProvider,
    ModelRequest,
    ModelUsage,
    ProviderDescriptor,
} from "../provider/types.ts";
import type { RecordId } from "../record/types.ts";
import type { TaskSchema } from "../task/schema.ts";
import type { TaskArtifactLock, TaskDescriptor } from "../task/types.ts";

/** Configured replay session mode. */
export type ReplayMode = (typeof REPLAY_MODES)[number];

/**
 * Configured disposition of a branch's source session: `compensate` abandons the source's suffix
 * and compensates its successful compensable effects before the branch opens; `retain` keeps the
 * source as a live alternative and compensates nothing.
 */
export type ReplaySourceDisposition = (typeof REPLAY_SOURCE_DISPOSITIONS)[number];

/** Configured replay step kind. */
export type ReplayStepKind = (typeof REPLAY_STEP_KINDS)[number];

/** Configured replay step source: executed live or served from a recorded prefix. */
export type ReplayStepSource = (typeof REPLAY_STEP_SOURCES)[number];

/** Configured declarable replay change dimension. */
export type ReplayChangeDimension = (typeof REPLAY_CHANGE_DIMENSIONS)[number];

/** Configured effect step disposition. */
export type ReplayEffectDisposition = (typeof REPLAY_EFFECT_DISPOSITIONS)[number];

/** Configured provider cache evidence status. */
export type ReplayCacheStatus = (typeof REPLAY_CACHE_STATUSES)[number];

/** Configured coupled checkpoint classification. */
export type ReplayCheckpointClassification = (typeof REPLAY_CHECKPOINT_CLASSIFICATIONS)[number];

/** Configured coupled checkpoint constituent kind. */
export type ReplayCheckpointConstituentKind = (typeof REPLAY_CHECKPOINT_CONSTITUENT_KINDS)[number];

/** Configured coupled checkpoint constituent evidence status. */
export type ReplayCheckpointEvidenceStatus = (typeof REPLAY_CHECKPOINT_EVIDENCE_STATUSES)[number];

/** Configured session terminal status. */
export type ReplayTerminalStatus = (typeof REPLAY_TERMINAL_STATUSES)[number];

/** Configured record-derived session recovery classification. */
export type ReplayRecoveryClassification = (typeof REPLAY_RECOVERY_CLASSIFICATIONS)[number];

/** Configured divergence alignment status. */
export type ReplayDivergenceStatus = (typeof REPLAY_DIVERGENCE_STATUSES)[number];

/** Configured divergence cause. */
export type ReplayDivergenceCause = (typeof REPLAY_DIVERGENCE_CAUSES)[number];

/** Configured first-regression search strategy. */
export type ReplayRegressionStrategy = (typeof REPLAY_REGRESSION_STRATEGIES)[number];

/** Configured process checkpoint backend kind. */
export type ReplayProcessBackend = (typeof REPLAY_PROCESS_BACKENDS)[number];

/** Retained address of one session step. */
export type ReplayStepHandle = {
    /** Zero-based step index. */
    readonly index: number;
    /** Retained step record identity. */
    readonly record_id: RecordId;
};

/** Options accepted by every step-producing session context operation. */
export type ReplayStepOptions = {
    /** Earlier steps whose results this step uses; defaults to the immediately preceding step. */
    readonly dependsOn?: readonly ReplayStepHandle[];
};

/** Retained failure of a provider invocation or effect handler. */
export type ReplayStepFailure = {
    /** Bounded failure message. */
    readonly message: string;
    /** Failure class name. */
    readonly name: string;
};

/** Result of one provider step returned to the session program. */
export type ReplayProviderStepResult = {
    /** Retained step address. */
    readonly handle: ReplayStepHandle;
    /** Provider response output and usage. */
    readonly response: {
        /** Canonical provider output. */
        readonly output: SemanticValue;
        /** Observed usage. */
        readonly usage: ModelUsage;
    };
    /** Whether the step ran live or was served from a recorded prefix. */
    readonly source: ReplayStepSource;
};

/** Result of one materialized effect step returned to the session program. */
export type ReplayEffectStepResult = {
    /** Retained step address. */
    readonly handle: ReplayStepHandle;
    /** Correlated effect outcome. */
    readonly outcome: EffectOutcome;
    /** Whether the step ran live or was served from a recorded prefix. */
    readonly source: ReplayStepSource;
};

/** Task in force for the next step of a session. */
export type ReplaySessionTask = {
    /** Exact task artifact lock. */
    readonly artifact_lock: TaskArtifactLock;
    /** Canonical task input. */
    readonly input: SemanticValue;
    /** Behavioral instruction. */
    readonly instruction: string;
    /** Canonical output JSON Schema. */
    readonly output_schema: SemanticRecord;
};

/** Task and input bound to a session. */
export type ReplaySessionTaskDefinition = {
    /** Immutable bodyless task descriptor. */
    readonly descriptor: TaskDescriptor<TaskSchema<unknown>, TaskSchema<unknown>>;
    /** Untrusted input validated by the descriptor's input schema. */
    readonly input: unknown;
};

/** Context through which a session program reaches the outside world. */
export type ReplaySessionContext = {
    /**
     * Captures a coupled checkpoint at the current step boundary.
     *
     * @returns The retained checkpoint inspection, or the existing one at this boundary.
     */
    readonly checkpoint: () => Promise<ReplayCheckpointInspection>;
    /**
     * Dispatches one effect through the session handler stack, or serves it from a recorded prefix.
     *
     * @param intent - Canonical effect intent.
     * @param options - Declared dependencies.
     * @returns The materialized step result.
     * @throws {ReplayEffectRefusedError} If replay policy refuses a branch suffix effect.
     * @throws {ReplayStepFailureError} If the handler failed.
     * @throws {ReplayPrefixMismatchError} If a recorded prefix retains a different intent.
     */
    readonly dispatchEffect: (
        intent: EffectIntent,
        options?: ReplayStepOptions,
    ) => Promise<ReplayEffectStepResult>;
    /**
     * Invokes the session provider, or serves the exchange from a recorded prefix.
     *
     * @param request - Canonical provider request.
     * @param options - Declared dependencies.
     * @returns The provider step result.
     * @throws {ReplayStepFailureError} If the provider invocation failed.
     * @throws {ReplayPrefixMismatchError} If a recorded prefix retains a different request.
     */
    readonly invokeProvider: (
        request: ModelRequest,
        options?: ReplayStepOptions,
    ) => Promise<ReplayProviderStepResult>;
    /**
     * Invokes the provider with the request derived from the task in force.
     *
     * @param options - Declared dependencies.
     * @returns The provider step result.
     * @throws {TypeError} If the session has no task.
     */
    readonly invokeTask: (options?: ReplayStepOptions) => Promise<ReplayProviderStepResult>;
    /** Session mode. */
    readonly mode: ReplayMode;
    /** Session identity. */
    readonly session_id: string;
    /** Signal aborted when the caller cancels or the session loses authority. */
    readonly signal: AbortSignal;
    /** Retained step count, which is the next step index. */
    readonly step_count: number;
    /** Task in force for the next step, or null. */
    readonly task: ReplaySessionTask | null;
};

/** Deterministic session program. Its result must be canonical semantic data. */
export type ReplaySessionProgram = (context: ReplaySessionContext) => Promise<unknown> | unknown;

/** Context presented to a provider-session adapter at a checkpoint. */
export type ReplayProviderSessionCheckpointContext = {
    /** Context prefix identity of the session's provider exchanges, or null before any. */
    readonly context_prefix_id: string | null;
    /** Session identity. */
    readonly session_id: string;
    /** Step boundary being checkpointed. */
    readonly step_count: number;
};

/** Evidence returned by a provider-session adapter. */
export type ReplayProviderSessionEvidence =
    | {
          /** Context prefix identity the provider-side session holds. */
          readonly contextPrefixId: string | null;
          /** Stable provider-side session receipt identity. */
          readonly receiptId: string;
          /** Verified capture. */
          readonly status: "verified";
      }
    | {
          /** Stable reason the provider-side session cannot be captured. */
          readonly reason: string;
          /** Unavailable capture. */
          readonly status: "unavailable";
      };

/** Adapter that captures and restores provider-side conversation state. */
export type ReplayProviderSessionAdapter = {
    /** Stable adapter identity retained in session evidence. */
    readonly adapterId: string;
    /**
     * Declares the provider cache identity for one request, or null when unknown.
     *
     * @param request - Canonical request about to be sent.
     * @param contextPrefixId - Context prefix identity before the request.
     * @returns Provider cache identity or null.
     */
    readonly cacheIdentity?: (
        request: ModelRequest,
        contextPrefixId: string | null,
    ) => string | null;
    /**
     * Captures provider-side session state at a checkpoint.
     *
     * @param context - Session, boundary, and context prefix identity.
     * @returns Verified receipt or unavailable reason.
     */
    readonly checkpoint: (
        context: ReplayProviderSessionCheckpointContext,
    ) => Promise<ReplayProviderSessionEvidence> | ReplayProviderSessionEvidence;
    /**
     * Restores provider-side session state for a branch.
     *
     * @param receiptId - Retained receipt identity.
     * @param context - Source session, boundary, and recorded context prefix identity.
     * @returns The context prefix identity the restored provider-side session holds.
     */
    readonly restore: (
        receiptId: string,
        context: ReplayProviderSessionCheckpointContext,
    ) => Promise<string | null> | string | null;
};

/** Probe result of a process checkpoint backend. */
export type ReplayProcessProbe =
    | {
          /** Backend can capture and restore on this host. */
          readonly available: true;
      }
    | {
          /** Backend cannot capture on this host. */
          readonly available: false;
          /** Stable configured or backend-specific reason. */
          readonly reason: string;
      };

/** Context presented to a process adapter. */
export type ReplayProcessCheckpointContext = {
    /** Process identity. */
    readonly process_id: string;
    /** Session identity. */
    readonly session_id: string;
    /** Step boundary. */
    readonly step_count: number;
};

/** Adapter that captures and restores one process bound to a session. */
export type ReplayProcessAdapter = {
    /** Configured backend kind. */
    readonly backend: ReplayProcessBackend;
    /**
     * Captures the process image at a checkpoint.
     *
     * @param context - Session, process, and boundary.
     * @returns Image bytes retained as a verified trace-store blob.
     */
    readonly checkpoint: (context: ReplayProcessCheckpointContext) => Promise<Uint8Array>;
    /**
     * Probes whether the backend can capture on this host.
     *
     * @returns Availability with an exact reason when unavailable.
     */
    readonly probe: () => Promise<ReplayProcessProbe>;
    /** Stable process identity within the session. */
    readonly processId: string;
    /**
     * Restores the process from a verified image.
     *
     * @param image - Verified image bytes.
     * @param context - Source session, process, and boundary.
     * @returns Completion once the process holds the image state.
     */
    readonly restore: (image: Uint8Array, context: ReplayProcessCheckpointContext) => Promise<void>;
};

/** Configured automatic checkpoint policy kind. */
export type ReplayCheckpointPolicyKind = (typeof REPLAY_CHECKPOINT_POLICIES)[number];

/**
 * Automatic step-boundary checkpoint policy of one session.
 *
 * Kinds are the configured `replay.checkpoint.automatic.policies`, ordered none, provider step,
 * effect step, and every N steps. A selected boundary is captured immediately before the step that
 * selects it, exactly as an explicit `checkpoint()` call there would be: `provider_step` before
 * every provider step, `effect_step` before every effect step, and `every_n_steps` before any step
 * whose index is a multiple of `interval` (so boundary 0 is always captured). A replay branch
 * captures only boundaries at or after its target; the recorded prefix reuses the source's
 * checkpoints.
 */
export type ReplayCheckpointPolicy = {
    /**
     * Positive step interval of at most `REPLAY_LIMITS.maxSteps`; required by and only allowed
     * for the every-N-steps kind.
     */
    readonly interval?: number;
    /** Configured policy kind. */
    readonly kind: ReplayCheckpointPolicyKind;
};

/** One managed world directory bound to a session. */
export type ReplayWorldBinding = {
    /** Stable world name within the session. */
    readonly name: string;
    /** Existing directory the session's effect handlers mutate. */
    readonly root: string;
};

/** Options for running one root replay session. */
export type RunReplaySessionOptions = {
    /**
     * Automatic checkpoint policy; defaults to the configured
     * `replay.checkpoint.automatic.defaultPolicy`.
     */
    readonly checkpointPolicy?: ReplayCheckpointPolicy;
    /** Proposed writer lease holder. */
    readonly claimId: string;
    /** Lease clock in Unix milliseconds; defaults to `Date.now`. */
    readonly clock?: () => number;
    /** Globally idempotent session command identity. */
    readonly commandId: string;
    /** Effect handler stack; required for effect steps. */
    readonly handlers?: EffectHandlerStack;
    /** Process adapters captured at checkpoints. */
    readonly processes?: readonly ReplayProcessAdapter[];
    /** Deterministic session program. */
    readonly program: ReplaySessionProgram;
    /** Stable program identity retained with the session. */
    readonly programId: string;
    /** Provider; required for provider steps. */
    readonly provider?: ModelProvider;
    /** Provider-session adapter; without one the provider session is reconstructive. */
    readonly providerSession?: ReplayProviderSessionAdapter;
    /** Caller cancellation. */
    readonly signal?: AbortSignal;
    /** Task and input bound to the session. */
    readonly task?: ReplaySessionTaskDefinition;
    /** Managed world directories captured at checkpoints. */
    readonly worlds?: readonly ReplayWorldBinding[];
};

/** Request presented to replay policy for an approval-required branch suffix effect. */
export type ReplayEffectApprovalRequest = {
    /** Effective intent awaiting approval. */
    readonly intent: EffectIntent;
    /** Branch session identity. */
    readonly session_id: string;
    /** Source step index that materialized the same intent, or null. */
    readonly source_materialized_step_index: number | null;
    /** Step index awaiting approval. */
    readonly step_index: number;
};

/** Replay policy verdict. */
export type ReplayEffectApprovalVerdict =
    | {
          /** Approved. */
          readonly approved: true;
          /** Approver identity retained on the step. */
          readonly approverId: string;
          /** Bounded approval reason. */
          readonly reason: string;
      }
    | {
          /** Refused. */
          readonly approved: false;
          /** Bounded refusal reason. */
          readonly reason: string;
      };

/** Target of a rewind or replay. */
export type ReplayTarget =
    | {
          /** Retained checkpoint identity. */
          readonly checkpointId: string;
      }
    | {
          /**
           * Step boundary of a session without bound worlds or processes; a world- or
           * process-bound session is addressed by the checkpoint retained at the boundary.
           */
          readonly stepCount: number;
      };

/** Options shared by rewind and replay. */
export type ReplayBranchOptions = {
    /** Proposed writer lease holder. */
    readonly claimId: string;
    /** Lease clock in Unix milliseconds; defaults to `Date.now`. */
    readonly clock?: () => number;
    /** Globally idempotent branch command identity. */
    readonly commandId: string;
    /**
     * Compensation handlers for the successful compensable effects the source materialized at or
     * after the target; required when the source disposition is `compensate` and any of them is not
     * yet compensated.
     */
    readonly compensation?: EffectCompensationRegistry;
    /** Process adapters that receive verified images, one per source process. */
    readonly processes?: readonly ReplayProcessAdapter[];
    /** Provider-session adapter receiving a verified provider-session receipt. */
    readonly providerSession?: ReplayProviderSessionAdapter;
    /** Caller cancellation. */
    readonly signal?: AbortSignal;
    /**
     * What happens to the source session's suffix; defaults to the configured
     * `replay.branch.defaultSourceDisposition`. An exploratory branch that keeps the source as a
     * retained alternative (a rollout, a candidate evaluation, a rerun) declares `retain`.
     */
    readonly sourceDisposition?: ReplaySourceDisposition;
    /** Source session identity. */
    readonly sourceSessionId: string;
    /** Checkpoint or step boundary. */
    readonly target: ReplayTarget;
    /** Empty restoration roots, one per source world. */
    readonly worlds?: readonly ReplayWorldBinding[];
};

/** Options for rewinding a session to a checkpoint or step boundary. */
export type RewindReplaySessionOptions = ReplayBranchOptions;

/** Options for replaying a session from a checkpoint or step boundary. */
export type ReplayReplaySessionOptions = ReplayBranchOptions & {
    /**
     * Automatic checkpoint policy of the live suffix; defaults to the configured
     * `replay.checkpoint.automatic.defaultPolicy`.
     */
    readonly checkpointPolicy?: ReplayCheckpointPolicy;
    /** Declared changes of the live suffix. */
    readonly changes?: readonly ReplayChangeDimension[];
    /** Handler stack used by the live suffix. */
    readonly handlers?: EffectHandlerStack;
    /**
     * Replay policy for approval-required suffix effects; without one they are refused.
     *
     * @param request - Effective intent and provenance.
     * @returns Approval or refusal.
     */
    readonly policy?: (
        request: ReplayEffectApprovalRequest,
    ) => Promise<ReplayEffectApprovalVerdict> | ReplayEffectApprovalVerdict;
    /** Deterministic session program re-executed over the prefix. */
    readonly program: ReplaySessionProgram;
    /** Provider used by the live suffix. */
    readonly provider?: ModelProvider;
    /** Replacement task of the live suffix; requires the `task` change. */
    readonly task?: ReplaySessionTaskDefinition;
};

/** Provider cache evidence retained on a provider step. */
export type ReplayCacheEvidence = {
    /** Provider cache tokens written. */
    readonly creation_input_tokens: number;
    /** Provider-declared cache identity, or null. */
    readonly identity: string | null;
    /** Context prefix identity before the request, or null before any exchange. */
    readonly prior_context_prefix_id: string | null;
    /** Provider cache tokens read. */
    readonly read_input_tokens: number;
    /** `hit` only when cache read tokens were observed. */
    readonly status: ReplayCacheStatus;
};

/** Validated provider step detail. */
export type ReplayProviderStepInspection = {
    /** Cache evidence, or null when the invocation failed. */
    readonly cache: ReplayCacheEvidence | null;
    /** Chained context prefix identity after this exchange. */
    readonly context_prefix_id: string;
    /** Failure, or null. */
    readonly failure: ReplayStepFailure | null;
    /** Prompt identity. */
    readonly prompt_id: string;
    /** Canonical request. */
    readonly request: ModelRequest;
    /** Response, or null when the invocation failed. */
    readonly response: {
        /** Canonical output. */
        readonly output: SemanticValue;
        /** Observed usage. */
        readonly usage: ModelUsage;
    } | null;
    /** Response output or failure identity. */
    readonly response_id: string;
};

/** Retained approval of a branch suffix effect. */
export type ReplayEffectApproval = {
    /** Approver identity. */
    readonly approver_id: string;
    /** Approval reason. */
    readonly reason: string;
    /** Whether the same intent materialized in the source session. */
    readonly rematerialization: boolean;
};

/** Validated effect step detail. */
export type ReplayEffectStepInspection = {
    /** Approval, or null. */
    readonly approval: ReplayEffectApproval | null;
    /** Admission record, or null for a refused effect. */
    readonly admission_record_id: RecordId | null;
    /** Disposition. */
    readonly disposition: ReplayEffectDisposition;
    /** Failure, or null. */
    readonly failure: ReplayStepFailure | null;
    /** Handler identity, or null. */
    readonly handler_id: string | null;
    /** Canonical intent. */
    readonly intent: EffectIntent;
    /** Intent reference digest. */
    readonly intent_ref: string;
    /** Correlated outcome, only when materialized. */
    readonly outcome: EffectOutcome | null;
    /** Refusal reason, or null. */
    readonly refusal_reason: string | null;
};

/** Validated step of a session. */
export type ReplayStepInspection = {
    /** Declared dependency indices. */
    readonly depends_on: readonly number[];
    /** Effect detail, or null. */
    readonly effect: ReplayEffectStepInspection | null;
    /** Step index. */
    readonly index: number;
    /** Step kind. */
    readonly kind: ReplayStepKind;
    /** Chained prefix identity through this step. */
    readonly prefix_id: string;
    /** Provider detail, or null. */
    readonly provider: ReplayProviderStepInspection | null;
    /** Retained step record. */
    readonly record_id: RecordId;
    /** Live or recorded. */
    readonly source: ReplayStepSource;
    /** Source session step record, only for recorded steps. */
    readonly source_step_record_id: RecordId | null;
    /** Content identity of the step. */
    readonly step_id: string;
};

/** One classified checkpoint or restore constituent. */
export type ReplayConstituent = {
    /** Kind-specific canonical evidence, or null. */
    readonly evidence: SemanticRecord | null;
    /** Constituent kind. */
    readonly kind: ReplayCheckpointConstituentKind;
    /** World, process, or adapter name, or null. */
    readonly name: string | null;
    /** Reason, only when unavailable. */
    readonly reason: string | null;
    /** Receipt identity, only when verified. */
    readonly receipt_id: string | null;
    /** Evidence status. */
    readonly status: ReplayCheckpointEvidenceStatus;
};

/** Validated coupled checkpoint. */
export type ReplayCheckpointInspection = {
    /** Derived classification. */
    readonly classification: ReplayCheckpointClassification;
    /** Checkpoint identity. */
    readonly checkpoint_id: string;
    /** Every constituent in configured order. */
    readonly constituents: readonly ReplayConstituent[];
    /** Context prefix identity at the boundary, or null. */
    readonly context_prefix_id: string | null;
    /** Prefix identity at the boundary, or null for zero steps. */
    readonly prefix_id: string | null;
    /** Retained checkpoint record. */
    readonly record_id: RecordId;
    /** Session identity. */
    readonly session_id: string;
    /** Step boundary. */
    readonly step_count: number;
    /** Published trace cut identity. */
    readonly trace_cut_id: string;
};

/** Derived classification of retained constituents. */
export type ReplayCheckpointClassificationResult = {
    /** Derived classification. */
    readonly classification: ReplayCheckpointClassification;
    /** Kinds and names not applicable. */
    readonly not_applicable: readonly ReplayConstituentName[];
    /** Kinds and names reconstructed. */
    readonly reconstructive: readonly ReplayConstituentName[];
    /** Unavailable constituents with reasons. */
    readonly unavailable: readonly (ReplayConstituentName & { readonly reason: string })[];
    /** Kinds and names verified. */
    readonly verified: readonly ReplayConstituentName[];
};

/** Constituent kind with an optional name. */
export type ReplayConstituentName = {
    /** Constituent kind. */
    readonly kind: ReplayCheckpointConstituentKind;
    /** World, process, or adapter name, or null. */
    readonly name: string | null;
};

/** Origin of a branch session. */
export type ReplayOriginInspection = {
    /** Declared suffix changes. */
    readonly changes: readonly ReplayChangeDimension[];
    /** Replacement task of the live suffix, only with a declared task change. */
    readonly replacement_task: ReplaySessionTask | null;
    /** Source session identity. */
    readonly source_session_id: string;
    /** Source session record. */
    readonly source_session_record_id: RecordId;
    /** Target checkpoint, or null for a step boundary. */
    readonly target_checkpoint_id: string | null;
    /** Target step count. */
    readonly target_step_count: number;
    /** Trace cut of the source prefix. */
    readonly target_trace_cut_id: string;
};

/** Validated restore evidence of a branch session. */
export type ReplayRestoreInspection = {
    /** Derived classification of restored constituents. */
    readonly classification: ReplayCheckpointClassification;
    /** Restored constituents. */
    readonly constituents: readonly ReplayConstituent[];
    /** Context prefix identity at the target, or null. */
    readonly context_prefix_id: string | null;
    /** Prefix identity at the target, or null. */
    readonly prefix_id: string | null;
    /** Retained restore record. */
    readonly record_id: RecordId;
};

/** Validated terminal record. */
export type ReplayTerminalInspection = {
    /** Program failure, or null. */
    readonly failure: ReplayStepFailure | null;
    /** Prefix identity at termination, or null. */
    readonly prefix_id: string | null;
    /** Retained terminal record. */
    readonly record_id: RecordId;
    /** Program result, only when finished. */
    readonly result: { readonly value: SemanticValue } | null;
    /** Terminal status. */
    readonly status: ReplayTerminalStatus;
    /** Step count at termination. */
    readonly step_count: number;
};

/** Immutable record-derived view of one replay session. */
export type ReplaySessionInspection = {
    /** Accepted external risk still unresolved in this owner's causal or associated execution evidence. */
    readonly residual_risks?: readonly EffectReconciliationReceipt[];
    /** Retained checkpoints in boundary order. */
    readonly checkpoints: readonly ReplayCheckpointInspection[];
    /** Session command identity. */
    readonly command_id: string;
    /** Pending effect admission without step, or null. */
    readonly pending_admission_record_id: RecordId | null;
    /** Record-derived recovery classification. */
    readonly classification: ReplayRecoveryClassification;
    /** Current head. */
    readonly head_record_id: RecordId;
    /** Whether a live writer row exists in this store. */
    readonly live: boolean;
    /** Session mode. */
    readonly mode: ReplayMode;
    /** Branch origin, or null for a root session. */
    readonly origin: ReplayOriginInspection | null;
    /** Bound process identities and backends. */
    readonly processes: readonly {
        readonly backend: ReplayProcessBackend;
        readonly process_id: string;
    }[];
    /** Program identity. */
    readonly program_id: string;
    /**
     * Inspectable claim strength: `runtime_only` for root sessions, `extension` for branch
     * sessions, and a reference-machine classification only when lowering was requested.
     */
    readonly proof: ProofEnvelope;
    /** Provider descriptor, or null. */
    readonly provider: ProviderDescriptor | null;
    /** Provider-session adapter identity, or null. */
    readonly provider_session_adapter_id: string | null;
    /** Branch restore evidence, or null. */
    readonly restore: ReplayRestoreInspection | null;
    /** Session identity. */
    readonly session_id: string;
    /** Retained session record. */
    readonly session_record_id: RecordId;
    /** Steps in index order. */
    readonly steps: readonly ReplayStepInspection[];
    /** Session task, or null. */
    readonly task: ReplaySessionTask | null;
    /** Terminal record, or null. */
    readonly terminal: ReplayTerminalInspection | null;
    /** Bound world names. */
    readonly worlds: readonly string[];
};

/** Receipt of a root session, rewind, or replay. */
export type ReplaySessionReceipt = {
    /** Validated session inspection with its terminal record. */
    readonly inspection: ReplaySessionInspection;
};

/** One aligned step of a divergence analysis. */
export type ReplayDivergenceStep = {
    /** Cause of a diverged step, or null. */
    readonly cause: ReplayDivergenceCause | null;
    /** Step index. */
    readonly index: number;
    /** Branch step identity, or null. */
    readonly replay_step_id: string | null;
    /** Source step identity, or null. */
    readonly source_step_id: string | null;
    /** Alignment status. */
    readonly status: ReplayDivergenceStatus;
};

/** Read-only divergence analysis of a source and a branch session. */
export type ReplayDivergenceAnalysis = {
    /** Declared branch changes. */
    readonly changes: readonly ReplayChangeDimension[];
    /** Prefix identity of the longest identical prefix, or null. */
    readonly common_prefix_id: string | null;
    /** First non-identical index, or null. */
    readonly first_divergence_index: number | null;
    /** Branch session identity. */
    readonly replay_session_id: string;
    /** Source session identity. */
    readonly source_session_id: string;
    /** Aligned steps. */
    readonly steps: readonly ReplayDivergenceStep[];
    /** Indices of unexplained divergences. */
    readonly unexplained: readonly number[];
};

/** Read-only dependency analysis of one session step. */
export type ReplayDependencyAnalysis = {
    /** Transitive dependents of the step, ascending. */
    readonly dependents: readonly number[];
    /** Steps after the analyzed step that do not depend on it, ascending. */
    readonly independent: readonly number[];
    /** Session identity. */
    readonly session_id: string;
    /** Analyzed step index. */
    readonly step_index: number;
};

/** One step of a branch aligned against the common ancestor in an N-way diff. */
export type ReplayBranchDiffStep = {
    /** Ancestor step identity at the index, or null. */
    readonly ancestor_step_id: string | null;
    /** Branch step identity at the index, or null. */
    readonly branch_step_id: string | null;
    /** Step index. */
    readonly index: number;
    /** Kind of the branch step, or of the ancestor step when the branch has none. */
    readonly kind: ReplayStepKind;
    /**
     * Alignment status against the ancestor: `identical`, `diverged`, `source_only` (the ancestor
     * retains the index and the branch does not), or `replay_only` (only the branch retains it).
     */
    readonly status: ReplayDivergenceStatus;
};

/** One effect step a branch captured past the shared base. */
export type ReplayCapturedEffect = {
    /** Retained effect disposition. */
    readonly disposition: ReplayEffectDisposition;
    /** Effect intent identity. */
    readonly effect_id: string;
    /** Effect intent kind. */
    readonly effect_kind: string;
    /** Step index at which the branch retains the effect. */
    readonly index: number;
    /** Effect intent content identity. */
    readonly intent_ref: string;
    /** Effect step content identity (intent, disposition, outcome, and failure). */
    readonly step_id: string;
};

/** One branch of an N-way diff. */
export type ReplayBranchDiff = {
    /** Effects the branch captured at or after the shared base, in step order. */
    readonly effects: readonly ReplayCapturedEffect[];
    /** First index at or after the base whose status is not `identical`, or null. */
    readonly first_divergence_index: number | null;
    /** Replay-session lineage from the root session to this session. */
    readonly lineage: readonly string[];
    /** Branch session identity. */
    readonly session_id: string;
    /** Retained step count of the branch. */
    readonly step_count: number;
    /** Steps aligned against the ancestor from the base onward. */
    readonly steps: readonly ReplayBranchDiffStep[];
};

/** One distinct captured effect across the branches of an N-way diff. */
export type ReplayEffectPresence = {
    /** Retained effect disposition. */
    readonly disposition: ReplayEffectDisposition;
    /** Effect intent identity. */
    readonly effect_id: string;
    /** Effect intent kind. */
    readonly effect_kind: string;
    /** Whether the ancestor also retains this effect step at or after the base. */
    readonly in_ancestor: boolean;
    /** Effect intent content identity. */
    readonly intent_ref: string;
    /** Branches that captured the effect, in input order. */
    readonly session_ids: readonly string[];
    /** Effect step content identity. */
    readonly step_id: string;
};

/** Read-only N-way diff of replay sessions against their common lineage ancestor. */
export type ReplaySessionDiff = {
    /** Lowest common replay-session ancestor of every branch, or null when they share none. */
    readonly ancestor_session_id: string | null;
    /** Prefix identity of the shared base, or null for an empty base. */
    readonly base_prefix_id: string | null;
    /** Length of the longest ancestor prefix every branch retains identically; 0 without an ancestor. */
    readonly base_step_count: number;
    /** Branch diffs in input order. */
    readonly branches: readonly ReplayBranchDiff[];
    /** Distinct captured effects past the base, in first-capture order. */
    readonly effects: readonly ReplayEffectPresence[];
    /** Compared session identities in input order. */
    readonly session_ids: readonly string[];
};

/** One revision of a session lineage presented to a regression verdict. */
export type ReplayRevision = {
    /** Prefix identity of the revision, or null for the empty revision. */
    readonly prefix_id: string | null;
    /**
     * Lineage session that executed the newest step live (recorded steps resolve through their
     * source), or the searched session for the empty revision.
     */
    readonly session_id: string;
    /** Number of steps in the revision. */
    readonly step_count: number;
    /** Steps of the revision, in index order. */
    readonly steps: readonly ReplayStepInspection[];
};

/** One evaluated verdict of a regression search. */
export type ReplayRegressionEvaluation = {
    /** Whether the verdict accepted the revision. */
    readonly good: boolean;
    /** Evaluated revision step count. */
    readonly step_count: number;
};

/** Revision address reported by a regression search. */
export type ReplayRevisionAddress = {
    /** Prefix identity, or null for the empty revision. */
    readonly prefix_id: string | null;
    /** Lineage session that executed the newest step live. */
    readonly session_id: string;
    /** Revision step count. */
    readonly step_count: number;
};

/** Result of a first-regression search over a session lineage. */
export type ReplayRegressionSearch = {
    /** Verdicts in evaluation order; each revision is evaluated at most once. */
    readonly evaluations: readonly ReplayRegressionEvaluation[];
    /** First revision the verdict rejects, or null when the newest revision is accepted. */
    readonly first_bad: ReplayRevisionAddress | null;
    /**
     * Newest accepted revision before `first_bad` (the newest revision when nothing regressed), or
     * null when revision 0 is rejected.
     */
    readonly last_good: ReplayRevisionAddress | null;
    /** Replay-session lineage from the root session to the searched session. */
    readonly lineage: readonly string[];
    /** Searched session identity. */
    readonly session_id: string;
    /** Strategy used. */
    readonly strategy: ReplayRegressionStrategy;
};
