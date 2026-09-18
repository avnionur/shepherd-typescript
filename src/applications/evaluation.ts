import type { SemanticValue } from "../canonical/canonical-record.ts";
import { createCanonicalSnapshot } from "../canonical/snapshot.ts";
import { openChildRun, runChildRun } from "../delegation/handle.ts";
import type { ChildRunCompletionInspection } from "../delegation/types.ts";
import { applicationsProtocolConfig } from "../protocol/config.ts";
import {
    APPLICATION_COMPRESSION_BASELINE_KINDS,
    APPLICATION_CRO_BASELINE_KINDS,
    APPLICATION_EVALUATION_LIMITS,
    APPLICATION_EVALUATION_METRICS,
    APPLICATION_EVALUATION_REPORT_VERSION,
    APPLICATION_KINDS,
    APPLICATION_SUPERVISION_BASELINE_KINDS,
    APPLICATION_SUPERVISION_WORKER_STATUSES,
    APPLICATION_TREE_RL_BASELINE_KINDS,
    APPLICATION_TREE_RL_ROLLOUT_STATUSES,
    REPLAY_TERMINAL_STATUSES,
    RUN_TERMINAL_STATUSES,
} from "../protocol/values.generated.ts";
import type { RecordBody } from "../record/types.ts";
import { inspectReplaySession } from "../replay/inspection.ts";
import { runReplaySession } from "../replay/session.ts";
import type { DurableTaskExecutionInspection } from "../run/durable-execution-inspection-types.ts";
import { assertScopeText, readScopeArray, readScopeDataObject } from "../scope/validation.ts";
import type { SQLiteTraceStore } from "../store/sqlite-trace-store.ts";
import { runCodingSupervisor } from "./coding-supervisor.ts";
import type { TrajectoryCompressionOutcomeRecord } from "./compression-types.ts";
import { runCounterfactualOptimization } from "./counterfactual-optimizer.ts";
import type {
    CounterfactualBaselineComparison,
    CounterfactualCandidateRecord,
} from "./counterfactual-types.ts";
import { ApplicationEvidenceError, ApplicationProtocolError } from "./errors.ts";
import type {
    ApplicationEvaluationBaseline,
    ApplicationEvaluationBaselineDefinition,
    ApplicationEvaluationBaselineKind,
    ApplicationEvaluationBinding,
    ApplicationEvaluationComparison,
    ApplicationEvaluationComparisonValue,
    ApplicationEvaluationDefinition,
    ApplicationEvaluationExperiment,
    ApplicationEvaluationLimitation,
    ApplicationEvaluationMetrics,
    ApplicationEvaluationReport,
    ApplicationEvaluationRun,
    CodingSupervisorEvaluationBinding,
    RunApplicationEvaluationOptions,
} from "./evaluation-types.ts";
import { readApplicationProtocol, readDataset, readSeeds } from "./manifest.ts";
import {
    addApplicationCosts,
    assertApplicationDigest,
    canonical,
    foldApplicationCosts,
    measureReplaySessionCost,
    prefixedApplicationId,
    readApplicationCosts,
    readCount,
    ZERO_APPLICATION_COST,
} from "./records.ts";
import type { CodingSupervisorAttemptInspection } from "./supervisor-types.ts";
import { runTrajectoryCompression } from "./trajectory-compression.ts";
import { runTreeRlRollouts } from "./tree-rl.ts";
import type { TreeRlRolloutRecord } from "./tree-rl-types.ts";
import type { ApplicationCostSummary, ApplicationKind } from "./types.ts";

const config = applicationsProtocolConfig;
const [SUPERVISOR_KIND, OPTIMIZER_KIND, COMPRESSION_KIND, TREE_RL_KIND] = APPLICATION_KINDS;
const BASELINE_KINDS: Readonly<Record<ApplicationKind, readonly string[]>> = Object.freeze({
    [SUPERVISOR_KIND]: APPLICATION_SUPERVISION_BASELINE_KINDS,
    [OPTIMIZER_KIND]: APPLICATION_CRO_BASELINE_KINDS,
    [COMPRESSION_KIND]: APPLICATION_COMPRESSION_BASELINE_KINDS,
    [TREE_RL_KIND]: APPLICATION_TREE_RL_BASELINE_KINDS,
});
const [, ACCEPTED_WORKER] = APPLICATION_SUPERVISION_WORKER_STATUSES;
const [COMPLETED_ROLLOUT] = APPLICATION_TREE_RL_ROLLOUT_STATUSES;
const [FINISHED_RUN] = RUN_TERMINAL_STATUSES;
const [FINISHED_SESSION] = REPLAY_TERMINAL_STATUSES;
const [COST_METRIC, CALLS_METRIC, INPUT_METRIC, OUTPUT_METRIC, STEPS_METRIC, SUCCESS_METRIC] =
    APPLICATION_EVALUATION_METRICS;

