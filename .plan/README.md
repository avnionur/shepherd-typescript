# Shepherd TypeScript Implementation Plan

Status: planning baseline

Research snapshot: 2026-07-29

Target repository state at snapshot: empty package directory

Primary upstream baseline: Shepherd `v0.3.0` at `a8196d4c453514836d06bd2fece91a03cdc37107`,
development revision `d45074e0099d9ccafeed4a233702ad68ff8a2fa6`, and paper v3

## Purpose

This directory defines a build plan for a complete native TypeScript implementation of Shepherd,
backed by a language-neutral behavioral specification. Upstream Python is an evidence source and
behavioral oracle where applicable, not a second implementation target.

Shepherd is not merely an agent loop. Its defining capability is to turn agent
execution into durable, inspectable, governed data:

- a **task** is a typed, substitutable unit of agent behavior;
- an **effect** is a typed boundary crossing with separately recorded intent and
  outcome;
- a **scope** couples an execution with its environment and supports `emit`,
  `fork`, `merge`, and `discard`;
- a **trace** is an immutable, content-addressed execution graph;
- a **retained output** holds proposed world changes until an explicit,
  consume-once settlement decision.

The TypeScript implementation must preserve those semantics at its public API and durable protocol
boundaries. Matching method names without matching invariants is not parity.

## Completion mandate

The upstream repository is incomplete and actively evolving. This project does not stop when it
matches the code currently present upstream. “Complete” means implementing and proving the full
target in explicit layers:

1. shipped `0.3.0` settlement behavior;
2. the trace, world, scope, and execution substrate represented by pinned upstream development;
3. paper-level observation, interception, replay, supervision, task rewriting, and meta-agent
   operations;
4. production-grade recovery, security enforcement, protocol interoperability, packaging, and
   release behavior.

When upstream code does not implement a target capability, the paper, formal model, documented
semantics, and project invariants define the design inputs. The capability must receive a
language-neutral contract and executable acceptance tests before TypeScript implementation.
Upstream incompleteness must be reported, not inherited as this project's completion boundary.

## The key research finding

There are three distinct Shepherd targets in the public sources:

1. **Shipped `0.3.0`** is primarily a settlement machine: tasks, effects,
   retained runs, repository grants, placements, changesets, traces, task/run
   ledgers, and consume-once settlement.
2. **The paper's programming model** adds live observation and interception,
   coupled agent/environment forks, arbitrary rewind and replay, task-as-value
   supervision, behavior rewriting, and meta-agent use cases.
3. **Upstream `main` is converging on a new substrate boundary**: `vcs-core`
   owns execution/containment/trace mechanisms, Shepherd becomes a dialect, and
   `shepherd2` freezes a small trace-kernel ABI. The upstream repository itself
   warns that parts of the current package tree predate this re-aim.

Consequently, “fully implemented” must be reached in explicit compatibility
levels, not claimed as one undifferentiated milestone.

| Level | Meaning | Exit signal |
| --- | --- | --- |
| L0 | Canonical model | Schemas, state machines, hashes, fixtures, and terminology are frozen |
| L1 | Shipped parity | The documented Shepherd `0.3.0` settlement loop works in TypeScript |
| L2 | Substrate parity | Scopes, content-addressed traces, fork/merge/discard, and durable children work |
| L3 | Paper parity | Live observation/interception, rewind/replay, task-as-value supervision, and rewriting work |
| L4 | Operational maturity | Security enforcement, recovery, performance, compatibility, and releases meet production gates |

## Recommended product shape

Build a TypeScript monorepo around one versioned specification:

```text
.
├── spec/                         # language-neutral contracts and fixtures
│   ├── schemas/
│   ├── state-machines/
│   ├── fixtures/
│   └── compatibility/
├── packages/                     # TypeScript packages
│   ├── core/
│   ├── trace/
│   ├── effects/
│   ├── tasks/
│   ├── workspace/
│   ├── runtime/
│   ├── providers/
│   ├── sandbox/
│   ├── cli/
│   ├── export/
│   └── testkit/
├── integration/
│   ├── conformance/
│   ├── upstream-oracle/
│   └── platform/
├── examples/
├── docs/
└── .plan/
```

