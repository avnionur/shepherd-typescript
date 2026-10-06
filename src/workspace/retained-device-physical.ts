import { lstatSync, readdirSync, rmdirSync } from "node:fs";
import path from "node:path";
import { syncDirectory } from "../blob/directory-durability.ts";
import type { SemanticRecord } from "../canonical/canonical-record.ts";
import { workspaceProtocolConfig } from "../protocol/config.ts";
import { assertRecordId } from "../record/guards.ts";
import { removePathSync } from "../runtime/remove-path.ts";
import { assertPrefixedDigest, readScopeDataObject } from "../scope/validation.ts";
import { layerName } from "./device-layer.ts";
import {
    assertDeviceDirectory,
    assertDeviceMarker,
    assertRetainedDeviceMounts,
    assertRetainedDeviceTreeBoundary,
    type DeviceDirectoryIdentity,
    deviceDirectoryIdentity,
    ensureDeviceWrapper,
    publishDeviceTree,
    type RetainedDeviceTree,
    readDevicePayloadIdentity,
    retainedDeviceTreeIdentity,
} from "./retained-device-files.ts";
import {
    type PlannedDeviceTree,
    type RetainedDevicePlan,
    type RetainedDeviceState,
    retainedDeviceConfigurationId,
} from "./retained-device-records.ts";

const device = workspaceProtocolConfig.deviceLayers;
const config = device.retained;

/** Marker binds a private wrapper to exactly one journal and resource name. @internal */
export function retainedDeviceMarker(
    deviceId: string,
    state: RetainedDeviceState,
    directory: string,
): SemanticRecord {
    return {
        device_id: deviceId,
        ownership_key: state.ownership_key,
        resource: path.relative(state.root, directory),
        version: config.markerVersion,
    };
}

/** Validates every retained physical path before using it. @internal */
export function validateRetainedDeviceState(deviceId: string, state: RetainedDeviceState): void {
    if (
        !Number.isSafeInteger(state.generation) ||
        !Number.isSafeInteger(state.ordinal) ||
        state.generation < 0 ||
        state.ordinal < 1
    )
        throw new TypeError("retained device generation or ordinal is invalid");
    assertPrefixedDigest(deviceId, config.ownerIdPrefix, "retained device identity");
    const rootName = config.rootDirectoryPrefix + state.ownership_key;
    if (
        !path.isAbsolute(state.root) ||
        path.normalize(state.root) !== state.root ||
        path.basename(state.root) !== rootName ||
        state.configuration_id !== retainedDeviceConfigurationId() ||
        !Object.values(config.adapters).includes(state.adapter)
    )
        throw new TypeError("retained device configuration or root is incompatible");
    const identity = (value: DeviceDirectoryIdentity | null): void => {
        if (value === null) return;
        const fields = readScopeDataObject(value, ["device", "inode"], "device directory identity");
        if (!/^\d+$/u.test(fields.device as string) || !/^\d+$/u.test(fields.inode as string))
            throw new TypeError("retained device directory identity is invalid");
    };
    identity(state.parent_identity);
    identity(state.root_identity);
    identity(state.layers_identity);
    const depth = readScopeDataObject(
        state.depth,
        ["maxDepth", "retainNewest"],
        "retained device depth",
    );
    if (
        !Number.isSafeInteger(depth.maxDepth) ||
        !Number.isSafeInteger(depth.retainNewest) ||
        (depth.maxDepth as number) > device.depth.maxDepth ||
        (depth.retainNewest as number) < 1 ||
        (depth.retainNewest as number) > (depth.maxDepth as number) - 2 ||
        state.layers.length > (depth.maxDepth as number)
    )
        throw new TypeError("retained device depth is invalid");
    const namePattern = new RegExp(device.checkpointNamePattern, "u");
    const checkpoints = state.layers.map((layer) => layer.checkpoint);
    if (
        new Set([...checkpoints, ...state.retired]).size !==
            checkpoints.length + state.retired.length ||
        [...checkpoints, ...state.retired].some(
            (name) => typeof name !== "string" || !namePattern.test(name),
        )
    )
        throw new TypeError("retained device checkpoint names are invalid");
    const assertTree = (tree: PlannedDeviceTree): void => {
        const fields = readScopeDataObject(
            tree,
            ["directory", "identity", "payload_identity", "content_id"],
            "retained device tree",
        );
        identity(tree.identity);
        identity(tree.payload_identity);
        if (typeof fields.directory !== "string")
            throw new TypeError("retained device tree path is invalid");
        const relative = path.relative(state.root, tree.directory);
        const components = relative.split(path.sep);
        const layer =
            components.length === 2 &&
            components[0] === config.layersDirectory &&
            /^\d+$/u.test(components[1] as string);
        const writable =
            components.length === 1 &&
            components[0]?.startsWith(config.writableDirectoryPrefix) &&
            /^\d+$/u.test((components[0] as string).slice(config.writableDirectoryPrefix.length));
        if ((!layer && !writable) || path.join(state.root, relative) !== tree.directory)
            throw new TypeError("retained device tree escapes its owned layout");
        if (tree.content_id !== null)
            assertRecordId(tree.content_id, "retained device content identity");
    };
    for (const layer of state.layers) {
        readScopeDataObject(layer, ["checkpoint", "layer", "tree"], "retained device layer");
        if (
            !/^\d+$/u.test(layer.layer) ||
            layerName(Number(layer.layer)) !== layer.layer ||
            Number(layer.layer) >= state.ordinal ||
            layer.tree.directory !== path.join(state.root, config.layersDirectory, layer.layer) ||
            layer.tree.content_id === null
        )
            throw new TypeError("retained device layer identity is invalid");
        assertTree(layer.tree);
    }
    if (state.writable !== null) assertTree(state.writable);
    for (const tree of state.garbage) {
        assertTree(tree);
        if (tree.identity === null || tree.payload_identity === null)
            throw new TypeError("retained garbage has no ownership identity");
    }
    const paths = [
        ...state.layers.map((layer) => layer.tree.directory),
        ...(state.writable === null ? [] : [state.writable.directory]),
        ...state.garbage.map((tree) => tree.directory),
    ];
    if (new Set(paths).size !== paths.length)
        throw new TypeError("retained device resources overlap");
}

