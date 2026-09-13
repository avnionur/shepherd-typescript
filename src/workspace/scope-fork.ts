import {
    projectionProtocolConfig,
    scopeProtocolConfig,
    workspaceProtocolConfig,
} from "../protocol/config.ts";
import {
    RECORD_MODES,
    SCOPE_AUTHORITY_ATOMS,
    SCOPE_CHECKPOINT_CONSTITUENT_KINDS,
    SCOPE_CHECKPOINT_EVIDENCE_STATUSES,
    SCOPE_COMMAND_KINDS,
    SCOPE_FORK_PHASES,
    SCOPE_RESOURCE_KINDS,
    SCOPE_WORLD_CAPABILITIES,
} from "../protocol/values.generated.ts";
import { ROOT_WITNESS_ID } from "../record/root-witness.ts";
import type { RecordBody, RecordId } from "../record/types.ts";
import { ScopeAuthorityError, ScopeEvidenceError } from "../scope/errors.ts";
import { inspectScope } from "../scope/inspection.ts";
import {
    createScopeCommandAppendIntentId,
    createScopeForkAppendIntentId,
    createScopeForkCompletedBody,
    createScopeForkCustodyId,
    createScopeForkPreparedBody,
} from "../scope/records.ts";
import {
    type PreparedChildScopeRegistration,
    prepareChildScopeRegistration,
} from "../scope/registration.ts";
import { readScopeCommandReceipt } from "../scope/replay.ts";
import type {
    ScopeBoundResource,
    ScopeCheckpoint,
    ScopeCheckpointConstituent,
    ScopeCheckpointConstituentKind,
    ScopeForkCompletedRecord,
    ScopeForkPreparedRecord,
    ScopeForkReceipt,
} from "../scope/types.ts";
import { assertPrefixedDigest, readScopeDataObject } from "../scope/validation.ts";
import { readPreparedForkOccurrence } from "../scope/world.ts";
import { AppendIntentConflictError } from "../store/errors.ts";
import type { SQLiteTraceStore } from "../store/sqlite-trace-store.ts";
import type { Cut, OwnerRecord, StoreAppendRequest } from "../store/types.ts";
import {
    assertCurrentGitRepositoryBinding,
    assertWorkspaceBinding,
    isGitRepositoryBinding,
} from "./bindings.ts";
import {
    assertReferenceCopyCarrier,
    forkReferenceCopyRevisionWithIdentity,
} from "./reference-copy-carrier.ts";
import type { ForkScopeOptions } from "./scope-fork-types.ts";
import type { ReferenceCopyCarrier, WorkspaceBinding, WorldRevision } from "./types.ts";

const [CAPTURE_MODE] = RECORD_MODES;
const [READ_ATOM] = SCOPE_AUTHORITY_ATOMS;
const [REPOSITORY_RESOURCE_KIND, WORKSPACE_RESOURCE_KIND] = SCOPE_RESOURCE_KINDS;
const [, REFERENCE_COPY_CAPABILITY] = SCOPE_WORLD_CAPABILITIES;
const [PREPARED_PHASE, COMPLETED_PHASE] = SCOPE_FORK_PHASES;
const [, , , FORK_COMMAND] = SCOPE_COMMAND_KINDS;
const [VERIFIED_STATUS, , NOT_APPLICABLE_STATUS, UNAVAILABLE_STATUS] =
    SCOPE_CHECKPOINT_EVIDENCE_STATUSES;
const [
    TRACE_CUT_CONSTITUENT,
    EXECUTION_CONSTITUENT,
    BINDING_CONSTITUENT,
    WORLD_CONSTITUENT,
    GRANTS_CONSTITUENT,
    CHILD_FRONTIER_CONSTITUENT,
    BUDGET_CONSTITUENT,
    PROVIDER_SESSION_CONSTITUENT,
    PROCESS_CONSTITUENT,
    IRREVERSIBLE_EFFECTS_CONSTITUENT,
] = SCOPE_CHECKPOINT_CONSTITUENT_KINDS;

