import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
    createStaticProvider,
    executeTask,
    SQLiteTaskRegistry,
    schema,
    task,
} from "../../src/index.ts";

test("adapted schemas reject unsupported documents without evaluating accessors", () => {
    const hiddenProperties = Object.defineProperty({}, "secret", {
        value: { type: "string" },
        enumerable: false,
    });
    assert.throws(
        () =>
            schema.fromJSONSchema({
                type: "object",
                additionalProperties: false,
                properties: hiddenProperties,
                required: ["other"],
            }),
        TypeError,
    );
    assert.deepEqual(
        schema
            .fromJSONSchema({
                type: "object",
                additionalProperties: false,
                properties: hiddenProperties,
                required: [],
            })
            .parse({}),
        {},
    );
    assert.deepEqual(
        schema
            .fromJSONSchema({
                type: "object",
                additionalProperties: false,
                properties: hiddenProperties,
                required: ["secret"],
            })
            .parse({ secret: "kept" }),
        { secret: "kept" },
    );
    let inheritedAccess = false;
    const required = Object.setPrototypeOf(
        [],
        Object.create(Array.prototype, {
            some: {
                get() {
                    inheritedAccess = true;
                    return Array.prototype.some;
                },
            },
            [Symbol.iterator]: {
                get() {
                    inheritedAccess = true;
                    return Array.prototype[Symbol.iterator];
                },
            },
        }),
    ) as string[];
    assert.deepEqual(
        schema
            .fromJSONSchema({
                type: "object",
                additionalProperties: false,
                properties: {},
                required,
            })
            .parse({}),
        {},
    );
    assert.equal(inheritedAccess, false);
    for (const document of [
        null,
        [],
        "string",
        {},
        { type: "string", minLength: 1 },
        { type: "integer", minimum: 0 },
        { type: ["string", "null"] },
        { type: "array" },
        { type: "array", items: { type: "string" }, minItems: 1 },
        { enum: [] },
        { enum: ["a", "a"] },
        { enum: [{}] },
        { enum: ["a"], type: "string" },
        { const: [] },
        { oneOf: [{ type: "string" }] },
        { oneOf: [{ type: "string" }, { type: "string" }] },
        { oneOf: [{ type: "string" }, { type: "decimal" }] },
        { anyOf: [{ type: "string" }, { type: "null" }] },
        { type: "null", extra: undefined },
        { type: "object", additionalProperties: true, properties: {}, required: [] },
        {
            type: "object",
            additionalProperties: false,
            properties: { text: { type: "string" } },
            required: ["other"],
        },
        {
            type: "object",
            additionalProperties: false,
            properties: { text: { type: "string" } },
            required: ["text", "text"],
        },
        {
            type: "object",
            additionalProperties: false,
            properties: { "a\0b": { type: "string" }, c: { type: "string" } },
            required: ["a", "b\0c"],
        },
        {
            type: "object",
            additionalProperties: false,
            properties: { nested: { type: "array" } },
            required: ["nested"],
        },
    ])
        assert.throws(() => schema.fromJSONSchema(document), TypeError);
    let accessed = false;
    assert.throws(
        () =>
            schema.fromJSONSchema({
                get type() {
                    accessed = true;
                    return "string";
                },
            }),
        TypeError,
    );
    assert.equal(accessed, false);
    const cyclic: Record<string, unknown> = { type: "object" };
    cyclic.properties = cyclic;
    assert.throws(() => schema.fromJSONSchema(cyclic), TypeError);
    assert.deepEqual(
        schema
            .fromJSONSchema({
                type: "object",
                additionalProperties: false,
                properties: {},
                required: [],
            })
            .parse({}),
        {},
    );
});

test("adapted schemas validate task execution and expose honest dynamic types", async () => {
    const input = schema.fromJSONSchema({ type: "string" });
    // @ts-expect-error Dynamic documents do not prove a caller-selected static type.
    const unchecked: string = input.parse("hello");
    assert.equal(unchecked, "hello");
    assert.throws(() => input.parse(1), TypeError);
    assert.equal(schema.fromJSONSchema({ type: "null" }).parse(null), undefined);
    const descriptor = task({
        name: "execution",
        version: "1",
        instruction: "Echo.",
        input,
        output: input,
    });
    const provider = createStaticProvider({
        descriptor: { id: "static:adapter", model: "offline" },
        exchanges: [
            {
                request: { input: "hello", instruction: "Echo.", outputSchema: { type: "string" } },
                response: {
                    output: "hello",
                    usage: {
                        inputTokens: 0,
                        outputTokens: 0,
                        cacheReadInputTokens: 0,
                        cacheCreationInputTokens: 0,
                        costUsd: 0,
                    },
                },
            },
        ],
    });
    const execution = await executeTask({
        task: descriptor,
        provider,
        input: "hello",
        runId: "adapter:run",
        budget: {},
    });
    assert.equal(execution.outcome.outcome.status, "finished");
    assert.deepEqual(execution.outcome.outcome, { status: "finished", value: "hello" });
});

test("JSON Schema adapters preserve builder behavior, identities, and registry reopen", async (context) => {
    const document = {
        type: "object",
        additionalProperties: false,
        properties: {
            z: { type: "null" },
            a: {
                type: "object",
                additionalProperties: false,
                properties: { text: { type: "string" } },
                required: ["text"],
            },
        },
        required: ["z", "a"],
    };
    const adapted = schema.fromJSONSchema(document);
    const built = schema.object({ a: schema.object({ text: schema.string() }), z: schema.null() });
    assert.deepEqual(adapted.toJSONSchema(), built.toJSONSchema());
    const value = { a: { text: "hello" }, z: null };
    assert.deepEqual(adapted.parse(value), built.parse(value));
    assert.ok(
        Object.isFrozen(adapted) &&
            Object.isFrozen(adapted.toJSONSchema()) &&
            Object.isFrozen(adapted.parse(value)),
    );
    const definition = {
        name: "adapted",
        version: "1",
        instruction: "Return text.",
        output: schema.string(),
    };
    const fromDocument = task({ ...definition, input: adapted });
    assert.deepEqual(fromDocument.artifactLock, task({ ...definition, input: built }).artifactLock);
    document.properties.a.properties.text.type = "number";
    assert.deepEqual(adapted.parse(value), built.parse(value));
    const root = await mkdtemp(path.join(tmpdir(), "schema-adapter-"));
    context.after(() => rm(root, { recursive: true, force: true }));
    const database = path.join(root, "tasks.sqlite");
    using registry = new SQLiteTaskRegistry(database);
    registry.register(fromDocument);
    registry.close();
    using reopened = new SQLiteTaskRegistry(database, { readOnly: true });
    assert.deepEqual(
        reopened.resolve({ taskId: fromDocument.artifactLock.task_id, version: "1" })?.artifactLock,
        fromDocument.artifactLock,
    );
});
