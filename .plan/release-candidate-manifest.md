# Release-candidate verification manifest

Status: 2.32.5 release candidate for the in-repo scope, 2026-09-19, #29 (2.32.4 audit candidate
plus the F-029 fix; the 2.32.4 results are kept below for history). Verdict and reasoning:
[Phase 11 exit audit](./phase-11-exit-audit.md). Nothing listed here is signed or published.
The [owner actions (2.33.3)](#owner-actions-2333) section records the owner decisions of #191 and
the npm-version-independent packed file set; the [owner decisions (#199)](#owner-decisions-199)
section records the waivers that make 1.0 a private, unpublished source release. The digests below
remain those of 2.32.5.

## Owner decisions (#199)

Owner decisions of 2026-09-23 closing
[#199](https://github.com/avnionur/shepherd-typescript/issues/199), recorded in 2.34.0 (decision
D-019 in [decisions and risks](./decisions-and-risks.md)). No new digest is recorded here; the
evidence is the [2.34.0 addendum](./phase-11-exit-audit.md#owner-decisions-and-10-close-out-2340).

| Item | State |
| --- | --- |
| Recheck (2026-09-23) | Repository private; npm not authenticated; hosted `CI` run [35868089999](https://github.com/avnionur/shepherd-typescript/actions/runs/35868089999) started no job because of the Actions billing or spending limit; `CI` disabled again |
| Release form | 1.0 is a private, unpublished source release: `"private": true` stays, nothing is signed or published, `@avnionur/shepherd-typescript` is not reserved on npm (O-2, O-5 waived; F-010 accepted) |
| Verification substitute | Local macOS gates (`pnpm verify`, `pnpm verify:release`, `pnpm build:desktop`) plus the local Docker Linux lane; hosted CI stays disabled (O-3 closed by decision; F-008 accepted) |
| CodeQL and advisory form | Waived while the repository is private; email intake in [SECURITY.md](../SECURITY.md) stands. Enabling both if the repository becomes public is the owner's follow-up |
| Windows | No Windows lane; `windows-latest` removed from the `ci.yml` matrix; native Windows unsupported |
| Linux volume fault suite and Linux SLO host class | Delivered in 2.34.0 through the local Docker lane: `pnpm test:faults:volume` passed on an ext4 loop image as root in a privileged `node:24.21.0-bookworm` container; `linux-arm64-overlayfs-container` budgets and artifact `docs/generated/benchmarks/linux-arm64-overlayfs-container.json`, `pnpm check:slo` passes in the container ([addendum](./phase-11-exit-audit.md#owner-decisions-and-10-close-out-2340)) |
| External security review | None performed; waived for 1.0 (O-1); the internal review is accepted in its place |

## Owner actions (2.33.3)

Owner decisions of 2026-09-23 (#191); remaining owner actions are in
[#199](https://github.com/avnionur/shepherd-typescript/issues/199). Details:
[#191 addendum](./phase-11-exit-audit.md#owner-actions-2333).

| Item | State |
| --- | --- |
| Hosted `CI` (`ci.yml`) and `Dependency Audit` (`dependency-review.yml`) | Disabled. Enabled on 2026-09-23; the dispatched `CI` run on `main` ([35829571781](https://github.com/avnionur/shepherd-typescript/actions/runs/35829571781)) started no job because of an account billing or spending-limit restriction, and the owner disabled both again. No hosted run has passed (#199) |
| Hosted `CodeQL` (`codeql.yml`) | Disabled: code scanning on a private repository needs GitHub Advanced Security, which is unavailable (#199) |
| Packed file set | npm-version independent from 2.33.3 (F-032 fixed): npm 11.19.0 and 12.0.2 pack the same 1,406 files; checked by `pnpm test:package-cli` in `pnpm verify` |
| Vulnerability intake | Private email while the repository is private ([SECURITY.md](../SECURITY.md)); advisory form after it is public (#199) |
| Registry name | `@avnionur/shepherd-typescript` (D-011); not reserved until the first publish (#199) |
| Signing, attestation, publication | None; `"private": true` stays; [owner release runbook](../docs/release-integrity.md#owner-release-runbook) (#199) |
| External security review | None (#199) |

The local Docker Linux lane of 2.33.1 remains the only Linux evidence.

## Identity

| Field | Value |
| --- | --- |
| Package | `@avnionur/shepherd-typescript` (`"private": true`) |
| Version | `2.32.5` (PATCH, F-029 fix; "1.0" is the L4 maturity milestone per D-016, not a package version) |
| Base commit | `8f5dbd1ccf99c9d63ba57caf675219fa30b0b02c` (`main`, 2.25.1) plus the uncommitted Phase 11 branch work (`codex/phase-11-production-hardening`); the provenance statement records `workingTreeClean: false`. The final commit SHA is recorded in the pull request |
| Host | macOS 27.0 (Darwin 27.0.0) arm64, Apple M4 Pro, APFS |
| Toolchain | Node.js v24.17.0, pnpm 10.32.1, SQLite 3.53.0 (bundled with Node) |
| Runtime range | Node `>=24.12.0 <25` |
| Package entries | 16 (`.`, `./applications`, `./canonical`, `./cli`, `./delegation`, `./effects`, `./operations`, `./providers`, `./read`, `./replay`, `./runs`, `./scopes`, `./supervision`, `./tasks`, `./trace`, `./workspace`) |

## Artifact digests

All SHA-256. `release/` is ignored by Git; its files were produced by
`pnpm release:reproducible-build` and `pnpm release:manifest` from the tree above.

| Artifact | Digest |
| --- | --- |
| `pnpm-lock.yaml` | `217867987fd5d55befc3e78d4fa221f1de7aebf239c03426c233ce8170e24718` |
| `docs/generated/sbom.cdx.json` (checked in; identical to `release/sbom.cdx.json`) | `cd93e4ec1a2b0bd5be48c537554bb4ea34c20309f7dd141417e6f91540da2f4c` |
| Tarball `avnionur-shepherd-typescript-2.32.5.tgz`, build 1 | `b4fed60fcde401d02076a5cb7c302fa86f460f5e81c6ea82b517565f174f4d17` |
| Tarball `avnionur-shepherd-typescript-2.32.5.tgz`, build 2 | `b4fed60fcde401d02076a5cb7c302fa86f460f5e81c6ea82b517565f174f4d17` |
| `dist/` output tree, builds 1 and 2 | `sha256:a903a048e4dd9de8183801f52e1d9591dc1a1662c5626eeb0c7772e19d3fd30c` |
| `release/reproducible-build.json` (`identical: true`, no differing file) | `e9b7ccc08f4f6a8d7f0f956ac64b87452ad9220d6dd6b33c55c7de03d7f52268` |
| `release/provenance.intoto.json` (unsigned in-toto v1, SLSA v1 predicate; invocation `sha256:46593ccb1e4e67b0bc38cd332b3872f3f9be5c80fc104d7ed21758b549256348`) | `138956b06754eceb225fe1965dacbdc5aa35e56ccdddfd225a570f720c82eb97` |
| `release/release-manifest.json` (`"signed": false`, commit 8f5dbd1, version 2.32.5) | `6709cf9deb6c8fee465c01d67e0185c04685e93a2e7b05a9cceafd5119d467ad` |
| `spec/compatibility/api-baseline.json` (package 2.32.5) | `334a791afa4170c223c0956020374da6a2b4c86ca51aa0b42cdba250d867d97a` |
| `spec/compatibility/protocol-baseline.json` (package 2.32.5, previous 2.32.4) | `78d40c0df39aac135e4af9d6d759ecfa49b38fb2444b7ee7357b855dfbf0e197` |
| `spec/compatibility/protocol-changes.json` (append-only classified log; unchanged by this PATCH) | `f4125723aaf7f1d5c40364fed147f34fb59fef3a31452f272235f21c36f7db75` |
| `docs/generated/benchmarks/macos-arm64-apfs.json` (kernel benchmark, measured on 2.30.0, 12 samples, 2 warm-ups; configuration `sha256:f618cf1c0eba158e75c8a189a8a37688beefd419f9fc1f01f211b64967e53bb6`) | `e6e12c2b9644c52774f50cd49bf5d2dd6f8105bd89cdb9e1d20ded1e399fe359` |

Stale tarballs are also in the ignored `release/` directory and are not part of this candidate:
`avnionur-shepherd-typescript-2.26.0.tgz` from the #179 run (SHA-256
`0b0570121ab0a9f20cdb92a03fa1e73eca3d8c9b7b587c061c3d2012d66fe9e6`, the 2.26.0 value in the
tracker) and `avnionur-shepherd-typescript-2.32.4.tgz` from the audit run (SHA-256
`b98ea693112436aeba08e8328758d9e15e48021f215196e69776d8c6aeef33dc`, the 2.32.4 value below). The
2.32.4 candidate's other digests were: SBOM
`a0f9fec94ab82d3d19f234a054cf6eb1305693267c1c717020280968e63a8565`, `dist/` tree
`sha256:1b9a315688798bea3ea96c70061691c7fa8d97a6b4b2a0edadac0d960b1b505c`.

To re-check by hand: `shasum -a 256 release/*.tgz` must equal the provenance `subject` digest and
the manifest's tarball entry; `release/sbom.cdx.json` must equal `docs/generated/sbom.cdx.json` at
the recorded commit ([release integrity](../docs/release-integrity.md#local-verification)).

## Recorded runs carried into this candidate

| Run | Command | Package | Result |
| --- | --- | --- | --- |
| Extended fuzz | `pnpm fuzz --seed 185185` | 2.32.0 | 410,400 cases, 0 findings, 188.7 s (the first run with the seed, before the F-015 fix, found F-015 and F-016) |
| Soak | `pnpm test:soak --duration 720` (seed 186186) | 2.32.1 | 722.1 s, 2,537 operations, 41 kill cycles (3,230 complete, 24 retryable, 11 refused), 26 verified backups, 59 maintenance passes, 369 telemetry batches, 51 invariant checks, passed |
| Real-volume ENOSPC | `pnpm test:faults:volume` | 2.32.1 | 16 MiB HFS+ image; classified retryable; passed |
| Page-flip sweep | `SHEPHERD_FAULT_SEED=1..64` | 2.32.1 | 3,072 cases: 1,701 recovered, 1,296 detected, 75 refused; no silent difference |
| Minimum-Node drills | backup, restore, drill, and store CLI suites on Node 24.12.0 and 24.17.0 | 2.29.0 | pass |

These were not re-run for 2.32.4. The fixes after them (2.32.2, 2.32.3) are covered by the bounded
fuzz, fault, corruption, and soak tiers that run inside `pnpm test` below.

## Fresh verification (2.32.5)

| Command | Result |
| --- | --- |
| `pnpm sync:version` | 1 version file synchronized |
| `pnpm generate:sbom`, `pnpm generate:api-reference`, `pnpm update:compatibility-baseline` | Regenerated; no classified change |
| `CI=true pnpm verify`, first run | Stages through `typecheck` pass (`check:compatibility`: 0 changes; `lint`: 0 errors, 2 pre-existing warnings); `pnpm test`: 1,073 tests, 1,071 pass, 1 skipped (telemetry fuzz target), 1 fail (known host clone carrier test), 100% line, branch, and function coverage |
| `CI=true pnpm verify`, second run (no change between runs) | Same: 1,073 tests, 1,071 pass, 1 skipped, 1 fail (known clone carrier test), 100% coverage; `test/storage/process-race.test.ts` passes in both |
| `pnpm build && pnpm test:package-cli` | Pass (installed runtime 24.17.0 supported) |
| `pnpm build:desktop` | Pass |
| `node --test test/storage/process-race.test.ts`, 10 consecutive runs | 10 of 10 pass, 2 to 3 s each |
| F-029 probes (four and eight processes opening one new database) | 0 failures in 4,000 process starts (coordinator 600 + 920, trace store 640 + 920, task registry 920) |
| `pnpm release:reproducible-build` | Pass; digests above |
| `pnpm release:manifest` | Pass; unsigned evidence written |

`pnpm check:slo` was not re-run for 2.32.5; the fix touches only database open and migration.

## Fresh verification (2.32.4)

| Command | Result |
| --- | --- |
| `pnpm sync:version` | 1 version file synchronized |
| `pnpm generate:sbom`, `pnpm generate:api-reference`, `pnpm update:compatibility-baseline` | Regenerated; no classified change |
| `pnpm release:reproducible-build` | Pass; digests above |
| `pnpm release:manifest` | Pass; unsigned evidence written |
| `CI=true pnpm verify` | Stages through `typecheck` pass (`check:compatibility`: 0 changes; `lint`: 0 errors, 2 pre-existing warnings); `pnpm test`: 1,066 tests, 1,064 pass, 1 skipped (telemetry fuzz target), 1 fail (known host clone carrier test), 100% line, branch, and function coverage |
| `pnpm build && pnpm test:package-cli` | Pass (installed runtime 24.17.0 supported) |
| Second `CI=true pnpm verify` (documentation edits only since the first) | Stages through `typecheck` pass; `pnpm test`: 1,066 tests, 1,063 pass, 1 skipped, 2 fail (the known clone carrier test and `test/storage/process-race.test.ts`, finding F-029: a child exited with `database is locked` on concurrent first open); 100% coverage; the test process hung on an orphaned child until it was killed by hand. `pnpm build && pnpm test:package-cli` and `pnpm build:desktop` pass again |
| `pnpm check:slo` | Pass, host class `macos-arm64-apfs`, 10 of 10 budgets |
| `pnpm build:desktop` | Pass |

The known failure, "clone carrier fails closed on a macOS filesystem without clonefile support",
comes from the host C toolchain being unable to link the clone helper; it fails identically on
`main`. `CI=true pnpm verify:release` stops at that test stage, so its parts were run individually.
The 2.32.4 process-race failure was F-029 (Low): it reproduced in probes that open one new
database from four processes at once. It is fixed in 2.32.5 (see the table above and the
[exit audit](./phase-11-exit-audit.md#f-029-follow-up-2325)).

## Not in this manifest

- Hosted CI runs: none has run a job; see [owner actions (2.33.3)](#owner-actions-2333) and
  [owner decisions (#199)](#owner-decisions-199); hosted CI stays disabled by owner decision (O-3).
  CodeQL results: none (disabled; waived while private).
- Signed provenance, Sigstore attestation, npm publication: none; waived for 1.0 (O-2, #199).
- External security review report: none; waived for 1.0 (O-1, #199).
- Cross-OS reproducibility and Windows verification: none (no Windows lane for 1.0, #199). The Linux
  SLO host class of 2.34.0 is a container-in-VM measurement, not a release artifact (see the
  [addendum](./phase-11-exit-audit.md#linux-slo-host-class)). A local Docker Linux lane on 2.33.1 is recorded in the
  [exit audit addendum](./phase-11-exit-audit.md#linux-verification-lane-and-close-out-2331); its
  tarballs are not release artifacts and differed from the reference host's by npm version
  (F-032, fixed in 2.33.3).
- Published support policy: the [support policy](../docs/support-policy.md) is in the repository;
  no package release publishes it.
