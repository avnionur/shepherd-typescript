export { planAppendBatch } from "./append/plan.ts";
export type {
    AppendBatchDraft,
    AppendGroupDraft,
    AppendLocalId,
    AppendPlanningState,
    AppendRecordDraft,
    OwnerOrdinal,
    PlannedAppendBatch,
    PlannedRecord,
    RecordView,
    TraceOwnerId,
} from "./append/types.ts";
export {
    canonicalizeRecord,
    createRecordId,
    type SemanticRecord,
    type SemanticScalar,
    type SemanticValue,
} from "./canonical/canonical-record.ts";
export { createRecordEnvelope } from "./record/envelope.ts";
export { validateRecordBody } from "./record/guards.ts";
export { ROOT_WITNESS_ID } from "./record/root-witness.ts";
export {
    KERNEL_ABI_VERSION,
    KERNEL_CANONICAL_VERSION,
    RECORD_MODES,
    type RecordBody,
    type RecordEnvelope,
    type RecordEnvelopeDraft,
    type RecordId,
    type RecordMode,
} from "./record/types.ts";
export { validateRecordEnvelope } from "./record/validation.ts";
export {
    AppendIntentConflictError,
    BlobIntegrityError,
    TraceStoreError,
    UnsupportedStoreSchemaError,
} from "./store/errors.ts";
export { SQLiteTraceStore } from "./store/sqlite-trace-store.ts";
export type {
    AppendIntentId,
    AppendReceipt,
    BlobId,
    BlobIntegrityIssue,
    BlobIntegrityReport,
    BlobStorageReceipt,
    OwnerRecord,
    RetainedRecord,
    SQLiteTraceStoreOptions,
    StoreAppendRequest,
} from "./store/types.ts";
