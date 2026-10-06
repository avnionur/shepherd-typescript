import {
    chmodSync,
    closeSync,
    constants,
    fstatSync,
    fsyncSync,
    lstatSync,
    mkdirSync,
    openSync,
    readdirSync,
    readFileSync,
    readlinkSync,
    realpathSync,
    writeFileSync,
} from "node:fs";
import path from "node:path";
import { syncDirectory } from "../blob/directory-durability.ts";
import {
    canonicalizeRecord,
    createRecordId,
    type SemanticRecord,
} from "../canonical/canonical-record.ts";
import { workspaceProtocolConfig } from "../protocol/config.ts";
import { WORLD_ENTRY_KINDS } from "../protocol/values.generated.ts";
import { removePathSync } from "../runtime/remove-path.ts";
import { readScopeDataObject } from "../scope/validation.ts";
import { materializeClonedFile, writeCopiedFile } from "./carrier-backends.ts";
import { copyTree, digestOf, readWorldPath } from "./device-layer.ts";
import type { DeviceLayerFileEntry } from "./device-layer-types.ts";

const config = workspaceProtocolConfig.deviceLayers.retained;

/** Exact local directory identity, independent of mutable file contents. @internal */
export type DeviceDirectoryIdentity = { readonly device: string; readonly inode: string };
/** Owned tree wrapper and immutable content identity; mutable worlds omit a content identity. @internal */
export type RetainedDeviceTree = {
    readonly directory: string;
    readonly identity: DeviceDirectoryIdentity;
    readonly payload_identity: DeviceDirectoryIdentity;
    readonly content_id: string | null;
};

/** Reads a real directory identity without following a link at the selected path. @internal */
export function deviceDirectoryIdentity(directory: string): DeviceDirectoryIdentity {
    const status = lstatSync(directory, { bigint: true });
    if (!status.isDirectory() || status.uid !== BigInt(process.getuid?.() ?? -1))
        throw new TypeError("retained device directory is not locally owned");
    return { device: String(status.dev), inode: String(status.ino) };
}

/** Requires exact directory ownership before reading or changing its children. @internal */
export function assertDeviceDirectory(directory: string, expected: DeviceDirectoryIdentity): void {
    const actual = deviceDirectoryIdentity(directory);
    if (actual.device !== expected.device || actual.inode !== expected.inode)
        throw new TypeError("retained device directory identity changed");
}

/** Resolves an existing parent into a stable real path and identity. @internal */
export function retainedDeviceParent(input: string): {
    readonly path: string;
    readonly identity: DeviceDirectoryIdentity;
} {
    const resolved = realpathSync(input);
    return { path: resolved, identity: deviceDirectoryIdentity(resolved) };
}

/** Creates or authenticates an exclusive owned wrapper using a durable marker. @internal */
export function ensureDeviceWrapper(
    directory: string,
    marker: SemanticRecord,
): DeviceDirectoryIdentity {
    if (lstatSync(directory, { throwIfNoEntry: false }) === undefined) {
        mkdirSync(directory, { mode: config.directoryMode });
        syncDirectory(path.dirname(directory));
        const descriptor = openSync(
            path.join(directory, config.ownershipFilename),
            constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
            config.fileMode,
        );
        try {
            writeFileSync(
                descriptor,
                canonicalizeRecord({
                    owner: marker,
                    wrapper_identity: deviceDirectoryIdentity(directory),
                }),
            );
            fsyncSync(descriptor);
        } finally {
            closeSync(descriptor);
        }
        syncDirectory(directory);
    }
    const identity = deviceDirectoryIdentity(directory);
    assertDeviceMarker(directory, marker);
    return identity;
}

/** Verifies a single-link owner-private marker without following a symbolic link. @internal */
export function assertDeviceMarker(directory: string, expected: SemanticRecord): void {
    const status = lstatSync(directory);
    if (!status.isDirectory() || (status.mode & 0o777) !== config.directoryMode)
        throw new TypeError("retained device wrapper permissions changed");
    const descriptor = openSync(
        path.join(directory, config.ownershipFilename),
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
        const marker = fstatSync(descriptor);
        if (
            !marker.isFile() ||
            marker.nlink !== 1 ||
            (marker.mode & 0o777) !== config.fileMode ||
            marker.uid !== process.getuid?.()
        )
            throw new TypeError("retained device ownership marker is unsafe");
        const expectedText = canonicalizeRecord({
            owner: expected,
            wrapper_identity: deviceDirectoryIdentity(directory),
        });
        if (
            marker.size !== Buffer.byteLength(expectedText) ||
            readFileSync(descriptor, "utf8") !== expectedText
        )
            throw new TypeError("retained device ownership marker differs");
    } finally {
        closeSync(descriptor);
    }
}

