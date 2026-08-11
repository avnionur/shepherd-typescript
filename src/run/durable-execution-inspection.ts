import { runProtocolConfig } from "../protocol/config.ts";
import {
    DURABLE_EXECUTION_RECOVERY_STATUSES,
    RECORD_MODES,
    RUN_LIFECYCLE_SUSPENDED_STATUS,
    RUN_LIFECYCLE_WAITING_STATUS,
} from "../protocol/values.generated.ts";
import { assertRecordId } from "../record/guards.ts";
import { ROOT_WITNESS_ID } from "../record/root-witness.ts";
import type { RecordId } from "../record/types.ts";
import { TraceStoreError } from "../store/errors.ts";
import type { SQLiteTraceStore } from "../store/sqlite-trace-store.ts";
import type { Cut, OwnerRecord, RetainedRecord } from "../store/types.ts";
import type { RunArtifact } from "./artifact-types.ts";
import {
    readDurablePauseCommand,
    readDurableResumeCommand,
} from "./durable-execution-control-codec.ts";
import type {
    DurableTaskExecutionContinuationConstituentInspection,
    DurableTaskExecutionInspection,
    DurableTaskExecutionQuiescentInspection,
} from "./durable-execution-inspection-types.ts";
import {
    assertDurableExecutionRecordContract,
    readDurableTaskExecution,
} from "./durable-execution-recovery.ts";
import type { TaskExecutionLedgerReceipt } from "./durable-execution-types.ts";
import type { TaskExecutionResult } from "./execution-types.ts";
import type { RunUsage } from "./usage-types.ts";
import { assertRunText, readRunDataObject } from "./validation-values.ts";

const [CAPTURE_MODE] = RECORD_MODES;
const [ABSENT_STATUS, CREATED_STATUS, STARTED_STATUS, TERMINAL_PENDING_CUT_STATUS] =
    DURABLE_EXECUTION_RECOVERY_STATUSES;

type IncompleteLifecycleInspection = {
    readonly quiescent: DurableTaskExecutionQuiescentInspection | null;
    readonly recordIds: readonly RecordId[];
    readonly runningContinuationRecordId: RecordId | null;
};

/**
 * Projects validated durable task-execution evidence into an immutable inspection view.
 *
 * The view is rebuilt from canonical retained records on every call. It stores no materialized
 * state, never invokes a provider, and uses the same fail-closed validation as durable recovery.
 * Later owner records outside the terminal evidence chain do not change a committed view.
 *
 * @param store - Open trace store containing durable task-execution evidence.
 * @param runId - Stable durable run owner to inspect.
 * @returns Lifecycle, quiescent continuation, artifact, usage, outcome, cut, and causal evidence.
 * @throws {TypeError} If the run identity is malformed.
 * @throws {TraceStoreError} If retained evidence is missing, malformed, or inconsistent.
 *
 * @example
 * ```ts
 * const inspection = inspectDurableTaskExecution(store, "run:greet:1");
 * if (inspection.status === "committed") {
 *     inspection.artifacts;
 *     inspection.causal_edges;
 * }
 * ```
 *
 * @public
 */
export function inspectDurableTaskExecution(
    store: SQLiteTraceStore,
    runId: string,
): DurableTaskExecutionInspection {
    const recovery = readDurableTaskExecution(store, runId);
    if (recovery.status === ABSENT_STATUS) {
        return createIncompleteInspection(store, runId, recovery.status, null, null);
    }
    if (recovery.status === CREATED_STATUS) {
        return createIncompleteInspection(
            store,
            runId,
            recovery.status,
            recovery.created_record_id,
            null,
        );
    }
    if (recovery.status === STARTED_STATUS) {
        return createIncompleteInspection(
            store,
            runId,
            recovery.status,
            recovery.created_record_id,
            recovery.started_record_id,
        );
    }
    if (recovery.status === TERMINAL_PENDING_CUT_STATUS) {
        return createTerminalInspection(
            store,
            runId,
            recovery.status,
            recovery.execution,
            recovery.ledger,
            null,
        );
    }
    return createTerminalInspection(
        store,
        runId,
        recovery.status,
        recovery.result.execution,
        recovery.result.ledger,
        recovery.result.ledger.cut,
    );
}

