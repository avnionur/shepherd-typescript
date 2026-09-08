# Phase 5 product-surface exit audit

Audit version: 1.68.1, 2026-09-08. Issue: #123. Runtime baseline: `a913b03` (1.68.0).

Verdict: **do not close Phase 5**. The delivered product surface has local conformance evidence,
but the declared runtime range does not match a required SQLite capability. Remediation is #124.
Completing this audit is not equivalent to passing phase exit.

## Scope and evidence boundary

The [roadmap](./implementation-roadmap.md#phase-5--native-typescript-product-surface) defines five
exit criteria; [epic #18](https://github.com/avnionur/shepherd-typescript/issues/18) groups them into
two exit checkboxes. The 22 implementation children were all closed when this audit began:
#72, #74, #76, #78, #80, #82, #84, #86, #88, #90, #96, #98, #99, #100, #101, #102,
#108, #109, #115, #117, #119 and #121. The audit (#123) and newly discovered remediation (#124)
are not part of that completed inventory.

Evidence is scoped to the installed package and documented fixtures, not universal combinations
of exports, future adapters, or every runtime satisfying the current engine expression. This audit
changes documentation/version metadata only; runtime, protocol, schemas, dependencies and tests
are unchanged.

## Roadmap exit criteria

| Criterion (unchanged) | Evidence at the consumer boundary | Outcome |
| --- | --- | --- |
| A new TypeScript user completes the offline settlement loop from docs | [Quickstart](../docs/quickstart.md), [example guide](../docs/typescript-examples.md), [installed CLI/quickstart verifier](../tooling/testing/packaged-cli.ts): isolated capture, inspection, exact selection, selected bytes, reopen/CLI citations | Verified on the recorded host/runtime; automated walkthrough, not a human usability study |
| Public API reports no unexpected types | [Export map](../package.json), [generated reference](../docs/generated/api-reference.md), [reference policy](../api-reference.config.json), [positive/negative generator tests](../test/api-reference.test.ts), strict installed entry and example consumers | Verified for declared exports/configured privacy policy; no claim of exhaustive semantic type equivalence for every API |
| Optional provider/platform packages do not load when unused | Package manifest has no runtime dependencies, optionalDependencies or peerDependencies; [loading policy](../entry-loading.config.json) and [fresh-process checks](../tooling/testing/entry-loading.ts) record actual builtin loads | Separate optional adapters: not applicable because none ship. Existing builtin loading: verified, including explicit eager Node entries; future adapters are not credited as tested |
| ESM/CJS/runtime support matches the published matrix | Installed ESM entry imports, CommonJS/deep-import refusal, no-Node `/read` compilation and [package policy](../docs/package-exports.md) | Module-format evidence verified; **runtime-range criterion blocked by #124** |
| TypeScript examples are tested in packaged form | [Manifest](../examples/manifest.json) and [installed-example verifier](../tooling/testing/packaged-examples.ts) compile and execute all four examples outside node_modules, compare independent transcripts/files, and verify guide excerpts | Verified on recorded host/runtime, including repeat review preservation and existing-directory refusal |

The epic's “Packaged examples complete the offline settlement loop” checkbox is supported by the
first and fifth rows. Its “Public API, module formats, runtime support, and optional loading match
the published matrix” checkbox must remain unchecked because runtime support is not yet aligned.

## Work-item coverage

| Delivered area | Issues | Implementation and evidence |
| --- | --- | --- |
| ESM facade/domain entries and authority separation | #72–#84 (seven even-numbered tasks) | [Facades](../src/facades), exact [export-map test](../test/cli/package-bin.test.ts), installed namespace/declaration probes and composed retained-output consumer |
| Structured errors, maps and original causes | #86, #88 | [Error contract](../docs/public-errors.md), [error tests](../test/errors/public-error-codes.test.ts), [map/cause policy](../docs/source-maps-and-causes.md), installed mapped-stack and cause checks |
| Generated reference and repository tooling ownership | #90, #96 | [Reference tests](../test/api-reference.test.ts), [structure](../docs/project-structure.md), runtime-only build config, installed assertions that dist/scripts and dist/tooling are absent |
| Four TypeScript examples and migration | #98–#102 | Retained coding, repeat read-only review, sibling-preserving multiple bindings, custom effects; [migration guide](../docs/python-to-typescript.md) excerpts checked against executed installed source |
| Loading and tree-shaking | #108, #109 | Ten-entry loading matrix; [two Rollup fixtures](../bundle-verification.config.json) verify smaller optimized chunks, retained/removed code, execution and missing/malformed/restored assets via [bundle verifier](../tooling/testing/bundles.ts) |
| Typed handlers and schema adaptation | #115, #117 | [Typed-handler tests](../test/effect/typed-handlers.test.ts), [JSON adapter tests](../test/task/json-schema-adapter.test.ts), installed custom-effect example; no arbitrary schema vocabulary or typed-result claim |
| Web-safe types and async trace consumption | #119, #121 | [Read entry](../docs/web-safe-read-types.md), no-Node Bundler/NodeNext compile, empty runtime namespace, [cut-iteration tests](../test/store/cut-iteration.test.ts), installed iterator consumer |

The repository-owned TypeScript compiler reference generator is the documented alternative to
TypeDoc/API Extractor, not a claim that either external generator was installed. Typed helpers
cover provider contracts/static fixtures and schema-validated in-process effect payloads. They do
not add live providers or durable tool dispatch. Async queries cover fixed published-cut owner
occurrences, not live observation, visibility filtering or graph closure.

## Blocking finding: declared runtime range

`package.json` declares `node: ">=24.0.0"`. Both
[trace-store construction](../src/store/sqlite-trace-store.ts) and
[task-registry construction](../src/task/sqlite-task-registry.ts) pass configured `defensive: true`
to `DatabaseSync`; the [normative configuration contract](../docs/protocol-configuration.md)
requires that setting to remain enabled.

[Node's SQLite history](https://nodejs.org/api/sqlite.html#new-databasesyncpath-options) dates support
for that option to 24.12.0/25.1.0. The
[24.0.0 implementation](https://github.com/nodejs/node/blob/v24.0.0/src/node_sqlite.cc) does not
implement it. Therefore the declared range includes runtimes unable to honor the required option.
This is a source/documentation-backed compatibility finding, not an executed old-runtime failure
or demonstrated exploit. Current 24.17.0 success cannot resolve it.

[#124](https://github.com/avnionur/shepherd-typescript/issues/124) owns an approved support policy,
capability enforcement, minimum/unsupported-version verification and updated guidance. A simple
numeric lower bound must account for gaps in other included majors. Do not disable the setting
or silently remove supported versions; support-policy changes require approval and semantic-version
classification. This audit does not implement the remedy or change the engine range.

## Verification record

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

## Limits and next action

CI, CodeQL and Dependency Review remain disabled at the owner's request. No fresh hosted Windows
or Linux run, browser-engine execution, old-Node runtime run, Python conformance run, bundled
source-map portability, arbitrary bundle combination or absent optional-adapter behavior is claimed.
The full local suite includes capability-probed native tests, not new evidence for every OS.

Publication remains disabled (`private: true`). This audit does not grant release readiness,
security certification, L2 scope algebra, live providers, supervision, replay or paper-level parity.

Next actionable work is #124 after support-policy approval. Keep #18 open until that finding is
resolved and its exit evidence reviewed. Phase 6 (#19) declares Phase 3 as its blocker, not Phase 5;
Phase 3 is already closed, so its old blocked tracking text needs reconciliation when that phase
is selected. This audit does not invent a Phase 5 dependency or activate Phase 6 automatically.
