# Substrate-Native Actions for Post-Training

Status: research note, not normative

Research date: 2026-09-25

Tracking: [#218](https://github.com/avnionur/shepherd-typescript/issues/218) (epic
[#202](https://github.com/avnionur/shepherd-typescript/issues/202))

Index: [research notes](./README.md)

## Paper reference

[Shepherd v3](https://arxiv.org/html/2605.10913v3), Appendix A.2 "Post-training agents to use the
substrate" and §6.

Summary: the §5 case studies fix the meta-agent and let it govern a base worker. The dual question
is whether the worker can be post-trained to use the primitives natively: "an action space that
includes fork, discard, and replay over its own typed effect stream, not just tool calls into the
environment." The paper calls this strictly harder than tool-use post-training, because the model
must learn when to back up, retry, or spawn a sibling. The substrate supplies the typed state to
define these actions and compute exact returns over them.

## Problem statement

Define a worker action space in which substrate operations over the worker's own execution are
ordinary actions, such that (a) every such action is a retained, replayable effect, (b) the return
of a trajectory that forks or discards is well defined, and (c) the trajectory can be exported as a
training example with per-action credit.

## What the repository provides now

- **Substrate operations as tools.** `createMetaAgentTools` exposes `observe`, `fork`, `discard`,
  `rewind`, `replay`, `read_trace`, and `diff` as `ToolLoopTool`s with JSON Schemas, effect kinds,
  and reversibility tiers from `providers.tools.metaAgent.tools`
  ([meta-agent tool catalog](../../docs/tool-use-loop.md#meta-agent-tool-catalog),
  [`meta-agent-tools.ts`](../../src/agent/meta-agent-tools.ts)).
- **Tool calls are effects.** `runToolLoop` turns every call into an intent and outcome; under
  `createReplayToolLoopBindings` each turn is a provider step and each call an effect step, so a
  loop that calls substrate tools is itself replayable
  ([tool-use loop](../../docs/tool-use-loop.md), [`tool-loop.ts`](../../src/agent/tool-loop.ts)).
- **Figure 1 scenario.** A scripted meta-agent forks a worker, observes a failure, rewinds, replays
  under a variant, diffs, and discards
  ([Figure 1 scenario](../../docs/tool-use-loop.md#figure-1-scenario)).
- **Per-action credit export.** Tree-RL's `jsonl_v2` lines attribute advantages per turn with
  prefix/suffix segments ([training batch](../../docs/tree-rl-rollouts.md#training-batch)).
- **Compensation on backtrack.** Rewind and replay compensate compensable effects past the target;
  discard compensates cited effects ([effect compensation](../../docs/compensation.md)).

## Gaps

- The catalog tools act on other sessions (named workers). `fork` runs a worker to completion
  inside the call. There is no action by which a running session branches or rewinds itself; whether
  a non-terminal session can be a branch source must be confirmed against
  [`src/replay/branch.ts`](../../src/replay/branch.ts) before any design.
- A trajectory that calls `rewind` or `discard` has a tree-shaped outcome; there is no defined
  return aggregation (last surviving branch, best branch, or sum with a cost term) and no record of
  which branch the worker committed to.
- Tree-RL export assumes provider-step turns in a single session; actions spanning a parent loop
  and its child sessions have no export format.
- No trainer ships; `exportTreeRlBatchToTrainer` is a seam only.

## Research question

Can a single worker loop whose tool set includes substrate operations over a caller-designated self
scope produce a retained trace from which a well-defined return and a per-action training line are
derivable without new substrate primitives?

## Minimal experiment design

1. Fixture: a scripted worker in a replay session with environment tools plus `rewind`, `replay`,
   and `discard` bound, through `MetaAgentToolEnvironment`, to a worker definition that re-runs the
   same program (a "self" worker by configuration, not a literal).
2. Script three policies: never backtrack; backtrack after a failed check; spawn two siblings and
   keep the better one.
3. For each trace, derive candidate returns under two declared aggregation rules and check they are
   pure functions of retained records (inspect on a reopened store and an imported archive).
4. Emit one line per action in a draft grammar extending `jsonl_v2` with the session each action
   belongs to, and check digest stability across repeats.

## Success and falsification criteria

- Success: every substrate action is a retained effect step; returns and lines re-derive identically
  from records on writing, reopened, and imported stores; compensation fires exactly once per
  backtracked compensable effect.
- Falsified if self-referential branching requires a primitive the substrate lacks (for example,
  branching a non-terminal session), which would make this an implementation proposal, not a
  composition.

## Risks

- A self-branching action risks unbounded recursion; budgets (`maxProviderCalls`, `maxTurns`) must
  cover nested sessions, and whether nested session costs roll up into the parent loop's accounting is unverified.
- `discard` is tiered irreversible in the catalog, so replaying a trace that discards passes the
  irreversible approval policy in branch suffixes; training rollouts would need a declared policy.
- Learning results require live models and a trainer; this note only scopes the action and data
  contract.

## Next step

No implementation issue is filed until this note is reviewed.
