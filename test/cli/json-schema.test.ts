import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { Ajv2020, type AnySchemaObject } from "ajv/dist/2020.js";

import { runCli } from "../../src/cli/cli.ts";

const schema = JSON.parse(
    readFileSync(new URL("../../spec/schemas/cli-output-v1.schema.json", import.meta.url), "utf8"),
) as AnySchemaObject;

test("stable CLI JSON success and error envelopes validate against the generated closed schema", async () => {
    const validate = new Ajv2020({ strict: true }).compile(schema);
    for (const args of [
        ["--help", "--json"],
        ["run", "--help", "--json"],
        ["unknown", "--json"],
        ["run", "start", "--json"],
    ]) {
        const output: string[] = [];
        const errors: string[] = [];
        await runCli(args, {
            cwd: process.cwd(),
            stderr: (text) => errors.push(text),
            stdout: (text) => output.push(text),
        });
        const value = JSON.parse([...output, ...errors].join(""));
        assert.equal(validate(value), true, new Ajv2020().errorsText(validate.errors));
    }

    const valid = JSON.parse(
        '{"cli_compatibility_version":"shepherd.cli.json.v1","cli_output_version":1,"command":[],"ok":true,"result":{"groups":[]}}',
    );
    assert.equal(validate({ ...valid, unexpected: true }), false);
    assert.equal(validate({ ...valid, result: { groups: [], unexpected: true } }), false);
});
