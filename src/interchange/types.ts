import type { RecordBody, RecordEnvelope } from "../record/types.ts";

/** Result of importing one complete native trace archive. */
export type TraceImportReceipt = {
    /** Number of durable append intents imported. */
    readonly imported_append_intent_count: number;
    /** Number of content-addressed blobs imported. */
    readonly imported_blob_count: number;
    /** Number of published cuts imported. */
    readonly imported_cut_count: number;
    /** Number of canonical records imported, including the root witness. */
    readonly imported_record_count: number;
    /** Number of owner-local record occurrences imported. */
    readonly imported_record_view_count: number;
};

/** Internal decoded record representation for native trace archives. */
export type TraceArchiveRecord = {
    readonly body: RecordBody;
    readonly envelope: RecordEnvelope;
};

/** Internal decoded owner-view representation for native trace archives. */
export type TraceArchiveView = {
    readonly append_intent_id: string;
    readonly append_position: number;
    readonly owner_id: string;
    readonly owner_ordinal: number;
    readonly record_id: string;
};

/** Internal decoded append-intent representation for native trace archives. */
export type TraceArchiveIntent = {
    readonly append_intent_id: string;
    readonly batch_digest: string;
    readonly receipt_json: string;
};

/** Internal decoded cut representation for native trace archives. */
export type TraceArchiveCut = {
    readonly append_intent_id: string;
    readonly created_by_record_id: string;
    readonly cut_id: string;
    readonly publisher_owner_id: string;
    readonly target_owner_id: string;
    readonly through_owner_ordinal: number;
    readonly through_record_id: string;
};

/** Internal decoded blob representation for native trace archives. */
export type TraceArchiveBlob = {
    readonly blob_id: string;
    readonly byte_length: number;
    readonly content: Uint8Array;
};

/** Internal validated representation of one complete native trace archive. */
export type DecodedTraceArchive = {
    readonly appendIntents: readonly TraceArchiveIntent[];
    readonly blobs: readonly TraceArchiveBlob[];
    readonly cuts: readonly TraceArchiveCut[];
    readonly records: readonly TraceArchiveRecord[];
    readonly recordViews: readonly TraceArchiveView[];
};
