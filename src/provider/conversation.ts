import { createRecordId, type SemanticRecord } from "../canonical/canonical-record.ts";
import { providerProtocolConfig } from "../protocol/config.ts";
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
import { readModelRequest, readModelResponse, readProviderSignal } from "./validation.ts";

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
 * The session adapter's `checkpoint` retains the held state under a content-derived receipt in
 * this conversation's memory; `restore` resets the held state to a retained receipt. Receipts do
 * not survive the process; use `rebuild` with the retained steps after a restart.
 *
 * @param definition - Adapter identity, conversational provider, and optional system prompt.
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
    const { adapterId, provider, system } = readDefinition(definition);
    let state: ConversationState = Object.freeze({ contextPrefixId: null, messages: [] });
    let pending = false;
    const receipts = new Map<string, ConversationState>();
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
        checkpoint: (
            _context: ReplayProviderSessionCheckpointContext,
        ): ReplayProviderSessionEvidence => {
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
        restore: (receiptId: string, _context: ReplayProviderSessionCheckpointContext) => {
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
    readonly provider: ProviderConversationDefinition["provider"];
    readonly system: string | null;
} {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new TypeError("provider conversation definition must be an object");
    }
    const definition = value as Partial<ProviderConversationDefinition>;
    if (Object.keys(definition).some((key) => !["adapterId", "provider", "system"].includes(key))) {
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
    return { adapterId: definition.adapterId, provider, system: definition.system ?? null };
}
