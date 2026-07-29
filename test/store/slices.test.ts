import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import {
    ROOT_WITNESS_ID,
    type SliceReadOptions,
    SQLiteTraceStore,
    TraceStoreError,
} from "../../src/index.ts";

test("causal closure filters traversal records without synthesizing edges", () => {
    const store = new SQLiteTraceStore();
    const receipt = store.append({
        append_intent_id: "intent:causal-slice",
        batch: {
            groups: [
                {
                    owner_id: "run:alpha",
                    records: [
                        {
                            append_local_id: "declared",
                            body: { value: "declared" },
                            mode: "declaration",
                            schema_ref: "example.value.v1",
                            witness_ref: ROOT_WITNESS_ID,
                        },
                        {
                            append_local_id: "captured",
                            body: { value: "captured" },
                            caused_by_local_refs: ["declared"],
                            mode: "capture",
                            schema_ref: "example.value.v1",
                            witness_ref: ROOT_WITNESS_ID,
                        },
                    ],
                },
                {
                    owner_id: "run:beta",
                    records: [
                        {
                            body: { value: "completed" },
                            caused_by_local_refs: ["captured"],
                            mode: "capture",
                            schema_ref: "example.value.v1",
                            witness_ref: ROOT_WITNESS_ID,
                        },
                    ],
                },
            ],
        },
    });
    const [declaredId, capturedId, completedId] = receipt.record_ids;
    const slice = store.readCausalClosure([completedId ?? ""], {
        mode_filter: "captures_only",
    });

    assert.deepEqual(Object.keys(slice.visible_records_by_id), [capturedId, completedId]);
    assert.deepEqual(slice.owner_paths, {
        "run:alpha": [capturedId],
        "run:beta": [completedId],
    });
    assert.deepEqual(slice.causal_edges, [[capturedId, completedId]]);
    assert.deepEqual(slice.external_anchors, [{ hidden_reason: "outside_slice", ref: declaredId }]);
    assert.deepEqual(Object.keys(slice.visible_witnesses_by_id), [ROOT_WITNESS_ID]);

    const shapeOnly = store.readCausalClosure([completedId ?? ""], {
        closure_policy: "visible_only",
        mode_filter: "captures_only",
        visibility_profile: "shape_only",
    });
    assert.equal("body" in (shapeOnly.visible_records_by_id[capturedId ?? ""] ?? {}), false);
    assert.deepEqual(shapeOnly.external_anchors, []);
    assert.deepEqual(Object.keys(shapeOnly.visible_witnesses_by_id), []);
    assert.deepEqual(shapeOnly.witness_anchors, [
        {
            hidden_reason: "hidden_by_visibility",
            visible_shape: {
                schema_ref: "kernel.witness.root.v1",
                witness_ref: "",
            },
            witness_ref: ROOT_WITNESS_ID,
        },
    ]);
    store.close();
});

test("slice queries validate selectors and support owner prefixes and duplicate roots", () => {
    const store = new SQLiteTraceStore();
    const receipt = store.append({
        append_intent_id: "intent:query-validation",
        batch: {
            groups: [
                {
                    owner_id: "__proto__",
                    records: [
                        {
                            append_local_id: "declared",
                            body: { value: "declared" },
                            mode: "declaration",
                            schema_ref: "example.value.v1",
                            witness_ref: ROOT_WITNESS_ID,
                        },
                        {
                            body: { value: "captured" },
                            caused_by_local_refs: ["declared"],
                            mode: "capture",
                            schema_ref: "example.value.v1",
                            witness_ref: ROOT_WITNESS_ID,
                        },
                    ],
                },
            ],
        },
    });
    const [declaredId, capturedId] = receipt.record_ids;

    const prefix = store.readOwnerPrefix("__proto__", 1, {
        mode_filter: "declarations_only",
        visibility_profile: "full_internal",
    });
    assert.deepEqual(Object.getOwnPropertyDescriptor(prefix.owner_paths, "__proto__")?.value, [
        declaredId,
    ]);
    assert.deepEqual(
        Object.keys(
            store.readCausalClosure([capturedId ?? "", capturedId ?? ""]).visible_records_by_id,
        ),
        [declaredId, capturedId],
    );
    store.readCausalClosure([ROOT_WITNESS_ID, capturedId ?? ""]);
    store.readCausalClosure([capturedId ?? "", ROOT_WITNESS_ID]);
    assert.deepEqual(store.readCausalClosure([]).visible_records_by_id, {});
    assert.deepEqual(
        store.readOwnerPrefix("run:x", 0, Object.create(null) as SliceReadOptions),
        store.readOwnerPrefix("run:x", 0),
    );
    assert.throws(() => store.readOwnerPrefix("run:x", -1), TypeError);
    assert.throws(() => store.readOwnerPrefix("run:x", Number.MAX_SAFE_INTEGER), TypeError);
    assert.throws(
        () => store.readOwnerPrefix("run:x", 0, { mode_filter: "invalid" as "both" }),
        TypeError,
    );
    assert.throws(
        () =>
            store.readOwnerPrefix("run:x", 0, {
                visibility_profile: "invalid" as "payload",
            }),
        TypeError,
    );
    assert.throws(
        () =>
            store.readCausalClosure([capturedId ?? ""], {
                closure_policy: "invalid" as "visible_only",
            }),
        TypeError,
    );
    assert.throws(() => store.readCausalClosure(["invalid"]), TypeError);
    assert.throws(() => store.readCausalClosure([`sha256:${"1".repeat(64)}`]), TraceStoreError);
    for (const options of [
        null,
        [],
        { extra: true },
        { [Symbol("invalid")]: true },
        Object.defineProperty({}, "mode_filter", { get: () => "both" }),
    ]) {
        assert.throws(() => store.readOwnerPrefix("run:x", 0, options as never), TypeError);
    }
    const sparseRoots = new Array<string>(1);
    const customRoots = [capturedId ?? ""];
    Object.defineProperty(customRoots, "extra", { value: true });
    const symbolRoots = [capturedId ?? ""];
    Object.defineProperty(symbolRoots, Symbol("invalid"), { value: true });
    const accessorRoots = [capturedId ?? ""];
    Object.defineProperty(accessorRoots, "0", { get: () => capturedId });
    for (const roots of ["invalid", sparseRoots, customRoots, symbolRoots, accessorRoots]) {
        assert.throws(() => store.readCausalClosure(roots as readonly string[]), TypeError);
    }
    store.close();
});

