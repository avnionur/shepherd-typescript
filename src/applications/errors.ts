import { applicationsProtocolConfig } from "../protocol/config.ts";
import { TraceStoreError } from "../store/errors.ts";

const errors = applicationsProtocolConfig.errors;

/**
 * Raised when an application protocol definition is malformed, names an unsupported kind or
 * surface, lacks a surface the application requires, or differs from the retained manifest's
 * protocol identity.
 *
 * @public
 */
export class ApplicationProtocolError extends TraceStoreError {
    /** Stable configuration-owned protocol code. */
    override readonly code = errors.protocolCode;

    /**
     * Creates a protocol failure.
     *
     * @param detail - Specific description appended to the configured message.
     * @param options - Optional in-memory cause retained for diagnostics.
     */
    constructor(detail: string, options?: ErrorOptions) {
        super(`${errors.protocolMessage}: ${detail}`, options);
    }
}

/**
 * Raised before an application call that would exceed a configured protocol budget or bound.
 *
 * Retained evidence up to the refusal stays; nothing is written by the refusal.
 *
 * @public
 */
export class ApplicationBudgetError extends TraceStoreError {
    /** Stable configuration-owned budget code. */
    override readonly code = errors.budgetCode;

    /**
     * Creates a budget failure.
     *
     * @param detail - Specific description appended to the configured message.
     */
    constructor(detail: string) {
        super(`${errors.budgetMessage}: ${detail}`);
    }
}

/**
 * Raised when retained or supplied application evidence is absent, malformed, or inconsistent.
 *
 * @public
 */
export class ApplicationEvidenceError extends TraceStoreError {
    /** Stable configuration-owned invalid-evidence code. */
    override readonly code = errors.evidenceCode;

    /**
     * Creates an invalid-evidence failure.
     *
     * @param detail - Specific description appended to the configured message.
     * @param options - Optional in-memory cause retained for diagnostics.
     */
    constructor(detail: string, options?: ErrorOptions) {
        super(`${errors.evidenceMessage}: ${detail}`, options);
    }
}

/**
 * Raised when an application verifier or evaluator rejects a produced candidate or cannot run.
 *
 * @public
 */
export class ApplicationVerificationError extends TraceStoreError {
    /** Stable configuration-owned verification code. */
    override readonly code = errors.verificationCode;

    /**
     * Creates a verification failure.
     *
     * @param detail - Specific description appended to the configured message.
     * @param options - Optional in-memory cause retained for diagnostics.
     */
    constructor(detail: string, options?: ErrorOptions) {
        super(`${errors.verificationMessage}: ${detail}`, options);
    }
}
