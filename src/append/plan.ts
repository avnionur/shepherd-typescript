import { kernelProtocolConfig } from "../protocol/config.ts";
import { createRecordEnvelope } from "../record/envelope.ts";
import { assertNonEmptyString, assertRecordId } from "../record/guards.ts";
import { createRecordBodySnapshot } from "../record/snapshot.ts";
import type { RecordId } from "../record/types.ts";
import type {
    AppendBatchDraft,
    AppendLocalId,
    AppendPlanningState,
    OwnerOrdinal,
    PlannedAppendBatch,
    PlannedRecord,
    TraceOwnerId,
} from "./types.ts";
import {
    normalizeAppendBatchDraft,
    resolveLocalParents,
    validateKnownRecordIds,
    validateNextOwnerOrdinals,
    validateRecordIds,
} from "./validation.ts";

/**
 * Validates and deterministically plans a future atomic append operation.
 *
 * Parent order is group parents, record parents, then resolved local parents.
 * Every parent must already be retained or must have been planned earlier in
 * this batch. Owner ordinals advance independently and are not part of record
 * identity.
 *
 * This function is pure and does not persist records. A storage adapter must
 * commit the returned plan and ordinal state atomically.
 *
 * @param batch - Ordered owner groups and record drafts to plan.
 * @param state - Known record identifiers and next owner ordinals.
 * @returns Canonical record envelopes, owner views, ranges, and causal edges.
 * @throws {TypeError} If the batch shape, identifiers, local references, or
 * owner ordinal state is invalid.
 * @throws {RangeError} If a causal parent is unknown or an ordinal exceeds the
 * safe integer range.
 *
 * @example
 * ```ts
 * const plan = planAppendBatch(
 *   {
 *     groups: [{
 *       owner_id: "run:example",
 *       records: [{
 *         body: { operation: "started" },
 *         mode: "capture",
 *         schema_ref: "example.event.v1",
 *         witness_ref,
 *       }],
 *     }],
 *   },
 * );
 * ```
 *
 * @public
 */
export function planAppendBatch(
    batch: AppendBatchDraft,
    state: AppendPlanningState = {},
): PlannedAppendBatch {
    const normalizedBatch = normalizeAppendBatchDraft(batch);
    const knownRecordIds = validateKnownRecordIds(state.known_record_ids);
    const nextOwnerOrdinals = validateNextOwnerOrdinals(state.next_owner_ordinals);
    const stagedRecordIds = new Set<RecordId>();
    const localRecordIds = new Map<AppendLocalId, RecordId>();
    const records: PlannedRecord[] = [];
    const causalEdges: (readonly [RecordId, RecordId])[] = [];
    const ownerOrdinalRanges = new Map<TraceOwnerId, readonly [OwnerOrdinal, OwnerOrdinal]>();

    for (const [groupIndex, group] of normalizedBatch.groups.entries()) {
        assertNonEmptyString(group.owner_id, `groups[${groupIndex}].owner_id`);
        const groupParents = validateRecordIds(
            group.caused_by_record_ids ?? [],
            `groups[${groupIndex}].caused_by_record_ids`,
        );

        for (const [recordIndex, draft] of group.records.entries()) {
            const path = `groups[${groupIndex}].records[${recordIndex}]`;
            const directParents = validateRecordIds(
                draft.caused_by_record_ids ?? [],
                `${path}.caused_by_record_ids`,
            );
            const localParents = resolveLocalParents(
                draft.caused_by_local_refs ?? [],
                localRecordIds,
                `${path}.caused_by_local_refs`,
            );
            const causedBy = [...groupParents, ...directParents, ...localParents];
            if (new Set(causedBy).size !== causedBy.length) {
                throw new TypeError(`${path} contains a duplicate causal parent`);
            }
            for (const parent of causedBy) {
                if (!knownRecordIds.has(parent) && !stagedRecordIds.has(parent)) {
                    throw new RangeError(`${path} references unknown causal parent: ${parent}`);
                }
            }

            assertRecordId(draft.witness_ref, `${path}.witness_ref`);
            const body = createRecordBodySnapshot(draft.body);
            const createdEnvelope = createRecordEnvelope({
                body,
                caused_by_record_ids: causedBy,
                mode: draft.mode,
                schema_ref: draft.schema_ref,
                witness_ref: draft.witness_ref,
            });
            const envelope = Object.freeze({
                ...createdEnvelope,
                caused_by_record_ids: Object.freeze([...createdEnvelope.caused_by_record_ids]),
            });
            const ownerOrdinal = nextOwnerOrdinals.get(group.owner_id);
            const ordinal = ownerOrdinal ?? kernelProtocolConfig.append.firstOwnerOrdinal;
            if (ordinal > kernelProtocolConfig.append.lastOwnerOrdinal) {
                throw new RangeError(`${path} owner ordinal exceeds the safe integer range`);
            }

            records.push(
                Object.freeze({
                    body,
                    envelope,
                    view: Object.freeze({ owner_id: group.owner_id, owner_ordinal: ordinal }),
                }),
            );
            causalEdges.push(
                ...causedBy.map((parent) => Object.freeze([parent, envelope.record_id] as const)),
            );
            stagedRecordIds.add(envelope.record_id);
            nextOwnerOrdinals.set(group.owner_id, ordinal + 1);
            const existingRange = ownerOrdinalRanges.get(group.owner_id);
            ownerOrdinalRanges.set(
                group.owner_id,
                Object.freeze([existingRange?.[0] ?? ordinal, ordinal]),
            );

            if (draft.append_local_id !== undefined) {
                assertNonEmptyString(draft.append_local_id, `${path}.append_local_id`);
                if (localRecordIds.has(draft.append_local_id)) {
                    throw new TypeError(
                        `${path}.append_local_id duplicates: ${draft.append_local_id}`,
                    );
                }
                localRecordIds.set(draft.append_local_id, envelope.record_id);
            }
        }
    }

    return {
        causal_edges: Object.freeze(causalEdges),
        next_owner_ordinals: nextOwnerOrdinals,
        owner_ordinal_ranges: ownerOrdinalRanges,
        records: Object.freeze(records),
    };
}
