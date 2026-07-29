import assert from "node:assert/strict";
import { test } from "node:test";

import { ROOT_WITNESS_ID, SQLiteTraceStore } from "../../src/index.ts";

test("SQLiteTraceStore projects an immutable execution at a published cut", () => {
    const store = new SQLiteTraceStore();
    const executionId = "exec:parent";
    const created = store.append({
        append_intent_id: "intent:parent:create",
        batch: {
            groups: [
                {
                    owner_id: executionId,
                    records: [
                        {
                            body: {
                                payload: {
                                    execution_id: executionId,
                                    inputs: { value: 10 },
                                    parent_execution_id: null,
                                    task_ref: "Parent",
                                },
                            },
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
    const completed = store.append({
        append_intent_id: "intent:parent:complete",
        batch: {
            groups: [
                {
                    owner_id: executionId,
                    records: [
                        {
                            body: {
                                payload: {
                                    execution_id: executionId,
                                    outputs: { value: 11 },
                                },
                            },
                            caused_by_record_ids: [created.record_ids[1] ?? ""],
                            mode: "capture",
                            schema_ref: "shepherd2.execution.completed.v1",
                            witness_ref: ROOT_WITNESS_ID,
                        },
                    ],
                },
            ],
        },
    });
    const cut = store.publishCut({
        cut_id: "cut:parent:complete",
        target_owner_id: executionId,
        through_record_id: completed.record_ids[0] ?? "",
    });
    store.append({
        append_intent_id: "intent:parent:later-failure",
        batch: {
            groups: [
                {
                    owner_id: executionId,
                    records: [
                        {
                            body: {
                                payload: {
                                    error: "must remain outside the cut",
                                    execution_id: executionId,
                                },
                            },
                            mode: "capture",
                            schema_ref: "shepherd2.execution.failed.v1",
                            witness_ref: ROOT_WITNESS_ID,
                        },
                    ],
                },
            ],
        },
    });

    const execution = store.projectExecution(cut.cut_id);

    assert.deepEqual(execution, {
        cut,
        error: null,
        execution_id: executionId,
        inputs: { value: 10 },
        outputs: { value: 11 },
        parent_execution_id: null,
        started_record_id: created.record_ids[1],
        status: "succeeded",
        task_ref: "Parent",
        terminal_record_id: completed.record_ids[0],
    });
    assert.equal(Object.isFrozen(execution), true);
    assert.equal(Object.isFrozen(execution.inputs), true);
    assert.equal(Object.isFrozen(execution.outputs), true);
    store.close();
});
