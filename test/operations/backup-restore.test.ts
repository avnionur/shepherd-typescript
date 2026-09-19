import assert from "node:assert/strict";
import {
    cpSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    realpathSync,
    rmSync,
    statSync,
    writeFileSync,
} from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { type TestContext, test } from "node:test";
import { pathToFileURL } from "node:url";

import { Ajv2020, type AnySchemaObject } from "ajv/dist/2020.js";

import {
    type BlobStoreBackend,
    backupTraceStore,
    createMemoryBlobStoreBackend,
    ROOT_WITNESS_ID,
    restoreTraceStoreBackup,
    SQLiteTraceStore,
    TraceStoreBackupError,
    type TraceStoreBackupFailureReason,
    type TraceStoreBackupManifest,
    verifyTraceStoreBackup,
} from "../../src/index.ts";
import {
    digestBackupFile,
    encodeBackupManifest,
    parseBackupManifest,
    readBackupSnapshot,
    readPackageVersion,
    sealBackupManifest,
} from "../../src/operations/backup-manifest.ts";
import { materializeBlobs, resolveSQLiteBackup } from "../../src/operations/backup-staging.ts";
import { publishStagedStore, verifyRestoredStore } from "../../src/operations/restore.ts";
import { populateStoreForSchema } from "../../tooling/testing/store-schema-fixtures.ts";

const CURRENT_SCHEMA = 13;
const manifestSchema = JSON.parse(
    readFileSync(
        new URL("../../spec/schemas/store-backup-manifest-v1.schema.json", import.meta.url),
        "utf8",
    ),
) as AnySchemaObject;
const packageVersion = (
    JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
        readonly version: string;
    }
).version;

async function scratch(context: TestContext): Promise<string> {
    const directory = realpathSync(await mkdtemp(path.join(tmpdir(), "shepherd-backup-")));
    const previousUmask = process.umask(0o022);
    context.after(async () => {
        process.umask(previousUmask);
        await rm(directory, { force: true, recursive: true });
    });
    return directory;
}

function populatedStore(directory: string): SQLiteTraceStore {
    const store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    populateStoreForSchema(store, CURRENT_SCHEMA);
    return store;
}

async function rejectsWith(
    operation: Promise<unknown>,
    reason: TraceStoreBackupFailureReason,
): Promise<void> {
    await assert.rejects(operation, (error: unknown) => {
        assert.ok(error instanceof TraceStoreBackupError, String(error));
        assert.equal(error.reason, reason, error.message);
        assert.equal(error.code, "TRACE_STORE_BACKUP_ERROR");
        return true;
    });
}

function modeOf(filePath: string): number {
    return statSync(filePath).mode & 0o777;
}

function readManifestFile(backup: string): TraceStoreBackupManifest {
    return parseBackupManifest(readFileSync(path.join(backup, "manifest.json"), "utf8"));
}

function reseal(
    backup: string,
    change: (body: Record<string, unknown>) => Record<string, unknown>,
): TraceStoreBackupManifest {
    const { manifest_id: _identity, ...body } = structuredClone(readManifestFile(backup));
    const sealed = sealBackupManifest(
        change(body) as unknown as Omit<TraceStoreBackupManifest, "manifest_id">,
    );
    writeFileSync(path.join(backup, "manifest.json"), encodeBackupManifest(sealed));
    return sealed;
}

async function resealDatabase(backup: string): Promise<void> {
    const database = await digestBackupFile(path.join(backup, "trace.sqlite"));
    reseal(backup, (body) => ({
        ...body,
        database: {
            ...(body.database as object),
            byte_length: database.byteLength,
            digest: database.digest,
        },
    }));
}

function copyOf(backup: string, directory: string, name: string): string {
    const copy = path.join(directory, name);
    cpSync(backup, copy, { recursive: true });
    return copy;
}

