import assert from "node:assert/strict";
import {
    copyFileSync,
    cpSync,
    mkdirSync,
    readFileSync,
    realpathSync,
    writeFileSync,
} from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { type TestContext, test } from "node:test";

import { BlobFilesystem } from "../../src/blob/filesystem.ts";
import {
    backupTraceStore,
    ROOT_WITNESS_ID,
    restoreTraceStoreBackup,
    SQLiteTraceStore,
    type TraceStoreBackupManifest,
    UnsupportedStoreSchemaError,
    verifyTraceStoreBackup,
} from "../../src/index.ts";
import { exportTraceArchive } from "../../src/interchange/export.ts";
import {
    backupDigest,
    blobListDigest,
    digestBackupFile,
    encodeBackupManifest,
    readBackupSnapshot,
    sealBackupManifest,
} from "../../src/operations/backup-manifest.ts";
import { kernelProtocolConfig } from "../../src/protocol/config.ts";
import {
    buildStoreSchemaFixture,
    populateStoreForSchema,
    type StoreSchemaFixture,
} from "../../tooling/testing/store-schema-fixtures.ts";

type Golden = {
    readonly export_digest: string;
    readonly table_rows: Readonly<Record<string, number>>;
};

const CURRENT_SCHEMA = kernelProtocolConfig.store.schemaVersion;
const goldens = (
    JSON.parse(
        readFileSync(
            new URL("../fixtures/migration-drills/export-digests.json", import.meta.url),
            "utf8",
        ),
    ) as { readonly schemas: Readonly<Record<string, Golden>> }
).schemas;
const HISTORICAL_SCHEMAS = kernelProtocolConfig.store.migrations.map(({ version }) => version);
const BLOB_SUFFIX = kernelProtocolConfig.store.blobs.directorySuffix;

async function scratch(context: TestContext): Promise<string> {
    const directory = realpathSync(await mkdtemp(path.join(tmpdir(), "shepherd-drill-")));
    context.after(() => rm(directory, { force: true, recursive: true }));
    return directory;
}

function golden(schemaVersion: number): Golden {
    const entry = goldens[String(schemaVersion)];
    assert.ok(entry, `missing golden for store schema ${schemaVersion}`);
    return entry;
}

function fixtureAt(directory: string, schemaVersion: number): StoreSchemaFixture {
    const fixtureDirectory = path.join(directory, `schema-${schemaVersion}`);
    mkdirSync(fixtureDirectory);
    return buildStoreSchemaFixture(fixtureDirectory, schemaVersion);
}

function schemaOf(databasePath: string): number {
    const database = new DatabaseSync(databasePath, { readOnly: true });
    try {
        return Number(
            database.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()
                ?.version,
        );
    } finally {
        database.close();
    }
}

function simulateNewerSchema(databasePath: string): void {
    const database = new DatabaseSync(databasePath);
    database.exec(`CREATE TABLE future_feature (id TEXT PRIMARY KEY) STRICT;`);
    database.prepare("INSERT INTO schema_migrations(version) VALUES (?)").run(CURRENT_SCHEMA + 1);
    database.close();
}

/** Builds the backup an older package would have written for a historical-schema store. */
async function historicalBackup(
    fixture: StoreSchemaFixture,
    destination: string,
): Promise<TraceStoreBackupManifest> {
    mkdirSync(destination, { mode: 0o700 });
    const databasePath = path.join(destination, "trace.sqlite");
    copyFileSync(fixture.databasePath, databasePath);
    cpSync(`${fixture.databasePath}${BLOB_SUFFIX}`, path.join(destination, "blobs"), {
        recursive: true,
    });
    const snapshot = readBackupSnapshot(databasePath);
    const database = await digestBackupFile(databasePath);
    const manifest = sealBackupManifest({
        archive_format: kernelProtocolConfig.interchange.format,
        archive_format_version: kernelProtocolConfig.interchange.formatVersion,
        backup_compatibility_version: "shepherd.backup.v1",
        blobs: {
            byte_length: snapshot.blobByteLength,
            count: snapshot.blobIds.length,
            directory: "blobs",
            list_digest: blobListDigest(snapshot.blobIds),
            location: "directory",
        },
        cut_count: snapshot.cutCount,
        cut_heads: snapshot.heads,
        database: {
            byte_length: database.byteLength,
            digest: database.digest,
            file: "trace.sqlite",
        },
        export_digest: golden(fixture.schemaVersion).export_digest,
        format: "shepherd.store.backup",
        format_version: 1,
        package_version: "0.0.0",
        record_count: snapshot.recordCount,
        store_schema_version: fixture.schemaVersion,
    });
    writeFileSync(path.join(destination, "manifest.json"), encodeBackupManifest(manifest));
    return manifest;
}

test("drill fixtures exist for every historical store schema", () => {
    assert.deepEqual(
        HISTORICAL_SCHEMAS,
        Array.from({ length: CURRENT_SCHEMA }, (_, index) => index + 1),
    );
    assert.deepEqual(
        Object.keys(goldens)
            .map(Number)
            .sort((left, right) => left - right),
        HISTORICAL_SCHEMAS,
    );
});