function createIncompleteInspection(
    store: SQLiteTraceStore,
    runId: string,
    status: DurableTaskExecutionInspection["status"],
    createdRecordId: RecordId | null,
    startedRecordId: RecordId | null,
): DurableTaskExecutionInspection {
    const continuation = readIncompleteLifecycleInspection(store, runId, startedRecordId);
    const recordIds = [createdRecordId, startedRecordId, ...continuation.recordIds].filter(
        (recordId): recordId is RecordId => recordId !== null,
    );
    return Object.freeze({
        artifacts: Object.freeze([]),
        causal_edges: readCausalEdges(store, recordIds),
        cut: null,
        lifecycle: Object.freeze({
            created_record_id: createdRecordId,
            quiescent: continuation.quiescent,
            running_continuation_record_id: continuation.runningContinuationRecordId,
            started_record_id: startedRecordId,
            terminal_record_id: null,
            terminal_schema_ref: null,
        }),
        outcome: null,
        run_id: runId,
        status,
        usage: null,
    });
}

function createTerminalInspection(
    store: SQLiteTraceStore,
    runId: string,
    status: DurableTaskExecutionInspection["status"],
    execution: TaskExecutionResult,
    ledger: Omit<TaskExecutionLedgerReceipt, "cut">,
    cut: Cut | null,
): DurableTaskExecutionInspection {
    const recordIds = [
        ledger.created_record_id,
        ...(ledger.started_record_id === null ? [] : [ledger.started_record_id]),
        ...ledger.artifact_record_ids,
        ...(ledger.usage_record_id === null ? [] : [ledger.usage_record_id]),
        ledger.outcome_record_id,
        ledger.lifecycle_record_id,
        ...(cut === null ? [] : [cut.created_by_record_id]),
    ];
    const terminalRecord = readRequiredRecord(store, ledger.lifecycle_record_id);
    return Object.freeze({
        artifacts: Object.freeze(
            ledger.artifact_record_ids.map((recordId, index) =>
                Object.freeze({
                    artifact: execution.artifacts[index] as RunArtifact,
                    record_id: recordId,
                }),
            ),
        ),
        causal_edges: readCausalEdges(store, recordIds),
        cut,
        lifecycle: Object.freeze({
            created_record_id: ledger.created_record_id,
            quiescent: null,
            running_continuation_record_id: null,
            started_record_id: ledger.started_record_id,
            terminal_record_id: ledger.lifecycle_record_id,
            terminal_schema_ref: terminalRecord.envelope.schema_ref,
        }),
        outcome: Object.freeze({
            outcome: execution.outcome,
            record_id: ledger.outcome_record_id,
        }),
        run_id: runId,
        status,
        usage:
            ledger.usage_record_id === null
                ? null
                : Object.freeze({
                      record_id: ledger.usage_record_id,
                      usage: execution.usage as RunUsage,
                  }),
    });
}

