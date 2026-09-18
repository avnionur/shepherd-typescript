import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
    analyzeReplayDivergence,
    deriveApplicationOwnerId,
    inspectCounterfactualOptimization,
    inspectReplaySession,
    type ReplaySessionInspection,
    runCounterfactualOptimization,
    SQLiteTraceStore,
} from "../../src/index.ts";
import {
    counterfactualProtocol,
    draftTask,
    fail,
    keyedProvider,
    optimizerOptions,
    pass,
    providerCandidate,
    scriptedEvaluator,
    taskProgram,
} from "./counterfactual-fixtures.ts";

function liveProviderCalls(inspection: ReplaySessionInspection): number {
    return inspection.steps.filter((step) => step.source === "live" && step.kind === "provider")
        .length;
}

function cacheReads(inspection: ReplaySessionInspection): number {
    return inspection.steps
        .filter((step) => step.source === "live")
        .reduce((total, step) => total + (step.provider?.cache?.read_input_tokens ?? 0), 0);
}

test("only the affected suffix is replayed, lineage forks the parent branch, and full replay is measured", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-cro-suffix-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const databasePath = path.join(directory, "trace.sqlite");
    using store = new SQLiteTraceStore(databasePath);
    const base = keyedProvider("base", { cacheRead: 3 });
    const stronger = keyedProvider("stronger", { cacheRead: 5 });
    const unused = keyedProvider("unused");
    const refined = keyedProvider("refined");
    const evaluate = scriptedEvaluator({
        "no-dependents": pass(1),
        "refine-review": fail(9),
        "stronger-plan": pass(2),
    });
    const options = optimizerOptions("application:cro:suffix", {
        baseline: {
            program: optimizerOptions("unused").baseline.program,
            programId: "workflow:plan-draft-review.v1",
            provider: base,
        },
        baselines: ["full_replay"],
        candidates: [
            providerCandidate("stronger-plan", 0, stronger),
            providerCandidate("no-dependents", 1, unused),
            providerCandidate("refine-review", 2, refined, { parent: "stronger-plan" }),
        ],
        clock: () => 5_000,
        evaluate,
    });
    const { inspection, manifest } = await runCounterfactualOptimization(store, options);
    const applicationId = deriveApplicationOwnerId("application:cro:suffix");
    assert.equal(inspection.application_id, applicationId);
    assert.equal(inspection.kind, "counterfactual_optimization");
    assert.deepEqual(inspection.baselines, ["full_replay"]);
    const baseline = inspectReplaySession(store, { sessionId: inspection.baseline_session_id });
    assert.equal(baseline.steps.length, 4);
    const [strongerPlan, noDependents, refineReview] = inspection.candidates;
    assert.ok(strongerPlan && noDependents && refineReview);
    // An edit at the plan affects the draft and the review: the branch serves steps 0 and 1 from
    // the baseline journal and replays only steps 2 and 3 live.
    const a = strongerPlan.outcome;
    assert.ok(a);
    assert.equal(a.status, "evaluated");
    assert.deepEqual(a.affected_steps, [2, 3]);
    assert.deepEqual(a.target, {
        prefix_id: baseline.steps[1]?.prefix_id,
        source_session_id: baseline.session_id,
        step_index: 2,
    });
    assert.deepEqual(a.divergence, {
        common_prefix_id: baseline.steps[1]?.prefix_id,
        first_divergence_index: 2,
        live_steps: 2,
        recorded_steps: 2,
        unexplained: [],
    });
    const aBranch = inspectReplaySession(store, { sessionId: a.branch_session_id });
    assert.deepEqual(
        aBranch.steps.map((step) => step.source),
        ["recorded", "recorded", "live", "live"],
    );
    assert.deepEqual(
        analyzeReplayDivergence(store, {
            replaySessionId: a.branch_session_id,
            sourceSessionId: baseline.session_id,
        }).steps.map((step) => step.cause),
        [null, null, "root", "propagated"],
    );
    assert.deepEqual(a.cost, {
        cache_creation_input_tokens: 2,
        cache_read_input_tokens: 10,
        cost_usd: 1,
        input_tokens: 20,
        output_tokens: 4,
        provider_calls: 2,
    });
    // An edit whose step has no dependent replays zero live steps: its provider is reached only by
    // the whole-workflow comparison.
    const b = noDependents.outcome;
    assert.ok(b);
    assert.deepEqual(b.affected_steps, []);
    assert.equal(b.target.step_index, 4);
    assert.deepEqual(b.divergence, {
        common_prefix_id: baseline.steps[3]?.prefix_id,
        first_divergence_index: null,
        live_steps: 0,
        recorded_steps: 4,
        unexplained: [],
    });
    assert.equal(b.cost?.provider_calls, 0);
    // The child forks its parent's branch at the boundary before the parent's review step.
    const c = refineReview.outcome;
    assert.ok(c);
    assert.equal(c.parent_candidate_id, a.candidate_id);
    assert.equal(c.target.source_session_id, a.branch_session_id);
    assert.equal(c.target.step_index, 3);
    assert.equal(c.divergence?.live_steps, 1);
    assert.equal(c.status, "rejected");
    assert.deepEqual(c.evaluation, fail(9));
    assert.equal(c.failure, null);
    // Every candidate was proposed before it was evaluated, with the identical plan and target.
    for (const candidate of inspection.candidates) {
        assert.equal(candidate.proposed?.status, "proposed");
        assert.equal(candidate.proposed?.divergence, null);
        assert.deepEqual(candidate.proposed?.target, candidate.outcome?.target);
    }
    // Measured full-replay comparison: provider calls and cache reads from the session evidence.
    for (const outcome of [a, b, c]) {
        const branch = inspectReplaySession(store, { sessionId: outcome.branch_session_id });
        const full = inspectReplaySession(store, {
            sessionId: outcome.baseline?.session_id as string,
        });
        assert.equal(full.origin?.target_step_count, 0);
        assert.equal(outcome.cost?.provider_calls, liveProviderCalls(branch));
        assert.equal(outcome.cost?.cache_read_input_tokens, cacheReads(branch));
        assert.equal(outcome.baseline?.provider_calls, liveProviderCalls(full));
        assert.equal(outcome.baseline?.cache_read_input_tokens, cacheReads(full));
        assert.equal(outcome.baseline?.kind, "full_replay");
    }
    assert.deepEqual(
        [a, b, c].map((outcome) => [
            outcome.cost?.provider_calls,
            outcome.baseline?.provider_calls,
        ]),
        [
            [2, 4],
            [0, 4],
            [1, 4],
        ],
    );
    assert.deepEqual(
        [a, b, c].map((outcome) => [
            outcome.cost?.cache_read_input_tokens,
            outcome.baseline?.cache_read_input_tokens,
        ]),
        [
            [10, 20],
            [0, 0],
            [0, 0],
        ],
    );
    assert.deepEqual(unused.calls, ["plan", "research", "draft", "review"]);
    // The evaluator saw each proven branch with its divergence analysis and measured cost.
    assert.deepEqual(
        evaluate.contexts.map((entry) => [
            entry.candidate.name,
            entry.target.step_index,
            entry.affectedSteps,
            entry.branch.session_id,
            entry.divergence.replay_session_id,
            entry.cost.provider_calls,
        ]),
        [
            ["stronger-plan", 2, [2, 3], a.branch_session_id, a.branch_session_id, 2],
            ["no-dependents", 4, [], b.branch_session_id, b.branch_session_id, 0],
            ["refine-review", 3, [3], c.branch_session_id, c.branch_session_id, 1],
        ],
    );
    assert.equal(evaluate.contexts[0]?.protocol.kind, "counterfactual_optimization");
    // The best passing candidate reaching the promotion threshold is promoted once.
    assert.equal(inspection.promotion?.candidate_id, a.candidate_id);
    assert.equal(inspection.promotion?.status, "promoted");
    assert.deepEqual(
        { ...inspection.promotion, record_id: null, status: null },
        { ...a, record_id: null, status: null },
    );
    // The manifest cites the baseline, every outcome, branch, and comparison, and the promotion.
    assert.equal(manifest.kind, "counterfactual_optimization");
    assert.deepEqual(
        manifest.artifacts.map((artifact) => artifact.role),
        [
            "baseline_session",
            "candidate",
            "candidate_branch",
            "full_replay_session",
            "candidate",
            "candidate_branch",
            "full_replay_session",
            "candidate",
            "candidate_branch",
            "full_replay_session",
            "promotion",
        ],
    );
    assert.deepEqual(manifest.costs, {
        cache_creation_input_tokens: 19,
        cache_read_input_tokens: 42,
        cost_usd: 9.5,
        input_tokens: 190,
        output_tokens: 38,
        provider_calls: 19,
    });
    assert.equal(inspection.manifest?.manifest_id, manifest.manifest_id);
    assert.match(inspection.cut_id as string, /^application-cut:sha256:[0-9a-f]{64}$/u);
    // Inspection and lineage are identical on reopened read-only and imported stores.
    using readOnly = new SQLiteTraceStore(databasePath, { readOnly: true });
    assert.deepEqual(inspectCounterfactualOptimization(readOnly, applicationId), inspection);
    using imported = new SQLiteTraceStore();
    imported.importTrace(store.exportTrace());
    assert.deepEqual(inspectCounterfactualOptimization(imported, applicationId), inspection);
    // Repeating the command returns the retained manifest without replaying or evaluating.
    const calls = [base, stronger, unused, refined].map((provider) => provider.calls.length);
    const repeated = await runCounterfactualOptimization(store, {
        ...options,
        evaluate: () => {
            throw new Error("the retained run must not evaluate again");
        },
    });
    assert.deepEqual(repeated.manifest, manifest);
    assert.deepEqual(repeated.inspection, inspection);
    assert.deepEqual(
        [base, stronger, unused, refined].map((provider) => provider.calls.length),
        calls,
    );
    assert.equal(store.verifyIntegrity().ok, true);
});

