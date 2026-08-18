import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
    access,
    mkdir,
    mkdtemp,
    readdir,
    realpath,
    rename,
    rm,
    symlink,
    writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
    createGitAwareCustody,
    createGitRepositoryBindings,
    GitCustodyError,
    initializeWorkspace,
    WorkspaceBindingError,
    WorkspaceControlError,
} from "../../src/index.ts";
import { workspaceProtocolConfig } from "../../src/protocol/config.ts";

test("repository bindings retain stable disjoint authorities and independent Git custody", async (context) => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "shepherd-repository-bindings-"));
    context.after(() => rm(workspaceRoot, { force: true, recursive: true }));
    initializeWorkspace({ adopt: "worktree", initializeGit: false, rootPath: workspaceRoot });
    const firstRoot = await repository(workspaceRoot, "first");
    const secondRoot = await repository(workspaceRoot, "second");

    const bindings = createGitRepositoryBindings({
        bindings: [
            { name: "first", root: "first" },
            { name: "second", root: "second" },
        ],
        workspaceRoot,
    });
    const reopened = createGitRepositoryBindings({
        bindings: [
            { name: "second", root: secondRoot },
            { name: "first", root: firstRoot },
        ],
        workspaceRoot,
    });

    assert.equal(bindings.repository_binding_version, 1);
    assert.deepEqual(
        Object.fromEntries(bindings.bindings.map((binding) => [binding.name, binding.resource_id])),
        Object.fromEntries(reopened.bindings.map((binding) => [binding.name, binding.resource_id])),
    );
    assert.equal(
        repositoryResourceInChild(workspaceRoot, firstRoot, "first"),
        bindings.bindings[0]?.resource_id,
    );
    assert.equal(bindings.bindings[0]?.resource_type, "git-repository");
    assert.equal(bindings.bindings[0]?.repository.root, firstRoot);
    assert.equal(bindings.bindings[1]?.repository.root, secondRoot);
    assert.notEqual(
        bindings.bindings[0]?.repository.repository_id,
        bindings.bindings[1]?.repository.repository_id,
    );
    assert.equal(Object.isFrozen(bindings), true);
    assert.equal(Object.isFrozen(bindings.bindings), true);
    assert.equal(Object.isFrozen(bindings.bindings[0]?.repository), true);

    const custody = createGitAwareCustody({ workspaceRoot });
    await assert.rejects(
        custody.capture({ ...bindings.bindings[0] } as NonNullable<(typeof bindings.bindings)[0]>),
        GitCustodyError,
    );
    const retained = await Promise.all(
        bindings.bindings.map((binding) => custody.capture(binding)),
    );
    const firstRetained = retained[0];
    const secondRetained = retained[1];
    assert.ok(firstRetained);
    assert.ok(secondRetained);
    assert.equal(firstRetained.basis.repository.root, firstRoot);
    assert.equal(secondRetained.basis.repository.root, secondRoot);
    assert.equal(
        firstRetained.basis.repository.repository_id,
        bindings.bindings[0]?.repository.repository_id,
    );
    assert.equal(
        secondRetained.basis.repository.repository_id,
        bindings.bindings[1]?.repository.repository_id,
    );
    const repeated = await custody.capture(
        bindings.bindings[0] as NonNullable<(typeof bindings.bindings)[0]>,
    );
    assert.equal(
        repeated?.basis.repository.repository_id,
        firstRetained.basis.repository.repository_id,
    );
    assert.deepEqual(
        await createGitAwareCustody({ workspaceRoot }).open(firstRetained.custody.custody_id),
        firstRetained,
    );
    await assert.rejects(access(path.join(firstRoot, workspaceProtocolConfig.controlDirectory)));
    await assert.rejects(access(path.join(secondRoot, workspaceProtocolConfig.controlDirectory)));
    assert.equal(git(firstRoot, "status", "--porcelain=v1"), "");
    assert.equal(git(secondRoot, "status", "--porcelain=v1"), "");
    assert.equal(
        (
            await readdir(
                path.join(
                    workspaceRoot,
                    workspaceProtocolConfig.controlDirectory,
                    workspaceProtocolConfig.repositoryBindings.identityDirectory,
                ),
            )
        ).length,
        2,
    );

    await writeFile(path.join(secondRoot, "tracked.txt"), "moved\n");
    assert.equal((await custody.verify(firstRetained.custody.custody_id)).basis_moved, false);
    assert.equal((await custody.verify(secondRetained.custody.custody_id)).basis_moved, true);
});

