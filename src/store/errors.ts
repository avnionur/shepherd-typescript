/**
 * Base error for trace-store contract violations.
 *
 * @public
 */
export class TraceStoreError extends Error {}

/**
 * Raised when an append intent is replayed with different semantic content.
 *
 * @public
 */
export class AppendIntentConflictError extends TraceStoreError {}

/**
 * Raised when a database schema is newer than this package supports.
 *
 * @public
 */
export class UnsupportedStoreSchemaError extends TraceStoreError {}

/**
 * Raised when durable blob bytes disagree with their storage receipt.
 *
 * @public
 */
export class BlobIntegrityError extends TraceStoreError {}
