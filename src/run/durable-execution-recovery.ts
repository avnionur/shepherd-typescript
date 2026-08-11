import {
    canonicalizeRecord,
    createRecordId,
    type SemanticRecord,
} from "../canonical/canonical-record.ts";
import {
    kernelProtocolConfig,
    projectionProtocolConfig,
    runProtocolConfig,
} from "../protocol/config.ts";
import {
    DURABLE_EXECUTION_RECOVERY_STATUSES,
    RECORD_MODES,
    RUN_ARTIFACT_CONTENT_TYPES,
    RUN_TERMINAL_STATUSES,
} from "../protocol/values.generated.ts";
import { ROOT_WITNESS_ID } from "../record/root-witness.ts";
import { TraceStoreError } from "../store/errors.ts";
import type { SQLiteTraceStore } from "../store/sqlite-trace-store.ts";
import type { OwnerRecord } from "../store/types.ts";
import { readDurableCreation, readDurableExecutionResult } from "./durable-execution-codec.ts";
import {
    readDurableCancellationCommand,
    readDurableRecoveryCommand,
} from "./durable-execution-control-codec.ts";
import { createDurableExecutionCutId } from "./durable-execution-cut.ts";
import type {
    DurableTaskExecutionRecovery,
    DurableTaskExecutionResult,
    TaskExecutionLedgerReceipt,
} from "./durable-execution-types.ts";
import { assertRunText, readRunDataObject } from "./validation-values.ts";

const [FINISHED_STATUS, FAILED_STATUS, , CANCELLED_STATUS] = RUN_TERMINAL_STATUSES;
const [, BLOB_ARTIFACT_TYPE] = RUN_ARTIFACT_CONTENT_TYPES;
const [CAPTURE_MODE, DECLARATION_MODE] = RECORD_MODES;
const [
    ABSENT_RECOVERY_STATUS,
    CREATED_RECOVERY_STATUS,
    STARTED_RECOVERY_STATUS,
    TERMINAL_PENDING_CUT_STATUS,
    COMMITTED_RECOVERY_STATUS,
] = DURABLE_EXECUTION_RECOVERY_STATUSES;

/**
 * Reads and classifies retained evidence for one durable task execution.
 *
 * @param store - Open trace store containing execution evidence.
 * @param runId - Stable run owner to inspect.
 * @returns A frozen absent, incomplete, terminal-pending-cut, or committed recovery value.
 * @throws {TypeError} If the run identity is malformed.
 * @throws {TraceStoreError} If retained execution evidence is malformed or inconsistent.
 *
 * @public
 */
