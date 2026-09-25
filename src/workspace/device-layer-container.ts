import { spawn } from "node:child_process";
import path from "node:path";

import { workspaceProtocolConfig } from "../protocol/config.ts";
import type {
    DeviceLayerAdapter,
    DeviceLayerCompactionRequest,
    DeviceLayerDevice,
    DeviceLayerFileEntry,
    DeviceLayerFreezeRequest,
    DeviceLayerOpenContext,
    DeviceLayerProbe,
} from "./device-layer-types.ts";
import { DeviceLayerError } from "./errors.ts";

const CONFIG = workspaceProtocolConfig.deviceLayers;
const CONTAINER = CONFIG.container;

/** Token values substituted into one configured container template. @internal */
export type ContainerTemplateValues = Readonly<
    Partial<Record<keyof typeof CONTAINER.tokens, string>>
>;

/** Optional overrides of the configured reference container adapter. */
export type ContainerDeviceLayerAdapterOptions = {
    /** Local base image; omitted uses `workspaces.deviceLayers.container.image`. */
    readonly image?: string;
};

/**
 * Creates the reference container device-layer adapter driven through the configured container
 * CLI (`docker` by default) without a shell.
 *
 * The world lives at the configured path inside a container started from a local image; the
 * adapter never pulls. A checkpoint commits the container's writable layer as a new image layer
 * (`docker commit`) and replaces the container with one started from that image, so the frozen
 * layer becomes a lower layer and the new writable layer is empty. Compaction exports the newest
 * flattened image and imports it as one single-layer replacement, then re-flattens every retained
 * image the same way so no image chain exceeds the configured layer bound. Every container and
 * image carries a label or tag naming the device and is removed when the world closes.
 *
 * @param options - Optional base image override.
 * @returns Frozen container adapter.
 * @throws {TypeError} If options are malformed.
 */
export function createContainerDeviceLayerAdapter(
    options: ContainerDeviceLayerAdapterOptions = {},
): DeviceLayerAdapter {
    if (options === null || typeof options !== "object" || Array.isArray(options)) {
        throw new TypeError("container device-layer options must be an object");
    }
    const image = options.image ?? CONTAINER.image;
    if (typeof image !== "string" || image.length === 0) {
        throw new TypeError("container device-layer image must be a non-empty string");
    }
    // A leading "-" would be parsed by the container CLI as an option, not an image reference.
    if (image.startsWith("-")) {
        throw new TypeError('container device-layer image must not start with "-"');
    }
    return Object.freeze({
        name: CONFIG.adapters.container,
        // Opening requires a container daemon; the opt-in container conformance run covers it.
        /* node:coverage ignore next */
        open: (context: DeviceLayerOpenContext) => openContainerDevice(context, image),
        probe: () => probeContainer(image),
    });
}

const TOKEN_NAMES = new Map(Object.entries(CONTAINER.tokens).map(([name, token]) => [token, name]));
const TOKEN_PATTERN = new RegExp(
    [...TOKEN_NAMES.keys()]
        .sort((left, right) => right.length - left.length)
        .map((token) => token.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"))
        .join("|"),
    "gu",
);

/**
 * Renders one configured container template by substituting every configured token in a single
 * pass, so a substituted value that itself contains token text is kept literally.
 *
 * @param template - Configured argument or command template.
 * @param values - Token values; tokens without a value are kept verbatim.
 * @returns Rendered arguments, one per template entry.
 * @internal
 */
export function renderContainerTemplate(
    template: readonly string[],
    values: ContainerTemplateValues,
): readonly string[] {
    return template.map((argument) =>
        argument.replace(
            TOKEN_PATTERN,
            (token) => values[TOKEN_NAMES.get(token) as keyof ContainerTemplateValues] ?? token,
        ),
    );
}

/**
 * Parses list-command output into world file entries with configured blob digests.
 *
 * @param output - Raw list-command standard output.
 * @returns Entries for every non-empty line.
 * @throws {DeviceLayerError} If a line does not match the configured list pattern.
 * @internal
 */
export function parseContainerFileList(output: string): readonly DeviceLayerFileEntry[] {
    const pattern = new RegExp(CONTAINER.listLinePattern, "u");
    return output
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => {
            const match = pattern.exec(line);
            if (match === null) {
                throw new DeviceLayerError(
                    CONFIG.errors.operationCode,
                    `${CONFIG.errors.operationMessage}: unexpected list output: ${line}`,
                );
            }
            return {
                digest: `${workspaceProtocolConfig.carrier.blobIdPrefix}${match[1]}`,
                path: match[2] as string,
            };
        });
}

