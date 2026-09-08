import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import { ROOT_WITNESS_ID, SQLiteTraceStore, TraceStoreError } from "../../src/index.ts";
import { kernelProtocolConfig } from "../../src/protocol/config.ts";

test("cut iteration preserves repeated occurrences and excludes later owner appends", async () => {
    using store = new SQLiteTraceStore();
    const ids = appendValues(store, "intent:first", ["first", "second", "first"]);
    assert.equal(ids[0], ids[2]);
    const cut = store.publishCut({
        cut_id: "cut:iteration",
        target_owner_id: "run:iteration",
        through_record_id: ids[2] ?? "",
    });
    appendValues(store, "intent:later", ["later"]);
    const before = store.exportTrace();
    const values: unknown[] = [];
    const ordinals: number[] = [];
    for await (const record of store.iterateCutRecords(cut.cut_id)) {
        values.push(record.body.value);
        ordinals.push(record.view.owner_ordinal);
        assert.ok(Object.isFrozen(record));
        assert.ok(Object.isFrozen(record.body));
        assert.ok(Object.isFrozen(record.view));
    }
    assert.deepEqual(values, ["first", "second", "first"]);
    assert.deepEqual(ordinals, [0, 1, 2]);
    assert.equal(store.exportTrace(), before);
});

test("cut iterators are lazy, independent, and leave the store usable after early termination", async () => {
    using store = new SQLiteTraceStore();
    const left = store.iterateCutRecords("cut:late");
    const ids = appendValues(store, "intent:first", ["first", "second"]);
    store.publishCut({
        cut_id: "cut:late",
        target_owner_id: "run:iteration",
        through_record_id: ids[1] ?? "",
    });
    const right = store.iterateCutRecords("cut:late");
    assert.equal((await left.next()).value?.body.value, "first");
    assert.equal((await right.next()).value?.body.value, "first");
    appendValues(store, "intent:during", ["later"]);
    const before = store.exportTrace();
    assert.equal((await left.next()).value?.body.value, "second");
    assert.deepEqual(await left.next(), { done: true, value: undefined });
    assert.equal((await right.next()).value?.body.value, "second");
    assert.deepEqual(await right.return(undefined), { done: true, value: undefined });
    const stopped = store.iterateCutRecords("cut:late");
    for await (const record of stopped) {
        assert.equal(record.body.value, "first");
        break;
    }
    assert.equal((await stopped.next()).done, true);
    const failure = new Error("consumer failed");
    await assert.rejects(
        async () => {
            for await (const _record of store.iterateCutRecords("cut:late")) {
                throw failure;
            }
        },
        (error) => error === failure,
    );
    assert.equal(store.exportTrace(), before);
    assert.ok(store.verifyIntegrity().ok);
});

test("cut iterator reports invalid identifiers, unknown cuts, and closed stores on pulls", async () => {
    using store = new SQLiteTraceStore();
    await assert.rejects(store.iterateCutRecords("").next(), TypeError);
    await assert.rejects(store.iterateCutRecords(null as unknown as string).next(), TypeError);
    await assert.rejects(store.iterateCutRecords("cut:unknown").next(), TraceStoreError);
    const ids = appendValues(store, "intent:first", ["first", "second"]);
    store.publishCut({
        cut_id: "cut:close",
        target_owner_id: "run:iteration",
        through_record_id: ids[1] ?? "",
    });
    const active = store.iterateCutRecords("cut:close");
    const unstarted = store.iterateCutRecords("cut:close");
    assert.equal((await active.next()).value?.body.value, "first");
    store.close();
    await assert.rejects(active.next(), TraceStoreError);
    await assert.rejects(unstarted.next(), TraceStoreError);
});

test("cut iteration reproduces read-only reopened and imported evidence without mutation", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-iteration-reopen-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const databasePath = path.join(directory, "trace.sqlite");
    const writer = new SQLiteTraceStore(databasePath);
    const ids = appendValues(writer, "intent:first", ["first", "second"]);
    writer.publishCut({
        cut_id: "cut:reopen",
        target_owner_id: "run:iteration",
        through_record_id: ids[1] ?? "",
    });
    const expected = writer.readOwner("run:iteration").slice(0, 2);
    const archive = writer.exportTrace();
    writer.close();
    using reader = new SQLiteTraceStore(databasePath, { readOnly: true });
    using imported = new SQLiteTraceStore();
    imported.importTrace(archive);
    for (const store of [reader, imported]) {
        const actual = [];
        for await (const record of store.iterateCutRecords("cut:reopen")) actual.push(record);
        assert.deepEqual(actual, expected);
        assert.equal(store.exportTrace(), archive);
    }
});

