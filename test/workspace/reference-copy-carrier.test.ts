import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
    chmod,
    link,
    mkdir,
    mkdtemp,
    open,
    readdir,
    readFile,
    rename,
    rm,
    stat,
    symlink,
    writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
    createReferenceCopyCarrier,
    createWorkspaceBindings,
    initializeWorkspace,
    WorldCarrierError,
} from "../../src/index.ts";
import { workspaceProtocolConfig } from "../../src/protocol/config.ts";

test("reference copy carrier snapshots, reopens, forks, verifies, and discards retained custody", async (context) => {
    const workspaceRoot = await temporaryDirectory(context, "lifecycle");
    initializeWorkspace({ adopt: "none", initializeGit: false, rootPath: workspaceRoot });
    const sourceRoot = path.join(workspaceRoot, "source");
    await mkdir(path.join(sourceRoot, "empty"), { recursive: true });
    await mkdir(path.join(sourceRoot, "nested"));
    await writeFile(path.join(sourceRoot, "nested", "child.txt"), "child\n");
    await writeFile(path.join(sourceRoot, "text.txt"), "source\n");
    await writeFile(path.join(sourceRoot, "binary.bin"), Uint8Array.from([0, 255, 17, 0]));
    await writeFile(path.join(sourceRoot, "ünicode.txt"), "ok\n");
    await writeFile(path.join(sourceRoot, "world-🌍.txt"), "astral\n");
    await chmod(path.join(sourceRoot, "text.txt"), 0o777);
    await symlink("text.txt", path.join(sourceRoot, "link"));
    await symlink("missing.txt", path.join(sourceRoot, "broken"));
    const binding = createWorkspaceBindings({
        bindings: [{ name: "source", root: "source" }],
        workspaceRoot,
    }).bindings[0];
    assert.ok(binding);

    const carrier = createReferenceCopyCarrier({ workspaceRoot });
    const revision = await carrier.snapshot(binding);
    const verification = await carrier.verifyRevision(revision.revision_id);
    assert.equal(verification.content_id, revision.content_id);
    assert.equal(verification.modified, false);

    const reopened = createReferenceCopyCarrier({ workspaceRoot });
    assert.deepEqual(await reopened.openRevision(revision.revision_id), revision);
    const custody = await reopened.fork(revision.revision_id);
    assert.equal(custody.base_content_id, revision.content_id);
    assert.notEqual(custody.custody_id, revision.revision_id);
    assert.equal(await readFile(path.join(custody.path, "text.txt"), "utf8"), "source\n");
    if (process.platform !== "win32") {
        assert.equal((await stat(path.join(revision.path, "text.txt"))).mode & 0o777, 0o777);
    } else {
        assert.equal(
            revision.manifest.find((entry) => entry.path === "text.txt")?.mode,
            (await stat(path.join(sourceRoot, "text.txt"))).mode & 0o777,
        );
    }

    await writeFile(path.join(custody.path, "text.txt"), "retained change\n");
    const custodyVerification = await reopened.verifyCustody(custody.custody_id);
    assert.equal(custodyVerification.modified, true);
    assert.notEqual(custodyVerification.content_id, revision.content_id);
    assert.equal(await readFile(path.join(sourceRoot, "text.txt"), "utf8"), "source\n");
    assert.equal((await reopened.verifyRevision(revision.revision_id)).modified, false);

    await reopened.discard(custody.custody_id);
    await reopened.discard(custody.custody_id);
    await assert.rejects(reopened.openCustody(custody.custody_id), WorldCarrierError);
    assert.equal(
        (await reopened.verifyRevision(revision.revision_id)).content_id,
        revision.content_id,
    );
    const movedSourceRoot = path.join(workspaceRoot, "source-moved");
    await rename(sourceRoot, movedSourceRoot);
    await assert.rejects(reopened.verifyRevision(revision.revision_id), WorldCarrierError);
    await rename(movedSourceRoot, sourceRoot);
    const discardedMarker = path.join(
        workspaceRoot,
        ".vcscore",
        workspaceProtocolConfig.carrier.carrierDirectory,
        workspaceProtocolConfig.carrier.discardedDirectory,
        `${custody.custody_id.slice(workspaceProtocolConfig.carrier.custodyIdPrefix.length)}${workspaceProtocolConfig.carrier.discardDescriptorSuffix}`,
    );
    await writeFile(discardedMarker, "partial\n");
    await assert.rejects(reopened.discard(custody.custody_id), WorldCarrierError);
});