export function readDurableTaskExecution(
    store: SQLiteTraceStore,
    runId: string,
): DurableTaskExecutionRecovery {
    assertRunText(runId, "runId");
    const records = store.readOwner(runId);
    try {
        const terminalBoundary = records.find(isLifecycleTerminal);
        const executionRecords =
            terminalBoundary === undefined
                ? records
                : records.filter(
                      (record) => record.view.owner_ordinal <= terminalBoundary.view.owner_ordinal,
                  );
        const schemas = projectionProtocolConfig.executionHistory.executionSchemas;
        const created = uniqueRecord(executionRecords, schemas.created, "creation");
        if (created === undefined) {
            if (records.some(isDurableExecutionRecord)) {
                throw new TypeError("durable execution evidence is missing its creation record");
            }
            return Object.freeze({ run_id: runId, status: ABSENT_RECOVERY_STATUS });
        }
        assertDurableExecutionRecordContract(created, DECLARATION_MODE, ROOT_WITNESS_ID, []);
        const payload = readPayload(created, "durable creation");
        const creation = readDurableCreation(payload, runId);
        const started = uniqueRecord(executionRecords, schemas.started, "start");
        if (started !== undefined) {
            assertRecoveryTransitionContract(
                started,
                records,
                created.envelope.record_id,
                created.envelope.record_id,
                runId,
            );
            const startedPayload = readRunDataObject(
                readRunDataObject(started.body, ["payload"], "durable start body").payload,
                ["execution_id"],
                "durable start payload",
            );
            if (startedPayload.execution_id !== runId) {
                throw new TypeError("durable start identity is inconsistent");
            }
        }
        const outcome = uniqueRecord(
            executionRecords,
            runProtocolConfig.schemas.outcomeId,
            "outcome",
        );
        const usage = uniqueRecord(executionRecords, runProtocolConfig.schemas.usageId, "usage");
        const retainedArtifacts = executionRecords.filter(
            (record) => record.envelope.schema_ref === runProtocolConfig.schemas.artifactId,
        );
        const terminal = uniqueTerminal(executionRecords);
        if (outcome === undefined && terminal === undefined) {
            if (usage !== undefined || retainedArtifacts.length > 0) {
                throw new TypeError("durable usage or artifact evidence has no terminal outcome");
            }
            return started === undefined
                ? Object.freeze({
                      created_record_id: created.envelope.record_id,
                      run_id: runId,
                      status: CREATED_RECOVERY_STATUS,
                  })
                : Object.freeze({
                      created_record_id: created.envelope.record_id,
                      run_id: runId,
                      started_record_id: started.envelope.record_id,
                      status: STARTED_RECOVERY_STATUS,
                  });
        }
        if (outcome === undefined || terminal === undefined) {
            throw new TypeError("durable terminal evidence is incomplete");
        }
        const terminalPayload = readPayload(terminal, "durable terminal");
        if (terminalPayload.execution_id !== runId) {
            throw new TypeError("durable terminal execution identity is inconsistent");
        }
        const baseRecordId = started?.envelope.record_id ?? created.envelope.record_id;
        const artifacts = readOutcomeArtifacts(
            executionRecords,
            retainedArtifacts,
            outcome,
            usage,
            terminal,
            baseRecordId,
        );
        const execution = readDurableExecutionResult(
            artifacts.map((artifact) => artifact.body),
            outcome.body,
            usage?.body ?? null,
            creation.provider,
            terminalPayload.control,
            creation.budget,
            started !== undefined,
            runId,
        );
        if (
            canonicalizeRecord(execution.outcome.task_artifact_lock) !==
            canonicalizeRecord(creation.taskArtifactLock)
        ) {
            throw new TypeError("durable outcome task lock disagrees with creation evidence");
        }
        if (
            started === undefined &&
            (usage !== undefined ||
                artifacts.length > 0 ||
                execution.outcome.outcome.status === FINISHED_STATUS ||
                execution.outcome.outcome.status === FAILED_STATUS)
        ) {
            throw new TypeError("durable terminal evidence requires a retained start record");
        }
        validateTerminalPayload(terminal, terminalPayload, execution);
        const cancellationCommandIds: readonly string[] =
            execution.outcome.outcome.status === CANCELLED_STATUS
                ? readCancellationCommandIds(executionRecords, outcome, baseRecordId, runId)
                : Object.freeze([]);
        for (const [index, artifact] of artifacts.entries()) {
            assertDurableExecutionRecordContract(artifact, CAPTURE_MODE, ROOT_WITNESS_ID, [
                baseRecordId,
                ...(index === 0 ? [] : [artifacts[index - 1]?.envelope.record_id as string]),
            ]);
            const reconstructed = execution.artifacts[index];
            if (reconstructed === undefined) {
                throw new TypeError("durable artifact reconstruction is incomplete");
            }
            if (reconstructed.content.type === BLOB_ARTIFACT_TYPE) {
                const content = store.readBlob(reconstructed.content.blob_id);
                if (
                    content === undefined ||
                    content.byteLength !== reconstructed.content.byte_length
                ) {
                    throw new TypeError("durable artifact blob receipt is unavailable");
                }
            }
        }
        if (usage !== undefined) {
            assertDurableExecutionRecordContract(usage, CAPTURE_MODE, ROOT_WITNESS_ID, [
                baseRecordId,
            ]);
        }
        assertDurableExecutionRecordContract(outcome, CAPTURE_MODE, ROOT_WITNESS_ID, [
            baseRecordId,
            ...cancellationCommandIds,
            ...artifacts.map((artifact) => artifact.envelope.record_id),
            ...(usage === undefined ? [] : [usage.envelope.record_id]),
        ]);
        assertDurableExecutionRecordContract(terminal, CAPTURE_MODE, ROOT_WITNESS_ID, [
            baseRecordId,
            ...cancellationCommandIds,
            outcome.envelope.record_id,
        ]);
        const evidence = Object.freeze({
            artifact_record_ids: Object.freeze(
                artifacts.map((artifact) => artifact.envelope.record_id),
            ),
            created_record_id: created.envelope.record_id,
            lifecycle_record_id: terminal.envelope.record_id,
            outcome_record_id: outcome.envelope.record_id,
            started: started !== undefined,
            started_record_id: started?.envelope.record_id ?? null,
            usage_record_id: usage?.envelope.record_id ?? null,
        });
        const cutRecord = findTerminalCut(
            records,
            runId,
            created.envelope.record_id,
            terminal.envelope.record_id,
        );
        if (cutRecord === undefined) {
            return Object.freeze({
                execution,
                ledger: evidence,
                run_id: runId,
                status: TERMINAL_PENDING_CUT_STATUS,
            });
        }
        const cutFields = readRunDataObject(
            cutRecord.body,
            [
                "cut_id",
                "publisher_owner_id",
                "target_owner_id",
                "through_owner_ordinal",
                "through_record_id",
            ],
            "durable terminal cut",
        );
        if (
            cutFields.cut_id !== createDurableExecutionCutId(runId, terminal.envelope.record_id) ||
            cutFields.publisher_owner_id !== runId
        ) {
            throw new TypeError("durable terminal cut targets inconsistent evidence");
        }
        const cut = store.readCut(cutFields.cut_id as string);
        const ledger: TaskExecutionLedgerReceipt = Object.freeze({ cut, ...evidence });
        const result: DurableTaskExecutionResult = Object.freeze({ execution, ledger });
        return Object.freeze({ result, run_id: runId, status: COMMITTED_RECOVERY_STATUS });
    } catch (error) {
        if (error instanceof TraceStoreError) {
            throw error;
        }
        throw new TraceStoreError("durable execution evidence is malformed", { cause: error });
    }
}

