import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { Ajv2020, type AnySchemaObject } from "ajv/dist/2020.js";

import {
    readTaskValue,
    SQLiteTaskRegistry,
    schema,
    task,
    taskDescriptorOf,
    taskValueOf,
} from "../../src/index.ts";
import { createTaskArtifactLock } from "../../src/task/lock.ts";

const fixture = JSON.parse(
    readFileSync(new URL("../fixtures/task-descriptor-v1.json", import.meta.url), "utf8"),
) as {
    readonly artifact: Record<string, unknown>;
    readonly artifact_lock: Record<string, unknown>;
};
const VALUE_SCHEMA_ID =
    "https://avnionur.github.io/shepherd-typescript/schemas/task-value-v1.schema.json";

const writeNote = task({
    input: schema.object({ topic: schema.string() }),
    instruction: "Write one note about the topic.",
    name: "writeNote",
    output: schema.void(),
    version: "1.0.0",
});

test("task values round-trip through the registry lock and the task builder", () => {
    const value = taskValueOf(writeNote);
    assert.deepEqual(value, { artifact: fixture.artifact, artifact_lock: fixture.artifact_lock });
    assert.equal(Object.isFrozen(value), true);
    assert.deepEqual(readTaskValue(JSON.parse(JSON.stringify(value))), value);
    const rehydrated = taskDescriptorOf(value);
    assert.deepEqual(rehydrated.artifactLock, writeNote.artifactLock);
    assert.deepEqual(rehydrated.artifact, writeNote.artifact);
    assert.deepEqual(rehydrated.parseInput({ topic: "x" }), { topic: "x" });
    using registry = new SQLiteTaskRegistry();
    registry.register(rehydrated);
    assert.deepEqual(
        registry.resolve({ taskId: value.artifact_lock.task_id, version: "1.0.0" })?.artifactLock,
        value.artifact_lock,
    );
    assert.throws(() => taskValueOf({ ...writeNote }), TypeError);
});

test("task values refuse extra keys, foreign schemas, unsupported grammar, and mismatched locks", () => {
    const value = taskValueOf(writeNote);
    const artifact = (patch: Record<string, unknown>) => ({
        ...value,
        artifact: { ...value.artifact, ...patch },
    });
    for (const invalid of [
        null,
        [],
        { ...value, extra: true },
        { artifact: value.artifact },
        artifact({ instruction: "changed" }),
        artifact({ input_schema: { type: "number" } }),
        artifact({ input_schema: { $ref: "https://example.invalid/other.json" } }),
        artifact({ input_schema: { $ref: VALUE_SCHEMA_ID, type: "object" } }),
        artifact({ descriptor_version: 2 }),
        { ...value, artifact_lock: { ...value.artifact_lock, task_version: "2" } },
        Object.create({ artifact: value.artifact, artifact_lock: value.artifact_lock }),
    ]) {
        assert.throws(() => readTaskValue(invalid), TypeError);
        assert.throws(() => taskDescriptorOf(invalid), TypeError);
    }
    const descriptorLike = { ...value, artifact: { ...value.artifact } };
    Object.defineProperty(descriptorLike, "artifact_lock", { get: () => value.artifact_lock });
    assert.throws(() => readTaskValue(descriptorLike), TypeError);

    const unordered = task({
        input: schema.object({ b: schema.string(), a: schema.string() }),
        instruction: "Order.",
        name: "order",
        output: schema.void(),
        version: "1",
    });
    const reordered = {
        ...unordered.artifact,
        input_schema: { ...unordered.artifact.input_schema, required: ["b", "a"] },
    };
    const forged = { artifact: reordered, artifact_lock: createTaskArtifactLock(reordered) };
    assert.deepEqual(readTaskValue(forged).artifact.input_schema.required, ["b", "a"]);
    assert.throws(() => taskDescriptorOf(forged), /builder-normalized/u);
});

test("schema.task types a task value and survives the JSON Schema adapter", () => {
    const taskSchema = schema.task();
    assert.deepEqual(taskSchema.toJSONSchema(), { $ref: VALUE_SCHEMA_ID });
    const value = taskValueOf(writeNote);
    assert.deepEqual(taskSchema.parse(JSON.parse(JSON.stringify(value))), value);
    assert.throws(() => taskSchema.parse({ artifact: {} }), /canonical task value/u);
    const supervisor = task({
        input: schema.object({ worker: schema.task(), topic: schema.string() }),
        instruction: "Delegate the topic to the worker.",
        name: "supervise",
        output: schema.task(),
        version: "1",
    });
    assert.deepEqual(supervisor.artifact.output_schema, { $ref: VALUE_SCHEMA_ID });
    const parsed = supervisor.parseInput({ topic: "x", worker: value });
    assert.deepEqual(parsed.worker, value);
    assert.deepEqual(supervisor.parseOutput(value), value);
    assert.throws(() => supervisor.parseOutput({ ...value, extra: 1 }), TypeError);
    const rebuilt = schema.fromJSONSchema(supervisor.artifact.input_schema);
    assert.deepEqual(rebuilt.toJSONSchema(), supervisor.artifact.input_schema);
    assert.deepEqual(
        taskDescriptorOf(taskValueOf(supervisor)).artifactLock,
        supervisor.artifactLock,
    );
    for (const invalid of [
        { $ref: "https://example.invalid/other.json" },
        { $ref: VALUE_SCHEMA_ID, type: "object" },
        { $ref: 5 },
    ]) {
        assert.throws(() => schema.fromJSONSchema(invalid), TypeError);
    }
});

test("the published task value schema accepts the fixture and rejects drift", () => {
    const validator = new Ajv2020({ strict: true });
    const validateValue = validator.compile(
        JSON.parse(
            readFileSync(
                new URL("../../spec/schemas/task-value-v1.schema.json", import.meta.url),
                "utf8",
            ),
        ) as AnySchemaObject,
    );
    const validateDescriptor = validator.compile(
        JSON.parse(
            readFileSync(
                new URL("../../spec/schemas/task-descriptor-v1.schema.json", import.meta.url),
                "utf8",
            ),
        ) as AnySchemaObject,
    );
    assert.equal(validateValue(fixture), true, validator.errorsText(validateValue.errors));
    assert.equal(validateValue({ ...fixture, extra: true }), false);
    assert.equal(validateValue({ artifact: fixture.artifact }), false);
    const nested = task({
        input: schema.task(),
        instruction: "Nest.",
        name: "nest",
        output: schema.string(),
        version: "1",
    });
    assert.equal(
        validateValue(taskValueOf(nested)),
        true,
        validator.errorsText(validateValue.errors),
    );
    assert.equal(validateDescriptor(nested.artifact), true);
    assert.equal(
        validateDescriptor({
            ...nested.artifact,
            input_schema: { $ref: "https://example.invalid/other.json" },
        }),
        false,
    );
});
