import {
    canonicalizeSemanticValue,
    type SemanticRecord,
    type SemanticValue,
} from "../canonical/canonical-record.ts";
import { createCanonicalSnapshot } from "../canonical/snapshot.ts";
import { effectProtocolConfig } from "../protocol/config.ts";
import {
    EFFECT_COMPENSATION_STATUSES,
    EFFECT_RECONCILIATION_DISPOSITIONS,
} from "../protocol/values.generated.ts";
import { assertRecordId } from "../record/guards.ts";
import { readScopeDataObject } from "../scope/validation.ts";
import type { SQLiteTraceStore } from "../store/sqlite-trace-store.ts";
import {
    EffectCompensationConflictError,
    EffectCompensationEvidenceError,
} from "./compensation-errors.ts";
import { foldCompensation } from "./compensation-inspection.ts";
import {
    readEffectReconciliationCommand,
    readEffectReconciliationHistory,
} from "./reconciliation-inspection.ts";
import {
    assertReconciliationText,
    readReconciliationEvidence,
    reconciliationBasisId,
} from "./reconciliation-records.ts";
import { readReconciliationTarget } from "./reconciliation-target.ts";
import type {
    EffectReconciliationAuthority,
    EffectReconciliationAuthorityOptions,
    EffectReconciliationDecision,
    EffectReconciliationInspection,
    EffectReconciliationReceipt,
    EffectReconciliationRecord,
    InspectEffectReconciliationOptions,
    ReconcileEffectOptions,
} from "./reconciliation-types.ts";

const config = effectProtocolConfig.compensation.reconciliation;
const [, VERIFIED] = EFFECT_RECONCILIATION_DISPOSITIONS;
const [, , , COMPENSATED] = EFFECT_COMPENSATION_STATUSES;
const authorities = new WeakMap<object, EffectReconciliationAuthorityOptions>();

/**
 * Creates a trusted host authorization capability for exact operator decisions.
 * The host authenticates the actor and supplies its real access policy; this is not an identity provider.
 * @param options - Actor, policy and explicit authorization/completion-verification callbacks.
 * @returns An immutable package-authenticated handle; copies are refused.
 * @throws {TypeError} If options are malformed, unbounded or lack callbacks.
 * @example
 * ```ts
 * const authority = createEffectReconciliationAuthority({ actorId, policyId, authorize, verifyCompletion });
 * ```
 */
export function createEffectReconciliationAuthority(
    options: EffectReconciliationAuthorityOptions,
): EffectReconciliationAuthority {
    const fields = readScopeDataObject(
        options,
        ["actorId", "policyId", "authorize", "verifyCompletion"],
        "reconciliation authority",
    );
    assertReconciliationText(fields.actorId, "actorId");
    assertReconciliationText(fields.policyId, "policyId");
    if (typeof fields.authorize !== "function" || typeof fields.verifyCompletion !== "function")
        throw new TypeError(
            "reconciliation authority requires authorization and verification callbacks",
        );
    const authority = Object.freeze({ actorId: fields.actorId, policyId: fields.policyId });
    authorities.set(
        authority,
        Object.freeze({
            ...authority,
            authorize: fields.authorize as EffectReconciliationAuthorityOptions["authorize"],
            verifyCompletion:
                fields.verifyCompletion as EffectReconciliationAuthorityOptions["verifyCompletion"],
        }),
    );
    return authority;
}

/**
 * Inspects exact effect uncertainty, immutable compensation facts and operator audit history.
 * No external operation or recovery is invoked. Pending replay admissions may retain only an intent digest.
 * @param store - Open read-only or writable store.
 * @param options - Exact source effect evidence identity.
 * @returns Validated target, factual compensation state and current command basis.
 * @throws {EffectCompensationEvidenceError} If evidence is missing, malformed or unsupported.
 * @throws {TypeError} If options are malformed.
 * @throws {TraceStoreError} If the store is closed.
 */
export function inspectEffectReconciliation(
    store: SQLiteTraceStore,
    options: InspectEffectReconciliationOptions,
): EffectReconciliationInspection {
    const fields = readScopeDataObject(options, ["effectRecordId"], "reconciliation inspection");
    assertRecordId(fields.effectRecordId, "effectRecordId");
    const target = readReconciliationTarget(store, fields.effectRecordId);
    const factual = foldCompensation(
        store,
        target.compensation_id,
        store.readOwner(target.compensation_id),
    );
    const decisions = readEffectReconciliationHistory(store, target.effect_record_id);
    const latest = decisions.at(-1);
    const compensation =
        factual === undefined
            ? null
            : latest === undefined
              ? factual
              : Object.freeze({ ...factual, reconciliation: latest });
    const basis = Object.freeze({
        target_record_id: target.effect_record_id,
        compensation_id: target.compensation_id,
        source_kind: target.source_kind,
        source_owner_id: target.source_owner_id,
        source_head_record_id: target.source_head_record_id,
        compensation_head_record_id:
            store.readOwner(target.compensation_id).at(-1)?.envelope.record_id ?? null,
        previous_record_id: decisions.at(-1)?.record_id ?? null,
    });
    return Object.freeze({
        basis_id: reconciliationBasisId(basis),
        basis,
        target,
        compensation,
        decisions,
    });
}

