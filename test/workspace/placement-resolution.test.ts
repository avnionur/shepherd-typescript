import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
    createGitRepositoryBindings,
    createGitRepositoryGrantPlan,
    createGrantedPlacementResolution,
    createPlacementPlatformEvidence,
    createRetainedWorldRunner,
    grantTaskRepositories,
    initializeWorkspace,
    inspectLocalPlacementPlatformEvidence,
    PlacementUnavailableError,
    schema,
    task,
} from "../../src/index.ts";
import {
    readGrantedPlacementResolutionEvidence,
    readPlacementPlatformEvidence,
} from "../../src/protocol/placement-evidence.ts";

const placementFixtureDocument = JSON.parse(
    readFileSync(new URL("../fixtures/placement-resolution-v1.json", import.meta.url), "utf8"),
) as Readonly<Record<string, unknown>>;

test("placement platform evidence classifies macOS, Linux, native Windows, and WSL", () => {
    const macos = createPlacementPlatformEvidence({
        environmentVariables: [],
        nodePlatform: "darwin",
        osRelease: "23.6.0",
    });
    const linux = createPlacementPlatformEvidence({
        environmentVariables: [],
        nodePlatform: "linux",
        osRelease: "6.8.0-generic",
    });
    const windows = createPlacementPlatformEvidence({
        environmentVariables: [],
        nodePlatform: "win32",
        osRelease: "10.0.26100",
    });
    const wsl = createPlacementPlatformEvidence({
        environmentVariables: ["WSL_INTEROP", "WSL_DISTRO_NAME"],
        nodePlatform: "linux",
        osRelease: "5.15.153.1-microsoft-standard-WSL2",
    });

    assert.deepEqual(
        [macos, linux, windows, wsl].map(({ environment, family, node_platform }) => ({
            environment,
            family,
            node_platform,
        })),
        [
            { environment: "native", family: "macos", node_platform: "darwin" },
            { environment: "native", family: "linux", node_platform: "linux" },
            { environment: "native", family: "windows", node_platform: "win32" },
            { environment: "wsl", family: "windows", node_platform: "linux" },
        ],
    );
    assert.deepEqual(wsl.wsl_markers, ["WSL_DISTRO_NAME", "WSL_INTEROP"]);
    assert.equal(Object.isFrozen(wsl), true);
    assert.equal(Object.isFrozen(wsl.wsl_markers), true);
});

test("local placement inspection reports the actual Node host without environment values", () => {
    const local = inspectLocalPlacementPlatformEvidence();

    assert.equal(local.node_platform, process.platform);
    assert.ok(local.os_release.length > 0);
    assert.equal(
        local.wsl_markers.every((marker) => ["WSL_DISTRO_NAME", "WSL_INTEROP"].includes(marker)),
        true,
    );
});

test("placement platform identity is canonical and unsupported hosts remain explicit", () => {
    const left = createPlacementPlatformEvidence({
        environmentVariables: ["WSL_INTEROP", "WSL_DISTRO_NAME"],
        nodePlatform: "linux",
        osRelease: "microsoft-wsl2",
    });
    const reordered = createPlacementPlatformEvidence({
        environmentVariables: ["WSL_DISTRO_NAME", "WSL_INTEROP"],
        nodePlatform: "linux",
        osRelease: "microsoft-wsl2",
    });
    const unsupported = createPlacementPlatformEvidence({
        environmentVariables: [],
        nodePlatform: "freebsd",
        osRelease: "14.1",
    });

    assert.deepEqual(left, reordered);
    assert.deepEqual(left, placementFixtureDocument.platform);
    assert.equal(unsupported.family, "unsupported");
    assert.equal(unsupported.environment, "unsupported");
    assert.notEqual(left.platform_id, unsupported.platform_id);
});

