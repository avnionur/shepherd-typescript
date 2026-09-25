# Layered Device-Layer Checkpoints

Status: normative for 11.3.0 (workspace protocol v27, [#215](https://github.com/avnionur/shepherd-typescript/issues/215)).

Implementation: [`src/workspace/device-layer.ts`](../src/workspace/device-layer.ts) (engine and host
adapters), [`src/workspace/device-layer-container.ts`](../src/workspace/device-layer-container.ts)
(reference container adapter), [`src/workspace/device-layer-conformance.ts`](../src/workspace/device-layer-conformance.ts)
(conformance kit), and the stacked-overlay mount helpers in
[`src/workspace/carrier-backends.ts`](../src/workspace/carrier-backends.ts). Public types:
[`src/workspace/device-layer-types.ts`](../src/workspace/device-layer-types.ts). Configuration:
`workspaces.deviceLayers` in [`protocol.config.json`](../protocol.config.json), validated by
[`src/protocol/config-device-layers.ts`](../src/protocol/config-device-layers.ts) and pinned by
`WORKSPACE_PROTOCOL_V27_CONTRACT`. Public entry points: `openDeviceLayerWorld`,
`createDeviceLayerAdapters`, `createCopyDeviceLayerAdapter`, `createCloneDeviceLayerAdapter`,
`createOverlayDeviceLayerAdapter`, `createContainerDeviceLayerAdapter`,
`checkDeviceLayerConformance`, and `DeviceLayerError` from the root and `./workspace` entries.
Tests: [`test/workspace/device-layer.test.ts`](../test/workspace/device-layer.test.ts). Benchmark:
[`scripts/bench-device-layers.ts`](../scripts/bench-device-layers.ts) (`pnpm bench:device-layers`)
and the Linux lane [`scripts/bench-device-layers-linux.ts`](../scripts/bench-device-layers-linux.ts)
(`pnpm bench:device-layers:linux`).

Paper reference: §3.3 (unified device-layer interface), Appendix C.4 (layer-depth limit and
compaction), and C.7 (Docker commit, overlay checkpoint, `cp -a` fallback).

## Model

A device-layer world is a writable layer over a bounded stack of frozen layers. The base layer
holds the seed directory and carries the configured `baseCheckpointName` (`base`). Every frozen
layer carries exactly one checkpoint name whose state is that layer's merged view.

- `world.checkpoint(name)` freezes the writable layer as a new named frozen layer and resumes with an
  empty writable layer. Names match `checkpointNamePattern` and must not name a layer in the stack
  or a retired checkpoint (`DEVICE_LAYER_CHECKPOINT_INVALID`).
- `world.restore(name)` discards the writable layer and every frozen layer above `name` and resumes
  at its state. The discarded names are returned and may be reused. A name removed by compaction
  fails with `DEVICE_LAYER_CHECKPOINT_RETIRED`; any other name outside the stack fails with
  `DEVICE_LAYER_CHECKPOINT_UNKNOWN`. The stack is linear: restoring and checkpointing again replaces
  the discarded branch.
- `writeFile`, `readFile`, `removePath`, and `listFiles` operate on the current world. Paths are
  portable `/`-separated relative paths without empty, `.`, or `..` segments, backslashes, or control
  characters, at most `maxPathBytes` (`DEVICE_LAYER_PATH_INVALID`). Host worlds never traverse a
  symbolic link. `listFiles` returns regular files only, sorted by path, with the carrier blob
  digest (`blob:sha256:<hex>`); directories, modes, and symbolic links are adapter state the
  generic contract does not compare.
- Operations are serialized. `world.path` exposes the host directory of host adapters (null for the
  container adapter); callers writing through it must quiesce before `checkpoint` or `restore`,
  which unmount or replace the world.
- A failed freeze or revert closes the world, because the device may be between stacks; a failed
  file operation does not. Adapter failures surface as `DEVICE_LAYER_OPERATION_FAILED` with the
  original error as `cause`. `close()` releases the device, removes its private root, and is
  idempotent; later operations fail with `DEVICE_LAYER_CLOSED`.

Device-layer worlds are process-scoped scratch devices: nothing is written to the trace store or to
workspace control storage, and a world is not reopened after a process restart. Durable identity
stays with [carrier revisions](./optimized-carriers.md) and
[coupled replay checkpoints](./coupled-checkpoints.md).

## Depth bound and compaction

The configured `depth` policy is `maxDepth` 48 frozen layers (base included) and `retainNewest` 4.
The effective `maxDepth` is the minimum of the configured or caller-supplied bound and the device's
`maxLayers`; a caller may only tighten the configured bound, and `retainNewest` must be between 1
and `maxDepth - 2`, otherwise opening fails with `TypeError`.

When a checkpoint would make the stack deeper than `maxDepth`, the engine asks the device to freeze
and then flatten the oldest `depth + 1 - retainNewest` layers into one replacement base, so exactly
`retainNewest` frozen layers remain above it (the new checkpoint included). The newest flattened
checkpoint name moves to the replacement base and stays restorable; every older flattened name is
retired. The checkpoint result reports `compaction: { into, layers, retired }`. Every retained layer
keeps its exact content.

## Adapter contract

`DeviceLayerAdapter` is `{ name, probe, open }`: `probe({ root })` reports `{ available: true }` or
`{ available: false, reason, detail }` without leaving state in its scratch directory, and
`open({ baseLayer, deviceId, root, seed })` returns a `DeviceLayerDevice` with `path`, `maxLayers`,
file operations, `freeze({ layer, compaction })`, `revert(layers)`, and `close()`. The engine assigns
every layer identifier (fixed-width decimal ordinals, `layerNameWidth` 6), owns checkpoint names,
retirement, and the depth bound, and calls one device method at a time. This is the carrier
backend contract generalized: copy, clone, and overlay reuse the carrier backend names, probes,
materializers, and overlay command policy, and any other substrate plugs in by implementing the same
three members.

## Built-in adapters

| Adapter | World | Checkpoint (freeze) | Restore | Compaction | Available where |
| --- | --- | --- | --- | --- | --- |
| `copy` | host directory | full verified copy of the world into the layer (`cp -a` reference; time and storage grow with world size) | replace the world with a copy of the top layer | keep the newest flattened snapshot, delete the rest | every host |
| `clone` | host directory | clone every regular file (reflink / `clonefile(2)`), each verified byte for byte; storage grows with changed bytes, time with file count | replace the world with clones of the top layer | as `copy` | the clone carrier probe succeeds on the root's filesystem |
| `overlay` | overlay mount of `upper` over the frozen stack (`lowerdir` topmost first) | unmount, rename `upper` into the stack as the named lower layer, recreate `upper` and `work`, remount, and authenticate the mount through `mountinfo`; cost independent of world size | unmount, delete layers above, empty `upper`, remount | mount the flattened layers read-only (`readOnlyMountOptions`), copy the merged view into one replacement layer, delete the flattened layers | Linux with mount permission (the overlay carrier probe) |
| `container` | `/world` inside a container started from a local image (`alpine:3.22`), never pulled | `docker commit` the container as a new image layer, replace the container with one started from that image | remove the container and newer images, start from the checkpoint image | `docker export` the newest flattened image and `docker import` it as a single-layer base, then re-flatten every retained image the same way so no chain exceeds `maxImageLayers` (120) | the configured CLI, daemon, and image are available |

The overlay device's `maxLayers` is the largest stack whose rendered mount options fit
`overlay.maxMountOptionBytes` (4,000 bytes, below the kernel's page-size option limit that the paper
reports at about 60 layers), capped by the configured `maxDepth`. The container device's
`maxLayers` is `maxImageLayers` minus the base image's layer count. The container adapter runs the
configured CLI without a shell: every argument and in-container command is a configured template
(`workspaces.deviceLayers.container.arguments` and `.commands`) whose tokens are substituted inside
an argument in a single pass, so a substituted value that contains token text (for example a world
path `notes/{world}.txt`) is kept literally and never re-expanded; containers run with `--network
none`, and every container and image carries a label or tag naming the device and is removed when
the world closes. `createContainerDeviceLayerAdapter({ image })` overrides the image only and
rejects a value starting with `-`, which the CLI would parse as an option.

## Selection and fallback

`openDeviceLayerWorld({ root, seed?, adapter?, adapters?, selection?, fallbackOrder?, depth? })`
defaults to adapter `copy`, the built-in adapters, `strict` selection, and the configured fallback
order `overlay`, `container`, `clone`, `copy`. Strict selection probes only the requested adapter
and fails with `DEVICE_LAYER_UNAVAILABLE`, naming every attempt and reason. Fallback selection
probes the requested adapter and then every later adapter of the order (the whole order when the
requested adapter is not in it) and uses the first available one; the configured order ends with
`copy`, which is always available. Every candidate name must resolve to one of the supplied
`adapters` (a `TypeError` otherwise), so callers supplying their own adapters under fallback pass a
matching `fallbackOrder`. `world.selection` records `{ mode, requested, used, attempts }`
with each attempt's `available` flag and reason, so the backend actually used is always evidence,
never implicit.

The same opt-in fallback now applies to [carrier backends](./optimized-carriers.md#backend-selection):
`createReferenceCopyCarrier({ backend, backendSelection: "fallback" })` degrades along
`workspaces.carrierBackends.selection.fallbackOrder` and records `carrier.backendSelection`; strict
remains the configured default.

## Conformance kit

`checkDeviceLayerConformance(adapter, { root })` runs five cases through `openDeviceLayerWorld` in
strict mode and returns `{ adapter, passed, cases }` without throwing on a case failure:

1. the probe reports the adapter available;
2. seeded files list with correct digests; writes (including new parent directories), overwrites,
   reads, recursive and absent removals, and refusal of `..`, absolute, empty-segment, `.`, and
   backslash paths;
3. named checkpoints freeze state: a deletion survives freezing, the stack lists `base`, `one`,
   `two`, duplicate and malformed names are refused, `restore("one")` returns exactly its state and
   discards `two`, `two` is then unknown and reusable, and `restore("base")` returns the seed;
4. the depth bound: `conformance.checkpoints` (7) checkpoints under `maxDepth` 4 and
   `retainNewest` 1 never exceed the bound, compact at least once with the replacement as the new
   base, retire the flattened names (restores fail with the retired code), restore every remaining
   checkpoint to exactly its recorded state, and accept new checkpoints after compaction;
5. close removes the device root, is idempotent, and refuses later operations.

`test/workspace/device-layer.test.ts` runs the kit for every built-in adapter the host probe reports
available and for a pure in-memory adapter defined in the test (the pluggability proof), and
asserts that a broken adapter fails the kit with per-case diagnostics. The container adapter is
opt-in: it runs only when `SHEPHERD_DEVICE_LAYER_OPT_IN` or `SHEPHERD_REQUIRED_DEVICE_LAYERS`
([`config/device-layer-conformance.config.json`](../config/device-layer-conformance.config.json))
names it, and it is reported unavailable, not failed, without the CLI, daemon, or image. An adapter
named in `SHEPHERD_REQUIRED_DEVICE_LAYERS` must be available.

Evidence recorded for 11.3.0:

- macOS 26 (Darwin 27.0.0) arm64, Node v24.17.0, APFS, Docker 29.4.0 (OrbStack):
  `SHEPHERD_DEVICE_LAYER_OPT_IN=container node --test test/workspace/device-layer.test.ts` passed
  13 of 13 (copy, clone, and container kits, overlay reported `platform-unsupported`).
- `pnpm bench:device-layers:linux` (`node:24-bookworm`, Node v24.21.0, kernel
  `7.0.14-orbstack-00380-ga7e0a2dc9535`, privileged): on tmpfs with overlay required, 13 of 13
  (copy and overlay kits; clone `reflink-unsupported`, container `container-executable-unavailable`);
  on loopback XFS `reflink=1` with clone and overlay required, 13 of 13 (copy, clone, and overlay
  kits).

## Measured capture cost

`pnpm bench:device-layers` reads
[`config/device-layer-benchmark.config.json`](../config/device-layer-benchmark.config.json). For
worlds of 16, 256, and 2,048 files of 64 KiB (1, 16, and 128 MiB, a 128x span) and every available
adapter, each of 2 warmup and 7 measured steps writes one new 64 KiB file, times `checkpoint()`,
writes one discarded file, and times `restore()` of that checkpoint. A depth sweep freezes 100
consecutive checkpoints over the 16-file world under the configured bound (48, retain 4). The
script fails if the overlay checkpoint median at the largest world exceeds 3 times the smallest.

| Host | Adapter | 1 MiB | 16 MiB | 128 MiB | Ratio (128x world) |
| --- | --- | --- | --- | --- | --- |
| Linux tmpfs container | `overlay` checkpoint | 2.06 ms | 3.06 ms | 2.71 ms | 1.32 |
| Linux tmpfs container | `overlay` restore | 2.26 ms | 2.73 ms | 2.53 ms | 1.12 |
| Linux tmpfs container | `copy` checkpoint | 0.93 ms | 8.61 ms | 74.18 ms | 79.8 |
| macOS APFS | `container` checkpoint | 360 ms | 357 ms | 419 ms | 1.16 |
| macOS APFS | `container` restore | 160 ms | 153 ms | 152 ms | 0.95 |
| macOS APFS | `copy` checkpoint | 103 ms | 1,186 ms | 9,058 ms | 88.0 |
| macOS APFS | `clone` checkpoint | 131 ms | 1,641 ms | 14,795 ms | 113.3 |

Medians of 7. Overlay checkpoints are constant in world size on this lane, which evidences the
constant-time claim for the overlay adapter only; `copy` and `clone` grow linearly, as documented.
macOS `copy` pays one `fsync` per file and `clone` one helper process per file. The container
adapter is also flat in world size, but its latency is dominated by `docker commit` and container
restart through the CLI (OrbStack VM on the same Mac).

Depth sweep (median checkpoint latency by stack depth, excluding compacting checkpoints; 2
compactions in 100 checkpoints each):

| Host | Adapter | Depth 1–12 | 13–24 | 25–36 | 37–48 | Compacting checkpoint |
| --- | --- | --- | --- | --- | --- | --- |
| Linux tmpfs container | `overlay` | 2.51 ms | 2.72 ms | 2.65 ms | 2.93 ms | 13.77 ms |
| macOS APFS | `container` | 356 ms | 396 ms | 449 ms | 518 ms | 5,520 ms |

Overlay checkpoint latency stays flat through 48 stacked layers. Container commit latency grows
with image depth, and container compaction re-flattens every retained image, so it costs one export
and import per retained layer. Compaction of the overlay adapter copies the merged view, so its
cost grows with world size; it runs once every `maxDepth - retainNewest` checkpoints. Artifacts:
[`device-layer-checkpoints-linux-arm64.json`](./generated/benchmarks/device-layer-checkpoints-linux-arm64.json)
and [`device-layer-checkpoints-darwin-arm64.json`](./generated/benchmarks/device-layer-checkpoints-darwin-arm64.json)
(container opted in with `SHEPHERD_DEVICE_LAYER_OPT_IN=container`).

## Non-claims

- Device-layer checkpoints are not coupled replay checkpoints and are not carrier revisions: they
  carry no content-addressed identity, no trace records, and no verified double scan. Replay
  `checkpoint()` world images and carrier `captureCustody` remain verified full scans whose cost
  grows with world size ([coupled checkpoints](./coupled-checkpoints.md),
  [optimized carriers](./optimized-carriers.md)); `forkScope` does not use device layers.
- No process state is frozen; transparent process checkpointing stays unavailable.
- No E2B, Modal, Daytona, or other remote sandbox adapter, and no gVisor lane; the container adapter
  is local Docker only. Measurements are one Mac and one container-in-VM Linux lane, not bare
  metal.
- The overlay adapter needs root or mount permission; unprivileged or user-namespace overlay mounts
  are not attempted. Worlds are not recovered after a crash; a crashed overlay device may leave a
  mount under its root.
- Coverage: overlay device code and container CLI paths are excluded from line coverage with
  justified `node:coverage` blocks and are exercised by the Linux lane and the opt-in container run
  above instead.
