# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.17.0] - 2026-08-09

### New Feature

- Added `createRunArtifact` for immutable explicitly ordered inline-text and durable blob-reference
  side-channel outputs.
- Added `createRunUsage` for immutable aggregate token and optional cost totals across an entire
  run.
- Added generated language-neutral run-artifact and run-usage v1 JSON Schemas with configured and
  compatibility-locked versions, discriminants, ordinal bounds, identities, and destinations.

### Improvement

- Added strict closed-data validation, canonical metadata snapshots, durable blob-receipt
  validation, unavailable-cost normalization, and complete public-seam coverage.
- Added independent conformance fixtures and structural documentation that distinguish record
  construction from later run-ledger persistence and automatic execution-time collection.

### Impact

TypeScript applications can represent ordered side-channel outputs and whole-run resource totals
as stable data correlated with any terminal run ending, without embedding binary bytes or
conflating aggregate usage with individual provider calls.

## [0.16.0] - 2026-08-05

### New Feature

- Added `createRunOutcome` for immutable versioned finished, failed, exhausted, and cancelled
  terminal records.
- Added exact task artifact-lock provenance and a generated language-neutral run-outcome v1 JSON
  Schema.
- Added configured and compatibility-locked run versions, status vocabulary, schema identity, and
  artifact destination.

### Improvement

- Added strict closed-object validation, canonical successful values, normalized unknown
  retryability, and stronger task-lock digest and identity validation.
- Added independent exhaustive fixtures and public-seam tests for every terminal variant,
  immutability, malformed records, schema closure, and protocol drift.

### Impact

TypeScript applications can represent every terminal run ending as inspectable canonical data
bound to the exact task revision, without scraping exceptions or fabricating execution, artifact,
or usage evidence.

## [0.15.0] - 2026-08-04

### New Feature

- Added immutable ordered effect handler stacks with configured last-matching precedence.
- Added synchronous and asynchronous exact-kind handler dispatch that returns exactly correlated
  effect outcomes and selected-handler identity.
- Added `EffectHandlerNotFoundError` for fail-closed unhandled effects.

### Improvement

- Validated and snapshotted intents before invoking handler code and preserved handler failures
  without fabricating semantic outcomes.
- Added public-seam tests for ordering, definition snapshots, failure results, malformed inputs,
  missing handlers, and exception propagation.

### Impact

TypeScript applications can now interpret typed effect intents deterministically in-process while
keeping handler dispatch separate from interception, observation, persistence, and world
materialization.

## [0.14.0] - 2026-08-03

### New Feature

- Added immutable, versioned typed effect intent and outcome records.
- Added exact outcome correlation through a digest of the complete canonical intent.
- Added configured reversibility tiers and generated effect intent/outcome JSON Schemas.

### Improvement

- Added fail-closed effect definition, semantic value, wire record, result, and protocol
  validation.
- Added independent conformance fixtures and public-seam tests for identity drift, success/failure
  typing, immutability, schema closure, and correlation rejection.

### Impact

TypeScript applications can now represent attempted world actions and their responses as stable,
typed protocol records without allowing an outcome to be rebound to an altered intent.

## [0.13.0] - 2026-08-02

### New Feature

- Added `SQLiteTaskRegistry` for durable, exact task artifact registration and resolution.
- Added idempotent equal registration and typed conflict rejection when one task ID/version names
  different content.
- Added verified artifact-lock, schema-language, and registry-key decoding across restart
  boundaries.

### Improvement

- Added compatibility-locked task-registry migrations and configurable durable SQLite settings.
- Added public-seam persistence, conflict, corruption, lifecycle, migration, and configuration
  tests with complete task-module coverage.

### Impact

TypeScript applications can now durably register immutable task versions, reopen their registry,
and resolve only exact verified artifacts without mutable aliases or fallback version selection.

## [0.12.0] - 2026-08-02

### New Feature

- Added immutable, versioned bodyless task descriptors with inferred runtime input/output schemas.
- Added configured task, artifact, and schema identities with frozen exact artifact locks.
- Added generated task descriptor and artifact-lock JSON Schemas plus an independent conformance
  fixture.

### Improvement

- Extended fail-closed protocol configuration and generated-artifact validation to the task
  protocol.
- Added public-seam validation, identity-drift, schema-conformance, configuration, and packaging
  coverage with complete runtime source coverage.

### Impact

TypeScript applications can define and validate stable task contracts and persist exact task
artifact citations before task registration, effects, providers, or execution are introduced.

## [0.11.0] - 2026-08-02

### New Feature

- Added inspect-first `collectBlobOrphans()` with explicit deletion mode and frozen candidate and
  deletion reports.
- Added configured collection modes, non-destructive default, and temporary-file naming contract.

