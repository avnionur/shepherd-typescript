# Performance report

Status: normative for 2.30.0 (Phase 11 slice 6, #183); the Linux container host class is added by
#199 (2.34.0); the scope fork/revert and observation benchmark is added by #214 (11.2.0); the device-layer
checkpoint benchmark is added by #215 (11.3.0). Every number here was measured by this repository on the hosts below. No number is inherited from the Python implementation, the
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
(clonefile, reflink, overlay) branch storage through the scope API is measured by the
[scope benchmark](#scope-forkrevert-and-observation-benchmark) below; see also
[optimized carriers](./optimized-carriers.md).

## Scope fork/revert and observation benchmark

`pnpm bench:scopes` ([`scripts/bench-scopes.ts`](../scripts/bench-scopes.ts), logic in
[`tooling/benchmark/scope-benchmark.ts`](../tooling/benchmark/scope-benchmark.ts), configuration
parsing, statistics, and the tree digest in
[`tooling/benchmark/scope-benchmark-config.ts`](../tooling/benchmark/scope-benchmark-config.ts),
tests in [`test/benchmark/scope-benchmark.test.ts`](../test/benchmark/scope-benchmark.test.ts))
follows the dimensions of paper Section 4 and Appendix C (Tables 3, 7, 8 right, 9; C.1) with the
procedure in [`config/scope-benchmark.config.json`](../config/scope-benchmark.config.json). It
measures only this repository's public scope, carrier, replay, and subscription APIs on the hosts
below. No number from the paper is used, and the paper's Docker images, sandboxes, networked
backends, and agent turns are not reproduced: the worlds are synthetic directories, the carriers
run in-process, and there is no network round trip.

### What is measured

| Dimension | Paper counterpart | Procedure |
| --- | --- | --- |
| `fork_ms/<backend>/<world>` | Table 3 fork | `forkScope` of a child of a writer-held root scope from one immutable snapshot of the `source` binding, including durable custody publication and re-verification of custody and origin; 2 warmups, 10 samples |
| `revert_ms/<backend>/<world>` | Table 3 revert | after one 10 KiB write into the child's custody, `discardScope` with the carrier, which seals the child and removes its custody; 10 samples |
| Branching at K = 4 | Table 3 storage, disk and RAM at K = 4; C.1 5+3 pattern | fork a parent, write 5 baseline files, capture the parent's custody as the checkpoint, fork K - 1 = 3 siblings from it with one write each; per-branch and K-branch free-space drop, total drop from before the baseline writes, trace-store file growth, and process RSS growth; 3 repetitions, medians |
| Mutation-size sweep | Table 7 | the same pattern on the `medium` world with 1 KiB, 10 KiB, 1 MiB, and 10 MiB writes; a least-squares fit of total storage growth against bytes written; sibling fork and discard latency |
| Revert correctness | C.2 (12/12 PASS) | after every discard: the source binding, the parent custody, and a fresh fork of the checkpoint are compared with their pre-fork state by a SHA-256 tree digest computed independently of the carrier, the fresh fork must also match the checkpoint's content identity, and discarded custody must no longer open; any failure fails the run |
| `record_ms/observers-<n>/steps-<s>` | Table 8 right, Table 9 | one `dispatchEffect` in a replay session with no world binding, at 1, 10, 50, 100, and 200 steps with 0, 1, and 4 observers; 3 sessions per cell |
| `observe_ms/observers-<n>/steps-<s>` | Table 8 right, Table 9 | one ephemeral `openTraceSubscription` observer pulling that event's committed records; every observer drains after every event |
| Stream size | Table 8 right | committed records and JSON bytes of those records per event; the benchmark fails if observers change the record count |

Worlds: `small` 10 files of 3 KiB (30 KB), `medium` 100 files of 100 KiB (10 MB), `large` 100
files of 1 MiB (100 MB), a span of about 3,400x (the paper's images span 42 MB to 5.8 GB). Every
conformant backend on the host is measured: `copy` always, plus each optimized carrier that
`inspectWorkspacePlatformConformance` reports conformant. Storage is the host free-space drop after
the configured flush command (`sync`), so it includes carrier descriptors and manifests, the trace
store (reported separately), and any concurrent writer on the volume; RSS is this single process,
since the carriers run in-process (the paper sums container RSS). Raw samples, summaries, per-row
repetitions, the revert checks, host facts, and the configuration digest are in the result
artifacts. One run takes about 7 minutes on the macOS host and 5 on the Linux lane.

### Hosts

| Host class | Host | Backends |
| --- | --- | --- |
| `macos-arm64-apfs` | the reference host above (Apple M4 Pro, Darwin 27.0.0, APFS, Node.js 24.17.0, SQLite 3.53.0) | `copy`, `clone` |
| `linux-arm64-xfs-privileged-container` | `pnpm bench:scopes:linux`: a privileged `node:24-bookworm` container (Node.js 24.21.0, SQLite 3.53.4) run as root by Docker in OrbStack's Linux VM (kernel `7.0.14-orbstack-00380-ga7e0a2dc9535`, 14 CPUs, 16 GiB) on the same Mac, with `TMPDIR` on a 3 GiB loopback XFS `reflink=1` image on tmpfs | `copy`, `clone`, `overlay` |

The Linux class is a container-in-VM measurement on the same machine, not bare-metal Linux; its
XFS lives on tmpfs, so fsync reaches memory rather than a disk. Results recorded 2026-09-25 on
package 11.2.0 (configuration digest
`sha256:9d3dcc4c0bd3075b50a939450933515a4a77f7d56e6bc7c2334d5f9b5234bce6`):
[`scope-benchmark-macos-arm64-apfs.json`](./generated/benchmarks/scope-benchmark-macos-arm64-apfs.json)
and
[`scope-benchmark-linux-arm64-xfs-privileged-container.json`](./generated/benchmarks/scope-benchmark-linux-arm64-xfs-privileged-container.json).

### Fork and revert latency (ms)

| Host class | Backend | World | Fork median | Fork p95 | Revert median | Revert p95 |
| --- | --- | --- | --- | --- | --- | --- |
| `macos-arm64-apfs` | `copy` | small | 195.873 | 211.782 | 49.484 | 59.678 |
| `macos-arm64-apfs` | `copy` | medium | 674.273 | 901.235 | 99.772 | 190.424 |
| `macos-arm64-apfs` | `copy` | large | 922.581 | 993.484 | 157.549 | 191.332 |
| `macos-arm64-apfs` | `clone` | small | 144.118 | 154.844 | 33.191 | 36.113 |
| `macos-arm64-apfs` | `clone` | medium | 809.695 | 840.355 | 73.555 | 80.83 |
| `macos-arm64-apfs` | `clone` | large | 1087.215 | 1101.942 | 145.941 | 149.349 |
| `linux-arm64-xfs-privileged-container` | `copy` | small | 24.286 | 29.459 | 8.945 | 12.496 |
| `linux-arm64-xfs-privileged-container` | `copy` | medium | 114.846 | 131.037 | 35.685 | 42.078 |
| `linux-arm64-xfs-privileged-container` | `copy` | large | 423.071 | 508.017 | 132.799 | 142.097 |
| `linux-arm64-xfs-privileged-container` | `clone` | small | 24.346 | 29.595 | 8.266 | 9.906 |
| `linux-arm64-xfs-privileged-container` | `clone` | medium | 126.858 | 146.894 | 37.191 | 42.038 |
| `linux-arm64-xfs-privileged-container` | `clone` | large | 439.887 | 516.121 | 142.504 | 152.886 |
| `linux-arm64-xfs-privileged-container` | `overlay` | small | 26.999 | 33.804 | 10.879 | 14.666 |
| `linux-arm64-xfs-privileged-container` | `overlay` | medium | 118.374 | 132.963 | 44.392 | 53.183 |
| `linux-arm64-xfs-privileged-container` | `overlay` | large | 357.249 | 391.406 | 145.307 | 154.884 |

Fork latency is not independent of world size on any backend here, clone and overlay included:
`forkScope` completes only after it durably publishes the custody and re-verifies custody and origin
against their content identities, and that work grows with the world's files and bytes. The
benchmark does not separate the physical branch from the verification. Revert (discard) also
re-verifies the custody before removing it. On the macOS host clone is not faster than copy: it
forks the medium and large worlds 18 to 20% slower; on the Linux lane overlay forks the large
world about 15% faster than copy. The first macOS run recorded a copy small-world fork median of 118 ms against 196 ms in the committed run; the
macOS numbers move by that much between runs on a busy machine.

### Branch storage at K = 4 (default 10 KiB writes, medians of 3)

Per-branch is one sibling fork plus its write; K-branch is the three siblings; total adds the five
baseline writes and the checkpoint capture. Every row's trace-store growth was 510,880 bytes, which
is included in the totals.

| Host class | Backend | World | Per-branch bytes | K-branch bytes | Total bytes | RSS growth bytes |
| --- | --- | --- | --- | --- | --- | --- |
| `macos-arm64-apfs` | `copy` | small | 786,432 | 3,239,936 | 3,604,480 | 327,680 |
| `macos-arm64-apfs` | `copy` | medium | 12,091,392 | 35,278,848 | 46,260,224 | 0 |
| `macos-arm64-apfs` | `copy` | large | 105,181,184 | 316,784,640 | 421,834,752 | 0 |
| `macos-arm64-apfs` | `clone` | small | 241,664 | 1,613,824 | 1,695,744 | 16,384 |
| `macos-arm64-apfs` | `clone` | medium | 258,048 | 1,654,784 | 1,781,760 | 0 |
| `macos-arm64-apfs` | `clone` | large | 716,800 | 2,789,376 | 2,904,064 | 0 |
| `linux-arm64-xfs-privileged-container` | `copy` | small | 126,976 | 1,421,312 | 1,593,344 | 524,288 |
| `linux-arm64-xfs-privileged-container` | `copy` | medium | 10,395,648 | 32,194,560 | 42,651,648 | 393,216 |
| `linux-arm64-xfs-privileged-container` | `copy` | large | 105,013,248 | 316,047,360 | 421,122,048 | 0 |
| `linux-arm64-xfs-privileged-container` | `clone` | small | 24,576 | 1,114,112 | 1,183,744 | 0 |
| `linux-arm64-xfs-privileged-container` | `clone` | medium | 90,112 | 1,290,240 | 1,445,888 | 0 |
| `linux-arm64-xfs-privileged-container` | `clone` | large | 90,112 | 1,290,240 | 1,445,888 | 2,097,152 |
| `linux-arm64-xfs-privileged-container` | `overlay` | small | 20,480 | 1,101,824 | 1,273,856 | 0 |
| `linux-arm64-xfs-privileged-container` | `overlay` | medium | 20,480 | 1,101,824 | 11,526,144 | 0 |
| `linux-arm64-xfs-privileged-container` | `overlay` | large | 20,480 | 1,101,824 | 106,143,744 | 0 |

A copy branch costs the whole world; clone and overlay branches cost what they write plus 1 to
3 MB of carrier and trace metadata for the three siblings, with no world-sized term. Overlay's
total includes the checkpoint capture, which is a full immutable revision of the parent world. The
overlay upper layers of the parent and three siblings held 98,304 allocated bytes in every world
(80 KiB written). RSS growth is noise-level for an in-process carrier and should not be read as
per-branch memory.

### Mutation-size sweep (`medium` world, K = 4, medians of 3)

| Host class | Backend | Write | Written | Total bytes | K-branch bytes | Sibling fork median ms | Sibling revert median ms |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `macos-arm64-apfs` | `copy` | 1 KiB | 8,192 | 42,823,680 | 32,468,992 | 860.5 | 122.2 |
| `macos-arm64-apfs` | `copy` | 10 KiB | 81,920 | 46,260,224 | 35,278,848 | 1017.1 | 153.7 |
| `macos-arm64-apfs` | `copy` | 1 MiB | 8,388,608 | 73,170,944 | 52,375,552 | 903.0 | 118.9 |
| `macos-arm64-apfs` | `copy` | 10 MiB | 83,886,080 | 336,293,888 | 221,122,560 | 1044.5 | 163.3 |
| `macos-arm64-apfs` | `clone` | 1 KiB | 8,192 | 1,785,856 | 1,679,360 | 1063.9 | 110.7 |
| `macos-arm64-apfs` | `clone` | 10 KiB | 81,920 | 1,781,760 | 1,654,784 | 1039.2 | 111.9 |
| `macos-arm64-apfs` | `clone` | 1 MiB | 8,388,608 | 10,420,224 | 5,033,984 | 1089.1 | 119.1 |
| `macos-arm64-apfs` | `clone` | 10 MiB | 83,886,080 | 86,654,976 | 34,164,736 | 1228.1 | 168.9 |
| `linux-arm64-xfs-privileged-container` | `copy` | 1 KiB | 8,192 | 42,422,272 | 32,047,104 | 214.0 | 54.4 |
| `linux-arm64-xfs-privileged-container` | `copy` | 10 KiB | 81,920 | 42,651,648 | 32,194,560 | 223.4 | 53.9 |
| `linux-arm64-xfs-privileged-container` | `copy` | 1 MiB | 8,388,608 | 71,667,712 | 50,847,744 | 277.1 | 70.5 |
| `linux-arm64-xfs-privileged-container` | `copy` | 10 MiB | 83,886,080 | 335,908,864 | 220,717,056 | 508.6 | 124.3 |
| `linux-arm64-xfs-privileged-container` | `clone` | 1 KiB | 8,192 | 1,413,120 | 1,298,432 | 256.4 | 55.6 |
| `linux-arm64-xfs-privileged-container` | `clone` | 10 KiB | 81,920 | 1,445,888 | 1,290,240 | 233.5 | 57.6 |
| `linux-arm64-xfs-privileged-container` | `clone` | 1 MiB | 8,388,608 | 9,736,192 | 4,399,104 | 307.4 | 66.6 |
| `linux-arm64-xfs-privileged-container` | `clone` | 10 MiB | 83,886,080 | 85,266,432 | 32,743,424 | 537.9 | 136.5 |
| `linux-arm64-xfs-privileged-container` | `overlay` | 1 KiB | 8,192 | 11,419,648 | 1,077,248 | 272.4 | 79.2 |
| `linux-arm64-xfs-privileged-container` | `overlay` | 10 KiB | 81,920 | 11,526,144 | 1,101,824 | 212.7 | 62.5 |
| `linux-arm64-xfs-privileged-container` | `overlay` | 1 MiB | 8,388,608 | 24,997,888 | 4,210,688 | 324.8 | 90.6 |
| `linux-arm64-xfs-privileged-container` | `overlay` | 10 MiB | 83,886,080 | 147,681,280 | 32,522,240 | 604.0 | 165.3 |

Line fits of total storage against bytes written (every fit has r² = 1.0 to three decimals):

| Host class | Backend | Bytes stored per byte written | Intercept bytes |
| --- | --- | --- | --- |
| `macos-arm64-apfs` | `copy` | 3.481 | 44,255,700 |
| `macos-arm64-apfs` | `clone` | 1.012 | 1,798,790 |
| `linux-arm64-xfs-privileged-container` | `copy` | 3.499 | 42,358,766 |
| `linux-arm64-xfs-privileged-container` | `clone` | 1.000 | 1,372,855 |
| `linux-arm64-xfs-privileged-container` | `overlay` | 1.625 | 11,390,163 |

Clone storage tracks what the workload writes one to one plus a constant. Overlay stores the
writes once in the upper layers (the four upper layers held 83,886,080 allocated bytes at 10 MiB
per write, exactly the bytes written, and 8,388,608 at 1 MiB) plus the checkpoint revision, which
holds the five baseline writes again: 5/8 extra per byte written. Copy duplicates the parent's
baseline into the checkpoint and into each of the three siblings, hence about 3.5 bytes per byte
written plus four world copies. Fork and discard latency grow with the bytes in the parent's
custody because both re-verify it. All 150 macOS and 225 Linux revert checks passed.

### Record and observe overhead per event (ms)

| Host class | Steps | Observers | Record median | Record p95 | Observe median | Observe p95 |
| --- | --- | --- | --- | --- | --- | --- |
| `macos-arm64-apfs` | 1 | 0 | 0.998 | 1.467 | - | - |
| `macos-arm64-apfs` | 10 | 0 | 0.734 | 0.941 | - | - |
| `macos-arm64-apfs` | 50 | 0 | 0.698 | 0.892 | - | - |
| `macos-arm64-apfs` | 100 | 0 | 0.7 | 1.12 | - | - |
| `macos-arm64-apfs` | 200 | 0 | 0.705 | 1.499 | - | - |
| `macos-arm64-apfs` | 200 | 1 | 0.664 | 1.048 | 0.144 | 0.195 |
| `macos-arm64-apfs` | 200 | 4 | 0.663 | 1.229 | 0.136 | 0.174 |
| `linux-arm64-xfs-privileged-container` | 1 | 0 | 1.522 | 3.207 | - | - |
| `linux-arm64-xfs-privileged-container` | 10 | 0 | 0.734 | 1.392 | - | - |
| `linux-arm64-xfs-privileged-container` | 50 | 0 | 0.662 | 1.203 | - | - |
| `linux-arm64-xfs-privileged-container` | 100 | 0 | 0.825 | 1.755 | - | - |
| `linux-arm64-xfs-privileged-container` | 200 | 0 | 0.7 | 1.474 | - | - |
| `linux-arm64-xfs-privileged-container` | 200 | 1 | 0.682 | 1.444 | 0.181 | 0.363 |
| `linux-arm64-xfs-privileged-container` | 200 | 4 | 0.986 | 2.116 | 0.174 | 0.342 |

The artifacts hold every step count for every observer count. Per-event record cost stays flat
from 10 to 200 steps (the 1-step cell includes first-dispatch work), and attaching 1 or 4 pull-based
observers leaves it within run-to-run noise, since observers only read committed records. Each
event commits 2 records (intent and outcome) of about 2.7 KB of JSON (2,660 bytes at 1 step, 2,747
at 200), so the stream grows linearly; the recorded record count was identical with and without
observers at every step count. These are in-process timings without a sandbox or network hop, so
they are not comparable to the paper's remote-sandbox figures.

### Scope SLO check

The `slo` section of the benchmark configuration budgets `fork_ms` and `revert_ms` for every
measured backend and world and `record_ms` and `observe_ms` at 200 steps, each at p95 no more than
three times the worst p95 of three runs on the class's host, rounded up to two significant figures.
The committed artifact is the third run; the first two runs were not committed. On
`macos-arm64-apfs` the committed run was the slowest for copy forks and reverts (for example
`revert_ms/copy/medium` p95 190.4 against 70.2 and 72.7 in the other runs), so those budgets are
set from it and the spread between runs on one host is itself up to about 2.7 times.
`pnpm check:scopes` requires the committed artifact to record the current configuration digest,
measures afresh, and fails on any budget miss or failed revert check; it is not part of
`pnpm verify` or `pnpm verify:release`, because one run takes minutes. Every run is within its
class's budgets by construction (17 budgets on `macos-arm64-apfs` and 23 on
`linux-arm64-xfs-privileged-container`). A host without a class prints `SLO: skipped`.

## Device-layer checkpoint benchmark

`pnpm bench:device-layers` ([`scripts/bench-device-layers.ts`](../scripts/bench-device-layers.ts),
[`config/device-layer-benchmark.config.json`](../config/device-layer-benchmark.config.json), added
by #215 in 11.3.0) times layered `checkpoint()` and `restore()` of every available device-layer
adapter over 1, 16, and 128 MiB worlds and sweeps 100 consecutive checkpoints through the configured
depth bound of 48 with compaction. `pnpm bench:device-layers:linux` runs the device-layer
conformance kit (overlay required on tmpfs; clone and overlay required on loopback XFS `reflink=1`)
and the benchmark on tmpfs in a privileged `node:24-bookworm` container on the same Mac (OrbStack,
kernel `7.0.14-orbstack-00380-ga7e0a2dc9535`, Node.js 24.21.0). The macOS run used the reference
host with Docker 29.4.0 and the container adapter opted in.

| Host | Adapter | Checkpoint 1 / 16 / 128 MiB (median ms) | Ratio over a 128x world |
| --- | --- | --- | --- |
| Linux tmpfs container | `overlay` | 2.06 / 3.06 / 2.71 | 1.32 |
| Linux tmpfs container | `copy` | 0.93 / 8.61 / 74.18 | 79.8 |
| macOS APFS | `container` (Docker) | 360 / 357 / 419 | 1.16 |
| macOS APFS | `copy` | 103 / 1,186 / 9,058 | 88.0 |
| macOS APFS | `clone` | 131 / 1,641 / 14,795 | 113.3 |

The overlay checkpoint is independent of world size on this lane (the script fails above a 3x
ratio) and stays at 2.5–2.9 ms through 48 stacked layers; a compacting checkpoint costs 13.8 ms on
the 1 MiB world. Container commits grow from 356 to 518 ms with image depth and a container
compaction costs 5.5 s. These are device-layer checkpoints only: scope fork latency still grows
with world size (above) because `forkScope` durably publishes and re-verifies carrier custody and
does not use device layers. Details and non-claims: [device layers](./device-layers.md#measured-capture-cost).
Artifacts: [`device-layer-checkpoints-linux-arm64.json`](./generated/benchmarks/device-layer-checkpoints-linux-arm64.json),
[`device-layer-checkpoints-darwin-arm64.json`](./generated/benchmarks/device-layer-checkpoints-darwin-arm64.json).

## Reproducing

```sh
pnpm bench:kernel     # rewrites docs/generated/benchmarks/<host-class>.json and prints the SLO evaluation
pnpm check:slo        # fresh measurement against the budgets; part of pnpm verify:release
pnpm bench:carriers   # carrier storage measurement, printed as JSON
pnpm bench:scopes     # rewrites docs/generated/benchmarks/scope-benchmark-<host-class>.json
pnpm check:scopes     # fresh scope measurement against the scope budgets
pnpm bench:scopes:linux   # privileged Linux XFS container lane (Docker required)
pnpm bench:device-layers  # rewrites docs/generated/benchmarks/device-layer-checkpoints-<platform>-<arch>.json
SHEPHERD_DEVICE_LAYER_OPT_IN=container pnpm bench:device-layers  # also measures the Docker adapter
pnpm bench:device-layers:linux  # privileged Linux lane: overlay conformance and benchmark (Docker required)
```

For the Linux container class, run the same two commands as a non-root user inside a Linux arm64
container whose `TMPDIR` is on the container filesystem (overlayfs), after `pnpm install
--frozen-lockfile`.

Changing `config/kernel-benchmark.config.json` changes the configuration digest, so `check:slo`
fails until `pnpm bench:kernel` records a new artifact.
