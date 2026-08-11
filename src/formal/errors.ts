/** Raised when normalized typed-effect records violate the executable Core-A lifecycle. */
export class TypedEffectTraceValidationError extends Error {
    /**
     * Creates a typed-effect trace validation failure.
     *
     * @param message - Stable diagnostic describing the rejected lifecycle obligation.
     */
    constructor(message: string) {
        super(message);
        this.name = "TypedEffectTraceValidationError";
    }
}

/**
 * Raised internally when evidence cannot support a requested strong claim.
 *
 * @internal
 */
export class StrongProofEvidenceValidationError extends Error {
    /**
     * Creates a strong proof-evidence validation failure.
     *
     * @param message - Stable diagnostic describing the rejected evidence obligation.
     */
    constructor(message: string) {
        super(message);
        this.name = "StrongProofEvidenceValidationError";
    }
}
