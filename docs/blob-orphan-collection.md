# Blob Orphan Collection

Implementation:
[`src/store/blob-orphans.ts`](../src/store/blob-orphans.ts),
[`src/blob/orphans.ts`](../src/blob/orphans.ts), and
[`SQLiteTraceStore`](../src/store/sqlite-trace-store.ts). Public exports:
[`src/index.ts`](../src/index.ts). Tests:
[`test/blob/orphan-collection.test.ts`](../test/blob/orphan-collection.test.ts) and
[`test/blob/crash.test.ts`](../test/blob/crash.test.ts).

## Collection boundary

`collectBlobOrphans()` inspects the configured blob directory for content-addressed objects and
abandoned temporary files that have no durable SQLite blob registration. Inspection is the
configured default and does not modify the filesystem. `{ mode: "delete" }` removes the exact
objects reported by the same lock-protected pass.

Collection does not delete records, owner views, append intents, cuts, registered blob metadata,
or registered blob content. Unowned or inconsistent database rows remain integrity evidence and
require explicit manual recovery rather than garbage collection.

## Concurrency and verification

Blob writers acquire the configured immediate SQLite transaction before filesystem publication.
Collection acquires the same write lock, verifies every registered blob receipt and object, then
derives the retained blob set from the locked database snapshot. A collector therefore runs either
before a writer publishes or after its receipt commits; it cannot remove an in-flight object.

Collection fails closed when registered content is corrupt, a configured fanout path is unsafe, or
a store-controlled fanout directory contains an unexpected object. The canonical root and fanout
paths are revalidated before traversal and again before deletion. Foreign entries outside the
configured fanout shape are preserved. Each successful deletion flushes its containing directory
where supported.

Portable Node filesystem APIs do not expose anchored `unlinkat` semantics. Callers providing a
custom root must therefore keep its parent and fanout directories unavailable to untrusted
concurrent replacement, matching the blob-store construction trust boundary.

## Report

The frozen report contains the applied mode, sorted orphan blob identities, abandoned temporary
file count, deleted blob identities, and deleted temporary-file count. A failed deletion may have
removed an earlier unregistered candidate, but it never reports success and remains safely
retryable because candidates have no durable registration.

The supported modes, non-destructive default, temporary-file prefix, digest shape, and fanout
layout are compatibility-locked in `protocol.config.json`.
