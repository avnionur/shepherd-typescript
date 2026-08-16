import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import type { BigIntStats, Stats } from "node:fs";
import {
    chmodSync,
    closeSync,
    constants,
    existsSync,
    fstatSync,
    fsyncSync,
    linkSync,
    lstatSync,
    mkdirSync,
    mkdtempSync,
    openSync,
    readFileSync,
    readlinkSync,
    realpathSync,
    rmSync,
    symlinkSync,
    unlinkSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { syncDirectory } from "../blob/directory-durability.ts";
import { canonicalizeRecord, type SemanticRecord } from "../canonical/canonical-record.ts";
import { workspaceProtocolConfig } from "../protocol/config.ts";
import { GIT_HEAD_KINDS, WORKSPACE_ADOPTION_MODES } from "../protocol/values.generated.ts";
import { createWorkspaceBindings } from "./bindings.ts";
import { GitCustodyError } from "./errors.ts";
import { openWorkspace, openWorkspaceForRetainedCustody } from "./initialization.ts";
import {
    assertWorkspacePathUnprotected,
    WorkspaceProtectedPathError,
} from "./protected-control-paths.ts";
import {
    createReferenceCopyCarrierForRetainedCustody,
    forkReferenceCopyRevisionWithReceipts,
    inspectReferenceCopySource,
    snapshotReferenceCopySource,
} from "./reference-copy-carrier.ts";
import type {
    GitAwareCustody,
    GitAwareCustodyOptions,
    GitBasisEvidence,
    GitHeadEvidence,
    GitIndexEntry,
    GitRepositoryIdentity,
    GitRetainedOutput,
    WorkspaceAdoptionMode,
    WorkspaceBinding,
} from "./types.ts";

type GitIdentityDescriptor = GitRepositoryIdentity & {
    readonly format: string;
    readonly version: number;
};

type RetainedDescriptor = {
    readonly basis: GitBasisEvidence;
    readonly custody_id: string;
    readonly format: string;
    readonly revision_id: string;
    readonly version: number;
};

type GitCommand = {
    readonly bytes: Buffer;
    readonly text: string;
};

type GitStaging = { readonly identity: string; readonly path: string };

/**
 * Creates workspace protocol v4 Git-aware baseline and retained-output custody.
 *
 * Git inspection is read-only. Managed output is materialized under protected control storage and
 * delegated to the workspace protocol v3 copy carrier; ordinary refs, index, config, and files are
 * never mutated by this API.
 *
 * @param options - Exact initialized workspace owning Git-aware custody.
 * @returns Frozen capture, reopen, verify, and discard operations.
 * @throws {GitCustodyError} If repository or custody evidence is unavailable or unsafe.
 * @throws {WorkspaceControlError} If workspace control state cannot be reopened.
 * @throws {TypeError} If options are malformed.
 */
export function createGitAwareCustody(options: GitAwareCustodyOptions): GitAwareCustody {
    const workspaceRoot = readOptions(options);
    const workspace = openWorkspaceForRetainedCustody(workspaceRoot);
    const carrier = createReferenceCopyCarrierForRetainedCustody({ workspaceRoot });
    const staging = gitStagingRoot(workspace.control_path);

    return Object.freeze({
        capture: async (binding: WorkspaceBinding) =>
            invoke(() => capture(workspaceRoot, staging, binding)),
        discard: async (custodyId: string) =>
            invoke(async () => {
                await readRetained(workspaceRoot, custodyId);
                await carrier.discard(custodyId);
            }),
        open: async (custodyId: string) => invoke(() => readRetained(workspaceRoot, custodyId)),
        verify: async (custodyId: string) =>
            invoke(async () => {
                const retained = await readRetained(workspaceRoot, custodyId);
                const current = captureBasis(
                    workspaceRoot,
                    retained.basis.binding_id,
                    retained.basis.mode,
                    null,
                    retained.basis.repository,
                    retained.basis.object_pack_id,
                );
                return Object.freeze({
                    basis_moved: current.basis_id !== retained.basis.basis_id,
                    output: await carrier.verifyCustody(custodyId),
                });
            }),
    });
}

async function capture(
    workspaceRoot: string,
    staging: GitStaging,
    binding: WorkspaceBinding,
): Promise<GitRetainedOutput | null> {
    const workspace = openWorkspace(workspaceRoot);
    const retainedBinding = revalidateRepositoryBinding(workspaceRoot, binding);
    const identity = readOrCreateIdentity(workspace.control_path, retainedBinding);
    if (workspace.adoption.mode === "none") return null;
    assertStagingIdentity(staging);
    const stagingRoot = path.join(staging.path, randomUUID());
    const stagingWorld = path.join(stagingRoot, workspaceProtocolConfig.carrier.worldDirectory);
    mkdirSync(stagingWorld, { recursive: true, mode: 0o700 });
    try {
        materializeManagedWorld(
            workspaceRoot,
            retainedBinding.canonical_root,
            workspace.adoption.mode,
            stagingWorld,
        );
        const world = inspectReferenceCopySource(
            workspaceRoot,
            stagingWorld,
            retainedBinding.canonical_root,
        );
        const bundlePath = path.join(
            stagingRoot,
            workspaceProtocolConfig.gitCustody.objectPackFile,
        );
        const bundleId = createObjectBundle(retainedBinding.canonical_root, bundlePath);
        const basis = captureBasis(
            workspaceRoot,
            retainedBinding.binding_id,
            workspace.adoption.mode,
            world.content_id,
            identity,
            bundleId,
        );
        const revision = snapshotReferenceCopySource(
            workspaceRoot,
            retainedBinding,
            stagingWorld,
            basis.basis_id,
        );
        assert.equal(revision.content_id, basis.world_content_id);
        const bundleBytes = bundleId === null ? null : readFileNoFollow(bundlePath);
        const indexBytes = currentIndexBytes(identity, workspace.adoption.mode);
        if (basis.index !== null) {
            assert.ok(indexBytes !== null);
            assert.equal(
                basis.index.receipt_id,
                `${workspaceProtocolConfig.gitCustody.indexIdPrefix}${digest(indexBytes)}`,
            );
        }
        if (bundleBytes !== null) verifyRequiredPackObjects(bundleBytes, basis);
        const current = captureBasis(
            workspaceRoot,
            retainedBinding.binding_id,
            workspace.adoption.mode,
            null,
            identity,
            bundleId,
        );
        // Requires deterministic concurrent-mutation fault injection.
        /* node:coverage disable */
        /* node:coverage ignore next */
        if (current.basis_id !== basis.basis_id) {
            throw gitError("movement");
        }
        /* node:coverage enable */
        const custody = forkReferenceCopyRevisionWithReceipts(
            workspaceRoot,
            revision.revision_id,
            (receiptRoot, custodyId) =>
                publishRetainedDescriptor(
                    receiptRoot,
                    basis,
                    custodyId,
                    revision.revision_id,
                    bundleBytes,
                    indexBytes,
                ),
        );
        try {
            return await readRetained(workspaceRoot, custody.custody_id);
            /* node:coverage disable */
            /* node:coverage ignore next */
            /* node:coverage ignore next */
        } catch (error) {
            await createReferenceCopyCarrierForRetainedCustody({ workspaceRoot }).discard(
                custody.custody_id,
            );
            throw error;
        }
        /* node:coverage enable */
    } finally {
        assertStagingIdentity(staging);
        rmSync(stagingRoot, { recursive: true, force: true });
        syncDirectory(staging.path);
    }
}

function captureBasis(
    workspaceRoot: string,
    bindingId: string,
    mode: WorkspaceAdoptionMode,
    worldContentId: string | null,
    retainedIdentity: GitRepositoryIdentity,
    objectPackId: string | null,
): GitBasisEvidence {
    const identity = readGitIdentity(retainedIdentity.root, retainedIdentity);
    const head = readHead(identity.root);
    // Initialization already requires a commit for git-head adoption.
    /* node:coverage disable */
    /* node:coverage ignore next */
    if (mode === "git-head" && head.commit === null) throw gitError("baseline");
    /* node:coverage enable */
    const index = mode === "worktree" ? readIndex(identity) : null;
    if (index?.entries.some((entry) => entry.stage !== 0)) throw gitError("unsupported");
    const ignoredPaths = mode === "worktree" ? readIgnoredPaths(workspaceRoot, identity.root) : [];
    const ignored = Object.freeze({
        digest: digest(canonicalizeRecord({ paths: ignoredPaths })),
        paths: Object.freeze(ignoredPaths),
        sources_digest: ignoredSourcesDigest(identity),
    });
    const sparseDigest = sparseStateDigest(identity);
    const semanticWorldId =
        worldContentId ?? currentManagedWorldId(workspaceRoot, identity.root, mode);
    const semantic = {
        binding_id: bindingId,
        head,
        ignored_digest: ignored.digest,
        ignored_sources_digest: ignored.sources_digest,
        index,
        mode,
        object_pack_id: objectPackId,
        repository: identity,
        sparse_digest: sparseDigest,
        world_content_id: semanticWorldId,
    };
    return Object.freeze({
        basis_id: `${workspaceProtocolConfig.gitCustody.basisIdPrefix}${digest(canonicalizeRecord(semantic as unknown as SemanticRecord))}`,
        binding_id: bindingId,
        head,
        ignored,
        index,
        mode,
        object_pack_id: objectPackId,
        repository: identity,
        sparse_digest: sparseDigest,
        world_content_id: semanticWorldId,
    });
}

function currentManagedWorldId(
    workspaceRoot: string,
    repositoryRoot: string,
    mode: WorkspaceAdoptionMode,
): string {
    const stagingParent = gitStagingRoot(openWorkspace(workspaceRoot).control_path);
    assertStagingIdentity(stagingParent);
    const root = path.join(stagingParent.path, randomUUID());
    mkdirSync(root, { recursive: true, mode: 0o700 });
    try {
        materializeManagedWorld(workspaceRoot, repositoryRoot, mode, root);
        return inspectReferenceCopySource(workspaceRoot, root, repositoryRoot).content_id;
    } finally {
        assertStagingIdentity(stagingParent);
        rmSync(root, { recursive: true, force: true });
        syncDirectory(stagingParent.path);
    }
}

function materializeManagedWorld(
    workspaceRoot: string,
    repositoryRoot: string,
    mode: WorkspaceAdoptionMode,
    target: string,
): void {
    if (mode === "git-head") {
        const archive = runGit(repositoryRoot, ["archive", "--format=tar", "HEAD"]);
        const extracted = spawnSync(
            workspaceProtocolConfig.gitCustody.archiveExecutable,
            ["-xf", "-", "-C", target],
            {
                input: archive.bytes,
                stdio: ["pipe", "pipe", "pipe"],
            },
        );
        // Archive process fault injection is part of the documented carrier fault harness.
        /* node:coverage disable */
        /* node:coverage ignore next */
        if (extracted.error !== undefined || extracted.status !== 0) throw gitError("control");
        /* node:coverage enable */
        return;
    }
    const paths = readManagedPaths(workspaceRoot, repositoryRoot);
    for (const relative of paths) copyNode(repositoryRoot, target, relative);
}

function copyNode(sourceRoot: string, targetRoot: string, relative: string): void {
    const source = path.join(sourceRoot, ...relative.split("/"));
    const target = path.join(targetRoot, ...relative.split("/"));
    let status: Stats;
    try {
        status = lstatSync(source);
        // Permission/race fault injection beyond ENOENT is a documented hardening task.
        /* node:coverage disable */
        /* node:coverage ignore next */
    } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
        throw error;
    }
    /* node:coverage enable */
    mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    if (status.isDirectory()) {
        if (
            existsSync(
                path.join(
                    sourceRoot,
                    ...relative.split("/"),
                    workspaceProtocolConfig.gitMetadataName,
                ),
            )
        ) {
            assertManagedRepositoryBoundary(sourceRoot, relative);
        }
        mkdirSync(target, { recursive: true, mode: status.mode & 0o777 });
        chmodSync(target, status.mode & 0o777);
    } else if (status.isFile()) {
        writeFileSync(target, readFileSync(source), { mode: status.mode & 0o777 });
        chmodSync(target, status.mode & 0o777);
    } else if (status.isSymbolicLink()) {
        symlinkSync(readlinkSync(source), target);
        // Git cannot index a special filesystem node.
        /* node:coverage disable */
        /* node:coverage ignore next */
    } else {
        throw gitError("unsupported", `unsupported managed Git path: ${relative}`);
    }
    /* node:coverage enable */
}

