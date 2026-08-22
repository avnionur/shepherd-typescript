import { canonicalizeRecord, type SemanticRecord } from "../canonical/canonical-record.ts";
import { workspaceProtocolConfig } from "../protocol/config.ts";
import {
    DURABLE_EXECUTION_RECOVERY_STATUSES,
    RETAINED_WORLD_SETTLEMENT_ACTIONS,
    RETAINED_WORLD_SETTLEMENT_STATES,
    RETAINED_WORLD_SETTLEMENT_VERSION,
} from "../protocol/values.generated.ts";
import { readDurableTaskExecution } from "../run/durable-execution-recovery.ts";
import {
    RetainedWorldSettlementConflictError,
    RetainedWorldSettlementInvalidError,
} from "../store/errors.ts";
import {
    encodeRetainedWorldApplicationPlan,
    readRetainedWorldApplicationPlan,
} from "../store/retained-world-application-codec.ts";
import {
    decodeRetainedWorldSettlementOperation,
    encodeRetainedWorldSettlementOperation,
} from "../store/retained-world-settlement-codec.ts";
import type { SQLiteTraceStore } from "../store/sqlite-trace-store.ts";
import type {
    RetainedWorldApplicationPlanEvidence,
    RetainedWorldSettlementJournal,
    RetainedWorldSettlementRequest,
} from "../store/types.ts";
import {
    assertCurrentGitRepositoryBinding,
    assertWorkspaceBinding,
    isGitRepositoryBinding,
} from "./bindings.ts";
import { createVerifiedWorldChangeset } from "./changesets.ts";
import { RetainedWorldApplicationConflictError } from "./errors.ts";
import {
    assertReferenceCopyCarrier,
    createReferenceCopyApplicationRevision,
    publishReferenceCopySelection,
} from "./reference-copy-carrier.ts";
import { assertRetainedWorldApplicationPathsDisjoint } from "./retained-world-application.ts";
import { publishRetainedWorldSettlementCitation } from "./retained-world-settlement-citation.ts";
import type {
    AppliedRetainedWorldSettlement,
    ApplyRetainedWorldSettlementOptions,
    DiscardedRetainedWorldSettlement,
    DiscardRetainedWorldSettlementOptions,
    PreparedRetainedWorldSettlement,
    PrepareRetainedWorldSettlementOptions,
    SelectedRetainedWorldSettlement,
    SelectRetainedWorldSettlementOptions,
} from "./retained-world-settlement-types.ts";
import {
    encodeSelectionPublicationPlan,
    encodeSelectionPublicationSchedule,
} from "./selection-publication-codec.ts";
import type { RetainedWorldOutput } from "./task-world-execution-types.ts";
import { inspectTaskWorldCaptureJournal } from "./task-world-journal.ts";
import type { ReferenceCopyCarrier, WorldRevision } from "./types.ts";

const [, , , , COMMITTED_RECOVERY_STATUS] = DURABLE_EXECUTION_RECOVERY_STATUSES;
const [SELECT_ACTION, DISCARD_ACTION, APPLY_ACTION] = RETAINED_WORLD_SETTLEMENT_ACTIONS;
const [PREPARED_STATE, APPLYING_STATE, SELECTED_STATE, DISCARDED_STATE, APPLIED_STATE] =
    RETAINED_WORLD_SETTLEMENT_STATES;

/**
 * Authenticates one exact retained output and atomically prepares its consume-once settlement.
 *
 * This function authenticates durable trace and retained carrier evidence. Apply preparation also
 * snapshots the current user basis to prove path disjointness, but does not mutate the user binding,
 * select a revision, or discard custody. Exact replay returns the existing prepared decision; a
 * different command or action conflicts at the store transaction.
 *
 * @param options - Exact action, command, output, store, binding, and carrier authority.
 * @returns Frozen authenticated prepared settlement decision.
 * @throws {RetainedWorldSettlementInvalidError} If any durable or carrier citation is absent,
 * malformed, forged, moved, or inconsistent.
 * @throws {RetainedWorldSettlementConflictError} If another exact request owns the command or
 * output identity.
 *
 * @example
 * ```ts
 * const prepared = await prepareRetainedWorldSettlement({
 *     action: "select",
 *     binding,
 *     carrier,
 *     commandId: "settlement:review:1",
 *     output: captured.output,
 *     store,
 * });
 * prepared.state;
 * ```
 *
 * @public
 */