test("backup writes an owner-only, schema-valid, verified backup and restores it exactly", async (context) => {
    const directory = await scratch(context);
    using store = populatedStore(directory);
    const backup = path.join(directory, "backup");
    const manifest = await backupTraceStore(store, { destination: backup });

    assert.equal(Object.isFrozen(manifest), true);
    assert.deepEqual(readManifestFile(backup), manifest);
    assert.equal(manifest.package_version, packageVersion);
    assert.equal(manifest.store_schema_version, CURRENT_SCHEMA);
    assert.equal(manifest.blobs.location, "directory");
    assert.equal(manifest.blobs.count, 1);
    assert.equal(manifest.record_count, 6);
    assert.equal(manifest.cut_count, 1);
    assert.deepEqual(readdirSync(backup).sort(), ["blobs", "manifest.json", "trace.sqlite"]);
    const validate = new Ajv2020({ strict: true }).compile(manifestSchema);
    assert.equal(
        validate(JSON.parse(readFileSync(path.join(backup, "manifest.json"), "utf8"))),
        true,
    );
    assert.equal(modeOf(backup), 0o700);
    assert.equal(modeOf(path.join(backup, "trace.sqlite")), 0o600);
    assert.equal(modeOf(path.join(backup, "manifest.json")), 0o600);
    const bucket = readdirSync(path.join(backup, "blobs"))[0] as string;
    assert.equal(modeOf(path.join(backup, "blobs", bucket)), 0o700);
    const blobFile = readdirSync(path.join(backup, "blobs", bucket))[0] as string;
    assert.equal(modeOf(path.join(backup, "blobs", bucket, blobFile)), 0o600);

    const verification = await verifyTraceStoreBackup(backup, {
        expectedManifestId: manifest.manifest_id,
        stagingDirectory: directory,
    });
    assert.deepEqual(verification, {
        manifest,
        verified_store_schema_version: CURRENT_SCHEMA,
    });
    assert.deepEqual(
        readdirSync(directory).sort(),
        ["backup", "trace.sqlite", "trace.sqlite-shm", "trace.sqlite-wal", "trace.sqlite.blobs"],
        "verification removes its staging copy",
    );

    const target = path.join(directory, "restored.sqlite");
    const receipt = await restoreTraceStoreBackup(backup, target, {
        expectedManifestId: manifest.manifest_id,
    });
    assert.deepEqual(receipt, {
        blob_count: 1,
        export_digest: manifest.export_digest,
        manifest_id: manifest.manifest_id,
        record_count: 6,
        source_store_schema_version: CURRENT_SCHEMA,
        store_schema_version: CURRENT_SCHEMA,
    });
    assert.equal(modeOf(target), 0o600);
    using restored = new SQLiteTraceStore(target, { readOnly: true });
    assert.equal(restored.exportTrace(), store.exportTrace());
    assert.equal(
        readdirSync(directory).some((name) => name.startsWith(".shepherd-restore-")),
        false,
    );

    await rejectsWith(
        restoreTraceStoreBackup(backup, target, { expectedManifestId: manifest.manifest_id }),
        "target-exists",
    );
    await rejectsWith(
        restoreTraceStoreBackup(backup, path.join(directory, "other.sqlite"), {
            expectedManifestId: `sha256:${"0".repeat(64)}`,
        }),
        "manifest-mismatch",
    );
    await rejectsWith(
        verifyTraceStoreBackup(backup, { expectedManifestId: "sha256:other" }),
        "manifest-mismatch",
    );
    for (const occupied of ["occupied.sqlite.blobs", "occupied.sqlite-wal"]) {
        mkdirSync(path.join(directory, occupied));
        await rejectsWith(
            restoreTraceStoreBackup(backup, path.join(directory, "occupied.sqlite"), {
                expectedManifestId: manifest.manifest_id,
            }),
            "target-exists",
        );
        rmSync(path.join(directory, occupied), { recursive: true });
    }
    await rejectsWith(backupTraceStore(store, { destination: backup }), "destination-exists");
    await assert.rejects(
        backupTraceStore(store, { destination: path.join(directory, "missing", "backup") }),
        { code: "ENOENT" },
    );
});

