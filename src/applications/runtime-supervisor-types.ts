import type { ToolLoopEffects, ToolLoopModel, ToolLoopTool } from "../agent/types.ts";
import type { SemanticRecord, SemanticValue } from "../canonical/canonical-record.ts";
import type {
    APPLICATION_RUNTIME_SUPERVISION_ACTIONS,
    APPLICATION_RUNTIME_SUPERVISION_ATTEMPT_CAUSES,
    APPLICATION_RUNTIME_SUPERVISION_ATTEMPT_STATUSES,
    TOOL_CALL_DISPOSITIONS,
} from "../protocol/values.generated.ts";
import type { ModelMessage, ModelUsage } from "../provider/types.ts";
import type { RecordId } from "../record/types.ts";
import type { CutId } from "../store/types.ts";
import type { TraceSubscriptionCursor } from "../supervision/types.ts";
import type {
    ApplicationManifest,
    ApplicationProtocolDefinition,
    ApplicationWorldAdapter,
    ApplicationWorldCustody,
} from "./types.ts";

/** Configured Appendix E decision action: `none`, `inject`, `handoff`, or `discard`. */
export type RuntimeSupervisorAction = (typeof APPLICATION_RUNTIME_SUPERVISION_ACTIONS)[number];

/** Configured cause of one worker attempt: `start`, `handoff`, or `discard`. */
export type RuntimeSupervisorAttemptCause =
    (typeof APPLICATION_RUNTIME_SUPERVISION_ATTEMPT_CAUSES)[number];

/** Configured status of one worker attempt; every status but the first is terminal. */
export type RuntimeSupervisorAttemptStatus =
    (typeof APPLICATION_RUNTIME_SUPERVISION_ATTEMPT_STATUSES)[number];

/** Context a worker's effect factory receives when an attempt starts or resumes. */
export type RuntimeSupervisorWorkerEffectsContext = {
    /** Attempt number of the worker; the first session is attempt one. */
    readonly attempt: number;
    /** Isolated forked custody the attempt edits. */
    readonly custody: ApplicationWorldCustody;
    /** Worker identity. */
    readonly workerId: string;
};

/** One concurrently supervised worker: a tool-use loop over its own forked custody. */
export type RuntimeSupervisorWorkerDefinition = {
    /**
     * Builds the effect boundary of one attempt, bound to the attempt's custody root.
     *
     * @param context - Worker, attempt, and custody.
     * @returns The effect boundary every tool call of the attempt is dispatched through.
     */
    readonly effects: (context: RuntimeSupervisorWorkerEffectsContext) => ToolLoopEffects;
    /**
     * Feature description: the first user message of every session and, truncated to the
     * protocol's feature bound, the `feature` of the agent's snapshot.
     */
    readonly feature: string;
    /** Model boundary answering every turn of every attempt. */
    readonly model: ToolLoopModel;
    /** Output JSON Schema of the final turn, or null (the default) for unstructured output. */
    readonly outputSchema?: SemanticRecord | null;
    /** Stable system prompt of every session. */
    readonly system?: string;
    /** Tools offered to the model. */
    readonly tools: readonly ToolLoopTool[];
    /** Stable worker identity, unique within the run; the Appendix E `agent`. */
    readonly workerId: string;
};

/** Configured tool-call disposition carried by a snapshot summary. */
export type RuntimeSupervisorToolCallStatus = (typeof TOOL_CALL_DISPOSITIONS)[number];

/** Bounded summary of one worker tool call. */
export type RuntimeSupervisorToolCallSummary = {
    /** Short error, or null when the call materialized successfully. */
    readonly error: string | null;
    /** How the tool-use loop resolved the call. */
    readonly status: RuntimeSupervisorToolCallStatus;
    /** Primary target file or command read from the configured input keys, or null. */
    readonly target: string | null;
    /** Called tool name. */
    readonly tool: string;
};

