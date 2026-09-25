import { providerProtocolConfig } from "../protocol/config.ts";
import {
    isWellFormedText,
    readModelConversationRequest,
    readModelConversationResponse,
    renderModelRequestMessage,
} from "./messages.ts";
import type {
    ConversationalModelProvider,
    ModelConversationRequest,
    ModelConversationResponse,
    ModelRequest,
    ModelResponse,
    ProgramConversationProviderDefinition,
    ProviderDescriptor,
    ProviderKind,
} from "./types.ts";
import { readModelRequest, readProviderSignal } from "./validation.ts";

const program = providerProtocolConfig.program;

/**
 * Creates a conversational provider of the configured program kind whose turns are answered by a
 * deterministic caller program. It is the offline way to script multi-turn and tool-calling
 * models, for example a meta-agent that forks, observes, and rewinds workers in tests.
 *
 * `converse` validates the request, invokes `respond`, and validates the returned assistant message
 * (text, tool-use, and no tool-result blocks), output, stop reason, and usage. `invoke` sends one
 * request as a single rendered user turn and returns the output and usage. The descriptor declares
 * `providers.program.conversationCapabilities`.
 *
 * @param definition - Identity, optional model, and the responding program.
 * @returns A conversational provider.
 * @throws {TypeError} If the definition is malformed. Returned calls throw `TypeError` for a
 *   malformed request or reply, the signal's reason when aborted, and program errors unchanged.
 *
 * @example
 * ```ts
 * const provider = createProgramConversationProvider({
 *     id: "scripted-meta-agent",
 *     respond: (request) => nextScriptedTurn(request),
 * });
 * ```
 *
 * @public
 */
export function createProgramConversationProvider(
    definition: ProgramConversationProviderDefinition,
): ConversationalModelProvider {
    if (definition === null || typeof definition !== "object" || Array.isArray(definition)) {
        throw new TypeError("program conversation provider definition must be an object");
    }
    if (
        Object.keys(definition).some((key) => !["id", "model", "respond"].includes(key)) ||
        !isWellFormedText(definition.id) ||
        (definition.model !== undefined && !isWellFormedText(definition.model)) ||
        typeof definition.respond !== "function"
    ) {
        throw new TypeError(
            "program conversation provider requires an id, an optional model, and a respond function",
        );
    }
    const respond = definition.respond;
    const descriptor: ProviderDescriptor = Object.freeze({
        capabilities: program.conversationCapabilities,
        id: definition.id,
        kind: program.kind as ProviderKind,
        model: definition.model ?? null,
    });
    const converse = async (
        requestValue: ModelConversationRequest,
        signalValue: AbortSignal,
    ): Promise<ModelConversationResponse> => {
        const signal = readProviderSignal(signalValue);
        signal.throwIfAborted();
        const request = readModelConversationRequest(requestValue);
        const reply = await respond(request, signal);
        signal.throwIfAborted();
        return readModelConversationResponse(reply, "program conversation provider response");
    };
    return Object.freeze({
        converse,
        descriptor: (): ProviderDescriptor => descriptor,
        invoke: async (request: ModelRequest, signal: AbortSignal): Promise<ModelResponse> => {
            readProviderSignal(signal).throwIfAborted();
            const snapshot = readModelRequest(request);
            const response = await converse(
                {
                    cachePrefixMessages: 1,
                    messages: [renderModelRequestMessage(snapshot)],
                    outputSchema: snapshot.outputSchema,
                    system: null,
                },
                signal,
            );
            return Object.freeze({ output: response.output, usage: response.usage });
        },
    });
}
