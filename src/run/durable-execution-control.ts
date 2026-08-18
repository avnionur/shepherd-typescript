import { createRecordId } from "../canonical/canonical-record.ts";
import {
    projectionProtocolConfig,
    runProtocolConfig,
    workspaceProtocolConfig,
} from "../protocol/config.ts";
import {
    DURABLE_EXECUTION_RECOVERY_STATUSES,
    RECORD_MODES,
    RUN_CONTROL_REASON_TYPES,
    RUN_CONTROL_STATUSES,
    RUN_TERMINAL_STATUSES,
} from "../protocol/values.generated.ts";
import { createRecordEnvelope } from "../record/envelope.ts";
import { assertNonEmptyString, assertRecordId } from "../record/guards.ts";
import { ROOT_WITNESS_ID } from "../record/root-witness.ts";
import type { RecordId } from "../record/types.ts";
import { TraceStoreError } from "../store/errors.ts";
import type { SQLiteTraceStore } from "../store/sqlite-trace-store.ts";
import type { OwnerRecord } from "../store/types.ts";
import type { TaskSchema } from "../task/schema.ts";
import {
    executeTaskDurablyWithRecoveryCommand,
    retainDurableCancellationTerminal,
} from "./durable-execution.ts";
import { readDurableCreation } from "./durable-execution-codec.ts";
import {
    createDurableCancellationCommand,
    createDurableInactiveCancellationCommand,
    createDurablePauseCommand,
    createDurableRecoveryCommand,
    readDurableCancellationCommand,
} from "./durable-execution-control-codec.ts";
import type {
    DurableTaskCancellationAcknowledgementOptions,
    DurableTaskCancellationCommandReceipt,
    DurableTaskCancellationOptions,
    DurableTaskDirectCancellationOptions,
    DurableTaskPauseCommandReceipt,
    DurableTaskPauseOptions,
    DurableTaskRecoveryOptions,
    DurableTaskRecoveryResult,
    DurableTaskResumeOptions,
    DurableTaskResumeReceipt,
    DurableTaskSuspensionOptions,
    DurableTaskSuspensionReceipt,
    DurableTaskWaitingOptions,
    DurableTaskWaitingReceipt,
    RunContinuationCheckpointAdapter,
    RunContinuationCheckpointEvidence,
    RunContinuationCheckpointOptions,
} from "./durable-execution-control-types.ts";
import { retainDurableExecutionCreation } from "./durable-execution-creation.ts";
import { publishDurableExecutionCut } from "./durable-execution-cut.ts";
import {
    DurableExecutionRecoveryAbsentError,
    DurableExecutionRecoveryError,
} from "./durable-execution-errors.ts";
import { inspectDurableTaskExecution } from "./durable-execution-inspection.ts";
import {
    assertDurableExecutionRecordContract,
    readDurableTaskExecution,
} from "./durable-execution-recovery.ts";
import type { DurableTaskExecutionResult } from "./durable-execution-types.ts";
import { prepareTaskExecution } from "./execution-preparation.ts";
import { createRunOutcome } from "./outcomes.ts";
import { assertRunText, readRunDataObject } from "./validation-values.ts";

const [CAPTURE_MODE] = RECORD_MODES;
const [
    ABSENT_RECOVERY_STATUS,
    ,
    STARTED_RECOVERY_STATUS,
    TERMINAL_PENDING_CUT_RECOVERY_STATUS,
    COMMITTED_RECOVERY_STATUS,
] = DURABLE_EXECUTION_RECOVERY_STATUSES;
const [, , CANCELLED_CONTROL_STATUS] = RUN_CONTROL_STATUSES;
const [, CANCELLED_REASON_TYPE] = RUN_CONTROL_REASON_TYPES;
const [, , , CANCELLED_TERMINAL_STATUS] = RUN_TERMINAL_STATUSES;

/**
 * Atomically cancels a created, waiting, or suspended durable run.
 *
 * The globally idempotent command, cancelled outcome, and terminal lifecycle commit in one store
 * transaction after exact-head comparison. Any retained pre-start or released claim is expired in
 * that transaction. Running workers must use {@link requestDurableTaskCancellation} and
 * {@link acknowledgeDurableTaskCancellation} instead.
 *
 * @param store - Open trace store containing the inactive durable execution.
 * @param options - Exact command, run, inactive lifecycle head, and reason contract.
 * @returns Immutable cancelled execution and durable terminal receipt.
 * @throws {TypeError} If options are malformed.
 * @throws {TraceStoreError} If lifecycle authority is active, stale, or inconsistent.
 * @throws {AppendIntentConflictError} If command identity already names different content.
 *
 * @example
 * ```ts
 * const cancelled = cancelDurableTask(store, {
 *     commandId: "command:cancel:created:42",
 *     expectedLifecycleRecordId: createdRecordId,
 *     reason: "operator request",
 *     runId: "run:42",
 * });
 * cancelled.execution.outcome.outcome.status;
 * ```
 *
 * @public
 */
