# Reversible Environments for Continual Learning

Status: research note, not normative

Research date: 2026-09-25

Tracking: [#218](https://github.com/avnionur/shepherd-typescript/issues/218) (epic
[#202](https://github.com/avnionur/shepherd-typescript/issues/202))

Index: [research notes](./README.md)

## Paper reference

[Shepherd v3](https://arxiv.org/html/2605.10913v3), Appendix A.2 "Reversible environments for
continual learning" and §6.

Summary: the §5.3 Tree-GRPO results depend on forking the agent's filesystem and processes being
cheap. The same primitive applies to any domain whose state lives on disk or in a sandboxed process
tree (computer use, browsing, large-codebase edits). With cheap forks, one agent can train over
weeks of interaction instead of one rollout episode, the trace keeping a coherent history of every
revisit, backtrack, and retried tool call. "Continual learning then becomes a question of
scheduling reads against this graph rather than re-engineering the substrate." §6 names "learn
policies for managing agentic execution" as a future direction.

## Problem statement

Treat one long-lived execution graph (a root session plus branch lineages) as the training data
source. The learning system must, at any time, select a set of graph nodes (boundaries) to branch
from, run new suffixes, and add their graded results to the graph, without re-recording shared
prefixes and without the graph growing past storage limits.

## What the repository provides now

- **Branching from recorded sessions.** `rewindReplaySession` and `replayReplaySession` restore a
  checkpoint or step boundary and run a live suffix; branch records cite their source
  ([rewind and replay](../../docs/rewind-and-replay.md)).
- **Automatic checkpoints.** `checkpointPolicy` kinds `provider_step`, `effect_step`, and
  `every_n_steps` make every selected boundary of a world- or process-bound session a restorable
  target ([automatic checkpoints](../../docs/coupled-checkpoints.md#automatic-checkpoints)).
- **Tree rollouts and a training batch.** `runTreeRlRollouts` forks K branches per root at a
  selected turn and exports a digest-stable `jsonl_v2` batch with prefix/suffix advantages;
  `exportTreeRlBatchToTrainer` is the trainer seam
  ([Tree-RL adapter](../../docs/tree-rl-rollouts.md),
  [`tree-rl.ts`](../../src/applications/tree-rl.ts)).
- **Graph queries.** Branch lineage, `diffReplaySessions`, and `findFirstReplayRegression` read the
  graph without writing ([N-way diff](../../docs/rewind-and-replay.md#n-way-diff)); owner-path reads
  and cuts are in [trace queries](../../docs/trace-queries.md).
- **Custody for world forks.** `forkScope` and `discardScope` with carrier backends
  ([scope fork](../../docs/scope-fork.md), [merge and discard](../../docs/scope-merge-discard.md)).
- **Portability.** Archives with world and process image blobs can be imported and branched
  elsewhere ([imported archives](../../docs/rewind-and-replay.md#imported-archives)).

## Gaps

- Tree-RL is one batch iteration over caller-recorded roots with a fixed B·G·K bound
  (`limits.maxRollouts` 64); there is no multi-iteration scheduler that chooses nodes from an
  accumulated graph.
- Branches record against a fixed provider cassette or model; there is no notion of a policy
  version per branch, so a graph mixing policy versions has no record of which policy produced
  which suffix.
- Storage growth: every checkpoint retains world images; there is no retention or compaction policy
  for a weeks-long graph. The paper notes an overlay layer-depth limit near 60 layers requiring
  compaction; the repository's carrier behavior for deep chains is tracked separately
  ([#215](https://github.com/avnionur/shepherd-typescript/issues/215)).
- Off-policy correction for rewards collected under older policies is outside the substrate and
  outside this repository.

## Research question

Can repeated Tree-RL iterations draw fork points from an accumulated session graph (rather than
fresh roots only) while keeping batch identities deterministic, record provenance per policy
version, and keep storage bounded by a declared retention policy?

## Minimal experiment design

1. Fixture: a deterministic world-bound task (small file tree) with scripted providers indexed by a
   declared policy version, and `checkpointPolicy: provider_step`.
2. Iteration 0: record G roots, run `runTreeRlRollouts`, export the batch.
3. Iterations 1..M: a caller scheduler selects fork boundaries from all finished sessions of
   earlier iterations (roots and branches) using a declared rule (for example, highest intra-tree
   advantage variance), runs branches under policy version `i`, and exports each batch.
4. Measure per iteration: live versus recorded steps, retained checkpoint bytes, and whether
   `exportTreeRlTrainingBatch` re-derives every earlier batch digest unchanged.
5. Apply a caller retention rule (drop world images of boundaries no scheduler rule can select) and
   check which rewinds become `unavailable`.

## Success and falsification criteria

- Success: every iteration's batch is reproducible from records; the fraction of recorded steps
  grows with M; retained bytes stay under a declared bound under the retention rule; no selected
  boundary is unavailable.
- Falsified if forking from branch sessions (not only roots) is refused or breaks the divergence
  proof, or if storage cannot be bounded without losing selectable boundaries.

## Risks

- Current Tree-RL takes roots as input; branching from branches may need adapter changes that alter
  the pinned applications protocol, which is a versioned contract change.
- Real continual learning needs a trainer and live models; neither ships here, so results would be
  substrate-level (reuse, storage, reproducibility), not learning curves.
- Graph size may hit `replay.divergence.maxSessions` or store limits before learning-relevant scale.

## Next step

No implementation issue is filed until this note is reviewed.
