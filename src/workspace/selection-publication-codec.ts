import { createHash } from "node:crypto";

import { canonicalizeRecord, type SemanticRecord } from "../canonical/canonical-record.ts";
import { workspaceProtocolConfig } from "../protocol/config.ts";
import {
    RETAINED_WORLD_SELECTION_ATOMICITY_KINDS,
    RETAINED_WORLD_SELECTION_PLAN_VERSION,
    RETAINED_WORLD_SELECTION_RECEIPT_VERSION,
    RETAINED_WORLD_SELECTION_SCHEDULE_KINDS,
    RETAINED_WORLD_SELECTION_SCHEDULE_VERSION,
    RETAINED_WORLD_SELECTION_SCHEDULED_RECEIPT_VERSION,
    RETAINED_WORLD_SELECTION_SCHEDULED_STEP_VERSION,
    RETAINED_WORLD_SELECTION_STEP_STATUSES,
    RETAINED_WORLD_SELECTION_STEP_VERSION,
    RETAINED_WORLD_SETTLEMENT_ACTIONS,
    WORLD_ENTRY_KINDS,
} from "../protocol/values.generated.ts";
import type { RetainedWorldSettlementOperationEncoding } from "../store/retained-world-settlement-codec.ts";
import { isCanonicalWorldPath, worldChangeOperationOf } from "./changesets.ts";
import type { WorldChangeNode, WorldChangeset, WorldPathChange } from "./types.ts";

const [SELECT_ACTION, , APPLY_ACTION] = RETAINED_WORLD_SETTLEMENT_ACTIONS;
const [JOURNALED_PATH_SET] = RETAINED_WORLD_SELECTION_ATOMICITY_KINDS;
const [APPLIED_STATUS] = RETAINED_WORLD_SELECTION_STEP_STATUSES;
const [DEPENDENCY_ORDERED_PATH_SET] = RETAINED_WORLD_SELECTION_SCHEDULE_KINDS;

type SelectionPublicationPlan = Readonly<{
    action: typeof SELECT_ACTION | typeof APPLY_ACTION;
    atomicity: typeof JOURNALED_PATH_SET;
    base_content_id: string;
    base_revision_id: string;
    binding_id: string;
    capture_record_id: string;
    changes: readonly WorldPathChange[];
    changeset_id: string;
    command_id: string;
    custody_id: string;
    descriptor_format: string;
    execution_cut_id: string;
    head_content_id: string;
    head_revision_id: string;
    operation_id: string;
    output_id: string;
    plan_version: typeof RETAINED_WORLD_SELECTION_PLAN_VERSION;
    request_id: string;
    run_id: string;
    settlement_version: number;
    staging_id: string;
    user_basis_before: string;
}>;

type SelectionPublicationStep = Readonly<{
    change: WorldPathChange;
    ordinal: number;
    plan_id: string;
    previous_step_id: string | null;
    status: typeof APPLIED_STATUS;
    step_version: typeof RETAINED_WORLD_SELECTION_STEP_VERSION;
}>;

type SelectionPublicationReceipt = Readonly<{
    atomicity: typeof JOURNALED_PATH_SET;
    final_step_id: string | null;
    head_content_id: string;
    operation_id: string;
    plan_id: string;
    publication_version: typeof RETAINED_WORLD_SELECTION_RECEIPT_VERSION;
    staging_id: string;
    user_basis_after: string;
    user_basis_before: string;
}>;

type SelectionPublicationSchedule = Readonly<{
    change_ordinals: readonly number[];
    plan_id: string;
    schedule_kind: typeof DEPENDENCY_ORDERED_PATH_SET;
    schedule_version: typeof RETAINED_WORLD_SELECTION_SCHEDULE_VERSION;
}>;

type ScheduledSelectionPublicationStep = Readonly<{
    change: WorldPathChange;
    change_ordinal: number;
    operation_ordinal: number;
    plan_id: string;
    previous_step_id: string | null;
    schedule_id: string;
    status: typeof APPLIED_STATUS;
    step_version: typeof RETAINED_WORLD_SELECTION_SCHEDULED_STEP_VERSION;
}>;

