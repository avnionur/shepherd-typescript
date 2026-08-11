import { createCanonicalSnapshot } from "../canonical/snapshot.ts";
import { runProtocolConfig } from "../protocol/config.ts";
import {
    RUN_BUDGET_METRICS,
    RUN_CONTROL_REASON_TYPES,
    RUN_CONTROL_STATUSES,
} from "../protocol/values.generated.ts";
import type {
    RunBudgetDefinition,
    RunBudgetMetric,
    RunConsumption,
    RunConsumptionDefinition,
    RunControlOptions,
    RunControlSnapshot,
    RunControlStatus,
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
const [ACTIVE_STATUS, EXHAUSTED_STATUS] = RUN_CONTROL_STATUSES;
const [BUDGET_EXHAUSTED_TYPE, CANCELLED_TYPE] = RUN_CONTROL_REASON_TYPES;

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

/** Validates and snapshots one exact persisted run-control state. @internal */
export function readRunControlSnapshot(value: unknown): RunControlSnapshot {
    const fields = readRunDataObject(
        value,
        ["consumed", "reason", "status"],
        "run control snapshot",
    );
    const consumedFields = readRunDataObject(
        fields.consumed,
        CONSUMPTION_KEYS,
        "run control snapshot consumed",
    );
    const consumed = readRunConsumption(consumedFields);
    if (!runProtocolConfig.control.statuses.includes(fields.status as string)) {
        throw new TypeError("run control snapshot status is not configured");
    }
    let reason: RunControlSnapshot["reason"];
    if (fields.status === ACTIVE_STATUS) {
        if (fields.reason !== null) {
            throw new TypeError("active run control snapshot reason must be null");
        }
        reason = null;
    } else if (fields.status === EXHAUSTED_STATUS) {
        const reasonFields = readRunDataObject(
            fields.reason,
            ["limit", "metric", "observed", "type"],
            "exhausted run control reason",
        );
        if (
            reasonFields.type !== BUDGET_EXHAUSTED_TYPE ||
            !RUN_BUDGET_METRICS.includes(reasonFields.metric as never)
        ) {
            throw new TypeError("exhausted run control reason is not configured");
        }
        reason = {
            limit: readNonNegativeFinite(reasonFields.limit, "run control reason limit"),
            metric: reasonFields.metric as RunBudgetMetric,
            observed: readNonNegativeFinite(reasonFields.observed, "run control reason observed"),
            type: BUDGET_EXHAUSTED_TYPE,
        } as RunControlSnapshot["reason"];
    } else {
        const reasonFields = readRunDataObject(
            fields.reason,
            ["message", "type"],
            "cancelled run control reason",
        );
        if (
            reasonFields.type !== CANCELLED_TYPE ||
            typeof reasonFields.message !== "string" ||
            reasonFields.message.length === 0 ||
            /[\uD800-\uDFFF]/u.test(reasonFields.message)
        ) {
            throw new TypeError("cancelled run control reason is malformed");
        }
        reason = { message: reasonFields.message, type: CANCELLED_TYPE };
    }
    return createCanonicalSnapshot({
        consumed,
        reason,
        status: fields.status as RunControlStatus,
    }) as RunControlSnapshot;
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
