import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { Ajv2020, type AnySchemaObject } from "ajv/dist/2020.js";
import {
    createLiveProvider,
    createProviderConversation,
    exportRedactedTraceArchive,
    readProviderConversationCheckpoint,
    retainProviderConversationCheckpoint,
    SQLiteTraceStore,
    TraceSecretDetectedError,
} from "../../src/index.ts";
import { providerProtocolConfig, supervisionProtocolConfig } from "../../src/protocol/config.ts";
import { SECRET_SAMPLES } from "../retention/fixtures.ts";
import { providerCheckpointFixture } from "./provider-checkpoint-fixtures.ts";

const config = providerProtocolConfig.conversation.checkpoint;

test("retained snapshots deduplicate, read immutably without writes and obey redaction after native import", async (context) => {
    const fixture = await providerCheckpointFixture(context, "storage");
    const {
        store,
        databasePath,
        binding,
        receiptId,
        checkpoint,
        snapshotRecordId,
        definition,
        providerOptions,
    } = fixture;
    const options = { ...binding, receiptId, contextPrefixId: checkpoint.context_prefix_id };
    const before = store.exportTrace();
    const state = readProviderConversationCheckpoint(store, options);
    assert.ok(Object.isFrozen(state) && Object.isFrozen(state.messages));
    assert.deepEqual(retainProviderConversationCheckpoint(store, { ...binding, state }), {
        receiptId,
        recordId: snapshotRecordId,
    });
    assert.equal(store.exportTrace(), before);
    assert.ok(before.includes(JSON.stringify(definition.system)));
    assert.equal(before.includes(providerOptions.credential as string), false);
    for (const target of [store, new SQLiteTraceStore()]) {
        if (target !== store) {
            context.after(() => target.close());
            target.importTrace(before);
        }
        assert.deepEqual(readProviderConversationCheckpoint(target, options), state);
        assert.equal(
            exportRedactedTraceArchive(target).includes("Private checkpoint system."),
            false,
        );
    }
    using reader = new SQLiteTraceStore(databasePath, { readOnly: true });
    const fresh = createProviderConversation({ ...definition, checkpointStore: reader });
    assert.equal(
        await fresh.session.restore(receiptId, fixture.checkpointContext),
        state.contextPrefixId,
    );
    assert.deepEqual(fresh.messages(), state.messages);
    assert.equal(reader.exportTrace(), before);
    const ajv = new Ajv2020({ strict: true });
    for (const keyword of ["x-shepherd-max-canonical-bytes", "x-shepherd-max-utf8-bytes"])
        ajv.addKeyword(keyword);
    const validate = ajv.compile(
        JSON.parse(
            readFileSync(
                new URL(
                    "../../spec/schemas/provider-conversation-checkpoint-v1.schema.json",
                    import.meta.url,
                ),
                "utf8",
            ),
        ) as AnySchemaObject,
    );
    assert.equal(validate(fixture.snapshot.body.data), true, ajv.errorsText(validate.errors));
    assert.equal(
        validate({ ...(fixture.snapshot.body.data as object), record_version: 999 }),
        false,
    );
    reader.close();
    store.close();
    for (const entry of readdirSync(fixture.directory, { recursive: true, withFileTypes: true })) {
        if (entry.isFile())
            assert.equal(
                readFileSync(path.join(entry.parentPath, entry.name)).includes(
                    providerOptions.credential as string,
                ),
                false,
            );
    }
    assert.throws(() => readProviderConversationCheckpoint(store, options), /closed/u);
});

test("malformed or oversized capture data never writes, and wrong read bindings never mutate held state", async (context) => {
    const { store, binding, receiptId, checkpoint, definition, checkpointContext } =
        await providerCheckpointFixture(context, "invalid");
    const options = { ...binding, receiptId, contextPrefixId: checkpoint.context_prefix_id };
    const state = readProviderConversationCheckpoint(store, options);
    const before = store.exportTrace();
    let getterCalls = 0;
    const accessor = {
        ...state,
        get system() {
            getterCalls++;
            return "unsafe";
        },
    };
    for (const bad of [
        { ...state, extra: true },
        { ...state, contextPrefixId: "bad" },
        { ...state, messages: [{ role: "assistant", content: [{ type: "text", text: "first" }] }] },
        { ...state, system: "" },
        { ...state, tools: [{}] },
        accessor,
        { ...state, messages: Array(config.limits.maxMessages + 1).fill(null) },
        { ...state, tools: Array(config.limits.maxTools + 1).fill(null) },
        { ...state, system: "x".repeat(supervisionProtocolConfig.limits.maxDataCanonicalBytes) },
    ]) {
        assert.throws(
            () => retainProviderConversationCheckpoint(store, { ...binding, state: bad } as never),
            TypeError,
        );
        assert.equal(store.exportTrace(), before);
    }
    assert.equal(getterCalls, 0);
    assert.throws(
        () =>
            retainProviderConversationCheckpoint(store, {
                ...binding,
                adapterId: "x".repeat(config.limits.maxIdentityBytes + 1),
                state,
            }),
        /bounds/u,
    );
    for (const change of [
        { adapterId: "wrong" },
        { configurationId: "wrong" },
        { provider: { ...binding.provider, model: "wrong" } },
        { contextPrefixId: null },
        { receiptId: "bad" },
        { receiptId: config.receiptIdPrefix + "0".repeat(64) },
    ])
        assert.throws(
            () => readProviderConversationCheckpoint(store, { ...options, ...change }),
            TypeError,
        );
    using empty = new SQLiteTraceStore();
    const fresh = createProviderConversation({ ...definition, checkpointStore: empty });
    assert.throws(() => fresh.session.restore(receiptId, checkpointContext), /missing/u);
    assert.equal(fresh.contextPrefixId(), null);
    assert.deepEqual(fresh.messages(), []);
    assert.equal(store.exportTrace(), before);
});

test("checkpoint capture and import enforce the configured secret scanner before persistence", () => {
    using store = new SQLiteTraceStore(":memory:", { secretScanning: "refuse" });
    const binding = {
        adapterId: "retention",
        configurationId: "fixture-v1",
        provider: createLiveProvider({
            id: "fixture",
            kind: "anthropic",
            model: "fixture",
            credential: "fixture",
        }).descriptor(),
    };
    const state = {
        contextPrefixId: null,
        messages: [],
        tools: [],
        system: SECRET_SAMPLES["github-token"] as string,
    };
    const before = store.exportTrace();
    assert.throws(
        () => retainProviderConversationCheckpoint(store, { ...binding, state }),
        TraceSecretDetectedError,
    );
    assert.equal(store.exportTrace(), before);
    using source = new SQLiteTraceStore();
    retainProviderConversationCheckpoint(source, { ...binding, state });
    assert.throws(() => store.importTrace(source.exportTrace()), TraceSecretDetectedError);
    assert.equal(store.exportTrace(), before);
    assert.equal(exportRedactedTraceArchive(source).includes(state.system), false);
    const receipt = retainProviderConversationCheckpoint(store, {
        ...binding,
        state: { ...state, system: null },
    });
    assert.deepEqual(
        readProviderConversationCheckpoint(store, {
            ...binding,
            receiptId: receipt.receiptId,
            contextPrefixId: null,
        }),
        { ...state, system: null },
    );
});