/** Verifies a committed resource wrapper and its immutable bytes when applicable. @internal */
export function assertRetainedDeviceTree(
    deviceId: string,
    state: RetainedDeviceState,
    tree: PlannedDeviceTree,
): void {
    if (tree.identity === null)
        throw new TypeError("retained device resource has not been published");
    assertDeviceDirectory(tree.directory, tree.identity);
    assertDeviceMarker(tree.directory, retainedDeviceMarker(deviceId, state, tree.directory));
    const names = readdirSync(tree.directory).sort();
    if (
        JSON.stringify(names) !==
        JSON.stringify(
            [config.ownershipFilename, config.payloadIdentityFilename, config.treeDirectory].sort(),
        )
    )
        throw new TypeError("retained device tree has unexpected wrapper entries");
    readDevicePayloadIdentity(
        tree.directory,
        retainedDeviceMarker(deviceId, state, tree.directory),
        tree.payload_identity,
    );
    const payload = path.join(tree.directory, config.treeDirectory);
    if (!lstatSync(payload).isDirectory())
        throw new TypeError("retained device payload is not a directory");
    if (tree.content_id !== null) {
        assertRetainedDeviceTreeBoundary(payload);
        if (tree.content_id !== retainedDeviceTreeIdentity(payload))
            throw new TypeError("retained device snapshot bytes changed");
    }
}

/** Verifies local ownership and all live trees without mutation. @internal */
export function assertRetainedDevicePhysical(
    deviceId: string,
    state: RetainedDeviceState,
    planned: readonly PlannedDeviceTree[] = [],
): void {
    validateRetainedDeviceState(deviceId, state);
    assertDeviceDirectory(path.dirname(state.root), state.parent_identity);
    if (state.root_identity === null || state.layers_identity === null)
        throw new TypeError("retained device resource root is not published");
    assertDeviceDirectory(state.root, state.root_identity);
    assertRetainedDeviceMounts(state.root);
    assertDeviceMarker(state.root, retainedDeviceMarker(deviceId, state, state.root));
    const layersRoot = path.join(state.root, config.layersDirectory);
    assertDeviceDirectory(layersRoot, state.layers_identity);
    assertDeviceMarker(layersRoot, retainedDeviceMarker(deviceId, state, layersRoot));
    for (const layer of state.layers) assertRetainedDeviceTree(deviceId, state, layer.tree);
    if (state.writable !== null) assertRetainedDeviceTree(deviceId, state, state.writable);
    const resources = [
        ...state.layers.map((layer) => layer.tree),
        ...(state.writable === null ? [] : [state.writable]),
        ...state.garbage,
        ...planned,
    ];
    const rootNames = new Set([
        config.ownershipFilename,
        config.layersDirectory,
        ...resources
            .filter((tree) => path.dirname(tree.directory) === state.root)
            .map((tree) => path.basename(tree.directory)),
    ]);
    const layerNames = new Set([
        config.ownershipFilename,
        ...resources
            .filter((tree) => path.dirname(tree.directory) === layersRoot)
            .map((tree) => path.basename(tree.directory)),
    ]);
    if (
        readdirSync(state.root).some((name) => !rootNames.has(name)) ||
        readdirSync(layersRoot).some((name) => !layerNames.has(name))
    )
        throw new TypeError("retained device root contains unowned entries");
}

