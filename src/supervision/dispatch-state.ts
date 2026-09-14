import { createIntentReference } from "../effect/records.ts";
import type { EffectIntent } from "../effect/types.ts";
import { effectProtocolConfig, supervisionProtocolConfig } from "../protocol/config.ts";
import {
    RECORD_MODES,
    SUPERVISION_APPROVAL_GATES,
    SUPERVISION_APPROVAL_PHASES,
    SUPERVISION_APPROVAL_VERDICTS,
    SUPERVISION_DECISION_SOURCES,
    SUPERVISION_DECISIONS,
    SUPERVISION_DISPOSITIONS,
    SUPERVISION_RECOVERY_CLASSIFICATIONS,
    SUPERVISION_TIMEOUT_POLICIES,
} from "../protocol/values.generated.ts";
import type { SupervisedDispatchRow } from "../store/supervised-dispatches.ts";
import type { OwnerRecord } from "../store/types.ts";
import { SupervisionEvidenceError } from "./errors.ts";
import {
    readSupervisionAdmissionBody,
    readSupervisionApprovalBody,
    readSupervisionDecisionBody,
    readSupervisionDispatchBody,
    readSupervisionResolutionBody,
    type SupervisionApprovalRequestBody,
    type SupervisionDispatchBody,
} from "./records.ts";
import type {
    SupervisedDispatchInspection,
    SupervisionApprovalInspection,
    SupervisionDecisionInspection,
    SupervisionInterceptorDeclaration,
    SupervisionResolutionInspection,
    SupervisionTimeoutPolicy,
} from "./types.ts";

const schemas = supervisionProtocolConfig.traceSchemas;
const [CAPTURE_MODE, DECLARATION_MODE] = RECORD_MODES;
const [ALLOW, DENY, REPLACE, PAUSE] = SUPERVISION_DECISIONS;
const [INTERCEPTOR_SOURCE] = SUPERVISION_DECISION_SOURCES;
const [FAIL_OPEN, FAIL_CLOSED] = SUPERVISION_TIMEOUT_POLICIES;
const [PAUSE_GATE] = SUPERVISION_APPROVAL_GATES;
const [REQUESTED_PHASE] = SUPERVISION_APPROVAL_PHASES;
const [APPROVED_VERDICT] = SUPERVISION_APPROVAL_VERDICTS;
const [MATERIALIZED, MATERIALIZATION_FAILED, DENIED, REJECTED] = SUPERVISION_DISPOSITIONS;
const [
    RESOLVED_CLASS,
    UNCERTAIN_CLASS,
    RESOLUTION_PENDING_CLASS,
    APPROVAL_PENDING_CLASS,
    DECISION_PENDING_CLASS,
] = SUPERVISION_RECOVERY_CLASSIFICATIONS;

/** Validated dispatch progress used by inspection and by a resuming dispatcher. @internal */
export type SupervisedDispatchState = {
    /** Retained dispatch record body. */
    readonly dispatch: SupervisionDispatchBody;
    /** Whether a pause decision still needs its approval request. */
    readonly pauseAwaitingRequest: { readonly position: number; readonly reason: string } | null;
    /** Validated public view. */
    readonly inspection: SupervisedDispatchInspection;
    /** Next undecided canonical interceptor position. */
    readonly nextPosition: number;
    /** Whether the retained path ends in a denial awaiting resolution. */
    readonly denied: boolean;
    /** Whether the retained path ends in a rejected or expired verdict awaiting resolution. */
    readonly rejected: boolean;
    /** Whether the effective intent still needs a frontier approval. */
    readonly frontierPending: boolean;
};

/**
 * Validates one retained dispatch owner path and derives its progress and classification.
 *
 * @param dispatchId - Exact dispatch identity.
 * @param records - Retained owner occurrences in ordinal order.
 * @param row - Live registration row, or undefined for imported evidence.
 * @returns Frozen validated state.
 * @throws {SupervisionEvidenceError} If the path is absent, malformed, or violates the protocol.
 * @internal
 */
