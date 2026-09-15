# Project Structure

The repository is organized around a small public runtime, shared protocol configuration, tests,
implementation documentation, and forward-looking plans.

```text
.
├── src/                    Public TypeScript runtime and private implementations
│   ├── index.ts            Root package entry
│   ├── append/             Append drafts, validation, and pure planning
│   ├── blob/               Binary identity and crash-safe filesystem objects
│   ├── canonical/          Deterministic semantic encoding, hashing, and snapshots
│   ├── cli/                Configured command dispatch and I/O adaptation
│   ├── effect/             Intent/outcome records and ordered exact-kind handlers
│   ├── delegation/         Task values as data, durable child run handles, and delegated authority
│   ├── errors/             Shared structured public-error classification
│   ├── facades/            Supported package subpath entries
│   ├── formal/             Typed-effect reference validation and proof-envelope classification
│   ├── interchange/        Native archive encoding, validation, and import storage
│   ├── ledger/             Bounded task/run/output/trace/recovery read projections
│   ├── projection/         Disposable execution, relation, and history folds
│   ├── provider/           Provider-neutral contracts and deterministic offline invocation
│   ├── protocol/           Runtime configuration and generated literals
│   ├── record/             Record types, envelopes, guards, and snapshots
│   ├── repair/             Orphan-operation diagnosis and repair contracts
│   ├── replay/             Replay sessions, coupled checkpoints, rewind, replay, and analysis
│   ├── run/                Outcomes, artifacts, usage, budgets, and cancellation
│   ├── scope/              Trace-only scope registration, writer fencing, emission, and inspection
│   ├── store/              SQLite migrations, transactions, codecs, and reads
│   ├── supervision/        Trace subscriptions, supervised effect dispatch, approval, and context
│   ├── task/               Descriptors, runtime schemas, locks, and durable registration
│   └── workspace/          Initialization, bindings, and reference retained-world custody
├── test/                   Public-seam unit tests and fixture assets
├── spec/                   Language-neutral JSON Schema contracts
├── scripts/                Thin executable command adapters for package scripts
├── tooling/                Tested repository-tooling implementations
│   ├── api-reference/      Emitted-declaration reference generation
│   ├── build/              Safe cleanup and runtime-configuration copying
│   ├── protocol/           Protocol artifact generation and schema renderers
│   ├── release/            Validated semantic-version synchronization
│   └── testing/            Test-runner and installed-package conformance modules
├── .github/                CI, security automation, and contribution templates
├── docs/                   Implemented contracts and contributor guidance
├── .plan/                  Research, roadmap, decisions, and progress tracker
├── config/                 Repository test-runner, entry-loading, bundle, and runtime-boundary policy
├── project.config.json     CLI ecosystem identity
├── api-reference.config.json Generated API-reference ownership and leakage policy
├── examples/               Installed examples, scenario configuration, and conformance manifest
├── protocol.config.json    Language-neutral protocol constants
├── CONTEXT.md              Trace-kernel domain vocabulary
├── upstream.lock.json      Pinned upstream development and release revisions
├── release-config.yaml     Repository version source
├── pnpm-workspace.yaml     Single-package workspace and build-script policy
├── tsconfig.json           Runtime, tooling, command, and test typechecking
└── tsconfig.build.json     Runtime-only production compilation
```

## Dependency direction

