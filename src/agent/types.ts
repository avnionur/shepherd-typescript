import type { ApplicationWorldAdapter } from "../applications/types.ts";
import type { SemanticRecord, SemanticValue } from "../canonical/canonical-record.ts";
import type { EffectCompensationRegistry } from "../effect/compensation-types.ts";
import type { EffectHandler, EffectHandlerStack } from "../effect/handler-types.ts";
import type { EffectIntent, EffectOutcome, EffectReversibility } from "../effect/types.ts";
import type { TOOL_CALL_DISPOSITIONS, TOOL_LOOP_STATUSES } from "../protocol/values.generated.ts";
import type {
    ConversationalModelProvider,
    ModelConversationRequest,
    ModelConversationResponse,
    ModelMessage,
    ModelProvider,
    ModelToolResultBlock,
} from "../provider/types.ts";
import type {
    ReplayChangeDimension,
    ReplayEffectApprovalRequest,
    ReplayEffectApprovalVerdict,
    ReplaySessionProgram,
    ReplaySessionTaskDefinition,
} from "../replay/types.ts";
import type { SQLiteTraceStore } from "../store/sqlite-trace-store.ts";
import type { SupervisionInterceptor } from "../supervision/types.ts";

/** Configured tool-use loop result status. */
export type ToolLoopStatus = (typeof TOOL_LOOP_STATUSES)[number];

/** Configured disposition of one model tool call. */
export type ToolCallDisposition = (typeof TOOL_CALL_DISPOSITIONS)[number];

/** One tool offered to the model and the effect family its calls become. */
export type ToolLoopTool = {
    /** Description sent to the model. */
    readonly description: string;
    /** Exact effect kind of every intent this tool's calls become. */
    readonly effectKind: string;
    /** JSON Schema, in the supported subset, that every call input must satisfy. */
    readonly inputSchema: SemanticRecord;
    /** Tool name the model calls. */
    readonly name: string;
    /** Declared reversibility tier of the tool's intents. */
    readonly reversibility: EffectReversibility;
};

/** Model boundary of a tool-use loop: one multi-turn request per turn. */
export type ToolLoopModel = {
    /** Sends one multi-turn request; see {@link ConversationalModelProvider.converse}. */
    readonly converse: ConversationalModelProvider["converse"];
};

/** Result of dispatching one tool-call intent. */
export type ToolLoopEffectResult =
    | {
          /** The intent materialized through a handler. */
          readonly disposition: (typeof TOOL_CALL_DISPOSITIONS)[0];
          /** Outcome exactly correlated to the intent. */
          readonly outcome: EffectOutcome;
      }
    | {
          /** The intent was denied or refused before any outcome. */
          readonly disposition: (typeof TOOL_CALL_DISPOSITIONS)[1];
          /** Bounded refusal reason. */
          readonly reason: string;
      }
    | {
          /** The handler failed; no outcome exists. */
          readonly disposition: (typeof TOOL_CALL_DISPOSITIONS)[3];
          /** Bounded failure reason. */
          readonly reason: string;
      };

/** Effect boundary of a tool-use loop. */
export type ToolLoopEffects = {
    /**
     * Dispatches one tool-call intent through a handler stack, supervised dispatch, or replay
     * session.
     *
     * @param intent - Canonical tool-call intent.
     * @param signal - Loop cancellation signal.
     * @returns The materialized outcome, a denial, or a failure.
     */
    readonly dispatch: (intent: EffectIntent, signal: AbortSignal) => Promise<ToolLoopEffectResult>;
};

