import { createRecordBodySnapshot } from "../record/snapshot.ts";
import type { RecordBody, RecordId } from "../record/types.ts";
import { TraceStoreError } from "../store/errors.ts";
import type { Slice, SliceRecord } from "../store/types.ts";

/** Reads one payload-visible record selected by a slice. */
export function readProjectionRecord(
    slice: Slice,
    recordId: RecordId,
    projectionName: string,
): SliceRecord {
    const visible = slice.visible_records_by_id[recordId];
    if (visible === undefined || !("body" in visible)) {
        throw new TraceStoreError(`${projectionName} requires every owner record payload`);
    }
    return visible;
}

/** Reads the object payload required by one schema-specific projection record. */
export function readProjectionPayload(
    record: SliceRecord,
    schemaName: string,
): Readonly<Record<string, unknown>> {
    const payload = record.body.payload;
    if (!isProjectionObject(payload)) {
        throw new TraceStoreError(`${schemaName} record must contain an object payload`);
    }
    return payload;
}

/** Snapshots an optional object value, defaulting malformed optional data to an empty object. */
export function snapshotProjectionObject(value: unknown): Readonly<Record<string, unknown>> {
    if (!isProjectionObject(value)) {
        return Object.freeze({});
    }
    return createRecordBodySnapshot(value as RecordBody);
}

/** Identifies a non-array object value in an already canonical retained body. */
export function isProjectionObject(value: unknown): value is Readonly<Record<string, unknown>> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