/** The supervisor's most recent non-`none` action on one agent. */
export type RuntimeSupervisorLastAction = {
    /** Action issued. */
    readonly action: RuntimeSupervisorAction;
    /** Ticks elapsed since the action was issued; zero never occurs in a snapshot. */
    readonly ticks_ago: number;
};

/** Per-agent entry of one tick snapshot (paper Appendix E, observation cadence). */
export type RuntimeSupervisorAgentSnapshot = {
    /** Worker identity. */
    readonly agent: string;
    /** Current attempt number. */
    readonly attempt: number;
    /** Consecutive failed or refused tool calls at the end of the current attempt. */
    readonly consecutive_errors: number;
    /** Cumulative tool-call events across every attempt. */
    readonly events: number;
    /** Feature description truncated to the protocol bound. */
    readonly feature: string;
    /** Most recent non-`none` action and its age, or null. */
    readonly last_action: RuntimeSupervisorLastAction | null;
    /** Changed paths of the current custody relative to the pre-run world. */
    readonly modified_files: readonly string[];
    /** Status of the current attempt as delivered by the worker stream. */
    readonly status: RuntimeSupervisorAttemptStatus;
    /** Trailing tool-call summaries across attempts, oldest first. */
    readonly trailing_tool_calls: readonly RuntimeSupervisorToolCallSummary[];
};

/** One combined snapshot the policy receives per tick. */
export type RuntimeSupervisorSnapshot = {
    /** Every agent in declared worker order. */
    readonly agents: readonly RuntimeSupervisorAgentSnapshot[];
    /** Tick number, starting at one. */
    readonly tick: number;
};

/** One validated Appendix E decision. */
export type RuntimeSupervisorDecision = {
    /** Action to take on the agent. */
    readonly action: RuntimeSupervisorAction;
    /** Worker the decision names. */
    readonly agent: string;
    /** Guidance delivered by `inject` (required) or `handoff` (optional). */
    readonly guidance?: string;
    /**
     * Leading worker whose custody is forked as the agent's new root; only for `handoff`. This is a
     * repository extension of the printed schema for the paper's cross-agent handoff.
     */
    readonly leader?: string;
    /** Short reason. */
    readonly reason: string;
};

/** Context the policy receives once per tick. */
export type RuntimeSupervisorPolicyContext = {
    /** Validated protocol the run executes. */
    readonly protocol: ApplicationProtocolDefinition;
    /** Run cancellation. */
    readonly signal: AbortSignal;
    /** Snapshot validated against the protocol's observation schema. */
    readonly snapshot: RuntimeSupervisorSnapshot;
    /** Tick number. */
    readonly tick: number;
};

/** Raw policy response of one tick. */
export type RuntimeSupervisorPolicyResult = {
    /**
     * The Appendix E response object `{ decisions: [...] }`, unvalidated; the runtime validates
     * it and refuses the whole batch when any decision is inadmissible.
     */
    readonly output: unknown;
    /** Measured provider usage of a model-serviced policy, or null. */
    readonly usage: ModelUsage | null;
};

/**
 * Supervisor policy consulted exactly once per tick with the combined snapshot of every agent.
 *
 * @param context - Tick, snapshot, protocol, and signal.
 * @returns The raw decision object and optional usage.
 */
export type RuntimeSupervisorPolicy = (
    context: RuntimeSupervisorPolicyContext,
) => Promise<RuntimeSupervisorPolicyResult> | RuntimeSupervisorPolicyResult;

/**
 * Tick scheduler: resolves after the configured cadence, or rejects when the signal aborts.
 *
 * @param milliseconds - The protocol's tick interval.
 * @param signal - Run cancellation.
 */
export type RuntimeSupervisorWait = (milliseconds: number, signal: AbortSignal) => Promise<void>;

