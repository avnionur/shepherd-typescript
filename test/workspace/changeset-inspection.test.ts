import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
    createReferenceCopyCarrier,
    createWorkspaceBindings,
    createWorldChangesetInspection,
    initializeWorkspace,
    WORLD_CHANGESET_ERROR_CODES,
    WORLD_CHANGESET_INSPECTION_LIMITS,
    WorldChangesetError,
} from "../../src/index.ts";

test("world changeset inspection authenticates retained revisions and exposes bounded canonical pages", async (context) => {
    const root = await mkdtemp(path.join(tmpdir(), "shepherd-changeset-inspection-"));
    context.after(() => rm(root, { force: true, recursive: true }));
    initializeWorkspace({ adopt: "none", initializeGit: false, rootPath: root });
    const source = path.join(root, "source");
    await mkdir(source);
    await writeFile(path.join(source, "alpha.txt"), "before\n");
    await writeFile(path.join(source, "removed.txt"), "removed\n");
    const binding = createWorkspaceBindings({
        bindings: [{ name: "source", root: "source" }],
        workspaceRoot: root,
    }).bindings[0];
    assert.ok(binding);
    const carrier = createReferenceCopyCarrier({ workspaceRoot: root });
    const base = await carrier.snapshot(binding);

    await writeFile(path.join(source, "alpha.txt"), "after\n");
    await rm(path.join(source, "removed.txt"));
    await writeFile(path.join(source, "zeta.txt"), "added\n");
    const head = await carrier.snapshot(binding);
    await writeFile(path.join(source, "alpha.txt"), "unretained user mutation\n");

    const inspection = await createWorldChangesetInspection({
        baseRevision: base,
        carrier,
        headRevision: head,
    });
    assert.equal(inspection.changeset.changed_paths.join(","), "alpha.txt,removed.txt,zeta.txt");
    assert.equal(inspection.change("alpha.txt")?.operation, "modify");
    assert.equal(inspection.change("missing.txt"), null);
    const alphaAfter = inspection.change("alpha.txt")?.after;
    assert.equal(alphaAfter?.kind, "file");
    assert.equal(alphaAfter?.kind === "file" ? alphaAfter.byte_length : null, 6);
    assert.deepEqual(
        await inspection.readContent({
            contentId: alphaAfter?.kind === "file" ? alphaAfter.content_id : "",
            length: 3,
            offset: 1,
        }),
        {
            bytes: new Uint8Array(Buffer.from("fte")),
            content_id: alphaAfter?.kind === "file" ? alphaAfter.content_id : "",
            offset: 1,
            total_bytes: 6,
            truncated: true,
        },
    );
    assert.deepEqual(
        await inspection.previewText({
            contentId: alphaAfter?.kind === "file" ? alphaAfter.content_id : "",
        }),
        {
            byte_length: 6,
            classification: "text",
            content_id: alphaAfter?.kind === "file" ? alphaAfter.content_id : "",
            encoding: "utf-8",
            text: "after\n",
            truncated: false,
        },
    );
    assert.deepEqual(inspection.page({ limit: 2, offset: 0 }), {
        changes: inspection.changeset.changes.slice(0, 2),
        next_offset: 2,
        offset: 0,
        total: 3,
    });
    assert.deepEqual(inspection.page({ limit: 2, offset: 2 }), {
        changes: inspection.changeset.changes.slice(2),
        next_offset: null,
        offset: 2,
        total: 3,
    });
    assert.equal(Object.isFrozen(inspection), true);
    assert.equal(Object.isFrozen(inspection.page({ limit: 2 })), true);
});

