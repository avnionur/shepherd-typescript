import { publicErrorCodes } from "../errors/public-errors.ts";
import type { STORE_BACKUP_FAILURE_REASONS } from "../protocol/values.generated.ts";

/**
 * Configured classification of a refused or failed backup, verification, or restore.
 *
 * `backup-unsupported`: the runtime has no `node:sqlite` online backup. `destination-exists` /
 * `target-exists`: the operation refused to write over an existing path. `manifest-missing`: no
 * complete manifest exists, so the backup is incomplete or interrupted. `manifest-invalid`,
 * `manifest-mismatch`: the manifest is malformed or is not the expected identity.
 * `schema-unsupported`: the copied store schema is newer than this package supports.
 * `database-mismatch`, `blob-mismatch`, `integrity-failed`, `export-mismatch`: copied bytes or the
 * reopened store disagree with the manifest.
 */
export type TraceStoreBackupFailureReason = (typeof STORE_BACKUP_FAILURE_REASONS)[number];

/**
 * Raised when a trace-store backup, backup verification, replication, fetch, or restore is
 * refused or fails.
 *
 * Every failure carries one configured `reason`. An operation that raises this error has not
 * produced a verified backup or restored store, and no caller should treat any path it touched
 * as one. The message names the failed step, never record bodies.
 *
 * @public
 */
export class TraceStoreBackupError extends Error {
    /** Stable configured machine-readable backup code. */
    readonly code = publicErrorCodes.trace.backup;
    /** Configured failure classification. */
    readonly reason: TraceStoreBackupFailureReason;

    /**
     * Creates one classified backup failure.
     *
     * @param reason - Configured failure classification.
     * @param message - Step that failed, without record content.
     * @param options - Optional underlying cause.
     */
    constructor(reason: TraceStoreBackupFailureReason, message: string, options?: ErrorOptions) {
        super(message, options);
        this.reason = reason;
    }
}
