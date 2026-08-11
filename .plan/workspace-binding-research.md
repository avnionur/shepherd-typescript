# Workspace Binding Roots and Overlap Research

Status: Phase 3 Task 2 implementation input

Research date: 2026-08-11

Pinned shipped revision: `a8196d4c453514836d06bd2fece91a03cdc37107` (`v0.3.0`)

Pinned development revision: `d45074e0099d9ccafeed4a233702ad68ff8a2fa6`

## Evidence boundary

Primary upstream sources already reviewed for this plan:

- [v0.3.0 repository-access guide](https://docs.shepherd-agents.ai/guides/grant-repo-access/)
- [v0.3.0 permissions concept](https://docs.shepherd-agents.ai/concepts/permissions/)
- [pinned shipped source tree](https://github.com/shepherd-agents/shepherd/tree/a8196d4c453514836d06bd2fece91a03cdc37107)
- [pinned development source tree](https://github.com/shepherd-agents/shepherd/tree/d45074e0099d9ccafeed4a233702ad68ff8a2fa6)
- [paper v3](https://arxiv.org/html/2605.10913v3)

Repository planning sources:

- [`architecture.md`](./architecture.md), especially “Workspace and versioned worlds”
- [`research-notes.md`](./research-notes.md), especially “Permissions and placements”
- [`Agent-Runtime-Architecture.md`](./Agent-Runtime-Architecture.md), especially §§13.5–13.6

The published guide is the authority for shipped API vocabulary. The local architecture is a
vNext design requirement, not evidence that Python v0.3.0 implements a particular path algorithm.
The agent-runtime discussion is architectural context, not a versioned binding protocol.

## Verified shipped `0.3.0` behavior

The public binding shape shown by the guide is:

```python
docs = ws.bind(root="docs/", name="docs")
backend = ws.bind(root="backend/", name="backend")
```

Each result is a `GitRepo` value passed to a task under the parameter's `ReadOnly` or `ReadWrite`
grant. Roots are named and must be disjoint. The guide says overlapping **or nested** roots are
refused at bind time so each managed path belongs to exactly one binding. Permissions apply to the
whole binding; sub-root grants are outside the `0.3.0` surface.

This verifies all of the following:

- the public input includes `root` and `name`;
- binding produces a repository capability value;
- same-root overlap and ancestor/descendant overlap must be rejected, regardless of declaration
  order;
- rejection happens before a run receives the ambiguous authority;
- grants attach to the resulting binding identity, not to an ambient filesystem permission.

The public docs do **not** specify the path-normalization algorithm, whether `root` may be absolute,
name syntax, binding-ID derivation, nonexistent-root behavior, error class/code, or how Git
submodules and nested repositories affect root ownership.

## Paper and pinned-development boundary

Paper v3 couples scope state to environment/world state and motivates explicit, attenuated
capabilities, but it does not define a canonical filesystem-root encoding or a `bind` wire/API
contract. It cannot be used to infer `realpath`, symlink, Git-discovery, or identifier rules.

The pinned-development research already records named, non-overlapping roots and whole-profile
bindings. No stronger pinned vNext behavior has been reproduced locally. The local architecture
therefore adds the following project requirements without claiming upstream parity:

- a binding carries a stable ID and name, canonical root, baseline world revision, resource type,
  permission profile, carrier/backend, and custody state;
- overlap is checked after canonicalization, including symlink-aware checks;
- grants bind to canonical resource identity rather than a display path;
- the control plane is protected and path escape is rejected.

The agent-runtime discussion reinforces least-authority capabilities and gives narrower path grants
such as `filesystem.read("src/**")` as an illustrative future direction. It does not override
Shepherd `0.3.0` whole-binding grants and supplies no additional root or overlap semantics.

## TypeScript-owned initial safety policy

Until pinned oracle fixtures establish more behavior, Phase 3 Task 2 implements the following
closed, fail-safe identity-validation slice and labels it TypeScript-owned where it exceeds the
verified surface. Durable byte custody begins in Task 3; GitRepo typing and grants remain Phase 4.

### Root canonicalization

1. Accept a non-empty, well-formed path and resolve relative input against the initialized
   workspace root.
2. Require the target to exist and be a directory. Rejecting nonexistent roots avoids an identity
   that can change when a later path component or symlink appears.
3. Resolve filesystem links with the platform's real-path operation and use its platform-native
   absolute result for comparison. Preserve the caller's path only as non-authoritative display
   data; cross-platform path identity is not claimed.
4. Require the resolved root to remain inside the workspace's declared authority. External roots
   need a future explicit capability instead of implicit `..` traversal.
5. Compare roots using actual platform filesystem semantics. A symlink alias, spelling alias, or
   case alias on a case-insensitive filesystem must not create a second authority.

`realpath` resolves ordinary symlink aliases but is not proof against every bind mount, network
share, or concurrent rename. Filesystem identity evidence and revalidation belong to the Task 3
carrier and later settlement mutation boundaries.

### Overlap rule

For every pair of canonical roots, reject when either root:

- is equal to the other;
- is a path-segment ancestor of the other; or
- is a path-segment descendant of the other.

Use path-segment relationships, never raw string prefixes (`/repo/a` is not an ancestor of
`/repo/ab`). Run the comparison symmetrically over the full proposed binding set before returning
any binding. The error identifies the conflicting binding names and roots; this validation-only
slice performs no partial durable registration.

### Names and binding IDs

The shipped source verifies only that a name is supplied. The initial TypeScript policy should:

- require a non-empty, well-formed Unicode logical name;
- reject `.` / `..`, path separators, NUL, and duplicate names;
- compare logical names exactly rather than applying filesystem case rules;
- derive one content-addressed binding ID from the canonical workspace, name, and root. This is
  stable across reopen while those canonical paths remain unchanged; durable relocation-independent
  identity is deferred to carrier custody.

The exact stable-ID derivation is a protocol decision. It must use the repository's canonical
record mechanism and must not be advertised as Python-compatible until an upstream fixture supplies
the corresponding contract. Later grants, world revisions, changesets, and settlement records use
the binding ID rather than the display path.

### Git boundaries

Phase 3 Task 2 establishes generic filesystem-root identity without claiming a `GitRepo` capability.
Phase 4 must require a GitRepo binding root to resolve to a Git worktree root and record repository
identity without silently widening a requested subdirectory to its parent.

Whether a single parent binding may contain submodules or nested `.git` boundaries is not specified
by the reviewed upstream docs. The safe initial behavior is to reject an ambiguous nested boundary
unless it has an explicit future carrier policy. Do not infer multiple bindings by scanning.

### Fail-closed behavior

Canonicalization, filesystem inspection, and overlap validation finish before any authority is
returned. Missing roots, permission failures, symlink loops, paths escaping workspace authority,
duplicate names, and detected overlap are validation failures. They do not degrade to display-path
comparison or advisory-only acceptance.

Stable TypeScript error codes distinguish invalid names, unavailable or unsafe roots, authority
escape, duplicate names, and root overlap. Finer filesystem and repository-boundary taxonomy remains
assigned to the carrier and Phase 4. Exact upstream exception parity remains an oracle gap.

## Task 2 required test matrix

- identical roots expressed identically and through `.` / `..`;
- ancestor then descendant, and descendant then ancestor;
- sibling roots whose text shares a prefix;
- direct, chained, broken, and looping symlinks;
- case aliases on case-insensitive filesystems;
- duplicate and path-shaped names;
- nonexistent files and directories;
- reopen recomputation preserving identity for unchanged canonical paths;
- no partial authority returned after any failed multi-binding validation.

Case aliases are exercised where the host filesystem exposes them. Concurrent replacement,
filesystem-identity evidence, and mutation-boundary revalidation belong to the Task 3 carrier.
Parent Git repositories, nested repositories, submodules, worktrees, and repository-boundary errors
belong to Phase 4 GitRepo typing and oracle work.

## Oracle gaps before a parity claim

Run the pinned v0.3.0 binding tests or a black-box installed-package fixture to determine:

- exact relative/absolute-root rules and working-directory basis;
- symlink and case-alias behavior;
- nonexistent-root behavior;
- name validation and duplicate-name behavior;
- binding identity representation;
- parent repository, nested repository, worktree, and submodule handling;
- exact errors and whether failed binds leave durable state.

Until then, only the `root`/`name` API, whole-binding capability, and bind-time rejection of same,
overlapping, or nested managed roots are verified upstream behavior.
