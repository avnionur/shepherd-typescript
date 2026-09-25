# Delegated authority

Implementation: [`src/delegation/authority.ts`](../src/delegation/authority.ts),
[`src/delegation/handle.ts`](../src/delegation/handle.ts), and
[`src/delegation/inspection.ts`](../src/delegation/inspection.ts), reusing
[`src/scope/authority.ts`](../src/scope/authority.ts). Public entry point:
[`src/facades/delegation.ts`](../src/facades/delegation.ts) (`./delegation`). Tests:
[`delegation-laws.test.ts`](../test/delegation/delegation-laws.test.ts) driven by
[`config/delegation-law.config.json`](../config/delegation-law.config.json),
[`child-run.test.ts`](../test/delegation/child-run.test.ts), and
[`delegation-evidence.test.ts`](../test/delegation/delegation-evidence.test.ts). Design
constraints: [task-as-value contract](../.plan/task-as-value-contract.md). Handle mechanics:
[task values and child run handles](./task-values.md).

## Rule

Delegation never amplifies authority. A handle's authority is derived when it opens, retained on
its opened record, and compared by records rather than by identifiers.

| Parent | Resource ceiling | Effective authority | Budget ceiling |
| --- | --- | --- | --- |
| Root declaration | The declared `ceiling` | The requested grant intersected per resource with the ceiling | The declared `budget` |
| Parent handle | The parent's retained effective authority | The requested grant intersected per resource with the parent's effective authority | The parent's retained child budget |

Resource attenuation is the scope rule (`attenuateScopeAuthority`): per requested resource, the
effective atoms are the requested atoms present in the ceiling, in configured atom order. A
requested resource absent from the ceiling fails closed with `DelegationAuthorityError` before the
handle opens; an atom the ceiling lacks is attenuated away rather than refused.

Budget attenuation: every metric the parent declares must be declared by the child with a value
no greater than the parent's. A child may declare additional metrics. A missing or larger metric
fails closed with `DelegationAuthorityError` before any record. The opened record retains both the
child `budget` and the `budget_ceiling`; inspection exposes them as `budget.effective` and
`budget.ceiling`.

## Nesting

The first handle under a root declaration has depth one; a handle opened under a parent handle
has the parent's depth plus one. `limits.maxNestingDepth` bounds the chain and a deeper opening is
refused before any record. The parent handle is verified at opening: it must be a package-minted
handle of the same store, its retained opened record must match, and its derived status must not
be `rejected` or `discarded`. The origin cut is published through the parent handle head inside
the opening transaction.

A program-serviced child receives its authenticated handle and may open grandchildren only under
its own effective authority; forged or foreign handles are refused with `TypeError`.

## Record-proven inspection

`inspectChildRun` re-derives the effective authority from the retained ceiling and grant and
refuses evidence that disagrees. For a handle parent it folds the parent handle and refuses a
ceiling that differs from the parent's effective authority, a budget ceiling that differs from the
parent's child budget, or a depth that is not the parent's plus one. Budget attenuation is
re-checked from the retained values. Every refusal is `DelegationEvidenceError`.

### Proof envelope

`inspectChildRun` exposes `proof`, derived from the child run's inspection envelope. A retained
supervisor handoff forwards publication authority, so a handle with at least one handoff classifies
as the configured `extension` profile with the `forwarding` publication control. Normative rules:
[inspection envelopes](./formal-assurance.md#inspection-envelopes). Tests:
[`delegation-review.test.ts`](../test/delegation/delegation-review.test.ts).

## Laws

The seeded reference-model suite builds random handle trees across a root ceiling and nested
program-serviced children with random grants and budgets and checks, for every opened handle, that
effective authority is contained in the grant, in the parent's effective authority, and in the
ceiling; that the budget is contained in the parent's budget; that the retained ceiling equals the
parent's effective authority; and that every grant naming a resource outside the parent's
authority or every budget exceeding a parent metric is refused before opening. The same
inspections hold after export and import.