function assertManagedRepositoryBoundary(repositoryRoot: string, relative: string): void {
    const nested = path.join(
        repositoryRoot,
        ...relative.split("/"),
        workspaceProtocolConfig.gitMetadataName,
    );
    assert.equal(existsSync(nested), true);
    const staged = tryGit(repositoryRoot, ["ls-files", "--stage", "--", relative]);
    // Git versions differ in whether an undeclared embedded repository is enumerated as a
    // directory boundary or rejected earlier as an unsafe managed path.
    /* node:coverage disable */
    if (staged === null || !staged.text.startsWith("160000 ")) {
        throw gitError(
            "unsupported",
            `embedded repository is not a declared submodule: ${relative}`,
        );
    }
    /* node:coverage enable */
    const status = runGit(repositoryRoot, [
        "status",
        "--porcelain=v1",
        "--untracked-files=all",
        "--ignore-submodules=none",
        "--",
        relative,
    ]).text;
    if (status.length > 0) throw gitError("unsupported", `dirty submodule: ${relative}`);
}

function readManagedPaths(workspaceRoot: string, root: string): string[] {
    const command = runGit(root, [
        "ls-files",
        "-z",
        "--cached",
        "--others",
        "--exclude-standard",
        `--exclude=${workspaceProtocolConfig.controlDirectory}/**`,
    ]);
    return managedGitPaths(workspaceRoot, root, command.bytes);
}

