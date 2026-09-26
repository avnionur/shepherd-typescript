# Implementation Tracker

Last updated: 2026-09-25

Current version: `12.0.0`

Current level: L4 "1.0" as a private, unpublished source release with owner waivers (#199, 2.34.0; [2.34.0 addendum](./phase-11-exit-audit.md#owner-decisions-and-10-close-out-2340)): no external review, no signing or publication, hosted CI disabled with local macOS gates and a local Docker Linux lane as the substitute, CodeQL and the advisory form waived while private, no Windows lane; Phase 11 in-repo scope complete (2.33.1 close-out addendum). L3 paper programming-model parity and research applications reached for the documented scope — Phases 4–10 complete for the documented scope (Phase 10 closed by the [exit audit](./phase-10-exit-audit.md))

## Current position

Phase 0 governance and repository foundations are established. Phase 1 trace-kernel work is
complete: canonical records, envelopes, append planning, SQLite durability, content-addressed blob
storage, storage receipts, blob integrity verification, immutable cuts, and causal-slice queries
and configured execution-history projections are implemented. Whole-store verification and append
recovery diagnosis, native trace interchange, and verified blob-orphan collection are also
implemented. Phase 2 now includes configured bodyless task descriptors, runtime input/output
schemas, exact artifact locks, and durable exact task-version registration and resolution.
Versioned immutable effect intent/outcome records now provide configured reversibility tiers and
exact content-bound correlation. Immutable ordered handler stacks now provide exact-kind,
last-matching in-process dispatch with validation before invocation. Versioned terminal run
outcomes now represent finished, failed, exhausted, and cancelled runs with exact task-lock
provenance. Immutable ordered run artifacts retain inline text or cite durable blob receipts, and
aggregate run usage records retain token and optional cost totals independently of terminal
status. Configured run controls now accumulate counter consumption, enforce duration limits, and
compose caller cancellation through a first-terminal-wins `AbortSignal`.

The provider-neutral model boundary now exposes immutable descriptors and structured invocation
values. Its deterministic static provider consumes exact cassettes, cooperates with cancellation,
and fails closed with configured typed errors on mismatch or exhaustion.

The offline bodyless task executor now maps validated task inputs and exact output schemas into
provider requests, accounts observed usage through run control, validates provider responses and
task outputs, and returns immutable finished, failed, exhausted, or cancelled results. Durable
execution now retains validated creation and actual start boundaries, aggregate observed usage,
executor-produced ordered artifacts with verified blob receipts, the exact terminal outcome, its
lifecycle projection record, and an immutable terminal cut in the trace store. Equal deterministic
retries replay without duplicating records. Durable recovery now
classifies absent, created, started, terminal-pending-cut, and committed states; reconstructs exact
committed results without provider invocation; requires explicit command authority to resume safe
pre-start creation or repair a missing terminal cut; and fails closed when invocation may already
have occurred.
Durable invocation admission now uses expiring first-writer leases and monotonic fencing tokens;
an expired pre-start claimant can be replaced, while stale or already-started writers are rejected
atomically before provider invocation.
Disposable durable execution inspection views now expose every recovery state with lifecycle,
ordered artifact, usage, outcome, immutable-cut, and direct causal-edge evidence derived from the
canonical record graph. Inspection performs no append, provider invocation, or state repair.
Configured durable recovery commands now carry globally idempotent identities and canonical
command records. They causally bind and exclusively authorize expired-lease pre-start recovery and
terminal-cut repair while absent or uncertain started runs remain fail-closed.
Configured pause requests now use the same global command-identity authority, atomically compare
the exact current started lifecycle head and invocation fencing token, and retain a canonical
reason-bound command without changing the lifecycle or releasing the worker lease.
Ordered checkpoint adapters now classify every configured continuation constituent without store
mutation. At a proven safe boundary, command-authorized suspension atomically publishes the
continuation descriptor and acknowledgement, releases the worker claim, and fences any returning
worker from terminal publication.
Globally idempotent resume commands now bind the exact waiting or suspension acknowledgement and
continuation descriptor, reject unavailable constituents, require exact independently verified
prerequisite-satisfaction evidence for waiting, atomically acquire the next monotonic worker fence,
and publish a command-bound running acknowledgement across store reopen and connection races.
Globally idempotent direct cancellation now binds exact created, waiting, or suspended lifecycle
heads, atomically rejects authoritative workers, appends command-bound cancelled terminal
evidence, expires pre-start claims, and preserves deterministic replay and stale-worker fencing.
The proposed normative lifecycle now distinguishes prerequisite-driven `waiting` from
control-driven `suspended`, keeps recovery as an orthogonal evidence classification, and requires
verified continuation constituents before either state can return to `running`. Its configured
transition matrix, continuation descriptor, waiting acknowledgement, and suspension
acknowledgement are now published as versioned schemas with a pure public transition validator.
Read-only durable inspection validates cut-bound waiting and suspension evidence plus exact
resumed-running command/fence evidence without mutation. Prerequisite-driven waiting now atomically
publishes cut-bound continuation and prerequisite evidence, releases the worker claim, fences stale
terminal publication, and resumes only with matching satisfaction evidence.
The Appendix B executable reference boundary now validates configured single-root Core-A
typed-effect lifecycles against pinned upstream Core-0/Core-A vectors and classifies complete or
live-prefix evidence conservatively. Missing, malformed, unsupported, or inconsistent evidence
at the reference boundary remains runtime-only, while accepted traces receive
reference-validation authority. Missing, malformed, unsupported, stale, or untrusted strong
evidence cannot strengthen or weaken that accepted reference claim.
Allowlisted Core-0, Core-A, and Core-0H lowering manifests now bind exact upstream generator
repository, path, revision, case, program, and generated trace. The classifier emits configured
imported theorem claims only for Core-0 and Core-A. Exact theorem metadata is pinned and
drift-checked, while local Lean execution is explicitly out of scope. Core-0H sidecars are
structurally and content-addressedly validated but cannot strengthen a claim until a published
sidecar reference is configured as trusted.
The Phase 2 exit audit now maps every criterion to public production-seam evidence. It adds exact
native-trace byte comparison around deterministic replay and whole-store integrity checks for
pre-invocation cancellation and exhaustion. The audit also moves runtime-grant identity to Phase 4,
where grants are actually introduced, and does not overclaim durable effect-boundary admission.
Phase 3 now begins with protected workspace initialization. Configured `none`, `git-head`, and
`worktree` modes retain versioned baseline citations under `.vcscore`; worktree identity covers
ordinary directories, file bytes, executable bits, and symlink targets while excluding Git and
control metadata. Initialization may create an unborn Git repository but never invents a commit or
rewrites existing history, and reopen fails closed on malformed or unavailable evidence.
Canonical binding validation now reopens that protected workspace, resolves names to stable
content-addressed authority identities, rejects missing or escaping roots, and rejects equal or
nested canonical roots in either declaration order before returning any authority.
The workspace protocol v3 reference copy carrier now revalidates exact bindings, retains
content-addressed immutable revisions away from user files, forks isolated mutable custody,
reopens and verifies both forms after restart, rejects unsupported or escaping filesystem
semantics, and performs exact idempotent custody discard without deleting the parent revision.
Workspace protocol v19 now closes the platform/fault gate with configured public policy inspection,
fail-closed ACL/xattr/resource-fork/alternate-stream probes, portable case collision and
`core.symlinks=false` placeholder rejection, actual sparse-index evidence, stable deterministic
permission/capacity/mutation/interruption errors, receipt-safe carrier and settlement recovery,
and a mandatory reference-suite parity gate for any optimized carrier.
Workspace protocol v4 adds exact Git-aware retained-output bases and protocol v5 now adds pure,
immutable, content-addressed changesets that validate and compare exact copy-world revisions.
Task 6A now lets the reference carrier promote an isolated mutable custody into one verified,
parent-linked immutable revision without reading or changing the user binding. The opaque runner
registration is now implemented as a closed workspace-protocol-v7 handle whose executable
callback remains in a private package registry and whose current enforcement is honestly advisory.
Task 6B.2 now authenticates that handle, issues existing-file authority over isolated custody under
the durable invocation fence, captures successful output, and atomically attaches its verified
world record to the terminal cut. Task 6B.3 now retains the pre-invocation and claim-guarded capture
journal and exposes its validated prefix after restart. Task 6B.4 now adds explicit
command-authorized recovery for pre-execution journal prefixes,
deterministic custody convergence across the carrier/journal boundary, terminal-cut repair,
competing-recovery fencing, cooperative partial-world cancellation retention, and fail-closed
uncertain execution.
Task 7 now adds workspace protocol v11 authenticated read-only changeset inspection: exact path
lookup, bounded canonical pagination, digest-verified retained content reads, bounded text/binary
previews, deterministic exact-content rename/copy projections, and authenticated Gitlink and
symlink-mode presentation. Every projection remains outside immutable workspace protocol v5
changeset identity.
Phase 4 now begins with workspace protocol v20 repository-aware binding authorities. Exact Git
worktree, common-directory, per-worktree directory, object-format, and filesystem evidence extend
the unchanged v2 directory binding with a separate content-addressed resource identity. Multiple
disjoint repositories retain independent custody under one workspace control root; shared linked
worktrees, nested superproject/submodule sets, inexact roots, drift, and forged handles fail closed.
Workspace protocol v24 now adds bounded portable equal/prefix/alias conflict evidence and
path-disjoint three-way application. It binds one exact base/current/candidate/merged plan,
publishes through the existing dependency-scheduled carrier journal, preserves unrelated user and
Git state, converges across interruption/concurrency/restart, and retains applied terminal
citations without consuming overlap refusals.
Workspace protocol v25 now adds receipt-only release. It authenticates the retained candidate and
existing custody, permits current-parent drift, records equal observed basis witnesses, preserves
released custody/readability, and converges across interruption, concurrency, and restart without
publishing or deleting user files.
Task/run ledger projection v1 now adds bounded public task and run list/show APIs with exact,
unique-prefix, and canonical-latest read selectors. It composes exact task/grant locks, durable
lifecycle, usage, artifacts, outcomes, cuts, settlements, and task-world placement/jail/output
evidence while preserving exact-ID-only mutation and import-stable canonical ordering.
Evidence-record projection v1 now adds bounded public retained-output citation, published-cut
trace-revision, and durable recovery-record list/show APIs. Exact/prefix/latest reads expose
cut-bounded output/settlement, graph-shaped owner/causal/witness, canonical command/effect,
lifecycle, and archive-stable claim/fence evidence without performing recovery or repair.
The additive Node-only `./runs` package facade now exposes run builders, structured errors,
budget/cancellation control, provider-neutral task execution, and durable execution, inspection,
recovery, and control APIs. It requires task, provider, and trace authorities from their owning
facades and exports no registry, provider adapter, SQLite constructor, workspace handle, private
codec, migration, or protocol configuration.
The additive Node-only `./workspace` package facade now exposes workspace initialization and
bindings, copy/Git custody and changeset inspection, repository grants, placement/native-jail
evidence, retained-world execution/recovery journals, and exact settlements. It requires explicit
task/provider/run/trace/carrier/runner/grant handles and exports no registry, adapter, run control,
SQLite constructor, low-level trace mutation, private codec, migration, or protocol configuration.
The additive Node-only `./effects` package facade now exposes immutable intent/outcome builders,
exact correlation, ordered exact-kind handler stacks, stable errors, and public types. Handler
callbacks remain explicit, in-process, and non-durable; formal, task/provider/run, trace,
workspace, interception, replay, private validation, and protocol authority remain excluded.
Structured public errors now provide one validated configuration-owned in-memory `code` contract
across every exported error class while preserving class identity, constructors, messages, and
existing causes. Validation `TypeError`, caller callback failures, and unchanged external failures
remain explicitly unclassified; canonical evidence and stable CLI JSON remain closed and redacted.
Repository-built and freshly installed runtime/declaration source maps now have enforced portable
relative paths, no host/temporary paths, and no embedded source content. Installed Node stack
frames map to TypeScript while existing in-memory cause/original-failure propagation remains
intact and durable/CLI serialization stays closed.
The checked-in and packaged generated API reference now indexes all supported entries from
their emitted declarations. It classifies every export as type-only, runtime-only, or
runtime-and-type; retains public signatures, generics, JSDoc, thrown errors, runtime requirements,
and entry-owned authority notes; excludes private/internal declaration members and configured
leakage; and fails ordinary verification or fresh-package conformance on drift.

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
- [x] Implement trace cuts and causal-slice queries.
- [x] Implement execution-history projections.
- [x] Implement whole-store trace integrity verification and append recovery diagnostics.
- [x] Implement identity-preserving native trace export and import with conformance fixtures.
- [x] Implement inspect-first verified blob-orphan collection without deleting retained evidence.
- [x] Implement configured bodyless task descriptors, input/output schemas, and artifact locks.
- [x] Implement durable task registration, version conflict detection, and exact artifact-lock
  resolution.
- [x] Implement versioned effect intent/outcome records and exact content-bound correlation.
- [x] Implement immutable ordered exact-kind effect handler stacks.
- [x] Implement versioned finished, failed, exhausted, and cancelled run outcome records.
- [x] Implement configured ordered run-artifact and aggregate run-usage records.
- [x] Implement configured run budgets and cooperative `AbortSignal` cancellation semantics.
- [x] Implement the provider-neutral request/response contract and deterministic static provider.
- [x] Implement offline bodyless task execution with schema validation, usage accounting, budgets,
  cancellation, and terminal normalization.
- [x] Persist deterministic task execution lifecycle, aggregate usage, terminal outcome evidence,
  and immutable terminal cuts without fabricating effects.
- [x] Reconstruct committed durable executions after restart and safely classify or repair every
  incomplete lifecycle boundary without duplicate provider invocation.
- [x] Audit every paper-v3 section and close plan gaps for proof envelopes, trajectory compression,
  experiment protocols, limitations, and future-work classification.
- [x] Reconcile the agent-runtime architecture study with the capability roadmap, including one
  record-graph authority model, fenced run control, coupled checkpoints, and projection semantics.
- [x] Add cross-connection durable invocation claims, pre-start lease takeover, monotonic fencing,
  and atomic start publication.
- [x] Persist executor-produced ordered run artifacts with verified blob receipts, causal ordering,
  deterministic replay, and exact restart recovery.
- [x] Add cut-bounded read-only durable execution inspection views for every recovery state.
- [x] Add idempotent durable recovery-command identities and command-bound fail-closed transitions.
- [x] Define the proposed normative waiting/suspension lifecycle, continuation-evidence gates, and
  command-authority contract without claiming runtime resumability.
- [x] Publish the configured lifecycle transition matrix and versioned continuation, waiting, and
  suspension schemas with a pure public transition validator.
- [x] Extend read-only durable inspection with cut-bound waiting and suspension evidence while
  preserving the existing recovery classification and v1 execution-history projection.
- [x] Retain globally idempotent pause requests with exact run, current started head, fencing token,
  reason, command-content conflicts, and no lifecycle mutation.
- [x] Add ordered checkpoint constituent adapters and atomic command-authorized suspension
  acknowledgement with unavailable-evidence rejection, worker claim release, and stale-terminal
  fencing.
- [x] Add globally idempotent exact-suspension resume with unavailable-evidence rejection, atomic
  monotonic fencing, command-bound running acknowledgement, reopen replay, and cross-connection
  stale-head races.
- [x] Add globally idempotent running cancellation with exact-head/fence comparison,
  deterministic command conflicts, safe-boundary acknowledgement, atomic terminal claim release,
  interrupted-cut repair, restart replay, and stale-worker terminal fencing.
- [x] Complete public-seam crash/race preservation evidence for lost suspension receipts,
  competing cross-connection cancellation acknowledgements, stale pre-resume controls, and
  verified continuation constituents with missing receipts.
- [x] Add globally idempotent direct cancellation from exact created, waiting, and suspended heads
  with atomic inactive-worker validation, terminal publication, restart replay, corruption
  rejection, and stale-worker fencing.
- [x] Add prerequisite-driven runtime waiting acknowledgement with atomic worker release and
  guarded resume requiring exact independently verified prerequisite-satisfaction evidence.
- [x] Add the configured Appendix B typed-effect reference machine, pinned Core-0/Core-A
  conformance vectors, and fail-closed proof-envelope classifier with explicit runtime non-claims.
- [x] Validate configured strong profiles, allowlisted pinned-oracle static lowering
  manifests, Core-0H two-phase sidecars, and exact theorem-artifact metadata without strengthening
  stale, malformed, unsupported, or untrusted evidence.
- [x] Audit and close every Phase 2 exit criterion at its production seam, correcting the runtime
  grant and durable-effect phase boundaries.
- [x] Add protected workspace initialization and adoption identity with exact reuse, Git-history
  preservation, dirty-worktree fixtures, and fail-closed control metadata.
- [x] Add canonical workspace-contained binding identities with symlink-aware alias handling,
  duplicate-name validation, and symmetric overlap rejection.
- [x] Add the reference copy carrier with verified snapshot publication, isolated mutable forks,
  restart reopen, corruption detection, protected-control exclusion, and exact custody discard.
- [x] Add the Task 4 core Git-aware baseline and retained-output custody slice with exact HEAD/index/sparse/ignore
  evidence, independent Git-object retention, linked-worktree identity, restart verification, and
  semantic basis-movement classification.
- [x] Add the Task 5 canonical copy-world changeset core with carrier-verified revisions,
  reconstructive file/directory/mode/symlink-target changes, canonical identity, immutability, and
  configured input/output limits. Gitlinks, content reads, previews, and move projections remain
  assigned to read-only inspection.
- [x] Add the Task 6A carrier foundation for deterministic parent-linked custody capture, restart
  reopen, user-tree isolation, and direct Task 5 changeset composition.
- [x] Add the Task 6B.1 closed opaque runner registration and configured advisory enforcement
  contract without claiming authentication or granting filesystem/execution authority prematurely.
- [x] Add Task 6B.2 authenticated runner consumption, invocation-fenced existing-file authority,
  isolated successful capture, canonical changeset composition, and atomic terminal-cut world
  evidence without claiming restart recovery.
- [x] Add Task 6B.3 ordered durable capture journaling, fail-closed recovery validation, exact
  terminal attachment, and restart-safe public inspection without claiming automatic retry.
- [x] Add Task 6B.4 command-authorized pre-execution recovery, deterministic custody convergence,
  terminal-cut repair, competing-recovery fencing, cooperative cancellation retention, and
  fail-closed uncertain-writer handling.
- [x] Add Task 7 authenticated read-only changeset inspection, retained content reads, bounded
  previews, derived rename/copy projections, and Git-aware Gitlink/symlink-mode presentation.
- [x] Add Task 8 protocol v12 exact settlement identity and trace-store schema v6 atomic
  consume-once admission with exact replay and conflict refusal.
- [x] Add Task 8 authenticated exact-output preparation across committed execution, cut, capture
  journal, binding, carrier revisions, changeset, and custody before consume-once admission.
- [x] Complete Task 8 with restart-safe read-only settlement inspection and authenticated
  cross-connection one-winner/conflict evidence.
- [x] Close Task 9.1 deterministic operation, receipt, state-transition, schema-v7 migration, and
  recovery-classification contract before exposing external effects.
- [x] Add Task 9.2A schema-v7 nullable operation/receipt/cleanup storage while preserving migrated
  schema-v6 prepared decisions without fabricated evidence.
- [x] Add Task 9.2B1 workspace-protocol-v13 deterministic operation and terminal-receipt codecs
  with canonical replay, exact admission binding, and discard basis preservation.
- [x] Complete Task 9.2B2 atomic prepared/applying/terminal journal transitions with exact replay,
  restart validation, skipped-transition refusal, and cross-connection receipt conflict evidence.
- [x] Add Task 9.3 authenticated exact-ID discard with terminal-before-cleanup ordering, idempotent
  carrier cleanup, cleanup-progress retention, and restart convergence after physical deletion.
- [x] Close Task 9.4A reference selection publication, two-basis-check, journaled-path,
  publication-receipt, and crash-repair contract without claiming runtime selection.
- [x] Add Task 9.4B1 workspace-protocol-v14 closed selection plan, ordered step, and terminal
  publication codecs with generated schema, resource bounds, and compatibility lock.
- [x] Add Task 9.4B2A workspace-protocol-v15 dependency-ordered publication schedules without
  redefining canonical changeset identity or workspace-protocol-v14 evidence.
- [x] Add Task 9.4B2B1 authenticated deterministic reference-carrier staging sourced only from
  verified immutable head custody, with exact reopen and corruption refusal.
- [x] Add Task 9.4B2B2A workspace-protocol-v16 dependency-scheduled step and terminal receipt
  evidence without filesystem mutation or reinterpretation of v14/v15 records.
- [x] Complete Task 9.4B2B2B authenticated scheduled reference-carrier effects, durable-prefix
  recovery, third-state refusal, and exact terminal carrier publication.
- [x] Complete Task 9.4B3 public exact-ID selection, two pre-write basis checks, exact carrier
  receipt citation, selected replay, and store-terminal restart repair.
- [x] Complete Task 9.5 workspace-protocol-v17 settlement citations with exact command/operation/
  receipt/terminal trace identity, deterministic citation cuts, import-safe durable inspection,
  interrupted-publication repair, and malformed-evidence refusal.
- [x] Complete Task 10 workspace-protocol-v18 configured protected-path validation across copy and
  Git capture, retained inspection, selection/recovery, and discard cleanup, including normalized
  case/alternate names, symlink aliases, stable versioned errors, and ordinary-path preservation.
- [x] Complete Task 11 workspace-protocol-v19 carrier and Git platform/fault conformance with
  fail-closed host metadata probes, portable case and Git placeholder policy, sparse-index
  evidence, stable deterministic fault boundaries, honest settlement receipts, and optimized
  carrier reference-suite gating.
- [x] Audit every Phase 3 exit criterion at its public production seam, publish the L1-alpha P0
  settlement evidence matrix, correct stale status claims, and preserve explicit Phase 4 and
  platform boundaries.
- [x] Complete Phase 4 Task 1 workspace-protocol-v20 named multi-repository binding authorities,
  per-resource Git custody receipts, exact reopen/movement evidence, linked/nested boundary
  refusal, pinned-oracle claim limits, and ordinary Phase 3 binding preservation.
- [x] Complete Phase 4 Task 2 workspace-protocol-v21 explicit repository task-grant companion
  identity, exact multi-resource admission, non-amplifying whole-run ceilings, advisory capability
  enforcement, stale-resource refusal, and exact journal-v10 recovery while retaining v9 readers.
- [x] Complete Phase 4 Task 3 workspace-protocol-v22 platform classification, advisory/auto
  placement resolution, visible fallback, placed journal-v11 recovery, fresh-process replay, and
  explicit jail refusal without claiming native enforcement.
- [x] Complete Phase 4 Task 4 workspace-protocol-v23 authenticated macOS Seatbelt and Linux/
  WSL Landlock probes, exact writable-root lowering, structured shell-free launch, durable
  process/quiescence evidence, journal-v12 recovery, fresh-process replay, and fail-closed
  uncertain interruption while retaining journal v1-v3 identities.
- [x] Complete Phase 4 Task 5 workspace-protocol-v24 portable path-conflict inspection, exact
  three-way application plans, protected merged revisions, consume-once applied receipts/citations,
  Git-state preservation, and interruption/concurrency/fresh-process recovery.
- [x] Complete Phase 4 Task 6 workspace-protocol-v25 receipt-only release, current-parent basis
  witnesses, preserved readable custody, consume-once receipts/citations, Git-state preservation,
  and interruption/concurrency/fresh-process recovery.
- [x] Complete Phase 4 Task 7 task/run ledger projection v1 with generated bounded schemas,
  authenticated task-grant companions, composed durable world evidence, exact/prefix/latest read
  selectors, typed failures, incomplete-state honesty, and reopen/import-stable ordering.
- [x] Complete Phase 4 Task 8 evidence-record projection v1 with generated closed output/trace/
  recovery schemas, cut-bounded citations and slices, canonical command effects, exact/prefix/latest
  reads, incomplete/post-cut exclusion, and archive/fresh-process reconstruction.
- [x] Complete Phase 4 Task 9 orphaned-operation repair with pinned v0.3.0 semantics, store schema
  v8 bookkeeping, externally proven session death, bounded closed diagnosis/command/receipt
  schemas, exact idempotent two-phase repair, scope/provider/live refusal, fail-soft pre-run
  reclaim, and reopen/import/concurrent/interruption evidence.
- [x] Complete Phase 4 Task 10 configured `shepherd-ts` command groups with bounded help/human
  output, protected initialization, read-only diagnostics, run/task ledgers, exact settlement and
  repair delegation, fenced/unsupported remedies, source/fresh-process/package-bin tests, and no
  stable-JSON claim.
- [x] Complete Phase 4 Task 11 protocol-versioned canonical CLI JSON with closed bounded success
  and error envelopes, exact evidence IDs, generated command/schema references, preserved 1.46.0
  human bytes, and source/built/packed/installed conformance.
- [x] Complete Phase 4 Task 12 packaged offline quickstart with pinned installed-wheel semantics,
  checked-in/configured demo bytes, deterministic static execution, missing-file creation inside
  isolated custody, retained inspection, exact selection, installed ESM root, and CLI JSON evidence.
- [x] Complete Phase 4 Task 13 read-only retained-output, authenticated changeset/content, and
  native vcs-core CLI views with exact/prefix/latest selectors, configured bounds/errors, closed
  JSON, and installed-package evidence.
- [x] Complete Phase 4 Task 14 configured `run trace-revision` list/show command with human parity,
  distinct stable JSON identity, immutable cut/slice selectors, archive/reopen behavior, and
  installed-package evidence.
- [x] Complete Phase 4 Task 15 exact-run retained-output publication compatibility with idempotent
  native citation verification and fail-closed managed-recovery remedy for insufficient raw CLI
  authority.
- [x] Complete Phase 5 Task 1 ESM-only root/canonical/CLI export map with preserved root API,
  explicit CommonJS/deep-import refusal, declaration/source maps, and fresh consumer type/runtime
  conformance.
- [x] Complete Phase 5 Task 2 additive task-domain facade with descriptor/schema builders, exact
  registry API/errors, bounded task-ledger reads, explicit exclusions, and fresh consumer evidence.
- [x] Complete Phase 5 Task 3 additive provider-domain facade with provider-neutral types,
  deterministic static exchanges, stable errors, explicit execution/tool/credential exclusions,
  and fresh consumer evidence.
- [x] Complete Phase 5 Task 4 additive Node trace-domain facade with append/cut/slice/blob store
  authority, integrity/archive methods, bounded evidence projections, explicit exclusions, and
  fresh append/cut/archive consumer evidence.
- [x] Complete Phase 5 Task 5 additive Node run-domain facade with run construction,
  budget/cancellation, provider-neutral offline execution, durable execution/control/recovery/
  inspection, explicit injected authority, and fresh composed consumer evidence.
- [x] Complete Phase 5 Task 6 additive Node workspace-domain facade with initialization/bindings,
  custody/inspection, grants/placement, retained execution/recovery, exact settlement authority,
  explicit exclusions, and a freshly installed facade-composed retained-output consumer.
- [x] Complete Phase 5 Task 7 additive Node effect-domain facade with intent/outcome construction,
  exact correlation, last-matching exact-kind handler dispatch, stable unhandled errors, explicit
  non-durable exclusions, and fresh installed runtime/type evidence.
- [x] Complete Phase 5 Task 8 stable structured public-error codes with validated shipped
  configuration, preserved class/message/cause behavior, accessor-safe in-memory classification,
  complete facade inventory, explicit unclassified failures, and unchanged CLI/evidence redaction.
- [x] Complete Phase 5 Task 9 repository-built and installed runtime/declaration map conformance,
  mapped TypeScript stack evidence, cause/original-failure propagation inventory, no embedded or
  host-path source leakage, and unchanged durable/CLI redaction.
- [x] Complete Phase 5 Task 10 deterministic generated API reference for every supported package
  entry with emitted-declaration provenance, export completeness, type/runtime classification,
  public JSDoc/error/authority contracts, private/internal exclusion, stale-artifact refusal, and
  fresh-package discovery/type evidence.
- [x] Complete Phase 5 Task 11 repository-tooling ownership with thin command adapters, cohesive
  build/protocol/API-reference/release/testing modules, grouped schema renderers, runtime-only
  production output, explicit single-package workspace configuration, and current structure docs.

- [x] Complete Phase 5 Task 12 (#98) packaged TypeScript retained coding with configuration-owned
  scenario data, inferred task inputs, exact offline capture/inspection/selection, read-only reopen
  evidence, manifest-driven installed typechecking/execution, and existing-directory refusal.
- [x] Complete Phase 7 Task 1 (#149) live supervision contract with separate observer/interceptor
  roles, cursor semantics, the dispatch record sequence, policies, leases, and failure table.
- [x] Complete Phase 7 Task 2 (#150) durable and ephemeral cursor subscriptions with canonical
  cursors, backpressure, overflow policy, monotonic acknowledgement, and store schema v10.
- [x] Complete Phase 7 Task 3 (#151) supervised effect interception with ordered decisions, timeout
  policy, admission before materialization, fenced decision leases, recovery classification, and
  store schema v11.
- [x] Complete Phase 7 Task 4 (#152) approval gates, cited context injection, and supervisor
  worker control.
- [x] Complete Phase 7 Task 5 (#153) passive-observation and supervisor-failure conformance and
  the Phase 7 exit audit.
- [x] Complete Phase 8 Task 1 (#155) coupled checkpoint, rewind, and replay contract with the
  session journal, identities, constituent classification, replay rules, and failure table.
- [x] Complete Phase 8 Task 2 (#156) durable replay sessions with fenced step journals,
  prompt/prefix/context identities, cache-hit evidence, recovery classification, and store schema v12.
- [x] Complete Phase 8 Task 3 (#157) coupled checkpoints with coordinated multi-resource world
  images, provider-session and process adapter evidence, and honest classification.
- [x] Complete Phase 8 Task 4 (#158) verified rewind and suffix replay with byte-equivalent
  restoration, recorded-prefix reconstruction, irreversible-effect approval, and imported replay.
- [x] Complete Phase 8 Task 5 (#159) cooperative process checkpoint backend and accurate transparent
  CRIU unavailability reporting.
- [x] Complete Phase 8 Task 6 (#160) divergence and dependency analysis.
- [x] Complete Phase 8 Task 7 (#161) coupled replay conformance, process crash evidence, and the
  Phase 8 exit audit.
- [x] Complete Phase 9 Task 1 (#163) task-as-value, child run handle, delegation, and supervision
  contract with task values, handle commands, authority rules, supervisor operations, provenance
  and approval, result threading, the failure table, and non-claims.
- [x] Complete Phase 9 Task 2 (#164) task values, `schema.task()`, and durable child run handles
  with provider- and program-serviced children, completion records, derived status, reserved
  handle owners, and the `./delegation` package entry.
- [x] Complete Phase 9 Task 3 (#165) authority-preserving delegation with resource attenuation
  through the scope rule, budget attenuation, bounded parent-handle chains, record-proven
  inspection, and the seeded no-amplification law suite.
- [x] Complete Phase 9 Task 4 (#166) supervisor operations: observation over handle and child run
  owners, ordered context injection with a consumed composed-request record, fenced supervisor
  handoff, terminal accept and discard decisions, and retry successors citing the causal replay
  point.
- [x] Complete Phase 9 Task 5 (#167) task revision and synthesis with declared, revised, and
  synthesized provenance, approval gating for model-generated task values, revision retries, and
  execution-boundary evidence.
- [x] Complete Phase 9 Task 6 (#168) retained-result threading with typed result projections,
  bounded delegation trees under handle and supervisor roots, and nested meta-agent isolation
  evidence.
- [x] Complete Phase 9 Task 7 (#169) task-as-value conformance, process crash evidence for a child
  killed before its terminal and between its terminal and completion, the review fix for opening
  command identities reused by handle commands, and the Phase 9 exit audit.
- [x] Complete Phase 10 Task 1 (#171) research applications contract with application manifests
  and protocol identity, the `applications` vocabulary and versioned-append rule, the two-worker
  coding supervisor, counterfactual replay optimization, trajectory compression, the Tree-RL
  adapter, evaluation and baselines, the failure table, and non-claims.
- [x] Complete Phase 10 Task 2 (#172) application manifests and protocol identity, the
  `applications` protocol section v1 with manifest and supervision trace schemas, the two-worker
  coding supervisor over child run handles with inject, handoff, discard/restart, and accept
  policies, the caller-supplied world adapter and `createScopeWorldAdapter`, the repository
  Appendix E experiment definition, and the `./applications` package entry.
- [x] Complete Phase 10 Task 3 (#173) the counterfactual workflow optimizer with affected-suffix
  replay over declared dependencies, the divergence proof, the evaluation gate, candidate lineage
  and a single terminal promotion, the measured `full_replay` comparison, applications protocol v2
  with the `application-cro-candidate-v1` schema, and the versioned Appendix F experiment
  definition.
- [x] Complete Phase 10 Task 4 (#174) Appendix D trajectory compression with a delegated
  compressor, fork-point and hint validation against the retained prefix, rewind restoration and
  suffix replay under the hint, `no_prune` and unavailable-restore refusal, the delegated verifier
  gate between `pruned` and `restored`, the bounded seeded best-of-N control, measured step-count
  ratios, applications protocol v3 with the `application-compression-v1` schema, and the versioned
  Appendix D experiment definition.
- [x] Complete Phase 10 Task 5 (#175) the §5.3 Tree-RL adapter with deterministic trace-selected
  fork points, seeded branched rollouts under per-rollout static cassettes, a caller reward, failed
  rollouts retained and excluded, intra- and inter-branch advantages over completed rollouts, the
  canonical `jsonl_v1` training batch and digest, the `single_rollout` baseline, applications
  protocol v4 with the `application-tree-rl-rollout-v1` schema, and the versioned §5.3 experiment
  definition.
- [x] Complete Phase 10 Task 6 (#176) offline evaluation with `runApplicationEvaluation`,
  `compareApplicationBaseline`, and `validateApplicationEvaluationReport`: every configured
  application and its `no_supervision`, `full_replay`, `no_compression`, or `single_rollout`
  baseline folded into one measured-only `application-evaluation-v1` report with per-metric
  comparisons and published limitations, applications protocol v5, the repository evaluation
  definition and fixtures, and the checked `docs/generated/application-evaluation.json` and `.md`
  artifacts (`pnpm evaluate:applications`, `pnpm check:evaluation`).
- [x] Complete Phase 10 Task 7 (#177) research applications conformance over all four applications
  in one store with the supervisor on real scope custody, manifest schema and protocol proofs, the
  report citing exactly the retained manifests, causal fork and replay evidence and identical
  inspections and batch digest from an imported archive, process crash evidence for the optimizer
  and Tree-RL, and the Phase 10 exit audit.
- [x] Complete Phase 11 Slice 1 (#187) the production hardening contract with the slice map,
  roadmap mapping, per-slice non-claims, and owner-owed register; the normative threat model; the
  internal security review with severity rubric, findings register F-001 to F-009, and external
  reviewer packet; the support policy; incident response with store-corruption and lost-backup
  runbooks; and decisions D-016 to D-018.

Phase 11 has its contract. "1.0" is the L4 maturity milestone, not a package version. The internal
review records no critical finding; the confirmed seed findings are owned by #180 (secrets in
immutable records, SQLite file mode) and #185 (fuzz coverage, archive decode bounds). No runtime,
protocol, schema, or storage change is made by this slice.

- [x] Complete Phase 11 Slice 2 (#179) API and protocol compatibility as a local release gate:
  `config/compatibility-policy.config.json` (baselines, per-entry stability tiers, two-MINOR
  deprecation window, frozen superseded schemas); API and protocol surface extractors under
  `tooling/compatibility/`; baselines and the append-only classified change log under
  `spec/compatibility/`; `pnpm check:compatibility` in `verify` and `verify:serial`;
  `@deprecated` rendering in the API reference. Supply chain: lockfile CycloneDX-shaped SBOM
  (`docs/generated/sbom.cdx.json`, `pnpm check:sbom` in `verify`), unsigned in-toto/SLSA v1
  provenance, a two-build reproducible-build check, `pnpm verify:release`, and an unrun
  `.github/workflows/release.yml`. Docs: compatibility policy and release integrity.

The compatibility policy is enforced locally; builds were already reproducible on the reference
host, so no build change was needed. Signing and publication stay owner-owed (O-2, finding F-010).

- [x] Complete Phase 11 Slice 3 (#180) secrets and retention: the `retention` section of
  `protocol.config.json` (named detectors, data classes, a mapping for every configured
  `schemas`/`traceSchemas` family, export dispositions, redacted-archive and report formats,
  limits, scanning modes, owner-only store-file mode) with its reader, compatibility contract, and
  generated constants and schemas; `src/retention/` (`scanSemanticValueForSecrets`,
  `classifyTraceSchema`, `readRetentionPolicy`, `exportRedactedTraceArchive`,
  `verifyRedactedTraceArchive`, `inspectTraceRetention`); the opt-in `secretScanning: "refuse"`
  store option with `TRACE_SECRET_DETECTED` refusal before any write on every append path and on
  import; redacted-archive import refusal with `REDACTED_TRACE_ARCHIVE_ERROR`; the `./operations`
  entry; owner-only SQLite database, WAL, and SHM files (F-003 fixed); and
  [secrets and retention](../docs/secrets-and-retention.md).

Records stay immutable: retention is classification, one-way redacted export, and store rotation.
Scanning is off by default and pattern-based; F-001 is downgraded to Low and accepted with a
threat-model residual row.

- [x] Complete Phase 11 Slice 4 (#181) storage interfaces: the `storage` section of
  `protocol.config.json` (name grammar, value, owner, TTL, and list bounds, durability and status
  vocabularies, SQLite coordinator contract) with its reader, compatibility contract, and generated
  constants; `src/storage/` with the `BlobStoreBackend` and `StorageCoordinator` contracts, the
  memory and filesystem blob backends (the latter wrapping the unchanged `BlobFilesystem`), the
  memory and SQLite coordinators (`IMMEDIATE` transactions over WAL, owner-only file), the
  conformance kits `checkBlobStoreBackendConformance` and `checkStorageCoordinatorConformance`,
  and `STORAGE_ADAPTER_ERROR` / `STORAGE_BLOB_CONTENT_MISMATCH`; exports through `./operations`
  and the root; [storage interfaces](../docs/storage-interfaces.md).

`SQLiteTraceStore` remains the only canonical append store and no cloud adapter ships (D-018).
Importing `./operations` now loads `node:sqlite`. No finding is owned by this slice.

- [x] Complete Phase 11 Slice 5 (#182) backup, restore, and migration: the `backup` section of
  `protocol.config.json` (manifest identity, digest, blob-location and failure-reason vocabularies,
  owner-only directory mode, layout names, bounds) with its reader, compatibility contract,
  generated constants, and `store-backup-manifest-v1` schema; `src/operations/`
  (`backupTraceStore`, `verifyTraceStoreBackup`, `restoreTraceStoreBackup`,
  `replicateTraceStoreBackup`, `fetchReplicatedTraceStoreBackup`, `TRACE_STORE_BACKUP_ERROR`); the
  `shepherd-ts store` group (`verify`, `backup`, `restore`, `export --redacted`, `import`) with
  additive `cli-output-v1` branches and installed probes; migration drills for every store schema
  1 through 12 with golden export digests, downgrade and backup-upgrade-restore drills; and
  [backup, restore, and migration](../docs/backup-restore-and-migration.md) with runbooks linked
  from incident response.

The schema stays forward-only; downgrade is restoring a pre-upgrade backup or a known-format archive
round trip. Restore never overwrites and reports success only after a read-only re-verification.
F-003's backup part is closed. Drills run on the reference host only.

- [x] Complete Phase 11 Slice 6 (#183) scale and performance: `SQLiteTraceStore.maintain`
  (`inspect`, `checkpoint`, `optimize`, `vacuum`; `TRACE_STORE_READ_ONLY` on read-only handles;
  `kernel.store.maintenance` configuration) and `shepherd-ts store maintain`; hot-path SQL in
  `src/store/statements.ts` with `EXPLAIN QUERY PLAN` tests; index-only store schema v13 removing
  the `listOwnersBySchema` and `listCuts` full scans; append planning by primary key instead of a
  per-append load of every record identity and owner ordinal; the bounded scale tier; the kernel
  benchmark, SLO configuration, committed reference-host artifact, `pnpm bench:kernel`, and
  `pnpm check:slo` in `verify:release`; and the [performance report](../docs/performance-report.md).

SLO budgets hold only for the macOS arm64 APFS reference class, with threefold headroom over two
measured runs; other hosts and optimized carriers are unmeasured (O-3). No finding is owned by
this slice.

- [x] Complete Phase 11 Slice 7 (#184) observability: the `observability` section of
  `protocol.config.json` (batch identity, attribute namespace, body modes and handlings, identifier
  derivation, OTLP wire constants, resource attributes, run-span lifecycle schemas, semantic
  conventions, bounds) with its reader, compatibility contract, generated constants, and
  `telemetry-batch-v1` schema; `src/observability/` (hand-written OTLP/JSON subset types,
  deterministic mapping, `createTraceTelemetryExporter` over `openTraceSubscription` with
  acknowledgement only after sink success, `createJsonLinesTelemetrySink`); exports through
  `./operations` and the root; an installed `./operations` telemetry probe; and
  [observability](../docs/observability.md).

Telemetry is never canonical: exporting leaves `exportTrace` byte-identical, times are exporter
observation times (D-014), and bodies are withheld unless the retention policy allows them. The
slice records F-011 (telemetry leakage) as an accepted Low residual with threat-model rows.

- [x] Complete Phase 11 Slice 8 (#185) fuzzing: `test/support/prng.ts` (mulberry32, shared with
  the scope and delegation law suites), `test/fuzz/` (mutators, harness and shared oracle, 23
  targets across canonical encoding and validation, archive decode and import, the redacted
  verifier, receipt and backup-manifest decoders, `runCli` argv, world paths, changesets against a
  reference model, selection-publication codecs, placement, repository-grant, overlay-mount, and
  native-jail evidence, and provider and application readers; telemetry skipped with reason),
  `config/hardening-suites.config.json` (`fuzz` section), the replayed corpus in
  `test/fixtures/fuzz-corpus/`, `pnpm fuzz` (`scripts/fuzz-cli.ts`), configured
  `kernel.interchange.limits` with `TraceArchiveLimitError`, `workspaces.gitInvocation` with
  `src/workspace/git-command.ts`, the host-independent `classifyOverlayMountInfo`, and
  [fault and fuzz conformance](../docs/fault-and-fuzz-conformance.md) (fuzz part; faults reserved
  for #186).

F-002, F-004, and F-005 are fixed (F-005 with an accepted `PATH` residual). The suite found F-012
(RangeError on deep nesting), F-013 (repeated-key parser differential), F-015 (manifest error
class), and F-016 (stack- and JIT-dependent canonical acceptance of deep nesting); seed
construction found F-014 (append admits a non-witness `witness_ref`). F-012, F-013, and F-015 are
fixed with corpus cases; F-014 and F-016 are Low and open for #29. Extended run: seed 185185,
410,400 cases, 0 findings, 188.7 s on the reference host.

- [x] Complete Phase 11 Slice 9 (#186) fault and soak suites: `test/faults/` (deterministic
  workload and child launcher, the looping `test/fixtures/fault-process.ts` writer, the recovery
  classifier), seeded `SIGKILL` during append, blob put, cut publication, import, backup, and
  vacuum; disk full through `max_page_count` and a `ulimit -f` child; the opt-in macOS
  `pnpm test:faults:volume` suite; seeded page, WAL/SHM, blob, stray-file, and backup corruption
  against a golden export and read surface; the mixed soak (`test/faults/soak.ts`, bounded in
  `pnpm test`, `pnpm test:soak` through `scripts/soak-cli.ts`); the `faults` and `soak` sections of
  `config/hardening-suites.config.json`; and the fault section of
  [fault and fuzz conformance](../docs/fault-and-fuzz-conformance.md#faults-and-soak) with crash
  and disk-full runbooks in [incident response](../docs/incident-response.md).

Every started operation after a kill or injected write failure was classified complete,
retryable, or refused; no intent needed manual recovery. The suites found F-017 (SQLite's own
rollback after `SQLITE_FULL` or an I/O error made the store report "cannot rollback"; fixed by
rolling back only open transactions), F-018 (malformed append-intent batch digests passed every
check and were exported; fixed, with an accepted well-formed-digest residual), F-019 (a killed
import leaves its staging directory in the OS temporary directory; Low, open for #29), and F-020
(write-ahead-log loss rolls the store back to an earlier commit; accepted SQLite residual).
Recorded soak (`pnpm test:soak --duration 720`, seed 186186, macOS arm64, Node 24.17.0): 722.1 s,
2,537 operations (1,731 append intents, 537 blobs, 269 cuts), 41 kill cycles (3,230 complete, 24
retryable, 11 refused), 26 verified backups, 59 maintenance passes, 369 telemetry batches covering
all 13,544 record occurrences, 51 invariant checks, all passed. Page-flip sweep over seeds 1 to 64:
3,072 cases, 1,701 recovered, 1,296 detected, 75 refused, no silent difference.

- [x] Fix the independent internal review findings on the Phase 11 work and decide the #29-owned
  findings (2.32.2): `git-head` custody writes HEAD from `git ls-tree`/`git cat-file --batch`
  (F-021); the compatibility gate classifies version markers and API changes per artifact,
  fingerprints `cli.commandOptions` and identity settings, refuses stale declarations, and uses
  `deprecation.lastReleasedVersion` (F-022); store file-mode tightening is `O_NOFOLLOW`/`fchmod`
  (F-023); restore publication, replication re-reads, and backup database opens are hardened
  (F-024, F-026, F-027); secret-finding digests are per-process HMACs (F-025); append refuses a
  non-witness `witness_ref` (F-014); import stages beside the target store (F-019). F-016 stays
  open as a protocol decision; F-028 (`git status` clean filters in worktree custody, Medium) is
  recorded open. See the [security review](./security-review.md) and
  [threat model](../docs/threat-model.md).
- [x] Fix F-028 (2.32.3): `worktree` custody's dirty-submodule check compares gitlink, submodule
  HEAD, index, and HEAD tree with `rev-parse`/`ls-tree`/`ls-files` and hashes worktree blobs in the
  runtime instead of running `git status`, so no repository clean or process filter runs during
  capture; every other Git invocation under `src/workspace` audited (no filter, hook, textconv,
  diff driver, credential helper, or pager path).
- [x] Complete Phase 11 audit (#29) the project-wide 1.0 readiness audit (2.32.4): the
  [Phase 11 exit audit](./phase-11-exit-audit.md) (twelve work items and five exit criteria with
  delivery, entry points, docs, tests, and outcome; recovery classification; independent review;
  verification; limits; recommendation on #24 and #29), the
  [release-readiness dashboard](./release-readiness-dashboard.md) (Phase 0 to 11 epics, 99 parity
  rows, 18 paper-coverage rows), the [release-candidate manifest](./release-candidate-manifest.md),
  the [1.0 release notes](../docs/release-notes-1.0.md), the register's 1.0 gate result, and the
  threat model's completed residual table.

Phase 11 verdict: release candidate ready for the in-repo scope; 1.0 general availability is
no-go until the owner-owed rows close: external security review (O-1), signing, attestation, and
publication (O-2), hosted CI and cross-OS lanes (O-3), private vulnerability reporting (O-4), and
the registry name (O-5). The internal register has no unresolved critical or high finding; F-016
(Low) stayed open as an owner protocol decision until #189 fixed it in 2.33.0, and F-029 (Low, found by the audit: concurrent
first opens of a new SQLite database fail closed and make the process-race test intermittent) is
open for a follow-up PATCH before the candidate is tagged.

- [x] Fix F-029 (#29 follow-up, 2.32.5): the journal-mode switch of the trace store, task
  registry, and SQLite storage coordinator retries SQLite's deadlock-avoidance `SQLITE_BUSY`
  within the configured busy timeout; trace-store and task-registry migrations read the schema
  version inside each configured `IMMEDIATE` migration transaction; blob-directory creation
  tolerates a concurrent `mkdir`; the process-race test reaps every child on failure and adds a
  multi-process concurrent-first-open test for all three handle kinds. Probes: 0 failures in
  4,000 process starts.
- [x] Fix F-016 (#189, MINOR 2.33.0, owner decision 2026-09-19: a configured bound): the canonical
  value domain has `kernel.canonicalization.maxNestingDepth` (1,000) and `framingDepth` (8) for
  kernel framing around whole record bodies, validated at load and fingerprinted by the
  compatibility gate; the encoder normalizes and serializes with explicit stacks and refuses one
  level past the bound with `CanonicalNestingLimitError` (`CANONICAL_NESTING_LIMIT_EXCEEDED`) at
  any call-site depth; validators pass the classified error through; append, import, and archive
  decode refuse before any write; fuzz mutators and corpus cover the bound relative to
  configuration, and the oracle re-encodes below 4,000 caller frames. The register has no open
  finding; F-016 keeps an accepted residual for pre-2.33.0 stores holding deeper bodies.
- [x] Phase 11 close-out (#190, PATCH 2.33.1): local Docker Linux lane (Debian bookworm arm64,
  unprivileged user) runs every `pnpm verify` gate on Node 24.21.0 and 24.12.0, plus runtime
  boundaries, the extended fuzz run, and the privileged `pnpm test:carriers:linux`; it found F-030
  (fault-suite `ulimit -f` units and child coverage truncation made `pnpm verify` fail on Linux)
  and F-031 (`fs.rmSync` keeps dangling symbolic links on Node 24.12.x and 24.13.x), both fixed
  with tests (`removePathSync` for every product removal), and F-032 (packed file set depends on
  the npm version, open for #191). The [exit audit addendum](./phase-11-exit-audit.md#linux-verification-lane-and-close-out-2331)
  records the lane, the F-016 resolution, and the re-scoped verdict: Phase 11 in-repo scope
  complete; O-1, O-2, O-4, O-5 and the hosted-CI, Windows, Linux-volume, and SLO parts of O-3 move
  to #191; epic #24 closes on merge.
- [x] Phase 11 close-out Linux follow-up (#190, PATCH 2.33.2): the JSON-lines telemetry sink
  serializes with the internal explicit-stack `serializeJsonText` (`src/canonical/json-text.ts`,
  byte-identical to `JSON.stringify` for plain data, shared with the canonical encoder), so an
  included body at the canonical bound (about 4,000 OTLP levels) is written on Linux, where native
  `JSON.stringify` refused it; `pnpm verify` is green on Linux on Node 24.21.0 and 24.12.0.
- [x] Owner actions for 1.0 general availability, in-repo slice (#191, PATCH 2.33.3): F-032 fixed
  (top-level `files` entries anchored with `/`; `tooling/release/packed-files.ts` checks literal,
  anchored entries and the packed file set in `pnpm test:package-cli`; npm 11.19.0 and 12.0.2 pack
  the same 1,406 files and identical tarballs); owner decisions of 2026-09-23 documented: email
  vulnerability intake while the repository is private (F-009 resolved), registry name
  `@avnionur/shepherd-typescript` (D-011), a hosted-CI enablement attempt blocked by an account
  billing limit and the workflows disabled again, CodeQL unavailable without GitHub Advanced
  Security; [owner release runbook](../docs/release-integrity.md#owner-release-runbook) added; the
  [#191 addendum](./phase-11-exit-audit.md#owner-actions-2333) keeps the verdict conditional.
  O-1, O-2, the hosted parts of O-3, the advisory form (O-4), and the name reservation (O-5) move
  to #199.
- [x] Owner decisions and 1.0 close-out (#199, MINOR 2.34.0): the owner closed #199 by decision
  (D-019): external review (O-1), signing and publication (O-2), and name reservation (O-5) waived
  for 1.0; hosted CI stays disabled and the local macOS gates plus the local Docker Linux lane are
  the substitute (O-3, F-008 accepted); CodeQL and the advisory form waived while private; F-010
  accepted; `windows-latest` and the Windows `verify:serial` step removed from `ci.yml`. In-repo:
  Linux variant of `pnpm test:faults:volume` (ext4 loop image from
  `faults.diskFull.volume.linux`, root and loop devices required, explicit skip otherwise; passed
  in a privileged `node:24.21.0-bookworm` container) and SLO host class
  `linux-arm64-overlayfs-container` (budgets from two container runs, artifact
  `docs/generated/benchmarks/linux-arm64-overlayfs-container.json`). Verdict: 1.0 as a private,
  unpublished source release with those waivers
  ([addendum](./phase-11-exit-audit.md#owner-decisions-and-10-close-out-2340)).
- [x] Paper v3 re-audit, npm readiness check, and GitHub Release workflow (MINOR 2.35.0): the
  section-by-section audit filed paper gaps #204-#219 under epic #202 and added the
  [known deviations](./paper-coverage.md#known-deviations-2026-09-25-audit-2340) table; a local
  npm check (pack, publint, attw, strict ESM consumer, CLI, Node range) filed owner blockers and
  consumer items #221-#228 under epic #220; README corrected and extended; `release.yml` gains a
  tag trigger, version gate, a `github-release` job attaching the verified package and evidence,
  and a private-package refusal before npm publish (actionlint clean; not run on hosted runners).
- [x] README restructure (PATCH 2.35.1, docs only): consumer-first layout with concepts, status,
  paper coverage, installation, a verified quick start, package entries, grouped docs, development,
  and releases; historical inventories moved to existing changelog, tracker, and docs index.
- [x] Paper v3 audit #205 (MAJOR 3.0.0): task schemas widened with `number`, `integer`,
  `boolean`, `null`, `array`, `enum`, `literal`, `union`, and `optional` builders with static
  inference and path-level `JSONSchemaValidationError` refusals (`SCHEMA_VALIDATION_FAILED`);
  `schema.fromJSONSchema` and the published task descriptor schema accept the matching documents;
  existing artifact locks unchanged. New reusable
  [`compileJSONSchema`](../docs/json-schema-validation.md) validator; application protocols
  refuse schema surfaces outside its subset and evaluate supervisor observation/action messages,
  compression proposals, the CRO handoff manifest (`receipt.handoff`), and Tree-RL batch lines
  against their pinned schemas. Breaking: protocols with unsupported schema vocabulary and
  decisions their action schema refuses are now refused.
- [x] Paper v3 audit #207 (MAJOR 4.0.0): counterfactual candidates declare a required edit
  `scope` (`request` or `downstream`, `applications.cro.editScopes`, applications protocol v6,
  `APPLICATION_CRO_EDIT_SCOPES`); a `request` edit replays from the boundary before the edited
  step, so the edited step re-executes and diverges as `root` (a final-step edit replays one live
  step, a step-0 edit targets boundary zero with a `null` prefix), and a `downstream` edit keeps
  the first-dependent target. Retained plans carry `edit_scope`, which enters the candidate
  identity; the candidate record schema admits target step 0. Evaluation report regenerated
  (counterfactual compared calls 2 -> 7 against the unchanged full-replay 8).
- [x] Paper v3 audit #208 (MAJOR 5.0.0): trajectory compression admits fork step 0 (restart
  from the initial prefix with the hint; `prefix_id` null), resolves an out-of-range step under
  the configured `applications.compression.forkStepPolicy` (`clamp` to `[0, n - 1]` retained as
  `fork_clamp`, or `reject`; applications protocol v7, `APPLICATION_COMPRESSION_FORK_STEP_POLICIES`),
  and settles a missing fork step (absent fork point or `step_index`, hint-only) as `no_prune`.
  Evaluation report version 2 carries `rescues { count, experiment_ids }` (baseline failed,
  application passed), re-derived by the validator; the repository measures zero rescues
  (`rescue-scope` limitation). Compression records and v1 reports from 4.0.0 no longer decode.
- [x] Paper v3 audit #204 (MINOR 5.1.0): provider kinds are configured (`providers.kinds` and
  `providers.live.kinds`, provider protocol v2, generated `PROVIDER_KINDS`); `createLiveProvider`
  implements the Anthropic Messages dialect (`cache_control` on the last prefix message, cache
  read/creation tokens in usage) and an OpenAI-compatible dialect for OpenAI and OpenRouter, with
  an injectable transport (default global `fetch`), `AbortSignal` cancellation, `LiveProviderError`,
  and credential redaction; a provider-neutral multi-turn message model (`converse`) prepares the
  #206 tool extension; `createProviderConversation` supplies a replay provider-session adapter that
  resends a byte-identical message prefix after rewind. Evidence: stub-transport tests, a
  whole-store secret scan, and replay byte-identity and simulated cache-hit tests
  ([live providers](../docs/live-providers.md)). The opt-in live cache test was not run (no
  credentials); no live cache-hit rate is measured.
- [x] Paper v3 audit #206 (MAJOR 6.0.0): messages carry `tool_use` and `tool_result` blocks and
  `ModelConversationRequest` optional `tools` (provider protocol v3, `PROVIDER_PROTOCOL_V3_CONTRACT`);
  both live dialects map tool definitions, calls, and results under configured per-kind
  `toolUse` settings and declare `tools: true`; `createProgramConversationProvider` scripts
  tool-calling turns. `runToolLoop` turns every schema-valid tool call into an intent/outcome effect
  through a handler stack, supervised dispatch, or replay session (configured turn bound,
  guidance between turns, turn observer, abort signal); deny-before-outcome and byte-identical
  replay over a recorded prefix are tested. `providers.tools.metaAgent.tools` declares observe,
  fork, discard, rewind, replay, read-trace, and diff, and `createMetaAgentTools` backs them with
  replay inspection, scope-world fork/discard, rewind, replay, owner reads, and divergence
  analysis; the Figure 1 fork/observe/revert/retry scenario passes end to end with a scripted
  model ([tool-use loop](../docs/tool-use-loop.md)). Breaking: `ModelContentBlock` is a union of
  three block kinds. No live model ran the loop (no credentials).
- [x] Paper v3 audit #209 (MAJOR 7.0.0): per-kind compensation handlers
  (`createEffectCompensationRegistry`); `discardScope`, `rewindReplaySession`, and
  `replayReplaySession` compensate every successful compensable effect they abandon exactly once,
  in reverse materialization order, keyed by the original materialization (replay effect step or
  supervised dispatch resolution) so all triggers share one compensation; intent, attempts, and
  outcomes are retained as `shepherd.effect.compensation.v1` records on a reserved owner path
  (effect protocol v2). Evidence: node:sqlite row-insert fixture with an idempotent delete, a
  SIGKILL suite, deterministic kills after the world change and after the outcome, and tool-loop
  compensation ([effect compensation](../docs/compensation.md)). Breaking: discard and branches
  refuse uncompensated compensable effects without a handler. No compensation lease or waiver.
- [x] Paper v3 audit #210 (MAJOR 8.0.0): configured automatic checkpoint policies
  (`replay.checkpoint.automatic`, `REPLAY_CHECKPOINT_POLICIES`: `none`, `provider_step`,
  `effect_step`, `every_n_steps`; replay protocol v2, `REPLAY_PROTOCOL_V2_CONTRACT`) selected by
  `checkpointPolicy` on `runReplaySession` and `replayReplaySession` capture the coupled checkpoint
  immediately before each selected step; rewind and replay to every checkpoint of a world-bound
  session restore a world whose tree hash equals the source's at that boundary, and rewind still
  compensates the suffix exactly once. Tree-RL (`bindings` restoration factory) and trajectory
  compression (`workflow.bindings`, `workflow.checkpointPolicy`) accept world- and process-bound
  sources at checkpointed fork points. Storage growth per checkpoint measured by
  `pnpm bench:checkpoints` on one macOS host
  ([coupled checkpoints](../docs/coupled-checkpoints.md#storage-growth-per-checkpoint)). Breaking:
  replay protocol v1 configurations are refused. No Linux measurement.
- [x] Paper v3 audit #216 (MAJOR 9.0.0): run, replay-session, and delegated child-run inspections
  expose a `proof` envelope (`runtime_only` by default); non-runtime claims imported through run
  artifact carrier metadata surface only as `metadata.claimed_proof_backed`; retained-world
  settlement, rewind, replay, and delegation handoff classify as the configured `extension`
  profile; `inspectReplaySession({ lowerProof: true })` lowers eligible static sessions into Core-A
  records classified by the executable reference machine (formal assurance protocol v2,
  `FORMAL_ASSURANCE_V2_CONTRACT`; [inspection envelopes](../docs/formal-assurance.md#inspection-envelopes)).
  Breaking: run-ledger entry inspections require `proof`. Lowering is reference-validated only.
- [x] Paper v3 audit #217 (MINOR 9.1.0): `diffReplaySessions` diffs any set of replay sessions
  against their lowest common lineage ancestor by captured effects; `findFirstReplayRegression`
  runs a deterministic `bisect` or `linear` first-regression search over a session lineage with a
  caller verdict (configured `replay.divergence.maxSessions` and `regressionStrategies`); read-only
  `shepherd-ts replay log/show/diff` and `scope list/show` with stable JSON
  ([N-way diff](../docs/rewind-and-replay.md#n-way-diff), [CLI](../docs/cli.md)). No divergence
  causes in the N-way diff; scopes are not diffed.
- [x] Paper v3 audit #213 (MAJOR 10.0.0): Tree-RL follows Appendix F.6 Algorithm 2 over a batch
  of prompts with `groupSize` G graded roots each; a fork-selection interface returns
  `{ branch_turn, tool_call, reason }` clamped to the configured `[1, T - 2]`, with the
  provider-backed meta-agent selector and the deterministic dependency selector; the proposed tool
  call seeds branch 0; `computeTreeRlAdvantages` gives inter-root and intra-tree advantages with
  per-group standardization (exact-value fixture); the per-action `jsonl_v2` batch, the
  `flat_grpo` baseline, concurrent rollouts with order-independent retained output, and the
  `exportTreeRlBatchToTrainer` seam ([Tree-RL adapter](../docs/tree-rl-rollouts.md)). Applications
  protocol v8. Breaking: the Tree-RL options, records, batch format, and baseline change. No trainer;
  the meta-agent ran only against fixture providers.
- [x] Paper v3 audit #212 (MAJOR 11.0.0): counterfactual optimization runs Appendix F.1
  Algorithm 1: per-example train and dev baselines, N proposer iterations of at most k edits with
  fix and guard sets (caller-supplied or `createToolLoopCounterfactualProposer`, a replayable
  tool-loop session with `read_effect_trace` and `grep_effect_traces`), reflection-schema and
  reflection-contract admission with retried refusals, the configured fractional fix/guard gate,
  dev evaluation with epsilon promotion into a graduate-only pool, dev selection, and the
  per-proposer-session computation-reuse ratio in the manifest
  ([counterfactual optimization](../docs/counterfactual-optimization.md)). Applications protocol
  v9; optional protocol `thresholds`; `minPromotionScore` is a fractional threshold. Breaking: the
  optimizer options, records, statuses, handoff, and exports change. No live provider ran the
  proposer.
- [x] Paper v3 audit #211 (MINOR 11.1.0): the concurrent runtime supervisor
  (`runRuntimeSupervisor`, `inspectRuntimeSupervisorRun`, `createModelRuntimeSupervisorPolicy`)
  runs two or more tool-loop workers concurrently in forked custody while a supervisor ticks at the
  protocol's `tickIntervalMilliseconds` over one live subscription of their streams, builds the
  paper's per-agent snapshot, and applies per-agent batched Appendix E decisions validated against
  the pinned schema and admission rules: `inject` between turns of a running worker with a
  byte-identical prefix, `handoff` with a fresh session (optionally forked from the leader's
  custody through the new `sourceCustodyId` world fork), and `discard` from a clean fork. Ticks are
  retained before they take effect; a rerun completes retained ticks without the policy and
  resumes open attempts byte for byte (SIGKILL and in-process recovery tests)
  ([runtime supervisor](../docs/runtime-supervisor.md)). Applications protocol v10. The round-based
  coding supervisor is unchanged. No live model ran the policy or the workers.
- [x] Paper v3 audit #214 (MINOR 11.2.0): `pnpm bench:scopes` measures `forkScope`/`discardScope`
  latency over three configured world sizes for every conformant carrier, K=4 branch disk, trace
  store, and RSS growth, a per-write mutation-size sweep with a storage-versus-written line fit,
  and per-event record and observe overhead through 200 steps with 0, 1, and 4 observers; every
  revert is hash-checked against the pre-fork state independently of the carrier. Raw samples in
  `docs/generated/benchmarks/scope-benchmark-<host-class>.json`, budgets per host class checked by
  `pnpm check:scopes` (not in `pnpm verify`), and a privileged Linux XFS container lane
  (`pnpm bench:scopes:linux`) with copy, clone, and overlay
  ([performance report](../docs/performance-report.md#scope-forkrevert-and-observation-benchmark)).
  Repository measurements only; no layer-depth sweep (#215) and no bare-metal Linux host.
- [x] Paper v3 audit #215 (MINOR 11.3.0): workspace protocol v27 device layer. Checkpoints
  freeze the writable layer as a named lower layer (`openDeviceLayerWorld`, `checkpoint`,
  `restore`) under a configured depth bound (48, retain 4) with compaction that flattens the
  oldest layers and retires their names; a pluggable `DeviceLayerAdapter` contract with a public
  conformance kit (`checkDeviceLayerConformance`, depth and compaction included); copy, clone,
  stacked-overlay, and reference Docker container (`docker` CLI, config-owned templates, opt-in
  test) adapters; configured fallback ordering that records the adapter used, and the same opt-in
  `backendSelection: "fallback"` for carrier backends (strict stays the default).
  `pnpm bench:device-layers[:linux]` measured overlay checkpoints at 2.06–3.06 ms over 1–128 MiB
  (ratio 1.32) and flat through 48 layers on the Linux lane
  ([device layers](../docs/device-layers.md)). Carrier custody, `forkScope`, and replay world
  images still do not use device layers; no remote sandbox adapters.
- [x] Paper v3 audit #218 (PATCH 11.3.1): research notes for the Appendix A.2 and §6 future-work
  directions under [`.plan/research/`](./research/README.md) (interpretability probes,
  reversible continual learning, substrate-native post-training actions, trace-to-workflow
  compression, safety deployment profile). Not normative, no results; implementation issues only
  after review.
- [x] Epic #202 review fix pass (MAJOR 12.0.0): `schema.void()` refused as an object field and
  required `{type: "null"}` properties rehydrate as `schema.null()` (#205); replay protocol v3
  branch `sourceDisposition` (`compensate` default, `retain`) used by Tree-RL, CRO, compression,
  and the meta-agent `replay` tool (#209); `replay` tool declared reversible and replay-bound
  substrate commands scoped per session (#206); OpenAI-compatible cache marker on tool-only
  prefixes (#204); runtime supervisor settlement-rerun, stop, budget, and decision-schema fixes and
  parent-world merge with lineage rebase (#211); container device-layer single-pass templates
  (#215); recomputed scope SLO budgets (#214); threat model and trust-boundary docs; coverage gaps
  hidden by the parallel coverage merge closed in epic-touched files
  ([close-out](./paper-coverage.md#epic-202-close-out-1200)).
- [x] #232 coverage gate (PATCH 12.0.1, branch `codex/phase-12-232-coverage-merge`): the test
  runner merges raw V8 coverage by summing per-process innermost-range counts
  ([coverage gate](../docs/coverage-gate.md)); `pnpm test` and `pnpm test:serial` flag identical
  sets. The 20 pre-existing gaps are covered by tests or removed as unreachable, and the
  never-loaded `./canonical` and `./cli` facades are now tested.
- [ ] npm readiness, epic #220 (MINOR 2.36.0, branch `codex/phase-13-220-npm-readiness`):
  - [ ] #221 owner publication: prepared only; `"private": true` kept by decision D-020
    (`publishConfig`, prepublish guard, attested packer, trusted publishing, owner checklist in
    `docs/release-integrity.md`); remains open for owner actions (public repository, npm scope,
    trusted publisher, removing `private`).
  - [x] #222 publication metadata, `prepublishOnly` guard, single attested packer, TypeScript
    5.9.3 consumer minimum.
  - [x] #223 packed README links and consumer-first requirements (`packedReadme` gate).
  - [x] #224 CommonJS `require()` for root and every subpath (require(esm)), top-level-await guard.
  - [x] #225 `ConfigurationAssetError` / `CONFIGURATION_ASSET_MISSING`; Rollup ESM and CJS
    fixtures; esbuild recipe verified manually with `npx` esbuild 0.28.2. Pending: in-repo
    esbuild fixture awaits owner approval of an esbuild development dependency.
  - [x] #226 quickstart binds `quickstart-workspace/`; installed flow runs with wall-time and
    retained-state budgets.
  - [x] #227 no source maps and no `@internal` declarations in the tarball.
  - [x] #228 Node 26: range widened to `>=24.12.0 <27`; `pnpm verify` exit 0 on 26.10.0 and
    24.17.0 (2026-09-25, macOS arm64); `pnpm test:runtime-boundaries` exit 0 with 24.12.0,
    26.10.0, and refused 24.11.1; one test assumption fixed (native `JSON.stringify` depth).
    Odd-major Node 25 is admitted by the single-range grammar but unverified; no hosted Node 26
    lane (hosted CI disabled).

Phase 10 is complete for its documented offline scope; the [exit audit](./phase-10-exit-audit.md)
maps every work item and exit criterion to entry points, docs, and tests.
Phase 10 now has its contract. Every application is a composition of existing public delegation,
replay, scope, and provider seams plus one canonical digest-bearing manifest per run: protocol
identity over versioned prompt, schema, and tool surfaces, budgets, seeds, and dataset selection,
artifacts cited by identity, and measured costs folded from observed usage, retained as a
`shepherd.application.manifest.v1` record on a command-derived reserved owner path under a terminal
cut with idempotent repeats. The coding supervisor observes workers through child run handles,
classifies path-overlap conflicts on one bound resource through a caller-supplied world adapter,
and retains inject, handoff, and discard/restart decisions with their cited evidence. The
counterfactual optimizer limits candidates to declared change dimensions at a step boundary,
replays only the dependency-scoped suffix, proves no unexplained divergence, gates promotion on a
targeted evaluation, and measures against `full_replay`. Trajectory compression rewinds to a
compressor-proposed fork point, restores the suffix under a hint, keeps the original on `no_prune`
or verifier rejection, refuses a prune whose checkpoint is unavailable, and runs a bounded best-of-N
control. The Tree-RL adapter selects fork points deterministically from dependency counts, runs
seeded branched rollouts, computes intra- and inter-branch advantages over completed rollouts, and
emits a `jsonl_v1` batch with a stable digest. The evaluation report carries measured values only
and no wall-clock or host data in digest-bearing JSON. No runtime, protocol, schema, or storage
change is made by this slice.

Phase 9 now treats tasks as data. A task value is the canonical `{ artifact, artifact_lock }` pair
with lock re-derivation and descriptor rehydration through the task builder, and `schema.task()`
types a task value as task input or output through a published JSON Schema reference. Child run
handles live on command-derived reserved owner paths, retain the supervisor, parent, task value,
declared provenance, validated input, grant, budget, budget ceiling, derived authority, and depth,
and run provider- or program-serviced children as ordinary durable executions under derived run
identities before a head-compared completion record cites the child terminal and cut. Delegated
authority reuses the scope attenuation rule against a root ceiling or the parent handle's effective
authority, attenuates budgets metric by metric, bounds nesting depth, publishes an origin cut
through the parent handle head, and is re-derived and verified at inspection on reopened, read-only,
and imported stores. Supervisors observe a handle and its child through trace subscriptions, inject
ordered cited context that is folded into the composed provider request `{ input, supervisor_context }`
under a consumption record before the child starts, hand off ownership under head comparison so
former supervisors are refused, discard or accept exactly once with the accepted output digest
retained, and retry a discarded handle through a successor that cites the predecessor, its decision
record, and a retry cut. Task values carry declared, revised, or synthesized provenance; revised and
synthesized values are `approval_pending` until the current supervisor approves, rejection is
terminal for execution, and no path evaluates a task value. Accepted results thread upward as
typed values: `projectChildRunResult` re-validates the retained outcome against the retained
output schema and the accept digest and proves a caller schema by canonical document equality,
and `projectDelegationTree` folds the direct handles under a handle or supervisor root, bounded by
`delegation.limits.maxTreeEntries`, so grandchildren appear only through the values their parents
accepted. A program-serviced child opens grandchildren under its own effective authority and
budget, their records stay on their own owner paths, and discarding the child removes everything
threaded through it from the root's projection.

Phase 8 now runs deterministic session programs as durable replay sessions. Every provider exchange
and effect is a step on the session's owner path under a fenced writer lease, with runtime-derived
prompt, response, prefix, and context prefix identities, observed cache-hit evidence, and admission
before materialization; non-terminal sessions are classified running, interrupted, or
materialization-uncertain and never resumed in place. Programs capture coupled checkpoints that
publish a trace cut and retain coordinated world images as trace-store blobs, provider-session and
process adapter evidence, and the irreversible-effect frontier, each classified so a checkpoint is
atomic only when every constituent is verified. Rewind verifies every claimed constituent before
writing and restores byte-equivalent worlds; replay serves the recorded prefix without provider or
handler invocation when the program issues the exact recorded requests, continues live with a changed
task, provider, or handler stack, and admits irreversible suffix effects only with policy approval.
Divergence analysis classifies root, propagated, and unexplained differences from declared
dependencies. A cooperative process backend captures and restores child processes, and the
transparent CRIU backend reports unavailability accurately.

Phase 6 slice A now registers content-addressed root and child scopes as canonical trace records
with exact parent origin cuts, retains per-resource attenuated ceiling/effective authority,
admits single fenced writers with monotonic tokens, emits validated application data under
globally idempotent commands with replay before liveness validation, reconstructs the same
inspection after reopen or import while refusing mutation on imported evidence, and verifies live
registration rows during integrity scans. The slice is explicitly trace-only.

Phase 6 slice B now forks isolated reference-copy scope worlds of one bound resource from verified
origins of the parent world, retains a prepared journal record before custody, completes under the
parent fence with an honest checkpoint descriptor, converges across restart from receipts, blocks
unknown physical state, and admits atomic multi-scope writer claims.

Phase 6 slice C now merges quiescent children exactly once into parent-managed custody from exact
three-way plans with portable overlap refusal and a single terminal reservation. Publication
converges path by path under the rechecked parent head and fence and completes only on verified
merged content. Selected history integrates exact child occurrences without common-origin
re-addition, and subtree discards seal every open descendant while the parent keeps its current
state. Cleanup removes only custody named by retained fork journals, as progress separate from
the logical decision, with receipt-based recovery across every boundary.

Phase 7 now separates observers from interceptors. Durable and ephemeral cursor subscriptions read
committed records of exact owner paths through a canonical owner-ordinal cursor, apply pull-driven
backpressure with a declared overflow policy, and retain monotonic acknowledgements outside the
record graph so reconnects neither lose nor duplicate acknowledged records. Supervised effect
dispatch retains ordered allow, deny, replace, and pause decisions, declared timeout policy with
irreversible tiers failing closed, an irreversible approval frontier, admission before
materialization, and a terminal resolution under fenced renewable decision leases. Approval
verdicts race fail-closed expiry with one winner, context injections cite retained records as causal
parents, and supervisors reach fenced durable-run control through `./supervision`. Passive
observation leaves exported traces byte-identical.

## Verification required for this slice

Owner decisions and 1.0 close-out (#199): MINOR 2.34.0; Linux volume fault-suite variant, Linux SLO
host class, Windows CI lane removed, owner waivers documented; no public API, protocol, schema, or
CLI change.

- [x] `pnpm sync:version`, `pnpm generate:sbom`, `pnpm generate:api-reference`,
  `pnpm update:compatibility-baseline` (version only)
- [x] `pnpm lint` (0 errors, 2 pre-existing warnings, 1 info), `pnpm typecheck`,
  `pnpm check:sbom`, `pnpm check:api-reference`, `pnpm check:compatibility` (0 changes),
  `pnpm build && pnpm test:package-cli`, `pnpm build:desktop`: pass on 2.34.0
- [x] Before the bump (implementing agent): `CI=true pnpm verify` passes except the known clone
  carrier test (1,102 tests, 1,100 pass, 1 skipped, 100% coverage); `pnpm check:slo` passes on
  macOS; `pnpm test:faults:volume` passes on macOS and as root in a privileged Linux container and
  skips as uid 1000 and unprivileged; `pnpm check:slo` passes in the Linux container
- [ ] Hosted runs: none; waived by owner decision (#199)

Owner actions, in-repo slice (#191): PATCH 2.33.3; F-032 fix and packed file-set check, owner
decisions documented; no public API, protocol, schema, or CLI change.

- [x] `pnpm sync:version`, `pnpm generate:sbom`, `pnpm generate:api-reference`,
  `pnpm update:compatibility-baseline` (version only)
- [x] `CI=true pnpm verify`: every stage through `typecheck` passes; `pnpm test` 1,102 tests,
  1,100 pass, 1 skipped, 1 fail (the known clone carrier test), 100% coverage; `pnpm build &&
  pnpm test:package-cli` and `pnpm build:desktop` pass
- [x] `test:package-cli` passes with npm 11.19.0 and 12.0.2 and fails with the 2.33.2 allowlist
  under both; `npm pack` from both npm versions gives 1,406 files and identical tarballs;
  `pnpm release:reproducible-build` passes. Details in the
  [#191 addendum](./phase-11-exit-audit.md#verification-2333)
- [ ] Hosted runs: none; the 2026-09-23 enablement attempt was blocked by an account billing limit
  (#199)

Phase 11 close-out (#190): PATCH 2.33.1; Linux verification lane, F-030 and F-031 fixes, F-032
recorded; no public API, protocol, schema, or CLI change.

- [x] `pnpm sync:version`, `pnpm generate:sbom`, `pnpm generate:api-reference`,
  `pnpm update:compatibility-baseline` (version only, 0 changes)
- [x] macOS `CI=true pnpm verify`: every stage through `typecheck` passes; `pnpm test` 1,096 tests,
  1,094 pass, 1 skipped, 1 fail (the known clone carrier test), 100% coverage; `pnpm build &&
  pnpm test:package-cli` and `pnpm build:desktop` pass
- [x] Linux lane, Node 24.21.0 and 24.12.0: every stage passes with 100% coverage except one test
  of the concurrent F-016 work (`test/observability/telemetry-exporter.test.ts`, "an included body
  at the canonical nesting bound exports independent of the caller's stack", `RangeError` on
  Linux only); extended `pnpm fuzz` 410,400 cases, 0 findings on both; `test:runtime-boundaries`,
  `test:package-cli`, `release:reproducible-build`, and the privileged `test:carriers:linux` pass;
  `test:faults:volume` and `check:slo` skip by design. Details in the exit audit addendum.
- [x] F-031 red check: with the helper's link branch disabled, `test/runtime/remove-path.test.ts`
  and the reference-copy symbolic-link replacement case fail on Node 24.12.0

Phase 11 F-016 fix (#189): MINOR 2.33.0; configured canonical nesting bound
(`kernel.canonicalization`), `CanonicalNestingLimitError` (`CANONICAL_NESTING_LIMIT_EXCEEDED`),
explicit-stack canonical encoder, snapshot freeze, and secret scan.

- [x] `pnpm sync:version`, `pnpm generate:sbom`, `pnpm generate:protocol` (no change),
  `pnpm generate:api-reference`, `pnpm update:compatibility-baseline` (four additions: the error
  export on `.` and `./canonical`, the error code, and the identity setting
  `identity:protocol.config.json#/kernel/canonicalization`; no changed artifact, so no classified
  change-log entry)
- [x] `CI=true pnpm verify`: every stage through `typecheck` passes (`check:compatibility` 0
  changes); `pnpm test` ran 1,086 tests, 1,084 pass, 1 skipped, 1 fail (the known macOS clone
  carrier test), 100% line/branch/function coverage; `pnpm build && pnpm test:package-cli` pass
  after the `/canonical` bundle fixture declared `public-errors.config.json`
- [x] `node scripts/fuzz-cli.ts --tier extended --seed 185185`: 410,400 cases, 0 findings (after
  the `readStaticProviderDefinition` oracle change; the first run reported 6 oracle findings)

Phase 11 F-029 fix (#29 follow-up): PATCH 2.32.5; concurrent first opens of one new SQLite
database; no public API, schema, configuration, protocol, or CLI change. Values are in the
[release-candidate manifest](./release-candidate-manifest.md).

- [x] `pnpm sync:version`, `pnpm generate:sbom`, `pnpm generate:api-reference`,
  `pnpm update:compatibility-baseline` (no classified change)
- [x] `CI=true pnpm verify` twice: each run 1,073 tests, 1,071 pass, 1 skipped, 1 fail (the known
  macOS clone carrier test), 100% line/branch/function coverage; `check:compatibility` 0 changes
- [x] `pnpm build && pnpm test:package-cli`; `pnpm build:desktop`
- [x] `node --test test/storage/process-race.test.ts` 10 consecutive runs: 10 pass
- [x] F-029 probes: 0 failures in 4,000 process starts
- [x] `pnpm release:reproducible-build`: both clean builds produced
  `avnionur-shepherd-typescript-2.32.5.tgz` with SHA-256
  `b4fed60fcde401d02076a5cb7c302fa86f460f5e81c6ea82b517565f174f4d17` and output-tree digest
  `sha256:a903a048e4dd9de8183801f52e1d9591dc1a1662c5626eeb0c7772e19d3fd30c`
- [x] `pnpm release:manifest`: unsigned provenance and manifest written (`"signed": false`)

Phase 11 audit (#29): PATCH 2.32.4; documentation and audit only; no public API, schema,
configuration, protocol, store, or CLI change. Values are in the
[release-candidate manifest](./release-candidate-manifest.md).

- [x] `pnpm sync:version`, `pnpm generate:sbom`, `pnpm generate:api-reference`,
  `pnpm update:compatibility-baseline` (no classified change)
- [x] `pnpm release:reproducible-build`: both clean builds produced
  `avnionur-shepherd-typescript-2.32.4.tgz` with SHA-256
  `b98ea693112436aeba08e8328758d9e15e48021f215196e69776d8c6aeef33dc` and output-tree digest
  `sha256:1b9a315688798bea3ea96c70061691c7fa8d97a6b4b2a0edadac0d960b1b505c`
- [x] `pnpm release:manifest`: unsigned provenance and manifest written (`"signed": false`)
- [x] `CI=true pnpm verify`: every stage through `typecheck` passes (`check:compatibility` 0
  changes); `pnpm test` ran 1,066 tests with 1,064 passing, 1 skipped (telemetry fuzz target), and
  100% line/branch/function coverage. The one failure is the known macOS clone carrier test.
  `pnpm build` and `pnpm test:package-cli` were then run separately and pass.
- [x] `pnpm check:slo`: 10 of 10 budgets pass on `macos-arm64-apfs`
- [x] `pnpm build:desktop`
- [ ] Second `CI=true pnpm verify` (documentation edits only): 1,063 pass, 1 skipped, 2 fail: the
  known clone carrier test and `test/storage/process-race.test.ts`, which found F-029 (Low, open:
  concurrent first opens of a new trace-store or coordinator database fail closed; probes: 22 of
  240 coordinator starts, 71 of 160 trace-store starts). Fix pending in a follow-up PATCH.
  `pnpm build && pnpm test:package-cli` and `pnpm build:desktop` pass again.

Phase 11 F-028 fix (#29 follow-up): PATCH 2.32.3; `worktree` submodule check without `git status`;
no public API, schema, configuration, or protocol change.

- [x] `pnpm sync:version`, `pnpm generate:sbom`, `pnpm generate:api-reference`,
  `pnpm update:compatibility-baseline` (no classified change)
- [x] `CI=true pnpm verify`: every stage through `typecheck` passes; `pnpm test` ran 1,066 tests
  with 1,064 passing, 1 skipped, and 100% line/branch/function coverage. The one failure is the
  known macOS clone carrier test. `pnpm build` and `pnpm test:package-cli` were then run
  separately and pass.
- [x] `pnpm build:desktop`

Phase 11 review fixes (#29 follow-up): F-014, F-019, and F-021 to F-027 fixed, F-028 recorded
open, F-016 left open. PATCH 2.32.2: no public API declaration change (the compatibility gate
reported only the newly fingerprinted CLI-option and identity surfaces); protocol configuration
gains `cli.commandOptions`, `kernel.interchange.staging`, `backup.databaseJournalMode`, and
`retention.scanning.findingDigestPrefix` without a protocol identity change.

- [x] `pnpm sync:version`, `pnpm generate:sbom`, `pnpm generate:api-reference`,
  `pnpm update:compatibility-baseline` (no classified change)
- [x] `CI=true pnpm verify`: every stage through `typecheck` passes; `pnpm test` ran 1,064 tests
  with 1,062 passing, 1 skipped (the telemetry fuzz target), and 100% line/branch/function
  coverage. The one failure is the known macOS clone carrier test. `pnpm build` and
  `pnpm test:package-cli` were then run separately and pass.
- [x] `pnpm build:desktop`

Phase 11 Slice 9 (#186): long-duration, kill/restart, disk-full, and corruption recovery suites.
PATCH 2.32.1; fixes and test suites only (F-017 rollback error masking, F-018 malformed batch
digest); no public API, schema, archive, configuration protocol, or CLI change. The fault suites
and a 240-operation bounded soak run inside `pnpm test` (about 25 s of added wall time across
parallel files on the reference host).

- [x] `pnpm sync:version`, `pnpm generate:sbom`, `pnpm generate:api-reference`,
  `pnpm update:compatibility-baseline` (no classified change: nothing public added, removed, or
  changed)
- [x] `CI=true pnpm verify`: every stage through `typecheck` passes; `pnpm test` ran 1,051 tests
  with 1,049 passing, 1 skipped (the telemetry fuzz target), and 100% line/branch/function
  coverage. The one failure is the known macOS clone carrier test. `pnpm build` and
  `pnpm test:package-cli` were then run separately and pass.
- [x] `pnpm test:soak --duration 720`: passed (numbers above).
- [x] `pnpm test:faults:volume`: passed without privileges (16 MiB HFS+ image; outcomes in
  [fault and fuzz conformance](../docs/fault-and-fuzz-conformance.md#disk-full)); image detached
  and removed.
- [x] Page-flip sweep `SHEPHERD_FAULT_SEED=1..64`: 3,072 cases, no silent difference.
- [x] `pnpm build:desktop`

Phase 11 Slice 8 (#185): fuzz decoders, CLI inputs, changesets, and helper protocols. MINOR
2.32.0; additive API (`TraceArchiveLimitError` through the root, `./trace`, and `./operations`),
one public error code (`TRACE_ARCHIVE_LIMIT_EXCEEDED`), and two operational configuration
sections (`kernel.interchange.limits`, `workspaces.gitInvocation`) excluded from protocol
identity; fail-closed tightening of malformed input (oversized archives, repeated keys,
non-canonical archived receipts and backup manifests); no record, store schema, archive format, or
CLI output change. The default fuzz tier (23 targets, 1,000 cases per target except changesets 30,
import 300, CLI 600) and the corpus replay run inside `pnpm test`.

- [x] `pnpm generate:protocol`, `pnpm sync:version`, `pnpm generate:sbom`,
  `pnpm generate:api-reference`, `pnpm update:compatibility-baseline --classify additive` (three
  added `TraceArchiveLimitError` exports and one added error code; nothing removed or changed)
- [x] `CI=true pnpm verify`: every stage through `typecheck` passes; `pnpm test` ran 1,037 tests
  with 1,035 passing, 1 skipped (the telemetry fuzz target, no decoder), and 100%
  line/branch/function coverage. The one failure is the known macOS clone carrier test.
  `pnpm build` and `pnpm test:package-cli` were then run separately and pass.
- [x] `pnpm fuzz --seed 185185` (extended tier): 410,400 cases, 0 findings, 188.7 s, macOS arm64,
  Node 24.17.0. The first run with the same seed before the F-015 fix and the mutator change found
  F-015 (26 cases) and F-016 (1 case).
- [x] `pnpm build:desktop`

Phase 11 Slice 7 (#184): observability. MINOR 2.31.0; additive API (exporter, JSON-lines sink,
two identifier helpers, two generated constants, OTLP subset and exporter types through the root
and `./operations`), one schema (`telemetry-batch-v1`), and the `observability` configuration
section; no store schema, record, archive, or CLI change. `test/observability/` covers
`exportTrace` byte identity, a throwing sink (no run affected, cursor not advanced), restart from
the acknowledged durable cursor with a recovered span start, deterministic identifiers, every body
handling with a secret never serialized, schema validation of every batch shape, and the
owner-only JSON-lines sink.

- [x] `pnpm generate:protocol`, `pnpm sync:version`, `pnpm generate:sbom`,
  `pnpm generate:api-reference`, `pnpm update:compatibility-baseline --classify additive`
  (added `./operations` and root exports, one added schema, five added version markers; nothing
  removed or changed)
- [x] `CI=true pnpm verify`: every stage through `typecheck` passes; `pnpm test` ran 998 tests with
  997 passing and 100% line/branch/function coverage. The one failure is the known macOS clone
  carrier test. `pnpm build` and `pnpm test:package-cli` (including the installed `./operations`
  telemetry probe) were then run separately and pass.
- [x] `pnpm build:desktop`

Phase 11 Slice 6 (#183): scale and performance. MINOR 2.30.0; additive API (`maintain`, five
report types, `TraceStoreReadOnlyError`), one public error code, one CLI command and option, one
`cli-output-v1` branch, the `kernel.store.maintenance` configuration, and index-only store schema
v13 (export digest of every drill fixture unchanged). `test/store/maintenance.test.ts`,
`test/store/query-plans.test.ts`, `test/store/scale.test.ts`, `test/cli/store-cli.test.ts`, and
`test/benchmark/kernel-benchmark.test.ts` cover the slice; the tooling under `tooling/benchmark/`
is in the 100% coverage set.

- [x] `pnpm generate:protocol`, `pnpm sync:version`, `pnpm generate:sbom`,
  `pnpm generate:api-reference`, `pnpm update:compatibility-baseline --classify additive`
  (added exports, one changed `SQLiteTraceStore` declaration classified additive, one schema
  branch, schema version 12 to 13, one appended migration, one error code, one CLI command)
- [x] `CI=true pnpm verify`: every stage through `typecheck` passes; `pnpm test` ran 982 tests with
  981 passing and 100% line/branch/function coverage. The one failure is the known macOS clone
  carrier test. `pnpm build` and `pnpm test:package-cli` (including the installed `store maintain`
  probe) were then run separately and pass.
- [x] `pnpm bench:kernel` wrote `docs/generated/benchmarks/macos-arm64-apfs.json`; `pnpm check:slo`
  passes on the reference host; `pnpm bench:carriers` passes (copy backend only)
- [x] `pnpm build:desktop`

Phase 11 Slice 5 (#182): backup, restore, and migration. MINOR 2.29.0; additive API (five
operations functions, their types, two generated constants), one public error code, one schema,
the `backup` configuration section, and the `store` CLI group (six additive `cli-output-v1`
branches); no trace-store schema, blob layout, or archive change. `test/operations/` covers
owner-only modes under umask `022`, schema-valid manifests, verify and restore round trips,
interrupted backups (no manifest, refused), every tampering class with its reason, restore
publication races and final re-verification, backend-located blobs, replication and fetch, and the
migration drills (schemas 1 through 12 with golden export digests, historical-schema backups,
future-schema refusal with archive import, backup-upgrade-restore). `test/cli/store-cli.test.ts`
validates every store command against `cli-output-v1`.

- [x] `pnpm generate:protocol`, `pnpm sync:version`, `pnpm generate:api-reference`,
  `pnpm generate:sbom`, `pnpm update:compatibility-baseline --classify additive` (added exports,
  schema, branches, three version markers, one error code, five CLI commands; no changed
  declarations); `pnpm check:compatibility` reports 0 changes
- [x] backup, restore, drill, and store CLI suites pass on Node.js 24.12.0 and 24.17.0
- [x] `CI=true pnpm verify`: every stage through `typecheck` passes; `pnpm test` ran 956 tests
  with 955 passing and 100% line/branch/function coverage. The one failure is the known macOS clone
  carrier test. `pnpm build` and `pnpm test:package-cli` (including the installed `store` CLI and
  backup facade probes) were then run separately and pass.
- [x] `pnpm build:desktop`

Phase 11 Slice 4 (#181): storage interfaces. MINOR 2.28.0; additive API (storage types, four
reference adapters, two conformance kits, three generated constants), two public error codes, and
the `storage` configuration section; no trace-store schema, blob layout, or archive change.
`test/storage/` runs both kits over all four adapters (plus the SQLite coordinator on `:memory:`),
shows broken adapters failing the expected laws, covers filesystem layout sharing with
`SQLiteTraceStore`, foreign-entry-tolerant listing, corrupt-object refusal, coordinator
persistence, owner-only file mode, closed/newer/conflicting-schema refusal, every storage
configuration rejection, and a four-process CAS and lease race (tens of real CAS conflicts per run,
every generation committed once, one lease holder, stale fence refused after takeover).

- [x] `pnpm generate:protocol`, `pnpm sync:version`, `pnpm generate:sbom`,
  `pnpm generate:api-reference`, `pnpm update:compatibility-baseline --classify additive`
  (added exports, two version markers, two error codes; no changed declarations);
  `pnpm check:compatibility` reports 0 changes
- [x] `CI=true pnpm verify`: every stage through `typecheck` passes; `pnpm test` ran 910 tests with
  909 passing and 100% line/branch/function coverage. The one failure is the known macOS clone
  carrier test. `pnpm build` and `pnpm test:package-cli` (including the new installed storage
  probe and the updated `./operations` entry-loading policy) were then run separately and pass.
- [x] `pnpm build:desktop`

Phase 11 Slice 3 (#180): secrets and retention. MINOR 2.27.0; additive API (`./operations`, the
optional `secretScanning` store option and getter), two public error codes, two schemas, and the
`retention` configuration section; no store schema or native archive change. Retention tests
(`test/retention/`) cover every configured secret class by pointer and digest, no matched text in
reports, errors, stacks, or inspection, key-match non-descent, the finding bound, refusal with no
partial append and a corrected same-intent retry, refusal inside store-owned transactions (cut
publication), import refusal, default-off behavior, the family-mapping gate, every retention
reader rejection, redacted export dispositions, schema validation, verifier tamper cases, import
refusal of redacted archives, and the bounded read-only report. `test/store/file-mode.test.ts`
covers F-003. A probe on macOS arm64 APFS, Node 24.17.0, umask `022` confirmed that SQLite gives
the WAL and SHM the database file's `0600` mode.

- [x] `pnpm generate:protocol`, `pnpm sync:version`, `pnpm generate:sbom`,
  `pnpm generate:api-reference`, `pnpm update:compatibility-baseline --classify additive` (four
  classified `SQLiteTraceStore`/`SQLiteTraceStoreOptions` declaration changes; added schemas,
  version markers, and error codes recorded as additive); `pnpm check:compatibility` reports 0
  changes
- [x] `CI=true pnpm verify`: every stage through `typecheck` passes; `pnpm test` ran 890 tests with
  889 passing and 100% line/branch/function coverage. The one failure is the known macOS clone
  carrier test. `pnpm build` and `pnpm test:package-cli` (including the installed `./operations`
  probe and bundle fixture) were then run separately and pass.
- [x] `pnpm build:desktop`

Phase 11 Slice 2 (#179): compatibility gate, SBOM, provenance, and reproducible build. MINOR
2.26.0; no runtime, protocol, schema, or store change. Gate mutation tests on temporary copies
(`test/compatibility-policy.test.ts`) show precise failures for a removed export, narrowed
`cli-output-v1` schema, removed error code, removed CLI command, and reordered migration, and
acceptance of added `oneOf` branches and appended migrations after a MINOR bump and baseline update.

- [x] `pnpm sync:version`, `pnpm generate:api-reference`, `pnpm generate:sbom`,
  `pnpm update:compatibility-baseline`; `pnpm check:compatibility` and `pnpm check:sbom` pass
- [x] `CI=true pnpm verify`: every stage through `typecheck` passes; `pnpm test` ran 856 tests with
  855 passing and 100% line/branch/function coverage including the new tooling files. The one
  failure is the known macOS clone carrier test. `pnpm build` and `pnpm test:package-cli` were then
  run separately and pass.
- [x] `CI=true pnpm verify:release` stops at the same known test; `pnpm release:reproducible-build`
  and `pnpm release:manifest` were then run separately and pass. Both clean builds produced
  `avnionur-shepherd-typescript-2.26.0.tgz` with SHA-256
  `0b0570121ab0a9f20cdb92a03fa1e73eca3d8c9b7b587c061c3d2012d66fe9e6` and output-tree digest
  `sha256:fb1556cf7fcd1c5fc3d9f3dfff16b16183b7060dd1c438562d47b75f8c48181e` (macOS arm64 APFS,
  Node 24.17.0, pnpm 10.32.1); no build change was needed.
- [x] `pnpm build:desktop`
- [x] `release.yml` action SHAs resolved read-only with `gh api repos/<action>/git/ref/tags/<tag>`;
  the workflow was not run.

Phase 11 Slice 1 (#187): the [production hardening contract](./production-hardening-contract.md),
[threat model](../docs/threat-model.md), [internal security review](./security-review.md),
[support policy](../docs/support-policy.md), and [incident response](../docs/incident-response.md)
are delivered. Every cited source and test path was checked to exist. Seed findings were
investigated by reading the code paths; the SQLite file mode finding (F-003) was confirmed by a
probe against `src/index.ts` on macOS arm64 APFS, Node 24.17.0, umask `022`: database, WAL, and
SHM `0644`, blob root and fanout directories `0700`, blob file `0600`. Documentation-only PATCH
2.25.2; no runtime, protocol, schema, or storage change.

- [x] `pnpm sync:version`, `pnpm generate:api-reference` (version line only)
- [x] `CI=true pnpm verify`: `check:protocol`, `check:evaluation`, `build`, `check:api-reference`,
  `lint`, `typecheck` pass; `pnpm test` ran 841 tests with 840 passing and 100%
  line/branch/function coverage. The one failure is the known macOS clone carrier test (the host C
  toolchain cannot link the clone helper; also fails on `main`). `pnpm build` and
  `pnpm test:package-cli` were then run separately and pass.
- [x] `pnpm build:desktop`

Phase 10 Task 7 (#177): the [Phase 10 exit audit](./phase-10-exit-audit.md) maps all nine work
items and five exit criteria to entry points, docs, and tests, records the recovery classification,
the review outcome (the #176 review fixes to failed-branch promotion, null cost folding, and
limitation wording), and the carried limits. The
[conformance scenario](../test/applications/applications-conformance.test.ts) runs the repository
evaluation with the supervisor on real scope custody (inject, discard/restart, handoff, accept),
validates every manifest against its generated schema and configured protocol, proves the report
cites exactly the retained manifests and reproduces the checked report's unchanged experiments, and
from the imported archive alone shows the discard decision and retry cut, world fork, merge, and
discard receipts, and every branch's source boundary, trace cut, and prefix, with identical
inspections and training batch digest on the live, read-only, and imported stores.
[Process tests](../test/applications/replay-applications-crash.test.ts) kill a process inside an
optimizer candidate branch and inside a Tree-RL rollout session. Tests and documentation only.
PATCH 2.25.1.

- [x] `pnpm sync:version`, `pnpm generate:api-reference`
- [x] focused: conformance (1 test) and replay application crash (2 tests) pass
- [x] `CI=true pnpm verify` after the #176 review fixes: 841 tests, 840 pass, 100% coverage; the one
  failure is the host clone carrier test (C toolchain cannot link; fails on `main` too); remaining
  stages `pnpm build && pnpm test:package-cli` pass; `pnpm build:desktop` passes

Phase 10 Task 6 (#176): [application evaluation](../docs/application-evaluation.md) is delivered in
`./applications` with `APPLICATIONS_PROTOCOL_V5_CONTRACT`, the generated
`application-evaluation-v1` schema, the repository evaluation definition and fixtures in
`config/research-applications.config.json`, and the generated
[evaluation report](../docs/generated/application-evaluation.md). Tests cover a byte-identical
report across repeated runs and fresh stores with no host, clock, or duration data, a repeated
evaluation that re-executes no provider, program, policy, evaluator, or reward, every metric
re-measured from retained evidence, each baseline kind, comparison arithmetic with null deltas for
a null cost and `success`, failed live calls and null costs, program-serviced baseline workers,
limitations published verbatim with the upstream disclaimer, schema conformance, refusal of
malformed definitions and bindings before any record with a corrected rerun, an evaluation
interrupted inside the supervisor converging to the fresh-store report, report validation
refusals, and the artifact writer generating, re-checking on a different host, rejecting mutated
report and page bodies, and refusing unsafe paths. MINOR 2.25.0.

- [x] `pnpm generate:protocol`, `pnpm generate:api-reference`, `pnpm evaluate:applications`,
  `pnpm sync:version`
- [x] `pnpm verify` stages: `check:protocol`, `check:evaluation`, `build`, `check:api-reference`,
  `lint`, `typecheck` pass; `pnpm test` ran 832 tests with 831 passing and 100% line/branch/function
  coverage (including `tooling/evaluation/`). The one failure is the known macOS clone carrier test
  (the host C toolchain cannot link the clone helper; also fails on `main`). `pnpm build` and
  `pnpm test:package-cli` (including the new evaluation package probe) were then run separately and
  pass.
- [x] `pnpm build:desktop`

Phase 10 Task 5 (#175): the [Tree-RL adapter](../docs/tree-rl-rollouts.md) is delivered in
`./applications` with `APPLICATIONS_PROTOCOL_V4_CONTRACT` and the generated
`application-tree-rl-rollout-v1` schema. Tests cover deterministic fork-point selection (dependent
minimum, index order, bound, prefix identity null at step 0), exact intra- and inter-branch
advantage arithmetic, the canonical `jsonl_v1` text and digest, identical selection, advantages,
batch digest, and manifest across two stores with the same seeds and after archive import into
writable and read-only stores, failed rollouts (session not finished, unexplained divergence,
reward throw, non-finite reward) retained and excluded from every mean, zero single-rollout and
single-fork-point advantages, the `single_rollout` baseline, `maxForkPoints`, `maxBranches`,
`maxRollouts`, and projected provider-call refusals with no record, provider and option refusals
with no record and a corrected rerun, a measured overrun refusing the next rollout before it opens,
crashes at the opened, rollout, batch, and manifest appends converging without extra provider
calls, a process death inside a rollout session refused under a live lease and retained as failed
after expiry, codec, schema, and forged-record refusal, and the packaged `./applications` probe.
MINOR 2.24.0.

- [x] `pnpm generate:protocol`, `pnpm generate:api-reference`, `pnpm sync:version`
- [x] `pnpm verify` stages: `check:protocol`, `build`, `check:api-reference`, `lint`, `typecheck`
  pass; `pnpm test` ran 817 tests with 816 passing and 100% line/branch/function coverage. The one
  failure is the known macOS clone carrier test (the host C toolchain cannot link the clone helper;
  also fails on `main`). `pnpm build` and `pnpm test:package-cli` (including the new Tree-RL
  package probe) were then run separately and pass.
- [x] `pnpm build:desktop`

Phase 10 Task 3 (#173): the [counterfactual workflow optimizer](../docs/counterfactual-optimization.md)
is delivered in `./applications` with `APPLICATIONS_PROTOCOL_V2_CONTRACT` and the generated
`application-cro-candidate-v1` schema. Tests cover the affected-suffix rule (recorded prefix, live
dependents, zero live steps for an edit without dependents), lineage from a parent branch, task,
provider, and handlers edits, unexplained and before-target divergence refusals, evaluator
failures as `APPLICATION_VERIFICATION_FAILED`, the single terminal promotion and the threshold
gate, the measured `full_replay` comparison by provider calls and cache reads, refusal of
undeclared edit kinds and over-limit sets before any record, the provider-call budget, crash
recovery after a branch and after the promotion without replay, codec and forged-record refusal,
schema conformance of retained records, and identical inspection on reopened, read-only, and
imported stores. MINOR 2.22.0.

- [x] `pnpm sync:version`
- [x] `pnpm verify` stages: `check:protocol`, `build`, `check:api-reference`, `lint`, `typecheck`
  pass; `pnpm test` ran 755 tests with 754 passing and 100% line/branch/function coverage. The one
  failure is the known macOS clone carrier test (`clone-helper-unavailable`, the host C toolchain
  cannot link the clone helper; also fails on `main`). `pnpm build` and `pnpm test:package-cli`
  (including the new counterfactual package probe) were then run separately and pass.
- [x] `pnpm build:desktop`

Phase 10 Task 2 (#172): [application manifests](../docs/application-manifests.md) and the
[two-worker coding supervisor](../docs/coding-supervisor.md) are delivered as the `./applications`
entry with `APPLICATIONS_PROTOCOL_V1_CONTRACT`, generated manifest and supervision schemas, and
`createScopeWorldAdapter` in `./workspace`. Tests cover protocol and manifest identity, seeded
manifest digest stability, every policy on the trace-only and fake-world paths, two workers
editing one bound resource through real scope custody with inject, restart from a clean fork,
handoff, and a single accepted merge, a process killed after a worker's durable start recovered
through the documented cancellation path without duplicate records, forged and moved-head evidence
refusal, and identical inspection on reopened, read-only, and imported stores. MINOR 2.21.0.

- [x] `pnpm sync:version`
- [x] `pnpm verify` stages: `check:protocol`, `build`, `check:api-reference`, `lint`, `typecheck`
  pass; `pnpm test` ran 731 tests with 730 passing and 100% line/branch/function coverage. The one
  failure, the macOS clone carrier HFS+ test, also fails on `main` (89ddc99) on this host because
  the host C toolchain cannot link the clone helper (`clone-helper-unavailable`); it is
  environmental and unrelated to this slice. `pnpm build` and `pnpm test:package-cli` were then run
  separately and pass.
- [x] `pnpm build:desktop`

Phase 10 Task 1 (#171): the [research applications contract](./research-applications-contract.md)
is delivered. Pinned release and paper sections reviewed as source-level observations; every public
function the contract composes exists in the delegation, replay, scopes, workspace, providers, and
trace facades; no Python or new application tests executed. Documentation-only PATCH:
`pnpm sync:version` passes and `package.json` reads 2.20.2; no runtime, protocol, schema, or
storage change.

Phase 9 Task 7 (#169): the [exit audit](./phase-9-exit-audit.md) maps all eight work items and five
exit criteria to delivered issues, entry points, docs, and tests, and records the recovery
classification and the review outcome. The conformance scenario accepts a planner's `schema.task()`
output as data, runs it under a root declaration, observes it, inspects its trace, discards it,
retries with an approved revised value whose revised identity and causal replay point are explicit,
injects consumed context, hands off, accepts, projects the typed value, proves grandchild refusal
and bounded admission with isolation, refuses synthesized values carrying code, and re-reads
identical evidence from an imported archive that refuses mutation. Process tests kill a
program-serviced child after its durable start (fail-closed `running` until the documented
cancellation path, then discard and retry) and a child after its terminal (settled without
re-execution). The review found that an opening or retry could reuse a command identity retained by
a handle command on another handle; it is refused with a regression test. Fresh
`pnpm sync:version`, `pnpm generate:api-reference`, `CI=true pnpm verify`, and
`pnpm build:desktop` pass: 720 tests, zero skips, 100% configured coverage.

Phase 9 Task 6 (#168): [result threading and nested meta-agents](../docs/result-threading.md) is
delivered. Focused public-seam tests cover result projection across every handle status including
void outputs, caller schema match and mismatch, foreign and malformed schemas and options,
supervisor trees that follow handoffs, handle trees that list only direct children in canonical
order, absent roots, malformed roots, the configured tree-entry bound with paging, and the nested
scenario: a program-serviced child opening a provider-serviced and a program-serviced grandchild,
authority and budget containment, refused over-grants, accepted and discarded grandchildren,
grandchild records confined to their own owner paths, the root's tree listing exactly the child,
the threaded value embedding only the accepted grandchild's output, forged accept digests, swapped
outcome citations and forged outcome values refused by projection, discard removing the threaded
value, and stability on reopened, read-only, and imported stores. Fresh `pnpm sync:version`,
`CI=true pnpm verify`, and `pnpm build:desktop` pass with zero skips and 100% configured coverage.

Phase 9 Tasks 4–5 (#166–#167): [supervisor operations](../docs/supervisor-operations.md) and
[task revision and synthesis](../docs/task-revision.md) are delivered. Focused public-seam tests
cover observation delivery and reconnect, ordered injection, citation and count bounds, composed
requests reaching the provider with matching consumption digests, pending injections after start,
handoff ownership and former-supervisor refusal, discard of live and settled children, accept of
finished children with output digests, decision terminality, retry successors with predecessor
citations and retry cuts, revised and synthesized provenance validation, approval and rejection,
approval refusals, revision retries read from reopened stores, execution-boundary refusals before
any record, and forged handle record sequences. Fresh `pnpm sync:version`, `CI=true pnpm verify`,
and `pnpm build:desktop` pass with zero skips and 100% configured coverage.

Phase 9 Tasks 1–3 (#163–#165): the [task-as-value contract](./task-as-value-contract.md),
[task values and child run handles](../docs/task-values.md), and
[delegated authority](../docs/delegated-authority.md) are delivered. Focused public-seam tests
cover task value round trips and refusals, `schema.task()` documents, parsing, adapter round trips,
and the published task value schema; provider- and program-serviced children, program context,
invalid output and thrown failures, void outputs, idempotent opening and command conflicts, reserved
owner refusal for raw appends and cut publication, moved heads, completion after a simulated crash
between the child terminal and the completion, terminal children without a published cut, reopen,
read-only, and imported stability, option and handle validation, authority and budget refusals,
nesting bounds, codec rejection matrices, forged record sequences, generated schemas, facade
identity, and configuration drift. The seeded law suite proves no amplification across random grant
and budget chains. Fresh `pnpm sync:version`, `CI=true pnpm verify`, and `pnpm build:desktop` pass
with zero skips and 100% configured coverage.

Phase 8 Tasks 1–7 (#155–#161): the [coupled replay contract](./coupled-replay-contract.md),
[replay sessions](../docs/replay-sessions.md) (store schema v12),
[coupled checkpoints](../docs/coupled-checkpoints.md), and
[rewind and replay](../docs/rewind-and-replay.md) are delivered with the
[exit audit](./phase-8-exit-audit.md). Focused public-seam tests cover provider and effect steps,
dependencies, chained identities and cache evidence, provider and handler failures, program results,
tasks, cancellation, lease conflicts, fencing, renewal, interval-detected expiry, reserved owners,
integrity rows, option validation, step and dependency bounds, multi-world and adapter checkpoints,
unavailable and malformed adapters, uncapturable worlds, byte-equivalent rewind, refusal before
writing, corrupt blobs, prefix mismatch and poisoning, changed provider and task suffixes, policy
approval, refusal, and failure, recorded failures and checkpoints, trace-only and nested step
boundaries, imported archives, divergence and dependency analysis, the cooperative protocol and
transparent probe, generated schemas, configuration drift, malformed and incompatible evidence, and
forged record sequences. Process tests kill a session writer between steps and after an effect
admission. The conformance scenario rewinds and replays an imported archive with an atomic
multi-resource checkpoint. Fresh `pnpm sync:version`, `CI=true pnpm verify`, and
`pnpm build:desktop` pass: 669 tests, zero skips, 100% configured coverage. The replay suite also
passes in a Linux arm64 container, and the independent review's findings are fixed with tests.

Phase 7 Tasks 1–5 (#149–#153): the [live supervision contract](./live-supervision-contract.md),
[trace subscriptions](../docs/trace-subscriptions.md) (store schema v10),
[supervised effect interception](../docs/supervised-effects.md) (store schema v11), and
[approval, context, and worker control](../docs/supervision-control.md) are delivered with the
[exit audit](./phase-7-exit-audit.md). Focused public-seam tests cover subscription replay, live
delivery, acknowledgement conflicts, durable reconnect, overflow, abort, read-only stores, and
corrupt bookkeeping; canonical interceptor order and replay, denial, strengthening replacement,
failure-policy replacement, pause approval and rejection, frontier expiry, timeout and failure
policy, cancellation while deciding and waiting, handler failure, lease conflict and takeover,
lease renewal and loss, uncertain materialization, imported evidence, option validation, moved
heads, integrity mismatches, protocol-violating dispatch paths, context citations, schema-nine
upgrade, generated schemas, and configuration drift. Process tests kill a dispatcher while an
interceptor owns the lease, a dispatcher after admission, and a subscriber after acknowledgement.
The passive-observation test compares exported archives byte for byte. Fresh `pnpm sync:version`,
`CI=true pnpm verify`, and `pnpm build:desktop` pass with zero skips and 100% configured coverage.

Phase 6 Task 9 (#141): the [exit audit](./phase-6-exit-audit.md) maps all eleven work items and
seven exit criteria to delivered issues, entry points, docs, and tests, reassigns coordinated
multi-resource checkpoints to Phase 8, and records the independent review outcomes. Fresh
`pnpm sync:version`, `CI=true pnpm verify`, `pnpm build:desktop`, `pnpm test:carriers:linux`, and
`pnpm bench:carriers` pass: 595 tests, zero skips, 100% configured coverage. The same PATCH fixes
the second independent review's recovery-classification and scheduler findings with tests.

Phase 6 Task 7 (#139): workspace protocol v26 adds clone (Linux FICLONE, macOS clonefile helper) and
Linux overlay carrier backends with identities equal to the copy reference. The shared carrier
conformance suite passes on macOS APFS (copy, clone; overlay refused; clone refused on HFS+), in a
privileged Linux container on tmpfs (copy, overlay; clone refused), and on loopback XFS reflink
(copy, clone, overlay), with zero skips. The scope algebra law suite passes for copy and clone on
macOS and for copy, clone, and overlay on Linux XFS. The storage benchmark shows copy branches grow
with world size (16 and 64 MiB) while clone and overlay branches track changed bytes (about 1 and
4 MiB). Full local verification and production build pass.

Phase 6 exit criterion (checkpoint provenance, #139/#141): scope protocol v6 adds
`classifyScopeCheckpoint`, which derives atomic snapshot, quiescent verified copy, or reconstructed
start classification and restorability from retained checkpoint constituents. Focused tests cover
the real fork checkpoint, reconstructive and fully verified variants, unsupported capture kinds,
configuration drift, and scope v6 compatibility. Full local verification and production build pass.

Phase 6 Task 8 (#140): the seeded scope algebra law suite runs configured operation sequences
against a pure reference model and the durable store with the reference copy carrier, checking
state, open worlds, ordered selected histories, and refusal classes after every operation and
byte-equal inspections across periodic restarts. An explicit case proves disjoint sibling merges
commute to the reference three-way result. The generator found and fixed a fixture authority gap
before the suite passed. Full local verification and production build pass.

Phase 6 Task 6 (#138): scope protocol v5 adds `runScopeTree` and `inspectScopeRecovery`. Focused
tests cover nested settlement order, bounded parallelism with deterministic results at parallelism
one and three, failure and conflict isolation, interruption before merge completion with resumed
reservations and replayed emissions, emission conflicts, subtree refusals failing closed after
siblings settle, world forks merging disjoint siblings and discarding conflicts, option bounds, and
every recovery classification with its owner and resume command. The same change fixes the
independent slice C review findings: pending descendant cleanup now blocks consuming its parent,
retries return the decided receipt once the parent is sealed, publication verifies unplanned
parent paths before writing, merged application custody is built only after the reservation under
a command-derived identity and is named by subtree discards, merge refuses terminal scopes before
carrier work, and inspection validates exact merge journals, resolvable contributions, and
descendant seals. Full local verification and production build pass.

Phase 6 Task 5 (#137): scope protocol v4 adds the read-only spawn/adopt/abandon/publish vocabulary
mapping. Focused tests cover every term with exact citations, abandon without cleanup, adopt without
user publication, pending reserved merges and incomplete forks, ancestor seals not reported as
abandonment, read-only reopen and import equality, unchanged version-1 relation projections, and
configuration drift. Full local verification and production build pass.

Phase 6 Task 4 (#131): slice C implements consume-once scope merge and discard through scope
protocol v3. Focused public-seam tests cover disjoint world merges, trace-only merges, common-origin
exclusion, nested deduplication and distinct repeated occurrences, equal-path and structural
overlap refusal without consumption, empty deltas, missing custody, write authority, carriers,
ownership, stale heads and fences, and concurrent merges with exactly one winner. Discard tests
cover the unchanged current parent, nested subtree sealing with merged and discarded descendants,
cleanup of every retained custody identity, logical discard without a carrier and resumed partial
cleanup, discard-after-merge, reserved merges, unreleased writers, roots, and the subtree bound.
Recovery tests cover crashes before and after the reservation, publication, and completion, lost
responses, third-state and unverifiable parent custody, publication prefixes, expired fences,
ancestor discard of a reserved merge, incomplete-fork discard, and discard decision and cleanup
boundaries. Codec tests cover malformed and forged terminal evidence, in-store completion replay,
completion rollback, row-state integrity, the contribution bound, generated schemas, and scope v3
compatibility with v1 and v2. Full local verification and production build pass.

Phase 6 Task 3 (#130): slice B implements reference-copy scope fork of one bound resource.
Focused public-seam tests cover prepared intent before custody, verified completion under the
parent fence, honest checkpoints with and without an associated run, sibling isolation, nested
attenuation, origin refusal, repository and directory resources, crashes before admission, after
prepared, before completion, and after a lost completion, modified, discarded, and absent custody,
expired fences, stale fences or admitted child writers refused before physical work, writer
refusal before completion, atomic multi-scope claims, malformed journal and
checkpoint evidence, concurrent completion replay, the generated fork schema, and scope v2
compatibility with v1. Full local verification and production build pass. No merge, discard,
multi-resource fork, or atomic-snapshot behavior is claimed.

Phase 6 Task 2 (#129): slice A implements trace-only durable scope registration and fenced
emission through the new `./scopes` entry. Focused public-seam tests cover root/child
registration, origin cuts, parent/request/ceiling attenuation, unknown resource/atom refusal,
forged handles, malformed options, writer conflict/expiry/release/fencing, exact replay after
head advance, release, reopen, and import, changed-content conflict, cross-kind identity reuse,
stale heads, unknown citations, byte-equivalent reopen/import with import-only inspection,
receipt replay without writer authority, intent-bound detection of bypassed raw appends,
foreign-store handle refusal, integrity classification of corrupted rows, lost-response and
pre-admission interruption convergence, and generated schema contracts. Full local verification
passes with zero skips and 100% configured coverage, including installed package and entry-loading
gates; version synchronization, generated reference, protocol artifacts, and production build
pass. Specification review findings on handle binding, authority-free receipt replay, bypass
detection, and per-scope claim identity were fixed; standards review is recorded in the PR.
No world fork, merge, discard, provider, or process behavior is executed or claimed.

Phase 6 Task 1 (#127): proposed scope contract distinguishes ownership/origin/attached children,
isolated forks, local emission, consume-once integration, current-parent preservation and honest
checkpoint/recovery claims. Pinned source reviewed; no Python or new scope-runtime tests executed.
Documentation-only PATCH; full local verification passes (501 tests, zero skips, 100% configured
coverage and installed gates), production build and local links pass. Reviews clarified completed
receipt replay versus new authority and contribution deduplication; no findings remain. Commit/PR
delivery and the proposed implementation-ticket scopes await approval.

Task 24 (#124): owner approved Node >=24.12.0 <25 and breaking version 2.0.0. Focused policy/
pre-write capability tests and installed store/registry/CLI boundary checks pass on supported
24.12.0/24.17.0 and unsupported 24.11.1. Full verification passes on both supported versions:
501 tests each, zero skips, 100% configured coverage and installed-package gates. The minimum
initially exposed host-warning stderr in one CLI test; exact assertions are preserved with a
Node warning flag limited to those subprocesses. Reviews have no remaining findings.
No protocol/schema/dependency changes; runtime policy is a new required distribution asset.
Production builds pass on both supported runtimes, and the final 2.0.0 boundary rerun passes.
Delivered through PR #126; #124 and Phase 5 epic #18 are closed. Hosted workflows remain disabled.

Task 23 (#123): Phase 5 exit audit maps all criteria and 22 completed implementation children.
The runtime-range mismatch is tracked in #124; Phase 5 must remain open. Fresh full verification
passes: 497 tests, zero skips, 100% configured coverage and installed-package gates. Version sync,
production build and local audit-link checks pass. Reviews have no remaining findings.
This is a documentation-only PATCH slice with
no runtime/support-policy changes; verified for PR delivery while Phase 5 remains open for #124.

Task 22 (#121): focused public cut/iteration/slice tests pass (13 tests), including lazy reads,
post-cut exclusion, repeated occurrences, early termination, corruption/close/range refusal,
read-only reopen/import and unchanged archive evidence. Full verification passes: 497 tests,
zero skips and 100% configured coverage, including installed types/runtime, examples, source maps,
entry loading and bundles. Reviews have no remaining findings after a red/green cut-boundary
regression and explicit endpoint guard. Version synchronization and production build pass.
Protocol, store schema and dependency locks are unchanged. Delivered through merged PR #122;
hosted and Windows execution remain unverified, with hosted workflows disabled by owner request.

Task 21 (#119): installed no-Node Bundler/NodeNext compilation and empty runtime import checks
pass. Source type-identity checks and full verification pass: 491 tests, zero skips, and 100%
configured coverage, including installed examples, loading, bundles and source maps. Standards and
specification reviews have no remaining findings. Version synchronization and `pnpm build:desktop`
pass. Existing runtime, protocol and dependency
lockfiles are unchanged. The initial export-map assertion failure was corrected without removing
existing expectations; the new compiler probe uses a shell-independent launch. Hosted/Windows
execution remains unverified. Delivered through merged PR #120; #119 is closed.

Task 20 (#117): adapter identity/registry/execution tests and unsafe-document regressions pass,
including hidden property keys and inherited required-array methods. Full local verification
passes with 100% configured coverage, installed examples, loading/bundling, and production build.
Focused review confirmed both validation fixes; protocol and dependency lockfiles are unchanged.

Task 19 (#115): public typed-handler and existing stack tests, installed inference/dispatch,
entry-loading and bundling gates, full local verification (100% configured coverage), and production
build passed. Focused API review found no actionable issues; protocol/dependency locks unchanged.

Task 18 (#109): installed Rollup root/narrow fixtures pass retained-code checks, optimized execution,
and missing/malformed/restored asset cases. Full local verification passes with 100% configured
coverage; production build, dependency audit, and lockfile review passed. Build allowlist unchanged.

Task 17 (#108): all nine installed exports pass fresh-process builtin loading expectations;
full local verification and production build pass with 100% configured coverage. Runtime,
protocol and dependency lockfile are unchanged. Bundler verification follows in #109.

Task 16 (#102): pinned upstream release sources inspected; guide excerpts match installed examples
that typecheck and execute. Full local verification passed with 100% configured coverage, plus
production build and unchanged-runtime/protocol/lock checks. Python tests were not executed.

Task 15 (#101): full local verification passed with 100% configured coverage, installed custom-effect
typechecking/execution, independent result checks, and unchanged runtime/protocol/verifier sources.
Production build and version synchronization passed; hosted workflows remain disabled.

Task 14 (#100): full local verification passed with 100% configured coverage, including installed
multiple-binding typechecking, intermediate sibling states, final bytes, and reopen citations.
Production build and diff checks passed; runtime, lockfile, and existing examples are unchanged.

Task 13 (#99): local full verification, installed repeated-review checks, file/trace preservation,
production build, and dependency audit passed. Runtime and protocol source remain unchanged.

- [x] `pnpm sync:version`
- [x] `CI=true pnpm verify` (host execution: 100% configured line/branch/function coverage)
- [x] `pnpm build:desktop`
- [x] installed example typecheck, transcript, selected bytes, and existing-directory refusal
- [x] source-checkout example invocation in a fresh temporary directory
- [x] standards, specification, and capability review (packaged documentation links corrected)

## Next slice

Phases 6, 7, 8, 9, and 10 are complete for their documented scope; the
[Phase 9 exit audit](./phase-9-exit-audit.md) records L3 paper programming-model parity for the
documented scope. Phase 10 (#23, research applications) is closed by its exit audit; its
[contract](./research-applications-contract.md) is delivered (#171). Application manifests and the
two-worker coding supervisor are delivered (#172), the counterfactual workflow optimizer is
delivered as applications protocol v2 (#173), and Appendix D trajectory compression is delivered
as applications protocol v3 (#174), the Tree-RL adapter is delivered as applications protocol v4
(#175), and offline evaluation with baselines and a checked repository report is delivered as
applications protocol v5 (#176). Conformance, process crash evidence for the optimizer and
Tree-RL, and the [Phase 10 exit audit](./phase-10-exit-audit.md) are delivered (#177): Phase 10 is
complete for its documented offline scope. Phase 11 (#24, production hardening and 1.0) has
delivered #187, #179 to #186, and the readiness audit (#29, 2.32.4): release candidate ready for
the in-repo scope, 1.0 general availability no-go. No agent-implementable slice remains in the
roadmap; the close-out (#190, 2.33.1) records the local Linux lane and moves the owner-only items
to #191; #191's in-repo slice (2.33.3) recorded the owner decisions and fixed F-032; and #199
(2.34.0) closed the remaining items by owner decision, making 1.0 a private, unpublished source
release with listed waivers
([addendum](./phase-11-exit-audit.md#owner-decisions-and-10-close-out-2340); the F-016 protocol
decision was made and delivered by #189 in 2.33.0). No roadmap slice remains open; later work
(publication, an external review, hosted CI) needs a new owner decision.

Completed follow-ups include the JSON Schema adapter (#117), typed effect payload callbacks
(#115), pinned Rollup Node fixtures (#109), installed ESM loading matrix (#108), and migration
guide (#102). They do not imply broader schema vocabulary, typed effect results, universal
bundler support, or a completed Phase 5 exit audit.

Completed prerequisites: retained coding (#98/PR #103), read-only review (#99/PR #104), multiple
bindings (#100/PR #105), and custom effects (#101/PR #106). Preserve their installed verification,
the original quickstart, and exact authority throughout later work.

Hosted workflows remain disabled: enablement attempts on 2026-09-23 (#191, #199) were blocked by an
account billing limit, CodeQL needs GitHub Advanced Security on a private repository, and by owner
decision (#199) the local gates replace hosted CI for 1.0. `ci.yml` has no Windows runner from
2.34.0. The delivered CI fixes preserve LF
artifacts and normalize Windows compiler paths; CodeQL revisions and metadata permissions are
aligned. Dependency auditing uses the locked graph. CodeQL upload requires code scanning support.

## Notes

- `CLAUDE.md` is not present. A repository-specific `template/changelog-template.md` now captures
  the Keep a Changelog and Semantic Versioning format used here.
- Registry names are selected (`@avnionur/shepherd-typescript`, confirmed 2026-09-23 in D-011) but
  are not reserved until publication succeeds (#199).
- npm publication remains disabled until package exports and consumer compatibility checks pass.
- Private vulnerability reporting must be enabled in the GitHub repository settings once the
  repository is public (#199); until then `SECURITY.md` names private email intake.
- The upstream lock records provenance only; executable upstream conformance fixtures remain a
  later acceptance requirement.
- Completion includes shipped, substrate, paper-level, and operational capabilities; incomplete
  upstream source is not the stopping boundary.
- TypeScript is the sole implementation target. Upstream Python is a behavioral oracle only, not
  a package planned for this repository.
