import { lstatSync, realpathSync } from "node:fs";

/** Read-only result of inspecting one Git repository through caller-owned command execution. */
export type GitRepositoryObservation = {
    /** Whether Git classifies the repository as bare. */
    readonly bare: boolean;
    /** Canonical Git common directory. */
    readonly commonDir: string;
    /** Filesystem identity of the canonical common directory. */
    readonly commonDirIdentity: string;
    /** Canonical per-worktree Git directory. */
    readonly gitDir: string;
    /** Filesystem identity of the canonical per-worktree Git directory. */
    readonly gitDirIdentity: string;
    /** Exact Git executable version reported during inspection. */
    readonly gitVersion: string;
    /** Configured Git object format reported by the repository. */
    readonly objectFormat: string;
    /** Canonical worktree top level, or the inspected root for a bare repository. */
    readonly top: string;
};

/**
 * Reads canonical repository evidence with a caller-supplied read-only Git command seam.
 *
 * @param root - Canonical candidate repository root.
 * @param run - Read-only command function returning trimmed standard output.
 * @returns Canonical filesystem and Git repository evidence.
 */
export function inspectGitRepository(
    root: string,
    run: (args: readonly string[]) => string,
    identify: (path: string) => string = gitFilesystemIdentity,
): GitRepositoryObservation {
    const bare = run(["rev-parse", "--is-bare-repository"]) === "true";
    const top = bare ? realpathSync(root) : realpathSync(run(["rev-parse", "--show-toplevel"]));
    const gitDir = realpathSync(run(["rev-parse", "--absolute-git-dir"]));
    const commonDir = realpathSync(
        run(["rev-parse", "--path-format=absolute", "--git-common-dir"]),
    );
    return Object.freeze({
        bare,
        commonDir,
        commonDirIdentity: identify(commonDir),
        gitDir,
        gitDirIdentity: identify(gitDir),
        gitVersion: run(["--version"]),
        objectFormat: run(["rev-parse", "--show-object-format"]),
        top,
    });
}

/** @internal Returns a stable host-local filesystem revalidation identity. */
export function gitFilesystemIdentity(file: string): string {
    const status = lstatSync(file, { bigint: true });
    if (!status.isDirectory() || status.isSymbolicLink()) {
        throw new TypeError("Git repository evidence path must be a non-symbolic directory");
    }
    return `${status.dev}:${status.ino}`;
}

/** @internal Returns the v20 binding identity with a zero-inode canonical-path fallback. */
export function gitBindingFilesystemIdentity(file: string): string {
    const status = lstatSync(file, { bigint: true });
    // Git supplies real-path-resolved administrative directories; substitution is rejected again
    // at the public binding/custody seams before this configured identity is trusted.
    /* node:coverage disable */
    if (!status.isDirectory() || status.isSymbolicLink()) {
        throw new TypeError("Git repository binding path must be a non-symbolic directory");
    }
    return status.ino === 0n ? `path:${realpathSync(file)}` : `${status.dev}:${status.ino}`;
    /* node:coverage enable */
}
