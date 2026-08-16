import type { RunUsageDefinition } from "./usage-types.ts";
import { assertRunText, readRunDataObject } from "./validation-values.ts";

/** Validates one exact aggregate run-usage definition. @internal */
export function readRunUsageDefinition(value: RunUsageDefinition): RunUsageDefinition {
    const fields = readRunDataObject(
        value,
        [
            "cacheCreationInputTokens",
            "cacheReadInputTokens",
            "inputTokens",
            "outputTokens",
            "runId",
        ],
        "run usage definition",
        ["costUsd"],
    );
    assertRunText(fields.runId, "run usage runId");
    assertTokenCount(fields.inputTokens, "run usage inputTokens");
    assertTokenCount(fields.outputTokens, "run usage outputTokens");
    assertTokenCount(fields.cacheCreationInputTokens, "run usage cacheCreationInputTokens");
    assertTokenCount(fields.cacheReadInputTokens, "run usage cacheReadInputTokens");
    if (
        fields.costUsd !== undefined &&
        (typeof fields.costUsd !== "number" ||
            !Number.isFinite(fields.costUsd) ||
            fields.costUsd < 0)
    ) {
        throw new TypeError("run usage costUsd must be a non-negative finite number when supplied");
    }
    return fields as RunUsageDefinition;
}

function assertTokenCount(value: unknown, subject: string): asserts value is number {
    if (!Number.isSafeInteger(value)) {
        throw new TypeError(`${subject} must be a non-negative safe integer`);
    }
    if ((value as number) < 0) {
        throw new TypeError(`${subject} must be a non-negative safe integer`);
    }
}
