import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import type { SQLiteTraceStoreOptions } from "../../src/index.ts";
import { SQLiteTraceStore } from "../../src/index.ts";

test("SQLiteTraceStore validates blob inputs and closed options", () => {
    const malformedOptions: readonly unknown[] = [
        null,
        [],
        new (class Options {})(),
        { blobDirectory: "" },
        { blobDirectory: 1 },
        { extra: true },
        { [Symbol("unsupported")]: true },
        Object.defineProperty({}, "blobDirectory", { get: () => "/tmp/invalid" }),
    ];
    for (const options of malformedOptions) {
        assert.throws(
            () => new SQLiteTraceStore(":memory:", options as SQLiteTraceStoreOptions),
            TypeError,
        );
    }

    const store = new SQLiteTraceStore();
    assert.throws(() => store.putBlob("not bytes" as unknown as Uint8Array), TypeError);
    assert.throws(() => store.readBlob("invalid"), TypeError);
    assert.equal(store.readBlob(`sha256:${"1".repeat(64)}`), undefined);
    const emptyReceipt = store.putBlob(new Uint8Array());
    assert.equal(emptyReceipt.byte_length, 0);
    assert.deepEqual(store.verifyBlobs(), {
        checked_blob_count: 1,
        issues: [],
        ok: true,
    });
    store.close();
});

test("SQLiteTraceStore closes blob setup when database opening fails", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-blob-open-failure-test-"));
    context.after(() => rm(directory, { force: true, recursive: true }));

    assert.throws(
        () =>
            new SQLiteTraceStore(directory, {
                blobDirectory: path.join(directory, "blobs"),
            }),
    );
});
