import path from "node:path";
import { workspaceProtocolConfig } from "../protocol/config.ts";
import { layerName } from "./device-layer.ts";
import { DeviceLayerError } from "./errors.ts";
import type { RetainedDeviceTree } from "./retained-device-files.ts";
import type {
    PlannedDeviceTree,
    RetainedDevicePlan,
    RetainedDeviceState,
} from "./retained-device-records.ts";

const device = workspaceProtocolConfig.deviceLayers;
const config = device.retained;

/** Derives a deterministic lifecycle plan from exact prior state and captured content. @internal */
export function planRetainedDeviceCommand(
    state: RetainedDeviceState,
    action: string,
    name: string | undefined,
    contentId: string | null,
): RetainedDevicePlan {
    const generation = state.generation + 1;
    if (!Number.isSafeInteger(generation))
        throw new TypeError("retained device generation is exhausted");
    if (action === config.actions.cleanup)
        return {
            copies: [],
            next: {
                ...state,
                generation,
                layers: [],
                writable: null,
                cleaned: true,
                garbage: [
                    ...state.layers.map((layer) => layer.tree as RetainedDeviceTree),
                    state.writable as RetainedDeviceTree,
                ],
            },
            checkpoint: null,
            layer: null,
            discarded: [],
            compaction: null,
        };
    if (action === config.actions.restore) {
        const index = state.layers.findIndex((layer) => layer.checkpoint === name);
        if (index < 0)
            throw new DeviceLayerError(
                state.retired.includes(name as string)
                    ? device.errors.checkpointRetiredCode
                    : device.errors.checkpointUnknownCode,
                "retained checkpoint is retired or unknown",
            );
        const kept = state.layers.slice(0, index + 1);
        const top = kept.at(-1) as (typeof kept)[number];
        const writable: PlannedDeviceTree = {
            directory: path.join(
                state.root,
                config.writableDirectoryPrefix + layerName(generation),
            ),
            identity: null,
            payload_identity: null,
            content_id: null,
        };
        return {
            copies: [
                {
                    source: path.join(top.tree.directory, config.treeDirectory),
                    target: writable.directory,
                    content_id: top.tree.content_id as string,
                },
            ],
            next: {
                ...state,
                generation,
                layers: kept,
                writable,
                garbage: [
                    ...state.layers
                        .slice(index + 1)
                        .map((layer) => layer.tree as RetainedDeviceTree),
                    state.writable as RetainedDeviceTree,
                ],
            },
            checkpoint: name as string,
            layer: null,
            discarded: state.layers.slice(index + 1).map((layer) => layer.checkpoint),
            compaction: null,
        };
    }
    if (
        typeof name !== "string" ||
        !new RegExp(device.checkpointNamePattern, "u").test(name) ||
        state.retired.includes(name) ||
        state.layers.some((layer) => layer.checkpoint === name)
    )
        throw new DeviceLayerError(
            device.errors.checkpointInvalidCode,
            "retained checkpoint name is invalid or in use",
        );
    const layer = layerName(state.ordinal);
    const source = path.join((state.writable as PlannedDeviceTree).directory, config.treeDirectory);
    if (contentId === null)
        throw new TypeError("checkpoint plan requires captured content identity");
    const tree: PlannedDeviceTree = {
        directory: path.join(state.root, config.layersDirectory, layer),
        identity: null,
        payload_identity: null,
        content_id: contentId,
    };
    let layers = [...state.layers, { checkpoint: name, layer, tree }];
    let ordinal = state.ordinal + 1;
    const copies = [{ source, target: tree.directory, content_id: contentId }];
    let compaction: RetainedDevicePlan["compaction"] = null;
    let retired = [...state.retired];
    let garbage: RetainedDeviceTree[] = [];
    if (layers.length > state.depth.maxDepth) {
        const flattened = layers.slice(0, layers.length - state.depth.retainNewest);
        const newest = flattened.at(-1) as (typeof flattened)[number];
        const into = layerName(ordinal++);
        const replacement = {
            ...newest,
            layer: into,
            tree: {
                ...newest.tree,
                directory: path.join(state.root, config.layersDirectory, into),
                identity: null,
                payload_identity: null,
            },
        };
        copies.push({
            source: path.join(newest.tree.directory, config.treeDirectory),
            target: replacement.tree.directory,
            content_id: newest.tree.content_id as string,
        });
        const retiredNames = flattened.slice(0, -1).map((entry) => entry.checkpoint);
        compaction = { into, layers: flattened.map((entry) => entry.layer), retired: retiredNames };
        retired = [...retired, ...retiredNames];
        garbage = flattened.map((entry) => entry.tree as RetainedDeviceTree);
        layers = [replacement, ...layers.slice(flattened.length)];
    }
    if (!Number.isSafeInteger(ordinal))
        throw new TypeError("retained device layer ordinal is exhausted");
    return {
        copies,
        next: { ...state, generation, ordinal, layers, retired, garbage },
        checkpoint: name,
        layer,
        discarded: [],
        compaction,
    };
}

/** Derives initial layer and writable publication from a captured seed identity. @internal */
export function planRetainedDeviceCreation(
    state: RetainedDeviceState,
    seed: string | null,
    sourceContent: string,
): RetainedDevicePlan {
    const base = layerName(0);
    const frozen: PlannedDeviceTree = {
        directory: path.join(state.root, config.layersDirectory, base),
        identity: null,
        payload_identity: null,
        content_id: sourceContent,
    };
    const writable: PlannedDeviceTree = {
        directory: path.join(state.root, config.writableDirectoryPrefix + layerName(0)),
        identity: null,
        payload_identity: null,
        content_id: null,
    };
    return {
        copies: [
            { source: seed, target: frozen.directory, content_id: sourceContent },
            {
                source: path.join(frozen.directory, config.treeDirectory),
                target: writable.directory,
                content_id: sourceContent,
            },
        ],
        next: {
            ...state,
            layers: [{ checkpoint: device.baseCheckpointName, layer: base, tree: frozen }],
            writable,
        },
        checkpoint: null,
        layer: null,
        discarded: [],
        compaction: null,
    };
}
