# Storage interfaces

Status: normative from 2.28.0 (Phase 11 slice 4, #181). Configuration: the `storage` section of
[`protocol.config.json`](../protocol.config.json), read by
[`src/protocol/config-storage.ts`](../src/protocol/config-storage.ts) and pinned by
`STORAGE_PROTOCOL_V1_CONTRACT` in
[`src/protocol/compatibility-constants.ts`](../src/protocol/compatibility-constants.ts).
Implementation: [`src/storage/`](../src/storage) (`types.ts`, `memory-blob-backend.ts`,
`filesystem-blob-backend.ts`, `memory-coordinator.ts`, `sqlite-coordinator.ts`, `conformance.ts`,
`errors.ts`, and the internal `coordination.ts` and `blob-backend.ts`). Public entry:
[`./operations`](./package-exports.md) and the root. Tests: [`test/storage/`](../test/storage)
and the process fixture
[`test/fixtures/storage-coordinator-process.ts`](../test/fixtures/storage-coordinator-process.ts).

## Scope

This page defines two adapter contracts, their laws, four local reference adapters, and conformance
kits that let any adapter prove the laws. It does not add a remote store.

- `SQLiteTraceStore` remains the only canonical append store. Records, envelopes, append intents,
  receipts, cuts, and claims are written only by it, and nothing in this module writes, deletes, or
  rewrites a canonical record (decision D-004: remote stores remain adapters; D-018: remote
  storage is interfaces-only for 1.0).
- No cloud, network, or object-store adapter ships. A third-party adapter may implement these
  interfaces; the package makes no claim about it beyond what the conformance kit reports.
- The only remote-capable path for canonical data is backup and restore (#182,
  [backup, restore, and migration](./backup-restore-and-migration.md)): it copies the whole
  database, may write blob bytes to a `BlobStoreBackend`, and can replicate a verified backup's
  objects to a backend and publish its manifest by `compareAndSwapRef`. It never writes records
  through these interfaces.
- Using a `BlobStoreBackend` as the blob layer of `SQLiteTraceStore` is not supported. The
  filesystem reference backend shares the store's on-disk blob layout, but the trace store keeps
  its own receipts and never consults a backend.

## Blob-store backend

`BlobStoreBackend` stores content-addressed bytes. Identifiers use the configured kernel blob
identity (`sha256:` plus 64 lowercase hex digits); every method returns a promise so a network
adapter can implement the same contract.

| Method | Contract |
| --- | --- |
| `put(blobId, bytes)` | Refuses bytes whose digest is not `blobId` before anything is stored (`StorageBlobContentMismatchError`, `STORAGE_BLOB_CONTENT_MISMATCH`). Equal bytes are idempotent (`created: false`). An existing object is never replaced. |
| `get(blobId)` | An independent copy of exactly the stored bytes, or `undefined`. |
| `has(blobId)` | Agrees with `get`. |
| `list({ after, limit })` | Ascending identifier order, stable without writes, `after` exclusive, `limit` within `storage.blobs.maxListLimit` (default `defaultListLimit`); `next` is present exactly when more identifiers exist. |
| `delete(blobId)` | Idempotent: `true` once, then `false`. A deleted identifier may be stored again. |
| `durability` | `durable` (resolved writes survive process exit and host crash) or `volatile`. |

Malformed identifiers, cursors, limits, and non-`Uint8Array` bytes are `TypeError`s.

## Storage coordinator

`StorageCoordinator` provides named compare-and-swap references and leases with fencing tokens. Its
semantics mirror the durable execution claims in
[`src/store/durable-execution-claims.ts`](../src/store/durable-execution-claims.ts): an expired
grant can be taken over with a strictly higher token, and a superseded token is fenced.

References:

- A reference starts absent at generation `0`. `compareAndSwapRef(name, expected, value)` commits
  only when the current generation equals `expected`; the new generation is exactly one higher.
- A stale expectation returns `{ status: "conflict", current }` and changes nothing. Among
  concurrent swaps from one generation exactly one commits.
- With a `fence` (`{ key, owner, fencingToken, now }`), the swap also requires that the lease at
  `key` is held by `owner` under exactly `fencingToken` and that `now` is before its expiry;
  otherwise it returns `{ status: "fenced" }` and changes nothing. The fence is checked in the same
  atomic step as the generation.

Leases:

- `acquireLease(key, owner, ttl, now)` grants a free, expired, or released lease with token
  `previous + 1` (the first token is `1`) and expiry `now + ttl`. While a grant is unexpired, the
  same owner receives the existing grant unchanged (`acquired`) and any other owner receives
  `held` with the current grant. At most one unexpired grant exists per key.
- `renewLease(key, owner, token, ttl, now)` extends the exact current unexpired grant under the
  same token; anything else is `fenced`. Renewal at or after expiry is fenced: recovery is
  re-acquisition, which yields a higher token.
- `releaseLease(key, owner, token)` ends the exact current grant (expiry becomes `0`) so the next
  acquisition is immediate and receives a higher token; anything else is `fenced`. Tokens are never
  reused.
- Time is the caller's clock. Adapters compare the supplied milliseconds and never read a clock, so
  callers that share a coordinator must share a clock source. A grant is valid while `now < expiresAt`.

Names and keys match `storage.names.pattern` and `maxLength`; values are strings up to
`storage.refs.maxValueLength`; owners are non-empty up to `storage.leases.maxOwnerLength`; TTLs lie
within `minTtlMilliseconds` and `maxTtlMilliseconds`. Violations are `TypeError`s. Conflicts, held
leases, and fences are result statuses, never errors.

## Reference adapters

| Adapter | Durability | Notes |
| --- | --- | --- |
| `createMemoryBlobStoreBackend()` | `volatile` | Copies bytes on write and read; one process only. |
| `createFilesystemBlobStoreBackend(root)` | `durable` | Wraps the trace store's `BlobFilesystem` unchanged: private temporary file, `fsync`, no-replace hard link, verified re-read, directory flush, `0600` files in `0700` fan-out directories. Symlinked or non-directory ancestors are refused. Reads verify size and digest and raise `BlobIntegrityError` for a corrupt or non-regular object. `list` walks fan-out directories in order and ignores temporary files, foreign names, and misplaced digests. |
| `createMemoryStorageCoordinator()` | `volatile` | Each operation is decided and applied before its promise settles; one process only. |
| `createSQLiteStorageCoordinator(path)` | `durable` (`volatile` for `:memory:`) | One `BEGIN IMMEDIATE` transaction per swap or lease change over a WAL database with `synchronous = FULL`, defensive mode, and the configured busy timeout (`storage.coordinator`). Several processes may open the same new file at once (F-029, fixed in 2.32.5): the switch to write-ahead logging retries SQLite's deadlock-avoidance `SQLITE_BUSY` within the configured busy timeout, and migrations read the applied schema version and apply inside one `IMMEDIATE` transaction, so later openers find the schema current (`test/storage/process-race.test.ts`). An open that cannot get the lock within the busy timeout throws before returning a handle. New files are created owner-only (`retention.storeFiles.mode`, `0600`) and existing owned files are tightened, as for the trace store. A newer schema is refused with `StorageAdapterError` (`STORAGE_ADAPTER_ERROR`); so is any use after `close()`. |

The filesystem backend may be pointed at a live trace store's blob directory for reads and writes.
Deleting through it a blob that a stored receipt still names breaks that store's integrity
(`verifyBlobs` reports it); trace-store blob deletion belongs to `collectBlobOrphans`. Root a
backend in its own directory unless you only read.

The SQLite coordinator is safe across processes on one host. Network filesystems that do not honor
SQLite's locking are unsupported.

## Conformance kits

`checkBlobStoreBackendConformance(factory)` and `checkStorageCoordinatorConformance(factory)` run
every law against a fresh adapter from `factory` per law, close the adapter when it exposes
`close`, and return a frozen report: `{ passed, durability, laws: [{ law, passed, failure? }] }`.
The kits never throw for adapter misbehavior; a violated expectation, an unexpected throw, a
missing refusal, or a failing factory marks the law failed. Concurrency laws issue overlapping
calls without awaiting between them.

| Blob-store law | Checks |
| --- | --- |
| `declares-durability` | `durability` is a configured value |
| `put-get-round-trip` | first `put` creates; `get` and `has` agree |
| `put-idempotent` | equal second `put` reports `created: false` and does not duplicate |
| `put-refuses-digest-mismatch` | wrong bytes refused; nothing stored |
| `put-never-replaces` | different bytes for an existing identifier refused; original kept |
| `copies-are-isolated` | mutating input or output bytes does not change the object |
| `absent-object` | `get`, `has`, and `delete` of an absent identifier |
| `list-ordered-paged` | order, paging, `next`, exclusive `after`, stability |
| `list-bounds` | out-of-range limits and malformed cursors refused |
| `delete-idempotent` | delete once, then `false`; not listed; re-put creates |
| `malformed-identifiers` | every method refuses a malformed identifier |

| Coordinator law | Checks |
| --- | --- |
| `declares-durability` | `durability` is a configured value |
| `ref-create-and-read` | generation `0` creates generation `1` |
| `ref-generations-monotonic` | each swap adds exactly one |
| `ref-conflict-unchanged` | stale expectations conflict, report the current ref, change nothing |
| `ref-concurrent-single-winner` | exactly one of eight concurrent swaps commits |
| `lease-exclusive` | exactly one of eight concurrent acquisitions succeeds; all see token `1` |
| `lease-reacquire-by-holder` | the holder keeps its token and expiry |
| `lease-expiry-takeover-fences` | expired grant re-acquired with token `2`; old holder fenced |
| `lease-renew` | renewal extends under the same token; wrong owner, token, or late renewal fenced |
| `lease-release` | release enables immediate re-acquisition with a higher token |
| `fenced-swap` | superseded, expired, and absent fences cannot swap |
| `malformed-requests` | grammar, bounds, clocks, and tokens are validated |

`test/storage/conformance.test.ts` runs both kits over all four reference adapters (and the SQLite
coordinator in memory) and shows that deliberately broken adapters fail the expected laws.
`test/storage/process-race.test.ts` starts four processes against one SQLite coordinator file behind
a start barrier; each races for one lease, performs twelve read-then-swap increments with retry, and
attempts a fenced swap. Exactly one process acquires the lease and the fenced swap, every generation
from `1` to `48` is committed exactly once, and after expiry a new owner receives token `2` and the
old token is fenced.

## Configuration

| Key | Meaning |
| --- | --- |
| `storage.compatibilityVersion` | `shepherd.storage.v1`; pinned with the vocabularies below |
| `storage.durabilities` | `durable`, `volatile` (generated `STORAGE_DURABILITIES`) |
| `storage.statuses.lease` | `acquired`, `held`, `renewed`, `released`, `fenced` (generated `STORAGE_LEASE_STATUSES`) |
| `storage.statuses.refSwap` | `swapped`, `conflict`, `fenced` (generated `STORAGE_REF_SWAP_STATUSES`) |
| `storage.names` | Anchored Unicode-mode `pattern` (must not match the empty string) and `maxLength` for reference names and lease keys |
| `storage.refs.maxValueLength` | Longest reference value |
| `storage.leases` | `maxOwnerLength`, `minTtlMilliseconds`, `maxTtlMilliseconds` |
| `storage.blobs` | `defaultListLimit` (not above) `maxListLimit` |
| `storage.coordinator` | Busy timeout, defensive mode, foreign keys, WAL, `FULL`, `IMMEDIATE`, migrations `[1]`, schema version `1` |

Bounds, grammar, and SQLite durability settings are tunable policy; changing the vocabularies or
the compatibility version requires a new storage protocol.
