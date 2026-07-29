# Trace Cuts and Causal Slices

Implementation:
[`src/store/cuts.ts`](../src/store/cuts.ts),
[`src/store/slices.ts`](../src/store/slices.ts), and
[`src/store/query-validation.ts`](../src/store/query-validation.ts). Public API:
[`SQLiteTraceStore`](../src/store/sqlite-trace-store.ts). Tests:
[`test/store/cuts.test.ts`](../test/store/cuts.test.ts) and
[`test/store/slices.test.ts`](../test/store/slices.test.ts).

## Published cuts

A cut is an immutable address through one occurrence on an owner path. `publishCut(spec)` resolves
the latest occurrence of `through_record_id` on `target_owner_id`, appends a configured semantic
cut-publication record, and writes the resolver index in the same SQLite transaction. Reusing the
same cut and append intent returns the original result; conflicting reuse fails without retaining a
second publication.

`readCut(id)` verifies the resolver index against its content-addressed publication record, direct
through-record cause, publishing owner occurrence, and append intent. `resolveCut(id)` reads the
addressed owner prefix through the stored inclusive ordinal. Records appended later do not change
the result, including when the target owner also publishes the cut. Store schema v3 adds the
`trace_cuts` resolver table and migrates existing stores without rewriting records, blob receipts,
or append receipts.

## Graph-shaped slices

`readOwnerPrefix(ownerId, through, options)` selects retained occurrences on one owner through an
inclusive ordinal. `readCausalClosure(rootIds, options)` traverses every ordered causal parent
transitively before applying the mode filter.

Every returned `Slice` is frozen and contains:

- selected records keyed by content identity;
- every retained occurrence of selected IDs grouped into deterministic owner paths;
- direct causal edges whose endpoints are both selected;
- direct omitted parents as external anchors when the closure policy requests them;
- witness support closed independently to the configured root witness;
- either payload-visible witness records or shape-only witness anchors.

The kernel never synthesizes a transitive edge across a filtered record. `visible_only` suppresses
external anchors; `include_external_anchors` is the configured default.

## Mode and visibility

Configured mode filters are `both`, `captures_only`, and `declarations_only`. Mode filtering
applies to traversal records, not supporting witnesses.

Configured visibility profiles are `payload`, `shape_only`, and `full_internal`. Shape-only reads
retain verified envelopes and owner views while omitting semantic bodies. Because the current
kernel has no internal context diagnostics, `full_internal` currently returns the same semantic
payload records as `payload`.

Read authorization and operation contexts remain a later runtime capability. These query methods
grant no authority and mutate no retained state.

## Validation and integrity

Selectors and options are closed, descriptor-safe data shapes. Accessors, symbols, sparse arrays,
custom properties, unknown configured values, malformed IDs, and unsafe ordinals are rejected
without evaluating user code.

Reads fail closed when roots, causal parents, owner-view records, witnesses, cuts, or publication
evidence are absent or corrupt. Supporting records must use either the configured ordinary witness
schema or the configured root-witness schema.
