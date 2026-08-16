# Git-Aware Baseline and Retained Output Custody

Implementation: [`src/workspace/git-aware-custody.ts`](../src/workspace/git-aware-custody.ts).
Public exports: [`src/index.ts`](../src/index.ts). Production-seam tests:
[`test/workspace/git-aware-custody.test.ts`](../test/workspace/git-aware-custody.test.ts).

## Public contract

`createGitAwareCustody({ workspaceRoot })` implements workspace protocol v4 on top of the protocol
v3 reference copy carrier. `capture(binding)` requires the binding to be the exact Git worktree
top level. It records stable Shepherd-local repository and worktree identities under `.vcscore`,
captures the initialized adoption basis, publishes an immutable managed-world revision, and forks
isolated mutable retained output. `none` validates and records repository identity but creates no
basis or output custody.

`open(custodyId)` reopens the exact closed Git descriptor, immutable revision, mutable custody,
opaque index receipt, and independently retained Git-object pack. `verify(custodyId)` verifies
the retained output and conservatively reports whether the current user Git basis moved.
`discard(custodyId)` delegates exact physical cleanup to the reference carrier without changing
the immutable basis or user repository.

## Basis semantics

`git-head` requires an attached or detached commit and materializes only its committed tree.
Staged, unstaged, untracked, and ignored files do not enter that world. The object pack retains
the complete required superproject commit, tree, and blob history independently of borrowed object
stores. In `worktree` mode it additionally retains every non-gitlink object cited only by the
index, including staged-only blobs.

`worktree` binds all of these into one content-addressed basis:

- attached, detached, or unborn HEAD evidence;
- exact index bytes plus canonical stage, mode, object ID, intent-to-add, assume-unchanged, and
  skip-worktree fields;
- sparse-checkout configuration and pattern receipts;
- tracked nodes that are present and untracked non-ignored nodes;
- ignored-path classification and effective repository/user exclusion-source receipts;
- clean submodule gitlink citations.

Missing skip-worktree paths remain intentionally absent. Ignored untracked content is excluded and
ordinary ignored-file byte churn does not move the basis; changing effective ignore sources does.
Unmerged indexes, dirty submodules, undeclared embedded repositories, inexact repository roots,
unsupported object formats, and malformed or corrupt receipts fail closed.

Workspace protocol v18 applies the shared configured protected-path policy to managed and ignored
Git enumeration and to independently inspected archive materialization. Exact control storage is
excluded; nested, case-folded, trailing-name, alternate-name, and symlink aliases are rejected
before retained output publication.

## Git preservation and isolation

Every Git command runs with optional locks disabled. Capture does not checkout, reset, commit,
update refs, rewrite the index, change configuration, manage worktrees, fetch, repack, prune, or
modify the user's ordinary files. Linked worktrees retain distinct per-worktree Git directories
and identities while citing their shared common directory.

The mutable output is a copy-carrier child under protected control storage, not a linked worktree
attached to the user's common Git directory. Restart authority comes only from closed descriptors
and verified receipts, never from the user's current HEAD. A retained object pack remains
reopenable when an originally borrowed alternate object store disappears; ordinary
`openWorkspace` remains stricter and still rejects unavailable adopted commits.

## Current boundary

Task 4 owns basis acquisition, movement classification, isolated retained custody, restart, and
discard. The next Phase 3 task owns the complete changeset model; this API intentionally exposes no
partial diff or settlement schema. Deterministic concurrent-mutation, disk-full, permission, and
process-kill injection, exhaustive stable error codes, `core.symlinks=false`, sparse-index variants,
and broad cross-platform filesystem preservation remain Phase 3 exit gates and are not reported as verified here.
They do not change the Task 5 changeset record shape, so that slice can proceed independently.
