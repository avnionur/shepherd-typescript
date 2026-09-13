# Scope scheduling and recovery classification

Implementation: [`src/workspace/scope-tree.ts`](../src/workspace/scope-tree.ts) with types in
[`src/workspace/scope-tree-types.ts`](../src/workspace/scope-tree-types.ts), and
[`src/scope/recovery.ts`](../src/scope/recovery.ts). Configuration: `scopes.scheduling` and
`scopes.recovery` in [`protocol.config.json`](../protocol.config.json). Public entry points:
`runScopeTree` from [`src/facades/workspace.ts`](../src/facades/workspace.ts), and
`inspectScopeRecovery` with the scheduling and recovery constants from
[`src/facades/scopes.ts`](../src/facades/scopes.ts); all of them from [`src/index.ts`](../src/index.ts).
Tests: [`scope-tree.test.ts`](../test/scope/scope-tree.test.ts) and
[`scope-recovery.test.ts`](../test/scope/scope-recovery.test.ts).

## Scope

Scope protocol v5 adds parallel and nested scheduling over the durable scope substrate, plus a
record-derived recovery classification. Scheduling composes the public
[registration](./scope-registration.md), [fork](./scope-fork.md), and
[merge and discard](./scope-merge-discard.md) commands; it adds no new record kind, store table, or
authority. Live supervision, interception, provider or process checkpoints, and distributed
scheduling are not part of this slice.

## Scheduling a tree

`runScopeTree(store, { parent, children, commandPrefix, maxParallel, carrier? })` settles a tree of
declared child scopes under an authenticated parent writer. Each node has a sibling-unique `key`,
a requested `grant`, optional `fork: { binding }` for a reference-copy world, optional `children`,
and optional `run(context)` returning `merge` (the default) or `discard`.

- **Order.** Children of one parent are created in declared order under that parent. Their subtrees
  then run with at most `maxParallel` siblings in flight, bounded per sibling group, so nesting
  cannot deadlock. Nesting is depth-first: a node's children are created, run, and settled before
  the node's own work runs with their outcomes in `context.children`.
- **Deterministic settlement.** Siblings settle in declared order under the parent, so outcomes,
  scope identities, and the parent's selected history are identical for every `maxParallel`.
- **Failure isolation.** A throwing `run` or an unsupported decision discards only that node's
  subtree and reports `failed` with the failure text. A merge refused with
  `ScopeMergeConflictError` discards the child and reports `conflicted`. Every other refusal (a
  held writer, stale evidence, missing authority, carrier faults) fails the schedule closed, but
  only after every sibling subtree already in flight has finished. Several failing siblings are
  reported together as an `AggregateError`.
- **Worlds.** A forked node's origin is a binding snapshot under a trace-only parent or a capture of
  the parent world's current custody; `context.custodyPath` is its mutable custody. A world child
  can be merged only into a parent owning reference-copy custody; under a trace-only parent it must
  decide `discard`.
- **Bounds.** Keys may not contain the configured path separator. Depth, node count, and
  `maxParallel` are bounded by `SCOPE_SCHEDULING_LIMITS`.

## Restart convergence

Every command and writer claim identity is `commandPrefix`, the node key path, and a configured
suffix joined by the configured separator. Re-running the same schedule after a crash therefore
resumes from retained evidence instead of duplicating it:

| Retained state of a node | Behavior on re-run |
| --- | --- |
| Not created | Created normally |
| Registered or forked, open | Registration or fork replays with its retained parent head and origin; an incomplete fork resumes |
| Reserved merge | Work is not run again; the merge resumes from the reservation's retained heads |
| Merged, or discarded with cleanup complete | Work is not run again; the outcome is reported from evidence |
| Discarded with pending cleanup | Work is not run again; cleanup resumes |
| Open, unsettled | Work runs again; `context.emit(key, data)` replays a retained emission and conflicts if the data differs |

A settled node whose declared children no longer match retained evidence fails with
`ScopeEvidenceError`. Re-running a merged world node also removes protected merge application
custody that a crash after merge completion left behind. Recovered outcomes report `merged` or
`discarded` with no failure text, because a failure message
is not durable evidence. Work of unsettled nodes may run more than once, so its side effects must
be idempotent. Writers are re-claimed under their deterministic claim identities before each
mutation: this renews an expired lease held by the same schedule and fails closed with
`ScopeWriterConflictError` when another holder is active.

## Recovery classification

`inspectScopeRecovery(store, { nowMilliseconds? })` classifies every live scope in canonical
scope-identity order. It reads registration rows, writer claims, and validated records, and it
never appends, repairs, scans directories, or infers ownership from projections. Classifications
apply in precedence order:

| Classification | Meaning | Recovery owner | Resume |
| --- | --- | --- | --- |
| `terminal` | Merged, or discarded with cleanup complete or nothing to clean | none | none |
| `cleanup_pending` | Discarded while its subtree root's cleanup record is pending, including a discard with no custody interrupted before its record | owning parent of the subtree root, or the sealing ancestor discard's owner when that parent was sealed | `discard` with the retained command |
| `merge_pending` | A merge reservation is retained without completion | owning parent | `merge` with the retained command |
| `fork_pending` | A reference-copy fork is prepared without completion | owning parent | `fork` with the retained command |
| `writer_expired` | An unreleased writer claim is past its lease; its holder may still run | the scope itself | `claim`: supersede, then release or continue |
| `writer_held` | An unexpired writer claim is active | none | none |
| `idle` | Open with no active claim | none | none |

Structural orphans cannot exist: registration rows require their parent row, and a discard seals
every open descendant in the same transaction. Orphaned work is therefore detected as
`writer_expired`. Lease expiry alone never proves the holder stopped, so recovery supersedes the
claim, which fences the old holder's trace commands. Imported archives carry no live rows and
report no scopes.

## Conformance boundary

| Contract | Evidence |
| --- | --- |
| Nested settlement order, bounded parallelism, deterministic results across parallelism | `scope-tree.test.ts` |
| Work failure, unsupported decisions, and conflicts discard only their subtree | `scope-tree.test.ts` |
| Interruption before merge completion resumes without rerunning settled or reserved work | `scope-tree.test.ts` |
| Emission replay and conflict, subtree refusals failing closed after siblings settle | `scope-tree.test.ts` |
| World forks merging disjoint siblings and discarding conflicts | `scope-tree.test.ts` |
| Option validation, bounds, missing carriers, and foreign writers | `scope-tree.test.ts` |
| Every recovery classification with its owner and resume command | `scope-recovery.test.ts` |
| Configuration drift and scope v5 compatibility | `protocol-config.test.ts`, `scope-schema.test.ts` |

Live supervision, interceptors, provider or process restoration, and distributed schedulers are not
claimed.
