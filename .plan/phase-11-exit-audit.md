# Phase 11 production hardening and 1.0 readiness audit

Audit: 2.32.4, 2026-09-19, #29. Delivered in the worktree for `codex/phase-11-production-hardening`
(base `main` 8f5dbd1, 2.25.1) together with #187 and #179 to #186. The final commit SHA is recorded
in the pull request.

Verdict: **Release candidate ready for the in-repo scope; 1.0 general availability is no-go until
owner-owed items close.** One evidence-driven qualification: this audit found F-029 (Low: several
processes opening the same new SQLite database at once can fail closed), which makes
`test/storage/process-race.test.ts` intermittently fail `pnpm verify` (it passed in the first
fresh run and failed in the second). F-029 needs a small source fix and should land in a follow-up
PATCH before the candidate is tagged; it does not change the severity picture (no critical or high
finding).

Addendum (2.32.5, F-029 follow-up to #29): F-029 is fixed and the qualification above is
discharged. See [F-029 follow-up (2.32.5)](#f-029-follow-up-2325); the candidate is now 2.32.5 and
the [release-candidate manifest](./release-candidate-manifest.md) records its digests.

Every Phase 11 roadmap work item and exit criterion maps below to delivered entry points,
normative documentation, and repeatable tests, or to an owner-owed row. The internal findings
register has no unresolved critical or high finding. Four things an agent cannot supply keep 1.0
general availability closed: no external security review has been performed (O-1); nothing is
signed or published and `release.yml` has never run, so the "signed provenance" exit criterion is
not met (O-2); hosted CI is disabled, so "enforced in CI" means the local `pnpm verify` and
`pnpm verify:release` commands, and Linux, Windows, and privileged-jail lanes are unverified (O-3);
and private vulnerability reporting and the registry name are owner settings (O-4, O-5). "1.0" is
the L4 operational-maturity milestone (D-016), not a package version; the package stays 2.32.x and
`"private": true`.

The cross-phase view (every phase epic, parity row, and paper-coverage row) is the
[release-readiness dashboard](./release-readiness-dashboard.md). The digests and fresh results
for this release candidate are in the
[release-candidate manifest](./release-candidate-manifest.md). Public-facing notes are in
[1.0 release notes](../docs/release-notes-1.0.md).

## Scope and evidence boundary

The [roadmap](./implementation-roadmap.md#phase-11--production-hardening-and-10) lists twelve work
items and five exit criteria. [Epic #24](https://github.com/avnionur/shepherd-typescript/issues/24)
groups them into eleven work checkboxes and two exit checkboxes. Children: contract #187,
compatibility and supply chain #179, secrets and retention #180, storage interfaces #181, backup,
restore, and migration #182, scale and performance #183, observability #184, fuzzing #185, fault
and soak suites #186, and this audit #29. The design authority is the
[production hardening contract](./production-hardening-contract.md), whose roadmap mapping assigns
each item and criterion to exactly one slice or owner-owed row; normative behavior is in the
`docs/` pages linked below.

Evidence is local: macOS arm64 (Apple M4 Pro), APFS, Node 24.17.0, pnpm 10.32.1, SQLite 3.53.0.
The backup, restore, drill, and store CLI suites also passed on Node 24.12.0 (the minimum) during
#182. No Linux, Windows, or privileged-jail run was made in this phase. Hosted workflows
(`ci.yml`, `codeql.yml`, `dependency-review.yml`, `release.yml`) are present and disabled at the
owner's request; none ran for any Phase 11 change and `release.yml` has never run, so #29's
acceptance item "link exact CI runs" cannot be satisfied: there are no runs to link.

Outcome labels:

- **met (in-repo)**: delivered and verified by a deterministic local gate or recorded run in this
  repository;
- **partially met**: the in-repo part is met and a named remainder is owner-owed or unmeasured;
- **owner-owed**: needs an identity, account setting, or host the implementing agent does not hold
  (O-1 to O-5 in the [owner-owed register](./production-hardening-contract.md#owner-owed-register)).

## Roadmap work items

| Work item (unchanged) | Delivery | Entry points | Docs | Tests and evidence | Outcome |
| --- | --- | --- | --- | --- | --- |
| Threat model and external security review | #187 (2.25.2); review fixes #29 (2.32.2, 2.32.3) | None (documentation) | [Threat model](../docs/threat-model.md), [internal security review](./security-review.md) | Every threat row cites mitigation code and a test or a register finding; findings F-001 to F-029 with severity rubric; the reviewer packet in the register | Partially met: threat model and internal review met (in-repo); external review owner-owed (O-1) |
| Fuzz canonical decoders, CLI inputs, changesets, and helper protocols | #185 (2.32.0) | `TraceArchiveLimitError` (root, `./trace`, `./operations`); `pnpm fuzz` | [Fault and fuzz conformance](../docs/fault-and-fuzz-conformance.md) | `test/fuzz/` (23 targets in the default tier, telemetry a recorded skip because no decoder exists), `test/fuzz/corpus.test.ts` over `test/fixtures/fuzz-corpus/`; extended run seed 185185, 410,400 cases, 0 findings | Met (in-repo); seeded mutation fuzzing, not coverage-guided; no native-code fuzzing of jail helpers |
| Harden secret handling and export redaction | #180 (2.27.0); F-025 #29 (2.32.2) | `scanSemanticValueForSecrets`, `exportRedactedTraceArchive`, `verifyRedactedTraceArchive`, `SQLiteTraceStore` option `secretScanning` (`./operations`, root) | [Secrets and retention](../docs/secrets-and-retention.md) | `test/retention/append-refusal.test.ts`, `secret-scan.test.ts` ("finding digests are keyed per process"), `redacted-archive.test.ts` ("redacted archives are refused by every import path") | Met (in-repo); scanning off by default and pattern-based (F-001 accepted) |
| Retention, redaction, and export policy for context, provider citations, checkpoints, and memory adapters | #180 (2.27.0) | `classifyTraceSchema`, `readRetentionPolicy`, `inspectTraceRetention` | [Secrets and retention](../docs/secrets-and-retention.md) | `test/retention/retention-policy.test.ts` (every configured schema family has one of the five data classes `context`, `provider-citation`, `checkpoint`, `memory-adapter`, `general`), `retention-report.test.ts` | Met (in-repo); no in-place deletion of canonical records: retention is classification, redacted export, and store rotation |
| Remote storage and concurrency only behind stable interfaces | #181 (2.28.0) | `BlobStoreBackend`, `StorageCoordinator`, four reference adapters, `checkBlobStoreBackendConformance`, `checkStorageCoordinatorConformance` (`./operations`) | [Storage interfaces](../docs/storage-interfaces.md) | `test/storage/conformance.test.ts` (all four adapters pass both kits, broken adapters fail), `process-race.test.ts` ("SQLite coordinator serializes compare-and-swap and leases across processes") | Met (in-repo); interfaces and local reference adapters only, no remote or cloud adapter (D-018); `SQLiteTraceStore` remains the only canonical append store; the race test is intermittent until F-029 (concurrent first open) is fixed |
| Large traces, compaction indexes, and garbage collection | #183 (2.30.0) | `SQLiteTraceStore.maintain`, `shepherd-ts store maintain`; store schema v13 (index-only) | [Performance report](../docs/performance-report.md), [SQLite trace store](../docs/sqlite-trace-store.md#maintenance) | `test/store/query-plans.test.ts` ("hot-path statements never plan a full table scan"), `test/store/scale.test.ts` (20,000 records, 5,000-record chain, 150 blobs, 40 orphans), `test/store/maintenance.test.ts` ("every maintenance mode leaves the native export byte-identical") | Met (in-repo) |
| Backup, restore, migration, and downgrade policy | #182 (2.29.0); F-024, F-026, F-027 #29 (2.32.2) | `backupTraceStore`, `verifyTraceStoreBackup`, `restoreTraceStoreBackup`, `replicateTraceStoreBackup`, `fetchReplicatedTraceStoreBackup`; `shepherd-ts store verify/backup/restore/export/import` | [Backup, restore, and migration](../docs/backup-restore-and-migration.md) | `test/operations/migration-drills.test.ts` (schemas 1 to 12 upgrade with golden export digests; downgrade drill; backup-upgrade-restore), `backup-restore.test.ts`, `replication.test.ts`, `test/cli/store-cli.test.ts` | Met (in-repo); schema is forward-only; downgrade is restoring a pre-upgrade backup; drill fixtures are synthesized (no earlier package release exists) |
| OpenTelemetry-compatible observability without canonical logs | #184 (2.31.0) | `createTraceTelemetryExporter`, `createJsonLinesTelemetrySink`, `TelemetrySink` (`./operations`) | [Observability](../docs/observability.md) | `test/observability/telemetry-exporter.test.ts` ("a throwing sink affects no run and does not advance the cursor", "a restarted exporter resumes at-least-once from the acknowledged cursor", byte-identical `exportTrace`), `jsonl-sink.test.ts` | Met (in-repo); no SDK, collector, metrics signal, or network exporter |
| SBOM, provenance, signed artifacts, and reproducible builds | #179 (2.26.0) | `pnpm generate:sbom`, `check:sbom`, `release:reproducible-build`, `release:manifest`, `verify:release`; `.github/workflows/release.yml` | [Release integrity](../docs/release-integrity.md) | `test/release-integrity.test.ts`; fresh reproducible build and manifest for 2.32.4 in the [manifest](./release-candidate-manifest.md) | Partially met: lockfile SBOM, unsigned provenance, and host-local reproducible build met (in-repo); signed artifacts owner-owed (O-2, F-010) |
| Deprecation and protocol evolution policy | #179 (2.26.0); recalibrated by F-022 #29 (2.32.2) | `pnpm check:compatibility`, `update:compatibility-baseline`; `config/compatibility-policy.config.json`; `spec/compatibility/` | [Compatibility policy](../docs/compatibility-policy.md) | `test/compatibility-policy.test.ts` ("removed exports, commands, error codes, migrations, and narrowed schemas fail precisely", "format and protocol version increases need a noted classification; schema versions need migrations", "the gate refuses declarations emitted before the newest source edit") | Met (in-repo); deprecation window measured to `deprecation.lastReleasedVersion` 2.25.1 because no npm release exists |
| Long-duration, kill/restart, disk-full, and filesystem-corruption tests | #186 (2.32.1); F-019 #29 (2.32.2) | `pnpm test:soak`, `pnpm test:faults:volume` | [Fault and fuzz conformance](../docs/fault-and-fuzz-conformance.md#faults-and-soak), runbooks in [incident response](../docs/incident-response.md) | `test/faults/process-kill.test.ts`, `disk-full.test.ts`, `corruption.test.ts`, `soak.test.ts`; recorded soak seed 186186 (722.1 s); recorded opt-in volume run; 64-seed page-flip sweep | Met (in-repo) on the reference host; operating-system crash and power loss not simulated; Linux volume and jail variants owner-owed (O-3) |
| Support and incident processes | #187 (2.25.2) | None (documentation) | [Support policy](../docs/support-policy.md), [incident response](../docs/incident-response.md), [SECURITY.md](../SECURITY.md) | Runbooks for store corruption, writer crash, disk full, store growth, lost backup, and secret rotation link the backup, restore, retention, and fault pages; relative links in these pages resolve (checked by this audit) | Met (in-repo); the private advisory intake setting is owner-owed (O-4) |

Summary: ten work items met (in-repo), with scope notes (fault suites on the reference host;
advisory intake setting O-4); two partially met with an owner-owed remainder (external review O-1,
signed artifacts O-2). No work item is unaddressed.

## Roadmap exit criteria

| Criterion (unchanged) | Evidence | Outcome |
| --- | --- | --- |
| Zero unresolved critical security findings | The [register](./security-review.md#10-audit-gate-result-2324) at 2.32.4 has no critical or high finding in any status. Open: F-016 (Low, stack- and JIT-dependent acceptance of values nested roughly 2,000 to 8,000 levels deep; failure is closed with `TypeError`; a deterministic bound or iterative encoder changes the canonical value domain and is a protocol decision for the owner) and F-029 (Low, found by this audit: concurrent first opens of a new trace-store or coordinator database fail closed with `database is locked` or a migration error; a later open succeeds; fix is a follow-up source change; fixed in 2.32.5). Accepted: F-001, F-006, F-011, F-020; fixed with accepted residuals: F-004, F-005, F-013, F-018, F-019, F-023, F-025; each has a row in the threat model's residual table. Owner-owed: F-008, F-009, F-010 | Met (in-repo) for the internal review. The review is by implementing agents plus one independent internal reviewer; no external review has been performed (O-1) |
| Migration and recovery drills pass on supported versions | `test/operations/migration-drills.test.ts` runs in every `pnpm test`: every store schema 1 through 12 upgrades to 13 with integrity and golden export digests, historical-schema backups verify and restore forward-migrated, a future-schema store is refused and its archive imports, and a pre-upgrade backup restores the exact pre-upgrade trace. The fault suites classify every kill, disk-full, and corruption outcome (below). Node 24.12.0 and 24.17.0 on the reference host | Partially met: met (in-repo) on macOS arm64 APFS; drills on Linux and other hosts owner-owed (O-3) |
| Public protocol and API compatibility policies are enforced in CI | `pnpm check:compatibility` runs inside `pnpm verify` and `pnpm verify:serial` and fails on a removed export, narrowed schema, removed error code, CLI command or option, reordered migration, unclassified version-marker increase, or stale declaration (F-022 fixes) | Partially met: enforced by the local `pnpm verify` gate; hosted CI is disabled and the workflow files have not run (O-3) |
| Performance SLOs are supported by reproducible benchmarks | `pnpm bench:kernel` records ten metrics (12 samples, 2 warm-ups) in `docs/generated/benchmarks/macos-arm64-apfs.json` (measured on 2.30.0); `pnpm check:slo` (in `verify:release`) passes fresh on 2.32.4 against budgets at three times the measured p95 (throughput one third of the median); a host without a class is reported as skipped | Met (in-repo) for the macOS arm64 APFS reference host class only; other host classes are unmeasured (O-3) |
| Stable packages and CLI ship with complete docs and signed provenance | Docs: 16 package entries in the [generated API reference](../docs/generated/api-reference.md) and the [CLI reference](../docs/generated/cli-reference.md), both drift-checked in `pnpm verify`; support policy, incident response, migration guide ([backup, restore, and migration](../docs/backup-restore-and-migration.md), [Python-to-TypeScript](../docs/python-to-typescript.md)), compatibility policy, changelog, and [1.0 release notes](../docs/release-notes-1.0.md). Packages: installed-package probes pass (`pnpm test:package-cli`) and two clean builds give identical tarballs. Not shipped: the package is private, unsigned, and unpublished; `release.yml` has never run | Owner-owed for "ship" and "signed provenance" (O-2, O-5); the docs part is met (in-repo) |

Epic exit checkboxes: "No unresolved critical security findings" is supported by row one for the
internal review. "Migration/recovery drills, compatibility CI, benchmark SLOs, docs, packages, and
signed provenance pass" is not met: drills, the compatibility gate, SLOs, docs, and package probes
pass locally, and signed provenance, hosted CI, and cross-OS lanes are owner-owed.

### #29 acceptance criteria

| Criterion | Outcome |
| --- | --- |
| Every required parity row and paper-coverage obligation is implemented, version-fenced, or explicitly classified | Met: the [dashboard](./release-readiness-dashboard.md) classifies all 99 parity rows and 18 paper-coverage rows; rows with open remainders are shown as such, not as complete |
| All phase epics meet their exit criteria with production-seam evidence | Met for Phases 0 to 10 (epics #13 to #23 closed with exit evidence); Phase 11 (#24) is partially met as above |
| Security, recovery, performance, packaging, migration, provenance, and documentation gates pass | Partially met: every local gate passes fresh on 2.32.4 apart from the known host clone carrier test and the intermittent F-029 race test (see Verification); on 2.32.5 the F-029 test passes and only the clone carrier test fails ([F-029 follow-up](#f-029-follow-up-2325)); provenance is unsigned |
| No unsupported platform, provider, formal-assurance, or benchmark claim is presented as complete | Met: see [Limits](#limits) and the dashboard's open rows |
| The final release checklist links exact artifacts, CI runs, signed provenance, and published support policy | Partially met: exact artifact digests and the support policy are linked from the [manifest](./release-candidate-manifest.md); there are no CI runs to link and no signed provenance (O-2, O-3) |

## Recovery classification

Summarized from [fault and fuzz conformance](../docs/fault-and-fuzz-conformance.md#faults-and-soak).
Outcomes are classified from the reopened store, never guessed: **complete** (durable before the
kill), **retryable** (absent with no residue; the retry succeeds and verifies), **refused** (a
partial artifact every verifier refuses), and for corruption **refused**, **detected**,
**recovered**, **rolled back** (write-ahead-log damage only, F-020), or **residual** (F-018).

| Failure | Classification | Recovery and evidence |
| --- | --- | --- |
| `SIGKILL` during append, blob put, or cut publication | Complete or retryable | Idempotent retry of the same request; intents diagnose `committed` or `retry_safe`, never `manual_recovery_required`; integrity, blob, and quick checks pass after every kill (`test/faults/process-kill.test.ts`; seed 20260919: append 432/3/0, blob 34/3/0, cut 434/3/0 complete/retryable/refused) |
| `SIGKILL` during `importTrace` | Complete or retryable | Import into the pristine or absent target; the staging directory stays beside the target store (F-019), nothing is left in the OS temporary directory (2/3/0) |
| `SIGKILL` during `backupTraceStore` | Complete or refused | A backup directory without a manifest fails `verifyTraceStoreBackup` with `manifest-missing`; a fresh backup verifies (2/0/3) |
| `SIGKILL` during `maintain({ mode: "vacuum" })` | Complete or retryable | Same append, then vacuum (34/3/0) |
| Database full (`max_page_count`) | Retryable | `append`, `publishCut`, `putBlob`, and `importTrace` fail with `SQLITE_FULL` (`errcode` 13) and the original error reaches the caller (F-017); export unchanged; every retry succeeds after the limit is raised (`test/faults/disk-full.test.ts`) |
| File-size limit (`ulimit -f`) | Complete or retryable | `EFBIG` surfaces as `SQLITE_IOERR_WRITE` (`errcode` 778); every started operation classified after reopen |
| Real volume full (opt-in HFS+ image) | Retryable | `ENOSPC` and `SQLITE_FULL`; the backup directory had no manifest; checks pass; retries succeed after space returns (recorded once, 2.32.1) |
| Database page flips (48 seeded; 3,072 in the 64-seed sweep) | Recovered, detected, or refused | Seed 20260919: 27 recovered, 19 detected, 2 refused; sweep: 1,701 recovered, 1,296 detected, 75 refused; no silent difference (`test/faults/corruption.test.ts`) |
| WAL deleted, truncated, header or frame damaged | Rolled back | Store returns to an earlier consistent commit; lost intents `retry_safe`; accepted SQLite residual F-020 with a runbook |
| SHM deleted, truncated, or overwritten; stray rollback journal | Recovered | SQLite rebuilds the index |
| Blob truncated, altered, deleted, renamed, or replaced by a directory | Detected | `blob_size_mismatch`, `blob_digest_mismatch`, `blob_missing`, `blob_not_regular_file` |
| Stray temporary file or unregistered blob | Recovered | Reported by `collectBlobOrphans` inspection |
| Backup manifest, database, or blob damaged | Refused | `manifest-invalid`, `manifest-missing`, `database-mismatch`, `blob-mismatch` by verification and restore |
| Append intent batch digest malformed | Detected | `append_receipt_mismatch`; export refused (F-018 fixed) |
| Append intent batch digest replaced by another well-formed digest | Residual | Checks pass; records and receipts unchanged; a retry of that intent fails closed with `AppendIntentConflictError` (F-018 accepted residual) |
| Restore into an existing target or a failed publication move | Refused | `target-exists`; never overwrites, never reports success before read-only re-verification (F-024) |
| Long-duration mixed workload | All invariants held | Recorded soak seed 186186, 722.1 s, 2,537 operations, 41 kill cycles (3,230 complete, 24 retryable, 11 refused), 26 verified backups, 59 maintenance passes with unchanged export digests, 369 telemetry batches, 51 invariant checks passed |

Not simulated: operating-system crash and power loss (torn sectors, lost page cache). Kill points
are seeded delays, not instrumented injection points.

## Independent review

After slice 9 (#186) an independent internal reviewer examined the Phase 11 work. It reported two
Medium findings and five Low findings; fixing one of them surfaced a further Medium finding. All
are fixed with tests and recorded in the [register](./security-review.md):

- **M1, F-021 (Medium)**: `git-head` custody materialized HEAD with `git archive`, which runs
  repository `filter.<driver>.smudge`/`process` programs and export attributes during capture.
  Fixed in 2.32.2: HEAD is written from `git ls-tree` and `git cat-file --batch`, which apply no
  attributes (`test/workspace/git-aware-custody.test.ts`, "never runs repository filters or export
  attributes").
- **M2, F-022 (Medium)**: compatibility gate gaps (auto-accepted version-marker increases, bulk
  additive classification, unfingerprinted CLI options and identity settings, stale `dist`
  declarations, deprecation window measured to the last baseline update). Fixed in 2.32.2
  (`test/compatibility-policy.test.ts`).
- **Lows F-023 to F-027**: store file-mode tightening followed symbolic links and hid creation
  errors (F-023); a failed restore publication left an empty blob directory (F-024);
  secret-finding digests were a guess-confirmation oracle, now per-process HMACs (F-025);
  replication trusted files re-read after verification (F-026); the backup database journal mode
  was hard-coded and backup databases were opened non-defensively (F-027). All fixed in 2.32.2.
- **F-028 (Medium)**: found while fixing F-021: `worktree` custody's dirty-submodule check ran
  `git status`, whose nested submodule status can run repository clean filters. Fixed in 2.32.3 by
  replacing `git status` with a plumbing comparison that runs no configured program; every other
  Git invocation under `src/workspace` was audited.
- Findings owned by this issue: F-014 (append admitted a non-witness `witness_ref`) and F-019
  (killed import left staging in the OS temporary directory) are fixed in 2.32.2. F-016 is left
  open as a protocol decision for the owner.

This audit (#29, 2.32.4) found one new defect, **F-029 (Low)**: the second fresh `pnpm verify`
failed `test/storage/process-race.test.ts` because one of four child processes exited before
printing `ready`. Probes (four processes opening the same not-yet-existing database, repeated)
reproduced it: `createSQLiteStorageCoordinator` failed in 22 of 240 starts with
`database is locked` at `PRAGMA journal_mode = WAL`, and `new SQLiteTraceStore` in 71 of 160 starts
with the same error or `table ... already exists` / `duplicate column name` because
`migrateTraceStore` reads the schema version before its per-migration transaction (the trace-store
race predates Phase 11). Every failure is closed and a later open succeeds. The audit changes no
source, so F-029 is recorded open with a fix direction, the storage-interfaces page no longer
claims concurrent first opens are safe, and a threat-model residual row is added. The same failure
left an orphaned child waiting on stdin, so the test process did not exit until the child was
killed by hand. The audit also completed the threat model's residual table (F-004, F-011, F-019,
F-008, F-009 rows) and repaired a blank line that split the register table.
The review is internal: the implementing agents and the reviewer ran in the same environment and
neither is an external assessor.

## Verification (2.32.4)

Fresh on the reference host (macOS arm64, APFS, Node 24.17.0, pnpm 10.32.1) against the 2.32.4
working tree (base 8f5dbd1 plus the uncommitted Phase 11 branch work). Logs are not committed; the
values are reproduced in the [release-candidate manifest](./release-candidate-manifest.md).

- `pnpm sync:version` (1 version file), `pnpm generate:sbom`, `pnpm generate:api-reference`, and
  `pnpm update:compatibility-baseline` (no classified change) after the PATCH bump; `package.json`,
  `release-config.yaml`, the changelog, the SBOM, and both baselines read 2.32.4.
- `pnpm release:reproducible-build`: pass. Both clean builds produced
  `avnionur-shepherd-typescript-2.32.4.tgz` with SHA-256
  `b98ea693112436aeba08e8328758d9e15e48021f215196e69776d8c6aeef33dc` and output-tree digest
  `sha256:1b9a315688798bea3ea96c70061691c7fa8d97a6b4b2a0edadac0d960b1b505c`; no differing file.
- `pnpm release:manifest`: pass; unsigned provenance and release manifest written to `release/`
  (`"signed": false`).
- `CI=true pnpm verify`: `check:protocol`, `check:evaluation`, `check:sbom`, `build`,
  `check:api-reference`, `check:compatibility` ("compatibility baselines are current (0
  changes)"), `lint` (0 errors; 2 pre-existing warnings and 1 schema-version info), and
  `typecheck` pass; `pnpm test` ran 1,066 tests: 1,064 pass, 1 skipped (the telemetry fuzz target,
  no decoder), 1 fail (the known host clone carrier test, see Limits), with 100% line, branch,
  and function coverage on all files.
- Because the test stage stops `verify`, its remaining stages ran separately:
  `pnpm build && pnpm test:package-cli` pass (installed runtime 24.17.0 supported; every packaged
  probe including `./operations` and the `store` CLI).
- Second `CI=true pnpm verify` after the documentation edits (no source change between runs):
  every stage through `typecheck` passes; `pnpm test` ran 1,066 tests: 1,063 pass, 1 skipped,
  2 fail (the known clone carrier test and the F-029 race test above), with 100% coverage. The test
  process hung on the orphaned child until it was killed by hand. `pnpm build &&
  pnpm test:package-cli` and `pnpm build:desktop` pass again.
- `pnpm check:slo`: pass on host class `macos-arm64-apfs`, all ten budgets (for example
  `append_latency_ms` p95 0.234 ms against 1.1 ms, `append_throughput_records_per_second` median
  4,061.557 against at least 1,400, `export_ms` p95 1,075.138 ms against 3,000 ms).
- `pnpm build:desktop`: pass.
- `CI=true pnpm verify:release` as one command was not run: it stops at the same known test
  stage, so its four parts were run individually as above.
- Recorded runs carried from the slices, not re-run: extended fuzz `pnpm fuzz --seed 185185`
  (2.32.0, 410,400 cases, 0 findings, 188.7 s); soak `pnpm test:soak --duration 720` seed 186186
  (2.32.1, 722.1 s, passed); opt-in `pnpm test:faults:volume` (2.32.1, passed); page-flip sweep
  seeds 1 to 64 (2.32.1, no silent difference). The bounded fuzz, fault, corruption, and soak tiers
  ran fresh inside `pnpm test` above.

## F-029 follow-up (2.32.5)

PATCH 2.32.5 fixes F-029 on this branch. The journal-mode switch of `SQLiteTraceStore`,
`SQLiteTaskRegistry`, and `createSQLiteStorageCoordinator` retries SQLite's deadlock-avoidance
`SQLITE_BUSY` within each opener's configured busy timeout; trace-store and task-registry migrations
read the applied schema version inside each configured `IMMEDIATE` migration transaction (the task
registry had the same pattern); and blob-directory creation tolerates a directory created
concurrently (a third race the fix surfaced). `test/storage/process-race.test.ts` reaps every child
on any outcome and adds a concurrent-first-open test for all three handle kinds; with the retry
disabled that test fails every run in about 0.2 s instead of hanging. Details and evidence are in
the [register](./security-review.md) row for F-029.

Verification on 2.32.5 (same host and toolchain): `CI=true pnpm verify` twice, each with 1,073
tests, 1,071 pass, 1 skipped, and only the known clone carrier test failing, 100% coverage, and
`check:compatibility` 0 changes; `pnpm build && pnpm test:package-cli` and `pnpm build:desktop`
pass; `node --test test/storage/process-race.test.ts` passes 10 of 10 consecutive runs; the F-029
probes record 0 failures in 4,000 process starts (before the fix: 16 of 400 coordinator starts and
69 of 160 trace-store starts); `pnpm release:reproducible-build` and `pnpm release:manifest` pass
with the digests in the [manifest](./release-candidate-manifest.md). `pnpm check:slo` was not
re-run. The register's only open finding is F-016 (Low).

## Limits

None of these is presented as complete anywhere in the repository.

- **External security review**: not performed (O-1). The internal review is not independent of the
  implementation environment.
- **Signing and publication**: no signing identity, Sigstore attestation, or npm publication; the
  package is `"private": true` and `release.yml` has never run (O-2, F-010). The "signed
  provenance" exit criterion is not met. The provenance statement is unsigned and records
  `workingTreeClean: false` for this candidate because the branch is uncommitted.
- **Hosted CI**: disabled by the owner. `ci.yml`, `codeql.yml`, `dependency-review.yml`, and
  `release.yml` are present and have not run; "enforced in CI" means the local `pnpm verify` and
  `pnpm verify:release` commands (O-3, F-008). #29's "link exact CI runs" cannot be satisfied.
- **Platforms**: Linux, Windows, and privileged-jail lanes are unverified in this phase (O-3).
  Linux is supported by design; native Windows is unsupported. Earlier phases recorded Linux
  container runs (Phase 6 and Phase 8 exit audits), not repeated here.
- **Performance**: SLO budgets exist only for the macOS arm64 APFS reference host class; the
  committed benchmark was measured on 2.30.0 and re-checked by `pnpm check:slo` on 2.32.4. Only the
  reference `copy` carrier was measurable on the host.
- **Host clone carrier**: the test "clone carrier fails closed on a macOS filesystem without
  clonefile support" fails on this host because the C toolchain cannot link the clone helper; it
  fails identically on `main` and is environmental.
- **Open parity rows** (verified against the [parity matrix](./parity-matrix.md); see the
  [dashboard](./release-readiness-dashboard.md)): Claude CLI, Codex, and OpenRouter provider
  adapters (no live provider adapter ships); streaming provider event normalization; fenced
  `run start` (configured and disabled by default) and `package init` (honest refusal); dynamic
  `task register` source registration (fails closed); native Windows (unsupported); Core-0H
  activation (disabled until a trusted sidecar is published); the Lean build (external); the
  compensable tier's compensation fixture; effect accounting in budgets; upstream event verbs and
  CLI golden output for trace queries; ATIF export; pinned dirty-worktree oracle parity; stream
  ordering of effect correlation.
- **Storage**: remote storage is interfaces and local reference adapters only (D-018); canonical
  records are never deleted in place.
- **F-029**: concurrent first opens of a new trace-store or coordinator database failed closed and
  made the process-race test intermittent; fixed in 2.32.5 (see
  [F-029 follow-up](#f-029-follow-up-2325)).
- **F-016**: canonical acceptance of values nested roughly 2,000 to 8,000 levels deep depends on
  stack depth and JIT state; failure is closed; the fix is an owner protocol decision.
- **Owner actions**: enable private vulnerability reporting (O-4, F-009); reserve or defer the
  registry name `@avnionur/shepherd-typescript` / `shepherd-ts` (O-5).

## Recommendation on #24 and #29

Recommendation: **close #29 as delivered for the in-repo scope, keep epic #24 open, and track the
owner-owed items O-1 to O-5 in one new owner-action issue under #24.**

Reasoning:

- #29's deliverable is the evidence-based go/no-go audit, the dashboard, the release-candidate
  manifest, and the release notes; all exist, and every local gate passes apart from the known host
  clone carrier test and the intermittent F-029 race test. Its remaining checklist items (CI run
  links, signed provenance) are not audit work an agent can do; keeping #29 open would leave a
  finished audit blocked on owner settings.
- F-029 should be fixed in its own small PATCH (schema version read inside the migration
  transaction, journal-mode change retried within the busy timeout, and the race test's orphaned
  child killed on failure) before the release candidate is tagged. It can be a new issue under #24
  or be folded into this pull request before merge; it does not need to block closing #29. Done:
  folded into this branch as 2.32.5.
- AGENTS.md says to close a phase epic only after every exit criterion has verified evidence. Epic
  #24's second exit checkbox names signed provenance and compatibility CI, which are not met, so
  closing #24 now would contradict that rule and the no-overclaim policy. Closing #24 is correct
  only if the owner explicitly re-scopes its exit criteria to the in-repo scope and moves O-1 to O-5
  to the new issue; that is an owner decision, not an audit finding.
- When the owner adds the O-1 to O-5 evidence (reviewer report, a `release.yml` run with a verified
  attestation, green hosted runs on Linux and macOS, the advisory setting, and the registry
  decision), a short addendum to this audit can flip the verdict to 1.0 general availability and
  close #24.
