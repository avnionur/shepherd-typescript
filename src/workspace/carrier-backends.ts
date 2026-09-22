import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
    chmodSync,
    closeSync,
    constants,
    copyFileSync,
    fchmodSync,
    fstatSync,
    fsyncSync,
    lstatSync,
    mkdirSync,
    mkdtempSync,
    openSync,
    readdirSync,
    readFileSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { workspaceProtocolConfig } from "../protocol/config.ts";
import { removePathSync } from "../runtime/remove-path.ts";
import { WorldCarrierError } from "./errors.ts";

/** Writes one verified regular file into owned carrier or publication storage. @internal */
export type CarrierFileMaterializer = (
    source: string,
    target: string,
    bytes: Buffer,
    mode: number,
) => void;

/** Host-validated physical strategy behind one reference carrier. @internal */
export type CarrierBackendRuntime = {
    /** Configured backend name. */
    readonly name: string;
    /** Whether mutable custody is an overlay mount of its immutable base revision. */
    readonly overlay: boolean;
    /** Regular-file materialization used for staging, revisions, custody, and publication. */
    readonly materializeFile: CarrierFileMaterializer;
};

/** Exact overlay layer paths for one custody mount. @internal */
export type OverlayLayers = {
    /** Immutable lower revision world. */
    readonly lower: string;
    /** Mount target exposing the merged world. */
    readonly target: string;
    /** Private upper layer receiving every write. */
    readonly upper: string;
    /** Private overlay work directory. */
    readonly work: string;
};

/** Observed state of one custody overlay mount target. @internal */
export type OverlayMountState = "absent" | "foreign" | "owned";

/** Frozen availability evidence for one optimized backend on the current host. @internal */
export type CarrierBackendAvailability = {
    /** Configured backend name. */
    readonly backend: string;
    /** Configured availability reason. */
    readonly reason: string;
    /** Configured parity status. */
    readonly status: string;
};

/** Raised when a selected backend cannot run on the current host or filesystem. @internal */
export class CarrierBackendUnavailableError extends WorldCarrierError {
    /** Configured backend that is unavailable. */
    readonly backend: string;
    /** Configured availability reason. */
    readonly reason: string;

    /**
     * Creates a configured fail-closed backend refusal.
     *
     * @param backend - Configured backend name.
     * @param reason - Configured availability reason.
     * @param detail - Host diagnostic appended to the configured message.
     */
    constructor(backend: string, reason: string, detail: string) {
        const errors = workspaceProtocolConfig.carrierBackends.errors;
        super(
            errors.unavailableCode,
            `${errors.unavailableMessage}: ${backend}: ${reason}: ${detail}`,
        );
        this.name = "WorldCarrierError";
        this.backend = backend;
        this.reason = reason;
    }
}

const BACKENDS = workspaceProtocolConfig.carrierBackends;
const CLONE_HELPER_SOURCE = `#include <errno.h>
#include <stdio.h>
#include <string.h>
#include <sys/attr.h>
#include <sys/clonefile.h>

int main(int argc, char *argv[]) {
    if (argc != 3) {
        return 2;
    }
    if (clonefile(argv[1], argv[2], CLONE_NOFOLLOW) != 0) {
        fprintf(stderr, "%s\\n", strerror(errno));
        return 1;
    }
    return 0;
}
`;
let cloneHelper: Readonly<{ digest: string; directory: string; path: string }> | null = null;

/**
 * Reads an optional exact carrier backend option.
 *
 * @param value - Candidate backend option.
 * @returns The configured backend, or the configured default when omitted.
 * @throws {TypeError} If the value is not a configured backend name.
 * @internal
 */
export function readCarrierBackendOption(value: unknown): string {
    if (value === undefined) return BACKENDS.defaultBackend;
    if (typeof value !== "string" || !BACKENDS.backends.includes(value)) {
        throw new TypeError("reference copy carrier backend is unsupported");
    }
    return value;
}

/**
 * Opens one configured backend after proving it works inside owned carrier staging.
 *
 * @param backend - Configured backend name.
 * @param stagingDirectory - Owned private carrier staging directory used for host probes.
 * @returns Frozen backend strategy.
 * @throws {WorldCarrierError} If the backend is unavailable or the probe leaves unsafe state.
 * @internal
 */
