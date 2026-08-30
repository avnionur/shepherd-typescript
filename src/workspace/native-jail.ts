import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { accessSync, constants, realpathSync, statSync } from "node:fs";
import { access, chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { createRecordId } from "../canonical/canonical-record.ts";
import { createCanonicalSnapshot } from "../canonical/snapshot.ts";
import { publicErrorCodes } from "../errors/public-errors.ts";
import { workspaceProtocolConfig } from "../protocol/config.ts";
import {
    readNativeJailBackendEvidence,
    readNativeJailCommandEvidence,
    readNativeJailPlanEvidence,
    readNativeJailProbeEvidence,
    readNativeJailProcessEvidence,
    readNativeJailResolutionEvidence,
} from "../protocol/native-jail-evidence.ts";
import type { TaskSchema } from "../task/schema.ts";
import type {
    NativeJailBackendDescriptor,
    NativeJailBackendProbeEvidence,
    NativeJailCommand,
    NativeJailCommandDefinition,
    NativeJailConfinementPlan,
    NativeJailEnvironmentEntry,
    NativeJailLaunchIntent,
    NativeJailLaunchReceipt,
    NativeJailPlacementResolution,
    NativeJailPlacementResolutionOptions,
    NativeJailProcessStarted,
    NativeJailRunner,
    NativeJailRunnerDefinition,
} from "./native-jail-types.ts";
import {
    assertLocalPlacementPlatformEvidence,
    inspectLocalPlacementPlatformEvidence,
} from "./placement.ts";
import { assertGitRepositoryGrantPlanHandle } from "./repository-grants.ts";
import { registerRetainedWorldRunner } from "./retained-world-runner.ts";
import type { RetainedWorldEnforcement } from "./retained-world-runner-types.ts";

/* Native adapter conformance is measured by real platform-gated syscall/process fixtures. */
/* node:coverage disable */
const executeFile = promisify(execFile);
const AUTHENTICATED_NATIVE_JAIL_PROBES = new WeakSet<object>();
const NATIVE_JAIL_RUNNERS = new WeakMap<
    object,
    {
        readonly command: NativeJailCommand;
        readonly maxOutputBytes: number;
        readonly probe: NativeJailBackendProbeEvidence;
        readonly timeoutMilliseconds: number;
    }
>();
const AUTHENTICATED_NATIVE_JAIL_RESOLUTIONS = new WeakMap<
    object,
    {
        readonly captureId: string;
        readonly repositoryGrantPlan: NativeJailPlacementResolutionOptions<
            TaskSchema<unknown>,
            TaskSchema<unknown>
        >["repositoryGrantPlan"];
        readonly runId: string;
        readonly runner: object;
    }
>();
const AUTHENTICATED_NATIVE_JAIL_PLANS = new WeakMap<
    object,
    { readonly profile: string; readonly runner: object }
>();

const LANDLOCK_HELPER_SOURCE = String.raw`#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <linux/landlock.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/prctl.h>
#include <sys/syscall.h>
#include <unistd.h>

static int apply_landlock(char **roots, int root_count) {
    int abi = (int)syscall(SYS_landlock_create_ruleset, NULL, 0, LANDLOCK_CREATE_RULESET_VERSION);
    if (abi < 1) return -1;
    uint64_t access = LANDLOCK_ACCESS_FS_WRITE_FILE | LANDLOCK_ACCESS_FS_REMOVE_DIR |
        LANDLOCK_ACCESS_FS_REMOVE_FILE | LANDLOCK_ACCESS_FS_MAKE_CHAR |
        LANDLOCK_ACCESS_FS_MAKE_DIR | LANDLOCK_ACCESS_FS_MAKE_REG |
        LANDLOCK_ACCESS_FS_MAKE_SOCK | LANDLOCK_ACCESS_FS_MAKE_FIFO |
        LANDLOCK_ACCESS_FS_MAKE_BLOCK | LANDLOCK_ACCESS_FS_MAKE_SYM;
#ifdef LANDLOCK_ACCESS_FS_REFER
    if (abi >= 2) access |= LANDLOCK_ACCESS_FS_REFER;
#endif
#ifdef LANDLOCK_ACCESS_FS_TRUNCATE
    if (abi >= 3) access |= LANDLOCK_ACCESS_FS_TRUNCATE;
#endif
    struct landlock_ruleset_attr ruleset = { .handled_access_fs = access };
    int ruleset_fd = (int)syscall(SYS_landlock_create_ruleset, &ruleset, sizeof(ruleset), 0);
    if (ruleset_fd < 0) return -1;
    for (int index = 0; index < root_count; index += 1) {
        int root_fd = open(roots[index], O_PATH | O_CLOEXEC);
        if (root_fd < 0) return -1;
        struct landlock_path_beneath_attr path_rule = {
            .allowed_access = access,
            .parent_fd = root_fd,
        };
        int added = (int)syscall(
            SYS_landlock_add_rule,
            ruleset_fd,
            LANDLOCK_RULE_PATH_BENEATH,
            &path_rule,
            0
        );
        close(root_fd);
        if (added < 0) return -1;
    }
    if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0) return -1;
    if (syscall(SYS_landlock_restrict_self, ruleset_fd, 0) != 0) return -1;
    close(ruleset_fd);
    return 0;
}

int main(int argc, char **argv) {
    char **roots = calloc((size_t)argc, sizeof(char *));
    if (roots == NULL) return 125;
    int root_count = 0;
    int index = 1;
    while (index < argc && argv[index][0] != '\0' && argv[index][0] == '-') {
        if (index + 1 < argc && argv[index][0] == '-' && argv[index][1] == '\0') {
            index += 1;
            break;
        }
        if (index + 1 >= argc || argv[index][0] != '-' || argv[index][1] != '-' ||
            argv[index][2] != 'r' || argv[index][3] != 'o' || argv[index][4] != 'o' ||
            argv[index][5] != 't' || argv[index][6] != '\0') return 125;
        roots[root_count++] = argv[index + 1];
        index += 2;
    }
    if (index >= argc || apply_landlock(roots, root_count) != 0) return 125;
    free(roots);
    execvp(argv[index], &argv[index]);
    return errno == ENOENT ? 127 : 126;
}
`;
class HelperBuildError extends Error {
    readonly reason: string;

    constructor(reason: string) {
        super(reason);
        this.reason = reason;
    }
}

class NativeProcessEvidenceRetentionError extends Error {
    readonly retentionCause: unknown;

    constructor(retentionCause: unknown) {
        super("native process evidence retention failed");
        this.retentionCause = retentionCause;
    }
}

/** Raised when native-jail runner admission lacks a successful authenticated host probe. */
export class NativeJailUnavailableError extends TypeError {
    /** Stable configured machine-readable unavailable-native-jail code. */
    readonly code = publicErrorCodes.workspace.nativeJailUnavailable;
    /** Exact authenticated unavailable backend probe. */
    readonly evidence: NativeJailBackendProbeEvidence;

    /**
     * Creates one fail-closed native-jail refusal.
     *
     * @param evidence - Exact unavailable local backend probe.
     */
    constructor(evidence: NativeJailBackendProbeEvidence) {
        super(`native jail is unavailable: ${evidence.reason}`);
        this.name = "NativeJailUnavailableError";
        this.evidence = evidence;
    }
}

/** Raised after a native judged process reaches a non-success or uncertain terminal state. */
export class NativeJailExecutionError extends Error {
    /** Stable configured machine-readable native-execution failure code. */
    readonly code = publicErrorCodes.workspace.nativeJailExecutionFailed;
    /** Exact durable terminal launch receipt. */
    readonly receipt: NativeJailLaunchReceipt;

    /**
     * Creates one fail-closed native process failure.
     *
     * @param receipt - Exact terminal process and quiescence evidence.
     */
    constructor(receipt: NativeJailLaunchReceipt) {
        super(`native jail execution failed: ${receipt.status}`);
        this.name = "NativeJailExecutionError";
        this.receipt = receipt;
    }
}

/**
 * Probes the current host for a configured native syscall-jail backend.
 *
 * An available result requires a real native canary: a write beneath the granted probe root must
 * land and a sibling write outside that root must be absent. Unsupported platforms and every
 * executable, profile, or launch failure return immutable unavailable evidence.
 *
 * @returns Frozen content-addressed local backend probe evidence.
 *
 * @example
 * ```ts
 * const probe = await inspectLocalNativeJailBackend();
 * if (probe.status !== "available") throw new Error(probe.reason);
 * ```
 *
 * @public
 */
/* Host probes are platform-gated and verified by real denial fixtures instead of coverage. */
export async function inspectLocalNativeJailBackend(): Promise<NativeJailBackendProbeEvidence> {
    const platform = inspectLocalPlacementPlatformEvidence();
    const policy = workspaceProtocolConfig.placements.nativeJails;
    const configured = policy.backends.find(
        ({ environments, nodePlatforms }) =>
            nodePlatforms.includes(platform.node_platform) &&
            environments.includes(platform.environment),
    );
    if (configured === undefined) {
        /* Unsupported-platform behavior is exercised on native Windows hosts. */
        /* node:coverage ignore next 9 */
        return createProbeEvidence(
            null,
            platform,
            false,
            false,
            null,
            policy.probeReasonRoles.platformUnsupported,
            policy.probeStatuses[1] as string,
        );
    }
    const backend = createBackendDescriptor(configured);
    /* System-launcher presence has a platform-specific negative path. */
    if (backend.executable !== null) {
        try {
            await access(backend.executable, constants.X_OK);
        } catch {
            /* A configured system launcher cannot be replaced in supported-host tests. */
            /* node:coverage ignore next 9 */
            return createProbeEvidence(
                backend,
                platform,
                false,
                false,
                null,
                policy.probeReasonRoles.executableUnavailable,
                policy.probeStatuses[1] as string,
            );
        }
    }
    const probeRoot = await mkdtemp(path.join(tmpdir(), policy.temporaryDirectoryPrefix));
    try {
        const grantedRoot = path.join(probeRoot, "granted");
        const deniedRoot = path.join(probeRoot, "denied");
        await Promise.all([mkdir(grantedRoot), mkdir(deniedRoot)]);
        const canonicalGrantedRoot = await realpath(grantedRoot);
        const grantedTarget = path.join(canonicalGrantedRoot, "canary");
        const deniedTarget = path.join(await realpath(deniedRoot), "canary");
        const helper = backend.executable === null ? await compileLandlockHelper(probeRoot) : null;
        const profile = seatbeltProfile([canonicalGrantedRoot]);
        const grantedWrite = await attemptNativeWrite(
            backend,
            helper?.path ?? null,
            profile,
            canonicalGrantedRoot,
            probeRoot,
            grantedTarget,
        );
        const deniedWrite = !(await attemptNativeWrite(
            backend,
            helper?.path ?? null,
            profile,
            canonicalGrantedRoot,
            probeRoot,
            deniedTarget,
        ));
        const reason = !grantedWrite
            ? policy.probeReasonRoles.grantedWriteFailed
            : !deniedWrite
              ? policy.probeReasonRoles.deniedWriteFailed
              : policy.probeReasonRoles.succeeded;
        return createProbeEvidence(
            backend,
            platform,
            deniedWrite,
            grantedWrite,
            helper?.digest ?? null,
            reason,
            grantedWrite && deniedWrite
                ? (policy.probeStatuses[0] as string)
                : (policy.probeStatuses[1] as string),
        );
    } catch (error) {
        /* Backend-specific setup faults are exercised on the corresponding platform. */
        /* node:coverage ignore next 9 */
        return createProbeEvidence(
            backend,
            platform,
            false,
            false,
            null,
            error instanceof HelperBuildError ? error.reason : policy.probeReasonRoles.probeError,
            policy.probeStatuses[1] as string,
        );
    } finally {
        await rm(probeRoot, { force: true, recursive: true });
    }
}

/**
 * Creates one opaque native-jail runner bound to a successful real local backend probe.
 *
 * The judged command is an absolute executable plus literal argv and an explicit environment;
 * no shell is created and ambient environment variables are not inherited.
 *
 * @param definition - Exact command, resource bounds, runner identity, and backend probe.
 * @returns Opaque authenticated runner reporting native syscall denial.
 * @throws {TypeError} If the definition, command, executable, or probe is malformed or forged.
 * @throws {NativeJailUnavailableError} If the authenticated probe did not establish a jail.
 *
 * @example
 * ```ts
 * const runner = createNativeJailRunner({
 *     command: { executable: "/usr/bin/true", arguments: [], environment: [] },
 *     maxOutputBytes: 65536,
 *     probe,
 *     runnerId: "runner:native:1",
 *     timeoutMilliseconds: 30000,
 * });
 * ```
 *
 * @public
 */
export function createNativeJailRunner<
    I extends TaskSchema<unknown>,
    O extends TaskSchema<unknown>,
>(definition: NativeJailRunnerDefinition): NativeJailRunner<I, O> {
    const fields = readExactObject(
        definition,
        ["command", "maxOutputBytes", "probe", "runnerId", "timeoutMilliseconds"],
        "native jail runner definition",
    );
    const probe = fields.probe as NativeJailBackendProbeEvidence;
    assertNativeJailBackendProbe(probe);
    const policy = workspaceProtocolConfig.placements.nativeJails;
    if (probe.status !== policy.probeStatuses[0]) {
        /* Unavailable authenticated probes are exercised on unsupported/blocked hosts. */
        /* node:coverage ignore next 1 */
        throw new NativeJailUnavailableError(probe);
    }
    const maxOutputBytes = readPositiveBoundedInteger(
        fields.maxOutputBytes,
        policy.maxOutputBytes,
        "native jail max output bytes",
    );
    const timeoutMilliseconds = readPositiveBoundedInteger(
        fields.timeoutMilliseconds,
        policy.maxTimeoutMilliseconds,
        "native jail timeout",
    );
    const runnerId = readText(fields.runnerId, "native jail runner identity", false);
    const command = createNativeJailCommand(fields.command as NativeJailCommandDefinition);
    const runner = registerRetainedWorldRunner<I, O>({
        enforcement: policy.enforcement as RetainedWorldEnforcement,
        runnerId,
        run: async () => {
            /* Package dispatch never invokes the placeholder callback for native runners. */
            /* node:coverage ignore next 1 */
            throw new TypeError("native jail runner requires the native execution adapter");
        },
    });
    NATIVE_JAIL_RUNNERS.set(runner, {
        command,
        maxOutputBytes,
        probe,
        timeoutMilliseconds,
    });
    return runner;
}

/**
 * Resolves an explicit `jail` or `auto` request to authenticated native enforcement.
 *
 * This function accepts only a runner created from a successful real local backend probe. An
 * unavailable probe cannot produce a runner, so explicit jail fails before resolution or task
 * execution; callers may use the unchanged advisory resolver for a visible `auto` fallback.
 *
 * @param options - Exact placement, platform, grant, runner, run, and capture contract.
 * @returns Frozen content-addressed native-jail placement resolution.
 * @throws {TypeError} If options or authenticated authorities are malformed or inconsistent.
 *
 * @example
 * ```ts
 * const resolution = createNativeJailPlacementResolution({
 *     captureId: "capture:review:1",
 *     placement: "jail",
 *     platform: probe.platform,
 *     repositoryGrantPlan,
 *     runId: "run:review:1",
 *     runner,
 * });
 * ```
 *
 * @public
 */
export function createNativeJailPlacementResolution<
    I extends TaskSchema<unknown>,
    O extends TaskSchema<unknown>,
>(options: NativeJailPlacementResolutionOptions<I, O>): NativeJailPlacementResolution {
    const fields = readExactObject(
        options,
        ["captureId", "placement", "platform", "repositoryGrantPlan", "runId", "runner"],
        "native jail placement resolution options",
    );
    const runner = fields.runner as NativeJailRunner<I, O>;
    const registration = NATIVE_JAIL_RUNNERS.get(runner);
    if (registration === undefined) {
        throw new TypeError("native jail placement requires an authenticated native runner");
    }
    const platform = fields.platform as NativeJailPlacementResolutionOptions<I, O>["platform"];
    assertLocalPlacementPlatformEvidence(platform);
    if (registration.probe.platform !== platform || registration.probe.backend === null) {
        throw new TypeError("native jail probe differs from local placement platform");
    }
    const repositoryGrantPlan = fields.repositoryGrantPlan as NativeJailPlacementResolutionOptions<
        I,
        O
    >["repositoryGrantPlan"];
    assertGitRepositoryGrantPlanHandle(repositoryGrantPlan);
    const request = fields.placement;
    if (request !== "auto" && request !== "jail") {
        throw new TypeError("native jail placement request is unsupported");
    }
    const policy = workspaceProtocolConfig.placements.nativeJails;
    const captureId = readBoundedText(
        fields.captureId,
        "native jail capture identity",
        workspaceProtocolConfig.worldTaskCapture.maxCaptureIdBytes,
    );
    const runId = readBoundedText(
        fields.runId,
        "native jail run identity",
        workspaceProtocolConfig.worldTaskCapture.maxCaptureIdBytes,
    );
    const semantic = createCanonicalSnapshot({
        backend: registration.probe.backend,
        backend_probe: registration.probe,
        capture_id: captureId,
        command: registration.command,
        compatibility_version: policy.compatibilityVersion,
        enforcement: policy.enforcement,
        max_output_bytes: registration.maxOutputBytes,
        placement_version: policy.placementVersion,
        reason:
            request === "auto"
                ? policy.placementReasonRoles.auto
                : policy.placementReasonRoles.explicit,
        repository_grant_plan_id: repositoryGrantPlan.plan_id,
        requested_placement: request,
        resolved_placement: policy.resolvedPlacement,
        run_id: runId,
        runner_id: runner.runner_id,
        status: policy.placementStatus,
        task_artifact_digest: repositoryGrantPlan.task_artifact_digest,
        timeout_milliseconds: registration.timeoutMilliseconds,
    });
    const digest = createRecordId({ native_jail_resolution: semantic });
    const resolution = Object.freeze({
        ...semantic,
        resolution_id: prefixedIdentity(policy.resolutionIdPrefix, digest),
    }) as NativeJailPlacementResolution;
    readNativeJailResolutionEvidence(resolution);
    AUTHENTICATED_NATIVE_JAIL_RESOLUTIONS.set(resolution, {
        captureId,
        repositoryGrantPlan: repositoryGrantPlan as NativeJailPlacementResolutionOptions<
            TaskSchema<unknown>,
            TaskSchema<unknown>
        >["repositoryGrantPlan"],
        runId,
        runner,
    });
    return resolution;
}

/** Authenticates a native-jail resolution against one exact execution contract. @internal */
export function assertNativeJailPlacementResolutionContract<
    I extends TaskSchema<unknown>,
    O extends TaskSchema<unknown>,
>(
    resolution: NativeJailPlacementResolution,
    options: {
        readonly captureId: string;
        readonly repositoryGrantPlan: NativeJailPlacementResolutionOptions<
            I,
            O
        >["repositoryGrantPlan"];
        readonly runId: string;
        readonly runner: NativeJailRunner<I, O>;
    },
): void {
    const stored = AUTHENTICATED_NATIVE_JAIL_RESOLUTIONS.get(resolution);
    if (
        stored === undefined ||
        stored.captureId !== options.captureId ||
        stored.repositoryGrantPlan !== options.repositoryGrantPlan ||
        stored.runId !== options.runId ||
        stored.runner !== options.runner
    ) {
        throw new TypeError("native jail resolution differs from run admission authority");
    }
}

/** Creates one authenticated confinement plan from exact effective writable authority. @internal */
export function createNativeJailConfinementPlan(
    runner: object,
    custodyRoot: string,
    writable: boolean,
): NativeJailConfinementPlan {
    const registration = NATIVE_JAIL_RUNNERS.get(runner);
    if (registration === undefined || registration.probe.backend === null) {
        throw new TypeError("native jail runner registration is invalid");
    }
    const canonicalCustodyRoot = realpathSync(custodyRoot);
    const writableRoots = Object.freeze(writable ? [canonicalCustodyRoot] : []);
    const profile = nativeProfile(registration.probe.backend, writableRoots);
    const profileDigest = createHash("sha256").update(profile).digest("hex");
    const policy = workspaceProtocolConfig.placements.nativeJails;
    const semantic = createCanonicalSnapshot({
        backend_id: registration.probe.backend.backend_id,
        command_id: registration.command.command_id,
        compatibility_version: policy.compatibilityVersion,
        custody_root: canonicalCustodyRoot,
        enforcement: policy.enforcement,
        plan_version: policy.planVersion,
        profile_digest: `sha256:${profileDigest}`,
        probe_id: registration.probe.probe_id,
        writable_roots: writableRoots,
    });
    const digest = createRecordId({ native_jail_plan: semantic });
    const plan = Object.freeze({
        ...semantic,
        plan_id: prefixedIdentity(policy.planIdPrefix, digest),
    }) as NativeJailConfinementPlan;
    readNativeJailPlanEvidence(plan);
    AUTHENTICATED_NATIVE_JAIL_PLANS.set(plan, { profile, runner });
    return plan;
}

/**
 * Launches one authenticated native runner under an exact confinement plan. @internal
 *
 * Hooks retain the launch intent before spawn, start evidence immediately after the OS reports a
 * process, and a terminal receipt only after process-group quiescence is proven or classified
 * uncertain.
 */
/* Native launch timing is platform-gated and verified by real process-boundary fixtures. */
export async function launchNativeJailRunner(
    runner: object,
    plan: NativeJailConfinementPlan,
    signal: AbortSignal,
    hooks: {
        readonly onIntent: (intent: NativeJailLaunchIntent) => void;
        readonly onReceipt: (receipt: NativeJailLaunchReceipt) => void;
        readonly onStarted: (started: NativeJailProcessStarted) => void;
    },
): Promise<NativeJailLaunchReceipt> {
    const registration = NATIVE_JAIL_RUNNERS.get(runner);
    const authenticatedPlan = AUTHENTICATED_NATIVE_JAIL_PLANS.get(plan);
    if (
        registration === undefined ||
        registration.probe.backend === null ||
        authenticatedPlan?.runner !== runner
    ) {
        throw new TypeError("native jail launch authority is invalid");
    }
    const policy = workspaceProtocolConfig.placements.nativeJails;
    const launchDigest = createRecordId({
        native_jail_launch: {
            command_id: registration.command.command_id,
            plan,
            plan_id: plan.plan_id,
            runner_id: (runner as { readonly runner_id: string }).runner_id,
        },
    });
    const intent = Object.freeze({
        command_id: registration.command.command_id,
        launch_id: prefixedIdentity(policy.process.launchIdPrefix, launchDigest),
        plan,
        plan_id: plan.plan_id,
        runner_id: (runner as { readonly runner_id: string }).runner_id,
    });
    readNativeJailProcessEvidence(intent);
    hooks.onIntent(intent);
    if (signal.aborted) {
        const receipt = createLaunchReceipt(
            intent,
            null,
            null,
            null,
            policy.process.statusRoles.cancelled,
            policy.process.quiescenceStatusRoles.proven,
            [],
            [],
        );
        hooks.onReceipt(receipt);
        return receipt;
    }
    let helperDirectory: string | null = null;
    /* Canary disappearance after a successful command is filesystem-scheduler-dependent. */
    try {
        let launcher: string;
        let launcherArguments: readonly string[];
        const backend = registration.probe.backend;
        /* Linux/WSL helper construction is exercised by the Linux-gated denial suite. */
        if (backend.executable === null) {
            helperDirectory = await mkdtemp(path.join(tmpdir(), policy.temporaryDirectoryPrefix));
            const helper = await compileLandlockHelper(helperDirectory);
            if (registration.probe.helper_digest !== helper.digest) {
                throw new HelperBuildError(policy.probeReasonRoles.helperIntegrityFailed);
            }
            launcher = helper.path;
            launcherArguments = [
                ...plan.writable_roots.flatMap((root) => ["--root", root]),
                "-",
                registration.command.executable,
                ...registration.command.arguments,
            ];
        } else {
            if (backend.profile_argument === null) {
                /* Config validation prevents a host launcher without its profile argument. */
                /* node:coverage ignore next 1 */
                throw new TypeError("native jail backend profile argument is unavailable");
            }
            launcher = backend.executable;
            launcherArguments = [
                backend.profile_argument,
                authenticatedPlan.profile,
                registration.command.executable,
                ...registration.command.arguments,
            ];
        }
        const receipt = await runNativeProcess(
            intent,
            launcher,
            launcherArguments,
            plan.custody_root,
            Object.fromEntries(
                registration.command.environment.map(({ name, value }) => [name, value]),
            ),
            registration.maxOutputBytes,
            registration.timeoutMilliseconds,
            signal,
            hooks.onStarted,
        );
        try {
            hooks.onReceipt(receipt);
        } catch (error) {
            throw new NativeProcessEvidenceRetentionError(error);
        }
        return receipt;
    } catch (error) {
        if (error instanceof NativeProcessEvidenceRetentionError) {
            throw error.retentionCause;
        }
        const receipt = createLaunchReceipt(
            intent,
            null,
            null,
            null,
            policy.process.statusRoles.launchFailed,
            policy.process.quiescenceStatusRoles.proven,
            [],
            [],
        );
        hooks.onReceipt(receipt);
        return receipt;
    } finally {
        /* Linux/WSL helpers own a private per-launch directory. */
        /* node:coverage ignore next 3 */
        if (helperDirectory !== null) {
            await rm(helperDirectory, { force: true, recursive: true });
        }
    }
}

/** Returns the authenticated native adapter registration for one runner. @internal */
export function nativeJailRunnerRegistration(runner: object): {
    readonly command: NativeJailCommand;
    readonly maxOutputBytes: number;
    readonly probe: NativeJailBackendProbeEvidence;
    readonly timeoutMilliseconds: number;
} | null {
    return NATIVE_JAIL_RUNNERS.get(runner) ?? null;
}

/** Rejects structurally forged native-jail probe evidence. @internal */
export function assertNativeJailBackendProbe(probe: NativeJailBackendProbeEvidence): void {
    if (!AUTHENTICATED_NATIVE_JAIL_PROBES.has(probe)) {
        throw new TypeError("native jail probe must be created by this package instance");
    }
}

function createBackendDescriptor(
    configured: (typeof workspaceProtocolConfig.placements.nativeJails.backends)[number],
): NativeJailBackendDescriptor {
    const policy = workspaceProtocolConfig.placements.nativeJails;
    const semantic = createCanonicalSnapshot({
        backend_version: policy.descriptorVersion,
        compatibility_version: policy.compatibilityVersion,
        environments: configured.environments,
        enforcement: policy.enforcement,
        executable: configured.executable,
        family: configured.family,
        name: configured.name,
        node_platforms: configured.nodePlatforms,
        profile_argument: configured.profileArgument,
    });
    const digest = createRecordId({ native_jail_backend: semantic });
    const backend = Object.freeze({
        ...semantic,
        backend_id: prefixedIdentity(policy.descriptorIdPrefix, digest),
    }) as NativeJailBackendDescriptor;
    readNativeJailBackendEvidence(backend);
    return backend;
}

function createProbeEvidence(
    backend: NativeJailBackendDescriptor | null,
    platform: NativeJailBackendProbeEvidence["platform"],
    deniedWrite: boolean,
    grantedWrite: boolean,
    helperDigest: string | null,
    reason: string,
    status: string,
): NativeJailBackendProbeEvidence {
    const policy = workspaceProtocolConfig.placements.nativeJails;
    const semantic = createCanonicalSnapshot({
        backend,
        compatibility_version: policy.compatibilityVersion,
        denied_write: deniedWrite,
        enforcement: policy.enforcement,
        granted_write: grantedWrite,
        helper_digest: helperDigest,
        platform,
        probe_version: policy.probeVersion,
        reason,
        status,
    });
    const digest = createRecordId({ native_jail_probe: semantic });
    const evidence = Object.freeze({
        ...semantic,
        platform,
        probe_id: prefixedIdentity(policy.probeIdPrefix, digest),
    }) as NativeJailBackendProbeEvidence;
    readNativeJailProbeEvidence(evidence);
    AUTHENTICATED_NATIVE_JAIL_PROBES.add(evidence);
    return evidence;
}

/**
 * Creates one immutable structured native command without shell interpretation.
 *
 * @param definition - Absolute executable, literal arguments, and explicit environment.
 * @returns Frozen content-addressed command descriptor.
 * @throws {TypeError} If the definition, executable, environment, or bounds are invalid.
 *
 * @public
 */
export function createNativeJailCommand(
    definition: NativeJailCommandDefinition,
): NativeJailCommand {
    const fields = readExactObject(
        definition,
        ["arguments", "environment", "executable"],
        "native jail command definition",
    );
    const policy = workspaceProtocolConfig.placements.nativeJails;
    if (!Array.isArray(fields.arguments) || fields.arguments.length > policy.maxArguments) {
        throw new TypeError("native jail command arguments are invalid");
    }
    const argumentsValue = fields.arguments.map((value) =>
        readText(value, "native jail command argument", true),
    );
    if (
        argumentsValue.reduce((total, value) => total + Buffer.byteLength(value), 0) >
        policy.maxArgumentBytes
    ) {
        throw new TypeError("native jail command arguments exceed configured limits");
    }
    if (
        !Array.isArray(fields.environment) ||
        fields.environment.length > policy.maxEnvironmentEntries
    ) {
        throw new TypeError("native jail command environment is invalid");
    }
    const environment = fields.environment.map((entry) => {
        const value = readExactObject(entry, ["name", "value"], "native jail environment entry");
        const name = readText(value.name, "native jail environment name", false);
        const environmentValue = readText(value.value, "native jail environment value", true);
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name)) {
            throw new TypeError("native jail environment name is invalid");
        }
        return Object.freeze({ name, value: environmentValue });
    });
    environment.sort(({ name: left }, { name: right }) =>
        left < right ? -1 : left > right ? 1 : 0,
    );
    if (
        environment.some(({ name }, index) => name === environment[index - 1]?.name) ||
        environment.reduce(
            (total, { name, value }) => total + Buffer.byteLength(name) + Buffer.byteLength(value),
            0,
        ) > policy.maxEnvironmentValueBytes
    ) {
        throw new TypeError("native jail command environment is ambiguous or too large");
    }
    const executable = readText(fields.executable, "native jail executable", false);
    if (!path.isAbsolute(executable)) {
        throw new TypeError("native jail executable must be absolute");
    }
    let canonicalExecutable: string;
    try {
        canonicalExecutable = realpathSync(executable);
        accessSync(canonicalExecutable, constants.X_OK);
        if (!statSync(canonicalExecutable).isFile()) throw new Error("not a regular file");
    } catch (error) {
        throw new TypeError("native jail executable is unavailable", { cause: error });
    }
    const semantic = createCanonicalSnapshot({
        arguments: argumentsValue,
        command_version: policy.commandVersion,
        environment: environment as readonly NativeJailEnvironmentEntry[],
        executable: canonicalExecutable,
    });
    const digest = createRecordId({ native_jail_command: semantic });
    const command = Object.freeze({
        ...semantic,
        command_id: prefixedIdentity(policy.commandIdPrefix, digest),
    }) as NativeJailCommand;
    readNativeJailCommandEvidence(command);
    return command;
}