/** Measured metrics of one side of an experiment and the identities they were measured from. */
type Measured = {
    readonly evidence: readonly string[];
    readonly metrics: ApplicationEvaluationMetrics;
};

/** Measured application run and baseline of one experiment. */
type MeasuredExperiment = {
    readonly baseline: Measured;
    readonly run: Omit<ApplicationEvaluationRun, "experiment_id">;
};

/**
 * Validates an untrusted evaluation definition into its canonical frozen form.
 *
 * The definition must be a plain data object of exactly `evaluationId`, `experiments`,
 * `limitations`, and `revision`. Every experiment carries a distinct `id`, a `commandId`, a
 * protocol definition accepted by `readApplicationProtocol` whose kind selects the application, and
 * a baseline whose kind is a configured baseline kind of that application; the coding supervisor
 * baseline also names its `commandId` and `workerId`, and a Tree-RL experiment names the
 * `sourceCommandId` recording its source session. Command identities are distinct across the
 * definition. Limitations are distinct by identity and within the configured length bound.
 * Experiment and limitation counts are bounded by `APPLICATION_EVALUATION_LIMITS`.
 *
 * @param value - Untrusted evaluation definition.
 * @returns The canonical frozen definition.
 * @throws {ApplicationProtocolError} If the definition is malformed, names an unknown baseline, or
 * exceeds a configured bound.
 *
 * @example
 * ```ts
 * const definition = readApplicationEvaluationDefinition(JSON.parse(text));
 * console.log(definition.experiments.map((experiment) => experiment.baseline.kind));
 * ```
 */
export function readApplicationEvaluationDefinition(
    value: unknown,
): ApplicationEvaluationDefinition {
    try {
        const fields = readScopeDataObject(
            value,
            ["evaluationId", "experiments", "limitations", "revision"],
            "evaluation definition",
        );
        assertScopeText(fields.evaluationId, "evaluationId");
        assertScopeText(fields.revision, "revision");
        const experiments = readBounded(
            fields.experiments,
            "experiments",
            APPLICATION_EVALUATION_LIMITS.maxExperiments,
        ).map((experiment, index) => readExperiment(experiment, `experiments[${index}]`));
        assertDistinct(
            experiments.map((experiment) => experiment.id),
            "experiment ids",
        );
        assertDistinct(
            experiments.flatMap((experiment) => [
                experiment.commandId,
                ...definedTexts(experiment.baseline.commandId, experiment.sourceCommandId),
            ]),
            "command ids",
        );
        const limitations = readBounded(
            fields.limitations,
            "limitations",
            APPLICATION_EVALUATION_LIMITS.maxLimitations,
        ).map((limitation, index) => readLimitation(limitation, `limitations[${index}]`));
        assertDistinct(
            limitations.map((limitation) => limitation.id),
            "limitation ids",
        );
        return createCanonicalSnapshot({
            evaluationId: fields.evaluationId,
            experiments,
            limitations,
            revision: fields.revision,
        } as unknown as RecordBody) as unknown as ApplicationEvaluationDefinition;
    } catch (error) {
        throw new ApplicationProtocolError("evaluation definition is malformed", {
            cause: error,
        });
    }
}

