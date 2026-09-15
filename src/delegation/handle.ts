import type { SemanticValue } from "../canonical/canonical-record.ts";
import { delegationProtocolConfig, providerProtocolConfig } from "../protocol/config.ts";
import {
    DELEGATION_CONTEXT_PHASES,
    DELEGATION_EXECUTION_KINDS,
    DELEGATION_PARENT_KINDS,
    DELEGATION_PROVENANCE_KINDS,
    DELEGATION_REVISION_FIELDS,
    DELEGATION_STATUSES,
    RECORD_MODES,
} from "../protocol/values.generated.ts";
import type { ModelProvider, ModelRequest, ModelResponse } from "../provider/types.ts";
import { assertRecordId } from "../record/guards.ts";
import { ROOT_WITNESS_ID } from "../record/root-witness.ts";
import type { RecordBody, RecordId } from "../record/types.ts";
import type { RunBudgetDefinition } from "../run/control-types.ts";
import { executeTaskDurably } from "../run/durable-execution.ts";
import { normalizeTaskValue } from "../run/execution-preparation.ts";
import { readScopeResourceGrants } from "../scope/authority.ts";
import type { ScopeAuthority, ScopeResourceGrant } from "../scope/types.ts";
import { assertScopeText, readScopeArray, readScopeDataObject } from "../scope/validation.ts";
import type { SQLiteTraceStore } from "../store/sqlite-trace-store.ts";
import type { StoreAppendRequest } from "../store/types.ts";
import { assertTaskDescriptor } from "../task/descriptor.ts";
import type { TaskSchema } from "../task/schema.ts";
import type { TaskDescriptor, TaskValue } from "../task/types.ts";
import { taskDescriptorOf, taskValueOf } from "../task/value.ts";
import { readTaskValue } from "../task/value-codec.ts";
import {
    assertBudgetAttenuated,
    deriveDelegatedAuthority,
    readDelegationBudget,
} from "./authority.ts";
import {
    DelegationApprovalRequiredError,
    DelegationAuthorityError,
    DelegationCommandConflictError,
    DelegationEvidenceError,
    DelegationHeadConflictError,
    DelegationStatusError,
    DelegationSupervisorError,
} from "./errors.ts";
import { inspectChildRun } from "./inspection.ts";
import {
    canonical,
    composeChildRunRequest,
    createChildRunHandleId,
    createChildRunId,
    createDelegationAppendIntentId,
    createDelegationCauses,
    createDelegationCompletionBody,
    createDelegationContextBody,
    createDelegationOpenedBody,
    createDelegationOriginCutId,
    createDelegationRequestDigest,
    createDelegationRetryCutId,
    readRevisionDifferences,
    readSupervisorId,
} from "./records.ts";
import type {
    ChildRunHandle,
    ChildRunInspection,
    ChildRunPredecessorInspection,
    ChildRunProgram,
    ChildRunProvenance,
    ChildRunReceipt,
    ChildRunRevisionField,
    ChildRunSupervisorContextEntry,
    OpenChildRunOptions,
    RetryChildRunOptions,
    RunChildRunOptions,
} from "./types.ts";

const config = delegationProtocolConfig;
const [CAPTURE_MODE, DECLARATION_MODE] = RECORD_MODES;
const [ROOT_KIND, HANDLE_KIND] = DELEGATION_PARENT_KINDS;
const [DECLARED_KIND, REVISED_KIND, SYNTHESIZED_KIND] = DELEGATION_PROVENANCE_KINDS;
const [PROVIDER_EXECUTION, PROGRAM_EXECUTION] = DELEGATION_EXECUTION_KINDS;
const [, CONSUMED_PHASE] = DELEGATION_CONTEXT_PHASES;
const [
    READY_STATUS,
    ,
    SETTLING_STATUS,
    APPROVAL_PENDING_STATUS,
    REJECTED_STATUS,
    ,
    DISCARDED_STATUS,
] = DELEGATION_STATUSES;
const OPENED_STEP = "opened";
const CONSUMED_STEP = "consumed";
const COMPLETION_STEP = "completion";
/** Append step naming a handle command retained by a supervisor operation. @internal */
export const COMMAND_STEP = "command";
const AUTHENTICATED_HANDLES = new WeakMap<object, SQLiteTraceStore>();

