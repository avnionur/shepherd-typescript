import assert from "node:assert/strict";
import { test } from "node:test";

import {
    ApplicationBudgetError,
    ApplicationEvidenceError,
    ApplicationProtocolError,
    computeTreeRlAdvantages,
    createStaticProvider,
    deriveApplicationOwnerId,
    exportTreeRlTrainingBatch,
    inspectTreeRlRun,
    type ModelProvider,
    ReplayEvidenceError,
    type RunTreeRlRolloutsOptions,
    runTreeRlRollouts,
    SQLiteTraceStore,
    selectTreeRlForkPoints,
} from "../../src/index.ts";
import {
    cassette,
    notifyHandlers,
    providerFactory,
    recordSource,
    rewardOf,
    treeRlDefinition,
    treeRlOptions,
    treeRlProtocol,
    treeRlProtocolWithBudgets,
    undeclaredCassette,
    undeclaredProgram,
} from "./tree-rl-fixtures.ts";

function ownerCount(store: SQLiteTraceStore, commandId: string): number {
    return store.readOwner(deriveApplicationOwnerId(commandId)).length;
}

function surfaces(): readonly Record<string, unknown>[] {
    return treeRlDefinition.surfaces as readonly Record<string, unknown>[];
}

test("protocol, bound, budget, source, and provider refusals write nothing and never block a corrected rerun", async () => {
    using store = new SQLiteTraceStore();
    const sourceSessionId = await recordSource(store);
    const commandId = "application:tree-rl:refusals";
    const seeds16 = Array.from({ length: 16 }, (_, index) => index + 1);
    const cases: readonly [
        string,
        Partial<RunTreeRlRolloutsOptions>,
        (error: unknown) => boolean,
    ][] = [
        [
            "kind",
            { protocol: treeRlProtocol({ kind: "trajectory_compression" }) },
            (error) => error instanceof ApplicationProtocolError,
        ],
        [
            "rollout surface",
            { protocol: treeRlProtocol({ surfaces: surfaces().slice(1) }) },
            (error) => error instanceof ApplicationProtocolError,
        ],
        [
            "batch surface",
            { protocol: treeRlProtocol({ surfaces: surfaces().slice(0, 1) }) },
            (error) => error instanceof ApplicationProtocolError,
        ],
        [
            "budget key",
            { protocol: treeRlProtocol({ budgets: { branches: 2 } }) },
            (error) => error instanceof ApplicationProtocolError,
        ],
        [
            "zero branches",
            { protocol: treeRlProtocolWithBudgets({ branches: 0 }) },
            (error) => error instanceof ApplicationProtocolError,
        ],
        [
            "zero fork points",
            { protocol: treeRlProtocolWithBudgets({ maxForkPoints: 0 }) },
            (error) => error instanceof ApplicationProtocolError,
        ],
        [
            "maxForkPoints",
            { protocol: treeRlProtocolWithBudgets({ maxForkPoints: 33 }) },
            (error) =>
                error instanceof ApplicationBudgetError &&
                error.code === "APPLICATION_BUDGET_EXCEEDED",
        ],
        [
            "maxBranches",
            { protocol: treeRlProtocolWithBudgets({ branches: 17 }, { seeds: seeds16 }) },
            (error) => error instanceof ApplicationBudgetError,
        ],
        [
            "seeds",
            { protocol: treeRlProtocolWithBudgets({ branches: 4 }) },
            (error) => error instanceof ApplicationProtocolError,
        ],
        [
            "maxRollouts",
            {
                protocol: treeRlProtocolWithBudgets(
                    { branches: 16, maxForkPoints: 5, maxProviderCalls: 1000, minDependents: 0 },
                    { seeds: seeds16 },
                ),
            },
            (error) => error instanceof ApplicationBudgetError && /64/u.test(error.message),
        ],
        [
            "provider calls",
            { protocol: treeRlProtocolWithBudgets({ maxProviderCalls: 23 }) },
            (error) =>
                error instanceof ApplicationBudgetError && /24 projected/u.test(error.message),
        ],
        [
            "no fork point",
            { protocol: treeRlProtocolWithBudgets({ minDependents: 4 }) },
            (error) => error instanceof ApplicationEvidenceError,
        ],
        [
            "non-static provider",
            {
                provider: () =>
                    ({
                        descriptor: () => ({
                            capabilities: {},
                            id: "p",
                            kind: "program",
                            model: null,
                        }),
                        invoke: async () => ({}),
                    }) as never,
            },
            (error) => error instanceof TypeError && /static provider/u.test(error.message),
        ],
        [
            "provider object",
            { provider: () => null as never },
            (error) => error instanceof TypeError,
        ],
        [
            "provider shape",
            { provider: () => ({ descriptor: 1 }) as never },
            (error) => error instanceof TypeError,
        ],
        [
            "shared provider",
            (() => {
                const shared = cassette("shared");
                return { provider: () => shared };
            })(),
            (error) => error instanceof TypeError && /distinct/u.test(error.message),
        ],
        ["program", { program: 1 as never }, (error) => error instanceof TypeError],
        [
            "baselines",
            { baselines: ["full_replay" as never] },
            (error) => error instanceof TypeError,
        ],
        ["clock", { clock: 1 as never }, (error) => error instanceof TypeError],
    ];
    for (const [label, overrides, matches] of cases) {
        const reward = rewardOf();
        await assert.rejects(
            runTreeRlRollouts(
                store,
                treeRlOptions(commandId, sourceSessionId, { reward, ...overrides }),
            ),
            matches,
            label,
        );
        assert.equal(ownerCount(store, commandId), 0, label);
        assert.deepEqual(reward.contexts, [], label);
    }
    // Only the source session exists: no rollout session was opened by any refusal.
    assert.deepEqual(store.listOwnersBySchema("shepherd.replay.session.v1", 16, 0), [
        sourceSessionId,
    ]);
    // A corrected rerun of the same command succeeds.
    const { inspection } = await runTreeRlRollouts(
        store,
        treeRlOptions(commandId, sourceSessionId),
    );
    assert.equal(
        inspection.rollouts.every((entry) => entry.record?.status === "completed"),
        true,
    );
    assert.equal(store.verifyIntegrity().ok, true);
});

