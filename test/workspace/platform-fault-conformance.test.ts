import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
    createGitAwareCustody,
    createReferenceCopyCarrier,
    createWorkspaceBindings,
    initializeWorkspace,
    inspectWorkspacePlatformConformance,
    WorkspaceCustodyFaultError,
} from "../../src/index.ts";
import { workspaceProtocolConfig } from "../../src/protocol/config.ts";
import {
    assertWorkspaceMetadataSupported,
    assertWorkspaceNamesPortable,
    injectWorkspaceCustodyFault,
    readWorkspaceCustodyFaultInjection,
} from "../../src/workspace/platform-conformance.ts";

test("workspace platform inspection publishes the configured fail-closed custody policy", async (context) => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "shepherd-platform-policy-"));
    context.after(() => rm(workspaceRoot, { force: true, recursive: true }));
    initializeWorkspace({ adopt: "none", initializeGit: false, rootPath: workspaceRoot });

    const inspection = inspectWorkspacePlatformConformance({ workspaceRoot });

    assert.equal(inspection.version, 19);
    assert.equal(inspection.platform, process.platform);
    assert.equal(inspection.metadata_policy, "reject-unsupported-before-publication");
    assert.deepEqual(inspection.unsupported_metadata, [
        "acl",
        "extended-attribute",
        "resource-fork",
        "alternate-data-stream",
    ]);
    assert.equal(inspection.case_collision_policy, "portable-case-fold-rejection");
    assert.equal(inspection.mode_policy, "preserve-portable-low-nine-bits");
    assert.equal(inspection.symlink_policy, "preserve-relative-target-or-reject");
    assert.equal(inspection.git.core_symlinks_false, "reject-worktree-placeholder");
    assert.equal(inspection.git.sparse_index, "preserve-index-evidence");
    assert.equal(inspection.git.gitlinks, "retain-external-commit-citation");
    assert.equal(inspection.optimized_carrier_parity, "reference-suite-required");
    assert.equal(Object.isFrozen(inspection), true);
    assert.equal(Object.isFrozen(inspection.git), true);
    assert.equal(Object.isFrozen(inspection.unsupported_metadata), true);

    for (const value of [null, [], {}, { workspaceRoot: "" }, { workspaceRoot, extra: true }]) {
        assert.throws(() => inspectWorkspacePlatformConformance(value as never), TypeError);
    }
});

test("platform fault helpers fail closed for malformed fixtures and unavailable paths", async (context) => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "shepherd-platform-helper-"));
    context.after(() => rm(workspaceRoot, { force: true, recursive: true }));
    const phase = workspaceProtocolConfig.platformConformance.faults.phases[0];
    assert.ok(phase);

    assertWorkspaceMetadataSupported([], phase.name);
    assert.throws(
        () => assertWorkspaceMetadataSupported([path.join(workspaceRoot, "missing")], phase.name),
        (error: unknown) =>
            error instanceof WorkspaceCustodyFaultError &&
            error.code === "WORKSPACE_CUSTODY_PLATFORM_UNSUPPORTED" &&
            error.evidence.system_code !== null,
    );
    assertWorkspaceMetadataSupported([workspaceRoot], phase.name, true);
    assert.throws(
        () => assertWorkspaceNamesPortable(["Case.txt", "case.txt"], phase.name),
        WorkspaceCustodyFaultError,
    );
    assert.throws(
        () => assertWorkspaceNamesPortable(["file", "file."], phase.name),
        WorkspaceCustodyFaultError,
    );
    assert.doesNotThrow(() => assertWorkspaceNamesPortable(["file:name", "other"], phase.name));
    assert.throws(
        () => assertWorkspaceNamesPortable(["Case.txt", "case.txt"], "unknown"),
        TypeError,
    );
    assert.equal(readWorkspaceCustodyFaultInjection(undefined), null);
    const accessor = Object.defineProperty({}, "classification", {
        enumerable: true,
        get: () => "permission",
    });
    const symbolic = {
        classification: "permission",
        phase: phase.name,
        systemCode: null,
        [Symbol("extra")]: true,
    };
    for (const malformed of [null, [], {}, { classification: "permission" }, accessor, symbolic]) {
        assert.throws(() => readWorkspaceCustodyFaultInjection(malformed), TypeError);
    }
    injectWorkspaceCustodyFault(null, phase.name);
    assert.throws(
        () =>
            injectWorkspaceCustodyFault(
                { classification: "unknown", phase: "unknown", systemCode: null },
                "unknown",
            ),
        TypeError,
    );
});

