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
`COPYFILE_EXCL | COPYFILE_FICLONE_FORCE` (FICLONE on reflink filesystems). Node's libuv does not
implement forced cloning on macOS (`COPYFILE_FICLONE_FORCE` returns `ENOSYS`, and `COPYFILE_FICLONE`
silently byte-copies), and `cp -c` silently falls back to copying, so macOS clones through a small
`clonefile(2)` helper compiled once per process with a configured compiler into a private temporary
directory and integrity-checked by digest before every use. Any clone failure, including `ENOTSUP`
on non-APFS volumes or `EXDEV` across devices, fails closed with the unavailable code. The carrier
probe clones one file inside carrier staging.

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

| Backend | macOS APFS host | macOS HFS+ image | Linux container (tmpfs, privileged) | Linux or Windows without support |
| ------- | --------------- | ---------------- | ----------------------------------- | -------------------------------- |
| copy | full suite | not run | full suite | full suite |
| clone | full suite | refusal: `reflink-unsupported` | refusal: `reflink-unsupported` | refusal |
| overlay | refusal: `platform-unsupported` | not run | full suite, required | refusal |

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
  `--privileged`, workspace on tmpfs, dependencies installed with `pnpm install --frozen-lockfile`:
  12 of 12 passed with 0 skipped (copy and overlay suites, clone refusal, overlay contradictions).

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

| Host | Backend | World | Changed | Branch | Upper layer |
| ---- | ------- | ----- | ------- | ------ | ----------- |
| macOS APFS | copy | 16 | 1 | 16.21 | |
| macOS APFS | copy | 16 | 4 | 16.14 | |
| macOS APFS | copy | 64 | 1 | 64.51 | |
| macOS APFS | copy | 64 | 4 | 64.27 | |
| macOS APFS | clone | 16 | 1 | 1.32 | |
| macOS APFS | clone | 16 | 4 | 4.13 | |
| macOS APFS | clone | 64 | 1 | 1.75 | |
| macOS APFS | clone | 64 | 4 | 7.52 | |
| Linux tmpfs | copy | 16 | 1 | 16.00 | |
| Linux tmpfs | copy | 16 | 4 | 16.00 | |
| Linux tmpfs | copy | 64 | 1 | 64.00 | |
| Linux tmpfs | copy | 64 | 4 | 64.00 | |
| Linux tmpfs | overlay | 16 | 1 | 1.00 | 1.00 |
| Linux tmpfs | overlay | 16 | 4 | 4.00 | 4.00 |
| Linux tmpfs | overlay | 64 | 1 | 1.00 | 1.00 |
| Linux tmpfs | overlay | 64 | 4 | 4.00 | 4.00 |

APFS free-space readings include unrelated host activity, which is why the bound carries fixed
overhead and the median is reported; tmpfs readings in the container are exact.

## Non-claims

- Captured revisions, selection staging, and user publication under the overlay backend remain full
  verified copies; overlay scales branch custody storage only.
- No Windows ReFS block cloning, btrfs or ZFS snapshot carriers, unprivileged or user-namespace
  overlay mounts, or distributed storage.
- Cloning and overlay do not make capture kernel-atomic; captures stay quiescent verified scans and
  keep the configured verified-copy classification. Scope fork records do not yet carry a backend
  or start classification.
- Coverage: overlay code and host-specific clone mechanisms are excluded from line coverage with
  justified `node:coverage` blocks and are exercised by the host runs above instead.
