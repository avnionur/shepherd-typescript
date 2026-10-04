# Documentation

This directory describes implemented behavior and the current repository structure. Future design
work and compatibility research live separately in [`.plan`](../.plan/README.md).

## Guides

- [Retained-world operation journal](./world-effect-journal.md) defines automatic capability
  intent/admission/outcome evidence, exact resource authority, redacted content, cancellation,
  interruption and read-only inspection through `inspectTaskWorldEffects`.

- [Replay request identity](./replay-request-identity.md) defines normalized branch commands,
  reservation before physical work, read-only inspection, concurrent conflicts and legacy refusal.

- [Capability evidence inventory](./generated/capability-inventory.md) separates upstream release
  vocabulary, paper targets, imported formal evidence and native extensions, with seven evidence
  dimensions, checked public exports, content-pinned citations and open follow-up issues.
  [Maintenance](./capability-inventory.md) defines the drift gate and its limits.

- [Durable scope registration and fenced local emission](./scope-registration.md) defines the
  trace-only Phase 6 slice: content-addressed root/child scopes, exact origin cuts, attenuated
  authority, single-writer fencing, idempotent emission, inspection, and import limits.
- [Reference-copy scope fork](./scope-fork.md) defines single-resource isolated fork custody,
  verified fixed origins, the prepared/completed fork journal, honest checkpoint descriptors,
  receipt-based restart recovery, and atomic multi-scope writer claims.
- [Consume-once scope merge and discard](./scope-merge-discard.md) defines three-way merge plans,
  single-winner reservations, verified parent-managed publication, selected-history
  contributions, subtree discard with retained-identity cleanup, and terminal recovery.
- [Scope scheduling and recovery classification](./scope-scheduling.md) defines bounded parallel
  and nested scope trees with deterministic settlement, restart convergence, and record-derived
  recovery ownership.
- [Scope algebra laws](./scope-laws.md) defines the seeded reference-model law suite that checks
  fork, emit, world writes, merge, and discard across carriers.
- [Scope vocabulary mapping](./scope-vocabulary.md) maps spawn, adopt, abandon, and publish onto
  exact scope evidence without aliasing version-1 projections.
- [Scope ownership/authority proposal](../.plan/scope-ownership-contract.md) defines the reviewed
  Phase 6 contract behind the implemented scope slices.

- [Durable cursor trace subscriptions](./trace-subscriptions.md) defines the observer role:
  canonical owner-ordinal cursors, pull-driven backpressure and overflow policy, monotonic
  acknowledgement outside the record graph, reconnect semantics, and passive-observation evidence.
- [Supervised effect interception](./supervised-effects.md) defines ordered allow/deny/replace/pause
  decisions, timeout policy, the irreversible approval frontier, admission before materialization,
  fenced decision leases, and restart classification.
- [Approval gates, cited context, and worker control](./supervision-control.md) defines approval
  verdicts, cited context channels, supervisor access to durable-run control, and supervisor
  failure bounds.
- [Live supervision contract](../.plan/live-supervision-contract.md) defines the Phase 7 roles,
  record sequence, failure table, and non-claims behind the supervision APIs.

- [Replay sessions](./replay-sessions.md) defines deterministic session programs, provider and
  effect steps, prompt, prefix, and context prefix identities, cache-hit evidence, fenced session
  leases, record-derived recovery classification, and inspection.
- [Coupled checkpoints](./coupled-checkpoints.md) defines coordinated multi-resource world images,
  provider-session and process adapter evidence, the irreversible-effect frontier, atomic,
  reconstructive, and unavailable classification, the cooperative and transparent process
  backends, configured automatic checkpoint policies (per provider step, per effect, every N
  steps), and the measured storage growth per checkpoint.
- [Rewind and replay](./rewind-and-replay.md) defines verification before writing, byte-equivalent
  restoration, recorded-prefix reconstruction, suffix replay with changed task, provider, or
  handlers, irreversible-effect approval, the branch source disposition (`compensate` or
  `retain`), imported archives, divergence and dependency analysis, N-way diff against the common
  lineage ancestor, and first-regression search.
- [Coupled replay contract](../.plan/coupled-replay-contract.md) defines the Phase 8 design
  constraints, failure table, and non-claims behind the replay APIs.
- [Phase 8 exit audit](../.plan/phase-8-exit-audit.md) maps coupled checkpoint, rewind, and replay
  evidence to every roadmap work item and exit criterion.

