import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
    createGitAwareCustody,
    createReferenceCopyCarrier,
    createWorkspaceBindings,
    initializeWorkspace,
    inspectWorkspacePathProtection,
    WorkspaceProtectedPathError,
} from "../../src/index.ts";
import { workspaceProtocolConfig } from "../../src/protocol/config.ts";

test("protected workspace paths use one versioned fail-closed normalization contract", async (context) => {
    const workspaceRoot = await temporaryDirectory(context, "matrix");
    initializeWorkspace({ adopt: "none", initializeGit: false, rootPath: workspaceRoot });
    const configuredRoot = workspaceProtocolConfig.protectedPaths.roots[0];
    assert.ok(configuredRoot);

    const ordinary = inspectWorkspacePathProtection({
        bindingRoot: workspaceRoot,
        path: "src/index.ts",
        workspaceRoot,
    });
    assert.equal(ordinary.protected, false);
    assert.equal(ordinary.protected_root, null);
    assert.equal(ordinary.validation_version, workspaceProtocolConfig.protectedPaths.version);

    for (const candidate of [
        configuredRoot,
        `${configuredRoot}/workspace.json`,
        configuredRoot.toUpperCase(),
        `src/${configuredRoot.toUpperCase()}/workspace.json`,
        `${configuredRoot}.`,
        `${configuredRoot}:alternate`,
    ]) {
        const result = inspectWorkspacePathProtection({
            bindingRoot: workspaceRoot,
            path: candidate,
            workspaceRoot,
        });
        assert.equal(result.protected, true, candidate);
        assert.equal(result.protected_root, configuredRoot, candidate);
        assert.equal(result.validation_version, workspaceProtocolConfig.protectedPaths.version);
    }

    if (process.platform !== "win32") {
        await symlink(configuredRoot, path.join(workspaceRoot, "control-alias"));
        const alias = inspectWorkspacePathProtection({
            bindingRoot: workspaceRoot,
            path: "control-alias/workspace.json",
            workspaceRoot,
        });
        assert.equal(alias.protected, true);
        assert.equal(alias.protected_root, configuredRoot);
    }
});

test("protected workspace path inspection rejects malformed or escaped authority", async (context) => {
    const workspaceRoot = await temporaryDirectory(context, "validation");
    const outsideRoot = await temporaryDirectory(context, "outside");
    initializeWorkspace({ adopt: "none", initializeGit: false, rootPath: workspaceRoot });
    const valid = { bindingRoot: workspaceRoot, path: "ordinary.txt", workspaceRoot };

    for (const invalid of [null, "invalid", [], new Date()]) {
        assert.throws(() => inspectWorkspacePathProtection(invalid as never), TypeError);
    }
    assert.throws(
        () =>
            inspectWorkspacePathProtection({
                ...valid,
                [Symbol("unexpected")]: true,
            } as never),
        TypeError,
    );
    assert.throws(
        () => inspectWorkspacePathProtection({ path: valid.path, workspaceRoot } as never),
        TypeError,
    );
    assert.throws(
        () => inspectWorkspacePathProtection({ ...valid, extra: true } as never),
        TypeError,
    );
    const accessor = { ...valid };
    Object.defineProperty(accessor, "path", { get: () => "ordinary.txt" });
    assert.throws(() => inspectWorkspacePathProtection(accessor), TypeError);
    for (const invalid of [
        { ...valid, bindingRoot: 1 },
        { ...valid, path: 1 },
        { ...valid, workspaceRoot: 1 },
    ]) {
        assert.throws(() => inspectWorkspacePathProtection(invalid as never), TypeError);
    }
    assert.throws(
        () => inspectWorkspacePathProtection({ ...valid, bindingRoot: outsideRoot }),
        TypeError,
    );
    assert.throws(() => inspectWorkspacePathProtection({ ...valid, bindingRoot: "" }), TypeError);
    assert.throws(() => inspectWorkspacePathProtection({ ...valid, workspaceRoot: "" }), TypeError);
    const ordinaryFile = path.join(workspaceRoot, "ordinary.txt");
    await writeFile(ordinaryFile, "ordinary\n");
    assert.throws(
        () => inspectWorkspacePathProtection({ ...valid, bindingRoot: ordinaryFile }),
        TypeError,
    );
    assert.throws(
        () => inspectWorkspacePathProtection({ ...valid, workspaceRoot: ordinaryFile }),
        TypeError,
    );
    for (const invalidPath of [
        "",
        "bad\\path",
        "bad\0path",
        "bad\uD800path",
        "a//b",
        "./a",
        "../a",
    ]) {
        assert.throws(
            () => inspectWorkspacePathProtection({ ...valid, path: invalidPath }),
            TypeError,
        );
    }

    const nullPrototype = Object.assign(Object.create(null) as Record<string, unknown>, valid);
    assert.equal(inspectWorkspacePathProtection(nullPrototype as never).protected, false);
    if (process.platform !== "win32") {
        await symlink(outsideRoot, path.join(workspaceRoot, "outside-alias"));
        await symlink(".", path.join(workspaceRoot, "workspace-alias"));
        assert.equal(
            inspectWorkspacePathProtection({ ...valid, path: "outside-alias/file.txt" }).protected,
            false,
        );
        assert.equal(
            inspectWorkspacePathProtection({ ...valid, path: "workspace-alias" }).protected,
            false,
        );
    }
});

