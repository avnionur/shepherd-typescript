# Reference Copy Carrier Research

Status: Phase 3 Task 3 implementation input

Research date: 2026-08-11

Pinned shipped revision: `a8196d4c453514836d06bd2fece91a03cdc37107` (`v0.3.0`)

Pinned development revision: `d45074e0099d9ccafeed4a233702ad68ff8a2fa6`

## Evidence boundary

Reviewed sources:

- [generated v0.3.0 CLI reference](https://docs.shepherd-agents.ai/reference/cli/)
- [installed-package v0.3.0 quickstart](https://docs.shepherd-agents.ai/start/)
- [pinned shipped source tree](https://github.com/shepherd-agents/shepherd/tree/a8196d4c453514836d06bd2fece91a03cdc37107)
- [pinned development source tree](https://github.com/shepherd-agents/shepherd/tree/d45074e0099d9ccafeed4a233702ad68ff8a2fa6)
- [`architecture.md`](./architecture.md), “Workspace and versioned worlds”
- [`implementation-roadmap.md`](./implementation-roadmap.md), Phase 3
- [`testing-and-release.md`](./testing-and-release.md), filesystem/security/recovery matrices
- [`Agent-Runtime-Architecture.md`](./Agent-Runtime-Architecture.md), §22.3

The shipped CLI lists `copy` as a selectable workspace backend. The quickstart verifies the public
outcome: task work lands as a retained proposal and does not touch the user's files before explicit
settlement. The reviewed public material does not publish a copy-carrier API, manifest schema,
on-disk layout, content-identity algorithm, crash protocol, or exact error taxonomy.

The `WorldCarrier` interface and the detailed contract below are therefore TypeScript architecture,
not a reproduced Python-internal format. Pinned-oracle comparison applies only where the upstream
surface exposes equivalent behavior.

## Architecture requirements

The local architecture makes the copy backend the universal correctness reference. Every later
optimized backend must pass its contract. The complete carrier abstraction is:

```ts
interface WorldCarrier {
  snapshot(binding: Binding): Promise<WorldRevision>;
  fork(base: WorldRevision): Promise<WorldRevision>;
  diff(base: WorldRevision, head: WorldRevision): Promise<Changeset>;
  materialize(revision: WorldRevision, target: Binding): Promise<Receipt>;
  merge(parent: WorldRevision, child: WorldRevision): Promise<MergeResult>;
  discard(revision: WorldRevision): Promise<void>;
  verify(revision: WorldRevision): Promise<VerificationResult>;
}
```

Task 3 establishes durable custody and the `snapshot` / `fork` / `verify` / carrier-level `discard`
lifecycle. Complete changeset semantics, task-world capture, inspection, and settlement are later
Phase 3 tasks. `diff`, `materialize`, and `merge` must eventually use the same manifest and revision
contract rather than introduce another world identity.

Required logical filesystem coverage is:

- regular-file bytes;
- directories, including empty directories where semantically required;
- executable and other supported mode changes;
- symlink nodes and their target text, without dereferencing them during copy;
- deterministic content digests;
- explicit failure for unsupported filesystem objects.

Rename detection is derived information and cannot affect revision identity. The control root
`.vcscore` is protected, and path escape is rejected.

## TypeScript-owned lifecycle contract

### Identity separation

Keep three identities distinct:

1. A blob ID identifies exact regular-file bytes.
2. A world-content ID identifies one canonical ordered filesystem manifest.
3. A revision ID binds world content to schema version, binding identity, and parent/basis evidence.

A mutable fork also needs a custody receipt or checkout ID. It may initially have the same
world-content ID as its base but is not an immutable verified revision after mutation. Storage
paths, timestamps, temporary names, inode numbers, and copy receipts are non-semantic.

Use the repository's canonical-record and configured digest/domain contracts. Do not derive an ID
from an absolute custody path or Git commit.

### Canonical manifest

Walk with `lstat` semantics and create one entry per managed relative path, ordered by canonical
path bytes. Each entry contains only its supported semantics:

- directory: kind and supported mode;
- regular file: kind, supported mode, byte length, and blob digest;
- symbolic link: kind and link target, never target contents.

Relative paths use one manifest separator independent of the host separator, reject `.` / `..`,
NUL, malformed Unicode, duplicate normalized names, and escape from the canonical binding root.
Timestamps, ownership, inode values, allocation layout, and host receipt data do not affect content
identity. Sparse files are represented by their logical bytes; sparse allocation is an optional
storage optimization.

The initial portable mode contract should preserve ordinary permission/executable bits on POSIX
and report the actual supported subset on Windows. Set-id bits, device semantics, ACLs, extended
attributes, resource forks, and hard-link topology must not be silently lost: either add an
explicit versioned representation or reject the affected entry as unsupported.

Allow intact and broken relative symlinks as nodes. Reject absolute targets, lexically escaping
targets, symlink loops encountered during authority checks, and any alias into the protected
control root. Copying a symlink must never read or copy its referent.

### `snapshot(binding)`

1. Reopen and verify the binding identity and canonical root from Task 2.
2. Resolve the exact protected control-root identity from workspace configuration; exclude that
   subtree, and reject aliases that could re-enter it.
3. Copy into a private staging directory inside carrier custody while hashing bytes and building
   the manifest. Never create or modify a path in the user working tree.
4. Detect source mutation by checking each entry before and after read and validating a second
   source scan against the captured manifest. A detected concurrent change fails or performs a
   configured bounded retry; it never publishes a knowingly mixed snapshot.
5. Verify the staged tree against its manifest, write the closed revision descriptor, and publish
   atomically. Return only after the durable revision is reopenable.

The source scan cannot claim a kernel-atomic point-in-time snapshot on ordinary filesystems. Its
evidence must say that it is a verified copy capture, and concurrent mutation that cannot be ruled
out must fail closed rather than be labeled atomic.

### `fork(base)`

Verify the immutable base, copy it only into a private staging location, and publish a distinct
custody descriptor atomically. The completed child initially has the same world content as the
base, its authority is no stronger than the binding, and mutations affect only the retained child.
Failure publishes no usable child.

The mutable child path is an internal receipt, not semantic identity. Reopening it requires its
closed descriptor, base revision, binding identity, lifecycle state, and containment beneath the
configured custody root. Structural sharing, clonefile, overlay, FUSE, and Git worktrees are later
optimizations and must preserve this observable behavior.

### `verify(revision or custody)`

Verification must:

- validate the closed descriptor and schema version;
- resolve every storage path beneath the configured custody root;
- reject missing, extra, substituted, or unsupported entries;
- recompute file digests, link targets, modes, manifest ID, and revision ID;
- verify base/parent and binding citations;
- reject protected-path aliases and path escape;
- return structured evidence rather than treating “directory exists” as success.

An altered immutable revision is corrupt and must never be reused as a valid base. A mutable child
is verified against its current captured state or explicitly reported as modified; it cannot retain
the base's revision claim after mutation.

### `discard(custody)`

Carrier discard is physical custody cleanup, not the later user-facing consume-once settlement
decision. It accepts an exact owned custody ID, records or atomically publishes the discarded
state, and removes only a path proven to be beneath the carrier custody root. It is idempotent for
the same completed decision, leaves the immutable parent and user workspace unchanged, and cannot
follow symlinks during cleanup.

Shared immutable revisions require reference-aware collection; discarding one child must not delete
a base still cited by another child. Interrupted deletion reopens as discarded, safely retryable,
or manual-recovery-required, never as an invented success.

## Crash-safe publication and reopen

All staging and final paths must be on the same filesystem under configured carrier custody.
Publication order is:

1. create an exclusive, non-semantic staging directory;
2. copy entries and write content-addressed blobs;
3. flush file data needed by the durability policy;
4. write and flush the canonical manifest and closed descriptor last;
5. atomically rename staging to its final identity-derived location;
6. flush the parent directory where the platform supports it.

An existing final identity is reusable only after full verification and exact semantic equality.
Identity collision with different bytes is corruption. Incomplete staging is never discoverable as
a revision; recovery classifies it explicitly and may safely quarantine or retry cleanup.

Reopen starts from the durable descriptor, not a directory scan that guesses lifecycle state. It
revalidates containment, schema, IDs, and complete-marker ordering before returning authority.

## User-worktree and TOCTOU guarantees

Before settlement tasks are implemented, every copy-carrier operation is read-only with respect to
the user's binding. Snapshot reads it; fork and task mutation occur only in carrier custody; verify
reads custody; discard deletes only owned custody. No operation runs checkout, reset, commit, index,
or ref mutation against the user's repository.

Canonical roots and control paths must be revalidated at each filesystem mutation boundary. Use
descriptor-relative operations and no-follow inspection where available. A path, symlink target,
file type, size, mode, or modification identity changing during capture causes a retry/failure, not
silent acceptance. Publication must use exclusive creation and atomic rename so concurrent writers
either converge on identical verified content or one fails without replacing the winner.

## Platform behavior

The reference contract is logical, not byte-for-byte equality of host metadata:

- manifest paths and ordering are platform-neutral;
- case collisions are rejected on hosts where they cannot coexist safely;
- POSIX mode support and Windows mode limitations are recorded explicitly;
- Windows symlink creation/reading failures are structured unsupported-platform or permission
  errors, never an implicit regular-file copy;
- long paths, Unicode names, binary files, sparse logical content, executable bits, intact and
  broken symlinks, and delete/recreate cases belong in the reference suite;
- atomic publication must account for platform rename semantics and stay on one volume;
- permission denied, disk full, concurrent mutation, and interruption leave no published partial
  revision.

Optimized carriers pass this logical suite on each supported platform. Platform receipts may differ
without changing semantic content identity.

## Task 4 Git-aware boundary

Task 3 treats `.git` and any other non-protected managed entry with generic filesystem semantics; it
does not interpret repository state. Task 4 adds:

- adoption mapping for `git-head` and `worktree`;
- repository identity, HEAD/unborn-HEAD, index, tracked, untracked, ignored, submodule, and worktree
  semantics;
- Git-aware baseline/basis evidence and retained-output custody;
- repository-specific object/worktree optimization and history-safety checks;
- detection of user basis movement for later settlement.

Task 3 must not use a Git commit as the generic world revision, silently filter files according to
Git ignore rules, or mutate ordinary Git history. A later Git carrier remains conformant only if
its captured logical world, fork isolation, verification, reopen, and discard behavior matches the
copy reference.

## Required Task 3 test matrix

- empty tree, empty directories, ordinary text, binary, long, Unicode, and sparse files;
- deterministic ordering and equal-content/equal-ID properties;
- executable/permission modes and explicitly unsupported metadata;
- intact, broken, escaping, chained, and looping symlinks;
- FIFO, socket, device, and hard-link policy failures;
- exact exclusion and alias protection for `.vcscore`;
- fork initially equals parent; child mutation does not alter parent or user files;
- verify detects every covered content, type, target, and mode change;
- discard is exact, idempotent, symlink-safe, and parent-preserving;
- process restart and reopen after completed snapshot/fork;
- interruption before/after blob, manifest, descriptor, rename, and parent flush;
- disk-full and permission-denied cleanup/recovery;
- concurrent source mutation and concurrent publication of equal/different content;
- case-sensitive and case-insensitive filesystem behavior where available.

## Oracle gaps

Before claiming Python `0.3.0` copy-backend parity, extract pinned fixtures for its control layout,
manifest semantics, copy exclusions, modes, symlink policy, ignored/untracked handling, hard links,
special files, recovery markers, error taxonomy, and reopen/discard behavior. The currently verified
upstream contract is only that `copy` is a selectable backend and retained task work stays away from
the user's files until settlement.
