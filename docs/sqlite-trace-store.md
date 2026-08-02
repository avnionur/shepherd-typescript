# SQLite Trace Store

Implementation:
[`src/store/sqlite-trace-store.ts`](../src/store/sqlite-trace-store.ts) and the
[`src/store`](../src/store) module. Public exports:
[`src/index.ts`](../src/index.ts). Tests:
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
2. loads known record identities and owner ordinal state;
3. validates causal parents and witnesses;
4. inserts deduplicated semantic records and ordered parent edges;
5. inserts owner-local record views and advances changed owner ordinals;
6. stores the deterministic append receipt and commits.

Any validation or SQLite error rolls back the receipt, records, edges, views, and ordinal changes.
The same intent may therefore be retried after a failed append.

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

Schema v2 adds content-addressed blob metadata and storage receipts. Existing schema-v1 databases
upgrade without rewriting semantic records. Blob filesystem behavior is documented in
[Content-addressed blob storage](./blob-storage.md).

Schema v3 adds published trace-cut resolver entries. Cut publication remains authoritative through
its semantic record; the table is a verified resolver index. Existing schema-v2 stores upgrade
without rewriting records or receipts. Query behavior is documented in
[Trace cuts and causal slices](./trace-queries.md).

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

The database and read decoder both enforce configured owner-ordinal bounds and non-empty owner
identifiers. This prevents externally modified rows from bypassing the public `RecordView`
contract.

Call `close()` when finished, use `using` with `Symbol.dispose`, or both. Closing is idempotent.
Append and read operations after closure throw `TraceStoreError`.

## Current boundary

This slice provides exact-ID, owner-path, immutable-cut, causal-closure, execution, and
effective-history reads, content-addressed external blob storage, whole-store integrity scans,
append recovery diagnosis, and native trace interchange. Orphan collection and remote-store
abstractions remain planned TypeScript trace-kernel work.
