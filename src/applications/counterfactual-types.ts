import type { SemanticValue } from "../canonical/canonical-record.ts";
import type { EffectHandlerStack } from "../effect/handler-types.ts";
import type {
    APPLICATION_CRO_BASELINE_KINDS,
    APPLICATION_CRO_CANDIDATE_STATUSES,
    APPLICATION_CRO_EDIT_SCOPES,
    APPLICATION_CRO_EXAMPLE_ROLES,
    APPLICATION_CRO_PHASES,
    APPLICATION_CRO_SPLITS,
} from "../protocol/values.generated.ts";
import type { ConversationalModelProvider, ModelProvider } from "../provider/types.ts";
import type { RecordId } from "../record/types.ts";
import type {
    ReplayChangeDimension,
    ReplayDivergenceAnalysis,
    ReplaySessionInspection,
    ReplaySessionProgram,
    ReplaySessionTaskDefinition,
} from "../replay/types.ts";
import type { SQLiteTraceStore } from "../store/sqlite-trace-store.ts";
import type { CutId } from "../store/types.ts";
import type {
    ApplicationComputationReuse,
    ApplicationCostSummary,
    ApplicationKind,
    ApplicationManifest,
    ApplicationProtocolDefinition,
} from "./types.ts";

/** Configured counterfactual optimizer record phase: opened, proposal, candidate, or selection. */
export type CounterfactualRecordPhase = (typeof APPLICATION_CRO_PHASES)[number];

/** Configured candidate outcome status: archived, evaluated, promoted, or rejected. */
export type CounterfactualCandidateStatus = (typeof APPLICATION_CRO_CANDIDATE_STATUSES)[number];

/** Configured comparison baseline kind. */
export type CounterfactualBaselineKind = (typeof APPLICATION_CRO_BASELINE_KINDS)[number];

/** Configured example split: `train` or `dev`. */
export type CounterfactualSplit = (typeof APPLICATION_CRO_SPLITS)[number];

/** Configured example result role: `fix`, `guard`, `dev`, or `train`. */
export type CounterfactualExampleRole = (typeof APPLICATION_CRO_EXAMPLE_ROLES)[number];

/**
 * Configured candidate edit scope, ordered `request` then `downstream`.
 *
 * A `request` edit changes the edited step's own request, so its branch re-executes from the
 * boundary immediately before the edited step; the declared changes must explain a divergence of
 * that step's kind (task or provider for a provider step, handlers for an effect step). A
 * `downstream` edit leaves the edited step's recorded output in place and changes only how its
 * dependents consume it, so its branch replays from the boundary before the first transitive
 * dependent, or from the source's final boundary when nothing depends on the edited step.
 */
export type CounterfactualEditScope = (typeof APPLICATION_CRO_EDIT_SCOPES)[number];

/** One dataset example: an identity from the protocol's dataset items and its canonical input. */
export type CounterfactualExample = {
    /** Example identity; one of the protocol's `dataset.items`. */
    readonly id: string;
    /** Canonical example input passed to the workflow program and task factories. */
    readonly input: SemanticValue;
};

/** Train and dev splits of one optimization run; identities are distinct across both. */
export type CounterfactualDataset = {
    /** Dev split: graduated candidates are scored on every dev example. */
    readonly dev: readonly CounterfactualExample[];
    /** Train split: fix and guard sets name train examples. */
    readonly train: readonly CounterfactualExample[];
};

/**
 * Workflow program for one example. The returned session program must be deterministic in the
 * example and must re-issue a recorded prefix exactly so a branch can serve it.
 *
 * @param example - Example the session runs.
 * @returns The session program.
 */
export type CounterfactualProgram = (example: CounterfactualExample) => ReplaySessionProgram;

/**
 * Task factory for one example.
 *
 * @param example - Example the session runs.
 * @returns The task and input bound to the example's session.
 */
export type CounterfactualTaskFactory = (
    example: CounterfactualExample,
) => ReplaySessionTaskDefinition;

/**
 * Baseline workflow W0, recorded once per train and dev example through a root replay session.
 *
 * The program must bind no worlds or processes so every step boundary is an admissible branch
 * target. The provider and handler stack serve every example session and every branch suffix that
 * does not declare the corresponding change, so a provider must be able to answer repeated sessions.
 */