test("in-memory stores back up, and backups of an empty store restore", async (context) => {
    const directory = await scratch(context);
    using store = new SQLiteTraceStore();
    const backup = path.join(directory, "empty-backup");
    const manifest = await backupTraceStore(store, { destination: backup });
    assert.equal(manifest.record_count, 1);
    assert.equal(manifest.blobs.count, 0);
    assert.deepEqual(manifest.cut_heads, []);
    const target = path.join(directory, "empty.sqlite");
    await restoreTraceStoreBackup(backup, target, { expectedManifestId: manifest.manifest_id });
    using restored = new SQLiteTraceStore(target, { readOnly: true });
    assert.equal(restored.exportTrace(), store.exportTrace());
});

test("an interrupted backup leaves no manifest and every verifier refuses it", async (context) => {
    const directory = await scratch(context);
    using store = populatedStore(directory);
    const failing: BlobStoreBackend = {
        ...createMemoryBlobStoreBackend(),
        put: async () => {
            throw new Error("simulated crash while copying blobs");
        },
    };
    const backup = path.join(directory, "interrupted");
    await assert.rejects(
        backupTraceStore(store, { blobBackend: failing, destination: backup }),
        /simulated crash/u,
    );
    assert.deepEqual(readdirSync(backup), ["trace.sqlite"]);
    await rejectsWith(verifyTraceStoreBackup(backup), "manifest-missing");
    const target = path.join(directory, "never.sqlite");
    await rejectsWith(
        restoreTraceStoreBackup(backup, target, { expectedManifestId: "sha256:any" }),
        "manifest-missing",
    );
    assert.deepEqual(
        readdirSync(directory).filter((name) => name.startsWith("never")),
        [],
        "a refused restore creates nothing",
    );

    const vanishing = path.join(directory, "vanishing");
    const readBlob = store.readBlob.bind(store);
    store.readBlob = () => undefined;
    await rejectsWith(backupTraceStore(store, { destination: vanishing }), "blob-mismatch");
    store.readBlob = readBlob;
    await rejectsWith(verifyTraceStoreBackup(vanishing), "manifest-missing");
});

test("backups whose blobs live in a caller backend verify and restore with that backend", async (context) => {
    const directory = await scratch(context);
    using store = populatedStore(directory);
    const blobBackend = createMemoryBlobStoreBackend();
    const backup = path.join(directory, "backend-backup");
    const manifest = await backupTraceStore(store, { blobBackend, destination: backup });
    assert.equal(manifest.blobs.location, "backend");
    assert.deepEqual(readdirSync(backup).sort(), ["manifest.json", "trace.sqlite"]);
    await rejectsWith(verifyTraceStoreBackup(backup), "blob-mismatch");
    await verifyTraceStoreBackup(backup, { blobBackend });
    const target = path.join(directory, "from-backend.sqlite");
    await restoreTraceStoreBackup(backup, target, {
        blobBackend,
        expectedManifestId: manifest.manifest_id,
    });
    using restored = new SQLiteTraceStore(target, { readOnly: true });
    assert.equal(restored.verifyBlobs().checked_blob_count, 1);
});

