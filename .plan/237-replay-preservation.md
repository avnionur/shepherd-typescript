# Issue #237 replay request preservation

Base: ef88184. Acceptance: bind a command to a normalized branch request before any receipt,
compensation or restoration; reject conflicts, preserve exact retries and expose retained identity.
Replay evidence changes require a new protocol and MAJOR release with explicit older-record refusal.

| Capability | Existing evidence | Risk | Required verification |
| --- | --- | --- | --- |
| Exact branch command identity | Reproduced completed retain/compensate conflict | High | Public rewind/replay tests for every semantic field, malformed retry, reopen and races |
| Source retain and compensation | replay-source-disposition, compensation and kill suites | High | World row and compensation counts, exact retries, concurrent conflicts before handler invocation |
| World/provider/process restoration | replay-branch, checkpoint and conformance suites | High | Existing restores and unchanged retry roots; no physical work for conflicting command |
| Application exploratory replay | CRO, Tree-RL, compression and meta-agent suites | High | Existing application and installed-package tests |
| Durable evidence and inspection | Replay codecs, schemas, archive tests | High | New request schema, inspection, export/import, explicit legacy refusal |
| Distribution | Compatibility, packaged CLI and build | Medium | Version sync, full pnpm verify, desktop build |

Verification (2026-10-03, macOS arm64, Node 24.17.0):

- The new completed-disposition regression failed before implementation with missing rejection.
- `node --test test/replay/*.test.ts test/effect/compensation.test.ts test/applications/exploratory-branch-compensation.test.ts`: 68 passed during implementation.
- Final `node --test test/replay/replay-request-identity.test.ts`: 11 passed. It proves semantic-field
  conflicts independently, malformed retries, exact repeats, two-connection interleavings,
  root/branch/legacy transaction races, reopen/import, corrupt evidence, and recovery after an
  uncertain compensation with exactly one world-changing deletion under the idempotency key.
- `pnpm sync:version`, `pnpm build:desktop`, protocol/reference/SBOM generation, compatibility
  baseline update and capability inventory regeneration passed. Dependency locks/allowlists unchanged.
- Final `CI=true pnpm verify` with host access: exit 0; 1,353 tests, 1,351 passed, zero failures,
  two skips, 100% configured line/branch/function coverage; installed-package checks passed.
- Final `pnpm build:desktop` and `git diff --check` passed.
- Standards/spec reviews: no remaining findings. Retained-body error classification was corrected
  with public-inspection corruption regressions; the request causal link was verified.
- Initial full verification found a duplicate embedded schema ID; the generator now lifts shared
  definitions without re-registering the standalone session schema. The affected ledger/recovery
  tests and final full suite pass. Transaction-race coverage gaps were closed without exclusions.

All high-risk matrix rows have public-seam evidence. Legacy mutation retries are intentionally
refused as required by #237, with a 12.0.2 golden archive and a MAJOR 13.0.0 upgrade boundary.
No existing assertion was weakened. No additional live-provider, remote-host or performance claim.
Compensation attempt ownership across different commands remains #240; arbitrary callbacks are
not claimed exactly-once. The original main checkout remains unchanged.
