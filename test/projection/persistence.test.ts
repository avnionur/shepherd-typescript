import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { ROOT_WITNESS_ID, SQLiteTraceStore } from "../../src/index.ts";

test("execution projections survive store reopen", (context) => {
    const directory = mkdtempSync(path.join(tmpdir(), "shepherd-projection-"));
    context.after(() => rmSync(directory, { recursive: true }));
    const databasePath = path.join(directory, "trace.sqlite");
    const executionId = "exec:persistent";
    using original = new SQLiteTraceStore(databasePath);
    const terminalRecordId =
        original.append({
            append_intent_id: "intent:persistent-execution",
            batch: {
                groups: [
                    {
                        owner_id: executionId,
                        records: [
                            {
                                body: {
                                    payload: {
                                        execution_id: executionId,
                                        task_ref: "Persistent",
                                    },
                                },
                                mode: "declaration",
                                schema_ref: "shepherd2.execution.created.v1",
                                witness_ref: ROOT_WITNESS_ID,
                            },
                            {
                                body: {
                                    payload: {
                                        execution_id: executionId,
                                        outputs: { retained: true },
                                    },
                                },
                                mode: "capture",
                                schema_ref: "shepherd2.execution.completed.v1",
                                witness_ref: ROOT_WITNESS_ID,
                            },
                        ],
                    },
                ],
            },
        }).record_ids[1] ?? "";
    original.publishCut({
        cut_id: "cut:persistent",
        target_owner_id: executionId,
        through_record_id: terminalRecordId,
    });
    original.close();

    using reopened = new SQLiteTraceStore(databasePath);
    const projected = reopened.projectExecution("cut:persistent");

    assert.equal(projected.status, "succeeded");
    assert.equal(projected.task_ref, "Persistent");
    assert.deepEqual(projected.outputs, { retained: true });
});
