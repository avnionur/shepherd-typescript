import { publicErrorCodes } from "../errors/public-errors.ts";

/**
 * Raised when a reference storage adapter cannot honor its contract: it is closed, its retained
 * state is corrupt, or its schema is newer than this package supports.
 *
 * Ordinary input validation failures remain `TypeError` values, and compare-and-swap conflicts,
 * held leases, and stale fences are result statuses, not errors.
 *
 * @public
 */
export class StorageAdapterError extends Error {
    /** Stable configured machine-readable storage-adapter code. */
    readonly code = publicErrorCodes.storage.adapter;
}

/**
 * Raised when a blob-store `put` offers bytes whose content-addressed identity differs from the
 * requested blob identifier, or when stored bytes for an identifier disagree with it.
 *
 * The refused write changes nothing: an existing object is never replaced.
 *
 * @public
 */
export class StorageBlobContentMismatchError extends StorageAdapterError {
    /** Stable configured machine-readable blob-content mismatch code. */
    override readonly code = publicErrorCodes.storage.blobContentMismatch;
}
