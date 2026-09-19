import type { DatabaseSync } from "node:sqlite";

import { kernelProtocolConfig } from "../protocol/config.ts";
import { assertNonEmptyString, assertRecordId } from "../record/guards.ts";
import type { RecordId } from "../record/types.ts";
import { TraceStoreError } from "./errors.ts";
import {
    normalizeCausalOptions,
    normalizeCausalRoots,
    normalizeSliceReadOptions,
} from "./query-validation.ts";
import { readStoredRecord } from "./read.ts";
import { HOT_PATH_SQL } from "./statements.ts";
import type {
    CausalClosureOptions,
    Cut,
    ModeFilter,
    RecordShape,
    RetainedRecord,
    Slice,
    SliceReadOptions,
    SliceRecord,
    VisibilityProfile,
    WitnessAnchor,
} from "./types.ts";

/** Reads an immutable owner prefix as a graph-shaped slice. */
export function readOwnerPrefixSlice(
    database: DatabaseSync,
    ownerId: string,
    through: number,
    options: SliceReadOptions = {},
    readAddress?: Cut,
): Slice {
    assertNonEmptyString(ownerId, "ownerId");
    if (
        !Number.isSafeInteger(through) ||
        through < kernelProtocolConfig.append.firstOwnerOrdinal ||
        through > kernelProtocolConfig.append.lastOwnerOrdinal
    ) {
        throw new TypeError("through must be a configured owner ordinal");
    }
    const { modeFilter, visibilityProfile } = normalizeSliceReadOptions(options);
    const rows = database.prepare(HOT_PATH_SQL.ownerPrefixViews).all(ownerId, through);
    const loaded = rows.flatMap((row) => {
        const record = readStoredRecord(database, String(row.record_id));
        if (record === undefined) {
            throw new TraceStoreError("owner path contains a view without its retained record");
        }
        if (!modeMatches(record.envelope.mode, modeFilter)) {
            return [];
        }
        return [
            {
                body: record.body,
                envelope: record.envelope,
                view: Object.freeze({
                    append_intent_id: String(row.append_intent_id),
                    owner_id: String(row.owner_id),
                    owner_ordinal: Number(row.owner_ordinal),
                }),
            } satisfies SliceRecord,
        ];
    });
    return createSlice(database, loaded, modeFilter, visibilityProfile, true, readAddress);
}

/** Reads the transitive causal closure of root records as a graph-shaped slice. */
export function readCausalClosureSlice(
    database: DatabaseSync,
    roots: readonly RecordId[],
    options: CausalClosureOptions = {},
): Slice {
    const { closurePolicy, modeFilter, visibilityProfile } = normalizeCausalOptions(options);
    const pending = [...normalizeCausalRoots(roots)];
    const retained = new Map<RecordId, RetainedRecord>();
    while (pending.length > 0) {
        const recordId = pending.pop();
        assertRecordId(recordId, "root record");
        if (retained.has(recordId)) {
            continue;
        }
        const record = readStoredRecord(database, recordId);
        if (record === undefined) {
            throw new TraceStoreError(`unknown causal root or parent: ${recordId}`);
        }
        retained.set(recordId, record);
        pending.push(...record.envelope.caused_by_record_ids);
    }
    const records = [...retained.values()]
        .filter((record) => modeMatches(record.envelope.mode, modeFilter))
        .flatMap((record) => {
            if (record.views.length === 0) {
                return [{ body: record.body, envelope: record.envelope }];
            }
            return record.views.map((view) => ({
                body: record.body,
                envelope: record.envelope,
                view,
            }));
        })
        .sort(compareSliceRecords);
    return createSlice(
        database,
        records,
        modeFilter,
        visibilityProfile,
        closurePolicy === "include_external_anchors",
    );
}

