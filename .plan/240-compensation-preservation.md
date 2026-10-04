# Issue #240 preservation matrix

Base: 8f2fecc (main after PR #274). Scope: serialized durable compensation admission,
lease renewal/expiry and fenced outcome publication. Additive MINOR 13.3.0; store schema 14.

| Capability | Existing evidence | Risk | Required verification |
| --- | --- | --- | --- |
| Single active attempt | Reproduced concurrent public triggers | High | Separate SQLite connections/processes cannot both enter an unexpired attempt |
| Materialization identity | compensation/replay/scope suites | High | Same original record yields stable compensation ID/external key across all triggers |
| Recovery after interruption | compensation kill and row-world fixtures | High | SIGKILL before invocation, after world change, before publication; expiry and stable-key retry |
| Stale owner exclusion | Store transaction seam | High | Expired/replaced owner cannot renew, append outcome or release newer holder |
| Handler failure and reverse order | compensation suite | High | Failed results retained, throws propagate, retry remains idempotent; all effects attempted |
| Compensated terminality | Existing reader/trigger evidence tests | High | Completed compensation never invokes again; raw append cannot forge completion |
| Imported/historical evidence | Existing codecs/archive semantics | High | Honest ownership classification; no live lease inferred from imported records |
| Store migration/integrity | migration/backup/interchange suites | High | New private ownership state survives reopen and is validated; readonly never migrates |
| Protocol/distribution | config/schema/API/package gates | Medium | Config-owned values, honest docs, semantic version, full verify/build |

Fencing is not exactly-once external execution. A paused or partitioned process may outlive its
lease; handler idempotency under the stable materialization key remains required. No manual
reconciliation/waiver feature is implied; that is #241.

## Verified evidence (2026-10-04)

- Public concurrency regression first failed because a second connection entered the handler; now it refuses before invocation. Separate child processes prove one invocation under an active lease.
- Eight ownership/evidence tests pass, independently repeated by Spec and Standards reviewers with no remaining findings. They cover real SIGKILL before invocation, after world change and before publication; reopen/import; active/expired/released/absent inspection; heartbeat renewal; stale outcome and replacement-release exclusion; acknowledgement loss and corruption.
- Existing rewind/replay/discard/tool-loop/fault suites: 10 passed. Actual lease expiry is awaited in the original kill suite; targeted tests also use an explicit deterministic clock advance after confirmed child death. Existing reverse order, successful terminality and stable-key world assertions remain.
- The old concurrent-double-invocation fixture now asserts the requested denial before invocation and one successful owning attempt. Migration/backup fixtures were advanced to schema 14 and its populated ownership golden; no corruption or downgrade assertions were removed. New ownership code reaches 100% focused coverage.
- `CI=true pnpm verify` (Node 24.17.0, macOS host): 1,379 tests; 1,377 passed, two intentional skips, zero failures; 100% configured line/branch/function coverage. All protocol, evaluation, SBOM, API/capability, compatibility, lint, typecheck and installed-package gates passed.
- `pnpm sync:version` and `pnpm build:desktop` passed. No dependency, lockfile or lifecycle allowlist change.
- Successful full log: `/private/tmp/shepherd-240-verify-retry.log`. An earlier run found migration fixture drift, corrected without weakening assertions. A later run ended with SIGTERM before reporting completion; no task-owned workers remained before the successful retry.

No separate Electron application exists beyond the desktop build alias. No new remote/Windows/Linux host, live-provider or formal proof result is claimed. The lease is store-local operational state; imported copies carry no live owner and cannot coordinate external work. Handler idempotency remains required after expiry.
