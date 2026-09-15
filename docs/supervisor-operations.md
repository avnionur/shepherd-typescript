# Supervisor operations

Implementation: [`src/delegation/commands.ts`](../src/delegation/commands.ts),
[`src/delegation/observe.ts`](../src/delegation/observe.ts),
[`src/delegation/handle.ts`](../src/delegation/handle.ts) (`retryChildRun`, context consumption),
[`src/delegation/inspection.ts`](../src/delegation/inspection.ts), and
[`src/delegation/records.ts`](../src/delegation/records.ts). Public entry point:
[`src/facades/delegation.ts`](../src/facades/delegation.ts) (`./delegation`), with root exports from
[`src/index.ts`](../src/index.ts). Configuration: `delegation.contextPhases`,
`delegation.decisionKinds`, `delegation.limits`, and `delegation.errors` in
[`protocol.config.json`](../protocol.config.json). Tests:
[`supervisor-operations.test.ts`](../test/delegation/supervisor-operations.test.ts),
[`delegation-evidence.test.ts`](../test/delegation/delegation-evidence.test.ts), and
[`child-run.test.ts`](../test/delegation/child-run.test.ts). Design constraints:
[task-as-value contract](../.plan/task-as-value-contract.md). Handle basics:
[task values and child run handles](./task-values.md).

## Operations

Every operation below is a command on one child run handle. A command carries a globally
idempotent command identity, names the supervisor that currently owns the handle, and is admitted
only at the exact handle head: the append compares the head atomically, so two supervisors racing
on one handle cannot both succeed. Repeating a command with identical content returns the retained
receipt; the same identity with different content is refused with `DelegationCommandConflictError`
before any record. A caller may pin `expectedHeadRecordId`; a head that moved is refused with
`DelegationHeadConflictError`.

| Operation | Function | Retained evidence |
| --- | --- | --- |
| observe | `observeChildRun(store, { handle \| handleId, ...subscription })` | None; a [trace subscription](./trace-subscriptions.md) over the handle owner path and the derived child run owner path |
| inject | `injectChildRunContext(store, { handle, commandId, supervisorId, citedRecordIds, data })` | `shepherd.delegation.context.v1`, phase `injected`, citing every cited record as a causal parent |
| handoff | `handoffChildRun(store, { handle, commandId, supervisorId, successorSupervisorId, reason? })` | `shepherd.delegation.handoff.v1` |
| discard | `discardChildRun(store, { handle, commandId, supervisorId, reason })` | `shepherd.delegation.decision.v1`, kind `discarded` |
| accept | `acceptChildRunResult(store, { handle, commandId, supervisorId })` | `shepherd.delegation.decision.v1`, kind `accepted`, citing the child outcome record |
| retry | `retryChildRun(store, { handle, commandId, supervisorId, task?, provenance?, input?, grant?, budget? })` | A successor handle whose opened record cites the predecessor, its decision record, and a retry cut |

Ordinary worker control (pause, resume, cancel, recover) stays the
[supervision control](./supervision-control.md) surface and is addressed to the child run owner
path, never to the handle.

## Observation

`observeChildRun` applies the Phase 7 subscription contract to the two owners a handle spans. The
cursor is the canonical vector of the two owners' next ordinals in canonical owner order; because
the child run prefix sorts before the handle prefix, the child run position comes first. A durable
subscription resumes strictly after its acknowledged cursor; an ephemeral one retains nothing and
works on read-only stores. The handle need not be retained yet when named by identity, so an
observer can subscribe before the supervisor opens the handle. Observation never writes to either
owner.

## Context injection

An injection retains canonical application data and at least one cited record; every cited record
must be retained in the store and becomes a causal parent of the injection. Injections are ordered
by owner ordinal on the handle. The count per handle is bounded by `limits.maxInjections` and the
citations per injection by `limits.maxCitedRecords`.

Injections retained before the child starts are consumed by `runChildRun`. Immediately before the
child's durable creation, the handle retains a consumption record
(`shepherd.delegation.context.v1`, phase `consumed`) listing the consumed injection identities in
order and the canonical digest of the composed provider request. The composition rule is fixed:

- with no consumed injection, the provider request `input` is the validated task input;
- otherwise the provider request `input` is `{ input, supervisor_context }`, where
  `supervisor_context` lists `{ record_id, data, cited_record_ids }` for every consumed injection in
  owner order.