type ScheduledSelectionPublicationReceipt = Readonly<{
    atomicity: typeof JOURNALED_PATH_SET;
    final_step_id: string | null;
    head_content_id: string;
    operation_id: string;
    plan_id: string;
    publication_version: typeof RETAINED_WORLD_SELECTION_SCHEDULED_RECEIPT_VERSION;
    schedule_id: string;
    staging_id: string;
    user_basis_after: string;
    user_basis_before: string;
}>;

/** @internal Canonical selection-publication plan retained before user-path mutation. */
export type SelectionPublicationPlanEncoding = Readonly<{
    digest: string;
    id: string;
    json: string;
    staging_id: string;
    value: SelectionPublicationPlan;
}>;

/** @internal Canonical ordered path-effect receipt retained during publication. */
export type SelectionPublicationStepEncoding = Readonly<{
    digest: string;
    id: string;
    json: string;
    value: SelectionPublicationStep;
}>;

/** @internal Canonical terminal carrier receipt retained before selected settlement authority. */
export type SelectionPublicationReceiptEncoding = Readonly<{
    digest: string;
    id: string;
    json: string;
    value: SelectionPublicationReceipt;
}>;

/** @internal Canonical dependency-ordered schedule over one immutable selection plan. */
export type SelectionPublicationScheduleEncoding = Readonly<{
    digest: string;
    id: string;
    json: string;
    value: SelectionPublicationSchedule;
}>;

/** @internal Canonical dependency-scheduled path-effect receipt retained during publication. */
export type ScheduledSelectionPublicationStepEncoding = Readonly<{
    digest: string;
    id: string;
    json: string;
    value: ScheduledSelectionPublicationStep;
}>;

/** @internal Canonical dependency-scheduled terminal receipt retained after publication. */
export type ScheduledSelectionPublicationReceiptEncoding = Readonly<{
    digest: string;
    id: string;
    json: string;
    value: ScheduledSelectionPublicationReceipt;
}>;

/** @internal Encodes one exact selection plan from authenticated operation and changeset evidence. */
export function encodeSelectionPublicationPlan(
    operation: RetainedWorldSettlementOperationEncoding,
    changeset: WorldChangeset,
    baseContentId: string,
    headContentId: string,
): SelectionPublicationPlanEncoding {
    const request = operation.value.request;
    if (
        (operation.value.action !== SELECT_ACTION && operation.value.action !== APPLY_ACTION) ||
        request.action !== operation.value.action
    ) {
        throw new TypeError("selection publication requires an exact publishing operation");
    }
    const applicationPlan =
        operation.value.action === APPLY_ACTION ? operation.value.application_plan : null;
    const expected = {
        baseContentId: applicationPlan?.current_content_id ?? request.user_basis_before,
        baseRevisionId: applicationPlan?.current_revision_id ?? request.base_revision_id,
        changesetId: applicationPlan?.publication_changeset_id ?? request.changeset_id,
        custodyId: applicationPlan?.application_custody_id ?? request.custody_id,
        headContentId: applicationPlan?.merged_content_id ?? headContentId,
        headRevisionId: applicationPlan?.merged_revision_id ?? request.head_revision_id,
    };
    assertText(baseContentId, "base_content_id");
    assertText(headContentId, "head_content_id");
    if (baseContentId !== expected.baseContentId || headContentId !== expected.headContentId) {
        throw new TypeError("selection publication base content is inconsistent");
    }
    const changes = readChangeset(changeset, {
        baseRevisionId: expected.baseRevisionId,
        bindingId: request.binding_id,
        changesetId: expected.changesetId,
        headRevisionId: expected.headRevisionId,
    });
    const stagingId = digestId(workspaceProtocolConfig.selectionPublication.stagingIdPrefix, {
        binding_id: request.binding_id,
        changeset_id: expected.changesetId,
        head_content_id: expected.headContentId,
        head_revision_id: expected.headRevisionId,
        operation_id: operation.id,
    });
    const value = Object.freeze({
        action: operation.value.action,
        atomicity: JOURNALED_PATH_SET,
        base_content_id: expected.baseContentId,
        base_revision_id: expected.baseRevisionId,
        binding_id: request.binding_id,
        capture_record_id: request.capture_record_id,
        changes,
        changeset_id: expected.changesetId,
        command_id: request.command_id,
        custody_id: expected.custodyId,
        descriptor_format: workspaceProtocolConfig.selectionPublication.descriptorFormat,
        execution_cut_id: request.execution_cut_id,
        head_content_id: expected.headContentId,
        head_revision_id: expected.headRevisionId,
        operation_id: operation.id,
        output_id: request.output_id,
        plan_version: RETAINED_WORLD_SELECTION_PLAN_VERSION,
        request_id: operation.value.request_id,
        run_id: request.run_id,
        settlement_version: request.settlement_version,
        staging_id: stagingId,
        user_basis_before: expected.baseContentId,
    }) satisfies SelectionPublicationPlan;
    return Object.freeze({
        ...encodeValue(value, workspaceProtocolConfig.selectionPublication.planIdPrefix),
        staging_id: stagingId,
    });
}

