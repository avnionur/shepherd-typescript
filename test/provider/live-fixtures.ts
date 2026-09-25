import type {
    LiveProviderHttpRequest,
    LiveProviderHttpResponse,
    LiveProviderTransport,
    ModelRequest,
} from "../../src/index.ts";

/** Recorded transport call. */
export type TransportCall = LiveProviderHttpRequest & { readonly parsed: Record<string, unknown> };

/** Stub transport returning scripted responses and recording every request. */
export function scriptedTransport(
    responses: readonly (
        | LiveProviderHttpResponse
        | ((call: TransportCall) => LiveProviderHttpResponse)
    )[],
): { readonly calls: TransportCall[]; readonly transport: LiveProviderTransport } {
    const calls: TransportCall[] = [];
    return {
        calls,
        transport: async (request) => {
            const call = {
                ...request,
                parsed: JSON.parse(request.body) as Record<string, unknown>,
            };
            calls.push(call);
            const next = responses[calls.length - 1];
            if (next === undefined) {
                throw new Error("scripted transport exhausted");
            }
            return typeof next === "function" ? next(call) : next;
        },
    };
}

/** Anthropic Messages success body. */
export function anthropicReply(
    text: string,
    usage: Record<string, number | null> = { input_tokens: 10, output_tokens: 2 },
    stopReason = "end_turn",
): LiveProviderHttpResponse {
    return {
        body: JSON.stringify({
            content: [
                { thinking: "", type: "thinking" },
                { text, type: "text" },
            ],
            id: "msg_fixture",
            role: "assistant",
            stop_reason: stopReason,
            type: "message",
            usage,
        }),
        status: 200,
    };
}

/** OpenAI chat-completions success body. */
export function openAiReply(
    content: string | null,
    usage: Record<string, unknown> = { completion_tokens: 2, prompt_tokens: 10 },
    finishReason = "stop",
): LiveProviderHttpResponse {
    return {
        body: JSON.stringify({
            choices: [
                { finish_reason: finishReason, index: 0, message: { content, role: "assistant" } },
            ],
            usage,
        }),
        status: 200,
    };
}

/** Builds one canonical provider request. */
export function liveRequest(step: number): ModelRequest {
    return {
        input: { step },
        instruction: "Summarize the step.",
        outputSchema: {
            additionalProperties: false,
            properties: { text: { type: "string" } },
            required: ["text"],
            type: "object",
        },
    };
}

/**
 * Transport simulating a provider prompt cache: every request writes an entry for its messages up
 * to the cache-control breakpoint, and reads the longest earlier entry that prefixes its messages.
 * Token counts are the UTF-8 byte lengths of the serialized message prefixes.
 */
export function cachingTransport(outputs: readonly string[]): {
    readonly calls: TransportCall[];
    readonly transport: LiveProviderTransport;
} {
    const cache = new Set<string>();
    const strip = (messages: readonly Record<string, unknown>[]): string[] =>
        messages.map((message) =>
            JSON.stringify({
                ...message,
                content: (message.content as Record<string, unknown>[]).map(
                    ({ cache_control: _marker, ...block }) => block,
                ),
            }),
        );
    return scriptedTransport(
        outputs.map((output) => (call: TransportCall) => {
            const messages = strip(call.parsed.messages as Record<string, unknown>[]);
            const marked = (call.parsed.messages as Record<string, unknown>[]).map((message) =>
                (message.content as Record<string, unknown>[]).some(
                    (block) => block.cache_control !== undefined,
                ),
            );
            const boundary = marked.lastIndexOf(true);
            let read = 0;
            for (let length = messages.length; length > 0; length -= 1) {
                const key = messages.slice(0, length).join("\n");
                if (cache.has(key)) {
                    read = Buffer.byteLength(key);
                    break;
                }
            }
            const written = boundary < 0 ? "" : messages.slice(0, boundary + 1).join("\n");
            const creation =
                written.length === 0 || cache.has(written) ? 0 : Buffer.byteLength(written) - read;
            if (written.length > 0) {
                cache.add(written);
            }
            return anthropicReply(output, {
                cache_creation_input_tokens: Math.max(creation, 0),
                cache_read_input_tokens: read,
                input_tokens: 5,
                output_tokens: 2,
            });
        }),
    );
}
