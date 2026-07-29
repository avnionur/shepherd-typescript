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
- implement artifacts and usage;
- implement budgets and `AbortSignal` cancellation semantics;
- implement deterministic static provider;
- implement offline task execution without workspace access;
- generate trace inspection views.

Exit criteria:

- repeated execution of the same deterministic task fixture produces equivalent TypeScript traces;
- instruction, schema, or grants alter task identity;
- malformed task/model outputs fail as structured outcomes;
- cancellation and budget exhaustion preserve a valid partial trace;
- observer-free deterministic runs are byte-for-byte reproducible.

## Phase 3 — Workspaces, retained outputs, and basic settlement

Goal: deliver the first useful settlement loop.

Work:

- implement workspace initialization and adoption;
- implement canonical binding roots and overlap rejection;
- implement reference copy carrier;
- implement Git-aware baseline and retained output custody;
- implement complete changeset data model;
- capture task world changes away from the user's working tree;
- expose read-only changeset inspection;
- implement exact-ID `select` and `discard`;
- implement consume-once settlement with transactional compare-and-swap;
- protect control-plane paths;
- record settlement citations in the trace.

Exit criteria:

- a task can modify a retained world while the user's files remain unchanged;
- inspection shows adds, edits, deletes, modes, and symlinks accurately;
- `select` refuses after the workspace basis moves;
- concurrent settlements yield exactly one winner;
- `discard` leaves the parent and user workspace unchanged;
- TypeScript-created outputs can be reopened, inspected, and settled after process restart.

Milestone: **L1-alpha**, the minimal end-to-end Shepherd settlement experience.

## Phase 4 — Full documented `0.3.0` compatibility

Goal: cover the documented shipped surface.

Work:

- add named disjoint multi-repository bindings;
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
- prove algebraic/reference-model laws against the copy carrier;
- benchmark storage scaling by changed suffix.

Exit criteria:

- unmerged siblings are isolated;
- merge/discard results match the reference carrier;
- nested discard leaves ancestors unchanged;
- crash recovery has no ambiguous ownership;
- performance carriers pass the same correctness suite as copy;
- branch storage scales with changed data for supported optimized carriers.

Milestone: **L2 substrate parity**.

## Phase 7 — Live observation and interception

Goal: safely supervise running executions.

Work:

- implement durable cursor-based live subscriptions;
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
- supervisor failure cannot deadlock a worker indefinitely;
- irreversible effects respect configured approval frontiers.

## Phase 8 — Coupled checkpoints, rewind, and replay

Goal: navigate and continue historical agent/environment states honestly.

Work:

- define provider-session and process checkpoint adapter contracts;
- construct coupled checkpoint descriptors;
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
- build a Tree-RL adapter over synthetic and small reproducible rollouts;
- record evaluation inputs, versions, costs, and seeds;
- compare to simple baselines;
- publish limitations and avoid claiming reproduction of upstream headline
  results without equivalent experiments.

Exit criteria:

- each use case is reproducible offline or with clearly gated provider access;
- causal fork/replay behavior is visible in exported traces;
- evaluations have stable scripts and artifact manifests;
- performance and quality claims are scoped to measured results.

## Phase 11 — Production hardening and 1.0

Goal: reach L4 operational maturity.

Work:

- threat model and external security review;
- fuzz canonical decoders, CLI inputs, changesets, and helper protocols;
- harden secret handling and export redaction;
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
