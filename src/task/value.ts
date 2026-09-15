import { canonicalizeRecord } from "../canonical/canonical-record.ts";
import { createCanonicalSnapshot } from "../canonical/snapshot.ts";
import { assertTaskDescriptor, task } from "./descriptor.ts";
import { schema, type TaskSchema } from "./schema.ts";
import type { TaskDescriptor, TaskValue } from "./types.ts";
import { readTaskValue } from "./value-codec.ts";

export { readTaskValue } from "./value-codec.ts";

/**
 * Returns the canonical task value of a package-created descriptor.
 *
 * @param descriptor - Descriptor created by {@link task}.
 * @returns The frozen `{ artifact, artifact_lock }` value.
 * @throws {TypeError} If the descriptor was not created by the configured task builder.
 *
 * @example
 * ```ts
 * const value = taskValueOf(greet);
 * ```
 *
 * @public
 */
export function taskValueOf(
    descriptor: TaskDescriptor<TaskSchema<unknown>, TaskSchema<unknown>>,
): TaskValue {
    assertTaskDescriptor(descriptor);
    return createCanonicalSnapshot({
        artifact: descriptor.artifact,
        artifact_lock: descriptor.artifactLock,
    }) as TaskValue;
}

/**
 * Rehydrates an authenticated task descriptor from a task value.
 *
 * The value is validated with {@link readTaskValue}, its schemas are rebuilt through the schema
 * factory, and the descriptor is rebuilt through the task builder. The recomputed lock must equal
 * the value's lock, so a value whose artifact differs from its builder-normalized form is refused
 * rather than silently renormalized.
 *
 * @param value - Untrusted task value.
 * @returns A package-created descriptor whose artifact lock equals the value's lock.
 * @throws {TypeError} If the value is malformed or the rebuilt lock differs.
 *
 * @example
 * ```ts
 * const descriptor = taskDescriptorOf(inspection.task);
 * await executeTask({ task: descriptor, input, provider, runId, budget });
 * ```
 *
 * @public
 */
export function taskDescriptorOf(
    value: unknown,
): TaskDescriptor<TaskSchema<unknown>, TaskSchema<unknown>> {
    const read = readTaskValue(value);
    const descriptor = task({
        input: schema.fromJSONSchema(read.artifact.input_schema),
        instruction: read.artifact.instruction,
        name: read.artifact.name,
        output: schema.fromJSONSchema(read.artifact.output_schema),
        version: read.artifact.task_version,
    });
    if (
        canonicalizeRecord(descriptor.artifactLock) !== canonicalizeRecord(read.artifact_lock) ||
        canonicalizeRecord(descriptor.artifact) !== canonicalizeRecord(read.artifact)
    ) {
        throw new TypeError("task value artifact is not in builder-normalized form");
    }
    return descriptor;
}
