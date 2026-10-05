# Study preservation matrix

This study changes research artifacts and release metadata only. It invokes the existing public
benchmark and evaluation seams without changing runtime code, configurations, or historical results.
The starting checkout has unrelated uncommitted audit and tracking work, retained in place.

| Capability | Existing evidence | Change risk | Required verification |
| --- | --- | --- | --- |
| Kernel measurement and summaries | `test/benchmark/kernel-benchmark.test.ts` | Low: unchanged implementation | Existing benchmark tests; raw study results and fixed SLO evaluation |
| Scope restoration and observer neutrality | `test/benchmark/scope-benchmark.test.ts`; independent tree hashes in suite | Low: unchanged implementation | Fresh full scope suite including every embedded correctness check |
| Checkpoint and carrier storage | Existing benchmark script assertions | Low: unchanged implementation | Fresh scripts; preserve stderr, exit status, and unavailable backends |
| Offline research applications | `test/applications/application-evaluation.test.ts` | Low: unchanged implementation | Fresh `runApplicationEvaluation`; deterministic evaluation gate |
| Runtime/package capabilities | Existing repository tests and packaged CLI gates | Low: metadata only | `pnpm verify`, `pnpm sync:version`, `pnpm build:desktop` |
| Prior user work and historical artifacts | Initial `git status` and raw provenance | Medium: shared checkout | Final diff audit; no branch switch, commit, or historical artifact overwrite |

## Completed evidence

- Focused verification passed 35 tests, including independent scope digests, benchmark statistics,
  deterministic application evaluation, provider-prefix reconstruction, and two compression crash
  boundaries. Scripted cache tests remain distinct from live cache evidence.
- The fresh scope experiment passed 150 recorded restoration checks and observation record-count
  neutrality. One scope latency budget failed; the carrier storage assertion also failed. Both are
  retained as measurement results, not described as preserved performance guarantees.
- The local model pilot retained 48 terminal results through repeat, reopen, and import; no repeat
  issued another provider request. Both stores passed integrity verification. Analysis independently
  regraded 96 outcomes and checked all 48 paired request and output identities.
- Host repository tests passed 1,338 cases, with zero failures and two documented skips, at 100%
  line, branch, and function coverage. The host verification command's final package check initially
  found the not-yet-created study guide; after it was added, `pnpm test:package-cli` passed. Every
  constituent gate has passing evidence; the earlier full command's nonzero status remains recorded.
- `pnpm sync:version` and `pnpm build:desktop` passed. Generated API and protocol compatibility
  digests are unchanged; only their version metadata, SBOM version references/serial, and API-reference
  package label changed. No runtime, dependency, lockfile, assertion, or benchmark-budget file changed.
- Initial audit/tracking changes and the scheduled-task lock deletion are retained. There was no
  staging, commit, branch switch, stash, reset, or cleanup of earlier work.

Detailed gate outcomes and source/document limits are in [verification.json](./verification.json).

## Publication on current main

The isolated 13.7.1 publication branch is based on 13.7.0. Fresh full `pnpm verify` passed
1,416 tests, with zero failures and two documented skips, at 100% configured coverage, including
installed-package and quickstart gates. Version synchronization and the desktop build passed.
All 36 captured raw files match their original bytes; no runtime or dependency path changed.
Earlier main-branch capabilities, including durable provider checkpoints, remain in the base.
The study remains historical evidence for 12.0.3 and makes no benchmark claim for 13.7.x.