- [Task values and child run handles](./task-values.md) defines canonical task values,
  `schema.task()`, command-derived handle identities, opened and completion records, provider- and
  program-serviced children, derived status, inspection, and reserved handle owners.
- [Delegated authority](./delegated-authority.md) defines resource attenuation through the scope
  rule, budget attenuation, root declarations, bounded parent-handle chains with origin cuts, and
  record-proven inspection that refuses amplification.
- [Supervisor operations](./supervisor-operations.md) defines observation over handle and child
  run owners, ordered context injection with the composed-request rule, fenced supervisor handoff,
  terminal accept and discard decisions, and retry successors citing their causal replay point.
- [Task revision and synthesis](./task-revision.md) defines declared, revised, and synthesized
  provenance, approval gating for model-generated task values, revision retries, and the execution
  boundary that keeps task values free of code.
- [Result threading and nested meta-agents](./result-threading.md) defines typed result
  projection of accepted outputs with caller-schema proof, bounded delegation trees under a handle
  or supervisor root, and the isolation rules that keep grandchild records, authority, and values
  out of the root's projection.
- [Task-as-value contract](../.plan/task-as-value-contract.md) defines the Phase 9 design
  constraints, supervisor operations, failure table, and non-claims behind the delegation APIs.
- [Phase 9 exit audit](../.plan/phase-9-exit-audit.md) maps task-as-value, delegation, supervisor
  operation, revision, and result threading evidence to every roadmap work item and exit criterion.
- [Application manifests and protocol identity](./application-manifests.md) defines application
  protocol definitions and their content-addressed identity, command-derived reserved application
  owner paths, digest-bearing manifests citing surfaces and artifacts by digest, measured costs,
  terminal-cut retention, and inspection across reopened, read-only, and imported stores.
- [Two-worker coding supervisor](./coding-supervisor.md) defines the round-based supervisor over
  child run handles: world adapters and the scope world adapter, path-overlap conflict
  classification, inject, handoff, discard-and-restart from a clean fork, terminal accept and merge,
  retained supervision records, crash recovery, and inspection.
- [Concurrent runtime supervisor](./runtime-supervisor.md) defines the §5.1 and Appendix E live
  supervisor: concurrent tool-loop workers in forked custody, worker streams under a live trace
  subscription, the configured tick cadence and per-agent snapshot, batched `none`/`inject`/
  `handoff`/`discard` decisions with admission and refusal, cross-agent handoff by forking the
  leader's custody, the provider-backed JSON-mode policy, settlement, and crash recovery.
- [Counterfactual workflow optimization](./counterfactual-optimization.md) defines Appendix F.1
  Algorithm 1 over replay sessions: per-example train and dev baselines, caller-supplied and
  tool-loop proposers, reflection-contract admission, declared `request` and `downstream` edit
  scopes and the replay target rule, the divergence proof, the fractional fix/guard gate, epsilon
  dev promotion into a graduate-only pool, selection, per-session computation reuse, the measured
  `full_replay` comparison, budgets, crash recovery, and inspection.
- [Trajectory compression](./trajectory-compression.md) defines Appendix D compression over replay
  sessions: the fork-point and hint grammar, restoration by rewind and suffix replay under the hint,
  `no_prune` and unavailable-restore refusal, the verifier gate between `pruned` and `restored`, the
  bounded best-of-N control, measured step-count ratios, budgets, crash recovery, and inspection.
- [Tree-RL adapter](./tree-rl-rollouts.md) defines the §5.3 adapter over replay sessions as paper
  Algorithm 2: G graded roots per prompt over a batch, the fork-selection interface with the
  meta-agent and dependency selectors, K seeded branches per root with the proposed tool call
  seeding one, concurrent rollouts, inter-root and intra-tree advantages with per-group
  standardization, the per-action `jsonl_v2` training batch and its digest, the `flat_grpo`
  baseline, the trainer-export adapter seam, budgets, crash recovery, and inspection.
- [Application evaluation](./application-evaluation.md) defines the offline evaluation runner: the
  caller's evaluation definition and bindings, the `no_supervision`, `full_replay`,
  `no_compression`, and `flat_grpo` baselines, measured-only metrics and comparisons, the
  digest-bearing `application-evaluation-v1` report and its determinism rule, the repository
  artifacts and their drift check, and the published limitations. The generated
  [evaluation report](./generated/application-evaluation.md) is its repository output.