export type CounterfactualWorkflowDefinition = {
    /** Effect handler stack; required when the program dispatches effects. */
    readonly handlers?: EffectHandlerStack;
    /** Example-parameterized session program. */
    readonly program: CounterfactualProgram;
    /** Stable program identity retained with every baseline session. */
    readonly programId: string;
    /** Provider; required when the program invokes a provider. */
    readonly provider?: ModelProvider;
    /** Task factory; required when the program invokes a task. */
    readonly task?: CounterfactualTaskFactory;
};

/**
 * One proposed edit Δ of the parent workflow, as data, paired with the fix set T+ it should repair
 * and the guard set T- it must not regress (paper Appendix F.1). Retained verbatim in the proposal
 * and candidate records; the caller's {@link CounterfactualEditApplier} turns it into replacements.
 */
export type CounterfactualEdit = {
    /** Non-empty distinct subset of the configured replay change dimensions. */
    readonly changes: readonly ReplayChangeDimension[];
    /** Distinct train example identities the edit is meant to repair; non-empty. */
    readonly fix_set: readonly string[];
    /** Distinct train example identities whose score must not regress; disjoint from the fix set. */
    readonly guard_set: readonly string[];
    /** Mechanism the edit tests; compared by the reflection contract. */
    readonly mechanism: string;
    /** Candidate name, unique within the run. */
    readonly name: string;
    /** Canonical edit payload interpreted only by the caller's edit applier. */
    readonly patch: SemanticValue;
    /** Proposer prior in `[0, 1]` that the edit succeeds. */
    readonly prior: number;
    /** Free-text hypothesis rationale. */
    readonly rationale: string;
    /** Declared edit semantics fixing the replay target. */
    readonly scope: CounterfactualEditScope;
    /** Zero-based index of the edited step in the parent's example sessions. */
    readonly step_index: number;
};

/** One proposer answer: a parent from the pool, at most k edits, and the reflection. */
export type CounterfactualProposal = {
    /** Edits of this iteration, at most the iteration's capacity. */
    readonly edits: readonly CounterfactualEdit[];
    /** Name of a parent-pool candidate, or null for the baseline. */
    readonly parent: string | null;
    /** Reflection validated against the protocol's reflection schema and contract. */
    readonly reflection: SemanticValue;
};

/** One parent-pool member offered to the proposer. */
export type CounterfactualPoolMember = {
    /** Candidate identity, or null for the baseline. */
    readonly candidate_id: string | null;
    /** Mean dev score. */
    readonly dev_score: number;
    /** Candidate name, or null for the baseline. */
    readonly name: string | null;
};

/** Context one proposer attempt receives. */
export type CounterfactualProposerContext = {
    /** Application identity. */
    readonly applicationId: string;
    /** Zero-based attempt within the iteration. */
    readonly attempt: number;
    /** Maximum edits this attempt may return. */
    readonly capacity: number;
    /** Writer lease holder the optimizer uses. */
    readonly claimId: string;
    /** Lease clock, when the caller supplied one. */
    readonly clock?: () => number;
    /**
     * Command identity reserved for this attempt's proposer session. A proposer that records its
     * work as one replay session under this identity has its measured provider calls counted and
     * its session cited in the proposal record.
     */
    readonly commandId: string;
    /** Refusal reasons of earlier attempts in this iteration, oldest first. */
    readonly feedback: readonly string[];
    /** Record-derived inspection of the run so far. */
    readonly inspection: CounterfactualOptimizationInspection;
    /** Zero-based iteration index. */
    readonly iteration: number;
    /** Parent pool: the baseline followed by promoted candidates in promotion order. */
    readonly pool: readonly CounterfactualPoolMember[];
    /** Validated protocol definition of the run. */
    readonly protocol: ApplicationProtocolDefinition;
    /** Open trace store holding every session of the run. */
    readonly store: SQLiteTraceStore;
};