export function cancelDurableTask(
    store: SQLiteTraceStore,
    options: DurableTaskDirectCancellationOptions,
): DurableTaskExecutionResult {
    const parsed = readDirectCancellationOptions(options);
    const schemas = projectionProtocolConfig.executionHistory.executionSchemas;
    const ownerRecords = store.readOwner(parsed.runId);
    assertNoTaskWorldJournal(ownerRecords, parsed.runId);
    const creationRecords = ownerRecords.filter(
        (record) => record.envelope.schema_ref === schemas.created,
    );
    if (creationRecords.length !== 1) {
        throw new TraceStoreError("durable cancellation requires exact creation evidence");
    }
    const creationRecord = creationRecords[0] as OwnerRecord;
    const expectedHead = ownerRecords.find(
        (record) => record.envelope.record_id === parsed.expectedLifecycleRecordId,
    );
    const quiescent =
        expectedHead?.envelope.schema_ref === runProtocolConfig.schemas.waitingLifecycleId ||
        expectedHead?.envelope.schema_ref === runProtocolConfig.schemas.suspendedLifecycleId;
    const terminal = ownerRecords.some(
        (record) =>
            record.envelope.schema_ref === schemas.completed ||
            record.envelope.schema_ref === schemas.failed,
    );
    if (quiescent || terminal) {
        inspectDurableTaskExecution(store, parsed.runId);
    }
    const creationBody = readRunDataObject(
        creationRecord.body,
        ["payload"],
        "durable cancellation creation record",
    );
    const creation = readDurableCreation(creationBody.payload, parsed.runId);
    const startedRecord = ownerRecords.find(
        (record) => record.envelope.schema_ref === schemas.started,
    );
    const execution = createCancelledExecution(parsed.runId, creation, startedRecord !== undefined);
    const commandBody = createDurableInactiveCancellationCommand(
        parsed.runId,
        parsed.commandId,
        parsed.expectedLifecycleRecordId,
        parsed.reason,
    );
    const commandLocalId = createRecordId({ durable_cancel_command_id: parsed.commandId });
    const outcomeLocalId = runProtocolConfig.schemas.outcomeId;
    const receipt = store.appendDurableExecutionInactiveCancellation(
        parsed.runId,
        parsed.expectedLifecycleRecordId,
        {
            append_intent_id: createRecordId({ durable_control_command_id: parsed.commandId }),
            batch: {
                groups: [
                    {
                        caused_by_record_ids: [parsed.expectedLifecycleRecordId],
                        owner_id: parsed.runId,
                        records: [
                            {
                                append_local_id: commandLocalId,
                                body: commandBody,
                                mode: CAPTURE_MODE,
                                schema_ref: runProtocolConfig.execution.controlCommandSchemaId,
                                witness_ref: ROOT_WITNESS_ID,
                            },
                            {
                                append_local_id: outcomeLocalId,
                                body: execution.outcome,
                                caused_by_local_refs: [commandLocalId],
                                mode: CAPTURE_MODE,
                                schema_ref: runProtocolConfig.schemas.outcomeId,
                                witness_ref: ROOT_WITNESS_ID,
                            },
                            {
                                body: {
                                    payload: {
                                        control: execution.control,
                                        error: runProtocolConfig.control.cancellationReason,
                                        execution_id: parsed.runId,
                                    },
                                },
                                caused_by_local_refs: [commandLocalId, outcomeLocalId],
                                mode: CAPTURE_MODE,
                                schema_ref: schemas.failed,
                                witness_ref: ROOT_WITNESS_ID,
                            },
                        ],
                    },
                ],
            },
        },
    );
    const outcomeRecordId = receipt.record_ids[1] as RecordId;
    const lifecycleRecordId = receipt.record_ids[2] as RecordId;
    const cut = publishDurableExecutionCut(store, parsed.runId, lifecycleRecordId);
    return Object.freeze({
        execution,
        ledger: Object.freeze({
            artifact_record_ids: Object.freeze([]),
            created_record_id: creationRecord.envelope.record_id,
            cut,
            lifecycle_record_id: lifecycleRecordId,
            outcome_record_id: outcomeRecordId,
            started: startedRecord !== undefined,
            started_record_id: startedRecord?.envelope.record_id ?? null,
            usage_record_id: null,
        }),
    });
}

/**
 * Retains one globally idempotent cancellation request against the exact running fence.
 *
 * The command requests cooperative cancellation only. It leaves lifecycle and worker authority
 * unchanged until the exact worker acknowledges a safe boundary.
 *
 * @param store - Open trace store containing the running durable execution.
 * @param options - Exact command, run, lifecycle-head, fencing-token, and reason contract.
 * @returns Canonical retained cancellation-command evidence.
 * @throws {TypeError} If options are malformed.
 * @throws {TraceStoreError} If running authority is no longer current.
 * @throws {AppendIntentConflictError} If command identity already names different content.
 *
 * @example
 * ```ts
 * const command = requestDurableTaskCancellation(store, {
 *     commandId: "command:cancel:42",
 *     expectedLifecycleRecordId: startedRecordId,
 *     fencingToken,
 *     reason: "operator request",
 *     runId: "run:42",
 * });
 * command.record_id;
 * ```
 *
 * @public
 */
export function requestDurableTaskCancellation(
    store: SQLiteTraceStore,
    options: DurableTaskCancellationOptions,
): DurableTaskCancellationCommandReceipt {
    const parsed = readCancellationOptions(options);
    const body = createDurableCancellationCommand(
        parsed.runId,
        parsed.commandId,
        parsed.expectedLifecycleRecordId,
        parsed.fencingToken,
        parsed.reason,
    );
    const receipt = store.appendDurableExecutionRunningControlCommand(
        parsed.runId,
        parsed.expectedLifecycleRecordId,
        parsed.fencingToken,
        {
            append_intent_id: createRecordId({ durable_control_command_id: parsed.commandId }),
            batch: {
                groups: [
                    {
                        caused_by_record_ids: [parsed.expectedLifecycleRecordId],
                        owner_id: parsed.runId,
                        records: [
                            {
                                body,
                                mode: CAPTURE_MODE,
                                schema_ref: runProtocolConfig.execution.controlCommandSchemaId,
                                witness_ref: ROOT_WITNESS_ID,
                            },
                        ],
                    },
                ],
            },
        },
    );
    return Object.freeze({
        command_id: parsed.commandId,
        record_id: receipt.record_ids[0] as RecordId,
    });
}

