import assert from "node:assert/strict";
import { test } from "node:test";
import {
    createLiveProvider,
    createProviderConversation,
    runReplaySession,
    SQLiteTraceStore,
} from "../../src/index.ts";
import { anthropicReply, liveRequest, scriptedTransport } from "./live-fixtures.ts";

test("failed exchanges retain the exact context and successful messages for a new conversation", async () => {
    using store = new SQLiteTraceStore();
    const { transport } = scriptedTransport([
        anthropicReply('{"text":"before"}'),
        {
            status: 529,
            body: JSON.stringify({ error: { type: "overloaded_error", message: "overloaded" } }),
        },
    ]);
    const definition = {
        adapterId: "failed-prefix",
        checkpointStore: store,
        provider: createLiveProvider({
            id: "fixture",
            kind: "anthropic",
            model: "fixture",
            credential: "fixture",
            transport,
        }),
    };
    const conversation = createProviderConversation(definition);
    const result = await runReplaySession(store, {
        commandId: "failed",
        claimId: "fixture",
        programId: "fixture",
        provider: conversation.provider,
        providerSession: conversation.session,
        program: async (replay) => {
            await replay.invokeProvider(liveRequest(0));
            await assert.rejects(replay.invokeProvider(liveRequest(1)), /overloaded/u);
            await replay.checkpoint();
            return null;
        },
    });
    assert.equal(result.inspection.terminal?.status, "finished");
    const checkpoint = result.inspection.checkpoints[0];
    assert.ok(checkpoint);
    const receipt = checkpoint.constituents.find(
        (entry) => entry.kind === "provider_session",
    )?.receipt_id;
    assert.ok(receipt);
    const fresh = createProviderConversation(definition);
    await fresh.session.restore(receipt, {
        context_prefix_id: checkpoint.context_prefix_id,
        session_id: result.inspection.session_id,
        step_count: checkpoint.step_count,
    });
    assert.equal(fresh.messages().length, 2);
    assert.deepEqual(fresh.messages(), conversation.messages());
    assert.equal(fresh.contextPrefixId(), result.inspection.steps[1]?.provider?.context_prefix_id);
    assert.notEqual(
        fresh.contextPrefixId(),
        result.inspection.steps[0]?.provider?.context_prefix_id,
    );
});

test("receipt validation and restore refuse pending turns; cancellation leaves the retained prefix unchanged", async () => {
    using store = new SQLiteTraceStore();
    const controller = new AbortController();
    const conversation = createProviderConversation({
        adapterId: "cancelled-prefix",
        checkpointStore: store,
        provider: createLiveProvider({
            id: "fixture",
            kind: "anthropic",
            model: "fixture",
            credential: "fixture",
            transport: () =>
                new Promise((_resolve, reject) => {
                    controller.signal.addEventListener("abort", () =>
                        reject(controller.signal.reason),
                    );
                }),
        }),
    });
    const checkpointContext = { context_prefix_id: null, session_id: "fixture", step_count: 0 };
    const receipt = await conversation.session.checkpoint(checkpointContext);
    assert.equal(receipt.status, "verified");
    assert.ok(receipt.receiptId);
    const before = store.exportTrace();
    const pending = conversation.provider.invoke(liveRequest(0), controller.signal);
    assert.throws(
        () =>
            conversation.session.validateReceipt?.(receipt.receiptId as string, checkpointContext),
        /during a turn/u,
    );
    assert.throws(
        () => conversation.session.restore(receipt.receiptId as string, checkpointContext),
        /during a turn/u,
    );
    controller.abort(new Error("cancel"));
    await assert.rejects(pending, /cancel/u);
    assert.equal(conversation.contextPrefixId(), null);
    assert.deepEqual(conversation.messages(), []);
    assert.equal(await conversation.session.restore(receipt.receiptId, checkpointContext), null);
    assert.deepEqual(await conversation.session.checkpoint(checkpointContext), receipt);
    assert.equal(store.exportTrace(), before);
    assert.throws(
        () => conversation.session.checkpoint({ ...checkpointContext, context_prefix_id: "wrong" }),
        /does not match/u,
    );
});