export async function prepareRetainedWorldSettlement(
    options: PrepareRetainedWorldSettlementOptions,
): Promise<PreparedRetainedWorldSettlement> {
    try {
        const fields = exactObject(options, [
            "action",
            "binding",
            "carrier",
            "commandId",
            "output",
            "store",
        ]);
        if (!RETAINED_WORLD_SETTLEMENT_ACTIONS.includes(fields.action as never)) {
            throw new TypeError("retained-world settlement action is unsupported");
        }
        if (typeof fields.commandId !== "string" || fields.commandId.length === 0) {
            throw new TypeError("retained-world settlement command identity is invalid");
        }
        const binding = fields.binding as PrepareRetainedWorldSettlementOptions["binding"];
        const carrier = fields.carrier as PrepareRetainedWorldSettlementOptions["carrier"];
        const store = fields.store as PrepareRetainedWorldSettlementOptions["store"];
        assertWorkspaceBinding(binding);
        if (isGitRepositoryBinding(binding)) assertCurrentGitRepositoryBinding(binding);
        assertReferenceCopyCarrier(carrier);
        const output = readOutput(fields.output);
        const recovery = readDurableTaskExecution(store, output.run_id);
        if (recovery.status !== COMMITTED_RECOVERY_STATUS) {
            throw new TypeError("retained-world execution is not committed");
        }
        const journal = inspectTaskWorldCaptureJournal(store, output.run_id);
        if (
            journal.capture_id !== output.capture_id ||
            journal.output_record_id !== output.capture_record_id
        ) {
            throw new TypeError("retained-world capture journal is inconsistent");
        }
        const outputRecord = store.readRecord(output.capture_record_id);
        if (
            outputRecord === undefined ||
            canonicalizeRecord(outputRecord.body as SemanticRecord) !==
                canonicalizeRecord(outputBody(output)) ||
            recovery.result.ledger.outcome_record_id !== output.execution_outcome_record_id ||
            canonicalizeRecord(recovery.result.ledger.cut as unknown as SemanticRecord) !==
                canonicalizeRecord(output.execution_cut as unknown as SemanticRecord)
        ) {
            throw new TypeError("retained-world terminal evidence is inconsistent");
        }
        if (binding.binding_id !== output.binding_id) {
            throw new TypeError("retained-world binding authority is inconsistent");
        }
        const base = await carrier.openRevision(output.base_revision_id);
        const head = await carrier.openRevision(output.head_revision_id);
        const evidence = await createVerifiedWorldChangeset({
            baseRevision: base,
            carrier,
            headRevision: head,
        });
        if (fields.action === APPLY_ACTION) {
            assertApplicationCandidatePathsAllowed(evidence.changeset.changed_paths, binding);
            const current = await carrier.snapshot(binding);
            const currentEvidence = await createVerifiedWorldChangeset({
                baseRevision: evidence.baseRevision,
                carrier,
                headRevision: current,
            });
            assertRetainedWorldApplicationPathsDisjoint(
                evidence.changeset.changed_paths,
                currentEvidence.changeset.changed_paths,
            );
        }
        assertRevisionContract(evidence.baseRevision, evidence.headRevision, output);
        // Authenticated content-addressed revisions make disagreement possible only after a
        // digest collision or an implementation defect in the shared changeset constructor.
        /* node:coverage ignore next 3 */
        if (evidence.changeset.changeset_id !== output.changeset_id) {
            throw new TypeError("retained-world changeset identity is inconsistent");
        }
        const custody = await carrier.openCustody(output.custody_id);
        const custodyVerification = await carrier.verifyCustody(output.custody_id);
        if (
            custody.binding_id !== output.binding_id ||
            custody.base_revision_id !== output.base_revision_id ||
            custody.base_content_id !== base.content_id ||
            custodyVerification.content_id !== head.content_id
        ) {
            throw new TypeError("retained-world custody evidence is inconsistent");
        }
        const request = Object.freeze({
            action: fields.action as RetainedWorldSettlementRequest["action"],
            base_revision_id: output.base_revision_id,
            binding_id: output.binding_id,
            capture_record_id: output.capture_record_id,
            changeset_id: output.changeset_id,
            command_id: fields.commandId,
            custody_id: output.custody_id,
            execution_cut_id: output.execution_cut.cut_id,
            head_revision_id: output.head_revision_id,
            output_id: output.output_id,
            run_id: output.run_id,
            settlement_version: workspaceProtocolConfig.settlement.version,
            user_basis_before: output.user_basis_before,
        }) satisfies RetainedWorldSettlementRequest;
        return store.admitRetainedWorldSettlement(request);
    } catch (error) {
        if (
            error instanceof RetainedWorldSettlementInvalidError ||
            error instanceof RetainedWorldSettlementConflictError ||
            error instanceof RetainedWorldApplicationConflictError
        ) {
            throw error;
        }
        throw new RetainedWorldSettlementInvalidError(
            workspaceProtocolConfig.settlement.errors.invalidMessage,
            { cause: error },
        );
    }
}

/**
 * Inspects one durable prepared settlement decision and revalidates its immutable trace evidence.
 *
 * Inspection performs no carrier, provider, runner, or filesystem operation. It verifies the
 * retained request against the committed execution cut and exact world-capture record before
 * returning it, and therefore remains safe to use after reopening the trace store.
 *
 * @param store - Open trace store containing settlement and terminal execution evidence.
 * @param outputId - Exact retained-output identity, never a prefix or latest selector.
 * @returns Frozen prepared decision, or `undefined` when the output has no settlement admission.
 * @throws {RetainedWorldSettlementInvalidError} If settlement or cited execution evidence is
 * malformed, missing, or inconsistent.
 * @throws {TypeError} If the output identity is malformed.
 *
 * @example
 * ```ts
 * const settlement = inspectRetainedWorldSettlement(store, captured.output.output_id);
 * settlement?.request.execution_cut_id;
 * ```
 *
 * @public
 */
