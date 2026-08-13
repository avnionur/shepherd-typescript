# Implementation Tracker

Last updated: 2026-08-13

Current version: `1.18.0`

Current level: L0 — canonical model

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
Portable ACL/xattr/resource-fork detection plus deterministic disk-full, permission, case-folding,
concurrent-mutation, and process-interruption fault injection remain an explicit Phase 3 hardening
gate before any optimized carrier may claim reference parity.
Workspace protocol v4 adds exact Git-aware retained-output bases and protocol v5 now adds pure,
immutable, content-addressed changesets that validate and compare exact copy-world revisions.
Task 6A now lets the reference carrier promote an isolated mutable custody into one verified,
parent-linked immutable revision without reading or changing the user binding. The opaque runner
registration is now implemented as a closed workspace-protocol-v7 handle whose executable
callback remains in a private package registry and whose current enforcement is honestly advisory.
Task 6B.2 now authenticates that handle, issues existing-file authority over isolated custody under
the durable invocation fence, captures successful output, and atomically attaches its verified
world record to the terminal cut. The pre-invocation capture journal, restart recovery, and
uncertain-writer handling remain Task 6B.3–6B.4.

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

## Verification required for this slice

- [x] `pnpm sync:version`
- [x] `pnpm verify`
- [x] `pnpm build:desktop`
- [x] dependency and lockfile review
- [x] standards, specification, and capability review

## Next slice

Continue Phase 3, Task 6B.3: append the durable capture journal before runner invocation and make
exact capture identity, custody, and terminal attachment restart-safe. Task 6B.4 then closes retry,
concurrency, cancellation, corruption, and uncertain-writer handling.

Task 4 platform/fault conformance remains a Phase 3 exit gate rather than a prerequisite for the
Task 6 capture integration: cross-platform case/symlink policy, sparse-index variants, exhaustive
stable error taxonomy, and deterministic concurrency/process-interruption injection remain open.

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
