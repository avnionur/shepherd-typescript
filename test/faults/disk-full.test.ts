import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import { SQLiteTraceStore, type StoreAppendRequest } from "../../src/index.ts";
import { recoverAfterKill } from "./recovery.ts";
import {
    appendRequestFor,
    blobContentFor,
    blobIdOf,
    cutIdFor,
    faultSeeds,
    faultSettings,
    fileSizeLimitUnitBytes,
    inspectHealth,
    runFaultProcess,
} from "./workload.ts";

const SQLITE_FULL = 13;
const SQLITE_IOERR_WRITE = 778;
const [seed = 0] = faultSeeds();
const settings = faultSettings.diskFull;

/** Opens a store and returns the connection it owns, so the test can set a page limit on it. */
function openWithConnection(databasePath: string): {
    readonly database: DatabaseSync;
    readonly store: SQLiteTraceStore;
} {
    const prepare = DatabaseSync.prototype.prepare;
    let captured: DatabaseSync | undefined;
    DatabaseSync.prototype.prepare = function capture(this: DatabaseSync, sql: string) {
        if (captured === undefined || !captured.isOpen) captured = this;
        return prepare.call(this, sql);
    };
    try {
        const store = new SQLiteTraceStore(databasePath);
        return { database: captured as DatabaseSync, store };
    } finally {
        DatabaseSync.prototype.prepare = prepare;
    }
}

function pageCount(database: DatabaseSync): number {
    return Number(
        (database.prepare("PRAGMA page_count").get() as { page_count: number }).page_count,
    );
}

function limitPages(database: DatabaseSync, pages: number): void {
    database.exec(`PRAGMA max_page_count = ${pages}`);
}

function isSqliteFull(error: unknown): boolean {
    return (
        error instanceof Error &&
        (error as Error & { code?: unknown }).code === "ERR_SQLITE_ERROR" &&
        (error as Error & { errcode?: unknown }).errcode === SQLITE_FULL
    );
}

function largeAppend(label: string, index: number): StoreAppendRequest {
    const request = appendRequestFor(seed, label, index);
    const [group] = request.batch.groups;
    return {
        append_intent_id: request.append_intent_id,
        batch: {
            groups: [
                {
                    owner_id: group?.owner_id as string,
                    records: Array.from({ length: 8 }, (_, position) => ({
                        body: { index, label, padding: "f".repeat(16_384), position },
                        mode: "capture" as const,
                        schema_ref: "example.fault.v1",
                        witness_ref: group?.records[0]?.witness_ref as string,
                    })),
                },
            ],
        },
    };
}

