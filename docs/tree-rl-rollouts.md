# Tree-RL adapter

Implementation: [`src/applications/tree-rl.ts`](../src/applications/tree-rl.ts),
[`src/applications/tree-rl-records.ts`](../src/applications/tree-rl-records.ts), and
[`src/applications/tree-rl-types.ts`](../src/applications/tree-rl-types.ts). Public entry point:
[`src/facades/applications.ts`](../src/facades/applications.ts) (`./applications`:
`runTreeRlRollouts`, `createMetaAgentTreeRlForkSelector`, `createDependencyTreeRlForkSelector`,
`computeTreeRlAdvantages`, `exportTreeRlTrainingBatch`, `exportTreeRlBatchToTrainer`,
`inspectTreeRlRun`, `selectTreeRlForkPoints`), with root exports from
[`src/index.ts`](../src/index.ts). Configuration: `applications.treeRl` and `applications.limits`
in [`protocol.config.json`](../protocol.config.json) (applications protocol v8); the repository's
§5.3 protocol is the `treeRl` definition in
[`config/research-applications.config.json`](../config/research-applications.config.json).
Generated schema:
[`application-tree-rl-rollout-v1.schema.json`](../spec/schemas/application-tree-rl-rollout-v1.schema.json).
Tests: [`tree-rl.test.ts`](../test/applications/tree-rl.test.ts),
[`tree-rl-meta-agent.test.ts`](../test/applications/tree-rl-meta-agent.test.ts),
[`tree-rl-failures.test.ts`](../test/applications/tree-rl-failures.test.ts),
[`tree-rl-recovery.test.ts`](../test/applications/tree-rl-recovery.test.ts),
[`tree-rl-records.test.ts`](../test/applications/tree-rl-records.test.ts), and
[`tree-rl-worlds.test.ts`](../test/applications/tree-rl-worlds.test.ts). Manifest rules:
[application manifests](./application-manifests.md). Design constraints:
[research applications contract](../.plan/research-applications-contract.md).

## Algorithm 2

Since 10.0.0 the adapter implements the batch iteration of paper Appendix F.6, Algorithm 2
(Meta-Agent Guided Tree-RL), up to the policy update, which it leaves to a trainer:

| Algorithm 2 | This adapter |
| --- | --- |
| (A) G root rollouts per prompt `q_b` of a batch, `R_root = Grade(tau_root)` | The caller records G root sessions per prompt (for example with `runReplaySession`); the adapter grades each with `reward` (member `root`) |
| (B) `t* <- P(tau_root)`, revert to right before step `t*`, K forked branches continue under the policy | A fork selector proposes `{ branch_turn, tool_call, reason }` per root; K branches replay the root from the boundary before the fork turn, and the proposed tool call seeds the first branch |
| (C) inter-root advantage for prefix actions `j < t*`, intra-tree advantage for suffix actions `j >= t*` | `computeTreeRlAdvantages` and the per-action `jsonl_v2` batch |
| Clipped GRPO update over the pooled advantages | Not implemented: `exportTreeRlBatchToTrainer` hands the batch to a caller's trainer adapter |

A turn is one provider step of a session, numbered from 1 in step order. A root with `T` turns
forks at turn `t*` by replaying from the step boundary immediately before the `t*`-th provider
step, so turns `1..t*-1` are the shared prefix and every branch executes turn `t*` and later live.

## Fork selection

A fork selector is `(context) => { branch_turn, tool_call, reason }` (sync or async). Its context
names the prompt, the root's group index, the root session inspection, its reward (null when
grading failed), its turns (`{ turn, step_index, request, output, restorable }`), the admissible
bounds, and the protocol. `tool_call` is `{ name, arguments }` or null; `reason` is non-empty
within `limits.maxReasonLength`. A malformed proposal is a `TypeError`; the root records before it
stay retained.

- The proposed turn is clamped into `[forkTurn.first, max(first, T - forkTurn.trailing)]`, which the
  configuration sets to the paper's `[1, T - 2]` (a root of fewer than three turns forks at turn 1).
  For a world- or process-bound root the clamped turn moves to the nearest admissible turn whose
  boundary retains a checkpoint not classified `unavailable` (the earlier on a tie). The root record
  retains both the `proposed_turn` and the resolved `branch_turn`.
