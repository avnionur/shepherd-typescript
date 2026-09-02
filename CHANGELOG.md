# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.60.1] - 2026-09-01

### Improvement

- Separated thin package-script command adapters from cohesive build, protocol-generation,
  API-reference, release, and installed-package testing modules under `tooling/`.
- Grouped protocol schema renderers under their owning generator and retained their existing
  deterministic, fail-closed artifact interface and focused test seams.
- Restricted production compilation to runtime source, eliminating accidental `dist/scripts/`
  and `dist/tooling/` output while preserving all package targets and runtime configuration files.
- Aligned the pnpm workspace declaration and project-structure documentation with the actual
  single-package repository, public facade entries, and tooling dependency direction.

### Impact

Contributors get explicit ownership and placement rules for repository tooling, while consumers
receive the same runtime exports, protocol artifacts, CLI behavior, installed-package conformance,
and generated reference as before.

## [1.60.0] - 2026-08-31

### New Feature

- Added a deterministic checked-in and packaged API reference for the root, canonical, CLI,
  effects, providers, runs, tasks, trace, and workspace entries, generated strictly from emitted
  public declarations.
- Added explicit type-only/runtime classification, signatures and generics, public JSDoc and
  thrown-error contracts, Node requirements, and configuration-owned authority/mutation notes.
- Added fail-closed export/config agreement, private/internal and local-path leakage checks, stale
  artifact rejection in ordinary verification, and fresh-package artifact/import conformance.

### Impact

TypeScript consumers can discover and verify the complete supported API without relying on private
deep modules or stale hand-maintained documentation. Runtime behavior, authority boundaries,
ESM/deep-import policy, recovery, settlement, source maps, and redaction remain unchanged.

## [1.59.1] - 2026-08-30

### Improvement

- Added repository-built and freshly installed conformance for every supported runtime and
  declaration map, including portable relative sources, no embedded source content, and no host or
  temporary absolute paths.
- Added installed Node source-map evidence that public failure stacks resolve to TypeScript source
  frames, plus representative standard-cause and intentionally-unclassified validation behavior.
- Documented cause/original-failure propagation and confirmed stacks/causes remain absent from
  closed CLI JSON, canonical records, trace archives, receipts, and schemas.

### Impact

Consumers can rely on portable package maps and opt-in mapped TypeScript stacks without any error,
recovery, mutation, or serialization behavior change.

## [1.59.0] - 2026-08-30

### New Feature

- Added stable configuration-owned machine codes to every exported fixed-class error that lacked
  one, preserving existing classes, prototypes, constructors, messages, and `instanceof` behavior.
- Added the root `PublicError`, `PublicErrorCode`, and accessor-safe `isPublicError` in-memory
  contract, plus a complete exported-error and intentionally-unclassified failure matrix.
- Preserved existing standard causes without adding messages, stacks, paths, credentials, or
  causes to canonical evidence, trace archives, or the closed CLI JSON protocol.

### Impact

Consumers can branch on stable error codes across every supported facade without parsing messages
or losing existing error identity. Validation and caller-owned failures remain honestly
unclassified, and no recovery or mutation authority changes.

## [1.58.0] - 2026-08-29

### New Feature

- Added the stable Node-only `./effects` ESM facade for immutable intent/outcome construction,
  exact correlation, ordered exact-kind handler stacks, stable errors, and public types.
- Added fresh-package runtime and type evidence for success/failure correlation, last-matching
  dispatch precedence, and typed unhandled-effect behavior.
- Kept formal proof/reference machinery, task/provider/run execution, trace persistence, workspace
  settlement, interception/replay claims, private validation, and protocol configuration outside
  the effect-owned entry.

### Impact

Effect consumers have a cohesive supported subpath while handler callbacks remain explicit,
in-process, and non-durable. Existing root and domain facades remain unchanged.

## [1.57.0] - 2026-08-28

### New Feature

- Added the stable Node-only `./workspace` ESM facade for initialization/bindings, copy and Git
  custody, changeset inspection, repository grants, placement/native-jail evidence, retained-world
  execution/recovery journals, and exact settlement operations.
- Added fresh-package composition across the task, provider, run, trace, and workspace facades,
  including retained-output capture, read-only content inspection, and exact selection.
- Kept task registries, provider adapters, run builders/controls, the SQLite store constructor,
  low-level trace mutation, private codecs/migrations, and protocol configuration outside the
  workspace-owned entry.

### Impact

Workspace consumers have a cohesive supported subpath with explicit filesystem, Git, native,
persistence, and mutation authority. Existing root and domain facades remain unchanged.

## [1.56.0] - 2026-08-28

### New Feature

- Added the stable Node-only `./runs` ESM facade for run builders and errors, budgets and
  cancellation, provider-neutral task execution, and durable execution/control/recovery/
  inspection.
- Added fresh-tarball runtime and type composition across task, provider, run, and trace facades,
  including finished offline/durable runs, budget exhaustion, cancellation, archive import, and
  durable inspection.
- Kept task registries, provider adapters, the SQLite store constructor, workspace handles,
  private codecs/migrations, and protocol configuration outside the run-owned entry.

### Impact

Run consumers have a cohesive supported subpath while retaining explicit task, provider, and
trace authority injection. Existing root and domain facades remain unchanged.

## [1.55.0] - 2026-08-27

### New Feature

- Added the stable Node-only `./trace` ESM facade for the write-capable trace store, public
  append/cut/slice/blob contracts, integrity/archive methods, and bounded evidence projections.
- Added fresh-tarball append, immutable-cut, trace-revision, archive round-trip, type, declaration,
  and map conformance.
- Kept task registry, providers, executors, workspace carriers/settlements, private SQL/migrations,
  and protocol configuration outside the trace-owned entry.

### Impact

Trace consumers have a cohesive supported Node subpath with explicit persistence authority and no
false browser-safe claim. Existing root and domain facades remain unchanged.

## [1.54.0] - 2026-08-27

### New Feature

- Added the stable `./providers` ESM facade for provider-neutral contracts, descriptors,
  response artifact/usage types, deterministic static adapters, and stable provider errors.
- Added fresh-tarball runtime/type conformance for mismatch refusal, exact exchange consumption,
  declarations, maps, and compatibility with every existing facade.
- Kept task execution, run control, tools, credentials, workspace authority, and cassette internals
  outside the provider-owned entry.

### Impact

Provider adapter consumers have a cohesive supported subpath without importing execution or
authority surfaces. Existing root and domain facades remain unchanged.

## [1.53.0] - 2026-08-26

### New Feature

- Added the stable `./tasks` ESM facade for task/schema builders, registry APIs/errors, task
  artifact types, and bounded task-ledger reads.
- Added fresh-tarball runtime and TypeScript conformance for descriptor creation, exact
  registration/resolution, ledger projection, declarations, and maps.
- Kept providers, run execution/control, trace stores, workspace grants, and private migrations
  outside the task-owned entry.

### Impact

Task-library consumers can use a cohesive supported subpath without importing or depending on
unowned execution and workspace authority surfaces. The root API remains unchanged.

## [1.52.0] - 2026-08-26

### New Feature

- Added an explicit ESM package export map preserving the complete root facade and adding cohesive
  `./canonical` and `./cli` subpaths.
