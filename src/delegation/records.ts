import {
    canonicalizeSemanticValue,
    createRecordId,
    type SemanticRecord,
    type SemanticValue,
} from "../canonical/canonical-record.ts";
import { createCanonicalSnapshot } from "../canonical/snapshot.ts";
import {
    delegationProtocolConfig,
    recordIdConfig,
    taskProtocolConfig,
} from "../protocol/config.ts";
import {
    DELEGATION_APPROVAL_VERDICTS,
    DELEGATION_CONTEXT_PHASES,
    DELEGATION_DECISION_KINDS,
    DELEGATION_EXECUTION_KINDS,
    DELEGATION_PARENT_KINDS,
    DELEGATION_PROVENANCE_KINDS,
    DELEGATION_REVISION_FIELDS,
    RUN_TERMINAL_STATUSES,
} from "../protocol/values.generated.ts";
import { assertRecordId } from "../record/guards.ts";
import type { RecordBody, RecordId } from "../record/types.ts";
import type { RunBudgetDefinition } from "../run/control-types.ts";
import { normalizeTaskValue } from "../run/execution-preparation.ts";
import type { RunTerminalStatus } from "../run/types.ts";
import { readScopeResourceGrants } from "../scope/authority.ts";
import type { ScopeAuthority, ScopeResourceGrant } from "../scope/types.ts";
import {
    assertPrefixedDigest,
    assertScopeText,
    readScopeArray,
    readScopeDataObject,
} from "../scope/validation.ts";
import type { TaskValue } from "../task/types.ts";
import { taskDescriptorOf } from "../task/value.ts";
import { readTaskValue } from "../task/value-codec.ts";
import {
    assertBudgetAttenuated,
    readDelegationBudget,
    sameDelegatedAuthority,
} from "./authority.ts";
import { DelegationEvidenceError } from "./errors.ts";
import type {
    ChildRunApprovalVerdict,
    ChildRunContextPhase,
    ChildRunDecisionKind,
    ChildRunExecutionKind,
    ChildRunParentInspection,
    ChildRunPredecessorInspection,
    ChildRunProvenance,
    ChildRunRevisionField,
    ChildRunSupervisorContextEntry,
} from "./types.ts";

const config = delegationProtocolConfig;
const [ROOT_KIND, HANDLE_KIND] = DELEGATION_PARENT_KINDS;
const [DECLARED_KIND, REVISED_KIND, SYNTHESIZED_KIND] = DELEGATION_PROVENANCE_KINDS;
const [INJECTED_PHASE, CONSUMED_PHASE] = DELEGATION_CONTEXT_PHASES;
const [ACCEPTED_KIND] = DELEGATION_DECISION_KINDS;

/** Retained opened record body. @internal */
export type DelegationOpenedBody = {
    readonly authority: ScopeAuthority;
    readonly budget: RunBudgetDefinition;
    readonly budget_ceiling: RunBudgetDefinition;
    readonly child_run_id: string;
    readonly command_id: string;
    readonly compatibility_version: string;
    readonly delegation_version: number;
    readonly depth: number;
    readonly grant: readonly ScopeResourceGrant[];
    readonly handle_id: string;
    readonly input: SemanticValue;
    readonly parent: ChildRunParentInspection;
    readonly predecessor: ChildRunPredecessorInspection | null;
    readonly provenance: ChildRunProvenance;
    readonly supervisor_id: string;
    readonly task: TaskValue;
};

/** Retained completion record body. @internal */
export type DelegationCompletionBody = {
    readonly child_cut_id: string;
    readonly child_run_id: string;
    readonly child_terminal_record_id: RecordId;
    readonly compatibility_version: string;
    readonly delegation_version: number;
    readonly execution_kind: ChildRunExecutionKind;
    readonly handle_id: string;
    readonly status: RunTerminalStatus;
    readonly supervisor_id: string;
};

