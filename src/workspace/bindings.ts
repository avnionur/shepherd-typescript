import { lstatSync, realpathSync } from "node:fs";
import path from "node:path";

import { createRecordId } from "../canonical/canonical-record.ts";
import { workspaceProtocolConfig } from "../protocol/config.ts";
import { WorkspaceBindingError } from "./errors.ts";
import { openWorkspace, openWorkspaceForRetainedCustody } from "./initialization.ts";
import type {
    WorkspaceBinding,
    WorkspaceBindingDefinition,
    WorkspaceBindingOptions,
    WorkspaceBindingSet,
} from "./types.ts";

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
        bindings.push(
            Object.freeze({
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
            }),
        );
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
