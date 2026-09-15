import assert from "node:assert/strict";
import { test } from "node:test";

import { createDelegationAppendIntentId } from "../../src/delegation/records.ts";
import {
    AppendIntentConflictError,
    type ChildRunHandle,
    type Cut,
    type CutSpec,
    DelegationAuthorityError,
    DelegationCommandConflictError,
    DelegationEvidenceError,
    DelegationHeadConflictError,
    DelegationStatusError,
    executeTaskDurably,
    inspectChildRun,
    inspectDurableTaskExecution,
    type OwnerRecord,
    openChildRun,
    ROOT_WITNESS_ID,
    runChildRun,
    SQLiteTraceStore,
    type StoreAppendRequest,
    TraceStoreError,
    taskValueOf,
} from "../../src/index.ts";
import type { DelegationHandleAppend } from "../../src/store/delegation-handles.ts";
import {
    echoTask,
    grantOf,
    openOptions,
    providerFor,
    rootParent,
    summaryTask,
    temporaryDatabasePath,
    voidTask,
} from "./fixtures.ts";

class InterruptingCutStore extends SQLiteTraceStore {
    override publishCut(_spec: CutSpec): Cut {
        throw new Error("cut publication interrupted");
    }
}

class MovedHeadStore extends SQLiteTraceStore {
    override appendDelegationHandleRecord(
        _handleId: string,
        _expectedHeadRecordId: string,
        _request: StoreAppendRequest,
    ) {
        return Object.freeze({ status: "head_moved" as const });
    }
}

class ReplayingStore extends SQLiteTraceStore {
    readonly replays: DelegationHandleAppend[] = [];

    override appendDelegationHandleRecord(
        handleId: string,
        expectedHeadRecordId: string,
        request: StoreAppendRequest,
    ): DelegationHandleAppend {
        const first = super.appendDelegationHandleRecord(handleId, expectedHeadRecordId, request);
        this.replays.push(super.appendDelegationHandleRecord(handleId, "sha256:moved", request));
        return first;
    }
}

class RewritingStore extends SQLiteTraceStore {
    rewrite = false;

    override readOwner(ownerId: string): readonly OwnerRecord[] {
        const records = super.readOwner(ownerId);
        if (!this.rewrite) {
            return records;
        }
        return records.map((record, index) =>
            index === 0
                ? {
                      ...record,
                      envelope: { ...record.envelope, record_id: `sha256:${"f".repeat(64)}` },
                  }
                : record,
        );
    }
}

test("a provider-serviced child runs under its derived identity and settles with a completion", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "provider");
    using store = new SQLiteTraceStore(databasePath);
    const { handle, inspection } = openChildRun(store, openOptions("delegate:provider"));
    assert.equal(inspection.status, "ready");
    assert.equal(inspection.depth, 1);
    assert.equal(inspection.child, null);
    assert.equal(inspection.completion, null);
    assert.deepEqual(inspection.parent, { kind: "root" });
    assert.deepEqual(inspection.provenance, { kind: "declared" });
    assert.deepEqual(inspection.task, taskValueOf(echoTask));
    assert.equal(inspection.input, "hello");
    assert.deepEqual(inspection.authority, {
        ceiling: [grantOf(["read", "write"])],
        effective: [grantOf(["read"])],
    });
    assert.deepEqual(inspection.budget, { ceiling: { maxTurns: 4 }, effective: { maxTurns: 2 } });
    assert.match(inspection.handle_id, /^delegation:sha256:[0-9a-f]{64}$/u);
    assert.match(inspection.child_run_id, /^delegation-run:sha256:[0-9a-f]{64}$/u);
    assert.equal(handle.handle_id, inspection.handle_id);
    assert.equal(handle.child_run_id, inspection.child_run_id);
    assert.equal(Object.isFrozen(handle), true);

    const provider = providerFor(echoTask, "hello", "hello!");
    const ran = await runChildRun(store, { handle, provider });
    assert.equal(ran.handle, handle);
    assert.equal(ran.inspection.status, "settling");
    assert.equal(ran.inspection.child?.status, "committed");
    assert.equal(ran.inspection.child?.outcome?.outcome.outcome.status, "finished");
    assert.deepEqual(ran.inspection.child?.outcome?.outcome.outcome, {
        status: "finished",
        value: "hello!",
    });
    const completion = ran.inspection.completion;
    assert.ok(completion !== null);
    assert.equal(completion.execution_kind, "provider");
    assert.equal(completion.status, "finished");
    assert.equal(completion.supervisor_id, "supervisor:lead");
    assert.equal(completion.child_cut_id, ran.inspection.child?.cut?.cut_id);
    assert.equal(
        completion.child_terminal_record_id,
        ran.inspection.child?.lifecycle.terminal_record_id,
    );
    assert.equal(ran.inspection.head_record_id, completion.record_id);
    const durable = inspectDurableTaskExecution(store, handle.child_run_id);
    assert.equal(durable.status, "committed");

    const again = await runChildRun(store, { handle, provider });
    assert.equal(again.inspection.completion?.record_id, completion.record_id);
    assert.equal(store.readOwner(handle.handle_id).length, 2);
    assert.equal(store.verifyIntegrity().ok, true);
});

