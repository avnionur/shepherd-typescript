import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
    analyzeReplayDivergence,
    type CounterfactualCandidateRecord,
    type CounterfactualExampleResult,
    deriveApplicationOwnerId,
    inspectCounterfactualOptimization,
    inspectReplaySession,
    type ReplaySessionInspection,
    runCounterfactualOptimization,
    SQLiteTraceStore,
} from "../../src/index.ts";
import {
    applyFixtureEdit,
    counterfactualProtocolWith,
    draftTask,
    labelMetric,
    optimizerOptions,
    providerEdit,
    providerRegistry,
    reflection,
    scriptedProposer,
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

function resultsOf(candidate: CounterfactualCandidateRecord): CounterfactualExampleResult[] {
    return [...candidate.targeted, ...(candidate.dev ?? []), ...(candidate.train ?? [])];
}

const SCORES = {
    base: { "dev-1": 0, "dev-2": 1, "train-1": 0, "train-2": 0, "train-3": 1, "train-4": 0 },
    replanned: { "dev-1": 1, "dev-2": 1, "train-1": 1, "train-2": 1, "train-3": 1, "train-4": 0 },
    reresearched: { "train-3": 1 },
    reviewed: { "dev-1": 1, "dev-2": 0, "train-1": 1, "train-4": 1 },
};

test("Algorithm 1: per-example baselines, N iterations of k edits, the fix/guard gate, dev promotion into a graduate-only pool, and dev selection", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-cro-algorithm-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const databasePath = path.join(directory, "trace.sqlite");
    using store = new SQLiteTraceStore(databasePath);
    const registry = providerRegistry();
    const metric = labelMetric(SCORES);
    const proposer = scriptedProposer([
        [
            {
                edits: [
                    providerEdit("replan", 0, "replanned", {
                        fix_set: ["train-1", "train-2"],
                        guard_set: ["train-3"],
                        mechanism: "replan the draft from a stronger plan",
                    }),
                    providerEdit("reresearch", 1, "reresearched", {
                        fix_set: ["train-1"],
                        guard_set: ["train-2"],
                        mechanism: "re-execute the independent research",
                        prior: 0.5,
                    }),
                ],
                parent: null,
                reflection: reflection(null),
            },
        ],
        [
            {
                edits: [
                    providerEdit("rereview", 3, "reviewed", {
                        fix_set: ["train-4"],
                        guard_set: ["train-1"],
                        mechanism: "re-review the draft with a stricter reviewer",
                        prior: 0.15,
                    }),
                ],
                parent: "replan",
                reflection: reflection("replan", ["reresearch never reached the review"]),
            },
        ],
    ]);
    const options = optimizerOptions(
        "application:cro:algorithm",
        {
            clock: () => 5_000,
            metric,
            proposer,
            protocol: counterfactualProtocolWith({ iterations: 2 }),
        },
        registry,
    );
    const { handoff, inspection, manifest } = await runCounterfactualOptimization(store, options);
    const applicationId = deriveApplicationOwnerId("application:cro:algorithm");
    assert.equal(inspection.application_id, applicationId);
    // Line 4: W0 runs once over every train and dev example and each session is scored.
    assert.deepEqual(
        inspection.examples.map((example) => [example.example_id, example.split, example.score]),
        [
            ["train-1", "train", 0],
            ["train-2", "train", 0],
            ["train-3", "train", 1],
            ["train-4", "train", 0],
            ["dev-1", "dev", 0],
            ["dev-2", "dev", 1],
        ],
    );
    for (const example of inspection.examples) {
        const session = inspectReplaySession(store, { sessionId: example.session_id });
        assert.equal(session.steps.length, 4);
        assert.equal(session.terminal?.status, "finished");
    }
    // Lines 6-8: two proposer iterations, each reading the run and the graduate-only pool.
    assert.deepEqual(
        proposer.contexts.map((entry) => [
            entry.iteration,
            entry.attempt,
            entry.capacity,
            entry.pool.map((member) => [member.name, member.dev_score]),
            entry.inspection.candidates.length,
        ]),
        [
            [0, 0, 2, [[null, 0.5]], 0],
            [
                1,
                0,
                2,
                [
                    [null, 0.5],
                    ["replan", 1],
                ],
                2,
            ],
        ],
    );
    assert.equal(inspection.proposals.length, 2);
    assert.deepEqual(
        inspection.proposals.map((proposal) => [
            proposal.iteration,
            proposal.attempts,
            proposal.refusals,
            proposal.proposer_session_ids,
            proposal.candidates.map((plan) => plan.name),
        ]),
        [
            [0, 1, [], [], ["replan", "reresearch"]],
            [1, 1, [], [], ["rereview"]],
        ],
    );
    const [replan, reresearch, rereview] = inspection.candidates;
    assert.ok(replan && reresearch && rereview);
    assert.equal(inspection.proposals[1]?.parent_candidate_id, replan.candidate_id);
    // Lines 11-13: each fix and guard example forks the parent's session at the first affected
    // event: a request edit of step 0 replays from boundary zero.
    assert.deepEqual(
        replan.targeted.map((result) => [result.example_id, result.role, result.score]),
        [
            ["train-1", "fix", 1],
            ["train-2", "fix", 1],
            ["train-3", "guard", 1],
        ],
    );
    for (const result of replan.targeted) {
        const source = inspection.examples.find(
            (example) => example.example_id === result.example_id,
        );
        assert.deepEqual(result.target, {
            prefix_id: null,
            source_session_id: source?.session_id,
            step_index: 0,
        });
        assert.equal(result.parent_score, source?.score);
        assert.deepEqual(result.affected_steps, [2, 3]);
        assert.equal(result.divergence.live_steps, 4);
        assert.equal(result.divergence.recorded_steps, 0);
    }
    // Line 15: the gate applies the configured fractional thresholds.
    assert.equal(replan.gate?.passed, true);
    assert.equal(replan.gate?.improve_fraction, 1);
    assert.equal(replan.gate?.max_guard_drop, 0);
    assert.equal(replan.gate?.aggregate_lift, 1 - 1 / 3);
    assert.equal(reresearch.status, "archived");
    assert.equal(reresearch.gate?.passed, false);
    assert.match(reresearch.gate?.reason as string, /improved fix fraction 0 is below 0\.67/u);
    assert.equal(reresearch.dev, null);
    assert.equal(reresearch.dev_score, null);
    // Line 16: the graduate is scored on every dev example and promoted within epsilon; a promoted
    // candidate is also replayed on the remaining train examples so children can fork it.
    assert.equal(replan.status, "promoted");
    assert.deepEqual(
        replan.dev?.map((result) => [result.example_id, result.role, result.score]),
        [
            ["dev-1", "dev", 1],
            ["dev-2", "dev", 1],
        ],
    );
    assert.equal(replan.dev_score, 1);
    assert.equal(replan.promotion_reference, 0.5);
    assert.deepEqual(
        replan.train?.map((result) => [result.example_id, result.role]),
        [["train-4", "train"]],
    );
    // The child forks the promoted parent's session on each example: only the review runs live.
    assert.equal(rereview.parent_candidate_id, replan.candidate_id);
    for (const result of resultsOf(rereview)) {
        const parentResult: CounterfactualExampleResult | undefined = resultsOf(replan).find(
            (entry) => entry.example_id === result.example_id,
        );
        assert.equal(result.target.source_session_id, parentResult?.session_id);
        assert.equal(result.parent_score, parentResult?.score);
        assert.equal(result.target.step_index, 3);
        assert.equal(result.divergence.live_steps, 1);
        assert.equal(result.divergence.recorded_steps, 3);
    }
    // A graduate whose dev score is not within epsilon of the promoted parent stays evaluated and
    // never joins the pool.
    assert.equal(rereview.status, "evaluated");
    assert.equal(rereview.dev_score, 0.5);
    assert.equal(rereview.promotion_reference, 1);
    assert.equal(rereview.train, null);
    assert.deepEqual(
        inspection.pool.map((member) => member.name),
        [null, "replan"],
    );
    // Line 21: the pool member with the highest dev score is selected.
    assert.deepEqual(
        { ...inspection.selection, record_id: null },
        {
            dev_score: 1,
            pool: [replan.candidate_id],
            record_id: null,
            selected_candidate_id: replan.candidate_id,
        },
    );
    assert.deepEqual(handoff, {
        candidates: [
            {
                candidate_id: replan.candidate_id,
                parent_candidate_id: null,
                status: "promoted",
            },
            {
                candidate_id: reresearch.candidate_id,
                parent_candidate_id: null,
                status: "archived",
            },
            {
                candidate_id: rereview.candidate_id,
                parent_candidate_id: replan.candidate_id,
                status: "evaluated",
            },
        ],
        selected_candidate_id: replan.candidate_id,
    });
    // The metric saw every baseline and branch session exactly once.
    assert.equal(metric.contexts.length, 6 + 6 + 2 + 4);
    // Per proposer session computation reuse, retained in the manifest.
    assert.deepEqual(inspection.computation_reuse, [
        { live_steps: 30, recorded_steps: 2, reuse_ratio: 2 / 32, session_index: 0 },
        { live_steps: 4, recorded_steps: 12, reuse_ratio: 0.75, session_index: 1 },
    ]);
    assert.deepEqual(manifest.computation_reuse, inspection.computation_reuse);
    assert.deepEqual(manifest.thresholds, counterfactualProtocolWith({}).thresholds);
    assert.deepEqual(
        manifest.artifacts.map((artifact) => artifact.role),
        ["baseline", "proposal", "candidate", "candidate", "proposal", "candidate", "selection"],
    );
    assert.equal(manifest.costs.provider_calls, 24 + 24 + 6 + 4);
    assert.equal(inspection.manifest?.manifest_id, manifest.manifest_id);
    // Inspection is identical on reopened read-only and imported stores.
    using readOnly = new SQLiteTraceStore(databasePath, { readOnly: true });
    assert.deepEqual(inspectCounterfactualOptimization(readOnly, applicationId), inspection);
    using imported = new SQLiteTraceStore();
    imported.importTrace(store.exportTrace());
    assert.deepEqual(inspectCounterfactualOptimization(imported, applicationId), inspection);
    // Repeating the command returns the retained manifest without proposing, scoring, or replaying.
    const calls = [...registry.providers.values()].map((provider) => provider.calls.length);
    const repeated = await runCounterfactualOptimization(store, {
        ...options,
        metric: () => {
            throw new Error("the retained run must not score again");
        },
        proposer: () => {
            throw new Error("the retained run must not propose again");
        },
    });
    assert.deepEqual(repeated.manifest, manifest);
    assert.deepEqual(repeated.inspection, inspection);
    assert.deepEqual(
        [...registry.providers.values()].map((provider) => provider.calls.length),
        calls,
    );
    assert.equal(store.verifyIntegrity().ok, true);
});

