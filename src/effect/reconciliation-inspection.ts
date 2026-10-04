import { canonicalizeSemanticValue } from "../canonical/canonical-record.ts";
import {
    effectProtocolConfig,
    replayProtocolConfig,
    scopeProtocolConfig,
    supervisionProtocolConfig,
} from "../protocol/config.ts";
import {
    EFFECT_COMPENSATION_STATUSES,
    EFFECT_RECONCILIATION_DISPOSITIONS,
    EFFECT_RECONCILIATION_SOURCE_KINDS,
    RECORD_MODES,
} from "../protocol/values.generated.ts";
import { ROOT_WITNESS_ID } from "../record/root-witness.ts";
import type { RecordId } from "../record/types.ts";
import { readReplaySessionBody } from "../replay/records.ts";
import { readScopeChildRegisteredRecord, readScopeRegistrationRecord } from "../scope/records.ts";
import type { SQLiteTraceStore } from "../store/sqlite-trace-store.ts";
import { EffectCompensationEvidenceError } from "./compensation-errors.ts";
import { foldCompensation } from "./compensation-inspection.ts";
import {
    readReconciliationRecord,
    reconciliationCauses,
    reconciliationCommandOwner,
    reconciliationOwner,
} from "./reconciliation-records.ts";
import type { EffectReconciliationReceipt } from "./reconciliation-types.ts";

const config = effectProtocolConfig.compensation.reconciliation;
const [CAPTURE] = RECORD_MODES;
const [RETRY, VERIFIED, ACCEPTED] = EFFECT_RECONCILIATION_DISPOSITIONS;
const [REPLAY] = EFFECT_RECONCILIATION_SOURCE_KINDS;
const [, , , COMPENSATED] = EFFECT_COMPENSATION_STATUSES;

/** Reads and validates a target's complete append-only operator audit. @internal */
export function readEffectReconciliationHistory(
    store: SQLiteTraceStore,
    targetRecordId: RecordId,
): readonly EffectReconciliationReceipt[] {
    const records = store.readOwner(reconciliationOwner(targetRecordId));
    if (records.length > config.limits.maxDecisions)
        throw new EffectCompensationEvidenceError(
            "reconciliation audit exceeds configured decision bounds",
        );
    let previous: RecordId | null = null;
    const history = records.map((record) => {
        const body = readReconciliationRecord(record.body);
        const command = store.readOwner(reconciliationCommandOwner(body.command_id));
        const source = store.readRecord(body.source_head_record_id);
        const target = store.readRecord(body.target_record_id);
        const permittedSchemas =
            body.source_kind === REPLAY
                ? [
                      replayProtocolConfig.traceSchemas.step,
                      replayProtocolConfig.traceSchemas.admission,
                  ]
                : [
                      supervisionProtocolConfig.traceSchemas.resolution,
                      supervisionProtocolConfig.traceSchemas.admission,
                  ];
        if (
            record.envelope.schema_ref !== config.traceSchema ||
            record.envelope.mode !== CAPTURE ||
            record.envelope.witness_ref !== ROOT_WITNESS_ID ||
            body.target_record_id !== targetRecordId ||
            body.previous_record_id !== previous ||
            canonicalizeSemanticValue(record.envelope.caused_by_record_ids) !==
                canonicalizeSemanticValue(reconciliationCauses(body)) ||
            command.length !== 1 ||
            command[0]?.envelope.record_id !== record.envelope.record_id ||
            !store
                .readOwner(body.compensation_id)
                .some((guard) => guard.envelope.record_id === record.envelope.record_id) ||
            source === undefined ||
            !source.views.some((view) => view.owner_id === body.source_owner_id) ||
            target === undefined ||
            !permittedSchemas.includes(target.envelope.schema_ref) ||
            !target.views.some((view) => view.owner_id === body.source_owner_id)
        )
            throw new EffectCompensationEvidenceError(
                "reconciliation audit ordering or source citations are inconsistent",
            );
        if (
            body.compensation_head_record_id !== null &&
            !store
                .readRecord(body.compensation_head_record_id)
                ?.views.some((view) => view.owner_id === body.compensation_id)
        )
            throw new EffectCompensationEvidenceError(
                "reconciliation compensation citation belongs to another target",
            );
        previous = record.envelope.record_id;
        return Object.freeze({ ...body, record_id: record.envelope.record_id });
    });
    return Object.freeze(history);
}

/** Reads a global command receipt and confirms its occurrence on the target audit. @internal */
export function readEffectReconciliationCommand(
    store: SQLiteTraceStore,
    commandId: string,
): EffectReconciliationReceipt | null {
    const records = store.readOwner(reconciliationCommandOwner(commandId));
    if (records.length === 0) return null;
    if (records.length !== 1)
        throw new EffectCompensationEvidenceError("reconciliation command has multiple receipts");
    const record = records[0] as (typeof records)[number];
    const body = readReconciliationRecord(record.body);
    const receipt = readEffectReconciliationHistory(store, body.target_record_id).find(
        (entry) => entry.record_id === record.envelope.record_id,
    );
    if (receipt === undefined || receipt.command_id !== commandId)
        throw new EffectCompensationEvidenceError(
            "reconciliation command receipt is not bound to its exact command",
        );
    return receipt;
}

