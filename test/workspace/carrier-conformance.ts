import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
    chmod,
    link,
    mkdir,
    mkdtemp,
    readdir,
    readFile,
    realpath,
    rm,
    symlink,
    unlink,
    writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";

import {
    createReferenceCopyCarrier,
    createWorkspaceBindings,
    createWorldChangeset,
    discardScope,
    initializeWorkspace,
    mergeScope,
    type ReferenceCopyCarrier,
    releaseScopeWriter,
    SQLiteTraceStore,
    type WorkspaceBinding,
    type WorldCarrierBackend,
    WorldCarrierError,
    type WorldCustody,
} from "../../src/index.ts";
import { workspaceProtocolConfig } from "../../src/protocol/config.ts";
import { createNestedWorld, forkChild, headOf, writeCustody } from "../scope/merge-fixtures.ts";

const REFERENCE_BACKEND = workspaceProtocolConfig.carrierBackends
    .defaultBackend as WorldCarrierBackend;

/** One backend run through the shared carrier conformance suite. */
export type CarrierConformanceTarget = {
    /** Configured backend under test. */
    readonly backend: WorldCarrierBackend;
    /** Whether the reference copy carrier may open this backend's plain-directory custody. */
    readonly directoryCustody: boolean;
    /** Removes volatile host state, such as mounts, to simulate a host or process restart. */
    readonly dropVolatileState: (custody: WorldCustody) => void;
    /** Releases host state, such as live mounts, beneath one workspace before it is removed. */
    readonly releaseHostState: (workspaceRoot: string) => void;
};

/**
 * Registers the shared carrier conformance suite for one available backend.
 *
 * Every assertion compares the backend against the copy reference carrier on the same workspace,
 * so equal logical identities prove the backend retains the reference contract.
 */