function readIncompleteLifecycleInspection(
    store: SQLiteTraceStore,
    runId: string,
    startedRecordId: RecordId | null,
): IncompleteLifecycleInspection {
    try {
        const ownerRecords = store.readOwner(runId);
        if (
            new Set(ownerRecords.map((record) => record.envelope.record_id)).size !==
            ownerRecords.length
        ) {
            throw new TypeError("durable lifecycle owner evidence contains duplicate records");
        }
        const descriptors = ownerRecords.filter(
            (record) =>
                record.envelope.schema_ref === runProtocolConfig.schemas.continuationDescriptorId,
        );
        const lifecycleRecords = ownerRecords.filter((record) => {
            return (
                record.envelope.schema_ref === runProtocolConfig.schemas.waitingLifecycleId ||
                record.envelope.schema_ref === runProtocolConfig.schemas.suspendedLifecycleId ||
                record.envelope.schema_ref === runProtocolConfig.schemas.runningLifecycleId
            );
        });
        if (lifecycleRecords.length === 0) {
            if (descriptors.length > 0) {
                throw new TypeError("durable continuation descriptor lacks lifecycle evidence");
            }
            return Object.freeze({
                quiescent: null,
                recordIds: Object.freeze([]),
                runningContinuationRecordId: null,
            });
        }
        if (startedRecordId === null) {
            throw new TypeError("durable quiescent lifecycle evidence is incomplete or ambiguous");
        }
        const acknowledgement = lifecycleRecords.at(-1) as OwnerRecord;
        if (acknowledgement.envelope.schema_ref === runProtocolConfig.schemas.runningLifecycleId) {
            return readRunningContinuationInspection(runId, ownerRecords, acknowledgement);
        }
        const waiting =
            acknowledgement.envelope.schema_ref === runProtocolConfig.schemas.waitingLifecycleId;
        const acknowledgementFields = readRunDataObject(
            acknowledgement.body,
            waiting
                ? [
                      "lifecycle_version",
                      "execution_id",
                      "status",
                      "continuation_descriptor_id",
                      "prerequisite",
                  ]
                : [
                      "lifecycle_version",
                      "execution_id",
                      "status",
                      "continuation_descriptor_id",
                      "pause_command_id",
                  ],
            "durable quiescent acknowledgement",
        );
        const expectedStatus = waiting
            ? runProtocolConfig.execution.lifecycleWaitingStatus
            : runProtocolConfig.execution.lifecycleSuspendedStatus;
        assertRecordId(
            acknowledgementFields.continuation_descriptor_id,
            "durable quiescent continuation descriptor identity",
        );
        const descriptor = ownerRecords.find(
            (record) =>
                record.envelope.record_id === acknowledgementFields.continuation_descriptor_id,
        );
        if (
            descriptor === undefined ||
            descriptor.envelope.schema_ref !== runProtocolConfig.schemas.continuationDescriptorId
        ) {
            throw new TypeError("durable continuation descriptor evidence is missing");
        }
        if (
            acknowledgementFields.lifecycle_version !==
                runProtocolConfig.execution.lifecycleVersion ||
            acknowledgementFields.execution_id !== runId ||
            acknowledgementFields.status !== expectedStatus ||
            acknowledgementFields.continuation_descriptor_id !== descriptor.envelope.record_id
        ) {
            throw new TypeError("durable quiescent acknowledgement identity is inconsistent");
        }
        if (
            acknowledgement.view.append_intent_id === undefined ||
            acknowledgement.view.append_intent_id !== descriptor.view.append_intent_id
        ) {
            throw new TypeError(
                "durable quiescent acknowledgement must commit with its continuation descriptor",
            );
        }
        const descriptorFields = readRunDataObject(
            descriptor.body,
            ["continuation_version", "execution_id", "trace_cut_id", "constituents"],
            "durable continuation descriptor",
        );
        assertRunText(descriptorFields.trace_cut_id, "durable continuation trace cut identity");
        if (
            descriptorFields.continuation_version !==
                runProtocolConfig.execution.continuationVersion ||
            descriptorFields.execution_id !== runId
        ) {
            throw new TypeError("durable continuation descriptor identity is inconsistent");
        }
        const traceCut = store.readCut(descriptorFields.trace_cut_id);
        if (traceCut.target_owner_id !== runId || traceCut.through_record_id !== startedRecordId) {
            throw new TypeError("durable continuation trace cut is inconsistent");
        }
        assertDurableExecutionRecordContract(descriptor, CAPTURE_MODE, ROOT_WITNESS_ID, [
            traceCut.created_by_record_id,
        ]);
        const constituents = readContinuationConstituents(descriptorFields.constituents);
        if (waiting) {
            assertDurableExecutionRecordContract(acknowledgement, CAPTURE_MODE, ROOT_WITNESS_ID, [
                startedRecordId,
                descriptor.envelope.record_id,
            ]);
            const prerequisiteFields = readRunDataObject(
                acknowledgementFields.prerequisite,
                ["prerequisite_id", "kind"],
                "durable waiting prerequisite",
            );
            assertRunText(prerequisiteFields.prerequisite_id, "durable prerequisite identity");
            assertRunText(prerequisiteFields.kind, "durable prerequisite kind");
            const quiescent = Object.freeze({
                acknowledgement_record_id: acknowledgement.envelope.record_id,
                acknowledgement_schema_ref: acknowledgement.envelope.schema_ref,
                continuation: Object.freeze({
                    constituents,
                    record_id: descriptor.envelope.record_id,
                    trace_cut: traceCut,
                }),
                pause_command_record_id: null,
                prerequisite: Object.freeze({
                    kind: prerequisiteFields.kind,
                    prerequisite_id: prerequisiteFields.prerequisite_id,
                }),
                status: RUN_LIFECYCLE_WAITING_STATUS,
            });
            return freezeIncompleteLifecycle(quiescent, [
                traceCut.created_by_record_id,
                descriptor.envelope.record_id,
                acknowledgement.envelope.record_id,
            ]);
        }
        assertRunText(
            acknowledgementFields.pause_command_id,
            "durable suspension pause command identity",
        );
        const pauseCommand = ownerRecords.find(
            (record) => record.envelope.record_id === acknowledgementFields.pause_command_id,
        );
        if (pauseCommand === undefined) {
            throw new TypeError("durable suspension pause command evidence is missing");
        }
        if (
            pauseCommand.envelope.schema_ref !== runProtocolConfig.execution.controlCommandSchemaId
        ) {
            throw new TypeError("durable suspension pause command schema is inconsistent");
        }
        assertDurableExecutionRecordContract(pauseCommand, CAPTURE_MODE, ROOT_WITNESS_ID, [
            startedRecordId,
        ]);
        const pause = readDurablePauseCommand(pauseCommand.body, runId);
        if (pause.expected_lifecycle_record_id !== startedRecordId) {
            throw new TypeError("durable suspension pause command lifecycle head is inconsistent");
        }
        assertDurableExecutionRecordContract(acknowledgement, CAPTURE_MODE, ROOT_WITNESS_ID, [
            startedRecordId,
            pauseCommand.envelope.record_id,
            descriptor.envelope.record_id,
        ]);
        const quiescent = Object.freeze({
            acknowledgement_record_id: acknowledgement.envelope.record_id,
            acknowledgement_schema_ref: acknowledgement.envelope.schema_ref,
            continuation: Object.freeze({
                constituents,
                record_id: descriptor.envelope.record_id,
                trace_cut: traceCut,
            }),
            pause_command_record_id: pauseCommand.envelope.record_id,
            prerequisite: null,
            status: RUN_LIFECYCLE_SUSPENDED_STATUS,
        });
        return freezeIncompleteLifecycle(quiescent, [
            traceCut.created_by_record_id,
            pauseCommand.envelope.record_id,
            descriptor.envelope.record_id,
            acknowledgement.envelope.record_id,
        ]);
    } catch (error) {
        if (error instanceof TraceStoreError) {
            throw error;
        }
        throw new TraceStoreError("durable execution quiescent evidence is malformed", {
            cause: error,
        });
    }
}

