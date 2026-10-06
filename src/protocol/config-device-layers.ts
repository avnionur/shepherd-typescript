import { readRetainedDeviceLayersConfig } from "./config-retained-device-layers.ts";
import type { DeviceLayersConfig } from "./config-types.ts";
import {
    readArray,
    readNonEmptyString,
    readObject,
    readPositiveInteger,
} from "./config-value-readers.ts";

/** Carrier-backend names and overlay tokens the device-layer section must agree with. */
type DeviceLayerReservedNames = Readonly<{
    cloneBackend: string;
    copyBackend: string;
    overlayBackend: string;
    overlayLowerToken: string;
}>;

const CONTAINER_ARGUMENT_TOKENS = {
    commit: ["container", "image"],
    copyIn: ["container", "source", "world"],
    create: ["image", "label"],
    exec: ["container"],
    export: ["container"],
    import: ["image"],
    inspectImage: ["image"],
    probe: [],
    removeContainer: ["container"],
    removeImage: ["image"],
    run: ["image", "label"],
} as const;
const CONTAINER_COMMAND_TOKENS = {
    list: ["world"],
    prepare: ["world"],
    read: ["path"],
    remove: ["path"],
    write: ["path"],
} as const;
const TOKEN_KEYS = ["container", "image", "label", "path", "source", "world"] as const;

/**
 * Validates the closed workspace protocol v27 device-layer section.
 *
 * @param value - Raw `workspaces.deviceLayers` configuration.
 * @param reserved - Carrier backend names and overlay tokens the section must agree with.
 * @returns Validated adapter, checkpoint, depth, compaction, container, and selection policy.
 * @throws {TypeError} If a field is missing, extra, malformed, or internally inconsistent.
 */
