import { release } from "node:os";
import { createRecordId } from "../canonical/canonical-record.ts";
import { createCanonicalSnapshot } from "../canonical/snapshot.ts";
import { publicErrorCodes } from "../errors/public-errors.ts";
import { workspaceProtocolConfig } from "../protocol/config.ts";
import {
    readGrantedPlacementResolutionEvidence,
    readPlacementPlatformEvidence,
} from "../protocol/placement-evidence.ts";
import type { TaskSchema } from "../task/schema.ts";
import type {
    GrantedPlacementResolution,
    GrantedPlacementResolutionOptions,
    PlacementEnvironment,
    PlacementPlatformEvidence,
    PlacementPlatformEvidenceOptions,
    PlacementPlatformFamily,
    PlacementRefusalEvidence,
    PlacementRequest,
} from "./placement-types.ts";
import { assertGitRepositoryGrantPlanHandle } from "./repository-grants.ts";
import { assertRetainedWorldRunner } from "./retained-world-runner.ts";

const AUTHENTICATED_PLATFORM_EVIDENCE = new WeakSet<object>();
const LOCAL_PLATFORM_EVIDENCE = new WeakSet<object>();
const AUTHENTICATED_PLACEMENT_RESOLUTIONS = new WeakMap<
    object,
    {
        readonly captureId: string;
        readonly repositoryGrantPlan: GrantedPlacementResolutionOptions<
            TaskSchema<unknown>,
            TaskSchema<unknown>
        >["repositoryGrantPlan"];
        readonly runId: string;
        readonly platform: PlacementPlatformEvidence;
        readonly runner: GrantedPlacementResolutionOptions<
            TaskSchema<unknown>,
            TaskSchema<unknown>
        >["runner"];
    }
>();

/** Raised when an explicit placement request cannot resolve without weakening enforcement. */
export class PlacementUnavailableError extends TypeError {
    /** Stable configured machine-readable unavailable-placement code. */
    readonly code = publicErrorCodes.workspace.placementUnavailable;
    /** Frozen configured refusal status and reason. */
    readonly evidence: PlacementRefusalEvidence;

    /**
     * Creates one fail-closed placement refusal.
     *
     * @param evidence - Exact configured request, status, reason, and protocol version.
     */
    constructor(evidence: PlacementRefusalEvidence) {
        super(`requested placement is unavailable: ${evidence.reason}`);
        this.name = "PlacementUnavailableError";
        this.evidence = Object.freeze({ ...evidence });
    }
}

/**
 * Classifies one explicit declared environment probe as immutable placement platform evidence.
 *
 * The probe retains environment-variable names only, never their values. Input injection makes
 * native macOS, Linux, Windows, WSL, and unsupported classification deterministic in conformance
 * tests and suitable for future authenticated remote placement adapters. Local placed execution
 * accepts only evidence returned by {@link inspectLocalPlacementPlatformEvidence}.
 *
 * @param options - Exact Node platform, OS release, and present environment-variable names.
 * @returns Frozen content-addressed platform evidence.
 * @throws {TypeError} If options or probe values are malformed or ambiguous.
 *
 * @example
 * ```ts
 * const platform = createPlacementPlatformEvidence({
 *     nodePlatform: process.platform,
 *     osRelease: release(),
 *     environmentVariables: Object.keys(process.env),
 * });
 * ```
 *
 * @public
 */
export function createPlacementPlatformEvidence(
    options: PlacementPlatformEvidenceOptions,
): PlacementPlatformEvidence {
    const fields = readOptions(options);
    const policy = workspaceProtocolConfig.placements.platform;
    const markers = Object.freeze(
        policy.wslEnvironmentVariables.filter((name) => fields.environmentVariables.includes(name)),
    );
    const isWsl =
        fields.nodePlatform === policy.wslNodePlatform &&
        (markers.length > 0 ||
            fields.osRelease.toLowerCase().includes(policy.wslReleasePattern.toLowerCase()));
    const configured = policy.nodePlatforms.find(({ name }) => name === fields.nodePlatform);
    const family = (
        isWsl ? policy.wslFamily : (configured?.family ?? policy.unsupportedFamily)
    ) as PlacementPlatformFamily;
    const environment = (
        isWsl
            ? policy.wslEnvironment
            : configured === undefined
              ? policy.unsupportedEnvironment
              : policy.nativeEnvironment
    ) as PlacementEnvironment;
    const semantic = createCanonicalSnapshot({
        compatibility_version: workspaceProtocolConfig.placements.compatibilityVersion,
        environment,
        family,
        node_platform: fields.nodePlatform,
        os_release: fields.osRelease,
        platform_version: policy.version,
        wsl_markers: markers,
    });
    const digest = createRecordId({ placement_platform: semantic });
    const evidence = Object.freeze({
        ...semantic,
        platform_id: prefixedIdentity(policy.evidenceIdPrefix, digest),
    }) as PlacementPlatformEvidence;
    readPlacementPlatformEvidence(evidence);
    AUTHENTICATED_PLATFORM_EVIDENCE.add(evidence);
    return evidence;
}

