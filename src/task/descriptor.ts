import { createCanonicalSnapshot } from "../canonical/snapshot.ts";
import { taskProtocolConfig } from "../protocol/config.ts";
import { createTaskArtifactLock } from "./lock.ts";
import { type TaskSchema, taskSchemaMetadata } from "./schema.ts";
import type { TaskArtifact, TaskDefinition, TaskDescriptor } from "./types.ts";
import { assertTaskText, readTaskDataObject } from "./validation.ts";

const authenticatedTaskDescriptors = new WeakSet<object>();

/**
 * Creates an immutable, content-addressed bodyless task descriptor.
 *
 * @param definition - Closed task definition containing identity, instruction, and schemas.
 * @returns A frozen descriptor with inferred validation methods and exact artifact lock.
 * @throws {TypeError} If the definition or either schema is malformed.
 *
 * @example
 * ```ts
 * const greet = task({
 *     name: "greet",
 *     version: "1.0.0",
 *     instruction: "Greet the supplied person.",
 *     input: schema.object({ name: schema.string() }),
 *     output: schema.void(),
 * });
 * ```
 *
 * @public
 */
export function task<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>>(
    definition: TaskDefinition<I, O>,
): TaskDescriptor<I, O> {
    const values = readDefinition(definition);
    const inputMetadata = taskSchemaMetadata(values.input);
    const outputMetadata = taskSchemaMetadata(values.output);
    const artifact = createCanonicalSnapshot({
        compatibility_version: taskProtocolConfig.compatibilityVersion,
        descriptor_version: taskProtocolConfig.descriptorVersion,
        input_schema: inputMetadata.document,
        instruction: values.instruction,
        name: values.name,
        output_schema: outputMetadata.document,
        task_version: values.version,
    }) as TaskArtifact;
    const artifactLock = createTaskArtifactLock(artifact);
    const descriptor = Object.freeze({
        artifact,
        artifactLock,
        inputSchema: values.input,
        instruction: values.instruction,
        name: values.name,
        outputSchema: values.output,
        parseInput: (value: unknown) =>
            values.input.parse(value) as ReturnType<TaskDescriptor<I, O>["parseInput"]>,
        parseOutput: (value: unknown) =>
            values.output.parse(value) as ReturnType<TaskDescriptor<I, O>["parseOutput"]>,
        version: values.version,
    });
    authenticatedTaskDescriptors.add(descriptor);
    return descriptor;
}

/** Rejects task descriptor objects not created by this package instance. @internal */
export function assertTaskDescriptor(
    value: TaskDescriptor<TaskSchema<unknown>, TaskSchema<unknown>>,
): void {
    if (!authenticatedTaskDescriptors.has(value)) {
        throw new TypeError("task descriptor must be created by the configured task builder");
    }
}

export { createTaskArtifactLock } from "./lock.ts";

function readDefinition<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>>(
    definition: TaskDefinition<I, O>,
): TaskDefinition<I, O> {
    const keys = ["input", "instruction", "name", "output", "version"];
    const values = readTaskDataObject(definition, keys, "task definition");
    assertTaskText(values.name, "task name");
    assertTaskText(values.version, "task version");
    assertTaskText(values.instruction, "task instruction");
    taskSchemaMetadata(values.input as I);
    taskSchemaMetadata(values.output as O);
    return values as TaskDefinition<I, O>;
}
