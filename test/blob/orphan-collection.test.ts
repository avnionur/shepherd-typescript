import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { access, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import { BlobIntegrityError, SQLiteTraceStore } from "../../src/index.ts";

test("blob orphan collection inspects before deleting unregistered objects", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-orphan-collection-test-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const databasePath = path.join(directory, "trace.sqlite");
    const blobDirectory = path.join(directory, "blobs");
    using store = new SQLiteTraceStore(databasePath, { blobDirectory });
    const retained = store.putBlob(new TextEncoder().encode("retained"));
    const orphanContent = new TextEncoder().encode("orphaned");
    const orphanId = `sha256:${createHash("sha256").update(orphanContent).digest("hex")}`;
    const database = new DatabaseSync(databasePath);
    database.exec(`
        CREATE TRIGGER fail_orphan_receipt
        BEFORE INSERT ON blobs
        BEGIN
            SELECT RAISE(ABORT, 'injected orphan');
        END;
    `);
    assert.throws(() => store.putBlob(orphanContent), /injected orphan/);
    database.exec("DROP TRIGGER fail_orphan_receipt");
    database.close();
    const orphanPath = path.join(blobDirectory, orphanId.slice(7, 9), orphanId.slice(7));

    assert.deepEqual(store.collectBlobOrphans(), {
        deleted_blob_ids: [],
        deleted_temporary_file_count: 0,
        mode: "inspect",
        orphan_blob_ids: [orphanId],
        orphan_temporary_file_count: 0,
    });
    await access(orphanPath);
    assert.deepEqual(store.readBlob(retained.blob_id), new TextEncoder().encode("retained"));

    assert.deepEqual(store.collectBlobOrphans({ mode: "delete" }), {
        deleted_blob_ids: [orphanId],
        deleted_temporary_file_count: 0,
        mode: "delete",
        orphan_blob_ids: [orphanId],
        orphan_temporary_file_count: 0,
    });
    await assert.rejects(access(orphanPath));
    assert.deepEqual(store.readBlob(retained.blob_id), new TextEncoder().encode("retained"));
});

test("blob orphan collection deletes abandoned temporary files", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-temp-collection-test-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const databasePath = path.join(directory, "trace.sqlite");
    const blobDirectory = path.join(directory, "blobs");
    using store = new SQLiteTraceStore(databasePath, { blobDirectory });
    const retained = store.putBlob(new TextEncoder().encode("temporary-root"));
    const bucket = path.join(blobDirectory, retained.blob_id.slice(7, 9));
    const temporaryPath = path.join(bucket, ".tmp-abandoned");
    await writeFile(temporaryPath, "abandoned");

    assert.equal(store.collectBlobOrphans().orphan_temporary_file_count, 1);
    await access(temporaryPath);
    assert.equal(store.collectBlobOrphans({ mode: "delete" }).deleted_temporary_file_count, 1);
    await assert.rejects(access(temporaryPath));
    assert.deepEqual(store.readBlob(retained.blob_id), new TextEncoder().encode("temporary-root"));
});

test("blob orphan collection waits for an in-flight registered writer", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-concurrent-collection-test-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const databasePath = path.join(directory, "trace.sqlite");
    const blobDirectory = path.join(directory, "blobs");
    using store = new SQLiteTraceStore(databasePath, { blobDirectory });
    const child = spawn(
        process.execPath,
        [
            new URL("../fixtures/concurrent-blob-writer.ts", import.meta.url).pathname,
            databasePath,
            blobDirectory,
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
    );
    context.after(() => {
        if (child.exitCode === null && child.signalCode === null) {
            child.kill("SIGKILL");
        }
    });
    const [published] = (await once(child.stdout, "data")) as [Buffer];
    const blobId = published.toString().trim();
    const exit = once(child, "exit");

    assert.deepEqual(store.collectBlobOrphans({ mode: "delete" }).orphan_blob_ids, []);
    const [exitCode] = (await exit) as [number | null];
    assert.equal(exitCode, 0);
    assert.deepEqual(store.readBlob(blobId), new TextEncoder().encode("concurrent retained blob"));
});