- `createMetaAgentTreeRlForkSelector({ provider, signal? })` is the provider-backed meta-agent of
  paper Appendix F.7. It sends one structured request per root: the instruction is the protocol's
  `prompt` surface with role `fork_selector`, the output schema is its `schema` surface with role
  `fork_proposal`, and the input is `{ prompt_id, reward, turn_bounds, turn_count, turns }`, each
  turn carrying its request instruction and input and its output. The output must satisfy every
  `fork_proposal` schema surface and the proposal grammar, otherwise the selector raises
  `ApplicationVerificationError`. A protocol without both surfaces is `ApplicationProtocolError`.
  Any model provider works, including a [live provider](./live-providers.md); this repository runs
  it only against fixture providers.
- `createDependencyTreeRlForkSelector()` keeps the deterministic heuristic: among admissible
  restorable turns it proposes the one with the most transitive dependents in the root's declared
  dependency graph (the earliest on ties), no tool call, and the configured `dependencySelection`
  reason. It is a pure function of the retained root.

The proposed tool call seeds branch 0 of its root: that plan is `seeded: true` and the provider
factory context carries `tool_call`. The factory renders it into the policy's response format, so the
branch's first live action is the call (the paper re-renders the command through the policy's
renderer). The adapter does not inspect provider outputs, so a factory that ignores `tool_call`
leaves the branch unseeded in fact while its record still says `seeded`.

`selectTreeRlForkPoints(store, { sessionId, minDependents, maxForkPoints, clock? })` still lists
the trace-selected candidate fork points of one session (provider steps whose transitive dependent
count reaches `minDependents`, restorable ones only for a world- or process-bound session, at most
`maxForkPoints`, above `limits.maxForkPoints` `ApplicationBudgetError`); it writes nothing.

## Protocol

`runTreeRlRollouts` requires a protocol of kind `tree_rl` with:

- a `prompt` surface with the configured `rollout` role and a `schema` surface with the
  `training_batch` role (the `jsonl_v2` line schema); every exported line, baseline lines included,
  is validated against each `training_batch` schema surface
  ([JSON Schema validation](./json-schema-validation.md)) before the batch record is retained; a
  refusal is `ApplicationProtocolError` with the path-level issues as its cause;
- for the meta-agent selector only, the `fork_selector` prompt and `fork_proposal` schema surfaces;
- the budgets named by `applications.treeRl.budgetKeys`: `branches` (K per root), `groupSize`
  (G roots per prompt), and `maxProviderCalls` (live provider calls across every branch rollout).

`branches` and `groupSize` must be positive and `branches` must not exceed the declared seeds
(`ApplicationProtocolError`). `branches` above `limits.maxBranches`, `groupSize` above
`APPLICATION_TREE_RL_LIMITS.maxGroupSize`, more than `maxPrompts` prompts, B·G·K rollouts above
`limits.maxRollouts`, or more cited artifacts than `limits.maxArtifacts` is `ApplicationBudgetError`.
Branch `k` of every root uses the protocol's seed `k`.

## Running

`runTreeRlRollouts(store, options)` takes `commandId`, `claimId`, `protocol`, `prompts`,
`selector`, `provider`, `reward`, and optional `baselines` (`["flat_grpo"]` or none), `bindings`,
`concurrency`, `normalization`, and `clock`.

- `prompts` is the batch: distinct `{ id, program, handlers?, roots }`, where `roots` are exactly G
  distinct finished root session identities and `program` is their deterministic program. A root
  that did not finish or has no turn is `ApplicationEvidenceError`, a world- or process-bound root
  without a `bindings` factory is `TypeError`, and one with no admissible restorable turn is
  `ApplicationEvidenceError`, all before any record.
- Every root is graded by `reward({ member: "root", rollout, root, prompt_id, group_index, cost,
  protocol, branch: null, seed: null, fork_point: null })` and then handed to `selector`. A reward
  that throws or is not finite retains the root grading as `failed`
  (`APPLICATION_VERIFICATION_FAILED`); the root is still forked, with a null reward in the selector
  context.
- `provider({ prompt_id, group_index, root_session_id, fork_point, branch_turn, branch, seed,
  tool_call })` is called once for every rollout without a retained record, after every root is
  retained. Each call must return a distinct provider whose descriptor kind is the configured
  static kind (`TypeError` otherwise; the opened and root records stay retained).
