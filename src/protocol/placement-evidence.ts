import { createRecordId, type SemanticRecord } from "../canonical/canonical-record.ts";
import { createCanonicalSnapshot } from "../canonical/snapshot.ts";
import { recordIdConfig, taskProtocolConfig, workspaceProtocolConfig } from "./config.ts";

/** Decodes and rehashes exact persisted placement-platform evidence. @internal */
export function readPlacementPlatformEvidence(value: unknown): SemanticRecord {
    const fields = readExactObject(
        value,
        [
            "compatibility_version",
            "environment",
            "family",
            "node_platform",
            "os_release",
            "platform_id",
            "platform_version",
            "wsl_markers",
        ],
        "placement platform evidence",
    );
    const policy = workspaceProtocolConfig.placements;
    if (
        fields.compatibility_version !== policy.compatibilityVersion ||
        fields.platform_version !== policy.platform.version
    ) {
        throw new TypeError("placement platform protocol evidence is inconsistent");
    }
    const nodePlatform = readText(fields.node_platform, "placement Node platform");
    const osRelease = readText(fields.os_release, "placement OS release");
    const markers = readMarkers(fields.wsl_markers);
    const classified = classify(nodePlatform, osRelease, markers);
    if (fields.family !== classified.family || fields.environment !== classified.environment) {
        throw new TypeError("placement platform classification is inconsistent");
    }
    const semantic = createCanonicalSnapshot({
        compatibility_version: policy.compatibilityVersion,
        environment: classified.environment,
        family: classified.family,
        node_platform: nodePlatform,
        os_release: osRelease,
        platform_version: policy.platform.version,
        wsl_markers: markers,
    });
    const digest = createRecordId({ placement_platform: semantic });
    const platformId = prefixedIdentity(policy.platform.evidenceIdPrefix, digest);
    if (fields.platform_id !== platformId) {
        throw new TypeError("placement platform identity is inconsistent");
    }
    return createCanonicalSnapshot({ ...semantic, platform_id: platformId });
}

/** Decodes and rehashes one exact persisted granted placement resolution. @internal */
export function readGrantedPlacementResolutionEvidence(value: unknown): SemanticRecord {
    const fields = readExactObject(
        value,
        [
            "capture_id",
            "compatibility_version",
            "enforcement",
            "placement_version",
            "platform",
            "reason",
            "repository_grant_plan_id",
            "requested_placement",
            "resolution_id",
            "resolved_placement",
            "run_id",
            "runner_id",
            "status",
            "task_artifact_digest",
        ],
        "granted placement resolution evidence",
    );
    const policy = workspaceProtocolConfig.placements;
    if (
        fields.compatibility_version !== policy.compatibilityVersion ||
        fields.placement_version !== policy.artifactVersion ||
        fields.enforcement !== policy.enforcement
    ) {
        throw new TypeError("placement resolution protocol evidence is inconsistent");
    }
    const request = readConfiguredText(
        fields.requested_placement,
        policy.requests,
        "requested placement",
    );
    const rule = policy.rules.find(({ request: configured }) => configured === request);
    if (
        rule === undefined ||
        !rule.supported ||
        rule.resolved === null ||
        fields.reason !== rule.reason ||
        fields.status !== rule.status ||
        fields.resolved_placement !== rule.resolved
    ) {
        throw new TypeError("placement resolution rule evidence is inconsistent");
    }
    const captureId = readBoundedText(fields.capture_id, "placement capture identity");
    const runId = readBoundedText(fields.run_id, "placement run identity");
    const runnerId = readText(fields.runner_id, "placement runner identity");
    assertDigest(
        fields.repository_grant_plan_id,
        workspaceProtocolConfig.repositoryGrants.planIdPrefix,
        recordIdConfig.hexLength,
        "repository grant plan",
    );
    assertDigest(
        fields.task_artifact_digest,
        taskProtocolConfig.digestPrefix,
        taskProtocolConfig.hexLength,
        "task artifact",
    );
    const platform = readPlacementPlatformEvidence(fields.platform);
    const semantic = createCanonicalSnapshot({
        capture_id: captureId,
        compatibility_version: policy.compatibilityVersion,
        enforcement: policy.enforcement,
        placement_version: policy.artifactVersion,
        platform,
        reason: rule.reason,
        repository_grant_plan_id: fields.repository_grant_plan_id as string,
        requested_placement: request,
        resolved_placement: rule.resolved,
        run_id: runId,
        runner_id: runnerId,
        status: rule.status,
        task_artifact_digest: fields.task_artifact_digest as string,
    });
    const digest = createRecordId({ placement_resolution: semantic });
    const resolutionId = prefixedIdentity(policy.resolutionIdPrefix, digest);
    if (fields.resolution_id !== resolutionId) {
        throw new TypeError("placement resolution identity is inconsistent");
    }
    return createCanonicalSnapshot({ ...semantic, resolution_id: resolutionId });
}

function classify(
    nodePlatform: string,
    osRelease: string,
    markers: readonly string[],
): { readonly environment: string; readonly family: string } {
    const policy = workspaceProtocolConfig.placements.platform;
    const isWsl =
        nodePlatform === policy.wslNodePlatform &&
        (markers.length > 0 ||
            osRelease.toLowerCase().includes(policy.wslReleasePattern.toLowerCase()));
    if (isWsl) return { environment: policy.wslEnvironment, family: policy.wslFamily };
    const configured = policy.nodePlatforms.find(({ name }) => name === nodePlatform);
    return configured === undefined
        ? {
              environment: policy.unsupportedEnvironment,
              family: policy.unsupportedFamily,
          }
        : { environment: policy.nativeEnvironment, family: configured.family };
}

function readMarkers(value: unknown): readonly string[] {
    if (!Array.isArray(value)) throw new TypeError("placement WSL markers must be an array");
    const configured = workspaceProtocolConfig.placements.platform.wslEnvironmentVariables;
    const markers = value.map((marker) =>
        readConfiguredText(marker, configured, "placement WSL marker"),
    );
    const expected = configured.filter((marker) => markers.includes(marker));
    if (
        markers.length !== expected.length ||
        markers.some((marker, index) => marker !== expected[index])
    ) {
        throw new TypeError("placement WSL markers are not canonical");
    }
    return Object.freeze(markers);
}

function readConfiguredText(value: unknown, allowed: readonly string[], subject: string): string {
    const text = readText(value, subject);
    if (!allowed.includes(text)) throw new TypeError(`${subject} is unsupported`);
    return text;
}

function readBoundedText(value: unknown, subject: string): string {
    const text = readText(value, subject);
    if (Buffer.byteLength(text) > workspaceProtocolConfig.worldTaskCapture.maxCaptureIdBytes) {
        throw new TypeError(`${subject} is invalid`);
    }
    return text;
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

function assertDigest(
    value: unknown,
    prefix: string,
    hexLength: number,
    subject: string,
): asserts value is string {
    if (typeof value !== "string" || !value.startsWith(prefix)) {
        throw new TypeError(`${subject} identity is invalid`);
    }
    const suffix = value.slice(prefix.length);
    if (suffix.length !== hexLength || !/^[0-9a-f]+$/u.test(suffix)) {
        throw new TypeError(`${subject} identity is invalid`);
    }
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