/** Whether an operator disposition currently suppresses automatic compensation attempts. @internal */
export function reconciliationSuppressesRetry(
    receipt: EffectReconciliationReceipt | undefined,
): boolean {
    return receipt !== undefined && receipt.disposition !== RETRY;
}

/**
 * Projects accepted residual risk through causal evidence and execution-associated scopes.
 * A retry request alone does not clear accepted risk; a real compensation or verified completion does.
 * @param store - Open read-only or writable store.
 * @param ownerId - Exact inspected execution or scope owner.
 * @returns Immutable accepted-risk receipts reachable from that owner's evidence.
 * @throws {EffectCompensationEvidenceError} If audits are malformed or inspection bounds are exceeded.
 * @internal
 */
export function readOwnerEffectResidualRisks(
    store: SQLiteTraceStore,
    ownerId: string,
): readonly EffectReconciliationReceipt[] {
    if (
        store.readOwner(ownerId).length === 0 ||
        store.listOwnersBySchema(config.traceSchema, 1, 0, false, config.identity.targetOwnerPrefix)
            .length === 0
    )
        return Object.freeze([]);
    const pendingOwners = [ownerId];
    const associated = new Set<string>();
    for (let offset = 0; ; offset += config.limits.maxTargets) {
        const page = store.listOwnersBySchemaBodyText(
            scopeProtocolConfig.traceSchemas.registration,
            "$.execution_id",
            ownerId,
            config.limits.maxTargets,
            offset,
        );
        for (const scopeId of page) {
            associated.add(scopeId);
            pendingOwners.push(scopeId);
        }
        if (page.length < config.limits.maxTargets) break;
    }
    const visitedOwners = new Set<string>();
    const pendingRecords: RecordId[] = [];
    const visitedRecords = new Set<RecordId>();
    const candidates: EffectReconciliationReceipt[] = [];
    const targetSchemas = new Set([
        replayProtocolConfig.traceSchemas.step,
        replayProtocolConfig.traceSchemas.admission,
        supervisionProtocolConfig.traceSchemas.resolution,
        supervisionProtocolConfig.traceSchemas.admission,
    ]);
    while (pendingOwners.length > 0 || pendingRecords.length > 0) {
        while (pendingOwners.length > 0) {
            const current = pendingOwners.pop() as string;
            if (visitedOwners.has(current)) continue;
            visitedOwners.add(current);
            const records = store.readOwner(current);
            const first = records[0];
            if (
                associated.has(current) &&
                (first === undefined ||
                    readScopeRegistrationRecord(first.body).execution_id !== ownerId)
            )
                throw new EffectCompensationEvidenceError(
                    "execution scope association is inconsistent",
                );
            for (const record of records) {
                pendingRecords.push(record.envelope.record_id);
                if (
                    record.envelope.schema_ref === scopeProtocolConfig.traceSchemas.childRegistered
                ) {
                    const child = readScopeChildRegisteredRecord(record.body);
                    const firstChild = store.readOwner(child.child_scope_id)[0];
                    const registration =
                        firstChild === undefined
                            ? null
                            : readScopeRegistrationRecord(firstChild.body);
                    if (
                        child.parent_scope_id !== current ||
                        registration?.parent?.scope_id !== current ||
                        registration.parent.child_registered_record_id !== record.envelope.record_id
                    )
                        throw new EffectCompensationEvidenceError(
                            "residual-risk child ownership is inconsistent",
                        );
                    pendingOwners.push(child.child_scope_id);
                }
            }
        }
        while (pendingRecords.length > 0) {
            const id = pendingRecords.pop() as RecordId;
            if (visitedRecords.has(id)) continue;
            visitedRecords.add(id);
            const record = store.readRecord(id);
            if (record === undefined)
                throw new EffectCompensationEvidenceError(
                    "residual-risk causal evidence is missing",
                );
            pendingRecords.push(...record.envelope.caused_by_record_ids);
            if (record.envelope.schema_ref === replayProtocolConfig.traceSchemas.session) {
                const session = readReplaySessionBody(record.body);
                if (session.origin !== null) pendingOwners.push(session.origin.source_session_id);
            }
            if (!targetSchemas.has(record.envelope.schema_ref)) continue;
            const history = readEffectReconciliationHistory(store, id);
            for (const receipt of [...history].reverse()) {
                if (receipt.disposition === VERIFIED) break;
                if (receipt.disposition === ACCEPTED) {
                    const compensation = foldCompensation(
                        store,
                        receipt.compensation_id,
                        store.readOwner(receipt.compensation_id),
                    );
                    if (compensation?.status !== COMPENSATED) candidates.push(receipt);
                    break;
                }
            }
            if (candidates.length > config.limits.maxTargets)
                throw new EffectCompensationEvidenceError(
                    "related residual risks exceed configured inspection bounds",
                );
        }
    }
    return Object.freeze(
        candidates.sort((left, right) =>
            Buffer.compare(Buffer.from(left.target_record_id), Buffer.from(right.target_record_id)),
        ),
    );
}