test("a full database (max_page_count) fails typed, writes nothing, and succeeds after the limit is raised", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-disk-full-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const databasePath = path.join(directory, "trace.sqlite");
    const { database, store } = openWithConnection(databasePath);
    context.after(() => store.close());
    const seedRequest = appendRequestFor(seed, "full-seed", 0);
    const seeded = store.append(seedRequest);
    const owner = seedRequest.batch.groups[0]?.owner_id as string;
    const golden = store.exportTrace();
    limitPages(database, pageCount(database) + settings.headroomPages);

    const outcomes: Record<string, string> = {};
    const attempt = (name: string, operation: () => unknown): void => {
        const before = store.exportTrace();
        assert.throws(operation, isSqliteFull, name);
        assert.equal(store.exportTrace(), before, `${name} left partial state`);
        assert.deepEqual(inspectHealth(store).issues, [], name);
        outcomes[name] = "refused-typed";
    };

    const append = largeAppend("full", 0);
    attempt("append", () => store.append(append));
    assert.equal(store.diagnoseAppend(append.append_intent_id).status, "retry_safe");

    const cutSpec = {
        cut_id: cutIdFor("full", 0),
        target_owner_id: owner,
        through_record_id: seeded.record_ids.at(-1) as string,
    };
    // Fill the free space left in existing pages with tiny appends, so the cut publication (one
    // more record) cannot fit either.
    limitPages(database, pageCount(database));
    let filled = 0;
    for (;;) {
        const fill = {
            append_intent_id: `intent:fault:fill:${filled}`,
            batch: {
                groups: [
                    {
                        owner_id: "run:fault:fill",
                        records: [
                            {
                                body: { f: filled },
                                mode: "capture" as const,
                                schema_ref: "example.fault.v1",
                                witness_ref: seedRequest.batch.groups[0]?.records[0]
                                    ?.witness_ref as string,
                            },
                        ],
                    },
                ],
            },
        };
        try {
            store.append(fill);
            filled += 1;
        } catch (error) {
            assert.ok(isSqliteFull(error), String(error));
            assert.equal(store.diagnoseAppend(fill.append_intent_id).status, "retry_safe");
            break;
        }
    }
    attempt("publishCut", () => store.publishCut(cutSpec));
    assert.equal(store.readOptionalCut(cutSpec.cut_id), undefined);

    const blobs = Array.from({ length: 64 }, (_, index) => blobContentFor(seed, "full", index));
    let blobFailure: unknown;
    for (const content of blobs) {
        try {
            store.putBlob(content);
        } catch (error) {
            blobFailure = error;
            assert.equal(store.readBlob(blobIdOf(content)), undefined);
            break;
        }
    }
    assert.ok(isSqliteFull(blobFailure), String(blobFailure));
    assert.deepEqual(inspectHealth(store).issues, []);
    outcomes.putBlob = "refused-typed";

    const importTarget = openWithConnection(path.join(directory, "import.sqlite"));
    context.after(() => importTarget.store.close());
    limitPages(importTarget.database, pageCount(importTarget.database));
    const pristine = importTarget.store.exportTrace();
    assert.throws(() => importTarget.store.importTrace(golden), isSqliteFull);
    assert.equal(importTarget.store.exportTrace(), pristine);
    outcomes.importTrace = "refused-typed";

    limitPages(database, settings.unlimitedPageCount);
    limitPages(importTarget.database, settings.unlimitedPageCount);
    store.append(append);
    assert.equal(store.diagnoseAppend(append.append_intent_id).status, "committed");
    assert.deepEqual(store.readCut(store.publishCut(cutSpec).cut_id).cut_id, cutSpec.cut_id);
    for (const content of blobs) {
        assert.equal(store.putBlob(content).blob_id, blobIdOf(content));
    }
    assert.deepEqual(store.collectBlobOrphans().orphan_blob_ids, []);
    assert.equal(store.maintain({ mode: "vacuum" }).vacuumed, true);
    importTarget.store.importTrace(golden);
    assert.equal(importTarget.store.exportTrace(), golden);
    assert.deepEqual(inspectHealth(store).issues, []);
    context.diagnostic(`max_page_count outcomes: ${JSON.stringify(outcomes)}`);
});

const posix = process.platform !== "win32";

// Node.js ignores SIGXFSZ, so a write past RLIMIT_FSIZE fails with EFBIG instead of killing the
// writer, and SQLite reports SQLITE_IOERR_WRITE for every operation. The limit is configured in
// bytes and converted to the unit `/bin/sh` uses for `ulimit -f` (512 or 1024 bytes by shell).
test("a writer past RLIMIT_FSIZE fails typed and the store recovers", {
    skip: posix ? false : "ulimit -f needs a POSIX shell",
    timeout: faultSettings.testTimeoutMilliseconds,
}, async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-file-size-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const outcomes: string[] = [];
    for (const operation of ["append", "blob", "vacuum", "backup"] as const) {
        const operationDirectory = path.join(directory, operation);
        const backupRoot = path.join(operationDirectory, "backups");
        await mkdir(backupRoot, { recursive: true });
        const databasePath = path.join(operationDirectory, "trace.sqlite");
        new SQLiteTraceStore(databasePath).close();
        const args = {
            backupRoot,
            databasePath,
            label: `fsize-${operation}`,
            operation,
            seed,
            stopAfterError: true,
        };
        const result = await runFaultProcess(args, {
            fileSizeLimitBytes: settings.fileSizeLimitBytes,
        });
        const failure = result.events.find((event) => event.event === "error");
        assert.ok(failure !== undefined, `no failure reported: ${result.stderr}`);
        assert.equal(result.status, 0, result.stderr);
        assert.deepEqual(
            { code: failure.code, errcode: failure.errcode },
            { code: "ERR_SQLITE_ERROR", errcode: SQLITE_IOERR_WRITE },
            JSON.stringify(failure),
        );
        const counts = await recoverAfterKill(args, result.events);
        outcomes.push(
            `${operation}: ${failure.name} ${failure.code}/${failure.errcode} after ${failure.index} operation(s), ${JSON.stringify(counts)}`,
        );
    }
    const unit = await fileSizeLimitUnitBytes(settings.fileSizeLimitBytes);
    context.diagnostic(
        `RLIMIT_FSIZE ${settings.fileSizeLimitBytes} bytes (ulimit -f unit ${unit} bytes) outcomes: ${outcomes.join("; ")}`,
    );
});
