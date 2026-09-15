import type { SemanticValue } from "../canonical/canonical-record.ts";
import { delegationProtocolConfig } from "../protocol/config.ts";
import {
    DELEGATION_APPROVAL_VERDICTS,
    DELEGATION_CONTEXT_PHASES,
    DELEGATION_DECISION_KINDS,
    DELEGATION_PROVENANCE_KINDS,
    DELEGATION_STATUSES,
    RECORD_MODES,
    RUN_TERMINAL_STATUSES,
} from "../protocol/values.generated.ts";
import { assertRecordId } from "../record/guards.ts";
import type { RecordBody, RecordId } from "../record/types.ts";
import { normalizeTaskValue } from "../run/execution-preparation.ts";
import { assertScopeText, readScopeDataObject } from "../scope/validation.ts";
import { AppendIntentConflictError } from "../store/errors.ts";
import type { SQLiteTraceStore } from "../store/sqlite-trace-store.ts";
import { taskDescriptorOf } from "../task/value.ts";
import {
    DelegationCommandConflictError,
    DelegationEvidenceError,
    DelegationHeadConflictError,
    DelegationStatusError,
    DelegationSupervisorError,
} from "./errors.ts";
import {
    assertChildRunHandle,
    assertHandleCurrent,
    COMMAND_STEP,
    createDelegationAppendRequest,
} from "./handle.ts";
import { inspectChildRun } from "./inspection.ts";
import {
    canonical,
    createChildRunHandleId,
    createDelegationApprovalBody,
    createDelegationCauses,
    createDelegationContextBody,
    createDelegationDecisionBody,
    createDelegationHandoffBody,
    createDelegationOutputDigest,
    readDelegationCitations,
    readDelegationData,
    readDelegationReason,
    readSupervisorId,
} from "./records.ts";
import type {
    AcceptChildRunResultOptions,
    ApproveChildRunTaskOptions,
    ChildRunApprovalVerdict,
    ChildRunCommandReceipt,
    ChildRunHandle,
    ChildRunInspection,
    DiscardChildRunOptions,
    HandoffChildRunOptions,
    InjectChildRunContextOptions,
} from "./types.ts";

const config = delegationProtocolConfig;
const [CAPTURE_MODE] = RECORD_MODES;
const [INJECTED_PHASE] = DELEGATION_CONTEXT_PHASES;
const [ACCEPTED_KIND, DISCARDED_KIND] = DELEGATION_DECISION_KINDS;
const [DECLARED_KIND] = DELEGATION_PROVENANCE_KINDS;
const [FINISHED_STATUS] = RUN_TERMINAL_STATUSES;
const [
    ,
    RUNNING_STATUS,
    ,
    APPROVAL_PENDING_STATUS,
    REJECTED_STATUS,
    ACCEPTED_STATUS,
    DISCARDED_STATUS,
] = DELEGATION_STATUSES;

type Command = {
    readonly body: RecordBody;
    readonly causes: readonly RecordId[];
    readonly commandId: string;
    readonly expectedHeadRecordId: unknown;
    readonly handle: ChildRunHandle;
    readonly schemaRef: string;
    readonly supervisorId: string;
};

/**
 * Retains one ordered supervisor context injection on a handle.
 *
 * The injection cites at least one retained record; every cited record is a causal parent of the
 * injection. Injections retained before the child starts are folded into the composed provider
 * request by {@link runChildRun}; injections retained after the child started stay pending
 * (`consumed: false`) and are consumed only by a successor opened through {@link retryChildRun}
 * with its own injections. The count of injections on one handle is bounded by
 * `limits.maxInjections`. Repeating the command returns the retained receipt.
 *
 * @param store - Open writable trace store that opened the handle.
 * @param options - Command, handle, current supervisor, cited records, data, and optional head.
 * @returns The handle, its inspection, and the injection record identity.
 * @throws {DelegationCommandConflictError} If the command identity names different content.
 * @throws {DelegationSupervisorError} If the supervisor does not own the handle.
 * @throws {DelegationStatusError} If the handle is decided, rejected, or at the injection bound.
 * @throws {DelegationHeadConflictError} If the expected or current head moved.
 * @throws {DelegationEvidenceError} If a cited record is not retained or evidence is inconsistent.
 * @throws {TraceStoreError} If the store is closed.
 * @throws {TypeError} If options are malformed or exceed configured bounds.
 *
 * @example
 * ```ts
 * injectChildRunContext(store, {
 *     citedRecordIds: [reviewRecordId],
 *     commandId: "inject:review:1",
 *     data: { hint: "prefer the shorter draft" },
 *     handle,
 *     supervisorId: "supervisor:lead",
 * });
 * ```
 */
