import { DatabaseSync } from "node:sqlite";
import { assertNodeRuntime } from "./policy.ts";

/** Proves required SQLite defensive behavior in memory before storage setup. @internal */
export function assertSQLiteDefensiveSupport(defensive: true): void {
    assertNodeRuntime();
    if (typeof DatabaseSync.prototype.enableDefensive !== "function") {
        throw new Error("SQLite defensive support is unavailable");
    }
    const probe = new DatabaseSync(":memory:", { defensive });
    try {
        // SQLite defensive mode makes writes to schema_version a no-op on this empty database.
        probe.exec("PRAGMA schema_version = 1");
        const row = probe.prepare("PRAGMA schema_version").get() as { schema_version: number };
        if (row.schema_version !== 0) {
            throw new Error("SQLite defensive behavior is unavailable");
        }
    } finally {
        probe.close();
    }
}