test("reference copy carrier is deterministic and protects the exact workspace control root", async (context) => {
    const workspaceRoot = await temporaryDirectory(context, "deterministic");
    initializeWorkspace({ adopt: "none", initializeGit: false, rootPath: workspaceRoot });
    await writeFile(path.join(workspaceRoot, "ordinary.txt"), "ordinary\n");
    const binding = createWorkspaceBindings({
        bindings: [{ name: "workspace", root: "." }],
        workspaceRoot,
    }).bindings[0];
    assert.ok(binding);
    const carrier = createReferenceCopyCarrier({ workspaceRoot });

    const first = await carrier.snapshot(binding);
    const second = await carrier.snapshot(binding);
    assert.equal(second.revision_id, first.revision_id);
    assert.equal(second.content_id, first.content_id);
    assert.equal(
        first.manifest.some((entry) => entry.path === ".vcscore"),
        false,
    );
    assert.equal(await readFile(path.join(workspaceRoot, "ordinary.txt"), "utf8"), "ordinary\n");
    assert.equal(Object.isFrozen(first), true);
    assert.equal(Object.isFrozen(first.manifest), true);

    const descriptorPath = path.join(
        path.dirname(first.path),
        workspaceProtocolConfig.carrier.revisionDescriptorFile,
    );
    const descriptor = JSON.parse(await readFile(descriptorPath, "utf8")) as Record<
        string,
        unknown
    >;
    descriptor.binding_name = "conflicting-name";
    await writeFile(descriptorPath, `${JSON.stringify(descriptor)}\n`);
    await assert.rejects(
        carrier.snapshot(binding),
        (error: unknown) =>
            error instanceof WorldCarrierError &&
            error.code === workspaceProtocolConfig.carrier.errors.conflictCode,
    );
});

test("reference copy carrier captures empty, long, sparse, chained, and non-dereferenced loop entries", async (context) => {
    const workspaceRoot = await temporaryDirectory(context, "portable-tree");
    initializeWorkspace({ adopt: "none", initializeGit: false, rootPath: workspaceRoot });
    const sourceRoot = path.join(workspaceRoot, "source");
    await mkdir(sourceRoot);
    const binding = createWorkspaceBindings({
        bindings: [{ name: "source", root: "source" }],
        workspaceRoot,
    }).bindings[0];
    assert.ok(binding);
    const carrier = createReferenceCopyCarrier({ workspaceRoot });
    assert.deepEqual((await carrier.snapshot(binding)).manifest, []);

    const longName = `${"long-".repeat(30)}file.txt`;
    await writeFile(path.join(sourceRoot, longName), "long\n");
    const sparse = await open(path.join(sourceRoot, "sparse.bin"), "w");
    await sparse.write(Uint8Array.of(1), 0, 1, 1_000_000);
    await sparse.close();
    await symlink(longName, path.join(sourceRoot, "chain-b"));
    await symlink("chain-b", path.join(sourceRoot, "chain-a"));
    await symlink("loop-b", path.join(sourceRoot, "loop-a"));
    await symlink("loop-a", path.join(sourceRoot, "loop-b"));
    if (process.platform !== "win32") {
        await mkdir(path.join(sourceRoot, "read-only"));
        await writeFile(path.join(sourceRoot, "read-only", "child.txt"), "child\n");
        await chmod(path.join(sourceRoot, "read-only"), 0o555);
    }
    const revision = await carrier.snapshot(binding);
    assert.equal(
        revision.manifest.some((entry) => entry.path === longName),
        true,
    );
    assert.equal(revision.manifest.find((entry) => entry.path === "sparse.bin")?.size, 1_000_001);
    assert.equal((await carrier.verifyRevision(revision.revision_id)).modified, false);
    if (process.platform !== "win32") {
        await chmod(path.join(sourceRoot, "read-only"), 0o755);
        await chmod(path.join(revision.path, "read-only"), 0o755);
    }
    const composedName = "é.txt";
    const decomposedName = "é.txt";
    await writeFile(path.join(sourceRoot, composedName), "composed\n");
    await writeFile(path.join(sourceRoot, decomposedName), "decomposed\n");
    const equivalentNames = (await readdir(sourceRoot)).filter(
        (name) => name.normalize("NFC") === composedName,
    );
    if (equivalentNames.length > 1) {
        await assert.rejects(carrier.snapshot(binding), WorldCarrierError);
    } else {
        assert.equal(equivalentNames.length, 1);
    }
});

