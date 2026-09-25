import assert from "node:assert/strict";
import { test } from "node:test";

import {
    ApplicationBudgetError,
    ApplicationEvidenceError,
    ApplicationProtocolError,
    createStaticProvider,
    deriveApplicationOwnerId,
    type ModelProvider,
    ReplayEvidenceError,
    type RunTreeRlRolloutsOptions,
    runReplaySession,
    runTreeRlRollouts,
    SQLiteTraceStore,
    selectTreeRlForkPoints,
} from "../../src/index.ts";
import {
    cassette,
    fixedSelector,
    notifyHandlers,
    PROGRAM_ID,
    providerFactory,
    recordRoots,
    recordSource,
    rewardOf,
    treeRlDefinition,
    treeRlOptions,
    treeRlProtocol,
    treeRlProtocolWithBudgets,
    undeclaredCassette,
    undeclaredProgram,
    workflowProgram,
} from "./tree-rl-fixtures.ts";

function ownerCount(store: SQLiteTraceStore, commandId: string): number {
    return store.readOwner(deriveApplicationOwnerId(commandId)).length;
}

function surfaces(): readonly Record<string, unknown>[] {
    return treeRlDefinition.surfaces as readonly Record<string, unknown>[];
}

test("protocol, prompt, bound, budget, root, and option refusals write nothing and never block a corrected rerun", async () => {
    using store = new SQLiteTraceStore();
    const labels = await recordRoots(store);
    const roots = [...labels.keys()];
    const many = await recordRoots(store, ["m0", "m1", "m2", "m3", "m4", "m5"], "root:many");
    const manyRoots = [...many.keys()];
    const commandId = "application:tree-rl:refusals";
    const seeds16 = Array.from({ length: 16 }, (_, index) => index + 1);
    const withoutRole = (role: string) => surfaces().filter((entry) => entry.role !== role);
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
            { protocol: treeRlProtocol({ surfaces: withoutRole("rollout") }) },
            (error) => error instanceof ApplicationProtocolError,
        ],
        [
            "batch surface",
            { protocol: treeRlProtocol({ surfaces: withoutRole("training_batch") }) },
            (error) => error instanceof ApplicationProtocolError,
        ],
        [
            "budget key",
            { protocol: treeRlProtocol({ budgets: { branches: 2, maxProviderCalls: 40 } }) },
            (error) => error instanceof ApplicationProtocolError,
        ],
        [
            "zero branches",
            { protocol: treeRlProtocolWithBudgets({ branches: 0 }) },
            (error) => error instanceof ApplicationProtocolError,
        ],
        [
            "zero group size",
            { protocol: treeRlProtocolWithBudgets({ groupSize: 0 }) },
            (error) => error instanceof ApplicationProtocolError,
        ],
        [
            "maxBranches",
            { protocol: treeRlProtocolWithBudgets({ branches: 17 }, { seeds: seeds16 }) },
            (error) =>
                error instanceof ApplicationBudgetError &&
                error.code === "APPLICATION_BUDGET_EXCEEDED",
        ],
        [
            "maxGroupSize",
            { protocol: treeRlProtocolWithBudgets({ groupSize: 17 }) },
            (error) => error instanceof ApplicationBudgetError,
        ],
        [
            "seeds",
            { protocol: treeRlProtocolWithBudgets({ branches: 4 }) },
            (error) => error instanceof ApplicationProtocolError,
        ],
        [
            "group size mismatch",
            { protocol: treeRlProtocolWithBudgets({ groupSize: 3 }) },
            (error) => error instanceof ApplicationProtocolError && /3 root/u.test(error.message),
        ],
        [
            "maxRollouts",
            {
                prompts: [0, 1, 2].map((index) => ({
                    id: `p${index}`,
                    program: workflowProgram,
                    roots: manyRoots.slice(index * 2, index * 2 + 2),
                })),
                protocol: treeRlProtocolWithBudgets(
                    { branches: 16, maxProviderCalls: 1000 },
                    { seeds: seeds16 },
                ),
            },
            (error) => error instanceof ApplicationBudgetError && /96 planned/u.test(error.message),
        ],
        [
            "provider calls",
            { protocol: treeRlProtocolWithBudgets({ maxProviderCalls: 19 }) },
            (error) =>
                error instanceof ApplicationBudgetError && /20 projected/u.test(error.message),
        ],
        [
            "duplicate roots",
            {
                prompts: [{ id: "task", program: workflowProgram, roots: [roots[0], roots[0]] }],
            } as never,
            (error) => error instanceof TypeError,
        ],
        ["prompts shape", { prompts: "task" as never }, (error) => error instanceof TypeError],
        ["empty prompts", { prompts: [] }, (error) => error instanceof TypeError],
        [
            "duplicate prompts",
            {
                prompts: [
                    { id: "task", program: workflowProgram, roots },
                    { id: "task", program: workflowProgram, roots: manyRoots.slice(0, 2) },
                ],
            },
            (error) => error instanceof TypeError,
        ],
        [
            "program",
            { prompts: [{ id: "task", program: 1 as never, roots }] },
            (error) => error instanceof TypeError,
        ],
        [
            "missing root",
            {
                prompts: [
                    {
                        id: "task",
                        program: workflowProgram,
                        roots: [roots[0] as string, `replay-session:sha256:${"0".repeat(64)}`],
                    },
                ],
            },
            (error) => error instanceof ReplayEvidenceError,
        ],
        [
            "baselines",
            { baselines: ["single_rollout" as never] },
            (error) => error instanceof TypeError,
        ],
        ["clock", { clock: 1 as never }, (error) => error instanceof TypeError],
        ["selector", { selector: 1 as never }, (error) => error instanceof TypeError],
        ["zero concurrency", { concurrency: 0 }, (error) => error instanceof TypeError],
        [
            "concurrency bound",
            { concurrency: 17 },
            (error) => error instanceof ApplicationBudgetError,
        ],
        [
            "normalization",
            { normalization: "zscore" as never },
            (error) => error instanceof TypeError,
        ],
    ];
    for (const [label, overrides, matches] of cases) {
        const reward = rewardOf(labels);
        await assert.rejects(
            runTreeRlRollouts(store, treeRlOptions(commandId, labels, { reward, ...overrides })),
            matches,
            label,
        );
        assert.equal(ownerCount(store, commandId), 0, label);
        assert.deepEqual(reward.contexts, [], label);
    }
    // Only the roots exist: no rollout session was opened by any refusal.
    assert.equal(store.listOwnersBySchema("shepherd.replay.session.v1", 16, 0).length, 8);
    const { inspection } = await runTreeRlRollouts(store, treeRlOptions(commandId, labels));
    assert.equal(
        inspection.rollouts.every((entry) => entry.record?.status === "completed"),
        true,
    );
    assert.equal(store.verifyIntegrity().ok, true);
});