/** One model tool call and how the loop resolved it. */
export type ToolLoopCall = {
    /** How the call resolved. */
    readonly disposition: ToolCallDisposition;
    /** Canonical call input. */
    readonly input: SemanticRecord;
    /** Tool-call intent, or null when the call was invalid and no intent was created. */
    readonly intent: EffectIntent | null;
    /** Called tool name. */
    readonly name: string;
    /** Correlated outcome, only when materialized. */
    readonly outcome: EffectOutcome | null;
    /** Refusal, validation, or failure reason, or null when materialized. */
    readonly reason: string | null;
    /** Tool result block returned to the model. */
    readonly result: ModelToolResultBlock;
    /** Provider-assigned call identity. */
    readonly toolUseId: string;
};

/** One completed model turn of a tool-use loop. */
export type ToolLoopTurn = {
    /** Resolved tool calls in the order the model requested them. */
    readonly calls: readonly ToolLoopCall[];
    /** Guidance appended to the next user message after this turn, or null. */
    readonly guidance: string | null;
    /** Zero-based turn index. */
    readonly index: number;
    /** Exact request sent for this turn. */
    readonly request: ModelConversationRequest;
    /** Model response of this turn. */
    readonly response: ModelConversationResponse;
};

/** Request presented to a loop's guidance callback between turns. */
export type ToolLoopGuidanceRequest = {
    /** Conversation so far, ending with this turn's assistant message. */
    readonly messages: readonly ModelMessage[];
    /** Loop cancellation signal. */
    readonly signal: AbortSignal;
    /** Turn just completed, with its resolved tool calls and no guidance yet. */
    readonly turn: ToolLoopTurn;
};

/** Options for {@link runToolLoop}. */
export type RunToolLoopOptions = {
    /** Effect boundary every admissible tool call is dispatched through. */
    readonly effects: ToolLoopEffects;
    /**
     * Optional supervisor hook consulted after every turn that requested tools and before the next
     * request; returned text joins the next user message after the tool results.
     *
     * @param request - Conversation, completed turn, and signal.
     * @returns Guidance text or null.
     */
    readonly guidance?: (
        request: ToolLoopGuidanceRequest,
    ) => Promise<string | null> | string | null;
    /** Stable loop identity from which tool-call effect identities are derived. */
    readonly loopId: string;
    /** Turn bound; defaults to `providers.tools.loop.defaultMaxTurns`, at most `maxTurns`. */
    readonly maxTurns?: number;
    /** Initial conversation; the first message is a user message. */
    readonly messages: readonly ModelMessage[];
    /** Model boundary. */
    readonly model: ToolLoopModel;
    /**
     * Optional observer invoked once per completed turn, in order.
     *
     * @param turn - Completed turn.
     */
    readonly onTurn?: (turn: ToolLoopTurn) => Promise<void> | void;
    /** Output JSON Schema of the final turn, or null for unstructured output. */
    readonly outputSchema?: SemanticRecord | null;
    /** Caller cancellation. */
    readonly signal?: AbortSignal;
    /** Stable system prompt. */
    readonly system?: string;
    /** Tools offered to the model. */
    readonly tools: readonly ToolLoopTool[];
};

/** Result of one tool-use loop. */
export type ToolLoopResult = {
    /** Full conversation, including every tool result and guidance message. */
    readonly messages: readonly ModelMessage[];
    /** Final turn output, or null when the turn bound was reached. */
    readonly output: SemanticValue;
    /** `completed` when the model ended a turn without tool calls, otherwise the turn limit. */
    readonly status: ToolLoopStatus;
    /** Every completed turn in order. */
    readonly turns: readonly ToolLoopTurn[];
};

/** Options for {@link createSupervisedToolLoopEffects}. */
export type SupervisedToolLoopEffectsOptions = {
    /** Approval wait for irreversible tool calls; defaults to the configured wait. */
    readonly approvalTimeoutMilliseconds?: number;
    /** Dispatch lease holder. */
    readonly claimId: string;
    /** Lease clock; defaults to `Date.now`. */
    readonly clock?: () => number;
    /** Handler stack that materializes admitted tool calls. */
    readonly handlers: EffectHandlerStack;
    /** Interceptors that allow, deny, replace, or pause every tool call. */
    readonly interceptors?: readonly SupervisionInterceptor[];
    /** Open writable trace store. */
    readonly store: SQLiteTraceStore;
};