test("persisted placement evidence is closed, classified, and content-addressed", () => {
    const platform = placementFixtureDocument.platform as Record<string, unknown>;
    const resolution = placementFixtureDocument.resolution as Record<string, unknown>;

    assert.deepEqual(readPlacementPlatformEvidence(platform), platform);
    assert.deepEqual(readGrantedPlacementResolutionEvidence(resolution), resolution);
    for (const value of [
        null,
        [],
        { ...platform, extra: true },
        { ...platform, compatibility_version: "other" },
        { ...platform, platform_version: 2 },
        { ...platform, family: "linux" },
        { ...platform, environment: "native" },
        { ...platform, wsl_markers: {} },
        { ...platform, wsl_markers: ["UNKNOWN"] },
        { ...platform, wsl_markers: ["WSL_INTEROP", "WSL_DISTRO_NAME"] },
        { ...platform, platform_id: "invalid" },
    ]) {
        assert.throws(() => readPlacementPlatformEvidence(value), TypeError);
    }
    for (const value of [
        null,
        [],
        { ...resolution, extra: true },
        { ...resolution, compatibility_version: "other" },
        { ...resolution, placement_version: 2 },
        { ...resolution, enforcement: "jailed" },
        { ...resolution, requested_placement: "jail" },
        { ...resolution, reason: "requested-advisory" },
        { ...resolution, resolved_placement: "jail" },
        { ...resolution, status: "refused" },
        { ...resolution, capture_id: "" },
        { ...resolution, capture_id: "x".repeat(257) },
        { ...resolution, run_id: "\uD800" },
        { ...resolution, run_id: "x".repeat(257) },
        { ...resolution, runner_id: "" },
        { ...resolution, repository_grant_plan_id: "invalid" },
        {
            ...resolution,
            repository_grant_plan_id: "repository-grant-plan:sha256:0",
        },
        {
            ...resolution,
            repository_grant_plan_id: `repository-grant-plan:sha256:${"g".repeat(64)}`,
        },
        { ...resolution, task_artifact_digest: "invalid" },
        { ...resolution, platform: { ...platform, platform_id: "invalid" } },
        { ...resolution, resolution_id: "invalid" },
    ]) {
        assert.throws(() => readGrantedPlacementResolutionEvidence(value), TypeError);
    }
});

test("placement platform evidence rejects malformed and ambiguous probes", () => {
    const valid = {
        environmentVariables: [] as readonly string[],
        nodePlatform: "linux",
        osRelease: "6.8.0",
    };
    for (const options of [
        null,
        1,
        [],
        new Date(),
        {},
        { ...valid, extra: true },
        { ...valid, nodePlatform: "" },
        { ...valid, nodePlatform: "\uD800" },
        { ...valid, osRelease: "" },
        { ...valid, osRelease: "\0" },
        { ...valid, environmentVariables: {} },
        { ...valid, environmentVariables: ["WSL_INTEROP", "WSL_INTEROP"] },
        { ...valid, environmentVariables: [""] },
        { ...valid, environmentVariables: [1] },
        Object.defineProperty({ ...valid }, "nodePlatform", { get: () => "linux" }),
        { ...valid, [Symbol("invalid")]: true },
    ]) {
        assert.throws(() => createPlacementPlatformEvidence(options as never), TypeError);
    }
});

test("placement resolution records advisory requests and visible auto fallback", async (context) => {
    const fixture = await placementFixture(context);
    const advisory = createGrantedPlacementResolution({
        captureId: "capture:placement:advisory",
        placement: "advisory",
        platform: fixture.platform,
        repositoryGrantPlan: fixture.plan,
        runId: "run:placement:advisory",
        runner: fixture.runner,
    });
    const auto = createGrantedPlacementResolution({
        captureId: "capture:placement:auto",
        placement: "auto",
        platform: fixture.platform,
        repositoryGrantPlan: fixture.plan,
        runId: "run:placement:auto",
        runner: fixture.runner,
    });

    assert.deepEqual(
        {
            enforcement: advisory.enforcement,
            reason: advisory.reason,
            requested: advisory.requested_placement,
            resolved: advisory.resolved_placement,
            status: advisory.status,
        },
        {
            enforcement: "advisory",
            reason: "requested-advisory",
            requested: "advisory",
            resolved: "advisory",
            status: "resolved",
        },
    );
    assert.deepEqual(
        {
            enforcement: auto.enforcement,
            reason: auto.reason,
            requested: auto.requested_placement,
            resolved: auto.resolved_placement,
            status: auto.status,
        },
        {
            enforcement: "advisory",
            reason: "auto-fallback-unavailable",
            requested: "auto",
            resolved: "advisory",
            status: "resolved",
        },
    );
    assert.equal(advisory.repository_grant_plan_id, fixture.plan.plan_id);
    assert.equal(advisory.task_artifact_digest, fixture.plan.task_artifact_digest);
    assert.equal(advisory.runner_id, fixture.runner.runner_id);
    assert.deepEqual(advisory.platform, fixture.platform);
    assert.notEqual(advisory.resolution_id, auto.resolution_id);
    assert.equal(Object.isFrozen(auto), true);
    assert.equal(Object.isFrozen(auto.platform), true);
});

