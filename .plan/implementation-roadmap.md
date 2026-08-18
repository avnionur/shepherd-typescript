# Implementation Roadmap

This roadmap is capability-gated rather than date-driven. Each phase ends with observable
TypeScript behavior and conformance evidence. Language-neutral contracts remain stable protocol
boundaries, not commitments to a second implementation.

## Phase 0 — Baseline, identity, and repository foundation

Goal: make the target and compatibility policy unambiguous.

Work:

- pin an exact upstream commit and archive its license, version, CLI help, and
  behavioral fixtures;
- record `shepherd-ai==0.3.0` as the first installed behavior oracle;
- decide project/package/CLI names and upstream compatibility namespace;
- choose the Node and TypeScript support windows;
- create monorepo layout, package manager, build orchestration, linting,
  formatting, type checks, changelog, and CI;
- add `LICENSE`, upstream attribution, security policy, contribution guide, and
  architectural decision record template;
- define compatibility levels L0–L4 in product documentation;
- prohibit importing unstable upstream `main` behavior without a protocol
  version and fixture.

Exit criteria:

- clean bootstrap on macOS and Linux;
- one command runs format, lint, typecheck, unit, and conformance placeholders;
- upstream baseline and licensing are reproducible;
- naming and publish scope are approved;
- no public “full parity” claim exists without a matrix.

## Phase 1 — Canonical specification and trace kernel

Goal: produce deterministic, durable records in TypeScript.

Work:

- define record body vocabulary, envelope, owners, cuts, slices, paths,
  receipts, operations, and errors;
- freeze canonical JSON and digest rules;
- build shared golden vectors;
- implement the SQLite schema and migrations in TypeScript;
- implement atomic append batches;
- implement append-intent idempotency and conflict detection;
- implement owner-local ordinals and parent validation;
- implement blob store and integrity verification;
- implement exact ID and cut/slice reads;
- implement execution-history projections;
- add crash/fault injection around every durability boundary.

Exit criteria:

- TypeScript produces the expected IDs for all golden vectors;
- TypeScript exports, imports, and verifies versioned trace data without changing identity;
- atomicity and idempotency property suites pass;
- a killed process cannot leave a falsely committed record;
- store verification can diagnose intentional corruption.

## Phase 2 — Tasks, effects, outcomes, and offline execution

Goal: run deterministic tasks as durable executions.

Work:

- implement runtime task descriptors and ergonomic TypeScript builders;
- implement input/output schemas and artifact locks;
- implement task registry, version registration, and resolution;
- implement effect intent/outcome records and correlation;
- implement ordered handlers;
- implement run outcomes: success, failure, exhaustion, cancellation;
- implement artifacts and usage, including executor collection, durable blob verification, and
  exact restart reconstruction;
- implement budgets and `AbortSignal` cancellation semantics;
- implement deterministic static provider;
- implement offline task execution without workspace access;
- generate cut-bounded trace inspection views from canonical durable execution evidence;
- define the run control-plane contract: a first-writer invocation claim, worker lease/fencing,
  globally idempotent recovery and pause-command identities, exact running-head/fence comparison,
  and command-bound recovery after a lost worker;
- define the one normative run lifecycle and its projections; `waiting` and `suspended` are
  non-terminal control states, while recovery is an orthogonal evidence classification whose
  commands complete already-defined transitions rather than forming a competing lifecycle; follow
  the proposed contract in
  [`normative-run-lifecycle.md`](./normative-run-lifecycle.md), including safe-boundary,
  continuation-evidence, and versioned-projection gates;
- define the evidence-authority map: trace records prove runtime decisions, world carriers prove
  managed-world state, and provider/external effects require independently verifiable receipts;
- implement ordered checkpoint constituent adapters and atomic command-bound suspension
  acknowledgement with worker lease release and stale-terminal fencing;
- implement globally idempotent exact-suspension resume with unavailable-evidence rejection,
  atomic monotonic fence acquisition, and command-bound running acknowledgement;
- preserve control-plane behavior through public-seam lost-receipt, stale-worker,
  missing-continuation-receipt, and competing cross-connection race fixtures;
- implement globally idempotent direct cancellation from exact created, waiting, and suspended
  heads with atomic inactive-worker proof, terminal publication, and stale-writer fencing;
