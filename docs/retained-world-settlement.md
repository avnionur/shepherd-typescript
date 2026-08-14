# Retained-World Settlement Admission

Implementation:
[`src/store/retained-world-settlements.ts`](../src/store/retained-world-settlements.ts).
Authenticated coordinator:
[`src/workspace/retained-world-settlement.ts`](../src/workspace/retained-world-settlement.ts).
Public entry point: [`src/index.ts`](../src/index.ts). Production-seam tests:
[`test/store/retained-world-settlements.test.ts`](../test/store/retained-world-settlements.test.ts)
and [`test/workspace/task-world-execution.test.ts`](../test/workspace/task-world-execution.test.ts).

## Implemented foundation

Workspace protocol v12 defines the closed `select`/`discard` vocabulary, durable settlement
states, exact request identity, version, and stable validation/conflict errors. Trace-store schema
v6 adds one durable settlement row per exact retained `output_id`, plus unique `command_id` and
content-addressed `request_id` identities.

Trace-store schema v7 extends that row with nullable operation, receipt, and cleanup-evidence
columns. Migration preserves every schema-v6 `prepared` request exactly and leaves the new columns
null. Workspace protocol v13 adds configured deterministic operation and terminal-receipt codec
versions plus the content-addressed operation identity prefix. The closed codec binds the entire
authenticated request into the operation, requires canonical persisted JSON, distinguishes
selected publication from discarded cleanup evidence, and forbids discard from changing the user
basis. Transactional journal writers remain Task 9.2B2.

`SQLiteTraceStore.admitRetainedWorldSettlement` is the internal store-level compare-and-swap. One
`BEGIN IMMEDIATE` transaction either inserts the configured `prepared` decision, replays the exact
same request, or rejects a different command/request that already names the output or command.
`readRetainedWorldSettlement` verifies and returns the frozen prepared decision after restart.

The exact request binds action, protocol version, run, output, capture record, execution cut,
binding, base/head revisions, changeset, custody, user-basis witness, and caller command. Its
content-addressed ID uses the configured workspace digest and settlement prefix.

`prepareRetainedWorldSettlement` is the public authenticated admission seam. Before invoking the
store compare-and-swap, it reconstructs the committed durable execution, validates the exact
terminal cut and capture journal, authenticates the package-created binding and carrier, reopens
and verifies both immutable revisions, recomputes the canonical changeset, and verifies that the
cited mutable custody still contains the captured head. Any disagreement fails with the stable
configured invalid-settlement error before admission.

`inspectRetainedWorldSettlement` is the public restart-safe read seam. It returns `undefined` for
an exact output with no admission. For a retained decision it verifies the closed settlement row,
reconstructs the committed durable execution, and requires the cited cut, capture record, run,
binding, revisions, changeset, custody, and basis witness to agree. It performs no carrier or user
filesystem operation.

## Current boundary

The store primitive deliberately remains internal and trusts only the authenticated coordinator.
Preparation reads retained evidence and mutates only the durable settlement-admission row; it does
not mutate user files or physical custody. Public `select` and `discard` remain unavailable until
Task 9 effect journaling, basis revalidation, and crash recovery compose with this CAS.
Carrier-level `discard(custodyId)` remains a distinct physical cleanup primitive and does not
create a settlement decision.
