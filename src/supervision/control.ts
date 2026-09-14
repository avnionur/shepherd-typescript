import { kernelProtocolConfig, supervisionProtocolConfig } from "../protocol/config.ts";
import { RECORD_MODES, SUPERVISION_APPROVAL_VERDICTS } from "../protocol/values.generated.ts";
import { assertRecordId } from "../record/guards.ts";
import { ROOT_WITNESS_ID } from "../record/root-witness.ts";
import type { RecordBody, RecordId } from "../record/types.ts";
import { assertPrefixedDigest, assertScopeText, readScopeDataObject } from "../scope/validation.ts";
import type { SQLiteTraceStore } from "../store/sqlite-trace-store.ts";
import type { AppendReceipt, StoreAppendRequest } from "../store/types.ts";
import { foldSupervisedDispatch } from "./dispatch-state.ts";
import { SupervisionEvidenceError } from "./errors.ts";
import {
    assertOrdinal,
    createSupervisedDispatchId,
    createSupervisionAppendIntentId,
    createSupervisionApprovalVerdictBody,
    createSupervisionContextBody,
    createSupervisionContextChannelId,
    readSupervisionCitations,
    readSupervisionContextBody,
    readSupervisionData,
    readSupervisionReason,
} from "./records.ts";
import type {
    InjectSupervisionContextOptions,
    InspectSupervisedDispatchOptions,
    ReadSupervisionContextOptions,
    ResolveSupervisedApprovalOptions,
    SupervisedApprovalReceipt,
    SupervisedDispatchInspection,
    SupervisionContextInjection,
} from "./types.ts";

const config = supervisionProtocolConfig;
const [CAPTURE_MODE] = RECORD_MODES;
const [APPROVED_VERDICT, REJECTED_VERDICT] = SUPERVISION_APPROVAL_VERDICTS;

/**
 * Derives the dispatch identity and owner path of one supervised dispatch command.
 *
 * Observers use it to subscribe to a dispatch before or while it runs.
 *
 * @param commandId - Dispatch command identity.
 * @returns The configured content-addressed dispatch identity.
 * @throws {TypeError} If the command identity is empty or malformed.
 */
export function deriveSupervisedDispatchId(commandId: string): string {
    return createSupervisedDispatchId(commandId);
}

/**
 * Derives the owner path of one named context channel.
 *
 * @param channel - Caller-selected channel name.
 * @returns The configured content-addressed channel identity.
 * @throws {TypeError} If the channel name is empty or malformed.
 */
export function deriveSupervisionContextChannelId(channel: string): string {
    return createSupervisionContextChannelId(channel);
}

/**
 * Reads and validates one supervised dispatch without mutation.
 *
 * Works on reopened, read-only, and imported stores. Imported dispatches report no lease.
 *
 * @param store - Open trace store.
 * @param options - Exact dispatch identity.
 * @returns The frozen validated dispatch inspection with its recovery classification.
 * @throws {SupervisionEvidenceError} If the dispatch is absent or its evidence is inconsistent.
 * @throws {TraceStoreError} If the store is closed.
 * @throws {TypeError} If options are malformed.
 */
export function inspectSupervisedDispatch(
    store: SQLiteTraceStore,
    options: InspectSupervisedDispatchOptions,
): SupervisedDispatchInspection {
    const fields = readScopeDataObject(
        options,
        ["dispatchId"],
        "inspectSupervisedDispatch options",
    );
    assertPrefixedDigest(fields.dispatchId, config.identity.dispatchIdPrefix, "dispatchId");
    return foldSupervisedDispatch(
        fields.dispatchId as string,
        store.readOwner(fields.dispatchId as string),
        store.readSupervisedDispatch(fields.dispatchId as string),
    ).inspection;
}

