import { spawnSync } from "node:child_process";
import { workspaceProtocolConfig } from "../protocol/config.ts";
import { WorldCarrierError } from "./errors.ts";
import { openWorkspace } from "./initialization.ts";

/** Closed options accepted by {@link inspectWorkspacePlatformConformance}. */
export type WorkspacePlatformConformanceOptions = {
    /** Initialized workspace whose host policy is inspected. */
    readonly workspaceRoot: string;
};

/** Declarative deterministic fault injected at one configured custody boundary. */
export type WorkspaceCustodyFaultInjection = {
    /** Configured fault classification to raise. */
    readonly classification: string;
    /** Configured custody boundary at which to raise the fault. */
    readonly phase: string;
    /** Optional underlying platform error code represented by the fixture. */
    readonly systemCode: string | null;
};

/** Stable public evidence attached to a custody fault. */
export type WorkspaceCustodyFaultEvidence = {
    /** Configured fault classification. */
    readonly classification: string;
    /** Unsupported metadata kind when classification is metadata-specific. */
    readonly metadata_kind: string | null;
    /** Configured custody boundary at which the fault occurred. */
    readonly phase: string;
    /** Required recovery behavior for the failed boundary. */
    readonly recovery: string;
    /** Underlying platform error code when one is available. */
    readonly system_code: string | null;
    /** Public platform-conformance contract version. */
    readonly version: number;
};

/** Raised when a configured custody boundary fails with stable recovery evidence. */
export class WorkspaceCustodyFaultError extends WorldCarrierError {
    /** Frozen precise fault and recovery evidence. */
    readonly evidence: WorkspaceCustodyFaultEvidence;

    /**
     * Creates a configured custody fault.
     *
     * @param code - Stable configured machine-readable fault code.
     * @param message - Stable configured diagnostic.
     * @param evidence - Exact configured phase, classification, and recovery evidence.
     */
    constructor(code: string, message: string, evidence: WorkspaceCustodyFaultEvidence) {
        super(code, message);
        this.name = "WorkspaceCustodyFaultError";
        this.evidence = Object.freeze({ ...evidence });
    }
}

/** Frozen Git-specific platform custody policy. */
export type WorkspaceGitPlatformPolicy = {
    /** Policy for worktree placeholders created with `core.symlinks=false`. */
    readonly core_symlinks_false: string;
    /** Policy for external Gitlink commit citations. */
    readonly gitlinks: string;
    /** Policy for sparse-index evidence. */
    readonly sparse_index: string;
};

/** Frozen configured platform policy for retained workspace custody. */
export type WorkspacePlatformConformance = {
    /** Portable path case-collision policy. */
    readonly case_collision_policy: string;
    /** Git-specific custody policy. */
    readonly git: WorkspaceGitPlatformPolicy;
    /** Unsupported metadata handling policy. */
    readonly metadata_policy: string;
    /** Portable file and directory mode policy. */
    readonly mode_policy: string;
    /** Correctness gate for optimized carrier parity claims. */
    readonly optimized_carrier_parity: string;
    /** Current Node host platform. */
    readonly platform: NodeJS.Platform;
    /** Symbolic-link retention policy. */
    readonly symlink_policy: string;
    /** Filesystem metadata rejected before publication. */
    readonly unsupported_metadata: readonly string[];
    /** Public platform-conformance contract version. */
    readonly version: number;
};

/**
 * Inspects the configured retained-custody policy for the current host without mutating user files.
 *
 * @param options - Exact initialized workspace to validate before returning host policy.
 * @returns Frozen configured platform and parity evidence.
 * @throws {WorkspaceControlError} If the workspace cannot be reopened safely.
 * @throws {TypeError} If options are malformed or the host has no configured policy.
 *
 * @example
 * ```ts
 * const policy = inspectWorkspacePlatformConformance({ workspaceRoot });
 * policy.metadata_policy;
 * ```
 */
