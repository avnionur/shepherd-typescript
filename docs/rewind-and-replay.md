# Rewind and Replay

Implementation: [`src/replay/branch.ts`](../src/replay/branch.ts),
[`src/replay/session.ts`](../src/replay/session.ts), and
[`src/replay/analysis.ts`](../src/replay/analysis.ts), and
[`src/replay/lineage.ts`](../src/replay/lineage.ts). Public entry point:
[`./replay`](../src/facades/replay.ts). Tests:
[`replay-branch.test.ts`](../test/replay/replay-branch.test.ts),
[`replay-contract.test.ts`](../test/replay/replay-contract.test.ts), and
[`replay-conformance.test.ts`](../test/replay/replay-conformance.test.ts); N-way diff and
first-regression search: [`replay-lineage.test.ts`](../test/replay/replay-lineage.test.ts); compensation of the
source suffix: [`compensation.test.ts`](../test/effect/compensation.test.ts); world-bound targets
from automatic checkpoints:
[`replay-automatic-checkpoints.test.ts`](../test/replay/replay-automatic-checkpoints.test.ts). Schema:
[`replay-restore-v1`](../spec/schemas/replay-restore-v1.schema.json).

## Branch sessions

`rewindReplaySession(store, options)` and `replayReplaySession(store, options)` open a branch
session whose record cites the source session record and retains the mode, the target, the declared
changes, and the replacement task. The target is a retained checkpoint (`{ checkpointId }`) or a step
boundary (`{ stepCount }`). A step boundary is admissible only when the source binds no worlds and no
processes; otherwise it is refused with `ReplayCheckpointUnavailableError` naming each world and
process with the configured boundary reason. A world- or process-bound session is therefore
addressed by its checkpoints: with an [automatic checkpoint policy](./coupled-checkpoints.md#automatic-checkpoints)
every selected step boundary retains one, and `{ checkpointId }` of that checkpoint rewinds or
replays to it with every world restored byte-equivalently. Repeating a completed branch command
returns its retained receipt without restoring anything only after its normalized request matches
the retained request journal. See [branch request identity](./replay-request-identity.md).

## Verification before writing

Before the branch session is opened, nothing is written:

- the source session is fully inspected, so its prefix, cuts, and frontier are proven;
- a target classified `unavailable` is refused with every unavailable constituent and reason;
- branch worlds and processes must name exactly the source's worlds and processes and backends;
- every restoration root must be an existing empty directory;
- every world image manifest and file blob, and every process image blob, must be present and
  verified in this store;
- a verified provider session requires a `providerSession` adapter;
- the checkpoint cut resolver entry is re-read.

Failures raise `ReplayRestoreError`, `ReplayCheckpointUnavailableError`, `ReplayEvidenceError`, or
`TypeError`.

## Restoration

Worlds are materialized from the verified image into their empty roots and re-captured; the content
identity must equal the checkpoint's, so the restored managed filesystem is byte-equivalent to the
recorded cut. Verified process images are handed to their adapters. A verified provider session is
handed to the adapter, which must return the recorded context prefix identity. A step-boundary
target makes the branch publish a cut of the source prefix. The restore record then retains every
restored constituent and the derived classification, so records distinguish an `atomic` start from a
`reconstructive` one. A restoration failure after the branch opened is retained as a `failed`
terminal without a restore record.

## Rewind

After restoration, a rewind copies the source prefix as `recorded` steps, each citing its source
step record and verified to reach the restored prefix and context prefix identities, and ends
`rewound`. No provider or handler is invoked.

## Replay

A replay re-executes the program. While the branch holds fewer steps than the target, a provider
request or effect intent is served from the source journal only when it and its declared
dependencies equal the recorded step; it is retained as a `recorded` step and neither the provider
nor any handler is invoked. A different request, intent, dependency set, a checkpoint call at a
boundary where the source retains none, or ending before the target is a prefix mismatch: the
context is poisoned, later operations throw the same `ReplayPrefixMismatchError`, and the branch ends
`failed` with retained evidence. A checkpoint call inside the recorded prefix returns the source
checkpoint.

From the target onward, steps run live with the supplied provider and handler stack, and
`context.task` is the replacement task when `changes` includes `task`. Otherwise the task in force at
each index is the one the source had in force there, resolved through the source's own branch
ancestry. A replacement task must differ from the source task in force at the target, and a
replacement requires exactly the declared task change. Branch
checkpoints capture the branch's own worlds and processes at boundaries at or after the target;
a replay's `checkpointPolicy` selects them automatically from the target boundary on, and each is
itself a restorable target.

## Compensation

A branch declares what happens to its source's suffix with `sourceDisposition`, one of
`replay.branch.sourceDispositions` (`compensate`, `retain`); without one it uses
`replay.branch.defaultSourceDisposition` (`compensate`). A malformed or unconfigured value is a
`TypeError` before anything is written. With `retain` the source stays a retained alternative and
no compensation handler is invoked or required; Tree-RL rollouts, CRO candidate replays,
trajectory-compression rewinds and reruns, and the meta-agent `replay` tool branch this way
([source disposition](./compensation.md#source-disposition),
[`replay-source-disposition.test.ts`](../test/replay/replay-source-disposition.test.ts)).

With `compensate`, after verification and before the branch session opens, every successful effect
of a [compensable tier](./compensation.md) that the source materialized at or after the target is
compensated through the `compensation` registry in reverse step order. A recorded source step
resolves to the live step it copies, so an effect already compensated by an earlier branch, a
discard, or an explicit command is never compensated again. A missing handler is refused before
anything is written (`EffectCompensationHandlerNotFoundError`); a failed compensation raises
`EffectCompensationFailedError` before the branch opens, and a retry of the same command resumes.
Rewind retains `replay_rewind` and replay `replay_replay` as the attempt trigger. Repeating a
completed branch command compensates nothing. The same holds for a world-bound target: the
restored worlds are the checkpoint's, and effects past the target that touched anything outside
the bound worlds are compensated exactly once.

## Irreversible effects

A recorded prefix never invokes a handler, so no prefix effect is re-materialized. In a branch
suffix, an effect whose tier is configured as approval-required (irreversible by default) is admitted
only when `policy` approves it. An effect whose intent the source admitted without a retained step is
treated the same way regardless of tier, because it may already have materialized. The policy
receives the intent, the branch identity, the step index, and the source step index that materialized
or admitted the same intent, if any. An approval retains the approver,
reason, and whether it re-materializes a source effect. Without a policy, on refusal, or when the
policy throws or returns a malformed verdict, the step is retained as `refused` with the configured or
supplied reason, no admission is retained, no handler runs, and the program receives
`ReplayEffectRefusedError`. Root sessions are ordinary executions and are not gated here.

## Imported archives

Session records, cuts, and world and process image blobs are native trace records and blobs, so an
exported archive imported into a pristine store can be inspected, rewound, and replayed there; branch
sessions are admitted in the importing store. Evidence from another replay protocol version raises
`ReplayCompatibilityError`.

## Divergence and dependency analysis

`analyzeReplayDivergence(store, { sourceSessionId, replaySessionId })` aligns a branch with its
source by index. A step is `identical` when both retain the same step identity, `diverged` when both
retain different identities, and `source_only` or `replay_only` otherwise. A non-identical step is
`propagated` when a declared dependency is not identical; `root` when its dependencies are identical
and its kind is explained by a declared change (task or provider for provider steps; handlers or a
replay-policy refusal for effect steps); and `unexplained` otherwise. The analysis reports the first
divergence, the prefix identity of the longest identical prefix, and every unexplained index.

`analyzeReplayDependencies(store, { sessionId, stepIndex })` returns the transitive dependents of a
step and the later steps independent of it. Both analyses are read-only and rely on the program's
declared dependencies: they can report divergences the declarations do not explain, but cannot prove
that a program used no undeclared data.

## N-way diff

`analyzeReplayDivergence` requires the branch to originate directly from the source.
`diffReplaySessions(store, { sessionIds })` diffs any set of two to `replay.divergence.maxSessions`
distinct sessions instead, such as sibling Tree-RL rollouts, candidate branches, or meta-agent
workers:

- The **lineage** of a session is the chain of retained branch origins from its root session to
  itself. The **ancestor** is the deepest session in every lineage (one of the inputs when it is an
  ancestor of the others), or `null` when the sessions share no root.
- The **base** is the longest prefix of the ancestor's steps that every branch retains with
  identical step identities; it is empty without an ancestor. `base_prefix_id` names its prefix.
- Each branch is aligned by index against the ancestor from the base onward with the divergence
  statuses: `identical`, `diverged`, `source_only` (only the ancestor retains the index), and
  `replay_only` (only the branch retains it). `first_divergence_index` is the first non-identical
  index.
- Every effect step a branch retains past the base is a **captured effect**, identified by its step
  content identity (intent, disposition, outcome, failure), so the same intent with another outcome
  is a different captured effect. The result lists each branch's captured effects and one table of
  distinct captured effects with the branches that captured them, in input order, and whether the
  ancestor retains the same effect step past the base.

Divergence causes are not assigned, because siblings declare their changes against their source,
not against each other; use `analyzeReplayDivergence` on each source-branch pair for causes. Scope
lineage is exposed by `shepherd-ts scope show`, but scopes are not diffed: their selected histories
are record contributions, not replay steps.

## First-regression search

`findFirstReplayRegression(store, { sessionId, verdict, strategy })` locates the first revision of a
session lineage that a caller verdict rejects. Revision `k` is the first `k` steps of the searched
session; revision 0 is empty. A branch retains its inherited prefix as `recorded` steps, so the
revisions span the whole lineage, and each revision is attributed to the lineage session that
executed its newest step live, found by walking recorded steps back through their sources. The
verdict receives the revision's prefix identity, attributed session, step count, and steps, and
returns `true` (good) or `false` (bad); any other value is a `TypeError`.

The configured strategies (`replay.divergence.regressionStrategies`) are `bisect`, the default, and
`linear`. `bisect` evaluates the newest revision (nothing regressed when accepted), then revision 0
(the first revision is bad when rejected), then halves the good/bad interval at the lower midpoint;
it assumes a monotone verdict and needs `O(log n)` verdicts. `linear` evaluates revisions from 0
upward and stops at the first rejection. Both are deterministic, evaluate each revision at most
once, report every evaluation in order with `first_bad` and `last_good`, and append nothing. A
verdict that inspects retained evidence only is itself read-only; one that re-executes work is the
caller's responsibility.
