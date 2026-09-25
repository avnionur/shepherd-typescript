import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";

import {
    createEffectHandlerStack,
    createEffectIntent,
    type EffectHandlerStack,
    inspectReplaySession,
    type ModelRequest,
    type ReplayCheckpointPolicy,
    type ReplayProcessAdapter,
    type ReplaySessionContext,
    runTrajectoryCompression,
    SQLiteTraceStore,
    type TrajectoryCompressionBindingsContext,
    type TrajectoryCompressionProgram,
} from "../../src/index.ts";
import {
    compressionOptions,
    compressorOf,
    exploreWorkflow,
    forkAt,
    notifyHandlers,
    stageProvider,
} from "./compression-fixtures.ts";

function stageRequest(stage: string, prior: unknown): ModelRequest {
    return {
        input: { prior: prior as never, stage },
        instruction: `perform ${stage}`,
        outputSchema: { type: "object" },
    };
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

function writeOf(name: string, text: string) {
    return createEffectIntent({
        effectId: `effect:write:${name}`,
        kind: "file.write",
        payload: { name, text },
        reversibility: "reversible",
    });
}

/**
 * World-bound explore workflow: plan (0), write plan.txt (1), explore-a (2), explore-b (3), write
 * notes.txt (4), and the answer from the plan (5). Under a hint, the explorations and the notes
 * write are skipped from the fork point on, so the same answer is reached in fewer steps.
 */
const worldWorkflow: TrajectoryCompressionProgram =
    (guidance) => async (context: ReplaySessionContext) => {
        const shortcut = () =>
            guidance !== null &&
            guidance.hint !== null &&
            context.step_count >= guidance.fork_point.step_index;
        const plan = await context.invokeProvider(stageRequest("plan", null));
        const text = (plan.response.output as { readonly text: string }).text;
        await context.dispatchEffect(writeOf("plan.txt", text), { dependsOn: [plan.handle] });
        let prior = plan;
        for (const stage of ["explore-a", "explore-b"]) {
            if (shortcut()) {
                break;
            }
            prior = await context.invokeProvider(stageRequest(stage, prior.response.output), {
                dependsOn: [prior.handle],
            });
        }
        if (!shortcut()) {
            await context.dispatchEffect(writeOf("notes.txt", "explored"), {
                dependsOn: [prior.handle],
            });
        }
        const answer = await context.invokeProvider(stageRequest("answer", plan.response.output), {
            dependsOn: [plan.handle],
        });
        return answer.response.output;
    };

async function treeOf(root: string): Promise<Record<string, string>> {
    const tree: Record<string, string> = {};
    for (const name of (await readdir(root)).sort()) {
        tree[name] = createHash("sha256")
            .update(await readFile(path.join(root, name)))
            .digest("hex");
    }
    return tree;
}

async function fixture(context: TestContext, label: string, policy: ReplayCheckpointPolicy) {
    const directory = await mkdtemp(path.join(tmpdir(), `shepherd-compression-${label}-`));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    context.after(() => store.close());
    const roots = new Map<string, string>();
    const calls: TrajectoryCompressionBindingsContext[] = [];
    const bindings = async (bindingContext: TrajectoryCompressionBindingsContext) => {
        calls.push(bindingContext);
        const key = `${bindingContext.role}-${bindingContext.seed ?? "none"}`;
        const root = path.join(directory, key);
        await mkdir(root, { recursive: true });
        roots.set(key, root);
        return { handlers: writeHandlers(root), worlds: [{ name: "main", root }] };
    };
    const workflow = {
        bindings,
        checkpointPolicy: policy,
        program: worldWorkflow,
        programId: "workflow:world-explore.v1",
        provider: stageProvider("base"),
    };
    return { calls, directory, roots, store, workflow };
}

test("compression prunes a world-bound source from a checkpoint into a restored world", async (context) => {
    const { calls, roots, store, workflow } = await fixture(context, "world-pruned", {
        interval: 1,
        kind: "every_n_steps",
    });
    const { inspection } = await runTrajectoryCompression(
        store,
        compressionOptions("application:compression:world", {
            compressor: compressorOf(forkAt(2)),
            workflow,
        }),
    );
    const source = inspectReplaySession(store, { sessionId: inspection.source_session_id });
    assert.deepEqual(source.worlds, ["main"]);
    assert.deepEqual(
        source.checkpoints.map((checkpoint) => checkpoint.step_count),
        [0, 1, 2, 3, 4, 5],
    );
    const { outcome: settled, rewound } = inspection.compression;
    assert.ok(settled && rewound);
    assert.equal(settled.outcome, "pruned");
    assert.equal(rewound.restore?.classification, "reconstructive");
    assert.deepEqual(
        rewound.restore?.constituents.map((entry) => [entry.kind, entry.name, entry.status]),
        [
            ["trace_cut", null, "verified"],
            ["world", "main", "verified"],
            ["provider_session", null, "reconstructive"],
            ["irreversible_effects", null, "verified"],
        ],
    );
    const compressed = inspectReplaySession(store, { sessionId: settled.session_id as string });
    assert.equal(
        compressed.origin?.target_checkpoint_id,
        source.checkpoints.find((checkpoint) => checkpoint.step_count === 2)?.checkpoint_id,
    );
    assert.equal(compressed.steps.length, 3);
    assert.deepEqual(compressed.terminal?.result, source.terminal?.result);

    const sourceTree = await treeOf(roots.get("source-none") as string);
    assert.deepEqual(Object.keys(sourceTree), ["notes.txt", "plan.txt"]);
    // The rewind and the compressed session start from the boundary-2 world: plan.txt only.
    const boundaryTree = { "plan.txt": sourceTree["plan.txt"] };
    assert.deepEqual(await treeOf(roots.get("rewind-none") as string), boundaryTree);
    assert.deepEqual(await treeOf(roots.get("compressed-none") as string), boundaryTree);
    // Controls rerun the whole workflow into their own worlds.
    for (const seed of [7, 19]) {
        assert.deepEqual(await treeOf(roots.get(`control-${seed}`) as string), sourceTree);
    }
    assert.deepEqual(
        calls.map((entry) => [entry.role, entry.seed]),
        [
            ["source", null],
            ["rewind", null],
            ["compressed", null],
            ["control", 7],
            ["control", 19],
        ],
    );
    assert.equal(store.verifyIntegrity().ok, true);
});

test("a world-bound fork point without a retained checkpoint settles no_prune as unavailable", async (context) => {
    const { calls, store, workflow } = await fixture(context, "world-unavailable", {
        kind: "provider_step",
    });
    const { inspection } = await runTrajectoryCompression(
        store,
        compressionOptions("application:compression:world:unavailable", {
            compressor: compressorOf(forkAt(1)),
            workflow,
        }),
    );
    const source = inspectReplaySession(store, { sessionId: inspection.source_session_id });
    assert.deepEqual(
        source.checkpoints.map((checkpoint) => checkpoint.step_count),
        [0, 2, 3, 5],
    );
    const settled = inspection.compression.outcome;
    assert.equal(settled?.outcome, "no_prune");
    assert.equal(settled?.reason, "the fork point has an unavailable restore constituent");
    assert.deepEqual(settled?.restore, {
        classification: "unavailable",
        constituents: [
            {
                kind: "world",
                name: "main",
                reason: "step boundary has no retained checkpoint",
                status: "unavailable",
            },
        ],
        restore_record_id: null,
        rewind_session_id: null,
    });
    assert.equal(inspection.outcome?.outcome, "no_prune");
    assert.deepEqual(
        calls.map((entry) => entry.role),
        ["source", "control", "control"],
    );
});

test("a process-bound fork point without a retained checkpoint names the process unavailable", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-compression-process-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    const process: ReplayProcessAdapter = {
        backend: "cooperative",
        checkpoint: async () => Buffer.from("state"),
        probe: async () => ({ available: true }),
        processId: "memory",
        restore: async () => {},
    };
    const { inspection } = await runTrajectoryCompression(
        store,
        compressionOptions("application:compression:process", {
            workflow: {
                bindings: () => ({ processes: [process] }),
                handlers: notifyHandlers,
                program: exploreWorkflow(),
                programId: "workflow:explore-answer.v1",
                provider: stageProvider("base"),
            },
        }),
    );
    assert.deepEqual(inspection.compression.outcome?.restore?.constituents, [
        {
            kind: "process",
            name: "memory",
            reason: "step boundary has no retained checkpoint",
            status: "unavailable",
        },
    ]);
});
