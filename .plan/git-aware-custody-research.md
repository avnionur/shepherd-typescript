# Git-Aware Baseline and Retained-Output Custody Research

Status: Phase 3 Task 4 implementation input

Research date: 2026-08-12

Pinned Shepherd shipped revision: `a8196d4c453514836d06bd2fece91a03cdc37107` (`v0.3.0`)

Pinned Shepherd development revision: `d45074e0099d9ccafeed4a233702ad68ff8a2fa6`

## Primary sources and evidence boundary

Shepherd sources:

- [generated Shepherd v0.3.0 CLI reference](https://docs.shepherd-agents.ai/reference/cli/)
- [installed-package v0.3.0 quickstart](https://docs.shepherd-agents.ai/start/)
- [pinned shipped source tree](https://github.com/shepherd-agents/shepherd/tree/a8196d4c453514836d06bd2fece91a03cdc37107)
- [pinned development source tree](https://github.com/shepherd-agents/shepherd/tree/d45074e0099d9ccafeed4a233702ad68ff8a2fa6)

Official Git specifications:

- [`gitrepository-layout`](https://git-scm.com/docs/gitrepository-layout)
- [`git-rev-parse`](https://git-scm.com/docs/git-rev-parse)
- [`git-symbolic-ref`](https://git-scm.com/docs/git-symbolic-ref)
- [`gitformat-index`](https://git-scm.com/docs/gitformat-index)
- [`git-ls-files`](https://git-scm.com/docs/git-ls-files)
- [`git-update-index`](https://git-scm.com/docs/git-update-index)
- [`git-add`](https://git-scm.com/docs/git-add)
- [`git-status`](https://git-scm.com/docs/git-status)
- [`gitignore`](https://git-scm.com/docs/gitignore)
- [`git-worktree`](https://git-scm.com/docs/git-worktree)
- [`git-sparse-checkout`](https://git-scm.com/docs/git-sparse-checkout)
- [`git-submodule`](https://git-scm.com/docs/git-submodule)
- [`gitmodules`](https://git-scm.com/docs/gitmodules)
- [`git-cat-file`](https://git-scm.com/docs/git-cat-file)
- [`git-fast-import`](https://git-scm.com/docs/git-fast-import)
- [`git-config` (`core.symlinks`)](https://git-scm.com/docs/git-config#Documentation/git-config.txt-coresymlinks)
- [Git data model](https://git-scm.com/docs/gitdatamodel)

The Shepherd CLI verifies the public adoption vocabulary `none`, `git-head`, and `worktree`, with
`worktree` as the default. It says initialization records an existing project baseline into
Shepherd custody, creates or reuses `.vcscore`, and leaves ordinary Git history untouched. The
quickstart verifies that retained work stays beside the user's files until explicit settlement.

The reviewed Shepherd sources do not publish the detailed Git-state mapping, ignored-file policy,
index representation, linked-worktree behavior, custody layout, or basis-token algorithm. Those
details below are TypeScript-owned policy derived from Git's official semantics and the copy-carrier
contract. They are not Python `0.3.0` parity claims.

## Git facts that constrain the design

- `HEAD` is normally a symbolic ref such as `refs/heads/main`; `git symbolic-ref` exits non-zero
  for detached HEAD. A symbolic HEAD may name a branch that has no commit yet (unborn state).
- The index is a distinct, checksummed binary state. Entries are ordered by pathname bytes and
  stage; ordinary resolved entries use stage 0, while unmerged paths can carry stages 1, 2, and 3.
  Extended entry flags include `SKIP_WORKTREE` and intent-to-add.
- `git add -N` places an intent-to-add entry in the index without staged file content.
- Assume-unchanged asks Git to omit normal worktree checks; it is an optimization promise, not
  evidence that bytes are unchanged. Skip-worktree asks Git to avoid materializing a tracked path
  and to ignore its absence when possible.
- `git status` distinguishes HEAD-to-index, index-to-worktree, untracked, and—when requested—ignored
  state. Porcelain formats are stable for scripts; pathnames must use NUL termination to avoid
  quoting ambiguity.
- Ignore rules apply to intentionally untracked files. Already tracked files are not made ignored
  by a matching pattern. Standard ignore sources include repository files, per-repository excludes,
  and user configuration.
- A linked worktree has its own `HEAD`, index, and private git directory while refs and objects are
  generally shared through the common directory. Git explicitly says callers should resolve paths
  with `git rev-parse --git-path`, not assume `$GIT_DIR` versus `$GIT_COMMON_DIR` layout.
- Sparse checkout uses skip-worktree and may use sparse-directory index entries. Missing skipped
  files remain tracked; their absence is not deletion. The sparse specification can transiently
  differ from configured patterns.
- A submodule is represented in the superproject by a gitlink commit. Its checked-out HEAD,
  modified files, and untracked files are separate state from the recorded gitlink.
- An object database may borrow objects via `objects/info/alternates` or environment configuration.
  An OID citation alone is therefore not durable custody if the alternate later disappears.

## TypeScript repository and worktree identity

Record a closed `GitRepositoryIdentity` with:

- canonical binding ID and canonical worktree root;
- absolute, real-path-resolved per-worktree Git directory obtained from Git;
- absolute, real-path-resolved common Git directory obtained from Git;
- repository object format reported by Git;
- bare/non-bare status;
- a persisted Shepherd repository ID stored under `.vcscore`, not in `.git`;
- a persisted Shepherd worktree ID for this binding;
- Git executable/version evidence used to read the state.

The repository ID is not a remote URL, branch name, commit OID, filesystem inode, or common-directory
path. Those can change or collide. The persisted ID provides stable local authority without
modifying Git configuration or refs; canonical directories remain revalidation evidence. Linked
worktrees share a repository identity but have distinct worktree identities and per-worktree state.

Reject bare repositories for `worktree` adoption. Reject a binding whose requested root is not the
exact Git worktree top level; never silently widen a subdirectory. Resolve Git paths through Git's
plumbing so `.git` files, linked worktrees, and separate Git directories work correctly.

## Canonical HEAD state

Represent exactly one closed variant:

- `attached`: symbolic full ref name plus resolved commit OID;
- `unborn`: symbolic full ref name with no resolved commit;
- `detached`: resolved commit OID and no branch ref.

Validate that any resolved HEAD object is a commit. Do not shorten refs or OIDs. Read HEAD before
and after baseline capture and fail on drift. Reflog position, upstream configuration, and display
branch name are diagnostic, not baseline identity.

## Canonical index state

Capture both:

1. the exact index bytes and digest as a conservative preservation/restart receipt; and
2. a semantic index manifest read using official Git plumbing with NUL-delimited paths.

The semantic entry contains path bytes, stage, Git mode, OID where present, intent-to-add,
skip-worktree, and assume-unchanged. Record the repository hash algorithm. Preserve resolve-undo,
sparse-index, split-index, untracked-cache, FSMonitor, and unknown optional-extension evidence in
the opaque index receipt even when they do not affect the first semantic manifest.

Policy per special state:

- Stage 0 is the normal resolved entry.
- Stages 1/2/3 are captured for diagnosis, but `worktree` adoption refuses an unmerged index for
  this slice because there is no single settlement basis. `git-head` can ignore index conflicts.
- Intent-to-add remains distinct from an ordinary empty blob; capture the current worktree node if
  present and retain the intent flag.
- Skip-worktree remains tracked. If absent, record intentional sparse absence with its index OID;
  do not materialize it or classify it as deletion. If present, capture and compare its bytes.
- Assume-unchanged never suppresses a byte scan. Preserve the flag while treating the actual node
  as potentially modified.
- Sparse-directory entries must be expanded through Git-aware plumbing for semantic path identity,
  while the original sparse-index receipt is retained unchanged.

Run inspection commands with optional index locking disabled and verify the exact index digest
before and after capture. The adapter must not refresh or rewrite the user's index. A change during
capture fails or performs a configured bounded retry.

## Adoption modes

### `none`

Record repository/worktree identity and adoption mode, but no HEAD-, index-, or filesystem-derived
baseline revision. Do not create Git refs, commits, index entries, or retained output custody. Any
later operation requiring a settlement basis must fail with a stable “baseline unavailable” error.

This is the least assumptive interpretation of the shipped name; exact upstream behavior remains
an oracle gap.

### `git-head`

Require an attached or detached HEAD resolving to a commit. An unborn HEAD has no tree and fails
with a stable “HEAD baseline unavailable” error. Capture the commit OID and its complete tree
semantics, including modes, symlink blobs, and gitlinks, into independent Shepherd custody.

Ignore staged, unstaged, untracked, and ignored content when defining this baseline. Still record
pre/post HEAD and repository-identity evidence proving the commit did not move during capture. Do
not checkout, reset, commit, update a ref, refresh the index, or alter sparse-checkout state.

### `worktree`

Capture a composite basis:

- repository and worktree identity;
- canonical HEAD variant;
- full semantic index plus opaque index receipt;
- effective sparse-checkout state;
- actual managed filesystem nodes for tracked paths that are present;
- untracked, non-ignored paths;
- explicit ignored-path exclusion evidence;
- submodule gitlink and observed-state citations.

Tracked paths remain managed even if an ignore pattern matches. Untracked non-ignored paths are
captured. Ignored untracked paths are excluded by default to avoid importing caches, build output,
and secrets; record the effective ignore sources and a deterministic classification digest so the
exclusion is auditable. Because global ignore configuration can vary by machine, it is basis
evidence, not portable semantic configuration.

The capture is a verified multi-scan, not a kernel-atomic snapshot. Re-read HEAD, index digest,
sparse configuration, submodule citations, and filesystem manifest after custody publication. Any
unexplained drift fails/retries; never publish a mixed basis.

## Symlinks, submodules, nested repositories, and sparse state

- Git mode `120000` represents a symlink whose blob is the target text. Preserve the Git tree/index
  representation and actual worktree node separately. Respect `core.symlinks`; a platform checkout
  represented as a regular file must not be falsely claimed to be a native symlink.
- Git mode `160000` is a submodule gitlink. Do not recursively absorb its repository into the
  superproject binding. Record the indexed/HEAD gitlink, initialized state, checked-out submodule
  HEAD, and clean/modified/untracked observation. Refuse dirty submodule content in initial
  `worktree` custody unless the submodule is an explicit disjoint binding.
- An embedded Git repository that is not a declared submodule is an ambiguous authority boundary
  and is rejected rather than recursively captured as ordinary untracked files.
- Preserve sparse patterns/config, skip-worktree flags, and transiently vivified paths. Missing
  skipped paths are intentional absence. Do not run commands that reapply or expand the sparse
  checkout in the user's worktree.

## Object alternates and durable object custody

Record alternate-object-store configuration as provenance, but never depend on it for restart.
Materialize every superproject commit, tree, and blob required by the adopted baseline into
Shepherd-controlled storage, verifying type, OID, and bytes through Git plumbing. A superproject
gitlink is only an external commit citation: its submodule object does not have to exist in the
superproject object database. Retain that OID without claiming custody of the submodule commit
unless the submodule is an explicit binding. Do not mutate, repack, prune, or add objects to the
user's object database.

Missing/promised objects, unavailable alternates, replace-object ambiguity, or unsupported object
formats fail closed. Network fetching is outside this local adoption operation unless a future
explicit capability authorizes it.

## Basis identity and movement

Create a content-addressed basis token over the closed semantic evidence appropriate to the mode:

- `none`: no settlement basis token;
- `git-head`: repository/worktree identity, object format, HEAD commit, and captured tree revision;
- `worktree`: all `git-head` evidence plus HEAD variant, semantic index, sparse state, managed
  filesystem manifest, ignored-exclusion digest, and submodule citations.

Absolute Git administrative paths and opaque index bytes are receipts, not portable semantic
identity, but changes to their relevant state must fail conservative revalidation.

Before any later fast-forward settlement, recapture the same basis components and require exact
token equality. This detects branch/ref movement, detached-HEAD movement, staged/index changes,
unstaged changes, relevant untracked changes, sparse-state movement, and submodule movement.
Ignored excluded-file churn does not move the semantic basis. A concurrent change during checking
fails closed; Task 7 defines the eventual settlement compare-and-swap.

## Retained-output custody and restart

Use the Task 3 copy carrier as the correctness substrate. A retained child contains:

- an immutable adopted basis descriptor and independently custodied required Git objects;
- an isolated mutable filesystem tree containing only the mode's managed world;
- a private Git-state descriptor/index copy when needed for faithful Git-aware execution;
- exact repository, worktree, binding, basis, and parent revision citations;
- a closed lifecycle state and content-addressed publication receipt.

Do not attach a retained child as a linked worktree to the user's common Git directory: linked
worktrees share refs and objects and can therefore mutate ordinary repository state. An optimized
future implementation may use an isolated repository or detached worktree only if it proves the
same history/index preservation and reopen guarantees as the copy carrier.

After process restart, reopen from the closed descriptor, verify all copied objects/manifests and
containment, and re-establish the exact baseline/custody identity. Never reconstruct authority from
an unverified directory scan or from whatever the user's current HEAD happens to be.

## Preservation and fail-closed guarantees

Capture and test the user's refs, HEAD bytes, index bytes, config, sparse files, worktree
administrative files, object inventory, and ordinary files before and after adoption. Initialization,
capture, reopen, verify, and discard must not mutate them. No commit, checkout, reset, stash,
worktree add/remove, ref update, index refresh, sparse reapply, submodule update, fetch, gc, or prune
is allowed at this boundary.

The full Phase 3 conformance gate requires stable errors that distinguish non-repository/bare/
inexact root, unavailable HEAD baseline, unsupported index/conflict, concurrent repository
movement, unsafe nested repository/submodule, missing object/alternate, unsupported object format,
and custody corruption. Protocol v4 initially groups these into configured baseline, unsupported,
movement, and custody-control codes with diagnostic detail; the exhaustive code taxonomy remains a
recorded hardening item and is not claimed by the core Task 4 slice. Failures publish no usable
retained child and preserve the user's repository exactly.

## Task 5 boundary

Task 4 owns acquisition, semantic basis identity, isolated retained custody, verification, and
restart. Task 5 defines the complete changeset between two verified world revisions:

- add/modify/delete/type/mode/symlink/submodule changes;
- index versus worktree presentation;
- rename as derived information;
- safe previews and content citations;
- how sparse/ignored exclusions appear in inspection.

Task 4 may compare manifests for integrity and movement but must not freeze a second, incomplete
public changeset model.

## Required conformance matrix

- `none`, `git-head`, and `worktree` on attached, detached, and unborn HEAD;
- clean, staged, unstaged, staged-plus-unstaged, untracked, and ignored paths;
- intent-to-add, assume-unchanged, skip-worktree, sparse index, and conflicts;
- native symlinks and `core.symlinks=false` behavior;
- clean/dirty/uninitialized submodules and undeclared embedded repositories;
- main and linked worktrees with shared common state and distinct per-worktree state;
- cone/non-cone sparse checkout and transient vivification;
- local/relative/absolute/unavailable object alternates and missing objects;
- concurrent HEAD, index, worktree, sparse, and submodule movement at every capture boundary;
- byte-for-byte preservation of refs, index, config, sparse metadata, and user files;
- reopen/verify/discard after restart without the original alternate or current user HEAD;
- disk-full, permission-denied, interrupted publication, and corrupt custody.

## Remaining Shepherd oracle gaps

Before claiming Python `0.3.0` parity, run the pinned implementation for every adoption mode and
capture its exact treatment of unborn/detached HEAD, index flags/conflicts, ignored files,
submodules, linked worktrees, sparse checkout, alternates, basis movement, errors, custody layout,
and restart. The verified upstream claim remains limited to the mode vocabulary, default
`worktree`, `.vcscore` custody, retained user-worktree isolation, and no ordinary Git-history
mutation.