function readIgnoredPaths(workspaceRoot: string, root: string): string[] {
    const command = runGit(root, [
        "ls-files",
        "-z",
        "--others",
        "--ignored",
        "--exclude-standard",
        `--exclude=${workspaceProtocolConfig.controlDirectory}/**`,
    ]);
    return managedGitPaths(workspaceRoot, root, command.bytes);
}

function ignoredSourcesDigest(identity: GitRepositoryIdentity): string {
    const repositoryExclude = resolveGitPath(
        identity.root,
        runGit(identity.root, ["rev-parse", "--git-path", "info/exclude"]).text,
    );
    const configured = tryGit(identity.root, ["config", "--path", "--get", "core.excludesFile"]);
    const configuredPath = configured?.text ?? null;
    return digest(
        canonicalizeRecord({
            configured_digest:
                configuredPath !== null && existsSync(configuredPath)
                    ? digest(readFileNoFollow(configuredPath))
                    : null,
            configured_path: configuredPath,
            repository_digest: existsSync(repositoryExclude)
                ? digest(readFileNoFollow(repositoryExclude))
                : null,
        }),
    );
}

function sparseStateDigest(identity: GitRepositoryIdentity): string {
    const patterns = resolveGitPath(
        identity.root,
        runGit(identity.root, ["rev-parse", "--git-path", "info/sparse-checkout"]).text,
    );
    return digest(
        canonicalizeRecord({
            cone:
                tryGit(identity.root, ["config", "--bool", "--get", "core.sparseCheckoutCone"])
                    ?.text ?? null,
            enabled:
                tryGit(identity.root, ["config", "--bool", "--get", "core.sparseCheckout"])?.text ??
                null,
            patterns_digest: existsSync(patterns) ? digest(readFileNoFollow(patterns)) : null,
        }),
    );
}

function managedGitPaths(workspaceRoot: string, bindingRoot: string, value: Buffer): string[] {
    const protectedPrefix = `${workspaceProtocolConfig.controlDirectory}/`;
    const paths = parseNull(value)
        .sort(Buffer.compare)
        .map(decodeGitPath)
        .filter(
            (item) =>
                item !== workspaceProtocolConfig.controlDirectory &&
                !item.startsWith(protectedPrefix),
        );
    for (const candidate of paths) {
        assertWorkspacePathUnprotected({ bindingRoot, path: candidate, workspaceRoot });
    }
    return paths;
}

function decodeGitPath(value: Buffer): string {
    return new TextDecoder("utf-8", { fatal: true }).decode(value);
}