test("a root that did not finish or has no turn is refused before any record", async () => {
    using store = new SQLiteTraceStore();
    const labels = await recordRoots(store);
    const [first] = [...labels.keys()];
    const failed = await recordSource(
        store,
        "root:failed",
        undefined,
        createStaticProvider({ descriptor: { id: "empty", model: "fixture-v1" }, exchanges: [] }),
    );
    const silent = (
        await runReplaySession(store, {
            claimId: "root",
            commandId: "root:silent",
            program: async () => "done",
            programId: PROGRAM_ID,
            provider: cassette("unused"),
        })
    ).inspection.session_id;
    for (const [label, root, pattern] of [
        ["unfinished", failed, /did not finish/u],
        ["no turn", silent, /has no turn/u],
    ] as const) {
        const commandId = `application:tree-rl:${label}`;
        await assert.rejects(
            runTreeRlRollouts(
                store,
                treeRlOptions(commandId, labels, {
                    prompts: [
                        { id: "task", program: workflowProgram, roots: [first as string, root] },
                    ],
                }),
            ),
            (error: unknown) =>
                error instanceof ApplicationEvidenceError && pattern.test(error.message),
            label,
        );
        assert.equal(ownerCount(store, commandId), 0, label);
    }
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

test("a rerun under another protocol, prompts, baselines, or normalization is refused without writing", async () => {
    using store = new SQLiteTraceStore();
    const labels = await recordRoots(store);
    const other = await recordRoots(store, ["base", "alt"], "root:other");
    const commandId = "application:tree-rl:mismatch";
    await runTreeRlRollouts(store, treeRlOptions(commandId, labels));
    const records = ownerCount(store, commandId);
    await assert.rejects(
        runTreeRlRollouts(
            store,
            treeRlOptions(commandId, labels, {
                protocol: treeRlProtocolWithBudgets({ maxProviderCalls: 41 }),
            }),
        ),
        ApplicationProtocolError,
    );
    for (const overrides of [
        { prompts: [{ id: "task", program: workflowProgram, roots: [...other.keys()] }] },
        { baselines: ["flat_grpo"] as const },
        { normalization: "none" as const },
    ]) {
        await assert.rejects(
            runTreeRlRollouts(store, treeRlOptions(commandId, labels, overrides)),
            ApplicationEvidenceError,
        );
    }
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

test("failed roots and rollouts are retained, excluded from every mean, and the run completes", async () => {
    using store = new SQLiteTraceStore();
    const labels = await recordRoots(store);
    const commandId = "application:tree-rl:failures";
    const reward = rewardOf(labels, {
        alt: Number.NaN,
        "alt:3": 1,
        "alt:5": 2,
        base: 1,
        "base:3": () => {
            throw new Error("reward unavailable");
        },
        "base:5": 5,
    });
    const provider = providerFactory(labels, (context, root) => {
        const built = cassette(
            `s${context.seed}`,
            context.fork_point.step_index,
            `${root}:s${context.seed}`,
            root,
        );
        // The second branch of root alt loses its cassette mid-rollout and does not finish.
        return root === "alt" && context.seed === 5 ? failingAfterFirst(built) : built;
    });
    const { batch, inspection, manifest } = await runTreeRlRollouts(
        store,
        treeRlOptions(commandId, labels, { normalization: "none", provider, reward }),
    );
    assert.deepEqual(
        inspection.roots.map((root) => [root.status, root.failure?.code ?? null, root.reward]),
        [
            ["completed", null, 1],
            ["failed", "APPLICATION_VERIFICATION_FAILED", null],
        ],
    );
    const records = inspection.rollouts.map((entry) => entry.record);
    assert.deepEqual(
        records.map((record) => [record?.status, record?.failure?.code ?? null, record?.reward]),
        [
            ["failed", "APPLICATION_VERIFICATION_FAILED", null],
            ["completed", null, 5],
            ["completed", null, 1],
            ["failed", "APPLICATION_EVIDENCE_INVALID", null],
        ],
    );
    assert.equal(records[3]?.failure?.reason, "the rollout session did not finish");
    assert.equal(records[3]?.cost.provider_calls, 2);
    // The failed live call reported no usage, so the rollout's cost is unknown, not free.
    assert.equal(records[3]?.cost.cost_usd, null);
    assert.equal(
        records[0]?.failure?.reason,
        "the reward function threw or returned a non-finite reward",
    );
    // Tree base: completed root 1 and branch 5 (mean 3); tree alt: branch 1 only; roots: base only.
    assert.deepEqual(
        batch.lines.map((line) => [
            line.member,
            line.reward,
            line.inter_root_advantage,
            line.intra_tree_advantage,
            line.actions.map((action) => action.segment).join(","),
        ]),
        [
            ["root", 1, 0, -2, "prefix,suffix,suffix,suffix,suffix"],
            ["branch", 5, 0, 2, "prefix,suffix,suffix,suffix,suffix"],
            // A failed root's prefix actions carry no inter-root advantage and are omitted.
            ["branch", 1, null, 0, "suffix,suffix,suffix,suffix"],
        ],
    );
    assert.equal(manifest.artifacts.filter((artifact) => artifact.role === "rollout").length, 4);
    assert.equal(manifest.artifacts.filter((artifact) => artifact.role === "root").length, 2);
    assert.equal(
        manifest.costs.provider_calls,
        10 + records.reduce((total, record) => total + (record?.cost.provider_calls ?? 0), 0),
    );
    assert.equal(manifest.costs.cost_usd, null);
    assert.equal(store.verifyIntegrity().ok, true);
});

test("an unexplained suffix divergence retains the rollout as failed", async () => {
    using store = new SQLiteTraceStore();
    const labels = new Map<string, string>();
    for (const label of ["base", "alt"]) {
        labels.set(
            await recordSource(
                store,
                `root:undeclared:${label}`,
                undeclaredProgram,
                undeclaredCassette(label),
                { handlers: notifyHandlers },
            ),
            label,
        );
    }
    const reward = rewardOf(labels, { alt: 2, base: 1 });
    const { batch, inspection } = await runTreeRlRollouts(
        store,
        treeRlOptions("application:tree-rl:diverged", labels, {
            normalization: "none",
            prompts: [
                {
                    handlers: notifyHandlers,
                    id: "task",
                    program: undeclaredProgram,
                    roots: [...labels.keys()],
                },
            ],
            protocol: treeRlProtocolWithBudgets({ branches: 1 }),
            provider: providerFactory(labels, ({ seed }, root) =>
                undeclaredCassette(`${root}:s${seed}`),
            ),
            reward,
        }),
    );
    // Two turns leave the admissible range [1, 1]: the fork is the plan step.
    assert.deepEqual(
        inspection.roots.map((root) => [root.fork.proposed_turn, root.fork.branch_turn]),
        [
            [2, 1],
            [2, 1],
        ],
    );
    for (const entry of inspection.rollouts) {
        assert.equal(entry.record?.status, "failed");
        assert.equal(entry.record?.failure?.code, "APPLICATION_EVIDENCE_INVALID");
        assert.equal(
            entry.record?.failure?.reason,
            "the rollout diverged before its fork point or without explanation",
        );
    }
    // Only the roots were graded.
    assert.deepEqual(
        reward.contexts.map((context) => context.member),
        ["root", "root"],
    );
    assert.deepEqual(
        batch.lines.map((line) => [
            line.member,
            line.inter_root_advantage,
            line.intra_tree_advantage,
        ]),
        [
            ["root", -0.5, 0],
            ["root", 0.5, 0],
        ],
    );
});

test("provider factory refusals follow the retained roots, and a corrected rerun resumes without re-grading", async () => {
    using store = new SQLiteTraceStore();
    const labels = await recordRoots(store);
    const commandId = "application:tree-rl:provider-refusals";
    for (const [label, provider, pattern] of [
        [
            "non-static",
            () =>
                ({
                    descriptor: () => ({ capabilities: {}, id: "p", kind: "program", model: null }),
                    invoke: async () => ({}),
                }) as never,
            /static provider/u,
        ],
        ["null", () => null as never, /static provider/u],
        ["shape", () => ({ descriptor: 1 }) as never, /static provider/u],
        [
            "shared",
            (() => {
                const shared = cassette("shared");
                return () => shared;
            })(),
            /distinct/u,
        ],
    ] as const) {
        await assert.rejects(
            runTreeRlRollouts(store, treeRlOptions(commandId, labels, { provider })),
            (error: unknown) => error instanceof TypeError && pattern.test(error.message),
            label,
        );
        // The opened and both root records are retained; no rollout session opened.
        assert.equal(ownerCount(store, commandId), 3, label);
    }
    const reward = rewardOf(labels);
    const { inspection } = await runTreeRlRollouts(
        store,
        treeRlOptions(commandId, labels, { reward }),
    );
    assert.deepEqual(
        reward.contexts.map((context) => context.member),
        ["branch", "branch", "branch", "branch"],
    );
    assert.equal(inspection.rollouts.length, 4);
});

test("a rollout identical to its root completes with no divergence", async () => {
    using store = new SQLiteTraceStore();
    const labels = await recordRoots(store);
    const { inspection } = await runTreeRlRollouts(
        store,
        treeRlOptions("application:tree-rl:identical", labels, {
            protocol: treeRlProtocolWithBudgets({ branches: 1 }),
            provider: providerFactory(labels, (context, root) =>
                cassette(root, context.fork_point.step_index, `${root}:rollout`, root),
            ),
            reward: rewardOf(labels, { alt: 1, "alt:3": 1, base: 1, "base:3": 1 }),
        }),
    );
    assert.deepEqual(
        inspection.rollouts.map((entry) => [entry.record?.status, entry.record?.reward]),
        [
            ["completed", 1],
            ["completed", 1],
        ],
    );
});

test("a batch whose roots and rollouts would exceed the cited-artifact bound is refused before any record", async () => {
    using store = new SQLiteTraceStore();
    const labels = await recordRoots(
        store,
        Array.from({ length: 64 }, (_, index) => `r${index}`),
        "root:artifacts",
    );
    const roots = [...labels.keys()];
    const commandId = "application:tree-rl:artifacts";
    await assert.rejects(
        runTreeRlRollouts(
            store,
            treeRlOptions(commandId, labels, {
                prompts: [0, 1, 2, 3].map((index) => ({
                    id: `p${index}`,
                    program: workflowProgram,
                    roots: roots.slice(index * 16, index * 16 + 16),
                })),
                protocol: treeRlProtocolWithBudgets({
                    branches: 1,
                    groupSize: 16,
                    maxProviderCalls: 1000,
                }),
            }),
        ),
        (error: unknown) =>
            error instanceof ApplicationBudgetError && /130 cited artifacts/u.test(error.message),
    );
    assert.equal(ownerCount(store, commandId), 0);
});

test("a root turn whose provider call failed reaches the selector with a null output", async () => {
    using store = new SQLiteTraceStore();
    const labels = new Map<string, string>();
    // The first plan request is not in the cassette and fails; the program recovers.
    const recovering: typeof workflowProgram = async (context) => {
        try {
            await context.invokeProvider(
                {
                    input: { stage: "probe" },
                    instruction: "probe",
                    outputSchema: { type: "object" },
                },
                { dependsOn: [] },
            );
        } catch {
            // recorded as a failed provider step
        }
        return workflowProgram(context);
    };
    for (const label of ["base", "alt"]) {
        labels.set(
            await recordSource(store, `root:recovering:${label}`, recovering, cassette(label)),
            label,
        );
    }
    const selector = fixedSelector(2);
    await runTreeRlRollouts(
        store,
        treeRlOptions("application:tree-rl:recovering", labels, {
            prompts: [{ id: "task", program: recovering, roots: [...labels.keys()] }],
            provider: providerFactory(labels, (context, root) =>
                cassette(`s${context.seed}`, 0, `${root}:s${context.seed}`, root),
            ),
            selector,
        }),
    );
    assert.equal(selector.contexts[0]?.turns[0]?.output, null);
    assert.equal(selector.contexts[0]?.turns.length, 6);
});
