# Documentation

This directory describes implemented behavior and the current repository structure. Future design
work and compatibility research live separately in [`.plan`](../.plan/README.md).

## Guides

- [Contributing](../CONTRIBUTING.md) defines implementation, verification, documentation, and pull
  request requirements.
- [Security policy](../SECURITY.md) defines private reporting and the supported security boundary.
- [Project structure](./project-structure.md) explains module ownership, dependency direction, and
  where new files belong.
- [Protocol configuration](./protocol-configuration.md) defines validation, immutable snapshots,
  migration-bound constants, and safe SQLite settings.
- [Naming and licensing](./naming-and-licensing.md) records package identity, attribution, and
  publication boundaries.
- [Canonical record contract](./canonical-records.md) defines accepted values, deterministic
  encoding, identifiers, and error behavior.
- [Record body and envelope contract](./record-envelope.md) defines kernel ABI v0 semantic
  identity, causality, validation, and implementation-neutral fixtures.
- [Append planning contract](./append-planning.md) defines append drafts, causal-parent
  resolution, body snapshots, and owner-local ordinal allocation.
- [SQLite trace store](./sqlite-trace-store.md) defines migrations, atomic append transactions,
  idempotency, retained reads, and lifecycle behavior.
- [Trace kernel vocabulary](../CONTEXT.md) defines the canonical domain terms used by code,
  schemas, tests, and documentation.
- [Upstream compatibility baseline](../.plan/upstream-baseline.md) records pinned Shepherd
  revisions and the evidence boundary for parity claims.

## Documentation rules

- Update the README and this index when adding a public module.
- Document exported TypeScript APIs with JSDoc at their declaration.
- Keep normative runtime behavior in `docs/`; keep unfinished proposals in `.plan/`.
- Link implementation documentation to its public entry point and tests.
- Update the changelog and tracker with every completed slice.
