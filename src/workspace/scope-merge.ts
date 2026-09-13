import { scopeProtocolConfig } from "../protocol/config.ts";
import {
    RECORD_MODES,
    SCOPE_AUTHORITY_ATOMS,
    SCOPE_COMMAND_KINDS,
    SCOPE_MERGE_PHASES,
} from "../protocol/values.generated.ts";
import { assertRecordId } from "../record/guards.ts";
import { ROOT_WITNESS_ID } from "../record/root-witness.ts";
import type { RecordBody, RecordId } from "../record/types.ts";
import {
    ScopeAuthorityError,
    ScopeEvidenceError,
    ScopeHeadConflictError,
    ScopeMergeConflictError,
} from "../scope/errors.ts";
import { inspectScope } from "../scope/inspection.ts";
import { createScopeCommandAppendIntentId } from "../scope/records.ts";
import { readScopeCommandReceipt } from "../scope/replay.ts";
import {
    createScopeChildMergedBody,
    createScopeMergeAppendIntentId,
    createScopeMergeCompletedBody,
    createScopeMergeCutId,
    createScopeMergePreparedBody,
    readScopeMergeRecord,
    scopeContributionKey,
} from "../scope/terminal-records.ts";
import type {
    ScopeInspection,
    ScopeMergePreparedRecord,
    ScopeMergeReceipt,
    ScopeMergeWorldPlan,
} from "../scope/types.ts";
import { assertScopeText, readNowMilliseconds, readScopeDataObject } from "../scope/validation.ts";
import { assertScopeWriter } from "../scope/writer.ts";
import { AppendIntentConflictError } from "../store/errors.ts";
import type { SQLiteTraceStore } from "../store/sqlite-trace-store.ts";
import { createVerifiedWorldChangeset } from "./changesets.ts";
import {
    assertReferenceCopyCarrier,
    createReferenceCopyApplicationRevision,
    discardReferenceCopyCustodyIdentity,
    publishReferenceCopyCustodyChangeset,
} from "./reference-copy-carrier.ts";
import { inspectRetainedWorldApplicationConflicts } from "./retained-world-application.ts";
import type { MergeScopeOptions } from "./scope-terminal-types.ts";
import type { ReferenceCopyCarrier } from "./types.ts";

const [CAPTURE_MODE] = RECORD_MODES;
const [, WRITE_ATOM] = SCOPE_AUTHORITY_ATOMS;
const [MERGE_PREPARED_PHASE, MERGE_COMPLETED_PHASE] = SCOPE_MERGE_PHASES;
const [, , , , MERGE_COMMAND] = SCOPE_COMMAND_KINDS;

/**
 * Durably merges one quiescent child scope into its owning parent exactly once.
 *
 * Admission requires the parent and child writers, both exact current heads, exact ownership, a
 * complete child fork, and only terminal grandchildren. For a reference-copy child the merge
 * derives an exact three-way plan from the common origin, the captured child world, and the
 * captured current parent world: overlapping changed paths fail with
 * {@link ScopeMergeConflictError} before anything is retained, so neither scope is consumed.
 * Disjoint changes build an immutable merged revision in protected carrier custody.
 *
 * One transaction then publishes the fixed child cut and a reservation citing the plan and the
 * child's selected-history contributions not already selected by the parent. The reservation is
 * the single terminal winner: competing merges, a later discard, child writers, and parent
 * mutation are refused until completion. Publication applies only the planned changes to the
 * parent-managed custody under the rechecked parent head and fence, converging from any prefix,
 * and the merge completes only once the parent custody verifies as the merged content. The
 * completion appends a parent-side integration and a child seal in one transaction. User
 * workspaces are never written; publication to them remains retained settlement.
 *
 * Retrying the same command converges from retained evidence; a completed merge returns its
 * original receipt. A parent custody found in a third state is unknown physical state and stays
 * blocked.
 *
 * @param store - Open writable trace store holding both registrations.
 * @param options - Parent and child writers, both exact heads, command, and optional carrier.
 * @returns Frozen completed merge receipt.
 * @throws {ScopeMergeConflictError} If child and current-parent changes overlap.
 * @throws {ScopeTerminalConflictError} If either scope is not open or the child retains another
 * terminal decision.
 * @throws {ScopeQuiescenceError} If a grandchild is unresolved or another merge into the parent
 * is in flight.
 * @throws {ScopeAuthorityError} If the parent cannot write the child's bound resource.
 * @throws {ScopeWriterFencedError} If a writer fence is released, expired, or superseded.
 * @throws {ScopeHeadConflictError} If an expected head is not current.
 * @throws {ScopeEvidenceError} If ownership, worlds, or retained evidence are inconsistent.
 * @throws {AppendIntentConflictError} If the command identity already names different content.
 * @throws {WorldCarrierError} If carrier evidence is unavailable, corrupt, or in a third state.
 * @throws {TraceStoreError} If the store is closed.
 * @throws {TypeError} If a handle is forged, a required carrier is absent, or options are malformed.
 *
 * @example
 * ```ts
 * const merged = await mergeScope(store, {
 *     carrier,
 *     child: childWriter,
 *     commandId: "scope-command:merge:1",
 *     expectedChildHeadRecordId: inspectScope(store, child.scope_id)?.head.record_id,
 *     expectedParentHeadRecordId: inspectScope(store, parent.scope_id)?.head.record_id,
 *     parent: parentWriter,
 * });
 * ```
 *
 * @public
 */
