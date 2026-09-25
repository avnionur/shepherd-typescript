import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import {
    forkScope,
    ROOT_WITNESS_ID,
    ScopeEvidenceError,
    SQLiteTraceStore,
    type StoreAppendRequest,
    TraceStoreError,
} from "../../src/index.ts";
import { createForkWorkspace, forkOptions } from "../scope/fork-fixtures.ts";

const request: StoreAppendRequest = {
    append_intent_id: "intent:corruption",
    batch: {
        groups: [
            {
                owner_id: "run:alpha",
                records: [
                    {
                        body: { value: 1 },
                        caused_by_record_ids: [ROOT_WITNESS_ID],
                        mode: "capture",
                        schema_ref: "example.value.v1",
                        witness_ref: ROOT_WITNESS_ID,
                    },
                ],
            },
        ],
    },
};

test("SQLiteTraceStore rejects corrupt persisted record views", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-view-corruption-test-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const databasePath = path.join(directory, "trace.sqlite");
    const store = new SQLiteTraceStore(databasePath);
    const [recordId] = store.append(request).record_ids;
    store.close();

    const database = new DatabaseSync(databasePath);
    assert.throws(() =>
        database.prepare("UPDATE record_views SET owner_ordinal = ?").run(Number.MAX_SAFE_INTEGER),
    );
    database.exec("PRAGMA ignore_check_constraints = ON");
    database.prepare("UPDATE record_views SET owner_ordinal = ?").run(Number.MAX_SAFE_INTEGER);
    database.close();

    const reopened = new SQLiteTraceStore(databasePath);
    assert.throws(() => reopened.readOwner("run:alpha"), /configured ordinal range/);
    reopened.close();

    const corruptOwner = new DatabaseSync(databasePath);
    corruptOwner.exec("PRAGMA ignore_check_constraints = ON");
    corruptOwner.prepare("UPDATE record_views SET owner_id = ''").run();
    corruptOwner.close();

    const ownerReopened = new SQLiteTraceStore(databasePath);
    assert.throws(() => ownerReopened.readRecord(recordId ?? ""), /non-empty string/);
    ownerReopened.close();
});

test("SQLiteTraceStore rejects malformed and inconsistent stored append receipts", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-receipt-corruption-test-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const databasePath = path.join(directory, "trace.sqlite");
    const store = new SQLiteTraceStore(databasePath);
    const receipt = store.append(request);
    store.close();
    const [recordId] = receipt.record_ids;
    const validId = recordId ?? ROOT_WITNESS_ID;
    const validReceipt = {
        append_intent_id: request.append_intent_id,
        causal_edges: [[ROOT_WITNESS_ID, validId]],
        owner_ordinal_ranges: [["run:alpha", [0, 0]]],
        record_ids: [validId],
    };
    const invalidReceipts: readonly unknown[] = [
        null,
        {},
        { ...validReceipt, append_intent_id: "intent:other" },
        { ...validReceipt, record_ids: null },
        { ...validReceipt, record_ids: ["invalid"] },
        { ...validReceipt, causal_edges: null },
        { ...validReceipt, causal_edges: [[validId]] },
        { ...validReceipt, causal_edges: [["invalid", validId]] },
        { ...validReceipt, causal_edges: [[validId, "invalid"]] },
        { ...validReceipt, causal_edges: [[validId, ROOT_WITNESS_ID]] },
        { ...validReceipt, owner_ordinal_ranges: null },
        { ...validReceipt, owner_ordinal_ranges: [["run:alpha"]] },
        { ...validReceipt, owner_ordinal_ranges: [["", [0, 0]]] },
        {
            ...validReceipt,
            owner_ordinal_ranges: [
                ["run:alpha", [0, 0]],
                ["run:alpha", [1, 1]],
            ],
        },
        { ...validReceipt, owner_ordinal_ranges: [["run:alpha", [0]]] },
        { ...validReceipt, owner_ordinal_ranges: [["run:alpha", [0.5, 0]]] },
        { ...validReceipt, owner_ordinal_ranges: [["run:alpha", [0, 0.5]]] },
        { ...validReceipt, owner_ordinal_ranges: [["run:alpha", [-1, 0]]] },
        {
            ...validReceipt,
            owner_ordinal_ranges: [["run:alpha", [0, Number.MAX_SAFE_INTEGER]]],
        },
        { ...validReceipt, owner_ordinal_ranges: [["run:alpha", [1, 0]]] },
        { ...validReceipt, owner_ordinal_ranges: [["run:alpha", [0, 1]]] },
        {
            ...validReceipt,
            causal_edges: [[ROOT_WITNESS_ID, `sha256:${"1".repeat(64)}`]],
            record_ids: [`sha256:${"1".repeat(64)}`],
        },
        { ...validReceipt, owner_ordinal_ranges: [["run:alpha", [1, 1]]] },
        { ...validReceipt, owner_ordinal_ranges: [["run:forged", [0, 0]]] },
    ];

    const database = new DatabaseSync(databasePath);
    const updateReceipt = database.prepare(
        "UPDATE append_intents SET receipt_json = ? WHERE append_intent_id = ?",
    );
    for (const invalidReceipt of invalidReceipts) {
        updateReceipt.run(JSON.stringify(invalidReceipt), request.append_intent_id);
        const reopened = new SQLiteTraceStore(databasePath);
        assert.throws(() => reopened.append(request), TraceStoreError);
        reopened.close();
    }
    updateReceipt.run(JSON.stringify(validReceipt), request.append_intent_id);
    database.prepare("UPDATE record_views SET append_position = 1").run();
    const positionReopened = new SQLiteTraceStore(databasePath);
    assert.throws(() => positionReopened.append(request), /positions are not contiguous/);
    positionReopened.close();
    database.prepare("UPDATE record_views SET append_position = 0").run();
    database.close();

    const reopened = new SQLiteTraceStore(databasePath);
    assert.deepEqual(reopened.append(request), receipt);
    reopened.close();
});

test("fork replay refuses a registration whose prepared journal intent is not retained", async (context) => {
    const workspace = await createForkWorkspace(context, "lost-prepared-intent");
    const { carrier, databasePath, source, store } = workspace;
    const origin = await carrier.snapshot(source);
    const options = forkOptions(workspace, origin.revision_id);
    const fork = await forkScope(store, options);
    const preparedIntentId = store
        .readRecord(fork.prepared_record_id)
        ?.views.find(({ owner_id }) => owner_id === fork.scope_id)?.append_intent_id;
    assert.equal(typeof preparedIntentId, "string");
    const database = new DatabaseSync(databasePath);
    database.exec("PRAGMA foreign_keys = OFF");
    database
        .prepare("DELETE FROM append_intents WHERE append_intent_id = ?")
        .run(preparedIntentId ?? "");
    database.close();

    await assert.rejects(
        forkScope(store, options),
        (error: unknown) =>
            error instanceof ScopeEvidenceError &&
            error.message.endsWith("scope fork registration lacks its prepared record"),
    );
    store.close();
});
