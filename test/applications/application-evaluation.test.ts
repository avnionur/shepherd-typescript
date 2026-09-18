import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hostname } from "node:os";
import { test } from "node:test";

import { Ajv2020, type AnySchemaObject } from "ajv/dist/2020.js";

import * as applications from "../../src/facades/applications.ts";
import {
    APPLICATION_EVALUATION_LIMITS,
    APPLICATION_EVALUATION_METRICS,
    APPLICATION_EVALUATION_REPORT_VERSION,
    APPLICATION_SUPERVISION_BASELINE_KINDS,
    type ApplicationEvaluationMetrics,
    type ApplicationEvaluationReport,
    ApplicationEvidenceError,
    ApplicationProtocolError,
    type CodingSupervisorPolicyContext,
    compareApplicationBaseline,
    deriveApplicationOwnerId,
    exportTreeRlTrainingBatch,
    inspectChildRun,
    inspectCounterfactualOptimization,
    inspectReplaySession,
    inspectTrajectoryCompression,
    inspectTreeRlRun,
    readApplicationEvaluationDefinition,
    runApplicationEvaluation,
    SQLiteTraceStore,
    type TreeRlProviderContext,
    validateApplicationEvaluationReport,
} from "../../src/index.ts";
import {
    APPLICATIONS_PROTOCOL_V4_CONTRACT,
    APPLICATIONS_PROTOCOL_V5_CONTRACT,
} from "../../src/protocol/compatibility-constants.ts";
import { applicationsProtocolConfig } from "../../src/protocol/config.ts";
import { parseProtocolConfig } from "../../src/protocol/config-validation.ts";
import { renderEvaluationReportJson } from "../../tooling/evaluation/writer.ts";
import {
    poisoned,
    rawDefinition,
    recordingBinder,
    repositoryEvaluation,
    researchConfiguration,
} from "./evaluation-fixtures.ts";

const validConfig = JSON.parse(
    readFileSync(new URL("../../protocol.config.json", import.meta.url), "utf8"),
) as Record<string, Record<string, Record<string, unknown>>>;

async function evaluateOnce(
    evaluation = repositoryEvaluation(),
): Promise<{ readonly report: ApplicationEvaluationReport; readonly store: SQLiteTraceStore }> {
    const store = new SQLiteTraceStore();
    const report = await runApplicationEvaluation(store, {
        bind: evaluation.bind,
        definition: evaluation.definition,
    });
    return { report, store };
}

function metrics(overrides: Partial<ApplicationEvaluationMetrics> = {}) {
    return {
        cost_usd: 1,
        input_tokens: 10,
        output_tokens: 2,
        provider_calls: 4,
        steps: 4,
        success: true,
        ...overrides,
    };
}

test("applications protocol v5 appends the evaluation vocabulary to v4 and refuses drift", () => {
    const { artifacts, evaluation, schemas, ...rest } = APPLICATIONS_PROTOCOL_V5_CONTRACT;
    const {
        artifacts: previousArtifacts,
        schemas: previousSchemas,
        ...previous
    } = APPLICATIONS_PROTOCOL_V4_CONTRACT;
    assert.deepEqual(rest, previous);
    assert.deepEqual(
        { ...artifacts, evaluationSchema: undefined },
        { ...previousArtifacts, evaluationSchema: undefined },
    );
    assert.deepEqual(
        { ...schemas, evaluationId: undefined },
        { ...previousSchemas, evaluationId: undefined },
    );
    assert.deepEqual(applicationsProtocolConfig.evaluation, evaluation);
    assert.deepEqual(APPLICATION_EVALUATION_METRICS, [
        "cost_usd",
        "provider_calls",
        "input_tokens",
        "output_tokens",
        "steps",
        "success",
    ]);
    assert.deepEqual(APPLICATION_SUPERVISION_BASELINE_KINDS, ["no_supervision"]);
    assert.equal(APPLICATION_EVALUATION_REPORT_VERSION, 1);
    assert.equal(APPLICATION_EVALUATION_LIMITS.maxExperiments, 16);
    const mutations: readonly ((section: Record<string, unknown>) => void)[] = [
        (section) => {
            section.metrics = ["cost_usd"];
        },
        (section) => {
            section.limits = { ...(section.limits as object), maxLimitations: 0 };
        },
        (section) => {
            section.supervisionBaselineKinds = ["no_supervision", "no_supervision"];
        },
        (section) => {
            delete section.reportVersion;
        },
        (section) => {
            section.extra = true;
        },
    ];
    for (const mutate of mutations) {
        const config = structuredClone(validConfig);
        mutate(config.applications?.evaluation as Record<string, unknown>);
        assert.throws(() => parseProtocolConfig(config), TypeError, mutate.toString());
    }
    const drifted = structuredClone(validConfig);
    (drifted.applications?.evaluation as Record<string, unknown>).reportVersion = 2;
    assert.throws(
        () => parseProtocolConfig(drifted),
        (error: unknown) =>
            error instanceof TypeError && /new applications protocol/u.test(error.message),
    );
});