/**
 * Inspects the current Node host and returns authenticated placement platform evidence.
 *
 * Environment-variable values are never read or retained; only configured WSL marker names may
 * appear in the resulting evidence.
 *
 * @returns Frozen content-addressed classification of the current execution host.
 *
 * @public
 */
export function inspectLocalPlacementPlatformEvidence(): PlacementPlatformEvidence {
    const evidence = createPlacementPlatformEvidence({
        environmentVariables: Object.keys(process.env),
        nodePlatform: process.platform,
        osRelease: release(),
    });
    LOCAL_PLATFORM_EVIDENCE.add(evidence);
    return evidence;
}

/** Rejects structurally forged platform evidence. @internal */
export function assertPlacementPlatformEvidence(value: PlacementPlatformEvidence): void {
    if (!AUTHENTICATED_PLATFORM_EVIDENCE.has(value)) {
        throw new TypeError("placement platform evidence must be created by this package instance");
    }
}

/** Rejects platform evidence that was not produced by current-host inspection. @internal */
export function assertLocalPlacementPlatformEvidence(value: PlacementPlatformEvidence): void {
    assertPlacementPlatformEvidence(value);
    if (!LOCAL_PLATFORM_EVIDENCE.has(value)) {
        throw new TypeError("placement platform evidence must describe the inspected local host");
    }
}

/**
 * Resolves one explicit placement request for an exact granted run and capture.
 *
 * The current protocol can resolve only to advisory in-process execution. `auto` records its
 * fallback visibly, while explicit `jail` fails closed without returning resolution evidence.
 *
 * @param options - Exact request, platform, grant plan, runner, run, and capture contract.
 * @returns Frozen content-addressed placement resolution.
 * @throws {TypeError} If options or authenticated authorities are malformed or mismatched.
 * @throws {PlacementUnavailableError} If the configured request cannot resolve without weakening
 * enforcement.
 *
 * @example
 * ```ts
 * const placement = createGrantedPlacementResolution({
 *     captureId: "capture:review:1",
 *     placement: "auto",
 *     platform,
 *     repositoryGrantPlan,
 *     runId: "run:review:1",
 *     runner,
 * });
 * ```
 *
 * @public
 */
export function createGrantedPlacementResolution<
    I extends TaskSchema<unknown>,
    O extends TaskSchema<unknown>,
>(options: GrantedPlacementResolutionOptions<I, O>): GrantedPlacementResolution {
    const fields = readExactObject(
        options,
        ["captureId", "placement", "platform", "repositoryGrantPlan", "runId", "runner"],
        "granted placement resolution options",
    );
    const platform = fields.platform as PlacementPlatformEvidence;
    const repositoryGrantPlan = fields.repositoryGrantPlan as GrantedPlacementResolutionOptions<
        I,
        O
    >["repositoryGrantPlan"];
    const runner = fields.runner as GrantedPlacementResolutionOptions<I, O>["runner"];
    assertPlacementPlatformEvidence(platform);
    assertGitRepositoryGrantPlanHandle(repositoryGrantPlan);
    assertRetainedWorldRunner(runner);
    const captureId = readBoundedText(
        fields.captureId,
        "placement capture identity",
        workspaceProtocolConfig.worldTaskCapture.maxCaptureIdBytes,
    );
    const runId = readBoundedText(
        fields.runId,
        "placement run identity",
        workspaceProtocolConfig.worldTaskCapture.maxCaptureIdBytes,
    );
    const request = readPlacementRequest(fields.placement);
    const rule = workspaceProtocolConfig.placements.rules.find(
        ({ request: configured }) => configured === request,
    );
    if (rule === undefined || !rule.supported || rule.resolved === null) {
        if (rule === undefined) {
            throw new TypeError("placement request has no configured resolution rule");
        }
        throw new PlacementUnavailableError({
            placement_version: workspaceProtocolConfig.placements.artifactVersion,
            reason: rule.reason as PlacementRefusalEvidence["reason"],
            requested_placement: request,
            status: rule.status as PlacementRefusalEvidence["status"],
        });
    }
    // Authenticated grant plans and runners are constructed from the same compatibility-locked
    // enforcement vocabulary; this remains a fail-closed guard for future multi-backend versions.
    /* node:coverage ignore next 7 */
    if (
        runner.enforcement !== workspaceProtocolConfig.placements.enforcement ||
        repositoryGrantPlan.enforcement !== workspaceProtocolConfig.placements.enforcement
    ) {
        throw new TypeError("placement enforcement differs from admitted runtime authority");
    }
    const semantic = createCanonicalSnapshot({
        capture_id: captureId,
        compatibility_version: workspaceProtocolConfig.placements.compatibilityVersion,
        enforcement: workspaceProtocolConfig.placements.enforcement,
        placement_version: workspaceProtocolConfig.placements.artifactVersion,
        platform,
        reason: rule.reason,
        repository_grant_plan_id: repositoryGrantPlan.plan_id,
        requested_placement: request,
        resolved_placement: rule.resolved,
        run_id: runId,
        runner_id: runner.runner_id,
        status: rule.status,
        task_artifact_digest: repositoryGrantPlan.task_artifact_digest,
    });
    const digest = createRecordId({ placement_resolution: semantic });
    const resolution = Object.freeze({
        ...semantic,
        resolution_id: prefixedIdentity(
            workspaceProtocolConfig.placements.resolutionIdPrefix,
            digest,
        ),
    }) as GrantedPlacementResolution;
    readGrantedPlacementResolutionEvidence(resolution);
    AUTHENTICATED_PLACEMENT_RESOLUTIONS.set(resolution, {
        captureId,
        repositoryGrantPlan,
        runId,
        platform,
        runner: runner as GrantedPlacementResolutionOptions<
            TaskSchema<unknown>,
            TaskSchema<unknown>
        >["runner"],
    });
    return resolution;
}

