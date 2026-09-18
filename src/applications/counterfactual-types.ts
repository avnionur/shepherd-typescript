import type { EffectHandlerStack } from "../effect/handler-types.ts";
import type {
    APPLICATION_CRO_BASELINE_KINDS,
    APPLICATION_CRO_CANDIDATE_STATUSES,
    APPLICATION_CRO_PHASES,
} from "../protocol/values.generated.ts";
import type { ModelProvider } from "../provider/types.ts";
import type { RecordId } from "../record/types.ts";
import type {
    ReplayChangeDimension,
    ReplayDivergenceAnalysis,
    ReplaySessionInspection,
    ReplaySessionProgram,
    ReplaySessionTaskDefinition,
} from "../replay/types.ts";
import type { CutId } from "../store/types.ts";
import type {
    ApplicationCostSummary,
    ApplicationKind,
    ApplicationManifest,
    ApplicationProtocolDefinition,
} from "./types.ts";

/** Configured counterfactual optimizer record phase: the opened record or a candidate record. */
export type CounterfactualRecordPhase = (typeof APPLICATION_CRO_PHASES)[number];

/** Configured candidate status: proposed, evaluated, promoted, or rejected. */
export type CounterfactualCandidateStatus = (typeof APPLICATION_CRO_CANDIDATE_STATUSES)[number];

/** Configured comparison baseline kind. */
export type CounterfactualBaselineKind = (typeof APPLICATION_CRO_BASELINE_KINDS)[number];

/**
 * Baseline workflow recorded once through a root replay session.
 *
 * The program must bind no worlds or processes so every step boundary is an admissible branch
 * target. The provider, handler stack, and task service the baseline session and every branch
 * suffix that does not declare the corresponding change, so a provider must be able to answer
 * repeated sessions.
 */
export type CounterfactualWorkflowDefinition = {
    /** Effect handler stack; required when the program dispatches effects. */
    readonly handlers?: EffectHandlerStack;
    /** Deterministic session program. */
    readonly program: ReplaySessionProgram;
    /** Stable program identity retained with the baseline session. */
    readonly programId: string;
    /** Provider; required when the program invokes a provider. */
    readonly provider?: ModelProvider;
    /** Task and input bound to the baseline session. */
    readonly task?: ReplaySessionTaskDefinition;
};

/**
 * One declared candidate edit of the workflow at a step boundary.
 *
 * Exactly the replacements for the declared change dimensions are supplied: `task` requires
 * `task`, `provider` requires `provider`, and `handlers` requires `handlers`. The edit takes
 * effect in the affected suffix: the transitive dependents of the edited step in the source
 * session, which is the parent candidate's branch or, without a parent, the baseline.
 */
export type CounterfactualCandidateDefinition = {
    /** Non-empty distinct subset of the configured replay change dimensions. */
    readonly changes: readonly ReplayChangeDimension[];
    /** Replacement handler stack of the affected suffix; exactly with the `handlers` change. */
    readonly handlers?: EffectHandlerStack;
    /** Caller name, unique within the run. */
    readonly name: string;
    /** Name of an earlier candidate whose branch this candidate forks; omitted forks the baseline. */
    readonly parent?: string;
    /** Program re-executed over the recorded prefix; defaults to the baseline program. */
    readonly program?: ReplaySessionProgram;
    /** Replacement provider of the affected suffix; exactly with the `provider` change. */
    readonly provider?: ModelProvider;
    /** Zero-based index of the edited step in the source session. */
    readonly stepIndex: number;
    /** Replacement task of the affected suffix; exactly with the `task` change. */
    readonly task?: ReplaySessionTaskDefinition;
};

/** Identity and declared edit of one candidate, fixed when the run is opened. */
export type CounterfactualCandidatePlan = {
    /** Candidate identity derived from the application and the declared edit. */
    readonly candidate_id: string;
    /** Declared change dimensions in configured order. */
    readonly changes: readonly ReplayChangeDimension[];
    /** Zero-based index of the edited step in the source session. */
    readonly edited_step_index: number;
    /** Caller name. */
    readonly name: string;
    /** Parent candidate identity, or null when the candidate forks the baseline. */
    readonly parent_candidate_id: string | null;
};

/** Step boundary a candidate branch starts from. */
export type CounterfactualTarget = {
    /** Prefix identity of the source at the boundary. */
    readonly prefix_id: string;
    /** Source session the branch forks. */
    readonly source_session_id: string;
    /** Number of source steps served from the recorded journal. */
    readonly step_index: number;
};

/** Retained summary of the divergence proof of one candidate branch. */
export type CounterfactualDivergenceSummary = {
    /** Prefix identity of the longest identical prefix, or null. */
    readonly common_prefix_id: string | null;
    /** First non-identical step index, or null when the branch equals its source. */
    readonly first_divergence_index: number | null;
    /** Steps the branch executed live. */
    readonly live_steps: number;
    /** Steps the branch served from the source journal. */
    readonly recorded_steps: number;
    /** Indices of unexplained divergences. */
    readonly unexplained: readonly number[];
};

/** Verdict of the caller-supplied targeted evaluator, retained verbatim. */
export type CounterfactualEvaluation = {
    /** Whether the candidate passed the targeted evaluation. */
    readonly passed: boolean;
    /** Bounded evaluator reason. */
    readonly reason: string;
    /** Finite evaluation score; higher is better. */
    readonly score: number;
};

