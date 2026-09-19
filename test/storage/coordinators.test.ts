import assert from "node:assert/strict";
import { mkdtemp, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import {
    createMemoryStorageCoordinator,
    createSQLiteStorageCoordinator,
    StorageAdapterError,
} from "../../src/index.ts";
import { storageProtocolConfig } from "../../src/protocol/config.ts";
import { assertStorageCoordinatorMigrations } from "../../src/storage/sqlite-coordinator.ts";

const ttl = storageProtocolConfig.leases.minTtlMilliseconds;

async function temporaryRoot(context: { after(fn: () => Promise<void>): void }): Promise<string> {
    const directory = await realpath(await mkdtemp(path.join(tmpdir(), "shepherd-coordinator-")));
    context.after(() => rm(directory, { force: true, recursive: true }));
    return directory;
}

test("SQLite coordinator persists refs and leases across handles with an owner-only file", async (context) => {
    const databasePath = path.join(await temporaryRoot(context), "coordinator.sqlite");
    {
        using first = createSQLiteStorageCoordinator(databasePath);
        using second = createSQLiteStorageCoordinator(databasePath);
        assert.equal((await first.compareAndSwapRef("heads/main", 0, "a")).status, "swapped");
        const swapped = await second.compareAndSwapRef("heads/main", 1, "b");
        assert.equal(swapped.status, "swapped");
        const acquired = await first.acquireLease("jobs/nightly", "worker-a", ttl, 10);
        assert.equal(acquired.status, "acquired");
        assert.equal(
            (await second.acquireLease("jobs/nightly", "worker-b", ttl, 10)).status,
            "held",
        );
        assert.equal((await second.releaseLease("jobs/nightly", "worker-a", 1)).status, "released");
    }
    using reopened = createSQLiteStorageCoordinator(databasePath);
    assert.deepEqual(await reopened.readRef("heads/main"), {
        generation: 2,
        name: "heads/main",
        value: "b",
    });
    assert.deepEqual(await reopened.readLease("jobs/nightly"), {
        expiresAt: 0,
        fencingToken: 1,
        key: "jobs/nightly",
        owner: "worker-a",
    });
    assert.equal(await reopened.readLease("jobs/absent"), undefined);
    if (process.platform !== "win32") {
        assert.equal((await stat(databasePath)).mode & 0o077, 0);
    }
});

test("SQLite coordinator rejects operations after close and closes idempotently", async () => {
    const coordinator = createSQLiteStorageCoordinator(":memory:");
    coordinator.close();
    coordinator[Symbol.dispose]();
    for (const operation of [
        () => coordinator.readRef("heads/main"),
        () => coordinator.compareAndSwapRef("heads/main", 0, "a"),
        () => coordinator.readLease("jobs/nightly"),
        () => coordinator.acquireLease("jobs/nightly", "worker", ttl, 0),
        () => coordinator.renewLease("jobs/nightly", "worker", 1, ttl, 0),
        () => coordinator.releaseLease("jobs/nightly", "worker", 1),
    ]) {
        await assert.rejects(operation(), (error: unknown) => {
            assert.ok(error instanceof StorageAdapterError);
            assert.equal(error.code, "STORAGE_ADAPTER_ERROR");
            return true;
        });
    }
});

test("SQLite coordinator refuses newer and conflicting schemas and invalid paths", async (context) => {
    const root = await temporaryRoot(context);
    const newer = path.join(root, "newer.sqlite");
    createSQLiteStorageCoordinator(newer).close();
    const database = new DatabaseSync(newer);
    database.exec("INSERT INTO storage_schema_migrations(version) VALUES (99)");
    database.close();
    assert.throws(() => createSQLiteStorageCoordinator(newer), StorageAdapterError);

    const conflicting = path.join(root, "conflicting.sqlite");
    const foreign = new DatabaseSync(conflicting);
    foreign.exec("CREATE TABLE storage_refs(foreign_column TEXT)");
    foreign.close();
    assert.throws(() => createSQLiteStorageCoordinator(conflicting), /already exists/u);
    const unchanged = new DatabaseSync(conflicting);
    const row = unchanged
        .prepare(
            "SELECT COUNT(*) AS count FROM sqlite_master WHERE name = 'storage_schema_migrations'",
        )
        .get() as { readonly count: number };
    assert.equal(row.count, 0, "a failed migration leaves no coordinator schema behind");
    unchanged.close();

    assert.throws(() => createSQLiteStorageCoordinator(""), TypeError);
    assert.throws(() => createSQLiteStorageCoordinator(1 as never), TypeError);
    assert.throws(() => assertStorageCoordinatorMigrations([1], [1, 2]), StorageAdapterError);
    assert.throws(() => assertStorageCoordinatorMigrations([2], [1]), StorageAdapterError);
    assert.doesNotThrow(() => assertStorageCoordinatorMigrations([1], [1]));
});

test("coordinators validate fences and lease expiry bounds", async () => {
    const coordinator = createMemoryStorageCoordinator();
    await assert.rejects(
        coordinator.compareAndSwapRef("heads/main", 0, "a", null as never),
        TypeError,
    );
    await assert.rejects(
        coordinator.compareAndSwapRef("heads/main", 0, "a", "fence" as never),
        TypeError,
    );
    await assert.rejects(
        coordinator.compareAndSwapRef("heads/main", 0, "a", {
            fencingToken: 1,
            key: "jobs/nightly",
            now: -1,
            owner: "worker",
        }),
        TypeError,
    );
    await assert.rejects(
        coordinator.acquireLease("jobs/nightly", "worker", ttl, Number.MAX_SAFE_INTEGER),
        /safe integer/u,
    );
    await assert.rejects(coordinator.acquireLease("jobs/nightly", "worker", 1.5, 0), TypeError);
    await assert.rejects(coordinator.acquireLease("jobs/nightly", 7 as never, ttl, 0), TypeError);
    await assert.rejects(coordinator.acquireLease("/leading-slash", "worker", ttl, 0), TypeError);
    await assert.rejects(coordinator.compareAndSwapRef("heads/main", 0, 7 as never), TypeError);
    assert.equal(Object.isFrozen(coordinator), true);
});
