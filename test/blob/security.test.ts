import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { BlobIntegrityError, SQLiteTraceStore } from "../../src/index.ts";

test("blob writes reject a fanout symlink without modifying its target", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-blob-symlink-test-"));
    const outside = await mkdtemp(path.join(tmpdir(), "shepherd-blob-outside-test-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    context.after(() => rm(outside, { force: true, recursive: true }));
    const markerPath = path.join(outside, "marker");
    await writeFile(markerPath, "preserved");
    const blobDirectory = path.join(directory, "blobs");
    await mkdir(blobDirectory);
    await symlink(outside, path.join(blobDirectory, "de"), "dir");
    const store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"), { blobDirectory });

    assert.throws(() => store.putBlob(new TextEncoder().encode("shepherd")), BlobIntegrityError);
    assert.equal(await readFile(markerPath, "utf8"), "preserved");
    store.close();
});

test("blob store construction rejects a symlinked root", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-blob-root-link-test-"));
    const outside = await mkdtemp(path.join(tmpdir(), "shepherd-blob-root-target-test-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    context.after(() => rm(outside, { force: true, recursive: true }));
    const markerPath = path.join(outside, "marker");
    await writeFile(markerPath, "preserved");
    const blobDirectory = path.join(directory, "blobs");
    await symlink(outside, blobDirectory, "dir");

    assert.throws(
        () => new SQLiteTraceStore(path.join(directory, "trace.sqlite"), { blobDirectory }),
        TypeError,
    );
    assert.deepEqual(await readdir(outside), ["marker"]);
    assert.equal(await readFile(markerPath, "utf8"), "preserved");
});

test("blob store construction rejects a symlinked root ancestor", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-blob-root-parent-link-test-"));
    const outside = await mkdtemp(path.join(tmpdir(), "shepherd-blob-root-parent-target-test-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    context.after(() => rm(outside, { force: true, recursive: true }));
    const markerPath = path.join(outside, "marker");
    await writeFile(markerPath, "preserved");
    await mkdir(path.join(outside, "blobs"));
    const linkedParent = path.join(directory, "linked");
    await symlink(outside, linkedParent, "dir");

    assert.throws(
        () =>
            new SQLiteTraceStore(path.join(directory, "trace.sqlite"), {
                blobDirectory: path.join(linkedParent, "blobs"),
            }),
        TypeError,
    );
    assert.deepEqual((await readdir(path.join(outside, "blobs"))).sort(), []);
    assert.equal(await readFile(markerPath, "utf8"), "preserved");
});

test("blob store construction rejects a non-directory root", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-blob-root-file-test-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const blobDirectory = path.join(directory, "blob-file");
    await writeFile(blobDirectory, "preserved");

    assert.throws(
        () => new SQLiteTraceStore(path.join(directory, "trace.sqlite"), { blobDirectory }),
        TypeError,
    );
    assert.equal(await readFile(blobDirectory, "utf8"), "preserved");
});

test("blob writes clean temporary files when the destination is not a file", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-blob-file-type-test-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const blobDirectory = path.join(directory, "blobs");
    const digest = "def3735d7a0d2696775d6d72f379e4536c4d9e3cd6367f27a0bcb7f40d4558fb";
    const bucket = path.join(blobDirectory, digest.slice(0, 2));
    await mkdir(path.join(bucket, digest), { recursive: true });
    const store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"), { blobDirectory });

    assert.throws(() => store.putBlob(new TextEncoder().encode("shepherd")), BlobIntegrityError);
    assert.deepEqual(
        (await readdir(bucket)).filter((name) => name.startsWith(".tmp-")),
        [],
    );
    store.close();
});
