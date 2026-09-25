# Agent Interpretability Probes

Status: research note, not normative

Research date: 2026-09-25

Tracking: [#218](https://github.com/avnionur/shepherd-typescript/issues/218) (epic
[#202](https://github.com/avnionur/shepherd-typescript/issues/202))

Index: [research notes](./README.md)

## Paper reference

[Shepherd v3](https://arxiv.org/html/2605.10913v3), Appendix A.2 "Agent interpretability" and §6.

Summary: interpretability of agentic systems is described as largely observational (annotate a
transcript, fit a probe). The coupled fork turns this into counterfactual intervention: edit one
component (a tool, a system-prompt span, a sub-task definition), replay the suffix from the first
commit it affects, and hold every other source of variance fixed. The paper proposes running CRO's
propose-and-replay loop under an interpretability objective, "e.g. minimal edits that flip a
specific decision, or the smallest prompt span whose removal preserves task success". §6 lists
"counterfactual agentic interpretability probes" as a future use of the substrate.

## Problem statement

Given a finished recorded session and a named decision in it (a provider step output or a tool-call
intent), find:

1. **Flip probe.** A minimal declared edit whose counterfactual suffix changes that decision.
2. **Sufficiency probe.** The smallest prompt span (or tool set) whose removal still yields a
   session the task metric scores as successful.

Both are searches over edits, scored by a counterfactual replay, with an objective other than task
score lift.

## What the repository provides now

- **Counterfactual replay with edit scopes.**
  [`runCounterfactualOptimization`](../../docs/counterfactual-optimization.md)
  ([`counterfactual-optimizer.ts`](../../src/applications/counterfactual-optimizer.ts)) implements
  Algorithm 1 over declared edits at a step boundary with scopes `request` and `downstream`
  (`applications.cro.editScopes` in `protocol.config.json`). The replay target is the first affected
  event, derived from `analyzeReplayDependencies`.
- **Divergence proof.** Every candidate branch must satisfy `analyzeReplayDivergence`: no divergence
  before the target and none `unexplained`
  ([divergence and dependency analysis](../../docs/rewind-and-replay.md#divergence-and-dependency-analysis)).
  This is the "hold every other source of variance fixed" property, conditional on declared
  `dependsOn`.
- **Pluggable proposer and metric.** A `CounterfactualProposer` is any function; the metric is a
  caller function returning a finite score
  ([`counterfactual-proposer.ts`](../../src/applications/counterfactual-proposer.ts),
  [`counterfactual-gate.ts`](../../src/applications/counterfactual-gate.ts)).
- **Sibling comparison.** `diffReplaySessions` gives an N-way diff with captured effects across
  candidate branches ([N-way diff](../../docs/rewind-and-replay.md#n-way-diff)).
- **Monotone search.** `findFirstReplayRegression` bisects a lineage under a caller verdict
  ([first-regression search](../../docs/rewind-and-replay.md#first-regression-search)); its
  bisection pattern is reusable for span search, although it searches revisions, not edits.
- **Trace access for a proposer.** CRO proposer tools `read_effect_trace` and `grep_effect_traces`
  ([proposers](../../docs/counterfactual-optimization.md#proposers)).

## Gaps

- The CRO gate (targeted lift, guard drop, improve fraction) and promotion rule are task-success
  objectives. There is no objective of the form "decision at step s changed" or "edit size is
  minimal subject to success".
- Edits are caller-interpreted `patch` data with declared change dimensions (`task`, `provider`,
  `handlers`). There is no span-level edit grammar (delete bytes `[a, b)` of prompt surface `p`) and
  no edit-size measure.
- A "decision" has no canonical identity. The nearest candidates are a provider step's output
  digest and an effect intent's canonical content, both retained per step.
- Replay identity is exact: any provider nondeterminism in the suffix is attributed to the edit.
  Static provider cassettes make suffixes deterministic, but then an edit outside the cassette
  keys cannot be served.

## Research question

Can the existing CRO replay path, with only a different proposer and scoring function, locate a
minimal flip edit and a minimal sufficient prompt span on a recorded session, and does the
divergence proof make the resulting attribution trustworthy?

## Minimal experiment design

1. Fixture: a deterministic scripted tool-loop worker
   ([`createProgramConversationProvider`](../../docs/tool-use-loop.md#scripted-models)) whose tool
   choice at a chosen turn is a pure function of which system-prompt spans are present. The ground
   truth set of decision-relevant spans is therefore known.
2. Record one baseline session per example with `runReplaySession`.
3. Flip probe: a caller proposer enumerates single-span deletions at the edited step (`request`
   scope); the metric returns 1 when the target step's retained output digest differs from the
   baseline, else 0. Report the smallest flipping span set.
4. Sufficiency probe: greedy then bisection deletion over spans, metric equals the task score;
   keep the smallest span set with success.
5. Compare the recovered span sets against the fixture ground truth.
6. Repeat with a fixture whose `dependsOn` declarations deliberately omit one dependency, to test
   whether the divergence proof reports `unexplained` rather than a false attribution.

No code under `src/` is needed for steps 1-5 beyond test-local proposer and metric functions; step
6 exercises existing refusal behavior.

## Success and falsification criteria

- Success: on the deterministic fixture, the recovered flip and sufficiency sets equal the ground
  truth, every candidate branch passes the divergence proof, and the number of live suffix steps is
  strictly below full replay (reported by `computation_reuse`).
- Falsified if the CRO gate or promotion rule cannot be neutralized by thresholds alone (the
  protocol requires an objective change), or if the under-declared fixture yields a clean proof with
  a wrong attribution.

## Risks

- Attribution is only as strong as declared dependencies; the analysis cannot prove the absence of
  undeclared reads.
- On live models a single replay does not distinguish an edit effect from sampling variance; a
  probe needs repeated suffixes and a statistical test, which CRO does not provide.
- Search cost is combinatorial in span count; bisection assumes monotone effects.
- Interpretability claims about a real model would exceed what a scripted fixture shows.

## Next step

No implementation issue is filed until this note is reviewed. A follow-up issue, if approved, would
scope an objective-configurable probe protocol (configuration, not literals) reusing the CRO replay
path.