export function inspectWorkspacePlatformConformance(
    options: WorkspacePlatformConformanceOptions,
): WorkspacePlatformConformance {
    const workspaceRoot = readOptions(options);
    openWorkspace(workspaceRoot);
    const policy = workspaceProtocolConfig.platformConformance;
    /* node:coverage disable */
    if (!policy.supportedPlatforms.includes(process.platform)) {
        throw new TypeError("workspace host platform has no configured custody policy");
    }
    /* node:coverage enable */
    return Object.freeze({
        case_collision_policy: policy.caseCollisionPolicy,
        git: Object.freeze({
            core_symlinks_false: policy.git.coreSymlinksFalse,
            gitlinks: policy.git.gitlinks,
            sparse_index: policy.git.sparseIndex,
        }),
        metadata_policy: policy.metadataPolicy,
        mode_policy: policy.modePolicy,
        optimized_carrier_parity: policy.optimizedCarrierParity,
        platform: process.platform,
        symlink_policy: policy.symlinkPolicy,
        unsupported_metadata: Object.freeze([...policy.unsupportedMetadata]),
        version: policy.version,
    });
}

/** @internal Validates an optional declarative custody-fault fixture. */
export function readWorkspaceCustodyFaultInjection(
    value: unknown,
): WorkspaceCustodyFaultInjection | null {
    if (value === undefined) return null;
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new TypeError("workspace custody fault injection must be an object");
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const expected = ["classification", "phase", "systemCode"];
    if (
        Object.getPrototypeOf(value) !== Object.prototype ||
        Reflect.ownKeys(descriptors).some((key) => typeof key !== "string") ||
        Object.keys(descriptors)
            .sort()
            .some((key, index) => key !== expected[index]) ||
        Object.values(descriptors).some((descriptor) => !("value" in descriptor))
    ) {
        throw new TypeError("workspace custody fault injection must be exact data");
    }
    const classification = descriptors.classification?.value as unknown;
    const phase = descriptors.phase?.value as unknown;
    const systemCode = descriptors.systemCode?.value as unknown;
    const policy = workspaceProtocolConfig.platformConformance.faults;
    if (
        typeof classification !== "string" ||
        !policy.classifications.some(({ name }) => name === classification) ||
        typeof phase !== "string" ||
        !policy.phases.some(({ name }) => name === phase) ||
        !(systemCode === null || (typeof systemCode === "string" && systemCode.length > 0))
    ) {
        throw new TypeError("workspace custody fault injection is unsupported");
    }
    return Object.freeze({ classification, phase, systemCode });
}

/** @internal Raises an injected fault at an exact configured custody boundary. */
export function injectWorkspaceCustodyFault(
    injection: WorkspaceCustodyFaultInjection | null,
    phase: string,
): void {
    if (injection === null || injection.phase !== phase) return;
    const policy = workspaceProtocolConfig.platformConformance;
    const classification = policy.faults.classifications.find(
        ({ name }) => name === injection.classification,
    );
    const boundary = policy.faults.phases.find(({ name }) => name === phase);
    if (classification === undefined || boundary === undefined) {
        throw new TypeError("workspace custody fault contract is unavailable");
    }
    throw new WorkspaceCustodyFaultError(classification.code, classification.message, {
        classification: classification.name,
        metadata_kind: null,
        phase: boundary.name,
        recovery: boundary.recovery,
        system_code: injection.systemCode,
        version: policy.version,
    });
}

/** @internal Rejects unsupported host metadata before custody publication. */
export function assertWorkspaceMetadataSupported(
    files: readonly string[],
    phase: string,
    symbolicLinks = false,
): void {
    if (files.length === 0) return;
    const policy = workspaceProtocolConfig.platformConformance;
    const probes = policy.metadataProbes.filter(({ platform }) => platform === process.platform);
    /* node:coverage disable */
    if (probes.length === 0) {
        throwConfiguredFault(policy.faults.platformClassification, phase, null, null);
    }
    /* node:coverage enable */
    for (const probe of probes) {
        const arguments_ = symbolicLinks ? probe.symlinkArguments : probe.arguments;
        const groups = metadataProbePathGroups(files, probe.separateLineBreakPaths);
        for (const group of groups) {
            const args = arguments_.flatMap((argument) =>
                argument === policy.metadataPathToken ? group : [argument],
            );
            const result = spawnSync(probe.executable, args, {
                encoding: "utf8",
                maxBuffer: policy.metadataProbeMaxBytes,
                stdio: ["ignore", "pipe", "pipe"],
            });
            if (result.error !== undefined || result.status !== 0) {
                /* node:coverage disable */
                const systemCode =
                    result.error !== undefined && "code" in result.error
                        ? String(result.error.code)
                        : result.status === null
                          ? null
                          : String(result.status);
                /* node:coverage enable */
                throwConfiguredFault(
                    policy.faults.platformClassification,
                    phase,
                    probe.kind,
                    systemCode,
                );
            }
            if (new RegExp(probe.matchPattern, probe.patternFlags).test(result.stdout)) {
                throwConfiguredFault(policy.faults.metadataClassification, phase, probe.kind, null);
            }
        }
    }
}

