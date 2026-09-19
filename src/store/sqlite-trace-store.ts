import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { normalizeAppendBatchDraft } from "../append/validation.ts";
import { BlobFilesystem } from "../blob/filesystem.ts";
import { canonicalizeRecord } from "../canonical/canonical-record.ts";
import { exportTraceArchive } from "../interchange/export.ts";
import { importTraceArchive } from "../interchange/import.ts";
import type { TraceImportReceipt } from "../interchange/types.ts";
import { historyProjectionReadOptions } from "../projection/compatibility.ts";
import { projectExecution } from "../projection/execution.ts";
import { projectEffectiveHistory } from "../projection/history.ts";
import { activeExecutionRelations, projectExecutionRelations } from "../projection/relations.ts";
import type { EffectiveHistory, Execution } from "../projection/types.ts";
import {
    kernelProtocolConfig,
    retentionProtocolConfig,
    runProtocolConfig,
    scopeProtocolConfig,
} from "../protocol/config.ts";
import { assertNonEmptyString, assertRecordId } from "../record/guards.ts";
import { createConfiguredRootWitness } from "../record/root-witness.ts";
import type { RecordBody, RecordEnvelope, RecordId } from "../record/types.ts";
import type {
    OperationBookkeepingDefinition,
    OperationSessionDeathEvidence,
    OrphanOperationDiagnosisOptions,
    OrphanOperationDiagnosisReport,
    OrphanPreRunReclaimResult,
    OrphanRepairCommand,
    OrphanRepairPreparation,
    OrphanRepairReceipt,
} from "../repair/types.ts";
import type { SecretScanningMode } from "../retention/policy.ts";
import type { DurableExecutionPrerequisiteSatisfaction } from "../run/durable-execution-control-types.ts";
import { assertSQLiteDefensiveSupport } from "../runtime/sqlite.ts";
import { execRetryingBusy } from "../runtime/sqlite-transaction.ts";
import type {
    TraceSubscriptionCursor,
    TraceSubscriptionStartPosition,
} from "../supervision/types.ts";
import { appendToTraceStore } from "./append.ts";
import { diagnoseStoredAppend } from "./append-recovery.ts";
import {
    type ApplicationRecordAppend,
    appendApplicationRecordInStore,
    assertUnreservedApplicationOwner,
    assertUnreservedApplicationOwners,
} from "./application-records.ts";
import { resolveBlobDirectory } from "./blob-options.ts";
import { collectStoredBlobOrphans } from "./blob-orphans.ts";
import { putStoredBlob, readStoredBlob, verifyStoredBlobs } from "./blobs.ts";
import { DEFAULT_STORE_DATABASE_PATH, STORE_PRAGMA_SQL, STORE_TABLES } from "./constants.ts";
import { listStoredCuts, publishStoredCut, readOptionalStoredCut, readStoredCut } from "./cuts.ts";
import {
    appendDelegationHandleRecordInStore,
    assertUnreservedDelegationOwner,
    assertUnreservedDelegationOwners,
    type DelegationHandleAppend,
    type DelegationHandleOpen,
    type DelegationHandleOpenRequest,
    openDelegationHandleInStore,
} from "./delegation-handles.ts";
import {
    appendDurableExecutionStart,
    appendDurableExecutionTerminal,
    claimDurableExecutionInvocation,
    hasDurableExecutionInvocationAuthority,
} from "./durable-execution-claims.ts";
import {
    appendDurableExecutionInactiveCancellation,
    appendDurableExecutionResume,
    appendDurableExecutionRunningControlCommand,
    appendDurableExecutionSuspension,
    appendDurableExecutionWaiting,
} from "./durable-execution-control.ts";
import { TraceStoreError, TraceStoreReadOnlyError } from "./errors.ts";
import { prepareOwnerOnlyDatabaseFile } from "./file-mode.ts";
import { verifyTraceStoreIntegrity } from "./integrity.ts";
import type { AppendRecoveryDiagnostic, TraceIntegrityReport } from "./integrity-types.ts";
import { maintainTraceStore } from "./maintenance.ts";
import { migrateTraceStore, readCurrentTraceStoreSchemaVersion } from "./migrations.ts";
import {
    completeOpenOperation,
    diagnoseOpenOperations,
    prepareOpenOperationRepair,
    reclaimOpenOperationsBeforeRun,
    repairOpenOperations,
    retainOpenOperation,
    retainOperationSessionDeath,
} from "./orphan-operations.ts";
import {
    listOwnerIdsBySchema,
    listOwnerIdsBySchemaBodyText,
    readOwnerRecordAtOrdinal,
    readOwnerRecords,
    readStoredRecord,
    visitStoredRecords,
} from "./read.ts";
import {
    appendReplaySessionRecordInStore,
    assertUnreservedReplayOwner,
    assertUnreservedReplayOwners,
    openReplaySessionInStore,
    type ReplaySessionAppend,
    type ReplaySessionAppendRequest,
    type ReplaySessionFence,
    type ReplaySessionRow,
    readReplaySessionRow,
    renewReplaySessionLeaseInStore,
} from "./replay-sessions.ts";
import type { RetainedWorldSettlementTerminalEvidence } from "./retained-world-settlement-codec.ts";
import {
    admitRetainedWorldSettlement,
    beginRetainedWorldSettlement,
    completeRetainedWorldSettlementCleanup,
    readRetainedWorldSettlement,
    readRetainedWorldSettlementJournal,
    retainRetainedWorldSettlementTerminal,
} from "./retained-world-settlements.ts";
import {
    type ChildScopeRegistrationRequest,
    type ChildScopeRegistrationResult,
    claimScopeWriterInStore,
    claimScopeWritersInStore,
    completeScopeForkInStore,
    emitScopeRecordInStore,
    readAppendIntentRecords,
    readScopeForkBoundaryInStore,
    readScopeRegistrationRow,
    readScopeRegistrationRows,
    readScopeWriterClaimRow,
    registerChildScopeInStore,
    registerRootScopeInStore,
    releaseScopeWriterInStore,
    type ScopeForkBoundary,
    type ScopeForkCompletionRequest,
    type ScopeRegistrationRow,
    type ScopeWriterClaimRow,
    type ScopeWriterFence,
} from "./scope-registrations.ts";
import {
    completeScopeDiscardCleanupInStore,
    completeScopeMergeInStore,
    discardScopeInStore,
    prepareScopeMergeInStore,
    readScopeMergeBoundaryInStore,
    type ScopeDiscardAdmission,
    type ScopeDiscardCleanup,
    type ScopeMergeAdmission,
    type ScopeMergeBoundary,
} from "./scope-terminals.ts";
import { configureSecretScanning } from "./secret-scanning.ts";
import { readCausalClosureSlice, readOwnerPrefixSlice } from "./slices.ts";
import {
    appendSupervisedDispatchRecordInStore,
    assertUnreservedSupervisionOwners,
    injectSupervisionContextInStore,
    openSupervisedDispatchInStore,
    readSupervisedDispatchRow,
    renewSupervisedDispatchLeaseInStore,
    resolveSupervisedApprovalInStore,
    type SupervisedDispatchAppend,
    type SupervisedDispatchRow,
    type SupervisionFence,
} from "./supervised-dispatches.ts";
import {
    acknowledgeTraceSubscriptionInStore,
    openTraceSubscriptionInStore,
    readOwnerNextOrdinals,
    resolveTraceSubscriptionStart,
} from "./trace-subscriptions.ts";
import type {
    AppendReceipt,
    BlobId,
    BlobIntegrityReport,
    BlobOrphanCollectionOptions,
    BlobOrphanCollectionReport,
    BlobStorageReceipt,
    CausalClosureOptions,
    Cut,
    CutId,
    CutSpec,
    DurableExecutionClaimedAppend,
    DurableExecutionInvocationClaim,
    DurableExecutionResumeAppend,
    OwnerRecord,
    RetainedRecord,
    RetainedWorldApplicationPlanEvidence,
    RetainedWorldSettlementAdmission,
    RetainedWorldSettlementJournal,
    RetainedWorldSettlementRequest,
    Slice,
    SliceReadOptions,
    SQLiteTraceStoreOptions,
    StoreAppendRequest,
    TraceStoreMaintenanceOptions,
    TraceStoreMaintenanceReport,
} from "./types.ts";
import { normalizeStoreAppendRequest } from "./validation.ts";

/**
 * Online SQLite backup function shape of `node:sqlite` `backup`.
 *
 * @internal
 */
export type SQLiteDatabaseBackup = (
    source: DatabaseSync,
    targetPath: string,
    options: { readonly rate: number },
) => Promise<number>;

/**
 * Synchronous SQLite-backed content-addressed trace store.
 *
 * Writable construction enables configured durability, applies pending migrations, and ensures
 * the configured root witness. Read-only construction requires existing current-schema database,
 * blob-directory, and root-witness state without modifying them.
 *
 * @public
 */