/** @internal Decodes only the canonical plan for the exact authenticated inputs. */
export function decodeSelectionPublicationPlan(
    json: string,
    operation: RetainedWorldSettlementOperationEncoding,
    changeset: WorldChangeset,
    baseContentId: string,
    headContentId: string,
): SelectionPublicationPlanEncoding {
    const expected = encodeSelectionPublicationPlan(
        operation,
        changeset,
        baseContentId,
        headContentId,
    );
    if (json !== expected.json) throw new TypeError("selection publication plan is invalid");
    return expected;
}

/** @internal Encodes a deterministic directory-safe application schedule over canonical changes. */
export function encodeSelectionPublicationSchedule(
    plan: SelectionPublicationPlanEncoding,
): SelectionPublicationScheduleEncoding {
    const value = Object.freeze({
        change_ordinals: dependencyOrderedOrdinals(plan.value.changes),
        plan_id: plan.id,
        schedule_kind: DEPENDENCY_ORDERED_PATH_SET,
        schedule_version: RETAINED_WORLD_SELECTION_SCHEDULE_VERSION,
    }) satisfies SelectionPublicationSchedule;
    return encodeValue(
        value,
        workspaceProtocolConfig.selectionPublication.scheduleIdPrefix,
        workspaceProtocolConfig.selectionPublication.maxScheduleBytes,
    );
}

/** @internal Decodes only the canonical dependency schedule for one exact plan. */
export function decodeSelectionPublicationSchedule(
    json: string,
    plan: SelectionPublicationPlanEncoding,
): SelectionPublicationScheduleEncoding {
    const expected = encodeSelectionPublicationSchedule(plan);
    if (json !== expected.json) throw new TypeError("selection publication schedule is invalid");
    return expected;
}

/** @internal Encodes the next exact dependency-scheduled path-effect receipt. */
export function encodeScheduledSelectionPublicationStep(
    plan: SelectionPublicationPlanEncoding,
    schedule: SelectionPublicationScheduleEncoding,
    previous: ScheduledSelectionPublicationStepEncoding | null,
): ScheduledSelectionPublicationStepEncoding {
    const canonicalSchedule = decodeSelectionPublicationSchedule(schedule.json, plan);
    if (schedule.id !== canonicalSchedule.id || schedule.digest !== canonicalSchedule.digest) {
        throw new TypeError("scheduled selection publication prefix is inconsistent");
    }
    if (previous !== null) assertScheduledStep(plan, canonicalSchedule, previous);
    const operationOrdinal = previous === null ? 0 : previous.value.operation_ordinal + 1;
    const changeOrdinal = canonicalSchedule.value.change_ordinals[operationOrdinal];
    if (changeOrdinal === undefined) {
        throw new TypeError("scheduled selection publication has no next step");
    }
    const change = plan.value.changes[changeOrdinal] as WorldPathChange;
    const value = Object.freeze({
        change,
        change_ordinal: changeOrdinal,
        operation_ordinal: operationOrdinal,
        plan_id: plan.id,
        previous_step_id: previous?.id ?? null,
        schedule_id: canonicalSchedule.id,
        status: APPLIED_STATUS,
        step_version: RETAINED_WORLD_SELECTION_SCHEDULED_STEP_VERSION,
    }) satisfies ScheduledSelectionPublicationStep;
    return encodeValue(
        value,
        workspaceProtocolConfig.selectionPublication.scheduledStepIdPrefix,
        workspaceProtocolConfig.selectionPublication.maxStepBytes,
    );
}

