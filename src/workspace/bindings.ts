import { spawnSync } from "node:child_process";
import { lstatSync, realpathSync } from "node:fs";
import path from "node:path";

import { createRecordId } from "../canonical/canonical-record.ts";
import { workspaceProtocolConfig } from "../protocol/config.ts";
import { WorkspaceBindingError } from "./errors.ts";
import { gitBindingFilesystemIdentity, inspectGitRepository } from "./git-repository-evidence.ts";
import { openWorkspace, openWorkspaceForRetainedCustody } from "./initialization.ts";
import type {
    GitRepositoryBinding,
    GitRepositoryBindingSet,
    WorkspaceBinding,
    WorkspaceBindingDefinition,
    WorkspaceBindingOptions,
    WorkspaceBindingSet,
} from "./types.ts";

const WORKSPACE_BINDINGS = new WeakSet<object>();
const GIT_REPOSITORY_BINDINGS = new WeakSet<object>();

/** Rejects structurally forged workspace binding handles. @internal */
export function assertWorkspaceBinding(value: unknown): asserts value is WorkspaceBinding {
    if (value === null || typeof value !== "object" || !WORKSPACE_BINDINGS.has(value)) {
        throw new TypeError("workspace binding authority is invalid");
    }
}

/**
 * Creates workspace protocol v2 stable canonical authorities for a complete disjoint binding set.
 *
 * Every root is resolved through the filesystem relative to the initialized workspace. Validation
 * finishes for the complete set before any authority is returned. This function does not create a
 * retained world or grant runtime access.
 *
 * @param options - Initialized workspace and complete proposed logical binding set.
 * @returns Frozen ordered binding authorities with stable content-addressed identities.
 * @throws {WorkspaceBindingError} If a name or root is invalid, escapes workspace authority, is
 * duplicated, or overlaps another canonical root.
 * @throws {WorkspaceControlError} If workspace control evidence cannot be opened safely.
 * @throws {TypeError} If the options or binding definitions are malformed.
 */
export function createWorkspaceBindings(options: WorkspaceBindingOptions): WorkspaceBindingSet {
    return createBindings(options, false);
}

/**
 * Creates stable repository-aware authorities for a complete disjoint binding set.
 *
 * Each root must be the exact top level of one supported non-bare Git worktree. Repositories are
 * inspected through read-only Git plumbing, and linked worktrees sharing one common repository
 * cannot be returned as distinct repository authorities in the same set.
 *
 * @param options - Initialized workspace and complete proposed repository binding set.
 * @returns Frozen ordered repository-backed authorities with stable resource identities.
 * @throws {WorkspaceBindingError} If a root is not an exact supported repository or two bindings
 * identify the same common Git repository.
 * @throws {WorkspaceControlError} If workspace control evidence cannot be opened safely.
 * @throws {TypeError} If the options or binding definitions are malformed.
 */
export function createGitRepositoryBindings(
    options: WorkspaceBindingOptions,
): GitRepositoryBindingSet {
    const base = createBindings(options, false);
    const bindings = base.bindings.map((binding): GitRepositoryBinding => {
        const repository = readRepositoryEvidence(binding.canonical_root);
        const config = workspaceProtocolConfig.repositoryBindings;
        const result = Object.freeze({
            ...binding,
            repository,
            resource_id: createRecordId({
                binding_id: binding.binding_id,
                kind: config.identityKind,
                repository_id: repository.repository_id,
                root: repository.root,
                type: config.resourceType,
                version: config.version,
                worktree_identity: repository.git_dir_identity,
            }),
            resource_type: config.resourceType,
        });
        WORKSPACE_BINDINGS.add(result);
        GIT_REPOSITORY_BINDINGS.add(result);
        return result;
    });
    return Object.freeze({
        binding_version: base.binding_version,
        bindings: Object.freeze(bindings),
        repository_binding_version: workspaceProtocolConfig.repositoryBindings.version,
        workspace_root: base.workspace_root,
    });
}

/** @internal Reports whether a package-created binding carries repository authority evidence. */
export function isGitRepositoryBinding(value: WorkspaceBinding): value is GitRepositoryBinding {
    return GIT_REPOSITORY_BINDINGS.has(value);
}

/** @internal Revalidates binding paths for independently retained custody. */
export function createWorkspaceBindingsForRetainedCustody(
    options: WorkspaceBindingOptions,
): WorkspaceBindingSet {
    return createBindings(options, true);
}