test("a source that did not finish or is not retained is refused before any record", async () => {
    using store = new SQLiteTraceStore();
    const failedSource = await recordSource(
        store,
        "source:failed",
        undefined,
        createStaticProvider({ descriptor: { id: "empty", model: "fixture-v1" }, exchanges: [] }),
    );
    await assert.rejects(
        runTreeRlRollouts(store, treeRlOptions("application:tree-rl:unfinished", failedSource)),
        (error: unknown) =>
            error instanceof ApplicationEvidenceError && /did not finish/u.test(error.message),
    );
    assert.equal(ownerCount(store, "application:tree-rl:unfinished"), 0);
    await assert.rejects(
        runTreeRlRollouts(store, treeRlOptions("application:tree-rl:missing", "missing")),
        ReplayEvidenceError,
    );
    assert.equal(ownerCount(store, "application:tree-rl:missing"), 0);
});

test("selection option refusals", async () => {
    using store = new SQLiteTraceStore();
    const sessionId = await recordSource(store);
    assert.throws(
        () => selectTreeRlForkPoints(store, { maxForkPoints: 0, minDependents: 0, sessionId }),
        TypeError,
    );
    assert.throws(
        () => selectTreeRlForkPoints(store, { maxForkPoints: 33, minDependents: 0, sessionId }),
        ApplicationBudgetError,
    );
    assert.throws(
        () => selectTreeRlForkPoints(store, { maxForkPoints: 1, minDependents: -1, sessionId }),
        TypeError,
    );
    assert.throws(
        () =>
            selectTreeRlForkPoints(store, {
                clock: 1 as never,
                maxForkPoints: 1,
                minDependents: 0,
                sessionId,
            }),
        TypeError,
    );
});

