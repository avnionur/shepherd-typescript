# Counterfactual workflow optimization

Implementation:
[`src/applications/counterfactual-optimizer.ts`](../src/applications/counterfactual-optimizer.ts),
[`src/applications/counterfactual-records.ts`](../src/applications/counterfactual-records.ts), and
[`src/applications/counterfactual-types.ts`](../src/applications/counterfactual-types.ts). Public
entry point: [`src/facades/applications.ts`](../src/facades/applications.ts) (`./applications`:
`runCounterfactualOptimization`, `inspectCounterfactualOptimization`), with root exports from
[`src/index.ts`](../src/index.ts). Configuration: `applications.cro` and `applications.limits` in
[`protocol.config.json`](../protocol.config.json) (applications protocol v2); the repository's
Appendix F protocol is the `counterfactual` definition in
[`config/research-applications.config.json`](../config/research-applications.config.json).
Generated schema:
[`application-cro-candidate-v1.schema.json`](../spec/schemas/application-cro-candidate-v1.schema.json).
Tests: [`counterfactual-optimizer.test.ts`](../test/applications/counterfactual-optimizer.test.ts),
[`counterfactual-failures.test.ts`](../test/applications/counterfactual-failures.test.ts),
[`counterfactual-lineage.test.ts`](../test/applications/counterfactual-lineage.test.ts),
[`counterfactual-recovery.test.ts`](../test/applications/counterfactual-recovery.test.ts), and
[`counterfactual-records.test.ts`](../test/applications/counterfactual-records.test.ts). Manifest
rules: [application manifests](./application-manifests.md). Design constraints:
[research applications contract](../.plan/research-applications-contract.md).

## Composition

The optimizer adds no substrate. It records a baseline workflow with
[`runReplaySession`](./replay-sessions.md) and evaluates each candidate edit on a branch opened with
[`replayReplaySession`](./rewind-and-replay.md), scoped by `analyzeReplayDependencies`, proven by
`analyzeReplayDivergence`, and measured from `inspectReplaySession`. Every session, record, and
append intent identity is derived from the application identity, the step, and the candidate
identity, so a repeated command converges on retained evidence.

## Protocol

`runCounterfactualOptimization` requires a protocol of kind `counterfactual_optimization` with:

- a `prompt` and at least one `tool` surface with the configured `proposer` role (the Appendix F
  proposer prompt and tools), a `schema` surface with the `reflection` role (the scratchpad), and a
  `schema` surface with the `handoff` role (the handoff manifest);
- the budgets named by `applications.cro.budgetKeys`: `maxCandidates` (positive, at most
  `limits.maxCandidates`) bounds the declared candidate set, `maxProviderCalls` bounds live
  provider calls across every session the run opens, including the baseline, and
  `minPromotionScore` is the gate threshold a promoted candidate's score must reach. Like every
  protocol budget, `minPromotionScore` is a non-negative integer; it is compared with the
  evaluator's finite score (`score >= minPromotionScore`), so a fractional score can be promoted but
  the threshold itself is whole.

Surfaces are pinned into the manifest by digest. The retained candidate records are the machine
form of the handoff manifest; the runtime does not evaluate the caller's schema documents.

## Candidates

The caller supplies the baseline workflow `{ program, programId, provider?, handlers?, task? }` and
an ordered list of candidates `{ name, stepIndex, changes, parent?, program?, provider?, handlers?,
task? }`:

- `changes` is a non-empty, distinct subset of `REPLAY_CHANGE_DIMENSIONS` (`task`, `provider`,
  `handlers`), and exactly the replacements for the declared dimensions are supplied.
- `parent` names an earlier candidate; the candidate then forks the parent's branch instead of the
  baseline. The retained `parent_candidate_id` chain is the candidate lineage.
- `program`, `provider`, and `handlers` not supplied by a candidate resolve from the nearest
  ancestor in its `parent` chain that supplied them, else from the baseline, so a child keeps every
  ancestor edit it does not itself replace. The program must re-issue the recorded prefix exactly.
- The candidate identity (`cro-candidate:sha256:`) is derived from the application, name, parent,
  edited step, and changes.

The whole plan is validated before anything is written: an edit kind outside the change dimensions
is `ApplicationProtocolError`, a candidate set larger than `maxCandidates` is
`ApplicationBudgetError`, and any other malformed candidate is `TypeError`. No application record,
replay session, or provider call exists after a refusal.

