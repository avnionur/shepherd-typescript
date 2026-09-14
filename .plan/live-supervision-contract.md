# Live observation, interception, and supervision contract

Status: TypeScript contract, Phase 7 task 1 (#149), 2.7.2. It is implemented by
[durable trace subscriptions](../docs/trace-subscriptions.md) (#150, 2.8.0),
[supervised effect interception](../docs/supervised-effects.md) (#151, 2.9.0), and
[approval gates, cited context, and worker control](../docs/supervision-control.md) (#152,
2.10.0). Conformance and the exit audit are #153 (2.10.1). Normative behavior lives in `docs/`;
this page records the reviewed design constraints and deliberate non-claims.

## Evidence

Pinned release source: `a8196d4c453514836d06bd2fece91a03cdc37107`
([upstream.lock.json](../upstream.lock.json)).

- [Dialect supervision](https://github.com/shepherd-agents/shepherd/blob/a8196d4c453514836d06bd2fece91a03cdc37107/shepherd/packages/dialect/src/shepherd_dialect/supervision.py):
  a supervisor handler approves by returning and denies by raising at the check-at-commit point.
  The check-time law states that an effect may be checked no later than its last undo point.
- The paper (§3.2, §5.1, Appendix E) describes observation, interception, and a runtime
  supervisor, but no durable decision record, timeout policy, or reconnect contract.

These are source-level observations, not executed Python conformance. The TypeScript design keeps
the check-time law and adds what the upstream in-process handler does not provide: durable
decisions, fenced decision leases, bounded waits, and restart classification.

Existing TypeScript authorities stay normative: [canonical records and cuts](../docs/trace-queries.md),
[effect records](../docs/effect-records.md), [handler stacks](../docs/effect-handlers.md),
[durable run control](../docs/durable-execution-control.md), and
[scope registration](../docs/scope-registration.md).

## Roles

| Role | Authority | Must not |
| --- | --- | --- |
| Observer | Reads committed records through a cursor subscription | Append records, change record identity, block a writer, or become a second event stream |
| Interceptor | Returns one decision for one supervised effect intent inside a bounded wait | Materialize the effect, hold a lease past its timeout, or bypass the retained decision record |
| Approver | Appends one verdict for one exact pending approval request by command identity | Approve a different intent, approve after resolution, or extend the dispatcher lease |
| Dispatcher | Holds the fenced decision lease, appends intent, decisions, admission, and resolution | Invoke a handler without a retained allow path and admission record |
| Context supervisor | Appends validated application data that cites retained records | Inject uncited context or rewrite worker records |

Observers and interceptors are separate types and entry points (decision D-008). An observer
cannot return a decision, and an interceptor is never notified through a subscription.

## Subscriptions

- A subscription selects an exact, bounded set of owner paths. Its **cursor** is the canonical
  vector of next owner ordinals, identified by a content digest. Delivery interleaving across owners,
  poll timing, and timestamps are never part of cursor identity.
- Subscriptions read committed records only, so observers are notified after durable append.
- Durable subscriptions retain their acknowledged cursor in store bookkeeping outside the record
  graph and outside trace export. Ephemeral subscriptions keep the cursor in memory and work on
  read-only stores.
- Acknowledgement is monotonic per owner and cannot pass delivered records. Reconnect resumes
  strictly after the acknowledged cursor: acknowledged records are never redelivered and no record
  is skipped. Delivered but unacknowledged records are delivered again after a crash, at the same
  owner ordinal, so consumers can process them idempotently.
- The buffer is bounded. It is refilled only when the consumer pulls, so a slow observer applies
  backpressure to itself and never to writers. Lag (retained but undelivered records) is reported.
  The declared overflow policy either keeps backpressure or fails the subscription when lag exceeds
  its bound. Records are never dropped silently.

## Supervised effect dispatch

Each dispatch owns one owner path derived from its command identity:

1. `dispatch`: the canonical effect intent, the interceptor declarations in canonical order,
   the approval timeout, and cited records as causal parents.
2. `decision` per interceptor position: `allow`, `deny`, `replace`, or `pause`, with the source
   (`interceptor`, `timeout`, or `failure`) and the applied timeout policy.
3. `approval`: a request (interceptor pause or irreversible frontier) and its verdict
   (`approved`, `rejected`, or `expired`).
4. `admission`: appended immediately before the handler is invoked.
5. `resolution`: the terminal disposition, with the correlated effect outcome only when the effect
   was materialized.

Rules:

- Interceptors run sequentially in canonical order: ascending priority, then identity. Each
  decision is retained before the next interceptor runs; the order is part of dispatch identity.
- `deny` resolves without admission, so a denied intent has no materialized outcome.
- `replace` keeps the effect identity and kind and may keep or strengthen reversibility but never
  weaken it. Later interceptors and the approval frontier see the replacement.
- `pause` appends an approval request and waits, bounded, for a verdict.
- A timeout or thrown interceptor applies the declared policy. `fail_open` allows, `fail_closed`
  denies. Tiers configured as fail-open-forbidden (irreversible by default) always apply
  `fail_closed`. Approval expiry always rejects.
- Effective intents whose tier is on the approval frontier (irreversible by default) require an
  approved verdict bound to that exact effective intent before admission.
- The dispatcher holds a fenced, renewable decision lease, renewed on a schedule measured across the
  whole dispatch. Every append compares the current fence atomically, and every reopen mints a new
  fence.
- General trace appends to dispatch and context-channel owner paths are refused, so supervision
  evidence is written only by fenced dispatch transactions and citation-checked injection. After lease expiry a replacement dispatcher resumes from retained decisions without
  invoking already decided interceptors; the stale dispatcher is fenced.
- Retained admission without resolution is `materialization_uncertain`. The runtime refuses to
  guess: it neither re-invokes the handler nor fabricates an outcome.
- A handler that throws resolves as `materialization_failed` without an outcome, because the world
  state is unknown.

## Approval, context, and worker control

- Approval verdicts are globally idempotent commands bound to the exact request record and the
  current dispatch head. Verdict and expiry race on the head; exactly one wins.
- Context injections are records on a named context channel. Every injection must cite at least
  one retained record, and its cited records are its causal parents. A worker consumes context by
  reading the channel and citing injection records when it dispatches an effect.
- Worker pause, resume, and cancellation of durable runs reuse the existing fenced run-control
  commands. A supervised dispatch pauses at its effect boundary through approval, resumes through
  an approved verdict, and is cancelled by rejection or by the dispatcher's abort signal.

## Failure and recovery

| Failure | Required behavior |
| --- | --- |
| Interceptor hangs | Bounded by its timeout, then the declared policy applies |
| Interceptor throws | The failure policy applies; the error is not retained |
| Approver never answers | The dispatcher records `expired` and resolves as rejected |
| Dispatcher crashes while deciding | `decision_pending`; a new claim resumes after lease expiry |
| Dispatcher crashes while waiting for approval | `approval_pending`; a new claim resumes the bounded wait |
| Dispatcher crashes after admission | `materialization_uncertain`; manual recovery, no retry |
| Subscriber crashes | Reconnect resumes after the acknowledged cursor |

No supervisor failure can keep a worker waiting forever: every interceptor and approval wait has a
configured maximum. The handler itself is the worker's own effect and is not bounded after
admission, because a timeout could not resolve an effect that may already be changing the world.

## Non-claims

- No distributed scheduler, remote transport, or authentication of approver identity beyond the
  caller-supplied identifier.
- No automatic repair of `materialization_uncertain` dispatches.
- Approval expiry is measured by the current dispatcher. A replacement dispatcher restarts its
  bounded wait; wall-clock deadlines are not retained as semantic identity.
- Subscriptions do not discover new owner paths; callers open subscriptions for exact owners.
- Effects outside `dispatchSupervisedEffect`, including provider invocations inside durable
  task execution, are not intercepted.