/**
 * Proposer P of Algorithm 1: reads the run and returns a parent and edits with fix and guard sets.
 *
 * A malformed or inadmissible proposal is refused with a reason and the proposer is asked again
 * with the reason in `feedback`, up to the protocol's attempt budget. A thrown error propagates.
 *
 * @param context - Run inspection, pool, capacity, feedback, and session identity.
 * @returns The proposal.
 */
export type CounterfactualProposer = (
    context: CounterfactualProposerContext,
) => Promise<CounterfactualProposal> | CounterfactualProposal;

/** Options for {@link createToolLoopCounterfactualProposer}. */
export type ToolLoopCounterfactualProposerOptions = {
    /** Turn bound; defaults to `applications.cro.proposer.limits.defaultMaxTurns`. */
    readonly maxTurns?: number;
    /** Conversational model answering every proposer turn. */
    readonly model: ConversationalModelProvider;
};

/** Replacements one edit applies to its parent's resolved workflow. */
export type CounterfactualEditApplication = {
    /** Replacement handler stack; exactly with the `handlers` change. */
    readonly handlers?: EffectHandlerStack;
    /** Replacement program; optional with any change. */
    readonly program?: CounterfactualProgram;
    /** Replacement provider; exactly with the `provider` change. */
    readonly provider?: ModelProvider;
    /** Replacement task factory; exactly with the `task` change. */
    readonly task?: CounterfactualTaskFactory;
};

/** Context the edit applier receives. */
export type CounterfactualEditContext = {
    /** Edit to apply. */
    readonly edit: CounterfactualEdit;
    /** Parent candidate plan, or null for the baseline. */
    readonly parent: CounterfactualCandidatePlan | null;
    /** Validated protocol definition of the run. */
    readonly protocol: ApplicationProtocolDefinition;
};

/**
 * Applies one edit (c = p ⊕ Δ): returns exactly the replacements of the declared change
 * dimensions and optionally a program. It must be a deterministic function of the edit, because a
 * rerun re-applies retained edits. A throw or an application that does not match the declared
 * changes refuses the proposal.
 *
 * @param context - Edit, parent plan, and protocol.
 * @returns The replacements.
 */
export type CounterfactualEditApplier = (
    context: CounterfactualEditContext,
) => Promise<CounterfactualEditApplication> | CounterfactualEditApplication;

/** Context the metric receives for one finished session. */
export type CounterfactualMetricContext = {
    /** Candidate plan, or null for a baseline session. */
    readonly candidate: CounterfactualCandidatePlan | null;
    /** Example the session ran. */
    readonly example: CounterfactualExample;
    /** Validated terminal session inspection. */
    readonly session: ReplaySessionInspection;
    /** Split of the example. */
    readonly split: CounterfactualSplit;
};

/**
 * Per-example workflow metric; higher is better. A throw or a non-finite score is a verification
 * failure.
 *
 * @param context - Candidate, example, split, and finished session.
 * @returns The finite example score.
 */
export type CounterfactualMetric = (
    context: CounterfactualMetricContext,
) => Promise<number> | number;

/** Identity, lineage, and edit of one candidate, fixed by its proposal. */
export type CounterfactualCandidatePlan = {
    /** Candidate identity derived from the application, iteration, parent, and edit. */
    readonly candidate_id: string;
    /** Declared change dimensions in configured order. */
    readonly changes: readonly ReplayChangeDimension[];
    /** Declared edit semantics fixing the replay target. */
    readonly edit_scope: CounterfactualEditScope;
    /** Zero-based index of the edited step in the parent's example sessions. */
    readonly edited_step_index: number;
    /** Fix set T+ in proposal order. */
    readonly fix_set: readonly string[];
    /** Guard set T- in proposal order. */
    readonly guard_set: readonly string[];
    /** Zero-based iteration that proposed the candidate. */
    readonly iteration: number;
    /** Mechanism the edit tests. */
    readonly mechanism: string;
    /** Caller name. */
    readonly name: string;
    /** Parent candidate identity, or null when the candidate edits the baseline. */
    readonly parent_candidate_id: string | null;
    /** Canonical edit payload. */
    readonly patch: SemanticValue;
    /** Proposer prior. */
    readonly prior: number;
    /** Hypothesis rationale. */
    readonly rationale: string;
};