test("request edits replay from the edited step, downstream edits from the first dependent, and full replay is measured per example", async () => {
    using store = new SQLiteTraceStore();
    const registry = providerRegistry({ base: { cacheRead: 3 }, stronger: { cacheRead: 5 } });
    const proposer = scriptedProposer([
        [
            {
                edits: [
                    providerEdit("stronger-plan", 0, "stronger", { scope: "downstream" }),
                    providerEdit("research-request", 1, "unused"),
                    providerEdit("revise-review", 3, "revised"),
                    providerEdit("consume-review", 3, "consumer", { scope: "downstream" }),
                    providerEdit("replan", 0, "replanned"),
                ],
                parent: null,
                reflection: reflection(null),
            },
        ],
    ]);
    const { inspection } = await runCounterfactualOptimization(
        store,
        optimizerOptions(
            "application:cro:targets",
            {
                baselines: ["full_replay"],
                proposer,
                protocol: counterfactualProtocolWith({
                    maxCandidates: 5,
                    maxProviderCalls: 128,
                    proposalsPerIteration: 5,
                }),
            },
            registry,
        ),
    );
    const baseline = inspectReplaySession(store, {
        sessionId: inspection.examples[0]?.session_id as string,
    });
    const [stronger, research, revise, consume, replan] = inspection.candidates.map(
        (candidate) => candidate.targeted[0] as CounterfactualExampleResult,
    );
    assert.ok(stronger && research && revise && consume && replan);
    // Nothing improves, so every candidate is archived after its single targeted replay.
    assert.deepEqual(
        inspection.candidates.map((candidate) => [candidate.edit_scope, candidate.status]),
        [
            ["downstream", "archived"],
            ["request", "archived"],
            ["request", "archived"],
            ["downstream", "archived"],
            ["request", "archived"],
        ],
    );
    // A downstream edit at the plan affects the draft and the review: steps 0 and 1 are served.
    assert.deepEqual(stronger.affected_steps, [2, 3]);
    assert.deepEqual(stronger.target, {
        prefix_id: baseline.steps[1]?.prefix_id,
        source_session_id: baseline.session_id,
        step_index: 2,
    });
    assert.deepEqual(stronger.divergence, {
        common_prefix_id: baseline.steps[1]?.prefix_id,
        first_divergence_index: 2,
        live_steps: 2,
        recorded_steps: 2,
        unexplained: [],
    });
    assert.deepEqual(
        analyzeReplayDivergence(store, {
            replaySessionId: stronger.session_id,
            sourceSessionId: baseline.session_id,
        }).steps.map((step) => step.cause),
        [null, null, "root", "propagated"],
    );
    // A request edit re-executes the edited step even though nothing depends on it.
    assert.deepEqual(research.affected_steps, []);
    assert.equal(research.target.step_index, 1);
    assert.deepEqual(
        analyzeReplayDivergence(store, {
            replaySessionId: research.session_id,
            sourceSessionId: baseline.session_id,
        }).steps.map((step) => step.cause),
        [null, "root", "root", "propagated"],
    );
    // A final-step request edit replays exactly one live step; a downstream one replays nothing.
    assert.equal(revise.target.step_index, 3);
    assert.equal(revise.divergence.live_steps, 1);
    assert.equal(consume.target.step_index, 4);
    assert.equal(consume.divergence.live_steps, 0);
    // A first-step request edit replays from boundary zero with a null target prefix.
    assert.deepEqual(replan.target, {
        prefix_id: null,
        source_session_id: baseline.session_id,
        step_index: 0,
    });
    assert.deepEqual(
        analyzeReplayDivergence(store, {
            replaySessionId: replan.session_id,
            sourceSessionId: baseline.session_id,
        }).steps.map((step) => step.cause),
        ["root", "root", "propagated", "propagated"],
    );
    // Measured full-replay comparison of each example branch.
    for (const result of [stronger, research, revise, consume, replan]) {
        const branch = inspectReplaySession(store, { sessionId: result.session_id });
        const full = inspectReplaySession(store, {
            sessionId: result.baseline?.session_id as string,
        });
        assert.equal(full.origin?.target_step_count, 0);
        assert.equal(result.cost.provider_calls, liveProviderCalls(branch));
        assert.equal(result.cost.cache_read_input_tokens, cacheReads(branch));
        assert.equal(result.baseline?.provider_calls, liveProviderCalls(full));
        assert.equal(result.baseline?.cache_read_input_tokens, cacheReads(full));
        assert.equal(result.baseline?.kind, "full_replay");
    }
    assert.deepEqual(
        [stronger, research, revise, consume, replan].map((result) => [
            result.cost.provider_calls,
            result.baseline?.provider_calls,
        ]),
        [
            [2, 4],
            [3, 4],
            [1, 4],
            [0, 4],
            [4, 4],
        ],
    );
    assert.deepEqual(stronger.cost.cache_read_input_tokens, 10);
    assert.deepEqual(registry.get("revised").calls, [
        "review",
        "plan",
        "research",
        "draft",
        "review",
    ]);
    // Nothing was promoted, so the baseline is selected.
    assert.equal(inspection.selection?.selected_candidate_id, null);
    assert.equal(inspection.selection?.dev_score, 0);
    assert.deepEqual(
        inspection.pool.map((member) => member.name),
        [null],
    );
});