type AnyTaskDescriptor = TaskDescriptor<TaskSchema<unknown>, TaskSchema<unknown>>;

type ResolvedParent = {
    readonly authority: ScopeAuthority;
    readonly budgetCeiling: RunBudgetDefinition;
    readonly depth: number;
    readonly handleId: string | null;
};

type OpeningSpec = {
    readonly budget: RunBudgetDefinition;
    readonly commandId: string;
    readonly grant: readonly ScopeResourceGrant[];
    readonly input: unknown;
    readonly parent: ResolvedParent;
    readonly predecessor: {
        readonly decisionRecordId: RecordId;
        readonly handleId: string;
    } | null;
    readonly provenance: ChildRunProvenance;
    readonly supervisorId: string;
    readonly task: TaskValue;
};

/** Rejects forged, copied, imported, or foreign-store child run handles. @internal */
export function assertChildRunHandle(
    value: unknown,
    store: SQLiteTraceStore,
): asserts value is ChildRunHandle {
    if (value === null || typeof value !== "object" || AUTHENTICATED_HANDLES.get(value) !== store) {
        throw new TypeError("child run handle must be created by this package for this store");
    }
}

/** Refuses a handle whose retained opened record no longer matches. @internal */
export function assertHandleCurrent(handle: ChildRunHandle, inspection: ChildRunInspection): void {
    if (inspection.opened_record_id !== handle.opened_record_id) {
        throw new DelegationEvidenceError(
            `handle ${handle.handle_id} does not match its retained opened record`,
        );
    }
}

/** Builds one single-record append on a handle owner path. @internal */
export function createDelegationAppendRequest(
    commandId: string,
    step: string,
    ownerId: string,
    body: RecordBody,
    schemaRef: string,
    mode: (typeof RECORD_MODES)[number],
    causes: readonly RecordId[],
): StoreAppendRequest {
    return {
        append_intent_id: createDelegationAppendIntentId(commandId, step),
        batch: {
            groups: [
                {
                    owner_id: ownerId,
                    records: [
                        {
                            body,
                            caused_by_record_ids: causes,
                            mode,
                            schema_ref: schemaRef,
                            witness_ref: ROOT_WITNESS_ID,
                        },
                    ],
                },
            ],
        },
    };
}

/**
 * Opens one child run handle: a delegated execution of one task value under one supervisor.
 *
 * The opened record is retained on the handle's reserved owner path derived from the command
 * identity. It retains the supervisor, the parent (a root declaration or the parent handle with an
 * origin cut through the parent head), the task value with its provenance, the input validated
 * against the task input schema, the requested grant and budget, the derived authority, the
 * budget ceiling, and the nesting depth. A package-created descriptor defaults to `declared`
 * provenance; a task value must state its provenance. Revised provenance must keep the source
 * task identity, differ in at least one configured revision field, and list exactly the differing
 * fields; synthesized provenance must cite a record retained by the producing run. Handles with
 * revised or synthesized provenance open in `approval_pending`. Repeating the command returns the
 * retained receipt.
 *
 * @param store - Open writable trace store.
 * @param options - Command, supervisor, parent, task, provenance, input, grant, and budget.
 * @returns The authenticated handle and its validated inspection.
 * @throws {DelegationAuthorityError} If the grant or budget exceeds the parent authority or the
 * nesting bound.
 * @throws {DelegationCommandConflictError} If the command identity names different content or is
 * already retained by a handle command.
 * @throws {DelegationStatusError} If the parent handle is rejected or discarded.
 * @throws {DelegationEvidenceError} If retained evidence is inconsistent or a synthesized
 * producer record is absent.
 * @throws {TraceStoreError} If the store is closed.
 * @throws {TypeError} If options, the task, its provenance, the input, or the parent handle are
 * malformed.
 *
 * @example
 * ```ts
 * const { handle } = openChildRun(store, {
 *     budget: { maxTurns: 1 },
 *     commandId: "delegate:review:1",
 *     grant: [],
 *     input: { topic: "release notes" },
 *     parent: { budget: { maxTurns: 4 }, ceiling: [], kind: "root" },
 *     supervisorId: "supervisor:lead",
 *     task: reviewTask,
 * });
 * ```
 */
