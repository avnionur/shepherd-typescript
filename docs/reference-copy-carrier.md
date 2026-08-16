# Reference Copy Carrier

Implementation: [`src/workspace/reference-copy-carrier.ts`](../src/workspace/reference-copy-carrier.ts).
Public exports: [`src/index.ts`](../src/index.ts). Production-seam tests:
[`test/workspace/reference-copy-carrier.test.ts`](../test/workspace/reference-copy-carrier.test.ts).

## Public contract

`createReferenceCopyCarrier({ workspaceRoot })` opens workspace protocol v3 copy custody beneath
the protected control root. `snapshot(binding)` revalidates the protocol v2 binding, captures its
logical filesystem tree into private staging, verifies a second source traversal and the staged
tree, writes a closed descriptor, and atomically publishes an immutable `WorldRevision`. Revision
identity includes the configured verified-copy classification, adopted workspace basis citation,
binding, content, versions, and an explicit null parent for a binding snapshot. The closed
descriptor retains the binding name and canonical root so reopen can re-run protocol v2 binding
validation instead of trusting the binding digest alone.

`fork(revisionId)` verifies the immutable base and publishes a distinct `WorldCustody`. The fork is
initially content-equal to the base but is mutable: task work may change its returned path without
changing the immutable revision or user workspace. `verifyRevision` rejects immutable drift;
`verifyCustody` recomputes current content and reports whether it differs from the base. Closed
descriptors support exact reopen after process restart.

`captureCustody(custodyId)` double-scans the isolated mutable world, copies it into staged immutable
custody, and publishes a verified child revision whose `parent_revision_id` is the custody's exact
base revision. Equal repeated capture converges on the same revision, and reopening verifies its
closed descriptor and bytes. The caller must already have proved writer quiescence; Task 6B owns
that execution fence and durable capture journal.

`discard(custodyId)` durably records the exact discard decision before removing only the owned
mutable custody directory. Repeating the same discard is safe. It never removes the immutable base
or user files, and substituted symlink targets fail closed. Every retry validates the closed
versioned discard descriptor before treating the decision as authoritative.

## Logical identity and filesystem coverage

Regular-file bytes receive configured blob IDs. A canonical ordered manifest gives the whole tree
a world-content ID. A revision ID separately binds that content to the exact binding and carrier
protocol. Mutable custody has its own random receipt identity; absolute storage paths, inode values,
timestamps, and custody IDs do not affect world-content identity.

The manifest represents regular files and supported permission bits, directories including empty
ones, and relative symlink target text without dereferencing links. Unicode-normalization
collisions are rejected while retained path spelling stays exact. Binary and Unicode filenames,
intact and broken contained links, and logical sparse-file bytes are supported. Hard links, FIFO or
other special objects, escaping or absolute links, malformed names, and unsupported permission
semantics fail closed with configured `WorldCarrierError` codes. The exact workspace control root
is excluded. Workspace protocol v18 rejects configured protected names at any managed depth,
including case-folded, trailing-character, alternate-name, and resolved symlink aliases, with
versioned `WorkspaceProtectedPathError` evidence.
Contained looping symlink nodes are retained as target text because carrier traversal never follows
them; any link encountered while establishing directory authority must resolve to that exact
directory or the operation fails.

On Windows, `mode` is the normalized low nine bits exposed by Node `lstat` and accepted by Node
`chmod`; it does not claim POSIX ownership, ACL, or independent user/group/other enforcement.
ACLs, extended attributes, resource forks, and retained Windows alternate-stream content are not
yet portable managed semantics. Protected-path case and alternate-name comparisons are
deterministic under the v18 policy, but this slice does not claim to preserve those broader
filesystem values; the roadmap retains explicit carrier hardening before
optimized backends can claim reference parity.

## Durability and current boundary

Staging and final custody remain on one filesystem under `.vcscore`. File bytes and permission
modes, descriptors, newly created carrier directories, and publication parents are flushed;
descriptors are written last and final publication uses atomic rename. Incomplete staging is not
reopenable authority. Existing identity publication is reusable only when its closed descriptor
is exactly equal to the candidate and the retained tree verifies. Source entry identity and
directory membership are checked around reads, but an ordinary copy cannot claim a kernel-atomic
point-in-time snapshot; detected movement fails closed.

This is the correctness-reference carrier, not complete settlement. Authenticated task-world
execution, selection, and settlement remain later Phase 3 tasks. Task 3 treats
`.git` generically and never uses a Git commit as generic world identity.

The automated suite covers ordinary restart, corruption, staging cleanup, source isolation, and
the portable filesystem matrix. Deterministic disk-full, process-kill-at-fsync, permission-race,
and case-insensitive collision injection still require the planned carrier fault harness; those
failure boundaries are not reported as verified in this release.
