import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { type TestContext, test } from "node:test";

import {
    createEffectHandlerStack,
    createEffectIntent,
    createMetaAgentTools,
    createReplayToolLoopBindings,
    createToolTurnProvider,
    type EffectHandlerStack,
    inspectReplaySession,
    inspectScope,
    type MetaAgentWorkerDefinition,
    type ReplaySessionContext,
    replayReplaySession,
    rewindReplaySession,
    runReplaySession,
    runToolLoop,
    type SemanticValue,
} from "../../src/index.ts";
import { providerProtocolConfig } from "../../src/protocol/config.ts";
import { createSupervisorWorld, readParentFile } from "../applications/world-adapter-fixture.ts";
import { exchangeOf, providerOf } from "../replay/fixtures.ts";
import { call, scriptedModel, text, toolResult, toolValue, userMessage } from "./fixtures.ts";

const catalog = providerProtocolConfig.tools.metaAgent.tools;
const toolName = (operation: string): string =>
    catalog.find((entry) => entry.operation === operation)?.name as string;

const EDIT_REQUEST = {
    input: { file: "file.txt", goal: "make the check pass" },
    instruction: "Propose the new file contents.",
    outputSchema: { type: "object" },
};

/**
 * Worker program: checkpoint the clean world, ask the model for an edit, write it, then run the
 * check. The check fails unless the file holds a fixed edit.
 */
async function coder(context: ReplaySessionContext): Promise<SemanticValue> {
    await context.checkpoint();
    const plan = await context.invokeProvider(EDIT_REQUEST);
    const edit = (plan.response.output as { readonly text: string }).text;
    await context.dispatchEffect(
        createEffectIntent({
            effectId: "effect:edit",
            kind: "file.write",
            payload: { name: "file.txt", text: edit },
            reversibility: "reversible",
        }),
        { dependsOn: [plan.handle] },
    );
    const check = await context.dispatchEffect(
        createEffectIntent({
            effectId: "effect:check",
            kind: "check.run",
            payload: { name: "file.txt" },
            reversibility: "reversible",
        }),
    );
    return { passed: check.outcome.result.ok };
}

function coderHandlers(root: string, calls: string[]): EffectHandlerStack {
    return createEffectHandlerStack([
        {
            handle: async (intent) => {
                const payload = intent.payload as { readonly name: string; readonly text: string };
                calls.push(`write:${payload.text}`);
                await writeFile(path.join(root, payload.name), `${payload.text}\n`);
                return { ok: true, value: { written: payload.name } };
            },
            handlerId: "handler:write",
            kind: "file.write",
        },
        {
            handle: async (intent) => {
                const name = (intent.payload as { readonly name: string }).name;
                const content = (await readFile(path.join(root, name), "utf8")).trim();
                calls.push(`check:${content}`);
                return content.startsWith("fixed")
                    ? { ok: true, value: { passed: true } }
                    : { error: { failed: "check rejected the edit", content }, ok: false };
            },
            handlerId: "handler:check",
            kind: "check.run",
        },
    ]);
}

/**
 * Records the Figure 1 meta session: a meta-agent forks a coder worker, observes its failing edit,
 * rewinds it, replays it under the careful variant, diffs the two sessions, and discards the
 * failed worker's custody.
 */
