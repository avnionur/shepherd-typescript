import { createHash } from "node:crypto";
import {
    chmodSync,
    lstatSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    readlinkSync,
    renameSync,
    symlinkSync,
    writeFileSync,
} from "node:fs";
import path from "node:path";

import { workspaceProtocolConfig } from "../protocol/config.ts";
import { removePathSync } from "../runtime/remove-path.ts";
import {
    CarrierBackendUnavailableError,
    type CarrierFileMaterializer,
    materializeClonedFile,
    mountOverlayStack,
    type OverlayStack,
    openCarrierBackend,
    readOverlayStackMountState,
    renderOverlayStackOptions,
    unmountOverlay,
    writeCopiedFile,
} from "./carrier-backends.ts";
import { createContainerDeviceLayerAdapter } from "./device-layer-container.ts";
import type {
    DeviceLayerAdapter,
    DeviceLayerCheckpoint,
    DeviceLayerCompactionRequest,
    DeviceLayerDepthPolicy,
    DeviceLayerDevice,
    DeviceLayerFileEntry,
    DeviceLayerFreezeRequest,
    DeviceLayerLayer,
    DeviceLayerProbe,
    DeviceLayerRestore,
    DeviceLayerSelection,
    DeviceLayerSelectionAttempt,
    DeviceLayerWorld,
    DeviceLayerWorldOptions,
} from "./device-layer-types.ts";
import { DeviceLayerError } from "./errors.ts";
import type { BackendSelectionMode } from "./types.ts";

const CONFIG = workspaceProtocolConfig.deviceLayers;
const ERRORS = CONFIG.errors;
const CHECKPOINT_NAME = new RegExp(CONFIG.checkpointNamePattern, "u");

/**
 * Creates every built-in device-layer adapter in configured role order.
 *
 * @returns Frozen copy, clone, overlay, and container adapters.
 * @example
 * const world = await openDeviceLayerWorld({ adapters: createDeviceLayerAdapters(), root });
 */
export function createDeviceLayerAdapters(): readonly DeviceLayerAdapter[] {
    return Object.freeze([
        createCopyDeviceLayerAdapter(),
        createCloneDeviceLayerAdapter(),
        createOverlayDeviceLayerAdapter(),
        createContainerDeviceLayerAdapter(),
    ]);
}

/**
 * Creates the portable copy device-layer adapter, the `cp -a` reference.
 *
 * The world is a plain host directory. Every checkpoint freezes a full verified-byte copy of the
 * world as its layer, so capture time and storage grow with world size; compaction keeps only the
 * newest flattened snapshot. It is available on every host.
 *
 * @returns Frozen copy adapter.
 */
export function createCopyDeviceLayerAdapter(): DeviceLayerAdapter {
    return Object.freeze({
        name: CONFIG.adapters.copy,
        open: async (context) => openDirectoryDevice(context, writeCopiedFile),
        probe: async () => ({ available: true }) as const,
    });
}

/**
 * Creates the clone device-layer adapter.
 *
 * Like the copy adapter, but every frozen layer clones each regular file (reflink on Linux,
 * `clonefile(2)` on macOS) and verifies the clone byte for byte, so storage grows with changed
 * bytes while capture time still grows with the number of files. It is available where the clone
 * carrier backend probe succeeds on the device root's filesystem.
 *
 * @returns Frozen clone adapter.
 */
export function createCloneDeviceLayerAdapter(): DeviceLayerAdapter {
    return Object.freeze({
        name: CONFIG.adapters.clone,
        open: async (context) => openDirectoryDevice(context, materializeClonedFile),
        probe: async ({ root }) => probeCarrierBackend(CONFIG.adapters.clone, root),
    });
}

/**
 * Creates the Linux stacked-overlay device-layer adapter.
 *
 * The world is an overlay mount of an upper layer over the frozen stack. A checkpoint unmounts,
 * renames the upper directory into the stack as the new named lower layer, and remounts, so its
 * cost does not depend on world size. Compaction mounts the flattened layers read-only and copies
 * their merged view into one replacement layer. It is available where the overlay carrier backend
 * probe succeeds.
 *
 * @returns Frozen overlay adapter.
 */
