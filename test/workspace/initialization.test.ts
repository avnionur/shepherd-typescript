import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
    chmod,
    mkdir,
    mkdtemp,
    readFile,
    realpath,
    rm,
    symlink,
    writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
    initializeWorkspace,
    openWorkspace,
    WorkspaceControlError,
    WorkspaceInitializationConflictError,
} from "../../src/index.ts";

test("initializeWorkspace creates reusable control state without inventing Git history", async (context) => {
    const rootPath = await temporaryWorkspace(context, "empty");
    await writeFile(path.join(rootPath, "README.md"), "retained\n");
    await chmod(path.join(rootPath, "README.md"), 0o755);
    await mkdir(path.join(rootPath, "empty-directory"));
    await mkdir(path.join(rootPath, "nested"));
    await writeFile(path.join(rootPath, "nested", "child.txt"), "nested\n");
    await symlink("README.md", path.join(rootPath, "readme-link"));

    const initialized = initializeWorkspace({ rootPath });
    const canonicalRoot = await realpath(rootPath);

    assert.equal(initialized.adoption.mode, "worktree");
    assert.equal(initialized.adoption.git_head, null);
    assert.match(initialized.adoption.baseline_ref ?? "", /^worktree:sha256:[0-9a-f]{64}$/u);
    assert.equal(initialized.git.repository_root, canonicalRoot);
    assert.equal(initialized.git.head, null);
    assert.equal(initialized.root_path, canonicalRoot);
    assert.equal(await readFile(path.join(rootPath, "README.md"), "utf8"), "retained\n");
    assert.throws(() => git(rootPath, "rev-parse", "HEAD"));
    assert.equal(Object.isFrozen(initialized), true);
    assert.equal(Object.isFrozen(initialized.adoption), true);
    assert.equal(Object.isFrozen(initialized.git), true);
    assert.deepEqual(openWorkspace(rootPath), initialized);
    assert.deepEqual(initializeWorkspace({ rootPath }), initialized);
});

test("initializeWorkspace distinguishes Git-HEAD and dirty-worktree adoption", async (context) => {
    const headRoot = await committedRepository(context, "head");
    const head = git(headRoot, "rev-parse", "HEAD");
    await writeFile(path.join(headRoot, "tracked.txt"), "dirty\n");
    await writeFile(path.join(headRoot, "untracked.txt"), "untracked\n");
    const indexBefore = await readFile(path.join(headRoot, ".git", "index"));
    const configBefore = await readFile(path.join(headRoot, ".git", "config"));
    const refsBefore = git(headRoot, "show-ref");

    const headState = initializeWorkspace({ adopt: "git-head", rootPath: headRoot });
    assert.deepEqual(headState.adoption, {
        baseline_ref: `git-head:${head}`,
        git_head: head,
        mode: "git-head",
    });
    assert.equal(await readFile(path.join(headRoot, "tracked.txt"), "utf8"), "dirty\n");
    assert.equal(git(headRoot, "rev-parse", "HEAD"), head);
    assert.deepEqual(await readFile(path.join(headRoot, ".git", "index")), indexBefore);
    assert.deepEqual(await readFile(path.join(headRoot, ".git", "config")), configBefore);
    assert.equal(git(headRoot, "show-ref"), refsBefore);
    git(headRoot, "add", "tracked.txt", "untracked.txt");
    git(headRoot, "commit", "-m", "advance after adoption");
    assert.deepEqual(
        initializeWorkspace({ adopt: "git-head", rootPath: headRoot }).adoption,
        headState.adoption,
    );
    const currentHeadRef = git(headRoot, "symbolic-ref", "HEAD");
    git(headRoot, "update-ref", "-d", currentHeadRef);
    assert.deepEqual(
        initializeWorkspace({ adopt: "git-head", rootPath: headRoot }).adoption,
        headState.adoption,
    );

    const worktreeRoot = await committedRepository(context, "worktree");
    const worktreeHead = git(worktreeRoot, "rev-parse", "HEAD");
    await writeFile(path.join(worktreeRoot, "tracked.txt"), "dirty\n");
    const worktreeState = initializeWorkspace({ adopt: "worktree", rootPath: worktreeRoot });
    assert.deepEqual(worktreeState.adoption, {
        baseline_ref: worktreeState.adoption.baseline_ref,
        git_head: worktreeHead,
        mode: "worktree",
    });
    assert.match(worktreeState.adoption.baseline_ref ?? "", /^worktree:sha256:[0-9a-f]{64}$/u);
    assert.equal(await readFile(path.join(worktreeRoot, "tracked.txt"), "utf8"), "dirty\n");
    assert.equal(git(worktreeRoot, "rev-parse", "HEAD"), worktreeHead);
    if (process.platform !== "win32") {
        const unsupportedPath = path.join(worktreeRoot, "later-fifo");
        execFileSync("mkfifo", [unsupportedPath]);
        assert.deepEqual(
            initializeWorkspace({ adopt: "worktree", rootPath: worktreeRoot }).adoption,
            worktreeState.adoption,
        );
    }
});