export function inspectRetainedWorldSettlement(
    store: PrepareRetainedWorldSettlementOptions["store"],
    outputId: string,
): PreparedRetainedWorldSettlement | undefined {
    if (typeof outputId !== "string" || outputId.length === 0) {
        throw new TypeError("retained-world settlement output identity is invalid");
    }
    try {
        const admission = store.readRetainedWorldSettlement(outputId);
        if (admission === undefined) return undefined;
        const request = admission.request;
        const recovery = readDurableTaskExecution(store, request.run_id);
        if (recovery.status !== COMMITTED_RECOVERY_STATUS) {
            throw new TypeError("retained-world settlement execution is not committed");
        }
        const journal = inspectTaskWorldCaptureJournal(store, request.run_id);
        const outputRecord = store.readRecord(request.capture_record_id);
        if (
            journal.output_record_id !== request.capture_record_id ||
            outputRecord === undefined ||
            outputRecord.body.output_id !== request.output_id ||
            outputRecord.body.run_id !== request.run_id ||
            outputRecord.body.binding_id !== request.binding_id ||
            outputRecord.body.base_revision_id !== request.base_revision_id ||
            outputRecord.body.head_revision_id !== request.head_revision_id ||
            outputRecord.body.changeset_id !== request.changeset_id ||
            outputRecord.body.custody_id !== request.custody_id ||
            outputRecord.body.user_basis_before !== request.user_basis_before ||
            recovery.result.ledger.cut.cut_id !== request.execution_cut_id
        ) {
            throw new TypeError("retained-world settlement trace evidence is inconsistent");
        }
        return admission;
    } catch (error) {
        if (error instanceof RetainedWorldSettlementInvalidError) throw error;
        throw new RetainedWorldSettlementInvalidError(
            workspaceProtocolConfig.settlement.errors.invalidMessage,
            { cause: error },
        );
    }
}

/**
 * Reads the exact durable three-way application plan without touching carrier or user files.
 *
 * @param store - Open trace store containing the settlement journal.
 * @param outputId - Exact retained-output identity.
 * @returns Authenticated application plan after planning, otherwise `undefined`.
 * @throws {RetainedWorldSettlementInvalidError} If retained operation evidence is malformed.
 * @throws {TypeError} If the output identity is malformed.
 *
 * @public
 */
export function inspectRetainedWorldApplicationPlan(
    store: SQLiteTraceStore,
    outputId: string,
): RetainedWorldApplicationPlanEvidence | undefined {
    if (typeof outputId !== "string" || outputId.length === 0) {
        throw new TypeError("retained-world application output identity is invalid");
    }
    try {
        const journal = store.readRetainedWorldSettlementJournal(outputId);
        if (journal?.admission.action !== APPLY_ACTION || journal.operation === null) {
            return undefined;
        }
        const operation = decodeRetainedWorldSettlementOperation(
            journal.operation.json,
            journal.admission,
        );
        // The action-discriminated operation decoder requires an application plan for apply.
        /* node:coverage ignore next 3 */
        if (!("application_plan" in operation.value)) {
            throw new TypeError("retained-world application plan is absent");
        }
        return readRetainedWorldApplicationPlan(operation.value.application_plan);
    } catch (error) {
        if (error instanceof RetainedWorldSettlementInvalidError) throw error;
        throw new RetainedWorldSettlementInvalidError(
            workspaceProtocolConfig.settlement.errors.invalidMessage,
            { cause: error },
        );
    }
}

/**
 * Durably selects one exact admitted retained output and recovers interrupted publication.
 *
 * The coordinator verifies the immutable admission, checks the current semantic user basis before
 * beginning the deterministic operation, and delegates a second pre-write basis check plus every
 * managed-path effect to the authenticated carrier. The selected store receipt is retained only
 * after the carrier publishes its exact terminal receipt. Applying and selected prefixes replay
 * without reopening consume-once admission or inferring success from current user bytes.
 *
 * @param options - Exact output identity plus canonical binding, carrier, and trace-store authority.
 * @returns Frozen selected result citing the exact carrier publication and final user basis.
 * @throws {RetainedWorldSettlementInvalidError} If trace, revision, changeset, basis, carrier, or
 * publication evidence is absent, malformed, moved, forged, or inconsistent.
 * @throws {RetainedWorldSettlementConflictError} If the output was admitted for another action or
 * has already reached another terminal settlement.
 *
 * @example
 * ```ts
 * const selected = await selectRetainedWorldSettlement({
 *     binding,
 *     carrier,
 *     outputId: captured.output.output_id,
 *     store,
 * });
 * selected.publication_id;
 * ```
 *
 * @public
 */
