import assert from "node:assert/strict";
import { test } from "node:test";

import {
    type AppendBatchDraft,
    type AppendRecordDraft,
    createRecordEnvelope,
    planAppendBatch,
    type RecordMode,
} from "../src/index.ts";

const witnessRef = createRecordEnvelope({
    body: {
        active_binding_refs: [],
        actor_ref: "kernel:root",
        authority_refs: [],
        containment: "full",
        provenance_policy_refs: [],
        semantic_environment_refs: [],
        substrate_ref: "kernel",
        visibility_policy_refs: [],
    },
    mode: "capture",
    schema_ref: "kernel.witness.root.v1",
    witness_ref: "",
}).record_id;

const recordDraft: AppendRecordDraft = {
    body: { operation: "task.event" },
    mode: "capture",
    schema_ref: "example.task-event.v1",
    witness_ref: witnessRef,
};

test("planAppendBatch creates envelopes and assigns owner-local ordinals", () => {
    const existingParent = `sha256:${"1".repeat(64)}`;
    const batch: AppendBatchDraft = {
        groups: [
            {
                owner_id: "run:alpha",
                caused_by_record_ids: [existingParent],
                records: [
                    {
                        append_local_id: "started",
                        body: { operation: "task.started" },
                        mode: "capture",
                        schema_ref: "example.task-event.v1",
                        witness_ref: witnessRef,
                    },
                    {
                        body: { operation: "task.completed" },
                        caused_by_local_refs: ["started"],
                        mode: "capture",
                        schema_ref: "example.task-event.v1",
                        witness_ref: witnessRef,
                    },
                ],
            },
        ],
    };

    const result = planAppendBatch(batch, {
        known_record_ids: new Set([existingParent]),
        next_owner_ordinals: new Map([["run:alpha", 7]]),
    });

    assert.equal(result.records.length, 2);
    assert.deepEqual(
        result.records.map(({ view }) => view),
        [
            { owner_id: "run:alpha", owner_ordinal: 7 },
            { owner_id: "run:alpha", owner_ordinal: 8 },
        ],
    );
    assert.deepEqual(result.records[0]?.envelope.caused_by_record_ids, [existingParent]);
    assert.deepEqual(result.records[1]?.envelope.caused_by_record_ids, [
        existingParent,
        result.records[0]?.envelope.record_id,
    ]);
    assert.deepEqual(result.owner_ordinal_ranges.get("run:alpha"), [7, 8]);
    assert.equal(result.next_owner_ordinals.get("run:alpha"), 9);
    assert.deepEqual(result.causal_edges, [
        [existingParent, result.records[0]?.envelope.record_id],
        [existingParent, result.records[1]?.envelope.record_id],
        [result.records[0]?.envelope.record_id, result.records[1]?.envelope.record_id],
    ]);
});

test("planAppendBatch starts owners independently and continues repeated owner groups", () => {
    const suppliedOrdinals = new Map([["run:untouched", 4]]);
    const result = planAppendBatch(
        {
            groups: [
                { owner_id: "run:alpha", records: [recordDraft] },
                { owner_id: "run:beta", records: [recordDraft] },
                { owner_id: "run:alpha", records: [recordDraft] },
                { owner_id: "run:empty", records: [] },
            ],
        },
        { next_owner_ordinals: suppliedOrdinals },
    );

    assert.deepEqual(
        result.records.map(({ view }) => view),
        [
            { owner_id: "run:alpha", owner_ordinal: 0 },
            { owner_id: "run:beta", owner_ordinal: 0 },
            { owner_id: "run:alpha", owner_ordinal: 1 },
        ],
    );
    assert.deepEqual(result.owner_ordinal_ranges.get("run:alpha"), [0, 1]);
    assert.deepEqual(result.owner_ordinal_ranges.get("run:beta"), [0, 0]);
    assert.equal(result.owner_ordinal_ranges.has("run:empty"), false);
    assert.equal(result.next_owner_ordinals.get("run:alpha"), 2);
    assert.equal(result.next_owner_ordinals.get("run:beta"), 1);
    assert.equal(result.next_owner_ordinals.get("run:untouched"), 4);
    assert.deepEqual([...suppliedOrdinals], [["run:untouched", 4]]);
});

