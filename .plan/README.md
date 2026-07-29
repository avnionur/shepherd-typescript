# Shepherd TypeScript and Python Implementation Plan

Status: planning baseline

Research snapshot: 2026-07-29

Target repository state at snapshot: empty package directory

Primary upstream baseline: Shepherd `0.3.0`, plus the paper and upstream `main`

## Purpose

This directory defines a build plan for a native TypeScript implementation of
Shepherd and a compatible Python implementation, backed by one language-neutral
behavioral specification.

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

The implementation must preserve those semantics across TypeScript and Python.
Matching method names without matching invariants is not parity.

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
| L1 | Shipped parity | The documented Shepherd `0.3.0` settlement loop works in both languages |
| L2 | Substrate parity | Scopes, content-addressed traces, fork/merge/discard, and durable children work |
| L3 | Paper parity | Live observation/interception, rewind/replay, task-as-value supervision, and rewriting work |
| L4 | Operational maturity | Security enforcement, recovery, performance, compatibility, and releases meet production gates |

## Recommended product shape

Build a monorepo with one specification and two native implementations:

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
├── python/                       # native Python implementation
│   ├── packages/
│   └── tests/
├── integration/
│   ├── conformance/
│   ├── cross-language/
│   └── platform/
├── examples/
├── docs/
└── .plan/
```

TypeScript is the primary new product surface. Python is a first-class
implementation and compatibility oracle, not a TypeScript subprocess
dependency. Both implementations read the same fixtures and emit the same
canonical wire records.

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

- [Research notes](./research-notes.md) — source audit, upstream evolution, and
  facts that shape the implementation.
- [Parity matrix](./parity-matrix.md) — the feature contract across upstream
  `0.3.0`, the paper, Python, and TypeScript.
- [Target architecture](./architecture.md) — package boundaries, data model,
  state machines, interoperability, and platform strategy.
- [Implementation roadmap](./implementation-roadmap.md) — phased work,
  deliverables, dependencies, and acceptance criteria.
- [Testing and release](./testing-and-release.md) — conformance, property,
  security, recovery, performance, CI, and release gates.
- [Decisions and risks](./decisions-and-risks.md) — adopted decisions,
  unresolved decisions, licensing, and major risks.

## Non-negotiable invariants

1. **Append-only evidence:** committed trace records are immutable.
2. **Deterministic identity:** the same canonical semantic record has the same
   digest in TypeScript and Python.
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
12. **Compatibility is tested:** “Python parity” and “paper parity” are labels
    earned by executable suites.

## Definition of done

The project is complete only when:

- every row marked required in the parity matrix is implemented or explicitly
  version-fenced;
- both language implementations pass the same golden and property fixtures;
- cross-language traces can be read, verified, and continued without changing
  semantic identity;
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

Execute Phase 0 in the roadmap: pin an upstream revision, record package names,
choose the compatibility/versioning policy, scaffold the monorepo, and turn the
invariants above into language-neutral schemas and failing conformance tests
before implementing runtime behavior.
