import { Buffer } from "node:buffer";

import { createRecordId, type SemanticRecord } from "../canonical/canonical-record.ts";
import { createCanonicalSnapshot } from "../canonical/snapshot.ts";
import { recordIdConfig, taskProtocolConfig, workspaceProtocolConfig } from "./config.ts";
import { readPlacementPlatformEvidence } from "./placement-evidence.ts";

/* Exact malformed-evidence matrices provide stronger evidence than short-circuit branch counts. */
/* node:coverage disable */
/** Decodes and rehashes one persisted native-jail backend descriptor. @internal */
export function readNativeJailBackendEvidence(value: unknown): SemanticRecord {
    const fields = readExactObject(
        value,
        [
            "backend_id",
            "backend_version",
            "compatibility_version",
            "enforcement",
            "environments",
            "executable",
            "family",
            "name",
            "node_platforms",
            "profile_argument",
        ],
        "native jail backend evidence",
    );
    const policy = workspaceProtocolConfig.placements.nativeJails;
    const configured = policy.backends.find(({ name }) => name === fields.name);
    if (
        configured === undefined ||
        fields.backend_version !== policy.descriptorVersion ||
        fields.compatibility_version !== policy.compatibilityVersion ||
        fields.enforcement !== policy.enforcement ||
        fields.executable !== configured.executable ||
        fields.family !== configured.family ||
        fields.profile_argument !== configured.profileArgument ||
        !sameStringArray(fields.environments, configured.environments) ||
        !sameStringArray(fields.node_platforms, configured.nodePlatforms)
    ) {
        throw new TypeError("native jail backend evidence is inconsistent");
    }
    const semantic = createCanonicalSnapshot({
        backend_version: policy.descriptorVersion,
        compatibility_version: policy.compatibilityVersion,
        enforcement: policy.enforcement,
        environments: configured.environments,
        executable: configured.executable,
        family: configured.family,
        name: configured.name,
        node_platforms: configured.nodePlatforms,
        profile_argument: configured.profileArgument,
    });
    return withIdentity(
        fields.backend_id,
        policy.descriptorIdPrefix,
        "native_jail_backend",
        semantic,
    );
}

/** Decodes and rehashes one persisted native-jail backend probe. @internal */
export function readNativeJailProbeEvidence(value: unknown): SemanticRecord {
    const fields = readExactObject(
        value,
        [
            "backend",
            "compatibility_version",
            "denied_write",
            "enforcement",
            "granted_write",
            "helper_digest",
            "platform",
            "probe_id",
            "probe_version",
            "reason",
            "status",
        ],
        "native jail probe evidence",
    );
    const policy = workspaceProtocolConfig.placements.nativeJails;
    const platform = readPlacementPlatformEvidence(fields.platform);
    const backend = fields.backend === null ? null : readNativeJailBackendEvidence(fields.backend);
    const status = readConfiguredText(
        fields.status,
        policy.probeStatuses,
        "native jail probe status",
    );
    const reason = readConfiguredText(
        fields.reason,
        policy.probeReasons,
        "native jail probe reason",
    );
    if (
        fields.compatibility_version !== policy.compatibilityVersion ||
        fields.enforcement !== policy.enforcement ||
        fields.probe_version !== policy.probeVersion ||
        typeof fields.denied_write !== "boolean" ||
        typeof fields.granted_write !== "boolean" ||
        (fields.helper_digest !== null && !isDigest(fields.helper_digest, "sha256:")) ||
        (status === policy.probeStatuses[0]
            ? backend === null ||
              reason !== policy.probeReasonRoles.succeeded ||
              fields.denied_write !== true ||
              fields.granted_write !== true
            : reason === policy.probeReasonRoles.succeeded)
    ) {
        throw new TypeError("native jail probe evidence is inconsistent");
    }
    const semantic = createCanonicalSnapshot({
        backend,
        compatibility_version: policy.compatibilityVersion,
        denied_write: fields.denied_write,
        enforcement: policy.enforcement,
        granted_write: fields.granted_write,
        helper_digest: fields.helper_digest as string | null,
        platform,
        probe_version: policy.probeVersion,
        reason,
        status,
    });
    return withIdentity(fields.probe_id, policy.probeIdPrefix, "native_jail_probe", semantic);
}

