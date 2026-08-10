# Durable Task Execution

Implementation:
[`src/run/durable-execution.ts`](../src/run/durable-execution.ts). Public entry point:
[`src/index.ts`](../src/index.ts). Tests:
[`test/run/durable-execution.test.ts`](../test/run/durable-execution.test.ts) and
[`test/run/durable-execution-replay.test.ts`](../test/run/durable-execution-replay.test.ts).

## Contract

`executeTaskDurably(store, options)` adds SQLite trace evidence around the same validated execution
used by [`executeTask`](./task-execution.md). It returns the immutable transient execution result
plus a `TaskExecutionLedgerReceipt` containing the retained record identities and terminal cut.

Caller options, task provenance, provider descriptor, budget, and canonical task input are
validated before the first append. Malformed input therefore leaves no lifecycle evidence. Once
validated, the run ID becomes the trace owner and records are retained in execution order:

1. a declaration containing the exact task lock, task artifact digest, input, provider, and budget;
2. a start capture immediately before provider invocation, when invocation is reached;
3. aggregate usage when a valid provider response supplies usage;
4. the exact `RunOutcome` for every terminal status;
5. a configured completion or failure lifecycle capture;
6. a published cut ending at the lifecycle terminal.

The usage, outcome, and lifecycle terminal commit in one append transaction. Causal edges connect
creation to start, observed usage to outcome, and outcome to the terminal lifecycle record. The
terminal cut makes the resulting projection independent of later owner records and store reopen.

## Terminal evidence

A `finished` outcome produces the configured completion lifecycle record. Its generic projection
output is `{ value: <task output> }`, so scalar, object, array, null, and void task results remain
representable. Failed, exhausted, and cancelled outcomes produce the configured failure lifecycle
record while retaining their exact distinction in the separate run-outcome record.

Cancellation or turn exhaustion before invocation retains creation and terminal outcome evidence,
but does not fabricate a start or usage record. Provider failures retain a start without usage.
Output-validation and post-response budget failures retain observed usage before their outcome.
This function never creates effect or artifact records.

## Idempotency and interruption boundary

Creation, start, and terminal appends use deterministic content-addressed intent IDs derived from
the run ID and configured schema reference. Repeating the same deterministic execution replays the
same retained records and cut without duplicating owner records. Changing task input, provider,
budget, or other creation evidence for an existing run conflicts before provider invocation.

Creation and start are intentionally separate durable boundaries. A process interruption may
therefore leave an incomplete owner path that accurately reports how far execution progressed.
The current API does not reconstruct a previous `TaskExecutionResult` or resume an incomplete run
without provider invocation; that recovery/read capability is a later slice. Store integrity,
append diagnosis, native export/import, and ordinary owner/cut reads already include these records.

## Configuration

Lifecycle schema references come from `projections.executionHistory`; outcome and usage schema
references come from `runs.schemas`; record modes and terminal statuses use generated validated
protocol values. The root witness, append semantics, and cut publication behavior remain owned by
the trace-kernel configuration in [`protocol.config.json`](../protocol.config.json).
