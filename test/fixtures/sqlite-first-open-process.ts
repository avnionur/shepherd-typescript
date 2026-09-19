import { once } from "node:events";
import { writeSync } from "node:fs";
import { createInterface } from "node:readline";

import { createSQLiteStorageCoordinator } from "../../src/facades/operations.ts";
import { SQLiteTaskRegistry } from "../../src/facades/tasks.ts";
import { SQLiteTraceStore } from "../../src/facades/trace.ts";

// Opens one SQLite-backed handle after the parent releases every child at once, so the opens of
// a not-yet-existing database overlap as closely as process scheduling allows. Prints `opened`
// followed by the migrated schema version for handles that report one.
const [kind, databasePath] = process.argv.slice(2);
if (databasePath === undefined) {
    throw new TypeError("handle kind and database path are required");
}
const input = createInterface({ input: process.stdin });
writeSync(1, "ready\n");
await once(input, "line");
input.close();

let opened: string;
if (kind === "trace-store") {
    const store = new SQLiteTraceStore(databasePath);
    opened = `opened ${store.schemaVersion}`;
    store.close();
} else if (kind === "task-registry") {
    const registry = new SQLiteTaskRegistry(databasePath);
    opened = `opened ${registry.schemaVersion}`;
    registry.close();
} else if (kind === "storage-coordinator") {
    createSQLiteStorageCoordinator(databasePath).close();
    opened = "opened";
} else {
    throw new TypeError(`unknown handle kind ${String(kind)}`);
}
writeSync(1, `${opened}\n`);
