import type { EffectHandlerStack } from "../effect/handler-types.ts";
import type {
    APPLICATION_COMPRESSION_BASELINE_KINDS,
    APPLICATION_CRO_BASELINE_KINDS,
    APPLICATION_EVALUATION_METRICS,
    APPLICATION_KINDS,
    APPLICATION_SUPERVISION_BASELINE_KINDS,
    APPLICATION_TREE_RL_BASELINE_KINDS,
} from "../protocol/values.generated.ts";
import type { ReplaySessionProgram, RunReplaySessionOptions } from "../replay/types.ts";
import type { RunTrajectoryCompressionOptions } from "./compression-types.ts";
import type { RunCounterfactualOptimizationOptions } from "./counterfactual-types.ts";
import type { RunCodingSupervisorOptions } from "./supervisor-types.ts";
import type { RunTreeRlRolloutsOptions } from "./tree-rl-types.ts";
import type {
    ApplicationCostSummary,
    ApplicationDatasetSelection,
    ApplicationKind,
    ApplicationProtocolDefinition,
} from "./types.ts";

/** Configured measured evaluation metric name. */
export type ApplicationEvaluationMetric = (typeof APPLICATION_EVALUATION_METRICS)[number];

/** Configured coding supervisor comparison baseline kind: one worker without a policy. */
export type CodingSupervisorBaselineKind = (typeof APPLICATION_SUPERVISION_BASELINE_KINDS)[number];

/** Any configured comparison baseline kind of any application. */
export type ApplicationEvaluationBaselineKind =
    | CodingSupervisorBaselineKind
    | (typeof APPLICATION_CRO_BASELINE_KINDS)[number]
    | (typeof APPLICATION_COMPRESSION_BASELINE_KINDS)[number]
    | (typeof APPLICATION_TREE_RL_BASELINE_KINDS)[number];

/**
 * Baseline an experiment compares its application against. The kind must be a configured baseline
 * kind of the experiment's application kind; `commandId` and `workerId` are required exactly for
 * the coding supervisor baseline, which runs the named worker once as a plain child run.
 */
export type ApplicationEvaluationBaselineDefinition = {
    /** Globally idempotent command identity of the constructed coding supervisor baseline. */
    readonly commandId?: string;
    /** Configured baseline kind. */
    readonly kind: ApplicationEvaluationBaselineKind;
    /** Worker of the application binding the coding supervisor baseline runs alone. */
    readonly workerId?: string;
};

/**
 * One configured experiment: an application protocol run under a fixed command identity and
 * compared against one baseline. The application kind is the protocol's kind.
 */
export type ApplicationEvaluationExperiment = {
    /** Baseline the application is compared against. */
    readonly baseline: ApplicationEvaluationBaselineDefinition;
    /** Globally idempotent application command identity. */
    readonly commandId: string;
    /** Experiment identity, unique within the definition. */
    readonly id: string;
    /** Application protocol definition the experiment runs. */
    readonly protocol: ApplicationProtocolDefinition;
    /**
     * Command identity prefix of the Tree-RL root sessions; required exactly for Tree-RL. Root `g`
     * of prompt `p` is recorded under `<sourceCommandId>:<p>:<g>`.
     */
    readonly sourceCommandId?: string;
};

/** One limitation published with the report. */
export type ApplicationEvaluationLimitation = {
    /** Limitation identity, unique within the definition. */
    readonly id: string;
    /** Limitation text within the configured length bound. */
    readonly text: string;
};

/** Caller evaluation definition: experiments, baselines, seeds (in each protocol), and limitations. */
export type ApplicationEvaluationDefinition = {
    /** Evaluation identity. */
    readonly evaluationId: string;
    /** Experiments in report order, bounded by `APPLICATION_EVALUATION_LIMITS.maxExperiments`. */
    readonly experiments: readonly ApplicationEvaluationExperiment[];
    /** Published limitations, bounded by `APPLICATION_EVALUATION_LIMITS.maxLimitations`. */
    readonly limitations: readonly ApplicationEvaluationLimitation[];
    /** Evaluation definition revision. */
    readonly revision: string;
};