export async function mergeScope(
    store: SQLiteTraceStore,
    options: MergeScopeOptions,
): Promise<ScopeMergeReceipt> {
    const fields = readScopeDataObject(
        options,
        ["child", "commandId", "expectedChildHeadRecordId", "expectedParentHeadRecordId", "parent"],
        "mergeScope options",
        ["carrier", "nowMilliseconds"],
    );
    assertScopeText(fields.commandId, "commandId");
    assertRecordId(fields.expectedChildHeadRecordId, "expectedChildHeadRecordId");
    assertRecordId(fields.expectedParentHeadRecordId, "expectedParentHeadRecordId");
    assertScopeWriter(fields.parent, store);
    assertScopeWriter(fields.child, store);
    if (fields.carrier !== undefined) {
        assertReferenceCopyCarrier(fields.carrier);
    }
    const nowMilliseconds = readNowMilliseconds(fields.nowMilliseconds, "nowMilliseconds");
    const commandId = fields.commandId;
    const parent = fields.parent;
    const child = fields.child;
    const carrier = fields.carrier as ReferenceCopyCarrier | undefined;
    const commandIntentId = createScopeCommandAppendIntentId(commandId);
    const expected = {
        childHeadRecordId: fields.expectedChildHeadRecordId,
        childScopeId: child.scope_id,
        parentHeadRecordId: fields.expectedParentHeadRecordId,
        parentScopeId: parent.scope_id,
    };
    const prepared =
        readRetainedReservation(store, commandIntentId, commandId, expected) ??
        (await planMerge(store, carrier, commandId, expected));
    if (prepared.world !== null && carrier === undefined) {
        throw new TypeError("mergeScope requires a carrier for a reference-copy child");
    }
    const mergeCutId = createScopeMergeCutId(commandId);
    const reservation = store.prepareScopeMerge({
        childExpectedHeadRecordId: expected.childHeadRecordId,
        childFence: { claimId: child.claim_id, fencingToken: child.fencing_token },
        childScopeId: child.scope_id,
        commandAppendIntentId: commandIntentId,
        mergeCutId,
        nowMilliseconds,
        parentExpectedHeadRecordId: expected.parentHeadRecordId,
        parentFence: { claimId: parent.claim_id, fencingToken: parent.fencing_token },
        parentScopeId: parent.scope_id,
        prepared: (cut) => ({
            append_intent_id: commandIntentId,
            batch: {
                groups: [
                    {
                        owner_id: child.scope_id,
                        records: [
                            {
                                body: prepared as unknown as RecordBody,
                                caused_by_record_ids: [cut.created_by_record_id],
                                mode: CAPTURE_MODE,
                                schema_ref: scopeProtocolConfig.traceSchemas.merge,
                                witness_ref: ROOT_WITNESS_ID,
                            },
                        ],
                    },
                ],
            },
        }),
    });
    const preparedRecordId = reservation.receipt.record_ids[0] as RecordId;
    const completedIntentId = createScopeMergeAppendIntentId(commandId, MERGE_COMPLETED_PHASE);
    const boundary = {
        childScopeId: child.scope_id,
        nowMilliseconds,
        parentExpectedHeadRecordId: expected.parentHeadRecordId,
        parentFence: { claimId: parent.claim_id, fencingToken: parent.fencing_token },
        parentScopeId: parent.scope_id,
        preparedRecordId,
    };
    const world = prepared.world;
    if (store.readScopeMergeBoundary(boundary, completedIntentId) === "ready") {
        const publicationRevisionId =
            world === null
                ? null
                : await publishParentWorld(carrier as ReferenceCopyCarrier, world);
        const checkpointRecordId =
            (inspectScope(store, child.scope_id) as ScopeInspection).world?.completed_record_id ??
            null;
        store.completeScopeMerge({
            ...boundary,
            request: {
                append_intent_id: completedIntentId,
                batch: {
                    groups: [
                        {
                            owner_id: parent.scope_id,
                            records: [
                                {
                                    body: createScopeChildMergedBody({
                                        childCheckpointRecordId: checkpointRecordId,
                                        childCutId: mergeCutId,
                                        childScopeId: child.scope_id,
                                        commandId,
                                        contributions: prepared.contributions,
                                        mergedContentId:
                                            world === null ? null : world.merged_content_id,
                                        parentScopeId: parent.scope_id,
                                        publicationRevisionId,
                                    }) as unknown as RecordBody,
                                    caused_by_record_ids: [
                                        expected.parentHeadRecordId,
                                        preparedRecordId,
                                    ],
                                    mode: CAPTURE_MODE,
                                    schema_ref: scopeProtocolConfig.traceSchemas.childMerged,
                                    witness_ref: ROOT_WITNESS_ID,
                                },
                            ],
                        },
                        {
                            owner_id: child.scope_id,
                            records: [
                                {
                                    body: createScopeMergeCompletedBody({
                                        commandId,
                                        parentScopeId: parent.scope_id,
                                        publicationRevisionId,
                                        scopeId: child.scope_id,
                                    }) as unknown as RecordBody,
                                    caused_by_record_ids: [preparedRecordId],
                                    mode: CAPTURE_MODE,
                                    schema_ref: scopeProtocolConfig.traceSchemas.merge,
                                    witness_ref: ROOT_WITNESS_ID,
                                },
                            ],
                        },
                    ],
                },
            },
        });
    }
    if (world !== null && world.application_custody_id !== null) {
        discardReferenceCopyCustodyIdentity(
            carrier as ReferenceCopyCarrier,
            world.application_custody_id,
        );
    }
    const replay = readScopeCommandReceipt(store, commandId);
    // A retained completion is decoded by the same replay reader that validated it.
    /* node:coverage ignore next 3 */
    if (replay?.command !== MERGE_COMMAND) {
        throw new ScopeEvidenceError("scope merge completion is not retained");
    }
    return replay.receipt;
}

