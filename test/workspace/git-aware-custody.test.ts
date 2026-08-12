import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
    createGitAwareCustody,
    createReferenceCopyCarrier,
    createWorkspaceBindings,
    GitCustodyError,
    initializeWorkspace,
    openWorkspace,
} from "../../src/index.ts";
import { workspaceProtocolConfig } from "../../src/protocol/config.ts";

test("git-head custody retains committed content and detects only HEAD basis movement", async (context) => {
    const root = await repository(context, "head");
    const adoptedHead = git(root, "rev-parse", "HEAD");
    await writeFile(path.join(root, "tracked.txt"), "dirty\n");
    await writeFile(path.join(root, "untracked.txt"), "untracked\n");
    const preserved = await gitState(root);
    initializeWorkspace({ adopt: "git-head", rootPath: root });
    const binding = bindingFor(root);

    const service = createGitAwareCustody({ workspaceRoot: root });
    const retained = await service.capture(binding);
    assert.ok(retained);
    assert.equal(retained.basis.mode, "git-head");
    assert.equal(retained.basis.head.kind, "attached");
    assert.equal(retained.basis.head.commit, adoptedHead);
    assert.equal(
        await readFile(path.join(retained.custody.path, "tracked.txt"), "utf8"),
        "baseline\n",
    );
    await assert.rejects(readFile(path.join(retained.custody.path, "untracked.txt")));
    assert.equal((await service.verify(retained.custody.custody_id)).basis_moved, false);
    assert.deepEqual(await gitState(root), preserved);

    git(root, "add", "tracked.txt", "untracked.txt");
    git(root, "commit", "-m", "move head");
    assert.equal((await service.verify(retained.custody.custody_id)).basis_moved, true);
    const reopened = createGitAwareCustody({ workspaceRoot: root });
    assert.deepEqual(await reopened.open(retained.custody.custody_id), retained);
    await reopened.discard(retained.custody.custody_id);
    await assert.rejects(reopened.open(retained.custody.custody_id), GitCustodyError);
});

test("worktree custody binds index flags, dirty files, untracked files, and ignored exclusions", async (context) => {
    const root = await repository(context, "worktree");
    await writeFile(path.join(root, ".gitignore"), "ignored.log\n");
    const globalIgnore = path.join(root, "global-ignore");
    await writeFile(globalIgnore, "external.log\n");
    git(root, "config", "core.excludesFile", globalIgnore);
    await writeFile(path.join(root, "tracked.txt"), "staged\n");
    git(root, "add", "tracked.txt");
    await writeFile(path.join(root, "tracked.txt"), "unstaged\n");
    await writeFile(path.join(root, "intent.txt"), "intent\n");
    git(root, "add", "-N", "intent.txt");
    await writeFile(path.join(root, "untracked.txt"), "untracked\n");
    await writeFile(path.join(root, "ignored.log"), "ignored\n");
    await writeFile(path.join(root, "external.log"), "externally ignored\n");
    if (process.platform !== "win32") {
        await symlink("tracked.txt", path.join(root, "tracked-link"));
        git(root, "add", "tracked-link");
    }
    git(root, "update-index", "--assume-unchanged", "tracked.txt");
    initializeWorkspace({ adopt: "worktree", rootPath: root });
    const binding = bindingFor(root);
    const preserved = await gitState(root);

    const service = createGitAwareCustody({ workspaceRoot: root });
    const retained = await service.capture(binding);
    assert.ok(retained);
    assert.equal(retained.basis.mode, "worktree");
    assert.equal(
        retained.basis.index?.entries.find((entry) => entry.path === "intent.txt")?.intent_to_add,
        true,
    );
    assert.equal(
        retained.basis.index?.entries.find((entry) => entry.path === "tracked.txt")
            ?.assume_unchanged,
        true,
    );
    assert.equal(
        await readFile(path.join(retained.custody.path, "tracked.txt"), "utf8"),
        "unstaged\n",
    );
    assert.equal(
        await readFile(path.join(retained.custody.path, "untracked.txt"), "utf8"),
        "untracked\n",
    );
    await assert.rejects(readFile(path.join(retained.custody.path, "ignored.log")));
    assert.equal(retained.basis.ignored.paths.includes("ignored.log"), true);
    if (process.platform !== "win32") {
        assert.equal(
            retained.revision.manifest.find((entry) => entry.path === "tracked-link")
                ?.symlink_target,
            "tracked.txt",
        );
    }
    assert.deepEqual(await gitState(root), preserved);

    await writeFile(path.join(root, "ignored.log"), "ignored movement\n");
    assert.equal((await service.verify(retained.custody.custody_id)).basis_moved, false);
    await rm(globalIgnore);
    assert.equal((await service.verify(retained.custody.custody_id)).basis_moved, true);
    await writeFile(path.join(root, ".git", "info", "exclude"), "new-exclusion\n");
    assert.equal((await service.verify(retained.custody.custody_id)).basis_moved, true);
    await writeFile(path.join(root, "untracked.txt"), "relevant movement\n");
    assert.equal((await service.verify(retained.custody.custody_id)).basis_moved, true);
});