test("reference custody faults have stable classifications and recoverable publication state", async (context) => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "shepherd-platform-faults-"));
    context.after(() => rm(workspaceRoot, { force: true, recursive: true }));
    initializeWorkspace({ adopt: "none", initializeGit: false, rootPath: workspaceRoot });
    const sourceRoot = path.join(workspaceRoot, "source");
    await mkdir(sourceRoot);
    await writeFile(path.join(sourceRoot, "file.txt"), "source\n");
    const binding = createWorkspaceBindings({
        bindings: [{ name: "source", root: "source" }],
        workspaceRoot,
    }).bindings[0];
    assert.ok(binding);
    const carrierRoot = path.join(
        workspaceRoot,
        workspaceProtocolConfig.controlDirectory,
        workspaceProtocolConfig.carrier.carrierDirectory,
    );
    const revisionsRoot = path.join(
        carrierRoot,
        workspaceProtocolConfig.carrier.revisionsDirectory,
    );
    const stagingRoot = path.join(carrierRoot, workspaceProtocolConfig.carrier.stagingDirectory);
    const beforePublication = [
        {
            classification: "permission",
            code: "WORKSPACE_CUSTODY_PERMISSION_DENIED",
            phase: "snapshot-source-inspection",
            systemCode: "EACCES",
        },
        {
            classification: "capacity",
            code: "WORKSPACE_CUSTODY_CAPACITY_EXHAUSTED",
            phase: "snapshot-staging-write",
            systemCode: "ENOSPC",
        },
        {
            classification: "concurrent-mutation",
            code: "WORKSPACE_CUSTODY_CONCURRENT_MUTATION",
            phase: "snapshot-source-revalidation",
            systemCode: null,
        },
    ] as const;

    for (const expected of beforePublication) {
        const carrier = createReferenceCopyCarrier({
            faultInjection: {
                classification: expected.classification,
                phase: expected.phase,
                systemCode: expected.systemCode,
            },
            workspaceRoot,
        });
        await assert.rejects(
            carrier.snapshot(binding),
            (error: unknown) =>
                error instanceof WorkspaceCustodyFaultError &&
                error.code === expected.code &&
                error.evidence.classification === expected.classification &&
                error.evidence.phase === expected.phase &&
                error.evidence.recovery === "retry-safe" &&
                error.evidence.system_code === expected.systemCode &&
                error.evidence.version === 19,
        );
        assert.deepEqual(await readdir(revisionsRoot), []);
        assert.deepEqual(await readdir(stagingRoot), []);
    }

    const interrupted = createReferenceCopyCarrier({
        faultInjection: {
            classification: "interrupted",
            phase: "snapshot-post-publication",
            systemCode: "EINTR",
        },
        workspaceRoot,
    });
    await assert.rejects(
        interrupted.snapshot(binding),
        (error: unknown) =>
            error instanceof WorkspaceCustodyFaultError &&
            error.code === "WORKSPACE_CUSTODY_INTERRUPTED" &&
            error.evidence.phase === "snapshot-post-publication" &&
            error.evidence.recovery === "reopen-and-verify",
    );
    assert.equal((await readdir(revisionsRoot)).length, 1);
    assert.deepEqual(await readdir(stagingRoot), []);

    const recovered = await createReferenceCopyCarrier({ workspaceRoot }).snapshot(binding);
    assert.equal(recovered.manifest[0]?.path, "file.txt");
    assert.equal((await readdir(revisionsRoot)).length, 1);

    const normalCarrier = createReferenceCopyCarrier({ workspaceRoot });
    const custody = await normalCarrier.fork(recovered.revision_id);
    await writeFile(path.join(custody.path, "file.txt"), "captured\n");
    const captureInterrupted = createReferenceCopyCarrier({
        faultInjection: {
            classification: "interrupted",
            phase: "custody-capture-post-publication",
            systemCode: "EINTR",
        },
        workspaceRoot,
    });
    await assert.rejects(
        captureInterrupted.captureCustody(custody.custody_id),
        (error: unknown) =>
            error instanceof WorkspaceCustodyFaultError &&
            error.evidence.phase === "custody-capture-post-publication" &&
            error.evidence.recovery === "reopen-and-verify",
    );
    const captured = await normalCarrier.captureCustody(custody.custody_id);
    assert.equal(captured.manifest[0]?.blob_id !== recovered.manifest[0]?.blob_id, true);

    const discarded = await normalCarrier.fork(recovered.revision_id);
    const discardInterrupted = createReferenceCopyCarrier({
        faultInjection: {
            classification: "interrupted",
            phase: "custody-discard-cleanup",
            systemCode: "EINTR",
        },
        workspaceRoot,
    });
    await assert.rejects(
        discardInterrupted.discard(discarded.custody_id),
        (error: unknown) =>
            error instanceof WorkspaceCustodyFaultError &&
            error.evidence.phase === "custody-discard-cleanup" &&
            error.evidence.recovery === "reopen-and-verify",
    );
    await assert.rejects(normalCarrier.openCustody(discarded.custody_id));
    await normalCarrier.discard(discarded.custody_id);
});