/** Digests exact tree paths, types, bytes, symlink targets and permission bits under bounds. @internal */
export function retainedDeviceTreeIdentity(root: string): string {
    const entries: SemanticRecord[] = [];
    let totalBytes = 0;
    const visit = (absolute: string, relative: string): void => {
        if (entries.length >= config.limits.maxEntries)
            throw new TypeError("retained device tree exceeds entry bound");
        const status = lstatSync(absolute);
        const mode = status.mode & 0o777;
        if (status.isSymbolicLink()) {
            entries.push({
                path: relative,
                mode,
                target: readlinkSync(absolute),
                kind: WORLD_ENTRY_KINDS[2],
            });
        } else if (status.isDirectory()) {
            entries.push({ path: relative, mode, kind: WORLD_ENTRY_KINDS[0] });
            for (const name of readdirSync(absolute).sort()) {
                const child = relative === "" ? name : `${relative}/${name}`;
                readWorldPath(child);
                visit(path.join(absolute, name), child);
            }
        } else if (status.isFile() && status.nlink === 1) {
            if (
                status.size > config.limits.maxFileBytes ||
                totalBytes + status.size > config.limits.maxTotalBytes
            )
                throw new TypeError("retained device tree exceeds byte bound");
            const descriptor = openSync(
                absolute,
                constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
            );
            try {
                const opened = fstatSync(descriptor);
                if (
                    !opened.isFile() ||
                    opened.nlink !== 1 ||
                    opened.dev !== status.dev ||
                    opened.ino !== status.ino ||
                    opened.size !== status.size
                )
                    throw new TypeError("retained device file changed during scan");
                const bytes = readFileSync(descriptor);
                if (bytes.length !== status.size)
                    throw new TypeError("retained device file length changed");
                totalBytes += bytes.length;
                entries.push({
                    path: relative,
                    mode,
                    kind: WORLD_ENTRY_KINDS[1],
                    digest: digestOf(bytes),
                });
            } finally {
                closeSync(descriptor);
            }
        } else throw new TypeError("retained device tree contains an unsupported entry");
    };
    visit(root, "");
    return createRecordId({ entries });
}

