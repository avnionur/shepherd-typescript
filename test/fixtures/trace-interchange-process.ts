import { readFileSync, writeFileSync } from "node:fs";

import { ROOT_WITNESS_ID, SQLiteTraceStore } from "../../src/index.ts";

const [mode, databasePath, archivePath] = process.argv.slice(2);
if (databasePath === undefined || archivePath === undefined) {
    throw new TypeError("mode, database path, and archive path are required");
}

const originalRequest = {
    append_intent_id: "intent:process-portable",
    batch: {
        groups: [
            {
                owner_id: "run:process-portable",
                records: [
                    {
                        body: { process_boundary: true },
                        mode: "capture" as const,
                        schema_ref: "example.process-portable.v1",
                        witness_ref: ROOT_WITNESS_ID,
                    },
                ],
            },
        ],
    },
};

if (mode === "export") {
    using store = new SQLiteTraceStore(databasePath);
    const receipt = store.append(originalRequest);
    const cut = store.publishCut({
        append_intent_id: "intent:process-portable-cut",
        cut_id: "cut:process-portable",
        target_owner_id: "run:process-portable",
        through_record_id: receipt.record_ids[0] ?? "",
    });
    const blob = store.putBlob(new TextEncoder().encode("process-portable blob"));
    writeFileSync(archivePath, store.exportTrace(), "utf8");
    process.stdout.write(
        JSON.stringify({ blob_id: blob.blob_id, cut, record_ids: receipt.record_ids }),
    );
} else if (mode === "import") {
    const archive = readFileSync(archivePath, "utf8");
    const decodedArchive = JSON.parse(archive) as { blobs: { blob_id: string }[] };
    const blobId = decodedArchive.blobs[0]?.blob_id;
    if (blobId === undefined) {
        throw new TypeError("process fixture archive must contain one blob");
    }
    const store = new SQLiteTraceStore(databasePath);
    const importReceipt = store.importTrace(archive);
    const replay = store.append(originalRequest);
    const cut = store.readCut("cut:process-portable");
    const resolved = store.resolveCut(cut.cut_id);
    const blob = store.readBlob(blobId);
    const exportedBeforeReopen = store.exportTrace();
    store.close();

    using reopened = new SQLiteTraceStore(databasePath);
    const archivePreservedOnReopen = reopened.exportTrace() === archive;
    const continued = reopened.append({
        append_intent_id: "intent:process-continued",
        batch: {
            groups: [
                {
                    owner_id: "run:process-portable",
                    records: [
                        {
                            body: { continued: true },
                            mode: "capture",
                            schema_ref: "example.process-portable.v1",
                            witness_ref: ROOT_WITNESS_ID,
                        },
                    ],
                },
            ],
        },
    });
    process.stdout.write(
        JSON.stringify({
            archive_preserved_before_reopen: exportedBeforeReopen === archive,
            archive_preserved_on_reopen: archivePreservedOnReopen,
            blob_id: blobId,
            blob_text: blob === undefined ? undefined : new TextDecoder().decode(blob),
            continued_range: continued.owner_ordinal_ranges.get("run:process-portable"),
            cut,
            import_receipt: importReceipt,
            replay_record_ids: replay.record_ids,
            resolved_owner_path: resolved.owner_paths["run:process-portable"],
        }),
    );
} else {
    throw new TypeError(`unknown fixture mode: ${mode}`);
}
