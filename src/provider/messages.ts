import {
    canonicalizeRecord,
    canonicalizeSemanticValue,
    type SemanticRecord,
    type SemanticValue,
} from "../canonical/canonical-record.ts";
import { providerProtocolConfig } from "../protocol/config.ts";
import { MODEL_CONTENT_BLOCK_TYPES, MODEL_MESSAGE_ROLES } from "../protocol/values.generated.ts";
import type {
    ModelContentBlock,
    ModelConversationRequest,
    ModelConversationResponse,
    ModelMessage,
    ModelRequest,
    ModelToolDefinition,
} from "./types.ts";
import { readModelRequest, readModelResponse } from "./validation.ts";

const [USER_ROLE, ASSISTANT_ROLE] = MODEL_MESSAGE_ROLES;
const [TEXT_BLOCK, TOOL_USE_BLOCK, TOOL_RESULT_BLOCK] = MODEL_CONTENT_BLOCK_TYPES;
const TOOL_NAME = /^[a-zA-Z0-9_-]{1,64}$/u;
const rendering = providerProtocolConfig.messages.rendering;

/**
 * Renders one provider-neutral request as a user message whose single text block is the canonical
 * JSON of the configured instruction, input, and output-schema fields. Equal requests render to
 * byte-identical text. @internal
 */
export function renderModelRequestMessage(request: ModelRequest): ModelMessage {
    const snapshot = readModelRequest(request);
    return textMessage(
        USER_ROLE,
        canonicalizeRecord({
            [rendering.input]: snapshot.input,
            [rendering.instruction]: snapshot.instruction,
            [rendering.outputSchema]: snapshot.outputSchema,
        } as SemanticRecord),
    );
}

/**
 * Renders one canonical provider output as the assistant message retained in a conversation.
 * Equal outputs render to byte-identical text. @internal
 */
export function renderModelOutputMessage(output: SemanticValue): ModelMessage {
    return textMessage(ASSISTANT_ROLE, canonicalizeSemanticValue(output));
}

/** Builds one frozen text message. @internal */
export function textMessage(role: ModelMessage["role"], text: string): ModelMessage {
    return Object.freeze({
        content: Object.freeze([Object.freeze({ text, type: TEXT_BLOCK })]),
        role,
    });
}

/** Validates and snapshots one multi-turn request. @internal */
export function readModelConversationRequest(value: unknown): ModelConversationRequest {
    const fields = readPlainObject(
        value,
        ["cachePrefixMessages", "messages", "outputSchema", "system"],
        "model conversation request",
        ["tools"],
    );
    if (!Array.isArray(fields.messages) || fields.messages.length === 0) {
        throw new TypeError("model conversation request messages must be a non-empty array");
    }
    const messages = Object.freeze(
        (fields.messages as readonly unknown[]).map((message, index) =>
            readModelMessage(message, `model conversation request messages[${index}]`),
        ),
    );
    if (messages[0]?.role !== USER_ROLE) {
        throw new TypeError("model conversation request must start with a user message");
    }
    const prefix = fields.cachePrefixMessages;
    if (
        !Number.isSafeInteger(prefix) ||
        (prefix as number) < 0 ||
        (prefix as number) > messages.length
    ) {
        throw new TypeError(
            "model conversation request cachePrefixMessages must be an integer within the message count",
        );
    }
    if (
        fields.outputSchema !== null &&
        (typeof fields.outputSchema !== "object" || Array.isArray(fields.outputSchema))
    ) {
        throw new TypeError("model conversation request outputSchema must be a record or null");
    }
    if (fields.system !== null && !isWellFormedText(fields.system)) {
        throw new TypeError("model conversation request system must be non-empty text or null");
    }
    const tools = fields.tools === undefined ? [] : readToolDefinitions(fields.tools);
    return Object.freeze({
        cachePrefixMessages: prefix as number,
        messages,
        outputSchema:
            fields.outputSchema === null
                ? null
                : (JSON.parse(
                      canonicalizeRecord(fields.outputSchema as SemanticRecord),
                  ) as SemanticRecord),
        system: fields.system as string | null,
        tools,
    });
}

/**
 * Validates and snapshots one multi-turn response: an assistant message, its output, stop reason,
 * and usage. @internal
 */
export function readModelConversationResponse(
    value: unknown,
    subject: string,
): ModelConversationResponse {
    const fields = readPlainObject(value, ["message", "output", "stopReason", "usage"], subject);
    const message = readModelMessage(fields.message, `${subject} message`);
    if (message.role !== ASSISTANT_ROLE) {
        throw new TypeError(`${subject} message must be an assistant message`);
    }
    if (!isWellFormedText(fields.stopReason)) {
        throw new TypeError(`${subject} stopReason must be non-empty text`);
    }
    const response = readModelResponse({ output: fields.output, usage: fields.usage }, subject);
    return Object.freeze({
        message,
        output: response.output,
        stopReason: fields.stopReason,
        usage: response.usage,
    });
}

/** Returns the tool-use blocks of a message in order. @internal */
export function toolUseBlocks(
    message: ModelMessage,
): readonly Extract<ModelContentBlock, { readonly type: typeof TOOL_USE_BLOCK }>[] {
    return message.content.filter(
        (block): block is Extract<ModelContentBlock, { readonly type: typeof TOOL_USE_BLOCK }> =>
            block.type === TOOL_USE_BLOCK,
    );
}

