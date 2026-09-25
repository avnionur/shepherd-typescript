import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
    APPLICATION_TREE_RL_BATCH_FORMATS,
    ApplicationProtocolError,
    applicationProtocolId,
    canonicalizeRecord,
    computeTreeRlAdvantages,
    createDependencyTreeRlForkSelector,
    deriveApplicationOwnerId,
    exportTreeRlBatchToTrainer,
    exportTreeRlTrainingBatch,
    inspectApplicationManifest,
    inspectReplaySession,
    inspectTreeRlRun,
    runTreeRlRollouts,
    SQLiteTraceStore,
    selectTreeRlForkPoints,
    type TreeRlRunReceipt,
    type TreeRlTrainingBatch,
} from "../../src/index.ts";
import {
    fixedSelector,
    providerFactory,
    recordRoots,
    recordSource,
    renderToolCall,
    rewardOf,
    treeRlOptions,
    treeRlProtocol,
    workflowProgram,
} from "./tree-rl-fixtures.ts";

const EPSILON = 0.000001;
const TOOL_CALL = { arguments: { command: "pip install requests" }, name: "bash" };

async function runOnce(
    commandId: string,
    overrides: Parameters<typeof treeRlOptions>[2] = {},
): Promise<{ readonly receipt: TreeRlRunReceipt; readonly store: SQLiteTraceStore }> {
    const store = new SQLiteTraceStore();
    const labels = await recordRoots(store);
    const receipt = await runTreeRlRollouts(
        store,
        treeRlOptions(commandId, labels, {
            normalization: "none",
            selector: fixedSelector(2, TOOL_CALL),
            ...overrides,
        }),
    );
    return { receipt, store };
}

test("fork-point selection is a deterministic pure function of the retained session", async () => {
    using store = new SQLiteTraceStore();
    const sessionId = await recordSource(store);
    const records = store.readOwner(sessionId).length;
    const all = selectTreeRlForkPoints(store, { maxForkPoints: 32, minDependents: 0, sessionId });
    const source = inspectReplaySession(store, { sessionId });
    assert.deepEqual(
        all.map((point) => [point.step_index, point.dependents]),
        [
            [0, 3],
            [1, 2],
            [2, 1],
            [3, 0],
            [4, 0],
        ],
    );
    assert.equal(all[0]?.prefix_id, null);
    assert.equal(all[1]?.prefix_id, source.steps[0]?.prefix_id);
    assert.equal(all[4]?.prefix_id, source.steps[3]?.prefix_id);
    const two = selectTreeRlForkPoints(store, { maxForkPoints: 32, minDependents: 2, sessionId });
    assert.deepEqual(
        two.map((point) => point.step_index),
        [0, 1],
    );
    const bounded = selectTreeRlForkPoints(store, {
        clock: () => 1,
        maxForkPoints: 2,
        minDependents: 0,
        sessionId,
    });
    assert.deepEqual(bounded, all.slice(0, 2));
    assert.deepEqual(
        selectTreeRlForkPoints(store, { maxForkPoints: 1, minDependents: 4, sessionId }),
        [],
    );
    assert.equal(store.readOwner(sessionId).length, records);
    assert.ok(Object.isFrozen(all) && Object.isFrozen(all[0]));
});

