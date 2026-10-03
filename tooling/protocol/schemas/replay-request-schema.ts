import type { ProtocolConfig } from "../../../src/protocol/config-types.ts";
import { renderReplaySessionSchema } from "./replay-schemas.ts";

/**
 * Renders the normalized branch-request journal schema, embedding the validated session contract.
 * @param config - Validated repository protocol configuration.
 * @returns A closed, separately versioned request schema.
 */
export function renderReplayBranchRequestSchema(
    config: ProtocolConfig,
): Readonly<Record<string, unknown>> {
    const replay = config.replay;
    const request = replay.branch.request;
    const session = { ...renderReplaySessionSchema(config) };
    const definitions = session.$defs as Readonly<Record<string, unknown>>;
    // Keep embedded references local without registering the standalone session schema twice.
    delete session.$id;
    delete session.$defs;
    return {
        $schema: config.kernel.schemas.dialect,
        $id: request.schemaId,
        $comment: "Generated from protocol.config.json. Do not edit directly.",
        title: `Shepherd Replay Branch Request v${request.recordVersion}`,
        type: "object",
        required: [
            "checkpoint_policy",
            "compatibility_version",
            "request_version",
            "session",
            "source_disposition",
        ],
        properties: {
            compatibility_version: { const: request.compatibilityVersion },
            request_version: { const: request.recordVersion },
            session: { $ref: "#/$defs/session" },
            source_disposition: { enum: [...replay.branch.sourceDispositions] },
            checkpoint_policy: {
                oneOf: [
                    { type: "null" },
                    {
                        type: "object",
                        required: ["interval", "kind"],
                        additionalProperties: false,
                        properties: {
                            kind: { enum: replay.checkpoint.automatic.policies.slice(0, 3) },
                            interval: { type: "null" },
                        },
                    },
                    {
                        type: "object",
                        required: ["interval", "kind"],
                        additionalProperties: false,
                        properties: {
                            kind: { const: replay.checkpoint.automatic.policies[3] },
                            interval: {
                                type: "integer",
                                minimum: 1,
                                maximum: replay.limits.maxSteps,
                            },
                        },
                    },
                ],
            },
        },
        additionalProperties: false,
        $defs: { ...definitions, session },
        oneOf: [
            {
                properties: {
                    session: {
                        type: "object",
                        properties: {
                            mode: { const: replay.modes[1] },
                            origin: { type: "object" },
                        },
                    },
                    checkpoint_policy: { type: "null" },
                },
            },
            {
                properties: {
                    session: {
                        type: "object",
                        properties: {
                            mode: { const: replay.modes[2] },
                            origin: { type: "object" },
                        },
                    },
                    checkpoint_policy: { type: "object" },
                },
            },
        ],
    };
}
