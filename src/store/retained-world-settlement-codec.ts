import { createHash } from "node:crypto";

import { canonicalizeRecord, type SemanticRecord } from "../canonical/canonical-record.ts";
import { workspaceProtocolConfig } from "../protocol/config.ts";
import {
    RETAINED_WORLD_SETTLEMENT_ACTIONS,
    RETAINED_WORLD_SETTLEMENT_OPERATION_VERSION,
    RETAINED_WORLD_SETTLEMENT_RECEIPT_VERSION,
    RETAINED_WORLD_SETTLEMENT_STATES,
} from "../protocol/values.generated.ts";
import { assertNonEmptyString } from "../record/guards.ts";
import type { RetainedWorldSettlementAdmission } from "./types.ts";

const [, , SELECTED_STATE, DISCARDED_STATE] = RETAINED_WORLD_SETTLEMENT_STATES;
const [SELECT_ACTION, DISCARD_ACTION] = RETAINED_WORLD_SETTLEMENT_ACTIONS;

type RetainedWorldSettlementOperation = Readonly<{
    action: RetainedWorldSettlementAdmission["action"];
    operation_version: typeof RETAINED_WORLD_SETTLEMENT_OPERATION_VERSION;
    request: RetainedWorldSettlementAdmission["request"];
    request_id: string;
}>;

/** @internal Canonical operation encoding retained by the settlement journal. */
export type RetainedWorldSettlementOperationEncoding = Readonly<{
    digest: string;
    id: string;
    json: string;
    value: RetainedWorldSettlementOperation;
}>;

type RetainedWorldSettlementTerminalReceipt =
    | Readonly<{
          action: typeof SELECT_ACTION;
          operation_id: string;
          publication_id: string;
          receipt_version: typeof RETAINED_WORLD_SETTLEMENT_RECEIPT_VERSION;
          request_id: string;
          state: typeof SELECTED_STATE;
          user_basis_after: string;
      }>
    | Readonly<{
          action: typeof DISCARD_ACTION;
          cleanup_completed: boolean;
          operation_id: string;
          receipt_version: typeof RETAINED_WORLD_SETTLEMENT_RECEIPT_VERSION;
          request_id: string;
          state: typeof DISCARDED_STATE;
          user_basis_after: string;
      }>;

/** @internal Canonical terminal-receipt encoding retained by the settlement journal. */
export type RetainedWorldSettlementReceiptEncoding = Readonly<{
    digest: string;
    json: string;
    value: RetainedWorldSettlementTerminalReceipt;
}>;

/** @internal Action-specific evidence accepted by the terminal journal transition. */
export type RetainedWorldSettlementTerminalEvidence =
    | Readonly<{
          action: typeof SELECT_ACTION;
          publication_id: string;
          user_basis_after: string;
      }>
    | Readonly<{
          action: typeof DISCARD_ACTION;
          cleanup_completed: boolean;
          user_basis_after: string;
      }>;

/** Canonically encodes the deterministic operation bound to one authenticated admission. */
export function encodeRetainedWorldSettlementOperation(
    admission: RetainedWorldSettlementAdmission,
): RetainedWorldSettlementOperationEncoding {
    const value = Object.freeze({
        action: admission.action,
        operation_version: RETAINED_WORLD_SETTLEMENT_OPERATION_VERSION,
        request: admission.request,
        request_id: admission.request_id,
    });
    const json = canonicalizeRecord(value as unknown as SemanticRecord);
    const digest = digestText(json);
    return Object.freeze({
        digest,
        id: `${workspaceProtocolConfig.settlement.operationIdPrefix}${digest}`,
        json,
        value,
    });
}

/** Decodes only the canonical operation encoding for the exact authenticated admission. */
export function decodeRetainedWorldSettlementOperation(
    json: string,
    admission: RetainedWorldSettlementAdmission,
): RetainedWorldSettlementOperationEncoding {
    const expected = encodeRetainedWorldSettlementOperation(admission);
    if (json !== expected.json) throw new TypeError("settlement operation evidence is invalid");
    return expected;
}

/** Canonically encodes action-specific terminal evidence for one settlement operation. */
export function encodeRetainedWorldSettlementTerminalReceipt(
    operation: RetainedWorldSettlementOperationEncoding,
    evidence: RetainedWorldSettlementTerminalEvidence,
): RetainedWorldSettlementReceiptEncoding {
    if (evidence.action !== operation.value.action) {
        throw new TypeError("settlement receipt action does not match its operation");
    }
    assertNonEmptyString(evidence.user_basis_after, "user_basis_after");
    const selected = evidence.action === SELECT_ACTION;
    if (selected) assertNonEmptyString(evidence.publication_id, "publication_id");
    if (!selected && evidence.user_basis_after !== operation.value.request.user_basis_before) {
        throw new TypeError("discard settlement changed the user basis");
    }
    const common = {
        operation_id: operation.id,
        receipt_version: RETAINED_WORLD_SETTLEMENT_RECEIPT_VERSION,
        request_id: operation.value.request_id,
        user_basis_after: evidence.user_basis_after,
    };
    const value = Object.freeze(
        selected
            ? {
                  ...common,
                  action: SELECT_ACTION,
                  publication_id: evidence.publication_id,
                  state: SELECTED_STATE,
              }
            : {
                  ...common,
                  action: DISCARD_ACTION,
                  cleanup_completed: evidence.cleanup_completed,
                  state: DISCARDED_STATE,
              },
    ) as RetainedWorldSettlementTerminalReceipt;
    const json = canonicalizeRecord(value as unknown as SemanticRecord);
    return Object.freeze({ digest: digestText(json), json, value });
}

/** Decodes only a canonical terminal receipt bound to the exact operation. */
export function decodeRetainedWorldSettlementTerminalReceipt(
    json: string,
    operation: RetainedWorldSettlementOperationEncoding,
): RetainedWorldSettlementReceiptEncoding {
    let parsed: unknown;
    try {
        parsed = JSON.parse(json);
    } catch (error) {
        throw new TypeError("settlement receipt evidence is invalid", { cause: error });
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new TypeError("settlement receipt evidence is invalid");
    }
    const record = parsed as Record<string, unknown>;
    const action = record.action;
    const evidence =
        action === SELECT_ACTION
            ? {
                  action,
                  publication_id: record.publication_id,
                  user_basis_after: record.user_basis_after,
              }
            : {
                  action,
                  cleanup_completed: record.cleanup_completed,
                  user_basis_after: record.user_basis_after,
              };
    if (
        (evidence.action !== SELECT_ACTION && evidence.action !== DISCARD_ACTION) ||
        typeof evidence.user_basis_after !== "string" ||
        (evidence.action === SELECT_ACTION && typeof evidence.publication_id !== "string") ||
        (evidence.action === DISCARD_ACTION && typeof evidence.cleanup_completed !== "boolean")
    ) {
        throw new TypeError("settlement receipt evidence is invalid");
    }
    const expected = encodeRetainedWorldSettlementTerminalReceipt(
        operation,
        evidence as RetainedWorldSettlementTerminalEvidence,
    );
    if (json !== expected.json) throw new TypeError("settlement receipt evidence is invalid");
    return expected;
}

function digestText(value: string): string {
    return createHash(workspaceProtocolConfig.digestAlgorithm).update(value).digest("hex");
}
