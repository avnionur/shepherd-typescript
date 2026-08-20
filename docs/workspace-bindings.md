# Workspace Binding Roots

Implementation: [`src/workspace/bindings.ts`](../src/workspace/bindings.ts). Public exports:
[`src/index.ts`](../src/index.ts). Production-seam tests:
[`test/workspace/bindings.test.ts`](../test/workspace/bindings.test.ts).
Repository-aware production-seam tests:
[`test/workspace/repository-bindings.test.ts`](../test/workspace/repository-bindings.test.ts).

## Public contract

`createWorkspaceBindings({ workspaceRoot, bindings })` validates one complete proposed set of
logical roots for an initialized workspace. Each definition supplies an exact logical `name` and
an existing directory `root`, either absolute or relative to the canonical workspace root.

The workspace protocol v2 frozen result preserves declaration order and exposes
`binding_version: 2`. Each binding contains a content-addressed stable
`binding_id`, the filesystem-resolved `canonical_root`, the exact logical `name`, and the
non-authoritative caller spelling in `requested_root`. Repeated validation after reopening produces
the same identity when the canonical workspace, logical name, and canonical root are unchanged.

## Canonical authority and overlap

Every root must exist, resolve to a directory through the platform real-path operation, and remain
inside the initialized workspace authority. Broken links, link loops, files, missing paths, and
symlink escapes fail closed. Relative containment and overlap use path segments, so sibling names
such as `source` and `source-sibling` remain disjoint.

The complete set is rejected if two canonical roots are equal or either is an ancestor of the
other. This catches spelling and symlink aliases before any authority is returned, regardless of
declaration order. Bigint filesystem device/inode ancestry supplements path comparison where the
host exposes a nonzero inode, including case aliases that retain caller spelling; unavailable inode
positions retain only their path spelling and never shift another ancestor into their place. Empty,
whitespace, path-shaped, NUL-containing, malformed-Unicode, and duplicate names are rejected with
configured typed errors.

## Repository-aware authorities

Workspace protocol v20 adds
`createGitRepositoryBindings({ workspaceRoot, bindings })`. It first applies the unchanged v2
directory-binding contract, then requires every root to be the exact top level of one supported,
non-bare Git worktree. The returned `GitRepositoryBinding` preserves the existing `binding_id` and
adds frozen common-directory, per-worktree Git-directory, object-format, and filesystem-identity
evidence plus a separate content-addressed `resource_id` and configured `resource_type`.

Repository IDs derive from the exact common-directory filesystem authority, so independent
repositories remain distinct. Git administrative and common directories must be non-symbolic,
equal, and contained beneath the exact binding root. Linked worktrees, `--separate-git-dir`
worktrees, and submodules whose administrative authority belongs to a superproject therefore fail
closed rather than exposing cross-binding state. Inexact subdirectories, bare repositories,
unsupported object formats, aliases, and cross-authority roots also fail before a repository
handle is returned. Repository replacement produces a different resource identity; custody
refuses the stale package handle.

`createGitAwareCustody` authenticates both ordinary and repository-aware package handles. For a
repository binding it stores per-resource identity receipts only beneath the initialized
workspace control root, allowing multiple sibling repositories without writing `.vcscore` into
their user worktrees. Capture, reopen, movement verification, and discard continue through the
existing Git custody API.

## Current boundary

Bindings establish authority identity only; they do not grant runtime access. Filesystem
`realpath` and Git administrative identities do not prove identity across bind mounts, network
shares, or a concurrent replacement after validation, so custody revalidates before capture.
Bindings still carry no implicit permission or placement. Explicit grants, whole-run ceilings, and
placement reporting are separate Phase 4 artifacts documented in
[`repository-grants.md`](./repository-grants.md) and
[`placement-resolution.md`](./placement-resolution.md). Case aliases are
equivalent when the host filesystem resolves them to the same real path; no relocation-independent
or cross-platform path-identity claim is made. On macOS and Linux, filesystem evidence uses device
and inode identity. Native Windows/WSL uses the canonical-path fallback when Node reports a zero
inode; the same exact-root and administrative-containment policy still applies. The
identity-directory substitution fixture uses a Windows junction when native symlink privileges are
unavailable.
