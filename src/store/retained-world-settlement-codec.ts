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
import { readRetainedWorldApplicationPlan } from "./retained-world-application-codec.ts";
import type {
    RetainedWorldApplicationPlanEvidence,
    RetainedWorldSettlementAdmission,
} from "./types.ts";

const [, , SELECTED_STATE, DISCARDED_STATE, APPLIED_STATE] = RETAINED_WORLD_SETTLEMENT_STATES;
const [SELECT_ACTION, DISCARD_ACTION, APPLY_ACTION] = RETAINED_WORLD_SETTLEMENT_ACTIONS;

type RetainedWorldSettlementOperation =
    | Readonly<{
          action: typeof SELECT_ACTION | typeof DISCARD_ACTION;
          operation_version: typeof RETAINED_WORLD_SETTLEMENT_OPERATION_VERSION;
          request: RetainedWorldSettlementAdmission["request"];
          request_id: string;
      }>
    | Readonly<{
          action: typeof APPLY_ACTION;
          application_plan: RetainedWorldApplicationPlanEvidence;
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
      }>
    | Readonly<{
          action: typeof APPLY_ACTION;
          applied_revision_id: string;
          application_plan_id: string;
          operation_id: string;
          publication_id: string;
          receipt_version: typeof RETAINED_WORLD_SETTLEMENT_RECEIPT_VERSION;
          request_id: string;
          state: typeof APPLIED_STATE;
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
      }>
    | Readonly<{
          action: typeof APPLY_ACTION;
          applied_revision_id: string;
          application_plan_id: string;
          publication_id: string;
          user_basis_after: string;
      }>;

/** Canonically encodes the deterministic operation bound to one authenticated admission. */
export function encodeRetainedWorldSettlementOperation(
    admission: RetainedWorldSettlementAdmission,
    applicationPlan: RetainedWorldApplicationPlanEvidence | null = null,
): RetainedWorldSettlementOperationEncoding {
    const common = {
        action: admission.action,
        operation_version: RETAINED_WORLD_SETTLEMENT_OPERATION_VERSION,
        request: admission.request,
        request_id: admission.request_id,
    } as const;
    let value: RetainedWorldSettlementOperation;
    if (admission.action === APPLY_ACTION) {
        if (applicationPlan === null) {
            throw new TypeError("apply settlement operation requires an application plan");
        }
        const plan = readRetainedWorldApplicationPlan(applicationPlan);
        if (
            plan.request_id !== admission.request_id ||
            plan.binding_id !== admission.request.binding_id ||
            plan.base_revision_id !== admission.request.base_revision_id ||
            plan.candidate_revision_id !== admission.request.head_revision_id ||
            plan.candidate_changeset_id !== admission.request.changeset_id
        ) {
            throw new TypeError("application plan differs from settlement admission");
        }
        value = Object.freeze({ ...common, action: APPLY_ACTION, application_plan: plan });
    } else {
        if (applicationPlan !== null) {
            throw new TypeError("non-apply settlement operation cannot carry an application plan");
        }
        value = Object.freeze({ ...common, action: admission.action });
    }
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
    let applicationPlan: RetainedWorldApplicationPlanEvidence | null = null;
    if (admission.action === APPLY_ACTION) {
        let parsed: unknown;
        try {
            parsed = JSON.parse(json);
        } catch (error) {
            throw new TypeError("settlement operation evidence is invalid", { cause: error });
        }
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new TypeError("settlement operation evidence is invalid");
        }
        applicationPlan = readRetainedWorldApplicationPlan(
            (parsed as Record<string, unknown>).application_plan,
        );
    }
    const expected = encodeRetainedWorldSettlementOperation(admission, applicationPlan);
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
    if (evidence.action === SELECT_ACTION || evidence.action === APPLY_ACTION) {
        assertNonEmptyString(evidence.publication_id, "publication_id");
    }
    if (evidence.action === APPLY_ACTION) {
        assertNonEmptyString(evidence.applied_revision_id, "applied_revision_id");
        assertNonEmptyString(evidence.application_plan_id, "application_plan_id");
        // The action equality above establishes this discriminant for every public caller.
        /* node:coverage ignore next 3 */
        if (operation.value.action !== APPLY_ACTION) {
            throw new TypeError("apply settlement operation plan is absent");
        }
        const applicationPlan = operation.value.application_plan;
        if (
            evidence.applied_revision_id !== applicationPlan.merged_revision_id ||
            evidence.application_plan_id !== applicationPlan.plan_id ||
            evidence.user_basis_after !== applicationPlan.merged_content_id
        ) {
            throw new TypeError("apply settlement receipt differs from its application plan");
        }
    }
    if (
        evidence.action === DISCARD_ACTION &&
        evidence.user_basis_after !== operation.value.request.user_basis_before
    ) {
        throw new TypeError("discard settlement changed the user basis");
    }
    const common = {
        operation_id: operation.id,
        receipt_version: RETAINED_WORLD_SETTLEMENT_RECEIPT_VERSION,
        request_id: operation.value.request_id,
        user_basis_after: evidence.user_basis_after,
    };
    const value = Object.freeze(
        evidence.action === SELECT_ACTION
            ? {
                  ...common,
                  action: SELECT_ACTION,
                  publication_id: evidence.publication_id,
                  state: SELECTED_STATE,
              }
            : evidence.action === DISCARD_ACTION
              ? {
                    ...common,
                    action: DISCARD_ACTION,
                    cleanup_completed: evidence.cleanup_completed,
                    state: DISCARDED_STATE,
                }
              : {
                    ...common,
                    action: APPLY_ACTION,
                    applied_revision_id: evidence.applied_revision_id,
                    application_plan_id: evidence.application_plan_id,
                    publication_id: evidence.publication_id,
                    state: APPLIED_STATE,
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
            : action === DISCARD_ACTION
              ? {
                    action,
                    cleanup_completed: record.cleanup_completed,
                    user_basis_after: record.user_basis_after,
                }
              : {
                    action,
                    applied_revision_id: record.applied_revision_id,
                    application_plan_id: record.application_plan_id,
                    publication_id: record.publication_id,
                    user_basis_after: record.user_basis_after,
                };
    if (
        (evidence.action !== SELECT_ACTION &&
            evidence.action !== DISCARD_ACTION &&
            evidence.action !== APPLY_ACTION) ||
        typeof evidence.user_basis_after !== "string" ||
        (evidence.action === SELECT_ACTION && typeof evidence.publication_id !== "string") ||
        (evidence.action === DISCARD_ACTION && typeof evidence.cleanup_completed !== "boolean") ||
        (evidence.action === APPLY_ACTION &&
            (typeof evidence.applied_revision_id !== "string" ||
                typeof evidence.application_plan_id !== "string" ||
                typeof evidence.publication_id !== "string"))
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