test("cut iteration reads incrementally and refuses missing, malformed, or replaced occurrences", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-iteration-corrupt-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    const ids = appendValues(store, "intent:first", ["first", "second", "third"]);
    store.publishCut({
        cut_id: "cut:corrupt",
        target_owner_id: "run:iteration",
        through_record_id: ids[2] ?? "",
    });
    const database = new DatabaseSync(path.join(directory, "trace.sqlite"));
    context.after(() => database.close());
    database.exec("PRAGMA foreign_keys = OFF");
    // Fault injection targets retained storage; observations remain at the public iterator.
    database
        .prepare("UPDATE records SET body_json = ? WHERE record_id = ?")
        .run('{"value":"corrupt"}', ids[1] ?? "");
    const corrupt = store.iterateCutRecords("cut:corrupt");
    assert.equal((await corrupt.next()).value?.body.value, "first");
    await assert.rejects(corrupt.next(), TypeError);
    database
        .prepare("UPDATE records SET body_json = ? WHERE record_id = ?")
        .run('{"value":"second"}', ids[1] ?? "");

    const changed = store.iterateCutRecords("cut:corrupt");
    await changed.next();
    database
        .prepare("UPDATE record_views SET record_id = ? WHERE owner_id = ? AND owner_ordinal = ?")
        .run(ids[0] ?? "", "run:iteration", 2);
    await changed.next();
    await assert.rejects(changed.next(), /terminal occurrence/u);
    database
        .prepare("UPDATE record_views SET record_id = ? WHERE owner_id = ? AND owner_ordinal = ?")
        .run(ids[2] ?? "", "run:iteration", 2);

    database
        .prepare(
            "UPDATE record_views SET append_intent_id = ? WHERE owner_id = ? AND owner_ordinal = ?",
        )
        .run("", "run:iteration", 1);
    const malformed = store.iterateCutRecords("cut:corrupt");
    await malformed.next();
    await assert.rejects(malformed.next(), TypeError);
    database
        .prepare(
            "UPDATE record_views SET append_intent_id = ? WHERE owner_id = ? AND owner_ordinal = ?",
        )
        .run("intent:first", "run:iteration", 1);

    database.prepare("DELETE FROM records WHERE record_id = ?").run(ids[1] ?? "");
    const missingRecord = store.iterateCutRecords("cut:corrupt");
    await missingRecord.next();
    await assert.rejects(missingRecord.next(), /occurrence or its retained record is missing/u);
    database
        .prepare("DELETE FROM record_views WHERE owner_id = ? AND owner_ordinal = ?")
        .run("run:iteration", 1);
    const missingView = store.iterateCutRecords("cut:corrupt");
    await missingView.next();
    await assert.rejects(missingView.next(), /occurrence or its retained record is missing/u);
    database
        .prepare("UPDATE trace_cuts SET target_owner_id = ? WHERE cut_id = ?")
        .run("run:other", "cut:corrupt");
    await assert.rejects(store.iterateCutRecords("cut:corrupt").next(), TraceStoreError);
});

test("cut iteration rejects coherently indexed endpoints outside the configured ordinal range", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-iteration-boundary-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    const ids = appendValues(store, "intent:first", ["first"]);
    const cut = store.publishCut({
        cut_id: "cut:boundary",
        target_owner_id: "run:iteration",
        publisher_owner_id: "run:publisher",
        through_record_id: ids[0] ?? "",
    });
    const publication = store.readRecord(cut.created_by_record_id);
    assert.ok(publication);
    const database = new DatabaseSync(path.join(directory, "trace.sqlite"));
    context.after(() => database.close());
    database.exec("PRAGMA ignore_check_constraints = ON");
    for (const ordinal of [
        kernelProtocolConfig.append.firstOwnerOrdinal - 1,
        kernelProtocolConfig.append.lastOwnerOrdinal + 1,
    ]) {
        const intent = `intent:boundary:${ordinal}`;
        const replacement =
            store.append({
                append_intent_id: intent,
                batch: {
                    groups: [
                        {
                            owner_id: "run:publisher",
                            records: [
                                {
                                    body: { ...publication.body, through_owner_ordinal: ordinal },
                                    mode: publication.envelope.mode,
                                    schema_ref: publication.envelope.schema_ref,
                                    witness_ref: publication.envelope.witness_ref,
                                    caused_by_record_ids: publication.envelope.caused_by_record_ids,
                                },
                            ],
                        },
                    ],
                },
            }).record_ids[0] ?? "";
        database
            .prepare("UPDATE record_views SET owner_ordinal = ? WHERE owner_id = ?")
            .run(ordinal, "run:iteration");
        database
            .prepare(
                "UPDATE trace_cuts SET through_owner_ordinal = ?, created_by_record_id = ?, append_intent_id = ? WHERE cut_id = ?",
            )
            .run(ordinal, replacement, intent, cut.cut_id);
        assert.equal(store.readCut(cut.cut_id).through_owner_ordinal, ordinal);
        await assert.rejects(store.iterateCutRecords(cut.cut_id).next(), TraceStoreError);
    }
});

function appendValues(
    store: SQLiteTraceStore,
    intent: string,
    values: readonly string[],
): readonly string[] {
    return store.append({
        append_intent_id: intent,
        batch: {
            groups: [
                {
                    owner_id: "run:iteration",
                    records: values.map((value) => ({
                        body: { value },
                        mode: "capture" as const,
                        schema_ref: "example.iteration.v1",
                        witness_ref: ROOT_WITNESS_ID,
                    })),
                },
            ],
        },
    }).record_ids;
}
