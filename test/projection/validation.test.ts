import assert from "node:assert/strict";
import { test } from "node:test";

import {
    ProjectionCompatibilityError,
    projectEffectiveHistory,
    projectExecution,
    projectExecutionRelations,
    ROOT_WITNESS_ID,
    type Slice,
    SQLiteTraceStore,
    TraceStoreError,
} from "../../src/index.ts";

test("execution projections enforce compatibility and fold optional values", () => {
    using store = new SQLiteTraceStore();
    const ownerId = "exec:validation";
    store.append({
        append_intent_id: "intent:projection-validation",
        batch: {
            groups: [
                {
                    owner_id: ownerId,
                    records: [
                        {
                            body: {
                                payload: {
                                    execution_id: ownerId,
                                    inputs: [],
                                    parent_execution_id: 42,
                                    task_ref: 7,
                                },
                            },
                            mode: "declaration",
                            schema_ref: "shepherd2.execution.created.v1",
                            witness_ref: ROOT_WITNESS_ID,
                        },
                        {
                            body: { payload: { execution_id: ownerId } },
                            mode: "capture",
                            schema_ref: "shepherd2.execution.started.v1",
                            witness_ref: ROOT_WITNESS_ID,
                        },
                        {
                            body: {
                                payload: {
                                    execution_id: "exec:other",
                                    outputs: { ignored: true },
                                },
                            },
                            mode: "capture",
                            schema_ref: "shepherd2.execution.completed.v1",
                            witness_ref: ROOT_WITNESS_ID,
                        },
                        {
                            body: { payload: { error: 500, execution_id: ownerId } },
                            mode: "capture",
                            schema_ref: "shepherd2.execution.failed.v1",
                            witness_ref: ROOT_WITNESS_ID,
                        },
                    ],
                },
            ],
        },
    });
    const runningSlice = store.readOwnerPrefix(ownerId, 1);
    const execution = projectExecution(runningSlice, ownerId);

    assert.deepEqual(execution, {
        error: null,
        execution_id: ownerId,
        inputs: {},
        outputs: {},
        parent_execution_id: "42",
        started_record_id: runningSlice.owner_paths[ownerId]?.[1],
        status: "running",
        task_ref: "7",
        terminal_record_id: null,
    });
    assert.equal(projectExecution(store.readOwnerPrefix(ownerId, 3), ownerId).status, "failed");
    assert.equal(projectExecution(store.readOwnerPrefix(ownerId, 3), ownerId).error, "500");
    assert.equal(projectExecution(runningSlice, "exec:absent").status, "pending");
    assert.deepEqual(projectExecutionRelations(runningSlice, "exec:absent"), []);
    assert.deepEqual(projectEffectiveHistory(runningSlice, "exec:absent"), {
        children: [],
        published_records: [],
        relations: [],
        root: {
            error: null,
            execution_id: "exec:absent",
            inputs: {},
            outputs: {},
            parent_execution_id: null,
            started_record_id: null,
            status: "pending",
            task_ref: "",
            terminal_record_id: null,
        },
    });
    assert.throws(
        () =>
            projectExecution(
                store.readOwnerPrefix(ownerId, 3, { mode_filter: "captures_only" }),
                ownerId,
            ),
        ProjectionCompatibilityError,
    );
    assert.throws(
        () =>
            projectExecution(
                store.readOwnerPrefix(ownerId, 3, { visibility_profile: "shape_only" }),
                ownerId,
            ),
        ProjectionCompatibilityError,
    );
    assert.throws(() => projectExecution(runningSlice, ""), TypeError);
    assert.throws(() => projectExecutionRelations(runningSlice, ""), TypeError);
    assert.throws(() => projectEffectiveHistory(runningSlice, ""), TypeError);

    const missingRecordSlice = { ...runningSlice, visible_records_by_id: {} } as Slice;
    assert.throws(() => projectExecution(missingRecordSlice, ownerId), TraceStoreError);
    assert.throws(() => projectExecutionRelations(missingRecordSlice, ownerId), TraceStoreError);
    assert.throws(() => projectEffectiveHistory(missingRecordSlice, ownerId), TraceStoreError);
    const shapeSlice = store.readOwnerPrefix(ownerId, 1, {
        visibility_profile: "shape_only",
    });
    assert.throws(
        () => projectExecution({ ...shapeSlice, visibility_profile: "payload" }, ownerId),
        TraceStoreError,
    );
    assert.deepEqual(projectEffectiveHistory(runningSlice, ownerId, [runningSlice]).children, []);
    const addressedSlice = store.resolveCut(
        store.publishCut({
            cut_id: "cut:projection-duplicate",
            target_owner_id: ownerId,
            through_record_id: runningSlice.owner_paths[ownerId]?.[1] ?? "",
        }).cut_id,
    );
    assert.throws(
        () => projectEffectiveHistory(runningSlice, ownerId, [addressedSlice, addressedSlice]),
        /duplicate child slice/,
    );
});

test("execution projections apply lifecycle defaults", () => {
    using store = new SQLiteTraceStore();
    const ownerId = "exec:defaults";
    store.append({
        append_intent_id: "intent:projection-defaults",
        batch: {
            groups: [
                {
                    owner_id: ownerId,
                    records: [
                        {
                            body: { payload: { inputs: {} } },
                            mode: "declaration",
                            schema_ref: "shepherd2.execution.created.v1",
                            witness_ref: ROOT_WITNESS_ID,
                        },
                        {
                            body: { payload: { outputs: [] } },
                            mode: "capture",
                            schema_ref: "shepherd2.execution.completed.v1",
                            witness_ref: ROOT_WITNESS_ID,
                        },
                        {
                            body: { payload: {} },
                            mode: "capture",
                            schema_ref: "shepherd2.execution.failed.v1",
                            witness_ref: ROOT_WITNESS_ID,
                        },
                    ],
                },
            ],
        },
    });

    const completed = projectExecution(store.readOwnerPrefix(ownerId, 1), ownerId);
    assert.equal(completed.status, "succeeded");
    assert.equal(completed.task_ref, "");
    assert.equal(completed.parent_execution_id, null);
    assert.deepEqual(completed.outputs, {});
    assert.equal(projectExecution(store.readOwnerPrefix(ownerId, 2), ownerId).error, "");
});