test("Algorithm 2 advantages equal a hand-computed fixture under both normalizations", () => {
    // Prompt p: roots 1 and 3 (mean 2); tree 0 = root 1, branches 3, 5 (mean 3); tree 1 = root 3,
    // branches 1, 2 (mean 2). Prompt q is its own G-root group.
    const trees = [
        { branches: [3, 5], group_index: 0, prompt_id: "p", root: 1 },
        { branches: [1, 2], group_index: 1, prompt_id: "p", root: 3 },
        { branches: [4, null], group_index: 0, prompt_id: "q", root: 6 },
    ];
    assert.deepEqual(computeTreeRlAdvantages(trees, "none"), [
        {
            branch_intra_advantages: [0, 2],
            group_index: 0,
            inter_root_advantage: -1,
            prompt_id: "p",
            root_intra_advantage: -2,
        },
        {
            branch_intra_advantages: [-1, 0],
            group_index: 1,
            inter_root_advantage: 1,
            prompt_id: "p",
            root_intra_advantage: 1,
        },
        {
            branch_intra_advantages: [-1, null],
            group_index: 0,
            inter_root_advantage: 0,
            prompt_id: "q",
            root_intra_advantage: 1,
        },
    ]);
    // group_std with the configured sample estimator and epsilon: inter std sqrt(2); tree 0 std 2;
    // tree 1 std 1; tree q (6, 4) std sqrt(2); a one-root group has std 0.
    const sqrt2 = Math.SQRT2 + EPSILON;
    assert.deepEqual(computeTreeRlAdvantages(trees, "group_std"), [
        {
            branch_intra_advantages: [0, 2 / (2 + EPSILON)],
            group_index: 0,
            inter_root_advantage: -1 / sqrt2,
            prompt_id: "p",
            root_intra_advantage: -2 / (2 + EPSILON),
        },
        {
            branch_intra_advantages: [-1 / (1 + EPSILON), 0],
            group_index: 1,
            inter_root_advantage: 1 / sqrt2,
            prompt_id: "p",
            root_intra_advantage: 1 / (1 + EPSILON),
        },
        {
            branch_intra_advantages: [-1 / sqrt2, null],
            group_index: 0,
            inter_root_advantage: 0,
            prompt_id: "q",
            root_intra_advantage: 1 / sqrt2,
        },
    ]);
    // The configured default is group_std; a failed root is excluded and receives nulls.
    assert.deepEqual(computeTreeRlAdvantages(trees), computeTreeRlAdvantages(trees, "group_std"));
    assert.deepEqual(
        computeTreeRlAdvantages(
            [
                { branches: [2], group_index: 0, prompt_id: "p", root: null },
                { branches: [], group_index: 1, prompt_id: "p", root: 5 },
            ],
            "none",
        ).map((tree) => [
            tree.inter_root_advantage,
            tree.root_intra_advantage,
            tree.branch_intra_advantages,
        ]),
        [
            [null, null, [0]],
            [0, 0, []],
        ],
    );
    for (const invalid of [
        [null],
        [{ ...trees[0], root: Number.NaN }],
        [{ ...trees[0], branches: ["1"] }],
        [{ ...trees[0], prompt_id: "" }],
        [{ ...trees[0], extra: 1 }],
        [trees[0], trees[0]],
    ]) {
        assert.throws(() => computeTreeRlAdvantages(invalid as never, "none"), TypeError);
    }
    assert.throws(() => computeTreeRlAdvantages(trees, "other" as never), TypeError);
});

