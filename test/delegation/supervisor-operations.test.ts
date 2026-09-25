import assert from "node:assert/strict";
import { test } from "node:test";

import {
    composeChildRunRequest,
    createChildRunHandleId,
    createChildRunId,
    createDelegationOutputDigest,
    createDelegationRequestDigest,
} from "../../src/delegation/records.ts";
import {
    acceptChildRunResult,
    acknowledgeDurableTaskCancellation,
    approveChildRunTask,
    type ChildRunSupervisorContextEntry,
    DELEGATION_LIMITS,
    DelegationAuthorityError,
    DelegationCommandConflictError,
    DelegationHeadConflictError,
    DelegationStatusError,
    DelegationSupervisorError,
    DurableExecutionClaimFencedError,
    discardChildRun,
    handoffChildRun,
    injectChildRunContext,
    inspectChildRun,
    inspectDurableTaskExecution,
    type ModelProvider,
    type ModelRequest,
    observeChildRun,
    openChildRun,
    requestDurableTaskCancellation,
    retryChildRun,
    runChildRun,
    SQLiteTraceStore,
    type StoreAppendRequest,
    type TraceSubscriptionDelivery,
} from "../../src/index.ts";
import { kernelProtocolConfig } from "../../src/protocol/config.ts";
import { appendOwnerRecord } from "../supervision/fixtures.ts";
import {
    echoTask,
    grantOf,
    openOptions,
    providerFor,
    rootParent,
    summaryTask,
    temporaryDatabasePath,
} from "./fixtures.ts";

const LEAD = "supervisor:lead";
const NEXT = "supervisor:next";

class ObservingStartStore extends SQLiteTraceStore {
    claimId: string | null = null;
    fencingToken: number | null = null;

    override appendDurableExecutionStart(
        runId: string,
        claimId: string,
        fencingToken: number,
        nowMilliseconds = Date.now(),
        recoveryCommandRecordId: string | null = null,
    ) {
        const appended = super.appendDurableExecutionStart(
            runId,
            claimId,
            fencingToken,
            nowMilliseconds,
            recoveryCommandRecordId,
        );
        this.claimId = claimId;
        this.fencingToken = fencingToken;
        return appended;
    }
}

class RacingStore extends SQLiteTraceStore {
    failure: Error | null = null;
    race: (() => void) | null = null;

    override appendDelegationHandleRecord(
        handleId: string,
        expectedHeadRecordId: string,
        request: StoreAppendRequest,
    ) {
        const race = this.race;
        if (race !== null) {
            this.race = null;
            race();
        }
        const failure = this.failure;
        if (failure !== null) {
            this.failure = null;
            throw failure;
        }
        return super.appendDelegationHandleRecord(handleId, expectedHeadRecordId, request);
    }
}

function capturing(inner: ModelProvider, seen: ModelRequest[]): ModelProvider {
    return {
        descriptor: () => inner.descriptor(),
        invoke: (request, signal) => {
            seen.push(request);
            return inner.invoke(request, signal);
        },
    };
}

function schemaOf(delivery: TraceSubscriptionDelivery | undefined): string {
    return String(delivery?.record.envelope.schema_ref);
}

test("observation delivers handle and child records over both owners and resumes durably", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "observe");
    using store = new SQLiteTraceStore(databasePath);
    const handleId = createChildRunHandleId("delegate:observe");
    const childRunId = createChildRunId(handleId);
    const observer = observeChildRun(store, {
        handleId,
        pollIntervalMilliseconds: 1,
        subscriptionId: "observer:lead",
    });
    assert.equal(observer.subscriptionId, "observer:lead");
    assert.deepEqual(observer.acknowledgedCursor.positions, [
        { next_ordinal: 0, owner_id: childRunId },
        { next_ordinal: 0, owner_id: handleId },
    ]);
    const pending = observer.next();
    const { handle } = openChildRun(store, openOptions("delegate:observe"));
    const opened = await pending;
    assert.equal(schemaOf(opened), "shepherd.delegation.opened.v1");
    assert.equal(opened?.record.view.owner_id, handleId);
    await runChildRun(store, { handle, provider: providerFor(echoTask, "hello", "hi") });
    const retained = [...store.readOwner(childRunId), ...store.readOwner(handleId)];
    const deliveries: TraceSubscriptionDelivery[] = [opened as TraceSubscriptionDelivery];
    while (deliveries.length < retained.length) {
        deliveries.push((await observer.next()) as TraceSubscriptionDelivery);
    }
    assert.deepEqual(
        deliveries.map((delivery) => delivery.record.envelope.record_id).sort(),
        retained.map((record) => record.envelope.record_id).sort(),
    );
    assert.ok(deliveries.some((delivery) => delivery.record.view.owner_id === childRunId));
    assert.ok(
        deliveries.some((delivery) => schemaOf(delivery) === "shepherd.delegation.completion.v1"),
    );
    const acknowledged = deliveries[2] as TraceSubscriptionDelivery;
    observer.acknowledge(acknowledged.cursor);
    observer.close();
    assert.equal(await observer.next(), undefined);
    assert.equal(store.readOwner(handleId).length, 2);

    const resumed = observeChildRun(store, {
        handle,
        pollIntervalMilliseconds: 1,
        subscriptionId: "observer:lead",
    });
    assert.deepEqual(resumed.acknowledgedCursor, acknowledged.cursor);
    const next = await resumed.next();
    assert.equal(next?.record.envelope.record_id, deliveries[3]?.record.envelope.record_id);
    resumed.close();

    using readOnly = new SQLiteTraceStore(databasePath, { readOnly: true });
    const ephemeral = observeChildRun(readOnly, { handleId, start: "head" });
    assert.equal(ephemeral.subscriptionId, null);
    ephemeral.close();

    for (const invalid of [
        { handle, handleId },
        { pollIntervalMilliseconds: 1 },
        { handleId: "run:other" },
        { handleId: `scope:sha256:${"0".repeat(64)}` },
        { handle: { ...handle } },
        { handle, owners: [handleId] },
        null,
    ]) {
        assert.throws(() => observeChildRun(store, invalid as never), TypeError);
    }
});