test("reference copy carrier rejects unsafe sources and forged bindings without publication", async (context) => {
    const workspaceRoot = await temporaryDirectory(context, "unsafe");
    initializeWorkspace({ adopt: "none", initializeGit: false, rootPath: workspaceRoot });
    const sourceRoot = path.join(workspaceRoot, "source");
    await mkdir(sourceRoot);
    await writeFile(path.join(sourceRoot, "hard-a"), "same inode\n");
    await link(path.join(sourceRoot, "hard-a"), path.join(sourceRoot, "hard-b"));
    const binding = createWorkspaceBindings({
        bindings: [{ name: "source", root: "source" }],
        workspaceRoot,
    }).bindings[0];
    assert.ok(binding);
    const carrier = createReferenceCopyCarrier({ workspaceRoot });

    await assert.rejects(
        carrier.snapshot(binding),
        (error: unknown) =>
            error instanceof WorldCarrierError &&
            error.code === workspaceProtocolConfig.carrier.errors.unsupportedCode,
    );
    await rm(path.join(sourceRoot, "hard-b"));
    await rm(path.join(sourceRoot, "hard-a"));
    await symlink("../outside", path.join(sourceRoot, "escape"));
    await assert.rejects(carrier.snapshot(binding), WorldCarrierError);
    await rm(path.join(sourceRoot, "escape"));
    await symlink(path.join(workspaceRoot, ".vcscore"), path.join(sourceRoot, "absolute"));
    await assert.rejects(carrier.snapshot(binding), WorldCarrierError);

    await assert.rejects(
        carrier.snapshot({ ...binding, binding_id: "sha256:forged" }),
        WorldCarrierError,
    );
    await assert.rejects(carrier.snapshot(null as never), WorldCarrierError);
    const controlBinding = createWorkspaceBindings({
        bindings: [{ name: "control", root: ".vcscore" }],
        workspaceRoot,
    }).bindings[0];
    assert.ok(controlBinding);
    await assert.rejects(carrier.snapshot(controlBinding), WorldCarrierError);

    if (process.platform !== "win32") {
        await writeFile(path.join(sourceRoot, "bad\\name"), "bad\n");
        await assert.rejects(carrier.snapshot(binding), WorldCarrierError);
        await rm(path.join(sourceRoot, "bad\\name"));
        await symlink("bad\\target", path.join(sourceRoot, "bad-target"));
        await assert.rejects(carrier.snapshot(binding), WorldCarrierError);
    }
    await assert.rejects(carrier.openRevision("wrong"), WorldCarrierError);
    await assert.rejects(carrier.openCustody("wrong"), WorldCarrierError);
});

