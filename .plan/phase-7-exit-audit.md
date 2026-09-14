# Phase 7 live observation and interception exit audit

Audit: 2.10.1, 2026-09-14, #153. Delivered on branch `codex/phase-7-1-5-live-supervision` together
with #149–#152.

Verdict: **complete for the documented scope**. Every roadmap work item and exit criterion maps to
public entry points, normative documentation, and repeatable tests, and both epic exit checkboxes
are supported below. Phase 7 advances L3 (paper programming-model parity) but does not complete it:
replay and task-as-value supervision remain Phases 8 and 9.

## Scope and evidence boundary

The [roadmap](./implementation-roadmap.md#phase-7--live-observation-and-interception) lists eleven
work items and seven exit criteria. [Epic #20](https://github.com/avnionur/shepherd-typescript/issues/20)
groups them into five work checkboxes and two exit checkboxes. Children: contract #149, subscriptions
#150, interception #151, approval/context/control #152, and this audit #153, delivered together.

Evidence is local: macOS arm64, Node 24.17.0, `CI=true pnpm verify`. Hosted workflows remain
disabled at the owner's request. Supervision uses only SQLite and in-process timers, so it has no
platform-specific path; other hosts are not separately claimed.

## Roadmap work items

| Work item (unchanged) | Delivery | Implementation, documentation, and evidence |
| --- | --- | --- |
| Durable cursor-based live subscriptions | #150 | `openTraceSubscription`, [trace subscriptions](../docs/trace-subscriptions.md), store schema v10, [subscription tests](../test/supervision/trace-subscription.test.ts) |
| Cursor, replay, overflow, and acknowledgement semantics as projections; timestamps and delivery order never identity | #149, #150 | Canonical owner-ordinal cursor with content identity ([cursor schema](../spec/schemas/supervision-cursor-v1.schema.json)); acknowledgement outside the record graph and export; origin/head/explicit start; overflow and acknowledgement tests |
| Separate observer and interceptor roles | #149, #151 | Observers are subscriptions (read-only, no decision); interceptors are `dispatchSupervisedEffect` callbacks; [contract roles](./live-supervision-contract.md#roles) |
| Bounded queues and backpressure | #150 | Pull-driven refill bounded by `bufferCapacity`; lag metrics; `backpressure`/`fail` overflow policy; overflow test resumes without loss |
| Interception decisions: allow, deny, replace, pause | #151 | [Supervised effects](../docs/supervised-effects.md#decisions), decision records, [dispatch tests](../test/supervision/supervised-dispatch.test.ts) |
| Deterministic interceptor ordering and timeout behavior | #151 | Priority-then-identity order retained in dispatch identity; timeout and failure sources with declared policy; fail-open-forbidden tiers |
| Human approval gates | #152 | Pause and irreversible-frontier requests, `resolveSupervisedApproval`, fail-closed expiry, [approval docs](../docs/supervision-control.md#approval-verdicts) |
| Context injection with trace citations | #152 | `injectSupervisionContext` and `readSupervisionContext`; citations are causal parents; [context tests](../test/supervision/supervision-context.test.ts) |
| Expose worker pause/resume/cancel | #152 | `./supervision` re-exports fenced `requestDurableTaskPause`, `resumeDurableTask`, `requestDurableTaskCancellation`, `cancelDurableTask`; dispatch-boundary pause/approve/reject/abort |
| Verify passive observation does not alter the worker trace | #153 | [Passive-observation test](../test/supervision/passive-observation.test.ts) |
| Handle subscriber reconnect and supervisor crash | #150, #151, #153 | Durable reconnect, fenced decision leases, recovery classification, [process crash tests](../test/supervision/supervision-crash.test.ts) |

## Roadmap exit criteria

| Criterion (unchanged) | Evidence | Outcome |
| --- | --- | --- |
| Worker traces are identical with zero or passive observers | One scenario (scope emission, context injection, allowed with replacement, denied, and approved irreversible dispatches) runs on fresh stores without observers and with two durable, one ephemeral, and one overflowing subscription; exported archives are byte-identical and dispatch inspections equal | Verified |
| Destructive intent can be denied before outcome/materialization | Deny resolves without admission, handler invocation, or outcome; later interceptors never run; the fold rejects admission or materialized resolution after denial; timeouts on irreversible intents fail closed | Verified |
| Timeouts follow declared fail-open/fail-closed policy | Hanging, throwing, and malformed interceptors record `timeout` or `failure` with the declared policy; irreversible tiers apply `fail_closed` even when `fail_open` is declared; approval expiry rejects | Verified |
| Reconnect resumes without duplication or loss | Reopened durable subscriptions deliver strictly after the acknowledged cursor; a subscriber killed with `SIGKILL` after acknowledging `r0` and receiving `r1` resumes with `r1`, `r2`, `r3`; overflow failure keeps the cursor | Verified |
| Subscriptions neither change semantic records nor create a second authoritative event stream | Subscriptions only read committed owner occurrences; acknowledgement rows are outside the record graph and export; the passive test compares archives; integrity scans validate cursor rows | Verified |
| Supervisor failure cannot deadlock a worker indefinitely | Interceptor timeouts, bounded approval waits with fail-closed expiry, abort signals, lease expiry and takeover after a dispatcher is killed while an interceptor owns the lease, stale-dispatcher fencing | Verified |
| Irreversible effects respect configured approval frontiers | Irreversible effective intents (including replacements that strengthen reversibility) need an approved verdict for the exact intent; expiry and rejection resolve as rejected; a replacement after approval requires a new request | Verified |

Epic exit checkboxes: "Passive observation does not change semantic worker records" is supported by
rows one and five. "Pre-materialization denial, reconnect, timeout, approval, and failure behavior
pass" is supported by rows two, three, four, six, and seven.

## Recovery classification

Every retained dispatch prefix has exactly one classification and resume behavior, validated by
synthetic protocol-violation paths in the [evidence tests](../test/supervision/supervision-evidence.test.ts):

| Crash point | Classification | Resume |
| --- | --- | --- |
| Before or during an interceptor decision | `decision_pending` | New lease after expiry; decided interceptors are not invoked again |
| Pause decided, request not yet appended, or request pending | `approval_pending` | Bounded wait restarts |
| Denied, rejected, or fully allowed without admission | `resolution_pending` | Resolution or admission is appended |
| Admission without resolution | `materialization_uncertain` | Refused; handler never re-invoked |
| Resolution retained | `resolved` | Retained result returned |

## Independent review

An independent verifier review of the delivered code found two major and five minor issues. All
seven are fixed with tests or documentation corrections:

- the decision lease was renewed only within a single wait, so many short waits and appends could
  outlive it and strand a completed effect as `materialization_uncertain`; renewal is now
  measured across the whole dispatch;
- raw trace appends could forge decisions on a dispatch owner path; `append` now refuses dispatch
  and context-channel owners, and inspection requires single-parent causality, configured modes,
  and dispatch causes equal to citations;
- the contract claimed every wait is bounded; the unbounded handler wait after admission is now
  documented;
- reopening with the same claim identity reused the fence; every reopen now mints a new one;
- redelivered records keep their owner ordinal but not necessarily their cursor; the docs now say
  so;
- a shared durable subscription identity is documented as unsupported;
- interceptor-sourced non-allow decisions now require a reason.

The review's attempt to run the tests in its own sandbox did not complete; the repository
verification below is the authoritative test evidence. During implementation the dispatcher was
also hardened so a synchronously throwing or malformed handler dispatch resolves as
`materialization_failed` instead of stranding the dispatch.

## Limits carried forward

- Interceptors and handlers are in-process callbacks; remote supervisors act through subscriptions,
  approval verdicts, and context injection.
- `materialization_uncertain` has no automatic repair.
- Approver and supervisor identities are caller-supplied, not authenticated.
- Subscriptions do not discover owner paths.
- Provider calls inside durable task execution are not intercepted; coupling supervision with
  replay belongs to Phase 8.