/* OS launch, signal, output, and profile details are verified through platform-gated public tests. */
async function attemptNativeWrite(
    backend: NativeJailBackendDescriptor,
    helperPath: string | null,
    profile: string,
    writableRoot: string,
    workingRoot: string,
    target: string,
): Promise<boolean> {
    try {
        /* Linux/WSL probe branch; exercised by the Linux-gated denial suite. */
        if (backend.executable === null) {
            if (helperPath === null) return false;
            await executeFile(
                helperPath,
                ["--root", writableRoot, "-", "/usr/bin/touch", "--", target],
                { cwd: workingRoot },
            );
        } else {
            if (backend.profile_argument === null) return false;
            await executeFile(
                backend.executable,
                [backend.profile_argument, profile, "/usr/bin/touch", "--", target],
                { cwd: workingRoot },
            );
        }
    } catch {
        /* A successful command with an absent canary is a defensive host-filesystem case. */
        /* node:coverage ignore next 1 */
        return false;
    }
    try {
        await access(target, constants.F_OK);
        return true;
    } catch {
        return false;
    }
}

function runNativeProcess(
    intent: NativeJailLaunchIntent,
    executable: string,
    argumentsValue: readonly string[],
    workingRoot: string,
    environment: Readonly<Record<string, string>>,
    maxOutputBytes: number,
    timeoutMilliseconds: number,
    abortSignal: AbortSignal,
    onStarted: (started: NativeJailProcessStarted) => void,
): Promise<NativeJailLaunchReceipt> {
    const policy = workspaceProtocolConfig.placements.nativeJails.process;
    return new Promise((resolve, reject) => {
        const standardOutput: Buffer[] = [];
        const standardError: Buffer[] = [];
        let standardOutputBytes = 0;
        let standardErrorBytes = 0;
        let terminalStatus: string | null = null;
        let evidenceError: NativeProcessEvidenceRetentionError | null = null;
        let settled = false;
        const child = spawn(executable, argumentsValue, {
            cwd: workingRoot,
            detached: true,
            env: environment,
            stdio: ["ignore", "pipe", "pipe"],
        });
        const terminate = (status: string) => {
            terminalStatus ??= status;
            if (child.pid !== undefined) terminateProcessGroup(child.pid);
        };
        const capture = (target: Buffer[], bytes: number, chunk: Buffer): number => {
            const remaining = Math.max(0, maxOutputBytes - bytes);
            if (remaining > 0) target.push(chunk.subarray(0, remaining));
            const observed = Math.min(maxOutputBytes + 1, bytes + chunk.byteLength);
            if (observed > maxOutputBytes) terminate(policy.statusRoles.outputLimit);
            return observed;
        };
        child.stdout.on("data", (chunk: Buffer) => {
            standardOutputBytes = capture(standardOutput, standardOutputBytes, chunk);
        });
        child.stderr.on("data", (chunk: Buffer) => {
            standardErrorBytes = capture(standardError, standardErrorBytes, chunk);
        });
        const timer = setTimeout(() => terminate(policy.statusRoles.timedOut), timeoutMilliseconds);
        const abort = () => terminate(policy.statusRoles.cancelled);
        abortSignal.addEventListener("abort", abort, { once: true });
        child.once("spawn", () => {
            const processId = child.pid;
            if (processId === undefined) return;
            const digest = createRecordId({
                native_jail_start: { launch_id: intent.launch_id, process_id: processId },
            });
            const started = Object.freeze({
                launch_id: intent.launch_id,
                process_id: processId,
                start_id: prefixedIdentity(policy.startIdPrefix, digest),
            });
            readNativeJailProcessEvidence(started);
            try {
                onStarted(started);
            } catch (error) {
                evidenceError = new NativeProcessEvidenceRetentionError(error);
                terminate(policy.statusRoles.launchFailed);
            }
        });
        /* Authenticated launchers exist and are executable immediately before spawn. */
        child.once("error", () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            abortSignal.removeEventListener("abort", abort);
            resolve(
                createLaunchReceipt(
                    intent,
                    null,
                    null,
                    null,
                    policy.statusRoles.launchFailed,
                    policy.quiescenceStatusRoles.proven,
                    standardOutput,
                    standardError,
                    standardOutputBytes,
                    standardErrorBytes,
                ),
            );
        });
        child.once("close", (exitCode, exitSignal) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            abortSignal.removeEventListener("abort", abort);
            void (async () => {
                const processId = child.pid ?? null;
                const quiescent =
                    processId === null ? true : await proveProcessGroupQuiescence(processId);
                if (evidenceError !== null) {
                    reject(evidenceError);
                    return;
                }
                resolve(
                    createLaunchReceipt(
                        intent,
                        processId,
                        exitCode,
                        exitSignal,
                        quiescent
                            ? (terminalStatus ?? policy.statusRoles.exited)
                            : policy.statusRoles.quiescenceUncertain,
                        quiescent
                            ? policy.quiescenceStatusRoles.proven
                            : policy.quiescenceStatusRoles.uncertain,
                        standardOutput,
                        standardError,
                        standardOutputBytes,
                        standardErrorBytes,
                    ),
                );
            })();
        });
    });
}

