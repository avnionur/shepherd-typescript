import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { Ajv2020, type AnySchemaObject } from "ajv/dist/2020.js";

import { inspectRetainedWorldApplicationConflicts } from "../../src/index.ts";
import {
    encodeRetainedWorldApplicationPlan,
    readRetainedWorldApplicationPlan,
} from "../../src/store/retained-world-application-codec.ts";
import {
    encodeRetainedWorldSettlementOperation,
    encodeRetainedWorldSettlementTerminalReceipt,
} from "../../src/store/retained-world-settlement-codec.ts";
import type { RetainedWorldSettlementAdmission } from "../../src/store/types.ts";

const conflictSchema = readSchema("retained-world-application-conflict-v1.schema.json");
const planSchema = readSchema("retained-world-application-plan-v1.schema.json");
const receiptSchema = readSchema("retained-world-application-receipt-v1.schema.json");

test("application schemas accept exact codec evidence and reject malformed copies", () => {
    const plan = encodeRetainedWorldApplicationPlan({
        application_custody_id: "world-custody:application",
        base_content_id: "world-content:base",
        base_revision_id: "world-revision:base",
        binding_id: "sha256:binding",
        candidate_changeset_id: "world-changeset:candidate",
        candidate_content_id: "world-content:candidate",
        candidate_paths: ["candidate.txt"],
        candidate_revision_id: "world-revision:candidate",
        current_changeset_id: "world-changeset:current",
        current_content_id: "world-content:current",
        current_paths: ["current.txt"],
        current_revision_id: "world-revision:current",
        merged_content_id: "world-content:merged",
        merged_revision_id: "world-revision:merged",
        publication_changeset_id: "world-changeset:publication",
        reason: "path-disjoint",
        request_id: "world-settlement:request",
        status: "planned",
    });
    const request = Object.freeze({
        action: "apply",
        base_revision_id: plan.base_revision_id,
        binding_id: plan.binding_id,
        capture_record_id: "sha256:capture",
        changeset_id: plan.candidate_changeset_id,
        command_id: "command:apply",
        custody_id: "world-custody:candidate",
        execution_cut_id: "cut:apply",
        head_revision_id: plan.candidate_revision_id,
        output_id: "world-output:apply",
        run_id: "run:apply",
        settlement_version: 12,
        user_basis_before: plan.base_content_id,
    }) satisfies RetainedWorldSettlementAdmission["request"];
    const admission = Object.freeze({
        action: request.action,
        command_id: request.command_id,
        output_id: request.output_id,
        request,
        request_id: plan.request_id,
        state: "prepared",
    }) satisfies RetainedWorldSettlementAdmission;
    const operation = encodeRetainedWorldSettlementOperation(admission, plan);
    const receipt = encodeRetainedWorldSettlementTerminalReceipt(operation, {
        action: "apply",
        applied_revision_id: plan.merged_revision_id,
        application_plan_id: plan.plan_id,
        publication_id: "world-selection-publication:apply",
        user_basis_after: plan.merged_content_id,
    }).value;
    const conflict = inspectRetainedWorldApplicationConflicts({
        candidatePaths: ["same.txt"],
        currentPaths: ["SAME.txt"],
    });
    assert.ok(conflict);

    const validator = new Ajv2020({ strict: true });
    for (const schema of [conflictSchema, planSchema, receiptSchema]) validator.addSchema(schema);
    for (const [schema, value] of [
        [conflictSchema, conflict],
        [planSchema, plan],
        [receiptSchema, receipt],
    ] as const) {
        const validate = validator.getSchema(schema.$id as string);
        assert.ok(validate);
        assert.equal(validate(value), true, validator.errorsText(validate.errors));
        assert.equal(validate({ ...value, extra: true }), false);
    }
    assert.deepEqual(readRetainedWorldApplicationPlan(plan), plan);
    for (const invalid of [
        null,
        [],
        { ...plan, plan_id: "invalid" },
        { ...plan, application_version: 2 },
        { ...plan, compatibility_version: "other" },
        { ...plan, candidate_paths: ["same", "same"] },
        { ...plan, current_paths: {} },
        { ...plan, reason: "unknown" },
        { ...plan, request_id: "" },
        { ...plan, extra: true },
        Object.defineProperty({ ...plan }, "request_id", { get: () => plan.request_id }),
    ]) {
        assert.throws(() => readRetainedWorldApplicationPlan(invalid), TypeError);
    }
});

function readSchema(name: string): AnySchemaObject {
    return JSON.parse(
        readFileSync(new URL(`../../spec/schemas/${name}`, import.meta.url), "utf8"),
    ) as AnySchemaObject;
}