test("the evaluation API is identical through the applications facade and the root", () => {
    assert.equal(applications.runApplicationEvaluation, runApplicationEvaluation);
    assert.equal(applications.compareApplicationBaseline, compareApplicationBaseline);
    assert.equal(
        applications.validateApplicationEvaluationReport,
        validateApplicationEvaluationReport,
    );
    assert.equal(
        applications.readApplicationEvaluationDefinition,
        readApplicationEvaluationDefinition,
    );
    assert.equal(applications.APPLICATION_EVALUATION_METRICS, APPLICATION_EVALUATION_METRICS);
    assert.equal(applications.APPLICATION_EVALUATION_LIMITS, APPLICATION_EVALUATION_LIMITS);
});

test("the report is byte-identical across repeated runs and fresh stores and carries no host data", async () => {
    const first = await evaluateOnce();
    using store = first.store;
    const second = await evaluateOnce();
    using other = second.store;
    assert.equal(second.report.report_id, first.report.report_id);
    assert.equal(
        renderEvaluationReportJson(second.report),
        renderEvaluationReportJson(first.report),
    );
    // The identity is the digest of the canonical body; a JSON round trip re-validates.
    const text = renderEvaluationReportJson(first.report);
    assert.deepEqual(validateApplicationEvaluationReport(JSON.parse(text)), first.report);
    assert.match(first.report.report_id, /^evaluation-report:sha256:[0-9a-f]{64}$/u);
    // A repeated evaluation in the same store re-executes nothing: every provider, program, policy,
    // evaluator, and reward now throws, and the report is unchanged.
    const evaluation = repositoryEvaluation();
    const repeated = await runApplicationEvaluation(store, {
        bind: recordingBinder(evaluation, poisoned),
        definition: evaluation.definition,
    });
    assert.equal(renderEvaluationReportJson(repeated), text);
    // No wall-clock, host, node version, or duration appears in the digest-bearing JSON.
    for (const forbidden of [
        process.version,
        process.platform,
        process.arch,
        hostname(),
        "duration",
        "timestamp",
        "elapsed",
    ]) {
        assert.equal(text.includes(`"${forbidden}"`), false, forbidden);
    }
    assert.deepEqual(Object.keys(JSON.parse(text)), [
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
    ]);
    assert.equal(other.verifyIntegrity().ok, true);
});

