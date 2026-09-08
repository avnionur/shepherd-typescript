# Documentation

This directory describes implemented behavior and the current repository structure. Future design
work and compatibility research live separately in [`.plan`](../.plan/README.md).

## Guides

- [Phase 5 exit audit](../.plan/phase-5-exit-audit.md) maps product-surface evidence and records
  the runtime-support blocker that keeps the phase open.

- [Python-to-TypeScript migration](./python-to-typescript.md) maps pinned release sources to all
  four executable examples, with verified code excerpts and explicit compatibility limits.

- [Contributing](../CONTRIBUTING.md) defines implementation, verification, documentation, and pull
  request requirements.
- [Security policy](../SECURITY.md) defines private reporting and the supported security boundary.
- [Project structure](./project-structure.md) explains module ownership, dependency direction, and
  where new files belong.
- [Protocol configuration](./protocol-configuration.md) defines validation, immutable snapshots,
  migration-bound constants, and safe SQLite settings.
- [Command-line interface](./cli.md) defines configured command topology, preserved human output,
  stable canonical JSON, generated reference/schema artifacts, executable packaging, exact
  mutation delegation, and unavailable-capability remedies.
- [Generated CLI reference](./generated/cli-reference.md) lists the configured executable,
  commands, options, and fenced/unavailable remedies.
- [Offline retained-output quickstart](./quickstart.md) runs the checked-in deterministic demo
  through a freshly installed package, retained inspection, exact selection, and CLI JSON.
- [Packaged TypeScript examples](./typescript-examples.md) demonstrates offline retained coding
  through typed domain facades with fresh-install typechecking, exact selection, reopen evidence,
  repeatable read-only output review, sibling-preserving multiple-binding settlement, and custom
  effect dispatch with exact outcome correlation.
- [Retained-output CLI views](./retained-output-cli-views.md) defines bounded output,
  authenticated changeset/content, and native vcs-core citation reads.
- [Naming and licensing](./naming-and-licensing.md) records package identity, attribution, and
  publication boundaries.
- [Package exports and module policy](./package-exports.md) defines supported ESM entries,
  including the Node-only effects, run execution/control, and workspace authority facades,
  TypeScript requirements, CommonJS refusal, deep-import boundaries, installed import loading,
  and tested Rollup Node bundle/asset behavior.
- [Web-safe trace read types](./web-safe-read-types.md) defines the type-only `/read` entry,
  no-Node installed compilation, readonly contracts, and validation/authority limits.
- [Generated API-reference policy](./api-reference.md) defines declaration-only generation,
  export completeness, type/runtime classification, authority notes, privacy checks, drift
  rejection, and fresh-package conformance.
- [Generated API reference](./generated/api-reference.md) indexes every supported entry and public
  symbol with signatures and JSDoc contracts.
- [Structured public errors](./public-errors.md) inventories exported error classes, stable
  machine codes, in-memory causes, intentionally unclassified failures, and CLI redaction.
- [Source maps, stacks, and causes](./source-maps-and-causes.md) defines portable installed map
  policy, in-memory propagation boundaries, and durable/CLI redaction.
- [Canonical record contract](./canonical-records.md) defines accepted values, deterministic
  encoding, identifiers, and error behavior.
- [Record body and envelope contract](./record-envelope.md) defines kernel ABI v0 semantic
  identity, causality, validation, and implementation-neutral fixtures.
- [Append planning contract](./append-planning.md) defines append drafts, causal-parent
  resolution, body snapshots, and owner-local ordinal allocation.
- [SQLite trace store](./sqlite-trace-store.md) defines migrations, atomic append transactions,
  idempotency, retained reads, and lifecycle behavior.
- [Content-addressed blob storage](./blob-storage.md) defines binary identity, crash-safe
  publication, durable receipts, verified reads, and integrity reports.
- [Blob orphan collection](./blob-orphan-collection.md) defines inspect-first, lock-protected
  cleanup of unregistered objects without deleting retained evidence.
- [Trace cuts and causal slices](./trace-queries.md) defines immutable owner-prefix addresses,
  lazy async cut-record iteration, causal closure, mode filtering, visibility, anchors, and
  witness support.
