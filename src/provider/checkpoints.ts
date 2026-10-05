import {
    canonicalizeRecord,
    createRecordId,
    type SemanticRecord,
    type SemanticValue,
} from "../canonical/canonical-record.ts";
import { createCanonicalSnapshot } from "../canonical/snapshot.ts";
import {
    providerProtocolConfig,
    recordIdConfig,
    replayProtocolConfig,
    supervisionProtocolConfig,
} from "../protocol/config.ts";
import { MODEL_MESSAGE_ROLES, RECORD_MODES } from "../protocol/values.generated.ts";
import { createRecordEnvelope } from "../record/envelope.ts";
import { assertRecordId } from "../record/guards.ts";
import { ROOT_WITNESS_ID } from "../record/root-witness.ts";
import type { RecordBody } from "../record/types.ts";
import {
    assertPrefixedDigest,
    assertScopeText,
    readScopeArray,
    readScopeDataObject,
} from "../scope/validation.ts";
import type { SQLiteTraceStore } from "../store/sqlite-trace-store.ts";
import {
    createSupervisionContextBody,
    createSupervisionContextChannelId,
    readSupervisionContextBody,
} from "../supervision/records.ts";
import type {
    ProviderConversationCheckpointBinding,
    ProviderConversationCheckpointReceipt,
    ProviderConversationCheckpointState,
    ReadProviderConversationCheckpointOptions,
    RetainProviderConversationCheckpointOptions,
} from "./checkpoint-types.ts";
import { isWellFormedText, readModelMessage, readToolDefinitions } from "./messages.ts";
import type { ProviderDescriptor } from "./types.ts";
import { readProviderDescriptor } from "./validation.ts";

const config = providerProtocolConfig.conversation.checkpoint;
const [CAPTURE] = RECORD_MODES;
const [USER] = MODEL_MESSAGE_ROLES;

/**
 * Retains exact conversation prefix data as one content-addressed context record.
 * Equal snapshots deduplicate. Provider credentials, transport handles and server-side cache state
 * are not accepted fields. The host owns the accuracy of its declared configuration identity.
 * @param store - Writable canonical trace store; its secret-scanning policy applies before append.
 * @param options - Provider/configuration binding and complete message/system/tool prefix.
 * @returns Stable receipt and causal record identity preserved across reopen/import.
 * @throws {TypeError} If data is malformed or exceeds configured bounds.
 * @throws {TraceStoreError} If the store is closed, read-only or cannot commit.
 * @throws {TraceSecretDetectedError} If configured secret scanning refuses the snapshot.
 * @example
 * ```ts
 * const receipt = retainProviderConversationCheckpoint(store, { ...binding, state });
 * ```
 */
export function retainProviderConversationCheckpoint(
    store: SQLiteTraceStore,
    options: RetainProviderConversationCheckpointOptions,
): ProviderConversationCheckpointReceipt {
    const fields = readScopeDataObject(
        options,
        ["adapterId", "configurationId", "provider", "state"],
        "provider checkpoint capture",
    );
    const binding = readBinding(fields);
    const state = readState(fields.state);
    const body = {
        adapter_id: binding.adapterId,
        configuration_id: binding.configurationId,
        provider: binding.provider as unknown as SemanticRecord,
        context_prefix_id: state.contextPrefixId,
        messages: state.messages as unknown as SemanticValue,
        system: state.system,
        tools: state.tools as unknown as SemanticValue,
        compatibility_version: config.compatibilityVersion,
        record_version: config.recordVersion,
    } satisfies RecordBody;
    boundBody(body);
    const payloadId = createRecordId(body);
    const commandId = createRecordId({ [config.appendIntentKind]: payloadId });
    const channelId = createSupervisionContextChannelId(config.channelPrefix + payloadId);
    const contextBody = createSupervisionContextBody({
        channelId,
        commandId,
        data: body,
        supervisorId: binding.adapterId,
        citedRecordIds: [ROOT_WITNESS_ID],
    });
    const draft = {
        body: contextBody,
        mode: CAPTURE,
        schema_ref: supervisionProtocolConfig.traceSchemas.context,
        witness_ref: ROOT_WITNESS_ID,
        caused_by_record_ids: [ROOT_WITNESS_ID],
    };
    const envelope = createRecordEnvelope(draft);
    store.injectSupervisionContext([ROOT_WITNESS_ID], {
        append_intent_id: commandId,
        batch: { groups: [{ owner_id: channelId, records: [draft] }] },
    });
    return Object.freeze({
        receiptId: config.receiptIdPrefix + envelope.record_id.slice(recordIdConfig.prefix.length),
        recordId: envelope.record_id,
    });
}

