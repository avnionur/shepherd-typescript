import { statSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";

import { kernelProtocolConfig } from "../protocol/config.ts";
import { TraceStoreError } from "./errors.ts";
import type {
    TraceStoreCheckpointReport,
    TraceStoreMaintenanceMode,
    TraceStoreMaintenanceOptions,
    TraceStoreMaintenanceReport,
    TraceStoreSpaceReport,
} from "./types.ts";

const MAINTENANCE = kernelProtocolConfig.store.maintenance;

/**
 * Runs one semantics-preserving maintenance pass over a writable store database.
 *
 * Every mode first runs a bounded SQLite `quick_check`; mutating modes refuse a database that
 * fails it. No mode changes a record, view, cut, append intent, or blob, so the native export is
 * byte-identical before and after.
 *
 * @param database - Open writable trace-store database.
 * @param schemaVersion - Migrated schema version of the handle.
 * @param options - Validated-at-entry maintenance request.
 * @returns Frozen quick-check, space, and operation report.
 * @throws {TraceStoreError} If a mutating mode finds a `quick_check` defect.
 * @throws {TypeError} If options are malformed or select an unconfigured mode.
 * @throws {Error} If SQLite cannot complete the operation, for example a busy vacuum.
 * @internal
 */
export function maintainTraceStore(
    database: DatabaseSync,
    schemaVersion: number,
    options: TraceStoreMaintenanceOptions,
): TraceStoreMaintenanceReport {
    const mode = normalizeMaintenanceMode(options);
    const before = readSpace(database);
    const quickCheck = runQuickCheck(database);
    if (mode !== "inspect" && !quickCheck.ok) {
        throw new TraceStoreError(
            `trace store maintenance refused: quick_check reported ${quickCheck.issues.length}${quickCheck.truncated ? "+" : ""} issue(s): ${quickCheck.issues.join("; ")}`,
        );
    }
    const optimized = mode === "optimize";
    if (optimized) {
        database.exec("PRAGMA optimize");
    }
    const vacuumed = mode === "vacuum";
    if (vacuumed) {
        database.exec("VACUUM");
    }
    const checkpoint = mode === "checkpoint" || vacuumed ? runCheckpoint(database) : null;
    return Object.freeze({
        after: mode === "inspect" ? before : readSpace(database),
        before,
        checkpoint,
        mode,
        optimized,
        quick_check: quickCheck,
        schema_version: schemaVersion,
        vacuumed,
    });
}

function normalizeMaintenanceMode(
    options: TraceStoreMaintenanceOptions,
): TraceStoreMaintenanceMode {
    if (
        options === null ||
        typeof options !== "object" ||
        Array.isArray(options) ||
        (Object.getPrototypeOf(options) !== Object.prototype &&
            Object.getPrototypeOf(options) !== null) ||
        Object.getOwnPropertySymbols(options).length > 0
    ) {
        throw new TypeError("trace store maintenance options must be a plain object");
    }
    const descriptors = Object.getOwnPropertyDescriptors(options);
    if (Object.keys(descriptors).some((key) => key !== "mode")) {
        throw new TypeError("trace store maintenance options contain an unsupported property");
    }
    const modeDescriptor = descriptors.mode;
    if (modeDescriptor !== undefined && !("value" in modeDescriptor)) {
        throw new TypeError("trace store maintenance mode must not be an accessor property");
    }
    const mode: unknown = modeDescriptor?.value ?? MAINTENANCE.defaultMode;
    if (typeof mode !== "string" || !(MAINTENANCE.modes as readonly string[]).includes(mode)) {
        throw new TypeError(
            `trace store maintenance mode must be one of: ${MAINTENANCE.modes.join(", ")}`,
        );
    }
    return mode as TraceStoreMaintenanceMode;
}

function runQuickCheck(database: DatabaseSync): TraceStoreMaintenanceReport["quick_check"] {
    const limit = MAINTENANCE.quickCheckMaxIssues;
    const lines = database
        .prepare(`PRAGMA quick_check(${limit + 1})`)
        .all()
        .map((row) => String(Object.values(row)[0]));
    const issues = lines.length === 1 && lines[0] === "ok" ? [] : lines;
    return Object.freeze({
        issues: Object.freeze(issues.slice(0, limit)),
        ok: issues.length === 0,
        truncated: issues.length > limit,
    });
}

function runCheckpoint(database: DatabaseSync): TraceStoreCheckpointReport {
    const row = database
        .prepare(`PRAGMA wal_checkpoint(${MAINTENANCE.walCheckpointMode})`)
        .get() as { readonly busy: number; readonly checkpointed: number; readonly log: number };
    // SQLite reports -1 frames for a database that is not in WAL mode, such as `:memory:`.
    return Object.freeze({
        busy: Number(row.busy) !== 0,
        checkpointed_frames: Math.max(0, Number(row.checkpointed)),
        wal_frames: Math.max(0, Number(row.log)),
    });
}

function readSpace(database: DatabaseSync): TraceStoreSpaceReport {
    const pageSize = readPragmaNumber(database, "page_size");
    const pageCount = readPragmaNumber(database, "page_count");
    const main = database
        .prepare("SELECT file FROM pragma_database_list WHERE name = 'main'")
        .get() as { readonly file: string };
    const walBytes =
        main.file === ""
            ? 0
            : (statSync(`${main.file}${MAINTENANCE.walFileSuffix}`, { throwIfNoEntry: false })
                  ?.size ?? 0);
    return Object.freeze({
        database_bytes: pageSize * pageCount,
        freelist_count: readPragmaNumber(database, "freelist_count"),
        page_count: pageCount,
        page_size: pageSize,
        wal_bytes: walBytes,
    });
}

function readPragmaNumber(database: DatabaseSync, pragma: string): number {
    const row = database.prepare(`PRAGMA ${pragma}`).get() as Record<string, unknown>;
    return Number(Object.values(row)[0]);
}