export function createOverlayDeviceLayerAdapter(): DeviceLayerAdapter {
    return Object.freeze({
        name: CONFIG.adapters.overlay,
        open: openOverlayDevice,
        probe: async ({ root }) => probeCarrierBackend(CONFIG.adapters.overlay, root),
    });
}

/**
 * Selects an adapter, opens a device-layer world, and records which adapter was used.
 *
 * Strict selection probes only the requested adapter and refuses when it is unavailable. Fallback
 * selection probes the requested adapter and then every later adapter of the fallback order and
 * uses the first available one; the configured order ends with the always-available copy adapter.
 *
 * @param options - Root, optional seed, adapters, requested adapter, mode, order, and depth.
 * @returns Open world whose base layer holds the seed.
 * @throws {TypeError} If options are malformed or name an unknown adapter or invalid depth.
 * @throws {DeviceLayerError} If no candidate adapter is available or the adapter fails to open.
 * @example
 * const world = await openDeviceLayerWorld({ adapter: "overlay", root, selection: "fallback" });
 * await world.writeFile("notes.txt", Buffer.from("draft"));
 * await world.checkpoint("step-1");
 */
export async function openDeviceLayerWorld(
    options: DeviceLayerWorldOptions,
): Promise<DeviceLayerWorld> {
    const settings = readWorldOptions(options);
    const { adapter, selection } = await selectAdapter(settings);
    const deviceRoot = mkdtempSync(path.join(settings.root, CONFIG.deviceDirectoryPrefix));
    chmodSync(deviceRoot, 0o700);
    const deviceId = path.basename(deviceRoot);
    const baseLayer = layerName(0);
    let device: DeviceLayerDevice;
    try {
        device = await adapter.open({ baseLayer, deviceId, root: deviceRoot, seed: settings.seed });
    } catch (error) {
        removePathSync(deviceRoot, { force: true, recursive: true });
        throw operationError("open", error);
    }
    const maxDepth = Math.min(settings.depth.maxDepth ?? CONFIG.depth.maxDepth, device.maxLayers);
    const depth = Object.freeze({
        maxDepth,
        retainNewest:
            settings.depth.retainNewest ?? Math.min(CONFIG.depth.retainNewest, maxDepth - 2),
    });
    if (depth.retainNewest < 1 || depth.retainNewest > depth.maxDepth - 2) {
        await device.close();
        removePathSync(deviceRoot, { force: true, recursive: true });
        throw new TypeError("device-layer depth policy leaves no room for a checkpoint");
    }
    return createWorld(device, deviceRoot, deviceId, selection, depth, baseLayer);
}

type WorldSettings = Readonly<{
    adapters: readonly DeviceLayerAdapter[];
    depth: Partial<DeviceLayerDepthPolicy>;
    mode: BackendSelectionMode;
    order: readonly string[];
    requested: string;
    root: string;
    seed: string | null;
}>;

