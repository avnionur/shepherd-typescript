import { assertTaskDescriptor } from "../task/descriptor.ts";
import type { TaskSchema } from "../task/schema.ts";
import { readRunControlOptions } from "./control-validation.ts";
import type { TaskExecutionOptions } from "./execution-types.ts";
import { readRunDataObject } from "./validation-values.ts";

/** Validates the closed data-property shape of task execution options. @internal */
export function readTaskExecutionOptions<
    I extends TaskSchema<unknown>,
    O extends TaskSchema<unknown>,
>(value: TaskExecutionOptions<I, O>): TaskExecutionOptions<I, O> {
    const fields = readRunDataObject(
        value,
        ["budget", "input", "provider", "runId", "task"],
        "task execution options",
        ["signal"],
    );
    const control = readRunControlOptions({
        budget: fields.budget as TaskExecutionOptions<I, O>["budget"],
        ...(fields.signal === undefined ? {} : { signal: fields.signal as AbortSignal }),
    });
    assertTaskDescriptor(fields.task as TaskExecutionOptions<I, O>["task"]);
    return Object.freeze({
        budget: control.budget,
        input: fields.input,
        provider: fields.provider,
        runId: fields.runId,
        ...(control.signal === undefined ? {} : { signal: control.signal }),
        task: fields.task,
    }) as TaskExecutionOptions<I, O>;
}