test("git-aware custody handles detached and unborn HEAD and rejects conflicted worktree index", async (context) => {
    const detached = await repository(context, "detached");
    git(detached, "checkout", "--detach");
    initializeWorkspace({ adopt: "git-head", rootPath: detached });
    const detachedResult = await createGitAwareCustody({ workspaceRoot: detached }).capture(
        bindingFor(detached),
    );
    assert.equal(detachedResult?.basis.head.kind, "detached");

    const unborn = await temporary(context, "unborn");
    git(unborn, "init");
    initializeWorkspace({ adopt: "worktree", rootPath: unborn });
    const unbornResult = await createGitAwareCustody({ workspaceRoot: unborn }).capture(
        bindingFor(unborn),
    );
    assert.equal(unbornResult?.basis.head.kind, "unborn");

    const conflicted = await repository(context, "conflicted");
    const base = git(conflicted, "rev-parse", "HEAD");
    git(conflicted, "checkout", "-b", "other");
    await writeFile(path.join(conflicted, "tracked.txt"), "other\n");
    git(conflicted, "commit", "-am", "other");
    git(conflicted, "checkout", "--detach", base);
    await writeFile(path.join(conflicted, "tracked.txt"), "current\n");
    git(conflicted, "commit", "-am", "current");
    assert.throws(() => git(conflicted, "merge", "other"));
    initializeWorkspace({ adopt: "worktree", rootPath: conflicted });
    await assert.rejects(
        createGitAwareCustody({ workspaceRoot: conflicted }).capture(bindingFor(conflicted)),
        GitCustodyError,
    );
});

test("none adoption creates no retained output custody", async (context) => {
    const root = await repository(context, "none");
    initializeWorkspace({ adopt: "none", rootPath: root });
    assert.equal(
        await createGitAwareCustody({ workspaceRoot: root }).capture(bindingFor(root)),
        null,
    );
    const identityPath = path.join(root, ".vcscore", "git-identity.json");
    const identity = JSON.parse(await readFile(identityPath, "utf8")) as Record<string, unknown>;
    identity.repository_id = 1;
    await writeFile(identityPath, `${JSON.stringify(identity)}\n`);
    await assert.rejects(
        createGitAwareCustody({ workspaceRoot: root }).capture(bindingFor(root)),
        GitCustodyError,
    );
});

test("worktree custody retains a repository with no index file", async (context) => {
    const root = await repository(context, "missing-index");
    await rm(path.join(root, ".git", "index"));
    await rm(path.join(root, ".git", "info", "exclude"));
    initializeWorkspace({ adopt: "worktree", rootPath: root });
    const retained = await createGitAwareCustody({ workspaceRoot: root }).capture(bindingFor(root));
    assert.ok(retained);
    assert.equal(
        retained.basis.index?.receipt_id.endsWith(
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        ),
        true,
    );
});

