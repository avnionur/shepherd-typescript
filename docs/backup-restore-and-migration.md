# Backup, restore, and migration

Status: normative from 2.29.0 (Phase 11 slice 5, #182). Configuration: the `backup` section of
[`protocol.config.json`](../protocol.config.json), read by
[`src/protocol/config-backup.ts`](../src/protocol/config-backup.ts) and pinned by
`BACKUP_PROTOCOL_V1_CONTRACT` in
[`src/protocol/compatibility-constants.ts`](../src/protocol/compatibility-constants.ts).
Implementation: [`src/operations/`](../src/operations) (`backup.ts`, `restore.ts`,
`replication.ts`, `backup-manifest.ts`, `backup-staging.ts`, `errors.ts`), the internal
`SQLiteTraceStore.backupDatabase` seam, and the `store` CLI group in
[`src/cli/store-handlers.ts`](../src/cli/store-handlers.ts). Public entry:
[`./operations`](./package-exports.md) and the root. Schema:
[`store-backup-manifest-v1`](../spec/schemas/store-backup-manifest-v1.schema.json). Tests:
[`test/operations/`](../test/operations) (backup and restore, replication, migration drills,
configuration) and [`test/cli/store-cli.test.ts`](../test/cli/store-cli.test.ts); drill fixtures
are built by [`tooling/testing/store-schema-fixtures.ts`](../tooling/testing/store-schema-fixtures.ts)
and compared with [`test/fixtures/migration-drills/export-digests.json`](../test/fixtures/migration-drills/export-digests.json).

## Compatibility model

- **Forward-only store schema.** The trace store has one ordered migration list (schemas 1 through
  13 at 2.30.0, where schema 13 only adds indexes; [SQLite trace store](./sqlite-trace-store.md)). A writable open applies every
  pending migration, each in its own transaction. A store whose schema is newer than the package
  supports is refused with `UnsupportedStoreSchemaError`; a read-only open requires exactly the
  current schema and never migrates.
- **No schema downgrade.** No code path rewrites a newer store for an older package. Downgrade
  means one of:
  1. restoring a backup taken before the upgrade (a new store; the upgraded store is untouched), or
  2. a same-format archive round trip: a newer package that still writes native archive format
     `shepherd.trace.archive` v1 produces an archive that `importTrace` loads into a fresh store of
     the older package, provided the archive format is known to it. An unknown archive format
     version is refused.
- **Supported upgrade sources.** Store schemas 1 through the current schema, native archive format
  v1, and backup manifest format `shepherd.store.backup` v1. No earlier package version was ever
  published to a registry, so there are no released stores in the field; the drills below
  synthesize every historical schema from the migration steps instead of from older releases.

## Backup

`backupTraceStore(store, { destination, blobBackend? })` writes one self-describing backup of an
open store (writable or read-only) into a new directory.

1. The runtime must provide `node:sqlite` `backup()`; otherwise the call fails closed with
   `backup-unsupported` before writing anything. `backup()` exists from Node.js 22.16 and 23.8;
   the package minimum is 24.12.0. The suite runs on the reference host with Node.js 24.12.0 and
   24.17.0.
2. The destination directory must not exist. It is created with the configured owner-only
   `backup.directoryMode` (`0700`); an existing path fails with `destination-exists`.
3. The database is copied online through SQLite's backup API into an owner-only (`0600`) file, so
   the copy is one consistent snapshot even while the store is in use. The copy is converted to the
   configured rollback-journal mode `backup.databaseJournalMode` (`DELETE`; `TRUNCATE` and
   `PERSIST` are the other accepted values) so it is self-contained. Every backup database the
   package opens (the copy, and any backup database it reads for verification, restore, or
   replication) is opened with the store's `kernel.store.defensive` setting, because a backup
   directory is untrusted input.
4. Every blob the snapshot registers is copied, identity-checked, into the backup's `blobs`
   directory (files `0600`, directories `0700`) or into the caller's `BlobStoreBackend`
   ([storage interfaces](./storage-interfaces.md)).
5. The copy is proven before the backup is declared complete: it is staged in a private
   directory, opened as a trace store, and must pass `verifyIntegrity` and `verifyBlobs` and
   export a native archive whose digest is recorded.
6. The manifest is written last, owner-only, through a temporary name, a flush, and an atomic
   rename. **A backup directory without `manifest.json` is incomplete** and every verifier refuses
   it with `manifest-missing`.

Only the call's own staging directory is removed on failure; a partial backup directory is left for
the operator to inspect and delete.

### Layout and manifest

| Path | Content |
| --- | --- |
| `trace.sqlite` | Database copy (`0600`) |
| `blobs/` | Blob bytes in the trace-store fan-out layout, absent when blobs went to a backend |
| `manifest.json` | Canonical JSON manifest (`0600`), written last |

The manifest (`store-backup-manifest-v1`) records: `format` and `format_version`,
`backup_compatibility_version`, `package_version` of the writer, `store_schema_version`,
`archive_format` and `archive_format_version`, `database` (file name, byte length, digest),
`export_digest` of the verified copy's native export, `blobs` (location `directory` or `backend`,
count, total bytes, and the digest of the newline-joined ascending blob identifiers), `record_count`,
`cut_count`, and `cut_heads` (the latest occurrence of every owner in the snapshot). `manifest_id`
is the configured digest of the canonical JSON of every other member. It is a content identity,
not a signature: a principal who can rewrite the backup directory can write a consistent forgery
(F-006 applies to backups exactly as to stores).