- Added fresh-tarball runtime and TypeScript consumer conformance for every declared entry,
  declaration/source maps, and the existing offline quickstart.
- Added tested CommonJS and undeclared deep-import refusal with a documented ESM-only policy.

### Impact

Consumers have stable supported import boundaries and clear module-system behavior without losing
any root export or receiving a misleading partial CommonJS build.

## [1.51.0] - 2026-08-25

### New Feature

- Added configured exact-run `publish-retained-workspace-output` compatibility over the existing
  immutable committed output citation.
- Added idempotent human/JSON verification with exact run, output, capture, cut, changeset, and
  custody evidence.
- Added a configured fail-closed managed-recovery remedy when a raw run ID cannot safely repair a
  missing terminal cut.

### Impact

The documented publication command is available without introducing redundant records or
granting recovery authority from ergonomic selectors. Phase 4 L1 compatibility evidence is now
complete while later product/runtime surfaces remain explicitly separate.

## [1.50.0] - 2026-08-25

### New Feature

- Added the configured distinct `run trace-revision` list/show command over the existing immutable
  trace-revision cut/slice projection.
- Preserved byte-identical human behavior with `run trace` while stable JSON records the distinct
  command identity and exact trace revision evidence.
- Extended generated command/schema artifacts and fresh installed-package conformance without
  changing trace, archive, selector, repair, settlement, or provider authority.

### Impact

CLI consumers can use the documented trace-revision spelling with the same bounded immutable
evidence and archive/reopen behavior already provided by the native trace projection.

## [1.49.0] - 2026-08-25

### New Feature

- Added configured `run outputs` list/show views over validated cut-bounded retained products and
  their exact run, changeset, custody, binding, and settlement evidence.
- Added authenticated `run changeset` summary and bounded retained UTF-8 content reads with
  exact/prefix/latest selectors, paging, binary/missing/corrupt refusal, and no user-workspace read.
- Added the native `run vcscore` citation view without synthesizing upstream-private record fields.
- Extended the stable closed CLI JSON schema/reference and fresh installed-package quickstart gate
  across all three read-only commands.

### Impact

CLI consumers can inspect retained products, canonical changed paths/content, and native custody
citations without invoking providers or granting settlement, repair, Git, or filesystem mutation
authority. Existing evidence schemas and archive identities are unchanged.

## [1.48.0] - 2026-08-25

### New Feature

- Added the checked-in `shepherd-ts demo write quickstart` fixture with stable human/script bytes
  and bounded JSON metadata generated from validated CLI configuration.
- Added an installed-package offline walkthrough that initializes a fresh workspace, runs a
  bodyless task through the static provider and isolated retained world, inspects the proposed
  `NOTE.txt`, and selects the exact output.
- Added safe missing-file creation to the existing fenced `writeText` capability while preserving
  path, parent, symlink, metadata, grant, size, and stale-fence refusal.
- Declared the established ESM package root and type declarations, and verified emitted-script,
  run, output-citation, and trace evidence against a freshly packed and installed tarball.

### Impact

Installed consumers can run the deterministic keyless retained-output walkthrough without the
repository source tree or unpublished imports. Existing replacement writes and exact settlement,
repair, archive, and native-platform behavior remain compatible; subpath/CommonJS packaging and
the remaining documented CLI views are still later work.

## [1.47.0] - 2026-08-25

### New Feature

- Added the configured `shepherd.cli.json.v1` canonical success/error envelope across every
  shipped CLI read and mutation command, with stable error classes for fenced capabilities.
- Added closed command-result field schemas, canonical byte bounds, exact public evidence payloads,
  and failure redaction that excludes messages, stacks, and resolved paths.
- Added a configuration-derived checked-in command reference and machine-output schema, plus
  source, built, packed, and installed executable conformance gates.
- Preserved the `shepherd.cli.v1` human output and existing read-only, exact-ID, idempotent repair,
  settlement, custody, native-platform, and recovery authority boundaries.

### Impact

CLI consumers can now rely on a versioned deterministic JSON protocol and packaged generated
reference without parsing human text or gaining new mutation authority. Existing human CLI users
do not need to adapt.

## [1.46.0] - 2026-08-24

### New Feature

- Added the configured `shepherd-ts` executable with deterministic root/group help and bounded
  human output for `init`, `doctor`, `run`, `task`, `demo`, and `package` command families.
- Added protected workspace initialization, read-only diagnostics, run/task/trace/evidence reads,
  exact retained-world settlements, and globally idempotent orphan repair through existing public
  authority seams.
- Added configured exit classes, command/path/argument/output bounds, fenced and unavailable
  remedies, fresh-process and package-bin tests, pinned research, and normative CLI documentation.
- Added current-schema read-only trace-store and task-registry open policies so diagnostics and
  CLI reads never migrate retained state.
- Added a post-build pack/install/invoke conformance gate for the installed `shepherd-ts` binary.

### Impact

Users can operate the shipped public TypeScript capabilities from a distinct bounded executable
without granting new mutation authority or claiming stable JSON. Dynamic task source loading,
demo/package scaffolding, generated command reference, and the packaged offline quickstart remain
explicit later slices.

## [1.45.0] - 2026-08-24

### New Feature

- Added store schema v8 reversible-operation bookkeeping with externally proven session-death
  evidence and bounded read-only orphan diagnosis.
- Added public globally idempotent exact repair commands, durable prepare/receipt trace evidence,
  atomic bookkeeping-only mutation, empty replay, concurrent/interrupted retry convergence, and
  fail-soft pre-run reclaim.
- Added generated closed diagnosis, command, and receipt schemas plus pinned Shepherd `0.3.0`
  research and normative API/security documentation.

### Impact

Interrupted reversible operations can now be diagnosed and repaired safely through public
TypeScript APIs without invoking providers, changing lifecycle/outcome/cut evidence, mutating user
files or Git state, settling outputs, deleting custody, or reclaiming orphaned scopes. CLI
presentation remains a later compatibility slice.

## [1.44.0] - 2026-08-23

### New Feature

- Added configured output/trace/recovery evidence projection v1 with bounded closed inputs,
  canonical result limits, stable typed selectors, and three generated language-neutral schemas.
- Added public retained-output citation, published-cut trace-revision, and durable recovery-record
  list/show APIs with exact, unique-prefix, and canonical-latest reads.
- Added cut-bounded output/settlement, owner-path/causal/witness, command/effect, lifecycle, and
  archive-stable claim/fence evidence with incomplete, post-cut, import, and fresh-process tests.
- Added pinned Shepherd `0.3.0` output/trace/recovery research and kept orphan repair, CLI
  rendering, output hydration, and upstream trace-event verbs explicitly out of scope.

### Impact

Callers can inspect exact retained outputs, immutable native trace revisions, and recovery/control
history without invoking a provider, acquiring a claim, reading user files, performing settlement,
or repairing evidence. Existing canonical identities and exact mutation authority are unchanged.

## [1.43.0] - 2026-08-23

### New Feature

- Added configured task/run ledger projection v1 with bounded closed pagination, canonical entry
  limits, stable selector errors, and generated language-neutral task/run entry schemas.
