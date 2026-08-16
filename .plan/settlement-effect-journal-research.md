# Settlement Effect-Journal Contract

Status: Phase 3, Task 9.1 implementation input. This document closes the durable state and receipt
boundary required before public `select` or `discard` may mutate carrier or user-workspace state.

## Current gap

Workspace protocol v12 and trace-store schema v6 retain one exact consume-once request in
`prepared`. The configured vocabulary also names `applying`, `selected`, and `discarded`, but the
current row has no deterministic operation identity, effect receipt, cleanup receipt, or validated
transition API. Treating the unused state strings as implemented would make a crash after an
external effect indistinguishable from corruption.

## Authority and invariants

The exact authenticated settlement request remains the immutable authority. Task 9 must not
replace it, resolve a selector, or derive a new command. Every later transition binds:

- the retained request ID and caller command ID;
- exact output, run, capture, cut, binding, base/head revision, changeset, custody, and basis;
- the configured action;
- one deterministic operation ID derived from the complete request;
- the prior durable settlement state and exact prior receipt.

One output and one command continue to name at most one request. A transition never changes the
request JSON or its digest. Another command/action cannot recover or complete the winning
operation.

## Persisted state machine

```text
prepared(request)
  -> applying(operation)
  -> selected(operation, publication receipt)
  -> discarded(operation, cleanup pending|complete receipt)
```

`selected` and `discarded` are terminal and mutually exclusive. `applying` is permitted for
selection only because user-workspace publication spans SQLite and filesystem resources. Discard
records its terminal `discarded` decision before physical cleanup; cleanup progress is a receipt
inside that terminal state and never makes the output selectable again.

Exact retries return the retained state. A request for a skipped, reversed, or different
transition conflicts or fails closed. Unknown state, operation, or receipt fields are corruption.

## Deterministic operation evidence

The operation semantic content contains:

- operation protocol version and configured operation kind;
- request ID, command ID, action, output ID, and run ID;
- binding, base/head revision, changeset, custody, capture record, cut, and basis witness.

Canonical configured hashing yields `operation_id`. The store persists canonical operation JSON
and its digest. Replay recomputes all three and requires byte equality. The operation is published
before the first external effect.

## Receipts

Selection receipt evidence must distinguish staging from publication and bind the exact target
basis before/after, immutable head content, staging identity, publication identity, and supported
atomicity classification. It must never infer success solely from current target bytes.

Discard receipt evidence binds the exact custody and immutable parent/head citations, records that
the user basis was not mutated, and classifies cleanup as pending or complete. Cleanup completion
is idempotent and may be repaired after restart without reopening settlement admission.

All receipt objects are closed exact data, canonically encoded, digest-bound, resource-bounded,
and versioned through configuration. No path outside authenticated binding/carrier authority is
stored as semantic identity.

## Schema and API boundary

Trace-store schema v7 should extend the settlement row with nullable operation and receipt
columns. Database checks enforce all-null at `prepared`, required operation evidence afterward,
and terminal receipt shape through the package codec. Migration of existing schema-v6 rows leaves
them exactly `prepared` with null effect evidence.

Internal store transitions should be narrow compare-and-swap operations:

1. begin/replay the exact deterministic operation from `prepared`;
2. retain/replay one exact terminal receipt from `applying` or the discard terminal path;
3. retain/replay discard cleanup completion without changing terminal authority;
4. inspect and validate the complete row after restart.

Public settlement effects remain unavailable until these transitions compose with authenticated
Task 8 preparation and production-seam fault tests.

## Recovery classifications

- `prepared`: admitted; no external effect was authorized.
- `applying`: exact selection operation owns recovery; another verb refuses.
- `selected`: exact publication receipt is terminal.
- `discarded_cleanup_pending`: discard is terminal; retry only exact custody cleanup.
- `discarded`: discard and cleanup receipt are complete.
- `invalid`: malformed, skipped, duplicate, or inconsistent evidence; no automatic mutation.

The cleanup-pending value is a read projection over terminal `discarded` plus its receipt, not a
new settlement state literal.

## Task 9 implementation order

1. Task 9.2: schema v7, configured operation/receipt contracts, transactional transitions, and
   restart-safe inspection without external effects.
2. Task 9.3: public exact-ID discard, terminal decision before idempotent custody cleanup, and
   cleanup recovery.
3. Task 9.4: select staging/materialization, two basis checks, publication receipt, and crash
   repair.
4. Task 9.5: execution-trace settlement citations and the remaining concurrency/fault matrix.

## Required Task 9.2 evidence

- schema-v6 prepared rows migrate without semantic change;
- exact operation begin and terminal replay survive reopen;
- altered command/request/operation/receipt conflicts or fails closed;
- skipped/reversed transitions and unknown states are rejected;
- two SQLite connections cannot publish different operations or terminal receipts;
- corrupt nullable-column combinations fail inspection;
- Task 8 prepared admission and inspection retain their current behavior.
