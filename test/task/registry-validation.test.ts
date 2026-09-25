import assert from "node:assert/strict";
import { test } from "node:test";

import { SQLiteTaskRegistry, task } from "../../src/index.ts";
import { createFixtureArtifactLock, taskDefinition } from "./registry-fixtures.ts";

test("SQLiteTaskRegistry validates closed read-only options", () => {
    for (const options of [
        null,
        [],
        new (class Options {})(),
        { extra: true },
        { readOnly: "yes" },
        Object.defineProperty({}, "readOnly", { get: () => true }),
    ]) {
        assert.throws(() => new SQLiteTaskRegistry(":memory:", options as never), TypeError);
    }
});

test("SQLiteTaskRegistry rejects malformed exact references", () => {
    using registry = new SQLiteTaskRegistry();
    const descriptor = task(taskDefinition());
    for (const reference of [
        null,
        [],
        new (class Reference {})(),
        { taskId: descriptor.artifactLock.task_id },
        { taskId: descriptor.artifactLock.task_id, version: "1.0.0", extra: true },
        { taskId: "", version: "1.0.0" },
        { taskId: "task:invalid", version: "1.0.0" },
        { taskId: `${descriptor.artifactLock.task_id.slice(0, -1)}z`, version: "1.0.0" },
        { taskId: descriptor.artifactLock.task_id, version: "" },
        { taskId: descriptor.artifactLock.task_id, version: "\uD800" },
        { taskId: descriptor.artifactLock.task_id, version: "1.0.0", [Symbol("extra")]: true },
        Object.defineProperty({ version: "1.0.0" }, "taskId", {
            enumerable: true,
            get: () => descriptor.artifactLock.task_id,
        }),
    ]) {
        assert.throws(() => registry.resolve(reference as never), TypeError);
    }
});

test("SQLiteTaskRegistry validates descriptor artifacts and exact locks", () => {
    using registry = new SQLiteTaskRegistry();
    const descriptor = task(taskDefinition());
    const malformedDescriptors = [
        {
            ...descriptor,
            artifactLock: {
                ...descriptor.artifactLock,
                artifact_digest: `sha256:${"0".repeat(64)}`,
            },
        },
        { ...descriptor, artifact: { ...descriptor.artifact, descriptor_version: 2 } },
        { ...descriptor, artifact: { ...descriptor.artifact, instruction: "" } },
        {
            ...descriptor,
            artifact: { ...descriptor.artifact, input_schema: { invalid: Number.NaN } },
        },
        {
            ...descriptor,
            artifactLock: { ...descriptor.artifactLock, artifact_lock_version: 2 },
        },
        { ...descriptor, artifactLock: { ...descriptor.artifactLock, schema_digest: "" } },
        { ...descriptor, artifact: null },
        { ...descriptor, artifact: { ...descriptor.artifact, extra: true } },
        {
            ...descriptor,
            artifact: Object.defineProperty({ ...descriptor.artifact }, "name", {
                enumerable: true,
                get: () => descriptor.name,
            }),
        },
    ];

    for (const malformed of malformedDescriptors) {
        assert.throws(() => registry.register(malformed as never), TypeError);
    }
});

test("SQLiteTaskRegistry rejects consistently locked unsupported schema documents", () => {
    using registry = new SQLiteTaskRegistry();
    const descriptor = task(taskDefinition());
    const malformedSchemas = [
        { minimum: 0, type: "number" },
        { type: 1 },
        { extra: true, type: "string" },
        { additionalProperties: true, properties: {}, required: [], type: "object" },
        { additionalProperties: false, properties: null, required: [], type: "object" },
        { additionalProperties: false, properties: 1, required: [], type: "object" },
        { additionalProperties: false, properties: [], required: [], type: "object" },
        { additionalProperties: false, properties: {}, required: [1], type: "object" },
        {
            additionalProperties: false,
            properties: { value: { type: "string" } },
            required: ["other"],
            type: "object",
        },
        {
            additionalProperties: false,
            properties: { value: { type: "decimal" } },
            required: ["value"],
            type: "object",
        },
        { items: { type: "string" }, type: "array", uniqueItems: true },
        { enum: [] },
        { oneOf: [{ type: "string" }] },
        {},
    ];

    for (const inputSchema of malformedSchemas) {
        const artifact = { ...descriptor.artifact, input_schema: inputSchema };
        assert.throws(
            () =>
                registry.register({
                    ...descriptor,
                    artifact,
                    artifactLock: createFixtureArtifactLock(artifact),
                } as never),
            TypeError,
        );
    }
});
