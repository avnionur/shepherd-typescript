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

## Input limits

From 2.32.0, `importTrace` and `verifyRedactedTraceArchive` bound untrusted archive text with the
operational `kernel.interchange.limits` section of `protocol.config.json`
([`src/interchange/limits.ts`](../src/interchange/limits.ts)). The limits are not part of the
archive format identity; lowering them never changes what a valid archive means.

| Limit | Default | Checked |
| --- | --- | --- |
| `maxArchiveBytes` | 268,435,456 (256 MiB) UTF-8 bytes | Before `JSON.parse`; `shepherd-ts store import` compares the file size before reading the file |
| `maxNestingDepth` | 4,096 array and object levels | Before `JSON.parse`, by a linear scan that skips string contents |
| `maxAppendIntents`, `maxBlobs`, `maxCuts`, `maxRecords`, `maxRecordViews` | 1,000,000 each; 4,000,000 views | After parsing, before any record or blob is decoded |
| `maxBlobBytes` | 201,326,592 (192 MiB) declared blob bytes in total | Before each blob is decoded; each blob's base64 text must also have exactly the canonical padded length for its declared byte length |

An exceeded limit raises `TraceArchiveLimitError` (`TRACE_ARCHIVE_LIMIT_EXCEEDED`, a `TypeError`)
whose `limit` names the configured member; nothing is written. The same pre-parse scan refuses an
object with a repeated key (escaped spellings included) as malformed input, because `JSON.parse`
keeps the last value while other parsers keep the first or refuse. Archived `receipt_json` must be
the canonical receipt encoding. A store's own export is decoded without limits when
`exportRedactedTraceArchive` redacts it.

From 2.33.0 every archived record body, envelope, and receipt is also held to the canonical value
domain's configured nesting bound, `kernel.canonicalization.maxNestingDepth`
([canonical records](./canonical-records.md#nesting-bound)): a body one level deeper is refused with
`CanonicalNestingLimitError` (`CANONICAL_NESTING_LIMIT_EXCEEDED`) while the archive is decoded,
before anything is written. Load refuses an archive `maxNestingDepth` below
`kernel.canonicalization.maxNestingDepth + framingDepth`, so a body at the bound always fits in
an archive.

Within the bounds, decoding and the staged import still hold the parsed archive in memory; an
operator importing from untrusted sources can lower the bounds. Fuzz and corpus evidence is in
[fault and fuzz conformance](./fault-and-fuzz-conformance.md).

## Redacted archives and secret scanning

`importTrace` refuses the one-way redacted format (`shepherd.trace.redacted-archive`) with
`RedactedTraceArchiveError` before any other check, whether or not the target scans. A target opened
with `secretScanning: "refuse"` also scans every archived record body before staging and refuses a
match with `TraceSecretDetectedError`, leaving the target pristine. Native exports are complete and
unredacted; use `exportRedactedTraceArchive` from `./operations` for evidence that must not carry
bodies ([secrets and retention](./secrets-and-retention.md)).

## Compatibility boundary

Native archive v1 is the lossless trace-kernel interchange format. ATIF represents higher-level
agent trajectories, steps, and tool interactions. An ATIF adapter belongs after those runtime
records exist and must not replace the identity-preserving native archive.