/** Retained context record body: an injection or the consumption record. @internal */
export type DelegationContextBody =
    | {
          readonly cited_record_ids: readonly RecordId[];
          readonly command_id: string;
          readonly compatibility_version: string;
          readonly data: RecordBody;
          readonly delegation_version: number;
          readonly handle_id: string;
          readonly phase: (typeof DELEGATION_CONTEXT_PHASES)[0];
          readonly supervisor_id: string;
      }
    | {
          readonly command_id: string;
          readonly compatibility_version: string;
          readonly consumed_record_ids: readonly RecordId[];
          readonly delegation_version: number;
          readonly handle_id: string;
          readonly phase: (typeof DELEGATION_CONTEXT_PHASES)[1];
          readonly request_digest: string;
          readonly supervisor_id: string;
      };

/** Retained handoff record body. @internal */
export type DelegationHandoffBody = {
    readonly command_id: string;
    readonly compatibility_version: string;
    readonly delegation_version: number;
    readonly handle_id: string;
    readonly reason: string | null;
    readonly successor_id: string;
    readonly supervisor_id: string;
};

/** Retained approval record body. @internal */
export type DelegationApprovalBody = {
    readonly approver_id: string;
    readonly command_id: string;
    readonly compatibility_version: string;
    readonly delegation_version: number;
    readonly handle_id: string;
    readonly reason: string | null;
    readonly supervisor_id: string;
    readonly task_artifact_digest: string;
    readonly verdict: ChildRunApprovalVerdict;
};

/** Retained decision record body. @internal */
export type DelegationDecisionBody = {
    readonly child_outcome_record_id: RecordId | null;
    readonly command_id: string;
    readonly compatibility_version: string;
    readonly delegation_version: number;
    readonly handle_id: string;
    readonly kind: ChildRunDecisionKind;
    readonly output_id: string | null;
    readonly reason: string | null;
    readonly supervisor_id: string;
};

const VERSION_FIELDS = {
    compatibility_version: config.compatibilityVersion,
    delegation_version: config.recordVersion,
} as const;

type Unversioned<T> = T extends unknown ? Omit<T, keyof typeof VERSION_FIELDS> : never;

/** Derives the handle identity and reserved owner path of one opening command. @internal */
export function createChildRunHandleId(commandId: string): string {
    assertScopeText(commandId, "commandId");
    return prefixed(config.identity.handleIdPrefix, { command_id: commandId });
}

/** Derives the durable child run identity of one handle. @internal */
export function createChildRunId(handleId: string): string {
    return prefixed(config.identity.childRunIdPrefix, { handle_id: handleId });
}

/** Derives the origin cut identity published through a parent handle head. @internal */
export function createDelegationOriginCutId(handleId: string): string {
    return prefixed(config.identity.originCutIdPrefix, {
        delegation_origin: { handle_id: handleId },
    });
}

/** Derives the retry cut identity published through a discarded predecessor head. @internal */
export function createDelegationRetryCutId(handleId: string): string {
    return prefixed(config.identity.retryCutIdPrefix, {
        delegation_retry: { handle_id: handleId },
    });
}

/** Derives the append intent naming one step of one delegation command. @internal */
export function createDelegationAppendIntentId(commandId: string, step: string): string {
    return createRecordId({
        [config.identity.commandAppendIntentKind]: { command_id: commandId, step },
    });
}

/**
 * Causal parents of one handle command record: the handle head first, then every cited record
 * other than the head, so a command citing the current head never repeats a parent.
 *
 * @internal
 */
export function createDelegationCauses(
    head: RecordId,
    cited: readonly RecordId[],
): readonly RecordId[] {
    return Object.freeze([head, ...cited.filter((recordId) => recordId !== head)]);
}

/** Digest of the canonical composed provider request one child saw. @internal */
export function createDelegationRequestDigest(request: SemanticValue): string {
    return createRecordId({ [config.identity.requestDigestKind]: request });
}

/** Digest of one canonical accepted output value. @internal */
export function createDelegationOutputDigest(value: SemanticValue): string {
    return createRecordId({ [config.identity.outputDigestKind]: value });
}

/**
 * Composes the provider request a child sees from its validated input and the consumed context.
 *
 * With no consumed injection the request is the plain task input; otherwise it is
 * `{ input, supervisor_context }` with the injections in owner order.
 *
 * @internal
 */