test("injections are ordered, bounded, cited, idempotent, and consumed into the composed request", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "inject");
    using store = new SQLiteTraceStore(databasePath);
    const { handle, inspection } = openChildRun(store, openOptions("delegate:inject"));
    const other = openChildRun(store, openOptions("delegate:inject-other")).handle;
    const cited = [
        appendOwnerRecord(store, "worker:notes", "n0"),
        appendOwnerRecord(store, "worker:notes", "n1"),
    ];
    const first = injectChildRunContext(store, {
        citedRecordIds: [cited[0] as string],
        commandId: "inject:1",
        data: { hint: "short" },
        handle,
        supervisorId: LEAD,
    });
    assert.equal(first.handle, handle);
    assert.equal(first.inspection.head_record_id, first.record_id);
    assert.deepEqual(first.inspection.injections, [
        {
            cited_record_ids: [cited[0]],
            command_id: "inject:1",
            consumed: false,
            data: { hint: "short" },
            record_id: first.record_id,
            supervisor_id: LEAD,
        },
    ]);
    assert.equal(first.inspection.status, "ready");
    assert.deepEqual(store.readRecord(first.record_id)?.envelope.caused_by_record_ids, [
        inspection.opened_record_id,
        cited[0],
    ]);
    const repeat = injectChildRunContext(store, {
        citedRecordIds: [cited[0] as string],
        commandId: "inject:1",
        data: { hint: "short" },
        handle,
        supervisorId: LEAD,
    });
    assert.equal(repeat.record_id, first.record_id);
    assert.equal(store.readOwner(handle.handle_id).length, 2);
    for (const conflicting of [
        { citedRecordIds: [cited[0] as string], commandId: "inject:1", data: { hint: "long" } },
        { citedRecordIds: cited, commandId: "inject:1", data: { hint: "short" } },
        { citedRecordIds: cited, commandId: "delegate:inject", data: { hint: "short" } },
        { citedRecordIds: cited, commandId: "delegate:inject-other", data: { hint: "short" } },
    ]) {
        assert.throws(
            () => injectChildRunContext(store, { ...conflicting, handle, supervisorId: LEAD }),
            (error: unknown) =>
                error instanceof DelegationCommandConflictError &&
                error.handle_id === handle.handle_id &&
                error.command_id === conflicting.commandId,
        );
    }
    const second = injectChildRunContext(store, {
        citedRecordIds: cited,
        commandId: "inject:2",
        data: { hint: "cite both" },
        expectedHeadRecordId: first.record_id,
        handle,
        supervisorId: LEAD,
    });
    assert.equal(second.inspection.injections.length, 2);
    assert.throws(
        () =>
            injectChildRunContext(store, {
                citedRecordIds: cited,
                commandId: "inject:3",
                data: { hint: "stale" },
                expectedHeadRecordId: inspection.opened_record_id,
                handle,
                supervisorId: LEAD,
            }),
        (error: unknown) =>
            error instanceof DelegationHeadConflictError &&
            error.handle_id === handle.handle_id &&
            error.expected_head_record_id === inspection.opened_record_id,
    );
    assert.throws(
        () =>
            injectChildRunContext(store, {
                citedRecordIds: [`sha256:${"0".repeat(64)}`],
                commandId: "inject:missing",
                data: { hint: "x" },
                handle,
                supervisorId: LEAD,
            }),
        /not retained/u,
    );
    const onOther = injectChildRunContext(store, {
        citedRecordIds: cited,
        commandId: "inject:same-intent",
        data: { hint: "x" },
        handle: other,
        supervisorId: LEAD,
    });
    assert.equal(onOther.inspection.injections.length, 1);
    assert.throws(
        () =>
            injectChildRunContext(store, {
                citedRecordIds: cited,
                commandId: "inject:same-intent",
                data: { hint: "x" },
                handle,
                supervisorId: LEAD,
            }),
        DelegationCommandConflictError,
    );
    const tooMany = Array.from(
        { length: DELEGATION_LIMITS.maxCitedRecords + 1 },
        (_, index) => `sha256:${index.toString(16).padStart(64, "0")}`,
    );
    for (const invalid of [
        { citedRecordIds: [] },
        { citedRecordIds: tooMany },
        { citedRecordIds: [cited[0], cited[0]] },
        { citedRecordIds: ["record"] },
        { citedRecordIds: cited[0] },
        { data: null },
        { data: [] },
        { data: "text" },
        { supervisorId: "" },
        { supervisorId: "s".repeat(DELEGATION_LIMITS.maxSupervisorIdLength + 1) },
        { commandId: "" },
        { expectedHeadRecordId: "record" },
        { extra: true },
        { handle: { ...handle } },
        { handle: null },
    ]) {
        assert.throws(
            () =>
                injectChildRunContext(store, {
                    citedRecordIds: cited,
                    commandId: "inject:invalid",
                    data: { hint: "x" },
                    handle,
                    supervisorId: LEAD,
                    ...invalid,
                } as never),
            TypeError,
        );
    }
    assert.throws(() => injectChildRunContext(store, null as never), TypeError);
    assert.equal(store.readOwner(handle.handle_id).length, 3);

    const entries: ChildRunSupervisorContextEntry[] = [
        {
            cited_record_ids: [cited[0] as string],
            data: { hint: "short" },
            record_id: first.record_id,
        },
        { cited_record_ids: cited, data: { hint: "cite both" }, record_id: second.record_id },
    ];
    const composed = composeChildRunRequest("hello", entries);
    assert.deepEqual(composed, { input: "hello", supervisor_context: entries });
    const seen: ModelRequest[] = [];
    const ran = await runChildRun(store, {
        handle,
        provider: capturing(providerFor(echoTask, composed, "hi"), seen),
    });
    assert.equal(seen.length, 1);
    assert.deepEqual(seen[0]?.input, composed);
    assert.equal(seen[0]?.instruction, echoTask.instruction);
    assert.equal(ran.inspection.status, "settling");
    const consumed = ran.inspection.consumed_context;
    assert.ok(consumed !== null);
    assert.deepEqual(consumed.consumed_record_ids, [first.record_id, second.record_id]);
    assert.equal(consumed.request_digest, createDelegationRequestDigest(composed));
    assert.equal(consumed.supervisor_id, LEAD);
    assert.deepEqual(
        ran.inspection.injections.map((injection) => injection.consumed),
        [true, true],
    );
    const records = store.readOwner(handle.handle_id);
    assert.deepEqual(
        records.map((record) => record.envelope.schema_ref),
        [
            "shepherd.delegation.opened.v1",
            "shepherd.delegation.context.v1",
            "shepherd.delegation.context.v1",
            "shepherd.delegation.context.v1",
            "shepherd.delegation.completion.v1",
        ],
    );
    assert.deepEqual(records[3]?.envelope.caused_by_record_ids, [
        second.record_id,
        first.record_id,
    ]);
    assert.equal(records[3]?.body.phase, "consumed");
    const late = injectChildRunContext(store, {
        citedRecordIds: cited,
        commandId: "inject:late",
        data: { hint: "after start" },
        handle,
        supervisorId: LEAD,
    });
    assert.equal(late.inspection.injections[2]?.consumed, false);
    assert.equal(late.inspection.consumed_context?.record_id, consumed.record_id);
    const again = await runChildRun(store, { handle, program: () => "never" });
    assert.equal(again.inspection.completion?.record_id, ran.inspection.completion?.record_id);
    const discarded = discardChildRun(store, {
        commandId: "discard:inject",
        handle,
        reason: "retry with fresh context",
        supervisorId: LEAD,
    });
    assert.equal(discarded.inspection.status, "discarded");
    const successor = retryChildRun(store, {
        commandId: "delegate:inject:retry",
        handle,
        supervisorId: LEAD,
    });
    assert.deepEqual(successor.inspection.injections, []);
    assert.equal(successor.inspection.consumed_context, null);
    const plain: ModelRequest[] = [];
    await runChildRun(store, {
        handle: successor.handle,
        provider: capturing(providerFor(echoTask, "hello", "plain"), plain),
    });
    assert.deepEqual(plain[0]?.input, "hello");
    assert.deepEqual(
        store.readOwner(successor.handle.handle_id).map((record) => record.envelope.schema_ref),
        [
            "shepherd.delegation.opened.v1",
            kernelProtocolConfig.queries.cutSchemaRef,
            "shepherd.delegation.completion.v1",
        ],
    );
    assert.equal(inspectChildRun(store, successor.handle.handle_id).consumed_context, null);
    assert.equal(store.verifyIntegrity().ok, true);
});