test("task edits replay the suffix under the replacement task factory", async () => {
    using store = new SQLiteTraceStore();
    const registry = providerRegistry({ base: { costUsd: null } });
    const proposer = scriptedProposer([
        [
            {
                edits: [
                    {
                        changes: ["task"],
                        fix_set: ["train-1"],
                        guard_set: ["train-2"],
                        mechanism: "draft a concise version",
                        name: "concise",
                        patch: { instruction: "Draft a concise version.", version: "2" },
                        prior: 0.1,
                        rationale: "shorter drafts review better",
                        scope: "downstream",
                        step_index: 0,
                    },
                ],
                parent: null,
                reflection: reflection(null),
            },
        ],
    ]);
    const { inspection, manifest } = await runCounterfactualOptimization(
        store,
        optimizerOptions(
            "application:cro:task",
            {
                applyEdit: applyFixtureEdit(registry),
                baseline: {
                    program: () => taskProgram,
                    programId: "workflow:task.v1",
                    provider: registry.get("base"),
                    task: () => draftTask("1", "Draft the plan."),
                },
                proposer,
            },
            registry,
        ),
    );
    const [concise] = inspection.candidates;
    const result = concise?.targeted[0];
    assert.equal(result?.target.step_index, 1);
    assert.deepEqual(result?.affected_steps, [1, 2]);
    const branch = inspectReplaySession(store, { sessionId: result?.session_id as string });
    assert.equal(branch.steps[1]?.provider?.request.instruction, "Draft a concise version.");
    assert.deepEqual(concise?.changes, ["task"]);
    assert.equal(result?.baseline, null);
    assert.equal(manifest.costs.cost_usd, null);
});

