import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync } from "node:fs";
import {
    chmod,
    mkdir,
    mkdtemp,
    readdir,
    readFile,
    readlink,
    rename,
    rm,
    symlink,
    utimes,
    writeFile,
} from "node:fs/promises";
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

test("git-head custody never runs repository filters or export attributes", async (context) => {
    const root = await repository(context, "hostile-filter");
    const marker = path.join(await temporary(context, "hostile-marker"), "smudge-ran");
    await writeFile(
        path.join(root, ".gitattributes"),
        "* filter=evil ident\nignored.txt export-ignore\nsubst.txt export-subst\n",
    );
    await writeFile(path.join(root, "ignored.txt"), "export ignored\n");
    await writeFile(path.join(root, "subst.txt"), "$Format:%H$ $Id$\n");
    git(root, "add", ".gitattributes", "ignored.txt", "subst.txt");
    git(root, "commit", "-m", "attributes");
    const infoAttributes = path.join(root, ".git", "info", "attributes");
    await mkdir(path.dirname(infoAttributes), { recursive: true });
    await writeFile(infoAttributes, "* filter=evil\n");
    const attributesFile = path.join(root, ".git", "global-attributes");
    await writeFile(attributesFile, "* filter=evil\n");
    git(root, "config", "core.attributesFile", attributesFile);
    const smudge = `touch ${JSON.stringify(marker)}; cat`;
    git(root, "config", "filter.evil.smudge", smudge);
    git(root, "config", "filter.evil.required", "true");
    execFileSync("git", ["-C", root, "archive", "--format=tar", "HEAD"], { stdio: "ignore" });
    assert.equal(lstatSync(marker, { throwIfNoEntry: false })?.isFile(), true);
    await rm(marker);

    initializeWorkspace({ adopt: "git-head", rootPath: root });
    const retained = await createGitAwareCustody({ workspaceRoot: root }).capture(bindingFor(root));
    assert.ok(retained);
    assert.equal(lstatSync(marker, { throwIfNoEntry: false }), undefined);
    assert.equal(
        await readFile(path.join(retained.custody.path, "ignored.txt"), "utf8"),
        "export ignored\n",
    );
    assert.equal(
        await readFile(path.join(retained.custody.path, "subst.txt"), "utf8"),
        "$Format:%H$ $Id$\n",
    );
});

test("git-head materialization matches git archive for a repository without attributes", async (context) => {
    const root = await repository(context, "archive-oracle");
    await mkdir(path.join(root, "nested", "deeper"), { recursive: true });
    await writeFile(path.join(root, "nested", "deeper", "leaf.txt"), "leaf\n");
    await writeFile(path.join(root, "nested", "run.sh"), "#!/bin/sh\n", { mode: 0o755 });
    await writeFile(path.join(root, "empty.txt"), "");
    await symlink("nested/run.sh", path.join(root, "link"));
    git(root, "add", ".");
    git(
        root,
        "update-index",
        "--add",
        "--cacheinfo",
        `160000,${git(root, "rev-parse", "HEAD")},sub`,
    );
    git(root, "commit", "-m", "shapes");
    const expected = await temporary(context, "archive-oracle-extract");
    execFileSync("tar", ["-xf", "-", "-C", expected], {
        input: execFileSync("git", ["-C", root, "archive", "--format=tar", "HEAD"]),
    });

    initializeWorkspace({ adopt: "git-head", rootPath: root });
    const retained = await createGitAwareCustody({ workspaceRoot: root }).capture(bindingFor(root));
    assert.ok(retained);
    const expectedManifest = await treeManifest(expected);
    assert.deepEqual(
        retained.revision.manifest.map((entry) => ({
            kind: entry.kind,
            mode: entry.mode,
            path: entry.path,
            size: entry.size,
            symlink_target: entry.symlink_target,
        })),
        expectedManifest.map(({ bytes: _bytes, ...entry }) => entry),
    );
    for (const entry of expectedManifest.filter(({ bytes }) => bytes !== null)) {
        assert.deepEqual(
            await readFile(path.join(retained.custody.path, ...entry.path.split("/"))),
            entry.bytes,
        );
    }
});