/**
 * Durably forks one isolated child scope with reference-copy custody of a single bound resource.
 *
 * One transaction registers the child under the exact parent head, publishes its origin cut, and
 * retains a prepared journal record naming the binding, bound resource, immutable origin revision,
 * and deterministic custody identity before any physical work. The carrier then publishes that
 * custody by identity as a quiescent verified copy of the origin, and the fork is completed only
 * after the custody and origin re-verify unmodified, with a checkpoint descriptor that classifies
 * every configured constituent. Completion requires the parent's current writer fence.
 *
 * The origin must be the parent's world: a binding snapshot for a trace-only parent, or a capture
 * of the parent world's current custody for a forked parent. The child's effective authority must
 * grant read on the bound resource. Parent and sibling custody and the user binding are never
 * written. Until completion, writer claims on the child are refused.
 *
 * Retrying the same command converges: retained registration is replayed, and a completed fork
 * returns its original receipt with no carrier work. An incomplete fork runs physical work only
 * after positive safe-boundary evidence: the parent's current writer fence, the prepared record as
 * the child head, and no writer ever admitted on the child. An interrupted copy is then reopened
 * by its deterministic identity. Custody that is modified or discarded before completion is an
 * unknown physical state and stays blocked rather than being re-copied over.
 *
 * @param store - Open writable trace store holding the parent registration.
 * @param options - Parent writer, exact head, grant, binding, carrier, origin, and command.
 * @returns Frozen completed fork receipt with its verified world and checkpoint.
 * @throws {ScopeAuthorityError} If the grant cannot read the bound resource or exceeds authority.
 * @throws {ScopeWriterFencedError} If the parent fence is released, expired, or superseded.
 * @throws {ScopeHeadConflictError} If the expected parent head is not current.
 * @throws {ScopeEvidenceError} If the origin is not the parent world, the custody is in an unknown
 * physical state, or retained evidence is inconsistent.
 * @throws {AppendIntentConflictError} If the command identity already names different content.
 * @throws {WorldCarrierError} If carrier evidence is unavailable, corrupt, or discarded.
 * @throws {TraceStoreError} If the store is closed.
 * @throws {TypeError} If a handle is forged or options are malformed.
 *
 * @example
 * ```ts
 * const origin = await carrier.snapshot(binding);
 * const fork = await forkScope(store, {
 *     binding,
 *     carrier,
 *     commandId: "scope-command:fork:1",
 *     expectedHeadRecordId: root.head.record_id,
 *     grant: [{ atoms: ["read", "write"], resource_id: binding.binding_id, resource_kind: "workspace_binding" }],
 *     originRevisionId: origin.revision_id,
 *     parent: rootWriter,
 * });
 * const custody = await carrier.openCustody(fork.world.custody_id);
 * ```
 *
 * @public
 */
export async function forkScope(
    store: SQLiteTraceStore,
    options: ForkScopeOptions,
): Promise<ScopeForkReceipt> {
    const fields = readScopeDataObject(
        options,
        [
            "binding",
            "carrier",
            "commandId",
            "expectedHeadRecordId",
            "grant",
            "originRevisionId",
            "parent",
        ],
        "forkScope options",
        ["executionId", "nowMilliseconds"],
    );
    assertReferenceCopyCarrier(fields.carrier);
    assertWorkspaceBinding(fields.binding);
    assertPrefixedDigest(
        fields.originRevisionId,
        workspaceProtocolConfig.carrier.revisionIdPrefix,
        "originRevisionId",
    );
    const carrier = fields.carrier;
    const binding = fields.binding;
    const originRevisionId = fields.originRevisionId as string;
    const child = prepareChildScopeRegistration(store, fields, REFERENCE_COPY_CAPABILITY);
    const resource = boundResource(binding);
    const granted = child.authority.effective.find(
        (entry) =>
            entry.resource_kind === resource.resource_kind &&
            entry.resource_id === resource.resource_id,
    );
    if (granted === undefined || !granted.atoms.includes(READ_ATOM)) {
        throw new ScopeAuthorityError(
            `fork of ${resource.resource_kind} ${resource.resource_id} requires ${READ_ATOM} authority`,
        );
    }
    const { commandId, scopeId } = child;
    const custodyId = createScopeForkCustodyId(commandId, scopeId);
    const baseContentId = await admitOrigin(store, carrier, child, binding, originRevisionId);
    const preparedBody = createScopeForkPreparedBody({
        baseContentId,
        baseRevisionId: originRevisionId,
        bindingId: binding.binding_id,
        commandId,
        custodyId,
        resourceId: resource.resource_id,
        resourceKind: resource.resource_kind,
        scopeId,
    });
    const registered = store.registerChildScope({
        ...child.registration,
        prepared: (cut: Cut) =>
            forkJournalRequest(
                createScopeForkAppendIntentId(commandId, PREPARED_PHASE),
                scopeId,
                preparedBody,
                cut.created_by_record_id,
            ),
    });
    const preparedRecordId = registered.preparedReceipt?.record_ids[0] as RecordId;
    const completedIntentId = createScopeForkAppendIntentId(commandId, COMPLETED_PHASE);
    const boundary = {
        childScopeId: scopeId,
        nowMilliseconds: child.registration.nowMilliseconds,
        parentFence: child.registration.parentFence,
        parentScopeId: child.registration.parentScopeId,
        preparedRecordId,
    };
    if (store.readScopeForkBoundary(boundary, completedIntentId) === "ready") {
        const custody = forkReferenceCopyRevisionWithIdentity(carrier, originRevisionId, custodyId);
        const custodyVerification = await carrier.verifyCustody(custodyId);
        const originVerification = await carrier.verifyRevision(originRevisionId);
        if (
            custody.base_revision_id !== originRevisionId ||
            custody.base_content_id !== baseContentId ||
            custody.binding_id !== binding.binding_id ||
            custodyVerification.modified ||
            custodyVerification.content_id !== baseContentId ||
            originVerification.modified
        ) {
            throw new ScopeEvidenceError("scope fork custody is in an unknown physical state");
        }
        const completedBody = createScopeForkCompletedBody({
            checkpoint: createCheckpoint({
                childRegisteredRecordId: child.origin.child_registered_record_id,
                custodyId: custody.custody_id,
                executionCreationRecordId: executionCreationRecordId(
                    store,
                    child.registration.executionId,
                ),
                originCutId: child.origin.origin_cut_id,
                originRevisionId: custody.base_revision_id,
                registrationRecordId: registered.receipt.record_ids[1] as RecordId,
            }),
            commandId,
            custodyContentId: custodyVerification.content_id,
            custodyId: custody.custody_id,
            scopeId,
        });
        store.completeScopeFork({
            ...boundary,
            request: forkJournalRequest(
                completedIntentId,
                scopeId,
                completedBody,
                preparedRecordId,
            ),
        });
    }
    const replay = readScopeCommandReceipt(store, commandId);
    // A retained completed record is decoded by the same replay reader that validated it.
    /* node:coverage ignore next 3 */
    if (replay?.command !== FORK_COMMAND) {
        throw new ScopeEvidenceError("scope fork completion is not retained");
    }
    return replay.receipt;
}

