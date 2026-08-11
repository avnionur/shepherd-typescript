import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import {
    ROOT_WITNESS_ID,
    SQLiteTraceStore,
    TraceStoreError,
    UnsupportedStoreSchemaError,
} from "../../src/index.ts";

test("SQLiteTraceStore migrates file databases in WAL mode", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-migration-test-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const databasePath = path.join(directory, "trace.sqlite");
    const store = new SQLiteTraceStore(databasePath);
    assert.equal(store.schemaVersion, 5);
    store.close();

    const database = new DatabaseSync(databasePath);
    assert.equal(database.prepare("PRAGMA journal_mode").get()?.journal_mode, "wal");
    assert.equal(
        database.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()?.version,
        5,
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
        DROP TABLE durable_execution_claims;
        DROP TABLE storage_receipts;
        DROP TABLE blobs;
        DELETE FROM schema_migrations WHERE version >= 2;
    `);
    database.close();

    const upgraded = new SQLiteTraceStore(databasePath);
    assert.equal(upgraded.schemaVersion, 5);
    assert.equal(upgraded.putBlob(new Uint8Array([1])).byte_length, 1);
    upgraded.close();
});

test("schema-five migration conservatively fences legacy invocation claims", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-v4-claim-migration-test-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const databasePath = path.join(directory, "trace.sqlite");
    const initial = new SQLiteTraceStore(databasePath);
    const runId = "run:legacy-claim";
    const created = initial.append({
        append_intent_id: "legacy-claim:creation",
        batch: {
            groups: [
                {
                    owner_id: runId,
                    records: [
                        {
                            body: { value: "created" },
                            mode: "declaration",
                            schema_ref: "shepherd2.execution.created.v1",
                            witness_ref: ROOT_WITNESS_ID,
                        },
                    ],
                },
            ],
        },
    });
    initial.close();
    const createdRecordId = created.record_ids[0];
    assert.ok(createdRecordId);

    const database = new DatabaseSync(databasePath);
    database.exec(`
        DROP TABLE durable_execution_claims;
        CREATE TABLE durable_execution_claims (
            run_id TEXT PRIMARY KEY CHECK (run_id <> ''),
            claim_id TEXT NOT NULL CHECK (claim_id <> ''),
            created_record_id TEXT NOT NULL,
            FOREIGN KEY (created_record_id) REFERENCES records(record_id)
        ) STRICT;
        DELETE FROM schema_migrations WHERE version = 5;
    `);
    database
        .prepare(
            "INSERT INTO durable_execution_claims(run_id, claim_id, created_record_id) VALUES (?, ?, ?)",
        )
        .run(runId, "claim:legacy", createdRecordId);
    database.close();

    using upgraded = new SQLiteTraceStore(databasePath);
    assert.equal(
        upgraded.claimDurableExecutionInvocation(runId, createdRecordId, "claim:replacement", 0)
            .status,
        "lost",
    );
});

test("SQLiteTraceStore rejects unsupported future schemas", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-future-schema-test-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const databasePath = path.join(directory, "trace.sqlite");
    new SQLiteTraceStore(databasePath).close();
    const database = new DatabaseSync(databasePath);
    database.prepare("INSERT INTO schema_migrations(version) VALUES (?)").run(6);
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
    assert.throws(() => store.collectBlobOrphans(), TraceStoreError);
    assert.throws(() => store.diagnoseAppend("intent:closed"), TraceStoreError);
    assert.throws(() => store.verifyIntegrity(), TraceStoreError);
    assert.throws(() => store.exportTrace(), TraceStoreError);
    assert.throws(() => store.importTrace("{}"), TraceStoreError);
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