export function readDeviceLayersConfig(
    value: unknown,
    reserved: DeviceLayerReservedNames,
): DeviceLayersConfig {
    const context = "workspaces.deviceLayers";
    const section = readObject(
        value,
        [
            "adapters",
            "baseCheckpointName",
            "checkpointNamePattern",
            "commandMaxBytes",
            "commandTimeoutMs",
            "conformance",
            "container",
            "depth",
            "deviceDirectoryPrefix",
            "directories",
            "errors",
            "layerNameWidth",
            "maxPathBytes",
            "overlay",
            "reasons",
            "retained",
            "selection",
            "version",
        ],
        context,
    );
    const adapters = readDistinctStrings(
        section.adapters,
        ["clone", "container", "copy", "overlay"],
        `${context}.adapters`,
    );
    if (
        adapters.copy !== reserved.copyBackend ||
        adapters.clone !== reserved.cloneBackend ||
        adapters.overlay !== reserved.overlayBackend
    ) {
        throw new TypeError(`${context}.adapters must reuse the carrier backend names`);
    }
    const checkpointNamePattern = readPattern(
        section.checkpointNamePattern,
        `${context}.checkpointNamePattern`,
    );
    const baseCheckpointName = readNonEmptyString(
        section.baseCheckpointName,
        `${context}.baseCheckpointName`,
    );
    if (!new RegExp(checkpointNamePattern, "u").test(baseCheckpointName)) {
        throw new TypeError(`${context}.baseCheckpointName must match the checkpoint pattern`);
    }
    const depthFields = readObject(section.depth, ["maxDepth", "retainNewest"], `${context}.depth`);
    const depth = {
        maxDepth: readPositiveInteger(depthFields.maxDepth, `${context}.depth.maxDepth`),
        retainNewest: readPositiveInteger(
            depthFields.retainNewest,
            `${context}.depth.retainNewest`,
        ),
    };
    const conformanceFields = readObject(
        section.conformance,
        ["checkpoints", "maxDepth", "retainNewest"],
        `${context}.conformance`,
    );
    const conformance = {
        checkpoints: readPositiveInteger(
            conformanceFields.checkpoints,
            `${context}.conformance.checkpoints`,
        ),
        maxDepth: readPositiveInteger(
            conformanceFields.maxDepth,
            `${context}.conformance.maxDepth`,
        ),
        retainNewest: readPositiveInteger(
            conformanceFields.retainNewest,
            `${context}.conformance.retainNewest`,
        ),
    };
    for (const policy of [depth, conformance]) {
        if (policy.retainNewest > policy.maxDepth - 2 || policy.maxDepth > depth.maxDepth) {
            throw new TypeError(`${context} depth policies must leave room for one checkpoint`);
        }
    }
    if (conformance.checkpoints < conformance.maxDepth) {
        throw new TypeError(`${context}.conformance.checkpoints must force a compaction`);
    }
    const directories = readDistinctStrings(
        section.directories,
        ["compaction", "layers", "upper", "work", "world"],
        `${context}.directories`,
    );
    if (Object.values(directories).some((name) => /[/\\\0]|^\.\.?$/u.test(name))) {
        throw new TypeError(`${context}.directories must be simple names`);
    }
    const overlayFields = readObject(
        section.overlay,
        ["lowerSeparator", "maxMountOptionBytes", "readOnlyMountOptions"],
        `${context}.overlay`,
    );
    const overlay = {
        lowerSeparator: readNonEmptyString(
            overlayFields.lowerSeparator,
            `${context}.overlay.lowerSeparator`,
        ),
        maxMountOptionBytes: readPositiveInteger(
            overlayFields.maxMountOptionBytes,
            `${context}.overlay.maxMountOptionBytes`,
        ),
        readOnlyMountOptions: readNonEmptyString(
            overlayFields.readOnlyMountOptions,
            `${context}.overlay.readOnlyMountOptions`,
        ),
    };
    if (!overlay.readOnlyMountOptions.includes(reserved.overlayLowerToken)) {
        throw new TypeError(`${context}.overlay.readOnlyMountOptions must name the lower token`);
    }
    const selection = readSelection(section.selection, Object.values(adapters), context);
    if (selection.fallbackOrder.at(-1) !== adapters.copy) {
        throw new TypeError(`${context}.selection.fallbackOrder must end with the copy adapter`);
    }
    return {
        adapters,
        baseCheckpointName,
        checkpointNamePattern,
        commandMaxBytes: readPositiveInteger(section.commandMaxBytes, `${context}.commandMaxBytes`),
        commandTimeoutMs: readPositiveInteger(
            section.commandTimeoutMs,
            `${context}.commandTimeoutMs`,
        ),
        conformance,
        container: readContainer(section.container, `${context}.container`),
        depth,
        deviceDirectoryPrefix: readNonEmptyString(
            section.deviceDirectoryPrefix,
            `${context}.deviceDirectoryPrefix`,
        ),
        directories,
        errors: readDistinctStrings(
            section.errors,
            [
                "checkpointInvalidCode",
                "checkpointInvalidMessage",
                "checkpointRetiredCode",
                "checkpointRetiredMessage",
                "checkpointUnknownCode",
                "checkpointUnknownMessage",
                "closedCode",
                "closedMessage",
                "operationCode",
                "operationMessage",
                "pathCode",
                "pathMessage",
                "unavailableCode",
                "unavailableMessage",
            ],
            `${context}.errors`,
        ),
        layerNameWidth: readPositiveInteger(section.layerNameWidth, `${context}.layerNameWidth`),
        maxPathBytes: readPositiveInteger(section.maxPathBytes, `${context}.maxPathBytes`),
        overlay,
        reasons: readDistinctStrings(
            section.reasons,
            [
                "available",
                "containerDaemonUnavailable",
                "containerExecutableUnavailable",
                "containerImageUnavailable",
            ],
            `${context}.reasons`,
        ),
        selection,
        retained: readRetainedDeviceLayersConfig(section.retained),
        version: readPositiveInteger(section.version, `${context}.version`),
    };
}

/**
 * Validates one backend or adapter selection policy against its closed name vocabulary.
 *
 * @param value - Raw selection object.
 * @param names - Selectable backend or adapter names.
 * @param context - Owning configuration path.
 * @returns Validated default adapter, default mode, fallback order, and mode roles.
 * @throws {TypeError} If the default is unknown or the order is not a permutation of `names`.
 * @internal
 */
function readSelection(
    value: unknown,
    names: readonly string[],
    context: string,
): DeviceLayersConfig["selection"] {
    const path = `${context}.selection`;
    const fields = readObject(
        value,
        ["defaultAdapter", "defaultMode", "fallbackOrder", "modes"],
        path,
    );
    const modes = readDistinctStrings(fields.modes, ["fallback", "strict"], `${path}.modes`);
    const defaultAdapter = readNonEmptyString(fields.defaultAdapter, `${path}.defaultAdapter`);
    const defaultMode = readNonEmptyString(fields.defaultMode, `${path}.defaultMode`);
    const fallbackOrder = readFallbackOrder(fields.fallbackOrder, names, `${path}.fallbackOrder`);
    if (!names.includes(defaultAdapter) || !Object.values(modes).includes(defaultMode)) {
        throw new TypeError(`${path} defaults must name a configured adapter and mode`);
    }
    return { defaultAdapter, defaultMode, fallbackOrder, modes };
}