/**
 * Acknowledges command-authorized cancellation at the exact current worker safe boundary.
 *
 * Terminal evidence and claim release commit atomically. The resulting cut is then published
 * deterministically; exact acknowledgement replay reconstructs the retained cancelled result.
 *
 * @param store - Open trace store containing the running execution and cancellation command.
 * @param options - Exact command and worker authority reaching the safe boundary.
 * @returns Immutable cancelled execution and durable terminal receipt.
 * @throws {TypeError} If options or command evidence are malformed.
 * @throws {TraceStoreError} If lifecycle, command, or worker authority is inconsistent.
 * @throws {DurableExecutionClaimFencedError} If the worker is no longer authoritative.
 *
 * @example
 * ```ts
 * const cancelled = acknowledgeDurableTaskCancellation(store, {
 *     cancelCommandRecordId: command.record_id,
 *     claimId,
 *     expectedLifecycleRecordId: startedRecordId,
 *     fencingToken,
 *     runId: "run:42",
 * });
 * cancelled.execution.outcome.outcome.status;
 * ```
 *
 * @public
 */
export function acknowledgeDurableTaskCancellation(
    store: SQLiteTraceStore,
    options: DurableTaskCancellationAcknowledgementOptions,
): DurableTaskExecutionResult {
    const parsed = readCancellationAcknowledgementOptions(options);
    const recovery = readDurableTaskExecution(store, parsed.runId);
    const commandRecord = store.readRecord(parsed.cancelCommandRecordId);
    const commandView = commandRecord?.views.find((view) => view.owner_id === parsed.runId);
    if (
        commandRecord === undefined ||
        commandView === undefined ||
        commandRecord.envelope.schema_ref !== runProtocolConfig.execution.controlCommandSchemaId
    ) {
        throw new TraceStoreError("durable cancellation command evidence is unavailable");
    }
    const command = readDurableCancellationCommand(commandRecord.body, parsed.runId);
    if (
        !("fencing_token" in command) ||
        command.expected_lifecycle_record_id !== parsed.expectedLifecycleRecordId ||
        command.fencing_token !== parsed.fencingToken
    ) {
        throw new TraceStoreError("durable cancellation command authority is inconsistent");
    }
    assertDurableExecutionRecordContract(
        { body: commandRecord.body, envelope: commandRecord.envelope, view: commandView },
        CAPTURE_MODE,
        ROOT_WITNESS_ID,
        [parsed.expectedLifecycleRecordId],
    );
    if (recovery.status === COMMITTED_RECOVERY_STATUS) {
        assertCancellationTerminalReplay(store, parsed, recovery.result);
        return recovery.result;
    }
    if (recovery.status === TERMINAL_PENDING_CUT_RECOVERY_STATUS) {
        assertCancellationTerminalReplay(store, parsed, {
            execution: recovery.execution,
            ledger: recovery.ledger,
        });
        publishDurableExecutionCut(store, parsed.runId, recovery.ledger.lifecycle_record_id);
        const committed = readDurableTaskExecution(store, parsed.runId);
        if (committed.status !== COMMITTED_RECOVERY_STATUS) {
            throw new TraceStoreError("durable cancellation cut publication did not commit");
        }
        return committed.result;
    }
    if (
        recovery.status !== STARTED_RECOVERY_STATUS ||
        recovery.started_record_id !== parsed.expectedLifecycleRecordId
    ) {
        throw new TraceStoreError("durable cancellation requires the exact current running head");
    }
    const creationRecord = store.readRecord(recovery.created_record_id);
    if (creationRecord === undefined) {
        throw new TraceStoreError("durable cancellation creation evidence is unavailable");
    }
    const creationBody = readRunDataObject(
        creationRecord.body,
        ["payload"],
        "durable cancellation creation record",
    );
    const creation = readDurableCreation(creationBody.payload, parsed.runId);
    const execution = createCancelledExecution(parsed.runId, creation, true);
    return retainDurableCancellationTerminal(
        store,
        parsed.runId,
        recovery.created_record_id,
        parsed.expectedLifecycleRecordId,
        parsed.claimId,
        parsed.fencingToken,
        parsed.cancelCommandRecordId,
        execution,
    );
}

function assertCancellationTerminalReplay(
    store: SQLiteTraceStore,
    options: DurableTaskCancellationAcknowledgementOptions,
    retained: {
        readonly execution: DurableTaskExecutionResult["execution"];
        readonly ledger:
            | Omit<DurableTaskExecutionResult["ledger"], "cut">
            | DurableTaskExecutionResult["ledger"];
    },
): void {
    if (
        retained.ledger.started_record_id !== options.expectedLifecycleRecordId ||
        retained.execution.outcome.outcome.status !== CANCELLED_TERMINAL_STATUS
    ) {
        throw new TraceStoreError(
            "durable cancellation replay targets different terminal evidence",
        );
    }
    const outcome = store.readRecord(retained.ledger.outcome_record_id);
    const terminal = store.readRecord(retained.ledger.lifecycle_record_id);
    if (
        outcome === undefined ||
        terminal === undefined ||
        !outcome.envelope.caused_by_record_ids.includes(options.cancelCommandRecordId) ||
        !terminal.envelope.caused_by_record_ids.includes(options.cancelCommandRecordId)
    ) {
        throw new TraceStoreError("durable cancellation terminal omits command authority");
    }
}