test("a program-serviced child receives its context and its output is validated", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "program");
    using store = new SQLiteTraceStore(databasePath);
    const { handle } = openChildRun(store, {
        ...openOptions("delegate:program"),
        input: { topic: "release" },
        task: summaryTask,
    });
    let seen: unknown = null;
    const ran = await runChildRun(store, {
        handle,
        program: async (programContext) => {
            seen = programContext;
            assert.equal(programContext.signal.aborted, false);
            assert.equal(inspectChildRun(store, handle.handle_id).status, "running");
            await assert.rejects(
                runChildRun(store, { handle, program: () => null }),
                DelegationStatusError,
            );
            return { text: `about ${(programContext.input as { topic: string }).topic}` };
        },
    });
    const observed = seen as {
        readonly authority: unknown;
        readonly budget: unknown;
        readonly handle: ChildRunHandle;
        readonly task: { readonly artifactLock: { readonly artifact_digest: string } };
    };
    assert.equal(observed.handle, handle);
    assert.deepEqual(observed.authority, handle.authority);
    assert.deepEqual(observed.budget, { maxTurns: 2 });
    assert.equal(
        observed.task.artifactLock.artifact_digest,
        summaryTask.artifactLock.artifact_digest,
    );
    assert.equal(ran.inspection.status, "settling");
    assert.equal(ran.inspection.completion?.execution_kind, "program");
    assert.deepEqual(ran.inspection.child?.outcome?.outcome.outcome, {
        status: "finished",
        value: { text: "about release" },
    });
    const created = store.readOwner(handle.child_run_id)[0]?.body as {
        readonly payload: { readonly provider: { readonly kind: string; readonly id: string } };
    };
    assert.equal(created.payload.provider.kind, "program");
    assert.equal(created.payload.provider.id, handle.handle_id);

    const invalid = openChildRun(store, { ...openOptions("delegate:invalid-output") });
    const failed = await runChildRun(store, { handle: invalid.handle, program: () => 42 });
    assert.equal(failed.inspection.completion?.status, "failed");
    const invalidOutcome = failed.inspection.child?.outcome?.outcome.outcome as
        | { readonly error_type: string }
        | undefined;
    assert.equal(invalidOutcome?.error_type, "TaskOutputValidationError");

    const thrown = openChildRun(store, { ...openOptions("delegate:thrown") });
    const threw = await runChildRun(store, {
        handle: thrown.handle,
        program: () => {
            throw new RangeError("boom");
        },
    });
    assert.equal(threw.inspection.completion?.status, "failed");
    const thrownOutcome = threw.inspection.child?.outcome?.outcome.outcome as
        | { readonly error_type: string }
        | undefined;
    assert.equal(thrownOutcome?.error_type, "RangeError");

    const nothing = openChildRun(store, {
        ...openOptions("delegate:void"),
        input: undefined,
        task: voidTask,
    });
    assert.equal(nothing.inspection.input, null);
    const settled = await runChildRun(store, { handle: nothing.handle, program: () => undefined });
    assert.deepEqual(settled.inspection.child?.outcome?.outcome.outcome, {
        status: "finished",
        value: null,
    });
});

