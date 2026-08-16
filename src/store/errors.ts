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

/**
 * Raised when a trace slice cannot satisfy a projection's declared requirements.
 *
 * @public
 */
export class ProjectionCompatibilityError extends TypeError {}

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

import { workspaceProtocolConfig } from "../protocol/config.ts";
