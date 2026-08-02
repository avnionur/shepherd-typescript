# Store Integrity and Append Recovery

Implementation:
[`src/store/integrity.ts`](../src/store/integrity.ts),
[`src/store/append-recovery.ts`](../src/store/append-recovery.ts), and
[`SQLiteTraceStore`](../src/store/sqlite-trace-store.ts). Public exports:
[`src/index.ts`](../src/index.ts). Tests:
[`test/store/integrity.test.ts`](../test/store/integrity.test.ts) and
[`test/store/recovery.test.ts`](../test/store/recovery.test.ts).

## Whole-store verification

`verifyIntegrity()` performs a read-only scan from one coherent SQLite snapshot and returns a
frozen `TraceIntegrityReport`. It checks:

- SQLite's native integrity and foreign-key results;
- canonical record decoding and content identity;
- exact causal-parent index order and parent existence;
- configured root and ordinary witness schemas;
- non-root records retained by at least one owner occurrence;
- append receipts against their committed rows and append positions;
- owner-ordinal contiguity and each owner's persisted next ordinal;
- published cut indexes against their authoritative publication records;
- registered blob metadata, receipts, and filesystem content.

Issues contain a stable `kind` and `subject_id`; they do not expose backend exception text. Counts
describe the rows and owner paths examined. `ok` is true only when the issue list is empty.
Ordinary retained corruption is classified in the report. Operational failures that prevent the
scan itself, such as a missing SQLite table, still throw.

The scan does not repair, infer, delete, or rewrite retained state. It adds no storage migration.

## Append recovery diagnosis

`diagnoseAppend(appendIntentId)` inspects one intent without requiring the original batch:

- `retry_safe` means neither an intent receipt nor rows claiming that intent remain;
- `committed` means the receipt decodes and exactly matches committed owner occurrences, causal
  edges, record order, and ordinal ranges;
- `manual_recovery_required` with `receipt_mismatch` means retained receipt evidence is malformed
  or disagrees with committed rows;
- `manual_recovery_required` with `orphaned_rows` means retained owner occurrences or a published
  cut still claim the intent after its receipt row disappeared.

The diagnosis never guesses that an inconsistent append succeeded and does not automatically
retry or repair it. Callers may retry only the `retry_safe` state using the original append
request. A `committed` result is already eligible for the existing idempotent append replay path.