function readRunningContinuationInspection(
    runId: string,
    ownerRecords: readonly OwnerRecord[],
    running: OwnerRecord,
): IncompleteLifecycleInspection {
    const fields = readRunDataObject(
        running.body,
        [
            "claim_id",
            "continuation_descriptor_id",
            "execution_id",
            "fencing_token",
            "lease_expires_at",
            "lifecycle_version",
            "resume_command_id",
            "status",
        ],
        "durable running continuation",
    );
    assertRunText(fields.claim_id, "durable running continuation claim identity");
    assertRecordId(
        fields.continuation_descriptor_id,
        "durable running continuation descriptor identity",
    );
    assertRecordId(fields.resume_command_id, "durable resume command record identity");
    if (
        fields.execution_id !== runId ||
        fields.lifecycle_version !== runProtocolConfig.execution.lifecycleVersion ||
        fields.status !== runProtocolConfig.execution.lifecycleRunningStatus ||
        !Number.isSafeInteger(fields.fencing_token) ||
        (fields.fencing_token as number) <= 0 ||
        !Number.isSafeInteger(fields.lease_expires_at) ||
        (fields.lease_expires_at as number) < 0
    ) {
        throw new TypeError("durable running continuation identity is inconsistent");
    }
    const descriptor = ownerRecords.find(
        (record) => record.envelope.record_id === fields.continuation_descriptor_id,
    );
    const command = ownerRecords.find(
        (record) => record.envelope.record_id === fields.resume_command_id,
    );
    if (
        descriptor === undefined ||
        descriptor.envelope.schema_ref !== runProtocolConfig.schemas.continuationDescriptorId ||
        command === undefined ||
        command.envelope.schema_ref !== runProtocolConfig.execution.controlCommandSchemaId
    ) {
        throw new TypeError("durable running continuation evidence is missing");
    }
    const resume = readDurableResumeCommand(command.body, runId);
    const suspension = ownerRecords.find(
        (record) => record.envelope.record_id === resume.expected_lifecycle_record_id,
    );
    if (
        resume.continuation_descriptor_id !== descriptor.envelope.record_id ||
        suspension === undefined ||
        suspension.envelope.schema_ref !== runProtocolConfig.schemas.suspendedLifecycleId
    ) {
        throw new TypeError("durable resume command authority is inconsistent");
    }
    assertDurableExecutionRecordContract(command, CAPTURE_MODE, ROOT_WITNESS_ID, [
        suspension.envelope.record_id,
        descriptor.envelope.record_id,
    ]);
    assertDurableExecutionRecordContract(running, CAPTURE_MODE, ROOT_WITNESS_ID, [
        suspension.envelope.record_id,
        descriptor.envelope.record_id,
        command.envelope.record_id,
    ]);
    return Object.freeze({
        quiescent: null,
        recordIds: Object.freeze([
            descriptor.envelope.record_id,
            suspension.envelope.record_id,
            command.envelope.record_id,
            running.envelope.record_id,
        ]),
        runningContinuationRecordId: running.envelope.record_id,
    });
}

