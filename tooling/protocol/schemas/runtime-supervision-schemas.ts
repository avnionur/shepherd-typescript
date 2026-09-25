import { renderRuntimeSupervisionRecordSchema } from "../../../src/applications/runtime-supervisor-schema.ts";
import type { ProtocolConfig } from "../../../src/protocol/config-types.ts";

/**
 * Renders the configured runtime supervision record JSON Schema: the opened, tick, and settled
 * records of the application path and the attempt, turn, and completed records of every worker
 * stream. The body is the exact schema the runtime validates every record against.
 *
 * @param config - Validated protocol configuration.
 * @returns The configured closed runtime supervision schema.
 */
export function renderApplicationRuntimeSupervisionSchema(
    config: ProtocolConfig,
): Readonly<Record<string, unknown>> {
    const applications = config.applications;
    return {
        $schema: config.kernel.schemas.dialect,
        $id: applications.schemas.runtimeSupervisionId,
        $comment: "Generated from protocol.config.json. Do not edit directly.",
        title: `Shepherd Application Runtime Supervision Record v${applications.recordVersion}`,
        description:
            "Closed records of one concurrent runtime supervisor run (paper Section 5.1 and Appendix E): the opened, per-tick batched decision, and settled records of the application path and the attempt, turn, and completed records of every worker stream.",
        ...renderRuntimeSupervisionRecordSchema(config),
    };
}
