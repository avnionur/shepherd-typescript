import { runProtocolConfig } from "../protocol/config.ts";
import type {
    RunBudgetDefinition,
    RunConsumption,
    RunConsumptionDefinition,
    RunControlOptions,
} from "./control-types.ts";
import { readRunDataObject } from "./validation-values.ts";

const BUDGET_KEYS = [
    "maxCostUsd",
    "maxDurationMilliseconds",
    "maxEffects",
    "maxInputTokens",
    "maxOutputTokens",
    "maxTurns",
] as const;
const CONSUMPTION_KEYS = ["costUsd", "effects", "inputTokens", "outputTokens", "turns"] as const;

/** Validates and snapshots exact run-control options. @internal */
export function readRunControlOptions(value: RunControlOptions): RunControlOptions {
    const fields = readRunDataObject(value, ["budget"], "run control options", ["signal"]);
    const budget = readBudget(fields.budget);
    if (fields.signal !== undefined && !(fields.signal instanceof AbortSignal)) {
        throw new TypeError("run control signal must be an AbortSignal when supplied");
    }
    return Object.freeze({ budget, signal: fields.signal }) as RunControlOptions;
}

/** Validates and normalizes exact incremental run consumption. @internal */
export function readRunConsumption(value: RunConsumptionDefinition): RunConsumption {
    const fields = readRunDataObject(value, [], "run consumption", CONSUMPTION_KEYS);
    return Object.freeze({
        costUsd: readNonNegativeFinite(fields.costUsd ?? 0, "run consumption costUsd"),
        effects: readNonNegativeInteger(fields.effects ?? 0, "run consumption effects"),
        inputTokens: readNonNegativeInteger(fields.inputTokens ?? 0, "run consumption inputTokens"),
        outputTokens: readNonNegativeInteger(
            fields.outputTokens ?? 0,
            "run consumption outputTokens",
        ),
        turns: readNonNegativeInteger(fields.turns ?? 0, "run consumption turns"),
    });
}

function readBudget(value: unknown): RunBudgetDefinition {
    const fields = readRunDataObject(value, [], "run budget", BUDGET_KEYS);
    const maxDurationMilliseconds = readOptionalPositiveInteger(
        fields.maxDurationMilliseconds,
        "run budget maxDurationMilliseconds",
    );
    if (
        maxDurationMilliseconds !== undefined &&
        maxDurationMilliseconds > runProtocolConfig.control.maxTimerDurationMilliseconds
    ) {
        throw new TypeError("run budget maxDurationMilliseconds exceeds configured timer bounds");
    }
    const limits = Object.create(null) as Record<string, number>;
    for (const [key, limit] of [
        ["maxCostUsd", readOptionalNonNegativeFinite(fields.maxCostUsd, "run budget maxCostUsd")],
        ["maxDurationMilliseconds", maxDurationMilliseconds],
        ["maxEffects", readOptionalNonNegativeInteger(fields.maxEffects, "run budget maxEffects")],
        [
            "maxInputTokens",
            readOptionalNonNegativeInteger(fields.maxInputTokens, "run budget maxInputTokens"),
        ],
        [
            "maxOutputTokens",
            readOptionalNonNegativeInteger(fields.maxOutputTokens, "run budget maxOutputTokens"),
        ],
        ["maxTurns", readOptionalNonNegativeInteger(fields.maxTurns, "run budget maxTurns")],
    ] as const) {
        if (limit !== undefined) {
            limits[key] = limit;
        }
    }
    return Object.freeze(limits) as RunBudgetDefinition;
}

function readOptionalNonNegativeInteger(value: unknown, subject: string): number | undefined {
    return value === undefined ? undefined : readNonNegativeInteger(value, subject);
}

function readOptionalPositiveInteger(value: unknown, subject: string): number | undefined {
    const result = readOptionalNonNegativeInteger(value, subject);
    if (result === 0) {
        throw new TypeError(`${subject} must be positive when supplied`);
    }
    return result;
}

function readNonNegativeInteger(value: unknown, subject: string): number {
    if (!Number.isSafeInteger(value) || (value as number) < 0) {
        throw new TypeError(`${subject} must be a non-negative safe integer`);
    }
    return value as number;
}

function readOptionalNonNegativeFinite(value: unknown, subject: string): number | undefined {
    return value === undefined ? undefined : readNonNegativeFinite(value, subject);
}

function readNonNegativeFinite(value: unknown, subject: string): number {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        throw new TypeError(`${subject} must be a non-negative finite number`);
    }
    return value;
}