export function registerCarrierConformanceSuite(target: CarrierConformanceTarget): void {
    const { backend } = target;

    test(`${backend} carrier snapshot, fork, capture, and changesets equal copy identities`, async (context) => {
        const { binding, sourceRoot, workspaceRoot } = await createTreeWorkspace(
            context,
            `${backend}-identity`,
            tmpdir(),
            target.releaseHostState,
        );
        const carrier = open(workspaceRoot, backend);
        const reference = open(workspaceRoot, REFERENCE_BACKEND);
        assert.equal(carrier.backend, backend);
        assert.equal(reference.backend, REFERENCE_BACKEND);

        const revision = await carrier.snapshot(binding);
        assert.equal(revision.backend, workspaceProtocolConfig.carrier.backendKind);
        assert.equal(revision.capture_kind, workspaceProtocolConfig.carrier.captureKind);
        assert.deepEqual(await reference.snapshot(binding), revision);
        assert.deepEqual(await reference.openRevision(revision.revision_id), revision);
        assert.equal((await carrier.verifyRevision(revision.revision_id)).modified, false);

        const custody = await carrier.fork(revision.revision_id);
        const referenceCustody = await reference.fork(revision.revision_id);
        assert.equal(custody.backend, backend);
        assert.equal(custody.base_content_id, revision.content_id);
        assert.deepEqual(
            await carrier.verifyCustody(custody.custody_id),
            await reference.verifyCustody(referenceCustody.custody_id),
        );
        for (const root of [custody.path, referenceCustody.path]) {
            await writeFile(path.join(root, "text.txt"), "changed\n");
            await rm(path.join(root, "nested", "child.txt"));
            await mkdir(path.join(root, "added"));
            await writeFile(path.join(root, "added", "new.bin"), Uint8Array.from([9, 8, 7]));
            await chmod(path.join(root, "script.sh"), 0o700);
        }
        const verification = await carrier.verifyCustody(custody.custody_id);
        assert.equal(verification.modified, true);
        assert.deepEqual(verification, await reference.verifyCustody(referenceCustody.custody_id));
        assert.equal(await readFile(path.join(sourceRoot, "text.txt"), "utf8"), "source\n");

        const head = await carrier.captureCustody(custody.custody_id);
        const referenceHead = await reference.captureCustody(referenceCustody.custody_id);
        assert.deepEqual(head, referenceHead);
        assert.equal(head.content_id, verification.content_id);
        assert.equal(head.parent_revision_id, revision.revision_id);
        assert.deepEqual(await carrier.captureCustody(custody.custody_id), head);
        const changeset = await createWorldChangeset({
            baseRevision: revision,
            carrier,
            headRevision: head,
        });
        const referenceChangeset = await createWorldChangeset({
            baseRevision: revision,
            carrier: reference,
            headRevision: referenceHead,
        });
        assert.equal(changeset.changeset_id, referenceChangeset.changeset_id);
        assert.deepEqual(changeset.changed_paths, [
            "added",
            "added/new.bin",
            "nested/child.txt",
            "script.sh",
            "text.txt",
        ]);

        await carrier.discard(custody.custody_id);
        await carrier.discard(custody.custody_id);
        await assert.rejects(carrier.openCustody(custody.custody_id), WorldCarrierError);
        await assert.rejects(reference.openCustody(custody.custody_id), WorldCarrierError);
        assert.equal((await carrier.verifyRevision(revision.revision_id)).modified, false);
        assert.equal((await carrier.verifyRevision(head.revision_id)).content_id, head.content_id);
        assert.deepEqual(await readdir(path.join(sourceRoot, "nested")), ["child.txt"]);
    });

    test(`${backend} carrier isolates base revisions and rejects unsupported custody entries`, async (context) => {
        const { binding, workspaceRoot } = await createTreeWorkspace(
            context,
            `${backend}-isolation`,
            tmpdir(),
            target.releaseHostState,
        );
        const carrier = open(workspaceRoot, backend);
        const revision = await carrier.snapshot(binding);
        const baseListing = await readdir(revision.path);
        const custody = await carrier.fork(revision.revision_id);
        await writeFile(path.join(custody.path, "text.txt"), "isolated\n");
        await rm(path.join(custody.path, "empty"), { recursive: true });
        assert.equal(await readFile(path.join(revision.path, "text.txt"), "utf8"), "source\n");
        assert.deepEqual(await readdir(revision.path), baseListing);
        assert.equal((await carrier.verifyRevision(revision.revision_id)).modified, false);

        const fifo = path.join(custody.path, "fifo");
        execFileSync("mkfifo", [fifo]);
        await assert.rejects(carrier.captureCustody(custody.custody_id), WorldCarrierError);
        await unlink(fifo);
        await link(path.join(custody.path, "text.txt"), path.join(custody.path, "hard-link"));
        await assert.rejects(
            carrier.captureCustody(custody.custody_id),
            (error: unknown) =>
                error instanceof WorldCarrierError &&
                error.code === workspaceProtocolConfig.carrier.errors.unsupportedCode,
        );
        await unlink(path.join(custody.path, "hard-link"));
        await symlink("../../../../escape", path.join(custody.path, "escape"));
        await assert.rejects(carrier.captureCustody(custody.custody_id), WorldCarrierError);
        await unlink(path.join(custody.path, "escape"));
        const captured = await carrier.captureCustody(custody.custody_id);
        assert.equal(await readFile(path.join(captured.path, "text.txt"), "utf8"), "isolated\n");
        assert.equal((await carrier.verifyRevision(revision.revision_id)).modified, false);
    });

    test(`${backend} carrier reopens retained custody after restart and refuses mismatched carriers`, async (context) => {
        const { binding, workspaceRoot } = await createTreeWorkspace(
            context,
            `${backend}-restart`,
            tmpdir(),
            target.releaseHostState,
        );
        const carrier = open(workspaceRoot, backend);
        const revision = await carrier.snapshot(binding);
        const custody = await carrier.fork(revision.revision_id);
        await writeFile(path.join(custody.path, "restart.txt"), "retained\n");
        const before = await carrier.verifyCustody(custody.custody_id);

        target.dropVolatileState(custody);
        const restarted = open(workspaceRoot, backend);
        const reopened = await restarted.openCustody(custody.custody_id);
        assert.deepEqual(reopened, custody);
        assert.equal(await readFile(path.join(reopened.path, "restart.txt"), "utf8"), "retained\n");
        assert.deepEqual(await restarted.verifyCustody(custody.custody_id), before);
        const reference = open(workspaceRoot, REFERENCE_BACKEND);
        if (target.directoryCustody) {
            assert.deepEqual(await reference.verifyCustody(custody.custody_id), before);
            const referenceCustody = await reference.fork(revision.revision_id);
            assert.equal(
                (await restarted.openCustody(referenceCustody.custody_id)).backend,
                REFERENCE_BACKEND,
            );
        } else {
            await assert.rejects(reference.openCustody(custody.custody_id), WorldCarrierError);
            const referenceCustody = await reference.fork(revision.revision_id);
            await assert.rejects(
                restarted.openCustody(referenceCustody.custody_id),
                WorldCarrierError,
            );
        }
        const captured = await restarted.captureCustody(custody.custody_id);
        target.dropVolatileState(custody);
        await restarted.discard(custody.custody_id);
        await assert.rejects(
            open(workspaceRoot, backend).openCustody(custody.custody_id),
            WorldCarrierError,
        );
        assert.equal(
            (await restarted.verifyRevision(captured.revision_id)).content_id,
            before.content_id,
        );
    });

    test(`${backend} carrier composes with scope fork, merge, and discard across restart`, async (context) => {
        let scopeWorkspace: string | null = null;
        context.after(() => {
            if (scopeWorkspace !== null) target.releaseHostState(scopeWorkspace);
        });
        const world = await createNestedWorld(
            context,
            `${backend}-scope`,
            SQLiteTraceStore,
            backend,
        );
        const { carrier, child, childWriter, parent, parentWriter, store, workspaceRoot } = world;
        scopeWorkspace = workspaceRoot;
        assert.equal(carrier.backend, backend);
        assert.equal((await carrier.openCustody(child.world.custody_id)).backend, backend);
        await writeCustody(world, child.world.custody_id, "child.txt", "child\n");
        await writeCustody(world, parent.world.custody_id, "file.txt", "parent edit\n");
        const request = {
            carrier,
            child: childWriter,
            commandId: "scope-command:merge",
            expectedChildHeadRecordId: headOf(store, child.scope_id),
            expectedParentHeadRecordId: headOf(store, parent.scope_id),
            nowMilliseconds: 1_700,
            parent: parentWriter,
        };
        const merged = await mergeScope(store, request);
        assert.ok(merged.world);
        const parentCustody = await carrier.openCustody(parent.world.custody_id);
        assert.equal(await readFile(path.join(parentCustody.path, "child.txt"), "utf8"), "child\n");
        assert.equal(
            await readFile(path.join(parentCustody.path, "file.txt"), "utf8"),
            "parent edit\n",
        );
        assert.equal(
            (await carrier.verifyCustody(parent.world.custody_id)).content_id,
            merged.world.merged_content_id,
        );

        target.dropVolatileState(parentCustody);
        const restarted = open(workspaceRoot, backend);
        assert.deepEqual(await mergeScope(store, { ...request, carrier: restarted }), merged);
        assert.equal(
            (await restarted.verifyCustody(parent.world.custody_id)).content_id,
            merged.world.merged_content_id,
        );

        const discardedChild = await forkChild(
            world,
            parent,
            parentWriter,
            "scope-command:fork-discarded",
        );
        await writeCustody(world, discardedChild.world.custody_id, "discarded.txt", "discarded\n");
        const discardRequest = {
            carrier: restarted,
            commandId: "scope-command:discard",
            expectedHeadRecordId: headOf(store, discardedChild.scope_id),
            nowMilliseconds: 1_800,
            parent: parentWriter,
            scopeId: discardedChild.scope_id,
        };
        const discarded = await discardScope(store, discardRequest);
        assert.equal(discarded.cleanup.phase, "cleaned");
        await assert.rejects(
            restarted.openCustody(discardedChild.world.custody_id),
            WorldCarrierError,
        );
        assert.deepEqual(await discardScope(store, discardRequest), discarded);
        releaseScopeWriter(store, { writer: parentWriter });
        assert.equal(
            await readFile(path.join(workspaceRoot, "source", "file.txt"), "utf8"),
            "source\n",
        );
    });
}