function createSlice(
    database: DatabaseSync,
    records: readonly SliceRecord[],
    modeFilter: ModeFilter,
    visibility: VisibilityProfile,
    includeExternalAnchors: boolean,
    readAddress?: Cut,
): Slice {
    const selected = new Set(records.map(({ envelope }) => envelope.record_id));
    const visibleRecords = {} as Record<string, RecordShape | SliceRecord>;
    const ownerPaths = {} as Record<string, RecordId[]>;
    const causalEdges: (readonly [RecordId, RecordId])[] = [];
    const external = new Set<RecordId>();
    const processedRecords = new Set<RecordId>();
    for (const record of records) {
        if (!Object.hasOwn(visibleRecords, record.envelope.record_id)) {
            visibleRecords[record.envelope.record_id] =
                visibility === "shape_only"
                    ? Object.freeze({
                          envelope: record.envelope,
                          hidden_reason: "payload_hidden",
                          ...(record.view === undefined ? {} : { view: record.view }),
                      })
                    : Object.freeze(record);
        }
        if (record.view !== undefined) {
            const ownerPath = Object.hasOwn(ownerPaths, record.view.owner_id)
                ? ownerPaths[record.view.owner_id]
                : undefined;
            if (ownerPath === undefined) {
                Object.defineProperty(ownerPaths, record.view.owner_id, {
                    configurable: false,
                    enumerable: true,
                    value: [record.envelope.record_id],
                    writable: false,
                });
            } else {
                ownerPath.push(record.envelope.record_id);
            }
        }
        if (processedRecords.has(record.envelope.record_id)) {
            continue;
        }
        processedRecords.add(record.envelope.record_id);
        for (const parent of record.envelope.caused_by_record_ids) {
            if (selected.has(parent)) {
                causalEdges.push(Object.freeze([parent, record.envelope.record_id]));
            } else if (includeExternalAnchors) {
                external.add(parent);
            }
        }
    }
    for (const path of Object.values(ownerPaths)) {
        Object.freeze(path);
    }
    const witnessSupport = readWitnessSupport(database, records);
    const visibleWitnesses = {} as Record<string, SliceRecord>;
    const witnessAnchors: WitnessAnchor[] = [];
    for (const witness of witnessSupport) {
        if (visibility === "shape_only") {
            witnessAnchors.push(
                Object.freeze({
                    hidden_reason: "hidden_by_visibility",
                    visible_shape: Object.freeze({
                        schema_ref: witness.envelope.schema_ref,
                        witness_ref: witness.envelope.witness_ref,
                    }),
                    witness_ref: witness.envelope.record_id,
                }),
            );
        } else {
            visibleWitnesses[witness.envelope.record_id] = Object.freeze(witness);
        }
    }
    return Object.freeze({
        causal_edges: Object.freeze(causalEdges),
        external_anchors: Object.freeze(
            [...external].map((ref) => Object.freeze({ hidden_reason: "outside_slice", ref })),
        ),
        mode_filter: modeFilter,
        owner_paths: Object.freeze(ownerPaths),
        ...(readAddress === undefined ? {} : { read_address: readAddress }),
        visible_records_by_id: Object.freeze(visibleRecords),
        visible_witnesses_by_id: Object.freeze(visibleWitnesses),
        visibility_profile: visibility,
        witness_anchors: Object.freeze(witnessAnchors),
    });
}

function readWitnessSupport(
    database: DatabaseSync,
    records: readonly SliceRecord[],
): readonly SliceRecord[] {
    const support = new Map<RecordId, SliceRecord>();
    const validated = new Set<RecordId>();
    for (const selected of records) {
        let witnessRef = selected.envelope.witness_ref;
        const chain = new Set<RecordId>();
        while (witnessRef !== "") {
            if (validated.has(witnessRef)) {
                break;
            }
            chain.add(witnessRef);
            const witness = readStoredRecord(database, witnessRef);
            if (
                witness === undefined ||
                (witness.envelope.schema_ref !== kernelProtocolConfig.rootWitness.schemaRef &&
                    witness.envelope.schema_ref !== kernelProtocolConfig.queries.witnessSchemaRef)
            ) {
                throw new TraceStoreError(
                    `witness_ref does not resolve to a witness: ${witnessRef}`,
                );
            }
            support.set(witnessRef, {
                body: witness.body,
                envelope: witness.envelope,
            });
            witnessRef = witness.envelope.witness_ref;
        }
        for (const recordId of chain) {
            validated.add(recordId);
        }
    }
    return Object.freeze([...support.values()]);
}

function modeMatches(mode: string, filter: ModeFilter): boolean {
    return (
        filter === "both" ||
        (filter === "captures_only" && mode === "capture") ||
        (filter === "declarations_only" && mode === "declaration")
    );
}

function compareSliceRecords(left: SliceRecord, right: SliceRecord): number {
    if (left.view === undefined) {
        return 1;
    }
    if (right.view === undefined) {
        return -1;
    }
    return (
        left.view.owner_id.localeCompare(right.view.owner_id) ||
        left.view.owner_ordinal - right.view.owner_ordinal
    );
}
