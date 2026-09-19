import {
    closeSync,
    existsSync,
    fsyncSync,
    lstatSync,
    mkdirSync,
    openSync,
    realpathSync,
} from "node:fs";
import path from "node:path";

const DIRECTORY_FSYNC_UNSUPPORTED_PLATFORMS: ReadonlySet<NodeJS.Platform> = new Set(["win32"]);

/**
 * Creates a directory while rejecting symlinks and non-directory path components.
 *
 * Each newly created directory is followed by a parent-directory flush on supported platforms.
 * Directory flushing is skipped on Windows. A component another process creates between the
 * existence check and `mkdir` is inspected like any existing component, so concurrent callers
 * creating the same directory all succeed.
 */
export function ensureDurableDirectory(directoryPath: string): string {
    const absolutePath = path.resolve(directoryPath);
    const filesystemRoot = path.parse(absolutePath).root;
    let currentPath = filesystemRoot;
    for (const segment of path.relative(filesystemRoot, absolutePath).split(path.sep)) {
        currentPath = path.join(currentPath, segment);
        if (!existsSync(currentPath) && createMissingDirectory(currentPath)) {
            syncDirectory(path.dirname(currentPath));
            continue;
        }
        const status = lstatSync(currentPath);
        if (status.isSymbolicLink() || !status.isDirectory()) {
            throw new TypeError("blobDirectory must not use a symlink or non-directory ancestor");
        }
    }
    return realpathSync(absolutePath);
}

/**
 * Creates one owner-only directory.
 *
 * @param directoryPath - Directory whose parent exists.
 * @returns `true` if this call created it, `false` if the path already existed.
 * @throws {Error} Any `mkdir` failure other than `EEXIST`.
 * @internal
 */
export function createMissingDirectory(directoryPath: string): boolean {
    try {
        mkdirSync(directoryPath, { mode: 0o700 });
        return true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") {
            return false;
        }
        throw error;
    }
}

/** Flushes directory entries on platforms that expose directory file descriptors. */
export function syncDirectory(directoryPath: string): void {
    /* node:coverage disable */
    if (DIRECTORY_FSYNC_UNSUPPORTED_PLATFORMS.has(process.platform)) {
        return;
    }
    /* node:coverage enable */
    const descriptor = openSync(directoryPath, "r");
    try {
        fsyncSync(descriptor);
    } finally {
        closeSync(descriptor);
    }
}
