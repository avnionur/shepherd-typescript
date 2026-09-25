import { withPublicationControls } from "../formal/inspection-envelope.ts";
import {
    delegationProtocolConfig,
    formalAssuranceProtocolConfig,
    kernelProtocolConfig,
} from "../protocol/config.ts";
import {
    DELEGATION_APPROVAL_VERDICTS,
    DELEGATION_CONTEXT_PHASES,
    DELEGATION_DECISION_KINDS,
    DELEGATION_PARENT_KINDS,
    DELEGATION_PROVENANCE_KINDS,
    DELEGATION_STATUSES,
    DURABLE_EXECUTION_RECOVERY_STATUSES,
    RECORD_MODES,
    RUN_TERMINAL_STATUSES,
} from "../protocol/values.generated.ts";
import { ROOT_WITNESS_ID } from "../record/root-witness.ts";
import type { RecordId } from "../record/types.ts";
import { inspectDurableTaskExecution } from "../run/durable-execution-inspection.ts";
import type { DurableTaskExecutionInspection } from "../run/durable-execution-inspection-types.ts";
import { assertPrefixedDigest, readScopeDataObject } from "../scope/validation.ts";
import type { SQLiteTraceStore } from "../store/sqlite-trace-store.ts";
import type { OwnerRecord } from "../store/types.ts";
import { DelegationEvidenceError } from "./errors.ts";
import {
    canonical,
    composeChildRunRequest,
    createDelegationCauses,
    createDelegationOutputDigest,
    createDelegationRequestDigest,
    type DelegationOpenedBody,
    readDelegationApprovalBody,
    readDelegationCompletionBody,
    readDelegationContextBody,
    readDelegationDecisionBody,
    readDelegationHandoffBody,
    readDelegationOpenedBody,
} from "./records.ts";
import type {
    ChildRunApprovalInspection,
    ChildRunCompletionInspection,
    ChildRunConsumedContextInspection,
    ChildRunDecisionInspection,
    ChildRunHandoffInspection,
    ChildRunInjectionInspection,
    ChildRunInspection,
    ChildRunStatus,
    InspectChildRunOptions,
} from "./types.ts";

const config = delegationProtocolConfig;
const [CAPTURE_MODE, DECLARATION_MODE] = RECORD_MODES;
const [ROOT_KIND] = DELEGATION_PARENT_KINDS;
const [DECLARED_KIND, , SYNTHESIZED_KIND] = DELEGATION_PROVENANCE_KINDS;
const [INJECTED_PHASE] = DELEGATION_CONTEXT_PHASES;
const [APPROVED_VERDICT] = DELEGATION_APPROVAL_VERDICTS;
const [ACCEPTED_KIND] = DELEGATION_DECISION_KINDS;
const [FINISHED_STATUS] = RUN_TERMINAL_STATUSES;
const [
    READY_STATUS,
    RUNNING_STATUS,
    SETTLING_STATUS,
    APPROVAL_PENDING_STATUS,
    REJECTED_STATUS,
    ACCEPTED_STATUS,
    DISCARDED_STATUS,
] = DELEGATION_STATUSES;
const [ABSENT_CHILD_STATUS, CREATED_CHILD_STATUS, STARTED_CHILD_STATUS] =
    DURABLE_EXECUTION_RECOVERY_STATUSES;

type MutableInjection = {
    -readonly [Key in keyof ChildRunInjectionInspection]: ChildRunInjectionInspection[Key];
};

/**
 * Reads one child run handle as an immutable, fully validated, record-derived view.
 *
 * Every record on the handle owner path is checked: versions, schemas, modes, witnesses, causal
 * parents, the derived handle and child run identities, the task value and its lock, the input
 * against the task input schema, the provenance against the task and the store, effective
 * authority re-derived from the retained ceiling and grant, budget attenuation against the
 * retained ceiling, the parent handle chain with its origin cut, the discarded predecessor of a
 * retry with its retry cut, the supervisor chain through every handoff, injections and their
 * consumption, the approval, the completion against the child's durable inspection, and the
 * terminal decision. Status is derived from the handle records and the child's durable execution.
 * Inspection appends nothing and works on read-only, reopened, and imported stores.
 *
 * @param store - Open trace store, writable or read-only.
 * @param handleId - Handle identity.
 * @param options - Reserved; currently accepts no fields.
 * @returns The validated inspection.
 * @throws {DelegationEvidenceError} If the handle is absent or its evidence is inconsistent.
 * @throws {TraceStoreError} If the store is closed.
 * @throws {TypeError} If the handle identity or options are malformed.
 *
 * @example
 * ```ts
 * const inspection = inspectChildRun(store, handle.handle_id);
 * console.log(inspection.status, inspection.supervisor_id, inspection.decision);
 * ```
 */