/** Executable coding supervisor binding; the command and protocol come from the experiment. */
export type CodingSupervisorEvaluationBinding = {
    /** Coding supervisor kind. */
    readonly kind: (typeof APPLICATION_KINDS)[0];
    /** Supervisor options; the baseline reuses the named worker, parent, and supervisor. */
    readonly options: Omit<RunCodingSupervisorOptions, "commandId" | "protocol">;
};

/** Executable counterfactual optimization binding. */
export type CounterfactualEvaluationBinding = {
    /** Counterfactual optimization kind. */
    readonly kind: (typeof APPLICATION_KINDS)[1];
    /** Optimizer options; the comparison baseline comes from the experiment. */
    readonly options: Omit<
        RunCounterfactualOptimizationOptions,
        "baselines" | "commandId" | "protocol"
    >;
};

/** Executable trajectory compression binding. */
export type TrajectoryCompressionEvaluationBinding = {
    /** Trajectory compression kind. */
    readonly kind: (typeof APPLICATION_KINDS)[2];
    /** Compression options; the comparison baseline comes from the experiment. */
    readonly options: Omit<RunTrajectoryCompressionOptions, "baselines" | "commandId" | "protocol">;
};

/** One Tree-RL evaluation prompt: its program and the G root workflows the evaluation records. */
export type TreeRlEvaluationPrompt = {
    /** Handler stack of every rollout suffix of this prompt. */
    readonly handlers?: EffectHandlerStack;
    /** Prompt identity. */
    readonly id: string;
    /** Deterministic program of every root session of this prompt. */
    readonly program: ReplaySessionProgram;
    /** Root workflows in group order, each recorded with the prompt's program. */
    readonly roots: readonly Omit<RunReplaySessionOptions, "commandId" | "program">[];
};

/** Executable Tree-RL binding: the prompt batch with its root workflows and the rollout options. */
export type TreeRlEvaluationBinding = {
    /** Tree-RL kind. */
    readonly kind: (typeof APPLICATION_KINDS)[3];
    /** Rollout options; the prompts and their root sessions are recorded by the evaluation. */
    readonly options: Omit<
        RunTreeRlRolloutsOptions,
        "baselines" | "commandId" | "prompts" | "protocol"
    >;
    /** Prompt batch whose roots are recorded under the experiment's `sourceCommandId` prefix. */
    readonly prompts: readonly TreeRlEvaluationPrompt[];
};

/** Executable binding of one experiment, discriminated by application kind. */
export type ApplicationEvaluationBinding =
    | CodingSupervisorEvaluationBinding
    | CounterfactualEvaluationBinding
    | TrajectoryCompressionEvaluationBinding
    | TreeRlEvaluationBinding;

/**
 * Caller factory returning the executable binding of one validated experiment: its programs,
 * static providers, policy, evaluator, verifier, or reward. It is called once per experiment, in
 * order, before any application runs.
 *
 * @param experiment - Validated experiment.
 * @returns The binding whose kind equals the experiment's application kind.
 */
export type ApplicationEvaluationBinder = (
    experiment: ApplicationEvaluationExperiment,
) => ApplicationEvaluationBinding;

/** Options for {@link runApplicationEvaluation}. */
export type RunApplicationEvaluationOptions = {
    /** Factory returning each experiment's executable binding. */
    readonly bind: ApplicationEvaluationBinder;
    /** Untrusted evaluation definition; validated before any application runs. */
    readonly definition: ApplicationEvaluationDefinition;
};

/** Measured metrics of one application or baseline; never derived or extrapolated. */
export type ApplicationEvaluationMetrics = {
    /** Measured cost in US dollars, or null when any observed usage reported no cost. */
    readonly cost_usd: number | null;
    /** Measured input tokens. */
    readonly input_tokens: number;
    /** Measured output tokens. */
    readonly output_tokens: number;
    /** Measured provider calls under the application's own counting convention. */
    readonly provider_calls: number;
    /** Measured steps under the application's own counting convention. */
    readonly steps: number;
    /** Whether the measured side reached its retained success condition. */
    readonly success: boolean;
};

