import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import {
    type CutSpec,
    ROOT_WITNESS_ID,
    SQLiteTraceStore,
    TraceStoreError,
} from "../../src/index.ts";
import { kernelProtocolConfig } from "../../src/protocol/config.ts";

test("published cuts resolve the immutable owner prefix across append and reopen", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-cut-test-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const databasePath = path.join(directory, "trace.sqlite");
    const store = new SQLiteTraceStore(databasePath);
    const first = appendValues(store, "intent:first", ["first", "second"]);
    const cut = store.publishCut({
        cut_id: "cut:alpha:second",
        target_owner_id: "run:alpha",
        through_record_id: first[1] ?? "",
    });

    assert.deepEqual(cut, {
        created_by_record_id: cut.created_by_record_id,
        cut_id: "cut:alpha:second",
        publisher_owner_id: "run:alpha",
        target_owner_id: "run:alpha",
        through_owner_ordinal: 1,
        through_record_id: first[1],
    });
    assert.deepEqual(
        store.publishCut({
            cut_id: "cut:alpha:second",
            target_owner_id: "run:alpha",
            through_record_id: first[1] ?? "",
        }),
        cut,
    );
    appendValues(store, "intent:later", ["third"]);
    assert.deepEqual(store.resolveCut(cut.cut_id).owner_paths["run:alpha"], first);
    store.close();

    const reopened = new SQLiteTraceStore(databasePath);
    assert.deepEqual(reopened.readCut(cut.cut_id), cut);
    assert.deepEqual(
        Object.values(reopened.resolveCut(cut.cut_id).visible_records_by_id).map((record) =>
            "body" in record ? record.body.value : undefined,
        ),
        ["first", "second"],
    );
    reopened.close();
});

test("cut publication validates targets, conflicts, options, and retained truth", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-cut-validation-test-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const databasePath = path.join(directory, "trace.sqlite");
    const store = new SQLiteTraceStore(databasePath);
    const [recordId] = appendValues(store, "intent:target", ["target"]);

    assert.throws(
        () =>
            store.publishCut({
                cut_id: "cut:missing-owner",
                target_owner_id: "run:missing",
                through_record_id: recordId ?? "",
            }),
        TraceStoreError,
    );
    assert.throws(() => store.readCut("cut:unknown"), TraceStoreError);
    for (const spec of [
        null,
        [],
        {},
        { extra: true },
        { [Symbol("invalid")]: true },
        Object.defineProperty({}, "cut_id", { get: () => "cut:accessor" }),
        { cut_id: "", target_owner_id: "run:alpha", through_record_id: recordId },
        { cut_id: "cut:x", target_owner_id: "", through_record_id: recordId },
        { cut_id: "cut:x", target_owner_id: "run:alpha", through_record_id: "invalid" },
        {
            append_intent_id: "",
            cut_id: "cut:x",
            target_owner_id: "run:alpha",
            through_record_id: recordId,
        },
        {
            caused_by_record_ids: "invalid",
            cut_id: "cut:x",
            target_owner_id: "run:alpha",
            through_record_id: recordId,
        },
    ]) {
        assert.throws(() => store.publishCut(spec as CutSpec), TypeError);
    }

    const cut = store.publishCut({
        append_intent_id: "intent:custom-cut",
        caused_by_record_ids: [],
        cut_id: "cut:custom",
        publisher_owner_id: "run:publisher",
        target_owner_id: "run:alpha",
        through_record_id: recordId ?? "",
        witness_ref: ROOT_WITNESS_ID,
    });
    assert.equal(cut.publisher_owner_id, "run:publisher");
    const publisherRecordCount = store.readOwner("run:publisher").length;
    assert.throws(
        () =>
            store.publishCut({
                append_intent_id: "intent:duplicate-cut-publication",
                caused_by_record_ids: [],
                cut_id: "cut:custom",
                publisher_owner_id: "run:publisher",
                target_owner_id: "run:alpha",
                through_record_id: recordId ?? "",
                witness_ref: ROOT_WITNESS_ID,
            }),
        TraceStoreError,
    );
    assert.equal(store.readOwner("run:publisher").length, publisherRecordCount);
    assert.throws(
        () =>
            store.publishCut({
                append_intent_id: "intent:conflicting-cut",
                cut_id: "cut:custom",
                target_owner_id: "run:alpha",
                through_record_id: recordId ?? "",
            }),
        TraceStoreError,
    );

    const impostor =
        store.append({
            append_intent_id: "intent:impostor-cut",
            batch: {
                groups: [
                    {
                        owner_id: "run:publisher",
                        records: [
                            {
                                body: {
                                    cut_id: cut.cut_id,
                                    publisher_owner_id: cut.publisher_owner_id,
                                    target_owner_id: cut.target_owner_id,
                                    through_owner_ordinal: cut.through_owner_ordinal,
                                    through_record_id: cut.through_record_id,
                                },
                                mode: "capture",
                                schema_ref: kernelProtocolConfig.queries.cutSchemaRef,
                                witness_ref: ROOT_WITNESS_ID,
                            },
                        ],
                    },
                ],
            },
        }).record_ids[0] ?? "";
    const database = new DatabaseSync(databasePath);
    database
        .prepare(
            "UPDATE trace_cuts SET created_by_record_id = ?, append_intent_id = ? WHERE cut_id = ?",
        )
        .run(impostor, "intent:impostor-cut", cut.cut_id);
    assert.throws(() => store.readCut(cut.cut_id), TraceStoreError);
    database
        .prepare(
            "UPDATE trace_cuts SET created_by_record_id = ?, append_intent_id = ? WHERE cut_id = ?",
        )
        .run(cut.created_by_record_id, "intent:custom-cut", cut.cut_id);
    database
        .prepare("UPDATE trace_cuts SET append_intent_id = ? WHERE cut_id = ?")
        .run("intent:impostor-cut", cut.cut_id);
    assert.throws(() => store.readCut(cut.cut_id), TraceStoreError);
    database
        .prepare("UPDATE trace_cuts SET append_intent_id = ? WHERE cut_id = ?")
        .run("intent:custom-cut", cut.cut_id);
    database
        .prepare("UPDATE trace_cuts SET target_owner_id = ? WHERE cut_id = ?")
        .run("run:corrupt", cut.cut_id);
    assert.throws(() => store.readCut(cut.cut_id), TraceStoreError);
    database
        .prepare("UPDATE trace_cuts SET target_owner_id = ? WHERE cut_id = ?")
        .run("run:alpha", cut.cut_id);
    database
        .prepare("DELETE FROM record_views WHERE owner_id = ? AND record_id = ?")
        .run("run:alpha", recordId ?? "");
    database.close();
    assert.throws(() => store.readCut(cut.cut_id), TraceStoreError);
    store.close();
});

function appendValues(
    store: SQLiteTraceStore,
    appendIntentId: string,
    values: readonly string[],
): readonly string[] {
    return store.append({
        append_intent_id: appendIntentId,
        batch: {
            groups: [
                {
                    owner_id: "run:alpha",
                    records: values.map((value) => ({
                        body: { value },
                        mode: "capture" as const,
                        schema_ref: "example.value.v1",
                        witness_ref: ROOT_WITNESS_ID,
                    })),
                },
            ],
        },
    }).record_ids;
}