### Improvement

- Serialized blob publication and orphan collection through the same immediate SQLite write lock.
- Verified every registered blob before collection and rejected unsafe or unexpected store-layout
  objects without deleting database evidence.
- Added public-seam, child-process, concurrency, corruption, symlink, lifecycle, and configuration
  tests with complete coverage.

### Impact

TypeScript applications can inspect and remove crash-abandoned blob objects without racing active
writers or deleting registered content, semantic records, append evidence, or cuts.

## [0.10.1] - 2026-08-02

### Improvement

- Reworked the main README around the complete TypeScript paper-coverage target, the four runtime
  primitives, explicit L0–L4 status, current-versus-planned behavior, and attributed links to the
  upstream teaser image and video.
- Added a section-by-section paper-v3 coverage map with implementation ownership and acceptance
  evidence for every main section and appendix.
- Closed planning gaps for proof-envelope claim handling, trajectory compression, experimental
  protocol fidelity, paper limitations, and future-work classification.

### Impact

Readers can distinguish the current trace-kernel release from the full paper target and audit every
coverage claim against a named TypeScript phase and verification seam.

## [0.10.0] - 2026-08-02

### New Feature

- Added deterministic `exportTrace()` archives containing canonical records, owner views, append
  intents, published cuts, and content-addressed blobs.
- Added staged `importTrace()` for identity-preserving transfer into pristine stores.
- Added a generated native trace archive v1 JSON Schema and implementation-neutral conformance
  fixture.

### Improvement

- Configured and compatibility-locked archive format, version, and blob encoding constants.
- Preserved idempotent append replay and owner-ordinal continuation across process restart and
  archive transfer.
- Made target integrity and pristine-state validation concurrency-safe and archive view ordering
  independent.
- Added fail-closed tests for incompatible versions, malformed bodies, dangling references,
  corrupt receipts, invalid blobs, non-pristine targets, and target transaction rollback.
- Added child-process transfer/reopen coverage and a cut-bearing conformance fixture covering all
  retained archive areas.

### Impact

TypeScript applications can move a complete verified trace store between processes without
changing semantic identities, owner addresses, append replay behavior, cuts, or blob content.

## [0.9.0] - 2026-08-02

### New Feature

- Added `verifyIntegrity()` for read-only, snapshot-consistent whole-store verification across
  SQLite and foreign-key integrity, canonical records, causal-parent indexes, witnesses, owner
  paths, append receipts, cuts, and blobs.
- Added `diagnoseAppend()` with stable `retry_safe`, `committed`, and
  `manual_recovery_required` classifications.
- Added frozen public integrity-report, issue, and append-recovery diagnostic types.

### Improvement

- Classified record, parent-index, witness, orphan-record, owner-ordinal, append-receipt,
  orphaned-row, cut, SQLite, and blob integrity failures without rewriting retained evidence.
- Added public-seam restart and intentional-corruption tests with complete line, branch, and
  function coverage.
- Documented the read-only diagnostic boundary, recovery meanings, module ownership, and
  trace-kernel vocabulary.

### Impact

TypeScript applications can verify a complete retained trace store and decide whether an append
is safe to retry, already committed, or requires manual intervention without guessing or mutating
evidence.

## [0.8.0] - 2026-07-29

### New Feature

- Added configured, immutable execution lifecycle projections over published trace cuts.
- Added parent-owned relation folds with latest-transition child selection and strict child-cut
  resolution for effective history.
- Added parent-published semantic data to disposable effective-history projections.

### Improvement

- Added fail-closed projection compatibility checks for query modes, payload visibility, malformed
  lifecycle evidence, relation transitions, publications, missing child cuts, duplicate slices,
  and child-cut target mismatches.
- Added immutable projection protocol configuration and compatibility constants for lifecycle
  schemas, relation kinds, publication schemas, and slice requirements.
- Added public-seam unit tests for lifecycle states, relation transitions, cut isolation, reopen,
  child resolution and target validation, malformed evidence, configuration drift, and
  closed-store behavior.
- Documented the projection boundary, upstream frontier-to-cut normalization, public APIs, module
  ownership, and trace-kernel vocabulary.

### Impact

TypeScript applications can reconstruct reproducible root and child execution history from
retained Shepherd records without persisting mutable derived state.

## [0.7.0] - 2026-07-29

### New Feature

- Added atomic publication, verified reads, and immutable resolution for owner-prefix trace cuts.
- Added owner-prefix and transitive causal-closure slices with configured mode filters, visibility
  profiles, closure policies, direct edges, external anchors, and root-closed witness support.
- Added store schema v3 with automatic migration for the verified cut resolver index.

### Improvement

