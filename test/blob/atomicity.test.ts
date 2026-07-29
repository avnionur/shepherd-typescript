import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import { SQLiteTraceStore } from "../../src/index.ts";

test("failed blob receipt commit remains invisible and retryable", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-blob-atomicity-test-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const databasePath = path.join(directory, "trace.sqlite");
    const blobDirectory = path.join(directory, "blobs");
    const store = new SQLiteTraceStore(databasePath, { blobDirectory });
    const content = new TextEncoder().encode("shepherd");
    const blobId = "sha256:def3735d7a0d2696775d6d72f379e4536c4d9e3cd6367f27a0bcb7f40d4558fb";
    const injector = new DatabaseSync(databasePath);
    injector.exec(`
        CREATE TRIGGER fail_blob_receipt
        BEFORE INSERT ON storage_receipts
        BEGIN
            SELECT RAISE(ABORT, 'injected blob receipt failure');
        END;
    `);

    assert.throws(() => store.putBlob(content), /injected blob receipt failure/);
    assert.equal(store.readBlob(blobId), undefined);

    injector.exec("DROP TRIGGER fail_blob_receipt");
    injector.close();
    assert.equal(store.putBlob(content).blob_id, blobId);
    assert.deepEqual(store.readBlob(blobId), content);
    store.close();
});
