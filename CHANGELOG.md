# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
