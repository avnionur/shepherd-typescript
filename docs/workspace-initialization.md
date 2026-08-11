# Workspace Initialization and Adoption

Implementation: [`src/workspace/initialization.ts`](../src/workspace/initialization.ts). Public
exports: [`src/index.ts`](../src/index.ts). Production-seam tests:
[`test/workspace/initialization.test.ts`](../test/workspace/initialization.test.ts).

## Public contract

`initializeWorkspace(options)` creates or exactly reuses a protected `.vcscore` control root in an
existing directory. `openWorkspace(rootPath)` validates that retained control evidence and returns
a frozen view of the canonical root, current Git context, and adopted baseline citation.

The configured adoption modes are:

| Mode | Retained citation |
| --- | --- |
| `none` | No baseline reference or Git HEAD. |
| `git-head` | Exact existing commit, cited as a configured Git-HEAD reference. |
| `worktree` | SHA-256 identity of ordinary directory, file-content, executable-bit, and symlink-target entries, excluding `.git` and `.vcscore`; the current Git HEAD is cited separately when available. |

Worktree identity includes empty directories and files regardless of Git tracking or ignore state.
This is a TypeScript-owned v1 rule because the reviewed upstream public contract does not define
dirty, staged, untracked, or ignored-file semantics.

## Git preservation

Initialization detects a containing Git repository without changing it. If none exists and
`initializeGit` is true, it runs `git init`; it never creates a commit, stages files, checks out,
resets, rewrites refs, or changes ordinary workspace content. `initializeGit: false` leaves a
non-Git directory unchanged.

Repeated initialization with the same adoption and Git-initialization options returns the retained
baseline even if the current Git HEAD or worktree later moves. A different option conflicts rather
than replacing evidence.

## Safety and current boundary

Control directories and manifests must be real filesystem objects, not symlinks. Metadata has an
exact configured format/version and closed shape. Malformed metadata, missing adopted commits,
removed required Git state, unsupported objects during worktree capture, and option conflicts fail
closed with typed errors.

The worktree reference is an identity citation, not retained file custody. Copying baseline bytes
into a managed carrier belongs to the Phase 3 reference-copy-carrier slice. Canonical named binding
roots and overlap rejection are also separate from this initialization contract.

Worktree identity observes one filesystem traversal. Callers that require a quiescent snapshot
must prevent concurrent external mutation; atomic retained byte custody belongs to the carrier
slice rather than this citation-only contract.
