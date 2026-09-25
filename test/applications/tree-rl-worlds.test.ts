import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";

import {
    ApplicationEvidenceError,
    createEffectHandlerStack,
    createEffectIntent,
    createStaticProvider,
    deriveApplicationOwnerId,
    type EffectHandlerStack,
    inspectReplaySession,
    type ModelProvider,
    type ModelRequest,
    type ReplayCheckpointPolicy,
    type ReplayProcessAdapter,
    type ReplaySessionInspection,
    type ReplaySessionProgram,
    runReplaySession,
    runTreeRlRollouts,
    SQLiteTraceStore,
    selectTreeRlForkPoints,
    type TreeRlProviderContext,
} from "../../src/index.ts";
import {
    cassette,
    fixedSelector,
    providerFactory,
    rewardOf,
    treeRlOptions,
    treeRlProtocolWithBudgets,
    workflowProgram,
} from "./tree-rl-fixtures.ts";

/** Provider stages of the world workflow: step index and the stage whose output it consumes. */
const STAGES = [
    { prior: null, stage: "plan", step: 0 },
    { prior: "plan", stage: "draft", step: 2 },
    { prior: "draft", stage: "review", step: 4 },
    { prior: "draft", stage: "answer", step: 5 },
] as const;

function requestOf(stage: string, prior: unknown): ModelRequest {
    return {
        input: { prior: prior as never, stage },
        instruction: `perform ${stage}`,
        outputSchema: { type: "object" },
    };
}

/**
 * World-bound workflow: plan (0), write plan.txt from the plan (1), draft from the plan (2), write
 * draft.txt from the draft (3), review the draft (4), and the answer from the draft (5). Files are
 * written only through the handler stack.
 */
const worldProgram: ReplaySessionProgram = async (context) => {
    const plan = await context.invokeProvider(requestOf("plan", null), { dependsOn: [] });
    await context.dispatchEffect(writeOf("plan.txt", plan.response.output), {
        dependsOn: [plan.handle],
    });
    const draft = await context.invokeProvider(requestOf("draft", plan.response.output), {
        dependsOn: [plan.handle],
    });
    await context.dispatchEffect(writeOf("draft.txt", draft.response.output), {
        dependsOn: [draft.handle],
    });
    await context.invokeProvider(requestOf("review", draft.response.output), {
        dependsOn: [draft.handle],
    });
    const answer = await context.invokeProvider(requestOf("answer", draft.response.output), {
        dependsOn: [draft.handle],
    });
    return answer.response.output;
};

function writeOf(name: string, output: unknown) {
    return createEffectIntent({
        effectId: `effect:write:${name}`,
        kind: "file.write",
        payload: { name, text: (output as { readonly text: string }).text },
        reversibility: "reversible",
    });
}

function writeHandlers(root: string): EffectHandlerStack {
    return createEffectHandlerStack([
        {
            handle: async (intent) => {
                const { name, text } = intent.payload as { name: string; text: string };
                await writeFile(path.join(root, name), text);
                return { ok: true, value: { written: name } };
            },
            handlerId: "handler:file.write",
            kind: "file.write",
        },
    ]);
}

/** Exact cassette of the provider stages at or after `from`; earlier stages answer `prefix`. */
function cassetteOf(label: string, from: number, id = label, prefix = "base"): ModelProvider {
    const outputs = new Map<string, unknown>();
    const exchanges = [];
    for (const { prior, stage, step } of STAGES) {
        const output = { text: `${step < from ? prefix : label}:${stage}` };
        if (step >= from) {
            exchanges.push({
                request: requestOf(stage, prior === null ? null : outputs.get(prior)),
                response: {
                    output,
                    usage: {
                        cacheCreationInputTokens: 0,
                        cacheReadInputTokens: 0,
                        costUsd: null,
                        inputTokens: 4,
                        outputTokens: 2,
                    },
                },
            });
        }
        outputs.set(stage, output);
    }
    return createStaticProvider({
        descriptor: { id: `provider:${id}`, model: "fixture-v1" },
        exchanges,
    });
}