export function injectChildRunContext(
    store: SQLiteTraceStore,
    options: InjectChildRunContextOptions,
): ChildRunCommandReceipt {
    const fields = readScopeDataObject(
        options,
        ["citedRecordIds", "commandId", "data", "handle", "supervisorId"],
        "injectChildRunContext options",
        ["expectedHeadRecordId"],
    );
    const { commandId, handle, supervisorId } = readCommandFields(store, fields);
    const citedRecordIds = readDelegationCitations(
        fields.citedRecordIds,
        "citedRecordIds",
        config.limits.maxCitedRecords,
    );
    const data = readDelegationData(fields.data);
    return retainCommand(
        store,
        {
            body: createDelegationContextBody({
                cited_record_ids: citedRecordIds,
                command_id: commandId,
                data,
                handle_id: handle.handle_id,
                phase: INJECTED_PHASE,
                supervisor_id: supervisorId,
            }),
            causes: citedRecordIds,
            commandId,
            expectedHeadRecordId: fields.expectedHeadRecordId,
            handle,
            schemaRef: config.traceSchemas.context,
            supervisorId,
        },
        (inspection) => {
            refuseTerminal(inspection, "a rejected or decided handle accepts no injection");
            if (inspection.injections.length >= config.limits.maxInjections) {
                throw new DelegationStatusError(
                    handle.handle_id,
                    inspection.status,
                    "the configured injection bound is reached",
                );
            }
            for (const recordId of citedRecordIds) {
                if (store.readRecord(recordId) === undefined) {
                    throw new DelegationEvidenceError(`cited record ${recordId} is not retained`);
                }
            }
        },
    );
}

/**
 * Transfers supervisor ownership of a handle to a named successor.
 *
 * After the handoff every later command must name the successor; commands naming a former
 * supervisor are refused without writing. Handoff transfers ownership of the handle only, never
 * a live process, provider session, or world state. Repeating the command returns the retained
 * receipt.
 *
 * @param store - Open writable trace store that opened the handle.
 * @param options - Command, handle, current supervisor, successor, optional reason and head.
 * @returns The handle, its inspection, and the handoff record identity.
 * @throws {DelegationCommandConflictError} If the command identity names different content.
 * @throws {DelegationSupervisorError} If the supervisor does not own the handle.
 * @throws {DelegationStatusError} If the handle is decided.
 * @throws {DelegationHeadConflictError} If the expected or current head moved.
 * @throws {DelegationEvidenceError} If retained evidence is inconsistent.
 * @throws {TraceStoreError} If the store is closed.
 * @throws {TypeError} If options are malformed or the successor equals the supervisor.
 */
export function handoffChildRun(
    store: SQLiteTraceStore,
    options: HandoffChildRunOptions,
): ChildRunCommandReceipt {
    const fields = readScopeDataObject(
        options,
        ["commandId", "handle", "successorSupervisorId", "supervisorId"],
        "handoffChildRun options",
        ["expectedHeadRecordId", "reason"],
    );
    const { commandId, handle, supervisorId } = readCommandFields(store, fields);
    const successorId = readSupervisorId(fields.successorSupervisorId, "successorSupervisorId");
    if (successorId === supervisorId) {
        throw new TypeError("successorSupervisorId must differ from supervisorId");
    }
    return retainCommand(
        store,
        {
            body: createDelegationHandoffBody({
                command_id: commandId,
                handle_id: handle.handle_id,
                reason: readDelegationReason(fields.reason, "reason"),
                successor_id: successorId,
                supervisor_id: supervisorId,
            }),
            causes: [],
            commandId,
            expectedHeadRecordId: fields.expectedHeadRecordId,
            handle,
            schemaRef: config.traceSchemas.handoff,
            supervisorId,
        },
        (inspection) => {
            if (inspection.decision !== null) {
                throw new DelegationStatusError(
                    handle.handle_id,
                    inspection.status,
                    "a decided handle cannot be handed off",
                );
            }
        },
    );
}