test("fractional thresholds gate and promote: the improve fraction, the minimum promotion score, and the dev epsilon", async () => {
    const scores = {
        base: { "dev-1": 0, "dev-2": 1, "train-1": 0, "train-2": 0, "train-3": 1, "train-4": 0 },
        partial: { "dev-1": 1, "dev-2": 0, "train-1": 1, "train-2": 1, "train-3": 1 },
    };
    const run = async (commandId: string, thresholds: Record<string, number>) => {
        using store = new SQLiteTraceStore();
        const proposer = scriptedProposer([
            [
                {
                    edits: [
                        providerEdit("partial", 0, "partial", {
                            fix_set: ["train-1", "train-2", "train-4"],
                            guard_set: ["train-3"],
                        }),
                    ],
                    parent: null,
                    reflection: reflection(null),
                },
            ],
        ]);
        return (
            await runCounterfactualOptimization(
                store,
                optimizerOptions(commandId, {
                    metric: labelMetric(scores),
                    proposer,
                    protocol: counterfactualProtocolWith({ iterations: 1 }, thresholds),
                }),
            )
        ).inspection.candidates[0] as CounterfactualCandidateRecord;
    };
    // Two of three fix examples improve: 2/3 is below the configured 0.67.
    const strict = await run("application:cro:fraction:strict", {});
    assert.equal(strict.status, "archived");
    assert.equal(strict.gate?.improve_fraction, 2 / 3);
    // With a 0.6 improve threshold the candidate graduates; its dev score 0.5 equals the baseline
    // dev score and reaches the fractional minimum 0.5, so it is promoted.
    const graduated = await run("application:cro:fraction:graduated", {
        targetedImproveThreshold: 0.6,
    });
    assert.equal(graduated.status, "promoted");
    assert.equal(graduated.dev_score, 0.5);
    // A fractional minimum promotion score above the dev score keeps it evaluated.
    const below = await run("application:cro:fraction:below", {
        minPromotionScore: 0.75,
        targetedImproveThreshold: 0.6,
    });
    assert.equal(below.status, "evaluated");
    // A negative guard lift beyond the configured drop archives the candidate.
    const dropped = await run("application:cro:fraction:drop", {
        targetedImproveThreshold: 0.6,
        targetedMaxScoreDrop: -0.5,
    });
    assert.equal(dropped.status, "archived");
    assert.match(dropped.gate?.reason as string, /guard drop 0 exceeds -0\.5/u);
});

