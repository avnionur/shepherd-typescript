# Supervised effect interception

Implementation: [`src/supervision/dispatch.ts`](../src/supervision/dispatch.ts) (dispatcher),
[`src/supervision/dispatch-state.ts`](../src/supervision/dispatch-state.ts) (validated fold and
recovery classification), and [`src/supervision/records.ts`](../src/supervision/records.ts)
(record codecs). Store transactions:
[`src/store/supervised-dispatches.ts`](../src/store/supervised-dispatches.ts). Configuration:
`supervision.interception`, `supervision.approval`, `supervision.resolution`, and
`supervision.recovery` in [`protocol.config.json`](../protocol.config.json). Public entry points:
[`src/facades/supervision.ts`](../src/facades/supervision.ts) and [`src/index.ts`](../src/index.ts).
Schemas: [`supervision-dispatch-v1`](../spec/schemas/supervision-dispatch-v1.schema.json),
[`supervision-decision-v1`](../spec/schemas/supervision-decision-v1.schema.json),
[`supervision-approval-v1`](../spec/schemas/supervision-approval-v1.schema.json),
[`supervision-admission-v1`](../spec/schemas/supervision-admission-v1.schema.json), and
[`supervision-resolution-v1`](../spec/schemas/supervision-resolution-v1.schema.json). Tests:
[`supervised-dispatch.test.ts`](../test/supervision/supervised-dispatch.test.ts),
[`supervision-evidence.test.ts`](../test/supervision/supervision-evidence.test.ts), and
[`supervision-crash.test.ts`](../test/supervision/supervision-crash.test.ts). Contract:
[live supervision contract](../.plan/live-supervision-contract.md).

## Scope

`dispatchSupervisedEffect(store, options)` durably supervises one
[effect intent](./effect-records.md) and materializes it through an
[effect handler stack](./effect-handlers.md) only when every retained decision allows it. It is the
interceptor role. Observers use [trace subscriptions](./trace-subscriptions.md) and cannot affect a
dispatch. Effects outside this API, including provider calls inside durable task execution, are
not intercepted.

## Records

Each dispatch owns one owner path, `supervision-dispatch:sha256:<hex>`, derived from its command
identity (`deriveSupervisedDispatchId`). Each record is caused by the previous head.

| Record | Mode | Meaning |
| --- | --- | --- |
| `shepherd.supervision.dispatch.v1` | declaration | Intent, intent reference, canonical interceptor declarations, approval wait, and cited records (its causal parents) |
| `shepherd.supervision.decision.v1` | capture | One decision at one interceptor position: `allow`, `deny`, `replace`, or `pause`; source `interceptor`, `timeout`, or `failure`; applied policy; reason; replacement intent |
| `shepherd.supervision.approval.v1` | capture | Request (`interceptor_pause` or `irreversible_frontier`) for one exact intent reference, or its verdict (`approved`, `rejected`, `expired`) |
| `shepherd.supervision.admission.v1` | declaration | Retained immediately before the handler runs |
| `shepherd.supervision.resolution.v1` | capture | `materialized`, `materialization_failed`, `denied`, `rejected`, or `cancelled`; handler and correlated outcome only when materialized |

Records carry no timestamps, fencing tokens, or claim identities, so the same decisions produce the
same records regardless of timing or which dispatcher wrote them.

## Decisions

Interceptors run one at a time in canonical order: ascending `priority`, then `interceptorId`.
The order is retained in the dispatch record and is part of its identity. Each decision is retained
before the next interceptor runs, and each interceptor receives the effective intent, the original
intent, the retained earlier decisions, the cited records, and an `AbortSignal`.

- `allow` continues to the next interceptor.
- `deny` resolves as `denied` without admission; later interceptors and the handler never run.
- `replace` builds a new intent with the same effect identity and kind and an equal or stronger
  reversibility tier. Later interceptors, the approval frontier, and the handler see it.
- `pause` appends an `interceptor_pause` approval request and waits for a verdict.

An interceptor that exceeds `timeoutMilliseconds` is recorded with source `timeout`. One that
throws, rejects, returns a malformed result, or returns a replacement that weakens reversibility is
recorded with source `failure`. Both apply the declared `timeoutPolicy`: `fail_open` allows and
`fail_closed` denies. When the effective intent's tier is in `failOpenForbiddenTiers`
(`irreversible` by default), `fail_closed` is always applied. The interceptor's error is never
retained.

