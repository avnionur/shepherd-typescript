import { canonicalizeRecord, type SemanticRecord } from "../canonical/canonical-record.ts";
import { createCanonicalSnapshot } from "../canonical/snapshot.ts";
import { LIVE_PROVIDER_DIALECTS, type LiveProviderKindConfig } from "../protocol/config-types.ts";
import { MODEL_CONTENT_BLOCK_TYPES, MODEL_MESSAGE_ROLES } from "../protocol/values.generated.ts";
import type {
    ModelContentBlock,
    ModelConversationRequest,
    ModelMessage,
    ModelToolUseBlock,
    ModelUsage,
} from "./types.ts";

const [ANTHROPIC_MESSAGES, OPENAI_CHAT_COMPLETIONS] = LIVE_PROVIDER_DIALECTS;
const [TEXT_BLOCK, TOOL_USE_BLOCK, TOOL_RESULT_BLOCK] = MODEL_CONTENT_BLOCK_TYPES;
const [USER_ROLE] = MODEL_MESSAGE_ROLES;

/*
 * Wire names below are fixed by each implemented dialect's published API, exactly like the
 * dialect's `messages`, `system`, and `output_config` fields; per-kind variations (the tools
 * request field and tool-use stop reasons) come from `providers.live.kinds.<kind>.toolUse`.
 */

/** Wire settings resolved for one live provider instance. @internal */
export type LiveDialectSettings = {
    /** Configured prompt-cache marker, or null. */
    readonly cacheControl: LiveProviderKindConfig["cacheControl"];
    /** Maximum output tokens per request. */
    readonly maxOutputTokens: number;
    /** Request body field carrying the output-token limit. */
    readonly maxTokensField: string;
    /** Provider model identity. */
    readonly model: string;
    /** Named structured-output format, or null. */
    readonly outputFormat: LiveProviderKindConfig["outputFormat"];
    /** Request body field carrying the tool definitions. */
    readonly toolsField: string;
};

/** Provider-neutral fields decoded from one wire response. @internal */
export type LiveDialectResponse = {
    /** Assistant text and tool-use blocks in response order; empty text is omitted. */
    readonly content: readonly ModelContentBlock[];
    /** Concatenated assistant text. */
    readonly text: string;
    /** Provider stop reason. */
    readonly stopReason: string;
    /** Normalized usage. */
    readonly usage: ModelUsage;
};

/** Encoder and decoder of one implemented wire dialect. @internal */
export type LiveDialect = {
    /** Builds the request body; `messages` is always the last key so a prefix is a byte prefix. */
    readonly encode: (
        request: ModelConversationRequest,
        settings: LiveDialectSettings,
    ) => Record<string, unknown>;
    /** Decodes a parsed response body, or returns a bounded reason it is malformed. */
    readonly decode: (body: unknown) => LiveDialectResponse | string;
};

/** Implemented wire dialects by configured dialect name. @internal */
export const LIVE_DIALECTS: Readonly<Record<LiveProviderKindConfig["dialect"], LiveDialect>> =
    Object.freeze({
        [ANTHROPIC_MESSAGES]: Object.freeze({ decode: decodeAnthropic, encode: encodeAnthropic }),
        [OPENAI_CHAT_COMPLETIONS]: Object.freeze({ decode: decodeOpenAi, encode: encodeOpenAi }),
    });

function encodeAnthropic(
    request: ModelConversationRequest,
    settings: LiveDialectSettings,
): Record<string, unknown> {
    return {
        model: settings.model,
        [settings.maxTokensField]: settings.maxOutputTokens,
        ...(request.system === null ? {} : { system: [{ text: request.system, type: "text" }] }),
        ...(request.outputSchema === null
            ? {}
            : { output_config: { format: { schema: request.outputSchema, type: "json_schema" } } }),
        ...(request.tools === undefined || request.tools.length === 0
            ? {}
            : {
                  [settings.toolsField]: request.tools.map((tool) => ({
                      description: tool.description,
                      input_schema: tool.inputSchema,
                      name: tool.name,
                  })),
              }),
        messages: request.messages.map((message, index) => ({
            content: anthropicParts(message, isCacheBoundary(request, settings, index), settings),
            role: message.role,
        })),
    };
}

