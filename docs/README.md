# Documentation

This directory describes implemented behavior and the current repository structure. Future design
work and compatibility research live separately in [`.plan`](../.plan/README.md).

## Guides

- [Project structure](./project-structure.md) explains module ownership, dependency direction, and
  where new files belong.
- [Naming and licensing](./naming-and-licensing.md) records package identity, attribution, and
  publication boundaries.
- [Canonical record contract](./canonical-records.md) defines accepted values, deterministic
  encoding, identifiers, and error behavior.
- [Upstream compatibility baseline](../.plan/upstream-baseline.md) records pinned Shepherd
  revisions and the evidence boundary for parity claims.

## Documentation rules

- Update the README and this index when adding a public module.
- Document exported TypeScript APIs with JSDoc at their declaration.
- Keep normative runtime behavior in `docs/`; keep unfinished proposals in `.plan/`.
- Link implementation documentation to its public entry point and tests.
- Update the changelog and tracker with every completed slice.
