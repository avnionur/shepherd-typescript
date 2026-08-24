# Orphaned Operation Diagnosis and Repair

Implementation:
[`src/store/orphan-operations.ts`](../src/store/orphan-operations.ts),
[`src/store/sqlite-trace-store.ts`](../src/store/sqlite-trace-store.ts), and public types under
[`src/repair`](../src/repair). Protocol schemas:
[`spec/schemas/orphan-operation-diagnosis-v1.schema.json`](../spec/schemas/orphan-operation-diagnosis-v1.schema.json),
[`spec/schemas/orphan-repair-command-v1.schema.json`](../spec/schemas/orphan-repair-command-v1.schema.json), and
[`spec/schemas/orphan-repair-receipt-v1.schema.json`](../spec/schemas/orphan-repair-receipt-v1.schema.json).
Tests:
[`test/store/orphan-operation-repair.test.ts`](../test/store/orphan-operation-repair.test.ts) and
[`test/store/orphan-repair-schema.test.ts`](../test/store/orphan-repair-schema.test.ts).

## Authority boundary

An open-operation row is reversible-runtime bookkeeping, not evidence that a provider call, user
file, Git ref/index, retained output, settlement, lifecycle transition, outcome, cut, or scope may
be changed. `recordOpenOperation()` records an exact operation, owner, session, optional scope,
retained cause, optional canonical cause record, and two conservative safety flags. Normal
completion removes that row only through `completeOpenOperation(operationId, sessionId)`.

The store never infers session death from time, silence, process identifiers, or provider state.
An external session-lock or equivalent liveness authority must first prove death and call
`recordOperationSessionDeath({ session_id, death_evidence_id })`. Diagnosis continues to classify
the operation as live until that exact evidence is retained.

Repairability requires all of the following:

- externally proven session death;
- `provider_call_started === false`;
- `scope_owned === false`;
- canonical supported bookkeeping within configured count and byte limits.

A live, unknown-provider, provider-started, scope-owned, stale, changed, malformed, corrupt, or
unsupported operation is never repaired. Scope-owned means the operation is entangled with a
retained work-in-progress world. Repair does not archive or reclaim that scope.

## Read-only diagnosis

`diagnoseOrphanedOperations({ limit, offset })` reads one coherent snapshot. Entries are ordered by
exact operation identity and include owner, session, liveness/death evidence, scope, retained
cause, provider/scope flags, configured blocker codes, and `repairable`. Pagination is bounded,
while `basis_id` always hashes the complete unpaginated open-operation set. Counts distinguish the
complete total, repairable subset, and blocked subset. Diagnosis performs no append or mutation.

The configured maximum open-operation count is a refusal boundary rather than a truncation rule.
Malformed rows and stores exceeding that bound fail closed with `ORPHAN_REPAIR_CORRUPT`.

## Explicit exact repair

An `OrphanRepairCommand` carries a globally idempotent `command_id`, supported version, exact
diagnosis basis, and exact complete operation set. Input order is canonicalized as set identity;
duplicates and open containers are rejected.

Repair has two durable phases:

1. `prepareOrphanedOperationRepair(command)` appends a canonical command record and changes no
   bookkeeping. An interruption here is visible and retryable.
2. `repairOrphanedOperations(command)` replays or prepares that command, takes the configured
   immediate write lock, re-diagnoses the complete basis, requires every operation to be
   repairable and the exact set to match, deletes only those bookkeeping rows, and atomically
   appends a canonical receipt caused by the command record. A private schema-v8 commit marker
   binds that exact command, basis, receipt record, canonical receipt JSON, deterministic append
   intent, and causal edge. A public trace append cannot forge this marker or report false repair
   success.

An empty exact basis produces an idempotent zero-count receipt. Equal retries and concurrent equal
commands return the same receipt. Reusing one command identity for different content raises
`ORPHAN_REPAIR_COMMAND_CONFLICT`; changed evidence raises `ORPHAN_REPAIR_STALE_BASIS`. No terminal
receipt exists unless the bookkeeping deletion and receipt append committed together.

Command and receipt records use ordinary canonical trace records, so successful repair evidence
survives reopen and native trace export/import without changing trace archive v1. Open mutable
bookkeeping is deliberately local store state and is not presented as portable semantic trace
evidence. The private commit marker is also local: imported command/receipt records are portable
audit statements, not authority to replay or mutate repair in the importing store.

## Fail-soft pre-run reclaim

`reclaimOrphanedOperationsBeforeRun(commandId)` diagnoses the complete bounded set, performs exact
repair only when every row is repairable, and returns either `repaired` or `declined`. A refusal or
repair error is captured as a stable code and never becomes an exception that blocks run start.
The exact diagnosis is returned when it can be constructed; corruption that prevents trustworthy
diagnosis returns `diagnosis: null` with the configured corruption code.

This API does not start a run or invoke a provider. CLI presentation remains a separate Phase 4
slice.
