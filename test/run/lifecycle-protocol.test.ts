import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { Ajv2020, type AnySchemaObject } from "ajv/dist/2020.js";

const fixture = readJson("../fixtures/run-lifecycle-v1.json") as Record<string, unknown>;
const continuationSchema = readJson(
    "../../spec/schemas/run-continuation-descriptor-v1.schema.json",
) as AnySchemaObject;
const waitingSchema = readJson(
    "../../spec/schemas/run-lifecycle-waiting-v1.schema.json",
) as AnySchemaObject;
const suspendedSchema = readJson(
    "../../spec/schemas/run-lifecycle-suspended-v1.schema.json",
) as AnySchemaObject;
const runningSchema = readJson(
    "../../spec/schemas/run-lifecycle-running-v1.schema.json",
) as AnySchemaObject;

test("published lifecycle schemas accept the independent continuation fixture", () => {
    const validator = new Ajv2020({ strict: true });
    const validateContinuation = validator.compile(continuationSchema);
    const validateWaiting = validator.compile(waitingSchema);
    const validateSuspended = validator.compile(suspendedSchema);
    const validateRunning = validator.compile(runningSchema);

    assert.equal(
        validateContinuation(fixture.continuation_descriptor),
        true,
        validator.errorsText(validateContinuation.errors),
    );
    assert.equal(
        validateWaiting(fixture.waiting),
        true,
        validator.errorsText(validateWaiting.errors),
    );
    assert.equal(
        validateSuspended(fixture.suspended),
        true,
        validator.errorsText(validateSuspended.errors),
    );
    assert.equal(
        validateRunning(fixture.running),
        true,
        validator.errorsText(validateRunning.errors),
    );
});

test("published lifecycle schemas reject malformed or reordered evidence", () => {
    const validator = new Ajv2020({ strict: true });
    const validateContinuation = validator.compile(continuationSchema);
    const validateWaiting = validator.compile(waitingSchema);
    const validateSuspended = validator.compile(suspendedSchema);
    const validateRunning = validator.compile(runningSchema);
    const descriptor = fixture.continuation_descriptor as Record<string, unknown>;
    const constituents = descriptor.constituents as readonly Record<string, unknown>[];
    const waiting = fixture.waiting as Record<string, unknown>;
    const suspended = fixture.suspended as Record<string, unknown>;
    const running = fixture.running as Record<string, unknown>;

    for (const invalid of [
        { ...descriptor, continuation_version: 2 },
        { ...descriptor, constituents: constituents.slice(0, -1) },
        {
            ...descriptor,
            constituents: [constituents[1], constituents[0], ...constituents.slice(2)],
        },
        {
            ...descriptor,
            constituents: constituents.map((value, index) =>
                index === 3 ? { kind: "prerequisite", status: "verified" } : value,
            ),
        },
        {
            ...descriptor,
            constituents: constituents.map((value, index) =>
                index === 2
                    ? { kind: "process", status: "unavailable", receipt_id: "unexpected" }
                    : value,
            ),
        },
        { ...descriptor, extra: true },
    ]) {
        assert.equal(validateContinuation(invalid), false);
    }

    for (const invalid of [
        { ...waiting, lifecycle_version: 2 },
        { ...waiting, status: "suspended" },
        { ...waiting, continuation_descriptor_id: "invalid" },
        { ...waiting, prerequisite: { prerequisite_id: "", kind: "approval" } },
        { ...waiting, extra: true },
    ]) {
        assert.equal(validateWaiting(invalid), false);
    }

    for (const invalid of [
        { ...suspended, lifecycle_version: 2 },
        { ...suspended, status: "waiting" },
        { ...suspended, pause_command_id: "invalid" },
        { ...suspended, extra: true },
    ]) {
        assert.equal(validateSuspended(invalid), false);
    }

    for (const invalid of [
        { ...running, lifecycle_version: 2 },
        { ...running, status: "suspended" },
        { ...running, fencing_token: 0 },
        { ...running, lease_expires_at: -1 },
        { ...running, resume_command_id: "invalid" },
        { ...running, extra: true },
    ]) {
        assert.equal(validateRunning(invalid), false);
    }
});

function readJson(relativePath: string): unknown {
    return JSON.parse(readFileSync(new URL(relativePath, import.meta.url), "utf8")) as unknown;
}