test("git-head materialization accepts an empty tree and refuses entries that escape the world", async (context) => {
    const empty = await repository(context, "empty-tree");
    const emptyTree = execFileSync("git", ["-C", empty, "mktree"], {
        encoding: "utf8",
        input: "",
    }).trim();
    git(empty, "reset", "--soft", git(empty, "commit-tree", emptyTree, "-m", "empty"));
    initializeWorkspace({ adopt: "git-head", rootPath: empty });
    const emptyWorld = await createGitAwareCustody({ workspaceRoot: empty }).capture(
        bindingFor(empty),
    );
    assert.deepEqual(emptyWorld?.revision.manifest, []);

    const root = await repository(context, "unsafe-tree");
    const blob = git(root, "rev-parse", "HEAD:tracked.txt");
    const tree = execFileSync("git", ["-C", root, "mktree"], {
        encoding: "utf8",
        input: `100644 blob ${blob}\t..\n`,
    }).trim();
    git(root, "reset", "--soft", git(root, "commit-tree", tree, "-m", "unsafe"));
    initializeWorkspace({ adopt: "git-head", rootPath: root });
    await assert.rejects(
        createGitAwareCustody({ workspaceRoot: root }).capture(bindingFor(root)),
        (error: unknown) =>
            error instanceof GitCustodyError &&
            error.code === workspaceProtocolConfig.gitCustody.errors.unsupportedCode,
    );
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

test("worktree custody preserves sparse-index evidence and excluded-path absence", async (context) => {
    const root = await repository(context, "sparse-index");
    await mkdir(path.join(root, "included"));
    await mkdir(path.join(root, "excluded"));
    await writeFile(path.join(root, "included", "present.txt"), "present\n");
    await writeFile(path.join(root, "excluded", "absent.txt"), "absent\n");
    git(root, "add", "included", "excluded");
    git(root, "commit", "-m", "sparse index paths");
    git(root, "sparse-checkout", "init", "--cone", "--sparse-index");
    git(root, "sparse-checkout", "set", "included");
    initializeWorkspace({ adopt: "worktree", rootPath: root });

    const service = createGitAwareCustody({ workspaceRoot: root });
    const retained = await service.capture(bindingFor(root));
    assert.ok(retained);
    assert.equal(
        retained.basis.index?.entries.find((entry) => entry.path === "excluded/absent.txt")
            ?.skip_worktree,
        true,
    );
    assert.equal(retained.basis.sparse_digest.length > 0, true);
    assert.equal(
        await readFile(path.join(retained.custody.path, "included", "present.txt"), "utf8"),
        "present\n",
    );
    await assert.rejects(readFile(path.join(retained.custody.path, "excluded", "absent.txt")));
    assert.equal((await service.verify(retained.custody.custody_id)).basis_moved, false);
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

test("worktree submodule check never runs repository clean filters", async (context) => {
    const sources = [
        { attribute: "gitattributes", driver: "clean" },
        { attribute: "info", driver: "clean" },
        { attribute: "attributesFile", driver: "clean" },
        { attribute: "gitattributes", driver: "process" },
    ] as const;
    for (const { attribute, driver } of sources) {
        const name = `hostile-${attribute}-${driver}`;
        const { module, root } = await submoduleParent(context, name);
        const marker = path.join(await temporary(context, `${name}-marker`), "filter-ran");
        const attributesFile = path.join(
            git(module, "rev-parse", "--absolute-git-dir"),
            "hostile-attributes",
        );
        for (const target of [root, module]) {
            if (attribute === "gitattributes") {
                await writeFile(path.join(target, ".gitattributes"), "* filter=evil\n");
                git(target, "add", ".gitattributes");
                git(target, "commit", "-qm", "hostile attributes");
            } else if (attribute === "info") {
                const gitDir = git(target, "rev-parse", "--absolute-git-dir");
                await mkdir(path.join(gitDir, "info"), { recursive: true });
                await writeFile(path.join(gitDir, "info", "attributes"), "* filter=evil\n");
            } else {
                await writeFile(attributesFile, "* filter=evil\n");
                git(target, "config", "core.attributesFile", attributesFile);
            }
        }
        if (attribute === "gitattributes") {
            git(root, "add", "module");
            git(root, "commit", "-qm", "move submodule");
        }
        const program = `touch ${JSON.stringify(marker)}; ${driver === "clean" ? "cat" : "exit 1"}`;
        for (const target of [root, module])
            git(target, "config", `filter.evil.${driver}`, program);
        const touch = () => utimes(path.join(module, "tracked.txt"), new Date(), new Date(0));
        await touch();
        spawnSync("git", ["-C", root, "--no-optional-locks", "status", "--", "module"], {
            stdio: "ignore",
        });
        assert.equal(lstatSync(marker, { throwIfNoEntry: false })?.isFile(), true, name);
        await rm(marker);
        await touch();

        initializeWorkspace({ adopt: "worktree", rootPath: root });
        const service = createGitAwareCustody({ workspaceRoot: root });
        assert.ok(await service.capture(bindingFor(root)), name);
        assert.equal(lstatSync(marker, { throwIfNoEntry: false }), undefined, name);
        await writeFile(path.join(module, "tracked.txt"), "dirty\n");
        await assert.rejects(service.capture(bindingFor(root)), dirtySubmodule);
        assert.equal(lstatSync(marker, { throwIfNoEntry: false }), undefined, name);
    }
});

test("worktree submodule check preserves git status dirty semantics without git status", async (context) => {
    const { module, root } = await submoduleParent(context, "dirty-semantics", true);
    initializeWorkspace({ adopt: "worktree", rootPath: root });
    const service = createGitAwareCustody({ workspaceRoot: root });
    const accepts = async (label: string) =>
        assert.ok(await service.capture(bindingFor(root)), label);
    const rejects = (label: string) =>
        assert.rejects(service.capture(bindingFor(root)), dirtySubmodule, label);
    const file = (...parts: string[]) => path.join(module, ...parts);
    const restore = async () => {
        git(module, "reset", "-q", "--hard");
        await rm(file("untracked.txt"), { force: true });
    };
    await accepts("clean with an unpopulated nested gitlink");
    await utimes(file("tracked.txt"), new Date(0), new Date(0));
    await accepts("stat-only change");

    await writeFile(file("tracked.txt"), "modified\n");
    await rejects("modified content");
    await restore();
    await writeFile(file("untracked.txt"), "untracked\n");
    await rejects("untracked file");
    await restore();
    await rm(file("tracked.txt"));
    await rejects("deleted file");
    await restore();
    await chmod(file("run.sh"), 0o644);
    await rejects("executable bit");
    git(module, "config", "core.fileMode", "false");
    await accepts("executable bit with core.fileMode false");
    git(module, "config", "core.fileMode", "true");
    await chmod(file("run.sh"), 0o755);
    await rm(file("link"));
    await writeFile(file("link"), "tracked.txt");
    await rejects("symbolic link replaced by a file");
    await restore();
    await rename(file("dir"), file("dir-moved"));
    await symlink("dir-moved", file("dir"));
    await rejects("symbolic link in a leading path");
    await rm(file("dir"));
    await rename(file("dir-moved"), file("dir"));
    git(module, "update-index", "--skip-worktree", "skip.txt");
    await rm(file("skip.txt"));
    git(module, "update-index", "--assume-unchanged", "tracked.txt");
    await writeFile(file("tracked.txt"), "assumed\n");
    await accepts("skip-worktree and assume-unchanged entries");
    git(module, "update-index", "--no-skip-worktree", "skip.txt");
    git(module, "update-index", "--no-assume-unchanged", "tracked.txt");
    await restore();
    await writeFile(file("tracked.txt"), "staged\n");
    git(module, "add", "tracked.txt");
    await rejects("staged change");
    await restore();
    execFileSync("git", ["-C", module, "update-index", "--index-info"], {
        input: `100644 ${git(module, "rev-parse", "HEAD:tracked.txt")} 1\ttracked.txt\n`,
    });
    await rejects("unmerged index entry");
    await restore();
    git(module, "rm", "-q", "--cached", "tracked.txt");
    await rejects("removed index entry");
    await restore();

    git(module, "commit", "-qm", "moved", "--allow-empty");
    await rejects("submodule HEAD differs from the gitlink");
    git(root, "add", "module");
    await rejects("staged gitlink differs from HEAD");
    git(root, "reset", "-q", "--", "module");
    git(module, "reset", "-q", "--hard", "HEAD~1");
    await accepts("restored gitlink");

    const gitFile = file(".git");
    const gitFileBytes = await readFile(gitFile);
    await rm(gitFile);
    await mkdir(gitFile);
    await rejects("submodule without its own repository");
    await rm(gitFile, { recursive: true });
    await writeFile(gitFile, gitFileBytes);

    execFileSync(
        "git",
        ["-c", "protocol.file.allow=always", "-C", module, "submodule", "update", "--init"],
        { stdio: ["ignore", "pipe", "pipe"] },
    );
    await accepts("populated nested submodule");
    await writeFile(file("nested", "tracked.txt"), "nested dirty\n");
    await rejects("dirty nested submodule");
    await rm(file("nested"), { recursive: true });
    await writeFile(file("nested"), "not a directory\n");
    await rejects("gitlink replaced by a file");
    await rm(file("nested"));
    await restore();
    await accepts("unpopulated nested gitlink restored");

    git(root, "checkout", "-q", "--orphan", "unborn");
    await rejects("unborn superproject HEAD");
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
        { faultInjection: null, workspaceRoot: "root" },
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

function dirtySubmodule(error: unknown): boolean {
    return (
        error instanceof GitCustodyError &&
        error.code === workspaceProtocolConfig.gitCustody.errors.unsupportedCode &&
        error.message.includes("dirty submodule")
    );
}

async function submoduleParent(
    context: { after: (callback: () => Promise<void>) => void },
    name: string,
    shapes = false,
): Promise<{ readonly module: string; readonly root: string }> {
    const source = await repository(context, `${name}-source`);
    if (shapes) {
        const nested = await repository(context, `${name}-nested`);
        await mkdir(path.join(source, "dir"));
        await writeFile(path.join(source, "dir", "a.txt"), "a\n");
        await writeFile(path.join(source, "dir", "b.txt"), "b\n");
        await writeFile(path.join(source, "run.sh"), "#!/bin/sh\n", { mode: 0o755 });
        await writeFile(path.join(source, "skip.txt"), "skip\n");
        await symlink("tracked.txt", path.join(source, "link"));
        git(source, "add", ".");
        execFileSync(
            "git",
            [
                "-c",
                "protocol.file.allow=always",
                "-C",
                source,
                "submodule",
                "add",
                nested,
                "nested",
            ],
            { stdio: ["ignore", "pipe", "pipe"] },
        );
        git(source, "commit", "-qm", "shapes");
    }
    const root = await repository(context, `${name}-parent`);
    execFileSync(
        "git",
        ["-c", "protocol.file.allow=always", "-C", root, "submodule", "add", source, "module"],
        { stdio: ["ignore", "pipe", "pipe"] },
    );
    git(root, "commit", "-qm", "add submodule");
    const module = path.join(root, "module");
    git(module, "config", "user.email", "test@example.com");
    git(module, "config", "user.name", "Test User");
    return { module, root };
}

function bindingFor(root: string) {
    const binding = createWorkspaceBindings({
        bindings: [{ name: "repository", root: "." }],
        workspaceRoot: root,
    }).bindings[0];
    assert.ok(binding);
    return binding;
}

async function treeManifest(root: string): Promise<
    {
        readonly bytes: Buffer | null;
        readonly kind: string;
        readonly mode: number | null;
        readonly path: string;
        readonly size: number | null;
        readonly symlink_target: string | null;
    }[]
> {
    const entries: Awaited<ReturnType<typeof treeManifest>> = [];
    const walk = async (relative: string): Promise<void> => {
        for (const name of await readdir(path.join(root, ...relative.split("/")))) {
            const child = relative === "" ? name : `${relative}/${name}`;
            const absolute = path.join(root, ...child.split("/"));
            const status = lstatSync(absolute);
            if (status.isSymbolicLink()) {
                entries.push({
                    bytes: null,
                    kind: "symlink",
                    mode: null,
                    path: child,
                    size: null,
                    symlink_target: await readlink(absolute),
                });
            } else if (status.isDirectory()) {
                entries.push({
                    bytes: null,
                    kind: "directory",
                    mode: status.mode & 0o777,
                    path: child,
                    size: null,
                    symlink_target: null,
                });
                await walk(child);
            } else {
                const bytes = await readFile(absolute);
                entries.push({
                    bytes,
                    kind: "file",
                    mode: status.mode & 0o777,
                    path: child,
                    size: bytes.length,
                    symlink_target: null,
                });
            }
        }
    };
    await walk("");
    return entries.sort((left, right) => Buffer.from(left.path).compare(Buffer.from(right.path)));
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
