# Benchmark PDF links preservation

Scope: documentation-only PATCH. Copy all three PDFs, retain the original study files, and expose
links in the first README section. Existing runtime, package exports, dependency and benchmark
configuration paths are unchanged.

| Capability | Existing evidence | Risk | Verification |
| --- | --- | --- | --- |
| Discoverable PDF copies | Published study report and two figure PDFs | Low | SHA-256 byte equality with each source; README targets exist |
| Original research artifacts | Study source paths and artifact manifest | Low | Source PDFs retained, unchanged and tracked |
| Installed README links | `test/readme-links.test.ts`; packaged CLI guard | Medium | Absolute repository links; full installed-package gate |
| Runtime/package behavior | Repository verify and desktop build | Low | Full `pnpm verify`, version sync and `pnpm build:desktop` |

Verification passed: all three copies match their source SHA-256 hashes; their README links resolve
to existing repository files. Full `pnpm verify` passed 1,416 tests, with zero failures, two documented
skips, 100% configured coverage, installed-package links and quickstart checks. Version synchronization
and the desktop build passed. Original source PDFs and all runtime/dependency paths are unchanged.