/** Reads a durable payload-directory receipt and verifies its physical identity when present. @internal */
export function readDevicePayloadIdentity(
    directory: string,
    marker: SemanticRecord,
    expected: DeviceDirectoryIdentity | null = null,
    allowAbsent = false,
): DeviceDirectoryIdentity {
    const descriptor = openSync(
        path.join(directory, config.payloadIdentityFilename),
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    let fields: Record<string, unknown>;
    try {
        const status = fstatSync(descriptor);
        if (
            !status.isFile() ||
            status.nlink !== 1 ||
            status.size > config.limits.maxMarkerBytes ||
            (status.mode & 0o777) !== config.fileMode ||
            status.uid !== process.getuid?.()
        )
            throw new TypeError("retained payload identity receipt is unsafe");
        fields = readScopeDataObject(
            JSON.parse(readFileSync(descriptor, "utf8")),
            ["owner", "payload_identity"],
            "payload ownership receipt",
        );
    } finally {
        closeSync(descriptor);
    }
    if (canonicalizeRecord(fields.owner as SemanticRecord) !== canonicalizeRecord(marker))
        throw new TypeError("retained payload owner identity differs");
    const identity = readScopeDataObject(
        fields.payload_identity,
        ["device", "inode"],
        "payload identity",
    );
    if (
        typeof identity.device !== "string" ||
        typeof identity.inode !== "string" ||
        !/^\d+$/u.test(identity.device) ||
        !/^\d+$/u.test(identity.inode)
    )
        throw new TypeError("retained payload identity is malformed");
    const parsed = { device: identity.device, inode: identity.inode };
    if (expected !== null && (parsed.device !== expected.device || parsed.inode !== expected.inode))
        throw new TypeError("retained payload receipt identity changed");
    const payload = path.join(directory, config.treeDirectory);
    if (!allowAbsent || lstatSync(payload, { throwIfNoEntry: false }) !== undefined) {
        try {
            assertDeviceDirectory(payload, parsed);
        } catch (error) {
            throw new TypeError("retained payload directory identity changed", { cause: error });
        }
    }
    return parsed;
}

/** Copies a quiescent source into an owned wrapper and verifies the complete result. @internal */
export function publishDeviceTree(
    directory: string,
    marker: SemanticRecord,
    source: string | null,
    expectedContent: string,
    adapter: string,
): RetainedDeviceTree {
    const identity = ensureDeviceWrapper(directory, marker);
    const payload = path.join(directory, config.treeDirectory);
    if (
        readdirSync(directory).some(
            (name) =>
                ![
                    config.ownershipFilename,
                    config.payloadIdentityFilename,
                    config.treeDirectory,
                ].includes(name),
        )
    )
        throw new TypeError("retained device staging has unowned entries");
    let payloadIdentity: DeviceDirectoryIdentity;
    if (lstatSync(payload, { throwIfNoEntry: false }) === undefined) {
        if (
            lstatSync(path.join(directory, config.payloadIdentityFilename), {
                throwIfNoEntry: false,
            }) !== undefined
        )
            throw new TypeError("retained payload disappeared after ownership publication");
        mkdirSync(payload, { mode: config.directoryMode });
        syncDirectory(directory);
        payloadIdentity = deviceDirectoryIdentity(payload);
        const descriptor = openSync(
            path.join(directory, config.payloadIdentityFilename),
            constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
            config.fileMode,
        );
        try {
            writeFileSync(
                descriptor,
                canonicalizeRecord({ owner: marker, payload_identity: payloadIdentity }),
            );
            fsyncSync(descriptor);
        } finally {
            closeSync(descriptor);
        }
        syncDirectory(directory);
    } else payloadIdentity = readDevicePayloadIdentity(directory, marker);
    const flush = (directory: string): void => {
        for (const name of readdirSync(directory)) {
            const child = path.join(directory, name);
            const status = lstatSync(child);
            if (status.isDirectory()) flush(child);
            else if (status.isFile()) {
                const descriptor = openSync(
                    child,
                    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
                );
                try {
                    fsyncSync(descriptor);
                } finally {
                    closeSync(descriptor);
                }
            }
        }
        syncDirectory(directory);
    };
    if (retainedDeviceTreeIdentity(payload) !== expectedContent) {
        if (source !== null && retainedDeviceTreeIdentity(source) !== expectedContent)
            throw new TypeError("retained device source changed before publication");
        assertRetainedDeviceTreeBoundary(payload);
        for (const name of readdirSync(payload))
            removePathSync(path.join(payload, name), { recursive: true });
        if (source !== null) {
            for (const name of readdirSync(source).sort())
                copyTree(
                    path.join(source, name),
                    path.join(payload, name),
                    adapter === config.adapters.copy ? writeCopiedFile : materializeClonedFile,
                );
            chmodSync(payload, lstatSync(source).mode & 0o777);
        }
        if (
            retainedDeviceTreeIdentity(payload) !== expectedContent ||
            (source !== null && retainedDeviceTreeIdentity(source) !== expectedContent)
        )
            throw new TypeError("retained device publication failed content verification");
    }
    flush(payload);
    syncDirectory(directory);
    return { directory, identity, payload_identity: payloadIdentity, content_id: expectedContent };
}

/** Reads an owned current-world path without traversing symbolic links. @internal */
export function retainedDeviceFilePath(world: string, relative: string): string {
    let current = world;
    const rootDevice = lstatSync(world).dev;
    for (const segment of readWorldPath(relative).split("/")) {
        current = path.join(current, segment);
        const status = lstatSync(current, { throwIfNoEntry: false });
        if (status?.isSymbolicLink())
            throw new TypeError("retained device path traverses a symbolic link");
        if (status !== undefined && status.dev !== rootDevice)
            throw new TypeError("retained device path crosses a filesystem boundary");
    }
    return current;
}

/** Lists regular files after a bounded traversal, without following symlinks. @internal */
export function listRetainedDeviceFiles(world: string): readonly DeviceLayerFileEntry[] {
    retainedDeviceTreeIdentity(world);
    const files: DeviceLayerFileEntry[] = [];
    const visit = (directory: string, prefix: string): void => {
        for (const name of readdirSync(directory).sort()) {
            const absolute = path.join(directory, name);
            const relative = prefix + name;
            const status = lstatSync(absolute);
            if (status.isDirectory()) visit(absolute, `${relative}/`);
            else if (status.isFile())
                files.push({ path: relative, digest: digestOf(readFileSync(absolute)) });
        }
    };
    visit(world, "");
    return Object.freeze(files.map((entry) => Object.freeze(entry)));
}

/** Refuses mounted descendants, including same-filesystem bind mounts, from Linux mountinfo. @internal */
export function assertRetainedDeviceMountTable(root: string, text: string): void {
    const lines = text.split("\n").filter((line) => line.length > 0);
    if (lines.length === 0) throw new TypeError("retained device mount table is unavailable");
    for (const line of lines) {
        const separator = line.indexOf(" - ");
        const fields = line.slice(0, separator).split(" ");
        if (separator < 0 || fields.length < 6 || !fields[4]?.startsWith("/"))
            throw new TypeError("retained device mount table is malformed");
        const target = (fields[4] as string).replace(/\\([0-7]{3})/gu, (_match, octal: string) =>
            String.fromCharCode(Number.parseInt(octal, 8)),
        );
        if (target === root || target.startsWith(`${root}${path.sep}`))
            throw new TypeError("retained device contains a foreign mount");
    }
}

/** Refuses mounted or cross-device descendants before recursive filesystem operations. @internal */
export function assertRetainedDeviceTreeBoundary(root: string): void {
    assertRetainedDeviceMounts(root);
    const rootDevice = lstatSync(root).dev;
    let entries = 0;
    const visit = (target: string): void => {
        if (++entries > config.limits.maxEntries)
            throw new TypeError("retained device traversal exceeds entry bound");
        const status = lstatSync(target);
        if (status.dev !== rootDevice)
            throw new TypeError("retained device crosses a filesystem boundary");
        if (status.isDirectory())
            for (const name of readdirSync(target)) visit(path.join(target, name));
    };
    visit(root);
}

/** Checks the platform mount table without traversing resource contents. @internal */
export function assertRetainedDeviceMounts(root: string): void {
    const overlay = workspaceProtocolConfig.carrierBackends.overlay;
    if (overlay.platforms.includes(process.platform))
        assertRetainedDeviceMountTable(root, readFileSync(overlay.mountInfoPath, "utf8"));
}