- implement prerequisite-driven runtime waiting acknowledgement and guarded resume with
  independently verified prerequisite-satisfaction evidence; **implemented in 1.8.0**;
- implement the Appendix B typed-effect reference machine and proof-envelope classifier;
  **implemented in 1.9.0**;
- validate configured profile, strength, lowering, sidecar, and pinned theorem-artifact metadata;
  **implemented in 1.10.0**, with Core-0H activation fail-closed until a published sidecar is
  explicitly trusted;
- keep unsupported, incomplete, live, and extension traces at an honest non-proof claim level;
  **implemented in 1.10.0**.

Exit criteria:

- repeated execution of the same deterministic task fixture produces equivalent TypeScript traces;
- instruction or schema changes alter the Phase 2 task identity; runtime grant identity is a
  Phase 4 exit criterion because Phase 2 descriptors grant no authority;
- malformed task/model outputs fail as structured outcomes;
- cancellation and budget exhaustion preserve a valid partial trace;
- concurrent callers cannot both cross any implemented durable external boundary for one run
  identity; Phase 2 proves the provider boundary, while durable effect execution follows its own
  later integration slice;
- every control command can be retried or recovered without inventing a transition, and a lost
  worker cannot retain authority after its lease is fenced;
- observer-free deterministic runs are byte-for-byte reproducible.
- proof-envelope classification matches reference vectors and fails closed on missing or stale
  evidence without implying that the production runtime is formally verified.

Exit audit: **complete in 1.10.1**; see
[`phase-2-exit-audit.md`](./phase-2-exit-audit.md).

## Phase 3 — Workspaces, retained outputs, and basic settlement

Goal: deliver the first useful settlement loop.

Work:

- implement workspace initialization and adoption identity; **implemented in 1.11.0**, with
  retained file custody explicitly deferred to the reference copy carrier;
- implement canonical binding roots and overlap rejection; **implemented in 1.12.0**, with runtime
  grants and GitRepo typing deferred to Phase 4 and carrier custody/revalidation deferred to Task 3;
- implement reference copy carrier; **implemented in 1.13.0**, with immutable verified snapshots,
  isolated mutable custody, restart reopen, and carrier-level discard;
- implement the core Git-aware baseline and retained output custody slice; **implemented in 1.14.0**, with exact
  HEAD/index/sparse/ignore evidence, independently retained Git objects, isolated copy custody,
  restart reopen, and basis-movement classification; changeset and settlement operations remain
  later Phase 3 tasks;
- implement the canonical copy-world changeset model core; **implemented in 1.15.0**, with
  carrier-verified revision comparison, reconstructive path changes, configured input/output
  limits, and immutable content-addressed identity; execution capture remains Task 6;
- capture task world changes away from the user's working tree; **carrier foundation implemented
  in 1.16.0**, with deterministic parent-linked custody promotion, restart reopen, and Task 5
  changeset composition; **runner registration implemented in 1.17.0**, with a closed opaque
  handle, private callback registry, and honest advisory enforcement; **successful-path fenced
  execution implemented in 1.18.0**, with authenticated handle consumption, isolated existing-file
  authority, immutable capture, and atomic terminal-cut attachment; **durable capture journaling
  and restart-safe inspection implemented in 1.19.0**; retry, cancellation, corruption recovery,
  and uncertain-writer handling **implemented for the advisory runner boundary in 1.20.0**, with
  command-authorized pre-execution resume, exact custody convergence, terminal-cut repair,
  cooperative partial-world cancellation, competing-recovery fencing, and fail-closed uncertain
  execution; external-process quiescence remains part of the later jail/placement work;
- expose read-only changeset inspection, retained content reads, bounded previews, derived
  rename/copy projections, and Gitlink citations from the Git-aware adapter; **implemented in
  1.21.0**, with authenticated carrier/Git custody, configured resource bounds, and projection-only
  move/Git semantics that preserve workspace protocol v5 identity;
- implement exact settlement identity, authenticated retained-output admission, and consume-once
  transactional compare-and-swap without exposing a mutation API that can bypass the CAS;
  **protocol and store foundation implemented in 1.22.0** and **authenticated retained-output
  preparation implemented in 1.23.0**; **Task 8 completed in 1.24.0** with restart-safe public
  inspection and cross-connection authenticated one-winner verification;