- Added public immutable task and durable-run list/show APIs with exact, unique-prefix, and
  canonical-latest read selectors; task entries accept authenticated repository-grant companion
  evidence and run entries compose lifecycle, usage, artifacts, outcomes, cuts, settlements, and
  task-world placement/jail/output evidence.
- Added pinned Shepherd `0.3.0` selector research plus incomplete, duplicate, malformed,
  reopen/import, ordering, pagination, and exact-ID authority evidence.

### Impact

Callers can inspect and select retained tasks and runs deterministically without granting recovery,
execution, filesystem, provider, or settlement authority. Native latest ordering is stable across
trace export/import and deliberately avoids clocks, filesystem metadata, and SQLite row order.

## [1.42.0] - 2026-08-22

### New Feature

- Added workspace protocol v25 receipt-only `release`/`released` settlement vocabulary and a
  generated closed release-receipt schema.
- Added public exact-ID release execution and read-only inspection with current-basis witnesses,
  preserved retained custody, terminal citations, concurrent/fresh-process replay, and interrupted
  terminal/citation recovery.
- Added pinned Shepherd 0.3.0 contract research plus public Git-state, parent-drift,
  missing-custody, consume-once, schema, corruption, and restart evidence.

### Impact

Callers can deliberately settle a retained output without publishing it into the user world or
deleting its custody. Released content remains inspectable, while all competing settlement verbs
remain consume-once and user/Git state remains unchanged.

## [1.41.0] - 2026-08-22

### New Feature

- Added workspace protocol v24 bounded content-addressed equal/prefix/portable-alias conflict
  evidence and exact durable base/current/candidate/merged application plans.
- Added public path-disjoint `apply` preparation, plan inspection, three-way materialization,
  consume-once settlement, terminal citations, concurrent/restart recovery, and generated conflict,
  plan, and receipt schemas.
- Preserved unrelated current filesystem changes and Git HEAD/index/sparse/dirty/untracked/ignored
  state while refusing overlaps, moved bases, Git administrative candidate paths, corrupt plans,
  and third-state recovery.

### Impact

Callers can apply an isolated retained output onto an independently advanced user world when the
two deltas touch disjoint portable paths. Overlap is reported before admission so the output remains
selectable or discardable; no textual merge, rename inference, Git history mutation, or `release`
transition is claimed.

## [1.40.0] - 2026-08-21

### New Feature

- Added workspace protocol v23 authenticated macOS Seatbelt and Linux/WSL Landlock backend
  descriptors and real allow/deny probes, with explicit unavailable evidence for native Windows,
  missing launchers/compilers, blocked syscalls, profile failure, and helper-integrity failure.
- Added structured shell-free native runner commands, exact repository-grant writable-root
  lowering, read-only/ungranted/symlink-alias syscall denial, bounded output, cancellation,
  timeout, process-group quiescence, and terminal launch receipts.
- Added native jail placement and durable capture/recovery APIs with complete backend, probe,
  command, confinement-plan, process, grant, task, runner, run, and capture evidence under
  journal v12/v4, including same/fresh-process replay and no automatic retry after uncertain start.
- Added generated language-neutral native backend, probe, command, resolution, confinement-plan,
  process, and world-capture journal v4 schemas plus real platform-gated denial and malformed-
  evidence suites.

### Impact

Callers can run a structured judged filesystem command with native write denial on a capable
macOS Seatbelt or Linux/WSL Landlock host. Explicit jail fails before runner/provider execution
when the backend cannot be proved, and auto reaches jail only with authenticated successful probe
evidence; advisory fallback remains visible. Ordinary v9/v1, granted v10/v2, and advisory placed
v11/v3 journal writers/readers and their public behavior remain unchanged.

## [1.39.0] - 2026-08-19

### New Feature

- Added workspace protocol v22 content-addressed placement platform evidence with deterministic
  macOS, Linux, native Windows, WSL, and unsupported classifications that retain no environment
  values.
- Added configured advisory/auto/jail request rules: advisory resolves honestly, auto records a
  visible advisory fallback, and explicit jail fails closed because no native backend is shipped.
- Added placed granted capture and recovery APIs with complete pre-invocation journal-v11/v3
  evidence, changed-request/platform refusal, exact replay, and fresh-process reconstruction while
  preserving ordinary journal-v9/v1 and unplaced-granted journal-v10/v2 writers and readers.

### Impact

Callers can distinguish requested placement from effective placement and actual enforcement before
and after a granted run. This release reports advisory execution honestly and does not claim
Seatbelt, Landlock, syscall denial, process containment, or any other native jail capability.

## [1.38.0] - 2026-08-18

### New Feature

- Added workspace protocol v21 versioned repository task-grant companion artifacts with configured
  `read`/`write` atoms, canonical whole-binding profiles, order-neutral identity, and an independent
  conformance fixture without redefining existing bodyless task artifacts.
- Added authenticated exact multi-repository grant plans that bind every logical grant to a
  package-created repository resource and intersect it with a non-amplifying whole-run ceiling.
- Added granted retained-world capture and recovery APIs with advisory per-operation read/write
  enforcement, Git/control-path refusal, current-resource revalidation, exact journal-v10 plan
  descriptor/identity under a new v2 schema, fresh-process recovery, and backward-readable
  unchanged journal-v9/v1 evidence.

### Impact

Callers can declare and durably recover explicit per-repository authority with a whole-run cap and
fail-closed exact resource admission. Enforcement is currently an in-process capability contract,
not an OS sandbox; placement reporting and native jail enforcement remain later Phase 4 work.

## [1.37.0] - 2026-08-18

### New Feature

- Added workspace protocol v20 `createGitRepositoryBindings` authorities with exact Git worktree,
  shared-repository, per-worktree, object-format, and filesystem evidence plus stable
  order-independent resource identities.
- Added independent multi-repository Git custody receipts beneath one workspace control root,
  linked/common-repository and nested submodule-boundary refusal, repository-drift detection, and
  package-handle authentication before custody capture.
- Added pinned `0.3.0` `GitRepo` evidence and explicit oracle gaps without claiming that local
  filesystem/resource identity or future grant semantics match undocumented Python internals.

### Impact

Callers can bind and retain multiple disjoint Git repositories under one initialized workspace
without writing Shepherd metadata into those user repositories, while ordinary Phase 3 directory
bindings and all existing settlement behavior retain their identities and public APIs.

## [1.36.1] - 2026-08-18

### Improvement

- Published the Phase 3 production-seam evidence matrix and L1-alpha compatibility boundary for
  retained-world isolation, inspection, moved-basis refusal, one-winner settlement, discard
  preservation, and restart recovery.
- Reconciled README, documentation, roadmap, parity, and tracker status while keeping runtime
  grants, jail placement, `apply`, `release`, CLI, installed-package, optimized-carrier, and final
  native-Windows claims assigned to later verified work.

### Impact

Users can distinguish the completed P0 retained-world settlement loop from the remaining full
`0.3.0`, substrate, paper, and production-readiness work without relying on stale L0 status text or
overstated platform/package claims.

## [1.36.0] - 2026-08-17

### New Feature