test("a program-serviced child receives consumed context and later injections stay pending", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "inject-program");
    using store = new SQLiteTraceStore(databasePath);
    const { handle } = openChildRun(store, {
        ...openOptions("delegate:inject-program"),
        input: { topic: "release" },
        task: summaryTask,
    });
    const cited = appendOwnerRecord(store, "worker:notes", "p0");
    const injected = injectChildRunContext(store, {
        citedRecordIds: [cited],
        commandId: "inject:program:1",
        data: { audience: "engineers" },
        handle,
        supervisorId: LEAD,
    });
    let seen: readonly ChildRunSupervisorContextEntry[] = [];
    let during: string | null = null;
    const ran = await runChildRun(store, {
        handle,
        program: ({ input, supervisor_context }) => {
            seen = supervisor_context;
            during = injectChildRunContext(store, {
                citedRecordIds: [cited],
                commandId: "inject:program:during",
                data: { audience: "late" },
                handle,
                supervisorId: LEAD,
            }).record_id;
            return { text: `about ${(input as { topic: string }).topic}` };
        },
    });
    assert.deepEqual(seen, [
        {
            cited_record_ids: [cited],
            data: { audience: "engineers" },
            record_id: injected.record_id,
        },
    ]);
    assert.equal(Object.isFrozen(seen), true);
    assert.deepEqual(
        ran.inspection.injections.map((injection) => [injection.record_id, injection.consumed]),
        [
            [injected.record_id, true],
            [during, false],
        ],
    );
    assert.equal(ran.inspection.completion?.execution_kind, "program");
    assert.deepEqual(ran.inspection.consumed_context?.consumed_record_ids, [injected.record_id]);
    assert.equal(
        ran.inspection.consumed_context?.request_digest,
        createDelegationRequestDigest(composeChildRunRequest({ topic: "release" }, seen)),
    );
    const settled = discardChildRun(store, {
        commandId: "discard:program",
        handle,
        reason: "done",
        supervisorId: LEAD,
    });
    assert.equal(settled.inspection.head_record_id, settled.record_id);
    const successor = retryChildRun(store, {
        commandId: "delegate:inject-program:retry",
        handle,
        supervisorId: LEAD,
    });
    assert.deepEqual(successor.inspection.injections, []);
    assert.deepEqual(successor.inspection.input, { topic: "release" });
    assert.deepEqual(successor.inspection.task, ran.inspection.task);
});