export function composeChildRunRequest(
    input: SemanticValue,
    context: readonly ChildRunSupervisorContextEntry[],
): SemanticValue {
    return context.length === 0
        ? input
        : (createCanonicalSnapshot({
              input,
              supervisor_context: context.map((entry) => ({
                  cited_record_ids: entry.cited_record_ids,
                  data: entry.data,
                  record_id: entry.record_id,
              })),
          } as unknown as SemanticRecord) as SemanticValue);
}

/** Validates one supervisor identity within the configured bound. @internal */
export function readSupervisorId(value: unknown, subject: string): string {
    assertScopeText(value, subject);
    if (value.length > config.limits.maxSupervisorIdLength) {
        throw new TypeError(`${subject} exceeds the configured length bound`);
    }
    return value;
}

/** Validates one optional retained reason within the configured bound. @internal */
export function readDelegationReason(value: unknown, subject: string): string | null {
    if (value === null || value === undefined) {
        return null;
    }
    assertScopeText(value, subject);
    if (value.length > config.limits.maxReasonLength) {
        throw new TypeError(`${subject} exceeds the configured length bound`);
    }
    return value;
}

/** Validates unique, non-empty, bounded record citations. @internal */
export function readDelegationCitations(
    value: unknown,
    subject: string,
    maximum: number,
): readonly RecordId[] {
    const citations = readScopeArray(value, subject).map((recordId, index) => {
        assertRecordId(recordId, `${subject}[${index}]`);
        return recordId;
    });
    if (
        citations.length === 0 ||
        citations.length > maximum ||
        new Set(citations).size !== citations.length
    ) {
        throw new TypeError(
            `${subject} must be unique, non-empty, and within the configured bound`,
        );
    }
    return Object.freeze(citations);
}

/** Validates canonical injected application data. @internal */
export function readDelegationData(value: unknown): RecordBody {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new TypeError("data must be a canonical semantic record");
    }
    return createCanonicalSnapshot(value as RecordBody);
}

/** Configured revision fields whose artifact values differ between two task values. @internal */
export function readRevisionDifferences(
    source: TaskValue,
    task: TaskValue,
): readonly ChildRunRevisionField[] {
    return Object.freeze(
        DELEGATION_REVISION_FIELDS.filter(
            (field) =>
                canonical(source.artifact[field] as SemanticValue) !==
                canonical(task.artifact[field] as SemanticValue),
        ),
    );
}

/** Creates one retained opened body. @internal */
export function createDelegationOpenedBody(
    fields: Omit<DelegationOpenedBody, keyof typeof VERSION_FIELDS>,
): RecordBody {
    return createCanonicalSnapshot({ ...VERSION_FIELDS, ...fields } as unknown as RecordBody);
}

/** Creates one retained completion body. @internal */
export function createDelegationCompletionBody(
    fields: Omit<DelegationCompletionBody, keyof typeof VERSION_FIELDS>,
): RecordBody {
    return createCanonicalSnapshot({ ...VERSION_FIELDS, ...fields } as unknown as RecordBody);
}

/** Creates one retained context body. @internal */
export function createDelegationContextBody(
    fields: Unversioned<DelegationContextBody>,
): RecordBody {
    return createCanonicalSnapshot({ ...VERSION_FIELDS, ...fields } as unknown as RecordBody);
}

/** Creates one retained handoff body. @internal */
export function createDelegationHandoffBody(
    fields: Omit<DelegationHandoffBody, keyof typeof VERSION_FIELDS>,
): RecordBody {
    return createCanonicalSnapshot({ ...VERSION_FIELDS, ...fields } as unknown as RecordBody);
}

/** Creates one retained approval body. @internal */
export function createDelegationApprovalBody(
    fields: Omit<DelegationApprovalBody, keyof typeof VERSION_FIELDS>,
): RecordBody {
    return createCanonicalSnapshot({ ...VERSION_FIELDS, ...fields } as unknown as RecordBody);
}

/** Creates one retained decision body. @internal */
export function createDelegationDecisionBody(
    fields: Omit<DelegationDecisionBody, keyof typeof VERSION_FIELDS>,
): RecordBody {
    return createCanonicalSnapshot({ ...VERSION_FIELDS, ...fields } as unknown as RecordBody);
}

/**
 * Validates a retained opened body, including every derived identity, the task value, the
 * validated input, the provenance against the task, re-derived effective authority, budget
 * attenuation, and the predecessor citation of a retry.
 *
 * @internal
 */