test("a graduate outside the promotion epsilon is never offered or admitted as a parent", async () => {
    using store = new SQLiteTraceStore();
    const scores = {
        base: { "dev-1": 0, "dev-2": 1, "train-1": 0 },
        good: { "dev-1": 1, "dev-2": 1, "train-1": 1 },
        weak: { "train-1": 1, "train-2": 1 },
    };
    const proposer = scriptedProposer([
        [
            {
                edits: [
                    providerEdit("good", 0, "good"),
                    providerEdit("weak", 0, "weak", { mechanism: "a weak edit" }),
                ],
                parent: null,
                reflection: reflection(null),
            },
        ],
        [
            // The evaluated graduate is not in the pool.
            {
                edits: [providerEdit("child-of-weak", 3, "good")],
                parent: "weak",
                reflection: reflection("weak", ["weak and good both graduated"]),
            },
            {
                edits: [providerEdit("child-of-good", 3, "good")],
                parent: "good",
                reflection: reflection("good", ["weak and good both graduated"]),
            },
        ],
    ]);
    const { inspection } = await runCounterfactualOptimization(
        store,
        optimizerOptions("application:cro:pool", {
            metric: labelMetric(scores),
            proposer,
            protocol: counterfactualProtocolWith({ iterations: 2 }),
        }),
    );
    const [good, weak] = inspection.candidates;
    assert.equal(good?.status, "promoted");
    assert.equal(weak?.status, "evaluated");
    assert.equal(weak?.dev_score, 0);
    assert.equal(weak?.promotion_reference, 1);
    assert.deepEqual(
        proposer.contexts[1]?.pool.map((member) => member.name),
        [null, "good"],
    );
    const second = inspection.proposals[1];
    assert.equal(second?.attempts, 2);
    assert.equal(second?.refusals.length, 1);
    assert.match(second?.refusals[0] as string, /parent weak is not in the parent pool/u);
    assert.equal(second?.parent_candidate_id, good?.candidate_id);
    assert.equal(proposer.contexts[2]?.feedback.length, 1);
});

test("selection keeps the highest dev score over a later promoted member within epsilon", async () => {
    using store = new SQLiteTraceStore();
    const { inspection } = await runCounterfactualOptimization(
        store,
        optimizerOptions("application:cro:selection", {
            metric: labelMetric({
                best: { "dev-1": 1, "dev-2": 1, "train-1": 1 },
                close: { "dev-1": 1, "dev-2": 0.95, "train-1": 1 },
            }),
            proposer: scriptedProposer([
                [
                    {
                        edits: [providerEdit("best", 0, "best"), providerEdit("close", 0, "close")],
                        parent: null,
                        reflection: reflection(null),
                    },
                ],
            ]),
        }),
    );
    const [best, close] = inspection.candidates;
    assert.equal(best?.status, "promoted");
    assert.equal(close?.status, "promoted");
    assert.equal(close?.promotion_reference, 1);
    assert.equal(inspection.selection?.selected_candidate_id, best?.candidate_id);
    assert.deepEqual(inspection.selection?.pool, [best?.candidate_id, close?.candidate_id]);
});
