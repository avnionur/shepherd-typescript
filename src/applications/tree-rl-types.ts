import type { EffectHandlerStack } from "../effect/handler-types.ts";
import type {
    APPLICATION_TREE_RL_BASELINE_KINDS,
    APPLICATION_TREE_RL_BATCH_FORMATS,
    APPLICATION_TREE_RL_PHASES,
    APPLICATION_TREE_RL_ROLLOUT_STATUSES,
} from "../protocol/values.generated.ts";
import type { ModelProvider } from "../provider/types.ts";
import type { RecordId } from "../record/types.ts";
import type { ReplaySessionInspection, ReplaySessionProgram } from "../replay/types.ts";
import type { CutId } from "../store/types.ts";
import type {
    ApplicationCostSummary,
    ApplicationKind,
    ApplicationManifest,
    ApplicationProtocolDefinition,
} from "./types.ts";

/** Configured Tree-RL record phase: opened, rollout, or batch. */
export type TreeRlRecordPhase = (typeof APPLICATION_TREE_RL_PHASES)[number];

/** Configured rollout status: completed or failed. */
export type TreeRlRolloutStatus = (typeof APPLICATION_TREE_RL_ROLLOUT_STATUSES)[number];

/** Configured comparison baseline kind. */
export type TreeRlBaselineKind = (typeof APPLICATION_TREE_RL_BASELINE_KINDS)[number];

/** Configured training batch format. */
export type TreeRlBatchFormat = (typeof APPLICATION_TREE_RL_BATCH_FORMATS)[number];

/**
 * Step boundary a rollout branch starts from: the fork step is the first step the branch executes
 * live, and every earlier step is served from the source journal.
 */
export type TreeRlForkPoint = {
    /** Source prefix identity at the boundary, or null when the fork step is step 0. */
    readonly prefix_id: string | null;
    /** Index of the forked provider step, equal to the number of recorded prefix steps. */
    readonly step_index: number;
};

/** One trace-selected fork point with the transitive dependent count that qualified it. */
export type TreeRlSelectedForkPoint = TreeRlForkPoint & {
    /** Number of transitive dependents of the fork step in the source session. */
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
    /** Recorded source session identity. */
    readonly sessionId: string;
};

/** Identity of one planned rollout the provider factory receives. */
export type TreeRlProviderContext = {
    /** Zero-based branch index within the fork point. */
    readonly branch: number;
    /** Fork point the rollout branches from. */
    readonly fork_point: TreeRlForkPoint;
    /** Seed of the rollout. */
    readonly seed: number;
    /** Recorded source session identity. */
    readonly source_session_id: string;
};

/**
 * Caller-supplied factory returning the rollout's own static provider cassette.
 *
 * It is called once for every planned rollout before any record is written; each call must return
 * a distinct provider whose descriptor kind is the configured static provider kind.
 *
 * @param context - Fork point, branch, seed, and source session of the rollout.
 * @returns The rollout's provider.
 */
export type TreeRlProviderFactory = (context: TreeRlProviderContext) => ModelProvider;

/** Context the reward function receives for one finished, proven rollout. */
export type TreeRlRewardContext = {
    /** Zero-based branch index within the fork point. */
    readonly branch: number;
    /** Measured cost of the rollout session. */
    readonly cost: ApplicationCostSummary;
    /** Fork point the rollout branched from. */
    readonly fork_point: TreeRlForkPoint;
    /** Validated protocol definition of the run. */
    readonly protocol: ApplicationProtocolDefinition;
    /** Terminal rollout session inspection. */
    readonly rollout: ReplaySessionInspection;
    /** Seed of the rollout. */
    readonly seed: number;
    /** Recorded source session inspection. */
    readonly source: ReplaySessionInspection;
};

/**
 * Caller-supplied reward function returning one finite scalar per completed rollout.
 *
 * A thrown error or a non-finite result retains the rollout as failed with the verification code;
 * the run continues and the rollout is excluded from every mean.
 *
 * @param context - Rollout session, fork point, seed, cost, and protocol.
 * @returns The finite reward.
 */
export type TreeRlRewardFunction = (context: TreeRlRewardContext) => Promise<number> | number;

/** Retained failure of one rollout. */
export type TreeRlFailure = {
    /** Configured error code: invalid evidence or failed verification. */
    readonly code: string;
    /** Configured failure reason. */
    readonly reason: string;
};

/** Identity of one planned rollout, fixed when the run is opened. */
export type TreeRlRolloutPlan = {
    /** Zero-based branch index within the fork point. */
    readonly branch: number;
    /** Fork point the rollout branches from. */
    readonly fork_point: TreeRlForkPoint;
    /** Rollout session identity derived from the application and the rollout. */
    readonly replay_session_id: string;
    /** Rollout identity derived from the application, fork point, and seed. */
    readonly rollout_id: string;
    /** Seed of the rollout. */
    readonly seed: number;
};

/** One retained rollout record. */
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
};

