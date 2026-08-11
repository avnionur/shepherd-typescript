import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
    closeSync,
    existsSync,
    fsyncSync,
    linkSync,
    lstatSync,
    mkdirSync,
    openSync,
    readdirSync,
    readFileSync,
    readlinkSync,
    realpathSync,
    unlinkSync,
    writeFileSync,
} from "node:fs";
import path from "node:path";
import { syncDirectory } from "../blob/directory-durability.ts";
import { workspaceProtocolConfig } from "../protocol/config.ts";
import { WORKSPACE_ADOPTION_MODES } from "../protocol/values.generated.ts";
import { WorkspaceControlError, WorkspaceInitializationConflictError } from "./errors.ts";
import type {
    WorkspaceAdoptionMode,
    WorkspaceInitializationOptions,
    WorkspaceState,
} from "./types.ts";

type WorkspaceManifest = {
    readonly adopt_mode: WorkspaceAdoptionMode;
    readonly baseline_ref: string | null;
    readonly format: string;
    readonly format_version: number;
    readonly git_head: string | null;
    readonly initialize_git: boolean;
};

/**
 * Initializes or exactly reuses workspace control state without modifying ordinary Git history.
 *
 * The root must already exist. When authorized and no containing Git repository exists, this
 * function runs `git init` but never creates a commit, stages files, or rewrites refs. Adoption
 * records only the baseline citation needed by later carrier slices; it does not materialize a
 * retained world.
 *
 * @param options - Closed initialization options and existing workspace root.
 * @returns Frozen validated workspace state.
 * @throws {WorkspaceControlError} If filesystem, Git, or retained control evidence is unsafe.
 * @throws {WorkspaceInitializationConflictError} If retained options differ from this request.
 * @throws {TypeError} If options are malformed.
 */
export function initializeWorkspace(options: WorkspaceInitializationOptions): WorkspaceState {
    const parsed = readInitializationOptions(options);
    const rootPath = readWorkspaceRoot(parsed.rootPath);
    try {
        const existingControlPath = path.join(rootPath, workspaceProtocolConfig.controlDirectory);
        if (existsSync(existingControlPath)) {
            const { controlPath, manifestPath } = resolveControlPaths(rootPath, false);
            const retained = readManifest(manifestPath);
            if (!sameInitializationOptions(retained, parsed)) {
                throw new WorkspaceInitializationConflictError();
            }
            const git = readGitState(rootPath);
            assertRetainedGitEvidence(rootPath, retained, git);
            return stateFrom(rootPath, controlPath, retained, git);
        }
        let git = readGitState(rootPath);
        if (git.repositoryRoot === null && parsed.initializeGit) {
            runGit(rootPath, ["init"], "Git repository initialization failed");
            git = readGitState(rootPath);
            /* node:coverage disable */
            if (git.repositoryRoot === null) {
                throw new WorkspaceControlError("Git initialization did not create a repository");
            }
            /* node:coverage enable */
        }
        if (parsed.adopt === "git-head" && git.head === null) {
            throw new WorkspaceControlError("git-head adoption requires an existing Git HEAD");
        }
        const manifest: WorkspaceManifest = {
            adopt_mode: parsed.adopt,
            baseline_ref: baselineRef(rootPath, parsed.adopt, git.head),
            format: workspaceProtocolConfig.format,
            format_version: workspaceProtocolConfig.formatVersion,
            git_head: parsed.adopt === "none" ? null : git.head,
            initialize_git: parsed.initializeGit,
        };
        const { controlPath, manifestPath } = resolveControlPaths(rootPath, true);
        /* node:coverage disable */
        const retained = existsSync(manifestPath)
            ? readManifest(manifestPath)
            : publishManifest(controlPath, manifestPath, manifest);
        if (!sameInitializationOptions(retained, parsed)) {
            throw new WorkspaceInitializationConflictError();
        }
        /* node:coverage enable */
        assertRetainedGitEvidence(rootPath, retained, git);
        return stateFrom(rootPath, controlPath, retained, git);
    } catch (error) {
        throwWorkspaceError(error);
    }
}

/**
 * Opens existing workspace control state without mutation.
 *
 * @param rootPath - Existing initialized workspace root.
 * @returns Frozen validated workspace and current Git context.
 * @throws {WorkspaceControlError} If the root or control evidence is missing, unsafe, malformed,
 * or inconsistent with required Git evidence.
 * @throws {TypeError} If `rootPath` is malformed.
 */