export function readDelegationOpenedBody(body: RecordBody): DelegationOpenedBody {
    return decode("opened", () => {
        const fields = readVersionedBody(body, [
            "authority",
            "budget",
            "budget_ceiling",
            "child_run_id",
            "command_id",
            "depth",
            "grant",
            "handle_id",
            "input",
            "parent",
            "predecessor",
            "provenance",
            "supervisor_id",
            "task",
        ]);
        assertScopeText(fields.command_id, "command_id");
        readSupervisorId(fields.supervisor_id, "supervisor_id");
        const handleId = createChildRunHandleId(fields.command_id);
        if (
            fields.handle_id !== handleId ||
            fields.child_run_id !== createChildRunId(handleId) ||
            !Number.isSafeInteger(fields.depth) ||
            (fields.depth as number) < 1 ||
            (fields.depth as number) > config.limits.maxNestingDepth
        ) {
            throw new TypeError("handle identity, child run identity, or depth is inconsistent");
        }
        const task = readTaskValue(fields.task);
        const input = normalizeTaskValue(taskDescriptorOf(task).parseInput(fields.input));
        const grant = readScopeResourceGrants(fields.grant, "grant");
        const authorityFields = readScopeDataObject(
            fields.authority,
            ["ceiling", "effective"],
            "authority",
        );
        const authority = Object.freeze({
            ceiling: readScopeResourceGrants(authorityFields.ceiling, "authority.ceiling"),
            effective: readScopeResourceGrants(authorityFields.effective, "authority.effective"),
        });
        if (
            canonical(grant) !== canonical(fields.grant) ||
            canonical(authority) !== canonical(fields.authority) ||
            !sameDelegatedAuthority(authority, grant)
        ) {
            throw new TypeError("effective authority does not re-derive from ceiling and grant");
        }
        const budget = readDelegationBudget(fields.budget, "budget");
        const budgetCeiling = readDelegationBudget(fields.budget_ceiling, "budget_ceiling");
        assertBudgetAttenuated(budgetCeiling, budget);
        const parent = readParent(fields.parent);
        if ((parent.kind === ROOT_KIND) !== (fields.depth === 1)) {
            throw new TypeError("parent kind and depth are inconsistent");
        }
        const provenance = readProvenance(fields.provenance, task);
        const predecessor = readPredecessor(fields.predecessor);
        if (predecessor !== null && predecessor.handle_id === handleId) {
            throw new TypeError("a handle cannot be its own predecessor");
        }
        return {
            ...fields,
            authority,
            budget,
            budget_ceiling: budgetCeiling,
            grant,
            input,
            parent,
            predecessor,
            provenance,
            task,
        } as unknown as DelegationOpenedBody;
    });
}

/** Validates a retained completion body. @internal */
export function readDelegationCompletionBody(body: RecordBody): DelegationCompletionBody {
    return decode("completion", () => {
        const fields = readVersionedBody(body, [
            "child_cut_id",
            "child_run_id",
            "child_terminal_record_id",
            "execution_kind",
            "handle_id",
            "status",
            "supervisor_id",
        ]);
        assertPrefixedDigest(fields.handle_id, config.identity.handleIdPrefix, "handle_id");
        assertScopeText(fields.child_cut_id, "child_cut_id");
        assertRecordId(fields.child_terminal_record_id, "child_terminal_record_id");
        readSupervisorId(fields.supervisor_id, "supervisor_id");
        if (
            fields.child_run_id !== createChildRunId(fields.handle_id as string) ||
            !DELEGATION_EXECUTION_KINDS.includes(fields.execution_kind as never) ||
            !RUN_TERMINAL_STATUSES.includes(fields.status as never)
        ) {
            throw new TypeError("child run identity, execution kind, or status is inconsistent");
        }
        return fields as unknown as DelegationCompletionBody;
    });
}

