# Task and run ledger projections

Task/run ledgers are immutable, disposable read models over the durable task registry and trace
store. They do not create records, invoke providers, recover executions, mutate workspaces, or
grant settlement authority.

## Protocol contract

`protocol.config.json` owns projection version `1`, compatibility namespace
`shepherd.task-run-ledgers.v1`, the `@latest` token, selector and pagination bounds, canonical entry
size, stable error codes, and generated task/run entry schemas. Changing those values requires a
new compatible projection contract; existing task, run, trace, output, and settlement identities
are unchanged.

`listTaskLedger` returns registered task artifacts and their recomputed exact locks in canonical
task-ID/version byte order. Callers may supply package-created repository-granted task handles as
a third argument; matching companion artifact and lock evidence then appears in
`repository_grant`. From 13.2.0, declarations stored through `registry.registerGranted` appear
automatically after reopen; supplied companions must agree with persisted evidence. The field is
`null` only when neither source provides a declaration. `limit` and `offset` form a closed bounded pagination
object.

`listRunLedger` returns durable owners that retain exactly one validated creation record. Each
entry includes the original task lock, input, provider descriptor, budget, durable lifecycle and
recovery status, usage, ordered artifacts, terminal outcome, cut, settlements, and task-world
journal. A cut-bounded retained-world output is reconstructed as `output`; ordered
`native_jail_processes` expose validated launch intent, start, and terminal receipt evidence. The
journal transitions carry repository-grant plans, placement/native-jail resolution, and capture
evidence. Absent or incomplete evidence remains explicit; reads never repair it.

## Read selectors

`resolveTaskLedgerSelector` accepts an exact `task-id@version`, a unique task-ID prefix, or
`@latest`. `resolveRunLedgerSelector` accepts an exact run ID, a unique run-ID prefix, or
`@latest`. Exact IDs win before prefix matching. Missing and ambiguous selections raise
`LedgerSelectorNotFoundError` and `LedgerSelectorAmbiguousError` with configuration-owned codes.
For backward compatibility, an already-retained run whose exact ID equals the configured latest
token wins over the alias; mutation APIs never interpret the token.

Task ordering is task-ID then version bytes. Run ordering is creation-record ID then run-ID bytes.
`@latest` means the final entry in the applicable canonical order. This differs deliberately from
upstream timestamp/manifest ordering because the native store has no import-stable global
publication sequence. It never uses wall clock, filesystem time, SQLite row order, or mutable
aliases.

Read selectors are not authority. `SQLiteTaskRegistry.resolve`, durable recovery/control calls,
and every settlement preparation/execution API continue to accept exact identities only.

## Failure and recovery behavior

Malformed, whitespace-containing, or oversized selectors fail with `TypeError`. Pagination rejects
arrays, symbols, accessors, unknown keys, invalid offsets, and limits above configuration. A run
owner with absent or duplicate creation evidence, corrupt lifecycle evidence, or an oversized
canonical projection fails closed. Valid `created`, `started`, terminal-pending-cut, and committed
states are returned without invoking recovery.
SQL pagination bounds the rows decoded for list calls. Prefix resolution is also candidate-bounded
and fails closed when matches exceed the configured maximum.

Native trace export/import preserves all included run evidence and therefore reconstructs the same
projection and selector result. Repository-grant evidence supplied only in memory to a task query
must be supplied again after restart; registered companions and run-journal grants survive normally.
Declarations do not represent effective run grants. See [registry migration and validation](./task-registry.md).

## Public entry points and evidence

- Public exports: [`src/index.ts`](../src/index.ts)
- Task projection: [`src/ledger/task-ledger.ts`](../src/ledger/task-ledger.ts)
- Run projection: [`src/ledger/run-ledger.ts`](../src/ledger/run-ledger.ts)
- Public seam tests: [`test/task/task-run-ledger.test.ts`](../test/task/task-run-ledger.test.ts)
- Pinned oracle: [`.plan/task-run-ledger-research.md`](../.plan/task-run-ledger-research.md)
