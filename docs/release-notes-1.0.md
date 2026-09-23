# 1.0 release notes (release candidate)

Status: release candidate for the in-repo scope, package 2.32.5, 2026-09-19; the F-016 fix in
2.33.0 (#189) and the Phase 11 close-out in 2.33.1 (#190: local Linux lane, F-030 and F-031 fixed,
owner actions tracked in #191), and the owner decisions of #191 in 2.33.3 (a hosted-CI
enablement attempt blocked by an account billing limit and the workflows disabled again, email
vulnerability intake, registry name decided, F-032 fixed; remaining owner actions in #199) are noted below. The evidence and the
go/no-go verdict are in the [Phase 11 exit audit](../.plan/phase-11-exit-audit.md); digests are in
the [release-candidate manifest](../.plan/release-candidate-manifest.md).

## What "1.0" means

"1.0" names the L4 operational-maturity milestone (decision D-016 in
[decisions and risks](../.plan/decisions-and-risks.md)), not a package version. The package keeps
Semantic Versioning from its current version: this candidate is `@avnionur/shepherd-typescript`
2.32.5, and reaching 1.0 does not reset or reserve a version number. The package is
`"private": true` and has not been published to any registry.

Verdict: **release candidate ready for the in-repo scope; 1.0 general availability is no-go until
the owner-owed items below close (#199).** The internal findings register has no unresolved critical or
high finding.

## What is delivered

Levels L0 to L3 were reached before Phase 11 (see the [README](../README.md) level table). Phase 11
adds, on top of the kernel, settlement, scope, supervision, replay, meta-agent, and research
application surfaces:

| Area | Delivered | Page |
| --- | --- | --- |
| Security process | Threat model with STRIDE per trust boundary, internal findings register F-001 to F-032, severity rubric, external reviewer packet | [Threat model](./threat-model.md), [security review](../.plan/security-review.md) |
| Support and incidents | Support policy, incident response with store-corruption, lost-backup, crash, disk-full, and secret-rotation runbooks | [Support policy](./support-policy.md), [incident response](./incident-response.md) |
| Compatibility | API and protocol surface baselines, classified change log, stability tiers, two-MINOR deprecation window, `pnpm check:compatibility` in `pnpm verify` | [Compatibility policy](./compatibility-policy.md) |
| Supply chain | Lockfile SBOM, unsigned in-toto/SLSA provenance statement, host-local reproducible build, `pnpm verify:release` | [Release integrity](./release-integrity.md) |
| Secrets and retention | Opt-in `secretScanning: "refuse"`, retention data classes, one-way redacted archives and their verifier, the `./operations` entry | [Secrets and retention](./secrets-and-retention.md) |
| Storage interfaces | `BlobStoreBackend`, `StorageCoordinator`, conformance kits, memory, filesystem, and SQLite reference adapters | [Storage interfaces](./storage-interfaces.md) |
| Backup and migration | Verified online backup, exact-manifest non-destructive restore, replication, forward-only schema and downgrade policy, drills for every store schema, `shepherd-ts store` | [Backup, restore, and migration](./backup-restore-and-migration.md) |
| Scale and performance | `SQLiteTraceStore.maintain`, query-plan tests, bounded scale tier, kernel benchmark and SLO check | [Performance report](./performance-report.md) |
| Observability | Non-canonical OTLP/JSON-subset exporter with at-least-once delivery and an owner-only JSON-lines sink | [Observability](./observability.md) |
| Fuzzing and faults | Seeded fuzzing of 23 targets with a regression corpus; kill, disk-full, corruption, and soak suites with classified outcomes | [Fault and fuzz conformance](./fault-and-fuzz-conformance.md) |

## Known limits

- **No external security review.** The review is internal and has no open finding. F-032 (Low:
  the packed file set depended on the npm version) is fixed in 2.33.3 by anchored, literal
  `files` entries checked in `pnpm verify`. F-016 (Low;
  acceptance of values nested roughly 2,000 to 8,000 levels deep depended on stack depth and JIT
  state) is fixed in 2.33.0 by a configured canonical nesting bound
  (`kernel.canonicalization.maxNestingDepth`, default 1,000; deeper values are refused with
  `CanonicalNestingLimitError`). F-029 (Low; several processes opening the same new SQLite database at once failed
  closed with `database is locked` or a migration error), found by the audit, is fixed in 2.32.5.
  Accepted residuals are listed in the [threat model](./threat-model.md#residual-risks).
- **Unsigned and unpublished.** No signing identity, Sigstore attestation, or npm publication;
  `release.yml` has never run.
- **No hosted CI.** Workflows are present and disabled. An attempt on 2026-09-23 to enable `CI`
  and `Dependency Audit` was blocked by an account billing limit (no job started), so both were
  disabled again; CodeQL needs GitHub Advanced Security, which the private repository does not
  have. Every gate is enforced by the local `pnpm verify` and `pnpm verify:release` commands.
- **Platforms.** Verified on macOS arm64 APFS and, in 2.33.1, in a local Docker Linux lane (Debian
  bookworm arm64, Node 24.21.0 and the 24.12.0 minimum): every `pnpm verify` gate, runtime
  boundaries, the extended fuzz run, the unprivileged Landlock jail tests, and the privileged
  carrier suite (copy, clone, overlay on loopback XFS). The lane found and fixed F-030 (fault-suite
  file-size limit) and F-031 (`fs.rmSync` keeps dangling symbolic links on Node 24.12.x and
  24.13.x). No hosted Linux run exists, the volume fault suite is macOS-only, and Linux has no SLO
  host class. Native Windows is unsupported.
  The clone carrier needs a host toolchain that can link its helper.
- **Performance.** SLO budgets hold only for the macOS arm64 APFS reference host class.
- **Providers.** Only the deterministic static provider ships; no live provider adapter and no
  streaming event normalization.
- **CLI.** `package init` refuses honestly; fenced `run start` is disabled by default; dynamic
  `task register` source registration fails closed.
- **Formal assurance.** Core-0H activation stays disabled until a trusted sidecar is published; the
  Lean build is external.
- **Storage.** Remote storage is interfaces plus local reference adapters; no cloud adapter.
  Canonical records are never deleted in place: retention is classification, redacted export, and
  store rotation.
- **Faults.** Operating-system crash and power loss are not simulated; deleting a `-wal` file
  rolls a store back to an earlier commit (F-020).
- **Research applications.** Offline, synthetic fixtures; no upstream headline result is
  reproduced and the Tree-RL adapter trains nothing.

The full row-by-row status is the
[release-readiness dashboard](../.plan/release-readiness-dashboard.md).

## Owner-owed before general availability

| ID | Item | State (2.33.3) and evidence still owed |
| --- | --- | --- |
| O-1 | External security review | Deferred to #199: reviewer, scope, reviewed commit, report, and new findings entered in the register |
| O-2 | Signing identity, attestation, npm publication (drop `"private": true`) | Deferred to #199: a `release.yml` run with a verified attestation against the tarball digest and the published version ([owner release runbook](./release-integrity.md#owner-release-runbook)) |
| O-3 | Hosted CI and cross-OS lanes | Enablement attempted and blocked by an account billing limit; workflows disabled again. Deferred to #199: green hosted runs, CodeQL, a Windows decision, a Linux volume-fault variant and SLO host class |
| O-4 | Vulnerability intake | Done: private email while the repository is private ([SECURITY.md](../SECURITY.md)); the advisory form after it is public is deferred to #199 |
| O-5 | Registry name | Decided: `@avnionur/shepherd-typescript`; reserved by the first publish (#199) |

The register is in the [production hardening contract](../.plan/production-hardening-contract.md#owner-owed-register);
the owner decisions of 2026-09-23 were delivered by
[#191](https://github.com/avnionur/shepherd-typescript/issues/191) and the remaining actions are
tracked in [#199](https://github.com/avnionur/shepherd-typescript/issues/199).

## Upgrade and migration

- **Store schema.** Opening a store writable migrates it forward to schema 13 (two index-only
  additions since 2.30.0). Migrations are forward-only; an older package refuses a newer store. Take
  a backup first; downgrade means restoring the pre-upgrade backup or importing a native archive
  into a fresh store ([backup, restore, and migration](./backup-restore-and-migration.md)).
- **Archives and manifests.** Native archive format v1 and backup manifest v1 are unchanged. Since
  2.32.0 oversized archives, archives with repeated keys or non-canonical receipts, and hand-edited
  backup manifests are refused; everything the package itself writes is accepted.
- **File modes.** Since 2.27.0 writable opens make the database, WAL, and SHM owner-only.
- **Behavior changes to check.** `SecretFinding.digest` is a per-process HMAC (`hmac-sha256:`)
  since 2.32.2; `git-head` worlds contain committed bytes even where archive attributes were set
  (2.32.2); `worktree` capture reports a submodule dirty when a file equals its blob only after a
  clean filter or end-of-line conversion (2.32.3); an append whose `witness_ref` names a
  non-witness is refused (2.32.2); a killed import leaves its staging directory beside the target
  store (2.32.2); a writable task-registry open now reads its schema version under the configured
  `IMMEDIATE` lock, as trace-store and coordinator opens already took the write lock, so it waits up
  to the busy timeout behind another process's long write transaction (2.32.5); canonical values
  nested more than `kernel.canonicalization.maxNestingDepth` (1,000) levels deep are refused with
  `CanonicalNestingLimitError` (2.33.0). See the [changelog](../CHANGELOG.md).
- **API compatibility.** No Phase 11 slice removed or changed a public export in a breaking way;
  the [compatibility policy](./compatibility-policy.md) defines how future removals are deprecated.
- **From the Python package.** See [Python-to-TypeScript migration](./python-to-typescript.md).
- **Runtime.** Node `>=24.12.0 <25` ([runtime support](./runtime-support.md)).