test("opening is idempotent per command and refuses different content under the same identity", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "idempotent");
    using store = new SQLiteTraceStore(databasePath);
    const first = openChildRun(store, openOptions("delegate:same"));
    const second = openChildRun(store, {
        ...openOptions("delegate:same"),
        provenance: { kind: "declared" },
        task: taskValueOf(echoTask),
    });
    assert.throws(
        () => openChildRun(store, { ...openOptions("delegate:same"), task: taskValueOf(echoTask) }),
        /must state its provenance/u,
    );
    assert.equal(second.inspection.opened_record_id, first.inspection.opened_record_id);
    assert.equal(second.handle.handle_id, first.handle.handle_id);
    assert.equal(store.readOwner(first.handle.handle_id).length, 1);
    for (const mutate of [
        { input: "other" },
        { supervisorId: "supervisor:other" },
        { budget: { maxTurns: 1 } },
        { grant: [] },
        { parent: rootParent({ budget: { maxTurns: 5 } }) },
        { parent: rootParent({ ceiling: [grantOf(["read"])] }) },
        { task: summaryTask, input: { topic: "x" } },
    ]) {
        assert.throws(
            () => openChildRun(store, { ...openOptions("delegate:same"), ...mutate }),
            DelegationCommandConflictError,
        );
    }
    assert.throws(
        () => openChildRun(store, { ...openOptions("delegate:same"), parent: first.handle }),
        DelegationCommandConflictError,
    );
    assert.equal(store.readOwner(first.handle.handle_id).length, 1);
});

test("reserved handle owner paths refuse raw appends and cut publication", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "reserved");
    using store = new SQLiteTraceStore(databasePath);
    const { handle, inspection } = openChildRun(store, openOptions("delegate:reserved"));
    const forged: StoreAppendRequest = {
        append_intent_id: "forged:append",
        batch: {
            groups: [
                {
                    owner_id: handle.handle_id,
                    records: [
                        {
                            body: { forged: true },
                            mode: "capture",
                            schema_ref: "shepherd.delegation.completion.v1",
                            witness_ref: ROOT_WITNESS_ID,
                        },
                    ],
                },
            ],
        },
    };
    assert.throws(() => store.append(forged), /reserved for child run handles/u);
    assert.throws(
        () =>
            store.publishCut({
                cut_id: "forged:cut",
                publisher_owner_id: handle.handle_id,
                target_owner_id: "run:other",
                through_record_id: inspection.opened_record_id,
            }),
        /reserved for child run handles/u,
    );
    assert.throws(
        () =>
            store.publishCut({
                cut_id: "forged:cut",
                target_owner_id: handle.handle_id,
                through_record_id: inspection.opened_record_id,
            }),
        TraceStoreError,
    );
    assert.equal(store.readOwner(handle.handle_id).length, 1);
    assert.equal(
        store.appendDelegationHandleRecord(handle.handle_id, "sha256:moved", forged).status,
        "head_moved",
    );
    assert.throws(
        () =>
            store.appendDelegationHandleRecord(handle.handle_id, inspection.opened_record_id, {
                ...forged,
                append_intent_id: createDelegationAppendIntentId("delegate:reserved", "opened"),
            }),
        AppendIntentConflictError,
    );
    assert.throws(
        () =>
            store.openDelegationHandle(handle.handle_id, {
                appendIntentId: "forged:open",
                build: () => {
                    throw new Error("a retained owner path must not be rebuilt");
                },
                parentHandleId: null,
                predecessor: null,
            }),
        /already retains records/u,
    );
    assert.equal(store.readOwner(handle.handle_id).length, 1);
    assert.equal(store.verifyIntegrity().ok, true);
});

