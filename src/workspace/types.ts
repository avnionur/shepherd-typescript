import type {
    BACKEND_SELECTION_MODES,
    GIT_HEAD_KINDS,
    GITLINK_ENTRY_KIND,
    WORKSPACE_ADOPTION_MODES,
    WORLD_CARRIER_BACKENDS,
    WORLD_CHANGE_OPERATIONS,
    WORLD_DERIVED_MOVE_KINDS,
    WORLD_ENTRY_KINDS,
    WORLD_TEXT_PREVIEW_CLASSIFICATIONS,
    WORLD_TEXT_PREVIEW_ENCODING,
} from "../protocol/values.generated.ts";
import type { WorkspaceCustodyFaultInjection } from "./platform-conformance.ts";

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

/** Read-only Git authority observed for one exact repository binding root. */
export type WorkspaceRepositoryBindingEvidence = {
    /** Canonical Git common directory shared by linked worktrees. */
    readonly common_dir: string;
    /** Filesystem revalidation identity for the common directory. */
    readonly common_dir_identity: string;
    /** Canonical per-worktree Git directory. */
    readonly git_dir: string;
    /** Filesystem revalidation identity for the per-worktree Git directory. */
    readonly git_dir_identity: string;
    /** Configured supported Git object format. */
    readonly object_format: string;
    /** Stable content-addressed local repository authority. */
    readonly repository_id: string;
    /** Exact canonical Git worktree top level. */
    readonly root: string;
};

/** Frozen repository-aware authority extending one canonical workspace binding. */
export type GitRepositoryBinding = WorkspaceBinding & {
    /** Exact repository evidence bound into the resource identity. */
    readonly repository: WorkspaceRepositoryBindingEvidence;
    /** Stable content-addressed identity for this repository-backed resource. */
    readonly resource_id: string;
    /** Configured repository resource discriminant. */
    readonly resource_type: string;
};

