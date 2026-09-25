import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import {
    createLiveProvider,
    createProviderConversation,
    type LiveProviderTransport,
    type ModelRequest,
    type ReplaySessionContext,
    replayReplaySession,
    rewindReplaySession,
    runReplaySession,
    SQLiteTraceStore,
} from "../../src/index.ts";
import { temporaryDirectory } from "../replay/fixtures.ts";
import {
    anthropicReply,
    cachingTransport,
    liveRequest,
    scriptedTransport,
    type TransportCall,
} from "./live-fixtures.ts";

const KEY = "sk-ant-conversation-credential-0123456789";
const SYSTEM = "Stable system prompt for the conversation.";

function conversationOver(transport: LiveProviderTransport) {
    return createProviderConversation({
        adapterId: "conversation:fixture",
        provider: createLiveProvider({
            credential: KEY,
            id: "provider:claude",
            kind: "anthropic",
            model: "fixture-model",
            transport,
        }),
        system: SYSTEM,
    });
}

function programOf(finalRequest: ModelRequest) {
    return async (context: ReplaySessionContext) => {
        await context.invokeProvider(liveRequest(0));
        await context.invokeProvider(liveRequest(1));
        await context.checkpoint();
        const final = await context.invokeProvider(finalRequest);
        return final.response.output;
    };
}

function messagesOf(call: TransportCall | undefined): readonly unknown[] {
    return (call?.parsed.messages ?? []) as readonly unknown[];
}