/**
 * Retains a terminal discard decision with a reason.
 *
 * A started, non-terminal child must first be cancelled through durable run control on the child
 * run owner path; discarding a live child is refused. Ready, settling, approval-pending, and
 * rejected handles may be discarded. The decision is terminal: no later accept, discard,
 * injection, or handoff is admitted, and a successor may be opened with {@link retryChildRun}.
 * Repeating the command returns the retained receipt.
 *
 * @param store - Open writable trace store that opened the handle.
 * @param options - Command, handle, current supervisor, reason, and optional head.
 * @returns The handle, its inspection, and the decision record identity.
 * @throws {DelegationCommandConflictError} If the command identity names different content.
 * @throws {DelegationSupervisorError} If the supervisor does not own the handle.
 * @throws {DelegationStatusError} If the child is running or the handle is already decided.
 * @throws {DelegationHeadConflictError} If the expected or current head moved.
 * @throws {DelegationEvidenceError} If retained evidence is inconsistent.
 * @throws {TraceStoreError} If the store is closed.
 * @throws {TypeError} If options are malformed.
 */
export function discardChildRun(
    store: SQLiteTraceStore,
    options: DiscardChildRunOptions,
): ChildRunCommandReceipt {
    const fields = readScopeDataObject(
        options,
        ["commandId", "handle", "reason", "supervisorId"],
        "discardChildRun options",
        ["expectedHeadRecordId"],
    );
    const { commandId, handle, supervisorId } = readCommandFields(store, fields);
    assertScopeText(fields.reason, "reason");
    return retainCommand(
        store,
        {
            body: createDelegationDecisionBody({
                child_outcome_record_id: null,
                command_id: commandId,
                handle_id: handle.handle_id,
                kind: DISCARDED_KIND,
                output_id: null,
                reason: readDelegationReason(fields.reason, "reason"),
                supervisor_id: supervisorId,
            }),
            causes: [],
            commandId,
            expectedHeadRecordId: fields.expectedHeadRecordId,
            handle,
            schemaRef: config.traceSchemas.decision,
            supervisorId,
        },
        (inspection) => {
            if (inspection.status === RUNNING_STATUS) {
                throw new DelegationStatusError(
                    handle.handle_id,
                    inspection.status,
                    "cancel the live child run through durable control before discarding",
                );
            }
            refuseDecided(inspection);
        },
    );
}

/**
 * Retains a terminal accept decision for a finished child.
 *
 * The child must have finished and its completion must be retained; the retained outcome value
 * is validated against the task value's output schema and the decision retains the digest of
 * the canonical output value and the outcome record identity. Only accepted results thread into
 * the parent. The decision is terminal. Repeating the command returns the retained receipt.
 *
 * @param store - Open writable trace store that opened the handle.
 * @param options - Command, handle, current supervisor, and optional head.
 * @returns The handle, its inspection, and the decision record identity.
 * @throws {DelegationCommandConflictError} If the command identity names different content.
 * @throws {DelegationSupervisorError} If the supervisor does not own the handle.
 * @throws {DelegationStatusError} If the child has not finished with a retained completion or the
 * handle is already decided.
 * @throws {DelegationHeadConflictError} If the expected or current head moved.
 * @throws {DelegationEvidenceError} If retained evidence is inconsistent.
 * @throws {TraceStoreError} If the store is closed.
 * @throws {TypeError} If options are malformed or the retained outcome fails the output schema.
 */
