import type { WORKSPACE_ADOPTION_MODES } from "../protocol/values.generated.ts";

/** Configured baseline-adoption mode used when initializing a workspace. */
export type WorkspaceAdoptionMode = (typeof WORKSPACE_ADOPTION_MODES)[number];

/** Closed options accepted by {@link initializeWorkspace}. */
export type WorkspaceInitializationOptions = {
    /** Baseline to cite without modifying ordinary workspace files or Git history. */
    readonly adopt?: WorkspaceAdoptionMode;
    /** Whether to initialize Git when the workspace is not already contained by a repository. */
    readonly initializeGit?: boolean;
    /** Existing directory to initialize as the workspace root. */
    readonly rootPath: string;
};

/** Immutable baseline citation retained by workspace control metadata. */
export type WorkspaceAdoption = {
    /** Content identity of the adopted Git HEAD or ordinary worktree, otherwise `null`. */
    readonly baseline_ref: string | null;
    /** Git commit cited at initialization, or `null` when unavailable or not adopted. */
    readonly git_head: string | null;
    /** Configured baseline-adoption mode. */
    readonly mode: WorkspaceAdoptionMode;
};

/** Immutable current Git context observed while opening workspace control state. */
export type WorkspaceGitState = {
    /** Current Git HEAD commit, or `null` for an unborn or absent repository. */
    readonly head: string | null;
    /** Canonical containing Git repository root, or `null` when Git is not initialized. */
    readonly repository_root: string | null;
};

/** Frozen validated workspace initialization state. */
export type WorkspaceState = {
    /** Immutable baseline citation retained at initialization. */
    readonly adoption: WorkspaceAdoption;
    /** Canonical protected workspace-control directory. */
    readonly control_path: string;
    /** Stable workspace-control manifest format. */
    readonly format: string;
    /** Stable workspace-control manifest version. */
    readonly format_version: number;
    /** Current Git context, observed without modifying history or index state. */
    readonly git: WorkspaceGitState;
    /** Whether initialization was authorized to create Git when absent. */
    readonly initialize_git: boolean;
    /** Canonical workspace root. */
    readonly root_path: string;
};
