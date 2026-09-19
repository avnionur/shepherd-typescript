import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
    mkdir,
    mkdtemp,
    readdir,
    readFile,
    realpath,
    rm,
    symlink,
    writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
    BlobIntegrityError,
    createFilesystemBlobStoreBackend,
    createMemoryBlobStoreBackend,
    SQLiteTraceStore,
    StorageAdapterError,
    StorageBlobContentMismatchError,
} from "../../src/index.ts";
import { storageProtocolConfig } from "../../src/protocol/config.ts";

const encoder = new TextEncoder();

function blob(text: string): { readonly blobId: string; readonly content: Uint8Array } {
    const content = encoder.encode(text);
    return { blobId: `sha256:${createHash("sha256").update(content).digest("hex")}`, content };
}

async function temporaryRoot(context: { after(fn: () => Promise<void>): void }): Promise<string> {
    const directory = await realpath(await mkdtemp(path.join(tmpdir(), "shepherd-blob-backend-")));
    context.after(() => rm(directory, { force: true, recursive: true }));
    return directory;
}

test("filesystem backend shares the trace-store blob layout without changing it", async (context) => {
    const root = await temporaryRoot(context);
    const blobDirectory = path.join(root, "trace.blobs");
    using store = new SQLiteTraceStore(path.join(root, "trace.sqlite"), { blobDirectory });
    const stored = store.putBlob(encoder.encode("stored by the trace store"));
    const backend = createFilesystemBlobStoreBackend(blobDirectory);

    assert.equal(await backend.has(stored.blob_id), true);
    assert.deepEqual(
        await backend.get(stored.blob_id),
        encoder.encode("stored by the trace store"),
    );
    assert.deepEqual((await backend.list()).blobIds, [stored.blob_id]);

    const added = blob("stored by the backend");
    assert.equal((await backend.put(added.blobId, added.content)).created, true);
    const digest = added.blobId.slice("sha256:".length);
    const filePath = path.join(blobDirectory, digest.slice(0, 2), digest);
    assert.deepEqual(new Uint8Array(await readFile(filePath)), added.content);
    assert.deepEqual(store.readBlob(stored.blob_id), encoder.encode("stored by the trace store"));
});

test("filesystem backend refuses mismatched bytes before writing and keeps corrupt objects", async (context) => {
    const root = await temporaryRoot(context);
    const backend = createFilesystemBlobStoreBackend(path.join(root, "blobs"));
    const expected = blob("expected");
    const other = blob("other");

    await assert.rejects(backend.put(expected.blobId, other.content), (error: unknown) => {
        assert.ok(error instanceof StorageBlobContentMismatchError);
        assert.ok(error instanceof StorageAdapterError);
        assert.equal(error.code, "STORAGE_BLOB_CONTENT_MISMATCH");
        return true;
    });
    assert.deepEqual(await readdir(path.join(root, "blobs")), []);
    await assert.rejects(backend.put(expected.blobId, "bytes" as never), TypeError);

    await backend.put(expected.blobId, expected.content);
    const digest = expected.blobId.slice("sha256:".length);
    const filePath = path.join(root, "blobs", digest.slice(0, 2), digest);
    await writeFile(filePath, "corrupt");
    await assert.rejects(backend.get(expected.blobId), BlobIntegrityError);
    await assert.rejects(backend.put(expected.blobId, expected.content), BlobIntegrityError);
    assert.equal(await readFile(filePath, "utf8"), "corrupt");
});

test("filesystem backend lists across fan-out buckets and ignores foreign entries", async (context) => {
    const root = await temporaryRoot(context);
    const directory = path.join(root, "blobs");
    const backend = createFilesystemBlobStoreBackend(directory);
    const samples = Array.from({ length: 12 }, (_, index) => blob(`listed ${index}`));
    for (const { blobId, content } of samples) {
        await backend.put(blobId, content);
    }
    const expected = samples.map(({ blobId }) => blobId).sort();
    const [first] = expected as [string];
    const firstDigest = first.slice("sha256:".length);
    await writeFile(path.join(directory, firstDigest.slice(0, 2), ".tmp-abandoned"), "partial");
    await writeFile(path.join(directory, firstDigest.slice(0, 2), "not-a-digest"), "foreign");
    await writeFile(path.join(directory, "zz"), "foreign root file");
    const unusedBucket = ["00", "01"].find(
        (bucket) => !expected.some((id) => id.startsWith(`sha256:${bucket}`)),
    );
    assert.ok(unusedBucket !== undefined);
    await writeFile(path.join(directory, unusedBucket), "not a directory");
    await mkdir(path.join(directory, "ff-foreign"));
    const misplaced = blob("misplaced");
    const misplacedDigest = misplaced.blobId.slice("sha256:".length);
    const wrongBucket = misplacedDigest.startsWith("ab") ? "cd" : "ab";
    await mkdir(path.join(directory, wrongBucket), { recursive: true });
    await writeFile(path.join(directory, wrongBucket, misplacedDigest), misplaced.content);

    assert.deepEqual((await backend.list()).blobIds, expected);
    const collected: string[] = [];
    let after: string | undefined;
    do {
        const page = await backend.list(after === undefined ? { limit: 5 } : { after, limit: 5 });
        collected.push(...page.blobIds);
        after = page.next;
    } while (after !== undefined);
    assert.deepEqual(collected, expected);
    assert.deepEqual(
        (await backend.list({ after: expected[5] as string, limit: 3 })).blobIds,
        expected.slice(6, 9),
    );
});

test("filesystem backend deletes durably and refuses a symlinked root", async (context) => {
    const root = await temporaryRoot(context);
    const backend = createFilesystemBlobStoreBackend(path.join(root, "blobs"));
    const { blobId, content } = blob("deleted");
    await backend.put(blobId, content);
    assert.equal(await backend.delete(blobId), true);
    assert.equal(await backend.has(blobId), false);
    assert.equal(await backend.get(blobId), undefined);
    assert.equal(await backend.delete(blobId), false);

    await symlink(path.join(root, "blobs"), path.join(root, "linked"), "dir");
    assert.throws(
        () => createFilesystemBlobStoreBackend(path.join(root, "linked", "nested")),
        TypeError,
    );
});

test("memory backend applies the configured default page size and validates list options", async () => {
    const backend = createMemoryBlobStoreBackend();
    const { defaultListLimit, maxListLimit } = storageProtocolConfig.blobs;
    for (let index = 0; index <= defaultListLimit; index += 1) {
        const { blobId, content } = blob(`page ${index}`);
        await backend.put(blobId, content);
    }
    const page = await backend.list();
    assert.equal(page.blobIds.length, defaultListLimit);
    assert.equal(page.next, page.blobIds.at(-1));
    assert.equal((await backend.list({ limit: maxListLimit })).next, undefined);
    assert.equal(Object.isFrozen(page.blobIds), true);
    await assert.rejects(backend.list(null as never), TypeError);
    await assert.rejects(backend.list({ limit: maxListLimit + 1 }), TypeError);
});
