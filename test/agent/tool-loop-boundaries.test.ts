import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import {
    createEffectHandlerStack,
    createEffectIntent,
    createEffectOutcome,
    createHandlerToolLoopEffects,
    createLiveProvider,
    createMetaAgentTools,
    createProgramConversationProvider,
    createReplayToolLoopBindings,
    createSupervisedToolLoopEffects,
    createToolTurnProvider,
    LiveProviderError,
    type ModelConversationRequest,
    ReplayEffectRefusedError,
    type ReplaySessionContext,
    ReplayStepFailureError,
    replayReplaySession,
    rewindReplaySession,
    runReplaySession,
    runToolLoop,
    SQLiteTraceStore,
    type ToolLoopEffects,
    type ToolLoopTool,
} from "../../src/index.ts";
import { providerProtocolConfig } from "../../src/protocol/config.ts";
import { scriptedTransport } from "../provider/live-fixtures.ts";
import { emptyDirectory, temporaryDirectory } from "../replay/fixtures.ts";
import {
    call,
    resultOf,
    scriptedModel,
    text,
    toolResult,
    userMessage,
    ZERO_USAGE,
} from "./fixtures.ts";

const loopConfig = providerProtocolConfig.tools.loop;
const metaAgent = providerProtocolConfig.tools.metaAgent;
const signal = () => new AbortController().signal;

const echo: ToolLoopTool = {
    description: "Echo text.",
    effectKind: "test.echo",
    inputSchema: {
        additionalProperties: false,
        properties: { text: { type: "string" } },
        required: ["text"],
        type: "object",
    },
    name: "echo",
    reversibility: "reversible",
};

const echoHandlers = (fail = false) =>
    createEffectHandlerStack([
        {
            handle: (intent) => {
                if (fail) {
                    throw new Error("echo handler crashed");
                }
                return {
                    ok: true,
                    value: (intent.payload as { input: { text: string } }).input.text,
                };
            },
            handlerId: "handler:echo",
            kind: "test.echo",
        },
    ]);

function oneCall(input: Record<string, string> = { text: "hi" }) {
    return scriptedModel("model:one", [[call("u1", "echo", input)], [text("done")]]);
}

test("loop options, tools, guidance, and effect results are validated", async () => {
    const { provider } = oneCall();
    const base = {
        effects: createHandlerToolLoopEffects(echoHandlers()),
        loopId: "loop:validation",
        messages: [userMessage("Echo.")],
        model: provider,
        tools: [echo],
    };
    const malformed: unknown[] = [
        null,
        [],
        { ...base, extra: true },
        { ...base, loopId: "" },
        { ...base, model: {} },
        { ...base, effects: {} },
        { ...base, guidance: "later" },
        { ...base, onTurn: 1 },
        { ...base, maxTurns: 1.5 },
        { ...base, messages: [] },
        { ...base, messages: "hi" },
        { ...base, tools: "echo" },
        { ...base, tools: [echo, echo] },
        { ...base, tools: [null] },
        { ...base, tools: [{ ...echo, name: "" }] },
        { ...base, tools: [{ ...echo, reversibility: "maybe" }] },
        { ...base, tools: [{ ...echo, inputSchema: { not: {} } }] },
    ];
    for (const options of malformed) {
        await assert.rejects(runToolLoop(options as never), TypeError);
    }
    await assert.rejects(
        runToolLoop({ ...base, guidance: () => "" }),
        /guidance must be non-empty text or null/u,
    );
    const intent = createEffectIntent({
        effectId: "other",
        kind: "test.echo",
        payload: null,
        reversibility: "reversible",
    });
    const boundaries: [ToolLoopEffects["dispatch"], RegExp][] = [
        [async () => null as never, /must return a disposition/u],
        [async () => ({ disposition: "materialized", outcome: null }) as never, /malformed/u],
        [async () => ({ disposition: "denied", reason: "" }) as never, /malformed/u],
        [
            async () => ({
                disposition: "materialized",
                outcome: createEffectOutcome(intent, { ok: true, value: null }),
            }),
            /uncorrelated outcome/u,
        ],
    ];
    for (const [dispatch, message] of boundaries) {
        await assert.rejects(
            runToolLoop({ ...base, effects: { dispatch }, model: oneCall().provider }),
            message,
        );
    }
    const failed = await runToolLoop({
        ...base,
        effects: { dispatch: async () => ({ disposition: "failed", reason: "world unavailable" }) },
        model: scriptedModel("model:failed", [
            [call("u1", "echo", { text: "hi" })],
            (request) => {
                assert.deepEqual(toolResult(request, "u1"), {
                    content: { disposition: "failed", reason: "world unavailable" },
                    isError: true,
                });
                return [text("gave up")];
            },
        ]).provider,
    });
    assert.equal(failed.turns[0]?.calls[0]?.disposition, "failed");
    await assert.rejects(
        runToolLoop({ ...base, effects: createHandlerToolLoopEffects(echoHandlers(true)) }),
        /echo handler crashed/u,
    );
});

