# Optimized Scope-World Carriers

Implementation: [`src/workspace/carrier-backends.ts`](../src/workspace/carrier-backends.ts) and
[`src/workspace/reference-copy-carrier.ts`](../src/workspace/reference-copy-carrier.ts).
Configuration: `workspaces.carrierBackends` in [`protocol.config.json`](../protocol.config.json),
validated by [`src/protocol/config-carrier-backends.ts`](../src/protocol/config-carrier-backends.ts).
Public entry point: `createReferenceCopyCarrier({ workspaceRoot, backend })` in
[`src/index.ts`](../src/index.ts). Shared suite:
[`test/workspace/carrier-conformance.ts`](../test/workspace/carrier-conformance.ts), run by
[`test/workspace/carrier-conformance.test.ts`](../test/workspace/carrier-conformance.test.ts).
Linux container run: [`scripts/test-carriers-linux.ts`](../scripts/test-carriers-linux.ts)
(`pnpm test:carriers:linux`). Benchmark: [`scripts/bench-carriers.ts`](../scripts/bench-carriers.ts)
(`pnpm bench:carriers`).

## Backend contract

Workspace protocol v26 adds configured backend vocabulary `copy`, `clone`, and `overlay`.
`createReferenceCopyCarrier` accepts an optional exact `backend`; omitting it selects `copy`, the
unchanged correctness reference. The frozen carrier exposes the selected `backend`. Every existing
carrier and composed API (snapshot, fork, openRevision, openCustody, captureCustody, verifyRevision,
verifyCustody, discard, changesets and inspection, retained settlement, `forkScope`, `mergeScope`,
and `discardScope`) takes the same carrier object and runs unchanged on every backend.

An optimized backend is opened only after a deterministic host probe inside the carrier's private
staging directory succeeds. A refused probe throws `WorldCarrierError` with the configured
`WORLD_CARRIER_BACKEND_UNAVAILABLE` code and a message naming the backend and configured reason.
There is no fallback: a clone carrier never silently byte-copies, and an overlay carrier never
silently copies custody.

## Identity equality

Backends change physical materialization only. Every revision is written in the existing copy
descriptor format with the same `backend` descriptor value, `capture_kind` (quiescent verified
copy), manifest, content ID, and revision ID derivation, so revision identity does not depend on the
backend and any backend opens any revision. Captures remain verified double scans of the custody
world, so content, revision, and changeset IDs equal the copy carrier's for the same tree. The
suite proves this on one workspace: a revision published by the optimized backend is re-snapshotted
by the copy carrier with an exactly equal closed descriptor, equal edits captured through both
carriers converge on one revision, and changesets built through both carriers share one
`changeset_id`. Discard decision markers are also backend independent.

Custody descriptors record the materializing backend in `WorldCustody.backend`. Copy and clone
custody are plain directories and either backend opens the other's custody. Overlay custody adds
exact `upper_identity` and `work_identity` fields; non-overlay carriers refuse overlay custody and
overlay carriers refuse directory custody.

## Clone backend

The clone backend materializes every regular file (snapshot staging, captured revisions, forked
custody, merge application custody, selection staging, and user-path publication) by cloning the
already-read and digested source file, then reopening the clone without following links and
requiring a single-link regular file whose bytes equal the verified bytes before applying and
flushing the manifest mode. On Linux the clone is `copyFileSync` with
`COPYFILE_EXCL | COPYFILE_FICLONE_FORCE` (FICLONE on reflink filesystems). Any clone failure,
including `ENOTSUP` on non-APFS volumes or `EXDEV` across devices, fails closed with the unavailable
code. The carrier probe clones one file inside carrier staging.

### macOS clone helper

Node v24 (libuv 1.52.1) cannot force a clone on macOS: `COPYFILE_FICLONE_FORCE` returns `ENOSYS`,
and both `COPYFILE_FICLONE` and `cp -c` silently fall back to byte copies. Measured on APFS, a
300 MB `COPYFILE_EXCL | COPYFILE_FICLONE` copy consumed about 301 MB of free space, while
`cp -c` consumed none. A filesystem-type or device probe cannot distinguish that fallback, so the
macOS clone path calls `clonefile(2)` directly, which fails with `ENOTSUP` or `EXDEV` instead of
copying.

- Toolchain requirement: selecting `backend: "clone"` on macOS requires one of the configured
  compilers (`/usr/bin/cc`, `/usr/bin/clang`; Xcode Command Line Tools). The helper is built only
  when a clone carrier is created on macOS. Without a compiler, or when compilation fails, creation
  refuses with reason `clone-helper-unavailable`. The copy and overlay backends never compile or
  spawn it.