test("a rerun under another protocol, source, or baselines is refused without writing", async () => {
    using store = new SQLiteTraceStore();
    const sourceSessionId = await recordSource(store);
    const other = await recordSource(store, "source:other");
    const commandId = "application:tree-rl:mismatch";
    await runTreeRlRollouts(store, treeRlOptions(commandId, sourceSessionId));
    const records = ownerCount(store, commandId);
    await assert.rejects(
        runTreeRlRollouts(
            store,
            treeRlOptions(commandId, sourceSessionId, {
                protocol: treeRlProtocolWithBudgets({ maxProviderCalls: 41 }),
            }),
        ),
        ApplicationProtocolError,
    );
    await assert.rejects(
        runTreeRlRollouts(store, treeRlOptions(commandId, other)),
        ApplicationEvidenceError,
    );
    await assert.rejects(
        runTreeRlRollouts(
            store,
            treeRlOptions(commandId, sourceSessionId, { baselines: ["single_rollout"] }),
        ),
        ApplicationEvidenceError,
    );
    assert.equal(ownerCount(store, commandId), records);
});

/** Wraps a provider so its invocations fail after the first. */
function failingAfterFirst(provider: ModelProvider): ModelProvider {
    let calls = 0;
    return Object.freeze({
        descriptor: provider.descriptor,
        invoke: async (...args: Parameters<ModelProvider["invoke"]>) => {
            calls += 1;
            if (calls > 1) {
                throw new Error("cassette exhausted");
            }
            return provider.invoke(...args);
        },
    });
}

test("failed rollouts are retained, excluded from every mean, and the run completes", async () => {
    using store = new SQLiteTraceStore();
    const sourceSessionId = await recordSource(store);
    const commandId = "application:tree-rl:failures";
    const reward = rewardOf({
        "0:3": 1,
        "0:5": 3,
        "1:3": 5,
        "1:5": () => {
            throw new Error("reward unavailable");
        },
        "2:3": 4,
        "2:5": Number.NaN,
    });
    const provider = providerFactory((context) => {
        const built = cassette(
            `s${context.seed}`,
            context.fork_point.step_index,
            `s${context.seed}:${context.fork_point.step_index}`,
        );
        // The second branch at fork 0 loses its cassette mid-rollout and does not finish.
        return context.fork_point.step_index === 0 && context.seed === 5
            ? failingAfterFirst(built)
            : built;
    });
    const { batch, inspection, manifest } = await runTreeRlRollouts(
        store,
        treeRlOptions(commandId, sourceSessionId, { provider, reward }),
    );
    const records = inspection.rollouts.map((entry) => entry.record);
    assert.deepEqual(
        records.map((record) => [record?.status, record?.failure?.code ?? null, record?.reward]),
        [
            ["completed", null, 1],
            ["failed", "APPLICATION_EVIDENCE_INVALID", null],
            ["completed", null, 5],
            ["failed", "APPLICATION_VERIFICATION_FAILED", null],
            ["completed", null, 4],
            ["failed", "APPLICATION_VERIFICATION_FAILED", null],
        ],
    );
    assert.equal(records[1]?.failure?.reason, "the rollout session did not finish");
    assert.equal(records[1]?.cost.provider_calls, 2);
    // The failed live call reported no usage, so the rollout's cost is unknown, not free.
    assert.equal(records[1]?.cost.cost_usd, null);
    assert.equal(typeof records[0]?.cost.cost_usd, "number");
    assert.equal(
        records[3]?.failure?.reason,
        "the reward function threw or returned a non-finite reward",
    );
    // Only completed rollouts enter the batch; every fork point now has one completed rollout, so
    // every intra-branch advantage is 0. Means: 1, 5, 4; overall 10 / 3.
    const overall = (1 + 5 + 4) / 3;
    assert.deepEqual(
        batch.lines.map((line) => [
            line.reward,
            line.intra_branch_advantage,
            line.inter_branch_advantage,
        ]),
        [
            [1, 0, 1 - overall],
            [5, 0, 5 - overall],
            [4, 0, 4 - overall],
        ],
    );
    assert.deepEqual(
        computeTreeRlAdvantages(records as never).map((entry) => entry.rollout_id),
        batch.lines.map((line) => line.rollout_id),
    );
    // Failed rollouts are still cited and their measured cost counted.
    assert.equal(manifest.artifacts.filter((artifact) => artifact.role === "rollout").length, 6);
    assert.equal(
        manifest.costs.provider_calls,
        records.reduce((total, record) => total + (record?.cost.provider_calls ?? 0), 0),
    );
    assert.equal(manifest.costs.cost_usd, null);
    assert.equal(store.verifyIntegrity().ok, true);
});

