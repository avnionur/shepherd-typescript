import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import { ROOT_WITNESS_ID, SQLiteTraceStore, TraceStoreError } from "../../src/index.ts";
import { kernelProtocolConfig } from "../../src/protocol/config.ts";

test("SQLiteTraceStore verifies every retained store area after reopen", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-integrity-test-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const databasePath = path.join(directory, "trace.sqlite");
    const store = new SQLiteTraceStore(databasePath);
    const recordId =
        store.append({
            append_intent_id: "intent:integrity",
            batch: {
                groups: [
                    {
                        owner_id: "run:integrity",
                        records: [
                            {
                                body: { value: "retained" },
                                mode: "capture",
                                schema_ref: "example.integrity.v1",
                                witness_ref: ROOT_WITNESS_ID,
                            },
                        ],
                    },
                ],
            },
        }).record_ids[0] ?? "";
    store.publishCut({
        cut_id: "cut:integrity",
        target_owner_id: "run:integrity",
        through_record_id: recordId,
    });
    store.putBlob(new TextEncoder().encode("integrity"));
    store.close();

    using reopened = new SQLiteTraceStore(databasePath);
    const report = reopened.verifyIntegrity();

    assert.deepEqual(report, {
        checked_append_intent_count: 2,
        checked_blob_count: 1,
        checked_cut_count: 1,
        checked_owner_count: 1,
        checked_record_count: 3,
        checked_scope_count: 0,
        issues: [],
        ok: true,
    });
    assert.equal(Object.isFrozen(report), true);
    assert.equal(Object.isFrozen(report.issues), true);
});

test("SQLiteTraceStore classifies graph, witness, owner, and orphan corruption", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-graph-integrity-test-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const databasePath = path.join(directory, "trace.sqlite");
    const store = new SQLiteTraceStore(databasePath);
    const parentId = appendOne(store, "intent:parent", "run:parent", ROOT_WITNESS_ID);
    const childId =
        store.append({
            append_intent_id: "intent:child",
            batch: {
                groups: [
                    {
                        owner_id: "run:child",
                        records: [
                            {
                                body: { value: "child" },
                                caused_by_record_ids: [parentId],
                                mode: "capture",
                                schema_ref: "example.integrity.v1",
                                witness_ref: ROOT_WITNESS_ID,
                            },
                        ],
                    },
                ],
            },
        }).record_ids[0] ?? "";
    // Append refuses a non-witness witness_ref (F-014), so the corrupt row is written directly.
    const badWitnessId = appendOne(store, "intent:bad-witness", "run:witness", ROOT_WITNESS_ID);
    const orphanId = appendOne(store, "intent:orphan", "run:orphan", ROOT_WITNESS_ID);
    store.close();

    const database = new DatabaseSync(databasePath);
    database.exec("PRAGMA foreign_keys = OFF");
    database.exec("PRAGMA ignore_check_constraints = ON");
    database
        .prepare("UPDATE records SET witness_ref = ? WHERE record_id = ?")
        .run(parentId, badWitnessId);
    database.prepare("DELETE FROM record_parents WHERE child_record_id = ?").run(childId);
    database
        .prepare(
            `INSERT INTO record_parents
                (child_record_id, parent_record_id, parent_position)
             VALUES (?, ?, ?)`,
        )
        .run("sha256:missing-child", ROOT_WITNESS_ID, 0);
    database
        .prepare("UPDATE owner_ordinals SET next_ordinal = ? WHERE owner_id = ?")
        .run(-1, "run:parent");
    database.prepare("DELETE FROM record_views WHERE record_id = ?").run(orphanId);
    database.close();

    using reopened = new SQLiteTraceStore(databasePath);
    const report = reopened.verifyIntegrity();
    const issues = new Map(report.issues.map((issue) => [issue.subject_id, issue.kind] as const));

    assert.equal(report.ok, false);
    assert.equal(issues.get("store"), "sqlite_integrity_mismatch");
    assert.equal(issues.get("foreign_keys"), "sqlite_integrity_mismatch");
    assert.equal(issues.get(childId), "parent_index_mismatch");
    assert.equal(
        report.issues.some(
            ({ kind, subject_id }) => kind === "witness_mismatch" && subject_id === badWitnessId,
        ),
        true,
    );
    assert.equal(issues.get(orphanId), "orphan_record");
    assert.equal(issues.get("intent:orphan"), "append_receipt_mismatch");
    assert.equal(issues.get("run:parent"), "owner_ordinal_mismatch");
});