```text
package exports → root entry and subpath facades → owned runtime areas
public exports → append area → record area → canonical area → protocol configuration
public exports → store area → append and record areas
public exports → store area → blob filesystem and identity
public exports → interchange area → store, record, blob, and protocol areas
public exports → ledger area → task registry, cuts/slices, run control, workspace evidence, and protocol areas
public exports → projection area → immutable store slice types
public exports → provider area → canonical snapshots and protocol configuration
public exports → task area → canonical identity and protocol configuration
public exports → effect area → canonical snapshots and protocol configuration
public exports → formal area → canonical encoding and protocol configuration
public exports → run area → task, provider, store, canonical snapshots, and protocol configuration
public exports → scope area → store, record, canonical snapshots, and protocol configuration
store area → scope record codecs and errors, and run control codecs, for transactional admission
public exports → supervision area → effect records, store, scope validation helpers, and protocol configuration
store area → supervision record codecs and errors for subscription and dispatch bookkeeping
public exports → delegation area → task values, durable execution, scope authority, store, scope validation helpers, and protocol configuration
store area → delegation errors for handle command transactions
public exports → replay area → effect records, provider validation, task descriptors, store, scope validation helpers, reference copy carrier world-image helpers, and protocol configuration
store area → replay errors for session lease bookkeeping
public exports → workspace area → filesystem, Git, hashing, and protocol configuration
workspace area → scope commands, codecs, and inspection, and store transactions, for scope forks
script command adapters → tooling module interfaces
build/release tooling → repository configuration
protocol tooling → protocol configuration, validators, schemas, and generated runtime literals
API-reference tooling → emitted public declarations and package/config metadata
tests → public runtime exports, owned tooling module interfaces, or explicit internal contract seams
```

Runtime modules must not import `scripts/`, `tooling/`, or planning documents. Public behavior
tests prefer the supported root or facade entry so they exercise the same seam as consumers.
Focused contract tests may import an owned private runtime module when they must construct
malformed, versioned, platform-specific, migration, protocol, or persisted-codec states that a
public builder intentionally rejects; observable behavior remains tested through supported public
entries.

The runtime areas are organized around cohesive protocol responsibilities:

- `append/` owns draft wire-shape validation, parent resolution, and ordinal planning;
- `blob/` owns configured binary identity, content-addressed filesystem durability, and safe
  orphan discovery/deletion;
- `canonical/` owns language-neutral semantic encoding, unversioned record hashing, and immutable
  semantic snapshots;
- `cli/` owns configured bounded human command dispatch, process/I/O adaptation, help, exit
  classification, and delegation to existing public APIs without adding mutation authority;
- `interchange/` owns native archive encoding, decoding, staging, and validated storage transfer;
- `ledger/` owns bounded immutable task/run/output/trace/recovery projections, canonical read
  ordering, cut/lifecycle evidence bounds, and exact/unique-prefix/latest selectors without
  mutation authority;
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
- `repair/` owns public orphan-operation bookkeeping, diagnosis, command, receipt, pre-run result,
  and typed-error contracts without runtime mutation authority.
- `run/` owns transient and durable task orchestration, versioned terminal outcomes, ordered
  artifact and aggregate usage construction, cooperative budget/cancellation control, closed
  validation, exact task-lock citations, the configured normative lifecycle transition matrix,
  durable lifecycle evidence, terminal cuts, restart
  recovery classification and reconstruction, durable blob-receipt references, and disposable
  cut-bounded durable execution inspection views plus idempotent command-bound recovery, pause,
  resume, suspension, and safe-boundary cancellation;
- `scope/` owns content-addressed scope identity, per-resource authority attenuation, closed
  scope record codecs, package-authenticated writer handles, globally idempotent root/child
  registration and emission commands, atomic multi-scope claims, fork journal and checkpoint codecs,
  and record-derived inspection and replay without world, provider, or settlement authority;
- `delegation/` owns command-derived child run handles on reserved owner paths, task values with
  declared provenance, non-amplifying resource and budget authority derived from a root declaration
  or the parent handle, provider- and program-serviced child execution under the child's durable
  claim, completion records, record-derived inspection, and typed result and tree projections,
  without provider, filesystem, or workspace authority;
- `replay/` owns deterministic session programs and their fenced step journals, runtime-derived
  prompt, prefix, and context prefix identities, coupled checkpoints with trace-store world and
  process images, verified rewind and recorded-prefix replay, irreversible-effect replay policy,
  record-derived inspection, divergence and dependency analysis, and the cooperative and transparent
  process checkpoint adapters, without workspace binding, custody, or settlement authority;
- `supervision/` owns canonical subscription cursors and pull-driven delivery, supervised effect
  dispatch with ordered interceptors, timeout policy, approval gates, fenced decision leases,
  admission-before-materialization, record-derived dispatch inspection and recovery
  classification, approval verdicts, and cited context channels, without provider, filesystem, or
  workspace authority;