- Added workspace protocol v19 public platform-policy inspection, fail-closed host probes for
  ACLs, extended attributes, resource forks, and alternate streams, and portable case-collision
  rejection before reference-carrier publication.
- Added explicit `core.symlinks=false` placeholder refusal, actual sparse-index custody evidence,
  stable configured permission/capacity/mutation/interruption faults across reference and Git
  custody, and reference-suite gating for optimized-carrier parity.
- Added deterministic selection fault boundaries proving that interrupted carrier publication
  leaves no falsely terminal settlement receipt and converges through authenticated retry.
- Pinned generated TypeScript and JSON artifacts to canonical LF checkout bytes so protocol
  synchronization remains deterministic on Windows, and made Gitlink test identity independent of
  machine-global Git configuration.
- Added a configured fail-closed metadata-probe timeout and serial Windows verification path so a
  stalled or contended native host tool cannot hang custody verification indefinitely.

### Impact

Retained custody now classifies unsupported host semantics and interrupted publication precisely,
fails closed before ambiguous claims, and supplies repeatable recovery evidence across reference,
Git-aware, and settlement boundaries on macOS, Linux, and Windows.

## [1.35.0] - 2026-08-16

### New Feature

- Added workspace protocol v18 configured protected-path validation with deterministic Unicode,
  case-fold, trailing-character, alternate-name, and resolved symlink-alias comparisons plus a
  public versioned validation result and stable typed error.
- Enforced the shared policy across reference-copy and Git capture, retained revision/custody
  verification, selection staging and recovery, and discard cleanup before user-path effects.
- Added direct, nested, case-folded, alternate-name, symlink-alias, selection, cleanup-recovery,
  and ordinary-path preservation fixtures.

### Impact

Retained-world operations now fail closed before protected Shepherd control metadata can be
captured, inspected, materialized, or cleaned through an alias, while ordinary managed paths and
durable retry behavior remain unchanged.

## [1.34.0] - 2026-08-16

### New Feature

- Added workspace protocol v17 terminal retained-world settlement citation records with exact
  command, request, operation, receipt, output, and terminal trace identities plus deterministic
  immutable citation cuts.
- Extended durable execution inspection with frozen, cut-bounded settlement projections that
  survive native trace export/import without the private settlement journal.
- Added idempotent citation publication repair after selected terminal retention or completed
  discard cleanup, with duplicate-view convergence and fail-closed missing or malformed evidence.

### Impact

Callers can trace a settled retained output from the durable execution projection to its exact
decision and terminal receipt, including after archive transfer, while interrupted citation
publication recovers without replaying user-path effects.

## [1.33.1] - 2026-08-16

### Improvement

- Added the repository-wide GitHub issue delivery workflow for dependency-ordered branch creation,
  verification, documentation, pull requests, issue updates, merge gates, and next-task reporting.

### Impact

Contributors and coding agents now have one explicit process for delivering roadmap issues from an
updated `main` branch through verified pull-request merge and selection of the next unblocked task.

## [1.33.0] - 2026-08-16

### New Feature

- Added public exact-output retained-world selection with authenticated immutable revision and
  changeset reconstruction, consume-once action enforcement, and two semantic-basis checks before
  the first managed-path write.
- Added exact carrier-publication citation in the selected terminal receipt, applying-prefix and
  post-publication restart repair, selected replay validation, and third-state refusal.

### Impact

Callers can now apply one explicitly admitted retained output to its canonical binding and recover
an interrupted selection without re-admission, inference from current bytes, or overwrite of
unrecognized user state.

## [1.32.0] - 2026-08-16

### New Feature

- Added authenticated reference-carrier execution of v16 dependency-scheduled filesystem effects
  from immutable staging, with descriptor-safe before/after validation and durability flushes.
- Added append-only step-prefix recovery, exact-after replay without rewriting, third-state refusal,
  concurrent equal publication convergence, safe advancement of earlier authenticated staging, and
  separately retained terminal carrier receipts.

### Impact

The carrier can now durably materialize and recover one exact selected world without overwriting
unrecognized user state. Public consume-once `select` remains unavailable until Task 9.4B3 composes
the coordinator, both semantic-basis checks, and store-terminal recovery.

## [1.31.0] - 2026-08-15

### New Feature

- Added workspace protocol v16 dependency-scheduled path-step and terminal publication-receipt
  codecs bound to the exact v15 schedule and v14 selection plan.
- Added configured scheduled evidence identity domains and versions, an immutable compatibility
  lock, and generated language-neutral publication schema v3 coverage.

### Impact

The carrier protocol can now retain an exact dependency-ordered effect prefix and terminal receipt
without redefining prior plan, step, receipt, or schedule evidence. Filesystem effects and public
selection remain unavailable until Task 9.4B2B2B and Task 9.4B3.

## [1.30.0] - 2026-08-15

### New Feature

- Added authenticated reference-carrier staging for exact v14 selection plans and v15 dependency
  schedules reconstructed from the cited settlement operation, changeset, and retained revisions.
- Added deterministic protected staging publication sourced only from immutable head custody, with
  exact replay after reopen and fail-closed conflict/corruption handling.

### Impact

The carrier can now durably prepare and verify the exact immutable bytes required by a selection
without reading or mutating the user binding. Scheduled user-path effects and public `select`
remain unavailable until the following Task 9.4B2B2 and 9.4B3 slices.

## [1.29.0] - 2026-08-15

### New Feature

- Added workspace protocol v15 canonical, content-addressed dependency schedules over exact v14
  selection plans without redefining the existing plan, step, or receipt encodings.
- Added deterministic directory-safe ordering: construction parents precede descendants, removed
  or replaced directories follow descendants, and unrelated changes retain canonical order.
- Added configured schedule identity, kind, version, filename and byte bound, an immutable
  compatibility lock, and a generated language-neutral publication schema v2.

### Impact

The reference carrier now has a deterministic application order for the next staging/publication
slice while canonical changeset identity and all workspace protocol v14 evidence remain unchanged.
Public selection and user-workspace mutation remain unavailable.

## [1.28.0] - 2026-08-15

### New Feature

- Added workspace protocol v14 closed, canonical, content-addressed retained-world selection plans,
  ordered path-step receipts, and terminal carrier publication receipts.
- Added configured journaled-path atomicity, selection identity domains, resource and path bounds,
  stable movement/recovery/unsupported errors, an immutable compatibility lock, and a generated
  language-neutral publication schema.

### Impact

The workspace package now has a validated protocol boundary for the next reference-carrier staging
and publication slice. Public selection and user-workspace mutation remain unavailable.

## [1.27.1] - 2026-08-15

### Improvement

- Defined the retained-world selection publication contract for two semantic basis checks,
  immutable-source staging, journaled managed-path effects, exact publication receipts, and
  fail-closed restart repair.
- Assigned the versioned carrier and public selection implementation to Phase 3 Task 9.4B without
  claiming whole-tree atomic visibility or runtime selection in this documentation-only slice.

### Impact

The roadmap now has an implementable crash boundary for exact-ID selection across SQLite and the
user filesystem. Runtime behavior is unchanged.

## [1.27.0] - 2026-08-14

### New Feature

- Added authenticated public exact-ID retained-world discard that publishes deterministic terminal
  authority before invoking idempotent physical custody cleanup.