test("worktree adoption identity is order-independent and content-sensitive", async (context) => {
    const firstRoot = await temporaryWorkspace(context, "identity-first");
    const secondRoot = await temporaryWorkspace(context, "identity-second");
    const changedRoot = await temporaryWorkspace(context, "identity-changed");
    await writeFile(path.join(firstRoot, "b.txt"), "second\n");
    await writeFile(path.join(firstRoot, "a.txt"), "first\n");
    await writeFile(path.join(secondRoot, "a.txt"), "first\n");
    await writeFile(path.join(secondRoot, "b.txt"), "second\n");
    await writeFile(path.join(changedRoot, "a.txt"), "changed\n");
    await writeFile(path.join(changedRoot, "b.txt"), "second\n");

    const first = initializeWorkspace({ initializeGit: false, rootPath: firstRoot });
    const second = initializeWorkspace({ initializeGit: false, rootPath: secondRoot });
    const changed = initializeWorkspace({ initializeGit: false, rootPath: changedRoot });

    assert.equal(first.adoption.baseline_ref, second.adoption.baseline_ref);
    assert.notEqual(first.adoption.baseline_ref, changed.adoption.baseline_ref);
});

test("initializeWorkspace supports explicit non-adoption without initializing Git", async (context) => {
    const rootPath = await temporaryWorkspace(context, "none");

    const initialized = initializeWorkspace({
        adopt: "none",
        initializeGit: false,
        rootPath,
    });

    assert.deepEqual(initialized.adoption, { baseline_ref: null, git_head: null, mode: "none" });
    assert.deepEqual(initialized.git, { head: null, repository_root: null });
    await assert.rejects(readFile(path.join(rootPath, ".git", "HEAD")));
});

test("workspace control opens fail closed for conflicts, malformed metadata, and symlinks", async (context) => {
    const conflictRoot = await temporaryWorkspace(context, "conflict");
    initializeWorkspace({ adopt: "none", initializeGit: false, rootPath: conflictRoot });
    assert.throws(
        () => initializeWorkspace({ adopt: "worktree", rootPath: conflictRoot }),
        WorkspaceInitializationConflictError,
    );

    const malformedRoot = await temporaryWorkspace(context, "malformed");
    await mkdir(path.join(malformedRoot, ".vcscore"));
    await writeFile(path.join(malformedRoot, ".vcscore", "workspace.json"), "{}\n");
    assert.throws(() => openWorkspace(malformedRoot), WorkspaceControlError);

    const symlinkRoot = await temporaryWorkspace(context, "symlink");
    const outside = await temporaryWorkspace(context, "outside");
    await symlink(outside, path.join(symlinkRoot, ".vcscore"));
    assert.throws(() => initializeWorkspace({ rootPath: symlinkRoot }), WorkspaceControlError);
});

test("workspace initialization validates closed inputs and required Git evidence", async (context) => {
    const rootPath = await temporaryWorkspace(context, "validation");
    for (const malformed of [
        null,
        [],
        new Date(),
        {},
        { rootPath: 1 },
        { rootPath: "", extra: true },
        { rootPath, extra: true },
        { rootPath, adopt: "unknown" },
        { rootPath, adopt: 1 },
        { rootPath, initializeGit: "yes" },
        Object.defineProperty({ rootPath }, "adopt", { enumerable: true, get: () => "none" }),
    ]) {
        assert.throws(() => initializeWorkspace(malformed as never), TypeError);
    }
    assert.throws(() => openWorkspace(""), TypeError);
    assert.throws(() => openWorkspace(path.join(rootPath, "missing")), WorkspaceControlError);
    const filePath = path.join(rootPath, "file.txt");
    await writeFile(filePath, "not a directory");
    assert.throws(() => openWorkspace(filePath), WorkspaceControlError);
    assert.throws(() => openWorkspace(rootPath), WorkspaceControlError);
    assert.throws(
        () => initializeWorkspace({ adopt: "git-head", rootPath }),
        WorkspaceControlError,
    );

    const failedGitRoot = await temporaryWorkspace(context, "failed-git");
    await writeFile(path.join(failedGitRoot, ".git"), "not a repository");
    assert.throws(() => initializeWorkspace({ rootPath: failedGitRoot }), WorkspaceControlError);

    if (process.platform !== "win32") {
        const unsupportedRoot = await temporaryWorkspace(context, "unsupported-entry");
        execFileSync("mkfifo", [path.join(unsupportedRoot, "unsupported-fifo")]);
        assert.throws(
            () => initializeWorkspace({ initializeGit: false, rootPath: unsupportedRoot }),
            WorkspaceControlError,
        );
    }

    const priorPath = process.env.PATH ?? "";
    process.env.PATH = "";
    try {
        const unavailableGitRoot = await temporaryWorkspace(context, "unavailable-git");
        assert.throws(
            () => initializeWorkspace({ rootPath: unavailableGitRoot }),
            WorkspaceControlError,
        );
    } finally {
        process.env.PATH = priorPath;
    }
});