- implement public exact-ID `select` and `discard`, crash recovery, and settlement citations in the
  trace only after the shared consume-once protocol is in place; **Task 9.1 effect-journal contract
  completed in 1.24.1**, **Task 9.2A schema-v7 migration carrier implemented in 1.24.2**, and
  **Task 9.2B1 deterministic operation/receipt codecs implemented in 1.25.0**, with transactional
  transitions **implemented in 1.26.0**; **Task 9.3 public discard and cleanup recovery implemented
  in 1.27.0**; **Task 9.4A selection publication and crash-repair contract completed in 1.27.1**,
  with **Task 9.4B1 workspace-protocol-v14 publication codecs implemented in 1.28.0** and
  **Task 9.4B2A workspace-protocol-v15 dependency scheduling implemented in 1.29.0** and
  **Task 9.4B2B1 authenticated immutable-head carrier staging implemented in 1.30.0** and
  **Task 9.4B2B2A workspace-protocol-v16 scheduled step/terminal evidence implemented in
  1.31.0** and **Task 9.4B2B2B scheduled reference-carrier materialization and prefix recovery
  implemented in 1.32.0** and **Task 9.4B3 public exact-ID selection, two-basis-check coordination,
  and store-terminal repair implemented in 1.33.0**; **Task 9.5 cut-bounded settlement citations,
  import-safe execution projection, and interrupted-publication repair implemented in 1.34.0**;
- protect control-plane paths and complete settlement/platform fault hardening; **configured
  workspace-protocol-v18 protected-path validation implemented in 1.35.0** across copy/Git capture,
  retained inspection, selection/recovery, and discard cleanup, with remaining general platform
  and fault-conformance work assigned to the next slice;
- complete reference-carrier and Git-custody platform/fault conformance for ACLs, extended
  attributes, resource forks or alternate streams, `core.symlinks=false`, sparse-index variants,
  case-folding collisions, precise stable error taxonomy, permission/disk-full failures,
  concurrent mutation, and process interruption before Phase 3 exit or optimized-carrier parity;
  **implemented in 1.36.0** with workspace protocol v19 configured policy inspection,
  fail-closed metadata probes, deterministic carrier/Git/selection fault boundaries, honest
  receipt recovery, and a reference-suite gate for optimized carriers;

Exit criteria:

- a task can modify a retained world while the user's files remain unchanged;
- inspection shows adds, edits, deletes, modes, and symlinks accurately;
- `select` refuses after the workspace basis moves;
- concurrent settlements yield exactly one winner;
- `discard` leaves the parent and user workspace unchanged;
- TypeScript-created outputs can be reopened, inspected, and settled after process restart.

Milestone: **L1-alpha**, the minimal end-to-end Shepherd settlement experience.

Exit audit: **complete in 1.36.1**; see
[`phase-3-exit-audit.md`](./phase-3-exit-audit.md). This milestone covers the P0 retained-world
settlement loop only; the remaining documented `0.3.0` grants, placement, jail, `apply`/`release`
settlement, CLI, repair, and installed-package surface remains Phase 4.

## Phase 4 — Full documented `0.3.0` compatibility

Goal: cover the documented shipped surface.

Work:

- add named disjoint multi-repository bindings; **implemented in 1.37.0** with workspace protocol
  v20 exact Git worktree authorities, stable per-resource identity, linked/common repository and
  nested-boundary refusal, and independent downstream Git custody;
- add explicit runtime grants and whole-run ceiling;
- implement advisory/auto placement reporting;
- implement macOS Seatbelt and Linux Landlock jail launchers;
- make explicit jail fail closed;
- add `apply` with path-disjoint three-way semantics;
- add `release` custody transition;
- implement task/run ledgers and selectors;
- implement output citations, trace revisions, and recovery records;
- implement repair for orphaned operations;
- implement CLI groups: `init`, `doctor`, `run`, `task`, `demo`, `package`;
- provide stable JSON output and generated command reference;
- reproduce the upstream offline quickstart as a compatibility fixture.

Exit criteria:

- all documented `0.3.0` rows in the parity matrix pass;
- changing the explicit runtime grant surface changes task identity;
- jail escape/denial tests pass in platform CI;
- `auto` fallback is visible and `jail` never degrades;
- read selectors and exact settlement identity rules match the contract;
- interrupted settlements recover idempotently;
- installed-package tests pass, not only source-tree tests.

Milestone: **L1 stable**.

## Phase 5 — Native TypeScript product surface

Goal: make the TypeScript experience idiomatic without weakening parity.

Work:

- finalize TypeScript facade and subpath exports;
- generate ESM-first packages with declared CommonJS policy;
- add explicit task builder, schema adapters, typed provider/tool helpers;
- implement async-iterable trace queries and web-safe read-only types where
  sensible;
- expose rich structured errors with stable codes;
- add source maps and stack/cause preservation;
- publish API Extractor or TypeDoc reference;
- build TypeScript-first examples for retained coding work, read-only review,
  multiple bindings, and custom effects;
- add migration guide from upstream Python examples to TypeScript;
- verify tree-shaking and optional native dependency loading.

Exit criteria:

- a new TypeScript user completes the offline settlement loop from docs;
- public API reports no unexpected types;
- optional provider/platform packages do not load when unused;
- ESM/CJS/runtime support matches the published matrix;
- TypeScript examples are tested in packaged form.

## Phase 6 — Scope algebra and versioned-world substrate

Goal: provide first-class isolated branches independent of high-level
settlement.

Work:

- implement scope owner/child records;
- implement `emit`, `fork`, `merge`, and `discard`;
- implement `spawn`, `adopt`, `abandon`, and `publish` vocabulary mapping;
- define nested-scope authority attenuation;
- add clonefile and Linux overlay carriers;
- add scope-local writer exclusivity;
- add parallel and nested scope scheduling;
- implement child recovery and orphan detection;
- define branch checkpoints as a coupled descriptor of trace cut, world receipt, and any
  provider/process checkpoint; no descriptor may imply state that it cannot restore or verify;
- prove algebraic/reference-model laws against the copy carrier;
- benchmark storage scaling by changed suffix.

Exit criteria:

- unmerged siblings are isolated;
- merge/discard results match the reference carrier;
- nested discard leaves ancestors unchanged;
- crash recovery has no ambiguous ownership;
- a branch can prove whether it started from an atomic checkpoint or a reconstructed state;
- performance carriers pass the same correctness suite as copy;
- branch storage scales with changed data for supported optimized carriers.

Milestone: **L2 substrate parity**.

## Phase 7 — Live observation and interception

Goal: safely supervise running executions.

Work:

- implement durable cursor-based live subscriptions;
- define subscription cursor, replay, overflow, and acknowledgement semantics as projections over
  the content-addressed record graph; timestamps and delivery order are never semantic identity;
- separate observer and interceptor roles;
- implement bounded queues and backpressure;
- implement interception decisions: allow, deny, replace, pause;
- define deterministic interceptor ordering and timeout behavior;
- add human approval gates;
- implement context injection with trace citations;
- expose worker pause/resume/cancel;
- verify that passive observation does not alter the worker trace;
- handle subscriber reconnect and supervisor crash.

Exit criteria:

- worker traces are identical with zero or passive observers;
- destructive intent can be denied before outcome/materialization;
- timeouts follow declared fail-open/fail-closed policy;
- reconnect resumes without duplication or loss;
- subscriptions neither change semantic records nor create a second authoritative event stream;
- supervisor failure cannot deadlock a worker indefinitely;
- irreversible effects respect configured approval frontiers.

## Phase 8 — Coupled checkpoints, rewind, and replay

Goal: navigate and continue historical agent/environment states honestly.

Work:

- define provider-session and process checkpoint adapter contracts;
- construct coupled checkpoint descriptors;
- record the exact trace cut, world receipt, and provider/process evidence required by every
  checkpoint, including unavailable capabilities;
- implement reconstructive replay from deterministic prefixes;
- add provider prompt/cache identity and cache-hit evidence;
- implement rewind to a trace cut;
- implement suffix replay with changed task/provider/effect handler;
- support process/container checkpoint backend where available;
- distinguish atomic checkpoint from reconstructed replay in records;
- enforce irreversible-effect rules during replay;
- add trace divergence and dependency analysis.

