import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { Ajv2020, type AnySchemaObject } from "ajv/dist/2020.js";

import { RETAINED_WORLD_SETTLEMENT_VERSION } from "../../src/index.ts";
import {
    encodeRetainedWorldSettlementOperation,
    encodeRetainedWorldSettlementTerminalReceipt,
} from "../../src/store/retained-world-settlement-codec.ts";
import type { RetainedWorldSettlementAdmission } from "../../src/store/types.ts";

test("release receipt schema accepts exact codec evidence and rejects malformed copies", () => {
    const request = Object.freeze({
        action: "release",
        base_revision_id: "world-revision:base",
        binding_id: "workspace-binding:one",
        capture_record_id: "sha256:capture",
        changeset_id: "world-changeset:candidate",
        command_id: "command:release",
        custody_id: "world-custody:candidate",
        execution_cut_id: "cut:release",
        head_revision_id: "world-revision:candidate",
        output_id: "world-output:release",
        run_id: "run:release",
        settlement_version: RETAINED_WORLD_SETTLEMENT_VERSION,
        user_basis_before: "world-content:base",
    } as const);
    const admission = Object.freeze({
        action: request.action,
        command_id: request.command_id,
        output_id: request.output_id,
        request,
        request_id: "world-settlement:request",
        state: "prepared",
    }) satisfies RetainedWorldSettlementAdmission;
    const operation = encodeRetainedWorldSettlementOperation(
        admission,
        null,
        "world-content:current",
    );
    const receipt = encodeRetainedWorldSettlementTerminalReceipt(operation, {
        action: "release",
        changeset_id: request.changeset_id,
        custody_id: request.custody_id,
        head_revision_id: request.head_revision_id,
        user_basis_after: "world-content:current",
        user_basis_before: "world-content:current",
    }).value;
    const schema = JSON.parse(
        readFileSync(
            new URL(
                "../../spec/schemas/retained-world-release-receipt-v1.schema.json",
                import.meta.url,
            ),
            "utf8",
        ),
    ) as AnySchemaObject;
    const validate = new Ajv2020({ strict: true }).compile(schema);
    assert.equal(validate(receipt), true, new Ajv2020().errorsText(validate.errors));
    assert.equal(validate({ ...receipt, extra: true }), false);
    assert.equal(validate({ ...receipt, compatibility_version: "other" }), false);
    assert.equal(validate({ ...receipt, custody_id: "" }), false);
    assert.equal(validate({ ...receipt, state: "discarded" }), false);
});