/**
 * Asserts that one unavailable backend refuses carrier creation with configured evidence.
 *
 * @param backend - Backend expected to be unavailable on this host or filesystem.
 * @param workspaceRoot - Initialized workspace on the filesystem under test.
 * @returns The configured refusal reason reported by the error message.
 */
export function assertCarrierBackendRefused(
    backend: WorldCarrierBackend,
    workspaceRoot: string,
): string {
    const errors = workspaceProtocolConfig.carrierBackends.errors;
    let refusal: unknown;
    try {
        createReferenceCopyCarrier({ backend, workspaceRoot });
    } catch (error) {
        refusal = error;
    }
    assert.ok(refusal instanceof WorldCarrierError);
    assert.equal(refusal.code, errors.unavailableCode);
    assert.ok(refusal.message.startsWith(`${errors.unavailableMessage}: ${backend}: `));
    const reason =
        refusal.message.slice(`${errors.unavailableMessage}: ${backend}: `.length).split(": ")[0] ??
        "";
    assert.ok(workspaceProtocolConfig.carrierBackends.conformance.reasons.includes(reason));
    return reason;
}

/**
 * Creates an initialized temporary workspace containing the conformance source tree.
 *
 * @param context - Test context that removes the workspace afterwards.
 * @param label - Diagnostic temporary-directory label.
 * @param parent - Directory that must host the workspace filesystem.
 */