test("an unexplained suffix divergence retains the rollout as failed", async () => {
    using store = new SQLiteTraceStore();
    const sourceSessionId = await recordSource(
        store,
        "source:undeclared",
        undeclaredProgram,
        undeclaredCassette("base"),
        { handlers: notifyHandlers },
    );
    const reward = rewardOf({ "0:3": 1, "0:5": 2 });
    const { batch, inspection } = await runTreeRlRollouts(
        store,
        treeRlOptions("application:tree-rl:diverged", sourceSessionId, {
            handlers: notifyHandlers,
            program: undeclaredProgram,
            protocol: treeRlProtocolWithBudgets({ branches: 1, minDependents: 1 }),
            provider: providerFactory(({ seed }) => undeclaredCassette(`s${seed}`)),
            reward,
        }),
    );
    assert.equal(inspection.fork_points.length, 1);
    const record = inspection.rollouts[0]?.record;
    assert.equal(record?.status, "failed");
    assert.equal(record?.failure?.code, "APPLICATION_EVIDENCE_INVALID");
    assert.equal(
        record?.failure?.reason,
        "the rollout diverged before its fork point or without explanation",
    );
    assert.deepEqual(reward.contexts, []);
    assert.equal(batch.line_count, 0);
    assert.equal(batch.text, "");
});

test("single-branch and single-fork-point runs yield zero degenerate advantages; the single_rollout baseline uses branch zero", async () => {
    using store = new SQLiteTraceStore();
    const sourceSessionId = await recordSource(store);
    const single = await runTreeRlRollouts(
        store,
        treeRlOptions("application:tree-rl:one-fork", sourceSessionId, {
            protocol: treeRlProtocolWithBudgets({ maxForkPoints: 1 }),
        }),
    );
    assert.deepEqual(
        single.batch.lines.map((line) => [
            line.intra_branch_advantage,
            line.inter_branch_advantage,
        ]),
        [
            [-1, 0],
            [1, 0],
        ],
    );
    const baseline = await runTreeRlRollouts(
        store,
        treeRlOptions("application:tree-rl:baseline", sourceSessionId, {
            baselines: ["single_rollout"],
        }),
    );
    const base = baseline.batch.baseline;
    assert.equal(base?.kind, "single_rollout");
    // Branch zero only: rewards 1, 4, 0; means per fork equal the rewards; overall 5 / 3.
    assert.deepEqual(
        base?.lines.map((line) => [line.seed, line.reward, line.intra_branch_advantage]),
        [
            [3, 1, 0],
            [3, 4, 0],
            [3, 0, 0],
        ],
    );
    assert.deepEqual(
        base?.lines.map((line) => line.inter_branch_advantage),
        [1, 4, 0].map((reward) => reward - 5 / 3),
    );
    assert.equal(baseline.inspection.batch?.baseline?.batch_digest, base?.batch_digest);
    assert.deepEqual(
        baseline.manifest.artifacts.slice(-2).map((artifact) => artifact.role),
        ["training_batch", "single_rollout_batch"],
    );
    // The full batch is unchanged by the baseline.
    const plain = await runTreeRlRollouts(
        store,
        treeRlOptions("application:tree-rl:plain", sourceSessionId),
    );
    assert.deepEqual(
        baseline.batch.lines.map((line) => [line.reward, line.intra_branch_advantage]),
        plain.batch.lines.map((line) => [line.reward, line.intra_branch_advantage]),
    );
    const oneBranch = await runTreeRlRollouts(
        store,
        treeRlOptions("application:tree-rl:one-branch", sourceSessionId, {
            protocol: treeRlProtocolWithBudgets({ branches: 1 }),
        }),
    );
    assert.deepEqual(
        oneBranch.batch.lines.map((line) => line.intra_branch_advantage),
        [0, 0, 0],
    );
    assert.deepEqual(
        exportTreeRlTrainingBatch(store, oneBranch.inspection.application_id),
        oneBranch.batch,
    );
    assert.deepEqual(
        inspectTreeRlRun(store, oneBranch.inspection.application_id),
        oneBranch.inspection,
    );
});

