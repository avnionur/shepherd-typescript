# Retained-World Settlement Admission

Implementation:
[`src/store/retained-world-settlements.ts`](../src/store/retained-world-settlements.ts).
Public store entry point: [`src/index.ts`](../src/index.ts). Production-seam tests:
[`test/store/retained-world-settlements.test.ts`](../test/store/retained-world-settlements.test.ts).

## Implemented foundation

Workspace protocol v12 defines the closed `select`/`discard` vocabulary, durable settlement
states, exact request identity, version, and stable validation/conflict errors. Trace-store schema
v6 adds one durable settlement row per exact retained `output_id`, plus unique `command_id` and
content-addressed `request_id` identities.

`SQLiteTraceStore.admitRetainedWorldSettlement` is the internal store-level compare-and-swap. One
`BEGIN IMMEDIATE` transaction either inserts the configured `prepared` decision, replays the exact
same request, or rejects a different command/request that already names the output or command.
`readRetainedWorldSettlement` verifies and returns the frozen prepared decision after restart.

The exact request binds action, protocol version, run, output, capture record, execution cut,
binding, base/head revisions, changeset, custody, user-basis witness, and caller command. Its
content-addressed ID uses the configured workspace digest and settlement prefix.

## Current boundary

The store primitive deliberately does not authenticate execution, carrier, Git, or binding
evidence and does not mutate user files or physical custody. It is marked internal. The next Phase
3 slice owns that evidence join and a public read-only settlement inspection. Public `select` and
`discard` remain unavailable until authenticated admission, effect journaling, basis revalidation,
and crash recovery compose with this CAS. Carrier-level `discard(custodyId)` remains a distinct
physical cleanup primitive and does not create a settlement decision.

