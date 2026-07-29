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

/** Stable identifier for one published immutable trace cut. */
export type CutId = string;

/** Configured record-mode selection applied to traversal records. */
export type ModeFilter = "both" | "captures_only" | "declarations_only";

/** Payload disclosure level for a graph-shaped trace read. */
export type VisibilityProfile = "full_internal" | "payload" | "shape_only";

/** Whether omitted causal parents are represented as anchors. */
export type ClosurePolicy = "include_external_anchors" | "visible_only";

/** Input used to publish an immutable owner-prefix cut. */
export type CutSpec = {
    /** Optional append intent; defaults from the configured cut prefix and ID. */
    readonly append_intent_id?: AppendIntentId;
    /** Additional causes for the retained cut-publication record. */
    readonly caused_by_record_ids?: readonly RecordId[];
    /** Stable caller-selected cut identity. */
    readonly cut_id: CutId;
    /** Owner receiving the cut-publication record; defaults to the target owner. */
    readonly publisher_owner_id?: TraceOwnerId;
    /** Owner path addressed by the cut. */
    readonly target_owner_id: TraceOwnerId;
    /** Record occurrence through which the owner prefix is retained. */
    readonly through_record_id: RecordId;
    /** Witness for the cut-publication record; defaults to the configured root witness. */
    readonly witness_ref?: RecordId;
};

/** Durable immutable address of an owner-path prefix. */
export type Cut = {
    /** Record that semantically publishes this cut. */
    readonly created_by_record_id: RecordId;
    /** Stable cut identity. */
    readonly cut_id: CutId;
    /** Owner containing the publication record. */
    readonly publisher_owner_id: TraceOwnerId;
    /** Owner path addressed by the cut. */
    readonly target_owner_id: TraceOwnerId;
    /** Retained ordinal of the addressed occurrence. */
    readonly through_owner_ordinal: OwnerOrdinal;
    /** Record at the addressed owner position. */
    readonly through_record_id: RecordId;
};

/** Visibility-filtered record shape without its semantic body. */
export type RecordShape = {
    /** Verified retained envelope. */
    readonly envelope: RecordEnvelope;
    /** Stable reason why the body is unavailable. */
    readonly hidden_reason: "payload_hidden";
    /** Selected owner-local occurrence, when one exists. */
    readonly view?: RecordView;
};

/** One selected payload-visible record occurrence. */
export type SliceRecord = {
    /** Canonical semantic body. */
    readonly body: RecordBody;
    /** Verified retained envelope. */
    readonly envelope: RecordEnvelope;
    /** Selected owner-local occurrence, when one exists. */
    readonly view?: RecordView;
};

/** Visible placeholder for a direct causal parent omitted from a slice. */
export type ExternalAnchor = {
    /** Stable reason the parent is not selected. */
    readonly hidden_reason: "outside_slice";
    /** Omitted direct parent record. */
    readonly ref: RecordId;
};

/** Visible placeholder for witness support whose payload is hidden. */
export type WitnessAnchor = {
    /** Stable reason the witness payload is unavailable. */
    readonly hidden_reason: "hidden_by_visibility";
    /** Shape visible without the witness body. */
    readonly visible_shape: {
        readonly schema_ref: string;
        readonly witness_ref: RecordId | "";
    };
    /** Retained witness record identity. */
    readonly witness_ref: RecordId;
};

/** Shared options for owner-prefix and published-cut reads. */
export type SliceReadOptions = {
    /** Traversal-record mode filter. */
    readonly mode_filter?: ModeFilter;
    /** Payload disclosure profile. */
    readonly visibility_profile?: VisibilityProfile;
};

/** Options for a causal-closure read. */
export type CausalClosureOptions = SliceReadOptions & {
    /** Whether direct omitted parents appear as anchors. */
    readonly closure_policy?: ClosurePolicy;
};

/** Immutable graph-shaped trace read. */
export type Slice = {
    /** Direct selected-record causal edges in deterministic order. */
    readonly causal_edges: readonly (readonly [RecordId, RecordId])[];
    /** Direct causal parents outside the selected set. */
    readonly external_anchors: readonly ExternalAnchor[];
    /** Applied traversal-record mode filter. */
    readonly mode_filter: ModeFilter;
    /** Selected record IDs on each owner path. */
    readonly owner_paths: Readonly<Record<TraceOwnerId, readonly RecordId[]>>;
    /** Published cut that addressed this read, when applicable. */
    readonly read_address?: Cut;
    /** Selected payload records or payload-hidden shapes keyed by identity. */
    readonly visible_records_by_id: Readonly<Record<RecordId, RecordShape | SliceRecord>>;
    /** Supporting witness records keyed by identity when payload-visible. */
    readonly visible_witnesses_by_id: Readonly<Record<RecordId, SliceRecord>>;
    /** Applied disclosure profile. */
    readonly visibility_profile: VisibilityProfile;
    /** Supporting witness placeholders when shape-only. */
    readonly witness_anchors: readonly WitnessAnchor[];
};
