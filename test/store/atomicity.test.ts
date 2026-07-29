import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import {
    planAppendBatch,
    ROOT_WITNESS_ID,
    SQLiteTraceStore,
    TraceStoreError,
} from "../../src/index.ts";

test("failed parent and witness validation leaves the append intent reusable", () => {
    const store = new SQLiteTraceStore();
    const validRecord = {
        body: { value: 1 },
        mode: "capture" as const,
        schema_ref: "example.value.v1",
        witness_ref: ROOT_WITNESS_ID,
    };
    const unknownId = `sha256:${"9".repeat(64)}`;

    assert.throws(
        () =>
            store.append({
                append_intent_id: "intent:retry",
                batch: {
                    groups: [
                        {
                            owner_id: "run:alpha",
                            records: [{ ...validRecord, caused_by_record_ids: [unknownId] }],
                        },
                    ],
                },
            }),
        /unknown causal parent/,
    );
    assert.throws(
        () =>
            store.append({
                append_intent_id: "intent:witness",
                batch: {
                    groups: [
                        {
                            owner_id: "run:alpha",
                            records: [{ ...validRecord, witness_ref: unknownId }],
                        },
                    ],
                },
            }),
        TraceStoreError,
    );
    assert.equal(store.readOwner("run:alpha").length, 0);

    assert.equal(
        store.append({
            append_intent_id: "intent:retry",
            batch: {
                groups: [{ owner_id: "run:alpha", records: [validRecord] }],
            },
        }).record_ids.length,
        1,
    );
    assert.equal(
        store.append({
            append_intent_id: "intent:witness",
            batch: {
                groups: [
                    { owner_id: "run:alpha", records: [{ ...validRecord, body: { value: 2 } }] },
                ],
            },
        }).record_ids.length,
        1,
    );
    store.close();
});

test("SQLite failure rolls back records, views, ordinals, and append intent", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-atomicity-test-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const databasePath = path.join(directory, "trace.sqlite");
    const store = new SQLiteTraceStore(databasePath);
    const batch = {
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
                    {
                        body: { value: 2 },
                        mode: "capture" as const,
                        schema_ref: "example.value.v1",
                        witness_ref: ROOT_WITNESS_ID,
                    },
                ],
            },
        ],
    };
    const planned = planAppendBatch(batch, {
        known_record_ids: new Set([ROOT_WITNESS_ID]),
    });
    const injector = new DatabaseSync(databasePath);
    injector.exec(`
        CREATE TRIGGER fail_second_view
        BEFORE INSERT ON record_views
        WHEN NEW.owner_ordinal = 1
        BEGIN
            SELECT RAISE(ABORT, 'injected append failure');
        END;
    `);

    assert.throws(
        () => store.append({ append_intent_id: "intent:atomic", batch }),
        /injected append failure/,
    );
    assert.equal(store.readOwner("run:alpha").length, 0);
    for (const record of planned.records) {
        assert.equal(store.readRecord(record.envelope.record_id), undefined);
    }

    injector.exec("DROP TRIGGER fail_second_view");
    injector.close();
    assert.equal(store.append({ append_intent_id: "intent:atomic", batch }).record_ids.length, 2);
    store.close();
});