test("reference copy carrier fails closed when immutable or custody evidence is corrupted", async (context) => {
    const workspaceRoot = await temporaryDirectory(context, "corrupt");
    initializeWorkspace({ adopt: "none", initializeGit: false, rootPath: workspaceRoot });
    const sourceRoot = path.join(workspaceRoot, "source");
    await mkdir(sourceRoot);
    await writeFile(path.join(sourceRoot, "file.txt"), "original\n");
    await writeFile(path.join(sourceRoot, "second.txt"), "second\n");
    const binding = createWorkspaceBindings({
        bindings: [{ name: "source", root: "source" }],
        workspaceRoot,
    }).bindings[0];
    assert.ok(binding);
    const carrier = createReferenceCopyCarrier({ workspaceRoot });
    const revision = await carrier.snapshot(binding);
    const custody = await carrier.fork(revision.revision_id);

    await writeFile(path.join(revision.path, "file.txt"), "corrupt\n");
    await assert.rejects(carrier.openRevision(revision.revision_id), WorldCarrierError);
    await assert.rejects(carrier.verifyRevision(revision.revision_id), WorldCarrierError);
    await assert.rejects(carrier.fork(revision.revision_id), WorldCarrierError);

    const custodyDescriptor = path.join(
        path.dirname(custody.path),
        workspaceProtocolConfig.carrier.custodyDescriptorFile,
    );
    await writeFile(custodyDescriptor, "not json\n");
    await assert.rejects(carrier.openCustody(custody.custody_id), WorldCarrierError);
    await assert.rejects(carrier.discard(custody.custody_id), WorldCarrierError);
});

test("reference copy carrier validates its closed option boundary", async (context) => {
    const workspaceRoot = await temporaryDirectory(context, "options");
    initializeWorkspace({ adopt: "none", initializeGit: false, rootPath: workspaceRoot });
    const symbolOptions = { workspaceRoot };
    Object.defineProperty(symbolOptions, Symbol("extra"), { value: true });
    const accessorOptions = Object.defineProperty({}, "workspaceRoot", {
        enumerable: true,
        get: () => workspaceRoot,
    });
    for (const value of [
        null,
        [],
        new Date(),
        {},
        { workspaceRoot, extra: true },
        { workspaceRoot: "" },
        { workspaceRoot: 1 },
        symbolOptions,
        accessorOptions,
    ]) {
        assert.throws(() => createReferenceCopyCarrier(value as never), TypeError);
    }
});

test("reference copy carrier rejects special files and unsafe carrier roots", async (context) => {
    const workspaceRoot = await temporaryDirectory(context, "special");
    initializeWorkspace({ adopt: "none", initializeGit: false, rootPath: workspaceRoot });
    const sourceRoot = path.join(workspaceRoot, "source");
    await mkdir(sourceRoot);
    const filePath = path.join(sourceRoot, "special-mode");
    await writeFile(filePath, "mode\n");
    const binding = createWorkspaceBindings({
        bindings: [{ name: "source", root: "source" }],
        workspaceRoot,
    }).bindings[0];
    assert.ok(binding);
    const carrier = createReferenceCopyCarrier({ workspaceRoot });
    if (process.platform !== "win32") {
        const fifoPath = path.join(sourceRoot, "fifo");
        execFileSync("mkfifo", [fifoPath]);
        await assert.rejects(carrier.snapshot(binding), WorldCarrierError);
        await rm(fifoPath);
    }

    const aliasWorkspace = await temporaryDirectory(context, "carrier-alias");
    initializeWorkspace({ adopt: "none", initializeGit: false, rootPath: aliasWorkspace });
    const outside = await temporaryDirectory(context, "carrier-outside");
    await symlink(outside, path.join(aliasWorkspace, ".vcscore", "worlds"));
    assert.throws(
        () => createReferenceCopyCarrier({ workspaceRoot: aliasWorkspace }),
        WorldCarrierError,
    );
});