export function openChildRun(
    store: SQLiteTraceStore,
    options: OpenChildRunOptions,
): ChildRunReceipt {
    const fields = readScopeDataObject(
        options,
        ["budget", "commandId", "grant", "input", "parent", "supervisorId", "task"],
        "openChildRun options",
        ["provenance"],
    );
    assertScopeText(fields.commandId, "commandId");
    const supervisorId = readSupervisorId(fields.supervisorId, "supervisorId");
    const { provenance, task } = readTaskWithProvenance(store, fields.task, fields.provenance);
    const grant = readScopeResourceGrants(fields.grant, "grant");
    return openHandle(store, {
        budget: readDelegationBudget(fields.budget, "budget"),
        commandId: fields.commandId,
        grant,
        input: fields.input,
        parent: readParent(store, fields.parent, grant),
        predecessor: null,
        provenance,
        supervisorId,
        task,
    });
}

/**
 * Opens a successor handle for a discarded predecessor, citing its causal replay point.
 *
 * The successor is a new handle under the predecessor's parent whose opened record cites the
 * predecessor handle, its discard decision record, and a retry cut published through the
 * predecessor head inside the opening transaction. Task, input, grant, and budget default to the
 * predecessor's; a supplied descriptor is `declared`, a supplied task value must state its
 * provenance, and an omitted task inherits the predecessor's task value and provenance, so a
 * revised or synthesized successor requires its own approval. Pending injections of the
 * predecessor are not copied. Only the current supervisor of the predecessor may retry.
 *
 * @param store - Open writable trace store that opened the predecessor.
 * @param options - Successor command, supervisor, and optional task, provenance, input, grant,
 * and budget.
 * @returns The authenticated successor handle and its validated inspection.
 * @throws {DelegationStatusError} If the predecessor is not discarded or the parent handle no
 * longer admits children.
 * @throws {DelegationSupervisorError} If the supervisor does not own the predecessor.
 * @throws {DelegationAuthorityError} If the grant or budget exceeds the parent authority.
 * @throws {DelegationCommandConflictError} If the command identity names different content or is
 * already retained by a handle command.
 * @throws {DelegationEvidenceError} If retained evidence is inconsistent.
 * @throws {TraceStoreError} If the store is closed.
 * @throws {TypeError} If options, the task, its provenance, the input, or the handle are malformed.
 *
 * @example
 * ```ts
 * const successor = retryChildRun(store, {
 *     commandId: "delegate:review:2",
 *     handle: discarded.handle,
 *     supervisorId: "supervisor:lead",
 * });
 * ```
 */
