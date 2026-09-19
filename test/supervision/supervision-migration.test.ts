import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import {
    dispatchSupervisedEffect,
    openTraceSubscription,
    SQLiteTraceStore,
} from "../../src/index.ts";
import {
    appendOwnerRecord,
    intentOf,
    recordingHandlers,
    temporaryDatabasePath,
} from "./fixtures.ts";

test("schema-nine stores upgrade to subscription and dispatch bookkeeping without changing records", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "migration");
    let exported: string;
    {
        using store = new SQLiteTraceStore(databasePath);
        appendOwnerRecord(store, "worker:a", "before-upgrade");
        exported = store.exportTrace();
    }
    const database = new DatabaseSync(databasePath);
    database.exec(`
        DROP TABLE replay_sessions;
        DROP TABLE supervised_dispatches;
        DROP TABLE trace_subscriptions;
        DELETE FROM schema_migrations WHERE version >= 10;
    `);
    database.close();
    using upgraded = new SQLiteTraceStore(databasePath);
    assert.equal(upgraded.schemaVersion, 13);
    assert.equal(upgraded.exportTrace(), exported);
    const subscription = openTraceSubscription(upgraded, {
        owners: ["worker:a"],
        subscriptionId: "observer:upgraded",
    });
    assert.deepEqual((await subscription.next())?.record.body, {
        label: "before-upgrade",
        owner: "worker:a",
    });
    subscription.close();
    const result = await dispatchSupervisedEffect(upgraded, {
        claimId: "dispatcher:1",
        commandId: "effect:upgraded",
        handlers: recordingHandlers(),
        intent: intentOf(),
    });
    assert.equal(result.resolution?.disposition, "materialized");
    assert.equal(upgraded.verifyIntegrity().ok, true);
});
