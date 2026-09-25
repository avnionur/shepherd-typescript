# Counterfactual workflow optimization

Status: normative from 11.0.0 (issue [#212](https://github.com/avnionur/shepherd-typescript/issues/212),
epic [#202](https://github.com/avnionur/shepherd-typescript/issues/202); paper §5.2, Appendix F.1
Algorithm 1, F.2.3-F.2.5, Figure 5).

Implementation:
[`src/applications/counterfactual-optimizer.ts`](../src/applications/counterfactual-optimizer.ts),
[`src/applications/counterfactual-gate.ts`](../src/applications/counterfactual-gate.ts),
[`src/applications/counterfactual-proposer.ts`](../src/applications/counterfactual-proposer.ts),
[`src/applications/counterfactual-records.ts`](../src/applications/counterfactual-records.ts), and
[`src/applications/counterfactual-types.ts`](../src/applications/counterfactual-types.ts). Public
entry points: [`src/facades/applications.ts`](../src/facades/applications.ts) (`./applications`:
`runCounterfactualOptimization`, `inspectCounterfactualOptimization`,
`createToolLoopCounterfactualProposer`), with root exports from [`src/index.ts`](../src/index.ts).
Configuration: `applications.cro` and `applications.limits` in
[`protocol.config.json`](../protocol.config.json) (applications protocol v9,
`APPLICATIONS_PROTOCOL_V9_CONTRACT`); the repository's Appendix F protocol is the `counterfactual`
definition in [`config/research-applications.config.json`](../config/research-applications.config.json).
Generated schema:
[`application-cro-candidate-v1.schema.json`](../spec/schemas/application-cro-candidate-v1.schema.json).
Tests: [`counterfactual-optimizer.test.ts`](../test/applications/counterfactual-optimizer.test.ts),
[`counterfactual-proposer.test.ts`](../test/applications/counterfactual-proposer.test.ts),
[`counterfactual-failures.test.ts`](../test/applications/counterfactual-failures.test.ts),
[`counterfactual-lineage.test.ts`](../test/applications/counterfactual-lineage.test.ts),
[`counterfactual-recovery.test.ts`](../test/applications/counterfactual-recovery.test.ts), and
[`counterfactual-records.test.ts`](../test/applications/counterfactual-records.test.ts). Manifest
rules: [application manifests](./application-manifests.md). Design constraints:
[research applications contract](../.plan/research-applications-contract.md).

## Composition

The optimizer adds no substrate. It records the baseline workflow once per example with
[`runReplaySession`](./replay-sessions.md) and evaluates each candidate edit on per-example
branches opened with [`replayReplaySession`](./rewind-and-replay.md), scoped by
`analyzeReplayDependencies`, proven by `analyzeReplayDivergence`, and measured from
`inspectReplaySession`. The provider-backed proposer is a [tool-use loop](./tool-use-loop.md)
recorded as a replay session. Every session, record, and append intent identity is derived from the
application identity, the step, the iteration and attempt, the candidate identity, and the example,
so a repeated command converges on retained evidence.

## Protocol

`runCounterfactualOptimization` requires a protocol of kind `counterfactual_optimization` with:

- a `prompt` and at least one `tool` surface with the configured `proposer` role, a `schema` surface
  with the `reflection` role, and a `schema` surface with the `handoff` role;
- the integer budgets named by `applications.cro.budgetKeys`:

  | Key | Meaning | Bound |
  | --- | --- | --- |
  | `iterations` | Proposer iterations N of Algorithm 1 | positive, at most `limits.maxRounds` |
  | `proposalsPerIteration` | Edits k one proposal may carry | positive, at most `limits.maxCandidates` |
  | `maxCandidates` | Candidates over the whole run | positive, at most `limits.maxCandidates` |
  | `maxProposalAttempts` | Proposer attempts per iteration, including repairs | positive, at most `limits.maxRounds` |
  | `maxProviderCalls` | Live provider calls across every session the run opens | non-negative |
  | `reflectionMinMechanisms` | Verbalized-sampling floor of the reflection contract | non-negative |

- the finite `thresholds` named by `applications.cro.thresholdKeys`. `thresholds` is an optional
  protocol field (a definition without it keeps its protocol identity); it holds numbers, so
  fractional thresholds are expressible:

  | Key | Meaning | Repository value (paper default) |
  | --- | --- | --- |
  | `targetedMinScoreLift` | Minimum mean score lift over the parent on the fix and guard union | `0` |
  | `targetedMaxScoreDrop` | Largest drop any guard example may show against the parent | `0.02` |
  | `targetedImproveThreshold` | Fraction of fix examples scoring strictly above the parent | `0.67` |
  | `promoteDevEpsilon` | Dev distance from the current promoted member within which a graduate is promoted | `0.05` |
  | `minPromotionScore` | Minimum dev score of a promoted candidate | `0.5` (repository choice) |
  | `reflectionDuplicateSimilarity` | Jaccard token similarity of a near-duplicate mechanism | `0.85` |
  | `reflectionAudaciousPrior` | Prior at least one selected edit must fall strictly below | `0.2` |

The thresholds are pinned by the protocol identity and retained verbatim in the opened record and
the manifest. A missing surface, budget, or threshold, or a budget outside its bound, is
`ApplicationProtocolError` before any record.

## Dataset and metric

The caller supplies `dataset: { train, dev }`, two non-empty lists of `{ id, input }` examples with
distinct identities drawn from the protocol's `dataset.items` and canonical inputs, and a
`metric({ candidate, example, split, session })` returning a finite score, higher is better. A
metric that throws or returns a non-finite score is a verification failure.

The baseline workflow W0 is `{ program(example), programId, provider?, handlers?, task?(example) }`:
the program and the task are factories of the example, so one workflow runs every example.

## Algorithm 1

1. **Baseline (line 4).** W0 runs once per train then dev example through `runReplaySession`; every
   baseline session must finish (otherwise `ApplicationEvidenceError` before any record), and its
   metric score is retained. The measured calls are checked against `maxProviderCalls` before the
   `opened` record.
2. **Parent pool (line 5).** The pool starts as the baseline, whose dev score is the mean of its dev
   example scores.
3. **Proposals (lines 6-8).** For each iteration `t` in `0..N-1`, the iteration's capacity is
   `min(proposalsPerIteration, maxCandidates - candidates so far)`; a zero capacity ends the loop.
   The proposer receives the record-derived inspection, the pool, the capacity, the iteration, the
   attempt, earlier refusal reasons (`feedback`), and a reserved session command identity, and
   returns `{ parent, edits, reflection }`. Admission (below) runs before any evaluation.
4. **Counterfactual replay (lines 10-14).** Each edit `c = p ⊕ Δ` is materialized by the caller's
   `applyEdit({ edit, parent, protocol })`, which returns exactly the replacements of the declared
   change dimensions (`task`, `provider`, `handlers`) and optionally a program. For each fix example
   then each guard example, the parent's session on that example is forked at the first affected
   event ([replay target rule](#replay-target-rule)) and the suffix runs under the candidate. The
   branch must be proven ([divergence proof](#divergence-proof)) and is scored by the metric; the
   parent's score on the example is retained next to it.
5. **Targeted gate (line 15, F.2.5).** Over the fix and guard results: the candidate's mean score
   minus the parent's must be at least `targetedMinScoreLift`, no guard example may drop by more
   than `targetedMaxScoreDrop`, and at least `targetedImproveThreshold` of the fix examples must
   score strictly above the parent. Scores are compared in IEEE-754 double arithmetic, so
   `2/3 < 0.67` fails the repository threshold. A failing candidate is `archived` without any dev
   replay.
6. **Dev evaluation and promotion (lines 16-17, F.2.5).** A graduate is replayed counterfactually on
   every dev example and its dev score is the mean. It is `promoted` when
   `dev >= minPromotionScore` and `dev + promoteDevEpsilon >= reference`, where `reference` is the
   dev score of the most recently promoted pool member (initially the baseline); otherwise it is
   `evaluated`. A promoted candidate is then replayed counterfactually on the remaining train
   examples, so every pool member retains a session on every example for children to fork, and it
   joins the parent pool. Archived, evaluated, and rejected candidates never become parents
   (graduate-only pool).
7. **Selection (line 21).** After the iterations the pool member with the highest dev score is
   selected; on a tie the most recently promoted member wins. The baseline is selected as `null`.

## Proposers

A `CounterfactualProposer` is any function of `CounterfactualProposerContext`; a caller-supplied
proposer returns proposals directly (the evaluation fixture replays scripted iterations).

`createToolLoopCounterfactualProposer({ model, maxTurns? })` is the provider-backed proposer. Each
attempt runs one bounded [`runToolLoop`](./tool-use-loop.md) inside a replay session under the
attempt's reserved command identity and the configured program identity
(`applications.cro.proposer.programId`), using `createReplayToolLoopBindings` and
`createToolTurnProvider(model)`, so every turn is a provider step and every tool call an effect step.
The system prompt is the protocol's `proposer` prompt surfaces, the tools are its `proposer` tool
surfaces, the output schema is its first `reflection` schema surface, and the first user message is
the attempt brief (iteration, attempt, capacity, pool, train and dev example identities, feedback).
Each tool surface's content is `{ name, description, inputSchema }` and its name must be one of the
configured operations (`applications.cro.proposer.operations`); the effect kind is
`effectKindPrefix` plus the name:

| Operation | Repository tool | Result |
| --- | --- | --- |
| `inspectCandidates` | `inspect_candidates` | The pool, baseline scores, and every candidate's plan, status, per-example scores, gate, dev score, and cost |
| `readTrace` | `read_effect_trace` | The terminal status and at most `limits.maxTraceSteps` step summaries (index, kind, source, and the retained provider request, response, and failure or effect intent and outcome) of one candidate's (null: the baseline's) session on one example |
| `grepTraces` | `grep_effect_traces` | Up to `limits.maxGrepMatches` regex matches (pattern at most `limits.maxPatternLength`) with excerpts of at most `limits.maxExcerptLength` over one candidate's example step summaries |
| `proposeCandidate` | `propose_candidate` | Accepts one edit; accepted edits form the proposal in call order |

The final output is the reflection (JSON text is parsed), and its configured `parent` field names
the parent. An attempt whose session does not finish or whose loop reaches its turn limit throws
`ApplicationVerificationError`, which the optimizer records as a refusal and retries under the next
attempt identity. The session's measured provider calls count against `maxProviderCalls` and the
manifest costs, and its identity is retained in the proposal record. A repeat serves the retained
session without calling the model. No live provider has run this proposer in this repository; its
tests script the model.

## Admission and the reflection contract

Before any evaluation, a proposal is refused with a reason when: it is malformed; its parent is not
a pool member name (or null); it carries no edit or more than the capacity; an edit name is not
unique in the run; a fix or guard example is not a train example, the fix set is empty or
overlaps the guard set; a prior lies outside `[0, 1]`; the reflection's `parent` field disagrees
with the proposal; the reflection fails any `reflection` schema surface; the reflection contract
fails; an edit's step is outside, or (for a `request` edit) of a kind its changes cannot alter in,
any of the parent's example sessions; or `applyEdit` throws or does not return exactly the declared
replacements. Refusal reasons are fed back to the next attempt; after `maxProposalAttempts` refused
attempts the iteration's proposal record is retained with a verification failure and
`ApplicationVerificationError` stops the run.

The reflection contract (F.2.5) reads the configured field names
(`applications.cro.reflection.fields`):

1. Once any archived or evaluated candidate exists, the `findings` must cite at least one retained
   candidate name.
2. An edit whose `mechanism` has token similarity (case-folded letter and digit tokens, Jaccard) at
   least `reflectionDuplicateSimilarity` with an archived or evaluated candidate's mechanism needs
   findings that contain that candidate's name and the configured `differsByPhrase` (`differs by:`);
   near-duplicates of promoted mechanisms pass.
3. The `hypotheses` must enumerate at least `reflectionMinMechanisms` entries with a `mechanism` and a
   finite `prior`, and at least one edit's prior must be strictly below `reflectionAudaciousPrior`.

## Replay target rule

A branch forks the parent's session on the example at the first event the edit affects (Appendix
F.1). The affected steps are the transitive `dependents` of the edited step from
`analyzeReplayDependencies`, and the target depends on the declared `scope`
(`applications.cro.editScopes`):

- `request`: the step boundary immediately before the edited step. The edited step and every later
  step run live; an edit of step 0 replays from boundary zero with a `null` target `prefix_id`.
- `downstream`: the step boundary immediately before the earliest affected step, or the source's
  final boundary (zero live steps) when nothing depends on the edited step.

`replayReplaySession` replays from the target declaring exactly the candidate's change dimensions
and `sourceDisposition: "retain"`: every candidate is scored against the same retained parent, so a
candidate replay never compensates the parent's compensable suffix effects
([source disposition](./compensation.md#source-disposition),
[`exploratory-branch-compensation.test.ts`](../test/applications/exploratory-branch-compensation.test.ts)).
The live suffix runs with the candidate's program, provider, and handler stack where it supplies
them, else those of the nearest ancestor in its parent chain that did, else the baseline's; an
undeclared task resolves through the source's branch ancestry. Every step before the target is
served from the source journal.

## Divergence proof

A branch, or under `full_replay` its comparison session, that ended with any terminal status other
than `finished`, or that was interrupted by a dead writer whose lease expired, rejects the candidate
with `APPLICATION_EVIDENCE_INVALID`. `analyzeReplayDivergence` over the source and the branch must
report no step before the target as diverged and no `unexplained` divergence; otherwise the
candidate is rejected with `APPLICATION_EVIDENCE_INVALID` and the reason names the branch session,
first divergence, and unexplained indices. A rejected candidate is never scored or promoted, the run
stops with the matching error, and a rerun re-raises it without a record.

## Retained records

Every record is `shepherd.application.cro_candidate.v1` on the application owner path and conforms
to the closed [`application-cro-candidate-v1`](../spec/schemas/application-cro-candidate-v1.schema.json)
schema:

- `opened`: command, protocol identity, comparison baselines, the protocol `budgets` and
  `thresholds`, and every example `{ example_id, split, input_digest, session_id, score }` in train
  then dev order;
- `proposal` per iteration: `iteration`, `attempts`, `refusals`, `proposer_session_ids`,
  `parent_candidate_id`, the accepted `reflection`, and the candidate plans (identity, parent,
  iteration, edited step, scope, changes, fix and guard sets, mechanism, rationale, prior, patch),
  or an empty plan list with the verification `failure`;
- `candidate` per edit: the plan, `status`, `targeted` (fix then guard results), `gate`, `dev`,
  `dev_score`, `promotion_reference`, `train` (promoted only), summed `cost`, and `failure`. Each
  example result retains its role, branch `session_id`, `target`, `affected_steps`, `divergence`
  summary, `score`, `parent_score`, measured `cost`, and `baseline` comparison. A rejected
  candidate retains the completed results and the measured cost of the failing branch;
- `selection`: the selected candidate (or `null`), its dev score, and the promoted pool.

The record codec re-validates every body when read. `inspectCounterfactualOptimization` also
recomputes the gate verdict and the promotion decision from the retained results and thresholds,
checks every target against the parent's session and score on that example, the derived branch,
comparison, baseline, and proposer session identities, the pool at every proposal, the capacity,
the selection, the manifest, and the terminal cut. It embeds no live session state, so it is
identical on the writing store, a reopened or read-only store, and an imported archive.

## Manifest, handoff, and computation reuse

The manifest is retained last with the terminal cut. Its artifacts are the opened record
(`baseline`), each proposal (`proposal`), each candidate outcome (`candidate`), and the selection
(`selection`); each record cites its sessions as causal parents. Costs are measured from the live
provider steps of every baseline, proposer, branch, and comparison session.

The manifest carries the protocol `thresholds` and `computation_reuse`: one entry per proposer
session (iteration) with the `recorded_steps` served from source journals and the `live_steps`
executed over every candidate branch session of that iteration, and
`reuse_ratio = recorded / (recorded + live)` (null when both are zero). This is the step-level
analogue of the paper's per-session subtask cache reuse (Figure 5); comparison sessions are
excluded, and provider prompt-cache reads are reported separately in the costs.

The handoff manifest `{ candidates: [{ candidate_id, parent_candidate_id, status }],
selected_candidate_id }` is derived from the records and validated against every `handoff` schema
surface before the manifest is retained; a refusal is `ApplicationProtocolError` and the manifest is
not retained.

## Full-replay baseline

With `baselines: ["full_replay"]`, every example branch is also replayed from step boundary zero of
its source with the same resolved workflow, so every step runs live; its measured `provider_calls`
and `cache_read_input_tokens` are retained in the example result's `baseline`.

## Budgets

The baselines and proposer sessions are measured; candidate sessions are projected as the source's
provider steps at or after the target (all of them for a full replay) and refused with
`ApplicationBudgetError` before they open when the measured total plus the projection exceeds
`maxProviderCalls`. After every session the measured total is checked again. A proposer session is
measured after its proposal is retained. Retained evidence up to a refusal stays, and every rerun
refuses the same way without replaying.

## Repeats, crashes, and inspection

- Repeating a completed command returns the retained manifest without proposing, scoring, or
  replaying. A repeat under another protocol is `ApplicationProtocolError`; a repeat with another
  dataset (identities, splits, or input digests) or baselines is `ApplicationEvidenceError`.
- A crash at any application append converges on rerun: terminal sessions are served from their
  retained records, retained proposals are reused without calling the proposer, and the metric
  re-scores only branches whose outcome was not retained.
- A process death inside a candidate session is `ReplaySessionInterruptedError` while its lease is
  live and a rejected candidate with the interruption as cause once it expired; a death inside a
  baseline session leaves no application record and every rerun raises
  `ReplaySessionInterruptedError`; recovery is a new command identity.
- A moved application head is `ApplicationEvidenceError`.

## Limits and deviations from the paper

- Edits are declared data (change dimensions at a step boundary plus a caller-interpreted `patch`);
  the proposer cannot author program code, and the edit scope is declared, not inferred.
- The paper hydrates a promoted parent's per-task outputs lazily through its typed cache; this
  repository replays a promoted candidate on the remaining train examples eagerly so every pool
  member retains a session per example.
- The paper applies the epsilon rule for promotion and frontier selection by raw dev score; this
  repository additionally requires `minPromotionScore` for promotion.
- Computation reuse counts replay steps, not provider prompt-cache hits or subtask cache entries.
- The reflection contract applies to structured findings and hypotheses, not the paper's Markdown
  hypothesis logs; archived and evaluated (graduated but not promoted) candidates both count as
  archived rows.
- The baseline must bind no worlds or processes; providers must serve repeated sessions; dependency
  scoping relies on the program's declared `dependsOn`.
- No live provider ran the tool-loop proposer, and no figure here reproduces the paper's results.