test("tampered backups are refused with a classified reason and never restored", async (context) => {
    const directory = await scratch(context);
    using store = populatedStore(directory);
    const backup = path.join(directory, "pristine");
    const manifest = await backupTraceStore(store, { destination: backup });
    let index = 0;
    const tampered = (): string => {
        index += 1;
        return copyOf(backup, directory, `tampered-${index}`);
    };
    const manifestPath = (copy: string) => path.join(copy, "manifest.json");

    let copy = tampered();
    writeFileSync(manifestPath(copy), "{");
    await rejectsWith(verifyTraceStoreBackup(copy), "manifest-invalid");

    copy = tampered();
    rmSync(manifestPath(copy));
    mkdirSync(manifestPath(copy));
    await rejectsWith(verifyTraceStoreBackup(copy), "manifest-invalid");

    for (const change of [
        (body: Record<string, unknown>) => ({ ...body, extra: true }),
        (body: Record<string, unknown>) => ({ ...body, format_version: 2 }),
        (body: Record<string, unknown>) => ({ ...body, package_version: "2.x" }),
        (body: Record<string, unknown>) => ({ ...body, export_digest: "sha256:short" }),
        (body: Record<string, unknown>) => ({ ...body, cut_heads: {} }),
        (body: Record<string, unknown>) => ({ ...body, blobs: [] }),
        (body: Record<string, unknown>) => ({
            ...body,
            cut_heads: [{ owner_id: "", owner_ordinal: 0, record_id: ROOT_WITNESS_ID }],
        }),
        (body: Record<string, unknown>) => ({
            ...body,
            cut_heads: [{ owner_id: "owner", owner_ordinal: 0, record_id: "not-a-record" }],
        }),
    ]) {
        copy = tampered();
        reseal(copy, change);
        await rejectsWith(verifyTraceStoreBackup(copy), "manifest-invalid");
    }

    copy = tampered();
    const text = readFileSync(manifestPath(copy), "utf8");
    writeFileSync(manifestPath(copy), text.replace('"record_count":6', '"record_count":7'));
    await rejectsWith(verifyTraceStoreBackup(copy), "manifest-invalid");

    copy = tampered();
    reseal(copy, (body) => ({ ...body, record_count: 7 }));
    await rejectsWith(verifyTraceStoreBackup(copy), "manifest-invalid");

    // Identity-preserving but non-canonical text (whitespace, a repeated key) is refused, so no
    // other JSON reader can see a different manifest.
    for (const edit of [
        (value: string) => value.replace("{", "{ "),
        (value: string) => value.replace('"record_count":6', '"record_count":9,"record_count":6'),
        (value: string) => value.trimEnd(),
        // A lone surrogate owner is refused as manifest-invalid, not as an unclassified TypeError.
        (value: string) => value.replace('"owner_id":"', '"owner_id":"\\ud800'),
    ]) {
        copy = tampered();
        writeFileSync(manifestPath(copy), edit(readFileSync(manifestPath(copy), "utf8")));
        await rejectsWith(verifyTraceStoreBackup(copy), "manifest-invalid");
    }

    copy = tampered();
    writeFileSync(path.join(copy, "trace.sqlite"), "\0", { flag: "a" });
    await rejectsWith(verifyTraceStoreBackup(copy), "database-mismatch");

    copy = tampered();
    rmSync(path.join(copy, "trace.sqlite"));
    await rejectsWith(verifyTraceStoreBackup(copy), "database-mismatch");

    copy = tampered();
    writeFileSync(path.join(copy, "trace.sqlite"), "not a database");
    await resealDatabase(copy);
    await rejectsWith(verifyTraceStoreBackup(copy), "database-mismatch");

    copy = tampered();
    reseal(copy, (body) => ({ ...body, blobs: { ...(body.blobs as object), count: 2 } }));
    await rejectsWith(verifyTraceStoreBackup(copy), "blob-mismatch");

    copy = tampered();
    rmSync(path.join(copy, "blobs"), { recursive: true });
    await rejectsWith(verifyTraceStoreBackup(copy), "blob-mismatch");

    copy = tampered();
    const bucket = readdirSync(path.join(copy, "blobs"))[0] as string;
    const blobName = readdirSync(path.join(copy, "blobs", bucket))[0] as string;
    writeFileSync(path.join(copy, "blobs", bucket, blobName), "substituted bytes");
    await rejectsWith(verifyTraceStoreBackup(copy), "blob-mismatch");

    copy = tampered();
    reseal(copy, (body) => ({ ...body, export_digest: `sha256:${"e".repeat(64)}` }));
    await rejectsWith(verifyTraceStoreBackup(copy), "export-mismatch");
    await rejectsWith(
        restoreTraceStoreBackup(copy, path.join(directory, "never.sqlite"), {
            expectedManifestId: readManifestFile(copy).manifest_id,
        }),
        "export-mismatch",
    );
    assert.equal(
        readdirSync(directory).some((name) => name.startsWith("never")),
        false,
        "a failed restore publishes nothing",
    );

    copy = tampered();
    let database = new DatabaseSync(path.join(copy, "trace.sqlite"));
    database
        .prepare(
            "UPDATE records SET body_json = ? WHERE record_id <> ? AND rowid = (SELECT MAX(rowid) FROM records)",
        )
        .run('{"tampered":true}', ROOT_WITNESS_ID);
    database.close();
    await resealDatabase(copy);
    await rejectsWith(verifyTraceStoreBackup(copy), "integrity-failed");

    copy = tampered();
    database = new DatabaseSync(path.join(copy, "trace.sqlite"));
    database.exec("DROP TABLE owner_ordinals");
    database.close();
    await resealDatabase(copy);
    await rejectsWith(verifyTraceStoreBackup(copy), "integrity-failed");

    copy = tampered();
    database = new DatabaseSync(path.join(copy, "trace.sqlite"));
    database.prepare("INSERT INTO schema_migrations(version) VALUES (?)").run(CURRENT_SCHEMA + 1);
    database.close();
    await resealDatabase(copy);
    await rejectsWith(verifyTraceStoreBackup(copy), "schema-unsupported");

    await verifyTraceStoreBackup(backup, { expectedManifestId: manifest.manifest_id });
});