/**
 * Atomically resumes one exact suspended or satisfied waiting run under an idempotent command.
 *
 * Resume verifies the quiescent acknowledgement and its continuation descriptor, requires exact
 * prerequisite-satisfaction evidence for waiting, rejects satisfaction evidence for suspension,
 * acquires the next monotonic worker fence, and publishes a distinct command-bound
 * running-continuation acknowledgement. It does not itself restore provider, process, or world
 * state; the caller uses the returned authority only after its adapters restore verified receipts.
 *
 * @param store - Open trace store containing the waiting or suspended run.
 * @param options - Exact command, quiescent head, descriptor, satisfaction, and run contract.
 * @returns Canonical resume evidence and newly fenced worker authority.
 * @throws {TypeError} If options or identifiers are malformed.
 * @throws {TraceStoreError} If lifecycle, claim, or continuation evidence is inconsistent.
 * @throws {AppendIntentConflictError} If command identity already names different content.
 *
 * @example
 * ```ts
 * const authority = resumeDurableTask(store, {
 *     commandId: "command:resume:42",
 *     continuationDescriptorRecordId: suspension.continuation_descriptor_record_id,
 *     expectedLifecycleRecordId: suspension.acknowledgement_record_id,
 *     runId: "run:42",
 * });
 * authority.fencing_token;
 * ```
 *
 * @public
 */
export function resumeDurableTask(
    store: SQLiteTraceStore,
    options: DurableTaskResumeOptions,
): DurableTaskResumeReceipt {
    const parsed = readResumeOptions(options);
    return store.appendDurableExecutionResume(
        parsed.runId,
        parsed.commandId,
        parsed.expectedLifecycleRecordId,
        parsed.continuationDescriptorRecordId,
        createRecordId({ durable_resume_claim_id: parsed.commandId }),
        Date.now(),
        parsed.prerequisiteSatisfaction === undefined
            ? null
            : {
                  kind: parsed.prerequisiteSatisfaction.kind,
                  prerequisite_id: parsed.prerequisiteSatisfaction.prerequisiteId,
                  receipt_id: parsed.prerequisiteSatisfaction.receiptId,
              },
    );
}

/**
 * Collects exact continuation evidence from every configured checkpoint adapter.
 *
 * Collection performs no trace-store mutation. Callers invoke it only after the worker has reached
 * a safe boundary with no provider, effect, or world mutation in flight. The returned evidence can
 * be retried through {@link acknowledgeDurableTaskSuspension} without rerunning adapters.
 *
 * @param options - Exact run boundary and ordered configured adapters.
 * @returns Frozen ordered checkpoint evidence.
 * @throws {TypeError} If options, adapters, or returned evidence are malformed or reordered.
 *
 * @public
 */
export async function captureRunContinuationCheckpoints(
    options: RunContinuationCheckpointOptions,
): Promise<readonly RunContinuationCheckpointEvidence[]> {
    const parsed = readCheckpointOptions(options);
    const context = Object.freeze({
        expected_lifecycle_record_id: parsed.expectedLifecycleRecordId,
        run_id: parsed.runId,
        trace_cut_id: parsed.traceCutId,
    });
    const evidence: RunContinuationCheckpointEvidence[] = [];
    for (const [index, adapter] of parsed.adapters.entries()) {
        const expectedKind = runProtocolConfig.execution.continuationConstituentKinds[index];
        if (adapter.kind !== expectedKind || typeof adapter.checkpoint !== "function") {
            throw new TypeError("continuation checkpoint adapters must match configured order");
        }
        evidence.push(readCheckpointEvidence(await adapter.checkpoint(context), expectedKind));
    }
    return Object.freeze(evidence);
}

/**
 * Atomically acknowledges prerequisite-driven waiting and releases the worker fence.
 *
 * The immutable cut is published through the exact running head before one store transaction
 * validates the current claim and lifecycle, appends the continuation descriptor plus explicit
 * prerequisite acknowledgement, and releases the worker. Exact replay returns retained evidence.
 *
 * @param store - Open trace store containing the running execution.
 * @param options - Exact running authority, cut, prerequisite, and checkpoint evidence.
 * @returns Canonical continuation and waiting acknowledgement identities.
 * @throws {TypeError} If options or constituent evidence are malformed or unavailable.
 * @throws {TraceStoreError} If the running authority, lifecycle head, or cut is inconsistent.
 * @throws {AppendIntentConflictError} If the same waiting intent names different evidence.
 *
 * @public
 */
export function acknowledgeDurableTaskWaiting(
    store: SQLiteTraceStore,
    options: DurableTaskWaitingOptions,
): DurableTaskWaitingReceipt {
    const parsed = readWaitingOptions(options);
    const cut = store.publishCut({
        cut_id: parsed.traceCutId,
        target_owner_id: parsed.runId,
        through_record_id: parsed.expectedLifecycleRecordId,
    });
    const descriptorLocalId = createRecordId({
        continuation_descriptor: {
            expected_lifecycle_record_id: parsed.expectedLifecycleRecordId,
            prerequisite_id: parsed.prerequisite.prerequisiteId,
            run_id: parsed.runId,
        },
    });
    const descriptorBody = {
        constituents: parsed.constituents,
        continuation_version: runProtocolConfig.execution.continuationVersion,
        execution_id: parsed.runId,
        trace_cut_id: parsed.traceCutId,
    };
    const descriptorRecordId = createRecordEnvelope({
        body: descriptorBody,
        caused_by_record_ids: [cut.created_by_record_id],
        mode: CAPTURE_MODE,
        schema_ref: runProtocolConfig.schemas.continuationDescriptorId,
        witness_ref: ROOT_WITNESS_ID,
    }).record_id;
    const receipt = store.appendDurableExecutionWaiting(
        parsed.runId,
        parsed.expectedLifecycleRecordId,
        parsed.fencingToken,
        parsed.traceCutId,
        {
            append_intent_id: createRecordId({
                durable_waiting: {
                    expected_lifecycle_record_id: parsed.expectedLifecycleRecordId,
                    prerequisite_id: parsed.prerequisite.prerequisiteId,
                    run_id: parsed.runId,
                },
            }),
            batch: {
                groups: [
                    {
                        caused_by_record_ids: [cut.created_by_record_id],
                        owner_id: parsed.runId,
                        records: [
                            {
                                append_local_id: descriptorLocalId,
                                body: descriptorBody,
                                mode: CAPTURE_MODE,
                                schema_ref: runProtocolConfig.schemas.continuationDescriptorId,
                                witness_ref: ROOT_WITNESS_ID,
                            },
                        ],
                    },
                    {
                        caused_by_record_ids: [parsed.expectedLifecycleRecordId],
                        owner_id: parsed.runId,
                        records: [
                            {
                                body: {
                                    continuation_descriptor_id: descriptorRecordId,
                                    execution_id: parsed.runId,
                                    lifecycle_version: runProtocolConfig.execution.lifecycleVersion,
                                    prerequisite: {
                                        kind: parsed.prerequisite.kind,
                                        prerequisite_id: parsed.prerequisite.prerequisiteId,
                                    },
                                    status: runProtocolConfig.execution.lifecycleWaitingStatus,
                                },
                                caused_by_local_refs: [descriptorLocalId],
                                mode: CAPTURE_MODE,
                                schema_ref: runProtocolConfig.schemas.waitingLifecycleId,
                                witness_ref: ROOT_WITNESS_ID,
                            },
                        ],
                    },
                ],
            },
        },
    );
    return Object.freeze({
        acknowledgement_record_id: receipt.record_ids[1] as RecordId,
        continuation_descriptor_record_id: receipt.record_ids[0] as RecordId,
        trace_cut_id: parsed.traceCutId,
    });
}