for (const schemaVersion of HISTORICAL_SCHEMAS) {
    test(`store schema ${schemaVersion} upgrades to the current schema with integrity and its golden export`, async (context) => {
        const directory = await scratch(context);
        const fixture = fixtureAt(directory, schemaVersion);
        const expected = golden(schemaVersion);
        assert.equal(schemaOf(fixture.databasePath), schemaVersion);
        assert.deepEqual(fixture.tableRows, expected.table_rows);
        if (schemaVersion < CURRENT_SCHEMA) {
            assert.throws(
                () => new SQLiteTraceStore(fixture.databasePath, { readOnly: true }),
                UnsupportedStoreSchemaError,
            );
            assert.equal(schemaOf(fixture.databasePath), schemaVersion, "read-only never migrates");
        }

        using upgraded = new SQLiteTraceStore(fixture.databasePath);
        assert.equal(upgraded.schemaVersion, CURRENT_SCHEMA);
        const integrity = upgraded.verifyIntegrity();
        assert.deepEqual(integrity.issues, []);
        assert.equal(upgraded.verifyBlobs().ok, true);
        assert.equal(backupDigest(upgraded.exportTrace()), expected.export_digest);
        const database = new DatabaseSync(fixture.databasePath, { readOnly: true });
        for (const [table, rows] of Object.entries(expected.table_rows)) {
            assert.equal(
                Number(database.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get()?.count),
                rows,
                `${table} rows survive the upgrade from schema ${schemaVersion}`,
            );
        }
        database.close();
        upgraded.append({
            append_intent_id: `drill:after-upgrade:${schemaVersion}`,
            batch: {
                groups: [
                    {
                        owner_id: "run:after-upgrade",
                        records: [
                            {
                                body: { upgraded_from: schemaVersion },
                                mode: "capture",
                                schema_ref: "example.migration-drill.v1",
                                witness_ref: ROOT_WITNESS_ID,
                            },
                        ],
                    },
                ],
            },
        });
        assert.equal(upgraded.verifyIntegrity().ok, true);
    });

    test(`a backup of a store schema ${schemaVersion} store verifies and restores forward-migrated`, async (context) => {
        const directory = await scratch(context);
        const fixture = fixtureAt(directory, schemaVersion);
        const backup = path.join(directory, "backup");
        const manifest = await historicalBackup(fixture, backup);
        const verification = await verifyTraceStoreBackup(backup, {
            expectedManifestId: manifest.manifest_id,
            stagingDirectory: directory,
        });
        assert.equal(verification.verified_store_schema_version, CURRENT_SCHEMA);
        assert.equal(
            schemaOf(path.join(backup, "trace.sqlite")),
            schemaVersion,
            "verify never migrates the backup",
        );
        const receipt = await restoreTraceStoreBackup(
            backup,
            path.join(directory, "restored.sqlite"),
            {
                expectedManifestId: manifest.manifest_id,
            },
        );
        assert.equal(receipt.source_store_schema_version, schemaVersion);
        assert.equal(receipt.store_schema_version, CURRENT_SCHEMA);
        assert.equal(receipt.export_digest, golden(schemaVersion).export_digest);
    });
}

test("downgrade drill: a newer-schema store is refused and its archive imports into a fresh store", async (context) => {
    const directory = await scratch(context);
    const databasePath = path.join(directory, "newer.sqlite");
    {
        using store = new SQLiteTraceStore(databasePath);
        populateStoreForSchema(store, CURRENT_SCHEMA);
    }
    simulateNewerSchema(databasePath);
    assert.throws(() => new SQLiteTraceStore(databasePath), UnsupportedStoreSchemaError);
    assert.throws(
        () => new SQLiteTraceStore(databasePath, { readOnly: true }),
        UnsupportedStoreSchemaError,
    );
    assert.equal(
        schemaOf(databasePath),
        CURRENT_SCHEMA + 1,
        "refusal leaves the newer store untouched",
    );

    // A newer package still writes archive format v1; its reader is exercised here directly.
    const newer = new DatabaseSync(databasePath, { readOnly: true });
    const archive = exportTraceArchive(newer, new BlobFilesystem(`${databasePath}${BLOB_SUFFIX}`));
    newer.close();
    using fresh = new SQLiteTraceStore(path.join(directory, "fresh.sqlite"));
    fresh.importTrace(archive);
    assert.equal(fresh.exportTrace(), archive);
    assert.equal(backupDigest(archive), golden(CURRENT_SCHEMA).export_digest);

    const unknownFormat = archive.replace('"format_version":1', '"format_version":2');
    using refused = new SQLiteTraceStore();
    assert.throws(() => refused.importTrace(unknownFormat), TypeError);
});

test("backup, upgrade, then restore of the pre-upgrade backup returns the exact pre-upgrade trace", async (context) => {
    const directory = await scratch(context);
    const live = path.join(directory, "live.sqlite");
    let manifest: TraceStoreBackupManifest;
    {
        using store = new SQLiteTraceStore(live);
        populateStoreForSchema(store, CURRENT_SCHEMA);
        manifest = await backupTraceStore(store, {
            destination: path.join(directory, "pre-upgrade"),
        });
    }
    simulateNewerSchema(live);
    assert.throws(() => new SQLiteTraceStore(live), UnsupportedStoreSchemaError);

    const target = path.join(directory, "rolled-back.sqlite");
    const receipt = await restoreTraceStoreBackup(path.join(directory, "pre-upgrade"), target, {
        expectedManifestId: manifest.manifest_id,
    });
    assert.equal(receipt.export_digest, golden(CURRENT_SCHEMA).export_digest);
    assert.equal(receipt.store_schema_version, CURRENT_SCHEMA);
    using restored = new SQLiteTraceStore(target);
    assert.equal(backupDigest(restored.exportTrace()), manifest.export_digest);
    assert.equal(schemaOf(live), CURRENT_SCHEMA + 1, "restore never touches the upgraded store");
});