## Verification

`verifyTraceStoreBackup(directory, { expectedManifestId?, blobBackend?, stagingDirectory? })` never
modifies the backup. It reads and re-derives the manifest, copies the database into a private
staging directory, and requires, in order: equal database digest and length; equal schema, record
and cut counts, and owner heads; equal blob set; every blob present and hashing to its identifier;
a successful writable open of the copy (forward migrations run on the copy only); `verifyIntegrity`
and `verifyBlobs` clean; and an equal export digest. The staging copy is then removed.

Failures are `TraceStoreBackupError` (`TRACE_STORE_BACKUP_ERROR`) with one configured `reason`:

| Reason | Meaning |
| --- | --- |
| `backup-unsupported` | The runtime has no `node:sqlite` online backup |
| `destination-exists` | A backup or fetch destination already exists |
| `manifest-missing` | No manifest: the backup is incomplete or was interrupted |
| `manifest-invalid` | The manifest is not bounded JSON of the configured shape, is not exactly the writer's canonical encoding (from 2.32.0: repeated keys, added whitespace, or a missing final newline are refused so no other JSON reader can see a different manifest), its identity does not match its content, or it does not describe its database |
| `manifest-mismatch` | The manifest is not the identity the operator named |
| `schema-unsupported` | The copied store schema is newer than this package supports |
| `database-mismatch` | Database bytes are missing, differ from the manifest, or are not a trace store |
| `blob-mismatch` | A blob is missing, unreadable, or differs from its identifier, or the blob set differs |
| `integrity-failed` | The reopened copy cannot be opened or fails integrity verification |
| `export-mismatch` | The reopened copy does not export the recorded trace |
| `target-exists` | A restore target, its blob directory, or a SQLite sidecar already exists |

## Restore

`restoreTraceStoreBackup(directory, targetPath, { expectedManifestId, blobBackend? })` creates a new
store and never overwrites:

1. The operator must name the exact `manifest_id`; any other identity fails with
   `manifest-mismatch`.
2. The target database, its blob directory, and every SQLite sidecar must be absent
   (`target-exists`).
3. The backup is staged in an owner-only directory beside the target and fully verified as above.
   Older store schemas are migrated forward in the staged copy.
4. The staged blob directory is moved into place and the database is hard-linked to the target,
   which fails instead of replacing a concurrently created file. A move that fails is reported as
   `target-exists` with the file-system error as cause, and the empty target blob directory the
   restore created for it is removed, so it does not block the next restore (since 2.32.2, F-024).
5. The target is reopened read-only and must pass `verifyIntegrity`, `verifyBlobs`, and export the
   manifest's digest. Only then does the call resolve with a receipt (manifest identity, export
   digest, source and restored schema, counts).

A restore that fails before step 4 publishes nothing. A failure after publication rejects and
leaves the target in place; that target must be discarded, never used. The call never reports
success for an unverified target.

## Replication

`replicateTraceStoreBackup(directory, { backend, coordinator, refName, expectedGeneration, fence?,
sourceBlobBackend? })` verifies the backup, stores the database bytes, the exact manifest bytes,
and every blob as content-addressed objects in `backend`, and then publishes the manifest object's
identifier under `refName` by `compareAndSwapRef` (optionally lease-fenced). The database and
manifest files are read again after verification; the database bytes must still hash to the
manifest's `database.digest` (`database-mismatch` otherwise) and the manifest must still name the
verified manifest identity (`manifest-mismatch`), so a file swapped between verification and
replication is never published. Because replication stores the database under its manifest digest
as a blob identifier, configuration loading requires `backup.digestAlgorithm` and
`backup.digestPrefix` to equal `kernel.store.blobs.digestAlgorithm` and `idPrefix`. A conflict or fence
refusal is returned as the swap status, not thrown; objects already written are content-addressed,
so a retry is safe. `fetchReplicatedTraceStoreBackup({ backend, coordinator, refName, destination
})` materializes the named replica into a new local backup directory (manifest written last) and
verifies it. The reference adapters are local; no network adapter ships (D-018).

## Command line

The `store` group ([command-line interface](./cli.md)):

