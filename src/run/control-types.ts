import type {
    RUN_BUDGET_METRICS,
    RUN_CONTROL_REASON_TYPES,
    RUN_CONTROL_STATUSES,
} from "../protocol/values.generated.ts";

/** Configured metric that can exhaust a run budget. */
export type RunBudgetMetric = (typeof RUN_BUDGET_METRICS)[number];

/** Optional limits applied by {@link createRunControl}. */
export type RunBudgetDefinition = {
    /** Maximum aggregate cost in US dollars. */
    readonly maxCostUsd?: number;
    /** Maximum elapsed execution duration. */
    readonly maxDurationMilliseconds?: number;
    /** Maximum effects admitted by the run. */
    readonly maxEffects?: number;
    /** Maximum aggregate input tokens. */
    readonly maxInputTokens?: number;
    /** Maximum aggregate output tokens. */
    readonly maxOutputTokens?: number;
    /** Maximum provider or task turns. */
    readonly maxTurns?: number;
};

/** Incremental resource consumption admitted by {@link RunControl.consume}. */
export type RunConsumptionDefinition = {
    /** Additional cost in US dollars. */
    readonly costUsd?: number;
    /** Additional effects. */
    readonly effects?: number;
    /** Additional input tokens. */
    readonly inputTokens?: number;
    /** Additional output tokens. */
    readonly outputTokens?: number;
    /** Additional provider or task turns. */
    readonly turns?: number;
};

/** Aggregate resource consumption observed by a run control. */
export type RunConsumption = {
    /** Aggregate cost in US dollars. */
    readonly costUsd: number;
    /** Aggregate effects. */
    readonly effects: number;
    /** Aggregate input tokens. */
    readonly inputTokens: number;
    /** Aggregate output tokens. */
    readonly outputTokens: number;
    /** Aggregate provider or task turns. */
    readonly turns: number;
};

/** Structured reason for budget exhaustion. */
export type RunBudgetExhaustionReason = {
    /** Configured maximum for the exhausted metric. */
    readonly limit: number;
    /** First configured metric whose limit was exceeded. */
    readonly metric: RunBudgetMetric;
    /** Aggregate value observed after admitting the triggering consumption. */
    readonly observed: number;
    /** Budget-exhaustion reason discriminant. */
    readonly type: (typeof RUN_CONTROL_REASON_TYPES)[0];
};

/** Structured reason for external or disposal cancellation. */
export type RunCancellationReason = {
    /** Stable inspectable cancellation explanation. */
    readonly message: string;
    /** Cancellation reason discriminant. */
    readonly type: (typeof RUN_CONTROL_REASON_TYPES)[1];
};

/** One terminal reason retained by a run control snapshot. */
export type RunControlReason = RunBudgetExhaustionReason | RunCancellationReason;

/** Configured lifecycle status of a run control. */
export type RunControlStatus = (typeof RUN_CONTROL_STATUSES)[number];

/** Immutable observable state of a run control. */
export type RunControlSnapshot = {
    /** Aggregate consumption observed so far. */
    readonly consumed: RunConsumption;
    /** Terminal reason, or `null` while active. */
    readonly reason: RunControlReason | null;
    /** Current active, exhausted, or cancelled status. */
    readonly status: RunControlStatus;
};

/** Options accepted by {@link createRunControl}. */
export type RunControlOptions = {
    /** Per-run resource limits. */
    readonly budget: RunBudgetDefinition;
    /** Optional caller-owned cancellation signal. */
    readonly signal?: AbortSignal;
};

/** Cooperative resource and cancellation control for one run. */
export type RunControl = {
    /** Composed signal passed to providers, effects, and other async boundaries. */
    readonly signal: AbortSignal;
    /**
     * Adds observed consumption and applies the first exceeded configured limit.
     *
     * @param consumption - Non-negative resource increments.
     * @returns The immutable state after admitting the increments.
     * @throws {TypeError} If the increments are malformed or overflow safe accounting.
     * @throws {RunBudgetExhaustedError} If control was already exhausted.
     * @throws {RunCancelledError} If control was already cancelled.
     */
    consume(consumption: RunConsumptionDefinition): RunControlSnapshot;
    /**
     * Cancels active control and releases its timer and caller-signal listener.
     *
     * @returns Nothing.
     */
    dispose(): void;
    /**
     * Returns an immutable snapshot without changing control state.
     *
     * @returns Current aggregate consumption, lifecycle status, and terminal reason.
     */
    snapshot(): RunControlSnapshot;
};
