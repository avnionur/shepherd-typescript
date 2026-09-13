# Consume-once scope merge and discard

Implementation: [`src/workspace/scope-merge.ts`](../src/workspace/scope-merge.ts) and
[`src/workspace/scope-discard.ts`](../src/workspace/scope-discard.ts), with options in
[`src/workspace/scope-terminal-types.ts`](../src/workspace/scope-terminal-types.ts). Record codecs:
[`src/scope/terminal-records.ts`](../src/scope/terminal-records.ts). Store transactions:
[`src/store/scope-terminals.ts`](../src/store/scope-terminals.ts). Carrier publication and identity
cleanup: [`src/workspace/reference-copy-carrier.ts`](../src/workspace/reference-copy-carrier.ts).
Public entry points: `mergeScope` and `discardScope` from
[`src/facades/workspace.ts`](../src/facades/workspace.ts); the terminal types, phases, and errors
from [`src/facades/scopes.ts`](../src/facades/scopes.ts); all of them from
[`src/index.ts`](../src/index.ts). Schemas:
[`scope-merge-v1`](../spec/schemas/scope-merge-v1.schema.json),
[`scope-child-merged-v1`](../spec/schemas/scope-child-merged-v1.schema.json), and
[`scope-discard-v1`](../spec/schemas/scope-discard-v1.schema.json). Tests:
[`scope-merge.test.ts`](../test/scope/scope-merge.test.ts),
[`scope-discard.test.ts`](../test/scope/scope-discard.test.ts),
[`scope-terminal-recovery.test.ts`](../test/scope/scope-terminal-recovery.test.ts), and
[`scope-terminal-codec.test.ts`](../test/scope/scope-terminal-codec.test.ts). Contract: the Phase 6
[scope ownership/authority proposal](../.plan/scope-ownership-contract.md), slice C.

## Scope

A child scope ends in exactly one terminal decision. `mergeScope` consumes a quiescent child into
its owning parent: the child's world delta is published into parent-managed custody and its
selected history becomes parent-visible. `discardScope` seals an owned child subtree and removes
only its proven-owned custody while the parent keeps its current state. Neither operation writes a
user workspace. Publishing to a user tree is still the separately authorized
[retained settlement](./retained-world-settlement.md) with its unchanged exact outputs.

Scope protocol v3 appends the `merge` and `discard` command kinds, the merge and discard journal
phases, six evidence kinds, three trace schemas, the merge-cut identity prefix, the contribution
and discard-subtree bounds, and the `SCOPE_MERGE_CONFLICT`, `SCOPE_NOT_QUIESCENT`, and
`SCOPE_TERMINAL_CONFLICT` errors. Every v1 and v2 value keeps its position and meaning. No store
migration is required: the existing `state` column now records `merged` and `discarded`.

## Branch state and evidence

| Record | Owner path | Causes | Meaning |
| --- | --- | --- | --- |
| merge cut (`kernel.cut.owner-prefix.v1`) | child | child head | Immutable child cut `scope-merge:<hex>` fixed by the merge command |
| `shepherd.scope.merge.v1` prepared | child | merge cut | Consume-once reservation: parent and child heads, three-way world plan, and contributions |
| `shepherd.scope.child_merged.v1` | parent | parent head, reservation | Integration citing the child cut once, the child checkpoint, contributions, and publication receipt |
| `shepherd.scope.merge.v1` completed | child | reservation | Seal citing the verified parent publication revision |
| `shepherd.scope.discard.v1` decided | each sealed scope | that scope's head | Logical decision; the subtree root lists sealed scopes and owned custody identities |
| `shepherd.scope.discard.v1` cleaned | subtree root | decision | Cleanup progress naming the exact custody identities removed |

The branch state (`open`, `merged`, `discarded`) is derived from these records. `inspectScope`
reports it together with `terminal`, the latest merge or discard phase. A prepared merge is in
flight, not a terminal state. Integrity verification checks every live registration row's state
against the retained terminal evidence.

## Merge admission

The caller supplies the parent writer, the child writer, both exact current heads, a globally
idempotent command identity, and the carrier when the child owns reference-copy custody.

- **Ownership and quiescence.** The child must be open and owned by the parent, with a complete
  fork and only merged or discarded children. An unresolved grandchild fails with
  `ScopeQuiescenceError`. Both writer fences must be current.
