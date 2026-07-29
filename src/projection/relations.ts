import { projectionProtocolConfig } from "../protocol/config.ts";
import { assertNonEmptyString } from "../record/guards.ts";
import { TraceStoreError } from "../store/errors.ts";
import type { Slice } from "../store/types.ts";
import { assertHistoryProjectionCompatible } from "./compatibility.ts";
import { readProjectionPayload, readProjectionRecord } from "./record-values.ts";
import type { ExecutionRelation } from "./types.ts";

/**
 * Projects parent-owned execution relation transitions in owner order.
 *
 * @param slice - Immutable parent owner-prefix slice.
 * @param parentExecutionId - Parent execution that owns the relations.
 * @returns Frozen retained relation transitions in owner order.
 * @throws {ProjectionCompatibilityError} If the slice omits required modes or payloads.
 * @throws {TraceStoreError} If selected relation evidence is absent or malformed.
 * @throws {TypeError} If the parent identifier is empty.
 *
 * @public
 */
export function projectExecutionRelations(
    slice: Slice,
    parentExecutionId: string,
): readonly ExecutionRelation[] {
    assertNonEmptyString(parentExecutionId, "parentExecutionId");
    assertHistoryProjectionCompatible(slice);
    const config = projectionProtocolConfig.executionHistory;
    const relations: ExecutionRelation[] = [];
    for (const recordId of slice.owner_paths[parentExecutionId] ?? []) {
        const visible = readProjectionRecord(slice, recordId, "relation projection");
        if (visible.envelope.schema_ref !== config.relationSchemaRef) {
            continue;
        }
        const payload = readProjectionPayload(visible, "execution relation");
        const relationKind = String(payload.relation_kind ?? "");
        if (!config.relationKinds.includes(relationKind)) {
            throw new TraceStoreError(`unknown execution relation kind: ${relationKind}`);
        }
        const rawCutId = payload.child_frontier_id;
        const relation = Object.freeze({
            child_cut_id: rawCutId === undefined || rawCutId === null ? null : String(rawCutId),
            child_execution_id: String(payload.child_execution_id ?? ""),
            created_record_id: visible.envelope.record_id,
            parent_execution_id: String(payload.parent_execution_id ?? ""),
            relation_id: String(payload.relation_id ?? ""),
            relation_kind: relationKind as ExecutionRelation["relation_kind"],
        });
        if (relation.parent_execution_id === parentExecutionId) {
            relations.push(relation);
        }
    }
    return Object.freeze(relations);
}

/**
 * Selects the latest still-active transition for every relation identity.
 *
 * @param relations - Retained relation transitions in owner order.
 * @returns Frozen active spawned or adopted relations.
 *
 * @public
 */
export function activeExecutionRelations(
    relations: readonly ExecutionRelation[],
): readonly ExecutionRelation[] {
    const latest = new Map<string, ExecutionRelation>();
    for (const relation of relations) {
        latest.set(relation.relation_id, relation);
    }
    return Object.freeze(
        [...latest.values()].filter((relation) =>
            projectionProtocolConfig.executionHistory.activeRelationKinds.includes(
                relation.relation_kind,
            ),
        ),
    );
}
