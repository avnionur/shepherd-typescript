import { publicErrorCodes } from "../errors/public-errors.ts";
import type { RunBudgetExhaustionReason } from "./control-types.ts";

/** Error carried by a run-control signal after budget exhaustion. */
export class RunBudgetExhaustedError extends Error {
    /** Stable configured machine-readable budget-exhaustion code. */
    readonly code = publicErrorCodes.runs.budgetExhausted;
    /** Configured limit that was exceeded. */
    readonly limit: number;
    /** First configured metric that exceeded its limit. */
    readonly metric: RunBudgetExhaustionReason["metric"];
    /** Aggregate value observed at exhaustion. */
    readonly observed: number;

    /**
     * Creates an error from a structured exhaustion reason.
     *
     * @param reason - Exhausted metric, configured limit, and observed aggregate.
     */
    constructor(reason: RunBudgetExhaustionReason) {
        super(formatRunBudgetExhaustionReason(reason));
        this.name = "RunBudgetExhaustedError";
        this.limit = reason.limit;
        this.metric = reason.metric;
        this.observed = reason.observed;
    }
}

/** Formats the stable terminal description for one budget exhaustion. @internal */
export function formatRunBudgetExhaustionReason(reason: RunBudgetExhaustionReason): string {
    return `run budget exceeded: ${reason.metric} ${reason.observed} > ${reason.limit}`;
}

/** Error carried by a run-control signal after cancellation. */
export class RunCancelledError extends Error {
    /** Stable configured machine-readable cancellation code. */
    readonly code = publicErrorCodes.runs.cancelled;
    /**
     * Creates a stable cancellation error while retaining the caller's reason as its cause.
     *
     * @param message - Stable inspectable cancellation explanation.
     * @param cause - Optional original caller-signal reason.
     */
    constructor(message: string, cause?: unknown) {
        super(message, { cause });
        this.name = "RunCancelledError";
    }
}