test("world changeset inspection derives exact-content renames and copies outside canonical identity", async (context) => {
    const root = await mkdtemp(path.join(tmpdir(), "shepherd-changeset-moves-"));
    context.after(() => rm(root, { force: true, recursive: true }));
    initializeWorkspace({ adopt: "none", initializeGit: false, rootPath: root });
    const source = path.join(root, "source");
    await mkdir(source);
    await writeFile(path.join(source, "rename-from.txt"), "rename bytes\n");
    await writeFile(path.join(source, "copy-from.txt"), "copy bytes\n");
    await writeFile(path.join(source, "ambiguous-from.txt"), "ambiguous bytes\n");
    await mkdir(path.join(source, "empty"));
    const binding = createWorkspaceBindings({
        bindings: [{ name: "source", root: "source" }],
        workspaceRoot: root,
    }).bindings[0];
    assert.ok(binding);
    const carrier = createReferenceCopyCarrier({ workspaceRoot: root });
    const base = await carrier.snapshot(binding);
    await rm(path.join(source, "rename-from.txt"));
    await writeFile(path.join(source, "rename-to.txt"), "rename bytes\n");
    await writeFile(path.join(source, "copy-to.txt"), "copy bytes\n");
    await rm(path.join(source, "ambiguous-from.txt"));
    await writeFile(path.join(source, "ambiguous-one.txt"), "ambiguous bytes\n");
    await writeFile(path.join(source, "ambiguous-two.txt"), "ambiguous bytes\n");
    const head = await carrier.snapshot(binding);

    const inspection = await createWorldChangesetInspection({
        baseRevision: base,
        carrier,
        headRevision: head,
    });
    const canonicalId = inspection.changeset.changeset_id;
    const copyAfter = inspection.change("copy-to.txt")?.after;
    const renameAfter = inspection.change("rename-to.txt")?.after;
    assert.deepEqual(inspection.derivedMoves(), [
        {
            content_id: copyAfter?.kind === "file" ? copyAfter.content_id : "",
            kind: "copy",
            source_path: "copy-from.txt",
            target_path: "copy-to.txt",
        },
        {
            content_id: renameAfter?.kind === "file" ? renameAfter.content_id : "",
            kind: "rename",
            source_path: "rename-from.txt",
            target_path: "rename-to.txt",
        },
    ]);
    assert.equal(inspection.changeset.changeset_id, canonicalId);
    assert.deepEqual(inspection.changeset.changed_paths, [
        "ambiguous-from.txt",
        "ambiguous-one.txt",
        "ambiguous-two.txt",
        "copy-to.txt",
        "rename-from.txt",
        "rename-to.txt",
    ]);
});

test("world changeset inspection bounds previews and fails closed on malformed or corrupted reads", async (context) => {
    const root = await mkdtemp(path.join(tmpdir(), "shepherd-changeset-bounds-"));
    context.after(() => rm(root, { force: true, recursive: true }));
    initializeWorkspace({ adopt: "none", initializeGit: false, rootPath: root });
    const source = path.join(root, "source");
    await mkdir(source);
    await writeFile(path.join(source, "content.txt"), "base\n");
    await writeFile(path.join(source, "binary.bin"), new Uint8Array([0, 1]));
    await writeFile(path.join(source, "invalid.bin"), new Uint8Array([1]));
    const binding = createWorkspaceBindings({
        bindings: [{ name: "source", root: "source" }],
        workspaceRoot: root,
    }).bindings[0];
    assert.ok(binding);
    const carrier = createReferenceCopyCarrier({ workspaceRoot: root });
    const base = await carrier.snapshot(binding);
    await writeFile(path.join(source, "content.txt"), "one\ntwo\nthree\n");
    await writeFile(path.join(source, "binary.bin"), new Uint8Array([0, 2]));
    await writeFile(path.join(source, "invalid.bin"), new Uint8Array([255]));
    const head = await carrier.snapshot(binding);
    const inspection = await createWorldChangesetInspection({
        baseRevision: base,
        carrier,
        headRevision: head,
    });
    const textNode = inspection.change("content.txt")?.after;
    const binaryNode = inspection.change("binary.bin")?.after;
    const invalidNode = inspection.change("invalid.bin")?.after;
    assert.equal(textNode?.kind, "file");
    assert.equal(binaryNode?.kind, "file");
    assert.equal(invalidNode?.kind, "file");
    if (textNode?.kind !== "file" || binaryNode?.kind !== "file" || invalidNode?.kind !== "file")
        assert.fail();

    assert.deepEqual(
        await inspection.previewText({ contentId: textNode.content_id, maxLines: 2 }),
        {
            byte_length: 14,
            classification: "text",
            content_id: textNode.content_id,
            encoding: "utf-8",
            text: "one\ntwo\n",
            truncated: true,
        },
    );
    assert.deepEqual(await inspection.previewText({ contentId: binaryNode.content_id }), {
        byte_length: 2,
        classification: "binary",
        content_id: binaryNode.content_id,
        encoding: null,
        text: null,
        truncated: true,
    });
    assert.equal(
        (await inspection.previewText({ contentId: invalidNode.content_id })).classification,
        "binary",
    );
    assert.deepEqual(inspection.page({ offset: inspection.changeset.changes.length }), {
        changes: [],
        next_offset: null,
        offset: inspection.changeset.changes.length,
        total: inspection.changeset.changes.length,
    });
    assert.equal(inspection.page().total, inspection.changeset.changes.length);

    const invalidPaths: unknown[] = [
        null,
        "",
        "/absolute",
        "trailing/",
        "back\\slash",
        "nul\0path",
        "x".repeat(WORLD_CHANGESET_INSPECTION_LIMITS.maxPathBytes + 1),
        "nested//path",
        "nested/./path",
        "nested/../path",
        ".vcscore/path",
        "bad\ud800",
    ];
    for (const invalidPath of invalidPaths)
        assert.throws(() => inspection.change(invalidPath as string), WorldChangesetError);

    const invalidCalls = [
        () => inspection.page({ limit: WORLD_CHANGESET_INSPECTION_LIMITS.maxPageSize + 1 }),
        () => inspection.page({ offset: -1 }),
        () => inspection.page({ limit: 0 }),
        () => inspection.page({ limit: 1.5 }),
        () => inspection.page({ offset: 1.5 }),
        () => inspection.page({ extra: true } as never),
        () => inspection.readContent({ contentId: "not-cited" }),
        () => inspection.readContent({ contentId: textNode.content_id, offset: 15 }),
        () => inspection.readContent({ contentId: textNode.content_id, offset: -1 }),
        () => inspection.readContent({ contentId: 1 as unknown as string }),
        () => inspection.readContent(null as unknown as { contentId: string }),
        () => inspection.readContent([] as unknown as { contentId: string }),
        () => inspection.readContent({ contentId: textNode.content_id, extra: true } as never),
        () =>
            inspection.readContent({
                contentId: textNode.content_id,
                length: WORLD_CHANGESET_INSPECTION_LIMITS.maxReadBytes + 1,
            }),
        () =>
            inspection.previewText({
                contentId: textNode.content_id,
                maxBytes: WORLD_CHANGESET_INSPECTION_LIMITS.maxPreviewBytes + 1,
            }),
        () =>
            inspection.previewText({
                contentId: textNode.content_id,
                maxLines: WORLD_CHANGESET_INSPECTION_LIMITS.maxPreviewLines + 1,
            }),
        () => inspection.previewText({ contentId: 1 as unknown as string }),
        () => inspection.previewText({ contentId: textNode.content_id, maxBytes: 0 }),
        () => inspection.previewText({ contentId: textNode.content_id, maxLines: 1.5 }),
    ];
    for (const call of invalidCalls) await assert.rejects(async () => call(), WorldChangesetError);

    await writeFile(path.join(head.path, "content.txt"), "corrupt retained bytes\n");
    await assert.rejects(
        inspection.readContent({ contentId: textNode.content_id }),
        WorldChangesetError,
    );
    await assert.rejects(
        inspection.previewText({ contentId: textNode.content_id }),
        WorldChangesetError,
    );

    for (const thrown of [new Error("proxy failure"), "proxy failure"]) {
        const proxy = new Proxy(
            { contentId: textNode.content_id },
            {
                getPrototypeOf: () => {
                    throw thrown;
                },
            },
        );
        await assert.rejects(inspection.readContent(proxy), WorldChangesetError);
        await assert.rejects(inspection.previewText(proxy), WorldChangesetError);
        await assert.rejects(
            async () => inspection.page(proxy as unknown as { limit: number }),
            WorldChangesetError,
        );
    }

    const symbolOptions = { contentId: textNode.content_id } as Record<PropertyKey, unknown>;
    symbolOptions[Symbol("extra")] = true;
    await assert.rejects(
        inspection.readContent(symbolOptions as unknown as { contentId: string }),
        WorldChangesetError,
    );
    const accessorOptions = {} as { contentId: string };
    Object.defineProperty(accessorOptions, "contentId", {
        enumerable: true,
        get: () => textNode.content_id,
    });
    await assert.rejects(inspection.readContent(accessorOptions), WorldChangesetError);
});