- [Execution-history projections](./execution-history-projections.md) defines lifecycle folds,
  parent relations, active children, parent-published data, and projection compatibility.
- [Store integrity and append recovery](./store-integrity-and-recovery.md) defines whole-store
  verification, classified defects, and read-only append recovery diagnosis.
- [Native trace interchange](./trace-interchange.md) defines deterministic full-store export,
  staged pristine-store import, version compatibility, and conformance fixtures.
- [Task descriptors](./task-descriptors.md) defines bodyless task contracts, inferred runtime
  schemas, supported JSON Schema adaptation, content identity, and exact artifact locks.
- [Task registry](./task-registry.md) defines durable exact version registration, idempotency,
  conflict detection, migration, and verified resolution.
- [Task and run ledger projections](./task-run-ledgers.md) define bounded immutable list/show
  views, exact/prefix/latest read selectors, composed retained evidence, and exact-ID authority
  separation.
- [Output citations, trace revisions, and recovery records](./output-trace-recovery-records.md)
  define cut-bounded read projections, canonical command effects, archive-stable claim evidence,
  the distinct trace-revision CLI command, and the no-repair authority boundary.
- [Orphaned operation diagnosis and repair](./orphan-operation-repair.md) defines externally proven
  session death, bounded read-only diagnosis, globally idempotent exact commands, atomic
  bookkeeping-only receipts, scope/provider refusal, and fail-soft pre-run reclaim.
- [Effect records](./effect-records.md) defines versioned intent/outcome records, reversibility
  tiers, immutable semantic values, and exact content-bound correlation.
- [Ordered effect handlers](./effect-handlers.md) defines immutable exact-kind stacks,
  last-matching precedence, typed schema-validated payload adapters, validation-before-invocation,
  and unhandled behavior.
- [Typed-effect reference validation and proof envelopes](./formal-assurance.md) defines the
  executable Core-A machine, pinned static-lowering/theorem evidence boundary, and fail-closed
  Core-0H sidecar gate.
- [Workspace initialization and adoption](./workspace-initialization.md) defines protected
  `.vcscore` metadata, configured baseline citations, Git-history preservation, and fail-closed
  reopen behavior.
- [Protected control paths](./protected-control-paths.md) defines workspace protocol v18's
  configured normalization, stable rejection evidence, and capture/selection/cleanup enforcement.
- [Workspace binding roots](./workspace-bindings.md) defines stable canonical binding identities,
  workspace-authority containment, symlink-aware alias handling, pairwise overlap rejection, and
  protocol-v20 repository-aware resource authorities for disjoint Git worktrees.
- [Repository grants and run authority ceilings](./repository-grants.md) defines workspace protocol
  v21 task-grant companion identity, exact repository admission, monotone whole-run attenuation,
  advisory capability enforcement, and exact recovery evidence.
- [Placement resolution and reporting](./placement-resolution.md) defines workspace protocol v22
  platform evidence, advisory/auto resolution, visible fallback, and placed recovery.
- [Native jail execution](./native-jail-execution.md) defines workspace protocol v23 authenticated
  Seatbelt/Landlock probes, exact grant lowering, structured process launch, durable receipts,
  platform support, threat limits, and no-retry uncertain recovery.
- [Retained-world application](./retained-world-application.md) defines portable path-conflict
  evidence, exact three-way plans, merged-revision custody, publication, and restart recovery.
- [Receipt-only retained-world release](./retained-world-release.md) defines current-basis
  witnesses, preserved retained custody, consume-once terminal evidence, and restart recovery.
- [Reference copy carrier](./reference-copy-carrier.md) defines immutable verified snapshots,
  isolated mutable custody, parent-linked custody capture, restart reopen, verification, and exact
  idempotent discard.
- [Workspace platform and fault conformance](./platform-fault-conformance.md) defines protocol
  v19 metadata refusal, portable name policy, Git platform cases, stable fault evidence, recovery,
  and the optimized-carrier parity gate.
- [Phase 3 L1-alpha status](./phase-3-l1-alpha.md) defines the completed P0 retained-world
  settlement scope, production-seam evidence boundary, and remaining Phase 4 compatibility work.