/**
 * Atomically acknowledges a command-authorized durable suspension and releases the worker fence.
 *
 * The immutable cut is published through the expected running record before the transaction. The
 * transaction then validates the exact current claim, pause command, lifecycle head, cut, and
 * resumable constituent evidence; appends the continuation descriptor and suspension
 * acknowledgement; and releases the claim. Exact replay returns the retained receipt.
 *
 * @param store - Open trace store containing the running execution and pause command.
 * @param options - Exact running authority, cut, pause command, and checkpoint evidence.
 * @returns Canonical continuation and suspension acknowledgement identities.
 * @throws {TypeError} If options or constituent evidence are malformed or unavailable.
 * @throws {TraceStoreError} If the running authority, pause command, or cut is inconsistent.
 * @throws {AppendIntentConflictError} If the same suspension intent names different evidence.
 *
 * @public
 */
export function acknowledgeDurableTaskSuspension(
    store: SQLiteTraceStore,
    options: DurableTaskSuspensionOptions,
): DurableTaskSuspensionReceipt {
    const parsed = readSuspensionOptions(options);
    const cut = store.publishCut({
        cut_id: parsed.traceCutId,
        target_owner_id: parsed.runId,
        through_record_id: parsed.expectedLifecycleRecordId,
    });
    const descriptorLocalId = createRecordId({
        continuation_descriptor: {
            pause_command_record_id: parsed.pauseCommandRecordId,
            run_id: parsed.runId,
        },
    });
    const descriptorBody = {
        constituents: parsed.constituents,
        continuation_version: runProtocolConfig.execution.continuationVersion,
        execution_id: parsed.runId,
        trace_cut_id: parsed.traceCutId,
    };
    const descriptorRecordId = createRecordEnvelope({
        body: descriptorBody,
        caused_by_record_ids: [cut.created_by_record_id],
        mode: CAPTURE_MODE,
        schema_ref: runProtocolConfig.schemas.continuationDescriptorId,
        witness_ref: ROOT_WITNESS_ID,
    }).record_id;
    const receipt = store.appendDurableExecutionSuspension(
        parsed.runId,
        parsed.expectedLifecycleRecordId,
        parsed.fencingToken,
        parsed.pauseCommandRecordId,
        parsed.traceCutId,
        {
            append_intent_id: createRecordId({
                durable_suspension: {
                    pause_command_record_id: parsed.pauseCommandRecordId,
                    run_id: parsed.runId,
                },
            }),
            batch: {
                groups: [
                    {
                        caused_by_record_ids: [cut.created_by_record_id],
                        owner_id: parsed.runId,
                        records: [
                            {
                                append_local_id: descriptorLocalId,
                                body: descriptorBody,
                                mode: CAPTURE_MODE,
                                schema_ref: runProtocolConfig.schemas.continuationDescriptorId,
                                witness_ref: ROOT_WITNESS_ID,
                            },
                        ],
                    },
                    {
                        caused_by_record_ids: [
                            parsed.expectedLifecycleRecordId,
                            parsed.pauseCommandRecordId,
                        ],
                        owner_id: parsed.runId,
                        records: [
                            {
                                body: {
                                    continuation_descriptor_id: descriptorRecordId,
                                    execution_id: parsed.runId,
                                    lifecycle_version: runProtocolConfig.execution.lifecycleVersion,
                                    pause_command_id: parsed.pauseCommandRecordId,
                                    status: runProtocolConfig.execution.lifecycleSuspendedStatus,
                                },
                                caused_by_local_refs: [descriptorLocalId],
                                mode: CAPTURE_MODE,
                                schema_ref: runProtocolConfig.schemas.suspendedLifecycleId,
                                witness_ref: ROOT_WITNESS_ID,
                            },
                        ],
                    },
                ],
            },
        },
    );
    return Object.freeze({
        acknowledgement_record_id: receipt.record_ids[1] as RecordId,
        continuation_descriptor_record_id: receipt.record_ids[0] as RecordId,
        trace_cut_id: parsed.traceCutId,
    });
}

