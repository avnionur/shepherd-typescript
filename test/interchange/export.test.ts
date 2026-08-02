import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
    KERNEL_ABI_VERSION,
    KERNEL_CANONICAL_VERSION,
    ROOT_WITNESS_ID,
    SQLiteTraceStore,
} from "../../src/index.ts";

test("SQLiteTraceStore exports deterministic complete trace state", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-export-test-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    const recordId =
        store.append({
            append_intent_id: "intent:export",
            batch: {
                groups: [
                    {
                        owner_id: "run:export",
                        records: [
                            {
                                body: { unknown_future_field: { retained: true } },
                                mode: "capture",
                                schema_ref: "example.export.v1",
                                witness_ref: ROOT_WITNESS_ID,
                            },
                        ],
                    },
                ],
            },
        }).record_ids[0] ?? "";
    store.publishCut({
        append_intent_id: "intent:export-cut",
        cut_id: "cut:export",
        target_owner_id: "run:export",
        through_record_id: recordId,
    });
    const blob = store.putBlob(new TextEncoder().encode("portable bytes"));

    const first = store.exportTrace();
    assert.equal(store.exportTrace(), first);
    const archive = JSON.parse(first) as Record<string, unknown>;

    assert.equal(archive.format, "shepherd.trace.archive");
    assert.equal(archive.format_version, 1);
    assert.equal(archive.kernel_abi_version, KERNEL_ABI_VERSION);
    assert.equal(archive.canonical_version, KERNEL_CANONICAL_VERSION);
    assert.equal((archive.records as unknown[]).length, 3);
    assert.equal((archive.record_views as unknown[]).length, 2);
    assert.equal((archive.append_intents as unknown[]).length, 2);
    assert.equal((archive.cuts as unknown[]).length, 1);
    assert.deepEqual(archive.blobs, [
        {
            blob_id: blob.blob_id,
            byte_length: 14,
            content_base64: "cG9ydGFibGUgYnl0ZXM=",
        },
    ]);
});
