import type { WORKSPACE_ADOPTION_MODES, WORLD_ENTRY_KINDS } from "../protocol/values.generated.ts";

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

/** Configured logical entry kind represented by a copy-carrier manifest. */
export type WorldEntryKind = (typeof WORLD_ENTRY_KINDS)[number];

/** One canonical logical filesystem entry retained by the reference carrier. */
export type WorldManifestEntry = {
    /** Exact file-byte digest for regular files, otherwise `null`. */
    readonly blob_id: string | null;
    /** Configured logical filesystem kind. */
    readonly kind: WorldEntryKind;
    /** Portable supported permission bits for files and directories. */
    readonly mode: number | null;
    /** Platform-neutral relative path using `/` separators. */
    readonly path: string;
    /** Logical byte length for regular files, otherwise `null`. */
    readonly size: number | null;
    /** Exact target text for symbolic links, otherwise `null`. */
    readonly symlink_target: string | null;
};

/** Immutable verified copy-world revision retained under carrier custody. */
export type WorldRevision = {
    /** Configured copy backend kind. */
    readonly backend: string;
    /** Exact workspace binding cited by this revision. */
    readonly binding_id: string;
    /** Adopted workspace basis cited when the verified copy was captured, or `null`. */
    readonly basis_ref: string | null;
    /** Configured evidence classification distinguishing verified copy from atomic snapshot. */
    readonly capture_kind: string;
    /** Stable canonical manifest content identity. */
    readonly content_id: string;
    /** Closed copy-carrier descriptor version. */
    readonly descriptor_version: number;
    /** Frozen canonical ordered filesystem manifest. */
    readonly manifest: readonly WorldManifestEntry[];
    /** Canonical absolute retained tree path. */
    readonly path: string;
    /** Parent revision identity, `null` for a binding snapshot. */
    readonly parent_revision_id: string | null;
    /** Immutable revision identity binding content and authority. */
    readonly revision_id: string;
};

/** Mutable retained checkout forked from an immutable copy-world revision. */
export type WorldCustody = {
    /** Configured copy backend kind. */
    readonly backend: string;
    /** Immutable content identity present when custody was created. */
    readonly base_content_id: string;
    /** Immutable revision from which custody was forked. */
    readonly base_revision_id: string;
    /** Exact workspace binding inherited from the base revision. */
    readonly binding_id: string;
    /** Stable owned mutable custody identifier. */
    readonly custody_id: string;
    /** Closed copy-carrier descriptor version. */
    readonly descriptor_version: number;
    /** Canonical absolute retained mutable tree path. */
    readonly path: string;
};

/** Structured verification evidence for a retained revision or mutable custody. */
export type WorldVerification = {
    /** Recomputed canonical manifest content identity. */
    readonly content_id: string;
    /** Whether current custody differs from its immutable base content. */
    readonly modified: boolean;
    /** Recomputed canonical ordered filesystem manifest. */
    readonly manifest: readonly WorldManifestEntry[];
};

/** Closed options accepted by {@link createReferenceCopyCarrier}. */
export type ReferenceCopyCarrierOptions = {
    /** Existing initialized workspace whose protected control root owns carrier custody. */
    readonly workspaceRoot: string;
};

/** Public workspace protocol v3 reference copy-carrier operations. */
export type ReferenceCopyCarrier = {
    /**
     * Physically discards one exact mutable custody receipt without changing its parent revision.
     *
     * @param custodyId - Exact custody identity previously returned by {@link fork}.
     * @returns Completion after an idempotent discard decision and cleanup.
     * @throws {WorldCarrierError} If custody or its discard evidence is unsafe or malformed.
     */
    readonly discard: (custodyId: string) => Promise<void>;
    /**
     * Forks one verified immutable revision into isolated mutable retained custody.
     *
     * @param revisionId - Exact immutable revision identity.
     * @returns Newly published mutable custody initially equal to the base.
     * @throws {WorldCarrierError} If the base or carrier storage fails verification.
     */
    readonly fork: (revisionId: string) => Promise<WorldCustody>;
    /**
     * Reopens one retained mutable custody from its closed descriptor.
     *
     * @param custodyId - Exact custody identity.
     * @returns Validated retained custody receipt.
     * @throws {WorldCarrierError} If custody, its base, or carrier storage fails verification.
     */
    readonly openCustody: (custodyId: string) => Promise<WorldCustody>;
    /**
     * Reopens one immutable retained revision from its closed descriptor.
     *
     * @param revisionId - Exact revision identity.
     * @returns Validated immutable revision descriptor.
     * @throws {WorldCarrierError} If retained revision evidence fails verification.
     */
    readonly openRevision: (revisionId: string) => Promise<WorldRevision>;
    /**
     * Captures one exact validated workspace binding into an immutable retained revision.
     *
     * @param binding - Canonical binding authority returned by {@link createWorkspaceBindings}.
     * @returns Atomically published, reopenable, verified revision.
     * @throws {WorldCarrierError} If capture, verification, or publication fails closed.
     */
    readonly snapshot: (binding: WorkspaceBinding) => Promise<WorldRevision>;
    /**
     * Recomputes the current manifest of mutable custody and reports whether it changed.
     *
     * @param custodyId - Exact custody identity.
     * @returns Structured current-content verification evidence.
     * @throws {WorldCarrierError} If custody or its immutable base fails verification.
     */
    readonly verifyCustody: (custodyId: string) => Promise<WorldVerification>;
    /**
     * Recomputes and validates one immutable revision against its closed descriptor.
     *
     * @param revisionId - Exact revision identity.
     * @returns Structured immutable-content verification evidence.
     * @throws {WorldCarrierError} If content or retained descriptor evidence is inconsistent.
     */
    readonly verifyRevision: (revisionId: string) => Promise<WorldVerification>;
};
