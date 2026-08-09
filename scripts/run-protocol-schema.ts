import type { ProtocolConfig } from "../src/protocol/config-types.ts";

/** Renders the normative terminal run-outcome v1 JSON Schema. */
export function renderRunOutcomeSchema(config: ProtocolConfig): Readonly<Record<string, unknown>> {
    const [finished, failed, exhausted, cancelled] = config.runs.terminalStatuses;
    return {
        $schema: config.kernel.schemas.dialect,
        $id: config.runs.schemas.outcomeId,
        $comment: "Generated from protocol.config.json. Do not edit directly.",
        title: "Shepherd Run Outcome v1",
        description: "Exactly one inspectable terminal result for a task run.",
        type: "object",
        required: ["outcome_version", "run_id", "task_artifact_lock", "outcome"],
        properties: {
            outcome_version: { const: config.runs.outcomeVersion },
            run_id: { type: "string", minLength: 1 },
            task_artifact_lock: { $ref: "#/$defs/taskArtifactLock" },
            outcome: {
                oneOf: [
                    {
                        type: "object",
                        required: ["status", "value"],
                        properties: {
                            status: { const: finished },
                            value: { $ref: "#/$defs/semanticValue" },
                        },
                        additionalProperties: false,
                    },
                    {
                        type: "object",
                        required: ["error_type", "message", "retryable", "status"],
                        properties: {
                            error_type: { type: "string", minLength: 1 },
                            message: { type: "string", minLength: 1 },
                            retryable: { type: ["boolean", "null"] },
                            status: { const: failed },
                        },
                        additionalProperties: false,
                    },
                    ...[exhausted, cancelled].map((status) => ({
                        type: "object",
                        required: ["reason", "status"],
                        properties: {
                            reason: { type: "string", minLength: 1 },
                            status: { const: status },
                        },
                        additionalProperties: false,
                    })),
                ],
            },
        },
        additionalProperties: false,
        $defs: {
            semanticValue: semanticValueSchema(),
            taskArtifactLock: taskArtifactLockSchema(config),
        },
    };
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

function taskArtifactLockSchema(config: ProtocolConfig): Readonly<Record<string, unknown>> {
    const digestPattern = `^${escapeRegularExpression(config.tasks.digestPrefix)}[0-9a-f]{${
        config.tasks.hexLength
    }}$`;
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
            artifact_digest: { type: "string", pattern: digestPattern },
            artifact_lock_version: { const: config.tasks.artifactLockVersion },
            compatibility_version: { const: config.tasks.compatibilityVersion },
            descriptor_version: { const: config.tasks.descriptorVersion },
            schema_digest: { type: "string", pattern: digestPattern },
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