/**
 * Retains one globally idempotent pause request against the exact current running fence.
 *
 * This function records command authority only. It does not interrupt the provider, release the
 * invocation lease, append a suspension acknowledgement, or change lifecycle projection. Exact
 * replay returns the retained command even if the run later advances; reuse of the command
 * identity for different content conflicts.
 *
 * @param store - Open trace store containing the running durable execution.
 * @param options - Exact command, run, lifecycle-head, fencing-token, and reason contract.
 * @returns Canonical retained pause-command evidence.
 * @throws {TypeError} If the options, identifiers, token, or reason are malformed.
 * @throws {TraceStoreError} If the expected running head or fencing token is no longer current.
 * @throws {AppendIntentConflictError} If command identity already names different content.
 *
 * @example
 * ```ts
 * const command = requestDurableTaskPause(store, {
 *     commandId: "command:pause:greet:1",
 *     expectedLifecycleRecordId: startedRecordId,
 *     fencingToken: currentFencingToken,
 *     reason: "operator maintenance",
 *     runId: "run:greet:1",
 * });
 * command.record_id;
 * ```
 *
 * @public
 */
export function requestDurableTaskPause(
    store: SQLiteTraceStore,
    options: DurableTaskPauseOptions,
): DurableTaskPauseCommandReceipt {
    const parsed = readPauseOptions(options);
    const body = createDurablePauseCommand(
        parsed.runId,
        parsed.commandId,
        parsed.expectedLifecycleRecordId,
        parsed.fencingToken,
        parsed.reason,
    );
    const receipt = store.appendDurableExecutionRunningControlCommand(
        parsed.runId,
        parsed.expectedLifecycleRecordId,
        parsed.fencingToken,
        {
            append_intent_id: createRecordId({ durable_control_command_id: parsed.commandId }),
            batch: {
                groups: [
                    {
                        caused_by_record_ids: [parsed.expectedLifecycleRecordId],
                        owner_id: parsed.runId,
                        records: [
                            {
                                body,
                                mode: CAPTURE_MODE,
                                schema_ref: runProtocolConfig.execution.controlCommandSchemaId,
                                witness_ref: ROOT_WITNESS_ID,
                            },
                        ],
                    },
                ],
            },
        },
    );
    return Object.freeze({
        command_id: parsed.commandId,
        record_id: receipt.record_ids[0] as RecordId,
    });
}

/**
 * Applies one globally idempotent recovery command to existing durable task evidence.
 *
 * Recovery resumes only creation evidence that has not crossed the provider boundary, repairs a
 * missing terminal cut without provider invocation, and replays committed results. A retained
 * start without terminal evidence remains fail-closed. The command is retained canonically and
 * causally cited by any recovered start or cut publication.
 *
 * @param store - Open trace store containing the durable execution.
 * @param options - Stable command identity and exact execution contract to recover.
 * @returns Canonical command evidence and the recovered durable result.
 * @throws {TypeError} If the command or execution options are malformed.
 * @throws {DurableExecutionRecoveryAbsentError} If no creation evidence exists for the run.
 * @throws {DurableExecutionRecoveryError} If provider invocation may already have occurred.
 * @throws {TraceStoreError} If command identity conflicts or retained evidence is inconsistent.
 *
 * @example
 * ```ts
 * const recovered = await recoverTaskDurably(store, {
 *     commandId: "command:recover:greet:1",
 *     execution: { task: greet, input: { name: "Ada" }, provider, runId: "run:greet:1" },
 * });
 * recovered.command.record_id;
 * ```
 *
 * @public
 */
export async function recoverTaskDurably<
    I extends TaskSchema<unknown>,
    O extends TaskSchema<unknown>,
>(
    store: SQLiteTraceStore,
    options: DurableTaskRecoveryOptions<I, O>,
): Promise<DurableTaskRecoveryResult> {
    assertRecoveryOptions(options);
    const prepared = prepareTaskExecution(options.execution);
    const recovery = readDurableTaskExecution(store, prepared.definition.runId);
    if (recovery.status === ABSENT_RECOVERY_STATUS) {
        throw new DurableExecutionRecoveryAbsentError(prepared.definition.runId);
    }
    assertNoTaskWorldJournal(store.readOwner(prepared.definition.runId), prepared.definition.runId);
    const createdRecordId = retainDurableExecutionCreation(store, prepared);
    const command = store.append({
        append_intent_id: createRecordId({ durable_control_command_id: options.commandId }),
        batch: {
            groups: [
                {
                    caused_by_record_ids: [createdRecordId],
                    owner_id: prepared.definition.runId,
                    records: [
                        {
                            body: createDurableRecoveryCommand(
                                prepared.definition.runId,
                                options.commandId,
                            ),
                            mode: CAPTURE_MODE,
                            schema_ref: runProtocolConfig.execution.controlCommandSchemaId,
                            witness_ref: ROOT_WITNESS_ID,
                        },
                    ],
                },
            ],
        },
    });
    const commandRecordId = command.record_ids[0] as RecordId;
    const result = await executeTaskDurablyWithRecoveryCommand(
        store,
        options.execution,
        commandRecordId,
    );
    return Object.freeze({
        command: Object.freeze({ command_id: options.commandId, record_id: commandRecordId }),
        result,
    });
}

function assertNoTaskWorldJournal(records: readonly OwnerRecord[], runId: string): void {
    if (
        records.some((record) =>
            workspaceProtocolConfig.worldTaskCapture.journalReaders.some(
                ({ schemaId }) => schemaId === record.envelope.schema_ref,
            ),
        )
    ) {
        throw new DurableExecutionRecoveryError(runId);
    }
}

function assertRecoveryOptions(
    value: unknown,
): asserts value is DurableTaskRecoveryOptions<TaskSchema<unknown>, TaskSchema<unknown>> {
    if (
        typeof value !== "object" ||
        value === null ||
        Array.isArray(value) ||
        Object.getPrototypeOf(value) !== Object.prototype ||
        Object.keys(value).length !== 2 ||
        !("commandId" in value) ||
        !("execution" in value)
    ) {
        throw new TypeError("durable recovery options must contain only commandId and execution");
    }
    assertNonEmptyString(value.commandId, "commandId");
}

