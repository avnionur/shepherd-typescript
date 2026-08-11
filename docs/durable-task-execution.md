# Durable Task Execution

Implementation:
[`src/run/durable-execution.ts`](../src/run/durable-execution.ts). Public entry point:
[`src/index.ts`](../src/index.ts). Tests:
[`test/run/durable-execution.test.ts`](../test/run/durable-execution.test.ts) and
[`test/run/durable-execution-replay.test.ts`](../test/run/durable-execution-replay.test.ts), with
recovery and retained-evidence validation in
[`test/run/durable-execution-recovery.test.ts`](../test/run/durable-execution-recovery.test.ts) and
[`test/run/durable-execution-corruption.test.ts`](../test/run/durable-execution-corruption.test.ts).
Read-only evidence views are defined by
[`durable-execution-inspection.md`](./durable-execution-inspection.md).
Idempotent recovery commands are defined by
[`durable-execution-control.md`](./durable-execution-control.md).

## Contract

`executeTaskDurably(store, options)` adds SQLite trace evidence around the same validated execution
used by [`executeTask`](./task-execution.md). It returns the immutable transient execution result
plus a `TaskExecutionLedgerReceipt` containing the retained record identities and terminal cut.

Caller options, task provenance, provider descriptor, budget, and canonical task input are
validated before the first append. Malformed input therefore leaves no lifecycle evidence. Once
validated, the run ID becomes the trace owner and records are retained in execution order:

1. a declaration containing the exact task lock, task artifact digest, input, provider, and budget;
2. a start capture immediately before provider invocation, when invocation is reached;
3. each executor-produced `RunArtifact` in configured ordinal order;
4. aggregate usage when a valid provider response supplies usage;
5. the exact `RunOutcome` for every terminal status;
6. a configured completion or failure lifecycle capture;
7. a published cut ending at the lifecycle terminal.

Artifacts, usage, outcome, and lifecycle terminal commit in one append transaction. The first
artifact cites the execution boundary, each later artifact additionally cites its immediate
predecessor, and the outcome cites every artifact plus observed usage. The lifecycle terminal cites
the outcome. This preserves provider order without inventing artifacts or treating owner-local
ordering as semantic causality. The terminal cut makes the resulting projection independent of
later owner records and store reopen.

## Terminal evidence

A `finished` outcome produces the configured completion lifecycle record. Its generic projection
output is `{ value: <task output> }`, so scalar, object, array, null, and void task results remain
representable. Failed, exhausted, and cancelled outcomes produce the configured failure lifecycle
record while retaining their exact distinction in the separate run-outcome record.

Cancellation or turn exhaustion before invocation retains creation and terminal outcome evidence,
but does not fabricate a start or usage record. Provider failures retain a start without usage.
Output-validation and post-response budget failures retain validated artifacts and observed usage
before their outcome. Runs whose provider response contains no artifacts retain none.

Before terminal publication, every blob artifact receipt is verified against the same trace
store, including exact byte length. Missing or corrupt bytes fail closed before any terminal group
is appended. Text artifacts require no separate blob storage. This function never creates effect
records or fabricates provider artifacts.

## Recovery and interruption boundaries

Creation, start, and terminal appends use deterministic content-addressed intent IDs derived from
the run ID and configured schema reference. Repeating the same deterministic execution replays the
same retained records and cut without duplicating owner records. Changing task input, provider,
budget, or other creation evidence for an existing run conflicts before provider invocation.

Creation and start are intentionally separate durable boundaries. A process interruption may
therefore leave an owner path that accurately reports how far execution progressed.
`readDurableTaskExecution(store, runId)` validates the retained record contracts and returns one
frozen classification:

| Status | Meaning | Safe action |
| --- | --- | --- |
| `absent` | No durable creation evidence exists | Start a new execution |
| `created` | Creation committed before provider invocation | Apply an explicit recovery command |
| `started` | Provider invocation may have occurred without terminal evidence | Fail closed; do not invoke again automatically |
| `terminal_pending_cut` | Terminal evidence committed but its cut is absent | Apply an explicit recovery command to publish the cut only |
| `committed` | Terminal evidence and cut are complete | Return the exact reconstructed result |

`executeTaskDurably` starts an absent execution and returns committed evidence without provider
invocation. It rejects retained `created` or `terminal_pending_cut` evidence with
`DurableExecutionRecoveryCommandRequiredError`; callers must use `recoverTaskDurably` with a stable
command identity to authorize those transitions. A `started` state throws
`DurableExecutionRecoveryError`, because the runtime cannot prove whether repeating the provider
call would duplicate an external action.