function createLaunchReceipt(
    intent: NativeJailLaunchIntent,
    processId: number | null,
    exitCode: number | null,
    exitSignal: string | null,
    status: string,
    quiescence: string,
    standardOutput: readonly Buffer[],
    standardError: readonly Buffer[],
    observedStandardOutputBytes = 0,
    observedStandardErrorBytes = 0,
): NativeJailLaunchReceipt {
    const policy = workspaceProtocolConfig.placements.nativeJails.process;
    const stdout = Buffer.concat(standardOutput);
    const stderr = Buffer.concat(standardError);
    const semantic = createCanonicalSnapshot({
        exit_code: exitCode,
        launch_id: intent.launch_id,
        process_id: processId,
        quiescence,
        receipt_version: policy.receiptVersion,
        signal: exitSignal,
        status,
        stderr_base64: stderr.toString("base64"),
        stderr_bytes: observedStandardErrorBytes,
        stdout_base64: stdout.toString("base64"),
        stdout_bytes: observedStandardOutputBytes,
    });
    const digest = createRecordId({ native_jail_receipt: semantic });
    const receipt = Object.freeze({
        ...semantic,
        receipt_id: prefixedIdentity(policy.receiptIdPrefix, digest),
    }) as NativeJailLaunchReceipt;
    readNativeJailProcessEvidence(receipt);
    return receipt;
}