function readPauseOptions(value: unknown): DurableTaskPauseOptions {
    const fields = readRunDataObject(
        value,
        ["commandId", "expectedLifecycleRecordId", "fencingToken", "reason", "runId"],
        "durable pause options",
    );
    assertRunText(fields.commandId, "commandId");
    assertRecordId(fields.expectedLifecycleRecordId, "expectedLifecycleRecordId");
    assertRunText(fields.reason, "reason");
    assertRunText(fields.runId, "runId");
    if (!Number.isSafeInteger(fields.fencingToken) || (fields.fencingToken as number) <= 0) {
        throw new TypeError("fencingToken must be a positive safe integer");
    }
    return fields as DurableTaskPauseOptions;
}

function readCancellationOptions(value: unknown): DurableTaskCancellationOptions {
    const fields = readRunDataObject(
        value,
        ["commandId", "expectedLifecycleRecordId", "fencingToken", "reason", "runId"],
        "durable cancellation options",
    );
    assertRunText(fields.commandId, "commandId");
    assertRecordId(fields.expectedLifecycleRecordId, "expectedLifecycleRecordId");
    assertRunText(fields.reason, "reason");
    assertRunText(fields.runId, "runId");
    if (!Number.isSafeInteger(fields.fencingToken) || (fields.fencingToken as number) <= 0) {
        throw new TypeError("fencingToken must be a positive safe integer");
    }
    return fields as DurableTaskCancellationOptions;
}

function readDirectCancellationOptions(value: unknown): DurableTaskDirectCancellationOptions {
    const fields = readRunDataObject(
        value,
        ["commandId", "expectedLifecycleRecordId", "reason", "runId"],
        "durable direct cancellation options",
    );
    assertRunText(fields.commandId, "commandId");
    assertRecordId(fields.expectedLifecycleRecordId, "expectedLifecycleRecordId");
    assertRunText(fields.reason, "reason");
    assertRunText(fields.runId, "runId");
    return fields as DurableTaskDirectCancellationOptions;
}

function createCancelledExecution(
    runId: string,
    creation: ReturnType<typeof readDurableCreation>,
    started: boolean,
): DurableTaskExecutionResult["execution"] {
    const cancellationReason = runProtocolConfig.control.cancellationReason;
    const control = Object.freeze({
        consumed: Object.freeze({
            costUsd: 0,
            effects: 0,
            inputTokens: 0,
            outputTokens: 0,
            turns: started ? 1 : 0,
        }),
        reason: Object.freeze({ message: cancellationReason, type: CANCELLED_REASON_TYPE }),
        status: CANCELLED_CONTROL_STATUS,
    });
    return Object.freeze({
        artifacts: Object.freeze([]),
        control,
        outcome: createRunOutcome({
            outcome: { reason: cancellationReason, status: CANCELLED_TERMINAL_STATUS },
            runId,
            taskArtifactLock: creation.taskArtifactLock,
        }),
        provider: creation.provider,
        usage: null,
    });
}

function readCancellationAcknowledgementOptions(
    value: unknown,
): DurableTaskCancellationAcknowledgementOptions {
    const fields = readRunDataObject(
        value,
        ["cancelCommandRecordId", "claimId", "expectedLifecycleRecordId", "fencingToken", "runId"],
        "durable cancellation acknowledgement options",
    );
    assertRecordId(fields.cancelCommandRecordId, "cancelCommandRecordId");
    assertRunText(fields.claimId, "claimId");
    assertRecordId(fields.expectedLifecycleRecordId, "expectedLifecycleRecordId");
    assertRunText(fields.runId, "runId");
    if (!Number.isSafeInteger(fields.fencingToken) || (fields.fencingToken as number) <= 0) {
        throw new TypeError("fencingToken must be a positive safe integer");
    }
    return fields as DurableTaskCancellationAcknowledgementOptions;
}

function readResumeOptions(value: unknown): DurableTaskResumeOptions {
    const fields = readRunDataObject(
        value,
        ["commandId", "continuationDescriptorRecordId", "expectedLifecycleRecordId", "runId"],
        "durable resume options",
        ["prerequisiteSatisfaction"],
    );
    assertRunText(fields.commandId, "commandId");
    assertRecordId(fields.continuationDescriptorRecordId, "continuationDescriptorRecordId");
    assertRecordId(fields.expectedLifecycleRecordId, "expectedLifecycleRecordId");
    assertRunText(fields.runId, "runId");
    if (fields.prerequisiteSatisfaction === undefined) {
        return fields as DurableTaskResumeOptions;
    }
    const satisfaction = readRunDataObject(
        fields.prerequisiteSatisfaction,
        ["kind", "prerequisiteId", "receiptId"],
        "durable prerequisite satisfaction",
    );
    assertRunText(satisfaction.kind, "prerequisiteSatisfaction.kind");
    assertRunText(satisfaction.prerequisiteId, "prerequisiteSatisfaction.prerequisiteId");
    assertRunText(satisfaction.receiptId, "prerequisiteSatisfaction.receiptId");
    return Object.freeze({
        ...fields,
        prerequisiteSatisfaction: Object.freeze(satisfaction),
    }) as DurableTaskResumeOptions;
}