/** @internal Decodes only the canonical next dependency-scheduled step for one exact prefix. */
export function decodeScheduledSelectionPublicationStep(
    json: string,
    plan: SelectionPublicationPlanEncoding,
    schedule: SelectionPublicationScheduleEncoding,
    previous: ScheduledSelectionPublicationStepEncoding | null,
): ScheduledSelectionPublicationStepEncoding {
    const expected = encodeScheduledSelectionPublicationStep(plan, schedule, previous);
    if (json !== expected.json) {
        throw new TypeError("scheduled selection publication step is invalid");
    }
    return expected;
}

/** @internal Encodes terminal evidence for one complete dependency-scheduled step chain. */
export function encodeScheduledSelectionPublicationReceipt(
    plan: SelectionPublicationPlanEncoding,
    schedule: SelectionPublicationScheduleEncoding,
    finalStep: ScheduledSelectionPublicationStepEncoding | null,
    userBasisAfter: string,
): ScheduledSelectionPublicationReceiptEncoding {
    assertText(userBasisAfter, "user_basis_after");
    const canonicalSchedule = decodeSelectionPublicationSchedule(schedule.json, plan);
    if (schedule.id !== canonicalSchedule.id || schedule.digest !== canonicalSchedule.digest) {
        throw new TypeError("scheduled selection publication schedule is inconsistent");
    }
    if (finalStep !== null) assertScheduledStep(plan, canonicalSchedule, finalStep);
    const expectedFinalOrdinal = canonicalSchedule.value.change_ordinals.length - 1;
    if (
        (expectedFinalOrdinal < 0 && finalStep !== null) ||
        (expectedFinalOrdinal >= 0 &&
            (finalStep === null ||
                finalStep.value.plan_id !== plan.id ||
                finalStep.value.schedule_id !== canonicalSchedule.id ||
                finalStep.value.status !== APPLIED_STATUS ||
                finalStep.value.operation_ordinal !== expectedFinalOrdinal ||
                finalStep.value.change_ordinal !==
                    canonicalSchedule.value.change_ordinals[expectedFinalOrdinal]))
    ) {
        throw new TypeError("scheduled selection publication step chain is incomplete");
    }
    const value = Object.freeze({
        atomicity: JOURNALED_PATH_SET,
        final_step_id: finalStep?.id ?? null,
        head_content_id: plan.value.head_content_id,
        operation_id: plan.value.operation_id,
        plan_id: plan.id,
        publication_version: RETAINED_WORLD_SELECTION_SCHEDULED_RECEIPT_VERSION,
        schedule_id: canonicalSchedule.id,
        staging_id: plan.staging_id,
        user_basis_after: userBasisAfter,
        user_basis_before: plan.value.user_basis_before,
    }) satisfies ScheduledSelectionPublicationReceipt;
    return encodeValue(
        value,
        workspaceProtocolConfig.selectionPublication.scheduledPublicationIdPrefix,
        workspaceProtocolConfig.selectionPublication.maxReceiptBytes,
    );
}

