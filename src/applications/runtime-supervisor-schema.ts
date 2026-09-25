import { createHash } from "node:crypto";

import type { ProtocolConfig } from "../protocol/config-types.ts";

/** Configuration sections the runtime supervision record schema is derived from. @internal */
export type RuntimeSupervisionSchemaConfig = Pick<
    ProtocolConfig,
    "applications" | "kernel" | "providers" | "recordId" | "supervision"
>;

type Schema = Readonly<Record<string, unknown>>;

/**
 * Renders the closed JSON Schema of every runtime supervision record body, without `$schema` and
 * `$id`, in the subset `compileJSONSchema` accepts. The runtime validates every record it writes
 * and reads against it, and the protocol generator publishes it as
 * `application-runtime-supervision-v1.schema.json`.
 *
 * @param config - Applications, kernel, provider, record identity, and supervision configuration.
 * @returns The configured closed record schema.
 * @internal
 */
export function renderRuntimeSupervisionRecordSchema(
    config: RuntimeSupervisionSchemaConfig,
): Schema {
    const applications = config.applications;
    const runtime = applications.runtimeSupervision;
    const [opened, tick, settled, attempt, turn, completed] = runtime.phases as readonly [
        string,
        string,
        string,
        string,
        string,
        string,
    ];
    const [codingSupervisorKind] = applications.kinds;
    const [, ...terminalStatuses] = runtime.attemptStatuses;
    const [, ...interventions] = runtime.actions;
    const digestHexLength = createHash(applications.identity.digestAlgorithm).digest("hex").length;
    const text = { minLength: 1, type: "string" };
    const count = { minimum: 0, type: "integer" };
    const ordinal = { minimum: 1, type: "integer" };
    const nullable = (schema: Schema): Schema => ({ oneOf: [{ type: "null" }, schema] });
    const prefixed = (prefix: string, hexLength: number): Schema => ({
        pattern: `^${escapePattern(prefix)}[0-9a-f]{${hexLength}}$`,
        type: "string",
    });
    const applicationId = prefixed(applications.identity.applicationIdPrefix, digestHexLength);
    const digest = prefixed(`${applications.identity.digestAlgorithm}:`, digestHexLength);
    const usage = {
        additionalProperties: false,
        properties: {
            cacheCreationInputTokens: count,
            cacheReadInputTokens: count,
            costUsd: nullable({ minimum: 0, type: "number" }),
            inputTokens: count,
            outputTokens: count,
        },
        required: [
            "cacheCreationInputTokens",
            "cacheReadInputTokens",
            "costUsd",
            "inputTokens",
            "outputTokens",
        ],
        type: "object",
    };
    const message = {
        properties: { content: { type: "array" }, role: text },
        required: ["content", "role"],
        type: "object",
    };
    const summary = {
        additionalProperties: false,
        properties: {
            error: nullable(text),
            status: { enum: [...config.providers.tools.loop.dispositions] },
            target: nullable(text),
            tool: text,
        },
        required: ["error", "status", "target", "tool"],
        type: "object",
    };
    const decision = renderRuntimeSupervisionDecisionSchema(runtime.actions);
    const cursor = {
        additionalProperties: false,
        properties: {
            compatibility_version: { const: config.supervision.compatibilityVersion },
            cursor_id: prefixed(
                config.supervision.identity.cursorIdPrefix,
                config.recordId.hexLength,
            ),
            cursor_version: { const: config.supervision.subscriptions.cursorVersion },
            positions: {
                items: {
                    additionalProperties: false,
                    properties: {
                        next_ordinal: {
                            minimum: config.kernel.append.firstOwnerOrdinal,
                            type: "integer",
                        },
                        owner_id: text,
                    },
                    required: ["next_ordinal", "owner_id"],
                    type: "object",
                },
                maxItems: applications.limits.maxWorkers,
                minItems: applications.limits.minWorkers,
                type: "array",
            },
        },
        required: ["compatibility_version", "cursor_id", "cursor_version", "positions"],
        type: "object",
    };
    const body = (phase: string, properties: Readonly<Record<string, unknown>>): Schema => ({
        additionalProperties: false,
        properties: {
            application_id: applicationId,
            application_version: { const: applications.recordVersion },
            compatibility_version: { const: applications.compatibilityVersion },
            phase: { const: phase },
            ...properties,
        },
        required: [
            "application_id",
            "application_version",
            "compatibility_version",
            "phase",
            ...Object.keys(properties),
        ].sort(),
        type: "object",
    });
    const workerBound = {
        maxItems: applications.limits.maxWorkers,
        minItems: applications.limits.minWorkers,
    };
    return {
        oneOf: [
            body(opened, {
                command_id: text,
                kind: { const: codingSupervisorKind },
                protocol_id: prefixed(applications.identity.protocolIdPrefix, digestHexLength),
                supervisor_id: text,
                workers: {
                    items: {
                        additionalProperties: false,
                        properties: { stream_id: applicationId, worker_id: text },
                        required: ["stream_id", "worker_id"],
                        type: "object",
                    },
                    ...workerBound,
                    type: "array",
                },
            }),
            body(tick, {
                cursor,
                decisions: { items: decision, type: "array" },
                output: true,
                refusal: nullable({
                    additionalProperties: false,
                    properties: { issues: { items: text, minItems: 1, type: "array" } },
                    required: ["issues"],
                    type: "object",
                }),
                snapshot: { type: "object" },
                supervisor_id: text,
                tick: { maximum: applications.limits.maxTicks, minimum: 1, type: "integer" },
                usage: nullable(usage),
            }),
            body(settled, {
                discard_custody_ids: { items: text, type: "array", uniqueItems: true },
                ticks: count,
                undelivered: {
                    items: {
                        additionalProperties: false,
                        properties: { tick: ordinal, worker_id: text },
                        required: ["tick", "worker_id"],
                        type: "object",
                    },
                    type: "array",
                },
                workers: {
                    items: {
                        additionalProperties: false,
                        properties: {
                            attempt: ordinal,
                            custody_id: text,
                            status: { enum: [...terminalStatuses] },
                            worker_id: text,
                        },
                        required: ["attempt", "custody_id", "status", "worker_id"],
                        type: "object",
                    },
                    ...workerBound,
                    type: "array",
                },
            }),
            body(attempt, {
                attempt: ordinal,
                cause: { enum: [...runtime.attemptCauses] },
                custody: {
                    additionalProperties: false,
                    properties: {
                        custody_id: text,
                        receipt_id: text,
                        source_custody_id: nullable(text),
                    },
                    required: ["custody_id", "receipt_id", "source_custody_id"],
                    type: "object",
                },
                guidance: nullable(text),
                leader: nullable(text),
                tick: count,
                worker_id: text,
            }),
            body(turn, {
                assistant: message,
                attempt: ordinal,
                cache_prefix_messages: count,
                calls: { items: summary, type: "array" },
                guidance_ticks: { items: ordinal, type: "array", uniqueItems: true },
                index: count,
                message_count: ordinal,
                output: true,
                request_digest: digest,
                results: nullable(message),
                usage,
                worker_id: text,
            }),
            body(completed, {
                attempt: ordinal,
                cause: nullable({
                    additionalProperties: false,
                    properties: { action: { enum: interventions }, tick: ordinal },
                    required: ["action", "tick"],
                    type: "object",
                }),
                error: nullable({
                    maxLength: applications.limits.maxReasonLength,
                    minLength: 1,
                    type: "string",
                }),
                output: true,
                status: { enum: [...terminalStatuses] },
                worker_id: text,
            }),
        ],
    };
}

/**
 * Renders the closed JSON Schema of one retained runtime supervision decision, the item schema of a
 * tick record's `decisions`. Admission checks every policy output against it as well as against the
 * protocol's own action schema, so a looser protocol schema cannot admit a decision the record
 * schema would refuse.
 *
 * @param actions - Configured runtime supervision actions.
 * @returns The closed decision schema.
 * @internal
 */
export function renderRuntimeSupervisionDecisionSchema(actions: readonly string[]): Schema {
    const text = { minLength: 1, type: "string" };
    return {
        additionalProperties: false,
        properties: {
            action: { enum: [...actions] },
            agent: text,
            guidance: text,
            leader: text,
            reason: text,
        },
        required: ["action", "agent", "reason"],
        type: "object",
    };
}

function escapePattern(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
