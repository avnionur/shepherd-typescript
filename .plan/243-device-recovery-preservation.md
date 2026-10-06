# Issue243 device-layer recovery preservation

Base: main `edf6d14` (13.7.0, PR283). Branch `codex/phase-14-243-device-recovery`.
Parent235 active, no blocking issue. Read complete issue/comments and parent, AGENTS, preservation
skill, device-layer/optimized-carrier normative contracts, device-layer engine/types in full.

| Capability | Existing evidence | Risk | Required verification |
| --- | --- | --- | --- |
| Named layered worlds | device-layer.test.ts / conformance kit | High | Existing copy/clone and custom-adapter laws unchanged |
| Depth/compaction/retired names | conformance kit depth case | High | Identical kept bytes/names before and after restart and interrupted compaction |
| Restore and branch replacement | conformance kit checkpoint case | High | Restored bytes, discarded names reusable, retired names remain refused |
| Adapter selection | selection/fallback tests | High | Explicit retained support for copy and probe-supported clone; refuse unsupported adapters |
| File/path/cleanup ownership | existing path tests and carrier contract | High | Exact root identity, symlink/replacement refusal, no deletion of unrelated paths |
| New durable lifecycle | Issue243 | High | Explicit journal, backend/config identity, writable generation and read-only diagnosis |
| Interrupted operations | Issue243 | High | Real process death during freeze/restore/compaction/cleanup; deterministic exact-identity recovery |
| Concurrent/stale handles | New durable ownership contract | High | Serialized publication, stale generation refusal, no blind takeover of uncertain work |
| Distribution/adjacent behavior | package and full gates | High | Public declarations, version/schema/docs, full verify and desktop build |

Initial scope: retain a separate explicit durable lifecycle while preserving ordinary process-scoped
world behavior. Start with the reference copy adapter and local probe-supported clone adapter;
overlay/container/custom recovery remains fenced until each has its own recovery protocol. No claim
that ordinary scopes/replay use these layers (that composition is issue244). Durable metadata must
bind configuration, device/resource identity, named layers, ordinal, retired names, writable
generation and pending/committed operation state. Recovery must verify exact identity and refuse
corruption or replaced resources before mutating or cleaning paths. Journal publication must survive
process death and distinguish completed, retry-safe and uncertain steps. Final storage/ownership
mechanism is still being evaluated before code edits.

Baseline command running: Node24.17.0 `caffeinate -i node --test test/workspace/device-layer.test.ts`.
Use command-scoped caffeinate for expensive full/native gates to prevent previously diagnosed host
idle-sleep timeouts. No dependency changes planned; frozen install used `--ignore-scripts`.

Baseline result: 13/13 existing device-layer tests pass on Node24.17.0 macOS/APFS, including copy,
clone, custom in-memory adapter and unsupported overlay/container classification. No production
code has changed yet.

## Design direction under evaluation

Prefer a store-bound retained-world API with canonical lifecycle/operation records plus local
ownership bookkeeping. Persist adapter/configuration identity, exact resource roots, named layers,
ordinal/retired names and writable generation. Imported trace records alone must not authorize
physical recovery or cleanup. Existing `openDeviceLayerWorld` scratch behavior remains unchanged.

Copy/clone work is synchronous, so a store-owned SQLite IMMEDIATE transaction can serialize each
physical stage and verify its expected journal head before mutation; it need not rely on expiring
leases that cannot fence a paused filesystem writer. Publish the operation intent durably before
physical work, then execute idempotent stages under the transaction lock and publish completion.
After process death, pending intent stays visible; exact-head recovery verifies owned resources and
continues or refuses explicitly. No async user callback may escape the lock. Unsupported adapters
must be refused before resource mutation; overlay/container recovery needs separate backend protocols.

Staged copy/clone publication must verify complete bytes/metadata, bind directory ownership, and
avoid deleting source/frozen data until the new state is durable. Replacement/symlink/root-identity
mismatches must stop cleanup. A crash before a new root has any verifiable ownership marker may be
classified uncertain rather than adopted or deleted. Direct writes through a world path still require
caller quiescence; the package cannot fence arbitrary external file descriptors. Scope/replay
composition, remount recovery and constant-time durable capture are not part of this issue.