export function foldSupervisedDispatch(
    dispatchId: string,
    records: readonly OwnerRecord[],
    row: SupervisedDispatchRow | undefined,
): SupervisedDispatchState {
    const [first, ...rest] = records;
    if (first === undefined || first.envelope.schema_ref !== schemas.dispatch) {
        throw new SupervisionEvidenceError(
            `dispatch ${dispatchId} has no retained dispatch record`,
        );
    }
    const dispatch = readSupervisionDispatchBody(first.body);
    if (
        dispatch.dispatch_id !== dispatchId ||
        first.envelope.mode !== DECLARATION_MODE ||
        first.envelope.caused_by_record_ids.join("\0") !== dispatch.cited_record_ids.join("\0")
    ) {
        throw new SupervisionEvidenceError(
            "dispatch record names a different dispatch, mode, or causes than its citations",
        );
    }
    const interceptors = dispatch.interceptors;
    let effective: EffectIntent = dispatch.intent;
    let effectiveRef = dispatch.intent_ref;
    let previous = first;
    let nextPosition = 0;
    let denied = false;
    let rejected = false;
    let admissionRecordId: string | null = null;
    let pauseAwaitingRequest: { position: number; reason: string } | null = null;
    let pending: (SupervisionApprovalInspection & { verdict: null }) | null = null;
    let resolution: SupervisionResolutionInspection | null = null;
    const approvedRefs = new Set<string>();
    const decisions: SupervisionDecisionInspection[] = [];
    const approvals: SupervisionApprovalInspection[] = [];
    const fail = (detail: string): never => {
        throw new SupervisionEvidenceError(`dispatch ${dispatchId} ${detail}`);
    };
    for (const record of rest) {
        const expectedMode =
            record.envelope.schema_ref === schemas.admission ? DECLARATION_MODE : CAPTURE_MODE;
        if (
            record.envelope.caused_by_record_ids.length !== 1 ||
            record.envelope.caused_by_record_ids[0] !== previous.envelope.record_id ||
            record.envelope.mode !== expectedMode
        ) {
            fail("record is not caused only by the previous head or uses the wrong mode");
        }
        if (resolution !== null) {
            fail("retains evidence after its resolution");
        }
        const open = admissionRecordId === null && !denied && !rejected;
        const schemaRef = record.envelope.schema_ref;
        if (schemaRef === schemas.decision) {
            const body = readSupervisionDecisionBody(record.body);
            const declaration = interceptors[body.position];
            if (
                !open ||
                pending !== null ||
                pauseAwaitingRequest !== null ||
                body.dispatch_id !== dispatchId ||
                body.position !== nextPosition ||
                declaration === undefined ||
                body.interceptor_id !== declaration.interceptor_id ||
                body.intent_ref !== effectiveRef ||
                !policyConsistent(body, declaration, effective)
            ) {
                fail("retains an out-of-order or inconsistent decision");
            }
            decisions.push(
                Object.freeze({
                    applied_policy: body.applied_policy,
                    decision: body.decision,
                    intent_ref: body.intent_ref,
                    interceptor_id: body.interceptor_id,
                    owner_ordinal: record.view.owner_ordinal,
                    position: body.position,
                    reason: body.reason,
                    record_id: record.envelope.record_id,
                    replacement: body.replacement,
                    source: body.source,
                }),
            );
            if (body.decision === DENY) {
                denied = true;
            } else if (body.decision === PAUSE) {
                pauseAwaitingRequest = { position: body.position, reason: body.reason as string };
            } else {
                if (body.decision === REPLACE) {
                    const replacement = body.replacement as EffectIntent;
                    if (
                        replacement.effect_id !== effective.effect_id ||
                        replacement.kind !== effective.kind ||
                        tierIndex(replacement) < tierIndex(effective)
                    ) {
                        fail(
                            "retains a replacement that changes identity or weakens reversibility",
                        );
                    }
                    effective = replacement;
                    effectiveRef = createIntentReference(replacement);
                }
                nextPosition += 1;
            }
        } else if (schemaRef === schemas.approval) {
            const body = readSupervisionApprovalBody(record.body);
            if (body.dispatch_id !== dispatchId) {
                fail("retains an approval for a different dispatch");
            }
            if (body.phase === REQUESTED_PHASE) {
                const request = body as SupervisionApprovalRequestBody;
                const valid =
                    request.gate === PAUSE_GATE
                        ? pauseAwaitingRequest?.position === request.position
                        : pauseAwaitingRequest === null &&
                          nextPosition === interceptors.length &&
                          requiresApproval(effective) &&
                          !approvedRefs.has(effectiveRef);
                if (!open || pending !== null || !valid || request.intent_ref !== effectiveRef) {
                    fail("retains an unexpected approval request");
                }
                pending = {
                    gate: request.gate,
                    intent_ref: request.intent_ref,
                    owner_ordinal: record.view.owner_ordinal,
                    position: request.position,
                    reason: request.reason,
                    request_record_id: record.envelope.record_id,
                    verdict: null,
                };
                pauseAwaitingRequest = null;
                approvals.push(Object.freeze({ ...pending }));
            } else {
                if (pending === null || body.request_record_id !== pending.request_record_id) {
                    fail("retains a verdict without its pending request");
                }
                const request = pending as SupervisionApprovalInspection;
                approvals[approvals.length - 1] = Object.freeze({
                    ...request,
                    verdict: Object.freeze({
                        approver_id: body.approver_id,
                        command_id: body.command_id,
                        owner_ordinal: record.view.owner_ordinal,
                        reason: body.reason,
                        record_id: record.envelope.record_id,
                        verdict: body.verdict,
                    }),
                });
                if (body.verdict === APPROVED_VERDICT) {
                    approvedRefs.add(request.intent_ref);
                    nextPosition += request.gate === PAUSE_GATE ? 1 : 0;
                } else {
                    rejected = true;
                }
                pending = null;
            }
        } else if (schemaRef === schemas.admission) {
            const body = readSupervisionAdmissionBody(record.body);
            if (
                !open ||
                pending !== null ||
                pauseAwaitingRequest !== null ||
                nextPosition !== interceptors.length ||
                (requiresApproval(effective) && !approvedRefs.has(effectiveRef)) ||
                body.dispatch_id !== dispatchId ||
                body.intent_ref !== effectiveRef
            ) {
                fail("retains an admission that its decisions do not allow");
            }
            admissionRecordId = record.envelope.record_id;
        } else if (schemaRef === schemas.resolution) {
            const body = readSupervisionResolutionBody(record.body, effective);
            const materializing =
                body.disposition === MATERIALIZED || body.disposition === MATERIALIZATION_FAILED;
            const allowed = materializing
                ? admissionRecordId !== null
                : admissionRecordId === null &&
                  (body.disposition === DENIED
                      ? denied
                      : body.disposition === REJECTED
                        ? rejected
                        : !denied && !rejected);
            if (!allowed || body.dispatch_id !== dispatchId || body.intent_ref !== effectiveRef) {
                fail("retains a resolution that its evidence does not allow");
            }
            resolution = Object.freeze({
                disposition: body.disposition,
                handler_id: body.handler_id,
                outcome: body.outcome,
                owner_ordinal: record.view.owner_ordinal,
                record_id: record.envelope.record_id,
            });
        } else {
            fail(`retains unsupported schema ${schemaRef}`);
        }
        previous = record;
    }
    const frontierPending =
        nextPosition === interceptors.length &&
        pauseAwaitingRequest === null &&
        requiresApproval(effective) &&
        !approvedRefs.has(effectiveRef);
    const recovery =
        resolution !== null
            ? RESOLVED_CLASS
            : admissionRecordId !== null
              ? UNCERTAIN_CLASS
              : denied || rejected
                ? RESOLUTION_PENDING_CLASS
                : pending !== null || pauseAwaitingRequest !== null || frontierPending
                  ? APPROVAL_PENDING_CLASS
                  : nextPosition < interceptors.length
                    ? DECISION_PENDING_CLASS
                    : RESOLUTION_PENDING_CLASS;
    if (row !== undefined && row.dispatch_record_id !== first.envelope.record_id) {
        fail("registration row disagrees with its dispatch record");
    }
    const inspection: SupervisedDispatchInspection = Object.freeze({
        admission_record_id: admissionRecordId,
        approval_timeout_milliseconds: dispatch.approval_timeout_milliseconds,
        approvals: Object.freeze(approvals),
        cited_record_ids: dispatch.cited_record_ids,
        command_id: dispatch.command_id,
        decisions: Object.freeze(decisions),
        dispatch_id: dispatchId,
        dispatch_record_id: first.envelope.record_id,
        effective_intent: effective,
        head: Object.freeze({
            owner_ordinal: previous.view.owner_ordinal,
            record_id: previous.envelope.record_id,
        }),
        intent: dispatch.intent,
        interceptors,
        lease:
            row === undefined
                ? null
                : Object.freeze({
                      claim_id: row.claim_id,
                      fencing_token: row.fencing_token,
                      lease_expires_at: row.lease_expires_at,
                      released: row.released,
                  }),
        pending_approval:
            pending === null
                ? null
                : Object.freeze({ ...(pending as SupervisionApprovalInspection) }),
        recovery,
        resolution,
    });
    return Object.freeze({
        denied,
        dispatch,
        frontierPending,
        inspection,
        nextPosition,
        pauseAwaitingRequest:
            pauseAwaitingRequest === null ? null : Object.freeze({ ...pauseAwaitingRequest }),
        rejected,
    });
}