function readIndex(identity: GitRepositoryIdentity) {
    const indexPath = runGit(identity.root, ["rev-parse", "--git-path", "index"]).text;
    const exactIndexPath = resolveGitPath(identity.root, indexPath);
    const indexBytes = readOptionalFile(exactIndexPath);
    const staged = parseNull(runGit(identity.root, ["ls-files", "--stage", "-z"]).bytes);
    const flags = new Map(
        parseNull(runGit(identity.root, ["ls-files", "-v", "-z"]).bytes).map((item) => [
            item.subarray(2).toString("hex"),
            item.subarray(0, 1).toString("ascii"),
        ]),
    );
    const debug = runGit(identity.root, ["ls-files", "--debug", "-z"]).bytes;
    const entries: GitIndexEntry[] = staged.map((item) => {
        const separator = item.indexOf(0x09);
        const header = item.subarray(0, separator).toString("ascii").split(" ");
        const pathBytes = item.subarray(separator + 1);
        const pathValue = decodeGitPath(pathBytes);
        const flag = flags.get(pathBytes.toString("hex"));
        const rawFlags = debugFlagsForPath(debug, pathBytes);
        assert.ok(flag !== undefined && rawFlags !== null);
        return Object.freeze({
            assume_unchanged: flag.toLowerCase() === flag,
            intent_to_add: (rawFlags & 0x20000000) !== 0,
            mode: header[0] as string,
            object_id: header[1] as string,
            path: pathValue,
            skip_worktree: flag.toLowerCase() === "s",
            stage: Number(header[2]),
        });
    });
    assert.equal(digest(readOptionalFile(exactIndexPath)), digest(indexBytes));
    return Object.freeze({
        entries: Object.freeze(entries),
        receipt_id: `${workspaceProtocolConfig.gitCustody.indexIdPrefix}${digest(indexBytes)}`,
    });
}

function debugFlagsForPath(debug: Buffer, pathBytes: Buffer): number | null {
    const marker = Buffer.concat([pathBytes, Buffer.of(0)]);
    const start = debug.indexOf(marker);
    // Paired ls-files commands must emit the same ordered paths and debug flag row.
    /* node:coverage disable */
    /* node:coverage ignore next */
    if (start < 0) return null;
    const nextRecord = debug.indexOf(0, start + marker.length);
    const end = nextRecord < 0 ? debug.length : nextRecord;
    const match = /flags: ([0-9a-fA-F]+)/u.exec(
        debug.subarray(start + marker.length, end).toString("ascii"),
    );
    /* node:coverage ignore next */
    return match === null ? null : Number.parseInt(match[1] as string, 16);
    /* node:coverage enable */
}

function currentIndexBytes(
    identity: GitRepositoryIdentity,
    mode: WorkspaceAdoptionMode,
): Buffer | null {
    if (mode !== "worktree") return null;
    const indexPath = resolveGitPath(
        identity.root,
        runGit(identity.root, ["rev-parse", "--git-path", "index"]).text,
    );
    return readOptionalFile(indexPath);
}

function readOptionalFile(file: string): Buffer {
    if (existsSync(file)) return readFileNoFollow(file);
    return Buffer.alloc(0);
}

function createObjectBundle(repositoryRoot: string, bundlePath: string): string | null {
    const objects = new Set<string>();
    const head = tryGit(repositoryRoot, ["rev-list", "--objects", "HEAD"]);
    for (const line of head?.text.split("\n") ?? []) {
        const objectId = line.split(" ")[0];
        if (objectId !== undefined && objectId.length > 0) objects.add(objectId);
    }
    for (const item of parseNull(runGit(repositoryRoot, ["ls-files", "--stage", "-z"]).bytes)) {
        const header = item.subarray(0, item.indexOf(0x09)).toString("ascii").split(" ");
        if (header[0] !== "160000" && header[1] !== undefined) objects.add(header[1]);
    }
    if (objects.size === 0) return null;
    const bytes = runGit(
        repositoryRoot,
        ["pack-objects", "--stdout"],
        Buffer.from(`${[...objects].sort().join("\n")}\n`, "ascii"),
    ).bytes;
    writeExclusiveBytes(bundlePath, bytes);
    return `${workspaceProtocolConfig.gitCustody.objectPackIdPrefix}${digest(bytes)}`;
}

function readHead(root: string): GitHeadEvidence {
    const symbolic = tryGit(root, ["symbolic-ref", "-q", "HEAD"]);
    const commit = tryGit(root, ["rev-parse", "--verify", "HEAD^{commit}"]);
    if (symbolic !== null) {
        return Object.freeze({
            commit: commit?.text ?? null,
            kind: commit === null ? GIT_HEAD_KINDS[1] : GIT_HEAD_KINDS[0],
            ref: symbolic.text,
        });
    }
    // A non-symbolic HEAD without a commit is corrupt Git state.
    /* node:coverage disable */
    /* node:coverage ignore next */
    if (commit === null) throw gitError("baseline");
    /* node:coverage enable */
    return Object.freeze({ commit: commit.text, kind: GIT_HEAD_KINDS[2], ref: null });
}

function readOrCreateIdentity(
    controlPath: string,
    binding: WorkspaceBinding,
): GitRepositoryIdentity {
    const file = path.join(controlPath, workspaceProtocolConfig.gitCustody.identityFile);
    if (existsSync(file)) return readIdentityDescriptor(file, binding);
    const observed = readGitIdentity(binding.canonical_root, null);
    const descriptor: GitIdentityDescriptor = {
        ...observed,
        format: workspaceProtocolConfig.gitCustody.identityFormat,
        repository_id: readOrCreateRepositoryAuthority(observed),
        version: workspaceProtocolConfig.gitCustody.version,
        worktree_id: `${workspaceProtocolConfig.gitCustody.worktreeIdPrefix}${randomUUID()}`,
    };
    const temporary = `${file}.${randomUUID()}.tmp`;
    writeExclusive(temporary, descriptor);
    try {
        try {
            linkSync(temporary, file);
            /* node:coverage disable */
        } catch (error) {
            if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) {
                throw error;
            }
        }
        /* node:coverage enable */
    } finally {
        unlinkSync(temporary);
    }
    syncDirectory(controlPath);
    return readIdentityDescriptor(file, binding);
}

