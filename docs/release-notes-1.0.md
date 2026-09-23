# 1.0 release notes

Status: 1.0, a private, unpublished source release with the waivers listed below, by owner
decision of 2026-09-23 ([#199](https://github.com/avnionur/shepherd-typescript/issues/199)),
recorded in package 2.34.0. Before that: release candidate for the in-repo scope, package 2.32.5,
2026-09-19; the F-016 fix in
2.33.0 (#189) and the Phase 11 close-out in 2.33.1 (#190: local Linux lane, F-030 and F-031 fixed,
owner actions tracked in #191), and the owner decisions of #191 in 2.33.3 (a hosted-CI
enablement attempt blocked by an account billing limit and the workflows disabled again, email
vulnerability intake, registry name decided, F-032 fixed; remaining owner actions in #199), and the
owner decisions of #199 in 2.34.0 (waivers, local lanes as the verification substitute, Linux
volume fault suite and Linux SLO host class) are noted below. The evidence and the verdict are in the [Phase 11 exit audit](../.plan/phase-11-exit-audit.md); digests are in
the [release-candidate manifest](../.plan/release-candidate-manifest.md).

## What "1.0" means

"1.0" names the L4 operational-maturity milestone (decision D-016 in
[decisions and risks](../.plan/decisions-and-risks.md)), not a package version. The package keeps
Semantic Versioning from its current version: the release candidate was
`@avnionur/shepherd-typescript` 2.32.5, 1.0 is recorded at 2.34.0, and reaching 1.0 does not
reset or reserve a version number. The package is `"private": true` and has not been published to
any registry.

Verdict: **1.0 as a private, unpublished source release, with the owner waivers listed under
[Waivers](#waivers-owner-decisions-of-2026-09-23).** The owner decided on 2026-09-23 (#199) to
accept the in-repo scope with those waivers instead of waiting for an external review, signing,
publication, and hosted CI. The internal findings register has no unresolved critical or high
finding and no open or owner-owed finding.

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

- **No external security review.** None has been performed; the owner waived it for 1.0 (O-1,
  #199). The review is internal (implementing agents plus one independent internal reviewer) and
  has no open finding. F-032 (Low:
  the packed file set depended on the npm version) is fixed in 2.33.3 by anchored, literal
  `files` entries checked in `pnpm verify`. F-016 (Low;
  acceptance of values nested roughly 2,000 to 8,000 levels deep depended on stack depth and JIT
  state) is fixed in 2.33.0 by a configured canonical nesting bound
  (`kernel.canonicalization.maxNestingDepth`, default 1,000; deeper values are refused with
  `CanonicalNestingLimitError`). F-029 (Low; several processes opening the same new SQLite database at once failed
  closed with `database is locked` or a migration error), found by the audit, is fixed in 2.32.5.
  Accepted residuals are listed in the [threat model](./threat-model.md#residual-risks).
- **Unsigned and unpublished.** No signing identity, Sigstore attestation, or npm publication;
  `release.yml` has never run. Waived for 1.0 (O-2, O-5, #199; F-010 accepted).
- **No hosted CI.** Workflows are present and disabled. Attempts on 2026-09-23 to run `CI`
  (#191, and the #199 recheck) were blocked by an account billing limit (no job started), so the
  workflows were disabled again; CodeQL needs GitHub Advanced Security, which the private
  repository does not have. By owner decision (O-3, #199; F-008 accepted) every gate is enforced by
  the local `pnpm verify`, `pnpm verify:release`, and `pnpm build:desktop` commands plus the local
  Docker Linux lane.
- **Platforms.** Verified on macOS arm64 APFS and, in 2.33.1, in a local Docker Linux lane (Debian
  bookworm arm64, Node 24.21.0 and the 24.12.0 minimum): every `pnpm verify` gate, runtime
  boundaries, the extended fuzz run, the unprivileged Landlock jail tests, and the privileged
  carrier suite (copy, clone, overlay on loopback XFS). The lane found and fixed F-030 (fault-suite
  file-size limit) and F-031 (`fs.rmSync` keeps dangling symbolic links on Node 24.12.x and
  24.13.x). No hosted Linux run exists. In 2.34.0 the real-volume fault suite gained a Linux
  variant (16 MiB ext4 loop image; passed as root in a privileged `node:24.21.0-bookworm`
  container, skips with an explicit reason without root or loop devices)
  ([addendum](../.plan/phase-11-exit-audit.md#linux-volume-fault-suite)).
  Native Windows is unsupported and has no verification lane for 1.0.
  The clone carrier needs a host toolchain that can link its helper.
- **Performance.** SLO budgets apply only to host classes with a recorded benchmark: the macOS
  arm64 APFS reference host class and, from 2.34.0, `linux-arm64-overlayfs-container`, measured in
  a Docker container in OrbStack's Linux VM on the same machine
  ([performance report](./performance-report.md#linux-container-host-class)). Bare-metal Linux,
  x86-64, and other hosts are unmeasured.
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

## Waivers (owner decisions of 2026-09-23)

Issue [#199](https://github.com/avnionur/shepherd-typescript/issues/199) was closed by these owner
decisions (decision D-019 in [decisions and risks](../.plan/decisions-and-risks.md)). A recheck
the same day found the repository still private, npm not authenticated, and hosted `CI` run
[35868089999](https://github.com/avnionur/shepherd-typescript/actions/runs/35868089999) again
started no job because of the Actions billing or spending limit; `CI` was disabled again.

| ID | Item | Decision |
| --- | --- | --- |
| O-1 | External security review | Waived for 1.0. No external review has been performed; the internal review is accepted in its place |
| O-2 | Signing identity, attestation, npm publication | Waived for 1.0: `"private": true` stays, nothing is signed or published; the [owner release runbook](./release-integrity.md#owner-release-runbook) is the procedure if publication happens later (F-010 accepted) |
| O-3 | Hosted CI and cross-OS lanes | Closed by decision: the local macOS gates plus the local Docker Linux lane are the 1.0 verification substitute; hosted CI stays disabled; CodeQL is waived while the repository is private; no Windows lane (native Windows unsupported) (F-008 accepted) |
| O-4 | Vulnerability intake | Email intake in [SECURITY.md](../SECURITY.md) stands; the advisory form is waived while the repository is private |
| O-5 | Registry name | `@avnionur/shepherd-typescript` decided; not reserved on npm |

If the repository ever becomes public, enabling CodeQL and private vulnerability reporting is the
owner's follow-up. The register is in the
[production hardening contract](../.plan/production-hardening-contract.md#owner-owed-register).

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