export function openCarrierBackend(
    backend: string,
    stagingDirectory: string,
): CarrierBackendRuntime {
    if (backend === BACKENDS.clone.backend) {
        probeInDirectory(stagingDirectory, (root) => {
            const source = path.join(root, randomUUID());
            const bytes = Buffer.from(randomUUID());
            writeCopiedFile(source, source, bytes, 0o600);
            materializeClonedFile(source, path.join(root, randomUUID()), bytes, 0o600);
        });
        /* node:coverage disable */
        // Reached only when the host clone probe succeeds on a reflink-capable filesystem.
        return Object.freeze({
            materializeFile: materializeClonedFile,
            name: backend,
            overlay: false,
        });
        /* node:coverage enable */
    }
    if (backend === BACKENDS.overlay.backend) {
        /* node:coverage disable */
        // Overlay availability is host-specific: non-Linux hosts refuse here and Linux hosts probe.
        if (!BACKENDS.overlay.platforms.includes(process.platform)) {
            throw new CarrierBackendUnavailableError(
                backend,
                BACKENDS.conformance.reasonRoles.platformUnsupported,
                process.platform,
            );
        }
        probeOverlay(stagingDirectory);
        return Object.freeze({ materializeFile: writeCopiedFile, name: backend, overlay: true });
        /* node:coverage enable */
    }
    return Object.freeze({ materializeFile: writeCopiedFile, name: backend, overlay: false });
}

/**
 * Reports parity availability for every optimized backend without throwing host refusals.
 *
 * A backend is conformant exactly when its host probe succeeds; the shared carrier conformance
 * suite runs every backend whose probe succeeds and asserts refusal for every other backend.
 *
 * @param stagingDirectory - Owned private carrier staging directory used for host probes.
 * @returns Frozen availability evidence in configured backend order, excluding the reference.
 * @throws {WorldCarrierError} If a probe fails with an error other than configured unavailability.
 * @internal
 */
export function inspectCarrierBackendAvailability(
    stagingDirectory: string,
): readonly CarrierBackendAvailability[] {
    const roles = BACKENDS.conformance;
    return Object.freeze(
        BACKENDS.backends
            .filter((backend) => backend !== BACKENDS.defaultBackend)
            .map((backend) => {
                try {
                    openCarrierBackend(backend, stagingDirectory);
                    return Object.freeze({
                        backend,
                        reason: roles.reasonRoles.available,
                        status: roles.statusRoles.conformant,
                    });
                } catch (error) {
                    if (!(error instanceof CarrierBackendUnavailableError)) throw error;
                    return Object.freeze({
                        backend,
                        reason: error.reason,
                        status: roles.statusRoles.unavailable,
                    });
                }
            }),
    );
}

/** Writes exact verified bytes into a new private regular file. @internal */
export function writeCopiedFile(
    _source: string,
    target: string,
    bytes: Buffer,
    mode: number,
): void {
    const descriptor = openSync(target, "wx", mode);
    try {
        writeFileSync(descriptor, bytes);
        fchmodSync(descriptor, mode);
        fsyncSync(descriptor);
    } finally {
        closeSync(descriptor);
    }
}

/**
 * Clones one source file and verifies the clone carries exactly the verified bytes and mode.
 *
 * @throws {WorldCarrierError} If the host cannot clone or the clone differs from the verified bytes.
 * @internal
 */
export function materializeClonedFile(
    source: string,
    target: string,
    bytes: Buffer,
    mode: number,
): void {
    assertAbsent(target);
    /* node:coverage disable */
    // Clone verification runs only after a successful host clone, so only reflink-capable hosts
    // execute it; the shared conformance suite exercises it wherever the clone backend is available.
    cloneFile(source, target);
    const descriptor = openSync(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
        const status = fstatSync(descriptor);
        const cloned = readFileSync(descriptor);
        if (!status.isFile() || status.nlink !== 1 || !cloned.equals(bytes)) {
            throw controlError("cloned file differs from verified source bytes");
        }
        fchmodSync(descriptor, mode);
        fsyncSync(descriptor);
    } finally {
        closeSync(descriptor);
    }
}
/* node:coverage enable */

/* node:coverage disable */
// Overlay custody executes only on Linux hosts with mount permission; the privileged Linux
// container run of the shared carrier conformance suite exercises every overlay path below.
/**
 * Mounts one overlay custody from exact retained layers.
 *
 * @throws {WorldCarrierError} If layer paths cannot be expressed or mounting is refused.
 * @internal
 */
export function mountOverlay(layers: OverlayLayers): void {
    const overlay = BACKENDS.overlay;
    for (const layer of Object.values(layers)) {
        if (overlay.reservedPathCharacters.some((character) => layer.includes(character))) {
            throw new CarrierBackendUnavailableError(
                overlay.backend,
                BACKENDS.conformance.reasonRoles.platformUnsupported,
                "overlay layer path cannot be expressed as mount options",
            );
        }
    }
    const options = renderOverlayOptions(layers);
    const result = runCommand(
        overlay.mountExecutable,
        overlay.mountArguments.map((argument) =>
            argument === overlay.tokens.options
                ? options
                : argument === overlay.tokens.target
                  ? layers.target
                  : argument,
        ),
    );
    if (result !== null) {
        throw new CarrierBackendUnavailableError(
            overlay.backend,
            BACKENDS.conformance.reasonRoles.mountNotPermitted,
            result,
        );
    }
}

