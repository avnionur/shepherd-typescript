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

/** One logical root proposed for canonical workspace authority. */
export type WorkspaceBindingDefinition = {
    /** Exact logical name used to refer to the authority. */
    readonly name: string;
    /** Existing directory, absolute or relative to the initialized workspace root. */
    readonly root: string;
};

/** Closed options accepted by {@link createWorkspaceBindings}. */
export type WorkspaceBindingOptions = {
    /** Complete proposed binding set validated atomically. */
    readonly bindings: readonly WorkspaceBindingDefinition[];
    /** Existing initialized workspace root. */
    readonly workspaceRoot: string;
};

/** Frozen canonical authority for one disjoint workspace root. */
export type WorkspaceBinding = {
    /** Stable content-addressed identity derived from workspace, name, and canonical root. */
    readonly binding_id: string;
    /** Filesystem-resolved absolute authority root. */
    readonly canonical_root: string;
    /** Exact logical binding name. */
    readonly name: string;
    /** Non-authoritative path spelling supplied by the caller. */
    readonly requested_root: string;
};

/** Frozen complete binding authority set for one initialized workspace. */
export type WorkspaceBindingSet = {
    /** Configured canonical-binding protocol version. */
    readonly binding_version: number;
    /** Ordered, canonical, pairwise-disjoint binding authorities. */
    readonly bindings: readonly WorkspaceBinding[];
    /** Canonical initialized workspace root containing every authority. */
    readonly workspace_root: string;
};
