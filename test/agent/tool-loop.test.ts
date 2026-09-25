import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import {
    canonicalizeRecord,
    createEffectHandlerStack,
    createHandlerToolLoopEffects,
    createReplayToolLoopBindings,
    createSupervisedToolLoopEffects,
    createToolTurnProvider,
    deriveSupervisedDispatchId,
    type EffectHandlerStack,
    encodeToolTurnRequest,
    inspectReplaySession,
    inspectSupervisedDispatch,
    type ModelMessage,
    type ReplaySessionContext,
    replayReplaySession,
    rewindReplaySession,
    runReplaySession,
    runToolLoop,
    SQLiteTraceStore,
    type ToolLoopTool,
    type ToolLoopTurn,
} from "../../src/index.ts";
import { providerProtocolConfig } from "../../src/protocol/config.ts";
import { temporaryDirectory } from "../replay/fixtures.ts";
import { call, scriptedModel, text, toolResult, userMessage } from "./fixtures.ts";

const loopConfig = providerProtocolConfig.tools.loop;

const tools: readonly ToolLoopTool[] = [
    {
        description: "Look up one key.",
        effectKind: "test.lookup",
        inputSchema: {
            additionalProperties: false,
            properties: { key: { minLength: 1, type: "string" } },
            required: ["key"],
            type: "object",
        },
        name: "lookup",
        reversibility: "reversible",
    },
    {
        description: "Delete one key.",
        effectKind: "test.delete",
        inputSchema: {
            additionalProperties: false,
            properties: { key: { type: "string" } },
            required: ["key"],
            type: "object",
        },
        name: "delete",
        reversibility: "compensable",
    },
];

function handlers(calls: string[]): EffectHandlerStack {
    return createEffectHandlerStack([
        {
            handle: (intent) => {
                const key = (intent.payload as { input: { key: string } }).input.key;
                calls.push(`lookup:${key}`);
                return key === "missing"
                    ? { error: { reason: "not found" }, ok: false }
                    : { ok: true, value: { key, value: `v:${key}` } };
            },
            handlerId: "handler:lookup",
            kind: "test.lookup",
        },
        {
            handle: (intent) => {
                calls.push(`delete:${(intent.payload as { input: { key: string } }).input.key}`);
                return { ok: true, value: null };
            },
            handlerId: "handler:delete",
            kind: "test.delete",
        },
    ]);
}

/** Script: lookup a and an invalid call, then lookup missing and an unknown tool, then finish. */
function script() {
    return scriptedModel("model:loop", [
        [text("Looking."), call("u1", "lookup", { key: "a" }), call("u2", "lookup", { key: "" })],
        (request) => {
            assert.equal(toolResult(request, "u1").content.disposition, "materialized");
            assert.equal(toolResult(request, "u2").content.disposition, "invalid");
            return [call("u3", "lookup", { key: "missing" }), call("u4", "shred", {})];
        },
        (request) => {
            assert.equal(toolResult(request, "u3").isError, true);
            return [text(`done:${toolResult(request, "u4").content.disposition}`)];
        },
    ]);
}