After the baseline session is recorded and before the `opened` record, the baseline session must
have finished: one that ended `failed` or `cancelled` is `ApplicationEvidenceError` and no
application record exists. Then every candidate's edited step
index, root or child, is checked against the baseline's step count: an index outside the baseline is
`ApplicationProtocolError`, and no application record exists (the baseline session stays retained
and is reused by a corrected rerun of the same command). A child edits a step of its parent's
branch, which normally has the baseline's step count; when a program's control flow makes the
parent branch shorter than the child's edited step, the child is refused with
`ApplicationEvidenceError` before its `proposed` record, and every rerun refuses the same way.

## Affected-suffix rule

For each candidate in order, with the source being the parent's branch or the baseline:

1. The affected steps are the transitive `dependents` of the edited step from
   `analyzeReplayDependencies`.
2. The branch target is the step boundary immediately before the earliest affected step. When the
   edited step has no dependent, the target is the source's final boundary.
3. `replayReplaySession` replays from the target declaring exactly the candidate's change
   dimensions. The live suffix runs with the resolved program, provider, and handler stack: the
   candidate's replacement for a declared dimension, otherwise the replacement of the nearest
   ancestor that declared it, otherwise the baseline's. An undeclared task is the task the source
   had in force at each step, which the replay substrate resolves through the source's branch
   ancestry, so an ancestor's replacement task stays in force. Every step before the target,
   including the edited step and any independent step before the first dependent, is served from
   the source journal without a provider or handler invocation.

A candidate whose edited step has no dependent replays zero live steps. The replay substrate runs
every step from the target onward live, so a later step independent of the edit is replayed when it
follows the first affected step; the divergence proof below classifies it.

## Divergence proof and evaluation gate

A branch session, or under the `full_replay` baseline its comparison session, that ended with any
terminal status other than `finished` (for example `failed` because a provider threw) proves nothing
about the edit. Before the divergence proof and before the evaluator is consulted, the candidate is
retained as `rejected` with failure code `APPLICATION_EVIDENCE_INVALID`, its measured cost, and no
`evaluation` or `baseline` comparison; the run stops, nothing is promoted, and
`ApplicationEvidenceError` is raised. A rerun re-raises the retained failure without a record.

`analyzeReplayDivergence` over the source and the branch must report no step before the target as
diverged and no `unexplained` divergence. Otherwise the candidate is retained as `rejected` with
failure code `APPLICATION_EVIDENCE_INVALID`, the run stops, and `ApplicationEvidenceError` is
raised; the candidate is never evaluated or promoted.

A proven candidate is passed to the caller's evaluator with the candidate plan, the validated branch
inspection, the divergence analysis, the measured branch cost, the affected steps, the target, and
the protocol. The evaluator returns `{ score, passed, reason }`, retained verbatim: `passed` yields
`evaluated`, otherwise `rejected`. An evaluator that throws or returns a malformed verdict is a
verification failure: the candidate is retained as `rejected` with failure code
`APPLICATION_VERIFICATION_FAILED`, the run stops, nothing is promoted, and
`ApplicationVerificationError` is raised with the evaluator error as its cause.

## Promotion

After every candidate is evaluated, the `evaluated` candidate with the highest score that reaches
`minPromotionScore` is promoted; the earliest candidate wins a tie. Promotion is retained once as a
`promoted` record repeating that candidate's outcome, it is terminal for the run, and inspection
refuses any later candidate record. When no candidate qualifies, nothing is promoted.

## Retained records

Every record is `shepherd.application.cro_candidate.v1` on the application owner path and conforms
to the closed [`application-cro-candidate-v1`](../spec/schemas/application-cro-candidate-v1.schema.json)
schema; the record codec re-validates every record, including status and evidence consistency,
whenever it is read:

- the `opened` record names the command, the protocol identity, the baseline session, the requested
  comparison baselines, and the whole candidate plan;
- per candidate, a `proposed` record, then an `evaluated` or `rejected` outcome, each retaining the
  plan, `affected_steps`, `target` `{ source_session_id, step_index, prefix_id }`, and
  `branch_session_id`; the outcome adds the `divergence` summary (common prefix, first divergence,
  live and recorded step counts, unexplained indices), measured `cost`, the `evaluation` or the
  `failure`, and the `baseline` comparison;
- at most one `promoted` record.

The manifest is retained last with the terminal cut. Its artifacts are the baseline session
(`baseline_session`), each outcome record (`candidate`), each branch (`candidate_branch`), each
comparison session (`full_replay_session`), and the promotion (`promotion`); sessions are cited by
their terminal record. Costs are measured from the live provider steps of every session the run
opened; a failed provider invocation counts as one call without usage whose cost is unknown, so it
makes `cost_usd` null.

## Full-replay baseline

