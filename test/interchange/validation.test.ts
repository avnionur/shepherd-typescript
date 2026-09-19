import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chmod, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import { ROOT_WITNESS_ID, SQLiteTraceStore, TraceStoreError } from "../../src/index.ts";
import { kernelProtocolConfig } from "../../src/protocol/config.ts";

test("trace import rejects incompatible and inconsistent archives without partial state", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-import-validation-test-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    using source = new SQLiteTraceStore(path.join(directory, "source.sqlite"));
    const recordId =
        source.append({
            append_intent_id: "intent:validation",
            batch: {
                groups: [
                    {
                        owner_id: "run:validation",
                        records: [
                            {
                                body: { portable: true },
                                mode: "capture",
                                schema_ref: "example.validation.v1",
                                witness_ref: ROOT_WITNESS_ID,
                            },
                        ],
                    },
                ],
            },
        }).record_ids[0] ?? "";
    source.publishCut({
        cut_id: "cut:validation",
        target_owner_id: "run:validation",
        through_record_id: recordId,
    });
    source.putBlob(new TextEncoder().encode("validated"));
    const validArchive = source.exportTrace();

    using target = new SQLiteTraceStore(path.join(directory, "target.sqlite"));
    const pristineArchive = target.exportTrace();
    assert.throws(() => target.importTrace(null as unknown as string), TypeError);
    assert.throws(() => target.importTrace("{"), TypeError);
    assert.throws(() => target.importTrace("null"), TypeError);
    assert.throws(() => target.importTrace("[]"), TypeError);

    const mutations: readonly ((archive: Record<string, unknown>) => void)[] = [
        (archive) => {
            archive.format = "future.trace.archive";
        },
        (archive) => {
            archive.format_version = 2;
        },
        (archive) => {
            archive.kernel_abi_version = "shepherd.kernel.abi.v1";
        },
        (archive) => {
            archive.canonical_version = "shepherd.kernel.canonical.v3";
        },
        (archive) => {
            archive.records = {};
        },
        (archive) => {
            archive.records = [null];
        },
        (archive) => {
            firstObject(archive, "records").extra = true;
        },
        (archive) => {
            firstObject(archive, "record_views").record_id = `sha256:${"f".repeat(64)}`;
        },
        (archive) => {
            firstObject(archive, "record_views").append_position = -1;
        },
        (archive) => {
            firstObject(archive, "append_intents").batch_digest = "invalid";
        },
        (archive) => {
            firstObject(archive, "append_intents").batch_digest = 1;
        },
        (archive) => {
            firstObject(archive, "append_intents").receipt_json = null;
        },
        (archive) => {
            firstObject(archive, "append_intents").receipt_json = "{}";
        },
        (archive) => {
            firstObject(archive, "cuts").through_owner_ordinal = 100;
        },
        (archive) => {
            firstObject(archive, "blobs").content_base64 = "not base64";
        },
        (archive) => {
            firstObject(archive, "blobs").content_base64 = 1;
        },
        (archive) => {
            firstObject(archive, "blobs").byte_length = -1;
        },
        (archive) => {
            (archive.records as unknown[]).splice(1, 1);
        },
        (archive) => {
            const records = archive.records as unknown[];
            records.push(structuredClone(records[0]));
        },
    ];
    for (const mutate of mutations) {
        const archive = JSON.parse(validArchive) as Record<string, unknown>;
        mutate(archive);
        assert.throws(() => target.importTrace(JSON.stringify(archive)), TypeError);
        assert.equal(target.exportTrace(), pristineArchive);
    }

    assert.equal(target.importTrace(validArchive).imported_record_count, 3);
});

test("trace export rejects corrupt retained state and closes its read snapshot", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-export-validation-test-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const databasePath = path.join(directory, "trace.sqlite");
    using store = new SQLiteTraceStore(databasePath);
    const archive = store.exportTrace();
    const database = new DatabaseSync(databasePath);
    database.exec("PRAGMA foreign_keys = OFF");
    database.prepare("DELETE FROM records WHERE record_id = ?").run(ROOT_WITNESS_ID);
    database.close();

    assert.throws(() => store.exportTrace(), TraceStoreError);
    assert.throws(() => store.importTrace(archive), TraceStoreError);
    assert.equal(store.schemaVersion > 0, true);
});

test("trace import rolls back target SQLite failures", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-import-rollback-test-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    using source = new SQLiteTraceStore(path.join(directory, "source.sqlite"));
    source.append({ append_intent_id: "intent:rollback", batch: { groups: [] } });
    source.putBlob(new TextEncoder().encode("rollback blob"));
    const archive = source.exportTrace();
    const targetPath = path.join(directory, "target.sqlite");
    using target = new SQLiteTraceStore(targetPath);
    const database = new DatabaseSync(targetPath);
    database.exec(`
        CREATE TRIGGER fail_trace_import
        BEFORE INSERT ON storage_receipts
        BEGIN
            SELECT RAISE(ABORT, 'injected import failure');
        END;
    `);

    assert.throws(() => target.importTrace(archive), /injected import failure/);
    database.exec("DROP TRIGGER fail_trace_import");
    database.close();
    assert.equal(
        (JSON.parse(target.exportTrace()) as { append_intents: unknown[] }).append_intents.length,
        0,
    );
});