async function fixture(context: TestContext, policy: ReplayCheckpointPolicy) {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-tree-rl-worlds-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    context.after(() => store.close());
    const roots: ReplaySessionInspection[] = [];
    const labels = new Map<string, string>();
    for (const label of ["base", "alt"]) {
        const world = path.join(directory, `root-${label}`);
        await mkdir(world);
        await writeFile(path.join(world, "seed.txt"), "initial");
        const { inspection } = await runReplaySession(store, {
            checkpointPolicy: policy,
            claimId: "root",
            commandId: `root:tree-rl:world:${label}`,
            handlers: writeHandlers(world),
            program: worldProgram,
            programId: "workflow:world.v1",
            provider: cassetteOf(label, 0, label, label),
            worlds: [{ name: "main", root: world }],
        });
        assert.equal(inspection.terminal?.status, "finished");
        roots.push(inspection);
        labels.set(inspection.session_id, label);
    }
    return { directory, labels, roots, store };
}

const protocol = treeRlProtocolWithBudgets({ branches: 2, groupSize: 2 });
const provider = (labels: ReadonlyMap<string, string>) =>
    providerFactory(labels, (context: TreeRlProviderContext, root: string) =>
        cassetteOf(
            `s${context.seed}`,
            context.fork_point.step_index,
            `${root}:s${context.seed}`,
            root,
        ),
    );
const rewards = { alt: 2, "alt:3": 2, "alt:5": 2, base: 1, "base:3": 1, "base:5": 3 };

test("Tree-RL forks world-bound roots at checkpointed turns into restored worlds", async (context) => {
    const { directory, labels, roots, store } = await fixture(context, { kind: "provider_step" });
    const [base] = roots as [ReplaySessionInspection];
    assert.deepEqual(
        base.checkpoints.map((checkpoint) => checkpoint.step_count),
        [0, 2, 4, 5],
    );
    assert.deepEqual(
        selectTreeRlForkPoints(store, {
            maxForkPoints: 4,
            minDependents: 1,
            sessionId: base.session_id,
        }).map((point) => point.step_index),
        [0, 2],
    );
    const options = (overrides: Parameters<typeof treeRlOptions>[2]) =>
        treeRlOptions("application:tree-rl:world", labels, {
            prompts: [{ id: "task", program: worldProgram, roots: [...labels.keys()] }],
            protocol,
            provider: provider(labels),
            reward: rewardOf(labels, rewards),
            selector: fixedSelector(2),
            ...overrides,
        });
    // World-bound roots need restoration bindings; nothing is written without them.
    await assert.rejects(runTreeRlRollouts(store, options({})), /bindings is required/u);
    assert.equal(store.readOwner(deriveApplicationOwnerId("application:tree-rl:world")).length, 0);
    const worlds = new Map<string, string>();
    const receipt = await runTreeRlRollouts(
        store,
        options({
            bindings: async ({ root_session_id, seed }) => {
                const root = path.join(directory, `rollout-${labels.get(root_session_id)}-${seed}`);
                await mkdir(root);
                worlds.set(`${labels.get(root_session_id)}:${seed}`, root);
                return { handlers: writeHandlers(root), worlds: [{ name: "main", root }] };
            },
        }),
    );
    // Four turns: the admissible range is [1, 2]; turn 2 is the draft at step 2.
    assert.deepEqual(
        receipt.inspection.roots.map((root) => [root.fork.branch_turn, root.turns]),
        [
            [2, [0, 2, 4, 5]],
            [2, [0, 2, 4, 5]],
        ],
    );
    assert.equal(receipt.batch.line_count, 6);
    for (const rollout of receipt.inspection.rollouts) {
        assert.equal(rollout.record?.status, "completed");
        const label = labels.get(rollout.root_session_id) as string;
        const world = worlds.get(`${label}:${rollout.seed}`) as string;
        const session = inspectReplaySession(store, { sessionId: rollout.replay_session_id });
        const root = roots.find((entry) => entry.session_id === rollout.root_session_id);
        const checkpoint = root?.checkpoints.find((entry) => entry.step_count === 2);
        assert.equal(session.origin?.target_checkpoint_id, checkpoint?.checkpoint_id);
        assert.deepEqual(
            session.restore?.constituents
                .filter((entry) => entry.kind === "world")
                .map((entry) => [entry.name, entry.status]),
            [["main", "verified"]],
        );
        // The restored boundary state (the root's plan) plus the rollout's own suffix writes.
        assert.equal(await readFile(path.join(world, "seed.txt"), "utf8"), "initial");
        assert.equal(await readFile(path.join(world, "plan.txt"), "utf8"), `${label}:plan`);
        assert.equal(
            await readFile(path.join(world, "draft.txt"), "utf8"),
            `s${rollout.seed}:draft`,
        );
    }
    // The root worlds are never touched by a rollout.
    assert.equal(
        await readFile(path.join(directory, "root-base", "draft.txt"), "utf8"),
        "base:draft",
    );
    assert.equal(store.verifyIntegrity().ok, true);
    // Repeating the command returns the retained run without calling the bindings factory.
    const repeated = await runTreeRlRollouts(
        store,
        options({
            bindings: () => {
                throw new Error("bindings must not be called for retained rollouts");
            },
            reward: rewardOf(labels, {}),
        }),
    );
    assert.deepEqual(repeated.batch, receipt.batch);
});

