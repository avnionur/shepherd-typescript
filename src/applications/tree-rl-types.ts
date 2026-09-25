import type { SemanticRecord, SemanticValue } from "../canonical/canonical-record.ts";
import type { EffectHandlerStack } from "../effect/handler-types.ts";
import type {
    APPLICATION_TREE_RL_ACTION_SEGMENTS,
    APPLICATION_TREE_RL_BASELINE_KINDS,
    APPLICATION_TREE_RL_BATCH_FORMATS,
    APPLICATION_TREE_RL_MEMBER_KINDS,
    APPLICATION_TREE_RL_NORMALIZATIONS,
    APPLICATION_TREE_RL_PHASES,
    APPLICATION_TREE_RL_ROLLOUT_STATUSES,
} from "../protocol/values.generated.ts";
import type { ModelProvider, ModelRequest } from "../provider/types.ts";
import type { RecordId } from "../record/types.ts";
import type {
    ReplayProcessAdapter,
    ReplaySessionInspection,
    ReplaySessionProgram,
    ReplayWorldBinding,
} from "../replay/types.ts";
import type { CutId } from "../store/types.ts";
import type {
    ApplicationCostSummary,
    ApplicationKind,
    ApplicationManifest,
    ApplicationProtocolDefinition,
} from "./types.ts";

/** Configured Tree-RL record phase: opened, root, rollout, or batch. */
export type TreeRlRecordPhase = (typeof APPLICATION_TREE_RL_PHASES)[number];

/** Configured rollout and root grading status: completed or failed. */
export type TreeRlRolloutStatus = (typeof APPLICATION_TREE_RL_ROLLOUT_STATUSES)[number];

/** Configured comparison baseline kind. */
export type TreeRlBaselineKind = (typeof APPLICATION_TREE_RL_BASELINE_KINDS)[number];

/** Configured training batch format. */
export type TreeRlBatchFormat = (typeof APPLICATION_TREE_RL_BATCH_FORMATS)[number];

/** Configured tree member kind: the root rollout or one of its K branches. */
export type TreeRlMemberKind = (typeof APPLICATION_TREE_RL_MEMBER_KINDS)[number];

/** Configured per-action advantage segment: prefix, suffix, or flat (baseline only). */
export type TreeRlActionSegment = (typeof APPLICATION_TREE_RL_ACTION_SEGMENTS)[number];

/** Configured advantage normalization: raw centered values or per-group standardization. */
export type TreeRlNormalization = (typeof APPLICATION_TREE_RL_NORMALIZATIONS)[number];

/**
 * Step boundary a rollout branch starts from: the fork step is the first step the branch executes
 * live, and every earlier step is served from the root journal.
 */
export type TreeRlForkPoint = {
    /** Root prefix identity at the boundary, or null when the fork step is step 0. */
    readonly prefix_id: string | null;
    /** Index of the forked provider step, equal to the number of recorded prefix steps. */
    readonly step_index: number;
};

/** One trace-selected fork point with the transitive dependent count that qualified it. */
export type TreeRlSelectedForkPoint = TreeRlForkPoint & {
    /** Number of transitive dependents of the fork step in the session. */
    readonly dependents: number;
};

/** Options for {@link selectTreeRlForkPoints}. */
export type SelectTreeRlForkPointsOptions = {
    /** Lease clock used to classify the session; defaults to `Date.now`. */
    readonly clock?: () => number;
    /** Maximum fork points to select; positive and at most `APPLICATION_LIMITS.maxForkPoints`. */
    readonly maxForkPoints: number;
    /** Minimum transitive dependent count a provider step must reach to qualify. */
    readonly minDependents: number;
    /** Recorded session identity. */
    readonly sessionId: string;
};

/** Tool call a fork proposal injects as the first action of one branch at the fork turn. */
export type TreeRlToolCall = {
    /** Canonical tool input object. */
    readonly arguments: SemanticRecord;
    /** Called tool name. */
    readonly name: string;
};