/** Retained failure that rejected a candidate and stopped the run. */
export type CounterfactualFailure = {
    /** Configured error code: invalid evidence or failed verification. */
    readonly code: string;
    /** Retained failure detail. */
    readonly reason: string;
};

/** Measured whole-workflow comparison of one candidate. */
export type CounterfactualBaselineComparison = {
    /** Provider cache-read tokens the comparison session observed. */
    readonly cache_read_input_tokens: number;
    /** Configured baseline kind. */
    readonly kind: CounterfactualBaselineKind;
    /** Live provider calls the comparison session issued. */
    readonly provider_calls: number;
    /** Comparison session identity. */
    readonly session_id: string;
};

/** One retained candidate record. */
export type CounterfactualCandidateRecord = CounterfactualCandidatePlan & {
    /** Transitive dependents of the edited step in the source session, ascending. */
    readonly affected_steps: readonly number[];
    /** Measured whole-workflow comparison, or null. */
    readonly baseline: CounterfactualBaselineComparison | null;
    /** Affected-suffix branch session identity. */
    readonly branch_session_id: string;
    /** Measured cost of the branch session, or null while proposed. */
    readonly cost: ApplicationCostSummary | null;
    /** Divergence proof summary, or null while proposed. */
    readonly divergence: CounterfactualDivergenceSummary | null;
    /** Retained evaluator verdict, or null. */
    readonly evaluation: CounterfactualEvaluation | null;
    /** Failure that rejected the candidate and stopped the run, or null. */
    readonly failure: CounterfactualFailure | null;
    /** Retained record identity. */
    readonly record_id: RecordId;
    /** Candidate status. */
    readonly status: CounterfactualCandidateStatus;
    /** Branch start boundary. */
    readonly target: CounterfactualTarget;
};

/** Record-derived state of one declared candidate. */
export type CounterfactualCandidateInspection = CounterfactualCandidatePlan & {
    /** Evaluated or rejected record, or null before the candidate completed. */
    readonly outcome: CounterfactualCandidateRecord | null;
    /** Proposed record, or null before the candidate was proposed. */
    readonly proposed: CounterfactualCandidateRecord | null;
};

/** Context the targeted evaluator receives for one proven candidate branch. */
export type CounterfactualEvaluationContext = {
    /** Transitive dependents of the edited step, ascending. */
    readonly affectedSteps: readonly number[];
    /** Validated terminal branch session inspection. */
    readonly branch: ReplaySessionInspection;
    /** Candidate identity and declared edit. */
    readonly candidate: CounterfactualCandidatePlan;
    /** Measured cost of the branch session. */
    readonly cost: ApplicationCostSummary;
    /** Divergence analysis of the branch against its source. */
    readonly divergence: ReplayDivergenceAnalysis;
    /** Validated protocol definition of the run. */
    readonly protocol: ApplicationProtocolDefinition;
    /** Branch start boundary. */
    readonly target: CounterfactualTarget;
};

/**
 * Caller-supplied targeted evaluator gating promotion.
 *
 * A thrown error or a malformed verdict is a verification failure: the candidate is retained as
 * rejected and nothing is promoted.
 *
 * @param context - Candidate, branch inspection, divergence analysis, cost, and protocol.
 * @returns The verdict retained verbatim.
 */
export type CounterfactualEvaluator = (
    context: CounterfactualEvaluationContext,
) => Promise<CounterfactualEvaluation> | CounterfactualEvaluation;

/** Options for {@link runCounterfactualOptimization}. */
export type RunCounterfactualOptimizationOptions = {
    /** Baseline workflow recorded once through a root replay session. */
    readonly baseline: CounterfactualWorkflowDefinition;
    /** Comparison baselines measured per candidate; defaults to none. */
    readonly baselines?: readonly CounterfactualBaselineKind[];
    /** Declared candidate edits in evaluation order; parents precede their children. */
    readonly candidates: readonly CounterfactualCandidateDefinition[];
    /** Writer lease holder of every replay session the run opens. */
    readonly claimId: string;
    /** Lease clock in Unix milliseconds for every replay session; defaults to `Date.now`. */
    readonly clock?: () => number;
    /** Globally idempotent application command identity. */
    readonly commandId: string;
    /** Targeted evaluator gating promotion. */
    readonly evaluate: CounterfactualEvaluator;
    /** Counterfactual optimization protocol definition. */
    readonly protocol: ApplicationProtocolDefinition;
};

/** Immutable record-derived view of one counterfactual optimization run. */
export type CounterfactualOptimizationInspection = {
    /** Application identity and owner path. */
    readonly application_id: string;
    /** Baseline session identity. */
    readonly baseline_session_id: string;
    /** Comparison baselines measured per candidate. */
    readonly baselines: readonly CounterfactualBaselineKind[];
    /** Every declared candidate in evaluation order. */
    readonly candidates: readonly CounterfactualCandidateInspection[];
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
    /** Opened record identity. */
    readonly opened_record_id: RecordId;
    /** Terminal promotion record, or null when no candidate was promoted. */
    readonly promotion: CounterfactualCandidateRecord | null;
    /** Protocol definition identity. */
    readonly protocol_id: string;
};

/** Result of {@link runCounterfactualOptimization}. */
export type CounterfactualOptimizationReceipt = {
    /** Record-derived inspection of the run. */
    readonly inspection: CounterfactualOptimizationInspection;
    /** Retained manifest. */
    readonly manifest: ApplicationManifest;
};
