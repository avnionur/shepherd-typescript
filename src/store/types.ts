import type {
    AppendBatchDraft,
    OwnerOrdinal,
    PlannedRecord,
    RecordView,
    TraceOwnerId,
} from "../append/types.ts";
import type { RecordBody, RecordEnvelope, RecordId } from "../record/types.ts";

/**
 * Stable identifier for one idempotent append attempt.
 *
 * @public
 */
export type AppendIntentId = string;

/**
 * One atomic append request presented to a trace store.
 *
 * @public
 */
export type StoreAppendRequest = {
    /** Stable idempotency key for this semantic batch. */
    readonly append_intent_id: AppendIntentId;
    /** Ordered semantic batch to validate and retain. */
    readonly batch: AppendBatchDraft;
};

/**
 * Durable result returned for a committed or identically replayed append.
 *
 * @public
 */
export type AppendReceipt = {
    /** Idempotency key that names the committed append. */
    readonly append_intent_id: AppendIntentId;
    /** Ordered parent-to-child edges committed by this append. */
    readonly causal_edges: readonly (readonly [RecordId, RecordId])[];
    /** Inclusive ordinal range allocated for each changed owner. */
    readonly owner_ordinal_ranges: ReadonlyMap<TraceOwnerId, readonly [OwnerOrdinal, OwnerOrdinal]>;
    /** Record identities in batch and group order. */
    readonly record_ids: readonly RecordId[];
};

/**
 * One semantic record and every retained owner-local occurrence.
 *
 * @public
 */
export type RetainedRecord = {
    /** Canonical semantic payload. */
    readonly body: RecordBody;
    /** Content-addressed semantic envelope. */
    readonly envelope: RecordEnvelope;
    /** Owner-local placements ordered by owner and ordinal. */
    readonly views: readonly RecordView[];
};

/**
 * Read result for one owner-local record occurrence.
 *
 * @public
 */
export type OwnerRecord = PlannedRecord;
