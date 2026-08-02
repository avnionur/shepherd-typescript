import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import { ROOT_WITNESS_ID, SQLiteTraceStore } from "../../src/index.ts";

const execFileAsync = promisify(execFile);

test("SQLiteTraceStore imports a complete archive without changing identity", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-import-test-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const source = new SQLiteTraceStore(path.join(directory, "source.sqlite"));
    const originalRequest = {
        append_intent_id: "intent:portable",
        batch: {
            groups: [
                {
                    owner_id: "run:portable",
                    records: [
                        {
                            body: { future_payload: ["preserved", 1] },
                            mode: "capture" as const,
                            schema_ref: "example.portable.v1",
                            witness_ref: ROOT_WITNESS_ID,
                        },
                    ],
                },
                {
                    owner_id: "run:secondary",
                    records: [
                        {
                            body: { secondary: true },
                            mode: "capture" as const,
                            schema_ref: "example.portable.v1",
                            witness_ref: ROOT_WITNESS_ID,
                        },
                    ],
                },
            ],
        },
    };
    const originalReceipt = source.append(originalRequest);
    source.publishCut({
        append_intent_id: "intent:portable-cut",
        cut_id: "cut:portable",
        target_owner_id: "run:portable",
        through_record_id: originalReceipt.record_ids[0] ?? "",
    });
    source.putBlob(new TextEncoder().encode("portable blob"));
    const archive = source.exportTrace();
    source.close();

    const targetPath = path.join(directory, "target.sqlite");
    const target = new SQLiteTraceStore(targetPath);
    assert.deepEqual(target.importTrace(archive), {
        imported_append_intent_count: 2,
        imported_blob_count: 1,
        imported_cut_count: 1,
        imported_record_count: 4,
        imported_record_view_count: 3,
    });
    assert.equal(target.exportTrace(), archive);
    assert.deepEqual(target.append(originalRequest), originalReceipt);
    assert.equal(target.verifyIntegrity().ok, true);
    target.close();

    using reopened = new SQLiteTraceStore(targetPath);
    assert.equal(reopened.exportTrace(), archive);
    const continued = reopened.append({
        append_intent_id: "intent:continued",
        batch: {
            groups: [
                {
                    owner_id: "run:portable",
                    records: [
                        {
                            body: { continued: true },
                            mode: "capture",
                            schema_ref: "example.portable.v1",
                            witness_ref: ROOT_WITNESS_ID,
                        },
                    ],
                },
            ],
        },
    });
    assert.deepEqual(continued.owner_ordinal_ranges.get("run:portable"), [2, 2]);
});

test("trace identity survives export, import, and reopen across processes", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-process-import-test-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const fixturePath = new URL("../fixtures/trace-interchange-process.ts", import.meta.url)
        .pathname;
    const archivePath = path.join(directory, "trace-archive.json");
    const sourceResult = await execFileAsync(process.execPath, [
        fixturePath,
        "export",
        path.join(directory, "source.sqlite"),
        archivePath,
    ]);
    const source = JSON.parse(sourceResult.stdout) as {
        blob_id: string;
        cut: { created_by_record_id: string };
        record_ids: string[];
    };
    const targetResult = await execFileAsync(process.execPath, [
        fixturePath,
        "import",
        path.join(directory, "target.sqlite"),
        archivePath,
    ]);
    const target = JSON.parse(targetResult.stdout) as {
        archive_preserved_before_reopen: boolean;
        archive_preserved_on_reopen: boolean;
        blob_id: string;
        blob_text: string;
        continued_range: [number, number];
        cut: { created_by_record_id: string };
        import_receipt: {
            imported_append_intent_count: number;
            imported_blob_count: number;
            imported_cut_count: number;
            imported_record_count: number;
            imported_record_view_count: number;
        };
        replay_record_ids: string[];
        resolved_owner_path: string[];
    };

    assert.equal(target.archive_preserved_before_reopen, true);
    assert.equal(target.archive_preserved_on_reopen, true);
    assert.equal(target.blob_id, source.blob_id);
    assert.equal(target.blob_text, "process-portable blob");
    assert.deepEqual(target.continued_range, [2, 2]);
    assert.equal(target.cut.created_by_record_id, source.cut.created_by_record_id);
    assert.deepEqual(target.import_receipt, {
        imported_append_intent_count: 2,
        imported_blob_count: 1,
        imported_cut_count: 1,
        imported_record_count: 3,
        imported_record_view_count: 2,
    });
    assert.deepEqual(target.replay_record_ids, source.record_ids);
    assert.deepEqual(target.resolved_owner_path, source.record_ids);
});
