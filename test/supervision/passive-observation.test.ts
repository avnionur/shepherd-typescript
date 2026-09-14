import assert from "node:assert/strict";
import { test } from "node:test";

import {
    deriveSupervisedDispatchId,
    deriveSupervisionContextChannelId,
    dispatchSupervisedEffect,
    emitScopeRecord,
    injectSupervisionContext,
    inspectSupervisedDispatch,
    openTraceSubscription,
    resolveSupervisedApproval,
    SQLiteTraceStore,
    SupervisionSubscriptionOverflowError,
    type TraceSubscription,
} from "../../src/index.ts";
import { registerAndClaim } from "../scope/fixtures.ts";
import {
    always,
    eventually,
    intentOf,
    interceptor,
    recordingHandlers,
    temporaryDatabasePath,
} from "./fixtures.ts";

const CHANNEL = "worker/guidance";
const DISPATCHES = ["effect:passive:allowed", "effect:passive:denied", "effect:passive:approved"];

test("worker traces are byte-identical with zero observers and with several passive observers", async (context) => {
    const unobserved = await runWorker(await temporaryDatabasePath(context, "unobserved"), false);
    const observed = await runWorker(await temporaryDatabasePath(context, "observed"), true);
    assert.equal(observed.archive, unobserved.archive);
    assert.deepEqual(observed.inspections, unobserved.inspections);
    assert.equal(observed.deliveredRecords > 0, true);
    assert.equal(observed.overflowed, true);
});

async function runWorker(
    databasePath: string,
    observe: boolean,
): Promise<{
    readonly archive: string;
    readonly deliveredRecords: number;
    readonly inspections: readonly unknown[];
    readonly overflowed: boolean;
}> {
    using store = new SQLiteTraceStore(databasePath);
    const { root, writer } = registerAndClaim(store);
    const owners = [
        root.scope_id,
        deriveSupervisionContextChannelId(CHANNEL),
        ...DISPATCHES.map(deriveSupervisedDispatchId),
    ];
    const observers: TraceSubscription[] = observe
        ? [
              openTraceSubscription(store, { owners, subscriptionId: "observer:audit" }),
              openTraceSubscription(store, {
                  bufferCapacity: 1,
                  owners,
                  pollIntervalMilliseconds: 1,
                  subscriptionId: "observer:slow",
              }),
              openTraceSubscription(store, { owners, pollIntervalMilliseconds: 1 }),
          ]
        : [];
    let deliveredRecords = 0;
    const consumers = observers.map(async (subscription) => {
        for await (const delivery of subscription) {
            deliveredRecords += 1;
            subscription.acknowledge(delivery.cursor);
        }
    });
    const failing = observe
        ? openTraceSubscription(store, { overflow: { maxLagRecords: 0, policy: "fail" }, owners })
        : undefined;

    const emitted = emitScopeRecord(store, {
        commandId: "scope-command:emit:plan",
        data: { plan: "update notes" },
        expectedHeadRecordId: root.head.record_id,
        nowMilliseconds: 1_500,
        writer,
    });
    const guidance = injectSupervisionContext(store, {
        channel: CHANNEL,
        citedRecordIds: [emitted.head.record_id],
        commandId: "context:passive",
        data: { hint: "write drafts only" },
        supervisorId: "supervisor:main",
    });
    let overflowed = false;
    if (failing !== undefined) {
        await failing.next().catch((error: unknown) => {
            overflowed = error instanceof SupervisionSubscriptionOverflowError;
        });
    }
    const handlers = recordingHandlers();
    await dispatchSupervisedEffect(store, {
        citedRecordIds: [guidance.record_id],
        claimId: "worker:1",
        commandId: DISPATCHES[0] as string,
        handlers,
        intent: intentOf(),
        interceptors: [
            interceptor(
                "policy:confine",
                always({
                    decision: "replace",
                    payload: { path: "drafts/notes.txt" },
                    reason: "confine writes",
                }),
            ),
            interceptor("policy:audit", always({ decision: "allow" }), { priority: 1 }),
        ],
    });
    await dispatchSupervisedEffect(store, {
        claimId: "worker:1",
        commandId: DISPATCHES[1] as string,
        handlers,
        intent: intentOf("irreversible", { path: "/" }),
        interceptors: [
            interceptor("policy:destructive", always({ decision: "deny", reason: "root path" })),
        ],
    });
    const approvedId = deriveSupervisedDispatchId(DISPATCHES[2] as string);
    const approving = dispatchSupervisedEffect(store, {
        claimId: "worker:1",
        commandId: DISPATCHES[2] as string,
        handlers,
        intent: intentOf("irreversible", { path: "drafts/publish.txt" }),
    });
    await eventually(
        () =>
            inspectSupervisedDispatch(store, { dispatchId: approvedId }).pending_approval !== null,
    );
    resolveSupervisedApproval(store, {
        approverId: "reviewer",
        commandId: "approval:passive",
        dispatchId: approvedId,
        reason: "publish reviewed",
        requestRecordId: inspectSupervisedDispatch(store, { dispatchId: approvedId })
            .pending_approval?.request_record_id as string,
        verdict: "approved",
    });
    await approving;

    const total = owners.reduce((sum, owner) => sum + store.readOwner(owner).length, 0);
    await eventually(() => !observe || deliveredRecords >= total * observers.length);
    for (const subscription of observers) {
        subscription.close();
    }
    await Promise.all(consumers);
    assert.equal(store.verifyIntegrity().ok, true);
    return {
        archive: store.exportTrace(),
        deliveredRecords,
        inspections: DISPATCHES.map((commandId) => {
            const inspection = inspectSupervisedDispatch(store, {
                dispatchId: deriveSupervisedDispatchId(commandId),
            });
            return {
                ...inspection,
                lease: inspection.lease === null ? null : { released: inspection.lease.released },
            };
        }),
        overflowed: observe ? overflowed : true,
    };
}
