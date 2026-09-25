# Structured Public Errors

Implementation: [`src/errors/public-errors.ts`](../src/errors/public-errors.ts). Configuration:
[`public-errors.config.json`](../public-errors.config.json). Public entry point:
[`src/index.ts`](../src/index.ts). Tests:
[`test/errors/public-error-codes.test.ts`](../test/errors/public-error-codes.test.ts) and the fresh
installed consumer in [`tooling/testing/packaged-cli.ts`](../tooling/testing/packaged-cli.ts).

## Contract

A structured public error is an exported `Error` instance with a stable configuration-owned
`code`. Adding the property preserves every existing class, prototype relationship, constructor,
message, and `instanceof` check. `isPublicError(value)` recognizes only `Error` instances whose
own `code` is an uppercase-snake-case data property; it does not invoke accessors or inspect the
message, stack, cause, path, receipt, or evidence.

`PublicError` and `PublicErrorCode` describe this in-memory contract. Codes classify failures; they
do not grant retry, recovery, settlement, filesystem, provider, or execution authority.

## Exported error inventory

| Domain | Exported classes | Code ownership |
| --- | --- | --- |
| Canonical values | `CanonicalNestingLimitError` (`CANONICAL_NESTING_LIMIT_EXCEEDED`, a `TypeError`, from 2.33.0: a value nests deeper than `kernel.canonicalization.maxNestingDepth`, named by its `bound` property; see [canonical records](./canonical-records.md#nesting-bound)) | `public-errors.config.json` |
| Applications | `ApplicationBudgetError`, `ApplicationEvidenceError`, `ApplicationProtocolError`, `ApplicationVerificationError` | applications protocol configuration |
| Effects | `EffectHandlerNotFoundError` | `public-errors.config.json` |
| Formal assurance | `TypedEffectTraceValidationError` | `public-errors.config.json` |
| Providers | `StaticProviderExhaustedError`, `StaticProviderRequestMismatchError`, `LiveProviderError` (from 5.1.0: `LIVE_PROVIDER_CREDENTIAL_MISSING`, `LIVE_PROVIDER_TRANSPORT_FAILED`, `LIVE_PROVIDER_HTTP_FAILED`, or `LIVE_PROVIDER_RESPONSE_INVALID` by `reason`; see [live providers](./live-providers.md#errors-and-credentials)) | provider protocol configuration |
| Ledger reads | `LedgerSelectorAmbiguousError`, `LedgerSelectorNotFoundError` | projection protocol configuration selected by the read surface |
| Orphan repair | `OrphanRepairError` | typed orphan-repair protocol codes supplied by the exact failure |
| Run control | `RunBudgetExhaustedError`, `RunCancelledError` | `public-errors.config.json` |
| Schema validation | `JSONSchemaValidationError` (`SCHEMA_VALIDATION_FAILED`, a `TypeError`, from 3.0.0: a value does not satisfy a task schema or a compiled JSON Schema document; its `issues` list every path-level refusal; see [JSON Schema validation](./json-schema-validation.md)) | `public-errors.config.json` |
| Durable runs | `DurableExecutionRecoveryAbsentError`, `DurableExecutionRecoveryError`, `DurableExecutionRecoveryCommandRequiredError`, `DurableExecutionClaimLostError`, `DurableExecutionClaimFencedError` | run protocol configuration |
| Trace | `TraceStoreError`, `AppendIntentConflictError`, `UnsupportedStoreSchemaError`, `BlobIntegrityError`, `ProjectionCompatibilityError`, `TraceSecretDetectedError` (`TRACE_SECRET_DETECTED`), `TraceStoreReadOnlyError` (`TRACE_STORE_READ_ONLY`, from 2.30.0: maintenance requested on a read-only handle) | `public-errors.config.json` |
| Retention | `RedactedTraceArchiveError` (`REDACTED_TRACE_ARCHIVE_ERROR`, a `TypeError`) | `public-errors.config.json` |
| Trace interchange | `TraceArchiveLimitError` (`TRACE_ARCHIVE_LIMIT_EXCEEDED`, a `TypeError`, from 2.32.0: an archive exceeds a configured `kernel.interchange.limits` member, named by its `limit` property; see [trace interchange](./trace-interchange.md#input-limits)) | `public-errors.config.json` |
| Backup and restore | `TraceStoreBackupError` (`TRACE_STORE_BACKUP_ERROR`) with a configured `reason` from `STORE_BACKUP_FAILURE_REASONS` ([backup, restore, and migration](./backup-restore-and-migration.md#verification)) | `public-errors.config.json`; reasons from the backup protocol configuration |
| Storage adapters | `StorageAdapterError` (`STORAGE_ADAPTER_ERROR`), `StorageBlobContentMismatchError` (`STORAGE_BLOB_CONTENT_MISMATCH`, a `StorageAdapterError`) | `public-errors.config.json` |
| Supervision | `SupervisionApprovalConflictError`, `SupervisionCursorConflictError`, `SupervisionEvidenceError`, `SupervisionLeaseConflictError`, `SupervisionLeaseFencedError`, `SupervisionMaterializationUncertainError`, `SupervisionSubscriptionOverflowError` | supervision protocol configuration |
| Effect compensation | `EffectCompensationConflictError`, `EffectCompensationEvidenceError`, `EffectCompensationFailedError`, `EffectCompensationHandlerNotFoundError` (from 7.0.0; see [effect compensation](./compensation.md)) | effect protocol configuration (`effects.compensation.errors`) |
| Replay | `ReplayCheckpointUnavailableError`, `ReplayCompatibilityError`, `ReplayEffectRefusedError`, `ReplayEvidenceError`, `ReplayLeaseConflictError`, `ReplayLeaseFencedError`, `ReplayMaterializationUncertainError`, `ReplayPrefixMismatchError`, `ReplayRestoreError`, `ReplaySessionInterruptedError`, `ReplayStepFailureError` | replay protocol configuration |
| Scopes | `ScopeAuthorityError`, `ScopeEvidenceError`, `ScopeHeadConflictError`, `ScopeMergeConflictError`, `ScopeQuiescenceError`, `ScopeTerminalConflictError`, `ScopeWriterConflictError`, `ScopeWriterFencedError` | scope protocol configuration |
| Tasks | `TaskRegistryError`, `TaskVersionConflictError`, `UnsupportedTaskRegistrySchemaError` | `public-errors.config.json` |
| Workspace control | `WorkspaceControlError`, `WorkspaceInitializationConflictError`, `WorkspaceBindingError` | workspace protocol configuration or the exact configured binding refusal |
| Workspace custody | `WorldCarrierError`, `GitCustodyError`, `WorldChangesetError`, `WorkspaceCustodyFaultError`, `WorkspaceProtectedPathError` | the exact configured carrier, Git, changeset, platform-fault, or protected-path refusal |
| Device layers | `DeviceLayerError` (from 11.3.0: `DEVICE_LAYER_UNAVAILABLE`, `DEVICE_LAYER_CHECKPOINT_INVALID`, `DEVICE_LAYER_CHECKPOINT_UNKNOWN`, `DEVICE_LAYER_CHECKPOINT_RETIRED`, `DEVICE_LAYER_PATH_INVALID`, `DEVICE_LAYER_CLOSED`, or `DEVICE_LAYER_OPERATION_FAILED` with the adapter error as `cause`; see [device layers](./device-layers.md#model)) | workspace protocol configuration (`workspaces.deviceLayers.errors`) |
| Workspace placement | `PlacementUnavailableError`, `NativeJailUnavailableError`, `NativeJailExecutionError` | `public-errors.config.json` |
| Workspace settlement | `RetainedWorldApplicationConflictError`, `RetainedWorldSettlementConflictError`, `RetainedWorldSettlementInvalidError` | workspace settlement protocol configuration |

The root exports the complete contract. Domain facades continue exporting only their owned error
classes; their namespace membership is unchanged except for the additive `code` property on
instances.

## Causes and redaction

Existing wrappers that already accept `ErrorOptions`, including trace-store and task-registry base
errors, retain `cause` through the standard `Error` constructor. `RunCancelledError` retains the
caller signal reason, and `OrphanRepairError` retains its optional existing cause. Existing
execution, recovery, settlement, and codec wrappers that pass `{ cause }` keep doing so.

Causes are in-memory diagnostics only. They are not added to canonical records, trace archives,
receipts, generated schemas, or the stable CLI JSON envelope. The CLI continues returning its
closed configured error codes and remedies without messages, stacks, resolved paths, credentials,
or nested causes. Packaged stack and cause behavior is specified in
[`source-maps-and-causes.md`](./source-maps-and-causes.md).

`TraceSecretDetectedError` is built only from a scan report: its message and `findings` carry the
finding count, configured secret-class names, JSON Pointers, and digests, never matched text, and
it has no cause. Human CLI output prints that message and `--json` prints only the configured code,
so a refusal cannot echo the secret through either path. `RedactedTraceArchiveError` names the
failed archive member or record index; a wrapped validation cause describes structure, not body
content ([secrets and retention](./secrets-and-retention.md)).

## Intentionally unclassified failures

Validation failures remain ordinary `TypeError` values, except schema validation of values, which
is the coded `JSONSchemaValidationError` subclass so callers can read its path-level issues.
Malformed schema declarations and documents remain ordinary `TypeError` values. Caller-owned handler/runner callbacks and
provider implementations continue propagating their original thrown value where documented.
Native/external failures represented by an exported wrapper receive that wrapper's public code;
otherwise the original platform failure remains unclassified. `isPublicError` returns `false` for
all of these cases rather than inventing a misleading classification.