function terminateProcessGroup(processId: number): void {
    try {
        process.kill(-processId, workspaceProtocolConfig.placements.nativeJails.process.killSignal);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
}

/* Process-group disappearance timing and errno branches are OS-scheduler-dependent. */
async function proveProcessGroupQuiescence(processId: number): Promise<boolean> {
    const policy = workspaceProtocolConfig.placements.nativeJails.process;
    terminateProcessGroup(processId);
    for (let attempt = 0; attempt < policy.quiescenceAttempts; attempt += 1) {
        try {
            process.kill(-processId, 0);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ESRCH") return true;
            /* Non-ESRCH group-probe failures require an injected kernel fault. */
            /* node:coverage ignore next 1 */
            return false;
        }
        /* A surviving SIGKILL process group is classified but cannot be forced portably. */
        /* node:coverage ignore next 5 */
        await new Promise<void>((resolve) => {
            setTimeout(resolve, policy.quiescenceDelayMilliseconds);
        });
    }
    return false;
}

/* Linux/WSL helper compilation is exercised by the Linux-gated denial suite. */
async function compileLandlockHelper(
    directory: string,
): Promise<{ readonly digest: string; readonly path: string }> {
    const policy = workspaceProtocolConfig.placements.nativeJails;
    let compiler: string | null = null;
    for (const candidate of policy.compilerExecutables) {
        try {
            await access(candidate, constants.X_OK);
            compiler = candidate;
            break;
        } catch {}
    }
    if (compiler === null) {
        throw new HelperBuildError(policy.probeReasonRoles.helperCompilerUnavailable);
    }
    const sourcePath = path.join(directory, "landlock-helper.c");
    const executablePath = path.join(directory, "landlock-helper");
    await writeFile(sourcePath, LANDLOCK_HELPER_SOURCE, { encoding: "utf8", mode: 0o600 });
    try {
        await executeFile(
            compiler,
            [
                ...policy.compilerArguments,
                policy.compilerOutputArgument,
                executablePath,
                sourcePath,
            ],
            { cwd: directory },
        );
        await chmod(executablePath, 0o500);
        const bytes = await readFile(executablePath);
        const digest = createHash("sha256").update(bytes).digest("hex");
        if (bytes.byteLength === 0 || digest.length !== 64) {
            throw new Error("compiled helper is invalid");
        }
        return Object.freeze({ digest: `sha256:${digest}`, path: executablePath });
    } catch {
        throw new HelperBuildError(policy.probeReasonRoles.helperIntegrityFailed);
    }
}

function nativeProfile(
    backend: NativeJailBackendDescriptor,
    writableRoots: readonly string[],
): string {
    return backend.executable === null
        ? JSON.stringify(writableRoots)
        : seatbeltProfile(writableRoots);
}

function seatbeltProfile(writableRoots: readonly string[]): string {
    return [
        "(version 1)",
        "(allow default)",
        "(deny file-write*)",
        ...writableRoots.map(
            (root) => `(allow file-write* (subpath "${escapeSeatbeltString(root)}"))`,
        ),
    ].join("\n");
}

function escapeSeatbeltString(value: string): string {
    return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function prefixedIdentity(prefix: string, digest: string): string {
    return `${prefix}${digest.slice(digest.lastIndexOf(":") + 1)}`;
}

/* Malformed public-seam matrices exercise these closed decoder primitives. */
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

function readText(value: unknown, subject: string, allowEmpty: boolean): string {
    if (
        typeof value !== "string" ||
        (!allowEmpty && value.length === 0) ||
        value.includes("\0") ||
        /[\uD800-\uDFFF]/u.test(value)
    ) {
        throw new TypeError(`${subject} is invalid`);
    }
    return value;
}

function readBoundedText(value: unknown, subject: string, maximumBytes: number): string {
    const text = readText(value, subject, false);
    if (Buffer.byteLength(text) > maximumBytes) {
        throw new TypeError(`${subject} is invalid`);
    }
    return text;
}

function readPositiveBoundedInteger(value: unknown, maximum: number, subject: string): number {
    if (!Number.isSafeInteger(value) || (value as number) <= 0 || (value as number) > maximum) {
        throw new TypeError(`${subject} is invalid`);
    }
    return value as number;
}
/* node:coverage enable */