function readToolDefinitions(value: unknown): readonly ModelToolDefinition[] {
    if (!Array.isArray(value)) {
        throw new TypeError("model conversation request tools must be an array");
    }
    const tools = (value as readonly unknown[]).map((entry, index) => {
        const subject = `model conversation request tools[${index}]`;
        const fields = readPlainObject(entry, ["description", "inputSchema", "name"], subject);
        if (typeof fields.name !== "string" || !TOOL_NAME.test(fields.name)) {
            throw new TypeError(`${subject} name must be a portable tool name`);
        }
        if (!isWellFormedText(fields.description)) {
            throw new TypeError(`${subject} description must be non-empty text`);
        }
        return Object.freeze({
            description: fields.description,
            inputSchema: readRecord(fields.inputSchema, `${subject} inputSchema`),
            name: fields.name,
        });
    });
    if (new Set(tools.map((tool) => tool.name)).size !== tools.length) {
        throw new TypeError("model conversation request tool names must be unique");
    }
    return Object.freeze(tools);
}

/** Validates and snapshots one provider-neutral message. @internal */
export function readModelMessage(value: unknown, subject: string): ModelMessage {
    const fields = readPlainObject(value, ["content", "role"], subject);
    if (!(MODEL_MESSAGE_ROLES as readonly unknown[]).includes(fields.role)) {
        throw new TypeError(`${subject} role is not configured`);
    }
    if (!Array.isArray(fields.content) || fields.content.length === 0) {
        throw new TypeError(`${subject} content must be a non-empty array`);
    }
    const role = fields.role as ModelMessage["role"];
    return Object.freeze({
        content: Object.freeze(
            (fields.content as readonly unknown[]).map((block, index) =>
                readContentBlock(block, role, `${subject} content[${index}]`),
            ),
        ),
        role,
    });
}

function readContentBlock(
    value: unknown,
    role: ModelMessage["role"],
    subject: string,
): ModelContentBlock {
    const type =
        value !== null && typeof value === "object" ? (value as { type?: unknown }).type : null;
    if (type === TEXT_BLOCK) {
        const fields = readPlainObject(value, ["text", "type"], subject);
        if (!isWellFormedText(fields.text)) {
            throw new TypeError(`${subject} text must be non-empty well-formed text`);
        }
        return Object.freeze({ text: fields.text, type: TEXT_BLOCK });
    }
    if (type === TOOL_USE_BLOCK) {
        if (role !== ASSISTANT_ROLE) {
            throw new TypeError(`${subject} tool use must appear in an assistant message`);
        }
        const fields = readPlainObject(value, ["id", "input", "name", "type"], subject);
        if (!isWellFormedText(fields.id)) {
            throw new TypeError(`${subject} id must be non-empty well-formed text`);
        }
        if (typeof fields.name !== "string" || !TOOL_NAME.test(fields.name)) {
            throw new TypeError(`${subject} name must be a portable tool name`);
        }
        return Object.freeze({
            id: fields.id,
            input: readRecord(fields.input, `${subject} input`),
            name: fields.name,
            type: TOOL_USE_BLOCK,
        });
    }
    if (type === TOOL_RESULT_BLOCK) {
        if (role !== USER_ROLE) {
            throw new TypeError(`${subject} tool result must appear in a user message`);
        }
        const fields = readPlainObject(value, ["content", "isError", "toolUseId", "type"], subject);
        if (!isWellFormedText(fields.content) || !isWellFormedText(fields.toolUseId)) {
            throw new TypeError(`${subject} content and toolUseId must be non-empty text`);
        }
        if (typeof fields.isError !== "boolean") {
            throw new TypeError(`${subject} isError must be a boolean`);
        }
        return Object.freeze({
            content: fields.content,
            isError: fields.isError,
            toolUseId: fields.toolUseId,
            type: TOOL_RESULT_BLOCK,
        });
    }
    throw new TypeError(`${subject} type is not configured`);
}

function readRecord(value: unknown, subject: string): SemanticRecord {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new TypeError(`${subject} must be a record`);
    }
    return JSON.parse(canonicalizeRecord(value as SemanticRecord)) as SemanticRecord;
}

function readPlainObject(
    value: unknown,
    keys: readonly string[],
    subject: string,
    optional: readonly string[] = [],
): Record<string, unknown> {
    if (
        value === null ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    ) {
        throw new TypeError(`${subject} must be a plain data object`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const present = optional.filter((key) => Object.hasOwn(descriptors, key));
    if (
        Object.keys(descriptors).length !== keys.length + present.length ||
        [...keys, ...present].some((key) => !("value" in (descriptors[key] ?? {})))
    ) {
        throw new TypeError(`${subject} must contain exactly its declared data fields`);
    }
    return Object.fromEntries([...keys, ...present].map((key) => [key, descriptors[key]?.value]));
}

/** Reports whether a value is non-empty text without lone surrogates. @internal */
export function isWellFormedText(value: unknown): value is string {
    return typeof value === "string" && value.length > 0 && !/[\uD800-\uDFFF]/u.test(value);
}