export function openWorkspace(rootPath: string): WorkspaceState {
    const canonicalRoot = readWorkspaceRoot(rootPath);
    try {
        const { controlPath, manifestPath } = resolveControlPaths(canonicalRoot, false);
        const manifest = readManifest(manifestPath);
        const git = readGitState(canonicalRoot);
        assertRetainedGitEvidence(canonicalRoot, manifest, git);
        return stateFrom(canonicalRoot, controlPath, manifest, git);
    } catch (error) {
        throwWorkspaceError(error);
    }
}

function readInitializationOptions(value: unknown): {
    readonly adopt: WorkspaceAdoptionMode;
    readonly initializeGit: boolean;
    readonly rootPath: string;
} {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new TypeError("workspace initialization options must be an object");
    }
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError("workspace initialization options must be a data object");
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (
        Object.values(descriptors).some((item) => item.get !== undefined || item.set !== undefined)
    ) {
        throw new TypeError("workspace initialization options must not contain accessors");
    }
    const fields = value as Record<string, unknown>;
    const keys = Object.keys(fields).sort();
    const allowed = [
        ...(fields.adopt === undefined ? [] : ["adopt"]),
        ...(fields.initializeGit === undefined ? [] : ["initializeGit"]),
        "rootPath",
    ].sort();
    if (keys.length !== allowed.length || keys.some((key, index) => key !== allowed[index])) {
        throw new TypeError("workspace initialization options must be exact");
    }
    if (typeof fields.rootPath !== "string" || fields.rootPath.length === 0) {
        throw new TypeError("workspace rootPath must be a non-empty string");
    }
    const adopt = fields.adopt ?? workspaceProtocolConfig.defaultAdoptionMode;
    if (typeof adopt !== "string" || !WORKSPACE_ADOPTION_MODES.includes(adopt as never)) {
        throw new TypeError("workspace adopt mode is unsupported");
    }
    const initializeGit = fields.initializeGit ?? workspaceProtocolConfig.defaultInitializeGit;
    if (typeof initializeGit !== "boolean") {
        throw new TypeError("workspace initializeGit must be boolean");
    }
    return { adopt: adopt as WorkspaceAdoptionMode, initializeGit, rootPath: fields.rootPath };
}

function readWorkspaceRoot(rootPath: string): string {
    if (typeof rootPath !== "string" || rootPath.length === 0) {
        throw new TypeError("workspace root path must be a non-empty string");
    }
    try {
        const canonical = realpathSync(rootPath);
        if (!lstatSync(canonical).isDirectory()) {
            throw new WorkspaceControlError("workspace root must be a directory");
        }
        return canonical;
    } catch (error) {
        if (error instanceof WorkspaceControlError) {
            throw error;
        }
        throw new WorkspaceControlError("workspace root is unavailable");
    }
}

function resolveControlPaths(
    rootPath: string,
    create: boolean,
): { readonly controlPath: string; readonly manifestPath: string } {
    const controlPath = path.join(rootPath, workspaceProtocolConfig.controlDirectory);
    if (!existsSync(controlPath)) {
        if (!create) {
            throw new WorkspaceControlError("workspace is not initialized");
        }
        try {
            mkdirSync(controlPath);
            /* node:coverage disable */
        } catch (error) {
            if (!isNodeError(error, "EEXIST")) {
                throw error;
            }
        }
        /* node:coverage enable */
    }
    const control = lstatSync(controlPath);
    if (!control.isDirectory() || control.isSymbolicLink()) {
        throw new WorkspaceControlError("workspace control path must be a real directory");
    }
    return {
        controlPath,
        manifestPath: path.join(controlPath, workspaceProtocolConfig.manifestFile),
    };
}

function publishManifest(
    controlPath: string,
    manifestPath: string,
    manifest: WorkspaceManifest,
): WorkspaceManifest {
    const temporaryPath = path.join(
        controlPath,
        `${workspaceProtocolConfig.manifestFile}.${randomUUID()}.tmp`,
    );
    let fileDescriptor: number | null = null;
    try {
        fileDescriptor = openSync(temporaryPath, "wx", 0o600);
        writeFileSync(fileDescriptor, `${JSON.stringify(manifest)}\n`, "utf8");
        fsyncSync(fileDescriptor);
        closeSync(fileDescriptor);
        fileDescriptor = null;
        try {
            linkSync(temporaryPath, manifestPath);
            /* node:coverage disable */
        } catch (error) {
            if (!isNodeError(error, "EEXIST")) {
                throw error;
            }
        }
        /* node:coverage enable */
        unlinkSync(temporaryPath);
        syncDirectory(controlPath);
        return readManifest(manifestPath);
        /* node:coverage disable */
    } catch (error) {
        if (fileDescriptor !== null) {
            closeSync(fileDescriptor);
        }
        if (existsSync(temporaryPath)) {
            unlinkSync(temporaryPath);
        }
        if (error instanceof WorkspaceControlError) {
            throw error;
        }
        throw new WorkspaceControlError("workspace control manifest publication failed");
    }
    /* node:coverage enable */
}