/**
 * Runs every configured experiment offline with its baseline and folds one measured-only report.
 *
 * The definition is validated and every experiment's binding is obtained and checked before any
 * application runs, so a malformed definition or binding writes nothing. Experiments then run in
 * order under their fixed command identities: the coding supervisor through
 * `runCodingSupervisor` with its `no_supervision` baseline constructed as one plain child run of the
 * named worker (no policy, trace-only, never accepted or discarded); the counterfactual optimizer
 * with its `full_replay` baseline; trajectory compression with its `no_compression` baseline; and
 * Tree-RL over a source session recorded under `sourceCommandId` with its `single_rollout`
 * baseline. Every metric is measured from retained evidence; nothing is estimated. The evaluation
 * writes no record of its own, and every application command is idempotent, so a repeated or
 * resumed evaluation converges on the same report without re-running settled work. An application
 * refusal leaves the evidence of earlier experiments for a corrected rerun to reuse.
 *
 * @param store - Open writable trace store.
 * @param options - Evaluation definition and binding factory.
 * @returns The validated report whose identity is the digest of its canonical body.
 * @throws {ApplicationProtocolError} If the definition or a binding is malformed.
 * @throws {ApplicationBudgetError} If an application exceeds a protocol budget.
 * @throws {ApplicationEvidenceError} If retained application evidence is inconsistent.
 * @throws {TraceStoreError} If an application, delegation, or replay seam refuses a command.
 * @throws {TypeError} If options are malformed.
 *
 * @example
 * ```ts
 * const report = await runApplicationEvaluation(store, {
 *     bind: (experiment) => bindings[experiment.id],
 *     definition,
 * });
 * console.log(report.report_id, report.comparisons);
 * ```
 */
export async function runApplicationEvaluation(
    store: SQLiteTraceStore,
    options: RunApplicationEvaluationOptions,
): Promise<ApplicationEvaluationReport> {
    const fields = readScopeDataObject(
        options,
        ["bind", "definition"],
        "runApplicationEvaluation options",
    );
    if (typeof fields.bind !== "function") {
        throw new TypeError("bind must be a function");
    }
    const bind = fields.bind as RunApplicationEvaluationOptions["bind"];
    const definition = readApplicationEvaluationDefinition(fields.definition);
    const bindings = definition.experiments.map((experiment) =>
        readBinding(experiment, bind(experiment)),
    );
    const runs: ApplicationEvaluationRun[] = [];
    const baselines: ApplicationEvaluationBaseline[] = [];
    const comparisons: ApplicationEvaluationComparison[] = [];
    for (const [index, experiment] of definition.experiments.entries()) {
        const measured = await measureExperiment(
            store,
            experiment,
            bindings[index] as ApplicationEvaluationBinding,
        );
        const run = { ...measured.run, experiment_id: experiment.id };
        runs.push(run);
        baselines.push({
            evidence: measured.baseline.evidence,
            experiment_id: experiment.id,
            kind: experiment.baseline.kind,
            metrics: measured.baseline.metrics,
        });
        comparisons.push({
            baseline_kind: experiment.baseline.kind,
            experiment_id: experiment.id,
            values: compareApplicationBaseline(run.metrics, measured.baseline.metrics),
        });
    }
    const body = {
        baselines,
        comparisons,
        compatibility_version: config.compatibilityVersion,
        evaluation_id: definition.evaluationId,
        limitations: definition.limitations,
        metrics: APPLICATION_EVALUATION_METRICS,
        report_version: APPLICATION_EVALUATION_REPORT_VERSION,
        revision: definition.revision,
        runs,
    };
    return validateApplicationEvaluationReport({
        ...body,
        report_id: prefixedApplicationId(
            config.identity.reportIdPrefix,
            body as unknown as SemanticValue,
        ),
    });
}

/**
 * Compares one application's measured metrics against its baseline's, metric by metric.
 *
 * Values are copied verbatim; the delta is the application value minus the baseline value when
 * both are numbers and null otherwise (a null cost or the boolean success metric).
 *
 * @param application - Measured application metrics.
 * @param baseline - Measured baseline metrics.
 * @returns One comparison value per configured metric, in configured order.
 * @throws {TypeError} If either metrics object is malformed.
 *
 * @example
 * ```ts
 * const values = compareApplicationBaseline(run.metrics, baseline.metrics);
 * console.log(values.find((value) => value.metric === "provider_calls")?.delta);
 * ```
 */
export function compareApplicationBaseline(
    application: ApplicationEvaluationMetrics,
    baseline: ApplicationEvaluationMetrics,
): readonly ApplicationEvaluationComparisonValue[] {
    const left = readMetrics(application, "application");
    const right = readMetrics(baseline, "baseline");
    return Object.freeze(
        APPLICATION_EVALUATION_METRICS.map((metric) => {
            const applicationValue = left[metric];
            const baselineValue = right[metric];
            return Object.freeze({
                application: applicationValue,
                baseline: baselineValue,
                delta:
                    typeof applicationValue === "number" && typeof baselineValue === "number"
                        ? applicationValue - baselineValue
                        : null,
                metric,
            });
        }),
    );
}

