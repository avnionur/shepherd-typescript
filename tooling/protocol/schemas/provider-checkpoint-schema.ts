import type { ProtocolConfig } from "../../../src/protocol/config-types.ts";

type Schema = Readonly<Record<string, unknown>>;

/** Renders the versioned payload carried inside an existing redacted-by-default context record. */
export function renderProviderCheckpointSchema(config: ProtocolConfig): Schema {
    const checkpoint = config.providers.conversation.checkpoint;
    const [user, assistant] = config.providers.messages.roles;
    const [textType, toolUse, toolResult] = config.providers.messages.contentTypes;
    const text = { type: "string", minLength: 1 };
    const identity = {
        ...text,
        maxLength: checkpoint.limits.maxIdentityBytes,
        "x-shepherd-max-utf8-bytes": checkpoint.limits.maxIdentityBytes,
    };
    const toolName = { ...text, pattern: "^[a-zA-Z0-9_-]{1,64}$" };
    const textBlock = closed({ type: { const: textType }, text });
    const useBlock = closed({
        type: { const: toolUse },
        id: text,
        name: toolName,
        input: { type: "object", additionalProperties: { $ref: "#/$defs/value" } },
    });
    const resultBlock = closed({
        type: { const: toolResult },
        toolUseId: text,
        content: text,
        isError: { type: "boolean" },
    });
    return {
        $schema: config.kernel.schemas.dialect,
        $id: checkpoint.schemaId,
        title: `Shepherd Provider Conversation Checkpoint Payload v${checkpoint.recordVersion}`,
        $comment:
            "Generated from protocol.config.json. This is the data payload of a supervision context record, preserving redaction in older exporters. Runtime additionally verifies content identity, provider/configuration binding, context identity, UTF-8 bounds and tool-name uniqueness. This is not proof of a live provider cache hit.",
        "x-shepherd-max-canonical-bytes": config.supervision.limits.maxDataCanonicalBytes,
        ...closed({
            compatibility_version: { const: checkpoint.compatibilityVersion },
            record_version: { const: checkpoint.recordVersion },
            adapter_id: identity,
            configuration_id: identity,
            provider: closed({
                capabilities: closed({
                    streaming: { type: "boolean" },
                    structuredOutput: { type: "boolean" },
                    tools: { type: "boolean" },
                }),
                id: text,
                kind: { enum: config.providers.kinds },
                model: { oneOf: [text, { type: "null" }] },
            }),
            context_prefix_id: {
                oneOf: [
                    { type: "null" },
                    {
                        type: "string",
                        pattern: `^${config.replay.identity.contextPrefixIdPrefix.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}[0-9a-f]{${config.recordId.hexLength}}$`,
                    },
                ],
            },
            messages: {
                type: "array",
                maxItems: checkpoint.limits.maxMessages,
                items: {
                    oneOf: [
                        closed({
                            role: { const: user },
                            content: {
                                type: "array",
                                minItems: 1,
                                items: { oneOf: [textBlock, resultBlock] },
                            },
                        }),
                        closed({
                            role: { const: assistant },
                            content: {
                                type: "array",
                                minItems: 1,
                                items: { oneOf: [textBlock, useBlock] },
                            },
                        }),
                    ],
                },
            },
            system: { oneOf: [text, { type: "null" }] },
            tools: {
                type: "array",
                maxItems: checkpoint.limits.maxTools,
                items: closed({
                    name: toolName,
                    description: text,
                    inputSchema: {
                        type: "object",
                        additionalProperties: { $ref: "#/$defs/value" },
                    },
                }),
            },
        }),
        $defs: {
            value: {
                anyOf: [
                    { type: "null" },
                    { type: "boolean" },
                    { type: "number" },
                    { type: "string" },
                    { type: "array", items: { $ref: "#/$defs/value" } },
                    { type: "object", additionalProperties: { $ref: "#/$defs/value" } },
                ],
            },
        },
    };
}

function closed(properties: Record<string, unknown>): Schema {
    return {
        type: "object",
        properties,
        required: Object.keys(properties).sort(),
        additionalProperties: false,
    };
}