test("Git custody rejects core.symlinks=false placeholders before publication", async (context) => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "shepherd-platform-git-symlink-"));
    context.after(() => rm(workspaceRoot, { force: true, recursive: true }));
    execFileSync("git", ["-C", workspaceRoot, "init"]);
    execFileSync("git", ["-C", workspaceRoot, "config", "user.email", "test@example.invalid"]);
    execFileSync("git", ["-C", workspaceRoot, "config", "user.name", "Shepherd Test"]);
    await writeFile(path.join(workspaceRoot, "target.txt"), "target\n");
    execFileSync("git", ["-C", workspaceRoot, "add", "target.txt"]);
    execFileSync("git", ["-C", workspaceRoot, "commit", "-m", "baseline"]);
    const objectId = execFileSync("git", ["-C", workspaceRoot, "hash-object", "-w", "--stdin"], {
        encoding: "utf8",
        input: "target.txt",
    }).trim();
    execFileSync("git", [
        "-C",
        workspaceRoot,
        "update-index",
        "--add",
        "--cacheinfo",
        "120000",
        objectId,
        "link.txt",
    ]);
    await writeFile(path.join(workspaceRoot, "link.txt"), "target.txt");
    execFileSync("git", ["-C", workspaceRoot, "config", "core.symlinks", "false"]);
    initializeWorkspace({ adopt: "worktree", rootPath: workspaceRoot });
    const binding = createWorkspaceBindings({
        bindings: [{ name: "source", root: "." }],
        workspaceRoot,
    }).bindings[0];
    assert.ok(binding);

    await assert.rejects(
        createGitAwareCustody({ workspaceRoot }).capture(binding),
        (error: unknown) =>
            error instanceof WorkspaceCustodyFaultError &&
            error.code === "WORKSPACE_CUSTODY_PLATFORM_UNSUPPORTED" &&
            error.evidence.phase === "git-materialization",
    );

    if (process.platform !== "win32") {
        await unlink(path.join(workspaceRoot, "link.txt"));
        await symlink("target.txt", path.join(workspaceRoot, "link.txt"));
        const retained = await createGitAwareCustody({ workspaceRoot }).capture(binding);
        assert.ok(retained);
        assert.equal(retained.basis.mode, "worktree");
    }
});