export async function selectRetainedWorldSettlement(
    options: SelectRetainedWorldSettlementOptions,
): Promise<SelectedRetainedWorldSettlement> {
    try {
        const fields = exactObject(options, ["binding", "carrier", "outputId", "store"]);
        if (typeof fields.outputId !== "string" || fields.outputId.length === 0) {
            throw new TypeError("retained-world settlement output identity is invalid");
        }
        const binding = fields.binding as SelectRetainedWorldSettlementOptions["binding"];
        const carrier = fields.carrier as ReferenceCopyCarrier;
        const store = fields.store as SQLiteTraceStore;
        assertWorkspaceBinding(binding);
        assertReferenceCopyCarrier(carrier);
        const admission = inspectRetainedWorldSettlement(store, fields.outputId);
        if (admission === undefined) {
            throw new TypeError("retained-world select admission is absent");
        }
        if (admission.action !== SELECT_ACTION) {
            throw new RetainedWorldSettlementConflictError(
                workspaceProtocolConfig.settlement.errors.conflictMessage,
            );
        }
        if (binding.binding_id !== admission.request.binding_id) {
            throw new TypeError("retained-world select binding authority is inconsistent");
        }
        const base = await carrier.openRevision(admission.request.base_revision_id);
        const head = await carrier.openRevision(admission.request.head_revision_id);
        const evidence = await createVerifiedWorldChangeset({
            baseRevision: base,
            carrier,
            headRevision: head,
        });
        // Authenticated content-addressed carrier reads reject these contradictions first.
        /* node:coverage ignore next 9 */
        if (
            base.binding_id !== admission.request.binding_id ||
            base.content_id !== admission.request.user_basis_before ||
            head.binding_id !== admission.request.binding_id ||
            head.parent_revision_id !== base.revision_id ||
            evidence.changeset.changeset_id !== admission.request.changeset_id
        ) {
            throw new TypeError("retained-world select revision evidence is inconsistent");
        }
        let journal = store.readRetainedWorldSettlementJournal(fields.outputId);
        if (journal === undefined) {
            throw new TypeError("retained-world select journal is absent");
        }
        if (journal.state === PREPARED_STATE) {
            const observed = await carrier.snapshot(binding);
            if (observed.content_id !== admission.request.user_basis_before) {
                throw new TypeError("retained-world select user basis moved before publication");
            }
            journal = store.beginRetainedWorldSettlement(fields.outputId);
        }
        // The action-bound closed journal cannot hold the other action's terminal state.
        /* node:coverage ignore next 5 */
        if (journal.state !== APPLYING_STATE && journal.state !== SELECTED_STATE) {
            throw new RetainedWorldSettlementConflictError(
                workspaceProtocolConfig.settlement.errors.conflictMessage,
            );
        }
        const operation = encodeRetainedWorldSettlementOperation(admission);
        // The store's closed journal decoder reconstructs this exact operation before returning.
        /* node:coverage ignore next 8 */
        if (
            journal.operation?.id !== operation.id ||
            journal.operation.digest !== operation.digest ||
            journal.operation.json !== operation.json
        ) {
            throw new TypeError("retained-world select operation evidence is inconsistent");
        }
        const plan = encodeSelectionPublicationPlan(
            operation,
            evidence.changeset,
            base.content_id,
            head.content_id,
        );
        const schedule = encodeSelectionPublicationSchedule(plan);
        const publication = await publishReferenceCopySelection(carrier, {
            changeset: evidence.changeset,
            observeUserBasis: async () => (await carrier.snapshot(binding)).content_id,
            operation,
            plan,
            schedule,
        });
        journal = store.retainRetainedWorldSettlementTerminal(fields.outputId, {
            action: SELECT_ACTION,
            publication_id: publication.id,
            user_basis_after: publication.value.user_basis_after,
        });
        // The atomic store transition returns a freshly validated selected journal.
        /* node:coverage ignore next 3 */
        if (journal.state !== SELECTED_STATE || journal.operation === null) {
            throw new TypeError("retained-world select terminal evidence is incomplete");
        }
        publishTerminalSettlementCitation(store, journal);
        return Object.freeze({
            action: SELECT_ACTION,
            operation_id: journal.operation.id,
            output_id: admission.output_id,
            publication_id: publication.id,
            request_id: admission.request_id,
            settlement_version: RETAINED_WORLD_SETTLEMENT_VERSION,
            state: SELECTED_STATE,
            user_basis_after: publication.value.user_basis_after,
        });
    } catch (error) {
        if (
            error instanceof RetainedWorldSettlementInvalidError ||
            error instanceof RetainedWorldSettlementConflictError
        ) {
            throw error;
        }
        throw new RetainedWorldSettlementInvalidError(
            workspaceProtocolConfig.settlement.errors.invalidMessage,
            { cause: error },
        );
    }
}

/**
 * Durably applies one exact admitted retained output and recovers interrupted publication.
 *
 * On an unchanged user basis this degenerates to the candidate head while retaining a distinct
 * applied settlement. On an advanced basis it requires path-disjoint deltas, constructs one exact
 * merged revision from current plus candidate changes, and publishes that revision recoverably.
 *
 * @param options - Exact output identity plus canonical binding, carrier, and trace-store authority.
 * @returns Frozen applied result citing the exact carrier publication and applied revision.
 * @throws {RetainedWorldSettlementInvalidError} If trace, revision, basis, carrier, or publication
 * evidence is absent, moved, malformed, forged, or inconsistent.
 * @throws {RetainedWorldSettlementConflictError} If another action owns the admission or terminal.
 *
 * @example
 * ```ts
 * const applied = await applyRetainedWorldSettlement({
 *     binding,
 *     carrier,
 *     outputId: captured.output.output_id,
 *     store,
 * });
 * applied.applied_revision_id;
 * ```
 *
 * @public
 */