Exit criteria:

- restored managed filesystem is byte-equivalent to the recorded cut;
- a checkpoint is accepted only when each claimed constituent is verified, otherwise replay is
  classified as reconstructive or unavailable;
- provider/context prefix identity is verified, not assumed;
- only the intended suffix diverges in deterministic tests;
- replay never re-materializes an irreversible effect without policy approval;
- unsupported process checkpointing is reported accurately;
- replay of imported, version-compatible fixtures works.

## Phase 9 — Task-as-value meta-agents

Goal: implement the paper's higher-order programming model.

Work:

- allow validated task descriptors as inputs and outputs;
- add durable child run handles;
- implement authority-preserving task delegation;
- implement supervisor operations: observe, inject, handoff, discard/retry;
- permit controlled task revision and synthesized helper tasks;
- add provenance and approval for model-generated task definitions;
- implement retained result threading and typed projection;
- support nested meta-agents without scope contamination.

Exit criteria:

- a supervisor can accept a worker task as data, run it in a child, inspect its
  trace, and merge or discard;
- child authority never exceeds delegated authority;
- revised task identity and causal replay point are explicit;
- meta-meta-agent nesting passes isolation tests;
- dynamic task code cannot bypass the execution boundary.

Milestone: **L3 paper programming-model parity**.

## Phase 10 — Research applications

Goal: demonstrate that the substrate supports the paper's three use cases.

Work:

- build a small two-worker coding supervisor;
- implement inject, handoff, and discard/restart policies;
- build a counterfactual optimization example that edits a workflow and replays
  only affected suffixes;
- build the Appendix D trajectory-compression workflow with fork-point/hint output, suffix
  restoration, no-prune handling, verifier gating, and a bounded best-of-N control;
- build a Tree-RL adapter over synthetic and small reproducible rollouts;
- version the Appendix E supervision and Appendix F CRO prompts, schemas, tools, handoff records,
  dataset selections, budgets, costs, and seeds;
- record evaluation inputs, versions, costs, and seeds;
- compare to simple baselines;
- publish limitations and avoid claiming reproduction of upstream headline
  results without equivalent experiments.

Exit criteria:

- each use case is reproducible offline or with clearly gated provider access;
- the runtime-supervision, CRO, trajectory-compression, and Tree-RL applications expose their
  protocol and artifact manifests;
- causal fork/replay behavior is visible in exported traces;
- evaluations have stable scripts and artifact manifests;
- performance and quality claims are scoped to measured results.

## Phase 11 — Production hardening and 1.0

Goal: reach L4 operational maturity.

Work:

- threat model and external security review;
- fuzz canonical decoders, CLI inputs, changesets, and helper protocols;
- harden secret handling and export redaction;
- define retention, redaction, and export policy for context, provider citations, checkpoints,
  and any future memory adapters before treating them as durable runtime inputs;
- add remote storage/concurrency only behind stable interfaces;
- test large traces, compaction indexes, and garbage collection;
- define backup, restore, migration, and downgrade policy;
- add OpenTelemetry-compatible observability without making logs canonical;
- add SBOM, provenance, signed artifacts, and reproducible builds;
- establish deprecation and protocol evolution policy;
- run long-duration, kill/restart, disk-full, and filesystem-corruption tests;
- document support and incident processes.

Exit criteria:

- zero unresolved critical security findings;
- migration and recovery drills pass on supported versions;
- public protocol and API compatibility policies are enforced in CI;
- performance SLOs are supported by reproducible benchmarks;
- stable packages and CLI ship with complete docs and signed provenance.

## Dependency summary

```text
Phase 0
  → Phase 1
    → Phase 2
      → Phase 3
        → Phase 4 → Phase 5
        → Phase 6
          → Phase 7
            → Phase 8
              → Phase 9
                → Phase 10
All stable capabilities → Phase 11
```

## Work-item rule

Every implementation issue should state:

- compatibility level and parity-matrix row;
- normative schema/state transition;
- TypeScript API and runtime impact;
- platform/provider scope;
- security/reversibility implications;
- conformance fixture to add;
- recovery behavior;
- documentation and changelog impact.