- Added restart recovery for interrupted cleanup, including convergence after custody was deleted
  but cleanup completion was not yet retained.

### Impact

Consumers can durably discard an admitted retained output without changing user files and safely
retry after interruption. Public selection remains Phase 3 Task 9.4.

## [1.26.0] - 2026-08-14

### New Feature

- Added atomic `prepared` to `applying` settlement operation retention and action-specific
  `selected`/`discarded` terminal receipt retention over trace-store schema v7.
- Added restart-safe exact journal reads, identical transition replay, skipped-transition refusal,
  nullable-evidence corruption checks, cross-connection conflicting-receipt rejection, and an
  idempotent discarded cleanup-progress transition.

### Impact

Task 9 now has a complete deterministic persistence state machine without performing carrier or
user-filesystem effects. Public discard and cleanup recovery remain Phase 3 Task 9.3.

## [1.25.0] - 2026-08-14

### New Feature

- Added workspace protocol v13 configured deterministic settlement-operation and terminal-receipt
  codecs with content-addressed operation identity and canonical exact-data replay.
- Added action-specific receipt validation that binds publication evidence for selection and
  unchanged user-basis plus explicit cleanup progress for discard.

### Impact

Task 9 now has a closed deterministic codec boundary for the schema-v7 settlement journal.
Transactional state transitions and public filesystem effects remain later slices.

## [1.24.2] - 2026-08-14

### Improvement

- Added trace-store schema v7 with nullable deterministic operation, receipt, and cleanup-evidence
  columns for the settlement effect journal.
- Added migration coverage proving schema-v6 prepared settlement requests reopen unchanged with no
  fabricated effect evidence.

### Impact

Task 9 now has a backward-compatible persistence carrier for later transactional transitions.
Public settlement behavior is unchanged.

## [1.24.1] - 2026-08-14

### Improvement

- Closed the Phase 3 Task 9 settlement effect-journal contract for deterministic operation
  identity, persisted transition receipts, cleanup-pending projection, schema-v7 migration, and
  restart recovery before public filesystem effects are exposed.

### Impact

The roadmap no longer leaves `applying`, `selected`, or `discarded` as state names without an
exact persistence and recovery contract. Runtime behavior is unchanged.

## [1.24.0] - 2026-08-14

### New Feature

- Added restart-safe `inspectRetainedWorldSettlement` with immutable execution, cut, journal, and
  capture-record revalidation and explicit absent-output classification.
- Added authenticated cross-connection `select`/`discard` admission-race coverage proving one
  winner, one typed conflict, and a stable read-only result after settlement preparation.

### Impact

Consumers can safely inspect prepared settlement authority after reopening the store without
accessing carrier custody or user files. Phase 3 Task 8 is complete; public settlement effects
remain Task 9.

## [1.23.0] - 2026-08-14

### New Feature

- Added public authenticated retained-world settlement preparation that verifies the exact
  terminal execution, immutable cut, capture journal, binding, carrier revisions, canonical
  changeset, and mutable custody before consume-once admission.
- Added restart and adversarial public-seam coverage for exact replay, forged output authority,
  forged handles, malformed options, conflicting decisions, and moved custody.

### Impact

Consumers can now reserve one exact retained output for `select` or `discard` without mutating the
user workspace. Public settlement effects and restart-safe read-only inspection remain later
Phase 3 slices.

## [1.22.0] - 2026-08-14

### New Feature

- Added workspace protocol v12 exact retained-output settlement actions, states, request identity,
  versioning, and stable error contracts.
- Added trace-store schema v6 and an internal atomic consume-once admission primitive with exact
  command replay, output/command conflict refusal, and restart-safe reads.

### Impact

The persistence layer can now guarantee one winning prepared settlement decision for an exact
retained output across SQLite connections and restarts. Public `select` and `discard` remain
deferred until authenticated evidence admission and recovery-safe filesystem effects are complete.

## [1.21.1] - 2026-08-14

### Improvement

- Added the exact-ID `select`/`discard` settlement research contract and corrected the Phase 3
  roadmap so consume-once compare-and-swap authority precedes every public settlement mutation.

### Impact

The implementation plan no longer permits an intermediate settlement API that could bypass
consume-once concurrency and restart guarantees. Runtime behavior is unchanged.

## [1.21.0] - 2026-08-14

### New Feature

- Added workspace protocol v11 `createWorldChangesetInspection` with authenticated exact-path
  lookup, configured bounded pagination, digest-verified retained content reads, and bounded
  UTF-8/binary previews.
- Added deterministic exact-content rename/copy projections that remain outside canonical
  workspace protocol v5 changeset identity.
- Added `createGitChangesetInspection` for authenticated Gitlink add/delete/modify/replacement and
  retained symbolic-link mode presentation without recursive submodule capture.

### Impact

Consumers can safely reopen and inspect retained output bytes and Git-aware changes after restart
without reading user files, invoking external diff drivers, or changing canonical changeset IDs.
Selection and settlement remain later Phase 3 capabilities.

## [1.20.0] - 2026-08-13

### New Feature

- Added `recoverTaskWorldDurably` for globally idempotent command-authorized recovery of exact
  `prepared` and `forked` task-world captures without directory scanning or duplicate invocation.
- Added workspace protocol v10 deterministic task-world custody identity with compatibility for
  reopening recorded v9 custody.
- Added terminal-cut repair, exact committed replay, competing-recovery fencing, cooperative
  cancelled partial-world retention, and fail-closed uncertain-writer handling.

### Impact

Consumers can recover a pre-execution task-world capture after restart, converge across custody
publication interruption, and replay committed retained output without invoking the runner again.
An executing capture remains deliberately recovery-required until independent quiescence exists.

## [1.19.0] - 2026-08-13

### New Feature

- Added workspace protocol v9 ordered task-world capture journal evidence for preparation,
  custody fork, fenced execution, and verified capture.
- Added fail-closed recovery validation that binds retained world output to its exact capture
  identity, runner authority, custody, basis, changeset, and causal journal chain.
- Added `inspectTaskWorldCaptureJournal` for immutable restart-safe journal and terminal-attachment
  inspection without invoking a runner or carrier.

### Impact

Consumers can diagnose a task-world capture from durable evidence before and after restart and can
distinguish incomplete execution from committed retention. Automatic retry, cancellation cleanup,
cross-store custody-orphan repair, and uncertain-writer recovery remain Phase 3 Task 6B.4.

## [1.18.0] - 2026-08-13

### New Feature

- Added `captureTaskWorldDurably` for authenticated invocation-fenced execution against isolated
  retained custody with existing regular UTF-8 file reads and replacements.
- Added workspace protocol v8 world-capture identities, schema generation, configured bounds, and
  fail-closed recovery validation.
- Added immutable child capture and canonical changeset composition with the verified world record
  committed atomically inside the ordinary execution terminal cut.

### Impact

Registered runners can now produce a successfully retained world without changing user files, and
the result is causally attached to the durable task outcome. Pre-invocation capture journaling,
restart retry, uncertain-writer recovery, cancellation cleanup, and richer file operations remain
Task 6B.3–6B.4.

## [1.17.0] - 2026-08-12

### New Feature