function readWorldOptions(options: DeviceLayerWorldOptions): WorldSettings {
    if (options === null || typeof options !== "object" || Array.isArray(options)) {
        throw new TypeError("device-layer world options must be an object");
    }
    const adapters = options.adapters ?? createDeviceLayerAdapters();
    const depth = options.depth ?? {};
    const mode = options.selection ?? (CONFIG.selection.defaultMode as BackendSelectionMode);
    const order = options.fallbackOrder ?? CONFIG.selection.fallbackOrder;
    const adapterValid = (adapter: DeviceLayerAdapter) =>
        typeof adapter?.name === "string" &&
        typeof adapter.open === "function" &&
        typeof adapter.probe === "function";
    const depthValid = (value: number | undefined) =>
        value === undefined ||
        (Number.isSafeInteger(value) && value >= 1 && value <= CONFIG.depth.maxDepth);
    if (
        typeof options.root !== "string" ||
        lstatSync(options.root, { throwIfNoEntry: false })?.isDirectory() !== true ||
        !["string", "undefined"].includes(typeof options.seed) ||
        !Array.isArray(adapters) ||
        !adapters.every(adapterValid) ||
        new Set(adapters.map((adapter) => adapter.name)).size !== adapters.length ||
        !Object.values(CONFIG.selection.modes).includes(mode) ||
        !Array.isArray(order) ||
        !depthValid(depth.maxDepth) ||
        !depthValid(depth.retainNewest)
    ) {
        throw new TypeError("device-layer world options are malformed");
    }
    return Object.freeze({
        adapters,
        depth,
        mode,
        order,
        requested: options.adapter ?? CONFIG.selection.defaultAdapter,
        root: options.root,
        seed: options.seed ?? null,
    });
}

async function selectAdapter(
    settings: WorldSettings,
): Promise<Readonly<{ adapter: DeviceLayerAdapter; selection: DeviceLayerSelection }>> {
    const { mode, order, requested } = settings;
    const candidates =
        mode === CONFIG.selection.modes.strict
            ? [requested]
            : [requested, ...order.slice(order.indexOf(requested) + 1)];
    const adapters = candidates.map((name) => {
        const adapter = settings.adapters.find((candidate) => candidate.name === name);
        if (adapter === undefined) {
            throw new TypeError(`device-layer adapter is not selectable: ${String(name)}`);
        }
        return adapter;
    });
    const attempts: DeviceLayerSelectionAttempt[] = [];
    for (const adapter of adapters) {
        const scratch = mkdtempSync(path.join(settings.root, CONFIG.deviceDirectoryPrefix));
        let probe: DeviceLayerProbe;
        try {
            probe = await adapter.probe({ root: scratch });
        } finally {
            removePathSync(scratch, { force: true, recursive: true });
        }
        attempts.push(
            Object.freeze({
                adapter: adapter.name,
                available: probe.available,
                reason: probe.available ? CONFIG.reasons.available : probe.reason,
            }),
        );
        if (probe.available) {
            return Object.freeze({
                adapter,
                selection: Object.freeze({
                    attempts: Object.freeze(attempts),
                    mode,
                    requested,
                    used: adapter.name,
                }),
            });
        }
    }
    throw new DeviceLayerError(
        ERRORS.unavailableCode,
        `${ERRORS.unavailableMessage}: ${attempts
            .map((attempt) => `${attempt.adapter}: ${attempt.reason}`)
            .join("; ")}`,
    );
}