/**
 * Validates an untrusted evaluation report, re-deriving every comparison and the report identity.
 *
 * The document must be a plain data object of exactly the report fields with the configured report
 * and compatibility versions and metric order; runs, baselines, and comparisons align by experiment
 * in order; every baseline kind is configured for its run's application kind; every comparison
 * equals `compareApplicationBaseline` over its run and baseline; and `report_id` is the digest of
 * the canonical body without it.
 *
 * @param value - Untrusted report, for example parsed from a generated artifact.
 * @returns The canonical frozen report.
 * @throws {ApplicationEvidenceError} If the report is malformed, a comparison or the identity does
 * not re-derive, or a bound is exceeded.
 *
 * @example
 * ```ts
 * const report = validateApplicationEvaluationReport(JSON.parse(text));
 * console.log(report.report_id);
 * ```
 */
export function validateApplicationEvaluationReport(value: unknown): ApplicationEvaluationReport {
    try {
        const fields = readScopeDataObject(
            value,
            [
                "baselines",
                "comparisons",
                "compatibility_version",
                "evaluation_id",
                "limitations",
                "metrics",
                "report_id",
                "report_version",
                "revision",
                "runs",
            ],
            "evaluation report",
        );
        if (
            fields.compatibility_version !== config.compatibilityVersion ||
            fields.report_version !== APPLICATION_EVALUATION_REPORT_VERSION ||
            canonical(fields.metrics) !== canonical(APPLICATION_EVALUATION_METRICS)
        ) {
            throw new TypeError("report version or metric order is unsupported");
        }
        assertScopeText(fields.evaluation_id, "evaluation_id");
        assertScopeText(fields.revision, "revision");
        const runs = readBounded(
            fields.runs,
            "runs",
            APPLICATION_EVALUATION_LIMITS.maxExperiments,
        ).map((run, index) => readRun(run, `runs[${index}]`));
        assertDistinct(
            runs.map((run) => run.experiment_id),
            "run experiment ids",
        );
        const baselines = readScopeArray(fields.baselines, "baselines").map((baseline, index) =>
            readReportBaseline(baseline, `baselines[${index}]`, runs[index]),
        );
        const comparisons = readScopeArray(fields.comparisons, "comparisons");
        if (baselines.length !== runs.length || comparisons.length !== runs.length) {
            throw new TypeError("runs, baselines, and comparisons must align by experiment");
        }
        const expected = runs.map((run, index) => {
            const baseline = baselines[index] as ApplicationEvaluationBaseline;
            return {
                baseline_kind: baseline.kind,
                experiment_id: run.experiment_id,
                values: compareApplicationBaseline(run.metrics, baseline.metrics),
            };
        });
        if (canonical(comparisons) !== canonical(expected)) {
            throw new TypeError("comparisons do not re-derive from the runs and baselines");
        }
        const limitations = readBounded(
            fields.limitations,
            "limitations",
            APPLICATION_EVALUATION_LIMITS.maxLimitations,
        ).map((limitation, index) => readLimitation(limitation, `limitations[${index}]`));
        assertDistinct(
            limitations.map((limitation) => limitation.id),
            "limitation ids",
        );
        const { report_id: reportId, ...body } = fields;
        const report = {
            ...body,
            baselines,
            comparisons: expected,
            limitations,
            metrics: APPLICATION_EVALUATION_METRICS,
            runs,
        };
        if (
            reportId !==
            prefixedApplicationId(
                config.identity.reportIdPrefix,
                report as unknown as SemanticValue,
            )
        ) {
            throw new TypeError("report_id does not re-derive from the report body");
        }
        return createCanonicalSnapshot({
            ...report,
            report_id: reportId,
        } as unknown as RecordBody) as unknown as ApplicationEvaluationReport;
    } catch (error) {
        throw new ApplicationEvidenceError("evaluation report is malformed", { cause: error });
    }
}