test("reference copy carrier rejects substituted descriptors and symlinked discard targets", async (context) => {
    const workspaceRoot = await temporaryDirectory(context, "substitution");
    initializeWorkspace({ adopt: "none", initializeGit: false, rootPath: workspaceRoot });
    const sourceRoot = path.join(workspaceRoot, "source");
    await mkdir(sourceRoot);
    await writeFile(path.join(sourceRoot, "file.txt"), "original\n");
    await writeFile(path.join(sourceRoot, "second.txt"), "second\n");
    const binding = createWorkspaceBindings({
        bindings: [{ name: "source", root: "source" }],
        workspaceRoot,
    }).bindings[0];
    assert.ok(binding);
    const carrier = createReferenceCopyCarrier({ workspaceRoot });

    const revision = await carrier.snapshot(binding);
    const revisionDescriptorPath = path.join(
        path.dirname(revision.path),
        workspaceProtocolConfig.carrier.revisionDescriptorFile,
    );
    const descriptor = JSON.parse(await readFile(revisionDescriptorPath, "utf8")) as Record<
        string,
        unknown
    >;
    await writeFile(
        revisionDescriptorPath,
        `${JSON.stringify({ ...descriptor, revision_id: `${revision.revision_id}f` })}\n`,
    );
    await assert.rejects(carrier.openRevision(revision.revision_id), WorldCarrierError);
    await writeFile(
        revisionDescriptorPath,
        `${JSON.stringify({ ...descriptor, content_id: "world-content:sha256:forged" })}\n`,
    );
    await assert.rejects(carrier.verifyRevision(revision.revision_id), WorldCarrierError);
    await writeFile(
        revisionDescriptorPath,
        `${JSON.stringify({ ...descriptor, basis_ref: "worktree:sha256:forged" })}\n`,
    );
    await assert.rejects(carrier.openRevision(revision.revision_id), WorldCarrierError);
    await writeFile(revisionDescriptorPath, `${JSON.stringify(descriptor)}\n`);
    const manifest = descriptor.manifest as Record<string, unknown>[];
    await writeFile(
        revisionDescriptorPath,
        `${JSON.stringify({ ...descriptor, manifest: [{ ...manifest[0], mode: "bad" }] })}\n`,
    );
    await assert.rejects(carrier.openRevision(revision.revision_id), WorldCarrierError);
    await writeFile(
        revisionDescriptorPath,
        `${JSON.stringify({ ...descriptor, manifest: [...manifest].reverse() })}\n`,
    );
    await assert.rejects(carrier.openRevision(revision.revision_id), WorldCarrierError);
    await writeFile(revisionDescriptorPath, `${JSON.stringify(descriptor)}\n`);

    const revisionRoot = path.dirname(revision.path);
    const retainedRevisionRoot = `${revisionRoot}-retained`;
    await rename(revisionRoot, retainedRevisionRoot);
    await symlink(retainedRevisionRoot, revisionRoot);
    await assert.rejects(carrier.openRevision(revision.revision_id), WorldCarrierError);
    await rm(revisionRoot);
    await rename(retainedRevisionRoot, revisionRoot);

    const custody = await carrier.fork(revision.revision_id);
    const custodyRoot = path.dirname(custody.path);
    const custodyDescriptorPath = path.join(
        custodyRoot,
        workspaceProtocolConfig.carrier.custodyDescriptorFile,
    );
    const custodyDescriptor = JSON.parse(await readFile(custodyDescriptorPath, "utf8")) as Record<
        string,
        unknown
    >;
    await writeFile(
        custodyDescriptorPath,
        `${JSON.stringify({ ...custodyDescriptor, custody_id: `${custody.custody_id}f` })}\n`,
    );
    await assert.rejects(carrier.openCustody(custody.custody_id), WorldCarrierError);
    await writeFile(custodyDescriptorPath, `${JSON.stringify(custodyDescriptor)}\n`);
    await writeFile(
        custodyDescriptorPath,
        `${JSON.stringify({ ...custodyDescriptor, base_content_id: "world-content:sha256:forged" })}\n`,
    );
    await assert.rejects(carrier.openCustody(custody.custody_id), WorldCarrierError);
    await writeFile(custodyDescriptorPath, `${JSON.stringify(custodyDescriptor)}\n`);
    const retainedCustodyRoot = `${custodyRoot}-retained`;
    await rename(custodyRoot, retainedCustodyRoot);
    await symlink(retainedCustodyRoot, custodyRoot);
    await assert.rejects(carrier.openCustody(custody.custody_id), WorldCarrierError);
    await rm(custodyRoot);
    await rename(retainedCustodyRoot, custodyRoot);
    await carrier.discard(custody.custody_id);
    const outside = await temporaryDirectory(context, "discard-outside");
    await writeFile(path.join(outside, "preserved"), "yes\n");
    await symlink(outside, custodyRoot);
    await assert.rejects(carrier.discard(custody.custody_id), WorldCarrierError);
    assert.equal(await readFile(path.join(outside, "preserved"), "utf8"), "yes\n");
});