export async function createTreeWorkspace(
    context: TestContext,
    label: string,
    parent = tmpdir(),
    releaseHostState: (workspaceRoot: string) => void = () => undefined,
): Promise<{
    readonly binding: WorkspaceBinding;
    readonly sourceRoot: string;
    readonly workspaceRoot: string;
}> {
    const workspaceRoot = await realpath(
        await mkdtemp(path.join(parent, `shepherd-carrier-conformance-${label}-`)),
    );
    context.after(() => {
        releaseHostState(workspaceRoot);
        return rm(workspaceRoot, { force: true, recursive: true });
    });
    initializeWorkspace({ adopt: "none", initializeGit: false, rootPath: workspaceRoot });
    const sourceRoot = path.join(workspaceRoot, "source");
    await mkdir(path.join(sourceRoot, "empty"), { recursive: true });
    await mkdir(path.join(sourceRoot, "nested"));
    await writeFile(path.join(sourceRoot, "nested", "child.txt"), "child\n");
    await writeFile(path.join(sourceRoot, "text.txt"), "source\n");
    await writeFile(path.join(sourceRoot, "binary.bin"), Uint8Array.from([0, 255, 17, 0]));
    await writeFile(path.join(sourceRoot, "script.sh"), "#!/bin/sh\n");
    await chmod(path.join(sourceRoot, "script.sh"), 0o755);
    await writeFile(path.join(sourceRoot, "large.bin"), Buffer.alloc(256 * 1024, 42));
    await symlink("text.txt", path.join(sourceRoot, "link"));
    const [binding] = createWorkspaceBindings({
        bindings: [{ name: "source", root: "source" }],
        workspaceRoot,
    }).bindings;
    assert.ok(binding);
    return { binding, sourceRoot, workspaceRoot };
}

function open(workspaceRoot: string, backend: WorldCarrierBackend): ReferenceCopyCarrier {
    return createReferenceCopyCarrier({ backend, workspaceRoot });
}