test("every admissible tool call becomes a correlated intent and outcome through the handler stack", async () => {
    const effects: string[] = [];
    const observed: ToolLoopTurn[] = [];
    const { provider, requests } = script();
    const result = await runToolLoop({
        effects: createHandlerToolLoopEffects(handlers(effects)),
        guidance: ({ turn }) => (turn.index === 0 ? "Prefer existing keys." : null),
        loopId: "loop:handlers",
        messages: [userMessage("Find a.")],
        model: provider,
        onTurn: (turn) => {
            observed.push(turn);
        },
        system: "You look things up.",
        tools,
    });
    assert.equal(result.status, loopConfig.statuses[0]);
    assert.equal(result.output, "done:invalid");
    assert.deepEqual(effects, ["lookup:a", "lookup:missing"]);
    assert.deepEqual(observed, result.turns);
    const [first, second] = result.turns;
    assert.ok(first && second);
    assert.deepEqual(
        first.calls.map((entry) => [entry.disposition, entry.intent?.effect_id ?? null]),
        [
            ["materialized", `${loopConfig.effectIdPrefix}loop:handlers:0:0`],
            ["invalid", null],
        ],
    );
    const lookup = first.calls[0];
    assert.equal(lookup?.intent?.kind, "test.lookup");
    assert.equal(lookup?.intent?.reversibility, "reversible");
    assert.deepEqual(lookup?.intent?.payload, {
        input: { key: "a" },
        tool: "lookup",
        tool_use_id: "u1",
    });
    assert.equal(lookup?.outcome?.intent_ref !== undefined, true);
    assert.equal(lookup?.outcome?.effect_id, lookup?.intent?.effect_id);
    assert.match(first.calls[1]?.reason ?? "", /\$\.key/u);
    assert.equal(first.guidance, "Prefer existing keys.");
    assert.deepEqual(
        second.calls.map((entry) => entry.disposition),
        ["materialized", "invalid"],
    );
    assert.equal(second.calls[0]?.outcome?.result.ok, false);
    assert.equal(second.guidance, null);
    // The guidance text follows the tool results in the next user message.
    const afterFirst = requests[1]?.messages.at(-1) as ModelMessage;
    assert.deepEqual(
        afterFirst.content.map((block) => block.type),
        ["tool_result", "tool_result", "text"],
    );
    assert.equal(requests[1]?.cachePrefixMessages, requests[1]?.messages.length);
    assert.deepEqual(
        requests[0]?.tools?.map((tool) => tool.name),
        ["lookup", "delete"],
    );
    assert.equal(result.messages.length, 6);
});

test("the loop stops at its configured turn bound and refuses bounds beyond the maximum", async () => {
    const effects: string[] = [];
    const { provider } = scriptedModel(
        "model:forever",
        Array.from({ length: loopConfig.maxTurns + 1 }, (_, index) => [
            call(`u${index}`, "lookup", { key: `k${index}` }),
        ]),
    );
    const base = {
        effects: createHandlerToolLoopEffects(handlers(effects)),
        loopId: "loop:bounded",
        messages: [userMessage("Loop.")],
        model: provider,
        tools,
    };
    const result = await runToolLoop({ ...base, maxTurns: 2 });
    assert.equal(result.status, loopConfig.statuses[1]);
    assert.equal(result.output, null);
    assert.equal(result.turns.length, 2);
    assert.deepEqual(effects, ["lookup:k0", "lookup:k1"]);
    await assert.rejects(runToolLoop({ ...base, maxTurns: loopConfig.maxTurns + 1 }), TypeError);
    await assert.rejects(runToolLoop({ ...base, maxTurns: 0 }), TypeError);
    const defaulted = await runToolLoop({ ...base, loopId: "loop:default" });
    assert.equal(defaulted.turns.length, loopConfig.defaultMaxTurns);
});

test("an abort signal stops the loop between turns with its reason", async () => {
    const controller = new AbortController();
    const effects: string[] = [];
    const { provider } = scriptedModel("model:abort", [
        [call("u1", "lookup", { key: "a" })],
        [text("never")],
    ]);
    await assert.rejects(
        runToolLoop({
            effects: createHandlerToolLoopEffects(handlers(effects)),
            loopId: "loop:abort",
            messages: [userMessage("Stop.")],
            model: provider,
            onTurn: () => controller.abort(new Error("stop requested")),
            signal: controller.signal,
            tools,
        }),
        /stop requested/u,
    );
    assert.deepEqual(effects, ["lookup:a"]);
});