function createBindings(
    options: WorkspaceBindingOptions,
    retainedCustody: boolean,
): WorkspaceBindingSet {
    const parsed = readOptions(options);
    const workspace = retainedCustody
        ? openWorkspaceForRetainedCustody(parsed.workspaceRoot)
        : openWorkspace(parsed.workspaceRoot);
    const names = new Set<string>();
    const bindings: WorkspaceBinding[] = [];
    const bindingAncestorIdentities: (readonly string[])[] = [];
    for (const definition of parsed.bindings) {
        assertBindingName(definition.name);
        if (names.has(definition.name)) {
            throw bindingError("duplicateName");
        }
        names.add(definition.name);
        const canonicalRoot = canonicalBindingRoot(workspace.root_path, definition.root);
        for (const [index, retained] of bindings.entries()) {
            if (
                rootsOverlap(retained.canonical_root, canonicalRoot.path) ||
                identityRootsOverlap(
                    bindingAncestorIdentities[index] as readonly string[],
                    canonicalRoot.ancestorIdentities,
                )
            ) {
                throw bindingError(
                    "rootOverlap",
                    `${retained.name} (${retained.canonical_root}) conflicts with ${definition.name} (${canonicalRoot.path})`,
                );
            }
        }
        bindingAncestorIdentities.push(canonicalRoot.ancestorIdentities);
        const binding = Object.freeze({
            binding_id: createRecordId({
                kind: workspaceProtocolConfig.bindingIdentityKind,
                name: definition.name,
                root: canonicalRoot.path,
                version: workspaceProtocolConfig.bindingVersion,
                workspace_root: workspace.root_path,
            }),
            canonical_root: canonicalRoot.path,
            name: definition.name,
            requested_root: definition.root,
        });
        WORKSPACE_BINDINGS.add(binding);
        bindings.push(binding);
    }
    return Object.freeze({
        binding_version: workspaceProtocolConfig.bindingVersion,
        bindings: Object.freeze(bindings),
        workspace_root: workspace.root_path,
    });
}

function readOptions(value: unknown): {
    readonly bindings: readonly WorkspaceBindingDefinition[];
    readonly workspaceRoot: string;
} {
    const fields = exactDataObject(value, ["bindings", "workspaceRoot"], "binding options");
    if (typeof fields.workspaceRoot !== "string" || fields.workspaceRoot.length === 0) {
        throw new TypeError("binding options workspaceRoot must be a non-empty string");
    }
    if (!Array.isArray(fields.bindings)) {
        throw new TypeError("binding options bindings must be an array");
    }
    if (
        Object.getPrototypeOf(fields.bindings) !== Array.prototype ||
        Object.getOwnPropertySymbols(fields.bindings).length > 0
    ) {
        throw new TypeError("binding options bindings must be a data array");
    }
    const descriptors = Object.getOwnPropertyDescriptors(fields.bindings);
    const allowedKeys = new Set(["length"]);
    const bindings: WorkspaceBindingDefinition[] = [];
    for (let index = 0; index < fields.bindings.length; index += 1) {
        const key = String(index);
        allowedKeys.add(key);
        const descriptor = descriptors[key];
        if (descriptor === undefined || !("value" in descriptor)) {
            throw new TypeError("binding options bindings must be a dense data array");
        }
        const definition = exactDataObject(descriptor.value, ["name", "root"], "binding");
        if (typeof definition.name !== "string" || typeof definition.root !== "string") {
            throw new TypeError("binding name and root must be strings");
        }
        bindings.push({ name: definition.name, root: definition.root });
    }
    if (Object.keys(descriptors).some((key) => !allowedKeys.has(key))) {
        throw new TypeError("binding options bindings must not contain custom properties");
    }
    return { bindings, workspaceRoot: fields.workspaceRoot };
}

function exactDataObject(
    value: unknown,
    expectedKeys: readonly string[],
    context: string,
): Record<string, unknown> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new TypeError(`${context} must be an object`);
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
        throw new TypeError(`${context} must not contain symbol properties`);
    }
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError(`${context} must be a data object`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Object.values(descriptors).some((item) => !("value" in item))) {
        throw new TypeError(`${context} must not contain accessors`);
    }
    const keys = Object.keys(descriptors).sort();
    const expected = [...expectedKeys].sort();
    if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
        throw new TypeError(`${context} must be exact`);
    }
    return value as Record<string, unknown>;
}

function assertBindingName(name: string): void {
    if (
        name.trim().length === 0 ||
        name === "." ||
        name === ".." ||
        name.includes("/") ||
        name.includes("\\") ||
        name.includes("\0") ||
        /[\uD800-\uDFFF]/u.test(name)
    ) {
        throw bindingError("invalidName");
    }
}

