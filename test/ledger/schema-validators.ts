import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

import { Ajv2020, type AnySchemaObject, type ValidateFunction } from "ajv/dist/2020.js";

/** Compiles generated evidence schemas with every packaged protocol dependency. */
export function evidenceSchemaValidators(): {
    readonly outputCitation: ValidateFunction;
    readonly recoveryRecord: ValidateFunction;
    readonly traceRevision: ValidateFunction;
} {
    const validator = new Ajv2020({ strict: true });
    validator.addKeyword("x-shepherd-max-canonical-bytes");
    const schemaDirectory = new URL("../../spec/schemas/", import.meta.url);
    for (const name of readdirSync(schemaDirectory).filter((candidate) =>
        candidate.endsWith(".schema.json"),
    )) {
        validator.addSchema(
            JSON.parse(readFileSync(new URL(name, schemaDirectory), "utf8")) as AnySchemaObject,
        );
    }
    const outputCitation = validator.getSchema(
        "https://avnionur.github.io/shepherd-typescript/schemas/output-citation-entry-v1.schema.json",
    );
    const recoveryRecord = validator.getSchema(
        "https://avnionur.github.io/shepherd-typescript/schemas/recovery-record-entry-v1.schema.json",
    );
    const traceRevision = validator.getSchema(
        "https://avnionur.github.io/shepherd-typescript/schemas/trace-revision-entry-v1.schema.json",
    );
    assert.ok(outputCitation);
    assert.ok(recoveryRecord);
    assert.ok(traceRevision);
    return { outputCitation, recoveryRecord, traceRevision };
}