test("oversized tool results are truncated to the configured byte bound", async () => {
    const long = "é".repeat(loopConfig.maxResultBytes);
    const result = await runToolLoop({
        effects: createHandlerToolLoopEffects(echoHandlers()),
        loopId: "loop:truncate",
        messages: [userMessage("Echo long.")],
        model: oneCall({ text: long }).provider,
        tools: [echo],
    });
    const content = result.turns[0]?.calls[0]?.result.content ?? "";
    assert.ok(content.endsWith(loopConfig.truncationMarker));
    assert.ok(
        Buffer.byteLength(content) <=
            loopConfig.maxResultBytes + Buffer.byteLength(loopConfig.truncationMarker),
    );
    assert.equal(content.includes("�"), false);
});

test("effect boundaries map supervised and replay resolutions to dispositions", async (context) => {
    const directory = await temporaryDirectory(context, "tool-boundaries");
    using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    assert.throws(() => createSupervisedToolLoopEffects(null as never), TypeError);
    assert.throws(
        () => createSupervisedToolLoopEffects({ claimId: "c", handlers: {} as never, store }),
        TypeError,
    );
    assert.throws(() => createHandlerToolLoopEffects(null as never), TypeError);
    assert.throws(() => createReplayToolLoopBindings(null as never), TypeError);
    assert.throws(() => createToolTurnProvider({} as never), TypeError);

    const failed = await runToolLoop({
        effects: createSupervisedToolLoopEffects({
            claimId: "supervisor",
            clock: () => 5_000,
            handlers: echoHandlers(true),
            store,
        }),
        loopId: "loop:supervised-failure",
        messages: [userMessage("Echo.")],
        model: oneCall().provider,
        tools: [echo],
    });
    assert.equal(failed.turns[0]?.calls[0]?.disposition, "failed");
    assert.match(failed.turns[0]?.calls[0]?.reason ?? "", /materialization_failed/u);

    const expired = await runToolLoop({
        effects: createSupervisedToolLoopEffects({
            approvalTimeoutMilliseconds: 1,
            claimId: "supervisor",
            handlers: echoHandlers(),
            store,
        }),
        loopId: "loop:supervised-expired",
        messages: [userMessage("Echo.")],
        model: oneCall().provider,
        tools: [{ ...echo, reversibility: "irreversible" }],
    });
    assert.equal(expired.turns[0]?.calls[0]?.disposition, "denied");
    assert.match(expired.turns[0]?.calls[0]?.reason ?? "", /^rejected: /u);

    const controller = new AbortController();
    await assert.rejects(
        runToolLoop({
            effects: createSupervisedToolLoopEffects({
                claimId: "supervisor",
                handlers: echoHandlers(),
                interceptors: [
                    {
                        decide: async () => {
                            controller.abort(new Error("cancelled by caller"));
                            return { decision: "allow" };
                        },
                        interceptorId: "policy:cancel",
                        priority: 0,
                        timeoutMilliseconds: 1_000,
                        timeoutPolicy: "fail_closed",
                    },
                ],
                store,
            }),
            loopId: "loop:supervised-cancel",
            messages: [userMessage("Echo.")],
            model: oneCall().provider,
            signal: controller.signal,
            tools: [echo],
        }),
        /cancelled by caller/u,
    );

    const stub = (dispatchEffect: ReplaySessionContext["dispatchEffect"]) =>
        createReplayToolLoopBindings({
            dispatchEffect,
            invokeProvider: async () => {
                throw new Error("unused");
            },
        } as unknown as ReplaySessionContext).effects;
    const intent = createEffectIntent({
        effectId: "e",
        kind: "test.echo",
        payload: null,
        reversibility: "reversible",
    });
    assert.deepEqual(
        await stub(async () => {
            throw new ReplayStepFailureError(2, "Error", "handler crashed");
        }).dispatch(intent, signal()),
        { disposition: "failed", reason: "Error: handler crashed" },
    );
    assert.equal(
        (
            await stub(async () => {
                throw new ReplayEffectRefusedError(3);
            }).dispatch(intent, signal())
        ).disposition,
        "denied",
    );
    await assert.rejects(
        stub(async () => {
            throw new RangeError("unexpected");
        }).dispatch(intent, signal()),
        RangeError,
    );
});