test("a retained handle command replays its receipt regardless of the current head", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "replay");
    using store = new ReplayingStore(databasePath);
    const { handle } = openChildRun(store, openOptions("delegate:replay"));
    const ran = await runChildRun(store, {
        handle,
        provider: providerFor(echoTask, "hello", "hi"),
    });
    const [replay] = store.replays;
    assert.ok(replay !== undefined && replay.status === "replayed");
    assert.deepEqual(replay.receipt.record_ids, [ran.inspection.completion?.record_id]);
    assert.equal(store.readOwner(handle.handle_id).length, 2);
});

test("a handle whose retained opened record no longer matches is refused", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "rewritten");
    using store = new RewritingStore(databasePath);
    const { handle } = openChildRun(store, openOptions("delegate:rewritten"));
    store.rewrite = true;
    await assert.rejects(
        runChildRun(store, { handle, program: () => "never" }),
        DelegationEvidenceError,
    );
    assert.throws(
        () =>
            openChildRun(store, {
                ...openOptions("delegate:rewritten-child", { maxTurns: 1 }),
                parent: handle,
            }),
        DelegationEvidenceError,
    );
    store.rewrite = false;
    assert.equal(inspectChildRun(store, handle.handle_id).status, "ready");
    assert.equal(store.readOwner(handle.handle_id).length, 1);
});

test("a moved head refuses the completion without writing", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "head");
    using store = new MovedHeadStore(databasePath);
    const { handle } = openChildRun(store, openOptions("delegate:head"));
    await assert.rejects(
        runChildRun(store, { handle, provider: providerFor(echoTask, "hello", "hi") }),
        DelegationHeadConflictError,
    );
    const inspection = inspectChildRun(store, handle.handle_id);
    assert.equal(inspection.status, "settling");
    assert.equal(inspection.completion, null);
});

test("a crash between the child terminal and the completion is settled without re-execution", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "crash");
    using store = new SQLiteTraceStore(databasePath);
    const { handle } = openChildRun(store, openOptions("delegate:crash"));
    await executeTaskDurably(store, {
        budget: { maxTurns: 2 },
        input: "hello",
        provider: providerFor(echoTask, "hello", "recovered"),
        runId: handle.child_run_id,
        task: echoTask,
    });
    assert.equal(inspectChildRun(store, handle.handle_id).status, "settling");
    let invoked = 0;
    const ran = await runChildRun(store, {
        handle,
        program: () => {
            invoked += 1;
            return "never";
        },
    });
    assert.equal(invoked, 0);
    assert.equal(ran.inspection.completion?.execution_kind, "program");
    assert.deepEqual(ran.inspection.child?.outcome?.outcome.outcome, {
        status: "finished",
        value: "recovered",
    });

    using pending = new InterruptingCutStore(await temporaryDatabasePath(context, "pending"));
    const opened = openChildRun(pending, openOptions("delegate:pending"));
    await assert.rejects(
        executeTaskDurably(pending, {
            budget: { maxTurns: 2 },
            input: "hello",
            provider: providerFor(echoTask, "hello", "x"),
            runId: opened.handle.child_run_id,
            task: echoTask,
        }),
        /cut publication interrupted/u,
    );
    assert.equal(inspectChildRun(pending, opened.handle.handle_id).status, "settling");
    await assert.rejects(
        runChildRun(pending, { handle: opened.handle, program: () => "x" }),
        DelegationStatusError,
    );
});

