# Project Structure

The repository is organized around a small public runtime, shared protocol configuration, tests,
implementation documentation, and forward-looking plans.

```text
.
├── src/                    Public TypeScript runtime
│   ├── index.ts            Package export boundary
│   ├── append/             Append drafts, validation, and pure planning
│   ├── blob/               Binary identity and crash-safe filesystem objects
│   ├── canonical/          Deterministic semantic encoding and hashing
│   ├── interchange/        Native archive encoding, validation, and import storage
│   ├── projection/         Disposable execution, relation, and history folds
│   ├── protocol/           Runtime configuration and generated literals
│   ├── record/             Record types, envelopes, guards, and snapshots
│   └── store/              SQLite migrations, transactions, codecs, and reads
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
build/release scripts → repository configuration
tests → public exports
```

Runtime modules must not import build scripts or planning documents. Tests use `src/index.ts` so
they exercise the same public seam as consumers.

The runtime areas are intentionally shallow:

- `append/` owns draft wire-shape validation, parent resolution, and ordinal planning;
- `blob/` owns configured binary identity and content-addressed filesystem durability;
- `canonical/` owns language-neutral semantic encoding and unversioned record hashing;
- `interchange/` owns native archive encoding, decoding, staging, and validated storage transfer;
- `protocol/` owns typed configuration models, fail-closed validation, immutable runtime
  snapshots, and generated literal values;
- `projection/` owns pure disposable execution, relation, and effective-history folds;
- `record/` owns versioned envelopes, record validation, guards, and immutable body snapshots.
- `store/` owns SQLite lifecycle, schema migration, append transactions, durable receipts,
  retained reads, immutable cuts, graph-shaped slices, blob metadata, integrity scans, and append
  recovery diagnostics.

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
