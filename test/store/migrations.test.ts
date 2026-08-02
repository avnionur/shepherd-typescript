import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import { SQLiteTraceStore, TraceStoreError, UnsupportedStoreSchemaError } from "../../src/index.ts";

test("SQLiteTraceStore migrates file databases in WAL mode", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-migration-test-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const databasePath = path.join(directory, "trace.sqlite");
    const store = new SQLiteTraceStore(databasePath);
    assert.equal(store.schemaVersion, 3);
    store.close();

    const database = new DatabaseSync(databasePath);
    assert.equal(database.prepare("PRAGMA journal_mode").get()?.journal_mode, "wal");
    assert.equal(
        database.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()?.version,
        3,
    );
    database.close();
});

test("SQLiteTraceStore upgrades a version-one database for blob receipts", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-v1-migration-test-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const databasePath = path.join(directory, "trace.sqlite");
    new SQLiteTraceStore(databasePath).close();
    const database = new DatabaseSync(databasePath);
    database.exec(`
        DROP TABLE trace_cuts;
        DROP TABLE storage_receipts;
        DROP TABLE blobs;
        DELETE FROM schema_migrations WHERE version >= 2;
    `);
    database.close();

    const upgraded = new SQLiteTraceStore(databasePath);
    assert.equal(upgraded.schemaVersion, 3);
    assert.equal(upgraded.putBlob(new Uint8Array([1])).byte_length, 1);
    upgraded.close();
});

test("SQLiteTraceStore rejects unsupported future schemas", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-future-schema-test-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const databasePath = path.join(directory, "trace.sqlite");
    new SQLiteTraceStore(databasePath).close();
    const database = new DatabaseSync(databasePath);
    database.prepare("INSERT INTO schema_migrations(version) VALUES (?)").run(4);
    database.close();

    assert.throws(() => new SQLiteTraceStore(databasePath), UnsupportedStoreSchemaError);
});

test("failed schema migration rolls back its version", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-failed-migration-test-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const databasePath = path.join(directory, "trace.sqlite");
    const database = new DatabaseSync(databasePath);
    database.exec(`
        CREATE TABLE records (record_id TEXT PRIMARY KEY) STRICT;
    `);
    database.close();

    assert.throws(() => new SQLiteTraceStore(databasePath), /table records already exists/);

    const inspected = new DatabaseSync(databasePath);
    assert.equal(
        inspected.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()?.version,
        null,
    );
    inspected.close();
});

test("SQLiteTraceStore close is idempotent and guards every operation", () => {
    const store = new SQLiteTraceStore();
    store.close();
    store.close();

    assert.throws(() => store.readOwner("run:alpha"), TraceStoreError);
    assert.throws(() => store.readRecord(`sha256:${"1".repeat(64)}`), TraceStoreError);
    assert.throws(
        () => store.append({ append_intent_id: "intent:closed", batch: { groups: [] } }),
        TraceStoreError,
    );
    assert.throws(() => store.putBlob(new Uint8Array()), TraceStoreError);
    assert.throws(() => store.readBlob(`sha256:${"1".repeat(64)}`), TraceStoreError);
    assert.throws(() => store.verifyBlobs(), TraceStoreError);
    assert.throws(() => store.diagnoseAppend("intent:closed"), TraceStoreError);
    assert.throws(() => store.verifyIntegrity(), TraceStoreError);
    assert.throws(() => store.readCut("cut:closed"), TraceStoreError);
    assert.throws(() => store.readOwnerPrefix("run:alpha", 0), TraceStoreError);
    assert.throws(() => store.resolveCut("cut:closed"), TraceStoreError);
    assert.throws(() => store.projectExecution("cut:closed"), TraceStoreError);
    assert.throws(() => store.projectEffectiveHistory("cut:closed"), TraceStoreError);
    assert.throws(() => store.readCausalClosure([]), TraceStoreError);
    assert.throws(
        () =>
            store.publishCut({
                cut_id: "cut:closed",
                target_owner_id: "run:alpha",
                through_record_id: `sha256:${"1".repeat(64)}`,
            }),
        TraceStoreError,
    );

    const disposable = new SQLiteTraceStore();
    disposable[Symbol.dispose]();
    assert.throws(() => disposable.readOwner("run:alpha"), TraceStoreError);
});
