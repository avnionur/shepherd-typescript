import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { SemanticRecord, WorldManifestEntry, WorldRevision } from "../../src/index.ts";
import {
    canonicalizeRecord,
    createRecordId,
    createReferenceCopyCarrier,
    createWorkspaceBindings,
    createWorldChangeset,
    initializeWorkspace,
    WorldChangesetError,
} from "../../src/index.ts";
import { workspaceProtocolConfig } from "../../src/protocol/config.ts";

test("world changesets reconstruct ordered file, directory, mode, symlink, and replacement changes", async (context) => {
    const root = await mkdtemp(path.join(tmpdir(), "shepherd-changeset-"));
    context.after(() => rm(root, { force: true, recursive: true }));
    initializeWorkspace({ adopt: "none", initializeGit: false, rootPath: root });
    const source = path.join(root, "source");
    await mkdir(path.join(source, "deleted-dir"), { recursive: true });
    await writeFile(path.join(source, "deleted-dir", "old.txt"), "old\n");
    await writeFile(path.join(source, "edited.txt"), "before\n");
    await writeFile(path.join(source, "mode.txt"), "same\n");
    await writeFile(path.join(source, "replace"), "file\n");
    await symlink("edited.txt", path.join(source, "link"));
    const binding = createWorkspaceBindings({
        bindings: [{ name: "source", root: "source" }],
        workspaceRoot: root,
    }).bindings[0];
    assert.ok(binding);
    const carrier = createReferenceCopyCarrier({ workspaceRoot: root });
    const base = await carrier.snapshot(binding);

    await rm(path.join(source, "deleted-dir"), { recursive: true });
    await writeFile(path.join(source, "edited.txt"), "after\n");
    await chmod(path.join(source, "mode.txt"), 0o700);
    await unlink(path.join(source, "link"));
    await symlink("mode.txt", path.join(source, "link"));
    await unlink(path.join(source, "replace"));
    await mkdir(path.join(source, "replace"));
    await writeFile(path.join(source, "replace", "child.txt"), "child\n");
    await writeFile(path.join(source, "added.txt"), "added\n");
    const head = await carrier.snapshot(binding);

    const changeset = await createWorldChangeset({
        baseRevision: base,
        carrier,
        headRevision: head,
    });
    assert.deepEqual(changeset.changed_paths, [
        "added.txt",
        "deleted-dir",
        "deleted-dir/old.txt",
        "edited.txt",
        "link",
        "mode.txt",
        "replace",
        "replace/child.txt",
    ]);
    assert.deepEqual(
        changeset.changes.map(({ operation }) => operation),
        ["add", "delete", "delete", "modify", "modify", "modify", "replace", "add"],
    );
    assert.equal(changeset.binding_id, binding.binding_id);
    assert.equal(changeset.base_revision_id, base.revision_id);
    assert.equal(changeset.head_revision_id, head.revision_id);
    assert.equal(Object.isFrozen(changeset), true);
    assert.equal(Object.isFrozen(changeset.changes), true);
    assert.equal(Object.isFrozen(changeset.changed_paths), true);
    assert.equal(Object.isFrozen(changeset.changes[0]?.after), true);
    assert.deepEqual(
        await createWorldChangeset({ baseRevision: base, carrier, headRevision: head }),
        changeset,
    );
    assert.deepEqual(
        (await createWorldChangeset({ baseRevision: head, carrier, headRevision: head })).changes,
        [],
    );
});