/** One measured application run of the report. */
export type ApplicationEvaluationRun = {
    /** Application identity. */
    readonly application_id: string;
    /** Measured costs of the whole run, retained in its manifest. */
    readonly costs: ApplicationCostSummary;
    /** Dataset selection of the protocol. */
    readonly dataset: ApplicationDatasetSelection;
    /** Experiment identity. */
    readonly experiment_id: string;
    /** Application kind. */
    readonly kind: ApplicationKind;
    /** Retained manifest identity. */
    readonly manifest_id: string;
    /** Measured application-side metrics compared against the baseline. */
    readonly metrics: ApplicationEvaluationMetrics;
    /** Protocol definition identity. */
    readonly protocol_id: string;
    /** Caller protocol version. */
    readonly protocol_version: string;
    /** Protocol seeds in declared order. */
    readonly seeds: readonly number[];
};

/** One measured baseline of the report. */
export type ApplicationEvaluationBaseline = {
    /** Session or handle identities the baseline was measured from, in measurement order. */
    readonly evidence: readonly string[];
    /** Experiment identity. */
    readonly experiment_id: string;
    /** Configured baseline kind. */
    readonly kind: ApplicationEvaluationBaselineKind;
    /** Measured baseline metrics. */
    readonly metrics: ApplicationEvaluationMetrics;
};

/** Application value, baseline value, and delta of one metric. */
export type ApplicationEvaluationComparisonValue = {
    /** Measured application value. */
    readonly application: number | boolean | null;
    /** Measured baseline value. */
    readonly baseline: number | boolean | null;
    /** Application minus baseline for two numbers; otherwise null. */
    readonly delta: number | null;
    /** Metric name. */
    readonly metric: ApplicationEvaluationMetric;
};

/** Per-metric comparison of one experiment's application against its baseline. */
export type ApplicationEvaluationComparison = {
    /** Configured baseline kind. */
    readonly baseline_kind: ApplicationEvaluationBaselineKind;
    /** Experiment identity. */
    readonly experiment_id: string;
    /** One value per configured metric, in configured order. */
    readonly values: readonly ApplicationEvaluationComparisonValue[];
};

/**
 * Rescue counts of one report (Appendix D, Table 12): the experiments whose baseline failed its
 * success condition while the application run passed its own. Derived from the runs and baselines.
 */
export type ApplicationEvaluationRescues = {
    /** Number of rescued experiments. */
    readonly count: number;
    /** Rescued experiment identities in experiment order. */
    readonly experiment_ids: readonly string[];
};

/** Canonical, digest-bearing `application-evaluation-v1` report. */
export type ApplicationEvaluationReport = {
    /** One measured baseline per experiment, in experiment order. */
    readonly baselines: readonly ApplicationEvaluationBaseline[];
    /** One comparison per experiment, in experiment order. */
    readonly comparisons: readonly ApplicationEvaluationComparison[];
    /** Application evidence compatibility namespace. */
    readonly compatibility_version: string;
    /** Evaluation identity. */
    readonly evaluation_id: string;
    /** Published limitations in definition order. */
    readonly limitations: readonly ApplicationEvaluationLimitation[];
    /** Configured metric order. */
    readonly metrics: readonly ApplicationEvaluationMetric[];
    /** Report identity: the digest of the canonical report body without this field. */
    readonly report_id: string;
    /** Configured report version. */
    readonly report_version: number;
    /** Rescue counts derived from the runs and baselines. */
    readonly rescues: ApplicationEvaluationRescues;
    /** Evaluation definition revision. */
    readonly revision: string;
    /** One measured application run per experiment, in experiment order. */
    readonly runs: readonly ApplicationEvaluationRun[];
};
