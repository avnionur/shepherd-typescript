import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import { ROOT_WITNESS_ID, SQLiteTraceStore } from "../../src/index.ts";

test("SQLiteTraceStore diagnoses retryable, committed, and corrupt append intents", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-append-recovery-test-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const databasePath = path.join(directory, "trace.sqlite");
    const store = new SQLiteTraceStore(databasePath);

    assert.throws(() => store.diagnoseAppend(""), TypeError);

    assert.deepEqual(store.diagnoseAppend("intent:missing"), {
        append_intent_id: "intent:missing",
        issue: null,
        status: "retry_safe",
    });
    store.append({
        append_intent_id: "intent:committed",
        batch: {
            groups: [
                {
                    owner_id: "run:recovery",
                    records: [
                        {
                            body: { value: "retained" },
                            mode: "capture",
                            schema_ref: "example.recovery.v1",
                            witness_ref: ROOT_WITNESS_ID,
                        },
                    ],
                },
            ],
        },
    });
    assert.deepEqual(store.diagnoseAppend("intent:committed"), {
        append_intent_id: "intent:committed",
        issue: null,
        status: "committed",
    });
    store.close();

    const database = new DatabaseSync(databasePath);
    database
        .prepare("UPDATE append_intents SET receipt_json = ? WHERE append_intent_id = ?")
        .run("{}", "intent:committed");
    database.close();

    using reopened = new SQLiteTraceStore(databasePath);
    assert.deepEqual(reopened.diagnoseAppend("intent:committed"), {
        append_intent_id: "intent:committed",
        issue: "receipt_mismatch",
        status: "manual_recovery_required",
    });
});

test("SQLiteTraceStore diagnoses rows orphaned from their append intent", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-orphan-recovery-test-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const databasePath = path.join(directory, "trace.sqlite");
    const store = new SQLiteTraceStore(databasePath);
    store.append({
        append_intent_id: "intent:orphaned",
        batch: {
            groups: [
                {
                    owner_id: "run:orphaned",
                    records: [
                        {
                            body: { value: "orphaned" },
                            mode: "capture",
                            schema_ref: "example.recovery.v1",
                            witness_ref: ROOT_WITNESS_ID,
                        },
                    ],
                },
            ],
        },
    });
    store.close();

    const database = new DatabaseSync(databasePath);
    database.exec("PRAGMA foreign_keys = OFF");
    database
        .prepare("DELETE FROM append_intents WHERE append_intent_id = ?")
        .run("intent:orphaned");
    database.close();

    using reopened = new SQLiteTraceStore(databasePath);
    assert.deepEqual(reopened.diagnoseAppend("intent:orphaned"), {
        append_intent_id: "intent:orphaned",
        issue: "orphaned_rows",
        status: "manual_recovery_required",
    });
    assert.deepEqual(reopened.verifyIntegrity().issues, [
        { kind: "sqlite_integrity_mismatch", subject_id: "foreign_keys" },
        { kind: "append_receipt_mismatch", subject_id: "intent:orphaned" },
    ]);
});

test("SQLiteTraceStore diagnoses a cut orphaned from its append intent", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-cut-recovery-test-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const databasePath = path.join(directory, "trace.sqlite");
    const store = new SQLiteTraceStore(databasePath);
    const throughRecordId =
        store.append({
            append_intent_id: "intent:cut-target",
            batch: {
                groups: [
                    {
                        owner_id: "run:cut-recovery",
                        records: [
                            {
                                body: { value: "target" },
                                mode: "capture",
                                schema_ref: "example.recovery.v1",
                                witness_ref: ROOT_WITNESS_ID,
                            },
                        ],
                    },
                ],
            },
        }).record_ids[0] ?? "";
    store.publishCut({
        append_intent_id: "intent:cut-publication",
        cut_id: "cut:orphaned-intent",
        target_owner_id: "run:cut-recovery",
        through_record_id: throughRecordId,
    });
    store.close();

    const database = new DatabaseSync(databasePath);
    database.exec("PRAGMA foreign_keys = OFF");
    database
        .prepare("DELETE FROM record_views WHERE append_intent_id = ?")
        .run("intent:cut-publication");
    database
        .prepare("DELETE FROM append_intents WHERE append_intent_id = ?")
        .run("intent:cut-publication");
    database.close();

    using reopened = new SQLiteTraceStore(databasePath);
    assert.deepEqual(reopened.diagnoseAppend("intent:cut-publication"), {
        append_intent_id: "intent:cut-publication",
        issue: "orphaned_rows",
        status: "manual_recovery_required",
    });
    assert.equal(
        reopened
            .verifyIntegrity()
            .issues.some(
                (issue) =>
                    issue.kind === "append_receipt_mismatch" &&
                    issue.subject_id === "intent:cut-publication",
            ),
        true,
    );
});

test("SQLiteTraceStore rejects a receipt whose owner view lost its record", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-view-recovery-test-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const databasePath = path.join(directory, "trace.sqlite");
    const store = new SQLiteTraceStore(databasePath);
    store.append({ append_intent_id: "intent:dangling-view", batch: { groups: [] } });

    const database = new DatabaseSync(databasePath);
    database.exec("PRAGMA foreign_keys = OFF");
    database
        .prepare(
            `INSERT INTO record_views
                (owner_id, owner_ordinal, record_id, append_intent_id, append_position)
             VALUES (?, ?, ?, ?, ?)`,
        )
        .run("run:dangling", 0, "sha256:missing-record", "intent:dangling-view", 0);
    database.close();

    assert.deepEqual(store.diagnoseAppend("intent:dangling-view"), {
        append_intent_id: "intent:dangling-view",
        issue: "receipt_mismatch",
        status: "manual_recovery_required",
    });
    store.close();
});

test("SQLiteTraceStore propagates operational failures during append diagnosis", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-recovery-failure-test-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const databasePath = path.join(directory, "trace.sqlite");
    using store = new SQLiteTraceStore(databasePath);
    store.append({
        append_intent_id: "intent:operational-failure",
        batch: { groups: [] },
    });

    const database = new DatabaseSync(databasePath);
    database.exec("DROP TABLE record_views");
    database.close();

    assert.throws(
        () => store.diagnoseAppend("intent:operational-failure"),
        /no such table: record_views/,
    );
    assert.throws(() => store.verifyIntegrity(), /no such table: record_views/);
    assert.equal(store.schemaVersion > 0, true);
});
