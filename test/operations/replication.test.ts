import assert from "node:assert/strict";
import { readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";

import {
    type BlobStoreBackend,
    backupTraceStore,
    createMemoryBlobStoreBackend,
    createMemoryStorageCoordinator,
    fetchReplicatedTraceStoreBackup,
    replicateTraceStoreBackup,
    restoreTraceStoreBackup,
    SQLiteTraceStore,
    TraceStoreBackupError,
    type TraceStoreBackupFailureReason,
} from "../../src/index.ts";
import { populateStoreForSchema } from "../../tooling/testing/store-schema-fixtures.ts";

async function scratch(context: TestContext): Promise<string> {
    const directory = realpathSync(await mkdtemp(path.join(tmpdir(), "shepherd-replica-")));
    context.after(() => rm(directory, { force: true, recursive: true }));
    return directory;
}

async function rejectsWith(
    operation: Promise<unknown>,
    reason: TraceStoreBackupFailureReason,
): Promise<void> {
    await assert.rejects(operation, (error: unknown) => {
        assert.ok(error instanceof TraceStoreBackupError, String(error));
        assert.equal(error.reason, reason, error.message);
        return true;
    });
}

test("a verified backup replicates by compare-and-swap and fetches back to a restorable copy", async (context) => {
    const directory = await scratch(context);
    using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    populateStoreForSchema(store, store.schemaVersion);
    const backup = path.join(directory, "backup");
    const manifest = await backupTraceStore(store, { destination: backup });
    const backend = createMemoryBlobStoreBackend();
    const coordinator = createMemoryStorageCoordinator();

    const replica = await replicateTraceStoreBackup(backup, {
        backend,
        coordinator,
        expectedGeneration: 0,
        refName: "backups/trace/latest",
    });
    assert.equal(replica.manifest_id, manifest.manifest_id);
    assert.equal(replica.swap.status, "swapped");
    assert.equal(await backend.has(replica.database_blob_id), true);
    assert.equal(await backend.has(replica.manifest_blob_id), true);
    assert.equal((await backend.list()).blobIds.length, 3);

    const again = await replicateTraceStoreBackup(backup, {
        backend,
        coordinator,
        expectedGeneration: 0,
        refName: "backups/trace/latest",
    });
    assert.equal(again.swap.status, "conflict");
    const fenced = await replicateTraceStoreBackup(backup, {
        backend,
        coordinator,
        expectedGeneration: 1,
        fence: { fencingToken: 1, key: "backups/lease", now: 0, owner: "operator" },
        refName: "backups/trace/latest",
    });
    assert.equal(fenced.swap.status, "fenced");

    const fetched = path.join(directory, "fetched");
    const verification = await fetchReplicatedTraceStoreBackup({
        backend,
        coordinator,
        destination: fetched,
        refName: "backups/trace/latest",
    });
    assert.deepEqual(verification.manifest, manifest);
    assert.deepEqual(readdirSync(fetched).sort(), ["blobs", "manifest.json", "trace.sqlite"]);
    const target = path.join(directory, "restored.sqlite");
    await restoreTraceStoreBackup(fetched, target, { expectedManifestId: manifest.manifest_id });
    using restored = new SQLiteTraceStore(target, { readOnly: true });
    assert.equal(restored.exportTrace(), store.exportTrace());

    await rejectsWith(
        fetchReplicatedTraceStoreBackup({
            backend,
            coordinator,
            destination: fetched,
            refName: "backups/trace/latest",
        }),
        "destination-exists",
    );
    await rejectsWith(
        fetchReplicatedTraceStoreBackup({
            backend,
            coordinator,
            destination: path.join(directory, "none"),
            refName: "backups/trace/absent",
        }),
        "manifest-missing",
    );
    const empty = createMemoryBlobStoreBackend();
    await rejectsWith(
        fetchReplicatedTraceStoreBackup({
            backend: empty,
            coordinator,
            destination: path.join(directory, "none"),
            refName: "backups/trace/latest",
        }),
        "manifest-missing",
    );
    const substituted: BlobStoreBackend = {
        ...backend,
        get: async (blobId) =>
            blobId === replica.manifest_blob_id
                ? backend.get(replica.database_blob_id)
                : backend.get(blobId),
    };
    await rejectsWith(
        fetchReplicatedTraceStoreBackup({
            backend: substituted,
            coordinator,
            destination: path.join(directory, "none"),
            refName: "backups/trace/latest",
        }),
        "manifest-invalid",
    );
    await backend.delete(replica.database_blob_id);
    await rejectsWith(
        fetchReplicatedTraceStoreBackup({
            backend,
            coordinator,
            destination: path.join(directory, "none"),
            refName: "backups/trace/latest",
        }),
        "database-mismatch",
    );
    assert.equal(readdirSync(directory).includes("none"), false);
});

test("backups whose blobs live in a backend replicate from that backend", async (context) => {
    const directory = await scratch(context);
    using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    populateStoreForSchema(store, store.schemaVersion);
    const source = createMemoryBlobStoreBackend();
    const backup = path.join(directory, "backup");
    await backupTraceStore(store, { blobBackend: source, destination: backup });
    const backend = createMemoryBlobStoreBackend();
    const replica = await replicateTraceStoreBackup(backup, {
        backend,
        coordinator: createMemoryStorageCoordinator(),
        expectedGeneration: 0,
        refName: "backups/backend",
        sourceBlobBackend: source,
    });
    assert.equal(replica.swap.status, "swapped");
    await rejectsWith(
        replicateTraceStoreBackup(backup, {
            backend,
            coordinator: createMemoryStorageCoordinator(),
            expectedGeneration: 0,
            refName: "backups/backend",
        }),
        "blob-mismatch",
    );
});

test("replication refuses database or manifest files that change after verification", async (context) => {
    const directory = await scratch(context);
    using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    populateStoreForSchema(store, store.schemaVersion);
    using other = new SQLiteTraceStore(path.join(directory, "other.sqlite"));
    const otherBackup = path.join(directory, "other-backup");
    await backupTraceStore(other, { destination: otherBackup });
    const otherManifest = readFileSync(path.join(otherBackup, "manifest.json"));
    const source = createMemoryBlobStoreBackend();
    for (const [file, reason] of [
        ["trace.sqlite", "database-mismatch"],
        ["manifest.json", "manifest-mismatch"],
    ] as const) {
        const backup = path.join(directory, `backup-${reason}`);
        await backupTraceStore(store, { blobBackend: source, destination: backup });
        const original = readFileSync(path.join(backup, file));
        // Blobs are read after the verified database copy is staged, so this swaps the file
        // between verification and the replication read.
        const racing: BlobStoreBackend = {
            ...source,
            get: async (blobId) => {
                writeFileSync(
                    path.join(backup, file),
                    file === "trace.sqlite"
                        ? Buffer.concat([original, Buffer.from([0])])
                        : otherManifest,
                );
                return source.get(blobId);
            },
        };
        const backend = createMemoryBlobStoreBackend();
        await rejectsWith(
            replicateTraceStoreBackup(backup, {
                backend,
                coordinator: createMemoryStorageCoordinator(),
                expectedGeneration: 0,
                refName: "backups/racing",
                sourceBlobBackend: racing,
            }),
            reason,
        );
        assert.equal((await backend.list()).blobIds.length, 0);
    }
});

test("replication and fetch validate their options", async () => {
    const coordinator = createMemoryStorageCoordinator();
    await assert.rejects(replicateTraceStoreBackup("backup", null as never), TypeError);
    await assert.rejects(
        replicateTraceStoreBackup("backup", {
            backend: undefined as never,
            coordinator,
            expectedGeneration: 0,
            refName: "ref",
        }),
        TypeError,
    );
    await assert.rejects(fetchReplicatedTraceStoreBackup(null as never), TypeError);
    await assert.rejects(
        fetchReplicatedTraceStoreBackup({
            backend: createMemoryBlobStoreBackend(),
            coordinator,
            destination: "",
            refName: "ref",
        }),
        TypeError,
    );
});
