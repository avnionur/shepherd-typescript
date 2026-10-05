import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import {
    createLiveProvider,
    createProviderConversation,
    type ReplaySessionContext,
    replayReplaySession,
    runReplaySession,
    SQLiteTraceStore,
} from "../../src/index.ts";
import { anthropicReply, liveRequest } from "../provider/live-fixtures.ts";

const [mode, databasePath, metadataPath, persistence, branchCommand] = process.argv.slice(2);
assert.ok(databasePath && metadataPath);
using store = new SQLiteTraceStore(databasePath);
const bodies: string[] = [];
const provider = createLiveProvider({
    id: "provider:restart-fixture",
    kind: "anthropic",
    model: "fixture-model",
    credential: "sk-ant-restart-fixture-not-a-real-credential",
    transport: async (request) => {
        bodies.push(request.body);
        return anthropicReply('{"text":"retained reply"}');
    },
});
const conversation = createProviderConversation({
    adapterId: "conversation:restart-fixture",
    provider,
    system: "Exact retained system prompt.\nSecond line.",
    ...(persistence === "retained" ? { checkpointStore: store } : {}),
});
const program = async (context: ReplaySessionContext) => {
    await context.invokeProvider(liveRequest(0));
    await context.checkpoint();
    await context.invokeProvider(liveRequest(1));
    return null;
};
if (mode === "capture") {
    const root = await runReplaySession(store, {
        commandId: "source",
        claimId: "source",
        programId: "provider-restart",
        program,
        provider: conversation.provider,
        providerSession: conversation.session,
    });
    assert.equal(root.inspection.terminal?.status, "finished");
    const checkpoint = root.inspection.checkpoints[0];
    assert.ok(checkpoint);
    writeFileSync(
        metadataPath,
        JSON.stringify({
            sessionId: root.inspection.session_id,
            checkpointId: checkpoint.checkpoint_id,
            expectedBody: bodies[1],
            expectedContext: root.inspection.steps[1]?.provider?.context_prefix_id,
        }),
    );
} else {
    const metadata = JSON.parse(readFileSync(metadataPath, "utf8")) as {
        sessionId: string;
        checkpointId: string;
        expectedBody: string;
        expectedContext: string;
    };
    const branch = await replayReplaySession(store, {
        commandId: branchCommand ?? "restart",
        claimId: "restart",
        sourceSessionId: metadata.sessionId,
        sourceDisposition: "retain",
        target: { checkpointId: metadata.checkpointId },
        program,
        provider: conversation.provider,
        providerSession: conversation.session,
    });
    console.log(
        JSON.stringify({
            status: branch.inspection.terminal?.status,
            failure: branch.inspection.terminal?.failure?.message,
            bodies,
            context: conversation.contextPrefixId(),
            expectedBody: metadata.expectedBody,
            expectedContext: metadata.expectedContext,
        }),
    );
}