test("G roots are graded and forked where the selector proposes, the tool call seeds branch zero, and every action carries its advantage", async () => {
    const { receipt, store } = await runOnce("application:tree-rl:exact");
    using _store = store;
    const { batch, inspection, manifest } = receipt;
    const applicationId = deriveApplicationOwnerId("application:tree-rl:exact");
    assert.equal(inspection.application_id, applicationId);
    assert.equal(inspection.kind, "tree_rl");
    assert.equal(inspection.normalization, "none");
    assert.equal(inspection.protocol_id, applicationProtocolId(treeRlProtocol()));
    assert.deepEqual(inspection.seeds, [3, 5]);
    const [base, alt] = inspection.roots;
    assert.deepEqual(
        inspection.roots.map((root) => [
            root.prompt_id,
            root.group_index,
            root.status,
            root.reward,
        ]),
        [
            ["task", 0, "completed", 1],
            ["task", 1, "completed", 3],
        ],
    );
    const baseSession = inspectReplaySession(store, { sessionId: base?.root_session_id as string });
    assert.deepEqual(base?.turns, [0, 1, 2, 3, 4]);
    assert.deepEqual(base?.fork, {
        branch_turn: 2,
        fork_point: { prefix_id: baseSession.steps[0]?.prefix_id, step_index: 1 },
        proposed_turn: 2,
        reason: "fork at turn 2",
        tool_call: TOOL_CALL,
    });
    assert.equal(base?.cost.provider_calls, 5);
    assert.deepEqual(
        inspection.rollouts.map((entry) => [
            entry.root_session_id === base?.root_session_id ? "base" : "alt",
            entry.branch,
            entry.seed,
            entry.seeded,
            entry.branch_turn,
            entry.record?.status,
        ]),
        [
            ["base", 0, 3, true, 2, "completed"],
            ["base", 1, 5, false, 2, "completed"],
            ["alt", 0, 3, true, 2, "completed"],
            ["alt", 1, 5, false, 2, "completed"],
        ],
    );
    for (const entry of inspection.rollouts) {
        const rollout = inspectReplaySession(store, { sessionId: entry.replay_session_id });
        assert.equal(rollout.origin?.target_step_count, 1);
        assert.deepEqual(rollout.origin?.changes, ["provider"]);
        assert.equal(entry.record?.cost.provider_calls, 4);
        assert.deepEqual(entry.record?.turns, [0, 1, 2, 3, 4]);
        // The seeded branch's first live action is the rendered proposed tool call.
        assert.deepEqual(
            rollout.steps[1]?.provider?.response?.output,
            entry.seeded ? renderToolCall(TOOL_CALL) : { text: `s${entry.seed}:explore` },
        );
    }
    // Raw (none) advantages: inter -1 / 1; base tree -2, 0, 2; alt tree 1, -1, 0.
    const expected = [
        ["root", null, 1, -1, -2],
        ["branch", 0, 3, -1, 0],
        ["branch", 1, 5, -1, 2],
        ["root", null, 3, 1, 1],
        ["branch", 0, 1, 1, -1],
        ["branch", 1, 2, 1, 0],
    ] as const;
    assert.deepEqual(
        batch.lines.map((line) => [
            line.member,
            line.branch,
            line.reward,
            line.inter_root_advantage,
            line.intra_tree_advantage,
        ]),
        expected,
    );
    for (const [index, line] of batch.lines.entries()) {
        const [, , , inter, intra] = expected[index] as (typeof expected)[number];
        // Turn 1 precedes the fork turn: prefix, inter-root; turns 2-5: suffix, intra-tree.
        assert.deepEqual(line.actions, [
            { advantage: inter, segment: "prefix", step_index: 0, turn: 1 },
            ...[1, 2, 3, 4].map((step) => ({
                advantage: intra,
                segment: "suffix",
                step_index: step,
                turn: step + 1,
            })),
        ]);
        assert.equal(line.branch_turn, 2);
        assert.equal(line.seeded, line.branch === 0);
    }
    assert.equal(batch.lines[0]?.replay_session_id, base?.root_session_id);
    assert.equal(batch.lines[0]?.rollout_id, null);
    assert.equal(batch.lines[3]?.root_session_id, alt?.root_session_id);
    assert.equal(batch.format, APPLICATION_TREE_RL_BATCH_FORMATS[0]);
    assert.equal(batch.format, "jsonl_v2");
    assert.equal(batch.normalization, "none");
    assert.equal(batch.line_count, 6);
    assert.equal(batch.baseline, null);
    assert.equal(
        batch.text,
        batch.lines.map((line) => `${canonicalizeRecord(line as never)}\n`).join(""),
    );
    assert.equal(
        batch.batch_digest,
        `sha256:${createHash("sha256").update(batch.text, "utf8").digest("hex")}`,
    );
    assert.deepEqual(
        manifest.artifacts.map((artifact) => artifact.role),
        ["root", "root", "rollout", "rollout", "rollout", "rollout", "training_batch"],
    );
    // Roots (5 calls each) plus four rollouts forked at step 1 (4 calls each), 0.25 per call.
    assert.equal(manifest.costs.provider_calls, 26);
    assert.equal(manifest.costs.cost_usd, 6.5);
    assert.deepEqual(inspectApplicationManifest(store, applicationId).manifest, manifest);
    assert.equal(store.verifyIntegrity().ok, true);
});

