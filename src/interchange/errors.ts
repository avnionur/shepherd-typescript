import { publicErrorCodes } from "../errors/public-errors.ts";

/**
 * Raised when a native or redacted trace archive exceeds a configured interchange limit
 * (`kernel.interchange.limits` in `protocol.config.json`).
 *
 * Byte length and nesting depth are checked before the text is parsed, and collection counts and
 * the declared blob byte total before any blob is decoded, so an oversized archive is refused
 * without building its object graph or its blob buffers. Nothing is written. The message names
 * the limit and the configured bound, never archive content.
 *
 * @public
 */
export class TraceArchiveLimitError extends TypeError {
    /** Stable configured machine-readable archive-limit code. */
    readonly code = publicErrorCodes.trace.archiveLimit;
    /** Name of the exceeded `kernel.interchange.limits` member, for example `maxArchiveBytes`. */
    readonly limit: string;

    /**
     * Creates a refusal for one exceeded configured limit.
     *
     * @param limit - Name of the exceeded `kernel.interchange.limits` member.
     * @param bound - Configured bound that was exceeded.
     */
    constructor(limit: string, bound: number) {
        super(`trace archive exceeds the configured ${limit} limit of ${bound}`);
        this.limit = limit;
    }
}
