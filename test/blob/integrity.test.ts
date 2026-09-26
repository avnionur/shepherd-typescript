import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import { BlobIntegrityError, SQLiteTraceStore } from "../../src/index.ts";

test("blob verification classifies missing, size, file-type, and receipt failures", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-blob-integrity-test-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const databasePath = path.join(directory, "trace.sqlite");
    const blobDirectory = path.join(directory, "blobs");
    const store = new SQLiteTraceStore(databasePath, { blobDirectory });
    const missing = store.putBlob(new TextEncoder().encode("missing"));
    const size = store.putBlob(new TextEncoder().encode("wrong-size"));
    const notFile = store.putBlob(new TextEncoder().encode("not-file"));
    const receipt = store.putBlob(new TextEncoder().encode("receipt"));
    const metadata = store.putBlob(new TextEncoder().encode("metadata"));
    const missingReceipt = store.putBlob(new TextEncoder().encode("missing-receipt"));

    await unlink(blobPath(blobDirectory, missing.blob_id));
    await writeFile(blobPath(blobDirectory, size.blob_id), "short");
    await unlink(blobPath(blobDirectory, notFile.blob_id));
    await mkdir(blobPath(blobDirectory, notFile.blob_id));
    const database = new DatabaseSync(databasePath);
    const orphanBlobId = `sha256:${"1".repeat(64)}`;
    database.exec("PRAGMA foreign_keys = OFF");
    database
        .prepare("UPDATE storage_receipts SET storage_key = ? WHERE blob_id = ?")
        .run("wrong/storage-key", receipt.blob_id);
    database.prepare("UPDATE blobs SET byte_length = 99 WHERE blob_id = ?").run(metadata.blob_id);
    database
        .prepare("UPDATE storage_receipts SET byte_length = 99 WHERE blob_id = ?")
        .run(metadata.blob_id);
    database.prepare("DELETE FROM storage_receipts WHERE blob_id = ?").run(missingReceipt.blob_id);
    database
        .prepare(
            `INSERT INTO storage_receipts(
                blob_id, storage_key, byte_length, receipt_version
             ) VALUES (?, ?, ?, ?)`,
        )
        .run(orphanBlobId, `11/${"1".repeat(64)}`, 0, 1);
    database.close();

    assert.throws(() => store.putBlob(new TextEncoder().encode("metadata")), BlobIntegrityError);
    const issues = new Map(
        store.verifyBlobs().issues.map((issue) => [issue.blob_id, issue.kind] as const),
    );
    assert.equal(issues.get(missing.blob_id), "missing");
    assert.equal(issues.get(size.blob_id), "size_mismatch");
    assert.equal(issues.get(notFile.blob_id), "not_regular_file");
    assert.equal(issues.get(receipt.blob_id), "receipt_mismatch");
    assert.equal(issues.get(metadata.blob_id), "size_mismatch");
    assert.equal(issues.get(missingReceipt.blob_id), "receipt_mismatch");
    assert.equal(issues.get(orphanBlobId), "receipt_mismatch");
    for (const { blob_id: blobId } of [missing, size, notFile, receipt, metadata, missingReceipt]) {
        assert.throws(() => store.readBlob(blobId), BlobIntegrityError);
    }
    assert.throws(() => store.readBlob(orphanBlobId), BlobIntegrityError);
    store.close();
});

test("blob verification propagates an unexpected filesystem read failure", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-blob-verify-fault-test-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const blobDirectory = path.join(directory, "blobs");
    const store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"), { blobDirectory });
    const { blob_id: blobId } = store.putBlob(new TextEncoder().encode("unreadable"));
    const digest = blobId.slice("sha256:".length);
    const injected = Object.assign(new Error("injected read failure"), { code: "EIO" });
    const readFileSync = fs.readFileSync;
    const read = context.mock.method(
        fs,
        "readFileSync",
        (...args: Parameters<typeof fs.readFileSync>) => {
            if (path.basename(String(args[0])) === digest) {
                throw injected;
            }
            return readFileSync(...args);
        },
    );
    syncBuiltinESMExports();
    try {
        assert.throws(
            () => store.verifyBlobs(),
            (error) => error === injected,
        );
    } finally {
        read.mock.restore();
        syncBuiltinESMExports();
    }
    assert.deepEqual(store.verifyBlobs(), { checked_blob_count: 1, issues: [], ok: true });
    store.close();
});

function blobPath(blobDirectory: string, blobId: string): string {
    const digest = blobId.slice("sha256:".length);
    return path.join(blobDirectory, digest.slice(0, 2), digest);
}
