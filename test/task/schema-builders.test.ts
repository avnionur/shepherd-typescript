import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { Ajv2020, type AnySchemaObject } from "ajv/dist/2020.js";

import {
    createStaticProvider,
    executeTask,
    JSONSchemaValidationError,
    readTaskValue,
    SQLiteTaskRegistry,
    schema,
    type TaskSchema,
    task,
    taskDescriptorOf,
    taskValueOf,
} from "../../src/index.ts";

const usage = {
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    costUsd: 0,
    inputTokens: 1,
    outputTokens: 1,
};

/** Asserts that parsing refuses with exactly one issue at `path` for `keyword`. */
function refuses(
    subject: TaskSchema<unknown>,
    value: unknown,
    path: string,
    keyword: string,
    schemaPath?: string,
): void {
    assert.throws(
        () => subject.parse(value),
        (error: unknown) =>
            error instanceof JSONSchemaValidationError &&
            error instanceof TypeError &&
            error.code === "SCHEMA_VALIDATION_FAILED" &&
            error.issues[0]?.path === path &&
            error.issues[0]?.keyword === keyword &&
            (schemaPath === undefined || error.issues[0]?.schemaPath === schemaPath) &&
            error.message.startsWith(`${path} `),
        `${JSON.stringify(value)} at ${path}`,
    );
}

const rich = schema.object({
    count: schema.integer(),
    ratio: schema.number(),
    enabled: schema.boolean(),
    tags: schema.array(schema.string()),
    mode: schema.enum(["fast", "safe", 3, null, false]),
    version: schema.literal("v1"),
    reason: schema.union([schema.string(), schema.null()]),
    note: schema.optional(schema.string()),
    nested: schema.optional(
        schema.object({
            ids: schema.array(schema.integer()),
            flag: schema.optional(schema.boolean()),
        }),
    ),
});

test("new builders emit canonical JSON Schema documents", () => {
    assert.deepEqual(schema.number().toJSONSchema(), { type: "number" });
    assert.deepEqual(schema.integer().toJSONSchema(), { type: "integer" });
    assert.deepEqual(schema.boolean().toJSONSchema(), { type: "boolean" });
    assert.deepEqual(schema.null().toJSONSchema(), { type: "null" });
    assert.deepEqual(schema.array(schema.number()).toJSONSchema(), {
        items: { type: "number" },
        type: "array",
    });
    assert.deepEqual(schema.enum(["a", 1]).toJSONSchema(), { enum: ["a", 1] });
    assert.deepEqual(schema.literal(true).toJSONSchema(), { const: true });
    assert.deepEqual(schema.union([schema.string(), schema.null()]).toJSONSchema(), {
        oneOf: [{ type: "string" }, { type: "null" }],
    });
    assert.deepEqual(rich.toJSONSchema().required, [
        "count",
        "enabled",
        "mode",
        "ratio",
        "reason",
        "tags",
        "version",
    ]);
    assert.deepEqual(Object.keys(rich.toJSONSchema().properties as object), [
        "count",
        "enabled",
        "mode",
        "nested",
        "note",
        "ratio",
        "reason",
        "tags",
        "version",
    ]);
    assert.equal(Object.isFrozen(schema.optional(schema.string())), true);
});