function readExperiment(value: unknown, subject: string): ApplicationEvaluationExperiment {
    const fields = readScopeDataObject(
        value,
        ["baseline", "commandId", "id", "protocol"],
        subject,
        ["sourceCommandId"],
    );
    assertScopeText(fields.id, `${subject}.id`);
    assertScopeText(fields.commandId, `${subject}.commandId`);
    const protocol = readApplicationProtocol(fields.protocol);
    const baseline = readBaselineDefinition(fields.baseline, protocol.kind, `${subject}.baseline`);
    const isTreeRl = protocol.kind === TREE_RL_KIND;
    if (isTreeRl) {
        assertScopeText(fields.sourceCommandId, `${subject}.sourceCommandId`);
    } else if (fields.sourceCommandId !== undefined) {
        throw new TypeError(`${subject}.sourceCommandId is only declared by a Tree-RL experiment`);
    }
    return {
        baseline,
        commandId: fields.commandId,
        id: fields.id,
        protocol,
        ...(isTreeRl ? { sourceCommandId: fields.sourceCommandId as string } : {}),
    };
}

function readBaselineDefinition(
    value: unknown,
    kind: ApplicationKind,
    subject: string,
): ApplicationEvaluationBaselineDefinition {
    const fields = readScopeDataObject(value, ["kind"], subject, ["commandId", "workerId"]);
    if (!BASELINE_KINDS[kind].includes(fields.kind as string)) {
        throw new TypeError(`${subject}.kind must be a configured ${kind} baseline`);
    }
    const baselineKind = fields.kind as ApplicationEvaluationBaselineKind;
    if (kind !== SUPERVISOR_KIND) {
        if (fields.commandId !== undefined || fields.workerId !== undefined) {
            throw new TypeError(
                `${subject} declares fields only the ${SUPERVISOR_KIND} baseline uses`,
            );
        }
        return { kind: baselineKind };
    }
    assertScopeText(fields.commandId, `${subject}.commandId`);
    assertScopeText(fields.workerId, `${subject}.workerId`);
    return { commandId: fields.commandId, kind: baselineKind, workerId: fields.workerId };
}

function readLimitation(value: unknown, subject: string): ApplicationEvaluationLimitation {
    const fields = readScopeDataObject(value, ["id", "text"], subject);
    assertScopeText(fields.id, `${subject}.id`);
    assertScopeText(fields.text, `${subject}.text`);
    if (fields.text.length > APPLICATION_EVALUATION_LIMITS.maxLimitationLength) {
        throw new TypeError(`${subject}.text exceeds the configured length bound`);
    }
    return { id: fields.id, text: fields.text };
}

function readBinding(
    experiment: ApplicationEvaluationExperiment,
    value: unknown,
): ApplicationEvaluationBinding {
    const subject = `binding of experiment ${experiment.id}`;
    try {
        const kind = experiment.protocol.kind;
        const fields = readScopeDataObject(
            value,
            ["kind", "options", ...(kind === TREE_RL_KIND ? ["source"] : [])],
            subject,
        );
        if (fields.kind !== kind) {
            throw new TypeError(`${subject} must be a ${kind} binding`);
        }
        readScopeDataObject(
            fields.options,
            Object.keys(fields.options as object),
            `${subject}.options`,
        );
        if (kind === TREE_RL_KIND) {
            readScopeDataObject(
                fields.source,
                Object.keys(fields.source as object),
                `${subject}.source`,
            );
        }
        if (kind === SUPERVISOR_KIND) {
            readBaselineWorker(
                value as CodingSupervisorEvaluationBinding,
                experiment.baseline.workerId as string,
            );
        }
        return value as ApplicationEvaluationBinding;
    } catch (error) {
        throw new ApplicationProtocolError(`${subject} is malformed`, { cause: error });
    }
}

function readBaselineWorker(
    binding: CodingSupervisorEvaluationBinding,
    workerId: string,
): CodingSupervisorEvaluationBinding["options"]["workers"][number] {
    const workers = readScopeArray(binding.options.workers, "options.workers");
    const worker = workers.find(
        (candidate) =>
            typeof candidate === "object" &&
            candidate !== null &&
            (candidate as { readonly workerId?: unknown }).workerId === workerId,
    );
    if (worker === undefined) {
        throw new TypeError(`options.workers must declare the baseline worker ${workerId}`);
    }
    return worker as CodingSupervisorEvaluationBinding["options"]["workers"][number];
}

