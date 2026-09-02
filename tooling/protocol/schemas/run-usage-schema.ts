import type { ProtocolConfig } from "../../../src/protocol/config-types.ts";

/**
 * Renders the normative aggregate run-usage v1 JSON Schema.
 *
 * @param config - Validated protocol configuration.
 * @returns The configured closed run-usage schema.
 */
export function renderRunUsageSchema(config: ProtocolConfig): Readonly<Record<string, unknown>> {
    const tokenCount = {
        type: "integer",
        minimum: 0,
        maximum: Number.MAX_SAFE_INTEGER,
    };
    return {
        $schema: config.kernel.schemas.dialect,
        $id: config.runs.schemas.usageId,
        $comment: "Generated from protocol.config.json. Do not edit directly.",
        title: "Shepherd Run Usage v1",
        description: "Aggregate resource-use totals for an entire run.",
        type: "object",
        required: [
            "usage_version",
            "run_id",
            "input_tokens",
            "output_tokens",
            "cache_creation_input_tokens",
            "cache_read_input_tokens",
            "cost_usd",
        ],
        properties: {
            usage_version: { const: config.runs.usageVersion },
            run_id: { type: "string", minLength: 1 },
            input_tokens: tokenCount,
            output_tokens: tokenCount,
            cache_creation_input_tokens: tokenCount,
            cache_read_input_tokens: tokenCount,
            cost_usd: {
                anyOf: [{ type: "number", minimum: 0 }, { type: "null" }],
            },
        },
        additionalProperties: false,
    };
}
