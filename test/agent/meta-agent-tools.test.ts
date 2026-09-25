import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import {
    createEffectCompensationRegistry,
    createEffectHandlerStack,
    createEffectIntent,
    createMetaAgentTools,
    deriveReplaySessionId,
    inspectReplaySession,
    runReplaySession,
    SQLiteTraceStore,
} from "../../src/index.ts";
import { providerProtocolConfig } from "../../src/protocol/config.ts";
import { META_AGENT_TOOL_OPERATIONS } from "../../src/protocol/config-types.ts";
import { emptyDirectory, temporaryDirectory, worldHandlers } from "../replay/fixtures.ts";
import { resultOf } from "./fixtures.ts";

const metaAgent = providerProtocolConfig.tools.metaAgent;

function intent(operation: string, input: Record<string, string | number>, effectId: string) {
    const entry = metaAgent.tools.find((tool) => tool.operation === operation);
    assert.ok(entry);
    return createEffectIntent({
        effectId,
        kind: entry.effectKind,
        payload: { input, tool: entry.name, tool_use_id: effectId },
        reversibility: entry.reversibility as "reversible",
    });
}

test("the configured catalog binds every operation to one tool with a JSON Schema", () => {
    assert.deepEqual(
        metaAgent.tools.map((tool) => tool.operation).sort(),
        [...META_AGENT_TOOL_OPERATIONS].sort(),
    );
    for (const tool of metaAgent.tools) {
        assert.equal(tool.inputSchema.type, "object");
        assert.ok(tool.description.length > 0);
    }
});

test("tools without a world adapter fork into allocated roots and report substrate refusals as results", async (context) => {
    const directory = await temporaryDirectory(context, "meta-tools");
    using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    let allocated = 0;
    const meta = createMetaAgentTools({
        allocateRoot: async ({ operation, world }) => {
            allocated += 1;
            return emptyDirectory(directory, `${operation}-${world}-${allocated}`);
        },
        claimId: "meta",
        store,
        workers: {
            writer: {
                handlers: (root) => worldHandlers(root),
                program: async (context) => {
                    await context.dispatchEffect(
                        createEffectIntent({
                            effectId: "effect:write",
                            kind: "file.write",
                            payload: { name: "out.txt", text: "hello" },
                            reversibility: "reversible",
                        }),
                    );
                    return "written";
                },
                programId: "program:writer.v1",
                world: "main",
            },
        },
    });
    const stack = createEffectHandlerStack(meta.handlers);
    const forked = await stack.dispatch(
        intent("fork", { worker: "writer", worker_id: "w" }, "call:fork"),
    );
    assert.equal(forked.outcome.result.ok, true);
    const value = resultOf<Record<string, string | null>>(forked.outcome.result);
    assert.equal(value.custody_id, null);
    assert.equal(value.status, "finished");
    assert.equal(await readFile(path.join(directory, "fork-main-1", "out.txt"), "utf8"), "hello");
    // A repeated intent converges on the retained session without re-running the worker.
    const repeated = await stack.dispatch(
        intent("fork", { worker: "writer", worker_id: "w" }, "call:fork"),
    );
    assert.deepEqual(
        resultOf<Record<string, string>>(repeated.outcome.result).session_id,
        value.session_id,
    );
    for (const [operation, input] of [
        ["fork", { worker: "unknown", worker_id: "w" }],
        ["discard", { custody_id: "custody", worker_id: "w" }],
        ["replay", { session_id: value.session_id as string, step_count: 0, variant: "none" }],
        ["observe", { session_id: "replay-session:missing" }],
    ] as const) {
        const refused = await stack.dispatch(intent(operation, input, `call:${operation}`));
        assert.equal(refused.outcome.result.ok, false, operation);
        const error = resultOf<{ name: string; message: string }>(refused.outcome.result);
        assert.ok(error.name.length > 0 && error.message.length > 0);
    }
    const trace = await stack.dispatch(
        intent("read_trace", { owner_id: value.session_id as string }, "call:read"),
    );
    const records = resultOf<{ records: unknown[]; has_more: boolean }>(trace.outcome.result);
    assert.equal(records.has_more, false);
    assert.ok(
        records.records.length > 0 && records.records.length <= metaAgent.limits.maxTraceRecords,
    );
    await assert.rejects(
        stack.dispatch(intent("observe", { session: "wrong" }, "call:bad")),
        TypeError,
    );
});