- [Retained-world runner](./retained-world-runner.md) defines the closed opaque runner registration
  handle and its honest advisory enforcement boundary.
- [Fenced task-world execution](./task-world-execution.md) defines authenticated runner
  consumption, isolated file authority, durable capture journaling, command-authorized recovery,
  cooperative partial-world cancellation, restart-safe inspection, and atomic terminal-cut
  attachment.
- [Git-aware baseline and retained output custody](./git-aware-custody.md) defines semantic Git
  bases, exact index/object receipts, linked-worktree identity, movement checks, and isolated
  retained output.
- [World changesets](./world-changesets.md) defines pure reconstructive comparison, canonical
  add/delete/modify/replace operations, content identity, immutability, and fail-closed limits.
- [Changeset inspection](./changeset-inspection.md) defines authenticated exact-path lookup,
  bounded pagination/content/previews, exact-content move projections, and Git-aware Gitlink and
  symlink-mode presentation outside canonical identity.
- [Retained-world settlement admission](./retained-world-settlement.md) defines workspace protocol
  v12 exact requests, workspace protocol v13 deterministic effect-journal codecs, workspace
  protocol v14 closed selection-publication plans/steps/receipts, protocol v15 dependency-ordered
  publication schedules, protocol v16 scheduled step/terminal-receipt evidence, protocol v17
  cut-bounded execution-trace settlement citations, authenticated immutable-head carrier staging,
  scheduled materialization and prefix recovery, public exact-ID
  selection and restart repair, authenticated retained-output preparation, trace-store v6
  consume-once compare-and-swap, schema-v7 journal storage,
  atomic deterministic transitions, restart-safe inspection, and terminal-before-cleanup public
  discard recovery with import-safe settlement projection.
- [Run outcomes](./run-outcomes.md) defines versioned finished, failed, exhausted, and cancelled
  terminal records with exact task-lock provenance.
- [Run artifacts and usage](./run-artifacts-and-usage.md) defines ordered inline-text and durable
  blob outputs plus aggregate token and cost records correlated by run identity.
- [Run budgets and cancellation](./run-control.md) defines configured resource limits, cumulative
  consumption, duration expiry, composed `AbortSignal` behavior, and terminal race semantics.
- [Run lifecycle protocol](./run-lifecycle-protocol.md) defines the configured normative transition
  matrix and versioned continuation, waiting, suspension, and resumed-running evidence schemas.
- [Provider contract and static provider](./static-provider.md) defines immutable provider
  descriptors, structured requests/responses, exact cassette replay, cancellation, and typed
  fail-closed errors.
- [Offline task execution](./task-execution.md) defines task-to-provider request mapping, schema
  validation, usage accounting, budgets, cancellation, and terminal-result normalization.
- [Durable task execution](./durable-task-execution.md) defines lifecycle, aggregate usage, exact
  ordered artifact and terminal outcome persistence, blob-receipt verification, deterministic
  append replay, recovery classification, exact reconstruction, command-authorized creation resume
  and terminal-cut repair, leased first-writer claims, stale-writer fencing, and fail-closed started
  handling.
- [Durable execution inspection](./durable-execution-inspection.md) defines immutable read-only
  lifecycle, artifact, usage, outcome, cut, and causal-edge views across every recovery state.
- [Durable execution control](./durable-execution-control.md) defines globally idempotent recovery,
  pause, resume, and cancel commands; exact lifecycle-head/fence checks; ordered checkpoint
  adapters; atomic waiting and suspension release; prerequisite-satisfaction-gated resumed-running
  fence acquisition; safe-boundary or inactive-head cancelled terminalization; lease takeover;
  and unsafe-state rejection.
- [Trace kernel vocabulary](../CONTEXT.md) defines the canonical domain terms used by code,
  schemas, tests, and documentation.
- [Upstream compatibility baseline](../.plan/upstream-baseline.md) records pinned Shepherd
  revisions and the evidence boundary for parity claims.

## Documentation rules

- Update the README and this index when adding a public module.
- Document exported TypeScript APIs with JSDoc at their declaration.
- Keep normative runtime behavior in `docs/`; keep unfinished proposals in `.plan/`.
- Link implementation documentation to its public entry point and tests.
- Update the changelog and tracker with every completed slice.
