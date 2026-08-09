import { canonicalizeRecord, type SemanticValue } from "../canonical/canonical-record.ts";
import { runProtocolConfig } from "../protocol/config.ts";
import { RUN_TERMINAL_STATUSES } from "../protocol/values.generated.ts";
import { readTaskArtifactLock } from "../task/registry-codec.ts";
import type { RunOutcomeDefinition, RunTerminalDefinition, RunTerminalOutcome } from "./types.ts";

const [FINISHED_STATUS, FAILED_STATUS] = RUN_TERMINAL_STATUSES;

/** Validates an exact run-outcome definition without invoking accessors. @internal */
export function readRunOutcomeDefinition<O extends RunTerminalDefinition>(
    value: RunOutcomeDefinition<O>,
): RunOutcomeDefinition<O> {
    const fields = readDataObject(
        value,
        ["outcome", "runId", "taskArtifactLock"],
        "run outcome definition",
    );
    assertText(fields.runId, "runId");
    const taskArtifactLock = readTaskArtifactLock(fields.taskArtifactLock);
    const outcome = readTerminalDefinition(fields.outcome);
    return Object.freeze({
        outcome,
        runId: fields.runId,
        taskArtifactLock,
    }) as RunOutcomeDefinition<O>;
}

function readTerminalDefinition(value: unknown): RunTerminalOutcome {
    const candidate = readDataObjectWithKnownShape(value, "run terminal outcome");
    if (!runProtocolConfig.terminalStatuses.includes(candidate.status as string)) {
        throw new TypeError("run terminal status is not configured");
    }
    if (candidate.status === FINISHED_STATUS) {
        const fields = readExactFields(candidate, ["status", "value"], "finished run outcome");
        assertSemanticValue(fields.value, "finished run value");
        return fields as RunTerminalOutcome;
    }
    if (candidate.status === FAILED_STATUS) {
        const keys =
            candidate.retryable === undefined
                ? ["errorType", "message", "status"]
                : ["errorType", "message", "retryable", "status"];
        const fields = readExactFields(candidate, keys, "failed run outcome");
        assertText(fields.errorType, "failed run errorType");
        assertText(fields.message, "failed run message");
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
    const fields = readExactFields(
        candidate,
        ["reason", "status"],
        `${candidate.status} run outcome`,
    );
    assertText(fields.reason, `${candidate.status} run reason`);
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

function assertText(value: unknown, subject: string): asserts value is string {
    if (typeof value !== "string" || value.length === 0 || /[\uD800-\uDFFF]/u.test(value)) {
        throw new TypeError(`${subject} must be a non-empty well-formed string`);
    }
}

function readDataObject(value: unknown, keys: readonly string[], subject: string) {
    return readExactFields(readDataObjectWithKnownShape(value, subject), keys, subject);
}

function readDataObjectWithKnownShape(value: unknown, subject: string): Record<string, unknown> {
    if (
        value === null ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        (Object.getPrototypeOf(value) !== Object.prototype &&
            Object.getPrototypeOf(value) !== null) ||
        Object.getOwnPropertySymbols(value).length > 0
    ) {
        throw new TypeError(`${subject} must be a plain data object`);
    }
    const fields = Object.create(null) as Record<string, unknown>;
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
        if (!("value" in descriptor)) {
            throw new TypeError(`${subject} ${key} must be a data property`);
        }
        fields[key] = descriptor.value;
    }
    return fields;
}

function readExactFields(
    fields: Record<string, unknown>,
    keys: readonly string[],
    subject: string,
): Record<string, unknown> {
    if (Object.keys(fields).sort().join("\0") !== [...keys].sort().join("\0")) {
        throw new TypeError(`${subject} must contain exactly its declared fields`);
    }
    return fields;
}
