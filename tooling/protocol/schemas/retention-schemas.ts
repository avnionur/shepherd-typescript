import { createHash } from "node:crypto";

import type { ProtocolConfig } from "../../../src/protocol/config-types.ts";
import { renderTraceArchiveSchema } from "./trace-archive-schema.ts";

/** Disposition whose records carry a verbatim body; pinned by the retention v1 contract. */
const VERBATIM_DISPOSITION = "include";

/**
 * Renders the configured one-way redacted trace archive JSON Schema.
 *
 * @param config - Validated protocol configuration.
 * @returns The closed redacted-archive schema; shared archive members reuse the native archive
 * definitions.
 */
export function renderRedactedTraceArchiveSchema(
    config: ProtocolConfig,
): Readonly<Record<string, unknown>> {
    const retention = config.retention;
    const nativeDefinitions = renderTraceArchiveSchema(config).$defs as Readonly<
        Record<string, unknown>
    >;
    const blobDefinition = nativeDefinitions.blob as {
        readonly properties: Readonly<Record<string, unknown>>;
    };
    const dataClass = { enum: [...retention.dataClasses] };
    return {
        $schema: config.kernel.schemas.dialect,
        $id: retention.schemas.redactedArchiveId,
        $comment: "Generated from protocol.config.json. Do not edit directly.",
        title: "Shepherd Redacted Trace Archive v1",
        description:
            "One-way retention export: every record keeps its envelope; bodies are verbatim or replaced by a redaction marker, and blobs are listed without content. Never importable.",
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
                "retention_compatibility_version",
                "source_format",
                "source_format_version",
            ],
            {
                append_intents: { type: "array", items: { $ref: "#/$defs/appendIntent" } },
                blobs: { type: "array", items: { $ref: "#/$defs/blob" } },
                canonical_version: { const: config.kernel.canonicalVersion },
                cuts: { type: "array", items: { $ref: "#/$defs/cut" } },
                format: { const: retention.redactedArchive.format },
                format_version: { const: retention.redactedArchive.formatVersion },
                kernel_abi_version: { const: config.kernel.abiVersion },
                record_views: { type: "array", items: { $ref: "#/$defs/recordView" } },
                records: { type: "array", items: { $ref: "#/$defs/record" } },
                retention_compatibility_version: { const: retention.compatibilityVersion },
                source_format: { const: config.kernel.interchange.format },
                source_format_version: { const: config.kernel.interchange.formatVersion },
            },
        ),
        $defs: {
            appendIntent: nativeDefinitions.appendIntent,
            blob: closedObject(["blob_id", "byte_length"], {
                blob_id: blobDefinition.properties.blob_id,
                byte_length: blobDefinition.properties.byte_length,
            }),
            cut: nativeDefinitions.cut,
            record: {
                ...closedObject(["body", "data_class", "disposition", "envelope"], {
                    body: { type: "object" },
                    data_class: dataClass,
                    disposition: { enum: [...retention.dispositions] },
                    envelope: { $ref: config.kernel.schemas.recordEnvelopeId },
                }),
                oneOf: [
                    {
                        properties: {
                            body: { $ref: config.kernel.schemas.recordBodyId },
                            disposition: { const: VERBATIM_DISPOSITION },
                        },
                    },
                    {
                        properties: {
                            body: { $ref: "#/$defs/redactionMarker" },
                            disposition: {
                                enum: retention.dispositions.filter(
                                    (disposition) => disposition !== VERBATIM_DISPOSITION,
                                ),
                            },
                        },
                    },
                ],
            },
            recordView: nativeDefinitions.recordView,
            redactionMarker: closedObject(
                ["body_digest", "data_class", "redacted", "secret_classes"],
                {
                    body_digest: {
                        oneOf: [digestSchema(retention), { type: "null" }],
                    },
                    data_class: dataClass,
                    redacted: { const: true },
                    secret_classes: {
                        type: "array",
                        uniqueItems: true,
                        items: { enum: retention.secretClasses.map(({ name }) => name) },
                    },
                },
            ),
        },
    };
}

/**
 * Renders the configured read-only retention report JSON Schema.
 *
 * @param config - Validated protocol configuration.
 * @returns The closed retention-report schema.
 */
export function renderRetentionReportSchema(
    config: ProtocolConfig,
): Readonly<Record<string, unknown>> {
    const retention = config.retention;
    const count = { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
    const secretClass = { enum: retention.secretClasses.map(({ name }) => name) };
    const dataClass = { enum: [...retention.dataClasses] };
    const escapedPrefix = config.recordId.prefix.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    return {
        $schema: config.kernel.schemas.dialect,
        $id: retention.schemas.reportId,
        $comment: "Generated from protocol.config.json. Do not edit directly.",
        title: "Shepherd Trace Retention Report v1",
        description:
            "Read-only inventory of a trace store by data class, export disposition, and detected secret class; never contains body content or matched text.",
        ...closedObject(
            [
                "data_classes",
                "format",
                "format_version",
                "record_count",
                "retention_compatibility_version",
                "secret_classes",
                "secret_record_count",
                "secret_records",
                "secret_records_truncated",
                "secret_scanning",
            ],
            {
                data_classes: {
                    type: "array",
                    items: closedObject(
                        ["data_class", "disposition", "record_count", "secret_record_count"],
                        {
                            data_class: dataClass,
                            disposition: { enum: [...retention.dispositions] },
                            record_count: count,
                            secret_record_count: count,
                        },
                    ),
                },
                format: { const: retention.report.format },
                format_version: { const: retention.report.formatVersion },
                record_count: count,
                retention_compatibility_version: { const: retention.compatibilityVersion },
                secret_classes: {
                    type: "array",
                    items: closedObject(["finding_count", "record_count", "secret_class"], {
                        finding_count: count,
                        record_count: count,
                        secret_class: secretClass,
                    }),
                },
                secret_record_count: count,
                secret_records: {
                    type: "array",
                    maxItems: retention.limits.maxReportedRecords,
                    items: closedObject(
                        ["data_class", "finding_count", "record_id", "secret_classes", "truncated"],
                        {
                            data_class: dataClass,
                            finding_count: {
                                type: "integer",
                                minimum: 1,
                                maximum: retention.limits.maxFindings,
                            },
                            record_id: {
                                type: "string",
                                pattern: `^${escapedPrefix}[0-9a-f]{${config.recordId.hexLength}}$`,
                            },
                            secret_classes: {
                                type: "array",
                                minItems: 1,
                                uniqueItems: true,
                                items: secretClass,
                            },
                            truncated: { type: "boolean" },
                        },
                    ),
                },
                secret_records_truncated: { type: "boolean" },
                secret_scanning: { enum: [...retention.scanning.modes] },
            },
        ),
    };
}

function digestSchema(retention: ProtocolConfig["retention"]): Readonly<Record<string, unknown>> {
    const escapedPrefix = retention.digestPrefix.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const hexLength = createHash(retention.digestAlgorithm).digest("hex").length;
    return { type: "string", pattern: `^${escapedPrefix}[0-9a-f]{${hexLength}}$` };
}

function closedObject(
    required: readonly string[],
    properties: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
    return { type: "object", required, properties, additionalProperties: false };
}
