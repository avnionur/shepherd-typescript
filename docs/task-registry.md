# Task Registry

Implementation:
[`src/task/sqlite-task-registry.ts`](../src/task/sqlite-task-registry.ts),
[`src/task/registry-codec.ts`](../src/task/registry-codec.ts), and
[`src/task/registry-migrations.ts`](../src/task/registry-migrations.ts). Public exports:
[`src/index.ts`](../src/index.ts) and package subpath
`@avnionur/shepherd-typescript/tasks`. Tests:
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
validated `protocol.config.json` values locked by task-protocol-v2 compatibility constants.

Each resolution decodes the retained canonical artifact, recomputes its artifact and schema
digests, reconstructs the exact lock, and verifies the stored digest and primary-key fields.
Malformed or corrupt retained values throw `TaskRegistryError` rather than returning an unverified
registration.

Passing `{ readOnly: true }` opens only an existing current-schema registry. It skips writable
PRAGMAs and migrations and fails closed for absent or older schema state. CLI task reads use this
boundary.

## Boundary

Resolution is exact: there is no `latest`, active-version alias, range selection, or fallback.
The registry does not execute tasks, validate task inputs or outputs, grant authority, invoke a
provider, or append execution records to the trace store.

## Repository declaration companions (13.2.0)

`registry.registerGranted(grantTaskRepositories({ task: descriptor, grants }))` atomically stores
an authenticated declaration with its exact task artifact. The returned `TaskRegistration` includes
`repositoryGrant`; ordinary registrations omit that property. The existing task artifact and its
lock remain unchanged. Companion declarations are immutable for a registered version: equal retry
succeeds; changing a profile or adding declarations to a version already registered without them
throws `TaskVersionConflictError`. Use a new task version for a different declaration. Calling
ordinary `register` for an already granted task preserves the declaration.

Resolution and ledger reads reconstruct the configured grant artifact from the validated task,
then compare the complete retained companion and content-addressed lock. Forged runtime handles,
stale task digests, mismatched profiles/locks, unsupported versions and corrupt JSON fail closed.
These content-addressed declarations are not signatures against an attacker rewriting the entire
registry; protect the registry file using the existing owner-only custody boundary.

Registry schema 2 adds one nullable companion column in the same atomic row. Writable open migrates
schema 1, retaining existing task bytes and leaving declarations absent. Read-only CLI opens never
migrate; open the registry writable with this release before inspecting an older registry. Older
binaries refuse the newer schema. No runtime task, trace or grant-plan format changes.

`task show` and `task resolve` expose the persisted declaration in stable JSON and print instruction,
input/output schemas and profiles in human output. Names are logical declarations; only per-run
admission resolves exact repository resources, ceilings, effective atoms and enforcement. Inspection
never constructs an execution grant plan or invokes a provider. Optional in-memory ledger evidence
continues to work for ordinary registrations; it must agree with any persisted declaration.

Implementation: [`registry-grants.ts`](../src/task/registry-grants.ts). Evidence:
[`registry-grants.test.ts`](../test/task/registry-grants.test.ts) and the installed-package
[`task-grant-cli.ts`](../tooling/testing/task-grant-cli.ts) gate. See
[repository grants](./repository-grants.md) for execution authority.