/** Closed options for {@link runRuntimeSupervisor}. */
export type RunRuntimeSupervisorOptions = {
    /** Optional clock for deterministic world requests; defaults to `Date.now`. */
    readonly clock?: () => number;
    /** Globally idempotent application command identity. */
    readonly commandId: string;
    /** Policy consulted once per tick. */
    readonly policy: RuntimeSupervisorPolicy;
    /** Runtime supervision protocol definition; validated before any record. */
    readonly protocol: ApplicationProtocolDefinition;
    /** Optional run cancellation; aborting stops every worker and rejects the run. */
    readonly signal?: AbortSignal;
    /** Supervisor identity retained with every tick. */
    readonly supervisorId: string;
    /** Optional tick scheduler; defaults to an abortable timer. */
    readonly wait?: RuntimeSupervisorWait;
    /** Workers, bounded by the configured minimum and maximum. */
    readonly workers: readonly RuntimeSupervisorWorkerDefinition[];
    /** World adapter supplying isolated forked custody, including forks of another custody. */
    readonly world: ApplicationWorldAdapter;
};

/** Refusal of one tick's decision batch; no decision of a refused batch is applied. */
export type RuntimeSupervisorRefusal = {
    /** Schema and admission issues. */
    readonly issues: readonly string[];
};

/** One retained tick. */
export type RuntimeSupervisorTickInspection = {
    /** Subscription cursor after every worker record the snapshot folded. */
    readonly cursor: TraceSubscriptionCursor;
    /** Admitted decisions; empty when refused. */
    readonly decisions: readonly RuntimeSupervisorDecision[];
    /** Raw policy output retained verbatim. */
    readonly output: SemanticValue;
    /** Tick record identity. */
    readonly record_id: RecordId;
    /** Refusal, or null when the batch was admitted. */
    readonly refusal: RuntimeSupervisorRefusal | null;
    /** Snapshot the policy saw, retained before any decision was applied. */
    readonly snapshot: RuntimeSupervisorSnapshot;
    /** Tick number. */
    readonly tick: number;
    /** Policy usage, or null. */
    readonly usage: ModelUsage | null;
};

/** One retained model turn of a worker attempt. */
export type RuntimeSupervisorTurnInspection = {
    /** Assistant message of the turn. */
    readonly assistant: ModelMessage;
    /** Cache prefix length of the turn's request. */
    readonly cache_prefix_messages: number;
    /** Tool-call summaries in request order. */
    readonly calls: readonly RuntimeSupervisorToolCallSummary[];
    /** Ticks whose injected guidance joined the next user message. */
    readonly guidance_ticks: readonly number[];
    /** Turn index within the attempt, continuing across a recovery. */
    readonly index: number;
    /** Messages sent by the turn's request. */
    readonly message_count: number;
    /** Final output of a turn without tool calls, otherwise null. */
    readonly output: SemanticValue;
    /** Record identity. */
    readonly record_id: RecordId;
    /** Digest of the canonical request. */
    readonly request_digest: string;
    /** Next user message (tool results then guidance), or null for a final turn. */
    readonly results: ModelMessage | null;
    /** Measured provider usage. */
    readonly usage: ModelUsage;
};

/** Terminal record of one worker attempt. */
export type RuntimeSupervisorCompletionInspection = {
    /** Decision that aborted the attempt, or null. */
    readonly cause: {
        /** Aborting action: `handoff` or `discard`. */
        readonly action: RuntimeSupervisorAction;
        /** Tick of the aborting decision. */
        readonly tick: number;
    } | null;
    /** Failure message, or null. */
    readonly error: string | null;
    /** Final output, or null. */
    readonly output: SemanticValue;
    /** Record identity. */
    readonly record_id: RecordId;
    /** Terminal status. */
    readonly status: RuntimeSupervisorAttemptStatus;
};