/**
 * Reads a fallback order that names every selectable backend exactly once.
 *
 * @param value - Raw order array.
 * @param names - Selectable names the order must permute.
 * @param path - Configuration path used in diagnostics.
 * @returns The validated order.
 * @throws {TypeError} If the order is not a permutation of `names`.
 * @internal
 */
export function readFallbackOrder(
    value: unknown,
    names: readonly string[],
    path: string,
): readonly string[] {
    const order = readArray(value, path).map((entry, index) =>
        readNonEmptyString(entry, `${path}[${index}]`),
    );
    if (
        order.length !== names.length ||
        new Set(order).size !== order.length ||
        order.some((name) => !names.includes(name))
    ) {
        throw new TypeError(`${path} must name every selectable backend exactly once`);
    }
    return order;
}

function readContainer(value: unknown, path: string): DeviceLayersConfig["container"] {
    const fields = readObject(
        value,
        [
            "arguments",
            "commands",
            "executable",
            "image",
            "imageRepository",
            "labelKey",
            "listLinePattern",
            "maxImageLayers",
            "tokens",
            "worldPath",
        ],
        path,
    );
    const tokens = readDistinctStrings(fields.tokens, TOKEN_KEYS, `${path}.tokens`);
    const imageRepository = readNonEmptyString(fields.imageRepository, `${path}.imageRepository`);
    const worldPath = readNonEmptyString(fields.worldPath, `${path}.worldPath`);
    if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u.test(imageRepository) || !worldPath.startsWith("/")) {
        throw new TypeError(`${path} image repository or world path is malformed`);
    }
    return {
        arguments: readTemplates(
            fields.arguments,
            CONTAINER_ARGUMENT_TOKENS,
            tokens,
            `${path}.arguments`,
        ),
        commands: readTemplates(
            fields.commands,
            CONTAINER_COMMAND_TOKENS,
            tokens,
            `${path}.commands`,
        ),
        executable: readNonEmptyString(fields.executable, `${path}.executable`),
        image: readNonEmptyString(fields.image, `${path}.image`),
        imageRepository,
        labelKey: readNonEmptyString(fields.labelKey, `${path}.labelKey`),
        listLinePattern: readPattern(fields.listLinePattern, `${path}.listLinePattern`),
        maxImageLayers: readPositiveInteger(fields.maxImageLayers, `${path}.maxImageLayers`),
        tokens,
        worldPath,
    };
}

function readTemplates<const Required extends Readonly<Record<string, readonly string[]>>>(
    value: unknown,
    required: Required,
    tokens: Readonly<Record<string, string>>,
    path: string,
): { readonly [Key in keyof Required]: readonly string[] } {
    const fields = readObject(value, Object.keys(required), path);
    const templates: Record<string, readonly string[]> = Object.fromEntries(
        Object.entries(required).map(([name, needed]) => {
            const template = readArray(fields[name], `${path}.${name}`).map((entry, index) =>
                readNonEmptyString(entry, `${path}.${name}[${index}]`),
            );
            const rendered = template.join("\0");
            if (
                template.length === 0 ||
                needed.some((token) => !rendered.includes(tokens[token] as string))
            ) {
                throw new TypeError(`${path}.${name} must contain its required tokens`);
            }
            return [name, template];
        }),
    );
    return templates as { readonly [Key in keyof Required]: readonly string[] };
}

function readDistinctStrings<const Keys extends readonly string[]>(
    value: unknown,
    keys: Keys,
    path: string,
): { readonly [Key in Keys[number]]: string } {
    const fields = readObject(value, keys, path);
    const values = keys.map((key) => readNonEmptyString(fields[key], `${path}.${key}`));
    if (new Set(values).size !== values.length) {
        throw new TypeError(`${path} values must be distinct`);
    }
    return Object.fromEntries(keys.map((key, index) => [key, values[index]])) as {
        readonly [Key in Keys[number]]: string;
    };
}

function readPattern(value: unknown, path: string): string {
    const pattern = readNonEmptyString(value, path);
    try {
        new RegExp(pattern, "u");
    } catch {
        throw new TypeError(`${path} must be a valid regular expression`);
    }
    return pattern;
}