function metadataProbePathGroups(
    files: readonly string[],
    separateLineBreakPaths: boolean,
): readonly (readonly string[])[] {
    /* node:coverage disable */
    if (!separateLineBreakPaths) return [files];
    /* node:coverage enable */
    const safe: string[] = [];
    const separate: string[][] = [];
    for (const file of files) {
        if (file.includes("\n") || file.includes("\r")) separate.push([file]);
        else safe.push(file);
    }
    /* node:coverage disable */
    return safe.length === 0 ? separate : [safe, ...separate];
    /* node:coverage enable */
}

/** @internal Rejects host-dependent name collisions before custody publication. */
export function assertWorkspaceNamesPortable(names: readonly string[], phase: string): void {
    const comparison = workspaceProtocolConfig.protectedPaths;
    const keys = names.map((name) => {
        let key = name.normalize(comparison.normalizationForm);
        if (comparison.caseFold) key = key.toLocaleLowerCase("und");
        let separator = Number.POSITIVE_INFINITY;
        for (const candidate of comparison.alternateNameSeparators) {
            const index = key.indexOf(candidate);
            if (index >= 0 && index < separator) separator = index;
        }
        if (Number.isFinite(separator)) key = key.slice(0, separator);
        while (
            key.length > 0 &&
            comparison.trailingCharacters.some((character) => key.endsWith(character))
        ) {
            key = key.slice(0, -1);
        }
        return key;
    });
    if (new Set(keys).size !== keys.length) {
        throwConfiguredFault(
            workspaceProtocolConfig.platformConformance.faults.platformClassification,
            phase,
            null,
            null,
        );
    }
}

/** @internal Raises the configured fail-closed platform-unsupported custody fault. */
export function raiseWorkspaceCustodyPlatformFault(
    phase: string,
    systemCode: string | null = null,
): never {
    throwConfiguredFault(
        workspaceProtocolConfig.platformConformance.faults.platformClassification,
        phase,
        null,
        systemCode,
    );
}

function throwConfiguredFault(
    classificationName: string,
    phase: string,
    metadataKind: string | null,
    systemCode: string | null,
): never {
    const policy = workspaceProtocolConfig.platformConformance;
    const classification = policy.faults.classifications.find(
        ({ name }) => name === classificationName,
    );
    const boundary = policy.faults.phases.find(({ name }) => name === phase);
    if (classification === undefined || boundary === undefined) {
        throw new TypeError("workspace custody platform contract is unavailable");
    }
    throw new WorkspaceCustodyFaultError(classification.code, classification.message, {
        classification: classification.name,
        metadata_kind: metadataKind,
        phase: boundary.name,
        recovery: boundary.recovery,
        system_code: systemCode,
        version: policy.version,
    });
}

function readOptions(value: unknown): string {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new TypeError("workspace platform inspection options must be an object");
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (
        Object.getPrototypeOf(value) !== Object.prototype ||
        Reflect.ownKeys(descriptors).length !== 1 ||
        !("workspaceRoot" in descriptors) ||
        !("value" in descriptors.workspaceRoot)
    ) {
        throw new TypeError("workspace platform inspection options must be exact data");
    }
    const workspaceRoot = descriptors.workspaceRoot.value as unknown;
    if (typeof workspaceRoot !== "string" || workspaceRoot.length === 0) {
        throw new TypeError("workspace platform inspection workspaceRoot must be non-empty");
    }
    return workspaceRoot;
}
