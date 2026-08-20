# Repository grants and run authority ceilings

Implementation:
[`src/workspace/repository-grants.ts`](../src/workspace/repository-grants.ts) and
[`src/workspace/repository-grant-types.ts`](../src/workspace/repository-grant-types.ts).
Persisted evidence decoder:
[`src/protocol/repository-grant-evidence.ts`](../src/protocol/repository-grant-evidence.ts).
Execution integration:
[`src/workspace/task-world-execution.ts`](../src/workspace/task-world-execution.ts).
Public exports: [`src/index.ts`](../src/index.ts). Tests:
[`test/workspace/repository-grants.test.ts`](../test/workspace/repository-grants.test.ts) and
[`test/workspace/task-world-repository-grants.test.ts`](../test/workspace/task-world-repository-grants.test.ts).

## Task grant identity

`grantTaskRepositories()` creates a versioned companion artifact for an authenticated bodyless
task. It does not modify or reinterpret the existing task artifact, so tasks created by `task()`
retain their v1 bytes and identities. The companion artifact binds the exact task artifact digest
to a complete logical per-binding grant surface.

```ts
const granted = grantTaskRepositories({
    task: updateRepositories,
    grants: [
        { binding: "docs", profile: "read-only" },
        { binding: "source", profile: "read-write" },
    ],
});
```

Grant atoms, profiles, artifact versions, compatibility namespaces, and identity prefixes come
from `protocol.config.json`. The current closed atoms are `read` and `write`; the current profiles
are `read-only` and `read-write`. Declarations are sorted by logical binding name before hashing,
so declaration order does not affect identity. Changing a binding name, profile, underlying task
artifact, protocol version, or compatibility namespace changes the task-grant artifact digest.
Duplicate bindings, unsupported profiles, forged tasks, accessors, symbols, and open objects fail
closed. The independent identity fixture is
[`test/fixtures/repository-task-grant-v1.json`](../test/fixtures/repository-task-grant-v1.json).
Generated language-neutral contracts are
[`repository-task-grant-v1.schema.json`](../spec/schemas/repository-task-grant-v1.schema.json),
[`repository-task-grant-lock-v1.schema.json`](../spec/schemas/repository-task-grant-lock-v1.schema.json),
and [`repository-grant-plan-v1.schema.json`](../spec/schemas/repository-grant-plan-v1.schema.json).
Their conformance test is
[`test/workspace/repository-grant-schema-contract.test.ts`](../test/workspace/repository-grant-schema-contract.test.ts).

## Exact resource admission and attenuation

`createGitRepositoryGrantPlan()` resolves every task declaration to one package-created
`GitRepositoryBinding`. The supplied set must be complete and exact: missing, extra, duplicated,
ordinary-directory, or structurally forged bindings are rejected. Each admitted entry cites the
logical binding name, exact workspace binding ID, exact repository resource ID, requested task
profile, and effective authority atoms.

The whole-run `authorityCeiling` is a configured profile applied to every binding. Effective
authority is the set intersection of task-profile atoms and ceiling-profile atoms:

| Task profile | Run ceiling | Effective atoms |
| --- | --- | --- |
| `read-only` | `read-only` | `read` |
| `read-only` | `read-write` | `read` |
| `read-write` | `read-only` | `read` |
| `read-write` | `read-write` | `read`, `write` |

Intersection is monotone: a ceiling cannot add an atom absent from the task declaration, and
reapplying the same ceiling is idempotent. The complete canonical plan has a content-addressed
`plan_id` that changes with the task-grant artifact, ceiling, effective grants, or any exact
resource identity. Repository and administrative-directory evidence is revalidated for every
resource before granted execution admits the active binding.

## Granted retained-world execution

`captureGrantedTaskWorldDurably()` and `recoverGrantedTaskWorldDurably()` are separate public
seams from legacy task-world capture. They require an authenticated complete grant plan. The
selected `binding` identifies the one retained world exposed as `context.world` for that capture;
the plan may admit multiple exact repository resources. The conformance fixture executes the same
two-resource plan through each selected binding and proves its effective profile independently. A
single capture owns one active retained-world capability.

At admission the runtime verifies the plan handle, exact task artifact digest, active binding
object, binding/resource IDs, and current Git repository evidence before runner or provider
invocation. The capability checks `read` before `readText()` and `write` before `writeText()` on
every operation, in addition to the existing invocation fence and isolated-custody path checks.
Git administrative paths and Shepherd control paths are never file authority. A read-only plan
therefore cannot become writable through a copied plan object, changed recovery request, retained
capability, or stale repository binding.

This enforcement is an in-process package contract classified as `advisory`. It is identical on
macOS, Linux, native Windows, and WSL because it does not install a process or syscall sandbox.
Code outside the supplied capability, including a hostile runner using ambient Node.js APIs, is
not confined by this slice. Workspace protocol v22 adds honest
[`placement resolution and reporting`](./placement-resolution.md), but macOS Seatbelt, Linux
Landlock, native launchers, and process containment remain later Phase 4 work. This per-capture API
does not claim a simultaneous multi-world callback context.

## Durable recovery

Workspace protocol v21 publishes new capture journals as
[`world-capture-journal-v2.schema.json`](../spec/schemas/world-capture-journal-v2.schema.json), with
journal version 10. The prepared transition retains both the complete canonical
`repository_grant_plan` and its `repository_grant_plan_id`. Ordinary capture records `null` for
both; granted capture records the descriptor and content-addressed identity. The existing
[`world-capture-journal-v1.schema.json`](../spec/schemas/world-capture-journal-v1.schema.json)
remains unchanged at journal version 9. Readers accept only the exact configured v1/version-9 and
v2/version-10 pairs; cross-paired schema/version evidence fails closed.

Recovery reconstructs the retained descriptor, authenticates and revalidates the caller-supplied
plan before durable execution preparation, then requires canonical descriptor and plan-ID equality
with the prepared transition. A changed ceiling, task grant, resource, runner, binding, or base
fails closed without runner/provider invocation. Exact recovery and terminal replay reuse the
original evidence. The conformance suite interrupts in one process and completes recovery in a
fresh child process.

## Conformance boundary

| Contract | Evidence |
| --- | --- |
| Ordinary bodyless task identity unchanged | Existing task fixture plus companion-artifact fixture |
| Grant ordering is identity-neutral | Reordered-declaration task-grant test |
| Grant changes alter identity | Read-write/read-only artifact-digest test |
| Single and multiple exact resources admitted | Repository grant-plan fixture tests |
| Missing, extra, duplicate, forged, mismatched resources refused | Public plan-construction matrix |
| Whole-run ceiling cannot amplify | Four-profile intersection assertions |
| Read-only write refused at capability seam | Granted retained-world execution test |
| Read-write source mutation retained downstream | Granted source capture/changeset test |
| Git/control path access refused | Granted retained-world execution test |
| Changed recovery plan refused before invocation | Interrupted prepared-journal recovery test |
| Exact plan recovery succeeds | Same recovery fixture |
| Fresh-process recovery reconstructs exact plan evidence | Parent interruption/child recovery fixture |
| Repository drift refused | Stale administrative-directory fixture |
| Existing task-world behavior preserved | Full legacy task-world execution suite |

The pinned upstream evidence and local deviations are recorded in
[`../.plan/repository-grant-research.md`](../.plan/repository-grant-research.md).