async function measureExperiment(
    store: SQLiteTraceStore,
    experiment: ApplicationEvaluationExperiment,
    binding: ApplicationEvaluationBinding,
): Promise<MeasuredExperiment> {
    const { commandId, protocol } = experiment;
    if (binding.kind === SUPERVISOR_KIND) {
        const { inspection, manifest } = await runCodingSupervisor(store, {
            ...binding.options,
            commandId,
            protocol,
        });
        const attempts = inspection.workers.flatMap((worker) => worker.attempts);
        const accepted = attempts.find(
            (attempt) => attempt.status === ACCEPTED_WORKER,
        ) as CodingSupervisorAttemptInspection;
        return {
            baseline: await measureSingleWorker(store, experiment, binding),
            run: runOf(
                manifest,
                metricsOf(
                    manifest.costs,
                    attempts.filter((attempt) => attempt.inspection.completion !== null).length,
                    (accepted.inspection.completion as ChildRunCompletionInspection).status ===
                        FINISHED_RUN,
                ),
            ),
        };
    }
    if (binding.kind === OPTIMIZER_KIND) {
        const { inspection, manifest } = await runCounterfactualOptimization(store, {
            ...binding.options,
            baselines: [
                experiment.baseline.kind as (typeof APPLICATION_CRO_BASELINE_KINDS)[number],
            ],
            commandId,
            protocol,
        });
        // Both sides cover exactly the candidates that retain a full-replay comparison: each
        // candidate's branch against its own full replay.
        const compared = inspection.candidates
            .map((candidate) => candidate.outcome)
            .filter(
                (
                    outcome,
                ): outcome is CounterfactualCandidateRecord & {
                    readonly baseline: CounterfactualBaselineComparison;
                } => outcome !== null && outcome.baseline !== null,
            );
        const branches = measureSessions(
            store,
            compared.map((outcome) => outcome.branch_session_id),
        );
        const replays = measureSessions(
            store,
            compared.map((outcome) => outcome.baseline.session_id),
        );
        return {
            baseline: sessionSide(replays, replays.finished),
            run: runOf(manifest, sessionSide(branches, inspection.promotion !== null).metrics),
        };
    }
    if (binding.kind === COMPRESSION_KIND) {
        const { inspection, manifest } = await runTrajectoryCompression(store, {
            ...binding.options,
            baselines: [
                experiment.baseline.kind as (typeof APPLICATION_COMPRESSION_BASELINE_KINDS)[number],
            ],
            commandId,
            protocol,
        });
        const outcome = inspection.outcome as TrajectoryCompressionOutcomeRecord;
        const result = measureSessions(store, [outcome.result_session_id]);
        const original = measureSessions(store, [
            (outcome.baseline as NonNullable<TrajectoryCompressionOutcomeRecord["baseline"]>)
                .session_id,
        ]);
        return {
            baseline: sessionSide(original, original.finished),
            run: runOf(manifest, sessionSide(result, result.finished).metrics),
        };
    }
    const source = await runReplaySession(store, {
        ...binding.source,
        commandId: experiment.sourceCommandId as string,
    });
    const { inspection, manifest } = await runTreeRlRollouts(store, {
        ...binding.options,
        baselines: [
            experiment.baseline.kind as (typeof APPLICATION_TREE_RL_BASELINE_KINDS)[number],
        ],
        commandId,
        protocol,
        sourceSessionId: source.inspection.session_id,
    });
    const rollouts = inspection.rollouts.map((rollout) => rollout.record as TreeRlRolloutRecord);
    return {
        baseline: measureRollouts(rollouts.filter((rollout) => rollout.branch === 0)),
        run: runOf(manifest, measureRollouts(rollouts).metrics),
    };
}