/**
 * Fork proposal of one root rollout (paper Appendix F.7): the one-based turn to fork at, the tool
 * call the selector would make there, and its reason.
 */
export type TreeRlForkProposal = {
    /** Proposed one-based fork turn; clamped into the admissible range. */
    readonly branch_turn: number;
    /** Bounded reason for the choice. */
    readonly reason: string;
    /** Tool call that seeds the first branch, or null to seed none. */
    readonly tool_call: TreeRlToolCall | null;
};

/** One turn (provider step) of a root rollout presented to a fork selector. */
export type TreeRlTurn = {
    /** Response output, or null when the invocation failed. */
    readonly output: SemanticValue | null;
    /** Exact provider request of the turn. */
    readonly request: ModelRequest;
    /** Whether a branch can restore the boundary right before this turn. */
    readonly restorable: boolean;
    /** Step index of the turn's provider step in the root session. */
    readonly step_index: number;
    /** One-based turn number. */
    readonly turn: number;
};

/** Context a fork selector receives for one graded root rollout. */
export type TreeRlForkSelectionContext = {
    /** Zero-based root index within the prompt's group. */
    readonly group_index: number;
    /** Prompt identity. */
    readonly prompt_id: string;
    /** Validated protocol definition of the run. */
    readonly protocol: ApplicationProtocolDefinition;
    /** Root reward, or null when grading failed. */
    readonly reward: number | null;
    /** Terminal root session inspection. */
    readonly root: ReplaySessionInspection;
    /** Admissible one-based fork-turn range `[first, last]` the proposal is clamped into. */
    readonly turn_bounds: { readonly first: number; readonly last: number };
    /** Every turn of the root in order. */
    readonly turns: readonly TreeRlTurn[];
};

/**
 * Fork-selection interface (paper Algorithm 2 line 12, `t* <- P(tau_root)`): returns the fork turn,
 * the tool call that seeds one branch, and a reason. It is called once per root that has no
 * retained root record, after the root is graded.
 *
 * @param context - Root session, reward, turns, admissible bounds, and protocol.
 * @returns The fork proposal.
 */
export type TreeRlForkSelector = (
    context: TreeRlForkSelectionContext,
) => Promise<TreeRlForkProposal> | TreeRlForkProposal;

/** Options for {@link createMetaAgentTreeRlForkSelector}. */
export type MetaAgentTreeRlForkSelectorOptions = {
    /** Meta-agent provider answering one structured request per root. */
    readonly provider: ModelProvider;
    /** Cancellation signal passed to every provider invocation. */
    readonly signal?: AbortSignal;
};

/** Retained fork decision of one root. */
export type TreeRlForkDecision = {
    /** Resolved one-based fork turn inside the admissible range. */
    readonly branch_turn: number;
    /** Step boundary of the resolved fork turn. */
    readonly fork_point: TreeRlForkPoint;
    /** Turn the selector proposed before clamping and restorability resolution. */
    readonly proposed_turn: number;
    /** Selector reason. */
    readonly reason: string;
    /** Tool call seeding the first branch, or null. */
    readonly tool_call: TreeRlToolCall | null;
};

/** One prompt of a Tree-RL batch and its G recorded root rollouts. */
export type TreeRlPrompt = {
    /** Handler stack of every rollout suffix of this prompt; required when the program dispatches effects. */
    readonly handlers?: EffectHandlerStack;
    /** Prompt identity, distinct within the batch. */
    readonly id: string;
    /** Deterministic program of every root session, re-executed over each recorded prefix. */
    readonly program: ReplaySessionProgram;
    /** Finished root session identities, exactly the protocol's group size G. */
    readonly roots: readonly string[];
};

