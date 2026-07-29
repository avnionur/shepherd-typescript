import type { DatabaseSync } from "node:sqlite";

import type { RecordId } from "../record/types.ts";
import { encodeAppendReceipt } from "./codec.ts";
import { TraceStoreError } from "./errors.ts";
import type { AppendReceipt } from "./types.ts";

/** Verifies a replay receipt against rows committed for its append intent. */
export function assertStoredReceiptMatches(database: DatabaseSync, receipt: AppendReceipt): void {
    const rows = database
        .prepare(
            `SELECT v.append_position, v.owner_id, v.owner_ordinal, v.record_id, r.caused_by_json
             FROM record_views v
             JOIN records r ON r.record_id = v.record_id
             WHERE v.append_intent_id = ?
             ORDER BY v.append_position`,
        )
        .all(receipt.append_intent_id);
    const recordIds: RecordId[] = [];
    const causalEdges: (readonly [RecordId, RecordId])[] = [];
    const ownerOrdinalRanges = new Map<string, readonly [number, number]>();
    for (const [expectedPosition, row] of rows.entries()) {
        if (Number(row.append_position) !== expectedPosition) {
            throw new TraceStoreError("stored append positions are not contiguous");
        }
        const ownerId = String(row.owner_id);
        const ownerOrdinal = Number(row.owner_ordinal);
        const recordId = String(row.record_id);
        recordIds.push(recordId);
        const existingRange = ownerOrdinalRanges.get(ownerId);
        ownerOrdinalRanges.set(
            ownerId,
            existingRange === undefined
                ? [ownerOrdinal, ownerOrdinal]
                : [existingRange[0], ownerOrdinal],
        );
        const parentIds = JSON.parse(String(row.caused_by_json)) as readonly RecordId[];
        for (const parentId of parentIds) {
            causalEdges.push([parentId, recordId]);
        }
    }
    const reconstructed: AppendReceipt = {
        append_intent_id: receipt.append_intent_id,
        causal_edges: causalEdges,
        owner_ordinal_ranges: ownerOrdinalRanges,
        record_ids: recordIds,
    };
    if (encodeAppendReceipt(reconstructed) !== encodeAppendReceipt(receipt)) {
        throw new TraceStoreError("stored append receipt does not match committed append rows");
    }
}