test("advantages over explicit rollouts are exact and refuse malformed input", () => {
    const rollout = (id: string, step: number, reward: number | null) => ({
        fork_point: { step_index: step },
        reward,
        rollout_id: id,
        status: reward === null ? ("failed" as const) : ("completed" as const),
    });
    assert.deepEqual(
        computeTreeRlAdvantages([
            rollout("a", 0, 2),
            rollout("b", 0, 6),
            rollout("c", 3, 10),
            rollout("d", 3, null),
            rollout("e", 5, 2),
        ]),
        [
            { inter_branch_advantage: -1, intra_branch_advantage: -2, rollout_id: "a" },
            { inter_branch_advantage: -1, intra_branch_advantage: 2, rollout_id: "b" },
            { inter_branch_advantage: 5, intra_branch_advantage: 0, rollout_id: "c" },
            { inter_branch_advantage: -3, intra_branch_advantage: 0, rollout_id: "e" },
        ],
    );
    assert.deepEqual(computeTreeRlAdvantages([rollout("x", 1, 7)]), [
        { inter_branch_advantage: 0, intra_branch_advantage: 0, rollout_id: "x" },
    ]);
    assert.deepEqual(computeTreeRlAdvantages([rollout("x", 1, null)]), []);
    assert.deepEqual(computeTreeRlAdvantages([]), []);
    for (const invalid of [
        [null],
        [{ ...rollout("x", 1, 1), status: "running" }],
        [{ ...rollout("x", 1, 1), reward: null }],
        [{ ...rollout("x", 1, null), reward: 1 }],
        [{ ...rollout("x", 1, null), reward: "1" }],
        [{ ...rollout("x", 1, 1), reward: Number.POSITIVE_INFINITY }],
        [{ ...rollout("x", 1, 1), fork_point: null }],
        [{ ...rollout("", 1, 1) }],
        [rollout("x", 1, 1), rollout("x", 2, 1)],
    ]) {
        assert.throws(() => computeTreeRlAdvantages(invalid as never), TypeError);
    }
    assert.throws(() => computeTreeRlAdvantages(null as never), TypeError);
});

test("a rollout identical to its source completes with no divergence", async () => {
    using store = new SQLiteTraceStore();
    const sourceSessionId = await recordSource(store);
    const { inspection } = await runTreeRlRollouts(
        store,
        treeRlOptions("application:tree-rl:identical", sourceSessionId, {
            protocol: treeRlProtocolWithBudgets({ branches: 1, maxForkPoints: 1 }),
            provider: providerFactory(({ fork_point }) =>
                cassette("base", fork_point.step_index, "base:rollout"),
            ),
        }),
    );
    const record = inspection.rollouts[0]?.record;
    assert.equal(record?.status, "completed");
    assert.equal(record?.reward, 1);
});