test("observe summarizes failed, refused, and running sessions and replay applies handler variants", async (context) => {
    const directory = await temporaryDirectory(context, "meta-observe");
    using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    let allocated = 0;
    const write = (text: string) =>
        createEffectIntent({
            effectId: `effect:${text}`,
            kind: "file.write",
            payload: { name: "out.txt", text },
            reversibility: "reversible",
        });
    const meta = createMetaAgentTools({
        allocateRoot: async ({ operation, world }) => {
            if (world === "strings") {
                throw "no roots for strings";
            }
            if (world === "plain") {
                throw new Error("no plain roots");
            }
            allocated += 1;
            return emptyDirectory(directory, `${operation}-${world}-${allocated}`);
        },
        claimId: "meta",
        clock: () => 3_000,
        store,
        workers: {
            crashing: {
                handlers: () =>
                    createEffectHandlerStack([
                        {
                            handle: () => {
                                throw new Error("disk full");
                            },
                            handlerId: "handler:crash",
                            kind: "file.write",
                        },
                    ]),
                program: async (session) => {
                    await session.dispatchEffect(write("never"));
                },
                programId: "program:crashing.v1",
                world: "main",
            },
            mute: {
                program: async (session) => {
                    await session.invokeProvider({
                        input: null,
                        instruction: "Say something.",
                        outputSchema: { type: "object" },
                    });
                },
                programId: "program:mute.v1",
                provider: {
                    descriptor: () => ({
                        capabilities: providerProtocolConfig.program.capabilities,
                        id: "provider:mute",
                        kind: "program",
                        model: null,
                    }),
                    invoke: async () => {
                        throw new Error("provider offline");
                    },
                },
                world: "main",
            },
            plain: { program: async () => null, programId: "program:plain.v1", world: "plain" },
            strings: {
                program: async () => null,
                programId: "program:strings.v1",
                world: "strings",
            },
            writer: {
                handlers: (root) => worldHandlers(root),
                program: async (session) => {
                    await session.checkpoint();
                    await session.dispatchEffect(write("first"));
                    return "written";
                },
                programId: "program:writer.v1",
                variants: {
                    suffixed: {
                        changes: ["handlers"],
                        handlers: (root) => worldHandlers(root, [], "-suffixed"),
                    },
                },
                world: "main",
            },
        },
    });
    const stack = createEffectHandlerStack(meta.handlers);
    const run = async (operation: string, input: Record<string, string | number>, id: string) =>
        (await stack.dispatch(intent(operation, input, id))).outcome.result;

    const crashed = resultOf<{ session_id: string; status: string }>(
        await run("fork", { worker: "crashing", worker_id: "c" }, "call:crash"),
    );
    assert.equal(crashed.status, "failed");
    const crashedSteps = resultOf<{
        failure: { name: string };
        steps: { disposition: string; ok: boolean | null; result: unknown }[];
    }>(await run("observe", { session_id: crashed.session_id }, "call:observe-crash"));
    assert.equal(crashedSteps.failure.name, "ReplayStepFailureError");
    assert.deepEqual(crashedSteps.steps[0], {
        disposition: "materialization_failed",
        effect_kind: "file.write",
        index: 0,
        kind: "effect",
        ok: null,
        result: null,
        source: "live",
    });

    const mute = resultOf<{ session_id: string }>(
        await run("fork", { worker: "mute", worker_id: "m" }, "call:mute"),
    );
    const muteSteps = resultOf<{ steps: { failure: { message: string }; output: unknown }[] }>(
        await run("observe", { session_id: mute.session_id }, "call:observe-mute"),
    );
    assert.equal(muteSteps.steps[0]?.output, null);
    assert.match(muteSteps.steps[0]?.failure.message ?? "", /provider offline/u);

    for (const [worker, name, message] of [
        ["strings", "Error", "no roots for strings"],
        ["plain", "Error", "no plain roots"],
    ] as const) {
        const refused = await run("fork", { worker, worker_id: worker }, `call:${worker}`);
        assert.equal(refused.ok, false);
        assert.deepEqual(resultOf(refused), { code: null, message, name });
    }

    const written = resultOf<{ session_id: string }>(
        await run("fork", { worker: "writer", worker_id: "w" }, "call:writer"),
    );
    const byStep = await run(
        "rewind",
        { session_id: written.session_id, step_count: 1 },
        "call:rewind-step",
    );
    assert.equal(byStep.ok, false);
    assert.equal(resultOf<{ name: string }>(byStep).name, "ReplayCheckpointUnavailableError");
    const checkpoint = resultOf<{ checkpoints: { checkpoint_id: string }[] }>(
        await run("observe", { session_id: written.session_id }, "call:observe-writer"),
    ).checkpoints[0]?.checkpoint_id as string;
    const replayed = resultOf<{ result: string; status: string }>(
        await run(
            "replay",
            { checkpoint_id: checkpoint, session_id: written.session_id, variant: "suffixed" },
            "call:replay-suffixed",
        ),
    );
    assert.equal(replayed.status, "finished");
    const replayRoot = path.join(directory, `replay-main-${allocated}`);
    assert.equal(await readFile(path.join(replayRoot, "out.txt"), "utf8"), "first-suffixed");

    const { inspection: worldless } = await runReplaySession(store, {
        claimId: "meta",
        commandId: "session:worldless-writer",
        program: async () => "none",
        programId: "program:writer.v1",
    });
    const unbound = await run(
        "replay",
        { session_id: worldless.session_id, step_count: 0, variant: "suffixed" },
        "call:replay-unbound",
    );
    assert.match(resultOf<{ message: string }>(unbound).message, /does not bind world main/u);

    let release = (): void => undefined;
    const running = runReplaySession(store, {
        claimId: "worker",
        commandId: "session:running",
        program: () =>
            new Promise((resolve) => {
                release = () => resolve("released");
            }),
        programId: "program:running.v1",
    });
    await new Promise((resolve) => setImmediate(resolve));
    const live = resultOf<{ result: unknown; status: string }>(
        await run(
            "observe",
            { session_id: deriveReplaySessionId("session:running") },
            "call:observe-running",
        ),
    );
    assert.equal(live.status, "running");
    assert.equal(live.result, null);
    release();
    assert.equal((await running).inspection.terminal?.status, "finished");
});