function createWorld(
    device: DeviceLayerDevice,
    deviceRoot: string,
    deviceId: string,
    selection: DeviceLayerSelection,
    depth: DeviceLayerDepthPolicy,
    baseLayer: string,
): DeviceLayerWorld {
    let stack: readonly Readonly<{ checkpoint: string; layer: string }>[] = [
        { checkpoint: CONFIG.baseCheckpointName, layer: baseLayer },
    ];
    const retired = new Set<string>();
    let ordinal = 1;
    let closed = false;
    let queue: Promise<unknown> = Promise.resolve();
    const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
        const run = queue.then(() => {
            if (closed) throw new DeviceLayerError(ERRORS.closedCode, ERRORS.closedMessage);
            return operation();
        });
        queue = run.catch(() => undefined);
        return run;
    };
    // A failed freeze or revert may leave the device between stacks, so the world closes.
    const mutate = async (name: string, operation: () => Promise<void>): Promise<void> => {
        try {
            await operation();
        } catch (error) {
            closed = true;
            await device.close().catch(() => undefined);
            removePathSync(deviceRoot, { force: true, recursive: true });
            throw operationError(name, error);
        }
    };
    const access = async <T>(name: string, operation: () => Promise<T>): Promise<T> => {
        try {
            return await operation();
        } catch (error) {
            throw operationError(name, error);
        }
    };

    return Object.freeze({
        adapter: selection.used,
        checkpoint: (name: string) =>
            serialize(async (): Promise<DeviceLayerCheckpoint> => {
                if (
                    typeof name !== "string" ||
                    !CHECKPOINT_NAME.test(name) ||
                    retired.has(name) ||
                    stack.some((entry) => entry.checkpoint === name)
                ) {
                    throw new DeviceLayerError(
                        ERRORS.checkpointInvalidCode,
                        `${ERRORS.checkpointInvalidMessage}: ${String(name)}`,
                    );
                }
                const layer = layerName(ordinal);
                ordinal += 1;
                let next = [...stack, { checkpoint: name, layer }];
                let compaction: DeviceLayerCompactionRequest | null = null;
                let retiredNames: readonly string[] = [];
                if (next.length > depth.maxDepth) {
                    const flattened = next.slice(0, next.length - depth.retainNewest);
                    const into = layerName(ordinal);
                    ordinal += 1;
                    compaction = { into, layers: flattened.map((entry) => entry.layer) };
                    retiredNames = flattened.slice(0, -1).map((entry) => entry.checkpoint);
                    next = [
                        {
                            checkpoint: (flattened.at(-1) as (typeof next)[number]).checkpoint,
                            layer: into,
                        },
                        ...next.slice(flattened.length),
                    ];
                }
                await mutate("checkpoint", () =>
                    device.freeze(Object.freeze({ compaction, layer }) as DeviceLayerFreezeRequest),
                );
                stack = next;
                for (const retiredName of retiredNames) retired.add(retiredName);
                return Object.freeze({
                    checkpoint: name,
                    compaction:
                        compaction === null
                            ? null
                            : Object.freeze({
                                  into: compaction.into,
                                  layers: Object.freeze([...compaction.layers]),
                                  retired: Object.freeze([...retiredNames]),
                              }),
                    depth: stack.length,
                    layer,
                });
            }),
        close: () => {
            const run = queue.then(async () => {
                if (closed) return;
                closed = true;
                try {
                    await device.close();
                } finally {
                    removePathSync(deviceRoot, { force: true, recursive: true });
                }
            });
            queue = run.catch(() => undefined);
            return run;
        },
        depth,
        deviceId,
        layers: () =>
            Object.freeze(
                stack.map(
                    (entry, index): DeviceLayerLayer =>
                        Object.freeze({ checkpoint: entry.checkpoint, index, layer: entry.layer }),
                ),
            ),
        listFiles: () =>
            serialize(() =>
                access("list", async () =>
                    Object.freeze(
                        [...(await device.listFiles())]
                            .sort((left, right) => (left.path < right.path ? -1 : 1))
                            .map((entry) =>
                                Object.freeze({ digest: entry.digest, path: entry.path }),
                            ),
                    ),
                ),
            ),
        path: device.path,
        readFile: (relativePath: string) =>
            serialize(() => access("read", () => device.readFile(readWorldPath(relativePath)))),
        removePath: (relativePath: string) =>
            serialize(() => access("remove", () => device.removePath(readWorldPath(relativePath)))),
        restore: (name: string) =>
            serialize(async (): Promise<DeviceLayerRestore> => {
                const index = stack.findIndex((entry) => entry.checkpoint === name);
                if (index < 0) {
                    throw retired.has(name)
                        ? new DeviceLayerError(
                              ERRORS.checkpointRetiredCode,
                              `${ERRORS.checkpointRetiredMessage}: ${name}`,
                          )
                        : new DeviceLayerError(
                              ERRORS.checkpointUnknownCode,
                              `${ERRORS.checkpointUnknownMessage}: ${String(name)}`,
                          );
                }
                const kept = stack.slice(0, index + 1);
                const discarded = stack.slice(index + 1).map((entry) => entry.checkpoint);
                await mutate("restore", () => device.revert(kept.map((entry) => entry.layer)));
                stack = kept;
                return Object.freeze({
                    checkpoint: name,
                    depth: stack.length,
                    discarded: Object.freeze(discarded),
                });
            }),
        selection,
        writeFile: (relativePath: string, bytes: Buffer) =>
            serialize(() => {
                const target = readWorldPath(relativePath);
                if (!Buffer.isBuffer(bytes))
                    throw new TypeError("device-layer file bytes must be a Buffer");
                return access("write", () => device.writeFile(target, bytes));
            }),
    });
}