export function retryChildRun(
    store: SQLiteTraceStore,
    options: RetryChildRunOptions,
): ChildRunReceipt {
    const fields = readScopeDataObject(
        options,
        ["commandId", "handle", "supervisorId"],
        "retryChildRun options",
        ["budget", "grant", "input", "provenance", "task"],
    );
    assertScopeText(fields.commandId, "commandId");
    const supervisorId = readSupervisorId(fields.supervisorId, "supervisorId");
    const handle = fields.handle;
    assertChildRunHandle(handle, store);
    if (fields.task === undefined && fields.provenance !== undefined) {
        throw new TypeError("provenance can only accompany a supplied task");
    }
    const predecessor = inspectChildRun(store, handle.handle_id);
    assertHandleCurrent(handle, predecessor);
    if (predecessor.supervisor_id !== supervisorId) {
        throw new DelegationSupervisorError(
            handle.handle_id,
            supervisorId,
            predecessor.supervisor_id,
        );
    }
    if (predecessor.status !== DISCARDED_STATUS) {
        throw new DelegationStatusError(
            handle.handle_id,
            predecessor.status,
            "only a discarded handle can be retried",
        );
    }
    const { provenance, task } =
        fields.task === undefined
            ? { provenance: predecessor.provenance, task: predecessor.task }
            : readTaskWithProvenance(store, fields.task, fields.provenance);
    const grant =
        fields.grant === undefined
            ? predecessor.grant
            : readScopeResourceGrants(fields.grant, "grant");
    const parent =
        predecessor.parent.kind === ROOT_KIND
            ? {
                  authority: deriveDelegatedAuthority(predecessor.authority.ceiling, grant),
                  budgetCeiling: predecessor.budget.ceiling,
                  depth: 1,
                  handleId: null,
              }
            : resolveParentHandle(store, predecessor.parent.handle_id, grant);
    return openHandle(store, {
        budget:
            fields.budget === undefined
                ? predecessor.budget.effective
                : readDelegationBudget(fields.budget, "budget"),
        commandId: fields.commandId,
        grant,
        input: Object.hasOwn(options, "input") ? fields.input : predecessor.input,
        parent,
        predecessor: {
            decisionRecordId: (predecessor.decision as { readonly record_id: RecordId }).record_id,
            handleId: predecessor.handle_id,
        },
        provenance,
        supervisorId,
        task,
    });
}

/**
 * Executes one child run once and retains its completion on the handle.
 *
 * Provider-serviced children run the rehydrated task through the caller's provider as an
 * ordinary durable execution under the derived child run identity. Program-serviced children run
 * the caller's program under the same durable claim through a program provider: the program
 * receives the authenticated handle, the delegated authority, the child budget, the validated
 * input, the consumed supervisor context, the cooperative signal, and the task, and its returned
 * output is validated against the task output schema; an invalid output or a thrown error fails
 * the child. Injections retained before the child starts are consumed: a consumption record
 * listing them and the digest of the composed request is retained at the handle head immediately
 * before the child starts, and the provider request input becomes
 * `{ input, supervisor_context }`; with no injection the request is the plain input. After the
 * child terminal, the completion record cites the child's terminal record and published cut and
 * names the current supervisor. A child already terminal without a completion, as after a crash
 * between the two, retains the completion without re-executing; a completed handle returns the
 * retained receipt.
 *
 * @param store - Open writable trace store that opened the handle.
 * @param options - Authenticated handle and exactly one of a provider or a program.
 * @returns The handle and its inspection after completion.
 * @throws {DelegationApprovalRequiredError} If the task value awaits approval.
 * @throws {DelegationStatusError} If the child is running, rejected, decided without a
 * completion, or terminal without a published cut.
 * @throws {DelegationHeadConflictError} If the handle head moved while the child ran.
 * @throws {DelegationEvidenceError} If retained evidence is inconsistent.
 * @throws {DurableExecutionRecoveryError} If the child's durable evidence is unsafe to advance.
 * @throws {TraceStoreError} If the store is closed.
 * @throws {TypeError} If options or the handle are malformed.
 *
 * @example
 * ```ts
 * const { inspection } = await runChildRun(store, {
 *     handle,
 *     program: async ({ input }) => ({ summary: String(input) }),
 * });
 * ```
 */