function readOutcomeArtifacts(
    records: readonly OwnerRecord[],
    retainedArtifacts: readonly OwnerRecord[],
    outcome: OwnerRecord,
    usage: OwnerRecord | undefined,
    terminal: OwnerRecord,
    baseRecordId: string,
): readonly OwnerRecord[] {
    const terminalArtifacts = retainedArtifacts.filter(
        (artifact) => artifact.view.owner_ordinal < terminal.view.owner_ordinal,
    );
    const parents = outcome.envelope.caused_by_record_ids;
    if (
        parents[0] !== baseRecordId ||
        (usage !== undefined && parents.at(-1) !== usage.envelope.record_id)
    ) {
        throw new TypeError("durable outcome causal boundary is inconsistent");
    }
    const controlCommandIds = new Set(
        records
            .filter(
                (record) =>
                    record.envelope.schema_ref ===
                    runProtocolConfig.execution.controlCommandSchemaId,
            )
            .map((record) => record.envelope.record_id),
    );
    const artifactRecordIds = parents
        .slice(1, usage === undefined ? undefined : -1)
        .filter((recordId) => !controlCommandIds.has(recordId));
    const artifacts = artifactRecordIds.map((recordId) => {
        const matches = terminalArtifacts.filter(
            (artifact) => artifact.envelope.record_id === recordId,
        );
        if (matches.length !== 1) {
            throw new TypeError("durable outcome artifact reference is inconsistent");
        }
        return matches[0] as OwnerRecord;
    });
    if (
        artifacts.length !== terminalArtifacts.length ||
        terminalArtifacts.some((artifact, index) => artifact !== artifacts[index])
    ) {
        throw new TypeError("durable terminal artifact evidence is orphaned or reordered");
    }
    return artifacts;
}

