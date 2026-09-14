import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import {
    openTraceSubscription,
    SQLiteTraceStore,
    SUPERVISION_COMPATIBILITY_VERSION,
    SUPERVISION_SUBSCRIPTION_LIMITS,
    SupervisionCursorConflictError,
    SupervisionSubscriptionOverflowError,
    TraceStoreError,
    type TraceSubscriptionDelivery,
} from "../../src/index.ts";
import { createTraceSubscriptionCursor } from "../../src/supervision/records.ts";
import { appendOwnerRecord, temporaryDatabasePath } from "./fixtures.ts";

const labelOf = (delivery: TraceSubscriptionDelivery | undefined) =>
    (delivery?.record.body as { readonly label?: string } | undefined)?.label;

test("ephemeral subscriptions replay canonical owners round-robin and deliver live appends", async () => {
    using store = new SQLiteTraceStore();
    appendOwnerRecord(store, "worker:b", "b0");
    appendOwnerRecord(store, "worker:a", "a0");
    appendOwnerRecord(store, "worker:a", "a1");
    const subscription = openTraceSubscription(store, {
        owners: ["worker:b", "worker:a"],
        pollIntervalMilliseconds: 1,
    });
    assert.equal(subscription.subscriptionId, null);
    assert.deepEqual(subscription.acknowledgedCursor.positions, [
        { next_ordinal: 0, owner_id: "worker:a" },
        { next_ordinal: 0, owner_id: "worker:b" },
    ]);
    assert.equal(
        subscription.acknowledgedCursor.compatibility_version,
        SUPERVISION_COMPATIBILITY_VERSION,
    );
    const first = await subscription.next();
    assert.equal(labelOf(first), "a0");
    assert.deepEqual(subscription.metrics(), {
        buffered_records: 2,
        delivered_records: 1,
        high_water_lag_records: 3,
        lag_records: 3,
    });
    assert.equal(labelOf(await subscription.next()), "b0");
    const third = await subscription.next();
    assert.equal(labelOf(third), "a1");
    assert.deepEqual(third?.cursor.positions, [
        { next_ordinal: 2, owner_id: "worker:a" },
        { next_ordinal: 1, owner_id: "worker:b" },
    ]);
    assert.equal(subscription.deliveredCursor, third?.cursor);
    const pending = subscription.next();
    appendOwnerRecord(store, "worker:b", "b1");
    assert.equal(labelOf(await pending), "b1");
    assert.deepEqual(subscription.acknowledge(third?.cursor as never), third?.cursor);
    subscription.close();
    assert.equal(await subscription.next(), undefined);
    assert.deepEqual(subscription.metrics().buffered_records, 0);
});

test("subscriptions start at head or an explicit cursor and refuse inconsistent cursors", async () => {
    using store = new SQLiteTraceStore();
    appendOwnerRecord(store, "worker:a", "old");
    const atHead = openTraceSubscription(store, { owners: ["worker:a"], start: "head" });
    appendOwnerRecord(store, "worker:a", "new");
    assert.equal(labelOf(await atHead.next()), "new");
    const explicit = openTraceSubscription(store, {
        owners: ["worker:a"],
        start: createTraceSubscriptionCursor([{ next_ordinal: 1, owner_id: "worker:a" }]),
    });
    assert.equal(labelOf(await explicit.next()), "new");
    assert.throws(
        () =>
            openTraceSubscription(store, {
                owners: ["worker:a"],
                start: createTraceSubscriptionCursor([{ next_ordinal: 9, owner_id: "worker:a" }]),
            }),
        SupervisionCursorConflictError,
    );
    assert.throws(
        () =>
            openTraceSubscription(store, {
                owners: ["worker:a"],
                start: createTraceSubscriptionCursor([{ next_ordinal: 0, owner_id: "worker:z" }]),
            }),
        (error) =>
            error instanceof SupervisionCursorConflictError && error.subscription_id === null,
    );
    assert.throws(
        () =>
            atHead.acknowledge(
                createTraceSubscriptionCursor([{ next_ordinal: 0, owner_id: "worker:z" }]),
            ),
        SupervisionCursorConflictError,
    );
    assert.throws(
        () =>
            atHead.acknowledge(
                createTraceSubscriptionCursor([{ next_ordinal: 0, owner_id: "worker:a" }]),
            ),
        SupervisionCursorConflictError,
    );
    atHead.close();
    explicit.close();
});