/**
 * Validates the retained content identity, schema, provider/configuration and exact context before
 * returning immutable prefix data. It invokes no provider, performs no reconstruction and writes nothing.
 * @param store - Open store, including read-only or native-imported stores.
 * @param options - Exact receipt and expected provider/configuration/context binding.
 * @returns Exact ordered message, system and tool prefix data.
 * @throws {TypeError} If the receipt is missing, corrupt, incompatible or outside configured bounds.
 * @throws {TraceStoreError} If the store is closed or unreadable.
 * @example
 * ```ts
 * const state = readProviderConversationCheckpoint(store, { ...binding, receiptId, contextPrefixId });
 * ```
 */
export function readProviderConversationCheckpoint(
    store: SQLiteTraceStore,
    options: ReadProviderConversationCheckpointOptions,
): ProviderConversationCheckpointState {
    const fields = readScopeDataObject(
        options,
        ["adapterId", "configurationId", "provider", "receiptId", "contextPrefixId"],
        "provider checkpoint read",
    );
    const binding = readBinding(fields);
    assertPrefixedDigest(fields.receiptId, config.receiptIdPrefix, "provider checkpoint receipt");
    const recordId =
        recordIdConfig.prefix + (fields.receiptId as string).slice(config.receiptIdPrefix.length);
    const record = store.readRecord(recordId);
    if (record === undefined) throw new TypeError("provider checkpoint snapshot is missing");
    const context = readCheckpointContext(record.body);
    const body = readScopeDataObject(
        context.data,
        [
            "adapter_id",
            "configuration_id",
            "provider",
            "context_prefix_id",
            "messages",
            "system",
            "tools",
            "compatibility_version",
            "record_version",
        ],
        "provider checkpoint record",
    );
    if (
        body.compatibility_version !== config.compatibilityVersion ||
        body.record_version !== config.recordVersion
    )
        throw new TypeError("provider checkpoint schema version is incompatible");
    const payloadId = createRecordId(context.data);
    const channelId = createSupervisionContextChannelId(config.channelPrefix + payloadId);
    const envelope = createRecordEnvelope({
        body: createSupervisionContextBody({
            channelId,
            commandId: createRecordId({ [config.appendIntentKind]: payloadId }),
            data: context.data,
            supervisorId: body.adapter_id as string,
            citedRecordIds: [ROOT_WITNESS_ID],
        }),
        schema_ref: supervisionProtocolConfig.traceSchemas.context,
        mode: CAPTURE,
        witness_ref: ROOT_WITNESS_ID,
        caused_by_record_ids: [ROOT_WITNESS_ID],
    });
    if (
        canonicalizeRecord(envelope as unknown as SemanticRecord) !==
            canonicalizeRecord(record.envelope as unknown as SemanticRecord) ||
        !record.views.some((view) => view.owner_id === channelId)
    )
        throw new TypeError("provider checkpoint snapshot identity is corrupt");
    if (
        body.adapter_id !== binding.adapterId ||
        body.configuration_id !== binding.configurationId ||
        canonicalizeRecord(readProviderDescriptor(body.provider) as unknown as SemanticRecord) !==
            canonicalizeRecord(binding.provider as unknown as SemanticRecord)
    )
        throw new TypeError("provider checkpoint provider or configuration is incompatible");
    const state = readState({
        contextPrefixId: body.context_prefix_id,
        messages: body.messages,
        system: body.system,
        tools: body.tools,
    });
    if (state.contextPrefixId !== fields.contextPrefixId)
        throw new TypeError("provider checkpoint context identity is incompatible");
    return state;
}

