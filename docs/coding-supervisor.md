# Two-worker coding supervisor

Implementation: [`src/applications/coding-supervisor.ts`](../src/applications/coding-supervisor.ts),
[`src/applications/supervisor-types.ts`](../src/applications/supervisor-types.ts),
[`src/applications/records.ts`](../src/applications/records.ts), and the world adapter
[`src/workspace/scope-world-adapter.ts`](../src/workspace/scope-world-adapter.ts). Public entry
points: [`src/facades/applications.ts`](../src/facades/applications.ts) (`./applications`:
`runCodingSupervisor`, `inspectCodingSupervisorRun`) and
[`src/facades/workspace.ts`](../src/facades/workspace.ts) (`./workspace`:
`createScopeWorldAdapter`), with root exports from [`src/index.ts`](../src/index.ts).
Configuration: `applications.supervision` and `applications.limits` in
[`protocol.config.json`](../protocol.config.json); the repository's Appendix E protocol is
[`config/research-applications.config.json`](../config/research-applications.config.json).
Generated schema:
[`application-supervision-v1.schema.json`](../spec/schemas/application-supervision-v1.schema.json).
Tests: [`coding-supervisor.test.ts`](../test/applications/coding-supervisor.test.ts),
[`coding-supervisor-policies.test.ts`](../test/applications/coding-supervisor-policies.test.ts),
[`coding-supervisor-crash.test.ts`](../test/applications/coding-supervisor-crash.test.ts),
[`coding-supervisor-recovery.test.ts`](../test/applications/coding-supervisor-recovery.test.ts), and
[`scope-world-adapter.test.ts`](../test/workspace/scope-world-adapter.test.ts). Manifest rules:
[application manifests](./application-manifests.md). Design constraints:
[research applications contract](../.plan/research-applications-contract.md).

## Composition

The supervisor adds no substrate. Every worker is a [child run handle](./task-values.md) opened
under the caller's root declaration, and every intervention is a
[supervisor operation](./supervisor-operations.md): `openChildRun`, `runChildRun`,
`observeChildRun`, `injectChildRunContext`, `handoffChildRun`, `discardChildRun`, `retryChildRun`,
and `acceptChildRunResult`. Each command identity is derived from the application identity, the
step, the round or attempt, and the worker, so every command is globally idempotent and a repeated
run converges on the retained receipts.

## Protocol

`runCodingSupervisor` requires a protocol of kind `coding_supervisor` with:

- a `prompt` and a `schema` surface for each of the configured `observation` and `action` roles;
- at least one `tool` surface (the coordination tools a model-serviced policy may call);
- the budgets named by `applications.supervision.budgetKeys`: `maxRounds` bounds decision rounds
  (and may not exceed `limits.maxRounds`), `maxProviderCalls` bounds the total number of worker
  starts, and each optional per-worker key (`maxTurnsPerWorker` for the run budget `maxTurns`)
  requires every worker to declare that metric no greater than the bound.

A protocol that is not a coding supervisor protocol, or lacks a required surface or budget, is
`ApplicationProtocolError` before any record. Surfaces are pinned into the manifest by digest; the
supervision records themselves use the closed `application-supervision-v1` schema.

The `observation` and `action` schema surfaces are the caller's model-facing documents and are
pinned by digest only; the runtime does not evaluate them. What the runtime validates is: every
policy decision against the closed decision grammar of `application-supervision-v1` (kind,
worker, citations, data, reason, successor) and the run's worker set, and every retained
observation, conflict, decision, and evidence against the same closed schema when the record is
written and whenever it is read. The repository has no runtime JSON Schema evaluator (the task
schema adapter covers only strings, null, and strict objects), so a caller that needs its own
observation or action documents enforced validates them inside its policy.

## Workers and world custody

Workers are child run definitions `{ workerId, task, input, grant, budget, provenance?, program |
provider }` with exactly one of `program` or `provider`. The worker count is bounded by
`limits.minWorkers` and `limits.maxWorkers`; two workers is a property of the repository
experiment, not of the code. Grants and budgets are attenuated through the delegation seam and can
never exceed the root declaration.

The run binds exactly one of:

- `world`: an `ApplicationWorldAdapter` with `fork`, `merge`, `discard`, and `changedPaths`. Every
  worker attempt gets clean isolated custody from `fork`; a program worker receives it as
  `context.custody`. `createScopeWorldAdapter` in `./workspace` implements the adapter over
  `forkScope`, `mergeScope`, `discardScope`, `createWorldChangeset`, and the scope writer claim
  for one bound resource. Each adapter request carries an application-derived command identity,
  and the scope adapter returns the retained receipt when that command already completed.
- `changedPaths`: the trace-only path. A caller reader returns the declared changed paths of each
  finished worker output; no custody exists.

The applications area imports no workspace code, so the trace-only path is first-class.

## Rounds

Opening retains one `opened` supervision record naming the supervisor, the protocol identity,
whether custody is used, and each worker's first handle. Then each round:

1. Observes every live worker: `observeChildRun` delivers every retained handle and child run
   record, and the observation records attempt, handle, head, status, completion status,
   supervisor, custody, delivered cursor, changed paths, and lineage status. Observation never
   writes to a worker owner path.
