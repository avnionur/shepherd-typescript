import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { createGitRepositoryBindings, initializeWorkspace } from "../../src/index.ts";
import { workspaceProtocolConfig } from "../../src/protocol/config.ts";
import { gitCommandArguments, gitCommandEnvironment } from "../../src/workspace/git-command.ts";

const invocation = workspaceProtocolConfig.gitInvocation;

function git(root: string, ...args: readonly string[]): string {
    return execFileSync("git", ["-C", root, ...args], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
    }).trim();
}

async function hostileRepository(parent: string, name: string, marker: string): Promise<string> {
    const root = path.join(parent, name);
    await mkdir(root);
    git(root, "init", "--quiet");
    git(root, "config", "user.email", "test@example.invalid");
    git(root, "config", "user.name", "Shepherd Test");
    await writeFile(path.join(root, "tracked.txt"), `${name}\n`);
    git(root, "add", "tracked.txt");
    git(root, "commit", "--quiet", "-m", "baseline");
    // Repository configuration that names a helper program run by index-refreshing commands.
    const hook = path.join(parent, `${name}-fsmonitor.sh`);
    await writeFile(hook, `#!/bin/sh\ntouch '${marker}'\nexit 1\n`);
    await chmod(hook, 0o700);
    git(root, "config", "core.fsmonitor", hook);
    return realpath(root);
}

test("Git subprocess arguments pin configured options before the working directory", () => {
    assert.deepEqual(gitCommandArguments("/repo", ["status"]), [
        ...invocation.configOverrides.flatMap((entry) => ["-c", entry]),
        "-C",
        "/repo",
        "status",
    ]);
    assert.ok(invocation.configOverrides.includes("core.fsmonitor=false"));
});

test("Git subprocess environment drops inherited GIT_ variables and sets configured ones", (context) => {
    const saved = { ...process.env };
    context.after(() => {
        for (const name of Object.keys(process.env)) if (!(name in saved)) delete process.env[name];
        Object.assign(process.env, saved);
    });
    process.env.GIT_DIR = "/elsewhere/.git";
    process.env.GIT_CONFIG_PARAMETERS = "'core.fsmonitor'='/tmp/hook'";
    process.env.GIT_OPTIONAL_LOCKS = "1";
    process.env.SHEPHERD_KEPT_VARIABLE = "kept";

    const environment = gitCommandEnvironment();

    assert.equal(environment.GIT_DIR, undefined);
    assert.equal(environment.GIT_CONFIG_PARAMETERS, undefined);
    assert.equal(environment.SHEPHERD_KEPT_VARIABLE, "kept");
    for (const [name, value] of Object.entries(invocation.environment)) {
        assert.equal(environment[name], value);
    }
    for (const name of Object.keys(environment)) {
        if (name in invocation.environment) continue;
        assert.equal(
            invocation.removedEnvironmentPrefixes.some((prefix) => name.startsWith(prefix)),
            false,
            name,
        );
    }
});

test("hostile repository configuration and environment cannot steer pinned Git reads", async (context) => {
    const parent = await realpath(await mkdtemp(path.join(tmpdir(), "shepherd-git-command-")));
    context.after(() => rm(parent, { force: true, recursive: true }));
    const marker = path.join(parent, "fsmonitor-ran");
    const workspaceRoot = path.join(parent, "workspace");
    await mkdir(workspaceRoot);
    initializeWorkspace({ adopt: "worktree", initializeGit: false, rootPath: workspaceRoot });
    const repositoryRoot = await hostileRepository(workspaceRoot, "source", marker);
    const decoyRoot = await hostileRepository(parent, "decoy", path.join(parent, "decoy-ran"));

    // Control: an unpinned index refresh runs the repository's fsmonitor helper.
    spawnSync("git", ["-C", repositoryRoot, "status", "--porcelain"], { stdio: "ignore" });
    assert.equal(existsSync(marker), true);
    await rm(marker);

    // The pinned invocation does not, even with the hook also injected through the environment.
    const saved = { ...process.env };
    context.after(() => {
        for (const name of Object.keys(process.env)) if (!(name in saved)) delete process.env[name];
        Object.assign(process.env, saved);
    });
    process.env.GIT_CONFIG_PARAMETERS = `'core.fsmonitor'='${path.join(parent, "source-fsmonitor.sh")}'`;
    process.env.GIT_DIR = path.join(decoyRoot, ".git");
    const pinned = spawnSync(
        "git",
        gitCommandArguments(repositoryRoot, ["status", "--porcelain"]),
        { env: gitCommandEnvironment(), stdio: "ignore" },
    );
    assert.equal(pinned.status, 0);
    assert.equal(existsSync(marker), false);

    // Bindings resolve the named repository, not the one GIT_DIR points at.
    const binding = createGitRepositoryBindings({
        bindings: [{ name: "source", root: "source" }],
        workspaceRoot,
    }).bindings[0];
    assert.equal(binding?.repository.root, repositoryRoot);
    // An inherited GIT_DIR would otherwise make Git report the decoy's metadata for this root.
    assert.equal(binding?.repository.git_dir, path.join(repositoryRoot, ".git"));
    assert.equal(binding?.repository.common_dir, path.join(repositoryRoot, ".git"));
    assert.equal(existsSync(marker), false);

    // Workspace initialization with Git initializes the requested root, not the decoy.
    const fresh = path.join(parent, "fresh");
    await mkdir(fresh);
    initializeWorkspace({ adopt: "none", initializeGit: true, rootPath: fresh });
    assert.equal(existsSync(path.join(fresh, ".git")), true);
});