test("trace import stages beside the target store, never in the OS temporary directory", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-import-staging-test-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    using source = new SQLiteTraceStore(path.join(directory, "source.sqlite"));
    source.putBlob(new TextEncoder().encode("staged beside the target"));
    const archive = source.exportTrace();
    const targetDirectory = path.join(directory, "target");
    await mkdir(targetDirectory);
    using target = new SQLiteTraceStore(path.join(targetDirectory, "trace.sqlite"));
    await chmod(targetDirectory, 0o500);
    try {
        // The staging directory is created in the target's directory, so a read-only target
        // directory refuses the import before anything is written.
        assert.throws(() => target.importTrace(archive), { code: "EACCES" });
    } finally {
        await chmod(targetDirectory, 0o700);
    }
    assert.equal(target.exportTrace() === archive, false);
    target.importTrace(archive);
    assert.equal(target.exportTrace(), archive);
    const prefix = kernelProtocolConfig.interchange.staging.directoryPrefix;
    assert.deepEqual(
        (await readdir(targetDirectory)).filter((name) => name.startsWith(prefix)),
        [],
    );
});

test("trace import requires a pristine target store", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-import-pristine-test-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    using source = new SQLiteTraceStore(path.join(directory, "source.sqlite"));
    const archive = source.exportTrace();
    using target = new SQLiteTraceStore(path.join(directory, "target.sqlite"));
    target.append({ append_intent_id: "intent:occupied", batch: { groups: [] } });
    const before = target.exportTrace();

    assert.throws(() => target.importTrace(archive), TraceStoreError);
    assert.equal(target.exportTrace(), before);
});

test("trace import derives owner counters independent of archive view order", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-import-view-order-test-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    using source = new SQLiteTraceStore(path.join(directory, "source.sqlite"));
    source.append({
        append_intent_id: "intent:view-order",
        batch: {
            groups: [
                {
                    owner_id: "run:view-order",
                    records: [
                        {
                            body: { position: 0 },
                            mode: "capture",
                            schema_ref: "example.view-order.v1",
                            witness_ref: ROOT_WITNESS_ID,
                        },
                        {
                            body: { position: 1 },
                            mode: "capture",
                            schema_ref: "example.view-order.v1",
                            witness_ref: ROOT_WITNESS_ID,
                        },
                    ],
                },
            ],
        },
    });
    const archive = JSON.parse(source.exportTrace()) as { record_views: unknown[] };
    archive.record_views.reverse();
    using target = new SQLiteTraceStore(path.join(directory, "target.sqlite"));

    target.importTrace(JSON.stringify(archive));
    const continued = target.append({
        append_intent_id: "intent:view-order-continued",
        batch: {
            groups: [
                {
                    owner_id: "run:view-order",
                    records: [
                        {
                            body: { position: 2 },
                            mode: "capture",
                            schema_ref: "example.view-order.v1",
                            witness_ref: ROOT_WITNESS_ID,
                        },
                    ],
                },
            ],
        },
    });
    assert.deepEqual(continued.owner_ordinal_ranges.get("run:view-order"), [2, 2]);
});

test("trace import checks pristineness after waiting for concurrent writers", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-import-concurrency-test-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    using source = new SQLiteTraceStore(path.join(directory, "source.sqlite"));
    const archive = source.exportTrace();
    const targetPath = path.join(directory, "target.sqlite");
    using target = new SQLiteTraceStore(targetPath);
    const child = spawn(
        process.execPath,
        [new URL("../fixtures/concurrent-archive-writer.ts", import.meta.url).pathname, targetPath],
        { stdio: ["ignore", "pipe", "pipe"] },
    );
    context.after(() => {
        if (child.exitCode === null && child.signalCode === null) {
            child.kill("SIGKILL");
        }
    });
    const [ready] = (await once(child.stdout, "data")) as [Buffer];
    assert.equal(ready.toString(), "ready\n");

    const exit = once(child, "exit");
    assert.throws(() => target.importTrace(archive), TraceStoreError);
    const [exitCode] = (await exit) as [number | null];
    assert.equal(exitCode, 0);
    const retained = JSON.parse(target.exportTrace()) as {
        append_intents: { append_intent_id: string }[];
    };
    assert.deepEqual(
        retained.append_intents.map(({ append_intent_id }) => append_intent_id),
        ["intent:concurrent"],
    );
});

function firstObject(archive: Record<string, unknown>, key: string): Record<string, unknown> {
    return (archive[key] as Record<string, unknown>[])[0] as Record<string, unknown>;
}