export function acceptChildRunResult(
    store: SQLiteTraceStore,
    options: AcceptChildRunResultOptions,
): ChildRunCommandReceipt {
    const fields = readScopeDataObject(
        options,
        ["commandId", "handle", "supervisorId"],
        "acceptChildRunResult options",
        ["expectedHeadRecordId"],
    );
    const { commandId, handle, supervisorId } = readCommandFields(store, fields);
    const inspection = inspectChildRun(store, handle.handle_id);
    assertHandleCurrent(handle, inspection);
    const outcome = inspection.child?.outcome;
    if (
        inspection.completion === null ||
        inspection.completion.status !== FINISHED_STATUS ||
        outcome === undefined ||
        outcome === null ||
        outcome.outcome.outcome.status !== FINISHED_STATUS
    ) {
        throw new DelegationStatusError(
            handle.handle_id,
            inspection.status,
            "only a finished child with a retained completion can be accepted",
        );
    }
    const value = normalizeTaskValue(
        taskDescriptorOf(inspection.task).parseOutput(outcome.outcome.outcome.value),
    );
    return retainCommand(
        store,
        {
            body: createDelegationDecisionBody({
                child_outcome_record_id: outcome.record_id,
                command_id: commandId,
                handle_id: handle.handle_id,
                kind: ACCEPTED_KIND,
                output_id: createDelegationOutputDigest(value),
                reason: null,
                supervisor_id: supervisorId,
            }),
            causes: [outcome.record_id],
            commandId,
            expectedHeadRecordId: fields.expectedHeadRecordId,
            handle,
            schemaRef: config.traceSchemas.decision,
            supervisorId,
        },
        (current) => {
            refuseDecided(current);
        },
        inspection,
    );
}

/**
 * Retains the current supervisor's approval verdict for a revised or synthesized task value.
 *
 * The approval retains the approver identity, the verdict, and the digest of the approved task
 * artifact. `approved` moves the handle to `ready`; `rejected` is terminal for execution (the
 * handle can still be discarded for bookkeeping and handed off). One approval is retained per
 * handle; declared provenance needs none. Repeating the command returns the retained receipt.
 *
 * @param store - Open writable trace store that opened the handle.
 * @param options - Command, handle, current supervisor, verdict, optional approver, reason, head.
 * @returns The handle, its inspection, and the approval record identity.
 * @throws {DelegationCommandConflictError} If the command identity names different content.
 * @throws {DelegationSupervisorError} If the supervisor does not own the handle.
 * @throws {DelegationStatusError} If the handle needs no approval or is already approved,
 * rejected, or decided.
 * @throws {DelegationHeadConflictError} If the expected or current head moved.
 * @throws {DelegationEvidenceError} If retained evidence is inconsistent.
 * @throws {TraceStoreError} If the store is closed.
 * @throws {TypeError} If options are malformed.
 *
 * @example
 * ```ts
 * approveChildRunTask(store, {
 *     approverId: "reviewer@example.com",
 *     commandId: "approve:review:1",
 *     handle,
 *     supervisorId: "supervisor:lead",
 *     verdict: "approved",
 * });
 * ```
 */
export function approveChildRunTask(
    store: SQLiteTraceStore,
    options: ApproveChildRunTaskOptions,
): ChildRunCommandReceipt {
    const fields = readScopeDataObject(
        options,
        ["commandId", "handle", "supervisorId", "verdict"],
        "approveChildRunTask options",
        ["approverId", "expectedHeadRecordId", "reason"],
    );
    const { commandId, handle, supervisorId } = readCommandFields(store, fields);
    if (!DELEGATION_APPROVAL_VERDICTS.includes(fields.verdict as ChildRunApprovalVerdict)) {
        throw new TypeError("verdict must be a configured approval verdict");
    }
    let approverId = supervisorId;
    if (fields.approverId !== undefined) {
        assertScopeText(fields.approverId, "approverId");
        approverId = fields.approverId;
    }
    const inspection = inspectChildRun(store, handle.handle_id);
    assertHandleCurrent(handle, inspection);
    return retainCommand(
        store,
        {
            body: createDelegationApprovalBody({
                approver_id: approverId,
                command_id: commandId,
                handle_id: handle.handle_id,
                reason: readDelegationReason(fields.reason, "reason"),
                supervisor_id: supervisorId,
                task_artifact_digest: inspection.task.artifact_lock.artifact_digest,
                verdict: fields.verdict as ChildRunApprovalVerdict,
            }),
            causes: [],
            commandId,
            expectedHeadRecordId: fields.expectedHeadRecordId,
            handle,
            schemaRef: config.traceSchemas.approval,
            supervisorId,
        },
        (current) => {
            if (current.provenance.kind === DECLARED_KIND) {
                throw new DelegationStatusError(
                    handle.handle_id,
                    current.status,
                    "declared provenance needs no approval",
                );
            }
            if (current.status !== APPROVAL_PENDING_STATUS) {
                throw new DelegationStatusError(
                    handle.handle_id,
                    current.status,
                    "the task value is already approved, rejected, or decided",
                );
            }
        },
        inspection,
    );
}

