import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { TestContext } from "node:test";

import {
    claimScopeWriter,
    createGitRepositoryBindings,
    createReferenceCopyCarrier,
    createWorkspaceBindings,
    initializeWorkspace,
    type ReferenceCopyCarrier,
    registerRootScope,
    type ScopeResourceGrant,
    type ScopeRootRegistrationReceipt,
    type ScopeWriter,
    SQLiteTraceStore,
    type WorkspaceBinding,
    type WorldCarrierBackend,
} from "../../src/index.ts";

/** One real workspace with two directory bindings, a carrier, and a writer-held root scope. */
export type ForkWorkspace = {
    readonly carrier: ReferenceCopyCarrier;
    readonly databasePath: string;
    readonly docs: WorkspaceBinding;
    readonly root: ScopeRootRegistrationReceipt;
    readonly rootWriter: ScopeWriter;
    readonly source: WorkspaceBinding;
    readonly store: SQLiteTraceStore;
    readonly workspaceRoot: string;
};

/** Builds one read-write workspace-binding resource grant. */
export function bindingGrant(
    binding: WorkspaceBinding,
    atoms: readonly ("read" | "write")[] = ["read", "write"],
): ScopeResourceGrant {
    return { atoms, resource_id: binding.binding_id, resource_kind: "workspace_binding" };
}

/** Creates a temporary workspace, bindings, carrier, store, and root scope writer. */
export async function createForkWorkspace(
    context: TestContext,
    label: string,
    StoreClass: typeof SQLiteTraceStore = SQLiteTraceStore,
    backend?: WorldCarrierBackend,
): Promise<ForkWorkspace> {
    const workspaceRoot = await realpath(
        await mkdtemp(path.join(tmpdir(), `shepherd-scope-fork-${label}-`)),
    );
    context.after(() => rm(workspaceRoot, { force: true, recursive: true }));
    initializeWorkspace({ adopt: "none", initializeGit: false, rootPath: workspaceRoot });
    await mkdir(path.join(workspaceRoot, "source"));
    await writeFile(path.join(workspaceRoot, "source", "file.txt"), "source\n");
    await mkdir(path.join(workspaceRoot, "docs"));
    await writeFile(path.join(workspaceRoot, "docs", "guide.md"), "docs\n");
    const [source, docs] = createWorkspaceBindings({
        bindings: [
            { name: "source", root: "source" },
            { name: "docs", root: "docs" },
        ],
        workspaceRoot,
    }).bindings as readonly [WorkspaceBinding, WorkspaceBinding];
    const carrier = createReferenceCopyCarrier(
        backend === undefined ? { workspaceRoot } : { backend, workspaceRoot },
    );
    const databasePath = path.join(workspaceRoot, "trace.sqlite");
    const store = new StoreClass(databasePath);
    const root = registerRootScope(store, {
        authority: {
            ceiling: [bindingGrant(source), bindingGrant(docs)],
            grant: [bindingGrant(source), bindingGrant(docs)],
        },
        commandId: "scope-command:root",
    });
    const rootWriter = claimScopeWriter(store, {
        claimId: "claim:root",
        nowMilliseconds: 1_000,
        scopeId: root.scope_id,
    });
    return { carrier, databasePath, docs, root, rootWriter, source, store, workspaceRoot };
}

/** Builds the default fork request from a fixture workspace root into its source binding. */
export function forkOptions(workspace: ForkWorkspace, originRevisionId: string) {
    return {
        binding: workspace.source,
        carrier: workspace.carrier,
        commandId: "scope-command:fork",
        expectedHeadRecordId: workspace.root.head.record_id,
        grant: [bindingGrant(workspace.source)],
        nowMilliseconds: 1_500,
        originRevisionId,
        parent: workspace.rootWriter,
    };
}

/** Creates one exact Git worktree binding beneath an initialized workspace. */
export async function createRepositoryBinding(
    workspaceRoot: string,
    name: string,
): Promise<WorkspaceBinding> {
    const root = path.join(workspaceRoot, name);
    await mkdir(root);
    const git = (...args: readonly string[]) =>
        execFileSync("git", ["-C", root, ...args], {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
        });
    git("init");
    git("config", "user.email", "test@example.invalid");
    git("config", "user.name", "Shepherd Test");
    await writeFile(path.join(root, "tracked.txt"), "tracked\n");
    git("add", "tracked.txt");
    git("commit", "-m", "baseline");
    const [binding] = createGitRepositoryBindings({
        bindings: [{ name, root: name }],
        workspaceRoot,
    }).bindings;
    return binding as WorkspaceBinding;
}
