import assert from "node:assert/strict";
import { test } from "node:test";
import type { StoreAppendRequest } from "../../src/index.ts";
import { SQLiteTraceStore } from "../../src/index.ts";

test("SQLiteTraceStore rejects malformed append request containers", () => {
    const store = new SQLiteTraceStore();
    const malformed: readonly unknown[] = [
        null,
        [],
        new (class Request {})(),
        { append_intent_id: "intent:extra", batch: { groups: [] }, extra: true },
        { append_intent_id: "intent:missing" },
        { append_intent_id: "", batch: { groups: [] } },
        Object.assign(
            { append_intent_id: "intent:symbol", batch: { groups: [] } },
            {
                [Symbol("unsupported")]: true,
            },
        ),
        Object.defineProperty({ batch: { groups: [] } }, "append_intent_id", {
            get: () => "intent:accessor",
        }),
    ];

    for (const request of malformed) {
        assert.throws(() => store.append(request as StoreAppendRequest), TypeError);
    }
    store.close();
});

test("SQLiteTraceStore accepts null-prototype requests and empty batches", () => {
    const store = new SQLiteTraceStore();
    const request = Object.assign(Object.create(null) as object, {
        append_intent_id: "intent:empty",
        batch: { groups: [] },
    }) as StoreAppendRequest;

    const receipt = store.append(request);

    assert.deepEqual(receipt.record_ids, []);
    assert.deepEqual(receipt.causal_edges, []);
    assert.deepEqual([...receipt.owner_ordinal_ranges], []);
    assert.equal(store.readRecord(`sha256:${"1".repeat(64)}`), undefined);
    assert.deepEqual(store.readOwner("run:missing"), []);
    assert.throws(() => store.readRecord("invalid"), TypeError);
    assert.throws(() => store.readOwner(""), TypeError);
    store.close();
});