- Each branch replays its root from the fork boundary with `replayReplaySession` declaring the
  `provider` change. A world- or process-bound root targets the checkpoint at that boundary, and
  `bindings(context)` supplies fresh restoration roots, process adapters, and a handler stack
  (defaulting to the prompt's `handlers`), once per rollout that is not yet retained. Every branch
  declares `sourceDisposition: "retain"`: the K siblings share one retained root, so no rollout
  compensates the root's compensable suffix effects and no compensation registry is needed
  ([source disposition](./compensation.md#source-disposition),
  [`exploratory-branch-compensation.test.ts`](../test/applications/exploratory-branch-compensation.test.ts)).
- `analyzeReplayDivergence` must show no divergence before the fork step and none `unexplained`;
  `reward({ member: "branch", ... })` grades each finished, proven branch.

Root gradings and selections, then branch rollouts, run with up to `concurrency` in flight
(default `APPLICATION_TREE_RL_LIMITS.defaultConcurrency`, at most `maxConcurrency`). Records are
appended in prompt, root, then branch order as soon as every earlier one is retained, so the
retained records, batch, and digest do not depend on concurrency.

A rollout is retained as `failed` with the configured reason, and the run continues, when its
session did not finish, diverged before its fork step or without explanation, or was left
non-terminal by a dead writer whose lease expired (all `APPLICATION_EVIDENCE_INVALID`), or its
reward threw or was not finite (`APPLICATION_VERIFICATION_FAILED`).

## Advantages

`computeTreeRlAdvantages(trees, normalization?)` implements Algorithm 2 lines 22-25 over
`{ prompt_id, group_index, root, branches }` trees (null rewards are failed members):

- inter-root advantage of root `g` of prompt `b`, attributed to its prefix actions `j < t*`:
  `A_inter = R_root(b,g) - mean over the prompt's completed roots of R_root`;
- intra-tree advantage of member `k` in `{root, 0..K-1}`, attributed to its suffix actions
  `j >= t*`: `A_intra(k) = R_k - mean over the tree's completed members, root included, of R`.

Appendix F.6 states that "advantages are GRPO-normalized and standardized per group". Under the
configured default normalization `group_std`, each centered value is divided by `std + epsilon` of
its group (the G roots for the inter-root advantage, the K+1 tree members for the intra-tree
advantage), with the configured estimator `sample` (squared deviations over `n - 1`) and
`epsilon = 1e-6`; a group of fewer than two completed members has standard deviation 0. The paper
does not name the estimator or epsilon. These follow the common GRPO outcome-advantage recipe and
are pinned by applications protocol v8. `normalization: "none"` returns the raw centered values of
Algorithm 2. Failed members are excluded from every mean and receive null. The run retains its
normalization in the opened record.

## Training batch

The batch format is `jsonl_v2`: one canonical JSON line per graded tree member, in prompt, root,
then member order (the root, then its branches), each followed by a line feed:

```json
{"actions":[{"advantage":-1,"segment":"prefix","step_index":0,"turn":1},{"advantage":-2,"segment":"suffix","step_index":1,"turn":2}],"branch":null,"branch_turn":2,"fork_point":{"prefix_id":"replay-prefix:sha256:…","step_index":1},"group_index":0,"inter_root_advantage":-1,"intra_tree_advantage":-2,"member":"root","prompt_id":"task","replay_session_id":"replay-session:sha256:…","reward":1,"rollout_id":null,"root_session_id":"replay-session:sha256:…","seed":null,"seeded":false,"step_count":5}
```

`actions` lists every turn of the member session with its attributed advantage: `prefix` turns
(before the fork turn, the recorded steps every branch shares) carry the inter-root advantage and
`suffix` turns carry the member's intra-tree advantage. When the root's grading failed its prefix
actions have no inter-root advantage and are omitted. The prefix actions of a root and its branches
are the same recorded steps; a trainer that must not count them once per member can deduplicate by
`root_session_id` and `step_index`. `replay_session_id` is the member's session (the root session
for the root), and `rollout_id` and `seed` are null for the root.

The `flat_grpo` baseline is Flat GRPO over the same roots: one line per completed root in which
every action carries the inter-root advantage with segment `flat` and `intra_tree_advantage` is
null. It reuses the tree's roots, so it is not the paper's matched-compute comparison.

The batch digest is the configured algorithm over the UTF-8 text (`sha256:<hex>`). Every identity
in a line is derived from the command, the root sessions, the fork decision, and the seed, so the
same command over the same roots with the same fork decisions yields the same text and digest in
any store, at any concurrency, and after archive import. `exportTreeRlTrainingBatch(store,
applicationId)` re-derives the lines from the retained records, refuses a digest that differs from
the retained one, and reports the run's `normalization`.

`exportTreeRlBatchToTrainer(store, applicationId, { id, formats, submit })` is the optional
trainer-export adapter seam: it exports the batch, refuses (`ApplicationProtocolError`) an adapter
whose `formats` do not include the batch format, and returns `submit(batch)`. No trainer ships with
the package, and nothing is written.

## Retained records

Every record is `shepherd.application.tree_rl_rollout.v1` on the application owner path and conforms
to the closed [`application-tree-rl-rollout-v1`](../spec/schemas/application-tree-rl-rollout-v1.schema.json)
schema, whose `$defs.batchLine` is the `jsonl_v2` line grammar:

- the `opened` record names the command, protocol, prompts with their root sessions, branch seeds,
  normalization, and baselines;
- one `root` record per root, in prompt then root order: `prompt_id`, `group_index`,
  `root_session_id`, `status`, `reward`, `failure`, measured `cost`, `step_count`, `turns` (the step
  index of every turn), and `fork` (`branch_turn`, `proposed_turn`, `fork_point`, `reason`,
  `tool_call`), caused by the root's terminal record;
- one `rollout` record per branch, in prompt, root, then branch order: `rollout_id`
  (`tree-rl-rollout:sha256:` over the application, root, fork point, and seed), `prompt_id`,
  `group_index`, `root_session_id`, `fork_point`, `branch_turn`, `branch`, `seed`, `seeded`,
  `replay_session_id`, `status`, `reward`, `step_count`, `turns`, measured `cost`, and `failure`;
- the `batch` record retains the format, digest, and line count, and the `flat_grpo` baseline's
  summary when requested; both re-derive from the root and rollout records whenever read.

The manifest is retained last with the terminal cut. Its artifacts are every root record (`root`),
every rollout record (`rollout`), the training batch (`training_batch`), and the baseline batch
(`flat_grpo_batch`) when requested. Costs are the measured live provider steps of every root session
and every rollout session, failed ones included; a live call that failed before a response counts
as one call of unknown cost and makes `cost_usd` null. Meta-agent selector calls are not measured.

## Validation, budgets, and recovery

Every option, the protocol, the prompts, every root, the bounds, and the projected provider calls
are validated before any record is written. The projection assumes each root without a retained
decision forks at its earliest admissible turn (the most live steps), sums the root's provider steps
from that fork step for each of its K branches, and counts retained rollouts at their measured cost.
Before each new rollout session opens, the measured calls so far plus the projections of rollouts in
flight plus its own must stay within `maxProviderCalls`, otherwise `ApplicationBudgetError` with the
evidence up to it retained.

- Repeating a completed command returns the retained manifest and batch without calling the
  selector, provider factory, or reward. A repeat under a different protocol is
  `ApplicationProtocolError`; with different prompts, baselines, or normalization it is
  `ApplicationEvidenceError`.
- A crash at any append converges on rerun without extra live provider calls: rollout sessions are
  derived from the command and return their retained receipts; the selector and reward are called
  again only for a root or rollout whose record was never retained, including under concurrency.
- A process that dies inside a rollout session leaves it non-terminal. While the dead writer's lease
  is live every rerun raises `ReplaySessionInterruptedError` (`running`) without a record; once the
  lease expired the rollout is retained as `failed` with the interrupted reason.
- A moved application head is `ApplicationEvidenceError`.

`inspectTreeRlRun(store, applicationId)` validates the whole owner path (opened, roots in order
with their fork decisions, rollouts against the plans the roots determine, batch, manifest, cut) and
is identical on writing, read-only, and imported stores. Its `rollouts` are empty until every root
is retained.

## Limits

- The adapter emits a training batch; it runs no policy update and claims no learning result.
- Root rollouts are the caller's recordings; the adapter grades and forks them.
- Branch rollouts run against caller-supplied static provider cassettes; the meta-agent selector
  accepts any provider but is exercised here only with fixture providers.
- Seeding relies on the provider factory rendering the proposed tool call; the adapter records the
  intent (`seeded`) but does not parse provider outputs.
- The standard deviation estimator and epsilon are this repository's pinned choice where the paper
  is silent.
- `maxRollouts` (64) bounds B·G·K far below the paper's 16 × 8 × 4 configuration.
- A world- or process-bound root forks only at checkpointed boundaries; the program must declare
  its dependencies faithfully for the dependency selector and the divergence proof to mean anything.
