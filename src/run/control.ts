import { createCanonicalSnapshot } from "../canonical/snapshot.ts";
import { runProtocolConfig } from "../protocol/config.ts";
import {
    RUN_BUDGET_METRICS,
    RUN_CONTROL_REASON_TYPES,
    RUN_CONTROL_STATUSES,
} from "../protocol/values.generated.ts";
import { RunBudgetExhaustedError, RunCancelledError } from "./control-errors.ts";
import type {
    RunBudgetDefinition,
    RunBudgetExhaustionReason,
    RunConsumption,
    RunConsumptionDefinition,
    RunControl,
    RunControlOptions,
    RunControlReason,
    RunControlSnapshot,
    RunControlStatus,
} from "./control-types.ts";
import { readRunConsumption, readRunControlOptions } from "./control-validation.ts";

const [
    TURNS_METRIC,
    EFFECTS_METRIC,
    DURATION_METRIC,
    INPUT_TOKENS_METRIC,
    OUTPUT_TOKENS_METRIC,
    COST_METRIC,
] = RUN_BUDGET_METRICS;
const [BUDGET_EXHAUSTED_REASON_TYPE, CANCELLED_REASON_TYPE] = RUN_CONTROL_REASON_TYPES;
const [ACTIVE_STATUS, EXHAUSTED_STATUS, CANCELLED_STATUS] = RUN_CONTROL_STATUSES;

/**
 * Creates cooperative resource and cancellation control for one run.
 *
 * @param options - Per-run limits and an optional caller cancellation signal.
 * @returns A run control whose signal is passed through async execution boundaries.
 * @throws {TypeError} If options, budget limits, or the caller signal are malformed.
 *
 * @example
 * ```ts
 * const control = createRunControl({ budget: { maxTurns: 20 } });
 * control.consume({ turns: 1 });
 * await provider.invoke(request, control.signal);
 * control.dispose();
 * ```
 *
 * @public
 */
export function createRunControl(options: RunControlOptions): RunControl {
    return new DefaultRunControl(readRunControlOptions(options));
}

class DefaultRunControl implements RunControl {
    readonly #budget: RunBudgetDefinition;
    readonly #callerSignal: AbortSignal | undefined;
    readonly #controller = new AbortController();
    readonly #onCallerAbort: (() => void) | undefined;
    readonly #startedAt = performance.now();
    #consumed: RunConsumption = Object.freeze({
        costUsd: 0,
        effects: 0,
        inputTokens: 0,
        outputTokens: 0,
        turns: 0,
    });
    #reason: RunControlReason | null = null;
    #status: RunControlStatus = ACTIVE_STATUS;
    #timer: ReturnType<typeof setTimeout> | undefined;

    constructor(options: RunControlOptions) {
        this.#budget = options.budget;
        this.#callerSignal = options.signal;
        this.#onCallerAbort =
            options.signal === undefined
                ? undefined
                : () =>
                      this.#cancel(
                          runProtocolConfig.control.cancellationReason,
                          options.signal?.reason,
                      );
        if (options.signal?.aborted === true) {
            this.#onCallerAbort?.();
        } else if (this.#onCallerAbort !== undefined) {
            options.signal?.addEventListener("abort", this.#onCallerAbort, { once: true });
        }
        const durationLimit = options.budget.maxDurationMilliseconds;
        if (this.#status === ACTIVE_STATUS && durationLimit !== undefined) {
            this.#timer = setTimeout(() => this.#exhaustDuration(durationLimit), durationLimit + 1);
        }
    }

    /** Composed signal passed to providers, effects, and other async boundaries. */
    get signal(): AbortSignal {
        return this.#controller.signal;
    }

    /** Adds observed consumption and applies the first exceeded configured limit. */
    consume(consumption: RunConsumptionDefinition): RunControlSnapshot {
        this.#controller.signal.throwIfAborted();
        const increment = readRunConsumption(consumption);
        const next = Object.freeze({
            costUsd: addFinite(this.#consumed.costUsd, increment.costUsd, "costUsd"),
            effects: addInteger(this.#consumed.effects, increment.effects, "effects"),
            inputTokens: addInteger(
                this.#consumed.inputTokens,
                increment.inputTokens,
                "inputTokens",
            ),
            outputTokens: addInteger(
                this.#consumed.outputTokens,
                increment.outputTokens,
                "outputTokens",
            ),
            turns: addInteger(this.#consumed.turns, increment.turns, "turns"),
        });
        this.#consumed = next;
        const exhausted = firstExceededBudget(this.#budget, next);
        if (exhausted !== null) {
            this.#status = EXHAUSTED_STATUS;
            this.#reason = exhausted;
            this.#controller.abort(new RunBudgetExhaustedError(exhausted));
            this.#releaseResources();
        }
        return this.snapshot();
    }

    /** Cancels active control and releases its timer and caller-signal listener. */
    dispose(): void {
        this.#cancel(runProtocolConfig.control.disposalReason);
    }

    /** Returns an immutable snapshot without changing control state. */
    snapshot(): RunControlSnapshot {
        return createCanonicalSnapshot({
            consumed: this.#consumed,
            reason: this.#reason,
            status: this.#status,
        }) as RunControlSnapshot;
    }

    #cancel(message: string, cause?: unknown): void {
        if (this.#status !== ACTIVE_STATUS) {
            return;
        }
        this.#status = CANCELLED_STATUS;
        this.#reason = { message, type: CANCELLED_REASON_TYPE };
        this.#controller.abort(new RunCancelledError(message, cause));
        this.#releaseResources();
    }

    #exhaustDuration(limit: number): void {
        const reason: RunBudgetExhaustionReason = {
            limit,
            metric: DURATION_METRIC,
            observed: Math.max(performance.now() - this.#startedAt, limit + 1),
            type: BUDGET_EXHAUSTED_REASON_TYPE,
        };
        this.#status = EXHAUSTED_STATUS;
        this.#reason = reason;
        this.#controller.abort(new RunBudgetExhaustedError(reason));
        this.#releaseResources();
    }

    #releaseResources(): void {
        if (this.#onCallerAbort !== undefined) {
            this.#callerSignal?.removeEventListener("abort", this.#onCallerAbort);
        }
        if (this.#timer !== undefined) {
            clearTimeout(this.#timer);
            this.#timer = undefined;
        }
    }
}

function firstExceededBudget(
    budget: RunBudgetDefinition,
    consumed: RunConsumption,
): RunBudgetExhaustionReason | null {
    for (const [metric, limit, observed] of [
        [TURNS_METRIC, budget.maxTurns, consumed.turns],
        [EFFECTS_METRIC, budget.maxEffects, consumed.effects],
        [INPUT_TOKENS_METRIC, budget.maxInputTokens, consumed.inputTokens],
        [OUTPUT_TOKENS_METRIC, budget.maxOutputTokens, consumed.outputTokens],
        [COST_METRIC, budget.maxCostUsd, consumed.costUsd],
    ] as const) {
        if (limit !== undefined && observed > limit) {
            return {
                limit,
                metric,
                observed,
                type: BUDGET_EXHAUSTED_REASON_TYPE,
            };
        }
    }
    return null;
}

function addInteger(left: number, right: number, subject: string): number {
    const result = left + right;
    if (!Number.isSafeInteger(result)) {
        throw new TypeError(`run consumption ${subject} exceeds safe accounting bounds`);
    }
    return result;
}

function addFinite(left: number, right: number, subject: string): number {
    const result = left + right;
    if (!Number.isFinite(result)) {
        throw new TypeError(`run consumption ${subject} exceeds finite accounting bounds`);
    }
    return result;
}
