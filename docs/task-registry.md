# Task Registry

Implementation:
[`src/task/sqlite-task-registry.ts`](../src/task/sqlite-task-registry.ts),
[`src/task/registry-codec.ts`](../src/task/registry-codec.ts), and
[`src/task/registry-migrations.ts`](../src/task/registry-migrations.ts). Public exports:
[`src/index.ts`](../src/index.ts). Tests:
[`test/task/registry.test.ts`](../test/task/registry.test.ts),
[`test/task/registry-validation.test.ts`](../test/task/registry-validation.test.ts),
[`test/task/registry-persistence.test.ts`](../test/task/registry-persistence.test.ts), and
[`test/task/registry-migrations.test.ts`](../test/task/registry-migrations.test.ts).

## Exact registration

`SQLiteTaskRegistry` durably associates one stable task ID and exact caller-declared version with
one canonical artifact and verified artifact lock. Registration accepts descriptors created by
`task()` and validates their artifact and lock before opening a write transaction.

```ts
using registry = new SQLiteTaskRegistry("tasks.sqlite");
const registration = registry.register(writeNote);

registry.resolve({
    taskId: registration.artifactLock.task_id,
    version: registration.artifactLock.task_version,
});
```

Equal re-registration is idempotent. Registering different artifact content under the same task
ID/version throws `TaskVersionConflictError` and retains the original registration. `resolve()`
returns `undefined` only for a valid exact reference that is absent.

## Durability and verification

The registry uses a separately versioned SQLite schema. Its WAL, FULL synchronization, IMMEDIATE
transaction, defensive-mode, foreign-key, timeout, default-path, and migration settings come from
validated `protocol.config.json` values locked by task-protocol-v1 compatibility constants.

Each resolution decodes the retained canonical artifact, recomputes its artifact and schema
digests, reconstructs the exact lock, and verifies the stored digest and primary-key fields.
Malformed or corrupt retained values throw `TaskRegistryError` rather than returning an unverified
registration.

## Boundary

Resolution is exact: there is no `latest`, active-version alias, range selection, or fallback.
The registry does not execute tasks, validate task inputs or outputs, grant authority, invoke a
provider, or append execution records to the trace store.