test("durable subscriptions resume strictly after the acknowledged cursor across reopen", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "durable");
    {
        using store = new SQLiteTraceStore(databasePath);
        for (const label of ["r0", "r1", "r2"]) {
            appendOwnerRecord(store, "worker:a", label);
        }
        const exported = store.exportTrace();
        const subscription = openTraceSubscription(store, {
            owners: ["worker:a"],
            subscriptionId: "observer:audit",
        });
        assert.equal(subscription.subscriptionId, "observer:audit");
        const first = (await subscription.next()) as TraceSubscriptionDelivery;
        const second = (await subscription.next()) as TraceSubscriptionDelivery;
        assert.equal(labelOf(second), "r1");
        assert.deepEqual(subscription.acknowledge(first.cursor), first.cursor);
        assert.deepEqual(subscription.acknowledge(first.cursor), first.cursor);
        assert.throws(
            () =>
                subscription.acknowledge(
                    createTraceSubscriptionCursor([{ next_ordinal: 3, owner_id: "worker:a" }]),
                ),
            SupervisionCursorConflictError,
        );
        assert.equal(store.exportTrace(), exported);
        assert.equal(store.verifyIntegrity().ok, true);
    }
    using reopened = new SQLiteTraceStore(databasePath);
    assert.throws(
        () =>
            openTraceSubscription(reopened, {
                owners: ["worker:b"],
                subscriptionId: "observer:audit",
            }),
        (error) =>
            error instanceof SupervisionCursorConflictError &&
            error.subscription_id === "observer:audit",
    );
    assert.throws(
        () =>
            openTraceSubscription(reopened, {
                owners: ["worker:a"],
                start: createTraceSubscriptionCursor([{ next_ordinal: 0, owner_id: "worker:a" }]),
                subscriptionId: "observer:audit",
            }),
        SupervisionCursorConflictError,
    );
    const resumed = openTraceSubscription(reopened, {
        owners: ["worker:a"],
        start: "origin",
        subscriptionId: "observer:audit",
    });
    assert.deepEqual(resumed.acknowledgedCursor.positions, [
        { next_ordinal: 1, owner_id: "worker:a" },
    ]);
    const redelivered = (await resumed.next()) as TraceSubscriptionDelivery;
    assert.equal(labelOf(redelivered), "r1");
    const last = (await resumed.next()) as TraceSubscriptionDelivery;
    assert.equal(labelOf(last), "r2");
    assert.throws(
        () =>
            resumed.acknowledge(
                createTraceSubscriptionCursor([{ next_ordinal: 0, owner_id: "worker:a" }]),
            ),
        SupervisionCursorConflictError,
    );
    resumed.acknowledge(last.cursor);
    const exact = openTraceSubscription(reopened, {
        owners: ["worker:a"],
        start: last.cursor,
        subscriptionId: "observer:audit",
    });
    assert.equal(exact.acknowledgedCursor.cursor_id, last.cursor.cursor_id);
    resumed.close();
    exact.close();
    assert.throws(
        () => reopened.acknowledgeTraceSubscription("observer:absent", last.cursor),
        TraceStoreError,
    );
    assert.throws(
        () =>
            reopened.acknowledgeTraceSubscription(
                "observer:audit",
                createTraceSubscriptionCursor([{ next_ordinal: 4, owner_id: "worker:a" }]),
            ),
        SupervisionCursorConflictError,
    );
});

test("bounded buffers apply backpressure and the fail overflow policy never drops records", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "overflow");
    using store = new SQLiteTraceStore(databasePath);
    for (const label of ["o0", "o1", "o2", "o3"]) {
        appendOwnerRecord(store, "worker:a", label);
    }
    const bounded = openTraceSubscription(store, {
        bufferCapacity: 2,
        overflow: { maxLagRecords: 10, policy: "backpressure" },
        owners: ["worker:a"],
    });
    await bounded.next();
    assert.equal(bounded.metrics().buffered_records, 1);
    bounded.close();
    const failing = openTraceSubscription(store, {
        overflow: { maxLagRecords: 2, policy: "fail" },
        owners: ["worker:a"],
        subscriptionId: "observer:slow",
    });
    await assert.rejects(
        failing.next(),
        (error) =>
            error instanceof SupervisionSubscriptionOverflowError &&
            error.lag_records === 4 &&
            error.max_lag_records === 2,
    );
    assert.equal(await failing.next(), undefined);
    const resumed = openTraceSubscription(store, {
        owners: ["worker:a"],
        subscriptionId: "observer:slow",
    });
    assert.equal(labelOf(await resumed.next()), "o0");
    resumed.close();
});

test("abort signals end iteration, including while waiting for new records", async () => {
    using store = new SQLiteTraceStore();
    appendOwnerRecord(store, "worker:a", "only");
    const controller = new AbortController();
    const subscription = openTraceSubscription(store, {
        owners: ["worker:a"],
        pollIntervalMilliseconds: 60_000,
        signal: controller.signal,
    });
    const labels: string[] = [];
    for await (const delivery of subscription) {
        labels.push(labelOf(delivery) as string);
        setTimeout(() => controller.abort(), 5);
    }
    assert.deepEqual(labels, ["only"]);
    const closing = openTraceSubscription(store, { owners: ["worker:a"], start: "head" });
    const waiting = closing.next();
    closing.close();
    assert.equal(await waiting, undefined);
    const aborted = new AbortController();
    aborted.abort();
    assert.equal(
        await openTraceSubscription(store, { owners: ["worker:a"], signal: aborted.signal }).next(),
        undefined,
    );
});

