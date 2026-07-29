# Project Structure

The repository is organized around a small public runtime, shared protocol configuration, tests,
implementation documentation, and forward-looking plans.

```text
.
├── src/                    Public TypeScript runtime
│   ├── index.ts            Package export boundary
│   ├── canonical-record.ts Canonical encoding and record identifiers
│   ├── protocol-config.ts  Typed runtime configuration loader
│   ├── protocol-values.generated.ts Generated protocol literal types
│   ├── record-types.ts     Record body and envelope vocabulary
│   ├── record-envelope.ts  Versioned record identity creation
│   ├── record-guards.ts    Shared record field and body guards
│   └── record-validation.ts Untrusted envelope verification
├── test/                   Public-seam unit tests and fixture assets
├── spec/                   Language-neutral JSON Schema contracts
├── scripts/                Build and release utilities
├── .github/                CI, security automation, and contribution templates
├── docs/                   Implemented contracts and contributor guidance
├── .plan/                  Research, roadmap, decisions, and progress tracker
├── project.config.json     CLI and Python ecosystem identity
├── protocol.config.json    Language-neutral protocol constants
├── CONTEXT.md              Trace-kernel domain vocabulary
├── upstream.lock.json      Pinned upstream development and release revisions
└── release-config.yaml     Repository version source
```

## Dependency direction

```text
public exports → record modules → canonical record module → protocol configuration
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
- Unit tests and their assets live under `test/` and describe externally observable behavior
  through `src/index.ts`.

## Documentation ownership

| Location | Purpose |
| --- | --- |
| `README.md` | Entry point, installation, current capability, and navigation |
| `docs/` | Implemented behavior and repository structure |
| `spec/` | Language-neutral, versioned wire schemas |
| `test/` | Unit tests and cross-language conformance fixtures |
| `CONTEXT.md` | Canonical trace-kernel domain terms |
| `.plan/` | Research, architecture proposals, roadmap, risks, and tracking |
| `CHANGELOG.md` | Versioned user-visible changes |

When a planned capability becomes implemented, update its contract in `docs/`, link it from the
documentation index, and advance `.plan/tracker.md`.