/** Validates a retained context body in either configured phase. @internal */
export function readDelegationContextBody(body: RecordBody): DelegationContextBody {
    return decode("context", () => {
        const phase = (body as { readonly phase?: unknown }).phase as ChildRunContextPhase;
        if (phase === INJECTED_PHASE) {
            const fields = readVersionedBody(body, [
                "cited_record_ids",
                "command_id",
                "data",
                "handle_id",
                "phase",
                "supervisor_id",
            ]);
            readCommandFields(fields);
            return {
                ...fields,
                cited_record_ids: readDelegationCitations(
                    fields.cited_record_ids,
                    "cited_record_ids",
                    config.limits.maxCitedRecords,
                ),
                data: readDelegationData(fields.data),
            } as unknown as DelegationContextBody;
        }
        if (phase !== CONSUMED_PHASE) {
            throw new TypeError("context phase is not configured");
        }
        const fields = readVersionedBody(body, [
            "command_id",
            "consumed_record_ids",
            "handle_id",
            "phase",
            "request_digest",
            "supervisor_id",
        ]);
        readCommandFields(fields);
        assertRecordId(fields.request_digest, "request_digest");
        return {
            ...fields,
            consumed_record_ids: readDelegationCitations(
                fields.consumed_record_ids,
                "consumed_record_ids",
                config.limits.maxInjections,
            ),
        } as unknown as DelegationContextBody;
    });
}

/** Validates a retained handoff body. @internal */
export function readDelegationHandoffBody(body: RecordBody): DelegationHandoffBody {
    return decode("handoff", () => {
        const fields = readVersionedBody(body, [
            "command_id",
            "handle_id",
            "reason",
            "successor_id",
            "supervisor_id",
        ]);
        readCommandFields(fields);
        readSupervisorId(fields.successor_id, "successor_id");
        readDelegationReason(fields.reason, "reason");
        if (fields.successor_id === fields.supervisor_id) {
            throw new TypeError("handoff successor must differ from the supervisor");
        }
        return fields as unknown as DelegationHandoffBody;
    });
}

/** Validates a retained approval body. @internal */
export function readDelegationApprovalBody(body: RecordBody): DelegationApprovalBody {
    return decode("approval", () => {
        const fields = readVersionedBody(body, [
            "approver_id",
            "command_id",
            "handle_id",
            "reason",
            "supervisor_id",
            "task_artifact_digest",
            "verdict",
        ]);
        readCommandFields(fields);
        assertScopeText(fields.approver_id, "approver_id");
        readDelegationReason(fields.reason, "reason");
        assertPrefixedDigest(
            fields.task_artifact_digest,
            taskProtocolConfig.digestPrefix,
            "task_artifact_digest",
        );
        if (!DELEGATION_APPROVAL_VERDICTS.includes(fields.verdict as never)) {
            throw new TypeError("approval verdict is not configured");
        }
        return fields as unknown as DelegationApprovalBody;
    });
}

/** Validates a retained decision body. @internal */
export function readDelegationDecisionBody(body: RecordBody): DelegationDecisionBody {
    return decode("decision", () => {
        const fields = readVersionedBody(body, [
            "child_outcome_record_id",
            "command_id",
            "handle_id",
            "kind",
            "output_id",
            "reason",
            "supervisor_id",
        ]);
        readCommandFields(fields);
        const reason = readDelegationReason(fields.reason, "reason");
        const accepted = fields.kind === ACCEPTED_KIND;
        if (
            !DELEGATION_DECISION_KINDS.includes(fields.kind as never) ||
            accepted !== (fields.child_outcome_record_id !== null) ||
            accepted !== (fields.output_id !== null) ||
            accepted !== (reason === null)
        ) {
            throw new TypeError("decision kind, citations, output, and reason are inconsistent");
        }
        if (accepted) {
            assertRecordId(fields.child_outcome_record_id, "child_outcome_record_id");
            assertRecordId(fields.output_id, "output_id");
        }
        return fields as unknown as DelegationDecisionBody;
    });
}

/** Canonical text of one semantic value for exact comparison. @internal */
export function canonical(value: unknown): string {
    return canonicalizeSemanticValue(value as SemanticValue);
}

function readCommandFields(fields: Record<string, unknown>): void {
    assertScopeText(fields.command_id, "command_id");
    assertPrefixedDigest(fields.handle_id, config.identity.handleIdPrefix, "handle_id");
    readSupervisorId(fields.supervisor_id, "supervisor_id");
}