/** @internal Decodes only the canonical terminal receipt for one completed schedule. */
export function decodeScheduledSelectionPublicationReceipt(
    json: string,
    plan: SelectionPublicationPlanEncoding,
    schedule: SelectionPublicationScheduleEncoding,
    finalStep: ScheduledSelectionPublicationStepEncoding | null,
    userBasisAfter: string,
): ScheduledSelectionPublicationReceiptEncoding {
    const expected = encodeScheduledSelectionPublicationReceipt(
        plan,
        schedule,
        finalStep,
        userBasisAfter,
    );
    if (json !== expected.json) {
        throw new TypeError("scheduled selection publication receipt is invalid");
    }
    return expected;
}

function assertScheduledStep(
    plan: SelectionPublicationPlanEncoding,
    schedule: SelectionPublicationScheduleEncoding,
    step: ScheduledSelectionPublicationStepEncoding,
): void {
    const operationOrdinal = step.value.operation_ordinal;
    const changeOrdinal = schedule.value.change_ordinals[operationOrdinal];
    const change = changeOrdinal === undefined ? undefined : plan.value.changes[changeOrdinal];
    let canonical: ReturnType<typeof encodeValue>;
    try {
        canonical = encodeValue(
            step.value,
            workspaceProtocolConfig.selectionPublication.scheduledStepIdPrefix,
            workspaceProtocolConfig.selectionPublication.maxStepBytes,
        );
    } catch {
        throw new TypeError("scheduled selection publication step prefix is invalid");
    }
    if (
        !Number.isSafeInteger(operationOrdinal) ||
        operationOrdinal < 0 ||
        change === undefined ||
        step.value.change_ordinal !== changeOrdinal ||
        canonicalizeRecord(step.value.change as unknown as SemanticRecord) !==
            canonicalizeRecord(change as unknown as SemanticRecord) ||
        step.value.plan_id !== plan.id ||
        step.value.schedule_id !== schedule.id ||
        step.value.status !== APPLIED_STATUS ||
        step.value.step_version !== RETAINED_WORLD_SELECTION_SCHEDULED_STEP_VERSION ||
        step.id !== canonical.id ||
        step.digest !== canonical.digest ||
        step.json !== canonical.json
    ) {
        throw new TypeError("scheduled selection publication step prefix is invalid");
    }
}

/** @internal Encodes the next exact ordered path-effect receipt for one plan. */
export function encodeSelectionPublicationStep(
    plan: SelectionPublicationPlanEncoding,
    previous: SelectionPublicationStepEncoding | null,
): SelectionPublicationStepEncoding {
    const ordinal = previous === null ? 0 : previous.value.ordinal + 1;
    if (
        previous !== null &&
        (previous.value.plan_id !== plan.id || previous.value.status !== APPLIED_STATUS)
    ) {
        throw new TypeError("selection publication step prefix is inconsistent");
    }
    const change = plan.value.changes[ordinal];
    if (change === undefined) throw new TypeError("selection publication has no next step");
    const value = Object.freeze({
        change,
        ordinal,
        plan_id: plan.id,
        previous_step_id: previous?.id ?? null,
        status: APPLIED_STATUS,
        step_version: RETAINED_WORLD_SELECTION_STEP_VERSION,
    }) satisfies SelectionPublicationStep;
    return encodeValue(
        value,
        workspaceProtocolConfig.selectionPublication.stepIdPrefix,
        workspaceProtocolConfig.selectionPublication.maxStepBytes,
    );
}

/** @internal Decodes only the canonical next step for one exact plan prefix. */
export function decodeSelectionPublicationStep(
    json: string,
    plan: SelectionPublicationPlanEncoding,
    previous: SelectionPublicationStepEncoding | null,
): SelectionPublicationStepEncoding {
    const expected = encodeSelectionPublicationStep(plan, previous);
    if (json !== expected.json) throw new TypeError("selection publication step is invalid");
    return expected;
}