async function admitOrigin(
    store: SQLiteTraceStore,
    carrier: ReferenceCopyCarrier,
    child: PreparedChildScopeRegistration,
    binding: WorkspaceBinding,
    originRevisionId: string,
): Promise<string> {
    const commandId = child.commandId;
    if (store.readAppendIntentRecords(createScopeCommandAppendIntentId(commandId)).length > 0) {
        const [preparedRecord] = store.readAppendIntentRecords(
            createScopeForkAppendIntentId(commandId, PREPARED_PHASE),
        );
        const prepared =
            preparedRecord === undefined
                ? undefined
                : readPreparedForkOccurrence(preparedRecord, child.scopeId, commandId);
        if (prepared === undefined || prepared.base_revision_id !== originRevisionId) {
            throw new AppendIntentConflictError(
                `scope command ${commandId} already names different content`,
            );
        }
        return prepared.base_content_id;
    }
    const origin = await carrier.openRevision(originRevisionId);
    if (origin.binding_id !== binding.binding_id) {
        throw new ScopeEvidenceError("fork origin revision does not capture the bound binding");
    }
    await assertParentWorldOrigin(store, carrier, child.registration.parentScopeId, origin);
    return origin.content_id;
}

async function assertParentWorldOrigin(
    store: SQLiteTraceStore,
    carrier: ReferenceCopyCarrier,
    parentScopeId: string,
    origin: WorldRevision,
): Promise<void> {
    const parentWorld = inspectScope(store, parentScopeId)?.world ?? null;
    if (parentWorld === null) {
        if (origin.parent_revision_id !== null) {
            throw new ScopeEvidenceError(
                "fork origin of a trace-only parent must be a binding snapshot",
            );
        }
        return;
    }
    if (parentWorld.binding_id !== origin.binding_id) {
        throw new ScopeEvidenceError("nested fork must bind the parent world binding");
    }
    const current = await carrier.verifyCustody(parentWorld.custody_id);
    if (
        origin.parent_revision_id !== parentWorld.base_revision_id ||
        origin.content_id !== current.content_id
    ) {
        throw new ScopeEvidenceError("fork origin revision is not the current parent world");
    }
}

