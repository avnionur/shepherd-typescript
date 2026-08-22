import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { Ajv2020, type AnySchemaObject } from "ajv/dist/2020.js";

import { createRecordId, type SemanticRecord } from "../../src/canonical/canonical-record.ts";
import { createCanonicalSnapshot } from "../../src/canonical/snapshot.ts";
import {
    createGitRepositoryBindings,
    createGitRepositoryGrantPlan,
    createNativeJailCommand,
    createNativeJailPlacementResolution,
    createNativeJailRunner,
    createPlacementPlatformEvidence,
    grantTaskRepositories,
    initializeWorkspace,
    inspectLocalNativeJailBackend,
    schema,
    task,
} from "../../src/index.ts";
import { workspaceProtocolConfig } from "../../src/protocol/config.ts";
import {
    readNativeJailBackendEvidence,
    readNativeJailCommandEvidence,
    readNativeJailPlanEvidence,
    readNativeJailProbeEvidence,
    readNativeJailProcessEvidence,
    readNativeJailResolutionEvidence,
} from "../../src/protocol/native-jail-evidence.ts";
import {
    assertNativeJailPlacementResolutionContract,
    createNativeJailConfinementPlan,
    launchNativeJailRunner,
    nativeJailRunnerRegistration,
} from "../../src/workspace/native-jail.ts";
import type {
    NativeJailLaunchIntent,
    NativeJailLaunchReceipt,
    NativeJailProcessStarted,
} from "../../src/workspace/native-jail-types.ts";

const schemas = [
    "placement-platform-evidence-v1.schema.json",
    "native-jail-backend-v1.schema.json",
    "native-jail-command-v1.schema.json",
    "native-jail-plan-v1.schema.json",
    "native-jail-probe-v1.schema.json",
    "native-jail-process-v1.schema.json",
    "native-jail-resolution-v1.schema.json",
    "repository-grant-plan-v1.schema.json",
    "placement-resolution-v1.schema.json",
    "world-capture-journal-v4.schema.json",
].map(
    (name) =>
        JSON.parse(
            readFileSync(new URL(`../../spec/schemas/${name}`, import.meta.url), "utf8"),
        ) as AnySchemaObject,
);

