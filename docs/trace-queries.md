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

## Async owner-record iteration

`SQLiteTraceStore.iterateCutRecords(cutId)` returns a single-use
`AsyncGenerator<OwnerRecord, void, unknown>`. It is available through the Node root and trace
entries; `OwnerRecord` is also available through the type-only `/read` entry.

```ts
for await (const record of store.iterateCutRecords("cut:review")) {
    console.log(record.view.owner_ordinal, record.envelope.record_id);
}
```

The first pull validates the identifier and authenticates the published cut. Each pull reads one
occurrence in ascending order from the configured first ordinal through the inclusive cut address.
Repeated semantic IDs retain distinct occurrences. Later appends, including the cut-publication
record on the target owner, cannot extend that address. Iterators have independent progress.

The implementation uses exact-ordinal reads, not a materialized owner array or a suspended SQLite
cursor. No transaction or cursor remains open across yields. Database work is synchronous per pull;
the async interface provides pull-based consumption, not worker-thread offloading or a live feed.
Bounded reading means one occurrence at a time, not a fixed payload-byte ceiling. Cut authentication
also reads its publication evidence. `break`, `return()` and consumer exceptions stop iteration
without closing the caller-owned store; the store must remain open for subsequent reads.

Canonical bodies/envelopes and owner views are validated before each yield. Missing occurrences
or payload records cause errors instead of silent truncation, and the terminal occurrence must
still match the cut address. Integrity is incremental: a later error does not retract earlier
values. This is not a cross-pull SQL snapshot or protection against out-of-band database mutation.

These are full-payload owner records, not graph-shaped slices: no witness closure, causal anchors,
mode filtering, visibility/redaction, authorization, resume tokens, or transport is provided.
Existing synchronous reads and slice semantics are unchanged. Tests:
[`cut-iteration.test.ts`](../test/store/cut-iteration.test.ts) and
[`installed package conformance`](../tooling/testing/packaged-cli.ts).

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