## Approval frontier

After every interceptor has allowed or replaced the intent, an effective intent whose tier is in
`approval.requiredTiers` (`irreversible` by default) needs an approved verdict whose request names
that exact intent reference. An approved pause for the same effective intent satisfies it; a
replacement after approval requires a new request. Otherwise the dispatcher appends an
`irreversible_frontier` request. Verdicts are appended by approvers; see
[approval gates, context, and worker control](./supervision-control.md).

The dispatcher waits at most the declared `approvalTimeoutMilliseconds` (configured default and
maximum). Expiry appends an `expired` verdict and resolves as `rejected`; it never fails open.

## Admission and materialization

The dispatcher appends admission, then invokes the handler stack with the effective intent.

- A returned result resolves as `materialized` with the handler identity and an outcome exactly
  correlated to the effective intent.
- A thrown or rejected handler, or a malformed dispatch result, resolves as
  `materialization_failed` without an outcome, because the world state is unknown.

## Decision leases

Opening a dispatch retains the dispatch record and admits a decision lease in the
`supervised_dispatches` table (store schema v11) in one transaction. Every later append checks the
exact claim identity, fencing token, and unexpired lease atomically, then the exact head. The
dispatcher renews the lease whenever the renewal interval has elapsed since the last open or
renewal, measured across every wait and append of the dispatch, and the lease is released when the
resolution commits. Every reopen mints a new fencing token, even for the same claim identity, so
two dispatchers can never share authority.

`SQLiteTraceStore.append` refuses groups whose owner path uses the dispatch or context-channel
prefix. Supervision evidence can therefore only be written by these fenced transactions and by
citation-checked context injection. Inspection additionally requires every later record to be
caused only by the previous head with its configured mode, and the dispatch record's causes to
equal its citations.

A dispatcher with a different claim identity fails with `SupervisionLeaseConflictError` while the
lease is unexpired. After expiry it takes over with the next fencing token. It replays retained
decisions without invoking their interceptors and continues at the next position. The previous
dispatcher's later appends and renewals fail with `SupervisionLeaseFencedError`, even when its
record would equal the retained one.

The optional `clock` supplies lease time; interceptor and approval timeouts use elapsed process
time. A replacement dispatcher restarts the bounded approval wait.

## Recovery classification

`inspectSupervisedDispatch(store, { dispatchId })` validates the whole owner path and returns the
intent, effective intent, decisions, approvals, admission, resolution, pending approval, head,
lease (null for imported evidence), and a recovery classification:

| Classification | Meaning | Resume |
| --- | --- | --- |
| `resolved` | Resolution retained | Retry returns the retained result |
| `materialization_uncertain` | Admission without resolution | Refused with `SupervisionMaterializationUncertainError`; manual recovery |
| `resolution_pending` | Denied, rejected, or fully allowed without admission | Retry resolves or admits |
| `approval_pending` | Pause or frontier request pending or still to be appended | Retry waits again |
| `decision_pending` | Some interceptor has no retained decision | Retry continues at the next position |

Retrying the same command with different intent, interceptor declarations, approval wait, or
citations fails with `AppendIntentConflictError`. The runtime never re-invokes a handler after
admission and never fabricates an outcome.

## Cancellation

An aborted `signal` resolves the dispatch as `cancelled` at the next boundary before admission,
including while an interceptor or approval wait is pending. The interceptor's signal is aborted.
After admission the signal is ignored.

## Imported evidence and integrity

Dispatches in an imported archive are inspectable with `lease: null` and cannot be resumed or
approved. `verifyIntegrity()` reports `supervised_dispatch_mismatch` when a row disagrees with its
first or last record or a resolved row is not released.

## Limits

- The handler wait after admission is not bounded; a hanging handler keeps the dispatch in
  `materialization_uncertain` if the process stops.
- Interceptors and handlers are in-process callbacks. A remote supervisor participates by
  observing a subscription and appending approval verdicts or context.
- `materialization_uncertain` has no automatic repair.
- Supervisor identity is caller-supplied and not authenticated.
