import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import {
    analyzeReplayDivergence,
    diffReplaySessions,
    findFirstReplayRegression,
    REPLAY_REGRESSION_STRATEGIES,
    ReplayEvidenceError,
    type ReplayRevision,
    rewindReplaySession,
    runReplaySession,
    SQLiteTraceStore,
} from "../../src/index.ts";
import {
    recordLineageRoot as recordRoot,
    lineageRollout as rollout,
    temporaryDirectory,
} from "./fixtures.ts";

function providerText(revision: ReplayRevision): readonly string[] {
    return revision.steps.flatMap((step) =>
        step.provider?.response === null || step.provider === null
            ? []
            : [(step.provider.response.output as { readonly text: string }).text],
    );
}

test("N-way diff resolves sibling rollouts to their common source and tables captured effects", async (context) => {
    const directory = await temporaryDirectory(context, "lineage-diff");
    using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    const root = await recordRoot(store, "lineage:root");
    const same = await rollout(store, root.session_id, "lineage:rollout:same", "final");
    const alpha = await rollout(store, root.session_id, "lineage:rollout:alpha", "alpha");
    const beta = await rollout(store, root.session_id, "lineage:rollout:beta", "beta");

    assert.throws(
        () =>
            analyzeReplayDivergence(store, {
                replaySessionId: beta.session_id,
                sourceSessionId: alpha.session_id,
            }),
        ReplayEvidenceError,
    );
    const diff = diffReplaySessions(store, {
        sessionIds: [alpha.session_id, beta.session_id, same.session_id],
    });
    assert.equal(diff.ancestor_session_id, root.session_id);
    assert.equal(diff.base_step_count, 2);
    assert.equal(diff.base_prefix_id, root.steps[1]?.prefix_id);
    assert.deepEqual(diff.session_ids, [alpha.session_id, beta.session_id, same.session_id]);
    assert.deepEqual(
        diff.branches.map((branch) => [
            branch.lineage,
            branch.first_divergence_index,
            branch.steps.map((step) => [step.index, step.kind, step.status]),
        ]),
        [
            [
                [root.session_id, alpha.session_id],
                2,
                [
                    [2, "provider", "diverged"],
                    [3, "effect", "diverged"],
                ],
            ],
            [
                [root.session_id, beta.session_id],
                2,
                [
                    [2, "provider", "diverged"],
                    [3, "effect", "diverged"],
                ],
            ],
            [
                [root.session_id, same.session_id],
                null,
                [
                    [2, "provider", "identical"],
                    [3, "effect", "identical"],
                ],
            ],
        ],
    );
    assert.deepEqual(
        diff.effects.map((effect) => [
            effect.effect_id,
            effect.effect_kind,
            effect.disposition,
            effect.session_ids,
            effect.in_ancestor,
        ]),
        [
            ["effect:publish", "record", "materialized", [alpha.session_id], false],
            ["effect:publish", "record", "materialized", [beta.session_id], false],
            ["effect:publish", "record", "materialized", [same.session_id], true],
        ],
    );
    assert.deepEqual(
        diff.branches[0]?.effects.map((effect) => [effect.index, effect.step_id]),
        [[3, alpha.steps[3]?.step_id]],
    );
    assert.equal(Object.isFrozen(diff), true);
    assert.equal(Object.isFrozen(diff.effects[0]?.session_ids), true);

    const withSource = diffReplaySessions(store, {
        sessionIds: [root.session_id, alpha.session_id],
    });
    assert.equal(withSource.ancestor_session_id, root.session_id);
    assert.equal(withSource.base_step_count, 2);
    assert.equal(withSource.branches[0]?.first_divergence_index, null);
    assert.deepEqual(
        withSource.effects.map((effect) => [effect.session_ids, effect.in_ancestor]),
        [
            [[root.session_id], true],
            [[alpha.session_id], false],
        ],
    );
});

