import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
    createGitAwareCustody,
    createGitChangesetInspection,
    createWorkspaceBindings,
    initializeWorkspace,
    WorldChangesetError,
} from "../../src/index.ts";

test("Git changeset inspection presents clean Gitlink changes outside canonical world identity", async (context) => {
    const parent = await repository(context, "git-inspection-parent");
    const module = await repository(context, "git-inspection-module");
    git(module, "commit", "--allow-empty", "-m", "module base");
    execFileSync(
        "git",
        ["-c", "protocol.file.allow=always", "-C", parent, "submodule", "add", module, "module"],
        { stdio: ["ignore", "pipe", "pipe"] },
    );
    execFileSync(
        "git",
        [
            "-c",
            "protocol.file.allow=always",
            "-C",
            parent,
            "submodule",
            "add",
            module,
            "module-two",
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
    );
    git(parent, "commit", "-m", "add module");
    git(path.join(parent, "module"), "config", "user.name", "Shepherd Test");
    git(path.join(parent, "module"), "config", "user.email", "test@example.invalid");
    await writeFile(path.join(parent, "target-one.txt"), "one\n");
    await writeFile(path.join(parent, "target-two.txt"), "two\n");
    await symlink("target-one.txt", path.join(parent, "pointer"));
    git(parent, "add", "pointer", "target-one.txt", "target-two.txt");
    git(parent, "commit", "-m", "add symlink");
    initializeWorkspace({ adopt: "worktree", rootPath: parent });
    const binding = createWorkspaceBindings({
        bindings: [{ name: "repository", root: "." }],
        workspaceRoot: parent,
    }).bindings[0];
    assert.ok(binding);
    const custody = createGitAwareCustody({ workspaceRoot: parent });
    const base = await custody.capture(binding);
    assert.ok(base);

    await writeFile(path.join(parent, "module", "change.txt"), "next\n");
    git(path.join(parent, "module"), "add", "change.txt");
    git(path.join(parent, "module"), "commit", "-m", "module next");
    git(parent, "add", "module");
    await unlink(path.join(parent, "pointer"));
    await symlink("target-two.txt", path.join(parent, "pointer"));
    git(parent, "add", "pointer");
    git(parent, "commit", "-m", "update module");
    const head = await custody.capture(binding);
    assert.ok(head);

    const inspection = await createGitChangesetInspection({
        baseCustodyId: base.custody.custody_id,
        headCustodyId: head.custody.custody_id,
        workspaceRoot: parent,
    });
    assert.deepEqual(inspection.world.changeset.changed_paths, ["pointer"]);
    assert.equal(inspection.world.change("module"), null);
    assert.deepEqual(inspection.git_changes, [
        {
            after: {
                commit_oid: head.basis.index?.entries.find((entry) => entry.path === "module")
                    ?.object_id,
                kind: "gitlink",
                mode: "160000",
            },
            before: {
                commit_oid: base.basis.index?.entries.find((entry) => entry.path === "module")
                    ?.object_id,
                kind: "gitlink",
                mode: "160000",
            },
            operation: "modify",
            path: "module",
        },
    ]);
    assert.deepEqual(inspection.symlink_modes, [
        { after_mode: "120000", before_mode: "120000", path: "pointer" },
    ]);

    git(parent, "rm", "-f", "module");
    await writeFile(path.join(parent, "module"), "ordinary file\n");
    git(parent, "add", "module");
    git(parent, "commit", "-m", "replace module with file");
    const fileOutput = await custody.capture(binding);
    assert.ok(fileOutput);
    const gitlinkToFile = await createGitChangesetInspection({
        baseCustodyId: head.custody.custody_id,
        headCustodyId: fileOutput.custody.custody_id,
        workspaceRoot: parent,
    });
    assert.equal(gitlinkToFile.git_changes[0]?.operation, "replace");
    assert.equal(gitlinkToFile.git_changes[0]?.before?.kind, "gitlink");
    assert.equal(gitlinkToFile.git_changes[0]?.after?.kind, "file");
    const fileToGitlink = await createGitChangesetInspection({
        baseCustodyId: fileOutput.custody.custody_id,
        headCustodyId: head.custody.custody_id,
        workspaceRoot: parent,
    });
    assert.equal(fileToGitlink.git_changes[0]?.operation, "replace");
    assert.equal(fileToGitlink.git_changes[0]?.before?.kind, "file");
    assert.equal(fileToGitlink.git_changes[0]?.after?.kind, "gitlink");

    await rm(path.join(parent, "module"));
    git(parent, "rm", "module");
    git(parent, "commit", "-m", "remove module path");
    const absentOutput = await custody.capture(binding);
    assert.ok(absentOutput);
    const deleted = await createGitChangesetInspection({
        baseCustodyId: head.custody.custody_id,
        headCustodyId: absentOutput.custody.custody_id,
        workspaceRoot: parent,
    });
    assert.equal(deleted.git_changes[0]?.operation, "delete");
    const added = await createGitChangesetInspection({
        baseCustodyId: absentOutput.custody.custody_id,
        headCustodyId: head.custody.custody_id,
        workspaceRoot: parent,
    });
    assert.equal(added.git_changes[0]?.operation, "add");

    await unlink(path.join(parent, "pointer"));
    await writeFile(path.join(parent, "pointer"), "ordinary pointer file\n");
    git(parent, "add", "pointer");
    git(parent, "commit", "-m", "replace symlink with file");
    const pointerFileOutput = await custody.capture(binding);
    assert.ok(pointerFileOutput);
    const symlinkToFile = await createGitChangesetInspection({
        baseCustodyId: head.custody.custody_id,
        headCustodyId: pointerFileOutput.custody.custody_id,
        workspaceRoot: parent,
    });
    assert.deepEqual(
        symlinkToFile.symlink_modes.find((entry) => entry.path === "pointer"),
        { after_mode: null, before_mode: "120000", path: "pointer" },
    );
    const fileToSymlink = await createGitChangesetInspection({
        baseCustodyId: pointerFileOutput.custody.custody_id,
        headCustodyId: head.custody.custody_id,
        workspaceRoot: parent,
    });
    assert.deepEqual(
        fileToSymlink.symlink_modes.find((entry) => entry.path === "pointer"),
        { after_mode: "120000", before_mode: null, path: "pointer" },
    );

    await assert.rejects(
        createGitChangesetInspection({
            baseCustodyId: "missing",
            headCustodyId: "missing",
            workspaceRoot: parent,
        }),
        WorldChangesetError,
    );
    await assert.rejects(
        createGitChangesetInspection({
            baseCustodyId: base.custody.custody_id,
            extra: true,
            headCustodyId: head.custody.custody_id,
            workspaceRoot: parent,
        } as Parameters<typeof createGitChangesetInspection>[0]),
        WorldChangesetError,
    );
    const validOptions = {
        baseCustodyId: base.custody.custody_id,
        headCustodyId: head.custody.custody_id,
        workspaceRoot: parent,
    };
    const malformedOptions: unknown[] = [
        null,
        "invalid",
        [],
        Object.assign(Object.create({ inherited: true }), validOptions),
        { ...validOptions, baseCustodyId: 1 },
    ];
    const symbolOptions = { ...validOptions } as Record<PropertyKey, unknown>;
    symbolOptions[Symbol("extra")] = true;
    malformedOptions.push(symbolOptions);
    const accessorOptions = { ...validOptions };
    Object.defineProperty(accessorOptions, "workspaceRoot", {
        enumerable: true,
        get: () => parent,
    });
    malformedOptions.push(accessorOptions);
    for (const malformed of malformedOptions)
        await assert.rejects(
            createGitChangesetInspection(malformed as typeof validOptions),
            WorldChangesetError,
        );
    for (const thrown of [new Error("proxy failure"), "proxy failure"])
        await assert.rejects(
            createGitChangesetInspection(
                new Proxy(validOptions, {
                    getPrototypeOf: () => {
                        throw thrown;
                    },
                }),
            ),
            WorldChangesetError,
        );
});

test("Git changeset inspection accepts authenticated git-head custody without index projections", async (context) => {
    const root = await repository(context, "git-inspection-head");
    await writeFile(path.join(root, "tracked.txt"), "tracked\n");
    git(root, "add", "tracked.txt");
    git(root, "commit", "-m", "tracked");
    initializeWorkspace({ adopt: "git-head", rootPath: root });
    const binding = createWorkspaceBindings({
        bindings: [{ name: "repository", root: "." }],
        workspaceRoot: root,
    }).bindings[0];
    assert.ok(binding);
    const retained = await createGitAwareCustody({ workspaceRoot: root }).capture(binding);
    assert.ok(retained);
    const inspection = await createGitChangesetInspection({
        baseCustodyId: retained.custody.custody_id,
        headCustodyId: retained.custody.custody_id,
        workspaceRoot: root,
    });
    assert.deepEqual(inspection.git_changes, []);
    assert.deepEqual(inspection.symlink_modes, []);
});

async function repository(context: { after(callback: () => void): void }, prefix: string) {
    const root = await mkdtemp(path.join(tmpdir(), `${prefix}-`));
    context.after(() => rm(root, { force: true, recursive: true }));
    await mkdir(root, { recursive: true });
    git(root, "init");
    git(root, "config", "user.name", "Shepherd Test");
    git(root, "config", "user.email", "test@example.invalid");
    return root;
}

function git(root: string, ...args: string[]): string {
    return execFileSync("git", ["-C", root, ...args], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
    }).trim();
}
