import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { Ajv2020, type AnySchemaObject } from "ajv/dist/2020.js";

import { RECORD_MODES } from "../src/index.ts";

type EnvelopeSchema = AnySchemaObject & {
    readonly properties: {
        readonly mode: {
            readonly enum: readonly string[];
        };
    };
    readonly $defs: {
        readonly recordId: {
            readonly pattern: string;
        };
    };
};

type ProtocolConfiguration = {
    readonly kernel: {
        readonly abiVersion: string;
        readonly canonicalVersion: string;
        readonly recordModes: readonly string[];
    };
    readonly recordId: {
        readonly hexLength: number;
        readonly prefix: string;
    };
};

type RecordFixture = {
    readonly abi_version: string;
    readonly canonical_version: string;
    readonly records: readonly {
        readonly digest: string;
        readonly input: {
            readonly body: Readonly<Record<string, unknown>>;
            readonly caused_by: readonly string[];
            readonly mode: string;
            readonly schema_ref: string;
            readonly witness: string;
        };
    }[];
};

const bodySchema = readJson("../spec/schemas/record-body-v0.schema.json") as AnySchemaObject;
const envelopeSchema = readJson("../spec/schemas/record-envelope-v0.schema.json") as EnvelopeSchema;
const protocolConfig = readJson("../protocol.config.json") as ProtocolConfiguration;
const fixture = readJson("./fixtures/kernel-record-envelope-v0.json") as RecordFixture;

test("published schemas are valid JSON Schema 2020-12 documents", () => {
    const validator = new Ajv2020({ strict: true });

    assert.equal(validator.validateSchema(bodySchema), true, validator.errorsText());
    assert.equal(validator.validateSchema(envelopeSchema), true, validator.errorsText());
});

test("published schemas accept the pinned record vectors", () => {
    const validator = new Ajv2020({ strict: true });
    const validateBody = validator.compile(bodySchema);
    const validateEnvelope = validator.compile(envelopeSchema);

    for (const vector of fixture.records) {
        assert.equal(
            validateBody(vector.input.body),
            true,
            validator.errorsText(validateBody.errors),
        );
        assert.equal(
            validateEnvelope({
                record_id: vector.digest,
                digest: vector.digest,
                schema_ref: vector.input.schema_ref,
                mode: vector.input.mode,
                witness_ref: vector.input.witness,
                caused_by_record_ids: vector.input.caused_by,
            }),
            true,
            validator.errorsText(validateEnvelope.errors),
        );
    }
});

test("published schemas reject invalid body and envelope shapes", () => {
    const validator = new Ajv2020({ strict: true });
    const validateBody = validator.compile(bodySchema);
    const validateEnvelope = validator.compile(envelopeSchema);
    const validId = `sha256:${"1".repeat(64)}`;
    const validEnvelope = {
        record_id: validId,
        digest: validId,
        schema_ref: "example.record.v1",
        mode: "capture",
        witness_ref: validId,
        caused_by_record_ids: [],
    };

    assert.equal(validateBody([]), false);
    assert.equal(validateBody({ value: undefined }), false);
    assert.equal(validateEnvelope({ ...validEnvelope, schema_ref: "" }), false);
    assert.equal(validateEnvelope({ ...validEnvelope, mode: "observed" }), false);
    assert.equal(validateEnvelope({ ...validEnvelope, record_id: "invalid" }), false);
    assert.equal(validateEnvelope({ ...validEnvelope, caused_by_record_ids: ["invalid"] }), false);
    assert.equal(validateEnvelope({ ...validEnvelope, extra: true }), false);
    const { digest: _digest, ...missingDigest } = validEnvelope;
    assert.equal(validateEnvelope(missingDigest), false);
});

test("configured protocol values cannot drift from types, schemas, or fixtures", () => {
    assert.deepEqual(protocolConfig.kernel.recordModes, RECORD_MODES);
    assert.deepEqual(envelopeSchema.properties.mode.enum, RECORD_MODES);
    assert.equal(
        envelopeSchema.$defs.recordId.pattern,
        `^${protocolConfig.recordId.prefix}[0-9a-f]{${protocolConfig.recordId.hexLength}}$`,
    );
    assert.equal(fixture.abi_version, protocolConfig.kernel.abiVersion);
    assert.equal(fixture.canonical_version, protocolConfig.kernel.canonicalVersion);
});

function readJson(relativePath: string): unknown {
    return JSON.parse(readFileSync(new URL(relativePath, import.meta.url), "utf8")) as unknown;
}