| Command | Behavior |
| --- | --- |
| `store verify [--store <path>]` | Opens the store read-only and requires `verifyIntegrity` and `verifyBlobs`; exit 1 lists issues |
| `store verify --backup <dir> [--manifest <id>]` | `verifyTraceStoreBackup` |
| `store backup [--store <path>] --output <dir>` | `backupTraceStore` from a read-only open |
| `store restore --backup <dir> --manifest <id> --store <target>` | `restoreTraceStoreBackup`; the target is required |
| `store export [--store <path>] --output <file> [--redacted]` | Writes a native or redacted archive to a new owner-only file |
| `store import [--store <path>] --input <file>` | Imports a native archive into a pristine (or new) store |
| `store maintain [--store <path>] [--mode <mode>]` | `SQLiteTraceStore.maintain` on an existing store ([maintenance](./sqlite-trace-store.md#maintenance)); semantic content unchanged |

Backup failures print `<reason>: <message>` and exit with the configured failure code; `--json`
emits the stable envelope without messages or paths.

## Migration drills

`test/operations/migration-drills.test.ts` runs on every `pnpm test`:

- **Every historical schema.** For each schema 1 through the current one,
  `buildStoreSchemaFixture` applies the real migration steps up to that schema
  (`migrateTraceStore(database, throughVersion)`) and copies, column by column, rows that are valid
  at it: records, parents, views, and intents (schema 1), blobs and receipts (2), a cut (3), a
  durable execution claim (4, 5), a retained-world settlement admission (6, 7), open-operation
  bookkeeping (8), a root scope registration with a writer claim (9), and a durable subscription
  cursor (10). The supervised-dispatch (11) and replay-session (12) tables exist but are empty in
  the fixtures. Each fixture must upgrade to the current schema, keep every row, pass
  `verifyIntegrity` and `verifyBlobs`, accept a new append, and export exactly the checked-in
  golden digest. A read-only open of an older fixture is refused without migrating it.
- **Older-schema backups.** A backup of each historical-schema store verifies (migrating only the
  staging copy) and restores forward-migrated with the golden export digest.
- **Downgrade.** A store marked with a future schema is refused writable and read-only and left
  untouched; its archive-format-v1 export imports into a fresh store with an equal export, and an
  unknown archive format version is refused.
- **Backup, upgrade, restore.** A backup taken before a simulated upgrade restores into a new store
  that exports the exact pre-upgrade trace while the upgraded store is left untouched.
- **Interruption.** A backup interrupted before its manifest is refused by verification and restore
  (`test/operations/backup-restore.test.ts`), and every tampered or failed restore publishes nothing
  or rejects.

Changing a golden digest changes what an upgraded store exports; it is a compatibility change and
must be reviewed as one.

## Runbooks

### Upgrade the package

1. Stop writers. Run `shepherd-ts store verify --store <db>`.
2. Take a backup with the currently installed package: `shepherd-ts store backup --store <db>
   --output <dir>`, and record the printed manifest identity.
3. Verify it: `shepherd-ts store verify --backup <dir> --manifest <id>`. Keep the directory
   owner-only and off the store's host if the host is the failure domain.
4. Install the new package and open the store writable once (any writable command or
   `new SQLiteTraceStore(path)`); pending migrations run forward.
5. Run `store verify` again before resuming writers.

### Roll back an upgrade (downgrade)

1. Reinstall the previous package. It refuses the upgraded store; do not edit the schema table.
2. Restore the pre-upgrade backup into a new path:
   `shepherd-ts store restore --backup <dir> --manifest <id> --store <new-db>`.
3. Point writers at the new path. Records appended after the backup exist only in the upgraded
   store; if they matter, export them with the newer package (`store export`) and review them, and
   import that archive into a fresh store only when the older package knows its archive format.

### Restore after loss or corruption

1. Follow the [store-corruption runbook](./incident-response.md#runbook-suspected-store-corruption).
2. Choose the newest backup that verifies; name its manifest identity explicitly.
3. Restore into a new path; never delete or overwrite the damaged store until the restore receipt is
   recorded.

### Interrupted backup or restore

- A backup directory without `manifest.json` is incomplete. Delete it and take a new backup; never
  hand-write a manifest.
- A `.shepherd-restore-*` directory beside a restore target is an abandoned staging copy; delete it.
- A restore that rejected after publication leaves a target that failed verification; delete the
  target database, its sidecars, and its blob directory before retrying.

## Non-claims

- Backups are neither encrypted nor signed. They contain every record body and blob; protect them
  like the store (see [secrets and retention](./secrets-and-retention.md)).
- Drills run on the reference host class (macOS arm64 APFS) and, from 2.33.1, in the local Docker
  Linux lane (overlayfs, Node 24.21.0 and 24.12.0). Other filesystems are not verified; hosted
  runs are waived because hosted CI stays disabled by owner decision of 2026-09-23 (O-3, #199).
- Replication reads the database copy into memory and ships only local reference adapters.
- Backups are full copies; there is no incremental or point-in-time backup.