/**
 * Appends one human approval verdict for the exact pending request of a supervised dispatch.
 *
 * The verdict is accepted only while the request is the dispatch head, so a verdict and the
 * dispatcher's expiry race with exactly one winner. An exact retry of the same command returns the
 * original receipt, even after the dispatch resolved. Verdicts never extend the dispatcher lease.
 *
 * @param store - Open writable trace store holding the live dispatch.
 * @param options - Verdict command, dispatch, exact request, verdict, approver, and reason.
 * @returns Frozen verdict receipt.
 * @throws {SupervisionApprovalConflictError} If the request is not pending at the head.
 * @throws {SupervisionEvidenceError} If the dispatch is not registered in this store.
 * @throws {AppendIntentConflictError} If the command already names different content.
 * @throws {TraceStoreError} If the store is closed.
 * @throws {TypeError} If options are malformed.
 *
 * @example
 * ```ts
 * const inspection = inspectSupervisedDispatch(store, { dispatchId });
 * resolveSupervisedApproval(store, {
 *     approverId: "reviewer@example.com",
 *     commandId: "approval:1",
 *     dispatchId,
 *     requestRecordId: inspection.pending_approval.request_record_id,
 *     verdict: "approved",
 * });
 * ```
 */
export function resolveSupervisedApproval(
    store: SQLiteTraceStore,
    options: ResolveSupervisedApprovalOptions,
): SupervisedApprovalReceipt {
    const fields = readScopeDataObject(
        options,
        ["approverId", "commandId", "dispatchId", "requestRecordId", "verdict"],
        "resolveSupervisedApproval options",
        ["reason"],
    );
    assertScopeText(fields.approverId, "approverId");
    assertScopeText(fields.commandId, "commandId");
    assertPrefixedDigest(fields.dispatchId, config.identity.dispatchIdPrefix, "dispatchId");
    assertRecordId(fields.requestRecordId, "requestRecordId");
    if (fields.verdict !== APPROVED_VERDICT && fields.verdict !== REJECTED_VERDICT) {
        throw new TypeError("verdict must be approved or rejected");
    }
    const dispatchId = fields.dispatchId as string;
    const body = createSupervisionApprovalVerdictBody({
        approverId: fields.approverId,
        commandId: fields.commandId,
        dispatchId,
        reason: fields.reason === undefined ? null : readSupervisionReason(fields.reason, false),
        requestRecordId: fields.requestRecordId,
        verdict: fields.verdict,
    });
    const receipt = store.resolveSupervisedApproval(
        dispatchId,
        fields.requestRecordId,
        appendRequest(fields.commandId, dispatchId, body, config.traceSchemas.approval, [
            fields.requestRecordId,
        ]),
    );
    return Object.freeze({
        command_id: fields.commandId,
        dispatch_id: dispatchId,
        owner_ordinal: ordinal(receipt, dispatchId),
        record_id: receipt.record_ids[0] as RecordId,
        request_record_id: fields.requestRecordId,
        verdict: fields.verdict,
    });
}

/**
 * Appends validated application context to a named channel, citing retained records.
 *
 * Every cited record becomes a causal parent of the injection, so injected context is always
 * linked to its trace evidence. Workers consume context by reading the channel and citing
 * injection records when they dispatch effects. An exact retry returns the original receipt.
 *
 * @param store - Open writable trace store.
 * @param options - Command, channel, supervisor, data, and at least one retained citation.
 * @returns The frozen retained injection.
 * @throws {SupervisionEvidenceError} If a cited record is not retained.
 * @throws {AppendIntentConflictError} If the command already names different content.
 * @throws {TraceStoreError} If the store is closed.
 * @throws {TypeError} If options are malformed, uncited, or exceed configured bounds.
 */
