import type { ProtocolConfig } from "../src/protocol/config-types.ts";

/** Renders the configured continuation-descriptor JSON Schema. */
export function renderRunContinuationDescriptorSchema(
    config: ProtocolConfig,
): Readonly<Record<string, unknown>> {
    const verifiedStatus = config.runs.execution.continuationVerifiedStatus;
    const receiptlessStatuses = config.runs.execution.continuationEvidenceStatuses.filter(
        (status) => status !== verifiedStatus,
    );
    return {
        $schema: config.kernel.schemas.dialect,
        $id: config.runs.schemas.continuationDescriptorId,
        $comment: "Generated from protocol.config.json. Do not edit directly.",
        title: `Shepherd Run Continuation Descriptor v${config.runs.execution.continuationVersion}`,
        description:
            "Ordered evidence classification for every configured run-continuation constituent.",
        type: "object",
        required: ["continuation_version", "execution_id", "trace_cut_id", "constituents"],
        properties: {
            continuation_version: { const: config.runs.execution.continuationVersion },
            execution_id: nonEmptyStringSchema(),
            trace_cut_id: nonEmptyStringSchema(),
            constituents: {
                type: "array",
                prefixItems: config.runs.execution.continuationConstituentKinds.map((kind) => ({
                    oneOf: [
                        {
                            type: "object",
                            required: ["kind", "status", "receipt_id"],
                            properties: {
                                kind: { const: kind },
                                status: { const: verifiedStatus },
                                receipt_id: nonEmptyStringSchema(),
                            },
                            additionalProperties: false,
                        },
                        {
                            type: "object",
                            required: ["kind", "status"],
                            properties: {
                                kind: { const: kind },
                                status: { enum: receiptlessStatuses },
                            },
                            additionalProperties: false,
                        },
                    ],
                })),
                minItems: config.runs.execution.continuationConstituentKinds.length,
                maxItems: config.runs.execution.continuationConstituentKinds.length,
            },
        },
        additionalProperties: false,
    };
}

/** Renders the configured prerequisite-driven waiting lifecycle JSON Schema. */
export function renderRunWaitingLifecycleSchema(
    config: ProtocolConfig,
): Readonly<Record<string, unknown>> {
    return lifecycleSchema(
        config,
        config.runs.schemas.waitingLifecycleId,
        config.runs.execution.lifecycleWaitingStatus,
        "Prerequisite-driven quiescent run lifecycle evidence.",
        {
            prerequisite: {
                type: "object",
                required: ["prerequisite_id", "kind"],
                properties: {
                    prerequisite_id: nonEmptyStringSchema(),
                    kind: nonEmptyStringSchema(),
                },
                additionalProperties: false,
            },
        },
    );
}

/** Renders the configured control-driven suspended lifecycle JSON Schema. */
export function renderRunSuspendedLifecycleSchema(
    config: ProtocolConfig,
): Readonly<Record<string, unknown>> {
    return lifecycleSchema(
        config,
        config.runs.schemas.suspendedLifecycleId,
        config.runs.execution.lifecycleSuspendedStatus,
        "Command-authorized quiescent run lifecycle evidence.",
        {
            pause_command_id: {
                type: "string",
                pattern: configuredRecordIdPattern(config),
            },
        },
    );
}

/** Renders the configured command-bound running-continuation lifecycle JSON Schema. */
export function renderRunRunningLifecycleSchema(
    config: ProtocolConfig,
): Readonly<Record<string, unknown>> {
    return lifecycleSchema(
        config,
        config.runs.schemas.runningLifecycleId,
        config.runs.execution.lifecycleRunningStatus,
        "Command-authorized running continuation with a newly fenced worker claim.",
        {
            resume_command_id: {
                type: "string",
                pattern: configuredRecordIdPattern(config),
            },
            claim_id: nonEmptyStringSchema(),
            fencing_token: { type: "integer", minimum: 1 },
            lease_expires_at: { type: "integer", minimum: 0 },
        },
    );
}

function lifecycleSchema(
    config: ProtocolConfig,
    schemaId: string,
    status: string,
    description: string,
    additionalProperties: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
): Readonly<Record<string, unknown>> {
    const additionalKeys = Object.keys(additionalProperties);
    return {
        $schema: config.kernel.schemas.dialect,
        $id: schemaId,
        $comment: "Generated from protocol.config.json. Do not edit directly.",
        title: `Shepherd Run Lifecycle ${status} v${config.runs.execution.lifecycleVersion}`,
        description,
        type: "object",
        required: [
            "lifecycle_version",
            "execution_id",
            "status",
            "continuation_descriptor_id",
            ...additionalKeys,
        ],
        properties: {
            lifecycle_version: { const: config.runs.execution.lifecycleVersion },
            execution_id: nonEmptyStringSchema(),
            status: { const: status },
            continuation_descriptor_id: {
                type: "string",
                pattern: configuredRecordIdPattern(config),
            },
            ...additionalProperties,
        },
        additionalProperties: false,
    };
}

function configuredRecordIdPattern(config: ProtocolConfig): string {
    const prefix = config.recordId.prefix.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    return `^${prefix}[0-9a-f]{${config.recordId.hexLength}}$`;
}

function nonEmptyStringSchema(): Readonly<Record<string, unknown>> {
    return { type: "string", minLength: 1 };
}
