import assert from "node:assert/strict";
import { test } from "node:test";

import { RETAINED_WORLD_SETTLEMENT_VERSION } from "../../src/protocol/values.generated.ts";
import { encodeRetainedWorldApplicationPlan } from "../../src/store/retained-world-application-codec.ts";
import {
    decodeRetainedWorldSettlementOperation,
    decodeRetainedWorldSettlementTerminalReceipt,
    encodeRetainedWorldSettlementOperation,
    encodeRetainedWorldSettlementTerminalReceipt,
} from "../../src/store/retained-world-settlement-codec.ts";
import type {
    RetainedWorldSettlementAdmission,
    RetainedWorldSettlementRequest,
} from "../../src/store/types.ts";

const request = Object.freeze({
    action: "select",
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

const admission = Object.freeze({
    action: request.action,
    command_id: request.command_id,
    output_id: request.output_id,
    request,
    request_id: "request:one",
    state: "prepared",
} satisfies RetainedWorldSettlementAdmission);

test("settlement operation and selected receipt codecs are deterministic and exact", () => {
    const operation = encodeRetainedWorldSettlementOperation(admission);
    assert.deepEqual(encodeRetainedWorldSettlementOperation(admission), operation);
    assert.deepEqual(decodeRetainedWorldSettlementOperation(operation.json, admission), operation);
    assert.match(operation.id, /^world-settlement-operation:sha256:[0-9a-f]{64}$/u);

    const receipt = encodeRetainedWorldSettlementTerminalReceipt(operation, {
        action: "select",
        publication_id: "publication:one",
        user_basis_after: "basis:after",
    });
    assert.deepEqual(
        decodeRetainedWorldSettlementTerminalReceipt(receipt.json, operation),
        receipt,
    );
    assert.equal(receipt.value.state, "selected");
    assert.equal(Object.isFrozen(receipt.value), true);
    assert.throws(
        () => decodeRetainedWorldSettlementOperation(`${operation.json} `, admission),
        TypeError,
    );
    assert.throws(
        () => decodeRetainedWorldSettlementTerminalReceipt(`${receipt.json} `, operation),
        TypeError,
    );
    for (const invalid of [
        "{",
        "null",
        "[]",
        JSON.stringify({ ...receipt.value, action: "unknown" }),
        JSON.stringify({ ...receipt.value, user_basis_after: 1 }),
        JSON.stringify({ ...receipt.value, publication_id: 1 }),
    ]) {
        assert.throws(
            () => decodeRetainedWorldSettlementTerminalReceipt(invalid, operation),
            TypeError,
        );
    }
    assert.throws(
        () =>
            encodeRetainedWorldSettlementTerminalReceipt(operation, {
                action: "select",
                publication_id: "",
                user_basis_after: "basis:after",
            }),
        TypeError,
    );
});

test("discard receipts bind an unchanged basis and explicit cleanup state", () => {
    const discardRequest = Object.freeze({
        ...request,
        action: "discard",
    }) satisfies RetainedWorldSettlementRequest;
    const discardAdmission = Object.freeze({
        ...admission,
        action: discardRequest.action,
        request: discardRequest,
    }) satisfies RetainedWorldSettlementAdmission;
    const operation = encodeRetainedWorldSettlementOperation(discardAdmission);
    const receipt = encodeRetainedWorldSettlementTerminalReceipt(operation, {
        action: "discard",
        cleanup_completed: false,
        user_basis_after: discardRequest.user_basis_before,
    });
    assert.equal(receipt.value.state, "discarded");
    assert.equal(receipt.value.cleanup_completed, false);
    assert.deepEqual(
        decodeRetainedWorldSettlementTerminalReceipt(receipt.json, operation),
        receipt,
    );
    assert.throws(
        () =>
            encodeRetainedWorldSettlementTerminalReceipt(operation, {
                action: "discard",
                cleanup_completed: true,
                user_basis_after: "basis:moved",
            }),
        TypeError,
    );
    assert.throws(
        () =>
            decodeRetainedWorldSettlementTerminalReceipt(
                JSON.stringify({ ...receipt.value, cleanup_completed: "yes" }),
                operation,
            ),
        TypeError,
    );
    assert.throws(
        () =>
            encodeRetainedWorldSettlementTerminalReceipt(operation, {
                action: "select",
                publication_id: "publication:wrong",
                user_basis_after: "basis:after",
            }),
        TypeError,
    );
});

test("apply operations bind the exact three-way plan and applied receipt", () => {
    const applyRequest = Object.freeze({
        ...request,
        action: "apply",
    }) satisfies RetainedWorldSettlementRequest;
    const applyAdmission = Object.freeze({
        ...admission,
        action: applyRequest.action,
        request: applyRequest,
    }) satisfies RetainedWorldSettlementAdmission;
    const plan = encodeRetainedWorldApplicationPlan({
        application_custody_id: "custody:application",
        base_content_id: applyRequest.user_basis_before,
        base_revision_id: applyRequest.base_revision_id,
        binding_id: applyRequest.binding_id,
        candidate_changeset_id: applyRequest.changeset_id,
        candidate_content_id: "content:candidate",
        candidate_paths: ["candidate.txt"],
        candidate_revision_id: applyRequest.head_revision_id,
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
    });
    assert.throws(() => encodeRetainedWorldSettlementOperation(applyAdmission), TypeError);
    assert.throws(() => encodeRetainedWorldSettlementOperation(admission, plan), TypeError);
    const operation = encodeRetainedWorldSettlementOperation(applyAdmission, plan);
    assert.deepEqual(
        decodeRetainedWorldSettlementOperation(operation.json, applyAdmission),
        operation,
    );
    const receipt = encodeRetainedWorldSettlementTerminalReceipt(operation, {
        action: "apply",
        applied_revision_id: plan.merged_revision_id,
        application_plan_id: plan.plan_id,
        publication_id: "publication:apply",
        user_basis_after: plan.merged_content_id,
    });
    assert.equal(receipt.value.state, "applied");
    assert.deepEqual(
        decodeRetainedWorldSettlementTerminalReceipt(receipt.json, operation),
        receipt,
    );
    for (const invalid of [
        { applied_revision_id: "revision:different" },
        { application_plan_id: "plan:different" },
        { user_basis_after: "content:different" },
    ]) {
        assert.throws(
            () =>
                encodeRetainedWorldSettlementTerminalReceipt(operation, {
                    action: "apply",
                    applied_revision_id: plan.merged_revision_id,
                    application_plan_id: plan.plan_id,
                    publication_id: "publication:apply",
                    user_basis_after: plan.merged_content_id,
                    ...invalid,
                }),
            TypeError,
        );
    }
    for (const invalid of [
        { ...receipt.value, applied_revision_id: 1 },
        { ...receipt.value, application_plan_id: 1 },
        { ...receipt.value, publication_id: 1 },
        { ...receipt.value, user_basis_after: "content:different" },
    ]) {
        assert.throws(
            () => decodeRetainedWorldSettlementTerminalReceipt(JSON.stringify(invalid), operation),
            TypeError,
        );
    }
});

test("release operations bind the preserved custody and receipt-only basis", () => {
    const releaseRequest = Object.freeze({
        ...request,
        action: "release",
    }) satisfies RetainedWorldSettlementRequest;
    const releaseAdmission = Object.freeze({
        ...admission,
        action: releaseRequest.action,
        request: releaseRequest,
    }) satisfies RetainedWorldSettlementAdmission;
    const releaseBasis = "basis:current";
    assert.throws(() => encodeRetainedWorldSettlementOperation(releaseAdmission), TypeError);
    const operation = encodeRetainedWorldSettlementOperation(releaseAdmission, null, releaseBasis);
    const receipt = encodeRetainedWorldSettlementTerminalReceipt(operation, {
        action: "release",
        changeset_id: releaseRequest.changeset_id,
        custody_id: releaseRequest.custody_id,
        head_revision_id: releaseRequest.head_revision_id,
        user_basis_after: releaseBasis,
        user_basis_before: releaseBasis,
    });
    assert.equal(receipt.value.state, "released");
    assert.deepEqual(
        decodeRetainedWorldSettlementTerminalReceipt(receipt.json, operation),
        receipt,
    );
    for (const invalid of [
        { changeset_id: "changeset:different" },
        { custody_id: "custody:different" },
        { head_revision_id: "revision:different" },
        { user_basis_after: "basis:different" },
    ]) {
        assert.throws(
            () =>
                encodeRetainedWorldSettlementTerminalReceipt(operation, {
                    action: "release",
                    changeset_id: releaseRequest.changeset_id,
                    custody_id: releaseRequest.custody_id,
                    head_revision_id: releaseRequest.head_revision_id,
                    user_basis_after: releaseBasis,
                    user_basis_before: releaseBasis,
                    ...invalid,
                }),
            TypeError,
        );
    }
    for (const invalid of [
        { ...receipt.value, base_revision_id: "revision:different" },
        { ...receipt.value, binding_id: "binding:different" },
        { ...receipt.value, changeset_id: 1 },
        { ...receipt.value, compatibility_version: "other" },
        { ...receipt.value, custody_id: 1 },
        { ...receipt.value, head_revision_id: 1 },
        { ...receipt.value, output_id: "output:different" },
    ]) {
        assert.throws(
            () => decodeRetainedWorldSettlementTerminalReceipt(JSON.stringify(invalid), operation),
            TypeError,
        );
    }
});