test("every metric is measured from retained evidence and every configured baseline kind is run", async () => {
    const { report, store: evaluated } = await evaluateOnce();
    using store = evaluated;
    const [supervisor, optimizer, compression, treeRl] = report.runs;
    const [noSupervision, fullReplay, noCompression, singleRollout] = report.baselines;
    assert.deepEqual(
        report.baselines.map((baseline) => baseline.kind),
        ["no_supervision", "full_replay", "no_compression", "single_rollout"],
    );
    assert.deepEqual(
        report.runs.map((run) => run.kind),
        ["coding_supervisor", "counterfactual_optimization", "trajectory_compression", "tree_rl"],
    );
    // Coding supervisor: the manifest's measured costs, two worker attempts, one accepted.
    assert.deepEqual(supervisor?.metrics, {
        cost_usd: supervisor?.costs.cost_usd,
        input_tokens: supervisor?.costs.input_tokens,
        output_tokens: supervisor?.costs.output_tokens,
        provider_calls: supervisor?.costs.provider_calls,
        steps: 2,
        success: true,
    });
    // no_supervision: one plain child run of the named worker, never accepted, discarded, or
    // injected into by a policy.
    const [handleId] = noSupervision?.evidence ?? [];
    const handle = inspectChildRun(store, handleId as string);
    assert.equal(handle.status, "settling");
    assert.equal(handle.decision, null);
    assert.deepEqual(handle.injections, []);
    assert.equal(handle.supervisor_id, "supervisor:evaluation");
    assert.deepEqual(handle.input, { path: "greet.ts", text: "a edit" });
    const usage = handle.child?.usage?.usage;
    assert.deepEqual(noSupervision?.metrics, {
        cost_usd: usage?.cost_usd,
        input_tokens: usage?.input_tokens,
        output_tokens: usage?.output_tokens,
        provider_calls: 1,
        steps: 1,
        success: true,
    });
    // Counterfactual optimization: candidate branches against their full replays.
    const optimization = inspectCounterfactualOptimization(
        store,
        optimizer?.application_id as string,
    );
    const outcomes = optimization.candidates.map((candidate) => candidate.outcome);
    assert.deepEqual(
        fullReplay?.evidence,
        outcomes.map((outcome) => outcome?.baseline?.session_id),
    );
    const live = (sessionIds: readonly string[]) =>
        sessionIds
            .map((sessionId) => inspectReplaySession(store, { sessionId }))
            .flatMap((session) => session.steps)
            .filter((step) => step.source === "live" && step.kind === "provider").length;
    assert.equal(
        optimizer?.metrics.provider_calls,
        live(outcomes.map((outcome) => outcome?.branch_session_id as string)),
    );
    assert.equal(
        optimizer?.metrics.provider_calls,
        outcomes.reduce((total, outcome) => total + (outcome?.cost?.provider_calls ?? 0), 0),
    );
    assert.equal(
        fullReplay?.metrics.provider_calls,
        outcomes.reduce((total, outcome) => total + (outcome?.baseline?.provider_calls ?? 0), 0),
    );
    assert.equal(optimizer?.metrics.success, optimization.promotion !== null);
    // Trajectory compression: the result session against the kept source trajectory.
    const compressed = inspectTrajectoryCompression(store, compression?.application_id as string);
    assert.equal(compressed.outcome?.outcome, "pruned");
    assert.equal(compression?.metrics.steps, compressed.outcome?.result_step_count);
    assert.equal(noCompression?.metrics.steps, compressed.outcome?.original_step_count);
    assert.deepEqual(noCompression?.evidence, [compressed.source_session_id]);
    assert.equal(noCompression?.metrics.provider_calls, live([compressed.source_session_id]));
    // Tree-RL: every rollout against the reused branch-0 rollouts.
    const tree = inspectTreeRlRun(store, treeRl?.application_id as string);
    const records = tree.rollouts.map((rollout) => rollout.record);
    assert.equal(
        treeRl?.metrics.steps,
        records.reduce((sum, r) => sum + (r?.step_count ?? 0), 0),
    );
    assert.deepEqual(
        singleRollout?.evidence,
        records.filter((r) => r?.branch === 0).map((r) => r?.replay_session_id),
    );
    assert.equal(
        singleRollout?.metrics.provider_calls,
        records
            .filter((r) => r?.branch === 0)
            .reduce((sum, r) => sum + (r?.cost.provider_calls ?? 0), 0),
    );
    assert.equal(
        exportTreeRlTrainingBatch(store, tree.application_id).baseline?.line_count,
        singleRollout?.evidence.length,
    );
    // Runs carry the manifest, protocol, seeds, dataset, and costs of each application.
    for (const run of report.runs) {
        assert.match(run.manifest_id, /^application-manifest:sha256:/u);
        assert.match(run.protocol_id, /^application-protocol:sha256:/u);
    }
    assert.deepEqual(treeRl?.seeds, [3, 5, 8]);
    assert.equal(store.verifyIntegrity().ok, true);
});

