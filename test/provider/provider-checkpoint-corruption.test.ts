import assert from "node:assert/strict";
import { test } from "node:test";
import {
    createProviderConversation,
    createRecordId,
    ROOT_WITNESS_ID,
    readProviderConversationCheckpoint,
    retainProviderConversationCheckpoint,
    type SemanticRecord,
    SQLiteTraceStore,
} from "../../src/index.ts";
import {
    providerProtocolConfig,
    recordIdConfig,
    supervisionProtocolConfig,
} from "../../src/protocol/config.ts";
import {
    createSupervisionContextBody,
    createSupervisionContextChannelId,
} from "../../src/supervision/records.ts";
import { providerCheckpointFixture } from "./provider-checkpoint-fixtures.ts";

const config = providerProtocolConfig.conversation.checkpoint;

test("canonical but incompatible, malformed or misowned snapshot records refuse without changing the conversation", async (context) => {
    const { store, binding, snapshot, definition, checkpointContext } =
        await providerCheckpointFixture(context, "corruption");
    const fresh = createProviderConversation(definition);
    for (const [index, alteration] of [
        { record_version: config.recordVersion + 1 },
        { compatibility_version: "unsupported" },
        { malformed: true },
        { wrong_owner: true },
        { wrong_schema: true },
    ].entries()) {
        const { malformed, wrong_owner, wrong_schema, ...changed } = alteration;
        const data = { ...(snapshot.body.data as SemanticRecord), ...changed } as SemanticRecord;
        const payloadId = createRecordId(data);
        const channelId = createSupervisionContextChannelId(config.channelPrefix + payloadId);
        const body = malformed
            ? { malformed: true }
            : createSupervisionContextBody({
                  channelId,
                  commandId: createRecordId({ [config.appendIntentKind]: payloadId }),
                  data,
                  supervisorId: binding.adapterId,
                  citedRecordIds: [ROOT_WITNESS_ID],
              });
        using target = new SQLiteTraceStore();
        const receipt = target.injectSupervisionContext([ROOT_WITNESS_ID], {
            append_intent_id: `corrupt:${index}`,
            batch: {
                groups: [
                    {
                        owner_id: wrong_owner ? "wrong-owner" : channelId,
                        records: [
                            {
                                body,
                                mode: "capture",
                                schema_ref: wrong_schema
                                    ? "wrong-schema"
                                    : supervisionProtocolConfig.traceSchemas.context,
                                witness_ref: ROOT_WITNESS_ID,
                                caused_by_record_ids: [ROOT_WITNESS_ID],
                            },
                        ],
                    },
                ],
            },
        });
        const recordId = receipt.record_ids[0];
        assert.ok(recordId);
        const receiptId = config.receiptIdPrefix + recordId.slice(recordIdConfig.prefix.length);
        const before = target.exportTrace();
        assert.throws(
            () =>
                readProviderConversationCheckpoint(target, {
                    ...binding,
                    receiptId,
                    contextPrefixId: checkpointContext.context_prefix_id,
                }),
            TypeError,
        );
        const candidate = createProviderConversation({ ...definition, checkpointStore: target });
        assert.throws(() => candidate.session.restore(receiptId, checkpointContext), TypeError);
        assert.equal(candidate.contextPrefixId(), null);
        assert.deepEqual(candidate.messages(), []);
        assert.equal(target.exportTrace(), before);
    }
    const original = snapshot.body.data as SemanticRecord;
    for (const state of [
        { system: "changed", tools: [] },
        {
            system: definition.system,
            tools: [{ name: "fixture", description: "fixture", inputSchema: { type: "object" } }],
        },
    ]) {
        const valid = readProviderConversationCheckpoint(store, {
            ...binding,
            receiptId:
                config.receiptIdPrefix +
                snapshot.envelope.record_id.slice(recordIdConfig.prefix.length),
            contextPrefixId: checkpointContext.context_prefix_id,
        });
        const receipt = retainProviderConversationCheckpoint(store, {
            ...binding,
            state: { ...valid, ...state },
        });
        assert.throws(
            () => fresh.session.restore(receipt.receiptId, checkpointContext),
            /prefix configuration/u,
        );
        assert.deepEqual(fresh.messages(), []);
    }
    assert.equal(original.system, definition.system);
});