- Added `createRetainedWorldRunner` for closed opaque runtime adapter registration handles.
- Added workspace protocol v7 with configured runner version, identity bounds, and an honest
  initial `advisory` enforcement classification.

### Impact

Task-world execution now has a closed runner registration whose callback remains private. Handle
authentication, fenced world capability issuance, and durable capture publication remain the next
Task 6 slices; this release does not yet grant filesystem authority or execute retained work.

## [1.16.0] - 2026-08-12

### New Feature

- Added `captureCustody` to publish an isolated mutable world as a verified immutable child of its
  exact base revision.
- Added deterministic repeat convergence, restart reopen, byte verification, and direct
  carrier-authenticated Task 5 changeset composition for captured children.
- Added workspace protocol v6 with a configured bound for iterative, fail-closed revision-ancestry
  verification.
- Preserved the user binding and parent revision while retaining mutable custody for later fenced
  execution and recovery decisions.

### Impact

Task-world execution now has the carrier primitive needed to turn quiesced isolated work into a
durable revision. The authenticated runner, shared execution fence, capture journal, and terminal
cut attachment remain the next Task 6 slice.

## [1.15.0] - 2026-08-12

### New Feature

- Added workspace protocol v5 `createWorldChangeset` for immutable, carrier-verified comparison of
  two exact retained copy-world revisions.
- Added canonical add, delete, modify, and type-replacement records covering files, directories,
  modes, and non-dereferenced symlink targets with deterministic content-addressed identity.
- Added fail-closed revision, manifest, ancestry, path, binding, identity, and configured resource
  limit validation with frozen changed-path projections.

### Impact

Consumers can describe retained copy-world differences exactly without reading or changing user
files. Execution capture, Gitlink-aware read-only inspection, previews, selection, and settlement
remain later Phase 3 slices.

## [1.14.0] - 2026-08-12

### New Feature

- Added workspace protocol v4 `createGitAwareCustody` for `git-head`, `worktree`, and `none`
  adoption with isolated retained output on the reference copy carrier.
- Added exact HEAD, index-byte and semantic-entry, sparse-checkout, ignored-source, repository,
  linked-worktree, binding, and managed-world basis evidence with movement classification.
- Added independently verified Git-object packs including staged-only index objects, atomically
  published restart-safe closed receipts, shared linked-worktree repository identity, clean-gitlink
  handling, and fail-closed conflict, dirty-submodule, nested-repository, and corruption checks.

### Impact

Consumers can retain Git-aware task output without changing the user's refs, index, configuration,
or working tree, then reopen and verify it after restart. Complete changeset semantics remain the
next Phase 3 slice.

## [1.13.0] - 2026-08-11

### New Feature

- Added workspace protocol v3 `createReferenceCopyCarrier` with immutable content-addressed
  snapshots, isolated mutable forks, and closed restart-safe revision and custody descriptors.
- Added logical manifests for file bytes, directories, permission modes, and contained symlink
  targets with fail-closed unsupported-object, escape, mutation, and corruption handling.
- Added structured revision and custody verification plus exact idempotent custody discard that
  preserves the immutable parent and user workspace.
- Added durable permission and carrier-directory publication, exact collision checks, normalized
  name rejection, and restart-time binding-citation validation.

### Impact

Consumers can retain and mutate a verified copy of a bound world without changing user files.
Git-aware custody, changesets, inspection, selection, and settlement remain later Phase 3 slices.

## [1.12.0] - 2026-08-11

### New Feature

- Added `createWorkspaceBindings` for ordered, frozen, content-addressed logical root authority.
- Added filesystem canonicalization, initialized-workspace containment, and rejection of equal,
  ancestor, descendant, and symlink-aliased roots before returning any binding.
- Added configured typed failures for invalid names or roots, duplicate names, authority escapes,
  and root overlap.
- Added explicit `binding_version: 2` workspace protocol results as a binding extension while
  preserving the immutable initialization and adoption protocol v1 contract.

### Impact

Consumers can establish stable disjoint workspace authorities without relying on display-path
spelling. World-byte custody and runtime permission grants remain separate later capabilities.

## [1.11.0] - 2026-08-11

### New Feature

- Added `initializeWorkspace` and `openWorkspace` with configured `none`, `git-head`, and
  content-addressed `worktree` baseline citations.
- Added protected versioned `.vcscore` metadata, exact idempotent reuse, typed conflicts, Git HEAD
  availability checks, and fail-closed symlink or malformed-control rejection.
- Added optional Git initialization that creates no commit and preserves existing files, index,
  refs, and dirty worktree state.

### Impact

Consumers can initialize and reopen a workspace without silently changing Git history and can cite
the exact baseline selected for later retained-world custody. Copy-carrier storage and settlement
remain separate Phase 3 capabilities.

## [1.10.1] - 2026-08-11

### Improvement

- Completed the Phase 2 exit audit with exact native-trace byte comparison around deterministic
  durable replay and whole-store integrity checks for pre-invocation cancellation and exhaustion.
- Corrected the roadmap so runtime-grant identity is gated by the Phase 4 grant capability and
  Phase 2 provider admission does not imply durable effect-boundary integration.

### Impact

Phase 2 now has explicit production-seam evidence for every applicable exit criterion and an
honest phase boundary. Phase 3 can begin with workspace initialization and adoption.

## [1.10.0] - 2026-08-11

### New Feature

- Added configured strong proof-evidence validation for exact Core-0 and Core-A profiles,
  strengths, assumptions, trace boundaries, and theorem-name surfaces.
- Bound allowlisted static-lowering manifests to the exact pinned upstream generator repository,
  path, revision, case, program, and generated trace.
- Added content-addressed Core-0H two-phase sidecar validation with no trusted manifests enabled
  until an upstream artifact is published.

### Impact

Consumers can request imported theorem-backed Core-0/Core-A classifications with exact trusted
evidence. Malformed, stale, unsupported, or untrusted evidence remains reference-validated, and
Core-0H cannot strengthen a claim without an explicitly configured trusted sidecar.

## [1.9.0] - 2026-08-11

### New Feature

- Added a configured executable single-root Core-A typed-effect lifecycle validator with exact
  normalized record shapes, correlation, one-shot resumption, closure, and live-prefix rules.
- Added a frozen fail-closed proof-envelope classifier with configured profile, strength,
  content-reference, validator, and explicit production-runtime non-claim vocabularies.
- Added public-seam conformance and corruption coverage derived from pinned upstream Core-0 and
  Core-A golden traces.

### Impact

Consumers can validate normalized Appendix B reference traces and classify the strongest
executable claim supported by their evidence. Accepted complete traces and live prefixes remain
reference-validated only; missing, malformed, unsupported, or inconsistent evidence stays
runtime-only and never implies theorem-backed coverage.

## [1.8.0] - 2026-08-11

### New Feature

- Added `acknowledgeDurableTaskWaiting` to atomically publish cut-bound prerequisite waiting
  evidence, release the exact worker claim, and fence stale terminal publication.
- Extended `resumeDurableTask` with exact prerequisite-satisfaction receipts for guarded waiting
  resume while preserving suspension resume semantics.
- Added restart replay, cross-connection races, malformed-evidence rejection, stale-head/fence
  checks, and inspection coverage through the public durable-control seam.