export async function runChildRun(
    store: SQLiteTraceStore,
    options: RunChildRunOptions,
): Promise<ChildRunReceipt> {
    const fields = readScopeDataObject(options, ["handle"], "runChildRun options", [
        "program",
        "provider",
    ]);
    const handle = fields.handle;
    assertChildRunHandle(handle, store);
    const execution = readExecution(fields.program, fields.provider);
    const before = inspectChildRun(store, handle.handle_id);
    assertHandleCurrent(handle, before);
    if (before.completion !== null) {
        return Object.freeze({ handle, inspection: before });
    }
    if (before.status === APPROVAL_PENDING_STATUS) {
        throw new DelegationApprovalRequiredError(handle.handle_id);
    }
    if (before.status === READY_STATUS) {
        const context = consumeInjections(store, handle, before);
        const descriptor = taskDescriptorOf(before.task);
        await executeTaskDurably(store, {
            budget: before.budget.effective,
            input: before.input,
            provider:
                execution.kind === PROVIDER_EXECUTION
                    ? composeProvider(
                          execution.provider,
                          composeChildRunRequest(before.input, context),
                      )
                    : createProgramProvider(handle, before, descriptor, execution.program, context),
            runId: before.child_run_id,
            task: descriptor,
        });
    } else if (before.status !== SETTLING_STATUS) {
        throw new DelegationStatusError(
            handle.handle_id,
            before.status,
            "the child run is not ready to run or settle",
        );
    }
    const settled = inspectChildRun(store, handle.handle_id);
    const child = settled.child;
    if (child === null || child.cut === null || child.outcome === null) {
        throw new DelegationStatusError(
            handle.handle_id,
            settled.status,
            "the child run has no published terminal cut; recover the child run first",
        );
    }
    const terminalRecordId = child.lifecycle.terminal_record_id as RecordId;
    const body = createDelegationCompletionBody({
        child_cut_id: child.cut.cut_id,
        child_run_id: settled.child_run_id,
        child_terminal_record_id: terminalRecordId,
        execution_kind: execution.kind,
        handle_id: handle.handle_id,
        status: child.outcome.outcome.outcome.status,
        supervisor_id: settled.supervisor_id,
    });
    const appended = store.appendDelegationHandleRecord(
        handle.handle_id,
        settled.head_record_id,
        createDelegationAppendRequest(
            settled.command_id,
            COMPLETION_STEP,
            handle.handle_id,
            body,
            config.traceSchemas.completion,
            CAPTURE_MODE,
            [settled.head_record_id, terminalRecordId, child.cut.created_by_record_id],
        ),
    );
    if (appended.status === "head_moved") {
        throw new DelegationHeadConflictError(handle.handle_id, settled.head_record_id);
    }
    return Object.freeze({ handle, inspection: inspectChildRun(store, handle.handle_id) });
}

