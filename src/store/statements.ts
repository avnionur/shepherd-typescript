import { STORE_TABLES } from "./constants.ts";

/**
 * SQL of the trace-store hot paths, shared by the store readers and the query-plan tests.
 *
 * Every statement here is expected to resolve through a primary key or a declared index; the
 * query-plan tests assert that SQLite never plans a full table scan for them.
 *
 * @internal
 */
export const HOT_PATH_SQL = Object.freeze({
    /** Append planning: whether one referenced parent or witness record is retained, and its schema. */
    appendKnownRecord: `SELECT schema_ref FROM ${STORE_TABLES.records} WHERE record_id = ?`,
    /** Append planning: the next unallocated ordinal of one owner in the batch. */
    appendOwnerNextOrdinal: `SELECT next_ordinal FROM ${STORE_TABLES.ownerOrdinals} WHERE owner_id = ?`,
    /** `resolveCut`/`readCut`: the indexed cut row. */
    cutRow: `SELECT cut_id, target_owner_id, through_record_id, through_owner_ordinal,
                    publisher_owner_id, created_by_record_id, append_intent_id
             FROM ${STORE_TABLES.cuts} WHERE cut_id = ?`,
    /** `resolveCut`/`readCut`: the publication view retained by the indexed append intent. */
    cutPublicationView: `SELECT 1 FROM ${STORE_TABLES.recordViews}
             WHERE owner_id = ? AND record_id = ? AND append_intent_id = ?
               AND append_position = 0`,
    /** `resolveCut`/`readCut`: the target occurrence at the published address. */
    cutTargetAddress: `SELECT 1 FROM ${STORE_TABLES.recordViews}
             WHERE owner_id = ? AND owner_ordinal = ? AND record_id = ?`,
    /** Integrity parent lookup: the ordered parent index of one child record. */
    parentsByChild: `SELECT parent_record_id, parent_position
             FROM ${STORE_TABLES.recordParents}
             WHERE child_record_id = ? ORDER BY parent_position`,
    /** `readOwnerPrefix`/`resolveCut`: the owner views through an inclusive ordinal. */
    ownerPrefixViews: `SELECT append_intent_id, owner_id, owner_ordinal, record_id
             FROM ${STORE_TABLES.recordViews}
             WHERE owner_id = ? AND owner_ordinal <= ?
             ORDER BY owner_ordinal`,
    /** `readOwner`: every occurrence on one owner path joined to its record. */
    ownerRecords: `SELECT r.record_id, r.digest, r.schema_ref, r.mode, r.witness_ref,
                        r.caused_by_json, r.body_json, v.append_intent_id, v.owner_id,
                        v.owner_ordinal
                 FROM ${STORE_TABLES.recordViews} v
                 JOIN ${STORE_TABLES.records} r ON r.record_id = v.record_id
                 WHERE v.owner_id = ?
                 ORDER BY v.owner_ordinal`,
    /** Subscription pull and cut iteration: one owner occurrence joined to its record. */
    ownerRecordAtOrdinal: `SELECT r.record_id, r.digest, r.schema_ref, r.mode, r.witness_ref,
                    r.caused_by_json, r.body_json, v.append_intent_id, v.owner_id,
                    v.owner_ordinal
             FROM ${STORE_TABLES.recordViews} v
             JOIN ${STORE_TABLES.records} r ON r.record_id = v.record_id
             WHERE v.owner_id = ? AND v.owner_ordinal = ?`,
    /** `readRecord`: one semantic record by identity. */
    record: `SELECT record_id, digest, schema_ref, mode, witness_ref, caused_by_json, body_json
             FROM ${STORE_TABLES.records} WHERE record_id = ?`,
    /** `readRecord`: every owner-local view of one record. */
    recordViews: `SELECT append_intent_id, owner_id, owner_ordinal FROM ${STORE_TABLES.recordViews}
             WHERE record_id = ? ORDER BY owner_id, owner_ordinal`,
});

/**
 * SQL of `listOwnersBySchema`, which pages owners by canonical creation-record/owner byte order.
 *
 * @param descending - Whether canonical ordering is reversed.
 * @param prefixed - Whether an exact owner-ID prefix filter is bound.
 * @returns The statement text; parameters are schema, optional prefix twice, limit, and offset.
 * @internal
 */
export function listOwnersBySchemaSql(descending: boolean, prefixed: boolean): string {
    const direction = descending ? "DESC" : "ASC";
    const prefixClause = prefixed ? "AND substr(v.owner_id, 1, length(?)) = ?" : "";
    return `SELECT v.owner_id
             FROM ${STORE_TABLES.recordViews} AS v
             INNER JOIN ${STORE_TABLES.records} AS r ON r.record_id = v.record_id
             WHERE r.schema_ref = ?
             ${prefixClause}
             GROUP BY v.owner_id
             ORDER BY CAST(MIN(r.record_id) AS BLOB) ${direction}, CAST(v.owner_id AS BLOB) ${direction}
             LIMIT ? OFFSET ?`;
}

/**
 * SQL of `listCuts`, which pages cuts by canonical publication-record/cut byte order.
 *
 * @param descending - Whether canonical ordering is reversed.
 * @param prefixed - Whether an exact cut-ID prefix filter is bound.
 * @returns The statement text; parameters are optional prefix twice, limit, and offset.
 * @internal
 */
export function listCutsSql(descending: boolean, prefixed: boolean): string {
    const direction = descending ? "DESC" : "ASC";
    const prefixClause = prefixed ? "WHERE substr(cut_id, 1, length(?)) = ?" : "";
    return `SELECT cut_id FROM ${STORE_TABLES.cuts}
             ${prefixClause}
             ORDER BY CAST(created_by_record_id AS BLOB) ${direction}, CAST(cut_id AS BLOB) ${direction}
             LIMIT ? OFFSET ?`;
}
