# SQLite Trace Store

Implementation:
[`src/store/sqlite-trace-store.ts`](../src/store/sqlite-trace-store.ts) and the
[`src/store`](../src/store) module. Public exports:
[`src/index.ts`](../src/index.ts) and Node package subpath
`@avnionur/shepherd-typescript/trace`. Tests:
[`test/store`](../test/store).

## Scope

`SQLiteTraceStore` is the first durable trace-kernel adapter. It retains canonical records,
ordered causal parents, owner-local views, owner ordinal state, append-intent receipts, and blob
storage receipts in SQLite. Construction accepts a file path or uses an in-memory database by
default.

The adapter uses Node 24's built-in synchronous SQLite API. It enables validated foreign-key,
journal, synchronization, timeout, transaction, and defensive settings before applying
migrations. Unsafe values are rejected while loading
[protocol configuration](./protocol-configuration.md). The current schema version is available
through `schemaVersion`.

## Append transaction

`append({ append_intent_id, batch })` validates the closed request shape and delegates semantic
planning to `planAppendBatch`. One `BEGIN IMMEDIATE` transaction then:

1. checks whether the append intent was already committed;
2. looks up, by primary key, only the retained records the batch cites as parents or witnesses and
   the next ordinal of each owner the batch extends (from 2.30.0; earlier versions loaded every
   record identity and owner ordinal, so each append cost time linear in the store size);
3. validates causal parents and witnesses;
4. inserts deduplicated semantic records and ordered parent edges;
5. inserts owner-local record views with their append-intent identity and advances changed owner
   ordinals;
6. stores the deterministic append receipt and commits.

