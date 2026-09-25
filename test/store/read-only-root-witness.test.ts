import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import { ROOT_WITNESS_ID, SQLiteTraceStore, TraceStoreError } from "../../src/index.ts";

test("a read-only open refuses a store whose root witness record was removed", async (context) => {
    const root = await mkdtemp(path.join(tmpdir(), "read-only-root-witness-"));
    context.after(() => rm(root, { force: true, recursive: true }));
    const database = path.join(root, "trace.sqlite");
    new SQLiteTraceStore(database).close();
    new SQLiteTraceStore(database, { readOnly: true }).close();
    const raw = new DatabaseSync(database);
    raw.exec("PRAGMA foreign_keys = OFF");
    raw.prepare("DELETE FROM records WHERE record_id = ?").run(ROOT_WITNESS_ID);
    raw.close();
    assert.throws(
        () => new SQLiteTraceStore(database, { readOnly: true }),
        (error: unknown) =>
            error instanceof TraceStoreError &&
            /read-only trace store root witness is unavailable/u.test(error.message),
    );
});