/** One worker attempt: a session over one custody. */
export type RuntimeSupervisorAttemptInspection = {
    /** Attempt number. */
    readonly attempt: number;
    /** Why the attempt started. */
    readonly cause: RuntimeSupervisorAttemptCause;
    /** Terminal record, or null while running. */
    readonly completion: RuntimeSupervisorCompletionInspection | null;
    /** Custody the attempt edits. */
    readonly custody: {
        /** Adapter custody identity. */
        readonly custody_id: string;
        /** Fork receipt identity. */
        readonly receipt_id: string;
        /** Custody the fork copied, or null for a fork of the pre-run world. */
        readonly source_custody_id: string | null;
    };
    /** Guidance of the first user message, or null. */
    readonly guidance: string | null;
    /** Leading worker of a cross-agent handoff, or null. */
    readonly leader: string | null;
    /** Attempt record identity. */
    readonly record_id: RecordId;
    /** Tick that started the attempt; zero for the initial start. */
    readonly tick: number;
    /** Retained turns in order. */
    readonly turns: readonly RuntimeSupervisorTurnInspection[];
};

/** One worker stream. */
export type RuntimeSupervisorWorkerInspection = {
    /** Attempts in order. */
    readonly attempts: readonly RuntimeSupervisorAttemptInspection[];
    /** Reserved owner path of the worker's live stream. */
    readonly stream_id: string;
    /** Worker identity. */
    readonly worker_id: string;
};

/** Retained settlement of a run. */
export type RuntimeSupervisorSettlementInspection = {
    /** Retired custody discarded at settlement, deepest first. */
    readonly discard_custody_ids: readonly string[];
    /** Record identity. */
    readonly record_id: RecordId;
    /** Last tick. */
    readonly ticks: number;
    /** Injected guidance that never reached the attempt it targeted. */
    readonly undelivered: readonly {
        /** Tick of the undelivered inject. */
        readonly tick: number;
        /** Worker the inject named. */
        readonly worker_id: string;
    }[];
    /** Final attempt of every worker. */
    readonly workers: readonly {
        /** Final attempt number. */
        readonly attempt: number;
        /** Final custody, left open. */
        readonly custody_id: string;
        /** Terminal status of the final attempt. */
        readonly status: RuntimeSupervisorAttemptStatus;
        /** Worker identity. */
        readonly worker_id: string;
    }[];
};

/** Immutable record-derived view of one runtime supervisor run. */
export type RuntimeSupervisorInspection = {
    /** Application identity and owner path. */
    readonly application_id: string;
    /** Application command identity. */
    readonly command_id: string;
    /** Terminal cut once the manifest is retained, otherwise null. */
    readonly cut_id: CutId | null;
    /** Retained manifest, or null. */
    readonly manifest: ApplicationManifest | null;
    /** Opened record identity. */
    readonly opened_record_id: RecordId;
    /** Protocol identity. */
    readonly protocol_id: string;
    /** Settlement, or null while the run is open. */
    readonly settlement: RuntimeSupervisorSettlementInspection | null;
    /** Supervisor identity. */
    readonly supervisor_id: string;
    /** Retained ticks in order. */
    readonly ticks: readonly RuntimeSupervisorTickInspection[];
    /** Worker streams in declared order. */
    readonly workers: readonly RuntimeSupervisorWorkerInspection[];
};

/** Result of {@link runRuntimeSupervisor}. */
export type RuntimeSupervisorReceipt = {
    /** Final custody of every worker in declared order, left open for the caller to integrate. */
    readonly custody: readonly {
        /** Final custody, with its root. */
        readonly custody: ApplicationWorldCustody;
        /** Worker identity. */
        readonly worker_id: string;
    }[];
    /** Record-derived inspection. */
    readonly inspection: RuntimeSupervisorInspection;
    /** Retained manifest. */
    readonly manifest: ApplicationManifest;
};

/** Options for {@link createModelRuntimeSupervisorPolicy}. */
export type ModelRuntimeSupervisorPolicyOptions = {
    /** Conversational model answering one JSON-mode request per tick. */
    readonly model: ToolLoopModel;
    /** Runtime supervision protocol whose prompts and decision schema build every request. */
    readonly protocol: ApplicationProtocolDefinition;
};
