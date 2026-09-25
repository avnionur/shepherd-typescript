import assert from "node:assert/strict";
import { test } from "node:test";

import { RETAINED_WORLD_SETTLEMENT_VERSION } from "../../src/protocol/values.generated.ts";
import { encodeRetainedWorldApplicationPlan } from "../../src/store/retained-world-application-codec.ts";
import {
    decodeRetainedWorldSettlementOperation,
    encodeRetainedWorldSettlementOperation,
} from "../../src/store/retained-world-settlement-codec.ts";
import type {
    RetainedWorldSettlementAdmission,
    RetainedWorldSettlementRequest,
} from "../../src/store/types.ts";

const request = Object.freeze({
    action: "apply",
    base_revision_id: "revision:base",
    binding_id: "binding:one",
    capture_record_id: "record:capture",
    changeset_id: "changeset:one",
    command_id: "command:one",
    custody_id: "custody:one",
    execution_cut_id: "cut:one",
    head_revision_id: "revision:head",
    output_id: "output:one",
    run_id: "run:one",
    settlement_version: RETAINED_WORLD_SETTLEMENT_VERSION,
    user_basis_before: "basis:before",
} satisfies RetainedWorldSettlementRequest);

const applyAdmission = Object.freeze({
    action: request.action,
    command_id: request.command_id,
    output_id: request.output_id,
    request,
    request_id: "request:one",
    state: "prepared",
} satisfies RetainedWorldSettlementAdmission);

const releaseRequest = Object.freeze({
    ...request,
    action: "release",
}) satisfies RetainedWorldSettlementRequest;
const releaseAdmission = Object.freeze({
    ...applyAdmission,
    action: releaseRequest.action,
    request: releaseRequest,
}) satisfies RetainedWorldSettlementAdmission;

const planFields = {
    application_custody_id: "custody:application",
    base_content_id: request.user_basis_before,
    base_revision_id: request.base_revision_id,
    binding_id: request.binding_id,
    candidate_changeset_id: request.changeset_id,
    candidate_content_id: "content:candidate",
    candidate_paths: ["candidate.txt"],
    candidate_revision_id: request.head_revision_id,
    current_changeset_id: "changeset:current",
    current_content_id: "content:current",
    current_paths: ["current.txt"],
    current_revision_id: "revision:current",
    merged_content_id: "content:merged",
    merged_revision_id: "revision:merged",
    publication_changeset_id: "changeset:publication",
    reason: "path-disjoint",
    request_id: applyAdmission.request_id,
    status: "planned",
} as const;

/** Asserts one TypeError whose message matches `message`. */
function refuses(operation: () => unknown, message: RegExp): void {
    assert.throws(
        operation,
        (error: unknown) => error instanceof TypeError && message.test(error.message),
    );
}

test("operation encoding refuses planning evidence that does not fit the admitted action", () => {
    const plan = encodeRetainedWorldApplicationPlan(planFields);
    refuses(
        () => encodeRetainedWorldSettlementOperation(applyAdmission, plan, "basis:current"),
        /apply settlement operation cannot carry a release basis/u,
    );
    refuses(
        () => encodeRetainedWorldSettlementOperation(releaseAdmission, plan, "basis:current"),
        /release settlement operation cannot carry an application plan/u,
    );
    for (const mismatch of [
        { request_id: "request:other" },
        { binding_id: "binding:other" },
        { base_revision_id: "revision:other" },
        { candidate_revision_id: "revision:other" },
        { candidate_changeset_id: "changeset:other" },
    ]) {
        refuses(
            () =>
                encodeRetainedWorldSettlementOperation(
                    applyAdmission,
                    encodeRetainedWorldApplicationPlan({ ...planFields, ...mismatch }),
                ),
            /application plan differs from settlement admission/u,
        );
    }
});

test("operation decoding refuses non-object and basis-less evidence for planned actions", () => {
    for (const admission of [applyAdmission, releaseAdmission]) {
        for (const json of ["{", "null", "[]", "1"]) {
            refuses(
                () => decodeRetainedWorldSettlementOperation(json, admission),
                /settlement operation evidence is invalid/u,
            );
        }
    }
    refuses(
        () => decodeRetainedWorldSettlementOperation("{}", releaseAdmission),
        /release_basis_id/u,
    );
    const operation = encodeRetainedWorldSettlementOperation(
        releaseAdmission,
        null,
        "basis:current",
    );
    assert.deepEqual(
        decodeRetainedWorldSettlementOperation(operation.json, releaseAdmission),
        operation,
    );
});
