import {
    canonicalizeRecord,
    createRecordId,
    type SemanticRecord,
} from "../canonical/canonical-record.ts";
import { providerProtocolConfig, recordIdConfig } from "../protocol/config.ts";
import { REPLAY_CHECKPOINT_EVIDENCE_STATUSES } from "../protocol/values.generated.ts";
import {
    createReplayContextPrefixId,
    createReplayFailure,
    createReplayPromptId,
    createReplayResponseId,
} from "../replay/records.ts";
import type {
    ReplayProviderSessionAdapter,
    ReplayProviderSessionCheckpointContext,
    ReplayProviderSessionEvidence,
    ReplayStepInspection,
} from "../replay/types.ts";
import type { SQLiteTraceStore } from "../store/sqlite-trace-store.ts";
import {
    readProviderConversationCheckpoint,
    retainProviderConversationCheckpoint,
} from "./checkpoints.ts";
import { readProviderConfiguration } from "./configuration-identity.ts";
import {
    isWellFormedText,
    renderModelOutputMessage,
    renderModelRequestMessage,
} from "./messages.ts";
import type {
    ModelMessage,
    ModelRequest,
    ModelResponse,
    ProviderConversation,
    ProviderConversationDefinition,
    ProviderDescriptor,
} from "./types.ts";
import {
    readModelRequest,
    readModelResponse,
    readProviderDescriptor,
    readProviderSignal,
} from "./validation.ts";

const identity = providerProtocolConfig.conversation;
const [VERIFIED] = REPLAY_CHECKPOINT_EVIDENCE_STATUSES;

type ConversationState = {
    readonly contextPrefixId: string | null;
    readonly messages: readonly ModelMessage[];
};

/**
 * Creates a stateful multi-turn conversation over a conversational provider, together with the
 * replay provider-session adapter that captures and restores it.
 *
 * Each `provider.invoke(request)` renders the request as the next user message, sends the held
 * conversation plus that message with the whole list as the cacheable prefix, and on success
 * appends the canonical rendering of the output as the assistant message. Held messages are pure
 * functions of retained requests and outputs, so a conversation restored after a rewind, or
 * rebuilt from retained steps, sends a byte-identical message prefix and the provider's prompt
 * cache can serve it. The conversation mirrors the replay session's chained context prefix
 * identity, including failed exchanges, so checkpoint evidence can be verified.
 *
 * With `checkpointStore`, the session adapter retains a content-addressed snapshot of messages
 * and system data and validates its provider/configuration binding before restoring after restart
 * or native import. This opts into retaining the system prompt under the store's context policy.
 * Without that option, receipts remain process-local; `rebuild` reconstructs from retained steps.
 *
 * @param definition - Provider, adapter identity, optional system and durable checkpoint binding.
 * @returns The conversation handle.
 * @throws {TypeError} If the definition is malformed.
 *
 * @example
 * ```ts
 * const conversation = createProviderConversation({ adapterId: "claude-session", provider });
 * await runReplaySession(store, {
 *     ...options,
 *     provider: conversation.provider,
 *     providerSession: conversation.session,
 * });
 * ```
 *
 * @public
 */