type MergeExpectation = {
    readonly childHeadRecordId: RecordId;
    readonly childScopeId: string;
    readonly parentHeadRecordId: RecordId;
    readonly parentScopeId: string;
};

function readRetainedReservation(
    store: SQLiteTraceStore,
    commandIntentId: string,
    commandId: string,
    expected: MergeExpectation,
): ScopeMergePreparedRecord | undefined {
    const retained = store.readAppendIntentRecords(commandIntentId);
    if (retained.length === 0) {
        return undefined;
    }
    const [record] = retained;
    const prepared =
        retained.length === 1 &&
        record?.envelope.schema_ref === scopeProtocolConfig.traceSchemas.merge
            ? readScopeMergeRecord(record.body)
            : undefined;
    if (
        prepared?.phase !== MERGE_PREPARED_PHASE ||
        prepared.command_id !== commandId ||
        prepared.scope_id !== expected.childScopeId ||
        prepared.parent_scope_id !== expected.parentScopeId ||
        prepared.child_head_record_id !== expected.childHeadRecordId ||
        prepared.parent_head_record_id !== expected.parentHeadRecordId
    ) {
        throw new AppendIntentConflictError(
            `scope command ${commandId} already names different content`,
        );
    }
    return prepared;
}

async function planMerge(
    store: SQLiteTraceStore,
    carrier: ReferenceCopyCarrier | undefined,
    commandId: string,
    expected: MergeExpectation,
): Promise<ScopeMergePreparedRecord> {
    const parent = inspectScope(store, expected.parentScopeId) as ScopeInspection;
    const child = inspectScope(store, expected.childScopeId) as ScopeInspection;
    if (child.parent?.scope_id !== parent.scope_id) {
        throw new ScopeEvidenceError(`scope ${child.scope_id} is not owned by ${parent.scope_id}`);
    }
    if (child.head.record_id !== expected.childHeadRecordId) {
        throw new ScopeHeadConflictError(child.scope_id);
    }
    if (parent.head.record_id !== expected.parentHeadRecordId) {
        throw new ScopeHeadConflictError(parent.scope_id);
    }
    const selected = new Set(parent.selected_history.map(scopeContributionKey));
    const contributions = child.selected_history.filter(
        (contribution) => !selected.has(scopeContributionKey(contribution)),
    );
    if (contributions.length > scopeProtocolConfig.limits.maxContributions) {
        throw new ScopeEvidenceError("scope merge contributions exceed the configured bound");
    }
    return createScopeMergePreparedBody({
        childHeadRecordId: expected.childHeadRecordId,
        commandId,
        contributions,
        mergeCutId: createScopeMergeCutId(commandId),
        parentHeadRecordId: expected.parentHeadRecordId,
        parentScopeId: parent.scope_id,
        scopeId: child.scope_id,
        world:
            child.world === null
                ? null
                : await planWorld(
                      carrier,
                      parent,
                      child,
                      createScopeCommandAppendIntentId(commandId),
                  ),
    });
}

