import { createHash } from "node:crypto";

import type { ProtocolConfig } from "../../../src/protocol/config-types.ts";

/**
 * Renders the configured native trace archive JSON Schema.
 *
 * @param config - Validated protocol configuration.
 * @returns The configured closed native trace-archive schema.
 */
export function renderTraceArchiveSchema(
    config: ProtocolConfig,
): Readonly<Record<string, unknown>> {
    const recordId = identifierSchema(config.recordId.prefix, config.recordId.hexLength);
    const blobId = identifierSchema(
        config.kernel.store.blobs.idPrefix,
        config.kernel.store.blobs.hexLength,
    );
    const ownerOrdinal = {
        type: "integer",
        minimum: config.kernel.append.firstOwnerOrdinal,
        maximum: config.kernel.append.lastOwnerOrdinal,
    };
    const appendDigestLength = createHash(config.kernel.store.appendIntentDigestAlgorithm).digest(
        "hex",
    ).length;
    return {
        $schema: config.kernel.schemas.dialect,
        $id: config.kernel.schemas.traceArchiveId,
        $comment: "Generated from protocol.config.json. Do not edit directly.",
        title: "Shepherd Native Trace Archive v1",
        description: "Complete identity-preserving retained trace-store interchange.",
        ...closedObject(
            [
                "append_intents",
                "blobs",
                "canonical_version",
                "cuts",
                "format",
                "format_version",
                "kernel_abi_version",
                "record_views",
                "records",
            ],
            {
                append_intents: { type: "array", items: { $ref: "#/$defs/appendIntent" } },
                blobs: { type: "array", items: { $ref: "#/$defs/blob" } },
                canonical_version: { const: config.kernel.canonicalVersion },
                cuts: { type: "array", items: { $ref: "#/$defs/cut" } },
                format: { const: config.kernel.interchange.format },
                format_version: { const: config.kernel.interchange.formatVersion },
                kernel_abi_version: { const: config.kernel.abiVersion },
                record_views: { type: "array", items: { $ref: "#/$defs/recordView" } },
                records: { type: "array", items: { $ref: "#/$defs/record" } },
            },
        ),
        $defs: {
            appendIntent: closedObject(["append_intent_id", "batch_digest", "receipt_json"], {
                append_intent_id: { type: "string", minLength: 1 },
                batch_digest: {
                    type: "string",
                    pattern: `^[0-9a-f]{${appendDigestLength}}$`,
                },
                receipt_json: { type: "string" },
            }),
            blob: closedObject(["blob_id", "byte_length", "content_base64"], {
                blob_id: blobId,
                byte_length: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
                content_base64: {
                    type: "string",
                    pattern: "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$",
                },
            }),
            cut: closedObject(
                [
                    "append_intent_id",
                    "created_by_record_id",
                    "cut_id",
                    "publisher_owner_id",
                    "target_owner_id",
                    "through_owner_ordinal",
                    "through_record_id",
                ],
                {
                    append_intent_id: { type: "string", minLength: 1 },
                    created_by_record_id: recordId,
                    cut_id: { type: "string", minLength: 1 },
                    publisher_owner_id: { type: "string", minLength: 1 },
                    target_owner_id: { type: "string", minLength: 1 },
                    through_owner_ordinal: ownerOrdinal,
                    through_record_id: recordId,
                },
            ),
            record: closedObject(["body", "envelope"], {
                body: { $ref: config.kernel.schemas.recordBodyId },
                envelope: { $ref: config.kernel.schemas.recordEnvelopeId },
            }),
            recordView: closedObject(
                ["append_intent_id", "append_position", "owner_id", "owner_ordinal", "record_id"],
                {
                    append_intent_id: { type: "string", minLength: 1 },
                    append_position: {
                        type: "integer",
                        minimum: 0,
                        maximum: Number.MAX_SAFE_INTEGER,
                    },
                    owner_id: { type: "string", minLength: 1 },
                    owner_ordinal: ownerOrdinal,
                    record_id: recordId,
                },
            ),
        },
    };
}

function closedObject(
    required: readonly string[],
    properties: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
    return { type: "object", required, properties, additionalProperties: false };
}

function identifierSchema(prefix: string, hexLength: number): Readonly<Record<string, unknown>> {
    const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    return { type: "string", pattern: `^${escapedPrefix}[0-9a-f]{${hexLength}}$` };
}
