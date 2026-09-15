# Task values and child run handles

Implementation: [`src/task/value.ts`](../src/task/value.ts),
[`src/task/value-codec.ts`](../src/task/value-codec.ts),
[`src/delegation/handle.ts`](../src/delegation/handle.ts),
[`src/delegation/inspection.ts`](../src/delegation/inspection.ts),
[`src/delegation/records.ts`](../src/delegation/records.ts), and
[`src/store/delegation-handles.ts`](../src/store/delegation-handles.ts). Public entry point:
[`src/facades/delegation.ts`](../src/facades/delegation.ts) (`./delegation`), with the task value
helpers also on [`src/facades/tasks.ts`](../src/facades/tasks.ts) (`./tasks`) and root exports from
[`src/index.ts`](../src/index.ts). Configuration: `delegation`, `tasks.schemas.valueId`, and
`providers.program` in [`protocol.config.json`](../protocol.config.json). Tests:
[`task-value.test.ts`](../test/task/task-value.test.ts),
[`child-run.test.ts`](../test/delegation/child-run.test.ts),
[`delegation-evidence.test.ts`](../test/delegation/delegation-evidence.test.ts),
[`delegation-contract.test.ts`](../test/delegation/delegation-contract.test.ts),
[`delegation-review.test.ts`](../test/delegation/delegation-review.test.ts),
[`delegation-conformance.test.ts`](../test/delegation/delegation-conformance.test.ts), and
[`delegation-crash.test.ts`](../test/delegation/delegation-crash.test.ts) with the
[process fixture](../test/fixtures/delegation-process.ts). Design constraints:
[task-as-value contract](../.plan/task-as-value-contract.md). Authority rules:
[delegated authority](./delegated-authority.md). Phase evidence:
[Phase 9 exit audit](../.plan/phase-9-exit-audit.md).

## Task values

A task value is the canonical serializable form of a task descriptor: `{ artifact, artifact_lock }`,
exactly the pair a registry registration retains. It carries no code and nothing in it is ever
evaluated; the only executors are the configured provider path and a caller program running under
a durable child run.

| Function | Behavior |
| --- | --- |
| `readTaskValue(value)` | Accepts a plain data object with exactly `artifact` and `artifact_lock`, validates the artifact in the supported schema grammar and protocol version, re-derives the lock from the artifact, and refuses any mismatch, extra key, accessor, or foreign schema document |
| `taskValueOf(descriptor)` | Returns the value of a descriptor created by `task()`; foreign descriptor objects are refused |
| `taskDescriptorOf(value)` | Rehydrates an authenticated descriptor through `schema.fromJSONSchema` and `task()` and asserts the recomputed artifact and lock equal the value's; a value whose artifact is not in builder-normalized form (for example an unsorted `required` list) is refused rather than renormalized |

`schema.task()` is the fifth schema kind. Its document is `{ "$ref": <tasks.schemas.valueId> }`,
the published [`task-value-v1`](../spec/schemas/task-value-v1.schema.json) identifier, so a task
can accept a task as input or emit one as output without embedding the descriptor grammar in
every artifact. `schema.fromJSONSchema` maps that exact document back to `schema.task()` and
refuses any other `$ref`; parsing validates through `readTaskValue`. The published
[`task-descriptor-v1`](../spec/schemas/task-descriptor-v1.schema.json) schema admits the reference
wherever a task schema document is allowed, and the task value schema inlines the descriptor and
lock grammar.

## Child run handles

`openChildRun(store, options)` names one delegated execution of one task value under one
supervisor. The handle identity is derived from the opening command (`delegation:sha256:…`) and is
the handle's reserved trace owner path; the child run identity is derived from the handle
(`delegation-run:sha256:…`) and is an ordinary durable execution owner path.

| Option | Meaning |
| --- | --- |
| `commandId` | Globally idempotent opening command identity |
| `supervisorId` | Supervisor retained on the handle, bounded by `limits.maxSupervisorIdLength` |
| `parent` | `{ kind: "root", ceiling, budget }` declaring the whole-tree resource ceiling and budget ceiling, or an authenticated parent handle |
| `task` | A descriptor created by `task()` (retained with `declared` provenance) or a task value whose `provenance` option states its origin; see [task revision](./task-revision.md) |
| `input` | Validated against the task input schema before any record |
| `grant` | Requested resource grant; see [delegated authority](./delegated-authority.md) |
| `budget` | Child budget; every metric the parent declares must be declared no greater |

