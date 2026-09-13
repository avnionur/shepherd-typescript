# Phase 5 product-surface exit audit

Initial audit: 1.68.1, 2026-09-08, #123; baseline `a913b03` (1.68.0).
Remediation review: 2.0.0, #124.

Verdict: **complete for the documented scope**. Remediation #124 merged through PR #126 as
`7d978c1`, all 24 children are closed, and epic #18 is closed. The owner-approved runtime policy
and behavioral/boundary checks resolve the original finding. Phase exit is not production readiness.

## Scope and evidence boundary

The [roadmap](./implementation-roadmap.md#phase-5--native-typescript-product-surface) defines five
exit criteria; [epic #18](https://github.com/avnionur/shepherd-typescript/issues/18) groups them into
two exit checkboxes. The 22 implementation children were all closed when this audit began:
#72, #74, #76, #78, #80, #82, #84, #86, #88, #90, #96, #98, #99, #100, #101, #102,
#108, #109, #115, #117, #119 and #121. The audit (#123) and newly discovered remediation (#124)
are not part of that completed inventory.

Evidence is scoped to the installed package and documented fixtures, not universal combinations
of exports, future adapters, or every possible runtime build. The original audit was documentation
only. Remediation adds runtime gates and tests while leaving protocol identities, storage schemas
and dependency locks unchanged; the narrower support range is an approved breaking change.

## Roadmap exit criteria

| Criterion (unchanged) | Evidence at the consumer boundary | Outcome |
| --- | --- | --- |
| A new TypeScript user completes the offline settlement loop from docs | [Quickstart](../docs/quickstart.md), [example guide](../docs/typescript-examples.md), [installed CLI/quickstart verifier](../tooling/testing/packaged-cli.ts): isolated capture, inspection, exact selection, selected bytes, reopen/CLI citations | Verified on the recorded host/runtime; automated walkthrough, not a human usability study |
| Public API reports no unexpected types | [Export map](../package.json), [generated reference](../docs/generated/api-reference.md), [reference policy](../api-reference.config.json), [positive/negative generator tests](../test/api-reference.test.ts), strict installed entry and example consumers | Verified for declared exports/configured privacy policy; no claim of exhaustive semantic type equivalence for every API |
| Optional provider/platform packages do not load when unused | Package manifest has no runtime dependencies, optionalDependencies or peerDependencies; [loading policy](../config/entry-loading.config.json) and [fresh-process checks](../tooling/testing/entry-loading.ts) record actual builtin loads | Separate optional adapters: not applicable because none ship. Existing builtin loading: verified, including explicit eager Node entries; future adapters are not credited as tested |
| ESM/CJS/runtime support matches the published matrix | Installed ESM entry imports, CommonJS/deep-import refusal, no-Node `/read` compilation and [runtime support](../docs/runtime-support.md) | Verified on approved minimum 24.12.0 and current 24.17.0; actual 24.11.1 refusal and modeled other-major/prerelease exclusions; delivered through #124 |
| TypeScript examples are tested in packaged form | [Manifest](../examples/manifest.json) and [installed-example verifier](../tooling/testing/packaged-examples.ts) compile and execute all four examples outside node_modules, compare independent transcripts/files, and verify guide excerpts | Verified on recorded host/runtime, including repeat review preservation and existing-directory refusal |

The epic's “Packaged examples complete the offline settlement loop” checkbox is supported by the
first and fifth rows. Its “Public API, module formats, runtime support, and optional loading match
the published matrix” checkbox is supported by the delivered remediation evidence below.

## Work-item coverage

| Delivered area | Issues | Implementation and evidence |
| --- | --- | --- |
| ESM facade/domain entries and authority separation | #72–#84 (seven even-numbered tasks) | [Facades](../src/facades), exact [export-map test](../test/cli/package-bin.test.ts), installed namespace/declaration probes and composed retained-output consumer |
| Structured errors, maps and original causes | #86, #88 | [Error contract](../docs/public-errors.md), [error tests](../test/errors/public-error-codes.test.ts), [map/cause policy](../docs/source-maps-and-causes.md), installed mapped-stack and cause checks |
| Generated reference and repository tooling ownership | #90, #96 | [Reference tests](../test/api-reference.test.ts), [structure](../docs/project-structure.md), runtime-only build config, installed assertions that dist/scripts and dist/tooling are absent |
| Four TypeScript examples and migration | #98–#102 | Retained coding, repeat read-only review, sibling-preserving multiple bindings, custom effects; [migration guide](../docs/python-to-typescript.md) excerpts checked against executed installed source |
| Loading and tree-shaking | #108, #109 | Ten-entry loading matrix; [two Rollup fixtures](../config/bundle-verification.config.json) verify smaller optimized chunks, retained/removed code, execution and missing/malformed/restored assets via [bundle verifier](../tooling/testing/bundles.ts) |
| Typed handlers and schema adaptation | #115, #117 | [Typed-handler tests](../test/effect/typed-handlers.test.ts), [JSON adapter tests](../test/task/json-schema-adapter.test.ts), installed custom-effect example; no arbitrary schema vocabulary or typed-result claim |
| Web-safe types and async trace consumption | #119, #121 | [Read entry](../docs/web-safe-read-types.md), no-Node Bundler/NodeNext compile, empty runtime namespace, [cut-iteration tests](../test/store/cut-iteration.test.ts), installed iterator consumer |

The repository-owned TypeScript compiler reference generator is the documented alternative to
TypeDoc/API Extractor, not a claim that either external generator was installed. Typed helpers
cover provider contracts/static fixtures and schema-validated in-process effect payloads. They do
not add live providers or durable tool dispatch. Async queries cover fixed published-cut owner
occurrences, not live observation, visibility filtering or graph closure.

## Original blocking finding (1.68.1)

`package.json` declared `node: ">=24.0.0"`. Both
[trace-store construction](../src/store/sqlite-trace-store.ts) and
[task-registry construction](../src/task/sqlite-task-registry.ts) pass configured `defensive: true`
to `DatabaseSync`; the [normative configuration contract](../docs/protocol-configuration.md)
requires that setting to remain enabled.

[Node's SQLite history](https://nodejs.org/api/sqlite.html#new-databasesyncpath-options) dates support
for that option to 24.12.0/25.1.0. The
[24.0.0 implementation](https://github.com/nodejs/node/blob/v24.0.0/src/node_sqlite.cc) does not
implement it. The old declared range therefore included runtimes unable to honor the required option.
The initial finding was source-backed, not an executed old-runtime failure or demonstrated exploit.

The owner subsequently approved Node `>=24.12.0 <25` and major version 2.0.0 in
[#124](https://github.com/avnionur/shepherd-typescript/issues/124). The bounded range excludes the
other-major gaps. Runtime initialization rejects unsupported versions, and an in-memory behavioral
probe precedes trace/registry/staging setup. Required defensive settings remain unchanged. See
[runtime support](../docs/runtime-support.md) for exact errors, assets, tests and migration guidance.

## Original audit verification (1.68.1)

Environment: macOS arm64, Node 24.17.0, pnpm 10.32.1; pinned TypeScript 7.0.2.

- `pnpm sync:version`: passed; version metadata synchronized to 1.68.1.
- Fresh audit `CI=true pnpm verify`: passed; 497 tests, zero skips, 100% configured line/branch/
  function coverage, installed examples/types/runtime/maps/loading/bundles and builds passed.
- `pnpm build:desktop`: passed (this repository's production build alias; no Electron app claim).
- `git diff --check` and all 30 local audit-link targets: passed.
- Audit diff inspection confirms documentation plus version metadata only; the generated reference
  changes only its package-version line. Runtime/protocol/dependencies/tests remain unchanged.
- These successful 24.17.0 checks do not establish the unsupported lower runtime boundary in #124.
- Standards/specification reviews have no remaining findings; new installed-README audit links use
  repository URLs rather than unshipped planning-file paths.

## Remediation verification (2.0.0)

- `CI=true pnpm verify` on Node 24.17.0: 501 tests, zero skips, 100% configured coverage,
  installed package/types/examples/loading/bundles passed.
- The same full command with Node 24.12.0 first in PATH: 501 tests, zero skips, 100% configured
  coverage and installed-package gates passed.
- Explicit installed boundary command exercises actual 24.12.0, 24.17.0 and 24.11.1 binaries.
  Supported store/registry/CLI operations pass; unsupported attempts leave destinations empty.
- Minimum-runtime testing exposed host SQLite ExperimentalWarning stderr. CLI byte tests now
  suppress only that Node warning category in three subprocesses, keeping exact stdout/stderr/
  JSON/exit assertions. Installed boundary checks retain normal warning behavior; no product-wide
  warning suppression was added. The focused CLI test passes on both supported runtimes.
- Version synchronization and production builds pass on both supported runtimes; the final 2.0.0
  boundary rerun passes on all three recorded binaries without downloads.
- Standards/specification reviews have no remaining findings. The only intentional capability
  removal is the approved unsupported-version range; database formats and existing assertions remain.

## Limits and next action

CI, CodeQL and Dependency Review remain disabled at the owner's request. No fresh hosted Windows
or Linux run, browser-engine execution, runtime versions beyond those recorded above, Python conformance run, bundled
source-map portability, arbitrary bundle combination or absent optional-adapter behavior is claimed.
The full local suite includes capability-probed native tests, not new evidence for every OS.

Publication remains disabled (`private: true`). This audit does not grant release readiness,
security certification, L2 scope algebra, live providers, supervision, replay or paper-level parity.

Phase 6 (#19) is now active; its declared Phase 3 prerequisite is closed. Task #127 defines the
initial scope contract proposal. The transition preserves the actual roadmap dependency and does
not imply that scope algebra, optimized carriers or L2 parity are already implemented.
