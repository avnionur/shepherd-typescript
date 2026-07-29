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

/**
 * Content-addressed identity of one retained binary value.
 *
 * @public
 */
export type BlobId = string;

/**
 * Durable result returned after blob bytes and metadata are retained.
 *
 * @public
 */
export type BlobStorageReceipt = {
    /** Content-addressed blob identity. */
    readonly blob_id: BlobId;
    /** Exact number of retained bytes. */
    readonly byte_length: number;
};

/**
 * Filesystem configuration for a SQLite trace store.
 *
 * @public
 */
export type SQLiteTraceStoreOptions = {
    /** Blob root directory. Defaults beside a file database or to an owned temporary directory. */
    readonly blobDirectory?: string;
};

/** Classified integrity failure for one durable blob receipt. */
export type BlobIntegrityIssue = {
    /** Blob whose bytes or receipt failed verification. */
    readonly blob_id: BlobId;
    /** Stable failure classification. */
    readonly kind:
        | "digest_mismatch"
        | "missing"
        | "not_regular_file"
        | "receipt_mismatch"
        | "size_mismatch";
};

/** Complete integrity scan result for durable blob receipts. */
export type BlobIntegrityReport = {
    /** Number of registered blobs examined. */
    readonly checked_blob_count: number;
    /** Frozen issues in blob-identifier order. */
    readonly issues: readonly BlobIntegrityIssue[];
    /** Whether every registered blob passed verification. */
    readonly ok: boolean;
};
