# Project Structure

The repository is organized around a small public runtime, shared protocol configuration, tests,
implementation documentation, and forward-looking plans.

```text
.
├── src/                    Public TypeScript runtime
│   ├── index.ts            Package export boundary
│   ├── append/             Append drafts, validation, and pure planning
│   ├── blob/               Binary identity and crash-safe filesystem objects
│   ├── canonical/          Deterministic semantic encoding, hashing, and snapshots
│   ├── effect/             Intent/outcome records and ordered exact-kind handlers
│   ├── formal/             Typed-effect reference validation and proof-envelope classification
│   ├── interchange/        Native archive encoding, validation, and import storage
│   ├── projection/         Disposable execution, relation, and history folds
│   ├── provider/           Provider-neutral contracts and deterministic offline invocation
│   ├── protocol/           Runtime configuration and generated literals
│   ├── record/             Record types, envelopes, guards, and snapshots
│   ├── run/                Outcomes, artifacts, usage, budgets, and cancellation
│   ├── store/              SQLite migrations, transactions, codecs, and reads
│   ├── task/               Descriptors, runtime schemas, locks, and durable registration
│   └── workspace/          Initialization, bindings, and reference retained-world custody
├── test/                   Public-seam unit tests and fixture assets
├── spec/                   Language-neutral JSON Schema contracts
├── scripts/                Build and release utilities
├── .github/                CI, security automation, and contribution templates
├── docs/                   Implemented contracts and contributor guidance
├── .plan/                  Research, roadmap, decisions, and progress tracker
├── project.config.json     CLI ecosystem identity
├── protocol.config.json    Language-neutral protocol constants
├── CONTEXT.md              Trace-kernel domain vocabulary
├── upstream.lock.json      Pinned upstream development and release revisions
└── release-config.yaml     Repository version source
```

## Dependency direction

```text
public exports → append area → record area → canonical area → protocol configuration
public exports → store area → append and record areas
public exports → store area → blob filesystem and identity
public exports → interchange area → store, record, blob, and protocol areas
public exports → projection area → immutable store slice types
public exports → provider area → canonical snapshots and protocol configuration
public exports → task area → canonical identity and protocol configuration
public exports → effect area → canonical snapshots and protocol configuration
public exports → formal area → canonical encoding and protocol configuration
public exports → run area → task, provider, store, canonical snapshots, and protocol configuration
public exports → workspace area → filesystem, Git, hashing, and protocol configuration
build/release scripts → repository configuration
tests → public exports
```

Runtime modules must not import build scripts or planning documents. Public behavior tests use
`src/index.ts` so they exercise the same seam as consumers. Narrow migration-registry invariant
tests may import the internal migration validator directly because malformed compiled registries
cannot be constructed through a public runtime seam. Narrow persisted-codec tests may likewise
import internal decoders for malformed control and terminal values that public builders reject;
observable recovery behavior remains tested through `src/index.ts`.

The runtime areas are intentionally shallow:

- `append/` owns draft wire-shape validation, parent resolution, and ordinal planning;
- `blob/` owns configured binary identity, content-addressed filesystem durability, and safe
  orphan discovery/deletion;
- `canonical/` owns language-neutral semantic encoding, unversioned record hashing, and immutable
  semantic snapshots;
- `interchange/` owns native archive encoding, decoding, staging, and validated storage transfer;
- `effect/` owns versioned intent/outcome construction, exact correlation, validation, and
  immutable ordered handler dispatch;
- `formal/` owns the executable typed-effect trace lifecycle machine and conservative
  proof-envelope classification;
- `protocol/` owns typed configuration models, fail-closed validation, immutable runtime
  snapshots, and generated literal values;
- `projection/` owns pure disposable execution, relation, and effective-history folds;
- `provider/` owns provider-neutral descriptors, structured invocation values, exact deterministic
  cassettes, typed failures, and closed validation;
- `record/` owns versioned envelopes, record validation, guards, and immutable body snapshots.
- `run/` owns transient and durable task orchestration, versioned terminal outcomes, ordered
  artifact and aggregate usage construction, cooperative budget/cancellation control, closed
  validation, exact task-lock citations, the configured normative lifecycle transition matrix,
  durable lifecycle evidence, terminal cuts, restart
  recovery classification and reconstruction, durable blob-receipt references, and disposable
  cut-bounded durable execution inspection views plus idempotent command-bound recovery, pause,
  resume, suspension, and safe-boundary cancellation;
- `store/` owns SQLite lifecycle, schema migration, append transactions, durable receipts,
  retained reads, immutable cuts, graph-shaped slices, blob metadata, integrity scans, and append
  recovery and orphan-collection diagnostics.
- `task/` owns bodyless descriptor construction, inferred runtime schemas, validation snapshots,
  canonical task artifacts, exact artifact locks, and the independently migrated SQLite task
  registry.
- `workspace/` owns protected initialization, baseline-adoption identity, Git-history preservation,
  fail-closed control-manifest validation, canonical disjoint binding authority, and reference
  copy-carrier including parent-linked custody capture, Git-aware retained-output custody, and pure
  content-addressed world changesets, authenticated bounded changeset inspection and Git-aware
  projections, opaque retained-world runner registrations, and fenced task-world capture with
  durable journal inspection and command-authorized recovery.

## Module rules

- `src/index.ts` is the only public export boundary.
- Each module owns one cohesive protocol responsibility.
- Split a module when configuration, persistence, transport, or another independent responsibility
  would otherwise be mixed into its domain logic.
- Static protocol values belong in configuration and are loaded through typed adapters.
- Critical configuration must be validated before side effects; fixed schema identifiers belong
  in versioned constants rather than mutable deployment configuration.
- Public types and functions require JSDoc with behavior, parameters, results, and failure modes.
- Unit tests and their assets live under `test/` and describe externally observable behavior
  through `src/index.ts`.
- Pure planning modules do not perform storage I/O; adapters commit their outputs atomically.

## Documentation ownership

| Location | Purpose |
| --- | --- |
| `README.md` | Entry point, installation, current capability, and navigation |
| `docs/` | Implemented behavior and repository structure |
| `spec/` | Language-neutral, versioned wire schemas |
| `test/` | Unit tests and implementation-neutral conformance fixtures |
| `CONTEXT.md` | Canonical trace-kernel domain terms |
| `.plan/` | Research, architecture proposals, roadmap, risks, and tracking |
| `CHANGELOG.md` | Versioned user-visible changes |

When a planned capability becomes implemented, update its contract in `docs/`, link it from the
documentation index, and advance `.plan/tracker.md`.
