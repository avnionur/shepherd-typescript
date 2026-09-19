import { publicErrorCodes } from "../errors/public-errors.ts";

/**
 * Raised when a redacted trace archive is malformed, inconsistent with the retention policy, or
 * offered to a native archive import.
 *
 * Redacted archives are one-way exports: they never re-enter a trace store. The message names
 * the failed structure or record index and never contains a record body or matched secret.
 *
 * @public
 */
export class RedactedTraceArchiveError extends TypeError {
    /** Stable configured machine-readable redacted-archive code. */
    readonly code = publicErrorCodes.trace.redactedArchive;
}