/* node:coverage disable */
// Container devices run only where the configured container CLI and daemon are available; the
// opt-in container conformance test and the device-layer benchmark exercise every path below.
async function probeContainer(image: string): Promise<DeviceLayerProbe> {
    const reasons = CONFIG.reasons;
    try {
        await runContainer(CONTAINER.arguments.probe, null);
    } catch (error) {
        const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
        return {
            available: false,
            detail: String((error as Error).message),
            reason: missing
                ? reasons.containerExecutableUnavailable
                : reasons.containerDaemonUnavailable,
        };
    }
    try {
        await runContainer(
            renderContainerTemplate(CONTAINER.arguments.inspectImage, { image }),
            null,
        );
    } catch (error) {
        return {
            available: false,
            detail: String((error as Error).message),
            reason: reasons.containerImageUnavailable,
        };
    }
    return { available: true };
}

async function openContainerDevice(
    context: DeviceLayerOpenContext,
    baseImage: string,
): Promise<DeviceLayerDevice> {
    const args = CONTAINER.arguments;
    const commands = CONTAINER.commands;
    const label = `${CONTAINER.labelKey}=${context.deviceId}`;
    const images = new Map<string, string>();
    let generation = 0;
    const imageRef = (layer: string) => {
        generation += 1;
        return `${CONTAINER.imageRepository}:${context.deviceId}-${layer}-${generation}`;
    };
    const text = async (template: readonly string[], values: ContainerTemplateValues) =>
        (await runContainer(renderContainerTemplate(template, values), null))
            .toString("utf8")
            .trim();
    const start = (image: string) => text(args.run, { image, label });
    const exec = (
        command: readonly string[],
        values: ContainerTemplateValues,
        input: Buffer | null,
    ) =>
        runContainer(
            [
                ...renderContainerTemplate(args.exec, { container }),
                ...renderContainerTemplate(command, { world: CONTAINER.worldPath, ...values }),
            ],
            input,
        );
    const worldPath = (relativePath: string) => path.posix.join(CONTAINER.worldPath, relativePath);
    const removeImage = (image: string) => text(args.removeImage, { image });
    const flatten = async (source: string, target: string) => {
        const created = await text(args.create, { image: source, label });
        try {
            await pipeContainers(
                renderContainerTemplate(args.export, { container: created }),
                renderContainerTemplate(args.import, { image: target }),
            );
        } finally {
            await text(args.removeContainer, { container: created });
        }
    };
    const layerCount = Number(await text(args.inspectImage, { image: baseImage }));
    let container = await start(baseImage);
    let layers: readonly string[] = [context.baseLayer];
    try {
        await exec(commands.prepare, {}, null);
        if (context.seed !== null) {
            await text(args.copyIn, {
                container,
                source: context.seed,
                world: CONTAINER.worldPath,
            });
        }
        const base = imageRef(context.baseLayer);
        await text(args.commit, { container, image: base });
        images.set(context.baseLayer, base);
        await text(args.removeContainer, { container });
        container = await start(base);
    } catch (error) {
        await text(args.removeContainer, { container }).catch(() => undefined);
        for (const image of images.values()) await removeImage(image).catch(() => undefined);
        throw error;
    }
    const compact = async (request: DeviceLayerCompactionRequest) => {
        const into = imageRef(request.into);
        await flatten(images.get(request.layers.at(-1) as string) as string, into);
        for (const layer of request.layers) {
            await removeImage(images.get(layer) as string);
            images.delete(layer);
        }
        images.set(request.into, into);
        // Retained images keep their original chains; re-flatten them so every chain stays bounded.
        const retained = layers.slice(request.layers.length);
        for (const layer of retained) {
            const previous = images.get(layer) as string;
            const replacement = imageRef(layer);
            await flatten(previous, replacement);
            await removeImage(previous);
            images.set(layer, replacement);
        }
        layers = [request.into, ...retained];
    };
    return Object.freeze({
        close: async () => {
            await text(args.removeContainer, { container });
            for (const image of images.values()) await removeImage(image);
            images.clear();
        },
        freeze: async (request: DeviceLayerFreezeRequest) => {
            const frozen = imageRef(request.layer);
            await text(args.commit, { container, image: frozen });
            images.set(request.layer, frozen);
            layers = [...layers, request.layer];
            await text(args.removeContainer, { container });
            if (request.compaction !== null) await compact(request.compaction);
            container = await start(images.get(layers.at(-1) as string) as string);
        },
        listFiles: async () =>
            parseContainerFileList((await exec(commands.list, {}, null)).toString("utf8")),
        maxLayers: CONTAINER.maxImageLayers - layerCount,
        path: null,
        readFile: (relativePath: string) =>
            exec(commands.read, { path: worldPath(relativePath) }, null),
        removePath: async (relativePath: string) => {
            await exec(commands.remove, { path: worldPath(relativePath) }, null);
        },
        revert: async (kept: readonly string[]) => {
            await text(args.removeContainer, { container });
            for (const layer of layers.slice(kept.length)) {
                await removeImage(images.get(layer) as string);
                images.delete(layer);
            }
            layers = kept;
            container = await start(images.get(kept.at(-1) as string) as string);
        },
        writeFile: async (relativePath: string, bytes: Buffer) => {
            await exec(commands.write, { path: worldPath(relativePath) }, bytes);
        },
    });
}