test("injections are bounded by the configured count", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "inject-bound");
    using store = new SQLiteTraceStore(databasePath);
    const { handle } = openChildRun(store, openOptions("delegate:inject-bound"));
    const cited = appendOwnerRecord(store, "worker:notes", "b0");
    for (let index = 0; index < DELEGATION_LIMITS.maxInjections; index += 1) {
        injectChildRunContext(store, {
            citedRecordIds: [cited],
            commandId: `inject:bound:${index}`,
            data: { index },
            handle,
            supervisorId: LEAD,
        });
    }
    assert.throws(
        () =>
            injectChildRunContext(store, {
                citedRecordIds: [cited],
                commandId: "inject:bound:beyond",
                data: { index: -1 },
                handle,
                supervisorId: LEAD,
            }),
        (error: unknown) =>
            error instanceof DelegationStatusError &&
            error.status === "ready" &&
            error.handle_id === handle.handle_id,
    );
    const inspection = inspectChildRun(store, handle.handle_id);
    assert.equal(inspection.injections.length, DELEGATION_LIMITS.maxInjections);
    assert.equal(store.readOwner(handle.handle_id).length, DELEGATION_LIMITS.maxInjections + 1);
});

test("handoff transfers ownership and every later command must name the successor", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "handoff");
    using store = new SQLiteTraceStore(databasePath);
    const { handle, inspection } = openChildRun(store, openOptions("delegate:handoff"));
    assert.throws(
        () =>
            handoffChildRun(store, {
                commandId: "handoff:same",
                handle,
                successorSupervisorId: LEAD,
                supervisorId: LEAD,
            }),
        /must differ/u,
    );
    for (const invalid of [
        { successorSupervisorId: "" },
        { reason: "r".repeat(DELEGATION_LIMITS.maxReasonLength + 1) },
        { reason: 5 },
        { extra: 1 },
        { commandId: 1 },
    ]) {
        assert.throws(
            () =>
                handoffChildRun(store, {
                    commandId: "handoff:invalid",
                    handle,
                    successorSupervisorId: NEXT,
                    supervisorId: LEAD,
                    ...invalid,
                } as never),
            TypeError,
        );
    }
    assert.equal(store.readOwner(handle.handle_id).length, 1);
    const handed = handoffChildRun(store, {
        commandId: "handoff:1",
        handle,
        reason: "shift change",
        successorSupervisorId: NEXT,
        supervisorId: LEAD,
    });
    assert.equal(handed.inspection.supervisor_id, NEXT);
    assert.equal(handed.inspection.opened_supervisor_id, LEAD);
    assert.equal(handed.handle.supervisor_id, LEAD);
    assert.deepEqual(handed.inspection.handoffs, [
        {
            command_id: "handoff:1",
            reason: "shift change",
            record_id: handed.record_id,
            successor_id: NEXT,
            supervisor_id: LEAD,
        },
    ]);
    assert.deepEqual(store.readRecord(handed.record_id)?.envelope.caused_by_record_ids, [
        inspection.opened_record_id,
    ]);
    assert.equal(
        handoffChildRun(store, {
            commandId: "handoff:1",
            handle,
            reason: "shift change",
            successorSupervisorId: NEXT,
            supervisorId: LEAD,
        }).record_id,
        handed.record_id,
    );
    assert.throws(
        () =>
            handoffChildRun(store, {
                commandId: "handoff:1",
                handle,
                successorSupervisorId: NEXT,
                supervisorId: LEAD,
            }),
        DelegationCommandConflictError,
    );
    const cited = appendOwnerRecord(store, "worker:notes", "h0");
    const former = (error: unknown) =>
        error instanceof DelegationSupervisorError &&
        error.handle_id === handle.handle_id &&
        error.supervisor_id === LEAD &&
        error.current_supervisor_id === NEXT;
    assert.throws(
        () =>
            injectChildRunContext(store, {
                citedRecordIds: [cited],
                commandId: "inject:former",
                data: { hint: "x" },
                handle,
                supervisorId: LEAD,
            }),
        former,
    );
    assert.throws(
        () =>
            handoffChildRun(store, {
                commandId: "handoff:former",
                handle,
                successorSupervisorId: "supervisor:third",
                supervisorId: LEAD,
            }),
        former,
    );
    assert.throws(
        () =>
            discardChildRun(store, {
                commandId: "discard:former",
                handle,
                reason: "x",
                supervisorId: LEAD,
            }),
        former,
    );
    assert.throws(
        () =>
            approveChildRunTask(store, {
                commandId: "approve:former",
                handle,
                supervisorId: LEAD,
                verdict: "approved",
            }),
        former,
    );
    assert.throws(
        () =>
            acceptChildRunResult(store, {
                commandId: "accept:former",
                handle,
                supervisorId: "supervisor:unknown",
            }),
        DelegationStatusError,
    );
    assert.equal(store.readOwner(handle.handle_id).length, 2);
    const ran = await runChildRun(store, {
        handle,
        provider: providerFor(echoTask, "hello", "hi"),
    });
    assert.equal(ran.inspection.completion?.supervisor_id, NEXT);
    assert.equal(ran.inspection.supervisor_id, NEXT);
    assert.throws(
        () =>
            acceptChildRunResult(store, { commandId: "accept:former", handle, supervisorId: LEAD }),
        former,
    );
    const accepted = acceptChildRunResult(store, {
        commandId: "accept:next",
        handle,
        supervisorId: NEXT,
    });
    assert.equal(accepted.inspection.decision?.supervisor_id, NEXT);
    assert.throws(
        () =>
            handoffChildRun(store, {
                commandId: "handoff:decided",
                handle,
                successorSupervisorId: "supervisor:third",
                supervisorId: NEXT,
            }),
        (error: unknown) => error instanceof DelegationStatusError && error.status === "accepted",
    );
    const chain = openChildRun(store, openOptions("delegate:handoff-chain"));
    handoffChildRun(store, {
        commandId: "handoff:chain:1",
        handle: chain.handle,
        successorSupervisorId: NEXT,
        supervisorId: LEAD,
    });
    handoffChildRun(store, {
        commandId: "handoff:chain:2",
        handle: chain.handle,
        successorSupervisorId: "supervisor:third",
        supervisorId: NEXT,
    });
    const chained = inspectChildRun(store, chain.handle.handle_id);
    assert.equal(chained.supervisor_id, "supervisor:third");
    assert.deepEqual(
        chained.handoffs.map((handoff) => [handoff.supervisor_id, handoff.successor_id]),
        [
            [LEAD, NEXT],
            [NEXT, "supervisor:third"],
        ],
    );
    assert.equal(chained.handoffs[1]?.reason, null);
    assert.throws(
        () =>
            retryChildRun(store, {
                commandId: "delegate:handoff-chain:retry",
                handle: chain.handle,
                supervisorId: NEXT,
            }),
        DelegationSupervisorError,
    );
    assert.equal(store.verifyIntegrity().ok, true);
});

