import { effectProtocolConfig } from "../protocol/config.ts";
import { TraceStoreError } from "../store/errors.ts";

const errors = effectProtocolConfig.compensation.errors;

/**
 * Raised when retained or cited compensation evidence is absent, malformed, or inconsistent, or a
 * trigger exceeds the configured effect bound.
 *
 * @public
 */
export class EffectCompensationEvidenceError extends TraceStoreError {
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
        this.name = "EffectCompensationEvidenceError";
    }
}

/**
 * Raised before any compensation runs when a compensable effect that still needs compensation has
 * no registered handler for its exact kind.
 *
 * @public
 */
export class EffectCompensationHandlerNotFoundError extends TraceStoreError {
    /** Stable configuration-owned missing-handler code. */
    override readonly code = errors.handlerNotFoundCode;
    /** Compensation identity of the first unhandled effect. */
    readonly compensation_id: string;
    /** Exact effect kind without a registered handler. */
    readonly kind: string;

    /**
     * Creates a missing-handler failure.
     *
     * @param compensationId - Compensation identity of the unhandled effect.
     * @param kind - Exact effect kind without a handler.
     */
    constructor(compensationId: string, kind: string) {
        super(`${errors.handlerNotFoundMessage}: ${kind}`);
        this.name = "EffectCompensationHandlerNotFoundError";
        this.compensation_id = compensationId;
        this.kind = kind;
    }
}

/**
 * Raised after every effect of a trigger was attempted when at least one compensation handler
 * returned a failure result. The failures are retained; a later trigger attempts them again.
 *
 * @public
 */
export class EffectCompensationFailedError extends TraceStoreError {
    /** Stable configuration-owned failed-compensation code. */
    override readonly code = errors.failedCode;
    /** Compensation identities whose latest attempt failed, in compensation order. */
    readonly compensation_ids: readonly string[];

    /**
     * Creates a failed-compensation failure.
     *
     * @param compensationIds - Failed compensation identities in compensation order.
     */
    constructor(compensationIds: readonly string[]) {
        super(`${errors.failedMessage}: ${compensationIds.join(", ")}`);
        this.name = "EffectCompensationFailedError";
        this.compensation_ids = Object.freeze([...compensationIds]);
    }
}

/**
 * Raised when another compensator owns an active attempt, the path head changed, or this holder
 * expired or was replaced. Retry only after ownership is released or expired; external handlers
 * must remain idempotent under the stable materialization key.
 *
 * @public
 */
export class EffectCompensationConflictError extends TraceStoreError {
    /** Stable configuration-owned concurrent-advance code. */
    override readonly code = errors.conflictCode;
    /** Compensation identity that advanced concurrently. */
    readonly compensation_id: string;

    /**
     * Creates a concurrent-advance failure.
     *
     * @param compensationId - Compensation identity that advanced concurrently.
     */
    constructor(compensationId: string) {
        super(`${errors.conflictMessage}: ${compensationId}`);
        this.name = "EffectCompensationConflictError";
        this.compensation_id = compensationId;
    }
}
