import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { Ajv2020, type AnySchemaObject } from "ajv/dist/2020.js";

const artifactSchema = readJson(
    "../../spec/schemas/repository-task-grant-v1.schema.json",
) as AnySchemaObject;
const lockSchema = readJson(
    "../../spec/schemas/repository-task-grant-lock-v1.schema.json",
) as AnySchemaObject;
const planSchema = readJson(
    "../../spec/schemas/repository-grant-plan-v1.schema.json",
) as AnySchemaObject;
const journalV1Schema = readJson(
    "../../spec/schemas/world-capture-journal-v1.schema.json",
) as AnySchemaObject;
const journalV2Schema = readJson(
    "../../spec/schemas/world-capture-journal-v2.schema.json",
) as AnySchemaObject;
const fixture = readJson("../fixtures/repository-task-grant-v1.json") as Record<string, unknown>;
const digest = `sha256:${"0".repeat(64)}`;
const plan = {
    authority_ceiling: "read-only",
    enforcement: "advisory",
    grants: [
        {
            authority: ["read"],
            binding_id: digest,
            binding_name: "docs",
            resource_id: digest,
            task_profile: "read-only",
        },
    ],
    grant_plan_version: 1,
    plan_id: `repository-grant-plan:${digest}`,
    task_artifact_digest: digest,
    task_grant_artifact_digest: digest,
};

test("published repository grant schemas accept independent artifacts and plans", () => {
    const validator = new Ajv2020({ strict: true });
    const validateArtifact = validator.compile(artifactSchema);
    const validateLock = validator.compile(lockSchema);
    const validatePlan = validator.compile(planSchema);

    assert.equal(
        validateArtifact(fixture.artifact),
        true,
        validator.errorsText(validateArtifact.errors),
    );
    assert.equal(
        validateLock(fixture.artifact_lock),
        true,
        validator.errorsText(validateLock.errors),
    );
    assert.equal(validatePlan(plan), true, validator.errorsText(validatePlan.errors));

    const journalValidator = new Ajv2020({ strict: true });
    journalValidator.addSchema(planSchema);
    const validateJournalV2 = journalValidator.compile(journalV2Schema);
    assert.equal(
        validateJournalV2({
            base_revision_id: "revision:base",
            binding_id: digest,
            capture_id: "capture:granted",
            capture_phase: "prepared",
            enforcement: "advisory",
            journal_version: 10,
            max_capture_id_bytes: 256,
            max_text_bytes: 1024,
            repository_grant_plan: plan,
            repository_grant_plan_id: plan.plan_id,
            run_id: "run:granted",
            runner_id: "runner:granted",
        }),
        true,
        journalValidator.errorsText(validateJournalV2.errors),
    );
    const validateJournalV1 = new Ajv2020({ strict: true }).compile(journalV1Schema);
    assert.equal(
        validateJournalV1({
            base_revision_id: "revision:base",
            binding_id: digest,
            capture_id: "capture:legacy",
            capture_phase: "prepared",
            enforcement: "advisory",
            journal_version: 9,
            max_capture_id_bytes: 256,
            max_text_bytes: 1024,
            run_id: "run:legacy",
            runner_id: "runner:legacy",
        }),
        true,
        validator.errorsText(validateJournalV1.errors),
    );
});

test("published repository grant schemas reject open and malformed evidence", () => {
    const validator = new Ajv2020({ strict: true });
    const validateArtifact = validator.compile(artifactSchema);
    const validateLock = validator.compile(lockSchema);
    const validatePlan = validator.compile(planSchema);
    const artifact = fixture.artifact as Record<string, unknown>;
    const lock = fixture.artifact_lock as Record<string, unknown>;

    assert.equal(validateArtifact({ ...artifact, extra: true }), false);
    assert.equal(validateArtifact({ ...artifact, grants: [] }), false);
    assert.equal(
        validateArtifact({
            ...artifact,
            grants: [{ binding: "../repo", profile: "read-only" }],
        }),
        false,
    );
    assert.equal(validateLock({ ...lock, task_grant_id: "invalid" }), false);
    assert.equal(validatePlan({ ...plan, authority_ceiling: "admin" }), false);
    assert.equal(validatePlan({ ...plan, grants: [] }), false);
    assert.equal(validatePlan({ ...plan, plan_id: "invalid" }), false);
});

function readJson(relativePath: string): unknown {
    return JSON.parse(readFileSync(new URL(relativePath, import.meta.url), "utf8")) as unknown;
}