export async function applyRetainedWorldSettlement(
    options: ApplyRetainedWorldSettlementOptions,
): Promise<AppliedRetainedWorldSettlement> {
    try {
        const fields = exactObject(options, ["binding", "carrier", "outputId", "store"]);
        if (typeof fields.outputId !== "string" || fields.outputId.length === 0) {
            throw new TypeError("retained-world settlement output identity is invalid");
        }
        const binding = fields.binding as ApplyRetainedWorldSettlementOptions["binding"];
        const carrier = fields.carrier as ReferenceCopyCarrier;
        const store = fields.store as SQLiteTraceStore;
        assertWorkspaceBinding(binding);
        if (isGitRepositoryBinding(binding)) assertCurrentGitRepositoryBinding(binding);
        assertReferenceCopyCarrier(carrier);
        const admission = inspectRetainedWorldSettlement(store, fields.outputId);
        if (admission === undefined) {
            throw new TypeError("retained-world apply admission is absent");
        }
        if (admission.action !== APPLY_ACTION) {
            throw new RetainedWorldSettlementConflictError(
                workspaceProtocolConfig.settlement.errors.conflictMessage,
            );
        }
        if (binding.binding_id !== admission.request.binding_id) {
            throw new TypeError("retained-world apply binding authority is inconsistent");
        }
        const base = await carrier.openRevision(admission.request.base_revision_id);
        const head = await carrier.openRevision(admission.request.head_revision_id);
        const evidence = await createVerifiedWorldChangeset({
            baseRevision: base,
            carrier,
            headRevision: head,
        });
        assertApplicationCandidatePathsAllowed(evidence.changeset.changed_paths, binding);
        let journal = store.readRetainedWorldSettlementJournal(fields.outputId);
        // Inspection above and this read share one store row; absence here requires store corruption.
        /* node:coverage ignore next 3 */
        if (journal === undefined) {
            throw new TypeError("retained-world apply journal is absent");
        }
        let applicationPlan: RetainedWorldApplicationPlanEvidence;
        let publicationEvidence: Awaited<ReturnType<typeof createVerifiedWorldChangeset>>;
        if (journal.state === PREPARED_STATE) {
            const current = await carrier.snapshot(binding);
            const currentEvidence = await createVerifiedWorldChangeset({
                baseRevision: base,
                carrier,
                headRevision: current,
            });
            assertRetainedWorldApplicationPathsDisjoint(
                evidence.changeset.changed_paths,
                currentEvidence.changeset.changed_paths,
            );
            let applicationCustodyId = admission.request.custody_id;
            let merged = head;
            if (current.content_id !== base.content_id) {
                const application = createReferenceCopyApplicationRevision(carrier, {
                    candidateChangeset: evidence.changeset,
                    currentRevisionId: current.revision_id,
                    operationKey: admission.request_id,
                });
                applicationCustodyId = application.custody.custody_id;
                merged = application.revision;
            }
            publicationEvidence = await createVerifiedWorldChangeset({
                baseRevision: current,
                carrier,
                headRevision: merged,
            });
            applicationPlan = encodeRetainedWorldApplicationPlan({
                application_custody_id: applicationCustodyId,
                base_content_id: base.content_id,
                base_revision_id: base.revision_id,
                binding_id: admission.request.binding_id,
                candidate_changeset_id: evidence.changeset.changeset_id,
                candidate_content_id: head.content_id,
                candidate_paths: evidence.changeset.changed_paths,
                candidate_revision_id: head.revision_id,
                current_changeset_id: currentEvidence.changeset.changeset_id,
                current_content_id: current.content_id,
                current_paths: currentEvidence.changeset.changed_paths,
                current_revision_id: current.revision_id,
                merged_content_id: merged.content_id,
                merged_revision_id: merged.revision_id,
                publication_changeset_id: publicationEvidence.changeset.changeset_id,
                reason: (current.content_id === base.content_id
                    ? workspaceProtocolConfig.settlement.application.reasonRoles.unmoved
                    : workspaceProtocolConfig.settlement.application.reasonRoles
                          .disjoint) as RetainedWorldApplicationPlanEvidence["reason"],
                request_id: admission.request_id,
                status: workspaceProtocolConfig.settlement.application
                    .statuses[0] as RetainedWorldApplicationPlanEvidence["status"],
            });
            assertApplicationPlanContract(
                applicationPlan,
                admission.request_id,
                evidence,
                currentEvidence,
                publicationEvidence,
            );
            journal = store.beginRetainedWorldSettlement(fields.outputId, applicationPlan);
        } else {
            // Every validated non-prepared journal state requires complete operation evidence.
            /* node:coverage ignore next 3 */
            if (journal.operation === null) {
                throw new TypeError("retained-world apply operation evidence is absent");
            }
            const retainedOperation = decodeRetainedWorldSettlementOperation(
                journal.operation.json,
                admission,
            );
            // The action-discriminated operation decoder requires an application plan for apply.
            /* node:coverage ignore next 3 */
            if (!("application_plan" in retainedOperation.value)) {
                throw new TypeError("retained-world apply plan evidence is absent");
            }
            applicationPlan = readRetainedWorldApplicationPlan(
                retainedOperation.value.application_plan,
            );
            const current = await carrier.openRevision(applicationPlan.current_revision_id);
            const merged = await carrier.openRevision(applicationPlan.merged_revision_id);
            const currentEvidence = await createVerifiedWorldChangeset({
                baseRevision: base,
                carrier,
                headRevision: current,
            });
            publicationEvidence = await createVerifiedWorldChangeset({
                baseRevision: current,
                carrier,
                headRevision: merged,
            });
            assertApplicationPlanContract(
                applicationPlan,
                admission.request_id,
                evidence,
                currentEvidence,
                publicationEvidence,
            );
        }
        /* The action-bound journal cannot contain another action's terminal state. */
        /* node:coverage ignore next 5 */
        if (journal.state !== APPLYING_STATE && journal.state !== APPLIED_STATE) {
            throw new RetainedWorldSettlementConflictError(
                workspaceProtocolConfig.settlement.errors.conflictMessage,
            );
        }
        // Both admitted states above require exact operation evidence from the closed store decoder.
        /* node:coverage ignore next 3 */
        if (journal.operation === null) {
            throw new TypeError("retained-world apply operation evidence is incomplete");
        }
        const operation = decodeRetainedWorldSettlementOperation(journal.operation.json, admission);
        /* The store decoder reconstructs this exact operation before returning. */
        /* node:coverage ignore next 8 */
        if (
            journal.operation.id !== operation.id ||
            journal.operation.digest !== operation.digest ||
            journal.operation.json !== operation.json
        ) {
            throw new TypeError("retained-world apply operation evidence is inconsistent");
        }
        const plan = encodeSelectionPublicationPlan(
            operation,
            publicationEvidence.changeset,
            publicationEvidence.baseRevision.content_id,
            publicationEvidence.headRevision.content_id,
        );
        const schedule = encodeSelectionPublicationSchedule(plan);
        const publication = await publishReferenceCopySelection(carrier, {
            changeset: publicationEvidence.changeset,
            observeUserBasis: async () => (await carrier.snapshot(binding)).content_id,
            operation,
            plan,
            schedule,
        });
        journal = store.retainRetainedWorldSettlementTerminal(fields.outputId, {
            action: APPLY_ACTION,
            applied_revision_id: applicationPlan.merged_revision_id,
            application_plan_id: applicationPlan.plan_id,
            publication_id: publication.id,
            user_basis_after: publication.value.user_basis_after,
        });
        /* The atomic store transition returns a freshly validated applied journal. */
        /* node:coverage ignore next 3 */
        if (journal.state !== APPLIED_STATE || journal.operation === null) {
            throw new TypeError("retained-world apply terminal evidence is incomplete");
        }
        publishTerminalSettlementCitation(store, journal);
        if (applicationPlan.application_custody_id !== admission.request.custody_id) {
            await carrier.discard(applicationPlan.application_custody_id);
        }
        return Object.freeze({
            action: APPLY_ACTION,
            applied_revision_id: applicationPlan.merged_revision_id,
            application_plan_id: applicationPlan.plan_id,
            operation_id: journal.operation.id,
            output_id: admission.output_id,
            publication_id: publication.id,
            plan_reason: applicationPlan.reason,
            plan_status: applicationPlan.status,
            request_id: admission.request_id,
            settlement_version: RETAINED_WORLD_SETTLEMENT_VERSION,
            state: APPLIED_STATE,
            user_basis_after: publication.value.user_basis_after,
        });
    } catch (error) {
        if (
            error instanceof RetainedWorldSettlementInvalidError ||
            error instanceof RetainedWorldSettlementConflictError ||
            error instanceof RetainedWorldApplicationConflictError
        ) {
            throw error;
        }
        throw new RetainedWorldSettlementInvalidError(
            workspaceProtocolConfig.settlement.errors.invalidMessage,
            { cause: error },
        );
    }
}