test("new builders parse valid values into frozen snapshots with inferred types", () => {
    const value = rich.parse({
        count: 2,
        enabled: true,
        mode: null,
        nested: { ids: [1, 2] },
        note: undefined,
        ratio: 0.5,
        reason: null,
        tags: ["a"],
        version: "v1",
    });
    assert.deepEqual(value, {
        count: 2,
        enabled: true,
        mode: null,
        nested: { ids: [1, 2] },
        ratio: 0.5,
        reason: null,
        tags: ["a"],
        version: "v1",
    });
    assert.equal(Object.isFrozen(value.tags), true);
    assert.equal(Object.isFrozen(value.nested?.ids), true);
    assert.equal("note" in value, false);
    const count: number = value.count;
    const tags: readonly string[] = value.tags;
    const mode: "fast" | "safe" | 3 | null | false = value.mode;
    const version: "v1" = value.version;
    const reason: string | null = value.reason;
    const note: string | undefined = value.note;
    const flag: boolean | undefined = value.nested?.flag;
    // @ts-expect-error Optional fields are not required properties.
    const required: string = value.note;
    // @ts-expect-error Enum values are a closed literal union.
    const other: "other" = value.mode;
    assert.deepEqual(
        [count, tags, mode, version, reason, note, flag, required, other],
        [2, ["a"], null, "v1", null, undefined, undefined, undefined, null],
    );
    assert.equal(schema.integer().parse(-3), -3);
    assert.equal(schema.boolean().parse(false), false);
    assert.equal(schema.null().parse(null), null);
    assert.deepEqual(schema.array(schema.null()).parse([null]), [null]);
    assert.deepEqual(schema.union([schema.literal(1), schema.literal("1")]).parse("1"), "1");
});

test("invalid values are refused with a path-level issue for every new form", () => {
    refuses(schema.number(), "1", "$", "type", "#/type");
    refuses(schema.number(), Number.NaN, "$", "type");
    refuses(schema.number(), Number.POSITIVE_INFINITY, "$", "type");
    refuses(schema.integer(), 1.5, "$", "type");
    refuses(schema.integer(), 2 ** 53, "$", "type");
    refuses(schema.integer(), "1", "$", "type");
    refuses(schema.boolean(), 0, "$", "type");
    refuses(schema.null(), undefined, "$", "type");
    refuses(schema.enum(["a", "b"]), "c", "$", "enum", "#/enum");
    refuses(schema.literal(0), false, "$", "const", "#/const");
    refuses(schema.array(schema.string()), { 0: "a", length: 1 }, "$", "type");
    const sparse: string[] = [];
    sparse[1] = "a";
    refuses(schema.array(schema.string()), sparse, "$", "type");
    refuses(schema.array(schema.string()), Object.assign(["a"], { extra: 1 }), "$", "type");
    refuses(schema.array(schema.string()), ["a", 1], "$[1]", "type", "#/items/type");
    const base = {
        count: 1,
        enabled: false,
        mode: "fast",
        ratio: 1,
        reason: "r",
        tags: [],
        version: "v1",
    };
    refuses(rich, { ...base, count: 1.5 }, "$.count", "type", "#/properties/count/type");
    refuses(rich, { ...base, ratio: "1" }, "$.ratio", "type");
    refuses(rich, { ...base, enabled: "yes" }, "$.enabled", "type");
    refuses(rich, { ...base, tags: ["a", 2] }, "$.tags[1]", "type", "#/properties/tags/items/type");
    refuses(rich, { ...base, mode: "slow" }, "$.mode", "enum", "#/properties/mode/enum");
    refuses(rich, { ...base, version: "v2" }, "$.version", "const");
    refuses(rich, { ...base, reason: 1 }, "$.reason", "oneOf", "#/properties/reason/oneOf");
    refuses(rich, { ...base, note: 1 }, "$.note", "type", "#/properties/note/type");
    refuses(
        rich,
        { ...base, nested: { ids: [1, "2"] } },
        "$.nested.ids[1]",
        "type",
        "#/properties/nested/properties/ids/items/type",
    );
    refuses(rich, { ...base, nested: { ids: [], flag: null } }, "$.nested.flag", "type");
    refuses(
        rich,
        { ...base, extra: 1 },
        "$.extra",
        "additionalProperties",
        "#/additionalProperties",
    );
    refuses(rich, { ...base, "odd key": 1 }, '$["odd key"]', "additionalProperties");
    const { count: _count, ...missing } = base;
    refuses(rich, missing, "$.count", "required", "#/required");
    refuses(
        rich,
        Object.defineProperty({ ...base }, "note", { enumerable: true, get: () => "x" }),
        "$.note",
        "type",
    );
    // A union reports every member's issue when nothing matches, and refuses ambiguity.
    const either = schema.union([schema.integer(), schema.number()]);
    assert.equal(either.parse(0.5), 0.5);
    assert.throws(
        () => either.parse(1),
        (error: unknown) =>
            error instanceof JSONSchemaValidationError &&
            error.issues.length === 1 &&
            /matches members 0, 1/u.test(error.message),
    );
    assert.throws(
        () => either.parse("x"),
        (error: unknown) =>
            error instanceof JSONSchemaValidationError &&
            error.issues.map((issue) => issue.schemaPath).join(" ") ===
                "#/oneOf #/oneOf/0/type #/oneOf/1/type",
    );
    // Causes that are not validation refusals propagate unchanged.
    const hostile = schema.union([schema.string(), schema.object({ a: schema.string() })]);
    const trap = new Proxy(
        {},
        {
            getPrototypeOf: () => {
                throw new RangeError("trap");
            },
        },
    );
    assert.throws(() => hostile.parse(trap), RangeError);
});

