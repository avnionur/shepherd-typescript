# Phase 4 L1-stable exit audit

Status: package seam complete in 1.48.0; L1-stable exit blocked

## Scope

This audit checks the documented Shepherd v0.3.0 compatibility slice tracked by epic #17. The
installed offline quickstart closes the package-fixture checklist item, but the parity matrix still
records documented CLI view gaps. Phase 4 and epic #17 therefore remain open.

## Exit evidence

| Criterion | Production seam | Evidence |
| --- | --- | --- |
| Explicit grant identity and ceiling | Public task/grant APIs | Repository-grant and task-world conformance suites |
| Honest placement and jail behavior | Public placed/native execution | macOS Seatbelt/Linux Landlock probes, refusal, process, and recovery suites |
| Exact settlement and recovery | Public select/apply/release/discard/repair APIs | Restart, interruption, concurrency, moved-basis, custody, and citation suites |
| Bounded selectors and evidence | Public task/run/output/trace/recovery projections | Exact/prefix/latest, archive, reopen, and fresh-process suites |
| Human and stable machine CLI | Source, built, and installed `shepherd-ts` | Byte-preservation, closed JSON schema, error redaction, and generated-reference tests |
| Installed offline quickstart | Freshly packed and installed npm tarball | Emitted checked-in script, retained inspection, exact selection, transcript, file, and CLI JSON assertions |

## Verification

- `CI=true pnpm verify`: 473 tests, 100% line/branch/function coverage, build and installed-package gate
- `CI=true pnpm verify:serial`: 473 tests, 100% line/branch/function coverage, build and installed-package gate
- `pnpm build:desktop`
- `npm pack --dry-run` with an isolated cache
- `pnpm audit --prod --audit-level=moderate`
- pinned-oracle, standards, specification, and capability-preservation review

## Remaining boundaries

L1-stable exit remains blocked by the documented `run changeset` view and the remaining upstream
retained-output/vcs-core CLI projections. Dynamic source registration, `package init`, and fenced
`run start` retain their explicit priority/non-claim classifications. These gaps require separate
issues rather than being hidden inside the quickstart fixture.

The package now declares its existing ESM root and type declarations so installed examples can
import the established public facade. Phase 5 still owns facade finalization, subpath exports,
CommonJS policy, richer helpers, source maps, migration guidance, and tree-shaking. Native Windows,
simultaneous multi-world authority, network/read confinement, and live-provider execution remain
explicitly unclaimed. Optimized carriers remain required to pass the reference-copy conformance
gate before any parity claim.