/** Identity of one planned branch rollout the provider and bindings factories receive. */
export type TreeRlProviderContext = {
    /** Zero-based branch index within the root. */
    readonly branch: number;
    /** Resolved one-based fork turn. */
    readonly branch_turn: number;
    /** Fork point the rollout branches from. */
    readonly fork_point: TreeRlForkPoint;
    /** Zero-based root index within the prompt's group. */
    readonly group_index: number;
    /** Prompt identity. */
    readonly prompt_id: string;
    /** Root session identity. */
    readonly root_session_id: string;
    /** Seed of the rollout. */
    readonly seed: number;
    /**
     * Proposed tool call the rollout's first live action must carry, or null. Only the first
     * branch of a root whose proposal named a tool call receives it; the factory renders it into
     * the policy's response format (the paper re-renders it through the policy's renderer).
     */
    readonly tool_call: TreeRlToolCall | null;
};

/**
 * Caller-supplied factory returning the rollout's own static provider cassette.
 *
 * It is called once for every planned rollout without a retained record, after every root is
 * graded and before the first branch rollout opens; each call must return a distinct provider
 * whose descriptor kind is the configured static provider kind.
 *
 * @param context - Prompt, root, fork point, branch, seed, and seeding tool call of the rollout.
 * @returns The rollout's provider.
 */
export type TreeRlProviderFactory = (context: TreeRlProviderContext) => ModelProvider;

/**
 * Restoration bindings of one rollout of a world- or process-bound root.
 *
 * Every rollout restores the fork point's retained checkpoint into its own bindings, so each call
 * must return fresh empty world roots and process adapters of its own.
 */
export type TreeRlRolloutBindings = {
    /** Handler stack of the rollout suffix bound to its own worlds; defaults to the prompt's. */
    readonly handlers?: EffectHandlerStack;
    /** Process adapters receiving the checkpoint's verified images, one per root process. */
    readonly processes?: readonly ReplayProcessAdapter[];
    /** Empty restoration roots, one per root world. */
    readonly worlds?: readonly ReplayWorldBinding[];
};

/**
 * Caller-supplied factory returning each rollout's restoration bindings. It is called once for
 * every rollout whose record is not yet retained, before its session opens.
 *
 * @param context - Prompt, root, branch, fork point, seed, and seeding tool call of the rollout.
 * @returns The rollout's handler stack, empty world roots, and process adapters.
 */
export type TreeRlBindingsFactory = (
    context: TreeRlProviderContext,
) => Promise<TreeRlRolloutBindings> | TreeRlRolloutBindings;

/** Context the reward function (`Grade`) receives for one finished tree member. */
export type TreeRlRewardContext = {
    /** Zero-based branch index, or null for the root. */
    readonly branch: number | null;
    /** Measured cost of the graded session's live provider steps. */
    readonly cost: ApplicationCostSummary;
    /** Fork point of the branch, or null for the root. */
    readonly fork_point: TreeRlForkPoint | null;
    /** Zero-based root index within the prompt's group. */
    readonly group_index: number;
    /** Tree member kind. */
    readonly member: TreeRlMemberKind;
    /** Prompt identity. */
    readonly prompt_id: string;
    /** Validated protocol definition of the run. */
    readonly protocol: ApplicationProtocolDefinition;
    /** Root session inspection. */
    readonly root: ReplaySessionInspection;
    /** Graded session inspection: the root itself, or the terminal branch rollout. */
    readonly rollout: ReplaySessionInspection;
    /** Seed of the branch, or null for the root. */
    readonly seed: number | null;
};

/**
 * Caller-supplied reward function returning one finite scalar per finished tree member.
 *
 * A thrown error or a non-finite result retains the member as failed with the verification code;
 * the run continues and the member is excluded from every mean.
 *
 * @param context - Graded session, root, member, fork point, seed, cost, and protocol.
 * @returns The finite reward.
 */
export type TreeRlRewardFunction = (context: TreeRlRewardContext) => Promise<number> | number;

/** Retained failure of one root grading or rollout. */
export type TreeRlFailure = {
    /** Configured error code: invalid evidence or failed verification. */
    readonly code: string;
    /** Configured failure reason. */
    readonly reason: string;
};