async function recordFigure1(context: TestContext) {
    const world = await createSupervisorWorld(context, "figure1");
    const store = world.store;
    const rootsDirectory = path.join(world.workspaceRoot, "restorations");
    const roots: { readonly operation: string; readonly root: string }[] = [];
    const workerCalls: string[] = [];
    const worker: MetaAgentWorkerDefinition = {
        handlers: (root) => coderHandlers(root, workerCalls),
        program: coder,
        programId: "program:coder.v1",
        // A second exchange answers a worker forked by a replay of the meta session.
        provider: providerOf("provider:coder", [
            exchangeOf(EDIT_REQUEST, { text: "buggy edit" }),
            exchangeOf(EDIT_REQUEST, { text: "buggy edit" }),
        ]),
        variants: {
            careful: {
                changes: ["provider"],
                provider: providerOf("provider:coder-careful", [
                    exchangeOf(EDIT_REQUEST, { text: "fixed edit" }),
                ]),
            },
        },
        world: "repo",
    };
    const meta = createMetaAgentTools({
        allocateRoot: async ({ operation, world: name }) => {
            const root = path.join(rootsDirectory, `${operation}-${name}-${roots.length}`);
            await mkdir(root, { recursive: true });
            roots.push({ operation, root });
            return root;
        },
        claimId: "meta-agent",
        clock: () => 2_000,
        store,
        workers: { coder: worker },
        world: world.adapter,
    });
    assert.deepEqual(
        meta.tools.map((tool) => tool.name),
        catalog.map((entry) => entry.name),
    );

    let workerSession = "";
    let custodyId = "";
    let checkpointId = "";
    let replaySession = "";
    const { provider, requests } = scriptedModel("model:meta-agent", [
        [
            text("Forking a worker."),
            call("t0", toolName("fork"), { worker: "coder", worker_id: "w1" }),
        ],
        (request) => {
            const forked = toolResult(request, "t0").content.result as {
                readonly ok: boolean;
                readonly value: Record<string, SemanticValue>;
            };
            assert.equal(forked.ok, true);
            workerSession = forked.value.session_id as string;
            custodyId = forked.value.custody_id as string;
            return [
                call("t1", toolName("observe"), { session_id: workerSession }),
                call("t2", toolName("read_trace"), { max_records: 2, owner_id: workerSession }),
            ];
        },
        (request) => {
            const observed = toolValue<{
                readonly checkpoints: readonly {
                    readonly checkpoint_id: string;
                    readonly step_count: number;
                }[];
                readonly result: { readonly passed: boolean };
                readonly steps: readonly {
                    readonly effect_kind?: string;
                    readonly ok?: boolean | null;
                }[];
            }>(request, "t1");
            assert.deepEqual(observed.result, { passed: false });
            const failing = observed.steps.find((step) => step.effect_kind === "check.run");
            assert.equal(failing?.ok, false);
            const trace = toolValue<{
                readonly records: readonly unknown[];
                readonly has_more: boolean;
            }>(request, "t2");
            assert.equal(trace.records.length, 2);
            assert.equal(trace.has_more, true);
            checkpointId = observed.checkpoints[0]?.checkpoint_id as string;
            assert.equal(observed.checkpoints[0]?.step_count, 0);
            return [
                text("The edit failed its check; reverting to the clean checkpoint."),
                call("t3", toolName("rewind"), {
                    checkpoint_id: checkpointId,
                    session_id: workerSession,
                }),
            ];
        },
        (request) => {
            assert.equal(toolResult(request, "t3").isError, false);
            return [
                call("t4", toolName("replay"), {
                    checkpoint_id: checkpointId,
                    session_id: workerSession,
                    variant: "careful",
                }),
            ];
        },
        (request) => {
            const retried = toolValue<{
                readonly result: { readonly passed: boolean };
                readonly session_id: string;
            }>(request, "t4");
            assert.deepEqual(retried.result, { passed: true });
            replaySession = retried.session_id;
            return [
                call("t5", toolName("diff"), {
                    replay_session_id: replaySession,
                    source_session_id: workerSession,
                }),
                call("t6", toolName("discard"), { custody_id: custodyId, worker_id: "w1" }),
            ];
        },
        (request) => {
            const diff = toolValue<{
                readonly first_divergence_index: number;
                readonly unexplained: readonly number[];
            }>(request, "t5");
            assert.equal(diff.first_divergence_index, 0);
            assert.deepEqual(diff.unexplained, []);
            assert.equal(toolResult(request, "t6").isError, false);
            return [text("Retried worker passes its check.")];
        },
    ]);

    const metaCalls: string[] = [];
    const handlers = createEffectHandlerStack(
        meta.handlers.map((handler) => ({
            ...handler,
            handle: (intent: Parameters<typeof handler.handle>[0]) => {
                metaCalls.push(intent.kind);
                return handler.handle(intent);
            },
        })),
    );
    const { inspection: metaSession } = await runReplaySession(store, {
        claimId: "meta-agent",
        commandId: "session:meta-agent",
        handlers,
        program: async (session) =>
            (
                await runToolLoop({
                    ...createReplayToolLoopBindings(session),
                    loopId: "figure-1",
                    messages: [userMessage("Get a coder worker to make the check pass.")],
                    system: "You supervise coding workers with substrate tools.",
                    tools: meta.tools,
                })
            ).output,
        programId: "program:meta-agent.v1",
        provider: createToolTurnProvider(provider),
    });
    return {
        custodyId,
        handlers,
        meta,
        metaCalls,
        metaSession,
        replaySession,
        requests,
        roots,
        store,
        workerCalls,
        workerSession,
        world,
    };
}

