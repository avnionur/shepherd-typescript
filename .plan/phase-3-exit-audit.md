# Phase 3 Exit-Criteria Audit

Status: complete

Audited version: `1.36.1`

## Result

Phase 3 satisfies the P0 retained-world isolation, inspection, exact selection, consume-once
settlement, discard-preservation, and restart-recovery criteria through the public TypeScript
entry point. This earns the `L1-alpha` compatibility label for the minimal end-to-end settlement
loop; it is not complete Shepherd `0.3.0` parity.

## Evidence matrix

| Exit criterion | Public entry point | Repeatable production-seam evidence | Result |
| --- | --- | --- | --- |
| Retained execution leaves user files unchanged | `captureTaskWorldDurably` | `captureTaskWorldDurably retains isolated runner changes inside the terminal cut` asserts that the user file remains at its original bytes while the authenticated retained head contains the runner change. | Pass |
| Inspection reproduces adds, edits, deletes, modes, and symlinks | `createWorldChangeset`, `createWorldChangesetInspection`, `createGitChangesetInspection` | The changeset suite reconstructs ordered file, directory, mode, symlink-target, and replacement changes; inspection authenticates retained content, bounded previews, moves, Gitlinks, and symlink modes. | Pass |
| Selection refuses a moved user basis | `selectRetainedWorldSettlement` | `public select refuses movement at both pre-write basis checks` covers movement before admission begins and movement between the coordinator and carrier checks without overwriting user bytes. | Pass |
| Concurrent settlements have one winner | `prepareRetainedWorldSettlement` | The public task-world test races `select` and `discard` across two store connections, requires exactly one fulfilled admission, and requires the loser to report `RetainedWorldSettlementConflictError`. | Pass |
| Discard preserves the parent and user workspace | `discardRetainedWorldSettlement` | `public discard commits terminal authority before cleanup and recovers after reopen` verifies immutable parents remain reopenable, mutable custody is removed, and user bytes remain unchanged. | Pass |
| Outputs reopen, inspect, and settle after restart | `inspectTaskWorldCaptureJournal`, `inspectRetainedWorldSettlement`, `selectRetainedWorldSettlement`, `discardRetainedWorldSettlement` | Public select replays after reopen, discard converges from cleanup-pending after reopen, settlement citations survive native export/import, and interrupted carrier/store/citation boundaries repair without replaying a different decision. | Pass |
| Protected and unsupported platform state fails closed | `inspectWorkspacePathProtection`, `inspectWorkspacePlatformConformance` | Protected-path and platform suites cover aliases, metadata refusal, case collisions, Git platform policy, precise fault evidence, honest receipts, and retry convergence. | Pass with platform limits below |

Focused audit command:

```sh
node --test test/workspace/task-world-execution.test.ts \
  test/workspace/changesets.test.ts \
  test/workspace/changeset-inspection.test.ts \
  test/workspace/git-changeset-inspection.test.ts \
  test/workspace/retained-world-select.test.ts \
  test/workspace/retained-world-discard.test.ts \
  test/workspace/protected-control-paths.test.ts \
  test/workspace/platform-fault-conformance.test.ts \
  test/store/retained-world-settlements.test.ts
```

The audit baseline passed all 34 focused tests.

## Packaging and dependency evidence

- `pnpm audit --prod --audit-level=moderate` reports no known vulnerabilities.
- `npm_config_cache=<isolated temporary cache> npm pack --dry-run` validates the package allowlist
  without changing the user npm cache; the final package contains 619 files including `dist`.
- `pnpm sync:version` passed for `1.36.1`.
- `pnpm verify` and `pnpm verify:serial` each passed 378 tests with 100% line, branch, and function
  coverage.
- `pnpm build:desktop` passed against the synchronized version.
- The repository-bundled Cognia dependency script is not applicable: it audits an Electron
  `desktop/package.json`, while this repository is a Node package with one root manifest.

## Platform and compatibility limits

- The supported Phase 3 implementation scope is macOS and Linux. Native Windows has configured,
  platform-gated ACL and alternate-stream policy fixtures, but the repository GitHub CI workflow
  is manually disabled and no final Windows lane is claimed by this audit.
- The reference copy carrier is the correctness oracle. No optimized carrier claims parity.
- Runtime grants, advisory/auto placement reporting, and native Seatbelt/Landlock filesystem-write
  enforcement are now implemented in Phase 4. `apply`, `release`, CLI compatibility, and the
  installed-package quickstart remain open.
- `npm pack --dry-run` verifies package contents only. Installed consumer import/type fixtures and
  publication readiness remain Phase 4/5; npm publication stays disabled.
- Upstream Python is a pinned behavioral oracle. This audit does not claim full upstream or paper
  parity and does not add a Python runtime dependency.

## Phase boundary

After this audit merges, close Phase 3 epic #16 and activate Phase 4 epic #17. Phase 4 owns the
remaining documented `0.3.0` `apply`/`release` settlement, CLI, repair, and
installed-package compatibility work.