test("planAppendBatch snapshots bodies before returning them", () => {
    const body = { nested: { value: 1 }, omitted: undefined, values: [null, true] };
    const result = planAppendBatch({
        groups: [{ owner_id: "run:alpha", records: [{ ...recordDraft, body }] }],
    });

    body.nested.value = 2;

    assert.deepEqual(result.records[0]?.body, {
        nested: { value: 1 },
        values: [null, true],
    });
    assert.notEqual(result.records[0]?.body, body);
    assert.equal(Object.isFrozen(result.records), true);
    assert.equal(Object.isFrozen(result.records[0]), true);
    assert.equal(Object.isFrozen(result.records[0]?.body), true);
    assert.equal(Object.isFrozen(result.records[0]?.body.nested), true);
    assert.equal(Object.isFrozen(result.records[0]?.body.values), true);
    assert.equal(Object.isFrozen(result.records[0]?.envelope), true);
    assert.equal(Object.isFrozen(result.records[0]?.envelope.caused_by_record_ids), true);
    assert.equal(Object.isFrozen(result.records[0]?.view), true);
    const nested = result.records[0]?.body.nested as { value: number };
    assert.throws(() => {
        nested.value = 3;
    }, TypeError);
});

test("planAppendBatch rejects unknown, forward, and duplicate causal parents", () => {
    const unknownParent = `sha256:${"2".repeat(64)}`;
    assert.throws(
        () =>
            planAppendBatch({
                groups: [
                    {
                        owner_id: "run:alpha",
                        records: [{ ...recordDraft, caused_by_record_ids: [unknownParent] }],
                    },
                ],
            }),
        /unknown causal parent/,
    );
    assert.throws(
        () =>
            planAppendBatch({
                groups: [
                    {
                        owner_id: "run:alpha",
                        records: [
                            { ...recordDraft, caused_by_local_refs: ["later"] },
                            { ...recordDraft, append_local_id: "later" },
                        ],
                    },
                ],
            }),
        /earlier draft/,
    );
    assert.throws(
        () =>
            planAppendBatch(
                {
                    groups: [
                        {
                            owner_id: "run:alpha",
                            caused_by_record_ids: [unknownParent],
                            records: [
                                {
                                    ...recordDraft,
                                    caused_by_record_ids: [unknownParent],
                                },
                            ],
                        },
                    ],
                },
                { known_record_ids: new Set([unknownParent]) },
            ),
        /duplicate causal parent/,
    );
});

test("planAppendBatch rejects malformed batches, groups, drafts, and references", () => {
    assert.throws(() => planAppendBatch(null as unknown as AppendBatchDraft), /plain object/);
    assert.throws(
        () => planAppendBatch({ groups: "groups" } as unknown as AppendBatchDraft),
        /groups must be an array/,
    );
    assert.throws(
        () => planAppendBatch({ groups: [null] } as unknown as AppendBatchDraft),
        /groups\[0\].*plain object/,
    );
    assert.throws(() => planAppendBatch({ groups: [{ owner_id: "", records: [] }] }), /owner_id/);
    assert.throws(
        () => planAppendBatch({ groups: [{ owner_id: "\uD800", records: [] }] }),
        /valid Unicode/,
    );
    assert.throws(
        () =>
            planAppendBatch({
                groups: [{ owner_id: "run:alpha", records: "records" }],
            } as unknown as AppendBatchDraft),
        /records must be an array/,
    );
    assert.throws(
        () =>
            planAppendBatch({
                groups: [{ owner_id: "run:alpha", records: [null] }],
            } as unknown as AppendBatchDraft),
        /records\[0\].*plain object/,
    );
    assert.throws(
        () =>
            planAppendBatch({
                groups: [
                    {
                        owner_id: "run:alpha",
                        caused_by_record_ids: "parent",
                        records: [],
                    },
                ],
            } as unknown as AppendBatchDraft),
        /caused_by_record_ids must be an array/,
    );
    assert.throws(
        () =>
            planAppendBatch({
                groups: [
                    {
                        owner_id: "run:alpha",
                        caused_by_record_ids: ["invalid"],
                        records: [],
                    },
                ],
            }),
        /caused_by_record_ids\[0\]/,
    );
    assert.throws(
        () =>
            planAppendBatch({
                groups: [
                    {
                        owner_id: "run:alpha",
                        records: [
                            {
                                ...recordDraft,
                                caused_by_record_ids: "parent",
                            },
                        ],
                    },
                ],
            } as unknown as AppendBatchDraft),
        /caused_by_record_ids must be an array/,
    );
    assert.throws(
        () =>
            planAppendBatch({
                groups: [
                    {
                        owner_id: "run:alpha",
                        records: [
                            {
                                ...recordDraft,
                                caused_by_local_refs: "local",
                            },
                        ],
                    },
                ],
            } as unknown as AppendBatchDraft),
        /caused_by_local_refs must be an array/,
    );
    assert.throws(
        () =>
            planAppendBatch({
                groups: [
                    {
                        owner_id: "run:alpha",
                        records: [
                            {
                                ...recordDraft,
                                caused_by_local_refs: [""],
                            },
                        ],
                    },
                ],
            }),
        /caused_by_local_refs\[0\]/,
    );
    assert.throws(
        () =>
            planAppendBatch({
                groups: [
                    {
                        owner_id: "run:alpha",
                        records: [
                            {
                                ...recordDraft,
                                witness_ref: "",
                            },
                        ],
                    },
                ],
            }),
        /witness_ref/,
    );
});

