import { canonicalizeRecord, type SemanticValue } from "../canonical/canonical-record.ts";
import { runProtocolConfig } from "../protocol/config.ts";
import { RUN_TERMINAL_STATUSES } from "../protocol/values.generated.ts";
import { readTaskArtifactLock } from "../task/registry-codec.ts";
import type { RunOutcomeDefinition, RunTerminalDefinition, RunTerminalOutcome } from "./types.ts";
import { assertRunText, readRunDataObject } from "./validation-values.ts";

const [FINISHED_STATUS, FAILED_STATUS] = RUN_TERMINAL_STATUSES;

/** Validates an exact run-outcome definition without invoking accessors. @internal */
export function readRunOutcomeDefinition<O extends RunTerminalDefinition>(
    value: RunOutcomeDefinition<O>,
): RunOutcomeDefinition<O> {
    const fields = readRunDataObject(
        value,
        ["outcome", "runId", "taskArtifactLock"],
        "run outcome definition",
    );
    assertRunText(fields.runId, "runId");
    const taskArtifactLock = readTaskArtifactLock(fields.taskArtifactLock);
    const outcome = readTerminalDefinition(fields.outcome);
    return Object.freeze({
        outcome,
        runId: fields.runId,
        taskArtifactLock,
    }) as RunOutcomeDefinition<O>;
}

function readTerminalDefinition(value: unknown): RunTerminalOutcome {
    const candidate = readTerminalDataObject(value);
    if (!runProtocolConfig.terminalStatuses.includes(candidate.status as string)) {
        throw new TypeError("run terminal status is not configured");
    }
    if (candidate.status === FINISHED_STATUS) {
        const fields = readRunDataObject(value, ["status", "value"], "finished run outcome");
        assertSemanticValue(fields.value, "finished run value");
        return fields as RunTerminalOutcome;
    }
    if (candidate.status === FAILED_STATUS) {
        const keys =
            candidate.retryable === undefined
                ? ["errorType", "message", "status"]
                : ["errorType", "message", "retryable", "status"];
        const fields = readRunDataObject(value, keys, "failed run outcome");
        assertRunText(fields.errorType, "failed run errorType");
        assertRunText(fields.message, "failed run message");
        if (fields.retryable !== undefined && typeof fields.retryable !== "boolean") {
            throw new TypeError("failed run retryable must be a boolean when supplied");
        }
        return {
            error_type: fields.errorType,
            message: fields.message,
            retryable: fields.retryable ?? null,
            status: FAILED_STATUS,
        } as RunTerminalOutcome;
    }
    const fields = readRunDataObject(
        value,
        ["reason", "status"],
        `${candidate.status} run outcome`,
    );
    assertRunText(fields.reason, `${candidate.status} run reason`);
    return fields as RunTerminalOutcome;
}

function assertSemanticValue(value: unknown, subject: string): asserts value is SemanticValue {
    if (value === undefined) {
        throw new TypeError(`${subject} must be a canonical semantic value`);
    }
    try {
        canonicalizeRecord({ value: value as SemanticValue });
    } catch (error) {
        throw new TypeError(`${subject} must be a canonical semantic value`, { cause: error });
    }
}

function readTerminalDataObject(value: unknown): Record<string, unknown> {
    if (
        value === null ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        (Object.getPrototypeOf(value) !== Object.prototype &&
            Object.getPrototypeOf(value) !== null) ||
        Object.getOwnPropertySymbols(value).length > 0
    ) {
        throw new TypeError("run terminal outcome must be a plain data object");
    }
    const fields = Object.create(null) as Record<string, unknown>;
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
        if (!("value" in descriptor)) {
            throw new TypeError(`run terminal outcome ${key} must be a data property`);
        }
        fields[key] = descriptor.value;
    }
    return fields;
}
