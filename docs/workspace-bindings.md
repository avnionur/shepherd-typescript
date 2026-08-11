# Workspace Binding Roots

Implementation: [`src/workspace/bindings.ts`](../src/workspace/bindings.ts). Public exports:
[`src/index.ts`](../src/index.ts). Production-seam tests:
[`test/workspace/bindings.test.ts`](../test/workspace/bindings.test.ts).

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

## Current boundary

This slice establishes authority identity only; it does not grant runtime access or retain world
bytes. Filesystem `realpath` does not prove identity across bind mounts, network shares, or a
concurrent rename after validation. Carriers and settlement must revalidate authority at their
mutation boundaries. Git repository typing, permissions, durable byte custody, and runtime grants
remain later roadmap capabilities. Case aliases are equivalent when the host filesystem resolves
them to the same real path; no cross-platform path-identity claim is made.
