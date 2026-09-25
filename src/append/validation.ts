import { kernelProtocolConfig } from "../protocol/config.ts";
import { assertNonEmptyString, assertRecordId } from "../record/guards.ts";
import type { RecordId } from "../record/types.ts";
import type {
    AppendBatchDraft,
    AppendLocalId,
    AppendRecordDraft,
    OwnerOrdinal,
    TraceOwnerId,
} from "./types.ts";

const batchKeys = new Set(["groups"]);
const groupKeys = new Set(["caused_by_record_ids", "owner_id", "records"]);
const recordKeys = new Set([
    "append_local_id",
    "body",
    "caused_by_local_refs",
    "caused_by_record_ids",
    "mode",
    "schema_ref",
    "witness_ref",
]);

/** Creates a descriptor-safe append draft containing only declared wire fields. */
export function normalizeAppendBatchDraft(value: unknown): AppendBatchDraft {
    const batch = readDataObject(value, batchKeys, ["groups"], "append batch");
    const groups = readDataArray(batch.groups, "append batch groups");

    return {
        groups: groups.map((groupValue, groupIndex) => {
            const path = `groups[${groupIndex}]`;
            const group = readDataObject(groupValue, groupKeys, ["owner_id", "records"], path);
            // Owner paths are validated here so every reserved-owner guard reads text.
            assertNonEmptyString(group.owner_id, `${path}.owner_id`);
            return {
                ...(group.caused_by_record_ids === undefined
                    ? {}
                    : {
                          caused_by_record_ids: readDataArray(
                              group.caused_by_record_ids,
                              `${path}.caused_by_record_ids`,
                          ) as readonly RecordId[],
                      }),
                owner_id: group.owner_id as TraceOwnerId,
                records: readDataArray(group.records, `${path}.records`).map(
                    (recordValue, recordIndex) =>
                        normalizeRecordDraft(recordValue, `${path}.records[${recordIndex}]`),
                ),
            };
        }),
    };
}

/** Validates and copies identifiers already retained by a future store. */
export function validateKnownRecordIds(values: ReadonlySet<RecordId> | undefined): Set<RecordId> {
    const validated = new Set<RecordId>();
    for (const value of values ?? []) {
        assertRecordId(value, "known_record_ids value");
        validated.add(value);
    }
    return validated;
}

/** Validates and copies next-ordinal state without mutating the caller's map. */
export function validateNextOwnerOrdinals(
    values: ReadonlyMap<TraceOwnerId, OwnerOrdinal> | undefined,
): Map<TraceOwnerId, OwnerOrdinal> {
    const validated = new Map<TraceOwnerId, OwnerOrdinal>();
    const firstOrdinal = kernelProtocolConfig.append.firstOwnerOrdinal;
    for (const [ownerId, ordinal] of values ?? []) {
        assertNonEmptyString(ownerId, "next_owner_ordinals owner");
        if (!Number.isSafeInteger(ordinal) || ordinal < firstOrdinal) {
            throw new TypeError(
                `next_owner_ordinals[${ownerId}] must be a safe integer at least ${firstOrdinal}`,
            );
        }
        validated.set(ownerId, ordinal);
    }
    return validated;
}

/** Validates configured record identifiers while retaining their declared order. */
export function validateRecordIds(values: readonly RecordId[], path: string): readonly RecordId[] {
    for (const [index, value] of values.entries()) {
        assertRecordId(value, `${path}[${index}]`);
    }
    return values;
}

/** Resolves batch-local parent names to records planned earlier in the batch. */
export function resolveLocalParents(
    values: readonly AppendLocalId[],
    localRecordIds: ReadonlyMap<AppendLocalId, RecordId>,
    path: string,
): readonly RecordId[] {
    return values.map((localId, index) => {
        assertNonEmptyString(localId, `${path}[${index}]`);
        const recordId = localRecordIds.get(localId);
        if (recordId === undefined) {
            throw new TypeError(`${path}[${index}] does not reference an earlier draft`);
        }
        return recordId;
    });
}

function normalizeRecordDraft(value: unknown, path: string): AppendRecordDraft {
    const draft = readDataObject(
        value,
        recordKeys,
        ["body", "mode", "schema_ref", "witness_ref"],
        path,
    );
    return {
        ...(draft.append_local_id === undefined
            ? {}
            : { append_local_id: draft.append_local_id as string }),
        body: draft.body as AppendRecordDraft["body"],
        ...(draft.caused_by_record_ids === undefined
            ? {}
            : {
                  caused_by_record_ids: readDataArray(
                      draft.caused_by_record_ids,
                      `${path}.caused_by_record_ids`,
                  ) as readonly RecordId[],
              }),
        ...(draft.caused_by_local_refs === undefined
            ? {}
            : {
                  caused_by_local_refs: readDataArray(
                      draft.caused_by_local_refs,
                      `${path}.caused_by_local_refs`,
                  ) as readonly AppendLocalId[],
              }),
        mode: draft.mode as AppendRecordDraft["mode"],
        schema_ref: draft.schema_ref as string,
        witness_ref: draft.witness_ref as RecordId,
    };
}

function readDataObject(
    value: unknown,
    allowedKeys: ReadonlySet<string>,
    requiredKeys: readonly string[],
    path: string,
): Record<string, unknown> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new TypeError(`${path} must be a plain object`);
    }
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError(`${path} must be a plain object`);
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
        throw new TypeError(`${path} must not contain symbol properties`);
    }

    const result = Object.create(null) as Record<string, unknown>;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const [key, descriptor] of Object.entries(descriptors)) {
        if (!allowedKeys.has(key)) {
            throw new TypeError(`${path} contains unsupported field: ${key}`);
        }
        if (!("value" in descriptor)) {
            throw new TypeError(`${path}.${key} must not be an accessor property`);
        }
        result[key] = descriptor.value;
    }
    for (const key of requiredKeys) {
        if (!Object.hasOwn(result, key) || result[key] === undefined) {
            throw new TypeError(`${path}.${key} is required`);
        }
    }
    return result;
}

function readDataArray(value: unknown, path: string): readonly unknown[] {
    if (!Array.isArray(value)) {
        throw new TypeError(`${path} must be an array`);
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
        throw new TypeError(`${path} must not contain symbol properties`);
    }

    const descriptors = Object.getOwnPropertyDescriptors(value);
    const allowedKeys = new Set(["length"]);
    const result: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
        const key = String(index);
        allowedKeys.add(key);
        const descriptor = descriptors[key];
        if (descriptor === undefined) {
            throw new TypeError(`${path}[${index}] is a sparse array element`);
        }
        if (!("value" in descriptor)) {
            throw new TypeError(`${path}[${index}] must not be an accessor array element`);
        }
        if (descriptor.value === undefined) {
            throw new TypeError(`${path}[${index}] contains an undefined array element`);
        }
        result.push(descriptor.value);
    }
    if (Object.keys(descriptors).some((key) => !allowedKeys.has(key))) {
        throw new TypeError(`${path} must not contain custom properties`);
    }
    return result;
}
