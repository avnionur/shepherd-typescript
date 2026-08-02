# Content-Addressed Blob Storage

Implementation:
[`src/blob`](../src/blob) and [`src/store/blobs.ts`](../src/store/blobs.ts). Public API:
[`SQLiteTraceStore`](../src/store/sqlite-trace-store.ts). Tests:
[`test/blob`](../test/blob).

## Identity and layout

`putBlob(content)` accepts a `Uint8Array`, computes the configured SHA-256 identity, and returns a
frozen `{ blob_id, byte_length }` storage receipt. Equal bytes reuse the same identity and
filesystem object.

File databases use `<database-path>.blobs` by default. Callers may provide `blobDirectory`; an
in-memory database receives an owned temporary directory that is removed when the store closes.
Digest files use a configured two-character fanout directory and the complete lowercase digest as
their filename. Receipt storage keys always use `/` separators, while filesystem paths use the
host platform. Paths are derived only from validated digest bytes.

## Durable write order

Blob publication follows this order:

1. copy caller-owned bytes into an internal snapshot;
2. create missing blob directories and flush each parent directory where supported;
3. write and flush an exclusive temporary file in the destination fanout directory;
4. create the final name with an exclusive hard link so existing content is never replaced;
5. verify the final file, remove the temporary name, and flush the fanout directory;
6. commit blob metadata and a versioned storage receipt in one SQLite transaction.

The writer acquires the configured immediate SQLite transaction before filesystem publication.
The file still precedes its receipt, so a crash or database failure can leave an unregistered
filesystem object but cannot expose a receipt for missing bytes. Retrying equal content verifies
the existing object and commits the receipt. Lock-protected cleanup is documented in
[Blob orphan collection](./blob-orphan-collection.md).
Windows flushes file content but does not provide the directory-fsync operation used on supported
POSIX filesystems.

The configured root and fanout paths reject symlinks and non-directory ancestors. The blob root is
still a store-controlled directory: callers providing a custom root must prevent untrusted
processes from concurrently replacing its directories because portable Node filesystem APIs cannot
make an `openat`-style race-free guarantee for a shared writable root.

## Reads and integrity

`readBlob(id)` returns a fresh byte array only when registered metadata and the storage receipt
agree. It then verifies file type, byte length, and digest. Missing or corrupt registered content
throws `BlobIntegrityError`; partial metadata/receipt state also fails closed. An identifier returns
`undefined` only when neither metadata nor a receipt exists.

`verifyBlobs()` scans registered blob metadata and storage receipts in identifier order. Its
frozen report classifies `missing`, `size_mismatch`, `digest_mismatch`, `not_regular_file`, and
`receipt_mismatch` failures. It also detects receipts whose metadata row is absent. Unregistered
filesystem objects are intentionally invisible and are not treated as committed content.

## Schema

Store schema v2 adds `blobs` and `storage_receipts`. Version-one databases migrate without
rewriting semantic records or append receipts. Blob digest, layout, flush, receipt-version, and
migration constants are fail-closed protocol configuration pinned by the immutable compatibility
contract.

## Failure verification

Tests cover injected receipt-transaction failure, malformed and symlinked paths, mutable caller
buffers, corrupt files and metadata, and temporary-file cleanup. A child-process crash test holds
the SQLite write lock after publishing and flushing the filesystem object, then is killed before
receipt commit. Reopening proves the orphan is inspectable but invisible to registered reads, and
an equal retry recovers it without replacing its bytes.