test("append refuses a witness_ref that names a record that is not a witness", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-witness-append-test-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    const plainId = appendOne(store, "intent:plain", "run:plain", ROOT_WITNESS_ID);
    const witnessId =
        store.append({
            append_intent_id: "intent:witness",
            batch: {
                groups: [
                    {
                        owner_id: "run:witness",
                        records: [
                            {
                                body: { value: "witness" },
                                mode: "capture",
                                schema_ref: kernelProtocolConfig.queries.witnessSchemaRef,
                                witness_ref: ROOT_WITNESS_ID,
                            },
                        ],
                    },
                ],
            },
        }).record_ids[0] ?? "";
    appendOne(store, "intent:witnessed", "run:witnessed", witnessId);

    assert.throws(
        () => appendOne(store, "intent:unwitnessed", "run:unwitnessed", plainId),
        (error: unknown) =>
            error instanceof TraceStoreError &&
            error.message === `witness_ref does not name a witness record: ${plainId}`,
    );
    assert.equal(store.verifyIntegrity().ok, true);
    assert.equal(store.diagnoseAppend("intent:unwitnessed").status, "retry_safe");
    appendOne(store, "intent:unwitnessed", "run:unwitnessed", ROOT_WITNESS_ID);
    assert.equal(store.verifyIntegrity().ok, true);
});

test("SQLiteTraceStore composes record, cut, and blob integrity failures", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-composed-integrity-test-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const databasePath = path.join(directory, "trace.sqlite");
    const store = new SQLiteTraceStore(databasePath);
    const recordId = appendOne(store, "intent:composed", "run:composed", ROOT_WITNESS_ID);
    const cut = store.publishCut({
        cut_id: "cut:composed",
        target_owner_id: "run:composed",
        through_record_id: recordId,
    });
    const blob = store.putBlob(new TextEncoder().encode("integrity"));
    store.close();

    const database = new DatabaseSync(databasePath);
    database
        .prepare("UPDATE records SET body_json = ? WHERE record_id = ?")
        .run('{"value":"changed"}', recordId);
    database
        .prepare("UPDATE trace_cuts SET through_owner_ordinal = ? WHERE cut_id = ?")
        .run(1, cut.cut_id);
    const storageKey = String(
        database
            .prepare("SELECT storage_key FROM storage_receipts WHERE blob_id = ?")
            .get(blob.blob_id)?.storage_key,
    );
    database.close();
    await writeFile(path.join(`${databasePath}.blobs`, storageKey), new Uint8Array(9));

    using reopened = new SQLiteTraceStore(databasePath);
    const issues = new Map(
        reopened.verifyIntegrity().issues.map((issue) => [issue.subject_id, issue.kind] as const),
    );

    assert.equal(issues.get(recordId), "record_mismatch");
    assert.equal(issues.get(cut.cut_id), "cut_mismatch");
    assert.equal(issues.get(blob.blob_id), "blob_digest_mismatch");
});

test("SQLiteTraceStore classifies malformed parent metadata and root witness state", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-metadata-integrity-test-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const databasePath = path.join(directory, "trace.sqlite");
    using store = new SQLiteTraceStore(databasePath);
    const objectCauseId = appendOne(store, "intent:object-cause", "run:object", ROOT_WITNESS_ID);
    const invalidCauseId = appendOne(store, "intent:invalid-cause", "run:invalid", ROOT_WITNESS_ID);

    const database = new DatabaseSync(databasePath);
    database
        .prepare("UPDATE records SET caused_by_json = ? WHERE record_id = ?")
        .run("{}", objectCauseId);
    database
        .prepare("UPDATE records SET caused_by_json = ? WHERE record_id = ?")
        .run("invalid-json", invalidCauseId);
    database
        .prepare("UPDATE records SET schema_ref = ? WHERE record_id = ?")
        .run("corrupt.root-witness.v1", ROOT_WITNESS_ID);
    database.prepare("DELETE FROM owner_ordinals WHERE owner_id = ?").run("run:object");
    database.close();

    const report = store.verifyIntegrity();
    const hasIssue = (subjectId: string, kind: string): boolean =>
        report.issues.some((issue) => issue.subject_id === subjectId && issue.kind === kind);

    assert.equal(hasIssue(objectCauseId, "parent_index_mismatch"), true);
    assert.equal(hasIssue(invalidCauseId, "parent_index_mismatch"), true);
    assert.equal(hasIssue(ROOT_WITNESS_ID, "witness_mismatch"), true);
    assert.equal(hasIssue("run:object", "owner_ordinal_mismatch"), true);
});

test("SQLiteTraceStore rejects a missing configured root witness", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-root-integrity-test-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const databasePath = path.join(directory, "trace.sqlite");
    using store = new SQLiteTraceStore(databasePath);

    const database = new DatabaseSync(databasePath);
    database.exec("PRAGMA foreign_keys = OFF");
    database.prepare("DELETE FROM records WHERE record_id = ?").run(ROOT_WITNESS_ID);
    database.close();

    assert.deepEqual(store.verifyIntegrity().issues, [
        { kind: "witness_mismatch", subject_id: ROOT_WITNESS_ID },
    ]);
});

function appendOne(
    store: SQLiteTraceStore,
    appendIntentId: string,
    ownerId: string,
    witnessRef: string,
): string {
    return (
        store.append({
            append_intent_id: appendIntentId,
            batch: {
                groups: [
                    {
                        owner_id: ownerId,
                        records: [
                            {
                                body: { value: appendIntentId },
                                mode: "capture",
                                schema_ref: "example.integrity.v1",
                                witness_ref: witnessRef,
                            },
                        ],
                    },
                ],
            },
        }).record_ids[0] ?? ""
    );
}