/** Decodes and rehashes one persisted structured native command. @internal */
export function readNativeJailCommandEvidence(value: unknown): SemanticRecord {
    const fields = readExactObject(
        value,
        ["arguments", "command_id", "command_version", "environment", "executable"],
        "native jail command evidence",
    );
    const policy = workspaceProtocolConfig.placements.nativeJails;
    const argumentsValue = readStringArray(fields.arguments, "native jail command arguments");
    if (
        argumentsValue.length > policy.maxArguments ||
        argumentsValue.reduce((total, item) => total + Buffer.byteLength(item), 0) >
            policy.maxArgumentBytes ||
        fields.command_version !== policy.commandVersion
    ) {
        throw new TypeError("native jail command evidence exceeds configured limits");
    }
    if (
        !Array.isArray(fields.environment) ||
        fields.environment.length > policy.maxEnvironmentEntries
    ) {
        throw new TypeError("native jail command environment is invalid");
    }
    const environment = fields.environment.map((entry) => {
        const item = readExactObject(entry, ["name", "value"], "native jail environment entry");
        const name = readText(item.name, "native jail environment name", false);
        const environmentValue = readText(item.value, "native jail environment value", true);
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name))
            throw new TypeError("native jail environment name is invalid");
        return Object.freeze({ name, value: environmentValue });
    });
    if (
        environment.some(({ name }, index) => {
            const previous = environment[index - 1];
            return previous !== undefined && name <= previous.name;
        }) ||
        environment.reduce(
            (total, { name, value }) => total + Buffer.byteLength(name) + Buffer.byteLength(value),
            0,
        ) > policy.maxEnvironmentValueBytes
    ) {
        throw new TypeError("native jail command environment is not canonical");
    }
    const executable = readText(fields.executable, "native jail executable", false);
    const semantic = createCanonicalSnapshot({
        arguments: argumentsValue,
        command_version: policy.commandVersion,
        environment,
        executable,
    });
    return withIdentity(fields.command_id, policy.commandIdPrefix, "native_jail_command", semantic);
}