/**
 * Records an authorized exact operator disposition without fabricating a handler result or invoking external work.
 * Equal commands reauthorize and replay their receipt; changed requests conflict. Completion requires a
 * separate host verification. A retry audit authorizes a later existing safe retry path and never invents
 * successful materialization evidence. Active invocation owners and changed heads refuse publication.
 * @param store - Writable trace store.
 * @param options - Exact inspected basis, actor capability, disposition, reason and retained evidence.
 * @returns Immutable audited disposition, separate from compensation outcome status.
 * @throws {EffectCompensationEvidenceError} If policy refuses or evidence/verification is invalid.
 * @throws {EffectCompensationConflictError} If command content, heads or active ownership conflict.
 * @throws {AppendIntentConflictError} If a concurrently retained command names another request.
 * @throws {TypeError} If options or authority are malformed.
 * @throws {TraceStoreError} If the store is closed or publication fails.
 * @example
 * ```ts
 * const incident = inspectEffectReconciliation(store, { effectRecordId });
 * const receipt = await reconcileEffect(store, {
 *     authority, effectRecordId, basisId: incident.basis_id, commandId,
 *     disposition: "accepted_unresolved", reason, evidenceRecordIds,
 * });
 * ```
 */
export async function reconcileEffect(
    store: SQLiteTraceStore,
    options: ReconcileEffectOptions,
): Promise<EffectReconciliationReceipt> {
    const fields = readScopeDataObject(
        options,
        [
            "authority",
            "basisId",
            "commandId",
            "disposition",
            "effectRecordId",
            "evidenceRecordIds",
            "reason",
        ],
        "reconcileEffect options",
    );
    const policy =
        fields.authority !== null && typeof fields.authority === "object"
            ? authorities.get(fields.authority)
            : undefined;
    if (policy === undefined)
        throw new TypeError("reconciliation requires a package-created host authority");
    for (const key of ["basisId", "commandId", "reason"] as const)
        assertReconciliationText(fields[key], key);
    assertRecordId(fields.effectRecordId, "effectRecordId");
    if (!(EFFECT_RECONCILIATION_DISPOSITIONS as readonly unknown[]).includes(fields.disposition))
        throw new TypeError("reconciliation disposition is not configured");
    const decision = createCanonicalSnapshot({
        actor_id: policy.actorId,
        policy_id: policy.policyId,
        basis_id: fields.basisId,
        command_id: fields.commandId,
        disposition: fields.disposition,
        effect_record_id: fields.effectRecordId,
        evidence_record_ids: readReconciliationEvidence(fields.evidenceRecordIds),
        reason: fields.reason,
    } as SemanticRecord) as unknown as EffectReconciliationDecision;
    const existing = readEffectReconciliationCommand(store, decision.command_id);
    if (existing !== null) {
        const retained: EffectReconciliationDecision = {
            actor_id: existing.actor_id,
            policy_id: existing.policy_id,
            basis_id: existing.basis_id,
            command_id: existing.command_id,
            disposition: existing.disposition,
            effect_record_id: existing.effect_record_id,
            evidence_record_ids: existing.evidence_record_ids,
            reason: existing.reason,
        };
        if (
            canonicalizeSemanticValue(retained as unknown as SemanticValue) !==
            canonicalizeSemanticValue(decision as unknown as SemanticValue)
        )
            throw new EffectCompensationConflictError(existing.compensation_id);
    }
    const inspection = inspectEffectReconciliation(store, {
        effectRecordId: decision.effect_record_id,
    });
    if (existing === null && inspection.basis_id !== decision.basis_id)
        throw new EffectCompensationConflictError(inspection.target.compensation_id);
    for (const recordId of decision.evidence_record_ids)
        if (store.readRecord(recordId) === undefined)
            throw new EffectCompensationEvidenceError("incident evidence is not retained");
    const authorization = Object.freeze({ decision, target: inspection.target });
    if ((await policy.authorize(authorization)) !== true)
        throw new EffectCompensationEvidenceError("operator policy refused reconciliation");
    if (existing !== null) return existing;
    if (inspection.compensation?.status === COMPENSATED)
        throw new EffectCompensationEvidenceError(
            "already compensated effect needs no reconciliation",
        );
    if (
        decision.disposition === VERIFIED &&
        (await policy.verifyCompletion(authorization)) !== true
    )
        throw new EffectCompensationEvidenceError("external completion evidence was not verified");
    const body: EffectReconciliationRecord = Object.freeze({
        ...decision,
        ...inspection.basis,
        compatibility_version: config.compatibilityVersion,
        record_version: config.recordVersion,
        completion_verified: decision.disposition === VERIFIED,
    });
    store.appendEffectReconciliationRecord(body, Date.now());
    return readEffectReconciliationCommand(
        store,
        decision.command_id,
    ) as EffectReconciliationReceipt;
}