test("world changeset inspection rejects excessive exact-content move candidates", async (context) => {
    const root = await mkdtemp(path.join(tmpdir(), "shepherd-changeset-move-limit-"));
    context.after(() => rm(root, { force: true, recursive: true }));
    initializeWorkspace({ adopt: "none", initializeGit: false, rootPath: root });
    const source = path.join(root, "source");
    await mkdir(source);
    const sourceCount =
        Math.floor(Math.sqrt(WORLD_CHANGESET_INSPECTION_LIMITS.maxDerivedMoveCandidates)) + 1;
    const targetCount =
        Math.floor(WORLD_CHANGESET_INSPECTION_LIMITS.maxDerivedMoveCandidates / sourceCount) + 1;
    for (let index = 0; index < sourceCount; index += 1)
        await writeFile(path.join(source, `source-${index}.txt`), "equal\n");
    const binding = createWorkspaceBindings({
        bindings: [{ name: "source", root: "source" }],
        workspaceRoot: root,
    }).bindings[0];
    assert.ok(binding);
    const carrier = createReferenceCopyCarrier({ workspaceRoot: root });
    const base = await carrier.snapshot(binding);
    for (let index = 0; index < targetCount; index += 1)
        await writeFile(path.join(source, `target-${index}.txt`), "equal\n");
    const head = await carrier.snapshot(binding);
    await assert.rejects(
        createWorldChangesetInspection({ baseRevision: base, carrier, headRevision: head }),
        (error: unknown) =>
            error instanceof WorldChangesetError &&
            error.code === WORLD_CHANGESET_ERROR_CODES.limit,
    );
});