test("a live child must be cancelled through durable control before it can be discarded", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "discard-live");
    using store = new ObservingStartStore(databasePath);
    const { handle } = openChildRun(store, openOptions("delegate:discard-live"));
    let refused: unknown = null;
    const running = runChildRun(store, {
        handle,
        program: ({ handle: own }) => {
            assert.equal(inspectChildRun(store, own.handle_id).status, "running");
            try {
                discardChildRun(store, {
                    commandId: "discard:live",
                    handle: own,
                    reason: "stop",
                    supervisorId: LEAD,
                });
            } catch (error) {
                refused = error;
            }
            const started = inspectDurableTaskExecution(store, own.child_run_id).lifecycle
                .started_record_id;
            const fencingToken = store.fencingToken;
            const claimId = store.claimId;
            assert.ok(started !== null && fencingToken !== null && claimId !== null);
            const command = requestDurableTaskCancellation(store, {
                commandId: "cancel:live",
                expectedLifecycleRecordId: started,
                fencingToken,
                reason: "supervisor stop",
                runId: own.child_run_id,
            });
            const cancelled = acknowledgeDurableTaskCancellation(store, {
                cancelCommandRecordId: command.record_id,
                claimId,
                expectedLifecycleRecordId: started,
                fencingToken,
                runId: own.child_run_id,
            });
            assert.equal(cancelled.execution.outcome.outcome.status, "cancelled");
            return "late";
        },
    });
    await assert.rejects(running, DurableExecutionClaimFencedError);
    assert.ok(refused instanceof DelegationStatusError);
    assert.equal((refused as DelegationStatusError).status, "running");
    const settling = inspectChildRun(store, handle.handle_id);
    assert.equal(settling.status, "settling");
    assert.equal(settling.completion, null);
    assert.equal(settling.child?.outcome?.outcome.outcome.status, "cancelled");
    let invoked = 0;
    const completed = await runChildRun(store, {
        handle,
        program: () => {
            invoked += 1;
            return "never";
        },
    });
    assert.equal(invoked, 0);
    assert.equal(completed.inspection.completion?.status, "cancelled");
    assert.equal(completed.inspection.completion?.execution_kind, "program");
    assert.throws(
        () =>
            acceptChildRunResult(store, {
                commandId: "accept:cancelled",
                handle,
                supervisorId: LEAD,
            }),
        (error: unknown) => error instanceof DelegationStatusError && error.status === "settling",
    );
    const discarded = discardChildRun(store, {
        commandId: "discard:cancelled",
        handle,
        reason: "cancelled by supervisor",
        supervisorId: LEAD,
    });
    assert.equal(discarded.inspection.status, "discarded");
    assert.deepEqual(discarded.inspection.decision, {
        child_outcome_record_id: null,
        command_id: "discard:cancelled",
        kind: "discarded",
        output_id: null,
        reason: "cancelled by supervisor",
        record_id: discarded.record_id,
        supervisor_id: LEAD,
    });
    assert.deepEqual(store.readRecord(discarded.record_id)?.envelope.caused_by_record_ids, [
        completed.inspection.completion?.record_id,
    ]);
    assert.equal(
        discardChildRun(store, {
            commandId: "discard:cancelled",
            handle,
            reason: "cancelled by supervisor",
            supervisorId: LEAD,
        }).record_id,
        discarded.record_id,
    );
    const cited = appendOwnerRecord(store, "worker:notes", "d0");
    const terminal = (error: unknown) =>
        error instanceof DelegationStatusError && error.status === "discarded";
    assert.throws(
        () =>
            injectChildRunContext(store, {
                citedRecordIds: [cited],
                commandId: "inject:terminal",
                data: { hint: "x" },
                handle,
                supervisorId: LEAD,
            }),
        terminal,
    );
    assert.throws(
        () =>
            handoffChildRun(store, {
                commandId: "handoff:terminal",
                handle,
                successorSupervisorId: NEXT,
                supervisorId: LEAD,
            }),
        terminal,
    );
    assert.throws(
        () =>
            acceptChildRunResult(store, {
                commandId: "accept:terminal",
                handle,
                supervisorId: LEAD,
            }),
        terminal,
    );
    assert.throws(
        () =>
            discardChildRun(store, {
                commandId: "discard:terminal",
                handle,
                reason: "again",
                supervisorId: LEAD,
            }),
        terminal,
    );
    assert.throws(
        () =>
            approveChildRunTask(store, {
                commandId: "approve:terminal",
                handle,
                supervisorId: LEAD,
                verdict: "approved",
            }),
        DelegationStatusError,
    );
    const replayed = await runChildRun(store, { handle, program: () => "x" });
    assert.equal(replayed.inspection.completion?.status, "cancelled");
    assert.equal(replayed.inspection.status, "discarded");
    assert.equal(store.readOwner(handle.handle_id).length, 3);

    const ready = openChildRun(store, openOptions("delegate:discard-ready"));
    const readyDiscard = discardChildRun(store, {
        commandId: "discard:ready",
        handle: ready.handle,
        reason: "never started",
        supervisorId: LEAD,
    });
    assert.equal(readyDiscard.inspection.status, "discarded");
    assert.equal(readyDiscard.inspection.child, null);
    await assert.rejects(
        runChildRun(store, { handle: ready.handle, program: () => "x" }),
        (error: unknown) => error instanceof DelegationStatusError && error.status === "discarded",
    );
    assert.equal(store.readOwner(ready.handle.child_run_id).length, 0);
    for (const invalid of [
        { reason: "" },
        { reason: "r".repeat(DELEGATION_LIMITS.maxReasonLength + 1) },
        { reason: undefined },
        { extra: true },
    ]) {
        assert.throws(
            () =>
                discardChildRun(store, {
                    commandId: "discard:invalid",
                    handle: ready.handle,
                    reason: "x",
                    supervisorId: LEAD,
                    ...invalid,
                } as never),
            TypeError,
        );
    }
    assert.equal(store.verifyIntegrity().ok, true);
});