test("native jail schemas and decoders accept exact evidence and reject malformed copies", async (context) => {
    const probe = await inspectLocalNativeJailBackend();
    const validator = new Ajv2020({ strict: true });
    for (const schemaDocument of schemas) validator.addSchema(schemaDocument);
    const validateProbe = validator.getSchema(schemas[4]?.$id as string);
    assert.ok(validateProbe);
    assert.equal(validateProbe(probe), true, validator.errorsText(validateProbe.errors));
    assert.deepEqual(readNativeJailProbeEvidence(probe), probe);
    for (const invalid of [
        { ...probe, probe_id: "invalid" },
        { ...probe, probe_version: 2 },
        { ...probe, compatibility_version: "other" },
        { ...probe, enforcement: "advisory" },
        { ...probe, reason: "unknown" },
        { ...probe, status: "unknown" },
        { ...probe, helper_digest: "invalid" },
        { ...probe, granted_write: !probe.granted_write },
    ]) {
        assert.throws(() => readNativeJailProbeEvidence(invalid), TypeError);
    }
    if (probe.backend !== null) {
        const validateBackend = validator.getSchema(schemas[1]?.$id as string);
        assert.ok(validateBackend);
        assert.equal(
            validateBackend(probe.backend),
            true,
            validator.errorsText(validateBackend.errors),
        );
        assert.deepEqual(readNativeJailBackendEvidence(probe.backend), probe.backend);
        for (const invalid of [
            { ...probe.backend, name: "unknown" },
            { ...probe.backend, backend_id: "invalid" },
            { ...probe.backend, backend_version: 2 },
            { ...probe.backend, environments: [] },
            { ...probe.backend, node_platforms: [] },
            { ...probe.backend, enforcement: "advisory" },
        ]) {
            assert.throws(() => readNativeJailBackendEvidence(invalid), TypeError);
        }
    }
    const jailPolicy = workspaceProtocolConfig.placements.nativeJails;
    const unsupportedPlatform = createPlacementPlatformEvidence({
        environmentVariables: [],
        nodePlatform: "unsupported-test-platform",
        osRelease: "unsupported-test-release",
    });
    const unsupportedSemantic = createCanonicalSnapshot({
        backend: null,
        compatibility_version: jailPolicy.compatibilityVersion,
        denied_write: false,
        enforcement: jailPolicy.enforcement,
        granted_write: false,
        helper_digest: null,
        platform: unsupportedPlatform,
        probe_version: jailPolicy.probeVersion,
        reason: jailPolicy.probeReasonRoles.platformUnsupported,
        status: jailPolicy.probeStatuses[1],
    });
    const unsupportedProbe = Object.freeze({
        ...unsupportedSemantic,
        probe_id: testIdentity("native_jail_probe", jailPolicy.probeIdPrefix, unsupportedSemantic),
    });
    assert.deepEqual(readNativeJailProbeEvidence(unsupportedProbe), unsupportedProbe);
    assert.throws(
        () =>
            readNativeJailProbeEvidence({
                ...unsupportedProbe,
                reason: jailPolicy.probeReasonRoles.succeeded,
            }),
        TypeError,
    );
    const landlockConfig = jailPolicy.backends.find(({ executable }) => executable === null);
    assert.ok(landlockConfig);
    const landlockSemantic = createCanonicalSnapshot({
        backend_version: jailPolicy.descriptorVersion,
        compatibility_version: jailPolicy.compatibilityVersion,
        enforcement: jailPolicy.enforcement,
        environments: landlockConfig.environments,
        executable: landlockConfig.executable,
        family: landlockConfig.family,
        name: landlockConfig.name,
        node_platforms: landlockConfig.nodePlatforms,
        profile_argument: landlockConfig.profileArgument,
    });
    const landlockBackend = Object.freeze({
        ...landlockSemantic,
        backend_id: testIdentity(
            "native_jail_backend",
            jailPolicy.descriptorIdPrefix,
            landlockSemantic,
        ),
    });
    assert.deepEqual(readNativeJailBackendEvidence(landlockBackend), landlockBackend);
    const landlockProbeSemantic = createCanonicalSnapshot({
        backend: landlockBackend,
        compatibility_version: jailPolicy.compatibilityVersion,
        denied_write: false,
        enforcement: jailPolicy.enforcement,
        granted_write: false,
        helper_digest: `sha256:${"0".repeat(64)}`,
        platform: createPlacementPlatformEvidence({
            environmentVariables: [],
            nodePlatform: "linux",
            osRelease: "test-linux",
        }),
        probe_version: jailPolicy.probeVersion,
        reason: jailPolicy.probeReasonRoles.helperIntegrityFailed,
        status: jailPolicy.probeStatuses[1],
    });
    const landlockProbe = Object.freeze({
        ...landlockProbeSemantic,
        probe_id: testIdentity(
            "native_jail_probe",
            jailPolicy.probeIdPrefix,
            landlockProbeSemantic,
        ),
    });
    assert.deepEqual(readNativeJailProbeEvidence(landlockProbe), landlockProbe);
    createNativeJailCommand({
        arguments: [],
        environment: [
            { name: "SECOND", value: "2" },
            { name: "FIRST", value: "1" },
        ],
        executable: "/usr/bin/true",
    });
    if (probe.status !== "available") {
        context.skip(`native jail backend unavailable: ${probe.reason}`);
        return;
    }

    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "shepherd-native-schema-"));
    context.after(() => rm(workspaceRoot, { force: true, recursive: true }));
    initializeWorkspace({ adopt: "none", initializeGit: false, rootPath: workspaceRoot });
    const repositoryRoot = path.join(workspaceRoot, "source");
    await mkdir(repositoryRoot);
    execFileSync("git", ["init", "--quiet"], { cwd: repositoryRoot });
    const binding = createGitRepositoryBindings({
        bindings: [{ name: "source", root: "source" }],
        workspaceRoot,
    }).bindings[0];
    assert.ok(binding);
    const descriptor = task({
        input: schema.void(),
        instruction: "Validate native evidence.",
        name: "native-schema",
        output: schema.void(),
        version: "1",
    });
    const granted = grantTaskRepositories({
        grants: [{ binding: "source", profile: "read-only" }],
        task: descriptor,
    });
    const repositoryGrantPlan = createGitRepositoryGrantPlan({
        authorityCeiling: "read-only",
        bindings: [binding],
        task: granted,
    });
    const runner = createNativeJailRunner({
        command: { arguments: [], environment: [], executable: "/usr/bin/true" },
        maxOutputBytes: 1024,
        probe,
        runnerId: "runner:native-schema",
        timeoutMilliseconds: 5000,
    });
    const registration = nativeJailRunnerRegistration(runner);
    assert.ok(registration);
    assert.equal(nativeJailRunnerRegistration({}), null);
    const plan = createNativeJailConfinementPlan(runner, repositoryRoot, false);
    const resolutionOptions = {
        captureId: "capture:native-schema",
        placement: "jail",
        platform: probe.platform,
        repositoryGrantPlan,
        runId: "run:native-schema",
        runner,
    } as const;
    const resolution = createNativeJailPlacementResolution(resolutionOptions);
    assert.throws(
        () =>
            assertNativeJailPlacementResolutionContract(
                { ...resolution },
                {
                    captureId: resolutionOptions.captureId,
                    repositoryGrantPlan,
                    runId: resolutionOptions.runId,
                    runner,
                },
            ),
        TypeError,
    );
    const otherProbe = await inspectLocalNativeJailBackend();
    const syntheticPlatform = createPlacementPlatformEvidence({
        environmentVariables: [],
        nodePlatform: probe.platform.node_platform,
        osRelease: probe.platform.os_release,
    });
    for (const invalid of [
        null,
        [],
        {},
        { ...resolutionOptions, extra: true },
        { ...resolutionOptions, placement: "advisory" },
        { ...resolutionOptions, captureId: "" },
        { ...resolutionOptions, captureId: "x".repeat(257) },
        { ...resolutionOptions, runId: "" },
        { ...resolutionOptions, platform: syntheticPlatform },
        { ...resolutionOptions, platform: otherProbe.platform },
        { ...resolutionOptions, repositoryGrantPlan: { ...repositoryGrantPlan } },
        { ...resolutionOptions, runner: { ...runner } },
    ]) {
        assert.throws(() => createNativeJailPlacementResolution(invalid as never), TypeError);
    }
    assert.throws(() => createNativeJailConfinementPlan({}, repositoryRoot, false), TypeError);
    await assert.rejects(
        launchNativeJailRunner(runner, { ...plan }, new AbortController().signal, {
            onIntent: () => undefined,
            onReceipt: () => undefined,
            onStarted: () => undefined,
        }),
        TypeError,
    );
    const validateJournal = validator.getSchema(schemas[9]?.$id as string);
    assert.ok(validateJournal);
    const preparedJournal = {
        base_revision_id: "world-revision:base",
        binding_id: binding.binding_id,
        capture_id: "capture:native-schema",
        capture_phase: "prepared",
        enforcement: "native-syscall-deny",
        journal_version: 12,
        max_capture_id_bytes: 256,
        max_text_bytes: 16777216,
        native_jail_resolution: resolution,
        native_jail_resolution_id: resolution.resolution_id,
        placement_resolution: null,
        placement_resolution_id: null,
        repository_grant_plan: repositoryGrantPlan,
        repository_grant_plan_id: repositoryGrantPlan.plan_id,
        run_id: "run:native-schema",
        runner_id: runner.runner_id,
    };
    assert.equal(
        validateJournal(preparedJournal),
        true,
        validator.errorsText(validateJournal.errors),
    );
    assert.equal(validateJournal({ ...preparedJournal, native_jail_resolution: null }), false);
    const intents: NativeJailLaunchIntent[] = [];
    const receipts: NativeJailLaunchReceipt[] = [];
    const starts: NativeJailProcessStarted[] = [];
    await launchNativeJailRunner(runner, plan, new AbortController().signal, {
        onIntent: (value) => {
            intents.push(value);
        },
        onReceipt: (value) => {
            receipts.push(value);
        },
        onStarted: (value) => {
            starts.push(value);
        },
    });
    const intent = intents[0];
    const receipt = receipts[0];
    const started = starts[0];
    assert.ok(intent);
    assert.ok(receipt);
    assert.ok(started);

    const evidence = [
        [schemas[2], registration.command, readNativeJailCommandEvidence],
        [schemas[3], plan, readNativeJailPlanEvidence],
        [schemas[5], intent, readNativeJailProcessEvidence],
        [schemas[5], started, readNativeJailProcessEvidence],
        [schemas[5], receipt, readNativeJailProcessEvidence],
        [schemas[6], resolution, readNativeJailResolutionEvidence],
    ] as const;
    for (const [schemaDocument, value, decoder] of evidence) {
        const validate = validator.getSchema(schemaDocument?.$id as string);
        assert.ok(validate);
        assert.equal(validate(value), true, validator.errorsText(validate.errors));
        assert.deepEqual(decoder(value), value);
        assert.equal(validate({ ...value, extra: true }), false);
    }
    for (const invalid of [
        { ...registration.command, command_id: "invalid" },
        { ...registration.command, command_version: 2 },
        { ...registration.command, arguments: {} },
        { ...registration.command, environment: {} },
        { ...registration.command, environment: [{ name: "INVALID-NAME", value: "x" }] },
        {
            ...registration.command,
            environment: [
                { name: "DUPLICATE", value: "x" },
                { name: "DUPLICATE", value: "y" },
            ],
        },
    ]) {
        assert.throws(() => readNativeJailCommandEvidence(invalid), TypeError);
    }
    for (const invalid of [
        { ...plan, plan_id: "invalid" },
        { ...plan, plan_version: 2 },
        { ...plan, profile_digest: "invalid" },
        { ...plan, writable_roots: [repositoryRoot, repositoryRoot] },
    ]) {
        assert.throws(() => readNativeJailPlanEvidence(invalid), TypeError);
    }
    for (const invalid of [
        { ...resolution, resolution_id: "invalid" },
        { ...resolution, requested_placement: "advisory" },
        { ...resolution, reason: "unknown" },
        { ...resolution, max_output_bytes: 0 },
        { ...resolution, resolved_placement: "advisory" },
        { ...resolution, repository_grant_plan_id: "invalid" },
        { ...resolution, timeout_milliseconds: 0 },
    ]) {
        assert.throws(() => readNativeJailResolutionEvidence(invalid), TypeError);
    }
    for (const invalid of [
        { ...intent, launch_id: "invalid" },
        { ...intent, plan_id: "invalid" },
        { ...started, process_id: 0 },
        { ...started, start_id: "invalid" },
        { ...receipt, receipt_id: "invalid" },
        { ...receipt, receipt_version: 2 },
        { ...receipt, stdout_base64: "!" },
        { ...receipt, stdout_base64: "eA==", stdout_bytes: 0 },
        { ...receipt, stdout_bytes: -1 },
        { ...receipt, status: "unknown" },
    ]) {
        assert.throws(() => readNativeJailProcessEvidence(invalid), TypeError);
    }
});

function testIdentity(domain: string, prefix: string, semantic: SemanticRecord): string {
    const digest = createRecordId({ [domain]: semantic });
    return `${prefix}${digest.slice(digest.lastIndexOf(":") + 1)}`;
}
