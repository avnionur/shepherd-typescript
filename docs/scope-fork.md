# Reference-copy scope fork and restart recovery

Implementation: [`src/workspace/scope-fork.ts`](../src/workspace/scope-fork.ts) with options in
[`src/workspace/scope-fork-types.ts`](../src/workspace/scope-fork-types.ts). Journal and checkpoint
codecs: [`src/scope/records.ts`](../src/scope/records.ts) and
[`src/scope/world.ts`](../src/scope/world.ts). Store transactions:
[`src/store/scope-registrations.ts`](../src/store/scope-registrations.ts). Public entry points:
`forkScope` from [`src/facades/workspace.ts`](../src/facades/workspace.ts), `claimScopeWriters` and
the fork types from [`src/facades/scopes.ts`](../src/facades/scopes.ts), and both from
[`src/index.ts`](../src/index.ts). Schema:
[`scope-fork-v1`](../spec/schemas/scope-fork-v1.schema.json). Tests:
[`scope-fork.test.ts`](../test/scope/scope-fork.test.ts),
[`scope-fork-recovery.test.ts`](../test/scope/scope-fork-recovery.test.ts), and
[`scope-fork-codec.test.ts`](../test/scope/scope-fork-codec.test.ts). Contract: the Phase 6
[scope ownership/authority proposal](../.plan/scope-ownership-contract.md), slice B.

## Scope

`forkScope` creates one isolated child scope whose world is separate mutable custody of a single
bound resource, published by the existing [reference copy carrier](./reference-copy-carrier.md).
It builds on [trace-only scope registration](./scope-registration.md): the child is registered,
fenced, inspected, and replayed through the same records and commands. The copy is a quiescent
**verified copy** of an immutable origin revision, not a kernel-atomic snapshot. No multi-resource
fork, optimized carrier, scheduling, or provider or process restoration is added. A forked child
ends through [consume-once merge or discard](./scope-merge-discard.md).

Scope protocol v2 appends the `reference_copy` world capability, the `fork` command kind, the
`fork_prepared` and `fork_completed` history kinds, the `workspace_binding` resource kind, the fork
journal schema, and the checkpoint vocabulary. Every scope protocol v1 value keeps its position and
meaning, so slice A records decode unchanged. No store migration is required.

## Admission

The caller supplies the parent writer, the exact current parent head, the requested grant, a
package-created binding and carrier, an origin revision identity, and a globally idempotent
command identity. Handles copied, serialized, or minted by another store fail with `TypeError`.

- **Bound resource.** A Git repository binding binds `repository_binding` with its exact
  `resource_id`, revalidated against current Git evidence. An ordinary directory binding binds
  `workspace_binding` with its `binding_id`. The child's effective authority, attenuated from the
  parent and the whole-run ceiling exactly as in registration, must grant `read` on that resource;
  otherwise `ScopeAuthorityError`.
- **Verified fixed origin.** The origin revision is reopened and verified by the carrier and must
  capture the bound binding. A trace-only parent owns no managed world, so its world is the origin
  cut together with a binding snapshot declared by the caller. For a forked parent the origin must
  be a capture of the parent world's current custody: its parent revision is the parent world's
  base and its content equals the parent custody's verified content. Any other origin fails with
  `ScopeEvidenceError`. Holding the parent's writer is the quiescence evidence.
- **Retained intent before physical work.** One transaction appends the parent control record, the
  child registration declaring `reference_copy`, the origin cut through the exact parent head, and
  a prepared fork record caused by that cut. The prepared record names the binding, bound resource,
  origin revision and content, verified-copy capture kind, and the custody identity derived from
  the command and child scope.

## Physical fork and completion

After the prepared record commits, and on every retry, one read transaction must first find
positive boundary evidence before any carrier work: the parent is open under its exact current
writer fence, the child is open and owned by that parent, the prepared record is still the child
head, and no writer has ever been admitted on the child. A fork whose completed record is already
retained skips this check and replays. The carrier then publishes custody under the derived
identity. The fork completes only when the custody's base revision, base content, and binding match the prepared
record, the custody content still equals the origin content, and the origin revision re-verifies
unmodified. A second transaction then requires the parent's current writer fence and the prepared
record as the child's head, and appends a completed fork record citing the custody, its verified
content, and the checkpoint descriptor. The receipt is read back through the same reader used by
receipt replay, so a fresh result and a replay are identical.

Until completion the child refuses writer claims, including inside `claimScopeWriters`, so no
emission or nested registration can move its head. Parent and sibling custody and the user binding
are never written. After completion the child writer may mutate its custody through the carrier.

## Checkpoint descriptor