/** @internal Encodes terminal publication evidence for one complete ordered step chain. */
export function encodeSelectionPublicationReceipt(
    plan: SelectionPublicationPlanEncoding,
    finalStep: SelectionPublicationStepEncoding | null,
    userBasisAfter: string,
): SelectionPublicationReceiptEncoding {
    assertText(userBasisAfter, "user_basis_after");
    const expectedFinalOrdinal = plan.value.changes.length - 1;
    if (
        (expectedFinalOrdinal < 0 && finalStep !== null) ||
        (expectedFinalOrdinal >= 0 &&
            (finalStep === null ||
                finalStep.value.plan_id !== plan.id ||
                finalStep.value.ordinal !== expectedFinalOrdinal))
    ) {
        throw new TypeError("selection publication step chain is incomplete");
    }
    const value = Object.freeze({
        atomicity: JOURNALED_PATH_SET,
        final_step_id: finalStep?.id ?? null,
        head_content_id: plan.value.head_content_id,
        operation_id: plan.value.operation_id,
        plan_id: plan.id,
        publication_version: RETAINED_WORLD_SELECTION_RECEIPT_VERSION,
        staging_id: plan.staging_id,
        user_basis_after: userBasisAfter,
        user_basis_before: plan.value.user_basis_before,
    }) satisfies SelectionPublicationReceipt;
    return encodeValue(
        value,
        workspaceProtocolConfig.selectionPublication.publicationIdPrefix,
        workspaceProtocolConfig.selectionPublication.maxReceiptBytes,
    );
}

/** @internal Decodes only the canonical terminal receipt for one exact completed plan. */
export function decodeSelectionPublicationReceipt(
    json: string,
    plan: SelectionPublicationPlanEncoding,
    finalStep: SelectionPublicationStepEncoding | null,
    userBasisAfter: string,
): SelectionPublicationReceiptEncoding {
    const expected = encodeSelectionPublicationReceipt(plan, finalStep, userBasisAfter);
    if (json !== expected.json) throw new TypeError("selection publication receipt is invalid");
    return expected;
}

function readChangeset(
    value: WorldChangeset,
    expected: Readonly<{
        baseRevisionId: string;
        bindingId: string;
        changesetId: string;
        headRevisionId: string;
    }>,
): readonly WorldPathChange[] {
    const fields = exactObject(value, [
        "base_revision_id",
        "binding_id",
        "changed_paths",
        "changes",
        "changeset_id",
        "head_revision_id",
        "schema_version",
    ]);
    if (
        fields.base_revision_id !== expected.baseRevisionId ||
        fields.binding_id !== expected.bindingId ||
        fields.changeset_id !== expected.changesetId ||
        fields.head_revision_id !== expected.headRevisionId ||
        fields.schema_version !== workspaceProtocolConfig.changesets.version ||
        !Array.isArray(fields.changes) ||
        !Array.isArray(fields.changed_paths) ||
        fields.changes.length > workspaceProtocolConfig.selectionPublication.maxSteps ||
        Object.keys(fields.changes).length !== fields.changes.length ||
        Object.keys(fields.changed_paths).length !== fields.changed_paths.length
    ) {
        throw new TypeError("selection publication changeset is inconsistent");
    }
    const changes = Object.freeze(fields.changes.map(readChange));
    const referencedBytes = changes.reduce(
        (total, change) =>
            total + referencedBytesOf(change.before) + referencedBytesOf(change.after),
        0,
    );
    if (referencedBytes > workspaceProtocolConfig.changesets.maxAggregateReferencedBytes) {
        throw new TypeError("selection publication changeset exceeds referenced-byte limits");
    }
    const changedPaths = fields.changed_paths.map((path) => {
        assertText(path, "changed_path");
        return path;
    });
    if (
        changedPaths.length !== changes.length ||
        changedPaths.some((path, index) => path !== changes[index]?.path) ||
        changes.some(
            (change, index) =>
                index > 0 &&
                Buffer.from((changes[index - 1] as WorldPathChange).path).compare(
                    Buffer.from(change.path),
                ) >= 0,
        )
    ) {
        throw new TypeError("selection publication changed paths are inconsistent");
    }
    const semantic = {
        base_revision_id: expected.baseRevisionId,
        binding_id: expected.bindingId,
        changes: changes as unknown as SemanticRecord["changes"],
        head_revision_id: expected.headRevisionId,
        schema_version: workspaceProtocolConfig.changesets.version,
    };
    if (digestId(workspaceProtocolConfig.changesets.idPrefix, semantic) !== expected.changesetId) {
        throw new TypeError("selection publication changeset identity is invalid");
    }
    return changes;
}