test("backup helpers fail closed at their seams", async (context) => {
    const directory = await scratch(context);
    assert.throws(
        () => resolveSQLiteBackup({}),
        (error: unknown) =>
            error instanceof TraceStoreBackupError && error.reason === "backup-unsupported",
    );
    const copy = async () => 1;
    assert.equal(resolveSQLiteBackup({ backup: copy }), copy);

    assert.throws(
        () => readBackupSnapshot(path.join(directory, "absent.sqlite")),
        (error: unknown) =>
            error instanceof TraceStoreBackupError && error.reason === "database-mismatch",
    );

    assert.equal(readPackageVersion(), packageVersion);
    const foreign = path.join(directory, "foreign", "src");
    mkdirSync(foreign, { recursive: true });
    writeFileSync(path.join(directory, "foreign", "package.json"), '{"version":"next"}');
    assert.throws(
        () => readPackageVersion(pathToFileURL(path.join(foreign, "module.js")).href),
        /no semantic version/u,
    );
    writeFileSync(path.join(directory, "foreign", "package.json"), "null");
    assert.throws(
        () => readPackageVersion(pathToFileURL(path.join(foreign, "module.js")).href),
        /no semantic version/u,
    );
    assert.throws(
        () => readPackageVersion(pathToFileURL(path.join(path.parse(directory).root, "m.js")).href),
        /package manifest is unavailable/u,
    );

    const target = createMemoryBlobStoreBackend();
    const blobId = `sha256:${"a".repeat(64)}`;
    await assert.rejects(
        materializeBlobs([blobId], { get: async () => new Uint8Array([1]) }, target),
        (error: unknown) =>
            error instanceof TraceStoreBackupError && error.reason === "blob-mismatch",
    );
    await assert.rejects(
        materializeBlobs(
            [blobId],
            {
                get: async () => {
                    throw new Error("backend offline");
                },
            },
            target,
        ),
        (error: unknown) =>
            error instanceof TraceStoreBackupError && error.reason === "blob-mismatch",
    );
});