test("blob orphan collection fails closed for corrupt receipts and unsafe fanout", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-unsafe-collection-test-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const databasePath = path.join(directory, "trace.sqlite");
    const blobDirectory = path.join(directory, "blobs");
    using store = new SQLiteTraceStore(databasePath, { blobDirectory });
    const retained = store.putBlob(new TextEncoder().encode("registered"));
    const retainedPath = path.join(
        blobDirectory,
        retained.blob_id.slice(7, 9),
        retained.blob_id.slice(7),
    );
    await writeFile(retainedPath, "corrupt");
    assert.throws(() => store.collectBlobOrphans({ mode: "delete" }));

    await writeFile(retainedPath, "registered");
    const externalDirectory = path.join(directory, "external");
    await mkdir(externalDirectory);
    const unsafeBucket = retained.blob_id.slice(7, 9) === "00" ? "01" : "00";
    await symlink(externalDirectory, path.join(blobDirectory, unsafeBucket), "dir");
    assert.throws(() => store.collectBlobOrphans({ mode: "delete" }));
    await access(externalDirectory);
});

test("blob orphan collection ignores foreign root entries and rejects malformed store objects", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-malformed-collection-test-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const databasePath = path.join(directory, "trace.sqlite");
    const blobDirectory = path.join(directory, "blobs");
    using store = new SQLiteTraceStore(databasePath, { blobDirectory });
    const retained = store.putBlob(new TextEncoder().encode("layout"));
    await writeFile(path.join(blobDirectory, "foreign-root-file"), "preserved");
    assert.deepEqual(store.collectBlobOrphans().orphan_blob_ids, []);

    const bucket = path.join(blobDirectory, retained.blob_id.slice(7, 9));
    const malformedPath = path.join(bucket, "malformed");
    await writeFile(malformedPath, "invalid");
    assert.throws(() => store.collectBlobOrphans());
    await rm(malformedPath);
    const mismatchedCharacter = retained.blob_id.slice(7, 9) === "ff" ? "e" : "f";
    const mismatchedPath = path.join(bucket, mismatchedCharacter.repeat(64));
    await writeFile(mismatchedPath, "invalid");
    assert.throws(() => store.collectBlobOrphans());
    await rm(mismatchedPath);
    await mkdir(malformedPath);
    assert.throws(() => store.collectBlobOrphans());
});

test("blob orphan collection rejects a root replaced after store construction", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-root-swap-collection-test-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const blobDirectory = path.join(directory, "blobs");
    using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"), { blobDirectory });
    const movedBlobDirectory = path.join(directory, "original-blobs");
    const externalDirectory = path.join(directory, "external");
    const externalBucket = path.join(externalDirectory, "00");
    const externalObject = path.join(externalBucket, "0".repeat(64));
    await mkdir(externalBucket, { recursive: true });
    await writeFile(externalObject, "preserved");
    await rename(blobDirectory, movedBlobDirectory);
    await symlink(externalDirectory, blobDirectory, "dir");

    assert.throws(() => store.collectBlobOrphans({ mode: "delete" }), BlobIntegrityError);
    assert.equal(await readFile(externalObject, "utf8"), "preserved");
});

test("blob orphan collection validates closed options and store lifecycle", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-collection-options-test-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    for (const options of [
        null,
        [],
        new Date(),
        { extra: true },
        { mode: 1 },
        { mode: "unknown" },
        { [Symbol("invalid")]: true },
        Object.defineProperty({}, "mode", { get: () => "delete" }),
    ]) {
        assert.throws(() => store.collectBlobOrphans(options as never), TypeError);
    }
    assert.equal(store.collectBlobOrphans(Object.create(null) as never).mode, "inspect");
    store.close();
    assert.throws(() => store.collectBlobOrphans());
});
