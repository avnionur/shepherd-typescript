import { createHash } from "node:crypto";

import type { ProtocolConfig } from "../../../src/protocol/config-types.ts";

/**
 * Renders the configured trace-store backup manifest JSON Schema.
 *
 * @param config - Validated protocol configuration.
 * @returns The closed `store-backup-manifest-v1` schema.
 */
export function renderStoreBackupManifestSchema(
    config: ProtocolConfig,
): Readonly<Record<string, unknown>> {
    const backup = config.backup;
    const count = { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
    const digest = {
        type: "string",
        pattern: `^${escapePattern(backup.digestPrefix)}[0-9a-f]{${createHash(backup.digestAlgorithm).digest("hex").length}}$`,
    };
    return {
        $schema: config.kernel.schemas.dialect,
        $id: backup.schemas.manifestId,
        $comment: "Generated from protocol.config.json. Do not edit directly.",
        title: "Shepherd Trace Store Backup Manifest v1",
        description:
            "Written last into a backup directory; its presence marks a complete backup. manifest_id is the configured digest of the canonical JSON of every other member.",
        ...closedObject(
            [
                "archive_format",
                "archive_format_version",
                "backup_compatibility_version",
                "blobs",
                "cut_count",
                "cut_heads",
                "database",
                "export_digest",
                "format",
                "format_version",
                "manifest_id",
                "package_version",
                "record_count",
                "store_schema_version",
            ],
            {
                archive_format: { const: config.kernel.interchange.format },
                archive_format_version: { const: config.kernel.interchange.formatVersion },
                backup_compatibility_version: { const: backup.compatibilityVersion },
                blobs: closedObject(
                    ["byte_length", "count", "directory", "list_digest", "location"],
                    {
                        byte_length: count,
                        count,
                        directory: { const: backup.layout.blobDirectory },
                        list_digest: digest,
                        location: { enum: [...backup.blobLocations] },
                    },
                ),
                cut_count: count,
                cut_heads: {
                    type: "array",
                    items: closedObject(["owner_id", "owner_ordinal", "record_id"], {
                        owner_id: { type: "string", minLength: 1 },
                        owner_ordinal: count,
                        record_id: {
                            type: "string",
                            pattern: `^${escapePattern(config.recordId.prefix)}[0-9a-f]{${config.recordId.hexLength}}$`,
                        },
                    }),
                },
                database: closedObject(["byte_length", "digest", "file"], {
                    byte_length: { ...count, minimum: 1 },
                    digest,
                    file: { const: backup.layout.database },
                }),
                export_digest: digest,
                format: { const: backup.manifest.format },
                format_version: { const: backup.manifest.formatVersion },
                manifest_id: digest,
                package_version: {
                    type: "string",
                    pattern: "^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$",
                },
                record_count: { ...count, minimum: 1 },
                store_schema_version: { type: "integer", minimum: 1 },
            },
        ),
    };
}

function escapePattern(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function closedObject(
    required: readonly string[],
    properties: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
    return { type: "object", required, properties, additionalProperties: false };
}
