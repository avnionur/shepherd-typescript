import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { Ajv2020, type AnySchemaObject } from "ajv/dist/2020.js";

const descriptorSchema = readJson(
    "../../spec/schemas/task-descriptor-v1.schema.json",
) as AnySchemaObject;
const lockSchema = readJson(
    "../../spec/schemas/task-artifact-lock-v1.schema.json",
) as AnySchemaObject;
const fixture = readJson("../fixtures/task-descriptor-v1.json") as Record<string, unknown>;

test("published task schemas accept the independent descriptor and lock fixture", () => {
    const validator = new Ajv2020({ strict: true });
    const validateDescriptor = validator.compile(descriptorSchema);
    const validateLock = validator.compile(lockSchema);

    assert.equal(
        validateDescriptor(fixture.artifact),
        true,
        validator.errorsText(validateDescriptor.errors),
    );
    assert.equal(
        validateLock(fixture.artifact_lock),
        true,
        validator.errorsText(validateLock.errors),
    );
});

test("published task schemas reject unknown fields and malformed identities", () => {
    const validator = new Ajv2020({ strict: true });
    const validateDescriptor = validator.compile(descriptorSchema);
    const validateLock = validator.compile(lockSchema);
    const artifact = fixture.artifact as Record<string, unknown>;
    const lock = fixture.artifact_lock as Record<string, unknown>;

    assert.equal(validateDescriptor({ ...artifact, extra: true }), false);
    assert.equal(validateDescriptor({ ...artifact, instruction: "" }), false);
    assert.equal(validateLock({ ...lock, artifact_digest: "invalid" }), false);
    assert.equal(validateLock({ ...lock, task_id: "invalid" }), false);
});

function readJson(relativePath: string): unknown {
    return JSON.parse(readFileSync(new URL(relativePath, import.meta.url), "utf8")) as unknown;
}