function readCancellationCommandIds(
    records: readonly OwnerRecord[],
    outcome: OwnerRecord,
    baseRecordId: string,
    runId: string,
): readonly string[] {
    const commands = records.filter(
        (record) =>
            record.envelope.schema_ref === runProtocolConfig.execution.controlCommandSchemaId &&
            outcome.envelope.caused_by_record_ids.includes(record.envelope.record_id),
    );
    if (commands.length === 0) {
        return Object.freeze([]);
    }
    if (commands.length !== 1) {
        throw new TypeError("durable cancellation outcome has ambiguous command authority");
    }
    const command = commands[0] as OwnerRecord;
    const body = readDurableCancellationCommand(command.body, runId);
    if (body.expected_lifecycle_record_id !== baseRecordId) {
        throw new TypeError("durable cancellation command lifecycle head is inconsistent");
    }
    assertDurableExecutionRecordContract(command, CAPTURE_MODE, ROOT_WITNESS_ID, [baseRecordId]);
    return Object.freeze([command.envelope.record_id]);
}

function isDurableExecutionRecord(record: OwnerRecord): boolean {
    const schemas = projectionProtocolConfig.executionHistory.executionSchemas;
    return [
        ...Object.values(schemas),
        runProtocolConfig.schemas.artifactId,
        runProtocolConfig.schemas.continuationDescriptorId,
        runProtocolConfig.schemas.outcomeId,
        runProtocolConfig.schemas.suspendedLifecycleId,
        runProtocolConfig.schemas.usageId,
        runProtocolConfig.schemas.waitingLifecycleId,
        runProtocolConfig.execution.controlCommandSchemaId,
    ].includes(record.envelope.schema_ref);
}

function uniqueRecord(
    records: readonly OwnerRecord[],
    schemaRef: string,
    subject: string,
): OwnerRecord | undefined {
    const selected = records.filter((record) => record.envelope.schema_ref === schemaRef);
    if (selected.length > 1) {
        throw new TypeError(`durable execution contains multiple ${subject} records`);
    }
    return selected[0];
}

function uniqueTerminal(records: readonly OwnerRecord[]): OwnerRecord | undefined {
    const selected = records.filter(isLifecycleTerminal);
    if (selected.length > 1) {
        throw new TypeError("durable execution contains multiple lifecycle terminal records");
    }
    return selected[0];
}

function isLifecycleTerminal(record: OwnerRecord): boolean {
    const schemas = projectionProtocolConfig.executionHistory.executionSchemas;
    return (
        record.envelope.schema_ref === schemas.completed ||
        record.envelope.schema_ref === schemas.failed
    );
}

function findTerminalCut(
    records: readonly OwnerRecord[],
    runId: string,
    createdRecordId: string,
    lifecycleRecordId: string,
): OwnerRecord | undefined {
    for (const record of records) {
        if (record.envelope.schema_ref !== kernelProtocolConfig.queries.cutSchemaRef) {
            continue;
        }
        const body = readRunDataObject(
            record.body,
            [
                "cut_id",
                "publisher_owner_id",
                "target_owner_id",
                "through_owner_ordinal",
                "through_record_id",
            ],
            "durable cut publication",
        );
        if (body.target_owner_id === runId && body.through_record_id === lifecycleRecordId) {
            assertRecoveryTransitionContract(
                record,
                records,
                lifecycleRecordId,
                createdRecordId,
                runId,
            );
            return record;
        }
    }
    return undefined;
}