The completed record retains every configured constituent in configured order, each classified:

| Constituent | Classification |
| --- | --- |
| `trace_cut` | verified, citing the origin cut |
| `execution` | verified with the run creation record when associated, otherwise not applicable |
| `binding` | verified, citing the origin revision that captured the bound resource |
| `world` | verified, citing the custody identity |
| `grants` | verified, citing the registration record that retains effective authority |
| `child_frontier` | verified, citing the parent-owned child-registration record |
| `budget`, `provider_session`, `process` | unavailable with a reason when a run is associated, otherwise not applicable |
| `irreversible_effects` | unavailable, because external effects are not tracked by copies |

A verified constituent must cite a receipt, an unavailable constituent must state a reason, and
reconstructive or not-applicable constituents carry neither. Decoders refuse reordered kinds,
unknown statuses, and missing receipts or reasons. This slice produces no reconstructive
constituent, and nothing here claims provider, process, or atomic-snapshot restoration.

## Replay and restart recovery

Every step is idempotent under the command identity. Retrying the same request:

| Interrupted | Retained evidence | Retry behavior |
| --- | --- | --- |
| Before admission | Nothing | Admits normally |
| After the prepared record, before physical work | Registration and prepared record | Publishes custody by identity, then completes |
| After custody publication, before completion | Prepared record and custody | Reopens the same custody identity, verifies it, then completes |
| After completion, response lost | Completed record | Returns the original receipt with no carrier work |
| Concurrent completion | Completed record committed by another caller | Completion replays inside the store |

A retained command is replayed before liveness checks: the origin revision must match the
prepared record, and any other changed request conflicts with `AppendIntentConflictError`. A
completed fork replays without a parent fence. An incomplete fork needs a current parent fence, so
recovery after restart claims a fresh parent writer. `readScopeCommandReceipt` returns a fork
receipt only once the completed record is retained. `inspectScope` reports the prepared world
before that.

Custody that is modified before completion is an unknown physical state and fails with
`ScopeEvidenceError` without being copied over. Discarded custody surfaces the carrier's
`WorldCarrierError`. Both leave the fork prepared and blocked. A custody directory that is wholly
absent is republished under the same identity, but only after the boundary evidence above holds:
the retry owns the current parent fence, the prepared record is still the child head, and no child
writer was ever admitted, so nothing can have observed or mutated the missing custody. Re-running a
verified copy then has no external effect and cannot conflict with retained evidence, so this is
convergence rather than blind re-execution. A stale fence or an admitted child writer is refused
before any carrier work.

## Multi-scope writer claims

`claimScopeWriters` admits claims over distinct scopes inside one transaction in canonical
scope-identity order, whatever the request order, and returns handles in request order. Any refusal
rolls back every claim in the request. Each scope follows the single-claim rules.

## Inspection and interchange

`inspectScope` validates fork records in place: a `reference_copy` child must retain its prepared
record right after the origin cut. Its completed record must follow, bound to the same custody,
command intent, and prepared cause. Nothing else may follow before completion, and a trace-only
scope may retain no fork record. The inspection's `world` field reports the base, binding, bound
resource, custody, status, and checkpoint. It is `null` for trace-only scopes. Fork records are
canonical trace records, so read-only reopen and native import reconstruct the same world. Carrier
custody lives under the workspace control root and is not part of a trace archive.

## Conformance boundary

| Contract | Evidence |
| --- | --- |
| Prepared intent precedes custody and completion cites verified custody | `scope-fork.test.ts` |
| Honest checkpoint with and without an associated run | `scope-fork.test.ts` |
| Sibling isolation, nested attenuation, and user-binding preservation | `scope-fork.test.ts` |
| Origin refusal for wrong binding, stale capture, and trace-only captures | `scope-fork.test.ts` |
| Repository and directory resource binding | `scope-fork.test.ts` |
| Crash before admission, after prepared, before completion, lost completion | `scope-fork-recovery.test.ts` |
| Modified, discarded, and absent custody receipts | `scope-fork-recovery.test.ts` |
| Expired parent fence and writer refusal before completion | `scope-fork-recovery.test.ts` |
| Stale fence or admitted child writer refused before physical work | `scope-fork-recovery.test.ts` |
| Deterministic all-or-nothing multi-scope claims | `scope-writer.test.ts` |
| Malformed journal and checkpoint evidence, and concurrent completion replay | `scope-fork-codec.test.ts` |
| Generated fork schema and scope v2 compatibility with v1 | `scope-schema.test.ts` |

Hosted execution, Windows and Linux runs, optimized carriers, and coordinated multi-resource forks
are not claimed.