The terminal lifecycle payload retains the final run-control snapshot. Recovery reconstructs and
validates provider identity, task lock, ordered artifacts, usage, outcome, control status,
lifecycle payload, causal parents, modes, witness, and exact cut before returning a result. Blob
artifacts are re-read and checked against their retained receipt during recovery. The creation
input must retain the exact closed `{ value }` envelope. Control turns must agree with the start
boundary; token and cost counters must agree with usage except for documented late observations
after cancellation or duration expiry; and exhaustion metrics, limits, and observed counters must
agree with the creation budget. Missing, orphaned, duplicate, reordered, malformed, unavailable,
or mutually inconsistent evidence fails closed with `TraceStoreError`.

## Inspection

`inspectDurableTaskExecution(store, runId)` exposes every recovery state as an immutable,
read-only view. It pairs lifecycle, ordered artifact, usage, and outcome values with their retained
record identities and includes the terminal cut plus direct canonical causal edges when present.
Inspection uses the same fail-closed recovery validation, does not invoke providers or append
records, and never creates a second runtime authority. Committed views are derived from the exact
terminal causal chain and remain unchanged by later records owned by the run.

## Suspension and resume authority

An acknowledged suspension releases and fences the current worker only after its configured
checkpoint evidence is retained at an immutable cut. `resumeDurableTask` then compares the exact
suspension head and descriptor, rejects unavailable constituents, and atomically publishes a new
command-bound running acknowledgement with the next fencing token and lease. The call does not
invoke the provider or restore external state; the returned authority is for checkpoint-capable
runtime integration.

## Concurrency boundary

Before recording a start, `executeTaskDurably` acquires an atomic first-writer invocation claim
through the SQLite store. The claim table admits one current identity for each durable run and
creation record. Every claim carries a configured expiry and monotonic fencing token. A competing
caller receives a typed `DurableExecutionInvocationClaim` with status `lost` while the lease is
live.

If a claimant dies before publishing start evidence, a caller at or after expiry can atomically
replace it and receives the next fencing token. Start publication verifies the exact claim,
token, unexpired lease, and unused start flag in the same transaction that appends start evidence.
A stale, expired, replaced, or repeated writer receives `fenced`, and `executeTaskDurably` surfaces
`DurableExecutionClaimFencedError` before provider invocation. After start evidence is visible,
recovery throws `DurableExecutionRecoveryError` and never reclaims invocation authority.

Ordinary execution may insert a fresh claim but cannot replace an existing claim, even after
expiry. Expired takeover is granted atomically only to an explicit recovery command, preventing a
caller with a stale prior `absent` read from bypassing command authority.

The exact started claim and fencing token also guard provider-backed terminal publication. A
safe-boundary suspension acknowledgement atomically expires and releases that claim while
publishing continuation evidence, so a returning stale worker is rejected before it can retain
artifacts, usage, outcome, or terminal lifecycle evidence. Same-run continuation remains
fail-closed until an explicit resume command can verify continuation receipts and acquire a new
monotonic fence.

A configured cancellation command similarly binds the exact running head and current fencing
token without changing lifecycle state. Only the current worker may acknowledge it at a proven
safe boundary. Cancelled outcome and terminal evidence then commit atomically with claim release;
interrupted deterministic-cut publication is repaired by exact acknowledgement replay. A command
without acknowledgement leaves an uncertain worker running and fail-closed.

For `created`, `waiting`, or `suspended` heads, `cancelDurableTask` instead proves that no worker
claim remains authoritative and atomically commits the exact command-bound cancelled outcome and
terminal lifecycle. The transition compares the caller's expected head inside the same store
transaction, expires any pre-start claim, replays identically after restart, and fences stale
start or terminal writers.

`recoverTaskDurably` records a globally idempotent configured recovery command before applying a
safe recovery transition. Created runs reclaim expired pre-start authority and bind the recovered
start causally to the command. Terminal-pending-cut runs bind cut repair to the command without
provider invocation. Absent and uncertain started runs fail closed; committed runs replay exactly.

Schema-v4 claims predate the started flag. The schema-v5 migration conservatively marks every such
legacy claim as consumed because it cannot prove whether provider invocation occurred.

## Configuration

Lifecycle schema references come from `projections.executionHistory`; artifact, outcome, and usage
schema references come from `runs.schemas`; artifact bounds and content discriminants, record
modes, and terminal statuses use generated validated protocol values. Recovery and claim statuses,
the invocation-claim lease duration, and typed recovery, loss, and fencing errors come from
`runs.execution`. The root witness, append semantics, and cut publication behavior remain owned by
the trace-kernel configuration in
[`protocol.config.json`](../protocol.config.json).
