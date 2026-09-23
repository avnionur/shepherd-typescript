# Performance report

Status: normative for 2.30.0 (Phase 11 slice 6, #183); the Linux container host class is added by
#199 (2.34.0). Every number here was measured by this repository on the hosts below. No number is inherited from the Python implementation, the
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

A second host class, `linux-arm64-overlayfs-container`, is measured in a Linux container on this
same machine (see [Linux container host class](#linux-container-host-class)). Bare-metal Linux,
x86-64, Windows, other filesystems, and other macOS machines are not measured.

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

[`config/performance-slo.config.json`](../config/performance-slo.config.json) defines budgets per
host class, selected by platform, architecture, and the `statfs` type of the temporary directory.
Each latency budget bounds p95 at three times the worse p95 of two runs on the class's measurement
host, rounded up; append throughput bounds the median at one third of the lower median, rounded
down. The `macos-arm64-apfs` budgets (runs of 2026-09-18) are below; the
`linux-arm64-overlayfs-container` budgets are in [their section](#linux-container-host-class).

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

## Linux container host class

`linux-arm64-overlayfs-container` matches `platform` `linux`, `arch` `arm64`, and a temporary
directory on overlayfs (`statfs` type `0x794c7630`, 2035054128), which is what a container's own
filesystem reports. It was measured on 2026-09-23 (#199) in a `node:24.21.0-bookworm` container
(Debian 12, Node.js 24.21.0, bundled SQLite 3.53.4) run by Docker 29.4.0 in OrbStack's Linux
virtual machine (kernel `7.0.14-orbstack-00380-ga7e0a2dc9535`, aarch64, 14 CPUs, 16 GiB) on the
macOS arm64 reference host above, as the image's unprivileged `node` user with `TMPDIR` on the
container filesystem. It is not a bare-metal Linux measurement: virtualization and overlayfs are
part of every number. Any linux/arm64 host whose temporary directory is on overlayfs matches the
class, but the budgets are evidence only for this measurement host.

Budgets follow the same rule as above from two `pnpm bench:kernel` runs on 2026-09-23 (worse p95
times three, rounded up to two significant figures; lower median throughput divided by three,
rounded down to two significant figures):

| Metric | Worse p95 (or lower median) of two runs | Budget |
| --- | --- | --- |
| `append_latency_ms` | 1.876 | p95 at most 5.7 |
| `append_throughput_records_per_second` | 838.21 | median at least 270 |
| `cut_resolve_ms` | 99.369 | p95 at most 300 |
| `slice_read_ms` | 11.5 | p95 at most 35 |
| `subscription_pull_ms` | 10.855 | p95 at most 33 |
| `export_ms` | 1380.71 | p95 at most 4200 |
| `import_ms` | 1250.367 | p95 at most 3800 |
| `verify_ms` | 805.498 | p95 at most 2500 |
| `gc_inspect_ms` | 0.961 | p95 at most 2.9 |
| `cli_startup_ms` | 79.096 | p95 at most 240 |

A third run wrote
[`docs/generated/benchmarks/linux-arm64-overlayfs-container.json`](./generated/benchmarks/linux-arm64-overlayfs-container.json)
(recorded 2026-09-23, same configuration digest as the macOS artifact, package 2.33.3):

| Metric | Unit | Median | p95 | Std dev | Min | Max |
| --- | --- | --- | --- | --- | --- | --- |
| `append_latency_ms` | ms | 1.539 | 1.801 | 0.21 | 1.02 | 1.801 |
| `append_throughput_records_per_second` | records/s | 936.108 | 977.768 | 100.3 | 628.534 | 977.768 |
| `cut_resolve_ms` | ms | 89.635 | 98.067 | 3.376 | 88.331 | 98.067 |
| `slice_read_ms` | ms | 8.155 | 10.759 | 1.11 | 7.927 | 10.759 |
| `subscription_pull_ms` | ms | 8.736 | 10.654 | 0.797 | 8.389 | 10.654 |
| `export_ms` | ms | 1365.679 | 1515.523 | 45.647 | 1343.644 | 1515.523 |
| `import_ms` | ms | 1184.661 | 1320.139 | 53.942 | 1144.665 | 1320.139 |
| `verify_ms` | ms | 788.536 | 882.645 | 44.735 | 764.803 | 882.645 |
| `gc_inspect_ms` | ms | 0.895 | 1.47 | 0.18 | 0.833 | 1.47 |
| `cli_startup_ms` | ms | 71.28 | 75.746 | 2.637 | 68.433 | 75.746 |

Durable appends are several times slower than on APFS in this virtual machine (synchronous `FULL`
reaches the VM's virtual disk), import is faster, and `gc_inspect_ms` is lower. `pnpm check:slo` in
the same container then passed every budget instead of reporting `SLO: skipped`.

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

For the Linux container class, run the same two commands as a non-root user inside a Linux arm64
container whose `TMPDIR` is on the container filesystem (overlayfs), after `pnpm install
--frozen-lockfile`.

Changing `config/kernel-benchmark.config.json` changes the configuration digest, so `check:slo`
fails until `pnpm bench:kernel` records a new artifact.