function readManifest(manifestPath: string): WorkspaceManifest {
    try {
        const status = lstatSync(manifestPath);
        if (!status.isFile() || status.isSymbolicLink()) {
            throw new WorkspaceControlError("workspace manifest must be a real file");
        }
        return validateManifest(JSON.parse(readFileSync(manifestPath, "utf8")) as unknown);
    } catch (error) {
        if (error instanceof WorkspaceControlError) {
            throw error;
        }
        throw new WorkspaceControlError();
    }
}

function validateManifest(value: unknown): WorkspaceManifest {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new WorkspaceControlError();
    }
    const fields = value as Record<string, unknown>;
    const keys = Object.keys(fields).sort();
    const expected = [
        "adopt_mode",
        "baseline_ref",
        "format",
        "format_version",
        "git_head",
        "initialize_git",
    ];
    if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
        throw new WorkspaceControlError();
    }
    if (
        fields.format !== workspaceProtocolConfig.format ||
        fields.format_version !== workspaceProtocolConfig.formatVersion ||
        typeof fields.initialize_git !== "boolean" ||
        typeof fields.adopt_mode !== "string" ||
        !WORKSPACE_ADOPTION_MODES.includes(fields.adopt_mode as never) ||
        (fields.baseline_ref !== null && typeof fields.baseline_ref !== "string") ||
        (fields.git_head !== null &&
            (typeof fields.git_head !== "string" || !/^[0-9a-f]{40,64}$/u.test(fields.git_head))) ||
        (fields.adopt_mode === "none" && fields.git_head !== null) ||
        (fields.adopt_mode === "none" && fields.baseline_ref !== null) ||
        (fields.adopt_mode === "git-head" &&
            (fields.git_head === null ||
                fields.baseline_ref !==
                    `${workspaceProtocolConfig.gitHeadRefPrefix}${fields.git_head}`)) ||
        (fields.adopt_mode === "worktree" &&
            (typeof fields.baseline_ref !== "string" || !validWorktreeRef(fields.baseline_ref)))
    ) {
        throw new WorkspaceControlError();
    }
    return {
        adopt_mode: fields.adopt_mode as WorkspaceAdoptionMode,
        baseline_ref: fields.baseline_ref as string | null,
        format: workspaceProtocolConfig.format,
        format_version: workspaceProtocolConfig.formatVersion,
        git_head: fields.git_head as string | null,
        initialize_git: fields.initialize_git,
    };
}

function readGitState(rootPath: string): {
    readonly head: string | null;
    readonly repositoryRoot: string | null;
} {
    const repositoryRoot = tryGit(rootPath, ["rev-parse", "--show-toplevel"]);
    if (repositoryRoot === null) {
        return { head: null, repositoryRoot: null };
    }
    return {
        head: tryGit(rootPath, ["rev-parse", "--verify", "HEAD"]),
        repositoryRoot: realpathSync(repositoryRoot),
    };
}

function gitCommitExists(rootPath: string, commit: string): boolean {
    return tryGit(rootPath, ["cat-file", "-e", `${commit}^{commit}`]) !== null;
}

function tryGit(rootPath: string, args: readonly string[]): string | null {
    const result = spawnSync(workspaceProtocolConfig.gitExecutable, ["-C", rootPath, ...args], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.error !== undefined) {
        throw new WorkspaceControlError("configured Git executable is unavailable");
    }
    return result.status === 0 ? result.stdout.trim() : null;
}

function runGit(rootPath: string, args: readonly string[], message: string): void {
    const result = spawnSync(workspaceProtocolConfig.gitExecutable, ["-C", rootPath, ...args], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.error !== undefined || result.status !== 0) {
        throw new WorkspaceControlError(message);
    }
}