test("repository bindings fail closed for ambiguous repository authority", async (context) => {
    const workspaceRoot = await mkdtemp(
        path.join(tmpdir(), "shepherd-repository-binding-boundaries-"),
    );
    context.after(() => rm(workspaceRoot, { force: true, recursive: true }));
    initializeWorkspace({ adopt: "worktree", initializeGit: false, rootPath: workspaceRoot });
    const repositoryRoot = await repository(workspaceRoot, "repository");
    await mkdir(path.join(workspaceRoot, "ordinary"));
    git(workspaceRoot, "init", "--bare", "bare.git");
    git(
        workspaceRoot,
        "init",
        "--separate-git-dir",
        path.join(workspaceRoot, "separate-admin"),
        "separate-worktree",
    );
    await mkdir(path.join(repositoryRoot, "nested"));
    await symlink(
        process.platform === "win32" ? repositoryRoot : "repository",
        path.join(workspaceRoot, "repository-alias"),
        process.platform === "win32" ? "junction" : "dir",
    );

    for (const malformed of [
        null,
        [],
        {
            bindings: [{ extra: true, name: "repository", root: "repository" }],
            workspaceRoot,
        },
    ]) {
        assert.throws(() => createGitRepositoryBindings(malformed as never), TypeError);
    }

    assert.throws(
        () =>
            createGitRepositoryBindings({
                bindings: [{ name: "separate", root: "separate-worktree" }],
                workspaceRoot,
            }),
        (error: unknown) =>
            error instanceof WorkspaceBindingError &&
            error.code === "WORKSPACE_REPOSITORY_BINDING_INVALID",
    );
    assert.throws(
        () =>
            createGitRepositoryBindings({
                bindings: [{ name: "ordinary", root: "ordinary" }],
                workspaceRoot,
            }),
        (error: unknown) =>
            error instanceof WorkspaceBindingError &&
            error.code === "WORKSPACE_REPOSITORY_BINDING_INVALID",
    );
    assert.throws(
        () =>
            createGitRepositoryBindings({
                bindings: [{ name: "bare", root: "bare.git" }],
                workspaceRoot,
            }),
        (error: unknown) =>
            error instanceof WorkspaceBindingError &&
            error.code === "WORKSPACE_REPOSITORY_BINDING_INVALID",
    );
    assert.throws(
        () =>
            createGitRepositoryBindings({
                bindings: [{ name: "nested", root: "repository/nested" }],
                workspaceRoot,
            }),
        (error: unknown) =>
            error instanceof WorkspaceBindingError &&
            error.code === "WORKSPACE_REPOSITORY_BINDING_INVALID",
    );
    assert.throws(
        () =>
            createGitRepositoryBindings({
                bindings: [
                    { name: "repository", root: "repository" },
                    { name: "alias", root: "repository-alias" },
                ],
                workspaceRoot,
            }),
        (error: unknown) =>
            error instanceof WorkspaceBindingError &&
            error.code === "WORKSPACE_BINDING_ROOT_OVERLAP",
    );

    git(repositoryRoot, "branch", "linked");
    const linkedRoot = path.join(workspaceRoot, "linked");
    git(repositoryRoot, "worktree", "add", linkedRoot, "linked");
    const individual = createGitRepositoryBindings({
        bindings: [{ name: "repository", root: repositoryRoot }],
        workspaceRoot,
    }).bindings[0];
    assert.ok(individual);
    assert.throws(
        () =>
            createGitRepositoryBindings({
                bindings: [{ name: "linked", root: linkedRoot }],
                workspaceRoot,
            }),
        (error: unknown) =>
            error instanceof WorkspaceBindingError &&
            error.code === "WORKSPACE_REPOSITORY_BINDING_INVALID",
    );
    assert.throws(
        () =>
            createGitRepositoryBindings({
                bindings: [
                    { name: "repository", root: repositoryRoot },
                    { name: "linked", root: linkedRoot },
                ],
                workspaceRoot,
            }),
        (error: unknown) =>
            error instanceof WorkspaceBindingError &&
            error.code === "WORKSPACE_REPOSITORY_BINDING_INVALID",
    );

    const moduleSource = await repository(workspaceRoot, "module-source");
    const superproject = await repository(workspaceRoot, "superproject");
    git(
        superproject,
        "-c",
        "protocol.file.allow=always",
        "submodule",
        "add",
        moduleSource,
        "module",
    );
    git(superproject, "commit", "-m", "add module");
    const superBinding = createGitRepositoryBindings({
        bindings: [{ name: "superproject", root: superproject }],
        workspaceRoot,
    }).bindings[0];
    assert.ok(superBinding);
    assert.throws(
        () =>
            createGitRepositoryBindings({
                bindings: [{ name: "module", root: path.join(superproject, "module") }],
                workspaceRoot,
            }),
        (error: unknown) =>
            error instanceof WorkspaceBindingError &&
            error.code === "WORKSPACE_REPOSITORY_BINDING_INVALID",
    );
    assert.throws(
        () =>
            createGitRepositoryBindings({
                bindings: [
                    { name: "superproject", root: superproject },
                    { name: "module", root: path.join(superproject, "module") },
                ],
                workspaceRoot,
            }),
        (error: unknown) =>
            error instanceof WorkspaceBindingError &&
            error.code === "WORKSPACE_BINDING_ROOT_OVERLAP",
    );
    const retainedSuperproject = await createGitAwareCustody({ workspaceRoot }).capture(
        superBinding,
    );
    assert.ok(retainedSuperproject);
    assert.equal(
        retainedSuperproject.revision.manifest.some(({ path: relative }) =>
            relative.startsWith("module/"),
        ),
        false,
    );
});