test("reference copy carrier cleans failed fork staging publication", async (context) => {
    const workspaceRoot = await temporaryDirectory(context, "fork-failure");
    initializeWorkspace({ adopt: "none", initializeGit: false, rootPath: workspaceRoot });
    const sourceRoot = path.join(workspaceRoot, "source");
    await mkdir(sourceRoot);
    await writeFile(path.join(sourceRoot, "file.txt"), "source\n");
    const binding = createWorkspaceBindings({
        bindings: [{ name: "source", root: "source" }],
        workspaceRoot,
    }).bindings[0];
    assert.ok(binding);
    const carrier = createReferenceCopyCarrier({ workspaceRoot });
    const revision = await carrier.snapshot(binding);
    const custodiesPath = path.join(
        workspaceRoot,
        ".vcscore",
        workspaceProtocolConfig.carrier.carrierDirectory,
        workspaceProtocolConfig.carrier.custodiesDirectory,
    );
    await rm(custodiesPath, { recursive: true });
    await writeFile(custodiesPath, "blocked\n");
    await assert.rejects(carrier.fork(revision.revision_id), WorldCarrierError);
});

test("reference copy carrier rejects a staging parent replaced after construction", async (context) => {
    const workspaceRoot = await temporaryDirectory(context, "staging-substitution");
    initializeWorkspace({ adopt: "none", initializeGit: false, rootPath: workspaceRoot });
    const sourceRoot = path.join(workspaceRoot, "source");
    await mkdir(sourceRoot);
    await writeFile(path.join(sourceRoot, "file.txt"), "source\n");
    const binding = createWorkspaceBindings({
        bindings: [{ name: "source", root: "source" }],
        workspaceRoot,
    }).bindings[0];
    assert.ok(binding);
    const carrier = createReferenceCopyCarrier({ workspaceRoot });
    const stagingPath = path.join(
        workspaceRoot,
        ".vcscore",
        workspaceProtocolConfig.carrier.carrierDirectory,
        workspaceProtocolConfig.carrier.stagingDirectory,
    );
    const outside = await temporaryDirectory(context, "staging-outside");
    await rm(stagingPath, { recursive: true });
    await symlink(outside, stagingPath);
    await assert.rejects(carrier.snapshot(binding), WorldCarrierError);
    assert.deepEqual(await readdir(outside), []);
});

test("reference copy carrier cleans failed discard publication", async (context) => {
    const workspaceRoot = await temporaryDirectory(context, "discard-failure");
    initializeWorkspace({ adopt: "none", initializeGit: false, rootPath: workspaceRoot });
    const sourceRoot = path.join(workspaceRoot, "source");
    await mkdir(sourceRoot);
    await writeFile(path.join(sourceRoot, "file.txt"), "source\n");
    const binding = createWorkspaceBindings({
        bindings: [{ name: "source", root: "source" }],
        workspaceRoot,
    }).bindings[0];
    assert.ok(binding);
    const carrier = createReferenceCopyCarrier({ workspaceRoot });
    const custody = await carrier.fork((await carrier.snapshot(binding)).revision_id);
    const discardedPath = path.join(
        workspaceRoot,
        ".vcscore",
        workspaceProtocolConfig.carrier.carrierDirectory,
        workspaceProtocolConfig.carrier.discardedDirectory,
    );
    await rm(discardedPath, { recursive: true });
    await writeFile(discardedPath, "blocked\n");
    await assert.rejects(carrier.discard(custody.custody_id), WorldCarrierError);
    const stagingPath = path.join(
        workspaceRoot,
        ".vcscore",
        workspaceProtocolConfig.carrier.carrierDirectory,
        workspaceProtocolConfig.carrier.stagingDirectory,
    );
    assert.deepEqual(await readdir(stagingPath), []);
});

async function temporaryDirectory(
    context: { after: (callback: () => Promise<void>) => void },
    name: string,
): Promise<string> {
    const root = await mkdtemp(path.join(tmpdir(), `shepherd-carrier-${name}-`));
    context.after(() => rm(root, { force: true, recursive: true }));
    return root;
}