export function inspectChildRun(
    store: SQLiteTraceStore,
    handleId: string,
    options: InspectChildRunOptions = {},
): ChildRunInspection {
    readScopeDataObject(options, [], "inspectChildRun options");
    assertPrefixedDigest(handleId, config.identity.handleIdPrefix, "handleId");
    return foldChildRun(store, handleId);
}

/** Folds retained handle records into a validated inspection. @internal */
export function foldChildRun(store: SQLiteTraceStore, handleId: string): ChildRunInspection {
    const records = store.readOwner(handleId);
    const [first] = records;
    if (first === undefined) {
        throw new DelegationEvidenceError(`handle ${handleId} is not retained`);
    }
    try {
        return fold(store, handleId, records, first);
    } catch (error) {
        if (error instanceof DelegationEvidenceError) {
            throw error;
        }
        throw new DelegationEvidenceError(`handle ${handleId} evidence is inconsistent`, {
            cause: error,
        });
    }
}

function fold(
    store: SQLiteTraceStore,
    handleId: string,
    records: readonly OwnerRecord[],
    first: OwnerRecord,
): ChildRunInspection {
    assertRecord(first, config.traceSchemas.opened, DECLARATION_MODE);
    const opened = readDelegationOpenedBody(first.body);
    assert(opened.handle_id === handleId, "opened record names a different handle");
    const openedCauses = [
        ...(opened.parent.kind === ROOT_KIND ? [] : [opened.parent.origin_record_id]),
        ...(opened.predecessor === null ? [] : [opened.predecessor.decision_record_id]),
    ];
    assert(
        sameIds(first.envelope.caused_by_record_ids, openedCauses),
        "opened record does not cite exactly the parent head and the predecessor decision",
    );
    let head = first.envelope.record_id;
    let remaining = records.slice(1);
    if (opened.parent.kind !== ROOT_KIND) {
        const parent = opened.parent;
        const [cutRecord] = remaining;
        assertCutRecord(
            store,
            handleId,
            cutRecord,
            parent.origin_cut_id,
            parent.handle_id,
            parent.origin_record_id,
            [parent.origin_record_id, first.envelope.record_id],
            "origin",
        );
        const parentInspection = foldChildRun(store, parent.handle_id);
        assert(
            parentInspection.depth + 1 === opened.depth &&
                canonical(opened.authority.ceiling) ===
                    canonical(parentInspection.authority.effective) &&
                canonical(opened.budget_ceiling) === canonical(parentInspection.budget.effective),
            "handle authority, budget ceiling, or depth differs from the parent handle",
        );
        head = cutRecord.envelope.record_id;
        remaining = remaining.slice(1);
    }
    if (opened.predecessor !== null) {
        const predecessor = opened.predecessor;
        const [cutRecord] = remaining;
        assertCutRecord(
            store,
            handleId,
            cutRecord,
            predecessor.cut_id,
            predecessor.handle_id,
            predecessor.decision_record_id,
            [predecessor.decision_record_id, first.envelope.record_id],
            "retry",
        );
        const predecessorInspection = foldChildRun(store, predecessor.handle_id);
        assert(
            predecessorInspection.status === DISCARDED_STATUS &&
                predecessorInspection.head_record_id === predecessor.decision_record_id &&
                sameParent(predecessorInspection.parent, opened.parent),
            "retry predecessor is not a discarded handle under the same parent",
        );
        head = cutRecord.envelope.record_id;
        remaining = remaining.slice(1);
    }
    if (opened.provenance.kind === SYNTHESIZED_KIND) {
        const runId = opened.provenance.source_run_id;
        assert(
            store
                .readRecord(opened.provenance.source_record_id)
                ?.views.some((view) => view.owner_id === runId) === true,
            "synthesized provenance cites a record not retained by the producing run",
        );
    }
    const child = inspectDurableTaskExecution(store, opened.child_run_id);
    const declared = opened.provenance.kind === DECLARED_KIND;
    const handoffs: ChildRunHandoffInspection[] = [];
    const injections: MutableInjection[] = [];
    let supervisor = opened.supervisor_id;
    let approval: ChildRunApprovalInspection | null = null;
    let consumed: ChildRunConsumedContextInspection | null = null;
    let completion: ChildRunCompletionInspection | null = null;
    let decision: ChildRunDecisionInspection | null = null;
    for (const record of remaining) {
        assert(decision === null, "handle retains a record after its terminal decision");
        const schemaRef = record.envelope.schema_ref;
        const causes = record.envelope.caused_by_record_ids;
        const recordId = record.envelope.record_id;
        assertRecord(record, schemaRef, CAPTURE_MODE);
        if (schemaRef === config.traceSchemas.context) {
            const body = readDelegationContextBody(record.body);
            assert(
                body.handle_id === handleId && body.supervisor_id === supervisor,
                "context record names another handle or a former supervisor",
            );
            if (body.phase === INJECTED_PHASE) {
                assert(
                    injections.length < config.limits.maxInjections &&
                        body.cited_record_ids.every(
                            (cited) => store.readRecord(cited) !== undefined,
                        ) &&
                        sameIds(causes, createDelegationCauses(head, body.cited_record_ids)),
                    "injection exceeds the bound, cites a record outside the store, or has unexpected causes",
                );
                injections.push({
                    cited_record_ids: body.cited_record_ids,
                    command_id: body.command_id,
                    consumed: false,
                    data: body.data,
                    record_id: recordId,
                    supervisor_id: body.supervisor_id,
                });
            } else {
                assert(
                    consumed === null &&
                        completion === null &&
                        (declared || approval?.verdict === APPROVED_VERDICT) &&
                        body.command_id === opened.command_id &&
                        sameIds(
                            body.consumed_record_ids,
                            injections.map((injection) => injection.record_id),
                        ) &&
                        body.request_digest ===
                            createDelegationRequestDigest(
                                composeChildRunRequest(opened.input, injections),
                            ) &&
                        sameIds(causes, createDelegationCauses(head, body.consumed_record_ids)),
                    "consumption record is repeated, late, unapproved, or disagrees with the injections",
                );
                for (const injection of injections) {
                    injection.consumed = true;
                }
                consumed = Object.freeze({
                    consumed_record_ids: body.consumed_record_ids,
                    record_id: recordId,
                    request_digest: body.request_digest,
                    supervisor_id: body.supervisor_id,
                });
            }
        } else if (schemaRef === config.traceSchemas.handoff) {
            const body = readDelegationHandoffBody(record.body);
            assert(
                body.handle_id === handleId &&
                    body.supervisor_id === supervisor &&
                    sameIds(causes, [head]),
                "handoff names another handle or a former supervisor",
            );
            handoffs.push(
                Object.freeze({
                    command_id: body.command_id,
                    reason: body.reason,
                    record_id: recordId,
                    successor_id: body.successor_id,
                    supervisor_id: body.supervisor_id,
                }),
            );
            supervisor = body.successor_id;
        } else if (schemaRef === config.traceSchemas.approval) {
            const body = readDelegationApprovalBody(record.body);
            assert(
                approval === null &&
                    !declared &&
                    consumed === null &&
                    completion === null &&
                    body.handle_id === handleId &&
                    body.supervisor_id === supervisor &&
                    body.task_artifact_digest === opened.task.artifact_lock.artifact_digest &&
                    sameIds(causes, [head]),
                "approval is repeated, unneeded, late, or disagrees with the task",
            );
            approval = Object.freeze({
                approver_id: body.approver_id,
                command_id: body.command_id,
                reason: body.reason,
                record_id: recordId,
                supervisor_id: body.supervisor_id,
                task_artifact_digest: body.task_artifact_digest,
                verdict: body.verdict,
            });
        } else if (schemaRef === config.traceSchemas.completion) {
            const body = readDelegationCompletionBody(record.body);
            assert(
                completion === null &&
                    (declared || approval?.verdict === APPROVED_VERDICT) &&
                    body.handle_id === handleId &&
                    body.supervisor_id === supervisor &&
                    child.cut !== null &&
                    child.outcome !== null &&
                    child.lifecycle.terminal_record_id === body.child_terminal_record_id &&
                    child.cut.cut_id === body.child_cut_id &&
                    child.outcome.outcome.outcome.status === body.status &&
                    sameIds(causes, [
                        head,
                        body.child_terminal_record_id,
                        child.cut.created_by_record_id,
                    ]),
                "completion disagrees with the child's durable execution",
            );
            completion = Object.freeze({
                child_cut_id: body.child_cut_id,
                child_terminal_record_id: body.child_terminal_record_id,
                execution_kind: body.execution_kind,
                record_id: recordId,
                status: body.status,
                supervisor_id: body.supervisor_id,
            });
        } else {
            assert(
                schemaRef === config.traceSchemas.decision,
                "handle retains an unsupported record",
            );
            const body = readDelegationDecisionBody(record.body);
            assert(
                body.handle_id === handleId && body.supervisor_id === supervisor,
                "decision names another handle or a former supervisor",
            );
            if (body.kind === ACCEPTED_KIND) {
                const outcome = child.outcome?.outcome.outcome;
                assert(
                    completion !== null &&
                        completion.status === FINISHED_STATUS &&
                        outcome !== undefined &&
                        outcome.status === FINISHED_STATUS &&
                        body.child_outcome_record_id === child.outcome?.record_id &&
                        body.output_id === createDelegationOutputDigest(outcome.value) &&
                        sameIds(
                            causes,
                            createDelegationCauses(head, [body.child_outcome_record_id]),
                        ),
                    "accept decision disagrees with the finished child outcome",
                );
            } else {
                assert(sameIds(causes, [head]), "discard decision has unexpected causes");
            }
            decision = Object.freeze({
                child_outcome_record_id: body.child_outcome_record_id,
                command_id: body.command_id,
                kind: body.kind,
                output_id: body.output_id,
                reason: body.reason,
                record_id: recordId,
                supervisor_id: body.supervisor_id,
            });
        }
        head = recordId;
    }
    return Object.freeze({
        approval,
        authority: opened.authority,
        budget: Object.freeze({ ceiling: opened.budget_ceiling, effective: opened.budget }),
        child: child.status === ABSENT_CHILD_STATUS ? null : child,
        child_run_id: opened.child_run_id,
        command_id: opened.command_id,
        completion,
        consumed_context: consumed,
        decision,
        depth: opened.depth,
        grant: opened.grant,
        handle_id: handleId,
        handoffs: Object.freeze(handoffs),
        head_record_id: head,
        injections: Object.freeze(injections.map((injection) => Object.freeze({ ...injection }))),
        input: opened.input,
        opened_record_id: first.envelope.record_id,
        opened_supervisor_id: opened.supervisor_id,
        parent: opened.parent,
        predecessor: opened.predecessor,
        proof: withPublicationControls(
            child.proof,
            handoffs.length === 0
                ? []
                : [formalAssuranceProtocolConfig.inspection.publicationControls.delegationHandoff],
        ),
        provenance: opened.provenance,
        status: deriveStatus(opened, approval, decision, child),
        supervisor_id: supervisor,
        task: opened.task,
    });
}