test("the replay tool retains its source while the rewind tool compensates its suffix", async (context) => {
    const directory = await temporaryDirectory(context, "meta-compensation");
    using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    let allocated = 0;
    const materialized: string[] = [];
    const compensated: string[] = [];
    const handlers = () =>
        createEffectHandlerStack([
            {
                handle: (intent) => {
                    materialized.push(intent.effect_id);
                    return { ok: true, value: null };
                },
                handlerId: "handler:ledger",
                kind: "ledger.record",
            },
        ]);
    const meta = createMetaAgentTools({
        allocateRoot: async ({ operation, world }) => {
            allocated += 1;
            return emptyDirectory(directory, `${operation}-${world}-${allocated}`);
        },
        claimId: "meta",
        store,
        workers: {
            ledger: {
                compensation: createEffectCompensationRegistry([
                    {
                        compensate: (request) => {
                            compensated.push(request.intent.effect_id);
                            return { ok: true, value: null };
                        },
                        handlerId: "compensation:ledger",
                        kind: "ledger.record",
                    },
                ]),
                handlers,
                program: async (session) => {
                    await session.checkpoint();
                    await session.dispatchEffect(
                        createEffectIntent({
                            effectId: "effect:ledger",
                            kind: "ledger.record",
                            payload: { entry: "result" },
                            reversibility: "compensable",
                        }),
                    );
                    return "recorded";
                },
                programId: "program:ledger.v1",
                variants: { again: { changes: ["handlers"], handlers } },
                world: "main",
            },
        },
    });
    const stack = createEffectHandlerStack(meta.handlers);
    const forked = resultOf<Record<string, string>>(
        (await stack.dispatch(intent("fork", { worker: "ledger", worker_id: "w" }, "call:fork")))
            .outcome.result,
    );
    const sessionId = forked.session_id as string;
    const checkpointId = inspectReplaySession(store, { sessionId }).checkpoints[0]
        ?.checkpoint_id as string;
    const target = { checkpoint_id: checkpointId, session_id: sessionId };
    const replayed = await stack.dispatch(
        intent("replay", { ...target, variant: "again" }, "call:replay"),
    );
    assert.equal(replayed.outcome.result.ok, true);
    assert.deepEqual(materialized, ["effect:ledger", "effect:ledger"]);
    assert.deepEqual(compensated, []);
    const rewound = await stack.dispatch(intent("rewind", target, "call:rewind"));
    assert.equal(rewound.outcome.result.ok, true);
    assert.deepEqual(compensated, ["effect:ledger"]);
});
