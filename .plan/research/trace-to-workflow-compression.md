# Compressing Execution Traces into Reusable Workflows

Status: research note, not normative

Research date: 2026-09-25

Tracking: [#218](https://github.com/avnionur/shepherd-typescript/issues/218) (epic
[#202](https://github.com/avnionur/shepherd-typescript/issues/202))

Index: [research notes](./README.md)

## Paper reference

[Shepherd v3](https://arxiv.org/html/2605.10913v3), §6 and Appendix D (Motivation).

Summary: §6 lists "compress execution traces into reusable workflows" as a future use. Appendix D
shows that a meta-agent reading a completed trajectory can choose a fork step and a natural-language
hint such that the rerun passes the verifier in strictly fewer model calls, and closes: "Whether a
compressed trajectory generalises to a reusable workflow for future invocations of the same task
class is a follow-up question we leave open." The motivation names repeatable task classes (a class
of bug fixes, data-processing scripts, build-environment errors).

## Problem statement

Given compressed trajectories from several instances of one task class, derive a workflow artifact
(hint set, step template, or configured program variant) that, applied to an unseen instance of the
class from step 0, passes the verifier in fewer model calls than the uncompressed baseline. The
Appendix D result is per instance with hindsight; this question is across instances without it.

## What the repository provides now

- **Per-instance compression.** `runTrajectoryCompression` records a source, validates a
  `{ fork_point, hint }` proposal, rewinds, replays the suffix under `program({ fork_point, hint })`,
  verifies, and settles `pruned`, `restored`, or `no_prune`, with a best-of-N control
  ([trajectory compression](../../docs/trajectory-compression.md),
  [`trajectory-compression.ts`](../../src/applications/trajectory-compression.ts)). Fork step 0
  reruns the whole workflow under the hint, which is the from-scratch case a reusable workflow
  needs.
- **Retained evidence.** Hint digest, cited step indices, verdict, step counts, and ratios are in
  `shepherd.application.compression.v1` records; `inspectTrajectoryCompression` re-derives them.
- **Cross-instance candidate evaluation.** CRO evaluates a declared edit across train and dev
  examples with fix/guard gating and promotion
  ([counterfactual optimization](../../docs/counterfactual-optimization.md)); a hint set is
  expressible as a declared `task` or `provider` change with a caller `patch`.
- **Evaluation harness.** `runApplicationEvaluation` compares applications against baselines on
  fixtures ([application evaluation](../../docs/application-evaluation.md)).
- **Task identity.** Task descriptors and the task registry give stable task identities that a task
  class could key on ([task descriptors](../../docs/task-descriptors.md),
  [task registry](../../docs/task-registry.md)).

## Gaps

- Compression produces one hint for one source. There is no aggregation of hints across instances
  and no workflow artifact type or record.
- The hint reaches the program only through caller code (`program(guidance)`); a workflow would
  need a declared way to bind it to new instances.
- No task-class notion exists: grouping instances is caller-side.
- The applications have been exercised on fixtures and scripted providers only; there is no
  measured compression rate in this repository.

## Research question

Can the existing pieces be composed so that hints from K compressed instances of a class become one
CRO candidate edit, evaluated from step 0 on held-out instances, with the CRO gate deciding whether
it generalizes?

## Minimal experiment design

1. Fixture class: N deterministic scripted tasks sharing an excisable exploration pattern (for
   example, a redundant probe loop before the productive step), with a verifier.
2. Run `runTrajectoryCompression` on K training instances; collect the retained hints of `pruned`
   outcomes.
3. A caller aggregator (union, or a scripted summarizer) produces one workflow hint.
4. Feed it to `runCounterfactualOptimization` as a single edit at step 0 (`request` scope) with the
   K instances as fix examples and the remaining instances as guard and dev examples; the metric is
   verifier pass minus a step-count penalty declared in the protocol.
5. Report gate result, dev score, and step counts; compare to the `no_compression` baseline and the
   best-of-N control.

## Success and falsification criteria

- Success: the aggregated hint passes the CRO gate on held-out instances of the class and reduces
  mean step count without guard drops beyond `targetedMaxScoreDrop`, on a fixture where the
  exploration pattern is shared.
- Falsified if, on a fixture where the pattern is shared by construction, the step-0 rerun under the
  aggregated hint does not beat the best-of-N control, indicating the hint mechanism alone is not a
  workflow carrier.
- A negative control fixture (no shared pattern) should fail the gate.

## Risks

- A fixture with a planted pattern shows composability, not generalization on real task classes.
- Natural-language hints may transfer poorly; a structured workflow (step template, tool
  restriction) may be required, which is a new artifact type and a contract change.
- Hints can encode instance-specific facts that fail silently on other instances; the guard set
  must include instances where the hint is wrong.

## Next step

No implementation issue is filed until this note is reviewed.