test("Git custody faults preserve precise errors and publish no custody receipt", async (context) => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "shepherd-platform-git-fault-"));
    context.after(() => rm(workspaceRoot, { force: true, recursive: true }));
    execFileSync("git", ["-C", workspaceRoot, "init"]);
    await writeFile(path.join(workspaceRoot, "tracked.txt"), "tracked\n");
    execFileSync("git", ["-C", workspaceRoot, "add", "tracked.txt"]);
    initializeWorkspace({ adopt: "worktree", rootPath: workspaceRoot });
    const binding = createWorkspaceBindings({
        bindings: [{ name: "source", root: "." }],
        workspaceRoot,
    }).bindings[0];
    assert.ok(binding);
    const custodyRoot = path.join(
        workspaceRoot,
        workspaceProtocolConfig.controlDirectory,
        workspaceProtocolConfig.carrier.carrierDirectory,
        workspaceProtocolConfig.carrier.custodiesDirectory,
    );

    await assert.rejects(
        createGitAwareCustody({
            faultInjection: {
                classification: "concurrent-mutation",
                phase: "git-basis-revalidation",
                systemCode: null,
            },
            workspaceRoot,
        }).capture(binding),
        (error: unknown) =>
            error instanceof WorkspaceCustodyFaultError &&
            error.code === "WORKSPACE_CUSTODY_CONCURRENT_MUTATION" &&
            error.evidence.phase === "git-basis-revalidation" &&
            error.evidence.recovery === "retry-safe",
    );
    assert.deepEqual(await readdir(custodyRoot), []);

    await assert.rejects(
        createGitAwareCustody({
            faultInjection: {
                classification: "interrupted",
                phase: "git-post-publication",
                systemCode: "EINTR",
            },
            workspaceRoot,
        }).capture(binding),
        (error: unknown) =>
            error instanceof WorkspaceCustodyFaultError &&
            error.code === "WORKSPACE_CUSTODY_INTERRUPTED" &&
            error.evidence.phase === "git-post-publication" &&
            error.evidence.recovery === "retry-safe",
    );
    assert.deepEqual(await readdir(custodyRoot), []);
    assert.ok(await createGitAwareCustody({ workspaceRoot }).capture(binding));
});

test("reference custody rejects portable case collisions before publication", async (context) => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "shepherd-platform-case-"));
    context.after(() => rm(workspaceRoot, { force: true, recursive: true }));
    initializeWorkspace({ adopt: "none", initializeGit: false, rootPath: workspaceRoot });
    const sourceRoot = path.join(workspaceRoot, "source");
    await mkdir(sourceRoot);
    await writeFile(path.join(sourceRoot, "Case.txt"), "upper\n");
    await writeFile(path.join(sourceRoot, "case.txt"), "lower\n");
    if ((await readdir(sourceRoot)).length < 2) return;
    const binding = createWorkspaceBindings({
        bindings: [{ name: "source", root: "source" }],
        workspaceRoot,
    }).bindings[0];
    assert.ok(binding);

    await assert.rejects(
        createReferenceCopyCarrier({ workspaceRoot }).snapshot(binding),
        (error: unknown) =>
            error instanceof WorkspaceCustodyFaultError &&
            error.code === "WORKSPACE_CUSTODY_PLATFORM_UNSUPPORTED" &&
            error.evidence.classification === "platform-unsupported" &&
            error.evidence.phase === "snapshot-source-inspection",
    );
});