The task instruction and output schema are never changed by injection. A program-serviced child
receives the same entries as `supervisor_context` in its program context. Injections retained after
the child started stay pending (`consumed: false` in inspection); they are not copied to a retry
successor, so a supervisor re-injects what a successor should see. Inspection re-derives the
composed request digest from the retained input and injections and refuses a consumption record
that disagrees. A crash between the consumption record and the child's creation leaves a `ready`
handle with a retained consumption; the next `runChildRun` reuses exactly the consumed injections
and retains no second consumption record.

## Handoff

A handoff transfers ownership of the handle to a named successor supervisor, who must differ from
the current one. Ownership is derived from the opened record and every retained handoff in order;
after a handoff, every later command, including the completion retained by `runChildRun`, must name
the successor. A command naming a former or unknown supervisor is refused with
`DelegationSupervisorError` without writing. Handoff transfers handle ownership only: no process,
provider session, or world state moves, and a decided handle cannot be handed off.

## Decisions

A decision is terminal for a handle. After an accept or discard, no later injection, handoff,
approval, accept, or discard is admitted.

- `discardChildRun` is refused with `DelegationStatusError` while the child run is created or
  started and not terminal; cancel the child through supervision control first, then discard. Ready,
  settling (any terminal outcome), approval-pending, and rejected handles may be discarded. The reason
  is retained, bounded by `limits.maxReasonLength`.
- `acceptChildRunResult` requires a retained completion with a `finished` outcome. The retained
  outcome value is validated against the task value's output schema, and the decision retains the
  digest of the canonical output value (`output_id`) and the outcome record identity. Only accepted
  results thread into a parent; see [result threading](./result-threading.md).

## Retry

`retryChildRun` opens a successor handle for a discarded predecessor. The successor has the same
parent and, by default, the predecessor's task value, provenance, validated input, grant, and
budget; any of task, input, grant, and budget may be replaced. A supplied descriptor is `declared`;
a supplied task value must state its provenance (see [task revision](./task-revision.md)); an
omitted task inherits the predecessor's provenance, so a revised or synthesized successor needs its
own approval. The opened record retains
`predecessor: { handle_id, decision_record_id, cut_id }`, where `cut_id` is a cut published through
the predecessor's decision record inside the opening transaction: the causal replay point of the
retry. Only the predecessor's current supervisor may retry, and only a discarded predecessor is
admissible.

## Inspection

`inspectChildRun` exposes `supervisor_id` (the current owner), `opened_supervisor_id`, `handoffs`,
`injections` with their `consumed` flags, `consumed_context`, `approval`, `completion`, `decision`,
`predecessor`, and `head_record_id`. The fold refuses, with `DelegationEvidenceError`, any record
after a decision, a command naming a former supervisor, a consumption record that is repeated,
precedes approval, or disagrees with the injections, a completion that disagrees with the child's
durable inspection, and an accept decision whose outcome citation or output digest disagrees with
the finished child.

| Status | Condition |
| --- | --- |
| `ready` | Opened, approved when approval is required, and no child records |
| `running` | The child run is created or started and not terminal |
| `settling` | The child run is terminal and no decision is retained |
| `approval_pending` | Revised or synthesized provenance without an approval |
| `rejected` | Approval verdict `rejected` |
| `accepted` | Accept decision retained |
| `discarded` | Discard decision retained |

## Failures

| Failure | Behavior |
| --- | --- |
| Command from a former or unknown supervisor | `DelegationSupervisorError`; no record |
| Same command identity, different content | `DelegationCommandConflictError`; no record |
| Expected or current head moved | `DelegationHeadConflictError`; no record |
| Injection on a rejected or decided handle, or beyond `limits.maxInjections` | `DelegationStatusError`; no record |
| Cited record not retained | `DelegationEvidenceError`; no record |
| Discard of a live child | `DelegationStatusError`; cancel through supervision control first |
| Accept of an unfinished or failed child | `DelegationStatusError`; no record |
| Retry of a handle that is not discarded | `DelegationStatusError`; no record |
| Handoff to the same supervisor, malformed options, forged handle | `TypeError` |
| Inconsistent retained evidence | `DelegationEvidenceError` on inspection |