function readIdentityDescriptor(file: string, binding: WorkspaceBinding): GitRepositoryIdentity {
    const value = exactObject(readJson(file), [
        "bare",
        "common_dir",
        "common_dir_identity",
        "format",
        "git_dir",
        "git_version",
        "object_format",
        "repository_id",
        "root",
        "version",
        "worktree_id",
    ]) as GitIdentityDescriptor;
    assert.equal(value.format, workspaceProtocolConfig.gitCustody.identityFormat);
    assert.equal(value.version, workspaceProtocolConfig.gitCustody.version);
    assert.equal(value.root, binding.canonical_root);
    assert.equal(value.bare, false);
    for (const field of [
        value.common_dir,
        value.common_dir_identity,
        value.git_dir,
        value.git_version,
        value.object_format,
        value.repository_id,
        value.root,
        value.worktree_id,
    ]) {
        assert.equal(typeof field === "string" && field.length > 0, true);
    }
    assert.equal(
        value.repository_id.startsWith(workspaceProtocolConfig.gitCustody.repositoryIdPrefix),
        true,
    );
    assert.equal(
        value.worktree_id.startsWith(workspaceProtocolConfig.gitCustody.worktreeIdPrefix),
        true,
    );
    assert.equal(
        workspaceProtocolConfig.gitCustody.objectFormats.includes(value.object_format),
        true,
    );
    assert.equal(value.repository_id, readOrCreateRepositoryAuthority(binding.canonical_root));
    return readGitIdentity(binding.canonical_root, value);
}

function readOrCreateRepositoryAuthority(identity: GitRepositoryIdentity | string): string {
    const root = typeof identity === "string" ? identity : identity.root;
    const commonDir = realpathSync(
        runGit(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]).text,
    );
    const lock = path.join(
        tmpdir(),
        `${workspaceProtocolConfig.gitCustody.repositoryLockPrefix}${digest(filesystemIdentity(commonDir))}`,
    );
    for (
        let attempt = 0;
        attempt < workspaceProtocolConfig.gitCustody.repositoryLockAttempts;
        attempt += 1
    ) {
        try {
            mkdirSync(lock);
            try {
                return readOrCreateRepositoryAuthorityLocked(root);
            } finally {
                rmSync(lock, { recursive: true });
            }
        } catch (error) {
            if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) {
                throw error;
            }
            Atomics.wait(
                new Int32Array(new SharedArrayBuffer(4)),
                0,
                0,
                workspaceProtocolConfig.gitCustody.repositoryLockDelayMs,
            );
        }
    }
    /* node:coverage disable */
    throw gitError("control", "repository authority coordination timed out");
    /* node:coverage enable */
}

function readOrCreateRepositoryAuthorityLocked(root: string): string {
    const listing = runGit(root, ["worktree", "list", "--porcelain", "-z"]).bytes;
    const authorities = new Set<string>();
    for (const item of parseNull(listing)) {
        const prefix = Buffer.from("worktree ", "ascii");
        if (!item.subarray(0, prefix.length).equals(prefix)) continue;
        const worktreeRoot = realpathSync(decodeGitPath(item.subarray(prefix.length)));
        const control = path.join(worktreeRoot, workspaceProtocolConfig.controlDirectory);
        if (!existsSync(control)) continue;
        const status = lstatSync(control);
        assert.equal(status.isDirectory() && !status.isSymbolicLink(), true);
        const authorityFile = path.join(
            control,
            workspaceProtocolConfig.gitCustody.repositoryIdentityFile,
        );
        if (existsSync(authorityFile)) authorities.add(readRepositoryAuthority(authorityFile));
    }
    assert.ok(authorities.size <= 1, "conflicting repository authority receipts");
    const control = path.join(root, workspaceProtocolConfig.controlDirectory);
    const file = path.join(control, workspaceProtocolConfig.gitCustody.repositoryIdentityFile);
    const authority = authorities.values().next().value as string | undefined;
    if (!existsSync(file)) {
        const temporary = `${file}.${randomUUID()}.tmp`;
        writeExclusive(temporary, {
            repository_id:
                authority ??
                `${workspaceProtocolConfig.gitCustody.repositoryIdPrefix}${randomUUID()}`,
        });
        try {
            try {
                linkSync(temporary, file);
                /* node:coverage disable */
                /* node:coverage ignore next */
            } catch (error) {
                if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) {
                    throw error;
                }
            }
            /* node:coverage enable */
        } finally {
            unlinkSync(temporary);
        }
        syncDirectory(control);
    }
    const current = readRepositoryAuthority(file);
    if (authority !== undefined) assert.equal(current, authority);
    return current;
}

function readRepositoryAuthority(file: string): string {
    const value = exactObject(readJson(file), ["repository_id"]);
    assert.equal(
        typeof value.repository_id === "string" &&
            value.repository_id.startsWith(workspaceProtocolConfig.gitCustody.repositoryIdPrefix),
        true,
    );
    return value.repository_id as string;
}