test("restore publication and final verification refuse races and never report success", async (context) => {
    const directory = await scratch(context);
    using store = populatedStore(directory);
    const backup = path.join(directory, "backup");
    const manifest = await backupTraceStore(store, { destination: backup });

    const staged = path.join(directory, "staged");
    mkdirSync(path.join(staged, "trace.sqlite.blobs"), { recursive: true });
    writeFileSync(path.join(staged, "trace.sqlite"), "staged");
    const stagedStore = {
        blobDirectory: path.join(staged, "trace.sqlite.blobs"),
        databasePath: path.join(staged, "trace.sqlite"),
    };
    const raced = path.join(directory, "raced.sqlite");
    mkdirSync(`${raced}.blobs`);
    assert.throws(
        () => publishStagedStore(stagedStore, raced, `${raced}.blobs`),
        (error: unknown) =>
            error instanceof TraceStoreBackupError && error.reason === "target-exists",
    );
    rmSync(`${raced}.blobs`, { recursive: true });
    writeFileSync(raced, "someone else's store");
    assert.throws(
        () => publishStagedStore(stagedStore, raced, `${raced}.blobs`),
        (error: unknown) =>
            error instanceof TraceStoreBackupError && error.reason === "target-exists",
    );
    assert.equal(readFileSync(raced, "utf8"), "someone else's store");
    assert.equal(statSync(`${raced}.blobs`, { throwIfNoEntry: false }), undefined);

    // A failed blob-directory move is classified and leaves no empty directory behind that would
    // block the next restore.
    const unmoved = path.join(directory, "unmoved.sqlite");
    assert.throws(
        () =>
            publishStagedStore(
                { ...stagedStore, blobDirectory: path.join(staged, "missing.blobs") },
                unmoved,
                `${unmoved}.blobs`,
            ),
        (error: unknown) =>
            error instanceof TraceStoreBackupError &&
            error.reason === "target-exists" &&
            (error.cause as NodeJS.ErrnoException).code === "ENOENT",
    );
    assert.equal(statSync(`${unmoved}.blobs`, { throwIfNoEntry: false }), undefined);
    assert.equal(statSync(unmoved, { throwIfNoEntry: false }), undefined);

    const target = path.join(directory, "restored.sqlite");
    await restoreTraceStoreBackup(backup, target, { expectedManifestId: manifest.manifest_id });
    assert.throws(
        () =>
            verifyRestoredStore(target, {
                ...manifest,
                export_digest: `sha256:${"f".repeat(64)}`,
            }),
        (error: unknown) =>
            error instanceof TraceStoreBackupError && error.reason === "export-mismatch",
    );
    const database = new DatabaseSync(target);
    database
        .prepare(
            "UPDATE records SET body_json = ? WHERE record_id <> ? AND rowid = (SELECT MAX(rowid) FROM records)",
        )
        .run('{"tampered":true}', ROOT_WITNESS_ID);
    database.close();
    assert.throws(
        () => verifyRestoredStore(target, manifest),
        (error: unknown) =>
            error instanceof TraceStoreBackupError && error.reason === "integrity-failed",
    );
});

test("backup, verification, and restore validate their arguments", async (context) => {
    const directory = await scratch(context);
    using store = new SQLiteTraceStore();
    await assert.rejects(backupTraceStore(store, null as never), TypeError);
    await assert.rejects(backupTraceStore(store, { destination: "" }), TypeError);
    await assert.rejects(
        backupTraceStore(store, { blobBackend: {} as never, destination: directory }),
        TypeError,
    );
    await assert.rejects(
        backupTraceStore(store, { blobBackend: null as never, destination: directory }),
        TypeError,
    );
    await assert.rejects(verifyTraceStoreBackup(""), TypeError);
    await assert.rejects(verifyTraceStoreBackup(directory, null as never), TypeError);
    await assert.rejects(restoreTraceStoreBackup(directory, "t", null as never), TypeError);
    await assert.rejects(restoreTraceStoreBackup(directory, "t", {} as never), TypeError);
    await assert.rejects(
        restoreTraceStoreBackup(directory, "", { expectedManifestId: "sha256:x" }),
        TypeError,
    );
    store.close();
    await assert.rejects(
        backupTraceStore(store, { destination: path.join(directory, "closed") }),
        /closed/u,
    );
});
