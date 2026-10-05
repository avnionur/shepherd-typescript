import assert from "node:assert/strict";
import { test } from "node:test";
import {
    createLiveProvider,
    createProviderConversation,
    type OwnerRecord,
    ReplayEvidenceError,
    runReplaySession,
    SQLiteTraceStore,
} from "../../src/index.ts";
import { providerProtocolConfig, recordIdConfig } from "../../src/protocol/config.ts";
import { foldReplaySession } from "../../src/replay/inspection.ts";
import { anthropicReply } from "./live-fixtures.ts";
import { providerCheckpointFixture } from "./provider-checkpoint-fixtures.ts";

const config = providerProtocolConfig.conversation.checkpoint;

test("verified capture refuses incomplete, mismatched or foreign-store snapshot evidence", async () => {
    using source = new SQLiteTraceStore();
    const provider = createLiveProvider({
        id: "fixture",
        kind: "anthropic",
        model: "fixture",
        credential: "fixture",
        transport: async () => anthropicReply("{}"),
    });
    const conversation = createProviderConversation({
        adapterId: "fixture",
        provider,
        checkpointStore: source,
    });
    const receipt = await conversation.session.checkpoint({
        context_prefix_id: null,
        session_id: "fixture",
        step_count: 0,
    });
    assert.equal(receipt.status, "verified");
    const { snapshotRecordId: _snapshotRecordId, ...withoutReference } = receipt;
    const wrong = recordIdConfig.prefix + "0".repeat(64);
    for (const [index, evidence] of [
        withoutReference,
        { ...receipt, snapshotRecordId: wrong },
        { ...receipt, receiptId: "custom-receipt" },
        { ...receipt, receiptId: config.receiptIdPrefix + "0".repeat(64), snapshotRecordId: wrong },
        receipt,
    ].entries()) {
        using target = new SQLiteTraceStore();
        if (index !== 4) target.importTrace(source.exportTrace());
        const result = await runReplaySession(target, {
            commandId: `capture:${index}`,
            claimId: "fixture",
            programId: "fixture",
            provider,
            providerSession: { ...conversation.session, checkpoint: () => evidence },
            program: async (context) => {
                await context.checkpoint();
                return null;
            },
        });
        assert.equal(result.inspection.terminal?.status, "finished");
        const entry = result.inspection.checkpoints[0]?.constituents.find(
            (item) => item.kind === "provider_session",
        );
        assert.equal(entry?.status, "unavailable");
        assert.equal(entry?.receipt_id, null);
    }
});

test("inspection refuses checkpoint provider names and extra evidence inconsistent with the retained session", async (context) => {
    const { store, source, checkpoint } = await providerCheckpointFixture(
        context,
        "forged-evidence",
    );
    for (const change of [{ name: "different-adapter" }, { extraEvidence: true }]) {
        const records = store.readOwner(source.session_id).map((record): OwnerRecord => {
            if (record.envelope.record_id !== checkpoint.record_id) return record;
            const constituents = checkpoint.constituents.map((entry) => {
                if (entry.kind !== "provider_session") return entry;
                return change.name === undefined
                    ? { ...entry, evidence: { ...entry.evidence, extra: true } }
                    : { ...entry, name: change.name };
            });
            return { ...record, body: { ...record.body, constituents } } as unknown as OwnerRecord;
        });
        assert.throws(
            () => foldReplaySession(store, source.session_id, records, undefined, Date.now()),
            ReplayEvidenceError,
        );
    }
});