async function planWorld(
    carrier: ReferenceCopyCarrier | undefined,
    parent: ScopeInspection,
    child: ScopeInspection,
    operationKey: string,
): Promise<ScopeMergeWorldPlan> {
    if (carrier === undefined) {
        throw new TypeError("mergeScope requires a carrier for a reference-copy child");
    }
    // Child writer admission already proved the child fork completed.
    const childWorld = child.world as NonNullable<ScopeInspection["world"]>;
    const parentWorld = parent.world;
    if (parentWorld === null) {
        throw new ScopeEvidenceError("scope world merge requires parent-managed custody");
    }
    const granted = parent.authority.effective.find(
        (entry) =>
            entry.resource_kind === childWorld.resource.resource_kind &&
            entry.resource_id === childWorld.resource.resource_id,
    );
    if (granted === undefined || !granted.atoms.includes(WRITE_ATOM)) {
        throw new ScopeAuthorityError(
            `merge into ${childWorld.resource.resource_kind} ${childWorld.resource.resource_id} requires ${WRITE_ATOM} authority`,
        );
    }
    const origin = await carrier.openRevision(childWorld.base_revision_id);
    const childRevision = await carrier.captureCustody(childWorld.custody_id);
    const parentRevision = await carrier.captureCustody(parentWorld.custody_id);
    const childDelta = await createVerifiedWorldChangeset({
        baseRevision: origin,
        carrier,
        headRevision: childRevision,
    });
    const parentDelta = await createVerifiedWorldChangeset({
        baseRevision: origin,
        carrier,
        headRevision: parentRevision,
    });
    const conflict = inspectRetainedWorldApplicationConflicts({
        candidatePaths: childDelta.changeset.changed_paths,
        currentPaths: parentDelta.changeset.changed_paths,
    });
    if (conflict !== null) {
        throw new ScopeMergeConflictError(conflict);
    }
    const application =
        childDelta.changeset.changes.length === 0
            ? null
            : createReferenceCopyApplicationRevision(carrier, {
                  candidateChangeset: childDelta.changeset,
                  currentRevisionId: parentRevision.revision_id,
                  operationKey,
              });
    const merged = application === null ? parentRevision : application.revision;
    return Object.freeze({
        application_custody_id: application === null ? null : application.custody.custody_id,
        binding_id: childWorld.binding_id,
        child_content_id: childRevision.content_id,
        child_revision_id: childRevision.revision_id,
        merged_content_id: merged.content_id,
        merged_revision_id: merged.revision_id,
        origin_content_id: origin.content_id,
        origin_revision_id: origin.revision_id,
        parent_content_id: parentRevision.content_id,
        parent_custody_id: parentWorld.custody_id,
        parent_revision_id: parentRevision.revision_id,
    });
}

async function publishParentWorld(
    carrier: ReferenceCopyCarrier,
    world: ScopeMergeWorldPlan,
): Promise<string> {
    const publication = await createVerifiedWorldChangeset({
        baseRevision: await carrier.openRevision(world.parent_revision_id),
        carrier,
        headRevision: await carrier.openRevision(world.merged_revision_id),
    });
    const verification = publishReferenceCopyCustodyChangeset(
        carrier,
        world.parent_custody_id,
        publication.changeset,
    );
    if (verification.content_id !== world.merged_content_id) {
        throw new ScopeEvidenceError("scope merge parent custody is in an unknown physical state");
    }
    const receipt = await carrier.captureCustody(world.parent_custody_id);
    return receipt.revision_id;
}