test("builders refuse malformed declarations", () => {
    const refusals: readonly (() => unknown)[] = [
        () => schema.array(schema.void()),
        () => schema.array({ parse: () => 1, toJSONSchema: () => ({}) }),
        () => schema.optional(schema.void()),
        () => schema.union([schema.string(), schema.void()]),
        () => schema.union([schema.string(), schema.string()]),
        () => schema.union([schema.string()] as never),
        () => schema.union({ 0: schema.string(), 1: schema.null(), length: 2 } as never),
        () => schema.enum([] as never),
        () => schema.enum(["a", "a"]),
        () => schema.enum([0, -0]),
        () => schema.enum([{}] as never),
        () => schema.enum([Number.NaN]),
        () => schema.enum(["\uD800"]),
        () => schema.enum(Object.defineProperty(["a"], 0, { get: () => "a" }) as never),
        () => {
            const holed: string[] = ["a"];
            holed[2] = "c";
            return schema.enum(Object.assign(holed, { extra: "b" }) as never);
        },
        () => schema.literal(undefined as never),
        () => schema.literal([] as never),
        () => schema.object({ inner: schema.optional(schema.string()).schema.parse as never }),
        () =>
            task({
                input: schema.optional(schema.string()) as never,
                instruction: "i",
                name: "n",
                output: schema.void(),
                version: "1",
            }),
    ];
    for (const refusal of refusals) assert.throws(refusal, TypeError);
});

test("JSON Schema adaptation round-trips every new form with identical identity", () => {
    const definition = { instruction: "i", name: "rich", output: schema.void(), version: "1" };
    const built = task({ ...definition, input: rich });
    const adapted = task({ ...definition, input: schema.fromJSONSchema(rich.toJSONSchema()) });
    assert.deepEqual(adapted.artifactLock, built.artifactLock);
    const valid = {
        count: 1,
        enabled: true,
        mode: 3,
        ratio: 2,
        reason: "r",
        tags: [],
        version: "v1",
    };
    assert.deepEqual(adapted.parseInput(valid), built.parseInput(valid));
    assert.deepEqual(taskDescriptorOf(taskValueOf(built)).artifactLock, built.artifactLock);
    assert.deepEqual(
        readTaskValue(JSON.parse(JSON.stringify(taskValueOf(built)))),
        taskValueOf(built),
    );
    // `{ type: "null" }` adapts to void only at the root, and to null everywhere else.
    assert.equal(schema.fromJSONSchema({ type: "null" }).parse(null), undefined);
    assert.deepEqual(
        schema.fromJSONSchema({ items: { type: "null" }, type: "array" }).parse([null]),
        [null],
    );
    assert.equal(
        schema.fromJSONSchema({ oneOf: [{ type: "null" }, { type: "string" }] }).parse(null),
        null,
    );
    const optionalNull = schema.fromJSONSchema({
        additionalProperties: false,
        properties: { a: { type: "null" }, b: { type: "null" } },
        required: ["a"],
        type: "object",
    });
    assert.deepEqual(optionalNull.parse({ a: null, b: null }), { a: null, b: null });
    assert.deepEqual(
        optionalNull.toJSONSchema(),
        schema.object({ a: schema.null(), b: schema.optional(schema.null()) }).toJSONSchema(),
    );
    // A union in a non-normalized member order is a different, but valid, identity.
    assert.notDeepEqual(
        schema.union([schema.null(), schema.string()]).toJSONSchema(),
        schema.union([schema.string(), schema.null()]).toJSONSchema(),
    );
});