test("comparisons copy measured values and take the delta only between two numbers", async () => {
    const { report, store } = await evaluateOnce();
    using _store = store;
    for (const [index, comparison] of report.comparisons.entries()) {
        assert.equal(comparison.experiment_id, report.runs[index]?.experiment_id);
        assert.equal(comparison.baseline_kind, report.baselines[index]?.kind);
        assert.deepEqual(
            comparison.values,
            compareApplicationBaseline(
                report.runs[index]?.metrics as ApplicationEvaluationMetrics,
                report.baselines[index]?.metrics as ApplicationEvaluationMetrics,
            ),
        );
    }
    assert.deepEqual(
        compareApplicationBaseline(
            metrics({ provider_calls: 1 }),
            metrics({ cost_usd: null, success: false }),
        ),
        [
            { application: 1, baseline: null, delta: null, metric: "cost_usd" },
            { application: 1, baseline: 4, delta: -3, metric: "provider_calls" },
            { application: 10, baseline: 10, delta: 0, metric: "input_tokens" },
            { application: 2, baseline: 2, delta: 0, metric: "output_tokens" },
            { application: 4, baseline: 4, delta: 0, metric: "steps" },
            { application: true, baseline: false, delta: null, metric: "success" },
        ],
    );
    for (const malformed of [
        { ...metrics(), extra: 1 },
        metrics({ cost_usd: -1 }),
        metrics({ cost_usd: Number.NaN }),
        metrics({ steps: 1.5 }),
        metrics({ success: "yes" as never }),
        { ...metrics(), steps: undefined },
    ]) {
        assert.throws(
            () => compareApplicationBaseline(malformed as never, metrics()),
            TypeError,
            JSON.stringify(malformed),
        );
    }
});

test("limitations are published verbatim and the documentation disclaims upstream results", async () => {
    const { report, store } = await evaluateOnce();
    using _store = store;
    const configured = (
        researchConfiguration().evaluation as {
            readonly definition: { readonly limitations: readonly unknown[] };
        }
    ).definition.limitations;
    assert.deepEqual(report.limitations, configured);
    assert.ok(
        report.limitations.some((limitation) => limitation.id === "no-upstream-reproduction"),
    );
    const documentation = readFileSync(
        new URL("../../docs/application-evaluation.md", import.meta.url),
        "utf8",
    );
    assert.match(documentation, /upstream headline results are not reproduced/iu);
    for (const limitation of report.limitations) {
        assert.ok(documentation.includes(`\`${limitation.id}\``), limitation.id);
    }
});

test("the report conforms to the generated evaluation schema", async () => {
    const { report, store } = await evaluateOnce();
    using _store = store;
    const document = JSON.parse(
        readFileSync(
            new URL(
                `../../${applicationsProtocolConfig.artifacts.evaluationSchema}`,
                import.meta.url,
            ),
            "utf8",
        ),
    ) as AnySchemaObject;
    const validate = new Ajv2020({ strict: true, strictTypes: false }).compile(document);
    const json = JSON.parse(renderEvaluationReportJson(report)) as Record<string, unknown>;
    assert.equal(validate(json), true, JSON.stringify(validate.errors));
    assert.equal(validate({ ...json, duration_ms: 1 }), false);
    assert.equal(validate({ ...json, report_version: 2 }), false);
    const [run] = json.runs as Record<string, unknown>[];
    assert.equal(
        validate({
            ...json,
            runs: [{ ...run, metrics: { ...(run?.metrics as object), estimated_usd: 1 } }],
        }),
        false,
    );
});

