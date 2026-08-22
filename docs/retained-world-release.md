# Receipt-Only Retained-World Release

Implementation:
[`src/workspace/retained-world-settlement.ts`](../src/workspace/retained-world-settlement.ts),
[`src/store/retained-world-settlement-codec.ts`](../src/store/retained-world-settlement-codec.ts),
and [`src/store/retained-world-settlements.ts`](../src/store/retained-world-settlements.ts).
Public entry point: [`src/index.ts`](../src/index.ts). Production-seam evidence:
[`test/workspace/retained-world-release.test.ts`](../test/workspace/retained-world-release.test.ts)
and
[`test/workspace/retained-world-release-schema.test.ts`](../test/workspace/retained-world-release-schema.test.ts).

`releaseRetainedWorldSettlement` consumes one exact retained output as deliberately released
without selecting, applying, deleting, or moving it. The caller supplies the package-created
binding, carrier, exact output identity, and trace store. The coordinator revalidates the committed
execution and capture evidence, immutable base/head revisions, canonical changeset, mutable
custody, and current binding authority.

## Receipt-only behavior

Release permits the current user world to differ from the candidate fork basis. Immediately before
terminalization it snapshots the current binding without mutation and records that content identity
in the deterministic operation before `applying`, then copies it into equal `user_basis_before`
and `user_basis_after` receipt witnesses. It retains the closed release receipt and publishes the
terminal execution
citation. The snapshot may publish immutable evidence for the observed current basis; release does
not publish candidate content into the user binding and performs no custody mutation or cleanup.

The terminal result cites the binding, base/head revisions, existing custody, changeset, operation,
request, output, protocol/compatibility versions, and observed basis. `inspectRetainedWorldRelease`
reconstructs the same
frozen result from durable trace, journal, operation, and receipt evidence without reading carrier
or user files. The existing carrier authority can still reopen and verify custody; released
changeset/revision evidence remains readable after restart.

## Recovery and consume-once authority

An interruption before the terminal receipt leaves the journal `applying`; exact retry
re-authenticates custody, observes the then-current basis, and completes one receipt. An
interruption after terminal retention but before citation publication replays the retained receipt
and repairs only the citation. Concurrent connections and fresh processes converge on the same
operation and receipt. Once released, select, apply, discard, and a different release admission
conflict.

Missing, discarded, substituted, corrupt, cross-binding, or content-inconsistent custody fails
closed before a release receipt. Release does not make a new handle, expose a custody path, infer
success from current bytes, or claim a physical handoff phase.

## Boundary

Workspace protocol v25 adds `release`/`released` and a generated closed release-receipt schema.
Existing select, discard, apply, settlement-operation, citation, trace-store schema-v7, and
task-world journal-v1-v4 identities remain unchanged. CLI release, selector compatibility, and
orphan repair remain later Phase 4 work.
