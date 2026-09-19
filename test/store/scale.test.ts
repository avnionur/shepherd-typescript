import assert from "node:assert/strict";
import { readFileSync, realpathSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { SQLiteTraceStore } from "../../src/index.ts";
import {
    buildKernelDataset,
    type KernelDatasetNaming,
    type KernelDatasetShape,
} from "../../tooling/benchmark/kernel-dataset.ts";

type ScaleConfiguration = {
    readonly defaultTier: string;
    readonly naming: KernelDatasetNaming;
    readonly temporaryDirectoryPrefix: string;
    readonly testTimeoutMilliseconds: number;
    readonly tierEnvironmentVariable: string;
    readonly tiers: Readonly<Record<string, KernelDatasetShape>>;
};

const configuration = JSON.parse(
    readFileSync(new URL("../../config/scale-verification.config.json", import.meta.url), "utf8"),
) as ScaleConfiguration;
const tierName = process.env[configuration.tierEnvironmentVariable] ?? configuration.defaultTier;
const shape = configuration.tiers[tierName];
assert.ok(shape, `unknown scale tier: ${tierName}`);

test(`scale tier ${tierName}: integrity, reads, GC, round trip, and maintenance hold at size`, {
    timeout: configuration.testTimeoutMilliseconds,
}, async (context) => {
    const directory = realpathSync(
        await mkdtemp(path.join(tmpdir(), configuration.temporaryDirectoryPrefix)),
    );
    context.after(() => rm(directory, { force: true, recursive: true }));
    const databasePath = path.join(directory, "trace.sqlite");
    const blobDirectory = path.join(directory, "blobs");
    using store = new SQLiteTraceStore(databasePath, { blobDirectory });
    const dataset = buildKernelDataset(store, blobDirectory, shape, configuration.naming);
    const expectedRecords = shape.owners * shape.recordsPerOwner + shape.deepChainRecords;
    assert.equal(dataset.recordCount, expectedRecords);
    assert.equal(dataset.cutIds.length, (shape.owners + 1) * shape.cutsPerOwner);

    // Root witness plus one semantic record per published cut.
    const integrity = store.verifyIntegrity();
    assert.deepEqual(integrity.issues, []);
    assert.equal(integrity.checked_record_count, expectedRecords + dataset.cutIds.length + 1);
    assert.equal(integrity.checked_cut_count, dataset.cutIds.length);
    assert.equal(store.verifyBlobs().checked_blob_count, shape.blobs);

    // Deep causal chains resolve without recursion limits, and owner reads see every record.
    const deepHead = dataset.heads.get(dataset.deepOwnerId) as string;
    const closure = store.readCausalClosure([deepHead]);
    assert.equal(Object.keys(closure.visible_records_by_id).length, shape.deepChainRecords);
    assert.equal(
        store.readOwner(dataset.deepOwnerId).length,
        shape.deepChainRecords + shape.cutsPerOwner,
    );
    for (const cutId of [dataset.cutIds[0], dataset.cutIds.at(-1)] as string[]) {
        const cut = store.readCut(cutId);
        const slice = store.resolveCut(cutId);
        assert.equal(slice.owner_paths[cut.target_owner_id]?.at(-1), cut.through_record_id);
    }
    assert.equal(
        store.listOwnersBySchema(dataset.schemaRef, shape.owners + 1, 0).length,
        shape.owners + 1,
    );

    // Blob garbage collection finds exactly the planted orphans and never registered content.
    const inspected = store.collectBlobOrphans();
    assert.deepEqual(inspected.orphan_blob_ids, dataset.orphanBlobIds);
    assert.equal(inspected.orphan_temporary_file_count, dataset.temporaryFileCount);
    assert.deepEqual(inspected.deleted_blob_ids, []);
    const deleted = store.collectBlobOrphans({ mode: "delete" });
    assert.deepEqual(deleted.deleted_blob_ids, dataset.orphanBlobIds);
    assert.equal(deleted.deleted_temporary_file_count, dataset.temporaryFileCount);
    const after = store.collectBlobOrphans();
    assert.deepEqual([after.orphan_blob_ids, after.orphan_temporary_file_count], [[], 0]);
    assert.equal(store.verifyBlobs().ok, true);
    for (const blobId of [dataset.blobIds[0], dataset.blobIds.at(-1)] as string[]) {
        assert.equal(store.readBlob(blobId)?.byteLength, shape.blobBytes);
    }

    // Native export and import round-trip byte-identically.
    const exported = store.exportTrace();
    {
        using imported = new SQLiteTraceStore(path.join(directory, "imported.sqlite"));
        const receipt = imported.importTrace(exported);
        assert.equal(receipt.imported_blob_count, shape.blobs);
        assert.equal(imported.exportTrace(), exported);
    }

    // Maintenance never changes semantic content.
    for (const mode of ["inspect", "checkpoint", "optimize", "vacuum"] as const) {
        const report = store.maintain({ mode });
        assert.equal(report.quick_check.ok, true, mode);
        assert.equal(store.exportTrace(), exported, `${mode} keeps the export byte-identical`);
    }
    assert.equal(store.verifyIntegrity().ok, true);
});
