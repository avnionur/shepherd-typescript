import type { SemanticValue } from "../canonical/canonical-record.ts";
import type { ProviderDescriptor } from "../provider/types.ts";
import { readProviderDescriptor } from "../provider/validation.ts";
import type { TaskSchema } from "../task/schema.ts";
import type { TaskExecutionOptions } from "./execution-types.ts";
import { readTaskExecutionOptions } from "./execution-validation.ts";
import { assertRunText } from "./validation-values.ts";

/** Validated immutable inputs shared by transient and durable execution. @internal */
export type PreparedTaskExecution<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>> = {
    /** Closed validated execution options. */
    readonly definition: TaskExecutionOptions<I, O>;
    /** Canonical input parsed by the authenticated task schema. */
    readonly input: SemanticValue;
    /** Immutable validated provider identity. */
    readonly provider: ProviderDescriptor;
};

/** Validates and snapshots execution inputs before any execution side effect. @internal */
export function prepareTaskExecution<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>>(
    options: TaskExecutionOptions<I, O>,
): PreparedTaskExecution<I, O> {
    const definition = readTaskExecutionOptions(options);
    assertRunText(definition.runId, "runId");
    return Object.freeze({
        definition,
        input: normalizeTaskValue(definition.task.parseInput(definition.input)),
        provider: readProviderDescriptor(definition.provider.descriptor()),
    });
}

/** Normalizes schema-level void into canonical null. @internal */
export function normalizeTaskValue(value: unknown): SemanticValue {
    return value === undefined ? null : (value as SemanticValue);
}