function anthropicParts(
    message: ModelMessage,
    boundary: boolean,
    settings: LiveDialectSettings,
): readonly Record<string, unknown>[] {
    return message.content.map((block, index) => ({
        ...anthropicBlock(block),
        ...(boundary && index === message.content.length - 1
            ? { cache_control: settings.cacheControl }
            : {}),
    }));
}

function anthropicBlock(block: ModelContentBlock): Record<string, unknown> {
    switch (block.type) {
        case TEXT_BLOCK:
            return { text: block.text, type: "text" };
        case TOOL_USE_BLOCK:
            return { id: block.id, input: block.input, name: block.name, type: "tool_use" };
        default:
            return {
                content: block.content,
                is_error: block.isError,
                tool_use_id: block.toolUseId,
                type: "tool_result",
            };
    }
}

function encodeOpenAi(
    request: ModelConversationRequest,
    settings: LiveDialectSettings,
): Record<string, unknown> {
    const format = settings.outputFormat as NonNullable<LiveDialectSettings["outputFormat"]>;
    return {
        model: settings.model,
        [settings.maxTokensField]: settings.maxOutputTokens,
        ...(request.outputSchema === null
            ? {}
            : {
                  response_format: {
                      json_schema: {
                          name: format.name,
                          schema: request.outputSchema,
                          strict: format.strict,
                      },
                      type: "json_schema",
                  },
              }),
        ...(request.tools === undefined || request.tools.length === 0
            ? {}
            : {
                  [settings.toolsField]: request.tools.map((tool) => ({
                      function: {
                          description: tool.description,
                          name: tool.name,
                          parameters: tool.inputSchema,
                      },
                      type: "function",
                  })),
              }),
        messages: [
            ...(request.system === null ? [] : [{ content: request.system, role: "system" }]),
            ...request.messages.flatMap((message, index) =>
                openAiMessages(message, isCacheBoundary(request, settings, index), settings),
            ),
        ],
    };
}

function openAiMessages(
    message: ModelMessage,
    boundary: boolean,
    settings: LiveDialectSettings,
): readonly Record<string, unknown>[] {
    const texts = message.content.filter((block) => block.type === TEXT_BLOCK);
    const textContent = (): unknown =>
        settings.cacheControl === null
            ? texts.map((block) => block.text).join("")
            : texts.map((block, index) => ({
                  text: block.text,
                  type: "text",
                  ...(boundary && index === texts.length - 1
                      ? { cache_control: settings.cacheControl }
                      : {}),
              }));
    if (message.role !== USER_ROLE) {
        const calls = message.content.filter((block) => block.type === TOOL_USE_BLOCK);
        return [
            {
                content: texts.length === 0 ? null : textContent(),
                role: message.role,
                ...(calls.length === 0
                    ? {}
                    : {
                          tool_calls: calls.map((call) => ({
                              function: {
                                  arguments: canonicalizeRecord(call.input),
                                  name: call.name,
                              },
                              id: call.id,
                              type: "function",
                          })),
                      }),
            },
        ];
    }
    const results = message.content.filter((block) => block.type === TOOL_RESULT_BLOCK);
    // Without text, the last tool message closes the prefix and carries the marker as a text part.
    const markLastResult = boundary && texts.length === 0;
    return [
        ...results.map((result, index) => ({
            content:
                markLastResult && index === results.length - 1
                    ? [{ cache_control: settings.cacheControl, text: result.content, type: "text" }]
                    : result.content,
            role: "tool",
            tool_call_id: result.toolUseId,
        })),
        ...(texts.length === 0 ? [] : [{ content: textContent(), role: message.role }]),
    ];
}

function isCacheBoundary(
    request: ModelConversationRequest,
    settings: LiveDialectSettings,
    index: number,
): boolean {
    return settings.cacheControl !== null && index === request.cachePrefixMessages - 1;
}

