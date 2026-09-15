import assert from "node:assert/strict";
import { test } from "node:test";

import { createChildRunHandleId } from "../../src/delegation/records.ts";
import {
    approveChildRunTask,
    DelegationApprovalRequiredError,
    inspectChildRun,
    inspectDurableTaskExecution,
    openChildRun,
    readTaskValue,
    runChildRun,
    SQLiteTraceStore,
    schema,
    task,
    taskValueOf,
} from "../../src/index.ts";
import { echoTask, openOptions, providerFor, temporaryDatabasePath } from "./fixtures.ts";

const LEAD = "supervisor:lead";

/** Model-serviced task whose output is a task definition. */
const synthesizeTask = task({
    input: schema.string(),
    instruction: "Write a task definition for the request.",
    name: "synthesize",
    output: schema.task(),
    version: "1",
});

/** Definition a model may emit: the echo task with a revised instruction. */
const emittedValue = taskValueOf(
    task({
        input: schema.string(),
        instruction: "Echo the input politely.",
        name: "echo",
        output: schema.string(),
        version: "1",
    }),
);

function ownerCounts(store: SQLiteTraceStore, owners: readonly string[]): readonly number[] {
    return owners.map((owner) => store.readOwner(owner).length);
}

test("a model-emitted task definition executes only as an approved task value under the child run identity", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "boundary");
    using store = new SQLiteTraceStore(databasePath);
    const planner = openChildRun(store, {
        ...openOptions("delegate:planner"),
        input: "echo politely",
        task: synthesizeTask,
    });
    const planned = await runChildRun(store, {
        handle: planner.handle,
        provider: providerFor(synthesizeTask, "echo politely", emittedValue),
    });
    assert.equal(planned.inspection.completion?.status, "finished");
    const outcome = inspectDurableTaskExecution(store, planner.handle.child_run_id).outcome;
    assert.ok(outcome !== null);
    const terminal = outcome.outcome.outcome;
    const emitted = readTaskValue(terminal.status === "finished" ? terminal.value : null);
    assert.deepEqual(emitted, emittedValue);
    assert.equal(typeof (emitted.artifact as Record<string, unknown>).run, "undefined");

    const producer = { record_id: outcome.record_id, run_id: planner.handle.child_run_id };
    const watched = [planner.handle.handle_id, planner.handle.child_run_id, "worker:other"];
    const before = ownerCounts(store, watched);
    const malformed: readonly [string, unknown][] = [
        ["function property", { ...emitted, artifact: { ...emitted.artifact, run: () => 1 } }],
        ["extra key", { ...emitted, code: "return 1" }],
        [
            "foreign schema reference",
            {
                ...emitted,
                artifact: {
                    ...emitted.artifact,
                    output_schema: { $ref: "https://example.com/evil" },
                },
            },
        ],
        [
            "unsupported grammar",
            { ...emitted, artifact: { ...emitted.artifact, input_schema: { type: "array" } } },
        ],
        [
            "non-canonical form",
            {
                ...emitted,
                artifact: {
                    ...emitted.artifact,
                    input_schema: {
                        additionalProperties: false,
                        properties: { b: { type: "string" }, a: { type: "string" } },
                        required: ["b", "a"],
                        type: "object",
                    },
                },
            },
        ],
        ["lock mismatch", { ...emitted, artifact: { ...emitted.artifact, instruction: "Other." } }],
    ];
    for (const [label, value] of malformed) {
        const commandId = `delegate:${label}`;
        assert.throws(
            () =>
                openChildRun(store, {
                    ...openOptions(commandId),
                    provenance: { kind: "synthesized", producer },
                    task: value as never,
                }),
            TypeError,
            label,
        );
        assert.equal(store.readOwner(createChildRunHandleId(commandId)).length, 0, label);
    }
    assert.deepEqual(ownerCounts(store, watched), before);

    const synthesized = openChildRun(store, {
        ...openOptions("delegate:emitted"),
        provenance: { kind: "synthesized", producer },
        task: emitted,
    });
    assert.equal(synthesized.inspection.status, "approval_pending");
    await assert.rejects(
        runChildRun(store, {
            handle: synthesized.handle,
            program: () => "never",
        }),
        DelegationApprovalRequiredError,
    );
    assert.equal(store.readOwner(synthesized.handle.child_run_id).length, 0);

    approveChildRunTask(store, {
        commandId: "approve:emitted",
        handle: synthesized.handle,
        supervisorId: LEAD,
        verdict: "approved",
    });
    const tracked = [
        ...watched,
        synthesized.handle.handle_id,
        synthesized.handle.child_run_id,
        createChildRunHandleId("delegate:rejected-emitted"),
    ];
    const ordinals = store.readOwnerNextOrdinals(tracked);
    const seen: string[] = [];
    const ran = await runChildRun(store, {
        handle: synthesized.handle,
        program: ({ handle, input, task: rehydrated }) => {
            seen.push(handle.child_run_id, rehydrated.instruction, String(input));
            return "hello, politely";
        },
    });
    assert.deepEqual(seen, [synthesized.handle.child_run_id, "Echo the input politely.", "hello"]);
    assert.equal(ran.inspection.completion?.execution_kind, "program");
    const after = store.readOwnerNextOrdinals(tracked);
    const gained = tracked.filter((owner) => after.get(owner) !== ordinals.get(owner));
    assert.deepEqual(gained, [synthesized.handle.handle_id, synthesized.handle.child_run_id]);
    assert.equal(ordinals.get(synthesized.handle.child_run_id), 0);
    assert.ok(
        store
            .readOwner(synthesized.handle.child_run_id)
            .every((record) => record.view?.owner_id === synthesized.handle.child_run_id),
    );
    const child = inspectDurableTaskExecution(store, synthesized.handle.child_run_id);
    assert.equal(child.outcome?.outcome.outcome.status, "finished");
    assert.equal(
        inspectChildRun(store, synthesized.handle.handle_id).task.artifact_lock.artifact_digest,
        emitted.artifact_lock.artifact_digest,
    );

    const rejected = openChildRun(store, {
        ...openOptions("delegate:rejected-emitted"),
        provenance: { kind: "synthesized", producer },
        task: emitted,
    });
    approveChildRunTask(store, {
        commandId: "reject:emitted",
        handle: rejected.handle,
        reason: "not needed",
        supervisorId: LEAD,
        verdict: "rejected",
    });
    await assert.rejects(
        runChildRun(store, {
            handle: rejected.handle,
            provider: providerFor(echoTask, "hello", "hi"),
        }),
    );
    assert.equal(store.readOwner(rejected.handle.child_run_id).length, 0);
    assert.equal(inspectChildRun(store, rejected.handle.handle_id).status, "rejected");
});
