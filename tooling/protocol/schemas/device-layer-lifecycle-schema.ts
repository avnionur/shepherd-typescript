import type { ProtocolConfig } from "../../../src/protocol/config-types.ts";

type Schema = Readonly<Record<string, unknown>>;

/** Renders the closed local device lifecycle journal and deterministic publication plan. */
export function renderDeviceLayerLifecycleSchema(protocol: ProtocolConfig): Schema {
    const device = protocol.workspaces.deviceLayers;
    const config = device.retained;
    const text = { type: "string", minLength: 1 };
    const nullable = (schema: Schema) => ({ oneOf: [{ type: "null" }, schema] });
    const digest = (prefix: string) => ({
        type: "string",
        pattern: `^${prefix.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}[0-9a-f]{${protocol.recordId.hexLength}}$`,
    });
    const recordId = digest(protocol.recordId.prefix);
    const identity = closed({
        device: { type: "string", pattern: "^[0-9]+$" },
        inode: { type: "string", pattern: "^[0-9]+$" },
    });
    const checkpoint = { type: "string", pattern: device.checkpointNamePattern };
    const layerId = { type: "string", pattern: `^[0-9]{${device.layerNameWidth},}$` };
    const depth = closed({
        maxDepth: { type: "integer", minimum: 3, maximum: device.depth.maxDepth },
        retainNewest: { type: "integer", minimum: 1, maximum: device.depth.maxDepth - 2 },
    });
    const plannedTree = closed({
        directory: text,
        identity: nullable(identity),
        payload_identity: nullable(identity),
        content_id: nullable(recordId),
    });
    const ownedTree = closed({
        directory: text,
        identity,
        payload_identity: identity,
        content_id: nullable(recordId),
    });
    const state = closed({
        adapter: { enum: Object.values(config.adapters) },
        configuration_id: digest(config.configurationIdPrefix),
        root: text,
        parent_identity: identity,
        root_identity: nullable(identity),
        layers_identity: nullable(identity),
        ownership_key: text,
        depth,
        generation: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
        ordinal: { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
        layers: {
            type: "array",
            maxItems: device.depth.maxDepth,
            items: closed({ checkpoint, layer: layerId, tree: plannedTree }),
        },
        retired: { type: "array", uniqueItems: true, items: checkpoint },
        writable: nullable(plannedTree),
        garbage: { type: "array", maxItems: device.depth.maxDepth + 1, items: ownedTree },
        cleaned: { type: "boolean" },
    });
    const plan = closed({
        copies: {
            type: "array",
            items: closed({ source: nullable(text), target: text, content_id: recordId }),
        },
        next: { $ref: "#/$defs/state" },
        checkpoint: nullable(checkpoint),
        layer: nullable(layerId),
        discarded: { type: "array", uniqueItems: true, items: checkpoint },
        compaction: nullable(
            closed({
                into: layerId,
                layers: { type: "array", minItems: 1, uniqueItems: true, items: layerId },
                retired: { type: "array", uniqueItems: true, items: checkpoint },
            }),
        ),
    });
    const requests = [
        closed({
            operation: { const: config.actions.open },
            root: text,
            seed: nullable(text),
            adapter: { enum: Object.values(config.adapters) },
            depth,
            configuration_id: digest(config.configurationIdPrefix),
        }),
        ...[config.actions.checkpoint, config.actions.restore, config.actions.cleanup].map(
            (operation) =>
                closed({
                    operation: { const: operation },
                    device_id: digest(config.ownerIdPrefix),
                    name: operation === config.actions.cleanup ? { type: "null" } : checkpoint,
                }),
        ),
    ];
    return {
        $schema: protocol.kernel.schemas.dialect,
        $id: config.schemaId,
        title: `Shepherd Retained Device Layer Lifecycle v${config.recordVersion}`,
        $comment:
            "Generated from protocol.config.json. Runtime additionally verifies the complete causal journal, exact requests and deterministic plans, immutable ownership, physical database and directory identities, payload receipts, content digests, mount boundaries and exact-head admission. Imported records do not provide local physical authority.",
        ...closed({
            compatibility_version: { const: config.compatibilityVersion },
            record_version: { const: config.recordVersion },
            device_id: digest(config.ownerIdPrefix),
            command_id: text,
            operation: { enum: Object.values(config.actions) },
            phase: { enum: Object.values(config.phases) },
            request: { oneOf: requests },
            state: { $ref: "#/$defs/state" },
            plan,
            recovery: nullable(closed({ command_id: text, expected_head_record_id: recordId })),
        }),
        $defs: { state },
    };
}

function closed(properties: Record<string, unknown>): Schema {
    return {
        type: "object",
        properties,
        required: Object.keys(properties).sort(),
        additionalProperties: false,
    };
}
