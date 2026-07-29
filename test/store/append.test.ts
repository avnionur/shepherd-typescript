import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { StoreAppendRequest } from "../../src/index.ts";
import { AppendIntentConflictError, ROOT_WITNESS_ID, SQLiteTraceStore } from "../../src/index.ts";

test("SQLiteTraceStore atomically appends and reopens retained records", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-store-test-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const databasePath = path.join(directory, "trace.sqlite");
    const store = new SQLiteTraceStore(databasePath);

    const request = {
        append_intent_id: "intent:first",
        batch: {
            groups: [
                {
                    owner_id: "run:alpha",
                    records: [
                        {
                            append_local_id: "started",
                            body: { operation: "task.started" },
                            mode: "capture",
                            schema_ref: "example.task-event.v1",
                            witness_ref: ROOT_WITNESS_ID,
                        },
                        {
                            body: { operation: "task.completed" },
                            caused_by_local_refs: ["started"],
                            mode: "capture",
                            schema_ref: "example.task-event.v1",
                            witness_ref: ROOT_WITNESS_ID,
                        },
                    ],
                },
            ],
        },
    } satisfies StoreAppendRequest;
    const receipt = store.append(request);

    assert.equal(receipt.append_intent_id, "intent:first");
    assert.equal(receipt.record_ids.length, 2);
    assert.deepEqual(receipt.owner_ordinal_ranges.get("run:alpha"), [0, 1]);
    assert.deepEqual(
        store.readOwner("run:alpha").map(({ view }) => view.owner_ordinal),
        [0, 1],
    );
    assert.equal(
        store.readRecord(receipt.record_ids[1] ?? "")?.envelope.caused_by_record_ids[0],
        receipt.record_ids[0],
    );
    store.close();

    const reopened = new SQLiteTraceStore(databasePath);
    assert.equal(reopened.schemaVersion, 1);
    assert.deepEqual(
        reopened.readOwner("run:alpha").map(({ body }) => body.operation),
        ["task.started", "task.completed"],
    );
    assert.deepEqual(reopened.append(request), receipt);
    reopened.close();
});

test("SQLiteTraceStore replays equal intents and rejects conflicting retries", () => {
    const store = new SQLiteTraceStore();
    const request = {
        append_intent_id: "intent:stable",
        batch: {
            groups: [
                {
                    owner_id: "run:alpha",
                    records: [
                        {
                            body: { value: 1 },
                            mode: "capture" as const,
                            schema_ref: "example.value.v1",
                            witness_ref: ROOT_WITNESS_ID,
                        },
                    ],
                },
            ],
        },
    };

    const first = store.append(request);
    const replay = store.append(request);

    assert.deepEqual(replay, first);
    assert.throws(
        () =>
            store.append({
                append_intent_id: "intent:stable",
                batch: {
                    groups: [
                        {
                            owner_id: "run:alpha",
                            records: [
                                {
                                    body: { value: 2 },
                                    mode: "capture",
                                    schema_ref: "example.value.v1",
                                    witness_ref: ROOT_WITNESS_ID,
                                },
                            ],
                        },
                    ],
                },
            }),
        AppendIntentConflictError,
    );
    assert.equal(store.readOwner("run:alpha").length, 1);
    store.close();
});

test("SQLiteTraceStore continues owner ordinals and shares semantic records across owners", () => {
    const store = new SQLiteTraceStore();
    const record = {
        body: { value: "shared" },
        mode: "capture" as const,
        schema_ref: "example.value.v1",
        witness_ref: ROOT_WITNESS_ID,
    };

    const first = store.append({
        append_intent_id: "intent:alpha",
        batch: {
            groups: [
                {
                    owner_id: "run:alpha",
                    records: [record, { ...record, body: { value: "second" } }],
                },
            ],
        },
    });
    const second = store.append({
        append_intent_id: "intent:beta",
        batch: {
            groups: [
                { owner_id: "run:alpha", records: [{ ...record, body: { value: "third" } }] },
                { owner_id: "run:beta", records: [record] },
            ],
        },
    });

    assert.deepEqual(first.owner_ordinal_ranges.get("run:alpha"), [0, 1]);
    assert.deepEqual(second.owner_ordinal_ranges.get("run:alpha"), [2, 2]);
    assert.deepEqual(second.owner_ordinal_ranges.get("run:beta"), [0, 0]);
    assert.deepEqual(
        store.readOwner("run:alpha").map(({ view }) => view.owner_ordinal),
        [0, 1, 2],
    );
    assert.deepEqual(store.readRecord(first.record_ids[0] ?? "")?.views, [
        { owner_id: "run:alpha", owner_ordinal: 0 },
        { owner_id: "run:beta", owner_ordinal: 0 },
    ]);
    store.close();
});