function freezeIncompleteLifecycle(
    quiescent: DurableTaskExecutionQuiescentInspection,
    recordIds: readonly RecordId[],
): IncompleteLifecycleInspection {
    return Object.freeze({
        quiescent,
        recordIds: Object.freeze(recordIds),
        runningContinuationRecordId: null,
    });
}

function readContinuationConstituents(
    value: unknown,
): readonly DurableTaskExecutionContinuationConstituentInspection[] {
    if (
        !Array.isArray(value) ||
        value.length !== runProtocolConfig.execution.continuationConstituentKinds.length
    ) {
        throw new TypeError("durable continuation constituents are incomplete");
    }
    return Object.freeze(
        value.map((candidate, index) => {
            const expectedKind = runProtocolConfig.execution.continuationConstituentKinds[index];
            const fields = readRunDataObject(
                candidate,
                ["kind", "status"],
                "durable continuation constituent",
                ["receipt_id"],
            );
            if (
                fields.kind !== expectedKind ||
                typeof fields.status !== "string" ||
                !runProtocolConfig.execution.continuationEvidenceStatuses.includes(fields.status)
            ) {
                throw new TypeError("durable continuation constituent is inconsistent");
            }
            const verified =
                fields.status === runProtocolConfig.execution.continuationVerifiedStatus;
            if (verified) {
                assertRunText(fields.receipt_id, "durable continuation receipt identity");
            } else if (fields.receipt_id !== undefined) {
                throw new TypeError("receiptless continuation evidence must not cite a receipt");
            }
            return Object.freeze({
                kind: expectedKind as DurableTaskExecutionContinuationConstituentInspection["kind"],
                receipt_id: verified ? (fields.receipt_id as string) : null,
                status: fields.status as DurableTaskExecutionContinuationConstituentInspection["status"],
            });
        }),
    );
}

function readCausalEdges(
    store: SQLiteTraceStore,
    recordIds: readonly RecordId[],
): readonly (readonly [RecordId, RecordId])[] {
    return Object.freeze(
        recordIds.flatMap((recordId) => {
            const record = readRequiredRecord(store, recordId);
            return record.envelope.caused_by_record_ids.map((causeRecordId) =>
                Object.freeze([causeRecordId, recordId] as const),
            );
        }),
    );
}

function readRequiredRecord(store: SQLiteTraceStore, recordId: RecordId): RetainedRecord {
    const record = store.readRecord(recordId);
    if (record === undefined) {
        throw new TraceStoreError("durable execution inspection evidence is missing");
    }
    return record;
}
