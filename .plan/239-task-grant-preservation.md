# Issue #239 preservation matrix

Base: be35ca9 (PR #273). Scope: authenticated exact-version registry companion evidence and
read-only CLI task inspection. Planned MINOR feature; migration compatibility must be classified
before release.

| Capability | Existing evidence | Risk | Required verification |
| --- | --- | --- | --- |
| Task registration/identity | registry persistence/validation/migration suites | High | Atomic exact-version registration; no task artifact changes; equal retry preserves evidence |
| Grant authentication | repository grant and task ledger tests | High | Package-authenticated handles only; canonical companion identity and exact task binding on reopen |
| Corrupt/stale declaration refusal | task registry corruption fixtures | High | Invalid/mismatched artifact, lock, digest and conflicting declaration rejected |
| Read-only human/JSON task show | CLI and package gates | High | Mixed profiles, instruction/schemas, no per-run authority implied, ungranted null, reopened registry |
| Migration/old registrations | task registry migration tests | High | Writable upgrade preserves existing tasks; read-only old schema refuses migration |
| Adjacent execution grants | retained-world grant tests | High | Inspection supplies no execution handle/ceiling/resource authority |
| Distribution | full verify/package/build | Medium | Installed package task show, docs, generated contracts, version synchronization |

## Verification (2026-10-04)

- Red: the public exact-version reopen regression failed because `registerGranted` did not exist.
- Focused registry/grant/ledger/validation suites: 14 passed. Both independent reviewers repeated grant/persistence suites (9 passed) and found no actionable Spec/Standards/capability issues.
- Mixed profiles and ungranted registrations inspected through the freshly installed package binary, in new processes, in human and stable JSON modes. Instructions/schemas and declaration-only authority boundary asserted.
- Forged handles, changed declaration, stale task digest, wrong protocol/lock/profile, malformed JSON and corrupt retained evidence refuse. Ordinary register retries preserve companions; exact version isolation and legacy schema migration are covered.
- `CI=true pnpm verify` (Node 24.17.0, macOS host): 1,369 tests; 1,367 passed, two intentional skips, zero failures; 100% configured line/branch/function coverage. All protocol, evaluation, SBOM, API/capability, compatibility, lint, typecheck and installed-package gates passed.
- `pnpm sync:version`, `pnpm build:desktop`, final API reference and compatibility checks passed. MINOR 13.2.0; no dependency, lockfile or lifecycle allowlist changes.
- Final full log: `/private/tmp/shepherd-239-verify-final.log`. An earlier run stopped at a test-only TypeScript assertion argument error; fixed without runtime changes or weakened assertions. Existing fixture version assertions were advanced for the new supported registry schema and future-schema refusal remains tested.

No execution grant plan, provider call or world mutation is introduced by inspection. Content-addressed evidence does not authenticate against complete malicious database rewrites. No new platform/live-provider/formal evidence is claimed; package has no separate Electron application beyond its desktop-build alias.