async function measureSingleWorker(
    store: SQLiteTraceStore,
    experiment: ApplicationEvaluationExperiment,
    binding: CodingSupervisorEvaluationBinding,
): Promise<Measured> {
    const { options } = binding;
    const worker = readBaselineWorker(binding, experiment.baseline.workerId as string);
    const { handle } = openChildRun(store, {
        budget: worker.budget as never,
        commandId: experiment.baseline.commandId as string,
        grant: worker.grant as never,
        input: worker.input,
        parent: options.parent as never,
        provenance: worker.provenance as never,
        supervisorId: options.supervisorId,
        task: worker.task as never,
    });
    const program = worker.program;
    const { inspection } = await runChildRun(
        store,
        program === undefined
            ? { handle, provider: worker.provider as never }
            : {
                  handle,
                  program: (context) =>
                      program(
                          Object.freeze({
                              ...context,
                              attempt: 1,
                              custody: null,
                              seeds: experiment.protocol.seeds,
                              workerId: worker.workerId,
                          }),
                      ),
              },
    );
    // runChildRun returns only after the child published its terminal cut and completion.
    const child = inspection.child as DurableTaskExecutionInspection;
    const completion = inspection.completion as ChildRunCompletionInspection;
    const costs = foldApplicationCosts(
        [child.usage?.usage].filter((usage) => usage !== undefined),
        Number(child.lifecycle.started_record_id !== null),
    );
    return {
        evidence: [handle.handle_id],
        metrics: metricsOf(costs, 1, completion.status === FINISHED_RUN),
    };
}

/** Folded live usage, retained step count, and terminal status of a list of replay sessions. */
type MeasuredSessions = {
    readonly costs: ApplicationCostSummary;
    readonly finished: boolean;
    readonly sessionIds: readonly string[];
    readonly steps: number;
};

function measureSessions(store: SQLiteTraceStore, sessionIds: readonly string[]): MeasuredSessions {
    let costs = ZERO_APPLICATION_COST;
    let steps = 0;
    let finished = sessionIds.length > 0;
    for (const sessionId of sessionIds) {
        const session = inspectReplaySession(store, { sessionId });
        costs = addApplicationCosts(costs, measureReplaySessionCost(session));
        steps += session.steps.length;
        finished = finished && session.terminal?.status === FINISHED_SESSION;
    }
    return { costs, finished, sessionIds, steps };
}

function sessionSide(sessions: MeasuredSessions, success: boolean): Measured {
    return {
        evidence: sessions.sessionIds,
        metrics: metricsOf(sessions.costs, sessions.steps, success),
    };
}

function measureRollouts(rollouts: readonly TreeRlRolloutRecord[]): Measured {
    return {
        evidence: rollouts.map((rollout) => rollout.replay_session_id),
        metrics: metricsOf(
            rollouts
                .map((rollout) => rollout.cost)
                .reduce(addApplicationCosts, ZERO_APPLICATION_COST),
            rollouts.reduce((total, rollout) => total + rollout.step_count, 0),
            rollouts.length > 0 &&
                rollouts.every((rollout) => rollout.status === COMPLETED_ROLLOUT),
        ),
    };
}

function runOf(
    manifest: {
        readonly application_id: string;
        readonly costs: ApplicationCostSummary;
        readonly dataset: ApplicationEvaluationRun["dataset"];
        readonly kind: ApplicationKind;
        readonly manifest_id: string;
        readonly protocol_id: string;
        readonly protocol_version: string;
        readonly seeds: readonly number[];
    },
    metrics: ApplicationEvaluationMetrics,
): Omit<ApplicationEvaluationRun, "experiment_id"> {
    return {
        application_id: manifest.application_id,
        costs: manifest.costs,
        dataset: manifest.dataset,
        kind: manifest.kind,
        manifest_id: manifest.manifest_id,
        metrics,
        protocol_id: manifest.protocol_id,
        protocol_version: manifest.protocol_version,
        seeds: manifest.seeds,
    };
}

function metricsOf(
    costs: ApplicationCostSummary,
    steps: number,
    success: boolean,
): ApplicationEvaluationMetrics {
    return {
        [COST_METRIC]: costs.cost_usd,
        [CALLS_METRIC]: costs.provider_calls,
        [INPUT_METRIC]: costs.input_tokens,
        [OUTPUT_METRIC]: costs.output_tokens,
        [STEPS_METRIC]: steps,
        [SUCCESS_METRIC]: success,
    };
}

