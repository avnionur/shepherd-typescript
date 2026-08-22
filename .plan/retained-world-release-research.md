# Retained-World Release Research

Status: implemented in `1.42.0` as workspace protocol v25.

## Pinned oracle

The behavioral oracle is Shepherd `v0.3.0` at revision
`a8196d4c453514836d06bd2fece91a03cdc37107`.

Reviewed entry points and evidence:

- `vcs-core/packages/core/src/vcs_core/_retained_output_settlement_ops.py`;
- `vcs-core/packages/core/src/vcs_core/_retained_output_settlement.py`;
- `vcs-core/packages/core/src/vcs_core/_retained_output_queries.py`;
- `shepherd/packages/dialect/src/shepherd_dialect/workspace_control/workspace.py`;
- `shepherd/packages/dialect/src/shepherd_dialect/workspace_control/run_outputs.py`;
- `vcs-core/packages/core/tests/integration/session/test_seal_lifecycle.py`;
- `shepherd/packages/dialect/tests/test_workspace_control_public_surface.py`.

## Verified behavior

`release` is a receipt-only terminal settlement. It is not a filesystem handoff, carrier move, or
cleanup operation. Release and discard share the same upstream coordinator, but release preserves
retained custody while discard represents deliberate disposal. Released output content and its
changeset remain readable after settlement and process reactivation.

The returned upstream settlement result contains the retained scope, matching live parent,
output-world identity, equal parent-world before/after identities, and a terminal receipt. The
receipt cites scope, parent, seal handoff, output world, binding/store/resource, candidate, action,
deterministic operation, parent before/after, and settlement reference. Release carries no
authority-decision evidence and no applied head.

Receipt-only settlement allows the parent binding to advance after the child fork. It validates
retained custody, a live matching parent, binding identity, current readable parent world, and the
absence of an existing terminal receipt. Its deterministic operation identity includes the action,
parent, handoff, scope instance, binding, candidate, output world, fork-basis world, and settlement
reference. `released` and `discarded` therefore cannot alias.

Before writing a receipt-only terminal, upstream probes for interrupted select and apply
publication. If either published its world without its receipt, recovery completes that original
receipt and release refuses; it never creates a second terminal result. Once any receipt exists,
all settlement verbs refuse. Upstream repeated release reports already-settled.

## TypeScript contract

The TypeScript public workflow retains its existing separate exact-ID preparation step and
idempotent equal replay. Release authenticates the committed execution, candidate revisions,
changeset, mutable custody, and current package-created binding. It observes the current user basis
once and binds it into the deterministic operation before `applying`, records equal before/after
witnesses in the receipt, and publishes the existing terminal execution citation. A released replay uses the retained basis
witness and does not require the current parent to remain unchanged.

No new carrier authority or path is returned. The result cites the existing custody, head revision,
changeset, operation, request, output, and basis witnesses. Missing or corrupt custody fails before
terminalization. Existing consume-once admission prevents release from coexisting with a prepared,
applying, or terminal select/apply/discard decision.

## Explicit non-claims

This slice does not implement physical custody transfer, custody cleanup, parent publication,
textual merge, CLI settlement commands, or orphan repair. It does not claim private upstream record
identity. Native Windows remains unsupported; upstream Python remains an oracle, not a dependency.