/** One retained root record: grading and fork decision of one recorded root rollout. */
export type TreeRlRootRecord = {
    /** Measured cost of the root session's live provider steps. */
    readonly cost: ApplicationCostSummary;
    /** Failure of the grading, or null when completed. */
    readonly failure: TreeRlFailure | null;
    /** Fork decision. */
    readonly fork: TreeRlForkDecision;
    /** Zero-based root index within the prompt's group. */
    readonly group_index: number;
    /** Prompt identity. */
    readonly prompt_id: string;
    /** Retained record identity. */
    readonly record_id: RecordId;
    /** Finite reward, or null when grading failed. */
    readonly reward: number | null;
    /** Root session identity. */
    readonly root_session_id: string;
    /** Grading status. */
    readonly status: TreeRlRolloutStatus;
    /** Steps the root session retained. */
    readonly step_count: number;
    /** Step index of every turn (provider step) of the root, in order. */
    readonly turns: readonly number[];
};

/** Identity of one planned branch rollout, fixed by its root's retained fork decision. */
export type TreeRlRolloutPlan = {
    /** Zero-based branch index within the root. */
    readonly branch: number;
    /** Resolved one-based fork turn. */
    readonly branch_turn: number;
    /** Fork point the rollout branches from. */
    readonly fork_point: TreeRlForkPoint;
    /** Zero-based root index within the prompt's group. */
    readonly group_index: number;
    /** Prompt identity. */
    readonly prompt_id: string;
    /** Rollout session identity derived from the application and the rollout. */
    readonly replay_session_id: string;
    /** Rollout identity derived from the application, root, fork point, and seed. */
    readonly rollout_id: string;
    /** Root session identity. */
    readonly root_session_id: string;
    /** Seed of the rollout. */
    readonly seed: number;
    /** Whether the proposed tool call seeds this branch. */
    readonly seeded: boolean;
};

/** One retained branch rollout record. */
export type TreeRlRolloutRecord = TreeRlRolloutPlan & {
    /** Measured cost of the rollout session. */
    readonly cost: ApplicationCostSummary;
    /** Failure, or null when completed. */
    readonly failure: TreeRlFailure | null;
    /** Retained record identity. */
    readonly record_id: RecordId;
    /** Finite reward, or null when failed. */
    readonly reward: number | null;
    /** Rollout status. */
    readonly status: TreeRlRolloutStatus;
    /** Steps the rollout session retained. */
    readonly step_count: number;
    /** Step index of every turn (provider step) of the rollout session, in order. */
    readonly turns: readonly number[];
};

/** Record-derived state of one planned rollout. */
export type TreeRlRolloutInspection = TreeRlRolloutPlan & {
    /** Retained rollout record, or null before the rollout settled. */
    readonly record: TreeRlRolloutRecord | null;
};

/**
 * Rollout fields the per-fork-point advantage computation read before 10.0.0.
 *
 * @deprecated Since 10.0.0: {@link computeTreeRlAdvantages} reads {@link TreeRlAdvantageTree}
 * values and no API consumes this type; it is removed once the deprecation window elapses.
 */
export type TreeRlAdvantageInput = {
    /** Fork point; rollouts sharing its step index formed one group. */
    readonly fork_point: { readonly step_index: number };
    /** Finite reward, or null when failed. */
    readonly reward: number | null;
    /** Distinct rollout identity. */
    readonly rollout_id: string;
    /** Rollout status; only completed rollouts entered a mean. */
    readonly status: TreeRlRolloutStatus;
};

/** Rewards of one tree {@link computeTreeRlAdvantages} reads. */
export type TreeRlAdvantageTree = {
    /** Branch rewards in branch order; null for a failed branch. */
    readonly branches: readonly (number | null)[];
    /** Zero-based root index within the prompt's group. */
    readonly group_index: number;
    /** Prompt identity; trees sharing it form one G-root group. */
    readonly prompt_id: string;
    /** Root reward, or null when grading failed. */
    readonly root: number | null;
};