test("acceptance requires a finished child and retains the digest of the canonical output", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "accept");
    using store = new SQLiteTraceStore(databasePath);
    const { handle } = openChildRun(store, {
        ...openOptions("delegate:accept"),
        input: { topic: "release" },
        task: summaryTask,
    });
    assert.throws(
        () =>
            acceptChildRunResult(store, { commandId: "accept:early", handle, supervisorId: LEAD }),
        (error: unknown) => error instanceof DelegationStatusError && error.status === "ready",
    );
    for (const invalid of [{ extra: 1 }, { commandId: "" }, { supervisorId: 1 }, { handle: {} }]) {
        assert.throws(
            () =>
                acceptChildRunResult(store, {
                    commandId: "accept:invalid",
                    handle,
                    supervisorId: LEAD,
                    ...invalid,
                } as never),
            TypeError,
        );
    }
    const ran = await runChildRun(store, {
        handle,
        program: () => ({ text: "about release" }),
    });
    const outcome = ran.inspection.child?.outcome;
    assert.ok(outcome !== null && outcome !== undefined);
    const accepted = acceptChildRunResult(store, {
        commandId: "accept:1",
        handle,
        supervisorId: LEAD,
    });
    assert.equal(accepted.inspection.status, "accepted");
    assert.deepEqual(accepted.inspection.decision, {
        child_outcome_record_id: outcome.record_id,
        command_id: "accept:1",
        kind: "accepted",
        output_id: createDelegationOutputDigest({ text: "about release" }),
        reason: null,
        record_id: accepted.record_id,
        supervisor_id: LEAD,
    });
    assert.deepEqual(store.readRecord(accepted.record_id)?.envelope.caused_by_record_ids, [
        ran.inspection.completion?.record_id,
        outcome.record_id,
    ]);
    assert.equal(
        acceptChildRunResult(store, { commandId: "accept:1", handle, supervisorId: LEAD })
            .record_id,
        accepted.record_id,
    );
    const terminal = (error: unknown) =>
        error instanceof DelegationStatusError && error.status === "accepted";
    assert.throws(
        () => acceptChildRunResult(store, { commandId: "accept:2", handle, supervisorId: LEAD }),
        terminal,
    );
    assert.throws(
        () =>
            discardChildRun(store, {
                commandId: "discard:accepted",
                handle,
                reason: "x",
                supervisorId: LEAD,
            }),
        terminal,
    );
    assert.throws(
        () =>
            retryChildRun(store, {
                commandId: "delegate:accept:retry",
                handle,
                supervisorId: LEAD,
            }),
        terminal,
    );
    const replayed = await runChildRun(store, { handle, program: () => "never" });
    assert.equal(replayed.inspection.status, "accepted");
    assert.equal(store.readOwner(handle.handle_id).length, 3);

    const failed = openChildRun(store, openOptions("delegate:accept-failed"));
    const failure = await runChildRun(store, { handle: failed.handle, program: () => 42 });
    assert.equal(failure.inspection.completion?.status, "failed");
    assert.throws(
        () =>
            acceptChildRunResult(store, {
                commandId: "accept:failed",
                handle: failed.handle,
                supervisorId: LEAD,
            }),
        (error: unknown) => error instanceof DelegationStatusError && error.status === "settling",
    );
    assert.equal(store.readOwner(failed.handle.handle_id).length, 2);
    using reopened = new SQLiteTraceStore(databasePath);
    const persisted = inspectChildRun(reopened, handle.handle_id);
    assert.equal(
        persisted.decision?.output_id,
        createDelegationOutputDigest({ text: "about release" }),
    );
    assert.equal(persisted.status, "accepted");
});

