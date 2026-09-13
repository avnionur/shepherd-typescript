# Scope vocabulary mapping

Implementation: [`src/scope/vocabulary.ts`](../src/scope/vocabulary.ts). Configuration:
`scopes.vocabulary` in [`protocol.config.json`](../protocol.config.json). Public entry points:
`projectScopeVocabulary`, `SCOPE_VOCABULARY_TERMS`, `SCOPE_VOCABULARY_STATUSES`, and
`SCOPE_VOCABULARY_VERSION` from [`src/facades/scopes.ts`](../src/facades/scopes.ts) and
[`src/index.ts`](../src/index.ts). Tests:
[`scope-vocabulary.test.ts`](../test/scope/scope-vocabulary.test.ts). Contract: the vocabulary
section of the [scope ownership/authority proposal](../.plan/scope-ownership-contract.md).

## Scope

Upstream Shepherd names child lifecycle steps `spawn`, `adopt`, `abandon`, and `publish`.
`projectScopeVocabulary(store, scopeId)` maps those terms onto one scope's retained scope evidence
as a disposable, validated read. It appends nothing, grants no authority, adds no command aliases,
and returns the same value after reopen, read-only reopen, and native import. Scope protocol v4
appends only the configured terms, statuses, and projection version.

## Mapping

| Term | Evidence | Status | Not |
| --- | --- | --- | --- |
| `spawn` | Parent-owned child-registration record for a trace-only child or a reference-copy fork | `pending` while the fork is incomplete, otherwise `completed` | A run or process launch |
| `adopt` | Parent integration of a completed [consume-once merge](./scope-merge-discard.md) selecting the verified child cut | `pending` while the merge is only reserved, citing the reservation | User-workspace materialization |
| `abandon` | The child's discard decision whose subtree root is that child | `completed`, with `cleanup_phase` reported separately | Custody deletion |
| `publish` | One exact contribution (owner, ordinal, record) made parent-visible by a completed merge | `completed` | Settlement publication to a user tree |

Entries follow the parent path order for spawn, adopt, and publish, then list each child's pending
adopt or abandon in registration order. A child sealed because its own parent was discarded is not
reported as abandoned by that parent; the abandonment appears once, on the discarded subtree
root's parent.

## Boundary with version-1 projections

The execution-history `spawned`, `adopted`, `abandoned`, and published-record projections keep
their version-1 semantics. Scope records are never interpreted as those relations, and those
projections produce no entries from scope owner paths. The vocabulary mapping likewise never reads
execution-relation records.

## Conformance boundary

| Contract | Evidence |
| --- | --- |
| Spawn, adopt, publish, and abandon mapping with exact citations | `scope-vocabulary.test.ts` |
| Abandon without cleanup and adopt without user publication | `scope-vocabulary.test.ts` |
| Pending reserved merges and incomplete forks | `scope-vocabulary.test.ts` |
| Ancestor seals are not abandonment | `scope-vocabulary.test.ts` |
| Read-only reopen and import equality; version-1 projections unchanged | `scope-vocabulary.test.ts` |
| Configuration drift and scope v4 compatibility | `protocol-config.test.ts`, `scope-schema.test.ts` |

Attached children and adapters that issue new commands from the vocabulary are not claimed.
