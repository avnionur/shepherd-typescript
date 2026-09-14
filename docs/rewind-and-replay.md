# Rewind and Replay

Implementation: [`src/replay/branch.ts`](../src/replay/branch.ts),
[`src/replay/session.ts`](../src/replay/session.ts), and
[`src/replay/analysis.ts`](../src/replay/analysis.ts). Public entry point:
[`./replay`](../src/facades/replay.ts). Tests:
[`replay-branch.test.ts`](../test/replay/replay-branch.test.ts),
[`replay-contract.test.ts`](../test/replay/replay-contract.test.ts), and
[`replay-conformance.test.ts`](../test/replay/replay-conformance.test.ts). Schema:
[`replay-restore-v1`](../spec/schemas/replay-restore-v1.schema.json).

## Branch sessions

`rewindReplaySession(store, options)` and `replayReplaySession(store, options)` open a branch
session whose record cites the source session record and retains the mode, the target, the declared
changes, and the replacement task. The target is a retained checkpoint (`{ checkpointId }`) or a step
boundary (`{ stepCount }`). A step boundary is admissible only when the source binds no worlds and no
processes; otherwise it is refused with `ReplayCheckpointUnavailableError` naming each world and
process with the configured boundary reason. Repeating a completed branch command returns its
retained receipt without restoring anything.

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
checkpoints capture the branch's own worlds and processes at boundaries at or after the target.

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
