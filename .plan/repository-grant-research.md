# Repository Grant and Authority-Ceiling Research

Status: Phase 4 Task 2 implemented oracle record

Research date: 2026-08-18

Pinned shipped revision: `a8196d4c453514836d06bd2fece91a03cdc37107` (`v0.3.0`)

## Reviewed primary evidence

- [pinned permissions concept](https://github.com/shepherd-agents/shepherd/blob/a8196d4c453514836d06bd2fece91a03cdc37107/docs/shepherd/concepts/permissions.md)
- [pinned repository-access guide](https://github.com/shepherd-agents/shepherd/blob/a8196d4c453514836d06bd2fece91a03cdc37107/docs/shepherd/guides/grant-repo-access.md)
- [pinned generated `GitRepoGrant` reference](https://github.com/shepherd-agents/shepherd/blob/a8196d4c453514836d06bd2fece91a03cdc37107/docs/shepherd/reference/api/GitRepoGrant.md)
- [pinned `GitRepo` value contract tests](https://github.com/shepherd-agents/shepherd/blob/a8196d4c453514836d06bd2fece91a03cdc37107/shepherd/packages/runtime/tests/unit/nucleus/test_git_repo_handle_contract.py)
- [pinned grant-spelling provenance tests](https://github.com/shepherd-agents/shepherd/blob/a8196d4c453514836d06bd2fece91a03cdc37107/shepherd/packages/dialect/tests/test_gitrepo_grant_spelling.py)
- [pinned permission-plan compiler](https://github.com/shepherd-agents/shepherd/blob/a8196d4c453514836d06bd2fece91a03cdc37107/shepherd/packages/dialect/src/shepherd_dialect/permission_plan.py)
- [pinned permission-plan evidence validator](https://github.com/shepherd-agents/shepherd/blob/a8196d4c453514836d06bd2fece91a03cdc37107/vcs-core/packages/core/src/vcs_core/_permission_plan_evidence.py)

The generated `GitRepoGrant` page is only a scaffold, so compatibility claims rely on the shipped
concept, guide, and executable pinned tests rather than inferred reference-page details.

## Verified carried-forward behavior

The pinned `v0.3.0` documentation records that task permission declarations are part of the task
signature and attach `ReadOnly` or `ReadWrite` to each named, disjoint, whole repository binding.
It also records `may=` as a whole-run authority cap. Undeclared repositories do not silently gain
write authority.

The pinned `GitRepo` tests establish a pure value identity containing binding, basis, resource ID,
and an authority atom set. They demonstrate order-neutral `read`/`write` authority, idempotent
read-only attenuation, monotone `allow_only`/`deny`, serialization without amplification, and
fail-closed malformed identity/authority payloads.

The pinned grant-spelling tests distinguish syntax provenance from compiled authority identity:
bare `GitRepo` and explicit `May[GitRepo, ReadWrite]` have the same compiled grant descriptor while
their signature provenance differs. This TypeScript slice intentionally implements only explicit
grants and does not introduce a permissive bare-repository spelling.

The pinned permission-plan compiler and evidence validator show a content-addressed plan with
closed fallback, monitor assignments, and fail-closed descriptor validation. They also make clear
that the upstream enforcement claim depends on assigned monitors, particularly a syscall jail and
carrier check.

## TypeScript-owned contract and limits

Workspace protocol v21 implements a separate companion task-grant artifact so existing bodyless
task artifacts are not redefined. It uses configured `read`/`write` atoms, configured whole-binding
profiles, canonical binding-name ordering, exact protocol-v20 repository resource IDs, and a
configured global ceiling. This encoding, field spelling, hashing domain, plan ID, and journal-v10
evidence are TypeScript-owned; no pinned source specifies them.

The local plan authenticates every exact repository resource and revalidates repository evidence
before the public granted retained-world seam invokes a runner. The active capability enforces
read/write checks in process and labels them `advisory`. This is weaker than the pinned upstream
jail claim: it does not stop a hostile callback from using ambient Node.js filesystem or process
APIs, and it supplies no native Seatbelt/Landlock evidence.

The plan can represent multiple resources; conformance executes the same plan through each
selected binding's retained-world seam. One capture still selects one active binding/custody.
Simultaneous multi-binding callback capabilities, placement resolution, jail compilation, native
Windows/WSL placement classification, installed-package compatibility, CLI rendering,
bare-annotation provenance, and provider/subprocess confinement remain explicit gaps.

## Claim boundary

This slice claims behavioral compatibility for explicit whole-binding `ReadOnly`/`ReadWrite`
declarations, a non-amplifying whole-run ceiling, exact resource-bound authority evidence, and
fail-closed in-process capability operations. It does not claim byte-level Python descriptor
identity, syscall enforcement parity, or full Shepherd `0.3.0` run-surface compatibility.