/** Completes owned copy stages without deleting old generations, then returns publishable state. @internal */
export function materializeRetainedDevicePlan(
    deviceId: string,
    state: RetainedDeviceState,
    plan: RetainedDevicePlan,
): RetainedDeviceState {
    assertRetainedDevicePending(deviceId, state, plan, config.phases.prepared);
    const planned = [
        ...plan.next.layers.map((layer) => layer.tree),
        ...(plan.next.writable === null ? [] : [plan.next.writable]),
    ];
    const rootIdentity = ensureDeviceWrapper(
        state.root,
        retainedDeviceMarker(deviceId, state, state.root),
    );
    const layersRoot = path.join(state.root, config.layersDirectory);
    const layersIdentity = ensureDeviceWrapper(
        layersRoot,
        retainedDeviceMarker(deviceId, state, layersRoot),
    );
    const published = new Map<string, RetainedDeviceTree>();
    for (const [index, copy] of plan.copies.entries()) {
        if (!planned.some((tree) => tree.directory === copy.target))
            throw new TypeError("retained device copy target is not planned");
        if (copy.source !== null && !path.isAbsolute(copy.source))
            throw new TypeError("retained device source is not absolute");
        published.set(
            copy.target,
            publishDeviceTree(
                copy.target,
                retainedDeviceMarker(deviceId, state, copy.target),
                copy.source,
                copy.content_id,
                state.root_identity === null && index === 0 ? config.adapters.copy : state.adapter,
            ),
        );
    }
    const fill = (tree: PlannedDeviceTree): PlannedDeviceTree => ({
        ...tree,
        identity: published.get(tree.directory)?.identity ?? tree.identity,
        payload_identity: published.get(tree.directory)?.payload_identity ?? tree.payload_identity,
    });
    return {
        ...plan.next,
        root_identity: rootIdentity,
        layers_identity: layersIdentity,
        layers: plan.next.layers.map((layer) => ({ ...layer, tree: fill(layer.tree) })),
        writable: plan.next.writable === null ? null : fill(plan.next.writable),
    };
}

/** Removes only journal-owned garbage after new state is durably published. @internal */
export function cleanupRetainedDeviceGarbage(
    deviceId: string,
    state: RetainedDeviceState,
): RetainedDeviceState {
    if (!assertRetainedDeviceGarbage(deviceId, state)) return { ...state, garbage: [] };
    for (const tree of state.garbage) {
        if (lstatSync(tree.directory, { throwIfNoEntry: false }) !== undefined) {
            clearGarbageWrapper(
                tree.directory,
                tree.identity,
                retainedDeviceMarker(deviceId, state, tree.directory),
                tree.payload_identity,
            );
        }
    }
    if (state.cleaned) {
        const layersRoot = path.join(state.root, config.layersDirectory);
        if (lstatSync(layersRoot, { throwIfNoEntry: false }) !== undefined) {
            clearGarbageWrapper(
                layersRoot,
                state.layers_identity as DeviceDirectoryIdentity,
                retainedDeviceMarker(deviceId, state, layersRoot),
                null,
            );
        }
        clearGarbageWrapper(
            state.root,
            state.root_identity as DeviceDirectoryIdentity,
            retainedDeviceMarker(deviceId, state, state.root),
            null,
        );
    }
    return { ...state, garbage: [] };
}