test("causal slices retain every owner occurrence for shared semantic records", () => {
    const store = new SQLiteTraceStore();
    const body = { value: "shared" };
    const first =
        store.append({
            append_intent_id: "intent:shared:first",
            batch: {
                groups: [
                    {
                        owner_id: "run:first",
                        records: [
                            {
                                body,
                                mode: "capture",
                                schema_ref: "example.value.v1",
                                witness_ref: ROOT_WITNESS_ID,
                            },
                        ],
                    },
                ],
            },
        }).record_ids[0] ?? "";
    store.append({
        append_intent_id: "intent:shared:second",
        batch: {
            groups: [
                {
                    owner_id: "run:second",
                    records: [
                        {
                            body,
                            mode: "capture",
                            schema_ref: "example.value.v1",
                            witness_ref: ROOT_WITNESS_ID,
                        },
                    ],
                },
            ],
        },
    });

    assert.deepEqual(store.readCausalClosure([first]).owner_paths, {
        "run:first": [first],
        "run:second": [first],
    });
    store.close();
});

test("owner-prefix slices fail closed when a retained view loses its record", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-slice-corruption-test-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const databasePath = path.join(directory, "trace.sqlite");
    const store = new SQLiteTraceStore(databasePath);
    const recordId =
        store.append({
            append_intent_id: "intent:orphaned-view",
            batch: {
                groups: [
                    {
                        owner_id: "run:corrupt",
                        records: [
                            {
                                body: { value: "orphaned" },
                                mode: "capture",
                                schema_ref: "example.value.v1",
                                witness_ref: ROOT_WITNESS_ID,
                            },
                        ],
                    },
                ],
            },
        }).record_ids[0] ?? "";
    const database = new DatabaseSync(databasePath);
    database.exec("PRAGMA foreign_keys = OFF");
    database.prepare("DELETE FROM records WHERE record_id = ?").run(recordId);
    database.close();

    assert.throws(() => store.readOwnerPrefix("run:corrupt", 0), TraceStoreError);
    store.close();
});

test("slice reads reject retained records that cite non-witness evidence", () => {
    const store = new SQLiteTraceStore();
    const ordinary =
        store.append({
            append_intent_id: "intent:ordinary",
            batch: {
                groups: [
                    {
                        owner_id: "run:alpha",
                        records: [
                            {
                                body: { value: "ordinary" },
                                mode: "capture",
                                schema_ref: "example.value.v1",
                                witness_ref: ROOT_WITNESS_ID,
                            },
                        ],
                    },
                ],
            },
        }).record_ids[0] ?? "";
    const invalid =
        store.append({
            append_intent_id: "intent:invalid-witness",
            batch: {
                groups: [
                    {
                        owner_id: "run:alpha",
                        records: [
                            {
                                body: { value: "invalid witness" },
                                mode: "capture",
                                schema_ref: "example.value.v1",
                                witness_ref: ordinary,
                            },
                        ],
                    },
                ],
            },
        }).record_ids[0] ?? "";

    assert.throws(() => store.readCausalClosure([invalid]), TraceStoreError);
    store.close();
});