function readProvenance(value: unknown, task: TaskValue): ChildRunProvenance {
    const kind = (value as { readonly kind?: unknown } | null)?.kind;
    if (kind === DECLARED_KIND) {
        readScopeDataObject(value, ["kind"], "provenance");
        return Object.freeze({ kind: DECLARED_KIND });
    }
    if (kind === REVISED_KIND) {
        const fields = readScopeDataObject(value, ["fields", "kind", "source_task"], "provenance");
        const source = readTaskValue(fields.source_task);
        const declared = readScopeArray(fields.fields, "provenance.fields");
        const differences = readRevisionDifferences(source, task);
        if (
            source.artifact_lock.task_id !== task.artifact_lock.task_id ||
            differences.length === 0 ||
            declared.join("\0") !== differences.join("\0")
        ) {
            throw new TypeError(
                "revised provenance must keep the task identity and list exactly the differing fields",
            );
        }
        return Object.freeze({ fields: differences, kind: REVISED_KIND, source_task: source });
    }
    const fields = readScopeDataObject(
        value,
        ["kind", "source_record_id", "source_run_id"],
        "provenance",
    );
    if (fields.kind !== SYNTHESIZED_KIND) {
        throw new TypeError("provenance kind is not configured");
    }
    assertRecordId(fields.source_record_id, "provenance.source_record_id");
    assertScopeText(fields.source_run_id, "provenance.source_run_id");
    return Object.freeze({
        kind: SYNTHESIZED_KIND,
        source_record_id: fields.source_record_id,
        source_run_id: fields.source_run_id,
    });
}

function readPredecessor(value: unknown): ChildRunPredecessorInspection | null {
    if (value === null) {
        return null;
    }
    const fields = readScopeDataObject(
        value,
        ["cut_id", "decision_record_id", "handle_id"],
        "predecessor",
    );
    assertPrefixedDigest(fields.cut_id, config.identity.retryCutIdPrefix, "predecessor.cut_id");
    assertRecordId(fields.decision_record_id, "predecessor.decision_record_id");
    assertPrefixedDigest(fields.handle_id, config.identity.handleIdPrefix, "predecessor.handle_id");
    return Object.freeze({
        cut_id: fields.cut_id as string,
        decision_record_id: fields.decision_record_id,
        handle_id: fields.handle_id as string,
    });
}

function readParent(value: unknown): ChildRunParentInspection {
    const kind = (value as { readonly kind?: unknown } | null)?.kind;
    if (kind === ROOT_KIND) {
        readScopeDataObject(value, ["kind"], "parent");
        return Object.freeze({ kind: ROOT_KIND });
    }
    const fields = readScopeDataObject(
        value,
        ["handle_id", "kind", "origin_cut_id", "origin_record_id"],
        "parent",
    );
    assertPrefixedDigest(fields.handle_id, config.identity.handleIdPrefix, "parent.handle_id");
    assertPrefixedDigest(
        fields.origin_cut_id,
        config.identity.originCutIdPrefix,
        "parent.origin_cut_id",
    );
    assertRecordId(fields.origin_record_id, "parent.origin_record_id");
    if (fields.kind !== HANDLE_KIND) {
        throw new TypeError("parent kind is not configured");
    }
    return Object.freeze({
        handle_id: fields.handle_id as string,
        kind: HANDLE_KIND,
        origin_cut_id: fields.origin_cut_id as string,
        origin_record_id: fields.origin_record_id,
    });
}

function decode<T>(subject: string, read: () => T): T {
    try {
        return read();
    } catch (error) {
        throw new DelegationEvidenceError(`${subject} evidence is malformed`, { cause: error });
    }
}

function readVersionedBody(body: RecordBody, keys: readonly string[]): Record<string, unknown> {
    const fields = readScopeDataObject(
        body,
        ["compatibility_version", "delegation_version", ...keys],
        "delegation record",
    );
    if (
        fields.compatibility_version !== config.compatibilityVersion ||
        fields.delegation_version !== config.recordVersion
    ) {
        throw new TypeError("delegation record version is unsupported");
    }
    return fields;
}

function prefixed(prefix: string, value: SemanticRecord): string {
    return `${prefix}${createRecordId(value).slice(recordIdConfig.prefix.length)}`;
}
