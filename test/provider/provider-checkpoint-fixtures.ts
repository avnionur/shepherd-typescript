import assert from "node:assert/strict";
import path from "node:path";
import type { TestContext } from "node:test";
import type { SemanticRecord } from "../../src/canonical/canonical-record.ts";
import {
    createLiveProvider,
    createProviderConversation,
    type LiveProviderDefinition,
    type ProviderConversationCheckpointBinding,
    runReplaySession,
    SQLiteTraceStore,
} from "../../src/index.ts";
import { rowInsertHandlers, rowIntent } from "../effect/compensation-fixtures.ts";
import { temporaryDirectory } from "../replay/fixtures.ts";
import { anthropicReply, liveRequest } from "./live-fixtures.ts";

/** Real retained checkpoint followed by a compensable external row for refusal-before-work tests. */
export async function providerCheckpointFixture(context: TestContext, label: string) {
    const directory = await temporaryDirectory(context, `provider-checkpoint-${label}`);
    const databasePath = path.join(directory, "trace.sqlite");
    const worldPath = path.join(directory, "world.sqlite");
    const store = new SQLiteTraceStore(databasePath);
    context.after(() => store.close());
    const providerOptions: LiveProviderDefinition = {
        id: "provider:checkpoint",
        kind: "anthropic",
        model: "fixture-model",
        credential: "sk-ant-checkpoint-config-fixture-not-a-real-credential",
        transport: async () => anthropicReply('{"text":"reply"}'),
    };
    const provider = createLiveProvider(providerOptions);
    const definition = {
        adapterId: "provider-session:checkpoint",
        provider,
        system: "Private checkpoint system.\nExact prefix.",
        checkpointStore: store,
    };
    const conversation = createProviderConversation(definition);
    const source = await runReplaySession(store, {
        commandId: "source",
        claimId: "source",
        programId: "checkpoint-fixture",
        provider: conversation.provider,
        providerSession: conversation.session,
        handlers: rowInsertHandlers(worldPath),
        program: async (replay) => {
            await replay.invokeProvider(liveRequest(0));
            await replay.checkpoint();
            await replay.dispatchEffect(rowIntent("a"));
            return null;
        },
    });
    assert.equal(source.inspection.terminal?.status, "finished");
    const checkpoint = source.inspection.checkpoints[0];
    assert.ok(checkpoint);
    const constituent = checkpoint.constituents.find((entry) => entry.kind === "provider_session");
    assert.ok(constituent?.receipt_id);
    const snapshotRecordId = constituent.evidence?.snapshot_record_id;
    assert.equal(typeof snapshotRecordId, "string");
    const snapshot = store.readRecord(snapshotRecordId as string);
    assert.ok(snapshot);
    const payload = snapshot.body.data as SemanticRecord;
    assert.equal(typeof payload.configuration_id, "string");
    const binding: ProviderConversationCheckpointBinding = {
        adapterId: definition.adapterId,
        provider: provider.descriptor(),
        configurationId: payload.configuration_id as string,
    };
    const checkpointContext = {
        context_prefix_id: checkpoint.context_prefix_id,
        session_id: source.inspection.session_id,
        step_count: checkpoint.step_count,
    };
    return {
        directory,
        databasePath,
        worldPath,
        store,
        providerOptions,
        definition,
        conversation,
        source: source.inspection,
        checkpoint,
        receiptId: constituent.receipt_id,
        snapshotRecordId: snapshotRecordId as string,
        snapshot,
        binding,
        checkpointContext,
    };
}
