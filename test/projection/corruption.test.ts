import assert from "node:assert/strict";
import { test } from "node:test";

import {
    projectExecutionRelations,
    ROOT_WITNESS_ID,
    type SemanticRecord,
    SQLiteTraceStore,
    TraceStoreError,
} from "../../src/index.ts";

test("schema-specific projection records fail closed", () => {
    using store = new SQLiteTraceStore();
    const invalidExecutionCut = appendRecordAndCut(
        store,
        "exec:invalid",
        "intent:invalid-execution-payload",
        "shepherd2.execution.created.v1",
        "invalid",
    );
    assert.throws(() => store.projectExecution(invalidExecutionCut), TraceStoreError);

    const invalidRelationCut = appendRecordAndCut(
        store,
        "exec:invalid-relation",
        "intent:invalid-relation-kind",
        "shepherd2.execution_relation.created.v1",
        {
            parent_execution_id: "exec:invalid-relation",
            relation_kind: "unknown",
        },
    );
    assert.throws(
        () => store.projectEffectiveHistory(invalidRelationCut),
        /unknown execution relation kind/,
    );

    const malformedRelationCut = appendRecordAndCut(
        store,
        "exec:malformed-relation",
        "intent:malformed-relation-payload",
        "shepherd2.execution_relation.created.v1",
        null,
    );
    assert.throws(() => store.projectEffectiveHistory(malformedRelationCut), TraceStoreError);

    const missingKindCut = appendRecordAndCut(
        store,
        "exec:missing-relation-kind",
        "intent:missing-relation-kind",
        "shepherd2.execution_relation.created.v1",
        {},
    );
    assert.throws(
        () => store.projectEffectiveHistory(missingKindCut),
        /unknown execution relation kind/,
    );

    const malformedPublishedCut = appendRecordAndCut(
        store,
        "exec:malformed-published",
        "intent:malformed-published",
        "shepherd2.runtime.published_fact.v1",
        null,
    );
    assert.throws(() => store.projectEffectiveHistory(malformedPublishedCut), TraceStoreError);
});

test("relation projections ignore records owned by another parent", () => {
    using store = new SQLiteTraceStore();
    appendRecordAndCut(
        store,
        "exec:relation-owner",
        "intent:mismatched-relation-parent",
        "shepherd2.execution_relation.created.v1",
        {
            parent_execution_id: "exec:other-parent",
            relation_kind: "spawned",
        },
    );
    appendRecordAndCut(
        store,
        "exec:missing-relation-parent",
        "intent:missing-relation-parent",
        "shepherd2.execution_relation.created.v1",
        { relation_kind: "spawned" },
    );

    assert.deepEqual(
        projectExecutionRelations(
            store.readOwnerPrefix("exec:relation-owner", 0),
            "exec:relation-owner",
        ),
        [],
    );
    assert.deepEqual(
        projectExecutionRelations(
            store.readOwnerPrefix("exec:missing-relation-parent", 0),
            "exec:missing-relation-parent",
        ),
        [],
    );
});

test("published-record projections apply optional field defaults", () => {
    using store = new SQLiteTraceStore();
    const ownerId = "exec:published";
    const firstCut = appendRecordAndCut(
        store,
        ownerId,
        "intent:default-published-data",
        "shepherd2.runtime.published_fact.v1",
        { data: [], kind: 7 },
    );
    assert.deepEqual(store.projectEffectiveHistory(firstCut).published_records, [
        {
            data: {},
            kind: "7",
            record_id: store.readCut(firstCut).through_record_id,
        },
    ]);

    const secondCut = appendRecordAndCut(
        store,
        ownerId,
        "intent:missing-published-kind",
        "shepherd2.runtime.published_fact.v1",
        { data: {} },
    );
    assert.equal(store.projectEffectiveHistory(secondCut).published_records[1]?.kind, "");
});

function appendRecordAndCut(
    store: SQLiteTraceStore,
    ownerId: string,
    appendIntentId: string,
    schemaRef: string,
    payload: SemanticRecord["payload"] | null | string,
): string {
    const recordId =
        store.append({
            append_intent_id: appendIntentId,
            batch: {
                groups: [
                    {
                        owner_id: ownerId,
                        records: [
                            {
                                body: { payload },
                                mode: "capture",
                                schema_ref: schemaRef,
                                witness_ref: ROOT_WITNESS_ID,
                            },
                        ],
                    },
                ],
            },
        }).record_ids[0] ?? "";
    const cutId = `cut:${appendIntentId}`;
    store.publishCut({
        cut_id: cutId,
        target_owner_id: ownerId,
        through_record_id: recordId,
    });
    return cutId;
}
