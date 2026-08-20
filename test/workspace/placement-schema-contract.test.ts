import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { Ajv2020, type AnySchemaObject } from "ajv/dist/2020.js";

const platformSchema = readJson(
    "../../spec/schemas/placement-platform-evidence-v1.schema.json",
) as AnySchemaObject;
const resolutionSchema = readJson(
    "../../spec/schemas/placement-resolution-v1.schema.json",
) as AnySchemaObject;
const journalV3Schema = readJson(
    "../../spec/schemas/world-capture-journal-v3.schema.json",
) as AnySchemaObject;
const grantPlanSchema = readJson(
    "../../spec/schemas/repository-grant-plan-v1.schema.json",
) as AnySchemaObject;
const fixture = readJson("../fixtures/placement-resolution-v1.json") as Record<string, unknown>;

test("published placement schemas accept independent platform, resolution, and journal evidence", () => {
    const validator = new Ajv2020({ strict: true });
    validator.addSchema(platformSchema);
    validator.addSchema(resolutionSchema);
    validator.addSchema(grantPlanSchema);
    const validatePlatform = validator.getSchema(platformSchema.$id as string);
    const validateResolution = validator.getSchema(resolutionSchema.$id as string);
    const validateJournal = validator.compile(journalV3Schema);
    assert.ok(validatePlatform);
    assert.ok(validateResolution);

    assert.equal(
        validatePlatform(fixture.platform),
        true,
        validator.errorsText(validatePlatform.errors),
    );
    assert.equal(
        validateResolution(fixture.resolution),
        true,
        validator.errorsText(validateResolution.errors),
    );
    const journal = {
        base_revision_id: "revision:base",
        binding_id: `sha256:${"0".repeat(64)}`,
        capture_id: "capture:fixture",
        capture_phase: "prepared",
        enforcement: "advisory",
        journal_version: 11,
        max_capture_id_bytes: 256,
        max_text_bytes: 1024,
        placement_resolution: fixture.resolution,
        placement_resolution_id: (fixture.resolution as Record<string, unknown>).resolution_id,
        repository_grant_plan: fixture.repository_grant_plan,
        repository_grant_plan_id: (fixture.repository_grant_plan as Record<string, unknown>)
            .plan_id,
        run_id: "run:fixture",
        runner_id: "runner:fixture",
    };
    assert.equal(validateJournal(journal), true, validator.errorsText(validateJournal.errors));
    assert.equal(validateJournal({ ...journal, repository_grant_plan: null }), false);
});

test("published placement schemas reject malformed or overstated placement evidence", () => {
    const validator = new Ajv2020({ strict: true });
    validator.addSchema(platformSchema);
    const validateResolution = validator.compile(resolutionSchema);
    const platform = fixture.platform as Record<string, unknown>;
    const resolution = fixture.resolution as Record<string, unknown>;

    assert.equal(validateResolution({ ...resolution, extra: true }), false);
    assert.equal(validateResolution({ ...resolution, enforcement: "jailed" }), false);
    assert.equal(validateResolution({ ...resolution, resolved_placement: "jail" }), false);
    assert.equal(validateResolution({ ...resolution, requested_placement: "jail" }), false);
    assert.equal(validateResolution({ ...resolution, reason: "requested-advisory" }), false);
    assert.equal(validateResolution({ ...resolution, status: "refused" }), false);
    assert.equal(validateResolution({ ...resolution, resolution_id: "invalid" }), false);
    const validatePlatform = validator.getSchema(platformSchema.$id as string);
    assert.ok(validatePlatform);
    assert.equal(validatePlatform({ ...platform, family: "other" }), false);
    assert.equal(validatePlatform({ ...platform, wsl_markers: ["UNKNOWN"] }), false);
});

function readJson(relativePath: string): unknown {
    return JSON.parse(readFileSync(new URL(relativePath, import.meta.url), "utf8")) as unknown;
}