test("Tree-RL refuses world-bound roots whose turns have no restorable checkpoint", async (context) => {
    const { labels, roots, store } = await fixture(context, { kind: "effect_step" });
    assert.deepEqual(
        roots[0]?.checkpoints.map((checkpoint) => checkpoint.step_count),
        [1, 3],
    );
    const commandId = "application:tree-rl:world:none";
    await assert.rejects(
        runTreeRlRollouts(
            store,
            treeRlOptions(commandId, labels, {
                bindings: () => ({}),
                prompts: [{ id: "task", program: worldProgram, roots: [...labels.keys()] }],
                protocol,
                provider: provider(labels),
            }),
        ),
        (error: unknown) =>
            error instanceof ApplicationEvidenceError &&
            /no admissible restorable fork turn/u.test(error.message),
    );
    assert.equal(store.readOwner(deriveApplicationOwnerId(commandId)).length, 0);
});

/** In-memory cooperative process adapter whose state is the list of restored images. */
function memoryProcess(restored: string[]): ReplayProcessAdapter {
    return {
        backend: "cooperative",
        checkpoint: async (checkpointContext) =>
            Buffer.from(`state:${checkpointContext.step_count}`),
        probe: async () => ({ available: true }),
        processId: "memory",
        restore: async (image) => {
            restored.push(Buffer.from(image).toString("utf8"));
        },
    };
}

test("Tree-RL restores process-bound roots into each rollout's own process adapter", async () => {
    using store = new SQLiteTraceStore();
    // Roots bound to a process with provider-step checkpoints.
    const bound = new Map<string, string>();
    for (const label of ["base", "alt"]) {
        const { inspection } = await runReplaySession(store, {
            checkpointPolicy: { kind: "provider_step" },
            claimId: "root",
            commandId: `root:process:bound:${label}`,
            processes: [memoryProcess([])],
            program: workflowProgram,
            programId: "workflow:process.v1",
            provider: cassette(label, 0, label, label),
        });
        bound.set(inspection.session_id, label);
    }
    const restored: string[] = [];
    const receipt = await runTreeRlRollouts(
        store,
        treeRlOptions("application:tree-rl:process", bound, {
            bindings: () => ({ processes: [memoryProcess(restored)] }),
            concurrency: 1,
            selector: fixedSelector(3),
        }),
    );
    assert.deepEqual(
        receipt.inspection.rollouts.map((rollout) => [
            rollout.fork_point.step_index,
            rollout.record?.status,
        ]),
        [
            [2, "completed"],
            [2, "completed"],
            [2, "completed"],
            [2, "completed"],
        ],
    );
    assert.deepEqual(restored, ["state:2", "state:2", "state:2", "state:2"]);
});
