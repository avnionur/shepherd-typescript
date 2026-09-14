# Native Trace Interchange

Implementation:
[`src/interchange`](../src/interchange) and
[`SQLiteTraceStore`](../src/store/sqlite-trace-store.ts). Public exports:
[`src/index.ts`](../src/index.ts). Schema:
[`spec/schemas/trace-archive-v1.schema.json`](../spec/schemas/trace-archive-v1.schema.json).
Tests and fixtures:
[`test/interchange`](../test/interchange) and
[`test/fixtures/trace-archive-v1.json`](../test/fixtures/trace-archive-v1.json).

## Archive contract

`exportTrace()` returns deterministic compact JSON for the configured
`shepherd.trace.archive` format version 1. One coherent SQLite read snapshot contains:

- canonical record bodies and envelopes;
- owner-local views, ordinals, append positions, and append-intent identities;
- append digests and durable receipt JSON needed for idempotent replay;
- verified published-cut resolver entries;
- content-addressed blobs encoded with configured canonical base64;
- the kernel ABI, canonicalization version, and archive format version.

Export first verifies SQLite, records, parents, witnesses, views, receipts, cuts, and blobs. A
store with classified corruption is not exportable. Live authority tables, including durable
invocation claims, settlement admissions, orphan bookkeeping, scope registration or writer
rows, supervised dispatch leases, durable subscription cursors, and replay session leases, are never
exported; imported scopes and supervised dispatches are inspection evidence only. Imported replay
sessions, with their world and process image blobs, can be inspected, rewound, and replayed into new
branch sessions in the importing store. Unknown schema-specific record-body fields
remain canonical semantic data and round-trip without interpretation.

## Import contract

`importTrace(archiveJson)` accepts ordinary JSON whitespace but enforces the closed archive shape,
configured versions, record identities, referential integrity, owner paths, append receipts, cuts,
and blob digests. It first builds and verifies the complete archive in an isolated staging store.
Only then does one immediate SQLite transaction verify the target, confirm that it remains
pristine under the write lock, and publish the archive.

The target must be pristine: its only record is the configured root witness, and it contains no
views, intents, cuts, or registered blobs. This boundary prevents ambiguous merges while
preserving every imported owner ordinal and append intent exactly. Equal original append requests
remain idempotently replayable, and new appends continue from imported owner ordinals.
Import derives each owner counter from its greatest retained ordinal, independent of archive array
ordering.

A failed target transaction rolls back all SQLite state. As with ordinary blob receipt recovery,
content-addressed bytes published immediately before a late SQLite failure may remain as
unregistered deduplicated files; they are invisible through the store and safe for an identical
retry. Import never repairs or rewrites source identities.

## Compatibility boundary

Native archive v1 is the lossless trace-kernel interchange format. ATIF represents higher-level
agent trajectories, steps, and tool interactions. An ATIF adapter belongs after those runtime
records exist and must not replace the identity-preserving native archive.
