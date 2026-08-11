# Durable Execution Control

Implementation:
[`src/run/durable-execution-control.ts`](../src/run/durable-execution-control.ts). Public types:
[`src/run/durable-execution-control-types.ts`](../src/run/durable-execution-control-types.ts).
Public entry point: [`src/index.ts`](../src/index.ts). Tests:
[`test/run/durable-execution-control.test.ts`](../test/run/durable-execution-control.test.ts).

## Recovery command

`recoverTaskDurably(store, options)` applies one configured `recover` command to existing durable
task evidence. `options.commandId` is a globally idempotent identity: retrying the exact recovery
request returns the retained command record and exact durable result, while reusing that identity
for another run conflicts before provider invocation. Exact execution options are verified against
retained creation evidence before the command is retained.

The command is retained as a configured capture record owned by the run and caused by its creation
record. A recovered start cites creation and command evidence. A repaired cut publication cites the
terminal lifecycle and command evidence. Command records therefore participate in the canonical
record graph rather than a mutable control table or secondary event protocol.

The invocation-claim transaction permits expired takeover only when this retained command is
present. Ordinary admission can create a fresh claim but cannot replace an existing one after a
stale `absent` read.

## Recovery transitions

The command follows the existing durable recovery lifecycle:

| State | Result |
| --- | --- |
| `absent` | Reject with `DurableExecutionRecoveryAbsentError`; recovery never creates a new run |
| `created` | Acquire or reclaim the fenced invocation lease, publish a command-bound start, and execute |
| `started` | Reject with `DurableExecutionRecoveryError`; duplicate provider invocation remains unsafe |
| `terminal_pending_cut` | Publish the deterministic command-bound terminal cut without provider invocation |
| `committed` | Return the exact reconstructed result without provider invocation |

Recovery validates command ownership, configured schema, mode, witness, creation ancestry, kind,
append-intent identity, and target run. Missing, malformed, unowned, conflicting, or inconsistent
command evidence fails closed with `TraceStoreError`.

Ordinary `executeTaskDurably` calls cannot bypass this authority: existing `created` and
`terminal_pending_cut` states throw `DurableExecutionRecoveryCommandRequiredError`.

## Pause request

`requestDurableTaskPause(store, options)` atomically retains one configured `pause` command for an
actively running durable execution. The request binds its global `commandId` to the exact `runId`,
current started-lifecycle record, current invocation fencing token, and non-empty reason. The
started record must be the current lifecycle head and the live invocation claim must carry the
same fencing token.

The command is a configured capture record owned by the run, caused by the expected started
record, and retained under the same global control-command identity namespace as recovery. An
exact retry returns the original immutable receipt, including after the lifecycle advances or the
store reopens. Reusing the identity for different content or another command kind conflicts.
Missing claims, pre-start claims, stale heads, stale tokens, and terminal runs fail closed before
new evidence is retained.

The command expresses requested authority only. Retaining it does not interrupt a provider,
release the invocation lease, publish continuation evidence, append a suspension acknowledgement,
or change inspection from `running`. Those effects require the worker to reach a verified safe
boundary.

## Checkpoint and suspension acknowledgement

`captureRunContinuationCheckpoints(options)` invokes exactly one adapter for every configured
continuation constituent, in configured order. Each adapter receives one frozen run, started-head,
and proposed-cut context and returns stable `verified`, `not_required`, or `unavailable` evidence.
Verified evidence must cite a receipt. The function performs no store mutation, and callers retain
its frozen result so retries do not rerun checkpoint side effects.

`acknowledgeDurableTaskSuspension(store, options)` accepts that exact evidence only after the
worker has reached a safe boundary with no provider, effect, or world mutation in flight. It
rejects unavailable constituents, publishes an immutable cut through the expected start, and then
uses one SQLite transaction to:

- compare the live claim and fencing token;
- validate the command-bound current lifecycle head and cut;
- append the continuation descriptor and suspension acknowledgement;
- expire and release the worker claim.

Exact replay returns the retained descriptor and acknowledgement across restart. Changed evidence
conflicts. A returning worker's terminal append is claim-fenced, so it cannot publish terminal
evidence after suspension released its authority. A failed acknowledgement may leave an unused
immutable cut publication, but never partial descriptor, acknowledgement, or lease-release state.

## Resume

`resumeDurableTask(store, options)` applies one globally idempotent `resume` command to the exact
suspension acknowledgement and continuation descriptor named by the caller. The store transaction
validates their ownership, configured schemas, identities, current-head position, and constituent
classifications. Any `unavailable` constituent fails closed.

On success the transaction advances the released claim to a new deterministic claim identity and
monotonic fencing token, creates a configured lease, and appends the canonical command plus a
command-bound running-continuation acknowledgement. Exact replay returns the original authority
across store reopen. Changed command content conflicts, and concurrent or stale commands targeting
the prior suspension lose deterministically.

Resume publishes authority only. It does not invoke a provider or restore world, process, or
provider-session state; checkpoint-capable callers must restore verified receipts before using the
returned fence at an external-action boundary.

## Cancellation request and safe-boundary acknowledgement

`requestDurableTaskCancellation(store, options)` atomically retains one configured `cancel`
command against the exact current started record and invocation fencing token. The command binds
its global identity to the run, expected lifecycle head, token, and operator reason. Exact replay
returns the same record across restart; changed content or another command kind conflicts.

Retaining the command does not change lifecycle state, release the worker claim, or infer that a
provider or external effect is safe to stop. An expired, dead, or unresponsive worker therefore
remains `running` and fail-closed until independently safe recovery evidence exists.

The current fenced worker calls `acknowledgeDurableTaskCancellation(store, options)` only after it
reaches a safe boundary. One SQLite transaction validates the command, current started head,
claim identity, and fencing token; appends command-bound cancelled outcome and lifecycle evidence;
and releases the claim. Deterministic cut publication follows the transaction. If publication is
interrupted, exact acknowledgement replay repairs the missing cut without fabricating another
terminal transition. The returning worker is fenced from publishing its ordinary result.

Recovery validates the cancellation command's configured schema, ownership, mode, witness,
run/head binding, and causal position. Missing, ambiguous, malformed, or non-command terminal
evidence fails closed. A request that is never acknowledged cannot terminalize an ambiguously
running execution.

## Crash and race guarantees

Public runtime tests preserve the control boundary across store connections and lost responses.
If suspension commits but its receipt is lost, exact acknowledgement replay returns the retained
descriptor without rerunning checkpoint adapters. Competing cancellation commands can coexist as
requests, but only the command cited by the first cancelled terminal can acknowledge successfully;
the deterministic loser cannot rewrite that result. After resume acquires a new fence, pause or
cancel requests carrying the previous head/token fail closed. A `verified` continuation
constituent without its required receipt cannot authorize resume.

## Scope

Recovery, pause-request retention, checkpoint adapter contracts, command-authorized suspension,
exact resume authority, and fenced running cancellation are implemented. Runtime waiting and
direct cancellation from created, waiting, or suspended states remain unavailable. These APIs do
not forcibly stop a process, infer a safe boundary, or make an uncertain started provider call
replay-safe; adapters and the calling worker own the safe-boundary assertion.