test("a denied tool-call intent resolves before any outcome and the handler never runs", async (context) => {
    const directory = await temporaryDirectory(context, "tool-deny");
    using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    const effects: string[] = [];
    const { provider } = scriptedModel("model:deny", [
        [call("u1", "delete", { key: "a" }), call("u2", "lookup", { key: "a" })],
        (request) => {
            const denied = toolResult(request, "u1");
            assert.equal(denied.isError, true);
            assert.equal(denied.content.disposition, "denied");
            assert.match(String(denied.content.reason), /deletes are not allowed/u);
            return [text("understood")];
        },
    ]);
    const result = await runToolLoop({
        effects: createSupervisedToolLoopEffects({
            claimId: "supervisor",
            handlers: handlers(effects),
            interceptors: [
                {
                    decide: ({ intent }) =>
                        intent.kind === "test.delete"
                            ? { decision: "deny", reason: "deletes are not allowed" }
                            : { decision: "allow" },
                    interceptorId: "policy:no-delete",
                    priority: 0,
                    timeoutMilliseconds: 1_000,
                    timeoutPolicy: "fail_closed",
                },
            ],
            store,
        }),
        loopId: "loop:deny",
        messages: [userMessage("Clean up.")],
        model: provider,
        tools,
    });
    assert.equal(result.output, "understood");
    assert.deepEqual(effects, ["lookup:a"]);
    const [denied, allowed] = result.turns[0]?.calls ?? [];
    assert.equal(denied?.disposition, "denied");
    assert.equal(denied?.outcome, null);
    assert.equal(allowed?.disposition, "materialized");
    const deniedDispatch = inspectSupervisedDispatch(store, {
        dispatchId: deriveSupervisedDispatchId(denied?.intent?.effect_id as string),
    });
    assert.equal(deniedDispatch.intent.kind, "test.delete");
    assert.equal(deniedDispatch.decisions[0]?.decision, "deny");
    assert.equal(deniedDispatch.admission_record_id, null);
    assert.equal(deniedDispatch.resolution?.disposition, "denied");
    assert.equal(deniedDispatch.resolution?.outcome, null);
    const allowedDispatch = inspectSupervisedDispatch(store, {
        dispatchId: deriveSupervisedDispatchId(allowed?.intent?.effect_id as string),
    });
    assert.notEqual(allowedDispatch.admission_record_id, null);
    assert.equal(allowedDispatch.resolution?.disposition, "materialized");
    assert.deepEqual(allowedDispatch.resolution?.outcome, allowed?.outcome);
    assert.equal(store.verifyIntegrity().ok, true);
});