test("task edits replay the suffix under the replacement task and the higher later score is promoted", async () => {
    using store = new SQLiteTraceStore();
    const provider = keyedProvider("base", { costUsd: null });
    const concise = draftTask("2", "Draft a concise version.");
    const detailed = draftTask("3", "Draft a detailed version.");
    const { inspection, manifest } = await runCounterfactualOptimization(store, {
        ...optimizerOptions("application:cro:task"),
        baseline: {
            program: taskProgram,
            programId: "workflow:task.v1",
            provider,
            task: draftTask("1", "Draft the plan."),
        },
        candidates: [
            { changes: ["task"], name: "concise", stepIndex: 0, task: concise },
            { changes: ["task"], name: "detailed", stepIndex: 0, task: detailed },
        ],
        evaluate: scriptedEvaluator({ concise: pass(1), detailed: pass(4) }),
    });
    const [first, second] = inspection.candidates;
    assert.equal(first?.outcome?.target.step_index, 1);
    assert.deepEqual(first?.outcome?.affected_steps, [1, 2]);
    const branch = inspectReplaySession(store, {
        sessionId: first?.outcome?.branch_session_id as string,
    });
    assert.equal(branch.steps[1]?.provider?.request.instruction, "Draft a concise version.");
    assert.deepEqual(first?.outcome?.changes, ["task"]);
    assert.equal(first?.outcome?.baseline, null);
    assert.equal(inspection.promotion?.candidate_id, second?.candidate_id);
    assert.equal(manifest.costs.cost_usd, null);
    assert.equal(manifest.costs.provider_calls, 7);
    assert.deepEqual(
        manifest.artifacts.map((artifact) => artifact.role),
        [
            "baseline_session",
            "candidate",
            "candidate_branch",
            "candidate",
            "candidate_branch",
            "promotion",
        ],
    );
});

test("no candidate is promoted when none passes the gate and reaches the promotion threshold", async () => {
    using store = new SQLiteTraceStore();
    const evaluate = scriptedEvaluator({ gated: fail(5), "below-threshold": pass(0) });
    const { inspection, manifest } = await runCounterfactualOptimization(store, {
        ...optimizerOptions("application:cro:none"),
        candidates: [
            providerCandidate("gated", 0, keyedProvider("gated")),
            providerCandidate("below-threshold", 2, keyedProvider("other")),
        ],
        evaluate,
    });
    // A failed gate is rejected and a passing score below the threshold stays evaluated; neither is promoted.
    assert.equal(inspection.candidates[0]?.outcome?.status, "rejected");
    assert.equal(inspection.candidates[1]?.outcome?.status, "evaluated");
    assert.equal(inspection.promotion, null);
    assert.equal(
        manifest.artifacts.some((artifact) => artifact.role === "promotion"),
        false,
    );
    assert.equal(
        counterfactualProtocol().budgets.minPromotionScore,
        1,
        "the repository gate threshold is the configured minimum promotion score",
    );
});