test("a replayed irreversible tool call without replay approval is denied inside the loop", async (context) => {
    const directory = await temporaryDirectory(context, "tool-refused");
    using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    const tools = [{ ...echo, reversibility: "irreversible" as const }];
    const turns = [[call("u1", "echo", { text: "once" })], [text("done")]];
    const dispositions: string[] = [];
    const program = async (session: ReplaySessionContext) => {
        const result = await runToolLoop({
            ...createReplayToolLoopBindings(session),
            loopId: "loop:irreversible",
            messages: [userMessage("Echo once.")],
            tools,
        });
        dispositions.push(result.turns[0]?.calls[0]?.disposition as string);
        return result.output;
    };
    const { inspection: source } = await runReplaySession(store, {
        claimId: "meta",
        commandId: "session:irreversible",
        handlers: echoHandlers(),
        program,
        programId: "program:irreversible.v1",
        provider: createToolTurnProvider(scriptedModel("model:a", turns).provider),
    });
    const { inspection: branch } = await replayReplaySession(store, {
        changes: ["provider"],
        claimId: "meta",
        commandId: "session:irreversible:replay",
        handlers: echoHandlers(),
        program,
        provider: createToolTurnProvider(scriptedModel("model:b", turns).provider),
        sourceSessionId: source.session_id,
        target: { stepCount: 0 },
    });
    assert.equal(branch.terminal?.status, "finished");
    assert.deepEqual(dispositions, ["materialized", "denied"]);
    assert.equal(branch.steps[1]?.effect?.disposition, "refused");
});

test("the turn provider accepts only encoded turns and step outputs must be encoded responses", async (context) => {
    const { provider } = oneCall();
    const turnProvider = createToolTurnProvider(provider);
    assert.equal(turnProvider.descriptor().id, "model:one");
    await assert.rejects(
        turnProvider.invoke(
            { input: { step: 0 }, instruction: "other", outputSchema: { type: "object" } },
            signal(),
        ),
        /encoded tool-use turn requests/u,
    );
    const directory = await temporaryDirectory(context, "tool-turn");
    using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    const { inspection } = await runReplaySession(store, {
        claimId: "meta",
        commandId: "session:unencoded",
        program: async (session) =>
            (
                await runToolLoop({
                    ...createReplayToolLoopBindings(session),
                    loopId: "loop:unencoded",
                    messages: [userMessage("Hi.")],
                    tools: [],
                })
            ).output,
        programId: "program:unencoded.v1",
        provider: {
            descriptor: () => provider.descriptor(),
            invoke: async () => ({ output: "plain text", usage: ZERO_USAGE }),
        },
    });
    assert.equal(inspection.terminal?.status, "failed");
    assert.match(inspection.terminal?.failure?.message ?? "", /encoded turn response/u);
});

