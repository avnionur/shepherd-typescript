import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { canonicalizeRecord, type SemanticRecord, SQLiteTraceStore } from "../../src/index.ts";

const fixture = readFileSync(new URL("../fixtures/trace-archive-v1.json", import.meta.url), "utf8");

test("native trace archive v1 matches the implementation-neutral fixture", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-conformance-import-test-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));

    const receipt = store.importTrace(fixture);
    assert.deepEqual(receipt, {
        imported_append_intent_count: 2,
        imported_blob_count: 1,
        imported_cut_count: 1,
        imported_record_count: 3,
        imported_record_view_count: 2,
    });
    assert.equal(store.exportTrace(), canonicalizeRecord(JSON.parse(fixture) as SemanticRecord));
    assert.deepEqual(store.readCut("cut:fixture"), {
        created_by_record_id:
            "sha256:db8837ba53e0fa823e9553380e754b2b1c97cd448c4666ac4088a2fafe1a37df",
        cut_id: "cut:fixture",
        publisher_owner_id: "run:fixture",
        target_owner_id: "run:fixture",
        through_owner_ordinal: 0,
        through_record_id:
            "sha256:2253b7151bc38ba6b5d2cd1265e478b505ba91669a3060622e8cb51063570cf5",
    });
    assert.deepEqual(
        store.readBlob("sha256:5e4b1c31c9941d072b8515b104d5ac43ab98eaf29b9e9971ced073e438f18a27"),
        new TextEncoder().encode("fixture blob"),
    );
});
