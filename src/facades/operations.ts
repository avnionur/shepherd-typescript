/**
 * Stable Node-only ESM subpath for secret scanning, retention classification, redacted export,
 * retention inspection, storage adapter interfaces with their reference adapters and
 * conformance kits, verified trace-store backup, restore, and replication, and non-canonical
 * OpenTelemetry-compatible telemetry export.
 */
export { TraceArchiveLimitError } from "../interchange/errors.ts";
export {
    createTraceTelemetryExporter,
    type TelemetryClock,
    type TelemetryExportReceipt,
    type TraceTelemetryExporter,
    type TraceTelemetryExporterOptions,
} from "../observability/exporter.ts";
export {
    createJsonLinesTelemetrySink,
    type JsonLinesTelemetrySinkOptions,
} from "../observability/jsonl-sink.ts";
export {
    deriveTelemetrySpanId,
    deriveTelemetryTraceId,
    type TelemetryBodyHandling,
    type TelemetryBodyMode,
} from "../observability/mapping.ts";
export type {
    OtlpAnyValue,
    OtlpExportLogsServiceRequest,
    OtlpExportTraceServiceRequest,
    OtlpInstrumentationScope,
    OtlpKeyValue,
    OtlpLogRecord,
    OtlpResource,
    OtlpResourceLogs,
    OtlpResourceSpans,
    OtlpScopeLogs,
    OtlpScopeSpans,
    OtlpSpan,
    OtlpSpanEvent,
    OtlpStatus,
    TelemetryBatch,
    TelemetrySink,
} from "../observability/otlp-types.ts";
export { backupTraceStore, type TraceStoreBackupOptions } from "../operations/backup.ts";
export type {
    TraceStoreBackupBlobLocation,
    TraceStoreBackupHead,
    TraceStoreBackupManifest,
} from "../operations/backup-manifest.ts";
export {
    TraceStoreBackupError,
    type TraceStoreBackupFailureReason,
} from "../operations/errors.ts";
export {
    fetchReplicatedTraceStoreBackup,
    replicateTraceStoreBackup,
    type TraceStoreBackupFetchOptions,
    type TraceStoreBackupReplica,
    type TraceStoreBackupReplicationOptions,
} from "../operations/replication.ts";
export {
    restoreTraceStoreBackup,
    type TraceStoreBackupVerification,
    type TraceStoreBackupVerificationOptions,
    type TraceStoreRestoreOptions,
    type TraceStoreRestoreReceipt,
    verifyTraceStoreBackup,
} from "../operations/restore.ts";
export {
    RETENTION_DATA_CLASSES,
    RETENTION_EXPORT_DISPOSITIONS,
    SECRET_SCANNING_MODES,
    STORAGE_DURABILITIES,
    STORAGE_LEASE_STATUSES,
    STORAGE_REF_SWAP_STATUSES,
    STORE_BACKUP_BLOB_LOCATIONS,
    STORE_BACKUP_FAILURE_REASONS,
    TELEMETRY_BODY_HANDLINGS,
    TELEMETRY_BODY_MODES,
} from "../protocol/values.generated.ts";
export { RedactedTraceArchiveError } from "../retention/errors.ts";
export {
    classifyTraceSchema,
    type RetentionClassificationOptions,
    type RetentionDataClass,
    type RetentionExportDisposition,
    type RetentionPolicy,
    readRetentionPolicy,
    type SecretScanningMode,
    type TraceSchemaClassification,
} from "../retention/policy.ts";
export {
    exportRedactedTraceArchive,
    type RedactedRecordBody,
    type RedactedTraceArchiveSummary,
    verifyRedactedTraceArchive,
} from "../retention/redacted-archive.ts";
export {
    inspectTraceRetention,
    type RetentionDataClassCount,
    type RetentionSecretClassCount,
    type RetentionSecretRecord,
    type TraceRetentionReport,
} from "../retention/retention-report.ts";
export {
    type SecretFinding,
    type SecretScanReport,
    scanSemanticValueForSecrets,
} from "../retention/secret-scan.ts";
export {
    type BlobStoreBackendFactory,
    checkBlobStoreBackendConformance,
    checkStorageCoordinatorConformance,
    type StorageConformanceLawResult,
    type StorageConformanceReport,
    type StorageCoordinatorFactory,
} from "../storage/conformance.ts";
export { StorageAdapterError, StorageBlobContentMismatchError } from "../storage/errors.ts";
export { createFilesystemBlobStoreBackend } from "../storage/filesystem-blob-backend.ts";
export { createMemoryBlobStoreBackend } from "../storage/memory-blob-backend.ts";
export { createMemoryStorageCoordinator } from "../storage/memory-coordinator.ts";
export {
    createSQLiteStorageCoordinator,
    type SQLiteStorageCoordinator,
} from "../storage/sqlite-coordinator.ts";
export type {
    BlobStoreBackend,
    BlobStoreListOptions,
    BlobStoreListPage,
    BlobStorePutResult,
    StorageCoordinator,
    StorageDurability,
    StorageFence,
    StorageLease,
    StorageLeaseAcquireResult,
    StorageLeaseReleaseResult,
    StorageLeaseRenewResult,
    StorageLeaseStatus,
    StorageRef,
    StorageRefSwapResult,
    StorageRefSwapStatus,
} from "../storage/types.ts";
export {
    TraceSecretDetectedError,
    TraceStoreError,
    TraceStoreReadOnlyError,
} from "../store/errors.ts";
export type {
    BlobId,
    TraceStoreCheckpointReport,
    TraceStoreMaintenanceMode,
    TraceStoreMaintenanceOptions,
    TraceStoreMaintenanceReport,
    TraceStoreSpaceReport,
} from "../store/types.ts";