The opened record (`shepherd.delegation.opened.v1`, declaration mode) retains the supervisor, the
parent, the task value, its provenance, the validated input, the grant, the child budget, the
budget ceiling, the derived authority, and the nesting depth. For a handle parent it also retains
an origin cut published through the parent handle head in the same transaction, as the second
record on the child handle path, mirroring scope registration. Repeating a command returns the
retained receipt; a different command body under the same identity fails with
`DelegationCommandConflictError` before any record. Bodies conform to the generated
[`delegation-opened-v1`](../spec/schemas/delegation-opened-v1.schema.json) and
[`delegation-completion-v1`](../spec/schemas/delegation-completion-v1.schema.json) schemas; the
context, handoff, and decision records are defined by
[supervisor operations](./supervisor-operations.md) and the approval record by
[task revision](./task-revision.md).

The returned `ChildRunHandle` is package-minted for the opening store. Copies, imported handles,
and handles minted for another store are refused with `TypeError`.

## Running a child

`runChildRun(store, { handle, provider })` executes the rehydrated task through the caller's
provider as an ordinary durable execution under the child run identity, with the retained input
and child budget. `runChildRun(store, { handle, program })` runs the caller's program under the
same durable claim through the configured `program` provider kind: the program receives
`{ handle, authority, budget, input, signal, task }`, its returned value is validated against the
task output schema, and an invalid output or a thrown error fails the child. The child run owner
path accepts the ordinary durable control commands.

After the child terminal, the completion record (`shepherd.delegation.completion.v1`, capture mode)
cites the child's terminal record and published cut, retains the execution kind and terminal
status, and is admitted only at the exact handle head. A crash between the child terminal and the
completion leaves a `settling` handle whose next `runChildRun` retains the completion without
re-executing; a completed handle returns the retained receipt without invoking anything. A child
whose worker died after the durable start stays `running` and fail-closed: discard, re-execution,
and durable recovery are refused until a cancellation request bound to the running head is
acknowledged with the worker's claim authority, after which the handle settles `cancelled` and can
be discarded and retried.

## Inspection and status

`inspectChildRun(store, handleId)` folds every record on the handle path and validates versions,
schemas, modes, witnesses, causal parents, derived identities, the task value and lock, the input
against the task input schema, effective authority re-derived from the retained ceiling and grant,
budget attenuation against the retained ceiling, the parent chain with its origin cut, and the
completion against the child's durable inspection. It appends nothing and works on read-only,
reopened, and imported stores; every inconsistency raises `DelegationEvidenceError`.

| Status | Condition |
| --- | --- |
| `ready` | Opened; the child run has no records |
| `running` | The child run is created or started and not terminal |
| `settling` | The child run is terminal (with or without a completion record) and no decision is retained |
| `approval_pending`, `rejected` | Revised or synthesized provenance awaiting or refused approval; see [task revision](./task-revision.md) |
| `accepted`, `discarded` | A terminal decision is retained; see [supervisor operations](./supervisor-operations.md) |

## Failures

| Failure | Behavior |
| --- | --- |
| Same command identity, different content, or an opening identity already retained by a handle command | `DelegationCommandConflictError`; no record |
| Grant or budget exceeds the parent, or depth exceeds `limits.maxNestingDepth` | `DelegationAuthorityError`; no record |
| Parent handle rejected or discarded | `DelegationStatusError`; no record |
| `runChildRun` on a running child, or a terminal child without a published cut | `DelegationStatusError`; recover through durable control first |
| Handle head moved while the child ran | `DelegationHeadConflictError`; no completion written |
| Forged, copied, or foreign-store handle; malformed options | `TypeError` |
| Inconsistent retained evidence | `DelegationEvidenceError` |

## Reserved owners

`SQLiteTraceStore.append` refuses groups on handle owner paths and `publishCut` refuses a handle as
the publishing owner, so only delegation command transactions write handle evidence. Handle
commands compare the exact handle head atomically inside the append; no store schema change is
required, and handle records export and import as ordinary records.