test("retry opens a successor citing the discarded predecessor, its decision, and the retry cut", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "retry");
    using store = new SQLiteTraceStore(databasePath);
    const { handle, inspection } = openChildRun(store, {
        ...openOptions("delegate:retry"),
        input: { topic: "a" },
        task: summaryTask,
    });
    await runChildRun(store, { handle, program: () => ({ text: "a" }) });
    assert.throws(
        () =>
            retryChildRun(store, { commandId: "delegate:retry:early", handle, supervisorId: LEAD }),
        (error: unknown) => error instanceof DelegationStatusError && error.status === "settling",
    );
    assert.throws(
        () =>
            retryChildRun(store, {
                commandId: "delegate:retry:early",
                handle,
                provenance: { kind: "declared" },
                supervisorId: LEAD,
            }),
        /provenance can only accompany a supplied task/u,
    );
    for (const invalid of [
        { handle: { ...handle } },
        { extra: 1 },
        { commandId: "" },
        { supervisorId: "" },
    ]) {
        assert.throws(
            () =>
                retryChildRun(store, {
                    commandId: "delegate:retry:invalid",
                    handle,
                    supervisorId: LEAD,
                    ...invalid,
                } as never),
            TypeError,
        );
    }
    const discarded = discardChildRun(store, {
        commandId: "discard:retry",
        handle,
        reason: "wrong topic",
        supervisorId: LEAD,
    });
    assert.throws(
        () => retryChildRun(store, { commandId: "delegate:retry:2", handle, supervisorId: NEXT }),
        (error: unknown) =>
            error instanceof DelegationSupervisorError && error.current_supervisor_id === LEAD,
    );
    const successor = retryChildRun(store, {
        commandId: "delegate:retry:2",
        handle,
        supervisorId: LEAD,
    });
    const predecessor = successor.inspection.predecessor;
    assert.ok(predecessor !== null);
    assert.equal(predecessor.handle_id, handle.handle_id);
    assert.equal(predecessor.decision_record_id, discarded.record_id);
    assert.match(predecessor.cut_id, /^delegation-retry:sha256:[0-9a-f]{64}$/u);
    const cut = store.readCut(predecessor.cut_id);
    assert.equal(cut.target_owner_id, handle.handle_id);
    assert.equal(cut.through_record_id, discarded.record_id);
    assert.equal(cut.publisher_owner_id, successor.handle.handle_id);
    assert.equal(
        cut.created_by_record_id,
        store.readOwner(successor.handle.handle_id)[1]?.envelope.record_id,
    );
    assert.equal(successor.inspection.status, "ready");
    assert.equal(successor.inspection.depth, 1);
    assert.deepEqual(successor.inspection.parent, { kind: "root" });
    assert.deepEqual(successor.inspection.task, inspection.task);
    assert.deepEqual(successor.inspection.provenance, { kind: "declared" });
    assert.deepEqual(successor.inspection.input, { topic: "a" });
    assert.deepEqual(successor.inspection.grant, inspection.grant);
    assert.deepEqual(successor.inspection.budget, inspection.budget);
    assert.deepEqual(successor.inspection.authority, inspection.authority);
    assert.notEqual(successor.handle.handle_id, handle.handle_id);
    const records = store.readOwner(successor.handle.handle_id);
    assert.equal(records.length, 2);
    assert.deepEqual(records[0]?.envelope.caused_by_record_ids, [discarded.record_id]);
    assert.equal(records[1]?.body.cut_id, predecessor.cut_id);
    assert.equal(
        retryChildRun(store, { commandId: "delegate:retry:2", handle, supervisorId: LEAD }).handle
            .handle_id,
        successor.handle.handle_id,
    );
    assert.throws(
        () =>
            retryChildRun(store, {
                commandId: "delegate:retry:2",
                handle,
                input: { topic: "b" },
                supervisorId: LEAD,
            }),
        DelegationCommandConflictError,
    );
    const overridden = retryChildRun(store, {
        budget: { maxTurns: 1 },
        commandId: "delegate:retry:3",
        grant: [grantOf(["read", "write"])],
        handle,
        input: "x",
        supervisorId: LEAD,
        task: echoTask,
    });
    assert.deepEqual(overridden.inspection.task.artifact_lock, echoTask.artifactLock);
    assert.equal(overridden.inspection.input, "x");
    assert.deepEqual(overridden.inspection.grant, [grantOf(["read", "write"])]);
    assert.deepEqual(overridden.inspection.authority.effective, [grantOf(["read", "write"])]);
    assert.deepEqual(overridden.inspection.budget, {
        ceiling: { maxTurns: 4 },
        effective: { maxTurns: 1 },
    });
    assert.equal(overridden.inspection.predecessor?.decision_record_id, discarded.record_id);
    assert.throws(
        () =>
            retryChildRun(store, {
                commandId: "delegate:retry:4",
                grant: [grantOf(["read"], "repo:other")],
                handle,
                supervisorId: LEAD,
            }),
        DelegationAuthorityError,
    );
    assert.throws(
        () =>
            retryChildRun(store, {
                budget: { maxTurns: 9 },
                commandId: "delegate:retry:4",
                handle,
                supervisorId: LEAD,
            }),
        DelegationAuthorityError,
    );
    assert.throws(
        () =>
            retryChildRun(store, {
                commandId: "delegate:retry:4",
                handle,
                input: undefined,
                supervisorId: LEAD,
            }),
        TypeError,
    );
    assert.equal(store.readOwner(createChildRunHandleId("delegate:retry:4")).length, 0);
    const ran = await runChildRun(store, {
        handle: successor.handle,
        program: () => ({ text: "b" }),
    });
    assert.equal(ran.inspection.completion?.status, "finished");
    assert.equal(inspectChildRun(store, handle.handle_id).status, "discarded");

    const parent = openChildRun(store, openOptions("delegate:retry-parent"));
    const nested = openChildRun(store, {
        ...openOptions("delegate:retry-nested", { maxTurns: 1 }),
        parent: parent.handle,
    });
    discardChildRun(store, {
        commandId: "discard:nested",
        handle: nested.handle,
        reason: "x",
        supervisorId: LEAD,
    });
    const nestedSuccessor = retryChildRun(store, {
        commandId: "delegate:retry-nested:2",
        handle: nested.handle,
        supervisorId: LEAD,
    });
    assert.equal(nestedSuccessor.inspection.depth, 2);
    assert.equal(nestedSuccessor.inspection.parent.kind, "handle");
    assert.equal(
        (nestedSuccessor.inspection.parent as { readonly handle_id: string }).handle_id,
        parent.handle.handle_id,
    );
    assert.equal(store.readOwner(nestedSuccessor.handle.handle_id).length, 3);
    assert.deepEqual(
        inspectChildRun(store, nestedSuccessor.handle.handle_id),
        nestedSuccessor.inspection,
    );
    discardChildRun(store, {
        commandId: "discard:nested-successor",
        handle: nestedSuccessor.handle,
        reason: "x",
        supervisorId: LEAD,
    });
    discardChildRun(store, {
        commandId: "discard:parent",
        handle: parent.handle,
        reason: "x",
        supervisorId: LEAD,
    });
    assert.throws(
        () =>
            retryChildRun(store, {
                commandId: "delegate:retry-nested:3",
                handle: nestedSuccessor.handle,
                supervisorId: LEAD,
            }),
        (error: unknown) =>
            error instanceof DelegationStatusError &&
            error.handle_id === parent.handle.handle_id &&
            error.status === "discarded",
    );
    assert.equal(store.readOwner(createChildRunHandleId("delegate:retry-nested:3")).length, 0);
    using imported = new SQLiteTraceStore();
    imported.importTrace(store.exportTrace());
    assert.deepEqual(
        inspectChildRun(imported, successor.handle.handle_id),
        inspectChildRun(store, successor.handle.handle_id),
    );
    assert.equal(store.verifyIntegrity().ok, true);
});