/**
 * Unmounts one owned overlay custody target.
 *
 * @throws {WorldCarrierError} If the unmount command fails.
 * @internal
 */
export function unmountOverlay(target: string): void {
    const overlay = BACKENDS.overlay;
    const result = runCommand(
        overlay.unmountExecutable,
        overlay.unmountArguments.map((argument) =>
            argument === overlay.tokens.target ? target : argument,
        ),
    );
    if (result !== null) throw controlError(`overlay custody unmount failed: ${result}`);
}

/**
 * Classifies the current mount at an overlay target against exact retained layers.
 *
 * @returns `absent` without a mount, `owned` for the exact overlay, otherwise `foreign`.
 * @internal
 */
export function readOverlayMountState(layers: OverlayLayers): OverlayMountState {
    return classifyOverlayMountInfo(readFileSync(BACKENDS.overlay.mountInfoPath, "utf8"), layers);
}

function probeOverlay(stagingDirectory: string): void {
    const overlay = BACKENDS.overlay;
    probeInDirectory(stagingDirectory, (root) => {
        const layers = {
            lower: path.join(root, workspaceProtocolConfig.carrier.revisionsDirectory),
            target: path.join(root, workspaceProtocolConfig.carrier.worldDirectory),
            upper: path.join(root, overlay.upperDirectory),
            work: path.join(root, overlay.workDirectory),
        };
        for (const directory of Object.values(layers)) mkdirSync(directory, { mode: 0o700 });
        const probeName = randomUUID();
        mountOverlay(layers);
        try {
            if (readOverlayMountState(layers) !== "owned") {
                throw controlError("overlay probe mount is not the requested overlay");
            }
            writeCopiedFile(
                probeName,
                path.join(layers.target, probeName),
                Buffer.from(probeName),
                0o600,
            );
        } finally {
            unmountOverlay(layers.target);
        }
        if (
            readdirSync(layers.lower).length !== 0 ||
            !readdirSync(layers.upper).includes(probeName) ||
            readOverlayMountState(layers) !== "absent"
        ) {
            throw controlError("overlay probe wrote outside its private upper layer");
        }
    });
}

function runCommand(executable: string, args: readonly string[]): string | null {
    const result = spawnSync(executable, args, {
        encoding: "utf8",
        maxBuffer: BACKENDS.commandMaxBytes,
        stdio: ["ignore", "pipe", "pipe"],
        timeout: BACKENDS.commandTimeoutMs,
    });
    if (result.error === undefined && result.status === 0) return null;
    return String(result.error ?? (result.stderr.trim() || result.status));
}
/* node:coverage enable */

/**
 * Classifies Linux `mountinfo` text against exact retained overlay layers.
 *
 * The last entry whose unescaped mount point equals the target wins; it is `owned` only when its
 * filesystem type is the configured overlay type and its super options contain every configured
 * layer option. Host-independent so malformed and hostile mount tables can be tested anywhere.
 *
 * @returns `absent` without a matching entry, `owned` for the exact overlay, otherwise `foreign`.
 * @internal
 */
export function classifyOverlayMountInfo(
    mountInfo: string,
    layers: OverlayLayers,
): OverlayMountState {
    const overlay = BACKENDS.overlay;
    let entry: { readonly filesystem: string; readonly options: readonly string[] } | null = null;
    for (const line of mountInfo.split("\n")) {
        const separator = line.indexOf(" - ");
        if (separator < 0) continue;
        const fields = line.slice(0, separator).split(" ");
        if (unescapeMountText(fields[4] ?? "") !== layers.target) continue;
        const [filesystem = "", , superOptions = ""] = line.slice(separator + 3).split(" ");
        entry = {
            filesystem,
            options: superOptions.split(overlay.mountOptionSeparator).map(unescapeMountText),
        };
    }
    if (entry === null) return "absent";
    const expected = renderOverlayOptions(layers).split(overlay.mountOptionSeparator);
    return entry.filesystem === overlay.filesystemType &&
        expected.every((option) => entry.options.includes(option))
        ? "owned"
        : "foreign";
}

function renderOverlayOptions(layers: OverlayLayers): string {
    const tokens = BACKENDS.overlay.tokens;
    return BACKENDS.overlay.mountOptions
        .replaceAll(tokens.lower, layers.lower)
        .replaceAll(tokens.upper, layers.upper)
        .replaceAll(tokens.work, layers.work);
}