function readGitIdentity(
    root: string,
    retained: GitRepositoryIdentity | null,
): GitRepositoryIdentity {
    const top = realpathSync(runGit(root, ["rev-parse", "--show-toplevel"]).text);
    if (top !== realpathSync(root))
        throw gitError("unsupported", "binding must equal Git top level");
    const gitDir = realpathSync(runGit(root, ["rev-parse", "--absolute-git-dir"]).text);
    const commonDir = realpathSync(
        runGit(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]).text,
    );
    const objectFormat = runGit(root, ["rev-parse", "--show-object-format"]).text;
    const bare = runGit(root, ["rev-parse", "--is-bare-repository"]).text === "true";
    const gitVersion = runGit(root, ["--version"]).text;
    /* node:coverage ignore next */
    if (bare) throw gitError("unsupported", "bare repositories have no worktree custody");
    // Supported object formats are Git-build capabilities.
    /* node:coverage disable */
    /* node:coverage ignore next */
    if (!workspaceProtocolConfig.gitCustody.objectFormats.includes(objectFormat)) {
        throw gitError("unsupported");
    }
    /* node:coverage enable */
    const observed: GitRepositoryIdentity = Object.freeze({
        bare,
        common_dir: commonDir,
        common_dir_identity: filesystemIdentity(commonDir),
        git_dir: gitDir,
        git_version: gitVersion,
        object_format: objectFormat,
        repository_id: retained?.repository_id ?? "",
        root: top,
        worktree_id: retained?.worktree_id ?? "",
    });
    if (retained !== null) {
        assert.equal(observed.common_dir, retained.common_dir);
        assert.equal(observed.common_dir_identity, retained.common_dir_identity);
        assert.equal(observed.git_dir, retained.git_dir);
        assert.equal(observed.git_version, retained.git_version);
        assert.equal(observed.bare, retained.bare);
        assert.equal(observed.object_format, retained.object_format);
        assert.equal(observed.repository_id, retained.repository_id);
        assert.equal(observed.root, retained.root);
        assert.equal(observed.worktree_id, retained.worktree_id);
    }
    return observed;
}

function revalidateRepositoryBinding(workspaceRoot: string, binding: WorkspaceBinding) {
    const result = createWorkspaceBindings({
        bindings: [{ name: binding.name, root: binding.requested_root }],
        workspaceRoot,
    }).bindings[0];
    assert.ok(result);
    assert.equal(result.binding_id, binding.binding_id);
    assert.equal(result.canonical_root, binding.canonical_root);
    return result;
}

function publishRetainedDescriptor(
    root: string,
    basis: GitBasisEvidence,
    custodyId: string,
    revisionId: string,
    bundleBytes: Buffer | null,
    indexBytes: Buffer | null,
): void {
    if (bundleBytes !== null) {
        writeExclusiveBytes(
            path.join(root, workspaceProtocolConfig.gitCustody.objectPackFile),
            bundleBytes,
        );
    }
    if (indexBytes !== null) {
        writeExclusiveBytes(
            path.join(root, workspaceProtocolConfig.gitCustody.indexReceiptFile),
            indexBytes,
        );
    }
    writeExclusive(path.join(root, workspaceProtocolConfig.gitCustody.descriptorFile), {
        basis,
        custody_id: custodyId,
        format: workspaceProtocolConfig.gitCustody.descriptorFormat,
        revision_id: revisionId,
        version: workspaceProtocolConfig.gitCustody.descriptorVersion,
    });
    syncDirectory(root);
}

async function readRetained(workspaceRoot: string, custodyId: string): Promise<GitRetainedOutput> {
    const carrier = createReferenceCopyCarrierForRetainedCustody({ workspaceRoot });
    const custody = await carrier.openCustody(custodyId);
    const descriptor = exactObject(
        readJson(
            path.join(
                path.dirname(custody.path),
                workspaceProtocolConfig.gitCustody.descriptorFile,
            ),
        ),
        ["basis", "custody_id", "format", "revision_id", "version"],
    ) as RetainedDescriptor;
    assert.equal(descriptor.format, workspaceProtocolConfig.gitCustody.descriptorFormat);
    assert.equal(descriptor.version, workspaceProtocolConfig.gitCustody.descriptorVersion);
    assert.equal(descriptor.custody_id, custodyId);
    const basis = validateBasis(descriptor.basis);
    const revision = await carrier.openRevision(descriptor.revision_id);
    assert.equal(basis.binding_id, revision.binding_id);
    assert.equal(basis.world_content_id, revision.content_id);
    assert.equal(basis.basis_id, revision.basis_ref);
    assert.equal(custody.base_revision_id, revision.revision_id);
    verifyRetainedReceipts(path.dirname(custody.path), basis);
    return freezeRetained({
        basis,
        custody,
        git_custody_version: workspaceProtocolConfig.gitCustody.version,
        revision,
    });
}