test("program conversation providers validate definitions and replies and serve single turns", async () => {
    for (const definition of [
        null,
        [],
        { id: "p", respond: () => null, unknown: 1 },
        { id: "", respond: () => null },
        { id: "p", model: "", respond: () => null },
        { id: "p" },
    ]) {
        assert.throws(() => createProgramConversationProvider(definition as never), TypeError);
    }
    const reply = (role: string, stopReason: string) =>
        createProgramConversationProvider({
            id: "p",
            respond: () =>
                ({
                    message: { content: [text("ok")], role },
                    output: "ok",
                    stopReason,
                    usage: ZERO_USAGE,
                }) as never,
        });
    const request: ModelConversationRequest = {
        cachePrefixMessages: 0,
        messages: [userMessage("hi")],
        outputSchema: null,
        system: null,
    };
    await assert.rejects(reply("user", "end").converse(request, signal()), /assistant message/u);
    await assert.rejects(reply("assistant", "").converse(request, signal()), /stopReason/u);
    const served = await reply("assistant", "end").invoke(
        { input: { a: 1 }, instruction: "Say ok.", outputSchema: { type: "string" } },
        signal(),
    );
    assert.deepEqual(served, { output: "ok", usage: ZERO_USAGE });
    const aborted = new AbortController();
    aborted.abort(new Error("aborted early"));
    await assert.rejects(
        reply("assistant", "end").invoke(
            { input: null, instruction: "x", outputSchema: {} },
            aborted.signal,
        ),
        /aborted early/u,
    );
    const late = new AbortController();
    await assert.rejects(
        createProgramConversationProvider({
            id: "p",
            respond: () => {
                late.abort(new Error("aborted during respond"));
                return {
                    message: { content: [text("ok")], role: "assistant" },
                    output: "ok",
                    stopReason: "end",
                    usage: ZERO_USAGE,
                };
            },
        }).converse(request, late.signal),
        /aborted during respond/u,
    );
    const invalidBlocks: unknown[] = [
        { text: "", type: "text" },
        { id: "", input: {}, name: "echo", type: "tool_use" },
        { id: "c", input: [], name: "echo", type: "tool_use" },
        { content: "", isError: false, toolUseId: "c", type: "tool_result" },
        { content: "x", isError: "no", toolUseId: "c", type: "tool_result" },
        { type: "image" },
        "plain text",
    ];
    for (const block of invalidBlocks) {
        const role = (block as { type: string }).type === "tool_use" ? "assistant" : "user";
        await assert.rejects(
            reply("assistant", "end").converse(
                { ...request, messages: [userMessage("hi"), { content: [block], role } as never] },
                signal(),
            ),
            TypeError,
        );
    }
    for (const tools of [
        "echo",
        [{ description: "", inputSchema: {}, name: "echo" }],
        [{ description: "d", inputSchema: [], name: "echo" }],
    ]) {
        await assert.rejects(
            reply("assistant", "end").converse({ ...request, tools } as never, signal()),
            TypeError,
        );
    }
});