Any validation or SQLite error rolls back the receipt, records, edges, views, and ordinal changes.
The same intent may therefore be retried after a failed append. When SQLite has already rolled the
transaction back itself, as it does after `SQLITE_FULL` or an I/O error, the store issues no second
`ROLLBACK` and the SQLite error reaches the caller unchanged (from 2.32.1; earlier versions
reported "cannot rollback - no transaction is active" instead). The same rule applies to every
store, import, export, storage-coordinator, and task-registry transaction; the
[fault suites](./fault-and-fuzz-conformance.md#disk-full) exercise it.

An equal retry validates and returns the original receipt without adding records or views. A
durable append position preserves occurrence order so the store can reconstruct record IDs,
causal edges, and owner ranges from committed rows. The reconstructed result must exactly match
the stored receipt. Reusing an intent for different semantic batch content throws
`AppendIntentConflictError`.

## Identity and views

The configured `ROOT_WITNESS_ID` is inserted when the store is created and is exported for
bootstrap appends. It is a semantic record without an owner-local view.

Semantic records are deduplicated by `record_id`. `readRecord(id)` returns one body and envelope
plus every owner-local occurrence. `readOwner(ownerId)` returns occurrences ordered by
`owner_ordinal`. The same semantic record may appear on multiple owner paths without changing its
identity.

Returned record bodies are immutable snapshots. Reading a corrupt stored envelope fails identity
validation rather than returning unverified content.

## Migrations and lifecycle

Migrations are contiguous from version one, use versioned historical ordinal bounds, must match
the configured supported version and current append contract, and are committed individually.
Opening an existing database applies every pending migration; opening a database with a newer
schema or a mismatched migration registry throws
`UnsupportedStoreSchemaError`. A failed migration rolls back its schema-version marker.
Each migration reads the applied schema version inside its own configured `IMMEDIATE`
transaction, and the switch to write-ahead logging retries SQLite's deadlock-avoidance
`SQLITE_BUSY` within `kernel.store.busyTimeoutMilliseconds`, so several processes may open one new
database at once: they serialize, later openers find the schema current, and all succeed
(F-029, fixed in 2.32.5; `test/storage/process-race.test.ts`). Migration drills build a store at every historical schema from these steps and require each to
upgrade with integrity and an unchanged export; the forward-only downgrade policy and verified
backup and restore are defined in [backup, restore, and migration](./backup-restore-and-migration.md).

Schema v2 adds content-addressed blob metadata and storage receipts. Existing schema-v1 databases
upgrade without rewriting semantic records. Blob filesystem behavior is documented in
[Content-addressed blob storage](./blob-storage.md).

Schema v3 adds published trace-cut resolver entries. Cut publication remains authoritative through
its semantic record; the table is a verified resolver index. Existing schema-v2 stores upgrade
without rewriting records or receipts. Query behavior is documented in
[Trace cuts and causal slices](./trace-queries.md).

Schema v4 adds durable first-writer invocation claims. Schema v5 adds configured lease expiry,
monotonic fencing tokens, and an atomically consumed start flag. Legacy v4 claims are marked
consumed during migration because their prior start state cannot be proven safely. Guarded claim
and append methods serialize takeover and start publication with the configured immediate
transaction.

Schema v6 adds consume-once retained-world settlement admission and schema v7 adds nullable
effect-journal operation, receipt, and cleanup evidence. Schema v8 adds bounded open-operation
bookkeeping and atomic repair commit markers used only by
[orphaned operation diagnosis and repair](./orphan-operation-repair.md).
It does not grant authority over canonical records, providers, worlds, custody, settlements, Git,
or user files. Schema v9 adds live scope registration and single-writer claim tables used by
[durable scope registration](./scope-registration.md); scope evidence itself remains canonical
records, and the tables are verified indexes that are never exported. Schema v10 adds
`trace_subscriptions`, the acknowledged cursor of each durable
[trace subscription](./trace-subscriptions.md). Schema v11 adds `supervised_dispatches`, the
registration and fenced decision lease of each [supervised dispatch](./supervised-effects.md).
Both are bookkeeping outside the record graph and are never exported. `append` refuses groups
targeting dispatch or context-channel owner paths, which only the supervision transactions write.
Schema v12 adds `replay_sessions`, the registration, fenced writer lease, and terminal flag of each
[replay session](./replay-sessions.md). It is bookkeeping outside the record graph and is never
exported. `append` refuses groups on replay session owner paths and `publishCut` refuses a replay
session as the publishing owner, so only fenced session transactions write session evidence.
Schema v13 is index-only: `records_by_schema` on `records(schema_ref, record_id)` and
`trace_cuts_by_publication` on the canonical byte order of `trace_cuts`. It adds no row or column
and changes no export; an index that already exists is kept.

Schema v14 adds store-local compensation ownership linked to the canonical attempt record.
Admission and attempt publication are atomic; renewal and outcome commit require the exact live
fence. Integrity verifies the row against the attempt and latest outcome. Semantic archives omit
leases; see [compensation ownership](./compensation.md#durable-ownership-inspection-1330).

## Query plans

The SQL behind `readRecord`, `readOwner`, `readOwnerPrefix`, `readCut`/`resolveCut`, cut iteration
and subscription pulls, append planning, the integrity parent lookup, `listOwnersBySchema`, and
`listCuts` lives in the internal
[`src/store/statements.ts`](../src/store/statements.ts).
[`test/store/query-plans.test.ts`](../test/store/query-plans.test.ts) runs `EXPLAIN QUERY PLAN` on
each statement, before and after planner statistics exist, and requires no full table scan: point
lookups must `SEARCH` a primary key or index, and the two paged listings may walk an index but
never scan a table. Before schema v13, `listOwnersBySchema` scanned `records` and `listCuts` scanned
`trace_cuts`.

## Maintenance

`maintain({ mode })` runs one semantics-preserving pass on a writable handle, implemented in
[`src/store/maintenance.ts`](../src/store/maintenance.ts). Modes and limits come from
`kernel.store.maintenance` in [protocol configuration](./protocol-configuration.md):

| Mode | Effect |
| --- | --- |
| `inspect` (default) | `PRAGMA quick_check` (bounded to `quickCheckMaxIssues` lines) and a space report; changes nothing |
| `checkpoint` | also `PRAGMA wal_checkpoint(TRUNCATE)` (the configured `walCheckpointMode`) |
| `optimize` | also `PRAGMA optimize`, which may refresh planner statistics |
| `vacuum` | also `VACUUM`, then the configured checkpoint so the rebuilt file replaces the log |

Every mode reports `page_size`, `page_count`, `freelist_count`, database bytes, and write-ahead-log
bytes before and after. Mutating modes run `quick_check` first and refuse a database that fails it
with `TraceStoreError`; `inspect` reports the issues instead. A read-only handle is refused with
`TraceStoreReadOnlyError` (`TRACE_STORE_READ_ONLY`) before anything is read. No mode changes a
record, view, cut, intent, or blob: [`test/store/maintenance.test.ts`](../test/store/maintenance.test.ts)
and the [scale tier](./performance-report.md#scale-tier) require `exportTrace()` to be
byte-identical before and after every mode. `VACUUM` needs an exclusive lock and fails with a SQLite
busy error while another connection holds a transaction; a checkpoint that other readers block
reports `busy: true`. SQLite commits `VACUUM` atomically, so an interrupted vacuum leaves the
previous file. `shepherd-ts store maintain [--store PATH] [--mode MODE]` wraps the method
([CLI](./cli.md)).

Execution projections are disposable reads and therefore add no schema migration. The
`projectExecution(cutId)` and `projectEffectiveHistory(cutId)` facades resolve payload-visible,
both-mode slices at verified immutable cuts and fold the configured lifecycle and relation
schemas. Effective-history reads strictly resolve every active child address. Projection behavior
is documented in [Execution-history projections](./execution-history-projections.md).

`verifyIntegrity()` scans every retained store area and returns stable classified issues without
repairing evidence. `diagnoseAppend(intentId)` distinguishes a clean retry boundary, a verified
commit, and retained state requiring manual recovery. These read-only diagnostics add no schema
migration and are documented in
[Store integrity and append recovery](./store-integrity-and-recovery.md).

`exportTrace()` serializes one verified store snapshot into deterministic native archive JSON.
`importTrace()` stages and verifies an archive before atomically publishing its SQLite state into
a pristine store. Records, views, intents, cuts, and blobs preserve their identities. The
interchange boundary is documented in [Native trace interchange](./trace-interchange.md).

`collectBlobOrphans()` uses the same immediate write lock as blob publication. It defaults to
inspection, verifies registered content, and deletes only unregistered filesystem objects when
explicitly requested. The safety boundary is documented in
[Blob orphan collection](./blob-orphan-collection.md).

The database and read decoder both enforce configured owner-ordinal bounds and non-empty owner
identifiers. This prevents externally modified rows from bypassing the public `RecordView`
contract.

Call `close()` when finished, use `using` with `Symbol.dispose`, or both. Closing is idempotent.
Append and read operations after closure throw `TraceStoreError`.

Passing `{ readOnly: true }` opens only an existing current-schema file database and existing blob
directory. It skips writable PRAGMAs, migrations, and root-witness insertion; absent or older
schema state fails closed. This is the CLI diagnostic/read boundary, not a way to bypass ordinary
write validation.

Passing `{ secretScanning: "refuse" }` scans every record body of every append, including appends
the store makes inside its own transactions, and every body of an archive being imported, against
the configured detectors before anything is written; a match raises `TraceSecretDetectedError`
without matched text and leaves the intent reusable. The default `"off"` scans nothing. A writable
open of a file database creates it owner-only (`0600` by configuration) and tightens an existing
owned database and its WAL, SHM, and journal sidecars; read-only opens change no file modes. Since
2.32.2 (F-023) every such file is opened with `O_NOFOLLOW` and checked and tightened through the
descriptor (`fstat`, `fchmod`), so a symbolic link at a database or sidecar path is never followed
or changed, and a creation failure other than an existing file (for example `EACCES` or `ENOENT`)
is thrown with its file-system code instead of being left to SQLite. See
[secrets and retention](./secrets-and-retention.md).

Every `witness_ref` must name a retained or earlier record in the batch whose schema is the root
witness or `kernel.queries.witnessSchemaRef`; since 2.32.2 (F-014) `append` refuses any other
record with `TraceStoreError` ("witness_ref does not name a witness record") before writing, so
the documented API can no longer produce a store that fails `verifyIntegrity` with
`witness_mismatch`.

## Current boundary

This slice provides exact-ID, owner-path, immutable-cut, causal-closure, execution, and
effective-history reads, content-addressed external blob storage, whole-store integrity scans,
append recovery diagnosis, native trace interchange, verified blob-orphan collection, and
semantics-preserving maintenance. Measured performance and SLOs for the reference host are in the
[performance report](./performance-report.md).
It also provides bounded read-only orphaned-operation diagnosis and explicit exact
bookkeeping-only repair with canonical audit evidence.
Remote-store abstractions remain planned TypeScript trace-kernel work.
