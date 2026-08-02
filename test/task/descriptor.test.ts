import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { schema, task } from "../../src/index.ts";

const fixture = JSON.parse(
    readFileSync(new URL("../fixtures/task-descriptor-v1.json", import.meta.url), "utf8"),
) as Readonly<Record<string, unknown>>;

test("task creates an immutable versioned bodyless descriptor", () => {
    const writeNote = task({
        name: "writeNote",
        version: "1.0.0",
        instruction: "Write one note about the topic.",
        input: schema.object({
            topic: schema.string(),
        }),
        output: schema.void(),
    });

    const input: Readonly<{ topic: string }> = writeNote.parseInput({ topic: "Shepherd" });
    assert.deepEqual(input, { topic: "Shepherd" });
    assert.equal(writeNote.parseOutput(undefined), undefined);
    assert.equal(Object.isFrozen(writeNote), true);
    assert.equal(Object.isFrozen(writeNote.artifactLock), true);
    assert.deepEqual(writeNote.inputSchema.toJSONSchema(), writeNote.artifact.input_schema);
    assert.equal(writeNote.artifact.name, "writeNote");
    assert.equal(writeNote.artifact.task_version, "1.0.0");
});

test("task descriptor and artifact lock match the independent v1 fixture", () => {
    const writeNote = task({
        name: "writeNote",
        version: "1.0.0",
        instruction: "Write one note about the topic.",
        input: schema.object({ topic: schema.string() }),
        output: schema.void(),
    });

    assert.deepEqual(writeNote.artifact, fixture.artifact);
    assert.deepEqual(writeNote.artifactLock, fixture.artifact_lock);
});

test("task artifact identity changes with every behavioral descriptor field", () => {
    const definition = {
        name: "writeNote",
        version: "1.0.0",
        instruction: "Write one note about the topic.",
        input: schema.object({ topic: schema.string() }),
        output: schema.void(),
    };
    const baseline = task(definition);
    const variants = [
        task({ ...definition, instruction: "Write two notes about the topic." }),
        task({ ...definition, input: schema.object({ subject: schema.string() }) }),
        task({ ...definition, output: schema.string() }),
        task({ ...definition, version: "1.0.1" }),
    ];

    for (const variant of variants) {
        assert.notEqual(
            variant.artifactLock.artifact_digest,
            baseline.artifactLock.artifact_digest,
        );
    }
    assert.equal(variants[0]?.artifactLock.task_id, baseline.artifactLock.task_id);
});

test("task identity is independent of schema property declaration order", () => {
    const create = (input: ReturnType<typeof schema.object>) =>
        task({
            name: "ordered",
            version: "1",
            instruction: "Validate stable schema identity.",
            input,
            output: schema.void(),
        });
    const left = create(schema.object({ first: schema.string(), second: schema.string() }));
    const right = create(schema.object({ second: schema.string(), first: schema.string() }));

    assert.equal(left.artifactLock.artifact_digest, right.artifactLock.artifact_digest);
    assert.equal(left.artifactLock.schema_digest, right.artifactLock.schema_digest);
    assert.equal(Object.isFrozen(left.artifact.input_schema), true);
});

test("task schemas reject malformed inputs, outputs, shapes, and definitions", () => {
    const descriptor = task({
        name: "validate",
        version: "1",
        instruction: "Validate one value.",
        input: schema.object({ value: schema.string() }),
        output: schema.void(),
    });

    assert.throws(() => descriptor.parseInput({}), TypeError);
    assert.throws(() => descriptor.parseInput(null), TypeError);
    assert.throws(() => descriptor.parseInput([]), TypeError);
    assert.throws(() => descriptor.parseInput(new Date()), TypeError);
    assert.throws(() => descriptor.parseInput({ value: "\uD800" }), TypeError);
    assert.throws(() => descriptor.parseInput({ value: 1 }), TypeError);
    assert.throws(() => descriptor.parseInput({ extra: true, value: "ok" }), TypeError);
    assert.throws(
        () => descriptor.parseInput({ [Symbol("invalid")]: true, value: "ok" }),
        TypeError,
    );
    assert.throws(
        () => descriptor.parseInput(Object.defineProperty({}, "value", { get: () => "unsafe" })),
        TypeError,
    );
    assert.throws(() => descriptor.parseOutput("value"), TypeError);
    assert.equal(descriptor.parseOutput(null), undefined);
    assert.throws(() => schema.object({ fake: {} as never }), TypeError);
    for (const shape of [null, [], new Date(), { [Symbol("invalid")]: schema.string() }]) {
        assert.throws(() => schema.object(shape as never), TypeError);
    }
    assert.throws(() => schema.object({ "": schema.string() }), TypeError);
    assert.throws(() => schema.object({ "\uD800": schema.string() }), TypeError);
    assert.throws(
        () => schema.object(Object.defineProperty({}, "value", { get: () => schema.string() })),
        TypeError,
    );

    for (const definition of [
        null,
        1,
        [],
        new Date(),
        { name: "missing" },
        { ...descriptorDefinition(), extra: true },
        { ...descriptorDefinition(), name: "" },
        { ...descriptorDefinition(), version: "" },
        { ...descriptorDefinition(), instruction: "" },
        { ...descriptorDefinition(), instruction: "\uD800" },
        { ...descriptorDefinition(), name: 1 },
        { ...descriptorDefinition(), input: {} },
        { ...descriptorDefinition(), output: {} },
        { ...descriptorDefinition(), [Symbol("invalid")]: true },
        Object.defineProperty(descriptorDefinition(), "name", { get: () => "unsafe" }),
    ]) {
        assert.throws(() => task(definition as never), TypeError);
    }
});

function descriptorDefinition() {
    return {
        name: "validate",
        version: "1",
        instruction: "Validate one value.",
        input: schema.object({ value: schema.string() }),
        output: schema.void(),
    };
}