function assertRetainedDeviceGarbage(deviceId: string, state: RetainedDeviceState): boolean {
    validateRetainedDeviceState(deviceId, state);
    assertDeviceDirectory(path.dirname(state.root), state.parent_identity);
    const rootExists = lstatSync(state.root, { throwIfNoEntry: false }) !== undefined;
    if (!rootExists) {
        if (!state.cleaned) throw new TypeError("retained device root disappeared");
        return false;
    }
    if (state.root_identity === null) throw new TypeError("retained device root lacks ownership");
    assertDeviceDirectory(state.root, state.root_identity);
    assertRetainedDeviceMounts(state.root);
    // The payload may be partly removed after process death; its owned wrapper must still match.
    for (const tree of state.garbage) {
        if (lstatSync(tree.directory, { throwIfNoEntry: false }) !== undefined) {
            assertGarbageWrapper(
                tree.directory,
                tree.identity,
                retainedDeviceMarker(deviceId, state, tree.directory),
                tree.payload_identity,
            );
        }
    }
    if (!state.cleaned) assertRetainedDevicePhysical(deviceId, state);
    else {
        const rootAllowed = new Set([
            config.ownershipFilename,
            config.layersDirectory,
            ...state.garbage
                .filter((tree) => path.dirname(tree.directory) === state.root)
                .map((tree) => path.basename(tree.directory)),
        ]);
        const rootEntries = readdirSync(state.root);
        if (rootEntries.some((name) => !rootAllowed.has(name)))
            throw new TypeError("cleanup root contains unowned entries");
        if (rootEntries.includes(config.ownershipFilename))
            assertDeviceMarker(state.root, retainedDeviceMarker(deviceId, state, state.root));
        else if (rootEntries.length > 0)
            throw new TypeError("cleanup root lost its ownership marker");
        const layersRoot = path.join(state.root, config.layersDirectory);
        if (lstatSync(layersRoot, { throwIfNoEntry: false }) !== undefined) {
            if (state.layers_identity === null)
                throw new TypeError("layer directory lacks ownership");
            assertDeviceDirectory(layersRoot, state.layers_identity);
            const allowed = new Set([
                config.ownershipFilename,
                ...state.garbage
                    .filter((tree) => path.dirname(tree.directory) === layersRoot)
                    .map((tree) => path.basename(tree.directory)),
            ]);
            const layerEntries = readdirSync(layersRoot);
            if (layerEntries.some((name) => !allowed.has(name)))
                throw new TypeError("cleanup layers contain unowned entries");
            if (layerEntries.includes(config.ownershipFilename))
                assertDeviceMarker(layersRoot, retainedDeviceMarker(deviceId, state, layersRoot));
            else if (layerEntries.length > 0)
                throw new TypeError("cleanup layers lost their ownership marker");
        }
    }
    return true;
}

function assertGarbageWrapper(
    directory: string,
    identity: DeviceDirectoryIdentity,
    marker: SemanticRecord,
    payloadIdentity: DeviceDirectoryIdentity | null,
): void {
    assertDeviceDirectory(directory, identity);
    const entries = readdirSync(directory);
    const hasMarker = entries.includes(config.ownershipFilename);
    if (!hasMarker && entries.length !== 0)
        throw new TypeError("partial cleanup lost its ownership marker");
    if (hasMarker) assertDeviceMarker(directory, marker);
    const allowed =
        payloadIdentity === null
            ? [config.ownershipFilename]
            : [config.ownershipFilename, config.payloadIdentityFilename, config.treeDirectory];
    if (entries.some((entry) => !allowed.includes(entry)))
        throw new TypeError("cleanup wrapper contains unowned entries");
    if (payloadIdentity !== null) {
        const payload = path.join(directory, config.treeDirectory);
        if (entries.includes(config.treeDirectory)) assertRetainedDeviceTreeBoundary(payload);
        if (entries.includes(config.payloadIdentityFilename))
            readDevicePayloadIdentity(directory, marker, payloadIdentity, true);
        else if (entries.includes(config.treeDirectory))
            throw new TypeError("cleanup payload lost its identity receipt");
    }
}

function clearGarbageWrapper(
    directory: string,
    identity: DeviceDirectoryIdentity,
    marker: SemanticRecord,
    payloadIdentity: DeviceDirectoryIdentity | null,
): void {
    assertGarbageWrapper(directory, identity, marker, payloadIdentity);
    if (payloadIdentity !== null) {
        const payload = path.join(directory, config.treeDirectory);
        if (lstatSync(payload, { throwIfNoEntry: false }) !== undefined)
            assertRetainedDeviceTreeBoundary(payload);
        removePathSync(path.join(directory, config.treeDirectory), {
            recursive: true,
            force: true,
        });
        syncDirectory(directory);
        removePathSync(path.join(directory, config.payloadIdentityFilename), { force: true });
    }
    syncDirectory(directory);
    removePathSync(path.join(directory, config.ownershipFilename), { force: true });
    syncDirectory(directory);
    rmdirSync(directory);
    syncDirectory(path.dirname(directory));
}

