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

Workspace protocol v20 composes `createGitRepositoryBindings` with this existing custody API.
Repository-aware bindings support multiple sibling Git worktrees beneath one initialized
workspace, retain distinct repository/resource evidence independent of declaration order, and use
per-resource identity receipts beneath the workspace control root. No `.vcscore` directory is
written into a nested user repository. Ordinary v2 directory bindings remain accepted for Phase 3
compatibility and keep their existing binding and custody identities.

## Basis semantics

`git-head` requires an attached or detached commit and materializes only its committed tree.
Staged, unstaged, untracked, and ignored files do not enter that world. Since 2.32.2 the tree is
written from raw objects (`git ls-tree -r -t -z --full-tree HEAD` and `git cat-file --batch`), so
no attribute applies: no `filter.<driver>.smudge` or `process` program runs, and `export-ignore`,
`export-subst`, `ident`, and end-of-line conversion do not change the world. Files are created
exclusively with Git checkout's modes (`0666`, or `0777` for executable blobs) under the process
umask, directories and submodule gitlinks as directories with the default mode, and symbolic links
from their blob. A tree entry named `.`, `..`, or empty, or whose parent is not a tree entry, is
refused as unsupported state. For a repository without attributes the world equals the previous
`git archive | tar` extraction under any umask that removes the other-write bit (for example
`022`, `002`, or `077`); repositories that relied on archive attributes now retain the committed
bytes. The configured `gitCustody.archiveExecutable` stays in the frozen workspace protocol
contract and is no longer invoked. The object pack retains
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

A declared submodule is clean when the superproject's committed gitlink equals the staged one, the
submodule directory is its own repository top level, its HEAD equals the gitlink, its stage-0
index equals its HEAD tree, every entry that is neither skip-worktree nor assume-unchanged matches
the worktree by type, executable bit (unless the submodule sets `core.fileMode=false`), and raw Git
blob ID with no symbolic link in its leading path, populated nested gitlinks are clean by the same
rule (unpopulated ones are accepted), and it has no untracked, non-ignored path. Since 2.32.3 this
is decided without `git status`, which re-hashes content through repository-configured
`filter.<driver>.clean` or `process` programs: only `rev-parse`, `ls-tree`, and `ls-files` run, and
worktree bytes are hashed in the runtime. A stat-only change stays clean; a file equal to its blob
only after a clean filter or end-of-line conversion (for example Git LFS pointers or
`core.autocrlf`) is reported as a dirty submodule. No Git command used by custody applies
attributes, runs hooks, textconv or diff drivers, or credential helpers, or starts a pager.

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

## Platform and fault boundary

Workspace protocol v19 rejects `core.symlinks=false` regular-file placeholders for index symlink
entries before worktree custody publication. Actual sparse-index fixtures retain opaque index
receipts, canonical skip-worktree evidence, sparse configuration, and excluded-path absence. Clean
Gitlinks remain external commit citations, while symlink target text and portable mode bits continue
through reference-copy custody.

Git materialization, basis capture/revalidation, custody publication, and post-publication are
configured deterministic fault boundaries. Failures preserve `WorkspaceCustodyFaultError` rather
than collapsing the stable classification into a generic Git control error. See
[Workspace platform and fault conformance](./platform-fault-conformance.md) for host policy,
recovery evidence, and the optimized-carrier parity gate.
