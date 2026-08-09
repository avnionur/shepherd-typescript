import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { Ajv2020, type AnySchemaObject } from "ajv/dist/2020.js";

import { RUN_PROTOCOL_V1_CONTRACT } from "../../src/protocol/compatibility-constants.ts";
import { parseProtocolConfig } from "../../src/protocol/config-validation.ts";

const validConfig = readJson("../../protocol.config.json") as Record<string, unknown>;
const fixture = readJson("../fixtures/run-outcome-v1.json") as Record<string, unknown>;
const outcomeSchema = readJson("../../spec/schemas/run-outcome-v1.schema.json") as AnySchemaObject;

test("published run-outcome schema accepts all four independent fixture variants", () => {
    const validator = new Ajv2020({ strict: true });
    const validate = validator.compile(outcomeSchema);

    for (const outcome of Object.values(fixture)) {
        assert.equal(validate(outcome), true, validator.errorsText(validate.errors));
    }
});

test("published run-outcome schema rejects malformed closed records", () => {
    const validator = new Ajv2020({ strict: true });
    const validate = validator.compile(outcomeSchema);
    const finished = fixture.finished as Record<string, unknown>;
    const failed = fixture.failed as Record<string, unknown>;

    for (const invalid of [
        { ...finished, outcome_version: 2 },
        { ...finished, extra: true },
        { ...finished, outcome: { status: "finished" } },
        { ...failed, outcome: { status: "failed", error_type: "Error", message: "bad" } },
        { ...finished, task_artifact_lock: { artifact_lock_version: 1 } },
    ]) {
        assert.equal(validate(invalid), false);
    }
});

test("run protocol configuration is frozen and compatibility locked", () => {
    const parsed = parseProtocolConfig(structuredClone(validConfig));

    assert.deepEqual(parsed.runs, RUN_PROTOCOL_V1_CONTRACT);
    assert.equal(Object.isFrozen(parsed.runs), true);
    assert.equal(Object.isFrozen(parsed.runs.terminalStatuses), true);
    assert.equal(Object.isFrozen(RUN_PROTOCOL_V1_CONTRACT), true);

    for (const mutate of [
        (runs: Record<string, unknown>) => {
            runs.outcomeVersion = 0;
        },
        (runs: Record<string, unknown>) => {
            runs.outcomeVersion = 2;
        },
        (runs: Record<string, unknown>) => {
            runs.terminalStatuses = [];
        },
        (runs: Record<string, unknown>) => {
            runs.terminalStatuses = ["finished", "failed", "exhausted", "stopped"];
        },
        (runs: Record<string, unknown>) => {
            (runs.schemas as Record<string, unknown>).outcomeId = "relative";
        },
        (runs: Record<string, unknown>) => {
            (runs.artifacts as Record<string, unknown>).outcomeSchema = "";
        },
    ]) {
        const candidate = structuredClone(validConfig);
        mutate(candidate.runs as Record<string, unknown>);
        assert.throws(() => parseProtocolConfig(candidate), TypeError);
    }
});

function readJson(relativePath: string): unknown {
    return JSON.parse(readFileSync(new URL(relativePath, import.meta.url), "utf8")) as unknown;
}