Names and API shapes remain tentative until the first red-capable process restart test is written.

First red-capable regression now exists at `test/workspace/device-layer-recovery.test.ts` with a
separate-process fixture. It fails on the missing retained lifecycle exports before implementation.
The public draft keeps `openDeviceLayerWorld` unchanged and adds store-bound create/reopen/inspect,
exact-head recovery and explicit command-named checkpoint/restore/cleanup. Durable handle `close`
detaches without cleanup; this is a separate public handle type, not a change to scratch `close`.

Physical publication design: prepared intent captures the expected source tree digest under the
SQLite write lock. Copy/clone into owned staging, verify bytes/metadata and publish new state.
A distinct published phase retains a garbage list before old generations/compacted layers are
removed; completed clears the list. Recovery checks all ownership identities and content before
cleanup, permits already absent journal-owned garbage, and refuses replaced/unknown paths. Restore
uses a new writable directory generation, so publication never requires destroying the old world
first. Compaction preserves the newest flattened state and retirement set. Source drift while an
interrupted copy is incomplete refuses instead of pretending to recreate the original bytes.

## First implementation evidence

- Fresh-process reopen test is green: named layers and writable bytes survive process exit, and
  exact named restoration works in a new process.
- Eight real SIGKILL cases pass on macOS/APFS: copy and actual clone during freeze, restore,
  compaction and cleanup. Journal recovery preserves kept bytes, retired names and sibling files.
- Initial authority tests pass for stale handles, command conflicts, imported/copied database
  refusal, root replacement, symlink payloads, unsupported adapters and malformed options.
- Early Standards review found a real payload replacement gap: wrapper inode alone allowed a
  substituted writable data directory to be cleaned. Public reproduction was red; canonical
  payload dev/inode plus a durable per-wrapper payload receipt now bind it before publication and
  throughout cleanup. New replacement regression passes without touching replacement files.
- Current focused safety run:15/15 passed. Typecheck and early build passed. Full verification,
  generated schema, normative docs/version and final reviews are still pending.
- Actual Linux bind-mount drill passed in an isolated existing `node:24-bookworm` image with
  repository mounted read-only, no network, SYS_ADMIN inside the container. Copy-world restore and
  cleanup refused a same-filesystem foreign bind mount and preserved external sibling bytes.
  Command: `docker run --rm --network none --cap-add SYS_ADMIN --security-opt apparmor=unconfined
  --mount type=bind,source=/private/tmp/shepherd-typescript-243,target=/repo,readonly
  node:24-bookworm node /repo/test/fixtures/device-layer-mount-refusal.ts`.
  Local image ID: `sha256:64af3819f9275802414d7cdc38c27e9d82bd564dec4d4da87d008255d36c63b4`.
  Container fixture: `/tmp/shepherd-device-mount-vbHbbX`; output confirmed both refusal and preservation.

Ownership is tied to the physical SQLite file as well as local (non-exported) registration.
Database backup/copy/native import does not silently acquire authority over the source's live roots.
Garbage payloads are removed before their durable identity receipt and wrapper marker, so a
partially removed payload can resume while its directory identity remains verifiable. Unknown,
replaced or missing ownership metadata stays fenced. Ordinary caller path writes still require
quiescence; no arbitrary external descriptor fencing is claimed.

## Final verification in progress

The implemented contract is documented in `docs/retained-device-layers.md`; design notes above record
its evolution, not additional public promises. MINOR13.8.0 adds a separate API and schema16 while
leaving the scratch engine unchanged. No dependency or lockfile changes.

- Current focused suite passed61/61 before the final admission cases were added. Additional cases
  verify concurrent command appearance under lock and interrupted recovery admission/retry.
- Durability tests exercise22 creation,14 restore and18 cleanup fsync boundaries using real local
  filesystem operations. Missing pre-receipt ownership refuses explicitly; remaining cases recover.