/** Step boundary one example branch starts from. */
export type CounterfactualTarget = {
    /** Prefix identity of the source at the boundary, or null at boundary zero. */
    readonly prefix_id: string | null;
    /** Source session the branch forks: the parent's session on the example. */
    readonly source_session_id: string;
    /** Number of source steps served from the recorded journal. */
    readonly step_index: number;
};

/** Retained summary of the divergence proof of one example branch. */
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

/** Measured whole-workflow comparison of one example branch. */
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

/** Counterfactual replay of one candidate on one example, scored against its parent. */
export type CounterfactualExampleResult = {
    /** Transitive dependents of the edited step in the source session, ascending. */
    readonly affected_steps: readonly number[];
    /** Measured whole-workflow comparison, or null. */
    readonly baseline: CounterfactualBaselineComparison | null;
    /** Measured cost of the branch session. */
    readonly cost: ApplicationCostSummary;
    /** Divergence proof summary. */
    readonly divergence: CounterfactualDivergenceSummary;
    /** Example identity. */
    readonly example_id: string;
    /** Parent's score on the example. */
    readonly parent_score: number;
    /** Role the example played for the candidate. */
    readonly role: CounterfactualExampleRole;
    /** Candidate's score on the example. */
    readonly score: number;
    /** Branch session identity. */
    readonly session_id: string;
    /** Branch start boundary. */
    readonly target: CounterfactualTarget;
};

/** Targeted fix/guard gate verdict (paper Appendix F.2.5), recomputed from retained results. */
export type CounterfactualGateVerdict = {
    /** Mean candidate score minus mean parent score over the fix and guard union. */
    readonly aggregate_lift: number;
    /** Fraction of fix examples scoring strictly above the parent. */
    readonly improve_fraction: number;
    /** Largest parent-minus-candidate drop over the guard set, at least zero. */
    readonly max_guard_drop: number;
    /** Whether every configured threshold held. */
    readonly passed: boolean;
    /** Bounded verdict explanation. */
    readonly reason: string;
};

/** Retained failure that rejected a candidate or proposal and stopped the run. */
export type CounterfactualFailure = {
    /** Configured error code: invalid evidence or failed verification. */
    readonly code: string;
    /** Retained failure detail. */
    readonly reason: string;
};

/** One retained candidate outcome record. */
export type CounterfactualCandidateRecord = CounterfactualCandidatePlan & {
    /** Summed measured cost of every example branch session. */
    readonly cost: ApplicationCostSummary;
    /** Dev results in dev order, or null when the candidate was not evaluated on dev. */
    readonly dev: readonly CounterfactualExampleResult[] | null;
    /** Mean dev score, or null. */
    readonly dev_score: number | null;
    /** Failure that rejected the candidate and stopped the run, or null. */
    readonly failure: CounterfactualFailure | null;
    /** Gate verdict, or null when the targeted replays did not complete. */
    readonly gate: CounterfactualGateVerdict | null;
    /** Dev score of the promoted candidate the promotion compared against, or null. */
    readonly promotion_reference: number | null;
    /** Retained record identity. */
    readonly record_id: RecordId;
    /** Outcome status. */
    readonly status: CounterfactualCandidateStatus;
    /** Fix then guard results in proposal order. */
    readonly targeted: readonly CounterfactualExampleResult[];
    /** Remaining train results of a promoted candidate in train order, or null. */
    readonly train: readonly CounterfactualExampleResult[] | null;
};

/** One retained proposer iteration record. */
export type CounterfactualProposalRecord = {
    /** Proposer attempts the iteration used. */
    readonly attempts: number;
    /** Candidate plans of the accepted proposal in proposal order; empty on failure. */
    readonly candidates: readonly CounterfactualCandidatePlan[];
    /** Failure when every attempt was refused, or null. */
    readonly failure: CounterfactualFailure | null;
    /** Zero-based iteration index. */
    readonly iteration: number;
    /** Parent candidate identity, or null for the baseline. */
    readonly parent_candidate_id: string | null;
    /** Proposer replay sessions recorded under the attempt command identities, in attempt order. */
    readonly proposer_session_ids: readonly string[];
    /** Retained record identity. */
    readonly record_id: RecordId;
    /** Accepted reflection, or null on failure. */
    readonly reflection: SemanticValue;
    /** Refusal reasons of refused attempts, in attempt order. */
    readonly refusals: readonly string[];
};

