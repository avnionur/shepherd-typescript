import { publicErrorCodes } from "../errors/public-errors.ts";
import { workspaceProtocolConfig } from "../protocol/config.ts";
import type { SecretFinding, SecretScanReport } from "../retention/secret-scan.ts";

/**
 * Base error for trace-store contract violations.
 *
 * @public
 */
export class TraceStoreError extends Error {
    /** Stable configured machine-readable trace-store error code. */
    readonly code = publicErrorCodes.trace.store;
}

/**
 * Raised when an append intent is replayed with different semantic content.
 *
 * @public
 */
export class AppendIntentConflictError extends TraceStoreError {
    /** Stable configured machine-readable append-conflict code. */
    override readonly code = publicErrorCodes.trace.appendIntentConflict;
}

/**
 * Raised when a store opened with `secretScanning: "refuse"` rejects an append or import whose
 * record bodies match a configured secret detector.
 *
 * The refusal happens before any write, so the append intent stays unused and a corrected retry
 * with the same intent succeeds. The message and {@link TraceSecretDetectedError.findings} name
 * secret classes, JSON Pointers, and digests only; matched text is never included.
 *
 * @public
 */
export class TraceSecretDetectedError extends TraceStoreError {
    /** Stable configured machine-readable secret-detection code. */
    override readonly code = publicErrorCodes.trace.secretDetected;
    /** Frozen findings: class, pointer, location, and digest of each match. */
    readonly findings: readonly SecretFinding[];
    /** Whether more findings existed than the configured limit allows. */
    readonly truncated: boolean;

    /**
     * Creates a refusal from a completed scan report.
     *
     * @param report - Findings produced by the configured detectors.
     */
    constructor(report: SecretScanReport) {
        super(
            `trace store refused ${report.findings.length}${report.truncated ? "+" : ""} configured secret finding(s) of class ${report.secret_classes.join(", ")} at ${report.findings.map(({ path }) => path).join(", ")}`,
        );
        this.findings = report.findings;
        this.truncated = report.truncated;
    }
}

/**
 * Raised when a database schema is newer than this package supports.
 *
 * @public
 */
export class UnsupportedStoreSchemaError extends TraceStoreError {
    /** Stable configured machine-readable unsupported-schema code. */
    override readonly code = publicErrorCodes.trace.schemaUnsupported;
}

/**
 * Raised when an operation that requires a writable handle, such as store maintenance, is
 * requested on a store opened with `readOnly: true`. Nothing is read or changed.
 *
 * @public
 */
export class TraceStoreReadOnlyError extends TraceStoreError {
    /** Stable configured machine-readable read-only refusal code. */
    override readonly code = publicErrorCodes.trace.readOnly;
}

/**
 * Raised when durable blob bytes disagree with their storage receipt.
 *
 * @public
 */
export class BlobIntegrityError extends TraceStoreError {
    /** Stable configured machine-readable blob-integrity code. */
    override readonly code = publicErrorCodes.trace.blobIntegrity;
}

/**
 * Raised when a trace slice cannot satisfy a projection's declared requirements.
 *
 * @public
 */
export class ProjectionCompatibilityError extends TypeError {
    /** Stable configured machine-readable projection-compatibility code. */
    readonly code = publicErrorCodes.trace.projectionCompatibility;
}

/** Raised when an exact retained-world settlement request conflicts with durable authority. */
export class RetainedWorldSettlementConflictError extends TraceStoreError {
    /** Stable configured settlement-conflict code. */
    readonly code = workspaceProtocolConfig.settlement.errors.conflictCode;
}

/** Raised when retained-world settlement evidence is malformed or inconsistent. */
export class RetainedWorldSettlementInvalidError extends TraceStoreError {
    /** Stable configured invalid-settlement code. */
    readonly code = workspaceProtocolConfig.settlement.errors.invalidCode;
}