/** Model and effect boundaries of a loop running inside a replay session program. */
export type ReplayToolLoopBindings = {
    /** Dispatches tool-call intents as replay session effect steps. */
    readonly effects: ToolLoopEffects;
    /** Sends each turn as a replay session provider step. */
    readonly model: ToolLoopModel;
};

/** One replacement a meta-agent may apply when it replays a worker. */
export type MetaAgentWorkerVariant = {
    /** Declared replay changes. */
    readonly changes: readonly ReplayChangeDimension[];
    /**
     * Handler stack of the live suffix, bound to the branch world root.
     *
     * @param root - Restored world root of the branch.
     * @returns The suffix handler stack.
     */
    readonly handlers?: (root: string) => EffectHandlerStack;
    /**
     * Replay policy for approval-required suffix effects.
     *
     * @param request - Effective intent and provenance.
     * @returns Approval or refusal.
     */
    readonly policy?: (
        request: ReplayEffectApprovalRequest,
    ) => Promise<ReplayEffectApprovalVerdict> | ReplayEffectApprovalVerdict;
    /** Provider of the live suffix. */
    readonly provider?: ModelProvider;
    /** Replacement task; requires the `task` change. */
    readonly task?: ReplaySessionTaskDefinition;
};

/** A worker a meta-agent may fork, identified to the model by its definition name. */
export type MetaAgentWorkerDefinition = {
    /**
     * Compensation handlers used when the rewind tool branches a session of this worker past its
     * successful compensable effects. The replay tool retains its source and compensates nothing.
     */
    readonly compensation?: EffectCompensationRegistry;
    /**
     * Handler stack of the worker, bound to its world root.
     *
     * @param root - World root of the worker session.
     * @returns The worker handler stack.
     */
    readonly handlers?: (root: string) => EffectHandlerStack;
    /** Deterministic worker session program. */
    readonly program: ReplaySessionProgram;
    /** Stable, unique program identity; replay resolves the definition through it. */
    readonly programId: string;
    /** Worker provider. */
    readonly provider?: ModelProvider;
    /** Worker task and input. */
    readonly task?: ReplaySessionTaskDefinition;
    /** Named variants the replay tool may apply. */
    readonly variants?: Readonly<Record<string, MetaAgentWorkerVariant>>;
    /** Name of the single world the worker session binds. */
    readonly world: string;
};

/** Environment backing the substrate-native meta-agent tools. */
export type MetaAgentToolEnvironment = {
    /**
     * Allocates one existing empty directory, used as a restoration root by rewind and replay and
     * as the worker world when no world adapter is bound.
     *
     * @param request - Derived command identity, catalog operation (`fork`, `rewind`, or
     *   `replay`), and world name.
     * @returns Absolute path of an existing empty directory.
     */
    readonly allocateRoot: (request: {
        readonly commandId: string;
        readonly operation: string;
        readonly world: string;
    }) => Promise<string>;
    /** Writer lease holder of every session the tools open. */
    readonly claimId: string;
    /** Lease and world clock; defaults to `Date.now`. */
    readonly clock?: () => number;
    /** Open writable trace store. */
    readonly store: SQLiteTraceStore;
    /** Forkable workers by definition name. */
    readonly workers: Readonly<Record<string, MetaAgentWorkerDefinition>>;
    /** Scope-backed world custody for fork and discard; without one fork allocates a root. */
    readonly world?: ApplicationWorldAdapter;
};

/** Catalog tools and their handlers. */
export type MetaAgentTools = {
    /** Handlers, one per catalog tool, keyed by the tool's effect kind. */
    readonly handlers: readonly EffectHandler[];
    /** Catalog tools in configured order. */
    readonly tools: readonly ToolLoopTool[];
};