- Process cost: the helper is compiled once per process (about 0.8 s including the probe on the
  development host) and each cloned regular file spawns one helper process (about 9 ms per file on
  the development host), so clone trades CPU time for storage. Worlds with many small files may be
  slower to fork than with copy.
- Security rationale: the fixed C source is written with exclusive creation into a fresh
  `mkdtemp` directory, forced to mode 0700; the compiled executable is forced to mode 0500. Before
  every use the carrier verifies that the directory is a 0700 directory and the executable a
  single-link 0500 regular file, both owned by the current user, and that the executable digest
  equals the digest recorded at compilation; any mismatch fails closed as a control error. The
  helper receives only two paths as arguments, runs without a shell under the configured timeout
  and output bound, and is removed when the process exits. The helper does not verify content;
  the carrier reopens every clone and compares it byte for byte with the verified source bytes.

Publication into a user binding clones from control storage, so the binding must share a
reflink-capable filesystem with the workspace control root. A publication that fails midway keeps
the retained selection journal's exact-recovery contract; reopening the same workspace with the
copy backend and retrying converges because staging and step receipts are backend independent.

## Overlay backend

The overlay backend is Linux only. Revisions, staging, and publication are ordinary verified copies.
Forked custody is a directory containing the closed descriptor, an empty mount-point `world`, and
private `upper` and `work` directories whose device/inode identities are recorded in the descriptor
before atomic publication. After publication the carrier runs the configured mount executable
without a shell to mount `overlay` with the immutable base revision world as `lowerdir` at the
custody `world` path. Writes, deletions (whiteouts), and mode changes land only in `upper`; the
lower revision is never written and continues to verify.