test("a head that moves between inspection and append refuses the command without writing", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "head-moved");
    using store = new RacingStore(databasePath);
    const { handle, inspection } = openChildRun(store, openOptions("delegate:head-moved"));
    const cited = appendOwnerRecord(store, "worker:notes", "m0");
    store.race = () => {
        handoffChildRun(store, {
            commandId: "handoff:race",
            handle,
            successorSupervisorId: NEXT,
            supervisorId: LEAD,
        });
    };
    assert.throws(
        () =>
            injectChildRunContext(store, {
                citedRecordIds: [cited],
                commandId: "inject:raced",
                data: { hint: "x" },
                handle,
                supervisorId: LEAD,
            }),
        (error: unknown) =>
            error instanceof DelegationHeadConflictError &&
            error.expected_head_record_id === inspection.opened_record_id,
    );
    const moved = inspectChildRun(store, handle.handle_id);
    assert.equal(moved.supervisor_id, NEXT);
    assert.deepEqual(moved.injections, []);
    assert.equal(store.readOwner(handle.handle_id).length, 2);
    const injected = injectChildRunContext(store, {
        citedRecordIds: [cited],
        commandId: "inject:next",
        data: { hint: "x" },
        handle,
        supervisorId: NEXT,
    });
    store.race = () => {
        handoffChildRun(store, {
            commandId: "handoff:race-consumption",
            handle,
            successorSupervisorId: "supervisor:third",
            supervisorId: NEXT,
        });
    };
    await assert.rejects(
        runChildRun(store, { handle, provider: providerFor(echoTask, "hello", "hi") }),
        DelegationHeadConflictError,
    );
    const after = inspectChildRun(store, handle.handle_id);
    assert.equal(after.status, "ready");
    assert.equal(after.consumed_context, null);
    assert.equal(after.injections[0]?.record_id, injected.record_id);
    assert.equal(store.readOwner(handle.child_run_id).length, 0);
    assert.equal(store.readOwner(handle.handle_id).length, 4);
    store.failure = new RangeError("store unavailable");
    assert.throws(
        () =>
            handoffChildRun(store, {
                commandId: "handoff:failing",
                handle,
                successorSupervisorId: "supervisor:fourth",
                supervisorId: "supervisor:third",
            }),
        RangeError,
    );
    assert.equal(store.readOwner(handle.handle_id).length, 4);
    assert.equal(store.verifyIntegrity().ok, true);
});

test("the parent declaration and child inputs of a retry are validated like an opening", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "retry-parent");
    using store = new SQLiteTraceStore(databasePath);
    const { handle } = openChildRun(store, {
        ...openOptions("delegate:retry-root"),
        parent: rootParent({ budget: { maxCostUsd: 2, maxTurns: 4 } }),
        budget: { maxCostUsd: 1, maxTurns: 2 },
    });
    discardChildRun(store, {
        commandId: "discard:retry-root",
        handle,
        reason: "x",
        supervisorId: LEAD,
    });
    const successor = retryChildRun(store, {
        commandId: "delegate:retry-root:2",
        handle,
        supervisorId: LEAD,
    });
    assert.deepEqual(successor.inspection.budget, {
        ceiling: { maxCostUsd: 2, maxTurns: 4 },
        effective: { maxCostUsd: 1, maxTurns: 2 },
    });
    assert.throws(
        () =>
            retryChildRun(store, {
                budget: { maxTurns: 1 },
                commandId: "delegate:retry-root:3",
                handle,
                supervisorId: LEAD,
            }),
        DelegationAuthorityError,
    );
});
