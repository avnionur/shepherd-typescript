import type { ProtocolConfig } from "../src/protocol/config-types.ts";

/** Renders the normative bodyless task descriptor v1 JSON Schema. */
export function renderTaskDescriptorSchema(
    config: ProtocolConfig,
): Readonly<Record<string, unknown>> {
    return {
        $schema: config.kernel.schemas.dialect,
        $id: config.tasks.schemas.descriptorId,
        $comment: "Generated from protocol.config.json. Do not edit directly.",
        title: "Shepherd Task Descriptor v1",
        description: "Canonical behavioral contract for one bodyless task version.",
        type: "object",
        required: [
            "compatibility_version",
            "descriptor_version",
            "input_schema",
            "instruction",
            "name",
            "output_schema",
            "task_version",
        ],
        properties: {
            compatibility_version: { const: config.tasks.compatibilityVersion },
            descriptor_version: { const: config.tasks.descriptorVersion },
            input_schema: { $ref: "#/$defs/taskSchema" },
            instruction: { type: "string", minLength: 1 },
            name: { type: "string", minLength: 1 },
            output_schema: { $ref: "#/$defs/taskSchema" },
            task_version: { type: "string", minLength: 1 },
        },
        additionalProperties: false,
        $defs: {
            taskSchema: {
                oneOf: [
                    {
                        type: "object",
                        required: ["type"],
                        properties: { type: { const: "string" } },
                        additionalProperties: false,
                    },
                    {
                        type: "object",
                        required: ["type"],
                        properties: { type: { const: "null" } },
                        additionalProperties: false,
                    },
                    {
                        type: "object",
                        required: ["additionalProperties", "properties", "required", "type"],
                        properties: {
                            additionalProperties: { const: false },
                            properties: {
                                type: "object",
                                additionalProperties: { $ref: "#/$defs/taskSchema" },
                            },
                            required: {
                                type: "array",
                                items: { type: "string", minLength: 1 },
                                uniqueItems: true,
                            },
                            type: { const: "object" },
                        },
                        additionalProperties: false,
                    },
                ],
            },
        },
    };
}

/** Renders the normative exact task artifact-lock v1 JSON Schema. */
export function renderTaskArtifactLockSchema(
    config: ProtocolConfig,
): Readonly<Record<string, unknown>> {
    const digestPattern = `${escapeRegularExpression(config.tasks.digestPrefix)}[0-9a-f]{${
        config.tasks.hexLength
    }}`;
    return {
        $schema: config.kernel.schemas.dialect,
        $id: config.tasks.schemas.artifactLockId,
        $comment: "Generated from protocol.config.json. Do not edit directly.",
        title: "Shepherd Task Artifact Lock v1",
        description: "Exact content-addressed citation for one immutable task artifact revision.",
        type: "object",
        required: [
            "artifact_digest",
            "artifact_lock_version",
            "compatibility_version",
            "descriptor_version",
            "schema_digest",
            "task_id",
            "task_version",
        ],
        properties: {
            artifact_digest: { type: "string", pattern: `^${digestPattern}$` },
            artifact_lock_version: { const: config.tasks.artifactLockVersion },
            compatibility_version: { const: config.tasks.compatibilityVersion },
            descriptor_version: { const: config.tasks.descriptorVersion },
            schema_digest: { type: "string", pattern: `^${digestPattern}$` },
            task_id: {
                type: "string",
                pattern: `^${escapeRegularExpression(config.tasks.taskIdPrefix)}[0-9a-f]{${
                    config.tasks.hexLength
                }}$`,
            },
            task_version: { type: "string", minLength: 1 },
        },
        additionalProperties: false,
    };
}

function escapeRegularExpression(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