function assertApplicationPlanContract(
    plan: RetainedWorldApplicationPlanEvidence,
    requestId: string,
    candidate: Awaited<ReturnType<typeof createVerifiedWorldChangeset>>,
    current: Awaited<ReturnType<typeof createVerifiedWorldChangeset>>,
    publication: Awaited<ReturnType<typeof createVerifiedWorldChangeset>>,
): void {
    assertRetainedWorldApplicationPathsDisjoint(
        candidate.changeset.changed_paths,
        current.changeset.changed_paths,
    );
    const expected = encodeRetainedWorldApplicationPlan({
        application_custody_id: plan.application_custody_id,
        base_content_id: candidate.baseRevision.content_id,
        base_revision_id: candidate.baseRevision.revision_id,
        binding_id: candidate.baseRevision.binding_id,
        candidate_changeset_id: candidate.changeset.changeset_id,
        candidate_content_id: candidate.headRevision.content_id,
        candidate_paths: candidate.changeset.changed_paths,
        candidate_revision_id: candidate.headRevision.revision_id,
        current_changeset_id: current.changeset.changeset_id,
        current_content_id: current.headRevision.content_id,
        current_paths: current.changeset.changed_paths,
        current_revision_id: current.headRevision.revision_id,
        merged_content_id: publication.headRevision.content_id,
        merged_revision_id: publication.headRevision.revision_id,
        publication_changeset_id: publication.changeset.changeset_id,
        reason: plan.reason,
        request_id: requestId,
        status: plan.status,
    });
    // Content-addressed plans and authenticated revisions make disagreement reachable only through
    // a digest collision or an implementation defect after all public decoders have succeeded.
    /* node:coverage ignore next 12 */
    if (
        canonicalizeRecord({
            changes: candidate.changeset.changes as unknown as SemanticRecord["changes"],
        }) !==
            canonicalizeRecord({
                changes: publication.changeset.changes as unknown as SemanticRecord["changes"],
            }) ||
        canonicalizeRecord(plan as unknown as SemanticRecord) !==
            canonicalizeRecord(expected as unknown as SemanticRecord)
    ) {
        throw new TypeError("retained-world application plan evidence is inconsistent");
    }
}

