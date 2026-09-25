import {
    type ConversationalModelProvider,
    createProgramConversationProvider,
    type ModelContentBlock,
    type ModelConversationRequest,
    type ModelMessage,
    type SemanticRecord,
    type SemanticValue,
} from "../../src/index.ts";

/** One scripted assistant turn: content blocks, derived from the request when a function. */
export type ScriptedTurn =
    | readonly ModelContentBlock[]
    | ((request: ModelConversationRequest) => readonly ModelContentBlock[]);

/** Zero usage for scripted turns. */
export const ZERO_USAGE = Object.freeze({
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    costUsd: null,
    inputTokens: 0,
    outputTokens: 0,
});

/**
 * Scripted meta-agent model: the n-th request (counted by assistant messages already in the
 * conversation) is answered by the n-th scripted turn. A turn without tool calls ends the loop with
 * its text as output.
 */
export function scriptedModel(
    id: string,
    turns: readonly ScriptedTurn[],
): {
    readonly provider: ConversationalModelProvider;
    readonly requests: ModelConversationRequest[];
} {
    const requests: ModelConversationRequest[] = [];
    const provider = createProgramConversationProvider({
        id,
        model: "scripted-v1",
        respond: (request) => {
            requests.push(request);
            const index = request.messages.filter((message) => message.role === "assistant").length;
            const turn = turns[index];
            if (turn === undefined) {
                throw new Error(`scripted model has no turn ${index}`);
            }
            const content = typeof turn === "function" ? turn(request) : turn;
            const calls = content.some((block) => block.type === "tool_use");
            const text = content.map((block) => (block.type === "text" ? block.text : "")).join("");
            return {
                message: { content, role: "assistant" },
                output: calls ? null : text,
                stopReason: calls ? "tool_use" : "end_turn",
                usage: ZERO_USAGE,
            };
        },
    });
    return { provider, requests };
}

/** Builds one tool-use block. */
export function call(id: string, name: string, input: SemanticRecord): ModelContentBlock {
    return { id, input, name, type: "tool_use" };
}

/** Builds one text block. */
export function text(value: string): ModelContentBlock {
    return { text: value, type: "text" };
}

/** Builds the initial user message. */
export function userMessage(value: string): ModelMessage {
    return { content: [text(value)], role: "user" };
}

/** Parses the tool-result block answering one call in the last user message of a request. */
export function toolResult(
    request: ModelConversationRequest,
    toolUseId: string,
): { readonly content: Record<string, SemanticValue>; readonly isError: boolean } {
    const last = request.messages.at(-1);
    const block = last?.content.find(
        (entry) => entry.type === "tool_result" && entry.toolUseId === toolUseId,
    );
    if (block === undefined || block.type !== "tool_result") {
        throw new Error(`no tool result for ${toolUseId}`);
    }
    return {
        content: JSON.parse(block.content) as Record<string, SemanticValue>,
        isError: block.isError,
    };
}

/** Reads the successful outcome value carried by the tool result answering one call. */
export function toolValue<T>(request: ModelConversationRequest, toolUseId: string): T {
    const result = toolResult(request, toolUseId).content.result as {
        readonly ok: boolean;
        readonly value: unknown;
    };
    if (result.ok !== true) {
        throw new Error(`tool call ${toolUseId} did not succeed`);
    }
    return result.value as T;
}

/** Reads the value of a success or the error of a failure as the expected shape. */
export function resultOf<T>(result: { readonly ok: boolean }): T {
    const fields = result as { readonly error?: unknown; readonly value?: unknown };
    return (result.ok ? fields.value : fields.error) as T;
}