test("group_std normalization standardizes each group and the flat GRPO baseline keeps the roots only", async () => {
    const { receipt, store } = await runOnce("application:tree-rl:std", {
        baselines: ["flat_grpo"],
        normalization: "group_std",
    });
    using _store = store;
    const sqrt2 = Math.SQRT2 + EPSILON;
    assert.deepEqual(
        receipt.batch.lines.map((line) => [line.inter_root_advantage, line.intra_tree_advantage]),
        [
            [-1 / sqrt2, -2 / (2 + EPSILON)],
            [-1 / sqrt2, 0],
            [-1 / sqrt2, 2 / (2 + EPSILON)],
            [1 / sqrt2, 1 / (1 + EPSILON)],
            [1 / sqrt2, -1 / (1 + EPSILON)],
            [1 / sqrt2, 0],
        ],
    );
    const baseline = receipt.batch.baseline;
    assert.equal(baseline?.kind, "flat_grpo");
    assert.deepEqual(
        baseline?.lines.map((line) => [line.member, line.reward, line.intra_tree_advantage]),
        [
            ["root", 1, null],
            ["root", 3, null],
        ],
    );
    assert.deepEqual(
        baseline?.lines[1]?.actions.map((action) => [action.segment, action.advantage]),
        Array.from({ length: 5 }, () => ["flat", 1 / sqrt2]),
    );
    assert.equal(receipt.inspection.batch?.baseline?.batch_digest, baseline?.batch_digest);
    assert.deepEqual(
        receipt.manifest.artifacts.slice(-2).map((artifact) => artifact.role),
        ["training_batch", "flat_grpo_batch"],
    );
});

test("a batch of prompts keeps each prompt's G roots as its own inter-root group", async () => {
    using store = new SQLiteTraceStore();
    const first = await recordRoots(store, ["base", "alt"], "root:first");
    const second = await recordRoots(store, ["p2a", "p2b"], "root:second");
    const labels = new Map([...first, ...second]);
    const { batch, inspection } = await runTreeRlRollouts(
        store,
        treeRlOptions("application:tree-rl:batch", labels, {
            normalization: "none",
            prompts: [
                { id: "first", program: workflowProgram, roots: [...first.keys()] },
                { id: "second", program: workflowProgram, roots: [...second.keys()] },
            ],
            provider: providerFactory(labels),
            reward: rewardOf(labels, {
                ...{ alt: 3, "alt:3": 1, "alt:5": 2, base: 1, "base:3": 3, "base:5": 5 },
                ...{ p2a: 10, "p2a:3": 10, "p2a:5": 10, p2b: 20, "p2b:3": 20, "p2b:5": 20 },
            }),
        }),
    );
    assert.deepEqual(
        inspection.prompts.map((prompt) => [prompt.id, prompt.roots.length]),
        [
            ["first", 2],
            ["second", 2],
        ],
    );
    assert.deepEqual(
        batch.lines
            .filter((line) => line.member === "root")
            .map((line) => [line.prompt_id, line.inter_root_advantage]),
        [
            ["first", -1],
            ["first", 1],
            ["second", -5],
            ["second", 5],
        ],
    );
    assert.equal(inspection.rollouts.length, 8);
});