Every custody open authenticates the mount through `/proc/self/mountinfo`: the mount at the exact
world path must have the configured filesystem type and exactly the rendered lower, upper, and work
options. If no mount is present (process or host restart), the carrier re-checks both layer
identities, requires the unmounted world directory to be empty, remounts from retained evidence, and
re-authenticates. A foreign mount, replaced layer, or stray entry in the unmounted world fails
closed. Capture and verification read the merged view. Discard verifies, unmounts, and only then
removes the owned custody root. Layer paths containing `,`, `:`, or `\` cannot be expressed as mount
options and are refused. The creation probe mounts a private overlay in staging, writes through it,
and proves the write reached only its upper layer before unmounting.

## Conformance matrix

| Backend | macOS APFS host | macOS HFS+ image | Linux container tmpfs | Linux container loopback XFS `reflink=1` | Hosts without support |
| ------- | --------------- | ---------------- | --------------------- | ---------------------------------------- | --------------------- |
| copy | full suite | not run | full suite | full suite | full suite |
| clone | full suite | refusal: `reflink-unsupported` | refusal: `reflink-unsupported` | full suite, required | refusal |
| overlay | refusal: `platform-unsupported` | not run | full suite, required | full suite, required | refusal |

The suite covers snapshot, fork, capture, `verifyRevision`/`verifyCustody`, discard, restart
reopen (overlay unmounts first), identity equality with copy, source and base isolation,
unsupported FIFO, hard-link, and escaping-symlink entries, backend mismatch refusal, and the scope
seam: a nested world parent and child, disjoint `mergeScope`, restart convergence of the completed
merge through a new carrier after dropping volatile state, and `discardScope` of a forked subtree.
The container run additionally requires overlay to be conformant and exercises overlay contradiction
refusal.

Evidence recorded for this change:

- macOS 26 arm64, Node v24.17.0, APFS temporary directory:
  `node --test test/workspace/carrier-conformance.test.ts` passed 12 of 12 with 0 skipped (copy and
  clone suites, overlay refusal, HFS+ clone refusal).
- `pnpm test:carriers:linux`: `node:24-bookworm` (Node v24.21.0, linux arm64) under OrbStack,
  `--privileged`, repository copied onto tmpfs without host `node_modules`, dependencies installed
  with `pnpm install --frozen-lockfile`. On tmpfs with overlay required: 12 of 12 passed, 0 skipped
  (copy and overlay suites, clone refusal, overlay contradictions). On a 2 GiB loopback XFS image
  created with `mkfs.xfs -m reflink=1` with clone and overlay required: 15 of 15 passed, 0 skipped
  (copy, clone, and overlay suites, overlay contradictions). Both benchmarks ran in the same
  container.

Hosts without host support must not be read as conformant: `inspectWorkspacePlatformConformance`
reports `optimized_carriers` per workspace filesystem as described in
[Workspace platform and fault conformance](./platform-fault-conformance.md).

## Storage scaling benchmark

`pnpm bench:carriers` reads [`config/carrier-benchmark.config.json`](../config/carrier-benchmark.config.json).
For each world of 16 and 64 files of 1 MiB random bytes it snapshots the binding, then for each
available backend and each changed suffix of 1 and 4 whole files repeats five times: flush, read
free blocks with `statfsSync`, fork a branch, delete and durably rewrite the last files of the
world, flush, and read free blocks again. The reported branch storage is the median delta; overlay
also reports upper-layer allocated bytes. Whole-file suffixes are used because overlay copies a
file up on first write. The script prints a JSON report and asserts that copy branch storage is at
least 0.75 of the world and grows by at least 0.75 of the world-size difference, and that clone and
overlay branch storage stays within 1.5 times the changed bytes plus 8 MiB.

Measured branch storage (MiB, median of five):

| Host | Backend | World 16, changed 1 | World 16, changed 4 | World 64, changed 1 | World 64, changed 4 |
| ---- | ------- | ------------------- | ------------------- | ------------------- | ------------------- |
| macOS APFS | copy | 16.02 | 16.26 | 64.05 | 64.04 |
| macOS APFS | clone | 1.05 | 4.01 | 1.03 | 4.05 |
| Linux tmpfs | copy | 16.00 | 16.00 | 64.00 | 64.00 |
| Linux tmpfs | overlay (upper layer) | 1.00 (1.00) | 4.00 (4.00) | 1.00 (1.00) | 4.00 (4.00) |
| Linux XFS reflink | copy | 16.01 | 16.01 | 64.04 | 64.04 |
| Linux XFS reflink | clone | 1.01 | 4.01 | 1.04 | 4.04 |
| Linux XFS reflink | overlay (upper layer) | 1.00 (1.00) | 4.00 (4.00) | 1.00 (1.00) | 4.00 (4.00) |

APFS free-space readings include unrelated host activity, which is why the bound carries fixed
overhead and the median is reported; tmpfs readings in the container are exact. Filesystems such as
XFS return freed extents asynchronously, so each sample waits for free space to return to its
baseline, within a configured bound, before the next sample starts. The integration rerun recorded
copy 16.02/16.02/63.97/64.04 and clone 1.01/3.97/1.02/4.06 on macOS APFS; copy 16.00, overlay
1.00/4.00 on Linux tmpfs; and copy 16.01–64.04, clone 1.01/4.01/1.04/4.04, and overlay 1.00/4.00 on
Linux XFS reflink.

## Scope algebra laws across carriers

The [scope algebra law suite](./scope-laws.md) runs its seeded reference-model sequences once per
backend the host reports conformant. On macOS APFS it runs copy and clone. `pnpm test:carriers:linux`
also runs it on loopback XFS with clone and overlay required, so every backend passes the same
correctness laws as the copy reference.

## macOS clone helper threat model

The helper's digest, owner, single link, and modes are checked immediately before each execution,
but the check and the execution are separate steps. A process running as the same user could swap
the file in between. That user can already write the workspace, and each clone is still reopened
and compared byte for byte with the verified source with exactly one link, so a substituted helper
cannot publish unverified content. `clonefile(2)` also copies extended attributes and ACLs, but
sources carrying unsupported metadata are refused before capture, and captured regular files keep
only their verified bytes and mode in the manifest.

## Non-claims

- Captured revisions, selection staging, and user publication under the overlay backend remain full
  verified copies; overlay scales branch custody storage only.
- No Windows ReFS block cloning, btrfs or ZFS snapshot carriers, unprivileged or user-namespace
  overlay mounts, or distributed storage.
- Cloning and overlay do not make capture kernel-atomic; captures stay quiescent verified scans and
  keep the configured verified-copy classification, so
  [`classifyScopeCheckpoint`](./scope-fork.md#start-classification) reports every fork's start as
  `quiescent_verified_copy` on every backend. Scope fork records deliberately do not name the
  backend: the backend is physical materialization, never semantic identity, and records stay
  byte-identical across backends.
- Coverage: overlay code and host-specific clone mechanisms are excluded from line coverage with
  justified `node:coverage` blocks and are exercised by the host runs above instead.
