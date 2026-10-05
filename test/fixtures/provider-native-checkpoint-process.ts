import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import {
    createLiveProvider,
    createReplayToolLoopBindings,
    createToolTurnProvider,
    type ModelMessage,
    type ProviderConversationCheckpointState,
    type ReplayProviderSessionAdapter,
    type ReplaySessionContext,
    readProviderConversationCheckpoint,
    replayReplaySession,
    retainProviderConversationCheckpoint,
    runReplaySession,
    SQLiteTraceStore,
} from "../../src/index.ts";
import { anthropicReply } from "../provider/live-fixtures.ts";

const [mode, databasePath, metadataPath, branchCommand] = process.argv.slice(2);
assert.ok(databasePath && metadataPath);
using store = new SQLiteTraceStore(databasePath);
const bodies: string[] = [];
let held: ProviderConversationCheckpointState = {
    contextPrefixId: null,
    messages: [],
    system: null,
    tools: [],
};
let restoredContext: string | null = null;
const initialSystem = "Native checkpoint system.\nExact UTF-8 prefix: αβ.";
const initialTools = [
    {
        name: "fixture_echo",
        description: "Return the supplied fixture value.",
        inputSchema: {
            type: "object",
            properties: { value: { type: "string" } },
            required: ["value"],
            additionalProperties: false,
        },
    },
];
const raw = createLiveProvider({
    id: "provider:native-checkpoint",
    kind: "anthropic",
    model: "fixture-model",
    credential: "sk-ant-native-checkpoint-fixture-not-a-real-credential",
    transport: async (request) => {
        bodies.push(request.body);
        const body = JSON.parse(request.body) as { messages: unknown[] };
        if (body.messages.length === 5) return anthropicReply("complete");
        const callId = body.messages.length === 1 ? "call:first" : "call:second";
        return {
            status: 200,
            body: JSON.stringify({
                content: [
                    { type: "text", text: "Use the declared tool." },
                    {
                        type: "tool_use",
                        id: callId,
                        name: "fixture_echo",
                        input: { value: callId },
                    },
                ],
                stop_reason: "tool_use",
                usage: { input_tokens: 10, output_tokens: 3 },
            }),
        };
    },
});
const provider = createToolTurnProvider({
    ...raw,
    converse: async (request, signal) => {
        const result = await raw.converse(request, signal);
        held = {
            ...held,
            messages: [...request.messages, result.message],
            system: request.system,
            tools: request.tools ?? [],
        };
        return result;
    },
});
const binding = {
    adapterId: "native-checkpoint",
    configurationId: "native-tool-protocol-v1",
    provider: raw.descriptor(),
};
const session: ReplayProviderSessionAdapter = {
    adapterId: binding.adapterId,
    checkpoint: (context) => {
        held = { ...held, contextPrefixId: context.context_prefix_id };
        const receipt = retainProviderConversationCheckpoint(store, { ...binding, state: held });
        return {
            status: "verified",
            contextPrefixId: held.contextPrefixId,
            receiptId: receipt.receiptId,
            snapshotRecordId: receipt.recordId,
        };
    },
    validateReceipt: (receiptId, context) => {
        readProviderConversationCheckpoint(store, {
            ...binding,
            receiptId,
            contextPrefixId: context.context_prefix_id,
        });
    },
    restore: (receiptId, context) => {
        held = readProviderConversationCheckpoint(store, {
            ...binding,
            receiptId,
            contextPrefixId: context.context_prefix_id,
        });
        restoredContext = held.contextPrefixId;
        return held.contextPrefixId;
    },
};
const program = async (context: ReplaySessionContext) => {
    const { model } = createReplayToolLoopBindings(context);
    const first = await model.converse(
        {
            cachePrefixMessages: 1,
            messages: [
                { role: "user", content: [{ type: "text", text: "Echo twice, then finish." }] },
            ],
            system: initialSystem,
            tools: initialTools,
            outputSchema: null,
        },
        context.signal,
    );
    const firstCall = first.message.content.find((block) => block.type === "tool_use");
    assert.ok(firstCall?.type === "tool_use");
    const firstResult: ModelMessage = {
        role: "user",
        content: [
            {
                type: "tool_result",
                toolUseId: firstCall.id,
                content: "first result: α\nwith exact whitespace",
                isError: false,
            },
        ],
    };
    const second = await model.converse(
        {
            cachePrefixMessages: 3,
            messages: [
                { role: "user", content: [{ type: "text", text: "Echo twice, then finish." }] },
                first.message,
                firstResult,
            ],
            system: initialSystem,
            tools: initialTools,
            outputSchema: null,
        },
        context.signal,
    );
    await context.checkpoint();
    const secondCall = second.message.content.find((block) => block.type === "tool_use");
    assert.ok(secondCall?.type === "tool_use");
    // The suffix consumes restored state. Reconstructing it from the recorded turns is deliberately
    // insufficient here: missing messages, system or tools would change the actual HTTP body.
    const third = await model.converse(
        {
            cachePrefixMessages: held.messages.length + 1,
            messages: [
                ...held.messages,
                {
                    role: "user",
                    content: [
                        {
                            type: "tool_result",
                            toolUseId: secondCall.id,
                            content: "second result",
                            isError: true,
                        },
                    ],
                },
            ],
            system: held.system,
            tools: held.tools,
            outputSchema: null,
        },
        context.signal,
    );
    return third.output;
};
if (mode === "capture") {
    const root = await runReplaySession(store, {
        claimId: "source",
        commandId: "native-source",
        programId: "native-checkpoint",
        provider,
        providerSession: session,
        program,
    });
    assert.equal(root.inspection.terminal?.status, "finished");
    const checkpoint = root.inspection.checkpoints[0];
    assert.ok(checkpoint);
    writeFileSync(
        metadataPath,
        JSON.stringify({
            sessionId: root.inspection.session_id,
            checkpointId: checkpoint.checkpoint_id,
            expectedBody: bodies[2],
            expectedContext: checkpoint.context_prefix_id,
        }),
    );
} else {
    const metadata = JSON.parse(readFileSync(metadataPath, "utf8")) as {
        sessionId: string;
        checkpointId: string;
        expectedBody: string;
        expectedContext: string;
    };
    const result = await replayReplaySession(store, {
        claimId: "restart",
        commandId: branchCommand ?? "native-restart",
        sourceSessionId: metadata.sessionId,
        sourceDisposition: "retain",
        target: { checkpointId: metadata.checkpointId },
        provider,
        providerSession: session,
        program,
    });
    console.log(
        JSON.stringify({
            status: result.inspection.terminal?.status,
            bodies,
            restoredContext,
            expectedBody: metadata.expectedBody,
            expectedContext: metadata.expectedContext,
        }),
    );
}
