import assert from "node:assert/strict";
import { test } from "node:test";

import {
    AppendIntentConflictError,
    deriveSupervisionContextChannelId,
    dispatchSupervisedEffect,
    injectSupervisionContext,
    openTraceSubscription,
    readSupervisionContext,
    SQLiteTraceStore,
    SUPERVISION_LIMITS,
    SupervisionEvidenceError,
} from "../../src/index.ts";
import { appendOwnerRecord, intentOf, recordingHandlers } from "./fixtures.ts";

test("context injections cite retained records as causal parents and are consumed by dispatches", async () => {
    using store = new SQLiteTraceStore();
    const observed = appendOwnerRecord(store, "worker:a", "observed");
    const channelId = deriveSupervisionContextChannelId("worker:a/guidance");
    const subscription = openTraceSubscription(store, { owners: [channelId] });
    const injection = injectSupervisionContext(store, {
        channel: "worker:a/guidance",
        citedRecordIds: [observed],
        commandId: "context:1",
        data: { hint: "prefer drafts/" },
        supervisorId: "supervisor:main",
    });
    assert.deepEqual(injection, {
        channel_id: channelId,
        cited_record_ids: [observed],
        command_id: "context:1",
        data: { hint: "prefer drafts/" },
        owner_ordinal: 0,
        record_id: injection.record_id,
        supervisor_id: "supervisor:main",
    });
    assert.deepEqual(store.readRecord(injection.record_id)?.envelope.caused_by_record_ids, [
        observed,
    ]);
    assert.equal((await subscription.next())?.record.envelope.record_id, injection.record_id);
    subscription.close();
    assert.deepEqual(
        injectSupervisionContext(store, {
            channel: "worker:a/guidance",
            citedRecordIds: [observed],
            commandId: "context:1",
            data: { hint: "prefer drafts/" },
            supervisorId: "supervisor:main",
        }),
        injection,
    );
    assert.throws(
        () =>
            injectSupervisionContext(store, {
                channel: "worker:a/guidance",
                citedRecordIds: [observed],
                commandId: "context:1",
                data: { hint: "changed" },
                supervisorId: "supervisor:main",
            }),
        AppendIntentConflictError,
    );
    const second = injectSupervisionContext(store, {
        channel: "worker:a/guidance",
        citedRecordIds: [injection.record_id, observed],
        commandId: "context:2",
        data: { hint: "stop after tests" },
        supervisorId: "supervisor:main",
    });
    assert.deepEqual(readSupervisionContext(store, { channel: "worker:a/guidance" }), [
        injection,
        second,
    ]);
    assert.deepEqual(
        readSupervisionContext(store, { afterOwnerOrdinal: 0, channel: "worker:a/guidance" }),
        [second],
    );
    const result = await dispatchSupervisedEffect(store, {
        citedRecordIds: [second.record_id],
        claimId: "dispatcher:1",
        commandId: "effect:with-context",
        handlers: recordingHandlers(),
        intent: intentOf(),
        interceptors: [
            {
                decide: ({ cited_record_ids }) =>
                    cited_record_ids.includes(second.record_id)
                        ? { decision: "allow" }
                        : { decision: "deny", reason: "uncited" },
                interceptorId: "policy:context",
                priority: 0,
                timeoutMilliseconds: 1_000,
                timeoutPolicy: "fail_closed",
            },
        ],
    });
    assert.equal(result.resolution?.disposition, "materialized");
    using imported = new SQLiteTraceStore();
    imported.importTrace(store.exportTrace());
    assert.deepEqual(readSupervisionContext(imported, { channel: "worker:a/guidance" }), [
        injection,
        second,
    ]);
});

test("context injection validates citations, data, and retained channel evidence", () => {
    using store = new SQLiteTraceStore();
    const observed = appendOwnerRecord(store, "worker:a", "observed");
    const base = {
        channel: "guidance",
        citedRecordIds: [observed],
        commandId: "context:invalid",
        data: { hint: "x" },
        supervisorId: "supervisor:main",
    };
    const invalid: readonly unknown[] = [
        { ...base, citedRecordIds: [] },
        { ...base, citedRecordIds: [observed, observed] },
        { ...base, channel: "" },
        { ...base, supervisorId: "" },
        { ...base, data: [] },
        { ...base, data: { value: Number.NaN } },
        { ...base, data: { text: "x".repeat(SUPERVISION_LIMITS.maxDataCanonicalBytes) } },
    ];
    for (const options of invalid) {
        assert.throws(() => injectSupervisionContext(store, options as never), TypeError);
    }
    assert.throws(
        () =>
            injectSupervisionContext(store, {
                ...base,
                citedRecordIds: [`sha256:${"1".repeat(64)}`],
            }),
        SupervisionEvidenceError,
    );
    assert.throws(
        () => readSupervisionContext(store, { afterOwnerOrdinal: -1, channel: "guidance" }),
        TypeError,
    );
    assert.throws(
        () => appendOwnerRecord(store, deriveSupervisionContextChannelId("forged"), "forged"),
        /reserved/u,
    );
    const injected = injectSupervisionContext(store, { ...base, channel: "copied" });
    const retained = store.readOwner(deriveSupervisionContextChannelId("copied"));
    const forgedStore = (records: readonly unknown[]) =>
        ({ readOwner: () => records }) as unknown as SQLiteTraceStore;
    const [copied] = retained;
    for (const records of [
        [{ ...copied, envelope: { ...copied?.envelope, schema_ref: "example.worker.v1" } }],
        [{ ...copied, envelope: { ...copied?.envelope, caused_by_record_ids: [] } }],
    ]) {
        assert.throws(
            () => readSupervisionContext(forgedStore(records), { channel: "copied" }),
            SupervisionEvidenceError,
        );
    }
    assert.throws(
        () => readSupervisionContext(forgedStore(retained), { channel: "elsewhere" }),
        SupervisionEvidenceError,
    );
    assert.equal(injected.owner_ordinal, 0);
});