test("existing descriptor identities are unchanged by the widened schema language", () => {
    // Artifact digests recorded with the 2.34.1 schema factory before the language was widened.
    // The 2.34.1 declaration of the first entry used a `schema.void()` field; `schema.null()`
    // emits the same document, so the recorded digest still applies.
    const golden: readonly [ReturnType<typeof task>, string][] = [
        [
            task({
                input: schema.object({
                    z: schema.string(),
                    a: schema.object({ n: schema.null() }),
                }),
                instruction: "i",
                name: "a",
                output: schema.void(),
                version: "1",
            }),
            "sha256:49e07a83e10d2b21fdd2684772524821b05fe5a9b36d9c9f5b82d8633c2c2b76",
        ],
        [
            task({
                input: schema.task(),
                instruction: "j",
                name: "b",
                output: schema.object({ t: schema.task(), s: schema.string() }),
                version: "2",
            }),
            "sha256:3ed87ee74c9f3269559f970630dff45d05c82d9dddea20e0d4fd7b214e189236",
        ],
        [
            task({
                input: schema.fromJSONSchema({
                    additionalProperties: false,
                    properties: { y: { type: "string" }, x: { type: "null" } },
                    required: ["y", "x"],
                    type: "object",
                }),
                instruction: "k",
                name: "c",
                output: schema.string(),
                version: "3",
            }),
            "sha256:5e329ea4c1a12d32e0223986493f0b5912cff6159680a761a12c7d3c7a837550",
        ],
    ];
    for (const [descriptor, digest] of golden) {
        assert.equal(descriptor.artifactLock.artifact_digest, digest, descriptor.name);
    }
});

test("widened schemas register, reopen, and satisfy the published descriptor schema", async (context) => {
    const descriptor = task({
        input: rich,
        instruction: "i",
        name: "rich",
        output: schema.void(),
        version: "1",
    });
    const root = await mkdtemp(path.join(tmpdir(), "schema-builders-"));
    context.after(() => rm(root, { force: true, recursive: true }));
    const database = path.join(root, "tasks.sqlite");
    using registry = new SQLiteTaskRegistry(database);
    registry.register(descriptor);
    registry.close();
    using reopened = new SQLiteTaskRegistry(database, { readOnly: true });
    assert.deepEqual(
        reopened.resolve({ taskId: descriptor.artifactLock.task_id, version: "1" })?.artifact,
        descriptor.artifact,
    );
    const validator = new Ajv2020({ strict: true });
    const validate = validator.compile(
        JSON.parse(
            readFileSync(
                new URL("../../spec/schemas/task-descriptor-v1.schema.json", import.meta.url),
                "utf8",
            ),
        ) as AnySchemaObject,
    );
    assert.equal(validate(descriptor.artifact), true, validator.errorsText(validate.errors));
    for (const inputSchema of [
        { enum: [] },
        { enum: [{}] },
        { const: [] },
        { oneOf: [{ type: "string" }] },
        { items: { type: "decimal" }, type: "array" },
        { type: "integer", minimum: 0 },
    ]) {
        assert.equal(validate({ ...descriptor.artifact, input_schema: inputSchema }), false);
    }
});