test("worktree custody preserves sparse absence and rejects unsafe repository boundaries", async (context) => {
    const sparse = await repository(context, "sparse");
    await writeFile(path.join(sparse, "sparse.txt"), "sparse\n");
    git(sparse, "add", "sparse.txt");
    git(sparse, "commit", "-m", "sparse path");
    git(sparse, "update-index", "--skip-worktree", "sparse.txt");
    git(sparse, "update-index", "--assume-unchanged", "sparse.txt");
    git(sparse, "config", "core.sparseCheckout", "true");
    git(sparse, "config", "core.sparseCheckoutCone", "false");
    await rm(path.join(sparse, "sparse.txt"));
    initializeWorkspace({ adopt: "worktree", rootPath: sparse });
    const sparseService = createGitAwareCustody({ workspaceRoot: sparse });
    const retained = await sparseService.capture(bindingFor(sparse));
    assert.ok(retained);
    assert.equal(
        retained.basis.index?.entries.find((entry) => entry.path === "sparse.txt")?.skip_worktree,
        true,
    );
    assert.equal(
        retained.basis.index?.entries.find((entry) => entry.path === "sparse.txt")
            ?.assume_unchanged,
        true,
    );
    await assert.rejects(readFile(path.join(retained.custody.path, "sparse.txt")));
    assert.equal((await sparseService.verify(retained.custody.custody_id)).basis_moved, false);
    await writeFile(path.join(sparse, ".git", "info", "sparse-checkout"), "/tracked.txt/\n");
    assert.equal((await sparseService.verify(retained.custody.custody_id)).basis_moved, true);

    const nested = await repository(context, "nested");
    const embedded = path.join(nested, "embedded");
    await mkdir(embedded);
    git(embedded, "init");
    await writeFile(path.join(embedded, "file.txt"), "nested\n");
    initializeWorkspace({ adopt: "worktree", rootPath: nested });
    await assert.rejects(
        createGitAwareCustody({ workspaceRoot: nested }).capture(bindingFor(nested)),
        GitCustodyError,
    );
});

test("worktree custody accepts a clean gitlink and rejects dirty submodule content", async (context) => {
    const submodule = await repository(context, "submodule-source");
    const root = await repository(context, "submodule-parent");
    execFileSync(
        "git",
        ["-c", "protocol.file.allow=always", "-C", root, "submodule", "add", submodule, "module"],
        { stdio: ["ignore", "pipe", "pipe"] },
    );
    git(root, "commit", "-m", "add submodule");
    initializeWorkspace({ adopt: "worktree", rootPath: root });
    const service = createGitAwareCustody({ workspaceRoot: root });
    const retained = await service.capture(bindingFor(root));
    assert.ok(retained);
    assert.equal(
        retained.basis.index?.entries.find((entry) => entry.path === "module")?.mode,
        "160000",
    );
    await writeFile(path.join(root, "module", "tracked.txt"), "dirty submodule\n");
    await assert.rejects(service.capture(bindingFor(root)), GitCustodyError);
});

test("Git-aware receipts fail closed on corruption and support linked worktree identity", async (context) => {
    const root = await repository(context, "receipt-corruption");
    initializeWorkspace({ adopt: "worktree", rootPath: root });
    const service = createGitAwareCustody({ workspaceRoot: root });
    const retained = await service.capture(bindingFor(root));
    assert.ok(retained);
    assert.equal(Object.isFrozen(retained.basis.repository), true);
    assert.equal(Object.isFrozen(retained.basis.index?.entries), true);
    assert.equal(Object.isFrozen(retained.basis.index?.entries[0]), true);
    const receiptRoot = path.dirname(retained.custody.path);
    const indexReceipt = await readFile(path.join(receiptRoot, "index.bin"));
    await writeFile(path.join(receiptRoot, "index.bin"), "corrupt\n");
    await assert.rejects(service.open(retained.custody.custody_id), GitCustodyError);
    await writeFile(path.join(receiptRoot, "index.bin"), indexReceipt);
    const descriptorPath = path.join(receiptRoot, "git-output.json");
    const descriptor = JSON.parse(await readFile(descriptorPath, "utf8")) as Record<
        string,
        unknown
    >;
    const malformed = structuredClone(descriptor) as {
        basis: { mode: string };
    };
    malformed.basis.mode = "none";
    await writeFile(descriptorPath, `${JSON.stringify(malformed)}\n`);
    await assert.rejects(service.open(retained.custody.custody_id), GitCustodyError);

    const main = await repository(context, "linked-main");
    const linkedParent = await temporary(context, "linked-child");
    const linked = path.join(linkedParent, "linked\nchild");
    git(main, "worktree", "add", "--detach", linked);
    initializeWorkspace({ adopt: "worktree", rootPath: linked });
    const linkedBinding = bindingFor(linked);
    const foreignControl = await temporary(context, "foreign-worktree-control");
    await symlink(foreignControl, path.join(main, ".vcscore"));
    await assert.rejects(
        createGitAwareCustody({ workspaceRoot: linked }).capture(linkedBinding),
        GitCustodyError,
    );
    await rm(path.join(main, ".vcscore"));
    const linkedRetained = await createGitAwareCustody({ workspaceRoot: linked }).capture(
        linkedBinding,
    );
    initializeWorkspace({ adopt: "worktree", rootPath: main });
    const mainRetained = await createGitAwareCustody({ workspaceRoot: main }).capture(
        bindingFor(main),
    );
    assert.ok(linkedRetained);
    assert.ok(mainRetained);
    assert.notEqual(
        linkedRetained.basis.repository.git_dir,
        linkedRetained.basis.repository.common_dir,
    );
    assert.equal(linkedRetained.basis.repository.root, linkedBinding.canonical_root);
    assert.equal(
        linkedRetained.basis.repository.repository_id,
        mainRetained.basis.repository.repository_id,
    );
    assert.notEqual(
        linkedRetained.basis.repository.worktree_id,
        mainRetained.basis.repository.worktree_id,
    );
    const authorityFile = path.join(linked, ".vcscore", "git-repository-id.json");
    await writeFile(
        authorityFile,
        `${JSON.stringify({ repository_id: "git-repository:conflict" })}\n`,
    );
    await assert.rejects(
        createGitAwareCustody({ workspaceRoot: linked }).capture(linkedBinding),
        GitCustodyError,
    );
});

