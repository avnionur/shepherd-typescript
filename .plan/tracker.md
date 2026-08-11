# Implementation Tracker

Last updated: 2026-08-11

Current version: `1.11.0`

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

## Verification required for this slice

- [x] `pnpm sync:version`
- [x] `pnpm verify`
- [x] `pnpm build:desktop`
- [x] dependency and lockfile review
- [x] standards, specification, and capability review

## Next slice

Begin Phase 3, Task 2: implement canonical binding roots and overlap rejection.

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
