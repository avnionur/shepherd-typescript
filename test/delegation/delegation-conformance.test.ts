import assert from "node:assert/strict";
import { test } from "node:test";

import {
    acceptChildRunResult,
    approveChildRunTask,
    type ChildRunHandle,
    type ChildRunSupervisorContextEntry,
    DelegationApprovalRequiredError,
    DelegationAuthorityError,
    DelegationSupervisorError,
    discardChildRun,
    handoffChildRun,
    injectChildRunContext,
    inspectChildRun,
    observeChildRun,
    openChildRun,
    projectChildRunResult,
    projectDelegationTree,
    ROOT_WITNESS_ID,
    retryChildRun,
    runChildRun,
    SQLiteTraceStore,
    type StoreAppendRequest,
    schema,
    type TaskValue,
    type TraceSubscriptionDelivery,
    task,
    taskValueOf,
} from "../../src/index.ts";
import { echoTask, grantOf, providerFor, summaryTask, temporaryDatabasePath } from "./fixtures.ts";

const LEAD = "supervisor:lead";
const REVIEWER = "supervisor:reviewer";
const WORKER = "supervisor:worker";
const ROOT = {
    budget: { maxTurns: 8 },
    ceiling: [grantOf(["read", "write"]), grantOf(["read"], "repo:docs")],
    kind: "root",
} as const;

/** Model-serviced planner whose output is the worker task as data. */
const plannerTask = task({
    input: schema.string(),
    instruction: "Define the worker task for the request.",
    name: "plan",
    output: schema.task(),
    version: "1",
});

/** Revised worker task: the summary task with a changed instruction and the same identity. */
const revisedSummaryTask = task({
    input: schema.object({ topic: schema.string() }),
    instruction: "Summarize the topic for engineers.",
    name: "summarize",
    output: schema.object({ text: schema.string() }),
    version: "1",
});

