import { lstatSync, type RmOptions, rmSync, unlinkSync } from "node:fs";

/**
 * Removes a filesystem path synchronously, unlinking a symbolic link itself and never its target.
 *
 * `fs.rmSync` on Node.js 24.12.x and 24.13.x silently leaves a dangling symbolic link in place
 * without throwing, with or without `force` and `recursive` (F-031; fixed upstream by 24.15.0).
 * This helper inspects the path with `lstat` first: a symbolic link, dangling or not, is removed
 * with `unlink`, and any other path is delegated to `rmSync` with the given options, so a missing
 * path is ignored only when `force` is set. Symbolic links nested inside a removed directory are
 * unaffected by the defect and are removed by `rmSync`.
 *
 * @param target - Path to remove; a symbolic link is removed without following it.
 * @param options - `rmSync` options (`force`, `recursive`, retry settings) for non-link paths.
 * @throws {Error} The `unlink` or `rmSync` system error, for example `ENOENT` for a missing path
 * without `force`, or `ERR_FS_EISDIR` for a directory without `recursive`.
 * @example
 * removePathSync(temporaryPath, { force: true });
 */
export function removePathSync(target: string, options: RmOptions = {}): void {
    if (lstatSync(target, { throwIfNoEntry: false })?.isSymbolicLink() === true) {
        unlinkSync(target);
        return;
    }
    rmSync(target, options);
}
