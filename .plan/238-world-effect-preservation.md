# Issue #238 world operation preservation

Base: 8e8fcb2 (main after #237). Scope: automatic operation evidence at the supplied retained-world
capability, distinct from enclosing tool-loop effects. Planned additive MINOR release; classify
any discovered incompatible contract change before delivery.

| Capability | Existing evidence | Risk | Required verification |
| --- | --- | --- | --- |
| Intermediate read/write history | Public capture and run trace | High | Write A/B/read and write/restore with empty final changeset; correlated intent/admission/outcome |
| Exact resource grants and fencing | task-world-execution and repository-grant suites | High | Denied operations produce no physical change; stale writer cannot append or mutate |
| Content and secret policy | retention/secret scanning and capability size/UTF8 tests | High | Bounded digest-only content evidence; no plaintext text/path/exception secrets in journal |
| Crash and recovery | Capture journal recovery and durable-run readers | High | Process interruption before/after materialization, reopen inspection and custody comparison; no uncertain operation replay |
| Cancellation and partial capture | Cooperative cancellation fixture | High | Cancelled admission has no filesystem work; verified partial custody remains retained |
| Existing filesystem semantics | Main task-world suite | High | Creation only at root, existing nested files, symlink/control/Git/path/UTF8/size refusal, unchanged user binding |
| Tool-loop boundary | Tool loop and retained examples | Medium | Keep outer tool effects distinct; full suite and installed package |
| Protocol/distribution | Generated schema, compatibility and package gates | Medium | Config-owned vocabulary, documentation, version sync, full verify and desktop build |

Operations will use the existing invocation-guarded append seam and remain in the run's terminal
prefix. Failed journal publication must stop physical work or leave uncertainty, never fabricate
success. Stale capabilities have no authority to append diagnostic records after settlement.
## Verified evidence (2026-10-04)

- `node --test test/workspace/world-effect-journal.test.ts test/workspace/world-effect-crash.test.ts test/workspace/world-effect-evidence.test.ts test/workspace/world-effect-config.test.ts`: 11 passed; independently repeated by both reviewers.
- Actual process SIGKILL before admission and after mutation; reopened/imported trace classifications compared with custody and original bytes. Uncertain runner recovery refused.
- Existing task-world/repository-grant/native-jail suites exercised; the legacy fixture excludes modern operation records when simulating an old trace. Existing assertions remain intact. The export manifest explicitly includes the new public symbols.
- `CI=true pnpm verify` on Node 24.17.0, macOS host: 1,364 tests, 1,362 passed, two intentional skips, zero failures; 100% configured line/branch/function coverage. Protocol, evaluation, SBOM, API/capability inventory, compatibility, lint, typecheck and installed-package gates passed.
- `pnpm sync:version` and `pnpm build:desktop` passed; additive MINOR 13.1.0. No dependency, lockfile or lifecycle allowlist change.
- Spec and Standards reviews: no remaining findings. A discovered lost-admission acknowledgement bug was reproduced and fixed: storage failures retain their type, cannot synthesize a stale-head outcome, and block further I/O even when caught by the runner.
- Final verification log: `/private/tmp/shepherd-238-verify-final.log`. The earlier full run exposed an export-list fixture omission and an existing corruption branch preempted by the new validator; explicit fixtures now cover both without weakening assertions or coverage thresholds.

The package has no Electron application beyond the build alias. Existing native/macOS checks ran in the full host suite. No new Linux/Windows host, live-provider, performance or formal proof evidence is claimed. Direct filesystem calls and native syscalls remain outside the supplied-capability operation journal.