export function injectSupervisionContext(
    store: SQLiteTraceStore,
    options: InjectSupervisionContextOptions,
): SupervisionContextInjection {
    const fields = readScopeDataObject(
        options,
        ["channel", "citedRecordIds", "commandId", "data", "supervisorId"],
        "injectSupervisionContext options",
    );
    assertScopeText(fields.commandId, "commandId");
    assertScopeText(fields.supervisorId, "supervisorId");
    const channelId = createSupervisionContextChannelId(fields.channel as string);
    const citedRecordIds = readSupervisionCitations(fields.citedRecordIds, "context", true);
    const data = readSupervisionData(fields.data);
    const body = createSupervisionContextBody({
        channelId,
        citedRecordIds,
        commandId: fields.commandId,
        data,
        supervisorId: fields.supervisorId,
    });
    const receipt = store.injectSupervisionContext(
        citedRecordIds,
        appendRequest(
            fields.commandId,
            channelId,
            body,
            config.traceSchemas.context,
            citedRecordIds,
        ),
    );
    return Object.freeze({
        channel_id: channelId,
        cited_record_ids: citedRecordIds,
        command_id: fields.commandId,
        data,
        owner_ordinal: ordinal(receipt, channelId),
        record_id: receipt.record_ids[0] as RecordId,
        supervisor_id: fields.supervisorId,
    });
}

/**
 * Reads validated context injections from a named channel in owner order.
 *
 * @param store - Open trace store.
 * @param options - Channel name and optional exclusive owner-ordinal lower bound.
 * @returns Frozen injections after the bound.
 * @throws {SupervisionEvidenceError} If retained channel evidence is malformed or inconsistent.
 * @throws {TraceStoreError} If the store is closed.
 * @throws {TypeError} If options are malformed.
 */
export function readSupervisionContext(
    store: SQLiteTraceStore,
    options: ReadSupervisionContextOptions,
): readonly SupervisionContextInjection[] {
    const fields = readScopeDataObject(options, ["channel"], "readSupervisionContext options", [
        "afterOwnerOrdinal",
    ]);
    const channelId = createSupervisionContextChannelId(fields.channel as string);
    if (fields.afterOwnerOrdinal !== undefined) {
        assertOrdinal(fields.afterOwnerOrdinal, "afterOwnerOrdinal", false);
    }
    const after = (fields.afterOwnerOrdinal ??
        kernelProtocolConfig.append.firstOwnerOrdinal - 1) as number;
    return Object.freeze(
        store
            .readOwner(channelId)
            .filter((record) => record.view.owner_ordinal > after)
            .map((record) => {
                const body =
                    record.envelope.schema_ref === config.traceSchemas.context
                        ? readSupervisionContextBody(record.body)
                        : undefined;
                if (
                    body === undefined ||
                    body.channel_id !== channelId ||
                    record.envelope.caused_by_record_ids.join("\0") !==
                        body.cited_record_ids.join("\0")
                ) {
                    throw new SupervisionEvidenceError(
                        `context channel ${channelId} retains inconsistent evidence`,
                    );
                }
                return Object.freeze({
                    channel_id: channelId,
                    cited_record_ids: body.cited_record_ids,
                    command_id: body.command_id,
                    data: body.data,
                    owner_ordinal: record.view.owner_ordinal,
                    record_id: record.envelope.record_id,
                    supervisor_id: body.supervisor_id,
                });
            }),
    );
}

function appendRequest(
    commandId: string,
    ownerId: string,
    body: RecordBody,
    schemaRef: string,
    causes: readonly RecordId[],
): StoreAppendRequest {
    return {
        append_intent_id: createSupervisionAppendIntentId(commandId, ownerId),
        batch: {
            groups: [
                {
                    owner_id: ownerId,
                    records: [
                        {
                            body,
                            caused_by_record_ids: causes,
                            mode: CAPTURE_MODE,
                            schema_ref: schemaRef,
                            witness_ref: ROOT_WITNESS_ID,
                        },
                    ],
                },
            ],
        },
    };
}

function ordinal(receipt: AppendReceipt, ownerId: string): number {
    const range = receipt.owner_ordinal_ranges.get(ownerId) as readonly [number, number];
    return range[0];
}
