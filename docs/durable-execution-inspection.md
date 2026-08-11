# Durable Execution Inspection

Implementation:
[`src/run/durable-execution-inspection.ts`](../src/run/durable-execution-inspection.ts). Public
types: [`src/run/durable-execution-inspection-types.ts`](../src/run/durable-execution-inspection-types.ts).
Public entry point: [`src/index.ts`](../src/index.ts). Tests:
[`test/run/durable-execution-inspection.test.ts`](../test/run/durable-execution-inspection.test.ts).

## Contract

`inspectDurableTaskExecution(store, runId)` returns a frozen, read-only view of the durable task
execution retained under `runId`. It recognizes the same configured recovery states as
`readDurableTaskExecution`: `absent`, `created`, `started`, `terminal_pending_cut`, and `committed`.

The view exposes the run ID and recovery status together with the evidence available at that
state:

- creation, start, and terminal lifecycle record identities;
- validated waiting or suspension acknowledgement evidence, including its continuation descriptor
  and immutable trace cut;
- the configured running-continuation record identity after an exact resume;
- ordered artifacts paired with their retaining record identities;
- aggregate usage and terminal outcome paired with their retaining record identities;
- the immutable terminal cut when it has been published;
- direct canonical causal edges between the selected durable execution records.

Missing evidence is represented by empty arrays or `null`; it is never fabricated. Artifact order
matches configured durable ordinals. Causal edges preserve selected record order and each
envelope's canonical parent order.

## Authority and boundaries

Inspection first runs the normal durable recovery decoder and validation. It therefore uses the
canonical record graph as its only authority and inherits recovery's ownership, schema, lifecycle,
causality, usage, artifact, blob-receipt, outcome, and cut checks. It does not invoke a provider,
append or repair records, acquire an invocation claim, or persist a materialized inspection state.

For terminal executions, the selected artifact and causal evidence comes from the terminal
outcome's validated causal chain. A committed view is bounded by its immutable terminal cut, so
later records owned by the same run—including records using an artifact schema—cannot change the
inspection result.

For a non-terminal started execution, inspection selects the latest configured waiting,
suspension, or resumed-running acknowledgement on the explicit current owner prefix. A quiescent
descriptor and acknowledgement must share one append intent. The descriptor must be
caused by a published cut record whose cut targets the run through its retained start boundary.
The acknowledgement must cite that start and descriptor; suspension also cites an existing
owner-local pause-command record whose configured schema, mode, witness, run binding, expected
started head, and command body validate, while waiting exposes its exact prerequisite descriptor.
A resumed-running record must cite the exact suspension, descriptor, and canonical resume command;
its positive fencing token and lease are validated before inspection exposes its identity.

This remains descriptive validation. The runtime can now publish suspension evidence only through
the exact pause/head/fence acknowledgement transaction, but inspection itself does not rerun
checkpoint adapters, restore external state, or prove external receipt contents. Unavailable
continuation constituents are not resumable.

The function throws `TypeError` for an invalid run ID and `TraceStoreError` for missing, malformed,
unavailable, or inconsistent retained evidence. An incomplete `started` view remains observable,
but inspection does not make that execution safe to resume; provider replay remains fail-closed.

## Persistence

The running-continuation body uses the configured generated schema. Every inspection field remains
a disposable projection of durable lifecycle, command, continuation, artifact, usage, outcome,
causal-edge, and cut evidence.
