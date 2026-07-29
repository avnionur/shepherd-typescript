import assert from "node:assert/strict";
import { test } from "node:test";

import { ROOT_WITNESS_ID, SQLiteTraceStore } from "../../src/index.ts";

test("SQLiteTraceStore projects active children and parent-published records", () => {
    const store = new SQLiteTraceStore();
    const parentId = "exec:parent";
    const childId = "exec:child";
    const parentStarted = appendStartedExecution(store, parentId, "Parent", { value: 10 });
    const relation =
        store.append({
            append_intent_id: "intent:parent:spawn-child",
            batch: {
                groups: [
                    {
                        owner_id: parentId,
                        records: [
                            {
                                body: {
                                    payload: {
                                        child_frontier_id: "cut:child:complete",
                                        child_execution_id: childId,
                                        parent_execution_id: parentId,
                                        relation_id: "relation:parent-child",
                                        relation_kind: "spawned",
                                    },
                                },
                                caused_by_record_ids: [parentStarted],
                                mode: "capture",
                                schema_ref: "shepherd2.execution_relation.created.v1",
                                witness_ref: ROOT_WITNESS_ID,
                            },
                        ],
                    },
                ],
            },
        }).record_ids[0] ?? "";
    const childStarted = appendStartedExecution(store, childId, "Child", { value: 10 }, relation);
    const childCompleted =
        store.append({
            append_intent_id: "intent:child:complete",
            batch: {
                groups: [
                    {
                        owner_id: childId,
                        records: [
                            {
                                body: {
                                    payload: {
                                        execution_id: childId,
                                        outputs: { value: 11 },
                                    },
                                },
                                caused_by_record_ids: [childStarted],
                                mode: "capture",
                                schema_ref: "shepherd2.execution.completed.v1",
                                witness_ref: ROOT_WITNESS_ID,
                            },
                        ],
                    },
                ],
            },
        }).record_ids[0] ?? "";
    const childCut = store.publishCut({
        caused_by_record_ids: [relation],
        cut_id: "cut:child:complete",
        publisher_owner_id: parentId,
        target_owner_id: childId,
        through_record_id: childCompleted,
    });
    const published =
        store.append({
            append_intent_id: "intent:parent:publish",
            batch: {
                groups: [
                    {
                        owner_id: parentId,
                        records: [
                            {
                                body: {
                                    payload: {
                                        data: { body: "hello" },
                                        kind: "note",
                                    },
                                },
                                mode: "capture",
                                schema_ref: "shepherd2.runtime.published_fact.v1",
                                witness_ref: ROOT_WITNESS_ID,
                            },
                        ],
                    },
                ],
            },
        }).record_ids[0] ?? "";
    const parentCompleted =
        store.append({
            append_intent_id: "intent:parent:complete",
            batch: {
                groups: [
                    {
                        owner_id: parentId,
                        records: [
                            {
                                body: {
                                    payload: {
                                        execution_id: parentId,
                                        outputs: { done: true },
                                    },
                                },
                                caused_by_record_ids: [childCut.created_by_record_id, published],
                                mode: "capture",
                                schema_ref: "shepherd2.execution.completed.v1",
                                witness_ref: ROOT_WITNESS_ID,
                            },
                        ],
                    },
                ],
            },
        }).record_ids[0] ?? "";
    const parentCut = store.publishCut({
        cut_id: "cut:parent:complete",
        target_owner_id: parentId,
        through_record_id: parentCompleted,
    });

    const history = store.projectEffectiveHistory(parentCut.cut_id);

    assert.equal(history.root.status, "succeeded");
    assert.deepEqual(history.root.outputs, { done: true });
    assert.deepEqual(history.relations, [
        {
            child_cut_id: childCut.cut_id,
            child_execution_id: childId,
            created_record_id: relation,
            parent_execution_id: parentId,
            relation_id: "relation:parent-child",
            relation_kind: "spawned",
        },
    ]);
    assert.equal(history.children.length, 1);
    assert.equal(history.children[0]?.relation, history.relations[0]);
    assert.equal(history.children[0]?.execution.status, "succeeded");
    assert.deepEqual(history.children[0]?.execution.outputs, { value: 11 });
    assert.deepEqual(history.published_records, [
        {
            data: { body: "hello" },
            kind: "note",
            record_id: published,
        },
    ]);
    assert.equal(Object.isFrozen(history), true);
    assert.equal(Object.isFrozen(history.children), true);
    assert.equal(Object.isFrozen(history.published_records[0]?.data), true);
    store.close();
});

function appendStartedExecution(
    store: SQLiteTraceStore,
    executionId: string,
    taskRef: string,
    inputs: Readonly<Record<string, boolean | number | string>>,
    causedByRecordId?: string,
): string {
    const receipt = store.append({
        append_intent_id: `intent:${executionId}:create`,
        batch: {
            groups: [
                {
                    owner_id: executionId,
                    records: [
                        {
                            body: {
                                payload: {
                                    execution_id: executionId,
                                    inputs,
                                    parent_execution_id: null,
                                    task_ref: taskRef,
                                },
                            },
                            ...(causedByRecordId === undefined
                                ? {}
                                : { caused_by_record_ids: [causedByRecordId] }),
                            mode: "declaration",
                            schema_ref: "shepherd2.execution.created.v1",
                            witness_ref: ROOT_WITNESS_ID,
                        },
                        {
                            body: { payload: { execution_id: executionId } },
                            mode: "capture",
                            schema_ref: "shepherd2.execution.started.v1",
                            witness_ref: ROOT_WITNESS_ID,
                        },
                    ],
                },
            ],
        },
    });
    return receipt.record_ids[1] ?? "";
}