test("malformed definitions and bindings are refused before any record, and a corrected rerun completes", async () => {
    using store = new SQLiteTraceStore();
    const evaluation = repositoryEvaluation();
    const before = store.exportTrace();
    const mutations: readonly ((definition: ReturnType<typeof rawDefinition>) => void)[] = [
        (definition) => {
            (
                (definition.experiments[0] as Record<string, unknown>).baseline as Record<
                    string,
                    unknown
                >
            ).kind = "full_replay";
        },
        (definition) => {
            (
                (definition.experiments[3] as Record<string, unknown>).baseline as Record<
                    string,
                    unknown
                >
            ).kind = "unknown";
        },
        (definition) => {
            delete (
                (definition.experiments[0] as Record<string, unknown>).baseline as Record<
                    string,
                    unknown
                >
            ).workerId;
        },
        (definition) => {
            (
                (definition.experiments[1] as Record<string, unknown>).baseline as Record<
                    string,
                    unknown
                >
            ).commandId = "x";
        },
        (definition) => {
            delete (definition.experiments[3] as Record<string, unknown>).sourceCommandId;
        },
        (definition) => {
            (definition.experiments[1] as Record<string, unknown>).sourceCommandId = "x";
        },
        (definition) => {
            (definition.experiments[1] as Record<string, unknown>).id = "coding-supervisor";
        },
        (definition) => {
            (definition.experiments[1] as Record<string, unknown>).commandId =
                "evaluation:tree-rl:source";
        },
        (definition) => {
            definition.experiments = [];
        },
        (definition) => {
            definition.experiments = Array.from(
                { length: APPLICATION_EVALUATION_LIMITS.maxExperiments + 1 },
                (_, index) => ({
                    ...(definition.experiments[1] as object),
                    commandId: `command:${index}`,
                    id: `experiment:${index}`,
                }),
            );
        },
        (definition) => {
            definition.limitations = [];
        },
        (definition) => {
            (definition.limitations[0] as Record<string, unknown>).text = "x".repeat(
                APPLICATION_EVALUATION_LIMITS.maxLimitationLength + 1,
            );
        },
        (definition) => {
            (definition.limitations[1] as Record<string, unknown>).id =
                definition.limitations[0]?.id;
        },
        (definition) => {
            definition.extra = true;
        },
        (definition) => {
            (
                (definition.experiments[2] as Record<string, unknown>).protocol as Record<
                    string,
                    unknown
                >
            ).kind = "unknown";
        },
        (definition) => {
            delete (definition.experiments[2] as Record<string, unknown>).protocol;
        },
        (definition) => {
            definition.revision = "";
        },
    ];
    for (const mutate of mutations) {
        const definition = rawDefinition(evaluation);
        mutate(definition);
        const bind = recordingBinder(evaluation);
        await assert.rejects(
            runApplicationEvaluation(store, { bind, definition: definition as never }),
            ApplicationProtocolError,
            mutate.toString(),
        );
        assert.deepEqual(bind.calls, [], mutate.toString());
    }
    const bindingMutations: readonly ((binding: Record<string, unknown>) => unknown)[] = [
        (binding) => ({ ...binding, kind: "tree_rl" }),
        (binding) => ({ ...binding, extra: true }),
        (binding) => ({ ...binding, options: null }),
        (binding) => ({ ...binding, options: [] }),
        (binding) => ({
            ...binding,
            options: { ...(binding.options as object), workers: [] },
        }),
        (binding) => ("source" in binding ? { ...binding, source: undefined } : null),
    ];
    for (const mutate of bindingMutations) {
        const bind = recordingBinder(evaluation, (binding) => {
            const mutated = mutate(binding as never);
            return mutated === null ? binding : mutated;
        });
        await assert.rejects(
            runApplicationEvaluation(store, { bind, definition: evaluation.definition }),
            ApplicationProtocolError,
            mutate.toString(),
        );
    }
    await assert.rejects(
        runApplicationEvaluation(store, {
            bind: "bind" as never,
            definition: evaluation.definition,
        }),
        /bind must be a function/u,
    );
    await assert.rejects(
        runApplicationEvaluation(store, {
            bind: evaluation.bind,
            definition: evaluation.definition,
            extra: true,
        } as never),
        TypeError,
    );
    // Every refusal wrote nothing; the corrected evaluation runs in the same store.
    assert.equal(store.exportTrace(), before);
    const report = await runApplicationEvaluation(store, {
        bind: evaluation.bind,
        definition: evaluation.definition,
    });
    const reference = await evaluateOnce();
    using _reference = reference.store;
    assert.equal(report.report_id, reference.report.report_id);
});