function readCommandFields(
    store: SQLiteTraceStore,
    fields: Record<string, unknown>,
): { readonly commandId: string; readonly handle: ChildRunHandle; readonly supervisorId: string } {
    assertScopeText(fields.commandId, "commandId");
    const handle = fields.handle;
    assertChildRunHandle(handle, store);
    if (fields.expectedHeadRecordId !== undefined) {
        assertRecordId(fields.expectedHeadRecordId, "expectedHeadRecordId");
    }
    return {
        commandId: fields.commandId,
        handle,
        supervisorId: readSupervisorId(fields.supervisorId, "supervisorId"),
    };
}

function retainCommand(
    store: SQLiteTraceStore,
    command: Command,
    admit: (inspection: ChildRunInspection) => void,
    inspected?: ChildRunInspection,
): ChildRunCommandReceipt {
    const handle = command.handle;
    const handleId = handle.handle_id;
    const inspection = inspected ?? inspectChildRun(store, handleId);
    assertHandleCurrent(handle, inspection);
    const retained = store
        .readOwner(handleId)
        .find((record) => record.body.command_id === command.commandId);
    if (retained !== undefined) {
        if (canonical(retained.body as SemanticValue) !== canonical(command.body)) {
            throw new DelegationCommandConflictError(handleId, command.commandId);
        }
        return Object.freeze({ handle, inspection, record_id: retained.envelope.record_id });
    }
    const openedElsewhere = createChildRunHandleId(command.commandId);
    if (openedElsewhere !== handleId && store.readOwner(openedElsewhere).length > 0) {
        throw new DelegationCommandConflictError(handleId, command.commandId);
    }
    if (inspection.supervisor_id !== command.supervisorId) {
        throw new DelegationSupervisorError(
            handleId,
            command.supervisorId,
            inspection.supervisor_id,
        );
    }
    admit(inspection);
    if (
        command.expectedHeadRecordId !== undefined &&
        command.expectedHeadRecordId !== inspection.head_record_id
    ) {
        throw new DelegationHeadConflictError(handleId, command.expectedHeadRecordId as string);
    }
    let appended: ReturnType<SQLiteTraceStore["appendDelegationHandleRecord"]>;
    try {
        appended = store.appendDelegationHandleRecord(
            handleId,
            inspection.head_record_id,
            createDelegationAppendRequest(
                command.commandId,
                COMMAND_STEP,
                handleId,
                command.body,
                command.schemaRef,
                CAPTURE_MODE,
                createDelegationCauses(inspection.head_record_id, command.causes),
            ),
        );
    } catch (error) {
        if (error instanceof AppendIntentConflictError) {
            throw new DelegationCommandConflictError(handleId, command.commandId);
        }
        throw error;
    }
    if (appended.status === "head_moved") {
        throw new DelegationHeadConflictError(handleId, inspection.head_record_id);
    }
    return Object.freeze({
        handle,
        inspection: inspectChildRun(store, handleId),
        record_id: appended.receipt.record_ids[0] as RecordId,
    });
}

function refuseDecided(inspection: ChildRunInspection): void {
    if (inspection.status === ACCEPTED_STATUS || inspection.status === DISCARDED_STATUS) {
        throw new DelegationStatusError(
            inspection.handle_id,
            inspection.status,
            "the handle is already decided",
        );
    }
}

function refuseTerminal(inspection: ChildRunInspection, detail: string): void {
    if (
        inspection.status === REJECTED_STATUS ||
        inspection.status === ACCEPTED_STATUS ||
        inspection.status === DISCARDED_STATUS
    ) {
        throw new DelegationStatusError(inspection.handle_id, inspection.status, detail);
    }
}