function assertApplicationCandidatePathsAllowed(
    paths: readonly string[],
    binding: ApplyRetainedWorldSettlementOptions["binding"],
): void {
    if (
        "repository" in binding &&
        paths.some((candidatePath) =>
            candidatePath
                .split("/")
                .some((segment) => segment === workspaceProtocolConfig.gitMetadataName),
        )
    ) {
        throw new TypeError("retained-world application cannot modify Git administrative paths");
    }
}

/**
 * Durably discards one exact admitted retained output and recovers interrupted cleanup.
 *
 * This is the workspace-protocol-v13 settlement-effect boundary over an exact v12 request.
 *
 * The deterministic operation is retained before any carrier effect. The logical discarded
 * terminal receipt is retained before idempotent custody cleanup, so a restart can safely resume
 * either the pre-cleanup or post-cleanup prefix without reopening admission or touching user files.
 *
 * @param options - Exact output identity plus authenticated carrier and trace-store authority.
 * @returns Frozen completed discard receipt after durable cleanup completion.
 * @throws {RetainedWorldSettlementInvalidError} If trace, journal, revision, custody, or carrier
 * evidence is absent, malformed, forged, or inconsistent.
 * @throws {RetainedWorldSettlementConflictError} If the output was admitted for another action or
 * has already reached another terminal settlement.
 *
 * @example
 * ```ts
 * const discarded = await discardRetainedWorldSettlement({
 *     carrier,
 *     outputId: captured.output.output_id,
 *     store,
 * });
 * discarded.cleanup_completed;
 * ```
 *
 * @public
 */
export async function discardRetainedWorldSettlement(
    options: DiscardRetainedWorldSettlementOptions,
): Promise<DiscardedRetainedWorldSettlement> {
    try {
        const fields = exactObject(options, ["carrier", "outputId", "store"]);
        if (typeof fields.outputId !== "string" || fields.outputId.length === 0) {
            throw new TypeError("retained-world settlement output identity is invalid");
        }
        const carrier = fields.carrier as ReferenceCopyCarrier;
        const store = fields.store as SQLiteTraceStore;
        assertReferenceCopyCarrier(carrier);
        const admission = inspectRetainedWorldSettlement(store, fields.outputId);
        if (admission === undefined) {
            throw new TypeError("retained-world discard admission is absent");
        }
        if (admission.action !== DISCARD_ACTION) {
            throw new RetainedWorldSettlementConflictError(
                workspaceProtocolConfig.settlement.errors.conflictMessage,
            );
        }
        let journal = store.readRetainedWorldSettlementJournal(fields.outputId);
        if (journal === undefined) {
            throw new TypeError("retained-world discard journal is absent");
        }
        await verifyDiscardRevisions(carrier, admission.request);
        if (journal.state === PREPARED_STATE || journal.state === APPLYING_STATE) {
            await verifyDiscardCustody(carrier, admission.request);
        }
        if (journal.state === PREPARED_STATE) {
            journal = store.beginRetainedWorldSettlement(fields.outputId);
        }
        if (journal.state === APPLYING_STATE) {
            journal = store.retainRetainedWorldSettlementTerminal(fields.outputId, {
                action: DISCARD_ACTION,
                cleanup_completed: false,
                user_basis_after: admission.request.user_basis_before,
            });
        }
        // The validated closed journal and deterministic store transitions are exhaustive here.
        /* node:coverage ignore next 3 */
        if (journal.state !== DISCARDED_STATE || journal.operation === null) {
            throw new TypeError("retained-world discard journal is inconsistent");
        }
        if (!journal.cleanup_completed) {
            await carrier.discard(admission.request.custody_id);
            journal = store.completeRetainedWorldSettlementCleanup(fields.outputId);
        }
        // Cleanup completion returns a freshly revalidated discarded journal.
        /* node:coverage ignore next 7 */
        if (
            journal.state !== DISCARDED_STATE ||
            journal.operation === null ||
            !journal.cleanup_completed
        ) {
            throw new TypeError("retained-world discard cleanup is incomplete");
        }
        publishTerminalSettlementCitation(store, journal);
        return Object.freeze({
            action: DISCARD_ACTION,
            cleanup_completed: true,
            operation_id: journal.operation.id,
            output_id: admission.output_id,
            request_id: admission.request_id,
            settlement_version: RETAINED_WORLD_SETTLEMENT_VERSION,
            state: DISCARDED_STATE,
        });
    } catch (error) {
        if (
            error instanceof RetainedWorldSettlementInvalidError ||
            error instanceof RetainedWorldSettlementConflictError
        ) {
            throw error;
        }
        throw new RetainedWorldSettlementInvalidError(
            workspaceProtocolConfig.settlement.errors.invalidMessage,
            { cause: error },
        );
    }
}