test("openWorkspace rejects drifted Git and every malformed manifest field", async (context) => {
    const gitRoot = await committedRepository(context, "lost-git");
    initializeWorkspace({ adopt: "git-head", rootPath: gitRoot });
    await rm(path.join(gitRoot, ".git"), { force: true, recursive: true });
    assert.throws(() => openWorkspace(gitRoot), WorkspaceControlError);
    git(gitRoot, "init");
    assert.throws(() => openWorkspace(gitRoot), WorkspaceControlError);

    const worktreeGitRoot = await committedRepository(context, "lost-worktree-git");
    initializeWorkspace({ adopt: "worktree", initializeGit: false, rootPath: worktreeGitRoot });
    await rm(path.join(worktreeGitRoot, ".git"), { force: true, recursive: true });
    assert.throws(() => openWorkspace(worktreeGitRoot), WorkspaceControlError);

    const rootPath = await temporaryWorkspace(context, "manifest-shapes");
    initializeWorkspace({ adopt: "none", initializeGit: false, rootPath });
    const manifestPath = path.join(rootPath, ".vcscore", "workspace.json");
    const valid = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
    const malformed: readonly unknown[] = [
        null,
        [],
        {},
        { ...valid, extra: true },
        { ...valid, format: "other" },
        { ...valid, format_version: 2 },
        { ...valid, initialize_git: "yes" },
        { ...valid, adopt_mode: 1 },
        { ...valid, adopt_mode: "unknown" },
        { ...valid, baseline_ref: 1 },
        { ...valid, git_head: 1 },
        { ...valid, git_head: "short" },
        { ...valid, adopt_mode: "none", git_head: "a".repeat(40) },
        { ...valid, adopt_mode: "none", baseline_ref: "unexpected" },
        { ...valid, adopt_mode: "git-head", git_head: null },
        { ...valid, adopt_mode: "git-head", git_head: "a".repeat(40) },
        { ...valid, adopt_mode: "worktree", baseline_ref: null },
        { ...valid, adopt_mode: "worktree", baseline_ref: "worktree:sha256:short" },
        { ...valid, adopt_mode: "worktree", baseline_ref: `worktree:sha256:${"g".repeat(64)}` },
    ];
    for (const value of malformed) {
        await writeFile(manifestPath, `${JSON.stringify(value)}\n`);
        assert.throws(() => openWorkspace(rootPath), WorkspaceControlError);
    }
    await writeFile(manifestPath, "not json\n");
    assert.throws(() => openWorkspace(rootPath), WorkspaceControlError);
    await rm(manifestPath);
    await mkdir(manifestPath);
    assert.throws(() => openWorkspace(rootPath), WorkspaceControlError);
    await rm(manifestPath, { recursive: true });
    const target = path.join(rootPath, "manifest-target.json");
    await writeFile(target, `${JSON.stringify(valid)}\n`);
    await symlink(target, manifestPath);
    assert.throws(() => openWorkspace(rootPath), WorkspaceControlError);

    const error = new WorkspaceControlError();
    const conflict = new WorkspaceInitializationConflictError();
    assert.equal(error.code, "WORKSPACE_CONTROL_ERROR");
    assert.equal(conflict.code, "WORKSPACE_INITIALIZATION_CONFLICT");
});

async function temporaryWorkspace(
    context: { after: (callback: () => Promise<void>) => void },
    name: string,
): Promise<string> {
    const rootPath = await mkdtemp(path.join(tmpdir(), `shepherd-workspace-${name}-`));
    context.after(() => rm(rootPath, { force: true, recursive: true }));
    return rootPath;
}

async function committedRepository(
    context: { after: (callback: () => Promise<void>) => void },
    name: string,
): Promise<string> {
    const rootPath = await temporaryWorkspace(context, name);
    git(rootPath, "init");
    git(rootPath, "config", "user.email", "test@example.com");
    git(rootPath, "config", "user.name", "Test User");
    await writeFile(path.join(rootPath, "tracked.txt"), "baseline\n");
    git(rootPath, "add", "tracked.txt");
    git(rootPath, "commit", "-m", "baseline");
    return rootPath;
}

function git(rootPath: string, ...args: readonly string[]): string {
    return execFileSync("git", ["-C", rootPath, ...args], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
    }).trim();
}