type ScheduleNode = {
    readonly children: ScheduleNode[];
    readonly ordinal: number;
};

function dependencyOrderedOrdinals(changes: readonly WorldPathChange[]): readonly number[] {
    const roots: ScheduleNode[] = [];
    const nodesByPath = new Map<string, ScheduleNode>();
    for (const [ordinal, change] of changes.entries()) {
        let parent: ScheduleNode | undefined;
        let separator = change.path.lastIndexOf("/");
        while (separator >= 0 && parent === undefined) {
            parent = nodesByPath.get(change.path.slice(0, separator));
            separator = change.path.lastIndexOf("/", separator - 1);
        }
        const node: ScheduleNode = { children: [], ordinal };
        (parent?.children ?? roots).push(node);
        nodesByPath.set(change.path, node);
    }

    const ordinals: number[] = [];
    const pending: Array<Readonly<{ emit: boolean; node: ScheduleNode }>> = [...roots]
        .reverse()
        .map((node) => ({ emit: false, node }));
    while (pending.length > 0) {
        const item = pending.pop() as Readonly<{ emit: boolean; node: ScheduleNode }>;
        if (item.emit) {
            ordinals.push(item.node.ordinal);
            continue;
        }
        const change = changes[item.node.ordinal] as WorldPathChange;
        const descendantsFirst =
            change.before?.kind === WORLD_ENTRY_KINDS[0] &&
            change.after?.kind !== WORLD_ENTRY_KINDS[0];
        if (!descendantsFirst) ordinals.push(item.node.ordinal);
        if (descendantsFirst) pending.push({ emit: true, node: item.node });
        for (const child of [...item.node.children].reverse()) {
            pending.push({ emit: false, node: child });
        }
    }
    return Object.freeze(ordinals);
}

/** Returns candidate changes in deterministic directory-safe publication order. @internal */
export function orderWorldPathChangesForPublication(
    changes: readonly WorldPathChange[],
): readonly WorldPathChange[] {
    return Object.freeze(
        dependencyOrderedOrdinals(changes).map((ordinal) => {
            const change = changes[ordinal];
            // dependencyOrderedOrdinals derives every ordinal from this exact dense array.
            /* node:coverage ignore next 3 */
            if (change === undefined) {
                throw new TypeError("publication schedule references an absent change");
            }
            return change;
        }),
    );
}

function readChange(value: unknown): WorldPathChange {
    const fields = exactObject(value, ["after", "before", "operation", "path"]);
    assertText(fields.path, "path");
    if (
        !isCanonicalWorldPath(fields.path) ||
        Buffer.byteLength(fields.path) > workspaceProtocolConfig.changesets.maxPathBytes
    ) {
        throw new TypeError("selection publication path is invalid");
    }
    const before = fields.before === null ? null : readNode(fields.before);
    const after = fields.after === null ? null : readNode(fields.after);
    if (
        (before === null && after === null) ||
        fields.operation !== worldChangeOperationOf(before, after)
    ) {
        throw new TypeError("selection publication change is invalid");
    }
    return Object.freeze({
        after,
        before,
        operation: fields.operation,
        path: fields.path,
    }) as WorldPathChange;
}