2. Classifies conflict: `path_overlap` when the canonical changed-path sets of two or more workers
   intersect (with the sorted overlapping paths and workers), otherwise `none`.
3. Consults the caller policy once and applies its decision.
4. Retains one `decision` supervision record with the round, observations, conflict, decision, and
   exact evidence, citing the evidence records as causal parents.
5. Runs every ready worker, refusing with `ApplicationBudgetError` first when the starts would
   exceed `maxProviderCalls`.

| Decision | Behavior | Retained evidence |
| --- | --- | --- |
| `observe` | No intervention | None beyond the decision record |
| `inject` | `injectChildRunContext` with the cited records and data; a worker that has not started consumes it in its composed request | `injection_record_id` |
| `handoff` | `handoffChildRun` to `successor_supervisor_id`; later commands on the worker name the successor | `handoff_record_id`; former-supervisor commands are refused by the delegation seam |
| `discard_restart` | `discardChildRun`, world discard of the attempt's custody, a clean fork, and `retryChildRun` for the next attempt | `decision_record_id`, `discard_receipt_id`, `fork_receipt_id`, `retry_cut_id`, `successor_handle_id` (receipts are null on the trace-only path) |
| `accept` | `acceptChildRunResult` for one finished worker, world merge of its custody, then `discardChildRun` and world discard for every other worker | `decision_record_id`, `merge_receipt_id`, and per discarded worker its `decision_record_id` and `discard_receipt_id` |

`accept` is terminal: exactly one worker is accepted and merged and every other worker is
discarded. A restarted worker always starts from a clean fork, never from discarded custody.
Accepting a worker that has not finished is refused by the delegation seam
(`DelegationStatusError`). Exceeding `maxRounds` is `ApplicationBudgetError`.

After `accept` the supervisor retains the manifest with artifacts of role `worker` (every attempt,
citing its head record and child cut), `decision`, `world_fork`, `world_merge`, and
`world_discard`, and measured costs folded from every attempt's retained usage.

## Repeats, crashes, and inspection

- Repeating the command after the manifest is retained returns it without running a policy or
  worker; a repeat under a different protocol is `ApplicationProtocolError`, and a repeat with
  different workers (identities or order), supervisor, or world binding is
  `ApplicationEvidenceError`. Both refusals are checked against the retained opened record before
  any fork or handle is opened, so a refused repeat writes no record and forks no custody.
- Before the manifest, a repeat re-derives every open, fork, and command identity, replays retained
  decisions in round order without consulting the policy, and continues at the first unretained
  round. Each attempt is replayed under the supervisor that opened it (the run's supervisor for a
  first attempt, the predecessor's supervisor for a restart), and a retained `handoff` advances it
  exactly as the first run did, so inject, handoff, and restart rounds in any order resume without
  re-executing a worker.
- A process killed after a round's decision was applied but before its decision record was
  retained leaves the round's delegation commands on the worker handles under round-derived
  identities. The rerun rebuilds that decision from the retained command bodies (accept first,
  then discard, handoff, or inject) instead of consulting the policy, completes the remaining
  idempotent steps, and retains the decision record. Its observations are re-derived at recovery,
  so they reflect the applied commands; custody the rebuilt `accept` or `discard_restart` may
  already have merged or discarded is observed with no changed paths. A round whose decision was
  `observe` left no effect and consults the policy again.
- A process killed between a world fork and the worker's durable start re-issues the same fork
  command identity on rerun; the scope adapter returns the retained fork receipt and custody, so no
  second fork is made.
- A process killed after a worker's durable start leaves that worker `running` and fail-closed: the
  rerun is refused with `DelegationStatusError` until the documented
  [cancellation path](./durable-execution-control.md) settles the child
  (`requestDurableTaskCancellation`, then `acknowledgeDurableTaskCancellation`). The rerun then
  observes the cancelled attempt and a `discard_restart` restarts it from clean custody without
  duplicate records.
- A moved application head is `ApplicationEvidenceError`; nothing is written.

`inspectCodingSupervisorRun(store, applicationId)` validates the whole application owner path: the
opened record, contiguous decision rounds chained on the head, the manifest, and the terminal cut.
Every worker lineage handle must re-derive from this application's open command for that worker
and attempt. Each attempt carries its record-derived child run inspection and lineage status
(`running`, `accepted`, `discarded`, `restarted`, or `handed_off`). Inspection is identical on the
writing store, a reopened or read-only store, and an imported archive.

## Limits

- Handoff transfers supervisor ownership of a handle only; no live process, provider session, or
  world state moves.
- The protocol's observation and action schema surfaces are pinned by digest for model-serviced
  policies; the runtime validates retained observations and decisions against the closed
  supervision record schema, not against the caller's schema documents.
- Decisions are applied before their record is retained, because the record cites the evidence the
  application produced. A decision recovered after a crash in that window is the applied decision,
  but its observations are re-derived at recovery rather than the ones the policy saw. Retaining
  the policy's exact pre-effect observations would need a new pre-effect supervision phase in a
  successor schema version.