- [Research applications contract](../.plan/research-applications-contract.md) defines the Phase 10
  design constraints, failure table, and non-claims behind the application APIs.
- [Phase 10 exit audit](../.plan/phase-10-exit-audit.md) maps application manifest, supervisor,
  optimizer, compression, Tree-RL, and evaluation evidence and the conformance scenario to every
  roadmap work item and exit criterion.
- [Phase 7 exit audit](../.plan/phase-7-exit-audit.md) maps live observation and interception
  evidence to every roadmap work item and exit criterion.
- [Phase 6 exit audit](../.plan/phase-6-exit-audit.md) maps scope-algebra evidence and records L2
  substrate parity for the recorded hosts.
- [Phase 5 exit audit](../.plan/phase-5-exit-audit.md) maps product-surface evidence and records
  runtime-support remediation and phase-exit verification.
- [Node runtime support](./runtime-support.md) defines the approved version range (Node 24 from
  24.12.0 and Node 26 from 2.36.0, with the Node 26 lane evidence), pre-write refusal, SQLite
  behavioral checks, and installed boundary verification.

- [Python-to-TypeScript migration](./python-to-typescript.md) maps pinned release sources to all
  four executable examples, with verified code excerpts and explicit compatibility limits.

- [Contributing](../CONTRIBUTING.md) defines implementation, verification, documentation, and pull
  request requirements.
- [Security policy](../SECURITY.md) defines private reporting (email while the repository is
  private, the advisory form once it is public) and the supported security boundary, including
  the status of the hosted workflows.
- [Project structure](./project-structure.md) explains module ownership, dependency direction, and
  where new files belong.
- [Protocol configuration](./protocol-configuration.md) defines validation, immutable snapshots,
  migration-bound constants, and safe SQLite settings.
- [Threat model](./threat-model.md) defines assets, trust boundaries, STRIDE threats mapped to
  mitigation code and tests, and residual risks linked to the
  [internal security review](../.plan/security-review.md) findings register.
- [Support policy](./support-policy.md) defines supported versions, runtimes, platforms, surfaces,
  store compatibility, and what "1.0" means.
- [Incident response](./incident-response.md) defines severity levels, triage, private reports and advisories,
  fix and release, deprecation and rollback, and store-corruption and lost-backup runbooks.
- [Production hardening contract](../.plan/production-hardening-contract.md) maps the Phase 11
  work items and exit criteria to slices and owner-owed rows, with per-slice non-claims.