test("Figure 1: a meta-agent forks a worker, observes its failing edit, reverts it, and retries", async (context) => {
    const {
        custodyId,
        metaCalls,
        metaSession,
        replaySession,
        requests,
        roots,
        store,
        workerCalls,
        workerSession,
        world,
    } = await recordFigure1(context);

    // The meta-agent finished, and every tool call is a retained intent/outcome effect step.
    assert.equal(metaSession.terminal?.status, "finished");
    assert.deepEqual(metaSession.terminal?.result, { value: "Retried worker passes its check." });
    assert.equal(requests.length, 6);
    const effectKinds = metaSession.steps
        .filter((step) => step.effect !== null)
        .map((step) => step.effect?.intent.kind);
    assert.deepEqual(
        effectKinds,
        ["fork", "observe", "read_trace", "rewind", "replay", "diff", "discard"].map(
            (operation) => catalog.find((entry) => entry.operation === operation)?.effectKind,
        ),
    );
    assert.deepEqual(metaCalls, effectKinds);
    for (const step of metaSession.steps.filter((entry) => entry.effect !== null)) {
        assert.equal(step.effect?.disposition, "materialized");
        assert.equal(step.effect?.outcome?.result.ok, true);
    }

    // The worker's failing edit, the revert, and the successful retry are real substrate records.
    const failed = inspectReplaySession(store, { sessionId: workerSession });
    assert.deepEqual(failed.terminal?.result, { value: { passed: false } });
    const rewound = roots.find((entry) => entry.operation === "rewind")?.root as string;
    assert.equal(await readFile(path.join(rewound, "file.txt"), "utf8"), "source\n");
    const retried = inspectReplaySession(store, { sessionId: replaySession });
    assert.equal(retried.mode, "replay");
    assert.deepEqual(retried.terminal?.result, { value: { passed: true } });
    const replayRoot = roots.find((entry) => entry.operation === "replay")?.root as string;
    assert.equal(await readFile(path.join(replayRoot, "file.txt"), "utf8"), "fixed edit\n");
    assert.deepEqual(workerCalls, [
        "write:buggy edit",
        "check:buggy edit",
        "write:fixed edit",
        "check:fixed edit",
    ]);

    // The failed worker's forked custody is discarded and the parent world is untouched.
    const scopes = store
        .listScopeRegistrations()
        .map((row) => inspectScope(store, row.scope_id))
        .filter((scope) => scope?.world?.custody_id === custodyId);
    assert.equal(scopes.length, 1);
    assert.equal(scopes[0]?.state, "discarded");
    assert.equal(await readParentFile(world, "file.txt"), "source\n");
    assert.equal(store.verifyIntegrity().ok, true);
});

test("Figure 1: rewinding the meta session before its substrate calls invokes no compensation", async (context) => {
    const { metaCalls, metaSession, store } = await recordFigure1(context);
    const calls = metaCalls.length;
    const { inspection } = await rewindReplaySession(store, {
        claimId: "meta-agent",
        commandId: "session:meta-agent:rewind",
        sourceSessionId: metaSession.session_id,
        target: { stepCount: 0 },
        worlds: [],
    });
    assert.equal(inspection.terminal?.status, "rewound");
    assert.equal(metaCalls.length, calls);
    const replayStep = metaSession.steps.find(
        (step) =>
            step.effect?.intent.kind ===
            catalog.find((entry) => entry.operation === "replay")?.effectKind,
    );
    assert.equal(replayStep?.effect?.intent.reversibility, "reversible");
});

