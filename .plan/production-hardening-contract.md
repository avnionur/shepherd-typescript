# Production hardening contract

Status: TypeScript contract, Phase 11 slice 1 (#187), 2.25.2; owner-owed register linked to #191
and narrowed by the Linux verification lane (#190) in 2.33.1. Epic: #24. Normative behavior lives
in `docs/`; this page records the slice map, per-slice non-claims, and the work only the repository
owner can do. The [threat model](../docs/threat-model.md) and the
[internal security review](./security-review.md) are the security inputs every later slice consumes.

## Evidence

- The roadmap's Phase 11 section lists twelve work items and five exit criteria
  ([implementation roadmap](./implementation-roadmap.md#phase-11--production-hardening-and-10)).
- The [testing and release plan](./testing-and-release.md) lists release gates (SBOM, provenance,
  compatibility report, rollback procedure, recovery drill, performance report) that no current
  script enforces.
- The package is `"private": true`, has zero runtime dependencies, and the workflows in
  `.github/workflows/` (`ci.yml`, `codeql.yml`, `dependency-review.yml`) are present but hosted CI is
  disabled by the owner. "Enforced in CI" in this phase therefore means enforced by the local
  `pnpm verify` (and, from #179, `pnpm verify:release`) commands.
- The internal review found no critical finding; the register is in
  [security-review.md](./security-review.md).

## Terms

- **"1.0"** is the L4 operational-maturity milestone (D-016), not a package version. The package
  keeps Semantic Versioning from its current version; no slice in this phase is MAJOR.
- **Owner-owed** work requires an identity, account setting, or host the implementing agent does not
  hold. It is prepared in the repository and closed only by evidence the owner adds.
- **Enforced** means a deterministic local gate that fails `pnpm verify` or `pnpm verify:release`.

## Slice map

Every slice follows the issue delivery workflow in `AGENTS.md`. Versions are provisional and
re-classified at delivery.

| Slice | Issue | Goal | Provisional version |
| --- | --- | --- | --- |
| 1 | #187 | This contract, [threat model](../docs/threat-model.md), [internal security review](./security-review.md), [support policy](../docs/support-policy.md), [incident response](../docs/incident-response.md), decisions D-016 to D-018 | PATCH 2.25.2 |
| 2 | #179 | Compatibility policy and API/protocol surface baselines enforced by `pnpm check:compatibility`; deprecation tiers; lockfile SBOM; unsigned provenance statement; reproducible-build check; `pnpm verify:release`; `release.yml` present, not run | MINOR |
| 3 | #180 | Secret scanning (opt-in refusal before any write), retention data classes, redacted export and its verifier, `./operations` entry | MINOR |
| 4 | #181 | `BlobStoreBackend` and `StorageCoordinator` interfaces, conformance kits, memory/filesystem/SQLite reference adapters | MINOR |
| 5 | #182 | Verified backup and restore, migration drills for every historical schema, downgrade policy, `store` CLI group | MINOR |
| 6 | #183 | Store maintenance, query-plan tests, bounded scale tier, kernel benchmarks and SLO check on the reference host class | MINOR |
| 7 | #184 | OpenTelemetry-compatible, non-canonical telemetry exporter and JSONL sink | MINOR |
| 8 | #185 | Seeded deterministic fuzzing of decoders, CLI argv, changesets, and helper protocols with a regression corpus | PATCH or MINOR |
| 9 | #186 | Kill/restart, disk-full, corruption, and soak suites with classified outcomes | PATCH or MINOR |
| audit | #29 | Project-wide 1.0 readiness audit and release checklist | PATCH |

## Roadmap mapping

Each roadmap work item and exit criterion maps to exactly one slice or one owner-owed row (O-n,
below). Items the roadmap states as one line but which have an agent part and an owner part are
split into two rows.

| Roadmap work item | Owner |
| --- | --- |
| Threat model | #187 |
| External security review | O-1 |
| Fuzz canonical decoders, CLI inputs, changesets, and helper protocols | #185 |
| Harden secret handling and export redaction | #180 |
| Retention, redaction, and export policy for context, citations, checkpoints, memory adapters | #180 |
| Remote storage/concurrency only behind stable interfaces | #181 |
| Large traces, compaction indexes, and garbage collection | #183 |
| Backup, restore, migration, and downgrade policy | #182 |
| OpenTelemetry-compatible observability without canonical logs | #184 |
| SBOM, provenance, and reproducible builds | #179 |
| Signed artifacts | O-2 |
| Deprecation and protocol evolution policy | #179 |
| Long-duration, kill/restart, disk-full, and filesystem-corruption tests | #186 |
| Support and incident processes | #187 |

| Exit criterion | Owner |
| --- | --- |
| Zero unresolved critical security findings | #29 (register maintained from #187 on) |
| Migration and recovery drills pass on supported versions (reference host) | #182 |
| Migration and recovery drills on other operating systems | O-3 |
| Public protocol and API compatibility policies enforced (local gate) | #179 |
| Compatibility policies enforced in hosted CI | O-3 |
| Performance SLOs supported by reproducible benchmarks | #183 |
| Stable packages and CLI ship with complete docs | #29 |
| Signed provenance and published packages | O-2 |

## Per-slice goals and non-claims

### #187 contract, threat model, review, processes

Goal: establish the severity rubric, findings register, threat model, and support and incident
processes used by every later slice and by the exit gate. Non-claims: no source change; the
review is internal only; runbooks for backup, restore, and fault recovery are forward links until
#182 and #186 deliver them.

### #179 compatibility and supply chain

Goal: a removed export, narrowed schema, removed error code or CLI command, or removed/reordered
migration fails `pnpm verify` with a precise message. Non-claims: the SBOM covers the lockfile only
(no native helper toolchain, no host runtime); provenance is an unsigned statement; reproducibility
is host-local; `release.yml` is not run.

Delivered in 2.26.0. Gate facts:

- `pnpm check:compatibility` runs in `verify` and `verify:serial` after `check:api-reference`; it
  compares `dist/src` exports and the protocol surface (82 schemas, 100 version markers, 2 migration
  lists, 15 public error codes, 4 exit codes, 24 CLI command paths at 2.26.0) with
  `spec/compatibility/`, and fails while the baselines are stale, including version-only drift.
- All 15 package entries are `stable`; the deprecation window is 2 MINOR releases; superseded
  versioned schemas are frozen. The change log starts empty.
- `pnpm check:sbom` runs in `verify`; the SBOM lists 56 locked packages, all `excluded`, with zero
  runtime components.
- `pnpm verify:release` adds two clean builds and packs; on the reference host both 2.26.0
  tarballs and output trees were byte-identical without any build change.
- `release.yml` pins `actions/attest-build-provenance` v4.2.2, `actions/upload-artifact` v7.0.1,
  and `actions/download-artifact` v8.0.1 by SHA and reuses the existing checkout, pnpm, and
  setup-node pins.

### #180 secrets and retention

Goal: detected secret classes are reported by path and digest, never by value; opt-in refusal leaves
no partial append; redacted archives verify and import refuses them. Non-claims: detection is
pattern-based and incomplete; default is off; records are immutable, so retention is
classification, redacted export, and store rotation, never in-place deletion.

Delivered in 2.27.0. Facts:

- `protocol.config.json` gains the `retention` section (retention protocol v1): 5 data classes, 3
  dispositions, 38 schema-family mappings resolving 107 schema identifiers, 7 named detectors,
  redacted-archive and report formats, scanning modes `off`/`refuse`, and store-file mode `0600`.
  The reader refuses any unmapped `schemas`/`traceSchemas` family; the compatibility contract
  pins vocabularies, formats, and schema identities, not detector patterns or mappings.
- `./operations` is the 16th package entry (tier `stable`); it loads neither SQLite nor
  process-execution modules. Public errors gain `TRACE_SECRET_DETECTED` and
  `REDACTED_TRACE_ARCHIVE_ERROR`; schemas gain `redacted-trace-archive-v1` and
  `retention-report-v1`.
- F-003 is fixed (owner-only database, WAL, SHM on writable opens); F-001 is downgraded to Low and
  accepted with a residual row.
- The API reference credential guard was narrowed to allow exactly the eight detection-vocabulary
  names (`scanSemanticValueForSecrets`, `SecretFinding`, `SecretScanReport`,
  `SecretScanningMode`, `SECRET_SCANNING_MODES`, `TraceSecretDetectedError`,
  `RetentionSecretClassCount`, `RetentionSecretRecord`) and the `retention/secret-scan` module;
  every other `secret`, `credential`, or access-token name still fails generation
  (`test/api-reference.test.ts`).

### #181 storage interfaces

Goal: interfaces with law kits and four reference adapters, including a multi-process CAS and lease
race. Non-claims: `SQLiteTraceStore` remains the only canonical append store; no cloud adapter
(D-018).

Delivered in 2.28.0. Facts:

- `protocol.config.json` gains the `storage` section (storage protocol v1): durabilities
  `durable`/`volatile`, lease statuses (5) and swap statuses (3), the shared name grammar, value,
  owner, TTL, and list bounds, and the SQLite coordinator contract (WAL, `FULL`, `IMMEDIATE`,
  defensive, busy timeout, migrations `[1]`). The compatibility contract pins the vocabularies and
  `shepherd.storage.v1`, not the bounds.
- `./operations` exports `BlobStoreBackend`, `StorageCoordinator`, four reference adapters (memory
  and filesystem backends, memory and SQLite coordinators), and the kits
  `checkBlobStoreBackendConformance` (11 laws) and `checkStorageCoordinatorConformance` (12
  laws). Importing `./operations` now loads `node:sqlite` (entry-loading policy updated); it still
  loads no process-execution module. Public errors gain `STORAGE_ADAPTER_ERROR` and
  `STORAGE_BLOB_CONTENT_MISMATCH`.
- All four adapters (and the SQLite coordinator on `:memory:`) pass both kits; broken adapters fail
  the expected laws; four processes race one SQLite coordinator with dozens of real CAS conflicts
  per run and commit every generation exactly once (`test/storage/`).
- `createFilesystemBlobStoreBackend` wraps `BlobFilesystem` without modifying it; existing blob
  tests are unchanged. The SQLite coordinator file is owner-only through `src/store/file-mode.ts`.
- No finding is owned by #181; F-003 notes the coordinator file mode.

### #182 backup, restore, migration

Goal: `node:sqlite` online backup with a digest-bearing manifest, restore only into a new target,
drills for schema 1 through current. Non-claims: downgrade means restoring a pre-upgrade backup; the
schema is forward-only; drills run on the reference host only.

Delivered in 2.29.0. Facts:

- `protocol.config.json` gains the `backup` section (backup protocol v1: manifest
  `shepherd.store.backup` v1, `sha256`, blob locations `directory`/`backend`, 11 failure reasons,
  directory mode `0700`, layout names, manifest and page-step bounds) and the `store` CLI group
  (5 commands, 5 options). The compatibility contract pins the manifest identity, digest, schema,
  and vocabularies, not the layout or bounds. Public errors gain `TRACE_STORE_BACKUP_ERROR`
  (`TraceStoreBackupError` with a `reason`); schemas gain `store-backup-manifest-v1`; the CLI JSON
  schema gains six additive success branches.
- `./operations` exports `backupTraceStore`, `verifyTraceStoreBackup`, `restoreTraceStoreBackup`,
  `replicateTraceStoreBackup`, and `fetchReplicatedTraceStoreBackup`. The manifest is written last;
  restore requires the exact manifest identity, refuses any existing target path, verifies a staged
  copy, publishes by rename and hard link, and re-verifies read-only before success.
- `node:sqlite` `backup()` is resolved at call time and fails closed as `backup-unsupported`; the
  backup, restore, drill, and store CLI suites pass on Node.js 24.12.0 (the minimum) and 24.17.0 on
  the reference host.
- Drills: every store schema 1 through 12 upgrades with integrity, row preservation, and golden
  export digests; historical-schema backups verify and restore forward-migrated; a future-schema
  store is refused and its archive-v1 export imports into a fresh store; a pre-upgrade backup
  restores the exact pre-upgrade trace. Fixtures are synthesized from the migration steps (no
  earlier package release exists); the supervised-dispatch and replay-session tables are empty in
  them.
- F-003 backup part closed (owner-only backup directory, database copy, manifest, staging, and
  restore target).

### #183 scale and performance

Goal: semantics-preserving maintenance, no full scans on hot paths, reproducible benchmarks and an
SLO check in `verify:release`. Non-claims: SLOs hold only for the reference host class (macOS arm64
APFS); other hosts are owner-owed (O-3).

Delivered in 2.30.0. Facts:

- `SQLiteTraceStore.maintain` (`inspect`, `checkpoint`, `optimize`, `vacuum`) and
  `shepherd-ts store maintain`; `TRACE_STORE_READ_ONLY` for read-only handles; mutating modes refuse
  a failing `quick_check`; export byte identity is tested for every mode, at scale, and in the
  packaged CLI probe.
- Query-plan tests found two full scans (`listOwnersBySchema` on `records`, `listCuts` on
  `trace_cuts`); index-only store schema v13 removes them. Review also found append planning loading
  every record identity and owner ordinal per append (3.62 ms median extra per append at 10,083
  records, linear in store size); it now reads only cited records and extended owners.
- The default scale tier (20,000 records, 5,000-record chain, 150 blobs, 40 orphans, 12 temporary
  files) runs in `pnpm test` (about 23 s alone); the extended tier runs on demand.
- `pnpm bench:kernel` records 10 metrics (12 samples, 2 warmups) in
  `docs/generated/benchmarks/macos-arm64-apfs.json`; `pnpm check:slo` (in `verify:release`) checks
  budgets set at 3x the measured p95 (throughput: one third of the median). A host without a class
  is reported as skipped. Only the reference `copy` carrier was measurable on the host (the
  clonefile helper does not link); see the [performance report](../docs/performance-report.md).

### #184 observability

Goal: deterministic OTLP/JSON-subset telemetry pulled through durable subscriptions with
at-least-once delivery. Non-claims: telemetry is never canonical; no collector, SDK, or network code
is bundled.

### #185 fuzzing

Goal: every listed target fuzzed in the default tier with a typed-error oracle and a regression
corpus; findings recorded in the register. Non-claims: seeded mutation fuzzing, not coverage-guided;
no native-code fuzzing of the jail helpers.

Delivered in 2.32.0 (MINOR: one public error class and code, two operational configuration
sections). 23 targets run in the default tier (the telemetry target is a recorded skip: no decoder
exists); the corpus replays in `pnpm test`; the extended run (seed 185185, 410,400 cases, 0
findings) is recorded in [fault and fuzz conformance](../docs/fault-and-fuzz-conformance.md).
F-002, F-004, and F-005 are closed; F-012, F-013, and F-015 were found and fixed; F-014 and F-016
are Low and open for #29.

### #186 fault and soak suites

Goal: kill/restart, disk-full, and corruption outcomes classified as complete, retryable, or
refused; one recorded soak. Non-claims: real-volume ENOSPC is opt-in; Linux volume and jail
variants are owner-owed (O-3).

Delivered in 2.32.1 (PATCH: fixes and test suites, no public surface). `test/faults/` adds seeded
`SIGKILL` of a looping child writer during append, blob put, cut publication, import, backup, and
vacuum; disk-full through `max_page_count` and a `ulimit -f` child, plus the opt-in macOS
`hdiutil` volume suite (`pnpm test:faults:volume`, run once and recorded); seeded page, WAL/SHM,
blob, stray-file, and backup corruption compared with a golden export and read surface; and the
mixed soak (`pnpm test:soak`, bounded in `pnpm test`, one recorded run in
[fault and fuzz conformance](../docs/fault-and-fuzz-conformance.md#soak)). Configuration is the
`faults` and `soak` sections of `config/hardening-suites.config.json`. The suites found F-017
(rollback masked `SQLITE_FULL`/I/O errors; fixed), F-018 (unverified batch digest; fixed with an
accepted residual), F-019 (import staging left in the OS temporary directory after a kill; Low,
open for #29), and F-020 (write-ahead-log loss rolls back silently; accepted SQLite residual).
Non-claims added: operating-system crash and power loss are not simulated; kill points are seeded
delays, not instrumented injection points.

### #29 audit

Goal: evidence-based go/no-go. It must state every non-claim in the next section and every open
owner-owed row.

Review fixes delivered in 2.32.2 (PATCH: no public API change): an independent internal review of
the Phase 11 work reported F-021 to F-027, all fixed with tests (Git-head custody no longer runs
repository filters; the compatibility gate classifies version markers and API changes per
artifact, fingerprints per-command CLI options and identity settings, refuses stale declarations,
and measures deprecation to the last release; store-file tightening never follows links; restore
publication, replication, and backup database opens are hardened; secret-finding digests are
keyed per process). F-014 and F-019, owned by this issue, are fixed; F-016 stays open as a
protocol decision; F-028 (Medium, `git status` clean filters in worktree custody) is recorded open.
This is not the go/no-go audit itself.

F-028 fixed in 2.32.3 (PATCH: no public API change): `worktree` custody's dirty-submodule check no
longer runs `git status`; it compares with `rev-parse`, `ls-tree`, and `ls-files` and hashes
worktree blobs in the runtime, so no repository clean or process filter runs during capture.

## Phase non-claims

- No external security review has been performed; the review in this phase is internal (O-1).
- No signing identity, Sigstore attestation, or npm publication; the package is private and
  `release.yml` is never run by an agent (O-2).
- Hosted CI is disabled; Linux, Windows, and privileged-jail lanes are unverified (O-3).
- SLOs apply only to the reference host class.
- Open parity rows remain open: live provider adapters, streaming provider normalization, run start
  and package init refusals, native Windows (unsupported), Core-0H activation, and the external Lean
  build.
- Remote storage is interfaces and reference adapters only. Canonical records are never deleted in
  place.

## Owner-owed register

The owner-only actions are tracked in
[#191 Owner actions for 1.0 general availability](https://github.com/avnionur/shepherd-typescript/issues/191)
(split out of epic #24 on 2026-09-19). Epic #24 is re-scoped to the in-repo criteria and closes
with the Phase 11 close-out (#190); the
[exit audit addendum](./phase-11-exit-audit.md#linux-verification-lane-and-close-out-2331) records
the local Linux lane evidence that narrows O-3.

| ID | Item | Why an agent cannot do it | In-repo preparation | Evidence the owner must add |
| --- | --- | --- | --- | --- |
| O-1 | External security review | Requires an independent reviewer and contract; an agent reviewing its own work is not independent | [Threat model](../docs/threat-model.md), [findings register and reviewer packet](./security-review.md#external-reviewer-packet) | Reviewer identity, scope, commit reviewed, report or summary, and each new finding entered in the register with an owning issue |
| O-2 | Signing identity, attestation, npm publish | Requires registry credentials, an OIDC-capable hosted workflow, and a decision to drop `"private": true` | Unsigned provenance statement, SBOM, reproducible-build check, and `release.yml` from #179 | A run of `release.yml` with attestation, the published version, and a verified provenance check against the tarball digest |
| O-3 | Enable hosted CI and cross-OS lanes | Workflows are disabled by the owner; agents cannot change repository settings or provide hosted, Windows, or dedicated Linux hosts | `ci.yml`, `codeql.yml`, `dependency-review.yml`; Linux carrier script `pnpm test:carriers:linux`; `pnpm test:runtime-boundaries`. Local Docker Linux lane (2.33.1, #190): full `pnpm verify` on Node 24.21.0 and 24.12.0, `pnpm test:runtime-boundaries`, extended `pnpm fuzz`, and the privileged `pnpm test:carriers:linux` pass ([addendum](./phase-11-exit-audit.md#linux-verification-lane-and-close-out-2331)) | Green hosted runs of `ci.yml` on Linux and macOS (minimum and current Node) with CodeQL and dependency review, linked from the audit; Windows decision; a Linux variant of the volume fault suite (`pnpm test:faults:volume` is macOS-only); a Linux SLO host class for `pnpm check:slo`. Tracked in #191 |
| O-4 | Private vulnerability reporting | A repository setting only the owner can enable | [SECURITY.md](../SECURITY.md) fallback contact path; [incident response](../docs/incident-response.md) | Confirmation that the advisory form is enabled, recorded in the tracker |
| O-5 | Registry name | Reservation succeeds only by publishing under an owner account | D-011 names `@avnionur/shepherd-typescript` and `shepherd-ts` | Registry page for the reserved name or a recorded decision to defer |
