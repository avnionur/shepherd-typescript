import assert from "node:assert/strict";
import { test } from "node:test";

import {
    projectEffectiveHistory,
    ROOT_WITNESS_ID,
    SQLiteTraceStore,
    TraceStoreError,
} from "../../src/index.ts";

test("latest relation transitions select only effective children", () => {
    const store = new SQLiteTraceStore();
    const ownerId = "exec:parent";
    const transitions = [
        {
            child_frontier_id: "cut:missing",
            child_execution_id: "exec:abandoned-child",
            parent_execution_id: ownerId,
            relation_id: "relation:abandoned",
            relation_kind: "spawned",
        },
        {
            child_frontier_id: "cut:missing",
            child_execution_id: "exec:abandoned-child",
            parent_execution_id: ownerId,
            relation_id: "relation:abandoned",
            relation_kind: "abandoned",
        },
        {
            child_frontier_id: null,
            child_execution_id: "exec:adopted-child",
            parent_execution_id: ownerId,
            relation_id: "relation:adopted",
            relation_kind: "adopted",
        },
    ] as const;
    const receipt = store.append({
        append_intent_id: "intent:parent:relations",
        batch: {
            groups: [
                {
                    owner_id: ownerId,
                    records: transitions.map((payload) => ({
                        body: { payload },
                        mode: "capture" as const,
                        schema_ref: "shepherd2.execution_relation.created.v1",
                        witness_ref: ROOT_WITNESS_ID,
                    })),
                },
            ],
        },
    });
    const cut = store.publishCut({
        cut_id: "cut:parent:relations",
        publisher_owner_id: "exec:cut-publisher",
        target_owner_id: ownerId,
        through_record_id: receipt.record_ids[2] ?? "",
    });

    const history = store.projectEffectiveHistory(cut.cut_id);

    assert.deepEqual(
        history.relations.map(({ relation_kind: kind }) => kind),
        ["spawned", "abandoned", "adopted"],
    );
    assert.deepEqual(history.children, []);
    assert.equal(history.root.status, "pending");

    const unresolved =
        store.append({
            append_intent_id: "intent:parent:unresolved-child",
            batch: {
                groups: [
                    {
                        owner_id: ownerId,
                        records: [
                            {
                                body: {
                                    payload: {
                                        child_frontier_id: "cut:unresolved",
                                        child_execution_id: "exec:unresolved",
                                        parent_execution_id: ownerId,
                                        relation_id: "relation:unresolved",
                                        relation_kind: "spawned",
                                    },
                                },
                                mode: "capture",
                                schema_ref: "shepherd2.execution_relation.created.v1",
                                witness_ref: ROOT_WITNESS_ID,
                            },
                        ],
                    },
                ],
            },
        }).record_ids[0] ?? "";
    const unresolvedCut = store.publishCut({
        cut_id: "cut:parent:unresolved",
        publisher_owner_id: "exec:cut-publisher",
        target_owner_id: ownerId,
        through_record_id: unresolved,
    });
    const unresolvedSlice = store.resolveCut(unresolvedCut.cut_id);
    assert.deepEqual(projectEffectiveHistory(unresolvedSlice, ownerId).children, []);
    assert.throws(() => store.projectEffectiveHistory(unresolvedCut.cut_id), TraceStoreError);
    store.close();
});

test("effective history rejects a child cut targeting another execution", () => {
    using store = new SQLiteTraceStore();
    const actualChildId = "exec:actual-child";
    const parentId = "exec:mismatched-parent";
    const expectedChildId = "exec:expected-child";
    const childRecordId =
        store.append({
            append_intent_id: "intent:actual-child",
            batch: {
                groups: [
                    {
                        owner_id: actualChildId,
                        records: [
                            {
                                body: { payload: { execution_id: actualChildId } },
                                mode: "capture",
                                schema_ref: "shepherd2.execution.started.v1",
                                witness_ref: ROOT_WITNESS_ID,
                            },
                        ],
                    },
                ],
            },
        }).record_ids[0] ?? "";
    const childCut = store.publishCut({
        cut_id: "cut:actual-child",
        target_owner_id: actualChildId,
        through_record_id: childRecordId,
    });
    const relationRecordId =
        store.append({
            append_intent_id: "intent:mismatched-child-cut",
            batch: {
                groups: [
                    {
                        owner_id: parentId,
                        records: [
                            {
                                body: {
                                    payload: {
                                        child_execution_id: expectedChildId,
                                        child_frontier_id: childCut.cut_id,
                                        parent_execution_id: parentId,
                                        relation_id: "relation:mismatched-child",
                                        relation_kind: "spawned",
                                    },
                                },
                                mode: "capture",
                                schema_ref: "shepherd2.execution_relation.created.v1",
                                witness_ref: ROOT_WITNESS_ID,
                            },
                        ],
                    },
                ],
            },
        }).record_ids[0] ?? "";
    const parentCut = store.publishCut({
        cut_id: "cut:mismatched-parent",
        target_owner_id: parentId,
        through_record_id: relationRecordId,
    });

    assert.throws(
        () => store.projectEffectiveHistory(parentCut.cut_id),
        /does not target exec:expected-child/,
    );
});
