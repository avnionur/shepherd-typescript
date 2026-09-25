import { createHash } from "node:crypto";

import { canonicalizeRecord, type SemanticRecord } from "../canonical/canonical-record.ts";
import { workspaceProtocolConfig } from "../protocol/config.ts";
import {
    RETAINED_WORLD_RELEASE_COMPATIBILITY_VERSION,
    RETAINED_WORLD_RELEASE_RECEIPT_VERSION,
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

const [, , SELECTED_STATE, DISCARDED_STATE, APPLIED_STATE, RELEASED_STATE] =
    RETAINED_WORLD_SETTLEMENT_STATES;
const [SELECT_ACTION, DISCARD_ACTION, APPLY_ACTION, RELEASE_ACTION] =
    RETAINED_WORLD_SETTLEMENT_ACTIONS;

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
      }>
    | Readonly<{
          action: typeof RELEASE_ACTION;
          operation_version: typeof RETAINED_WORLD_SETTLEMENT_OPERATION_VERSION;
          release_basis_id: string;
          request: RetainedWorldSettlementAdmission["request"];
          request_id: string;
      }>;

/** Canonical operation encoding retained by the settlement journal. */
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
      }>
    | Readonly<{
          action: typeof RELEASE_ACTION;
          base_revision_id: string;
          binding_id: string;
          changeset_id: string;
          compatibility_version: typeof RETAINED_WORLD_RELEASE_COMPATIBILITY_VERSION;
          custody_id: string;
          head_revision_id: string;
          operation_id: string;
          output_id: string;
          receipt_version: typeof RETAINED_WORLD_RELEASE_RECEIPT_VERSION;
          request_id: string;
          state: typeof RELEASED_STATE;
          user_basis_after: string;
          user_basis_before: string;
      }>;

/** Canonical terminal-receipt encoding retained by the settlement journal. */
export type RetainedWorldSettlementReceiptEncoding = Readonly<{
    digest: string;
    json: string;
    value: RetainedWorldSettlementTerminalReceipt;
}>;

/** Action-specific evidence accepted by the terminal journal transition. */
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
      }>
    | Readonly<{
          action: typeof RELEASE_ACTION;
          changeset_id: string;
          custody_id: string;
          head_revision_id: string;
          user_basis_after: string;
          user_basis_before: string;
      }>;