function readRun(value: unknown, subject: string): ApplicationEvaluationRun {
    const fields = readScopeDataObject(
        value,
        [
            "application_id",
            "costs",
            "dataset",
            "experiment_id",
            "kind",
            "manifest_id",
            "metrics",
            "protocol_id",
            "protocol_version",
            "seeds",
        ],
        subject,
    );
    assertApplicationDigest(
        fields.application_id,
        config.identity.applicationIdPrefix,
        `${subject}.application_id`,
    );
    assertApplicationDigest(
        fields.manifest_id,
        config.identity.manifestIdPrefix,
        `${subject}.manifest_id`,
    );
    assertApplicationDigest(
        fields.protocol_id,
        config.identity.protocolIdPrefix,
        `${subject}.protocol_id`,
    );
    assertScopeText(fields.experiment_id, `${subject}.experiment_id`);
    assertScopeText(fields.protocol_version, `${subject}.protocol_version`);
    if (!APPLICATION_KINDS.includes(fields.kind as ApplicationKind)) {
        throw new TypeError(`${subject}.kind must be a configured application kind`);
    }
    return {
        application_id: fields.application_id as string,
        costs: readApplicationCosts(fields.costs),
        dataset: readDataset(fields.dataset),
        experiment_id: fields.experiment_id,
        kind: fields.kind as ApplicationKind,
        manifest_id: fields.manifest_id as string,
        metrics: readMetrics(fields.metrics, `${subject}.metrics`),
        protocol_id: fields.protocol_id as string,
        protocol_version: fields.protocol_version,
        seeds: readSeeds(fields.seeds),
    };
}

function readReportBaseline(
    value: unknown,
    subject: string,
    run: ApplicationEvaluationRun | undefined,
): ApplicationEvaluationBaseline {
    const fields = readScopeDataObject(
        value,
        ["evidence", "experiment_id", "kind", "metrics"],
        subject,
    );
    if (run === undefined || fields.experiment_id !== run.experiment_id) {
        throw new TypeError(`${subject}.experiment_id must name the aligned run`);
    }
    if (!BASELINE_KINDS[run.kind].includes(fields.kind as string)) {
        throw new TypeError(`${subject}.kind must be a configured ${run.kind} baseline`);
    }
    const evidence = readScopeArray(fields.evidence, `${subject}.evidence`).map((entry, index) => {
        assertScopeText(entry, `${subject}.evidence[${index}]`);
        return entry;
    });
    assertDistinct(evidence, `${subject}.evidence`);
    return {
        evidence,
        experiment_id: run.experiment_id,
        kind: fields.kind as ApplicationEvaluationBaselineKind,
        metrics: readMetrics(fields.metrics, `${subject}.metrics`),
    };
}

function readMetrics(value: unknown, subject: string): ApplicationEvaluationMetrics {
    const fields = readScopeDataObject(value, APPLICATION_EVALUATION_METRICS, subject);
    const cost = fields[COST_METRIC];
    if (cost !== null && (typeof cost !== "number" || !Number.isFinite(cost) || cost < 0)) {
        throw new TypeError(
            `${subject}.${COST_METRIC} must be null or a non-negative finite number`,
        );
    }
    if (typeof fields[SUCCESS_METRIC] !== "boolean") {
        throw new TypeError(`${subject}.${SUCCESS_METRIC} must be a boolean`);
    }
    return {
        [COST_METRIC]: cost,
        [CALLS_METRIC]: readCount(fields[CALLS_METRIC], `${subject}.${CALLS_METRIC}`),
        [INPUT_METRIC]: readCount(fields[INPUT_METRIC], `${subject}.${INPUT_METRIC}`),
        [OUTPUT_METRIC]: readCount(fields[OUTPUT_METRIC], `${subject}.${OUTPUT_METRIC}`),
        [STEPS_METRIC]: readCount(fields[STEPS_METRIC], `${subject}.${STEPS_METRIC}`),
        [SUCCESS_METRIC]: fields[SUCCESS_METRIC],
    };
}

function readBounded(value: unknown, subject: string, bound: number): readonly unknown[] {
    const entries = readScopeArray(value, subject);
    if (entries.length === 0 || entries.length > bound) {
        throw new TypeError(`${subject} must be non-empty and within the configured bound`);
    }
    return entries;
}

function assertDistinct(values: readonly string[], subject: string): void {
    if (new Set(values).size !== values.length) {
        throw new TypeError(`${subject} must be distinct`);
    }
}

function definedTexts(...values: readonly (string | undefined)[]): readonly string[] {
    return values.filter((value): value is string => value !== undefined);
}