function runContainer(args: readonly string[], input: Buffer | null): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const child = spawn(CONTAINER.executable, args, {
            stdio: ["pipe", "pipe", "pipe"],
            timeout: CONFIG.commandTimeoutMs,
        });
        const output: Buffer[] = [];
        const diagnostics: Buffer[] = [];
        let bytes = 0;
        child.stdout.on("data", (chunk: Buffer) => {
            bytes += chunk.length;
            if (bytes > CONFIG.commandMaxBytes) child.kill();
            else output.push(chunk);
        });
        child.stderr.on("data", (chunk: Buffer) => {
            if (diagnostics.length < 64) diagnostics.push(chunk);
        });
        child.stdin.on("error", () => undefined);
        child.on("error", reject);
        child.on("close", (status, signal) => {
            if (status === 0 && bytes <= CONFIG.commandMaxBytes) {
                resolve(Buffer.concat(output));
                return;
            }
            const detail = Buffer.concat(diagnostics).toString("utf8").trim();
            reject(
                new DeviceLayerError(
                    CONFIG.errors.operationCode,
                    `${CONFIG.errors.operationMessage}: ${args[0]}: ${detail || signal || status}`,
                ),
            );
        });
        child.stdin.end(input ?? undefined);
    });
}

function pipeContainers(
    sourceArgs: readonly string[],
    targetArgs: readonly string[],
): Promise<void> {
    const wait = (child: ReturnType<typeof spawn>, name: string) =>
        new Promise<void>((resolve, reject) => {
            child.on("error", reject);
            child.on("close", (status) =>
                status === 0
                    ? resolve()
                    : reject(
                          new DeviceLayerError(
                              CONFIG.errors.operationCode,
                              `${CONFIG.errors.operationMessage}: ${name}: ${status}`,
                          ),
                      ),
            );
        });
    const options = { timeout: CONFIG.commandTimeoutMs };
    const source = spawn(CONTAINER.executable, sourceArgs, {
        ...options,
        stdio: ["ignore", "pipe", "ignore"],
    });
    const target = spawn(CONTAINER.executable, targetArgs, {
        ...options,
        stdio: ["pipe", "ignore", "ignore"],
    });
    source.stdout?.pipe(target.stdin as NodeJS.WritableStream);
    return Promise.all([
        wait(source, sourceArgs[0] as string),
        wait(target, targetArgs[0] as string),
    ]).then(() => undefined);
}
/* node:coverage enable */