/** Algorithm 2 advantages of one tree. */
export type TreeRlAdvantage = {
    /** Intra-tree advantage of each branch in branch order; null for a failed branch. */
    readonly branch_intra_advantages: readonly (number | null)[];
    /** Zero-based root index within the prompt's group. */
    readonly group_index: number;
    /** Inter-root advantage of the root (prefix actions), or null when grading failed. */
    readonly inter_root_advantage: number | null;
    /** Prompt identity. */
    readonly prompt_id: string;
    /** Intra-tree advantage of the root's suffix actions, or null when grading failed. */
    readonly root_intra_advantage: number | null;
};

/** One action (turn) of a training line and the advantage attributed to it. */
export type TreeRlActionAdvantage = {
    /** Attributed advantage. */
    readonly advantage: number;
    /** Segment: prefix (inter-root), suffix (intra-tree), or flat (baseline). */
    readonly segment: TreeRlActionSegment;
    /** Step index of the action's provider step in the member session. */
    readonly step_index: number;
    /** One-based turn number. */
    readonly turn: number;
};

/** One canonical `jsonl_v2` training batch line: one graded tree member. */
export type TreeRlTrainingLine = {
    /** Per-action advantage attribution in turn order. */
    readonly actions: readonly TreeRlActionAdvantage[];
    /** Branch index, or null for the root. */
    readonly branch: number | null;
    /** Resolved one-based fork turn of the tree. */
    readonly branch_turn: number;
    /** Fork point of the tree. */
    readonly fork_point: TreeRlForkPoint;
    /** Zero-based root index within the prompt's group. */
    readonly group_index: number;
    /** Inter-root advantage of the tree's prefix actions, or null when root grading failed. */
    readonly inter_root_advantage: number | null;
    /** Intra-tree advantage of the member's suffix actions, or null in the flat baseline. */
    readonly intra_tree_advantage: number | null;
    /** Tree member kind. */
    readonly member: TreeRlMemberKind;
    /** Prompt identity. */
    readonly prompt_id: string;
    /** Member session identity: the root session or the rollout session. */
    readonly replay_session_id: string;
    /** Finite reward. */
    readonly reward: number;
    /** Rollout identity, or null for the root. */
    readonly rollout_id: string | null;
    /** Root session identity. */
    readonly root_session_id: string;
    /** Branch seed, or null for the root. */
    readonly seed: number | null;
    /** Whether the proposed tool call seeded this member. */
    readonly seeded: boolean;
    /** Steps the member session retained. */
    readonly step_count: number;
};

/** Format, digest, and size of one training batch. */
export type TreeRlBatchSummary = {
    /** Digest of the batch text under the configured algorithm. */
    readonly batch_digest: string;
    /** Configured batch format. */
    readonly format: TreeRlBatchFormat;
    /** Number of lines: one per graded tree member. */
    readonly line_count: number;
};

/** Retained batch record. */
export type TreeRlBatchRecord = TreeRlBatchSummary & {
    /** Flat GRPO baseline batch summary, or null. */
    readonly baseline: (TreeRlBatchSummary & { readonly kind: TreeRlBaselineKind }) | null;
    /** Retained record identity. */
    readonly record_id: RecordId;
};

/** One exported training batch: canonical lines, their text, and its digest. */
export type TreeRlBatchExport = TreeRlBatchSummary & {
    /** Canonical lines in prompt, root, then member order. */
    readonly lines: readonly TreeRlTrainingLine[];
    /** Canonical JSON lines, each terminated by a line feed. */
    readonly text: string;
};

/** Result of {@link exportTreeRlTrainingBatch}. */
export type TreeRlTrainingBatch = TreeRlBatchExport & {
    /** Application identity. */
    readonly application_id: string;
    /** Flat GRPO baseline batch, or null. */
    readonly baseline: (TreeRlBatchExport & { readonly kind: TreeRlBaselineKind }) | null;
    /** Advantage normalization the run retained. */
    readonly normalization: TreeRlNormalization;
};