test("planAppendBatch enforces closed descriptor-safe draft shapes", () => {
    assert.throws(
        () =>
            planAppendBatch({
                groups: [],
                extra: true,
            } as unknown as AppendBatchDraft),
        /unsupported field: extra/,
    );
    assert.throws(
        () =>
            planAppendBatch({
                groups: [{ owner_id: "run:alpha", records: [], extra: true }],
            } as unknown as AppendBatchDraft),
        /unsupported field: extra/,
    );
    assert.throws(
        () =>
            planAppendBatch({
                groups: [
                    {
                        owner_id: "run:alpha",
                        records: [{ ...recordDraft, extra: true }],
                    },
                ],
            } as unknown as AppendBatchDraft),
        /unsupported field: extra/,
    );
    assert.throws(() => planAppendBatch({} as AppendBatchDraft), /groups is required/);

    class BatchValue {
        readonly groups: readonly [] = [];
    }
    assert.throws(() => planAppendBatch(new BatchValue() as AppendBatchDraft), /plain object/);

    let getterCalls = 0;
    const accessorBatch = Object.defineProperty({}, "groups", {
        enumerable: true,
        get() {
            getterCalls += 1;
            return [];
        },
    });
    assert.throws(() => planAppendBatch(accessorBatch as AppendBatchDraft), /accessor property/);
    assert.equal(getterCalls, 0);

    const symbolBatch = { groups: [], [Symbol("extra")]: true };
    assert.throws(() => planAppendBatch(symbolBatch), /symbol properties/);
});

test("planAppendBatch rejects non-data group and record arrays", () => {
    const symbolGroups = Object.assign([], { [Symbol("extra")]: true });
    assert.throws(() => planAppendBatch({ groups: symbolGroups }), /symbol properties/);

    const sparseGroups = new Array(1);
    assert.throws(
        () => planAppendBatch({ groups: sparseGroups } as AppendBatchDraft),
        /sparse array element/,
    );

    const accessorGroups: unknown[] = [];
    Object.defineProperty(accessorGroups, "0", {
        enumerable: true,
        get: () => ({ owner_id: "run:alpha", records: [] }),
    });
    Object.defineProperty(accessorGroups, "length", { value: 1 });
    assert.throws(
        () => planAppendBatch({ groups: accessorGroups } as AppendBatchDraft),
        /accessor array element/,
    );

    assert.throws(
        () => planAppendBatch({ groups: [undefined] } as unknown as AppendBatchDraft),
        /undefined array element/,
    );

    const customGroups: unknown[] & { label?: string } = [];
    customGroups.label = "custom";
    assert.throws(
        () => planAppendBatch({ groups: customGroups } as AppendBatchDraft),
        /custom properties/,
    );
});

test("planAppendBatch rejects duplicate or malformed local identifiers", () => {
    assert.throws(
        () =>
            planAppendBatch({
                groups: [
                    {
                        owner_id: "run:alpha",
                        records: [{ ...recordDraft, append_local_id: "" }],
                    },
                ],
            }),
        /append_local_id/,
    );
    assert.throws(
        () =>
            planAppendBatch({
                groups: [
                    {
                        owner_id: "run:alpha",
                        records: [
                            { ...recordDraft, append_local_id: "same" },
                            { ...recordDraft, append_local_id: "same" },
                        ],
                    },
                ],
            }),
        /duplicates/,
    );
});

test("planAppendBatch validates known identifiers and next-owner ordinal state", () => {
    assert.throws(
        () => planAppendBatch({ groups: [] }, { known_record_ids: new Set(["invalid"]) }),
        /known_record_ids/,
    );
    assert.throws(
        () => planAppendBatch({ groups: [] }, { next_owner_ordinals: new Map([["", 0]]) }),
        /next_owner_ordinals owner/,
    );
    assert.throws(
        () =>
            planAppendBatch({ groups: [] }, { next_owner_ordinals: new Map([["run:alpha", -1]]) }),
        /safe integer at least/,
    );
    assert.throws(
        () =>
            planAppendBatch(
                {
                    groups: [{ owner_id: "run:alpha", records: [recordDraft] }],
                },
                {
                    next_owner_ordinals: new Map([["run:alpha", Number.MAX_SAFE_INTEGER]]),
                },
            ),
        /exceeds the safe integer range/,
    );
    assert.throws(
        () =>
            planAppendBatch({
                groups: [
                    {
                        owner_id: "run:alpha",
                        records: [
                            {
                                ...recordDraft,
                                mode: "observed" as RecordMode,
                            },
                        ],
                    },
                ],
            }),
        /mode/,
    );
});