test("an evaluation interrupted inside an application converges on rerun to the fresh-store report", async () => {
    using store = new SQLiteTraceStore();
    const evaluation = repositoryEvaluation();
    const crashing = recordingBinder(evaluation, (binding) =>
        binding.kind === "coding_supervisor"
            ? {
                  ...binding,
                  options: {
                      ...binding.options,
                      policy: (context: CodingSupervisorPolicyContext) => {
                          if (context.round > 1) {
                              throw new Error("simulated supervisor crash after round one");
                          }
                          return binding.options.policy(context);
                      },
                  },
              }
            : binding,
    );
    await assert.rejects(
        runApplicationEvaluation(store, { bind: crashing, definition: evaluation.definition }),
        /simulated supervisor crash/u,
    );
    assert.deepEqual(
        crashing.calls,
        evaluation.definition.experiments.map(({ id }) => id),
    );
    // The rerun resumes the supervisor from its retained round, runs the rest, and folds the same
    // report a fresh store produces.
    const resumed = await runApplicationEvaluation(store, {
        bind: evaluation.bind,
        definition: evaluation.definition,
    });
    const reference = await evaluateOnce();
    using _reference = reference.store;
    assert.equal(resumed.report_id, reference.report.report_id);
    assert.equal(store.verifyIntegrity().ok, true);
});

test("failed live calls, missing costs, and program-serviced baseline workers are measured as retained", async () => {
    using store = new SQLiteTraceStore();
    const evaluation = repositoryEvaluation((configuration) => {
        const provider = (configuration.evaluation as { provider: { usage: { costUsd: unknown } } })
            .provider;
        provider.usage.costUsd = null;
    });
    const report = await runApplicationEvaluation(store, {
        bind: recordingBinder(evaluation, (binding) => {
            if ("workers" in binding.options) {
                return {
                    ...binding,
                    options: {
                        ...binding.options,
                        workers: binding.options.workers.map((worker) => {
                            const { provider: _provider, ...rest } = worker;
                            return { ...rest, program: ({ input }: { input: unknown }) => input };
                        }),
                    },
                };
            }
            if ("reward" in binding.options) {
                const factory = binding.options.provider;
                // Every branch-0 rollout loses its provider on its first live call.
                return {
                    ...binding,
                    options: {
                        ...binding.options,
                        provider: (context: TreeRlProviderContext) => {
                            const built = factory(context);
                            return context.branch === 0
                                ? {
                                      descriptor: built.descriptor,
                                      invoke: async () => {
                                          throw new Error("rollout provider unavailable");
                                      },
                                  }
                                : built;
                        },
                    },
                };
            }
            return binding;
        }),
        definition: evaluation.definition,
    });
    const [supervisor, optimizer, , treeRl] = report.runs;
    const [noSupervision, fullReplay, , singleRollout] = report.baselines;
    // Program-serviced workers retain usage without tokens or a reported cost.
    assert.deepEqual(noSupervision?.metrics, {
        cost_usd: null,
        input_tokens: 0,
        output_tokens: 0,
        provider_calls: 1,
        steps: 1,
        success: true,
    });
    assert.equal(supervisor?.metrics.input_tokens, 0);
    // A reported null cost stays null on both sides.
    assert.equal(optimizer?.metrics.cost_usd, null);
    assert.equal(fullReplay?.metrics.cost_usd, null);
    assert.deepEqual(report.comparisons[1]?.values[0], {
        application: null,
        baseline: null,
        delta: null,
        metric: "cost_usd",
    });
    // A failed live call is counted with an unknown cost, never as free. Failed branch-0 rollouts
    // stay in the single_rollout baseline's calls and steps and make it unsuccessful.
    const tree = inspectTreeRlRun(store, treeRl?.application_id as string);
    const branchZero = tree.rollouts
        .map((rollout) => rollout.record)
        .filter((record) => record?.branch === 0);
    assert.ok(branchZero.length > 0);
    assert.ok(branchZero.every((record) => record?.status === "failed"));
    assert.ok(branchZero.every((record) => record?.cost.cost_usd === null));
    assert.deepEqual(singleRollout?.metrics, {
        cost_usd: null,
        input_tokens: 0,
        output_tokens: 0,
        provider_calls: branchZero.length,
        steps: branchZero.reduce((total, record) => total + (record?.step_count ?? 0), 0),
        success: false,
    });
    assert.equal(treeRl?.metrics.cost_usd, null);
    assert.equal(treeRl?.metrics.success, false);
});

