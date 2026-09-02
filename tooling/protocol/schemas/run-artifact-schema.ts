import type { ProtocolConfig } from "../../../src/protocol/config-types.ts";

/**
 * Renders the normative ordered run-artifact v1 JSON Schema.
 *
 * @param config - Validated protocol configuration.
 * @returns The configured closed run-artifact schema.
 */
export function renderRunArtifactSchema(config: ProtocolConfig): Readonly<Record<string, unknown>> {
    const [textContentType, blobContentType] = config.runs.artifactContentTypes;
    return {
        $schema: config.kernel.schemas.dialect,
        $id: config.runs.schemas.artifactId,
        $comment: "Generated from protocol.config.json. Do not edit directly.",
        title: "Shepherd Run Artifact v1",
        description: "One ordered side-channel output emitted by a run.",
        type: "object",
        required: [
            "artifact_version",
            "run_id",
            "artifact_ordinal",
            "kind",
            "name",
            "content",
            "metadata",
        ],
        properties: {
            artifact_version: { const: config.runs.artifactVersion },
            run_id: { type: "string", minLength: 1 },
            artifact_ordinal: {
                type: "integer",
                minimum: config.runs.firstArtifactOrdinal,
                maximum: config.runs.lastArtifactOrdinal,
            },
            kind: { type: "string", minLength: 1 },
            name: { type: "string", minLength: 1 },
            content: {
                oneOf: [
                    {
                        type: "object",
                        required: ["type", "text"],
                        properties: {
                            type: { const: textContentType },
                            text: { type: "string" },
                        },
                        additionalProperties: false,
                    },
                    {
                        type: "object",
                        required: ["type", "blob_id", "byte_length"],
                        properties: {
                            type: { const: blobContentType },
                            blob_id: {
                                type: "string",
                                pattern: configuredBlobIdPattern(config),
                            },
                            byte_length: {
                                type: "integer",
                                minimum: 0,
                                maximum: Number.MAX_SAFE_INTEGER,
                            },
                        },
                        additionalProperties: false,
                    },
                ],
            },
            metadata: {
                type: "object",
                additionalProperties: { $ref: "#/$defs/semanticValue" },
            },
        },
        additionalProperties: false,
        $defs: { semanticValue: semanticValueSchema() },
    };
}

function configuredBlobIdPattern(config: ProtocolConfig): string {
    const blobConfig = config.kernel.store.blobs;
    const prefix = blobConfig.idPrefix.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    return `^${prefix}[0-9a-f]{${blobConfig.hexLength}}$`;
}

function semanticValueSchema(): Readonly<Record<string, unknown>> {
    return {
        anyOf: [
            { type: "boolean" },
            { type: "null" },
            { type: "number" },
            { type: "string" },
            { type: "array", items: { $ref: "#/$defs/semanticValue" } },
            { type: "object", additionalProperties: { $ref: "#/$defs/semanticValue" } },
        ],
    };
}