export function createProviderConversation(
    definition: ProviderConversationDefinition,
): ProviderConversation {
    const { adapterId, provider, system, checkpointStore, configurationId } =
        readDefinition(definition);
    let state: ConversationState = Object.freeze({ contextPrefixId: null, messages: [] });
    let pending = false;
    const receipts = new Map<string, ConversationState>();
    const descriptor =
        checkpointStore === undefined ? null : readProviderDescriptor(provider.descriptor());
    const factoryConfiguration = readProviderConfiguration(provider);
    if (
        checkpointStore !== undefined &&
        factoryConfiguration === undefined &&
        configurationId === undefined
    )
        throw new TypeError(
            "retained conversation requires an explicit custom provider configurationId",
        );
    const binding =
        descriptor === null
            ? null
            : Object.freeze({
                  adapterId,
                  provider: descriptor,
                  configurationId:
                      identity.checkpoint.configurationIdPrefix +
                      createRecordId({
                          provider: descriptor as unknown as SemanticRecord,
                          factory: factoryConfiguration ?? null,
                          declared: configurationId ?? null,
                          system,
                          format: identity.checkpoint.compatibilityVersion,
                      }).slice(recordIdConfig.prefix.length),
              });
    const assertConfiguration = () => {
        if (
            binding !== null &&
            canonicalizeRecord(
                readProviderDescriptor(provider.descriptor()) as unknown as SemanticRecord,
            ) !== canonicalizeRecord(binding.provider as unknown as SemanticRecord)
        )
            throw new TypeError("provider conversation configuration changed after construction");
    };
    const readRetained = (
        receiptId: string,
        context: ReplayProviderSessionCheckpointContext,
    ): ConversationState => {
        if (pending) throw new TypeError("provider conversation cannot restore during a turn");
        assertConfiguration();
        const retained = readProviderConversationCheckpoint(checkpointStore as SQLiteTraceStore, {
            ...(binding as NonNullable<typeof binding>),
            receiptId,
            contextPrefixId: context.context_prefix_id,
        });
        if (retained.system !== system || retained.tools.length !== 0)
            throw new TypeError(
                "provider conversation snapshot prefix configuration is incompatible",
            );
        return Object.freeze({
            contextPrefixId: retained.contextPrefixId,
            messages: retained.messages,
        });
    };
    const advance = (
        request: ModelRequest,
        response: Parameters<typeof createReplayResponseId>[0],
        messages: readonly ModelMessage[],
    ) => {
        state = Object.freeze({
            contextPrefixId: createReplayContextPrefixId(
                state.contextPrefixId,
                createReplayPromptId(request),
                createReplayResponseId(response),
            ),
            messages,
        });
    };
    const session: ReplayProviderSessionAdapter = Object.freeze({
        adapterId,
        cacheIdentity: (_request: ModelRequest, contextPrefixId: string | null) =>
            contextPrefixId === state.contextPrefixId
                ? prefixed(identity.cacheIdentityPrefix, {
                      provider_prefix: {
                          messages: state.messages as unknown as SemanticRecord[],
                          system,
                      },
                  })
                : null,
        ...(checkpointStore === undefined
            ? {}
            : {
                  validateReceipt: (
                      receiptId: string,
                      context: ReplayProviderSessionCheckpointContext,
                  ) => {
                      readRetained(receiptId, context);
                  },
              }),
        checkpoint: (
            context: ReplayProviderSessionCheckpointContext,
        ): ReplayProviderSessionEvidence => {
            if (checkpointStore !== undefined) {
                assertConfiguration();
                if (context.context_prefix_id !== state.contextPrefixId)
                    throw new TypeError(
                        "provider conversation checkpoint context does not match held state",
                    );
                const receipt = retainProviderConversationCheckpoint(checkpointStore, {
                    ...(binding as NonNullable<typeof binding>),
                    state: { ...state, system, tools: [] },
                });
                return Object.freeze({
                    contextPrefixId: state.contextPrefixId,
                    receiptId: receipt.receiptId,
                    snapshotRecordId: receipt.recordId,
                    status: VERIFIED,
                });
            }
            const receiptId = prefixed(identity.receiptIdPrefix, {
                provider_conversation: {
                    context_prefix_id: state.contextPrefixId,
                    messages: state.messages as unknown as SemanticRecord[],
                    system,
                },
            });
            receipts.set(receiptId, state);
            return Object.freeze({
                contextPrefixId: state.contextPrefixId,
                receiptId,
                status: VERIFIED,
            });
        },
        restore: (receiptId: string, context: ReplayProviderSessionCheckpointContext) => {
            if (pending) throw new TypeError("provider conversation cannot restore during a turn");
            if (checkpointStore !== undefined) {
                state = readRetained(receiptId, context);
                return state.contextPrefixId;
            }
            const retained = receipts.get(receiptId);
            if (retained === undefined) {
                throw new TypeError("provider conversation does not hold the requested receipt");
            }
            state = retained;
            return state.contextPrefixId;
        },
    });
    const conversationProvider = Object.freeze({
        descriptor: (): ProviderDescriptor => provider.descriptor(),
        invoke: async (
            requestValue: ModelRequest,
            signalValue: AbortSignal,
        ): Promise<ModelResponse> => {
            const signal = readProviderSignal(signalValue);
            signal.throwIfAborted();
            const request = readModelRequest(requestValue);
            if (pending) {
                throw new TypeError("provider conversation turns must be sequential");
            }
            assertConfiguration();
            pending = true;
            const messages = Object.freeze([...state.messages, renderModelRequestMessage(request)]);
            let response: ModelResponse;
            try {
                const reply = await provider.converse(
                    {
                        cachePrefixMessages: messages.length,
                        messages,
                        outputSchema: request.outputSchema,
                        system,
                    },
                    signal,
                );
                response = readModelResponse(
                    { output: reply.output, usage: reply.usage },
                    "provider conversation response",
                );
            } catch (error) {
                pending = false;
                if (!signal.aborted) {
                    advance(request, { failure: createReplayFailure(error) }, state.messages);
                }
                throw error;
            }
            pending = false;
            advance(
                request,
                { output: response.output },
                Object.freeze([...messages, renderModelOutputMessage(response.output)]),
            );
            return Object.freeze({ output: response.output, usage: response.usage });
        },
    });
    return Object.freeze({
        contextPrefixId: () => state.contextPrefixId,
        messages: () => state.messages,
        provider: conversationProvider,
        rebuild: (steps: readonly ReplayStepInspection[]) => {
            if (pending) {
                throw new TypeError("provider conversation cannot rebuild during a turn");
            }
            state = rebuildState(steps);
        },
        session,
    });
}