/** Canonically encodes the deterministic operation bound to one authenticated admission. */
export function encodeRetainedWorldSettlementOperation(
    admission: RetainedWorldSettlementAdmission,
    applicationPlan: RetainedWorldApplicationPlanEvidence | null = null,
    releaseBasisId: string | null = null,
): RetainedWorldSettlementOperationEncoding {
    const common = {
        action: admission.action,
        operation_version: RETAINED_WORLD_SETTLEMENT_OPERATION_VERSION,
        request: admission.request,
        request_id: admission.request_id,
    } as const;
    let value: RetainedWorldSettlementOperation;
    if (admission.action === APPLY_ACTION) {
        if (releaseBasisId !== null) {
            throw new TypeError("apply settlement operation cannot carry a release basis");
        }
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
    } else if (admission.action === RELEASE_ACTION) {
        if (applicationPlan !== null) {
            throw new TypeError("release settlement operation cannot carry an application plan");
        }
        assertNonEmptyString(releaseBasisId, "release_basis_id");
        value = Object.freeze({
            ...common,
            action: RELEASE_ACTION,
            release_basis_id: releaseBasisId,
        });
    } else {
        if (applicationPlan !== null || releaseBasisId !== null) {
            throw new TypeError("receipt operation cannot carry action-specific planning evidence");
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
    let releaseBasisId: string | null = null;
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
    } else if (admission.action === RELEASE_ACTION) {
        let parsed: unknown;
        try {
            parsed = JSON.parse(json);
        } catch (error) {
            throw new TypeError("settlement operation evidence is invalid", { cause: error });
        }
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new TypeError("settlement operation evidence is invalid");
        }
        const descriptor = Object.getOwnPropertyDescriptor(parsed, "release_basis_id");
        releaseBasisId = "value" in (descriptor ?? {}) ? (descriptor?.value as string) : null;
    }
    const expected = encodeRetainedWorldSettlementOperation(
        admission,
        applicationPlan,
        releaseBasisId,
    );
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
    if (evidence.action === RELEASE_ACTION) {
        assertNonEmptyString(evidence.changeset_id, "changeset_id");
        assertNonEmptyString(evidence.custody_id, "custody_id");
        assertNonEmptyString(evidence.head_revision_id, "head_revision_id");
        assertNonEmptyString(evidence.user_basis_before, "user_basis_before");
        // The action equality above establishes this discriminant for every public caller.
        /* node:coverage ignore next 3 */
        if (operation.value.action !== RELEASE_ACTION) {
            throw new TypeError("release settlement operation basis is absent");
        }
        if (
            evidence.changeset_id !== operation.value.request.changeset_id ||
            evidence.custody_id !== operation.value.request.custody_id ||
            evidence.head_revision_id !== operation.value.request.head_revision_id ||
            evidence.user_basis_before !== operation.value.release_basis_id ||
            evidence.user_basis_after !== operation.value.release_basis_id
        ) {
            throw new TypeError("release settlement receipt differs from its retained output");
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
              : evidence.action === APPLY_ACTION
                ? {
                      ...common,
                      action: APPLY_ACTION,
                      applied_revision_id: evidence.applied_revision_id,
                      application_plan_id: evidence.application_plan_id,
                      publication_id: evidence.publication_id,
                      state: APPLIED_STATE,
                  }
                : {
                      ...common,
                      action: RELEASE_ACTION,
                      base_revision_id: operation.value.request.base_revision_id,
                      binding_id: operation.value.request.binding_id,
                      changeset_id: evidence.changeset_id,
                      compatibility_version: RETAINED_WORLD_RELEASE_COMPATIBILITY_VERSION,
                      custody_id: evidence.custody_id,
                      head_revision_id: evidence.head_revision_id,
                      output_id: operation.value.request.output_id,
                      receipt_version: RETAINED_WORLD_RELEASE_RECEIPT_VERSION,
                      state: RELEASED_STATE,
                      user_basis_before: evidence.user_basis_before,
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
              : action === APPLY_ACTION
                ? {
                      action,
                      applied_revision_id: record.applied_revision_id,
                      application_plan_id: record.application_plan_id,
                      publication_id: record.publication_id,
                      user_basis_after: record.user_basis_after,
                  }
                : {
                      action,
                      base_revision_id: record.base_revision_id,
                      binding_id: record.binding_id,
                      changeset_id: record.changeset_id,
                      custody_id: record.custody_id,
                      head_revision_id: record.head_revision_id,
                      output_id: record.output_id,
                      user_basis_after: record.user_basis_after,
                      user_basis_before: record.user_basis_before,
                  };
    if (
        (evidence.action !== SELECT_ACTION &&
            evidence.action !== DISCARD_ACTION &&
            evidence.action !== APPLY_ACTION &&
            evidence.action !== RELEASE_ACTION) ||
        typeof evidence.user_basis_after !== "string" ||
        (evidence.action === SELECT_ACTION && typeof evidence.publication_id !== "string") ||
        (evidence.action === DISCARD_ACTION && typeof evidence.cleanup_completed !== "boolean") ||
        (evidence.action === APPLY_ACTION &&
            (typeof evidence.applied_revision_id !== "string" ||
                typeof evidence.application_plan_id !== "string" ||
                typeof evidence.publication_id !== "string")) ||
        (evidence.action === RELEASE_ACTION &&
            (typeof evidence.changeset_id !== "string" ||
                typeof evidence.custody_id !== "string" ||
                typeof evidence.head_revision_id !== "string" ||
                typeof evidence.user_basis_before !== "string"))
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
