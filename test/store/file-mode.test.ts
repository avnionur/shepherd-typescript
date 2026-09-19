import assert from "node:assert/strict";
import {
    chmodSync,
    existsSync,
    lstatSync,
    mkdirSync,
    readFileSync,
    statSync,
    symlinkSync,
    writeFileSync,
} from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { type TestContext, test } from "node:test";

import { ROOT_WITNESS_ID, SQLiteTaskRegistry, SQLiteTraceStore } from "../../src/index.ts";

const retention = (
    JSON.parse(readFileSync(new URL("../../protocol.config.json", import.meta.url), "utf8")) as {
        readonly retention: {
            readonly storeFiles: {
                readonly mode: string;
                readonly sidecarSuffixes: readonly string[];
            };
        };
    }
).retention;
const OWNER_ONLY = Number.parseInt(retention.storeFiles.mode, 8);
const LOOSE = 0o644;

async function directoryFor(context: TestContext): Promise<string> {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-file-mode-"));
    const previousUmask = process.umask(0o022);
    context.after(async () => {
        process.umask(previousUmask);
        await rm(directory, { force: true, recursive: true });
    });
    return directory;
}

function modeOf(filePath: string): number {
    return statSync(filePath).mode & 0o777;
}

function appendOne(store: SQLiteTraceStore, intent: string): void {
    store.append({
        append_intent_id: intent,
        batch: {
            groups: [
                {
                    owner_id: "owner:mode",
                    records: [
                        {
                            body: { intent },
                            mode: "capture",
                            schema_ref: "file-mode.event.v1",
                            witness_ref: ROOT_WITNESS_ID,
                        },
                    ],
                },
            ],
        },
    });
}

test("a new trace store database, WAL, and SHM are owner-only under a permissive umask", async (context) => {
    const directory = await directoryFor(context);
    const databasePath = path.join(directory, "trace.sqlite");
    using store = new SQLiteTraceStore(databasePath);
    appendOne(store, "intent:new");
    for (const suffix of ["", "-wal", "-shm"]) {
        assert.ok(existsSync(`${databasePath}${suffix}`), suffix);
        assert.equal(modeOf(`${databasePath}${suffix}`), OWNER_ONLY, suffix);
    }
    assert.ok(retention.storeFiles.sidecarSuffixes.includes("-wal"));
});

test("opening a writable store tightens an existing loose database and its sidecars", async (context) => {
    const directory = await directoryFor(context);
    const databasePath = path.join(directory, "trace.sqlite");
    {
        using store = new SQLiteTraceStore(databasePath);
        appendOne(store, "intent:first");
    }
    const holder = new DatabaseSync(databasePath);
    holder.exec("PRAGMA journal_mode = WAL");
    holder.exec("CREATE TABLE IF NOT EXISTS mode_probe(value)");
    holder.exec("INSERT INTO mode_probe VALUES (1)");
    for (const suffix of ["", "-wal", "-shm"]) {
        chmodSync(`${databasePath}${suffix}`, LOOSE);
    }
    {
        using readOnly = new SQLiteTraceStore(databasePath, { readOnly: true });
        assert.equal(readOnly.readOwner("owner:mode").length, 1);
        assert.equal(modeOf(databasePath), LOOSE);
    }
    using store = new SQLiteTraceStore(databasePath);
    holder.close();
    for (const suffix of ["", "-wal", "-shm"]) {
        if (existsSync(`${databasePath}${suffix}`)) {
            assert.equal(modeOf(`${databasePath}${suffix}`), OWNER_ONLY, suffix);
        }
    }
    assert.equal(modeOf(databasePath), OWNER_ONLY);
    appendOne(store, "intent:second");
    assert.equal(store.readOwner("owner:mode").length, 2);
});

test("task registry databases are created and tightened owner-only", async (context) => {
    const directory = await directoryFor(context);
    const databasePath = path.join(directory, "tasks.sqlite");
    {
        using registry = new SQLiteTaskRegistry(databasePath);
        assert.ok(registry.schemaVersion > 0);
    }
    assert.equal(modeOf(databasePath), OWNER_ONLY);
    chmodSync(databasePath, LOOSE);
    {
        using readOnly = new SQLiteTaskRegistry(databasePath, { readOnly: true });
        assert.ok(readOnly.schemaVersion > 0);
    }
    assert.equal(modeOf(databasePath), LOOSE);
    using registry = new SQLiteTaskRegistry(databasePath);
    assert.ok(registry.schemaVersion > 0);
    assert.equal(modeOf(databasePath), OWNER_ONLY);
});

test("non-file database targets are left to SQLite", async (context) => {
    const directory = await directoryFor(context);
    const occupied = path.join(directory, "occupied.sqlite");
    mkdirSync(occupied);
    assert.throws(
        () => new SQLiteTraceStore(occupied, { blobDirectory: path.join(directory, "blobs") }),
    );
    assert.throws(() => new SQLiteTraceStore(path.join(directory, "missing", "trace.sqlite")), {
        code: "ENOENT",
    });
    using memory = new SQLiteTraceStore();
    appendOne(memory, "intent:memory");
});

test("symbolic links at database and sidecar paths are never followed or changed", async (context) => {
    const directory = await directoryFor(context);
    const databasePath = path.join(directory, "trace.sqlite");
    {
        using store = new SQLiteTraceStore(databasePath);
        appendOne(store, "intent:first");
    }
    const outside = path.join(directory, "outside.txt");
    writeFileSync(outside, "");
    chmodSync(outside, LOOSE);
    symlinkSync(outside, `${databasePath}-journal`);
    {
        using store = new SQLiteTraceStore(databasePath);
        appendOne(store, "intent:second");
    }
    assert.equal(modeOf(outside), LOOSE);
    assert.equal(lstatSync(`${databasePath}-journal`).isSymbolicLink(), true);
});

test("creation and inspection failures other than an existing file or an absent sidecar are reported", async (context) => {
    const directory = await directoryFor(context);
    const locked = path.join(directory, "locked");
    mkdirSync(locked, { mode: 0o500 });
    try {
        assert.throws(
            () =>
                new SQLiteTraceStore(path.join(locked, "trace.sqlite"), {
                    blobDirectory: path.join(directory, "locked-blobs"),
                }),
            { code: "EACCES" },
        );
    } finally {
        chmodSync(locked, 0o700);
    }

    const databasePath = path.join(directory, "trace.sqlite");
    {
        using store = new SQLiteTraceStore(databasePath);
        appendOne(store, "intent:first");
    }
    writeFileSync(`${databasePath}-journal`, "", { mode: 0o200 });
    assert.throws(() => new SQLiteTraceStore(databasePath), { code: "EACCES" });
});