/**
 * Optional trainer-export adapter: the seam a trainer integration implements to receive a
 * retained training batch. No trainer ships with this package.
 */
export type TreeRlTrainerAdapter<TResult> = {
    /** Batch formats the adapter accepts. */
    readonly formats: readonly TreeRlBatchFormat[];
    /** Adapter identity. */
    readonly id: string;
    /**
     * Receives one exported batch.
     *
     * @param batch - Frozen exported batch whose digest equals the retained digest.
     * @returns The adapter's result, such as a trainer job identity.
     */
    readonly submit: (batch: TreeRlTrainingBatch) => Promise<TResult> | TResult;
};

/** Options for {@link runTreeRlRollouts}. */
export type RunTreeRlRolloutsOptions = {
    /** Comparison baselines; defaults to none. */
    readonly baselines?: readonly TreeRlBaselineKind[];
    /** Per-rollout restoration bindings; required when a root binds worlds or processes. */
    readonly bindings?: TreeRlBindingsFactory;
    /** Writer lease holder of every rollout session. */
    readonly claimId: string;
    /** Lease clock in Unix milliseconds for every replay session; defaults to `Date.now`. */
    readonly clock?: () => number;
    /** Globally idempotent application command identity. */
    readonly commandId: string;
    /**
     * Concurrent root gradings and branch rollouts; defaults to
     * `APPLICATION_TREE_RL_LIMITS.defaultConcurrency`, at most `maxConcurrency`. Retained output
     * is independent of it.
     */
    readonly concurrency?: number;
    /** Advantage normalization; defaults to the configured one. Retained with the run. */
    readonly normalization?: TreeRlNormalization;
    /** Prompt batch: B prompts, each with its program and G recorded roots. */
    readonly prompts: readonly TreeRlPrompt[];
    /** Tree-RL protocol definition. */
    readonly protocol: ApplicationProtocolDefinition;
    /** Factory returning each rollout's own static provider cassette. */
    readonly provider: TreeRlProviderFactory;
    /** Reward function returning one finite scalar per finished tree member. */
    readonly reward: TreeRlRewardFunction;
    /** Fork selector called once per root without a retained root record. */
    readonly selector: TreeRlForkSelector;
};

/** Immutable record-derived view of one Tree-RL run. */
export type TreeRlRunInspection = {
    /** Application identity and owner path. */
    readonly application_id: string;
    /** Comparison baselines. */
    readonly baselines: readonly TreeRlBaselineKind[];
    /** Retained batch record, or null before every rollout settled. */
    readonly batch: TreeRlBatchRecord | null;
    /** Application command identity. */
    readonly command_id: string;
    /** Terminal cut, or null before the manifest was retained. */
    readonly cut_id: CutId | null;
    /** Application kind. */
    readonly kind: ApplicationKind;
    /** Retained manifest, or null. */
    readonly manifest: ApplicationManifest | null;
    /** Manifest record identity, or null. */
    readonly manifest_record_id: RecordId | null;
    /** Advantage normalization. */
    readonly normalization: TreeRlNormalization;
    /** Opened record identity. */
    readonly opened_record_id: RecordId;
    /** Prompts with their root session identities in batch order. */
    readonly prompts: readonly { readonly id: string; readonly roots: readonly string[] }[];
    /** Protocol definition identity. */
    readonly protocol_id: string;
    /** Every planned rollout in prompt, root, then branch order; empty before the roots settled. */
    readonly rollouts: readonly TreeRlRolloutInspection[];
    /** Retained root records in prompt, then root order. */
    readonly roots: readonly TreeRlRootRecord[];
    /** Branch seeds in branch order. */
    readonly seeds: readonly number[];
};

/** Result of {@link runTreeRlRollouts}. */
export type TreeRlRunReceipt = {
    /** Exported training batch. */
    readonly batch: TreeRlTrainingBatch;
    /** Record-derived inspection of the run. */
    readonly inspection: TreeRlRunInspection;
    /** Retained manifest. */
    readonly manifest: ApplicationManifest;
};
