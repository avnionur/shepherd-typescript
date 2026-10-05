import assert from "node:assert/strict";
import { test } from "node:test";
import {
    createLiveProvider,
    createProgramConversationProvider,
    createProviderConversation,
    type LiveProviderDefinition,
    ReplayRestoreError,
    readProviderConversationCheckpoint,
    replayReplaySession,
    rewindReplaySession,
} from "../../src/index.ts";
import { readRowIds, rowCompensation } from "../effect/compensation-fixtures.ts";
import { providerCheckpointFixture } from "./provider-checkpoint-fixtures.ts";

test("changed provider settings, model, adapter or system refuse before branch publication and compensation", async (context) => {
    const fixture = await providerCheckpointFixture(context, "binding");
    const { store, definition, providerOptions, source, checkpoint, worldPath } = fixture;
    const before = store.exportTrace();
    const calls: string[] = [];
    const variants: readonly Partial<LiveProviderDefinition>[] = [
        { model: "another-model" },
        { id: "another-provider" },
        { endpoint: "https://example.invalid/other" },
        { maxOutputTokens: 7 },
        { kind: "openai" },
    ];
    const sessions = [
        ...variants.map(
            (variant) =>
                createProviderConversation({
                    ...definition,
                    provider: createLiveProvider({ ...providerOptions, ...variant }),
                }).session,
        ),
        createProviderConversation({ ...definition, system: "another system" }).session,
        createProviderConversation({ ...definition, configurationId: "another configuration" })
            .session,
        createProviderConversation({ ...definition, adapterId: "another adapter" }).session,
        {
            adapterId: definition.adapterId,
            checkpoint: fixture.conversation.session.checkpoint,
            restore: fixture.conversation.session.restore,
        },
    ];
    for (const [index, session] of sessions.entries()) {
        await assert.rejects(
            rewindReplaySession(store, {
                commandId: `refused:${index}`,
                claimId: "operator",
                sourceSessionId: source.session_id,
                target: { checkpointId: checkpoint.checkpoint_id },
                providerSession: session,
                compensation: rowCompensation(worldPath, calls),
            }),
            ReplayRestoreError,
        );
        assert.deepEqual(calls, []);
        assert.deepEqual(readRowIds(worldPath), ["a"]);
        assert.equal(store.exportTrace(), before);
    }
    await assert.rejects(
        replayReplaySession(store, {
            commandId: "mismatched-pair",
            claimId: "operator",
            sourceSessionId: source.session_id,
            target: { checkpointId: checkpoint.checkpoint_id },
            changes: ["provider"],
            provider: createLiveProvider({ ...providerOptions, model: "different" }),
            providerSession: fixture.conversation.session,
            compensation: rowCompensation(worldPath, calls),
            program: () => assert.fail("must not execute"),
        }),
        ReplayRestoreError,
    );
    assert.deepEqual(calls, []);
    assert.equal(store.exportTrace(), before);
});

test("credential rotation preserves checkpoint compatibility and repeated branch commands skip restore validation", async (context) => {
    const { store, definition, providerOptions, source, checkpoint, receiptId, binding } =
        await providerCheckpointFixture(context, "rotation");
    const fresh = createProviderConversation({
        ...definition,
        provider: createLiveProvider({
            ...providerOptions,
            credential: "sk-ant-rotated-fixture-not-a-real-credential",
        }),
    });
    const options = {
        commandId: "rotated",
        claimId: "operator",
        sourceSessionId: source.session_id,
        target: { checkpointId: checkpoint.checkpoint_id },
        sourceDisposition: "retain" as const,
        providerSession: fresh.session,
    };
    const result = await rewindReplaySession(store, options);
    assert.equal(result.inspection.terminal?.status, "rewound");
    const state = readProviderConversationCheckpoint(store, {
        ...binding,
        receiptId,
        contextPrefixId: checkpoint.context_prefix_id,
    });
    assert.deepEqual(fresh.messages(), state.messages);
    assert.equal(fresh.contextPrefixId(), state.contextPrefixId);
    const noSecondValidation = {
        ...fresh.session,
        validateReceipt: () => assert.fail("completed command must not restore again"),
        restore: () => assert.fail("completed command must not restore again"),
    };
    assert.deepEqual(
        await rewindReplaySession(store, { ...options, providerSession: noSecondValidation }),
        result,
    );
});

test("custom retained providers require an explicit configuration identity and construction validates storage options", async (context) => {
    const { store, definition, providerOptions } = await providerCheckpointFixture(
        context,
        "custom",
    );
    const custom = createProgramConversationProvider({
        id: "custom",
        respond: () => assert.fail("must not invoke"),
    });
    assert.throws(
        () => createProviderConversation({ ...definition, provider: custom }),
        /explicit custom/u,
    );
    const accepted = createProviderConversation({
        ...definition,
        provider: custom,
        configurationId: "custom-code-v1",
    });
    const initial = await accepted.session.checkpoint({
        context_prefix_id: null,
        session_id: "standalone",
        step_count: 0,
    });
    assert.equal(initial.status, "verified");
    for (const change of [
        { configurationId: "" },
        { checkpointStore: null },
        { checkpointStore: { append: () => {}, readRecord: () => {} } },
    ])
        assert.throws(
            () => createProviderConversation({ ...definition, ...change } as never),
            TypeError,
        );
    const mutable = createLiveProvider({ ...providerOptions, model: "fixture" });
    let model = "original";
    const provider = { ...mutable, descriptor: () => ({ ...mutable.descriptor(), model }) };
    const conversation = createProviderConversation({
        adapterId: "mutable",
        provider,
        checkpointStore: store,
        configurationId: "custom-v1",
    });
    model = "changed";
    assert.throws(
        () =>
            conversation.session.checkpoint({
                context_prefix_id: null,
                session_id: "mutable",
                step_count: 0,
            }),
        /configuration changed/u,
    );
});
