# Implementation Tracker

Last updated: 2026-07-29

Current version: `0.6.0`

Current level: L0 — canonical model

## Current position

Phase 0 governance and repository foundations are established. Phase 1 trace-kernel work is in
progress: canonical records, envelopes, append planning, SQLite durability, content-addressed blob
storage, storage receipts, and blob integrity verification are implemented; graph queries and
recovery work remain.

## Progress

- [x] Research Shepherd's shipped, paper, and vNext surfaces.
- [x] Define compatibility levels and target architecture.
- [x] Scaffold Node, pnpm, TypeScript, and Biome.
- [x] Add test, lint, typecheck, build, and verification commands.
- [x] Implement canonical semantic-record serialization.
- [x] Implement configured SHA-256 record identifiers.
- [x] Test every exported runtime function.
- [x] Add README, changelog, version configuration, and `.gitignore`.
- [x] Organize implemented documentation and document the public API with JSDoc.
- [x] Pin exact upstream development and release revisions with compatibility evidence.
- [x] Resolve npm and CLI naming, MIT licensing, and upstream attribution.
- [x] Add cross-platform CI, security automation, and contribution policies.
- [x] Define the versioned record body and envelope schemas.
- [x] Add canonical implementation-neutral fixture vectors.
- [x] Implement append drafts, parent validation, and owner ordinals.
- [x] Implement the SQLite trace store and atomic append batches.
- [x] Validate critical protocol/store configuration and centralize fixed storage constants.
- [x] Implement content-addressed blob storage, integrity verification, and storage receipts.
- [x] Verify blob receipt recovery across an actual child-process crash.
- [ ] Implement trace cuts and causal-slice queries.

## Verification required for this slice

- [x] `pnpm sync:version`
- [x] `pnpm verify`
- [x] `pnpm build:desktop`
- [x] dependency and lockfile review
- [x] standards, specification, and capability review

## Next slice

Implement TypeScript trace-cut and causal-slice queries over the retained record graph.

## Notes

- `CLAUDE.md` is not present. A repository-specific `template/changelog-template.md` now captures
  the Keep a Changelog and Semantic Versioning format used here.
- Registry names are selected but are not reserved until publication succeeds.
- npm publication remains disabled until package exports and consumer compatibility checks pass.
- Private vulnerability reporting must be enabled in the GitHub repository settings before the
  first public release.
- The upstream lock records provenance only; executable upstream conformance fixtures remain a
  later acceptance requirement.
- Completion includes shipped, substrate, paper-level, and operational capabilities; incomplete
  upstream source is not the stopping boundary.
- TypeScript is the sole implementation target. Upstream Python is a behavioral oracle only, not
  a package planned for this repository.