test("retained custody reopens after a borrowed object source disappears", async (context) => {
    const source = await repository(context, "alternate-source");
    const parent = await temporary(context, "alternate-workspace");
    const root = path.join(parent, "workspace");
    execFileSync("git", ["clone", "--shared", source, root], {
        stdio: ["ignore", "pipe", "pipe"],
    });
    await writeFile(path.join(root, "staged-only.txt"), "staged only\n");
    git(root, "add", "staged-only.txt");
    const stagedObject = git(root, "hash-object", "staged-only.txt");
    const localObject = path.join(
        root,
        ".git",
        "objects",
        stagedObject.slice(0, 2),
        stagedObject.slice(2),
    );
    const alternateObject = path.join(
        source,
        ".git",
        "objects",
        stagedObject.slice(0, 2),
        stagedObject.slice(2),
    );
    await mkdir(path.dirname(alternateObject), { recursive: true });
    await rename(localObject, alternateObject);
    initializeWorkspace({ adopt: "worktree", rootPath: root });
    const service = createGitAwareCustody({ workspaceRoot: root });
    const retained = await service.capture(bindingFor(root));
    assert.ok(retained);
    const ordinaryCarrier = createReferenceCopyCarrier({ workspaceRoot: root });

    await rm(source, { force: true, recursive: true });
    assert.throws(() => openWorkspace(root));
    await assert.rejects(ordinaryCarrier.openRevision(retained.revision.revision_id));
    const reopened = createGitAwareCustody({ workspaceRoot: root });
    assert.deepEqual(await reopened.open(retained.custody.custody_id), retained);
    assert.equal(
        await readFile(path.join(retained.custody.path, "tracked.txt"), "utf8"),
        "baseline\n",
    );
    const inspected = await temporary(context, "retained-pack");
    git(inspected, "init");
    execFileSync("git", ["-C", inspected, "index-pack", "--stdin"], {
        input: await readFile(path.join(path.dirname(retained.custody.path), "objects.pack")),
        stdio: ["pipe", "pipe", "pipe"],
    });
    assert.equal(git(inspected, "cat-file", "-p", stagedObject), "staged only");
});

test("concurrent linked-first captures converge on one repository authority", async (context) => {
    const main = await repository(context, "concurrent-linked-main");
    const firstParent = await temporary(context, "concurrent-linked-first");
    const secondParent = await temporary(context, "concurrent-linked-second");
    const first = path.join(firstParent, "first");
    const second = path.join(secondParent, "second");
    git(main, "worktree", "add", "--detach", first);
    git(main, "worktree", "add", "--detach", second);
    initializeWorkspace({ adopt: "worktree", rootPath: first });
    initializeWorkspace({ adopt: "worktree", rootPath: second });

    await Promise.all([captureInChild(first), captureInChild(second)]);
    const firstAuthority = JSON.parse(
        await readFile(path.join(first, ".vcscore", "git-repository-id.json"), "utf8"),
    ) as { repository_id: string };
    const secondAuthority = JSON.parse(
        await readFile(path.join(second, ".vcscore", "git-repository-id.json"), "utf8"),
    ) as { repository_id: string };
    assert.equal(firstAuthority.repository_id, secondAuthority.repository_id);
});

