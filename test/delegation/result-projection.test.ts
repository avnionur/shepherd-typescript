import assert from "node:assert/strict";
import { test } from "node:test";

import { createDelegationOutputDigest } from "../../src/delegation/records.ts";
import {
    acceptChildRunResult,
    approveChildRunTask,
    DELEGATION_LIMITS,
    DELEGATION_TREE_ROOT_KINDS,
    DelegationEvidenceError,
    discardChildRun,
    handoffChildRun,
    openChildRun,
    projectChildRunResult,
    projectDelegationTree,
    runChildRun,
    SQLiteTraceStore,
    schema,
    task,
    taskValueOf,
} from "../../src/index.ts";
import {
    echoTask,
    openOptions,
    providerFor,
    summaryTask,
    temporaryDatabasePath,
    voidTask,
} from "./fixtures.ts";

const LEAD = "supervisor:lead";
const NEXT = "supervisor:next";

const versionedEchoTask = task({
    input: schema.string(),
    instruction: "Echo the input.",
    name: "echo",
    output: schema.string(),
    version: "2",
});

test("result projection re-validates accepted outputs and proves the caller schema", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "projection");
    using store = new SQLiteTraceStore(databasePath);
    const { handle } = openChildRun(store, {
        ...openOptions("project:accepted"),
        input: { topic: "release" },
        task: summaryTask,
    });
    const ready = projectChildRunResult(store, handle.handle_id);
    assert.deepEqual(ready, {
        child_outcome_record_id: null,
        child_run_id: handle.child_run_id,
        decision_record_id: null,
        handle_id: handle.handle_id,
        output_id: null,
        status: "ready",
        task: taskValueOf(summaryTask),
        value: null,
    });
    await runChildRun(store, { handle, program: () => ({ text: "about release" }) });
    const settling = projectChildRunResult(store, handle.handle_id, {
        schema: schema.object({ text: schema.string() }),
    });
    assert.equal(settling.status, "settling");
    assert.equal(settling.value, null);
    assert.equal(settling.decision_record_id, null);
    const accepted = acceptChildRunResult(store, {
        commandId: "project:accept",
        handle,
        supervisorId: LEAD,
    });
    const typed = projectChildRunResult(store, handle.handle_id, {
        schema: schema.object({ text: schema.string() }),
    });
    const text: string | undefined = typed.value?.text;
    assert.equal(text, "about release");
    assert.deepEqual(typed, {
        child_outcome_record_id: accepted.inspection.decision?.child_outcome_record_id,
        child_run_id: handle.child_run_id,
        decision_record_id: accepted.record_id,
        handle_id: handle.handle_id,
        output_id: createDelegationOutputDigest({ text: "about release" }),
        status: "accepted",
        task: taskValueOf(summaryTask),
        value: { text: "about release" },
    });
    assert.deepEqual(projectChildRunResult(store, handle.handle_id), typed);
    assert.deepEqual(
        projectChildRunResult(store, handle.handle_id, {
            schema: schema.fromJSONSchema(summaryTask.artifact.output_schema),
        }),
        typed,
    );
    assert.equal(Object.isFrozen(typed), true);
    for (const mismatched of [
        schema.string(),
        schema.void(),
        schema.task(),
        schema.object({ text: schema.string(), extra: schema.string() }),
        schema.object({ text: schema.null() }),
    ]) {
        assert.throws(
            () => projectChildRunResult(store, handle.handle_id, { schema: mismatched }),
            /does not match the retained task output schema/u,
        );
    }
    for (const invalid of [
        { schema: null },
        { schema: { parse: () => null, toJSONSchema: () => ({ type: "string" }) } },
        { schema: summaryTask.artifact.output_schema },
        { extra: true },
        null,
        [],
    ]) {
        assert.throws(
            () => projectChildRunResult(store, handle.handle_id, invalid as never),
            TypeError,
        );
    }
    assert.throws(() => projectChildRunResult(store, "run:other"), TypeError);
    assert.throws(
        () => projectChildRunResult(store, `delegation:sha256:${"0".repeat(64)}`),
        DelegationEvidenceError,
    );

    const nothing = openChildRun(store, {
        ...openOptions("project:void"),
        input: undefined,
        task: voidTask,
    });
    await runChildRun(store, { handle: nothing.handle, program: () => undefined });
    acceptChildRunResult(store, {
        commandId: "project:accept-void",
        handle: nothing.handle,
        supervisorId: LEAD,
    });
    const voidResult = projectChildRunResult(store, nothing.handle.handle_id, {
        schema: schema.void(),
    });
    assert.equal(voidResult.status, "accepted");
    assert.equal(voidResult.value, null);
    assert.equal(voidResult.output_id, createDelegationOutputDigest(null));

    const dropped = openChildRun(store, openOptions("project:discarded"));
    const discarded = discardChildRun(store, {
        commandId: "project:discard",
        handle: dropped.handle,
        reason: "never started",
        supervisorId: LEAD,
    });
    assert.deepEqual(projectChildRunResult(store, dropped.handle.handle_id), {
        child_outcome_record_id: null,
        child_run_id: dropped.handle.child_run_id,
        decision_record_id: discarded.record_id,
        handle_id: dropped.handle.handle_id,
        output_id: null,
        status: "discarded",
        task: taskValueOf(echoTask),
        value: null,
    });

    const revised = openChildRun(store, {
        ...openOptions("project:rejected"),
        provenance: { changes: ["task_version"], kind: "revised", source: taskValueOf(echoTask) },
        task: taskValueOf(versionedEchoTask),
    });
    assert.equal(projectChildRunResult(store, revised.handle.handle_id).status, "approval_pending");
    approveChildRunTask(store, {
        commandId: "project:reject",
        handle: revised.handle,
        supervisorId: LEAD,
        verdict: "rejected",
    });
    const rejected = projectChildRunResult(store, revised.handle.handle_id, {
        schema: schema.string(),
    });
    assert.equal(rejected.status, "rejected");
    assert.equal(rejected.value, null);
    assert.equal(rejected.decision_record_id, null);
    assert.deepEqual(rejected.task, taskValueOf(versionedEchoTask));

    using readOnly = new SQLiteTraceStore(databasePath, { readOnly: true });
    assert.deepEqual(projectChildRunResult(readOnly, handle.handle_id), typed);
    using imported = new SQLiteTraceStore();
    imported.importTrace(store.exportTrace());
    assert.deepEqual(projectChildRunResult(imported, handle.handle_id), typed);
    assert.deepEqual(projectChildRunResult(imported, revised.handle.handle_id), rejected);
});

