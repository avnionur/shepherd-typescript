import assert from "node:assert/strict";
import { test } from "node:test";

import { RETAINED_WORLD_SETTLEMENT_VERSION } from "../../src/protocol/values.generated.ts";
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