function openHandle(store: SQLiteTraceStore, spec: OpeningSpec): ChildRunReceipt {
    const descriptor = taskDescriptorOf(spec.task);
    const input = normalizeTaskValue(descriptor.parseInput(spec.input));
    assertBudgetAttenuated(spec.parent.budgetCeiling, spec.budget);
    const handleId = createChildRunHandleId(spec.commandId);
    const childRunId = createChildRunId(handleId);
    const commandId = spec.commandId;
    if (
        store.readAppendIntentRecords(createDelegationAppendIntentId(commandId, COMMAND_STEP))
            .length > 0
    ) {
        throw new DelegationCommandConflictError(handleId, commandId);
    }
    const parent = spec.parent;
    const predecessor: ChildRunPredecessorInspection | null =
        spec.predecessor === null
            ? null
            : Object.freeze({
                  cut_id: createDelegationRetryCutId(handleId),
                  decision_record_id: spec.predecessor.decisionRecordId,
                  handle_id: spec.predecessor.handleId,
              });
    const command = {
        authority: parent.authority,
        budget: spec.budget,
        budget_ceiling: parent.budgetCeiling,
        child_run_id: childRunId,
        command_id: commandId,
        depth: parent.depth,
        grant: spec.grant,
        handle_id: handleId,
        input,
        predecessor,
        provenance: spec.provenance,
        supervisor_id: spec.supervisorId,
        task: spec.task,
    };
    const opened = store.openDelegationHandle(handleId, {
        appendIntentId: createDelegationAppendIntentId(commandId, OPENED_STEP),
        build: (parentHeadRecordId, predecessorHeadRecordId) => {
            const originCutId =
                parent.handleId === null ? null : createDelegationOriginCutId(handleId);
            const body = createDelegationOpenedBody({
                ...command,
                parent:
                    parent.handleId === null
                        ? Object.freeze({ kind: ROOT_KIND })
                        : Object.freeze({
                              handle_id: parent.handleId,
                              kind: HANDLE_KIND,
                              origin_cut_id: originCutId as string,
                              origin_record_id: parentHeadRecordId as RecordId,
                          }),
            });
            return {
                originCutId,
                request: createDelegationAppendRequest(
                    commandId,
                    OPENED_STEP,
                    handleId,
                    body,
                    config.traceSchemas.opened,
                    DECLARATION_MODE,
                    [
                        ...(parentHeadRecordId === null ? [] : [parentHeadRecordId]),
                        ...(predecessorHeadRecordId === null ? [] : [predecessorHeadRecordId]),
                    ],
                ),
                retryCutId: predecessor === null ? null : predecessor.cut_id,
            };
        },
        parentHandleId: parent.handleId,
        predecessor:
            predecessor === null
                ? null
                : { handleId: predecessor.handle_id, headRecordId: predecessor.decision_record_id },
    });
    const inspection = inspectChildRun(store, handleId);
    if (!opened.created) {
        const retained = {
            authority: inspection.authority,
            budget: inspection.budget.effective,
            budget_ceiling: inspection.budget.ceiling,
            child_run_id: inspection.child_run_id,
            command_id: inspection.command_id,
            depth: inspection.depth,
            grant: inspection.grant,
            handle_id: inspection.handle_id,
            input: inspection.input,
            predecessor: inspection.predecessor,
            provenance: inspection.provenance,
            supervisor_id: inspection.opened_supervisor_id,
            task: inspection.task,
        };
        const retainedParent =
            inspection.parent.kind === ROOT_KIND ? null : inspection.parent.handle_id;
        if (canonical(retained) !== canonical(command) || retainedParent !== parent.handleId) {
            throw new DelegationCommandConflictError(handleId, commandId);
        }
    }
    return Object.freeze({ handle: mintHandle(store, inspection), inspection });
}

function mintHandle(store: SQLiteTraceStore, inspection: ChildRunInspection): ChildRunHandle {
    const handle: ChildRunHandle = Object.freeze({
        authority: inspection.authority,
        budget: inspection.budget,
        child_run_id: inspection.child_run_id,
        depth: inspection.depth,
        handle_id: inspection.handle_id,
        opened_record_id: inspection.opened_record_id,
        supervisor_id: inspection.opened_supervisor_id,
    });
    AUTHENTICATED_HANDLES.set(handle, store);
    return handle;
}

function consumeInjections(
    store: SQLiteTraceStore,
    handle: ChildRunHandle,
    inspection: ChildRunInspection,
): readonly ChildRunSupervisorContextEntry[] {
    const entries = (
        inspection.consumed_context === null
            ? inspection.injections
            : inspection.injections.filter((injection) => injection.consumed)
    ).map((injection) =>
        Object.freeze({
            cited_record_ids: injection.cited_record_ids,
            data: injection.data,
            record_id: injection.record_id,
        }),
    );
    if (inspection.consumed_context !== null || entries.length === 0) {
        return entries;
    }
    const consumedRecordIds = entries.map((entry) => entry.record_id);
    const body = createDelegationContextBody({
        command_id: inspection.command_id,
        consumed_record_ids: consumedRecordIds,
        handle_id: handle.handle_id,
        phase: CONSUMED_PHASE,
        request_digest: createDelegationRequestDigest(
            composeChildRunRequest(inspection.input, entries),
        ),
        supervisor_id: inspection.supervisor_id,
    });
    const appended = store.appendDelegationHandleRecord(
        handle.handle_id,
        inspection.head_record_id,
        createDelegationAppendRequest(
            inspection.command_id,
            CONSUMED_STEP,
            handle.handle_id,
            body,
            config.traceSchemas.context,
            CAPTURE_MODE,
            createDelegationCauses(inspection.head_record_id, consumedRecordIds),
        ),
    );
    if (appended.status === "head_moved") {
        throw new DelegationHeadConflictError(handle.handle_id, inspection.head_record_id);
    }
    return entries;
}