function unescapeMountText(value: string): string {
    return value.replace(/\\([0-7]{3})/gu, (_match, octal: string) =>
        String.fromCharCode(Number.parseInt(octal, 8)),
    );
}

function probeInDirectory(stagingDirectory: string, probe: (root: string) => void): void {
    const root = path.join(stagingDirectory, randomUUID());
    mkdirSync(root, { mode: 0o700 });
    try {
        probe(root);
    } finally {
        removePathSync(root, { force: true, recursive: true });
    }
}

function assertAbsent(target: string): void {
    try {
        lstatSync(target);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
        throw error;
    }
    throw controlError("clone target already exists");
}

/* node:coverage disable */
// Clone mechanisms are host-specific: Node exposes forced FICLONE only on Linux, so macOS clones
// through a compiled clonefile(2) helper. Each host's conformance suite runs exactly one mechanism.
function cloneFile(source: string, target: string): void {
    const clone = BACKENDS.clone;
    const reflinkUnsupported = BACKENDS.conformance.reasonRoles.reflinkUnsupported;
    if (clone.helper.platforms.includes(process.platform)) {
        const result = runCommand(cloneHelperExecutable(), [source, target]);
        if (result !== null) {
            removePathSync(target, { force: true });
            throw new CarrierBackendUnavailableError(clone.backend, reflinkUnsupported, result);
        }
        return;
    }
    try {
        copyFileSync(source, target, constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE_FORCE);
    } catch (error) {
        throw new CarrierBackendUnavailableError(
            clone.backend,
            reflinkUnsupported,
            String((error as NodeJS.ErrnoException).code ?? error),
        );
    }
}

function cloneHelperExecutable(): string {
    const helper = BACKENDS.clone.helper;
    if (cloneHelper !== null) {
        assertPrivateHelper(cloneHelper.directory, cloneHelper.path);
        if (digest(readFileSync(cloneHelper.path)) !== cloneHelper.digest) {
            throw controlError("clone helper integrity changed");
        }
        return cloneHelper.path;
    }
    const unavailable = (detail: string) =>
        new CarrierBackendUnavailableError(
            BACKENDS.clone.backend,
            BACKENDS.conformance.reasonRoles.helperUnavailable,
            detail,
        );
    const compiler = helper.compilerExecutables.find((candidate) => {
        try {
            return lstatSync(candidate).isFile() || lstatSync(candidate).isSymbolicLink();
        } catch {
            return false;
        }
    });
    if (compiler === undefined) throw unavailable("no configured compiler");
    const directory = mkdtempSync(path.join(tmpdir(), helper.temporaryDirectoryPrefix));
    process.once("exit", () => removePathSync(directory, { force: true, recursive: true }));
    chmodSync(directory, 0o700);
    const sourcePath = path.join(directory, helper.sourceName);
    const executablePath = path.join(directory, helper.executableName);
    writeFileSync(sourcePath, CLONE_HELPER_SOURCE, { encoding: "utf8", flag: "wx", mode: 0o600 });
    const result = runCommand(compiler, [
        ...helper.compilerArguments,
        helper.compilerOutputArgument,
        executablePath,
        sourcePath,
    ]);
    if (result !== null) {
        removePathSync(directory, { force: true, recursive: true });
        throw unavailable(result);
    }
    chmodSync(executablePath, 0o500);
    assertPrivateHelper(directory, executablePath);
    cloneHelper = Object.freeze({
        digest: digest(readFileSync(executablePath)),
        directory,
        path: executablePath,
    });
    return executablePath;
}

function assertPrivateHelper(directory: string, executable: string): void {
    const owner = process.getuid?.();
    const directoryStatus = lstatSync(directory);
    const executableStatus = lstatSync(executable);
    if (
        !directoryStatus.isDirectory() ||
        directoryStatus.uid !== owner ||
        (directoryStatus.mode & 0o777) !== 0o700 ||
        !executableStatus.isFile() ||
        executableStatus.uid !== owner ||
        executableStatus.nlink !== 1 ||
        (executableStatus.mode & 0o777) !== 0o500
    ) {
        throw controlError("clone helper directory or executable is not private");
    }
}

function digest(bytes: Buffer): string {
    return createHash(workspaceProtocolConfig.digestAlgorithm).update(bytes).digest("hex");
}
/* node:coverage enable */

function controlError(detail: string): WorldCarrierError {
    const errors = workspaceProtocolConfig.carrier.errors;
    return new WorldCarrierError(errors.controlCode, `${errors.controlMessage}: ${detail}`);
}