function boundResource(binding: WorkspaceBinding): ScopeBoundResource {
    if (isGitRepositoryBinding(binding)) {
        assertCurrentGitRepositoryBinding(binding);
        return Object.freeze({
            resource_id: binding.resource_id,
            resource_kind: REPOSITORY_RESOURCE_KIND,
        });
    }
    return Object.freeze({
        resource_id: binding.binding_id,
        resource_kind: WORKSPACE_RESOURCE_KIND,
    });
}

function forkJournalRequest(
    appendIntentId: string,
    scopeId: string,
    body: ScopeForkCompletedRecord | ScopeForkPreparedRecord,
    causeRecordId: RecordId,
): StoreAppendRequest {
    return {
        append_intent_id: appendIntentId,
        batch: {
            groups: [
                {
                    owner_id: scopeId,
                    records: [
                        {
                            body: body as unknown as RecordBody,
                            caused_by_record_ids: [causeRecordId],
                            mode: CAPTURE_MODE,
                            schema_ref: scopeProtocolConfig.traceSchemas.fork,
                            witness_ref: ROOT_WITNESS_ID,
                        },
                    ],
                },
            ],
        },
    };
}

function executionCreationRecordId(
    store: SQLiteTraceStore,
    executionId: string | null,
): RecordId | null {
    if (executionId === null) {
        return null;
    }
    // Registration admission already required retained creation evidence for the execution.
    const creation = store
        .readOwner(executionId)
        .find(
            (record) =>
                record.envelope.schema_ref ===
                projectionProtocolConfig.executionHistory.executionSchemas.created,
        ) as OwnerRecord;
    return creation.envelope.record_id;
}

function createCheckpoint(evidence: {
    readonly childRegisteredRecordId: RecordId;
    readonly custodyId: string;
    readonly executionCreationRecordId: RecordId | null;
    readonly originCutId: string;
    readonly originRevisionId: string;
    readonly registrationRecordId: RecordId;
}): ScopeCheckpoint {
    const verified = (kind: ScopeCheckpointConstituentKind, receiptId: string) =>
        ({ kind, receipt_id: receiptId, status: VERIFIED_STATUS }) as const;
    const notApplicable = (kind: ScopeCheckpointConstituentKind) =>
        ({ kind, status: NOT_APPLICABLE_STATUS }) as const;
    const unavailable = (kind: ScopeCheckpointConstituentKind, reason: string) =>
        ({ kind, reason, status: UNAVAILABLE_STATUS }) as const;
    const runState = (kind: ScopeCheckpointConstituentKind, reason: string) =>
        evidence.executionCreationRecordId === null
            ? notApplicable(kind)
            : unavailable(kind, reason);
    const classifications: Record<ScopeCheckpointConstituentKind, ScopeCheckpointConstituent> = {
        [TRACE_CUT_CONSTITUENT]: verified(TRACE_CUT_CONSTITUENT, evidence.originCutId),
        [EXECUTION_CONSTITUENT]:
            evidence.executionCreationRecordId === null
                ? notApplicable(EXECUTION_CONSTITUENT)
                : verified(EXECUTION_CONSTITUENT, evidence.executionCreationRecordId),
        [BINDING_CONSTITUENT]: verified(BINDING_CONSTITUENT, evidence.originRevisionId),
        [WORLD_CONSTITUENT]: verified(WORLD_CONSTITUENT, evidence.custodyId),
        [GRANTS_CONSTITUENT]: verified(GRANTS_CONSTITUENT, evidence.registrationRecordId),
        [CHILD_FRONTIER_CONSTITUENT]: verified(
            CHILD_FRONTIER_CONSTITUENT,
            evidence.childRegisteredRecordId,
        ),
        [BUDGET_CONSTITUENT]: runState(
            BUDGET_CONSTITUENT,
            "run budget and cancellation state is not captured by scope forks",
        ),
        [PROVIDER_SESSION_CONSTITUENT]: runState(
            PROVIDER_SESSION_CONSTITUENT,
            "provider session state is not captured by reference-copy forks",
        ),
        [PROCESS_CONSTITUENT]: runState(
            PROCESS_CONSTITUENT,
            "process state is not captured by reference-copy forks",
        ),
        [IRREVERSIBLE_EFFECTS_CONSTITUENT]: unavailable(
            IRREVERSIBLE_EFFECTS_CONSTITUENT,
            "external irreversible effects are not tracked by reference-copy forks",
        ),
    };
    return {
        capture_kind: workspaceProtocolConfig.carrier.captureKind,
        checkpoint_version: scopeProtocolConfig.checkpoint.version,
        constituents: SCOPE_CHECKPOINT_CONSTITUENT_KINDS.map((kind) => classifications[kind]),
    };
}