test("replaying a recorded loop serves its prefix byte-identically and runs only the suffix live", async (context) => {
    const directory = await temporaryDirectory(context, "tool-replay");
    using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    const turns = [
        [call("u1", "lookup", { key: "a" })],
        [call("u2", "lookup", { key: "b" })],
        [call("u3", "lookup", { key: "c" })],
        [text("finished")],
    ];
    const transcripts: (readonly ModelMessage[])[] = [];
    const program = async (context: ReplaySessionContext) => {
        const result = await runToolLoop({
            ...createReplayToolLoopBindings(context),
            guidance: ({ turn }) => `after turn ${turn.index}`,
            loopId: "loop:replayed",
            messages: [userMessage("Look up three keys.")],
            system: "You look things up.",
            tools,
        });
        transcripts.push(result.messages);
        return result.output;
    };
    const sourceEffects: string[] = [];
    const source = scriptedModel("model:source", turns);
    const { inspection: recorded } = await runReplaySession(store, {
        claimId: "meta",
        commandId: "session:loop",
        handlers: handlers(sourceEffects),
        program,
        programId: "program:tool-loop.v1",
        provider: createToolTurnProvider(source.provider),
    });
    assert.equal(recorded.terminal?.status, "finished");
    assert.deepEqual(recorded.terminal?.result, { value: "finished" });
    assert.deepEqual(
        recorded.steps.map((step) => step.kind),
        ["provider", "effect", "provider", "effect", "provider", "effect", "provider"],
    );
    // Each provider step retains the encoded turn request.
    assert.deepEqual(
        recorded.steps[0]?.provider?.request,
        encodeToolTurnRequest(source.requests[0] as never),
    );
    assert.deepEqual(sourceEffects, ["lookup:a", "lookup:b", "lookup:c"]);

    const suffixEffects: string[] = [];
    const suffix = scriptedModel("model:suffix", turns);
    const target = 4;
    const { inspection: branch } = await replayReplaySession(store, {
        changes: ["provider"],
        claimId: "meta",
        commandId: "session:loop:replay",
        handlers: handlers(suffixEffects),
        program,
        provider: createToolTurnProvider(suffix.provider),
        sourceSessionId: recorded.session_id,
        target: { stepCount: target },
    });
    assert.equal(branch.terminal?.status, "finished");
    assert.deepEqual(
        branch.steps.map((step) => step.source),
        ["recorded", "recorded", "recorded", "recorded", "live", "live", "live"],
    );
    for (const index of [0, 1, 2, 3]) {
        const left = recorded.steps[index];
        const right = branch.steps[index];
        assert.equal(right?.step_id, left?.step_id);
        assert.equal(right?.prefix_id, left?.prefix_id);
        assert.equal(
            canonicalizeRecord({
                effect: (right?.effect?.outcome ?? null) as never,
                request: (right?.provider?.request ?? null) as never,
                response: (right?.provider?.response?.output ?? null) as never,
            }),
            canonicalizeRecord({
                effect: (left?.effect?.outcome ?? null) as never,
                request: (left?.provider?.request ?? null) as never,
                response: (left?.provider?.response?.output ?? null) as never,
            }),
        );
    }
    // The prefix neither called the model nor any handler; the suffix did both live.
    assert.equal(suffix.requests.length, 2);
    assert.deepEqual(suffixEffects, ["lookup:c"]);
    // The loop observed the same conversation over the recorded prefix and in total.
    const [sourceMessages, branchMessages] = transcripts;
    assert.equal(
        canonicalizeRecord({ messages: branchMessages as never }),
        canonicalizeRecord({ messages: sourceMessages as never }),
    );
    assert.equal(branch.steps[4]?.step_id, recorded.steps[4]?.step_id);

    const { inspection: rewound } = await rewindReplaySession(store, {
        claimId: "meta",
        commandId: "session:loop:rewind",
        sourceSessionId: recorded.session_id,
        target: { stepCount: target },
    });
    assert.deepEqual(
        rewound.steps.map((step) => step.step_id),
        recorded.steps.slice(0, target).map((step) => step.step_id),
    );
    assert.equal(
        inspectReplaySession(store, { sessionId: rewound.session_id }).terminal?.status,
        "rewound",
    );
    assert.equal(store.verifyIntegrity().ok, true);
});

test("a changed guidance over the recorded prefix is a prefix mismatch", async (context) => {
    const directory = await temporaryDirectory(context, "tool-mismatch");
    using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    const turns = [[call("u1", "lookup", { key: "a" })], [text("finished")]];
    const programWith = (guidance: string) => async (context: ReplaySessionContext) =>
        (
            await runToolLoop({
                ...createReplayToolLoopBindings(context),
                guidance: () => guidance,
                loopId: "loop:mismatch",
                messages: [userMessage("Look up a.")],
                tools,
            })
        ).output;
    const { inspection: recorded } = await runReplaySession(store, {
        claimId: "meta",
        commandId: "session:mismatch",
        handlers: handlers([]),
        program: programWith("original"),
        programId: "program:tool-loop.v1",
        provider: createToolTurnProvider(scriptedModel("model:a", turns).provider),
    });
    const { inspection: branch } = await replayReplaySession(store, {
        claimId: "meta",
        commandId: "session:mismatch:replay",
        handlers: handlers([]),
        program: programWith("changed"),
        provider: createToolTurnProvider(scriptedModel("model:b", turns).provider),
        sourceSessionId: recorded.session_id,
        target: { stepCount: 3 },
    });
    assert.equal(branch.terminal?.status, "failed");
    assert.equal(branch.terminal?.failure?.name, "ReplayPrefixMismatchError");
});