function publishTerminalSettlementCitation(
    store: SQLiteTraceStore,
    journal: RetainedWorldSettlementJournal,
): void {
    const recovery = readDurableTaskExecution(store, journal.admission.request.run_id);
    // A settlement journal can exist only for an authenticated committed retained output.
    /* node:coverage ignore next 3 */
    if (recovery.status !== COMMITTED_RECOVERY_STATUS) {
        throw new TypeError("retained-world citation execution is not committed");
    }
    const ledger = recovery.result.ledger;
    publishRetainedWorldSettlementCitation(store, journal, {
        capture_record_id: journal.admission.request.capture_record_id,
        execution_cut_id: ledger.cut.cut_id,
        outcome_record_id: ledger.outcome_record_id,
        run_id: journal.admission.request.run_id,
        terminal_record_id: ledger.lifecycle_record_id,
    });
}

async function verifyDiscardRevisions(
    carrier: ReferenceCopyCarrier,
    request: RetainedWorldSettlementRequest,
): Promise<void> {
    const base = await carrier.openRevision(request.base_revision_id);
    const head = await carrier.openRevision(request.head_revision_id);
    // Authenticated content-addressed carrier reads reject these contradictions first.
    /* node:coverage ignore next 7 */
    if (
        base.binding_id !== request.binding_id ||
        head.binding_id !== request.binding_id ||
        head.parent_revision_id !== request.base_revision_id
    ) {
        throw new TypeError("retained-world discard revision evidence is inconsistent");
    }
}

async function verifyDiscardCustody(
    carrier: ReferenceCopyCarrier,
    request: RetainedWorldSettlementRequest,
): Promise<void> {
    const custody = await carrier.openCustody(request.custody_id);
    const head = await carrier.openRevision(request.head_revision_id);
    const verification = await carrier.verifyCustody(request.custody_id);
    // Authenticated content-addressed carrier reads reject these contradictions first.
    /* node:coverage ignore next 7 */
    if (
        custody.binding_id !== request.binding_id ||
        custody.base_revision_id !== request.base_revision_id ||
        verification.content_id !== head.content_id
    ) {
        throw new TypeError("retained-world discard custody evidence is inconsistent");
    }
}

function assertRevisionContract(
    base: WorldRevision,
    head: WorldRevision,
    output: RetainedWorldOutput,
): void {
    // Retained carrier verification normally rejects these descriptor contradictions first.
    /* node:coverage ignore next 10 */
    if (
        base.binding_id !== output.binding_id ||
        base.content_id !== output.user_basis_before ||
        head.binding_id !== output.binding_id ||
        head.parent_revision_id !== base.revision_id
    ) {
        throw new TypeError("retained-world revision evidence is inconsistent");
    }
}

function readOutput(value: unknown): RetainedWorldOutput {
    const fields = exactObject(value, [
        "base_revision_id",
        "binding_id",
        "capture_id",
        "capture_record_id",
        "custody_id",
        "changeset_id",
        "execution_cut",
        "execution_outcome_record_id",
        "head_revision_id",
        "output_id",
        "run_id",
        "schema_version",
        "status",
        "user_basis_after",
        "user_basis_before",
    ]);
    const cut = exactObject(fields.execution_cut, [
        "created_by_record_id",
        "cut_id",
        "publisher_owner_id",
        "target_owner_id",
        "through_owner_ordinal",
        "through_record_id",
    ]);
    const output = Object.freeze({
        ...fields,
        execution_cut: Object.freeze({ ...cut }),
    }) as unknown as RetainedWorldOutput;
    if (
        output.schema_version !== workspaceProtocolConfig.worldTaskCapture.version ||
        output.status !== workspaceProtocolConfig.worldTaskCapture.statuses[0]
    ) {
        throw new TypeError("retained-world output contract is unsupported");
    }
    const textFields = [
        "base_revision_id",
        "binding_id",
        "capture_id",
        "capture_record_id",
        "custody_id",
        "changeset_id",
        "execution_outcome_record_id",
        "head_revision_id",
        "output_id",
        "run_id",
        "user_basis_after",
        "user_basis_before",
    ] as const;
    if (
        textFields.some((field) => typeof output[field] !== "string" || output[field].length === 0)
    ) {
        throw new TypeError("retained-world output identity is invalid");
    }
    return output;
}

function outputBody(output: RetainedWorldOutput): SemanticRecord {
    return {
        base_revision_id: output.base_revision_id,
        binding_id: output.binding_id,
        capture_id: output.capture_id,
        changeset_id: output.changeset_id,
        custody_id: output.custody_id,
        head_revision_id: output.head_revision_id,
        output_id: output.output_id,
        run_id: output.run_id,
        schema_version: output.schema_version,
        status: output.status,
        user_basis_after: output.user_basis_after,
        user_basis_before: output.user_basis_before,
    };
}

function exactObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
    if (
        value === null ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    ) {
        throw new TypeError("retained-world settlement input must be exact data");
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const ownKeys = Reflect.ownKeys(descriptors);
    const expected = [...keys].sort();
    if (
        ownKeys.some((key) => typeof key !== "string") ||
        ownKeys.length !== expected.length ||
        (ownKeys as string[]).sort().some((key, index) => key !== expected[index]) ||
        (ownKeys as string[]).some((key) => !("value" in (descriptors[key] as PropertyDescriptor)))
    ) {
        throw new TypeError("retained-world settlement input must be exact data");
    }
    return Object.fromEntries(
        keys.map((key) => [key, (descriptors[key] as PropertyDescriptor).value]),
    );
}
