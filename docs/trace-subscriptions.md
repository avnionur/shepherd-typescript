# Durable cursor trace subscriptions

Implementation: [`src/supervision/subscription.ts`](../src/supervision/subscription.ts) and the
cursor codec in [`src/supervision/records.ts`](../src/supervision/records.ts). Store bookkeeping:
[`src/store/trace-subscriptions.ts`](../src/store/trace-subscriptions.ts). Configuration:
`supervision.subscriptions` in [`protocol.config.json`](../protocol.config.json), read by
[`src/protocol/config-supervision.ts`](../src/protocol/config-supervision.ts). Public entry points:
[`src/facades/supervision.ts`](../src/facades/supervision.ts) and [`src/index.ts`](../src/index.ts).
Schema: [`supervision-cursor-v1`](../spec/schemas/supervision-cursor-v1.schema.json). Tests:
[`trace-subscription.test.ts`](../test/supervision/trace-subscription.test.ts),
[`supervision-crash.test.ts`](../test/supervision/supervision-crash.test.ts), and
[`passive-observation.test.ts`](../test/supervision/passive-observation.test.ts). Contract:
[live supervision contract](../.plan/live-supervision-contract.md).

## Scope

`openTraceSubscription(store, options)` is the observer role. It reads committed records of an
exact set of owner paths and never appends a record. It cannot return a decision or affect a
worker; interception is a separate API ([supervised effects](./supervised-effects.md)).

## Cursor

A cursor is the canonical vector of next owner ordinals, one position per selected owner, in
owner-identity order:

```json
{
    "compatibility_version": "shepherd.supervision.v1",
    "cursor_id": "supervision-cursor:sha256:<hex>",
    "cursor_version": 1,
    "positions": [{ "next_ordinal": 2, "owner_id": "worker:a" }]
}
```

`cursor_id` is a content digest of the version and positions. Delivery interleaving, poll timing,
and timestamps are not part of it, so the same retained prefix always has the same cursor.
Untrusted cursors are revalidated, including their digest.

Every delivery carries the cursor that acknowledges it and every earlier delivery. Records are
committed owner occurrences, so observers see a record only after its append transaction commits.

## Options

| Option | Default | Meaning |
| --- | --- | --- |
| `owners` | required | Exact distinct owner paths, bounded by `maxOwners` |
| `subscriptionId` | none | Durable identity; omit for an ephemeral subscription |
| `start` | `"origin"` | `"origin"`, `"head"`, or an explicit cursor for a new or ephemeral subscription |
| `bufferCapacity` | configured default | Maximum buffered undelivered records |
| `overflow` | backpressure, no bound | `{ policy: "backpressure" \| "fail", maxLagRecords }` |
| `pollIntervalMilliseconds` | configured default | Wait between store reads while nothing new is retained |
| `signal` | none | Ends iteration when aborted |

## Delivery, backpressure, and overflow

The subscription is pull-driven. `next()` refills the buffer only when it is empty, reading at
most `bufferCapacity` records one owner at a time in canonical owner order. A slow observer
therefore holds records in the store, not in memory, and never slows a writer.

Before each refill the subscription computes lag: retained records not yet delivered. `metrics()`
reports buffered, delivered, current lag, and the high-water lag. With `policy: "fail"`, lag above
`maxLagRecords` closes the subscription with `SupervisionSubscriptionOverflowError`. No record is
dropped: the acknowledged cursor is unchanged and a reconnect resumes from it.

`close()` or an aborted signal ends iteration, including a pending wait, and discards the buffer
without acknowledging it.

## Acknowledgement and reconnect

`acknowledge(cursor)` accepts only a cursor for the same owners whose positions are not behind the
acknowledged cursor and not ahead of the delivered cursor. An equal cursor is idempotent.

A durable subscription retains its acknowledged cursor in the `trace_subscriptions` table (store
schema v10). The table is bookkeeping outside the record graph: it is not exported, not imported,
and not part of any record identity. The store acknowledgement is also monotonic per owner and
refuses positions beyond retained records.

Reopening a durable subscription with the same identity resumes strictly after the acknowledged
cursor:

- acknowledged records are never delivered again;
- no retained record is skipped;
- records delivered but not acknowledged before a crash are delivered again with the same owner
  and owner ordinal, so consumers can process them idempotently. Their cursors reflect the new
  interleaving and may differ from the cursors of the first delivery.

Reopening with different owners, or with an explicit start cursor that differs from the
acknowledged cursor, fails with `SupervisionCursorConflictError`. A start position name is used
only when the row is created.

Ephemeral subscriptions keep the cursor in memory and work on read-only stores. Durable
subscriptions require a writable store.

## Integrity

`verifyIntegrity()` reports `trace_subscription_mismatch` for a durable row whose owners, cursor
identity, or JSON is corrupt, or whose cursor passes retained records.

## Passive observation

The conformance test runs one worker scenario (scope emission, context injection, and allowed,
denied, and approved supervised effects) twice on fresh stores: without observers, and with two
durable subscriptions, one ephemeral subscription, and one subscription that overflows. The
exported trace archives are byte-identical and every dispatch inspection is equal.

The [runtime supervisor](./runtime-supervisor.md#ticks-and-snapshots) is a live consumer: each
tick it drains one ephemeral subscription over every worker stream up to the current heads, folds
the delivered records into the tick's snapshot, and retains the delivered cursor in the tick record,
so each decision names exactly the worker records it saw.

## Limits

- Subscriptions do not discover new owner paths.
- One durable identity serves one consumer. If several consumers share it, a consumer whose
  acknowledgement is behind the retained cursor fails with `SupervisionCursorConflictError`.