### Impact

Checkpoint-capable workers can now enter a durable prerequisite-driven waiting state and resume
only after independently verified evidence satisfies the exact retained prerequisite. Waiting
acknowledgement and resume are idempotent across restart and do not invoke a provider or restore
external state.

## [1.7.0] - 2026-08-11

### New Feature

- Added `cancelDurableTask` for globally idempotent command-bound cancellation from exact
  `created`, `waiting`, and `suspended` lifecycle heads.
- Added atomic inactive-worker validation, pre-start claim expiry, terminal publication, exact
  replay across restart, stale-head conflicts, stale-worker fencing, and fail-closed quiescent
  evidence recovery.

### Impact

Applications can terminalize durable executions that have not crossed a provider boundary or have
already released their worker at a waiting or suspension boundary. Ambiguously running executions
still require fenced safe-boundary acknowledgement and remain fail-closed.

## [1.6.1] - 2026-08-11

### Improvement

- Added public-seam preservation coverage for suspension commits whose receipt is lost before the
  caller observes it, proving exact replay across another store connection.
- Added deterministic competing-cancellation, stale pre-resume control, and verified
  continuation-without-receipt rejection fixtures.

### Impact

The durable control plane now has explicit regression evidence for the crash, stale-worker,
missing-receipt, and cross-connection races required by the normative lifecycle roadmap. Runtime
behavior and public APIs are unchanged.

## [1.6.0] - 2026-08-11

### New Feature

- Added `requestDurableTaskCancellation` with globally idempotent command identity bound to the
  exact running lifecycle head, worker fencing token, run, and operator reason.
- Added `acknowledgeDurableTaskCancellation` to atomically publish command-bound cancelled outcome
  and terminal evidence while releasing the current claim at a worker-confirmed safe boundary.
- Added interrupted-cut repair, exact replay across store restart, stale-worker terminal fencing,
  deterministic command conflicts, and fail-closed malformed-causality validation.

### Impact

Running workers can now durably receive and safely acknowledge cancellation without fabricating a
terminal transition for an uncertain provider or external action. Direct cancellation from
created, waiting, or suspended states remains planned.

## [1.5.0] - 2026-08-11

### New Feature

- Added `resumeDurableTask` with a globally idempotent command bound to the exact suspension
  acknowledgement, continuation descriptor, and run.
- Added atomic unavailable-evidence rejection, current-head comparison, monotonic fencing-token and
  lease acquisition, and a configured command-bound running-continuation acknowledgement.
- Extended durable inspection and generated lifecycle schemas to validate and expose resumed-running
  authority across store reopen and cross-connection replay.

### Impact

Checkpoint-capable callers can now resume an exactly suspended run under a new fenced worker
authority without duplicating the transition. Resume does not restore external state or invoke a
provider; callers must restore verified checkpoint receipts before crossing an effect boundary.

## [1.4.0] - 2026-08-11

### New Feature

- Added ordered continuation checkpoint adapter contracts that return stable configured evidence
  without mutating the run ledger.
- Added `acknowledgeDurableTaskSuspension` to atomically validate the exact pause command, running
  head, immutable cut, fencing token, and available continuation evidence before publishing the
  descriptor and suspension acknowledgement and releasing the worker claim.
- Fenced provider-backed terminal publication with the exact started claim so a worker released by
  suspension cannot later retain terminal evidence.

### Impact

Checkpoint-capable workers can now durably acknowledge command-authorized suspension at a proven
safe boundary, inspect it after restart, and retry without rerunning checkpoint side effects.
Runtime waiting and same-run resume remain unavailable.

## [1.3.0] - 2026-08-11

### New Feature

- Added `requestDurableTaskPause` to retain globally idempotent canonical pause requests bound to
  an exact run, current started-lifecycle record, invocation fencing token, reason, and command
  identity.
- Added atomic current-head and live-claim validation, exact replay across store restart, and
  fail-closed conflicts for changed content, stale fences, stale heads, and terminal executions.
- Strengthened suspension inspection to validate the cited pause command's configured schema,
  causality, run binding, and expected started head.

### Impact

Applications can durably request a pause without duplicating or ambiguously retargeting command
evidence. A retained request deliberately leaves the run `running`; checkpoint adapters,
safe-boundary acknowledgement, atomic lease release, and resume remain future slices.

## [1.2.0] - 2026-08-11

### New Feature

- Extended `inspectDurableTaskExecution` with validated cut-bound waiting and suspension evidence,
  including continuation constituents, acknowledgement identity, immutable trace cut,
  prerequisite details, and retained pause-command identity.
- Added fail-closed corruption and second-connection persistence coverage without changing durable
  recovery classifications or the execution-history v1 projection.

### Impact

Applications can inspect externally retained quiescent lifecycle evidence without provider
invocation, append, repair, or state mutation. Inspection does not authorize pause, resume, or
checkpoint recovery.

## [1.1.0] - 2026-08-11

### New Feature

- Added a public pure lifecycle transition validator backed by the configured non-terminal and
  terminal transition matrices.
- Published versioned continuation-descriptor, waiting-acknowledgement, and
  suspension-acknowledgement schemas with exact continuation constituent ordering.

### Impact

Applications can validate lifecycle topology and exchange continuation evidence independently of
runtime mutation. Durable waiting, suspension, pause, and resume execution remain explicitly
unimplemented.

## [1.0.1] - 2026-08-11

### Improvement

- Defined the proposed normative run lifecycle with distinct prerequisite-driven `waiting` and
  control-driven `suspended` states.
- Specified safe-boundary acknowledgements, continuation-evidence classification, command
  authority, atomic fencing, a closed terminal-transition matrix, compatibility projection, and
  fail-closed pause, resume, and cancellation gates.

### Impact

The Phase 2 roadmap now has an implementation-ready lifecycle contract without claiming that the
current one-shot executor can pause or resume. The next slice can add versioned record schemas and
transition conformance tests against explicit evidence and fencing requirements.

## [1.0.0] - 2026-08-11

### Breaking Changes

- Added `recoverTaskDurably` with globally idempotent configured recovery-command identities and
  canonical command receipts.
- Bound safe expired-lease start recovery and terminal-cut repair causally to retained command
  evidence while preserving exact committed replay.
- Restricted expired-claim takeover atomically to command-authorized recovery so stale ordinary
  admission cannot bypass the recovery boundary.
- Changed `executeTaskDurably` so retained `created` and `terminal_pending_cut` evidence requires
  an explicit recovery command instead of advancing automatically.
- Exposed persisted append-intent identity on record views so recovery can verify command identity
  from canonical store evidence.

### Impact

Applications can retry one exact durable recovery request across restart without duplicating
provider invocation or inventing lifecycle transitions. Existing callers that relied on automatic
resume or cut repair through `executeTaskDurably` must call `recoverTaskDurably` with a stable
command identity. Reused identities conflict globally, and absent, uncertain started, malformed,
or inconsistent recovery evidence fails closed.

## [0.26.0] - 2026-08-10

### New Feature

- Added `inspectDurableTaskExecution` for immutable read-only views of absent, created, started,
  terminal-pending-cut, and committed durable executions.