test("selection, advantages, and the batch digest are identical across concurrency, runs, stores, and archive import", async () => {
    const serial = await runOnce("application:tree-rl:determinism", { concurrency: 1 });
    const parallel = await runOnce("application:tree-rl:determinism", { concurrency: 4 });
    using firstStore = serial.store;
    using secondStore = parallel.store;
    assert.deepEqual(parallel.receipt.batch, serial.receipt.batch);
    assert.deepEqual(parallel.receipt.manifest, serial.receipt.manifest);
    assert.deepEqual(parallel.receipt.inspection.roots, serial.receipt.inspection.roots);
    const applicationId = deriveApplicationOwnerId("application:tree-rl:determinism");
    // A repeated command returns the retained run without replaying, selecting, or scoring.
    const labels = new Map(
        serial.receipt.inspection.roots.map((root, index) => [
            root.root_session_id,
            ["base", "alt"][index] as string,
        ]),
    );
    const provider = providerFactory(labels);
    const reward = rewardOf(labels);
    const selector = fixedSelector(2, TOOL_CALL);
    const repeated = await runTreeRlRollouts(
        firstStore,
        treeRlOptions("application:tree-rl:determinism", labels, {
            concurrency: 1,
            normalization: "none",
            provider,
            reward,
            selector,
        }),
    );
    assert.deepEqual(repeated, serial.receipt);
    assert.deepEqual(provider.contexts, []);
    assert.deepEqual(reward.contexts, []);
    assert.deepEqual(selector.contexts, []);
    using imported = new SQLiteTraceStore();
    imported.importTrace(firstStore.exportTrace());
    assert.deepEqual(exportTreeRlTrainingBatch(imported, applicationId), serial.receipt.batch);
    assert.deepEqual(inspectTreeRlRun(imported, applicationId), serial.receipt.inspection);
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-tree-rl-"));
    try {
        const databasePath = path.join(directory, "trace.sqlite");
        const writer = new SQLiteTraceStore(databasePath);
        writer.importTrace(secondStore.exportTrace());
        writer.close();
        using reader = new SQLiteTraceStore(databasePath, { readOnly: true });
        assert.equal(
            exportTreeRlTrainingBatch(reader, applicationId).batch_digest,
            serial.receipt.batch.batch_digest,
        );
    } finally {
        await rm(directory, { force: true, recursive: true });
    }
});

test("concurrent rollouts overlap up to the configured bound", async () => {
    using store = new SQLiteTraceStore();
    const labels = await recordRoots(store);
    let inFlight = 0;
    let peak = 0;
    const base = providerFactory(labels);
    const provider = (context: Parameters<typeof base>[0]) => {
        const built = base(context);
        return Object.freeze({
            descriptor: built.descriptor,
            invoke: async (...args: Parameters<typeof built.invoke>) => {
                inFlight += 1;
                peak = Math.max(peak, inFlight);
                await new Promise((resolve) => setTimeout(resolve, 5));
                inFlight -= 1;
                return built.invoke(...args);
            },
        });
    };
    await runTreeRlRollouts(
        store,
        treeRlOptions("application:tree-rl:overlap", labels, { concurrency: 3, provider }),
    );
    assert.equal(peak, 3);
});

test("the dependency selector proposes the admissible turn with the most dependents and no tool call", async () => {
    using store = new SQLiteTraceStore();
    const labels = await recordRoots(store);
    const { inspection } = await runTreeRlRollouts(
        store,
        treeRlOptions("application:tree-rl:dependency", labels, {
            selector: createDependencyTreeRlForkSelector(),
        }),
    );
    assert.deepEqual(
        inspection.roots.map((root) => [root.fork.branch_turn, root.fork.tool_call]),
        [
            [1, null],
            [1, null],
        ],
    );
    assert.equal(
        inspection.roots[0]?.fork.reason,
        "the admissible turn with the most transitive dependents",
    );
    assert.equal(
        inspection.rollouts.some((entry) => entry.seeded),
        false,
    );
});

test("the trainer-export adapter receives the retained batch and refuses a format it does not accept", async () => {
    const { receipt, store } = await runOnce("application:tree-rl:trainer");
    using _store = store;
    const applicationId = receipt.inspection.application_id;
    const received: TreeRlTrainingBatch[] = [];
    const result = await exportTreeRlBatchToTrainer(store, applicationId, {
        formats: ["jsonl_v2"],
        id: "fixture-trainer",
        submit: (batch) => {
            received.push(batch);
            return `job:${batch.batch_digest}`;
        },
    });
    assert.equal(result, `job:${receipt.batch.batch_digest}`);
    assert.deepEqual(received, [receipt.batch]);
    await assert.rejects(
        exportTreeRlBatchToTrainer(store, applicationId, {
            formats: [],
            id: "other",
            submit: () => null,
        }),
        ApplicationProtocolError,
    );
    await assert.rejects(
        exportTreeRlBatchToTrainer(store, applicationId, {
            formats: "jsonl_v2" as never,
            id: "strings",
            submit: () => null,
        }),
        TypeError,
    );
    await assert.rejects(
        exportTreeRlBatchToTrainer(store, applicationId, {
            formats: ["jsonl_v2"],
            id: "",
            submit: () => null,
        }),
        TypeError,
    );
});
