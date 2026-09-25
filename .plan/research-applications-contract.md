# Research applications contract

Status: TypeScript contract, Phase 10 task 1 (#171), 2.20.2. It is implemented by application
manifests and the two-worker coding supervisor (#172, 2.21.0), the counterfactual replay optimizer
(#173, 2.22.0), Appendix D trajectory compression (#174, 2.23.0), the Tree-RL adapter (#175,
2.24.0), and evaluation, baselines, and reporting (#176, 2.25.0). Conformance and the
[Phase 10 exit audit](./phase-10-exit-audit.md) are #177 (2.25.1). Normative behavior lives in
`docs/`; this page records the reviewed design constraints and deliberate non-claims.

## Evidence

Pinned release source: `a8196d4c453514836d06bd2fece91a03cdc37107`
([upstream.lock.json](../upstream.lock.json)).

- The paper (§5.1, Appendix E) describes a runtime supervisor that subscribes to two workers'
  effect streams without perturbing them, prefers inject, and falls back to handoff (fork the
  leading worker's scope as the follower's new root and restart) and discard. It versions an
  observation cadence, a coordination tool API, a meta-agent prompt, timeouts, and a dataset of
  CooperBench pairs. It gives no record format for observations, decisions, or handoffs, no
  conflict definition beyond the pair failing together, and no rule for what a restarted worker
  inherits.
- The paper (§5.2, Appendix F) describes counterfactual replay optimization: a proposer inspects a
  pool of workflow variants and their traces, picks a parent candidate, emits candidate edits with
  fix and guard sets, forks the parent's trace at the first step the edit affects, replays the
  suffix, gates on a targeted evaluation, and promotes the best dev-set scorer. It describes a
  scratchpad layout, a handoff manifest, and candidate lineage in prose. It gives no candidate
  record schema, no definition of "first affected step" over declared dependencies, and no
  divergence proof.
- The paper (§5.3) describes meta-agent-guided Tree-RL: G root rollouts, a fork turn per root,
  K sibling branches, inter-root advantages for the prefix and intra-tree advantages for the
  suffix, and a training adapter emitting per-action advantages. Appendix F.6 (Algorithm 2) gives
  the exact advantage formulas and F.7 the meta-agent's `{branch_turn, tool_call, reason}` output
  over `[1, T - 2]`; it gives no batch format and does not name the standard deviation estimator.
- The paper (Appendix D) describes hindsight trajectory compression: a meta-agent proposes fork
  points and hints so a shorter passing rerun replaces the original, a verifier admits the rerun,
  the original is kept when no shorter rerun is admitted, and a best-of-N control compares against
  plain reruns at equal budget. It gives no fork-point or hint schema, no restoration rule, and no
  definition of what the verifier sees.
- The pinned release has no supervisor, optimizer, compression, or Tree-RL application, no
  application manifest, and no evaluation artifact. [Research notes](./research-notes.md) list the
  meta-agent applications among the capabilities the reference does not ship.

These are source-level observations, not executed Python conformance. The TypeScript design keeps
the paper's model and adds what it does not specify: a canonical digest-bearing manifest per
application run, retained decision and candidate records citing exact evidence, a dependency-scoped
suffix rule with a divergence proof, deterministic trace-selected fork points, and a measured-only
evaluation report. Phase 10 adds no substrate: every application composes existing public seams.

Existing TypeScript authorities stay normative:
[task values and child run handles](../docs/task-values.md),
[delegated authority](../docs/delegated-authority.md),
[supervisor operations](../docs/supervisor-operations.md),
[result threading](../docs/result-threading.md), [replay sessions](../docs/replay-sessions.md),
[coupled checkpoints](../docs/coupled-checkpoints.md),
[rewind and replay](../docs/rewind-and-replay.md), [scope fork](../docs/scope-fork.md),
[scope merge and discard](../docs/scope-merge-discard.md),
[the provider contract](../docs/static-provider.md), and
[native interchange](../docs/trace-interchange.md).

## Application manifests and protocol identity

An **application protocol definition** pins everything an application run depends on besides the
store: its kind, a caller `protocolVersion`, an ordered list of **surfaces** (each a prompt, a
JSON Schema document, or a tool declaration with a stable `id` and a declared `role`), integer
`budgets` by metric name, `seeds`, and a **dataset selection** `{ id, revision, items }`.

- `readApplicationProtocol(value)` accepts only a plain data object of exactly those keys, refuses
  unknown kinds, surface kinds, duplicate surface identities, non-integer budgets and seeds, and
  sizes over the configured limits. `applicationProtocolId(definition)` is the digest of the
  canonical definition under `application-protocol:sha256:`.
- An **application manifest** is the canonical record of one run: `manifest_id`
  (`application-manifest:sha256:`, the digest of the manifest body without the identity),
  `manifest_version`, `compatibility_version`, `kind`, `application_id`, `protocol_id`,
  `protocol_version`, the surfaces as `{ id, kind, role, digest }` (content is cited by digest,
  never embedded), `budgets`, `seeds`, `dataset`, `artifacts`, and `costs`.
- The application identity is derived from the caller's globally idempotent command identity
  (`application:sha256:`) and names the run's reserved owner path. Raw appends and cut publication
  onto application owner paths are refused.
- `artifacts` cites every produced artifact by identity: `{ artifact_id, role, digest, record_id,
  cut_id }` with `application-artifact:sha256:` over the artifact's canonical content. Worker
  cuts, decision and candidate records, merge and discard receipts, compressed sessions, rollouts,
  and training batches are artifacts; none is embedded.
- `costs` is measured, never estimated: `provider_calls`, `input_tokens`, `output_tokens`,
  `cache_creation_input_tokens`, `cache_read_input_tokens`, and `cost_usd`, folded from the
  observed usage of every child run and replay session the run produced. `cost_usd` is null when
  any observed usage reported no cost; a live replay provider call that failed before a response
  retains no usage and counts as one call of unknown cost, so it also makes `cost_usd` null.
- Every application retains its manifest as one `shepherd.application.manifest.v1` record on the
  application owner path and ends with a published cut through that record. Repeating the command
  returns the retained manifest without re-executing a worker, candidate, rollout, or verifier; a
  repeat whose `protocol_id` differs from the retained one is refused. `validateApplicationManifest`
  re-derives the manifest identity and refuses a mismatch; `inspectApplicationManifest` reads
  reopened, read-only, and imported stores without mutation.

## Applications protocol vocabulary

The `applications` protocol section is introduced whole in v1 and appended, never mutated, by later
slices, following the scope precedent (`SCOPE_PROTOCOL_V1_CONTRACT` through
`SCOPE_PROTOCOL_V6_CONTRACT`): each `APPLICATIONS_PROTOCOL_V<n>_CONTRACT` spreads its predecessor,
compatibility asserts against the latest, and each version gets one paragraph in
[protocol configuration](../docs/protocol-configuration.md).

| Vocabulary | Fixed in v1 |
| --- | --- |
| `kinds` | `coding_supervisor`, `counterfactual_optimization`, `trajectory_compression`, `tree_rl` |
| `protocolSurfaces` | `prompt`, `schema`, `tool` |
| `identity` | prefixes `application:sha256:`, `application-manifest:sha256:`, `application-protocol:sha256:`, `application-artifact:sha256:`, `cro-candidate:sha256:`, `compression-fork:sha256:`, `tree-rl-rollout:sha256:`, `evaluation-report:sha256:`; append intent kind `application_command`; `sha256` |
| `limits` | `maxArtifacts`, `maxBestOfN`, `maxBranches`, `maxCandidates`, `maxDatasetItems`, `maxForkPoints`, `maxPromptBytes`, `maxReasonLength`, `maxRollouts`, `maxSeeds`, `maxToolBytes`, `maxWorkers` |
| `errors` | `APPLICATION_PROTOCOL_INVALID`, `APPLICATION_BUDGET_EXCEEDED`, `APPLICATION_EVIDENCE_INVALID`, `APPLICATION_VERIFICATION_FAILED` |

v1 also carries the `supervision` vocabulary and the manifest and supervision trace schemas; v2
appends `cro` and the candidate schema; v3 appends `compression`; v4 appends `treeRl`; v5 appends
`evaluation`; v6 and v7 extend `cro`, `compression`, and `evaluation`; v8 replaces `treeRl` with the
Algorithm 2 vocabulary (#213); v9 replaces `cro` with the Algorithm 1 vocabulary (#212); v10
appends `runtimeSupervision`, the `maxTicks` and `maxTickIntervalMilliseconds` limits, and the
runtime supervision trace schema (#211). Every other slice adds only its own sub-object and its own `traceSchemas`, `schemas`,
and `artifacts` keys. Identity prefixes and trace schema references are distinct, bounds are
positive, and schema identifiers are absolute URLs, validated at every configuration load.

Experiment definitions (prompt text, schema documents, tool declarations, budgets, seeds, dataset
items, baseline definitions, limitations) live in a repository configuration file read by tests and
the evaluation artifact writer, never in `src/`. The runtime reads only the protocol definition the
caller passes.

## Two-worker coding supervisor (Appendix E)

The supervisor is a composition over child run handles: `openChildRun`, `runChildRun`,
`observeChildRun`, `injectChildRunContext`, `handoffChildRun`, `discardChildRun`, `retryChildRun`,
`acceptChildRunResult`, `inspectChildRun`, `projectChildRunResult`, and `projectDelegationTree`.

- Protocol surfaces: an observation schema and an action schema (`schema`), an observation prompt
  and an action prompt (`prompt`), and the coordination tools (`tool`) the supervisor exposes to a
  model-serviced policy. Budgets bound provider calls and turns per worker. Seeds and the dataset
  selection name the fixture the workers edit. The versioned protocol is the manifest's
  `protocol_id`; a run under a different definition is a different application.
- Workers are child run definitions: a task value or descriptor, provenance, validated input, a
  grant and budget attenuated from the caller's root declaration, and exactly one of a program or a
  provider. The worker count is bounded by a configured minimum and `limits.maxWorkers`; "two" is a
  property of the repository experiment definition, not of the code.
- World custody is reached only through a caller-supplied **world adapter** with `fork`, `merge`,
  `discard`, and `changedPaths`. The workspace package provides the concrete adapter over
  `forkScope`, `mergeScope`, `discardScope`, `createWorldChangeset`, and the scope writer claim; the
  applications package imports no workspace code, so the trace-only path (no custody) is
  first-class.
- Observation folds the retained records of every worker's handle and child run owner paths, read
  through `observeChildRun`, into observation records validated against the closed
  `application-supervision-v1` schema; policy decisions are validated against that schema's
  closed decision grammar and the run's workers. The protocol's observation and action schema
  surfaces are model-facing documents pinned by digest only: the repository has no runtime JSON
  Schema evaluator, so they are not evaluated at runtime. Observation never writes to a worker
  owner path.
- Conflict is classified from the workers' changed paths on one bound resource: `path_overlap` when
  the canonical changed-path sets intersect, otherwise `none`. On the trace-only path the sets are
  the declared output paths of the validated worker outputs.

| Policy | Behavior | Retained evidence |
| --- | --- | --- |
| `inject` | `injectChildRunContext` retains an ordered cited injection; a worker that has not started consumes it in its composed provider request | supervision record citing the injection, the consumption record, and the observed records that motivated it |
| `handoff` | `handoffChildRun` transfers the handle to a named successor; every later command names the successor | supervision record citing the handoff record; former-supervisor commands are refused by the delegation seam |
| `discard_restart` | a live child is cancelled through durable control, `discardChildRun` retains the decision, the adapter discards the custody, a clean custody is forked from the origin, and `retryChildRun` opens a successor citing the predecessor, its decision record, and the retry cut | supervision record citing the discard decision, the discard receipt, the fresh fork receipt, and the successor handle |

- Exactly one worker is accepted: `acceptChildRunResult` retains the decision, the adapter merges
  its custody, and every other worker is discarded with its custody abandoned. A restarted worker
  starts from a clean fork, never from the discarded custody. Accept and discard are terminal per
  handle.
- Every supervision record is `shepherd.application.supervision.v1` on the application owner path,
  names the decision kind, the worker, the conflict classification, and the exact cited record and
  receipt identities. The manifest cites worker cuts, decision records, and merge and discard
  receipts as artifacts.

## Concurrent runtime supervisor (§5.1, Appendix E)

Added by #211 (11.1.0); normative behavior is in the
[runtime supervisor](../docs/runtime-supervisor.md). The round-based supervisor above stays the
handle-level supervisor; the runtime supervisor is the paper's live one.

- Two or more workers run concurrently, each a tool-use loop over its own forked custody. Each
  worker has a reserved stream owner path retaining its attempts, turns, and completions.
- The supervisor ticks at the protocol's `tickIntervalMilliseconds`, drains one live trace
  subscription over every stream, and builds one combined snapshot with the paper's per-agent
  fields (truncated feature, cumulative events, consecutive errors, modified files, last action and
  its age, trailing 25 tool-call summaries of at most 150 bytes).
- The policy returns the Appendix E `{ decisions }` batch once per tick; `none` is the default for
  unlisted agents. The batch is validated against the pinned action schema and the admission rules
  and refused as a whole on any issue. The tick record, with the exact snapshot and cursor, is
  retained before any decision takes effect.
- `inject` joins the next user message of a running attempt between turns without changing any
  earlier message; `handoff` restarts a fresh session with the guidance, on the same custody or,
  with `leader`, on a fork of the leader's custody (nested scope fork through the adapter's
  `sourceCustodyId`); `discard` restarts on a clean fork of the pre-run world.
- Settlement retains final attempts and undelivered guidance, discards abandoned custody that no
  final custody descends from, and retains the manifest; final custody is returned unmerged.
- Recovery replays retained ticks without the policy, re-derives forks in creation order, resumes
  open attempts from their retained conversations byte for byte, and re-queues undelivered
  guidance.

## Counterfactual replay optimization (Appendix F)

Algorithm 1 since 11.0.0 ([#212](https://github.com/avnionur/shepherd-typescript/issues/212),
applications protocol v9). The optimizer composes `runReplaySession`, `analyzeReplayDependencies`,
`replayReplaySession`, `analyzeReplayDivergence`, `inspectReplaySession`,
`deriveReplaySessionId`, and, for the provider-backed proposer, `runToolLoop` inside a replay
session. Normative behavior: [counterfactual optimization](../docs/counterfactual-optimization.md).

- **Examples and baselines.** The caller supplies train and dev splits of `{ id, input }` examples
  drawn from the protocol's dataset items and a per-example metric. The baseline workflow (program
  and task are factories of the example) is recorded once per example and scored before the
  `opened` record, which retains every example's split, input digest, session, and score.
- **Proposer.** N iterations (`iterations`) of at most k edits (`proposalsPerIteration`, capped by
  the remaining `maxCandidates`). The proposer is caller-supplied or
  `createToolLoopCounterfactualProposer`, which records each attempt as a tool-use loop replay
  session over the pinned proposer prompt, tools (`inspect_candidates`, `read_effect_trace`,
  `grep_effect_traces`, `propose_candidate`), and reflection schema. An edit is data (scope,
  changes, edited step, fix set, guard set, mechanism, rationale, prior, patch); the caller's edit
  applier returns the replacements. Admission (shape, pool parent, capacity, train-only disjoint
  sets, admissible steps on every parent example session, the applier, the reflection schema, and
  the reflection contract) runs before any evaluation; refusals are retried with feedback up to
  `maxProposalAttempts` and retained in the proposal record.
- **Replay target rule** (Appendix F.1, fork at the first affected event) is unchanged per example:
  a `request` edit replays from the boundary before the edited step, a `downstream` edit from the
  boundary before the first transitive dependent or the final boundary; the source is the parent's
  session on that example. (#173 fixed an earlier reading of the rule; #207 fixed the 3.0.0 rule
  that always targeted the first dependent.)
- **Divergence proof and finished-session gate** are unchanged: an unfinished, interrupted, or
  disproven branch rejects the candidate with `APPLICATION_EVIDENCE_INVALID` and stops the run.
- **Targeted gate** (F.2.5): configured fractional thresholds from the optional protocol
  `thresholds` field (`targetedMinScoreLift` 0, `targetedMaxScoreDrop` 0.02,
  `targetedImproveThreshold` 0.67) over the fix and guard results against the parent's scores;
  failures are `archived`.
- **Dev evaluation and promotion** (Algorithm 1 line 16, F.2.5): graduates are replayed on every
  dev example and promoted when the dev mean reaches `minPromotionScore` (now a fractional
  threshold, no longer an integer budget) and lies within `promoteDevEpsilon` (0.05) of the most
  recently promoted member's dev score; promoted candidates are replayed on the remaining train
  examples and join the graduate-only parent pool; others are `evaluated`.
- **Selection** (line 21): the pool member with the highest dev score, the most recently promoted
  winning ties; the baseline is `null`.
- **Records.** `opened`, one `proposal` per iteration, one `candidate` outcome per edit (every
  example result with target, affected steps, divergence summary, score, parent score, cost, and
  comparison), and the `selection`, then the manifest and the terminal cut. Inspection recomputes
  the gate and promotion from retained results and thresholds.
- **Computation reuse** (Figure 5): the manifest retains per proposer session the recorded and live
  steps of every candidate branch and their ratio.
- **Budgets:** `maxProviderCalls` covers baselines, proposer sessions, branches, and comparisons;
  candidate sessions are projected before they open and every session is measured after it ends.
- The `full_replay` baseline re-runs each example branch from step boundary zero of its source with
  the same resolved workflow; comparison is by measured `provider_calls` and
  `cache_read_input_tokens` only.
- Deviations: promoted parents are replayed on the remaining train examples eagerly (the paper
  hydrates cached outputs lazily); reuse counts replay steps, not provider or subtask cache hits;
  the reflection contract reads structured findings and hypotheses instead of Markdown logs; no live
  provider ran the tool-loop proposer.

## Trajectory compression (Appendix D)

Compression composes `runReplaySession`, `inspectReplaySession`, `rewindReplaySession`,
`replayReplaySession`, `classifyReplayCheckpoint`, and a compressor and a verifier run as delegated
children through `openChildRun` and `runChildRun` (accepted with `acceptChildRunResult` and read with
`projectChildRunResult`).

- Fork-point/hint schema: the compressor emits `{ fork_point, hint }`, validated against the
  protocol's compression schema, where `fork_point` is `{ session_id, step_index, prefix_id }` or
  null and `hint` is `{ text, cited_step_indices }` or null. The fork point must name a retained
  checkpoint or an admissible step boundary of the source session, and the prefix identity must
  equal the retained one. The runtime has no JSON Schema evaluator, so the proposal is validated
  against the closed grammar published as `$defs.proposal` of the generated compression schema,
  which the protocol's `compression` schema surface pins by digest. Task schemas admit only strings
  and closed objects, so evidence and proposals cross the delegation seam as canonical JSON text in
  configured child fields. (#174 fixed this reading.)
- Fork-step range (Appendix D.5 and D.6): `step_index` `0` is admissible and restarts from the
  initial prefix with the hint applied (the prefix identity is null there); a proposal without a
  fork point or a fork step settles `no_prune`; a step outside `[0, n - 1]` is resolved by the
  configured `applications.compression.forkStepPolicy` (`clamp` to the nearest bound, retaining
  `fork_clamp { policy, proposed_step_index, proposed_prefix_id }` on the candidate records, or
  `reject`). Applications protocol v7 adds the policy vocabulary. (#208 fixed this reading: the
  implementation required `1 <= step_index < n` and refused a missing fork step.)
- Suffix restoration: the application rewinds to the fork point with `rewindReplaySession`, then
  re-executes the suffix with `replayReplaySession` under the hint. The restore classification
  comes from `classifyReplayCheckpoint` for a checkpoint fork point and from the rewind's restore
  record otherwise; an `unavailable` constituent refuses the prune, settles `no_prune`, and retains
  the classification, constituents, and reason rather than pretending the fork point was restored.
  The rewind is the retained restoration evidence, cited by a `rewound` record before any suffix
  runs (a rewind interrupted after its restore record is admitted from that record without a second
  restore); each suffix replay restores the same target from the source session, because a rewound
  session retains no checkpoints and a program that checkpoints inside the prefix could not be
  replayed from it. (#174 fixed this reading of "then re-executes the suffix".)
- `no_prune`: a missing fork step leaves the source suffix untouched and retains the outcome. The
  original is the result.
- Verifier gate: the verifier receives the original and compressed inspections, the fork point, and
  the hint and returns `{ verdict, score, reason }`. `accepted` makes the compressed session the
  result; `rejected` yields `restored`, re-runs the original suffix, and retains the reason. Only a
  compressed session that finished with strictly fewer steps than the source is admissible; an
  inadmissible one (including a compressed session interrupted by a dead writer) is restored with a
  configured reason without consulting the verifier. A verifier child that terminally fails is a
  verification failure, never an acceptance; a delegation-seam refusal (another supervisor, a child
  left running) writes no record. Cited hint steps must name retained source steps.
- Bounded best-of-N control: at most `limits.maxBestOfN` seeded plain reruns without fork-point
  compression are run for comparison and retained as candidates; each is a root session of the
  unguided workflow under its seed's provider, verified like the compression candidate (only a
  control session that finished is verified), and the best control is the accepted rerun with the fewest steps. The `no_compression` baseline keeps the
  whole trajectory.
- Every candidate and the terminal outcome is a `shepherd.application.compression.v1` record:
  candidate, seed, outcome (`pruned`, `no_prune`, `restored`), fork point, hint digest, restore
  classification and constituents, verdict, score, reason, compressed session identity, and cost.
  The aggregate artifact reports the measured step-count ratio only.

## Tree-RL adapter (§5.3)

The adapter composes `inspectReplaySession`, `replayReplaySession`, and `analyzeReplayDivergence`
into paper Appendix F.6 Algorithm 2 up to the policy update. It produces a training batch; it
trains nothing. #213 (10.0.0, applications protocol v8) replaced the earlier single-source,
trace-selected, per-fork-point reading with the rules below.

- Batch and roots (Algorithm 2 part A): the caller passes B prompts, each with its deterministic
  program and exactly the protocol's `groupSize` G finished root sessions it recorded. The adapter
  grades each root with the caller's reward (member `root`); a throwing or non-finite reward retains
  the root grading as `failed`, and the root is still forked.
- Fork selection (part B, F.7): a fork-selection interface returns
  `{ branch_turn, tool_call, reason }` per root. A turn is one provider step; the proposed turn is
  clamped into the configured `[1, T - 2]` (`forkTurn`; a root of fewer than three turns forks at
  turn 1) and, for a world- or process-bound root, moved to the nearest restorable turn. The
  provider-backed meta-agent selector reads the protocol's `fork_selector` prompt and
  `fork_proposal` schema surfaces and receives the numbered turns and the final reward; the
  deterministic dependency selector (most transitive dependents) remains available, and
  `selectTreeRlForkPoints` still lists trace-selected candidates. Each root's grading and fork
  decision is one retained `root` record.
- Branches: per root, K = `branches` rollouts replay the root from the boundary before the fork turn
  declaring the `provider` change, branch `k` under seed `k` and its own static cassette from the
  caller's factory. The proposed tool call seeds branch 0: its plan is `seeded` and the factory
  receives the call to render as the branch's first live action. Root gradings and branch rollouts
  run with configurable concurrency; records append in prompt, root, branch order, so retained
  output is independent of concurrency. Failed rollouts (not finished, diverged, interrupted,
  reward failed) are retained and excluded from every mean.
- Advantages (part C): `A_inter = R_root - mean(prompt's completed roots)` for prefix actions
  `j < t*`; `A_intra(k) = R_k - mean(tree's completed members, root included)` for suffix actions
  `j >= t*`. Under the default `group_std` normalization each is divided by the group's standard
  deviation (configured `sample` estimator) plus `epsilon`; `none` keeps the raw values. The
  paper names neither estimator nor epsilon; the configured values are this repository's choice.
- Training batch: `jsonl_v2`, one canonical line per graded member with its per-action attribution
  (`prefix` actions carry the inter-root advantage, `suffix` actions the member's intra-tree
  advantage), and a digest over the UTF-8 text. The digest is identical across stores, concurrency,
  and archive import. The `flat_grpo` baseline is the roots-only batch with the inter-root advantage
  on every action. `exportTreeRlBatchToTrainer` is the optional trainer-export adapter seam; no
  trainer ships.
- Protocol budget `maxProviderCalls` bounds live branch provider calls: the whole-run projection
  (each root assumed to fork at its earliest admissible turn) is checked before any record, and each
  new rollout session is checked against the measured total plus in-flight projections before it
  opens. `maxRollouts` bounds B·G·K.

## Evaluation, baselines, and reporting

- The evaluation runner executes every configured application and its baseline offline with the
  caller's static providers and configured seeds and folds one report. Metrics are measured values
  only: `cost_usd`, `provider_calls`, `input_tokens`, `output_tokens`, `steps`, `success`. No
  derived or extrapolated value enters the report. Each metric is measured on one application side
  and one baseline side per kind: the supervisor manifest costs (whose provider calls count worker
  starts) against one plain child run of the named worker; the candidate branch sessions against the
  full-replay sessions; the compression result session against the source session; and every
  Tree-RL root and branch rollout against the roots alone (#213). Work outside those sides stays in each run's
  manifest costs, which the report carries verbatim. (#176 fixed this reading: the contract named the
  metrics but not which evidence each side measures.)
- Baseline kinds: `no_supervision` (one worker, no policy intervention), `full_replay` (whole
  workflow re-run per candidate), `no_compression` (whole trajectory kept), `flat_grpo` (the G
  graded roots per prompt; replaced `single_rollout` in #213). Baselines resolve from the caller's evaluation definition; none is coded.
  An unknown baseline, or one not configured for the experiment's application kind, is refused
  before any record. `no_supervision` is configured in the v5 `evaluation` sub-object; the others
  keep their v2–v4 vocabularies.
- Executable parts (programs, providers, policies, evaluators, verifiers, rewards) cannot be data,
  so the caller passes a binding factory called once per experiment before anything runs; the
  definition fixes every command identity, which the Tree-RL batch digest depends on.
- The report (`evaluation-report:sha256:`) carries the runs (kind, manifest, protocol, seeds,
  dataset, costs, metrics), the baselines (with the session or handle identities they were measured
  from), the comparisons (application value, baseline value, delta per metric; the delta is null
  unless both values are numbers), the rescue counts (experiments whose baseline failed while the
  application passed; Appendix D, Table 12; report version 2 since applications protocol v7, #208),
  and the configured limitations. Determinism rule: no wall clock,
  host, node version, or duration appears in any digest-bearing JSON, so repeated runs on any
  supported host produce an identical report digest. Host and platform metadata appear only in the
  human-readable generated page, in a trailing section after a marker that the check excludes, so
  the check is host-independent. The report is a returned and generated artifact, not a retained
  record: v5 adds a schema but no trace schema reference, and the evaluation writes no record of its
  own.
- A stable repository script generates and checks the report and its page the way the protocol
  generator does; drift fails the check (`pnpm evaluate:applications`, `pnpm check:evaluation`, in
  `pnpm verify`).
- Limitations are published with the report: offline static-provider cassettes, synthetic and small
  fixtures, no live provider, no wall-clock or throughput measurement, baselines that are this
  repository's constructions, single-host evidence, and no reproduction of upstream headline
  results. The repository report also states that `flat_grpo` is the tree run's own roots (a subset
  of its cost, not the paper's matched budget), which side each metric measures, and that the
  Tree-RL adapter trains nothing.

## Failure and recovery

| Failure | Required behavior |
| --- | --- |
| Supervisor crashes between a world fork and the child's durable start | Rerun with the same command reads the retained fork receipt and handle; the child is opened or started without a second fork |
| Supervisor crashes after a child's durable start | The child is classified from its own records, `running` and fail-closed until the documented cancellation path settles it; `discard_restart` then forks clean custody |
| Crash after a candidate or rollout branch, before its application record | The branch session is terminal and idempotent; the rerun retains the record from the existing branch without replaying |
| Crash inside an optimizer candidate branch or full-replay session, before its terminal record | Once the lease expires the session is `interrupted`; the rerun retains the candidate as `rejected` with `APPLICATION_EVIDENCE_INVALID` and stops; while the lease is live the rerun raises `ReplaySessionInterruptedError` without a record |
| Crash inside the optimizer baseline session | No application record; every rerun of the command raises `ReplaySessionInterruptedError`; recovery is a new command identity, the interrupted session stays inspectable and rewindable |
| Crash at an optimizer application append (opened, proposed, outcome, promotion, manifest) | Rerun converges from retained sessions and records without extra provider calls, with one promotion and identical inspection |
| Crash after the rewind restore record, before the suffix replay | Rerun converges through the retained rewind receipt without a second restore. A rewind left non-terminal after its replay restore record is admitted from that record once its lease expires (still one restore); while the lease is live the rerun raises `ReplaySessionInterruptedError` without a record |
| Crash inside a compression suffix, restoration, or control session, before its terminal record | While the lease is live the rerun raises `ReplaySessionInterruptedError` without a record. Once it expires, an interrupted compressed session is not admissible and the candidate settles `restored` with the configured reason; an interrupted restoration or control session is retained as `rejected` with `APPLICATION_EVIDENCE_INVALID` and the run stops |
| An optimizer branch or full-replay session, or a compression restoration or control session, ended `failed` or `cancelled` | The candidate is retained as `rejected` with `APPLICATION_EVIDENCE_INVALID` before any evaluator or verifier is consulted, nothing is promoted or pruned from it, and the run stops; a rerun re-raises the retained failure without a record |
| Crash inside a compressor or verifier child | The child stays `running` and every rerun raises `DelegationStatusError` without a record until the documented cancellation path settles it; the settled (cancelled) child is then a terminal child failure and its candidate is retained as `rejected` |
| Verifier or evaluator unavailable or throws | `APPLICATION_VERIFICATION_FAILED`; the candidate is retained as rejected, nothing is promoted or pruned |
| Tree-RL reward throws, a rollout session did not finish or diverged, or a rollout session was interrupted and its lease expired | A root whose reward failed is retained as a `failed` grading and still forked; the rollout is retained as `failed` with the configured reason (`APPLICATION_VERIFICATION_FAILED` for the reward, `APPLICATION_EVIDENCE_INVALID` otherwise), excluded from every mean, and the run completes; while the lease is live the rerun raises `ReplaySessionInterruptedError` without a record |
| Budget exceeded | `APPLICATION_BUDGET_EXCEEDED` before the offending call; retained evidence up to that point stays. The optimizer baseline and the compression source are measured and refused before any application record; a candidate, suffix, restoration, or control session whose measured calls overrun its projection is refused right after it, the session retained and the candidate left unsettled |
| Protocol definition malformed or digest differs from the retained manifest | `APPLICATION_PROTOCOL_INVALID`; no record written |
| Retained application evidence inconsistent or unexplained divergence | `APPLICATION_EVIDENCE_INVALID`; the affected candidate is never promoted |
| Command under a moved head or from a former supervisor | Refused by the delegation seam; no record written |
| Supervisor crashes after applying a decision, before its supervision record | Rerun rebuilds the decision from the retained round-derived delegation commands without consulting the policy; observations are re-derived at recovery |
| Runtime supervisor crashes after retaining a tick, before or while applying it | Rerun completes the tick's handoffs and discards idempotently (retained forks replay), never consults the policy for it, resumes open attempts from their retained conversations, and re-queues its undelivered injects |
| Runtime supervisor crashes or fails while workers run | Open attempts carry no completion; the rerun resumes each with a byte-identical request; a turn in flight at the crash is re-sent and its tool effects may already have reached custody |
| Runtime supervisor policy output fails the Appendix E schema or admission | The batch is retained as refused with its issues; nothing is applied and the run continues |
| Imported store | Manifests and applications are inspection sources; mutation requires a store that retained the manifest |

## Non-claims

- No live provider adapter; every application runs against caller-supplied static providers or
  programs.
- No reproduction of upstream headline numbers. Every reported figure is this repository's offline
  measurement on synthetic or small fixtures with configured seeds.
- CRO candidate edits are limited to the declarable change dimensions (`task`, `provider`,
  `handlers`) at a step boundary; arbitrary workflow rewrites do not replay a recorded prefix and
  are out of scope.
- The Tree-RL adapter emits a training batch; it is not a trainer and claims no learning result.
- Trajectory compression prunes and restores a suffix of a recorded trajectory; it does not compress
  model context or provider state.
- The round-based coding supervisor's handoff transfers supervisor ownership of the handle only; the
  runtime supervisor's handoff restarts a session and may re-root it on the leader's custody, but no
  live process or provider session moves.
- No new substrate, storage schema, or record kind outside the application trace schemas; every
  application is a composition of existing public delegation, replay, scope, and provider seams.