/** Frozen complete repository-binding set for one initialized workspace. */
export type GitRepositoryBindingSet = {
    /** Underlying canonical directory-binding protocol version. */
    readonly binding_version: number;
    /** Ordered, canonical, pairwise-disjoint repository authorities. */
    readonly bindings: readonly GitRepositoryBinding[];
    /** Repository-aware binding protocol version. */
    readonly repository_binding_version: number;
    /** Canonical initialized workspace root containing every repository authority. */
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

/** Configured selectable world-carrier backend name. */
export type WorldCarrierBackend = (typeof WORLD_CARRIER_BACKENDS)[number];

/**
 * Configured backend selection mode: `strict` refuses when the requested backend is unavailable;
 * `fallback` degrades along the configured fallback order and records the backend actually used.
 */
export type BackendSelectionMode = (typeof BACKEND_SELECTION_MODES)[number];

/** One carrier backend probed while selecting the backend of a carrier. */
export type WorldCarrierBackendAttempt = {
    /** Configured backend that was probed. */
    readonly backend: WorldCarrierBackend;
    /** Configured availability reason observed for the backend. */
    readonly reason: string;
    /** Configured parity status observed for the backend. */
    readonly status: string;
};

/** Selection evidence naming the requested and the actually used carrier backend. */
export type WorldCarrierBackendSelection = {
    /** Every backend probed, in order, ending with the used backend. */
    readonly attempts: readonly WorldCarrierBackendAttempt[];
    /** Selection mode applied. */
    readonly mode: BackendSelectionMode;
    /** Backend the caller requested, or the configured default. */
    readonly requested: WorldCarrierBackend;
    /** Backend the carrier uses; equals `requested` in strict mode. */
    readonly used: WorldCarrierBackend;
};

/** Immutable verified copy-world revision retained under carrier custody. */
export type WorldRevision = {
    /**
     * Configured copy descriptor backend kind. Every carrier backend retains revisions in this one
     * descriptor format, so revision identity never depends on the physical backend.
     */
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

/** Configured semantic operation for one canonical changed path. */
export type WorldChangeOperation = (typeof WORLD_CHANGE_OPERATIONS)[number];

/** Closed semantic state of one path in a world revision. */
export type WorldChangeNode =
    | { readonly kind: (typeof WORLD_ENTRY_KINDS)[0]; readonly mode: number }
    | {
          readonly byte_length: number;
          readonly content_id: string;
          readonly kind: (typeof WORLD_ENTRY_KINDS)[1];
          readonly mode: number;
      }
    | {
          readonly kind: (typeof WORLD_ENTRY_KINDS)[2];
          readonly mode: null;
          readonly target: string;
      };

/** One canonical reconstructive path change between two exact world revisions. */
export type WorldPathChange = {
    /** Semantic state in the head revision, or `null` for deletion. */
    readonly after: WorldChangeNode | null;
    /** Semantic state in the base revision, or `null` for addition. */
    readonly before: WorldChangeNode | null;
    /** Operation derived from before/after presence and node kinds. */
    readonly operation: WorldChangeOperation;
    /** Canonical binding-relative path. */
    readonly path: string;
};

/** Immutable content-addressed comparison of two ordered world revisions. */
export type WorldChangeset = {
    /** Exact base revision identity. */
    readonly base_revision_id: string;
    /** Exact workspace binding shared by both revisions. */
    readonly binding_id: string;
    /** Canonical reconstructive path changes. */
    readonly changes: readonly WorldPathChange[];
    /** Content-addressed identity of the complete comparison. */
    readonly changeset_id: string;
    /** Canonical ordered changed paths derived from {@link changes}. */
    readonly changed_paths: readonly string[];
    /** Exact head revision identity. */
    readonly head_revision_id: string;
    /** Workspace changeset protocol version. */
    readonly schema_version: number;
};

/** Closed options accepted by {@link createWorldChangeset}. */
export type WorldChangesetOptions = {
    /** Verified immutable base revision. */
    readonly baseRevision: WorldRevision;
    /** Retained carrier that owns and verifies both cited revisions. */
    readonly carrier: ReferenceCopyCarrier;
    /** Verified immutable head revision. */
    readonly headRevision: WorldRevision;
};

/** Closed options accepted by {@link createWorldChangesetInspection}. */
export type WorldChangesetInspectionOptions = WorldChangesetOptions;

/** Closed bounded pagination options for canonical world changes. */
export type WorldChangesetPageOptions = {
    /** Maximum number of changes to return, bounded by configured protocol limits. */
    readonly limit?: number;
    /** Zero-based canonical change offset. */
    readonly offset?: number;
};

/** One immutable bounded page of canonical world changes. */
export type WorldChangesetPage = {
    /** Canonical changes in this page. */
    readonly changes: readonly WorldPathChange[];
    /** Next zero-based offset, or `null` when this page is final. */
    readonly next_offset: number | null;
    /** Zero-based offset represented by this page. */
    readonly offset: number;
    /** Total canonical changes in the authenticated changeset. */
    readonly total: number;
};

/** Closed bounded options for reading authenticated retained content. */
export type WorldContentReadOptions = {
    /** Exact file-content identity cited by the inspected changeset. */
    readonly contentId: string;
    /** Maximum bytes to return, bounded by configured protocol limits. */
    readonly length?: number;
    /** Zero-based byte offset within the complete retained content. */
    readonly offset?: number;
};

/** One authenticated bounded retained-content byte slice. */
export type WorldContentRead = {
    /** Defensive copy of retained content bytes in this slice. */
    readonly bytes: Uint8Array;
    /** Exact authenticated file-content identity. */
    readonly content_id: string;
    /** Zero-based byte offset represented by this slice. */
    readonly offset: number;
    /** Total authenticated content byte length. */
    readonly total_bytes: number;
    /** Whether authenticated content remains after this slice. */
    readonly truncated: boolean;
};

/** Closed bounded options for an authenticated retained text preview. */
export type WorldTextPreviewOptions = {
    /** Exact file-content identity cited by the inspected changeset. */
    readonly contentId: string;
    /** Maximum source bytes considered, bounded by configured protocol limits. */
    readonly maxBytes?: number;
    /** Maximum decoded lines returned, bounded by configured protocol limits. */
    readonly maxLines?: number;
};

/** One authenticated bounded text or binary classification. */
export type WorldTextPreview =
    | {
          /** Total authenticated content byte length. */
          readonly byte_length: number;
          /** Configured text classification. */
          readonly classification: (typeof WORLD_TEXT_PREVIEW_CLASSIFICATIONS)[0];
          /** Exact authenticated file-content identity. */
          readonly content_id: string;
          /** Configured text decoding label. */
          readonly encoding: typeof WORLD_TEXT_PREVIEW_ENCODING;
          /** Bounded decoded preview text. */
          readonly text: string;
          /** Whether byte or line bounds omitted authenticated content. */
          readonly truncated: boolean;
      }
    | {
          /** Total authenticated content byte length. */
          readonly byte_length: number;
          /** Configured binary classification. */
          readonly classification: (typeof WORLD_TEXT_PREVIEW_CLASSIFICATIONS)[1];
          /** Exact authenticated file-content identity. */
          readonly content_id: string;
          /** Binary content has no text encoding. */
          readonly encoding: null;
          /** Binary content has no decoded text. */
          readonly text: null;
          /** Binary classification never exposes an unbounded preview. */
          readonly truncated: boolean;
      };

/** One deterministic exact-content move projection outside canonical changeset identity. */
export type WorldDerivedMove = {
    /** Exact regular-file content shared by the source and target. */
    readonly content_id: string;
    /** Configured rename or copy classification. */
    readonly kind: (typeof WORLD_DERIVED_MOVE_KINDS)[number];
    /** Canonical path in the base revision. */
    readonly source_path: string;
    /** Canonical added path in the head revision. */
    readonly target_path: string;
};

/** Authenticated read-only projection over one retained world changeset. */
export type WorldChangesetInspection = {
    /** Exact authenticated canonical changeset. */
    readonly changeset: WorldChangeset;
    /** Public changeset-inspection protocol version. */
    readonly inspection_version: number;
    /**
     * Returns the exact canonical change for a binding-relative path.
     *
     * @param path - Canonical binding-relative path.
     * @returns The authenticated path change, or `null` when unchanged or absent.
     * @throws {WorldChangesetError} If the path is malformed or unsafe.
     */
    readonly change: (path: string) => WorldPathChange | null;
    /**
     * Returns deterministic exact-content rename/copy projections outside semantic identity.
     *
     * @returns Frozen bounded projections derived from canonical retained evidence.
     */
    readonly derivedMoves: () => readonly WorldDerivedMove[];
    /**
     * Returns one bounded canonical page without reading the user workspace.
     *
     * @param options - Optional configured limit and zero-based offset.
     * @returns Frozen canonical page with total and continuation offset.
     * @throws {WorldChangesetError} If options exceed configured bounds or are malformed.
     */
    readonly page: (options?: WorldChangesetPageOptions) => WorldChangesetPage;
    /**
     * Reads one bounded authenticated byte slice by cited file-content identity.
     *
     * @param options - Exact cited content identity and optional byte range.
     * @returns Defensive byte copy with total length and truncation evidence.
     * @throws {WorldChangesetError} If evidence, range, or retained bytes fail validation.
     */
    readonly readContent: (options: WorldContentReadOptions) => Promise<WorldContentRead>;
    /**
     * Returns one bounded UTF-8 preview or explicit binary classification.
     *
     * @param options - Exact cited content identity and optional byte/line bounds.
     * @returns Authenticated text preview or binary classification.
     * @throws {WorldChangesetError} If evidence, bounds, or retained bytes fail validation.
     */
    readonly previewText: (options: WorldTextPreviewOptions) => Promise<WorldTextPreview>;
};

/** Mutable retained checkout forked from an immutable copy-world revision. */
export type WorldCustody = {
    /** Configured backend that materialized this mutable custody. */
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
    /**
     * Optional configured physical backend; omitted selects the copy reference backend. Under the
     * default `strict` selection an optimized backend fails closed at creation when the host cannot
     * run it; under `fallback` selection the carrier degrades along the configured order instead.
     *
     * `clone` uses forced FICLONE on Linux reflink filesystems. On macOS, where Node cannot force a
     * clone, it requires a configured C compiler: a `clonefile(2)` helper is compiled once per
     * process into a private 0700 temporary directory as a 0500 executable, and its owner, mode,
     * and digest are rechecked before each use. Every regular file then costs one helper process
     * spawn. Without a compiler the carrier refuses with the helper-unavailable reason. `overlay`
     * requires Linux with permission to run the configured mount and unmount executables.
     */
    readonly backend?: WorldCarrierBackend;
    /**
     * Optional selection mode; omitted uses `workspaces.carrierBackends.selection.defaultMode`
     * (`strict`). `fallback` tries `backend` and then every later backend of the configured
     * fallback order, which ends with `copy`, and records the attempts in
     * {@link ReferenceCopyCarrier.backendSelection}.
     */
    readonly backendSelection?: BackendSelectionMode;
    /** Optional deterministic conformance fault injected at one configured custody boundary. */
    readonly faultInjection?: WorkspaceCustodyFaultInjection;
    /** Existing initialized workspace whose protected control root owns carrier custody. */
    readonly workspaceRoot: string;
};

/** Public workspace protocol v6 reference copy-carrier operations. */
export type ReferenceCopyCarrier = {
    /** Configured physical backend this carrier actually uses. */
    readonly backend: WorldCarrierBackend;
    /** Requested backend, selection mode, probe attempts, and the backend actually used. */
    readonly backendSelection: WorldCarrierBackendSelection;
    /**
     * Publishes the current verified custody as an immutable child world revision.
     *
     * The caller must already have fenced and quiesced every writer for this custody.
     *
     * @param custodyId - Exact quiesced mutable custody identity to capture.
     * @returns Parent-linked immutable revision containing the custody's current bytes.
     * @throws {WorldCarrierError} If custody, base, content, or publication fails verification.
     */
    readonly captureCustody: (custodyId: string) => Promise<WorldRevision>;
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

/** Configured Git HEAD-state discriminant. */
export type GitHeadKind = (typeof GIT_HEAD_KINDS)[number];

/** Closed canonical Git HEAD evidence captured for one basis. */
export type GitHeadEvidence = {
    /** Full resolved commit object ID, or `null` for an unborn branch. */
    readonly commit: string | null;
    /** Attached, unborn, or detached HEAD classification. */
    readonly kind: GitHeadKind;
    /** Full symbolic ref name for attached or unborn HEAD, otherwise `null`. */
    readonly ref: string | null;
};

/** One canonical Git index entry including stage and special flags. */
export type GitIndexEntry = {
    /** Whether Git marks the entry assume-unchanged. */
    readonly assume_unchanged: boolean;
    /** Whether the entry is an intent-to-add placeholder. */
    readonly intent_to_add: boolean;
    /** Exact Git object mode. */
    readonly mode: string;
    /** Exact staged object ID. */
    readonly object_id: string;
    /** NUL-safe repository-relative path. */
    readonly path: string;
    /** Whether Git marks the entry skip-worktree. */
    readonly skip_worktree: boolean;
    /** Git index stage, from zero through three. */
    readonly stage: number;
};

/** Exact and semantic Git index evidence retained for a worktree basis. */
export type GitIndexEvidence = {
    /** Canonical semantic index entries. */
    readonly entries: readonly GitIndexEntry[];
    /** Digest citation for the exact opaque index bytes. */
    readonly receipt_id: string;
};

/** Stable local repository and worktree authority evidence. */
export type GitRepositoryIdentity = {
    /** Whether Git reports the repository as bare. */
    readonly bare: boolean;
    /** Canonical Git common directory. */
    readonly common_dir: string;
    /** Filesystem revalidation receipt for the canonical common directory. */
    readonly common_dir_identity: string;
    /** Canonical per-worktree Git directory. */
    readonly git_dir: string;
    /** Exact Git executable version used to capture this identity. */
    readonly git_version: string;
    /** Configured Git object hash format. */
    readonly object_format: string;
    /** Persisted Shepherd-local repository identity. */
    readonly repository_id: string;
    /** Exact canonical Git worktree root. */
    readonly root: string;
    /** Persisted Shepherd-local worktree identity. */
    readonly worktree_id: string;
};

/** Auditable ignored-untracked exclusion evidence. */
export type GitIgnoredEvidence = {
    /** Content digest of the canonical excluded path set. */
    readonly digest: string;
    /** Exact excluded ignored paths observed at capture. */
    readonly paths: readonly string[];
    /** Digest of effective repository and user exclusion-source receipts. */
    readonly sources_digest: string;
};

/** Immutable Git-aware basis evidence for retained output custody. */
export type GitBasisEvidence = {
    /** Content-addressed semantic basis identity. */
    readonly basis_id: string;
    /** Exact workspace binding identity. */
    readonly binding_id: string;
    /** Canonical Git HEAD evidence. */
    readonly head: GitHeadEvidence;
    /** Ignored-untracked exclusion evidence. */
    readonly ignored: GitIgnoredEvidence;
    /** Exact and semantic index evidence for worktree adoption, otherwise `null`. */
    readonly index: GitIndexEvidence | null;
    /** Configured adoption mode. */
    readonly mode: WorkspaceAdoptionMode;
    /** Digest receipt for independently custodied required Git objects, or `null`. */
    readonly object_pack_id: string | null;
    /** Stable repository and worktree authority. */
    readonly repository: GitRepositoryIdentity;
    /** Digest of sparse-checkout configuration and pattern receipts. */
    readonly sparse_digest: string;
    /** Canonical managed filesystem content identity. */
    readonly world_content_id: string;
};

/** One restart-safe retained output fork bound to an exact Git basis. */
export type GitRetainedOutput = {
    /** Immutable Git-aware basis descriptor. */
    readonly basis: GitBasisEvidence;
    /** Mutable isolated output custody. */
    readonly custody: WorldCustody;
    /** Workspace protocol version owning this public receipt. */
    readonly git_custody_version: number;
    /** Immutable managed-world revision underlying the output. */
    readonly revision: WorldRevision;
};

/** Closed options accepted by {@link createGitChangesetInspection}. */
export type GitChangesetInspectionOptions = {
    /** Exact retained Git-aware base custody identity. */
    readonly baseCustodyId: string;
    /** Exact retained Git-aware head custody identity. */
    readonly headCustodyId: string;
    /** Initialized workspace owning both Git-aware retained outputs. */
    readonly workspaceRoot: string;
};

/** Git-aware path state, including external Gitlink commit citations. */
export type GitChangesetNode =
    | WorldChangeNode
    | {
          /** Exact external commit object ID cited by the superproject index. */
          readonly commit_oid: string;
          /** Configured Gitlink presentation discriminant. */
          readonly kind: typeof GITLINK_ENTRY_KIND;
          /** Exact configured Gitlink index mode. */
          readonly mode: string;
      };

/** One Git-aware path change projection outside canonical world identity. */
export type GitChangesetPathChange = {
    /** Git-aware head state, or `null` for deletion. */
    readonly after: GitChangesetNode | null;
    /** Git-aware base state, or `null` for addition. */
    readonly before: GitChangesetNode | null;
    /** Canonical operation derived from the projected nodes. */
    readonly operation: WorldChangeOperation;
    /** Canonical repository-relative path. */
    readonly path: string;
};

/** Git symbolic-link mode presentation retained outside canonical world identity. */
export type GitSymlinkModePresentation = {
    /** Exact base Git symlink mode, or `null` when absent. */
    readonly before_mode: string | null;
    /** Exact head Git symlink mode, or `null` when absent. */
    readonly after_mode: string | null;
    /** Canonical repository-relative symbolic-link path. */
    readonly path: string;
};

/** Authenticated Git-aware projection composed with canonical world inspection. */
export type GitChangesetInspection = {
    /** Gitlink-aware projected changes excluded from canonical changeset identity. */
    readonly git_changes: readonly GitChangesetPathChange[];
    /** Public changeset-inspection protocol version. */
    readonly inspection_version: number;
    /** Retained Git symbolic-link modes for changed symlink paths. */
    readonly symlink_modes: readonly GitSymlinkModePresentation[];
    /** Authenticated canonical copy-world inspection. */
    readonly world: WorldChangesetInspection;
};

/** Verification of retained output and the current user Git basis. */
export type GitCustodyVerification = {
    /** Whether the user's current semantic basis differs from the retained basis. */
    readonly basis_moved: boolean;
    /** Current verification of the isolated retained output. */
    readonly output: WorldVerification;
};

/** Closed options accepted by {@link createGitAwareCustody}. */
export type GitAwareCustodyOptions = {
    /** Optional deterministic conformance fault injected at one configured Git-custody boundary. */
    readonly faultInjection?: WorkspaceCustodyFaultInjection;
    /** Existing initialized workspace owning Git-aware retained output custody. */
    readonly workspaceRoot: string;
};

/** Public workspace protocol v4 Git-aware custody operations. */
export type GitAwareCustody = {
    /**
     * Captures the initialized Git adoption basis and creates isolated retained output custody.
     *
     * @param binding - Exact repository-root binding.
     * @returns Retained output, or `null` when adoption mode is `none`.
     * @throws {GitCustodyError} If Git state or publication fails closed.
     */
    readonly capture: (binding: WorkspaceBinding) => Promise<GitRetainedOutput | null>;
    /**
     * Discards one exact retained output without changing the user repository or immutable basis.
     *
     * @param custodyId - Exact retained output custody identity.
     * @returns Completion after Task 3 carrier discard.
     * @throws {GitCustodyError} If retained evidence is unavailable or malformed.
     */
    readonly discard: (custodyId: string) => Promise<void>;
    /**
     * Reopens one retained output from its closed descriptor.
     *
     * @param custodyId - Exact retained output custody identity.
     * @returns Verified retained Git-aware output.
     * @throws {GitCustodyError} If retained evidence fails validation.
     */
    readonly open: (custodyId: string) => Promise<GitRetainedOutput>;
    /**
     * Verifies retained output and compares the current Git basis with its captured basis.
     *
     * @param custodyId - Exact retained output custody identity.
     * @returns Output verification and conservative basis-movement classification.
     * @throws {GitCustodyError} If retained or current Git evidence cannot be verified.
     */
    readonly verify: (custodyId: string) => Promise<GitCustodyVerification>;
};