function rebuildState(steps: readonly ReplayStepInspection[]): ConversationState {
    if (!Array.isArray(steps)) {
        throw new TypeError("provider conversation rebuild requires retained steps");
    }
    let contextPrefixId: string | null = null;
    const messages: ModelMessage[] = [];
    steps.forEach((step, index) => {
        if (step === null || typeof step !== "object" || step.index !== index) {
            throw new TypeError("provider conversation rebuild requires a step prefix in order");
        }
        const exchange = step.provider;
        if (exchange === null) {
            return;
        }
        if (
            exchange.context_prefix_id !==
            createReplayContextPrefixId(contextPrefixId, exchange.prompt_id, exchange.response_id)
        ) {
            throw new TypeError(
                "provider conversation rebuild steps break the context prefix chain",
            );
        }
        contextPrefixId = exchange.context_prefix_id;
        if (exchange.response !== null) {
            messages.push(
                renderModelRequestMessage(exchange.request),
                renderModelOutputMessage(exchange.response.output),
            );
        }
    });
    return Object.freeze({ contextPrefixId, messages: Object.freeze(messages) });
}

function prefixed(prefix: string, value: SemanticRecord): string {
    const recordId = createRecordId(value);
    return `${prefix}${recordId.slice(recordId.lastIndexOf(":") + 1)}`;
}

function readDefinition(value: unknown): {
    readonly adapterId: string;
    readonly checkpointStore: SQLiteTraceStore | undefined;
    readonly configurationId: string | undefined;
    readonly provider: ProviderConversationDefinition["provider"];
    readonly system: string | null;
} {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new TypeError("provider conversation definition must be an object");
    }
    const definition = value as Partial<ProviderConversationDefinition>;
    if (
        Object.keys(definition).some(
            (key) =>
                !["adapterId", "provider", "system", "checkpointStore", "configurationId"].includes(
                    key,
                ),
        )
    ) {
        throw new TypeError(
            "provider conversation definition must contain only its declared fields",
        );
    }
    if (!isWellFormedText(definition.adapterId)) {
        throw new TypeError("provider conversation adapterId must be a non-empty string");
    }
    const provider = definition.provider;
    if (
        provider === null ||
        typeof provider !== "object" ||
        typeof provider.converse !== "function" ||
        typeof provider.descriptor !== "function"
    ) {
        throw new TypeError("provider conversation requires a conversational provider");
    }
    if (definition.system !== undefined && !isWellFormedText(definition.system)) {
        throw new TypeError("provider conversation system must be non-empty text");
    }
    if (definition.configurationId !== undefined && !isWellFormedText(definition.configurationId))
        throw new TypeError("provider conversation configurationId must be nonempty text");
    if (
        definition.checkpointStore !== undefined &&
        (definition.checkpointStore === null ||
            typeof definition.checkpointStore.injectSupervisionContext !== "function" ||
            typeof definition.checkpointStore.readRecord !== "function")
    )
        throw new TypeError("provider conversation checkpointStore must be a trace store");
    return {
        adapterId: definition.adapterId,
        provider,
        system: definition.system ?? null,
        checkpointStore: definition.checkpointStore,
        configurationId: definition.configurationId,
    };
}
