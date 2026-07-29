# Implementation Tracker

Last updated: 2026-07-29

Current version: `0.1.2`

Current level: L0 — canonical model

## Current position

Phase 0 repository foundation is in progress. The first Phase 1 technical slice was started early
with deterministic semantic-record canonicalization and content-addressed identifiers.

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
- [ ] Resolve package naming and licensing.
- [ ] Add CI, security, and contribution policies.
- [ ] Define the versioned record body and envelope schemas.
- [ ] Add canonical cross-language fixture vectors.
- [ ] Implement append drafts, parent validation, and owner ordinals.
- [ ] Implement the SQLite trace store and atomic append batches.
- [ ] Begin the native Python implementation against the same fixtures.

## Verification required for this slice

- [x] `pnpm sync:version`
- [x] `pnpm verify`
- [x] `pnpm build:desktop`
- [x] dependency and lockfile review
- [x] standards, specification, and capability review

## Next slice

Continue Phase 0 by resolving package naming and licensing and adding the initial CI, security,
and contribution policies. Then define the versioned `RecordBody` and `RecordEnvelope` contract.

## Notes

- `CLAUDE.md` is not present. A repository-specific `template/changelog-template.md` now captures
  the Keep a Changelog and Semantic Versioning format used here.
- Package and CLI naming remain provisional until the naming decision in
  `decisions-and-risks.md` is resolved.
- npm publication remains disabled until package naming and licensing are resolved.
- The upstream lock records provenance only; executable upstream conformance fixtures remain a
  later acceptance requirement.
- Completion includes shipped, substrate, paper-level, and operational capabilities; incomplete
  upstream source is not the stopping boundary.