test("world changesets reject cross-binding and corrupted revision evidence", async (context) => {
    const root = await mkdtemp(path.join(tmpdir(), "shepherd-changeset-invalid-"));
    context.after(() => rm(root, { force: true, recursive: true }));
    initializeWorkspace({ adopt: "none", initializeGit: false, rootPath: root });
    await mkdir(path.join(root, "one"));
    await mkdir(path.join(root, "two"));
    const bindings = createWorkspaceBindings({
        bindings: [
            { name: "one", root: "one" },
            { name: "two", root: "two" },
        ],
        workspaceRoot: root,
    }).bindings;
    const carrier = createReferenceCopyCarrier({ workspaceRoot: root });
    await writeFile(path.join(root, "one", "file"), "one");
    await mkdir(path.join(root, "one", "dir"));
    await symlink("file", path.join(root, "one", "link"));
    const firstBinding = bindings[0];
    const secondBinding = bindings[1];
    assert.ok(firstBinding);
    assert.ok(secondBinding);
    const one = await carrier.snapshot(firstBinding);
    const two = await carrier.snapshot(secondBinding);
    await assert.rejects(
        createWorldChangeset({ baseRevision: one, carrier, headRevision: two }),
        WorldChangesetError,
    );
    await assert.rejects(
        createWorldChangeset({
            baseRevision: { ...one, content_id: one.content_id.replace(/.$/u, "0") },
            carrier,
            headRevision: one,
        }),
        WorldChangesetError,
    );

    const sparseManifest = [...one.manifest];
    sparseManifest.length += 1;
    const invalidRevisions: unknown[] = [
        null,
        [],
        { ...one, extra: true },
        { ...one, manifest: null },
        { ...one, manifest: sparseManifest },
        { ...one, manifest: [...one.manifest].reverse() },
        { ...one, backend: null },
        { ...one, binding_id: null },
        { ...one, capture_kind: "other" },
        { ...one, descriptor_version: 0 },
        { ...one, basis_ref: 1 },
        { ...one, parent_revision_id: 1 },
        { ...one, path: null },
        { ...one, revision_id: "wrong" },
    ];
    const withSymbol = { ...one } as Record<PropertyKey, unknown>;
    withSymbol[Symbol("extra")] = true;
    invalidRevisions.push(withSymbol);
    const withAccessor = { ...one };
    Object.defineProperty(withAccessor, "path", { enumerable: true, get: () => one.path });
    invalidRevisions.push(withAccessor);
    for (const revision of invalidRevisions) {
        await assert.rejects(
            createWorldChangeset({
                baseRevision: revision as WorldRevision,
                carrier,
                headRevision: one,
            }),
            WorldChangesetError,
        );
    }

    const directory = one.manifest.find((entry) => entry.kind === "directory");
    const file = one.manifest.find((entry) => entry.kind === "file");
    const link = one.manifest.find((entry) => entry.kind === "symlink");
    assert.ok(directory);
    assert.ok(file);
    assert.ok(link);
    const invalidEntries: WorldManifestEntry[] = [
        { ...file, path: "" },
        { ...file, path: "/absolute" },
        { ...file, path: "trailing/" },
        { ...file, path: "back\\slash" },
        { ...file, path: "nul\0path" },
        { ...file, path: "." },
        { ...file, path: ".." },
        { ...file, path: "a//b" },
        { ...file, path: "a/./b" },
        { ...file, path: "a/../b" },
        { ...file, path: ".vcscore/file" },
        { ...file, path: "bad\ud800" },
        { ...file, kind: "unknown" as "file" },
        { ...file, mode: null },
        { ...file, blob_id: null },
        { ...file, blob_id: "bad" },
        { ...file, blob_id: `${workspaceProtocolConfig.carrier.blobIdPrefix}0` },
        {
            ...file,
            blob_id: `${workspaceProtocolConfig.carrier.blobIdPrefix}${"g".repeat(workspaceProtocolConfig.hexLength)}`,
        },
        { ...file, mode: -1 },
        { ...file, size: -1 },
        { ...file, size: "1" as unknown as number },
        { ...file, size: null },
        { ...file, symlink_target: "bad" },
        { ...directory, mode: null },
        { ...directory, blob_id: "bad" },
        { ...link, mode: 0 },
        { ...link, blob_id: "bad" },
        { ...link, size: 0 },
        { ...link, symlink_target: null },
        { ...file, path: "x".repeat(workspaceProtocolConfig.changesets.maxPathBytes + 1) },
        {
            ...link,
            symlink_target: "x".repeat(
                workspaceProtocolConfig.changesets.maxSymlinkTargetBytes + 1,
            ),
        },
        { ...file, size: workspaceProtocolConfig.changesets.maxSingleBlobBytes + 1 },
    ];
    for (const entry of invalidEntries) {
        await assert.rejects(
            createWorldChangeset({
                baseRevision: { ...one, manifest: [entry] },
                carrier,
                headRevision: one,
            }),
            WorldChangesetError,
        );
    }
    await assert.rejects(
        createWorldChangeset({
            baseRevision: { ...one, manifest: [{ ...file, path: "nested/file" }] },
            carrier,
            headRevision: one,
        }),
        WorldChangesetError,
    );

    const largeBase = rebuildRevision(
        one,
        ["a", "b", "c"].map((path) => ({ ...file, path, size: 200_000_000 })),
    );
    const largeHead = rebuildRevision(
        one,
        ["a", "b", "c"].map((path) => ({ ...file, path, size: 200_000_001 })),
    );
    await assert.rejects(
        createWorldChangeset({ baseRevision: largeBase, carrier, headRevision: largeHead }),
        WorldChangesetError,
    );
    await assert.rejects(
        createWorldChangeset(
            undefined as unknown as {
                baseRevision: WorldRevision;
                carrier: typeof carrier;
                headRevision: WorldRevision;
            },
        ),
        WorldChangesetError,
    );
    let getterInvoked = false;
    const throwingOptions = Object.create(null) as {
        baseRevision: WorldRevision;
        carrier: typeof carrier;
        headRevision: WorldRevision;
    };
    Object.defineProperty(throwingOptions, "baseRevision", {
        get: () => {
            getterInvoked = true;
            throw new Error("must not run");
        },
    });
    await assert.rejects(createWorldChangeset(throwingOptions), WorldChangesetError);
    assert.equal(getterInvoked, false);
    const errorOptions = Object.create(null) as {
        baseRevision: WorldRevision;
        carrier: typeof carrier;
        headRevision: WorldRevision;
    };
    Object.defineProperties(errorOptions, {
        baseRevision: { enumerable: true, value: one },
        carrier: { enumerable: true, value: carrier },
        headRevision: { enumerable: true, value: one },
    });
    assert.deepEqual((await createWorldChangeset(errorOptions)).changes, []);
    Object.defineProperty(errorOptions, "extra", { enumerable: true, value: true });
    await assert.rejects(createWorldChangeset(errorOptions), WorldChangesetError);
    for (const thrown of [new Error("rejected"), "rejected"]) {
        const proxyOptions = new Proxy(
            { baseRevision: one, carrier, headRevision: one },
            {
                getPrototypeOf: () => {
                    throw thrown;
                },
            },
        );
        await assert.rejects(createWorldChangeset(proxyOptions), WorldChangesetError);
    }

    const manyEntries = Array.from(
        { length: 2_000 },
        (_, index): WorldManifestEntry => ({
            blob_id: null,
            kind: "directory",
            mode: 0o755,
            path: `${String(index).padStart(4, "0")}-${"x".repeat(600)}`,
            size: null,
            symlink_target: null,
        }),
    );
    await assert.rejects(
        createWorldChangeset({
            baseRevision: rebuildRevision(one, []),
            carrier,
            headRevision: rebuildRevision(one, manyEntries),
        }),
        (error: unknown) =>
            error instanceof WorldChangesetError &&
            error.code === workspaceProtocolConfig.changesets.errors.limitCode,
    );
    const tooManyEntries = Array.from(
        { length: workspaceProtocolConfig.changesets.maxManifestEntries + 1 },
        (_, index): WorldManifestEntry => ({
            blob_id: null,
            kind: "directory",
            mode: 0o755,
            path: String(index).padStart(5, "0"),
            size: null,
            symlink_target: null,
        }),
    );
    await assert.rejects(
        createWorldChangeset({
            baseRevision: rebuildRevision(one, []),
            carrier,
            headRevision: rebuildRevision(one, tooManyEntries),
        }),
        WorldChangesetError,
    );
    await assert.rejects(
        createWorldChangeset({
            baseRevision: one,
            carrier: {} as typeof carrier,
            headRevision: one,
        }),
        WorldChangesetError,
    );
    await assert.rejects(
        createWorldChangeset({
            baseRevision: { ...one, path: `${one.path}-forged` },
            carrier,
            headRevision: one,
        }),
        WorldChangesetError,
    );
    const wideBase = Array.from(
        { length: 1_500 },
        (_, index): WorldManifestEntry => ({
            blob_id: null,
            kind: "directory",
            mode: 0o755,
            path: `${String(index).padStart(4, "0")}-${"x".repeat(600)}`,
            size: null,
            symlink_target: null,
        }),
    );
    const wideHead = wideBase.map((entry) => ({ ...entry, mode: 0o700 }));
    await assert.rejects(
        createWorldChangeset({
            baseRevision: rebuildRevision(one, wideBase),
            carrier,
            headRevision: rebuildRevision(one, wideHead),
        }),
        WorldChangesetError,
    );
});

function rebuildRevision(
    revision: WorldRevision,
    manifest: readonly WorldManifestEntry[],
): WorldRevision {
    const canonical = canonicalizeRecord({
        entries: manifest as unknown as SemanticRecord["entries"],
        manifest_version: workspaceProtocolConfig.carrier.manifestVersion,
    });
    const content_id = `${workspaceProtocolConfig.carrier.worldContentIdPrefix}${createHash(workspaceProtocolConfig.digestAlgorithm).update(canonical).digest("hex")}`;
    const semantic = createRecordId({
        basis_ref: revision.basis_ref,
        binding_id: revision.binding_id,
        capture_kind: revision.capture_kind,
        content_id,
        descriptor_version: revision.descriptor_version,
        manifest_version: workspaceProtocolConfig.carrier.manifestVersion,
        parent_revision_id: revision.parent_revision_id,
    });
    return {
        ...revision,
        content_id,
        manifest,
        revision_id: `${workspaceProtocolConfig.carrier.revisionIdPrefix}${semantic.slice(semantic.lastIndexOf(":") + 1)}`,
    };
}