test("a rewound provider conversation resends a byte-identical message prefix and hits the prompt cache", async (context) => {
    const directory = await temporaryDirectory(context, "conversation");
    using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    const { calls, transport } = cachingTransport([
        '{"text":"a"}',
        '{"text":"b"}',
        '{"text":"c"}',
        '{"text":"c"}',
        '{"text":"d"}',
        '{"text":"c"}',
    ]);
    const conversation = conversationOver(transport);
    const { inspection: root } = await runReplaySession(store, {
        claimId: "worker",
        commandId: "root:conversation",
        program: programOf(liveRequest(2)),
        programId: "program:conversation",
        provider: conversation.provider,
        providerSession: conversation.session,
    });
    assert.equal(root.terminal?.status, "finished");
    assert.equal(calls.length, 3);
    assert.deepEqual(calls[1]?.parsed.system, [{ text: SYSTEM, type: "text" }]);
    assert.deepEqual(messagesOf(calls[1]).slice(0, 1), [
        {
            content: [
                {
                    text: JSON.stringify({
                        input: { step: 0 },
                        instruction: "Summarize the step.",
                        output_schema: liveRequest(0).outputSchema,
                    }),
                    type: "text",
                },
            ],
            role: "user",
        },
    ]);
    assert.deepEqual(messagesOf(calls[1])[1], {
        content: [{ text: '{"text":"a"}', type: "text" }],
        role: "assistant",
    });
    const rootFinal = root.steps[2]?.provider;
    assert.equal(rootFinal?.cache?.status, "hit");
    assert.ok((rootFinal?.cache?.read_input_tokens ?? 0) > 0);
    assert.match(String(rootFinal?.cache?.identity), /^provider-prefix:/u);
    assert.equal(conversation.contextPrefixId(), rootFinal?.context_prefix_id);
    assert.equal(conversation.messages().length, 6);
    const checkpointMessages = conversation.messages().slice(0, 4);
    const checkpoint = root.checkpoints[0];
    assert.ok(checkpoint);
    const providerConstituent = checkpoint.constituents.find(
        (constituent) => constituent.kind === "provider_session",
    );
    assert.equal(providerConstituent?.status, "verified");
    assert.match(String(providerConstituent?.receipt_id), /^provider-conversation:/u);

    const { inspection: replayed } = await replayReplaySession(store, {
        claimId: "operator",
        commandId: "replay:conversation",
        program: programOf(liveRequest(2)),
        provider: conversation.provider,
        providerSession: conversation.session,
        sourceSessionId: root.session_id,
        target: { checkpointId: checkpoint.checkpoint_id },
    });
    assert.equal(replayed.terminal?.status, "finished");
    assert.deepEqual(
        replayed.steps.map((step) => step.source),
        ["recorded", "recorded", "live"],
    );
    assert.equal(calls.length, 4);
    assert.equal(calls[3]?.body, calls[2]?.body);
    const replayedFinal = replayed.steps[2]?.provider;
    assert.equal(replayedFinal?.cache?.status, "hit");
    assert.equal(replayedFinal?.cache?.creation_input_tokens, 0);
    assert.ok(
        (replayedFinal?.cache?.read_input_tokens ?? 0) > (rootFinal?.cache?.read_input_tokens ?? 0),
    );
    assert.equal(replayedFinal?.cache?.identity, rootFinal?.cache?.identity);
    assert.equal(replayedFinal?.context_prefix_id, rootFinal?.context_prefix_id);
    assert.equal(replayed.restore?.constituents[1]?.status, "verified");

    const { inspection: diverged } = await replayReplaySession(store, {
        claimId: "operator",
        commandId: "replay:conversation:diverged",
        program: programOf(liveRequest(9)),
        provider: conversation.provider,
        providerSession: conversation.session,
        sourceSessionId: root.session_id,
        target: { checkpointId: checkpoint.checkpoint_id },
    });
    assert.equal(diverged.terminal?.status, "finished");
    const original = calls[2]?.body ?? "";
    const branch = calls[4]?.body ?? "";
    const prefixEnd = original.indexOf(JSON.stringify(messagesOf(calls[2])[4]));
    assert.ok(prefixEnd > 0);
    assert.equal(branch.slice(0, prefixEnd), original.slice(0, prefixEnd));
    assert.notEqual(branch, original);
    assert.equal(diverged.steps[2]?.provider?.cache?.status, "hit");
    assert.equal(diverged.steps[2]?.provider?.cache?.identity, rootFinal?.cache?.identity);

    const restarted = conversationOver(transport);
    restarted.rebuild(root.steps.slice(0, 2));
    assert.deepEqual(restarted.messages(), checkpointMessages);
    assert.equal(restarted.contextPrefixId(), root.steps[1]?.provider?.context_prefix_id);
    const { inspection: rebuilt } = await replayReplaySession(store, {
        claimId: "operator",
        commandId: "replay:conversation:rebuilt",
        program: programOf(liveRequest(2)),
        provider: restarted.provider,
        sourceSessionId: root.session_id,
        target: { stepCount: 2 },
    });
    assert.equal(rebuilt.terminal?.status, "finished");
    assert.equal(rebuilt.restore?.constituents[1]?.status, "reconstructive");
    assert.equal(calls[5]?.body, calls[2]?.body);
    assert.equal(
        rebuilt.steps[2]?.provider?.cache?.read_input_tokens,
        replayedFinal?.cache?.read_input_tokens,
    );

    const rewound = await rewindReplaySession(store, {
        claimId: "operator",
        commandId: "rewind:conversation",
        providerSession: restarted.session,
        sourceSessionId: root.session_id,
        target: { checkpointId: checkpoint.checkpoint_id },
    });
    assert.equal(rewound.inspection.terminal?.status, "failed");
    assert.match(String(rewound.inspection.terminal?.failure?.message), /does not hold/u);
});

