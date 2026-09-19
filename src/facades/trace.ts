/** Stable Node-only ESM subpath for trace persistence, interchange, and bounded reads. */
export { TraceArchiveLimitError } from "../interchange/errors.ts";
export type { TraceImportReceipt } from "../interchange/types.ts";
export {
    listOutputCitations,
    resolveOutputCitationSelector,
} from "../ledger/output-citations.ts";
export {
    listRecoveryRecords,
    resolveRecoveryRecordSelector,
} from "../ledger/recovery-records.ts";
export { listRunLedger, resolveRunLedgerSelector } from "../ledger/run-ledger.ts";
export {
    LedgerSelectorAmbiguousError,
    LedgerSelectorNotFoundError,
} from "../ledger/selector-errors.ts";
export {
    listTraceRevisions,
    resolveTraceRevisionSelector,
} from "../ledger/trace-revisions.ts";
export type {
    LedgerListOptions,
    OutputCitationEntry,
    RecoveryCommandEvidence,
    RecoveryCommandResult,
    RecoveryInvocationClaimEvidence,
    RecoveryRecordEntry,
    RunLedgerEntry,
    RunLedgerNativeJailProcessEvidence,
    TraceRevisionEntry,
} from "../ledger/types.ts";
export { ROOT_WITNESS_ID } from "../record/root-witness.ts";
export type { SecretScanningMode } from "../retention/policy.ts";
export {
    AppendIntentConflictError,
    BlobIntegrityError,
    ProjectionCompatibilityError,
    TraceSecretDetectedError,
    TraceStoreError,
    TraceStoreReadOnlyError,
    UnsupportedStoreSchemaError,
} from "../store/errors.ts";
export type {
    AppendRecoveryDiagnostic,
    AppendRecoveryIssue,
    AppendRecoveryStatus,
    TraceIntegrityIssue,
    TraceIntegrityIssueKind,
    TraceIntegrityReport,
} from "../store/integrity-types.ts";
export { SQLiteTraceStore } from "../store/sqlite-trace-store.ts";
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
    TraceStoreCheckpointReport,
    TraceStoreMaintenanceMode,
    TraceStoreMaintenanceOptions,
    TraceStoreMaintenanceReport,
    TraceStoreSpaceReport,
    VisibilityProfile,
    WitnessAnchor,
} from "../store/types.ts";
