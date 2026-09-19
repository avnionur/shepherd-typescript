import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import {
    execRetryingBusy,
    isSQLiteBusyError,
    runInSQLiteTransaction,
} from "../../src/runtime/sqlite-transaction.ts";

const TRANSACTION_SQL = { begin: "BEGIN IMMEDIATE", commit: "COMMIT", rollback: "ROLLBACK" };

async function lockedDatabase(context: test.TestContext): Promise<{
    readonly holder: DatabaseSync;
    readonly waiter: DatabaseSync;
}> {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-sqlite-busy-test-"));
    const databasePath = path.join(directory, "busy.sqlite");
    const holder = new DatabaseSync(databasePath);
    holder.exec("CREATE TABLE items (value INTEGER) STRICT");
    holder.exec("BEGIN IMMEDIATE");
    const waiter = new DatabaseSync(databasePath, { timeout: 0 });
    context.after(async () => {
        waiter.close();
        holder.close();
        await rm(directory, { force: true, recursive: true });
    });
    return { holder, waiter };
}

test("isSQLiteBusyError matches SQLITE_BUSY and its extended codes only", async (context) => {
    const { waiter } = await lockedDatabase(context);
    let busy: unknown;
    try {
        waiter.exec("BEGIN IMMEDIATE");
    } catch (error) {
        busy = error;
    }
    assert.equal(isSQLiteBusyError(busy), true);
    // SQLITE_BUSY_SNAPSHOT is an extended SQLITE_BUSY code.
    assert.equal(isSQLiteBusyError(Object.assign(new Error("snapshot"), { errcode: 517 })), true);
    assert.equal(isSQLiteBusyError(Object.assign(new Error("full"), { errcode: 13 })), false);
    assert.equal(isSQLiteBusyError(Object.assign(new Error("odd"), { errcode: "5" })), false);
    assert.equal(isSQLiteBusyError(new Error("plain")), false);
    assert.equal(isSQLiteBusyError(null), false);
    assert.equal(isSQLiteBusyError("database is locked"), false);
});

test("execRetryingBusy retries SQLITE_BUSY until the statement succeeds", () => {
    let attempts = 0;
    const executed: string[] = [];
    const database = {
        exec(sql: string): void {
            attempts += 1;
            if (attempts < 3) {
                throw Object.assign(new Error("database is locked"), { errcode: 5 });
            }
            executed.push(sql);
        },
    };
    execRetryingBusy(database, "PRAGMA journal_mode = WAL", 1_000, () => 0);
    assert.equal(attempts, 3);
    assert.deepEqual(executed, ["PRAGMA journal_mode = WAL"]);
});

test("execRetryingBusy rethrows non-busy errors without retrying", () => {
    let attempts = 0;
    const failure = Object.assign(new Error("disk I/O error"), { errcode: 10 });
    const database = {
        exec(): void {
            attempts += 1;
            throw failure;
        },
    };
    assert.throws(() => execRetryingBusy(database, "PRAGMA journal_mode = WAL", 1_000), failure);
    assert.equal(attempts, 1);
});

test("execRetryingBusy stops at the busy timeout with the SQLite error", async (context) => {
    const { holder, waiter } = await lockedDatabase(context);
    let clock = 0;
    let attempts = 0;
    const counting = {
        exec(sql: string): void {
            attempts += 1;
            clock += 10;
            waiter.exec(sql);
        },
    };
    assert.throws(
        () => execRetryingBusy(counting, "BEGIN IMMEDIATE", 25, () => clock),
        (error: unknown) => isSQLiteBusyError(error),
    );
    assert.equal(attempts, 3);
    assert.throws(() => execRetryingBusy(waiter, "BEGIN IMMEDIATE", 0), /database is locked/u);
    holder.exec("COMMIT");
    execRetryingBusy(waiter, "BEGIN IMMEDIATE", 0);
    assert.equal(waiter.isTransaction, true);
    waiter.exec("ROLLBACK");
});

test("runInSQLiteTransaction commits results and rolls back failures", () => {
    const database = new DatabaseSync(":memory:");
    try {
        database.exec("CREATE TABLE items (value INTEGER) STRICT");
        const inserted = runInSQLiteTransaction(database, TRANSACTION_SQL, () =>
            database.prepare("INSERT INTO items(value) VALUES (1)").run(),
        );
        assert.equal(inserted.changes, 1);
        const failure = new Error("abort");
        assert.throws(
            () =>
                runInSQLiteTransaction(database, TRANSACTION_SQL, () => {
                    database.prepare("INSERT INTO items(value) VALUES (2)").run();
                    throw failure;
                }),
            failure,
        );
        assert.equal(database.isTransaction, false);
        assert.deepEqual(
            database
                .prepare("SELECT value FROM items")
                .all()
                .map(({ value }) => value),
            [1],
        );
    } finally {
        database.close();
    }
});