- **Three-way plan.** For a reference-copy child the parent must own reference-copy custody and
  effective `write` authority on the bound resource. A trace-only parent fails with
  `ScopeEvidenceError`, and missing write authority fails with `ScopeAuthorityError`. The merge
  opens the common origin (the child's fork base), captures the child custody, and captures the
  current parent custody as immutable revisions. It then compares both deltas from the origin with
  the settlement application's portable conflict classifier. Equal paths, portable aliases, and
  ancestor/descendant paths fail with `ScopeMergeConflictError` carrying content-addressed
  evidence. Nothing is retained, so neither scope is consumed. Disjoint changes build an immutable
  merged revision in protected carrier custody. Unsupported objects fail closed during capture.
- **Selected history.** A scope's selected history is its own emissions plus the contributions
  of its completed child merges, in path order, each exact occurrence (owner, ordinal, record)
  once. The merge contributes the child's selected history minus occurrences the parent already
  selects. Common-origin history lives on the parent path and is never re-added. Grandchild
  contributions arrive once, through their parent's merge. Equal data emitted twice stays two
  distinct occurrences. Record identities and provenance are unchanged.
- **Single winner.** One transaction publishes the merge cut through the child head and retains
  the reservation. Afterwards the child refuses emission, child registration, discard, and
  competing merges with `ScopeTerminalConflictError`. The parent refuses emission, child
  registration, forks, and further merges with `ScopeQuiescenceError` until the merge completes.
  Writer claims on a reserved child stay admissible so a restarted process can resume.

## Publication and completion

Before any carrier work, and on every retry, a read transaction requires positive boundary
evidence. The parent must be open under its exact current fence at the reserved parent head, and
the child must be open with the reservation as its head. The carrier then applies the planned
changes (current parent revision to merged revision) to the parent custody. A path already in its
merged state is skipped, a path in its current-parent state is replaced from the merged revision,
and any third state fails with `WorldCarrierError`. The merge completes only when the parent
custody verifies as exactly the merged content; otherwise it fails with `ScopeEvidenceError`. The
parent custody is captured again as an immutable publication receipt. One transaction then appends
the parent integration and the child seal and records the child as `merged`. The protected
application custody is discarded afterwards.

A trace-only child merge has no world plan and no publication. The merge is purely the
selected-history integration.

## Discard

The caller supplies the owning parent's writer, the subtree root and its exact head, a command
identity, and optionally a carrier.

- **Admission.** The parent must be open under its current fence. The subtree root must be an
  open owned child without a reserved merge. Merging an already discarded child, or discarding a
  merged or reserved child, fails with `ScopeTerminalConflictError`. Roots have no owning parent
  and cannot be discarded. Every open scope in the subtree must hold no unreleased writer claim,
  even an expired one, because lease expiry does not prove a process stopped. A holder that cannot
  release is superseded by a new claim and released, otherwise `ScopeQuiescenceError`. The subtree
  may contain at most the configured number of scopes.
- **Logical decision.** One transaction appends a decision record to every open scope in the
  subtree and records them `discarded`. Merged and already discarded descendants keep their
  evidence. A descendant's in-flight fork or merge can never complete afterwards, because every
  completion requires open scopes. The parent's head, custody, and selected history are unchanged.
  Discard is not a rollback to fork time. Scope evidence carries application data only, so no
  escaped external effect exists to reverse.
- **Cleanup.** The decision names every custody identity of the subtree, read from each scope's
  retained fork journal, never from a directory scan. With a carrier, cleanup discards each
  identity: a discard marker is retained first, then any custody tree is verified and removed, and
  an identity never published is tombstoned. A cleanup record follows under the parent's current
  fence. Without a carrier, or after an interrupted cleanup, the receipt reports the `decided`
  phase and the same command resumes cleanup later. Cleanup of a scope whose parent has since
  been sealed stays `decided`; the ancestor's discard lists and removes the same identities.

## Replay and restart recovery

Every command identity binds one normalized request. Reusing it for different parents, scopes, or
heads, or for another command kind, fails with `AppendIntentConflictError`.

| Interrupted | Retained evidence | Retry behavior |
| --- | --- | --- |
| Before the reservation | Plan revisions only | Plans again and reserves |
| After the reservation | Merge cut and reservation | Re-checks the boundary, publishes from the retained plan, completes |
| During or after publication | Reservation and a publication prefix | Converges path by path, verifies, completes |
| After completion, response lost | Integration and seal | `readScopeCommandReceipt` returns the original receipt |
| Before the discard decision | Nothing | Decides normally |
| After cleanup, before its record | Decision and removed custody | Discards the identities again idempotently and retains the cleanup |

Recovering a reserved merge after restart claims fresh parent and child writers. A merge or
discard receipt is returned without any fence once its evidence is retained. A completed merge is
sealed: a restarted caller reads its receipt instead of re-admitting it.

## Conformance boundary

| Contract | Evidence |
| --- | --- |
| Disjoint merge into current parent custody, receipt replay, import equality | `scope-merge.test.ts` |
| Trace-only merge, common-origin exclusion, nested deduplication, distinct repeated occurrences | `scope-merge.test.ts` |
| Equal-path and structural overlap refusal without consuming either scope | `scope-merge.test.ts` |
| Missing custody, write authority, carrier, ownership, stale heads and fences | `scope-merge.test.ts` |
| Concurrent merges admit exactly one winner | `scope-merge.test.ts` |
| Current parent preserved after discard, nested subtree discard, owned custody cleanup | `scope-discard.test.ts` |
| Logical discard without a carrier and resumed partial cleanup | `scope-discard.test.ts` |
| Discard-after-merge, reserved merge, unreleased writers, roots, subtree bound | `scope-discard.test.ts`, `scope-terminal-recovery.test.ts` |
| Crashes before and after each trace and carrier boundary | `scope-terminal-recovery.test.ts` |
| Third-state and unverifiable parent custody stay blocked; prefix convergence | `scope-terminal-recovery.test.ts` |
| Ancestor discard seals a reserved merge; incomplete fork discard | `scope-terminal-recovery.test.ts` |
| Malformed and forged terminal evidence, integrity of row state, in-store replay | `scope-terminal-codec.test.ts` |
| Generated merge, child-merged, and discard schemas; scope v3 compatibility | `scope-schema.test.ts` |

Attached children, scheduling integration, optimized carriers, multi-resource merges, user
workspace publication, and hosted or cross-platform execution are not claimed by this slice.
