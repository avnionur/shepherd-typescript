# Orphaned operation repair research

Status: Phase 4 Task 9 implemented oracle record

## Pinned oracle

- Repository: `https://github.com/shepherd-agents/shepherd`
- Tag: `v0.3.0`
- Revision: `a8196d4c453514836d06bd2fece91a03cdc37107`
- Shepherd sources:
  - `shepherd/packages/dialect/src/shepherd_dialect/cli.py`
  - `shepherd/packages/dialect/src/shepherd_dialect/workspace_control/workspace.py`
- Shepherd tests:
  - `shepherd/packages/dialect/tests/test_run_repair.py`
- vcs-core sources:
  - `vcs-core/packages/core/src/vcs_core/vcscore.py`
  - `vcs-core/packages/core/src/vcs_core/_vcscore_lifecycle.py`
  - `vcs-core/packages/core/src/vcs_core/store.py`
  - `vcs-core/packages/core/src/vcs_core/_store_operation_queries.py`
  - `vcs-core/packages/core/src/vcs_core/_recovery_inventory.py`
- vcs-core tests:
  - `vcs-core/packages/core/tests/integration/vcscore/test_recovery.py`
  - `vcs-core/packages/core/tests/integration/store/test_operations.py`

## Extracted behavior

Upstream activation acquires the cross-process session lock before it detects open operation refs.
Reaching auto-recovery therefore proves the previous session is dead; a live lock owner makes
activation refuse before repair. Manual `run repair` archives orphaned operation refs and reports
an empty second invocation as a clean no-op. The normal run path attempts the same reclaim before
starting and catches every refusal so an entangled recovery state does not turn run start into a
new failure.

An orphaned operation is not an orphaned scope. Operation repair archives reversible bookkeeping
for a dead session. An orphaned scope retains work-in-progress world authority and is reviewed,
merged, discarded, or archived through its own lifecycle. Upstream operation repair fails closed
when recovery inventory reports an unrelated or entangled orphaned scope, interrupted lifecycle,
sibling group, live session, or other blocker. Started provider calls are outside the safe
bookkeeping inference.

Upstream tests pin detection fields (operation identity, world/scope ref, world identity), manual
idempotency, fail-soft auto-reclaim, live-session refusal, scope/operation separation, and recovery
after uncatchable termination. Catchable exceptions, Ctrl-C, and routed SIGTERM unwind the normal
operation boundary and should not create an orphan; SIGKILL/OOM/power loss require later repair.

## Errors, remedies, and public boundaries

The pinned vcs-core mutation guard raises `OrphanedOperationsError` when open operation refs block a
new mutation and names `archive_orphaned_operations()` at the substrate layer. The Shepherd
dialect maps that error to `ORPHANED_OPERATIONS_REMEDY`, which tells the user to run
`shepherd run repair` or start another run for best-effort reclaim; it deliberately does not expose
the lower-layer function name. Manual repair catches `VcsCoreError` and reports that orphaned
operations could not be reclaimed. An entangled orphaned scope reaches the existing scope/readiness
failure (including `OpenScopeError`) and is not converted into operation cleanup authority.

The public upstream boundaries are `list_orphaned_operations()` for inspection,
`archive_orphaned_operations()` for explicit substrate mutation,
`reclaim_dead_orphaned_operations_before_run()` for fail-soft launch integration, and the
`shepherd run repair` CLI wrapper. The TypeScript slice exposes the corresponding typed API and
stable configured error codes but deliberately defers CLI wording/JSON to the CLI issue.

## TypeScript mapping and deliberate strengthening

The TypeScript trace store does not own an upstream Git-ref session lock. It therefore does not
infer death during open. `recordOperationSessionDeath` accepts an exact external proof identity and
keeps live operations blocked until that authority records death. This preserves the upstream
safety premise without pretending elapsed time is proof.

The TypeScript command strengthens idempotency by binding a caller-selected global command ID to a
digest of the complete diagnosis and exact operation set. A durable prepare record makes
interruption diagnosable; deletion and receipt append share one SQLite transaction. Same-command
races converge, different-command races have one winner, and stale or conflicting reuse fails
closed.

The repair table carries no provider, filesystem, Git, custody, settlement, lifecycle, outcome,
cut, or scope mutation columns. Repair can therefore delete only operation bookkeeping. Command
and receipt evidence are canonical trace records and survive native archive v1 export/import;
mutable open-operation rows remain local and are not misrepresented as semantic trace history.
After native import, command and receipt records remain portable audit statements but do not grant
local replay/mutation authority because schema-v8 commit markers are intentionally store-local.

## Compatibility boundary

This slice provides public TypeScript diagnosis and exact repair with L1/P1 behavior parity. It
does not add the `shepherd run repair` CLI, human formatting, stable CLI JSON, process-lock
implementation, automatic OS liveness probing, or orphaned-scope lifecycle commands. Those remain
separate surfaces.
