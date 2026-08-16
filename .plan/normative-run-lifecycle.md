# Normative Run Lifecycle Contract

Status: proposed Phase 2 contract. This document remains in `.plan/` until the record schemas,
public projection, commands, and conformance tests are implemented. It refines the architecture
study without claiming automatic checkpoint restoration or provider continuation.

Implementation status: release `1.8.0` publishes the configured transition matrix, a pure public
transition validator, versioned continuation-descriptor, waiting, and suspension schemas, and
read-only cut-bound inspection of retained waiting/suspension evidence. Globally idempotent pause
requests are retained only against the exact current started head and fencing token and do not
change lifecycle state. Ordered checkpoint adapter contracts and atomic suspension acknowledgement
now publish cut-bound continuation evidence and release the exact worker fence. Globally idempotent
resume validates the exact waiting or suspension acknowledgement and descriptor, rejects
unavailable constituents, atomically acquires a monotonic worker fence, and publishes a
command-bound running acknowledgement. Running
cancellation now retains exact-head/fence command authority and lets the current worker atomically
terminalize and release its claim at a safe boundary. Direct cancellation now atomically
terminalizes exact created, waiting, and suspended heads after proving no worker remains
authoritative. Prerequisite-driven waiting now publishes cut-bound continuation evidence and
releases the exact worker fence; guarded resume requires independently verified satisfaction that
matches the retained prerequisite. Automatic checkpoint restoration remains planned.

## Purpose

Shepherd has one authoritative run lifecycle derived from canonical trace records. Recovery
classification, invocation claims, worker leases, command receipts, logs, and inspection values
describe or control that lifecycle; none forms a competing state machine.

The lifecycle vocabulary is:

```text
created
   ├──────────────► terminal
   └──► running
          ├────────► waiting ────────► running
          ├────────► suspended ──────► running
          └────────► terminal

waiting ─────────────────────────────► terminal
suspended ───────────────────────────► terminal
```

`terminal` carries exactly one run outcome: `finished`, `failed`, `exhausted`, or `cancelled`.
Terminal evidence is immutable and has no transition back to a non-terminal state. Continuation
after a terminal outcome requires a new run or, in a later phase, an explicitly related branch.

## State meanings

| State | Meaning | Required authority evidence |
| --- | --- | --- |
| `created` | Exact task, input, provider, budget, and artifact-lock evidence exists, but no provider/effect boundary has been crossed. | Creation record. |
| `running` | One current fenced worker may cross provider/effect boundaries. | Start or continuation record plus the current unexpired worker lease. |
| `waiting` | Execution is quiescent because one explicitly identified prerequisite is not yet satisfied. | Waiting acknowledgement, prerequisite descriptor, and a continuation descriptor. |
| `suspended` | Execution is quiescent because an authorized pause was acknowledged at a safe boundary. | Pause command, suspension acknowledgement, and a continuation descriptor. |
| `terminal` | Execution completed with one immutable terminal outcome. | Outcome and lifecycle terminal; the deterministic terminal cut may still await publication. |

`waiting` is prerequisite-driven. Examples include an approval, external event, completed effect,
or resource becoming available. `suspended` is control-driven: an authorized operator asks the
runtime to stop at a safe continuation boundary. A pause request, cooperative abort signal, dead
worker, expired lease, or missing provider response is not itself suspension.

## Recovery is not a lifecycle state

The existing durable recovery statuses remain read-time classifications:

- `absent`, `created`, `started`, `terminal_pending_cut`, and `committed` describe retained
  execution completeness;
- `recover` is an idempotent command that safely completes an already-defined transition;
- `recovering` is never retained as a run lifecycle state.

For example, lifecycle `created` can have recovery status `created`, while a terminal lifecycle can
temporarily have recovery status `terminal_pending_cut` until its deterministic cut is published.
The terminal cut establishes a committed cut-bounded read address; it does not create the terminal
lifecycle state. The classifications do not add lifecycle edges.

## Safe-boundary rule

A worker may acknowledge `waiting` or `suspended` only after all of the following are true:

1. no provider, effect, or world mutation is in flight;
2. any previously issued external action has an independently verifiable receipt;
3. the worker still owns the exact current fencing token;
4. a continuation descriptor identifies the immutable trace cut and the state constituents needed
   to continue;
5. the acknowledgement and lease release commit atomically, so a stale worker cannot continue.

If quiescence cannot be proven, the run remains `running` until it reaches terminal evidence or is
classified as an uncertain started execution. The runtime must not relabel uncertainty as waiting
or suspension.

## Continuation evidence

A continuation descriptor classifies each constituent as `verified`, `not_required`, or
`unavailable`:

- trace cut;
- managed-world receipt;
- provider-session receipt;
- process/runtime checkpoint receipt;
- outstanding prerequisite descriptor, for `waiting`.

The trace cut is always required. Other constituents may be `not_required` only when the task and
provider contract proves they do not participate in continuation. A descriptor containing an
`unavailable` required constituent may support inspection or reconstructive replay, but never
same-run resume.

The current one-shot provider executor has no provider-session or process checkpoint adapter.
Therefore the current runtime cannot yet publish honest resumable `waiting` or `suspended`
evidence. Adding state names alone is insufficient.

## Command contracts

Control commands are canonical capture records with globally stable idempotency identities.
Command evidence expresses requested authority; a lifecycle acknowledgement proves the transition
actually occurred.

### Pause

`pause` names the run, expected running-lifecycle record, current fencing token, reason, and command
identity. It is legal only from `running`. The command may be retained while the worker approaches
a safe boundary, but projection remains `running` until a command-bound suspension acknowledgement
and continuation descriptor commit atomically.

