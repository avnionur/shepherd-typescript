import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import { BlobIntegrityError, SQLiteTraceStore } from "../../src/index.ts";

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

test("an unexpected link failure while publishing a blob propagates unchanged and stays retryable", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-blob-link-fault-test-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const blobDirectory = path.join(directory, "blobs");
    const store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"), { blobDirectory });
    const content = new TextEncoder().encode("shepherd");
    const blobId = "sha256:def3735d7a0d2696775d6d72f379e4536c4d9e3cd6367f27a0bcb7f40d4558fb";
    const injected = Object.assign(new Error("injected link failure"), { code: "EIO" });
    const link = context.mock.method(fs, "linkSync", () => {
        throw injected;
    });
    syncBuiltinESMExports();
    try {
        assert.throws(
            () => store.putBlob(content),
            (error) => error === injected,
        );
    } finally {
        link.mock.restore();
        syncBuiltinESMExports();
    }
    assert.equal(link.mock.callCount(), 1);
    assert.equal(store.readBlob(blobId), undefined);
    assert.deepEqual(await readdir(path.join(blobDirectory, "de")), []);

    assert.equal(store.putBlob(content).blob_id, blobId);
    assert.deepEqual(store.readBlob(blobId), content);
    store.close();
});

test("an unexpected storage-directory failure propagates without an integrity reclassification", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-blob-mkdir-fault-test-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const blobDirectory = path.join(directory, "blobs");
    const store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"), { blobDirectory });
    const content = new TextEncoder().encode("shepherd");
    const blobId = "sha256:def3735d7a0d2696775d6d72f379e4536c4d9e3cd6367f27a0bcb7f40d4558fb";
    const injected = Object.assign(new Error("injected mkdir failure"), { code: "EACCES" });
    const mkdir = context.mock.method(fs, "mkdirSync", () => {
        throw injected;
    });
    syncBuiltinESMExports();
    try {
        assert.throws(
            () => store.putBlob(content),
            (error) => error === injected && !(error instanceof BlobIntegrityError),
        );
    } finally {
        mkdir.mock.restore();
        syncBuiltinESMExports();
    }
    assert.equal(mkdir.mock.callCount(), 1);
    assert.equal(store.readBlob(blobId), undefined);
    assert.deepEqual(await readdir(blobDirectory), []);

    assert.equal(store.putBlob(content).blob_id, blobId);
    store.close();
});