function canonicalBindingRoot(
    workspaceRoot: string,
    requestedRoot: string,
): { readonly ancestorIdentities: readonly string[]; readonly path: string } {
    if (requestedRoot.length === 0) {
        throw bindingError("invalidRoot");
    }
    let canonicalRoot: string;
    try {
        canonicalRoot = realpathSync(path.resolve(workspaceRoot, requestedRoot));
        if (!lstatSync(canonicalRoot).isDirectory()) {
            throw bindingError("invalidRoot");
        }
    } catch (error) {
        if (error instanceof WorkspaceBindingError) {
            throw error;
        }
        throw bindingError("invalidRoot");
    }
    const relative = path.relative(workspaceRoot, canonicalRoot);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw bindingError("authorityEscape");
    }
    try {
        const ancestorIdentities: string[] = [];
        let current = canonicalRoot;
        while (true) {
            const status = lstatSync(current, { bigint: true });
            /* node:coverage disable */
            ancestorIdentities.push(
                status.ino === 0n ? `path:${current}` : `inode:${status.dev}:${status.ino}`,
            );
            /* node:coverage enable */
            if (current === workspaceRoot) {
                break;
            }
            const parent = path.dirname(current);
            /* node:coverage disable */
            if (parent === current) {
                throw bindingError("authorityEscape");
            }
            /* node:coverage enable */
            current = parent;
        }
        return { ancestorIdentities, path: canonicalRoot };
        /* node:coverage disable */
    } catch (error) {
        if (error instanceof WorkspaceBindingError) {
            throw error;
        }
        throw bindingError("invalidRoot");
    }
    /* node:coverage enable */
}

function rootsOverlap(left: string, right: string): boolean {
    return containsRoot(left, right) || containsRoot(right, left);
}

function containsRoot(parent: string, candidate: string): boolean {
    const relative = path.relative(parent, candidate);
    return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

function identityRootsOverlap(left: readonly string[], right: readonly string[]): boolean {
    const leftRoot = left[0];
    const rightRoot = right[0];
    return (
        (leftRoot !== undefined && right.includes(leftRoot)) ||
        (rightRoot !== undefined && left.includes(rightRoot))
    );
}

function readRepositoryEvidence(root: string): GitRepositoryBinding["repository"] {
    try {
        const observed = inspectGitRepository(
            root,
            (args) => runGit(root, args),
            gitBindingFilesystemIdentity,
        );
        if (
            observed.bare ||
            observed.top !== root ||
            observed.gitDir !== observed.commonDir ||
            !containsRoot(root, observed.gitDir) ||
            !containsRoot(root, observed.commonDir)
        ) {
            throw repositoryBindingError("invalidRepository");
        }
        // Supported object formats are a configured Git-build capability.
        /* node:coverage disable */
        if (!workspaceProtocolConfig.gitCustody.objectFormats.includes(observed.objectFormat)) {
            throw repositoryBindingError("invalidRepository");
        }
        /* node:coverage enable */
        return Object.freeze({
            common_dir: observed.commonDir,
            common_dir_identity: observed.commonDirIdentity,
            git_dir: observed.gitDir,
            git_dir_identity: observed.gitDirIdentity,
            object_format: observed.objectFormat,
            repository_id: `${workspaceProtocolConfig.gitCustody.repositoryIdPrefix}${createRecordId(
                {
                    common_directory_identity: observed.commonDirIdentity,
                    kind: workspaceProtocolConfig.repositoryBindings.identityKind,
                    object_format: observed.objectFormat,
                    version: workspaceProtocolConfig.repositoryBindings.version,
                },
            )}`,
            root,
        });
        // Non-contract failures here require a filesystem race after successful Git inspection.
        /* node:coverage disable */
    } catch (error) {
        if (error instanceof WorkspaceBindingError) throw error;
        throw repositoryBindingError("invalidRepository");
    }
    /* node:coverage enable */
}

function runGit(root: string, args: readonly string[]): string {
    const result = spawnSync(workspaceProtocolConfig.gitExecutable, ["-C", root, ...args], {
        encoding: "utf8",
        maxBuffer: workspaceProtocolConfig.gitCustody.maxCommandBytes,
        stdio: ["ignore", "pipe", "pipe"],
    });
    // Config validation and platform conformance own executable availability.
    /* node:coverage disable */
    if (result.error !== undefined) throw repositoryBindingError("invalidRepository");
    /* node:coverage enable */
    if (result.status !== 0) {
        throw repositoryBindingError("invalidRepository");
    }
    // Every configured inspection command has required scalar output on success.
    /* node:coverage disable */
    if (result.stdout.trim().length === 0) throw repositoryBindingError("invalidRepository");
    /* node:coverage enable */
    return result.stdout.trim();
}

function repositoryBindingError(kind: "invalidRepository"): WorkspaceBindingError {
    const errors = workspaceProtocolConfig.repositoryBindings.errors;
    return new WorkspaceBindingError(errors[`${kind}Code`], errors[`${kind}Message`]);
}

function bindingError(
    kind: "authorityEscape" | "duplicateName" | "invalidName" | "invalidRoot" | "rootOverlap",
    detail?: string,
): WorkspaceBindingError {
    const errors = workspaceProtocolConfig.bindingErrors;
    const message = errors[`${kind}Message`];
    return new WorkspaceBindingError(
        errors[`${kind}Code`],
        detail === undefined ? message : `${message}: ${detail}`,
    );
}