TypeScript is the sole product implementation. The pinned upstream Python package may be invoked
only by opt-in compatibility tests as an external behavioral oracle; it is never a runtime
dependency or package produced by this repository.

## Source-of-truth policy

When sources disagree, use this order:

1. executable conformance tests pinned to an exact upstream revision;
2. installed `shepherd-ai==0.3.0` behavior;
3. versioned `0.3.0` documentation;
4. upstream source at the pinned revision;
5. paper v3 for research-level features not yet shipped;
6. blog and project site for motivation and benchmark context.

Do not silently copy future behavior into a `0.3.0` compatibility mode. Each
record and public API must declare a protocol/compatibility version.

## Planning documents

- [Upstream compatibility baseline](./upstream-baseline.md) — exact Git revisions, evidence scope,
  compatibility boundaries, and drift procedure.
- [Research notes](./research-notes.md) — source audit, upstream evolution, and
  facts that shape the implementation.
- [README site and media research](./readme-site-media-research.md) — first-party positioning,
  exact media links, benchmark attribution, and reuse constraints.
- [Parity matrix](./parity-matrix.md) — the feature contract across upstream `0.3.0`, the paper,
  and TypeScript.
- [Paper coverage map](./paper-coverage.md) — section-by-section ownership, evidence, formal-claim
  boundaries, experiments, limitations, and future-work classification for paper v3.
- [Target architecture](./architecture.md) — package boundaries, data model,
  state machines, interoperability, and platform strategy.
- [Implementation roadmap](./implementation-roadmap.md) — phased work,
  deliverables, dependencies, and acceptance criteria.
- [Phase 2 exit audit](./phase-2-exit-audit.md) — production-seam evidence, resolved phase-boundary
  mismatch, and the handoff into workspace initialization.
- [Phase 3 exit audit](./phase-3-exit-audit.md) — P0 retained-world settlement evidence,
  L1-alpha claim boundary, platform limits, and the handoff into Phase 4 compatibility.
- [Workspace initialization research](./workspace-initialization-research.md) — shipped init/adopt
  contract, pinned-source boundaries, and explicit dirty-worktree oracle gaps.
- [Workspace binding research](./workspace-binding-research.md) — shipped named/disjoint root and
  `GitRepo` evidence, canonicalization and repository-resource policy, and explicit grant/platform
  oracle gaps.
- [Repository grant research](./repository-grant-research.md) — pinned `May`/`GitRepoGrant`,
  authority attenuation and permission-plan evidence, TypeScript-owned identity, and advisory/jail
  claim boundaries.
- [Placement research](./placement-research.md) — pinned advisory/auto/jail behavior, platform
  reporting, TypeScript-owned identity, and the native-launcher claim boundary.
- [Task/run ledger research](./task-run-ledger-research.md) — pinned list/show fields, ordering,
  selector grammar, latest semantics, exact-ID authority boundary, and deliberate native
  projection differences.
- [Output/trace/recovery research](./output-trace-recovery-research.md) — pinned raw output
  citations, immutable trace heads, operation/revision references, orphan-repair boundary, and
  native cut/command mapping.
- [Orphaned operation repair research](./orphan-operation-repair-research.md) — pinned run-repair,
  liveness, operation/scope separation, idempotency, fail-soft reclaim, and TypeScript exact-basis
  mapping.
- [CLI command-group research](./cli-command-groups-research.md) — pinned run/task topology,
  selectors, human/machine separation, stable errors, generated help/reference behavior, fenced
  start, and explicit init/doctor/demo/package source gaps.
