# Issue #236 capability preservation

Base: `ee5de08` (current main). Scope: documentation and internal drift tooling; PATCH.

| Capability | Existing evidence | Risk | Required verification |
| --- | --- | --- | --- |
| Accurate capability inventory | Public package exports, linked public-seam suites and normative guides | High | Inventory check rejects stale prose, missing public exports, changed evidence, and missing dimensions |
| Migration examples | Installed example conformance and manifest | High | Existing packaged-example tests and full installed-package gate; preserve all excerpts |
| Task schema and compression behavior | Schema-builder and compression suites | Medium | Existing focused tests; clarify text only |
| Public API, storage, protocols | Generated compatibility and protocol gates | Medium | `pnpm verify`; no runtime change |
| Distribution | Package verification and production build | Medium | Version sync, full verify, desktop build |

Verification (2026-10-03, macOS arm64, Node 24.17.0):

- `node --test test/capability-inventory.test.ts test/task/schema-builders.test.ts test/applications/trajectory-compression.test.ts`: 24 passed.
- `pnpm sync:version`, `pnpm build:desktop`, `pnpm generate:api-reference`,
  `pnpm generate:sbom`, `pnpm update:compatibility-baseline`: passed; zero public surface changes.
- `CI=true pnpm verify` with host access: exit 0; 1,342 tests, 1,340 passed,
  zero failures, two intentional skips; 100% configured line/branch/function coverage;
  installed-package verification passed. The inventory tooling itself is tested by its focused
  regressions; the existing coverage include configuration is unchanged.
- Initial sandbox run could not bind the local HTTP fixture and failed a native filesystem probe;
  host verification resolved these environmental failures without weakening assertions.
- New inventory and maintenance links resolve; `git diff --check` passes.
- Standards and specification reviews found three issues (cross-drive path containment,
  missing paper §3.1 mapping, missing directly pinned recovery tests); all resolved and re-reviewed.

No runtime implementation, storage schema, protocol, existing test assertion, dependency lock or
build allowlist changed. The SBOM also refreshes the already-merged base dependency update.
All high-risk rows above have the required evidence. Referenced test files are executable evidence
specifications, not a claim that live services, external proof builds, or additional hosts were
exercised. The original checkout's pre-existing edits remain outside this worktree.