/** Authenticates one resolution against its exact run admission contract. @internal */
export function assertGrantedPlacementResolutionContract<
    I extends TaskSchema<unknown>,
    O extends TaskSchema<unknown>,
>(
    resolution: GrantedPlacementResolution,
    options: {
        readonly captureId: string;
        readonly repositoryGrantPlan: GrantedPlacementResolutionOptions<
            I,
            O
        >["repositoryGrantPlan"];
        readonly runId: string;
        readonly runner: GrantedPlacementResolutionOptions<I, O>["runner"];
    },
): void {
    const stored = AUTHENTICATED_PLACEMENT_RESOLUTIONS.get(resolution);
    if (
        stored === undefined ||
        stored.captureId !== options.captureId ||
        stored.repositoryGrantPlan !== options.repositoryGrantPlan ||
        stored.runId !== options.runId ||
        stored.runner !== options.runner ||
        !LOCAL_PLATFORM_EVIDENCE.has(stored.platform)
    ) {
        throw new TypeError("placement resolution differs from local run admission authority");
    }
}

function readOptions(value: unknown): {
    readonly environmentVariables: readonly string[];
    readonly nodePlatform: string;
    readonly osRelease: string;
} {
    const fields = readExactObject(
        value,
        ["environmentVariables", "nodePlatform", "osRelease"],
        "placement platform evidence options",
    );
    const nodePlatform = readText(fields.nodePlatform, "placement Node platform");
    const osRelease = readText(fields.osRelease, "placement OS release");
    if (!Array.isArray(fields.environmentVariables)) {
        throw new TypeError("placement environment variables must be an array");
    }
    const environmentVariables = fields.environmentVariables.map((name) =>
        readText(name, "placement environment variable name"),
    );
    environmentVariables.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
    if (environmentVariables.some((name, index) => name === environmentVariables[index - 1])) {
        throw new TypeError("placement environment variable names must be unique");
    }
    return Object.freeze({
        environmentVariables: Object.freeze(environmentVariables),
        nodePlatform,
        osRelease,
    });
}

function readText(value: unknown, subject: string): string {
    if (
        typeof value !== "string" ||
        value.length === 0 ||
        value.includes("\0") ||
        /[\uD800-\uDFFF]/u.test(value)
    ) {
        throw new TypeError(`${subject} is invalid`);
    }
    return value;
}

function readBoundedText(value: unknown, subject: string, maxBytes: number): string {
    const text = readText(value, subject);
    if (Buffer.byteLength(text) > maxBytes) {
        throw new TypeError(`${subject} is invalid`);
    }
    return text;
}

function readPlacementRequest(value: unknown): PlacementRequest {
    if (typeof value !== "string" || !workspaceProtocolConfig.placements.requests.includes(value)) {
        throw new TypeError("placement request is unsupported");
    }
    return value as PlacementRequest;
}

function readExactObject(
    value: unknown,
    expected: readonly string[],
    subject: string,
): Record<string, unknown> {
    if (
        value === null ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    ) {
        throw new TypeError(`${subject} must be exact data`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors).sort();
    if (
        keys.length !== expected.length ||
        keys.some((key, index) => key !== expected[index]) ||
        expected.some((key) => !("value" in (descriptors[key] as PropertyDescriptor)))
    ) {
        throw new TypeError(`${subject} must be exact data`);
    }
    return Object.fromEntries(
        expected.map((key) => [key, (descriptors[key] as PropertyDescriptor).value]),
    );
}

function prefixedIdentity(prefix: string, digest: string): string {
    return `${prefix}${digest.slice(digest.lastIndexOf(":") + 1)}`;
}
