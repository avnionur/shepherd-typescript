import assert from "node:assert/strict";
import { realpathSync, unlinkSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { type TestContext, test } from "node:test";

import {
    ROOT_WITNESS_ID,
    SQLiteTraceStore,
    TraceStoreError,
    type TraceStoreMaintenanceOptions,
    TraceStoreReadOnlyError,
} from "../../src/index.ts";
import { kernelProtocolConfig } from "../../src/protocol/config.ts";
import { populateStoreForSchema } from "../../tooling/testing/store-schema-fixtures.ts";

const MAINTENANCE = kernelProtocolConfig.store.maintenance;

async function scratch(context: TestContext): Promise<string> {
    const directory = realpathSync(await mkdtemp(path.join(tmpdir(), "shepherd-maintain-")));
    context.after(() => rm(directory, { force: true, recursive: true }));
    return directory;
}

function populated(databasePath: string): SQLiteTraceStore {
    const store = new SQLiteTraceStore(databasePath);
    populateStoreForSchema(store, store.schemaVersion);
    for (let index = 0; index < 20; index += 1) {
        store.append({
            append_intent_id: `maintenance:${index}`,
            batch: {
                groups: [
                    {
                        owner_id: `run:maintenance-${index % 3}`,
                        records: [
                            {
                                body: { index, padding: "x".repeat(2_000) },
                                mode: "capture",
                                schema_ref: "example.maintenance.v1",
                                witness_ref: ROOT_WITNESS_ID,
                            },
                        ],
                    },
                ],
            },
        });
    }
    return store;
}

/** Adds and drops a scratch table so the database file has reclaimable freelist pages. */
function addFreelistPages(databasePath: string): void {
    const database = new DatabaseSync(databasePath);
    database.exec("CREATE TABLE maintenance_scratch (payload TEXT) STRICT");
    const insert = database.prepare("INSERT INTO maintenance_scratch(payload) VALUES (?)");
    for (let index = 0; index < 200; index += 1) insert.run("y".repeat(4_000));
    database.exec("DROP TABLE maintenance_scratch");
    database.close();
}

test("every maintenance mode leaves the native export byte-identical", async (context) => {
    const directory = await scratch(context);
    const databasePath = path.join(directory, "trace.sqlite");
    using store = populated(databasePath);
    const exported = store.exportTrace();
    addFreelistPages(databasePath);

    const inspected = store.maintain();
    assert.equal(inspected.mode, MAINTENANCE.defaultMode);
    assert.equal(inspected.after, inspected.before);
    assert.equal(inspected.checkpoint, null);
    assert.equal(inspected.optimized, false);
    assert.equal(inspected.vacuumed, false);
    assert.equal(inspected.schema_version, store.schemaVersion);
    assert.deepEqual(inspected.quick_check, { issues: [], ok: true, truncated: false });
    assert.ok(inspected.before.freelist_count > 0);
    assert.equal(
        inspected.before.database_bytes,
        inspected.before.page_count * inspected.before.page_size,
    );
    assert.ok(Object.isFrozen(inspected));
    assert.equal(store.exportTrace(), exported);

    const checkpointed = store.maintain({ mode: "checkpoint" });
    assert.equal(checkpointed.checkpoint?.busy, false);
    assert.equal(checkpointed.after.wal_bytes, 0);
    assert.equal(store.exportTrace(), exported);

    const optimized = store.maintain({ mode: "optimize" });
    assert.equal(optimized.optimized, true);
    assert.equal(optimized.checkpoint, null);
    assert.equal(store.exportTrace(), exported);

    const vacuumed = store.maintain({ mode: "vacuum" });
    assert.equal(vacuumed.vacuumed, true);
    assert.equal(vacuumed.after.freelist_count, 0);
    assert.ok(vacuumed.after.page_count < vacuumed.before.page_count);
    assert.equal(vacuumed.checkpoint?.busy, false);
    assert.equal(vacuumed.after.wal_bytes, 0);
    assert.equal(store.exportTrace(), exported);
    assert.equal(store.verifyIntegrity().ok, true);
    assert.equal(store.verifyBlobs().ok, true);
});

test("maintenance reports a pending write-ahead log and truncates it", async (context) => {
    const directory = await scratch(context);
    const databasePath = path.join(directory, "trace.sqlite");
    using store = populated(databasePath);
    // A second connection keeps SQLite from checkpointing the log on the writer's close.
    const reader = new DatabaseSync(databasePath, { readOnly: true });
    try {
        const before = store.maintain();
        assert.ok(before.before.wal_bytes > 0);
    } finally {
        reader.close();
    }
    const truncated = store.maintain({ mode: "checkpoint" });
    assert.ok(truncated.before.wal_bytes > 0);
    assert.deepEqual(truncated.checkpoint, { busy: false, checkpointed_frames: 0, wal_frames: 0 });
    assert.equal(truncated.after.wal_bytes, 0);
});

test("in-memory stores report no write-ahead log", () => {
    using store = new SQLiteTraceStore();
    const report = store.maintain({ mode: "vacuum" });
    assert.equal(report.before.wal_bytes, 0);
    assert.deepEqual(report.checkpoint, { busy: false, checkpointed_frames: 0, wal_frames: 0 });
});

test("maintenance is refused on read-only and closed handles", async (context) => {
    const directory = await scratch(context);
    const databasePath = path.join(directory, "trace.sqlite");
    populated(databasePath).close();
    using readOnly = new SQLiteTraceStore(databasePath, { readOnly: true });
    for (const mode of MAINTENANCE.modes) {
        assert.throws(
            () => readOnly.maintain({ mode }),
            (error: unknown) =>
                error instanceof TraceStoreReadOnlyError &&
                error instanceof TraceStoreError &&
                error.code === "TRACE_STORE_READ_ONLY",
        );
    }
    const closed = new SQLiteTraceStore();
    closed.close();
    assert.throws(() => closed.maintain(), TraceStoreError);
});

test("maintenance options are closed plain objects naming a configured mode", () => {
    using store = new SQLiteTraceStore();
    class Options {
        readonly mode = "inspect";
    }
    const accessor = {};
    Object.defineProperty(accessor, "mode", { enumerable: true, get: () => "inspect" });
    const invalid: readonly unknown[] = [
        null,
        "inspect",
        [],
        new Options(),
        { [Symbol("mode")]: "inspect" },
        { extra: true },
        accessor,
        { mode: "compact" },
        { mode: 1 },
    ];
    for (const options of invalid) {
        assert.throws(() => store.maintain(options as TraceStoreMaintenanceOptions), TypeError);
    }
    assert.equal(store.maintain(Object.create(null)).mode, MAINTENANCE.defaultMode);
});

test("quick_check defects are reported by inspect and refuse mutating modes", async (context) => {
    const directory = await scratch(context);
    const databasePath = path.join(directory, "trace.sqlite");
    new SQLiteTraceStore(databasePath).close();
    const database = new DatabaseSync(databasePath);
    database.exec("PRAGMA ignore_check_constraints = ON");
    const insert = database.prepare(
        "INSERT INTO owner_ordinals(owner_id, next_ordinal) VALUES (?, -1)",
    );
    for (let index = 0; index <= MAINTENANCE.quickCheckMaxIssues; index += 1) {
        insert.run(`owner:corrupt-${index}`);
    }
    database.close();

    using store = new SQLiteTraceStore(databasePath);
    const report = store.maintain({ mode: "inspect" });
    assert.equal(report.quick_check.ok, false);
    assert.equal(report.quick_check.truncated, true);
    assert.equal(report.quick_check.issues.length, MAINTENANCE.quickCheckMaxIssues);
    for (const mode of ["checkpoint", "optimize", "vacuum"] as const) {
        assert.throws(() => store.maintain({ mode }), /maintenance refused: quick_check/u);
    }
});

test("a missing write-ahead log file is reported as zero bytes", async (context) => {
    const directory = await scratch(context);
    const databasePath = path.join(directory, "trace.sqlite");
    using store = new SQLiteTraceStore(databasePath);
    // Throwaway store: unlinking the open log only removes its directory entry.
    unlinkSync(`${databasePath}${MAINTENANCE.walFileSuffix}`);
    assert.equal(store.maintain().before.wal_bytes, 0);
});