function readCheckpointOptions(value: unknown): RunContinuationCheckpointOptions {
    const fields = readRunDataObject(
        value,
        ["adapters", "expectedLifecycleRecordId", "runId", "traceCutId"],
        "continuation checkpoint options",
    );
    assertRecordId(fields.expectedLifecycleRecordId, "expectedLifecycleRecordId");
    assertRunText(fields.runId, "runId");
    assertRunText(fields.traceCutId, "traceCutId");
    if (
        !Array.isArray(fields.adapters) ||
        fields.adapters.length !== runProtocolConfig.execution.continuationConstituentKinds.length
    ) {
        throw new TypeError("checkpoint adapters must cover every configured constituent");
    }
    const adapters = fields.adapters.map((candidate) => {
        const adapter = readRunDataObject(
            candidate,
            ["checkpoint", "kind"],
            "continuation checkpoint adapter",
        );
        return Object.freeze({
            checkpoint: adapter.checkpoint,
            kind: adapter.kind,
        }) as RunContinuationCheckpointAdapter;
    });
    return Object.freeze({
        adapters: Object.freeze(adapters),
        expectedLifecycleRecordId: fields.expectedLifecycleRecordId,
        runId: fields.runId,
        traceCutId: fields.traceCutId,
    }) as RunContinuationCheckpointOptions;
}

function readSuspensionOptions(value: unknown): DurableTaskSuspensionOptions {
    const fields = readRunDataObject(
        value,
        [
            "constituents",
            "expectedLifecycleRecordId",
            "fencingToken",
            "pauseCommandRecordId",
            "runId",
            "traceCutId",
        ],
        "durable suspension options",
    );
    assertRecordId(fields.expectedLifecycleRecordId, "expectedLifecycleRecordId");
    assertRecordId(fields.pauseCommandRecordId, "pauseCommandRecordId");
    assertRunText(fields.runId, "runId");
    assertRunText(fields.traceCutId, "traceCutId");
    if (!Number.isSafeInteger(fields.fencingToken) || (fields.fencingToken as number) <= 0) {
        throw new TypeError("fencingToken must be a positive safe integer");
    }
    if (
        !Array.isArray(fields.constituents) ||
        fields.constituents.length !==
            runProtocolConfig.execution.continuationConstituentKinds.length
    ) {
        throw new TypeError("suspension requires every configured continuation constituent");
    }
    const [, , unavailableStatus] = runProtocolConfig.execution.continuationEvidenceStatuses;
    const constituents = fields.constituents.map((candidate, index) => {
        const evidence = readCheckpointEvidence(
            candidate,
            runProtocolConfig.execution.continuationConstituentKinds[index],
        );
        if (evidence.status === unavailableStatus) {
            throw new TypeError("suspension requires available continuation evidence");
        }
        return evidence;
    });
    return Object.freeze({
        constituents: Object.freeze(constituents),
        expectedLifecycleRecordId: fields.expectedLifecycleRecordId,
        fencingToken: fields.fencingToken,
        pauseCommandRecordId: fields.pauseCommandRecordId,
        runId: fields.runId,
        traceCutId: fields.traceCutId,
    }) as DurableTaskSuspensionOptions;
}

function readWaitingOptions(value: unknown): DurableTaskWaitingOptions {
    const fields = readRunDataObject(
        value,
        [
            "constituents",
            "expectedLifecycleRecordId",
            "fencingToken",
            "prerequisite",
            "runId",
            "traceCutId",
        ],
        "durable waiting options",
    );
    assertRecordId(fields.expectedLifecycleRecordId, "expectedLifecycleRecordId");
    assertRunText(fields.runId, "runId");
    assertRunText(fields.traceCutId, "traceCutId");
    if (!Number.isSafeInteger(fields.fencingToken) || (fields.fencingToken as number) <= 0) {
        throw new TypeError("fencingToken must be a positive safe integer");
    }
    const prerequisite = readRunDataObject(
        fields.prerequisite,
        ["kind", "prerequisiteId"],
        "durable waiting prerequisite",
    );
    assertRunText(prerequisite.kind, "prerequisite.kind");
    assertRunText(prerequisite.prerequisiteId, "prerequisite.prerequisiteId");
    if (
        !Array.isArray(fields.constituents) ||
        fields.constituents.length !==
            runProtocolConfig.execution.continuationConstituentKinds.length
    ) {
        throw new TypeError("waiting requires every configured continuation constituent");
    }
    const [, , unavailableStatus] = runProtocolConfig.execution.continuationEvidenceStatuses;
    const constituents = fields.constituents.map((candidate, index) => {
        const evidence = readCheckpointEvidence(
            candidate,
            runProtocolConfig.execution.continuationConstituentKinds[index],
        );
        if (evidence.status === unavailableStatus) {
            throw new TypeError("waiting requires available continuation evidence");
        }
        return evidence;
    });
    return Object.freeze({
        constituents: Object.freeze(constituents),
        expectedLifecycleRecordId: fields.expectedLifecycleRecordId,
        fencingToken: fields.fencingToken,
        prerequisite: Object.freeze({
            kind: prerequisite.kind,
            prerequisiteId: prerequisite.prerequisiteId,
        }),
        runId: fields.runId,
        traceCutId: fields.traceCutId,
    }) as DurableTaskWaitingOptions;
}

function readCheckpointEvidence(
    value: unknown,
    expectedKind: string | undefined,
): RunContinuationCheckpointEvidence {
    const fields = readRunDataObject(
        value,
        ["kind", "status"],
        "continuation checkpoint evidence",
        ["receipt_id"],
    );
    if (
        fields.kind !== expectedKind ||
        typeof fields.status !== "string" ||
        !runProtocolConfig.execution.continuationEvidenceStatuses.includes(fields.status)
    ) {
        throw new TypeError("continuation checkpoint evidence is inconsistent");
    }
    const verified = fields.status === runProtocolConfig.execution.continuationVerifiedStatus;
    if (verified) {
        assertRunText(fields.receipt_id, "continuation checkpoint receipt identity");
    } else if (fields.receipt_id !== undefined) {
        throw new TypeError("receiptless continuation checkpoint evidence must omit receipt_id");
    }
    return Object.freeze({
        kind: fields.kind,
        ...(verified ? { receipt_id: fields.receipt_id } : {}),
        status: fields.status,
    }) as RunContinuationCheckpointEvidence;
}