- [Packaged offline quickstart research](./offline-quickstart-research.md) — pinned installed-wheel
  hero, transcript, static-provider behavior, retained isolation, and TypeScript package mapping.
- [Phase 4 exit audit](./phase-4-exit-audit.md) — completed package-seam evidence and remaining
  documented CLI blockers before L1 stable.
- [Reference copy-carrier research](./reference-copy-carrier-research.md) — correctness-reference
  snapshot, mutable custody, verification, discard, durability, and Task 4 Git boundary.
- [Git-aware custody research](./git-aware-custody-research.md) — shipped Git baseline,
  repository/index evidence, object retention, movement, and Task 5 changeset boundary.
- [Changeset-model research](./changeset-model-research.md) — canonical reconstructive changes,
  identity, path and node semantics, limits, and the Task 6 capture boundary.
- [Task-world capture research](./task-world-capture-research.md) — isolated retained-world
  execution, custody promotion, fencing, durable publication, recovery, and Task 7 boundaries.
- [Exact-ID settlement research](./settlement-select-discard-research.md) — consume-once select and
  discard identity, basis, mutation, cleanup, and recovery contract.
- [Settlement effect-journal contract](./settlement-effect-journal-research.md) — deterministic
  operation identity, persisted receipts, schema-v7 transitions, and Task 9 implementation order.
- [Retained-world selection publication contract](./retained-world-selection-research.md) —
  journaled managed-path materialization, two basis checks, publication receipts, and crash repair.
- [Testing and release](./testing-and-release.md) — conformance, property,
  security, recovery, performance, CI, and release gates.
- [Decisions and risks](./decisions-and-risks.md) — adopted decisions,
  unresolved decisions, licensing, and major risks.

## Non-negotiable invariants

1. **Append-only evidence:** committed trace records are immutable.
2. **Deterministic identity:** the same canonical semantic record always has the same digest,
   independent of process or platform.
3. **Intent precedes outcome:** an external action cannot acquire a recorded
   outcome without a durable intent.
4. **No invisible settlement:** retained work never reaches the user's
   workspace without an explicit recorded decision.
5. **Consume once:** a retained output accepts at most one terminal settlement.
6. **Fail closed when promised:** an explicitly jailed placement never silently
   degrades to advisory enforcement.
7. **Honest enforcement:** every run records requested placement, resolved
   placement, and actual enforcement.
8. **Fork isolation:** an unmerged child cannot mutate the parent's logical
   world or trace.
9. **Discard preservation:** discarding a child leaves the parent equivalent to
   its state at the fork boundary.
10. **Replay honesty:** deterministic prefixes may be reused, but irreversible
    effects are never falsely described as rolled back.
11. **Crash recoverability:** interrupted append, materialization, and
    settlement operations can be diagnosed and repaired idempotently.
12. **Compatibility is tested:** shipped, substrate, and paper parity labels are earned by
    executable TypeScript suites and pinned oracle evidence where applicable.

## Definition of done

The project is complete only when:

- every row marked required in the parity matrix is implemented or explicitly
  version-fenced;
- every main-paper and appendix row in the paper coverage map has the required TypeScript
  implementation, evidence, or explicit future-work classification;
- the TypeScript implementation passes the golden, property, integration, and compatibility
  fixtures;
- versioned traces can be exported, imported, verified, and continued without changing semantic
  identity;
- Linux and macOS platform gates pass, and Windows behavior is accurately
  documented and tested as native, WSL, or unsupported;
- crash recovery and concurrent settlement tests pass;
- the security suite proves fail-closed jailed execution on supported hosts;
- benchmark results and limitations are published without inheriting upstream
  performance claims that have not been reproduced;
- CLI and API docs are generated from shipped code;
- packages contain attribution, security guidance, migration notes, examples,
  and reproducible release metadata.

## Immediate next step

Continue Phase 4 with the documented CLI view blockers identified after the installed quickstart.