/** Diagnoses an interrupted physical phase without creating or deleting anything. @internal */
export function assertRetainedDevicePending(
    deviceId: string,
    state: RetainedDeviceState,
    plan: RetainedDevicePlan | null,
    phase: string,
): void {
    if (phase === config.phases.published) {
        assertRetainedDeviceGarbage(deviceId, state);
        return;
    }
    if (phase !== config.phases.prepared || plan === null)
        throw new TypeError("retained device pending phase has no plan");
    validateRetainedDeviceState(deviceId, state);
    validateRetainedDeviceState(deviceId, plan.next);
    assertDeviceDirectory(path.dirname(state.root), state.parent_identity);
    const planned = [
        ...plan.next.layers.map((layer) => layer.tree),
        ...(plan.next.writable === null ? [] : [plan.next.writable]),
    ];
    if (state.root_identity !== null) assertRetainedDevicePhysical(deviceId, state, planned);
    else if (lstatSync(state.root, { throwIfNoEntry: false }) !== undefined) {
        deviceDirectoryIdentity(state.root);
        assertDeviceMarker(state.root, retainedDeviceMarker(deviceId, state, state.root));
        assertRetainedDeviceMounts(state.root);
        const layers = path.join(state.root, config.layersDirectory);
        const rootAllowed = new Set([
            config.ownershipFilename,
            config.layersDirectory,
            ...planned
                .filter((tree) => path.dirname(tree.directory) === state.root)
                .map((tree) => path.basename(tree.directory)),
        ]);
        if (readdirSync(state.root).some((name) => !rootAllowed.has(name)))
            throw new TypeError("pending root contains unowned entries");
        if (lstatSync(layers, { throwIfNoEntry: false }) !== undefined) {
            assertDeviceMarker(layers, retainedDeviceMarker(deviceId, state, layers));
            const layerAllowed = new Set([
                config.ownershipFilename,
                ...planned
                    .filter((tree) => path.dirname(tree.directory) === layers)
                    .map((tree) => path.basename(tree.directory)),
            ]);
            if (readdirSync(layers).some((name) => !layerAllowed.has(name)))
                throw new TypeError("pending layers contain unowned entries");
        }
    }
    for (const tree of plan.next.garbage) {
        assertGarbageWrapper(
            tree.directory,
            tree.identity,
            retainedDeviceMarker(deviceId, state, tree.directory),
            tree.payload_identity,
        );
    }
    for (const [index, copy] of plan.copies.entries()) {
        const exists = lstatSync(copy.target, { throwIfNoEntry: false }) !== undefined;
        let complete = false;
        if (exists) {
            const marker = retainedDeviceMarker(deviceId, state, copy.target);
            assertDeviceMarker(copy.target, marker);
            const entries = readdirSync(copy.target);
            if (
                entries.some(
                    (entry) =>
                        ![
                            config.ownershipFilename,
                            config.payloadIdentityFilename,
                            config.treeDirectory,
                        ].includes(entry),
                )
            )
                throw new TypeError("pending device wrapper contains unowned entries");
            const payload = path.join(copy.target, config.treeDirectory);
            if (lstatSync(payload, { throwIfNoEntry: false }) !== undefined) {
                readDevicePayloadIdentity(copy.target, marker);
                assertRetainedDeviceTreeBoundary(payload);
                complete = retainedDeviceTreeIdentity(payload) === copy.content_id;
            } else if (entries.includes(config.payloadIdentityFilename))
                throw new TypeError("pending payload identity disappeared");
        }
        if (!complete && copy.source !== null) {
            if (lstatSync(copy.source, { throwIfNoEntry: false }) === undefined) {
                if (
                    !plan.copies
                        .slice(0, index)
                        .some(
                            (earlier) =>
                                path.join(earlier.target, config.treeDirectory) === copy.source,
                        )
                )
                    throw new TypeError("pending device source disappeared");
            } else if (retainedDeviceTreeIdentity(copy.source) !== copy.content_id)
                throw new TypeError("pending device source changed before publication");
        }
    }
}
