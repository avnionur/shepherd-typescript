# Performance report

Status: normative for 2.30.0 (Phase 11 slice 6, #183). Every number here was measured by this
repository on the reference host below. No number is inherited from the Python implementation, the
paper, or any other project, and no number is a claim about another host.

## Reference host

| Property | Value |
| --- | --- |
| Host class | `macos-arm64-apfs` |
| Hardware | Apple M4 Pro, 14 cores, 48 GiB memory |
| Operating system | macOS, Darwin 27.0.0 |
| Filesystem | APFS (`statfs` type 26) for the benchmark temporary directory |
| Runtime | Node.js 24.17.0, SQLite 3.53.0 (bundled `node:sqlite`) |
| Package | 2.30.0 |

Linux, Windows, other filesystems, and other macOS machines are not measured; running the benchmark
there is owner-owed (O-3 in the [hardening contract](../.plan/production-hardening-contract.md),
#191). In the local Docker Linux lane (2.33.1) `pnpm check:slo` reports "skipped; no host class
matches linux/arm64", as designed.

## Kernel benchmark

`pnpm bench:kernel` ([`scripts/bench-kernel.ts`](../scripts/bench-kernel.ts), logic in
[`tooling/benchmark/kernel-benchmark.ts`](../tooling/benchmark/kernel-benchmark.ts)) builds one
synthetic store with [`tooling/benchmark/kernel-dataset.ts`](../tooling/benchmark/kernel-dataset.ts)
from [`config/kernel-benchmark.config.json`](../config/kernel-benchmark.config.json): 40 owners of
200 records and one deep owner of 2,000 records, each record citing its predecessor (10,000 records,
256-character padding), 2 cuts per owner, 40 registered 1 KiB blobs, 20 orphan blobs, and 4
abandoned temporary files. Each metric runs 2 unrecorded warmup iterations and then 12 recorded
samples. The result, with every raw sample, summary statistics (median, nearest-rank p95, mean,
sample variance and standard deviation, minimum, maximum), the environment, and the digest of the
benchmark configuration, is written to
[`docs/generated/benchmarks/macos-arm64-apfs.json`](./generated/benchmarks/macos-arm64-apfs.json).

Results recorded 2026-09-18 (configuration digest
`sha256:f618cf1c0eba158e75c8a189a8a37688beefd419f9fc1f01f211b64967e53bb6`):

| Metric | What one sample measures | Unit | Median | p95 | Std dev | Min | Max |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `append_latency_ms` | one single-record append, synchronous `FULL`, WAL | ms | 0.227 | 0.343 | 0.049 | 0.163 | 0.343 |
| `append_throughput_records_per_second` | 100 sequential single-record appends | records/s | 4295.168 | 4925.087 | 505.453 | 3245.989 | 4925.087 |
| `cut_resolve_ms` | `resolveCut` of the deep owner's last cut (about 2,000 records) | ms | 65.802 | 67.709 | 1.142 | 63.964 | 67.709 |
| `slice_read_ms` | `readOwnerPrefix` of one whole 200-record owner | ms | 6.153 | 8.248 | 0.829 | 5.851 | 8.248 |
| `subscription_pull_ms` | ephemeral subscription pulling one 200-record owner from origin | ms | 6.382 | 8.092 | 0.664 | 5.824 | 8.092 |
| `export_ms` | `exportTrace` of the whole store | ms | 998.839 | 1034.212 | 12.138 | 987.244 | 1034.212 |
| `import_ms` | `importTrace` of that archive into a fresh file store | ms | 1722.108 | 1761.455 | 21.988 | 1686.757 | 1761.455 |
| `verify_ms` | `verifyIntegrity` of the whole store | ms | 586.126 | 610.696 | 7.732 | 582.291 | 610.696 |
| `gc_inspect_ms` | `collectBlobOrphans` inspection with registered-blob verification | ms | 2.46 | 3.116 | 0.257 | 2.375 | 3.116 |
| `cli_startup_ms` | one `node dist/src/cli/main.js --help` process | ms | 76.244 | 78.111 | 1.247 | 74.139 | 78.111 |

Observations from these measurements:

- Before 2.30.0 every append loaded every record identity and owner ordinal. On this dataset
  (10,083 records) that removed scan alone cost a median 3.62 ms per append, about sixteen times
  the whole append latency measured above, and it grew linearly with the store. Append planning now
  reads only the cited records and extended owners by primary key.
- Import time is dominated by per-blob durability: each blob is written to a temporary file,
  fsynced, linked, and its directory fsynced. In single runs of the 20,000-record scale dataset,
  import took about 10.0 s with 400 blobs and about 4.9 s with 150; stores with many small blobs
  import slowly on APFS.
- `resolveCut` and `readOwnerPrefix` materialize and verify every record through the address, so
  their cost is linear in the prefix length.

## SLO check

[`config/performance-slo.config.json`](../config/performance-slo.config.json) defines budgets only
for the `macos-arm64-apfs` class (selected by platform, architecture, and the `statfs` type of the
temporary directory). Each latency budget bounds p95 at three times the worse p95 of two runs on
2026-09-18, rounded up; append throughput bounds the median at one third of the lower median,
rounded down:

| Metric | Budget |
| --- | --- |
| `append_latency_ms` | p95 at most 1.1 |
| `append_throughput_records_per_second` | median at least 1400 |
| `cut_resolve_ms` | p95 at most 210 |
| `slice_read_ms` | p95 at most 30 |
| `subscription_pull_ms` | p95 at most 26 |
| `export_ms` | p95 at most 3000 |
| `import_ms` | p95 at most 5400 |
| `verify_ms` | p95 at most 1800 |
| `gc_inspect_ms` | p95 at most 10 |
| `cli_startup_ms` | p95 at most 240 |

The threefold headroom absorbs run-to-run noise and a loaded machine; it is deliberately loose and
catches regressions of roughly 3x or more, not small drifts. `pnpm check:slo` builds, requires the
committed artifact to record the current benchmark configuration digest, measures afresh, and fails
on any budget miss. It runs in `pnpm verify:release`, not in `pnpm verify`, because timing is
host-dependent. On a host that matches no class it prints `SLO: skipped` and passes; budgets for
such hosts do not exist yet.

## Scale tier

[`test/store/scale.test.ts`](../test/store/scale.test.ts) runs in `pnpm test` with the `default`
tier of [`config/scale-verification.config.json`](../config/scale-verification.config.json): 60
owners of 250 records plus a 5,000-record causal chain (20,000 records), 122 cuts, 150 registered
blobs, 40 orphan blobs, and 12 abandoned temporary files. It requires clean `verifyIntegrity` and
`verifyBlobs`, a causal closure over the whole deep chain, cut and owner reads, owner listing by
schema, orphan collection that finds and deletes exactly the planted orphans and temporary files and
never registered content, a byte-identical export/import round trip, and a byte-identical export
after every maintenance mode. It took about 23 s alone on the reference host.

The `extended` tier (200,000 regular records, a 50,000-record chain, 5,000 blobs) runs on demand:

```sh
SHEPHERD_SCALE_TIER=extended node --test test/store/scale.test.ts
```

Its runtime is dominated by blob durability and is not part of any gate.

## Query plans

[`test/store/query-plans.test.ts`](../test/store/query-plans.test.ts) asserts that no hot-path
statement plans a full table scan (see [SQLite trace store](./sqlite-trace-store.md#query-plans)).
Index-only store schema v13 removed the two scans the test found.

## Carrier storage benchmark

`pnpm bench:carriers` ([`scripts/bench-carriers.ts`](../scripts/bench-carriers.ts),
[`config/carrier-benchmark.config.json`](../config/carrier-benchmark.config.json)) measures free
space consumed by one world branch. On the reference host on 2026-09-18 only the reference `copy`
backend was conformant (the optional clonefile helper does not link with the host C toolchain), so
only copy results exist:

| Backend | World bytes | Changed bytes | Branch bytes (median of 5) |
| --- | --- | --- | --- |
| `copy` | 16,777,216 | 1,048,576 | 16,789,504 |
| `copy` | 16,777,216 | 4,194,304 | 16,789,504 |
| `copy` | 67,108,864 | 1,048,576 | 67,141,632 |
| `copy` | 67,108,864 | 4,194,304 | 67,141,632 |

A copy branch costs the whole world regardless of the changed suffix, as expected. Optimized-carrier
(clonefile, reflink, overlay) storage has no measurement in this report; see
[optimized carriers](./optimized-carriers.md).

## Reproducing

```sh
pnpm bench:kernel     # rewrites docs/generated/benchmarks/<host-class>.json and prints the SLO evaluation
pnpm check:slo        # fresh measurement against the budgets; part of pnpm verify:release
pnpm bench:carriers   # carrier storage measurement, printed as JSON
```

Changing `config/kernel-benchmark.config.json` changes the configuration digest, so `check:slo`
fails until `pnpm bench:kernel` records a new artifact.