export class SQLiteTraceStore implements Disposable {
    readonly #blobFilesystem: BlobFilesystem;
    readonly #cleanupBlobDirectory: () => void;
    readonly #database: DatabaseSync;
    #closed = false;
    readonly #readOnly: boolean;
    readonly #schemaVersion: number;
    readonly #secretScanning: SecretScanningMode;

    /**
     * Opens or creates a writable trace store, or opens exact current state read-only.
     *
     * A writable file database is created with the configured owner-only mode, and an existing
     * database and its WAL, SHM, and journal sidecars owned by the current user are tightened to
     * that mode before SQLite opens them. Read-only opens never change file modes.
     *
     * @param databasePath - SQLite file path, or `:memory:` for an ephemeral store.
     * @param options - Optional external blob directory, read-only policy, and secret-scanning
     * mode (default `"off"`).
     * @throws {UnsupportedStoreSchemaError} If read-only schema is absent/non-current or writable
     * schema is newer than supported.
     * @throws {TraceStoreError} If required read-only blob or root-witness state is unavailable.
     * @throws {TypeError} If options or the blob-directory shape are invalid.
     * @throws {Error} If required SQLite defensive behavior is unavailable, or SQLite/blob setup fails.
     *
     * @public
     */
    constructor(databasePath = DEFAULT_STORE_DATABASE_PATH, options: SQLiteTraceStoreOptions = {}) {
        assertSQLiteDefensiveSupport(kernelProtocolConfig.store.defensive);
        const blobDirectory = resolveBlobDirectory(databasePath, options);
        const readOnly = options.readOnly ?? false;
        this.#readOnly = readOnly;
        if (readOnly && !existsSync(blobDirectory.path)) {
            throw new TraceStoreError("read-only trace store blob directory is unavailable");
        }
        this.#cleanupBlobDirectory = blobDirectory.cleanup;
        let blobFilesystem: BlobFilesystem;
        let database: DatabaseSync;
        try {
            blobFilesystem = new BlobFilesystem(blobDirectory.path);
            if (!readOnly) {
                prepareOwnerOnlyDatabaseFile(databasePath);
            }
            database = new DatabaseSync(databasePath, {
                defensive: kernelProtocolConfig.store.defensive,
                readOnly,
                timeout: kernelProtocolConfig.store.busyTimeoutMilliseconds,
            });
        } catch (error) {
            this.#cleanupBlobDirectory();
            throw error;
        }
        this.#blobFilesystem = blobFilesystem;
        this.#database = database;
        this.#secretScanning =
            options.secretScanning ??
            (retentionProtocolConfig.scanning.defaultMode as SecretScanningMode);
        configureSecretScanning(database, this.#secretScanning);
        try {
            this.#database.exec(STORE_PRAGMA_SQL.foreignKeys);
            if (readOnly) {
                this.#schemaVersion = readCurrentTraceStoreSchemaVersion(this.#database);
                if (
                    readStoredRecord(
                        this.#database,
                        createConfiguredRootWitness().envelope.record_id,
                    ) === undefined
                ) {
                    throw new TraceStoreError("read-only trace store root witness is unavailable");
                }
            } else {
                execRetryingBusy(
                    this.#database,
                    STORE_PRAGMA_SQL.journalMode,
                    kernelProtocolConfig.store.busyTimeoutMilliseconds,
                );
                this.#database.exec(STORE_PRAGMA_SQL.synchronous);
                this.#schemaVersion = migrateTraceStore(this.#database);
                this.#ensureRootWitness();
            }
        } catch (error) {
            this.#database.close();
            this.#cleanupBlobDirectory();
            throw error;
        }
    }

    /**
     * Current migrated storage-schema version.
     *
     * @public
     */
    get schemaVersion(): number {
        return this.#schemaVersion;
    }

    /**
     * Whether this handle was opened read-only.
     *
     * @internal
     */
    get readOnly(): boolean {
        return this.#readOnly;
    }

    /**
     * Append and import secret-scanning mode chosen when this handle was opened.
     *
     * @public
     */
    get secretScanning(): SecretScanningMode {
        return this.#secretScanning;
    }

    /**
     * Atomically commits or idempotently replays one semantic append request.
     *
     * @param request - Stable append intent and semantic batch.
     * @returns The original durable receipt for this intent and content.
     * @throws {AppendIntentConflictError} If the intent already names different content.
     * @throws {TraceSecretDetectedError} If the store scans in `refuse` mode and a record body
     * matches a configured detector; nothing is written and the intent remains reusable.
     * @throws {TraceStoreError} If witnesses are missing, the store is closed, or a group targets an
     * owner path reserved for supervised dispatches, context channels, replay sessions, or child
     * run handles.
     * @throws {TypeError} If the request is malformed.
     * @throws {RangeError} If a causal parent is unknown or owner ordinals are exhausted.
     *
     * @public
     */
    append(request: StoreAppendRequest): AppendReceipt {
        this.#assertOpen();
        const batch = normalizeAppendBatchDraft(normalizeStoreAppendRequest(request).batch);
        assertUnreservedSupervisionOwners(batch);
        assertUnreservedReplayOwners(batch);
        assertUnreservedDelegationOwners(batch);
        assertUnreservedApplicationOwners(batch);
        return appendToTraceStore(this.#database, request);
    }

    /**
     * Retains or idempotently replays exact reversible-operation bookkeeping.
     *
     * This method records bookkeeping only. It performs no provider, filesystem, Git, custody,
     * settlement, or scope operation.
     *
     * @param definition - Closed versioned operation identity and safety evidence.
     * @returns The frozen canonical definition retained by the store.
     * @throws {OrphanRepairError} If the operation identity conflicts with retained evidence.
     * @throws {TypeError} If the definition is malformed, unsupported, or exceeds bounds.
     * @throws {TraceStoreError} If the store is closed.
     *
     * @public
     */
    recordOpenOperation(
        definition: OperationBookkeepingDefinition,
    ): OperationBookkeepingDefinition {
        this.#assertOpen();
        return retainOpenOperation(this.#database, definition);
    }

    /**
     * Records externally proven death for one exact operation-owning session.
     *
     * The external session authority must prove death before calling this narrow bookkeeping API.
     * The store never infers death from elapsed time or a missing provider response.
     *
     * @param evidence - Exact session identity and external death-evidence identity.
     * @returns Number of retained open operations owned by the session.
     * @throws {OrphanRepairError} If death evidence conflicts with retained evidence.
     * @throws {TypeError} If the evidence is malformed or exceeds bounds.
     * @throws {TraceStoreError} If the store is closed.
     *
     * @public
     */
    recordOperationSessionDeath(evidence: OperationSessionDeathEvidence): number {
        this.#assertOpen();
        return retainOperationSessionDeath(this.#database, evidence);
    }

    /**
     * Removes bookkeeping for one normally completed operation owned by an exact session.
     *
     * @param operationId - Exact open operation identity.
     * @param sessionId - Exact owning session identity.
     * @returns Whether matching bookkeeping was removed.
     * @throws {TypeError} If either identity is malformed or exceeds bounds.
     * @throws {TraceStoreError} If the store is closed.
     *
     * @public
     */
    completeOpenOperation(operationId: string, sessionId: string): boolean {
        this.#assertOpen();
        return completeOpenOperation(this.#database, operationId, sessionId);
    }

    /**
     * Diagnoses retained open operations without mutation.
     *
     * @param options - Optional configured page limit and canonical offset.
     * @returns A frozen page plus an exact digest over the complete open-operation basis.
     * @throws {OrphanRepairError} If retained bookkeeping is corrupt.
     * @throws {TypeError} If options or retained evidence are malformed or out of bounds.
     * @throws {TraceStoreError} If the store is closed.
     *
     * @public
     */
    diagnoseOrphanedOperations(
        options: OrphanOperationDiagnosisOptions = {},
    ): OrphanOperationDiagnosisReport {
        this.#assertOpen();
        return diagnoseOpenOperations(this.#database, options);
    }

    /**
     * Durably prepares canonical repair-command evidence without mutating bookkeeping.
     *
     * This explicit phase makes an interruption before repair diagnosable and retryable. Replaying
     * the same command is idempotent; reusing its identity for different content fails closed.
     *
     * @param command - Globally idempotent exact orphan set and diagnosis basis.
     * @returns Canonical command plus its retained trace-record identity.
     * @throws {OrphanRepairError} If command identity conflicts or its version is unsupported.
     * @throws {TypeError} If the command is malformed or exceeds bounds.
     * @throws {TraceStoreError} If the store is closed.
     *
     * @public
     */
    prepareOrphanedOperationRepair(command: OrphanRepairCommand): OrphanRepairPreparation {
        this.#assertOpen();
        return prepareOpenOperationRepair(this.#database, command);
    }

    /**
     * Explicitly repairs the complete exact set of proven-dead operation bookkeeping.
     *
     * The complete basis is rechecked under the store write lock. Live, provider-started,
     * scope-owned, stale, changed, or malformed evidence fails closed. Success removes only exact
     * bookkeeping rows and atomically retains a canonical receipt; no provider, user-file, Git,
     * custody, settlement, lifecycle, outcome, cut, or scope state is changed.
     *
     * @param command - Globally idempotent exact orphan set and diagnosis basis.
     * @returns Canonical successful or empty no-op receipt and trace-record identities.
     * @throws {OrphanRepairError} If repair is blocked, stale, conflicting, corrupt, or unsupported.
     * @throws {TypeError} If the command is malformed or exceeds bounds.
     * @throws {TraceStoreError} If the store is closed.
     *
     * @public
     */
    repairOrphanedOperations(command: OrphanRepairCommand): OrphanRepairReceipt {
        this.#assertOpen();
        return repairOpenOperations(this.#database, command);
    }

    /**
     * Attempts best-effort pre-run reclaim without ever blocking the caller's run start.
     *
     * @param commandId - Globally idempotent command identity for this reclaim attempt.
     * @returns A repaired receipt or a declined result retaining exact manual diagnosis.
     * @throws {TypeError} Only when command identity or diagnosis inputs are malformed before the
     * fail-soft repair boundary.
     * @throws {TraceStoreError} If the store is closed.
     *
     * @public
     */
    reclaimOrphanedOperationsBeforeRun(commandId: string): OrphanPreRunReclaimResult {
        this.#assertOpen();
        return reclaimOpenOperationsBeforeRun(this.#database, commandId);
    }

    /**
     * Atomically admits or identically replays one exact retained-world settlement request.
     *
     * This store-level primitive does not authenticate retained execution or carrier evidence and
     * does not mutate user files. The workspace settlement coordinator owns those boundaries.
     *
     * @param request - Closed exact settlement identity already authenticated by its coordinator.
     * @returns The durable prepared decision owned by the winning command.
     * @throws {TraceStoreError} If another command or request already owns the output.
     * @throws {TypeError} If the request is malformed or uses an unsupported protocol value.
     * @internal
     */
    admitRetainedWorldSettlement(
        request: RetainedWorldSettlementRequest,
    ): RetainedWorldSettlementAdmission {
        this.#assertOpen();
        return admitRetainedWorldSettlement(this.#database, request);
    }

    /** @internal Reads one prepared retained-world settlement decision by exact output identity. */
    readRetainedWorldSettlement(outputId: string): RetainedWorldSettlementAdmission | undefined {
        this.#assertOpen();
        return readRetainedWorldSettlement(this.#database, outputId);
    }

    /** @internal Reads one validated restart-safe settlement-journal snapshot. */
    readRetainedWorldSettlementJournal(
        outputId: string,
    ): RetainedWorldSettlementJournal | undefined {
        this.#assertOpen();
        return readRetainedWorldSettlementJournal(this.#database, outputId);
    }

    /** @internal Atomically begins or replays the deterministic admitted operation. */
    beginRetainedWorldSettlement(
        outputId: string,
        applicationPlan: RetainedWorldApplicationPlanEvidence | null = null,
        releaseBasisId: string | null = null,
    ): RetainedWorldSettlementJournal {
        this.#assertOpen();
        return beginRetainedWorldSettlement(
            this.#database,
            outputId,
            applicationPlan,
            releaseBasisId,
        );
    }

    /** @internal Atomically retains or replays the exact terminal settlement receipt. */
    retainRetainedWorldSettlementTerminal(
        outputId: string,
        evidence: RetainedWorldSettlementTerminalEvidence,
    ): RetainedWorldSettlementJournal {
        this.#assertOpen();
        return retainRetainedWorldSettlementTerminal(this.#database, outputId, evidence);
    }

    /** @internal Atomically completes or replays physical cleanup for a discarded settlement. */
    completeRetainedWorldSettlementCleanup(outputId: string): RetainedWorldSettlementJournal {
        this.#assertOpen();
        return completeRetainedWorldSettlementCleanup(this.#database, outputId);
    }

    /** @internal Atomically registers or identically replays one root scope. */
    registerRootScope(
        scopeId: string,
        executionId: string | null,
        request: StoreAppendRequest,
    ): AppendReceipt {
        this.#assertOpen();
        return registerRootScopeInStore(this.#database, scopeId, executionId, request);
    }

    /** @internal Atomically registers or identically replays one child scope under its parent fence. */
    registerChildScope(registration: ChildScopeRegistrationRequest): ChildScopeRegistrationResult {
        this.#assertOpen();
        return registerChildScopeInStore(this.#database, registration);
    }

    /** @internal Classifies a fork as completed or at its safe physical boundary. */
    readScopeForkBoundary(
        boundary: ScopeForkBoundary,
        completedAppendIntentId: string,
    ): "completed" | "ready" {
        this.#assertOpen();
        return readScopeForkBoundaryInStore(this.#database, boundary, completedAppendIntentId);
    }

    /** @internal Atomically completes or replays one prepared fork under the parent fence. */
    completeScopeFork(completion: ScopeForkCompletionRequest): AppendReceipt {
        this.#assertOpen();
        return completeScopeForkInStore(this.#database, completion);
    }

    /** @internal Atomically admits writer claims over distinct scopes in canonical order. */
    claimScopeWriters(
        claims: readonly { readonly claimId: string; readonly scopeId: string }[],
        nowMilliseconds: number,
    ): readonly ScopeWriterClaimRow[] {
        this.#assertOpen();
        return claimScopeWritersInStore(
            this.#database,
            claims,
            nowMilliseconds,
            scopeProtocolConfig.writerClaimLeaseMilliseconds,
        );
    }

    /** @internal Atomically admits, renews, or refuses one scope writer claim. */
    claimScopeWriter(
        scopeId: string,
        claimId: string,
        nowMilliseconds: number,
    ): ScopeWriterClaimRow {
        this.#assertOpen();
        return claimScopeWriterInStore(
            this.#database,
            scopeId,
            claimId,
            nowMilliseconds,
            scopeProtocolConfig.writerClaimLeaseMilliseconds,
        );
    }

    /** @internal Atomically releases or identically replays the release of one exact writer. */
    releaseScopeWriter(scopeId: string, fence: ScopeWriterFence): ScopeWriterClaimRow {
        this.#assertOpen();
        return releaseScopeWriterInStore(this.#database, scopeId, fence);
    }

    /** @internal Atomically retains or identically replays one fenced scope-local emission. */
    emitScopeRecord(
        scopeId: string,
        fence: ScopeWriterFence,
        expectedHeadRecordId: RecordId,
        citedRecordIds: readonly RecordId[],
        nowMilliseconds: number,
        request: StoreAppendRequest,
    ): AppendReceipt {
        this.#assertOpen();
        return emitScopeRecordInStore(
            this.#database,
            scopeId,
            fence,
            expectedHeadRecordId,
            citedRecordIds,
            nowMilliseconds,
            request,
        );
    }

    /** @internal Atomically reserves or replays one consume-once child merge. */
    prepareScopeMerge(admission: ScopeMergeAdmission): {
        readonly cut: Cut;
        readonly receipt: AppendReceipt;
    } {
        this.#assertOpen();
        return prepareScopeMergeInStore(this.#database, admission);
    }

    /** @internal Classifies a reserved merge as completed or at its safe publication boundary. */
    readScopeMergeBoundary(
        boundary: ScopeMergeBoundary,
        completedAppendIntentId: string,
    ): "completed" | "ready" {
        this.#assertOpen();
        return readScopeMergeBoundaryInStore(this.#database, boundary, completedAppendIntentId);
    }

    /** @internal Atomically completes or replays one reserved merge and seals the child. */
    completeScopeMerge(
        completion: ScopeMergeBoundary & { readonly request: StoreAppendRequest },
    ): AppendReceipt {
        this.#assertOpen();
        return completeScopeMergeInStore(this.#database, completion);
    }

    /** @internal Atomically decides or replays one logical subtree discard. */
    discardScope(admission: ScopeDiscardAdmission): "decided" | "replayed" {
        this.#assertOpen();
        return discardScopeInStore(this.#database, admission);
    }

    /** @internal Atomically retains or replays cleanup progress of one logical discard. */
    completeScopeDiscardCleanup(cleanup: ScopeDiscardCleanup): AppendReceipt {
        this.#assertOpen();
        return completeScopeDiscardCleanupInStore(this.#database, cleanup);
    }

    /** @internal Reads the owner occurrences retained by one append intent in append order. */
    readAppendIntentRecords(appendIntentId: string): readonly OwnerRecord[] {
        this.#assertOpen();
        return readAppendIntentRecords(this.#database, appendIntentId);
    }

    /** @internal Lists every live scope registration row in canonical scope-identity order. */
    listScopeRegistrations(): readonly ScopeRegistrationRow[] {
        this.#assertOpen();
        return readScopeRegistrationRows(this.#database);
    }

    /** @internal Reads the current writer claim row of one scope. */
    readScopeWriterClaim(scopeId: string): ScopeWriterClaimRow | undefined {
        this.#assertOpen();
        return readScopeWriterClaimRow(this.#database, scopeId);
    }

    /** @internal Reads one live scope registration row admitting mutation in this store. */
    readScopeRegistration(scopeId: string): ScopeRegistrationRow | undefined {
        this.#assertOpen();
        return readScopeRegistrationRow(this.#database, scopeId);
    }

    /**
     * Atomically acquires or observes the provider-invocation lease for a durable run.
     *
     * @param runId - Durable run whose provider boundary is guarded.
     * @param createdRecordId - Exact creation evidence associated with the run.
     * @param claimId - Unique identity proposed by this caller.
     * @param nowMilliseconds - Unix time used for deterministic lease evaluation.
     * @param allowExpiredTakeover - Whether this caller has authority to replace an expired claim.
     * @returns The current frozen claim, including its monotonic fencing token and expiry.
     * @throws {TypeError} If identifiers, creation evidence, or time are malformed or conflict.
     * @throws {TraceStoreError} If the store is closed.
     */
    claimDurableExecutionInvocation(
        runId: string,
        createdRecordId: RecordId,
        claimId: string,
        nowMilliseconds = Date.now(),
        allowExpiredTakeover = true,
    ): DurableExecutionInvocationClaim {
        this.#assertOpen();
        return claimDurableExecutionInvocation(
            this.#database,
            runId,
            createdRecordId,
            claimId,
            nowMilliseconds,
            runProtocolConfig.execution.invocationClaimLeaseMilliseconds,
            allowExpiredTakeover,
        );
    }

    /** @internal Reads whether one exact started invocation fence remains current. */
    hasDurableExecutionInvocationAuthority(
        runId: string,
        claimId: string,
        fencingToken: number,
    ): boolean {
        this.#assertOpen();
        return hasDurableExecutionInvocationAuthority(this.#database, runId, claimId, fencingToken);
    }

    /**
     * Atomically publishes canonical start evidence while a claim remains authoritative.
     *
     * @param runId - Durable run whose start boundary is guarded.
     * @param claimId - Exact acquired claim identity.
     * @param fencingToken - Exact monotonic token returned with the claim.
     * @param nowMilliseconds - Unix time used for deterministic lease evaluation.
     * @param recoveryCommandRecordId - Optional canonical recovery command authorizing the start.
     * @returns A committed receipt or a frozen fenced result.
     * @throws {TypeError} If identifiers, token, or time are malformed.
     * @throws {TraceStoreError} If the store is closed or the append fails.
     */
    appendDurableExecutionStart(
        runId: string,
        claimId: string,
        fencingToken: number,
        nowMilliseconds = Date.now(),
        recoveryCommandRecordId: RecordId | null = null,
    ): DurableExecutionClaimedAppend {
        this.#assertOpen();
        return appendDurableExecutionStart(
            this.#database,
            runId,
            claimId,
            fencingToken,
            nowMilliseconds,
            recoveryCommandRecordId,
        );
    }

    /**
     * Atomically publishes terminal evidence while the exact started claim remains current.
     *
     * @param runId - Durable run whose terminal evidence is being published.
     * @param claimId - Exact current invocation claim identity.
     * @param fencingToken - Exact current monotonic fencing token.
     * @param request - Canonical terminal-ledger append request.
     * @param releaseClaim - Whether terminal commit must also release the current worker.
     * @returns A committed receipt or a frozen fenced result.
     * @throws {TraceStoreError} If the store is closed or append fails.
     * @throws {TypeError} If identifiers, token, or request are malformed.
     * @internal
     */
    appendDurableExecutionTerminal(
        runId: string,
        claimId: string,
        fencingToken: number,
        request: StoreAppendRequest,
        releaseClaim = false,
    ): DurableExecutionClaimedAppend {
        this.#assertOpen();
        return appendDurableExecutionTerminal(
            this.#database,
            runId,
            claimId,
            fencingToken,
            request,
            releaseClaim,
        );
    }

    /**
     * Atomically retains a running control command while the exact fence remains current.
     *
     * @param runId - Durable run whose running lifecycle is targeted.
     * @param expectedLifecycleRecordId - Exact retained start record expected by the caller.
     * @param fencingToken - Exact current invocation fencing token.
     * @param request - Canonical running-control-command append request.
     * @returns The committed or identically replayed append receipt.
     * @throws {TraceStoreError} If the store is closed or running authority is no longer current.
     * @throws {AppendIntentConflictError} If command identity already names different content.
     * @throws {TypeError} If an identifier, token, or request is malformed.
     *
     * @internal
     */
    appendDurableExecutionRunningControlCommand(
        runId: string,
        expectedLifecycleRecordId: RecordId,
        fencingToken: number,
        request: StoreAppendRequest,
    ): AppendReceipt {
        this.#assertOpen();
        return appendDurableExecutionRunningControlCommand(
            this.#database,
            runId,
            expectedLifecycleRecordId,
            fencingToken,
            request,
        );
    }

    /**
     * Atomically appends command-bound cancellation for an inactive lifecycle head.
     *
     * @param runId - Durable run being cancelled.
     * @param expectedLifecycleRecordId - Exact created, waiting, or suspended head.
     * @param request - Canonical command, outcome, and terminal append request.
     * @returns The committed or identically replayed append receipt.
     * @throws {TraceStoreError} If the store is closed or authority is inconsistent.
     * @internal
     */
    appendDurableExecutionInactiveCancellation(
        runId: string,
        expectedLifecycleRecordId: RecordId,
        request: StoreAppendRequest,
    ): AppendReceipt {
        this.#assertOpen();
        return appendDurableExecutionInactiveCancellation(
            this.#database,
            runId,
            expectedLifecycleRecordId,
            request,
        );
    }

    /**
     * Atomically appends suspension evidence and releases the exact running fence.
     *
     * @param runId - Durable run reaching a safe boundary.
     * @param expectedLifecycleRecordId - Exact current started lifecycle record.
     * @param fencingToken - Exact current invocation fencing token.
     * @param pauseCommandRecordId - Retained pause command authorizing suspension.
     * @param traceCutId - Immutable cut through the expected lifecycle record.
     * @param request - Canonical descriptor and suspension append request.
     * @returns The committed or identically replayed append receipt.
     * @throws {TraceStoreError} If the store is closed or authority is inconsistent.
     * @throws {AppendIntentConflictError} If the intent already names different content.
     * @internal
     */
    appendDurableExecutionSuspension(
        runId: string,
        expectedLifecycleRecordId: RecordId,
        fencingToken: number,
        pauseCommandRecordId: RecordId,
        traceCutId: string,
        request: StoreAppendRequest,
    ): AppendReceipt {
        this.#assertOpen();
        return appendDurableExecutionSuspension(
            this.#database,
            runId,
            expectedLifecycleRecordId,
            fencingToken,
            pauseCommandRecordId,
            traceCutId,
            request,
        );
    }

    /**
     * Atomically appends waiting evidence and releases the exact running fence.
     *
     * @param runId - Durable run reaching a prerequisite boundary.
     * @param expectedLifecycleRecordId - Exact current running lifecycle record.
     * @param fencingToken - Exact current invocation fencing token.
     * @param traceCutId - Immutable cut through the expected lifecycle record.
     * @param request - Canonical descriptor and waiting append request.
     * @returns The committed or identically replayed append receipt.
     * @throws {TraceStoreError} If the store is closed or authority is inconsistent.
     * @throws {AppendIntentConflictError} If the intent already names different content.
     * @internal
     */
    appendDurableExecutionWaiting(
        runId: string,
        expectedLifecycleRecordId: RecordId,
        fencingToken: number,
        traceCutId: string,
        request: StoreAppendRequest,
    ): AppendReceipt {
        this.#assertOpen();
        return appendDurableExecutionWaiting(
            this.#database,
            runId,
            expectedLifecycleRecordId,
            fencingToken,
            traceCutId,
            request,
        );
    }

    /**
     * Atomically acquires resumed worker authority and publishes running continuation evidence.
     *
     * @param runId - Durable run being resumed.
     * @param commandId - Globally idempotent resume command identity.
     * @param expectedLifecycleRecordId - Exact waiting or suspension acknowledgement expected.
     * @param continuationDescriptorRecordId - Exact descriptor cited by the acknowledgement.
     * @param claimId - Deterministic new worker claim identity.
     * @param nowMilliseconds - Unix time used for lease creation.
     * @param prerequisiteSatisfaction - Required matching evidence for waiting, otherwise null.
     * @returns Canonical command/running identities and new worker authority.
     * @throws {TraceStoreError} If the store is closed or retained authority is inconsistent.
     * @internal
     */
    appendDurableExecutionResume(
        runId: string,
        commandId: string,
        expectedLifecycleRecordId: RecordId,
        continuationDescriptorRecordId: RecordId,
        claimId: string,
        nowMilliseconds = Date.now(),
        prerequisiteSatisfaction: DurableExecutionPrerequisiteSatisfaction | null = null,
    ): DurableExecutionResumeAppend {
        this.#assertOpen();
        return appendDurableExecutionResume(
            this.#database,
            runId,
            commandId,
            expectedLifecycleRecordId,
            continuationDescriptorRecordId,
            claimId,
            nowMilliseconds,
            runProtocolConfig.execution.invocationClaimLeaseMilliseconds,
            prerequisiteSatisfaction,
        );
    }

    /**
     * Creates or resumes one durable subscription cursor row.
     *
     * @param subscriptionId - Durable subscription identity.
     * @param owners - Canonical distinct owner paths.
     * @param start - Optional start for a new row; an explicit cursor must equal an existing row.
     * @returns The acknowledged cursor.
     * @throws {SupervisionCursorConflictError} If owners or the start cursor disagree.
     * @throws {TraceStoreError} If the store is closed or bookkeeping is corrupt.
     * @internal
     */
    openTraceSubscription(
        subscriptionId: string,
        owners: readonly string[],
        start: TraceSubscriptionCursor | TraceSubscriptionStartPosition | undefined,
    ): TraceSubscriptionCursor {
        this.#assertOpen();
        return openTraceSubscriptionInStore(this.#database, subscriptionId, owners, start);
    }

    /**
     * Resolves an ephemeral subscription start cursor without mutation.
     *
     * @param owners - Canonical distinct owner paths.
     * @param start - Start position or explicit cursor.
     * @returns The validated start cursor.
     * @throws {SupervisionCursorConflictError} If the cursor names other owners or unretained records.
     * @throws {TraceStoreError} If the store is closed.
     * @internal
     */
    resolveTraceSubscriptionStart(
        owners: readonly string[],
        start: TraceSubscriptionCursor | TraceSubscriptionStartPosition,
    ): TraceSubscriptionCursor {
        this.#assertOpen();
        return resolveTraceSubscriptionStart(this.#database, owners, start, null);
    }

    /**
     * Advances one durable acknowledged cursor monotonically.
     *
     * @param subscriptionId - Durable subscription identity.
     * @param cursor - Validated cursor to acknowledge.
     * @returns The acknowledged cursor.
     * @throws {SupervisionCursorConflictError} If the cursor regresses or passes retained records.
     * @throws {TraceStoreError} If the store is closed or the row is absent or corrupt.
     * @internal
     */
    acknowledgeTraceSubscription(
        subscriptionId: string,
        cursor: TraceSubscriptionCursor,
    ): TraceSubscriptionCursor {
        this.#assertOpen();
        return acknowledgeTraceSubscriptionInStore(this.#database, subscriptionId, cursor);
    }

    /**
     * Reads the next unallocated ordinal of each owner path.
     *
     * @param owners - Exact owner paths.
     * @returns Next ordinals keyed by owner.
     * @throws {TraceStoreError} If the store is closed.
     * @internal
     */
    readOwnerNextOrdinals(owners: readonly string[]): ReadonlyMap<string, number> {
        this.#assertOpen();
        return readOwnerNextOrdinals(this.#database, owners);
    }

    /**
     * Reads one retained owner occurrence.
     *
     * @param ownerId - Exact owner path.
     * @param ordinal - Retained owner ordinal.
     * @returns The frozen occurrence.
     * @throws {TraceStoreError} If the store is closed or the occurrence is absent.
     * @internal
     */
    readOwnerOccurrence(ownerId: string, ordinal: number): OwnerRecord {
        this.#assertOpen();
        return readOwnerRecordAtOrdinal(this.#database, ownerId, ordinal);
    }

    /**
     * Retains or replays one dispatch record and admits a decision lease.
     *
     * @param dispatchId - Dispatch identity and owner path.
     * @param claimId - Proposed lease holder.
     * @param nowMilliseconds - Lease clock.
     * @param citedRecordIds - Records that must be retained before a new dispatch is appended.
     * @param request - Dispatch record append.
     * @returns The dispatch row after admission.
     * @throws {SupervisionLeaseConflictError} If another unexpired holder owns the lease.
     * @throws {SupervisionEvidenceError} If the dispatch is imported or the owner path is not fresh.
     * @throws {AppendIntentConflictError} If the command names different dispatch content.
     * @throws {TraceStoreError} If the store is closed.
     * @internal
     */
    openSupervisedDispatch(
        dispatchId: string,
        claimId: string,
        nowMilliseconds: number,
        citedRecordIds: readonly RecordId[],
        request: StoreAppendRequest,
    ): SupervisedDispatchRow {
        this.#assertOpen();
        return openSupervisedDispatchInStore(
            this.#database,
            dispatchId,
            claimId,
            nowMilliseconds,
            citedRecordIds,
            request,
        );
    }

    /**
     * Renews the current dispatch decision lease.
     *
     * @param dispatchId - Dispatch identity.
     * @param fence - Current lease authority.
     * @param nowMilliseconds - Lease clock.
     * @returns The renewed row.
     * @throws {SupervisionLeaseFencedError} If the fence is not current.
     * @throws {TraceStoreError} If the store is closed.
     * @internal
     */
    renewSupervisedDispatchLease(
        dispatchId: string,
        fence: SupervisionFence,
        nowMilliseconds: number,
    ): SupervisedDispatchRow {
        this.#assertOpen();
        return renewSupervisedDispatchLeaseInStore(
            this.#database,
            dispatchId,
            fence,
            nowMilliseconds,
        );
    }

    /**
     * Appends one fenced dispatcher record at the exact head.
     *
     * @param dispatchId - Dispatch identity.
     * @param fence - Current lease authority.
     * @param expectedHeadRecordId - Exact current head.
     * @param nowMilliseconds - Lease clock.
     * @param request - Record append.
     * @param resolves - Whether the append resolves the dispatch.
     * @returns The receipt, or a moved-head signal.
     * @throws {SupervisionLeaseFencedError} If the fence is not current.
     * @throws {TraceStoreError} If the store is closed.
     * @internal
     */
    appendSupervisedDispatchRecord(
        dispatchId: string,
        fence: SupervisionFence,
        expectedHeadRecordId: RecordId,
        nowMilliseconds: number,
        request: StoreAppendRequest,
        resolves: boolean,
    ): SupervisedDispatchAppend {
        this.#assertOpen();
        return appendSupervisedDispatchRecordInStore(
            this.#database,
            dispatchId,
            fence,
            expectedHeadRecordId,
            nowMilliseconds,
            request,
            resolves,
        );
    }

    /**
     * Appends one approver verdict for the exact pending request.
     *
     * @param dispatchId - Dispatch identity.
     * @param requestRecordId - Exact pending request.
     * @param request - Verdict append.
     * @returns The durable receipt.
     * @throws {SupervisionApprovalConflictError} If the request is not pending at the head.
     * @throws {SupervisionEvidenceError} If the dispatch is not registered in this store.
     * @throws {TraceStoreError} If the store is closed.
     * @internal
     */
    resolveSupervisedApproval(
        dispatchId: string,
        requestRecordId: RecordId,
        request: StoreAppendRequest,
    ): AppendReceipt {
        this.#assertOpen();
        return resolveSupervisedApprovalInStore(
            this.#database,
            dispatchId,
            requestRecordId,
            request,
        );
    }

    /**
     * Appends one context injection whose citations are retained.
     *
     * @param citedRecordIds - Records cited as causal parents.
     * @param request - Injection append.
     * @returns The durable receipt.
     * @throws {SupervisionEvidenceError} If a citation is not retained.
     * @throws {TraceStoreError} If the store is closed.
     * @internal
     */
    injectSupervisionContext(
        citedRecordIds: readonly RecordId[],
        request: StoreAppendRequest,
    ): AppendReceipt {
        this.#assertOpen();
        return injectSupervisionContextInStore(this.#database, citedRecordIds, request);
    }

    /**
     * Retains or replays one replay session record and admits the first writer lease.
     *
     * @param sessionId - Session identity and owner path.
     * @param claimId - Proposed lease holder.
     * @param nowMilliseconds - Lease clock.
     * @param request - Session record append.
     * @returns Whether the session was created, and its row (absent for imported sessions).
     * @throws {ReplayLeaseConflictError} If another unexpired holder owns the lease.
     * @throws {ReplayEvidenceError} If the owner path is not fresh.
     * @throws {AppendIntentConflictError} If the command names different session content.
     * @throws {TraceStoreError} If the store is closed.
     * @internal
     */
    openReplaySession(
        sessionId: string,
        claimId: string,
        nowMilliseconds: number,
        request: StoreAppendRequest,
    ): { readonly created: boolean; readonly row: ReplaySessionRow | undefined } {
        this.#assertOpen();
        return openReplaySessionInStore(
            this.#database,
            sessionId,
            claimId,
            nowMilliseconds,
            request,
        );
    }

    /**
     * Renews the current replay session writer lease.
     *
     * @param sessionId - Session identity.
     * @param fence - Current lease authority.
     * @param nowMilliseconds - Lease clock.
     * @returns The renewed row.
     * @throws {ReplayLeaseFencedError} If the fence is not current.
     * @throws {TraceStoreError} If the store is closed.
     * @internal
     */
    renewReplaySessionLease(
        sessionId: string,
        fence: ReplaySessionFence,
        nowMilliseconds: number,
    ): ReplaySessionRow {
        this.#assertOpen();
        return renewReplaySessionLeaseInStore(this.#database, sessionId, fence, nowMilliseconds);
    }

    /**
     * Appends one fenced replay session record at the exact head.
     *
     * @param sessionId - Session identity.
     * @param fence - Current lease authority.
     * @param nowMilliseconds - Lease clock.
     * @param append - Optional cut, record builder, expected head, and terminal flag.
     * @returns The receipt and published cut, or a moved-head signal.
     * @throws {ReplayLeaseFencedError} If the fence is not current.
     * @throws {TraceStoreError} If the store is closed or the cut conflicts.
     * @internal
     */
    appendReplaySessionRecord(
        sessionId: string,
        fence: ReplaySessionFence,
        nowMilliseconds: number,
        append: ReplaySessionAppendRequest,
    ): ReplaySessionAppend {
        this.#assertOpen();
        return appendReplaySessionRecordInStore(
            this.#database,
            sessionId,
            fence,
            nowMilliseconds,
            append,
        );
    }

    /**
     * Reads one live replay session row.
     *
     * @param sessionId - Session identity.
     * @returns The row, or undefined for absent or imported sessions.
     * @throws {TraceStoreError} If the store is closed.
     * @internal
     */
    readReplaySession(sessionId: string): ReplaySessionRow | undefined {
        this.#assertOpen();
        return readReplaySessionRow(this.#database, sessionId);
    }

    /**
     * Atomically retains a new child run handle's opened record and origin cut.
     *
     * @param handleId - Handle identity and reserved owner path.
     * @param open - Command intent, parent handle, and record builder.
     * @returns Whether the handle was created, with its receipt and origin cut.
     * @throws {DelegationEvidenceError} If the owner path is not fresh or the parent is absent.
     * @throws {TraceStoreError} If the store is closed.
     * @internal
     */
    openDelegationHandle(
        handleId: string,
        open: DelegationHandleOpenRequest,
    ): DelegationHandleOpen {
        this.#assertOpen();
        return openDelegationHandleInStore(this.#database, handleId, open);
    }

    /**
     * Appends one child run handle command record at the exact handle head.
     *
     * @param handleId - Handle identity.
     * @param expectedHeadRecordId - Exact current handle head.
     * @param request - Command record append.
     * @returns The receipt, a replayed receipt, or a moved-head signal.
     * @throws {AppendIntentConflictError} If the command names different content.
     * @throws {TraceStoreError} If the store is closed.
     * @internal
     */
    appendDelegationHandleRecord(
        handleId: string,
        expectedHeadRecordId: RecordId,
        request: StoreAppendRequest,
    ): DelegationHandleAppend {
        this.#assertOpen();
        return appendDelegationHandleRecordInStore(
            this.#database,
            handleId,
            expectedHeadRecordId,
            request,
        );
    }

    /**
     * Appends one application record at the exact application owner head, publishing the
     * optional terminal cut through it in the same transaction.
     *
     * @param applicationId - Application identity and reserved owner path.
     * @param expectedHeadRecordId - Exact current head, or null for an empty owner path.
     * @param request - Application record append.
     * @param cutId - Terminal cut to publish through the appended record, or null.
     * @returns The receipt with its cut, a replayed receipt, or a moved-head signal.
     * @throws {AppendIntentConflictError} If the command names different content.
     * @throws {TraceStoreError} If the store is closed.
     * @internal
     */
    appendApplicationRecord(
        applicationId: string,
        expectedHeadRecordId: RecordId | null,
        request: StoreAppendRequest,
        cutId: CutId | null,
    ): ApplicationRecordAppend {
        this.#assertOpen();
        return appendApplicationRecordInStore(
            this.#database,
            applicationId,
            expectedHeadRecordId,
            request,
            cutId,
        );
    }

    /**
     * Reads one live supervised dispatch row.
     *
     * @param dispatchId - Dispatch identity.
     * @returns The row, or undefined for absent or imported dispatches.
     * @throws {TraceStoreError} If the store is closed.
     * @internal
     */
    readSupervisedDispatch(dispatchId: string): SupervisedDispatchRow | undefined {
        this.#assertOpen();
        return readSupervisedDispatchRow(this.#database, dispatchId);
    }

    /**
     * Diagnoses whether an append intent is committed, retryable, or corrupt.
     *
     * The diagnosis is read-only. A missing intent is safe to retry, a consistent retained
     * receipt is committed, and inconsistent retained evidence requires manual recovery.
     *
     * @param appendIntentId - Stable append intent to inspect.
     * @returns A frozen recovery diagnosis.
     * @throws {TraceStoreError} If the store is closed.
     * @throws {TypeError} If the append intent is empty.
     *
     * @example
     * ```ts
     * const diagnosis = store.diagnoseAppend("append:task:1");
     * if (diagnosis.status === "manual_recovery_required") {
     *     console.error(diagnosis.issue);
     * }
     * ```
     *
     * @public
     */
    diagnoseAppend(appendIntentId: string): AppendRecoveryDiagnostic {
        this.#assertOpen();
        return diagnoseStoredAppend(this.#database, appendIntentId);
    }

    /**
     * Verifies every retained store area and returns classified diagnostics.
     *
     * The scan is read-only and includes SQLite integrity, canonical records, append receipts,
     * published cuts, owner paths, and registered external blobs.
     *
     * @returns A frozen whole-store integrity report.
     * @throws {TraceStoreError} If the store is closed.
     * @throws {Error} If SQLite cannot perform the diagnostic scan.
     *
     * @example
     * ```ts
     * const report = store.verifyIntegrity();
     * if (!report.ok) {
     *     console.error(report.issues);
     * }
     * ```
     *
     * @public
     */
    verifyIntegrity(): TraceIntegrityReport {
        this.#assertOpen();
        return verifyTraceStoreIntegrity(this.#database, this.#blobFilesystem);
    }

    /**
     * Exports every verified retained record, view, intent, cut, and blob.
     *
     * @returns Deterministic JSON using the configured native trace-archive format.
     * @throws {TraceStoreError} If the store is closed or fails integrity verification.
     * @throws {Error} If SQLite or blob storage cannot complete the read-only export.
     *
     * @example
     * ```ts
     * const archiveJson = store.exportTrace();
     * const parsedArchive = JSON.parse(archiveJson);
     * ```
     *
     * @public
     */
    exportTrace(): string {
        this.#assertOpen();
        return exportTraceArchive(this.#database, this.#blobFilesystem);
    }

    /**
     * Copies this handle's database online into `targetPath` through a SQLite backup function.
     *
     * The copy is one consistent snapshot: SQLite restarts the copy when another connection
     * commits during it, and changes made through this handle are included. Blob bytes are not
     * copied; `backupTraceStore` owns the complete backup protocol.
     *
     * @param targetPath - New database file that receives the copy.
     * @param copy - The runtime's `node:sqlite` `backup` function, checked by the caller.
     * @param pagesPerStep - Pages copied per backup step.
     * @returns The number of copied pages.
     * @throws {TraceStoreError} If the store is closed.
     * @internal
     */
    backupDatabase(
        targetPath: string,
        copy: SQLiteDatabaseBackup,
        pagesPerStep: number,
    ): Promise<number> {
        this.#assertOpen();
        return copy(this.#database, targetPath, { rate: pagesPerStep });
    }

    /**
     * Visits every retained semantic record in record-identity order from one statement snapshot.
     *
     * @param visitor - Receives each validated record body and envelope.
     * @returns Number of visited records.
     * @throws {TraceStoreError} If the store is closed.
     * @internal
     */
    visitRetainedRecords(
        visitor: (record: { readonly body: RecordBody; readonly envelope: RecordEnvelope }) => void,
    ): number {
        this.#assertOpen();
        return visitStoredRecords(this.#database, visitor);
    }

    /**
     * Imports a complete native trace archive into a pristine store.
     *
     * The archive is fully staged and verified before one SQLite transaction publishes its
     * retained state. Semantic record identities and owner ordinals are preserved exactly.
     *
     * @param archiveJson - Versioned native archive JSON returned by `exportTrace()`.
     * @returns Frozen counts for every imported retained-state area.
     * @throws {TraceStoreError} If the store is closed or is not pristine.
     * @throws {TraceSecretDetectedError} If the store scans in `refuse` mode and an archived record
     * body matches a configured detector; nothing is written.
     * @throws {RedactedTraceArchiveError} If the text is a one-way redacted archive.
     * @throws {TraceArchiveLimitError} If the archive exceeds a configured interchange limit
     * (`kernel.interchange.limits`): byte length or nesting depth before parsing, collection counts
     * or the declared blob byte total before decoding; nothing is written.
     * @throws {TypeError} If the archive is malformed, incompatible, or internally inconsistent.
     * @throws {Error} If SQLite or blob storage cannot publish the validated archive.
     *
     * @example
     * ```ts
     * const receipt = targetStore.importTrace(sourceStore.exportTrace());
     * console.log(receipt.imported_record_count);
     * ```
     *
     * @public
     */
    importTrace(archiveJson: string): TraceImportReceipt {
        this.#assertOpen();
        return importTraceArchive(this.#database, this.#blobFilesystem, archiveJson);
    }

    /**
     * Durably retains binary content and its storage receipt.
     *
     * Equal bytes are deduplicated by their configured content digest. Blob bytes become visible
     * only after a matching SQLite receipt commits.
     *
     * @param content - Binary content to retain.
     * @returns A frozen content identity and byte-length receipt.
     * @throws {BlobIntegrityError} If existing bytes or metadata disagree with the digest.
     * @throws {TraceStoreError} If the store is closed.
     * @throws {TypeError} If content is not a `Uint8Array`.
     *
     * @public
     */
    putBlob(content: Uint8Array): BlobStorageReceipt {
        this.#assertOpen();
        return putStoredBlob(this.#database, this.#blobFilesystem, content);
    }

    /**
     * Reads binary content after verifying its durable receipt and digest.
     *
     * @param blobId - Configured content-addressed blob identifier.
     * @returns A fresh byte array, or `undefined` when no durable receipt exists.
     * @throws {BlobIntegrityError} If retained bytes or metadata are missing or corrupt.
     * @throws {TraceStoreError} If the store is closed.
     * @throws {TypeError} If the blob identifier is malformed.
     *
     * @public
     */
    readBlob(blobId: BlobId): Uint8Array | undefined {
        this.#assertOpen();
        return readStoredBlob(this.#database, this.#blobFilesystem, blobId);
    }

    /**
     * Verifies every registered blob receipt and filesystem object.
     *
     * @returns A frozen report ordered by blob identifier.
     * @throws {TraceStoreError} If the store is closed.
     *
     * @public
     */
    verifyBlobs(): BlobIntegrityReport {
        this.#assertOpen();
        return verifyStoredBlobs(this.#database, this.#blobFilesystem);
    }

    /**
     * Inspects or deletes filesystem objects that have no durable blob registration.
     *
     * Collection holds the configured store write lock, first verifies every registered blob,
     * and never removes registered content. Inspection is the configured default.
     *
     * @param options - Optional configured collection mode.
     * @returns A frozen report of discovered and deleted objects.
     * @throws {BlobIntegrityError} If registered content is corrupt or storage is unsafe.
     * @throws {TraceStoreError} If the store is closed.
     * @throws {TypeError} If options are malformed or select an unsupported mode.
     * @throws {Error} If SQLite or the filesystem cannot complete collection.
     *
     * @example
     * ```ts
     * const inspection = store.collectBlobOrphans();
     * if (inspection.orphan_blob_ids.length > 0) {
     *     store.collectBlobOrphans({ mode: "delete" });
     * }
     * ```
     *
     * @public
     */
    collectBlobOrphans(options: BlobOrphanCollectionOptions = {}): BlobOrphanCollectionReport {
        this.#assertOpen();
        return collectStoredBlobOrphans(this.#database, this.#blobFilesystem, options);
    }

    /**
     * Runs one semantics-preserving maintenance pass: `inspect`, `checkpoint`, `optimize`, or
     * `vacuum`.
     *
     * Every mode runs a bounded SQLite `quick_check` and reports page, freelist, and WAL sizes.
     * `checkpoint` truncates the write-ahead log; `optimize` runs `PRAGMA optimize`; `vacuum`
     * rebuilds the database file and then checkpoints. Mutating modes refuse a database whose
     * `quick_check` fails. No mode changes retained records, views, cuts, append intents, or
     * blobs: `exportTrace()` is byte-identical before and after.
     *
     * @param options - Optional configured maintenance mode (default `"inspect"`).
     * @returns A frozen maintenance report.
     * @throws {TraceStoreReadOnlyError} If the handle was opened with `readOnly: true`.
     * @throws {TraceStoreError} If the store is closed, or a mutating mode finds a defect.
     * @throws {TypeError} If options are malformed or select an unconfigured mode.
     * @throws {Error} If SQLite cannot complete the operation, for example a vacuum while another
     * connection holds a transaction.
     *
     * @example
     * ```ts
     * const report = store.maintain({ mode: "vacuum" });
     * console.log(report.before.freelist_count, report.after.freelist_count);
     * ```
     *
     * @public
     */
    maintain(options: TraceStoreMaintenanceOptions = {}): TraceStoreMaintenanceReport {
        this.#assertOpen();
        if (this.#readOnly) {
            throw new TraceStoreReadOnlyError(
                "trace store maintenance requires a writable store handle",
            );
        }
        return maintainTraceStore(this.#database, this.#schemaVersion, options);
    }

    /**
     * Reads one semantic record and every owner-local occurrence.
     *
     * @param recordId - Content-addressed record identifier.
     * @returns The retained record, or `undefined` when it is absent.
     * @throws {TraceStoreError} If the store is closed.
     * @throws {TypeError} If the record identifier is malformed.
     *
     * @public
     */
    readRecord(recordId: RecordId): RetainedRecord | undefined {
        this.#assertOpen();
        assertRecordId(recordId, "recordId");
        return readStoredRecord(this.#database, recordId);
    }

    /**
     * Reads one owner path in ascending ordinal order.
     *
     * @param ownerId - Stable trace-owner identifier.
     * @returns Frozen owner-local record occurrences.
     * @throws {TraceStoreError} If the store is closed.
     * @throws {TypeError} If the owner identifier is empty or malformed.
     *
     * @public
     */
    readOwner(ownerId: string): readonly OwnerRecord[] {
        this.#assertOpen();
        assertNonEmptyString(ownerId, "ownerId");
        return readOwnerRecords(this.#database, ownerId);
    }

    /**
     * Lists a trusted bounded owner slice containing an exact record schema.
     *
     * @param schemaRef - Exact retained record schema identifier.
     * @param limit - Positive trusted maximum owner count.
     * @param offset - Non-negative trusted canonical owner offset.
     * @param descending - Whether canonical creation-record/owner ordering is reversed.
     * @param ownerPrefix - Optional validated exact owner-ID prefix.
     * @returns Frozen matching owner identities.
     * @throws {TraceStoreError} If the store is closed.
     * @throws {TypeError} If the schema identifier is malformed.
     * @internal
     */
    listOwnersBySchema(
        schemaRef: string,
        limit: number,
        offset: number,
        descending = false,
        ownerPrefix?: string,
    ): readonly string[] {
        this.#assertOpen();
        assertNonEmptyString(schemaRef, "schemaRef");
        return listOwnerIdsBySchema(
            this.#database,
            schemaRef,
            limit,
            offset,
            descending,
            ownerPrefix,
        );
    }

    /**
     * Lists trusted bounded owners whose exact-schema body has one exact JSON text field.
     *
     * @param schemaRef - Exact retained record schema identifier.
     * @param jsonPath - Trusted SQLite JSON path for one configured text field.
     * @param textValue - Exact text value required at the path.
     * @param limit - Positive trusted maximum owner count.
     * @returns Frozen matching owner identities in canonical record/owner order.
     * @throws {TraceStoreError} If the store is closed.
     * @internal
     */
    listOwnersBySchemaBodyText(
        schemaRef: string,
        jsonPath: string,
        textValue: string,
        limit: number,
    ): readonly string[] {
        this.#assertOpen();
        return listOwnerIdsBySchemaBodyText(this.#database, schemaRef, jsonPath, textValue, limit);
    }

    /**
     * Publishes an immutable address through one retained owner-path occurrence.
     *
     * Publication appends a semantic cut record and its resolver index atomically.
     *
     * @param spec - Closed cut publication request.
     * @returns The durable cut address.
     * @throws {TraceStoreError} If the target occurrence is absent, the publishing owner path is
     * reserved for replay sessions or child run handles, or the store is closed.
     * @throws {TypeError} If the request is malformed.
     *
     * @public
     */
    publishCut(spec: CutSpec): Cut {
        this.#assertOpen();
        const owners = spec as Partial<CutSpec> | null;
        const publisher = owners?.publisher_owner_id ?? owners?.target_owner_id;
        if (typeof publisher === "string") {
            assertUnreservedReplayOwner(publisher);
            assertUnreservedDelegationOwner(publisher);
            assertUnreservedApplicationOwner(publisher);
        }
        return publishStoredCut(this.#database, spec);
    }

    /**
     * Reads and verifies one published cut.
     *
     * @param cutId - Stable published cut identifier.
     * @returns The verified durable cut.
     * @throws {TraceStoreError} If the cut is absent, corrupt, or the store is closed.
     * @throws {TypeError} If the identifier is malformed.
     *
     * @public
     */
    readCut(cutId: CutId): Cut {
        this.#assertOpen();
        return readStoredCut(this.#database, cutId);
    }

    /**
     * Lazily yields payload-visible owner occurrences through one published cut, in ordinal order.
     *
     * Cut authentication and input validation occur on the first pull. Each subsequent pull reads
     * one occurrence synchronously, without a live cursor or transaction across yields. Later
     * appends are excluded. Integrity is incremental, not a cross-pull database snapshot: an error
     * cannot retract earlier yields. No graph closure, filtering, or redaction is performed.
     * Early termination releases iteration state but never closes the caller-owned store.
     *
     * @param cutId - Exact published cut identifier.
     * @returns A single-use async iterator of frozen owner occurrences, including repeated IDs.
     * @throws {TraceStoreError} On a pull if the store is closed, the cut is absent/corrupt, an
     * occurrence is missing, or the terminal occurrence no longer matches the cut.
     * @throws {TypeError} On a pull if the identifier or encountered stored data is malformed.
     * @throws {Error} On a pull if SQLite or canonical record decoding fails.
     *
     * @example
     * ```ts
     * for await (const record of store.iterateCutRecords("cut:review")) {
     *     console.log(record.view.owner_ordinal, record.envelope.record_id);
     * }
     * ```
     *
     * @public
     */
    async *iterateCutRecords(cutId: CutId): AsyncGenerator<OwnerRecord, void, unknown> {
        this.#assertOpen();
        const cut = readStoredCut(this.#database, cutId);
        if (
            cut.through_owner_ordinal < kernelProtocolConfig.append.firstOwnerOrdinal ||
            cut.through_owner_ordinal > kernelProtocolConfig.append.lastOwnerOrdinal
        ) {
            throw new TraceStoreError("cut endpoint is outside the configured ordinal range");
        }
        for (
            let ordinal = kernelProtocolConfig.append.firstOwnerOrdinal;
            ordinal <= cut.through_owner_ordinal;
            ordinal += 1
        ) {
            this.#assertOpen();
            const record = readOwnerRecordAtOrdinal(this.#database, cut.target_owner_id, ordinal);
            if (
                ordinal === cut.through_owner_ordinal &&
                record.envelope.record_id !== cut.through_record_id
            ) {
                throw new TraceStoreError("cut terminal occurrence no longer matches its address");
            }
            yield record;
        }
    }

    /**
     * Reads one published cut when present without weakening retained validation.
     *
     * @param cutId - Validated exact published cut identifier.
     * @returns Verified cut, or undefined when absent.
     * @throws {TraceStoreError} If retained cut evidence is corrupt or the store is closed.
     * @throws {TypeError} If the identifier is malformed.
     * @internal
     */
    readOptionalCut(cutId: CutId): Cut | undefined {
        this.#assertOpen();
        return readOptionalStoredCut(this.#database, cutId);
    }

    /**
     * Lists a trusted bounded slice of published cuts in canonical record/cut order.
     *
     * @param limit - Positive trusted maximum result count.
     * @param offset - Non-negative trusted canonical offset.
     * @param descending - Whether canonical ordering is reversed.
     * @param cutPrefix - Optional validated exact cut-ID prefix.
     * @returns Frozen verified cuts.
     * @throws {TraceStoreError} If retained cut evidence is corrupt or the store is closed.
     * @internal
     */
    listCuts(
        limit: number,
        offset: number,
        descending = false,
        cutPrefix?: string,
    ): readonly Cut[] {
        this.#assertOpen();
        return listStoredCuts(this.#database, limit, offset, descending, cutPrefix);
    }

    /**
     * Reads an owner path through an inclusive ordinal.
     *
     * @param ownerId - Stable trace-owner identifier.
     * @param through - Inclusive owner ordinal.
     * @param options - Mode and visibility selection.
     * @returns An immutable graph-shaped slice.
     * @throws {TraceStoreError} If retained owner-path evidence is corrupt or the store is closed.
     * @throws {TypeError} If the owner, ordinal, or options are malformed.
     *
     * @public
     */
    readOwnerPrefix(ownerId: string, through: number, options: SliceReadOptions = {}): Slice {
        this.#assertOpen();
        return readOwnerPrefixSlice(this.#database, ownerId, through, options);
    }

    /**
     * Resolves a published cut without including later owner-path records.
     *
     * @param cutId - Stable published cut identifier.
     * @param options - Mode and visibility selection.
     * @returns An immutable graph-shaped slice addressed by the cut.
     * @throws {TraceStoreError} If the cut is absent, corrupt, or the store is closed.
     * @throws {TypeError} If the cut identifier or options are malformed.
     *
     * @public
     */
    resolveCut(cutId: CutId, options: SliceReadOptions = {}): Slice {
        this.#assertOpen();
        const cut = readStoredCut(this.#database, cutId);
        return readOwnerPrefixSlice(
            this.#database,
            cut.target_owner_id,
            cut.through_owner_ordinal,
            options,
            cut,
        );
    }

    /**
     * Projects one execution lifecycle at an immutable published cut.
     *
     * @param cutId - Cut addressing the execution owner prefix.
     * @returns A frozen, reproducible execution value.
     * @throws {ProjectionCompatibilityError} If configured projection requirements cannot be met.
     * @throws {TraceStoreError} If retained cut or lifecycle evidence is absent or corrupt.
     * @throws {TypeError} If the cut identifier is malformed.
     *
     * @public
     */
    projectExecution(cutId: CutId): Execution {
        this.#assertOpen();
        const cut = readStoredCut(this.#database, cutId);
        const slice = readOwnerPrefixSlice(
            this.#database,
            cut.target_owner_id,
            cut.through_owner_ordinal,
            historyProjectionReadOptions(),
            cut,
        );
        return projectExecution(slice, cut.target_owner_id, cut);
    }

    /**
     * Projects effective execution history at immutable root and child cuts.
     *
     * Active child relations resolve their published child cuts. Abandoned relations remain
     * visible in retained history but do not select an effective child.
     *
     * @param cutId - Cut addressing the root execution owner prefix.
     * @returns Frozen root, relation, child, and parent-publication projections.
     * @throws {ProjectionCompatibilityError} If configured projection requirements cannot be met.
     * @throws {TraceStoreError} If a required cut or retained record is absent or corrupt.
     * @throws {TypeError} If the cut identifier is malformed.
     *
     * @public
     */
    projectEffectiveHistory(cutId: CutId): EffectiveHistory {
        this.#assertOpen();
        const rootCut = readStoredCut(this.#database, cutId);
        const rootSlice = readOwnerPrefixSlice(
            this.#database,
            rootCut.target_owner_id,
            rootCut.through_owner_ordinal,
            historyProjectionReadOptions(),
            rootCut,
        );
        const relations = projectExecutionRelations(rootSlice, rootCut.target_owner_id);
        const childSlices = activeExecutionRelations(relations).flatMap((relation) =>
            relation.child_cut_id === null
                ? []
                : [this.resolveCut(relation.child_cut_id, historyProjectionReadOptions())],
        );
        return projectEffectiveHistory(rootSlice, rootCut.target_owner_id, childSlices);
    }

    /**
     * Reads the transitive causal closure of one or more retained root records.
     *
     * Causal traversal occurs before mode filtering. Direct omitted parents become anchors under
     * the configured default policy, and witness support is closed independently to the root.
     *
     * @param rootRecordIds - Records from which causal traversal begins.
     * @param options - Mode, visibility, and anchor policy.
     * @returns An immutable graph-shaped slice.
     * @throws {TraceStoreError} If a root, parent, or witness is absent or corrupt.
     * @throws {TypeError} If the request options or identifiers are malformed.
     *
     * @public
     */
    readCausalClosure(
        rootRecordIds: readonly RecordId[],
        options: CausalClosureOptions = {},
    ): Slice {
        this.#assertOpen();
        return readCausalClosureSlice(this.#database, rootRecordIds, options);
    }

    /**
     * Closes the SQLite connection. Repeated calls are harmless.
     *
     * @public
     */
    close(): void {
        if (!this.#closed) {
            this.#database.close();
            this.#closed = true;
            this.#cleanupBlobDirectory();
        }
    }

    /**
     * Closes the store when used with explicit resource management.
     *
     * @public
     */
    [Symbol.dispose](): void {
        this.close();
    }

    #assertOpen(): void {
        if (this.#closed) {
            throw new TraceStoreError("trace store is closed");
        }
    }

    #ensureRootWitness(): void {
        const { body, envelope } = createConfiguredRootWitness();
        this.#database
            .prepare(
                `INSERT OR IGNORE INTO ${STORE_TABLES.records}(
                    record_id, digest, schema_ref, mode, witness_ref, caused_by_json, body_json
                 ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
                envelope.record_id,
                envelope.digest,
                envelope.schema_ref,
                envelope.mode,
                envelope.witness_ref,
                "[]",
                canonicalizeRecord(body),
            );
        readStoredRecord(this.#database, envelope.record_id);
    }
}