/**
 * Validates one portable world-relative path.
 *
 * @param value - Candidate path using `/` separators.
 * @returns The validated path.
 * @throws {DeviceLayerError} With the configured path code for absolute, empty-segment, dot,
 * backslash, control-character, or oversized paths.
 * @internal
 */
export function readWorldPath(value: unknown): string {
    if (
        typeof value !== "string" ||
        Buffer.byteLength(value) > CONFIG.maxPathBytes ||
        // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are refused.
        /[\\\u0000-\u001f\u007f]/u.test(value) ||
        value.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
    ) {
        throw new DeviceLayerError(ERRORS.pathCode, `${ERRORS.pathMessage}: ${String(value)}`);
    }
    return value;
}

/**
 * Formats one engine-assigned layer identifier with the configured fixed width.
 *
 * @param ordinal - Non-negative layer ordinal.
 * @returns Zero-padded decimal identifier.
 * @internal
 */
export function layerName(ordinal: number): string {
    return String(ordinal).padStart(CONFIG.layerNameWidth, "0");
}

function operationError(operation: string, error: unknown): Error {
    if (error instanceof DeviceLayerError || error instanceof TypeError) return error;
    return new DeviceLayerError(
        ERRORS.operationCode,
        `${ERRORS.operationMessage}: ${operation}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
    );
}

async function probeCarrierBackend(backend: string, root: string): Promise<DeviceLayerProbe> {
    try {
        openCarrierBackend(backend, root);
        return { available: true };
    } catch (error) {
        if (!(error instanceof CarrierBackendUnavailableError)) throw error;
        return { available: false, detail: error.message, reason: error.reason };
    }
}

function openDirectoryDevice(
    context: Readonly<{ baseLayer: string; root: string; seed: string | null }>,
    materialize: CarrierFileMaterializer,
): DeviceLayerDevice {
    const directories = CONFIG.directories;
    const layersRoot = path.join(context.root, directories.layers);
    const world = path.join(context.root, directories.world);
    const layerPath = (layer: string) => path.join(layersRoot, layer);
    mkdirSync(layersRoot, { mode: 0o700 });
    // The seed may live on another filesystem, so only layers inside the root are materialized.
    copyTree(context.seed, layerPath(context.baseLayer), writeCopiedFile);
    copyTree(layerPath(context.baseLayer), world, materialize);
    let layers: readonly string[] = [context.baseLayer];
    return Object.freeze({
        close: async () => undefined,
        freeze: async (request: DeviceLayerFreezeRequest) => {
            copyTree(world, layerPath(request.layer), materialize);
            layers = [...layers, request.layer];
            if (request.compaction !== null) {
                // Every frozen layer is a full snapshot, so the newest flattened one is the merge.
                const flattened = request.compaction.layers;
                renameSync(
                    layerPath(flattened.at(-1) as string),
                    layerPath(request.compaction.into),
                );
                for (const layer of flattened.slice(0, -1)) {
                    removePathSync(layerPath(layer), { force: true, recursive: true });
                }
                layers = [request.compaction.into, ...layers.slice(flattened.length)];
            }
        },
        listFiles: async () => listHostFiles(world),
        maxLayers: Number.MAX_SAFE_INTEGER,
        path: world,
        readFile: async (relativePath: string) => readFileSync(hostPath(world, relativePath)),
        removePath: async (relativePath: string) =>
            removePathSync(hostPath(world, relativePath), { force: true, recursive: true }),
        revert: async (kept: readonly string[]) => {
            for (const layer of layers.slice(kept.length)) {
                removePathSync(layerPath(layer), { force: true, recursive: true });
            }
            layers = kept;
            removePathSync(world, { force: true, recursive: true });
            copyTree(layerPath(kept.at(-1) as string), world, materialize);
        },
        writeFile: async (relativePath: string, bytes: Buffer) =>
            writeHostFile(world, relativePath, bytes),
    });
}

/* node:coverage disable */
// Stacked overlay devices run only on Linux hosts with mount permission; the privileged Linux
// container run of the device-layer conformance kit and benchmark exercises every path below.
async function openOverlayDevice(
    context: Readonly<{ baseLayer: string; root: string; seed: string | null }>,
): Promise<DeviceLayerDevice> {
    const directories = CONFIG.directories;
    const layersRoot = path.join(context.root, directories.layers);
    const world = path.join(context.root, directories.world);
    const upper = path.join(context.root, directories.upper);
    const work = path.join(context.root, directories.work);
    const compaction = path.join(context.root, directories.compaction);
    const layerPath = (layer: string) => path.join(layersRoot, layer);
    for (const directory of [layersRoot, world, upper, work, compaction]) {
        mkdirSync(directory, { mode: 0o700 });
    }
    copyTree(context.seed, layerPath(context.baseLayer), writeCopiedFile);
    let layers: readonly string[] = [context.baseLayer];
    let mounted = false;
    const stackOf = (
        stack: readonly string[],
        target: string,
        writable: boolean,
    ): OverlayStack => ({
        lowers: [...stack].reverse().map(layerPath),
        target,
        writable: writable ? { upper, work } : null,
    });
    const mount = (stack: OverlayStack) => {
        mountOverlayStack(stack);
        if (readOverlayStackMountState(stack) !== "owned") {
            unmountOverlay(stack.target);
            throw new Error("overlay mount is not the requested layer stack");
        }
    };
    const mountWorld = () => {
        mount(stackOf(layers, world, true));
        mounted = true;
    };
    const unmountWorld = () => {
        unmountOverlay(world);
        mounted = false;
    };
    const resetWritable = (keepUpper: boolean) => {
        if (!keepUpper) {
            removePathSync(upper, { force: true, recursive: true });
            mkdirSync(upper, { mode: 0o700 });
        }
        removePathSync(work, { force: true, recursive: true });
        mkdirSync(work, { mode: 0o700 });
    };
    mountWorld();
    return Object.freeze({
        close: async () => {
            if (mounted) unmountWorld();
        },
        freeze: async (request: DeviceLayerFreezeRequest) => {
            unmountWorld();
            renameSync(upper, layerPath(request.layer));
            mkdirSync(upper, { mode: 0o700 });
            resetWritable(true);
            layers = [...layers, request.layer];
            if (request.compaction !== null) {
                const flattened = request.compaction.layers;
                const readOnly = stackOf(flattened, compaction, false);
                mount(readOnly);
                try {
                    copyTree(compaction, layerPath(request.compaction.into), writeCopiedFile);
                } finally {
                    unmountOverlay(compaction);
                }
                for (const layer of flattened) {
                    removePathSync(layerPath(layer), { force: true, recursive: true });
                }
                layers = [request.compaction.into, ...layers.slice(flattened.length)];
            }
            mountWorld();
        },
        listFiles: async () => listHostFiles(world),
        maxLayers: overlayMaxLayers(layersRoot, world, upper, work),
        path: world,
        readFile: async (relativePath: string) => readFileSync(hostPath(world, relativePath)),
        removePath: async (relativePath: string) =>
            removePathSync(hostPath(world, relativePath), { force: true, recursive: true }),
        revert: async (kept: readonly string[]) => {
            unmountWorld();
            for (const layer of layers.slice(kept.length)) {
                removePathSync(layerPath(layer), { force: true, recursive: true });
            }
            layers = kept;
            resetWritable(false);
            mountWorld();
        },
        writeFile: async (relativePath: string, bytes: Buffer) =>
            writeHostFile(world, relativePath, bytes),
    });
}
/* node:coverage enable */

/**
 * Computes how many fixed-width frozen layers fit the configured overlay mount-option bytes.
 *
 * @param layersRoot - Directory holding the frozen layers.
 * @param target - Overlay mount target.
 * @param upper - Upper layer directory.
 * @param work - Overlay work directory.
 * @returns Largest mountable stack depth, never above the configured depth bound.
 * @internal
 */
export function overlayMaxLayers(
    layersRoot: string,
    target: string,
    upper: string,
    work: string,
): number {
    const lower = path.join(layersRoot, layerName(0));
    let depth = 0;
    while (
        depth < CONFIG.depth.maxDepth &&
        Buffer.byteLength(
            renderOverlayStackOptions({
                lowers: Array.from({ length: depth + 1 }, () => lower),
                target,
                writable: { upper, work },
            }),
        ) <= CONFIG.overlay.maxMountOptionBytes
    ) {
        depth += 1;
    }
    return depth;
}

/**
 * Copies one host tree, or creates an empty directory when `source` is null.
 *
 * Directories keep their permission bits, symbolic links their exact targets, and regular files
 * their verified bytes and permission bits through `materialize`. Other entry kinds are refused.
 *
 * @throws {DeviceLayerError} If the tree contains an unsupported entry kind.
 * @internal
 */
export function copyTree(
    source: string | null,
    target: string,
    materialize: CarrierFileMaterializer,
): void {
    if (source === null) {
        mkdirSync(target, { mode: 0o700 });
        return;
    }
    const status = lstatSync(source);
    const mode = status.mode & 0o777;
    if (status.isDirectory()) {
        mkdirSync(target, { mode: 0o700 });
        for (const name of readdirSync(source).sort()) {
            copyTree(path.join(source, name), path.join(target, name), materialize);
        }
        chmodSync(target, mode);
    } else if (status.isSymbolicLink()) {
        symlinkSync(readlinkSync(source), target);
    } else if (status.isFile()) {
        materialize(source, target, readFileSync(source), mode);
    } else {
        throw new DeviceLayerError(
            ERRORS.operationCode,
            `${ERRORS.operationMessage}: unsupported entry: ${source}`,
        );
    }
}

function hostPath(world: string, relativePath: string): string {
    let current = world;
    for (const segment of relativePath.split("/")) {
        current = path.join(current, segment);
        if (lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink() === true) {
            throw new DeviceLayerError(
                ERRORS.pathCode,
                `${ERRORS.pathMessage}: traverses a symbolic link: ${relativePath}`,
            );
        }
    }
    return current;
}

function writeHostFile(world: string, relativePath: string, bytes: Buffer): void {
    const target = hostPath(world, relativePath);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, bytes);
}

function listHostFiles(world: string): readonly DeviceLayerFileEntry[] {
    const entries: DeviceLayerFileEntry[] = [];
    const visit = (directory: string, prefix: string) => {
        for (const name of readdirSync(directory)) {
            const absolute = path.join(directory, name);
            const relative = `${prefix}${name}`;
            const status = lstatSync(absolute);
            if (status.isDirectory()) visit(absolute, `${relative}/`);
            else if (status.isFile()) {
                entries.push({ digest: digestOf(readFileSync(absolute)), path: relative });
            }
        }
    };
    visit(world, "");
    return entries;
}

/**
 * Computes the configured blob digest of one file's bytes.
 *
 * @param bytes - File bytes.
 * @returns Configured blob identity (`blob:sha256:<hex>`).
 * @internal
 */
export function digestOf(bytes: Buffer): string {
    return `${workspaceProtocolConfig.carrier.blobIdPrefix}${createHash(
        workspaceProtocolConfig.digestAlgorithm,
    )
        .update(bytes)
        .digest("hex")}`;
}