test("live tool calls with non-canonical inputs or unparsable arguments are refused", async () => {
    const anthropic = providerProtocolConfig.live.kinds
        .anthropic as (typeof providerProtocolConfig.live.kinds)[string];
    const openai = providerProtocolConfig.live.kinds
        .openai as (typeof providerProtocolConfig.live.kinds)[string];
    const request: ModelConversationRequest = {
        cachePrefixMessages: 1,
        messages: [userMessage("hi")],
        outputSchema: null,
        system: null,
    };
    const cases = [
        [
            "anthropic",
            `{"content":[{"type":"tool_use","id":"c","name":"echo","input":{"x":1e400}}],"stop_reason":"${anthropic.toolUse.stopReasons[0]}","usage":{"input_tokens":1,"output_tokens":1}}`,
        ],
        [
            "openai",
            JSON.stringify({
                choices: [
                    {
                        finish_reason: openai.toolUse.stopReasons[0],
                        message: {
                            tool_calls: [
                                {
                                    function: { arguments: "{not json", name: "echo" },
                                    id: "c",
                                    type: "function",
                                },
                            ],
                        },
                    },
                ],
                usage: { completion_tokens: 1, prompt_tokens: 1 },
            }),
        ],
        [
            "openai",
            JSON.stringify({
                choices: [
                    { finish_reason: openai.toolUse.stopReasons[0], message: { tool_calls: {} } },
                ],
                usage: { completion_tokens: 1, prompt_tokens: 1 },
            }),
        ],
        [
            "openai",
            JSON.stringify({
                choices: [
                    {
                        finish_reason: openai.toolUse.stopReasons[0],
                        message: {
                            tool_calls: [
                                {
                                    function: { arguments: "{}", name: "echo" },
                                    id: "c",
                                    type: "custom",
                                },
                            ],
                        },
                    },
                ],
                usage: { completion_tokens: 1, prompt_tokens: 1 },
            }),
        ],
    ] as const;
    for (const [kind, body] of cases) {
        const { transport } = scriptedTransport([{ body, status: 200 }]);
        await assert.rejects(
            createLiveProvider({ credential: "k", id: "p", kind, model: "m", transport }).converse(
                request,
                signal(),
            ),
            LiveProviderError,
        );
    }
});

test("meta-agent tool environments are validated and branches are observable", async (context) => {
    const directory = await temporaryDirectory(context, "meta-environment");
    using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    const worker = {
        program: async () => "ok",
        programId: "program:noop.v1",
        world: "main",
    };
    const base = {
        allocateRoot: async () => emptyDirectory(directory, "unused"),
        claimId: "meta",
        store,
        workers: { noop: worker },
    };
    for (const environment of [
        null,
        [],
        { ...base, extra: 1 },
        { ...base, allocateRoot: "dir" },
        { ...base, claimId: "" },
        { ...base, clock: 1 },
        { ...base, store: {} },
        { ...base, workers: null },
        { ...base, workers: { a: worker, b: worker } },
        { ...base, workers: { a: { ...worker, program: null } } },
        { ...base, world: { fork: () => null } },
    ]) {
        assert.throws(() => createMetaAgentTools(environment as never), TypeError);
    }
    const { inspection: source } = await runReplaySession(store, {
        claimId: "meta",
        commandId: "session:undeclared",
        program: async () => "done",
        programId: "program:undeclared.v1",
    });
    const { inspection: rewound } = await rewindReplaySession(store, {
        claimId: "meta",
        commandId: "session:undeclared:rewind",
        sourceSessionId: source.session_id,
        target: { stepCount: 0 },
    });
    const meta = createMetaAgentTools(base);
    const stack = createEffectHandlerStack(meta.handlers);
    const dispatch = (operation: string, input: Record<string, string | number>) => {
        const entry = metaAgent.tools.find((tool) => tool.operation === operation);
        return stack.dispatch(
            createEffectIntent({
                effectId: `call:${operation}`,
                kind: entry?.effectKind as string,
                payload: { input, tool: entry?.name as string, tool_use_id: "u" },
                reversibility: "reversible",
            }),
        );
    };
    const observed = await dispatch("observe", { session_id: rewound.session_id });
    assert.deepEqual(resultOf<{ origin: unknown }>(observed.outcome.result).origin, {
        changes: [],
        source_session_id: source.session_id,
        target_step_count: 0,
    });
    const refused = await dispatch("replay", {
        session_id: source.session_id,
        step_count: 0,
        variant: "any",
    });
    assert.match(
        resultOf<{ message: string }>(refused.outcome.result).message,
        /no declared worker runs program/u,
    );
});
