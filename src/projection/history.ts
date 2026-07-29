import { projectionProtocolConfig } from "../protocol/config.ts";
import { assertNonEmptyString } from "../record/guards.ts";
import { TraceStoreError } from "../store/errors.ts";
import type { Slice } from "../store/types.ts";
import { assertHistoryProjectionCompatible } from "./compatibility.ts";
import { projectExecution } from "./execution.ts";
import {
    readProjectionPayload,
    readProjectionRecord,
    snapshotProjectionObject,
} from "./record-values.ts";
import { activeExecutionRelations, projectExecutionRelations } from "./relations.ts";
import type { EffectiveChild, EffectiveHistory, PublishedRecord } from "./types.ts";

/**
 * Projects a root execution, active children, relations, and published data.
 *
 * The pure projection skips active children whose cut slice is not supplied. The
 * `SQLiteTraceStore.projectEffectiveHistory` facade resolves every required child cut strictly.
 *
 * @param rootSlice - Immutable root execution owner-prefix slice.
 * @param rootExecutionId - Root execution owner to project.
 * @param childSlices - Child slices keyed by their embedded published cut addresses.
 * @returns Frozen effective execution history.
 * @throws {ProjectionCompatibilityError} If a slice omits required modes or payloads.
 * @throws {TraceStoreError} If selected execution, relation, or publication evidence is malformed.
 * @throws {TypeError} If the root execution identifier is empty.
 *
 * @public
 */
export function projectEffectiveHistory(
    rootSlice: Slice,
    rootExecutionId: string,
    childSlices: readonly Slice[] = [],
): EffectiveHistory {
    assertNonEmptyString(rootExecutionId, "rootExecutionId");
    assertHistoryProjectionCompatible(rootSlice);
    const relations = projectExecutionRelations(rootSlice, rootExecutionId);
    const childrenByCut = new Map<string, Slice>();
    for (const childSlice of childSlices) {
        if (childSlice.read_address === undefined) {
            continue;
        }
        if (childrenByCut.has(childSlice.read_address.cut_id)) {
            throw new TraceStoreError(
                `duplicate child slice for cut: ${childSlice.read_address.cut_id}`,
            );
        }
        childrenByCut.set(childSlice.read_address.cut_id, childSlice);
    }
    const children: EffectiveChild[] = [];
    for (const relation of activeExecutionRelations(relations)) {
        if (relation.child_cut_id === null) {
            continue;
        }
        const childSlice = childrenByCut.get(relation.child_cut_id);
        if (childSlice === undefined) {
            continue;
        }
        if (childSlice.read_address?.target_owner_id !== relation.child_execution_id) {
            throw new TraceStoreError(
                `child cut ${relation.child_cut_id} does not target ${relation.child_execution_id}`,
            );
        }
        children.push(
            Object.freeze({
                execution: projectExecution(
                    childSlice,
                    relation.child_execution_id,
                    childSlice.read_address,
                ),
                relation,
            }),
        );
    }
    return Object.freeze({
        children: Object.freeze(children),
        published_records: projectPublishedRecords(rootSlice, rootExecutionId),
        relations,
        root: projectExecution(rootSlice, rootExecutionId, rootSlice.read_address),
    });
}

function projectPublishedRecords(slice: Slice, ownerId: string): readonly PublishedRecord[] {
    const records: PublishedRecord[] = [];
    for (const recordId of slice.owner_paths[ownerId] ?? []) {
        const visible = readProjectionRecord(slice, recordId, "history projection");
        if (
            visible.envelope.schema_ref !==
            projectionProtocolConfig.executionHistory.publishedRecordSchemaRef
        ) {
            continue;
        }
        const payload = readProjectionPayload(visible, "published");
        records.push(
            Object.freeze({
                data: snapshotProjectionObject(payload.data),
                kind: String(payload.kind ?? ""),
                record_id: visible.envelope.record_id,
            }),
        );
    }
    return Object.freeze(records);
}
