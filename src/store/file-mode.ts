import { closeSync, constants, fchmodSync, fstatSync, openSync } from "node:fs";

import { retentionProtocolConfig } from "../protocol/config.ts";

const PERMISSION_BITS = 0o777;

/**
 * Creates a missing writable SQLite database file with the configured owner-only mode and tightens
 * an existing database and its sidecars before SQLite opens them.
 *
 * SQLite's Unix VFS creates the WAL, SHM, and rollback-journal files with the permission bits of
 * the database file, so creating the database owner-only also makes every later sidecar
 * owner-only. Existing files are only tightened, never loosened, and only when they are regular
 * files owned by the current user. Every file is opened without following a symbolic link and
 * inspected and changed through that descriptor (`fstat`, `fchmod`), so a path swapped for a link
 * between the check and the change cannot redirect the change; a link at a database or sidecar
 * path is left untouched.
 *
 * @param databasePath - Writable SQLite file path; `:memory:` is ignored.
 * @throws {Error} With the file-system code when the database cannot be created for a reason other
 * than already existing (for example `ENOENT` or `EACCES`), or an existing database or sidecar
 * cannot be opened for a reason other than being absent or a symbolic link.
 * @internal
 */
export function prepareOwnerOnlyDatabaseFile(databasePath: string): void {
    if (databasePath === ":memory:") {
        return;
    }
    const { mode, sidecarSuffixes } = retentionProtocolConfig.storeFiles;
    try {
        closeSync(
            openSync(
                databasePath,
                constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
                mode,
            ),
        );
    } catch (error) {
        // An existing file (or link, which O_EXCL never follows) is examined below.
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
            throw error;
        }
    }
    for (const suffix of ["", ...sidecarSuffixes]) {
        tightenOwnedFile(`${databasePath}${suffix}`, mode);
    }
}

function tightenOwnedFile(filePath: string, mode: number): void {
    let descriptor: number;
    try {
        descriptor = openSync(
            filePath,
            constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
        );
    } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ENOENT" || code === "ELOOP") {
            return;
        }
        throw error;
    }
    try {
        const stats = fstatSync(descriptor);
        if (
            stats.isFile() &&
            (stats.mode & PERMISSION_BITS & ~mode) !== 0 &&
            stats.uid === process.getuid?.()
        ) {
            fchmodSync(descriptor, mode);
        }
    } finally {
        closeSync(descriptor);
    }
}