test("an optimizer candidate whose branch failed stops the evaluation without a promotion", async () => {
    using store = new SQLiteTraceStore();
    const evaluation = repositoryEvaluation();
    const [, optimizerExperiment] = evaluation.definition.experiments;
    await assert.rejects(
        runApplicationEvaluation(store, {
            bind: recordingBinder(evaluation, (binding) => {
                if (!("candidates" in binding.options)) {
                    return binding;
                }
                const [first, ...rest] = binding.options.candidates;
                return {
                    ...binding,
                    options: {
                        ...binding.options,
                        candidates: [
                            {
                                ...first,
                                provider: {
                                    descriptor: first?.provider?.descriptor,
                                    invoke: async () => {
                                        throw new Error("candidate provider unavailable");
                                    },
                                },
                            },
                            ...rest,
                        ],
                    },
                };
            }),
            definition: evaluation.definition,
        }),
        ApplicationEvidenceError,
    );
    const optimization = inspectCounterfactualOptimization(
        store,
        deriveApplicationOwnerId(optimizerExperiment?.commandId as string),
    );
    assert.equal(optimization.candidates[0]?.outcome?.status, "rejected");
    assert.equal(optimization.candidates[0]?.outcome?.evaluation, null);
    assert.equal(optimization.promotion, null);
});

test("validateApplicationEvaluationReport refuses every inconsistent report", async () => {
    const { report, store } = await evaluateOnce();
    using _store = store;
    const json = JSON.parse(renderEvaluationReportJson(report)) as Record<string, unknown>;
    const [firstRun, secondRun] = json.runs as Record<string, unknown>[];
    const [firstBaseline] = json.baselines as Record<string, unknown>[];
    const [firstComparison] = json.comparisons as Record<string, unknown>[];
    const mutations: readonly Record<string, unknown>[] = [
        { ...json, report_id: `evaluation-report:sha256:${"0".repeat(64)}` },
        { ...json, report_id: "not-a-report" },
        { ...json, revision: "2" },
        { ...json, extra: true },
        { ...json, report_version: 2 },
        { ...json, compatibility_version: "other" },
        { ...json, metrics: ["steps"] },
        { ...json, runs: [] },
        { ...json, runs: [firstRun, firstRun, ...(json.runs as unknown[]).slice(2)] },
        { ...json, runs: [{ ...firstRun, kind: "unknown" }, ...(json.runs as unknown[]).slice(1)] },
        {
            ...json,
            runs: [{ ...firstRun, manifest_id: "manifest" }, ...(json.runs as unknown[]).slice(1)],
        },
        {
            ...json,
            runs: [
                { ...firstRun, metrics: { ...(firstRun?.metrics as object), steps: 99 } },
                ...(json.runs as unknown[]).slice(1),
            ],
        },
        { ...json, baselines: (json.baselines as unknown[]).slice(1) },
        { ...json, baselines: [...(json.baselines as unknown[]), firstBaseline] },
        {
            ...json,
            baselines: [
                { ...firstBaseline, kind: "full_replay" },
                ...(json.baselines as unknown[]).slice(1),
            ],
        },
        {
            ...json,
            baselines: [
                { ...firstBaseline, experiment_id: secondRun?.experiment_id },
                ...(json.baselines as unknown[]).slice(1),
            ],
        },
        {
            ...json,
            baselines: [
                { ...firstBaseline, evidence: ["same", "same"] },
                ...(json.baselines as unknown[]).slice(1),
            ],
        },
        {
            ...json,
            comparisons: [
                { ...firstComparison, values: [] },
                ...(json.comparisons as unknown[]).slice(1),
            ],
        },
        { ...json, comparisons: (json.comparisons as unknown[]).slice(1) },
        { ...json, limitations: [] },
        {
            ...json,
            limitations: [...(json.limitations as unknown[]), (json.limitations as unknown[])[0]],
        },
    ];
    for (const mutated of mutations) {
        assert.throws(
            () => validateApplicationEvaluationReport(mutated),
            ApplicationEvidenceError,
            JSON.stringify(Object.keys(mutated)),
        );
    }
    assert.deepEqual(validateApplicationEvaluationReport(json), report);
});