### Resume

`resume` names the run, expected `waiting` or `suspended` acknowledgement, continuation descriptor,
and command identity. It is legal only when every required continuation constituent is verified.
For `waiting`, it must additionally cite independently verified satisfaction of the prerequisite.

Resume atomically:

1. compares the expected lifecycle head;
2. validates continuation and prerequisite evidence;
3. acquires a new monotonic fencing token;
4. appends the command-bound running acknowledgement;
5. prevents the previous worker from crossing another provider/effect boundary.

Repeating the exact command returns the retained receipt. Reusing its identity for different
content, lifecycle evidence, or continuation evidence conflicts before transition.

### Cancellation

`cancel` is a globally idempotent command naming the run, expected lifecycle head, reason, command
identity, and the expected fencing token when the source is `running`. Repeating the exact command
returns the retained receipt; reusing its identity for different content or a different lifecycle
head conflicts.

From `created`, `waiting`, or `suspended`, cancellation atomically compares the expected head,
appends command-bound cancelled terminal evidence, and confirms that no worker lease remains
authoritative. From `running`, retaining the command requests cooperative cancellation but does not
change lifecycle state. The current fenced worker must reach a safe boundary and atomically append
the command-bound terminal acknowledgement while releasing its lease. An expired, dead, or
unresponsive worker with an ambiguously in-flight external action remains `running` and fail-closed;
the runtime must not fabricate cancellation merely because a command exists.

After cancelled terminal evidence commits, continuation descriptors are historical only and every
previous worker is fenced from provider/effect boundaries.

## Terminal transition matrix

Every terminal transition requires an immutable outcome and lifecycle terminal caused by the
current lifecycle head. The following matrix is closed; omitted combinations are illegal.

| Source | Legal outcomes | Additional evidence |
| --- | --- | --- |
| `created` | `failed`, `exhausted`, `cancelled` | Proof that no start/continuation record exists; structured pre-invocation failure, configured budget/control exhaustion, or an exact cancel command. |
| `running` | `finished`, `failed`, `exhausted`, `cancelled` | Current fencing token, safe-boundary acknowledgement, and receipts resolving every issued provider/effect/world action; finished additionally requires validated output. |
| `waiting` | `failed`, `exhausted`, `cancelled` | Expected waiting head, released worker lease, and structured prerequisite failure, configured budget/control exhaustion, or an exact cancel command. |
| `suspended` | `failed`, `exhausted`, `cancelled` | Expected suspension head, released worker lease, and structured checkpoint/runtime failure, configured budget/control exhaustion, or an exact cancel command. |

`created → finished` is illegal because this task-execution lifecycle requires a running boundary
before successful output. `waiting` and `suspended` must resume to `running` before they can finish.
An implementation supporting provider-free completion requires a separately versioned lifecycle
contract rather than weakening this matrix.

## Projection compatibility

The current execution-history v1 projector exposes `pending`, `running`, `succeeded`, and `failed`.
It remains a compatibility projection over existing creation/start/terminal schemas:

| Normative lifecycle | Existing v1 projection |
| --- | --- |
| `created` | `pending` |
| `running` | `running` |
| `waiting` | not representable |
| `suspended` | not representable |
| terminal `finished` | `succeeded` |
| terminal `failed`, `exhausted`, or `cancelled` | `failed` |

Implementation must introduce a versioned lifecycle projection/schema contract rather than
silently redefining v1. Inspection must derive the new states from canonical records bounded by an
immutable cut or explicit current owner prefix.

## Required implementation slices

1. Configure versioned waiting, suspension, and continuation-descriptor schemas and discriminants.
2. Add a pure lifecycle transition validator and projection fixtures without changing v1.
3. Add read-only inspection of the new states.
4. Add idempotent `pause` command retention and command-conflict tests. **Implemented in 1.3.0.**
5. Add checkpoint/provider adapter contracts and safe-boundary acknowledgement. **Implemented in
   1.4.0.**
6. Add idempotent `resume` with atomic lifecycle comparison and lease fencing. **Implemented in
   1.5.0.**
7. Add idempotent `cancel` with expected-head comparison, safe-boundary acknowledgement, and
   atomic terminal fencing for running workers. **Implemented in 1.6.0.**
8. Add crash, stale-worker, missing-receipt, and cross-connection races at the public runtime seam.
   **Implemented in 1.6.1.**
9. Extend exact-command cancellation to created, waiting, and suspended heads with atomic inactive
   authority validation and stale-worker fencing. **Implemented in 1.7.0.**
10. Add prerequisite-driven waiting acknowledgement with atomic claim release and guarded resume
    requiring exact independently verified prerequisite satisfaction. **Implemented in 1.8.0.**
11. Add the Appendix B typed-effect reference machine and proof-envelope classifier.

## Acceptance gates

- passive inspection cannot change lifecycle evidence;
- a pause command without acknowledgement still projects as `running`;
- waiting cannot resume without prerequisite-satisfaction evidence;
- suspension cannot resume with an unavailable required checkpoint constituent;
- the previous worker is fenced before resumed work can invoke a provider or effect;
- concurrent resume commands yield one transition and deterministic losers;
- cancel replay is identical, conflicting command reuse fails, and a command without a safe
  acknowledgement cannot terminalize an ambiguously running execution;
- every source/outcome pair outside the terminal transition matrix fails closed;
- command replay across store restart returns the same evidence;
- later owner records do not change a cut-bounded lifecycle projection;
- terminal runs never resume in place;
- unsupported checkpoint capability fails closed without claiming resumability.
