import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { BlobIntegrityError, SQLiteTraceStore } from "../../src/index.ts";

test("SQLiteTraceStore retains content-addressed blobs across reopen", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-blob-test-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const databasePath = path.join(directory, "trace.sqlite");
    const blobDirectory = path.join(directory, "blobs");
    const content = new TextEncoder().encode("shepherd");
    const expectedContent = new Uint8Array(content);
    const expectedBlobId =
        "sha256:def3735d7a0d2696775d6d72f379e4536c4d9e3cd6367f27a0bcb7f40d4558fb";

    const store = new SQLiteTraceStore(databasePath, { blobDirectory });
    const receipt = store.putBlob(content);

    assert.deepEqual(receipt, {
        blob_id: expectedBlobId,
        byte_length: content.byteLength,
    });
    content.fill(0);
    assert.deepEqual(store.readBlob(expectedBlobId), expectedContent);
    store.close();

    const reopened = new SQLiteTraceStore(databasePath, { blobDirectory });
    assert.deepEqual(reopened.readBlob(expectedBlobId), expectedContent);
    assert.deepEqual(reopened.putBlob(expectedContent), receipt);
    reopened.close();
});

test("SQLiteTraceStore reports and rejects corrupt blob bytes", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-blob-corruption-test-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const databasePath = path.join(directory, "trace.sqlite");
    const blobDirectory = path.join(directory, "blobs");
    const store = new SQLiteTraceStore(databasePath, { blobDirectory });
    const receipt = store.putBlob(new TextEncoder().encode("shepherd"));
    const digest = receipt.blob_id.slice("sha256:".length);
    await writeFile(path.join(blobDirectory, digest.slice(0, 2), digest), "corrupt!");

    assert.throws(() => store.readBlob(receipt.blob_id), BlobIntegrityError);
    assert.deepEqual(store.verifyBlobs(), {
        checked_blob_count: 1,
        issues: [{ blob_id: receipt.blob_id, kind: "digest_mismatch" }],
        ok: false,
    });
    store.close();
});
