# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.0] - 2026-07-29

### New Feature

- Added pure append-batch planning with canonical body snapshots and versioned record envelopes.
- Added backward-only append-local references, known-parent validation, duplicate-cause
  rejection, and ordered causal-edge output.
- Added independent owner-local ordinal allocation, inclusive ranges, and record views outside
  semantic identity.
- Added generated JSON Schema contracts for append batch drafts and record views.
- Added closed, descriptor-safe runtime draft validation and deeply frozen planned record
  snapshots.

### Improvement

- Organized runtime modules into `append`, `canonical`, `protocol`, and `record` areas behind the
  unchanged public entry point.
- Added validated build-output cleanup so moved modules cannot leave stale duplicate package
  artifacts.

### Impact

TypeScript can now validate and deterministically prepare records for an atomic trace-store
transaction without coupling semantic identity to owner placement or storage.

## [0.3.0] - 2026-07-29

### New Feature

- Added kernel ABI v0 `RecordBody`, `RecordEnvelope`, and draft types with comprehensive JSDoc.
- Added domain-separated canonical v2 record identity creation and runtime body/envelope
  validation.
- Added generated language-neutral JSON Schema contracts, strict schema conformance tests, and
  pinned cross-language golden vectors.
- Moved all unit tests and fixture assets under `test/`.

### Impact

TypeScript can now produce and verify record envelopes that match the pinned upstream kernel
vectors while keeping path and storage metadata outside semantic identity.

## [0.2.0] - 2026-07-29

### New Feature

- Added pinned cross-platform CI for linting, type checking, tests, production builds, and npm
  package-boundary inspection.
- Added CodeQL, dependency review, and Dependabot security automation.
- Added security reporting, contribution, conduct, pull request, and structured issue policies.

### Impact

Every proposed change now has documented contribution requirements and automated quality,
dependency, packaging, and security review paths.

## [0.1.3] - 2026-07-29

### Improvement

- Selected distinct npm, CLI, Python distribution, and Python import names.
- Licensed original repository work under MIT and added explicit upstream attribution and reuse
  boundaries.
- Documented registry observations and the remaining package-publication gates.
- Added an explicit npm package allowlist that excludes internal settings, plans, tests, and
  repository tooling.

### Impact

Project identity and licensing are resolved without claiming affiliation or enabling premature
publication.

## [0.1.2] - 2026-07-29

### Improvement

- Pinned upstream Shepherd development and `v0.3.0` release revisions in a machine-readable lock.
- Added a documented compatibility evidence boundary and explicit upstream drift review policy.
- Clarified that complete implementation extends beyond gaps in the evolving upstream source to
  the defined shipped, substrate, paper-level, and operational capability levels.
- Made the JSDoc and documentation-maintenance requirements durable repository agent rules.

### Impact

Git-source compatibility research now starts from named revisions. Hosted documentation remains
dated, moving supporting evidence until a permitted snapshot or pinned source equivalent is added.

## [0.1.1] - 2026-07-29

### Defect Fixes

- Replaced JSON import attributes and `String.prototype.isWellFormed` with ES2022-compatible
  configuration loading and Unicode validation.
- Preserved valid surrogate pairs while continuing to reject lone Unicode surrogates.

### Improvement

- Added comprehensive JSDoc to the public canonical-record API.
- Added a documentation index and repository-structure guide with module and documentation
  ownership rules.

### Impact

The public API now type-checks in editors using an ES2022 library baseline without changing
canonical record output or identifiers.

## [0.1.0] - 2026-07-29

### New Feature

- Established the TypeScript project with Biome, strict TypeScript, Node's test runner, build
  output, version synchronization, and repository documentation.
- Added typed, path-contained, validate-before-write release version synchronization with tests.
- Added deterministic semantic-record canonicalization and configured SHA-256 record identifiers.
- Defined RFC 8785-compatible number, Unicode, object, and dense-array validation rules.
- Added public-seam unit tests with enforced 100% line, branch, and function coverage for runtime
  source.
- Added the implementation tracker and linked the existing research and architecture plan.

### Impact

The repository now has a tested foundation for implementing the versioned trace record envelope.