function assertRecoveryTransitionContract(
    record: OwnerRecord,
    records: readonly OwnerRecord[],
    baseRecordId: string,
    createdRecordId: string,
    runId: string,
): void {
    const parents = record.envelope.caused_by_record_ids;
    if (parents.length < 1 || parents.length > 2 || parents[0] !== baseRecordId) {
        throw new TypeError("durable recovery transition causality is inconsistent");
    }
    assertDurableExecutionRecordContract(record, CAPTURE_MODE, ROOT_WITNESS_ID, parents);
    const commandRecordId = parents[1];
    if (commandRecordId === undefined) {
        return;
    }
    const command = records.find((candidate) => candidate.envelope.record_id === commandRecordId);
    if (command === undefined) {
        throw new TypeError("durable recovery command evidence is missing");
    }
    assertDurableExecutionRecordContract(command, CAPTURE_MODE, ROOT_WITNESS_ID, [createdRecordId]);
    if (command.envelope.schema_ref !== runProtocolConfig.execution.controlCommandSchemaId) {
        throw new TypeError("durable recovery command schema is inconsistent");
    }
    const decoded = readDurableRecoveryCommand(command.body, runId);
    if (
        command.view.append_intent_id !==
        createRecordId({ durable_control_command_id: decoded.command_id })
    ) {
        throw new TypeError("durable recovery command append intent is inconsistent");
    }
}

function readPayload(record: OwnerRecord, subject: string): Record<string, unknown> {
    const body = readRunDataObject(record.body, ["payload"], `${subject} body`);
    return readRunDataObject(
        body.payload,
        [],
        `${subject} payload`,
        Object.keys(body.payload as object),
    );
}

function validateTerminalPayload(
    terminal: OwnerRecord,
    payload: Record<string, unknown>,
    execution: DurableTaskExecutionResult["execution"],
): void {
    const schemas = projectionProtocolConfig.executionHistory.executionSchemas;
    const outcome = execution.outcome.outcome;
    if (outcome.status === FINISHED_STATUS) {
        const fields = readRunDataObject(
            payload,
            ["control", "execution_id", "outputs"],
            "durable completion payload",
        );
        if (
            terminal.envelope.schema_ref !== schemas.completed ||
            canonicalizeRecord(fields.outputs as SemanticRecord) !==
                canonicalizeRecord({ value: outcome.value })
        ) {
            throw new TypeError("durable completion payload disagrees with its outcome");
        }
        return;
    }
    const fields = readRunDataObject(
        payload,
        ["control", "error", "execution_id"],
        "durable failure payload",
    );
    const error = "message" in outcome ? outcome.message : outcome.reason;
    if (terminal.envelope.schema_ref !== schemas.failed || fields.error !== error) {
        throw new TypeError("durable failure payload disagrees with its outcome");
    }
}

/**
 * Validates the shared envelope contract for one durable execution record.
 *
 * @param record - Owner-local record whose envelope is checked.
 * @param mode - Required configured record mode.
 * @param witnessRef - Required witness identity.
 * @param causedByRecordIds - Exact ordered causal-parent identities.
 * @returns Nothing when the envelope matches the contract.
 * @throws {TypeError} If mode, witness, or ordered causality differs.
 *
 * @internal
 */
export function assertDurableExecutionRecordContract(
    record: OwnerRecord,
    mode: OwnerRecord["envelope"]["mode"],
    witnessRef: string,
    causedByRecordIds: readonly string[],
): void {
    if (
        record.envelope.mode !== mode ||
        record.envelope.witness_ref !== witnessRef ||
        record.envelope.caused_by_record_ids.length !== causedByRecordIds.length ||
        record.envelope.caused_by_record_ids.some(
            (recordId, index) => recordId !== causedByRecordIds[index],
        )
    ) {
        throw new TypeError("durable execution record contract is inconsistent");
    }
}
