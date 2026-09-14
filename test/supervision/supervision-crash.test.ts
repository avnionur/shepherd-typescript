import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { type TestContext, test } from "node:test";

import {
    createEffectHandlerStack,
    deriveSupervisedDispatchId,
    dispatchSupervisedEffect,
    inspectSupervisedDispatch,
    openTraceSubscription,
    SQLiteTraceStore,
    SUPERVISION_INTERCEPTION_LIMITS,
    SupervisionLeaseConflictError,
    SupervisionMaterializationUncertainError,
    type TraceSubscriptionDelivery,
} from "../../src/index.ts";
import { appendOwnerRecord, intentOf, interceptor, temporaryDatabasePath } from "./fixtures.ts";

const FIXTURE = new URL("../fixtures/supervision-process.ts", import.meta.url).pathname;
const afterLease = () => Date.now() + SUPERVISION_INTERCEPTION_LIMITS.decisionLeaseMilliseconds + 1;

test("a dispatcher killed while an interceptor owns the decision lease resumes without re-deciding", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "crash-deciding");
    new SQLiteTraceStore(databasePath).close();
    const child = await runUntil(
        context,
        ["dispatch-deciding", databasePath, "effect:crash-deciding"],
        "deciding",
    );
    await kill(child);
    using store = new SQLiteTraceStore(databasePath);
    const dispatchId = deriveSupervisedDispatchId("effect:crash-deciding");
    const crashed = inspectSupervisedDispatch(store, { dispatchId });
    assert.equal(crashed.recovery, "decision_pending");
    assert.deepEqual(
        crashed.decisions.map((entry) => entry.interceptor_id),
        ["policy:first"],
    );
    assert.equal(crashed.lease?.claim_id, "dispatcher:crashed");
    let firstCalls = 0;
    const invoked: string[] = [];
    const options = {
        claimId: "dispatcher:replacement",
        commandId: "effect:crash-deciding",
        handlers: createEffectHandlerStack([
            {
                handle: () => {
                    invoked.push("handler");
                    return { ok: true, value: null };
                },
                handlerId: "handler:file",
                kind: "file.write",
            },
        ]),
        intent: intentOf(),
        interceptors: [
            interceptor("policy:first", () => {
                firstCalls += 1;
                return { decision: "allow" };
            }),
            interceptor("policy:hanging", () => ({ decision: "allow" }), {
                priority: 1,
                timeoutMilliseconds: 3_600_000,
            }),
        ],
    } as const;
    await assert.rejects(dispatchSupervisedEffect(store, options), SupervisionLeaseConflictError);
    const resumed = await dispatchSupervisedEffect(store, { ...options, clock: afterLease });
    assert.equal(firstCalls, 0);
    assert.deepEqual(invoked, ["handler"]);
    assert.equal(resumed.resolution?.disposition, "materialized");
    assert.equal(resumed.lease?.fencing_token, 2);
    assert.equal(store.verifyIntegrity().ok, true);
});

test("a dispatcher killed after admission is classified uncertain and never materializes twice", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "crash-materializing");
    new SQLiteTraceStore(databasePath).close();
    const child = await runUntil(
        context,
        ["dispatch-materializing", databasePath, "effect:crash-materializing"],
        "materializing",
    );
    await kill(child);
    using store = new SQLiteTraceStore(databasePath);
    const dispatchId = deriveSupervisedDispatchId("effect:crash-materializing");
    assert.equal(
        inspectSupervisedDispatch(store, { dispatchId }).recovery,
        "materialization_uncertain",
    );
    let invoked = 0;
    await assert.rejects(
        dispatchSupervisedEffect(store, {
            claimId: "dispatcher:replacement",
            clock: afterLease,
            commandId: "effect:crash-materializing",
            handlers: createEffectHandlerStack([
                {
                    handle: () => {
                        invoked += 1;
                        return { ok: true, value: null };
                    },
                    handlerId: "handler:file",
                    kind: "file.write",
                },
            ]),
            intent: intentOf(),
        }),
        SupervisionMaterializationUncertainError,
    );
    assert.equal(invoked, 0);
});

test("a subscriber killed after acknowledging resumes without duplicating or losing records", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "crash-subscriber");
    {
        using store = new SQLiteTraceStore(databasePath);
        for (const label of ["r0", "r1", "r2"]) {
            appendOwnerRecord(store, "worker:a", label);
        }
    }
    const child = await runUntil(
        context,
        ["subscribe", databasePath, "observer:crashed"],
        "delivered r1",
    );
    await kill(child);
    using store = new SQLiteTraceStore(databasePath);
    appendOwnerRecord(store, "worker:a", "r3");
    const resumed = openTraceSubscription(store, {
        owners: ["worker:a"],
        subscriptionId: "observer:crashed",
    });
    const labels: string[] = [];
    while (labels.length < 3) {
        const delivery = (await resumed.next()) as TraceSubscriptionDelivery;
        labels.push((delivery.record.body as { readonly label: string }).label);
        resumed.acknowledge(delivery.cursor);
    }
    resumed.close();
    assert.deepEqual(labels, ["r1", "r2", "r3"]);
    assert.deepEqual(resumed.acknowledgedCursor.positions, [
        { next_ordinal: 4, owner_id: "worker:a" },
    ]);
});

async function runUntil(
    context: TestContext,
    args: readonly string[],
    line: string,
): Promise<ChildProcess> {
    const child = spawn(process.execPath, [FIXTURE, ...args], {
        stdio: ["ignore", "pipe", "pipe"],
    });
    context.after(() => {
        if (child.exitCode === null && child.signalCode === null) {
            child.kill("SIGKILL");
        }
    });
    let output = "";
    let errors = "";
    child.stderr?.on("data", (chunk: Buffer) => {
        errors += chunk.toString();
    });
    while (!output.split("\n").includes(line)) {
        const [chunk] = (await Promise.race([
            once(child.stdout as NonNullable<typeof child.stdout>, "data"),
            once(child, "exit").then(() => {
                throw new Error(`fixture exited before ${line}: ${errors}`);
            }),
        ])) as [Buffer];
        output += chunk.toString();
    }
    return child;
}

async function kill(child: ChildProcess): Promise<void> {
    const exit = once(child, "exit");
    assert.equal(child.kill("SIGKILL"), true);
    const [, signal] = (await exit) as [number | null, NodeJS.Signals | null];
    assert.equal(signal, "SIGKILL");
}
