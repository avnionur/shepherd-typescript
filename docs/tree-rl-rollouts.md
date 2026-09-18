# Tree-RL adapter

Implementation: [`src/applications/tree-rl.ts`](../src/applications/tree-rl.ts),
[`src/applications/tree-rl-records.ts`](../src/applications/tree-rl-records.ts), and
[`src/applications/tree-rl-types.ts`](../src/applications/tree-rl-types.ts). Public entry point:
[`src/facades/applications.ts`](../src/facades/applications.ts) (`./applications`:
`selectTreeRlForkPoints`, `runTreeRlRollouts`, `computeTreeRlAdvantages`,
`exportTreeRlTrainingBatch`, `inspectTreeRlRun`), with root exports from
[`src/index.ts`](../src/index.ts). Configuration: `applications.treeRl` and `applications.limits`
in [`protocol.config.json`](../protocol.config.json) (applications protocol v4); the repository's
§5.3 protocol is the `treeRl` definition in
[`config/research-applications.config.json`](../config/research-applications.config.json).
Generated schema:
[`application-tree-rl-rollout-v1.schema.json`](../spec/schemas/application-tree-rl-rollout-v1.schema.json).
Tests: [`tree-rl.test.ts`](../test/applications/tree-rl.test.ts),
[`tree-rl-failures.test.ts`](../test/applications/tree-rl-failures.test.ts),
[`tree-rl-recovery.test.ts`](../test/applications/tree-rl-recovery.test.ts), and
[`tree-rl-records.test.ts`](../test/applications/tree-rl-records.test.ts). Manifest rules:
[application manifests](./application-manifests.md). Design constraints:
[research applications contract](../.plan/research-applications-contract.md).

## Composition

The adapter adds no substrate and trains nothing: it produces a training batch. It reads a recorded
source session with [`inspectReplaySession`](./replay-sessions.md), selects fork points with
`analyzeReplayDependencies`, replays each rollout from its fork point with
[`replayReplaySession`](./rewind-and-replay.md), and proves each rollout with
`analyzeReplayDivergence`. Every rollout session and append intent identity is derived from the
application identity, the fork step, and the seed, so a repeated command converges on retained
evidence.

The caller records the source session beforehand (for example with `runReplaySession`). It must be
finished and bind no worlds or processes, so every step boundary is an admissible replay target.

## Fork-point selection

`selectTreeRlForkPoints(store, { sessionId, minDependents, maxForkPoints, clock? })` visits the
provider steps of the session in index order. For each, `analyzeReplayDependencies` gives its
transitive dependents; the step qualifies when the dependent count reaches `minDependents`, and
qualifying steps are taken in index order until `maxForkPoints` are selected. Each fork point is
`{ step_index, prefix_id, dependents }`: `step_index` is the forked provider step and equals the
number of recorded prefix steps, and `prefix_id` is the source prefix identity at that boundary,
null when the fork step is step 0. The selection is a pure function of the retained session and
writes nothing. `maxForkPoints` must be positive; above `limits.maxForkPoints` it is
`ApplicationBudgetError`.

## Protocol

`runTreeRlRollouts` requires a protocol of kind `tree_rl` with:

- a `prompt` surface with the configured `rollout` role (the rollout policy prompt) and a `schema`
  surface with the `training_batch` role (the `jsonl_v1` line schema); both are pinned into the
  manifest by digest and are not evaluated at runtime;
- the budgets named by `applications.treeRl.budgetKeys`: `branches` (rollouts per fork point),
  `maxForkPoints` (the selection bound), `minDependents` (the selection minimum), and
  `maxProviderCalls` (live provider calls across every rollout session).

`branches` and `maxForkPoints` must be positive and `branches` must not exceed the declared seeds
(`ApplicationProtocolError`). `maxForkPoints` above `limits.maxForkPoints` and `branches` above
`limits.maxBranches` are `ApplicationBudgetError`, as is a plan whose selected fork points times
branches exceeds `limits.maxRollouts`. Branch `k` at every fork point uses the protocol's seed `k`.

## Rollouts

The caller supplies `sourceSessionId`, the source `program` (re-executed deterministically over the
recorded prefix), optional `handlers`, a `provider` factory, a `reward` function, optional
`baselines` (`["single_rollout"]` or none), and `clock`.

- `provider({ fork_point, branch, seed, source_session_id })` is called once for every planned
  rollout before any record is written. Each call must return a distinct provider whose descriptor
  kind is the configured static provider kind: every rollout runs under its own static cassette.
- Each rollout replays the source from its fork point's step boundary with `replayReplaySession`,
  declaring the `provider` change: the recorded prefix is served from the source journal, and the
  fork step and every later step run live under the rollout's provider.
- `analyzeReplayDivergence` must show no divergence before the fork point and none `unexplained`.
- `reward({ rollout, source, fork_point, branch, seed, cost, protocol })` scores each finished,
  proven rollout with one finite number.

A rollout is retained as `failed`, with the configured reason, and the run continues when its
session did not finish (`APPLICATION_EVIDENCE_INVALID`), it diverged before its fork point or
without explanation (`APPLICATION_EVIDENCE_INVALID`), its session was left non-terminal by a dead
writer whose lease expired (`APPLICATION_EVIDENCE_INVALID`), or the reward threw or returned a
non-finite value (`APPLICATION_VERIFICATION_FAILED`). The reward is never called for a rollout
whose session failed the first three checks.

## Advantages

`computeTreeRlAdvantages(rollouts)` groups rollouts by fork step and uses completed rollouts only:

- `intra_branch_advantage = reward - mean(completed rewards at the rollout's fork point)`;
- `inter_branch_advantage = mean(completed rewards at the fork point) - mean(every completed
  reward)`.

Failed rollouts are excluded from every mean and get no advantage. A fork point with one completed
rollout yields an intra-branch advantage of exactly `0`, and a run whose completed rollouts share one
fork point yields inter-branch advantages of exactly `0`. Means sum in input order, so the result is
a pure function of the rollout sequence.

## Training batch

The batch format is `jsonl_v1`: one canonical JSON line per completed rollout, in fork-point then
branch order, each followed by a line feed:

```json
{"fork_point":{"prefix_id":null,"step_index":0},"inter_branch_advantage":-1,"intra_branch_advantage":-1,"replay_session_id":"replay-session:sha256:…","reward":1,"rollout_id":"tree-rl-rollout:sha256:…","seed":3,"session_id":"replay-session:sha256:…","step_count":5}
```

`session_id` is the source session and `replay_session_id` the rollout session. The batch digest is
the configured algorithm over the UTF-8 batch text (`sha256:<hex>`). Every identity in a line is
derived from the command, the source session command, the fork step, and the seed, so two runs of
the same command over the same source with the same seeds, in any store, and any store that imported
the archive, produce the same batch text and digest. `exportTreeRlTrainingBatch(store, applicationId)`
re-derives the lines from the retained rollout records and refuses a digest that differs from the
retained one.

The `single_rollout` baseline is the batch of each fork point's first branch (seed 0 of the
protocol) with its own advantages, which are therefore all intra-branch `0`. It reuses the branch-0
rollouts rather than running separate sessions, so its measured cost is theirs. It is a tree with one
branch per fork point, forked from the same recorded prefix, not an independent root-level rollout,
and it is not an equal-budget comparison. A fork point whose branch 0 failed contributes no line,
so the baseline batch can cover fewer fork points than the tree batch.

## Retained records

Every record is `shepherd.application.tree_rl_rollout.v1` on the application owner path and conforms
to the closed [`application-tree-rl-rollout-v1`](../spec/schemas/application-tree-rl-rollout-v1.schema.json)
schema, whose `$defs.batchLine` is the `jsonl_v1` line grammar:

- the `opened` record names the command, protocol, source session, selected fork points with their
  dependent counts, branch seeds, and baselines;
- one `rollout` record per planned rollout, in fork-point then branch order: `rollout_id`
  (`tree-rl-rollout:sha256:` over the application, fork point, and seed), `fork_point`, `branch`,
  `seed`, `replay_session_id`, `status` (`completed` or `failed`), `reward` (null when failed),
  `step_count`, measured `cost`, and `failure`;
- the `batch` record retains the format, batch digest, and line count, and the `single_rollout`
  baseline's summary when requested; both re-derive from the rollout records whenever read.

The manifest is retained last with the terminal cut. Its artifacts are the source session
(`source_session`), every rollout record (`rollout`), the training batch (`training_batch`, content
`{ batch_digest, format, line_count }`, cited at the batch record), and the baseline batch
(`single_rollout_batch`) when requested. Costs are measured from the live provider steps of every
rollout session, failed ones included; a live call that failed before a response counts as one
call of unknown cost and makes `cost_usd` null. The caller-recorded source session is cited, not
charged.

## Validation, budgets, and recovery

Every option, the protocol, the source session, the selection (an empty selection is
`ApplicationEvidenceError`), the rollout bounds, every provider, and the projected provider calls
are validated before any record is written, so a refusal writes nothing and a corrected rerun of
the same command proceeds. The projection is the source's provider steps at or after each fork
point, summed over every rollout (retained rollouts count their measured cost). Before each new
rollout session opens, the measured calls so far plus its projection must stay within
`maxProviderCalls`; a rollout that issued more calls than projected makes the next one refuse with
`ApplicationBudgetError` before it opens, with the evidence up to it retained.

- Repeating a completed command returns the retained manifest and batch without executing a session
  or calling the provider factory or reward function. A repeat under a different protocol is
  `ApplicationProtocolError`; a repeat with a different source, baselines, or selection is
  `ApplicationEvidenceError`.
- A crash at the opened, a rollout, the batch, or the manifest append converges on rerun without
  extra live provider calls: rollout sessions are derived from the command and return their retained
  receipts, and the reward is called again only for a rollout whose record was never retained.
- A process that dies inside a rollout session leaves it non-terminal. While the dead writer's lease
  is live every rerun raises `ReplaySessionInterruptedError` (`running`) without a record. Once the
  lease expired the rollout is retained as `failed` with the interrupted reason and the run
  completes, so a crash never blocks the command permanently.
- A moved application head is `ApplicationEvidenceError`.

`inspectTreeRlRun(store, applicationId)` validates the whole owner path: the opened record and its
selection, every rollout in plan order with its derived rollout and session identities, the batch
record against the rollouts, the manifest, and the terminal cut. It embeds no live state, so it is
identical on the writing store, a reopened or read-only store, and an imported archive.

## Limits

- The adapter emits a training batch; it is not a trainer and claims no learning result.
- Fork points are trace-selected by declared dependencies, not proposed by a meta-agent; the paper's
  root-rollout generation is the caller's source recording.
- Every rollout runs against a caller-supplied static provider cassette; no live provider is used.
- The source binds no worlds or processes, and the program must declare its dependencies faithfully
  for selection and the divergence proof to mean anything.