- [1.0 release notes](./release-notes-1.0.md) state what the L4 "1.0" milestone means (a private,
  unpublished source release recorded in 2.34.0), what is delivered, the known limits, the owner
  waivers of 2026-09-23 (#199), and upgrade and migration pointers.
- [Phase 11 exit audit](../.plan/phase-11-exit-audit.md) records the 1.0 readiness verdict (release
  candidate for the in-repo scope; owner-owed items tracked in #191 and then #199; the 2.33.1
  addendum records the local Docker Linux lane and closes the in-repo scope, the 2.33.3 addendum
  records the owner decisions of #191, and the 2.34.0 addendum records the owner decisions of
  2026-09-23 closing #199, the Linux volume fault suite and Linux container SLO host class, and the
  verdict: 1.0 as a private, unpublished source release with listed waivers) with
  the evidence map, recovery classification, independent review, verification, and limits; the
  [release-readiness dashboard](../.plan/release-readiness-dashboard.md) classifies every phase
  epic, parity row, and paper-coverage row, and the
  [release-candidate manifest](../.plan/release-candidate-manifest.md) records the candidate's
  digests and fresh verification.
- [Compatibility policy](./compatibility-policy.md) defines the semantic-versioning mapping,
  stability tiers, the configured deprecation window, protocol evolution and N-1 read
  compatibility, the classified change log, and how `pnpm check:compatibility` baselines are
  updated.
- [Release integrity](./release-integrity.md) defines the lockfile SBOM, the unsigned in-toto/SLSA
  provenance statement, the reproducible-build check, the npm-version-independent packed file set
  and its check, the packed README link check, `pnpm verify:release`, the unrun release workflow, and the owner release runbook
  (credentials, signing identity, dropping `"private"`, running `release.yml`, and verifying the
  attestation against the tarball digest).
- [Generated SBOM](./generated/sbom.cdx.json) is the checked-in CycloneDX-shaped bill of materials
  derived from `pnpm-lock.yaml`.
- [Secrets and retention](./secrets-and-retention.md) defines configured secret detectors, the
  opt-in `secretScanning: "refuse"` store mode and `TRACE_SECRET_DETECTED`, retention data classes
  and export dispositions, one-way redacted archives and their verifier, retention inspection, store
  rotation (records are immutable; no in-place deletion), and owner-only SQLite file modes, all
  through the `./operations` entry.
- [Storage interfaces](./storage-interfaces.md) defines the `BlobStoreBackend` and
  `StorageCoordinator` contracts and laws (no-replace content-addressed writes, compare-and-swap
  generations, leases with fencing tokens), the memory, filesystem, and SQLite reference adapters,
  the conformance kits, and the multi-process race evidence; `SQLiteTraceStore` remains the only
  canonical append store and no cloud adapter ships.
- [Backup, restore, and migration](./backup-restore-and-migration.md) defines the verified online
  backup and its `shepherd.store.backup` v1 manifest, classified verification, non-destructive
  exact-manifest restore, replication by compare-and-swap, the forward-only schema and downgrade
  policy, migration drills for every historical store schema, the `store` CLI group, and upgrade,
  rollback, and interruption runbooks, through the `./operations` entry.
- [Observability](./observability.md) defines the non-canonical OpenTelemetry-compatible telemetry
  exporter (deterministic trace and span identifiers, run spans, one log record per record
  occurrence, retention-governed bodies withheld by default, at-least-once delivery from an
  acknowledged subscription cursor), the `shepherd.telemetry.batch` v1 schema, the OTLP/JSON
  encoding rules it relies on, and the owner-only JSON-lines sink, through the `./operations` entry.
- [Coverage gate](./coverage-gate.md) defines how `pnpm test` merges raw V8 coverage from every
  test process by summing per-process innermost-range counts, so zero-count ranges cannot be hidden
  and parallel and serial runs agree, and how the configured thresholds are enforced.
- [Fault and fuzz conformance](./fault-and-fuzz-conformance.md) defines the seeded dependency-free
  fuzz suite (mutators, the shared oracle, every target and its allowed errors, the `verify` and
  `extended` tiers, `pnpm fuzz`), the replayed regression corpus, the recorded extended run, and the
  findings it produced, and the fault and soak suites: seeded `SIGKILL` of writers with every
  started operation classified complete, retryable, or refused, disk full (`max_page_count`,
  `ulimit -f`, and the opt-in `pnpm test:faults:volume` on a macOS HFS+ image or, from 2.34.0, a
  Linux ext4 loop image), classified page, WAL/SHM, blob, and
  backup corruption, and the mixed soak (`pnpm test:soak`) with its recorded run.
- [Performance report](./performance-report.md) publishes the reference-host (macOS arm64 APFS)
  kernel benchmark with raw samples, the `linux-arm64-overlayfs-container` host class (2.34.0, a
  container-in-VM measurement), the SLO budgets checked by `pnpm check:slo` in
  `verify:release`, the bounded scale tier, query-plan evidence, and own carrier storage
  measurements, and, from 11.2.0 (#214), the scope fork/revert, K-branch storage, mutation-size
  sweep, and effect-stream record/observe benchmark (`pnpm bench:scopes`, `pnpm check:scopes`)
  with its macOS and Linux container host classes; [SQLite trace store maintenance](./sqlite-trace-store.md#maintenance) documents
  `SQLiteTraceStore.maintain` and `shepherd-ts store maintain`.
- [Command-line interface](./cli.md) defines configured command topology, preserved human output,
  stable canonical JSON, generated reference/schema artifacts, executable packaging, exact
  mutation delegation, unavailable-capability remedies, and the read-only git-like `replay` and
  `scope` views.
- [Generated CLI reference](./generated/cli-reference.md) lists the configured executable,
  commands, options, and fenced/unavailable remedies.
- [Offline retained-output quickstart](./quickstart.md) runs the checked-in deterministic demo
  through a freshly installed package, retained inspection, exact selection, and CLI JSON, binding
  a dedicated subdirectory within configured time and retained-state budgets.
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
  the minimum TypeScript version, CommonJS `require()` support, `sideEffects`, deep-import boundaries, installed import loading,
  tested Rollup ESM/CommonJS Node bundle/asset behavior, the `ConfigurationAssetError` raised for
  a missing configuration asset, an esbuild recipe, and the recorded `@arethetypeswrong/cli` result.
- [Web-safe trace read types](./web-safe-read-types.md) defines the type-only `/read` entry,
  no-Node installed compilation, readonly contracts, and validation/authority limits.
- [Generated API-reference policy](./api-reference.md) defines declaration-only generation,
  export completeness, type/runtime classification, authority notes, privacy checks, drift
  rejection, and fresh-package conformance.
- [Generated API reference](./generated/api-reference.md) indexes every supported entry and public
  symbol with signatures and JSDoc contracts.
- [Structured public errors](./public-errors.md) inventories exported error classes, stable
  machine codes, in-memory causes, intentionally unclassified failures, and CLI redaction.
- [Source maps, stacks, and causes](./source-maps-and-causes.md) records that source maps are not
  shipped, in-memory propagation boundaries, and durable/CLI redaction.
- [Canonical record contract](./canonical-records.md) defines accepted values, the configured
  nesting bound, deterministic encoding, identifiers, and error behavior.
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
  schemas (strings, numbers, integers, booleans, null, arrays, enums, literals, unions, strict
  objects with optional fields, and task values), supported JSON Schema adaptation, content
  identity, and exact artifact locks.
- [JSON Schema validation](./json-schema-validation.md) defines the reusable `compileJSONSchema`
  validator, its closed 2020-12 keyword subset, path-level issues, `JSONSchemaValidationError`, and
  the runtime evaluation of pinned application protocol schemas.
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
- [Effect compensation](./compensation.md) defines per-kind compensation handlers, materialization
  evidence and identity, retained intent/attempt/outcome records, reverse-order materialization-keyed
  compensation on scope discard and replay branches that abandon their source (`compensate`
  disposition; `retain` branches compensate nothing), and crash recovery.
- [Typed-effect reference validation and proof envelopes](./formal-assurance.md) defines the
  executable Core-A machine, pinned static-lowering/theorem evidence boundary, fail-closed
  Core-0H sidecar gate, and the proof envelopes attached to run, replay, and child-run
  inspections (imported claims, `extension` publication controls, optional replay lowering).
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
- [Optimized scope-world carriers](./optimized-carriers.md) defines workspace protocol v26 clone
  and Linux overlay backends, identity equality with copy, restart remount, fail-closed
  unavailability, opt-in recorded fallback selection (v27), the shared conformance matrix, and
  measured storage scaling.
- [Layered device-layer checkpoints](./device-layers.md) defines workspace protocol v27 device
  layers: named frozen-layer checkpoints and restore, the configured depth bound with compaction and
  retirement, the pluggable adapter contract and conformance kit, the copy, clone, stacked-overlay,
  and reference Docker container adapters, recorded fallback selection, and measured capture cost
  against world size.
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
- [Live providers and prompt-cache prefix reuse](./live-providers.md) defines configured live
  provider kinds, the Anthropic Messages and OpenAI-compatible adapters, the multi-turn message
  model, cache-control placement and cache-token usage, cancellation, credential handling and
  redaction, provider conversations that restore a byte-identical prefix after rewind, and the
  tool definition, `tool_use`, and `tool_result` wire mapping of both dialects.
- [Tool-use loop and meta-agent tools](./tool-use-loop.md) defines the bounded multi-turn loop that
  turns every model tool call into a typed effect intent through a handler stack, supervised
  dispatch, or replay session; deny-before-outcome; byte-identical replay of a recorded loop; and
  the configured observe, fork, discard, rewind, replay, read-trace, and diff meta-agent tools.
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
- The root README ships in the package: link files that are not packed with absolute
  `https://github.com/avnionur/shepherd-typescript/blob/main/...` URLs (see
  [packed README links](./release-integrity.md#packed-readme-links)).
- Document exported TypeScript APIs with JSDoc at their declaration.
- Keep normative runtime behavior in `docs/`; keep unfinished proposals in `.plan/`.
- Link implementation documentation to its public entry point and tests.
- Update the changelog and tracker with every completed slice.

- [Registered repository declarations](./task-registry.md#repository-declaration-companions-1320) documents exact-version persistence and CLI inspection.
