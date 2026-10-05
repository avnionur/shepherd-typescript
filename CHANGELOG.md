# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [13.7.1] - 2026-10-05

### Improvement

- Publish an independent [empirical benchmark study](.plan/benchmarks/2026-10-05/paper.tex)
  with fresh kernel, scope, carrier, checkpoint, device-layer, and local-provider evidence,
  reproducible procedures, raw samples, and a matched direct-harness control.
- Evaluate context selection on eight synthetic evidence tasks using a local model; distinguish
  answer correctness, cited evidence, abstention, provider tokens, and durable result retention.
- Retain the failed carrier-storage assertion and scope latency SLO miss alongside successful
  correctness checks; document measurement validity and unmeasured framework/platform limits.

### Impact

Documentation and internal research PATCH. No public API, runtime behavior, dependencies, or
benchmark budgets change. The study evaluates runtime version 12.0.3; this release adds its report.

## [13.7.0] - 2026-10-05

### New Feature

- Add opt-in retained provider conversation checkpoints with content-addressed exact message,
  system and tool prefixes, surviving process restart and native trace import (#242).
- Bind snapshots to provider/configuration, adapter and replay context; verify before branch
  publication, compensation and restoration. Public retain/read helpers support native tool loops.
- Apply context retention/redaction and append-time secret scanning; enforce the existing 65 KiB
  canonical payload limit without truncation. Older readers refuse new checkpoint evidence before
  external work and continue redacting the context body.

### Impact

MINOR additive capability. Existing memory receipts and reconstructive rebuild remain available.
Durable mode explicitly retains the system prompt; native backups remain sensitive. Credentials
are excluded from live-factory binding, custom providers declare their configuration identity,
and verified local prefixes do not claim remote model state, live cache hits or exactly-once calls.

## [13.6.0] - 2026-10-04

### New Feature

- Pi observatory now offers live/offline connection setup, provider/model discovery before login,
  a masked API-key form, native private Pi key storage and persisted connection selection (#278).
- Add configured Ollama discovery/custom catalogs, arrow-key canvas panning and recoverable
  Clear canvas / new trace rotation that retains prior databases and provider settings.
- Add an optional isolated Pi SDK 1.0.0 helper and reviewed lockfile; scripts stay disabled and the
  two-day release-age gate is respected. No root runtime dependency is added.

### Defect Fixes

- Preserve configured external RPC choices without the optional helper; failed saved connections
  recover in offline mode with refresh/reconnect controls. Reject secret configuration expressions,
  guard settings writes with same-origin tokens and keep keys out of traces, responses and argv.

### Impact

Additive MINOR setup capability. Existing chat/graph/playground/RPC behavior remains available.
Credentials use Pi-native locked owner-private plaintext files, not browser storage or an OS keychain.
Authentication/model entitlement is checked by the provider on a model call; saving is not a live
validation claim. Single-user loopback and unsupported OAuth/multi-prompt login limits remain explicit.

## [13.5.0] - 2026-10-04

### New Feature

- Add host-authorized effect reconciliation: exact audited retry, externally verified completion,
  and accepted-unresolved decisions preserve original compensation outcomes (#241).
- Retain actor, policy, reason, evidence and exact source/compensation/audit basis with atomic
  command replay and fencing. Accepted residual risk remains visible through affected scope,
  run and replay inspections, including CLI views and subsequent discard/rewind.
- Add schema-15 reader boundary and compensation-path audit guards, so older runtimes cannot
  silently retry an operator-resolved effect after opening a store or importing an archive.

### Impact

MINOR additive capability. Existing v1 facts, materialization identities and handlers remain valid;
new optional inspection metadata carries operator dispositions separately. Writable stores migrate
forward; take a pre-upgrade backup for downgrade. Retry records perform no external work, host
policy supplies authentication/verification, and imported stores have no cross-store fencing.

## [13.4.0] - 2026-10-04

### New Feature

- Add `examples/pi-observatory`: local browser chat, configured Pi RPC subprocess integration,
  offline fixture mode and an interactive canonical Shepherd evidence graph with record inspection,
  run/source/search filters, zoom/pan, animated dashed causal arrows, live-follow camera,
  causal trace playback, provider/model catalog selectors, a window-filling canvas with
  task/budget/usage/cut explanations, native trace export and configuration-owned one-click
  playground cases for success, failure, cancellation, context and literal-text rendering (#275).
- Publish the engineering guide with pinned Pi/AppGraph research, RPC settlement and cleanup,
  graph authority, configuration, privacy, recovery and extension limits. Real HTTP/subprocess
  fixtures exercise durable evidence, framing, cancellation, failures and read-only export.

### Impact

Additive MINOR example capability. Pi is optional and externally installed; no core runtime,
public API, protocol, dependency or storage-format change. Default Pi tools/extensions are disabled.
RPC observations are separate from governed effects; no credentialed live, jail, provider-checkpoint,
replay or cross-platform guarantee is claimed.

## [13.3.0] - 2026-10-04

### New Feature

- Compensation attempts now acquire durable exclusive invocation leases atomically with their
  attempt records. Heartbeats renew live owners; outcomes require the exact unexpired fence and
  release ownership atomically. Store schema 14 adds validated ownership bookkeeping (#240).
- `inspectEffectCompensationOwnership` separates record-derived uncertainty from active, expired,
  released or absent store-local ownership. Handlers receive claim and fence identifiers while
  retaining the same materialization-based external idempotency key across all triggers.

### Defect Fixes

- Concurrent triggers cannot both enter a handler under an active lease. A stale holder cannot
  renew, publish an outcome or release its replacement. Publication failures do not fabricate
  success; process-killed attempts wait for lease expiry before retry.

### Impact

MINOR feature and correctness release. Existing compensation records/identities remain unchanged;
new writable stores migrate to schema 14 and read-only opens require that schema. Fencing does not
stop suspended external work: handlers still require stable-key idempotency. Imported trace copies
carry semantic evidence without live ownership and provide no cross-store exclusion.

## [13.2.0] - 2026-10-04

### New Feature

- `SQLiteTaskRegistry.registerGranted` atomically persists authenticated repository declaration
  companions bound to the exact task version. Registry and ledger reads validate the full companion
  and lock after restart; conflicting, stale or corrupt evidence refuses (#239).
- Human `task show`/`task resolve` include instructions, input/output schemas and declared profiles.
  Stable JSON retrieves registered companion evidence automatically, distinguishing declarations
  from per-run resources, ceilings, effective grants and enforcement.

### Impact

Additive MINOR release. Registry schema 2 migrates existing registrations on writable open without
inventing grants; read-only CLI inspection requires the current schema. Older binaries refuse the
new schema. Existing task artifacts and JSON ledger shape remain unchanged. Changing a registered
declaration requires a new task version; plain re-registration preserves any existing companion.

## [13.1.0] - 2026-10-03

### New Feature

- Built-in retained-world `readText` and `writeText` calls automatically retain invocation-fenced
  intent, admission and correlated outcome evidence, including refusals, failures and cancellation.
  Overwritten writes and write-then-restore histories remain inspectable independently of final
  changesets (#238).
- `inspectTaskWorldEffects` exposes exact resource authority, operation order, bounded digest-only
  path/content evidence and incomplete admissions after reopen/import. Workspace protocol v28
  adds the separate `world-effect-journal-v1` schema and configured vocabulary.

### Defect Fixes

- Lost journal acknowledgements cannot be converted into synthetic filesystem-failure outcomes;
  uncertainty blocks further capability I/O and capture settlement. Cancellation before admission
  records a cancelled operation without performing it.

### Impact

Additive MINOR release. Existing capture journal formats and recovery/settlement APIs remain
supported. Run traces gain operation records; no plaintext file content or path is copied into
those records. Stale capabilities cannot append after settlement. Direct filesystem calls and
native process syscalls retain their existing boundaries; uncertain runners are never replayed.

## [13.0.0] - 2026-10-03

### Breaking Changes

- Replay protocol v4 binds branch commands to a separately versioned normalized request before
  compensation or restoration. A changed request now raises an explicit conflict before receipt
  replay or physical work; malformed dispositions are rejected on completed commands too (#237).
- Legacy branch commands without a request journal no longer replay their completed receipt through
  rewind/replay. Their trace remains inspectable, but disposition and checkpoint policy cannot be
  inferred safely. There is no automatic backfill; inspect the old result and choose any new branch
  deliberately. New branch session records causally cite their request record.

### New Feature

- `inspectReplayBranchRequest` exposes immutable normalized request evidence after reopen/import,
  including interrupted compensation before the branch session opened. It returns null for absent
  or legacy requests. Exact retries preserve the retained result and materialization-keyed
  compensation semantics.

### Impact

MAJOR release for the durable branch-retry contract. Request identity covers mode, source, target,
source disposition, declared changes, replacement task, checkpoint policy and declared session
bindings. Operational clocks, claims, signals, physical roots and callback objects are excluded as
specified in the request-identity guide. Compensation attempt ownership remains tracked in #240.

## [12.0.2] - 2026-10-03

### Defect Fixes

- Correct stale migration claims about scopes, subscriptions, supervisor intervention and replay,
  and clarify that compression's text envelope is a protocol choice rather than a task-schema limit.
- Publish an evidence inventory with independent API, composition, restart, live-provider,
  performance, platform and formal boundaries, public export checks, content-pinned citations and
  outstanding issue links. `pnpm verify` now rejects inventory drift, including stale claims.
- Clarify compensation invocation limits: retained materialization keys still require idempotent
  handlers during uncertain retries; durable attempt ownership remains tracked separately.

### Impact

Documentation and internal verification PATCH for #236. Public runtime APIs, protocols and storage
formats are unchanged. Evidence-file changes require reviewing affected inventory claims before
refreshing their pins; generation never silently refreshes evidence. No new live, platform,
performance or formal result is claimed.

## [12.0.1] - 2026-09-25

Coverage gate fix for [#232](https://github.com/avnionur/shepherd-typescript/issues/232).

### Defect Fixes

- The test runner no longer uses Node's built-in coverage merge, which dropped zero-count ranges
  depending on merge order and so reported 100% for code no test executes. Test processes write
  raw V8 coverage to a temporary `NODE_V8_COVERAGE` directory, and
  `tooling/testing/coverage-merge.ts` sums the innermost-range count of each line, branch, and
  function across processes. `pnpm test` and `pnpm test:serial` now flag identical sets, and
  included files that no test loads are reported ([coverage gate](docs/coverage-gate.md)).
- The pre-existing gaps it exposed are covered by tests: blob publish and I/O rethrows, blob
  verification rethrow, delegation handle parent and predecessor refusals, shape-only slices
  without an owner view, scope fork registration without its prepared intent, replay checkpoint
  constituent ordering, durable result exhaustion that disagrees with consumption, durable start
  without owned recovery evidence, scope merge journal refusals, and the `./canonical` and `./cli`
  facades.
- Unreachable code is removed with its invariant documented: the non-refusal rethrow in delegated
  authority derivation, the empty-cause alternative in recovery command evidence, the missing
  placement rule guard, the missing reconstructed durable artifact guard, the usage-less outcome
  cause arm and the claim-id fallback in durable terminal retention, and the `ScopeEvidenceError`
  pass-through in scope evidence decoding.

### Impact

No public API, protocol, or behavior change for any reachable input. The coverage report printed by
`pnpm test` has a new format and prints one Node 24 experimental warning for type stripping.

## [12.0.0] - 2026-09-25

Review fix pass for epic [#202](https://github.com/avnionur/shepherd-typescript/issues/202).

### Breaking Changes

- `schema.fromJSONSchema` adapts a required `{type: "null"}` object property to `schema.null()`
  (`schema.void()` is produced only at the document root), so a rehydrated descriptor parses values
  exactly like the original; `schema.void()` is refused as an object field. Golden descriptor
  identities are unchanged (#205).
- Scope world adapter merge semantics (#211): merge always lands in the parent world. A custody
  forked from another custody (a handoff follower forked from the leader) is rebased against its
  lineage base, so the source's post-fork writes are excluded, then sealed and merged through a
  fresh parent fork; discard releases adapter-held writer claims first. Limitation: when the
  leader custody is also final, landing the second lineage is refused as a conflict on the
  leader's pre-fork paths.
- Replay protocol v3 (`REPLAY_PROTOCOL_V3_CONTRACT`, config `replay.branch`): replay branches
  carry a source disposition (see New Feature); rewind keeps compensating the abandoned suffix by
  default (#209, #210).

### New Feature

- `rewindReplaySession` and `replayReplaySession` take an optional `sourceDisposition`
  (`REPLAY_SOURCE_DISPOSITIONS`: `compensate`, the configured default, or `retain`). `retain`
  leaves the source's successful compensable effects in place because the source is not abandoned.
  Tree-RL rollouts, counterfactual optimization candidates, trajectory compression, and the
  meta-agent `replay` tool branch with `retain`, so sources with compensable effects no longer
  throw `EffectCompensationHandlerNotFoundError` (regression since 7.0.0; #209, #213, #212, #208,
  #206). `REPLAY_SOURCE_DISPOSITIONS` and `ReplaySourceDisposition` are exported from the package
  root and `./replay`.

### Defect Fixes

- The meta-agent `replay` tool is declared `reversible` like `rewind`, so rewinding a meta session
  before a replay call no longer requires a compensation handler (#206).
- Meta-agent substrate commands inside a replay-bound tool loop are scoped to the executing session
  (`<prefix><session_id>:<effect_id>`), so a replay branch of a meta session no longer collides
  with the source's fork, discard, rewind, and replay commands (#206).
- OpenAI-compatible (OpenAI, OpenRouter) dialects place the cache marker on the last tool message
  when the cache prefix ends with tool results only (#204).
- Append batches refuse a non-text owner path with a path-level `TypeError`.
- Runtime supervisor (#211): a rerun after a crash between two settlement discards completes the
  settlement; a run stopped while a handoff or discard waits for the aborted attempt no longer
  starts the replacement worker; exhausting `maxProviderCalls` inside a worker aborts the run and
  leaves attempts open, as documented; policy output is also checked against the fixed record
  decision schema, so a looser protocol action schema yields a retained refusal instead of a crash.
- Container device layer (#215): configured tokens are substituted in one pass, so a path
  containing a token is no longer re-expanded; an image value starting with `-` is rejected.
- Scope benchmark SLO budgets are recomputed as three times the worst p95 of three runs including
  the committed artifact; the policy text is corrected (#214).
- Counterfactual optimization reads protocol thresholds through an explicit check. Impossible
  fallbacks were removed (CRO parent plans, Tree-RL seeded tool calls, compression rewind
  evidence, recorded replay source steps) and real error paths gained tests where Node's parallel
  coverage merge hid uncovered branches: append store, scope inspection, retained-world
  settlements, the SQLite read-only root witness, provider messages and tool-only assistant turns,
  delegation handles, wrapped delegation and replay inspection errors, truncated process images
  and store failures during replay restore, worlds changed during checkpoint capture, denied
  supervised dispatches cited by a discarded scope, caller errors in proof evidence, a runtime
  supervisor stopped during a replacement fork, and nested scope-world merges retried after their
  rebase fork or seal. Every source file the epic changed is fully covered under a summed V8
  measurement (#212, #217).

### Improvement

- Threat model covers live provider transport and credentials, the container device-layer
  (`docker` CLI) boundary, and the meta-agent's store-wide `read_trace` authority; tool input
  schemas are documented as trusted configuration or caller code
  ([JSON Schema validation](./docs/json-schema-validation.md)); stale package-export and
  device-layer wording fixed (#204, #206, #215).
- Documentation of source disposition in [effect compensation](./docs/compensation.md),
  [rewind and replay](./docs/rewind-and-replay.md), and the Tree-RL, counterfactual optimization,
  and trajectory compression pages.

### Impact

Callers that built descriptors with `schema.void()` object fields must use `schema.null()` or an
optional field; rehydrated descriptors now round-trip `null` values. Scope world adapter callers
that relied on a nested merge publishing into the source custody now land in the parent world.
Exploratory replay applications work over sources with compensable effects without a
compensation registry. Replay records and inspection shapes are unchanged except for the new
branch option.

## [11.3.1] - 2026-09-25

### Improvement

- Adds research notes for the paper v3 Appendix A.2 and §6 future-work directions under
  [`.plan/research/`](./.plan/research/README.md) (#218): interpretability probes via
  counterfactual replay, reversible environments for continual learning, substrate-native
  fork/discard/replay actions for post-training, compressing execution traces into reusable
  workflows (follow-up to Appendix D), and a safety deployment profile (external override of
  irreversible effects, rollback to the last materialization point). Notes are not normative and
  claim no results; no implementation issue is filed until a note is reviewed.

### Impact

Documentation only; no runtime, API, or protocol change. The notes flag unverified premises: an
unfinished session as a branch source, nested cost roll-up, and Tree-RL from branch sessions
(needs a protocol change).

## [11.3.0] - 2026-09-25

### New Feature

- Layered device-layer checkpoints for paper §3.3 and Appendix C.4 and C.7 (#215), workspace
  protocol v27 (`workspaces.deviceLayers`, `WORKSPACE_PROTOCOL_V27_CONTRACT`):
  `openDeviceLayerWorld` opens a seeded world whose `checkpoint(name)` freezes the writable layer
  as a named lower layer and whose `restore(name)` discards the writable layer and every newer
  checkpoint. A configured depth bound (`maxDepth` 48, `retainNewest` 4) compacts the oldest frozen
  layers into one replacement base when a checkpoint would exceed it; the newest flattened name
  moves to the base and older ones are retired (`DEVICE_LAYER_CHECKPOINT_RETIRED`).
- Pluggable `DeviceLayerAdapter` contract (`probe`, `open`, and a device with file operations,
  `freeze`, `revert`, `close`, and `maxLayers`), the carrier backend contract generalized, with the
  public conformance kit `checkDeviceLayerConformance` covering file semantics, named checkpoints,
  restore and discard, the depth limit, compaction and retirement, and close.
- Built-in adapters: `copy` (full verified copy per checkpoint, the `cp -a` reference), `clone`
  (verified reflink or `clonefile(2)` per file), Linux stacked `overlay` (unmount, rename the upper
  directory into `lowerdir`, remount; read-only merged-view compaction; depth also bounded by the
  mount-option bytes), and a reference `container` adapter driven through the `docker` CLI without
  a shell (`docker commit` per checkpoint, export/import compaction, command names, image, and
  flags from configuration; never pulls). The container conformance test is opt-in
  (`SHEPHERD_DEVICE_LAYER_OPT_IN=container`) and reports unavailability without Docker.
- Configured fallback ordering: device-layer selection is `strict` by default and `fallback`
  degrades along `overlay`, `container`, `clone`, `copy`, recording `{ mode, requested, used,
  attempts }` in `world.selection`. `createReferenceCopyCarrier` gains the same opt-in
  `backendSelection: "fallback"` over `workspaces.carrierBackends.selection.fallbackOrder`
  (`overlay`, `clone`, `copy`) and every carrier exposes `backendSelection`; strict refusal remains
  the configured default, so existing carriers are unchanged.
- `pnpm bench:device-layers` and the privileged Linux lane `pnpm bench:device-layers:linux`
  measure checkpoint and restore latency against world size and a 100-checkpoint depth sweep. On
  the Linux tmpfs overlay lane the overlay checkpoint median was 2.06, 3.06, and 2.71 ms for 1, 16,
  and 128 MiB worlds (ratio 1.32) and 2.5–2.9 ms through 48 stacked layers, while copy grew 80x; on
  macOS the Docker adapter was flat in world size at 357–419 ms. Results are this repository's
  measurements only ([device layers](./docs/device-layers.md#measured-capture-cost),
  [performance report](./docs/performance-report.md#device-layer-checkpoint-benchmark)).
- New public error class `DeviceLayerError` with configured codes.

### Impact

Callers gain a constant-time (on overlay) layered checkpoint primitive with a bounded depth and a
seam for other sandbox substrates, plus recorded, opt-in backend fallback. Additive only: carrier
custody, `captureCustody`, `forkScope`, and replay world images are unchanged and do not use device
layers, so scope fork latency still grows with world size. No remote sandbox (E2B, Modal, Daytona)
adapters.

## [11.2.0] - 2026-09-25

### New Feature

- Scope fork/revert and observer-overhead benchmark for paper Section 4 and Appendix C (#214):
  `pnpm bench:scopes` ([`scripts/bench-scopes.ts`](./scripts/bench-scopes.ts), logic in
  [`tooling/benchmark/scope-benchmark.ts`](./tooling/benchmark/scope-benchmark.ts), procedure in
  [`config/scope-benchmark.config.json`](./config/scope-benchmark.config.json)) measures, for every
  carrier backend conformant on the host, `forkScope` and `discardScope` latency over three
  configured world sizes (30 KB, 10 MB, 100 MB); a K=4 branching pattern (baseline writes in a
  parent, a checkpoint, K - 1 sibling forks with one write each) reporting per-branch and
  K-branch free-space use, trace-store growth, and process RSS growth; a per-write mutation-size
  sweep (1 KiB to 10 MiB) with a least-squares fit of storage against bytes written; and per-event
  `dispatchEffect` record and trace-subscription observe latency at 1 to 200 steps with 0, 1, and
  4 observers, plus committed records and JSON bytes per event.
- Every revert is checked independently of the carrier: the source binding, the parent custody,
  and a fresh fork of the checkpoint are compared by a SHA-256 tree digest with their pre-fork
  state, discarded custody must no longer open, and observers must not change the recorded
  stream; any failure fails the run.
- Raw samples, summaries, host facts, and the configuration digest are written to
  `docs/generated/benchmarks/scope-benchmark-<host-class>.json`. Budgets per configured host class
  (`macos-arm64-apfs`, `linux-arm64-xfs-privileged-container`) are checked by `pnpm check:scopes`,
  which is not part of `pnpm verify` (about seven minutes per run). `pnpm bench:scopes:linux` runs
  the benchmark in a privileged Linux container on loopback XFS with reflink, where the copy,
  clone, and overlay carriers are all conformant.
- Results are this repository's measurements on the recorded hosts only; see the
  [performance report](./docs/performance-report.md#scope-forkrevert-and-observation-benchmark).
  Tooling: `readBenchmarkEnvironment` is exported from the kernel benchmark module and
  `digestBenchmarkConfiguration` accepts any configuration object.

### Impact

Fork/revert latency, branch storage scaling, revert correctness, and observer overhead are now
measured and budgeted on the recorded hosts instead of being absent. No runtime API or protocol
changes.

## [11.1.0] - 2026-09-25

### New Feature

- Concurrent runtime supervisor for paper Section 5.1 and Appendix E (#211):
  `runRuntimeSupervisor` runs two or more workers concurrently, each a `runToolLoop` session over
  its own custody from `world.fork`, while a supervisor ticks at the protocol's
  `tickIntervalMilliseconds` (5000, the paper's 5 s; an optional `wait` replaces the timer). Every
  worker has a reserved stream owner path retaining its `attempt`, `turn` (tool-call summaries,
  exact request digest, assistant and next-user messages, delivered guidance ticks, usage), and
  `completed` records; each tick drains one live trace subscription over every stream and builds
  one combined snapshot with the paper's per-agent fields (feature truncated to 350 characters,
  cumulative events, consecutive errors, modified files, last action and ticks since, the trailing
  25 tool-call summaries of at most 150 canonical bytes), validated against the pinned observation
  schema.
- Per-agent batched decisions: the policy returns the Appendix E `{ decisions: [{ agent, action,
  reason, guidance?, leader? }] }` object once per tick; `none` is the default for unlisted agents.
  The batch is validated against the pinned action schema and admission rules (known, distinct
  agents; guidance required for `inject`, allowed only for `inject` and `handoff`; `leader` only for
  `handoff`; 20 reason and 60 guidance words) and refused as a whole otherwise, with the refusal
  retained. The tick record, with the exact snapshot and subscription cursor, is retained before any
  decision takes effect.
- `inject` appends guidance to a running worker's next user message between turns, keeping every
  earlier message and the cache prefix byte-identical; `handoff` aborts the attempt and starts a
  fresh session whose first user message carries the feature and the guidance, on the same custody
  or, with `leader`, on a fork of the leader's quiesced custody; `discard` restarts on a clean fork
  of the pre-run world. Settlement retains final attempts and undelivered guidance, discards
  abandoned custody no final custody descends from, and retains the manifest; final custody is
  returned for the caller to integrate.
- Provider-backed policy: `createModelRuntimeSupervisorPolicy({ model, protocol })` sends one
  JSON-mode request per tick (the pinned Appendix E meta-agent prompt as system prompt, the
  observation prompt and canonical snapshot as the user message, the decision schema as output
  schema) and parses JSON decisions; text that is not JSON is refused and retained.
- Recovery: a rerun completes retained ticks without the policy (retained forks replay under
  derived command identities), resumes open attempts from their retained conversations with a
  byte-identical request, and re-queues undelivered guidance; a run that fails or is cancelled
  leaves open attempts resumable, as a crash does.
- World adapters: `ApplicationWorldForkRequest.sourceCustodyId` forks another custody's current
  tree. `createScopeWorldAdapter` implements it as a nested scope fork under a writer claimed with
  the source's fork command identity; merge publishes into the world a custody was forked from;
  completed merge and discard commands replay before the custody is resolved; changed paths are
  relative to the lineage's first parent-world fork.
- Applications protocol v10 (`APPLICATIONS_PROTOCOL_V10_CONTRACT`) appends
  `applications.runtimeSupervision`, the `maxTicks` and `maxTickIntervalMilliseconds` limits, and
  the `shepherd.application.runtime_supervision.v1` trace schema with the generated
  `application-runtime-supervision-v1.schema.json`. The repository protocol is the new
  `runtimeSupervision` section of `config/research-applications.config.json`.
- New exports: `runRuntimeSupervisor`, `inspectRuntimeSupervisorRun`,
  `createModelRuntimeSupervisorPolicy`, `APPLICATION_RUNTIME_SUPERVISION_ACTIONS`,
  `APPLICATION_RUNTIME_SUPERVISION_PHASES`, `APPLICATION_RUNTIME_SUPERVISION_ATTEMPT_CAUSES`,
  `APPLICATION_RUNTIME_SUPERVISION_ATTEMPT_STATUSES`, and the `RuntimeSupervisor*`,
  `RunRuntimeSupervisorOptions`, and `ModelRuntimeSupervisorPolicyOptions` types.

### Impact

The paper's live supervisor is available alongside the unchanged round-based
`runCodingSupervisor`. Existing protocols, records, and adapters keep their meaning; the scope
world adapter's merge now claims the child writer under its fork command identity. The policy and
workers were exercised only against scripted providers; no CooperBench pair rate is measured, the
cross-agent `leader` field is a repository extension of the printed schema, and a worker turn in
flight at a crash is re-sent after recovery.

## [11.0.0] - 2026-09-25

### New Feature

- Counterfactual Replay Optimization follows paper Appendix F.1 Algorithm 1 (#212, §5.2,
  F.2.3-F.2.5, Figure 5): `runCounterfactualOptimization` records the baseline workflow once per
  train and dev example (`dataset: { train, dev }` drawn from the protocol's dataset items, scored
  by a caller `metric`), then runs `iterations` proposer iterations of at most
  `proposalsPerIteration` edits, each paired with a fix set and a guard set of train examples. Each
  edit is replayed counterfactually from the first affected step of the parent's session on every
  fix and guard example, gated by the configured thresholds, replayed on every dev example when it
  graduates, and promoted into the graduate-only parent pool within `promoteDevEpsilon` of the
  current promoted dev score (promoted candidates are also replayed on the remaining train
  examples). The pool member with the best dev score is selected.
- Proposers: any `CounterfactualProposer` function, or `createToolLoopCounterfactualProposer({ model,
  maxTurns? })`, which records each attempt as a replayable tool-use loop session over the pinned
  proposer prompt, reflection schema, and tools `inspect_candidates`, `read_effect_trace`,
  `grep_effect_traces` (the F.2.3 regex trace search), and `propose_candidate`; its provider calls
  are budgeted, costed, and cited in the proposal record.
- Admission before any evaluation: proposal shape, pool parent, capacity, unique names, train-only
  disjoint fix and guard sets, admissible edited steps on every parent example session, the caller
  `applyEdit`, the pinned reflection schema, and the F.2.5 reflection contract (prior citations,
  near-duplicate `differs by:` explanations at Jaccard similarity `reflectionDuplicateSimilarity`,
  and the `reflectionMinMechanisms`/`reflectionAudaciousPrior` verbalized-sampling floor). Refusals
  are fed back and retried up to `maxProposalAttempts` and retained in the proposal record.
- Fractional thresholds: application protocols accept an optional `thresholds` map of finite numbers
  (definitions without it keep their identity); the optimizer reads `targetedMinScoreLift`,
  `targetedMaxScoreDrop`, `targetedImproveThreshold`, `promoteDevEpsilon`, `minPromotionScore`,
  `reflectionDuplicateSimilarity`, and `reflectionAudaciousPrior` from it (paper defaults in the
  repository protocol).
- Manifests may carry the protocol `thresholds` and a per-session `computation_reuse` table
  (`session_index`, `recorded_steps`, `live_steps`, `reuse_ratio`); the optimizer retains one entry
  per proposer session. `createApplicationManifest` accepts `computationReuse`.
- New exports: `createToolLoopCounterfactualProposer`, `APPLICATION_CRO_SPLITS`,
  `APPLICATION_CRO_EXAMPLE_ROLES`, and the types `ApplicationComputationReuse`,
  `CounterfactualDataset`, `CounterfactualExample`, `CounterfactualProgram`,
  `CounterfactualTaskFactory`, `CounterfactualEdit`, `CounterfactualEditApplication`,
  `CounterfactualEditApplier`, `CounterfactualEditContext`, `CounterfactualMetric`,
  `CounterfactualMetricContext`, `CounterfactualProposal`, `CounterfactualProposer`,
  `CounterfactualProposerContext`, `CounterfactualPoolMember`, `CounterfactualProposalRecord`,
  `CounterfactualExampleResult`, `CounterfactualExampleRole`, `CounterfactualGateVerdict`,
  `CounterfactualBaselineExample`, `CounterfactualSelection`, `CounterfactualSplit`,
  `CounterfactualComputationReuse`, and `ToolLoopCounterfactualProposerOptions`.

### Breaking Changes

- Applications protocol v9 (`APPLICATIONS_PROTOCOL_V9_CONTRACT`) replaces `applications.cro`:
  phases `opened`, `proposal`, `candidate`, `selection`; statuses `archived`, `evaluated`,
  `promoted`, `rejected` (`proposed` removed); artifact roles `baseline`, `proposal`, `candidate`,
  `selection`; budget keys `iterations`, `proposalsPerIteration`, `maxCandidates`,
  `maxProposalAttempts`, `maxProviderCalls`, `reflectionMinMechanisms`; new `thresholdKeys`,
  `splits`, `exampleRoles`, `proposer`, and `reflection` sub-objects. `minPromotionScore` is no
  longer an integer budget but a fractional threshold. Configurations written for v8 are refused.
- `runCounterfactualOptimization` options: `candidates` and `evaluate` are replaced by `dataset`,
  `proposer`, `applyEdit`, and `metric`; the baseline `program` and `task` are factories of the
  example. `CounterfactualCandidateDefinition`, `CounterfactualCandidateInspection`,
  `CounterfactualEvaluation`, `CounterfactualEvaluationContext`, and `CounterfactualEvaluator` are
  removed; `CounterfactualCandidatePlan`, `CounterfactualCandidateRecord`,
  `CounterfactualOptimizationInspection`, `CounterfactualHandoff` (`selected_candidate_id` replaces
  `promoted_candidate_id`), and `CounterfactualWorkflowDefinition` change shape.
- Optimizer records (`application-cro-candidate-v1` schema, same trace schema reference) change
  shape; runs retained before 11.0.0 are refused. The repository `counterfactual` protocol
  (`appendix-f.v2`) pins new reflection, handoff, and proposer tool surfaces, and the evaluation's
  optimizer binding is a scripted proposer over four train and two dev examples (definition revision
  4, regenerated report, new `scripted-proposer` limitation).

### Impact

The optimizer now runs the paper's loop instead of evaluating caller-declared candidates, and its
records show the fix/guard verdict, dev promotion, parent pool, and per-session reuse. Callers must
supply train and dev examples, a metric, a proposer, and an edit applier. Edits remain declared data
applied by caller code; the tool-loop proposer ran only against scripted models (no credentials);
promoted parents are replayed eagerly on the remaining train examples, and reuse counts replay
steps, not provider or subtask cache hits.

## [10.0.0] - 2026-09-25

### New Feature

- Tree-RL follows paper Appendix F.6 Algorithm 2 (#213, §5.3, F.6-F.7): `runTreeRlRollouts` takes a
  batch of `prompts` (`{ id, program, handlers?, roots }`) with exactly the protocol's `groupSize`
  G recorded roots each, grades every root with the reward (member `root`), and asks a fork
  `selector` for `{ branch_turn, tool_call, reason }` per root. The proposed turn is clamped into
  the configured `[1, T - 2]` (`applications.treeRl.forkTurn`) and, for world- or process-bound
  roots, moved to the nearest restorable turn; K branches replay each root from the boundary
  before the fork turn, and the proposed tool call seeds branch 0 through the provider factory
  context (`tool_call`, `seeded`).
- Fork selectors: `createMetaAgentTreeRlForkSelector({ provider })` sends the numbered root turns and
  final reward to a meta-agent provider under the protocol's `fork_selector` prompt and
  `fork_proposal` schema surfaces and validates its proposal; `createDependencyTreeRlForkSelector()`
  keeps the deterministic most-dependents heuristic. `selectTreeRlForkPoints` is unchanged.
- `computeTreeRlAdvantages(trees, normalization?)` computes the Algorithm 2 inter-root advantage
  (root reward minus the prompt's root mean) and intra-tree advantage (member reward minus the
  (K+1)-member tree mean), standardized per group by default (`group_std`: configured `sample`
  estimator, `epsilon` 1e-6) or raw (`none`), with an exact-value test against a hand-computed
  fixture.
- New `jsonl_v2` batch format: one line per graded member with per-action attribution (`prefix`
  actions carry the inter-root advantage, `suffix` actions the member's intra-tree advantage), and
  the `flat_grpo` baseline over the roots only.
- Root gradings and branch rollouts run with configurable `concurrency`
  (`APPLICATION_TREE_RL_LIMITS`); records append in prompt, root, branch order, so retained output
  is independent of concurrency.
- `exportTreeRlBatchToTrainer(store, applicationId, adapter)` is the optional trainer-export adapter
  seam (`TreeRlTrainerAdapter`); no trainer ships.
- New exports: `APPLICATION_TREE_RL_MEMBER_KINDS`, `APPLICATION_TREE_RL_ACTION_SEGMENTS`,
  `APPLICATION_TREE_RL_NORMALIZATIONS`, `APPLICATION_TREE_RL_LIMITS`, and the types
  `TreeRlPrompt`, `TreeRlForkSelector`, `TreeRlForkSelectionContext`, `TreeRlForkProposal`,
  `TreeRlForkDecision`, `TreeRlToolCall`, `TreeRlTurn`, `TreeRlRootRecord`, `TreeRlAdvantageTree`,
  `TreeRlActionAdvantage`, `TreeRlActionSegment`, `TreeRlMemberKind`, `TreeRlNormalization`,
  `TreeRlTrainerAdapter`, `MetaAgentTreeRlForkSelectorOptions`, and `TreeRlEvaluationPrompt`.

### Breaking Changes

- Applications protocol v8 (`APPLICATIONS_PROTOCOL_V8_CONTRACT`) replaces `applications.treeRl`:
  phases gain `root`, budget keys are `branches`, `groupSize`, `maxProviderCalls`
  (`maxForkPoints` and `minDependents` removed), the baseline kind `single_rollout` is replaced by
  `flat_grpo`, the batch format `jsonl_v1` by `jsonl_v2`, and the artifact role `source_session` by
  `root`. Configurations written for v7 are refused.
- `runTreeRlRollouts` options: `sourceSessionId` and `program` are replaced by `prompts`, and
  `selector` is required; `handlers` moved into each prompt. `TreeRlProviderContext`,
  `TreeRlRewardContext`, `TreeRlRolloutPlan`, `TreeRlRolloutRecord`, `TreeRlRunInspection`,
  `TreeRlTrainingLine`, `TreeRlTrainingBatch`, `TreeRlAdvantage`, and `computeTreeRlAdvantages`
  change shape; `TreeRlAdvantageInput` is deprecated. The provider factory is called after the root
  records are retained, so its refusals no longer write nothing.
- Tree-RL records (`application-tree-rl-rollout-v1` schema, same trace schema reference) change
  shape; runs retained before 10.0.0 are refused. The evaluation's Tree-RL binding takes `prompts`
  (roots recorded under `<sourceCommandId>:<prompt>:<group>`), its baseline is `flat_grpo`, and the
  application side now counts the roots; the repository report is regenerated (definition revision
  3).
- The per-rollout budget check counts in-flight projections under concurrency.

### Impact

Tree-RL batches now carry the paper's two-level credit assignment per action and can be driven by a
meta-agent. Callers must record G roots per prompt, pass a selector, and read `jsonl_v2` lines.
Nothing trains a policy; the meta-agent selector ran only against fixture providers here; the
standard deviation estimator and epsilon are this repository's pinned choice because the paper
names neither; `maxRollouts` (64) bounds B·G·K below the paper's configuration.

## [9.1.0] - 2026-09-25

### New Feature

- N-way diff (#217, paper §3.4): `diffReplaySessions(store, { sessionIds })` diffs two to the
  configured `replay.divergence.maxSessions` (16) replay sessions against their lowest common
  replay-session lineage ancestor, so sibling rollouts, candidate branches, workers, and nested
  branches can be compared; `analyzeReplayDivergence` still requires a direct source-branch pair.
  The result reports the ancestor (or `null` for unrelated roots), the shared base, each branch's
  lineage and index alignment against the ancestor, and every captured effect past the base by step
  content identity with the branches that captured it and whether the ancestor retains it.
- First-regression search: `findFirstReplayRegression(store, { sessionId, verdict, strategy })`
  evaluates a caller verdict over the revisions (step prefixes) of a session lineage with the
  configured deterministic strategies `bisect` (default) and `linear`, reports every evaluation,
  `first_bad`, and `last_good`, and attributes each revision to the lineage session that executed
  its newest step live.
- Read-only trace CLI: `shepherd-ts replay log [SESSION]`, `replay show SESSION`,
  `replay diff SESSION SESSION ...`, `scope list`, and `scope show SCOPE` open existing stores
  read-only, accept exact, prefix, and `@latest` selectors, and return the stable JSON results
  `replay_sessions`, `replay_log`, `replay_session`, `replay_diff`, `scopes`, and
  `lineage`/`scope`. The packaged-bin probe exercises `replay log`, `scope list`, and the
  `replay diff` usage refusal.
- New public exports: `diffReplaySessions`, `findFirstReplayRegression`,
  `REPLAY_REGRESSION_STRATEGIES`, and their option and result types.

### Improvement

- CLI pagination, read-only store opening, and single-selector parsing moved into the shared
  argument module used by every handler; behavior is unchanged.

### Impact

Additive: new functions, types, configuration keys (`replay.divergence.maxSessions`,
`replay.divergence.regressionStrategies`, `cli.messages.replayDiffUsage`,
`cli.messages.scopeUnavailable`), and CLI groups; existing APIs, records, and commands are
unchanged, and the compatibility gate accepted every change as additive. The N-way diff assigns no
divergence causes, scopes are shown with lineage but not diffed, and the meta-agent `diff` tool
remains pairwise.

## [9.0.0] - 2026-09-25

### New Feature

- Proof envelopes on inspections (#216, paper Appendix B): `inspectDurableTaskExecution`,
  `inspectReplaySession`, and `inspectChildRun` expose a frozen `proof` envelope defaulting to
  `runtime_only`, so claim strength is inspectable without a separate `classifyProofEnvelope` call.
  Replay-session receipts and run-ledger entries carry it too.
- Imported claims: a run artifact whose metadata carries the configured
  `formalAssurance.inspection.importedClaim.metadataKey` (`proof_envelope`) imports one
  `{ evidence_id, profile, strength, validator }` claim. It surfaces only as
  `metadata.claimed_proof_backed: true` plus `metadata.claim`; the envelope stays `runtime_only`
  and not proof-backed. Claims that are malformed, runtime-only, not issued by the configured
  reference validator, without a `proof-evidence:sha256:` identity, or ambiguous are reported in
  `metadata.claim_rejection`.
- Publication controls classify as the configured `extension` profile (`runtime_only` strength,
  `metadata.publication_controls`): retained-world settlement on a run (`delay`), rewind branch
  sessions (`fork`), replay branch sessions (`replay`), and delegated child runs with a supervisor
  handoff (`forwarding`).
- Optional lowering: `inspectReplaySession(store, { sessionId, lowerProof: true })` lowers an
  eligible static session (configured: `root` mode, `finished`, effect steps only, every effect
  materialized) into Core-A declaration, selection, handle, resume, return, and capture records and
  classifies them with the executable reference machine (`reference_core_a` /
  `reference_validated`, never proof-backed); ineligible sessions report
  `metadata.lowering_ineligible`.
- Configuration `formalAssurance.inspection` (formal assurance protocol v2,
  `FORMAL_ASSURANCE_V2_CONTRACT`) owns the extension profile, imported-claim key and rejections,
  publication-control kinds and sources, lowering eligibility and version, and envelope reasons,
  validated against the replay vocabularies.

### Breaking Changes

- `run-ledger-entry-v1.schema.json` requires `inspection.proof`; entries produced before 9.0.0 no
  longer validate, and earlier readers refuse entries carrying it.
- Formal assurance protocol v2 adds `formalAssurance.inspection`; configurations written for v1
  are refused.
- `DurableTaskExecutionInspection`, `ReplaySessionInspection`, and `ChildRunInspection` gain a
  required `proof` field; code that constructs these values or compares them structurally must
  include it.

### Impact

Callers can read the strength of every run and replay claim directly from inspections. Imported
proof claims are visible but never treated as verified, and publication controls are explicitly
outside the base theorem surface. Lowering is structural reference validation over retained
effect lifecycles; it does not establish source-to-kernel lowering adequacy, and no Lean build
runs in this repository.

## [8.0.0] - 2026-09-25

### New Feature

- Automatic coupled checkpoints (#210, paper §3.4, §5.3, Appendix D): `runReplaySession` and
  `replayReplaySession` accept `checkpointPolicy: { kind, interval? }` over the configured
  `replay.checkpoint.automatic.policies` (`REPLAY_CHECKPOINT_POLICIES`: `none`, `provider_step`,
  `effect_step`, `every_n_steps`); a session without it uses the configured `defaultPolicy`
  (`none`). A selected boundary is captured immediately before the step that selects it, with the
  same descriptor, cut, and record as an explicit `checkpoint()`; a replay branch captures only
  boundaries at or after its target. Every checkpointed step of a world- or process-bound session
  is a rewind and replay target: tests hash the restored world tree at every checkpoint against
  the source's tree at that boundary, and rewinding still compensates effects past the target
  exactly once. New types `ReplayCheckpointPolicy` and `ReplayCheckpointPolicyKind`.
- Tree-RL accepts world- and process-bound sources: fork points qualify only at boundaries with a
  restorable checkpoint, each rollout targets that checkpoint, and a new `bindings` factory
  (`TreeRlBindingsFactory`, `TreeRlRolloutBindings`) supplies per-rollout empty world roots,
  process adapters, and a handler stack.
- Trajectory compression accepts world- and process-bound workflows through `workflow.bindings`
  (`TrajectoryCompressionBindings`, `TrajectoryCompressionBindingsContext`: per-session role and
  seed) and `workflow.checkpointPolicy`; a fork point without a retained checkpoint settles
  `no_prune` as `unavailable` with the configured `boundaryWithoutCheckpoint` reason.
- `pnpm bench:checkpoints` (`scripts/bench-checkpoints.ts`,
  `config/checkpoint-benchmark.config.json`) measures on-disk storage growth per checkpoint; this
  repository's macOS measurement is recorded in `docs/generated/benchmarks/` and
  `docs/coupled-checkpoints.md`.

### Breaking Changes

- Replay protocol v2 (`REPLAY_PROTOCOL_V2_CONTRACT`) adds `replay.checkpoint.automatic`;
  configurations written for replay protocol v1 are refused. Replay records are unchanged
  (`shepherd.replay.v1`).
- `runTreeRlRollouts` no longer refuses a world- or process-bound source with
  `ApplicationEvidenceError`; it requires the `bindings` factory for such a source (`TypeError`
  before any record) and refuses one with no restorable provider fork point.

### Impact

World-bound agent sessions can be rewound and replayed at every step a configured policy
checkpoints, and Tree-RL and trajectory compression can run over them. Step boundaries without a
checkpoint remain refused for world-bound sessions (address checkpoints with `{ checkpointId }`).
Each checkpoint stores changed file bytes plus a full world manifest, so storage grows with the
world's entry count per checkpoint; the measured figures are one host's, not a bound.

## [7.0.0] - 2026-09-25

### New Feature

- Effect compensation (#209, paper §3.2, Appendix A.2): `createEffectCompensationRegistry`
  registers exactly one compensation handler per effect kind. `discardScope`,
  `rewindReplaySession`, and `replayReplaySession` accept an optional `compensation` registry and
  compensate every successful effect of a compensable tier (`effects.compensation.compensableTiers`,
  `EFFECT_COMPENSABLE_TIERS`) that they abandon: effects cited by the selected history of a scope the
  discard seals (replay effect steps and supervised dispatch resolutions), and effects the source
  session materialized at or after the branch target. Compensation runs in reverse materialization
  order, once per original materialization (`deriveEffectCompensationId`), so a discard, a rewind, a
  replay, and an explicit `compensateEffects` command share one compensation and a retry never
  compensates twice. Recorded replay steps resolve to the live step they copy.
- Compensation intent, every attempt (handler identity and trigger), and every outcome
  (`compensated` or `failed` with the handler's result) are retained as
  `shepherd.effect.compensation.v1` records on a reserved owner path
  (`effect-compensation:sha256:`), validated by `inspectEffectCompensation` with the derived status
  `pending`, `uncertain`, `failed`, or `compensated`. Handlers receive a stable idempotency key; an
  attempt interrupted after the world changed is re-invoked under the same key, and a
  `compensated` outcome is never followed by another invocation.
- New errors `EffectCompensationHandlerNotFoundError`, `EffectCompensationFailedError`,
  `EffectCompensationConflictError`, and `EffectCompensationEvidenceError` (codes in
  `effects.compensation.errors`); schema `spec/schemas/effect-compensation-v1.schema.json`.
- Tool-loop calls of `compensable` tools are compensated like any other effect (replay-bound calls
  on rewind or replay, supervised calls when a discarded scope cites them); meta-agent worker
  definitions accept an optional `compensation` registry used by the `rewind` and `replay` tools.
- Fault evidence: a node:sqlite row-insert fixture compensated by an idempotent delete, a SIGKILL
  suite (`test/faults/compensation-kill.test.ts`, `faults.processKill.compensation`) that kills a
  compensating child at seeded delays and requires one world change per effect after recovery, and
  deterministic kills after the handler's world change and after the retained outcome.

### Breaking Changes

- Effect protocol v2 (`EFFECT_PROTOCOL_V2_CONTRACT`) adds `effects.compensation`; configurations
  written for effect protocol v1 are refused.
- `discardScope`, `rewindReplaySession`, and `replayReplaySession` now refuse, before writing
  anything, to abandon a successful compensable effect that is not yet compensated unless a
  `compensation` registry supplies a handler for its kind
  (`EffectCompensationHandlerNotFoundError`), and fail with `EffectCompensationFailedError` when a
  handler returns a failure result (a discard reports it after its logical decision and cleanup).
- `SQLiteTraceStore.append` and `publishCut` refuse owner paths with the compensation prefix.

### Impact

Compensable effects are no longer vocabulary only: abandoning work through a discard or a branch
reverses its compensable side effects exactly once and leaves auditable evidence. Callers that
discard scopes citing compensable effects, or branch past compensable replay steps, must pass a
`compensation` registry. Handlers must be idempotent under the supplied key; there is no
compensation lease, no waiver for a permanently failing compensation, and effects without a
retained successful outcome are not compensated.

## [6.0.0] - 2026-09-25

### New Feature

- Tool-use loop (#206, paper Figure 1, §3.2, Appendix A.2, F.2.3): `runToolLoop` runs a bounded
  multi-turn conversation in which every tool call whose input satisfies the tool's JSON Schema
  (`compileJSONSchema`) becomes an effect intent of the tool's `effectKind` and reversibility with
  the runtime-derived identity `<effectIdPrefix><loopId>:<turn>:<call>`, dispatched through
  `createHandlerToolLoopEffects` (handler stack), `createSupervisedToolLoopEffects`
  (`dispatchSupervisedEffect`, so interceptors deny before any outcome), or
  `createReplayToolLoopBindings` (replay session provider and effect steps). Calls resolve as
  `materialized`, `denied`, `invalid`, or `failed` (`TOOL_CALL_DISPOSITIONS`); the loop ends
  `completed` or at the configured turn bound (`TOOL_LOOP_STATUSES`,
  `providers.tools.loop`), accepts guidance between turns, reports each turn to an observer, and
  honors an abort signal.
- Replayable loops: `createToolTurnProvider` and `encodeToolTurnRequest` encode each turn as a
  replay provider step, so `replayReplaySession` serves a recorded loop prefix byte-identically
  without calling the model or any handler.
- Substrate-native meta-agent tools: `providers.tools.metaAgent.tools` declares `observe`, `fork`,
  `discard`, `rewind`, `replay`, `read_trace`, and `diff` with JSON Schemas, and
  `createMetaAgentTools` backs them with `inspectReplaySession`, a world adapter
  (`createScopeWorldAdapter`) plus `runReplaySession`, `rewindReplaySession`,
  `replayReplaySession` under declared worker variants, bounded owner-path reads, and
  `analyzeReplayDivergence`. The paper's F.2.3 proposer names are mapped in
  [docs/tool-use-loop.md](docs/tool-use-loop.md#paper-proposer-tool-names).
- Tool wire support: `ModelToolUseBlock`, `ModelToolResultBlock`, and `ModelToolDefinition`;
  `ModelConversationRequest.tools`; both live dialects map tool definitions, `tool_use` /
  `tool_calls`, and `tool_result` / role `tool` messages under per-kind `toolUse.requestField` and
  `toolUse.stopReasons`, and live kinds declare `tools: true`. `createProgramConversationProvider`
  scripts conversational and tool-calling models offline.

### Breaking Changes

- `ModelContentBlock` is now `ModelTextBlock | ModelToolUseBlock | ModelToolResultBlock` and
  `MODEL_CONTENT_BLOCK_TYPES` is `["text", "tool_use", "tool_result"]`; `ModelTextBlock.type` is
  the text discriminant only. Code that reads `.text` from every block must narrow on `type`.
- Provider protocol v3 (`PROVIDER_PROTOCOL_V3_CONTRACT`) adds `providers.tools`, each live kind's
  `toolUse`, and `providers.program.conversationCapabilities`; configurations written for v2 are
  refused.
- A live `converse` response whose stop reason is a configured tool-use stop reason returns
  `output: null` with the tool-use blocks in `message`; a complete response carrying tool calls is
  a `LIVE_PROVIDER_RESPONSE_INVALID` error.

### Impact

An LLM meta-agent can observe, fork, discard, rewind, replay, read, and diff another agent's trace
through tools, and every call is an interceptable, replayable effect. The loop, its effect
boundaries, and the meta-agent tools are exported from the root and `./applications`; tool message
types and `createProgramConversationProvider` also from `./providers`. Requests without tools are
byte-identical to 5.1.0. The meta-agent model is scripted in every test; no live model ran the loop
because no credentials were available.

## [5.1.0] - 2026-09-25

### New Feature

- Live model provider adapters (#204, paper §3.1, §4, Appendix C.6, §5, Appendix D): provider kinds
  are declared in configuration (`providers.kinds`, `providers.live.kinds`; provider protocol v2)
  and generated as `PROVIDER_KINDS`. `createLiveProvider` builds a `ConversationalModelProvider`
  for the configured `anthropic` (Anthropic Messages), `openai`, and `openrouter`
  (OpenAI-compatible chat completions) kinds. Endpoints, headers, API version, credential header
  and environment variable, cache-control shape, output-token field, structured-output format, and
  complete stop reasons come from configuration; the injectable `LiveProviderTransport` defaults to
  the global `fetch`.
- The Anthropic adapter places `cache_control: {type: "ephemeral"}` on the last content block of
  the last prefix message and reports `cache_read_input_tokens` and `cache_creation_input_tokens`
  as `ModelUsage` cache tokens; the OpenAI-compatible adapter reports
  `prompt_tokens_details.cached_tokens` and places the configured marker for OpenRouter.
- Provider-neutral multi-turn message model: `ModelMessage`, `ModelContentBlock` (text today; the
  extension point for tool blocks in #206), `ModelConversationRequest` with `cachePrefixMessages`,
  and `ModelConversationResponse`, with configured `MODEL_MESSAGE_ROLES` and
  `MODEL_CONTENT_BLOCK_TYPES`.
- `createProviderConversation` holds a multi-turn conversation over a conversational provider and
  supplies a `ReplayProviderSessionAdapter` whose checkpoint and restore resend a byte-identical
  message prefix after rewind, declares a `provider-prefix:` cache identity, mirrors the session's
  context prefix chain (including failed turns), and can `rebuild` from retained steps.
- `LiveProviderError` with configured codes `LIVE_PROVIDER_CREDENTIAL_MISSING`,
  `LIVE_PROVIDER_TRANSPORT_FAILED`, `LIVE_PROVIDER_HTTP_FAILED`, and
  `LIVE_PROVIDER_RESPONSE_INVALID`; provider error detail is bounded and the credential is redacted.
- Adapters reject with the caller's `AbortSignal` reason while a request is pending.

### Impact

Tasks, replay sessions, and research applications can run against a real provider by passing a
live provider, and replay after rewind reuses the provider's prompt cache. Credentials are read
only from the caller definition or the configured environment variable and never reach retained
records (whole-store secret-scan test). The replay-session and run-ledger schemas admit the new
provider kinds (additive). Evidence is stub-transport and simulated-cache tests; the opt-in live
test (`SHEPHERD_LIVE_PROVIDER_TEST=1`) was not run because no credentials were available, so no live
cache-hit rate is measured. No streaming, tools, cost reporting, or retries; checkpoint receipts
are process-local. See [live providers](docs/live-providers.md).

## [5.0.0] - 2026-09-25

### Breaking Changes

- Trajectory compression (#208): retained `shepherd.application.compression.v1` candidate records
  carry a required `fork_clamp` field, and a retained `fork_point` may be step `0` with a `null`
  `prefix_id`; `TrajectoryForkPoint.prefix_id` is `string | null`. 4.0.0 compression records no
  longer decode, so 4.0.0 compression runs cannot be inspected or resumed.
- The proposal grammar (`$defs.proposal`) makes `fork_point`, `hint`, and `fork_point.step_index`
  optional, admits any integer step, and admits a `null` prefix identity. A proposal that was
  refused before (step 0, a step at or beyond the source step count, a hint without a fork point,
  a missing fork point) now settles instead of raising `ApplicationEvidenceError`.
- Evaluation report version 2 (applications protocol v7): `ApplicationEvaluationReport` gains a
  required `rescues` field; `validateApplicationEvaluationReport` refuses version 1 reports.

### New Feature

- Fork step `0` restarts from the initial prefix with the hint applied (Appendix D.5).
- Out-of-range fork steps are resolved by the configured `applications.compression.forkStepPolicy`,
  one of `forkStepPolicies` (`clamp`, `reject`; `APPLICATION_COMPRESSION_FORK_STEP_POLICIES`). The
  repository default `clamp` moves the step to the nearest bound of `[0, n - 1]` (Appendix D.6) and
  retains `fork_clamp { policy, proposed_step_index, proposed_prefix_id }` on every candidate record;
  `reject` refuses the proposal. New public types `TrajectoryForkClamp` and `TrajectoryForkStepPolicy`.
- A missing fork step (absent or null fork point, or a fork point without `step_index`) settles
  `no_prune`, with or without a hint (Appendix D.6).
- `ApplicationEvaluationReport.rescues` (`ApplicationEvaluationRescues`): the experiments whose
  baseline failed its success condition while the application run passed (Appendix D, Table 12),
  rendered in the generated page under "Rescues".

### Impact

Compressors may now propose a full restart or an out-of-range step without losing the candidate;
the applied clamp is auditable on the record. Consumers of retained compression evidence and of
evaluation reports must re-run on 5.0.0. The repository Appendix D protocol is `appendix-d.v2`
(schema surface `compression.fork-hint.v2`), the evaluation definition is revision `2`, and the
regenerated report measures zero rescues: compression requires a finished source and no task-level
source success judge is run (new `rescue-scope` limitation). Compression step counts and ratios in
the report are unchanged.

## [4.0.0] - 2026-09-25

### Breaking Changes

- Counterfactual optimization (#207): every candidate passed to `runCounterfactualOptimization`
  must declare `scope`, one of `APPLICATION_CRO_EDIT_SCOPES` (`request`, `downstream`, configured
  as `applications.cro.editScopes`, applications protocol v6). A candidate without it is a
  `TypeError`; an unknown scope is `ApplicationProtocolError` before any record.
- Retained `shepherd.application.cro_candidate.v1` plans carry `edit_scope`, which also enters the
  candidate identity, so candidate identities, branch sessions, and records differ from 3.0.0 and
  3.0.0 optimizer runs cannot be inspected or resumed. The candidate record schema now allows target
  `step_index` 0 with a `null` `prefix_id`; `CounterfactualTarget.prefix_id` is `string | null`.
- A `request` candidate whose change dimensions cannot alter the kind of its edited step (task or
  provider for a provider step, handlers for an effect step) is refused with
  `ApplicationProtocolError` after the baseline and before the `opened` record, or with
  `ApplicationEvidenceError` before a child's `proposed` record.

### Defect Fixes

- The optimizer always replayed from the first dependent of the edited step, so the edited step was
  served from the journal and a final-step edit evaluated nothing. A `request` edit now replays from
  the boundary before the edited step (Appendix F.1, first affected event): the edited step runs
  live and diverges as `root`, and a final-step edit replays one live step. A `downstream` edit
  keeps the first-dependent target, or zero live steps when nothing depends on the edited step.

### New Feature

- `CounterfactualEditScope` type and `APPLICATION_CRO_EDIT_SCOPES` constant, exported from the root
  and `./applications`; the repository Appendix F `propose_candidate` tool schema and proposer prompt
  require the scope.

### Impact

Instruction and provider edits to a step are now evaluated on that step. Callers must add `scope`
to every candidate: `request` for edits that change the edited step's own request (the usual case
for task and provider edits), `downstream` to keep the previous first-dependent behavior. The
checked application evaluation report was regenerated: the counterfactual fixture's two `request`
candidates replay 7 compared provider calls (was 2) against the unchanged full-replay 8.

## [3.0.0] - 2026-09-25

### Breaking Changes

- Application protocols (#205): `readApplicationProtocol` now compiles every `schema` surface with
  `compileJSONSchema`, so a protocol whose schema surface uses vocabulary outside the supported
  JSON Schema 2020-12 subset (for example `$ref`, `$defs`, `format`, `not`, `patternProperties`)
  or is not a schema at all is refused with `ApplicationProtocolError` before any record.
  Previously schema surfaces were pinned by digest and never evaluated.
- `runCodingSupervisor` refuses a policy decision whose action message `{ kind, reason,
  worker_id }` the protocol's `action` schema refuses (`JSONSchemaValidationError`, not applied or
  retained), and stops with `ApplicationProtocolError` when a round's observation message is not
  admitted by the `observation` schema. Trajectory compression rejects a proposal the
  `compression` schema refuses; counterfactual optimization and Tree-RL refuse a handoff manifest
  or batch line their `handoff` or `training_batch` schema refuses.
- Task schema parse failures are now `JSONSchemaValidationError`, a `TypeError` subclass with the
  new public code `SCHEMA_VALIDATION_FAILED`, so `isPublicError` returns `true` for them. Object
  field mismatches are reported per field (`$.x is not a declared task schema field`,
  `$.y is a required task schema field`) instead of one object-level message.

### New Feature

- Task schemas (#205): `schema.number()`, `schema.integer()`, `schema.boolean()`, `schema.null()`,
  `schema.array(items)`, `schema.enum(values)`, `schema.literal(value)`, `schema.union(members)`
  (JSON Schema `oneOf`), and `schema.optional(field)` inside `schema.object()`, with static type
  inference (`TaskOptionalSchema`, `TaskSchemaScalar`, `OptionalTaskSchemaShapeKeys`,
  `InferTaskSchemaShapeField`). Invalid values, including invalid provider output, are refused
  with a path-level issue such as `$.findings[2].line must be a safe integer`.
- `schema.fromJSONSchema`, task registry decoding, task values, and the generated
  `task-descriptor-v1`, `task-value-v1`, and delegation schemas accept the matching documents
  (`type` number/integer/boolean, `{ type: "array", items }`, `enum`, `const`, `oneOf`, and
  `required` as a subset of the declared properties).
- Reusable validator: `compileJSONSchema(document)` returns a frozen validator whose `validate`
  lists every `{ path, keyword, message, schemaPath }` issue and whose `parse` returns a frozen
  canonical snapshot or throws `JSONSchemaValidationError`; `JSON_SCHEMA_SUPPORTED_KEYWORDS` lists
  the closed subset. Exported from the root and `./tasks`. `pattern` is compiled without
  complexity bounds, so schema documents must come from trusted configuration.
- `runCounterfactualOptimization` receipts carry `handoff`, the Appendix F handoff manifest derived
  from retained candidate records and validated against the pinned handoff schema
  (`CounterfactualHandoff`, `CounterfactualHandoffCandidate`).
- Docs: new [JSON Schema validation](docs/json-schema-validation.md) page; task descriptors,
  Python-to-TypeScript guide, coding supervisor, trajectory compression, counterfactual
  optimization, Tree-RL, application manifests, public errors, package exports, README paper
  coverage, and the paper coverage map updated.

### Impact

Tasks can declare realistic typed inputs and outputs, and the Appendix E and F protocol schemas
now constrain what runs at runtime. Existing task descriptors keep byte-identical documents and
artifact locks. Callers with custom application protocols must keep their schema surfaces inside
the supported subset and their policies consistent with their own action schemas. The repository
protocols in `config/research-applications.config.json` are unchanged.

## [2.36.0] - 2026-09-25

### New Feature

- CommonJS `require()` for the root and every subpath through Node's require(esm): every export
  carries a `default` condition; the installed-package test requires every subpath and checks
  identity with `import`, a `.cts` `import = require()` probe typechecks, and
  `test/package-require.test.ts` refuses top-level await in any export graph (#224).
- `ConfigurationAssetError` (root export, public code `CONFIGURATION_ASSET_MISSING`, `asset` and
  `expectedPath` properties, ENOENT kept as `cause`): thrown during module evaluation when a
  bundled or installed module cannot find `runtime.config.json`, `protocol.config.json`, or
  `public-errors.config.json`, or when the bundle format has no `import.meta.url` (esbuild CJS;
  previously `TypeError: Invalid URL`). The code is configured in `public-errors.config.json`
  `codes.configuration.assetMissing` and generated into `src/protocol/values.generated.ts` so it
  is available when the configuration itself is missing. Installed Rollup fixtures now also build
  and run a CommonJS bundle (`cjsOutput`) and assert the error for each missing asset (#225).
- Publication preparation (#221 prep, #222; `"private": true` kept per decision D-020):
  `publishConfig` (`access: public`, `provenance: true`), `keywords`, `author`, an explicit
  `sideEffects` list, and a `prepublishOnly` guard (`scripts/prepublish-guard.ts`) that refuses
  publication when any `main`, `types`, `bin`, or `exports` target is missing. One attested packer
  (`tooling/release/pack.ts`, `reproducibleBuild.packCommand`) serves the reproducible-build gate,
  installed conformance, and `release.yml`, which publishes that tarball with trusted publishing
  only and `--ignore-scripts`. D-020 and an owner publication checklist are recorded.
- Node 26 support (#228): `engines.node` and `runtime.config.json` widen to `>=24.12.0 <27`.
  `pnpm verify` exits 0 on Node 26.10.0 and on Node 24.17.0, and `pnpm test:runtime-boundaries`
  now also runs the installed consumer on the latest supported major
  (`SHEPHERD_LATEST_MAJOR_NODE`, a new `boundaries` entry in
  `config/runtime-verification.config.json`); evidence is in `docs/runtime-support.md`. The
  single-range policy also admits the end-of-life odd-major Node 25 line, which is unverified.
- Minimum consumer TypeScript 5.9.3 (`config/runtime-verification.config.json` `typescript`):
  the installed-consumer test checks the repository compiler against it and, with
  `SHEPHERD_MINIMUM_TYPESCRIPT` (set by `pnpm test:runtime-boundaries`), repeats the typechecks
  with TypeScript 5.9.3 (#222).
- Packed README link gate (#223): `tooling/release/readme-links.ts` and the `packedReadme` section
  of `config/release-integrity.config.json`; `pnpm test:package-cli` fails on a relative README
  link whose target is not packed, on an absolute repository link whose file is missing from the
  checkout, and when the Node or TypeScript requirement is missing or follows contributor setup.

### Improvement

- The package no longer ships source maps or `@internal` declarations (#227): the build sets
  `sourceMap`/`declarationMap` to false and `stripInternal`; installed conformance asserts no
  `.map` files, no `sourceMappingURL`, no `@internal`, and typechecks every shipped `.d.ts` with
  `skipLibCheck: false`. Five declarations referenced by shipped declarations lost their
  `@internal` tag (`TraceArchiveLimitsConfig`, `CanonicalizationConfig`, and three settlement
  encoding types); the unused `createTaskArtifactLock` re-export is marked `@internal`.
- README is consumer-first (#223): 52 links to unpacked files are absolute repository URLs (they
  return 404 while the repository is private), 6 packed-file links stay relative, and the
  requirements list the TypeScript minimum and ESM/`require()` support.
- `docs/package-exports.md` records the `@arethetypeswrong/cli` 0.18.5 result and an esbuild
  recipe (ESM layout; CJS `--define:import.meta.url` with an `--inject` shim), verified manually
  with esbuild 0.28.2 through `npx`. An in-repo esbuild fixture is pending owner approval of an
  esbuild development dependency (#225).
- The packaged-CLI test runs the documented quickstart in a fresh consumer install with a
  wall-time budget (10 s) and a retained-state budget (1 MiB), configured in the `quickstart`
  section of `config/runtime-verification.config.json` (#226).
- `test/release-pack.test.ts`, `test/prepublish-guard.test.ts`, and `test/readme-links.test.ts`
  cover the new release tooling; the files are in `coverage.include`.

### Defect Fixes

- The installed quickstart no longer binds the whole working directory, which captured
  `node_modules` (#226): `examples/quickstart.mjs` binds a dedicated `quickstart-workspace/`
  directory. After a local tarball install the flow drops from about 48 s and 43 MB of `.vcscore`
  to about 1.3 s and 300 KB. The transcript is unchanged; the selected file lands at
  `quickstart-workspace/NOTE.txt`. `shepherd-ts demo write quickstart` therefore emits new bytes
  and a new `byte_length`.
- `docs/generated/sbom.cdx.json` regenerated for the 2.36.0 package identity.
- The deep-nesting test in `test/canonical-json-text.test.ts` assumed native `JSON.stringify`
  overflows at 200,000 levels, which is false on Node 26; it now accepts either a native
  `RangeError` or native output equal to `serializeJsonText`. The runtime policy test checks every
  configured boundary runtime against the configured range.

### Impact

Node 26 consumers can install and run the package. CommonJS consumers can `require()` the
package on supported Node versions. Bundled consumers that lose the configuration assets get a typed `ConfigurationAssetError` instead of an ENOENT or
`Invalid URL`. The tarball is smaller (no maps, no internal declarations); consumers that relied on
shipped source maps or on `@internal` declarations lose them. Scripts that expected the
quickstart file at `NOTE.txt` must read `quickstart-workspace/NOTE.txt`. npm publication remains
blocked on the owner actions in #221; the compatibility baseline adds the new export and error
code.

## [2.35.1] - 2026-09-25

### Improvement

- README restructured for readers and consumers: a contents list, a concepts table mapping each
  primitive to its package entry, a condensed status table, the paper coverage table, consumer
  installation, a quick start verified against the installed package, a package-entry table,
  grouped documentation links, a development command table, and the tag-based release procedure.
- Removed from the README: the 230-line capability inventory, the multi-page API example, the
  phase-by-phase status history, and the flat 70-link documentation list. That content remains in
  `CHANGELOG.md`, `.plan/tracker.md`, the phase exit audits, and `docs/README.md`.
- Regenerated `docs/generated/sbom.cdx.json`, which picks up the development dependency bumps
  merged by Dependabot without regeneration (#193 Biome 2.5.14, #194 `@types/node` 26.6.1, #195
  `yaml` 2.9.1).

### Impact

Documentation only; no runtime, API, protocol, or storage change.

## [2.35.0] - 2026-09-25

### New Feature

- `release.yml` now creates GitHub Releases. Pushing a `v<version>` tag (or dispatching with
  `release=true`) runs a version gate (tag, `release-config.yaml`, `package.json`, and a
  `CHANGELOG.md` section must agree), the existing `pnpm verify:release` build and tarball
  attestation, and a `github-release` job that publishes `release/` (tarball, SBOM, provenance,
  release manifest, reproducible-build report) as release assets with the version's changelog
  section as notes. Versions with a pre-release suffix become pre-releases; an existing release is
  never overwritten. The job uses the preinstalled `gh` CLI, adding no action dependency.
- The npm publish job runs only on manual dispatch with `publish=true` and now refuses a
  `"private": true` tarball before contacting the registry. The workflow has not run on hosted
  runners (billing limit, #191/#199); it passes `actionlint` with shellcheck, and its shell steps
  were exercised locally.

### Improvement

- Re-audited the Shepherd paper v3 (arXiv 2605.10913) section by section against the code. Filed
  the gaps as #204-#219 under epic #202: live providers with prompt-cache reuse, wider task
  schemas, a tool-use loop with substrate-native meta-agent tools, CRO edited-step replay and the
  Algorithm 1 loop, compression `fork_step` clamping, compensation handlers, automatic per-step
  world checkpoints, a concurrent supervisor, Tree-RL Algorithm 2, scope benchmarks, layered
  checkpoints, run proof envelopes, N-way diff and trace CLI, and the A.2 research backlog.
- `.plan/paper-coverage.md` gains a "Known deviations" section linking each gap to its issue.
- Verified npm publication readiness locally (pack, publint, attw, strict ESM consumer across
  every subpath, CLI, Node range). Filed the owner blockers and consumer-quality items as
  #221-#228 under epic #220.
- README: a paper-coverage-at-a-glance table, a consumer tarball install section, links to the
  research application docs, and corrections to stale statements (the `2.0.1` capability header,
  Phase 11 "in progress", live providers and later phases described as future work, and
  compensation claimed without handlers).

### Impact

No runtime, API, or storage change. Maintainers can cut a GitHub Release with the verified
package by pushing a version tag once hosted Actions are available; npm publication stays gated
by the owner decision in #221. Readers see which paper behaviors differ from the implementation
and where each gap is tracked.

## [2.34.0] - 2026-09-23

### New Feature

- Linux variant of the real-volume disk-full suite (#199): `pnpm test:faults:volume` formats a
  16 MiB sparse image as ext4 with no root-reserved blocks and loop-mounts it
  (`loop,nodev,nosuid,noexec`) with the commands in `faults.diskFull.volume.linux` of
  `config/hardening-suites.config.json`. It needs root and loop devices (a privileged container)
  and otherwise skips with an explicit reason. It passed as root in a privileged
  `node:24.21.0-bookworm` container on the macOS arm64 reference host and still passes on macOS.
- Linux SLO host class `linux-arm64-overlayfs-container` in `config/performance-slo.config.json`
  (linux, arm64, temporary directory on overlayfs). Budgets come from two `pnpm bench:kernel` runs
  in a Linux container in OrbStack's VM on the reference host, using the existing rule; the
  artifact is `docs/generated/benchmarks/linux-arm64-overlayfs-container.json`, and
  `pnpm check:slo` passes there instead of skipping. This is a container-in-VM measurement, not
  bare-metal Linux and not x86-64.

### Improvement

- The volume suite now fills until an append fails. The first Linux run showed that on ext4 an
  append can still commit after blob puts start failing, because SQLite reuses write-ahead-log
  space it has already allocated. Every earlier failure must be a typed space error with an
  unchanged export and no readable failed blob, and the first failure of each kind is retried.
- The macOS `hdiutil` commands, image name, and probe of the volume suite moved from the suite into
  `faults.diskFull.volume.macos` of `config/hardening-suites.config.json`, matching the Linux
  variant.
- `ci.yml` drops the `windows-latest` runner and the Windows-only `verify:serial` step (matrix:
  `ubuntu-latest`, `macos-latest`); `pnpm verify:serial` remains a local script.
- Owner decisions of 2026-09-23 closing #199, documented (decision D-019):
  - A recheck found the repository still private, npm not authenticated, and hosted `CI` run
    35868089999 again blocked by the Actions billing limit; `CI` was disabled again.
  - The external security review (O-1), signing and publication (O-2), and npm name reservation
    (O-5) are waived for 1.0. No external review has been performed.
  - Hosted CI stays disabled. The local macOS gates plus the local Docker Linux lane replace it
    (O-3). CodeQL and the private advisory form are waived while the repository is private.
  - There is no Windows lane.
  - F-008 and F-010 are accepted by owner decision.
- Docs: a 2.34.0 addendum to the Phase 11 exit audit; the owner-owed register, security review,
  threat model, `SECURITY.md`, support policy, release integrity, 1.0 release notes, incident
  response, fault and fuzz conformance, performance report, release-candidate manifest, readiness
  dashboard, testing plan, decisions, roadmap, tracker, and READMEs are updated.

### Impact

1.0 (the L4 milestone, D-016) is reached as a private, unpublished source release with the listed
waivers. It does not include an external review, signing, publication, hosted CI, CodeQL, Windows,
or bare-metal or x86-64 Linux verification. No public API, protocol, schema, or CLI change; the
package stays `"private": true`.

## [2.33.3] - 2026-09-23

### Defect Fixes

- The packed file set depended on the npm version (F-032, #191). The top-level `files` entries
  `README.md`, `LICENSE`, `NOTICE`, `api-reference.config.json`, and `examples` were unanchored
  gitignore-style rules: npm 11 (npm-packlist 10) matched them in every directory it walked and
  packed `docs/README.md` and `spec/README.md`, while npm 12 (npm-packlist 11) matched them only
  at the package root. They now start with `/`. With the fix, npm 11.19.0 and npm 12.0.2 pack the
  same 1,406 files and byte-identical tarballs on the reference host.

### Improvement

- Packed file-set check: `tooling/release/packed-files.ts` requires every `files` entry to be a
  literal path and every top-level entry to start with `/`, and compares a packed tarball with the
  allowlist plus the configured always-included files (`packedFiles` in
  `config/release-integrity.config.json`). `pnpm test:package-cli`, and so `pnpm verify`,
  `pnpm verify:release`, and `release.yml`, fails on any undeclared or missing file. Tests in
  `test/release-integrity.test.ts` cover the rules and the npm 11 file list that exposed F-032.
- Owner decisions of 2026-09-23 (#191), documented: an attempt to enable the hosted `CI` and
  `Dependency Audit` workflows was blocked (the dispatched `CI` run started no job because of an
  account billing or spending-limit restriction), so both are disabled again and no hosted run has
  passed; `CodeQL` was not enabled because code scanning on a private repository requires GitHub
  Advanced Security; vulnerability reports go by private email while
  the repository is private and through the advisory form once it is public (the contact-request
  issue path is removed, and the issue templates point to `SECURITY.md`); the registry name is
  `@avnionur/shepherd-typescript` (D-011), and an unscoped `shepherd-ts` package is not pursued.
- Docs: owner release runbook and packed file-set section in release integrity; `SECURITY.md`,
  incident response, threat model, support policy, compatibility policy, runtime support, and
  1.0 release notes; production hardening contract register, security review (F-008 narrowed,
  F-009 resolved, F-010 deferred, F-032 fixed), release-candidate manifest, readiness dashboard,
  testing plan, decisions (D-011), roadmap, tracker, and a #191 addendum to the Phase 11 exit audit.
  Signing, publication, the external review, hosted runs, CodeQL, the Windows lane decision, and
  the Linux volume-fault and SLO lanes are deferred to #199.

### Impact

The published file set no longer depends on the npm version that packs it. No public API,
protocol, schema, or CLI change; the package stays `"private": true`, and 1.0 general
availability stays conditional until #199 closes.

## [2.33.2] - 2026-09-19

### Defect Fixes

- `createJsonLinesTelemetrySink` failed with `RangeError: Maximum call stack size exceeded` on
  Linux when a batch held an included body at the canonical nesting bound (F-016 follow-up, #190).
  The OTLP `AnyValue` shape spends about four levels per body level, so an at-bound body nests
  about 4,000 levels, past what native `JSON.stringify` accepts on Linux (Node 24.21.0 and 24.12.0)
  even from a shallow stack. The sink now serializes each request with the internal explicit-stack
  `serializeJsonText` (`src/canonical/json-text.ts`), which the canonical encoder also uses. Its
  output is byte-identical to `JSON.stringify` for plain data, so the line format is unchanged.
  Native `JSON.parse` is iterative, so reading lines back and archive decoding were not affected.

### Improvement

- Tests: `test/canonical-json-text.test.ts` (differential against `JSON.stringify` on 5,000
  seeded random trees, omission, ordering, and scalar edge cases, cycle and `bigint` refusals,
  200,000 levels); the at-bound telemetry case now writes the batch through the JSON-lines sink
  from a 6,000-frame caller and compares the lines, and the passive export case checks the
  serializer against `JSON.stringify` on a real batch.
- Docs: observability (sink line serialization), canonical records, the security review (F-016
  row), and the Phase 11 exit audit addendum (final Linux and macOS results).

### Impact

`pnpm verify` passes on Linux. No public API, protocol, schema, or file format change.

## [2.33.1] - 2026-09-19

### Defect Fixes

- `fs.rmSync` on Node.js 24.12.x and 24.13.x (inside the supported `>=24.12.0` range) silently
  leaves a dangling symbolic link in place (F-031, #190). Every product removal now goes through
  the internal `removePathSync` (`src/runtime/remove-path.ts`), which unlinks a symbolic link
  itself and delegates other paths to `rmSync`. The reachable case was a failed symbolic-link
  replacement in the reference copy carrier, which could leave a hidden dangling staged link in
  custody or, during selection publication, in the canonical workspace. The
  `createVerifiedWorldChangeset` fuzz fixture uses the same helper and no longer fails with
  `EEXIST` on Node 24.12.0.
- The RLIMIT_FSIZE fault case no longer depends on the shell (F-030, #190): the limit is
  `faults.diskFull.fileSizeLimitBytes` (1 MiB, replacing `fileSizeLimitBlocks`) converted to the
  `ulimit -f` unit of `/bin/sh`, measured by a probe child (512 bytes in dash, 1024 in the macOS
  bash 3.2), and size-limited children run with `NODE_V8_COVERAGE` empty, so the limit can no
  longer truncate a coverage file. Before, `pnpm verify` failed its coverage report on Linux
  although every test passed. The case now asserts `ERR_SQLITE_ERROR` with `errcode` 778 for all
  four operations.

### Improvement

- Linux verification lane (#190): every `pnpm verify` gate runs in Docker on Node 24.21.0 and
  24.12.0 (Debian bookworm, unprivileged user), plus runtime boundaries, the extended fuzz run,
  and the privileged Linux carrier suite; results are in the Phase 11 exit audit addendum, which
  records the F-016 resolution and the re-scoped verdict (Phase 11 in-repo scope complete; owner
  actions O-1 to O-5 move to #191).
- Security review: F-030 and F-031 fixed; F-032 (Low, open for the owner's release work in #191):
  the packed file set depends on the npm version (npm 11 adds `docs/README.md` and
  `spec/README.md`).
- Tests: `test/runtime/remove-path.test.ts` (dangling and chained links with every option set, link
  targets untouched, `rmSync` semantics kept, no direct `rmSync` in `src/`) and a reference copy
  carrier case for an injected rename failure during symbolic-link replacement; both fail on
  Node 24.12.0 without the fix.
- Docs: threat model (carrier cleanup, packed file set, F-008 rows), fault and fuzz conformance,
  production hardening contract owner-owed register (links #191), release-readiness dashboard,
  support policy, release notes, and the tracker.

### Impact

`pnpm verify` passes on Linux and on the minimum supported Node. No public API, protocol,
schema, or CLI change; `faults.diskFull.fileSizeLimitBlocks` in the test-only
`config/hardening-suites.config.json` is replaced by `fileSizeLimitBytes`.

## [2.33.0] - 2026-09-19

### New Feature

- Add a configured maximum nesting depth to the canonical value domain (F-016, #189):
  `kernel.canonicalization.maxNestingDepth` (default 1,000) in `protocol.config.json`, counting
  the outermost array or object as level one. A value at the bound is accepted and one level
  deeper is refused with the new `CanonicalNestingLimitError` (`CANONICAL_NESTING_LIMIT_EXCEEDED`,
  a `TypeError` with a `bound` property), exported from the root and `./canonical`. The message
  names the bound, never value content or key paths.
- Add `kernel.canonicalization.framingDepth` (default 8): kernel framing that embeds whole record
  bodies (record identity input, append batch digest, native and redacted archives) is encoded
  under `maxNestingDepth + framingDepth`, so a body at the bound can be appended, exported,
  imported, and redacted. Load validates both as positive integers and refuses an interchange
  `kernel.interchange.limits.maxNestingDepth` below their sum.
- The compatibility gate fingerprints the section as the identity setting
  `identity:protocol.config.json#/kernel/canonicalization`.

### Defect Fixes

- Canonical acceptance no longer depends on the call site's stack depth or JIT state (F-016).
  `canonicalizeRecord`, `createRecordId`, and every internal canonical encoder normalize and
  serialize values with explicit stacks and check the bound before entering the next container.
  Before, a value nested roughly 2,000 to 8,000 levels deep could be accepted at append and refused
  when re-validated from a deeper call site.
  Canonical snapshots (the deep freeze behind record reads and append planning) and secret scanning
  walk values with explicit stacks too, so appending and reading a body at the bound works from a
  deep call site.
- Validators that rewrapped canonicalization failures as plain `TypeError` (effect intents and
  results, run outcomes and artifact metadata, scope data, task schema documents, provider
  responses and definitions, archived receipts, and the redacted-archive verifier) now let
  `CanonicalNestingLimitError` through. Append, `importTrace`, and archive decode refuse before any
  write.
- Record snapshots of arrays or objects with more than about 120k entries threw `RangeError`;
  children are now queued without argument spreading.
- A `kernel.canonicalization.framingDepth` below the deepest kernel frame body location (5) is
  refused at load.
- OTLP body mapping and telemetry batch freezing no longer recurse, so exporting an at-bound body
  is independent of the caller's stack (the JSON-lines sink's native `JSON.stringify` is fixed in
  2.33.2).
- `validateTypedEffectTrace` reports an over-deep payload as `CanonicalNestingLimitError`;
  `classifyProofEnvelope` returns `runtime_only` instead of throwing when a payload fits its record
  but not the whole trace.

### Improvement

- The canonical serializer no longer calls `JSON.stringify` on the normalized tree; its output is
  byte-identical for every accepted value, and a polluted `Array.prototype.toJSON` can no longer
  change canonical output.
- Tests: the bound at and one past from 0, 2,000, and 6,000 caller frames, cold, during and after
  warm-up (`test/canonical-record.test.ts`); append in both secret-scanning modes, archive decode,
  import, redacted verification, validator pass-through, and no partial state
  (`test/canonical-nesting-bound.test.ts`); configuration validation
  (`test/protocol-config.test.ts`); the public error code (`test/errors/public-error-codes.test.ts`).
- Fuzzing: value mutators add `valueNestingBoundOffsets` (-8, -1, 0, 1 around the configured
  bound); the 20,000-level mutator and the F-012 corpus cases now expect the classified refusal;
  new corpus cases at and past the bound use depths relative to the configured bound
  (`{ "canonicalBound": <offset> }`); the accepted-output oracle re-encodes again below
  `deepCallSiteFrames` (4,000) caller frames.
- Docs: canonical records (nesting bound), protocol configuration, trace interchange, public
  errors, package exports, compatibility policy, fault and fuzz conformance, threat model, README,
  the security review (F-016 fixed with an accepted residual; no finding open), and the tracker.

### Impact

MINOR: the canonical value domain narrows in a configured way. Values nested more than 1,000
levels deep, which were accepted before up to roughly 2,000 levels and, beyond that, depending on
the call site, are now refused with `CanonicalNestingLimitError`; callers that need deeper values raise
`kernel.canonicalization.maxNestingDepth` (and the interchange nesting limit with it). A store
written by an earlier version that holds a body deeper than the bound fails closed wherever that
body is canonicalized again until the bound is raised. `CanonicalNestingLimitError` is a
`TypeError`, so existing `instanceof TypeError` handling keeps working. Canonical output and record
identities of accepted values are unchanged. Canonical encoding of a typical record costs about
15-20% more CPU on the reference host because serialization no longer uses the native recursive
`JSON.stringify`. A bundle that imports only `./canonical` now also needs
`public-errors.config.json` beside `protocol.config.json` and `runtime.config.json`, because the
canonical encoder raises a classified error (`config/bundle-verification.config.json` and the
package-exports bundle layout are updated).

## [2.32.5] - 2026-09-19

### Defect Fixes

- Several processes opening the same new SQLite database at once no longer fail (F-029). The
  switch to write-ahead logging in `SQLiteTraceStore`, `SQLiteTaskRegistry`, and
  `createSQLiteStorageCoordinator` retries SQLite's deadlock-avoidance `SQLITE_BUSY` within the
  configured busy timeout instead of failing with `database is locked`.
- Trace-store and task-registry migrations read the applied schema version inside the configured
  `IMMEDIATE` transaction of each migration step instead of before it, so concurrent migrators
  serialize and later ones commit nothing; a concurrent first open no longer fails with
  `table ... already exists` or `duplicate column name`. Migration semantics, the drills'
  historical `throughVersion`, and the migration goldens are unchanged.
- Blob-directory creation treats a directory another process created between its existence check
  and `mkdir` as existing, so concurrent first opens of one trace store no longer fail with
  `EEXIST` on its `.blobs` directory (found while verifying F-029).
- `test/storage/process-race.test.ts` always closes stdin and kills every child that is still
  running when a scenario ends, captures each child's exit at spawn, and reports the child's
  stderr, so a failing run no longer hangs on a child blocked on stdin.

### Improvement

- Add a multi-process concurrent-first-open test: four processes released together open one new
  trace store, task registry, or storage coordinator, four rounds per kind, and every open must
  succeed. Add unit tests for the busy retry and the directory-creation race.
- Correct the `createSQLiteStorageCoordinator` JSDoc and update the storage-interfaces, SQLite
  trace store, threat model, release notes, security review, exit audit, release-readiness
  dashboard, and release-candidate manifest pages: F-029 is fixed, the F-029 residual row is
  removed, and the manifest records the 2.32.5 tarball and artifact digests.

### Impact

No public API, schema, configuration, protocol, or CLI change. Behavior change: a writable
task-registry open now reads its schema version under the configured `IMMEDIATE` lock, so it waits
up to the busy timeout behind another process's long write transaction, as trace-store and
coordinator opens already did.

## [2.32.4] - 2026-09-19

### Improvement

- Add the Phase 11 exit audit and 1.0 readiness audit (`.plan/phase-11-exit-audit.md`, #29):
  every Phase 11 roadmap work item and exit criterion mapped to its delivery, entry points, docs,
  tests, and an outcome of met (in-repo), partially met, or owner-owed; the recovery
  classification; the independent internal review and its fixes; fresh verification; and the
  verdict: release candidate ready for the in-repo scope, 1.0 general availability no-go until the
  owner-owed items close.
- Add the cross-phase release-readiness dashboard (`.plan/release-readiness-dashboard.md`):
  Phase 0 to 11 epic status, and every parity-matrix row and paper-coverage row classified as
  implemented, implemented with a deferred remainder, platform- or version-fenced, or classified
  unsupported or deferred.
- Add the release-candidate verification manifest (`.plan/release-candidate-manifest.md`) with the
  lockfile, SBOM, tarball, compatibility baseline, and benchmark digests, the recorded fuzz and soak
  runs, and the fresh verification results.
- Add the [1.0 release notes](docs/release-notes-1.0.md): what the L4 maturity milestone means for
  package 2.32.x, what is delivered, known limits, owner-owed items, and upgrade pointers.
- Record F-029 (Low, open) in the internal security review: several processes opening the same
  new trace-store or SQLite coordinator database at once can fail closed with `database is locked`
  or a migration error, which makes the process-race test intermittent; the storage-interfaces page
  no longer claims concurrent first opens are safe, and the threat model gains residual rows for
  F-004, F-011, F-019, F-029, F-008, and F-009.
- Update the README level table, the parity matrix, the paper coverage map, the roadmap, the
  security policy, the tracker, and the documentation indexes.

### Impact

Documentation and audit only. No public API, schema, configuration, protocol, store, or CLI
change. The package stays private and unsigned; no npm release is made.

## [2.32.3] - 2026-09-19

### Defect Fixes

- `worktree` Git custody no longer runs repository clean filters when it checks a declared
  submodule (F-028): the dirty-submodule check no longer runs `git status`, whose nested submodule
  status re-hashed stat-dirty files through `filter.<driver>.clean`/`process` programs selected by
  `.gitattributes`, `info/attributes`, or `core.attributesFile`. It now compares the superproject
  gitlink, the submodule's top level, HEAD, index, and HEAD tree with `rev-parse`, `ls-tree`, and
  `ls-files`, hashes worktree content as raw Git blobs in the runtime, recurses into populated
  nested submodules, and lists untracked paths with `ls-files --others`.

### Improvement

- Record F-028 as fixed with an audit of every Git invocation under `src/workspace` (no remaining
  command applies attribute filters, hooks, textconv or diff drivers, credential helpers, or a
  pager) and update the threat model and Git-aware custody pages.

### Impact

No public API, schema, configuration, or protocol change. Behavior change: a submodule file that
equals its committed blob only after a clean filter or end-of-line conversion (for example Git LFS
pointers or `core.autocrlf`) is now reported as a dirty submodule and fails `worktree` capture
closed; stat-only changes, skip-worktree and assume-unchanged entries, and unpopulated nested
submodules stay clean as before.

## [2.32.2] - 2026-09-19

### Defect Fixes

- `git-head` Git custody no longer runs repository filter programs (F-021): HEAD is written from
  `git ls-tree` and `git cat-file --batch` instead of `git archive | tar`, so no
  `filter.<driver>.smudge`/`process`, `export-ignore`, `export-subst`, `ident`, or end-of-line
  attribute applies. Worlds of repositories without attributes are unchanged; tree entries named
  `.`, `..`, or empty are refused as unsupported state.
- The compatibility gate (F-022): numeric format and protocol version increases need a classified
  change-log entry (an `additive` one must carry a note naming the reader of the old value);
  migration-backed schema versions are additive only with exactly one appended migration per step;
  bulk `--classify additive` is refused for changed API declarations and version markers, which
  are classified one at a time with the new `--artifact` option; per-command CLI options
  (`cli-option:`) and identity settings (`identity:` prefixes, digest algorithms, record identity,
  root witness) are fingerprinted; `check:compatibility` refuses declarations older than `src`; and
  the deprecation window is measured to `deprecation.lastReleasedVersion` (`2.25.1`) instead of the
  last baseline update.
- Store file-mode tightening opens every database and sidecar with `O_NOFOLLOW` and changes it
  through the descriptor, so a symbolic link is never followed or changed, and reports creation
  errors other than `EEXIST` (for example `EACCES`) instead of swallowing them (F-023).
- A failed restore publication move is reported as `TraceStoreBackupError` `target-exists` and no
  longer leaves an empty target blob directory that blocks the next restore (F-024).
- Secret-finding digests are keyed with a random per-process HMAC key (prefix `hmac-sha256:`), so
  a finding in an error or log cannot confirm a guessed secret (F-025).
- Backup replication refuses a database or manifest file that changed after verification, and
  configuration requires the backup digest scheme to equal the blob identifier scheme (F-026).
- Backup databases use the configured `backup.databaseJournalMode` and are opened with the store's
  defensive setting (F-027).
- `append` refuses a `witness_ref` naming a record that is not a witness, before any write, instead
  of writing a store that fails `verifyIntegrity` and refuses export (F-014).
- `importTrace` stages beside the target store instead of in the OS temporary directory, so a
  killed import no longer leaves archive blob copies there (F-019).

### Improvement

- Add `cli.commandOptions`, the per-handler table of accepted flags and value options that every
  CLI handler now parses argv through; `kernel.interchange.staging.directoryPrefix`;
  `backup.databaseJournalMode`; and `retention.scanning.findingDigestPrefix` (all protocol
  configuration, no protocol identity change).
- Register F-021 to F-028 in the internal security review (F-028, `git status` clean filters in
  worktree custody's dirty-submodule check, is Medium and open) and update the threat model, the
  compatibility policy, Git-aware custody, backup and restore, secrets and retention, SQLite trace
  store, CLI, protocol configuration, incident response, and fault conformance pages.

### Impact

No public API declaration changes (the compatibility gate reports only the newly fingerprinted
surfaces). Behavior changes: `SecretFinding.digest` values are now per-process HMACs with an
`hmac-sha256:` prefix and can no longer be compared with a digest computed from the secret;
`git-head` worlds of repositories that relied on archive attributes now contain the committed
bytes; an append with a non-witness `witness_ref`, a store path in an unwritable directory, and a
failed restore move now fail with typed errors; a killed import's staging directory appears beside
the target store. Maintainers classify API and version-marker changes with `--artifact`.

## [2.32.1] - 2026-09-19

### Defect Fixes

- Store writes that fail with `SQLITE_FULL` or an I/O error now throw that SQLite error instead of
  "cannot rollback - no transaction is active" (F-017): SQLite already rolls such transactions
  back, so every store, import, export, storage-coordinator, task-registry, and migration
  transaction now issues `ROLLBACK` only while a transaction is still open. Nothing else changes:
  the failed call still writes nothing and its append intent still diagnoses `retry_safe`.
- `diagnoseAppend` reports `manual_recovery_required` (`receipt_mismatch`) for an append intent
  whose retained batch digest is not a well-formed configured digest, so `verifyIntegrity`
  reports `append_receipt_mismatch` and `exportTrace` refuses instead of exporting an archive that
  `importTrace` rejects (F-018). A digest replaced by another well-formed digest remains an
  accepted residual: it fails closed with `AppendIntentConflictError` on retry.

### Improvement

- Add the fault and soak suites (#186) under `test/faults/`, configured by the new `faults` and
  `soak` sections of `config/hardening-suites.config.json`: seeded `SIGKILL` of a looping child
  writer during append, blob put, cut publication, import, backup, and vacuum, with every started
  operation classified complete, retryable, or refused and retried; disk full through
  `PRAGMA max_page_count` and a child under `ulimit -f`; seeded page flips, WAL/SHM deletion,
  truncation, and damage, blob damage, stray temporaries, and backup tampering, each refused,
  detected, recovered, or rolled back to an earlier commit and compared with a golden export; and
  a mixed soak (appends, cuts, blobs, telemetry export over a durable subscription, verified
  backups, maintenance, kill/restart cycles) with periodic invariants. All run in `pnpm test`
  (the soak bounded to 240 operations).
- Add `pnpm test:soak` (`scripts/soak-cli.ts`, `--duration`, `--operations`, `--seed`,
  `--directory`, `--keep`, `--json`) and the opt-in `pnpm test:faults:volume` (macOS `hdiutil`
  disk image filled to `ENOSPC`, outside `pnpm verify`); record one soak and one volume run.
- Document the classification tables and recorded runs in the fault section of
  [fault and fuzz conformance](docs/fault-and-fuzz-conformance.md#faults-and-soak); add writer
  crash and disk-full runbooks and remove the pending marker in
  [incident response](docs/incident-response.md); add threat-model recovery rows and register
  F-017 to F-020 (F-019, import staging left in the OS temporary directory after a kill, is Low
  and open for #29; F-020, write-ahead-log loss rolling the store back, is an accepted SQLite
  residual).

### Impact

No public API, schema, archive format, configuration protocol, or CLI change. Callers that matched
the "cannot rollback" message after a full disk now receive the SQLite error (`ERR_SQLITE_ERROR`
with `errcode` 13 or an I/O error code). Stores containing a malformed batch digest, which only
at-rest damage can produce, now fail `verifyIntegrity` and refuse export.

## [2.32.0] - 2026-09-19

### New Feature

- Add configured trace-archive input limits (#185, closes F-004): `kernel.interchange.limits` in
  `protocol.config.json` (`maxArchiveBytes` 256 MiB, `maxNestingDepth` 4096, `maxAppendIntents`,
  `maxBlobs`, `maxCuts`, `maxRecords`, `maxRecordViews`, and a 192 MiB `maxBlobBytes` total).
  `importTrace` and `verifyRedactedTraceArchive` check byte length and nesting depth before
  `JSON.parse`, collection counts and the declared blob byte total before decoding any record or
  blob, and an exact canonical base64 length before each blob decode; `shepherd-ts store import`
  checks the file size before reading. The limits are operational and excluded from the archive
  format identity.
- Add the public error `TraceArchiveLimitError` (`TRACE_ARCHIVE_LIMIT_EXCEEDED`, a `TypeError`
  whose `limit` names the exceeded member), exported from the root, `./trace`, and `./operations`.
- Add `workspaces.gitInvocation` (closes F-005): every Git subprocess (custody, repository
  bindings, workspace initialization) now passes the configured `-c` overrides
  (`core.fsmonitor=false`, `core.untrackedCache=false`) before `-C <root>`, removes every inherited
  `GIT_*` environment variable, and sets `GIT_OPTIONAL_LOCKS=0` and `GIT_TERMINAL_PROMPT=0`
  (`src/workspace/git-command.ts`). Previously only custody pinned the options, and all three
  inherited the caller's environment.
- Add deterministic seeded fuzzing without new dependencies (closes F-002): `test/support/prng.ts`
  (mulberry32, now shared with the scope and delegation law suites), mutators, a shared oracle
  (canonical and stable re-encoding or a configured error class, a per-case budget, no non-Error
  throw, no prototype pollution), 23 targets covering canonical encoding and validation, archive
  decode and import, the redacted verifier, the append-receipt and backup-manifest decoders,
  `runCli` argv, canonical world paths, changesets against a reference model, selection-publication
  codecs, placement, repository-grant, overlay-mount, and native-jail evidence readers, and provider
  and application protocol readers (telemetry recorded as a skip: no decoder exists), a replayed
  regression corpus in `test/fixtures/fuzz-corpus/`, `config/hardening-suites.config.json`, and
  `pnpm fuzz` (`scripts/fuzz-cli.ts`) for extended runs.

### Defect Fixes

- Canonical encoding reports nesting past the call stack as the documented `TypeError` (with the
  `RangeError` as cause) instead of `RangeError` (F-012).
- Archive and redacted-archive text with a repeated object key, archived `receipt_json` that is not
  canonical, and backup manifests that are not exactly the writer's canonical encoding are refused,
  so no other JSON parser can read a different archive or manifest (F-013).
- A backup manifest head owner identity with a lone surrogate is refused as `manifest-invalid`
  instead of an unclassified `TypeError` (F-015).

### Improvement

- Overlay `mountinfo` parsing moved into the host-independent `classifyOverlayMountInfo`, now fuzzed
  and covered on every host.
- Add [fault and fuzz conformance](docs/fault-and-fuzz-conformance.md) (fuzz part, with the recorded
  extended run: seed 185185, 410,400 cases, 0 findings; the fault section is reserved for #186),
  register findings F-012 to F-016 (F-014 and F-016 Low and open for #29), and updates to the threat
  model, trace interchange, protocol configuration, public errors, backup, package exports, and
  project structure pages.

### Impact

Additive, with fail-closed tightening of malformed input. Archives larger than the configured
bounds, archives with repeated keys or non-canonical receipts, and hand-edited backup manifests are
now refused; every archive `exportTrace` produces and every manifest the backup writer produces is
unaffected. Git subprocesses no longer see inherited `GIT_*` variables. No record, store schema,
archive format, or CLI output change.

## [2.31.0] - 2026-09-18

### New Feature

- Add non-canonical, OpenTelemetry-compatible observability (#184) in `src/observability/`:
  `createTraceTelemetryExporter({ store, subscription, sink, clock, bodies?, maxRecordsPerBatch?,
  retention? })` opens and owns a trace subscription, maps every committed record occurrence to an
  OTLP log record and each configured run lifecycle (execution `created` to `completed`/`failed`)
  to one span, hands one `TelemetryBatch` to a caller-supplied `TelemetrySink`, and acknowledges
  the cursor only after the sink succeeds (at-least-once; a durable subscription resumes from the
  acknowledged cursor after a crash). Trace identifiers derive from the owner path and span
  identifiers from the start record (`deriveTelemetryTraceId`, `deriveTelemetrySpanId`); attributes
  use the configured `shepherd.*` namespace; times are exporter observation time from the caller's
  clock and are non-semantic (records carry no timestamps, D-014).
- Bodies are withheld by default (`TELEMETRY_BODY_MODES`: `omit`, `retention-policy`). In
  `retention-policy` mode a body is exported only when its retention disposition is `include`, no
  configured secret detector matches, and it fits `observability.limits.maxBodyBytes`; otherwise
  `shepherd.body_handling` (`TELEMETRY_BODY_HANDLINGS`) says why, and redacted bodies carry only a
  retention digest and secret classes.
- Add `createJsonLinesTelemetrySink({ tracesPath, logsPath })`, which appends OTLP/JSON
  `ExportTraceServiceRequest` and `ExportLogsServiceRequest` lines (one signal per file, fsynced,
  owner-only `0600`) readable by the OpenTelemetry Collector `otlpjsonfile` receiver.
- Add hand-written OTLP/JSON subset types (`OtlpSpan`, `OtlpLogRecord`, `OtlpAnyValue`, and the
  resource, scope, and request wrappers) for opentelemetry-proto 1.11.0; no OpenTelemetry SDK, no
  collector, and no network code.
- Add the `observability` section to `protocol.config.json` with its reader, the pinned
  `OBSERVABILITY_PROTOCOL_V1_CONTRACT`, the generated `spec/schemas/telemetry-batch-v1.schema.json`,
  and generated `TELEMETRY_BODY_MODES` and `TELEMETRY_BODY_HANDLINGS`. Everything is exported from
  the root and `./operations`.

### Improvement

- Add the [observability](docs/observability.md) page, threat-model telemetry rows, register
  finding F-011 (telemetry leakage, accepted residual), an installed `./operations` telemetry probe,
  and updates to package exports, project structure, API reference, protocol configuration, the
  schema index, and the parity matrix.

### Impact

Additive. No record, store schema, archive format, or existing API changes; `exportTrace` output is
byte-identical before and after telemetry export. Telemetry timestamps are observation times and
must not be used to order trace history.

## [2.30.0] - 2026-09-18

### New Feature

- Add `SQLiteTraceStore.maintain({ mode })` (#183), implemented in `src/store/maintenance.ts`:
  `inspect` (default) runs a bounded `PRAGMA quick_check` and reports page size, page count,
  freelist pages, database bytes, and write-ahead-log bytes; `checkpoint` also runs
  `wal_checkpoint(TRUNCATE)`; `optimize` also runs `PRAGMA optimize`; `vacuum` also runs `VACUUM`
  and then checkpoints. Mutating modes refuse a database that fails `quick_check`. The report types
  `TraceStoreMaintenanceMode`, `TraceStoreMaintenanceOptions`, `TraceStoreMaintenanceReport`,
  `TraceStoreSpaceReport`, and `TraceStoreCheckpointReport` are exported from the root, `./trace`,
  and `./operations`.
- Add the public error `TraceStoreReadOnlyError` (`TRACE_STORE_READ_ONLY`, a `TraceStoreError`),
  raised when maintenance is requested on a read-only handle.
- Add `shepherd-ts store maintain [--store PATH] [--mode MODE]` with the `--mode` option, an
  additive `cli-output-v1` branch (`maintenance`), regenerated CLI reference, and an installed
  probe that vacuums an imported store and requires an identical export digest.
- Add `kernel.store.maintenance` to `protocol.config.json` (enabled modes, default, `quick_check`
  bound, checkpoint mode, WAL suffix) with its reader.
- Add `pnpm bench:kernel` (`scripts/bench-kernel.ts`, `tooling/benchmark/`) with
  `config/kernel-benchmark.config.json`: append latency and throughput, cut resolve, slice read,
  subscription pull, export, import, verify, blob GC inspection, and CLI startup, each with warmup,
  raw samples, median, nearest-rank p95, variance, and the environment, written to
  `docs/generated/benchmarks/<host-class>.json`. Add `pnpm check:slo` with
  `config/performance-slo.config.json` (budgets for the `macos-arm64-apfs` reference class only);
  it joins `pnpm verify:release`, not `pnpm verify`.

### Improvement

- Append planning reads only the records a batch cites and the owners it extends by primary key
  instead of loading every record identity and owner ordinal on every append (a linear per-append
  cost; 3.62 ms median extra per append measured at 10,083 records). Behavior is unchanged.
- Add index-only store schema v13 (`records_by_schema`, `trace_cuts_by_publication`) after the new
  `EXPLAIN QUERY PLAN` tests (`test/store/query-plans.test.ts`) found full table scans in
  `listOwnersBySchema` and `listCuts`. Hot-path SQL now lives in the internal
  `src/store/statements.ts`. Migration drills gain a schema-13 golden (export digest unchanged).
- Add the bounded scale tier `test/store/scale.test.ts` with `config/scale-verification.config.json`
  (default: 20,000 records, a 5,000-record causal chain, 150 blobs, 40 orphans, 12 temporary files;
  extended tier on demand) covering integrity, deep closure, GC correctness, export/import round
  trip, and maintenance export byte identity.
- Add the [performance report](docs/performance-report.md) (reference host only, own numbers,
  including carrier storage), a store-growth incident runbook, threat-model rows, and updates to
  the SQLite store, CLI, protocol configuration, public errors, package exports, backup and
  migration, project structure, parity matrix, hardening contract, and release-gate documents.

### Impact

Additive. Opening a store with a writable handle adds two indexes (schema 13); older packages refuse
a schema-13 store as they refuse any newer schema, and archive format v1 is unchanged. SLO budgets
describe only the macOS arm64 APFS reference host; `pnpm check:slo` reports other hosts as
skipped.

## [2.29.0] - 2026-09-18

### New Feature

- Add verified [backup, restore, and migration](docs/backup-restore-and-migration.md) (#182)
  through `./operations` and the root. `backupTraceStore` copies an open store online with
  `node:sqlite` `backup()` (resolved at call time; a runtime without it fails closed with
  `backup-unsupported`), copies every registered blob into the backup directory or a caller
  `BlobStoreBackend`, proves the copy (staged open, `verifyIntegrity`, `verifyBlobs`, export
  digest), and writes the `shepherd.store.backup` v1 manifest last by atomic rename. The manifest
  records the writer's package version, store schema, database digest and length, export digest,
  blob-list digest and counts, and per-owner heads; `manifest_id` is the digest of the rest. The
  backup directory, database copy, manifest, and staging copies are owner-only (`0700`/`0600`).
- Add `verifyTraceStoreBackup`, which never modifies a backup and requires the manifest, database
  bytes, blob set and bytes, a forward-migrated staged copy with clean integrity, and an equal
  export digest, and `restoreTraceStoreBackup`, which requires the exact manifest identity, refuses
  any existing target, database sidecar, or blob directory, verifies a staged copy beside the
  target, publishes by rename and hard link, and re-verifies read-only before resolving.
- Add `replicateTraceStoreBackup` (content-addressed objects in a `BlobStoreBackend` published by
  `compareAndSwapRef`, optionally fenced) and `fetchReplicatedTraceStoreBackup`.
- Add the public error `TraceStoreBackupError` (`TRACE_STORE_BACKUP_ERROR`) with a configured
  `reason` from the generated `STORE_BACKUP_FAILURE_REASONS`, and `STORE_BACKUP_BLOB_LOCATIONS`.
- Add the `backup` section to `protocol.config.json`, its reader and backup protocol v1
  compatibility contract, and the generated `store-backup-manifest-v1` schema.
- Add the `shepherd-ts store` group: `verify` (store or `--backup`), `backup`, `restore`,
  `export` (with `--redacted`), and `import`, with additive `cli-output-v1` branches, regenerated
  CLI reference, and installed-package probes.

### Improvement

- Add migration drills: `tooling/testing/store-schema-fixtures.ts` builds a store at every
  historical schema 1 through 12 from the migration steps (the internal `migrateTraceStore` gains a
  `throughVersion`), and `test/operations/migration-drills.test.ts` requires each to upgrade with
  integrity, preserved rows, and checked-in golden export digests, restores historical-schema
  backups forward-migrated, refuses a future-schema store while importing its archive-v1 export
  into a fresh store, and restores a pre-upgrade backup exactly.
- Document the forward-only schema and downgrade policy (restore a pre-upgrade backup or round-trip
  a known archive format) and upgrade, rollback, restore, and interruption runbooks; link them from
  incident response and the support policy. Update the threat model, findings register (F-003
  backup part closed), hardening contract, parity matrix (`store` row), package exports, protocol
  configuration, public errors, project structure, and CLI documentation.
- Move the CLI option parsing helpers into `src/cli/arguments.ts` without behavior change.

### Impact

Additive: existing stores, archives, schemas, APIs, and CLI commands are unchanged; the CLI output
schema and configuration only gain branches, members, and a section. No earlier package version
was published, so the supported upgrade sources are store schemas 1 through 12, archive format v1,
and backup manifest v1. Backups are full, unencrypted, and unsigned copies; drills run on the
reference host (macOS arm64 APFS, Node.js 24.12.0 and 24.17.0) only.

## [2.28.0] - 2026-09-18

### New Feature

- Add [storage interfaces](docs/storage-interfaces.md) (#181) through `./operations` and the root.
  `BlobStoreBackend` is content-addressed object storage: `put` verifies that the bytes hash to the
  identifier, is idempotent, and never replaces an object; `get` returns a copy; `list` is ordered,
  stable, paged with an exclusive `after` cursor and configured limits; `delete` is idempotent; each
  backend declares `durable` or `volatile`. `StorageCoordinator` provides `compareAndSwapRef` with
  generations that increase by exactly one, and `acquireLease`, `renewLease`, and `releaseLease`
  with monotonic fencing tokens; a swap may carry a lease fence, and a superseded, expired, or
  absent fence is refused. Conflicts, held leases, and fences are result statuses.
- Add four reference adapters: `createMemoryBlobStoreBackend`,
  `createFilesystemBlobStoreBackend` (wraps the trace store's unchanged `BlobFilesystem`),
  `createMemoryStorageCoordinator`, and `createSQLiteStorageCoordinator` (one `IMMEDIATE`
  transaction per change over WAL with `synchronous = FULL`, the configured busy timeout, and an
  owner-only database file; safe across processes on one host).
- Add the conformance kits `checkBlobStoreBackendConformance` (11 named laws) and
  `checkStorageCoordinatorConformance` (12 named laws), which run each law against a fresh adapter
  and return a frozen per-law report so third-party adapters can self-test.
- Add the public errors `StorageAdapterError` (`STORAGE_ADAPTER_ERROR`) and
  `StorageBlobContentMismatchError` (`STORAGE_BLOB_CONTENT_MISMATCH`).
- Add the `storage` section to `protocol.config.json` (name grammar, value, owner, TTL, and list
  bounds, durability and status vocabularies, SQLite coordinator contract), its reader and
  compatibility contract, and the generated `STORAGE_DURABILITIES`, `STORAGE_LEASE_STATUSES`, and
  `STORAGE_REF_SWAP_STATUSES` constants.

### Improvement

- Test all four adapters against both kits, show that deliberately broken adapters fail the
  expected laws, and race four processes on one SQLite coordinator file for compare-and-swap and
  leases. Extend the installed `./operations` probe to run both kits from the packed tarball.
- Update the threat model, security review (F-003 note), production hardening contract, package
  exports, protocol configuration, public errors, and project structure documentation.

### Impact

Additive: `SQLiteTraceStore` remains the only canonical append store, its blob layer and schema are
unchanged, and no remote or cloud adapter ships. Importing `./operations` now also loads
`node:sqlite` because it exports the SQLite coordinator; it still loads no process-execution
module.

## [2.27.0] - 2026-09-18

### New Feature

- Add [secrets and retention](docs/secrets-and-retention.md) (#180) through the new stable
  `./operations` package entry and the root. `scanSemanticValueForSecrets` matches every string
  value and object key against the configured detectors and reports each finding as secret class,
  JSON Pointer, location, and digest, never the matched text; key matches are reported at their
  owner so no pointer carries matched text.
- Add the opt-in `secretScanning: "refuse"` option to `SQLiteTraceStore` (default `"off"`, behavior
  unchanged) and the `secretScanning` getter. A refusing store scans every record body of every
  append, including appends made inside its own transactions, and every body of an imported
  archive before anything is written, and raises the new public error `TraceSecretDetectedError`
  (`TRACE_SECRET_DETECTED`). A refusal leaves the append intent unused, so a corrected retry with
  the same intent succeeds.
- Add retention data classes (`checkpoint`, `context`, `general`, `memory-adapter`,
  `provider-citation`) and export dispositions (`include`, `redact`, `omit-body`) with
  `classifyTraceSchema` and `readRetentionPolicy`; every configured `schemas`/`traceSchemas` family
  must map to a class or configuration loading fails. Callers classify their own schemas with
  `schemaDataClasses`.
- Add `exportRedactedTraceArchive`, a one-way `redacted-trace-archive-v1` export built on
  `exportTrace()` that keeps every envelope and `record_id` and replaces bodies with
  `{ redacted, data_class, secret_classes, body_digest }` markers under the policy, listing blobs
  without content; `verifyRedactedTraceArchive`, which re-derives identities of verbatim records and
  checks structure and policy; and `inspectTraceRetention`, a read-only `retention-report-v1`
  inventory by data class, disposition, and secret class. `importTrace` refuses redacted archives
  with the new public error `RedactedTraceArchiveError` (`REDACTED_TRACE_ARCHIVE_ERROR`).
- Add the `retention` section to `protocol.config.json` (detector patterns, data classes, family
  mappings, dispositions, formats, limits, scanning modes, store-file mode), its reader and
  compatibility contract, the generated `RETENTION_DATA_CLASSES`, `RETENTION_EXPORT_DISPOSITIONS`,
  and `SECRET_SCANNING_MODES` constants, and the two generated schemas.

### Defect Fixes

- Create writable trace-store and task-registry SQLite databases with the configured owner-only
  mode (`0600`) and tighten existing owned database, WAL, SHM, and journal files on writable opens;
  previously they followed the process umask (`0644` under umask `022`) while blobs were `0600`
  (F-003). Read-only opens change no file modes.

### Improvement

- Update the threat model, findings register (F-003 fixed; F-001 downgraded to Low and accepted),
  incident-response secret runbook, public errors, package exports, protocol configuration, store,
  and interchange documentation. The API reference credential guard now admits exactly the eight
  secret-detection names and still rejects every other secret, credential, or access-token export.
  Bundle verification prints non-string fixture results as JSON and covers `./operations`.

### Impact

Additive: existing stores, archives, APIs, and the default append behavior are unchanged. Operators
who enable `secretScanning: "refuse"` get fail-closed refusal of configured secret classes;
detection is pattern-based and incomplete, and records remain immutable, so retention is
classification, redacted export, and store rotation, never in-place deletion. Existing database
files become owner-only the next time they are opened writable by their owner.

## [2.26.0] - 2026-09-18

### New Feature

- Add the API and protocol [compatibility policy](docs/compatibility-policy.md) as a local release
  gate (#179). `pnpm check:compatibility` runs in `pnpm verify` and `pnpm verify:serial` after
  `check:api-reference` and compares the exported declarations in `dist/src` and the protocol
  surface (schema digests with `oneOf` branch and `$defs` digests, kernel, interchange, store,
  section, and other version markers, migration lists, public error codes, CLI exit codes and
  commands) with `spec/compatibility/api-baseline.json` and `protocol-baseline.json`. A removed
  export, error code, CLI command, or schema, a narrowed schema, a decreased version marker, or a
  removed or reordered migration fails with a message naming the artifact. Removals need a
  deprecation that shipped for the configured window (two MINOR releases) and a MAJOR bump;
  changed declarations and values need an entry in the append-only classified change log
  `spec/compatibility/protocol-changes.json` whose bump matches; added `oneOf` branches, added
  `$defs` members, appended migrations, and increased numeric markers are accepted as additive.
  Tiers, window, locations, and frozen-artifact rules live in
  `config/compatibility-policy.config.json`. `pnpm update:compatibility-baseline` records new
  baselines only when every rule holds and can classify reviewed changes with `--classify`.
- Render `@deprecated` exports in the [generated API reference](docs/generated/api-reference.md)
  as `Status: deprecated` with a `Deprecated:` section; the generator's shared `readPublishedApi`
  feeds both the reference and the compatibility gate.
- Add [release integrity](docs/release-integrity.md) evidence: a deterministic CycloneDX
  1.5-shaped SBOM derived from `pnpm-lock.yaml` (`docs/generated/sbom.cdx.json`,
  `pnpm generate:sbom`, and `pnpm check:sbom` in `pnpm verify`), an unsigned in-toto Statement v1
  with a SLSA provenance v1 predicate and type guard, a reproducible-build check that builds and
  packs twice and reports every differing file, and `pnpm verify:release`, which writes the
  tarball, SBOM, provenance, report, and manifest into the ignored `release/` directory.
- Add `.github/workflows/release.yml` (manual dispatch, frozen script-free install,
  `pnpm verify:release`, build-provenance attestation, and `npm publish --provenance` behind the
  protected `npm-publish` environment), with actions pinned by SHA. It is present but not run.

### Improvement

- Replace the `fast-check` plan in the testing plan with the seeded hand-rolled harness decision,
  record the enforced gates, add the supply-chain boundary B10 to the
  [threat model](docs/threat-model.md), and record owner-owed finding F-010 (unsigned release
  evidence). `CONTRIBUTING.md` requires refreshing the API reference, SBOM, and compatibility
  baselines in every pull request.

### Impact

No runtime, protocol, schema, or store change. Contributors must refresh the compatibility
baselines and SBOM with each version bump, and future removals follow the deprecation window. Two
consecutive clean builds on the reference host produce byte-identical tarballs; signing and
publication remain owner-owed.

## [2.25.2] - 2026-09-18

### Improvement

- Add the Phase 11 [production hardening contract](.plan/production-hardening-contract.md) (#187):
  slice map for #187, #179 to #186, and the #29 audit, a mapping of every Phase 11 work item and
  exit criterion to exactly one slice or owner-owed row, per-slice non-claims, and an owner-owed
  register (external security review, signing and publication, hosted CI and cross-OS lanes,
  private vulnerability reporting, registry name).
- Add the normative [threat model](docs/threat-model.md): assets, nine trust boundaries, STRIDE
  threats per boundary citing mitigation code and tests, and residual risks linked to findings.
- Add the [internal security review](.plan/security-review.md) with its method, a severity rubric
  defining critical, high, medium, and low, the findings register F-001 to F-009, and an external
  reviewer packet. No finding is critical. Confirmed: secrets can enter immutable records unscanned
  (F-001, #180); no fuzz coverage (F-002, #185); the SQLite database, WAL, and SHM follow the process
  umask (`0644` under umask `022`) while blobs are `0600` (F-003, #180); archive decode has no size
  bounds (F-004, #185).
- Add the [support policy](docs/support-policy.md) and [incident response](docs/incident-response.md)
  with store-corruption and lost-backup runbooks that link forward to #180, #182, and #186.
- Record decisions D-016 ("1.0" is the L4 maturity milestone, not a package version), D-017 (no new
  dependencies for hardening), and D-018 (remote storage is interfaces-only for 1.0); list the
  Phase 11 child issues in the roadmap.

### Defect Fixes

- `SECURITY.md` no longer states that pull requests run a dependency audit: the workflows exist but
  hosted CI is disabled, and verification is local (F-007).

### Impact

Documentation only. Public APIs, protocol values, schemas, the CLI, and the store schema are
unchanged from 2.25.1.

## [2.25.1] - 2026-09-18

### Improvement

- Add the research applications conformance scenario: the repository evaluation runs all four
  applications through `./applications` in one store, with the coding supervisor on real scope
  custody (inject, discard and restart from a clean fork, handoff, and accept). Every manifest
  validates with `validateApplicationManifest` and the generated `application-manifest-v1` schema
  and cites the configured protocol; the report cites exactly the retained manifests, and its
  unchanged experiments reproduce the checked evaluation report. From the exported and imported
  archive alone it shows the discard decision and retry cut, the world fork, merge, and discard
  receipts, and every optimizer, compression, and Tree-RL branch restored from its declared source
  boundary and prefix. Inspections and the training batch digest are identical on the live,
  read-only, and imported stores.
- Add process crash evidence for the counterfactual optimizer and the Tree-RL adapter: a process
  killed inside a candidate branch or rollout session is refused under the live lease without a
  record, then retained as a rejected candidate or a failed rollout once the lease expires.
- Add the [Phase 10 exit audit](.plan/phase-10-exit-audit.md) and update the roadmap, parity
  matrix, paper coverage map, tracker, and README level table: Phase 10 is complete for its
  documented offline scope.

### Defect Fixes

- The counterfactual optimizer no longer evaluates or promotes a candidate whose branch or
  full-replay session ended `failed` or `cancelled`: the candidate is retained as `rejected` with
  `APPLICATION_EVIDENCE_INVALID` before the evaluator is consulted and the run stops. Trajectory
  compression restores a compressed session that did not finish without consulting the verifier,
  and rejects a restoration or control session that did not finish.
- `cost_usd` is null, as the manifest contract requires, when any observed usage reported no cost,
  including a live provider call that failed without a response; previously such a call counted as
  cost 0. The four application cost folds share one internal helper.
- The evaluation report's counterfactual comparison restricts both sides to candidates that retain a
  full-replay comparison; the generated page states that comparisons measure only the scoped
  sessions and are not whole-run savings; the `single-rollout-shared-cost` limitation now matches
  what is measured (a failed branch-0 rollout still counts in baseline cost and steps and makes
  baseline success false); `docs/protocol-configuration.md` names
  `APPLICATIONS_PROTOCOL_V5_CONTRACT` as the latest applications contract.

### Impact

Phase 10 is complete for its documented scope with repeatable conformance and crash evidence. This
slice changes tests and documentation only; protocol values, schemas, public APIs, and the store
schema are unchanged from 2.25.0.

## [2.25.0] - 2026-09-18

### New Feature

- Add offline application evaluation to `./applications` and the root: `runApplicationEvaluation`
  validates a caller evaluation definition (experiments with protocol, fixed command identities,
  and a baseline; limitations) and every experiment's binding before anything runs, then executes
  each configured application with its baseline and folds one measured-only
  `application-evaluation-v1` report. `readApplicationEvaluationDefinition` validates a definition
  on its own.
- Baselines resolve from the definition and unknown ones are refused before any record:
  `no_supervision` runs the named worker once as a plain child run (no policy, trace-only),
  `full_replay` uses the optimizer's whole-workflow comparison, `no_compression` keeps the source
  trajectory, and `single_rollout` reuses the Tree-RL branch-0 rollouts.
- Metrics (`cost_usd`, `provider_calls`, `input_tokens`, `output_tokens`, `steps`, `success`) are
  measured from retained evidence only. `compareApplicationBaseline` returns the application value,
  baseline value, and delta per metric (null unless both are numbers). The report carries runs
  (kind, manifest, protocol, seeds, dataset, manifest costs, metrics), baselines with their evidence
  identities, comparisons, and limitations; `report_id` (`evaluation-report:sha256:`) is the digest
  of the canonical body, and no wall-clock, host, node version, or duration appears in it.
  `validateApplicationEvaluationReport` re-derives every comparison and the identity.
- The evaluation writes no record of its own and every command it issues is idempotent, so a
  repeated evaluation re-executes nothing and an interrupted one converges on rerun to the report a
  fresh store produces.
- Add applications protocol v5 (`APPLICATIONS_PROTOCOL_V5_CONTRACT`, spreading v4) with the
  `evaluation` vocabulary, the generated `application-evaluation-v1` schema, and the constants
  `APPLICATION_EVALUATION_METRICS`, `APPLICATION_SUPERVISION_BASELINE_KINDS`,
  `APPLICATION_EVALUATION_REPORT_VERSION`, and `APPLICATION_EVALUATION_LIMITS`.
- Add the repository evaluation definition, offline fixtures, and published limitations to
  `config/research-applications.config.json`, the `pnpm evaluate:applications` and
  `pnpm check:evaluation` scripts (the check runs in `pnpm verify`), the generated
  `docs/generated/application-evaluation.json` and `.md` artifacts (host metadata only in the
  page's excluded trailing section), and the [application evaluation](./docs/application-evaluation.md)
  documentation.

### Impact

Callers can compare every research application against a simple, explicitly constructed baseline
and obtain a reproducible, digest-bearing report whose bytes are identical across runs, stores, and
hosts. The repository publishes such a report with its limitations; upstream headline results are
not reproduced. No existing API, record, or protocol value changes.

## [2.24.0] - 2026-09-18

### New Feature

- Add the §5.3 Tree-RL adapter to `./applications` and the root: `selectTreeRlForkPoints` selects
  deterministic fork points from a recorded replay session (provider steps whose transitive
  dependent count from `analyzeReplayDependencies` reaches the caller minimum, in index order, up to
  the fork-point bound), and `runTreeRlRollouts` replays the protocol's branch count of rollouts per
  fork point from its step boundary through `replayReplaySession`, each under its own seed and
  static provider cassette from a caller factory, proves each with `analyzeReplayDivergence`, and
  scores it with a caller reward function.
- Rollouts whose session did not finish, diverged, was interrupted by a dead writer whose lease
  expired, or whose reward threw or was not finite are retained as `failed` with a configured reason
  and excluded from every mean; the run still completes.
- Add `computeTreeRlAdvantages` (intra-branch and inter-branch advantages over completed rollouts,
  exactly `0` for a single-rollout fork point or a single fork point) and
  `exportTreeRlTrainingBatch`, which re-derives the canonical `jsonl_v1` batch (one line per
  completed rollout) and its digest from retained records. The digest is identical across runs of
  the same command with the same seeds and after archive import. The manifest cites the batch as
  `training_batch`. The `single_rollout` baseline is the batch of each fork point's first branch.
- Retain the opened, rollout, and batch records as `shepherd.application.tree_rl_rollout.v1`;
  `inspectTreeRlRun` validates them on writable, read-only, and imported stores.
- Every option, the protocol, the source, the selection, the `maxForkPoints`, `maxBranches`, and
  `maxRollouts` bounds, every provider, and the projected provider calls are checked before any
  record, so a refusal writes nothing. A crash at any append converges on rerun without re-running a
  session, and the reward is re-called only for a rollout whose record was never retained.
- Add applications protocol v4 (`APPLICATIONS_PROTOCOL_V4_CONTRACT`, spreading v3) with the
  `treeRl` vocabulary, the generated `application-tree-rl-rollout-v1` schema, and the constants
  `APPLICATION_TREE_RL_PHASES`, `APPLICATION_TREE_RL_ROLLOUT_STATUSES`,
  `APPLICATION_TREE_RL_BASELINE_KINDS`, and `APPLICATION_TREE_RL_BATCH_FORMATS`.
- Add the versioned §5.3 experiment definition (rollout prompt, `jsonl_v1` line schema, branch,
  fork-point, dependent-minimum, and provider-call budgets, seeds, and dataset) to
  `config/research-applications.config.json`, the
  [Tree-RL adapter](./docs/tree-rl-rollouts.md) documentation, and a packaged `./applications`
  probe.

### Impact

Callers can turn a recorded, offline replay session into a reproducible training batch with
per-rollout advantages whose digest is stable across stores and imports. The adapter trains
nothing and uses only caller-supplied static providers. No existing API, record, or protocol value
changes.

## [2.23.0] - 2026-09-18

### New Feature

- Add Appendix D trajectory compression: `runTrajectoryCompression` and
  `inspectTrajectoryCompression` in `./applications` record a source trajectory through
  `runReplaySession`, run a compressor as a delegated child (`openChildRun`, `runChildRun`,
  `acceptChildRunResult`) whose `{ fork_point, hint }` proposal is validated against the closed
  compression grammar and the source (named session, strict prefix boundary, exact retained prefix
  identity), and restore the fork point with `rewindReplaySession` before re-executing the suffix
  under the hint with `replayReplaySession`.
- A null fork point settles `no_prune`; a checkpoint fork point classified `unavailable` by
  `classifyReplayCheckpoint` refuses the prune and retains the classification, constituents, and
  reason. A compressed session that finished with strictly fewer steps is gated by a delegated
  verifier: `accepted` settles `pruned`, while `rejected` or an inadmissible compressed session
  re-runs the original suffix and settles `restored` with the retained reason. A verifier that
  fails or returns a malformed verdict retains the candidate as `rejected` with
  `APPLICATION_VERIFICATION_FAILED` and prunes nothing.
- Add the bounded best-of-N control: up to the protocol's `bestOfN` seeds (refused above
  `limits.maxBestOfN` before any record) run seeded plain reruns that are verified and retained as
  control candidates, and the `no_compression` baseline keeps the whole trajectory. The aggregate
  outcome reports measured step counts and step-count ratios only.
- Retain every candidate status and the outcome as `shepherd.application.compression.v1` records;
  a rerun after a crash converges through retained session, rewind, and child receipts without a
  second restore, and inspection is identical on read-only and imported stores.
- Add applications protocol v3 (`APPLICATIONS_PROTOCOL_V3_CONTRACT`, spreading v2) with the
  `compression` vocabulary, the generated `application-compression-v1` schema, and the constants
  `APPLICATION_COMPRESSION_PHASES`, `APPLICATION_COMPRESSION_CANDIDATE_KINDS`,
  `APPLICATION_COMPRESSION_CANDIDATE_STATUSES`, `APPLICATION_COMPRESSION_OUTCOMES`,
  `APPLICATION_COMPRESSION_VERDICTS`, and `APPLICATION_COMPRESSION_BASELINE_KINDS`.
- Add the versioned Appendix D experiment definition (compressor and verifier prompts, fork-point
  and hint schema, best-of-N and provider-call budgets, seeds, and dataset) to
  `config/research-applications.config.json`, the
  [trajectory compression](docs/trajectory-compression.md) documentation, a packaged-CLI probe, and
  the generated API reference section.

- Trajectory compression recovery: a rewind left non-terminal after its replay restore record is
  admitted from that record once its lease expires, without a second restore; an interrupted
  compressed suffix is restored as not admissible, and an interrupted restoration or control
  session is retained as rejected; delegation-seam refusals (another supervisor, a child left
  running by a dead process) raise without a record, and only a terminally failed child (including
  a cancelled one) or a refused output is retained as rejected; the measured source is refused
  before the `opened` record, and suffix, restoration, and control sessions are checked for measured
  budget overruns; hint citations must name retained source steps.

### Impact

Consumers can replace a recorded trajectory with a shorter verified rerun from a restorable fork
point, or keep the original with retained evidence of why, and compare against seeded plain reruns
by measured step counts. Applications protocol v1 and v2 values are unchanged.

## [2.22.0] - 2026-09-18

### New Feature

- Add the counterfactual workflow optimizer (Appendix F): `runCounterfactualOptimization` and
  `inspectCounterfactualOptimization` in `./applications` record a baseline workflow through
  `runReplaySession` and evaluate declared candidate edits (`task`, `provider`, or `handlers` at a
  step boundary) on branches opened with `replayReplaySession` from the boundary before the
  earliest transitive dependent of the edited step, so only the affected suffix runs live and an
  edit without dependents replays zero live steps. Candidates may fork a parent candidate's branch.
- Every branch is proven with `analyzeReplayDivergence` (no divergence before the target, none
  unexplained) and gated by a caller-supplied evaluator; a disproven branch or an evaluator that
  throws or returns a malformed verdict retains the candidate as `rejected` and stops the run with
  `ApplicationEvidenceError` or `ApplicationVerificationError`. The best passing candidate reaching
  the protocol's `minPromotionScore` is promoted once, terminally.
- Retain every candidate as `shepherd.application.cro_candidate.v1` records (`proposed`, then
  `evaluated` or `rejected`, and one `promoted`) with lineage, target, affected steps, branch
  session, divergence summary, verdict or failure, and measured cost, plus an optional measured
  `full_replay` comparison by live provider calls and cache-read tokens. Unsupported edit kinds and
  over-limit candidate sets are refused before any record; a `maxProviderCalls` budget refuses a
  session before it opens.
- Add applications protocol v2 (`APPLICATIONS_PROTOCOL_V2_CONTRACT`, spreading v1) with the `cro`
  vocabulary, the generated `application-cro-candidate-v1` schema, and the constants
  `APPLICATION_CRO_PHASES`, `APPLICATION_CRO_CANDIDATE_STATUSES`, and
  `APPLICATION_CRO_BASELINE_KINDS`.
- Add the versioned Appendix F experiment definition (proposer prompt and tools, reflection
  scratchpad and handoff manifest schemas, gate threshold, budgets, seeds, and dataset) to
  `config/research-applications.config.json`, the
  [counterfactual optimization](docs/counterfactual-optimization.md) documentation, a packaged-CLI
  probe, and the generated API reference section.

- Counterfactual optimizer lineage and recovery: a child candidate runs with the program, provider,
  and handler stack of its nearest ancestor that declared them instead of the baseline's, including
  in its `full_replay` comparison; every edited step index is validated against the baseline before
  the `opened` record (`APPLICATION_PROTOCOL_INVALID`, no application record); the measured baseline
  and every session's measured provider calls are checked against `maxProviderCalls`; a branch or
  full-replay session left interrupted by a dead writer is retained as a `rejected` candidate with
  `APPLICATION_EVIDENCE_INVALID` instead of blocking every rerun.

### Impact

Consumers can compare candidate workflow edits by replaying only the dependency-scoped suffix of a
recorded trace, with retained, record-derived lineage and promotion evidence that inspects
identically from an imported archive. The `./applications` entry now loads the same
process-support module as `./replay` because it composes replay sessions; no process is started by
importing it. Applications protocol v1 values are unchanged.

## [2.21.0] - 2026-09-18

### New Feature

- Add the `./applications` package entry and the `applications` protocol section v1
  (`APPLICATIONS_PROTOCOL_V1_CONTRACT`) with generated `application-manifest-v1` and
  `application-supervision-v1` schemas and constants (`APPLICATION_KINDS`,
  `APPLICATION_PROTOCOL_SURFACES`, `APPLICATION_LIMITS`, supervision phases, policy kinds, conflict
  kinds, and worker statuses).
- Add application protocol definitions and manifests: `readApplicationProtocol`,
  `applicationProtocolId`, `deriveApplicationOwnerId`, `createApplicationManifest`,
  `validateApplicationManifest`, `retainApplicationManifest`, and `inspectApplicationManifest`.
  Manifests cite protocol surfaces and artifacts by digest, fold measured costs, and are retained
  as `shepherd.application.manifest.v1` on a command-derived reserved owner path under a terminal
  cut; raw appends and cut publication onto application owner paths are refused.
- Add the two-worker coding supervisor (Appendix E): `runCodingSupervisor` and
  `inspectCodingSupervisorRun` compose child run handles with observation, path-overlap conflict
  classification, `inject`, `handoff`, `discard_restart` from a clean fork, and a terminal `accept`
  that merges one worker and discards the rest, retaining one
  `shepherd.application.supervision.v1` record per round citing the exact evidence.
- Add the caller-supplied `ApplicationWorldAdapter` interface and `createScopeWorldAdapter` in
  `./workspace` over scope fork, merge, discard, and world changesets, with idempotent receipts per
  command identity.
- Add the public errors `ApplicationProtocolError`, `ApplicationBudgetError`,
  `ApplicationEvidenceError`, and `ApplicationVerificationError`.
- Add the repository Appendix E experiment definition in
  `config/research-applications.config.json`, the
  [application manifests](docs/application-manifests.md) and
  [coding supervisor](docs/coding-supervisor.md) documentation, entry-loading and packaged-CLI
  probes, and the generated API reference section.
- Coding supervisor recovery: a rerun resumes after retained `handoff` rounds by replaying each
  attempt under the supervisor that opened it; a rerun with different workers, supervisor, world
  binding, or protocol is refused against the retained opened record before any fork or handle is
  opened, writing nothing; a crash after a round's decision was applied but before its record was
  retained is completed with the decision rebuilt from the retained delegation commands instead of
  consulting the policy again. Observation and action schema surfaces are digest-pinned model
  documents; runtime validation is against the closed `application-supervision-v1` grammar.

### Impact

Consumers can run and inspect a supervised multi-worker coding application with a versioned,
content-addressed protocol and a reproducible manifest. Existing entries, records, and protocol
sections are unchanged; the store refuses general writes only to the new application owner prefix.

## [2.20.2] - 2026-09-15

### Improvement

- Add the [research applications contract](.plan/research-applications-contract.md) for Phase 10:
  canonical digest-bearing application manifests (protocol identity over prompts, schemas, tools,
  budgets, seeds, and dataset selection; artifact citations by identity; measured cost folding) and
  the `applications` protocol vocabulary with its versioned-append rule; the two-worker coding
  supervisor with inject, handoff, and discard/restart policies over child run handles and a
  caller-supplied world adapter (Appendix E); the counterfactual replay optimizer with candidate
  edits limited to declared change dimensions at a step boundary, the dependency-scoped suffix rule,
  divergence proof, targeted-eval gate, candidate lineage, and the `full_replay` baseline
  (Appendix F); Appendix D trajectory compression with the fork-point/hint schema, suffix
  restoration, `no_prune` and `restored` outcomes, checkpoint honesty, verifier gate, and bounded
  best-of-N control; the Tree-RL adapter with deterministic trace-selected fork points, seeded
  branched rollouts, intra- and inter-branch advantage formulas, and the `jsonl_v1` training batch;
  the measured-only evaluation report with its baseline kinds and digest determinism rule; the
  failure and recovery table; and non-claims.
- Index the contract in `.plan/README.md` and point the tracker's next slice at #172.

### Impact

Documentation-only planning slice; no runtime, protocol, schema, or storage change from 2.20.1.

## [2.20.1] - 2026-09-15

### Improvement

- Add the task-as-value conformance scenario: a supervisor accepts a planner's `schema.task()`
  output as data, runs it in a child under a root declaration, observes it through
  `observeChildRun`, inspects its trace, discards it, retries with an approved revised task value
  whose revised identity and causal replay point are explicit, injects context the retry consumes,
  hands the handle off to a successor who accepts the result, projects the typed value, proves
  nested grandchild authority bounds and isolation, refuses synthesized values carrying code, and
  re-reads identical inspections, trees, and projections from an imported archive.
- Add process crash evidence: a program-serviced child killed after its durable start stays
  `running` and fail-closed until the documented cancellation path settles it, then is discarded
  and retried; a child killed after its terminal but before the completion record settles through
  `runChildRun` without re-execution.
- Add the [Phase 9 exit audit](.plan/phase-9-exit-audit.md) and update the roadmap, parity matrix,
  paper coverage map, tracker, and README level table: Phase 9 is complete for its documented scope
  and L3 paper programming-model parity is reached for that scope.

### Defect Fixes

- `openChildRun` and `retryChildRun` now refuse an opening command identity that a handle command
  on another handle already retained, with `DelegationCommandConflictError` before any record;
  previously such an identity opened a second handle because the opening and command append
  intents differ.

### Impact

Phase 9 is complete for its documented scope with repeatable conformance and crash evidence;
protocol values, schemas, and store schema are unchanged from 2.20.0.

## [2.20.0] - 2026-09-15

### New Feature

- Add `projectChildRunResult`: the typed projection of one handle's retained result. An accepted
  handle's child outcome is re-validated against the retained task value's output schema
  (rehydrated through the schema factory), normalized, and checked against the accept decision's
  `output_id`; every other status projects a null value. An optional caller schema proves the
  static value type and must canonically equal the retained output schema.
- Add `projectDelegationTree`: the direct handles under a handle root or a supervisor root, folded
  with `inspectChildRun` into entries carrying status, current supervisor, authority, budget,
  depth, task value, and result projection in canonical handle-identity order. Grandchildren appear
  only through the values their parents accepted; a handed-off handle appears under its successor.
- Add `delegation.limits.maxTreeEntries` and `delegation.treeRootKinds` configuration with the
  `DELEGATION_TREE_ROOT_KINDS` value tuple; a tree with more direct handles than the bound is
  refused with `TypeError`.
- Add nested meta-agent isolation evidence: a program-serviced child opens grandchildren under its
  own handle with authority and budget bounded by its own, grandchild records stay on their own
  owner paths, the root's tree never lists them, and discarding the child removes everything
  threaded through it from the root's projection.

### Impact

Accepted child results thread upward as typed, record-proven values and supervisors read bounded
delegation trees without exposing grandchild records or authority; see
[result threading and nested meta-agents](docs/result-threading.md). The delegation configuration
gains one bound and one vocabulary under the unchanged `shepherd.delegation.v1` record namespace.

## [2.19.0] - 2026-09-15

### New Feature

- Add task provenance to child run handles: `declared` for package-created descriptors, `revised`
  for a task value that keeps its source task identity and lists exactly the differing configured
  revision fields, and `synthesized` for a task value produced by a cited record retained on a run's
  owner path. A task value supplied as data must state its provenance.
- Add `approveChildRunTask`: revised and synthesized handles open `approval_pending`, `runChildRun`
  refuses them with `DelegationApprovalRequiredError` without writing child records, and the current
  supervisor retains one approval with the approver identity, optional reason, and approved task
  artifact digest; `approved` moves the handle to `ready` and `rejected` is terminal for execution.
- Retain the causal replay point of a revision retry: the successor's opened record carries both
  the revised provenance and the discarded predecessor with its decision record and retry cut.

### Impact

Model-generated task definitions execute only as validated, approved task values through the
provider path or a caller program under the child run identity; see
[task revision and synthesis](docs/task-revision.md). Protocol values are unchanged from 2.18.0.

## [2.18.0] - 2026-09-15

### New Feature

- Add supervisor operations over child run handles through `./delegation`: `observeChildRun`
  (trace subscriptions over the handle and child run owners), `injectChildRunContext` (ordered
  cited context injections folded into the composed provider request `{ input, supervisor_context }`
  before the child starts, with a consumption record retaining the consumed identities and request
  digest), `handoffChildRun` (fenced supervisor ownership transfer; commands from former supervisors
  are refused with `DelegationSupervisorError`), `discardChildRun` and `acceptChildRunResult`
  (terminal decisions; accept validates the finished output and retains its digest), and
  `retryChildRun` (a successor handle citing the discarded predecessor, its decision record, and a
  retry cut).
- Derive the current supervisor, injections with consumption flags, handoffs, approval, decision,
  and predecessor in `inspectChildRun`, with the `approval_pending`, `rejected`, `accepted`, and
  `discarded` statuses now produced.
- Add `delegation.contextPhases`, `delegation.identity`, and `delegation.errors` configuration and
  the `DELEGATION_CONTEXT_PHASES` value tuple.

### Impact

Supervisors observe, steer, hand off, discard, retry, and accept delegated children with retained
evidence for every operation; see [supervisor operations](docs/supervisor-operations.md).

## [2.17.0] - 2026-09-14

### New Feature

- Add record-proven delegated authority for child run handles: resource attenuation through the
  scope rule against a root ceiling or the parent handle's effective authority, budget attenuation
  that requires every parent-declared metric no greater than the parent's with the ceiling retained
  as `budget_ceiling`, nesting depth bounded by `delegation.limits.maxNestingDepth`, parent-handle
  verification at opening with an origin cut published through the parent handle head, and
  inspection that re-derives effective authority and refuses disagreeing evidence with
  `DelegationEvidenceError` and forged or foreign handles with `TypeError`.
- Add the seeded delegation law suite, driven by `config/delegation-law.config.json`, proving that
  effective authority is contained in the grant, the parent's effective authority, and the ceiling
  for every handle of random program-serviced chains and that amplifying grants and budgets are
  refused before opening.

### Improvement

- Exercise the cooperative replay channel's late input-error path deterministically: the counter
  worker fixture stalls on an oversized request so the timeout kill fails the queued input with a
  closed pipe that the channel absorbs, removing a host-dependent coverage gap.
- Lock the `delegation` and `program` provider configuration, the task value schema reference, and
  the published task value and delegation schemas in the protocol drift and schema suites, and pin
  the `./delegation` export in the package metadata test.

### Impact

`./delegation` consumers gain the documented authority guarantees in
[delegated authority](docs/delegated-authority.md). No schema or configuration values change from
2.16.0.

## [2.16.0] - 2026-09-14

### New Feature

- Add task values: `readTaskValue`, `taskValueOf`, and `taskDescriptorOf` treat a task as the
  canonical `{ artifact, artifact_lock }` data pair with lock re-derivation and descriptor
  rehydration through the task builder, and `schema.task()` types a task value as task input or
  output through the published `task-value-v1` JSON Schema reference, which `schema.fromJSONSchema`
  maps back and the descriptor schema admits.
- Add durable child run handles on command-derived reserved owner paths through the new
  `./delegation` package entry: `openChildRun` retains the supervisor, parent, task value with
  declared provenance, validated input, grant, budget, derived authority, and depth; `runChildRun`
  executes provider- or program-serviced children as ordinary durable executions under derived run
  identities, validates program output against the task output schema, and retains a head-compared
  completion citing the child terminal and cut, settling a child that finished before the
  completion without re-execution; `inspectChildRun` derives `ready`, `running`, and `settling`
  status from handle records and the child's durable inspection on reopened, read-only, and
  imported stores.
- Add the `delegation` protocol configuration section with its compatibility constant, generated
  constants, and published `delegation-opened-v1`, `delegation-context-v1`,
  `delegation-completion-v1`, `delegation-approval-v1`, `delegation-handoff-v1`, and
  `delegation-decision-v1` schemas; add the `program` provider kind used by program-serviced
  children; refuse raw appends and cut publication on handle owner paths.

### Impact

Consumers can pass tasks as data and delegate durable child runs through `./delegation`; see
[task values and child run handles](docs/task-values.md). Task protocol v1 gains
`tasks.schemas.valueId` and `tasks.artifacts.valueSchema`, provider protocol v1 gains the
`program` kind, and the task descriptor schema admits the task value reference; existing
descriptors, locks, and records are unchanged. No store schema change.

## [2.15.2] - 2026-09-14

### Improvement

- Add the Phase 9 task-as-value meta-agent contract (`.plan/task-as-value-contract.md`): task
  values and the task schema kind, child run handle commands with idempotency and head comparison,
  non-amplifying resource and budget delegation, supervisor operations, task revision and
  synthesis with provenance and approval, typed result threading, nested isolation, the failure
  table, and non-claims, with pinned upstream evidence.

### Impact

Documentation only; no runtime, schema, or storage change.

## [2.15.1] - 2026-09-14

### Improvement

- Add coupled replay conformance: one scenario records an atomic multi-resource checkpoint with a
  cooperative process and a verified provider session, imports the exported archive into a fresh
  store, rewinds byte-equivalent worlds and the process image, replays with a changed provider so
  only the intended suffix diverges, refuses an unapproved irreversible suffix effect, and reports
  transparent process checkpointing as unavailable.
- Add process crash tests for a session writer killed between steps and after an effect admission,
  each recovered by rewinding a retained checkpoint.
- Add the Phase 8 exit audit mapping every coupled checkpoint, rewind, and replay work item and exit
  criterion to entry points, documentation, and tests, and update the roadmap, tracker, parity
  matrix, and README level table.

### Defect Fixes

- Gate a branch suffix effect whose intent the source admitted without a step, regardless of tier,
  and report it as re-materialization.
- Fail cooperative requests on child input, process, and write errors instead of crashing the host
  with an unhandled `EPIPE`, and bound every protocol line including lines ending in the same chunk.
- Enforce per-kind checkpoint constituent statuses and evidence, bind restore records, recorded step
  content, and suffix approvals to the source journal, and classify a live writer inside a handler as
  running.
- Resolve the task in force through branch ancestry for nested replays.
- Enforce the world-entry bound at capture, refuse protected names and untraversable directory modes
  in restored manifests, and record `cancelled` only for cancellation observed before the program
  returned.

### Impact

Phase 8 is complete for its documented scope. Protocols and schemas are unchanged from 2.15.0.

## [2.15.0] - 2026-09-14

### New Feature

- Add `analyzeReplayDivergence`: aligns a branch session with its source by step index, classifies
  steps as identical, diverged, source only, or replay only, and classifies each difference as root,
  propagated, or unexplained from declared dependencies and declared changes.
- Add `analyzeReplayDependencies`: the transitive dependents of one step and the later steps
  independent of it.

### Impact

Deterministic tests can prove that only the intended suffix of a replay diverges.

## [2.14.0] - 2026-09-14

### New Feature

- Add `createCooperativeProcessAdapter`: a process checkpoint adapter that drives a child process
  through a bounded newline-delimited JSON protocol, captures its image, restores it into a fresh
  process, and fails closed on errors, exits, timeouts, and malformed messages.
- Add `createTransparentProcessAdapter`: a CRIU adapter that reports platform, executable, and host
  check unavailability with configured reasons and never claims transparent image capture.

### Impact

Coupled checkpoints can capture and restore cooperating worker processes, and hosts without
transparent checkpointing are reported accurately.

## [2.13.0] - 2026-09-14

### New Feature

- Add `rewindReplaySession` and `replayReplaySession`: branch sessions that verify every claimed
  constituent before writing, restore worlds byte-equivalently into empty roots, hand verified
  provider-session and process captures to their adapters, and retain an atomic or reconstructive
  restore record.
- Rewind copies the verified source prefix as recorded steps. Replay re-executes the program, serves
  exact recorded requests and intents without provider or handler invocation, fails with retained
  `ReplayPrefixMismatchError` evidence on any difference, and continues live with a changed task,
  provider, or handler stack.
- Approval-required suffix effects run only with replay policy approval; refusals are retained and
  never reach a handler.
- Add the `replay-restore-v1` schema and the `ReplayCheckpointUnavailableError`,
  `ReplayRestoreError`, `ReplayPrefixMismatchError`, and `ReplayEffectRefusedError` classes.

### Impact

Historical agent and environment states can be rewound and continued with verified identities,
including from imported archives.

## [2.12.0] - 2026-09-14

### New Feature

- Add coupled checkpoints: `context.checkpoint()` publishes a trace cut and retains, under one
  session fence, content-addressed world images of every bound world, provider-session adapter
  evidence, process adapter images, and the irreversible-effect frontier.
- Add `classifyReplayCheckpoint`, deriving atomic, reconstructive, or unavailable classification with
  configured unavailability reasons.
- Add the provider-session and process adapter contracts, internal reference copy carrier
  world-image helpers, and the `replay-checkpoint-v1` schema.

### Impact

Checkpoints state exactly which constituents are verified; coordinated multi-resource world
checkpoints reassigned from Phase 6 are delivered.

## [2.11.0] - 2026-09-14

### New Feature

- Add the Node-only `./replay` package entry and replay protocol v1 configuration.
- Add `runReplaySession`: a deterministic session program whose provider exchanges and effects are
  retained as steps with declared dependencies, runtime-derived prompt, response, prefix, and context
  prefix identities, cache-hit evidence, and admission before materialization, ending in a finished,
  failed, or cancelled terminal record.
- Add store schema v12 replay session leases: single fenced writers, renewal, reserved session owner
  paths for `append` and `publishCut`, and `replay_session_mismatch` integrity issues.
- Add `inspectReplaySession` and `deriveReplaySessionId` with terminal, running, interrupted, and
  materialization-uncertain classification; non-terminal sessions are never resumed in place.
- Add the replay session, step, admission, and terminal schemas and the `ReplayEvidenceError`,
  `ReplayCompatibilityError`, `ReplayLeaseConflictError`, `ReplayLeaseFencedError`,
  `ReplaySessionInterruptedError`, `ReplayMaterializationUncertainError`, and
  `ReplayStepFailureError` classes.

### Impact

Agent executions can be recorded as replayable journals with verified identities. Store schema v12
is additive; raw appends and cut publications on replay session owner paths now fail with
`TraceStoreError`.

## [2.10.2] - 2026-09-14

### Improvement

- Add the Phase 8 coupled checkpoint, rewind, and replay contract: the session step journal,
  prompt, prefix, and cache identity, checkpoint constituents and classification, rewind and suffix
  replay, irreversible-effect replay rules, process backends, divergence analysis, a failure table,
  and non-claims.

### Impact

Documentation only. Runtime behavior, public API, protocols, and schemas are unchanged.

## [2.10.1] - 2026-09-14

### Improvement

- Add passive-observation conformance: one worker scenario produces byte-identical exported
  archives and equal dispatch inspections with zero observers and with durable, ephemeral, and
  overflowing subscriptions.
- Add process crash tests for a dispatcher killed while an interceptor owns the decision lease, a
  dispatcher killed after admission, and a subscriber killed after acknowledging.
- Add the Phase 7 exit audit mapping every live observation and interception work item and exit
  criterion to entry points, documentation, and tests, and update the roadmap, tracker, parity
  matrix, and README level table.

### Defect Fixes

- Renew the dispatch decision lease on a schedule measured across the whole dispatch, so many
  short waits and appends can no longer outlive the lease and strand a completed effect.
- Refuse general `SQLiteTraceStore.append` groups on dispatch and context-channel owner paths, and
  require single-parent causality, configured record modes, and dispatch causes equal to citations
  during dispatch inspection.
- Mint a new fencing token on every dispatch reopen, including with the same claim identity.
- Require a reason for interceptor-sourced deny, replace, and pause decisions.
- Resolve a synchronously throwing or malformed handler dispatch as `materialization_failed`.
- Document that the handler wait after admission is unbounded, that redelivered records keep their
  owner ordinal rather than their cursor, and that a durable subscription identity serves one
  consumer.

### Impact

Phase 7 is complete for its documented scope. Raw appends to supervision owner paths now fail with
`TraceStoreError`; protocols and schemas are unchanged from 2.10.0.

## [2.10.0] - 2026-09-14

### New Feature

- Add human approval gates for supervised effects: interceptor pauses and the configured
  irreversible frontier append approval requests for the exact effective intent, and
  `resolveSupervisedApproval` appends a globally idempotent `approved` or `rejected` verdict only
  while that request is the dispatch head, so a verdict and the dispatcher's fail-closed expiry
  have exactly one winner.
- Add cited context injection: `injectSupervisionContext` appends bounded application data to a
  named channel whose cited retained records are its causal parents, and `readSupervisionContext`
  returns validated injections.
- Re-export the fenced durable-run `requestDurableTaskPause`, `resumeDurableTask`,
  `requestDurableTaskCancellation`, and `cancelDurableTask` commands from `./supervision`.
- Add the `supervision-approval-v1` and `supervision-context-v1` schemas.

### Impact

Supervisors can pause at an effect boundary, approve or reject exact intents, and steer workers
with cited context. No worker can wait for an approver indefinitely.

## [2.9.0] - 2026-09-14

### New Feature

- Add `dispatchSupervisedEffect`: a durable supervised effect dispatch on its own owner path with
  interceptors ordered by priority then identity, retained allow, deny, replace, and pause
  decisions, declared fail-open or fail-closed timeout and failure policy (irreversible tiers
  always fail closed), admission before materialization, and a terminal resolution that carries
  the correlated outcome only for a materialized effect.
- Add fenced renewable decision leases in store schema v11: stale dispatchers are refused, and a
  replacement resumes from retained decisions without invoking decided interceptors.
- Add `inspectSupervisedDispatch` with `resolved`, `materialization_uncertain`,
  `resolution_pending`, `approval_pending`, and `decision_pending` classification. Admission
  without resolution fails closed with `SupervisionMaterializationUncertainError` and never
  re-invokes the handler.
- Add the supervision dispatch, decision, admission, and resolution schemas, the supervision error
  classes, and `supervised_dispatch_mismatch` integrity issues.

### Impact

Destructive intents can be denied or rewritten before they reach the world, with durable evidence
and crash-safe ownership. Store schema v11 is additive; existing records and identities are
unchanged.

## [2.8.0] - 2026-09-14

### New Feature

- Add the Node-only `./supervision` package entry and supervision protocol v1 configuration.
- Add `openTraceSubscription`: durable and ephemeral cursor subscriptions over exact owner paths
  with a canonical owner-ordinal cursor identity, pull-driven bounded buffers, lag metrics, a
  `backpressure` or `fail` overflow policy that never drops records, abort and close, and
  monotonic acknowledgement.
- Add store schema v10 subscription cursor bookkeeping outside the record graph and trace export.
  Reopening a durable subscription resumes strictly after its acknowledged cursor.
- Add the `supervision-cursor-v1` schema and `trace_subscription_mismatch` integrity issues.

### Impact

Observers can follow live traces and reconnect without losing or duplicating acknowledged records,
without changing any worker record. Store schema v10 is additive.

## [2.7.2] - 2026-09-14

### Improvement

- Add the Phase 7 live observation, interception, and supervision contract: observer,
  interceptor, approver, dispatcher, and context roles, cursor semantics, the dispatch record
  sequence, timeout and approval policy, decision leases, a supervisor failure table, and
  non-claims.

### Impact

Documentation only. Runtime behavior, public API, protocols, and schemas are unchanged.

## [2.7.1] - 2026-09-13

### Improvement

- Add the Phase 6 exit audit mapping every scope-algebra work item and exit criterion to delivered
  entry points, documentation, and tests, and update the roadmap, tracker, parity matrix, and
  README level table to record L2 substrate parity for the recorded hosts.

### Defect Fixes

- Resolve pending discard cleanup ownership through sealed parents, and classify a discard with no
  custody that was interrupted before its cleanup record as pending instead of terminal.
- Remove protected merge application custody left by a crash after merge completion when a
  schedule is re-run, fail closed with `ScopeEvidenceError` when a schedule no longer matches
  retained evidence, and report several failing sibling subtrees together as an `AggregateError`.
- Document the macOS clone helper's same-user threat model.

### Impact

Phase 6 is complete for its documented scope. Coordinated multi-resource world checkpoints move to
Phase 8. Runtime behavior, public API, protocols, and schemas are unchanged.

## [2.7.0] - 2026-09-13

### New Feature

- Add clone and Linux overlay carrier backends selected with `createReferenceCopyCarrier({ backend })`
  under workspace protocol v26. Clone materializes files with reflinks (Linux `FICLONE`, macOS
  `clonefile(2)` through a verified private helper) and overlay mounts custody over the immutable
  revision with private upper and work layers and remounts after restart. Both fail closed when
  unavailable and keep content, revision, and changeset identities equal to the copy reference.
- Report per-backend conformance in `inspectWorkspacePlatformConformance`, and add the shared
  carrier conformance suite, `pnpm test:carriers:linux` (privileged Linux container on tmpfs and
  loopback XFS reflink), and `pnpm bench:carriers` storage benchmark.
- Run the scope algebra law suite on every host-conformant optimized backend, with required
  backends enforced in the Linux run.

### Impact

Scope branches can use copy-on-write storage that scales with changed data while passing the same
correctness suites as the copy reference. Existing carriers, records, and identities are unchanged;
the macOS clone backend requires a C compiler and spawns one helper process per cloned file.

## [2.6.0] - 2026-09-13

### New Feature

- Add `classifyScopeCheckpoint`: proves from a retained checkpoint descriptor whether a branch
  started from an atomic snapshot, a quiescent verified copy, or reconstructed state. It lists
  every constituent by evidence status and reports restorability only when nothing is
  reconstructive or unavailable.
- Add scope protocol v6 with the configured start classifications and the capture-kind mapping.

### Impact

Callers can distinguish verified-copy branches from reconstructed ones without trusting
identifiers or timestamps. Existing fork records and checkpoints decode unchanged.

## [2.5.1] - 2026-09-13

### Improvement

- Add a seeded scope algebra law suite that runs configured operation sequences against a pure
  reference model and the durable store, comparing states, worlds, ordered selected histories,
  refusal classes, and inspections across restarts, plus an explicit disjoint-merge commutativity
  law.

### Impact

Scope merge and discard semantics are now checked against an executable reference model on every
verification run. Runtime behavior, public API, protocols, and schemas are unchanged.

## [2.5.0] - 2026-09-13

### New Feature

- Add `runScopeTree` on the workspace entry: bounded parallel and nested scheduling of declared
  child scopes with depth-first settlement, deterministic sibling order independent of
  parallelism, failure and conflict isolation to the affected subtree, world forks, and restart
  convergence from command identities derived from the node path.
- Add `inspectScopeRecovery`: a record-derived classification of every live scope as terminal,
  cleanup pending, merge pending, fork pending, writer expired, writer held, or idle, naming the
  single recovery owner and the exact retained command to resume.
- Add scope protocol v5 with the scheduling and recovery vocabulary and bounds.

### Defect Fixes

- Refuse merging a child whose discarded children still have pending cleanup, and return the
  decided receipt when a discard is retried after its parent was sealed.
- Verify every unplanned parent custody path before merge publication writes anything.
- Build the merged revision only after the reservation wins, under a command-derived custody
  identity that subtree discards also clean, so refused plans leave no protected custody.
- Refuse merging merged, discarded, or reserved scopes before any carrier work.
- Validate parent integrations against the exact reservation, integration, and seal, resolve every
  contribution to its retained occurrence, and require sealed descendants to be named by their
  subtree root's decision.

### Impact

Callers can run nested scope trees in parallel and resume them after a crash, and operators can
see exactly which scope owns each recovery. Merge and discard are stricter about quiescence and
forged evidence. The scope merge world plan no longer retains merged revision fields; merged
content is reported by the completion and receipt.

## [2.4.0] - 2026-09-13

### New Feature

- Add `projectScopeVocabulary`: a read-only mapping of `spawn` (child registration or fork),
  `adopt` (consume-once merge of a verified child cut), `abandon` (logical discard decision, with
  cleanup progress separate), and `publish` (exact contributions made parent-visible by a merge)
  onto retained scope evidence, with pending status for reserved merges and incomplete forks.
- Add scope protocol v4 with the configured vocabulary terms, statuses, and projection version.

### Impact

Consumers using upstream lifecycle vocabulary can read it from exact scope evidence without new
command aliases. Version-1 execution-history relation and publication projections are unchanged,
and existing scope records decode unchanged.

## [2.3.0] - 2026-09-13

### New Feature

- Add `mergeScope` on the workspace entry: a consume-once merge of a quiescent child into its
  owning parent under both writer fences. For reference-copy children it derives an exact three-way
  plan from the common origin, the captured child world, and the captured current parent world.
  Overlapping changed paths fail with `ScopeMergeConflictError` without consuming either scope.
  Disjoint changes publish into parent-managed custody, converging from any prefix and completing
  only on verified merged content.
- Add a single-winner merge reservation that publishes the fixed child cut, refuses competing
  terminal decisions and child writes, and keeps the parent quiescent until completion. The
  completion appends a parent-side integration and a child seal.
- Add selected history to `inspectScope`: a scope's own emissions plus exact child contributions
  identified by owner, ordinal, and record. Common-origin history is never re-added and
  grandchild contributions arrive once.
- Add `discardScope`: a logical subtree discard under the owning parent's fence that seals every
  open descendant and requires no unreleased writer claims. The parent keeps its current state.
  Custody cleanup, separate progress with its own record, discards only identities named by
  retained fork journals and resumes after interruption or without a carrier.
- Add scope protocol v3 with merge and discard vocabulary appended to v2, generated merge,
  child-merged, and discard schemas, derived `merged`/`discarded` branch state, terminal receipt
  replay, row-state integrity checks, and the `ScopeQuiescenceError` and
  `ScopeTerminalConflictError` refusals.

### Impact

Scope branches now end in exactly one verified merge or discard with restart recovery through
public APIs. Scope v1 and v2 records decode unchanged, no store migration is required, and
retained-world settlement to user workspaces keeps its exact contract. Scheduling, optimized
carriers, vocabulary mapping, and algebraic law suites remain open.

## [2.2.0] - 2026-09-13

### New Feature

- Add `forkScope` on the workspace entry: an isolated child scope with reference-copy custody of
  one bound resource. The origin must be a verified revision of the parent world. A prepared fork
  record is retained before physical custody, and completion under the parent's current writer
  fence cites the verified custody.
- Add honest checkpoint descriptors that classify trace cut, execution, binding, world, grants,
  child frontier, budget, provider session, process, and irreversible effects as verified with a
  receipt, reconstructive, not applicable, or unavailable with a reason.
- Add receipt-based fork restart recovery. Interruption before admission, after the prepared
  record, or before completion converges on retry. A lost completion response replays without
  carrier work. Every retry re-checks the current parent fence, the prepared child head, and the
  absence of any admitted child writer before carrier work. Modified or discarded custody stays
  blocked.
- Add `claimScopeWriters` for atomic multi-scope writer claims in canonical order with no partial
  acquisition, and refuse writer claims on a forked child until its fork completes.
- Add scope protocol v2 with fork, checkpoint, and workspace-binding vocabulary appended to v1, a
  generated fork journal schema, and fork evidence in inspection and receipt replay.

### Impact

Consumers can fork isolated, fenced scope worlds and recover them after restart through public
APIs. Scope v1 records decode unchanged and no store migration is required. Merge, discard,
multi-resource forks, optimized carriers, and provider or process restoration remain unclaimed.

## [2.1.2] - 2026-09-12

### Improvement

- Cover scope inspection's fail-closed checks for emission and child-registration evidence that is
  retained by its own command intent on the current head but names another scope, restoring the
  configured 100% line and branch coverage gate.

### Impact

Repository verification passes again after the scope registration slice. Runtime behavior, public
API, protocols, schemas and dependencies are unchanged.

## [2.1.1] - 2026-09-11

### Improvement

- Move repository-only verification policy (test runner, entry loading, bundle fixtures and
  runtime boundaries) from the repository root into `config/`, updating the tooling readers and
  documentation links.

### Impact

The repository root keeps only shipped runtime configuration, project identity and standard tool
files. The published package, runtime behavior, protocols, schemas and dependencies are unchanged.

## [2.1.0] - 2026-09-10

### New Feature

- Add the `./scopes` entry with trace-only durable scope registration: content-addressed root
  and child scopes, parent-owned child-registration control records, deterministic immutable
  origin cuts through the exact parent head, and retained ceiling/effective authority attenuated
  per exact resource from parent, request, and whole-run ceiling.
- Add single-writer scope claims with monotonic fencing tokens, configured leases, idempotent
  release, expiry takeover, and package-authenticated writer handles that reject forged copies.
- Add globally idempotent scope-local emission of validated canonical application data with
  exact-head admission, retained-record citations, replay before liveness validation, and
  conflict on changed content.
- Add record-derived scope inspection that reconstructs the same value after reopen, read-only
  reopen, and native archive import, verifies every record against its command intent, and
  reports whether live mutation is registered, plus a receipt-replay read that returns the exact
  original receipt of a completed command without writer authority.
- Add store schema v9 scope registration and writer-claim tables, integrity verification of
  registration rows, the `scopes` protocol section, immutable scope v1 contract, generated
  constants, and three generated JSON Schemas.

### Impact

Consumers can register isolated scope identities and retain fenced scope-local evidence through
`@avnionur/shepherd-typescript/scopes`. Existing stores migrate to schema v9 without rewriting
records; imported archives expose scopes as inspection evidence only. No world fork, merge,
discard, provider, process, or materialization capability is added, and no L2 parity is claimed.
Runtime, dependencies, and supported Node versions are unchanged.

## [2.0.1] - 2026-09-09

### Improvement

- Propose the Phase 6 isolated-scope ownership, authority, command/recovery and checkpoint
  contract with pinned-source distinctions and dependency-ordered implementation slices.
- Clarify local emission, explicit parent integration, current-parent preservation on discard,
  immutable evidence, writer fencing and the separate user-workspace materialization boundary.
- Reconcile Phase 5 completion and Phase 6 planning status after delivered runtime remediation.

### Impact

The next scope implementation has explicit review and acceptance boundaries. Runtime, protocols,
schemas, dependencies and supported Node versions are unchanged; no scope API or L2 parity is claimed.

## [2.0.0] - 2026-09-08

### Breaking Changes

- Narrow runtime support to Node >=24.12.0 <25 with owner approval. Unsupported versions and
  prereleases are rejected during Node runtime initialization; the type-only read entry is exempt.
- Prove required SQLite defensive behavior in memory before persistent trace/registry/staging
  setup, preserving existing required settings and refusing unavailable or ineffective support.
- Ship a validated runtime-policy asset, verify package-engine agreement, and add explicit
  installed minimum/unsupported runtime checks. Bundled consumers must include the new policy asset.

### Impact

Consumers on Node 24.0–24.11 or other majors must move to the supported range. CLI bootstrap refusal
precedes JSON command handling. Public APIs, protocol identities and database schemas are unchanged;
no storage migration is required. Version 2.0.0 is not a production-readiness certification.

## [1.68.1] - 2026-09-08

### Improvement

- Audit Phase 5 exit criteria against installed-package and public API evidence, with explicit
  optional-adapter, platform, browser and bundler limits.
- Record a blocking mismatch between the declared Node range and required SQLite capabilities;
  retain Phase 5 as open and track runtime-policy remediation separately.

### Impact

The audit distinguishes delivered product features from unresolved exit requirements. Runtime,
protocol, dependencies and the declared support range are unchanged.

## [1.68.0] - 2026-09-08

### New Feature

- Add SQLiteTraceStore.iterateCutRecords for lazy async consumption of frozen owner occurrences
  through a verified published cut, preserving repeated identities and excluding later appends.
- Read one occurrence per pull without a suspended SQL cursor, validate encountered records,
  and refuse missing or changed terminal evidence without closing the caller-owned store.
- Verify early termination, incremental corruption refusal, read-only reopen/import and installed
  consumer types/runtime while preserving existing synchronous reads and web-safe read types.

### Impact

Node consumers can process a fixed trace prefix without materializing the whole owner path.
Integrity is incremental; graph closure, redaction, live observation and SQL snapshot isolation
are not added. Protocol, store schema and dependencies are unchanged.

## [1.67.0] - 2026-09-08

### New Feature

- Add the type-only `/read` entry for existing readonly semantic records, owner occurrences,
  cuts, slices, and anchors without store handles, mutation requests, or runtime values.
- Verify installed declarations with strict Bundler and NodeNext consumers without Node types,
  readonly assignment rejection, empty runtime namespace, and zero Node builtin loads.

### Impact

Browser-facing TypeScript can share trace read contracts without importing Node runtime APIs.
Existing contracts are unchanged; validation, transport, redaction, and async queries are not added.

## [1.66.0] - 2026-09-08

### New Feature

- Add schema.fromJSONSchema for existing string, null/void, and strict required-field object
  documents, returning authenticated dynamic schemas with snapshot and builder-identity guarantees.
- Reject unsupported/unsafe documents without invoking accessors and compare required property
  names individually, avoiding delimiter ambiguity in schema validation.
- Verify registry reopen, execution, dynamic unknown typing, and installed schema adaptation.

### Impact

Configuration-owned schema documents can compose with task and effect APIs without widening the
protocol language or claiming unchecked static types. Equivalent builder identities remain stable.

## [1.65.0] - 2026-09-08

### New Feature

- Add createTypedEffectHandler and its options type to root/effects entries, inferring callback
  payloads from authenticated package schemas and rejecting malformed payloads before invocation.
- Preserve immutable canonical intent/result data, exact-kind checks, callback errors, and stack
  correlation, including direct handler calls. Validate construction without invoking accessors.
- Demonstrate the helper in the installed custom-effect example with unchanged expected results.

### Impact

Typed effect callbacks can share one runtime schema and inferred payload type without repeating
validation logic. The adapter is in-process and non-durable; protocol contracts are unchanged.

## [1.64.3] - 2026-09-06

### Improvement

- Verify narrow and root installed imports with pinned Rollup WASM and the official Node resolver,
  comparing unoptimized/optimized output and checking retained modules and unused exports.
- Execute optimized Node ESM bundles with copied runtime configuration assets, and verify that
  missing or malformed assets fail before successful execution resumes after restoration.
- Document the tested layout, preserved initialization, known root warnings, and limits of the
  bundle evidence. Added dependencies are development-only with no build-script allowlist changes.

### Impact

Consumers have reproducible evidence for the documented Node bundle fixtures without assuming
browser support, universal tree-shaking, or self-contained single-file output.

## [1.64.2] - 2026-09-06

### Improvement

- Verify every supported installed ESM entry in a fresh process against configuration-owned
  required and forbidden Node builtin dependencies, with exact export-map coverage.
- Document which entries load filesystem configuration, SQLite, and process-execution support,
  separating import isolation from future bundler, browser, and optional-adapter claims.

### Impact

Consumers can choose entry points using measured import behavior. Runtime exports and execution
semantics are unchanged; bundler tree-shaking remains separately tracked.

## [1.64.1] - 2026-09-06

### Improvement

- Publish a Python-to-TypeScript migration guide grounded in the pinned upstream v0.3.0 examples
  and concept sources, mapping tasks, providers, retained outputs, bindings, effects, and settlements.
- Classify equivalent goals, required adaptations, and unsupported facilities explicitly, including
  release versus selection, separate binding captures, and non-durable handler dispatch.
- Verify every guide TypeScript excerpt against an installed example that is typechecked and
  executed by package conformance. Preserve the existing example result assertions.

### Impact

Consumers can migrate supported workflows using tested examples without assuming Python storage
compatibility, live-provider availability, or broader runtime/formal guarantees.

## [1.64.0] - 2026-09-06

### New Feature

- Ship a configured TypeScript custom-effect example demonstrating exact-kind handler precedence,
  typed payload validation, correlated success/failure outcomes, and stable unhandled-effect errors.
- Verify manual outcome construction and rejection of an outcome paired with a changed intent
  through the installed package; document in-process, non-durable authority and recovery limits.

### Impact

Consumers can adapt a tested custom-effect dispatch example without private imports or live
providers. Runtime contracts and existing examples remain unchanged.

## [1.63.0] - 2026-09-06

### New Feature

- Ship a configured TypeScript multiple-binding example with independent sequential captures,
  exact per-output selection, sibling-file preservation, and reopened settlement evidence.
- Add independent installed-package transcript and final-file expectations through the existing
  manifest-driven verifier, and document per-binding approval and partial-completion semantics.

### Impact

Consumers can compose separate retained workflows across disjoint bindings without implying
simultaneous multi-world execution or atomic settlement across bindings. Existing runtime
contracts and examples remain unchanged.

## [1.62.0] - 2026-09-06

### New Feature

- Ship a TypeScript read-only retained-output review example with configurable selectors,
  pagination, bounded text previews, and before/after trace archive verification.
- Extend installed-example conformance to typecheck and run review twice after setup, asserting
  independent expected results and unchanged workspace/control-file bytes and directory membership.
- Document read authority, setup prerequisites, selected-output semantics, and inspection limits.

### Impact

Consumers can review existing retained output without adding capture or settlement evidence.
Runtime interfaces and the original retained-coding and quickstart behavior remain unchanged.

## [1.61.4] - 2026-09-06

### Defect Fixes

- Replace unavailable GitHub Dependency Review with a frozen-lockfile audit covering production
  and development dependencies, failing on high/critical advisories and service errors.
- Pin Ajv's transitive fast-uri dependency to patched 3.1.6 to address five high-severity advisories.

### Impact

Dependency vulnerability checks run without repository security-plan features. Lifecycle scripts
remain disabled in the audit job; license policies and base-branch dependency comparisons remain
manual review responsibilities. Runtime interfaces are unchanged.

## [1.61.3] - 2026-09-06

### Defect Fixes

- Grant CodeQL read access to workflow metadata required by its analysis action.

### Impact

CodeQL can read its workflow run without adding write authority or bypassing security checks.

## [1.61.2] - 2026-09-06

### Defect Fixes

- Normalize compiler output paths before checking repository containment on Windows, preserving
  rejection of unsafe cleanup destinations. Correct the build-output test's file-URL conversion.

### Impact

Windows builds accept the compiler's slash-normalized output directory while retaining the
existing containment and symlink checks.

## [1.61.1] - 2026-09-06

### Defect Fixes

- Preserve LF line endings for Markdown and JavaScript module fixtures so Windows checkouts
  match deterministic generated references and packaged quickstart bytes.
- Align the CodeQL analyze action with the existing init/autobuild revision to avoid incompatible
  action configuration during analysis.

### Impact

Cross-platform verification can compare the same artifact bytes, and CodeQL steps use a consistent
version. Dependency Review still requires repository security features; no check is bypassed.

## [1.61.0] - 2026-09-04

### New Feature

- Added a shipped TypeScript retained-coding example using supported domain facades and an offline,
  configuration-owned scenario: isolated capture, retained inspection, exact selection, and
  read-only reopened settlement evidence.
- Added manifest-driven fresh-install example typechecking and execution, independent transcript
  and file expectations, and existing-directory refusal to the ordinary packaged conformance gate.
- Documented source-checkout and installed-tarball usage, explicit approval points, retained-state
  handling, and advisory/offline limits. Created Phase 5 child issues #98–#102 with blocking links.

### Impact

TypeScript consumers can run and adapt a verified retained source-edit workflow without credentials
or private imports. Runtime contracts, protocol bytes, public exports, source maps, and the original
offline quickstart remain unchanged.

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