test("Git-aware custody validates its public boundary and exact repository root", async (context) => {
    const accessor = Object.defineProperty({}, "workspaceRoot", {
        enumerable: true,
        get: () => "root",
    });
    const symbolic = { workspaceRoot: "root" };
    Object.defineProperty(symbolic, Symbol("extra"), { value: true });
    for (const malformed of [
        null,
        [],
        {},
        { workspaceRoot: 1 },
        { workspaceRoot: "", extra: true },
        accessor,
        symbolic,
        new Date(),
    ]) {
        assert.throws(() => createGitAwareCustody(malformed as never), TypeError);
    }
    const root = await repository(context, "boundary");
    initializeWorkspace({ adopt: "worktree", rootPath: root });
    const nested = path.join(root, "nested");
    await mkdir(nested);
    const binding = createWorkspaceBindings({
        bindings: [{ name: "nested", root: "nested" }],
        workspaceRoot: root,
    }).bindings[0];
    assert.ok(binding);
    await assert.rejects(
        createGitAwareCustody({ workspaceRoot: root }).capture(binding),
        GitCustodyError,
    );

    const service = createGitAwareCustody({ workspaceRoot: root });
    const staging = path.join(root, ".vcscore", "git-staging");
    const displaced = path.join(root, ".vcscore", "git-staging-displaced");
    const outside = await temporary(context, "staging-substitution");
    await writeFile(path.join(outside, "preserved.txt"), "preserved\n");
    await rename(staging, displaced);
    await symlink(outside, staging);
    await assert.rejects(service.capture(bindingFor(root)), GitCustodyError);
    assert.equal(await readFile(path.join(outside, "preserved.txt"), "utf8"), "preserved\n");
    await rm(staging);
    await rename(displaced, staging);

    const common = git(root, "rev-parse", "--path-format=absolute", "--git-common-dir");
    const commonStatus = lstatSync(common, { bigint: true });
    const lockDigest = createHash(workspaceProtocolConfig.digestAlgorithm)
        .update(`${commonStatus.dev}:${commonStatus.ino}`)
        .digest("hex");
    const lock = path.join(
        tmpdir(),
        `${workspaceProtocolConfig.gitCustody.repositoryLockPrefix}${lockDigest}`,
    );
    await mkdir(lock);
    await assert.rejects(
        createGitAwareCustody({ workspaceRoot: root }).capture(bindingFor(root)),
        GitCustodyError,
    );
    await rm(lock, { recursive: true });
});

function bindingFor(root: string) {
    const binding = createWorkspaceBindings({
        bindings: [{ name: "repository", root: "." }],
        workspaceRoot: root,
    }).bindings[0];
    assert.ok(binding);
    return binding;
}

async function gitState(root: string): Promise<{
    readonly config: Buffer;
    readonly head: Buffer;
    readonly index: Buffer;
    readonly refs: string;
}> {
    return {
        config: await readFile(path.join(root, ".git", "config")),
        head: await readFile(path.join(root, ".git", "HEAD")),
        index: await readFile(path.join(root, ".git", "index")),
        refs: git(root, "show-ref"),
    };
}

async function repository(
    context: { after: (callback: () => Promise<void>) => void },
    name: string,
): Promise<string> {
    const root = await temporary(context, name);
    git(root, "init");
    git(root, "config", "user.email", "test@example.com");
    git(root, "config", "user.name", "Test User");
    await writeFile(path.join(root, "tracked.txt"), "baseline\n");
    git(root, "add", "tracked.txt");
    git(root, "commit", "-m", "baseline");
    return root;
}

async function temporary(
    context: { after: (callback: () => Promise<void>) => void },
    name: string,
): Promise<string> {
    const root = await mkdtemp(path.join(tmpdir(), `shepherd-git-custody-${name}-`));
    context.after(() => rm(root, { force: true, recursive: true }));
    return root;
}

function git(root: string, ...args: readonly string[]): string {
    return execFileSync("git", ["-C", root, ...args], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
    }).trim();
}

function captureInChild(root: string): Promise<void> {
    const program = `
        import { createGitAwareCustody, createWorkspaceBindings } from ${JSON.stringify(new URL("../../src/index.ts", import.meta.url).href)};
        const root = process.argv[1];
        const binding = createWorkspaceBindings({ bindings: [{ name: "repository", root: "." }], workspaceRoot: root }).bindings[0];
        await createGitAwareCustody({ workspaceRoot: root }).capture(binding);
    `;
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ["--input-type=module", "-e", program, root], {
            stdio: ["ignore", "ignore", "pipe"],
        });
        let error = "";
        child.stderr.setEncoding("utf8");
        child.stderr.on("data", (chunk: string) => {
            error += chunk;
        });
        child.once("error", reject);
        child.once("exit", (code) => {
            if (code === 0) resolve();
            else reject(new Error(error));
        });
    });
}