/** Decodes and rehashes one persisted native-jail placement resolution. @internal */
export function readNativeJailResolutionEvidence(value: unknown): SemanticRecord {
    const fields = readExactObject(
        value,
        [
            "backend",
            "backend_probe",
            "capture_id",
            "command",
            "compatibility_version",
            "enforcement",
            "max_output_bytes",
            "placement_version",
            "reason",
            "repository_grant_plan_id",
            "requested_placement",
            "resolution_id",
            "resolved_placement",
            "run_id",
            "runner_id",
            "status",
            "task_artifact_digest",
            "timeout_milliseconds",
        ],
        "native jail resolution evidence",
    );
    const policy = workspaceProtocolConfig.placements.nativeJails;
    const backend = readNativeJailBackendEvidence(fields.backend);
    const probe = readNativeJailProbeEvidence(fields.backend_probe);
    const command = readNativeJailCommandEvidence(fields.command);
    const request =
        fields.requested_placement === "auto"
            ? "auto"
            : fields.requested_placement === "jail"
              ? "jail"
              : null;
    const reason =
        request === "auto"
            ? policy.placementReasonRoles.auto
            : request === "jail"
              ? policy.placementReasonRoles.explicit
              : null;
    if (
        request === null ||
        reason === null ||
        fields.compatibility_version !== policy.compatibilityVersion ||
        fields.enforcement !== policy.enforcement ||
        !Number.isSafeInteger(fields.max_output_bytes) ||
        (fields.max_output_bytes as number) <= 0 ||
        (fields.max_output_bytes as number) > policy.maxOutputBytes ||
        fields.placement_version !== policy.placementVersion ||
        fields.reason !== reason ||
        fields.resolved_placement !== policy.resolvedPlacement ||
        fields.status !== policy.placementStatus ||
        backend.backend_id !== (probe.backend as SemanticRecord | null)?.backend_id ||
        !isDigest(
            fields.repository_grant_plan_id,
            workspaceProtocolConfig.repositoryGrants.planIdPrefix,
        ) ||
        !isDigest(fields.task_artifact_digest, taskProtocolConfig.digestPrefix) ||
        !Number.isSafeInteger(fields.timeout_milliseconds) ||
        (fields.timeout_milliseconds as number) <= 0 ||
        (fields.timeout_milliseconds as number) > policy.maxTimeoutMilliseconds
    ) {
        throw new TypeError("native jail resolution evidence is inconsistent");
    }
    const semantic = createCanonicalSnapshot({
        backend,
        backend_probe: probe,
        capture_id: readBoundedText(fields.capture_id, "native jail capture identity"),
        command,
        compatibility_version: policy.compatibilityVersion,
        enforcement: policy.enforcement,
        max_output_bytes: fields.max_output_bytes as number,
        placement_version: policy.placementVersion,
        reason,
        repository_grant_plan_id: fields.repository_grant_plan_id as string,
        requested_placement: request,
        resolved_placement: policy.resolvedPlacement,
        run_id: readBoundedText(fields.run_id, "native jail run identity"),
        runner_id: readText(fields.runner_id, "native jail runner identity", false),
        status: policy.placementStatus,
        task_artifact_digest: fields.task_artifact_digest as string,
        timeout_milliseconds: fields.timeout_milliseconds as number,
    });
    return withIdentity(
        fields.resolution_id,
        policy.resolutionIdPrefix,
        "native_jail_resolution",
        semantic,
    );
}

/** Decodes and rehashes one persisted native confinement plan. @internal */
export function readNativeJailPlanEvidence(value: unknown): SemanticRecord {
    const fields = readExactObject(
        value,
        [
            "backend_id",
            "command_id",
            "compatibility_version",
            "custody_root",
            "enforcement",
            "plan_id",
            "plan_version",
            "probe_id",
            "profile_digest",
            "writable_roots",
        ],
        "native jail plan evidence",
    );
    const policy = workspaceProtocolConfig.placements.nativeJails;
    const roots = readStringArray(fields.writable_roots, "native jail writable roots");
    if (
        fields.compatibility_version !== policy.compatibilityVersion ||
        fields.enforcement !== policy.enforcement ||
        fields.plan_version !== policy.planVersion ||
        !isDigest(fields.backend_id, policy.descriptorIdPrefix) ||
        !isDigest(fields.command_id, policy.commandIdPrefix) ||
        !isDigest(fields.probe_id, policy.probeIdPrefix) ||
        !isDigest(fields.profile_digest, "sha256:") ||
        new Set(roots).size !== roots.length
    )
        throw new TypeError("native jail plan evidence is inconsistent");
    const semantic = createCanonicalSnapshot({
        backend_id: fields.backend_id as string,
        command_id: fields.command_id as string,
        compatibility_version: policy.compatibilityVersion,
        custody_root: readText(fields.custody_root, "native jail custody root", false),
        enforcement: policy.enforcement,
        plan_version: policy.planVersion,
        probe_id: fields.probe_id as string,
        profile_digest: fields.profile_digest as string,
        writable_roots: roots,
    });
    return withIdentity(fields.plan_id, policy.planIdPrefix, "native_jail_plan", semantic);
}