function stateFrom(
    rootPath: string,
    controlPath: string,
    manifest: WorkspaceManifest,
    git: { readonly head: string | null; readonly repositoryRoot: string | null },
): WorkspaceState {
    return Object.freeze({
        adoption: Object.freeze({
            baseline_ref: manifest.baseline_ref,
            git_head: manifest.git_head,
            mode: manifest.adopt_mode,
        }),
        control_path: controlPath,
        format: manifest.format,
        format_version: manifest.format_version,
        git: Object.freeze({ head: git.head, repository_root: git.repositoryRoot }),
        initialize_git: manifest.initialize_git,
        root_path: rootPath,
    });
}

function sameInitializationOptions(
    manifest: WorkspaceManifest,
    options: { readonly adopt: WorkspaceAdoptionMode; readonly initializeGit: boolean },
): boolean {
    return (
        manifest.adopt_mode === options.adopt && manifest.initialize_git === options.initializeGit
    );
}

function assertRetainedGitEvidence(
    rootPath: string,
    manifest: WorkspaceManifest,
    git: { readonly head: string | null; readonly repositoryRoot: string | null },
): void {
    if (manifest.initialize_git && git.repositoryRoot === null) {
        throw new WorkspaceControlError("initialized workspace no longer has a Git repository");
    }
    if (manifest.git_head !== null && !gitCommitExists(rootPath, manifest.git_head)) {
        throw new WorkspaceControlError("adopted Git HEAD is unavailable");
    }
}

function baselineRef(
    rootPath: string,
    mode: WorkspaceAdoptionMode,
    gitHead: string | null,
): string | null {
    if (mode === "none") {
        return null;
    }
    if (mode === "git-head") {
        /* node:coverage disable */
        if (gitHead === null) {
            throw new WorkspaceControlError("git-head adoption requires an existing Git HEAD");
        }
        /* node:coverage enable */
        return `${workspaceProtocolConfig.gitHeadRefPrefix}${gitHead}`;
    }
    const entries: Record<string, string | boolean>[] = [];
    collectWorktreeEntries(rootPath, "", entries);
    const digest = createHash(workspaceProtocolConfig.digestAlgorithm)
        .update(JSON.stringify(entries), "utf8")
        .digest("hex");
    return `${workspaceProtocolConfig.worktreeRefPrefix}${digest}`;
}

function collectWorktreeEntries(
    rootPath: string,
    relativeDirectory: string,
    entries: Record<string, string | boolean>[],
): void {
    const directoryPath = path.join(rootPath, relativeDirectory);
    const children = readdirSync(directoryPath, { withFileTypes: true }).sort(
        (left, right) => Number(left.name > right.name) - Number(left.name < right.name),
    );
    for (const child of children) {
        if (
            relativeDirectory.length === 0 &&
            (child.name === workspaceProtocolConfig.controlDirectory ||
                child.name === workspaceProtocolConfig.gitMetadataName)
        ) {
            continue;
        }
        const relativePath =
            relativeDirectory.length === 0 ? child.name : `${relativeDirectory}/${child.name}`;
        const absolutePath = path.join(rootPath, relativePath);
        const status = lstatSync(absolutePath);
        if (status.isDirectory()) {
            entries.push({ path: relativePath, type: "directory" });
            collectWorktreeEntries(rootPath, relativePath, entries);
        } else if (status.isFile()) {
            entries.push({
                content_digest: createHash(workspaceProtocolConfig.digestAlgorithm)
                    .update(readFileSync(absolutePath))
                    .digest("hex"),
                executable: (status.mode & 0o111) !== 0,
                path: relativePath,
                type: "file",
            });
        } else if (status.isSymbolicLink()) {
            entries.push({
                path: relativePath,
                target: readlinkSync(absolutePath),
                type: "symlink",
            });
            /* node:coverage disable */
        } else {
            throw new WorkspaceControlError("workspace contains an unsupported filesystem object");
        }
        /* node:coverage enable */
    }
}

function validWorktreeRef(value: string): boolean {
    const digest = value.slice(workspaceProtocolConfig.worktreeRefPrefix.length);
    return (
        value.startsWith(workspaceProtocolConfig.worktreeRefPrefix) &&
        digest.length === workspaceProtocolConfig.hexLength &&
        /^[0-9a-f]+$/u.test(digest)
    );
}

/* node:coverage disable */
function isNodeError(error: unknown, code: string): boolean {
    return error instanceof Error && "code" in error && error.code === code;
}

function throwWorkspaceError(error: unknown): never {
    if (
        error instanceof WorkspaceControlError ||
        error instanceof WorkspaceInitializationConflictError
    ) {
        throw error;
    }
    throw new WorkspaceControlError();
}
/* node:coverage enable */
