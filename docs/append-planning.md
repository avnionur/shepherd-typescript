# Append Planning Contract

Implementation:
[`src/append/plan.ts`](../src/append/plan.ts),
[`src/append/validation.ts`](../src/append/validation.ts), and
[`src/append/types.ts`](../src/append/types.ts). Public exports:
[`src/index.ts`](../src/index.ts). Tests:
[`test/append-batch.test.ts`](../test/append-batch.test.ts) and
[`test/protocol-schema.test.ts`](../test/protocol-schema.test.ts).

## Scope

`planAppendBatch(batch, state)` is a pure planning boundary. It validates ordered append drafts,
creates versioned record envelopes, resolves causal parents, and assigns owner-local views. It
does not write to storage or claim atomic durability. The
[SQLite trace store](./sqlite-trace-store.md) consumes the plan inside one durable transaction.

## Draft structure

An `AppendBatchDraft` contains ordered `AppendGroupDraft` values. Each group names one
`owner_id`, optional stored parents shared by the group, and ordered `AppendRecordDraft` values.

A record draft contains its body, mode, schema reference, witness reference, optional direct
parents, and optional append-local references. An optional `append_local_id` lets later drafts
cite the planned record without predicting its digest.

The language-neutral wire schema is
[`spec/schemas/append-batch-draft-v0.schema.json`](../spec/schemas/append-batch-draft-v0.schema.json).

## Parent resolution

Parent order is normative:

1. group `caused_by_record_ids`;
2. record `caused_by_record_ids`;
3. record `caused_by_local_refs`, resolved in listed order.

Every direct parent must appear in `state.known_record_ids` or must have been planned earlier in
the same batch. Every local reference must name an earlier draft. Self references and forward
references are rejected.

The combined parent list must not contain duplicate record IDs. Its order is passed directly to
`createRecordEnvelope`, so changing parent order changes semantic identity.

## Owner ordinals

`state.next_owner_ordinals` contains the next unallocated ordinal for known owners. A new owner
starts at the configured `kernel.append.firstOwnerOrdinal`, currently zero. Repeated groups for
the same owner continue the same sequence. The last allocatable position is the configured
`kernel.append.lastOwnerOrdinal`, one below JavaScript's maximum safe integer so the following
next-ordinal state remains exactly representable.

The planner returns:

- records in batch and group order;
- an inclusive ordinal range for each changed owner;
- the next unallocated ordinal for every supplied or changed owner;
- ordered parent-to-child causal edges.

Owner IDs and ordinals live in `RecordView`, outside the semantic envelope. Persisted views also
expose their append-intent identity, while pure pre-persistence plans omit it. The same semantic
record can therefore be placed on multiple owner paths without changing `record_id`.

The record-view wire schema is
[`spec/schemas/record-view-v0.schema.json`](../spec/schemas/record-view-v0.schema.json).

## Snapshot and failure behavior

Bodies are canonicalized into independent, deeply frozen snapshots before envelopes are created.
Envelopes, record views, record objects, record arrays, and causal-edge arrays are also frozen.
Later mutation of caller-owned input cannot change a planned record, and a planned body's digest
cannot be invalidated by mutation before persistence.

Runtime validation matches the closed wire shape: unsupported fields, inherited/class-instance
objects, symbols, accessors, sparse arrays, and custom array properties are rejected without
invoking getters. Malformed identifiers, modes, duplicate parents, duplicate local IDs, and
invalid ordinal state throw `TypeError`. Unknown causal parents and safe-integer ordinal
exhaustion throw `RangeError`. Planning has no external side effects, so a failure publishes no
partial plan.
