import { publicErrorCodes } from "../errors/public-errors.ts";
import { workspaceProtocolConfig } from "../protocol/config.ts";

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
 * Raised when a database schema is newer than this package supports.
 *
 * @public
 */
export class UnsupportedStoreSchemaError extends TraceStoreError {
    /** Stable configured machine-readable unsupported-schema code. */
    override readonly code = publicErrorCodes.trace.schemaUnsupported;
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
