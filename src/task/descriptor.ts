import { createHash } from "node:crypto";

import { canonicalizeRecord, type SemanticRecord } from "../canonical/canonical-record.ts";
import { createCanonicalSnapshot } from "../canonical/snapshot.ts";
import { taskProtocolConfig } from "../protocol/config.ts";
import { type TaskSchema, taskSchemaMetadata } from "./schema.ts";
import type { TaskArtifact, TaskArtifactLock, TaskDefinition, TaskDescriptor } from "./types.ts";

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
    const artifactLock = createCanonicalSnapshot({
        artifact_digest: digest(artifact),
        artifact_lock_version: taskProtocolConfig.artifactLockVersion,
        compatibility_version: taskProtocolConfig.compatibilityVersion,
        descriptor_version: taskProtocolConfig.descriptorVersion,
        schema_digest: digest({
            input_schema: inputMetadata.document,
            output_schema: outputMetadata.document,
        }),
        task_id: `${taskProtocolConfig.taskIdPrefix}${digestHex({ name: values.name })}`,
        task_version: values.version,
    }) as TaskArtifactLock;
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

function readDefinition<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>>(
    definition: TaskDefinition<I, O>,
): TaskDefinition<I, O> {
    if (
        definition === null ||
        typeof definition !== "object" ||
        Array.isArray(definition) ||
        (Object.getPrototypeOf(definition) !== Object.prototype &&
            Object.getPrototypeOf(definition) !== null) ||
        Object.getOwnPropertySymbols(definition).length > 0
    ) {
        throw new TypeError("task definition must be a plain data object");
    }
    const descriptors = Object.getOwnPropertyDescriptors(definition);
    const keys = ["input", "instruction", "name", "output", "version"];
    if (Object.keys(descriptors).sort().join("\0") !== keys.join("\0")) {
        throw new TypeError("task definition must contain exactly its declared fields");
    }
    const values = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
        const descriptor = descriptors[key];
        /* node:coverage disable */
        if (descriptor === undefined) {
            throw new TypeError(`task definition ${key} disappeared during validation`);
        }
        /* node:coverage enable */
        if (!("value" in descriptor)) {
            throw new TypeError(`task definition ${key} must be a data property`);
        }
        values[key] = descriptor.value;
    }
    assertText(values.name, "task name");
    assertText(values.version, "task version");
    assertText(values.instruction, "task instruction");
    taskSchemaMetadata(values.input as I);
    taskSchemaMetadata(values.output as O);
    return values as TaskDefinition<I, O>;
}

function assertText(value: unknown, subject: string): asserts value is string {
    if (typeof value !== "string" || value.length === 0 || /[\uD800-\uDFFF]/u.test(value)) {
        throw new TypeError(`${subject} must be a non-empty well-formed string`);
    }
}

function digest(value: SemanticRecord): string {
    return `${taskProtocolConfig.digestPrefix}${digestHex(value)}`;
}

function digestHex(value: SemanticRecord): string {
    return createHash(taskProtocolConfig.digestAlgorithm)
        .update(canonicalizeRecord(value), "utf8")
        .digest("hex");
}