function readTaskWithProvenance(
    store: SQLiteTraceStore,
    value: unknown,
    provenance: unknown,
): { readonly provenance: ChildRunProvenance; readonly task: TaskValue } {
    const candidate = value as { readonly parseInput?: unknown } | null;
    const isDescriptor =
        candidate !== null && typeof candidate === "object" && "parseInput" in candidate;
    let task: TaskValue;
    if (isDescriptor) {
        assertTaskDescriptor(value as AnyTaskDescriptor);
        task = taskValueOf(value as AnyTaskDescriptor);
    } else {
        task = readTaskValue(value);
    }
    if (provenance === undefined) {
        if (!isDescriptor) {
            throw new TypeError("a task value must state its provenance");
        }
        return { provenance: Object.freeze({ kind: DECLARED_KIND }), task };
    }
    return { provenance: readProvenanceDeclaration(store, provenance, task), task };
}

function readProvenanceDeclaration(
    store: SQLiteTraceStore,
    value: unknown,
    task: TaskValue,
): ChildRunProvenance {
    const kind = (value as { readonly kind?: unknown } | null)?.kind;
    if (kind === DECLARED_KIND) {
        readScopeDataObject(value, ["kind"], "provenance");
        return Object.freeze({ kind: DECLARED_KIND });
    }
    if (kind === REVISED_KIND) {
        const fields = readScopeDataObject(value, ["changes", "kind", "source"], "provenance");
        const source = readTaskValue(fields.source);
        const changes = readScopeArray(fields.changes, "provenance.changes").map((field) => {
            if (!DELEGATION_REVISION_FIELDS.includes(field as ChildRunRevisionField)) {
                throw new TypeError("provenance.changes must name configured revision fields");
            }
            return field as ChildRunRevisionField;
        });
        const differences = readRevisionDifferences(source, task);
        if (
            source.artifact_lock.task_id !== task.artifact_lock.task_id ||
            differences.length === 0 ||
            changes.length !== differences.length ||
            !differences.every((field) => changes.includes(field))
        ) {
            throw new TypeError(
                "a revised task must keep the source task identity and list exactly the differing fields",
            );
        }
        return Object.freeze({ fields: differences, kind: REVISED_KIND, source_task: source });
    }
    const fields = readScopeDataObject(value, ["kind", "producer"], "provenance");
    if (fields.kind !== SYNTHESIZED_KIND) {
        throw new TypeError("provenance kind is not configured");
    }
    const producer = readScopeDataObject(
        fields.producer,
        ["record_id", "run_id"],
        "provenance.producer",
    );
    assertRecordId(producer.record_id, "provenance.producer.record_id");
    assertScopeText(producer.run_id, "provenance.producer.run_id");
    const runId = producer.run_id;
    if (
        store.readRecord(producer.record_id)?.views.some((view) => view.owner_id === runId) !== true
    ) {
        throw new DelegationEvidenceError(
            `synthesized task producer record ${producer.record_id} is not retained by run ${runId}`,
        );
    }
    return Object.freeze({
        kind: SYNTHESIZED_KIND,
        source_record_id: producer.record_id,
        source_run_id: runId,
    });
}

function readParent(
    store: SQLiteTraceStore,
    value: unknown,
    grant: readonly ScopeResourceGrant[],
): ResolvedParent {
    const kind = (value as { readonly kind?: unknown } | null)?.kind;
    if (kind === ROOT_KIND) {
        const fields = readScopeDataObject(value, ["budget", "ceiling", "kind"], "parent");
        const ceiling = readScopeResourceGrants(fields.ceiling, "parent.ceiling");
        return {
            authority: deriveDelegatedAuthority(ceiling, grant),
            budgetCeiling: readDelegationBudget(fields.budget, "parent.budget"),
            depth: 1,
            handleId: null,
        };
    }
    assertChildRunHandle(value, store);
    const parent = resolveParentHandle(store, value.handle_id, grant);
    if (parent.openedRecordId !== value.opened_record_id) {
        throw new DelegationEvidenceError(
            `handle ${value.handle_id} does not match its retained opened record`,
        );
    }
    return parent;
}