/** Record-derived state of one planned rollout. */
export type TreeRlRolloutInspection = TreeRlRolloutPlan & {
    /** Retained rollout record, or null before the rollout settled. */
    readonly record: TreeRlRolloutRecord | null;
};

/** Rollout fields {@link computeTreeRlAdvantages} reads. */
export type TreeRlAdvantageInput = {
    /** Fork point; rollouts sharing its step index form one group. */
    readonly fork_point: { readonly step_index: number };
    /** Finite reward, or null when failed. */
    readonly reward: number | null;
    /** Distinct rollout identity. */
    readonly rollout_id: string;
    /** Rollout status; only completed rollouts enter a mean. */
    readonly status: TreeRlRolloutStatus;
};

/** Advantages of one completed rollout. */
export type TreeRlAdvantage = {
    /** Mean reward at the rollout's fork point minus the mean of every completed reward. */
    readonly inter_branch_advantage: number;
    /** Reward minus the mean reward of completed rollouts sharing the fork point. */
    readonly intra_branch_advantage: number;
    /** Rollout identity. */
    readonly rollout_id: string;
};

/** One canonical `jsonl_v1` training batch line. */
export type TreeRlTrainingLine = TreeRlAdvantage & {
    /** Fork point the rollout branched from. */
    readonly fork_point: TreeRlForkPoint;
    /** Rollout session identity. */
    readonly replay_session_id: string;
    /** Finite reward. */
    readonly reward: number;
    /** Seed of the rollout. */
    readonly seed: number;
    /** Recorded source session identity. */
    readonly session_id: string;
    /** Steps the rollout session retained. */
    readonly step_count: number;
};

/** Format, digest, and size of one training batch. */
export type TreeRlBatchSummary = {
    /** Digest of the batch text under the configured algorithm. */
    readonly batch_digest: string;
    /** Configured batch format. */
    readonly format: TreeRlBatchFormat;
    /** Number of lines: one per completed rollout. */
    readonly line_count: number;
};

/** Retained batch record. */
export type TreeRlBatchRecord = TreeRlBatchSummary & {
    /** Single-rollout baseline batch summary, or null. */
    readonly baseline: (TreeRlBatchSummary & { readonly kind: TreeRlBaselineKind }) | null;
    /** Retained record identity. */
    readonly record_id: RecordId;
};

/** One exported training batch: canonical lines, their text, and its digest. */
export type TreeRlBatchExport = TreeRlBatchSummary & {
    /** Canonical lines in rollout order. */
    readonly lines: readonly TreeRlTrainingLine[];
    /** Canonical JSON lines, each terminated by a line feed. */
    readonly text: string;
};

/** Result of {@link exportTreeRlTrainingBatch}. */
export type TreeRlTrainingBatch = TreeRlBatchExport & {
    /** Application identity. */
    readonly application_id: string;
    /** Single-rollout baseline batch, or null. */
    readonly baseline: (TreeRlBatchExport & { readonly kind: TreeRlBaselineKind }) | null;
};

/** Options for {@link runTreeRlRollouts}. */
export type RunTreeRlRolloutsOptions = {
    /** Comparison baselines; defaults to none. */
    readonly baselines?: readonly TreeRlBaselineKind[];
    /** Writer lease holder of every rollout session. */
    readonly claimId: string;
    /** Lease clock in Unix milliseconds for every replay session; defaults to `Date.now`. */
    readonly clock?: () => number;
    /** Globally idempotent application command identity. */
    readonly commandId: string;
    /** Handler stack of every rollout suffix; required when the program dispatches effects. */
    readonly handlers?: EffectHandlerStack;
    /** Deterministic program of the source session, re-executed over the recorded prefix. */
    readonly program: ReplaySessionProgram;
    /** Tree-RL protocol definition. */
    readonly protocol: ApplicationProtocolDefinition;
    /** Factory returning each rollout's own static provider cassette. */
    readonly provider: TreeRlProviderFactory;
    /** Reward function returning one finite scalar per completed rollout. */
    readonly reward: TreeRlRewardFunction;
    /** Finished source session recorded without bound worlds or processes. */
    readonly sourceSessionId: string;
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
    /** Trace-selected fork points in step order. */
    readonly fork_points: readonly TreeRlSelectedForkPoint[];
    /** Application kind. */
    readonly kind: ApplicationKind;
    /** Retained manifest, or null. */
    readonly manifest: ApplicationManifest | null;
    /** Manifest record identity, or null. */
    readonly manifest_record_id: RecordId | null;
    /** Opened record identity. */
    readonly opened_record_id: RecordId;
    /** Protocol definition identity. */
    readonly protocol_id: string;
    /** Every planned rollout in fork-point, then branch order. */
    readonly rollouts: readonly TreeRlRolloutInspection[];
    /** Branch seeds in branch order. */
    readonly seeds: readonly number[];
    /** Recorded source session identity. */
    readonly source_session_id: string;
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