test("handles are stable across reopen, read-only, and imported stores", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "reopen");
    let handleId: string;
    {
        using store = new SQLiteTraceStore(databasePath);
        const { handle } = openChildRun(store, openOptions("delegate:reopen"));
        await runChildRun(store, { handle, provider: providerFor(echoTask, "hello", "hi") });
        handleId = handle.handle_id;
    }
    using reopened = new SQLiteTraceStore(databasePath);
    const before = inspectChildRun(reopened, handleId);
    assert.equal(before.status, "settling");
    using readOnly = new SQLiteTraceStore(databasePath, { readOnly: true });
    assert.deepEqual(inspectChildRun(readOnly, handleId), before);
    using imported = new SQLiteTraceStore();
    imported.importTrace(reopened.exportTrace());
    assert.deepEqual(inspectChildRun(imported, handleId), before);
    assert.equal(imported.verifyIntegrity().ok, true);
});

test("options, tasks, parents, and handles are validated before any record", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "options");
    using store = new SQLiteTraceStore(databasePath);
    using other = new SQLiteTraceStore();
    const { handle } = openChildRun(store, openOptions("delegate:options"));
    const foreign = openChildRun(other, openOptions("delegate:options")).handle;
    for (const invalid of [
        null,
        { ...openOptions("x"), extra: true },
        { ...openOptions("x"), commandId: "" },
        { ...openOptions("x"), supervisorId: "" },
        { ...openOptions("x"), supervisorId: "s".repeat(257) },
        { ...openOptions("x"), task: { ...echoTask } },
        { ...openOptions("x"), task: { artifact: {}, artifact_lock: {} } },
        { ...openOptions("x"), input: 5 },
        { ...openOptions("x"), grant: null },
        { ...openOptions("x"), budget: { maxTurns: -1 } },
        { ...openOptions("x"), parent: { kind: "root" } },
        { ...openOptions("x"), parent: { ...rootParent(), budget: { extra: 1 } } },
        { ...openOptions("x"), parent: { ...handle } },
        { ...openOptions("x"), parent: foreign },
        { ...openOptions("x"), parent: null },
        { ...openOptions("x"), parent: { kind: "handle" } },
    ]) {
        assert.throws(() => openChildRun(store, invalid as never), TypeError);
    }
    for (const invalid of [
        null,
        { handle },
        { handle, program: () => null, provider: providerFor(echoTask, "hello", "x") },
        { handle, program: "not a function" },
        { handle, provider: {} },
        { handle, provider: null },
        { handle: { ...handle }, program: () => null },
        { handle: foreign, program: () => null },
    ]) {
        await assert.rejects(runChildRun(store, invalid as never), TypeError);
    }
    assert.throws(() => inspectChildRun(store, "run:other"), TypeError);
    assert.throws(() => inspectChildRun(store, handle.handle_id, { clock: 1 } as never), TypeError);
    assert.throws(
        () => inspectChildRun(store, `delegation:sha256:${"0".repeat(64)}`),
        /not retained/u,
    );
    assert.equal(inspectChildRun(store, handle.handle_id).status, "ready");
});

test("a grant or budget beyond the parent authority is refused before opening", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "authority");
    using store = new SQLiteTraceStore(databasePath);
    for (const options of [
        { grant: [grantOf(["read"], "repo:other")] },
        { budget: { maxTurns: 5 } },
        { budget: { maxEffects: 1 } },
        { budget: {} },
        {
            budget: { maxCostUsd: 3, maxTurns: 1 },
            parent: rootParent({ budget: { maxCostUsd: 2, maxTurns: 4 } }),
        },
    ]) {
        assert.throws(
            () => openChildRun(store, { ...openOptions("delegate:refused"), ...options }),
            DelegationAuthorityError,
        );
    }
    assert.equal(store.readOwner(`delegation:sha256:${"0".repeat(64)}`).length, 0);
    const opened = openChildRun(store, {
        ...openOptions("delegate:extra-metrics"),
        budget: { maxCostUsd: 1, maxTurns: 2 },
        grant: [grantOf(["read", "write"])],
    });
    assert.deepEqual(opened.inspection.budget.effective, { maxCostUsd: 1, maxTurns: 2 });
    assert.deepEqual(opened.inspection.authority.effective, [grantOf(["read", "write"])]);
});
