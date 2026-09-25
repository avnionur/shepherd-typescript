# Effect compensation

Status: normative from 7.0.0 (#209, paper §3.2 and Appendix A.2).

Implementation: [`src/effect/compensation.ts`](../src/effect/compensation.ts) (registry, engine,
inspection, `compensateEffects`), [`src/effect/compensation-records.ts`](../src/effect/compensation-records.ts)
(record codec and identity), [`src/effect/compensation-evidence.ts`](../src/effect/compensation-evidence.ts)
(materialization evidence and trigger collection), [`src/effect/compensation-errors.ts`](../src/effect/compensation-errors.ts),
and the reserved head-compared store append in
[`src/store/effect-compensations.ts`](../src/store/effect-compensations.ts). Triggers:
[`discardScope`](../src/workspace/scope-discard.ts) and the replay branches
[`rewindReplaySession` and `replayReplaySession`](../src/replay/branch.ts). Public entry points:
[`./effects`](../src/facades/effects.ts) and the root entry. Configuration: `effects.compensation`
in [`protocol.config.json`](../protocol.config.json) (effect protocol v2,
`EFFECT_PROTOCOL_V2_CONTRACT`). Schema:
[`effect-compensation-v1`](../spec/schemas/effect-compensation-v1.schema.json). Tests:
[`compensation.test.ts`](../test/effect/compensation.test.ts),
[`compensation-evidence.test.ts`](../test/effect/compensation-evidence.test.ts),
[`scope-discard-compensation.test.ts`](../test/scope/scope-discard-compensation.test.ts),
[`tool-loop-compensation.test.ts`](../test/agent/tool-loop-compensation.test.ts), and the fault
suite [`compensation-kill.test.ts`](../test/faults/compensation-kill.test.ts).

## Scope

Every effect intent declares a reversibility tier. A tier listed in
`effects.compensation.compensableTiers` (`compensable` by default) is reversed by a user-supplied
compensation handler when the substrate abandons the work that materialized it:

- a scope discard seals a scope whose selected history cites the effect, or
- a replay branch (rewind or replay) that abandons its source (source disposition `compensate`) is
  opened at a boundary before the step that materialized it.

Only successful materializations (`outcome.result.ok === true`) are compensated. A failed outcome
reports that the world did not complete the effect, and a `materialization_failed` or
materialization-uncertain effect has no retained outcome; neither is compensated automatically.
Reversible effects are restored by world checkpoints, not by compensation, and irreversible effects
stay behind the approval frontier ([supervised effects](./supervised-effects.md),
[rewind and replay](./rewind-and-replay.md#irreversible-effects)).

## Handlers

`createEffectCompensationRegistry(handlers)` validates and freezes exactly one handler per exact
effect kind: `{ handlerId, kind, compensate }`. Duplicate kinds or handler identities, malformed
definitions, and non-function callbacks are refused with `TypeError`. Triggers accept only
registries created by this function.

`compensate(request)` receives the attempt number, the compensation identity, a stable
`idempotencyKey` (equal to the compensation identity), the immutable intent and successful outcome
of the materialized effect, and the trigger. It returns an ordinary effect result:

- `{ ok: true, value }`: the effect is compensated; nothing ever invokes a handler for it again.
- `{ ok: false, error }`: the world refused; the failure is retained and the next trigger that
  reaches the effect invokes the handler again.
- A throw or rejection: the attempt stays uncertain and the error propagates unchanged; the next
  trigger invokes the handler again.

A handler must make its world change idempotent under `idempotencyKey`. That is the contract that
makes recovery safe: an attempt interrupted after the world changed but before its outcome was
retained is invoked again under the same key.

## Materialization evidence and identity

A materialized effect is identified by the record that retains its original materialization
(`effects.compensation.evidenceKinds`):

| Kind | Record | Intent and outcome |
| --- | --- | --- |
| `replay_step` | A live replay effect step with disposition `materialized` | The step's intent and outcome |
| `supervised_dispatch` | A supervised dispatch resolution with disposition `materialized` | The effective intent and the resolution outcome |

A recorded replay step (a copy in a branch prefix) resolves to the live step it copies, through
any number of branch generations. The compensation identity is
`<compensationIdPrefix><sha256(materialization record id)>`, and it is also the owner path of the
compensation records. Every trigger that reaches the same materialization therefore shares one
compensation path: an effect compensated by a discard is never compensated again by a rewind, an
explicit command, or a retry.

Tool-use loop calls are effects: a replay-bound loop
([`createReplayToolLoopBindings`](./tool-use-loop.md)) retains each call as a replay effect step, and
a supervised loop retains each call as a supervised dispatch, so a tool declared `compensable` is
compensated like any other effect. The meta-agent `rewind` tool passes the worker definition's
optional `compensation` registry; the `replay` tool retains its source and compensates nothing.

## Records

All records use the trace schema `shepherd.effect.compensation.v1`, mode `capture`, and the
compatibility namespace `shepherd.effect-compensation.v1`. Each record is caused by the previous
head; the intent is caused by the materialization record.

| Phase | Retained | Fields |
| --- | --- | --- |
| `intent` | Once, before the first attempt | Materialization evidence, effect intent, effect outcome |
| `attempt` | Before every handler invocation | One-based attempt number, handler identity, trigger (`kind`, `command_id`) |
| `outcome` | After the handler returns | Attempt number, `compensated` or `failed`, the handler's result |

Records carry no timestamps. The derived status is `pending` (intent only), `uncertain` (the latest
attempt has no outcome), `failed` (the latest outcome failed), or `compensated`; no record may
follow a `compensated` outcome. `inspectEffectCompensation(store, { compensationId })` validates the
whole path, including the phase order, attempt numbering, causes, versions, and that the identity
derives from the materialization, and fails with `EffectCompensationEvidenceError` otherwise.

`SQLiteTraceStore.append` and `publishCut` refuse the compensation owner prefix, so compensation
records are written only by the head-compared compensation transaction. A retained compensated
outcome cannot be forged through the ordinary append path to suppress a compensation.

## Order and exactly-once

A trigger collects its materialized effects in materialization order, drops non-compensable and
unsuccessful ones, deduplicates them by materialization record, and refuses more than
`limits.maxEffectsPerTrigger`. Before any write it requires a handler for every effect not already
compensated (`EffectCompensationHandlerNotFoundError`). It then compensates in reverse order, one
effect at a time:

1. Retain the intent if the path is empty; an identical concurrent intent replays.
2. Skip the effect if its latest outcome is `compensated`.
3. Retain the next attempt under the exact current head, then invoke the handler.
4. Retain the outcome under the attempt record.

If another compensator appended to the same path in between, the append fails with
`EffectCompensationConflictError` and no outcome is retained by the slower one. After every effect
was attempted, any `failed` outcome makes the trigger fail with `EffectCompensationFailedError`,
which names the failed compensations.

Materialization order is:

- **Replay branches**: the source session's steps from the target onward, in step order.
- **Scope discard**: each scope sealed by the decision, the subtree root first and each child after
  its parent in child registration order; within a scope, its selected history in order and each
  emission's citations in order. This is a linear extension of the scope tree's causal order;
  concurrent sibling scopes have no materialization order between them.

## Source disposition

Paper §3.2 rolls compensable effects back when the work that materialized them is rewound or
discarded. A replay branch does not by itself discard its source: the source session stays retained,
inspectable, and branchable. Whether opening a branch abandons the source's suffix is therefore an
explicit, configured branch option, `sourceDisposition`, with the vocabulary
`replay.branch.sourceDispositions` in [`protocol.config.json`](../protocol.config.json) (replay
protocol v3, `REPLAY_PROTOCOL_V3_CONTRACT`, generated `REPLAY_SOURCE_DISPOSITIONS`):

| Disposition | Meaning | Compensation |
| --- | --- | --- |
| `compensate` | The branch supersedes the source's suffix as the live timeline: the world is taken back to the target before the branch continues | Every successful compensable suffix effect is compensated once, before the branch opens |
| `retain` | The source stays a live alternative the branch is compared with, and several branches may start from it | None; no handler is invoked or required |

`replay.branch.defaultSourceDisposition` is `compensate`, for `rewindReplaySession` and
`replayReplaySession` alike. A plain rewind or replay is the operator's "take it back and try
again": the replayed suffix re-materializes its effects against the same world, so leaving the
source's compensable effects in place would apply them twice. Compensating is also the fail-safe
default: a caller that forgets the option gets a refused branch
(`EffectCompensationHandlerNotFoundError`) rather than a silently doubled world change.

Exploratory callers declare `retain`, because their source is the fixed baseline every branch is
measured against and compensating it on the first branch would corrupt every later one:

| Caller | Why the source is retained |
| --- | --- |
| [Tree-RL rollouts](./tree-rl-rollouts.md) | K sibling rollouts branch from the same root |
| [CRO](./counterfactual-optimization.md) candidate replays | Every candidate is scored against the same parent session |
| [Trajectory compression](./trajectory-compression.md) rewind and rerun | The source is the uncompressed trajectory the result is compared with |
| Meta-agent `replay` tool ([tool-use loop](./tool-use-loop.md#meta-agent-tool-catalog)) | A variant retry is an alternative, not an abandonment; the `rewind` tool still compensates |

A retaining branch's live suffix runs its effects through its own handlers, so an exploratory caller
is responsible for binding them to an isolated world (the applications' `bindings` factories) when
re-materializing a compensable effect against the source's world would be wrong. A branch retains
no record of its disposition; a compensating branch is evidenced by its compensation records. Tests:
[`replay-source-disposition.test.ts`](../test/replay/replay-source-disposition.test.ts),
[`exploratory-branch-compensation.test.ts`](../test/applications/exploratory-branch-compensation.test.ts)
(each application over a source with a successful compensable effect completes and leaves no
compensation path), and the meta-agent tool test
[`meta-agent-tools.test.ts`](../test/agent/meta-agent-tools.test.ts) ("the replay tool retains its
source while the rewind tool compensates its suffix").

## Triggers

| Trigger | `trigger.kind` | When | Failure behavior |
| --- | --- | --- | --- |
| `rewindReplaySession` | `replay_rewind` | Source disposition `compensate`: after target verification, before the branch opens | Throws before the branch opens; a retry of the same command resumes |
| `replayReplaySession` | `replay_replay` | Same as rewind; the live suffix may then re-materialize the effect | Same as rewind |
| `discardScope` | `scope_discard` | Missing handlers are refused before the decision; compensation runs after the decision and before custody cleanup | A thrown handler stops before cleanup; a failed result is reported after cleanup; a retry of the same command resumes |
| `compensateEffects` | `command` | Explicit materialization records in materialization order | Refuses records that are not successful compensable materializations |

Repeating a completed branch command returns its retained receipt without compensating. Retrying a
discard command re-runs compensation, which invokes no handler for compensated effects.

A scope's effects are the materializations its history cites. An application assigns an effect to a
scope by citing its replay step or dispatch resolution record in `emitScopeRecord`
(`citedRecordIds`); an effect cited by a scope that is not discarded is not compensated by the
discard of another scope.

## Crash and recovery

| Interrupted | Retained evidence | Next trigger |
| --- | --- | --- |
| Before the intent | Nothing | Retains the intent and attempts |
| After the intent | `pending` | Attempts |
| After an attempt, before or during the handler | `uncertain` | Retains a new attempt and invokes the handler again under the same key |
| After the handler changed the world, before the outcome | `uncertain` | Same; the idempotent handler changes nothing twice |
| After the outcome | `compensated` or `failed` | Never re-invokes a compensated effect; attempts a failed one |

The SIGKILL suite runs the `compensation` fault operation of the
[fault harness](./fault-and-fuzz-conformance.md) against a node:sqlite fixture world whose effect
inserts a row and whose compensation deletes it by primary key and logs every world-changing
deletion under the idempotency key. After every kill it reopens the store, classifies each started
compensation, retries it, and requires one retained `compensated` outcome and exactly one
world-changing deletion per effect. Two deterministic kills cover the handler after its world
change (recovered through a rewind trigger, two invocations, one deletion) and the moment after the
outcome was retained (no further invocation).

## Limits

- Handlers run in-process. Idempotency is the handler's obligation; the substrate supplies the key
  and never invokes a handler after a retained `compensated` outcome.
- Concurrent triggers on the same effect can both invoke the handler; the slower one fails with a
  conflict and retains no outcome. There is no compensation lease.
- A permanently failing compensation blocks its triggers; there is no waiver or manual-resolution
  record in this version.
- Effects without retained outcomes (`materialization_failed`, materialization-uncertain) and
  effects outside replay sessions and supervised dispatches are not compensated.
- The paper's refusal-path compensation is not wired: refused replay effects never materialize and
  need none.
