import type { ProtocolConfig } from "../../../src/protocol/config-types.ts";

type Schema = Readonly<Record<string, unknown>>;

/** Scalar admitted by task `enum` members and `const` values. */
const TASK_SCHEMA_SCALAR: Schema = {
    anyOf: [{ type: "boolean" }, { type: "null" }, { type: "number" }, { type: "string" }],
};

/**
 * Renders the normative bodyless task descriptor v1 JSON Schema.
 *
 * @param config - Validated protocol configuration.
 * @returns The configured closed task-descriptor schema.
 */
export function renderTaskDescriptorSchema(config: ProtocolConfig): Schema {
    return {
        $schema: config.kernel.schemas.dialect,
        $id: config.tasks.schemas.descriptorId,
        $comment: "Generated from protocol.config.json. Do not edit directly.",
        title: "Shepherd Task Descriptor v1",
        description: "Canonical behavioral contract for one bodyless task version.",
        ...taskDescriptorSchema(config),
        $defs: {
            taskSchema: taskSchemaDefinition(config),
        },
    };
}

/**
 * Renders the normative exact task artifact-lock v1 JSON Schema.
 *
 * @param config - Validated protocol configuration.
 * @returns The configured closed task artifact-lock schema.
 */
export function renderTaskArtifactLockSchema(config: ProtocolConfig): Schema {
    return {
        $schema: config.kernel.schemas.dialect,
        $id: config.tasks.schemas.artifactLockId,
        $comment: "Generated from protocol.config.json. Do not edit directly.",
        title: "Shepherd Task Artifact Lock v1",
        description: "Exact content-addressed citation for one immutable task artifact revision.",
        ...taskArtifactLockSchema(config),
    };
}

/**
 * Renders the normative task value v1 JSON Schema: one descriptor artifact with its exact lock.
 *
 * The published identifier is also the document `schema.task()` emits, so a task value can be
 * typed as a task input or output without embedding the descriptor grammar in every artifact.
 *
 * @param config - Validated protocol configuration.
 * @returns The configured closed task-value schema.
 */
export function renderTaskValueSchema(config: ProtocolConfig): Schema {
    return {
        $schema: config.kernel.schemas.dialect,
        $id: config.tasks.schemas.valueId,
        $comment: "Generated from protocol.config.json. Do not edit directly.",
        title: "Shepherd Task Value v1",
        description:
            "Canonical serializable task: the bodyless descriptor artifact and its exact artifact lock.",
        ...taskValueSchema(),
        $defs: taskValueDefinitions(config),
    };
}

/**
 * Renders the shared `$defs` entries that describe a task value inline.
 *
 * @param config - Validated protocol configuration.
 * @returns Definitions for `taskSchema`, `taskDescriptor`, `taskArtifactLock`, and `taskValue`.
 */
export function taskValueDefinitions(config: ProtocolConfig): Schema {
    return {
        taskArtifactLock: taskArtifactLockSchema(config),
        taskDescriptor: taskDescriptorSchema(config),
        taskSchema: taskSchemaDefinition(config),
        taskValue: taskValueSchema(),
    };
}

function taskValueSchema(): Schema {
    return {
        type: "object",
        required: ["artifact", "artifact_lock"],
        properties: {
            artifact: { $ref: "#/$defs/taskDescriptor" },
            artifact_lock: { $ref: "#/$defs/taskArtifactLock" },
        },
        additionalProperties: false,
    };
}

function taskDescriptorSchema(config: ProtocolConfig): Schema {
    return {
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
    };
}

function taskSchemaDefinition(config: ProtocolConfig): Schema {
    return {
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
            {
                type: "object",
                required: ["$ref"],
                properties: { $ref: { const: config.tasks.schemas.valueId } },
                additionalProperties: false,
            },
            {
                type: "object",
                required: ["type"],
                properties: { type: { enum: ["boolean", "integer", "number"] } },
                additionalProperties: false,
            },
            {
                type: "object",
                required: ["items", "type"],
                properties: {
                    items: { $ref: "#/$defs/taskSchema" },
                    type: { const: "array" },
                },
                additionalProperties: false,
            },
            {
                type: "object",
                required: ["enum"],
                properties: {
                    enum: {
                        type: "array",
                        items: TASK_SCHEMA_SCALAR,
                        minItems: 1,
                        uniqueItems: true,
                    },
                },
                additionalProperties: false,
            },
            {
                type: "object",
                required: ["const"],
                properties: { const: TASK_SCHEMA_SCALAR },
                additionalProperties: false,
            },
            {
                type: "object",
                required: ["oneOf"],
                properties: {
                    oneOf: {
                        type: "array",
                        items: { $ref: "#/$defs/taskSchema" },
                        minItems: 2,
                        uniqueItems: true,
                    },
                },
                additionalProperties: false,
            },
        ],
    };
}

/**
 * Renders the closed task artifact-lock schema fragment.
 *
 * @param config - Validated protocol configuration.
 * @returns The inline task artifact-lock schema.
 */
export function taskArtifactLockSchema(config: ProtocolConfig): Schema {
    const digestPattern = `${escapeRegularExpression(config.tasks.digestPrefix)}[0-9a-f]{${
        config.tasks.hexLength
    }}`;
    return {
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