- Filesystem helpers have100% line/branch/function coverage with tests for missing host identity,
  short reads, concurrent file replacement, byte/entry bounds, cross-device paths, mount-table
  dispatch, malformed receipts and interrupted publication. These are fault-seam tests, not claims
  of native Windows support or protection against hostile concurrent ancestor mutation.
- Actual Linux drill rerun after final ownership changes: container fixture
  `/tmp/shepherd-device-mount-vWldbM`; foreign bind mount refused and unrelated bytes preserved.
- Actual13.7.0 N-1 drill passed using `/private/tmp/shepherd-typescript-242/dist`, fixture
  `shepherd-device-legacy-Jr8ngI`: old writer refused schema16, old archive reader retained facts,
  current native import refused resource adoption, schema15 upgrade retained trace/integrity.
- Standards review independently ran16 refusal tests with no remaining correctness finding.
  Original payload replacement gap is fixed. Spec review found no missing requirement.
- One narrow private invariant guard retains a coverage annotation: the validated frozen journal
  cannot have a null plan. The journal rejection tests exercise that decoding boundary. A reviewer
  identified a separate-read race in the successor check; a new regression exercises that refusal
  and its annotation was removed. Filesystem/ownership guards are
  not excluded. Full repository verification and final review are still required before delivery.

Final review correction: separate device/command reads can race with a successor. The new admission
regression simulates that race using real retained records, verifies refusal with no writes and then
recovers from current evidence. Standards reviewer confirmed it resolves the concern.

Main advanced to13.7.1 (`c58b06a`, PR284 documentation-only empirical study). This issue branch
fast-forwarded safely after backing up and three-way resolving only its own tracked edits; all
upstream benchmark documents and13.7.1 changelog remain. Compatibility baselines were regenerated
from13.7.1. The unrelated dirty primary checkout was not changed.

Installed13.8.0 archive probe passed capture in one process, then reopen/restore/cleanup in another,
using public package exports from `/private/tmp/shepherd-243-installed-consumer`. Installation used
`--ignore-scripts`; no repository dependencies changed. The repeatable fixture is
`test/fixtures/device-layer-installed-consumer.ts`.

Full-gate attempts: first sandbox run hit localhost socket restrictions and a stale backup schema
constant. Corrected that fixture (8/8 backup tests pass), reran with host permission. That run found
four historical migration fixtures leaving the new table in pretend-old databases; fixtures now
remove it with other post-version tables, preserving their original assertions. All9 migration
checks pass. Final complete host gate still pending; no failed run is counted as passing evidence.

## Completed verification

Final base: main `c58b06a` (13.7.1); additive MINOR13.8.0.

- `PATH=/Users/avnionur/.nvm/versions/node/v24.17.0/bin:$PATH CI=true caffeinate -i pnpm verify`: **passed**,1,474 tests total,1,472 passed,two intentional skips,zero failures;100% lines/branches/functions; installed archive/type/CLI/example gates passed. Log: `/private/tmp/shepherd-243-verify-complete.log`.
- Historical migration fixtures and explicit workspace export allowlist updated for the new table/API; original refusal and migration assertions remain.
- Final independent Standards and Spec reviews: no outstanding findings. New separate-read race regression passes.
- Copy/clone process death during capture/restore/compaction/cleanup, delayed actual native helper, payload/root replacement, stale/concurrent writers,54 fsync boundaries, registration/integrity/backup/import authority and bounds checks all pass.
- Scratch device-layer production code unchanged; existing13 conformance/adapter tests pass in the full gate.
- Native Linux bind-mount, actual13.7 reader and installed13.8 fresh-process restore probes passed as recorded above.
- No dependency or lockfile changes. No live-provider, Windows, remote-host, overlay/container durable recovery or constant-time snapshot claim.

The suite's two skips are the existing opt-in external lanes; they are not device recovery evidence.
One private null-plan guard is excluded because frozen decoding already rejects it; malformed-plan tests exercise that boundary. All new filesystem/ownership guards are covered.