test("Git custody rejects a protected alias before managed-world materialization", async (context) => {
    if (process.platform === "win32") return;
    const workspaceRoot = await temporaryDirectory(context, "git");
    initializeWorkspace({ adopt: "worktree", initializeGit: true, rootPath: workspaceRoot });
    await writeFile(path.join(workspaceRoot, "ordinary.txt"), "ordinary\n");
    await symlink(
        workspaceProtocolConfig.controlDirectory,
        path.join(workspaceRoot, "control-alias"),
    );
    const binding = createWorkspaceBindings({
        bindings: [{ name: "workspace", root: "." }],
        workspaceRoot,
    }).bindings[0];
    assert.ok(binding);

    await assert.rejects(
        createGitAwareCustody({ workspaceRoot }).capture(binding),
        (error: unknown) =>
            error instanceof WorkspaceProtectedPathError &&
            error.code === workspaceProtocolConfig.protectedPaths.errorCode,
    );
    assert.equal(await readFile(path.join(workspaceRoot, "ordinary.txt"), "utf8"), "ordinary\n");
});

test("reference capture rejects a protected alias before publishing custody", async (context) => {
    const workspaceRoot = await temporaryDirectory(context, "capture");
    initializeWorkspace({ adopt: "none", initializeGit: false, rootPath: workspaceRoot });
    await writeFile(path.join(workspaceRoot, "ordinary.txt"), "ordinary\n");
    const binding = createWorkspaceBindings({
        bindings: [{ name: "workspace", root: "." }],
        workspaceRoot,
    }).bindings[0];
    assert.ok(binding);
    const carrier = createReferenceCopyCarrier({ workspaceRoot });
    const controlManifest = path.join(
        workspaceRoot,
        workspaceProtocolConfig.controlDirectory,
        workspaceProtocolConfig.manifestFile,
    );
    const manifestBefore = await readFile(controlManifest, "utf8");
    if (process.platform === "win32") return;
    const alias = "control-alias";
    await symlink(workspaceProtocolConfig.controlDirectory, path.join(workspaceRoot, alias));

    await assert.rejects(
        carrier.snapshot(binding),
        (error: unknown) =>
            error instanceof WorkspaceProtectedPathError &&
            error.code === workspaceProtocolConfig.protectedPaths.errorCode &&
            error.validation.validation_version === workspaceProtocolConfig.protectedPaths.version,
    );
    assert.equal(await readFile(controlManifest, "utf8"), manifestBefore);
    assert.equal(await readFile(path.join(workspaceRoot, "ordinary.txt"), "utf8"), "ordinary\n");
});

test("discard preserves its durable marker until protected cleanup can be verified", async (context) => {
    const workspaceRoot = await temporaryDirectory(context, "discard");
    initializeWorkspace({ adopt: "none", initializeGit: false, rootPath: workspaceRoot });
    const sourceRoot = path.join(workspaceRoot, "source");
    await mkdir(sourceRoot);
    await writeFile(path.join(sourceRoot, "ordinary.txt"), "ordinary\n");
    const binding = createWorkspaceBindings({
        bindings: [{ name: "source", root: "source" }],
        workspaceRoot,
    }).bindings[0];
    assert.ok(binding);
    const carrier = createReferenceCopyCarrier({ workspaceRoot });
    const custody = await carrier.fork((await carrier.snapshot(binding)).revision_id);
    const protectedPath = path.join(
        custody.path,
        workspaceProtocolConfig.controlDirectory.toUpperCase(),
    );
    await mkdir(protectedPath);

    await assert.rejects(carrier.discard(custody.custody_id), WorkspaceProtectedPathError);
    const marker = path.join(
        workspaceRoot,
        workspaceProtocolConfig.controlDirectory,
        workspaceProtocolConfig.carrier.carrierDirectory,
        workspaceProtocolConfig.carrier.discardedDirectory,
        `${custody.custody_id.slice(workspaceProtocolConfig.carrier.custodyIdPrefix.length)}${workspaceProtocolConfig.carrier.discardDescriptorSuffix}`,
    );
    assert.equal((await readFile(marker, "utf8")).includes(custody.custody_id), true);
    await rm(protectedPath, { recursive: true });
    await carrier.discard(custody.custody_id);
});

async function temporaryDirectory(
    context: { after: (callback: () => Promise<void>) => void },
    name: string,
): Promise<string> {
    const root = await mkdtemp(path.join(tmpdir(), `shepherd-protected-path-${name}-`));
    context.after(() => rm(root, { force: true, recursive: true }));
    return root;
}