test("Git custody rejects a structurally copied repository authority", async (context) => {
    const parent = await mkdtemp(path.join(tmpdir(), "shepherd-repository-binding-forgery-"));
    context.after(() => rm(parent, { force: true, recursive: true }));
    const workspaceRoot = await repository(parent, "workspace");
    initializeWorkspace({ adopt: "worktree", rootPath: workspaceRoot });
    const binding = createGitRepositoryBindings({
        bindings: [{ name: "repository", root: "." }],
        workspaceRoot,
    }).bindings[0];
    assert.ok(binding);
    const custody = createGitAwareCustody({ workspaceRoot });
    assert.ok(await custody.capture(binding));

    await assert.rejects(custody.capture({ ...binding }), GitCustodyError);

    await rename(path.join(workspaceRoot, ".git"), path.join(workspaceRoot, ".git-replaced"));
    git(workspaceRoot, "init");
    git(workspaceRoot, "config", "user.email", "test@example.invalid");
    git(workspaceRoot, "config", "user.name", "Shepherd Test");
    git(workspaceRoot, "add", "tracked.txt");
    git(workspaceRoot, "commit", "-m", "replacement repository");
    assert.throws(
        () =>
            createGitRepositoryBindings({
                bindings: [{ name: "repository", root: "." }],
                workspaceRoot,
            }),
        WorkspaceControlError,
    );
    await assert.rejects(custody.capture(binding), GitCustodyError);
});

test("Git custody rejects a substituted repository identity directory", async (context) => {
    const workspaceRoot = await mkdtemp(
        path.join(tmpdir(), "shepherd-repository-binding-identity-"),
    );
    context.after(() => rm(workspaceRoot, { force: true, recursive: true }));
    initializeWorkspace({ adopt: "worktree", initializeGit: false, rootPath: workspaceRoot });
    const repositoryRoot = await repository(workspaceRoot, "repository");
    const binding = createGitRepositoryBindings({
        bindings: [{ name: "repository", root: repositoryRoot }],
        workspaceRoot,
    }).bindings[0];
    assert.ok(binding);
    const outside = path.join(workspaceRoot, "outside");
    await mkdir(outside);
    await writeFile(path.join(outside, "preserved.txt"), "preserved\n");
    await symlink(
        outside,
        path.join(
            workspaceRoot,
            workspaceProtocolConfig.controlDirectory,
            workspaceProtocolConfig.repositoryBindings.identityDirectory,
        ),
        process.platform === "win32" ? "junction" : "dir",
    );

    await assert.rejects(
        createGitAwareCustody({ workspaceRoot }).capture(binding),
        GitCustodyError,
    );
    await access(path.join(outside, "preserved.txt"));
});

async function repository(workspaceRoot: string, name: string): Promise<string> {
    const root = path.join(workspaceRoot, name);
    await mkdir(root);
    git(root, "init");
    git(root, "config", "user.email", "test@example.invalid");
    git(root, "config", "user.name", "Shepherd Test");
    await writeFile(path.join(root, "tracked.txt"), `${name}\n`);
    git(root, "add", "tracked.txt");
    git(root, "commit", "-m", "baseline");
    return realpath(root);
}

function git(root: string, ...args: readonly string[]): string {
    return execFileSync("git", ["-C", root, ...args], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
    }).trim();
}

function repositoryResourceInChild(workspaceRoot: string, root: string, name: string): string {
    const program = `
        import { createGitRepositoryBindings } from ${JSON.stringify(new URL("../../src/index.ts", import.meta.url).href)};
        const [workspaceRoot, root, name] = process.argv.slice(1);
        const binding = createGitRepositoryBindings({ bindings: [{ name, root }], workspaceRoot }).bindings[0];
        console.log(binding.resource_id);
    `;
    return execFileSync(
        process.execPath,
        ["--input-type=module", "-e", program, workspaceRoot, root, name],
        {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
        },
    ).trim();
}