test("reference custody rejects host metadata that the portable manifest cannot preserve", async (context) => {
    for (const metadata of unsupportedMetadataCases()) {
        const workspaceRoot = await mkdtemp(
            path.join(tmpdir(), `shepherd-platform-metadata-${metadata.kind}-`),
        );
        context.after(() => rm(workspaceRoot, { force: true, recursive: true }));
        initializeWorkspace({ adopt: "none", initializeGit: false, rootPath: workspaceRoot });
        const sourceRoot = path.join(workspaceRoot, "source");
        await mkdir(sourceRoot);
        const metadataPath = path.join(sourceRoot, "metadata.txt");
        await writeFile(metadataPath, "metadata\n");
        metadata.apply(metadataPath);
        const binding = createWorkspaceBindings({
            bindings: [{ name: "source", root: "source" }],
            workspaceRoot,
        }).bindings[0];
        assert.ok(binding);

        let fault: unknown;
        try {
            await createReferenceCopyCarrier({ workspaceRoot }).snapshot(binding);
        } catch (error) {
            fault = error;
        }
        assert.ok(fault instanceof WorkspaceCustodyFaultError);
        assert.equal(fault.code, "WORKSPACE_CUSTODY_UNSUPPORTED_METADATA");
        assert.equal(fault.evidence.classification, "unsupported-metadata");
        assert.equal(fault.evidence.metadata_kind, metadata.kind);
        assert.equal(fault.evidence.phase, "snapshot-source-inspection");
        assert.equal(fault.evidence.recovery, "retry-safe");
    }
});

test("Git worktree custody rejects unsupported metadata before materialization", async (context) => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "shepherd-platform-git-metadata-"));
    context.after(() => rm(workspaceRoot, { force: true, recursive: true }));
    execFileSync("git", ["-C", workspaceRoot, "init"]);
    const metadataPath = path.join(workspaceRoot, "tracked.txt");
    await writeFile(metadataPath, "tracked\n");
    execFileSync("git", ["-C", workspaceRoot, "add", "tracked.txt"]);
    const metadata = unsupportedMetadataCases()[0];
    assert.ok(metadata);
    metadata.apply(metadataPath);
    initializeWorkspace({ adopt: "worktree", rootPath: workspaceRoot });
    const binding = createWorkspaceBindings({
        bindings: [{ name: "source", root: "." }],
        workspaceRoot,
    }).bindings[0];
    assert.ok(binding);

    await assert.rejects(
        createGitAwareCustody({ workspaceRoot }).capture(binding),
        (error: unknown) =>
            error instanceof WorkspaceCustodyFaultError &&
            error.code === "WORKSPACE_CUSTODY_UNSUPPORTED_METADATA" &&
            error.evidence.phase === "git-materialization",
    );
});

function unsupportedMetadataCases(): readonly Readonly<{
    apply: (file: string) => void;
    kind: string;
}>[] {
    if (process.platform === "darwin") {
        return [
            {
                apply: (file) =>
                    execFileSync("xattr", ["-w", "user.shepherd-test", "present", file]),
                kind: "extended-attribute",
            },
            {
                apply: (file) =>
                    execFileSync("xattr", ["-w", "com.apple.ResourceFork", "present", file]),
                kind: "resource-fork",
            },
            {
                apply: (file) =>
                    execFileSync("chmod", [
                        "+a",
                        `${process.env.USER ?? "nobody"} allow read`,
                        file,
                    ]),
                kind: "acl",
            },
        ];
    }
    if (process.platform === "linux") {
        return [
            {
                apply: (file) =>
                    execFileSync("setfattr", ["-n", "user.shepherd-test", "-v", "present", file]),
                kind: "extended-attribute",
            },
            {
                apply: (file) => execFileSync("setfacl", ["-m", "u:65534:r", file]),
                kind: "acl",
            },
        ];
    }
    return [
        {
            apply: (file) =>
                execFileSync("powershell.exe", [
                    "-NoProfile",
                    "-NonInteractive",
                    "-Command",
                    "Set-Content -LiteralPath ($args[0] + ':shepherd-test') -Value 'present'",
                    file,
                ]),
            kind: "alternate-data-stream",
        },
        {
            apply: (file) =>
                execFileSync("powershell.exe", [
                    "-NoProfile",
                    "-NonInteractive",
                    "-Command",
                    "$acl=Get-Acl -LiteralPath $args[0]; $rule=New-Object System.Security.AccessControl.FileSystemAccessRule($env:USERNAME,'Read','Allow'); $acl.AddAccessRule($rule); Set-Acl -LiteralPath $args[0] -AclObject $acl",
                    file,
                ]),
            kind: "acl",
        },
    ];
}