function validateBasis(value: unknown): GitBasisEvidence {
    const basis = exactObject(value, [
        "basis_id",
        "binding_id",
        "head",
        "ignored",
        "index",
        "mode",
        "object_pack_id",
        "repository",
        "sparse_digest",
        "world_content_id",
    ]);
    const head = exactObject(basis.head, ["commit", "kind", "ref"]);
    const ignored = exactObject(basis.ignored, ["digest", "paths", "sources_digest"]);
    const repository = exactObject(basis.repository, [
        "bare",
        "common_dir",
        "common_dir_identity",
        "git_dir",
        "git_version",
        "object_format",
        "repository_id",
        "root",
        "worktree_id",
    ]);
    assert.equal(
        typeof basis.basis_id === "string" &&
            typeof basis.binding_id === "string" &&
            typeof basis.mode === "string" &&
            WORKSPACE_ADOPTION_MODES.includes(basis.mode as never) &&
            basis.mode !== "none" &&
            typeof basis.sparse_digest === "string" &&
            typeof basis.world_content_id === "string" &&
            (basis.object_pack_id === null || typeof basis.object_pack_id === "string"),
        true,
    );
    assert.equal(
        typeof head.kind === "string" &&
            workspaceProtocolConfig.gitCustody.headKinds.includes(head.kind) &&
            (head.commit === null || typeof head.commit === "string") &&
            (head.ref === null || typeof head.ref === "string"),
        true,
    );
    const headKind = head.kind;
    assert.equal(
        (headKind === GIT_HEAD_KINDS[0] &&
            typeof head.commit === "string" &&
            typeof head.ref === "string") ||
            (headKind === GIT_HEAD_KINDS[1] &&
                head.commit === null &&
                typeof head.ref === "string") ||
            (headKind === GIT_HEAD_KINDS[2] &&
                typeof head.commit === "string" &&
                head.ref === null),
        true,
    );
    assert.ok(Array.isArray(ignored.paths));
    assert.equal(
        typeof ignored.digest === "string" &&
            typeof ignored.sources_digest === "string" &&
            ignored.paths.every((item) => typeof item === "string"),
        true,
    );
    assert.equal(repository.bare, false);
    assert.equal(
        Object.entries(repository).every(
            ([key, item]) => key === "bare" || typeof item === "string",
        ),
        true,
    );
    const index = basis.index === null ? null : validateIndex(basis.index);
    assert.equal((basis.mode === "worktree") === (index !== null), true);
    const result = Object.freeze({
        basis_id: basis.basis_id,
        binding_id: basis.binding_id,
        head: Object.freeze(head) as unknown as GitHeadEvidence,
        ignored: Object.freeze({
            digest: ignored.digest,
            paths: Object.freeze([...(ignored.paths as string[])]),
            sources_digest: ignored.sources_digest,
        }),
        index,
        mode: basis.mode,
        object_pack_id: basis.object_pack_id,
        repository: Object.freeze(repository) as unknown as GitRepositoryIdentity,
        sparse_digest: basis.sparse_digest,
        world_content_id: basis.world_content_id,
    }) as unknown as GitBasisEvidence;
    const semantic = {
        binding_id: result.binding_id,
        head: result.head,
        ignored_digest: result.ignored.digest,
        ignored_sources_digest: result.ignored.sources_digest,
        index: result.index,
        mode: result.mode,
        object_pack_id: result.object_pack_id,
        repository: result.repository,
        sparse_digest: result.sparse_digest,
        world_content_id: result.world_content_id,
    };
    assert.equal(
        result.basis_id,
        `${workspaceProtocolConfig.gitCustody.basisIdPrefix}${digest(canonicalizeRecord(semantic as unknown as SemanticRecord))}`,
    );
    return result;
}

function validateIndex(value: unknown): GitBasisEvidence["index"] {
    const index = exactObject(value, ["entries", "receipt_id"]);
    assert.ok(Array.isArray(index.entries));
    assert.equal(typeof index.receipt_id, "string");
    const entries = index.entries.map((item) => {
        const entry = exactObject(item, [
            "assume_unchanged",
            "intent_to_add",
            "mode",
            "object_id",
            "path",
            "skip_worktree",
            "stage",
        ]);
        assert.equal(
            typeof entry.assume_unchanged === "boolean" &&
                typeof entry.intent_to_add === "boolean" &&
                typeof entry.mode === "string" &&
                typeof entry.object_id === "string" &&
                typeof entry.path === "string" &&
                typeof entry.skip_worktree === "boolean" &&
                entry.stage === 0,
            true,
        );
        return Object.freeze(entry) as unknown as GitIndexEntry;
    });
    return Object.freeze({
        entries: Object.freeze(entries),
        receipt_id: index.receipt_id as string,
    });
}

function freezeRetained(value: GitRetainedOutput): GitRetainedOutput {
    return Object.freeze({
        basis: Object.freeze(value.basis),
        custody: value.custody,
        git_custody_version: value.git_custody_version,
        revision: value.revision,
    });
}

function gitStagingRoot(controlPath: string): GitStaging {
    const root = path.join(controlPath, workspaceProtocolConfig.gitCustody.stagingDirectory);
    mkdirSync(root, { recursive: true, mode: 0o700 });
    const status = lstatSync(root);
    assert.equal(status.isDirectory() && !status.isSymbolicLink(), true);
    syncDirectory(root);
    syncDirectory(controlPath);
    return { identity: filesystemIdentity(root), path: root };
}

function assertStagingIdentity(staging: GitStaging): void {
    assert.equal(filesystemIdentity(staging.path), staging.identity);
}

function filesystemIdentity(file: string): string {
    const status = lstatSync(file, { bigint: true });
    assert.equal(status.isDirectory() && !status.isSymbolicLink(), true);
    return `${status.dev}:${status.ino}`;
}

function runGit(root: string, args: readonly string[], input?: Buffer): GitCommand {
    const result = spawnSync(
        workspaceProtocolConfig.gitExecutable,
        ["-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "-C", root, ...args],
        {
            encoding: "buffer",
            env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
            maxBuffer: workspaceProtocolConfig.gitCustody.maxCommandBytes,
            input,
            stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
        },
    );
    if (result.error !== undefined || result.status !== 0) throw gitError("control");
    return { bytes: result.stdout, text: result.stdout.toString("utf8").trim() };
}

function tryGit(root: string, args: readonly string[]): GitCommand | null {
    try {
        return runGit(root, args);
    } catch {
        return null;
    }
}

function parseNull(value: Buffer): Buffer[] {
    const items: Buffer[] = [];
    let start = 0;
    for (let index = 0; index < value.length; index += 1) {
        if (value[index] === 0) {
            if (index > start) items.push(value.subarray(start, index));
            start = index + 1;
        }
    }
    assert.equal(start, value.length);
    return items;
}

function readFileNoFollow(file: string): Buffer {
    const before = lstatSync(file, { bigint: true });
    assert.equal(before.isFile() && !before.isSymbolicLink(), true);
    const descriptor = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
        assert.equal(sameFileStatus(before, fstatSync(descriptor, { bigint: true })), true);
        const bytes = readFileSync(descriptor);
        assert.equal(sameFileStatus(before, fstatSync(descriptor, { bigint: true })), true);
        assert.equal(sameFileStatus(before, lstatSync(file, { bigint: true })), true);
        return bytes;
    } finally {
        closeSync(descriptor);
    }
}