function readBinding(fields: Record<string, unknown>): ProviderConversationCheckpointBinding {
    for (const key of ["adapterId", "configurationId"] as const) {
        assertScopeText(fields[key], `provider checkpoint ${key}`);
        if (Buffer.byteLength(fields[key], "utf8") > config.limits.maxIdentityBytes)
            throw new TypeError("provider checkpoint identity exceeds configured bounds");
    }
    return {
        adapterId: fields.adapterId as string,
        configurationId: fields.configurationId as string,
        provider: readProviderDescriptor(fields.provider),
    };
}

function readState(value: unknown): ProviderConversationCheckpointState {
    // Canonicalization rejects accessors and non-data members before nested message readers run.
    boundBody(value as SemanticRecord);
    const state = createCanonicalSnapshot(value as SemanticRecord);
    const fields = readScopeDataObject(
        state,
        ["contextPrefixId", "messages", "system", "tools"],
        "provider checkpoint state",
    );
    if (fields.contextPrefixId !== null)
        assertPrefixedDigest(
            fields.contextPrefixId,
            replayProtocolConfig.identity.contextPrefixIdPrefix,
            "provider checkpoint context",
        );
    const messages = readScopeArray(fields.messages, "provider checkpoint messages");
    const tools = readScopeArray(fields.tools, "provider checkpoint tools");
    if (messages.length > config.limits.maxMessages || tools.length > config.limits.maxTools)
        throw new TypeError("provider checkpoint prefix exceeds configured bounds");
    const parsed = messages.map((message, index) =>
        readModelMessage(message, `provider checkpoint message ${index}`),
    );
    if (parsed.length > 0 && parsed[0]?.role !== USER)
        throw new TypeError("provider checkpoint messages must start with a user message");
    if (fields.system !== null && !isWellFormedText(fields.system))
        throw new TypeError("provider checkpoint system must be nonempty text or null");
    return createCanonicalSnapshot({
        contextPrefixId: fields.contextPrefixId,
        messages: parsed,
        system: fields.system,
        tools: readToolDefinitions(tools),
    } as unknown as SemanticRecord) as unknown as ProviderConversationCheckpointState;
}

function boundBody(body: SemanticRecord): void {
    if (
        Buffer.byteLength(canonicalizeRecord(body), "utf8") >
        supervisionProtocolConfig.limits.maxDataCanonicalBytes
    )
        throw new TypeError("provider checkpoint exceeds configured canonical byte bounds");
}

/** Validates an optional retained provider reference in a replay constituent. @internal */
export function validateProviderConversationCheckpointEvidence(
    store: SQLiteTraceStore,
    options: {
        readonly snapshotRecordId: unknown;
        readonly receiptId: string;
        readonly adapterId: string;
        readonly contextPrefixId: string | null;
        readonly provider: ProviderDescriptor | null;
    },
): void {
    const retained = options.receiptId.startsWith(config.receiptIdPrefix);
    if (!retained && options.snapshotRecordId === undefined) return;
    assertRecordId(options.snapshotRecordId, "provider checkpoint snapshot reference");
    if (
        !retained ||
        options.receiptId !==
            config.receiptIdPrefix + options.snapshotRecordId.slice(recordIdConfig.prefix.length)
    )
        throw new TypeError("provider checkpoint receipt and snapshot reference disagree");
    const snapshot = store.readRecord(options.snapshotRecordId);
    if (snapshot === undefined)
        throw new TypeError("provider checkpoint snapshot is missing from the replay store");
    const payload = readCheckpointContext(snapshot.body).data;
    const provider = readProviderDescriptor(payload.provider);
    if (
        options.provider !== null &&
        canonicalizeRecord(provider as unknown as SemanticRecord) !==
            canonicalizeRecord(options.provider as unknown as SemanticRecord)
    )
        throw new TypeError("provider checkpoint belongs to another replay provider");
    assertScopeText(payload.configuration_id, "provider checkpoint configuration");
    readProviderConversationCheckpoint(store, {
        adapterId: options.adapterId,
        configurationId: payload.configuration_id,
        provider,
        receiptId: options.receiptId,
        contextPrefixId: options.contextPrefixId,
    });
}

function readCheckpointContext(body: RecordBody): ReturnType<typeof readSupervisionContextBody> {
    try {
        return readSupervisionContextBody(body);
    } catch (error) {
        throw new TypeError("provider checkpoint context envelope is malformed", { cause: error });
    }
}