/** Returns the policy a timeout or failure applies for the effective intent's tier. @internal */
export function applicablePolicy(
    declaration: SupervisionInterceptorDeclaration,
    intent: EffectIntent,
): SupervisionTimeoutPolicy {
    return supervisionProtocolConfig.interception.failOpenForbiddenTiers.includes(
        intent.reversibility,
    )
        ? FAIL_CLOSED
        : declaration.timeout_policy;
}

/** Reports whether an effective intent is on the configured approval frontier. @internal */
export function requiresApproval(intent: EffectIntent): boolean {
    return supervisionProtocolConfig.approval.requiredTiers.includes(intent.reversibility);
}

/** Returns the configured strength index of an intent's reversibility tier. @internal */
export function tierIndex(intent: EffectIntent): number {
    return effectProtocolConfig.reversibilityTiers.indexOf(intent.reversibility);
}

function policyConsistent(
    body: {
        readonly applied_policy: SupervisionTimeoutPolicy | null;
        readonly decision: string;
        readonly source: string;
    },
    declaration: SupervisionInterceptorDeclaration,
    intent: EffectIntent,
): boolean {
    if (body.source === INTERCEPTOR_SOURCE) {
        return true;
    }
    const policy = applicablePolicy(declaration, intent);
    return (
        body.applied_policy === policy && body.decision === (policy === FAIL_OPEN ? ALLOW : DENY)
    );
}