test("placement resolution fails closed for unavailable jail and forged authority", async (context) => {
    const fixture = await placementFixture(context);
    const valid = {
        captureId: "capture:placement",
        placement: "advisory" as const,
        platform: fixture.platform,
        repositoryGrantPlan: fixture.plan,
        runId: "run:placement",
        runner: fixture.runner,
    };

    assert.throws(
        () => createGrantedPlacementResolution({ ...valid, placement: "jail" }),
        (error: unknown) =>
            error instanceof PlacementUnavailableError &&
            error.evidence.requested_placement === "jail" &&
            error.evidence.status === "refused" &&
            error.evidence.reason === "explicit-jail-unavailable" &&
            error.evidence.placement_version === 1,
    );
    for (const options of [
        null,
        [],
        new Date(),
        {},
        { ...valid, extra: true },
        { ...valid, placement: "unknown" },
        { ...valid, placement: 1 },
        { ...valid, runId: "" },
        { ...valid, runId: "x".repeat(257) },
        { ...valid, captureId: "\uD800" },
        { ...valid, captureId: "x".repeat(257) },
        { ...valid, platform: { ...fixture.platform } },
        { ...valid, repositoryGrantPlan: { ...fixture.plan } },
        { ...valid, runner: { ...fixture.runner } },
        Object.defineProperty({ ...valid }, "placement", { get: () => "advisory" }),
        { ...valid, [Symbol("invalid")]: true },
    ]) {
        assert.throws(() => createGrantedPlacementResolution(options as never), TypeError);
    }
});

async function placementFixture(context: { after: (callback: () => Promise<void>) => void }) {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "shepherd-placement-resolution-"));
    context.after(() => rm(workspaceRoot, { force: true, recursive: true }));
    initializeWorkspace({ adopt: "none", initializeGit: false, rootPath: workspaceRoot });
    const repositoryRoot = path.join(workspaceRoot, "source");
    await mkdir(repositoryRoot);
    execFileSync("git", ["init", "--quiet"], { cwd: repositoryRoot });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repositoryRoot });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: repositoryRoot });
    await writeFile(path.join(repositoryRoot, "message.txt"), "before\n");
    execFileSync("git", ["add", "message.txt"], { cwd: repositoryRoot });
    execFileSync("git", ["commit", "--quiet", "-m", "initial"], { cwd: repositoryRoot });
    const binding = createGitRepositoryBindings({
        bindings: [{ name: "source", root: "source" }],
        workspaceRoot,
    }).bindings[0];
    assert.ok(binding);
    const descriptor = task({
        input: schema.void(),
        instruction: "Resolve placement honestly.",
        name: "placed-world",
        output: schema.void(),
        version: "1",
    });
    const granted = grantTaskRepositories({
        grants: [{ binding: "source", profile: "read-write" }],
        task: descriptor,
    });
    const plan = createGitRepositoryGrantPlan({
        authorityCeiling: "read-write",
        bindings: [binding],
        task: granted,
    });
    const runner = createRetainedWorldRunner({
        enforcement: "advisory",
        runnerId: "runner:placement",
        run: async () => {
            throw new Error("placement fixture runner must not be invoked");
        },
    });
    const platform = createPlacementPlatformEvidence({
        environmentVariables: [],
        nodePlatform: "linux",
        osRelease: "6.8.0",
    });
    return { binding, descriptor, plan, platform, runner, workspaceRoot };
}