test("Figure 1: a replay of the meta session scopes its live substrate commands to the branch", async (context) => {
    const { custodyId, handlers, meta, metaSession, store, workerCalls, workerSession } =
        await recordFigure1(context);
    const recordedWorkerCalls = workerCalls.length;
    let forked: Record<string, SemanticValue> = {};
    const { provider } = scriptedModel("model:meta-agent-retry", [
        [call("t0", toolName("fork"), { worker: "coder", worker_id: "w2" })],
        (request) => {
            forked = toolValue<Record<string, SemanticValue>>(request, "t0");
            return [text("Forked a second worker.")];
        },
    ]);
    const { inspection } = await replayReplaySession(store, {
        changes: ["provider"],
        claimId: "meta-agent",
        commandId: "session:meta-agent:replay",
        handlers,
        program: async (session) =>
            (
                await runToolLoop({
                    ...createReplayToolLoopBindings(session),
                    loopId: "figure-1",
                    messages: [userMessage("Get a coder worker to make the check pass.")],
                    system: "You supervise coding workers with substrate tools.",
                    tools: meta.tools,
                })
            ).output,
        provider: createToolTurnProvider(provider),
        sourceSessionId: metaSession.session_id,
        target: { stepCount: 0 },
    });
    assert.equal(inspection.terminal?.status, "finished");
    assert.equal(forked.worker_id, "w2");
    assert.notEqual(forked.session_id, workerSession);
    assert.notEqual(forked.custody_id, custodyId);
    assert.equal(typeof forked.custody_id, "string");
    assert.deepEqual(forked.result, { passed: false });
    assert.deepEqual(workerCalls.slice(recordedWorkerCalls), [
        "write:buggy edit",
        "check:buggy edit",
    ]);
    // The source's own fork receipt is untouched and still names the first worker.
    const source = inspectReplaySession(store, { sessionId: workerSession });
    assert.deepEqual(source.terminal?.result, { value: { passed: false } });
    assert.equal(store.verifyIntegrity().ok, true);
});

test("Figure 1: a replay of the meta session serves its recorded prefix byte-identically", async (context) => {
    const { handlers, meta, metaCalls, metaSession, requests, store } =
        await recordFigure1(context);
    const calls = metaCalls.length;
    const recorded = requests.slice();
    const stepCount = metaSession.steps.length - 1;
    const { provider } = scriptedModel("model:meta-agent-tail", [
        ...recorded.slice(0, -1).map(() => () => {
            throw new Error("the recorded prefix must not reach the model");
        }),
        [text("Retried worker passes its check.")],
    ]);
    const { inspection } = await replayReplaySession(store, {
        changes: ["provider"],
        claimId: "meta-agent",
        commandId: "session:meta-agent:tail",
        handlers,
        program: async (session) =>
            (
                await runToolLoop({
                    ...createReplayToolLoopBindings(session),
                    loopId: "figure-1",
                    messages: [userMessage("Get a coder worker to make the check pass.")],
                    system: "You supervise coding workers with substrate tools.",
                    tools: meta.tools,
                })
            ).output,
        provider: createToolTurnProvider(provider),
        sourceSessionId: metaSession.session_id,
        target: { stepCount },
    });
    assert.equal(inspection.terminal?.status, "finished");
    assert.equal(metaCalls.length, calls);
    for (const [index, step] of inspection.steps.slice(0, stepCount).entries()) {
        const source = metaSession.steps[index];
        assert.equal(step.source, "recorded");
        assert.equal(step.effect?.intent_ref, source?.effect?.intent_ref);
        assert.equal(step.provider?.prompt_id, source?.provider?.prompt_id);
    }
});