function sameFileStatus(left: BigIntStats, right: BigIntStats): boolean {
    return (
        left.dev === right.dev &&
        left.ino === right.ino &&
        left.mode === right.mode &&
        left.size === right.size &&
        left.mtimeNs === right.mtimeNs
    );
}

function resolveGitPath(root: string, file: string): string {
    return path.isAbsolute(file) ? file : path.resolve(root, file);
}

function writeExclusive(file: string, value: object): void {
    const descriptor = openSync(file, "wx", 0o600);
    try {
        writeFileSync(descriptor, `${JSON.stringify(value)}\n`, "utf8");
        fsyncSync(descriptor);
    } finally {
        closeSync(descriptor);
    }
}

function writeExclusiveBytes(file: string, value: Buffer): void {
    const descriptor = openSync(file, "wx", 0o600);
    try {
        writeFileSync(descriptor, value);
        fsyncSync(descriptor);
    } finally {
        closeSync(descriptor);
    }
}

function verifyRetainedReceipts(root: string, basis: GitBasisEvidence): void {
    if (basis.index !== null) {
        const bytes = readFileNoFollow(
            path.join(root, workspaceProtocolConfig.gitCustody.indexReceiptFile),
        );
        assert.equal(
            `${workspaceProtocolConfig.gitCustody.indexIdPrefix}${digest(bytes)}`,
            basis.index.receipt_id,
        );
    }
    if (basis.object_pack_id !== null) {
        const pack = path.join(root, workspaceProtocolConfig.gitCustody.objectPackFile);
        const bytes = readFileNoFollow(pack);
        assert.equal(
            `${workspaceProtocolConfig.gitCustody.objectPackIdPrefix}${digest(bytes)}`,
            basis.object_pack_id,
        );
        assertPackChecksum(bytes, basis.repository.object_format);
        verifyRequiredPackObjects(bytes, basis);
    }
}

function verifyRequiredPackObjects(bytes: Buffer, basis: GitBasisEvidence): void {
    const root = mkdtempSync(path.join(tmpdir(), "shepherd-git-pack-"));
    try {
        runGit(root, ["init", `--object-format=${basis.repository.object_format}`]);
        runGit(root, ["index-pack", "--stdin", "--fix-thin"], bytes);
        if (basis.head.commit !== null) {
            runGit(root, ["rev-list", "--objects", basis.head.commit]);
        }
        for (const entry of basis.index?.entries ?? []) {
            if (entry.mode === "160000") continue;
            const type = runGit(root, ["cat-file", "-t", entry.object_id]).text;
            assert.equal(type, "blob");
        }
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}

function assertPackChecksum(bytes: Buffer, objectFormat: string): void {
    // SHA-256 repositories require a Git build and fixture unavailable on this host.
    /* node:coverage disable */
    const trailerBytes = createHash(objectFormat).digest().length;
    /* node:coverage enable */
    assert.ok(bytes.length > trailerBytes && bytes.subarray(0, 4).toString("ascii") === "PACK");
    assert.equal(
        createHash(objectFormat).update(bytes.subarray(0, -trailerBytes)).digest("hex"),
        bytes.subarray(-trailerBytes).toString("hex"),
    );
}

function readJson(file: string): unknown {
    return JSON.parse(readFileNoFollow(file).toString("utf8")) as unknown;
}

function exactObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
    assert.ok(value !== null && typeof value === "object" && !Array.isArray(value));
    assert.deepEqual(Object.keys(value).sort(), [...keys].sort());
    return value as Record<string, unknown>;
}

function digest(value: string | Buffer): string {
    return createHash(workspaceProtocolConfig.digestAlgorithm).update(value).digest("hex");
}

function readOptions(value: unknown): string {
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError();
    if (
        Object.getPrototypeOf(value) !== Object.prototype ||
        Object.getOwnPropertySymbols(value).length > 0 ||
        Object.values(Object.getOwnPropertyDescriptors(value)).some(
            (descriptor) => !("value" in descriptor),
        ) ||
        Object.keys(value).length !== 1 ||
        !("workspaceRoot" in value)
    ) {
        throw new TypeError();
    }
    const workspaceRoot = (value as Record<string, unknown>).workspaceRoot;
    if (typeof workspaceRoot !== "string" || workspaceRoot.length === 0) throw new TypeError();
    return workspaceRoot;
}

function gitError(
    kind: "baseline" | "control" | "movement" | "unsupported",
    detail?: string,
): GitCustodyError {
    const errors = workspaceProtocolConfig.gitCustody.errors;
    const contract = {
        baseline: [errors.baselineUnavailableCode, errors.baselineUnavailableMessage],
        control: [errors.controlCode, errors.controlMessage],
        movement: [errors.movementCode, errors.movementMessage],
        unsupported: [errors.unsupportedCode, errors.unsupportedMessage],
    } as const;
    const [code, message] = contract[kind];
    return new GitCustodyError(code, detail === undefined ? message : `${message}: ${detail}`);
}

async function invoke<T>(operation: () => T | Promise<T>): Promise<T> {
    try {
        return await operation();
    } catch (error) {
        if (error instanceof GitCustodyError || error instanceof WorkspaceProtectedPathError) {
            throw error;
        }
        throw gitError("control", String(error));
    }
}
