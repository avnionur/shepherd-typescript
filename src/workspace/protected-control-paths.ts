import { existsSync, lstatSync, realpathSync } from "node:fs";
import path from "node:path";

import { workspaceProtocolConfig } from "../protocol/config.ts";
import { WorldCarrierError } from "./errors.ts";

/** Closed input used to inspect one binding-relative workspace path. */
export type WorkspacePathProtectionOptions = {
    /** Canonical binding root against which {@link path} is interpreted. */
    readonly bindingRoot: string;
    /** Portable binding-relative path using `/` separators. */
    readonly path: string;
    /** Initialized workspace root owning the configured protected roots. */
    readonly workspaceRoot: string;
};

/** Versioned result of configured protected workspace-path validation. */
export type WorkspacePathProtectionValidation = {
    /** Exact candidate path supplied by the caller. */
    readonly path: string;
    /** Whether the candidate or its resolved filesystem alias targets protected metadata. */
    readonly protected: boolean;
    /** Configured protected root matched by the candidate, otherwise `null`. */
    readonly protected_root: string | null;
    /** Configured validation contract version. */
    readonly validation_version: number;
};

/** Raised before a retained-world operation can inspect or mutate a protected control path. */
export class WorkspaceProtectedPathError extends WorldCarrierError {
    /** Versioned validation result describing the rejected path. */
    readonly validation: WorkspacePathProtectionValidation;

    /**
     * Creates a configured protected-path rejection.
     *
     * @param validation - Versioned validation result for the protected candidate.
     */
    constructor(validation: WorkspacePathProtectionValidation) {
        super(
            workspaceProtocolConfig.protectedPaths.errorCode,
            `${workspaceProtocolConfig.protectedPaths.errorMessage}: ${validation.path}`,
        );
        this.name = "WorkspaceProtectedPathError";
        this.validation = validation;
    }
}

/**
 * Inspects one portable binding-relative path against configured protected workspace roots.
 *
 * Comparison applies the configured Unicode normalization, case folding, trailing-character, and
 * alternate-name rules. Existing filesystem prefixes are resolved so symbolic-link aliases fail
 * closed even when the final descendant does not yet exist. This function performs no mutation.
 *
 * @param options - Exact workspace, binding, and candidate path authority.
 * @returns Frozen versioned validation evidence.
 * @throws {TypeError} If the options, roots, or portable candidate path are malformed.
 *
 * @example
 * ```ts
 * const result = inspectWorkspacePathProtection({
 *     bindingRoot: workspace.root_path,
 *     path: "src/index.ts",
 *     workspaceRoot: workspace.root_path,
 * });
 * console.log(result.protected);
 * ```
 */
export function inspectWorkspacePathProtection(
    options: WorkspacePathProtectionOptions,
): WorkspacePathProtectionValidation {
    const fields = exactOptions(options);
    const workspaceRoot = canonicalDirectory(fields.workspaceRoot, "workspace root");
    const bindingRoot = canonicalDirectory(fields.bindingRoot, "binding root");
    if (!containsPath(workspaceRoot, bindingRoot)) {
        throw new TypeError("protected-path binding root escapes workspace authority");
    }
    const segments = portableSegments(fields.path);
    const candidate = path.join(bindingRoot, ...segments);
    const lexicalMatch = matchedProtectedRoot(workspaceRoot, candidate);
    const resolvedMatch =
        lexicalMatch ?? matchedProtectedRoot(workspaceRoot, resolveExistingPrefix(candidate));
    return Object.freeze({
        path: fields.path,
        protected: resolvedMatch !== null,
        protected_root: resolvedMatch,
        validation_version: workspaceProtocolConfig.protectedPaths.version,
    });
}

/**
 * Rejects a configured protected workspace path with stable versioned error evidence.
 *
 * @param options - Exact workspace, binding, and candidate path authority.
 * @returns Completion when the candidate is ordinary managed content.
 * @throws {WorkspaceProtectedPathError} If the candidate targets protected control metadata.
 * @throws {TypeError} If the validation input is malformed.
 * @internal
 */