test("invalid provider output for every new form fails the run with a path-level message", async () => {
    const output = schema.object({
        count: schema.integer(),
        tags: schema.array(schema.string()),
        mode: schema.enum(["a", "b"]),
        reason: schema.union([schema.string(), schema.null()]),
        note: schema.optional(schema.boolean()),
    });
    const outputTask = task({
        input: schema.void(),
        instruction: "Report.",
        name: "report",
        output,
        version: "1",
    });
    const valid = { count: 1, mode: "a", reason: null, tags: ["x"] };
    const cases: readonly [unknown, string][] = [
        [{ ...valid, count: 1.5 }, "$.count must be a safe integer"],
        [{ ...valid, tags: ["x", 2] }, "$.tags[1] must be a well-formed string"],
        [{ ...valid, mode: "c" }, '$.mode must be one of "a", "b"'],
        [{ ...valid, reason: 3 }, "$.reason must match exactly one union member"],
        [{ ...valid, note: "yes" }, "$.note must be a boolean"],
        [{ ...valid, extra: true }, "$.extra is not a declared task schema field"],
        [{ mode: "a", reason: null, tags: [] }, "$.count is a required task schema field"],
    ];
    for (const [index, [response, message]] of cases.entries()) {
        const provider = createStaticProvider({
            descriptor: { id: "static:builders", model: "offline" },
            exchanges: [
                {
                    request: {
                        input: null,
                        instruction: "Report.",
                        outputSchema: outputTask.artifact.output_schema,
                    },
                    response: { output: response as never, usage },
                },
            ],
        });
        const execution = await executeTask({
            budget: {},
            input: undefined,
            provider,
            runId: `builders:run:${index}`,
            task: outputTask,
        });
        const outcome = execution.outcome.outcome as { readonly message?: string; status: string };
        assert.equal(outcome.status, "failed", message);
        assert.ok(outcome.message?.startsWith(message), `${outcome.message} vs ${message}`);
    }
    const provider = createStaticProvider({
        descriptor: { id: "static:builders", model: "offline" },
        exchanges: [
            {
                request: {
                    input: null,
                    instruction: "Report.",
                    outputSchema: outputTask.artifact.output_schema,
                },
                response: { output: { ...valid, note: true }, usage },
            },
        ],
    });
    const finished = await executeTask({
        budget: {},
        input: undefined,
        provider,
        runId: "builders:run:valid",
        task: outputTask,
    });
    assert.deepEqual(finished.outcome.outcome, {
        status: "finished",
        value: { ...valid, note: true },
    });
});

test("descriptor rehydration preserves parsed values for every widened form", () => {
    const nestedValue = taskValueOf(
        task({
            input: schema.void(),
            instruction: "n",
            name: "nested",
            output: schema.string(),
            version: "1",
        }),
    );
    const forms: readonly [string, TaskSchema<unknown>, unknown][] = [
        ["string", schema.string(), "s"],
        ["number", schema.number(), 1.5],
        ["integer", schema.integer(), 2],
        ["boolean", schema.boolean(), false],
        ["required null", schema.null(), null],
        ["array of null", schema.array(schema.null()), [null, null]],
        ["enum", schema.enum(["a", null, 3]), null],
        ["literal null", schema.literal(null), null],
        ["union with null", schema.union([schema.string(), schema.null()]), null],
        ["object with null", schema.object({ n: schema.null() }), { n: null }],
        ["task value", schema.task(), nestedValue],
    ];
    for (const [label, field, value] of forms) {
        const built = task({
            input: schema.object({ x: field, y: schema.optional(schema.null()) }),
            instruction: "i",
            name: "round-trip",
            output: schema.void(),
            version: "1",
        });
        const rehydrated = taskDescriptorOf(taskValueOf(built));
        assert.deepEqual(rehydrated.artifactLock, built.artifactLock, label);
        for (const input of [{ x: value }, { x: value, y: null }]) {
            assert.deepEqual(rehydrated.parseInput(input), built.parseInput(input), label);
            assert.deepEqual(rehydrated.parseInput(input), input, label);
        }
        assert.throws(() => rehydrated.parseInput({}), JSONSchemaValidationError, label);
    }
    const nullField = taskDescriptorOf(
        taskValueOf(
            task({
                input: schema.object({ x: schema.null() }),
                instruction: "i",
                name: "null-field",
                output: schema.void(),
                version: "1",
            }),
        ),
    );
    refuses(nullField.inputSchema, { x: undefined }, "$.x", "type");
    assert.equal(schema.fromJSONSchema({ type: "null" }).parse(null), undefined);
    assert.throws(() => schema.object({ x: schema.void() }), TypeError);
});