- `store/` owns SQLite lifecycle, schema migration, append transactions, durable receipts,
  retained reads, immutable cuts, graph-shaped slices, blob metadata, integrity scans, and append
  recovery, orphan-collection diagnostics, and exact bookkeeping-only orphan-operation repair.
- `task/` owns bodyless descriptor construction, inferred runtime schemas, validation snapshots,
  canonical task artifacts, exact artifact locks, and the independently migrated SQLite task
  registry.
- `workspace/` owns protected initialization, baseline-adoption identity, Git-history preservation,
  fail-closed control-manifest validation, canonical disjoint binding authority, and reference
  copy-carrier including parent-linked custody capture, Git-aware retained-output custody, and pure
  content-addressed world changesets, authenticated bounded changeset inspection and Git-aware
  projections, opaque retained-world runner registrations, and fenced task-world capture with
  durable journal inspection and command-authorized recovery, authenticated Seatbelt/Landlock
  probes, structured native runners, confinement plans, process receipts and no-retry uncertain
  recovery, plus authenticated exact-output
  settlement preparation, restart-safe settlement inspection, and closed selection-publication
  plan, ordered path-step, and terminal carrier-receipt codecs, portable application-conflict
  inspection, exact three-way plans, protected merged revisions, path-disjoint apply recovery, and
  receipt-only release with preserved custody and terminal inspection, and reference-copy scope
  forks that retain a prepared journal before verified custody and complete with a checkpoint.

## Tooling ownership

Files under `scripts/` parse command-line input and invoke one tooling module interface. They do not
own generation, build, release, or conformance behavior. Reusable repository-only implementations
live under `tooling/`, and focused tests import those modules directly.

The ordinary typecheck covers `src/`, `scripts/`, `tooling/`, and `test/`. The production build has
an explicit runtime-only include and preserves package targets under `dist/src/`; it must not emit
`dist/scripts/` or `dist/tooling/`. Generated protocol artifacts remain checked in under
`src/protocol/`, `spec/schemas/`, `docs/generated/`, and `examples/` according to configuration.

Standalone TypeScript examples are checked against a freshly installed package by
`tooling/testing/packaged-examples.ts`, using the manifest named in `package.json.exampleManifest`.
They are deliberately not compiled with the runtime or resolved against private source modules.

## Module rules

- `package.json` is the public export map: `src/index.ts` owns the root entry and `src/facades/`
  owns the supported subpath entries.
- Each module owns one cohesive protocol responsibility.
- Split a module when configuration, persistence, transport, or another independent responsibility
  would otherwise be mixed into its domain logic.
- Static protocol values belong in configuration and are loaded through typed adapters.
- Critical configuration must be validated before side effects; fixed schema identifiers belong
  in versioned constants rather than mutable deployment configuration.
- Public types and functions require JSDoc with behavior, parameters, results, and failure modes.
- Unit tests and their assets live under `test/` and describe externally observable behavior
  through a supported package entry; tooling tests use the owned tooling module interface.
- Pure planning modules do not perform storage I/O; adapters commit their outputs atomically.
- Repository command adapters remain thin; reusable tooling behavior and tests meet at an owned
  interface under `tooling/`.

## Documentation ownership

| Location | Purpose |
| --- | --- |
| `README.md` | Entry point, installation, current capability, and navigation |
| `docs/` | Implemented behavior and repository structure |
| `spec/` | Language-neutral, versioned wire schemas |
| `test/` | Unit tests and implementation-neutral conformance fixtures |
| `scripts/` | Thin executable adapters invoked by package scripts |
| `tooling/` | Repository-only build, generation, release, and test implementations |
| `CONTEXT.md` | Canonical trace-kernel domain terms |
| `.plan/` | Research, architecture proposals, roadmap, risks, and tracking |
| `CHANGELOG.md` | Versioned user-visible changes |

When a planned capability becomes implemented, update its contract in `docs/`, link it from the
documentation index, and advance `.plan/tracker.md`.