test("failed and cancelled turns keep the conversation aligned with the replay session", async (context) => {
    const directory = await temporaryDirectory(context, "conversation-failure");
    using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    const { transport } = scriptedTransport([
        anthropicReply('{"text":"a"}'),
        {
            body: JSON.stringify({ error: { message: "overloaded", type: "overloaded_error" } }),
            status: 529,
        },
        anthropicReply('"not an object"'),
        anthropicReply('{"text":"c"}'),
    ]);
    const conversation = conversationOver(transport);
    const { inspection } = await runReplaySession(store, {
        claimId: "worker",
        commandId: "root:failure",
        program: async (replayContext) => {
            await replayContext.invokeProvider(liveRequest(0));
            await assert.rejects(replayContext.invokeProvider(liveRequest(1)), /overloaded/u);
            await replayContext.invokeProvider(liveRequest(2));
            return (await replayContext.checkpoint()).checkpoint_id;
        },
        programId: "program:failure",
        provider: conversation.provider,
        providerSession: conversation.session,
    });
    assert.equal(inspection.terminal?.status, "finished");
    assert.equal(inspection.steps[1]?.provider?.failure?.name, "LiveProviderError");
    assert.equal(conversation.contextPrefixId(), inspection.steps[2]?.provider?.context_prefix_id);
    assert.equal(conversation.messages().length, 4);
    assert.equal(
        inspection.checkpoints[0]?.constituents.find((entry) => entry.kind === "provider_session")
            ?.status,
        "verified",
    );
    const rebuilt = conversationOver(transport);
    rebuilt.rebuild(inspection.steps);
    assert.deepEqual(rebuilt.messages(), conversation.messages());
    assert.equal(rebuilt.contextPrefixId(), conversation.contextPrefixId());

    const before = conversation.contextPrefixId();
    const controller = new AbortController();
    const pending = conversationOver(
        () =>
            new Promise((_resolve, reject) => {
                controller.signal.addEventListener("abort", () => reject(new Error("closed")));
            }),
    );
    const turn = pending.provider.invoke(liveRequest(0), controller.signal);
    await assert.rejects(
        pending.provider.invoke(liveRequest(1), new AbortController().signal),
        /sequential/u,
    );
    assert.throws(() => pending.rebuild([]), /during a turn/u);
    controller.abort(new Error("stop"));
    await assert.rejects(turn, /stop/u);
    assert.equal(pending.contextPrefixId(), null);
    assert.deepEqual(pending.messages(), []);
    assert.equal(conversation.contextPrefixId(), before);
    await assert.rejects(
        pending.provider.invoke(liveRequest(0), AbortSignal.abort(new Error("pre"))),
        /pre/u,
    );
    await assert.rejects(pending.provider.invoke(liveRequest(0), "signal" as never), TypeError);
    assert.equal(pending.provider.descriptor().kind, "anthropic");
});

test("provider conversation definitions, rebuild input, and cache identities are validated", () => {
    const provider = createLiveProvider({
        credential: KEY,
        id: "provider:claude",
        kind: "anthropic",
        model: "fixture-model",
        transport: async () => anthropicReply("{}"),
    });
    for (const definition of [
        null,
        [],
        { adapterId: "a", extra: true, provider },
        { adapterId: "", provider },
        { adapterId: "a", provider: null },
        { adapterId: "a", provider: { descriptor: provider.descriptor, invoke: provider.invoke } },
        { adapterId: "a", provider: { converse: provider.converse } },
        { adapterId: "a", provider, system: "" },
    ]) {
        assert.throws(() => createProviderConversation(definition as never), TypeError);
    }
    const conversation = createProviderConversation({ adapterId: "a", provider });
    assert.equal(conversation.session.cacheIdentity?.(liveRequest(0), "context:other"), null);
    assert.match(
        String(conversation.session.cacheIdentity?.(liveRequest(0), null)),
        /^provider-prefix:/u,
    );
    assert.throws(
        () =>
            conversation.session.restore("provider-conversation:unknown", {
                context_prefix_id: null,
                session_id: "s",
                step_count: 0,
            }),
        /does not hold/u,
    );
    const step = {
        depends_on: [],
        effect: null,
        index: 0,
        kind: "provider",
        prefix_id: "p",
        provider: {
            cache: null,
            context_prefix_id: "context:forged",
            failure: null,
            prompt_id: "prompt:x",
            request: liveRequest(0),
            response: {
                output: {},
                usage: {
                    cacheCreationInputTokens: 0,
                    cacheReadInputTokens: 0,
                    costUsd: null,
                    inputTokens: 1,
                    outputTokens: 1,
                },
            },
            response_id: "response:x",
        },
        record_id: "r",
        source: "live",
        source_step_record_id: null,
        step_id: "s",
    };
    for (const steps of ["steps", [null], [{ ...step, index: 1 }], [step]]) {
        assert.throws(() => conversation.rebuild(steps as never), TypeError);
    }
    conversation.rebuild([{ ...step, kind: "effect", provider: null }] as never);
    assert.equal(conversation.contextPrefixId(), null);
});