/** One recorded baseline example session. */
export type CounterfactualBaselineExample = {
    /** Example identity. */
    readonly example_id: string;
    /** Digest of the canonical example input. */
    readonly input_digest: string;
    /** Baseline score. */
    readonly score: number;
    /** Baseline session identity. */
    readonly session_id: string;
    /** Example split. */
    readonly split: CounterfactualSplit;
};

/** Terminal selection c* of Algorithm 1. */
export type CounterfactualSelection = {
    /** Dev score of the selected member. */
    readonly dev_score: number;
    /** Promoted candidate identities in promotion order: the parent pool after the baseline. */
    readonly pool: readonly string[];
    /** Retained record identity. */
    readonly record_id: RecordId;
    /** Selected candidate identity, or null when the baseline is selected. */
    readonly selected_candidate_id: string | null;
};

/** Step reuse of every candidate branch session one proposer session produced. */
export type CounterfactualComputationReuse = ApplicationComputationReuse;

/** Options for {@link runCounterfactualOptimization}. */
export type RunCounterfactualOptimizationOptions = {
    /** Edit applier turning proposed edits into workflow replacements. */
    readonly applyEdit: CounterfactualEditApplier;
    /** Baseline workflow W0. */
    readonly baseline: CounterfactualWorkflowDefinition;
    /** Comparison baselines measured per example branch; defaults to none. */
    readonly baselines?: readonly CounterfactualBaselineKind[];
    /** Writer lease holder of every replay session the run opens. */
    readonly claimId: string;
    /** Lease clock in Unix milliseconds for every replay session; defaults to `Date.now`. */
    readonly clock?: () => number;
    /** Globally idempotent application command identity. */
    readonly commandId: string;
    /** Train and dev splits drawn from the protocol's dataset items. */
    readonly dataset: CounterfactualDataset;
    /** Per-example metric. */
    readonly metric: CounterfactualMetric;
    /** Counterfactual optimization protocol definition. */
    readonly protocol: ApplicationProtocolDefinition;
    /** Proposer P: caller-supplied or {@link createToolLoopCounterfactualProposer}. */
    readonly proposer: CounterfactualProposer;
};

/** Immutable record-derived view of one counterfactual optimization run. */
export type CounterfactualOptimizationInspection = {
    /** Application identity and owner path. */
    readonly application_id: string;
    /** Comparison baselines measured per example branch. */
    readonly baselines: readonly CounterfactualBaselineKind[];
    /** Protocol budgets retained with the opened record. */
    readonly budgets: Readonly<Record<string, number>>;
    /** Every retained candidate outcome in proposal order. */
    readonly candidates: readonly CounterfactualCandidateRecord[];
    /** Application command identity. */
    readonly command_id: string;
    /** Per proposer session step reuse, one entry per retained proposal. */
    readonly computation_reuse: readonly CounterfactualComputationReuse[];
    /** Terminal cut, or null before the manifest was retained. */
    readonly cut_id: CutId | null;
    /** Baseline sessions and scores in train then dev order. */
    readonly examples: readonly CounterfactualBaselineExample[];
    /** Application kind. */
    readonly kind: ApplicationKind;
    /** Retained manifest, or null. */
    readonly manifest: ApplicationManifest | null;
    /** Manifest record identity, or null. */
    readonly manifest_record_id: RecordId | null;
    /** Opened record identity. */
    readonly opened_record_id: RecordId;
    /** Current parent pool: the baseline followed by promoted candidates. */
    readonly pool: readonly CounterfactualPoolMember[];
    /** Every retained proposal in iteration order. */
    readonly proposals: readonly CounterfactualProposalRecord[];
    /** Protocol definition identity. */
    readonly protocol_id: string;
    /** Terminal selection, or null before it was retained. */
    readonly selection: CounterfactualSelection | null;
    /** Protocol thresholds retained with the opened record. */
    readonly thresholds: Readonly<Record<string, number>>;
};