test("N-way diff crosses nested lineage and reports no ancestor for unrelated roots", async (context) => {
    const directory = await temporaryDirectory(context, "lineage-nested");
    using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    const root = await recordRoot(store, "lineage:root");
    const alpha = await rollout(store, root.session_id, "lineage:rollout:alpha", "alpha");
    const grandchild = await rollout(
        store,
        alpha.session_id,
        "lineage:rollout:alpha:again",
        "alpha",
        3,
    );
    const beta = await rollout(store, root.session_id, "lineage:rollout:beta", "beta");
    const nested = diffReplaySessions(store, {
        sessionIds: [grandchild.session_id, beta.session_id],
    });
    assert.equal(nested.ancestor_session_id, root.session_id);
    assert.deepEqual(nested.branches[0]?.lineage, [
        root.session_id,
        alpha.session_id,
        grandchild.session_id,
    ]);
    assert.equal(nested.base_step_count, 2);
    const cousins = diffReplaySessions(store, {
        sessionIds: [grandchild.session_id, alpha.session_id],
    });
    assert.equal(cousins.ancestor_session_id, alpha.session_id);
    assert.equal(cousins.base_step_count, 4);
    assert.deepEqual(cousins.effects, []);
    const { inspection: rewound } = await rewindReplaySession(store, {
        claimId: "operator",
        commandId: "lineage:rewind",
        sourceSessionId: root.session_id,
        target: { stepCount: 2 },
    });
    const truncated = diffReplaySessions(store, {
        sessionIds: [rewound.session_id, root.session_id],
    });
    assert.equal(truncated.ancestor_session_id, root.session_id);
    assert.equal(truncated.base_step_count, 2);
    assert.deepEqual(
        truncated.branches[0]?.steps.map((step) => [step.index, step.kind, step.status]),
        [
            [2, "provider", "source_only"],
            [3, "effect", "source_only"],
        ],
    );
    assert.deepEqual(truncated.branches[0]?.effects, []);
    assert.deepEqual(
        truncated.effects.map((effect) => [effect.session_ids, effect.in_ancestor]),
        [[[root.session_id], true]],
    );

    const other = await recordRoot(store, "lineage:other", "other");
    const unrelated = diffReplaySessions(store, {
        sessionIds: [root.session_id, other.session_id],
    });
    assert.equal(unrelated.ancestor_session_id, null);
    assert.equal(unrelated.base_step_count, 0);
    assert.equal(unrelated.base_prefix_id, null);
    assert.deepEqual(
        unrelated.branches.map((branch) => branch.steps.map((step) => step.status)),
        [
            ["replay_only", "replay_only", "replay_only", "replay_only"],
            ["replay_only", "replay_only", "replay_only", "replay_only"],
        ],
    );
    assert.deepEqual(
        unrelated.effects.map((effect) => [effect.effect_id, effect.session_ids.length]),
        [
            ["effect:draft", 2],
            ["effect:publish", 1],
            ["effect:publish", 1],
        ],
    );
});

test("N-way diff refuses malformed, repeated, oversized, and absent session sets", async (context) => {
    const directory = await temporaryDirectory(context, "lineage-refusals");
    using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    const root = await recordRoot(store, "lineage:root");
    assert.throws(() => diffReplaySessions(store, { sessionIds: [root.session_id] }), TypeError);
    assert.throws(
        () => diffReplaySessions(store, { sessionIds: [root.session_id, root.session_id] }),
        /distinct/u,
    );
    assert.throws(
        () =>
            diffReplaySessions(store, {
                sessionIds: Array.from({ length: 17 }, (_, index) => `session:${index}`),
            }),
        /between 2 and 16/u,
    );
    assert.throws(
        () => diffReplaySessions(store, { sessionIds: [root.session_id, ""] }),
        TypeError,
    );
    assert.throws(
        () =>
            diffReplaySessions(store, {
                extra: true,
                sessionIds: [root.session_id, "x"],
            } as never),
        TypeError,
    );
    assert.throws(
        () => diffReplaySessions(store, { clock: 1, sessionIds: ["a", "b"] } as never),
        /clock/u,
    );
    assert.throws(
        () => diffReplaySessions(store, { sessionIds: [root.session_id, "session:absent"] }),
        ReplayEvidenceError,
    );
});