export function assertWorkspacePathUnprotected(options: WorkspacePathProtectionOptions): void {
    const validation = inspectWorkspacePathProtection(options);
    if (validation.protected) throw new WorkspaceProtectedPathError(validation);
}

function exactOptions(value: unknown): WorkspacePathProtectionOptions {
    if (
        value === null ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    ) {
        throw new TypeError("protected-path options must be exact data");
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    const expected = ["bindingRoot", "path", "workspaceRoot"];
    if (
        keys.some((key) => typeof key !== "string") ||
        keys.length !== expected.length ||
        (keys as string[]).sort().some((key, index) => key !== expected[index]) ||
        expected.some((key) => !("value" in (descriptors[key] as PropertyDescriptor)))
    ) {
        throw new TypeError("protected-path options must be exact data");
    }
    const fields = Object.fromEntries(
        expected.map((key) => [key, (descriptors[key] as PropertyDescriptor).value]),
    );
    if (
        typeof fields.bindingRoot !== "string" ||
        typeof fields.path !== "string" ||
        typeof fields.workspaceRoot !== "string"
    ) {
        throw new TypeError("protected-path options must contain strings");
    }
    return fields as WorkspacePathProtectionOptions;
}

function canonicalDirectory(value: string, context: string): string {
    if (value.length === 0) throw new TypeError(`protected-path ${context} is empty`);
    const canonical = realpathSync(value);
    if (!lstatSync(canonical).isDirectory()) {
        throw new TypeError(`protected-path ${context} must be a directory`);
    }
    return canonical;
}

function portableSegments(value: string): readonly string[] {
    if (
        value.length === 0 ||
        value.includes("\\") ||
        value.includes("\0") ||
        /[\uD800-\uDFFF]/u.test(value)
    ) {
        throw new TypeError("protected-path candidate is not portable");
    }
    const segments = value.split("/");
    if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
        throw new TypeError("protected-path candidate is not canonical");
    }
    return segments;
}

function matchedProtectedRoot(workspaceRoot: string, candidate: string): string | null {
    const relative = path.relative(workspaceRoot, candidate);
    if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`)) {
        return null;
    }
    // A cross-volume Windows junction can yield an absolute relative path. The lexical and
    // symlink cases are exercised portably; cross-volume junction creation is host-dependent.
    /* node:coverage disable */
    if (path.isAbsolute(relative)) return null;
    /* node:coverage enable */
    const normalized = relative.split(path.sep).map(normalizeSegment);
    for (const root of workspaceProtocolConfig.protectedPaths.roots) {
        const protectedSegments = root.split("/").map(normalizeSegment);
        for (let start = 0; start <= normalized.length - protectedSegments.length; start += 1) {
            if (
                protectedSegments.every((segment, index) => normalized[start + index] === segment)
            ) {
                return root;
            }
        }
    }
    return null;
}

function normalizeSegment(value: string): string {
    const config = workspaceProtocolConfig.protectedPaths;
    let normalized = value.normalize(config.normalizationForm);
    const separatorIndexes = config.alternateNameSeparators
        .map((separator) => normalized.indexOf(separator))
        .filter((index) => index >= 0);
    if (separatorIndexes.length > 0)
        normalized = normalized.slice(0, Math.min(...separatorIndexes));
    while (config.trailingCharacters.some((character) => normalized.endsWith(character))) {
        normalized = normalized.slice(0, -1);
    }
    // Workspace protocol v18 compatibility locks caseFold to true; the generic false branch is
    // retained for a future configured protocol revision.
    /* node:coverage ignore next */
    return config.caseFold ? normalized.toLowerCase() : normalized;
}

function resolveExistingPrefix(candidate: string): string {
    let existing = candidate;
    const suffix: string[] = [];
    while (!existsSync(existing)) {
        const parent = path.dirname(existing);
        suffix.unshift(path.basename(existing));
        existing = parent;
    }
    return path.join(realpathSync(existing), ...suffix);
}

function containsPath(parent: string, candidate: string): boolean {
    const relative = path.relative(parent, candidate);
    return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}