With `baselines: ["full_replay"]`, each proven candidate is also replayed through
`replayReplaySession` from step boundary zero of its source session (the parent's branch or the
baseline), so no step is served from a journal and every step runs live. The session declares the
candidate's change dimensions and runs with the same resolved program, provider, and handler stack
as the branch, so ancestor edits are included; the task in force at each step is the source's
(ancestor replacement tasks from their targets onward), replaced from step zero by the candidate's
replacement task when it declares `task`. A provider or handler edit therefore applies to every step
of the comparison, including steps the branch serves from its source. The outcome retains the
comparison session's measured live `provider_calls` and `cache_read_input_tokens` next to the
branch's own measured cost. The comparison is reported as measured and makes no claim beyond these
measurements.

## Budgets

The baseline is measured, candidate sessions are projected. The baseline session has no source to
project from, so it runs first and its measured live provider calls are checked against
`maxProviderCalls` before the `opened` record; an over-budget baseline is `ApplicationBudgetError`
with no application record.

Before a candidate session that is not yet retained is opened, the optimizer projects its live
provider calls as the source's provider steps at or after the target (all of them for a full
replay) and refuses with `ApplicationBudgetError` when the calls already measured plus the
projection exceed `maxProviderCalls`. The projection assumes the program re-issues the source's
shape; after every session the measured total is checked again, so a program that issues more calls
than projected is refused with `ApplicationBudgetError` right after the session that overran. The
overrunning session stays retained, its candidate stays `proposed`, and every rerun refuses the same
way without replaying. Retained evidence up to a refusal stays; the retained costs are always
measured.

## Repeats, crashes, and inspection

- Repeating a completed command returns the retained manifest without replaying, evaluating, or
  writing. A repeat under a different protocol is `ApplicationProtocolError`; a repeat with a
  different candidate plan or baselines is `ApplicationEvidenceError`.
- A crash at any application append converges on rerun: after the baseline and before `opened`, the
  baseline command returns its retained session and `opened` is appended; before a `proposed`
  record, the record is appended and the branch runs once; after a candidate's branch and before its
  outcome record, the branch and comparison commands return their retained terminal sessions
  without re-executing the program, the evaluator runs, and the outcome is retained; before the
  promotion, the promotion is appended once; after the promotion and before the manifest, the
  manifest is retained without a second promotion.
- A process that dies inside a candidate's branch or full-replay session leaves that session without
  a terminal record. Once its lease has expired the session is `interrupted`, and the rerun retains
  the candidate as `rejected` with failure code `APPLICATION_EVIDENCE_INVALID`, the measured cost
  and divergence summary of the branch as far as it was retained, and no comparison; the run stops
  with `ApplicationEvidenceError` whose cause is the `ReplaySessionInterruptedError`. While the
  lease is still live the session is `running` and the rerun raises `ReplaySessionInterruptedError`
  without a record, because another writer may still hold it.
- A process that dies inside the baseline session leaves no application record. Every rerun of the
  command raises `ReplaySessionInterruptedError`, because the baseline session identity is derived
  from the command and a non-terminal session is never resumed in place (see
  [replay sessions](./replay-sessions.md#leases-and-recovery)). Recovery is a new command identity,
  which records a fresh baseline; the interrupted session stays inspectable and can be rewound from a
  retained checkpoint or step boundary.
- A rerun after a retained failure raises the same error class without replaying or writing.
- A moved application head is `ApplicationEvidenceError`.

`inspectCounterfactualOptimization(store, applicationId)` validates the whole owner path: the opened
plan and its derived identities, proposed-then-outcome order per candidate with identical plan,
target, affected steps, and derived branch and comparison session identities, every target's
lineage to its parent's branch or the baseline, comparison presence against the requested
baselines, the single terminal promotion, the manifest, and the terminal cut. It embeds no live
session state, so it is identical on the writing store, a reopened or read-only store, and an
imported archive.

## Limits

- Edits are limited to the declarable change dimensions at a step boundary; arbitrary workflow
  rewrites that do not re-issue the recorded prefix fail the divergence proof.
- The baseline must bind no worlds or processes, because a step-boundary target requires it.
- Providers must be able to service repeated sessions: the baseline provider serves the baseline
  and every session of a candidate whose parent chain declares no `provider`, and a candidate's
  provider serves its own sessions and those of descendants that do not replace it.
- A session runs with one provider and one handler stack, so a resolved ancestor provider or handler
  stack applies to the whole live suffix of a descendant, including steps before that ancestor's
  own target when the descendant edits an earlier step.
- Dependency scoping relies on the program's declared `dependsOn`; the divergence proof can report
  divergences the declarations do not explain but cannot prove that a program used no undeclared
  data.