function deriveStatus(
    opened: DelegationOpenedBody,
    approval: ChildRunApprovalInspection | null,
    decision: ChildRunDecisionInspection | null,
    child: DurableTaskExecutionInspection,
): ChildRunStatus {
    if (decision !== null) {
        return decision.kind === ACCEPTED_KIND ? ACCEPTED_STATUS : DISCARDED_STATUS;
    }
    if (opened.provenance.kind !== DECLARED_KIND) {
        if (approval === null) {
            return APPROVAL_PENDING_STATUS;
        }
        if (approval.verdict !== APPROVED_VERDICT) {
            return REJECTED_STATUS;
        }
    }
    if (child.status === ABSENT_CHILD_STATUS) {
        return READY_STATUS;
    }
    if (child.status === CREATED_CHILD_STATUS || child.status === STARTED_CHILD_STATUS) {
        return RUNNING_STATUS;
    }
    return SETTLING_STATUS;
}

function assertCutRecord(
    store: SQLiteTraceStore,
    handleId: string,
    cutRecord: OwnerRecord | undefined,
    cutId: string,
    targetOwnerId: string,
    throughRecordId: RecordId,
    causes: readonly RecordId[],
    label: string,
): asserts cutRecord is OwnerRecord {
    assert(
        cutRecord !== undefined &&
            cutRecord.envelope.schema_ref === kernelProtocolConfig.queries.cutSchemaRef &&
            cutRecord.body.cut_id === cutId &&
            cutRecord.body.target_owner_id === targetOwnerId &&
            cutRecord.body.through_record_id === throughRecordId &&
            sameIds(cutRecord.envelope.caused_by_record_ids, causes),
        `${label} cut publication does not follow the opened record`,
    );
    assertRecord(cutRecord, kernelProtocolConfig.queries.cutSchemaRef, CAPTURE_MODE);
    const cut = store.readCut(cutId);
    assert(
        cut.target_owner_id === targetOwnerId &&
            cut.through_record_id === throughRecordId &&
            cut.publisher_owner_id === handleId,
        `${label} cut does not resolve through the cited head`,
    );
}

function sameParent(
    left: ChildRunInspection["parent"],
    right: ChildRunInspection["parent"],
): boolean {
    return left.kind === ROOT_KIND
        ? right.kind === ROOT_KIND
        : right.kind !== ROOT_KIND && left.handle_id === right.handle_id;
}

function assertRecord(record: OwnerRecord, schema: string, mode: string): void {
    assert(
        record.envelope.schema_ref === schema &&
            record.envelope.mode === mode &&
            record.envelope.witness_ref === ROOT_WITNESS_ID,
        `record ${record.envelope.record_id} has an unexpected schema, mode, or witness`,
    );
}

function assert(condition: boolean, message: string): asserts condition {
    if (!condition) {
        throw new DelegationEvidenceError(message);
    }
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}