- Added fail-closed, descriptor-safe validation for cut specifications, query options, and causal
  root arrays.
- Added exact cut-publication verification across the direct cause, publisher occurrence, append
  intent, and addressed owner ordinal, with mutation-free conflict handling.
- Preserved every owner occurrence of shared semantic records in causal slices and rejected
  orphaned owner views instead of returning truncated results.
- Added immutable ABI configuration for cut publication, witness schemas, query modes, visibility,
  and closure policies.
- Added public-seam tests for reopen, later-append isolation, idempotent and conflicting cut
  publication, filtered graphs, hidden payloads, witness evidence, corruption, and malformed input.

### Impact

TypeScript applications can retain stable execution checkpoints and inspect deterministic causal
subgraphs without exposing filtered payloads or mutating trace history.

## [0.6.0] - 2026-07-29

### New Feature

- Added configured content-addressed binary storage with durable blob receipts.
- Added `putBlob`, `readBlob`, and `verifyBlobs` to the SQLite trace store.
- Added integrity classification for missing, malformed, size-mismatched, digest-mismatched, and
  receipt-mismatched blob content.
- Added store schema v2 with automatic migration from schema v1.

### Improvement

- Added exclusive temporary-file publication, file flushing, hard-link deduplication, and
  recursive supported-platform directory flushing.
- Added internal byte snapshots, final-object verification, and fail-closed rejection of symlinked
  or non-directory blob paths.
- Added fail-closed blob identity, fanout, directory, flush, receipt-version, and migration
  configuration.
- Added public-seam tests for reopen, retry after receipt failure, corruption, symlink containment,
  migration, lifecycle, malformed inputs, and child-process crash recovery.

### Impact

TypeScript applications can durably retain and verify binary artifacts without placing their bytes
inside semantic trace rows. Existing schema-v1 stores migrate automatically.

## [0.5.2] - 2026-07-29

### Defect Fixes

- Corrected the implementation plan, roadmap, architecture, parity matrix, testing strategy, and
  tracker so TypeScript is the sole product implementation target.
- Removed native Python implementation and parity work from planned deliverables.
- Removed unused Python distribution and import-name metadata from project configuration.
- Replaced the stale Python next step with TypeScript content-addressed blob storage, integrity
  verification, and storage receipts.

### Impact

Project scope now consistently reflects the goal of fully implementing Shepherd in TypeScript.
Upstream Python remains an optional compatibility oracle rather than a package produced here.

## [0.5.1] - 2026-07-29

### Defect Fixes

- Added fail-closed validation for record hashes, owner ordinals, migration history,
  root-witness data, schema identifiers, and SQLite durability settings.
- Prevented unchecked protocol configuration values from reaching cryptographic and SQL
  operations.
- Required defensive SQLite mode, foreign keys, WAL journaling, FULL synchronization, and
  IMMEDIATE append transactions.
- Prevented kernel ABI v0, store schema v1, schema dialect, root witness, and durable hash
  contracts from being redefined in place.
- Prevented protocol artifact paths from colliding with protected repository files or each other.

### Improvement

- Shared one typed configuration parser between runtime loading and protocol artifact generation.
- Defensively copied and deeply froze the active protocol configuration.
- Centralized trace-store table, index, transaction, and PRAGMA constants.
- Added immutable ABI and migration compatibility constants checked against the language-neutral
  configuration before runtime or generator writes.
- Split configuration models, section validation, and value readers into small documented
  modules.

### Impact

Valid configurations retain the same record and storage behavior. Invalid, drifted, or weakened
critical settings now fail before protocol generation, hashing, or SQLite side effects.

## [0.5.0] - 2026-07-29

### New Feature

- Added a synchronous SQLite trace store with numbered migrations, configured WAL durability,
  foreign-key enforcement, and explicit lifecycle management.
- Added atomic batch persistence for semantic records, ordered causal edges, owner-local views,
  and serialized owner ordinals.
- Added append-intent idempotency with durable receipts, equal replay, conflicting retry
  detection, persisted-receipt validation, and rollback-safe reuse after failed transactions.
- Added exact-record and ordered owner-path reads plus the configured `ROOT_WITNESS_ID` bootstrap
  export.

### Improvement

- Organized persistence code under `src/store/` and its public-seam tests under `test/store/`.
- Enforced configured owner-ordinal bounds at both the SQLite schema and record-view decoder.
- Added fail-closed migration registry, versioned schema bounds, and configured schema-version
  parity checks.
- Reconciled replay receipts against durable append positions, record views, and causal data.
- Documented the storage contract, schema lifecycle, identity boundary, and remaining kernel work.

### Impact

TypeScript applications can now durably retain and reopen atomic execution-trace batches without
coupling semantic record identity to owner-local placement.

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
