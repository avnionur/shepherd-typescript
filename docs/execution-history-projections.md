# Execution-History Projections

Implementation:
[`src/projection`](../src/projection). Store facade:
[`SQLiteTraceStore`](../src/store/sqlite-trace-store.ts). Public exports:
[`src/index.ts`](../src/index.ts). Tests:
[`test/projection`](../test/projection).

## Projection boundary

Execution history is a disposable, reproducible view over immutable trace slices. Projection does
not add tables, mutate records, or become more authoritative than retained lifecycle, relation,
publication, and cut evidence.

The configured projection requires `mode_filter: "both"` because creation is a declaration while
lifecycle transitions are captures. It also requires payload-visible `payload` or `full_internal`
slices. `shape_only` and mode-filtered slices throw `ProjectionCompatibilityError`.

## Execution lifecycle

`projectExecution(slice, executionId, cut?)` folds configured lifecycle schemas in owner-ordinal
order:

- creation captures task reference, parent, and inputs, then sets `pending`;
- start sets `running` and records its identity;
- completion captures outputs, clears failure, and sets `succeeded`;
- failure clears outputs, captures error text, and sets `failed`.

Lifecycle records explicitly naming another execution are ignored. Unknown schemas remain retained
but do not alter lifecycle state. Schema-specific records require object payloads and fail closed
when malformed. Optional inputs and outputs default to empty frozen objects when not objects,
matching the pinned upstream schema projection.

`SQLiteTraceStore.projectExecution(cutId)` resolves the published owner prefix using both modes and
payload visibility, then returns a deeply frozen execution value. Later owner records cannot alter
the projection at that cut.

## Relations and effective children

`projectExecutionRelations(slice, parentExecutionId)` retains every configured parent-owned
relation transition in owner order. Relationship identities may transition among `spawned`,
`adopted`, and `abandoned`.

The pinned relation schema names its immutable child address `child_frontier_id`. The TypeScript
projection exposes that value as `child_cut_id` because this implementation's public read-address
type is `Cut`; the retained record wire shape is not rewritten.

`activeExecutionRelations(relations)` selects the latest transition for each relation identity.
Latest `spawned` and `adopted` transitions are active; latest `abandoned` transitions remain in
history but do not select a child.

`projectEffectiveHistory(rootSlice, rootExecutionId, childSlices?)` combines:

- the projected root execution;
- every retained parent relation transition;
- active children whose immutable child-cut slices were supplied;
- configured parent-published semantic records.

The pure projector skips an active child when its slice is not supplied.
`SQLiteTraceStore.projectEffectiveHistory(cutId)` is stricter: it resolves every active non-null
child cut and fails if required retained evidence is unavailable or targets a different execution.
Duplicate supplied child-cut slices are rejected instead of being selected by input order.

## Published records

Parent records using the configured publication schema project to `PublishedRecord` values with
their record identity, kind, and frozen structured data. Malformed optional data defaults to an
empty object. A publication record without an object payload is corrupt projection evidence and
fails closed.

## Configuration and compatibility

Projection schema references, relation kinds, active relation kinds, mode requirement, and
payload-capable visibility profiles live under `projections.executionHistory` in
[`protocol.config.json`](../protocol.config.json). Structural validation ties requirements to
configured query capabilities. Immutable projection-v1 constants prevent silently redefining an
existing lifecycle or relation fold. Store projection reads derive their mode and visibility
options from this validated contract.
