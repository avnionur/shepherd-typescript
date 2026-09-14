# Implementation Tracker

Last updated: 2026-09-14

Current version: `2.10.1`

Current level: L2 substrate parity — Phases 4–7 complete for the documented scope; L3 in progress

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

Phases 6 and 7 are complete for their documented scope. The next roadmap phase is Phase 8 (#21,
coupled checkpoints, rewind, and replay). Its first slice should define provider-session and
process checkpoint adapter contracts, including the coordinated multi-resource world checkpoints
reassigned from Phase 6, before any rewind or suffix replay.

Completed follow-ups include the JSON Schema adapter (#117), typed effect payload callbacks
(#115), pinned Rollup Node fixtures (#109), installed ESM loading matrix (#108), and migration
guide (#102). They do not imply broader schema vocabulary, typed effect results, universal
bundler support, or a completed Phase 5 exit audit.

Completed prerequisites: retained coding (#98/PR #103), read-only review (#99/PR #104), multiple
bindings (#100/PR #105), and custom effects (#101/PR #106). Preserve their installed verification,
the original quickstart, and exact authority throughout later work.

Hosted workflows remain disabled at the owner's request. The delivered CI fixes preserve LF
artifacts and normalize Windows compiler paths; CodeQL revisions and metadata permissions are
aligned. Dependency auditing uses the locked graph. CodeQL upload requires code scanning support.

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
