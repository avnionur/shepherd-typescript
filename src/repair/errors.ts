import type { OrphanRepairErrorCode } from "./types.ts";

/** Stable failure raised by explicit orphaned-operation repair. */
export class OrphanRepairError extends Error {
    /** Stable configured machine-readable failure code. */
    readonly code: OrphanRepairErrorCode;

    /**
     * Creates one typed repair failure.
     *
     * @param code - Stable configured machine-readable failure code.
     * @param message - Safe configured remediation message.
     * @param options - Optional standard error cause.
     */
    constructor(code: OrphanRepairErrorCode, message: string, options?: ErrorOptions) {
        super(message, options);
        this.code = code;
    }
}
