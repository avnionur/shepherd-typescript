# Scope algebra laws

Reference model: [`test/scope/scope-reference-model.ts`](../test/scope/scope-reference-model.ts).
Law suite: [`test/scope/scope-laws.test.ts`](../test/scope/scope-laws.test.ts). Configuration:
[`config/scope-law.config.json`](../config/scope-law.config.json).

## Scope

The law suite checks the durable scope algebra against an executable, pure reference model. The
model is intentionally small: logical worlds are maps from flat paths to contents, and selected
histories are ordered token lists. It implements `fork` (trace-only or world), `emit`, world
`write` and `delete`, `merge`, and `discard`. Model and implementation must agree after every
operation on every scope's state, every open world's exact files, every selected history in order,
and every refusal class. The model and suite are repository verification assets, not published
package API.

## Model semantics

| Operation | Reference behavior | Refusal classes, in admission order |
| --- | --- | --- |
| `fork` | New open child; a world child copies the parent world, or the binding snapshot under a trace-only parent, as its origin | `terminal` when the parent is not open |
| `emit` | Appends a token to the scope's selected history | `terminal` when the scope is not open |
| `write`, `delete` | Changes the open world scope's own map only | none |
| `merge` | Applies the child's changes from its origin to the parent world and appends child tokens the parent lacks; seals the child | `terminal`, then `evidence` (world child into a parent without a world), then `conflict` (child and parent changed a common path since the origin), then `quiescence` (an open grandchild) |
| `discard` | Seals the open subtree; the parent and ancestors are unchanged | `terminal` when the parent or target is not open |

## Laws

Generated sequences check these laws continuously; explicit cases pin the laws that random
sequences reach only rarely.

- Unmerged siblings are isolated: every open world equals its own model world, independently of
  sibling writes, merges, and discards.
- Merging disjoint deltas equals the reference three-way result, and disjoint sibling merges
  commute (explicit case, compared by verified world content identity).
- An overlapping merge is refused and leaves both scopes and both worlds unchanged.
- A discard leaves the current parent and every ancestor unchanged, not rolled back to fork time.
- Nested merges integrate each occurrence once, common-origin history is never re-added, and
  repeated emissions stay distinct.
- Terminal decisions are consume-once: later merges, discards, emissions, and forks on a sealed
  scope are refused as `terminal`.
- Replay is stable: every `restartEvery` operations the store is closed and reopened, and every
  scope inspection must be byte-for-byte equal across the restart.

## Generation and failure reporting

Operations are drawn from a seeded deterministic generator. Seeds, sequence length, and restart
interval come from configuration. Targets are drawn from all known scopes, so refusals are
generated on purpose. A failure names the carrier, the seed, the failing step, and the complete
operation prefix, so it can be replayed exactly.

## Carriers

Each generated sequence runs once per registered carrier factory against the same model. The
reference copy carrier always runs. Optimized carriers join the same suite only after passing
their own conformance gates; see the Phase 6 exit audit for the carriers exercised in each run.

## Boundary

Provider and process state, attached children, and interleavings beyond the store's immediate
transactions are outside the model. Structural path conflicts, portable aliases, and unsupported
filesystem objects are covered by the merge and carrier suites rather than this flat-path model.
