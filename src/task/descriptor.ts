import { createHash } from "node:crypto";

import { canonicalizeRecord, type SemanticRecord } from "../canonical/canonical-record.ts";
import { createCanonicalSnapshot } from "../canonical/snapshot.ts";
import { taskProtocolConfig } from "../protocol/config.ts";
import { type TaskSchema, taskSchemaMetadata } from "./schema.ts";
import type { TaskArtifact, TaskArtifactLock, TaskDefinition, TaskDescriptor } from "./types.ts";
import { assertTaskText, readTaskDataObject } from "./validation.ts";

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
    return Object.freeze({
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
}

/** Derives the exact configured lock for a validated canonical task artifact. @internal */
export function createTaskArtifactLock(artifact: TaskArtifact): TaskArtifactLock {
    return createCanonicalSnapshot({
        artifact_digest: digest(artifact),
        artifact_lock_version: taskProtocolConfig.artifactLockVersion,
        compatibility_version: taskProtocolConfig.compatibilityVersion,
        descriptor_version: taskProtocolConfig.descriptorVersion,
        schema_digest: digest({
            input_schema: artifact.input_schema,
            output_schema: artifact.output_schema,
        }),
        task_id: `${taskProtocolConfig.taskIdPrefix}${digestHex({ name: artifact.name })}`,
        task_version: artifact.task_version,
    }) as TaskArtifactLock;
}

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

function digest(value: SemanticRecord): string {
    return `${taskProtocolConfig.digestPrefix}${digestHex(value)}`;
}

function digestHex(value: SemanticRecord): string {
    return createHash(taskProtocolConfig.digestAlgorithm)
        .update(canonicalizeRecord(value), "utf8")
        .digest("hex");
}