/** Decodes and rehashes one launch intent, start, or terminal receipt. @internal */
export function readNativeJailProcessEvidence(value: unknown): SemanticRecord {
    const keys = value !== null && typeof value === "object" ? Object.keys(value).sort() : [];
    const policy = workspaceProtocolConfig.placements.nativeJails.process;
    if (keys.includes("command_id")) {
        const fields = readExactObject(
            value,
            ["command_id", "launch_id", "plan", "plan_id", "runner_id"],
            "native jail launch intent",
        );
        const plan = readNativeJailPlanEvidence(fields.plan);
        const semantic = createCanonicalSnapshot({
            command_id: requireDigest(
                fields.command_id,
                workspaceProtocolConfig.placements.nativeJails.commandIdPrefix,
                "native jail command",
            ),
            plan,
            plan_id: requireDigest(
                fields.plan_id,
                workspaceProtocolConfig.placements.nativeJails.planIdPrefix,
                "native jail plan",
            ),
            runner_id: readText(fields.runner_id, "native jail runner identity", false),
        });
        if (semantic.plan_id !== plan.plan_id)
            throw new TypeError("native jail launch plan is inconsistent");
        return withIdentity(
            fields.launch_id,
            policy.launchIdPrefix,
            "native_jail_launch",
            semantic,
        );
    }
    if (keys.includes("start_id")) {
        const fields = readExactObject(
            value,
            ["launch_id", "process_id", "start_id"],
            "native jail process start",
        );
        const processId = readPositiveInteger(fields.process_id, "native jail process identity");
        const semantic = createCanonicalSnapshot({
            launch_id: requireDigest(fields.launch_id, policy.launchIdPrefix, "native jail launch"),
            process_id: processId,
        });
        return withIdentity(fields.start_id, policy.startIdPrefix, "native_jail_start", semantic);
    }
    const fields = readExactObject(
        value,
        [
            "exit_code",
            "launch_id",
            "process_id",
            "quiescence",
            "receipt_id",
            "receipt_version",
            "signal",
            "status",
            "stderr_base64",
            "stderr_bytes",
            "stdout_base64",
            "stdout_bytes",
        ],
        "native jail launch receipt",
    );
    const stdout = readBase64(fields.stdout_base64, "native jail standard output");
    const stderr = readBase64(fields.stderr_base64, "native jail standard error");
    const stdoutBytes = readNonNegativeInteger(
        fields.stdout_bytes,
        "native jail standard output bytes",
    );
    const stderrBytes = readNonNegativeInteger(
        fields.stderr_bytes,
        "native jail standard error bytes",
    );
    if (
        stdout.byteLength > stdoutBytes ||
        stdout.byteLength > workspaceProtocolConfig.placements.nativeJails.maxOutputBytes ||
        stdoutBytes > workspaceProtocolConfig.placements.nativeJails.maxOutputBytes + 1 ||
        stderr.byteLength > stderrBytes ||
        stderr.byteLength > workspaceProtocolConfig.placements.nativeJails.maxOutputBytes ||
        stderrBytes > workspaceProtocolConfig.placements.nativeJails.maxOutputBytes + 1 ||
        fields.receipt_version !== policy.receiptVersion
    )
        throw new TypeError("native jail receipt output is inconsistent");
    const semantic = createCanonicalSnapshot({
        exit_code: readNullableInteger(fields.exit_code, "native jail exit code"),
        launch_id: requireDigest(fields.launch_id, policy.launchIdPrefix, "native jail launch"),
        process_id:
            fields.process_id === null
                ? null
                : readPositiveInteger(fields.process_id, "native jail process identity"),
        quiescence: readConfiguredText(
            fields.quiescence,
            policy.quiescenceStatuses,
            "native jail quiescence",
        ),
        receipt_version: policy.receiptVersion,
        signal:
            fields.signal === null ? null : readText(fields.signal, "native jail signal", false),
        status: readConfiguredText(fields.status, policy.statuses, "native jail process status"),
        stderr_base64: fields.stderr_base64 as string,
        stderr_bytes: stderrBytes,
        stdout_base64: fields.stdout_base64 as string,
        stdout_bytes: stdoutBytes,
    });
    return withIdentity(fields.receipt_id, policy.receiptIdPrefix, "native_jail_receipt", semantic);
}

