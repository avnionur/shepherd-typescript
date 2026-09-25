# Concurrent runtime supervisor

Status: normative from 11.1.0 ([#211](https://github.com/avnionur/shepherd-typescript/issues/211)).
Paper reference: [Shepherd v3](https://arxiv.org/html/2605.10913v3) Section 5.1 and Appendix E.

Implementation: [`src/applications/runtime-supervisor.ts`](../src/applications/runtime-supervisor.ts),
[`runtime-supervisor-policy.ts`](../src/applications/runtime-supervisor-policy.ts),
[`runtime-supervisor-records.ts`](../src/applications/runtime-supervisor-records.ts),
[`runtime-supervisor-schema.ts`](../src/applications/runtime-supervisor-schema.ts),
[`runtime-supervisor-types.ts`](../src/applications/runtime-supervisor-types.ts), and the world
adapter [`src/workspace/scope-world-adapter.ts`](../src/workspace/scope-world-adapter.ts). Public
entry points: `./applications` and the package root (`runRuntimeSupervisor`,
`inspectRuntimeSupervisorRun`, `createModelRuntimeSupervisorPolicy`,
`APPLICATION_RUNTIME_SUPERVISION_ACTIONS`, `APPLICATION_RUNTIME_SUPERVISION_PHASES`,
`APPLICATION_RUNTIME_SUPERVISION_ATTEMPT_CAUSES`, `APPLICATION_RUNTIME_SUPERVISION_ATTEMPT_STATUSES`).
Configuration: `applications.runtimeSupervision` and `applications.limits.maxTicks` /
`maxTickIntervalMilliseconds` in [`protocol.config.json`](../protocol.config.json) (applications
protocol v10); the repository protocol is the `runtimeSupervision` section of
[`config/research-applications.config.json`](../config/research-applications.config.json). Generated
schema:
[`application-runtime-supervision-v1.schema.json`](../spec/schemas/application-runtime-supervision-v1.schema.json).
Tests: [`runtime-supervisor.test.ts`](../test/applications/runtime-supervisor.test.ts),
[`runtime-supervisor-policy.test.ts`](../test/applications/runtime-supervisor-policy.test.ts),
[`runtime-supervisor-crash.test.ts`](../test/applications/runtime-supervisor-crash.test.ts),
[`runtime-supervisor-boundaries.test.ts`](../test/applications/runtime-supervisor-boundaries.test.ts), and
[`scope-world-adapter.test.ts`](../test/workspace/scope-world-adapter.test.ts).

The round-based, handle-level [coding supervisor](./coding-supervisor.md) is unchanged and remains
the durable child-run supervisor with its terminal `accept`. The runtime supervisor is the paper's
live supervisor: workers run concurrently and decisions take effect on running workers.

## Workers and custody

`runRuntimeSupervisor(store, options)` takes two or more workers (bounded by `limits.minWorkers`
and `limits.maxWorkers`), each `{ workerId, feature, model, tools, effects, system?, outputSchema? }`,
and a required world adapter. Every worker attempt is one [`runToolLoop`](./tool-use-loop.md)
session over its own custody from `world.fork`; `effects({ workerId, attempt, custody })` builds the
effect boundary bound to the custody root. Worker model calls go through `model.converse`. All
workers start at once and run concurrently; the supervisor never waits for one to finish before
another runs.

Each worker has a reserved stream owner path (prefixed like an application identity, so general
appends cannot forge it). The stream retains, in order: an `attempt` record (attempt number, the
tick that started it, cause `start`, `handoff`, or `discard`, leader, guidance, and custody with its
fork receipt and source custody), one `turn` record per completed model turn, and one `completed`
record (status `completed`, `turn_limit`, `failed`, or `aborted`, with the aborting decision). A
`turn` record carries the tool-call summaries, the digest of the exact canonical request, its
message count and cache prefix length, the assistant message, the next user message (tool results
then guidance), the final output of a turn without tool calls, the guidance ticks it delivered, and
the provider usage.

## Ticks and snapshots

The tick cadence is the protocol budget `tickIntervalMilliseconds` (5000 in the repository
protocol, the paper's 5 s). The optional `wait(milliseconds, signal)` option replaces the timer,
for example in tests. Each tick the supervisor drains one live
[trace subscription](./trace-subscriptions.md) over every worker stream up to the current heads and
builds one combined snapshot `{ tick, agents }`. Per agent it carries the paper's fields:

| Field | Meaning |
| --- | --- |
| `feature` | The worker's feature truncated to `maxFeatureCharacters` (350) with the configured marker |
| `events` | Cumulative tool-call events across attempts |
| `consecutive_errors` | Trailing failed, refused, or invalid calls of the current attempt |
| `modified_files` | `world.changedPaths` of the current custody, relative to the pre-run world |
| `last_action`, `ticks_ago` | The supervisor's most recent non-`none` action on the agent and its age in ticks |
| `trailing_tool_calls` | The last `trailingToolCalls` (25) summaries `{ tool, status, target, error }`, each at most `maxToolCallSummaryBytes` (150) canonical bytes |
| `attempt`, `status` | Current attempt and its status as delivered by the stream |

A summary's `target` is the first string input under the configured `targetInputKeys`; its `error`
is the refusal reason or the canonical error of a failed outcome; the error, then the target, is
truncated to fit the byte bound. The snapshot must satisfy the protocol's `observation` schema
surface; a refusal is `ApplicationProtocolError`.

## Decisions

The policy is consulted exactly once per tick with the snapshot and returns
`{ output, usage }`, where `output` is the Appendix E object:

```json
{ "decisions": [{ "agent": "a", "action": "inject", "reason": "<= 20 words", "guidance": "<= 60 words" }] }
```

`output` is validated against the protocol's `action` schema surface and then against the fixed
decision shape of the tick record schema (an object whose `decisions` array holds closed decisions
with a configured `action`), so a protocol with a looser `action` schema still has malformed
batches refused and retained instead of failing the run. It is then admitted: every
`agent` names a worker, no agent appears twice, `guidance` is required for `inject` and allowed only
for `inject` and `handoff`, `leader` is allowed only for `handoff` and names another worker that is
not itself handed off or discarded in the same batch, and `reason` and `guidance` respect
`maxReasonWords` (20) and `maxGuidanceWords` (60). Any issue refuses the whole batch: the tick is
retained with `refusal.issues` and no decision is applied. Agents the batch omits are `none`. The
tick record, holding the snapshot the policy saw, the subscription cursor, the raw output, the
admitted decisions, and the usage, is retained before any decision is applied, so recovered ticks
keep their exact observations.

Admitted decisions are applied in declared worker order:

| Action | Effect |
| --- | --- |
| `none` | Nothing |
| `inject` | The guidance is queued on the running attempt and joins its next user message after the tool results, between turns. Every earlier message and the cache prefix stay byte-identical. Several pending injects are joined with `guidanceSeparator`. Guidance that never reaches its attempt (it finished, or was replaced) is listed as undelivered at settlement |
| `handoff` | The attempt is aborted (its `completed` record is `aborted` with the decision) and a fresh session starts whose first user message carries the feature and then the guidance. Without `leader` it keeps the same custody, so written files remain. With `leader` the leader's current custody is forked, while the leader is between tool calls, as the agent's new root |
| `discard` | The attempt is aborted and a fresh session starts on a clean fork of the pre-run world, so every file the agent wrote is dropped |

`maxTurnsPerWorker` bounds each attempt (at most `providers.tools.loop.maxTurns`), `maxTicks`
bounds ticks (at most `limits.maxTicks`), and `maxProviderCalls` bounds worker model turns plus
policy consultations. Exhausting a budget aborts every running worker and raises
`ApplicationBudgetError`. A worker's own provider call that would exceed `maxProviderCalls` is a
run-level abort too: it retains no `failed` completion, and every running attempt, that worker's
included, stays open for a rerun.

## Settlement

When no worker is running after a tick, the run settles: the `settled` record names every worker's
final attempt, status, and custody, the undelivered guidance, and the custody to discard. Custody
abandoned by a `handoff` or `discard` is discarded deepest first unless a final custody was forked
from it. The manifest (kind `coding_supervisor`) cites the settlement, every stream head, each final
custody's fork receipt, and the aggregated discard receipts, with measured costs folded from every
worker turn and every model-serviced tick. Final custody is left open and returned as
`receipt.custody` for the caller to integrate with `world.merge`, as the paper merges patches after
the run. `world.merge` always lands in the parent world, including a follower's final custody after
a cross-agent handoff: it carries what the follower inherited from the leader at the fork and its
own writes, never what the leader wrote after the fork (for example writes a later `discard` of the
leader abandoned).

## Provider-backed policy

`createModelRuntimeSupervisorPolicy({ model, protocol })` sends one JSON-mode request per tick:
the protocol's `action` prompt (the Appendix E meta-agent prompt, with the paper's labels
`inject`/`handoff`/`discard` in place of the codebase synonyms `steer`/`redirect`/`revert`) as the
system prompt, one user message holding the `observation` prompt and the canonical JSON snapshot,
and the `action` schema as the output schema. A structured output is returned as is; text is parsed
as JSON, and text that is not JSON is returned unchanged so the runtime refuses and retains it.
Tests drive it with scripted conversational providers; no live model has run it in this repository
(no credentials).

## World adapter: forking another custody

`ApplicationWorldForkRequest.sourceCustodyId` asks the adapter to fork a custody's current tree
instead of the parent world. `createScopeWorldAdapter` implements it as a nested `forkScope` of the
source custody's scope, under a writer claimed with the source's own fork command identity.
`changedPaths` is relative to the first parent-world fork of the custody's lineage.

`merge` of a custody forked from the parent world merges it at both current heads. `merge` of a
nested custody rebases it onto the parent world:

1. its changes relative to the lineage base (the parent-world revision its first ancestor was forked
   from) must not overlap the parent world's changes since that base, under the same path rules as
   `mergeScope`; an overlap is `ScopeMergeConflictError` before anything is retained;
2. a fresh fork of the current parent world (command `<merge command>:rebase-fork`) receives exactly
   those changes;
3. the nested custody is sealed by a discard beneath its source (`<merge command>:rebase-seal`), so
   the source lineage becomes quiescent and can later be merged or discarded;
4. the fresh fork merges into the parent world under the merge command.

Every step replays from its retained command, so a retry after any interruption converges. When the
leader's custody is also final, both lineages carry the leader's pre-fork paths, so landing the
second one is refused as a merge conflict; integrate one of the two lineages.

`discard` discards the custody's subtree after releasing the writer claims the adapter took on the
custody and its registered descendants to fork from or discard beneath them. A completed merge or
discard command replays before the custody is resolved. A replayed fork registers the custody's
lineage before opening it, so a merge or discard that has not completed still resolves a custody
whose discard already began.

## Recovery

A rerun of the same command replays the retained run instead of starting over:

- The opened record must match: another protocol is `ApplicationProtocolError`; other workers or
  supervisor is `ApplicationEvidenceError`.
- Attempts are re-derived in creation order (initial starts, then each tick's handoffs and discards
  in worker order); retained attempts re-issue their forks under the same derived command
  identities so the adapter resolves their custody again, and missing ones are created exactly as
  the retained tick decided. The policy is never consulted for a retained tick.
- An attempt without a `completed` record resumes: its conversation is rebuilt byte for byte from
  the first user message and every retained assistant and next-user message, so the resent
  request equals the one in flight when the process died. Injected guidance not yet delivered is
  queued again and delivered at the next turn boundary.
- A run that fails with an error or the caller's signal aborts its workers without completing their
  attempts, exactly like a crash, so a rerun resumes them. A decision's abort does complete the
  attempt as `aborted`. A run stopped while a `handoff` or `discard` waits for the aborted attempt
  never starts the replacement; the rerun creates it as the retained tick decided.
- A settlement interrupted between two discards completes on rerun: every attempt's fork is
  re-issued, a custody whose settlement discard already completed is registered without its root
  (it cannot be reopened and nothing uses it), the completed discards replay, and the rest run.
- After the manifest is retained, a rerun returns it without running a policy or a worker.

## Limits

- A turn in flight at a crash is re-sent after recovery; its tool effects may already have reached
  the custody (at least once at the worker level), as the paper's redirect keeps files on disk.
- Handoff and inject semantics are the paper's; the `leader` field is a repository extension of the
  printed schema, which does not name how the cross-agent variant selects the leader.
- The fresh session after a handoff repeats the feature before the guidance, so the worker keeps its
  assignment.
- The provider-backed policy and live worker models were exercised only with scripted providers;
  no CooperBench or other measured result exists in this repository.
- Worker authority is whatever the caller's effects boundary grants; workers are not child-run
  handles, so delegated budgets and grants do not apply (use the
  [coding supervisor](./coding-supervisor.md) for handle-level supervision).