/** One candidate entry of the handoff manifest. */
export type CounterfactualHandoffCandidate = {
    /** Candidate identity. */
    readonly candidate_id: string;
    /** Parent candidate identity, or null when the candidate edits the baseline. */
    readonly parent_candidate_id: string | null;
    /** Outcome status. */
    readonly status: CounterfactualCandidateStatus;
};

/**
 * Handoff manifest of one completed optimization run: every candidate in proposal order with its
 * lineage and status, and the selected candidate. It is derived from retained records and
 * validated against every protocol `schema` surface of the configured handoff role before it is
 * returned.
 */
export type CounterfactualHandoff = {
    /** Every candidate in proposal order. */
    readonly candidates: readonly CounterfactualHandoffCandidate[];
    /** Selected candidate identity, or null when the baseline is selected. */
    readonly selected_candidate_id: string | null;
};

/** Result of {@link runCounterfactualOptimization}. */
export type CounterfactualOptimizationReceipt = {
    /** Handoff manifest validated against the protocol's handoff schema surfaces. */
    readonly handoff: CounterfactualHandoff;
    /** Record-derived inspection of the run. */
    readonly inspection: CounterfactualOptimizationInspection;
    /** Retained manifest. */
    readonly manifest: ApplicationManifest;
};

/**
 * One caller-declared candidate edit accepted by the optimizer before 11.0.0.
 *
 * @deprecated Since 11.0.0: candidates come from a {@link CounterfactualProposer} as
 * {@link CounterfactualEdit} data applied by a {@link CounterfactualEditApplier}; no API consumes
 * this type, and it is removed once the deprecation window elapses.
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
    /** Declared edit semantics fixing the replay target; see {@link CounterfactualEditScope}. */
    readonly scope: CounterfactualEditScope;
    /** Zero-based index of the edited step in the source session. */
    readonly stepIndex: number;
    /** Replacement task of the affected suffix; exactly with the `task` change. */
    readonly task?: ReplaySessionTaskDefinition;
};

/**
 * Verdict of the caller-supplied targeted evaluator before 11.0.0.
 *
 * @deprecated Since 11.0.0: the targeted gate is {@link CounterfactualGateVerdict}, computed from
 * per-example {@link CounterfactualMetric} scores; no API consumes this type, and it is removed once
 * the deprecation window elapses.
 */
export type CounterfactualEvaluation = {
    /** Whether the candidate passed the targeted evaluation. */
    readonly passed: boolean;
    /** Bounded evaluator reason. */
    readonly reason: string;
    /** Finite evaluation score; higher is better. */
    readonly score: number;
};

/**
 * Record-derived state of one declared candidate before 11.0.0.
 *
 * @deprecated Since 11.0.0: inspection lists {@link CounterfactualCandidateRecord} outcomes
 * directly; no API returns this type, and it is removed once the deprecation window elapses.
 */
export type CounterfactualCandidateInspection = CounterfactualCandidatePlan & {
    /** Evaluated or rejected record, or null before the candidate completed. */
    readonly outcome: CounterfactualCandidateRecord | null;
    /** Proposed record, or null before the candidate was proposed. */
    readonly proposed: CounterfactualCandidateRecord | null;
};

/**
 * Context the targeted evaluator received for one proven candidate branch before 11.0.0.
 *
 * @deprecated Since 11.0.0: see {@link CounterfactualMetricContext}; no API consumes this type, and
 * it is removed once the deprecation window elapses.
 */
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
 * Caller-supplied targeted evaluator gating promotion before 11.0.0.
 *
 * @deprecated Since 11.0.0: see {@link CounterfactualMetric}; no API consumes this type, and it is
 * removed once the deprecation window elapses.
 *
 * @param context - Candidate, branch inspection, divergence analysis, cost, and protocol.
 * @returns The verdict retained verbatim.
 */
export type CounterfactualEvaluator = (
    context: CounterfactualEvaluationContext,
) => Promise<CounterfactualEvaluation> | CounterfactualEvaluation;