/* Closed decoder primitives are exercised by malformed matrices; exclude defensive branches. */
function withIdentity(
    value: unknown,
    prefix: string,
    domain: string,
    semantic: SemanticRecord,
): SemanticRecord {
    const digest = createRecordId({ [domain]: semantic });
    const identity = `${prefix}${digest.slice(digest.lastIndexOf(":") + 1)}`;
    if (value !== identity)
        throw new TypeError(`${domain.replaceAll("_", " ")} identity is inconsistent`);
    const identityKey = domain.endsWith("backend")
        ? "backend_id"
        : domain.endsWith("probe")
          ? "probe_id"
          : domain.endsWith("command")
            ? "command_id"
            : domain.endsWith("resolution")
              ? "resolution_id"
              : domain.endsWith("plan")
                ? "plan_id"
                : domain.endsWith("launch")
                  ? "launch_id"
                  : domain.endsWith("start")
                    ? "start_id"
                    : "receipt_id";
    return createCanonicalSnapshot({ ...semantic, [identityKey]: identity });
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
    )
        throw new TypeError(`${subject} must be exact data`);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors).sort();
    if (
        keys.length !== expected.length ||
        keys.some((key, index) => key !== expected[index]) ||
        expected.some((key) => !("value" in (descriptors[key] as PropertyDescriptor)))
    )
        throw new TypeError(`${subject} must be exact data`);
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
    )
        throw new TypeError(`${subject} is invalid`);
    return value;
}

function readBoundedText(value: unknown, subject: string): string {
    const text = readText(value, subject, false);
    if (Buffer.byteLength(text) > workspaceProtocolConfig.worldTaskCapture.maxCaptureIdBytes)
        throw new TypeError(`${subject} is invalid`);
    return text;
}

function readStringArray(value: unknown, subject: string): readonly string[] {
    if (!Array.isArray(value)) throw new TypeError(`${subject} must be an array`);
    return Object.freeze(value.map((item) => readText(item, subject, true)));
}

function sameStringArray(value: unknown, expected: readonly string[]): boolean {
    return (
        Array.isArray(value) &&
        value.length === expected.length &&
        value.every((item, index) => item === expected[index])
    );
}

function readConfiguredText(value: unknown, allowed: readonly string[], subject: string): string {
    const text = readText(value, subject, false);
    if (!allowed.includes(text)) throw new TypeError(`${subject} is unsupported`);
    return text;
}

function isDigest(value: unknown, prefix: string): value is string {
    return (
        typeof value === "string" &&
        value.startsWith(prefix) &&
        value.slice(prefix.length).length === recordIdConfig.hexLength &&
        /^[0-9a-f]+$/u.test(value.slice(prefix.length))
    );
}

function requireDigest(value: unknown, prefix: string, subject: string): string {
    if (!isDigest(value, prefix)) throw new TypeError(`${subject} identity is invalid`);
    return value;
}

function readPositiveInteger(value: unknown, subject: string): number {
    if (!Number.isSafeInteger(value) || (value as number) <= 0)
        throw new TypeError(`${subject} is invalid`);
    return value as number;
}

function readNonNegativeInteger(value: unknown, subject: string): number {
    if (!Number.isSafeInteger(value) || (value as number) < 0)
        throw new TypeError(`${subject} is invalid`);
    return value as number;
}

function readNullableInteger(value: unknown, subject: string): number | null {
    if (value === null) return null;
    if (!Number.isSafeInteger(value)) throw new TypeError(`${subject} is invalid`);
    return value as number;
}

function readBase64(value: unknown, subject: string): Buffer {
    const text = readText(value, subject, true);
    const bytes = Buffer.from(text, "base64");
    if (bytes.toString("base64") !== text) throw new TypeError(`${subject} is invalid base64`);
    return bytes;
}
/* node:coverage enable */