test("task-as-value conformance: accept a task as data, run, observe, discard, revise, inject, hand off, accept, and project on an imported archive", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "conformance");
    using store = new SQLiteTraceStore(databasePath);

    // A supervisor accepts a worker task as data: the planner emits a task value typed with
    // schema.task(), which the supervisor accepts and projects with the same schema.
    const planner = openChildRun(store, {
        budget: { maxTurns: 1 },
        commandId: "conformance:plan",
        grant: [],
        input: "summarize the release",
        parent: ROOT,
        supervisorId: LEAD,
        task: plannerTask,
    });
    await runChildRun(store, {
        handle: planner.handle,
        provider: providerFor(plannerTask, "summarize the release", taskValueOf(summaryTask)),
    });
    acceptChildRunResult(store, {
        commandId: "conformance:accept-plan",
        handle: planner.handle,
        supervisorId: LEAD,
    });
    const planned = projectChildRunResult(store, planner.handle.handle_id, {
        schema: schema.task(),
    });
    const workerValue = planned.value as TaskValue;
    assert.deepEqual(workerValue, taskValueOf(summaryTask));
    const plannerOutcome = inspectChildRun(store, planner.handle.handle_id).child?.outcome;
    assert.ok(plannerOutcome !== null && plannerOutcome !== undefined);
    const producer = { record_id: plannerOutcome.record_id, run_id: planner.handle.child_run_id };

    // Dynamic task code cannot bypass the execution boundary: a synthesized value carrying a
    // function or an extra key is refused before any record.
    const ownerCount = () =>
        store.listOwnersBySchema("shepherd.delegation.opened.v1", 100, 0, false).length;
    const handlesBefore = ownerCount();
    for (const [label, forged] of [
        ["function", { ...workerValue, artifact: { ...workerValue.artifact, run: () => 1 } }],
        ["extra key", { ...workerValue, code: "return 1" }],
    ] as const) {
        assert.throws(
            () =>
                openChildRun(store, {
                    budget: { maxTurns: 4 },
                    commandId: `conformance:forged:${label}`,
                    grant: [grantOf(["read"])],
                    input: { topic: "release" },
                    parent: ROOT,
                    provenance: { kind: "synthesized", producer },
                    supervisorId: LEAD,
                    task: forged as never,
                }),
            TypeError,
            label,
        );
    }
    assert.equal(ownerCount(), handlesBefore);

    // Run the worker task as data in a child under the root declaration, observing it.
    const worker = openChildRun(store, {
        budget: { maxTurns: 4 },
        commandId: "conformance:worker",
        grant: [grantOf(["read"])],
        input: { topic: "release" },
        parent: ROOT,
        provenance: { kind: "synthesized", producer },
        supervisorId: LEAD,
        task: workerValue,
    });
    assert.equal(worker.inspection.status, "approval_pending");
    await assert.rejects(
        runChildRun(store, { handle: worker.handle, program: () => ({ text: "never" }) }),
        DelegationApprovalRequiredError,
    );
    const observer = observe(store, worker.handle);
    approveChildRunTask(store, {
        commandId: "conformance:approve-worker",
        handle: worker.handle,
        supervisorId: LEAD,
        verdict: "approved",
    });
    const firstRun = await runChildRun(store, {
        handle: worker.handle,
        provider: providerFor(summaryTask, { topic: "release" }, { text: "a vague draft" }),
    });
    assert.equal(firstRun.inspection.status, "settling");
    assert.equal(firstRun.inspection.completion?.status, "finished");
    const retained = [
        ...store.readOwner(worker.handle.child_run_id),
        ...store.readOwner(worker.handle.handle_id),
    ];
    const deliveries = await observer.take(retained.length);
    assert.deepEqual(
        deliveries.map((delivery) => delivery.record.envelope.record_id).sort(),
        retained.map((record) => record.envelope.record_id).sort(),
    );
    observer.close();

    // Inspect the child's trace: the completion cites the child's terminal record and cut.
    const inspected = inspectChildRun(store, worker.handle.handle_id);
    assert.equal(inspected.child?.status, "committed");
    assert.equal(
        inspected.completion?.child_terminal_record_id,
        inspected.child?.lifecycle.terminal_record_id,
    );
    assert.equal(inspected.completion?.child_cut_id, inspected.child?.cut?.cut_id);
    assert.deepEqual(inspected.child?.outcome?.outcome.outcome, {
        status: "finished",
        value: { text: "a vague draft" },
    });

    // Discard and retry with an approved revised task value; the revised identity and the causal
    // replay point are explicit in the successor inspection.
    const discarded = discardChildRun(store, {
        commandId: "conformance:discard-worker",
        handle: worker.handle,
        reason: "the draft is too vague",
        supervisorId: LEAD,
    });
    const revisedValue = taskValueOf(revisedSummaryTask);
    const retry = retryChildRun(store, {
        commandId: "conformance:retry",
        handle: worker.handle,
        provenance: { changes: ["instruction"], kind: "revised", source: workerValue },
        supervisorId: LEAD,
        task: revisedValue,
    });
    assert.equal(retry.inspection.status, "approval_pending");
    assert.deepEqual(retry.inspection.provenance, {
        fields: ["instruction"],
        kind: "revised",
        source_task: workerValue,
    });
    assert.equal(retry.inspection.task.artifact_lock.task_id, workerValue.artifact_lock.task_id);
    assert.notEqual(
        retry.inspection.task.artifact_lock.artifact_digest,
        workerValue.artifact_lock.artifact_digest,
    );
    assert.deepEqual(retry.inspection.predecessor, {
        cut_id: retry.inspection.predecessor?.cut_id,
        decision_record_id: discarded.record_id,
        handle_id: worker.handle.handle_id,
    });
    const replayPoint = store.readCut(String(retry.inspection.predecessor?.cut_id));
    assert.equal(replayPoint.target_owner_id, worker.handle.handle_id);
    assert.equal(replayPoint.through_record_id, discarded.record_id);
    approveChildRunTask(store, {
        approverId: "reviewer:release",
        commandId: "conformance:approve-retry",
        handle: retry.handle,
        supervisorId: LEAD,
        verdict: "approved",
    });

    // Inject context that the retry consumes, citing the discarded attempt's outcome.
    const injected = injectChildRunContext(store, {
        citedRecordIds: [inspected.child?.outcome?.record_id as string],
        commandId: "conformance:inject",
        data: { avoid: "a vague draft", audience: "engineers" },
        handle: retry.handle,
        supervisorId: LEAD,
    });
    let consumed: readonly ChildRunSupervisorContextEntry[] = [];
    let grandchild: ChildRunHandle | null = null;
    const refusals: unknown[] = [];
    const retried = await runChildRun(store, {
        handle: retry.handle,
        program: async ({ handle, input, supervisor_context }) => {
            consumed = supervisor_context;
            const topic = (input as { readonly topic: string }).topic;
            // Nested meta-agent: a grandchild grant exceeding the child's effective authority is
            // refused, and the admitted grandchild's authority is bounded by the child's.
            for (const beyond of [
                { grant: [grantOf(["read"], "repo:docs")] },
                { budget: { maxTurns: 5 } },
            ]) {
                try {
                    openChildRun(store, {
                        budget: { maxTurns: 1 },
                        commandId: "conformance:grandchild-beyond",
                        grant: [],
                        input: topic,
                        parent: handle,
                        supervisorId: WORKER,
                        task: echoTask,
                        ...beyond,
                    });
                } catch (error) {
                    refusals.push(error);
                }
            }
            const opened = openChildRun(store, {
                budget: { maxTurns: 1 },
                commandId: "conformance:grandchild",
                grant: [grantOf(["read", "write"])],
                input: topic,
                parent: handle,
                supervisorId: WORKER,
                task: echoTask,
            });
            grandchild = opened.handle;
            await runChildRun(store, {
                handle: opened.handle,
                provider: providerFor(echoTask, topic, `${topic} notes`),
            });
            acceptChildRunResult(store, {
                commandId: "conformance:accept-grandchild",
                handle: opened.handle,
                supervisorId: WORKER,
            });
            const notes = projectChildRunResult(store, opened.handle.handle_id, {
                schema: schema.string(),
            });
            const [entry] = supervisor_context;
            const hint = (entry as ChildRunSupervisorContextEntry).data as {
                readonly audience: string;
            };
            return { text: `${notes.value} for ${hint.audience}` };
        },
    });
    assert.deepEqual(consumed, [
        {
            cited_record_ids: injected.inspection.injections[0]?.cited_record_ids,
            data: { audience: "engineers", avoid: "a vague draft" },
            record_id: injected.record_id,
        },
    ]);
    assert.deepEqual(retried.inspection.consumed_context?.consumed_record_ids, [
        injected.record_id,
    ]);
    assert.equal(retried.inspection.completion?.status, "finished");
    assert.equal(refusals.length, 2);
    assert.ok(refusals.every((error) => error instanceof DelegationAuthorityError));
    const admitted = grandchild as unknown as ChildRunHandle;
    assert.ok(admitted !== null);
    assert.deepEqual(admitted.authority, {
        ceiling: [grantOf(["read"])],
        effective: [grantOf(["read"])],
    });
    assert.equal(admitted.depth, 2);
    assert.deepEqual(admitted.budget, { ceiling: { maxTurns: 4 }, effective: { maxTurns: 1 } });
    assert.equal(store.readOwner(`delegation:sha256:${"0".repeat(64)}`).length, 0);

    // Hand the handle off to a successor supervisor who accepts the finished result.
    handoffChildRun(store, {
        commandId: "conformance:handoff",
        handle: retry.handle,
        reason: "review rotation",
        successorSupervisorId: REVIEWER,
        supervisorId: LEAD,
    });
    assert.throws(
        () =>
            acceptChildRunResult(store, {
                commandId: "conformance:accept-former",
                handle: retry.handle,
                supervisorId: LEAD,
            }),
        DelegationSupervisorError,
    );
    const accepted = acceptChildRunResult(store, {
        commandId: "conformance:accept-retry",
        handle: retry.handle,
        supervisorId: REVIEWER,
    });
    assert.equal(accepted.inspection.status, "accepted");
    assert.equal(accepted.inspection.supervisor_id, REVIEWER);

    // Project the typed value with a matching caller schema.
    const result = projectChildRunResult(store, retry.handle.handle_id, {
        schema: schema.object({ text: schema.string() }),
    });
    assert.deepEqual(result.value, { text: "release notes for engineers" });
    assert.equal(result.output_id, accepted.inspection.decision?.output_id);
    assert.throws(
        () => projectChildRunResult(store, retry.handle.handle_id, { schema: schema.string() }),
        TypeError,
    );

    // Meta-meta-agent isolation: grandchild records live only on their own owner paths and the
    // trees never expose them beyond the value their parent accepted.
    const grandchildRecordIds = [
        ...store.readOwner(admitted.handle_id),
        ...store.readOwner(admitted.child_run_id),
    ].map((record) => record.envelope.record_id);
    assert.ok(grandchildRecordIds.length >= 6);
    for (const recordId of grandchildRecordIds) {
        for (const view of store.readRecord(recordId)?.views ?? []) {
            assert.ok([admitted.handle_id, admitted.child_run_id].includes(view.owner_id));
        }
    }
    for (const record of [
        ...store.readOwner(retry.handle.handle_id),
        ...store.readOwner(retry.handle.child_run_id),
    ]) {
        const text = JSON.stringify(record.body);
        assert.ok(!text.includes(admitted.handle_id) && !text.includes(admitted.child_run_id));
        assert.ok(
            record.envelope.caused_by_record_ids.every(
                (cause) => !grandchildRecordIds.includes(cause),
            ),
        );
    }
    const trees = (source: SQLiteTraceStore) => ({
        lead: projectDelegationTree(source, { kind: "supervisor", supervisorId: LEAD }),
        retry: projectDelegationTree(source, { handleId: retry.handle.handle_id, kind: "handle" }),
        reviewer: projectDelegationTree(source, { kind: "supervisor", supervisorId: REVIEWER }),
        worker: projectDelegationTree(source, { kind: "supervisor", supervisorId: WORKER }),
    });
    const live = trees(store);
    assert.deepEqual(
        live.lead.entries.map((entry) => [entry.handle_id, entry.status]),
        [
            [planner.handle.handle_id, "accepted"],
            [worker.handle.handle_id, "discarded"],
        ].sort(),
    );
    assert.deepEqual(
        live.reviewer.entries.map((entry) => [entry.handle_id, entry.status, entry.result.value]),
        [[retry.handle.handle_id, "accepted", { text: "release notes for engineers" }]],
    );
    assert.deepEqual(
        live.retry.entries.map((entry) => [entry.handle_id, entry.depth, entry.result.value]),
        [[admitted.handle_id, 2, "release notes"]],
    );
    assert.deepEqual(live.worker.entries, []);

    // The exported archive imported into a fresh store yields identical inspections, trees, and
    // typed projections, and refuses mutation through handles minted elsewhere or raw appends.
    const handleIds = [
        planner.handle.handle_id,
        worker.handle.handle_id,
        retry.handle.handle_id,
        admitted.handle_id,
    ];
    const inspections = handleIds.map((handleId) => inspectChildRun(store, handleId));
    using imported = new SQLiteTraceStore();
    imported.importTrace(store.exportTrace());
    assert.deepEqual(
        handleIds.map((handleId) => inspectChildRun(imported, handleId)),
        inspections,
    );
    assert.deepEqual(trees(imported), live);
    assert.deepEqual(
        projectChildRunResult(imported, retry.handle.handle_id, {
            schema: schema.object({ text: schema.string() }),
        }),
        result,
    );
    assert.throws(
        () =>
            discardChildRun(imported, {
                commandId: "conformance:imported-discard",
                handle: planner.handle,
                reason: "x",
                supervisorId: LEAD,
            }),
        TypeError,
    );
    await assert.rejects(
        runChildRun(imported, { handle: retry.handle, program: () => null }),
        TypeError,
    );
    const forgedAppend: StoreAppendRequest = {
        append_intent_id: "conformance:forged-append",
        batch: {
            groups: [
                {
                    owner_id: retry.handle.handle_id,
                    records: [
                        {
                            body: { forged: true },
                            mode: "capture",
                            schema_ref: "shepherd.delegation.decision.v1",
                            witness_ref: ROOT_WITNESS_ID,
                        },
                    ],
                },
            ],
        },
    };
    assert.throws(() => imported.append(forgedAppend), /reserved for child run handles/u);
    assert.deepEqual(
        handleIds.map((handleId) => inspectChildRun(imported, handleId)),
        inspections,
    );
    assert.equal(imported.verifyIntegrity().ok, true);
    assert.equal(store.verifyIntegrity().ok, true);
});

function observe(store: SQLiteTraceStore, handle: ChildRunHandle) {
    const subscription = observeChildRun(store, {
        handle,
        pollIntervalMilliseconds: 1,
        subscriptionId: "observer:lead",
    });
    return {
        close: () => subscription.close(),
        take: async (count: number) => {
            const deliveries: TraceSubscriptionDelivery[] = [];
            while (deliveries.length < count) {
                deliveries.push((await subscription.next()) as TraceSubscriptionDelivery);
            }
            return deliveries;
        },
    };
}