test("read-only stores accept ephemeral subscriptions and refuse durable ones", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "readonly");
    {
        using store = new SQLiteTraceStore(databasePath);
        appendOwnerRecord(store, "worker:a", "r0");
    }
    using readOnly = new SQLiteTraceStore(databasePath, { readOnly: true });
    const ephemeral = openTraceSubscription(readOnly, { owners: ["worker:a"] });
    assert.equal(labelOf(await ephemeral.next()), "r0");
    ephemeral.close();
    assert.throws(
        () =>
            openTraceSubscription(readOnly, {
                owners: ["worker:a"],
                subscriptionId: "observer:ro",
            }),
        /writable trace store/u,
    );
});

test("subscription options and cursors are validated", () => {
    using store = new SQLiteTraceStore();
    const tooMany = Array.from(
        { length: SUPERVISION_SUBSCRIPTION_LIMITS.maxOwners + 1 },
        (_, index) => `worker:${index}`,
    );
    const invalid: readonly unknown[] = [
        { owners: [] },
        { owners: ["worker:a", "worker:a"] },
        { owners: tooMany },
        { owners: [""] },
        { bufferCapacity: 0, owners: ["worker:a"] },
        {
            bufferCapacity: SUPERVISION_SUBSCRIPTION_LIMITS.maxBufferCapacity + 1,
            owners: ["worker:a"],
        },
        { overflow: { maxLagRecords: -1, policy: "fail" }, owners: ["worker:a"] },
        { overflow: { maxLagRecords: 1, policy: "drop" }, owners: ["worker:a"] },
        { owners: ["worker:a"], signal: {} },
        { owners: ["worker:a"], start: "tail" },
        { owners: ["worker:a"], start: { cursor_id: "x" } },
        { owners: ["worker:a"], subscriptionId: "" },
        { extra: true, owners: ["worker:a"] },
    ];
    for (const options of invalid) {
        assert.throws(() => openTraceSubscription(store, options as never), TypeError);
    }
    const cursor = createTraceSubscriptionCursor([
        { next_ordinal: 0, owner_id: "worker:b" },
        { next_ordinal: 0, owner_id: "worker:a" },
    ]);
    const subscription = openTraceSubscription(store, { owners: ["worker:a", "worker:b"] });
    const malformed: readonly unknown[] = [
        { ...cursor, cursor_id: `${cursor.cursor_id.slice(0, -1)}0` },
        { ...cursor, compatibility_version: "other" },
        { ...cursor, cursor_version: 99 },
        { ...cursor, positions: [...cursor.positions].reverse() },
        { ...cursor, positions: [cursor.positions[0], cursor.positions[0]] },
        { ...cursor, positions: [{ next_ordinal: -1, owner_id: "worker:a" }] },
    ];
    for (const value of malformed) {
        assert.throws(() => subscription.acknowledge(value as never), TypeError);
    }
    subscription.close();
});

test("integrity verification classifies corrupt durable subscription bookkeeping", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "integrity");
    {
        using store = new SQLiteTraceStore(databasePath);
        appendOwnerRecord(store, "worker:a", "r0");
        openTraceSubscription(store, {
            owners: ["worker:a"],
            subscriptionId: "observer:passing",
        }).close();
        openTraceSubscription(store, {
            owners: ["worker:a"],
            subscriptionId: "observer:corrupt",
        }).close();
    }
    const database = new DatabaseSync(databasePath);
    const passing = createTraceSubscriptionCursor([{ next_ordinal: 5, owner_id: "worker:a" }]);
    database
        .prepare(
            "UPDATE trace_subscriptions SET cursor_id = ?, cursor_json = ? WHERE subscription_id = ?",
        )
        .run(passing.cursor_id, JSON.stringify(passing), "observer:passing");
    database
        .prepare("UPDATE trace_subscriptions SET owners_json = ? WHERE subscription_id = ?")
        .run(JSON.stringify({ owner: "worker:a" }), "observer:corrupt");
    database.close();
    using store = new SQLiteTraceStore(databasePath);
    assert.deepEqual(
        store
            .verifyIntegrity()
            .issues.filter((issue) => issue.kind === "trace_subscription_mismatch"),
        [
            { kind: "trace_subscription_mismatch", subject_id: "observer:corrupt" },
            { kind: "trace_subscription_mismatch", subject_id: "observer:passing" },
        ],
    );
    assert.throws(
        () =>
            openTraceSubscription(store, {
                owners: ["worker:a"],
                subscriptionId: "observer:corrupt",
            }),
        /bookkeeping is corrupt/u,
    );
});
