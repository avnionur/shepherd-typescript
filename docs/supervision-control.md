# Approval gates, cited context, and worker control

Implementation: [`src/supervision/control.ts`](../src/supervision/control.ts). Store transactions:
[`src/store/supervised-dispatches.ts`](../src/store/supervised-dispatches.ts). Configuration:
`supervision.approval`, `supervision.limits`, and `supervision.identity` in
[`protocol.config.json`](../protocol.config.json). Public entry points:
[`src/facades/supervision.ts`](../src/facades/supervision.ts) and [`src/index.ts`](../src/index.ts).
Schemas: [`supervision-approval-v1`](../spec/schemas/supervision-approval-v1.schema.json) and
[`supervision-context-v1`](../spec/schemas/supervision-context-v1.schema.json). Tests:
[`supervised-dispatch.test.ts`](../test/supervision/supervised-dispatch.test.ts) and
[`supervision-context.test.ts`](../test/supervision/supervision-context.test.ts). Contract:
[live supervision contract](../.plan/live-supervision-contract.md).

## Approval verdicts

A [supervised dispatch](./supervised-effects.md) that pauses, or whose effective intent is on the
irreversible frontier, appends an approval request and waits. A human or supervisor process finds
it with `inspectSupervisedDispatch` (`pending_approval`) or a
[trace subscription](./trace-subscriptions.md) on the dispatch owner path, then calls:

```ts
resolveSupervisedApproval(store, {
    approverId: "reviewer@example.com",
    commandId: "approval:publish:1",
    dispatchId,
    reason: "reviewed",
    requestRecordId: inspection.pending_approval.request_record_id,
    verdict: "approved", // or "rejected"
});
```

- The verdict is appended only while the exact request record is the dispatch head. Otherwise it
  fails with `SupervisionApprovalConflictError`, including after resolution or cancellation.
- A verdict and the dispatcher's expiry race on the head in one transaction; exactly one wins.
- The command identity is globally idempotent: an exact retry returns the original receipt even
  after the dispatch resolved, and changed content fails with `AppendIntentConflictError`.
- A verdict does not require or extend the dispatcher lease, so a crashed dispatcher cannot block
  an approver, and an approver cannot keep a dispatch alive.
- `approved` continues the dispatch; `rejected` resolves it as `rejected`. `expired` is reserved
  for the dispatcher.
- Dispatches imported from an archive cannot be approved.

`approverId` and `reason` are retained as given. Approver authentication is outside this API.

## Cited context injection

`injectSupervisionContext(store, options)` appends validated canonical application data to a named
context channel, `supervision-context:sha256:<hex>` (`deriveSupervisionContextChannelId`).

- `citedRecordIds` must name at least one retained record, and every cited record becomes a causal
  parent of the injection, so injected context always links to its trace evidence. Absent
  citations fail with `SupervisionEvidenceError` before any append.
- Data and citations are bounded by `supervision.limits`.
- The command identity is globally idempotent.

`readSupervisionContext(store, { channel, afterOwnerOrdinal })` returns validated injections in
owner order and refuses channel records that are malformed or whose causes disagree with their
citations. A worker consumes context by reading its channel (or subscribing to it) and citing the
injection records it used in `dispatchSupervisedEffect({ citedRecordIds })`; interceptors receive
those citations.

## Worker pause, resume, and cancellation

`./supervision` re-exports the existing fenced durable-run control commands so a supervisor has one
entry point:

| Command | Behavior |
| --- | --- |
| `requestDurableTaskPause` | Retains a globally idempotent pause request against the exact running head and fence |
| `resumeDurableTask` | Resumes an exact suspended or satisfied waiting run with verified continuation evidence and the next worker fence |
| `requestDurableTaskCancellation` | Retains a cooperative cancellation request that the running worker acknowledges at a safe boundary |
| `cancelDurableTask` | Cancels a created, waiting, or suspended run directly |

Their semantics are defined in [durable execution control](./durable-execution-control.md). A
supervised dispatch has its own effect-boundary control: it pauses through an approval request,
resumes through an approved verdict, and is cancelled by a rejected verdict or by the dispatcher's
abort signal.

## Supervisor failure

No supervisor failure can hold a worker indefinitely (the handler itself runs unbounded after
admission):

- a hanging or throwing interceptor is bounded by its timeout and policy;
- a silent approver is bounded by the approval wait, which expires closed;
- a crashed dispatcher leaves a lease that expires, and the replacement resumes from retained
  decisions;
- a crashed subscriber only delays its own delivery.