function resolveParentHandle(
    store: SQLiteTraceStore,
    parentHandleId: string,
    grant: readonly ScopeResourceGrant[],
): ResolvedParent & { readonly openedRecordId: RecordId } {
    const parent = inspectChildRun(store, parentHandleId);
    if (parent.status === REJECTED_STATUS || parent.status === DISCARDED_STATUS) {
        throw new DelegationStatusError(
            parentHandleId,
            parent.status,
            "a rejected or discarded handle cannot open children",
        );
    }
    const depth = parent.depth + 1;
    if (depth > config.limits.maxNestingDepth) {
        throw new DelegationAuthorityError(
            `nesting depth ${depth} exceeds the configured bound ${config.limits.maxNestingDepth}`,
        );
    }
    return {
        authority: deriveDelegatedAuthority(parent.authority.effective, grant),
        budgetCeiling: parent.budget.effective,
        depth,
        handleId: parent.handle_id,
        openedRecordId: parent.opened_record_id,
    };
}

function readExecution(
    program: unknown,
    provider: unknown,
):
    | { readonly kind: typeof PROGRAM_EXECUTION; readonly program: ChildRunProgram }
    | { readonly kind: typeof PROVIDER_EXECUTION; readonly provider: ModelProvider } {
    if ((program === undefined) === (provider === undefined)) {
        throw new TypeError("runChildRun options must bind exactly one of program or provider");
    }
    if (program !== undefined) {
        if (typeof program !== "function") {
            throw new TypeError("program must be a function");
        }
        return { kind: PROGRAM_EXECUTION, program: program as ChildRunProgram };
    }
    const candidate = provider as {
        readonly descriptor?: unknown;
        readonly invoke?: unknown;
    } | null;
    if (
        candidate === null ||
        typeof candidate !== "object" ||
        typeof candidate.descriptor !== "function" ||
        typeof candidate.invoke !== "function"
    ) {
        throw new TypeError("provider must be a model provider");
    }
    return { kind: PROVIDER_EXECUTION, provider: provider as ModelProvider };
}

function composeProvider(provider: ModelProvider, request: SemanticValue): ModelProvider {
    return Object.freeze({
        descriptor: () => provider.descriptor(),
        invoke: (modelRequest: ModelRequest, signal: AbortSignal) =>
            provider.invoke({ ...modelRequest, input: request }, signal),
    });
}

function createProgramProvider(
    handle: ChildRunHandle,
    inspection: ChildRunInspection,
    task: AnyTaskDescriptor,
    program: ChildRunProgram,
    context: readonly ChildRunSupervisorContextEntry[],
): ModelProvider {
    const descriptor = Object.freeze({
        capabilities: providerProtocolConfig.program.capabilities,
        id: handle.handle_id,
        kind: providerProtocolConfig.program.kind,
        model: null,
    });
    return Object.freeze({
        descriptor: () => descriptor,
        invoke: async (request: ModelRequest, signal: AbortSignal): Promise<ModelResponse> => {
            const output = await program(
                Object.freeze({
                    authority: handle.authority,
                    budget: inspection.budget.effective,
                    handle,
                    input: request.input,
                    signal,
                    supervisor_context: Object.freeze(context),
                    task,
                }),
            );
            return {
                output: normalizeTaskValue(output) as SemanticValue,
                usage: {
                    cacheCreationInputTokens: 0,
                    cacheReadInputTokens: 0,
                    costUsd: null,
                    inputTokens: 0,
                    outputTokens: 0,
                },
            };
        },
    });
}
