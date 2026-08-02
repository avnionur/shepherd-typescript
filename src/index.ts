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
export type { TraceImportReceipt } from "./interchange/types.ts";
export { projectExecution } from "./projection/execution.ts";
export { projectEffectiveHistory } from "./projection/history.ts";
export {
    activeExecutionRelations,
    projectExecutionRelations,
} from "./projection/relations.ts";
export type {
    EffectiveChild,
    EffectiveHistory,
    Execution,
    ExecutionRelation,
    ExecutionStatus,
    PublishedRecord,
} from "./projection/types.ts";
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
    ProjectionCompatibilityError,
    TraceStoreError,
    UnsupportedStoreSchemaError,
} from "./store/errors.ts";
export type {
    AppendRecoveryDiagnostic,
    AppendRecoveryIssue,
    AppendRecoveryStatus,
    TraceIntegrityIssue,
    TraceIntegrityIssueKind,
    TraceIntegrityReport,
} from "./store/integrity-types.ts";
export { SQLiteTraceStore } from "./store/sqlite-trace-store.ts";
export type {
    AppendIntentId,
    AppendReceipt,
    BlobId,
    BlobIntegrityIssue,
    BlobIntegrityReport,
    BlobOrphanCollectionMode,
    BlobOrphanCollectionOptions,
    BlobOrphanCollectionReport,
    BlobStorageReceipt,
    CausalClosureOptions,
    ClosurePolicy,
    Cut,
    CutId,
    CutSpec,
    ExternalAnchor,
    ModeFilter,
    OwnerRecord,
    RecordShape,
    RetainedRecord,
    Slice,
    SliceReadOptions,
    SliceRecord,
    SQLiteTraceStoreOptions,
    StoreAppendRequest,
    VisibilityProfile,
    WitnessAnchor,
} from "./store/types.ts";
export { task } from "./task/descriptor.ts";
export {
    type InferTaskSchema,
    type InferTaskSchemaShape,
    schema,
    type TaskSchema,
    type TaskSchemaFactory,
    type TaskSchemaShape,
} from "./task/schema.ts";
export type {
    TaskArtifact,
    TaskArtifactLock,
    TaskDefinition,
    TaskDescriptor,
} from "./task/types.ts";
