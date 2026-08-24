import type { DatabaseSync } from "node:sqlite";

import { kernelProtocolConfig } from "../protocol/config.ts";
import { assertNonEmptyString } from "../record/guards.ts";
import { ROOT_WITNESS_ID } from "../record/root-witness.ts";
import type { RecordBody, RecordId } from "../record/types.ts";
import { appendWithinTraceStoreTransaction } from "./append.ts";
import { STORE_TABLES, STORE_TRANSACTION_SQL } from "./constants.ts";
import { TraceStoreError } from "./errors.ts";
import { normalizeCutSpec } from "./query-validation.ts";
import { readStoredRecord } from "./read.ts";
import type { Cut, CutId, CutSpec } from "./types.ts";

/** Publishes one immutable owner-prefix cut and its semantic record atomically. */
export function publishStoredCut(database: DatabaseSync, spec: CutSpec): Cut {
    const normalized = normalizeCutSpec(spec);
    const publisherOwnerId = normalized.publisher_owner_id ?? normalized.target_owner_id;
    const appendIntentId =
        normalized.append_intent_id ??
        `${kernelProtocolConfig.queries.cutAppendIntentPrefix}${normalized.cut_id}`;
    database.exec(STORE_TRANSACTION_SQL.begin);
    try {
        const existing = database
            .prepare(`SELECT append_intent_id FROM ${STORE_TABLES.cuts} WHERE cut_id = ?`)
            .get(normalized.cut_id);
        if (existing !== undefined) {
            const retained = readStoredCut(database, normalized.cut_id);
            const publication = readStoredRecord(database, retained.created_by_record_id);
            if (
                existing.append_intent_id !== appendIntentId ||
                publication === undefined ||
                publication.envelope.witness_ref !== (normalized.witness_ref ?? ROOT_WITNESS_ID) ||
                !sameRecordIds(publication.envelope.caused_by_record_ids, [
                    normalized.through_record_id,
                    ...(normalized.caused_by_record_ids ?? []),
                ]) ||
                retained.publisher_owner_id !== publisherOwnerId ||
                retained.target_owner_id !== normalized.target_owner_id ||
                retained.through_record_id !== normalized.through_record_id
            ) {
                throw new TraceStoreError(
                    `cut ${normalized.cut_id} already names a different publication`,
                );
            }
            database.exec(STORE_TRANSACTION_SQL.commit);
            return retained;
        }
        const through = database
            .prepare(
                `SELECT owner_ordinal FROM ${STORE_TABLES.recordViews}
                 WHERE owner_id = ? AND record_id = ?
                 ORDER BY owner_ordinal DESC LIMIT 1`,
            )
            .get(normalized.target_owner_id, normalized.through_record_id);
        if (through === undefined) {
            throw new TraceStoreError("cut through record is not retained on the target owner");
        }
        const throughOrdinal = Number(through.owner_ordinal);
        const body: RecordBody = {
            cut_id: normalized.cut_id,
            publisher_owner_id: publisherOwnerId,
            target_owner_id: normalized.target_owner_id,
            through_owner_ordinal: throughOrdinal,
            through_record_id: normalized.through_record_id,
        };
        const receipt = appendWithinTraceStoreTransaction(database, {
            append_intent_id: appendIntentId,
            batch: {
                groups: [
                    {
                        owner_id: publisherOwnerId,
                        records: [
                            {
                                body,
                                caused_by_record_ids: [
                                    normalized.through_record_id,
                                    ...(normalized.caused_by_record_ids ?? []),
                                ],
                                mode: "capture",
                                schema_ref: kernelProtocolConfig.queries.cutSchemaRef,
                                witness_ref: normalized.witness_ref ?? ROOT_WITNESS_ID,
                            },
                        ],
                    },
                ],
            },
        });
        const cut = freezeCut({
            created_by_record_id: receipt.record_ids[0] as RecordId,
            cut_id: normalized.cut_id,
            publisher_owner_id: publisherOwnerId,
            target_owner_id: normalized.target_owner_id,
            through_owner_ordinal: throughOrdinal,
            through_record_id: normalized.through_record_id,
        });
        database
            .prepare(
                `INSERT INTO ${STORE_TABLES.cuts}(
                    cut_id, target_owner_id, through_record_id, through_owner_ordinal,
                    publisher_owner_id, created_by_record_id, append_intent_id
                 ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
                cut.cut_id,
                cut.target_owner_id,
                cut.through_record_id,
                cut.through_owner_ordinal,
                cut.publisher_owner_id,
                cut.created_by_record_id,
                appendIntentId,
            );
        database.exec(STORE_TRANSACTION_SQL.commit);
        return cut;
    } catch (error) {
        database.exec(STORE_TRANSACTION_SQL.rollback);
        throw error;
    }
}

/** Reads and verifies one published cut. */
export function readStoredCut(database: DatabaseSync, cutId: CutId): Cut {
    assertNonEmptyString(cutId, "cutId");
    const row = database
        .prepare(
            `SELECT cut_id, target_owner_id, through_record_id, through_owner_ordinal,
                    publisher_owner_id, created_by_record_id, append_intent_id
             FROM ${STORE_TABLES.cuts} WHERE cut_id = ?`,
        )
        .get(cutId);
    if (row === undefined) {
        throw new TraceStoreError(`unknown cut: ${cutId}`);
    }
    const cut = freezeCut({
        created_by_record_id: String(row.created_by_record_id),
        cut_id: String(row.cut_id),
        publisher_owner_id: String(row.publisher_owner_id),
        target_owner_id: String(row.target_owner_id),
        through_owner_ordinal: Number(row.through_owner_ordinal),
        through_record_id: String(row.through_record_id),
    });
    const publication = readStoredRecord(database, cut.created_by_record_id);
    if (
        publication === undefined ||
        publication.envelope.schema_ref !== kernelProtocolConfig.queries.cutSchemaRef ||
        publication.body.cut_id !== cut.cut_id ||
        publication.body.publisher_owner_id !== cut.publisher_owner_id ||
        publication.body.target_owner_id !== cut.target_owner_id ||
        publication.body.through_owner_ordinal !== cut.through_owner_ordinal ||
        publication.body.through_record_id !== cut.through_record_id ||
        publication.envelope.caused_by_record_ids[0] !== cut.through_record_id
    ) {
        throw new TraceStoreError("cut index disagrees with its retained publication record");
    }
    const publicationView = database
        .prepare(
            `SELECT 1 FROM ${STORE_TABLES.recordViews}
             WHERE owner_id = ? AND record_id = ? AND append_intent_id = ?
               AND append_position = 0`,
        )
        .get(cut.publisher_owner_id, cut.created_by_record_id, String(row.append_intent_id));
    if (publicationView === undefined) {
        throw new TraceStoreError("cut publication is not retained by its indexed append intent");
    }
    const retainedAddress = database
        .prepare(
            `SELECT 1 FROM ${STORE_TABLES.recordViews}
             WHERE owner_id = ? AND owner_ordinal = ? AND record_id = ?`,
        )
        .get(cut.target_owner_id, cut.through_owner_ordinal, cut.through_record_id);
    if (retainedAddress === undefined) {
        throw new TraceStoreError("cut target is not retained at its published owner address");
    }
    return cut;
}

/** Reads one cut when retained, otherwise returns undefined. @internal */
export function readOptionalStoredCut(database: DatabaseSync, cutId: CutId): Cut | undefined {
    assertNonEmptyString(cutId, "cutId");
    const retained = database
        .prepare(`SELECT 1 FROM ${STORE_TABLES.cuts} WHERE cut_id = ?`)
        .get(cutId);
    return retained === undefined ? undefined : readStoredCut(database, cutId);
}

/** Lists a bounded canonical or reverse-canonical cut slice. @internal */
export function listStoredCuts(
    database: DatabaseSync,
    limit: number,
    offset: number,
    descending: boolean,
    cutPrefix?: string,
): readonly Cut[] {
    const direction = descending ? "DESC" : "ASC";
    const prefixClause = cutPrefix === undefined ? "" : "WHERE substr(cut_id, 1, length(?)) = ?";
    const rows = database
        .prepare(
            `SELECT cut_id FROM ${STORE_TABLES.cuts}
             ${prefixClause}
             ORDER BY CAST(created_by_record_id AS BLOB) ${direction}, CAST(cut_id AS BLOB) ${direction}
             LIMIT ? OFFSET ?`,
        )
        .all(
            ...(cutPrefix === undefined ? [limit, offset] : [cutPrefix, cutPrefix, limit, offset]),
        ) as { cut_id: string }[];
    return Object.freeze(rows.map(({ cut_id: cutId }) => readStoredCut(database, cutId)));
}

function freezeCut(cut: Cut): Cut {
    return Object.freeze(cut);
}

function sameRecordIds(left: readonly RecordId[], right: readonly RecordId[]): boolean {
    return (
        left.length === right.length && left.every((recordId, index) => recordId === right[index])
    );
}