- Exposed lifecycle, ordered artifact, aggregate usage, terminal outcome, immutable cut, and
  direct canonical causal-edge evidence with retained record identities.

### Impact

Applications can inspect durable execution progress and committed evidence without invoking a
provider, appending or repairing records, or persisting a second runtime authority. Committed
views remain bounded by their terminal cut and fail closed on inconsistent retained evidence.

## [0.25.0] - 2026-08-10

### New Feature

- Added optional ordered artifact definitions to provider responses and executor results, with
  configured ordinal assignment and preservation across finished and post-response failure
  outcomes.
- Persisted executor-produced artifacts atomically with terminal durable execution evidence,
  including verified blob receipts, explicit causal ordering, deterministic record identities,
  exact restart reconstruction, and malformed-evidence rejection.

### Impact

Task providers can return inline-text or durable-blob artifacts through the normal execution
boundary. Durable runs now retain and reconstruct those exact artifacts without fabricating
outputs for runs that produced none or accepting unavailable blob bytes.

## [0.24.0] - 2026-08-10

### New Feature

- Added configured expiry and monotonic fencing tokens to durable invocation claims, with atomic
  pre-start takeover and claim-guarded start publication.
- Added typed expired-or-superseded claim failures and conservative schema-v5 migration handling
  for legacy claims whose start state cannot be proven.

### Impact

A durable run can recover availability after a claimant crashes before provider invocation while
expired, superseded, or already-started writers remain unable to cross the invocation boundary.

## [0.23.0] - 2026-08-10

### New Feature

- Added atomic SQLite first-writer invocation claims for durable task runs, including typed
  acquired/lost results and cross-connection race coverage.

### Impact

Concurrent callers cannot invoke a provider twice for the same durable run identity. A claimant
that crashes before recording start evidence remains conservatively unavailable until the planned
lease-and-fencing slice.

## [0.22.1] - 2026-08-10

### Improvement

- Reconciled the agent-runtime architecture study with the implementation roadmap by defining the
  canonical record-graph authority model, fenced durable run control, coupled checkpoint evidence,
  and projection-only subscription semantics.

### Impact

Future runtime work has explicit acceptance gates for concurrent invocation safety, checkpoint
honesty, replay classification, and non-semantic event projections without changing the current
runtime protocol.

## [0.22.0] - 2026-08-10

### New Feature

- Added `readDurableTaskExecution` with absent, created, started, terminal-pending-cut, and
  committed recovery classifications.
- Added exact committed-result reconstruction across store reopen, safe pre-start resume,
  deterministic missing-cut repair, and configured `DurableExecutionRecoveryError` handling for
  ambiguous started executions.

### Improvement

- Persisted the final run-control snapshot with terminal lifecycle evidence and validate task,
  provider, usage, outcome, control, causality, witness, record mode, lifecycle, and cut agreement
  before recovery returns data.
- Reject orphan usage and cross-check exact creation input envelopes, start/turn evidence, creation
  budgets, usage counters, exhaustion reasons, and documented late observations during recovery.
- Added public-seam restart, replay, interruption, and malformed retained-evidence tests with 100%
  runtime line, branch, and function coverage.

### Impact

TypeScript applications can now restart safely around every durable task-execution boundary,
return completed work without invoking a provider again, and fail closed when an interrupted start
cannot prove that duplicate invocation is safe.

## [0.21.0] - 2026-08-10

### New Feature

- Added `executeTaskDurably` for SQLite-backed task execution with validated creation and start
  boundaries, aggregate usage, exact terminal outcomes, configured lifecycle terminals, and
  immutable terminal cuts.
- Added immutable durable execution receipts exposing creation, optional start and usage, exact
  outcome, lifecycle terminal, and cut identities.

### Improvement

- Added content-addressed append intents for deterministic equal replay and conflict detection
  before invocation when an existing run's creation evidence changes.
- Shared one validation and execution core between transient and durable execution while retaining
  pre-invocation cancellation and exhaustion without fabricated start, usage, effect, or artifact
  evidence.
- Added reopen, projection, all-terminal-status, usage, validation, replay, and conflict tests plus
  structural durable-execution documentation.

### Impact

TypeScript applications can now retain deterministic task-run evidence in the trace store and
resolve an immutable terminal execution projection after restart. Reconstructing a prior transient
result without provider invocation and resuming incomplete runs remain explicit recovery work.

## [0.20.0] - 2026-08-10

### New Feature

- Added `executeTask` for offline provider-backed execution of typed bodyless tasks.
- Added immutable execution results containing exact task-lock outcomes, aggregate usage,
  provider identity, and the final run-control snapshot.
- Added finished, classified failure, budget-exhaustion, and caller-cancellation normalization.

### Improvement

- Added configuration-owned executor failure classifications and fallback messages.
- Added fail-closed unavailable-cost handling, untrusted custom-provider descriptor/response
  validation, authenticated task provenance, immutable option snapshots, late-cancellation
  normalization, safe error text, void normalization, and pre-invocation option, input, identity,
  and budget validation.
- Added public-seam tests with complete runtime line, branch, and function coverage plus structural
  execution documentation.

### Impact

TypeScript applications can now execute deterministic bodyless task fixtures end to end through
the static provider while enforcing schemas, resource limits, cancellation, and inspectable
terminal results. Durable run-ledger persistence remains a separate next slice.

## [0.19.0] - 2026-08-10

### New Feature

- Added provider-neutral `ModelProvider`, descriptor, structured request/response, and
  per-invocation usage contracts.
- Added `createStaticProvider` for single-pass deterministic exact request/response cassettes.
- Added configuration-owned `StaticProviderRequestMismatchError` and
  `StaticProviderExhaustedError` with stable codes and cassette positions.

### Improvement

- Added closed descriptor-safe validation, canonical immutable snapshots, exact request matching,
  pre-abort preservation, and fail-closed cassette consumption semantics.
- Added provider protocol compatibility locking and exhaustive public-seam tests for invocation,
  validation, cancellation, mismatch, exhaustion, immutability, and configuration drift.

### Impact

TypeScript applications can now run reproducible offline provider fixtures through the same
structured boundary intended for future live adapters, without credentials, network access,
fallback generation, or hidden mutable reset behavior.

## [0.18.0] - 2026-08-10

### New Feature

- Added `createRunControl` for cooperative turns, effects, duration, token, and cost budgets.
- Added composed caller `AbortSignal` cancellation, pre-abort handling, active-control disposal,
  and typed `RunBudgetExhaustedError` and `RunCancelledError` reasons.
- Added immutable active, exhausted, and cancelled snapshots with cumulative resource consumption
  and first-terminal-transition semantics.

### Improvement

- Added configuration-owned budget metric precedence, control statuses, reason discriminants,
  stable cancellation text, and safe Node timer bounds.
- Added closed validation, safe-integer and finite-cost overflow protection, timer/listener cleanup,
  and public-seam tests for every metric, race, duration, cancellation, and malformed input path.

### Impact

TypeScript execution adapters can now share one fail-closed signal across providers and effects,
distinguish budget exhaustion from caller cancellation, and preserve observed partial consumption
without claiming that arbitrary asynchronous work can be stopped forcibly.

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
