import assert from "node:assert/strict";
import { test } from "node:test";

import * as operations from "../../src/facades/operations.ts";
import * as trace from "../../src/facades/trace.ts";
import * as root from "../../src/index.ts";

test("operations facade symbols are identical to their root exports", () => {
    assert.equal(operations.scanSemanticValueForSecrets, root.scanSemanticValueForSecrets);
    assert.equal(operations.classifyTraceSchema, root.classifyTraceSchema);
    assert.equal(operations.readRetentionPolicy, root.readRetentionPolicy);
    assert.equal(operations.exportRedactedTraceArchive, root.exportRedactedTraceArchive);
    assert.equal(operations.verifyRedactedTraceArchive, root.verifyRedactedTraceArchive);
    assert.equal(operations.inspectTraceRetention, root.inspectTraceRetention);
    assert.equal(operations.RedactedTraceArchiveError, root.RedactedTraceArchiveError);
    assert.equal(operations.TraceSecretDetectedError, root.TraceSecretDetectedError);
    assert.equal(operations.TraceStoreError, root.TraceStoreError);
    assert.equal(operations.TraceStoreReadOnlyError, root.TraceStoreReadOnlyError);
    assert.equal(trace.TraceStoreReadOnlyError, root.TraceStoreReadOnlyError);
    assert.equal(operations.TraceArchiveLimitError, root.TraceArchiveLimitError);
    assert.equal(trace.TraceArchiveLimitError, root.TraceArchiveLimitError);
    assert.equal(operations.RETENTION_DATA_CLASSES, root.RETENTION_DATA_CLASSES);
    assert.equal(operations.RETENTION_EXPORT_DISPOSITIONS, root.RETENTION_EXPORT_DISPOSITIONS);
    assert.equal(operations.SECRET_SCANNING_MODES, root.SECRET_SCANNING_MODES);
    assert.equal(trace.TraceSecretDetectedError, root.TraceSecretDetectedError);
    assert.equal("SQLiteTraceStore" in operations, false);
});

test("operations facade exports storage interfaces, reference adapters, and kits", () => {
    assert.equal(
        operations.checkBlobStoreBackendConformance,
        root.checkBlobStoreBackendConformance,
    );
    assert.equal(
        operations.checkStorageCoordinatorConformance,
        root.checkStorageCoordinatorConformance,
    );
    assert.equal(
        operations.createFilesystemBlobStoreBackend,
        root.createFilesystemBlobStoreBackend,
    );
    assert.equal(operations.createMemoryBlobStoreBackend, root.createMemoryBlobStoreBackend);
    assert.equal(operations.createMemoryStorageCoordinator, root.createMemoryStorageCoordinator);
    assert.equal(operations.createSQLiteStorageCoordinator, root.createSQLiteStorageCoordinator);
    assert.equal(operations.StorageAdapterError, root.StorageAdapterError);
    assert.equal(operations.StorageBlobContentMismatchError, root.StorageBlobContentMismatchError);
    assert.equal(operations.STORAGE_DURABILITIES, root.STORAGE_DURABILITIES);
    assert.equal(operations.STORAGE_LEASE_STATUSES, root.STORAGE_LEASE_STATUSES);
    assert.equal(operations.STORAGE_REF_SWAP_STATUSES, root.STORAGE_REF_SWAP_STATUSES);
});

test("operations facade exports non-canonical telemetry export", () => {
    assert.equal(operations.createTraceTelemetryExporter, root.createTraceTelemetryExporter);
    assert.equal(operations.createJsonLinesTelemetrySink, root.createJsonLinesTelemetrySink);
    assert.equal(operations.deriveTelemetryTraceId, root.deriveTelemetryTraceId);
    assert.equal(operations.deriveTelemetrySpanId, root.deriveTelemetrySpanId);
    assert.equal(operations.TELEMETRY_BODY_MODES, root.TELEMETRY_BODY_MODES);
    assert.equal(operations.TELEMETRY_BODY_HANDLINGS, root.TELEMETRY_BODY_HANDLINGS);
});

test("operations facade exports verified backup, restore, and replication", () => {
    assert.equal(operations.backupTraceStore, root.backupTraceStore);
    assert.equal(operations.verifyTraceStoreBackup, root.verifyTraceStoreBackup);
    assert.equal(operations.restoreTraceStoreBackup, root.restoreTraceStoreBackup);
    assert.equal(operations.replicateTraceStoreBackup, root.replicateTraceStoreBackup);
    assert.equal(operations.fetchReplicatedTraceStoreBackup, root.fetchReplicatedTraceStoreBackup);
    assert.equal(operations.TraceStoreBackupError, root.TraceStoreBackupError);
    assert.equal(operations.STORE_BACKUP_BLOB_LOCATIONS, root.STORE_BACKUP_BLOB_LOCATIONS);
    assert.equal(operations.STORE_BACKUP_FAILURE_REASONS, root.STORE_BACKUP_FAILURE_REASONS);
});