function decodeAnthropic(body: unknown): LiveDialectResponse | string {
    const response = asRecord(body);
    const content = response?.content;
    if (response === null || !Array.isArray(content)) {
        return "response has no content array";
    }
    const blocks: ModelContentBlock[] = [];
    for (const entry of content.map(asRecord)) {
        if (entry?.type === "text" && typeof entry.text === "string") {
            if (entry.text.length > 0) {
                blocks.push({ text: entry.text, type: TEXT_BLOCK });
            }
        } else if (entry?.type === "tool_use") {
            const call = readToolCall(entry.id, entry.name, asRecord(entry.input));
            if (call === null) {
                return "response tool use is malformed";
            }
            blocks.push(call);
        }
    }
    const text = blocks.map((block) => (block.type === TEXT_BLOCK ? block.text : "")).join("");
    const usage = asRecord(response.usage);
    if (typeof response.stop_reason !== "string" || usage === null) {
        return "response has no stop reason or usage";
    }
    const inputTokens = count(usage.input_tokens);
    const outputTokens = count(usage.output_tokens);
    const cacheRead = optionalCount(usage.cache_read_input_tokens);
    const cacheCreation = optionalCount(usage.cache_creation_input_tokens);
    if (
        inputTokens === null ||
        outputTokens === null ||
        cacheRead === null ||
        cacheCreation === null
    ) {
        return "response usage is malformed";
    }
    return {
        content: blocks,
        stopReason: response.stop_reason,
        text,
        usage: {
            cacheCreationInputTokens: cacheCreation,
            cacheReadInputTokens: cacheRead,
            costUsd: null,
            inputTokens,
            outputTokens,
        },
    };
}

function decodeOpenAi(body: unknown): LiveDialectResponse | string {
    const response = asRecord(body);
    const choice = Array.isArray(response?.choices) ? asRecord(response.choices[0]) : null;
    const message = asRecord(choice?.message);
    if (response === null || choice === null || message === null) {
        return "response has no first choice message";
    }
    const usage = asRecord(response.usage);
    if (typeof choice.finish_reason !== "string" || usage === null) {
        return "response has no finish reason or usage";
    }
    const promptTokens = count(usage.prompt_tokens);
    const outputTokens = count(usage.completion_tokens);
    const cached = optionalCount(asRecord(usage.prompt_tokens_details)?.cached_tokens);
    if (
        promptTokens === null ||
        outputTokens === null ||
        cached === null ||
        cached > promptTokens
    ) {
        return "response usage is malformed";
    }
    const text = typeof message.content === "string" ? message.content : "";
    const blocks: ModelContentBlock[] = text.length === 0 ? [] : [{ text, type: TEXT_BLOCK }];
    if (message.tool_calls !== undefined && message.tool_calls !== null) {
        if (!Array.isArray(message.tool_calls)) {
            return "response tool calls are malformed";
        }
        for (const entry of message.tool_calls.map(asRecord)) {
            const fn = asRecord(entry?.function);
            const call =
                entry?.type === "function" && typeof fn?.arguments === "string"
                    ? readToolCall(entry.id, fn.name, parseObject(fn.arguments))
                    : null;
            if (call === null) {
                return "response tool call is malformed";
            }
            blocks.push(call);
        }
    }
    return {
        content: blocks,
        stopReason: choice.finish_reason,
        text,
        usage: {
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: cached,
            costUsd: null,
            inputTokens: promptTokens - cached,
            outputTokens,
        },
    };
}

function readToolCall(
    id: unknown,
    name: unknown,
    input: Record<string, unknown> | null,
): ModelToolUseBlock | null {
    if (typeof id !== "string" || id.length === 0 || typeof name !== "string" || input === null) {
        return null;
    }
    try {
        return {
            id,
            input: createCanonicalSnapshot(input as SemanticRecord),
            name,
            type: TOOL_USE_BLOCK,
        };
    } catch {
        return null;
    }
}

function parseObject(text: string): Record<string, unknown> | null {
    try {
        return asRecord(JSON.parse(text));
    } catch {
        return null;
    }
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

function count(value: unknown): number | null {
    return Number.isSafeInteger(value) && (value as number) >= 0 ? (value as number) : null;
}

function optionalCount(value: unknown): number | null {
    return value === undefined || value === null ? 0 : count(value);
}
