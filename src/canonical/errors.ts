import { publicErrorCodes } from "../errors/public-errors.ts";

/**
 * Raised when a canonical value nests arrays and objects deeper than the configured bound
 * (`kernel.canonicalization.maxNestingDepth` in `protocol.config.json`).
 *
 * The depth is counted while descending, before the encoder enters the next container, so the
 * refusal is the same at every call-site stack depth and JIT state: a value at the bound is
 * accepted and one level deeper is refused. Record appends, archive imports, and archive decoding
 * refuse before anything is written. The message names the limit and the configured bound, never
 * value content or key paths. It is a `TypeError`, the documented class for unsupported canonical
 * input.
 *
 * @example
 * ```ts
 * try {
 *     canonicalizeRecord(untrusted);
 * } catch (error) {
 *     if (error instanceof CanonicalNestingLimitError) console.error(error.code, error.bound);
 * }
 * ```
 *
 * @public
 */
export class CanonicalNestingLimitError extends TypeError {
    /** Stable configured machine-readable canonical nesting-limit code. */
    readonly code = publicErrorCodes.canonical.nestingLimit;
    /** Configured maximum nesting depth that the value exceeded. */
    readonly bound: number;

    /**
     * Creates a refusal for a value nested deeper than the configured bound.
     *
     * @param bound - Configured maximum nesting depth that was exceeded.
     */
    constructor(bound: number) {
        super(`canonical value exceeds the configured maxNestingDepth limit of ${bound}`);
        this.bound = bound;
    }
}