test("supervisor trees follow handoffs and handle trees list only direct children", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "tree");
    using store = new SQLiteTraceStore(databasePath);
    assert.deepEqual(DELEGATION_TREE_ROOT_KINDS, ["handle", "supervisor"]);
    assert.deepEqual(projectDelegationTree(store, { kind: "supervisor", supervisorId: LEAD }), {
        entries: [],
        root: { kind: "supervisor", supervisorId: LEAD },
    });
    const first = openChildRun(store, openOptions("tree:first"));
    const second = openChildRun(store, openOptions("tree:second"));
    const third = openChildRun(store, openOptions("tree:third"));
    const nested = openChildRun(store, {
        ...openOptions("tree:nested", { maxTurns: 1 }),
        parent: first.handle,
    });
    const deeper = openChildRun(store, {
        ...openOptions("tree:deeper", { maxTurns: 1 }),
        parent: nested.handle,
    });
    await runChildRun(store, {
        handle: first.handle,
        provider: providerFor(echoTask, "hello", "hi"),
    });
    acceptChildRunResult(store, {
        commandId: "tree:accept-first",
        handle: first.handle,
        supervisorId: LEAD,
    });
    handoffChildRun(store, {
        commandId: "tree:handoff",
        handle: second.handle,
        successorSupervisorId: NEXT,
        supervisorId: LEAD,
    });
    const lead = projectDelegationTree(store, { kind: "supervisor", supervisorId: LEAD });
    assert.deepEqual(
        lead.entries.map((entry) => entry.handle_id),
        [first.handle.handle_id, third.handle.handle_id].sort(),
    );
    assert.deepEqual(
        lead.entries.map((entry) => entry.handle_id),
        [...lead.entries.map((entry) => entry.handle_id)].sort(),
    );
    const firstEntry = lead.entries.find((entry) => entry.handle_id === first.handle.handle_id);
    assert.deepEqual(firstEntry, {
        authority: first.handle.authority,
        budget: first.handle.budget,
        child_run_id: first.handle.child_run_id,
        depth: 1,
        handle_id: first.handle.handle_id,
        result: projectChildRunResult(store, first.handle.handle_id),
        status: "accepted",
        supervisor_id: LEAD,
        task: taskValueOf(echoTask),
    });
    assert.equal(firstEntry?.result.value, "hi");
    const thirdEntry = lead.entries.find((entry) => entry.handle_id === third.handle.handle_id);
    assert.equal(thirdEntry?.status, "ready");
    assert.equal(thirdEntry?.result.value, null);
    const next = projectDelegationTree(store, { kind: "supervisor", supervisorId: NEXT });
    assert.deepEqual(
        next.entries.map((entry) => [entry.handle_id, entry.supervisor_id, entry.status]),
        [[second.handle.handle_id, NEXT, "ready"]],
    );
    assert.deepEqual(
        projectDelegationTree(store, { kind: "supervisor", supervisorId: "supervisor:none" })
            .entries,
        [],
    );
    const underFirst = projectDelegationTree(store, {
        handleId: first.handle.handle_id,
        kind: "handle",
    });
    assert.deepEqual(underFirst.root, { handleId: first.handle.handle_id, kind: "handle" });
    assert.deepEqual(
        underFirst.entries.map((entry) => [entry.handle_id, entry.depth]),
        [[nested.handle.handle_id, 2]],
    );
    assert.deepEqual(
        projectDelegationTree(store, {
            handleId: nested.handle.handle_id,
            kind: "handle",
        }).entries.map((entry) => [entry.handle_id, entry.depth]),
        [[deeper.handle.handle_id, 3]],
    );
    assert.deepEqual(
        projectDelegationTree(store, { handleId: deeper.handle.handle_id, kind: "handle" }).entries,
        [],
    );
    assert.throws(
        () =>
            projectDelegationTree(store, {
                handleId: `delegation:sha256:${"0".repeat(64)}`,
                kind: "handle",
            }),
        DelegationEvidenceError,
    );
    for (const invalid of [
        null,
        {},
        { kind: "other" },
        { kind: "handle" },
        { kind: "handle", handleId: "run:x" },
        { kind: "handle", handleId: first.handle.handle_id, supervisorId: LEAD },
        { kind: "supervisor" },
        { kind: "supervisor", supervisorId: "" },
        {
            kind: "supervisor",
            supervisorId: "s".repeat(DELEGATION_LIMITS.maxSupervisorIdLength + 1),
        },
        { kind: "supervisor", supervisorId: LEAD, handleId: first.handle.handle_id },
        { kind: "supervisor", supervisorId: LEAD, extra: true },
        { kind: "root" },
    ]) {
        assert.throws(() => projectDelegationTree(store, invalid as never), TypeError);
    }
    using readOnly = new SQLiteTraceStore(databasePath, { readOnly: true });
    assert.deepEqual(
        projectDelegationTree(readOnly, { kind: "supervisor", supervisorId: LEAD }),
        lead,
    );
    using imported = new SQLiteTraceStore();
    imported.importTrace(store.exportTrace());
    assert.deepEqual(
        projectDelegationTree(imported, { kind: "supervisor", supervisorId: NEXT }),
        next,
    );
});

test("delegation trees are bounded by the configured entry count", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "tree-bound");
    using store = new SQLiteTraceStore(databasePath);
    const supervisorId = "supervisor:bound";
    for (let index = 0; index < DELEGATION_LIMITS.maxTreeEntries; index += 1) {
        openChildRun(store, { ...openOptions(`tree:bound:${index}`), supervisorId });
    }
    const full = projectDelegationTree(store, { kind: "supervisor", supervisorId });
    assert.equal(full.entries.length, DELEGATION_LIMITS.maxTreeEntries);
    openChildRun(store, { ...openOptions("tree:bound:beyond"), supervisorId });
    assert.throws(
        () => projectDelegationTree(store, { kind: "supervisor", supervisorId }),
        (error: unknown) =>
            error instanceof TypeError && /exceeds the configured bound/u.test(error.message),
    );
    assert.deepEqual(
        projectDelegationTree(store, { kind: "supervisor", supervisorId: LEAD }).entries,
        [],
    );
});
