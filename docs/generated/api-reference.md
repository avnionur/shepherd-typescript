# Generated API reference

Package: `@avnionur/shepherd-typescript` 2.0.2

This file is generated deterministically from the emitted declaration targets in the
package export map. Run `pnpm generate:api-reference` to update it or
`pnpm check:api-reference` to reject drift.

Package runtime requirement: `>=24.12.0 <25`.

## Root

Package entry: `.`

Complete supported package surface preserved for existing consumers.

Runtime: ESM on Node >=24.12.0 <25, except the type-only /read entry (no Node runtime required).

Authority and mutation: This aggregate entry includes pure helpers and explicit Node-backed persistence, execution, and workspace APIs. Mutation authority is never ambient and remains visible in each signature.

Import example:

```ts
import * as api from "@avnionur/shepherd-typescript";
void api;
```

Exported symbols: 526.

### `AppendBatchDraft`

Classification: `type-only`. Kind: `type alias`.

Ordered groups prepared as one future atomic append operation.

Signature:

```ts
export type AppendBatchDraft = {
    readonly groups: readonly AppendGroupDraft[];
};
```

### `AppendGroupDraft`

Classification: `type-only`. Kind: `type alias`.

Ordered record drafts sharing one owner path and common causal parents.

Signature:

```ts
export type AppendGroupDraft = {
    readonly caused_by_record_ids?: readonly RecordId[];
    readonly owner_id: TraceOwnerId;
    readonly records: readonly AppendRecordDraft[];
};
```

### `AppendIntentConflictError`

Classification: `runtime-and-type`. Kind: `class`.

Raised when an append intent is replayed with different semantic content.

Signature:

```ts
export declare class AppendIntentConflictError extends TraceStoreError {
    readonly code: string;
}
```

#### `code`

Stable configured machine-readable append-conflict code.

```ts
readonly code: string;
```

### `AppendIntentId`

Classification: `type-only`. Kind: `type alias`.

Stable identifier for one idempotent append attempt.

Signature:

```ts
export type AppendIntentId = string;
```

### `AppendLocalId`

Classification: `type-only`. Kind: `type alias`.

Batch-local name used by later drafts to cite an earlier record.

Signature:

```ts
export type AppendLocalId = string;
```

### `AppendPlanningState`

Classification: `type-only`. Kind: `type alias`.

Existing trace state required to plan parent resolution and ordinals.

Signature:

```ts
export type AppendPlanningState = {
    readonly known_record_ids?: ReadonlySet<RecordId>;
    readonly next_owner_ordinals?: ReadonlyMap<TraceOwnerId, OwnerOrdinal>;
};
```

### `AppendReceipt`

Classification: `type-only`. Kind: `type alias`.

Durable result returned for a committed or identically replayed append.

Signature:

```ts
export type AppendReceipt = {
    readonly append_intent_id: AppendIntentId;
    readonly causal_edges: readonly (readonly [
        RecordId,
        RecordId
    ])[];
    readonly owner_ordinal_ranges: ReadonlyMap<TraceOwnerId, readonly [
        OwnerOrdinal,
        OwnerOrdinal
    ]>;
    readonly record_ids: readonly RecordId[];
};
```

### `AppendRecordDraft`

Classification: `type-only`. Kind: `type alias`.

Append-time semantic input for one record.

Signature:

```ts
export type AppendRecordDraft<TBody extends RecordBody = RecordBody> = {
    readonly append_local_id?: AppendLocalId;
    readonly body: TBody;
    readonly caused_by_record_ids?: readonly RecordId[];
    readonly caused_by_local_refs?: readonly AppendLocalId[];
    readonly mode: RecordMode;
    readonly schema_ref: string;
    readonly witness_ref: RecordId;
};
```

### `AppendRecoveryDiagnostic`

Classification: `type-only`. Kind: `type alias`.

Read-only diagnosis describing how an append intent may be handled.

Signature:

```ts
export type AppendRecoveryDiagnostic = {
    readonly append_intent_id: AppendIntentId;
    readonly issue: AppendRecoveryIssue | null;
    readonly status: AppendRecoveryStatus;
};
```

### `AppendRecoveryIssue`

Classification: `type-only`. Kind: `type alias`.

Stable defect classification for append recovery.

Signature:

```ts
export type AppendRecoveryIssue = "orphaned_rows" | "receipt_mismatch";
```

### `AppendRecoveryStatus`

Classification: `type-only`. Kind: `type alias`.

Stable recovery classification for one append intent.

Signature:

```ts
export type AppendRecoveryStatus = "committed" | "manual_recovery_required" | "retry_safe";
```

### `AppliedRetainedWorldSettlement`

Classification: `type-only`. Kind: `type alias`.

Completed durable apply result after authenticated carrier publication.

Signature:

```ts
export type AppliedRetainedWorldSettlement = {
    readonly action: (typeof RETAINED_WORLD_SETTLEMENT_ACTIONS)[2];
    readonly applied_revision_id: string;
    readonly application_plan_id: string;
    readonly operation_id: string;
    readonly output_id: string;
    readonly publication_id: string;
    readonly plan_reason: RetainedWorldApplicationPlanEvidence["reason"];
    readonly plan_status: RetainedWorldApplicationPlanEvidence["status"];
    readonly request_id: string;
    readonly settlement_version: typeof RETAINED_WORLD_SETTLEMENT_VERSION;
    readonly state: (typeof RETAINED_WORLD_SETTLEMENT_STATES)[4];
    readonly user_basis_after: string;
};
```

### `ApplyRetainedWorldSettlementOptions`

Classification: `type-only`. Kind: `type alias`.

Closed authorities for exact-ID retained-world apply and recovery.

Signature:

```ts
export type ApplyRetainedWorldSettlementOptions = {
    readonly binding: WorkspaceBinding;
    readonly carrier: ReferenceCopyCarrier;
    readonly outputId: string;
    readonly store: SQLiteTraceStore;
};
```

### `BlobId`

Classification: `type-only`. Kind: `type alias`.

Content-addressed identity of one retained binary value.

Signature:

```ts
export type BlobId = string;
```

### `BlobIntegrityError`

Classification: `runtime-and-type`. Kind: `class`.

Raised when durable blob bytes disagree with their storage receipt.

Signature:

```ts
export declare class BlobIntegrityError extends TraceStoreError {
    readonly code: string;
}
```

#### `code`

Stable configured machine-readable blob-integrity code.

```ts
readonly code: string;
```

### `BlobIntegrityIssue`

Classification: `type-only`. Kind: `type alias`.

Classified integrity failure for one durable blob receipt.

Signature:

```ts
export type BlobIntegrityIssue = {
    readonly blob_id: BlobId;
    readonly kind: "digest_mismatch" | "missing" | "not_regular_file" | "receipt_mismatch" | "size_mismatch";
};
```

### `BlobIntegrityReport`

Classification: `type-only`. Kind: `type alias`.

Complete integrity scan result for durable blob receipts.

Signature:

```ts
export type BlobIntegrityReport = {
    readonly checked_blob_count: number;
    readonly issues: readonly BlobIntegrityIssue[];
    readonly ok: boolean;
};
```

### `BlobOrphanCollectionMode`

Classification: `type-only`. Kind: `type alias`.

Operation applied to discovered unregistered blob-store objects.

Signature:

```ts
export type BlobOrphanCollectionMode = "delete" | "inspect";
```

### `BlobOrphanCollectionOptions`

Classification: `type-only`. Kind: `type alias`.

Options controlling safe blob-orphan inspection or deletion.

Signature:

```ts
export type BlobOrphanCollectionOptions = {
    readonly mode?: BlobOrphanCollectionMode;
};
```

### `BlobOrphanCollectionReport`

Classification: `type-only`. Kind: `type alias`.

Frozen result of one lock-protected blob-orphan collection pass.

Signature:

```ts
export type BlobOrphanCollectionReport = {
    readonly deleted_blob_ids: readonly BlobId[];
    readonly deleted_temporary_file_count: number;
    readonly mode: BlobOrphanCollectionMode;
    readonly orphan_blob_ids: readonly BlobId[];
    readonly orphan_temporary_file_count: number;
};
```

### `BlobStorageReceipt`

Classification: `type-only`. Kind: `type alias`.

Durable result returned after blob bytes and metadata are retained.

Signature:

```ts
export type BlobStorageReceipt = {
    readonly blob_id: BlobId;
    readonly byte_length: number;
};
```

### `CancelledRunDefinition`

Classification: `type-only`. Kind: `type alias`.

Externally cancelled terminal definition accepted by createRunOutcome.

Signature:

```ts
export type CancelledRunDefinition = {
    readonly reason: string;
    readonly status: (typeof RUN_TERMINAL_STATUSES)[3];
};
```

### `CancelledRunOutcome`

Classification: `type-only`. Kind: `type alias`.

Externally cancelled immutable terminal run value.

Signature:

```ts
export type CancelledRunOutcome = {
    readonly reason: string;
    readonly status: (typeof RUN_TERMINAL_STATUSES)[3];
};
```

### `CaptureGrantedTaskWorldOptions`

Classification: `type-only`. Kind: `type alias`.

Closed options for repository-granted retained-world task execution.

Signature:

```ts
export type CaptureGrantedTaskWorldOptions<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>> = Omit<CaptureTaskWorldOptions<I, O>, "binding"> & {
    readonly binding: GitRepositoryBinding;
    readonly repositoryGrantPlan: GitRepositoryGrantPlan;
};
```

### `CaptureJailedGrantedTaskWorldOptions`

Classification: `type-only`. Kind: `type alias`.

Closed options for native-jailed repository-granted retained-world execution.

Signature:

```ts
export type CaptureJailedGrantedTaskWorldOptions<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>> = CaptureGrantedTaskWorldOptions<I, O> & {
    readonly nativeJailResolution: NativeJailPlacementResolution;
};
```

### `CapturePlacedGrantedTaskWorldOptions`

Classification: `type-only`. Kind: `type alias`.

Closed options for placement-resolved repository-granted retained-world execution.

Signature:

```ts
export type CapturePlacedGrantedTaskWorldOptions<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>> = CaptureGrantedTaskWorldOptions<I, O> & {
    readonly placementResolution: GrantedPlacementResolution;
};
```

### `CaptureTaskWorldOptions`

Classification: `type-only`. Kind: `type alias`.

Closed options for one fenced durable retained-world task execution.

Signature:

```ts
export type CaptureTaskWorldOptions<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>> = {
    readonly baseRevision: WorldRevision;
    readonly binding: WorkspaceBinding;
    readonly captureId: string;
    readonly carrier: ReferenceCopyCarrier;
    readonly execution: TaskExecutionOptions<I, O>;
    readonly runner: RetainedWorldRunner<I, O>;
    readonly store: SQLiteTraceStore;
};
```

### `CausalClosureOptions`

Classification: `type-only`. Kind: `type alias`.

Options for a causal-closure read.

Signature:

```ts
export type CausalClosureOptions = SliceReadOptions & {
    readonly closure_policy?: ClosurePolicy;
};
```

### `CliIo`

Classification: `type-only`. Kind: `type alias`.

Injectable process boundary used by the reusable CLI runner.

Signature:

```ts
export type CliIo = {
    readonly cwd: string;
    readonly stderr: (text: string) => void;
    readonly stdout: (text: string) => void;
};
```

### `ClosurePolicy`

Classification: `type-only`. Kind: `type alias`.

Whether omitted causal parents are represented as anchors.

Signature:

```ts
export type ClosurePolicy = "include_external_anchors" | "visible_only";
```

### `Core0hHandlerPhases`

Classification: `type-only`. Kind: `type alias`.

Deterministic two-phase handler body cited by a Core-0H sidecar.

Signature:

```ts
export type Core0hHandlerPhases = {
    readonly handler_ref: string;
    readonly phase_one_ref: string;
    readonly phase_two_ref: string;
};
```

### `Core0hSidecarEvidence`

Classification: `type-only`. Kind: `type alias`.

Validator-issued content-addressed Core-0H sidecar manifest.

Signature:

```ts
export type Core0hSidecarEvidence = {
    readonly handler_phases: readonly Core0hHandlerPhases[];
    readonly lowering_ref: string;
    readonly program_ref: string;
    readonly schema_version: string;
    readonly sidecar_ref: string;
    readonly trace_ref: string;
    readonly validator: string;
};
```

### `Cut`

Classification: `type-only`. Kind: `type alias`.

Durable immutable address of an owner-path prefix.

Signature:

```ts
export type Cut = {
    readonly created_by_record_id: RecordId;
    readonly cut_id: CutId;
    readonly publisher_owner_id: TraceOwnerId;
    readonly target_owner_id: TraceOwnerId;
    readonly through_owner_ordinal: OwnerOrdinal;
    readonly through_record_id: RecordId;
};
```

### `CutId`

Classification: `type-only`. Kind: `type alias`.

Stable identifier for one published immutable trace cut.

Signature:

```ts
export type CutId = string;
```

### `CutSpec`

Classification: `type-only`. Kind: `type alias`.

Input used to publish an immutable owner-prefix cut.

Signature:

```ts
export type CutSpec = {
    readonly append_intent_id?: AppendIntentId;
    readonly caused_by_record_ids?: readonly RecordId[];
    readonly cut_id: CutId;
    readonly publisher_owner_id?: TraceOwnerId;
    readonly target_owner_id: TraceOwnerId;
    readonly through_record_id: RecordId;
    readonly witness_ref?: RecordId;
};
```

### `DiscardRetainedWorldSettlementOptions`

Classification: `type-only`. Kind: `type alias`.

Closed authorities for exact-ID retained-world discard and recovery.

Signature:

```ts
export type DiscardRetainedWorldSettlementOptions = {
    readonly carrier: ReferenceCopyCarrier;
    readonly outputId: string;
    readonly store: SQLiteTraceStore;
};
```

### `DiscardedRetainedWorldSettlement`

Classification: `type-only`. Kind: `type alias`.

Completed durable discard result after idempotent physical custody cleanup.

Signature:

```ts
export type DiscardedRetainedWorldSettlement = {
    readonly action: (typeof RETAINED_WORLD_SETTLEMENT_ACTIONS)[1];
    readonly cleanup_completed: true;
    readonly operation_id: string;
    readonly output_id: string;
    readonly request_id: string;
    readonly settlement_version: typeof RETAINED_WORLD_SETTLEMENT_VERSION;
    readonly state: (typeof RETAINED_WORLD_SETTLEMENT_STATES)[3];
};
```

### `DurableExecutionCancellationCommand`

Classification: `type-only`. Kind: `type alias`.

Canonical semantic body retained for one durable cancellation request.

Signature:

```ts
export type DurableExecutionCancellationCommand = {
    readonly command_id: string;
    readonly command_kind: (typeof DURABLE_EXECUTION_CONTROL_COMMAND_KINDS)[3];
    readonly execution_id: string;
    readonly expected_lifecycle_record_id: RecordId;
    readonly fencing_token: number;
    readonly reason: string;
};
```

### `DurableExecutionClaimFencedError`

Classification: `runtime-and-type`. Kind: `class`.

Raised when an invocation claim expires or is superseded before start publication.

Signature:

```ts
export declare class DurableExecutionClaimFencedError extends TraceStoreError {
    readonly code: string;
    readonly claim_id: string;
    readonly run_id: string;
    constructor(runId: string, claimId: string);
}
```

#### `code`

Stable configuration-owned fencing error code.

```ts
readonly code: string;
```

#### `claim_id`

Claim identity rejected at the start boundary.

```ts
readonly claim_id: string;
```

#### `run_id`

Run whose start publication was fenced.

```ts
readonly run_id: string;
```

#### `constructor`

Creates an expired-or-superseded claim failure.

```ts
constructor(runId: string, claimId: string);
```

Parameter:

- runId - Run whose start publication was rejected.

Parameter:

- claimId - Rejected claim identity.

### `DurableExecutionClaimLostError`

Classification: `runtime-and-type`. Kind: `class`.

Raised when another caller already owns the durable provider-invocation claim.

Signature:

```ts
export declare class DurableExecutionClaimLostError extends TraceStoreError {
    readonly code: string;
    readonly claim_id: string;
    readonly run_id: string;
    readonly status: "lost";
    constructor(runId: string, claimId: string);
}
```

#### `code`

Stable configuration-owned claim-loss error code.

```ts
readonly code: string;
```

#### `claim_id`

Claim identity that won admission.

```ts
readonly claim_id: string;
```

#### `run_id`

Run whose invocation boundary is owned by another caller.

```ts
readonly run_id: string;
```

#### `status`

Typed losing-claim result status.

```ts
readonly status: "lost";
```

#### `constructor`

Creates a typed losing-claim result.

```ts
constructor(runId: string, claimId: string);
```

Parameter:

- runId - Run whose invocation boundary is already claimed.

Parameter:

- claimId - Current winning claim identity.

### `DurableExecutionClaimedAppend`

Classification: `type-only`. Kind: `type alias`.

Result of atomically appending while a durable invocation claim is current.

Signature:

```ts
export type DurableExecutionClaimedAppend = {
    readonly receipt: AppendReceipt;
    readonly status: (typeof DURABLE_EXECUTION_CLAIMED_APPEND_STATUSES)[0];
} | {
    readonly status: (typeof DURABLE_EXECUTION_CLAIMED_APPEND_STATUSES)[1];
};
```

### `DurableExecutionInactiveCancellationCommand`

Classification: `type-only`. Kind: `type alias`.

Canonical semantic body retained for cancellation without an authoritative worker.

Signature:

```ts
export type DurableExecutionInactiveCancellationCommand = {
    readonly command_id: string;
    readonly command_kind: (typeof DURABLE_EXECUTION_CONTROL_COMMAND_KINDS)[3];
    readonly execution_id: string;
    readonly expected_lifecycle_record_id: RecordId;
    readonly reason: string;
};
```

### `DurableExecutionInvocationClaim`

Classification: `type-only`. Kind: `type alias`.

Result of atomically admitting one caller to cross a durable invocation boundary.

Signature:

```ts
export type DurableExecutionInvocationClaim = {
    readonly claim_id: string;
    readonly created_record_id: RecordId;
    readonly fencing_token: number;
    readonly lease_expires_at: number;
    readonly run_id: string;
    readonly status: (typeof DURABLE_EXECUTION_INVOCATION_CLAIM_STATUSES)[0];
} | {
    readonly claim_id: string;
    readonly created_record_id: RecordId;
    readonly fencing_token: number;
    readonly lease_expires_at: number;
    readonly run_id: string;
    readonly status: (typeof DURABLE_EXECUTION_INVOCATION_CLAIM_STATUSES)[1];
};
```

### `DurableExecutionPauseCommand`

Classification: `type-only`. Kind: `type alias`.

Canonical semantic body retained for one durable pause request.

Signature:

```ts
export type DurableExecutionPauseCommand = {
    readonly command_id: string;
    readonly command_kind: (typeof DURABLE_EXECUTION_CONTROL_COMMAND_KINDS)[1];
    readonly execution_id: string;
    readonly expected_lifecycle_record_id: RecordId;
    readonly fencing_token: number;
    readonly reason: string;
};
```

### `DurableExecutionPrerequisiteSatisfaction`

Classification: `type-only`. Kind: `type alias`.

Canonical prerequisite-satisfaction evidence retained by a waiting resume command.

Signature:

```ts
export type DurableExecutionPrerequisiteSatisfaction = {
    readonly kind: string;
    readonly prerequisite_id: string;
    readonly receipt_id: string;
};
```

### `DurableExecutionRecoveryAbsentError`

Classification: `runtime-and-type`. Kind: `class`.

Raised when recovery is requested for a run without retained creation evidence.

Signature:

```ts
export declare class DurableExecutionRecoveryAbsentError extends TraceStoreError {
    readonly code: string;
    readonly run_id: string;
    readonly status: "absent";
    constructor(runId: string);
}
```

#### `code`

Stable configuration-owned absent-recovery error code.

```ts
readonly code: string;
```

#### `run_id`

Run that has no durable creation evidence.

```ts
readonly run_id: string;
```

#### `status`

Typed absent recovery status.

```ts
readonly status: "absent";
```

#### `constructor`

Creates an absent-run recovery failure.

```ts
constructor(runId: string);
```

Parameter:

- runId - Run that cannot be recovered because it has no creation evidence.

### `DurableExecutionRecoveryCommand`

Classification: `type-only`. Kind: `type alias`.

Canonical semantic body retained for one durable recovery command.

Signature:

```ts
export type DurableExecutionRecoveryCommand = {
    readonly command_id: string;
    readonly command_kind: (typeof DURABLE_EXECUTION_CONTROL_COMMAND_KINDS)[0];
    readonly execution_id: string;
};
```

### `DurableExecutionRecoveryCommandReceipt`

Classification: `type-only`. Kind: `type alias`.

Stable canonical evidence retained for one durable recovery command.

Signature:

```ts
export type DurableExecutionRecoveryCommandReceipt = {
    readonly command_id: string;
    readonly record_id: RecordId;
};
```

### `DurableExecutionRecoveryCommandRequiredError`

Classification: `runtime-and-type`. Kind: `class`.

Raised when an existing incomplete execution requires an explicit durable command.

Signature:

```ts
export declare class DurableExecutionRecoveryCommandRequiredError extends TraceStoreError {
    readonly code: string;
    readonly run_id: string;
    readonly status: typeof CREATED_RECOVERY_STATUS | typeof TERMINAL_PENDING_CUT_STATUS;
    constructor(runId: string, status: typeof CREATED_RECOVERY_STATUS | typeof TERMINAL_PENDING_CUT_STATUS);
}
```

#### `code`

Stable configuration-owned command-required error code.

```ts
readonly code: string;
```

#### `run_id`

Run whose incomplete evidence requires explicit recovery authority.

```ts
readonly run_id: string;
```

#### `status`

Incomplete state that cannot be advanced by ordinary execution.

```ts
readonly status: typeof CREATED_RECOVERY_STATUS | typeof TERMINAL_PENDING_CUT_STATUS;
```

#### `constructor`

Creates an explicit-command-required recovery failure.

```ts
constructor(runId: string, status: typeof CREATED_RECOVERY_STATUS | typeof TERMINAL_PENDING_CUT_STATUS);
```

Parameter:

- runId - Run whose incomplete evidence requires recovery authority.

Parameter:

- status - Recoverable incomplete state rejected by ordinary execution.

### `DurableExecutionRecoveryError`

Classification: `runtime-and-type`. Kind: `class`.

Raised when durable evidence cannot prove that provider invocation is safe to repeat.

Signature:

```ts
export declare class DurableExecutionRecoveryError extends TraceStoreError {
    readonly code: string;
    readonly run_id: string;
    readonly status: "started";
    constructor(runId: string);
}
```

#### `code`

Stable configuration-owned recovery error code.

```ts
readonly code: string;
```

#### `run_id`

Run whose retained start has no terminal evidence.

```ts
readonly run_id: string;
```

#### `status`

Unsafe durable recovery state.

```ts
readonly status: "started";
```

#### `constructor`

Creates an unsafe-started-run recovery failure.

```ts
constructor(runId: string);
```

Parameter:

- runId - Run whose provider may already have been invoked.

### `DurableExecutionResumeCommand`

Classification: `type-only`. Kind: `type alias`.

Canonical semantic body retained for one durable resume command.

Signature:

```ts
export type DurableExecutionResumeCommand = {
    readonly command_id: string;
    readonly command_kind: (typeof DURABLE_EXECUTION_CONTROL_COMMAND_KINDS)[2];
    readonly continuation_descriptor_id: RecordId;
    readonly execution_id: string;
    readonly expected_lifecycle_record_id: RecordId;
    readonly prerequisite_satisfaction?: DurableExecutionPrerequisiteSatisfaction;
};
```

### `DurableTaskCancellationAcknowledgementOptions`

Classification: `type-only`. Kind: `type alias`.

Options for acknowledging cancellation at the exact current worker safe boundary.

Signature:

```ts
export type DurableTaskCancellationAcknowledgementOptions = {
    readonly cancelCommandRecordId: RecordId;
    readonly claimId: string;
    readonly expectedLifecycleRecordId: RecordId;
    readonly fencingToken: number;
    readonly runId: string;
};
```

### `DurableTaskCancellationCommandReceipt`

Classification: `type-only`. Kind: `type alias`.

Stable canonical evidence retained for one durable cancellation request.

Signature:

```ts
export type DurableTaskCancellationCommandReceipt = {
    readonly command_id: string;
    readonly record_id: RecordId;
};
```

### `DurableTaskCancellationOptions`

Classification: `type-only`. Kind: `type alias`.

Options for retaining one globally idempotent durable cancellation request.

Signature:

```ts
export type DurableTaskCancellationOptions = {
    readonly commandId: string;
    readonly expectedLifecycleRecordId: RecordId;
    readonly fencingToken: number;
    readonly reason: string;
    readonly runId: string;
};
```

### `DurableTaskDirectCancellationOptions`

Classification: `type-only`. Kind: `type alias`.

Options for atomically cancelling a durable run without an authoritative worker.

Signature:

```ts
export type DurableTaskDirectCancellationOptions = {
    readonly commandId: string;
    readonly expectedLifecycleRecordId: RecordId;
    readonly reason: string;
    readonly runId: string;
};
```

### `DurableTaskExecutionArtifactInspection`

Classification: `type-only`. Kind: `type alias`.

One retained artifact and its canonical record identity in an inspection view.

Signature:

```ts
export type DurableTaskExecutionArtifactInspection = {
    readonly artifact: RunArtifact;
    readonly record_id: RecordId;
};
```

### `DurableTaskExecutionContinuationConstituentInspection`

Classification: `type-only`. Kind: `type alias`.

One classified continuation constituent in a durable inspection view.

Signature:

```ts
export type DurableTaskExecutionContinuationConstituentInspection = {
    readonly kind: (typeof RUN_CONTINUATION_CONSTITUENT_KINDS)[number];
    readonly receipt_id: string | null;
    readonly status: (typeof RUN_CONTINUATION_EVIDENCE_STATUSES)[number];
};
```

### `DurableTaskExecutionContinuationInspection`

Classification: `type-only`. Kind: `type alias`.

Validated continuation descriptor and its immutable trace cut.

Signature:

```ts
export type DurableTaskExecutionContinuationInspection = {
    readonly constituents: readonly DurableTaskExecutionContinuationConstituentInspection[];
    readonly record_id: RecordId;
    readonly trace_cut: Cut;
};
```

### `DurableTaskExecutionInspection`

Classification: `type-only`. Kind: `type alias`.

Read-only projection of validated durable task-execution evidence.

Signature:

```ts
export type DurableTaskExecutionInspection = {
    readonly artifacts: readonly DurableTaskExecutionArtifactInspection[];
    readonly causal_edges: readonly (readonly [
        RecordId,
        RecordId
    ])[];
    readonly cut: Cut | null;
    readonly lifecycle: DurableTaskExecutionLifecycleInspection;
    readonly outcome: DurableTaskExecutionOutcomeInspection | null;
    readonly run_id: string;
    readonly settlements: readonly DurableTaskExecutionSettlementInspection[];
    readonly status: (typeof DURABLE_EXECUTION_RECOVERY_STATUSES)[number];
    readonly usage: DurableTaskExecutionUsageInspection | null;
};
```

### `DurableTaskExecutionLifecycleInspection`

Classification: `type-only`. Kind: `type alias`.

Lifecycle record identities visible for one durable task execution.

Signature:

```ts
export type DurableTaskExecutionLifecycleInspection = {
    readonly created_record_id: RecordId | null;
    readonly quiescent: DurableTaskExecutionQuiescentInspection | null;
    readonly running_continuation_record_id: RecordId | null;
    readonly started_record_id: RecordId | null;
    readonly terminal_record_id: RecordId | null;
    readonly terminal_schema_ref: string | null;
};
```

### `DurableTaskExecutionOutcomeInspection`

Classification: `type-only`. Kind: `type alias`.

One retained terminal outcome and its canonical record identity.

Signature:

```ts
export type DurableTaskExecutionOutcomeInspection = {
    readonly outcome: RunOutcome;
    readonly record_id: RecordId;
};
```

### `DurableTaskExecutionQuiescentInspection`

Classification: `type-only`. Kind: `type alias`.

Read-only waiting or suspension acknowledgement evidence.

Signature:

```ts
export type DurableTaskExecutionQuiescentInspection = {
    readonly acknowledgement_record_id: RecordId;
    readonly acknowledgement_schema_ref: string;
    readonly continuation: DurableTaskExecutionContinuationInspection;
    readonly pause_command_record_id: null;
    readonly prerequisite: {
        readonly kind: string;
        readonly prerequisite_id: string;
    };
    readonly status: typeof RUN_LIFECYCLE_WAITING_STATUS;
} | {
    readonly acknowledgement_record_id: RecordId;
    readonly acknowledgement_schema_ref: string;
    readonly continuation: DurableTaskExecutionContinuationInspection;
    readonly pause_command_record_id: RecordId;
    readonly prerequisite: null;
    readonly status: typeof RUN_LIFECYCLE_SUSPENDED_STATUS;
};
```

### `DurableTaskExecutionRecovery`

Classification: `type-only`. Kind: `type alias`.

Durable execution recovery classification returned by readDurableTaskExecution.

Signature:

```ts
export type DurableTaskExecutionRecovery = {
    readonly run_id: string;
    readonly status: (typeof DURABLE_EXECUTION_RECOVERY_STATUSES)[0];
} | {
    readonly created_record_id: RecordId;
    readonly run_id: string;
    readonly status: (typeof DURABLE_EXECUTION_RECOVERY_STATUSES)[1];
} | {
    readonly created_record_id: RecordId;
    readonly run_id: string;
    readonly started_record_id: RecordId;
    readonly status: (typeof DURABLE_EXECUTION_RECOVERY_STATUSES)[2];
} | {
    readonly execution: TaskExecutionResult;
    readonly ledger: Omit<TaskExecutionLedgerReceipt, "cut">;
    readonly run_id: string;
    readonly status: (typeof DURABLE_EXECUTION_RECOVERY_STATUSES)[3];
} | {
    readonly result: DurableTaskExecutionResult;
    readonly run_id: string;
    readonly status: (typeof DURABLE_EXECUTION_RECOVERY_STATUSES)[4];
};
```

### `DurableTaskExecutionResult`

Classification: `type-only`. Kind: `type alias`.

Terminal task result paired with its durable trace evidence.

Signature:

```ts
export type DurableTaskExecutionResult = {
    readonly execution: TaskExecutionResult;
    readonly ledger: TaskExecutionLedgerReceipt;
};
```

### `DurableTaskExecutionSettlementInspection`

Classification: `type-only`. Kind: `type alias`.

One validated, cut-bounded retained-world settlement citation.

Signature:

```ts
export type DurableTaskExecutionSettlementInspection = {
    readonly action: (typeof RETAINED_WORLD_SETTLEMENT_ACTIONS)[number];
    readonly citation_cut: Cut;
    readonly citation_record_id: RecordId;
    readonly citation_version: typeof RETAINED_WORLD_SETTLEMENT_CITATION_VERSION;
    readonly command_id: string;
    readonly operation: DurableTaskExecutionSettlementOperationInspection;
    readonly output_id: string;
    readonly receipt: DurableTaskExecutionSettlementReceiptInspection;
    readonly request_id: string;
    readonly state: (typeof RETAINED_WORLD_SETTLEMENT_STATES)[2 | 3 | 4 | 5];
    readonly trace: DurableTaskExecutionSettlementTraceInspection;
};
```

### `DurableTaskExecutionSettlementOperationInspection`

Classification: `type-only`. Kind: `type alias`.

Canonical settlement operation evidence attached to a durable execution.

Signature:

```ts
export type DurableTaskExecutionSettlementOperationInspection = {
    readonly digest: string;
    readonly id: string;
    readonly json: string;
};
```

### `DurableTaskExecutionSettlementReceiptInspection`

Classification: `type-only`. Kind: `type alias`.

Canonical terminal settlement receipt attached to a durable execution.

Signature:

```ts
export type DurableTaskExecutionSettlementReceiptInspection = {
    readonly digest: string;
    readonly json: string;
};
```

### `DurableTaskExecutionSettlementTraceInspection`

Classification: `type-only`. Kind: `type alias`.

Exact terminal trace identities cited by one retained-world settlement.

Signature:

```ts
export type DurableTaskExecutionSettlementTraceInspection = {
    readonly capture_record_id: RecordId;
    readonly execution_cut_id: string;
    readonly outcome_record_id: RecordId;
    readonly terminal_record_id: RecordId;
};
```

### `DurableTaskExecutionUsageInspection`

Classification: `type-only`. Kind: `type alias`.

One retained aggregate usage value and its canonical record identity.

Signature:

```ts
export type DurableTaskExecutionUsageInspection = {
    readonly record_id: RecordId;
    readonly usage: RunUsage;
};
```

### `DurableTaskPauseCommandReceipt`

Classification: `type-only`. Kind: `type alias`.

Stable canonical evidence retained for one durable pause request.

Signature:

```ts
export type DurableTaskPauseCommandReceipt = {
    readonly command_id: string;
    readonly record_id: RecordId;
};
```

### `DurableTaskPauseOptions`

Classification: `type-only`. Kind: `type alias`.

Options for retaining one globally idempotent durable pause request.

Signature:

```ts
export type DurableTaskPauseOptions = {
    readonly commandId: string;
    readonly expectedLifecycleRecordId: RecordId;
    readonly fencingToken: number;
    readonly reason: string;
    readonly runId: string;
};
```

### `DurableTaskPrerequisiteSatisfaction`

Classification: `type-only`. Kind: `type alias`.

Prerequisite-satisfaction evidence supplied to a guarded waiting resume.

Signature:

```ts
export type DurableTaskPrerequisiteSatisfaction = {
    readonly kind: string;
    readonly prerequisiteId: string;
    readonly receiptId: string;
};
```

### `DurableTaskRecoveryOptions`

Classification: `type-only`. Kind: `type alias`.

Options for one idempotent durable task-recovery command.

Signature:

```ts
export type DurableTaskRecoveryOptions<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>> = {
    readonly commandId: string;
    readonly execution: TaskExecutionOptions<I, O>;
};
```

### `DurableTaskRecoveryResult`

Classification: `type-only`. Kind: `type alias`.

Recovered durable result paired with its canonical control-command evidence.

Signature:

```ts
export type DurableTaskRecoveryResult = {
    readonly command: DurableExecutionRecoveryCommandReceipt;
    readonly result: DurableTaskExecutionResult;
};
```

### `DurableTaskResumeOptions`

Classification: `type-only`. Kind: `type alias`.

Options for atomically resuming one exact suspended or satisfied waiting durable task.

Signature:

```ts
export type DurableTaskResumeOptions = {
    readonly commandId: string;
    readonly continuationDescriptorRecordId: RecordId;
    readonly expectedLifecycleRecordId: RecordId;
    readonly prerequisiteSatisfaction?: DurableTaskPrerequisiteSatisfaction;
    readonly runId: string;
};
```

### `DurableTaskResumeReceipt`

Classification: `type-only`. Kind: `type alias`.

Canonical command, running acknowledgement, and new worker authority for a resumed run.

Signature:

```ts
export type DurableTaskResumeReceipt = {
    readonly claim_id: string;
    readonly command_record_id: RecordId;
    readonly fencing_token: number;
    readonly lease_expires_at: number;
    readonly running_record_id: RecordId;
};
```

### `DurableTaskSuspensionOptions`

Classification: `type-only`. Kind: `type alias`.

Options for atomically acknowledging command-authorized durable suspension.

Signature:

```ts
export type DurableTaskSuspensionOptions = {
    readonly constituents: readonly RunContinuationCheckpointEvidence[];
    readonly expectedLifecycleRecordId: RecordId;
    readonly fencingToken: number;
    readonly pauseCommandRecordId: RecordId;
    readonly runId: string;
    readonly traceCutId: string;
};
```

### `DurableTaskSuspensionReceipt`

Classification: `type-only`. Kind: `type alias`.

Canonical descriptor and acknowledgement retained for one suspended run.

Signature:

```ts
export type DurableTaskSuspensionReceipt = {
    readonly acknowledgement_record_id: RecordId;
    readonly continuation_descriptor_record_id: RecordId;
    readonly trace_cut_id: string;
};
```

### `DurableTaskWaitingOptions`

Classification: `type-only`. Kind: `type alias`.

Options for atomically acknowledging prerequisite-driven durable waiting.

Signature:

```ts
export type DurableTaskWaitingOptions = {
    readonly constituents: readonly RunContinuationCheckpointEvidence[];
    readonly expectedLifecycleRecordId: RecordId;
    readonly fencingToken: number;
    readonly prerequisite: DurableTaskWaitingPrerequisite;
    readonly runId: string;
    readonly traceCutId: string;
};
```

### `DurableTaskWaitingPrerequisite`

Classification: `type-only`. Kind: `type alias`.

Prerequisite that makes a durable running task quiescent.

Signature:

```ts
export type DurableTaskWaitingPrerequisite = {
    readonly kind: string;
    readonly prerequisiteId: string;
};
```

### `DurableTaskWaitingReceipt`

Classification: `type-only`. Kind: `type alias`.

Canonical descriptor and acknowledgement retained for one waiting run.

Signature:

```ts
export type DurableTaskWaitingReceipt = {
    readonly acknowledgement_record_id: RecordId;
    readonly continuation_descriptor_record_id: RecordId;
    readonly trace_cut_id: string;
};
```

### `EVIDENCE_RECORD_LATEST_SELECTOR`

Classification: `runtime-only`. Kind: `variable`.

Configured canonical latest evidence-record read selector.

Signature:

```ts
export declare const EVIDENCE_RECORD_LATEST_SELECTOR: "@latest";
```

### `EVIDENCE_RECORD_LIMITS`

Classification: `runtime-only`. Kind: `variable`.

Configured public output/trace/recovery selector and projection bounds.

Signature:

```ts
export declare const EVIDENCE_RECORD_LIMITS: {
    readonly defaultPageSize: 50;
    readonly maxCanonicalEntryBytes: 67108864;
    readonly maxPageSize: 100;
    readonly maxSelectorBytes: 512;
};
```

### `EffectFailure`

Classification: `type-only`. Kind: `type alias`.

Failed effect materialization result.

Signature:

```ts
export type EffectFailure<E extends SemanticValue> = {
    readonly error: E;
    readonly ok: false;
};
```

### `EffectHandler`

Classification: `type-only`. Kind: `type alias`.

Synchronous or asynchronous interpretation of one exact effect kind.

Signature:

```ts
export type EffectHandler<K extends string = string, P extends SemanticValue = SemanticValue, V extends SemanticValue = SemanticValue, E extends SemanticValue = SemanticValue> = {
    readonly handle: (intent: EffectIntent<K, P>) => EffectResult<V, E> | Promise<EffectResult<V, E>>;
    readonly handlerId: string;
    readonly kind: K;
};
```

### `EffectHandlerDispatch`

Classification: `type-only`. Kind: `type alias`.

Immutable result of selecting and invoking one effect handler.

Signature:

```ts
export type EffectHandlerDispatch<K extends string = string, V extends SemanticValue = SemanticValue, E extends SemanticValue = SemanticValue> = {
    readonly handlerId: string;
    readonly outcome: EffectOutcome<K, V, E>;
};
```

### `EffectHandlerNotFoundError`

Classification: `runtime-and-type`. Kind: `class`.

Error thrown when an effect handler stack has no exact-kind match.

Signature:

```ts
export declare class EffectHandlerNotFoundError extends Error {
    readonly code: string;
    readonly effectId: string;
    readonly kind: string;
    constructor(effectId: string, kind: string);
}
```

#### `code`

Stable configured machine-readable error code.

```ts
readonly code: string;
```

#### `effectId`

Caller-assigned identity of the unhandled effect intent.

```ts
readonly effectId: string;
```

#### `kind`

Application-defined kind of the unhandled effect intent.

```ts
readonly kind: string;
```

#### `constructor`

Creates an unhandled-effect diagnostic.

```ts
constructor(effectId: string, kind: string);
```

Parameter:

- effectId - Caller-assigned effect identity.

Parameter:

- kind - Exact effect kind that could not be resolved.

### `EffectHandlerStack`

Classification: `type-only`. Kind: `type alias`.

Immutable ordered collection that dispatches validated effect intents.

Signature:

```ts
export type EffectHandlerStack = {
    readonly dispatch: <K extends string, P extends SemanticValue>(intent: EffectIntent<K, P>) => Promise<EffectHandlerDispatch<K>>;
};
```

### `EffectIntent`

Classification: `type-only`. Kind: `type alias`.

Immutable canonical record emitted before an effect may materialize.

Signature:

```ts
export type EffectIntent<K extends string = string, P extends SemanticValue = SemanticValue> = {
    readonly effect_id: string;
    readonly intent_version: number;
    readonly kind: K;
    readonly payload: P;
    readonly phase: (typeof EFFECT_PHASES)["intent"];
    readonly reversibility: EffectReversibility;
};
```

### `EffectIntentDefinition`

Classification: `type-only`. Kind: `type alias`.

Definition accepted by createEffectIntent.

Signature:

```ts
export type EffectIntentDefinition<K extends string, P extends SemanticValue> = {
    readonly effectId: string;
    readonly kind: K;
    readonly payload: P;
    readonly reversibility: EffectReversibility;
};
```

### `EffectOutcome`

Classification: `type-only`. Kind: `type alias`.

Immutable canonical record emitted after an effect receives a world response.

Signature:

```ts
export type EffectOutcome<K extends string = string, V extends SemanticValue = SemanticValue, E extends SemanticValue = SemanticValue> = {
    readonly effect_id: string;
    readonly intent_ref: string;
    readonly kind: K;
    readonly outcome_version: number;
    readonly phase: (typeof EFFECT_PHASES)["outcome"];
    readonly result: EffectResult<V, E>;
};
```

### `EffectResult`

Classification: `type-only`. Kind: `type alias`.

Result accepted by createEffectOutcome.

Signature:

```ts
export type EffectResult<V extends SemanticValue, E extends SemanticValue> = EffectFailure<E> | EffectSuccess<V>;
```

### `EffectReversibility`

Classification: `type-only`. Kind: `type alias`.

Reversibility guarantees attached to an effect before materialization.

Signature:

```ts
export type EffectReversibility = (typeof EFFECT_REVERSIBILITY_TIERS)[number];
```

### `EffectSuccess`

Classification: `type-only`. Kind: `type alias`.

Successful effect materialization result.

Signature:

```ts
export type EffectSuccess<V extends SemanticValue> = {
    readonly ok: true;
    readonly value: V;
};
```

### `EffectiveChild`

Classification: `type-only`. Kind: `type alias`.

One active child and the relation selecting its retained cut.

Signature:

```ts
export type EffectiveChild = {
    readonly execution: Execution;
    readonly relation: ExecutionRelation;
};
```

### `EffectiveHistory`

Classification: `type-only`. Kind: `type alias`.

Disposable effective history projected from root and child trace cuts.

Signature:

```ts
export type EffectiveHistory = {
    readonly children: readonly EffectiveChild[];
    readonly published_records: readonly PublishedRecord[];
    readonly relations: readonly ExecutionRelation[];
    readonly root: Execution;
};
```

### `ExactTaskReference`

Classification: `type-only`. Kind: `type alias`.

Exact selector for one registered task artifact version.

Signature:

```ts
export type ExactTaskReference = {
    readonly taskId: string;
    readonly version: string;
};
```

### `Execution`

Classification: `type-only`. Kind: `type alias`.

Disposable execution value projected from an immutable trace slice.

Signature:

```ts
export type Execution = {
    readonly cut?: Cut;
    readonly error: string | null;
    readonly execution_id: string;
    readonly inputs: Readonly<Record<string, unknown>>;
    readonly outputs: Readonly<Record<string, unknown>>;
    readonly parent_execution_id: string | null;
    readonly started_record_id: RecordId | null;
    readonly status: ExecutionStatus;
    readonly task_ref: string;
    readonly terminal_record_id: RecordId | null;
};
```

### `ExecutionRelation`

Classification: `type-only`. Kind: `type alias`.

Parent-owned relationship transition between two executions.

Signature:

```ts
export type ExecutionRelation = {
    readonly child_cut_id: string | null;
    readonly child_execution_id: string;
    readonly created_record_id: RecordId;
    readonly parent_execution_id: string;
    readonly relation_id: string;
    readonly relation_kind: "abandoned" | "adopted" | "spawned";
};
```

### `ExecutionStatus`

Classification: `type-only`. Kind: `type alias`.

Effective lifecycle state derived for one execution owner.

Signature:

```ts
export type ExecutionStatus = "failed" | "pending" | "running" | "succeeded";
```

### `ExhaustedRunDefinition`

Classification: `type-only`. Kind: `type alias`.

Budget-exhausted terminal definition accepted by createRunOutcome.

Signature:

```ts
export type ExhaustedRunDefinition = {
    readonly reason: string;
    readonly status: (typeof RUN_TERMINAL_STATUSES)[2];
};
```

### `ExhaustedRunOutcome`

Classification: `type-only`. Kind: `type alias`.

Budget-exhausted immutable terminal run value.

Signature:

```ts
export type ExhaustedRunOutcome = {
    readonly reason: string;
    readonly status: (typeof RUN_TERMINAL_STATUSES)[2];
};
```

### `ExternalAnchor`

Classification: `type-only`. Kind: `type alias`.

Visible placeholder for a direct causal parent omitted from a slice.

Signature:

```ts
export type ExternalAnchor = {
    readonly hidden_reason: "outside_slice";
    readonly ref: RecordId;
};
```

### `FailedRunDefinition`

Classification: `type-only`. Kind: `type alias`.

Failed terminal definition accepted by createRunOutcome.

Signature:

```ts
export type FailedRunDefinition = {
    readonly errorType: string;
    readonly message: string;
    readonly retryable?: boolean;
    readonly status: (typeof RUN_TERMINAL_STATUSES)[1];
};
```

### `FailedRunOutcome`

Classification: `type-only`. Kind: `type alias`.

Failed immutable terminal run value.

Signature:

```ts
export type FailedRunOutcome = {
    readonly error_type: string;
    readonly message: string;
    readonly retryable: boolean | null;
    readonly status: (typeof RUN_TERMINAL_STATUSES)[1];
};
```

### `FinishedRunDefinition`

Classification: `type-only`. Kind: `type alias`.

Successful terminal definition accepted by createRunOutcome.

Signature:

```ts
export type FinishedRunDefinition<V extends SemanticValue = SemanticValue> = {
    readonly status: (typeof RUN_TERMINAL_STATUSES)[0];
    readonly value: V;
};
```

### `FinishedRunOutcome`

Classification: `type-only`. Kind: `type alias`.

Successful immutable terminal run value.

Signature:

```ts
export type FinishedRunOutcome<V extends SemanticValue = SemanticValue> = {
    readonly status: (typeof RUN_TERMINAL_STATUSES)[0];
    readonly value: V;
};
```

### `GitAwareCustody`

Classification: `type-only`. Kind: `type alias`.

Public workspace protocol v4 Git-aware custody operations.

Signature:

```ts
export type GitAwareCustody = {
    readonly capture: (binding: WorkspaceBinding) => Promise<GitRetainedOutput | null>;
    readonly discard: (custodyId: string) => Promise<void>;
    readonly open: (custodyId: string) => Promise<GitRetainedOutput>;
    readonly verify: (custodyId: string) => Promise<GitCustodyVerification>;
};
```

### `GitAwareCustodyOptions`

Classification: `type-only`. Kind: `type alias`.

Closed options accepted by createGitAwareCustody.

Signature:

```ts
export type GitAwareCustodyOptions = {
    readonly faultInjection?: WorkspaceCustodyFaultInjection;
    readonly workspaceRoot: string;
};
```

### `GitBasisEvidence`

Classification: `type-only`. Kind: `type alias`.

Immutable Git-aware basis evidence for retained output custody.

Signature:

```ts
export type GitBasisEvidence = {
    readonly basis_id: string;
    readonly binding_id: string;
    readonly head: GitHeadEvidence;
    readonly ignored: GitIgnoredEvidence;
    readonly index: GitIndexEvidence | null;
    readonly mode: WorkspaceAdoptionMode;
    readonly object_pack_id: string | null;
    readonly repository: GitRepositoryIdentity;
    readonly sparse_digest: string;
    readonly world_content_id: string;
};
```

### `GitChangesetInspection`

Classification: `type-only`. Kind: `type alias`.

Authenticated Git-aware projection composed with canonical world inspection.

Signature:

```ts
export type GitChangesetInspection = {
    readonly git_changes: readonly GitChangesetPathChange[];
    readonly inspection_version: number;
    readonly symlink_modes: readonly GitSymlinkModePresentation[];
    readonly world: WorldChangesetInspection;
};
```

### `GitChangesetInspectionOptions`

Classification: `type-only`. Kind: `type alias`.

Closed options accepted by createGitChangesetInspection.

Signature:

```ts
export type GitChangesetInspectionOptions = {
    readonly baseCustodyId: string;
    readonly headCustodyId: string;
    readonly workspaceRoot: string;
};
```

### `GitChangesetNode`

Classification: `type-only`. Kind: `type alias`.

Git-aware path state, including external Gitlink commit citations.

Signature:

```ts
export type GitChangesetNode = WorldChangeNode | {
    readonly commit_oid: string;
    readonly kind: typeof GITLINK_ENTRY_KIND;
    readonly mode: string;
};
```

### `GitChangesetPathChange`

Classification: `type-only`. Kind: `type alias`.

One Git-aware path change projection outside canonical world identity.

Signature:

```ts
export type GitChangesetPathChange = {
    readonly after: GitChangesetNode | null;
    readonly before: GitChangesetNode | null;
    readonly operation: WorldChangeOperation;
    readonly path: string;
};
```

### `GitCustodyError`

Classification: `runtime-and-type`. Kind: `class`.

Raised when Git-aware baseline or retained-output custody is unavailable or inconsistent.

Signature:

```ts
export declare class GitCustodyError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
```

#### `code`

Stable machine-readable Git-custody failure code.

```ts
readonly code: string;
```

#### `constructor`

Creates a Git-aware custody failure.

```ts
constructor(code: string, message: string);
```

Parameter:

- code - Configured machine-readable failure code.

Parameter:

- message - Diagnostic describing the rejected Git state or custody evidence.

### `GitCustodyVerification`

Classification: `type-only`. Kind: `type alias`.

Verification of retained output and the current user Git basis.

Signature:

```ts
export type GitCustodyVerification = {
    readonly basis_moved: boolean;
    readonly output: WorldVerification;
};
```

### `GitHeadEvidence`

Classification: `type-only`. Kind: `type alias`.

Closed canonical Git HEAD evidence captured for one basis.

Signature:

```ts
export type GitHeadEvidence = {
    readonly commit: string | null;
    readonly kind: GitHeadKind;
    readonly ref: string | null;
};
```

### `GitHeadKind`

Classification: `type-only`. Kind: `type alias`.

Configured Git HEAD-state discriminant.

Signature:

```ts
export type GitHeadKind = (typeof GIT_HEAD_KINDS)[number];
```

### `GitIgnoredEvidence`

Classification: `type-only`. Kind: `type alias`.

Auditable ignored-untracked exclusion evidence.

Signature:

```ts
export type GitIgnoredEvidence = {
    readonly digest: string;
    readonly paths: readonly string[];
    readonly sources_digest: string;
};
```

### `GitIndexEntry`

Classification: `type-only`. Kind: `type alias`.

One canonical Git index entry including stage and special flags.

Signature:

```ts
export type GitIndexEntry = {
    readonly assume_unchanged: boolean;
    readonly intent_to_add: boolean;
    readonly mode: string;
    readonly object_id: string;
    readonly path: string;
    readonly skip_worktree: boolean;
    readonly stage: number;
};
```

### `GitIndexEvidence`

Classification: `type-only`. Kind: `type alias`.

Exact and semantic Git index evidence retained for a worktree basis.

Signature:

```ts
export type GitIndexEvidence = {
    readonly entries: readonly GitIndexEntry[];
    readonly receipt_id: string;
};
```

### `GitRepositoryBinding`

Classification: `type-only`. Kind: `type alias`.

Frozen repository-aware authority extending one canonical workspace binding.

Signature:

```ts
export type GitRepositoryBinding = WorkspaceBinding & {
    readonly repository: WorkspaceRepositoryBindingEvidence;
    readonly resource_id: string;
    readonly resource_type: string;
};
```

### `GitRepositoryBindingSet`

Classification: `type-only`. Kind: `type alias`.

Frozen complete repository-binding set for one initialized workspace.

Signature:

```ts
export type GitRepositoryBindingSet = {
    readonly binding_version: number;
    readonly bindings: readonly GitRepositoryBinding[];
    readonly repository_binding_version: number;
    readonly workspace_root: string;
};
```

### `GitRepositoryGrantPlan`

Classification: `type-only`. Kind: `type alias`.

Authenticated exact resource admission plan for one repository-granted task run.

Signature:

```ts
export type GitRepositoryGrantPlan = {
    readonly authority_ceiling: RepositoryGrantProfile;
    readonly enforcement: RetainedWorldEnforcement;
    readonly grants: readonly GitRepositoryGrantPlanEntry[];
    readonly grant_plan_version: number;
    readonly plan_id: string;
    readonly task_artifact_digest: string;
    readonly task_grant_artifact_digest: string;
};
```

### `GitRepositoryGrantPlanEntry`

Classification: `type-only`. Kind: `type alias`.

One admitted repository resource and its non-amplifying effective authority.

Signature:

```ts
export type GitRepositoryGrantPlanEntry = {
    readonly authority: readonly RepositoryGrantAtom[];
    readonly binding_id: string;
    readonly binding_name: string;
    readonly resource_id: string;
    readonly task_profile: RepositoryGrantProfile;
};
```

### `GitRepositoryGrantPlanOptions`

Classification: `type-only`. Kind: `type alias`.

Closed options accepted by createGitRepositoryGrantPlan.

Signature:

```ts
export type GitRepositoryGrantPlanOptions<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>> = {
    readonly authorityCeiling: RepositoryGrantProfile;
    readonly bindings: readonly GitRepositoryBinding[];
    readonly task: RepositoryGrantedTask<I, O>;
};
```

### `GitRepositoryIdentity`

Classification: `type-only`. Kind: `type alias`.

Stable local repository and worktree authority evidence.

Signature:

```ts
export type GitRepositoryIdentity = {
    readonly bare: boolean;
    readonly common_dir: string;
    readonly common_dir_identity: string;
    readonly git_dir: string;
    readonly git_version: string;
    readonly object_format: string;
    readonly repository_id: string;
    readonly root: string;
    readonly worktree_id: string;
};
```

### `GitRetainedOutput`

Classification: `type-only`. Kind: `type alias`.

One restart-safe retained output fork bound to an exact Git basis.

Signature:

```ts
export type GitRetainedOutput = {
    readonly basis: GitBasisEvidence;
    readonly custody: WorldCustody;
    readonly git_custody_version: number;
    readonly revision: WorldRevision;
};
```

### `GitSymlinkModePresentation`

Classification: `type-only`. Kind: `type alias`.

Git symbolic-link mode presentation retained outside canonical world identity.

Signature:

```ts
export type GitSymlinkModePresentation = {
    readonly before_mode: string | null;
    readonly after_mode: string | null;
    readonly path: string;
};
```

### `GrantTaskRepositoriesOptions`

Classification: `type-only`. Kind: `type alias`.

Closed options accepted by grantTaskRepositories.

Signature:

```ts
export type GrantTaskRepositoriesOptions<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>> = {
    readonly grants: readonly RepositoryTaskGrantDefinition[];
    readonly task: TaskDescriptor<I, O>;
};
```

### `GrantedPlacementResolution`

Classification: `type-only`. Kind: `type alias`.

Immutable content-addressed placement resolution for one exact granted run capture.

Signature:

```ts
export type GrantedPlacementResolution = {
    readonly capture_id: string;
    readonly compatibility_version: string;
    readonly enforcement: RetainedWorldEnforcement;
    readonly platform: PlacementPlatformEvidence;
    readonly placement_version: number;
    readonly reason: PlacementResolutionReason;
    readonly repository_grant_plan_id: string;
    readonly requested_placement: PlacementRequest;
    readonly resolution_id: string;
    readonly resolved_placement: ResolvedPlacement;
    readonly run_id: string;
    readonly runner_id: string;
    readonly status: PlacementResolutionStatus;
    readonly task_artifact_digest: string;
};
```

### `GrantedPlacementResolutionOptions`

Classification: `type-only`. Kind: `type alias`.

Closed options accepted by createGrantedPlacementResolution.

Signature:

```ts
export type GrantedPlacementResolutionOptions<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>> = {
    readonly captureId: string;
    readonly placement: PlacementRequest;
    readonly platform: PlacementPlatformEvidence;
    readonly repositoryGrantPlan: GitRepositoryGrantPlan;
    readonly runId: string;
    readonly runner: RetainedWorldRunner<I, O>;
};
```

### `InferTaskSchema`

Classification: `type-only`. Kind: `type alias`.

Infers the validated value type represented by a task schema.

Signature:

```ts
export type InferTaskSchema<S extends TaskSchema<unknown>> = S extends TaskSchema<infer T> ? T : never;
```

### `InferTaskSchemaShape`

Classification: `type-only`. Kind: `type alias`.

Value inferred from a task object-schema shape.

Signature:

```ts
export type InferTaskSchemaShape<S extends TaskSchemaShape> = {
    readonly [K in keyof S]: InferTaskSchema<S[K]>;
};
```

### `InspectRetainedWorldApplicationConflictsOptions`

Classification: `type-only`. Kind: `type alias`.

Closed options accepted by inspectRetainedWorldApplicationConflicts.

Signature:

```ts
export type InspectRetainedWorldApplicationConflictsOptions = {
    readonly candidatePaths: readonly string[];
    readonly currentPaths: readonly string[];
};
```

### `JailedTaskWorldCaptureResult`

Classification: `type-only`. Kind: `type alias`.

Durable native-jailed task result with exact process and placement evidence.

Signature:

```ts
export type JailedTaskWorldCaptureResult = TaskWorldCaptureResult & {
    readonly placement: NativeJailPlacementResolution;
    readonly process: NativeJailLaunchReceipt;
};
```

### `KERNEL_ABI_VERSION`

Classification: `runtime-only`. Kind: `variable`.

The frozen Shepherd kernel ABI implemented by this package.

Signature:

```ts
export declare const KERNEL_ABI_VERSION: string;
```

### `KERNEL_CANONICAL_VERSION`

Classification: `runtime-only`. Kind: `variable`.

The domain-separated canonical digest version used for record identity.

Signature:

```ts
export declare const KERNEL_CANONICAL_VERSION: string;
```

### `LedgerListOptions`

Classification: `type-only`. Kind: `type alias`.

Closed bounded pagination options for task/run ledger lists.

Signature:

```ts
export type LedgerListOptions = {
    readonly limit?: number;
    readonly offset?: number;
};
```

### `LedgerSelectorAmbiguousError`

Classification: `runtime-and-type`. Kind: `class`.

Raised when one read selector matches more than one ledger entry.

Signature:

```ts
export declare class LedgerSelectorAmbiguousError extends Error {
    readonly code: string;
    constructor(message: string, code?: string);
}
```

#### `code`

Stable machine-readable selector ambiguity code.

```ts
readonly code: string;
```

#### `constructor`



```ts
constructor(message: string, code?: string);
```

Parameter:

- message - Technical selector ambiguity description.

Parameter:

- code - Stable machine-readable ambiguity code.

### `LedgerSelectorNotFoundError`

Classification: `runtime-and-type`. Kind: `class`.

Raised when one valid read selector matches no ledger entry.

Signature:

```ts
export declare class LedgerSelectorNotFoundError extends Error {
    readonly code: string;
    constructor(message: string, code?: string);
}
```

#### `code`

Stable machine-readable missing-selector code.

```ts
readonly code: string;
```

#### `constructor`



```ts
constructor(message: string, code?: string);
```

Parameter:

- message - Technical missing-selector description.

Parameter:

- code - Stable machine-readable missing-selector code.

### `ModeFilter`

Classification: `type-only`. Kind: `type alias`.

Configured record-mode selection applied to traversal records.

Signature:

```ts
export type ModeFilter = "both" | "captures_only" | "declarations_only";
```

### `ModelArtifactDefinition`

Classification: `type-only`. Kind: `type alias`.

One side-channel artifact emitted with a provider response.

Signature:

```ts
export type ModelArtifactDefinition = {
    readonly content: RunArtifactContentDefinition;
    readonly kind: string;
    readonly metadata: SemanticRecord;
    readonly name: string;
};
```

### `ModelProvider`

Classification: `type-only`. Kind: `type alias`.

Provider-neutral structured invocation boundary.

Signature:

```ts
export type ModelProvider = {
    readonly descriptor: () => ProviderDescriptor;
    readonly invoke: (request: ModelRequest, signal: AbortSignal) => Promise<ModelResponse>;
};
```

### `ModelRequest`

Classification: `type-only`. Kind: `type alias`.

Provider-neutral request for one structured model invocation.

Signature:

```ts
export type ModelRequest = {
    readonly input: SemanticValue;
    readonly instruction: string;
    readonly outputSchema: SemanticRecord;
};
```

### `ModelResponse`

Classification: `type-only`. Kind: `type alias`.

Provider-neutral response from one structured model invocation.

Signature:

```ts
export type ModelResponse = {
    readonly artifacts?: readonly ModelArtifactDefinition[];
    readonly output: SemanticValue;
    readonly usage: ModelUsage;
};
```

### `ModelUsage`

Classification: `type-only`. Kind: `type alias`.

Usage measured for one provider invocation.

Signature:

```ts
export type ModelUsage = {
    readonly cacheCreationInputTokens: number;
    readonly cacheReadInputTokens: number;
    readonly costUsd: number | null;
    readonly inputTokens: number;
    readonly outputTokens: number;
};
```

### `NATIVE_JAIL_BACKENDS`

Classification: `runtime-only`. Kind: `variable`.

Configured native syscall-jail backend names.

Signature:

```ts
export declare const NATIVE_JAIL_BACKENDS: readonly [
    "seatbelt",
    "landlock"
];
```

### `NATIVE_JAIL_PLACEMENT_REASONS`

Classification: `runtime-only`. Kind: `variable`.

Configured successful native-jail placement reasons.

Signature:

```ts
export declare const NATIVE_JAIL_PLACEMENT_REASONS: readonly [
    "requested-native-jail",
    "auto-selected-native-jail"
];
```

### `NATIVE_JAIL_PROBE_REASONS`

Classification: `runtime-only`. Kind: `variable`.

Configured native-jail backend probe reasons.

Signature:

```ts
export declare const NATIVE_JAIL_PROBE_REASONS: readonly [
    "probe-succeeded",
    "platform-unsupported",
    "backend-executable-unavailable",
    "helper-compiler-unavailable",
    "helper-integrity-failed",
    "native-denial-failed",
    "native-write-failed",
    "native-probe-error"
];
```

### `NATIVE_JAIL_PROBE_STATUSES`

Classification: `runtime-only`. Kind: `variable`.

Configured native-jail backend probe statuses.

Signature:

```ts
export declare const NATIVE_JAIL_PROBE_STATUSES: readonly [
    "available",
    "unavailable"
];
```

### `NATIVE_JAIL_PROCESS_STATUSES`

Classification: `runtime-only`. Kind: `variable`.

Configured native judged-process terminal statuses.

Signature:

```ts
export declare const NATIVE_JAIL_PROCESS_STATUSES: readonly [
    "exited",
    "cancelled",
    "timed-out",
    "output-limit",
    "launch-failed",
    "quiescence-uncertain"
];
```

### `NATIVE_JAIL_QUIESCENCE_STATUSES`

Classification: `runtime-only`. Kind: `variable`.

Configured native process-group quiescence statuses.

Signature:

```ts
export declare const NATIVE_JAIL_QUIESCENCE_STATUSES: readonly [
    "proven",
    "uncertain"
];
```

### `NativeJailBackendDescriptor`

Classification: `type-only`. Kind: `type alias`.

Immutable configured descriptor for one native syscall-jail backend.

Signature:

```ts
export type NativeJailBackendDescriptor = {
    readonly backend_id: string;
    readonly backend_version: number;
    readonly compatibility_version: string;
    readonly environments: readonly PlacementEnvironment[];
    readonly enforcement: RetainedWorldEnforcement;
    readonly executable: string | null;
    readonly family: PlacementPlatformFamily;
    readonly node_platforms: readonly string[];
    readonly name: NativeJailBackendName;
    readonly profile_argument: string | null;
};
```

### `NativeJailBackendName`

Classification: `type-only`. Kind: `type alias`.

One configured native syscall-jail backend name.

Signature:

```ts
export type NativeJailBackendName = (typeof NATIVE_JAIL_BACKENDS)[number];
```

### `NativeJailBackendProbeEvidence`

Classification: `type-only`. Kind: `type alias`.

Immutable result of one real local native-jail capability probe.

Signature:

```ts
export type NativeJailBackendProbeEvidence = {
    readonly backend: NativeJailBackendDescriptor | null;
    readonly compatibility_version: string;
    readonly denied_write: boolean;
    readonly enforcement: RetainedWorldEnforcement;
    readonly granted_write: boolean;
    readonly helper_digest: string | null;
    readonly platform: PlacementPlatformEvidence;
    readonly probe_id: string;
    readonly reason: NativeJailProbeReason;
    readonly status: NativeJailProbeStatus;
    readonly probe_version: number;
};
```

### `NativeJailCommand`

Classification: `type-only`. Kind: `type alias`.

Immutable content-addressed native jailed command descriptor.

Signature:

```ts
export type NativeJailCommand = {
    readonly arguments: readonly string[];
    readonly command_id: string;
    readonly command_version: number;
    readonly environment: readonly NativeJailEnvironmentEntry[];
    readonly executable: string;
};
```

### `NativeJailCommandDefinition`

Classification: `type-only`. Kind: `type alias`.

Closed structured command definition accepted by createNativeJailRunner.

Signature:

```ts
export type NativeJailCommandDefinition = {
    readonly arguments: readonly string[];
    readonly environment: readonly NativeJailEnvironmentEntry[];
    readonly executable: string;
};
```

### `NativeJailConfinementPlan`

Classification: `type-only`. Kind: `type alias`.

Immutable content-addressed native confinement plan for one isolated custody.

Signature:

```ts
export type NativeJailConfinementPlan = {
    readonly backend_id: string;
    readonly command_id: string;
    readonly compatibility_version: string;
    readonly custody_root: string;
    readonly enforcement: RetainedWorldEnforcement;
    readonly plan_id: string;
    readonly plan_version: number;
    readonly profile_digest: string;
    readonly probe_id: string;
    readonly writable_roots: readonly string[];
};
```

### `NativeJailEnvironmentEntry`

Classification: `type-only`. Kind: `type alias`.

One explicit environment entry supplied to a native jailed command.

Signature:

```ts
export type NativeJailEnvironmentEntry = {
    readonly name: string;
    readonly value: string;
};
```

### `NativeJailExecutionError`

Classification: `runtime-and-type`. Kind: `class`.

Raised after a native judged process reaches a non-success or uncertain terminal state.

Signature:

```ts
export declare class NativeJailExecutionError extends Error {
    readonly code: string;
    readonly receipt: NativeJailLaunchReceipt;
    constructor(receipt: NativeJailLaunchReceipt);
}
```

#### `code`

Stable configured machine-readable native-execution failure code.

```ts
readonly code: string;
```

#### `receipt`

Exact durable terminal launch receipt.

```ts
readonly receipt: NativeJailLaunchReceipt;
```

#### `constructor`

Creates one fail-closed native process failure.

```ts
constructor(receipt: NativeJailLaunchReceipt);
```

Parameter:

- receipt - Exact terminal process and quiescence evidence.

### `NativeJailLaunchIntent`

Classification: `type-only`. Kind: `type alias`.

Immutable intent retained before one native process may start.

Signature:

```ts
export type NativeJailLaunchIntent = {
    readonly command_id: string;
    readonly launch_id: string;
    readonly plan: NativeJailConfinementPlan;
    readonly plan_id: string;
    readonly runner_id: string;
};
```

### `NativeJailLaunchReceipt`

Classification: `type-only`. Kind: `type alias`.

Immutable durable result of one native judged-process launch.

Signature:

```ts
export type NativeJailLaunchReceipt = {
    readonly exit_code: number | null;
    readonly launch_id: string;
    readonly process_id: number | null;
    readonly quiescence: NativeJailQuiescenceStatus;
    readonly receipt_id: string;
    readonly receipt_version: number;
    readonly signal: string | null;
    readonly status: NativeJailProcessStatus;
    readonly stderr_base64: string;
    readonly stderr_bytes: number;
    readonly stdout_base64: string;
    readonly stdout_bytes: number;
};
```

### `NativeJailPlacementReason`

Classification: `type-only`. Kind: `type alias`.

One configured successful native-jail placement reason.

Signature:

```ts
export type NativeJailPlacementReason = (typeof NATIVE_JAIL_PLACEMENT_REASONS)[number];
```

### `NativeJailPlacementResolution`

Classification: `type-only`. Kind: `type alias`.

Immutable content-addressed native-jail placement resolution.

Signature:

```ts
export type NativeJailPlacementResolution = {
    readonly backend: NativeJailBackendDescriptor;
    readonly backend_probe: NativeJailBackendProbeEvidence;
    readonly capture_id: string;
    readonly command: NativeJailCommand;
    readonly compatibility_version: string;
    readonly enforcement: RetainedWorldEnforcement;
    readonly placement_version: number;
    readonly max_output_bytes: number;
    readonly reason: NativeJailPlacementReason;
    readonly repository_grant_plan_id: string;
    readonly requested_placement: "auto" | "jail";
    readonly resolution_id: string;
    readonly resolved_placement: "jail";
    readonly run_id: string;
    readonly runner_id: string;
    readonly status: "resolved";
    readonly task_artifact_digest: string;
    readonly timeout_milliseconds: number;
};
```

### `NativeJailPlacementResolutionOptions`

Classification: `type-only`. Kind: `type alias`.

Closed options accepted by createNativeJailPlacementResolution.

Signature:

```ts
export type NativeJailPlacementResolutionOptions<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>> = {
    readonly captureId: string;
    readonly placement: "auto" | "jail";
    readonly platform: PlacementPlatformEvidence;
    readonly repositoryGrantPlan: GitRepositoryGrantPlan;
    readonly runId: string;
    readonly runner: NativeJailRunner<I, O>;
};
```

### `NativeJailProbeReason`

Classification: `type-only`. Kind: `type alias`.

One configured native-jail probe reason.

Signature:

```ts
export type NativeJailProbeReason = (typeof NATIVE_JAIL_PROBE_REASONS)[number];
```

### `NativeJailProbeStatus`

Classification: `type-only`. Kind: `type alias`.

One configured native-jail probe status.

Signature:

```ts
export type NativeJailProbeStatus = (typeof NATIVE_JAIL_PROBE_STATUSES)[number];
```

### `NativeJailProcessStarted`

Classification: `type-only`. Kind: `type alias`.

Immutable evidence retained after the native process actually starts.

Signature:

```ts
export type NativeJailProcessStarted = {
    readonly launch_id: string;
    readonly process_id: number;
    readonly start_id: string;
};
```

### `NativeJailProcessStatus`

Classification: `type-only`. Kind: `type alias`.

One configured native judged-process terminal status.

Signature:

```ts
export type NativeJailProcessStatus = (typeof NATIVE_JAIL_PROCESS_STATUSES)[number];
```

### `NativeJailQuiescenceStatus`

Classification: `type-only`. Kind: `type alias`.

One configured process-group quiescence classification.

Signature:

```ts
export type NativeJailQuiescenceStatus = (typeof NATIVE_JAIL_QUIESCENCE_STATUSES)[number];
```

### `NativeJailRunner`

Classification: `type-only`. Kind: `type alias`.

Opaque authenticated native-jail runner handle.

Signature:

```ts
export type NativeJailRunner<I extends TaskSchema<unknown> = TaskSchema<unknown>, O extends TaskSchema<unknown> = TaskSchema<unknown>> = RetainedWorldRunner<I, O>;
```

### `NativeJailRunnerDefinition`

Classification: `type-only`. Kind: `type alias`.

Closed definition accepted by createNativeJailRunner.

Signature:

```ts
export type NativeJailRunnerDefinition = {
    readonly command: NativeJailCommandDefinition;
    readonly maxOutputBytes: number;
    readonly probe: NativeJailBackendProbeEvidence;
    readonly runnerId: string;
    readonly timeoutMilliseconds: number;
};
```

### `NativeJailUnavailableError`

Classification: `runtime-and-type`. Kind: `class`.

Raised when native-jail runner admission lacks a successful authenticated host probe.

Signature:

```ts
export declare class NativeJailUnavailableError extends TypeError {
    readonly code: string;
    readonly evidence: NativeJailBackendProbeEvidence;
    constructor(evidence: NativeJailBackendProbeEvidence);
}
```

#### `code`

Stable configured machine-readable unavailable-native-jail code.

```ts
readonly code: string;
```

#### `evidence`

Exact authenticated unavailable backend probe.

```ts
readonly evidence: NativeJailBackendProbeEvidence;
```

#### `constructor`

Creates one fail-closed native-jail refusal.

```ts
constructor(evidence: NativeJailBackendProbeEvidence);
```

Parameter:

- evidence - Exact unavailable local backend probe.

### `ORPHAN_REPAIR_BLOCKERS`

Classification: `runtime-only`. Kind: `variable`.

Configured stable blockers for bookkeeping-only orphan repair.

Signature:

```ts
export declare const ORPHAN_REPAIR_BLOCKERS: {
    readonly liveSession: "live_session";
    readonly providerStarted: "provider_call_started";
    readonly scopeOwned: "scope_owned";
};
```

### `ORPHAN_REPAIR_ERROR_CODES`

Classification: `runtime-only`. Kind: `variable`.

Configured orphan-repair error codes.

Signature:

```ts
export declare const ORPHAN_REPAIR_ERROR_CODES: {
    readonly blocked: "ORPHAN_REPAIR_BLOCKED";
    readonly commandConflict: "ORPHAN_REPAIR_COMMAND_CONFLICT";
    readonly corrupt: "ORPHAN_REPAIR_CORRUPT";
    readonly stale: "ORPHAN_REPAIR_STALE_BASIS";
    readonly unsupported: "ORPHAN_REPAIR_UNSUPPORTED_VERSION";
};
```

### `ORPHAN_REPAIR_LIMITS`

Classification: `runtime-only`. Kind: `variable`.

Configured orphaned-operation diagnosis and repair resource bounds.

Signature:

```ts
export declare const ORPHAN_REPAIR_LIMITS: {
    readonly defaultPageSize: 50;
    readonly maxCanonicalBytes: 1048576;
    readonly maxCauseBytes: 4096;
    readonly maxIdentifierBytes: 512;
    readonly maxOperations: 100;
    readonly maxPageSize: 100;
};
```

### `ORPHAN_REPAIR_PRE_RUN_STATUSES`

Classification: `runtime-only`. Kind: `variable`.

Configured fail-soft pre-run reclaim statuses.

Signature:

```ts
export declare const ORPHAN_REPAIR_PRE_RUN_STATUSES: {
    readonly declined: "declined";
    readonly repaired: "repaired";
};
```

### `ORPHAN_REPAIR_SESSION_STATUSES`

Classification: `runtime-only`. Kind: `variable`.

Configured session-liveness diagnosis statuses.

Signature:

```ts
export declare const ORPHAN_REPAIR_SESSION_STATUSES: {
    readonly dead: "dead";
    readonly live: "live";
};
```

### `ORPHAN_REPAIR_VERSIONS`

Classification: `runtime-only`. Kind: `variable`.

Configured orphan diagnosis, command, operation, and receipt versions.

Signature:

```ts
export declare const ORPHAN_REPAIR_VERSIONS: {
    readonly command: 1;
    readonly diagnosis: 1;
    readonly operation: 1;
    readonly receipt: 1;
};
```

### `OperationBookkeepingDefinition`

Classification: `type-only`. Kind: `type alias`.

Exact bookkeeping retained while one reversible runtime operation is open.

Signature:

```ts
export type OperationBookkeepingDefinition = {
    readonly cause_record_id: RecordId | null;
    readonly retained_cause: string;
    readonly operation_version: number;
    readonly operation_id: string;
    readonly provider_call_started: boolean;
    readonly owner_id: string;
    readonly session_id: string;
    readonly scope_id: string | null;
    readonly scope_owned: boolean;
};
```

### `OperationSessionDeathEvidence`

Classification: `type-only`. Kind: `type alias`.

Durable proof supplied after an external session-liveness authority proves a session dead.

Signature:

```ts
export type OperationSessionDeathEvidence = {
    readonly death_evidence_id: string;
    readonly session_id: string;
};
```

### `OrphanOperationDiagnosis`

Classification: `type-only`. Kind: `type alias`.

One immutable diagnosed open-operation entry.

Signature:

```ts
export type OrphanOperationDiagnosis = OperationBookkeepingDefinition & {
    readonly blockers: readonly OrphanRepairBlocker[];
    readonly death_evidence_id: string | null;
    readonly repairable: boolean;
    readonly session_status: (typeof ORPHAN_REPAIR_SESSION_STATUSES)[keyof typeof ORPHAN_REPAIR_SESSION_STATUSES];
};
```

### `OrphanOperationDiagnosisOptions`

Classification: `type-only`. Kind: `type alias`.

Pagination options for read-only orphaned-operation diagnosis.

Signature:

```ts
export type OrphanOperationDiagnosisOptions = {
    readonly limit?: number;
    readonly offset?: number;
};
```

### `OrphanOperationDiagnosisReport`

Classification: `type-only`. Kind: `type alias`.

Bounded immutable diagnosis of every retained open operation.

Signature:

```ts
export type OrphanOperationDiagnosisReport = {
    readonly basis_id: string;
    readonly blocked_count: number;
    readonly diagnosis_version: number;
    readonly limit: number;
    readonly offset: number;
    readonly operations: readonly OrphanOperationDiagnosis[];
    readonly repairable_count: number;
    readonly total_count: number;
};
```

### `OrphanPreRunReclaimResult`

Classification: `type-only`. Kind: `type alias`.

Fail-soft pre-run reclaim result that always preserves a manual diagnosis.

Signature:

```ts
export type OrphanPreRunReclaimResult = {
    readonly diagnosis: OrphanOperationDiagnosisReport;
    readonly receipt: OrphanRepairReceipt;
    readonly status: (typeof ORPHAN_REPAIR_PRE_RUN_STATUSES)["repaired"];
} | {
    readonly diagnosis: OrphanOperationDiagnosisReport | null;
    readonly error_code: OrphanRepairErrorCode;
    readonly status: (typeof ORPHAN_REPAIR_PRE_RUN_STATUSES)["declined"];
};
```

### `OrphanRepairBlocker`

Classification: `type-only`. Kind: `type alias`.

Stable configured reason why orphan bookkeeping cannot be repaired.

Signature:

```ts
export type OrphanRepairBlocker = (typeof ORPHAN_REPAIR_BLOCKERS)[keyof typeof ORPHAN_REPAIR_BLOCKERS];
```

### `OrphanRepairCommand`

Classification: `type-only`. Kind: `type alias`.

Globally idempotent exact command authorizing one bookkeeping-only repair.

Signature:

```ts
export type OrphanRepairCommand = {
    readonly basis_id: string;
    readonly command_id: string;
    readonly command_version: number;
    readonly operation_ids: readonly string[];
};
```

### `OrphanRepairError`

Classification: `runtime-and-type`. Kind: `class`.

Stable failure raised by explicit orphaned-operation repair.

Signature:

```ts
export declare class OrphanRepairError extends Error {
    readonly code: OrphanRepairErrorCode;
    constructor(code: OrphanRepairErrorCode, message: string, options?: ErrorOptions);
}
```

#### `code`

Stable configured machine-readable failure code.

```ts
readonly code: OrphanRepairErrorCode;
```

#### `constructor`

Creates one typed repair failure.

```ts
constructor(code: OrphanRepairErrorCode, message: string, options?: ErrorOptions);
```

Parameter:

- code - Stable configured machine-readable failure code.

Parameter:

- message - Safe configured remediation message.

Parameter:

- options - Optional standard error cause.

### `OrphanRepairErrorCode`

Classification: `type-only`. Kind: `type alias`.

Stable configured explicit-repair failure code.

Signature:

```ts
export type OrphanRepairErrorCode = (typeof ORPHAN_REPAIR_ERROR_CODES)[keyof typeof ORPHAN_REPAIR_ERROR_CODES];
```

### `OrphanRepairPreparation`

Classification: `type-only`. Kind: `type alias`.

Durable prepared command evidence retained before bookkeeping mutation.

Signature:

```ts
export type OrphanRepairPreparation = {
    readonly command: OrphanRepairCommand;
    readonly command_record_id: RecordId;
};
```

### `OrphanRepairReceipt`

Classification: `type-only`. Kind: `type alias`.

Canonical successful or empty bookkeeping-repair receipt.

Signature:

```ts
export type OrphanRepairReceipt = {
    readonly basis_id: string;
    readonly command_id: string;
    readonly command_record_id: RecordId;
    readonly operation_ids: readonly string[];
    readonly repaired_count: number;
    readonly receipt_id: string;
    readonly receipt_record_id: RecordId;
    readonly receipt_version: number;
};
```

### `OutputCitationEntry`

Classification: `type-only`. Kind: `type alias`.

Immutable cut-bounded retained-world output citation projection.

Signature:

```ts
export type OutputCitationEntry = {
    readonly compatibility_version: string;
    readonly output: RetainedWorldOutput;
    readonly output_citation_version: number;
    readonly run_created_record_id: string;
    readonly run_id: string;
    readonly settlements: readonly DurableTaskExecutionSettlementInspection[];
    readonly task_artifact_lock: TaskArtifactLock;
    readonly world_capture: TaskWorldCaptureJournalInspection;
};
```

### `OwnerOrdinal`

Classification: `type-only`. Kind: `type alias`.

Configured-floor position of a retained record on an owner path.

Signature:

```ts
export type OwnerOrdinal = number;
```

### `OwnerRecord`

Classification: `type-only`. Kind: `type alias`.

Read result for one owner-local record occurrence.

Signature:

```ts
export type OwnerRecord = PlannedRecord;
```

### `PLACEMENT_ENVIRONMENTS`

Classification: `runtime-only`. Kind: `variable`.

Configured execution-environment classifications used by placement evidence.

Signature:

```ts
export declare const PLACEMENT_ENVIRONMENTS: readonly [
    "native",
    "wsl",
    "unsupported"
];
```

### `PLACEMENT_PLATFORM_FAMILIES`

Classification: `runtime-only`. Kind: `variable`.

Configured platform-family classifications used by placement evidence.

Signature:

```ts
export declare const PLACEMENT_PLATFORM_FAMILIES: readonly [
    "macos",
    "linux",
    "windows",
    "unsupported"
];
```

### `PLACEMENT_REQUESTS`

Classification: `runtime-only`. Kind: `variable`.

Configured requested placement vocabulary.

Signature:

```ts
export declare const PLACEMENT_REQUESTS: readonly [
    "advisory",
    "auto",
    "jail"
];
```

### `PLACEMENT_RESOLUTION_REASONS`

Classification: `runtime-only`. Kind: `variable`.

Configured placement-resolution reasons.

Signature:

```ts
export declare const PLACEMENT_RESOLUTION_REASONS: readonly [
    "requested-advisory",
    "auto-fallback-unavailable",
    "explicit-jail-unavailable"
];
```

### `PLACEMENT_RESOLUTION_STATUSES`

Classification: `runtime-only`. Kind: `variable`.

Configured placement resolved/refused statuses.

Signature:

```ts
export declare const PLACEMENT_RESOLUTION_STATUSES: readonly [
    "resolved",
    "refused"
];
```

### `PinnedTheoremArtifactEvidence`

Classification: `type-only`. Kind: `type alias`.

Pinned metadata declaration for an external theorem artifact.

Signature:

```ts
export type PinnedTheoremArtifactEvidence = {
    readonly authority: string;
    readonly build_gate: string;
    readonly extension_theorem_ids: readonly string[];
    readonly metadata_ref: string;
    readonly revision: string;
    readonly schema_version: string;
    readonly theorem_ids: readonly string[];
};
```

### `PlacedTaskWorldCaptureResult`

Classification: `type-only`. Kind: `type alias`.

Durable placed task result paired with exact placement and retained-world evidence.

Signature:

```ts
export type PlacedTaskWorldCaptureResult = TaskWorldCaptureResult & {
    readonly placement: GrantedPlacementResolution;
};
```

### `PlacementEnvironment`

Classification: `type-only`. Kind: `type alias`.

One configured execution-environment classification.

Signature:

```ts
export type PlacementEnvironment = (typeof PLACEMENT_ENVIRONMENTS)[number];
```

### `PlacementPlatformEvidence`

Classification: `type-only`. Kind: `type alias`.

Immutable content-addressed platform classification used by placement resolution.

Signature:

```ts
export type PlacementPlatformEvidence = {
    readonly compatibility_version: string;
    readonly environment: PlacementEnvironment;
    readonly family: PlacementPlatformFamily;
    readonly node_platform: string;
    readonly os_release: string;
    readonly platform_id: string;
    readonly platform_version: number;
    readonly wsl_markers: readonly string[];
};
```

### `PlacementPlatformEvidenceOptions`

Classification: `type-only`. Kind: `type alias`.

Closed deterministic probe accepted by createPlacementPlatformEvidence.

Signature:

```ts
export type PlacementPlatformEvidenceOptions = {
    readonly environmentVariables: readonly string[];
    readonly nodePlatform: string;
    readonly osRelease: string;
};
```

### `PlacementPlatformFamily`

Classification: `type-only`. Kind: `type alias`.

One configured platform-family classification.

Signature:

```ts
export type PlacementPlatformFamily = (typeof PLACEMENT_PLATFORM_FAMILIES)[number];
```

### `PlacementRefusalEvidence`

Classification: `type-only`. Kind: `type alias`.

Stable public evidence attached to a fail-closed unavailable placement request.

Signature:

```ts
export type PlacementRefusalEvidence = {
    readonly placement_version: number;
    readonly reason: PlacementResolutionReason;
    readonly requested_placement: PlacementRequest;
    readonly status: PlacementResolutionStatus;
};
```

### `PlacementRequest`

Classification: `type-only`. Kind: `type alias`.

One configured per-run placement request.

Signature:

```ts
export type PlacementRequest = (typeof PLACEMENT_REQUESTS)[number];
```

### `PlacementResolutionReason`

Classification: `type-only`. Kind: `type alias`.

One configured placement-resolution reason.

Signature:

```ts
export type PlacementResolutionReason = (typeof PLACEMENT_RESOLUTION_REASONS)[number];
```

### `PlacementResolutionStatus`

Classification: `type-only`. Kind: `type alias`.

One configured placement resolution or refusal status.

Signature:

```ts
export type PlacementResolutionStatus = (typeof PLACEMENT_RESOLUTION_STATUSES)[number];
```

### `PlacementUnavailableError`

Classification: `runtime-and-type`. Kind: `class`.

Raised when an explicit placement request cannot resolve without weakening enforcement.

Signature:

```ts
export declare class PlacementUnavailableError extends TypeError {
    readonly code: string;
    readonly evidence: PlacementRefusalEvidence;
    constructor(evidence: PlacementRefusalEvidence);
}
```

#### `code`

Stable configured machine-readable unavailable-placement code.

```ts
readonly code: string;
```

#### `evidence`

Frozen configured refusal status and reason.

```ts
readonly evidence: PlacementRefusalEvidence;
```

#### `constructor`

Creates one fail-closed placement refusal.

```ts
constructor(evidence: PlacementRefusalEvidence);
```

Parameter:

- evidence - Exact configured request, status, reason, and protocol version.

### `PlannedAppendBatch`

Classification: `type-only`. Kind: `type alias`.

Deterministic result of validating and planning an append batch.

Signature:

```ts
export type PlannedAppendBatch = {
    readonly causal_edges: readonly (readonly [
        RecordId,
        RecordId
    ])[];
    readonly next_owner_ordinals: ReadonlyMap<TraceOwnerId, OwnerOrdinal>;
    readonly owner_ordinal_ranges: ReadonlyMap<TraceOwnerId, readonly [
        OwnerOrdinal,
        OwnerOrdinal
    ]>;
    readonly records: readonly PlannedRecord[];
};
```

### `PlannedRecord`

Classification: `type-only`. Kind: `type alias`.

One planned record with semantic content and path-local placement.

Signature:

```ts
export type PlannedRecord = {
    readonly body: RecordBody;
    readonly envelope: RecordEnvelope;
    readonly view: RecordView;
};
```

### `PrepareRetainedWorldSettlementOptions`

Classification: `type-only`. Kind: `type alias`.

Closed options for authenticated consume-once retained-world settlement admission.

Signature:

```ts
export type PrepareRetainedWorldSettlementOptions = {
    readonly action: (typeof RETAINED_WORLD_SETTLEMENT_ACTIONS)[number];
    readonly binding: WorkspaceBinding;
    readonly carrier: ReferenceCopyCarrier;
    readonly commandId: string;
    readonly output: RetainedWorldOutput;
    readonly store: SQLiteTraceStore;
};
```

### `PreparedRetainedWorldSettlement`

Classification: `type-only`. Kind: `type alias`.

Authenticated prepared settlement decision and its exact closed request.

Signature:

```ts
export type PreparedRetainedWorldSettlement = RetainedWorldSettlementAdmission & {
    readonly request: RetainedWorldSettlementRequest;
};
```

### `ProjectionCompatibilityError`

Classification: `runtime-and-type`. Kind: `class`.

Raised when a trace slice cannot satisfy a projection's declared requirements.

Signature:

```ts
export declare class ProjectionCompatibilityError extends TypeError {
    readonly code: string;
}
```

#### `code`

Stable configured machine-readable projection-compatibility code.

```ts
readonly code: string;
```

### `ProofEnvelope`

Classification: `type-only`. Kind: `type alias`.

Frozen inspectable claim over runtime or executable-reference trace evidence.

Signature:

```ts
export type ProofEnvelope = {
    readonly evidence_id: string | null;
    readonly excluded_runtime_surfaces: readonly string[];
    readonly proof_backed: boolean;
    readonly profile: ProofEnvelopeProfile;
    readonly program_ref: string | null;
    readonly reference_validated: boolean;
    readonly schema_version: string;
    readonly strength: ProofEnvelopeStrength;
    readonly theorem_ids: readonly string[];
    readonly trace_ref: string | null;
    readonly metadata: Readonly<Record<string, SemanticValue>>;
    readonly validator: string;
};
```

### `ProofEnvelopeClassificationOptions`

Classification: `type-only`. Kind: `type alias`.

Untrusted input classified against the executable proof-envelope boundary.

Signature:

```ts
export type ProofEnvelopeClassificationOptions = {
    readonly completed: boolean;
    readonly programRef?: string;
    readonly proofEvidence?: StrongProofEvidence;
    readonly trace: readonly unknown[];
};
```

### `ProofEnvelopeProfile`

Classification: `type-only`. Kind: `type alias`.

Configured Appendix B proof-envelope profile.

Signature:

```ts
export type ProofEnvelopeProfile = (typeof PROOF_ENVELOPE_PROFILES)[number];
```

### `ProofEnvelopeStrength`

Classification: `type-only`. Kind: `type alias`.

Configured Appendix B proof-envelope strength.

Signature:

```ts
export type ProofEnvelopeStrength = (typeof PROOF_ENVELOPE_STRENGTHS)[number];
```

### `ProviderCapabilities`

Classification: `type-only`. Kind: `type alias`.

Provider capabilities visible to provider-neutral execution code.

Signature:

```ts
export type ProviderCapabilities = {
    readonly streaming: boolean;
    readonly structuredOutput: boolean;
    readonly tools: boolean;
};
```

### `ProviderDescriptor`

Classification: `type-only`. Kind: `type alias`.

Immutable identity and capabilities of one model provider.

Signature:

```ts
export type ProviderDescriptor = {
    readonly capabilities: ProviderCapabilities;
    readonly id: string;
    readonly kind: ProviderKind;
    readonly model: string | null;
};
```

### `ProviderKind`

Classification: `type-only`. Kind: `type alias`.

Configured provider-kind vocabulary implemented by provider protocol v1.

Signature:

```ts
export type ProviderKind = (typeof PROVIDER_KINDS)[number];
```

### `PublicError`

Classification: `type-only`. Kind: `type alias`.

Exported error instance with stable machine-readable classification.

Signature:

```ts
export type PublicError = Error & {
    readonly code: PublicErrorCode;
};
```

### `PublicErrorCode`

Classification: `type-only`. Kind: `type alias`.

Stable machine-readable code carried by one exported structured public error.

Signature:

```ts
export type PublicErrorCode = string;
```

### `PublishedRecord`

Classification: `type-only`. Kind: `type alias`.

Parent-published semantic data visible in effective history.

Signature:

```ts
export type PublishedRecord = {
    readonly data: Readonly<Record<string, unknown>>;
    readonly kind: string;
    readonly record_id: RecordId;
};
```

### `RECORD_MODES`

Classification: `runtime-only`. Kind: `variable`.

Record modes supported by the configured kernel ABI.

Signature:

```ts
export declare const RECORD_MODES: readonly [
    "capture",
    "declaration"
];
```

### `REPOSITORY_GRANT_ATOMS`

Classification: `runtime-only`. Kind: `variable`.

Configured repository authority atoms.

Signature:

```ts
export declare const REPOSITORY_GRANT_ATOMS: readonly [
    "read",
    "write"
];
```

### `REPOSITORY_GRANT_PROFILES`

Classification: `runtime-only`. Kind: `variable`.

Configured whole-repository grant profiles.

Signature:

```ts
export declare const REPOSITORY_GRANT_PROFILES: readonly [
    "read-only",
    "read-write"
];
```

### `RESOLVED_PLACEMENTS`

Classification: `runtime-only`. Kind: `variable`.

Configured effective placement vocabulary.

Signature:

```ts
export declare const RESOLVED_PLACEMENTS: readonly [
    "advisory"
];
```

### `RETAINED_WORLD_APPLICATION_CONFLICT_KINDS`

Classification: `runtime-only`. Kind: `variable`.

Configured retained-world application conflict classifications.

Signature:

```ts
export declare const RETAINED_WORLD_APPLICATION_CONFLICT_KINDS: readonly [
    "equal-path",
    "ancestor-descendant",
    "portable-alias"
];
```

### `RETAINED_WORLD_APPLICATION_REASONS`

Classification: `runtime-only`. Kind: `variable`.

Configured retained-world application plan reasons.

Signature:

```ts
export declare const RETAINED_WORLD_APPLICATION_REASONS: readonly [
    "unmoved-parent",
    "path-disjoint"
];
```

### `RETAINED_WORLD_APPLICATION_STATUSES`

Classification: `runtime-only`. Kind: `variable`.

Configured retained-world application plan statuses.

Signature:

```ts
export declare const RETAINED_WORLD_APPLICATION_STATUSES: readonly [
    "planned"
];
```

### `RETAINED_WORLD_MAX_CAPTURE_ID_BYTES`

Classification: `runtime-only`. Kind: `variable`.

Configured maximum UTF-8 bytes for one retained-world capture identity.

Signature:

```ts
export declare const RETAINED_WORLD_MAX_CAPTURE_ID_BYTES: 256;
```

### `RETAINED_WORLD_MAX_TEXT_BYTES`

Classification: `runtime-only`. Kind: `variable`.

Configured maximum UTF-8 bytes for one retained-world text operation.

Signature:

```ts
export declare const RETAINED_WORLD_MAX_TEXT_BYTES: 16777216;
```

### `RETAINED_WORLD_RELEASE_COMPATIBILITY_VERSION`

Classification: `runtime-only`. Kind: `variable`.

Configured receipt-only retained-world release compatibility namespace.

Signature:

```ts
export declare const RETAINED_WORLD_RELEASE_COMPATIBILITY_VERSION: "shepherd.workspace.retained-world-release.v1";
```

### `RETAINED_WORLD_RELEASE_RECEIPT_VERSION`

Classification: `runtime-only`. Kind: `variable`.

Configured receipt-only retained-world release receipt version.

Signature:

```ts
export declare const RETAINED_WORLD_RELEASE_RECEIPT_VERSION: 1;
```

### `RETAINED_WORLD_SELECTION_ATOMICITY_KINDS`

Classification: `runtime-only`. Kind: `variable`.

Configured retained-world selection publication atomicity classifications.

Signature:

```ts
export declare const RETAINED_WORLD_SELECTION_ATOMICITY_KINDS: readonly [
    "journaled-path-set"
];
```

### `RETAINED_WORLD_SELECTION_MAX_STEPS`

Classification: `runtime-only`. Kind: `variable`.

Configured maximum path effects in one retained-world selection publication.

Signature:

```ts
export declare const RETAINED_WORLD_SELECTION_MAX_STEPS: 100000;
```

### `RETAINED_WORLD_SELECTION_PLAN_VERSION`

Classification: `runtime-only`. Kind: `variable`.

Configured retained-world selection plan codec version.

Signature:

```ts
export declare const RETAINED_WORLD_SELECTION_PLAN_VERSION: 1;
```

### `RETAINED_WORLD_SELECTION_PUBLICATION_VERSION`

Classification: `runtime-only`. Kind: `variable`.

Configured retained-world selection publication protocol version.

Signature:

```ts
export declare const RETAINED_WORLD_SELECTION_PUBLICATION_VERSION: 16;
```

### `RETAINED_WORLD_SELECTION_RECEIPT_VERSION`

Classification: `runtime-only`. Kind: `variable`.

Configured retained-world selection publication-receipt codec version.

Signature:

```ts
export declare const RETAINED_WORLD_SELECTION_RECEIPT_VERSION: 1;
```

### `RETAINED_WORLD_SELECTION_SCHEDULED_RECEIPT_VERSION`

Classification: `runtime-only`. Kind: `variable`.

Configured dependency-scheduled terminal publication-receipt codec version.

Signature:

```ts
export declare const RETAINED_WORLD_SELECTION_SCHEDULED_RECEIPT_VERSION: 1;
```

### `RETAINED_WORLD_SELECTION_SCHEDULED_STEP_VERSION`

Classification: `runtime-only`. Kind: `variable`.

Configured dependency-scheduled path-step codec version.

Signature:

```ts
export declare const RETAINED_WORLD_SELECTION_SCHEDULED_STEP_VERSION: 1;
```

### `RETAINED_WORLD_SELECTION_SCHEDULE_KINDS`

Classification: `runtime-only`. Kind: `variable`.

Configured retained-world selection dependency-schedule classifications.

Signature:

```ts
export declare const RETAINED_WORLD_SELECTION_SCHEDULE_KINDS: readonly [
    "dependency-ordered-path-set"
];
```

### `RETAINED_WORLD_SELECTION_SCHEDULE_VERSION`

Classification: `runtime-only`. Kind: `variable`.

Configured retained-world selection dependency-schedule codec version.

Signature:

```ts
export declare const RETAINED_WORLD_SELECTION_SCHEDULE_VERSION: 1;
```

### `RETAINED_WORLD_SELECTION_STEP_STATUSES`

Classification: `runtime-only`. Kind: `variable`.

Configured retained-world selection path-step statuses.

Signature:

```ts
export declare const RETAINED_WORLD_SELECTION_STEP_STATUSES: readonly [
    "applied"
];
```

### `RETAINED_WORLD_SELECTION_STEP_VERSION`

Classification: `runtime-only`. Kind: `variable`.

Configured retained-world selection path-step codec version.

Signature:

```ts
export declare const RETAINED_WORLD_SELECTION_STEP_VERSION: 1;
```

### `RETAINED_WORLD_SETTLEMENT_CITATION_VERSION`

Classification: `runtime-only`. Kind: `variable`.

Configured execution-trace settlement-citation version.

Signature:

```ts
export declare const RETAINED_WORLD_SETTLEMENT_CITATION_VERSION: 1;
```

### `RETAINED_WORLD_SETTLEMENT_OPERATION_VERSION`

Classification: `runtime-only`. Kind: `variable`.

Configured deterministic settlement-operation codec version.

Signature:

```ts
export declare const RETAINED_WORLD_SETTLEMENT_OPERATION_VERSION: 1;
```

### `RETAINED_WORLD_SETTLEMENT_RECEIPT_VERSION`

Classification: `runtime-only`. Kind: `variable`.

Configured deterministic settlement-receipt codec version.

Signature:

```ts
export declare const RETAINED_WORLD_SETTLEMENT_RECEIPT_VERSION: 1;
```

### `RETAINED_WORLD_SETTLEMENT_VERSION`

Classification: `runtime-only`. Kind: `variable`.

Configured public retained-world settlement protocol version.

Signature:

```ts
export declare const RETAINED_WORLD_SETTLEMENT_VERSION: 12;
```

### `ROOT_WITNESS_ID`

Classification: `runtime-only`. Kind: `variable`.

Content-addressed identifier of the configured root witness.

Use this identifier as `witness_ref` until a more specific witness record is
available.

Signature:

```ts
export declare const ROOT_WITNESS_ID: string;
```

### `RecordBody`

Classification: `type-only`. Kind: `type alias`.

A schema-specific semantic payload retained by a record.

Record bodies accept the same plain, canonicalizable values as semantic
records. Storage metadata does not belong in a record body.

Signature:

```ts
export type RecordBody = SemanticRecord;
```

### `RecordEnvelope`

Classification: `type-only`. Kind: `type alias`.

Stable semantic identity and ordered causality for one retained record.

Owner paths, ordinals, receipts, and local timestamps are intentionally
excluded because they do not change record identity.

Signature:

```ts
export type RecordEnvelope = {
    readonly caused_by_record_ids: readonly RecordId[];
    readonly digest: RecordId;
    readonly mode: RecordMode;
    readonly record_id: RecordId;
    readonly schema_ref: string;
    readonly witness_ref: RecordId | "";
};
```

### `RecordEnvelopeDraft`

Classification: `type-only`. Kind: `type alias`.

Semantic input used to create a record envelope.

Signature:

```ts
export type RecordEnvelopeDraft<TBody extends RecordBody = RecordBody> = {
    readonly body: TBody;
    readonly caused_by_record_ids?: readonly RecordId[];
    readonly mode: RecordMode;
    readonly schema_ref: string;
    readonly witness_ref: RecordId | "";
};
```

### `RecordId`

Classification: `type-only`. Kind: `type alias`.

A content-addressed retained-record identifier.

Runtime validation enforces the configured digest prefix and length.

Signature:

```ts
export type RecordId = string;
```

### `RecordMode`

Classification: `type-only`. Kind: `type alias`.

Whether a record declares intended state or captures observed state.

Signature:

```ts
export type RecordMode = (typeof RECORD_MODES)[number];
```

### `RecordShape`

Classification: `type-only`. Kind: `type alias`.

Visibility-filtered record shape without its semantic body.

Signature:

```ts
export type RecordShape = {
    readonly envelope: RecordEnvelope;
    readonly hidden_reason: "payload_hidden";
    readonly view?: RecordView;
};
```

### `RecordView`

Classification: `type-only`. Kind: `type alias`.

Path-local metadata assigned without changing semantic record identity.

Signature:

```ts
export type RecordView = {
    readonly append_intent_id?: string;
    readonly owner_id: TraceOwnerId;
    readonly owner_ordinal: OwnerOrdinal;
};
```

### `RecoverGrantedTaskWorldOptions`

Classification: `type-only`. Kind: `type alias`.

Closed options for exact recovery of repository-granted retained-world execution.

Signature:

```ts
export type RecoverGrantedTaskWorldOptions<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>> = CaptureGrantedTaskWorldOptions<I, O> & {
    readonly commandId: string;
};
```

### `RecoverJailedGrantedTaskWorldOptions`

Classification: `type-only`. Kind: `type alias`.

Closed options for exact recovery of native-jailed granted execution.

Signature:

```ts
export type RecoverJailedGrantedTaskWorldOptions<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>> = CaptureJailedGrantedTaskWorldOptions<I, O> & {
    readonly commandId: string;
};
```

### `RecoverPlacedGrantedTaskWorldOptions`

Classification: `type-only`. Kind: `type alias`.

Closed options for exact recovery of placement-resolved granted execution.

Signature:

```ts
export type RecoverPlacedGrantedTaskWorldOptions<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>> = CapturePlacedGrantedTaskWorldOptions<I, O> & {
    readonly commandId: string;
};
```

### `RecoverTaskWorldOptions`

Classification: `type-only`. Kind: `type alias`.

Closed options for command-authorized recovery of one retained-world task capture.

Signature:

```ts
export type RecoverTaskWorldOptions<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>> = CaptureTaskWorldOptions<I, O> & {
    readonly commandId: string;
};
```

### `RecoveryCommandEvidence`

Classification: `type-only`. Kind: `type alias`.

Validated canonical durable control command retained on one run owner.

Signature:

```ts
export type RecoveryCommandEvidence = {
    readonly command: DurableExecutionCancellationCommand | DurableExecutionInactiveCancellationCommand | DurableExecutionPauseCommand | DurableExecutionRecoveryCommand | DurableExecutionResumeCommand;
    readonly caused_by_record_ids: readonly string[];
    readonly record_id: string;
};
```

### `RecoveryCommandResult`

Classification: `type-only`. Kind: `type alias`.

Bounded retained records directly caused by one exact durable command.

Signature:

```ts
export type RecoveryCommandResult = {
    readonly command_record_id: string;
    readonly effect_record_ids: readonly string[];
};
```

### `RecoveryInvocationClaimEvidence`

Classification: `type-only`. Kind: `type alias`.

Archive-stable canonical claim/fence evidence, or an explicit unavailable classification.

Signature:

```ts
export type RecoveryInvocationClaimEvidence = {
    readonly claim_id: string;
    readonly fencing_token: number;
    readonly record_id: string;
    readonly status: (typeof RUN_CONTINUATION_EVIDENCE_STATUSES)[0];
} | {
    readonly status: (typeof RUN_CONTINUATION_EVIDENCE_STATUSES)[2];
};
```

### `RecoveryRecordEntry`

Classification: `type-only`. Kind: `type alias`.

Immutable bounded durable recovery/control record projection for one run.

Signature:

```ts
export type RecoveryRecordEntry = {
    readonly command_results: readonly RecoveryCommandResult[];
    readonly commands: readonly RecoveryCommandEvidence[];
    readonly compatibility_version: string;
    readonly invocation_claim: RecoveryInvocationClaimEvidence;
    readonly lifecycle: DurableTaskExecutionInspection["lifecycle"];
    readonly lifecycle_head_record_id: string;
    readonly recovery_status: DurableTaskExecutionInspection["status"];
    readonly recovery_record_version: number;
    readonly run_id: string;
};
```

### `ReferenceCopyCarrier`

Classification: `type-only`. Kind: `type alias`.

Public workspace protocol v6 reference copy-carrier operations.

Signature:

```ts
export type ReferenceCopyCarrier = {
    readonly captureCustody: (custodyId: string) => Promise<WorldRevision>;
    readonly discard: (custodyId: string) => Promise<void>;
    readonly fork: (revisionId: string) => Promise<WorldCustody>;
    readonly openCustody: (custodyId: string) => Promise<WorldCustody>;
    readonly openRevision: (revisionId: string) => Promise<WorldRevision>;
    readonly snapshot: (binding: WorkspaceBinding) => Promise<WorldRevision>;
    readonly verifyCustody: (custodyId: string) => Promise<WorldVerification>;
    readonly verifyRevision: (revisionId: string) => Promise<WorldVerification>;
};
```

### `ReferenceCopyCarrierOptions`

Classification: `type-only`. Kind: `type alias`.

Closed options accepted by createReferenceCopyCarrier.

Signature:

```ts
export type ReferenceCopyCarrierOptions = {
    readonly faultInjection?: WorkspaceCustodyFaultInjection;
    readonly workspaceRoot: string;
};
```

### `ReleaseRetainedWorldSettlementOptions`

Classification: `type-only`. Kind: `type alias`.

Closed authorities for exact-ID receipt-only release and recovery.

Signature:

```ts
export type ReleaseRetainedWorldSettlementOptions = {
    readonly binding: WorkspaceBinding;
    readonly carrier: ReferenceCopyCarrier;
    readonly outputId: string;
    readonly store: SQLiteTraceStore;
};
```

### `ReleasedRetainedWorldSettlement`

Classification: `type-only`. Kind: `type alias`.

Durable receipt-only release result preserving the existing retained custody.

Signature:

```ts
export type ReleasedRetainedWorldSettlement = {
    readonly action: (typeof RETAINED_WORLD_SETTLEMENT_ACTIONS)[3];
    readonly base_revision_id: string;
    readonly binding_id: string;
    readonly changeset_id: string;
    readonly compatibility_version: typeof RETAINED_WORLD_RELEASE_COMPATIBILITY_VERSION;
    readonly custody_id: string;
    readonly head_revision_id: string;
    readonly operation_id: string;
    readonly output_id: string;
    readonly request_id: string;
    readonly release_receipt_version: typeof RETAINED_WORLD_RELEASE_RECEIPT_VERSION;
    readonly settlement_version: typeof RETAINED_WORLD_SETTLEMENT_VERSION;
    readonly state: (typeof RETAINED_WORLD_SETTLEMENT_STATES)[5];
    readonly user_basis_after: string;
    readonly user_basis_before: string;
};
```

### `RepositoryGrantAtom`

Classification: `type-only`. Kind: `type alias`.

One configured repository authority atom.

Signature:

```ts
export type RepositoryGrantAtom = (typeof REPOSITORY_GRANT_ATOMS)[number];
```

### `RepositoryGrantProfile`

Classification: `type-only`. Kind: `type alias`.

One configured whole-repository authority profile.

Signature:

```ts
export type RepositoryGrantProfile = (typeof REPOSITORY_GRANT_PROFILES)[number];
```

### `RepositoryGrantedTask`

Classification: `type-only`. Kind: `type alias`.

Authenticated task plus its immutable explicit repository grant surface.

Signature:

```ts
export type RepositoryGrantedTask<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>> = {
    readonly artifact: RepositoryTaskGrantArtifact;
    readonly artifactLock: RepositoryTaskGrantArtifactLock;
    readonly grants: readonly RepositoryTaskGrantDefinition[];
    readonly task: TaskDescriptor<I, O>;
};
```

### `RepositoryTaskGrantArtifact`

Classification: `type-only`. Kind: `type alias`.

Canonical identity-bearing task repository-grant artifact.

Signature:

```ts
export type RepositoryTaskGrantArtifact = {
    readonly compatibility_version: string;
    readonly grant_version: number;
    readonly grants: readonly {
        readonly binding: string;
        readonly profile: RepositoryGrantProfile;
    }[];
    readonly task_artifact_digest: string;
};
```

### `RepositoryTaskGrantArtifactLock`

Classification: `type-only`. Kind: `type alias`.

Exact content-addressed lock for one repository task-grant artifact.

Signature:

```ts
export type RepositoryTaskGrantArtifactLock = {
    readonly artifact_digest: string;
    readonly grant_version: number;
    readonly task_artifact_digest: string;
    readonly task_grant_id: string;
};
```

### `RepositoryTaskGrantDefinition`

Classification: `type-only`. Kind: `type alias`.

One logical per-binding repository grant declared by a task.

Signature:

```ts
export type RepositoryTaskGrantDefinition = {
    readonly binding: string;
    readonly profile: RepositoryGrantProfile;
};
```

### `ResolvedPlacement`

Classification: `type-only`. Kind: `type alias`.

One configured effective placement implemented by the current runtime.

Signature:

```ts
export type ResolvedPlacement = (typeof RESOLVED_PLACEMENTS)[number];
```

### `RetainedRecord`

Classification: `type-only`. Kind: `type alias`.

One semantic record and every retained owner-local occurrence.

Signature:

```ts
export type RetainedRecord = {
    readonly body: RecordBody;
    readonly envelope: RecordEnvelope;
    readonly views: readonly RecordView[];
};
```

### `RetainedWorldApplicationConflict`

Classification: `type-only`. Kind: `type alias`.

One exact candidate/current path pair that prevents three-way application.

Signature:

```ts
export type RetainedWorldApplicationConflict = {
    readonly candidate_path: string;
    readonly current_path: string;
    readonly kind: RetainedWorldApplicationConflictKind;
};
```

### `RetainedWorldApplicationConflictError`

Classification: `runtime-and-type`. Kind: `class`.

Raised when retained and current path effects are not provably disjoint.

Signature:

```ts
export declare class RetainedWorldApplicationConflictError extends Error {
    readonly code: string;
    readonly evidence: RetainedWorldApplicationConflictEvidence;
    constructor(evidence: RetainedWorldApplicationConflictEvidence);
}
```

#### `code`

Stable machine-readable application-conflict code.

```ts
readonly code: string;
```

#### `evidence`

Exact immutable path-overlap evidence.

```ts
readonly evidence: RetainedWorldApplicationConflictEvidence;
```

#### `constructor`

Creates one fail-closed retained-world application conflict.

```ts
constructor(evidence: RetainedWorldApplicationConflictEvidence);
```

Parameter:

- evidence - Exact content-addressed overlap evidence.

### `RetainedWorldApplicationConflictEvidence`

Classification: `type-only`. Kind: `type alias`.

Immutable content-addressed evidence explaining one fail-closed application refusal.

Signature:

```ts
export type RetainedWorldApplicationConflictEvidence = {
    readonly compatibility_version: string;
    readonly conflicts: readonly RetainedWorldApplicationConflict[];
    readonly conflict_id: string;
    readonly conflict_version: number;
};
```

### `RetainedWorldApplicationConflictKind`

Classification: `type-only`. Kind: `type alias`.

One configured retained-world application conflict classification.

Signature:

```ts
export type RetainedWorldApplicationConflictKind = (typeof RETAINED_WORLD_APPLICATION_CONFLICT_KINDS)[number];
```

### `RetainedWorldApplicationPlanEvidence`

Classification: `type-only`. Kind: `type alias`.

Content-addressed three-way application plan retained before user-tree mutation.

Signature:

```ts
export type RetainedWorldApplicationPlanEvidence = {
    readonly application_custody_id: string;
    readonly application_version: number;
    readonly compatibility_version: string;
    readonly base_content_id: string;
    readonly base_revision_id: string;
    readonly binding_id: string;
    readonly candidate_changeset_id: string;
    readonly candidate_content_id: string;
    readonly candidate_paths: readonly string[];
    readonly candidate_revision_id: string;
    readonly current_changeset_id: string;
    readonly current_content_id: string;
    readonly current_paths: readonly string[];
    readonly current_revision_id: string;
    readonly merged_content_id: string;
    readonly merged_revision_id: string;
    readonly plan_id: string;
    readonly publication_changeset_id: string;
    readonly reason: (typeof RETAINED_WORLD_APPLICATION_REASONS)[number];
    readonly request_id: string;
    readonly status: (typeof RETAINED_WORLD_APPLICATION_STATUSES)[number];
};
```

### `RetainedWorldCapability`

Classification: `type-only`. Kind: `type alias`.

Fenced retained-world authority issued only for one runner invocation.

Signature:

```ts
export type RetainedWorldCapability = {
    readonly base_revision_id: string;
    readonly binding_id: string;
    readonly capture_fence: number;
    readonly custody_id: string;
    readonly enforcement: RetainedWorldEnforcement;
    readonly readText: (relativePath: string) => Promise<string>;
    readonly writeText: (relativePath: string, text: string) => Promise<void>;
};
```

### `RetainedWorldEnforcement`

Classification: `type-only`. Kind: `type alias`.

Configured enforcement classification claimed by a retained-world runner.

Signature:

```ts
export type RetainedWorldEnforcement = (typeof RETAINED_WORLD_ENFORCEMENT_KINDS)[number];
```

### `RetainedWorldExecutionContext`

Classification: `type-only`. Kind: `type alias`.

Frozen context supplied to one authenticated retained-world runner invocation.

Signature:

```ts
export type RetainedWorldExecutionContext<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>> = {
    readonly capture_fence: number;
    readonly execution: TaskExecutionOptions<I, O>;
    readonly signal: AbortSignal;
    readonly world: RetainedWorldCapability;
};
```

### `RetainedWorldOutput`

Classification: `type-only`. Kind: `type alias`.

Verified immutable world attachment retained inside one terminal execution cut.

Signature:

```ts
export type RetainedWorldOutput = {
    readonly base_revision_id: string;
    readonly binding_id: string;
    readonly capture_id: string;
    readonly capture_record_id: string;
    readonly custody_id: string;
    readonly changeset_id: string;
    readonly execution_cut: Cut;
    readonly execution_outcome_record_id: string;
    readonly head_revision_id: string;
    readonly output_id: string;
    readonly run_id: string;
    readonly schema_version: number;
    readonly status: (typeof RETAINED_WORLD_OUTPUT_STATUSES)[0];
    readonly user_basis_after: string;
    readonly user_basis_before: string;
};
```

### `RetainedWorldRunner`

Classification: `type-only`. Kind: `type alias`.

Opaque registered handle for one retained-world runner adapter.

Signature:

```ts
export type RetainedWorldRunner<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>> = {
    readonly enforcement: RetainedWorldEnforcement;
    readonly runner_id: string;
    readonly runner_version: number;
    readonly [retainedWorldRunnerContract]?: (context: RetainedWorldExecutionContext<I, O>) => Promise<TaskExecutionResult>;
};
```

### `RetainedWorldRunnerDefinition`

Classification: `type-only`. Kind: `type alias`.

Closed callback definition accepted by createRetainedWorldRunner.

Signature:

```ts
export type RetainedWorldRunnerDefinition<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>> = {
    readonly enforcement: RetainedWorldEnforcement;
    readonly run: (context: RetainedWorldExecutionContext<I, O>) => Promise<TaskExecutionResult>;
    readonly runnerId: string;
};
```

### `RetainedWorldSettlementAdmission`

Classification: `type-only`. Kind: `type alias`.

Durable prepared consume-once settlement decision returned by trace-store admission.

Signature:

```ts
export type RetainedWorldSettlementAdmission = {
    readonly action: (typeof RETAINED_WORLD_SETTLEMENT_ACTIONS)[number];
    readonly command_id: string;
    readonly output_id: string;
    readonly request_id: string;
    readonly request: RetainedWorldSettlementRequest;
    readonly state: (typeof RETAINED_WORLD_SETTLEMENT_STATES)[0];
};
```

### `RetainedWorldSettlementConflictError`

Classification: `runtime-and-type`. Kind: `class`.

Raised when an exact retained-world settlement request conflicts with durable authority.

Signature:

```ts
export declare class RetainedWorldSettlementConflictError extends TraceStoreError {
    readonly code: string;
}
```

#### `code`

Stable configured settlement-conflict code.

```ts
readonly code: string;
```

### `RetainedWorldSettlementInvalidError`

Classification: `runtime-and-type`. Kind: `class`.

Raised when retained-world settlement evidence is malformed or inconsistent.

Signature:

```ts
export declare class RetainedWorldSettlementInvalidError extends TraceStoreError {
    readonly code: string;
}
```

#### `code`

Stable configured invalid-settlement code.

```ts
readonly code: string;
```

### `RetainedWorldSettlementRequest`

Classification: `type-only`. Kind: `type alias`.

Closed exact identity presented to consume-once retained-world settlement admission.

Signature:

```ts
export type RetainedWorldSettlementRequest = {
    readonly action: (typeof RETAINED_WORLD_SETTLEMENT_ACTIONS)[number];
    readonly base_revision_id: string;
    readonly binding_id: string;
    readonly capture_record_id: string;
    readonly changeset_id: string;
    readonly command_id: string;
    readonly custody_id: string;
    readonly execution_cut_id: string;
    readonly head_revision_id: string;
    readonly output_id: string;
    readonly run_id: string;
    readonly settlement_version: number;
    readonly user_basis_before: string;
};
```

### `RunArtifact`

Classification: `type-only`. Kind: `type alias`.

Immutable versioned record for one ordered side-channel run artifact.

Signature:

```ts
export type RunArtifact<C extends RunArtifactContentDefinition = RunArtifactContentDefinition> = {
    readonly artifact_ordinal: number;
    readonly artifact_version: number;
    readonly content: RunArtifactContentFor<C>;
    readonly kind: string;
    readonly metadata: SemanticRecord;
    readonly name: string;
    readonly run_id: string;
};
```

### `RunArtifactContentDefinition`

Classification: `type-only`. Kind: `type alias`.

Content representation accepted by createRunArtifact.

Signature:

```ts
export type RunArtifactContentDefinition = RunBlobArtifactContentDefinition | RunTextArtifactContentDefinition;
```

### `RunArtifactContentFor`

Classification: `type-only`. Kind: `type alias`.

Maps an artifact definition to its exact canonical content representation.

Signature:

```ts
export type RunArtifactContentFor<C extends RunArtifactContentDefinition> = C extends RunTextArtifactContentDefinition ? RunTextArtifactContent : RunBlobArtifactContent;
```

### `RunArtifactDefinition`

Classification: `type-only`. Kind: `type alias`.

Definition accepted by createRunArtifact.

Signature:

```ts
export type RunArtifactDefinition<C extends RunArtifactContentDefinition> = {
    readonly artifactOrdinal: number;
    readonly content: C;
    readonly kind: string;
    readonly metadata: SemanticRecord;
    readonly name: string;
    readonly runId: string;
};
```

### `RunBlobArtifactContent`

Classification: `type-only`. Kind: `type alias`.

Durable binary reference retained by a run artifact record.

Signature:

```ts
export type RunBlobArtifactContent = {
    readonly blob_id: string;
    readonly byte_length: number;
    readonly type: (typeof RUN_ARTIFACT_CONTENT_TYPES)[1];
};
```

### `RunBlobArtifactContentDefinition`

Classification: `type-only`. Kind: `type alias`.

Durable binary content accepted by createRunArtifact.

Signature:

```ts
export type RunBlobArtifactContentDefinition = {
    readonly receipt: BlobStorageReceipt;
    readonly type: (typeof RUN_ARTIFACT_CONTENT_TYPES)[1];
};
```

### `RunBudgetDefinition`

Classification: `type-only`. Kind: `type alias`.

Optional limits applied by createRunControl.

Signature:

```ts
export type RunBudgetDefinition = {
    readonly maxCostUsd?: number;
    readonly maxDurationMilliseconds?: number;
    readonly maxEffects?: number;
    readonly maxInputTokens?: number;
    readonly maxOutputTokens?: number;
    readonly maxTurns?: number;
};
```

### `RunBudgetExhaustedError`

Classification: `runtime-and-type`. Kind: `class`.

Error carried by a run-control signal after budget exhaustion.

Signature:

```ts
export declare class RunBudgetExhaustedError extends Error {
    readonly code: string;
    readonly limit: number;
    readonly metric: RunBudgetExhaustionReason["metric"];
    readonly observed: number;
    constructor(reason: RunBudgetExhaustionReason);
}
```

#### `code`

Stable configured machine-readable budget-exhaustion code.

```ts
readonly code: string;
```

#### `limit`

Configured limit that was exceeded.

```ts
readonly limit: number;
```

#### `metric`

First configured metric that exceeded its limit.

```ts
readonly metric: RunBudgetExhaustionReason["metric"];
```

#### `observed`

Aggregate value observed at exhaustion.

```ts
readonly observed: number;
```

#### `constructor`

Creates an error from a structured exhaustion reason.

```ts
constructor(reason: RunBudgetExhaustionReason);
```

Parameter:

- reason - Exhausted metric, configured limit, and observed aggregate.

### `RunBudgetExhaustionReason`

Classification: `type-only`. Kind: `type alias`.

Structured reason for budget exhaustion.

Signature:

```ts
export type RunBudgetExhaustionReason = {
    readonly limit: number;
    readonly metric: RunBudgetMetric;
    readonly observed: number;
    readonly type: (typeof RUN_CONTROL_REASON_TYPES)[0];
};
```

### `RunBudgetMetric`

Classification: `type-only`. Kind: `type alias`.

Configured metric that can exhaust a run budget.

Signature:

```ts
export type RunBudgetMetric = (typeof RUN_BUDGET_METRICS)[number];
```

### `RunCancellationReason`

Classification: `type-only`. Kind: `type alias`.

Structured reason for external or disposal cancellation.

Signature:

```ts
export type RunCancellationReason = {
    readonly message: string;
    readonly type: (typeof RUN_CONTROL_REASON_TYPES)[1];
};
```

### `RunCancelledError`

Classification: `runtime-and-type`. Kind: `class`.

Error carried by a run-control signal after cancellation.

Signature:

```ts
export declare class RunCancelledError extends Error {
    readonly code: string;
    constructor(message: string, cause?: unknown);
}
```

#### `code`

Stable configured machine-readable cancellation code.

```ts
readonly code: string;
```

#### `constructor`

Creates a stable cancellation error while retaining the caller's reason as its cause.

```ts
constructor(message: string, cause?: unknown);
```

Parameter:

- message - Stable inspectable cancellation explanation.

Parameter:

- cause - Optional original caller-signal reason.

### `RunConsumption`

Classification: `type-only`. Kind: `type alias`.

Aggregate resource consumption observed by a run control.

Signature:

```ts
export type RunConsumption = {
    readonly costUsd: number;
    readonly effects: number;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly turns: number;
};
```

### `RunConsumptionDefinition`

Classification: `type-only`. Kind: `type alias`.

Incremental resource consumption admitted by RunControl.consume.

Signature:

```ts
export type RunConsumptionDefinition = {
    readonly costUsd?: number;
    readonly effects?: number;
    readonly inputTokens?: number;
    readonly outputTokens?: number;
    readonly turns?: number;
};
```

### `RunContinuationCheckpointAdapter`

Classification: `type-only`. Kind: `type alias`.

Adapter for one configured continuation constituent at a proven safe boundary.

Signature:

```ts
export type RunContinuationCheckpointAdapter = {
    readonly kind: (typeof RUN_CONTINUATION_CONSTITUENT_KINDS)[number];
    readonly checkpoint: (context: RunContinuationCheckpointContext) => Promise<RunContinuationCheckpointEvidence>;
};
```

### `RunContinuationCheckpointContext`

Classification: `type-only`. Kind: `type alias`.

Immutable context presented to each continuation checkpoint adapter.

Signature:

```ts
export type RunContinuationCheckpointContext = {
    readonly expected_lifecycle_record_id: RecordId;
    readonly run_id: string;
    readonly trace_cut_id: string;
};
```

### `RunContinuationCheckpointEvidence`

Classification: `type-only`. Kind: `type alias`.

Configured continuation constituent classified by a checkpoint adapter.

Signature:

```ts
export type RunContinuationCheckpointEvidence = {
    readonly kind: (typeof RUN_CONTINUATION_CONSTITUENT_KINDS)[number];
    readonly receipt_id?: string;
    readonly status: (typeof RUN_CONTINUATION_EVIDENCE_STATUSES)[number];
};
```

### `RunContinuationCheckpointOptions`

Classification: `type-only`. Kind: `type alias`.

Options for collecting every configured continuation constituent at a safe boundary.

Signature:

```ts
export type RunContinuationCheckpointOptions = {
    readonly adapters: readonly RunContinuationCheckpointAdapter[];
    readonly expectedLifecycleRecordId: RecordId;
    readonly runId: string;
    readonly traceCutId: string;
};
```

### `RunControl`

Classification: `type-only`. Kind: `type alias`.

Cooperative resource and cancellation control for one run.

Signature:

```ts
export type RunControl = {
    readonly signal: AbortSignal;
    consume(consumption: RunConsumptionDefinition): RunControlSnapshot;
    dispose(): void;
    snapshot(): RunControlSnapshot;
};
```

### `RunControlOptions`

Classification: `type-only`. Kind: `type alias`.

Options accepted by createRunControl.

Signature:

```ts
export type RunControlOptions = {
    readonly budget: RunBudgetDefinition;
    readonly signal?: AbortSignal;
};
```

### `RunControlReason`

Classification: `type-only`. Kind: `type alias`.

One terminal reason retained by a run control snapshot.

Signature:

```ts
export type RunControlReason = RunBudgetExhaustionReason | RunCancellationReason;
```

### `RunControlSnapshot`

Classification: `type-only`. Kind: `type alias`.

Immutable observable state of a run control.

Signature:

```ts
export type RunControlSnapshot = {
    readonly consumed: RunConsumption;
    readonly reason: RunControlReason | null;
    readonly status: RunControlStatus;
};
```

### `RunControlStatus`

Classification: `type-only`. Kind: `type alias`.

Configured lifecycle status of a run control.

Signature:

```ts
export type RunControlStatus = (typeof RUN_CONTROL_STATUSES)[number];
```

### `RunLedgerEntry`

Classification: `type-only`. Kind: `type alias`.

Immutable task/run ledger projection for one durable execution owner.

Signature:

```ts
export type RunLedgerEntry = {
    readonly budget: RunBudgetDefinition;
    readonly created_record_id: string;
    readonly input: SemanticValue;
    readonly compatibility_version: string;
    readonly inspection: DurableTaskExecutionInspection;
    readonly provider: ProviderDescriptor;
    readonly ledger_version: number;
    readonly native_jail_processes: readonly RunLedgerNativeJailProcessEvidence[];
    readonly output: RetainedWorldOutput | null;
    readonly run_id: string;
    readonly task_artifact_lock: TaskArtifactLock;
    readonly world_capture: TaskWorldCaptureJournalInspection;
};
```

### `RunLedgerNativeJailProcessEvidence`

Classification: `type-only`. Kind: `type alias`.

One validated native-jail process intent, start, or receipt retained on a run owner.

Signature:

```ts
export type RunLedgerNativeJailProcessEvidence = {
    readonly body: SemanticRecord;
    readonly record_id: string;
};
```

### `RunLifecycleStatus`

Classification: `type-only`. Kind: `type alias`.

Configured normative run-lifecycle status.

Signature:

```ts
export type RunLifecycleStatus = (typeof RUN_LIFECYCLE_STATUSES)[number];
```

### `RunLifecycleTerminalStatus`

Classification: `type-only`. Kind: `type alias`.

Configured immutable terminal outcome status.

Signature:

```ts
export type RunLifecycleTerminalStatus = (typeof RUN_TERMINAL_STATUSES)[number];
```

### `RunLifecycleTransition`

Classification: `type-only`. Kind: `type alias`.

Validated immutable normative run-lifecycle transition.

Signature:

```ts
export type RunLifecycleTransition = {
    readonly source_status: RunLifecycleStatus;
    readonly target_status: RunLifecycleStatus;
    readonly terminal_status?: RunLifecycleTerminalStatus;
};
```

### `RunLifecycleTransitionDefinition`

Classification: `type-only`. Kind: `type alias`.

Requested pure normative run-lifecycle transition.

Signature:

```ts
export type RunLifecycleTransitionDefinition = {
    readonly source_status: RunLifecycleStatus;
    readonly target_status: RunLifecycleStatus;
    readonly terminal_status?: RunLifecycleTerminalStatus;
};
```

### `RunOutcome`

Classification: `type-only`. Kind: `type alias`.

Immutable versioned record for exactly one terminal task-run result.

Signature:

```ts
export type RunOutcome<O extends RunTerminalOutcome = RunTerminalOutcome> = {
    readonly outcome_version: number;
    readonly outcome: O;
    readonly run_id: string;
    readonly task_artifact_lock: TaskArtifactLock;
};
```

### `RunOutcomeDefinition`

Classification: `type-only`. Kind: `type alias`.

Definition accepted by createRunOutcome.

Signature:

```ts
export type RunOutcomeDefinition<O extends RunTerminalDefinition = RunTerminalDefinition> = {
    readonly outcome: O;
    readonly runId: string;
    readonly taskArtifactLock: TaskArtifactLock;
};
```

### `RunOutcomeFor`

Classification: `type-only`. Kind: `type alias`.

Maps an accepted terminal definition to its exact immutable wire outcome.

Signature:

```ts
export type RunOutcomeFor<O extends RunTerminalDefinition> = RunOutcome<O extends FinishedRunDefinition<infer V> ? FinishedRunOutcome<V> : O extends FailedRunDefinition ? FailedRunOutcome : O extends ExhaustedRunDefinition ? ExhaustedRunOutcome : CancelledRunOutcome>;
```

### `RunTerminalDefinition`

Classification: `type-only`. Kind: `type alias`.

One of the four accepted terminal run definitions.

Signature:

```ts
export type RunTerminalDefinition<V extends SemanticValue = SemanticValue> = CancelledRunDefinition | ExhaustedRunDefinition | FailedRunDefinition | FinishedRunDefinition<V>;
```

### `RunTerminalOutcome`

Classification: `type-only`. Kind: `type alias`.

One immutable terminal run value.

Signature:

```ts
export type RunTerminalOutcome<V extends SemanticValue = SemanticValue> = CancelledRunOutcome | ExhaustedRunOutcome | FailedRunOutcome | FinishedRunOutcome<V>;
```

### `RunTerminalStatus`

Classification: `type-only`. Kind: `type alias`.

Configured terminal status of one completed run record.

Signature:

```ts
export type RunTerminalStatus = (typeof RUN_TERMINAL_STATUSES)[number];
```

### `RunTextArtifactContent`

Classification: `type-only`. Kind: `type alias`.

Inline textual content retained by a run artifact record.

Signature:

```ts
export type RunTextArtifactContent = RunTextArtifactContentDefinition;
```

### `RunTextArtifactContentDefinition`

Classification: `type-only`. Kind: `type alias`.

Inline textual content accepted by createRunArtifact.

Signature:

```ts
export type RunTextArtifactContentDefinition = {
    readonly text: string;
    readonly type: (typeof RUN_ARTIFACT_CONTENT_TYPES)[0];
};
```

### `RunUsage`

Classification: `type-only`. Kind: `type alias`.

Immutable versioned aggregate resource-usage record for one run.

Signature:

```ts
export type RunUsage = {
    readonly cache_creation_input_tokens: number;
    readonly cache_read_input_tokens: number;
    readonly cost_usd: number | null;
    readonly input_tokens: number;
    readonly output_tokens: number;
    readonly run_id: string;
    readonly usage_version: number;
};
```

### `RunUsageDefinition`

Classification: `type-only`. Kind: `type alias`.

Aggregate token and cost totals accepted by createRunUsage.

Signature:

```ts
export type RunUsageDefinition = {
    readonly cacheCreationInputTokens: number;
    readonly cacheReadInputTokens: number;
    readonly costUsd?: number;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly runId: string;
};
```

### `SQLiteTaskRegistry`

Classification: `runtime-and-type`. Kind: `class`.

Synchronous SQLite-backed registry for exact immutable task artifact versions.

Signature:

```ts
export declare class SQLiteTaskRegistry implements Disposable {
    constructor(databasePath?: string, options?: SQLiteTaskRegistryOptions);
    get schemaVersion(): number;
    register(descriptor: TaskDescriptor<TaskSchema<unknown>, TaskSchema<unknown>>): TaskRegistration;
    resolve(reference: ExactTaskReference): TaskRegistration | undefined;
    close(): void;
    [Symbol.dispose](): void;
}
```

#### `constructor`

Opens or creates a durable task registry.

```ts
constructor(databasePath?: string, options?: SQLiteTaskRegistryOptions);
```

Parameter:

- databasePath - SQLite file path, or the configured in-memory default.

Parameter:

- options - Optional exact read-only open policy.

Throws:

- {UnsupportedTaskRegistrySchemaError} If the schema is not current and supported.

Throws:

- {TypeError} If options are malformed or contain unsupported fields.

Throws:

- {Error} If required SQLite defensive behavior is unavailable, or opening/migration fails.

#### `schemaVersion`

Current migrated task-registry schema version.

```ts
get schemaVersion(): number;
```

#### `register`

Durably registers one exact task descriptor version.

Equal re-registration is idempotent and returns the retained registration.

```ts
register(descriptor: TaskDescriptor<TaskSchema<unknown>, TaskSchema<unknown>>): TaskRegistration;
```

Parameter:

- descriptor - Immutable task descriptor produced by `task()`.

Returns:

- The verified canonical artifact and exact artifact lock.

Throws:

- {TaskVersionConflictError} If the task ID/version names different content.

Throws:

- {TaskRegistryError} If the registry is closed or retained data is corrupt.

Throws:

- {TypeError} If the descriptor or artifact lock is malformed.

Throws:

- {Error} If SQLite cannot read or commit the registration.

#### `resolve`

Resolves one exact task ID and version without aliases or fallback selection.

```ts
resolve(reference: ExactTaskReference): TaskRegistration | undefined;
```

Parameter:

- reference - Exact stable task identity and caller-declared version.

Returns:

- The verified registration, or `undefined` when it is absent.

Throws:

- {TaskRegistryError} If the registry is closed or retained data is corrupt.

Throws:

- {TypeError} If the exact reference is malformed.

Throws:

- {Error} If SQLite cannot read the registration.

#### `close`

Closes the SQLite connection. Repeated calls are harmless.

```ts
close(): void;
```

#### `[Symbol.dispose]`

Closes the registry when used with explicit resource management.

```ts
[Symbol.dispose](): void;
```

### `SQLiteTaskRegistryOptions`

Classification: `type-only`. Kind: `type alias`.

Options controlling task-registry open behavior.

Signature:

```ts
export type SQLiteTaskRegistryOptions = {
    readonly readOnly?: boolean;
};
```

### `SQLiteTraceStore`

Classification: `runtime-and-type`. Kind: `class`.

Synchronous SQLite-backed content-addressed trace store.

Writable construction enables configured durability, applies pending migrations, and ensures
the configured root witness. Read-only construction requires existing current-schema database,
blob-directory, and root-witness state without modifying them.

Signature:

```ts
export declare class SQLiteTraceStore implements Disposable {
    constructor(databasePath?: string, options?: SQLiteTraceStoreOptions);
    get schemaVersion(): number;
    append(request: StoreAppendRequest): AppendReceipt;
    recordOpenOperation(definition: OperationBookkeepingDefinition): OperationBookkeepingDefinition;
    recordOperationSessionDeath(evidence: OperationSessionDeathEvidence): number;
    completeOpenOperation(operationId: string, sessionId: string): boolean;
    diagnoseOrphanedOperations(options?: OrphanOperationDiagnosisOptions): OrphanOperationDiagnosisReport;
    prepareOrphanedOperationRepair(command: OrphanRepairCommand): OrphanRepairPreparation;
    repairOrphanedOperations(command: OrphanRepairCommand): OrphanRepairReceipt;
    reclaimOrphanedOperationsBeforeRun(commandId: string): OrphanPreRunReclaimResult;
    claimDurableExecutionInvocation(runId: string, createdRecordId: RecordId, claimId: string, nowMilliseconds?: number, allowExpiredTakeover?: boolean): DurableExecutionInvocationClaim;
    appendDurableExecutionStart(runId: string, claimId: string, fencingToken: number, nowMilliseconds?: number, recoveryCommandRecordId?: RecordId | null): DurableExecutionClaimedAppend;
    diagnoseAppend(appendIntentId: string): AppendRecoveryDiagnostic;
    verifyIntegrity(): TraceIntegrityReport;
    exportTrace(): string;
    importTrace(archiveJson: string): TraceImportReceipt;
    putBlob(content: Uint8Array): BlobStorageReceipt;
    readBlob(blobId: BlobId): Uint8Array | undefined;
    verifyBlobs(): BlobIntegrityReport;
    collectBlobOrphans(options?: BlobOrphanCollectionOptions): BlobOrphanCollectionReport;
    readRecord(recordId: RecordId): RetainedRecord | undefined;
    readOwner(ownerId: string): readonly OwnerRecord[];
    publishCut(spec: CutSpec): Cut;
    readCut(cutId: CutId): Cut;
    iterateCutRecords(cutId: CutId): AsyncGenerator<OwnerRecord, void, unknown>;
    readOwnerPrefix(ownerId: string, through: number, options?: SliceReadOptions): Slice;
    resolveCut(cutId: CutId, options?: SliceReadOptions): Slice;
    projectExecution(cutId: CutId): Execution;
    projectEffectiveHistory(cutId: CutId): EffectiveHistory;
    readCausalClosure(rootRecordIds: readonly RecordId[], options?: CausalClosureOptions): Slice;
    close(): void;
    [Symbol.dispose](): void;
}
```

#### `constructor`

Opens or creates a writable trace store, or opens exact current state read-only.

```ts
constructor(databasePath?: string, options?: SQLiteTraceStoreOptions);
```

Parameter:

- databasePath - SQLite file path, or `:memory:` for an ephemeral store.

Parameter:

- options - Optional external blob directory and read-only policy.

Throws:

- {UnsupportedStoreSchemaError} If read-only schema is absent/non-current or writable
schema is newer than supported.

Throws:

- {TraceStoreError} If required read-only blob or root-witness state is unavailable.

Throws:

- {TypeError} If options or the blob-directory shape are invalid.

Throws:

- {Error} If required SQLite defensive behavior is unavailable, or SQLite/blob setup fails.

#### `schemaVersion`

Current migrated storage-schema version.

```ts
get schemaVersion(): number;
```

#### `append`

Atomically commits or idempotently replays one semantic append request.

```ts
append(request: StoreAppendRequest): AppendReceipt;
```

Parameter:

- request - Stable append intent and semantic batch.

Returns:

- The original durable receipt for this intent and content.

Throws:

- {AppendIntentConflictError} If the intent already names different content.

Throws:

- {TraceStoreError} If witnesses are missing or the store is closed.

Throws:

- {TypeError} If the request is malformed.

Throws:

- {RangeError} If a causal parent is unknown or owner ordinals are exhausted.

#### `recordOpenOperation`

Retains or idempotently replays exact reversible-operation bookkeeping.

This method records bookkeeping only. It performs no provider, filesystem, Git, custody,
settlement, or scope operation.

```ts
recordOpenOperation(definition: OperationBookkeepingDefinition): OperationBookkeepingDefinition;
```

Parameter:

- definition - Closed versioned operation identity and safety evidence.

Returns:

- The frozen canonical definition retained by the store.

Throws:

- {OrphanRepairError} If the operation identity conflicts with retained evidence.

Throws:

- {TypeError} If the definition is malformed, unsupported, or exceeds bounds.

Throws:

- {TraceStoreError} If the store is closed.

#### `recordOperationSessionDeath`

Records externally proven death for one exact operation-owning session.

The external session authority must prove death before calling this narrow bookkeeping API.
The store never infers death from elapsed time or a missing provider response.

```ts
recordOperationSessionDeath(evidence: OperationSessionDeathEvidence): number;
```

Parameter:

- evidence - Exact session identity and external death-evidence identity.

Returns:

- Number of retained open operations owned by the session.

Throws:

- {OrphanRepairError} If death evidence conflicts with retained evidence.

Throws:

- {TypeError} If the evidence is malformed or exceeds bounds.

Throws:

- {TraceStoreError} If the store is closed.

#### `completeOpenOperation`

Removes bookkeeping for one normally completed operation owned by an exact session.

```ts
completeOpenOperation(operationId: string, sessionId: string): boolean;
```

Parameter:

- operationId - Exact open operation identity.

Parameter:

- sessionId - Exact owning session identity.

Returns:

- Whether matching bookkeeping was removed.

Throws:

- {TypeError} If either identity is malformed or exceeds bounds.

Throws:

- {TraceStoreError} If the store is closed.

#### `diagnoseOrphanedOperations`

Diagnoses retained open operations without mutation.

```ts
diagnoseOrphanedOperations(options?: OrphanOperationDiagnosisOptions): OrphanOperationDiagnosisReport;
```

Parameter:

- options - Optional configured page limit and canonical offset.

Returns:

- A frozen page plus an exact digest over the complete open-operation basis.

Throws:

- {OrphanRepairError} If retained bookkeeping is corrupt.

Throws:

- {TypeError} If options or retained evidence are malformed or out of bounds.

Throws:

- {TraceStoreError} If the store is closed.

#### `prepareOrphanedOperationRepair`

Durably prepares canonical repair-command evidence without mutating bookkeeping.

This explicit phase makes an interruption before repair diagnosable and retryable. Replaying
the same command is idempotent; reusing its identity for different content fails closed.

```ts
prepareOrphanedOperationRepair(command: OrphanRepairCommand): OrphanRepairPreparation;
```

Parameter:

- command - Globally idempotent exact orphan set and diagnosis basis.

Returns:

- Canonical command plus its retained trace-record identity.

Throws:

- {OrphanRepairError} If command identity conflicts or its version is unsupported.

Throws:

- {TypeError} If the command is malformed or exceeds bounds.

Throws:

- {TraceStoreError} If the store is closed.

#### `repairOrphanedOperations`

Explicitly repairs the complete exact set of proven-dead operation bookkeeping.

The complete basis is rechecked under the store write lock. Live, provider-started,
scope-owned, stale, changed, or malformed evidence fails closed. Success removes only exact
bookkeeping rows and atomically retains a canonical receipt; no provider, user-file, Git,
custody, settlement, lifecycle, outcome, cut, or scope state is changed.

```ts
repairOrphanedOperations(command: OrphanRepairCommand): OrphanRepairReceipt;
```

Parameter:

- command - Globally idempotent exact orphan set and diagnosis basis.

Returns:

- Canonical successful or empty no-op receipt and trace-record identities.

Throws:

- {OrphanRepairError} If repair is blocked, stale, conflicting, corrupt, or unsupported.

Throws:

- {TypeError} If the command is malformed or exceeds bounds.

Throws:

- {TraceStoreError} If the store is closed.

#### `reclaimOrphanedOperationsBeforeRun`

Attempts best-effort pre-run reclaim without ever blocking the caller's run start.

```ts
reclaimOrphanedOperationsBeforeRun(commandId: string): OrphanPreRunReclaimResult;
```

Parameter:

- commandId - Globally idempotent command identity for this reclaim attempt.

Returns:

- A repaired receipt or a declined result retaining exact manual diagnosis.

Throws:

- {TypeError} Only when command identity or diagnosis inputs are malformed before the
fail-soft repair boundary.

Throws:

- {TraceStoreError} If the store is closed.

#### `claimDurableExecutionInvocation`

Atomically acquires or observes the provider-invocation lease for a durable run.

```ts
claimDurableExecutionInvocation(runId: string, createdRecordId: RecordId, claimId: string, nowMilliseconds?: number, allowExpiredTakeover?: boolean): DurableExecutionInvocationClaim;
```

Parameter:

- runId - Durable run whose provider boundary is guarded.

Parameter:

- createdRecordId - Exact creation evidence associated with the run.

Parameter:

- claimId - Unique identity proposed by this caller.

Parameter:

- nowMilliseconds - Unix time used for deterministic lease evaluation.

Parameter:

- allowExpiredTakeover - Whether this caller has authority to replace an expired claim.

Returns:

- The current frozen claim, including its monotonic fencing token and expiry.

Throws:

- {TypeError} If identifiers, creation evidence, or time are malformed or conflict.

Throws:

- {TraceStoreError} If the store is closed.

#### `appendDurableExecutionStart`

Atomically publishes canonical start evidence while a claim remains authoritative.

```ts
appendDurableExecutionStart(runId: string, claimId: string, fencingToken: number, nowMilliseconds?: number, recoveryCommandRecordId?: RecordId | null): DurableExecutionClaimedAppend;
```

Parameter:

- runId - Durable run whose start boundary is guarded.

Parameter:

- claimId - Exact acquired claim identity.

Parameter:

- fencingToken - Exact monotonic token returned with the claim.

Parameter:

- nowMilliseconds - Unix time used for deterministic lease evaluation.

Parameter:

- recoveryCommandRecordId - Optional canonical recovery command authorizing the start.

Returns:

- A committed receipt or a frozen fenced result.

Throws:

- {TypeError} If identifiers, token, or time are malformed.

Throws:

- {TraceStoreError} If the store is closed or the append fails.

#### `diagnoseAppend`

Diagnoses whether an append intent is committed, retryable, or corrupt.

The diagnosis is read-only. A missing intent is safe to retry, a consistent retained
receipt is committed, and inconsistent retained evidence requires manual recovery.

```ts
diagnoseAppend(appendIntentId: string): AppendRecoveryDiagnostic;
```

Parameter:

- appendIntentId - Stable append intent to inspect.

Returns:

- A frozen recovery diagnosis.

Throws:

- {TraceStoreError} If the store is closed.

Throws:

- {TypeError} If the append intent is empty.

Example:

- ```ts
const diagnosis = store.diagnoseAppend("append:task:1");
if (diagnosis.status === "manual_recovery_required") {
    console.error(diagnosis.issue);
}
```

#### `verifyIntegrity`

Verifies every retained store area and returns classified diagnostics.

The scan is read-only and includes SQLite integrity, canonical records, append receipts,
published cuts, owner paths, and registered external blobs.

```ts
verifyIntegrity(): TraceIntegrityReport;
```

Returns:

- A frozen whole-store integrity report.

Throws:

- {TraceStoreError} If the store is closed.

Throws:

- {Error} If SQLite cannot perform the diagnostic scan.

Example:

- ```ts
const report = store.verifyIntegrity();
if (!report.ok) {
    console.error(report.issues);
}
```

#### `exportTrace`

Exports every verified retained record, view, intent, cut, and blob.

```ts
exportTrace(): string;
```

Returns:

- Deterministic JSON using the configured native trace-archive format.

Throws:

- {TraceStoreError} If the store is closed or fails integrity verification.

Throws:

- {Error} If SQLite or blob storage cannot complete the read-only export.

Example:

- ```ts
const archiveJson = store.exportTrace();
const parsedArchive = JSON.parse(archiveJson);
```

#### `importTrace`

Imports a complete native trace archive into a pristine store.

The archive is fully staged and verified before one SQLite transaction publishes its
retained state. Semantic record identities and owner ordinals are preserved exactly.

```ts
importTrace(archiveJson: string): TraceImportReceipt;
```

Parameter:

- archiveJson - Versioned native archive JSON returned by `exportTrace()`.

Returns:

- Frozen counts for every imported retained-state area.

Throws:

- {TraceStoreError} If the store is closed or is not pristine.

Throws:

- {TypeError} If the archive is malformed, incompatible, or internally inconsistent.

Throws:

- {Error} If SQLite or blob storage cannot publish the validated archive.

Example:

- ```ts
const receipt = targetStore.importTrace(sourceStore.exportTrace());
console.log(receipt.imported_record_count);
```

#### `putBlob`

Durably retains binary content and its storage receipt.

Equal bytes are deduplicated by their configured content digest. Blob bytes become visible
only after a matching SQLite receipt commits.

```ts
putBlob(content: Uint8Array): BlobStorageReceipt;
```

Parameter:

- content - Binary content to retain.

Returns:

- A frozen content identity and byte-length receipt.

Throws:

- {BlobIntegrityError} If existing bytes or metadata disagree with the digest.

Throws:

- {TraceStoreError} If the store is closed.

Throws:

- {TypeError} If content is not a `Uint8Array`.

#### `readBlob`

Reads binary content after verifying its durable receipt and digest.

```ts
readBlob(blobId: BlobId): Uint8Array | undefined;
```

Parameter:

- blobId - Configured content-addressed blob identifier.

Returns:

- A fresh byte array, or `undefined` when no durable receipt exists.

Throws:

- {BlobIntegrityError} If retained bytes or metadata are missing or corrupt.

Throws:

- {TraceStoreError} If the store is closed.

Throws:

- {TypeError} If the blob identifier is malformed.

#### `verifyBlobs`

Verifies every registered blob receipt and filesystem object.

```ts
verifyBlobs(): BlobIntegrityReport;
```

Returns:

- A frozen report ordered by blob identifier.

Throws:

- {TraceStoreError} If the store is closed.

#### `collectBlobOrphans`

Inspects or deletes filesystem objects that have no durable blob registration.

Collection holds the configured store write lock, first verifies every registered blob,
and never removes registered content. Inspection is the configured default.

```ts
collectBlobOrphans(options?: BlobOrphanCollectionOptions): BlobOrphanCollectionReport;
```

Parameter:

- options - Optional configured collection mode.

Returns:

- A frozen report of discovered and deleted objects.

Throws:

- {BlobIntegrityError} If registered content is corrupt or storage is unsafe.

Throws:

- {TraceStoreError} If the store is closed.

Throws:

- {TypeError} If options are malformed or select an unsupported mode.

Throws:

- {Error} If SQLite or the filesystem cannot complete collection.

Example:

- ```ts
const inspection = store.collectBlobOrphans();
if (inspection.orphan_blob_ids.length > 0) {
    store.collectBlobOrphans({ mode: "delete" });
}
```

#### `readRecord`

Reads one semantic record and every owner-local occurrence.

```ts
readRecord(recordId: RecordId): RetainedRecord | undefined;
```

Parameter:

- recordId - Content-addressed record identifier.

Returns:

- The retained record, or `undefined` when it is absent.

Throws:

- {TraceStoreError} If the store is closed.

Throws:

- {TypeError} If the record identifier is malformed.

#### `readOwner`

Reads one owner path in ascending ordinal order.

```ts
readOwner(ownerId: string): readonly OwnerRecord[];
```

Parameter:

- ownerId - Stable trace-owner identifier.

Returns:

- Frozen owner-local record occurrences.

Throws:

- {TraceStoreError} If the store is closed.

Throws:

- {TypeError} If the owner identifier is empty or malformed.

#### `publishCut`

Publishes an immutable address through one retained owner-path occurrence.

Publication appends a semantic cut record and its resolver index atomically.

```ts
publishCut(spec: CutSpec): Cut;
```

Parameter:

- spec - Closed cut publication request.

Returns:

- The durable cut address.

Throws:

- {TraceStoreError} If the target occurrence is absent or the store is closed.

Throws:

- {TypeError} If the request is malformed.

#### `readCut`

Reads and verifies one published cut.

```ts
readCut(cutId: CutId): Cut;
```

Parameter:

- cutId - Stable published cut identifier.

Returns:

- The verified durable cut.

Throws:

- {TraceStoreError} If the cut is absent, corrupt, or the store is closed.

Throws:

- {TypeError} If the identifier is malformed.

#### `iterateCutRecords`

Lazily yields payload-visible owner occurrences through one published cut, in ordinal order.

Cut authentication and input validation occur on the first pull. Each subsequent pull reads
one occurrence synchronously, without a live cursor or transaction across yields. Later
appends are excluded. Integrity is incremental, not a cross-pull database snapshot: an error
cannot retract earlier yields. No graph closure, filtering, or redaction is performed.
Early termination releases iteration state but never closes the caller-owned store.

```ts
iterateCutRecords(cutId: CutId): AsyncGenerator<OwnerRecord, void, unknown>;
```

Parameter:

- cutId - Exact published cut identifier.

Returns:

- A single-use async iterator of frozen owner occurrences, including repeated IDs.

Throws:

- {TraceStoreError} On a pull if the store is closed, the cut is absent/corrupt, an
occurrence is missing, or the terminal occurrence no longer matches the cut.

Throws:

- {TypeError} On a pull if the identifier or encountered stored data is malformed.

Throws:

- {Error} On a pull if SQLite or canonical record decoding fails.

Example:

- ```ts
for await (const record of store.iterateCutRecords("cut:review")) {
    console.log(record.view.owner_ordinal, record.envelope.record_id);
}
```

#### `readOwnerPrefix`

Reads an owner path through an inclusive ordinal.

```ts
readOwnerPrefix(ownerId: string, through: number, options?: SliceReadOptions): Slice;
```

Parameter:

- ownerId - Stable trace-owner identifier.

Parameter:

- through - Inclusive owner ordinal.

Parameter:

- options - Mode and visibility selection.

Returns:

- An immutable graph-shaped slice.

Throws:

- {TraceStoreError} If retained owner-path evidence is corrupt or the store is closed.

Throws:

- {TypeError} If the owner, ordinal, or options are malformed.

#### `resolveCut`

Resolves a published cut without including later owner-path records.

```ts
resolveCut(cutId: CutId, options?: SliceReadOptions): Slice;
```

Parameter:

- cutId - Stable published cut identifier.

Parameter:

- options - Mode and visibility selection.

Returns:

- An immutable graph-shaped slice addressed by the cut.

Throws:

- {TraceStoreError} If the cut is absent, corrupt, or the store is closed.

Throws:

- {TypeError} If the cut identifier or options are malformed.

#### `projectExecution`

Projects one execution lifecycle at an immutable published cut.

```ts
projectExecution(cutId: CutId): Execution;
```

Parameter:

- cutId - Cut addressing the execution owner prefix.

Returns:

- A frozen, reproducible execution value.

Throws:

- {ProjectionCompatibilityError} If configured projection requirements cannot be met.

Throws:

- {TraceStoreError} If retained cut or lifecycle evidence is absent or corrupt.

Throws:

- {TypeError} If the cut identifier is malformed.

#### `projectEffectiveHistory`

Projects effective execution history at immutable root and child cuts.

Active child relations resolve their published child cuts. Abandoned relations remain
visible in retained history but do not select an effective child.

```ts
projectEffectiveHistory(cutId: CutId): EffectiveHistory;
```

Parameter:

- cutId - Cut addressing the root execution owner prefix.

Returns:

- Frozen root, relation, child, and parent-publication projections.

Throws:

- {ProjectionCompatibilityError} If configured projection requirements cannot be met.

Throws:

- {TraceStoreError} If a required cut or retained record is absent or corrupt.

Throws:

- {TypeError} If the cut identifier is malformed.

#### `readCausalClosure`

Reads the transitive causal closure of one or more retained root records.

Causal traversal occurs before mode filtering. Direct omitted parents become anchors under
the configured default policy, and witness support is closed independently to the root.

```ts
readCausalClosure(rootRecordIds: readonly RecordId[], options?: CausalClosureOptions): Slice;
```

Parameter:

- rootRecordIds - Records from which causal traversal begins.

Parameter:

- options - Mode, visibility, and anchor policy.

Returns:

- An immutable graph-shaped slice.

Throws:

- {TraceStoreError} If a root, parent, or witness is absent or corrupt.

Throws:

- {TypeError} If the request options or identifiers are malformed.

#### `close`

Closes the SQLite connection. Repeated calls are harmless.

```ts
close(): void;
```

#### `[Symbol.dispose]`

Closes the store when used with explicit resource management.

```ts
[Symbol.dispose](): void;
```

### `SQLiteTraceStoreOptions`

Classification: `type-only`. Kind: `type alias`.

Filesystem configuration for a SQLite trace store.

Signature:

```ts
export type SQLiteTraceStoreOptions = {
    readonly blobDirectory?: string;
    readonly readOnly?: boolean;
};
```

### `SelectRetainedWorldSettlementOptions`

Classification: `type-only`. Kind: `type alias`.

Closed authorities for exact-ID retained-world selection and recovery.

Signature:

```ts
export type SelectRetainedWorldSettlementOptions = {
    readonly binding: WorkspaceBinding;
    readonly carrier: ReferenceCopyCarrier;
    readonly outputId: string;
    readonly store: SQLiteTraceStore;
};
```

### `SelectedRetainedWorldSettlement`

Classification: `type-only`. Kind: `type alias`.

Completed durable selection result after authenticated carrier publication.

Signature:

```ts
export type SelectedRetainedWorldSettlement = {
    readonly action: (typeof RETAINED_WORLD_SETTLEMENT_ACTIONS)[0];
    readonly operation_id: string;
    readonly output_id: string;
    readonly publication_id: string;
    readonly request_id: string;
    readonly settlement_version: typeof RETAINED_WORLD_SETTLEMENT_VERSION;
    readonly state: (typeof RETAINED_WORLD_SETTLEMENT_STATES)[2];
    readonly user_basis_after: string;
};
```

### `SemanticRecord`

Classification: `type-only`. Kind: `type alias`.

A plain object containing semantic values.

Properties whose value is `undefined` are omitted during canonicalization.
Symbol and accessor properties are rejected.

Signature:

```ts
export type SemanticRecord = {
    readonly [key: string]: SemanticValue | undefined;
};
```

### `SemanticScalar`

Classification: `type-only`. Kind: `type alias`.

A scalar value accepted by the canonical semantic record format.

Numbers must be finite. Strings must contain well-formed Unicode.

Signature:

```ts
export type SemanticScalar = boolean | null | number | string;
```

### `SemanticValue`

Classification: `type-only`. Kind: `type alias`.

Any recursively representable value accepted in a semantic record.

Arrays must be dense data arrays without accessors or custom properties.

Signature:

```ts
export type SemanticValue = SemanticRecord | SemanticScalar | readonly SemanticValue[];
```

### `Slice`

Classification: `type-only`. Kind: `type alias`.

Immutable graph-shaped trace read.

Signature:

```ts
export type Slice = {
    readonly causal_edges: readonly (readonly [
        RecordId,
        RecordId
    ])[];
    readonly external_anchors: readonly ExternalAnchor[];
    readonly mode_filter: ModeFilter;
    readonly owner_paths: Readonly<Record<TraceOwnerId, readonly RecordId[]>>;
    readonly read_address?: Cut;
    readonly visible_records_by_id: Readonly<Record<RecordId, RecordShape | SliceRecord>>;
    readonly visible_witnesses_by_id: Readonly<Record<RecordId, SliceRecord>>;
    readonly visibility_profile: VisibilityProfile;
    readonly witness_anchors: readonly WitnessAnchor[];
};
```

### `SliceReadOptions`

Classification: `type-only`. Kind: `type alias`.

Shared options for owner-prefix and published-cut reads.

Signature:

```ts
export type SliceReadOptions = {
    readonly mode_filter?: ModeFilter;
    readonly visibility_profile?: VisibilityProfile;
};
```

### `SliceRecord`

Classification: `type-only`. Kind: `type alias`.

One selected payload-visible record occurrence.

Signature:

```ts
export type SliceRecord = {
    readonly body: RecordBody;
    readonly envelope: RecordEnvelope;
    readonly view?: RecordView;
};
```

### `StaticLoweringEvidence`

Classification: `type-only`. Kind: `type alias`.

Content-addressed static source-to-kernel lowering manifest.

Signature:

```ts
export type StaticLoweringEvidence = {
    readonly assumptions: readonly string[];
    readonly completed: boolean;
    readonly generated_trace_ref: string;
    readonly lowering_ref: string;
    readonly oracle_case: string;
    readonly oracle_path: string;
    readonly oracle_repository: string;
    readonly oracle_revision: string;
    readonly profile: ProofEnvelopeProfile;
    readonly program_ref: string;
    readonly schema_version: string;
    readonly source_ref: string;
    readonly validator: string;
};
```

### `StaticProviderDefinition`

Classification: `type-only`. Kind: `type alias`.

Definition accepted by createStaticProvider.

Signature:

```ts
export type StaticProviderDefinition = {
    readonly descriptor: StaticProviderDescriptorDefinition;
    readonly exchanges: readonly StaticProviderExchange[];
};
```

### `StaticProviderDescriptorDefinition`

Classification: `type-only`. Kind: `type alias`.

Descriptor fields accepted by createStaticProvider.

Signature:

```ts
export type StaticProviderDescriptorDefinition = {
    readonly id: string;
    readonly model: string;
};
```

### `StaticProviderExchange`

Classification: `type-only`. Kind: `type alias`.

One exact deterministic request and its configured response.

Signature:

```ts
export type StaticProviderExchange = {
    readonly request: ModelRequest;
    readonly response: ModelResponse;
};
```

### `StaticProviderExhaustedError`

Classification: `runtime-and-type`. Kind: `class`.

Error raised after a static provider consumes its complete cassette.

Signature:

```ts
export declare class StaticProviderExhaustedError extends Error {
    readonly code: string;
    readonly position: number;
    constructor(position: number);
}
```

#### `code`

Stable configured machine-readable error code.

```ts
readonly code: string;
```

#### `position`

Zero-based cassette position requested by the rejected invocation.

```ts
readonly position: number;
```

#### `constructor`

Creates a cassette-exhaustion error.

```ts
constructor(position: number);
```

Parameter:

- position - Zero-based position requested after the final exchange.

### `StaticProviderRequestMismatchError`

Classification: `runtime-and-type`. Kind: `class`.

Error raised when a request does not match the next static exchange.

Signature:

```ts
export declare class StaticProviderRequestMismatchError extends Error {
    readonly code: string;
    readonly position: number;
    constructor(position: number);
}
```

#### `code`

Stable configured machine-readable error code.

```ts
readonly code: string;
```

#### `position`

Zero-based cassette position that rejected the request.

```ts
readonly position: number;
```

#### `constructor`

Creates a static request-mismatch error.

```ts
constructor(position: number);
```

Parameter:

- position - Zero-based expected exchange position.

### `StoreAppendRequest`

Classification: `type-only`. Kind: `type alias`.

One atomic append request presented to a trace store.

Signature:

```ts
export type StoreAppendRequest = {
    readonly append_intent_id: AppendIntentId;
    readonly batch: AppendBatchDraft;
};
```

### `StrongProofEvidence`

Classification: `type-only`. Kind: `type alias`.

Complete external evidence bundle requesting one theorem-backed profile claim.

Signature:

```ts
export type StrongProofEvidence = {
    readonly core0h_sidecar: Core0hSidecarEvidence | null;
    readonly lowering: StaticLoweringEvidence;
    readonly profile: ProofEnvelopeProfile;
    readonly strength: ProofEnvelopeStrength;
    readonly theorem_artifact: PinnedTheoremArtifactEvidence;
};
```

### `TASK_RUN_LEDGER_LATEST_SELECTOR`

Classification: `runtime-only`. Kind: `variable`.

Configured canonical latest read selector.

Signature:

```ts
export declare const TASK_RUN_LEDGER_LATEST_SELECTOR: "@latest";
```

### `TASK_RUN_LEDGER_LIMITS`

Classification: `runtime-only`. Kind: `variable`.

Configured public task/run ledger selector and projection bounds.

Signature:

```ts
export declare const TASK_RUN_LEDGER_LIMITS: {
    readonly defaultPageSize: 50;
    readonly maxCanonicalEntryBytes: 67108864;
    readonly maxPageSize: 100;
    readonly maxSelectorBytes: 512;
};
```

### `TaskArtifact`

Classification: `type-only`. Kind: `type alias`.

Canonical bodyless task contract included in task artifact identity.

Signature:

```ts
export type TaskArtifact = {
    readonly compatibility_version: string;
    readonly descriptor_version: number;
    readonly input_schema: SemanticRecord;
    readonly instruction: string;
    readonly name: string;
    readonly output_schema: SemanticRecord;
    readonly task_version: string;
};
```

### `TaskArtifactLock`

Classification: `type-only`. Kind: `type alias`.

Exact content-addressed lock for one immutable task artifact revision.

Signature:

```ts
export type TaskArtifactLock = {
    readonly artifact_digest: string;
    readonly artifact_lock_version: number;
    readonly compatibility_version: string;
    readonly descriptor_version: number;
    readonly schema_digest: string;
    readonly task_id: string;
    readonly task_version: string;
};
```

### `TaskDefinition`

Classification: `type-only`. Kind: `type alias`.

Definition accepted by the bodyless task descriptor builder.

Signature:

```ts
export type TaskDefinition<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>> = {
    readonly input: I;
    readonly instruction: string;
    readonly name: string;
    readonly output: O;
    readonly version: string;
};
```

### `TaskDescriptor`

Classification: `type-only`. Kind: `type alias`.

Immutable bodyless task descriptor with inferred runtime validation methods.

Signature:

```ts
export type TaskDescriptor<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>> = {
    readonly artifact: TaskArtifact;
    readonly artifactLock: TaskArtifactLock;
    readonly inputSchema: I;
    readonly instruction: string;
    readonly name: string;
    readonly outputSchema: O;
    readonly parseInput: (value: unknown) => InferTaskSchema<I>;
    readonly parseOutput: (value: unknown) => InferTaskSchema<O>;
    readonly version: string;
};
```

### `TaskExecutionLedgerReceipt`

Classification: `type-only`. Kind: `type alias`.

Durable trace evidence retained for one task execution.

Signature:

```ts
export type TaskExecutionLedgerReceipt = {
    readonly artifact_record_ids: readonly RecordId[];
    readonly cut: Cut;
    readonly created_record_id: RecordId;
    readonly lifecycle_record_id: RecordId;
    readonly outcome_record_id: RecordId;
    readonly started: boolean;
    readonly started_record_id: RecordId | null;
    readonly usage_record_id: RecordId | null;
};
```

### `TaskExecutionOptions`

Classification: `type-only`. Kind: `type alias`.

Options for one provider-backed bodyless task execution.

Signature:

```ts
export type TaskExecutionOptions<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>> = {
    readonly budget: RunBudgetDefinition;
    readonly input: InferTaskSchema<I>;
    readonly provider: ModelProvider;
    readonly runId: string;
    readonly signal?: AbortSignal;
    readonly task: TaskDescriptor<I, O>;
};
```

### `TaskExecutionResult`

Classification: `type-only`. Kind: `type alias`.

Terminal records and final observable state produced by one task execution.

Signature:

```ts
export type TaskExecutionResult = {
    readonly artifacts: readonly RunArtifact[];
    readonly control: RunControlSnapshot;
    readonly outcome: RunOutcome;
    readonly provider: ProviderDescriptor;
    readonly usage: RunUsage | null;
};
```

### `TaskLedgerEntry`

Classification: `type-only`. Kind: `type alias`.

Immutable registered-task ledger projection.

Signature:

```ts
export type TaskLedgerEntry = {
    readonly artifact: TaskArtifact;
    readonly artifact_lock: TaskArtifactLock;
    readonly compatibility_version: string;
    readonly ledger_version: number;
    readonly repository_grant: TaskLedgerRepositoryGrantEvidence | null;
};
```

### `TaskLedgerRepositoryGrantEvidence`

Classification: `type-only`. Kind: `type alias`.

Immutable repository-grant companion evidence for one task artifact.

Signature:

```ts
export type TaskLedgerRepositoryGrantEvidence = {
    readonly artifact: RepositoryTaskGrantArtifact;
    readonly artifact_lock: RepositoryTaskGrantArtifactLock;
};
```

### `TaskRegistration`

Classification: `type-only`. Kind: `type alias`.

Durable registry result containing a canonical artifact and its verified lock.

Signature:

```ts
export type TaskRegistration = {
    readonly artifact: TaskArtifact;
    readonly artifactLock: TaskArtifactLock;
};
```

### `TaskRegistryError`

Classification: `runtime-and-type`. Kind: `class`.

Base error for durable task-registry contract violations.

Signature:

```ts
export declare class TaskRegistryError extends Error {
    readonly code: string;
}
```

#### `code`

Stable configured machine-readable task-registry error code.

```ts
readonly code: string;
```

### `TaskSchema`

Classification: `type-only`. Kind: `type alias`.

Runtime schema carrying a JSON Schema document and an inferred output type.

Signature:

```ts
export type TaskSchema<T> = {
    readonly parse: (value: unknown) => T;
    readonly toJSONSchema: () => SemanticRecord;
};
```

### `TaskSchemaFactory`

Classification: `type-only`. Kind: `type alias`.

Public factory surface for the supported task schema primitives.

Signature:

```ts
export type TaskSchemaFactory = {
    readonly fromJSONSchema: (document: unknown) => TaskSchema<unknown>;
    readonly object: <S extends TaskSchemaShape>(shape: S) => TaskSchema<InferTaskSchemaShape<S>>;
    readonly string: () => TaskSchema<string>;
    readonly void: () => TaskSchema<void>;
};
```

### `TaskSchemaShape`

Classification: `type-only`. Kind: `type alias`.

Shape accepted by `schema.object()`.

Signature:

```ts
export type TaskSchemaShape = Readonly<Record<string, TaskSchema<unknown>>>;
```

### `TaskVersionConflictError`

Classification: `runtime-and-type`. Kind: `class`.

Raised when one logical task ID/version is registered with different content.

Signature:

```ts
export declare class TaskVersionConflictError extends TaskRegistryError {
    readonly code: string;
}
```

#### `code`

Stable configured machine-readable task-version conflict code.

```ts
readonly code: string;
```

### `TaskWorldCaptureJournalInspection`

Classification: `type-only`. Kind: `type alias`.

Restart-safe read projection of one durable task-world capture journal.

Signature:

```ts
export type TaskWorldCaptureJournalInspection = {
    readonly capture_id: string | null;
    readonly output_record_id: RecordId | null;
    readonly recovery_status: (typeof DURABLE_EXECUTION_RECOVERY_STATUSES)[number];
    readonly run_id: string;
    readonly status: TaskWorldCaptureJournalStatus;
    readonly transitions: readonly TaskWorldCaptureJournalTransition[];
};
```

### `TaskWorldCaptureJournalStatus`

Classification: `type-only`. Kind: `type alias`.

Durable task-world journal phase or its absent/retained projection.

Signature:

```ts
export type TaskWorldCaptureJournalStatus = (typeof DURABLE_EXECUTION_RECOVERY_STATUSES)[0] | (typeof RETAINED_WORLD_JOURNAL_PHASES)[number] | (typeof RETAINED_WORLD_OUTPUT_STATUSES)[0];
```

### `TaskWorldCaptureJournalTransition`

Classification: `type-only`. Kind: `type alias`.

One validated immutable capture-journal transition.

Signature:

```ts
export type TaskWorldCaptureJournalTransition = {
    readonly body: SemanticRecord;
    readonly phase: (typeof RETAINED_WORLD_JOURNAL_PHASES)[number];
    readonly record_id: RecordId;
};
```

### `TaskWorldCaptureResult`

Classification: `type-only`. Kind: `type alias`.

Durable task result paired with its exact retained world attachment.

Signature:

```ts
export type TaskWorldCaptureResult = DurableTaskExecutionResult & {
    readonly changeset: WorldChangeset;
    readonly output: RetainedWorldOutput;
};
```

### `TraceImportReceipt`

Classification: `type-only`. Kind: `type alias`.

Result of importing one complete native trace archive.

Signature:

```ts
export type TraceImportReceipt = {
    readonly imported_append_intent_count: number;
    readonly imported_blob_count: number;
    readonly imported_cut_count: number;
    readonly imported_record_count: number;
    readonly imported_record_view_count: number;
};
```

### `TraceIntegrityIssue`

Classification: `type-only`. Kind: `type alias`.

One classified defect found by a whole-store integrity scan.

Signature:

```ts
export type TraceIntegrityIssue = {
    readonly kind: TraceIntegrityIssueKind;
    readonly subject_id: string;
};
```

### `TraceIntegrityIssueKind`

Classification: `type-only`. Kind: `type alias`.

Stable classification for one whole-store integrity defect.

Signature:

```ts
export type TraceIntegrityIssueKind = `blob_${BlobIntegrityIssue["kind"]}` | "append_receipt_mismatch" | "cut_mismatch" | "orphan_record" | "owner_ordinal_mismatch" | "parent_index_mismatch" | "record_mismatch" | "sqlite_integrity_mismatch" | "witness_mismatch";
```

### `TraceIntegrityReport`

Classification: `type-only`. Kind: `type alias`.

Complete read-only integrity report for a trace store.

Signature:

```ts
export type TraceIntegrityReport = {
    readonly checked_append_intent_count: number;
    readonly checked_blob_count: number;
    readonly checked_cut_count: number;
    readonly checked_owner_count: number;
    readonly checked_record_count: number;
    readonly issues: readonly TraceIntegrityIssue[];
    readonly ok: boolean;
};
```

### `TraceOwnerId`

Classification: `type-only`. Kind: `type alias`.

Stable identifier for one owner-local trace path.

Signature:

```ts
export type TraceOwnerId = string;
```

### `TraceRevisionEntry`

Classification: `type-only`. Kind: `type alias`.

Immutable published-cut trace revision and its exact resolved owner-prefix slice.

Signature:

```ts
export type TraceRevisionEntry = {
    readonly compatibility_version: string;
    readonly cut: Cut;
    readonly slice: Slice;
    readonly trace_revision_version: number;
};
```

### `TraceStoreError`

Classification: `runtime-and-type`. Kind: `class`.

Base error for trace-store contract violations.

Signature:

```ts
export declare class TraceStoreError extends Error {
    readonly code: string;
}
```

#### `code`

Stable configured machine-readable trace-store error code.

```ts
readonly code: string;
```

### `TypedEffectHandlerOptions`

Classification: `type-only`. Kind: `type alias`.

Definition of an in-process effect handler with an inferred, validated payload.

Signature:

```ts
export type TypedEffectHandlerOptions<P> = {
    readonly handlerId: string;
    readonly kind: string;
    readonly payloadSchema: TaskSchema<P>;
    readonly handle: (payload: P, intent: EffectIntent) => EffectResult<SemanticValue, SemanticValue> | Promise<EffectResult<SemanticValue, SemanticValue>>;
};
```

### `TypedEffectTraceRecord`

Classification: `type-only`. Kind: `type alias`.

Normalized semantic record consumed by the executable typed-effect trace machine.

Signature:

```ts
export type TypedEffectTraceRecord = {
    readonly [field: string]: SemanticValue;
    readonly record_type: TypedEffectTraceRecordType;
    readonly ref: string;
};
```

### `TypedEffectTraceRecordType`

Classification: `type-only`. Kind: `type alias`.

Configured normalized record discriminant accepted by the Core-A trace machine.

Signature:

```ts
export type TypedEffectTraceRecordType = (typeof TYPED_EFFECT_TRACE_RECORD_TYPES)[keyof typeof TYPED_EFFECT_TRACE_RECORD_TYPES];
```

### `TypedEffectTraceValidation`

Classification: `type-only`. Kind: `type alias`.

Frozen summary returned after executable typed-effect trace validation.

Signature:

```ts
export type TypedEffectTraceValidation = {
    readonly completed: boolean;
    readonly open_path_count: number;
    readonly program_ref: string;
    readonly record_count: number;
};
```

### `TypedEffectTraceValidationError`

Classification: `runtime-and-type`. Kind: `class`.

Raised when normalized typed-effect records violate the executable Core-A lifecycle.

Signature:

```ts
export declare class TypedEffectTraceValidationError extends Error {
    readonly code: string;
    constructor(message: string);
}
```

#### `code`

Stable configured machine-readable error code.

```ts
readonly code: string;
```

#### `constructor`

Creates a typed-effect trace validation failure.

```ts
constructor(message: string);
```

Parameter:

- message - Stable diagnostic describing the rejected lifecycle obligation.

### `TypedEffectTraceValidationOptions`

Classification: `type-only`. Kind: `type alias`.

Untrusted input for executable Core-A trace lifecycle validation.

Signature:

```ts
export type TypedEffectTraceValidationOptions = {
    readonly completed: boolean;
    readonly programRef: string;
    readonly trace: readonly unknown[];
};
```

### `UnsupportedStoreSchemaError`

Classification: `runtime-and-type`. Kind: `class`.

Raised when a database schema is newer than this package supports.

Signature:

```ts
export declare class UnsupportedStoreSchemaError extends TraceStoreError {
    readonly code: string;
}
```

#### `code`

Stable configured machine-readable unsupported-schema code.

```ts
readonly code: string;
```

### `UnsupportedTaskRegistrySchemaError`

Classification: `runtime-and-type`. Kind: `class`.

Raised when a task-registry database is newer than this package supports.

Signature:

```ts
export declare class UnsupportedTaskRegistrySchemaError extends TaskRegistryError {
    readonly code: string;
}
```

#### `code`

Stable configured machine-readable unsupported-schema code.

```ts
readonly code: string;
```

### `VisibilityProfile`

Classification: `type-only`. Kind: `type alias`.

Payload disclosure level for a graph-shaped trace read.

Signature:

```ts
export type VisibilityProfile = "full_internal" | "payload" | "shape_only";
```

### `WORLD_CHANGESET_ERROR_CODES`

Classification: `runtime-only`. Kind: `variable`.

Configured public world-changeset error codes.

Signature:

```ts
export declare const WORLD_CHANGESET_ERROR_CODES: {
    readonly invalid: "WORLD_CHANGESET_INVALID";
    readonly limit: "WORLD_CHANGESET_LIMIT_EXCEEDED";
};
```

### `WORLD_CHANGESET_INSPECTION_LIMITS`

Classification: `runtime-only`. Kind: `variable`.

Configured public resource bounds for changeset inspection.

Signature:

```ts
export declare const WORLD_CHANGESET_INSPECTION_LIMITS: {
    readonly maxDerivedMoveCandidates: 10000;
    readonly maxPageSize: 1000;
    readonly maxPathBytes: 4096;
    readonly maxPreviewBytes: 1048576;
    readonly maxPreviewLines: 1000;
    readonly maxReadBytes: 1048576;
    readonly maxVerificationConcurrency: 2;
};
```

### `WitnessAnchor`

Classification: `type-only`. Kind: `type alias`.

Visible placeholder for witness support whose payload is hidden.

Signature:

```ts
export type WitnessAnchor = {
    readonly hidden_reason: "hidden_by_visibility";
    readonly visible_shape: {
        readonly schema_ref: string;
        readonly witness_ref: RecordId | "";
    };
    readonly witness_ref: RecordId;
};
```

### `WorkspaceAdoption`

Classification: `type-only`. Kind: `type alias`.

Immutable baseline citation retained by workspace control metadata.

Signature:

```ts
export type WorkspaceAdoption = {
    readonly baseline_ref: string | null;
    readonly git_head: string | null;
    readonly mode: WorkspaceAdoptionMode;
};
```

### `WorkspaceAdoptionMode`

Classification: `type-only`. Kind: `type alias`.

Configured baseline-adoption mode used when initializing a workspace.

Signature:

```ts
export type WorkspaceAdoptionMode = (typeof WORKSPACE_ADOPTION_MODES)[number];
```

### `WorkspaceBinding`

Classification: `type-only`. Kind: `type alias`.

Frozen canonical authority for one disjoint workspace root.

Signature:

```ts
export type WorkspaceBinding = {
    readonly binding_id: string;
    readonly canonical_root: string;
    readonly name: string;
    readonly requested_root: string;
};
```

### `WorkspaceBindingDefinition`

Classification: `type-only`. Kind: `type alias`.

One logical root proposed for canonical workspace authority.

Signature:

```ts
export type WorkspaceBindingDefinition = {
    readonly name: string;
    readonly root: string;
};
```

### `WorkspaceBindingError`

Classification: `runtime-and-type`. Kind: `class`.

Raised when a proposed workspace binding cannot establish unambiguous canonical authority.

Signature:

```ts
export declare class WorkspaceBindingError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
```

#### `code`

Stable machine-readable binding-validation error code.

```ts
readonly code: string;
```

#### `constructor`

Creates a workspace-binding validation failure.

```ts
constructor(code: string, message: string);
```

Parameter:

- code - Configured machine-readable failure code.

Parameter:

- message - Configured diagnostic for the rejected binding set.

### `WorkspaceBindingOptions`

Classification: `type-only`. Kind: `type alias`.

Closed options accepted by createWorkspaceBindings.

Signature:

```ts
export type WorkspaceBindingOptions = {
    readonly bindings: readonly WorkspaceBindingDefinition[];
    readonly workspaceRoot: string;
};
```

### `WorkspaceBindingSet`

Classification: `type-only`. Kind: `type alias`.

Frozen complete binding authority set for one initialized workspace.

Signature:

```ts
export type WorkspaceBindingSet = {
    readonly binding_version: number;
    readonly bindings: readonly WorkspaceBinding[];
    readonly workspace_root: string;
};
```

### `WorkspaceControlError`

Classification: `runtime-and-type`. Kind: `class`.

Raised when workspace control state is missing, unsafe, malformed, or inconsistent.

Signature:

```ts
export declare class WorkspaceControlError extends Error {
    readonly code: string;
    constructor(message?: string);
}
```

#### `code`

Stable machine-readable workspace-control error code.

```ts
readonly code: string;
```

#### `constructor`

Creates a workspace-control validation failure.

```ts
constructor(message?: string);
```

Parameter:

- message - Diagnostic describing the rejected control state.

### `WorkspaceCustodyFaultError`

Classification: `runtime-and-type`. Kind: `class`.

Raised when a configured custody boundary fails with stable recovery evidence.

Signature:

```ts
export declare class WorkspaceCustodyFaultError extends WorldCarrierError {
    readonly evidence: WorkspaceCustodyFaultEvidence;
    constructor(code: string, message: string, evidence: WorkspaceCustodyFaultEvidence);
}
```

#### `evidence`

Frozen precise fault and recovery evidence.

```ts
readonly evidence: WorkspaceCustodyFaultEvidence;
```

#### `constructor`

Creates a configured custody fault.

```ts
constructor(code: string, message: string, evidence: WorkspaceCustodyFaultEvidence);
```

Parameter:

- code - Stable configured machine-readable fault code.

Parameter:

- message - Stable configured diagnostic.

Parameter:

- evidence - Exact configured phase, classification, and recovery evidence.

### `WorkspaceCustodyFaultEvidence`

Classification: `type-only`. Kind: `type alias`.

Stable public evidence attached to a custody fault.

Signature:

```ts
export type WorkspaceCustodyFaultEvidence = {
    readonly classification: string;
    readonly metadata_kind: string | null;
    readonly phase: string;
    readonly recovery: string;
    readonly system_code: string | null;
    readonly version: number;
};
```

### `WorkspaceCustodyFaultInjection`

Classification: `type-only`. Kind: `type alias`.

Declarative deterministic fault injected at one configured custody boundary.

Signature:

```ts
export type WorkspaceCustodyFaultInjection = {
    readonly classification: string;
    readonly phase: string;
    readonly systemCode: string | null;
};
```

### `WorkspaceGitPlatformPolicy`

Classification: `type-only`. Kind: `type alias`.

Frozen Git-specific platform custody policy.

Signature:

```ts
export type WorkspaceGitPlatformPolicy = {
    readonly core_symlinks_false: string;
    readonly gitlinks: string;
    readonly sparse_index: string;
};
```

### `WorkspaceGitState`

Classification: `type-only`. Kind: `type alias`.

Immutable current Git context observed while opening workspace control state.

Signature:

```ts
export type WorkspaceGitState = {
    readonly head: string | null;
    readonly repository_root: string | null;
};
```

### `WorkspaceInitializationConflictError`

Classification: `runtime-and-type`. Kind: `class`.

Raised when repeated initialization requests different retained control options.

Signature:

```ts
export declare class WorkspaceInitializationConflictError extends Error {
    readonly code: string;
    constructor(message?: string);
}
```

#### `code`

Stable machine-readable initialization-conflict error code.

```ts
readonly code: string;
```

#### `constructor`

Creates a conflicting workspace-initialization failure.

```ts
constructor(message?: string);
```

Parameter:

- message - Diagnostic describing the conflicting option.

### `WorkspaceInitializationOptions`

Classification: `type-only`. Kind: `type alias`.

Closed options accepted by initializeWorkspace.

Signature:

```ts
export type WorkspaceInitializationOptions = {
    readonly adopt?: WorkspaceAdoptionMode;
    readonly initializeGit?: boolean;
    readonly rootPath: string;
};
```

### `WorkspacePathProtectionOptions`

Classification: `type-only`. Kind: `type alias`.

Closed input used to inspect one binding-relative workspace path.

Signature:

```ts
export type WorkspacePathProtectionOptions = {
    readonly bindingRoot: string;
    readonly path: string;
    readonly workspaceRoot: string;
};
```

### `WorkspacePathProtectionValidation`

Classification: `type-only`. Kind: `type alias`.

Versioned result of configured protected workspace-path validation.

Signature:

```ts
export type WorkspacePathProtectionValidation = {
    readonly path: string;
    readonly protected: boolean;
    readonly protected_root: string | null;
    readonly validation_version: number;
};
```

### `WorkspacePlatformConformance`

Classification: `type-only`. Kind: `type alias`.

Frozen configured platform policy for retained workspace custody.

Signature:

```ts
export type WorkspacePlatformConformance = {
    readonly case_collision_policy: string;
    readonly git: WorkspaceGitPlatformPolicy;
    readonly metadata_policy: string;
    readonly mode_policy: string;
    readonly optimized_carrier_parity: string;
    readonly platform: NodeJS.Platform;
    readonly symlink_policy: string;
    readonly unsupported_metadata: readonly string[];
    readonly version: number;
};
```

### `WorkspacePlatformConformanceOptions`

Classification: `type-only`. Kind: `type alias`.

Closed options accepted by inspectWorkspacePlatformConformance.

Signature:

```ts
export type WorkspacePlatformConformanceOptions = {
    readonly workspaceRoot: string;
};
```

### `WorkspaceProtectedPathError`

Classification: `runtime-and-type`. Kind: `class`.

Raised before a retained-world operation can inspect or mutate a protected control path.

Signature:

```ts
export declare class WorkspaceProtectedPathError extends WorldCarrierError {
    readonly validation: WorkspacePathProtectionValidation;
    constructor(validation: WorkspacePathProtectionValidation);
}
```

#### `validation`

Versioned validation result describing the rejected path.

```ts
readonly validation: WorkspacePathProtectionValidation;
```

#### `constructor`

Creates a configured protected-path rejection.

```ts
constructor(validation: WorkspacePathProtectionValidation);
```

Parameter:

- validation - Versioned validation result for the protected candidate.

### `WorkspaceRepositoryBindingEvidence`

Classification: `type-only`. Kind: `type alias`.

Read-only Git authority observed for one exact repository binding root.

Signature:

```ts
export type WorkspaceRepositoryBindingEvidence = {
    readonly common_dir: string;
    readonly common_dir_identity: string;
    readonly git_dir: string;
    readonly git_dir_identity: string;
    readonly object_format: string;
    readonly repository_id: string;
    readonly root: string;
};
```

### `WorkspaceState`

Classification: `type-only`. Kind: `type alias`.

Frozen validated workspace initialization state.

Signature:

```ts
export type WorkspaceState = {
    readonly adoption: WorkspaceAdoption;
    readonly control_path: string;
    readonly format: string;
    readonly format_version: number;
    readonly git: WorkspaceGitState;
    readonly initialize_git: boolean;
    readonly root_path: string;
};
```

### `WorldCarrierError`

Classification: `runtime-and-type`. Kind: `class`.

Raised when copy-carrier custody or its retained evidence is unavailable or invalid.

Signature:

```ts
export declare class WorldCarrierError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
```

#### `code`

Stable machine-readable carrier failure code.

```ts
readonly code: string;
```

#### `constructor`

Creates a reference copy-carrier failure.

```ts
constructor(code: string, message: string);
```

Parameter:

- code - Configured machine-readable failure code.

Parameter:

- message - Diagnostic describing the rejected operation or evidence.

### `WorldChangeNode`

Classification: `type-only`. Kind: `type alias`.

Closed semantic state of one path in a world revision.

Signature:

```ts
export type WorldChangeNode = {
    readonly kind: (typeof WORLD_ENTRY_KINDS)[0];
    readonly mode: number;
} | {
    readonly byte_length: number;
    readonly content_id: string;
    readonly kind: (typeof WORLD_ENTRY_KINDS)[1];
    readonly mode: number;
} | {
    readonly kind: (typeof WORLD_ENTRY_KINDS)[2];
    readonly mode: null;
    readonly target: string;
};
```

### `WorldChangeOperation`

Classification: `type-only`. Kind: `type alias`.

Configured semantic operation for one canonical changed path.

Signature:

```ts
export type WorldChangeOperation = (typeof WORLD_CHANGE_OPERATIONS)[number];
```

### `WorldChangeset`

Classification: `type-only`. Kind: `type alias`.

Immutable content-addressed comparison of two ordered world revisions.

Signature:

```ts
export type WorldChangeset = {
    readonly base_revision_id: string;
    readonly binding_id: string;
    readonly changes: readonly WorldPathChange[];
    readonly changeset_id: string;
    readonly changed_paths: readonly string[];
    readonly head_revision_id: string;
    readonly schema_version: number;
};
```

### `WorldChangesetError`

Classification: `runtime-and-type`. Kind: `class`.

Raised when a pure world changeset cannot be constructed safely and exactly.

Signature:

```ts
export declare class WorldChangesetError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
```

#### `code`

Stable machine-readable changeset failure code.

```ts
readonly code: string;
```

#### `constructor`

Creates a world-changeset validation failure.

```ts
constructor(code: string, message: string);
```

Parameter:

- code - Configured machine-readable failure code.

Parameter:

- message - Diagnostic describing the rejected comparison.

### `WorldChangesetInspection`

Classification: `type-only`. Kind: `type alias`.

Authenticated read-only projection over one retained world changeset.

Signature:

```ts
export type WorldChangesetInspection = {
    readonly changeset: WorldChangeset;
    readonly inspection_version: number;
    readonly change: (path: string) => WorldPathChange | null;
    readonly derivedMoves: () => readonly WorldDerivedMove[];
    readonly page: (options?: WorldChangesetPageOptions) => WorldChangesetPage;
    readonly readContent: (options: WorldContentReadOptions) => Promise<WorldContentRead>;
    readonly previewText: (options: WorldTextPreviewOptions) => Promise<WorldTextPreview>;
};
```

### `WorldChangesetInspectionOptions`

Classification: `type-only`. Kind: `type alias`.

Closed options accepted by createWorldChangesetInspection.

Signature:

```ts
export type WorldChangesetInspectionOptions = WorldChangesetOptions;
```

### `WorldChangesetOptions`

Classification: `type-only`. Kind: `type alias`.

Closed options accepted by createWorldChangeset.

Signature:

```ts
export type WorldChangesetOptions = {
    readonly baseRevision: WorldRevision;
    readonly carrier: ReferenceCopyCarrier;
    readonly headRevision: WorldRevision;
};
```

### `WorldChangesetPage`

Classification: `type-only`. Kind: `type alias`.

One immutable bounded page of canonical world changes.

Signature:

```ts
export type WorldChangesetPage = {
    readonly changes: readonly WorldPathChange[];
    readonly next_offset: number | null;
    readonly offset: number;
    readonly total: number;
};
```

### `WorldChangesetPageOptions`

Classification: `type-only`. Kind: `type alias`.

Closed bounded pagination options for canonical world changes.

Signature:

```ts
export type WorldChangesetPageOptions = {
    readonly limit?: number;
    readonly offset?: number;
};
```

### `WorldContentRead`

Classification: `type-only`. Kind: `type alias`.

One authenticated bounded retained-content byte slice.

Signature:

```ts
export type WorldContentRead = {
    readonly bytes: Uint8Array;
    readonly content_id: string;
    readonly offset: number;
    readonly total_bytes: number;
    readonly truncated: boolean;
};
```

### `WorldContentReadOptions`

Classification: `type-only`. Kind: `type alias`.

Closed bounded options for reading authenticated retained content.

Signature:

```ts
export type WorldContentReadOptions = {
    readonly contentId: string;
    readonly length?: number;
    readonly offset?: number;
};
```

### `WorldCustody`

Classification: `type-only`. Kind: `type alias`.

Mutable retained checkout forked from an immutable copy-world revision.

Signature:

```ts
export type WorldCustody = {
    readonly backend: string;
    readonly base_content_id: string;
    readonly base_revision_id: string;
    readonly binding_id: string;
    readonly custody_id: string;
    readonly descriptor_version: number;
    readonly path: string;
};
```

### `WorldDerivedMove`

Classification: `type-only`. Kind: `type alias`.

One deterministic exact-content move projection outside canonical changeset identity.

Signature:

```ts
export type WorldDerivedMove = {
    readonly content_id: string;
    readonly kind: (typeof WORLD_DERIVED_MOVE_KINDS)[number];
    readonly source_path: string;
    readonly target_path: string;
};
```

### `WorldEntryKind`

Classification: `type-only`. Kind: `type alias`.

Configured logical entry kind represented by a copy-carrier manifest.

Signature:

```ts
export type WorldEntryKind = (typeof WORLD_ENTRY_KINDS)[number];
```

### `WorldManifestEntry`

Classification: `type-only`. Kind: `type alias`.

One canonical logical filesystem entry retained by the reference carrier.

Signature:

```ts
export type WorldManifestEntry = {
    readonly blob_id: string | null;
    readonly kind: WorldEntryKind;
    readonly mode: number | null;
    readonly path: string;
    readonly size: number | null;
    readonly symlink_target: string | null;
};
```

### `WorldPathChange`

Classification: `type-only`. Kind: `type alias`.

One canonical reconstructive path change between two exact world revisions.

Signature:

```ts
export type WorldPathChange = {
    readonly after: WorldChangeNode | null;
    readonly before: WorldChangeNode | null;
    readonly operation: WorldChangeOperation;
    readonly path: string;
};
```

### `WorldRevision`

Classification: `type-only`. Kind: `type alias`.

Immutable verified copy-world revision retained under carrier custody.

Signature:

```ts
export type WorldRevision = {
    readonly backend: string;
    readonly binding_id: string;
    readonly basis_ref: string | null;
    readonly capture_kind: string;
    readonly content_id: string;
    readonly descriptor_version: number;
    readonly manifest: readonly WorldManifestEntry[];
    readonly path: string;
    readonly parent_revision_id: string | null;
    readonly revision_id: string;
};
```

### `WorldTextPreview`

Classification: `type-only`. Kind: `type alias`.

One authenticated bounded text or binary classification.

Signature:

```ts
export type WorldTextPreview = {
    readonly byte_length: number;
    readonly classification: (typeof WORLD_TEXT_PREVIEW_CLASSIFICATIONS)[0];
    readonly content_id: string;
    readonly encoding: typeof WORLD_TEXT_PREVIEW_ENCODING;
    readonly text: string;
    readonly truncated: boolean;
} | {
    readonly byte_length: number;
    readonly classification: (typeof WORLD_TEXT_PREVIEW_CLASSIFICATIONS)[1];
    readonly content_id: string;
    readonly encoding: null;
    readonly text: null;
    readonly truncated: boolean;
};
```

### `WorldTextPreviewOptions`

Classification: `type-only`. Kind: `type alias`.

Closed bounded options for an authenticated retained text preview.

Signature:

```ts
export type WorldTextPreviewOptions = {
    readonly contentId: string;
    readonly maxBytes?: number;
    readonly maxLines?: number;
};
```

### `WorldVerification`

Classification: `type-only`. Kind: `type alias`.

Structured verification evidence for a retained revision or mutable custody.

Signature:

```ts
export type WorldVerification = {
    readonly content_id: string;
    readonly modified: boolean;
    readonly manifest: readonly WorldManifestEntry[];
};
```

### `acknowledgeDurableTaskCancellation`

Classification: `runtime-only`. Kind: `function`.

Acknowledges command-authorized cancellation at the exact current worker safe boundary.

Terminal evidence and claim release commit atomically. The resulting cut is then published
deterministically; exact acknowledgement replay reconstructs the retained cancelled result.

Signature:

```ts
export declare function acknowledgeDurableTaskCancellation(store: SQLiteTraceStore, options: DurableTaskCancellationAcknowledgementOptions): DurableTaskExecutionResult;
```

Parameter:

- store - Open trace store containing the running execution and cancellation command.

Parameter:

- options - Exact command and worker authority reaching the safe boundary.

Returns:

- Immutable cancelled execution and durable terminal receipt.

Throws:

- {TypeError} If options or command evidence are malformed.

Throws:

- {TraceStoreError} If lifecycle, command, or worker authority is inconsistent.

Throws:

- {DurableExecutionClaimFencedError} If the worker is no longer authoritative.

Example:

- ```ts
const cancelled = acknowledgeDurableTaskCancellation(store, {
    cancelCommandRecordId: command.record_id,
    claimId,
    expectedLifecycleRecordId: startedRecordId,
    fencingToken,
    runId: "run:42",
});
cancelled.execution.outcome.outcome.status;
```

### `acknowledgeDurableTaskSuspension`

Classification: `runtime-only`. Kind: `function`.

Atomically acknowledges a command-authorized durable suspension and releases the worker fence.

The immutable cut is published through the expected running record before the transaction. The
transaction then validates the exact current claim, pause command, lifecycle head, cut, and
resumable constituent evidence; appends the continuation descriptor and suspension
acknowledgement; and releases the claim. Exact replay returns the retained receipt.

Signature:

```ts
export declare function acknowledgeDurableTaskSuspension(store: SQLiteTraceStore, options: DurableTaskSuspensionOptions): DurableTaskSuspensionReceipt;
```

Parameter:

- store - Open trace store containing the running execution and pause command.

Parameter:

- options - Exact running authority, cut, pause command, and checkpoint evidence.

Returns:

- Canonical continuation and suspension acknowledgement identities.

Throws:

- {TypeError} If options or constituent evidence are malformed or unavailable.

Throws:

- {TraceStoreError} If the running authority, pause command, or cut is inconsistent.

Throws:

- {AppendIntentConflictError} If the same suspension intent names different evidence.

### `acknowledgeDurableTaskWaiting`

Classification: `runtime-only`. Kind: `function`.

Atomically acknowledges prerequisite-driven waiting and releases the worker fence.

The immutable cut is published through the exact running head before one store transaction
validates the current claim and lifecycle, appends the continuation descriptor plus explicit
prerequisite acknowledgement, and releases the worker. Exact replay returns retained evidence.

Signature:

```ts
export declare function acknowledgeDurableTaskWaiting(store: SQLiteTraceStore, options: DurableTaskWaitingOptions): DurableTaskWaitingReceipt;
```

Parameter:

- store - Open trace store containing the running execution.

Parameter:

- options - Exact running authority, cut, prerequisite, and checkpoint evidence.

Returns:

- Canonical continuation and waiting acknowledgement identities.

Throws:

- {TypeError} If options or constituent evidence are malformed or unavailable.

Throws:

- {TraceStoreError} If the running authority, lifecycle head, or cut is inconsistent.

Throws:

- {AppendIntentConflictError} If the same waiting intent names different evidence.

### `activeExecutionRelations`

Classification: `runtime-only`. Kind: `function`.

Selects the latest still-active transition for every relation identity.

Signature:

```ts
export declare function activeExecutionRelations(relations: readonly ExecutionRelation[]): readonly ExecutionRelation[];
```

Parameter:

- relations - Retained relation transitions in owner order.

Returns:

- Frozen active spawned or adopted relations.

### `applyRetainedWorldSettlement`

Classification: `runtime-only`. Kind: `function`.

Durably applies one exact admitted retained output and recovers interrupted publication.

On an unchanged user basis this degenerates to the candidate head while retaining a distinct
applied settlement. On an advanced basis it requires path-disjoint deltas, constructs one exact
merged revision from current plus candidate changes, and publishes that revision recoverably.

Signature:

```ts
export declare function applyRetainedWorldSettlement(options: ApplyRetainedWorldSettlementOptions): Promise<AppliedRetainedWorldSettlement>;
```

Parameter:

- options - Exact output identity plus canonical binding, carrier, and trace-store authority.

Returns:

- Frozen applied result citing the exact carrier publication and applied revision.

Throws:

- {RetainedWorldSettlementInvalidError} If trace, revision, basis, carrier, or publication
evidence is absent, moved, malformed, forged, or inconsistent.

Throws:

- {RetainedWorldSettlementConflictError} If another action owns the admission or terminal.

Example:

- ```ts
const applied = await applyRetainedWorldSettlement({
    binding,
    carrier,
    outputId: captured.output.output_id,
    store,
});
applied.applied_revision_id;
```

### `cancelDurableTask`

Classification: `runtime-only`. Kind: `function`.

Atomically cancels a created, waiting, or suspended durable run.

The globally idempotent command, cancelled outcome, and terminal lifecycle commit in one store
transaction after exact-head comparison. Any retained pre-start or released claim is expired in
that transaction. Running workers must use requestDurableTaskCancellation and
acknowledgeDurableTaskCancellation instead.

Signature:

```ts
export declare function cancelDurableTask(store: SQLiteTraceStore, options: DurableTaskDirectCancellationOptions): DurableTaskExecutionResult;
```

Parameter:

- store - Open trace store containing the inactive durable execution.

Parameter:

- options - Exact command, run, inactive lifecycle head, and reason contract.

Returns:

- Immutable cancelled execution and durable terminal receipt.

Throws:

- {TypeError} If options are malformed.

Throws:

- {TraceStoreError} If lifecycle authority is active, stale, or inconsistent.

Throws:

- {AppendIntentConflictError} If command identity already names different content.

Example:

- ```ts
const cancelled = cancelDurableTask(store, {
    commandId: "command:cancel:created:42",
    expectedLifecycleRecordId: createdRecordId,
    reason: "operator request",
    runId: "run:42",
});
cancelled.execution.outcome.outcome.status;
```

### `canonicalizeRecord`

Classification: `runtime-only`. Kind: `function`.

Serializes a semantic record deterministically.

Object keys are sorted recursively, array order is preserved, undefined
object properties are omitted, and unsupported JSON values are rejected.

Signature:

```ts
export declare function canonicalizeRecord(record: SemanticRecord): string;
```

Parameter:

- record - The plain semantic record to serialize.

Returns:

- The record encoded as deterministic, whitespace-free JSON.

Throws:

- {TypeError} If the record contains unsupported values, malformed
Unicode, accessors, custom array properties, or cycles.

Example:

- ```ts
canonicalizeRecord({ operation: "task.started", ordinal: 1 });
// '{"operation":"task.started","ordinal":1}'
```

### `captureGrantedTaskWorldDurably`

Classification: `runtime-only`. Kind: `function`.

Executes one retained-world task under an authenticated exact repository grant plan.

Admission authenticates every resource in the plan before runner or provider invocation. The
active capability exposes only the intersection of the task grant and whole-run ceiling.
Enforcement is in-process advisory; this function does not claim an OS sandbox or syscall jail.

Signature:

```ts
export declare function captureGrantedTaskWorldDurably<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>>(options: CaptureGrantedTaskWorldOptions<I, O>): Promise<TaskWorldCaptureResult>;
```

Parameter:

- options - Exact granted task-world capture contract.

Returns:

- Durable task result, canonical changeset, and retained world attachment.

Throws:

- {TypeError} If the plan, task, resource, authority, or options are invalid.

Throws:

- {TraceStoreError} If durable execution or terminal publication fails closed.

Throws:

- {WorldCarrierError} If retained carrier evidence cannot be verified or captured.

Throws:

- {WorldChangesetError} If the captured comparison is invalid or exceeds limits.

Example:

- ```ts
const result = await captureGrantedTaskWorldDurably({
    ...captureOptions,
    repositoryGrantPlan,
});
```

### `captureJailedGrantedTaskWorldDurably`

Classification: `runtime-only`. Kind: `function`.

Executes one granted retained-world task through an authenticated native syscall jail.

The structured judged process runs before provider invocation. Its confinement plan is compiled
from the selected binding's exact effective write grant, and execution continues only after a
successful exit and proven process-group quiescence.

Signature:

```ts
export declare function captureJailedGrantedTaskWorldDurably<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>>(options: CaptureJailedGrantedTaskWorldOptions<I, O>): Promise<JailedTaskWorldCaptureResult>;
```

Parameter:

- options - Exact granted capture contract plus authenticated native-jail resolution.

Returns:

- Durable task-world result with exact native placement and process receipt.

Throws:

- {TypeError} If placement, grant, task, resource, runner, or options are inconsistent.

Throws:

- {NativeJailExecutionError} If launch, exit, cancellation, timeout, output, or quiescence fails.

Example:

- ```ts
const result = await captureJailedGrantedTaskWorldDurably({
    ...grantedCaptureOptions,
    nativeJailResolution,
    runner: nativeRunner,
});
result.process.quiescence;
```

### `capturePlacedGrantedTaskWorldDurably`

Classification: `runtime-only`. Kind: `function`.

Executes one granted retained-world task under exact requested/resolved placement evidence.

Signature:

```ts
export declare function capturePlacedGrantedTaskWorldDurably<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>>(options: CapturePlacedGrantedTaskWorldOptions<I, O>): Promise<PlacedTaskWorldCaptureResult>;
```

Parameter:

- options - Exact granted capture contract plus authenticated placement resolution.

Returns:

- Durable task, retained world, changeset, and immutable placement evidence.

Throws:

- {TypeError} If placement, grant, task, resource, runner, or options are inconsistent.

Throws:

- {TraceStoreError} If durable execution or terminal publication fails closed.

Throws:

- {WorldCarrierError} If retained carrier evidence cannot be verified or captured.

Throws:

- {WorldChangesetError} If the captured comparison is invalid or exceeds limits.

Example:

- ```ts
const result = await capturePlacedGrantedTaskWorldDurably({
    ...grantedCaptureOptions,
    placementResolution,
});
result.placement.resolved_placement;
```

### `captureRunContinuationCheckpoints`

Classification: `runtime-only`. Kind: `function`.

Collects exact continuation evidence from every configured checkpoint adapter.

Collection performs no trace-store mutation. Callers invoke it only after the worker has reached
a safe boundary with no provider, effect, or world mutation in flight. The returned evidence can
be retried through acknowledgeDurableTaskSuspension without rerunning adapters.

Signature:

```ts
export declare function captureRunContinuationCheckpoints(options: RunContinuationCheckpointOptions): Promise<readonly RunContinuationCheckpointEvidence[]>;
```

Parameter:

- options - Exact run boundary and ordered configured adapters.

Returns:

- Frozen ordered checkpoint evidence.

Throws:

- {TypeError} If options, adapters, or returned evidence are malformed or reordered.

### `captureTaskWorldDurably`

Classification: `runtime-only`. Kind: `function`.

Executes one registered runner against isolated custody and retains its verified world output.

Runner authentication, every filesystem operation, immutable capture, and terminal publication
share the existing durable invocation fence. The user binding is observed before and after but
never supplied as runner authority. The captured record commits atomically before the ordinary
outcome and lifecycle terminal and is therefore included in the same immutable cut.

Signature:

```ts
export declare function captureTaskWorldDurably<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>>(options: CaptureTaskWorldOptions<I, O>): Promise<TaskWorldCaptureResult>;
```

Parameter:

- options - Exact store, execution, binding, carrier, base, capture, and runner contract.

Returns:

- Durable task result, canonical changeset, and retained world attachment.

Throws:

- {TypeError} If authority, options, runner output, or relative paths are malformed.

Throws:

- {TraceStoreError} If durable execution or terminal publication fails closed.

Throws:

- {WorldCarrierError} If retained carrier evidence cannot be verified or captured.

Throws:

- {WorldChangesetError} If the captured comparison is invalid or exceeds limits.

Example:

- ```ts
const result = await captureTaskWorldDurably({
    baseRevision,
    binding,
    captureId: "capture:review:1",
    carrier,
    execution: { task, input, provider, runId: "run:review:1", budget: { maxTurns: 1 } },
    runner,
    store,
});
result.output.head_revision_id;
```

### `classifyProofEnvelope`

Classification: `runtime-only`. Kind: `function`.

Classifies untrusted trace evidence at the strongest executable claim this runtime can defend.

Missing, malformed, unsupported, or lifecycle-inconsistent evidence returns a frozen
`runtime_only` envelope. A complete trace or valid live prefix with an exact static-program
identity receives only `reference_validated`; this function never infers Lean-backed proof
coverage, lowering adequacy, Core-0H sidecar authority, or theorem-artifact validity.

Signature:

```ts
export declare function classifyProofEnvelope(options: ProofEnvelopeClassificationOptions): ProofEnvelope;
```

Parameter:

- options - Completion mode, optional static program identity, and ordered trace evidence.

Returns:

- A frozen conservative proof envelope with explicit production-runtime exclusions.

Throws:

- {TypeError} If the top-level options container is malformed.

Example:

- ```ts
const envelope = classifyProofEnvelope({
    completed: false,
    programRef,
    trace: declarationPrefix,
});
envelope.reference_validated;
```

### `createEffectHandlerStack`

Classification: `runtime-only`. Kind: `function`.

Creates an immutable exact-kind effect handler stack.

Definitions are validated and snapshotted in installation order. The active protocol selects
the last matching handler, mirroring nearest dynamically scoped handler precedence.

Signature:

```ts
export declare function createEffectHandlerStack(handlers: readonly EffectHandler[]): EffectHandlerStack;
```

Parameter:

- handlers - Ordered exact-kind handler definitions.

Returns:

- An immutable stack that validates intents before invoking a handler.

Throws:

- {TypeError} If the handler array or any definition is malformed or IDs are duplicated.

Example:

- ```ts
const handlers = createEffectHandlerStack([{
    handlerId: "local.tool",
    kind: "tool.call",
    handle: (intent) => ({ ok: true, value: intent.effect_id }),
}]);
const dispatch = await handlers.dispatch(intent);
```

### `createEffectIntent`

Classification: `runtime-only`. Kind: `function`.

Creates the immutable versioned record emitted before an effect may materialize.

Signature:

```ts
export declare function createEffectIntent<K extends string, P extends SemanticValue>(definition: EffectIntentDefinition<K, P>): EffectIntent<K, P>;
```

Parameter:

- definition - Typed identity, family, payload, and reversibility declaration.

Returns:

- A deeply frozen canonical effect intent.

Throws:

- {TypeError} If the definition or payload is malformed.

Example:

- ```ts
const intent = createEffectIntent({
    effectId: "effect:tool:1",
    kind: "tool.call",
    payload: { command: "pnpm test" },
    reversibility: "irreversible",
});
```

### `createEffectOutcome`

Classification: `runtime-only`. Kind: `function`.

Creates an immutable outcome bound to the complete canonical effect intent.

Signature:

```ts
export declare function createEffectOutcome<K extends string, P extends SemanticValue, V extends SemanticValue, E extends SemanticValue = SemanticValue>(intent: EffectIntent<K, P>, result: EffectResult<V, E>): EffectOutcome<K, V, E>;
```

Parameter:

- intent - Valid canonical intent that preceded world interaction.

Parameter:

- result - Typed success value or failure information returned by the world.

Returns:

- A deeply frozen canonical outcome containing the intent digest.

Throws:

- {TypeError} If the intent or result is malformed.

Example:

- ```ts
const outcome = createEffectOutcome(intent, {
    ok: true,
    value: { exitCode: 0 },
});
```

### `createGitAwareCustody`

Classification: `runtime-only`. Kind: `function`.

Creates workspace protocol v4 Git-aware baseline and retained-output custody.

Git inspection is read-only. Managed output is materialized under protected control storage and
delegated to the workspace protocol v3 copy carrier; ordinary refs, index, config, and files are
never mutated by this API.

Signature:

```ts
export declare function createGitAwareCustody(options: GitAwareCustodyOptions): GitAwareCustody;
```

Parameter:

- options - Exact initialized workspace owning Git-aware custody.

Returns:

- Frozen capture, reopen, verify, and discard operations.

Throws:

- {GitCustodyError} If repository or custody evidence is unavailable or unsafe.

Throws:

- {WorkspaceControlError} If workspace control state cannot be reopened.

Throws:

- {TypeError} If options are malformed.

### `createGitChangesetInspection`

Classification: `runtime-only`. Kind: `function`.

Opens an authenticated Git-aware changeset projection over two retained outputs.

The canonical copy-world changeset remains authoritative. Gitlink commit citations and retained
symbolic-link modes are read-only presentation evidence and never affect its identity.

Signature:

```ts
export declare function createGitChangesetInspection(options: GitChangesetInspectionOptions): Promise<GitChangesetInspection>;
```

Parameter:

- options - Exact retained Git custody identities and their initialized workspace.

Returns:

- Frozen canonical world inspection plus Git-aware presentation changes.

Throws:

- {WorldChangesetError} If retained carrier or Git evidence is unavailable or inconsistent.

Example:

- ```ts
const inspection = await createGitChangesetInspection({
  baseCustodyId,
  headCustodyId,
  workspaceRoot,
});
console.log(inspection.git_changes);
```

### `createGitRepositoryBindings`

Classification: `runtime-only`. Kind: `function`.

Creates stable repository-aware authorities for a complete disjoint binding set.

Each root must be the exact top level of one supported non-bare Git worktree. Repositories are
inspected through read-only Git plumbing, and linked worktrees sharing one common repository
cannot be returned as distinct repository authorities in the same set.

Signature:

```ts
export declare function createGitRepositoryBindings(options: WorkspaceBindingOptions): GitRepositoryBindingSet;
```

Parameter:

- options - Initialized workspace and complete proposed repository binding set.

Returns:

- Frozen ordered repository-backed authorities with stable resource identities.

Throws:

- {WorkspaceBindingError} If a root is not an exact supported repository or two bindings
identify the same common Git repository.

Throws:

- {WorkspaceControlError} If workspace control evidence cannot be opened safely.

Throws:

- {TypeError} If the options or binding definitions are malformed.

### `createGitRepositoryGrantPlan`

Classification: `runtime-only`. Kind: `function`.

Admits exact repository resources and applies a non-amplifying whole-run authority ceiling.

Signature:

```ts
export declare function createGitRepositoryGrantPlan<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>>(options: GitRepositoryGrantPlanOptions<I, O>): GitRepositoryGrantPlan;
```

Parameter:

- options - Authenticated granted task, complete repository binding set, and global ceiling.

Returns:

- Frozen authenticated grant plan bound to every exact repository resource identity.

Throws:

- {TypeError} If the definition is malformed, forged, incomplete, duplicated, or mismatched.

Example:

- ```ts
const plan = createGitRepositoryGrantPlan({
    authorityCeiling: "read-only",
    bindings: repositoryBindings.bindings,
    task: granted,
});
```

### `createGrantedPlacementResolution`

Classification: `runtime-only`. Kind: `function`.

Resolves one explicit placement request for an exact granted run and capture.

The current protocol can resolve only to advisory in-process execution. `auto` records its
fallback visibly, while explicit `jail` fails closed without returning resolution evidence.

Signature:

```ts
export declare function createGrantedPlacementResolution<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>>(options: GrantedPlacementResolutionOptions<I, O>): GrantedPlacementResolution;
```

Parameter:

- options - Exact request, platform, grant plan, runner, run, and capture contract.

Returns:

- Frozen content-addressed placement resolution.

Throws:

- {TypeError} If options or authenticated authorities are malformed or mismatched.

Throws:

- {PlacementUnavailableError} If the configured request cannot resolve without weakening
enforcement.

Example:

- ```ts
const placement = createGrantedPlacementResolution({
    captureId: "capture:review:1",
    placement: "auto",
    platform,
    repositoryGrantPlan,
    runId: "run:review:1",
    runner,
});
```

### `createNativeJailCommand`

Classification: `runtime-only`. Kind: `function`.

Creates one immutable structured native command without shell interpretation.

Signature:

```ts
export declare function createNativeJailCommand(definition: NativeJailCommandDefinition): NativeJailCommand;
```

Parameter:

- definition - Absolute executable, literal arguments, and explicit environment.

Returns:

- Frozen content-addressed command descriptor.

Throws:

- {TypeError} If the definition, executable, environment, or bounds are invalid.

### `createNativeJailPlacementResolution`

Classification: `runtime-only`. Kind: `function`.

Resolves an explicit `jail` or `auto` request to authenticated native enforcement.

This function accepts only a runner created from a successful real local backend probe. An
unavailable probe cannot produce a runner, so explicit jail fails before resolution or task
execution; callers may use the unchanged advisory resolver for a visible `auto` fallback.

Signature:

```ts
export declare function createNativeJailPlacementResolution<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>>(options: NativeJailPlacementResolutionOptions<I, O>): NativeJailPlacementResolution;
```

Parameter:

- options - Exact placement, platform, grant, runner, run, and capture contract.

Returns:

- Frozen content-addressed native-jail placement resolution.

Throws:

- {TypeError} If options or authenticated authorities are malformed or inconsistent.

Example:

- ```ts
const resolution = createNativeJailPlacementResolution({
    captureId: "capture:review:1",
    placement: "jail",
    platform: probe.platform,
    repositoryGrantPlan,
    runId: "run:review:1",
    runner,
});
```

### `createNativeJailRunner`

Classification: `runtime-only`. Kind: `function`.

Creates one opaque native-jail runner bound to a successful real local backend probe.

The judged command is an absolute executable plus literal argv and an explicit environment;
no shell is created and ambient environment variables are not inherited.

Signature:

```ts
export declare function createNativeJailRunner<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>>(definition: NativeJailRunnerDefinition): NativeJailRunner<I, O>;
```

Parameter:

- definition - Exact command, resource bounds, runner identity, and backend probe.

Returns:

- Opaque authenticated runner reporting native syscall denial.

Throws:

- {TypeError} If the definition, command, executable, or probe is malformed or forged.

Throws:

- {NativeJailUnavailableError} If the authenticated probe did not establish a jail.

Example:

- ```ts
const runner = createNativeJailRunner({
    command: { executable: "/usr/bin/true", arguments: [], environment: [] },
    maxOutputBytes: 65536,
    probe,
    runnerId: "runner:native:1",
    timeoutMilliseconds: 30000,
});
```

### `createPlacementPlatformEvidence`

Classification: `runtime-only`. Kind: `function`.

Classifies one explicit declared environment probe as immutable placement platform evidence.

The probe retains environment-variable names only, never their values. Input injection makes
native macOS, Linux, Windows, WSL, and unsupported classification deterministic in conformance
tests and suitable for future authenticated remote placement adapters. Local placed execution
accepts only evidence returned by inspectLocalPlacementPlatformEvidence.

Signature:

```ts
export declare function createPlacementPlatformEvidence(options: PlacementPlatformEvidenceOptions): PlacementPlatformEvidence;
```

Parameter:

- options - Exact Node platform, OS release, and present environment-variable names.

Returns:

- Frozen content-addressed platform evidence.

Throws:

- {TypeError} If options or probe values are malformed or ambiguous.

Example:

- ```ts
const platform = createPlacementPlatformEvidence({
    nodePlatform: process.platform,
    osRelease: release(),
    environmentVariables: Object.keys(process.env),
});
```

### `createRecordEnvelope`

Classification: `runtime-only`. Kind: `function`.

Creates a content-addressed record envelope from semantic input.

Causal-parent order is preserved and participates in identity. The returned
`record_id` and `digest` are equal under kernel ABI v0.

Signature:

```ts
export declare function createRecordEnvelope<TBody extends RecordBody>(draft: RecordEnvelopeDraft<TBody>): RecordEnvelope;
```

Parameter:

- draft - Schema, mode, body, witness, and ordered causal references.

Returns:

- The validated semantic envelope.

Throws:

- {TypeError} If a field is malformed or the body cannot be canonicalized.

### `createRecordId`

Classification: `runtime-only`. Kind: `function`.

Creates a stable content-addressed identifier from a semantic record.

The digest algorithm and identifier prefix come from `protocol.config.json`.

Signature:

```ts
export declare function createRecordId(record: SemanticRecord): string;
```

Parameter:

- record - The semantic record whose canonical representation is hashed.

Returns:

- The configured algorithm prefix followed by the hexadecimal digest.

Throws:

- {TypeError} If `record` cannot be canonicalized.

### `createReferenceCopyCarrier`

Classification: `runtime-only`. Kind: `function`.

Creates a workspace protocol v3 reference copy carrier.

The carrier retains immutable snapshots and isolated mutable forks exclusively beneath the
initialized workspace control root. It never mutates the source binding.

Signature:

```ts
export declare function createReferenceCopyCarrier(options: ReferenceCopyCarrierOptions): ReferenceCopyCarrier;
```

Parameter:

- options - Initialized workspace that owns the carrier control storage.

Returns:

- Frozen copy-carrier operations.

Throws:

- {WorldCarrierError} If carrier storage or retained evidence is unsafe or malformed.

Throws:

- {WorkspaceControlError} If workspace control state cannot be reopened.

Throws:

- {TypeError} If options are malformed.

### `createRetainedWorldRunner`

Classification: `runtime-only`. Kind: `function`.

Creates one opaque retained-world runner registration handle.

Construction validates a closed definition and retains the executable callback outside the
public handle. Task 6B.2 owns the first authority-consuming seam and forged-handle rejection.

Signature:

```ts
export declare function createRetainedWorldRunner<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>>(definition: RetainedWorldRunnerDefinition<I, O>): RetainedWorldRunner<I, O>;
```

Parameter:

- definition - Stable identity, actual enforcement, and asynchronous runner callback.

Returns:

- Frozen opaque runner registration handle for retained-world execution integration.

Throws:

- {TypeError} If the definition is open, malformed, or uses unsupported enforcement.

Example:

- ```ts
const runner = createRetainedWorldRunner({
    runnerId: "runner:local:1",
    enforcement: "advisory",
    run: async ({ execution }) => executeTask(execution),
});
```

### `createRunArtifact`

Classification: `runtime-only`. Kind: `function`.

Creates one immutable ordered side-channel artifact record for a run.

Text may be retained inline. Binary content must already have a durable blob receipt, ensuring
the semantic artifact record cites bytes instead of embedding a mutable `Uint8Array`.

Signature:

```ts
export declare function createRunArtifact<C extends RunArtifactContentDefinition>(definition: RunArtifactDefinition<C>): RunArtifact<C>;
```

Parameter:

- definition - Run identity, emission ordinal, artifact identity, content, and metadata.

Returns:

- A deeply frozen canonical run-artifact record.

Throws:

- {TypeError} If the definition, content, metadata, ordinal, or blob receipt is malformed.

Example:

- ```ts
const artifact = createRunArtifact({
    runId: "run:example",
    artifactOrdinal: 0,
    kind: "report",
    name: "summary.txt",
    content: { type: "text", text: "Summary" },
    metadata: { media_type: "text/plain" },
});
```

### `createRunControl`

Classification: `runtime-only`. Kind: `function`.

Creates cooperative resource and cancellation control for one run.

Signature:

```ts
export declare function createRunControl(options: RunControlOptions): RunControl;
```

Parameter:

- options - Per-run limits and an optional caller cancellation signal.

Returns:

- A run control whose signal is passed through async execution boundaries.

Throws:

- {TypeError} If options, budget limits, or the caller signal are malformed.

Example:

- ```ts
const control = createRunControl({ budget: { maxTurns: 20 } });
control.consume({ turns: 1 });
await provider.invoke(request, control.signal);
control.dispose();
```

### `createRunLifecycleTransition`

Classification: `runtime-only`. Kind: `function`.

Validates one transition against the configured normative lifecycle matrix.

This pure builder validates topology and terminal-outcome legality only. Durable command,
checkpoint, receipt, expected-head, and fencing evidence remain obligations of the runtime
transition that cites this value.

Signature:

```ts
export declare function createRunLifecycleTransition(definition: RunLifecycleTransitionDefinition): RunLifecycleTransition;
```

Parameter:

- definition - Closed source, target, and optional terminal-outcome definition.

Returns:

- A frozen validated lifecycle transition.

Throws:

- {TypeError} If the definition is malformed or the transition is not configured.

Example:

- ```ts
const transition = createRunLifecycleTransition({
    source_status: "running",
    target_status: "waiting",
});
```

### `createRunOutcome`

Classification: `runtime-only`. Kind: `function`.

Creates an immutable versioned record for exactly one terminal task-run result.

Signature:

```ts
export declare function createRunOutcome<O extends RunTerminalDefinition>(definition: RunOutcomeDefinition<O>): RunOutcomeFor<O>;
```

Parameter:

- definition - Run identity, exact task lock, and one terminal outcome definition.

Returns:

- A deeply frozen canonical record preserving the exact terminal discriminant.

Throws:

- {TypeError} If the definition, task lock, or terminal payload is malformed.

Example:

- ```ts
const outcome = createRunOutcome({
    runId: "run:example",
    taskArtifactLock: taskDescriptor.artifactLock,
    outcome: { status: "finished", value: { answer: 42 } },
});
```

### `createRunUsage`

Classification: `runtime-only`. Kind: `function`.

Creates one immutable aggregate resource-usage record for a run.

Counts are totals for the complete run, not an individual provider call. An omitted cost is
normalized to `null` so the wire record remains closed and deterministic.

Signature:

```ts
export declare function createRunUsage(definition: RunUsageDefinition): RunUsage;
```

Parameter:

- definition - Run identity and aggregate token and cost totals.

Returns:

- A deeply frozen canonical aggregate run-usage record.

Throws:

- {TypeError} If a field is missing, unexpected, malformed, or negative.

Example:

- ```ts
const usage = createRunUsage({
    runId: "run:example",
    inputTokens: 120,
    outputTokens: 30,
    cacheCreationInputTokens: 10,
    cacheReadInputTokens: 80,
});
```

### `createStaticProvider`

Classification: `runtime-only`. Kind: `function`.

Creates a deterministic offline provider backed by exact cassette exchanges.

Signature:

```ts
export declare function createStaticProvider(definition: StaticProviderDefinition): ModelProvider;
```

Parameter:

- definition - Provider identity and ordered request/response exchanges.

Returns:

- A single-pass provider-neutral model provider.

Throws:

- {TypeError} If the definition is not canonical provider data.

Example:

- ```ts
const provider = createStaticProvider({
    descriptor: { id: "offline-docs", model: "fixture-v1" },
    exchanges: [{ request, response }],
});
await provider.invoke(request, new AbortController().signal);
```

### `createTypedEffectHandler`

Classification: `runtime-only`. Kind: `function`.

Adapts a schema-validated typed callback to an ordinary immutable effect handler.

Signature:

```ts
export declare function createTypedEffectHandler<P>(options: TypedEffectHandlerOptions<P>): EffectHandler;
```

Parameter:

- options - Exact kind/identity, package-created payload schema, and callback.

Returns:

- A frozen handler accepted by createEffectHandlerStack. Direct handle calls also
validate the canonical intent, kind, payload, and returned semantic result.

Throws:

- {TypeError} If options or schema are invalid. Returned handle calls reject invalid
intents, wrong kinds, malformed payloads, or malformed results before exposing them.

Throws:

- Returned handle calls propagate callback errors unchanged.

Example:

- const handler = createTypedEffectHandler({
  handlerId: "format", kind: "text.format",
  payloadSchema: schema.object({ text: schema.string() }),
  handle: ({ text }) => ({ ok: true, value: text.toUpperCase() }),
});

### `createWorkspaceBindings`

Classification: `runtime-only`. Kind: `function`.

Creates workspace protocol v2 stable canonical authorities for a complete disjoint binding set.

Every root is resolved through the filesystem relative to the initialized workspace. Validation
finishes for the complete set before any authority is returned. This function does not create a
retained world or grant runtime access.

Signature:

```ts
export declare function createWorkspaceBindings(options: WorkspaceBindingOptions): WorkspaceBindingSet;
```

Parameter:

- options - Initialized workspace and complete proposed logical binding set.

Returns:

- Frozen ordered binding authorities with stable content-addressed identities.

Throws:

- {WorkspaceBindingError} If a name or root is invalid, escapes workspace authority, is
duplicated, or overlaps another canonical root.

Throws:

- {WorkspaceControlError} If workspace control evidence cannot be opened safely.

Throws:

- {TypeError} If the options or binding definitions are malformed.

### `createWorldChangeset`

Classification: `runtime-only`. Kind: `function`.

Constructs an immutable, content-addressed comparison of two verified world revisions.

The comparison reads only retained carrier custody, never the user workspace, and mutates
neither revision. Each change reconstructs the head manifest from the base manifest exactly.

Signature:

```ts
export declare function createWorldChangeset(options: WorldChangesetOptions): Promise<WorldChangeset>;
```

Parameter:

- options - Exact ordered base and head revisions for one binding.

Returns:

- A frozen canonical changeset with derived changed paths.

Throws:

- {WorldChangesetError} If either revision is malformed, inconsistent, cross-binding, or
exceeds configured changeset limits.

Example:

- ```ts
const changeset = await createWorldChangeset({ baseRevision, carrier, headRevision });
console.log(changeset.changed_paths);
```

### `createWorldChangesetInspection`

Classification: `runtime-only`. Kind: `function`.

Opens an authenticated read-only inspection of two retained world revisions.

Authentication uses the same carrier-owned revision verification as canonical changeset
creation. Lookup and pagination use the frozen projection; bounded content methods authenticate
exact retained blobs without consulting the user workspace.

Signature:

```ts
export declare function createWorldChangesetInspection(options: WorldChangesetInspectionOptions): Promise<WorldChangesetInspection>;
```

Parameter:

- options - Exact retained base/head revisions and their owning carrier.

Returns:

- A frozen inspection with lookup, pagination, content, preview, and move projections.

Throws:

- {WorldChangesetError} If revisions, carrier evidence, requests, or retained bytes fail.

Example:

- ```ts
const inspection = await createWorldChangesetInspection({
  baseRevision,
  carrier,
  headRevision,
});
console.log(inspection.change("src/index.ts"));
```

### `discardRetainedWorldSettlement`

Classification: `runtime-only`. Kind: `function`.

Durably discards one exact admitted retained output and recovers interrupted cleanup.

This is the workspace-protocol-v13 settlement-effect boundary over an exact v12 request.

The deterministic operation is retained before any carrier effect. The logical discarded
terminal receipt is retained before idempotent custody cleanup, so a restart can safely resume
either the pre-cleanup or post-cleanup prefix without reopening admission or touching user files.

Signature:

```ts
export declare function discardRetainedWorldSettlement(options: DiscardRetainedWorldSettlementOptions): Promise<DiscardedRetainedWorldSettlement>;
```

Parameter:

- options - Exact output identity plus authenticated carrier and trace-store authority.

Returns:

- Frozen completed discard receipt after durable cleanup completion.

Throws:

- {RetainedWorldSettlementInvalidError} If trace, journal, revision, custody, or carrier
evidence is absent, malformed, forged, or inconsistent.

Throws:

- {RetainedWorldSettlementConflictError} If the output was admitted for another action or
has already reached another terminal settlement.

Example:

- ```ts
const discarded = await discardRetainedWorldSettlement({
    carrier,
    outputId: captured.output.output_id,
    store,
});
discarded.cleanup_completed;
```

### `executeTask`

Classification: `runtime-only`. Kind: `function`.

Executes one validated bodyless task through a provider-neutral structured boundary.

Signature:

```ts
export declare function executeTask<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>>(options: TaskExecutionOptions<I, O>): Promise<TaskExecutionResult>;
```

Parameter:

- options - Exact task, inferred input, provider, run identity, budget, and cancellation.

Returns:

- Ordered artifacts, terminal outcome, aggregate usage, provider identity, and control.

Throws:

- {TypeError} If caller-owned task input or execution control options are malformed.

Example:

- ```ts
const execution = await executeTask({
    task: greet,
    input: { name: "Ada" },
    provider,
    runId: "run:greet:1",
    budget: { maxTurns: 1 },
});
```

### `executeTaskDurably`

Classification: `runtime-only`. Kind: `function`.

Executes one task while retaining its lifecycle, artifacts, usage, and exact terminal outcome.

Caller-owned options are fully validated before the creation record is appended. Creation and
start are retained at their actual execution boundaries. Ordered artifacts, usage, outcome, and
terminal lifecycle evidence commit atomically, after which an immutable terminal cut is
published. Blob artifacts must cite bytes available in the same store. Sequential retries
reconstruct committed results without provider invocation. Existing incomplete executions must
be advanced through an explicit durable recovery command. A retained start without terminal
evidence fails closed because repeating provider invocation may be unsafe. A durable
first-writer claim prevents concurrent callers from crossing one provider boundary.

Signature:

```ts
export declare function executeTaskDurably<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>>(store: SQLiteTraceStore, options: TaskExecutionOptions<I, O>): Promise<DurableTaskExecutionResult>;
```

Parameter:

- store - Open SQLite trace store receiving execution evidence.

Parameter:

- options - Exact task execution options accepted by {@link executeTask}.

Returns:

- The immutable execution result and its durable record identities and cut.

Throws:

- {TypeError} If execution options or task input are malformed.

Throws:

- {DurableExecutionRecoveryError} If retained start evidence has no terminal result.

Throws:

- {TraceStoreError} If durable append or cut publication fails.

Example:

- ```ts
const durable = await executeTaskDurably(store, {
    task: greet,
    input: { name: "Ada" },
    provider,
    runId: "run:greet:1",
    budget: { maxTurns: 1 },
});
const projected = store.projectExecution(durable.ledger.cut.cut_id);
```

### `grantTaskRepositories`

Classification: `runtime-only`. Kind: `function`.

Binds an explicit canonical repository grant surface to one bodyless task artifact.

Existing task artifacts are not modified: this creates a separate versioned companion artifact
whose identity changes with the grant surface while preserving the exact underlying task digest.

Signature:

```ts
export declare function grantTaskRepositories<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>>(options: GrantTaskRepositoriesOptions<I, O>): RepositoryGrantedTask<I, O>;
```

Parameter:

- options - Exact authenticated task and complete per-binding grant declaration.

Returns:

- Frozen authenticated repository-granted task artifact.

Throws:

- {TypeError} If options, task, bindings, profiles, or duplicates are invalid.

Example:

- ```ts
const granted = grantTaskRepositories({
    task: descriptor,
    grants: [{ binding: "source", profile: "read-write" }],
});
```

### `initializeWorkspace`

Classification: `runtime-only`. Kind: `function`.

Initializes or exactly reuses workspace control state without modifying ordinary Git history.

The root must already exist. When authorized and no containing Git repository exists, this
function runs `git init` but never creates a commit, stages files, or rewrites refs. Adoption
records only the baseline citation needed by later carrier slices; it does not materialize a
retained world.

Signature:

```ts
export declare function initializeWorkspace(options: WorkspaceInitializationOptions): WorkspaceState;
```

Parameter:

- options - Closed initialization options and existing workspace root.

Returns:

- Frozen validated workspace state.

Throws:

- {WorkspaceControlError} If filesystem, Git, or retained control evidence is unsafe.

Throws:

- {WorkspaceInitializationConflictError} If retained options differ from this request.

Throws:

- {TypeError} If options are malformed.

### `inspectDurableTaskExecution`

Classification: `runtime-only`. Kind: `function`.

Projects validated durable task-execution evidence into an immutable inspection view.

The view is rebuilt from canonical retained records on every call. It stores no materialized
state, never invokes a provider, and uses the same fail-closed validation as durable recovery.
Later owner records outside the terminal evidence chain do not change a committed view.

Signature:

```ts
export declare function inspectDurableTaskExecution(store: SQLiteTraceStore, runId: string): DurableTaskExecutionInspection;
```

Parameter:

- store - Open trace store containing durable task-execution evidence.

Parameter:

- runId - Stable durable run owner to inspect.

Returns:

- Lifecycle, quiescent continuation, artifact, usage, outcome, cut, and causal evidence.

Throws:

- {TypeError} If the run identity is malformed.

Throws:

- {TraceStoreError} If retained evidence is missing, malformed, or inconsistent.

Example:

- ```ts
const inspection = inspectDurableTaskExecution(store, "run:greet:1");
if (inspection.status === "committed") {
    inspection.artifacts;
    inspection.causal_edges;
}
```

### `inspectLocalNativeJailBackend`

Classification: `runtime-only`. Kind: `function`.

Probes the current host for a configured native syscall-jail backend.

An available result requires a real native canary: a write beneath the granted probe root must
land and a sibling write outside that root must be absent. Unsupported platforms and every
executable, profile, or launch failure return immutable unavailable evidence.

Signature:

```ts
export declare function inspectLocalNativeJailBackend(): Promise<NativeJailBackendProbeEvidence>;
```

Returns:

- Frozen content-addressed local backend probe evidence.

Example:

- ```ts
const probe = await inspectLocalNativeJailBackend();
if (probe.status !== "available") throw new Error(probe.reason);
```

### `inspectLocalPlacementPlatformEvidence`

Classification: `runtime-only`. Kind: `function`.

Inspects the current Node host and returns authenticated placement platform evidence.

Environment-variable values are never read or retained; only configured WSL marker names may
appear in the resulting evidence.

Signature:

```ts
export declare function inspectLocalPlacementPlatformEvidence(): PlacementPlatformEvidence;
```

Returns:

- Frozen content-addressed classification of the current execution host.

### `inspectRetainedWorldApplicationConflicts`

Classification: `runtime-only`. Kind: `function`.

Computes bounded portable equal/prefix/alias conflicts without granting apply authority.

Signature:

```ts
export declare function inspectRetainedWorldApplicationConflicts(options: InspectRetainedWorldApplicationConflictsOptions): RetainedWorldApplicationConflictEvidence | null;
```

Parameter:

- options - Exact canonical candidate and current changed-path sets.

Returns:

- Content-addressed conflict evidence, or `null` when the sets are disjoint.

Throws:

- {TypeError} If options or canonical path arrays are malformed or exceed limits.

### `inspectRetainedWorldApplicationPlan`

Classification: `runtime-only`. Kind: `function`.

Reads the exact durable three-way application plan without touching carrier or user files.

Signature:

```ts
export declare function inspectRetainedWorldApplicationPlan(store: SQLiteTraceStore, outputId: string): RetainedWorldApplicationPlanEvidence | undefined;
```

Parameter:

- store - Open trace store containing the settlement journal.

Parameter:

- outputId - Exact retained-output identity.

Returns:

- Authenticated application plan after planning, otherwise `undefined`.

Throws:

- {RetainedWorldSettlementInvalidError} If retained operation evidence is malformed.

Throws:

- {TypeError} If the output identity is malformed.

### `inspectRetainedWorldRelease`

Classification: `runtime-only`. Kind: `function`.

Reads one terminal receipt-only release without touching carrier or user files.

Signature:

```ts
export declare function inspectRetainedWorldRelease(store: SQLiteTraceStore, outputId: string): ReleasedRetainedWorldSettlement | undefined;
```

Parameter:

- store - Open trace store containing the settlement journal and execution evidence.

Parameter:

- outputId - Exact retained-output identity.

Returns:

- Frozen release evidence after terminalization, otherwise `undefined`.

Throws:

- {RetainedWorldSettlementInvalidError} If retained release evidence is malformed.

Throws:

- {TypeError} If the output identity is malformed.

### `inspectRetainedWorldSettlement`

Classification: `runtime-only`. Kind: `function`.

Inspects one durable prepared settlement decision and revalidates its immutable trace evidence.

Inspection performs no carrier, provider, runner, or filesystem operation. It verifies the
retained request against the committed execution cut and exact world-capture record before
returning it, and therefore remains safe to use after reopening the trace store.

Signature:

```ts
export declare function inspectRetainedWorldSettlement(store: PrepareRetainedWorldSettlementOptions["store"], outputId: string): PreparedRetainedWorldSettlement | undefined;
```

Parameter:

- store - Open trace store containing settlement and terminal execution evidence.

Parameter:

- outputId - Exact retained-output identity, never a prefix or latest selector.

Returns:

- Frozen prepared decision, or `undefined` when the output has no settlement admission.

Throws:

- {RetainedWorldSettlementInvalidError} If settlement or cited execution evidence is
malformed, missing, or inconsistent.

Throws:

- {TypeError} If the output identity is malformed.

Example:

- ```ts
const settlement = inspectRetainedWorldSettlement(store, captured.output.output_id);
settlement?.request.execution_cut_id;
```

### `inspectTaskWorldCaptureJournal`

Classification: `runtime-only`. Kind: `function`.

Reads one validated durable task-world journal without invoking a runner or carrier.

Signature:

```ts
export declare function inspectTaskWorldCaptureJournal(store: SQLiteTraceStore, runId: string): TaskWorldCaptureJournalInspection;
```

Parameter:

- store - Open trace store containing capture and execution evidence.

Parameter:

- runId - Exact durable run identity to inspect.

Returns:

- Frozen ordered journal prefix and ordinary recovery classification.

Throws:

- {TraceStoreError} If retained execution or capture evidence is malformed.

Throws:

- {TypeError} If the run identity is malformed.

Example:

- ```ts
const journal = inspectTaskWorldCaptureJournal(store, "run:review:1");
journal.transitions.map((transition) => transition.phase);
```

### `inspectWorkspacePathProtection`

Classification: `runtime-only`. Kind: `function`.

Inspects one portable binding-relative path against configured protected workspace roots.

Comparison applies the configured Unicode normalization, case folding, trailing-character, and
alternate-name rules. Existing filesystem prefixes are resolved so symbolic-link aliases fail
closed even when the final descendant does not yet exist. This function performs no mutation.

Signature:

```ts
export declare function inspectWorkspacePathProtection(options: WorkspacePathProtectionOptions): WorkspacePathProtectionValidation;
```

Parameter:

- options - Exact workspace, binding, and candidate path authority.

Returns:

- Frozen versioned validation evidence.

Throws:

- {TypeError} If the options, roots, or portable candidate path are malformed.

Example:

- ```ts
const result = inspectWorkspacePathProtection({
    bindingRoot: workspace.root_path,
    path: "src/index.ts",
    workspaceRoot: workspace.root_path,
});
console.log(result.protected);
```

### `inspectWorkspacePlatformConformance`

Classification: `runtime-only`. Kind: `function`.

Inspects the configured retained-custody policy for the current host without mutating user files.

Signature:

```ts
export declare function inspectWorkspacePlatformConformance(options: WorkspacePlatformConformanceOptions): WorkspacePlatformConformance;
```

Parameter:

- options - Exact initialized workspace to validate before returning host policy.

Returns:

- Frozen configured platform and parity evidence.

Throws:

- {WorkspaceControlError} If the workspace cannot be reopened safely.

Throws:

- {TypeError} If options are malformed or the host has no configured policy.

Example:

- ```ts
const policy = inspectWorkspacePlatformConformance({ workspaceRoot });
policy.metadata_policy;
```

### `isPublicError`

Classification: `runtime-only`. Kind: `function`.

Tests whether an unknown failure implements the stable structured public-error contract.

Validation and callback failures intentionally remain ordinary errors unless their exported
class owns a configured code. This guard reads no message, stack, cause, path, or evidence.

Signature:

```ts
export declare function isPublicError(value: unknown): value is PublicError;
```

Parameter:

- value - Unknown caught value to classify in memory.

Returns:

- Whether the value is an Error with a stable machine-readable public code.

### `listOutputCitations`

Classification: `runtime-only`. Kind: `function`.

Lists a bounded page of exact retained-world output citations in canonical record/run order.

Signature:

```ts
export declare function listOutputCitations(store: SQLiteTraceStore, options?: LedgerListOptions): readonly OutputCitationEntry[];
```

Parameter:

- store - Open trace store containing durable retained-world evidence.

Parameter:

- options - Optional closed configured pagination object.

Returns:

- Frozen immutable output citation entries.

Throws:

- {TraceStoreError} If retained run, output, cut, or settlement evidence is corrupt.

Throws:

- {TypeError} If options or projected evidence violate configured bounds.

Example:

- ```ts
const outputs = listOutputCitations(store, { limit: 25, offset: 0 });
```

### `listRecoveryRecords`

Classification: `runtime-only`. Kind: `function`.

Lists bounded durable recovery/control projections in canonical run-ledger order.

Signature:

```ts
export declare function listRecoveryRecords(store: SQLiteTraceStore, options?: LedgerListOptions): readonly RecoveryRecordEntry[];
```

Parameter:

- store - Open trace store containing durable execution evidence.

Parameter:

- options - Optional closed configured pagination object.

Returns:

- Frozen immutable recovery record entries.

Throws:

- {TraceStoreError} If retained lifecycle, command, or cut evidence is corrupt.

Throws:

- {TypeError} If options or canonical projection bounds are invalid.

### `listRunLedger`

Classification: `runtime-only`. Kind: `function`.

Lists a bounded page of durable executions in canonical creation-record/run-ID byte order.

Signature:

```ts
export declare function listRunLedger(store: SQLiteTraceStore, options?: LedgerListOptions): readonly RunLedgerEntry[];
```

Parameter:

- store - Open trace store containing durable execution evidence.

Parameter:

- options - Optional closed configured pagination object.

Returns:

- Frozen immutable run ledger entries.

Throws:

- {TraceStoreError} If the store is closed or retained evidence is corrupt.

Throws:

- {TypeError} If options, retained evidence, or canonical size are invalid.

Example:

- ```ts
const page = listRunLedger(store, { limit: 25, offset: 0 });
```

### `listTaskLedger`

Classification: `runtime-only`. Kind: `function`.

Lists a bounded page of verified task registrations in canonical identity/version byte order.

Signature:

```ts
export declare function listTaskLedger(registry: SQLiteTaskRegistry, options?: LedgerListOptions, repositoryGrants?: readonly RepositoryGrantedTask<TaskSchema<unknown>, TaskSchema<unknown>>[]): readonly TaskLedgerEntry[];
```

Parameter:

- registry - Open durable task registry.

Parameter:

- options - Optional closed configured pagination object.

Parameter:

- repositoryGrants - Optional authenticated companion grant evidence.

Returns:

- Frozen immutable task ledger entries.

Throws:

- {TaskRegistryError} If the registry is closed or retained data is corrupt.

Throws:

- {TypeError} If options, grants, retained entries, or canonical size are invalid.

Example:

- ```ts
const page = listTaskLedger(registry, { limit: 25, offset: 0 });
```

### `listTraceRevisions`

Classification: `runtime-only`. Kind: `function`.

Lists bounded immutable published-cut trace revisions in canonical publication order.

Signature:

```ts
export declare function listTraceRevisions(store: SQLiteTraceStore, options?: LedgerListOptions): readonly TraceRevisionEntry[];
```

Parameter:

- store - Open trace store containing published cuts.

Parameter:

- options - Optional closed configured pagination object.

Returns:

- Frozen immutable trace revision entries.

Throws:

- {TraceStoreError} If retained cut or slice evidence is corrupt.

Throws:

- {TypeError} If options or canonical projection bounds are invalid.

Example:

- ```ts
const revisions = listTraceRevisions(store, { limit: 25, offset: 0 });
```

### `openWorkspace`

Classification: `runtime-only`. Kind: `function`.

Opens existing workspace control state without mutation.

Signature:

```ts
export declare function openWorkspace(rootPath: string): WorkspaceState;
```

Parameter:

- rootPath - Existing initialized workspace root.

Returns:

- Frozen validated workspace and current Git context.

Throws:

- {WorkspaceControlError} If the root or control evidence is missing, unsafe, malformed,
or inconsistent with required Git evidence.

Throws:

- {TypeError} If `rootPath` is malformed.

### `planAppendBatch`

Classification: `runtime-only`. Kind: `function`.

Validates and deterministically plans a future atomic append operation.

Parent order is group parents, record parents, then resolved local parents.
Every parent must already be retained or must have been planned earlier in
this batch. Owner ordinals advance independently and are not part of record
identity.

This function is pure and does not persist records. A storage adapter must
commit the returned plan and ordinal state atomically.

Signature:

```ts
export declare function planAppendBatch(batch: AppendBatchDraft, state?: AppendPlanningState): PlannedAppendBatch;
```

Parameter:

- batch - Ordered owner groups and record drafts to plan.

Parameter:

- state - Known record identifiers and next owner ordinals.

Returns:

- Canonical record envelopes, owner views, ranges, and causal edges.

Throws:

- {TypeError} If the batch shape, identifiers, local references, or
owner ordinal state is invalid.

Throws:

- {RangeError} If a causal parent is unknown or an ordinal exceeds the
safe integer range.

Example:

- ```ts
const plan = planAppendBatch(
  {
    groups: [{
      owner_id: "run:example",
      records: [{
        body: { operation: "started" },
        mode: "capture",
        schema_ref: "example.event.v1",
        witness_ref,
      }],
    }],
  },
);
```

### `prepareRetainedWorldSettlement`

Classification: `runtime-only`. Kind: `function`.

Authenticates one exact retained output and atomically prepares its consume-once settlement.

This function authenticates durable trace and retained carrier evidence. Apply preparation also
snapshots the current user basis to prove path disjointness, but does not mutate the user binding,
select a revision, or discard custody. Exact replay returns the existing prepared decision; a
different command or action conflicts at the store transaction.

Signature:

```ts
export declare function prepareRetainedWorldSettlement(options: PrepareRetainedWorldSettlementOptions): Promise<PreparedRetainedWorldSettlement>;
```

Parameter:

- options - Exact action, command, output, store, binding, and carrier authority.

Returns:

- Frozen authenticated prepared settlement decision.

Throws:

- {RetainedWorldSettlementInvalidError} If any durable or carrier citation is absent,
malformed, forged, moved, or inconsistent.

Throws:

- {RetainedWorldSettlementConflictError} If another exact request owns the command or
output identity.

Example:

- ```ts
const prepared = await prepareRetainedWorldSettlement({
    action: "select",
    binding,
    carrier,
    commandId: "settlement:review:1",
    output: captured.output,
    store,
});
prepared.state;
```

### `projectEffectiveHistory`

Classification: `runtime-only`. Kind: `function`.

Projects a root execution, active children, relations, and published data.

The pure projection skips active children whose cut slice is not supplied. The
`SQLiteTraceStore.projectEffectiveHistory` facade resolves every required child cut strictly.

Signature:

```ts
export declare function projectEffectiveHistory(rootSlice: Slice, rootExecutionId: string, childSlices?: readonly Slice[]): EffectiveHistory;
```

Parameter:

- rootSlice - Immutable root execution owner-prefix slice.

Parameter:

- rootExecutionId - Root execution owner to project.

Parameter:

- childSlices - Child slices keyed by their embedded published cut addresses.

Returns:

- Frozen effective execution history.

Throws:

- {ProjectionCompatibilityError} If a slice omits required modes or payloads.

Throws:

- {TraceStoreError} If selected execution, relation, or publication evidence is malformed.

Throws:

- {TypeError} If the root execution identifier is empty.

### `projectExecution`

Classification: `runtime-only`. Kind: `function`.

Projects one execution lifecycle from a compatible payload-visible slice.

Signature:

```ts
export declare function projectExecution(slice: Slice, executionId: string, cut?: Cut): Execution;
```

Parameter:

- slice - Immutable owner-prefix slice containing lifecycle records.

Parameter:

- executionId - Execution owner to fold in owner-ordinal order.

Parameter:

- cut - Optional published cut represented by the returned projection.

Returns:

- A frozen disposable execution value.

Throws:

- {ProjectionCompatibilityError} If the slice omits required modes or payloads.

Throws:

- {TraceStoreError} If selected lifecycle evidence is absent or malformed.

Throws:

- {TypeError} If the execution identifier is empty.

### `projectExecutionRelations`

Classification: `runtime-only`. Kind: `function`.

Projects parent-owned execution relation transitions in owner order.

Signature:

```ts
export declare function projectExecutionRelations(slice: Slice, parentExecutionId: string): readonly ExecutionRelation[];
```

Parameter:

- slice - Immutable parent owner-prefix slice.

Parameter:

- parentExecutionId - Parent execution that owns the relations.

Returns:

- Frozen retained relation transitions in owner order.

Throws:

- {ProjectionCompatibilityError} If the slice omits required modes or payloads.

Throws:

- {TraceStoreError} If selected relation evidence is absent or malformed.

Throws:

- {TypeError} If the parent identifier is empty.

### `readDurableTaskExecution`

Classification: `runtime-only`. Kind: `function`.

Reads and classifies retained evidence for one durable task execution.

Signature:

```ts
export declare function readDurableTaskExecution(store: SQLiteTraceStore, runId: string): DurableTaskExecutionRecovery;
```

Parameter:

- store - Open trace store containing execution evidence.

Parameter:

- runId - Stable run owner to inspect.

Returns:

- A frozen absent, incomplete, terminal-pending-cut, or committed recovery value.

Throws:

- {TypeError} If the run identity is malformed.

Throws:

- {TraceStoreError} If retained execution evidence is malformed or inconsistent.

### `recoverGrantedTaskWorldDurably`

Classification: `runtime-only`. Kind: `function`.

Recovers a repository-granted task-world capture only under the exact prepared grant plan.

Signature:

```ts
export declare function recoverGrantedTaskWorldDurably<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>>(options: RecoverGrantedTaskWorldOptions<I, O>): Promise<TaskWorldCaptureResult>;
```

Parameter:

- options - Exact granted capture contract plus recovery command identity.

Returns:

- Recovered durable task result and retained world.

Throws:

- {TypeError} If current grant evidence differs from the prepared contract.

Throws:

- {DurableExecutionRecoveryError} If the capture is absent, uncertain, or unrecoverable.

Throws:

- {TraceStoreError} If command, claim, or terminal publication fails closed.

Throws:

- {WorldCarrierError} If retained carrier evidence cannot be reopened or captured.

Throws:

- {WorldChangesetError} If retained comparison evidence is invalid or exceeds limits.

Example:

- ```ts
const result = await recoverGrantedTaskWorldDurably({
    ...grantedCaptureOptions,
    commandId: "command:recover-granted-world:1",
});
```

### `recoverJailedGrantedTaskWorldDurably`

Classification: `runtime-only`. Kind: `function`.

Reopens one native-jailed capture without repeating uncertain external process work.

Signature:

```ts
export declare function recoverJailedGrantedTaskWorldDurably<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>>(options: RecoverJailedGrantedTaskWorldOptions<I, O>): Promise<JailedTaskWorldCaptureResult>;
```

Parameter:

- options - Exact jailed capture contract plus recovery command identity.

Returns:

- Recovered task-world result with reconstructed native placement and process receipt.

Throws:

- {DurableExecutionRecoveryError} If process start is uncertain or evidence is incomplete.

Throws:

- {TypeError} If retained native-jail evidence differs from current authority.

Example:

- ```ts
const result = await recoverJailedGrantedTaskWorldDurably({
    ...jailedCaptureOptions,
    commandId: "command:recover-native:1",
});
```

### `recoverPlacedGrantedTaskWorldDurably`

Classification: `runtime-only`. Kind: `function`.

Recovers a placed granted task-world capture under the exact prepared placement resolution.

Signature:

```ts
export declare function recoverPlacedGrantedTaskWorldDurably<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>>(options: RecoverPlacedGrantedTaskWorldOptions<I, O>): Promise<PlacedTaskWorldCaptureResult>;
```

Parameter:

- options - Exact placed capture contract plus recovery command identity.

Returns:

- Recovered task-world result with exact placement evidence.

Throws:

- {TypeError} If current placement or retained evidence differs from the prepared contract.

Throws:

- {DurableExecutionRecoveryError} If the capture is absent, uncertain, or unrecoverable.

Throws:

- {TraceStoreError} If command, claim, or terminal publication fails closed.

Throws:

- {WorldCarrierError} If retained carrier evidence cannot be reopened or captured.

Throws:

- {WorldChangesetError} If retained comparison evidence is invalid or exceeds limits.

Example:

- ```ts
const result = await recoverPlacedGrantedTaskWorldDurably({
    ...placedCaptureOptions,
    commandId: "command:recover-placed-world:1",
});
```

### `recoverTaskDurably`

Classification: `runtime-only`. Kind: `function`.

Applies one globally idempotent recovery command to existing durable task evidence.

Recovery resumes only creation evidence that has not crossed the provider boundary, repairs a
missing terminal cut without provider invocation, and replays committed results. A retained
start without terminal evidence remains fail-closed. The command is retained canonically and
causally cited by any recovered start or cut publication.

Signature:

```ts
export declare function recoverTaskDurably<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>>(store: SQLiteTraceStore, options: DurableTaskRecoveryOptions<I, O>): Promise<DurableTaskRecoveryResult>;
```

Parameter:

- store - Open trace store containing the durable execution.

Parameter:

- options - Stable command identity and exact execution contract to recover.

Returns:

- Canonical command evidence and the recovered durable result.

Throws:

- {TypeError} If the command or execution options are malformed.

Throws:

- {DurableExecutionRecoveryAbsentError} If no creation evidence exists for the run.

Throws:

- {DurableExecutionRecoveryError} If provider invocation may already have occurred.

Throws:

- {TraceStoreError} If command identity conflicts or retained evidence is inconsistent.

Example:

- ```ts
const recovered = await recoverTaskDurably(store, {
    commandId: "command:recover:greet:1",
    execution: { task: greet, input: { name: "Ada" }, provider, runId: "run:greet:1" },
});
recovered.command.record_id;
```

### `recoverTaskWorldDurably`

Classification: `runtime-only`. Kind: `function`.

Resumes one pre-execution task-world capture under an explicit durable recovery command.

Recovery reuses exact `forked` custody and creation evidence, acquires a command-authorized
invocation fence, and never scans carrier directories or repeats an `executing` capture.

Signature:

```ts
export declare function recoverTaskWorldDurably<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>>(options: RecoverTaskWorldOptions<I, O>): Promise<TaskWorldCaptureResult>;
```

Parameter:

- options - Exact capture contract plus globally idempotent recovery command identity.

Returns:

- Durable task result and the retained world produced from the original custody.

Throws:

- {TypeError} If options or retained capture evidence disagree.

Throws:

- {DurableExecutionRecoveryError} If the capture is absent, uncertain, or not recoverable.

Throws:

- {TraceStoreError} If command, claim, or terminal publication fails closed.

Example:

- ```ts
const result = await recoverTaskWorldDurably({
    ...captureOptions,
    commandId: "command:recover-world:1",
});
result.output.custody_id;
```

### `releaseRetainedWorldSettlement`

Classification: `runtime-only`. Kind: `function`.

Durably releases one exact retained output without materializing it or deleting its custody.

Release is receipt-only: it authenticates the existing immutable candidate and mutable custody,
retains a terminal consume-once receipt, publishes the execution citation, and leaves both the
user world and retained custody unchanged. Exact retries revalidate custody and replay the same
result after restart. Current-basis observation may retain an immutable carrier snapshot but
never writes candidate content to the user binding.

Signature:

```ts
export declare function releaseRetainedWorldSettlement(options: ReleaseRetainedWorldSettlementOptions): Promise<ReleasedRetainedWorldSettlement>;
```

Parameter:

- options - Exact output identity plus authenticated carrier and trace-store authority.

Returns:

- Frozen released result citing the preserved custody, revision, and changeset.

Throws:

- {RetainedWorldSettlementInvalidError} If trace, revision, changeset, custody, or journal
evidence is absent, malformed, forged, discarded, or inconsistent.

Throws:

- {RetainedWorldSettlementConflictError} If another action owns the admission or terminal.

### `requestDurableTaskCancellation`

Classification: `runtime-only`. Kind: `function`.

Retains one globally idempotent cancellation request against the exact running fence.

The command requests cooperative cancellation only. It leaves lifecycle and worker authority
unchanged until the exact worker acknowledges a safe boundary.

Signature:

```ts
export declare function requestDurableTaskCancellation(store: SQLiteTraceStore, options: DurableTaskCancellationOptions): DurableTaskCancellationCommandReceipt;
```

Parameter:

- store - Open trace store containing the running durable execution.

Parameter:

- options - Exact command, run, lifecycle-head, fencing-token, and reason contract.

Returns:

- Canonical retained cancellation-command evidence.

Throws:

- {TypeError} If options are malformed.

Throws:

- {TraceStoreError} If running authority is no longer current.

Throws:

- {AppendIntentConflictError} If command identity already names different content.

Example:

- ```ts
const command = requestDurableTaskCancellation(store, {
    commandId: "command:cancel:42",
    expectedLifecycleRecordId: startedRecordId,
    fencingToken,
    reason: "operator request",
    runId: "run:42",
});
command.record_id;
```

### `requestDurableTaskPause`

Classification: `runtime-only`. Kind: `function`.

Retains one globally idempotent pause request against the exact current running fence.

This function records command authority only. It does not interrupt the provider, release the
invocation lease, append a suspension acknowledgement, or change lifecycle projection. Exact
replay returns the retained command even if the run later advances; reuse of the command
identity for different content conflicts.

Signature:

```ts
export declare function requestDurableTaskPause(store: SQLiteTraceStore, options: DurableTaskPauseOptions): DurableTaskPauseCommandReceipt;
```

Parameter:

- store - Open trace store containing the running durable execution.

Parameter:

- options - Exact command, run, lifecycle-head, fencing-token, and reason contract.

Returns:

- Canonical retained pause-command evidence.

Throws:

- {TypeError} If the options, identifiers, token, or reason are malformed.

Throws:

- {TraceStoreError} If the expected running head or fencing token is no longer current.

Throws:

- {AppendIntentConflictError} If command identity already names different content.

Example:

- ```ts
const command = requestDurableTaskPause(store, {
    commandId: "command:pause:greet:1",
    expectedLifecycleRecordId: startedRecordId,
    fencingToken: currentFencingToken,
    reason: "operator maintenance",
    runId: "run:greet:1",
});
command.record_id;
```

### `resolveOutputCitationSelector`

Classification: `runtime-only`. Kind: `function`.

Resolves an exact output ID, unique output-ID prefix, or canonical latest read selector.

Signature:

```ts
export declare function resolveOutputCitationSelector(store: SQLiteTraceStore, selector: string): OutputCitationEntry;
```

Parameter:

- store - Open trace store containing durable retained-world evidence.

Parameter:

- selector - Exact output ID, unique output-ID prefix, or configured latest token.

Returns:

- Exact immutable output citation entry.

Throws:

- {LedgerSelectorAmbiguousError} If a prefix matches multiple bounded outputs.

Throws:

- {LedgerSelectorNotFoundError} If no output matches.

Throws:

- {TraceStoreError} If retained run, output, cut, or settlement evidence is corrupt.

Throws:

- {TypeError} If the selector or projection violates configured bounds.

Example:

- ```ts
const output = resolveOutputCitationSelector(store, "world-output:sha256:...");
```

### `resolveRecoveryRecordSelector`

Classification: `runtime-only`. Kind: `function`.

Resolves recovery records through the exact/prefix/latest read-only run selector contract.

Signature:

```ts
export declare function resolveRecoveryRecordSelector(store: SQLiteTraceStore, selector: string): RecoveryRecordEntry;
```

Parameter:

- store - Open trace store containing durable execution evidence.

Parameter:

- selector - Exact run ID, unique prefix, or configured latest token.

Returns:

- Exact immutable recovery record projection.

Throws:

- {LedgerSelectorAmbiguousError} If a run prefix is ambiguous.

Throws:

- {LedgerSelectorNotFoundError} If no run matches.

Throws:

- {TraceStoreError} If retained lifecycle, command, or cut evidence is corrupt.

Throws:

- {TypeError} If the selector or canonical projection bounds are invalid.

### `resolveRunLedgerSelector`

Classification: `runtime-only`. Kind: `function`.

Resolves an exact run ID, unique run-ID prefix, or canonical latest read selector.

Signature:

```ts
export declare function resolveRunLedgerSelector(store: SQLiteTraceStore, selector: string): RunLedgerEntry;
```

Parameter:

- store - Open trace store containing durable execution evidence.

Parameter:

- selector - Exact run ID, unique run-ID prefix, or configured latest token.

Returns:

- Exact immutable run ledger entry.

Throws:

- {LedgerSelectorAmbiguousError} If a prefix matches multiple runs.

Throws:

- {LedgerSelectorNotFoundError} If no run matches.

Throws:

- {TraceStoreError} If the store is closed or retained evidence is corrupt.

Throws:

- {TypeError} If the selector or retained projection evidence is invalid.

Example:

- ```ts
const run = resolveRunLedgerSelector(store, "run:review:1");
```

### `resolveTaskLedgerSelector`

Classification: `runtime-only`. Kind: `function`.

Resolves an exact task/version, unique task-ID prefix, or canonical latest read selector.

Signature:

```ts
export declare function resolveTaskLedgerSelector(registry: SQLiteTaskRegistry, selector: string, repositoryGrants?: readonly RepositoryGrantedTask<TaskSchema<unknown>, TaskSchema<unknown>>[]): TaskLedgerEntry;
```

Parameter:

- registry - Open durable task registry.

Parameter:

- selector - Exact `task-id@version`, task-ID/prefix, or `@latest`.

Parameter:

- repositoryGrants - Optional authenticated companion grant evidence.

Returns:

- Exact verified immutable task ledger entry.

Throws:

- {LedgerSelectorAmbiguousError} If a task-ID/prefix matches multiple versions/entries.

Throws:

- {LedgerSelectorNotFoundError} If no registration matches.

Throws:

- {TaskRegistryError} If the registry is closed or retained data is corrupt.

Throws:

- {TypeError} If the selector, grants, retained entry, or canonical size is invalid.

Example:

- ```ts
const entry = resolveTaskLedgerSelector(registry, `${taskId}@${version}`);
```

### `resolveTraceRevisionSelector`

Classification: `runtime-only`. Kind: `function`.

Resolves an exact cut ID, unique cut-ID prefix, or canonical latest trace revision.

Signature:

```ts
export declare function resolveTraceRevisionSelector(store: SQLiteTraceStore, selector: string): TraceRevisionEntry;
```

Parameter:

- store - Open trace store containing published cuts.

Parameter:

- selector - Exact cut ID, unique prefix, or configured latest token.

Returns:

- Exact immutable trace revision entry.

Throws:

- {LedgerSelectorAmbiguousError} If a prefix matches multiple cuts.

Throws:

- {LedgerSelectorNotFoundError} If no cut matches.

Throws:

- {TraceStoreError} If retained cut or slice evidence is corrupt.

Throws:

- {TypeError} If the selector or projection violates configured bounds.

Example:

- ```ts
const revision = resolveTraceRevisionSelector(store, "cut:run:1");
```

### `resumeDurableTask`

Classification: `runtime-only`. Kind: `function`.

Atomically resumes one exact suspended or satisfied waiting run under an idempotent command.

Resume verifies the quiescent acknowledgement and its continuation descriptor, requires exact
prerequisite-satisfaction evidence for waiting, rejects satisfaction evidence for suspension,
acquires the next monotonic worker fence, and publishes a distinct command-bound
running-continuation acknowledgement. It does not itself restore provider, process, or world
state; the caller uses the returned authority only after its adapters restore verified receipts.

Signature:

```ts
export declare function resumeDurableTask(store: SQLiteTraceStore, options: DurableTaskResumeOptions): DurableTaskResumeReceipt;
```

Parameter:

- store - Open trace store containing the waiting or suspended run.

Parameter:

- options - Exact command, quiescent head, descriptor, satisfaction, and run contract.

Returns:

- Canonical resume evidence and newly fenced worker authority.

Throws:

- {TypeError} If options or identifiers are malformed.

Throws:

- {TraceStoreError} If lifecycle, claim, or continuation evidence is inconsistent.

Throws:

- {AppendIntentConflictError} If command identity already names different content.

Example:

- ```ts
const authority = resumeDurableTask(store, {
    commandId: "command:resume:42",
    continuationDescriptorRecordId: suspension.continuation_descriptor_record_id,
    expectedLifecycleRecordId: suspension.acknowledgement_record_id,
    runId: "run:42",
});
authority.fencing_token;
```

### `runCli`

Classification: `runtime-only`. Kind: `function`.

Runs the configured human-facing CLI without terminating the process.

Signature:

```ts
export declare function runCli(args: readonly string[], io?: CliIo): Promise<number>;
```

Parameter:

- args - Command arguments excluding the executable and script paths.

Parameter:

- io - Optional injectable current directory and output sinks.

Returns:

- Configured process exit code.

Throws:

- {TypeError} If the injectable I/O boundary is malformed.

### `schema`

Classification: `runtime-only`. Kind: `variable`.

Task input/output schema builders with static type inference and runtime validation.

Signature:

```ts
export declare const schema: TaskSchemaFactory;
```

### `selectRetainedWorldSettlement`

Classification: `runtime-only`. Kind: `function`.

Durably selects one exact admitted retained output and recovers interrupted publication.

The coordinator verifies the immutable admission, checks the current semantic user basis before
beginning the deterministic operation, and delegates a second pre-write basis check plus every
managed-path effect to the authenticated carrier. The selected store receipt is retained only
after the carrier publishes its exact terminal receipt. Applying and selected prefixes replay
without reopening consume-once admission or inferring success from current user bytes.

Signature:

```ts
export declare function selectRetainedWorldSettlement(options: SelectRetainedWorldSettlementOptions): Promise<SelectedRetainedWorldSettlement>;
```

Parameter:

- options - Exact output identity plus canonical binding, carrier, and trace-store authority.

Returns:

- Frozen selected result citing the exact carrier publication and final user basis.

Throws:

- {RetainedWorldSettlementInvalidError} If trace, revision, changeset, basis, carrier, or
publication evidence is absent, malformed, moved, forged, or inconsistent.

Throws:

- {RetainedWorldSettlementConflictError} If the output was admitted for another action or
has already reached another terminal settlement.

Example:

- ```ts
const selected = await selectRetainedWorldSettlement({
    binding,
    carrier,
    outputId: captured.output.output_id,
    store,
});
selected.publication_id;
```

### `task`

Classification: `runtime-only`. Kind: `function`.

Creates an immutable, content-addressed bodyless task descriptor.

Signature:

```ts
export declare function task<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>>(definition: TaskDefinition<I, O>): TaskDescriptor<I, O>;
```

Parameter:

- definition - Closed task definition containing identity, instruction, and schemas.

Returns:

- A frozen descriptor with inferred validation methods and exact artifact lock.

Throws:

- {TypeError} If the definition or either schema is malformed.

Example:

- ```ts
const greet = task({
    name: "greet",
    version: "1.0.0",
    instruction: "Greet the supplied person.",
    input: schema.object({ name: schema.string() }),
    output: schema.void(),
});
```

### `validateEffectCorrelation`

Classification: `runtime-only`. Kind: `function`.

Validates that an outcome exactly cites the supplied canonical intent.

Correlation covers the intent version, ID, kind, payload, phase, and reversibility through
`intent_ref`, while the ID and kind are repeated for direct indexing.

Signature:

```ts
export declare function validateEffectCorrelation<K extends string, P extends SemanticValue, V extends SemanticValue = SemanticValue, E extends SemanticValue = SemanticValue>(intent: EffectIntent<K, P>, outcome: unknown): EffectOutcome<K, V, E>;
```

Parameter:

- intent - Canonical intent expected to precede the outcome.

Parameter:

- outcome - Untrusted candidate outcome to validate.

Returns:

- The validated outcome with its typed effect family and result.

Throws:

- {TypeError} If either record is malformed or correlation does not match exactly.

### `validateRecordBody`

Classification: `runtime-only`. Kind: `function`.

Validates a value as a canonical record body.

Signature:

```ts
export declare function validateRecordBody(value: unknown): asserts value is RecordBody;
```

Parameter:

- value - The untrusted value to validate.

Throws:

- {TypeError} If the value is not a plain canonicalizable object.

### `validateRecordEnvelope`

Classification: `runtime-only`. Kind: `function`.

Validates an envelope and verifies its identity against a record body.

Signature:

```ts
export declare function validateRecordEnvelope(value: unknown, body: RecordBody): asserts value is RecordEnvelope;
```

Parameter:

- value - The untrusted envelope value to validate.

Parameter:

- body - The body whose semantic identity the envelope must contain.

Throws:

- {TypeError} If the shape is invalid or its identity does not match `body`.

### `validateTypedEffectTrace`

Classification: `runtime-only`. Kind: `function`.

Executes the configured single-root Core-A lifecycle machine over normalized effect records.

Validation checks exact record shapes, declaration/selection/handle correlation, callable
one-shot resumption, handler returns, terminal captures, nested selection closure, program
identity, and completed-versus-prefix obligations without mutating the supplied trace.

Signature:

```ts
export declare function validateTypedEffectTrace(options: TypedEffectTraceValidationOptions): TypedEffectTraceValidation;
```

Parameter:

- options - Static program identity, completion mode, and ordered untrusted records.

Returns:

- A frozen lifecycle summary for the accepted trace or trace prefix.

Throws:

- {TypeError} If the options container or program identity is malformed.

Throws:

- {TypedEffectTraceValidationError} If a record or lifecycle transition is invalid.

Example:

- ```ts
const result = validateTypedEffectTrace({
    completed: false,
    programRef,
    trace: declarationPrefix,
});
result.open_path_count;
```

## Canonical

Package entry: `./canonical`

Canonical semantic-record encoding and identity.

Runtime: ESM on Node >=24.12.0 <25, except the type-only /read entry (no Node runtime required).

Authority and mutation: Pure canonical encoding and identity operations; no filesystem, process, network, persistence, or mutation authority.

Import example:

```ts
import * as api from "@avnionur/shepherd-typescript/canonical";
void api;
```

Exported symbols: 5.

### `SemanticRecord`

Classification: `type-only`. Kind: `type alias`.

A plain object containing semantic values.

Properties whose value is `undefined` are omitted during canonicalization.
Symbol and accessor properties are rejected.

Signature:

```ts
export type SemanticRecord = {
    readonly [key: string]: SemanticValue | undefined;
};
```

### `SemanticScalar`

Classification: `type-only`. Kind: `type alias`.

A scalar value accepted by the canonical semantic record format.

Numbers must be finite. Strings must contain well-formed Unicode.

Signature:

```ts
export type SemanticScalar = boolean | null | number | string;
```

### `SemanticValue`

Classification: `type-only`. Kind: `type alias`.

Any recursively representable value accepted in a semantic record.

Arrays must be dense data arrays without accessors or custom properties.

Signature:

```ts
export type SemanticValue = SemanticRecord | SemanticScalar | readonly SemanticValue[];
```

### `canonicalizeRecord`

Classification: `runtime-only`. Kind: `function`.

Serializes a semantic record deterministically.

Object keys are sorted recursively, array order is preserved, undefined
object properties are omitted, and unsupported JSON values are rejected.

Signature:

```ts
export declare function canonicalizeRecord(record: SemanticRecord): string;
```

Parameter:

- record - The plain semantic record to serialize.

Returns:

- The record encoded as deterministic, whitespace-free JSON.

Throws:

- {TypeError} If the record contains unsupported values, malformed
Unicode, accessors, custom array properties, or cycles.

Example:

- ```ts
canonicalizeRecord({ operation: "task.started", ordinal: 1 });
// '{"operation":"task.started","ordinal":1}'
```

### `createRecordId`

Classification: `runtime-only`. Kind: `function`.

Creates a stable content-addressed identifier from a semantic record.

The digest algorithm and identifier prefix come from `protocol.config.json`.

Signature:

```ts
export declare function createRecordId(record: SemanticRecord): string;
```

Parameter:

- record - The semantic record whose canonical representation is hashed.

Returns:

- The configured algorithm prefix followed by the hexadecimal digest.

Throws:

- {TypeError} If `record` cannot be canonicalized.

## CLI

Package entry: `./cli`

Reusable command-line runner and injectable I/O contract.

Runtime: ESM on Node >=24.12.0 <25, except the type-only /read entry (no Node runtime required).

Authority and mutation: The reusable runner uses caller-supplied I/O and command arguments. Command-specific filesystem or persistence authority remains explicit in those arguments.

Import example:

```ts
import * as api from "@avnionur/shepherd-typescript/cli";
void api;
```

Exported symbols: 2.

### `CliIo`

Classification: `type-only`. Kind: `type alias`.

Injectable process boundary used by the reusable CLI runner.

Signature:

```ts
export type CliIo = {
    readonly cwd: string;
    readonly stderr: (text: string) => void;
    readonly stdout: (text: string) => void;
};
```

### `runCli`

Classification: `runtime-only`. Kind: `function`.

Runs the configured human-facing CLI without terminating the process.

Signature:

```ts
export declare function runCli(args: readonly string[], io?: CliIo): Promise<number>;
```

Parameter:

- args - Command arguments excluding the executable and script paths.

Parameter:

- io - Optional injectable current directory and output sinks.

Returns:

- Configured process exit code.

Throws:

- {TypeError} If the injectable I/O boundary is malformed.

## Effects

Package entry: `./effects`

Immutable effect records, correlation, and ordered in-process dispatch.

Runtime: ESM on Node >=24.12.0 <25, except the type-only /read entry (no Node runtime required).

Authority and mutation: Handlers are caller-supplied in-process callbacks. Dispatch is non-durable and grants no trace, workspace, interception, replay, or sandbox authority.

Import example:

```ts
import * as api from "@avnionur/shepherd-typescript/effects";
void api;
```

Exported symbols: 17.

### `EffectFailure`

Classification: `type-only`. Kind: `type alias`.

Failed effect materialization result.

Signature:

```ts
export type EffectFailure<E extends SemanticValue> = {
    readonly error: E;
    readonly ok: false;
};
```

### `EffectHandler`

Classification: `type-only`. Kind: `type alias`.

Synchronous or asynchronous interpretation of one exact effect kind.

Signature:

```ts
export type EffectHandler<K extends string = string, P extends SemanticValue = SemanticValue, V extends SemanticValue = SemanticValue, E extends SemanticValue = SemanticValue> = {
    readonly handle: (intent: EffectIntent<K, P>) => EffectResult<V, E> | Promise<EffectResult<V, E>>;
    readonly handlerId: string;
    readonly kind: K;
};
```

### `EffectHandlerDispatch`

Classification: `type-only`. Kind: `type alias`.

Immutable result of selecting and invoking one effect handler.

Signature:

```ts
export type EffectHandlerDispatch<K extends string = string, V extends SemanticValue = SemanticValue, E extends SemanticValue = SemanticValue> = {
    readonly handlerId: string;
    readonly outcome: EffectOutcome<K, V, E>;
};
```

### `EffectHandlerNotFoundError`

Classification: `runtime-and-type`. Kind: `class`.

Error thrown when an effect handler stack has no exact-kind match.

Signature:

```ts
export declare class EffectHandlerNotFoundError extends Error {
    readonly code: string;
    readonly effectId: string;
    readonly kind: string;
    constructor(effectId: string, kind: string);
}
```

#### `code`

Stable configured machine-readable error code.

```ts
readonly code: string;
```

#### `effectId`

Caller-assigned identity of the unhandled effect intent.

```ts
readonly effectId: string;
```

#### `kind`

Application-defined kind of the unhandled effect intent.

```ts
readonly kind: string;
```

#### `constructor`

Creates an unhandled-effect diagnostic.

```ts
constructor(effectId: string, kind: string);
```

Parameter:

- effectId - Caller-assigned effect identity.

Parameter:

- kind - Exact effect kind that could not be resolved.

### `EffectHandlerStack`

Classification: `type-only`. Kind: `type alias`.

Immutable ordered collection that dispatches validated effect intents.

Signature:

```ts
export type EffectHandlerStack = {
    readonly dispatch: <K extends string, P extends SemanticValue>(intent: EffectIntent<K, P>) => Promise<EffectHandlerDispatch<K>>;
};
```

### `EffectIntent`

Classification: `type-only`. Kind: `type alias`.

Immutable canonical record emitted before an effect may materialize.

Signature:

```ts
export type EffectIntent<K extends string = string, P extends SemanticValue = SemanticValue> = {
    readonly effect_id: string;
    readonly intent_version: number;
    readonly kind: K;
    readonly payload: P;
    readonly phase: (typeof EFFECT_PHASES)["intent"];
    readonly reversibility: EffectReversibility;
};
```

### `EffectIntentDefinition`

Classification: `type-only`. Kind: `type alias`.

Definition accepted by createEffectIntent.

Signature:

```ts
export type EffectIntentDefinition<K extends string, P extends SemanticValue> = {
    readonly effectId: string;
    readonly kind: K;
    readonly payload: P;
    readonly reversibility: EffectReversibility;
};
```

### `EffectOutcome`

Classification: `type-only`. Kind: `type alias`.

Immutable canonical record emitted after an effect receives a world response.

Signature:

```ts
export type EffectOutcome<K extends string = string, V extends SemanticValue = SemanticValue, E extends SemanticValue = SemanticValue> = {
    readonly effect_id: string;
    readonly intent_ref: string;
    readonly kind: K;
    readonly outcome_version: number;
    readonly phase: (typeof EFFECT_PHASES)["outcome"];
    readonly result: EffectResult<V, E>;
};
```

### `EffectResult`

Classification: `type-only`. Kind: `type alias`.

Result accepted by createEffectOutcome.

Signature:

```ts
export type EffectResult<V extends SemanticValue, E extends SemanticValue> = EffectFailure<E> | EffectSuccess<V>;
```

### `EffectReversibility`

Classification: `type-only`. Kind: `type alias`.

Reversibility guarantees attached to an effect before materialization.

Signature:

```ts
export type EffectReversibility = (typeof EFFECT_REVERSIBILITY_TIERS)[number];
```

### `EffectSuccess`

Classification: `type-only`. Kind: `type alias`.

Successful effect materialization result.

Signature:

```ts
export type EffectSuccess<V extends SemanticValue> = {
    readonly ok: true;
    readonly value: V;
};
```

### `TypedEffectHandlerOptions`

Classification: `type-only`. Kind: `type alias`.

Definition of an in-process effect handler with an inferred, validated payload.

Signature:

```ts
export type TypedEffectHandlerOptions<P> = {
    readonly handlerId: string;
    readonly kind: string;
    readonly payloadSchema: TaskSchema<P>;
    readonly handle: (payload: P, intent: EffectIntent) => EffectResult<SemanticValue, SemanticValue> | Promise<EffectResult<SemanticValue, SemanticValue>>;
};
```

### `createEffectHandlerStack`

Classification: `runtime-only`. Kind: `function`.

Creates an immutable exact-kind effect handler stack.

Definitions are validated and snapshotted in installation order. The active protocol selects
the last matching handler, mirroring nearest dynamically scoped handler precedence.

Signature:

```ts
export declare function createEffectHandlerStack(handlers: readonly EffectHandler[]): EffectHandlerStack;
```

Parameter:

- handlers - Ordered exact-kind handler definitions.

Returns:

- An immutable stack that validates intents before invoking a handler.

Throws:

- {TypeError} If the handler array or any definition is malformed or IDs are duplicated.

Example:

- ```ts
const handlers = createEffectHandlerStack([{
    handlerId: "local.tool",
    kind: "tool.call",
    handle: (intent) => ({ ok: true, value: intent.effect_id }),
}]);
const dispatch = await handlers.dispatch(intent);
```

### `createEffectIntent`

Classification: `runtime-only`. Kind: `function`.

Creates the immutable versioned record emitted before an effect may materialize.

Signature:

```ts
export declare function createEffectIntent<K extends string, P extends SemanticValue>(definition: EffectIntentDefinition<K, P>): EffectIntent<K, P>;
```

Parameter:

- definition - Typed identity, family, payload, and reversibility declaration.

Returns:

- A deeply frozen canonical effect intent.

Throws:

- {TypeError} If the definition or payload is malformed.

Example:

- ```ts
const intent = createEffectIntent({
    effectId: "effect:tool:1",
    kind: "tool.call",
    payload: { command: "pnpm test" },
    reversibility: "irreversible",
});
```

### `createEffectOutcome`

Classification: `runtime-only`. Kind: `function`.

Creates an immutable outcome bound to the complete canonical effect intent.

Signature:

```ts
export declare function createEffectOutcome<K extends string, P extends SemanticValue, V extends SemanticValue, E extends SemanticValue = SemanticValue>(intent: EffectIntent<K, P>, result: EffectResult<V, E>): EffectOutcome<K, V, E>;
```

Parameter:

- intent - Valid canonical intent that preceded world interaction.

Parameter:

- result - Typed success value or failure information returned by the world.

Returns:

- A deeply frozen canonical outcome containing the intent digest.

Throws:

- {TypeError} If the intent or result is malformed.

Example:

- ```ts
const outcome = createEffectOutcome(intent, {
    ok: true,
    value: { exitCode: 0 },
});
```

### `createTypedEffectHandler`

Classification: `runtime-only`. Kind: `function`.

Adapts a schema-validated typed callback to an ordinary immutable effect handler.

Signature:

```ts
export declare function createTypedEffectHandler<P>(options: TypedEffectHandlerOptions<P>): EffectHandler;
```

Parameter:

- options - Exact kind/identity, package-created payload schema, and callback.

Returns:

- A frozen handler accepted by createEffectHandlerStack. Direct handle calls also
validate the canonical intent, kind, payload, and returned semantic result.

Throws:

- {TypeError} If options or schema are invalid. Returned handle calls reject invalid
intents, wrong kinds, malformed payloads, or malformed results before exposing them.

Throws:

- Returned handle calls propagate callback errors unchanged.

Example:

- const handler = createTypedEffectHandler({
  handlerId: "format", kind: "text.format",
  payloadSchema: schema.object({ text: schema.string() }),
  handle: ({ text }) => ({ ok: true, value: text.toUpperCase() }),
});

### `validateEffectCorrelation`

Classification: `runtime-only`. Kind: `function`.

Validates that an outcome exactly cites the supplied canonical intent.

Correlation covers the intent version, ID, kind, payload, phase, and reversibility through
`intent_ref`, while the ID and kind are repeated for direct indexing.

Signature:

```ts
export declare function validateEffectCorrelation<K extends string, P extends SemanticValue, V extends SemanticValue = SemanticValue, E extends SemanticValue = SemanticValue>(intent: EffectIntent<K, P>, outcome: unknown): EffectOutcome<K, V, E>;
```

Parameter:

- intent - Canonical intent expected to precede the outcome.

Parameter:

- outcome - Untrusted candidate outcome to validate.

Returns:

- The validated outcome with its typed effect family and result.

Throws:

- {TypeError} If either record is malformed or correlation does not match exactly.

## Providers

Package entry: `./providers`

Provider-neutral contracts and deterministic static-provider fixtures.

Runtime: ESM on Node >=24.12.0 <25, except the type-only /read entry (no Node runtime required).

Authority and mutation: Provider authority is supplied explicitly by the consumer. The deterministic static adapter owns no credentials, network access, execution, or workspace authority.

Import example:

```ts
import * as api from "@avnionur/shepherd-typescript/providers";
void api;
```

Exported symbols: 14.

### `ModelArtifactDefinition`

Classification: `type-only`. Kind: `type alias`.

One side-channel artifact emitted with a provider response.

Signature:

```ts
export type ModelArtifactDefinition = {
    readonly content: RunArtifactContentDefinition;
    readonly kind: string;
    readonly metadata: SemanticRecord;
    readonly name: string;
};
```

### `ModelProvider`

Classification: `type-only`. Kind: `type alias`.

Provider-neutral structured invocation boundary.

Signature:

```ts
export type ModelProvider = {
    readonly descriptor: () => ProviderDescriptor;
    readonly invoke: (request: ModelRequest, signal: AbortSignal) => Promise<ModelResponse>;
};
```

### `ModelRequest`

Classification: `type-only`. Kind: `type alias`.

Provider-neutral request for one structured model invocation.

Signature:

```ts
export type ModelRequest = {
    readonly input: SemanticValue;
    readonly instruction: string;
    readonly outputSchema: SemanticRecord;
};
```

### `ModelResponse`

Classification: `type-only`. Kind: `type alias`.

Provider-neutral response from one structured model invocation.

Signature:

```ts
export type ModelResponse = {
    readonly artifacts?: readonly ModelArtifactDefinition[];
    readonly output: SemanticValue;
    readonly usage: ModelUsage;
};
```

### `ModelUsage`

Classification: `type-only`. Kind: `type alias`.

Usage measured for one provider invocation.

Signature:

```ts
export type ModelUsage = {
    readonly cacheCreationInputTokens: number;
    readonly cacheReadInputTokens: number;
    readonly costUsd: number | null;
    readonly inputTokens: number;
    readonly outputTokens: number;
};
```

### `ProviderCapabilities`

Classification: `type-only`. Kind: `type alias`.

Provider capabilities visible to provider-neutral execution code.

Signature:

```ts
export type ProviderCapabilities = {
    readonly streaming: boolean;
    readonly structuredOutput: boolean;
    readonly tools: boolean;
};
```

### `ProviderDescriptor`

Classification: `type-only`. Kind: `type alias`.

Immutable identity and capabilities of one model provider.

Signature:

```ts
export type ProviderDescriptor = {
    readonly capabilities: ProviderCapabilities;
    readonly id: string;
    readonly kind: ProviderKind;
    readonly model: string | null;
};
```

### `ProviderKind`

Classification: `type-only`. Kind: `type alias`.

Configured provider-kind vocabulary implemented by provider protocol v1.

Signature:

```ts
export type ProviderKind = (typeof PROVIDER_KINDS)[number];
```

### `StaticProviderDefinition`

Classification: `type-only`. Kind: `type alias`.

Definition accepted by createStaticProvider.

Signature:

```ts
export type StaticProviderDefinition = {
    readonly descriptor: StaticProviderDescriptorDefinition;
    readonly exchanges: readonly StaticProviderExchange[];
};
```

### `StaticProviderDescriptorDefinition`

Classification: `type-only`. Kind: `type alias`.

Descriptor fields accepted by createStaticProvider.

Signature:

```ts
export type StaticProviderDescriptorDefinition = {
    readonly id: string;
    readonly model: string;
};
```

### `StaticProviderExchange`

Classification: `type-only`. Kind: `type alias`.

One exact deterministic request and its configured response.

Signature:

```ts
export type StaticProviderExchange = {
    readonly request: ModelRequest;
    readonly response: ModelResponse;
};
```

### `StaticProviderExhaustedError`

Classification: `runtime-and-type`. Kind: `class`.

Error raised after a static provider consumes its complete cassette.

Signature:

```ts
export declare class StaticProviderExhaustedError extends Error {
    readonly code: string;
    readonly position: number;
    constructor(position: number);
}
```

#### `code`

Stable configured machine-readable error code.

```ts
readonly code: string;
```

#### `position`

Zero-based cassette position requested by the rejected invocation.

```ts
readonly position: number;
```

#### `constructor`

Creates a cassette-exhaustion error.

```ts
constructor(position: number);
```

Parameter:

- position - Zero-based position requested after the final exchange.

### `StaticProviderRequestMismatchError`

Classification: `runtime-and-type`. Kind: `class`.

Error raised when a request does not match the next static exchange.

Signature:

```ts
export declare class StaticProviderRequestMismatchError extends Error {
    readonly code: string;
    readonly position: number;
    constructor(position: number);
}
```

#### `code`

Stable configured machine-readable error code.

```ts
readonly code: string;
```

#### `position`

Zero-based cassette position that rejected the request.

```ts
readonly position: number;
```

#### `constructor`

Creates a static request-mismatch error.

```ts
constructor(position: number);
```

Parameter:

- position - Zero-based expected exchange position.

### `createStaticProvider`

Classification: `runtime-only`. Kind: `function`.

Creates a deterministic offline provider backed by exact cassette exchanges.

Signature:

```ts
export declare function createStaticProvider(definition: StaticProviderDefinition): ModelProvider;
```

Parameter:

- definition - Provider identity and ordered request/response exchanges.

Returns:

- A single-pass provider-neutral model provider.

Throws:

- {TypeError} If the definition is not canonical provider data.

Example:

- ```ts
const provider = createStaticProvider({
    descriptor: { id: "offline-docs", model: "fixture-v1" },
    exchanges: [{ request, response }],
});
await provider.invoke(request, new AbortController().signal);
```

## Read

Package entry: `./read`

Web-safe semantic records, owner occurrences, cut addresses, slices, and anchors.

Runtime: ESM on Node >=24.12.0 <25, except the type-only /read entry (no Node runtime required).

Authority and mutation: Type-only readonly trace data; no runtime exports, validation, transport, storage, mutation, or authorization. Installed declarations compile without Node types; the ESM module has no runtime dependencies.

Import example:

```ts
import * as api from "@avnionur/shepherd-typescript/read";
void api;
```

Exported symbols: 22.

### `ClosurePolicy`

Classification: `type-only`. Kind: `type alias`.

Whether omitted causal parents are represented as anchors.

Signature:

```ts
export type ClosurePolicy = "include_external_anchors" | "visible_only";
```

### `Cut`

Classification: `type-only`. Kind: `type alias`.

Durable immutable address of an owner-path prefix.

Signature:

```ts
export type Cut = {
    readonly created_by_record_id: RecordId;
    readonly cut_id: CutId;
    readonly publisher_owner_id: TraceOwnerId;
    readonly target_owner_id: TraceOwnerId;
    readonly through_owner_ordinal: OwnerOrdinal;
    readonly through_record_id: RecordId;
};
```

### `CutId`

Classification: `type-only`. Kind: `type alias`.

Stable identifier for one published immutable trace cut.

Signature:

```ts
export type CutId = string;
```

### `ExternalAnchor`

Classification: `type-only`. Kind: `type alias`.

Visible placeholder for a direct causal parent omitted from a slice.

Signature:

```ts
export type ExternalAnchor = {
    readonly hidden_reason: "outside_slice";
    readonly ref: RecordId;
};
```

### `ModeFilter`

Classification: `type-only`. Kind: `type alias`.

Configured record-mode selection applied to traversal records.

Signature:

```ts
export type ModeFilter = "both" | "captures_only" | "declarations_only";
```

### `OwnerOrdinal`

Classification: `type-only`. Kind: `type alias`.

Configured-floor position of a retained record on an owner path.

Signature:

```ts
export type OwnerOrdinal = number;
```

### `OwnerRecord`

Classification: `type-only`. Kind: `type alias`.

Read result for one owner-local record occurrence.

Signature:

```ts
export type OwnerRecord = PlannedRecord;
```

### `RecordBody`

Classification: `type-only`. Kind: `type alias`.

A schema-specific semantic payload retained by a record.

Record bodies accept the same plain, canonicalizable values as semantic
records. Storage metadata does not belong in a record body.

Signature:

```ts
export type RecordBody = SemanticRecord;
```

### `RecordEnvelope`

Classification: `type-only`. Kind: `type alias`.

Stable semantic identity and ordered causality for one retained record.

Owner paths, ordinals, receipts, and local timestamps are intentionally
excluded because they do not change record identity.

Signature:

```ts
export type RecordEnvelope = {
    readonly caused_by_record_ids: readonly RecordId[];
    readonly digest: RecordId;
    readonly mode: RecordMode;
    readonly record_id: RecordId;
    readonly schema_ref: string;
    readonly witness_ref: RecordId | "";
};
```

### `RecordId`

Classification: `type-only`. Kind: `type alias`.

A content-addressed retained-record identifier.

Runtime validation enforces the configured digest prefix and length.

Signature:

```ts
export type RecordId = string;
```

### `RecordMode`

Classification: `type-only`. Kind: `type alias`.

Whether a record declares intended state or captures observed state.

Signature:

```ts
export type RecordMode = (typeof RECORD_MODES)[number];
```

### `RecordShape`

Classification: `type-only`. Kind: `type alias`.

Visibility-filtered record shape without its semantic body.

Signature:

```ts
export type RecordShape = {
    readonly envelope: RecordEnvelope;
    readonly hidden_reason: "payload_hidden";
    readonly view?: RecordView;
};
```

### `RecordView`

Classification: `type-only`. Kind: `type alias`.

Path-local metadata assigned without changing semantic record identity.

Signature:

```ts
export type RecordView = {
    readonly append_intent_id?: string;
    readonly owner_id: TraceOwnerId;
    readonly owner_ordinal: OwnerOrdinal;
};
```

### `RetainedRecord`

Classification: `type-only`. Kind: `type alias`.

One semantic record and every retained owner-local occurrence.

Signature:

```ts
export type RetainedRecord = {
    readonly body: RecordBody;
    readonly envelope: RecordEnvelope;
    readonly views: readonly RecordView[];
};
```

### `SemanticRecord`

Classification: `type-only`. Kind: `type alias`.

A plain object containing semantic values.

Properties whose value is `undefined` are omitted during canonicalization.
Symbol and accessor properties are rejected.

Signature:

```ts
export type SemanticRecord = {
    readonly [key: string]: SemanticValue | undefined;
};
```

### `SemanticScalar`

Classification: `type-only`. Kind: `type alias`.

A scalar value accepted by the canonical semantic record format.

Numbers must be finite. Strings must contain well-formed Unicode.

Signature:

```ts
export type SemanticScalar = boolean | null | number | string;
```

### `SemanticValue`

Classification: `type-only`. Kind: `type alias`.

Any recursively representable value accepted in a semantic record.

Arrays must be dense data arrays without accessors or custom properties.

Signature:

```ts
export type SemanticValue = SemanticRecord | SemanticScalar | readonly SemanticValue[];
```

### `Slice`

Classification: `type-only`. Kind: `type alias`.

Immutable graph-shaped trace read.

Signature:

```ts
export type Slice = {
    readonly causal_edges: readonly (readonly [
        RecordId,
        RecordId
    ])[];
    readonly external_anchors: readonly ExternalAnchor[];
    readonly mode_filter: ModeFilter;
    readonly owner_paths: Readonly<Record<TraceOwnerId, readonly RecordId[]>>;
    readonly read_address?: Cut;
    readonly visible_records_by_id: Readonly<Record<RecordId, RecordShape | SliceRecord>>;
    readonly visible_witnesses_by_id: Readonly<Record<RecordId, SliceRecord>>;
    readonly visibility_profile: VisibilityProfile;
    readonly witness_anchors: readonly WitnessAnchor[];
};
```

### `SliceRecord`

Classification: `type-only`. Kind: `type alias`.

One selected payload-visible record occurrence.

Signature:

```ts
export type SliceRecord = {
    readonly body: RecordBody;
    readonly envelope: RecordEnvelope;
    readonly view?: RecordView;
};
```

### `TraceOwnerId`

Classification: `type-only`. Kind: `type alias`.

Stable identifier for one owner-local trace path.

Signature:

```ts
export type TraceOwnerId = string;
```

### `VisibilityProfile`

Classification: `type-only`. Kind: `type alias`.

Payload disclosure level for a graph-shaped trace read.

Signature:

```ts
export type VisibilityProfile = "full_internal" | "payload" | "shape_only";
```

### `WitnessAnchor`

Classification: `type-only`. Kind: `type alias`.

Visible placeholder for witness support whose payload is hidden.

Signature:

```ts
export type WitnessAnchor = {
    readonly hidden_reason: "hidden_by_visibility";
    readonly visible_shape: {
        readonly schema_ref: string;
        readonly witness_ref: RecordId | "";
    };
    readonly witness_ref: RecordId;
};
```

## Runs

Package entry: `./runs`

Run construction, control, execution, recovery, and inspection.

Runtime: ESM on Node >=24.12.0 <25, except the type-only /read entry (no Node runtime required).

Authority and mutation: Execution requires caller-supplied task and provider authority; durable operations additionally require an explicit trace-store handle. No ambient provider, persistence, or workspace authority is created.

Import example:

```ts
import * as api from "@avnionur/shepherd-typescript/runs";
void api;
```

Exported symbols: 108.

### `CancelledRunDefinition`

Classification: `type-only`. Kind: `type alias`.

Externally cancelled terminal definition accepted by createRunOutcome.

Signature:

```ts
export type CancelledRunDefinition = {
    readonly reason: string;
    readonly status: (typeof RUN_TERMINAL_STATUSES)[3];
};
```

### `CancelledRunOutcome`

Classification: `type-only`. Kind: `type alias`.

Externally cancelled immutable terminal run value.

Signature:

```ts
export type CancelledRunOutcome = {
    readonly reason: string;
    readonly status: (typeof RUN_TERMINAL_STATUSES)[3];
};
```

### `DurableExecutionCancellationCommand`

Classification: `type-only`. Kind: `type alias`.

Canonical semantic body retained for one durable cancellation request.

Signature:

```ts
export type DurableExecutionCancellationCommand = {
    readonly command_id: string;
    readonly command_kind: (typeof DURABLE_EXECUTION_CONTROL_COMMAND_KINDS)[3];
    readonly execution_id: string;
    readonly expected_lifecycle_record_id: RecordId;
    readonly fencing_token: number;
    readonly reason: string;
};
```

### `DurableExecutionClaimFencedError`

Classification: `runtime-and-type`. Kind: `class`.

Raised when an invocation claim expires or is superseded before start publication.

Signature:

```ts
export declare class DurableExecutionClaimFencedError extends TraceStoreError {
    readonly code: string;
    readonly claim_id: string;
    readonly run_id: string;
    constructor(runId: string, claimId: string);
}
```

#### `code`

Stable configuration-owned fencing error code.

```ts
readonly code: string;
```

#### `claim_id`

Claim identity rejected at the start boundary.

```ts
readonly claim_id: string;
```

#### `run_id`

Run whose start publication was fenced.

```ts
readonly run_id: string;
```

#### `constructor`

Creates an expired-or-superseded claim failure.

```ts
constructor(runId: string, claimId: string);
```

Parameter:

- runId - Run whose start publication was rejected.

Parameter:

- claimId - Rejected claim identity.

### `DurableExecutionClaimLostError`

Classification: `runtime-and-type`. Kind: `class`.

Raised when another caller already owns the durable provider-invocation claim.

Signature:

```ts
export declare class DurableExecutionClaimLostError extends TraceStoreError {
    readonly code: string;
    readonly claim_id: string;
    readonly run_id: string;
    readonly status: "lost";
    constructor(runId: string, claimId: string);
}
```

#### `code`

Stable configuration-owned claim-loss error code.

```ts
readonly code: string;
```

#### `claim_id`

Claim identity that won admission.

```ts
readonly claim_id: string;
```

#### `run_id`

Run whose invocation boundary is owned by another caller.

```ts
readonly run_id: string;
```

#### `status`

Typed losing-claim result status.

```ts
readonly status: "lost";
```

#### `constructor`

Creates a typed losing-claim result.

```ts
constructor(runId: string, claimId: string);
```

Parameter:

- runId - Run whose invocation boundary is already claimed.

Parameter:

- claimId - Current winning claim identity.

### `DurableExecutionInactiveCancellationCommand`

Classification: `type-only`. Kind: `type alias`.

Canonical semantic body retained for cancellation without an authoritative worker.

Signature:

```ts
export type DurableExecutionInactiveCancellationCommand = {
    readonly command_id: string;
    readonly command_kind: (typeof DURABLE_EXECUTION_CONTROL_COMMAND_KINDS)[3];
    readonly execution_id: string;
    readonly expected_lifecycle_record_id: RecordId;
    readonly reason: string;
};
```

### `DurableExecutionPauseCommand`

Classification: `type-only`. Kind: `type alias`.

Canonical semantic body retained for one durable pause request.

Signature:

```ts
export type DurableExecutionPauseCommand = {
    readonly command_id: string;
    readonly command_kind: (typeof DURABLE_EXECUTION_CONTROL_COMMAND_KINDS)[1];
    readonly execution_id: string;
    readonly expected_lifecycle_record_id: RecordId;
    readonly fencing_token: number;
    readonly reason: string;
};
```

### `DurableExecutionPrerequisiteSatisfaction`

Classification: `type-only`. Kind: `type alias`.

Canonical prerequisite-satisfaction evidence retained by a waiting resume command.

Signature:

```ts
export type DurableExecutionPrerequisiteSatisfaction = {
    readonly kind: string;
    readonly prerequisite_id: string;
    readonly receipt_id: string;
};
```

### `DurableExecutionRecoveryAbsentError`

Classification: `runtime-and-type`. Kind: `class`.

Raised when recovery is requested for a run without retained creation evidence.

Signature:

```ts
export declare class DurableExecutionRecoveryAbsentError extends TraceStoreError {
    readonly code: string;
    readonly run_id: string;
    readonly status: "absent";
    constructor(runId: string);
}
```

#### `code`

Stable configuration-owned absent-recovery error code.

```ts
readonly code: string;
```

#### `run_id`

Run that has no durable creation evidence.

```ts
readonly run_id: string;
```

#### `status`

Typed absent recovery status.

```ts
readonly status: "absent";
```

#### `constructor`

Creates an absent-run recovery failure.

```ts
constructor(runId: string);
```

Parameter:

- runId - Run that cannot be recovered because it has no creation evidence.

### `DurableExecutionRecoveryCommand`

Classification: `type-only`. Kind: `type alias`.

Canonical semantic body retained for one durable recovery command.

Signature:

```ts
export type DurableExecutionRecoveryCommand = {
    readonly command_id: string;
    readonly command_kind: (typeof DURABLE_EXECUTION_CONTROL_COMMAND_KINDS)[0];
    readonly execution_id: string;
};
```

### `DurableExecutionRecoveryCommandReceipt`

Classification: `type-only`. Kind: `type alias`.

Stable canonical evidence retained for one durable recovery command.

Signature:

```ts
export type DurableExecutionRecoveryCommandReceipt = {
    readonly command_id: string;
    readonly record_id: RecordId;
};
```

### `DurableExecutionRecoveryCommandRequiredError`

Classification: `runtime-and-type`. Kind: `class`.

Raised when an existing incomplete execution requires an explicit durable command.

Signature:

```ts
export declare class DurableExecutionRecoveryCommandRequiredError extends TraceStoreError {
    readonly code: string;
    readonly run_id: string;
    readonly status: typeof CREATED_RECOVERY_STATUS | typeof TERMINAL_PENDING_CUT_STATUS;
    constructor(runId: string, status: typeof CREATED_RECOVERY_STATUS | typeof TERMINAL_PENDING_CUT_STATUS);
}
```

#### `code`

Stable configuration-owned command-required error code.

```ts
readonly code: string;
```

#### `run_id`

Run whose incomplete evidence requires explicit recovery authority.

```ts
readonly run_id: string;
```

#### `status`

Incomplete state that cannot be advanced by ordinary execution.

```ts
readonly status: typeof CREATED_RECOVERY_STATUS | typeof TERMINAL_PENDING_CUT_STATUS;
```

#### `constructor`

Creates an explicit-command-required recovery failure.

```ts
constructor(runId: string, status: typeof CREATED_RECOVERY_STATUS | typeof TERMINAL_PENDING_CUT_STATUS);
```

Parameter:

- runId - Run whose incomplete evidence requires recovery authority.

Parameter:

- status - Recoverable incomplete state rejected by ordinary execution.

### `DurableExecutionRecoveryError`

Classification: `runtime-and-type`. Kind: `class`.

Raised when durable evidence cannot prove that provider invocation is safe to repeat.

Signature:

```ts
export declare class DurableExecutionRecoveryError extends TraceStoreError {
    readonly code: string;
    readonly run_id: string;
    readonly status: "started";
    constructor(runId: string);
}
```

#### `code`

Stable configuration-owned recovery error code.

```ts
readonly code: string;
```

#### `run_id`

Run whose retained start has no terminal evidence.

```ts
readonly run_id: string;
```

#### `status`

Unsafe durable recovery state.

```ts
readonly status: "started";
```

#### `constructor`

Creates an unsafe-started-run recovery failure.

```ts
constructor(runId: string);
```

Parameter:

- runId - Run whose provider may already have been invoked.

### `DurableExecutionResumeCommand`

Classification: `type-only`. Kind: `type alias`.

Canonical semantic body retained for one durable resume command.

Signature:

```ts
export type DurableExecutionResumeCommand = {
    readonly command_id: string;
    readonly command_kind: (typeof DURABLE_EXECUTION_CONTROL_COMMAND_KINDS)[2];
    readonly continuation_descriptor_id: RecordId;
    readonly execution_id: string;
    readonly expected_lifecycle_record_id: RecordId;
    readonly prerequisite_satisfaction?: DurableExecutionPrerequisiteSatisfaction;
};
```

### `DurableTaskCancellationAcknowledgementOptions`

Classification: `type-only`. Kind: `type alias`.

Options for acknowledging cancellation at the exact current worker safe boundary.

Signature:

```ts
export type DurableTaskCancellationAcknowledgementOptions = {
    readonly cancelCommandRecordId: RecordId;
    readonly claimId: string;
    readonly expectedLifecycleRecordId: RecordId;
    readonly fencingToken: number;
    readonly runId: string;
};
```

### `DurableTaskCancellationCommandReceipt`

Classification: `type-only`. Kind: `type alias`.

Stable canonical evidence retained for one durable cancellation request.

Signature:

```ts
export type DurableTaskCancellationCommandReceipt = {
    readonly command_id: string;
    readonly record_id: RecordId;
};
```

### `DurableTaskCancellationOptions`

Classification: `type-only`. Kind: `type alias`.

Options for retaining one globally idempotent durable cancellation request.

Signature:

```ts
export type DurableTaskCancellationOptions = {
    readonly commandId: string;
    readonly expectedLifecycleRecordId: RecordId;
    readonly fencingToken: number;
    readonly reason: string;
    readonly runId: string;
};
```

### `DurableTaskDirectCancellationOptions`

Classification: `type-only`. Kind: `type alias`.

Options for atomically cancelling a durable run without an authoritative worker.

Signature:

```ts
export type DurableTaskDirectCancellationOptions = {
    readonly commandId: string;
    readonly expectedLifecycleRecordId: RecordId;
    readonly reason: string;
    readonly runId: string;
};
```

### `DurableTaskExecutionArtifactInspection`

Classification: `type-only`. Kind: `type alias`.

One retained artifact and its canonical record identity in an inspection view.

Signature:

```ts
export type DurableTaskExecutionArtifactInspection = {
    readonly artifact: RunArtifact;
    readonly record_id: RecordId;
};
```

### `DurableTaskExecutionContinuationConstituentInspection`

Classification: `type-only`. Kind: `type alias`.

One classified continuation constituent in a durable inspection view.

Signature:

```ts
export type DurableTaskExecutionContinuationConstituentInspection = {
    readonly kind: (typeof RUN_CONTINUATION_CONSTITUENT_KINDS)[number];
    readonly receipt_id: string | null;
    readonly status: (typeof RUN_CONTINUATION_EVIDENCE_STATUSES)[number];
};
```

### `DurableTaskExecutionContinuationInspection`

Classification: `type-only`. Kind: `type alias`.

Validated continuation descriptor and its immutable trace cut.

Signature:

```ts
export type DurableTaskExecutionContinuationInspection = {
    readonly constituents: readonly DurableTaskExecutionContinuationConstituentInspection[];
    readonly record_id: RecordId;
    readonly trace_cut: Cut;
};
```

### `DurableTaskExecutionInspection`

Classification: `type-only`. Kind: `type alias`.

Read-only projection of validated durable task-execution evidence.

Signature:

```ts
export type DurableTaskExecutionInspection = {
    readonly artifacts: readonly DurableTaskExecutionArtifactInspection[];
    readonly causal_edges: readonly (readonly [
        RecordId,
        RecordId
    ])[];
    readonly cut: Cut | null;
    readonly lifecycle: DurableTaskExecutionLifecycleInspection;
    readonly outcome: DurableTaskExecutionOutcomeInspection | null;
    readonly run_id: string;
    readonly settlements: readonly DurableTaskExecutionSettlementInspection[];
    readonly status: (typeof DURABLE_EXECUTION_RECOVERY_STATUSES)[number];
    readonly usage: DurableTaskExecutionUsageInspection | null;
};
```

### `DurableTaskExecutionLifecycleInspection`

Classification: `type-only`. Kind: `type alias`.

Lifecycle record identities visible for one durable task execution.

Signature:

```ts
export type DurableTaskExecutionLifecycleInspection = {
    readonly created_record_id: RecordId | null;
    readonly quiescent: DurableTaskExecutionQuiescentInspection | null;
    readonly running_continuation_record_id: RecordId | null;
    readonly started_record_id: RecordId | null;
    readonly terminal_record_id: RecordId | null;
    readonly terminal_schema_ref: string | null;
};
```

### `DurableTaskExecutionOutcomeInspection`

Classification: `type-only`. Kind: `type alias`.

One retained terminal outcome and its canonical record identity.

Signature:

```ts
export type DurableTaskExecutionOutcomeInspection = {
    readonly outcome: RunOutcome;
    readonly record_id: RecordId;
};
```

### `DurableTaskExecutionQuiescentInspection`

Classification: `type-only`. Kind: `type alias`.

Read-only waiting or suspension acknowledgement evidence.

Signature:

```ts
export type DurableTaskExecutionQuiescentInspection = {
    readonly acknowledgement_record_id: RecordId;
    readonly acknowledgement_schema_ref: string;
    readonly continuation: DurableTaskExecutionContinuationInspection;
    readonly pause_command_record_id: null;
    readonly prerequisite: {
        readonly kind: string;
        readonly prerequisite_id: string;
    };
    readonly status: typeof RUN_LIFECYCLE_WAITING_STATUS;
} | {
    readonly acknowledgement_record_id: RecordId;
    readonly acknowledgement_schema_ref: string;
    readonly continuation: DurableTaskExecutionContinuationInspection;
    readonly pause_command_record_id: RecordId;
    readonly prerequisite: null;
    readonly status: typeof RUN_LIFECYCLE_SUSPENDED_STATUS;
};
```

### `DurableTaskExecutionRecovery`

Classification: `type-only`. Kind: `type alias`.

Durable execution recovery classification returned by readDurableTaskExecution.

Signature:

```ts
export type DurableTaskExecutionRecovery = {
    readonly run_id: string;
    readonly status: (typeof DURABLE_EXECUTION_RECOVERY_STATUSES)[0];
} | {
    readonly created_record_id: RecordId;
    readonly run_id: string;
    readonly status: (typeof DURABLE_EXECUTION_RECOVERY_STATUSES)[1];
} | {
    readonly created_record_id: RecordId;
    readonly run_id: string;
    readonly started_record_id: RecordId;
    readonly status: (typeof DURABLE_EXECUTION_RECOVERY_STATUSES)[2];
} | {
    readonly execution: TaskExecutionResult;
    readonly ledger: Omit<TaskExecutionLedgerReceipt, "cut">;
    readonly run_id: string;
    readonly status: (typeof DURABLE_EXECUTION_RECOVERY_STATUSES)[3];
} | {
    readonly result: DurableTaskExecutionResult;
    readonly run_id: string;
    readonly status: (typeof DURABLE_EXECUTION_RECOVERY_STATUSES)[4];
};
```

### `DurableTaskExecutionResult`

Classification: `type-only`. Kind: `type alias`.

Terminal task result paired with its durable trace evidence.

Signature:

```ts
export type DurableTaskExecutionResult = {
    readonly execution: TaskExecutionResult;
    readonly ledger: TaskExecutionLedgerReceipt;
};
```

### `DurableTaskExecutionSettlementInspection`

Classification: `type-only`. Kind: `type alias`.

One validated, cut-bounded retained-world settlement citation.

Signature:

```ts
export type DurableTaskExecutionSettlementInspection = {
    readonly action: (typeof RETAINED_WORLD_SETTLEMENT_ACTIONS)[number];
    readonly citation_cut: Cut;
    readonly citation_record_id: RecordId;
    readonly citation_version: typeof RETAINED_WORLD_SETTLEMENT_CITATION_VERSION;
    readonly command_id: string;
    readonly operation: DurableTaskExecutionSettlementOperationInspection;
    readonly output_id: string;
    readonly receipt: DurableTaskExecutionSettlementReceiptInspection;
    readonly request_id: string;
    readonly state: (typeof RETAINED_WORLD_SETTLEMENT_STATES)[2 | 3 | 4 | 5];
    readonly trace: DurableTaskExecutionSettlementTraceInspection;
};
```

### `DurableTaskExecutionSettlementOperationInspection`

Classification: `type-only`. Kind: `type alias`.

Canonical settlement operation evidence attached to a durable execution.

Signature:

```ts
export type DurableTaskExecutionSettlementOperationInspection = {
    readonly digest: string;
    readonly id: string;
    readonly json: string;
};
```

### `DurableTaskExecutionSettlementReceiptInspection`

Classification: `type-only`. Kind: `type alias`.

Canonical terminal settlement receipt attached to a durable execution.

Signature:

```ts
export type DurableTaskExecutionSettlementReceiptInspection = {
    readonly digest: string;
    readonly json: string;
};
```

### `DurableTaskExecutionSettlementTraceInspection`

Classification: `type-only`. Kind: `type alias`.

Exact terminal trace identities cited by one retained-world settlement.

Signature:

```ts
export type DurableTaskExecutionSettlementTraceInspection = {
    readonly capture_record_id: RecordId;
    readonly execution_cut_id: string;
    readonly outcome_record_id: RecordId;
    readonly terminal_record_id: RecordId;
};
```

### `DurableTaskExecutionUsageInspection`

Classification: `type-only`. Kind: `type alias`.

One retained aggregate usage value and its canonical record identity.

Signature:

```ts
export type DurableTaskExecutionUsageInspection = {
    readonly record_id: RecordId;
    readonly usage: RunUsage;
};
```

### `DurableTaskPauseCommandReceipt`

Classification: `type-only`. Kind: `type alias`.

Stable canonical evidence retained for one durable pause request.

Signature:

```ts
export type DurableTaskPauseCommandReceipt = {
    readonly command_id: string;
    readonly record_id: RecordId;
};
```

### `DurableTaskPauseOptions`

Classification: `type-only`. Kind: `type alias`.

Options for retaining one globally idempotent durable pause request.

Signature:

```ts
export type DurableTaskPauseOptions = {
    readonly commandId: string;
    readonly expectedLifecycleRecordId: RecordId;
    readonly fencingToken: number;
    readonly reason: string;
    readonly runId: string;
};
```

### `DurableTaskPrerequisiteSatisfaction`

Classification: `type-only`. Kind: `type alias`.

Prerequisite-satisfaction evidence supplied to a guarded waiting resume.

Signature:

```ts
export type DurableTaskPrerequisiteSatisfaction = {
    readonly kind: string;
    readonly prerequisiteId: string;
    readonly receiptId: string;
};
```

### `DurableTaskRecoveryOptions`

Classification: `type-only`. Kind: `type alias`.

Options for one idempotent durable task-recovery command.

Signature:

```ts
export type DurableTaskRecoveryOptions<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>> = {
    readonly commandId: string;
    readonly execution: TaskExecutionOptions<I, O>;
};
```

### `DurableTaskRecoveryResult`

Classification: `type-only`. Kind: `type alias`.

Recovered durable result paired with its canonical control-command evidence.

Signature:

```ts
export type DurableTaskRecoveryResult = {
    readonly command: DurableExecutionRecoveryCommandReceipt;
    readonly result: DurableTaskExecutionResult;
};
```

### `DurableTaskResumeOptions`

Classification: `type-only`. Kind: `type alias`.

Options for atomically resuming one exact suspended or satisfied waiting durable task.

Signature:

```ts
export type DurableTaskResumeOptions = {
    readonly commandId: string;
    readonly continuationDescriptorRecordId: RecordId;
    readonly expectedLifecycleRecordId: RecordId;
    readonly prerequisiteSatisfaction?: DurableTaskPrerequisiteSatisfaction;
    readonly runId: string;
};
```

### `DurableTaskResumeReceipt`

Classification: `type-only`. Kind: `type alias`.

Canonical command, running acknowledgement, and new worker authority for a resumed run.

Signature:

```ts
export type DurableTaskResumeReceipt = {
    readonly claim_id: string;
    readonly command_record_id: RecordId;
    readonly fencing_token: number;
    readonly lease_expires_at: number;
    readonly running_record_id: RecordId;
};
```

### `DurableTaskSuspensionOptions`

Classification: `type-only`. Kind: `type alias`.

Options for atomically acknowledging command-authorized durable suspension.

Signature:

```ts
export type DurableTaskSuspensionOptions = {
    readonly constituents: readonly RunContinuationCheckpointEvidence[];
    readonly expectedLifecycleRecordId: RecordId;
    readonly fencingToken: number;
    readonly pauseCommandRecordId: RecordId;
    readonly runId: string;
    readonly traceCutId: string;
};
```

### `DurableTaskSuspensionReceipt`

Classification: `type-only`. Kind: `type alias`.

Canonical descriptor and acknowledgement retained for one suspended run.

Signature:

```ts
export type DurableTaskSuspensionReceipt = {
    readonly acknowledgement_record_id: RecordId;
    readonly continuation_descriptor_record_id: RecordId;
    readonly trace_cut_id: string;
};
```

### `DurableTaskWaitingOptions`

Classification: `type-only`. Kind: `type alias`.

Options for atomically acknowledging prerequisite-driven durable waiting.

Signature:

```ts
export type DurableTaskWaitingOptions = {
    readonly constituents: readonly RunContinuationCheckpointEvidence[];
    readonly expectedLifecycleRecordId: RecordId;
    readonly fencingToken: number;
    readonly prerequisite: DurableTaskWaitingPrerequisite;
    readonly runId: string;
    readonly traceCutId: string;
};
```

### `DurableTaskWaitingPrerequisite`

Classification: `type-only`. Kind: `type alias`.

Prerequisite that makes a durable running task quiescent.

Signature:

```ts
export type DurableTaskWaitingPrerequisite = {
    readonly kind: string;
    readonly prerequisiteId: string;
};
```

### `DurableTaskWaitingReceipt`

Classification: `type-only`. Kind: `type alias`.

Canonical descriptor and acknowledgement retained for one waiting run.

Signature:

```ts
export type DurableTaskWaitingReceipt = {
    readonly acknowledgement_record_id: RecordId;
    readonly continuation_descriptor_record_id: RecordId;
    readonly trace_cut_id: string;
};
```

### `ExhaustedRunDefinition`

Classification: `type-only`. Kind: `type alias`.

Budget-exhausted terminal definition accepted by createRunOutcome.

Signature:

```ts
export type ExhaustedRunDefinition = {
    readonly reason: string;
    readonly status: (typeof RUN_TERMINAL_STATUSES)[2];
};
```

### `ExhaustedRunOutcome`

Classification: `type-only`. Kind: `type alias`.

Budget-exhausted immutable terminal run value.

Signature:

```ts
export type ExhaustedRunOutcome = {
    readonly reason: string;
    readonly status: (typeof RUN_TERMINAL_STATUSES)[2];
};
```

### `FailedRunDefinition`

Classification: `type-only`. Kind: `type alias`.

Failed terminal definition accepted by createRunOutcome.

Signature:

```ts
export type FailedRunDefinition = {
    readonly errorType: string;
    readonly message: string;
    readonly retryable?: boolean;
    readonly status: (typeof RUN_TERMINAL_STATUSES)[1];
};
```

### `FailedRunOutcome`

Classification: `type-only`. Kind: `type alias`.

Failed immutable terminal run value.

Signature:

```ts
export type FailedRunOutcome = {
    readonly error_type: string;
    readonly message: string;
    readonly retryable: boolean | null;
    readonly status: (typeof RUN_TERMINAL_STATUSES)[1];
};
```

### `FinishedRunDefinition`

Classification: `type-only`. Kind: `type alias`.

Successful terminal definition accepted by createRunOutcome.

Signature:

```ts
export type FinishedRunDefinition<V extends SemanticValue = SemanticValue> = {
    readonly status: (typeof RUN_TERMINAL_STATUSES)[0];
    readonly value: V;
};
```

### `FinishedRunOutcome`

Classification: `type-only`. Kind: `type alias`.

Successful immutable terminal run value.

Signature:

```ts
export type FinishedRunOutcome<V extends SemanticValue = SemanticValue> = {
    readonly status: (typeof RUN_TERMINAL_STATUSES)[0];
    readonly value: V;
};
```

### `RunArtifact`

Classification: `type-only`. Kind: `type alias`.

Immutable versioned record for one ordered side-channel run artifact.

Signature:

```ts
export type RunArtifact<C extends RunArtifactContentDefinition = RunArtifactContentDefinition> = {
    readonly artifact_ordinal: number;
    readonly artifact_version: number;
    readonly content: RunArtifactContentFor<C>;
    readonly kind: string;
    readonly metadata: SemanticRecord;
    readonly name: string;
    readonly run_id: string;
};
```

### `RunArtifactContentDefinition`

Classification: `type-only`. Kind: `type alias`.

Content representation accepted by createRunArtifact.

Signature:

```ts
export type RunArtifactContentDefinition = RunBlobArtifactContentDefinition | RunTextArtifactContentDefinition;
```

### `RunArtifactContentFor`

Classification: `type-only`. Kind: `type alias`.

Maps an artifact definition to its exact canonical content representation.

Signature:

```ts
export type RunArtifactContentFor<C extends RunArtifactContentDefinition> = C extends RunTextArtifactContentDefinition ? RunTextArtifactContent : RunBlobArtifactContent;
```

### `RunArtifactDefinition`

Classification: `type-only`. Kind: `type alias`.

Definition accepted by createRunArtifact.

Signature:

```ts
export type RunArtifactDefinition<C extends RunArtifactContentDefinition> = {
    readonly artifactOrdinal: number;
    readonly content: C;
    readonly kind: string;
    readonly metadata: SemanticRecord;
    readonly name: string;
    readonly runId: string;
};
```

### `RunBlobArtifactContent`

Classification: `type-only`. Kind: `type alias`.

Durable binary reference retained by a run artifact record.

Signature:

```ts
export type RunBlobArtifactContent = {
    readonly blob_id: string;
    readonly byte_length: number;
    readonly type: (typeof RUN_ARTIFACT_CONTENT_TYPES)[1];
};
```

### `RunBlobArtifactContentDefinition`

Classification: `type-only`. Kind: `type alias`.

Durable binary content accepted by createRunArtifact.

Signature:

```ts
export type RunBlobArtifactContentDefinition = {
    readonly receipt: BlobStorageReceipt;
    readonly type: (typeof RUN_ARTIFACT_CONTENT_TYPES)[1];
};
```

### `RunBudgetDefinition`

Classification: `type-only`. Kind: `type alias`.

Optional limits applied by createRunControl.

Signature:

```ts
export type RunBudgetDefinition = {
    readonly maxCostUsd?: number;
    readonly maxDurationMilliseconds?: number;
    readonly maxEffects?: number;
    readonly maxInputTokens?: number;
    readonly maxOutputTokens?: number;
    readonly maxTurns?: number;
};
```

### `RunBudgetExhaustedError`

Classification: `runtime-and-type`. Kind: `class`.

Error carried by a run-control signal after budget exhaustion.

Signature:

```ts
export declare class RunBudgetExhaustedError extends Error {
    readonly code: string;
    readonly limit: number;
    readonly metric: RunBudgetExhaustionReason["metric"];
    readonly observed: number;
    constructor(reason: RunBudgetExhaustionReason);
}
```

#### `code`

Stable configured machine-readable budget-exhaustion code.

```ts
readonly code: string;
```

#### `limit`

Configured limit that was exceeded.

```ts
readonly limit: number;
```

#### `metric`

First configured metric that exceeded its limit.

```ts
readonly metric: RunBudgetExhaustionReason["metric"];
```

#### `observed`

Aggregate value observed at exhaustion.

```ts
readonly observed: number;
```

#### `constructor`

Creates an error from a structured exhaustion reason.

```ts
constructor(reason: RunBudgetExhaustionReason);
```

Parameter:

- reason - Exhausted metric, configured limit, and observed aggregate.

### `RunBudgetExhaustionReason`

Classification: `type-only`. Kind: `type alias`.

Structured reason for budget exhaustion.

Signature:

```ts
export type RunBudgetExhaustionReason = {
    readonly limit: number;
    readonly metric: RunBudgetMetric;
    readonly observed: number;
    readonly type: (typeof RUN_CONTROL_REASON_TYPES)[0];
};
```

### `RunBudgetMetric`

Classification: `type-only`. Kind: `type alias`.

Configured metric that can exhaust a run budget.

Signature:

```ts
export type RunBudgetMetric = (typeof RUN_BUDGET_METRICS)[number];
```

### `RunCancellationReason`

Classification: `type-only`. Kind: `type alias`.

Structured reason for external or disposal cancellation.

Signature:

```ts
export type RunCancellationReason = {
    readonly message: string;
    readonly type: (typeof RUN_CONTROL_REASON_TYPES)[1];
};
```

### `RunCancelledError`

Classification: `runtime-and-type`. Kind: `class`.

Error carried by a run-control signal after cancellation.

Signature:

```ts
export declare class RunCancelledError extends Error {
    readonly code: string;
    constructor(message: string, cause?: unknown);
}
```

#### `code`

Stable configured machine-readable cancellation code.

```ts
readonly code: string;
```

#### `constructor`

Creates a stable cancellation error while retaining the caller's reason as its cause.

```ts
constructor(message: string, cause?: unknown);
```

Parameter:

- message - Stable inspectable cancellation explanation.

Parameter:

- cause - Optional original caller-signal reason.

### `RunConsumption`

Classification: `type-only`. Kind: `type alias`.

Aggregate resource consumption observed by a run control.

Signature:

```ts
export type RunConsumption = {
    readonly costUsd: number;
    readonly effects: number;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly turns: number;
};
```

### `RunConsumptionDefinition`

Classification: `type-only`. Kind: `type alias`.

Incremental resource consumption admitted by RunControl.consume.

Signature:

```ts
export type RunConsumptionDefinition = {
    readonly costUsd?: number;
    readonly effects?: number;
    readonly inputTokens?: number;
    readonly outputTokens?: number;
    readonly turns?: number;
};
```

### `RunContinuationCheckpointAdapter`

Classification: `type-only`. Kind: `type alias`.

Adapter for one configured continuation constituent at a proven safe boundary.

Signature:

```ts
export type RunContinuationCheckpointAdapter = {
    readonly kind: (typeof RUN_CONTINUATION_CONSTITUENT_KINDS)[number];
    readonly checkpoint: (context: RunContinuationCheckpointContext) => Promise<RunContinuationCheckpointEvidence>;
};
```

### `RunContinuationCheckpointContext`

Classification: `type-only`. Kind: `type alias`.

Immutable context presented to each continuation checkpoint adapter.

Signature:

```ts
export type RunContinuationCheckpointContext = {
    readonly expected_lifecycle_record_id: RecordId;
    readonly run_id: string;
    readonly trace_cut_id: string;
};
```

### `RunContinuationCheckpointEvidence`

Classification: `type-only`. Kind: `type alias`.

Configured continuation constituent classified by a checkpoint adapter.

Signature:

```ts
export type RunContinuationCheckpointEvidence = {
    readonly kind: (typeof RUN_CONTINUATION_CONSTITUENT_KINDS)[number];
    readonly receipt_id?: string;
    readonly status: (typeof RUN_CONTINUATION_EVIDENCE_STATUSES)[number];
};
```

### `RunContinuationCheckpointOptions`

Classification: `type-only`. Kind: `type alias`.

Options for collecting every configured continuation constituent at a safe boundary.

Signature:

```ts
export type RunContinuationCheckpointOptions = {
    readonly adapters: readonly RunContinuationCheckpointAdapter[];
    readonly expectedLifecycleRecordId: RecordId;
    readonly runId: string;
    readonly traceCutId: string;
};
```

### `RunControl`

Classification: `type-only`. Kind: `type alias`.

Cooperative resource and cancellation control for one run.

Signature:

```ts
export type RunControl = {
    readonly signal: AbortSignal;
    consume(consumption: RunConsumptionDefinition): RunControlSnapshot;
    dispose(): void;
    snapshot(): RunControlSnapshot;
};
```

### `RunControlOptions`

Classification: `type-only`. Kind: `type alias`.

Options accepted by createRunControl.

Signature:

```ts
export type RunControlOptions = {
    readonly budget: RunBudgetDefinition;
    readonly signal?: AbortSignal;
};
```

### `RunControlReason`

Classification: `type-only`. Kind: `type alias`.

One terminal reason retained by a run control snapshot.

Signature:

```ts
export type RunControlReason = RunBudgetExhaustionReason | RunCancellationReason;
```

### `RunControlSnapshot`

Classification: `type-only`. Kind: `type alias`.

Immutable observable state of a run control.

Signature:

```ts
export type RunControlSnapshot = {
    readonly consumed: RunConsumption;
    readonly reason: RunControlReason | null;
    readonly status: RunControlStatus;
};
```

### `RunControlStatus`

Classification: `type-only`. Kind: `type alias`.

Configured lifecycle status of a run control.

Signature:

```ts
export type RunControlStatus = (typeof RUN_CONTROL_STATUSES)[number];
```

### `RunLifecycleStatus`

Classification: `type-only`. Kind: `type alias`.

Configured normative run-lifecycle status.

Signature:

```ts
export type RunLifecycleStatus = (typeof RUN_LIFECYCLE_STATUSES)[number];
```

### `RunLifecycleTerminalStatus`

Classification: `type-only`. Kind: `type alias`.

Configured immutable terminal outcome status.

Signature:

```ts
export type RunLifecycleTerminalStatus = (typeof RUN_TERMINAL_STATUSES)[number];
```

### `RunLifecycleTransition`

Classification: `type-only`. Kind: `type alias`.

Validated immutable normative run-lifecycle transition.

Signature:

```ts
export type RunLifecycleTransition = {
    readonly source_status: RunLifecycleStatus;
    readonly target_status: RunLifecycleStatus;
    readonly terminal_status?: RunLifecycleTerminalStatus;
};
```

### `RunLifecycleTransitionDefinition`

Classification: `type-only`. Kind: `type alias`.

Requested pure normative run-lifecycle transition.

Signature:

```ts
export type RunLifecycleTransitionDefinition = {
    readonly source_status: RunLifecycleStatus;
    readonly target_status: RunLifecycleStatus;
    readonly terminal_status?: RunLifecycleTerminalStatus;
};
```

### `RunOutcome`

Classification: `type-only`. Kind: `type alias`.

Immutable versioned record for exactly one terminal task-run result.

Signature:

```ts
export type RunOutcome<O extends RunTerminalOutcome = RunTerminalOutcome> = {
    readonly outcome_version: number;
    readonly outcome: O;
    readonly run_id: string;
    readonly task_artifact_lock: TaskArtifactLock;
};
```

### `RunOutcomeDefinition`

Classification: `type-only`. Kind: `type alias`.

Definition accepted by createRunOutcome.

Signature:

```ts
export type RunOutcomeDefinition<O extends RunTerminalDefinition = RunTerminalDefinition> = {
    readonly outcome: O;
    readonly runId: string;
    readonly taskArtifactLock: TaskArtifactLock;
};
```

### `RunOutcomeFor`

Classification: `type-only`. Kind: `type alias`.

Maps an accepted terminal definition to its exact immutable wire outcome.

Signature:

```ts
export type RunOutcomeFor<O extends RunTerminalDefinition> = RunOutcome<O extends FinishedRunDefinition<infer V> ? FinishedRunOutcome<V> : O extends FailedRunDefinition ? FailedRunOutcome : O extends ExhaustedRunDefinition ? ExhaustedRunOutcome : CancelledRunOutcome>;
```

### `RunTerminalDefinition`

Classification: `type-only`. Kind: `type alias`.

One of the four accepted terminal run definitions.

Signature:

```ts
export type RunTerminalDefinition<V extends SemanticValue = SemanticValue> = CancelledRunDefinition | ExhaustedRunDefinition | FailedRunDefinition | FinishedRunDefinition<V>;
```

### `RunTerminalOutcome`

Classification: `type-only`. Kind: `type alias`.

One immutable terminal run value.

Signature:

```ts
export type RunTerminalOutcome<V extends SemanticValue = SemanticValue> = CancelledRunOutcome | ExhaustedRunOutcome | FailedRunOutcome | FinishedRunOutcome<V>;
```

### `RunTerminalStatus`

Classification: `type-only`. Kind: `type alias`.

Configured terminal status of one completed run record.

Signature:

```ts
export type RunTerminalStatus = (typeof RUN_TERMINAL_STATUSES)[number];
```

### `RunTextArtifactContent`

Classification: `type-only`. Kind: `type alias`.

Inline textual content retained by a run artifact record.

Signature:

```ts
export type RunTextArtifactContent = RunTextArtifactContentDefinition;
```

### `RunTextArtifactContentDefinition`

Classification: `type-only`. Kind: `type alias`.

Inline textual content accepted by createRunArtifact.

Signature:

```ts
export type RunTextArtifactContentDefinition = {
    readonly text: string;
    readonly type: (typeof RUN_ARTIFACT_CONTENT_TYPES)[0];
};
```

### `RunUsage`

Classification: `type-only`. Kind: `type alias`.

Immutable versioned aggregate resource-usage record for one run.

Signature:

```ts
export type RunUsage = {
    readonly cache_creation_input_tokens: number;
    readonly cache_read_input_tokens: number;
    readonly cost_usd: number | null;
    readonly input_tokens: number;
    readonly output_tokens: number;
    readonly run_id: string;
    readonly usage_version: number;
};
```

### `RunUsageDefinition`

Classification: `type-only`. Kind: `type alias`.

Aggregate token and cost totals accepted by createRunUsage.

Signature:

```ts
export type RunUsageDefinition = {
    readonly cacheCreationInputTokens: number;
    readonly cacheReadInputTokens: number;
    readonly costUsd?: number;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly runId: string;
};
```

### `TaskExecutionLedgerReceipt`

Classification: `type-only`. Kind: `type alias`.

Durable trace evidence retained for one task execution.

Signature:

```ts
export type TaskExecutionLedgerReceipt = {
    readonly artifact_record_ids: readonly RecordId[];
    readonly cut: Cut;
    readonly created_record_id: RecordId;
    readonly lifecycle_record_id: RecordId;
    readonly outcome_record_id: RecordId;
    readonly started: boolean;
    readonly started_record_id: RecordId | null;
    readonly usage_record_id: RecordId | null;
};
```

### `TaskExecutionOptions`

Classification: `type-only`. Kind: `type alias`.

Options for one provider-backed bodyless task execution.

Signature:

```ts
export type TaskExecutionOptions<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>> = {
    readonly budget: RunBudgetDefinition;
    readonly input: InferTaskSchema<I>;
    readonly provider: ModelProvider;
    readonly runId: string;
    readonly signal?: AbortSignal;
    readonly task: TaskDescriptor<I, O>;
};
```

### `TaskExecutionResult`

Classification: `type-only`. Kind: `type alias`.

Terminal records and final observable state produced by one task execution.

Signature:

```ts
export type TaskExecutionResult = {
    readonly artifacts: readonly RunArtifact[];
    readonly control: RunControlSnapshot;
    readonly outcome: RunOutcome;
    readonly provider: ProviderDescriptor;
    readonly usage: RunUsage | null;
};
```

### `acknowledgeDurableTaskCancellation`

Classification: `runtime-only`. Kind: `function`.

Acknowledges command-authorized cancellation at the exact current worker safe boundary.

Terminal evidence and claim release commit atomically. The resulting cut is then published
deterministically; exact acknowledgement replay reconstructs the retained cancelled result.

Signature:

```ts
export declare function acknowledgeDurableTaskCancellation(store: SQLiteTraceStore, options: DurableTaskCancellationAcknowledgementOptions): DurableTaskExecutionResult;
```

Parameter:

- store - Open trace store containing the running execution and cancellation command.

Parameter:

- options - Exact command and worker authority reaching the safe boundary.

Returns:

- Immutable cancelled execution and durable terminal receipt.

Throws:

- {TypeError} If options or command evidence are malformed.

Throws:

- {TraceStoreError} If lifecycle, command, or worker authority is inconsistent.

Throws:

- {DurableExecutionClaimFencedError} If the worker is no longer authoritative.

Example:

- ```ts
const cancelled = acknowledgeDurableTaskCancellation(store, {
    cancelCommandRecordId: command.record_id,
    claimId,
    expectedLifecycleRecordId: startedRecordId,
    fencingToken,
    runId: "run:42",
});
cancelled.execution.outcome.outcome.status;
```

### `acknowledgeDurableTaskSuspension`

Classification: `runtime-only`. Kind: `function`.

Atomically acknowledges a command-authorized durable suspension and releases the worker fence.

The immutable cut is published through the expected running record before the transaction. The
transaction then validates the exact current claim, pause command, lifecycle head, cut, and
resumable constituent evidence; appends the continuation descriptor and suspension
acknowledgement; and releases the claim. Exact replay returns the retained receipt.

Signature:

```ts
export declare function acknowledgeDurableTaskSuspension(store: SQLiteTraceStore, options: DurableTaskSuspensionOptions): DurableTaskSuspensionReceipt;
```

Parameter:

- store - Open trace store containing the running execution and pause command.

Parameter:

- options - Exact running authority, cut, pause command, and checkpoint evidence.

Returns:

- Canonical continuation and suspension acknowledgement identities.

Throws:

- {TypeError} If options or constituent evidence are malformed or unavailable.

Throws:

- {TraceStoreError} If the running authority, pause command, or cut is inconsistent.

Throws:

- {AppendIntentConflictError} If the same suspension intent names different evidence.

### `acknowledgeDurableTaskWaiting`

Classification: `runtime-only`. Kind: `function`.

Atomically acknowledges prerequisite-driven waiting and releases the worker fence.

The immutable cut is published through the exact running head before one store transaction
validates the current claim and lifecycle, appends the continuation descriptor plus explicit
prerequisite acknowledgement, and releases the worker. Exact replay returns retained evidence.

Signature:

```ts
export declare function acknowledgeDurableTaskWaiting(store: SQLiteTraceStore, options: DurableTaskWaitingOptions): DurableTaskWaitingReceipt;
```

Parameter:

- store - Open trace store containing the running execution.

Parameter:

- options - Exact running authority, cut, prerequisite, and checkpoint evidence.

Returns:

- Canonical continuation and waiting acknowledgement identities.

Throws:

- {TypeError} If options or constituent evidence are malformed or unavailable.

Throws:

- {TraceStoreError} If the running authority, lifecycle head, or cut is inconsistent.

Throws:

- {AppendIntentConflictError} If the same waiting intent names different evidence.

### `cancelDurableTask`

Classification: `runtime-only`. Kind: `function`.

Atomically cancels a created, waiting, or suspended durable run.

The globally idempotent command, cancelled outcome, and terminal lifecycle commit in one store
transaction after exact-head comparison. Any retained pre-start or released claim is expired in
that transaction. Running workers must use requestDurableTaskCancellation and
acknowledgeDurableTaskCancellation instead.

Signature:

```ts
export declare function cancelDurableTask(store: SQLiteTraceStore, options: DurableTaskDirectCancellationOptions): DurableTaskExecutionResult;
```

Parameter:

- store - Open trace store containing the inactive durable execution.

Parameter:

- options - Exact command, run, inactive lifecycle head, and reason contract.

Returns:

- Immutable cancelled execution and durable terminal receipt.

Throws:

- {TypeError} If options are malformed.

Throws:

- {TraceStoreError} If lifecycle authority is active, stale, or inconsistent.

Throws:

- {AppendIntentConflictError} If command identity already names different content.

Example:

- ```ts
const cancelled = cancelDurableTask(store, {
    commandId: "command:cancel:created:42",
    expectedLifecycleRecordId: createdRecordId,
    reason: "operator request",
    runId: "run:42",
});
cancelled.execution.outcome.outcome.status;
```

### `captureRunContinuationCheckpoints`

Classification: `runtime-only`. Kind: `function`.

Collects exact continuation evidence from every configured checkpoint adapter.

Collection performs no trace-store mutation. Callers invoke it only after the worker has reached
a safe boundary with no provider, effect, or world mutation in flight. The returned evidence can
be retried through acknowledgeDurableTaskSuspension without rerunning adapters.

Signature:

```ts
export declare function captureRunContinuationCheckpoints(options: RunContinuationCheckpointOptions): Promise<readonly RunContinuationCheckpointEvidence[]>;
```

Parameter:

- options - Exact run boundary and ordered configured adapters.

Returns:

- Frozen ordered checkpoint evidence.

Throws:

- {TypeError} If options, adapters, or returned evidence are malformed or reordered.

### `createRunArtifact`

Classification: `runtime-only`. Kind: `function`.

Creates one immutable ordered side-channel artifact record for a run.

Text may be retained inline. Binary content must already have a durable blob receipt, ensuring
the semantic artifact record cites bytes instead of embedding a mutable `Uint8Array`.

Signature:

```ts
export declare function createRunArtifact<C extends RunArtifactContentDefinition>(definition: RunArtifactDefinition<C>): RunArtifact<C>;
```

Parameter:

- definition - Run identity, emission ordinal, artifact identity, content, and metadata.

Returns:

- A deeply frozen canonical run-artifact record.

Throws:

- {TypeError} If the definition, content, metadata, ordinal, or blob receipt is malformed.

Example:

- ```ts
const artifact = createRunArtifact({
    runId: "run:example",
    artifactOrdinal: 0,
    kind: "report",
    name: "summary.txt",
    content: { type: "text", text: "Summary" },
    metadata: { media_type: "text/plain" },
});
```

### `createRunControl`

Classification: `runtime-only`. Kind: `function`.

Creates cooperative resource and cancellation control for one run.

Signature:

```ts
export declare function createRunControl(options: RunControlOptions): RunControl;
```

Parameter:

- options - Per-run limits and an optional caller cancellation signal.

Returns:

- A run control whose signal is passed through async execution boundaries.

Throws:

- {TypeError} If options, budget limits, or the caller signal are malformed.

Example:

- ```ts
const control = createRunControl({ budget: { maxTurns: 20 } });
control.consume({ turns: 1 });
await provider.invoke(request, control.signal);
control.dispose();
```

### `createRunLifecycleTransition`

Classification: `runtime-only`. Kind: `function`.

Validates one transition against the configured normative lifecycle matrix.

This pure builder validates topology and terminal-outcome legality only. Durable command,
checkpoint, receipt, expected-head, and fencing evidence remain obligations of the runtime
transition that cites this value.

Signature:

```ts
export declare function createRunLifecycleTransition(definition: RunLifecycleTransitionDefinition): RunLifecycleTransition;
```

Parameter:

- definition - Closed source, target, and optional terminal-outcome definition.

Returns:

- A frozen validated lifecycle transition.

Throws:

- {TypeError} If the definition is malformed or the transition is not configured.

Example:

- ```ts
const transition = createRunLifecycleTransition({
    source_status: "running",
    target_status: "waiting",
});
```

### `createRunOutcome`

Classification: `runtime-only`. Kind: `function`.

Creates an immutable versioned record for exactly one terminal task-run result.

Signature:

```ts
export declare function createRunOutcome<O extends RunTerminalDefinition>(definition: RunOutcomeDefinition<O>): RunOutcomeFor<O>;
```

Parameter:

- definition - Run identity, exact task lock, and one terminal outcome definition.

Returns:

- A deeply frozen canonical record preserving the exact terminal discriminant.

Throws:

- {TypeError} If the definition, task lock, or terminal payload is malformed.

Example:

- ```ts
const outcome = createRunOutcome({
    runId: "run:example",
    taskArtifactLock: taskDescriptor.artifactLock,
    outcome: { status: "finished", value: { answer: 42 } },
});
```

### `createRunUsage`

Classification: `runtime-only`. Kind: `function`.

Creates one immutable aggregate resource-usage record for a run.

Counts are totals for the complete run, not an individual provider call. An omitted cost is
normalized to `null` so the wire record remains closed and deterministic.

Signature:

```ts
export declare function createRunUsage(definition: RunUsageDefinition): RunUsage;
```

Parameter:

- definition - Run identity and aggregate token and cost totals.

Returns:

- A deeply frozen canonical aggregate run-usage record.

Throws:

- {TypeError} If a field is missing, unexpected, malformed, or negative.

Example:

- ```ts
const usage = createRunUsage({
    runId: "run:example",
    inputTokens: 120,
    outputTokens: 30,
    cacheCreationInputTokens: 10,
    cacheReadInputTokens: 80,
});
```

### `executeTask`

Classification: `runtime-only`. Kind: `function`.

Executes one validated bodyless task through a provider-neutral structured boundary.

Signature:

```ts
export declare function executeTask<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>>(options: TaskExecutionOptions<I, O>): Promise<TaskExecutionResult>;
```

Parameter:

- options - Exact task, inferred input, provider, run identity, budget, and cancellation.

Returns:

- Ordered artifacts, terminal outcome, aggregate usage, provider identity, and control.

Throws:

- {TypeError} If caller-owned task input or execution control options are malformed.

Example:

- ```ts
const execution = await executeTask({
    task: greet,
    input: { name: "Ada" },
    provider,
    runId: "run:greet:1",
    budget: { maxTurns: 1 },
});
```

### `executeTaskDurably`

Classification: `runtime-only`. Kind: `function`.

Executes one task while retaining its lifecycle, artifacts, usage, and exact terminal outcome.

Caller-owned options are fully validated before the creation record is appended. Creation and
start are retained at their actual execution boundaries. Ordered artifacts, usage, outcome, and
terminal lifecycle evidence commit atomically, after which an immutable terminal cut is
published. Blob artifacts must cite bytes available in the same store. Sequential retries
reconstruct committed results without provider invocation. Existing incomplete executions must
be advanced through an explicit durable recovery command. A retained start without terminal
evidence fails closed because repeating provider invocation may be unsafe. A durable
first-writer claim prevents concurrent callers from crossing one provider boundary.

Signature:

```ts
export declare function executeTaskDurably<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>>(store: SQLiteTraceStore, options: TaskExecutionOptions<I, O>): Promise<DurableTaskExecutionResult>;
```

Parameter:

- store - Open SQLite trace store receiving execution evidence.

Parameter:

- options - Exact task execution options accepted by {@link executeTask}.

Returns:

- The immutable execution result and its durable record identities and cut.

Throws:

- {TypeError} If execution options or task input are malformed.

Throws:

- {DurableExecutionRecoveryError} If retained start evidence has no terminal result.

Throws:

- {TraceStoreError} If durable append or cut publication fails.

Example:

- ```ts
const durable = await executeTaskDurably(store, {
    task: greet,
    input: { name: "Ada" },
    provider,
    runId: "run:greet:1",
    budget: { maxTurns: 1 },
});
const projected = store.projectExecution(durable.ledger.cut.cut_id);
```

### `inspectDurableTaskExecution`

Classification: `runtime-only`. Kind: `function`.

Projects validated durable task-execution evidence into an immutable inspection view.

The view is rebuilt from canonical retained records on every call. It stores no materialized
state, never invokes a provider, and uses the same fail-closed validation as durable recovery.
Later owner records outside the terminal evidence chain do not change a committed view.

Signature:

```ts
export declare function inspectDurableTaskExecution(store: SQLiteTraceStore, runId: string): DurableTaskExecutionInspection;
```

Parameter:

- store - Open trace store containing durable task-execution evidence.

Parameter:

- runId - Stable durable run owner to inspect.

Returns:

- Lifecycle, quiescent continuation, artifact, usage, outcome, cut, and causal evidence.

Throws:

- {TypeError} If the run identity is malformed.

Throws:

- {TraceStoreError} If retained evidence is missing, malformed, or inconsistent.

Example:

- ```ts
const inspection = inspectDurableTaskExecution(store, "run:greet:1");
if (inspection.status === "committed") {
    inspection.artifacts;
    inspection.causal_edges;
}
```

### `readDurableTaskExecution`

Classification: `runtime-only`. Kind: `function`.

Reads and classifies retained evidence for one durable task execution.

Signature:

```ts
export declare function readDurableTaskExecution(store: SQLiteTraceStore, runId: string): DurableTaskExecutionRecovery;
```

Parameter:

- store - Open trace store containing execution evidence.

Parameter:

- runId - Stable run owner to inspect.

Returns:

- A frozen absent, incomplete, terminal-pending-cut, or committed recovery value.

Throws:

- {TypeError} If the run identity is malformed.

Throws:

- {TraceStoreError} If retained execution evidence is malformed or inconsistent.

### `recoverTaskDurably`

Classification: `runtime-only`. Kind: `function`.

Applies one globally idempotent recovery command to existing durable task evidence.

Recovery resumes only creation evidence that has not crossed the provider boundary, repairs a
missing terminal cut without provider invocation, and replays committed results. A retained
start without terminal evidence remains fail-closed. The command is retained canonically and
causally cited by any recovered start or cut publication.

Signature:

```ts
export declare function recoverTaskDurably<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>>(store: SQLiteTraceStore, options: DurableTaskRecoveryOptions<I, O>): Promise<DurableTaskRecoveryResult>;
```

Parameter:

- store - Open trace store containing the durable execution.

Parameter:

- options - Stable command identity and exact execution contract to recover.

Returns:

- Canonical command evidence and the recovered durable result.

Throws:

- {TypeError} If the command or execution options are malformed.

Throws:

- {DurableExecutionRecoveryAbsentError} If no creation evidence exists for the run.

Throws:

- {DurableExecutionRecoveryError} If provider invocation may already have occurred.

Throws:

- {TraceStoreError} If command identity conflicts or retained evidence is inconsistent.

Example:

- ```ts
const recovered = await recoverTaskDurably(store, {
    commandId: "command:recover:greet:1",
    execution: { task: greet, input: { name: "Ada" }, provider, runId: "run:greet:1" },
});
recovered.command.record_id;
```

### `requestDurableTaskCancellation`

Classification: `runtime-only`. Kind: `function`.

Retains one globally idempotent cancellation request against the exact running fence.

The command requests cooperative cancellation only. It leaves lifecycle and worker authority
unchanged until the exact worker acknowledges a safe boundary.

Signature:

```ts
export declare function requestDurableTaskCancellation(store: SQLiteTraceStore, options: DurableTaskCancellationOptions): DurableTaskCancellationCommandReceipt;
```

Parameter:

- store - Open trace store containing the running durable execution.

Parameter:

- options - Exact command, run, lifecycle-head, fencing-token, and reason contract.

Returns:

- Canonical retained cancellation-command evidence.

Throws:

- {TypeError} If options are malformed.

Throws:

- {TraceStoreError} If running authority is no longer current.

Throws:

- {AppendIntentConflictError} If command identity already names different content.

Example:

- ```ts
const command = requestDurableTaskCancellation(store, {
    commandId: "command:cancel:42",
    expectedLifecycleRecordId: startedRecordId,
    fencingToken,
    reason: "operator request",
    runId: "run:42",
});
command.record_id;
```

### `requestDurableTaskPause`

Classification: `runtime-only`. Kind: `function`.

Retains one globally idempotent pause request against the exact current running fence.

This function records command authority only. It does not interrupt the provider, release the
invocation lease, append a suspension acknowledgement, or change lifecycle projection. Exact
replay returns the retained command even if the run later advances; reuse of the command
identity for different content conflicts.

Signature:

```ts
export declare function requestDurableTaskPause(store: SQLiteTraceStore, options: DurableTaskPauseOptions): DurableTaskPauseCommandReceipt;
```

Parameter:

- store - Open trace store containing the running durable execution.

Parameter:

- options - Exact command, run, lifecycle-head, fencing-token, and reason contract.

Returns:

- Canonical retained pause-command evidence.

Throws:

- {TypeError} If the options, identifiers, token, or reason are malformed.

Throws:

- {TraceStoreError} If the expected running head or fencing token is no longer current.

Throws:

- {AppendIntentConflictError} If command identity already names different content.

Example:

- ```ts
const command = requestDurableTaskPause(store, {
    commandId: "command:pause:greet:1",
    expectedLifecycleRecordId: startedRecordId,
    fencingToken: currentFencingToken,
    reason: "operator maintenance",
    runId: "run:greet:1",
});
command.record_id;
```

### `resumeDurableTask`

Classification: `runtime-only`. Kind: `function`.

Atomically resumes one exact suspended or satisfied waiting run under an idempotent command.

Resume verifies the quiescent acknowledgement and its continuation descriptor, requires exact
prerequisite-satisfaction evidence for waiting, rejects satisfaction evidence for suspension,
acquires the next monotonic worker fence, and publishes a distinct command-bound
running-continuation acknowledgement. It does not itself restore provider, process, or world
state; the caller uses the returned authority only after its adapters restore verified receipts.

Signature:

```ts
export declare function resumeDurableTask(store: SQLiteTraceStore, options: DurableTaskResumeOptions): DurableTaskResumeReceipt;
```

Parameter:

- store - Open trace store containing the waiting or suspended run.

Parameter:

- options - Exact command, quiescent head, descriptor, satisfaction, and run contract.

Returns:

- Canonical resume evidence and newly fenced worker authority.

Throws:

- {TypeError} If options or identifiers are malformed.

Throws:

- {TraceStoreError} If lifecycle, claim, or continuation evidence is inconsistent.

Throws:

- {AppendIntentConflictError} If command identity already names different content.

Example:

- ```ts
const authority = resumeDurableTask(store, {
    commandId: "command:resume:42",
    continuationDescriptorRecordId: suspension.continuation_descriptor_record_id,
    expectedLifecycleRecordId: suspension.acknowledgement_record_id,
    runId: "run:42",
});
authority.fencing_token;
```

## Tasks

Package entry: `./tasks`

Task descriptors, schemas, registry operations, and bounded ledger reads.

Runtime: ESM on Node >=24.12.0 <25, except the type-only /read entry (no Node runtime required).

Authority and mutation: Descriptor and schema helpers are pure. SQLiteTaskRegistry reads or mutates only the caller-selected registry database and must be closed by the caller.

Import example:

```ts
import * as api from "@avnionur/shepherd-typescript/tasks";
void api;
```

Exported symbols: 25.

### `ExactTaskReference`

Classification: `type-only`. Kind: `type alias`.

Exact selector for one registered task artifact version.

Signature:

```ts
export type ExactTaskReference = {
    readonly taskId: string;
    readonly version: string;
};
```

### `InferTaskSchema`

Classification: `type-only`. Kind: `type alias`.

Infers the validated value type represented by a task schema.

Signature:

```ts
export type InferTaskSchema<S extends TaskSchema<unknown>> = S extends TaskSchema<infer T> ? T : never;
```

### `InferTaskSchemaShape`

Classification: `type-only`. Kind: `type alias`.

Value inferred from a task object-schema shape.

Signature:

```ts
export type InferTaskSchemaShape<S extends TaskSchemaShape> = {
    readonly [K in keyof S]: InferTaskSchema<S[K]>;
};
```

### `LedgerListOptions`

Classification: `type-only`. Kind: `type alias`.

Closed bounded pagination options for task/run ledger lists.

Signature:

```ts
export type LedgerListOptions = {
    readonly limit?: number;
    readonly offset?: number;
};
```

### `LedgerSelectorAmbiguousError`

Classification: `runtime-and-type`. Kind: `class`.

Raised when one read selector matches more than one ledger entry.

Signature:

```ts
export declare class LedgerSelectorAmbiguousError extends Error {
    readonly code: string;
    constructor(message: string, code?: string);
}
```

#### `code`

Stable machine-readable selector ambiguity code.

```ts
readonly code: string;
```

#### `constructor`



```ts
constructor(message: string, code?: string);
```

Parameter:

- message - Technical selector ambiguity description.

Parameter:

- code - Stable machine-readable ambiguity code.

### `LedgerSelectorNotFoundError`

Classification: `runtime-and-type`. Kind: `class`.

Raised when one valid read selector matches no ledger entry.

Signature:

```ts
export declare class LedgerSelectorNotFoundError extends Error {
    readonly code: string;
    constructor(message: string, code?: string);
}
```

#### `code`

Stable machine-readable missing-selector code.

```ts
readonly code: string;
```

#### `constructor`



```ts
constructor(message: string, code?: string);
```

Parameter:

- message - Technical missing-selector description.

Parameter:

- code - Stable machine-readable missing-selector code.

### `SQLiteTaskRegistry`

Classification: `runtime-and-type`. Kind: `class`.

Synchronous SQLite-backed registry for exact immutable task artifact versions.

Signature:

```ts
export declare class SQLiteTaskRegistry implements Disposable {
    constructor(databasePath?: string, options?: SQLiteTaskRegistryOptions);
    get schemaVersion(): number;
    register(descriptor: TaskDescriptor<TaskSchema<unknown>, TaskSchema<unknown>>): TaskRegistration;
    resolve(reference: ExactTaskReference): TaskRegistration | undefined;
    close(): void;
    [Symbol.dispose](): void;
}
```

#### `constructor`

Opens or creates a durable task registry.

```ts
constructor(databasePath?: string, options?: SQLiteTaskRegistryOptions);
```

Parameter:

- databasePath - SQLite file path, or the configured in-memory default.

Parameter:

- options - Optional exact read-only open policy.

Throws:

- {UnsupportedTaskRegistrySchemaError} If the schema is not current and supported.

Throws:

- {TypeError} If options are malformed or contain unsupported fields.

Throws:

- {Error} If required SQLite defensive behavior is unavailable, or opening/migration fails.

#### `schemaVersion`

Current migrated task-registry schema version.

```ts
get schemaVersion(): number;
```

#### `register`

Durably registers one exact task descriptor version.

Equal re-registration is idempotent and returns the retained registration.

```ts
register(descriptor: TaskDescriptor<TaskSchema<unknown>, TaskSchema<unknown>>): TaskRegistration;
```

Parameter:

- descriptor - Immutable task descriptor produced by `task()`.

Returns:

- The verified canonical artifact and exact artifact lock.

Throws:

- {TaskVersionConflictError} If the task ID/version names different content.

Throws:

- {TaskRegistryError} If the registry is closed or retained data is corrupt.

Throws:

- {TypeError} If the descriptor or artifact lock is malformed.

Throws:

- {Error} If SQLite cannot read or commit the registration.

#### `resolve`

Resolves one exact task ID and version without aliases or fallback selection.

```ts
resolve(reference: ExactTaskReference): TaskRegistration | undefined;
```

Parameter:

- reference - Exact stable task identity and caller-declared version.

Returns:

- The verified registration, or `undefined` when it is absent.

Throws:

- {TaskRegistryError} If the registry is closed or retained data is corrupt.

Throws:

- {TypeError} If the exact reference is malformed.

Throws:

- {Error} If SQLite cannot read the registration.

#### `close`

Closes the SQLite connection. Repeated calls are harmless.

```ts
close(): void;
```

#### `[Symbol.dispose]`

Closes the registry when used with explicit resource management.

```ts
[Symbol.dispose](): void;
```

### `SQLiteTaskRegistryOptions`

Classification: `type-only`. Kind: `type alias`.

Options controlling task-registry open behavior.

Signature:

```ts
export type SQLiteTaskRegistryOptions = {
    readonly readOnly?: boolean;
};
```

### `TaskArtifact`

Classification: `type-only`. Kind: `type alias`.

Canonical bodyless task contract included in task artifact identity.

Signature:

```ts
export type TaskArtifact = {
    readonly compatibility_version: string;
    readonly descriptor_version: number;
    readonly input_schema: SemanticRecord;
    readonly instruction: string;
    readonly name: string;
    readonly output_schema: SemanticRecord;
    readonly task_version: string;
};
```

### `TaskArtifactLock`

Classification: `type-only`. Kind: `type alias`.

Exact content-addressed lock for one immutable task artifact revision.

Signature:

```ts
export type TaskArtifactLock = {
    readonly artifact_digest: string;
    readonly artifact_lock_version: number;
    readonly compatibility_version: string;
    readonly descriptor_version: number;
    readonly schema_digest: string;
    readonly task_id: string;
    readonly task_version: string;
};
```

### `TaskDefinition`

Classification: `type-only`. Kind: `type alias`.

Definition accepted by the bodyless task descriptor builder.

Signature:

```ts
export type TaskDefinition<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>> = {
    readonly input: I;
    readonly instruction: string;
    readonly name: string;
    readonly output: O;
    readonly version: string;
};
```

### `TaskDescriptor`

Classification: `type-only`. Kind: `type alias`.

Immutable bodyless task descriptor with inferred runtime validation methods.

Signature:

```ts
export type TaskDescriptor<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>> = {
    readonly artifact: TaskArtifact;
    readonly artifactLock: TaskArtifactLock;
    readonly inputSchema: I;
    readonly instruction: string;
    readonly name: string;
    readonly outputSchema: O;
    readonly parseInput: (value: unknown) => InferTaskSchema<I>;
    readonly parseOutput: (value: unknown) => InferTaskSchema<O>;
    readonly version: string;
};
```

### `TaskLedgerEntry`

Classification: `type-only`. Kind: `type alias`.

Immutable registered-task ledger projection.

Signature:

```ts
export type TaskLedgerEntry = {
    readonly artifact: TaskArtifact;
    readonly artifact_lock: TaskArtifactLock;
    readonly compatibility_version: string;
    readonly ledger_version: number;
    readonly repository_grant: TaskLedgerRepositoryGrantEvidence | null;
};
```

### `TaskLedgerRepositoryGrantEvidence`

Classification: `type-only`. Kind: `type alias`.

Immutable repository-grant companion evidence for one task artifact.

Signature:

```ts
export type TaskLedgerRepositoryGrantEvidence = {
    readonly artifact: RepositoryTaskGrantArtifact;
    readonly artifact_lock: RepositoryTaskGrantArtifactLock;
};
```

### `TaskRegistration`

Classification: `type-only`. Kind: `type alias`.

Durable registry result containing a canonical artifact and its verified lock.

Signature:

```ts
export type TaskRegistration = {
    readonly artifact: TaskArtifact;
    readonly artifactLock: TaskArtifactLock;
};
```

### `TaskRegistryError`

Classification: `runtime-and-type`. Kind: `class`.

Base error for durable task-registry contract violations.

Signature:

```ts
export declare class TaskRegistryError extends Error {
    readonly code: string;
}
```

#### `code`

Stable configured machine-readable task-registry error code.

```ts
readonly code: string;
```

### `TaskSchema`

Classification: `type-only`. Kind: `type alias`.

Runtime schema carrying a JSON Schema document and an inferred output type.

Signature:

```ts
export type TaskSchema<T> = {
    readonly parse: (value: unknown) => T;
    readonly toJSONSchema: () => SemanticRecord;
};
```

### `TaskSchemaFactory`

Classification: `type-only`. Kind: `type alias`.

Public factory surface for the supported task schema primitives.

Signature:

```ts
export type TaskSchemaFactory = {
    readonly fromJSONSchema: (document: unknown) => TaskSchema<unknown>;
    readonly object: <S extends TaskSchemaShape>(shape: S) => TaskSchema<InferTaskSchemaShape<S>>;
    readonly string: () => TaskSchema<string>;
    readonly void: () => TaskSchema<void>;
};
```

### `TaskSchemaShape`

Classification: `type-only`. Kind: `type alias`.

Shape accepted by `schema.object()`.

Signature:

```ts
export type TaskSchemaShape = Readonly<Record<string, TaskSchema<unknown>>>;
```

### `TaskVersionConflictError`

Classification: `runtime-and-type`. Kind: `class`.

Raised when one logical task ID/version is registered with different content.

Signature:

```ts
export declare class TaskVersionConflictError extends TaskRegistryError {
    readonly code: string;
}
```

#### `code`

Stable configured machine-readable task-version conflict code.

```ts
readonly code: string;
```

### `UnsupportedTaskRegistrySchemaError`

Classification: `runtime-and-type`. Kind: `class`.

Raised when a task-registry database is newer than this package supports.

Signature:

```ts
export declare class UnsupportedTaskRegistrySchemaError extends TaskRegistryError {
    readonly code: string;
}
```

#### `code`

Stable configured machine-readable unsupported-schema code.

```ts
readonly code: string;
```

### `listTaskLedger`

Classification: `runtime-only`. Kind: `function`.

Lists a bounded page of verified task registrations in canonical identity/version byte order.

Signature:

```ts
export declare function listTaskLedger(registry: SQLiteTaskRegistry, options?: LedgerListOptions, repositoryGrants?: readonly RepositoryGrantedTask<TaskSchema<unknown>, TaskSchema<unknown>>[]): readonly TaskLedgerEntry[];
```

Parameter:

- registry - Open durable task registry.

Parameter:

- options - Optional closed configured pagination object.

Parameter:

- repositoryGrants - Optional authenticated companion grant evidence.

Returns:

- Frozen immutable task ledger entries.

Throws:

- {TaskRegistryError} If the registry is closed or retained data is corrupt.

Throws:

- {TypeError} If options, grants, retained entries, or canonical size are invalid.

Example:

- ```ts
const page = listTaskLedger(registry, { limit: 25, offset: 0 });
```

### `resolveTaskLedgerSelector`

Classification: `runtime-only`. Kind: `function`.

Resolves an exact task/version, unique task-ID prefix, or canonical latest read selector.

Signature:

```ts
export declare function resolveTaskLedgerSelector(registry: SQLiteTaskRegistry, selector: string, repositoryGrants?: readonly RepositoryGrantedTask<TaskSchema<unknown>, TaskSchema<unknown>>[]): TaskLedgerEntry;
```

Parameter:

- registry - Open durable task registry.

Parameter:

- selector - Exact `task-id@version`, task-ID/prefix, or `@latest`.

Parameter:

- repositoryGrants - Optional authenticated companion grant evidence.

Returns:

- Exact verified immutable task ledger entry.

Throws:

- {LedgerSelectorAmbiguousError} If a task-ID/prefix matches multiple versions/entries.

Throws:

- {LedgerSelectorNotFoundError} If no registration matches.

Throws:

- {TaskRegistryError} If the registry is closed or retained data is corrupt.

Throws:

- {TypeError} If the selector, grants, retained entry, or canonical size is invalid.

Example:

- ```ts
const entry = resolveTaskLedgerSelector(registry, `${taskId}@${version}`);
```

### `schema`

Classification: `runtime-only`. Kind: `variable`.

Task input/output schema builders with static type inference and runtime validation.

Signature:

```ts
export declare const schema: TaskSchemaFactory;
```

### `task`

Classification: `runtime-only`. Kind: `function`.

Creates an immutable, content-addressed bodyless task descriptor.

Signature:

```ts
export declare function task<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>>(definition: TaskDefinition<I, O>): TaskDescriptor<I, O>;
```

Parameter:

- definition - Closed task definition containing identity, instruction, and schemas.

Returns:

- A frozen descriptor with inferred validation methods and exact artifact lock.

Throws:

- {TypeError} If the definition or either schema is malformed.

Example:

- ```ts
const greet = task({
    name: "greet",
    version: "1.0.0",
    instruction: "Greet the supplied person.",
    input: schema.object({ name: schema.string() }),
    output: schema.void(),
});
```

## Trace

Package entry: `./trace`

Trace persistence, interchange, integrity, cuts, slices, and bounded evidence queries.

Runtime: ESM on Node >=24.12.0 <25, except the type-only /read entry (no Node runtime required).

Authority and mutation: SQLiteTraceStore is explicitly read/write capable for caller-selected storage. Projection helpers remain bounded reads and no workspace authority is created.

Import example:

```ts
import * as api from "@avnionur/shepherd-typescript/trace";
void api;
```

Exported symbols: 59.

### `AppendIntentConflictError`

Classification: `runtime-and-type`. Kind: `class`.

Raised when an append intent is replayed with different semantic content.

Signature:

```ts
export declare class AppendIntentConflictError extends TraceStoreError {
    readonly code: string;
}
```

#### `code`

Stable configured machine-readable append-conflict code.

```ts
readonly code: string;
```

### `AppendIntentId`

Classification: `type-only`. Kind: `type alias`.

Stable identifier for one idempotent append attempt.

Signature:

```ts
export type AppendIntentId = string;
```

### `AppendReceipt`

Classification: `type-only`. Kind: `type alias`.

Durable result returned for a committed or identically replayed append.

Signature:

```ts
export type AppendReceipt = {
    readonly append_intent_id: AppendIntentId;
    readonly causal_edges: readonly (readonly [
        RecordId,
        RecordId
    ])[];
    readonly owner_ordinal_ranges: ReadonlyMap<TraceOwnerId, readonly [
        OwnerOrdinal,
        OwnerOrdinal
    ]>;
    readonly record_ids: readonly RecordId[];
};
```

### `AppendRecoveryDiagnostic`

Classification: `type-only`. Kind: `type alias`.

Read-only diagnosis describing how an append intent may be handled.

Signature:

```ts
export type AppendRecoveryDiagnostic = {
    readonly append_intent_id: AppendIntentId;
    readonly issue: AppendRecoveryIssue | null;
    readonly status: AppendRecoveryStatus;
};
```

### `AppendRecoveryIssue`

Classification: `type-only`. Kind: `type alias`.

Stable defect classification for append recovery.

Signature:

```ts
export type AppendRecoveryIssue = "orphaned_rows" | "receipt_mismatch";
```

### `AppendRecoveryStatus`

Classification: `type-only`. Kind: `type alias`.

Stable recovery classification for one append intent.

Signature:

```ts
export type AppendRecoveryStatus = "committed" | "manual_recovery_required" | "retry_safe";
```

### `BlobId`

Classification: `type-only`. Kind: `type alias`.

Content-addressed identity of one retained binary value.

Signature:

```ts
export type BlobId = string;
```

### `BlobIntegrityError`

Classification: `runtime-and-type`. Kind: `class`.

Raised when durable blob bytes disagree with their storage receipt.

Signature:

```ts
export declare class BlobIntegrityError extends TraceStoreError {
    readonly code: string;
}
```

#### `code`

Stable configured machine-readable blob-integrity code.

```ts
readonly code: string;
```

### `BlobIntegrityIssue`

Classification: `type-only`. Kind: `type alias`.

Classified integrity failure for one durable blob receipt.

Signature:

```ts
export type BlobIntegrityIssue = {
    readonly blob_id: BlobId;
    readonly kind: "digest_mismatch" | "missing" | "not_regular_file" | "receipt_mismatch" | "size_mismatch";
};
```

### `BlobIntegrityReport`

Classification: `type-only`. Kind: `type alias`.

Complete integrity scan result for durable blob receipts.

Signature:

```ts
export type BlobIntegrityReport = {
    readonly checked_blob_count: number;
    readonly issues: readonly BlobIntegrityIssue[];
    readonly ok: boolean;
};
```

### `BlobOrphanCollectionMode`

Classification: `type-only`. Kind: `type alias`.

Operation applied to discovered unregistered blob-store objects.

Signature:

```ts
export type BlobOrphanCollectionMode = "delete" | "inspect";
```

### `BlobOrphanCollectionOptions`

Classification: `type-only`. Kind: `type alias`.

Options controlling safe blob-orphan inspection or deletion.

Signature:

```ts
export type BlobOrphanCollectionOptions = {
    readonly mode?: BlobOrphanCollectionMode;
};
```

### `BlobOrphanCollectionReport`

Classification: `type-only`. Kind: `type alias`.

Frozen result of one lock-protected blob-orphan collection pass.

Signature:

```ts
export type BlobOrphanCollectionReport = {
    readonly deleted_blob_ids: readonly BlobId[];
    readonly deleted_temporary_file_count: number;
    readonly mode: BlobOrphanCollectionMode;
    readonly orphan_blob_ids: readonly BlobId[];
    readonly orphan_temporary_file_count: number;
};
```

### `BlobStorageReceipt`

Classification: `type-only`. Kind: `type alias`.

Durable result returned after blob bytes and metadata are retained.

Signature:

```ts
export type BlobStorageReceipt = {
    readonly blob_id: BlobId;
    readonly byte_length: number;
};
```

### `CausalClosureOptions`

Classification: `type-only`. Kind: `type alias`.

Options for a causal-closure read.

Signature:

```ts
export type CausalClosureOptions = SliceReadOptions & {
    readonly closure_policy?: ClosurePolicy;
};
```

### `ClosurePolicy`

Classification: `type-only`. Kind: `type alias`.

Whether omitted causal parents are represented as anchors.

Signature:

```ts
export type ClosurePolicy = "include_external_anchors" | "visible_only";
```

### `Cut`

Classification: `type-only`. Kind: `type alias`.

Durable immutable address of an owner-path prefix.

Signature:

```ts
export type Cut = {
    readonly created_by_record_id: RecordId;
    readonly cut_id: CutId;
    readonly publisher_owner_id: TraceOwnerId;
    readonly target_owner_id: TraceOwnerId;
    readonly through_owner_ordinal: OwnerOrdinal;
    readonly through_record_id: RecordId;
};
```

### `CutId`

Classification: `type-only`. Kind: `type alias`.

Stable identifier for one published immutable trace cut.

Signature:

```ts
export type CutId = string;
```

### `CutSpec`

Classification: `type-only`. Kind: `type alias`.

Input used to publish an immutable owner-prefix cut.

Signature:

```ts
export type CutSpec = {
    readonly append_intent_id?: AppendIntentId;
    readonly caused_by_record_ids?: readonly RecordId[];
    readonly cut_id: CutId;
    readonly publisher_owner_id?: TraceOwnerId;
    readonly target_owner_id: TraceOwnerId;
    readonly through_record_id: RecordId;
    readonly witness_ref?: RecordId;
};
```

### `ExternalAnchor`

Classification: `type-only`. Kind: `type alias`.

Visible placeholder for a direct causal parent omitted from a slice.

Signature:

```ts
export type ExternalAnchor = {
    readonly hidden_reason: "outside_slice";
    readonly ref: RecordId;
};
```

### `LedgerListOptions`

Classification: `type-only`. Kind: `type alias`.

Closed bounded pagination options for task/run ledger lists.

Signature:

```ts
export type LedgerListOptions = {
    readonly limit?: number;
    readonly offset?: number;
};
```

### `LedgerSelectorAmbiguousError`

Classification: `runtime-and-type`. Kind: `class`.

Raised when one read selector matches more than one ledger entry.

Signature:

```ts
export declare class LedgerSelectorAmbiguousError extends Error {
    readonly code: string;
    constructor(message: string, code?: string);
}
```

#### `code`

Stable machine-readable selector ambiguity code.

```ts
readonly code: string;
```

#### `constructor`



```ts
constructor(message: string, code?: string);
```

Parameter:

- message - Technical selector ambiguity description.

Parameter:

- code - Stable machine-readable ambiguity code.

### `LedgerSelectorNotFoundError`

Classification: `runtime-and-type`. Kind: `class`.

Raised when one valid read selector matches no ledger entry.

Signature:

```ts
export declare class LedgerSelectorNotFoundError extends Error {
    readonly code: string;
    constructor(message: string, code?: string);
}
```

#### `code`

Stable machine-readable missing-selector code.

```ts
readonly code: string;
```

#### `constructor`



```ts
constructor(message: string, code?: string);
```

Parameter:

- message - Technical missing-selector description.

Parameter:

- code - Stable machine-readable missing-selector code.

### `ModeFilter`

Classification: `type-only`. Kind: `type alias`.

Configured record-mode selection applied to traversal records.

Signature:

```ts
export type ModeFilter = "both" | "captures_only" | "declarations_only";
```

### `OutputCitationEntry`

Classification: `type-only`. Kind: `type alias`.

Immutable cut-bounded retained-world output citation projection.

Signature:

```ts
export type OutputCitationEntry = {
    readonly compatibility_version: string;
    readonly output: RetainedWorldOutput;
    readonly output_citation_version: number;
    readonly run_created_record_id: string;
    readonly run_id: string;
    readonly settlements: readonly DurableTaskExecutionSettlementInspection[];
    readonly task_artifact_lock: TaskArtifactLock;
    readonly world_capture: TaskWorldCaptureJournalInspection;
};
```

### `OwnerRecord`

Classification: `type-only`. Kind: `type alias`.

Read result for one owner-local record occurrence.

Signature:

```ts
export type OwnerRecord = PlannedRecord;
```

### `ProjectionCompatibilityError`

Classification: `runtime-and-type`. Kind: `class`.

Raised when a trace slice cannot satisfy a projection's declared requirements.

Signature:

```ts
export declare class ProjectionCompatibilityError extends TypeError {
    readonly code: string;
}
```

#### `code`

Stable configured machine-readable projection-compatibility code.

```ts
readonly code: string;
```

### `ROOT_WITNESS_ID`

Classification: `runtime-only`. Kind: `variable`.

Content-addressed identifier of the configured root witness.

Use this identifier as `witness_ref` until a more specific witness record is
available.

Signature:

```ts
export declare const ROOT_WITNESS_ID: string;
```

### `RecordShape`

Classification: `type-only`. Kind: `type alias`.

Visibility-filtered record shape without its semantic body.

Signature:

```ts
export type RecordShape = {
    readonly envelope: RecordEnvelope;
    readonly hidden_reason: "payload_hidden";
    readonly view?: RecordView;
};
```

### `RecoveryCommandEvidence`

Classification: `type-only`. Kind: `type alias`.

Validated canonical durable control command retained on one run owner.

Signature:

```ts
export type RecoveryCommandEvidence = {
    readonly command: DurableExecutionCancellationCommand | DurableExecutionInactiveCancellationCommand | DurableExecutionPauseCommand | DurableExecutionRecoveryCommand | DurableExecutionResumeCommand;
    readonly caused_by_record_ids: readonly string[];
    readonly record_id: string;
};
```

### `RecoveryCommandResult`

Classification: `type-only`. Kind: `type alias`.

Bounded retained records directly caused by one exact durable command.

Signature:

```ts
export type RecoveryCommandResult = {
    readonly command_record_id: string;
    readonly effect_record_ids: readonly string[];
};
```

### `RecoveryInvocationClaimEvidence`

Classification: `type-only`. Kind: `type alias`.

Archive-stable canonical claim/fence evidence, or an explicit unavailable classification.

Signature:

```ts
export type RecoveryInvocationClaimEvidence = {
    readonly claim_id: string;
    readonly fencing_token: number;
    readonly record_id: string;
    readonly status: (typeof RUN_CONTINUATION_EVIDENCE_STATUSES)[0];
} | {
    readonly status: (typeof RUN_CONTINUATION_EVIDENCE_STATUSES)[2];
};
```

### `RecoveryRecordEntry`

Classification: `type-only`. Kind: `type alias`.

Immutable bounded durable recovery/control record projection for one run.

Signature:

```ts
export type RecoveryRecordEntry = {
    readonly command_results: readonly RecoveryCommandResult[];
    readonly commands: readonly RecoveryCommandEvidence[];
    readonly compatibility_version: string;
    readonly invocation_claim: RecoveryInvocationClaimEvidence;
    readonly lifecycle: DurableTaskExecutionInspection["lifecycle"];
    readonly lifecycle_head_record_id: string;
    readonly recovery_status: DurableTaskExecutionInspection["status"];
    readonly recovery_record_version: number;
    readonly run_id: string;
};
```

### `RetainedRecord`

Classification: `type-only`. Kind: `type alias`.

One semantic record and every retained owner-local occurrence.

Signature:

```ts
export type RetainedRecord = {
    readonly body: RecordBody;
    readonly envelope: RecordEnvelope;
    readonly views: readonly RecordView[];
};
```

### `RunLedgerEntry`

Classification: `type-only`. Kind: `type alias`.

Immutable task/run ledger projection for one durable execution owner.

Signature:

```ts
export type RunLedgerEntry = {
    readonly budget: RunBudgetDefinition;
    readonly created_record_id: string;
    readonly input: SemanticValue;
    readonly compatibility_version: string;
    readonly inspection: DurableTaskExecutionInspection;
    readonly provider: ProviderDescriptor;
    readonly ledger_version: number;
    readonly native_jail_processes: readonly RunLedgerNativeJailProcessEvidence[];
    readonly output: RetainedWorldOutput | null;
    readonly run_id: string;
    readonly task_artifact_lock: TaskArtifactLock;
    readonly world_capture: TaskWorldCaptureJournalInspection;
};
```

### `RunLedgerNativeJailProcessEvidence`

Classification: `type-only`. Kind: `type alias`.

One validated native-jail process intent, start, or receipt retained on a run owner.

Signature:

```ts
export type RunLedgerNativeJailProcessEvidence = {
    readonly body: SemanticRecord;
    readonly record_id: string;
};
```

### `SQLiteTraceStore`

Classification: `runtime-and-type`. Kind: `class`.

Synchronous SQLite-backed content-addressed trace store.

Writable construction enables configured durability, applies pending migrations, and ensures
the configured root witness. Read-only construction requires existing current-schema database,
blob-directory, and root-witness state without modifying them.

Signature:

```ts
export declare class SQLiteTraceStore implements Disposable {
    constructor(databasePath?: string, options?: SQLiteTraceStoreOptions);
    get schemaVersion(): number;
    append(request: StoreAppendRequest): AppendReceipt;
    recordOpenOperation(definition: OperationBookkeepingDefinition): OperationBookkeepingDefinition;
    recordOperationSessionDeath(evidence: OperationSessionDeathEvidence): number;
    completeOpenOperation(operationId: string, sessionId: string): boolean;
    diagnoseOrphanedOperations(options?: OrphanOperationDiagnosisOptions): OrphanOperationDiagnosisReport;
    prepareOrphanedOperationRepair(command: OrphanRepairCommand): OrphanRepairPreparation;
    repairOrphanedOperations(command: OrphanRepairCommand): OrphanRepairReceipt;
    reclaimOrphanedOperationsBeforeRun(commandId: string): OrphanPreRunReclaimResult;
    claimDurableExecutionInvocation(runId: string, createdRecordId: RecordId, claimId: string, nowMilliseconds?: number, allowExpiredTakeover?: boolean): DurableExecutionInvocationClaim;
    appendDurableExecutionStart(runId: string, claimId: string, fencingToken: number, nowMilliseconds?: number, recoveryCommandRecordId?: RecordId | null): DurableExecutionClaimedAppend;
    diagnoseAppend(appendIntentId: string): AppendRecoveryDiagnostic;
    verifyIntegrity(): TraceIntegrityReport;
    exportTrace(): string;
    importTrace(archiveJson: string): TraceImportReceipt;
    putBlob(content: Uint8Array): BlobStorageReceipt;
    readBlob(blobId: BlobId): Uint8Array | undefined;
    verifyBlobs(): BlobIntegrityReport;
    collectBlobOrphans(options?: BlobOrphanCollectionOptions): BlobOrphanCollectionReport;
    readRecord(recordId: RecordId): RetainedRecord | undefined;
    readOwner(ownerId: string): readonly OwnerRecord[];
    publishCut(spec: CutSpec): Cut;
    readCut(cutId: CutId): Cut;
    iterateCutRecords(cutId: CutId): AsyncGenerator<OwnerRecord, void, unknown>;
    readOwnerPrefix(ownerId: string, through: number, options?: SliceReadOptions): Slice;
    resolveCut(cutId: CutId, options?: SliceReadOptions): Slice;
    projectExecution(cutId: CutId): Execution;
    projectEffectiveHistory(cutId: CutId): EffectiveHistory;
    readCausalClosure(rootRecordIds: readonly RecordId[], options?: CausalClosureOptions): Slice;
    close(): void;
    [Symbol.dispose](): void;
}
```

#### `constructor`

Opens or creates a writable trace store, or opens exact current state read-only.

```ts
constructor(databasePath?: string, options?: SQLiteTraceStoreOptions);
```

Parameter:

- databasePath - SQLite file path, or `:memory:` for an ephemeral store.

Parameter:

- options - Optional external blob directory and read-only policy.

Throws:

- {UnsupportedStoreSchemaError} If read-only schema is absent/non-current or writable
schema is newer than supported.

Throws:

- {TraceStoreError} If required read-only blob or root-witness state is unavailable.

Throws:

- {TypeError} If options or the blob-directory shape are invalid.

Throws:

- {Error} If required SQLite defensive behavior is unavailable, or SQLite/blob setup fails.

#### `schemaVersion`

Current migrated storage-schema version.

```ts
get schemaVersion(): number;
```

#### `append`

Atomically commits or idempotently replays one semantic append request.

```ts
append(request: StoreAppendRequest): AppendReceipt;
```

Parameter:

- request - Stable append intent and semantic batch.

Returns:

- The original durable receipt for this intent and content.

Throws:

- {AppendIntentConflictError} If the intent already names different content.

Throws:

- {TraceStoreError} If witnesses are missing or the store is closed.

Throws:

- {TypeError} If the request is malformed.

Throws:

- {RangeError} If a causal parent is unknown or owner ordinals are exhausted.

#### `recordOpenOperation`

Retains or idempotently replays exact reversible-operation bookkeeping.

This method records bookkeeping only. It performs no provider, filesystem, Git, custody,
settlement, or scope operation.

```ts
recordOpenOperation(definition: OperationBookkeepingDefinition): OperationBookkeepingDefinition;
```

Parameter:

- definition - Closed versioned operation identity and safety evidence.

Returns:

- The frozen canonical definition retained by the store.

Throws:

- {OrphanRepairError} If the operation identity conflicts with retained evidence.

Throws:

- {TypeError} If the definition is malformed, unsupported, or exceeds bounds.

Throws:

- {TraceStoreError} If the store is closed.

#### `recordOperationSessionDeath`

Records externally proven death for one exact operation-owning session.

The external session authority must prove death before calling this narrow bookkeeping API.
The store never infers death from elapsed time or a missing provider response.

```ts
recordOperationSessionDeath(evidence: OperationSessionDeathEvidence): number;
```

Parameter:

- evidence - Exact session identity and external death-evidence identity.

Returns:

- Number of retained open operations owned by the session.

Throws:

- {OrphanRepairError} If death evidence conflicts with retained evidence.

Throws:

- {TypeError} If the evidence is malformed or exceeds bounds.

Throws:

- {TraceStoreError} If the store is closed.

#### `completeOpenOperation`

Removes bookkeeping for one normally completed operation owned by an exact session.

```ts
completeOpenOperation(operationId: string, sessionId: string): boolean;
```

Parameter:

- operationId - Exact open operation identity.

Parameter:

- sessionId - Exact owning session identity.

Returns:

- Whether matching bookkeeping was removed.

Throws:

- {TypeError} If either identity is malformed or exceeds bounds.

Throws:

- {TraceStoreError} If the store is closed.

#### `diagnoseOrphanedOperations`

Diagnoses retained open operations without mutation.

```ts
diagnoseOrphanedOperations(options?: OrphanOperationDiagnosisOptions): OrphanOperationDiagnosisReport;
```

Parameter:

- options - Optional configured page limit and canonical offset.

Returns:

- A frozen page plus an exact digest over the complete open-operation basis.

Throws:

- {OrphanRepairError} If retained bookkeeping is corrupt.

Throws:

- {TypeError} If options or retained evidence are malformed or out of bounds.

Throws:

- {TraceStoreError} If the store is closed.

#### `prepareOrphanedOperationRepair`

Durably prepares canonical repair-command evidence without mutating bookkeeping.

This explicit phase makes an interruption before repair diagnosable and retryable. Replaying
the same command is idempotent; reusing its identity for different content fails closed.

```ts
prepareOrphanedOperationRepair(command: OrphanRepairCommand): OrphanRepairPreparation;
```

Parameter:

- command - Globally idempotent exact orphan set and diagnosis basis.

Returns:

- Canonical command plus its retained trace-record identity.

Throws:

- {OrphanRepairError} If command identity conflicts or its version is unsupported.

Throws:

- {TypeError} If the command is malformed or exceeds bounds.

Throws:

- {TraceStoreError} If the store is closed.

#### `repairOrphanedOperations`

Explicitly repairs the complete exact set of proven-dead operation bookkeeping.

The complete basis is rechecked under the store write lock. Live, provider-started,
scope-owned, stale, changed, or malformed evidence fails closed. Success removes only exact
bookkeeping rows and atomically retains a canonical receipt; no provider, user-file, Git,
custody, settlement, lifecycle, outcome, cut, or scope state is changed.

```ts
repairOrphanedOperations(command: OrphanRepairCommand): OrphanRepairReceipt;
```

Parameter:

- command - Globally idempotent exact orphan set and diagnosis basis.

Returns:

- Canonical successful or empty no-op receipt and trace-record identities.

Throws:

- {OrphanRepairError} If repair is blocked, stale, conflicting, corrupt, or unsupported.

Throws:

- {TypeError} If the command is malformed or exceeds bounds.

Throws:

- {TraceStoreError} If the store is closed.

#### `reclaimOrphanedOperationsBeforeRun`

Attempts best-effort pre-run reclaim without ever blocking the caller's run start.

```ts
reclaimOrphanedOperationsBeforeRun(commandId: string): OrphanPreRunReclaimResult;
```

Parameter:

- commandId - Globally idempotent command identity for this reclaim attempt.

Returns:

- A repaired receipt or a declined result retaining exact manual diagnosis.

Throws:

- {TypeError} Only when command identity or diagnosis inputs are malformed before the
fail-soft repair boundary.

Throws:

- {TraceStoreError} If the store is closed.

#### `claimDurableExecutionInvocation`

Atomically acquires or observes the provider-invocation lease for a durable run.

```ts
claimDurableExecutionInvocation(runId: string, createdRecordId: RecordId, claimId: string, nowMilliseconds?: number, allowExpiredTakeover?: boolean): DurableExecutionInvocationClaim;
```

Parameter:

- runId - Durable run whose provider boundary is guarded.

Parameter:

- createdRecordId - Exact creation evidence associated with the run.

Parameter:

- claimId - Unique identity proposed by this caller.

Parameter:

- nowMilliseconds - Unix time used for deterministic lease evaluation.

Parameter:

- allowExpiredTakeover - Whether this caller has authority to replace an expired claim.

Returns:

- The current frozen claim, including its monotonic fencing token and expiry.

Throws:

- {TypeError} If identifiers, creation evidence, or time are malformed or conflict.

Throws:

- {TraceStoreError} If the store is closed.

#### `appendDurableExecutionStart`

Atomically publishes canonical start evidence while a claim remains authoritative.

```ts
appendDurableExecutionStart(runId: string, claimId: string, fencingToken: number, nowMilliseconds?: number, recoveryCommandRecordId?: RecordId | null): DurableExecutionClaimedAppend;
```

Parameter:

- runId - Durable run whose start boundary is guarded.

Parameter:

- claimId - Exact acquired claim identity.

Parameter:

- fencingToken - Exact monotonic token returned with the claim.

Parameter:

- nowMilliseconds - Unix time used for deterministic lease evaluation.

Parameter:

- recoveryCommandRecordId - Optional canonical recovery command authorizing the start.

Returns:

- A committed receipt or a frozen fenced result.

Throws:

- {TypeError} If identifiers, token, or time are malformed.

Throws:

- {TraceStoreError} If the store is closed or the append fails.

#### `diagnoseAppend`

Diagnoses whether an append intent is committed, retryable, or corrupt.

The diagnosis is read-only. A missing intent is safe to retry, a consistent retained
receipt is committed, and inconsistent retained evidence requires manual recovery.

```ts
diagnoseAppend(appendIntentId: string): AppendRecoveryDiagnostic;
```

Parameter:

- appendIntentId - Stable append intent to inspect.

Returns:

- A frozen recovery diagnosis.

Throws:

- {TraceStoreError} If the store is closed.

Throws:

- {TypeError} If the append intent is empty.

Example:

- ```ts
const diagnosis = store.diagnoseAppend("append:task:1");
if (diagnosis.status === "manual_recovery_required") {
    console.error(diagnosis.issue);
}
```

#### `verifyIntegrity`

Verifies every retained store area and returns classified diagnostics.

The scan is read-only and includes SQLite integrity, canonical records, append receipts,
published cuts, owner paths, and registered external blobs.

```ts
verifyIntegrity(): TraceIntegrityReport;
```

Returns:

- A frozen whole-store integrity report.

Throws:

- {TraceStoreError} If the store is closed.

Throws:

- {Error} If SQLite cannot perform the diagnostic scan.

Example:

- ```ts
const report = store.verifyIntegrity();
if (!report.ok) {
    console.error(report.issues);
}
```

#### `exportTrace`

Exports every verified retained record, view, intent, cut, and blob.

```ts
exportTrace(): string;
```

Returns:

- Deterministic JSON using the configured native trace-archive format.

Throws:

- {TraceStoreError} If the store is closed or fails integrity verification.

Throws:

- {Error} If SQLite or blob storage cannot complete the read-only export.

Example:

- ```ts
const archiveJson = store.exportTrace();
const parsedArchive = JSON.parse(archiveJson);
```

#### `importTrace`

Imports a complete native trace archive into a pristine store.

The archive is fully staged and verified before one SQLite transaction publishes its
retained state. Semantic record identities and owner ordinals are preserved exactly.

```ts
importTrace(archiveJson: string): TraceImportReceipt;
```

Parameter:

- archiveJson - Versioned native archive JSON returned by `exportTrace()`.

Returns:

- Frozen counts for every imported retained-state area.

Throws:

- {TraceStoreError} If the store is closed or is not pristine.

Throws:

- {TypeError} If the archive is malformed, incompatible, or internally inconsistent.

Throws:

- {Error} If SQLite or blob storage cannot publish the validated archive.

Example:

- ```ts
const receipt = targetStore.importTrace(sourceStore.exportTrace());
console.log(receipt.imported_record_count);
```

#### `putBlob`

Durably retains binary content and its storage receipt.

Equal bytes are deduplicated by their configured content digest. Blob bytes become visible
only after a matching SQLite receipt commits.

```ts
putBlob(content: Uint8Array): BlobStorageReceipt;
```

Parameter:

- content - Binary content to retain.

Returns:

- A frozen content identity and byte-length receipt.

Throws:

- {BlobIntegrityError} If existing bytes or metadata disagree with the digest.

Throws:

- {TraceStoreError} If the store is closed.

Throws:

- {TypeError} If content is not a `Uint8Array`.

#### `readBlob`

Reads binary content after verifying its durable receipt and digest.

```ts
readBlob(blobId: BlobId): Uint8Array | undefined;
```

Parameter:

- blobId - Configured content-addressed blob identifier.

Returns:

- A fresh byte array, or `undefined` when no durable receipt exists.

Throws:

- {BlobIntegrityError} If retained bytes or metadata are missing or corrupt.

Throws:

- {TraceStoreError} If the store is closed.

Throws:

- {TypeError} If the blob identifier is malformed.

#### `verifyBlobs`

Verifies every registered blob receipt and filesystem object.

```ts
verifyBlobs(): BlobIntegrityReport;
```

Returns:

- A frozen report ordered by blob identifier.

Throws:

- {TraceStoreError} If the store is closed.

#### `collectBlobOrphans`

Inspects or deletes filesystem objects that have no durable blob registration.

Collection holds the configured store write lock, first verifies every registered blob,
and never removes registered content. Inspection is the configured default.

```ts
collectBlobOrphans(options?: BlobOrphanCollectionOptions): BlobOrphanCollectionReport;
```

Parameter:

- options - Optional configured collection mode.

Returns:

- A frozen report of discovered and deleted objects.

Throws:

- {BlobIntegrityError} If registered content is corrupt or storage is unsafe.

Throws:

- {TraceStoreError} If the store is closed.

Throws:

- {TypeError} If options are malformed or select an unsupported mode.

Throws:

- {Error} If SQLite or the filesystem cannot complete collection.

Example:

- ```ts
const inspection = store.collectBlobOrphans();
if (inspection.orphan_blob_ids.length > 0) {
    store.collectBlobOrphans({ mode: "delete" });
}
```

#### `readRecord`

Reads one semantic record and every owner-local occurrence.

```ts
readRecord(recordId: RecordId): RetainedRecord | undefined;
```

Parameter:

- recordId - Content-addressed record identifier.

Returns:

- The retained record, or `undefined` when it is absent.

Throws:

- {TraceStoreError} If the store is closed.

Throws:

- {TypeError} If the record identifier is malformed.

#### `readOwner`

Reads one owner path in ascending ordinal order.

```ts
readOwner(ownerId: string): readonly OwnerRecord[];
```

Parameter:

- ownerId - Stable trace-owner identifier.

Returns:

- Frozen owner-local record occurrences.

Throws:

- {TraceStoreError} If the store is closed.

Throws:

- {TypeError} If the owner identifier is empty or malformed.

#### `publishCut`

Publishes an immutable address through one retained owner-path occurrence.

Publication appends a semantic cut record and its resolver index atomically.

```ts
publishCut(spec: CutSpec): Cut;
```

Parameter:

- spec - Closed cut publication request.

Returns:

- The durable cut address.

Throws:

- {TraceStoreError} If the target occurrence is absent or the store is closed.

Throws:

- {TypeError} If the request is malformed.

#### `readCut`

Reads and verifies one published cut.

```ts
readCut(cutId: CutId): Cut;
```

Parameter:

- cutId - Stable published cut identifier.

Returns:

- The verified durable cut.

Throws:

- {TraceStoreError} If the cut is absent, corrupt, or the store is closed.

Throws:

- {TypeError} If the identifier is malformed.

#### `iterateCutRecords`

Lazily yields payload-visible owner occurrences through one published cut, in ordinal order.

Cut authentication and input validation occur on the first pull. Each subsequent pull reads
one occurrence synchronously, without a live cursor or transaction across yields. Later
appends are excluded. Integrity is incremental, not a cross-pull database snapshot: an error
cannot retract earlier yields. No graph closure, filtering, or redaction is performed.
Early termination releases iteration state but never closes the caller-owned store.

```ts
iterateCutRecords(cutId: CutId): AsyncGenerator<OwnerRecord, void, unknown>;
```

Parameter:

- cutId - Exact published cut identifier.

Returns:

- A single-use async iterator of frozen owner occurrences, including repeated IDs.

Throws:

- {TraceStoreError} On a pull if the store is closed, the cut is absent/corrupt, an
occurrence is missing, or the terminal occurrence no longer matches the cut.

Throws:

- {TypeError} On a pull if the identifier or encountered stored data is malformed.

Throws:

- {Error} On a pull if SQLite or canonical record decoding fails.

Example:

- ```ts
for await (const record of store.iterateCutRecords("cut:review")) {
    console.log(record.view.owner_ordinal, record.envelope.record_id);
}
```

#### `readOwnerPrefix`

Reads an owner path through an inclusive ordinal.

```ts
readOwnerPrefix(ownerId: string, through: number, options?: SliceReadOptions): Slice;
```

Parameter:

- ownerId - Stable trace-owner identifier.

Parameter:

- through - Inclusive owner ordinal.

Parameter:

- options - Mode and visibility selection.

Returns:

- An immutable graph-shaped slice.

Throws:

- {TraceStoreError} If retained owner-path evidence is corrupt or the store is closed.

Throws:

- {TypeError} If the owner, ordinal, or options are malformed.

#### `resolveCut`

Resolves a published cut without including later owner-path records.

```ts
resolveCut(cutId: CutId, options?: SliceReadOptions): Slice;
```

Parameter:

- cutId - Stable published cut identifier.

Parameter:

- options - Mode and visibility selection.

Returns:

- An immutable graph-shaped slice addressed by the cut.

Throws:

- {TraceStoreError} If the cut is absent, corrupt, or the store is closed.

Throws:

- {TypeError} If the cut identifier or options are malformed.

#### `projectExecution`

Projects one execution lifecycle at an immutable published cut.

```ts
projectExecution(cutId: CutId): Execution;
```

Parameter:

- cutId - Cut addressing the execution owner prefix.

Returns:

- A frozen, reproducible execution value.

Throws:

- {ProjectionCompatibilityError} If configured projection requirements cannot be met.

Throws:

- {TraceStoreError} If retained cut or lifecycle evidence is absent or corrupt.

Throws:

- {TypeError} If the cut identifier is malformed.

#### `projectEffectiveHistory`

Projects effective execution history at immutable root and child cuts.

Active child relations resolve their published child cuts. Abandoned relations remain
visible in retained history but do not select an effective child.

```ts
projectEffectiveHistory(cutId: CutId): EffectiveHistory;
```

Parameter:

- cutId - Cut addressing the root execution owner prefix.

Returns:

- Frozen root, relation, child, and parent-publication projections.

Throws:

- {ProjectionCompatibilityError} If configured projection requirements cannot be met.

Throws:

- {TraceStoreError} If a required cut or retained record is absent or corrupt.

Throws:

- {TypeError} If the cut identifier is malformed.

#### `readCausalClosure`

Reads the transitive causal closure of one or more retained root records.

Causal traversal occurs before mode filtering. Direct omitted parents become anchors under
the configured default policy, and witness support is closed independently to the root.

```ts
readCausalClosure(rootRecordIds: readonly RecordId[], options?: CausalClosureOptions): Slice;
```

Parameter:

- rootRecordIds - Records from which causal traversal begins.

Parameter:

- options - Mode, visibility, and anchor policy.

Returns:

- An immutable graph-shaped slice.

Throws:

- {TraceStoreError} If a root, parent, or witness is absent or corrupt.

Throws:

- {TypeError} If the request options or identifiers are malformed.

#### `close`

Closes the SQLite connection. Repeated calls are harmless.

```ts
close(): void;
```

#### `[Symbol.dispose]`

Closes the store when used with explicit resource management.

```ts
[Symbol.dispose](): void;
```

### `SQLiteTraceStoreOptions`

Classification: `type-only`. Kind: `type alias`.

Filesystem configuration for a SQLite trace store.

Signature:

```ts
export type SQLiteTraceStoreOptions = {
    readonly blobDirectory?: string;
    readonly readOnly?: boolean;
};
```

### `Slice`

Classification: `type-only`. Kind: `type alias`.

Immutable graph-shaped trace read.

Signature:

```ts
export type Slice = {
    readonly causal_edges: readonly (readonly [
        RecordId,
        RecordId
    ])[];
    readonly external_anchors: readonly ExternalAnchor[];
    readonly mode_filter: ModeFilter;
    readonly owner_paths: Readonly<Record<TraceOwnerId, readonly RecordId[]>>;
    readonly read_address?: Cut;
    readonly visible_records_by_id: Readonly<Record<RecordId, RecordShape | SliceRecord>>;
    readonly visible_witnesses_by_id: Readonly<Record<RecordId, SliceRecord>>;
    readonly visibility_profile: VisibilityProfile;
    readonly witness_anchors: readonly WitnessAnchor[];
};
```

### `SliceReadOptions`

Classification: `type-only`. Kind: `type alias`.

Shared options for owner-prefix and published-cut reads.

Signature:

```ts
export type SliceReadOptions = {
    readonly mode_filter?: ModeFilter;
    readonly visibility_profile?: VisibilityProfile;
};
```

### `SliceRecord`

Classification: `type-only`. Kind: `type alias`.

One selected payload-visible record occurrence.

Signature:

```ts
export type SliceRecord = {
    readonly body: RecordBody;
    readonly envelope: RecordEnvelope;
    readonly view?: RecordView;
};
```

### `StoreAppendRequest`

Classification: `type-only`. Kind: `type alias`.

One atomic append request presented to a trace store.

Signature:

```ts
export type StoreAppendRequest = {
    readonly append_intent_id: AppendIntentId;
    readonly batch: AppendBatchDraft;
};
```

### `TraceImportReceipt`

Classification: `type-only`. Kind: `type alias`.

Result of importing one complete native trace archive.

Signature:

```ts
export type TraceImportReceipt = {
    readonly imported_append_intent_count: number;
    readonly imported_blob_count: number;
    readonly imported_cut_count: number;
    readonly imported_record_count: number;
    readonly imported_record_view_count: number;
};
```

### `TraceIntegrityIssue`

Classification: `type-only`. Kind: `type alias`.

One classified defect found by a whole-store integrity scan.

Signature:

```ts
export type TraceIntegrityIssue = {
    readonly kind: TraceIntegrityIssueKind;
    readonly subject_id: string;
};
```

### `TraceIntegrityIssueKind`

Classification: `type-only`. Kind: `type alias`.

Stable classification for one whole-store integrity defect.

Signature:

```ts
export type TraceIntegrityIssueKind = `blob_${BlobIntegrityIssue["kind"]}` | "append_receipt_mismatch" | "cut_mismatch" | "orphan_record" | "owner_ordinal_mismatch" | "parent_index_mismatch" | "record_mismatch" | "sqlite_integrity_mismatch" | "witness_mismatch";
```

### `TraceIntegrityReport`

Classification: `type-only`. Kind: `type alias`.

Complete read-only integrity report for a trace store.

Signature:

```ts
export type TraceIntegrityReport = {
    readonly checked_append_intent_count: number;
    readonly checked_blob_count: number;
    readonly checked_cut_count: number;
    readonly checked_owner_count: number;
    readonly checked_record_count: number;
    readonly issues: readonly TraceIntegrityIssue[];
    readonly ok: boolean;
};
```

### `TraceRevisionEntry`

Classification: `type-only`. Kind: `type alias`.

Immutable published-cut trace revision and its exact resolved owner-prefix slice.

Signature:

```ts
export type TraceRevisionEntry = {
    readonly compatibility_version: string;
    readonly cut: Cut;
    readonly slice: Slice;
    readonly trace_revision_version: number;
};
```

### `TraceStoreError`

Classification: `runtime-and-type`. Kind: `class`.

Base error for trace-store contract violations.

Signature:

```ts
export declare class TraceStoreError extends Error {
    readonly code: string;
}
```

#### `code`

Stable configured machine-readable trace-store error code.

```ts
readonly code: string;
```

### `UnsupportedStoreSchemaError`

Classification: `runtime-and-type`. Kind: `class`.

Raised when a database schema is newer than this package supports.

Signature:

```ts
export declare class UnsupportedStoreSchemaError extends TraceStoreError {
    readonly code: string;
}
```

#### `code`

Stable configured machine-readable unsupported-schema code.

```ts
readonly code: string;
```

### `VisibilityProfile`

Classification: `type-only`. Kind: `type alias`.

Payload disclosure level for a graph-shaped trace read.

Signature:

```ts
export type VisibilityProfile = "full_internal" | "payload" | "shape_only";
```

### `WitnessAnchor`

Classification: `type-only`. Kind: `type alias`.

Visible placeholder for witness support whose payload is hidden.

Signature:

```ts
export type WitnessAnchor = {
    readonly hidden_reason: "hidden_by_visibility";
    readonly visible_shape: {
        readonly schema_ref: string;
        readonly witness_ref: RecordId | "";
    };
    readonly witness_ref: RecordId;
};
```

### `listOutputCitations`

Classification: `runtime-only`. Kind: `function`.

Lists a bounded page of exact retained-world output citations in canonical record/run order.

Signature:

```ts
export declare function listOutputCitations(store: SQLiteTraceStore, options?: LedgerListOptions): readonly OutputCitationEntry[];
```

Parameter:

- store - Open trace store containing durable retained-world evidence.

Parameter:

- options - Optional closed configured pagination object.

Returns:

- Frozen immutable output citation entries.

Throws:

- {TraceStoreError} If retained run, output, cut, or settlement evidence is corrupt.

Throws:

- {TypeError} If options or projected evidence violate configured bounds.

Example:

- ```ts
const outputs = listOutputCitations(store, { limit: 25, offset: 0 });
```

### `listRecoveryRecords`

Classification: `runtime-only`. Kind: `function`.

Lists bounded durable recovery/control projections in canonical run-ledger order.

Signature:

```ts
export declare function listRecoveryRecords(store: SQLiteTraceStore, options?: LedgerListOptions): readonly RecoveryRecordEntry[];
```

Parameter:

- store - Open trace store containing durable execution evidence.

Parameter:

- options - Optional closed configured pagination object.

Returns:

- Frozen immutable recovery record entries.

Throws:

- {TraceStoreError} If retained lifecycle, command, or cut evidence is corrupt.

Throws:

- {TypeError} If options or canonical projection bounds are invalid.

### `listRunLedger`

Classification: `runtime-only`. Kind: `function`.

Lists a bounded page of durable executions in canonical creation-record/run-ID byte order.

Signature:

```ts
export declare function listRunLedger(store: SQLiteTraceStore, options?: LedgerListOptions): readonly RunLedgerEntry[];
```

Parameter:

- store - Open trace store containing durable execution evidence.

Parameter:

- options - Optional closed configured pagination object.

Returns:

- Frozen immutable run ledger entries.

Throws:

- {TraceStoreError} If the store is closed or retained evidence is corrupt.

Throws:

- {TypeError} If options, retained evidence, or canonical size are invalid.

Example:

- ```ts
const page = listRunLedger(store, { limit: 25, offset: 0 });
```

### `listTraceRevisions`

Classification: `runtime-only`. Kind: `function`.

Lists bounded immutable published-cut trace revisions in canonical publication order.

Signature:

```ts
export declare function listTraceRevisions(store: SQLiteTraceStore, options?: LedgerListOptions): readonly TraceRevisionEntry[];
```

Parameter:

- store - Open trace store containing published cuts.

Parameter:

- options - Optional closed configured pagination object.

Returns:

- Frozen immutable trace revision entries.

Throws:

- {TraceStoreError} If retained cut or slice evidence is corrupt.

Throws:

- {TypeError} If options or canonical projection bounds are invalid.

Example:

- ```ts
const revisions = listTraceRevisions(store, { limit: 25, offset: 0 });
```

### `resolveOutputCitationSelector`

Classification: `runtime-only`. Kind: `function`.

Resolves an exact output ID, unique output-ID prefix, or canonical latest read selector.

Signature:

```ts
export declare function resolveOutputCitationSelector(store: SQLiteTraceStore, selector: string): OutputCitationEntry;
```

Parameter:

- store - Open trace store containing durable retained-world evidence.

Parameter:

- selector - Exact output ID, unique output-ID prefix, or configured latest token.

Returns:

- Exact immutable output citation entry.

Throws:

- {LedgerSelectorAmbiguousError} If a prefix matches multiple bounded outputs.

Throws:

- {LedgerSelectorNotFoundError} If no output matches.

Throws:

- {TraceStoreError} If retained run, output, cut, or settlement evidence is corrupt.

Throws:

- {TypeError} If the selector or projection violates configured bounds.

Example:

- ```ts
const output = resolveOutputCitationSelector(store, "world-output:sha256:...");
```

### `resolveRecoveryRecordSelector`

Classification: `runtime-only`. Kind: `function`.

Resolves recovery records through the exact/prefix/latest read-only run selector contract.

Signature:

```ts
export declare function resolveRecoveryRecordSelector(store: SQLiteTraceStore, selector: string): RecoveryRecordEntry;
```

Parameter:

- store - Open trace store containing durable execution evidence.

Parameter:

- selector - Exact run ID, unique prefix, or configured latest token.

Returns:

- Exact immutable recovery record projection.

Throws:

- {LedgerSelectorAmbiguousError} If a run prefix is ambiguous.

Throws:

- {LedgerSelectorNotFoundError} If no run matches.

Throws:

- {TraceStoreError} If retained lifecycle, command, or cut evidence is corrupt.

Throws:

- {TypeError} If the selector or canonical projection bounds are invalid.

### `resolveRunLedgerSelector`

Classification: `runtime-only`. Kind: `function`.

Resolves an exact run ID, unique run-ID prefix, or canonical latest read selector.

Signature:

```ts
export declare function resolveRunLedgerSelector(store: SQLiteTraceStore, selector: string): RunLedgerEntry;
```

Parameter:

- store - Open trace store containing durable execution evidence.

Parameter:

- selector - Exact run ID, unique run-ID prefix, or configured latest token.

Returns:

- Exact immutable run ledger entry.

Throws:

- {LedgerSelectorAmbiguousError} If a prefix matches multiple runs.

Throws:

- {LedgerSelectorNotFoundError} If no run matches.

Throws:

- {TraceStoreError} If the store is closed or retained evidence is corrupt.

Throws:

- {TypeError} If the selector or retained projection evidence is invalid.

Example:

- ```ts
const run = resolveRunLedgerSelector(store, "run:review:1");
```

### `resolveTraceRevisionSelector`

Classification: `runtime-only`. Kind: `function`.

Resolves an exact cut ID, unique cut-ID prefix, or canonical latest trace revision.

Signature:

```ts
export declare function resolveTraceRevisionSelector(store: SQLiteTraceStore, selector: string): TraceRevisionEntry;
```

Parameter:

- store - Open trace store containing published cuts.

Parameter:

- selector - Exact cut ID, unique prefix, or configured latest token.

Returns:

- Exact immutable trace revision entry.

Throws:

- {LedgerSelectorAmbiguousError} If a prefix matches multiple cuts.

Throws:

- {LedgerSelectorNotFoundError} If no cut matches.

Throws:

- {TraceStoreError} If retained cut or slice evidence is corrupt.

Throws:

- {TypeError} If the selector or projection violates configured bounds.

Example:

- ```ts
const revision = resolveTraceRevisionSelector(store, "cut:run:1");
```

## Workspace

Package entry: `./workspace`

Workspace bindings, custody, grants, placement, retained execution, and exact settlement.

Runtime: ESM on Node >=24.12.0 <25, except the type-only /read entry (no Node runtime required).

Authority and mutation: These APIs may read or mutate caller-selected filesystem and Git state, and native runners may launch capability-probed processes. Required task, provider, run, trace, carrier, runner, and grant handles stay explicit.

Import example:

```ts
import * as api from "@avnionur/shepherd-typescript/workspace";
void api;
```

Exported symbols: 186.

### `AppliedRetainedWorldSettlement`

Classification: `type-only`. Kind: `type alias`.

Completed durable apply result after authenticated carrier publication.

Signature:

```ts
export type AppliedRetainedWorldSettlement = {
    readonly action: (typeof RETAINED_WORLD_SETTLEMENT_ACTIONS)[2];
    readonly applied_revision_id: string;
    readonly application_plan_id: string;
    readonly operation_id: string;
    readonly output_id: string;
    readonly publication_id: string;
    readonly plan_reason: RetainedWorldApplicationPlanEvidence["reason"];
    readonly plan_status: RetainedWorldApplicationPlanEvidence["status"];
    readonly request_id: string;
    readonly settlement_version: typeof RETAINED_WORLD_SETTLEMENT_VERSION;
    readonly state: (typeof RETAINED_WORLD_SETTLEMENT_STATES)[4];
    readonly user_basis_after: string;
};
```

### `ApplyRetainedWorldSettlementOptions`

Classification: `type-only`. Kind: `type alias`.

Closed authorities for exact-ID retained-world apply and recovery.

Signature:

```ts
export type ApplyRetainedWorldSettlementOptions = {
    readonly binding: WorkspaceBinding;
    readonly carrier: ReferenceCopyCarrier;
    readonly outputId: string;
    readonly store: SQLiteTraceStore;
};
```

### `CaptureGrantedTaskWorldOptions`

Classification: `type-only`. Kind: `type alias`.

Closed options for repository-granted retained-world task execution.

Signature:

```ts
export type CaptureGrantedTaskWorldOptions<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>> = Omit<CaptureTaskWorldOptions<I, O>, "binding"> & {
    readonly binding: GitRepositoryBinding;
    readonly repositoryGrantPlan: GitRepositoryGrantPlan;
};
```

### `CaptureJailedGrantedTaskWorldOptions`

Classification: `type-only`. Kind: `type alias`.

Closed options for native-jailed repository-granted retained-world execution.

Signature:

```ts
export type CaptureJailedGrantedTaskWorldOptions<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>> = CaptureGrantedTaskWorldOptions<I, O> & {
    readonly nativeJailResolution: NativeJailPlacementResolution;
};
```

### `CapturePlacedGrantedTaskWorldOptions`

Classification: `type-only`. Kind: `type alias`.

Closed options for placement-resolved repository-granted retained-world execution.

Signature:

```ts
export type CapturePlacedGrantedTaskWorldOptions<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>> = CaptureGrantedTaskWorldOptions<I, O> & {
    readonly placementResolution: GrantedPlacementResolution;
};
```

### `CaptureTaskWorldOptions`

Classification: `type-only`. Kind: `type alias`.

Closed options for one fenced durable retained-world task execution.

Signature:

```ts
export type CaptureTaskWorldOptions<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>> = {
    readonly baseRevision: WorldRevision;
    readonly binding: WorkspaceBinding;
    readonly captureId: string;
    readonly carrier: ReferenceCopyCarrier;
    readonly execution: TaskExecutionOptions<I, O>;
    readonly runner: RetainedWorldRunner<I, O>;
    readonly store: SQLiteTraceStore;
};
```

### `DiscardRetainedWorldSettlementOptions`

Classification: `type-only`. Kind: `type alias`.

Closed authorities for exact-ID retained-world discard and recovery.

Signature:

```ts
export type DiscardRetainedWorldSettlementOptions = {
    readonly carrier: ReferenceCopyCarrier;
    readonly outputId: string;
    readonly store: SQLiteTraceStore;
};
```

### `DiscardedRetainedWorldSettlement`

Classification: `type-only`. Kind: `type alias`.

Completed durable discard result after idempotent physical custody cleanup.

Signature:

```ts
export type DiscardedRetainedWorldSettlement = {
    readonly action: (typeof RETAINED_WORLD_SETTLEMENT_ACTIONS)[1];
    readonly cleanup_completed: true;
    readonly operation_id: string;
    readonly output_id: string;
    readonly request_id: string;
    readonly settlement_version: typeof RETAINED_WORLD_SETTLEMENT_VERSION;
    readonly state: (typeof RETAINED_WORLD_SETTLEMENT_STATES)[3];
};
```

### `GitAwareCustody`

Classification: `type-only`. Kind: `type alias`.

Public workspace protocol v4 Git-aware custody operations.

Signature:

```ts
export type GitAwareCustody = {
    readonly capture: (binding: WorkspaceBinding) => Promise<GitRetainedOutput | null>;
    readonly discard: (custodyId: string) => Promise<void>;
    readonly open: (custodyId: string) => Promise<GitRetainedOutput>;
    readonly verify: (custodyId: string) => Promise<GitCustodyVerification>;
};
```

### `GitAwareCustodyOptions`

Classification: `type-only`. Kind: `type alias`.

Closed options accepted by createGitAwareCustody.

Signature:

```ts
export type GitAwareCustodyOptions = {
    readonly faultInjection?: WorkspaceCustodyFaultInjection;
    readonly workspaceRoot: string;
};
```

### `GitBasisEvidence`

Classification: `type-only`. Kind: `type alias`.

Immutable Git-aware basis evidence for retained output custody.

Signature:

```ts
export type GitBasisEvidence = {
    readonly basis_id: string;
    readonly binding_id: string;
    readonly head: GitHeadEvidence;
    readonly ignored: GitIgnoredEvidence;
    readonly index: GitIndexEvidence | null;
    readonly mode: WorkspaceAdoptionMode;
    readonly object_pack_id: string | null;
    readonly repository: GitRepositoryIdentity;
    readonly sparse_digest: string;
    readonly world_content_id: string;
};
```

### `GitChangesetInspection`

Classification: `type-only`. Kind: `type alias`.

Authenticated Git-aware projection composed with canonical world inspection.

Signature:

```ts
export type GitChangesetInspection = {
    readonly git_changes: readonly GitChangesetPathChange[];
    readonly inspection_version: number;
    readonly symlink_modes: readonly GitSymlinkModePresentation[];
    readonly world: WorldChangesetInspection;
};
```

### `GitChangesetInspectionOptions`

Classification: `type-only`. Kind: `type alias`.

Closed options accepted by createGitChangesetInspection.

Signature:

```ts
export type GitChangesetInspectionOptions = {
    readonly baseCustodyId: string;
    readonly headCustodyId: string;
    readonly workspaceRoot: string;
};
```

### `GitChangesetNode`

Classification: `type-only`. Kind: `type alias`.

Git-aware path state, including external Gitlink commit citations.

Signature:

```ts
export type GitChangesetNode = WorldChangeNode | {
    readonly commit_oid: string;
    readonly kind: typeof GITLINK_ENTRY_KIND;
    readonly mode: string;
};
```

### `GitChangesetPathChange`

Classification: `type-only`. Kind: `type alias`.

One Git-aware path change projection outside canonical world identity.

Signature:

```ts
export type GitChangesetPathChange = {
    readonly after: GitChangesetNode | null;
    readonly before: GitChangesetNode | null;
    readonly operation: WorldChangeOperation;
    readonly path: string;
};
```

### `GitCustodyError`

Classification: `runtime-and-type`. Kind: `class`.

Raised when Git-aware baseline or retained-output custody is unavailable or inconsistent.

Signature:

```ts
export declare class GitCustodyError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
```

#### `code`

Stable machine-readable Git-custody failure code.

```ts
readonly code: string;
```

#### `constructor`

Creates a Git-aware custody failure.

```ts
constructor(code: string, message: string);
```

Parameter:

- code - Configured machine-readable failure code.

Parameter:

- message - Diagnostic describing the rejected Git state or custody evidence.

### `GitCustodyVerification`

Classification: `type-only`. Kind: `type alias`.

Verification of retained output and the current user Git basis.

Signature:

```ts
export type GitCustodyVerification = {
    readonly basis_moved: boolean;
    readonly output: WorldVerification;
};
```

### `GitHeadEvidence`

Classification: `type-only`. Kind: `type alias`.

Closed canonical Git HEAD evidence captured for one basis.

Signature:

```ts
export type GitHeadEvidence = {
    readonly commit: string | null;
    readonly kind: GitHeadKind;
    readonly ref: string | null;
};
```

### `GitHeadKind`

Classification: `type-only`. Kind: `type alias`.

Configured Git HEAD-state discriminant.

Signature:

```ts
export type GitHeadKind = (typeof GIT_HEAD_KINDS)[number];
```

### `GitIgnoredEvidence`

Classification: `type-only`. Kind: `type alias`.

Auditable ignored-untracked exclusion evidence.

Signature:

```ts
export type GitIgnoredEvidence = {
    readonly digest: string;
    readonly paths: readonly string[];
    readonly sources_digest: string;
};
```

### `GitIndexEntry`

Classification: `type-only`. Kind: `type alias`.

One canonical Git index entry including stage and special flags.

Signature:

```ts
export type GitIndexEntry = {
    readonly assume_unchanged: boolean;
    readonly intent_to_add: boolean;
    readonly mode: string;
    readonly object_id: string;
    readonly path: string;
    readonly skip_worktree: boolean;
    readonly stage: number;
};
```

### `GitIndexEvidence`

Classification: `type-only`. Kind: `type alias`.

Exact and semantic Git index evidence retained for a worktree basis.

Signature:

```ts
export type GitIndexEvidence = {
    readonly entries: readonly GitIndexEntry[];
    readonly receipt_id: string;
};
```

### `GitRepositoryBinding`

Classification: `type-only`. Kind: `type alias`.

Frozen repository-aware authority extending one canonical workspace binding.

Signature:

```ts
export type GitRepositoryBinding = WorkspaceBinding & {
    readonly repository: WorkspaceRepositoryBindingEvidence;
    readonly resource_id: string;
    readonly resource_type: string;
};
```

### `GitRepositoryBindingSet`

Classification: `type-only`. Kind: `type alias`.

Frozen complete repository-binding set for one initialized workspace.

Signature:

```ts
export type GitRepositoryBindingSet = {
    readonly binding_version: number;
    readonly bindings: readonly GitRepositoryBinding[];
    readonly repository_binding_version: number;
    readonly workspace_root: string;
};
```

### `GitRepositoryGrantPlan`

Classification: `type-only`. Kind: `type alias`.

Authenticated exact resource admission plan for one repository-granted task run.

Signature:

```ts
export type GitRepositoryGrantPlan = {
    readonly authority_ceiling: RepositoryGrantProfile;
    readonly enforcement: RetainedWorldEnforcement;
    readonly grants: readonly GitRepositoryGrantPlanEntry[];
    readonly grant_plan_version: number;
    readonly plan_id: string;
    readonly task_artifact_digest: string;
    readonly task_grant_artifact_digest: string;
};
```

### `GitRepositoryGrantPlanEntry`

Classification: `type-only`. Kind: `type alias`.

One admitted repository resource and its non-amplifying effective authority.

Signature:

```ts
export type GitRepositoryGrantPlanEntry = {
    readonly authority: readonly RepositoryGrantAtom[];
    readonly binding_id: string;
    readonly binding_name: string;
    readonly resource_id: string;
    readonly task_profile: RepositoryGrantProfile;
};
```

### `GitRepositoryGrantPlanOptions`

Classification: `type-only`. Kind: `type alias`.

Closed options accepted by createGitRepositoryGrantPlan.

Signature:

```ts
export type GitRepositoryGrantPlanOptions<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>> = {
    readonly authorityCeiling: RepositoryGrantProfile;
    readonly bindings: readonly GitRepositoryBinding[];
    readonly task: RepositoryGrantedTask<I, O>;
};
```

### `GitRepositoryIdentity`

Classification: `type-only`. Kind: `type alias`.

Stable local repository and worktree authority evidence.

Signature:

```ts
export type GitRepositoryIdentity = {
    readonly bare: boolean;
    readonly common_dir: string;
    readonly common_dir_identity: string;
    readonly git_dir: string;
    readonly git_version: string;
    readonly object_format: string;
    readonly repository_id: string;
    readonly root: string;
    readonly worktree_id: string;
};
```

### `GitRetainedOutput`

Classification: `type-only`. Kind: `type alias`.

One restart-safe retained output fork bound to an exact Git basis.

Signature:

```ts
export type GitRetainedOutput = {
    readonly basis: GitBasisEvidence;
    readonly custody: WorldCustody;
    readonly git_custody_version: number;
    readonly revision: WorldRevision;
};
```

### `GitSymlinkModePresentation`

Classification: `type-only`. Kind: `type alias`.

Git symbolic-link mode presentation retained outside canonical world identity.

Signature:

```ts
export type GitSymlinkModePresentation = {
    readonly before_mode: string | null;
    readonly after_mode: string | null;
    readonly path: string;
};
```

### `GrantTaskRepositoriesOptions`

Classification: `type-only`. Kind: `type alias`.

Closed options accepted by grantTaskRepositories.

Signature:

```ts
export type GrantTaskRepositoriesOptions<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>> = {
    readonly grants: readonly RepositoryTaskGrantDefinition[];
    readonly task: TaskDescriptor<I, O>;
};
```

### `GrantedPlacementResolution`

Classification: `type-only`. Kind: `type alias`.

Immutable content-addressed placement resolution for one exact granted run capture.

Signature:

```ts
export type GrantedPlacementResolution = {
    readonly capture_id: string;
    readonly compatibility_version: string;
    readonly enforcement: RetainedWorldEnforcement;
    readonly platform: PlacementPlatformEvidence;
    readonly placement_version: number;
    readonly reason: PlacementResolutionReason;
    readonly repository_grant_plan_id: string;
    readonly requested_placement: PlacementRequest;
    readonly resolution_id: string;
    readonly resolved_placement: ResolvedPlacement;
    readonly run_id: string;
    readonly runner_id: string;
    readonly status: PlacementResolutionStatus;
    readonly task_artifact_digest: string;
};
```

### `GrantedPlacementResolutionOptions`

Classification: `type-only`. Kind: `type alias`.

Closed options accepted by createGrantedPlacementResolution.

Signature:

```ts
export type GrantedPlacementResolutionOptions<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>> = {
    readonly captureId: string;
    readonly placement: PlacementRequest;
    readonly platform: PlacementPlatformEvidence;
    readonly repositoryGrantPlan: GitRepositoryGrantPlan;
    readonly runId: string;
    readonly runner: RetainedWorldRunner<I, O>;
};
```

### `InspectRetainedWorldApplicationConflictsOptions`

Classification: `type-only`. Kind: `type alias`.

Closed options accepted by inspectRetainedWorldApplicationConflicts.

Signature:

```ts
export type InspectRetainedWorldApplicationConflictsOptions = {
    readonly candidatePaths: readonly string[];
    readonly currentPaths: readonly string[];
};
```

### `JailedTaskWorldCaptureResult`

Classification: `type-only`. Kind: `type alias`.

Durable native-jailed task result with exact process and placement evidence.

Signature:

```ts
export type JailedTaskWorldCaptureResult = TaskWorldCaptureResult & {
    readonly placement: NativeJailPlacementResolution;
    readonly process: NativeJailLaunchReceipt;
};
```

### `NativeJailBackendDescriptor`

Classification: `type-only`. Kind: `type alias`.

Immutable configured descriptor for one native syscall-jail backend.

Signature:

```ts
export type NativeJailBackendDescriptor = {
    readonly backend_id: string;
    readonly backend_version: number;
    readonly compatibility_version: string;
    readonly environments: readonly PlacementEnvironment[];
    readonly enforcement: RetainedWorldEnforcement;
    readonly executable: string | null;
    readonly family: PlacementPlatformFamily;
    readonly node_platforms: readonly string[];
    readonly name: NativeJailBackendName;
    readonly profile_argument: string | null;
};
```

### `NativeJailBackendName`

Classification: `type-only`. Kind: `type alias`.

One configured native syscall-jail backend name.

Signature:

```ts
export type NativeJailBackendName = (typeof NATIVE_JAIL_BACKENDS)[number];
```

### `NativeJailBackendProbeEvidence`

Classification: `type-only`. Kind: `type alias`.

Immutable result of one real local native-jail capability probe.

Signature:

```ts
export type NativeJailBackendProbeEvidence = {
    readonly backend: NativeJailBackendDescriptor | null;
    readonly compatibility_version: string;
    readonly denied_write: boolean;
    readonly enforcement: RetainedWorldEnforcement;
    readonly granted_write: boolean;
    readonly helper_digest: string | null;
    readonly platform: PlacementPlatformEvidence;
    readonly probe_id: string;
    readonly reason: NativeJailProbeReason;
    readonly status: NativeJailProbeStatus;
    readonly probe_version: number;
};
```

### `NativeJailCommand`

Classification: `type-only`. Kind: `type alias`.

Immutable content-addressed native jailed command descriptor.

Signature:

```ts
export type NativeJailCommand = {
    readonly arguments: readonly string[];
    readonly command_id: string;
    readonly command_version: number;
    readonly environment: readonly NativeJailEnvironmentEntry[];
    readonly executable: string;
};
```

### `NativeJailCommandDefinition`

Classification: `type-only`. Kind: `type alias`.

Closed structured command definition accepted by createNativeJailRunner.

Signature:

```ts
export type NativeJailCommandDefinition = {
    readonly arguments: readonly string[];
    readonly environment: readonly NativeJailEnvironmentEntry[];
    readonly executable: string;
};
```

### `NativeJailConfinementPlan`

Classification: `type-only`. Kind: `type alias`.

Immutable content-addressed native confinement plan for one isolated custody.

Signature:

```ts
export type NativeJailConfinementPlan = {
    readonly backend_id: string;
    readonly command_id: string;
    readonly compatibility_version: string;
    readonly custody_root: string;
    readonly enforcement: RetainedWorldEnforcement;
    readonly plan_id: string;
    readonly plan_version: number;
    readonly profile_digest: string;
    readonly probe_id: string;
    readonly writable_roots: readonly string[];
};
```

### `NativeJailEnvironmentEntry`

Classification: `type-only`. Kind: `type alias`.

One explicit environment entry supplied to a native jailed command.

Signature:

```ts
export type NativeJailEnvironmentEntry = {
    readonly name: string;
    readonly value: string;
};
```

### `NativeJailExecutionError`

Classification: `runtime-and-type`. Kind: `class`.

Raised after a native judged process reaches a non-success or uncertain terminal state.

Signature:

```ts
export declare class NativeJailExecutionError extends Error {
    readonly code: string;
    readonly receipt: NativeJailLaunchReceipt;
    constructor(receipt: NativeJailLaunchReceipt);
}
```

#### `code`

Stable configured machine-readable native-execution failure code.

```ts
readonly code: string;
```

#### `receipt`

Exact durable terminal launch receipt.

```ts
readonly receipt: NativeJailLaunchReceipt;
```

#### `constructor`

Creates one fail-closed native process failure.

```ts
constructor(receipt: NativeJailLaunchReceipt);
```

Parameter:

- receipt - Exact terminal process and quiescence evidence.

### `NativeJailLaunchIntent`

Classification: `type-only`. Kind: `type alias`.

Immutable intent retained before one native process may start.

Signature:

```ts
export type NativeJailLaunchIntent = {
    readonly command_id: string;
    readonly launch_id: string;
    readonly plan: NativeJailConfinementPlan;
    readonly plan_id: string;
    readonly runner_id: string;
};
```

### `NativeJailLaunchReceipt`

Classification: `type-only`. Kind: `type alias`.

Immutable durable result of one native judged-process launch.

Signature:

```ts
export type NativeJailLaunchReceipt = {
    readonly exit_code: number | null;
    readonly launch_id: string;
    readonly process_id: number | null;
    readonly quiescence: NativeJailQuiescenceStatus;
    readonly receipt_id: string;
    readonly receipt_version: number;
    readonly signal: string | null;
    readonly status: NativeJailProcessStatus;
    readonly stderr_base64: string;
    readonly stderr_bytes: number;
    readonly stdout_base64: string;
    readonly stdout_bytes: number;
};
```

### `NativeJailPlacementReason`

Classification: `type-only`. Kind: `type alias`.

One configured successful native-jail placement reason.

Signature:

```ts
export type NativeJailPlacementReason = (typeof NATIVE_JAIL_PLACEMENT_REASONS)[number];
```

### `NativeJailPlacementResolution`

Classification: `type-only`. Kind: `type alias`.

Immutable content-addressed native-jail placement resolution.

Signature:

```ts
export type NativeJailPlacementResolution = {
    readonly backend: NativeJailBackendDescriptor;
    readonly backend_probe: NativeJailBackendProbeEvidence;
    readonly capture_id: string;
    readonly command: NativeJailCommand;
    readonly compatibility_version: string;
    readonly enforcement: RetainedWorldEnforcement;
    readonly placement_version: number;
    readonly max_output_bytes: number;
    readonly reason: NativeJailPlacementReason;
    readonly repository_grant_plan_id: string;
    readonly requested_placement: "auto" | "jail";
    readonly resolution_id: string;
    readonly resolved_placement: "jail";
    readonly run_id: string;
    readonly runner_id: string;
    readonly status: "resolved";
    readonly task_artifact_digest: string;
    readonly timeout_milliseconds: number;
};
```

### `NativeJailPlacementResolutionOptions`

Classification: `type-only`. Kind: `type alias`.

Closed options accepted by createNativeJailPlacementResolution.

Signature:

```ts
export type NativeJailPlacementResolutionOptions<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>> = {
    readonly captureId: string;
    readonly placement: "auto" | "jail";
    readonly platform: PlacementPlatformEvidence;
    readonly repositoryGrantPlan: GitRepositoryGrantPlan;
    readonly runId: string;
    readonly runner: NativeJailRunner<I, O>;
};
```

### `NativeJailProbeReason`

Classification: `type-only`. Kind: `type alias`.

One configured native-jail probe reason.

Signature:

```ts
export type NativeJailProbeReason = (typeof NATIVE_JAIL_PROBE_REASONS)[number];
```

### `NativeJailProbeStatus`

Classification: `type-only`. Kind: `type alias`.

One configured native-jail probe status.

Signature:

```ts
export type NativeJailProbeStatus = (typeof NATIVE_JAIL_PROBE_STATUSES)[number];
```

### `NativeJailProcessStarted`

Classification: `type-only`. Kind: `type alias`.

Immutable evidence retained after the native process actually starts.

Signature:

```ts
export type NativeJailProcessStarted = {
    readonly launch_id: string;
    readonly process_id: number;
    readonly start_id: string;
};
```

### `NativeJailProcessStatus`

Classification: `type-only`. Kind: `type alias`.

One configured native judged-process terminal status.

Signature:

```ts
export type NativeJailProcessStatus = (typeof NATIVE_JAIL_PROCESS_STATUSES)[number];
```

### `NativeJailQuiescenceStatus`

Classification: `type-only`. Kind: `type alias`.

One configured process-group quiescence classification.

Signature:

```ts
export type NativeJailQuiescenceStatus = (typeof NATIVE_JAIL_QUIESCENCE_STATUSES)[number];
```

### `NativeJailRunner`

Classification: `type-only`. Kind: `type alias`.

Opaque authenticated native-jail runner handle.

Signature:

```ts
export type NativeJailRunner<I extends TaskSchema<unknown> = TaskSchema<unknown>, O extends TaskSchema<unknown> = TaskSchema<unknown>> = RetainedWorldRunner<I, O>;
```

### `NativeJailRunnerDefinition`

Classification: `type-only`. Kind: `type alias`.

Closed definition accepted by createNativeJailRunner.

Signature:

```ts
export type NativeJailRunnerDefinition = {
    readonly command: NativeJailCommandDefinition;
    readonly maxOutputBytes: number;
    readonly probe: NativeJailBackendProbeEvidence;
    readonly runnerId: string;
    readonly timeoutMilliseconds: number;
};
```

### `NativeJailUnavailableError`

Classification: `runtime-and-type`. Kind: `class`.

Raised when native-jail runner admission lacks a successful authenticated host probe.

Signature:

```ts
export declare class NativeJailUnavailableError extends TypeError {
    readonly code: string;
    readonly evidence: NativeJailBackendProbeEvidence;
    constructor(evidence: NativeJailBackendProbeEvidence);
}
```

#### `code`

Stable configured machine-readable unavailable-native-jail code.

```ts
readonly code: string;
```

#### `evidence`

Exact authenticated unavailable backend probe.

```ts
readonly evidence: NativeJailBackendProbeEvidence;
```

#### `constructor`

Creates one fail-closed native-jail refusal.

```ts
constructor(evidence: NativeJailBackendProbeEvidence);
```

Parameter:

- evidence - Exact unavailable local backend probe.

### `PlacedTaskWorldCaptureResult`

Classification: `type-only`. Kind: `type alias`.

Durable placed task result paired with exact placement and retained-world evidence.

Signature:

```ts
export type PlacedTaskWorldCaptureResult = TaskWorldCaptureResult & {
    readonly placement: GrantedPlacementResolution;
};
```

### `PlacementEnvironment`

Classification: `type-only`. Kind: `type alias`.

One configured execution-environment classification.

Signature:

```ts
export type PlacementEnvironment = (typeof PLACEMENT_ENVIRONMENTS)[number];
```

### `PlacementPlatformEvidence`

Classification: `type-only`. Kind: `type alias`.

Immutable content-addressed platform classification used by placement resolution.

Signature:

```ts
export type PlacementPlatformEvidence = {
    readonly compatibility_version: string;
    readonly environment: PlacementEnvironment;
    readonly family: PlacementPlatformFamily;
    readonly node_platform: string;
    readonly os_release: string;
    readonly platform_id: string;
    readonly platform_version: number;
    readonly wsl_markers: readonly string[];
};
```

### `PlacementPlatformEvidenceOptions`

Classification: `type-only`. Kind: `type alias`.

Closed deterministic probe accepted by createPlacementPlatformEvidence.

Signature:

```ts
export type PlacementPlatformEvidenceOptions = {
    readonly environmentVariables: readonly string[];
    readonly nodePlatform: string;
    readonly osRelease: string;
};
```

### `PlacementPlatformFamily`

Classification: `type-only`. Kind: `type alias`.

One configured platform-family classification.

Signature:

```ts
export type PlacementPlatformFamily = (typeof PLACEMENT_PLATFORM_FAMILIES)[number];
```

### `PlacementRefusalEvidence`

Classification: `type-only`. Kind: `type alias`.

Stable public evidence attached to a fail-closed unavailable placement request.

Signature:

```ts
export type PlacementRefusalEvidence = {
    readonly placement_version: number;
    readonly reason: PlacementResolutionReason;
    readonly requested_placement: PlacementRequest;
    readonly status: PlacementResolutionStatus;
};
```

### `PlacementRequest`

Classification: `type-only`. Kind: `type alias`.

One configured per-run placement request.

Signature:

```ts
export type PlacementRequest = (typeof PLACEMENT_REQUESTS)[number];
```

### `PlacementResolutionReason`

Classification: `type-only`. Kind: `type alias`.

One configured placement-resolution reason.

Signature:

```ts
export type PlacementResolutionReason = (typeof PLACEMENT_RESOLUTION_REASONS)[number];
```

### `PlacementResolutionStatus`

Classification: `type-only`. Kind: `type alias`.

One configured placement resolution or refusal status.

Signature:

```ts
export type PlacementResolutionStatus = (typeof PLACEMENT_RESOLUTION_STATUSES)[number];
```

### `PlacementUnavailableError`

Classification: `runtime-and-type`. Kind: `class`.

Raised when an explicit placement request cannot resolve without weakening enforcement.

Signature:

```ts
export declare class PlacementUnavailableError extends TypeError {
    readonly code: string;
    readonly evidence: PlacementRefusalEvidence;
    constructor(evidence: PlacementRefusalEvidence);
}
```

#### `code`

Stable configured machine-readable unavailable-placement code.

```ts
readonly code: string;
```

#### `evidence`

Frozen configured refusal status and reason.

```ts
readonly evidence: PlacementRefusalEvidence;
```

#### `constructor`

Creates one fail-closed placement refusal.

```ts
constructor(evidence: PlacementRefusalEvidence);
```

Parameter:

- evidence - Exact configured request, status, reason, and protocol version.

### `PrepareRetainedWorldSettlementOptions`

Classification: `type-only`. Kind: `type alias`.

Closed options for authenticated consume-once retained-world settlement admission.

Signature:

```ts
export type PrepareRetainedWorldSettlementOptions = {
    readonly action: (typeof RETAINED_WORLD_SETTLEMENT_ACTIONS)[number];
    readonly binding: WorkspaceBinding;
    readonly carrier: ReferenceCopyCarrier;
    readonly commandId: string;
    readonly output: RetainedWorldOutput;
    readonly store: SQLiteTraceStore;
};
```

### `PreparedRetainedWorldSettlement`

Classification: `type-only`. Kind: `type alias`.

Authenticated prepared settlement decision and its exact closed request.

Signature:

```ts
export type PreparedRetainedWorldSettlement = RetainedWorldSettlementAdmission & {
    readonly request: RetainedWorldSettlementRequest;
};
```

### `RecoverGrantedTaskWorldOptions`

Classification: `type-only`. Kind: `type alias`.

Closed options for exact recovery of repository-granted retained-world execution.

Signature:

```ts
export type RecoverGrantedTaskWorldOptions<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>> = CaptureGrantedTaskWorldOptions<I, O> & {
    readonly commandId: string;
};
```

### `RecoverJailedGrantedTaskWorldOptions`

Classification: `type-only`. Kind: `type alias`.

Closed options for exact recovery of native-jailed granted execution.

Signature:

```ts
export type RecoverJailedGrantedTaskWorldOptions<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>> = CaptureJailedGrantedTaskWorldOptions<I, O> & {
    readonly commandId: string;
};
```

### `RecoverPlacedGrantedTaskWorldOptions`

Classification: `type-only`. Kind: `type alias`.

Closed options for exact recovery of placement-resolved granted execution.

Signature:

```ts
export type RecoverPlacedGrantedTaskWorldOptions<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>> = CapturePlacedGrantedTaskWorldOptions<I, O> & {
    readonly commandId: string;
};
```

### `RecoverTaskWorldOptions`

Classification: `type-only`. Kind: `type alias`.

Closed options for command-authorized recovery of one retained-world task capture.

Signature:

```ts
export type RecoverTaskWorldOptions<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>> = CaptureTaskWorldOptions<I, O> & {
    readonly commandId: string;
};
```

### `ReferenceCopyCarrier`

Classification: `type-only`. Kind: `type alias`.

Public workspace protocol v6 reference copy-carrier operations.

Signature:

```ts
export type ReferenceCopyCarrier = {
    readonly captureCustody: (custodyId: string) => Promise<WorldRevision>;
    readonly discard: (custodyId: string) => Promise<void>;
    readonly fork: (revisionId: string) => Promise<WorldCustody>;
    readonly openCustody: (custodyId: string) => Promise<WorldCustody>;
    readonly openRevision: (revisionId: string) => Promise<WorldRevision>;
    readonly snapshot: (binding: WorkspaceBinding) => Promise<WorldRevision>;
    readonly verifyCustody: (custodyId: string) => Promise<WorldVerification>;
    readonly verifyRevision: (revisionId: string) => Promise<WorldVerification>;
};
```

### `ReferenceCopyCarrierOptions`

Classification: `type-only`. Kind: `type alias`.

Closed options accepted by createReferenceCopyCarrier.

Signature:

```ts
export type ReferenceCopyCarrierOptions = {
    readonly faultInjection?: WorkspaceCustodyFaultInjection;
    readonly workspaceRoot: string;
};
```

### `ReleaseRetainedWorldSettlementOptions`

Classification: `type-only`. Kind: `type alias`.

Closed authorities for exact-ID receipt-only release and recovery.

Signature:

```ts
export type ReleaseRetainedWorldSettlementOptions = {
    readonly binding: WorkspaceBinding;
    readonly carrier: ReferenceCopyCarrier;
    readonly outputId: string;
    readonly store: SQLiteTraceStore;
};
```

### `ReleasedRetainedWorldSettlement`

Classification: `type-only`. Kind: `type alias`.

Durable receipt-only release result preserving the existing retained custody.

Signature:

```ts
export type ReleasedRetainedWorldSettlement = {
    readonly action: (typeof RETAINED_WORLD_SETTLEMENT_ACTIONS)[3];
    readonly base_revision_id: string;
    readonly binding_id: string;
    readonly changeset_id: string;
    readonly compatibility_version: typeof RETAINED_WORLD_RELEASE_COMPATIBILITY_VERSION;
    readonly custody_id: string;
    readonly head_revision_id: string;
    readonly operation_id: string;
    readonly output_id: string;
    readonly request_id: string;
    readonly release_receipt_version: typeof RETAINED_WORLD_RELEASE_RECEIPT_VERSION;
    readonly settlement_version: typeof RETAINED_WORLD_SETTLEMENT_VERSION;
    readonly state: (typeof RETAINED_WORLD_SETTLEMENT_STATES)[5];
    readonly user_basis_after: string;
    readonly user_basis_before: string;
};
```

### `RepositoryGrantAtom`

Classification: `type-only`. Kind: `type alias`.

One configured repository authority atom.

Signature:

```ts
export type RepositoryGrantAtom = (typeof REPOSITORY_GRANT_ATOMS)[number];
```

### `RepositoryGrantProfile`

Classification: `type-only`. Kind: `type alias`.

One configured whole-repository authority profile.

Signature:

```ts
export type RepositoryGrantProfile = (typeof REPOSITORY_GRANT_PROFILES)[number];
```

### `RepositoryGrantedTask`

Classification: `type-only`. Kind: `type alias`.

Authenticated task plus its immutable explicit repository grant surface.

Signature:

```ts
export type RepositoryGrantedTask<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>> = {
    readonly artifact: RepositoryTaskGrantArtifact;
    readonly artifactLock: RepositoryTaskGrantArtifactLock;
    readonly grants: readonly RepositoryTaskGrantDefinition[];
    readonly task: TaskDescriptor<I, O>;
};
```

### `RepositoryTaskGrantArtifact`

Classification: `type-only`. Kind: `type alias`.

Canonical identity-bearing task repository-grant artifact.

Signature:

```ts
export type RepositoryTaskGrantArtifact = {
    readonly compatibility_version: string;
    readonly grant_version: number;
    readonly grants: readonly {
        readonly binding: string;
        readonly profile: RepositoryGrantProfile;
    }[];
    readonly task_artifact_digest: string;
};
```

### `RepositoryTaskGrantArtifactLock`

Classification: `type-only`. Kind: `type alias`.

Exact content-addressed lock for one repository task-grant artifact.

Signature:

```ts
export type RepositoryTaskGrantArtifactLock = {
    readonly artifact_digest: string;
    readonly grant_version: number;
    readonly task_artifact_digest: string;
    readonly task_grant_id: string;
};
```

### `RepositoryTaskGrantDefinition`

Classification: `type-only`. Kind: `type alias`.

One logical per-binding repository grant declared by a task.

Signature:

```ts
export type RepositoryTaskGrantDefinition = {
    readonly binding: string;
    readonly profile: RepositoryGrantProfile;
};
```

### `ResolvedPlacement`

Classification: `type-only`. Kind: `type alias`.

One configured effective placement implemented by the current runtime.

Signature:

```ts
export type ResolvedPlacement = (typeof RESOLVED_PLACEMENTS)[number];
```

### `RetainedWorldApplicationConflict`

Classification: `type-only`. Kind: `type alias`.

One exact candidate/current path pair that prevents three-way application.

Signature:

```ts
export type RetainedWorldApplicationConflict = {
    readonly candidate_path: string;
    readonly current_path: string;
    readonly kind: RetainedWorldApplicationConflictKind;
};
```

### `RetainedWorldApplicationConflictError`

Classification: `runtime-and-type`. Kind: `class`.

Raised when retained and current path effects are not provably disjoint.

Signature:

```ts
export declare class RetainedWorldApplicationConflictError extends Error {
    readonly code: string;
    readonly evidence: RetainedWorldApplicationConflictEvidence;
    constructor(evidence: RetainedWorldApplicationConflictEvidence);
}
```

#### `code`

Stable machine-readable application-conflict code.

```ts
readonly code: string;
```

#### `evidence`

Exact immutable path-overlap evidence.

```ts
readonly evidence: RetainedWorldApplicationConflictEvidence;
```

#### `constructor`

Creates one fail-closed retained-world application conflict.

```ts
constructor(evidence: RetainedWorldApplicationConflictEvidence);
```

Parameter:

- evidence - Exact content-addressed overlap evidence.

### `RetainedWorldApplicationConflictEvidence`

Classification: `type-only`. Kind: `type alias`.

Immutable content-addressed evidence explaining one fail-closed application refusal.

Signature:

```ts
export type RetainedWorldApplicationConflictEvidence = {
    readonly compatibility_version: string;
    readonly conflicts: readonly RetainedWorldApplicationConflict[];
    readonly conflict_id: string;
    readonly conflict_version: number;
};
```

### `RetainedWorldApplicationConflictKind`

Classification: `type-only`. Kind: `type alias`.

One configured retained-world application conflict classification.

Signature:

```ts
export type RetainedWorldApplicationConflictKind = (typeof RETAINED_WORLD_APPLICATION_CONFLICT_KINDS)[number];
```

### `RetainedWorldApplicationPlanEvidence`

Classification: `type-only`. Kind: `type alias`.

Content-addressed three-way application plan retained before user-tree mutation.

Signature:

```ts
export type RetainedWorldApplicationPlanEvidence = {
    readonly application_custody_id: string;
    readonly application_version: number;
    readonly compatibility_version: string;
    readonly base_content_id: string;
    readonly base_revision_id: string;
    readonly binding_id: string;
    readonly candidate_changeset_id: string;
    readonly candidate_content_id: string;
    readonly candidate_paths: readonly string[];
    readonly candidate_revision_id: string;
    readonly current_changeset_id: string;
    readonly current_content_id: string;
    readonly current_paths: readonly string[];
    readonly current_revision_id: string;
    readonly merged_content_id: string;
    readonly merged_revision_id: string;
    readonly plan_id: string;
    readonly publication_changeset_id: string;
    readonly reason: (typeof RETAINED_WORLD_APPLICATION_REASONS)[number];
    readonly request_id: string;
    readonly status: (typeof RETAINED_WORLD_APPLICATION_STATUSES)[number];
};
```

### `RetainedWorldCapability`

Classification: `type-only`. Kind: `type alias`.

Fenced retained-world authority issued only for one runner invocation.

Signature:

```ts
export type RetainedWorldCapability = {
    readonly base_revision_id: string;
    readonly binding_id: string;
    readonly capture_fence: number;
    readonly custody_id: string;
    readonly enforcement: RetainedWorldEnforcement;
    readonly readText: (relativePath: string) => Promise<string>;
    readonly writeText: (relativePath: string, text: string) => Promise<void>;
};
```

### `RetainedWorldEnforcement`

Classification: `type-only`. Kind: `type alias`.

Configured enforcement classification claimed by a retained-world runner.

Signature:

```ts
export type RetainedWorldEnforcement = (typeof RETAINED_WORLD_ENFORCEMENT_KINDS)[number];
```

### `RetainedWorldExecutionContext`

Classification: `type-only`. Kind: `type alias`.

Frozen context supplied to one authenticated retained-world runner invocation.

Signature:

```ts
export type RetainedWorldExecutionContext<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>> = {
    readonly capture_fence: number;
    readonly execution: TaskExecutionOptions<I, O>;
    readonly signal: AbortSignal;
    readonly world: RetainedWorldCapability;
};
```

### `RetainedWorldOutput`

Classification: `type-only`. Kind: `type alias`.

Verified immutable world attachment retained inside one terminal execution cut.

Signature:

```ts
export type RetainedWorldOutput = {
    readonly base_revision_id: string;
    readonly binding_id: string;
    readonly capture_id: string;
    readonly capture_record_id: string;
    readonly custody_id: string;
    readonly changeset_id: string;
    readonly execution_cut: Cut;
    readonly execution_outcome_record_id: string;
    readonly head_revision_id: string;
    readonly output_id: string;
    readonly run_id: string;
    readonly schema_version: number;
    readonly status: (typeof RETAINED_WORLD_OUTPUT_STATUSES)[0];
    readonly user_basis_after: string;
    readonly user_basis_before: string;
};
```

### `RetainedWorldRunner`

Classification: `type-only`. Kind: `type alias`.

Opaque registered handle for one retained-world runner adapter.

Signature:

```ts
export type RetainedWorldRunner<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>> = {
    readonly enforcement: RetainedWorldEnforcement;
    readonly runner_id: string;
    readonly runner_version: number;
    readonly [retainedWorldRunnerContract]?: (context: RetainedWorldExecutionContext<I, O>) => Promise<TaskExecutionResult>;
};
```

### `RetainedWorldRunnerDefinition`

Classification: `type-only`. Kind: `type alias`.

Closed callback definition accepted by createRetainedWorldRunner.

Signature:

```ts
export type RetainedWorldRunnerDefinition<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>> = {
    readonly enforcement: RetainedWorldEnforcement;
    readonly run: (context: RetainedWorldExecutionContext<I, O>) => Promise<TaskExecutionResult>;
    readonly runnerId: string;
};
```

### `RetainedWorldSettlementAdmission`

Classification: `type-only`. Kind: `type alias`.

Durable prepared consume-once settlement decision returned by trace-store admission.

Signature:

```ts
export type RetainedWorldSettlementAdmission = {
    readonly action: (typeof RETAINED_WORLD_SETTLEMENT_ACTIONS)[number];
    readonly command_id: string;
    readonly output_id: string;
    readonly request_id: string;
    readonly request: RetainedWorldSettlementRequest;
    readonly state: (typeof RETAINED_WORLD_SETTLEMENT_STATES)[0];
};
```

### `RetainedWorldSettlementConflictError`

Classification: `runtime-and-type`. Kind: `class`.

Raised when an exact retained-world settlement request conflicts with durable authority.

Signature:

```ts
export declare class RetainedWorldSettlementConflictError extends TraceStoreError {
    readonly code: string;
}
```

#### `code`

Stable configured settlement-conflict code.

```ts
readonly code: string;
```

### `RetainedWorldSettlementInvalidError`

Classification: `runtime-and-type`. Kind: `class`.

Raised when retained-world settlement evidence is malformed or inconsistent.

Signature:

```ts
export declare class RetainedWorldSettlementInvalidError extends TraceStoreError {
    readonly code: string;
}
```

#### `code`

Stable configured invalid-settlement code.

```ts
readonly code: string;
```

### `RetainedWorldSettlementRequest`

Classification: `type-only`. Kind: `type alias`.

Closed exact identity presented to consume-once retained-world settlement admission.

Signature:

```ts
export type RetainedWorldSettlementRequest = {
    readonly action: (typeof RETAINED_WORLD_SETTLEMENT_ACTIONS)[number];
    readonly base_revision_id: string;
    readonly binding_id: string;
    readonly capture_record_id: string;
    readonly changeset_id: string;
    readonly command_id: string;
    readonly custody_id: string;
    readonly execution_cut_id: string;
    readonly head_revision_id: string;
    readonly output_id: string;
    readonly run_id: string;
    readonly settlement_version: number;
    readonly user_basis_before: string;
};
```

### `SelectRetainedWorldSettlementOptions`

Classification: `type-only`. Kind: `type alias`.

Closed authorities for exact-ID retained-world selection and recovery.

Signature:

```ts
export type SelectRetainedWorldSettlementOptions = {
    readonly binding: WorkspaceBinding;
    readonly carrier: ReferenceCopyCarrier;
    readonly outputId: string;
    readonly store: SQLiteTraceStore;
};
```

### `SelectedRetainedWorldSettlement`

Classification: `type-only`. Kind: `type alias`.

Completed durable selection result after authenticated carrier publication.

Signature:

```ts
export type SelectedRetainedWorldSettlement = {
    readonly action: (typeof RETAINED_WORLD_SETTLEMENT_ACTIONS)[0];
    readonly operation_id: string;
    readonly output_id: string;
    readonly publication_id: string;
    readonly request_id: string;
    readonly settlement_version: typeof RETAINED_WORLD_SETTLEMENT_VERSION;
    readonly state: (typeof RETAINED_WORLD_SETTLEMENT_STATES)[2];
    readonly user_basis_after: string;
};
```

### `TaskWorldCaptureJournalInspection`

Classification: `type-only`. Kind: `type alias`.

Restart-safe read projection of one durable task-world capture journal.

Signature:

```ts
export type TaskWorldCaptureJournalInspection = {
    readonly capture_id: string | null;
    readonly output_record_id: RecordId | null;
    readonly recovery_status: (typeof DURABLE_EXECUTION_RECOVERY_STATUSES)[number];
    readonly run_id: string;
    readonly status: TaskWorldCaptureJournalStatus;
    readonly transitions: readonly TaskWorldCaptureJournalTransition[];
};
```

### `TaskWorldCaptureJournalStatus`

Classification: `type-only`. Kind: `type alias`.

Durable task-world journal phase or its absent/retained projection.

Signature:

```ts
export type TaskWorldCaptureJournalStatus = (typeof DURABLE_EXECUTION_RECOVERY_STATUSES)[0] | (typeof RETAINED_WORLD_JOURNAL_PHASES)[number] | (typeof RETAINED_WORLD_OUTPUT_STATUSES)[0];
```

### `TaskWorldCaptureJournalTransition`

Classification: `type-only`. Kind: `type alias`.

One validated immutable capture-journal transition.

Signature:

```ts
export type TaskWorldCaptureJournalTransition = {
    readonly body: SemanticRecord;
    readonly phase: (typeof RETAINED_WORLD_JOURNAL_PHASES)[number];
    readonly record_id: RecordId;
};
```

### `TaskWorldCaptureResult`

Classification: `type-only`. Kind: `type alias`.

Durable task result paired with its exact retained world attachment.

Signature:

```ts
export type TaskWorldCaptureResult = DurableTaskExecutionResult & {
    readonly changeset: WorldChangeset;
    readonly output: RetainedWorldOutput;
};
```

### `WorkspaceAdoption`

Classification: `type-only`. Kind: `type alias`.

Immutable baseline citation retained by workspace control metadata.

Signature:

```ts
export type WorkspaceAdoption = {
    readonly baseline_ref: string | null;
    readonly git_head: string | null;
    readonly mode: WorkspaceAdoptionMode;
};
```

### `WorkspaceAdoptionMode`

Classification: `type-only`. Kind: `type alias`.

Configured baseline-adoption mode used when initializing a workspace.

Signature:

```ts
export type WorkspaceAdoptionMode = (typeof WORKSPACE_ADOPTION_MODES)[number];
```

### `WorkspaceBinding`

Classification: `type-only`. Kind: `type alias`.

Frozen canonical authority for one disjoint workspace root.

Signature:

```ts
export type WorkspaceBinding = {
    readonly binding_id: string;
    readonly canonical_root: string;
    readonly name: string;
    readonly requested_root: string;
};
```

### `WorkspaceBindingDefinition`

Classification: `type-only`. Kind: `type alias`.

One logical root proposed for canonical workspace authority.

Signature:

```ts
export type WorkspaceBindingDefinition = {
    readonly name: string;
    readonly root: string;
};
```

### `WorkspaceBindingError`

Classification: `runtime-and-type`. Kind: `class`.

Raised when a proposed workspace binding cannot establish unambiguous canonical authority.

Signature:

```ts
export declare class WorkspaceBindingError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
```

#### `code`

Stable machine-readable binding-validation error code.

```ts
readonly code: string;
```

#### `constructor`

Creates a workspace-binding validation failure.

```ts
constructor(code: string, message: string);
```

Parameter:

- code - Configured machine-readable failure code.

Parameter:

- message - Configured diagnostic for the rejected binding set.

### `WorkspaceBindingOptions`

Classification: `type-only`. Kind: `type alias`.

Closed options accepted by createWorkspaceBindings.

Signature:

```ts
export type WorkspaceBindingOptions = {
    readonly bindings: readonly WorkspaceBindingDefinition[];
    readonly workspaceRoot: string;
};
```

### `WorkspaceBindingSet`

Classification: `type-only`. Kind: `type alias`.

Frozen complete binding authority set for one initialized workspace.

Signature:

```ts
export type WorkspaceBindingSet = {
    readonly binding_version: number;
    readonly bindings: readonly WorkspaceBinding[];
    readonly workspace_root: string;
};
```

### `WorkspaceControlError`

Classification: `runtime-and-type`. Kind: `class`.

Raised when workspace control state is missing, unsafe, malformed, or inconsistent.

Signature:

```ts
export declare class WorkspaceControlError extends Error {
    readonly code: string;
    constructor(message?: string);
}
```

#### `code`

Stable machine-readable workspace-control error code.

```ts
readonly code: string;
```

#### `constructor`

Creates a workspace-control validation failure.

```ts
constructor(message?: string);
```

Parameter:

- message - Diagnostic describing the rejected control state.

### `WorkspaceCustodyFaultError`

Classification: `runtime-and-type`. Kind: `class`.

Raised when a configured custody boundary fails with stable recovery evidence.

Signature:

```ts
export declare class WorkspaceCustodyFaultError extends WorldCarrierError {
    readonly evidence: WorkspaceCustodyFaultEvidence;
    constructor(code: string, message: string, evidence: WorkspaceCustodyFaultEvidence);
}
```

#### `evidence`

Frozen precise fault and recovery evidence.

```ts
readonly evidence: WorkspaceCustodyFaultEvidence;
```

#### `constructor`

Creates a configured custody fault.

```ts
constructor(code: string, message: string, evidence: WorkspaceCustodyFaultEvidence);
```

Parameter:

- code - Stable configured machine-readable fault code.

Parameter:

- message - Stable configured diagnostic.

Parameter:

- evidence - Exact configured phase, classification, and recovery evidence.

### `WorkspaceCustodyFaultEvidence`

Classification: `type-only`. Kind: `type alias`.

Stable public evidence attached to a custody fault.

Signature:

```ts
export type WorkspaceCustodyFaultEvidence = {
    readonly classification: string;
    readonly metadata_kind: string | null;
    readonly phase: string;
    readonly recovery: string;
    readonly system_code: string | null;
    readonly version: number;
};
```

### `WorkspaceCustodyFaultInjection`

Classification: `type-only`. Kind: `type alias`.

Declarative deterministic fault injected at one configured custody boundary.

Signature:

```ts
export type WorkspaceCustodyFaultInjection = {
    readonly classification: string;
    readonly phase: string;
    readonly systemCode: string | null;
};
```

### `WorkspaceGitPlatformPolicy`

Classification: `type-only`. Kind: `type alias`.

Frozen Git-specific platform custody policy.

Signature:

```ts
export type WorkspaceGitPlatformPolicy = {
    readonly core_symlinks_false: string;
    readonly gitlinks: string;
    readonly sparse_index: string;
};
```

### `WorkspaceGitState`

Classification: `type-only`. Kind: `type alias`.

Immutable current Git context observed while opening workspace control state.

Signature:

```ts
export type WorkspaceGitState = {
    readonly head: string | null;
    readonly repository_root: string | null;
};
```

### `WorkspaceInitializationConflictError`

Classification: `runtime-and-type`. Kind: `class`.

Raised when repeated initialization requests different retained control options.

Signature:

```ts
export declare class WorkspaceInitializationConflictError extends Error {
    readonly code: string;
    constructor(message?: string);
}
```

#### `code`

Stable machine-readable initialization-conflict error code.

```ts
readonly code: string;
```

#### `constructor`

Creates a conflicting workspace-initialization failure.

```ts
constructor(message?: string);
```

Parameter:

- message - Diagnostic describing the conflicting option.

### `WorkspaceInitializationOptions`

Classification: `type-only`. Kind: `type alias`.

Closed options accepted by initializeWorkspace.

Signature:

```ts
export type WorkspaceInitializationOptions = {
    readonly adopt?: WorkspaceAdoptionMode;
    readonly initializeGit?: boolean;
    readonly rootPath: string;
};
```

### `WorkspacePathProtectionOptions`

Classification: `type-only`. Kind: `type alias`.

Closed input used to inspect one binding-relative workspace path.

Signature:

```ts
export type WorkspacePathProtectionOptions = {
    readonly bindingRoot: string;
    readonly path: string;
    readonly workspaceRoot: string;
};
```

### `WorkspacePathProtectionValidation`

Classification: `type-only`. Kind: `type alias`.

Versioned result of configured protected workspace-path validation.

Signature:

```ts
export type WorkspacePathProtectionValidation = {
    readonly path: string;
    readonly protected: boolean;
    readonly protected_root: string | null;
    readonly validation_version: number;
};
```

### `WorkspacePlatformConformance`

Classification: `type-only`. Kind: `type alias`.

Frozen configured platform policy for retained workspace custody.

Signature:

```ts
export type WorkspacePlatformConformance = {
    readonly case_collision_policy: string;
    readonly git: WorkspaceGitPlatformPolicy;
    readonly metadata_policy: string;
    readonly mode_policy: string;
    readonly optimized_carrier_parity: string;
    readonly platform: NodeJS.Platform;
    readonly symlink_policy: string;
    readonly unsupported_metadata: readonly string[];
    readonly version: number;
};
```

### `WorkspacePlatformConformanceOptions`

Classification: `type-only`. Kind: `type alias`.

Closed options accepted by inspectWorkspacePlatformConformance.

Signature:

```ts
export type WorkspacePlatformConformanceOptions = {
    readonly workspaceRoot: string;
};
```

### `WorkspaceProtectedPathError`

Classification: `runtime-and-type`. Kind: `class`.

Raised before a retained-world operation can inspect or mutate a protected control path.

Signature:

```ts
export declare class WorkspaceProtectedPathError extends WorldCarrierError {
    readonly validation: WorkspacePathProtectionValidation;
    constructor(validation: WorkspacePathProtectionValidation);
}
```

#### `validation`

Versioned validation result describing the rejected path.

```ts
readonly validation: WorkspacePathProtectionValidation;
```

#### `constructor`

Creates a configured protected-path rejection.

```ts
constructor(validation: WorkspacePathProtectionValidation);
```

Parameter:

- validation - Versioned validation result for the protected candidate.

### `WorkspaceRepositoryBindingEvidence`

Classification: `type-only`. Kind: `type alias`.

Read-only Git authority observed for one exact repository binding root.

Signature:

```ts
export type WorkspaceRepositoryBindingEvidence = {
    readonly common_dir: string;
    readonly common_dir_identity: string;
    readonly git_dir: string;
    readonly git_dir_identity: string;
    readonly object_format: string;
    readonly repository_id: string;
    readonly root: string;
};
```

### `WorkspaceState`

Classification: `type-only`. Kind: `type alias`.

Frozen validated workspace initialization state.

Signature:

```ts
export type WorkspaceState = {
    readonly adoption: WorkspaceAdoption;
    readonly control_path: string;
    readonly format: string;
    readonly format_version: number;
    readonly git: WorkspaceGitState;
    readonly initialize_git: boolean;
    readonly root_path: string;
};
```

### `WorldCarrierError`

Classification: `runtime-and-type`. Kind: `class`.

Raised when copy-carrier custody or its retained evidence is unavailable or invalid.

Signature:

```ts
export declare class WorldCarrierError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
```

#### `code`

Stable machine-readable carrier failure code.

```ts
readonly code: string;
```

#### `constructor`

Creates a reference copy-carrier failure.

```ts
constructor(code: string, message: string);
```

Parameter:

- code - Configured machine-readable failure code.

Parameter:

- message - Diagnostic describing the rejected operation or evidence.

### `WorldChangeNode`

Classification: `type-only`. Kind: `type alias`.

Closed semantic state of one path in a world revision.

Signature:

```ts
export type WorldChangeNode = {
    readonly kind: (typeof WORLD_ENTRY_KINDS)[0];
    readonly mode: number;
} | {
    readonly byte_length: number;
    readonly content_id: string;
    readonly kind: (typeof WORLD_ENTRY_KINDS)[1];
    readonly mode: number;
} | {
    readonly kind: (typeof WORLD_ENTRY_KINDS)[2];
    readonly mode: null;
    readonly target: string;
};
```

### `WorldChangeOperation`

Classification: `type-only`. Kind: `type alias`.

Configured semantic operation for one canonical changed path.

Signature:

```ts
export type WorldChangeOperation = (typeof WORLD_CHANGE_OPERATIONS)[number];
```

### `WorldChangeset`

Classification: `type-only`. Kind: `type alias`.

Immutable content-addressed comparison of two ordered world revisions.

Signature:

```ts
export type WorldChangeset = {
    readonly base_revision_id: string;
    readonly binding_id: string;
    readonly changes: readonly WorldPathChange[];
    readonly changeset_id: string;
    readonly changed_paths: readonly string[];
    readonly head_revision_id: string;
    readonly schema_version: number;
};
```

### `WorldChangesetError`

Classification: `runtime-and-type`. Kind: `class`.

Raised when a pure world changeset cannot be constructed safely and exactly.

Signature:

```ts
export declare class WorldChangesetError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
```

#### `code`

Stable machine-readable changeset failure code.

```ts
readonly code: string;
```

#### `constructor`

Creates a world-changeset validation failure.

```ts
constructor(code: string, message: string);
```

Parameter:

- code - Configured machine-readable failure code.

Parameter:

- message - Diagnostic describing the rejected comparison.

### `WorldChangesetInspection`

Classification: `type-only`. Kind: `type alias`.

Authenticated read-only projection over one retained world changeset.

Signature:

```ts
export type WorldChangesetInspection = {
    readonly changeset: WorldChangeset;
    readonly inspection_version: number;
    readonly change: (path: string) => WorldPathChange | null;
    readonly derivedMoves: () => readonly WorldDerivedMove[];
    readonly page: (options?: WorldChangesetPageOptions) => WorldChangesetPage;
    readonly readContent: (options: WorldContentReadOptions) => Promise<WorldContentRead>;
    readonly previewText: (options: WorldTextPreviewOptions) => Promise<WorldTextPreview>;
};
```

### `WorldChangesetInspectionOptions`

Classification: `type-only`. Kind: `type alias`.

Closed options accepted by createWorldChangesetInspection.

Signature:

```ts
export type WorldChangesetInspectionOptions = WorldChangesetOptions;
```

### `WorldChangesetOptions`

Classification: `type-only`. Kind: `type alias`.

Closed options accepted by createWorldChangeset.

Signature:

```ts
export type WorldChangesetOptions = {
    readonly baseRevision: WorldRevision;
    readonly carrier: ReferenceCopyCarrier;
    readonly headRevision: WorldRevision;
};
```

### `WorldChangesetPage`

Classification: `type-only`. Kind: `type alias`.

One immutable bounded page of canonical world changes.

Signature:

```ts
export type WorldChangesetPage = {
    readonly changes: readonly WorldPathChange[];
    readonly next_offset: number | null;
    readonly offset: number;
    readonly total: number;
};
```

### `WorldChangesetPageOptions`

Classification: `type-only`. Kind: `type alias`.

Closed bounded pagination options for canonical world changes.

Signature:

```ts
export type WorldChangesetPageOptions = {
    readonly limit?: number;
    readonly offset?: number;
};
```

### `WorldContentRead`

Classification: `type-only`. Kind: `type alias`.

One authenticated bounded retained-content byte slice.

Signature:

```ts
export type WorldContentRead = {
    readonly bytes: Uint8Array;
    readonly content_id: string;
    readonly offset: number;
    readonly total_bytes: number;
    readonly truncated: boolean;
};
```

### `WorldContentReadOptions`

Classification: `type-only`. Kind: `type alias`.

Closed bounded options for reading authenticated retained content.

Signature:

```ts
export type WorldContentReadOptions = {
    readonly contentId: string;
    readonly length?: number;
    readonly offset?: number;
};
```

### `WorldCustody`

Classification: `type-only`. Kind: `type alias`.

Mutable retained checkout forked from an immutable copy-world revision.

Signature:

```ts
export type WorldCustody = {
    readonly backend: string;
    readonly base_content_id: string;
    readonly base_revision_id: string;
    readonly binding_id: string;
    readonly custody_id: string;
    readonly descriptor_version: number;
    readonly path: string;
};
```

### `WorldDerivedMove`

Classification: `type-only`. Kind: `type alias`.

One deterministic exact-content move projection outside canonical changeset identity.

Signature:

```ts
export type WorldDerivedMove = {
    readonly content_id: string;
    readonly kind: (typeof WORLD_DERIVED_MOVE_KINDS)[number];
    readonly source_path: string;
    readonly target_path: string;
};
```

### `WorldEntryKind`

Classification: `type-only`. Kind: `type alias`.

Configured logical entry kind represented by a copy-carrier manifest.

Signature:

```ts
export type WorldEntryKind = (typeof WORLD_ENTRY_KINDS)[number];
```

### `WorldManifestEntry`

Classification: `type-only`. Kind: `type alias`.

One canonical logical filesystem entry retained by the reference carrier.

Signature:

```ts
export type WorldManifestEntry = {
    readonly blob_id: string | null;
    readonly kind: WorldEntryKind;
    readonly mode: number | null;
    readonly path: string;
    readonly size: number | null;
    readonly symlink_target: string | null;
};
```

### `WorldPathChange`

Classification: `type-only`. Kind: `type alias`.

One canonical reconstructive path change between two exact world revisions.

Signature:

```ts
export type WorldPathChange = {
    readonly after: WorldChangeNode | null;
    readonly before: WorldChangeNode | null;
    readonly operation: WorldChangeOperation;
    readonly path: string;
};
```

### `WorldRevision`

Classification: `type-only`. Kind: `type alias`.

Immutable verified copy-world revision retained under carrier custody.

Signature:

```ts
export type WorldRevision = {
    readonly backend: string;
    readonly binding_id: string;
    readonly basis_ref: string | null;
    readonly capture_kind: string;
    readonly content_id: string;
    readonly descriptor_version: number;
    readonly manifest: readonly WorldManifestEntry[];
    readonly path: string;
    readonly parent_revision_id: string | null;
    readonly revision_id: string;
};
```

### `WorldTextPreview`

Classification: `type-only`. Kind: `type alias`.

One authenticated bounded text or binary classification.

Signature:

```ts
export type WorldTextPreview = {
    readonly byte_length: number;
    readonly classification: (typeof WORLD_TEXT_PREVIEW_CLASSIFICATIONS)[0];
    readonly content_id: string;
    readonly encoding: typeof WORLD_TEXT_PREVIEW_ENCODING;
    readonly text: string;
    readonly truncated: boolean;
} | {
    readonly byte_length: number;
    readonly classification: (typeof WORLD_TEXT_PREVIEW_CLASSIFICATIONS)[1];
    readonly content_id: string;
    readonly encoding: null;
    readonly text: null;
    readonly truncated: boolean;
};
```

### `WorldTextPreviewOptions`

Classification: `type-only`. Kind: `type alias`.

Closed bounded options for an authenticated retained text preview.

Signature:

```ts
export type WorldTextPreviewOptions = {
    readonly contentId: string;
    readonly maxBytes?: number;
    readonly maxLines?: number;
};
```

### `WorldVerification`

Classification: `type-only`. Kind: `type alias`.

Structured verification evidence for a retained revision or mutable custody.

Signature:

```ts
export type WorldVerification = {
    readonly content_id: string;
    readonly modified: boolean;
    readonly manifest: readonly WorldManifestEntry[];
};
```

### `applyRetainedWorldSettlement`

Classification: `runtime-only`. Kind: `function`.

Durably applies one exact admitted retained output and recovers interrupted publication.

On an unchanged user basis this degenerates to the candidate head while retaining a distinct
applied settlement. On an advanced basis it requires path-disjoint deltas, constructs one exact
merged revision from current plus candidate changes, and publishes that revision recoverably.

Signature:

```ts
export declare function applyRetainedWorldSettlement(options: ApplyRetainedWorldSettlementOptions): Promise<AppliedRetainedWorldSettlement>;
```

Parameter:

- options - Exact output identity plus canonical binding, carrier, and trace-store authority.

Returns:

- Frozen applied result citing the exact carrier publication and applied revision.

Throws:

- {RetainedWorldSettlementInvalidError} If trace, revision, basis, carrier, or publication
evidence is absent, moved, malformed, forged, or inconsistent.

Throws:

- {RetainedWorldSettlementConflictError} If another action owns the admission or terminal.

Example:

- ```ts
const applied = await applyRetainedWorldSettlement({
    binding,
    carrier,
    outputId: captured.output.output_id,
    store,
});
applied.applied_revision_id;
```

### `captureGrantedTaskWorldDurably`

Classification: `runtime-only`. Kind: `function`.

Executes one retained-world task under an authenticated exact repository grant plan.

Admission authenticates every resource in the plan before runner or provider invocation. The
active capability exposes only the intersection of the task grant and whole-run ceiling.
Enforcement is in-process advisory; this function does not claim an OS sandbox or syscall jail.

Signature:

```ts
export declare function captureGrantedTaskWorldDurably<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>>(options: CaptureGrantedTaskWorldOptions<I, O>): Promise<TaskWorldCaptureResult>;
```

Parameter:

- options - Exact granted task-world capture contract.

Returns:

- Durable task result, canonical changeset, and retained world attachment.

Throws:

- {TypeError} If the plan, task, resource, authority, or options are invalid.

Throws:

- {TraceStoreError} If durable execution or terminal publication fails closed.

Throws:

- {WorldCarrierError} If retained carrier evidence cannot be verified or captured.

Throws:

- {WorldChangesetError} If the captured comparison is invalid or exceeds limits.

Example:

- ```ts
const result = await captureGrantedTaskWorldDurably({
    ...captureOptions,
    repositoryGrantPlan,
});
```

### `captureJailedGrantedTaskWorldDurably`

Classification: `runtime-only`. Kind: `function`.

Executes one granted retained-world task through an authenticated native syscall jail.

The structured judged process runs before provider invocation. Its confinement plan is compiled
from the selected binding's exact effective write grant, and execution continues only after a
successful exit and proven process-group quiescence.

Signature:

```ts
export declare function captureJailedGrantedTaskWorldDurably<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>>(options: CaptureJailedGrantedTaskWorldOptions<I, O>): Promise<JailedTaskWorldCaptureResult>;
```

Parameter:

- options - Exact granted capture contract plus authenticated native-jail resolution.

Returns:

- Durable task-world result with exact native placement and process receipt.

Throws:

- {TypeError} If placement, grant, task, resource, runner, or options are inconsistent.

Throws:

- {NativeJailExecutionError} If launch, exit, cancellation, timeout, output, or quiescence fails.

Example:

- ```ts
const result = await captureJailedGrantedTaskWorldDurably({
    ...grantedCaptureOptions,
    nativeJailResolution,
    runner: nativeRunner,
});
result.process.quiescence;
```

### `capturePlacedGrantedTaskWorldDurably`

Classification: `runtime-only`. Kind: `function`.

Executes one granted retained-world task under exact requested/resolved placement evidence.

Signature:

```ts
export declare function capturePlacedGrantedTaskWorldDurably<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>>(options: CapturePlacedGrantedTaskWorldOptions<I, O>): Promise<PlacedTaskWorldCaptureResult>;
```

Parameter:

- options - Exact granted capture contract plus authenticated placement resolution.

Returns:

- Durable task, retained world, changeset, and immutable placement evidence.

Throws:

- {TypeError} If placement, grant, task, resource, runner, or options are inconsistent.

Throws:

- {TraceStoreError} If durable execution or terminal publication fails closed.

Throws:

- {WorldCarrierError} If retained carrier evidence cannot be verified or captured.

Throws:

- {WorldChangesetError} If the captured comparison is invalid or exceeds limits.

Example:

- ```ts
const result = await capturePlacedGrantedTaskWorldDurably({
    ...grantedCaptureOptions,
    placementResolution,
});
result.placement.resolved_placement;
```

### `captureTaskWorldDurably`

Classification: `runtime-only`. Kind: `function`.

Executes one registered runner against isolated custody and retains its verified world output.

Runner authentication, every filesystem operation, immutable capture, and terminal publication
share the existing durable invocation fence. The user binding is observed before and after but
never supplied as runner authority. The captured record commits atomically before the ordinary
outcome and lifecycle terminal and is therefore included in the same immutable cut.

Signature:

```ts
export declare function captureTaskWorldDurably<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>>(options: CaptureTaskWorldOptions<I, O>): Promise<TaskWorldCaptureResult>;
```

Parameter:

- options - Exact store, execution, binding, carrier, base, capture, and runner contract.

Returns:

- Durable task result, canonical changeset, and retained world attachment.

Throws:

- {TypeError} If authority, options, runner output, or relative paths are malformed.

Throws:

- {TraceStoreError} If durable execution or terminal publication fails closed.

Throws:

- {WorldCarrierError} If retained carrier evidence cannot be verified or captured.

Throws:

- {WorldChangesetError} If the captured comparison is invalid or exceeds limits.

Example:

- ```ts
const result = await captureTaskWorldDurably({
    baseRevision,
    binding,
    captureId: "capture:review:1",
    carrier,
    execution: { task, input, provider, runId: "run:review:1", budget: { maxTurns: 1 } },
    runner,
    store,
});
result.output.head_revision_id;
```

### `createGitAwareCustody`

Classification: `runtime-only`. Kind: `function`.

Creates workspace protocol v4 Git-aware baseline and retained-output custody.

Git inspection is read-only. Managed output is materialized under protected control storage and
delegated to the workspace protocol v3 copy carrier; ordinary refs, index, config, and files are
never mutated by this API.

Signature:

```ts
export declare function createGitAwareCustody(options: GitAwareCustodyOptions): GitAwareCustody;
```

Parameter:

- options - Exact initialized workspace owning Git-aware custody.

Returns:

- Frozen capture, reopen, verify, and discard operations.

Throws:

- {GitCustodyError} If repository or custody evidence is unavailable or unsafe.

Throws:

- {WorkspaceControlError} If workspace control state cannot be reopened.

Throws:

- {TypeError} If options are malformed.

### `createGitChangesetInspection`

Classification: `runtime-only`. Kind: `function`.

Opens an authenticated Git-aware changeset projection over two retained outputs.

The canonical copy-world changeset remains authoritative. Gitlink commit citations and retained
symbolic-link modes are read-only presentation evidence and never affect its identity.

Signature:

```ts
export declare function createGitChangesetInspection(options: GitChangesetInspectionOptions): Promise<GitChangesetInspection>;
```

Parameter:

- options - Exact retained Git custody identities and their initialized workspace.

Returns:

- Frozen canonical world inspection plus Git-aware presentation changes.

Throws:

- {WorldChangesetError} If retained carrier or Git evidence is unavailable or inconsistent.

Example:

- ```ts
const inspection = await createGitChangesetInspection({
  baseCustodyId,
  headCustodyId,
  workspaceRoot,
});
console.log(inspection.git_changes);
```

### `createGitRepositoryBindings`

Classification: `runtime-only`. Kind: `function`.

Creates stable repository-aware authorities for a complete disjoint binding set.

Each root must be the exact top level of one supported non-bare Git worktree. Repositories are
inspected through read-only Git plumbing, and linked worktrees sharing one common repository
cannot be returned as distinct repository authorities in the same set.

Signature:

```ts
export declare function createGitRepositoryBindings(options: WorkspaceBindingOptions): GitRepositoryBindingSet;
```

Parameter:

- options - Initialized workspace and complete proposed repository binding set.

Returns:

- Frozen ordered repository-backed authorities with stable resource identities.

Throws:

- {WorkspaceBindingError} If a root is not an exact supported repository or two bindings
identify the same common Git repository.

Throws:

- {WorkspaceControlError} If workspace control evidence cannot be opened safely.

Throws:

- {TypeError} If the options or binding definitions are malformed.

### `createGitRepositoryGrantPlan`

Classification: `runtime-only`. Kind: `function`.

Admits exact repository resources and applies a non-amplifying whole-run authority ceiling.

Signature:

```ts
export declare function createGitRepositoryGrantPlan<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>>(options: GitRepositoryGrantPlanOptions<I, O>): GitRepositoryGrantPlan;
```

Parameter:

- options - Authenticated granted task, complete repository binding set, and global ceiling.

Returns:

- Frozen authenticated grant plan bound to every exact repository resource identity.

Throws:

- {TypeError} If the definition is malformed, forged, incomplete, duplicated, or mismatched.

Example:

- ```ts
const plan = createGitRepositoryGrantPlan({
    authorityCeiling: "read-only",
    bindings: repositoryBindings.bindings,
    task: granted,
});
```

### `createGrantedPlacementResolution`

Classification: `runtime-only`. Kind: `function`.

Resolves one explicit placement request for an exact granted run and capture.

The current protocol can resolve only to advisory in-process execution. `auto` records its
fallback visibly, while explicit `jail` fails closed without returning resolution evidence.

Signature:

```ts
export declare function createGrantedPlacementResolution<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>>(options: GrantedPlacementResolutionOptions<I, O>): GrantedPlacementResolution;
```

Parameter:

- options - Exact request, platform, grant plan, runner, run, and capture contract.

Returns:

- Frozen content-addressed placement resolution.

Throws:

- {TypeError} If options or authenticated authorities are malformed or mismatched.

Throws:

- {PlacementUnavailableError} If the configured request cannot resolve without weakening
enforcement.

Example:

- ```ts
const placement = createGrantedPlacementResolution({
    captureId: "capture:review:1",
    placement: "auto",
    platform,
    repositoryGrantPlan,
    runId: "run:review:1",
    runner,
});
```

### `createNativeJailCommand`

Classification: `runtime-only`. Kind: `function`.

Creates one immutable structured native command without shell interpretation.

Signature:

```ts
export declare function createNativeJailCommand(definition: NativeJailCommandDefinition): NativeJailCommand;
```

Parameter:

- definition - Absolute executable, literal arguments, and explicit environment.

Returns:

- Frozen content-addressed command descriptor.

Throws:

- {TypeError} If the definition, executable, environment, or bounds are invalid.

### `createNativeJailPlacementResolution`

Classification: `runtime-only`. Kind: `function`.

Resolves an explicit `jail` or `auto` request to authenticated native enforcement.

This function accepts only a runner created from a successful real local backend probe. An
unavailable probe cannot produce a runner, so explicit jail fails before resolution or task
execution; callers may use the unchanged advisory resolver for a visible `auto` fallback.

Signature:

```ts
export declare function createNativeJailPlacementResolution<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>>(options: NativeJailPlacementResolutionOptions<I, O>): NativeJailPlacementResolution;
```

Parameter:

- options - Exact placement, platform, grant, runner, run, and capture contract.

Returns:

- Frozen content-addressed native-jail placement resolution.

Throws:

- {TypeError} If options or authenticated authorities are malformed or inconsistent.

Example:

- ```ts
const resolution = createNativeJailPlacementResolution({
    captureId: "capture:review:1",
    placement: "jail",
    platform: probe.platform,
    repositoryGrantPlan,
    runId: "run:review:1",
    runner,
});
```

### `createNativeJailRunner`

Classification: `runtime-only`. Kind: `function`.

Creates one opaque native-jail runner bound to a successful real local backend probe.

The judged command is an absolute executable plus literal argv and an explicit environment;
no shell is created and ambient environment variables are not inherited.

Signature:

```ts
export declare function createNativeJailRunner<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>>(definition: NativeJailRunnerDefinition): NativeJailRunner<I, O>;
```

Parameter:

- definition - Exact command, resource bounds, runner identity, and backend probe.

Returns:

- Opaque authenticated runner reporting native syscall denial.

Throws:

- {TypeError} If the definition, command, executable, or probe is malformed or forged.

Throws:

- {NativeJailUnavailableError} If the authenticated probe did not establish a jail.

Example:

- ```ts
const runner = createNativeJailRunner({
    command: { executable: "/usr/bin/true", arguments: [], environment: [] },
    maxOutputBytes: 65536,
    probe,
    runnerId: "runner:native:1",
    timeoutMilliseconds: 30000,
});
```

### `createPlacementPlatformEvidence`

Classification: `runtime-only`. Kind: `function`.

Classifies one explicit declared environment probe as immutable placement platform evidence.

The probe retains environment-variable names only, never their values. Input injection makes
native macOS, Linux, Windows, WSL, and unsupported classification deterministic in conformance
tests and suitable for future authenticated remote placement adapters. Local placed execution
accepts only evidence returned by inspectLocalPlacementPlatformEvidence.

Signature:

```ts
export declare function createPlacementPlatformEvidence(options: PlacementPlatformEvidenceOptions): PlacementPlatformEvidence;
```

Parameter:

- options - Exact Node platform, OS release, and present environment-variable names.

Returns:

- Frozen content-addressed platform evidence.

Throws:

- {TypeError} If options or probe values are malformed or ambiguous.

Example:

- ```ts
const platform = createPlacementPlatformEvidence({
    nodePlatform: process.platform,
    osRelease: release(),
    environmentVariables: Object.keys(process.env),
});
```

### `createReferenceCopyCarrier`

Classification: `runtime-only`. Kind: `function`.

Creates a workspace protocol v3 reference copy carrier.

The carrier retains immutable snapshots and isolated mutable forks exclusively beneath the
initialized workspace control root. It never mutates the source binding.

Signature:

```ts
export declare function createReferenceCopyCarrier(options: ReferenceCopyCarrierOptions): ReferenceCopyCarrier;
```

Parameter:

- options - Initialized workspace that owns the carrier control storage.

Returns:

- Frozen copy-carrier operations.

Throws:

- {WorldCarrierError} If carrier storage or retained evidence is unsafe or malformed.

Throws:

- {WorkspaceControlError} If workspace control state cannot be reopened.

Throws:

- {TypeError} If options are malformed.

### `createRetainedWorldRunner`

Classification: `runtime-only`. Kind: `function`.

Creates one opaque retained-world runner registration handle.

Construction validates a closed definition and retains the executable callback outside the
public handle. Task 6B.2 owns the first authority-consuming seam and forged-handle rejection.

Signature:

```ts
export declare function createRetainedWorldRunner<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>>(definition: RetainedWorldRunnerDefinition<I, O>): RetainedWorldRunner<I, O>;
```

Parameter:

- definition - Stable identity, actual enforcement, and asynchronous runner callback.

Returns:

- Frozen opaque runner registration handle for retained-world execution integration.

Throws:

- {TypeError} If the definition is open, malformed, or uses unsupported enforcement.

Example:

- ```ts
const runner = createRetainedWorldRunner({
    runnerId: "runner:local:1",
    enforcement: "advisory",
    run: async ({ execution }) => executeTask(execution),
});
```

### `createWorkspaceBindings`

Classification: `runtime-only`. Kind: `function`.

Creates workspace protocol v2 stable canonical authorities for a complete disjoint binding set.

Every root is resolved through the filesystem relative to the initialized workspace. Validation
finishes for the complete set before any authority is returned. This function does not create a
retained world or grant runtime access.

Signature:

```ts
export declare function createWorkspaceBindings(options: WorkspaceBindingOptions): WorkspaceBindingSet;
```

Parameter:

- options - Initialized workspace and complete proposed logical binding set.

Returns:

- Frozen ordered binding authorities with stable content-addressed identities.

Throws:

- {WorkspaceBindingError} If a name or root is invalid, escapes workspace authority, is
duplicated, or overlaps another canonical root.

Throws:

- {WorkspaceControlError} If workspace control evidence cannot be opened safely.

Throws:

- {TypeError} If the options or binding definitions are malformed.

### `createWorldChangeset`

Classification: `runtime-only`. Kind: `function`.

Constructs an immutable, content-addressed comparison of two verified world revisions.

The comparison reads only retained carrier custody, never the user workspace, and mutates
neither revision. Each change reconstructs the head manifest from the base manifest exactly.

Signature:

```ts
export declare function createWorldChangeset(options: WorldChangesetOptions): Promise<WorldChangeset>;
```

Parameter:

- options - Exact ordered base and head revisions for one binding.

Returns:

- A frozen canonical changeset with derived changed paths.

Throws:

- {WorldChangesetError} If either revision is malformed, inconsistent, cross-binding, or
exceeds configured changeset limits.

Example:

- ```ts
const changeset = await createWorldChangeset({ baseRevision, carrier, headRevision });
console.log(changeset.changed_paths);
```

### `createWorldChangesetInspection`

Classification: `runtime-only`. Kind: `function`.

Opens an authenticated read-only inspection of two retained world revisions.

Authentication uses the same carrier-owned revision verification as canonical changeset
creation. Lookup and pagination use the frozen projection; bounded content methods authenticate
exact retained blobs without consulting the user workspace.

Signature:

```ts
export declare function createWorldChangesetInspection(options: WorldChangesetInspectionOptions): Promise<WorldChangesetInspection>;
```

Parameter:

- options - Exact retained base/head revisions and their owning carrier.

Returns:

- A frozen inspection with lookup, pagination, content, preview, and move projections.

Throws:

- {WorldChangesetError} If revisions, carrier evidence, requests, or retained bytes fail.

Example:

- ```ts
const inspection = await createWorldChangesetInspection({
  baseRevision,
  carrier,
  headRevision,
});
console.log(inspection.change("src/index.ts"));
```

### `discardRetainedWorldSettlement`

Classification: `runtime-only`. Kind: `function`.

Durably discards one exact admitted retained output and recovers interrupted cleanup.

This is the workspace-protocol-v13 settlement-effect boundary over an exact v12 request.

The deterministic operation is retained before any carrier effect. The logical discarded
terminal receipt is retained before idempotent custody cleanup, so a restart can safely resume
either the pre-cleanup or post-cleanup prefix without reopening admission or touching user files.

Signature:

```ts
export declare function discardRetainedWorldSettlement(options: DiscardRetainedWorldSettlementOptions): Promise<DiscardedRetainedWorldSettlement>;
```

Parameter:

- options - Exact output identity plus authenticated carrier and trace-store authority.

Returns:

- Frozen completed discard receipt after durable cleanup completion.

Throws:

- {RetainedWorldSettlementInvalidError} If trace, journal, revision, custody, or carrier
evidence is absent, malformed, forged, or inconsistent.

Throws:

- {RetainedWorldSettlementConflictError} If the output was admitted for another action or
has already reached another terminal settlement.

Example:

- ```ts
const discarded = await discardRetainedWorldSettlement({
    carrier,
    outputId: captured.output.output_id,
    store,
});
discarded.cleanup_completed;
```

### `grantTaskRepositories`

Classification: `runtime-only`. Kind: `function`.

Binds an explicit canonical repository grant surface to one bodyless task artifact.

Existing task artifacts are not modified: this creates a separate versioned companion artifact
whose identity changes with the grant surface while preserving the exact underlying task digest.

Signature:

```ts
export declare function grantTaskRepositories<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>>(options: GrantTaskRepositoriesOptions<I, O>): RepositoryGrantedTask<I, O>;
```

Parameter:

- options - Exact authenticated task and complete per-binding grant declaration.

Returns:

- Frozen authenticated repository-granted task artifact.

Throws:

- {TypeError} If options, task, bindings, profiles, or duplicates are invalid.

Example:

- ```ts
const granted = grantTaskRepositories({
    task: descriptor,
    grants: [{ binding: "source", profile: "read-write" }],
});
```

### `initializeWorkspace`

Classification: `runtime-only`. Kind: `function`.

Initializes or exactly reuses workspace control state without modifying ordinary Git history.

The root must already exist. When authorized and no containing Git repository exists, this
function runs `git init` but never creates a commit, stages files, or rewrites refs. Adoption
records only the baseline citation needed by later carrier slices; it does not materialize a
retained world.

Signature:

```ts
export declare function initializeWorkspace(options: WorkspaceInitializationOptions): WorkspaceState;
```

Parameter:

- options - Closed initialization options and existing workspace root.

Returns:

- Frozen validated workspace state.

Throws:

- {WorkspaceControlError} If filesystem, Git, or retained control evidence is unsafe.

Throws:

- {WorkspaceInitializationConflictError} If retained options differ from this request.

Throws:

- {TypeError} If options are malformed.

### `inspectLocalNativeJailBackend`

Classification: `runtime-only`. Kind: `function`.

Probes the current host for a configured native syscall-jail backend.

An available result requires a real native canary: a write beneath the granted probe root must
land and a sibling write outside that root must be absent. Unsupported platforms and every
executable, profile, or launch failure return immutable unavailable evidence.

Signature:

```ts
export declare function inspectLocalNativeJailBackend(): Promise<NativeJailBackendProbeEvidence>;
```

Returns:

- Frozen content-addressed local backend probe evidence.

Example:

- ```ts
const probe = await inspectLocalNativeJailBackend();
if (probe.status !== "available") throw new Error(probe.reason);
```

### `inspectLocalPlacementPlatformEvidence`

Classification: `runtime-only`. Kind: `function`.

Inspects the current Node host and returns authenticated placement platform evidence.

Environment-variable values are never read or retained; only configured WSL marker names may
appear in the resulting evidence.

Signature:

```ts
export declare function inspectLocalPlacementPlatformEvidence(): PlacementPlatformEvidence;
```

Returns:

- Frozen content-addressed classification of the current execution host.

### `inspectRetainedWorldApplicationConflicts`

Classification: `runtime-only`. Kind: `function`.

Computes bounded portable equal/prefix/alias conflicts without granting apply authority.

Signature:

```ts
export declare function inspectRetainedWorldApplicationConflicts(options: InspectRetainedWorldApplicationConflictsOptions): RetainedWorldApplicationConflictEvidence | null;
```

Parameter:

- options - Exact canonical candidate and current changed-path sets.

Returns:

- Content-addressed conflict evidence, or `null` when the sets are disjoint.

Throws:

- {TypeError} If options or canonical path arrays are malformed or exceed limits.

### `inspectRetainedWorldApplicationPlan`

Classification: `runtime-only`. Kind: `function`.

Reads the exact durable three-way application plan without touching carrier or user files.

Signature:

```ts
export declare function inspectRetainedWorldApplicationPlan(store: SQLiteTraceStore, outputId: string): RetainedWorldApplicationPlanEvidence | undefined;
```

Parameter:

- store - Open trace store containing the settlement journal.

Parameter:

- outputId - Exact retained-output identity.

Returns:

- Authenticated application plan after planning, otherwise `undefined`.

Throws:

- {RetainedWorldSettlementInvalidError} If retained operation evidence is malformed.

Throws:

- {TypeError} If the output identity is malformed.

### `inspectRetainedWorldRelease`

Classification: `runtime-only`. Kind: `function`.

Reads one terminal receipt-only release without touching carrier or user files.

Signature:

```ts
export declare function inspectRetainedWorldRelease(store: SQLiteTraceStore, outputId: string): ReleasedRetainedWorldSettlement | undefined;
```

Parameter:

- store - Open trace store containing the settlement journal and execution evidence.

Parameter:

- outputId - Exact retained-output identity.

Returns:

- Frozen release evidence after terminalization, otherwise `undefined`.

Throws:

- {RetainedWorldSettlementInvalidError} If retained release evidence is malformed.

Throws:

- {TypeError} If the output identity is malformed.

### `inspectRetainedWorldSettlement`

Classification: `runtime-only`. Kind: `function`.

Inspects one durable prepared settlement decision and revalidates its immutable trace evidence.

Inspection performs no carrier, provider, runner, or filesystem operation. It verifies the
retained request against the committed execution cut and exact world-capture record before
returning it, and therefore remains safe to use after reopening the trace store.

Signature:

```ts
export declare function inspectRetainedWorldSettlement(store: PrepareRetainedWorldSettlementOptions["store"], outputId: string): PreparedRetainedWorldSettlement | undefined;
```

Parameter:

- store - Open trace store containing settlement and terminal execution evidence.

Parameter:

- outputId - Exact retained-output identity, never a prefix or latest selector.

Returns:

- Frozen prepared decision, or `undefined` when the output has no settlement admission.

Throws:

- {RetainedWorldSettlementInvalidError} If settlement or cited execution evidence is
malformed, missing, or inconsistent.

Throws:

- {TypeError} If the output identity is malformed.

Example:

- ```ts
const settlement = inspectRetainedWorldSettlement(store, captured.output.output_id);
settlement?.request.execution_cut_id;
```

### `inspectTaskWorldCaptureJournal`

Classification: `runtime-only`. Kind: `function`.

Reads one validated durable task-world journal without invoking a runner or carrier.

Signature:

```ts
export declare function inspectTaskWorldCaptureJournal(store: SQLiteTraceStore, runId: string): TaskWorldCaptureJournalInspection;
```

Parameter:

- store - Open trace store containing capture and execution evidence.

Parameter:

- runId - Exact durable run identity to inspect.

Returns:

- Frozen ordered journal prefix and ordinary recovery classification.

Throws:

- {TraceStoreError} If retained execution or capture evidence is malformed.

Throws:

- {TypeError} If the run identity is malformed.

Example:

- ```ts
const journal = inspectTaskWorldCaptureJournal(store, "run:review:1");
journal.transitions.map((transition) => transition.phase);
```

### `inspectWorkspacePathProtection`

Classification: `runtime-only`. Kind: `function`.

Inspects one portable binding-relative path against configured protected workspace roots.

Comparison applies the configured Unicode normalization, case folding, trailing-character, and
alternate-name rules. Existing filesystem prefixes are resolved so symbolic-link aliases fail
closed even when the final descendant does not yet exist. This function performs no mutation.

Signature:

```ts
export declare function inspectWorkspacePathProtection(options: WorkspacePathProtectionOptions): WorkspacePathProtectionValidation;
```

Parameter:

- options - Exact workspace, binding, and candidate path authority.

Returns:

- Frozen versioned validation evidence.

Throws:

- {TypeError} If the options, roots, or portable candidate path are malformed.

Example:

- ```ts
const result = inspectWorkspacePathProtection({
    bindingRoot: workspace.root_path,
    path: "src/index.ts",
    workspaceRoot: workspace.root_path,
});
console.log(result.protected);
```

### `inspectWorkspacePlatformConformance`

Classification: `runtime-only`. Kind: `function`.

Inspects the configured retained-custody policy for the current host without mutating user files.

Signature:

```ts
export declare function inspectWorkspacePlatformConformance(options: WorkspacePlatformConformanceOptions): WorkspacePlatformConformance;
```

Parameter:

- options - Exact initialized workspace to validate before returning host policy.

Returns:

- Frozen configured platform and parity evidence.

Throws:

- {WorkspaceControlError} If the workspace cannot be reopened safely.

Throws:

- {TypeError} If options are malformed or the host has no configured policy.

Example:

- ```ts
const policy = inspectWorkspacePlatformConformance({ workspaceRoot });
policy.metadata_policy;
```

### `openWorkspace`

Classification: `runtime-only`. Kind: `function`.

Opens existing workspace control state without mutation.

Signature:

```ts
export declare function openWorkspace(rootPath: string): WorkspaceState;
```

Parameter:

- rootPath - Existing initialized workspace root.

Returns:

- Frozen validated workspace and current Git context.

Throws:

- {WorkspaceControlError} If the root or control evidence is missing, unsafe, malformed,
or inconsistent with required Git evidence.

Throws:

- {TypeError} If `rootPath` is malformed.

### `prepareRetainedWorldSettlement`

Classification: `runtime-only`. Kind: `function`.

Authenticates one exact retained output and atomically prepares its consume-once settlement.

This function authenticates durable trace and retained carrier evidence. Apply preparation also
snapshots the current user basis to prove path disjointness, but does not mutate the user binding,
select a revision, or discard custody. Exact replay returns the existing prepared decision; a
different command or action conflicts at the store transaction.

Signature:

```ts
export declare function prepareRetainedWorldSettlement(options: PrepareRetainedWorldSettlementOptions): Promise<PreparedRetainedWorldSettlement>;
```

Parameter:

- options - Exact action, command, output, store, binding, and carrier authority.

Returns:

- Frozen authenticated prepared settlement decision.

Throws:

- {RetainedWorldSettlementInvalidError} If any durable or carrier citation is absent,
malformed, forged, moved, or inconsistent.

Throws:

- {RetainedWorldSettlementConflictError} If another exact request owns the command or
output identity.

Example:

- ```ts
const prepared = await prepareRetainedWorldSettlement({
    action: "select",
    binding,
    carrier,
    commandId: "settlement:review:1",
    output: captured.output,
    store,
});
prepared.state;
```

### `recoverGrantedTaskWorldDurably`

Classification: `runtime-only`. Kind: `function`.

Recovers a repository-granted task-world capture only under the exact prepared grant plan.

Signature:

```ts
export declare function recoverGrantedTaskWorldDurably<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>>(options: RecoverGrantedTaskWorldOptions<I, O>): Promise<TaskWorldCaptureResult>;
```

Parameter:

- options - Exact granted capture contract plus recovery command identity.

Returns:

- Recovered durable task result and retained world.

Throws:

- {TypeError} If current grant evidence differs from the prepared contract.

Throws:

- {DurableExecutionRecoveryError} If the capture is absent, uncertain, or unrecoverable.

Throws:

- {TraceStoreError} If command, claim, or terminal publication fails closed.

Throws:

- {WorldCarrierError} If retained carrier evidence cannot be reopened or captured.

Throws:

- {WorldChangesetError} If retained comparison evidence is invalid or exceeds limits.

Example:

- ```ts
const result = await recoverGrantedTaskWorldDurably({
    ...grantedCaptureOptions,
    commandId: "command:recover-granted-world:1",
});
```

### `recoverJailedGrantedTaskWorldDurably`

Classification: `runtime-only`. Kind: `function`.

Reopens one native-jailed capture without repeating uncertain external process work.

Signature:

```ts
export declare function recoverJailedGrantedTaskWorldDurably<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>>(options: RecoverJailedGrantedTaskWorldOptions<I, O>): Promise<JailedTaskWorldCaptureResult>;
```

Parameter:

- options - Exact jailed capture contract plus recovery command identity.

Returns:

- Recovered task-world result with reconstructed native placement and process receipt.

Throws:

- {DurableExecutionRecoveryError} If process start is uncertain or evidence is incomplete.

Throws:

- {TypeError} If retained native-jail evidence differs from current authority.

Example:

- ```ts
const result = await recoverJailedGrantedTaskWorldDurably({
    ...jailedCaptureOptions,
    commandId: "command:recover-native:1",
});
```

### `recoverPlacedGrantedTaskWorldDurably`

Classification: `runtime-only`. Kind: `function`.

Recovers a placed granted task-world capture under the exact prepared placement resolution.

Signature:

```ts
export declare function recoverPlacedGrantedTaskWorldDurably<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>>(options: RecoverPlacedGrantedTaskWorldOptions<I, O>): Promise<PlacedTaskWorldCaptureResult>;
```

Parameter:

- options - Exact placed capture contract plus recovery command identity.

Returns:

- Recovered task-world result with exact placement evidence.

Throws:

- {TypeError} If current placement or retained evidence differs from the prepared contract.

Throws:

- {DurableExecutionRecoveryError} If the capture is absent, uncertain, or unrecoverable.

Throws:

- {TraceStoreError} If command, claim, or terminal publication fails closed.

Throws:

- {WorldCarrierError} If retained carrier evidence cannot be reopened or captured.

Throws:

- {WorldChangesetError} If retained comparison evidence is invalid or exceeds limits.

Example:

- ```ts
const result = await recoverPlacedGrantedTaskWorldDurably({
    ...placedCaptureOptions,
    commandId: "command:recover-placed-world:1",
});
```

### `recoverTaskWorldDurably`

Classification: `runtime-only`. Kind: `function`.

Resumes one pre-execution task-world capture under an explicit durable recovery command.

Recovery reuses exact `forked` custody and creation evidence, acquires a command-authorized
invocation fence, and never scans carrier directories or repeats an `executing` capture.

Signature:

```ts
export declare function recoverTaskWorldDurably<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>>(options: RecoverTaskWorldOptions<I, O>): Promise<TaskWorldCaptureResult>;
```

Parameter:

- options - Exact capture contract plus globally idempotent recovery command identity.

Returns:

- Durable task result and the retained world produced from the original custody.

Throws:

- {TypeError} If options or retained capture evidence disagree.

Throws:

- {DurableExecutionRecoveryError} If the capture is absent, uncertain, or not recoverable.

Throws:

- {TraceStoreError} If command, claim, or terminal publication fails closed.

Example:

- ```ts
const result = await recoverTaskWorldDurably({
    ...captureOptions,
    commandId: "command:recover-world:1",
});
result.output.custody_id;
```

### `releaseRetainedWorldSettlement`

Classification: `runtime-only`. Kind: `function`.

Durably releases one exact retained output without materializing it or deleting its custody.

Release is receipt-only: it authenticates the existing immutable candidate and mutable custody,
retains a terminal consume-once receipt, publishes the execution citation, and leaves both the
user world and retained custody unchanged. Exact retries revalidate custody and replay the same
result after restart. Current-basis observation may retain an immutable carrier snapshot but
never writes candidate content to the user binding.

Signature:

```ts
export declare function releaseRetainedWorldSettlement(options: ReleaseRetainedWorldSettlementOptions): Promise<ReleasedRetainedWorldSettlement>;
```

Parameter:

- options - Exact output identity plus authenticated carrier and trace-store authority.

Returns:

- Frozen released result citing the preserved custody, revision, and changeset.

Throws:

- {RetainedWorldSettlementInvalidError} If trace, revision, changeset, custody, or journal
evidence is absent, malformed, forged, discarded, or inconsistent.

Throws:

- {RetainedWorldSettlementConflictError} If another action owns the admission or terminal.

### `selectRetainedWorldSettlement`

Classification: `runtime-only`. Kind: `function`.

Durably selects one exact admitted retained output and recovers interrupted publication.

The coordinator verifies the immutable admission, checks the current semantic user basis before
beginning the deterministic operation, and delegates a second pre-write basis check plus every
managed-path effect to the authenticated carrier. The selected store receipt is retained only
after the carrier publishes its exact terminal receipt. Applying and selected prefixes replay
without reopening consume-once admission or inferring success from current user bytes.

Signature:

```ts
export declare function selectRetainedWorldSettlement(options: SelectRetainedWorldSettlementOptions): Promise<SelectedRetainedWorldSettlement>;
```

Parameter:

- options - Exact output identity plus canonical binding, carrier, and trace-store authority.

Returns:

- Frozen selected result citing the exact carrier publication and final user basis.

Throws:

- {RetainedWorldSettlementInvalidError} If trace, revision, changeset, basis, carrier, or
publication evidence is absent, malformed, moved, forged, or inconsistent.

Throws:

- {RetainedWorldSettlementConflictError} If the output was admitted for another action or
has already reached another terminal settlement.

Example:

- ```ts
const selected = await selectRetainedWorldSettlement({
    binding,
    carrier,
    outputId: captured.output.output_id,
    store,
});
selected.publication_id;
```
