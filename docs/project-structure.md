# Project Structure

The repository is organized around a small public runtime, shared protocol configuration, tests,
implementation documentation, and forward-looking plans.

```text
.
├── src/                    Public TypeScript runtime
│   ├── index.ts            Package export boundary
│   ├── canonical-record.ts Canonical encoding and record identifiers
│   └── protocol-config.ts  Typed runtime configuration loader
├── scripts/                Build and release utilities
├── docs/                   Implemented contracts and contributor guidance
├── .plan/                  Research, roadmap, decisions, and progress tracker
├── protocol.config.json    Language-neutral protocol constants
└── release-config.yaml     Repository version source
```

## Dependency direction

```text
public exports → canonical record module → protocol configuration
build/release scripts → repository configuration
tests → public exports
```

Runtime modules must not import build scripts or planning documents. Tests use `src/index.ts` so
they exercise the same public seam as consumers.

## Module rules

- `src/index.ts` is the only public export boundary.
- Each module owns one cohesive protocol responsibility.
- Split a module when configuration, persistence, transport, or another independent responsibility
  would otherwise be mixed into its domain logic.
- Static protocol values belong in configuration and are loaded through typed adapters.
- Public types and functions require JSDoc with behavior, parameters, results, and failure modes.
- Unit tests remain beside the module and describe externally observable behavior.

## Documentation ownership

| Location | Purpose |
| --- | --- |
| `README.md` | Entry point, installation, current capability, and navigation |
| `docs/` | Implemented behavior and repository structure |
| `.plan/` | Research, architecture proposals, roadmap, risks, and tracking |
| `CHANGELOG.md` | Versioned user-visible changes |

When a planned capability becomes implemented, update its contract in `docs/`, link it from the
documentation index, and advance `.plan/tracker.md`.