test("first-regression search bisects or walks a lineage deterministically and attributes revisions", async (context) => {
    const directory = await temporaryDirectory(context, "lineage-regression");
    using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    const root = await recordRoot(store, "lineage:root");
    const alpha = await rollout(store, root.session_id, "lineage:rollout:alpha", "alpha");
    const grandchild = await rollout(
        store,
        alpha.session_id,
        "lineage:rollout:alpha:again",
        "alpha",
        3,
    );
    assert.deepEqual(REPLAY_REGRESSION_STRATEGIES, ["bisect", "linear"]);
    const seen: number[] = [];
    const verdict = (revision: ReplayRevision) => {
        seen.push(revision.step_count);
        assert.equal(revision.steps.length, revision.step_count);
        return !providerText(revision).includes("alpha");
    };
    const bisected = await findFirstReplayRegression(store, {
        clock: () => 1,
        sessionId: grandchild.session_id,
        verdict,
    });
    assert.equal(bisected.strategy, "bisect");
    assert.deepEqual(bisected.lineage, [root.session_id, alpha.session_id, grandchild.session_id]);
    assert.deepEqual(
        bisected.evaluations.map(({ good, step_count }) => [step_count, good]),
        [
            [4, false],
            [0, true],
            [2, true],
            [3, false],
        ],
    );
    assert.deepEqual(bisected.first_bad, {
        prefix_id: grandchild.steps[2]?.prefix_id,
        session_id: alpha.session_id,
        step_count: 3,
    });
    assert.deepEqual(bisected.last_good, {
        prefix_id: grandchild.steps[1]?.prefix_id,
        session_id: root.session_id,
        step_count: 2,
    });
    const linear = await findFirstReplayRegression(store, {
        sessionId: grandchild.session_id,
        strategy: "linear",
        verdict,
    });
    assert.deepEqual(linear.first_bad, bisected.first_bad);
    assert.deepEqual(
        linear.evaluations.map(({ step_count }) => step_count),
        [0, 1, 2, 3],
    );
    assert.deepEqual(seen, [4, 0, 2, 3, 0, 1, 2, 3]);

    const clean = await findFirstReplayRegression(store, {
        sessionId: root.session_id,
        verdict: () => true,
    });
    assert.equal(clean.first_bad, null);
    assert.deepEqual(clean.last_good, {
        prefix_id: root.steps[3]?.prefix_id,
        session_id: root.session_id,
        step_count: 4,
    });
    const cleanLinear = await findFirstReplayRegression(store, {
        sessionId: root.session_id,
        strategy: "linear",
        verdict: async () => true,
    });
    assert.equal(cleanLinear.evaluations.length, 5);
    assert.equal(cleanLinear.first_bad, null);
    const broken = await findFirstReplayRegression(store, {
        sessionId: grandchild.session_id,
        verdict: () => false,
    });
    assert.deepEqual(
        broken.evaluations.map(({ step_count }) => step_count),
        [4, 0],
    );
    assert.deepEqual(broken.first_bad, {
        prefix_id: null,
        session_id: grandchild.session_id,
        step_count: 0,
    });
    assert.equal(broken.last_good, null);
    const { inspection: empty } = await runReplaySession(store, {
        claimId: "worker",
        commandId: "lineage:empty",
        program: () => null,
        programId: "program:empty.v1",
    });
    const emptySearch = await findFirstReplayRegression(store, {
        sessionId: empty.session_id,
        verdict: () => false,
    });
    assert.deepEqual(emptySearch.evaluations, [{ good: false, step_count: 0 }]);
    assert.equal(emptySearch.first_bad?.step_count, 0);
    const brokenLinear = await findFirstReplayRegression(store, {
        sessionId: grandchild.session_id,
        strategy: "linear",
        verdict: () => false,
    });
    assert.equal(brokenLinear.first_bad?.step_count, 0);
    assert.equal(brokenLinear.last_good, null);
});

test("first-regression search refuses malformed options and non-boolean verdicts", async (context) => {
    const directory = await temporaryDirectory(context, "lineage-regression-refusals");
    using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    const root = await recordRoot(store, "lineage:root");
    await assert.rejects(
        findFirstReplayRegression(store, { sessionId: root.session_id, verdict: 1 } as never),
        /verdict must be a function/u,
    );
    await assert.rejects(
        findFirstReplayRegression(store, {
            sessionId: root.session_id,
            strategy: "random" as never,
            verdict: () => true,
        }),
        /configured regression strategy/u,
    );
    await assert.rejects(
        findFirstReplayRegression(store, {
            sessionId: root.session_id,
            verdict: () => "yes" as never,
        }),
        /verdict must return a boolean/u,
    );
    await assert.rejects(
        findFirstReplayRegression(store, { sessionId: "", verdict: () => true }),
        TypeError,
    );
    await assert.rejects(
        findFirstReplayRegression(store, { sessionId: "session:absent", verdict: () => true }),
        ReplayEvidenceError,
    );
});