function readNode(value: unknown): WorldChangeNode {
    const snapshot = snapshotObject(value);
    const kind = snapshot.kind;
    if (kind === WORLD_ENTRY_KINDS[0]) {
        const fields = exactObject(snapshot, ["kind", "mode"]);
        assertMode(fields.mode);
        return Object.freeze({ kind, mode: fields.mode });
    }
    if (kind === WORLD_ENTRY_KINDS[1]) {
        const fields = exactObject(snapshot, ["byte_length", "content_id", "kind", "mode"]);
        assertMode(fields.mode);
        assertText(fields.content_id, "content_id");
        if (!validDigest(fields.content_id, workspaceProtocolConfig.carrier.blobIdPrefix)) {
            throw new TypeError("selection publication content identity is invalid");
        }
        if (!Number.isSafeInteger(fields.byte_length) || Number(fields.byte_length) < 0) {
            throw new TypeError("selection publication file length is invalid");
        }
        if (Number(fields.byte_length) > workspaceProtocolConfig.changesets.maxSingleBlobBytes) {
            throw new TypeError("selection publication file exceeds byte limits");
        }
        return Object.freeze({
            byte_length: fields.byte_length,
            content_id: fields.content_id,
            kind,
            mode: fields.mode,
        }) as WorldChangeNode;
    }
    if (kind === WORLD_ENTRY_KINDS[2]) {
        const fields = exactObject(snapshot, ["kind", "mode", "target"]);
        if (
            fields.mode !== null ||
            typeof fields.target !== "string" ||
            Buffer.byteLength(String(fields.target)) >
                workspaceProtocolConfig.changesets.maxSymlinkTargetBytes
        ) {
            throw new TypeError("selection publication symlink is invalid");
        }
        return Object.freeze({ kind, mode: null, target: fields.target });
    }
    throw new TypeError("selection publication node kind is invalid");
}

function exactObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
    const snapshot = snapshotObject(value);
    const ownKeys = Object.keys(snapshot);
    const expected = [...keys].sort();
    if (
        ownKeys.length !== expected.length ||
        ownKeys.sort().some((key, index) => key !== expected[index])
    ) {
        throw new TypeError("selection publication evidence must be exact data");
    }
    return Object.fromEntries(keys.map((key) => [key, snapshot[key]]));
}

function snapshotObject(value: unknown): Record<string, unknown> {
    if (
        value === null ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    ) {
        throw new TypeError("selection publication evidence must be exact data");
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const ownKeys = Reflect.ownKeys(descriptors);
    if (
        ownKeys.some((key) => typeof key !== "string") ||
        (ownKeys as string[]).some((key) => !("value" in (descriptors[key] as PropertyDescriptor)))
    ) {
        throw new TypeError("selection publication evidence must be exact data");
    }
    return Object.fromEntries(
        (ownKeys as string[]).map((key) => [key, (descriptors[key] as PropertyDescriptor).value]),
    );
}

function assertMode(value: unknown): asserts value is number {
    if (!Number.isSafeInteger(value) || Number(value) < 0) {
        throw new TypeError("selection publication mode is invalid");
    }
}

function assertText(value: unknown, field: string): asserts value is string {
    if (typeof value !== "string" || value.length === 0) {
        throw new TypeError(`selection publication ${field} is invalid`);
    }
}

function validDigest(value: string, prefix: string): boolean {
    return (
        value.startsWith(prefix) &&
        value.length === prefix.length + workspaceProtocolConfig.hexLength &&
        /^[0-9a-f]+$/u.test(value.slice(prefix.length))
    );
}

function encodeValue<T extends Readonly<Record<string, unknown>>>(
    value: T,
    prefix: string,
    maxBytes = workspaceProtocolConfig.selectionPublication.maxPlanBytes,
): Readonly<{ digest: string; id: string; json: string; value: T }> {
    const json = canonicalizeRecord(value as SemanticRecord);
    if (Buffer.byteLength(json) > maxBytes) {
        throw new TypeError("selection publication evidence exceeds configured byte limits");
    }
    const digest = digestText(json);
    return Object.freeze({ digest, id: `${prefix}${digest}`, json, value });
}

function referencedBytesOf(node: WorldChangeNode | null): number {
    return node?.kind === WORLD_ENTRY_KINDS[1] ? node.byte_length : 0;
}

function digestId(prefix: string, value: SemanticRecord): string {
    return `${prefix}${digestText(canonicalizeRecord(value))}`;
}

function digestText(value: string): string {
    return createHash(workspaceProtocolConfig.digestAlgorithm).update(value).digest("hex");
}
