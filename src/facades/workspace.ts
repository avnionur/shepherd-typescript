/** Stable Node-only ESM subpath for workspace authority and retained-world operations. */
export {
    RetainedWorldSettlementConflictError,
    RetainedWorldSettlementInvalidError,
} from "../store/errors.ts";
export type {
    RetainedWorldApplicationPlanEvidence,
    RetainedWorldSettlementAdmission,
    RetainedWorldSettlementRequest,
} from "../store/types.ts";
export {
    createGitRepositoryBindings,
    createWorkspaceBindings,
} from "../workspace/bindings.ts";
export { createWorldChangesetInspection } from "../workspace/changeset-inspection.ts";
export { createWorldChangeset } from "../workspace/changesets.ts";
export {
    GitCustodyError,
    RetainedWorldApplicationConflictError,
    WorkspaceBindingError,
    WorkspaceControlError,
    WorkspaceInitializationConflictError,
    WorldCarrierError,
    WorldChangesetError,
} from "../workspace/errors.ts";
export { createGitAwareCustody } from "../workspace/git-aware-custody.ts";
export { createGitChangesetInspection } from "../workspace/git-changeset-inspection.ts";
export { initializeWorkspace, openWorkspace } from "../workspace/initialization.ts";
export {
    createNativeJailCommand,
    createNativeJailPlacementResolution,
    createNativeJailRunner,
    inspectLocalNativeJailBackend,
    NativeJailExecutionError,
    NativeJailUnavailableError,
} from "../workspace/native-jail.ts";
export type {
    NativeJailBackendDescriptor,
    NativeJailBackendName,
    NativeJailBackendProbeEvidence,
    NativeJailCommand,
    NativeJailCommandDefinition,
    NativeJailConfinementPlan,
    NativeJailEnvironmentEntry,
    NativeJailLaunchIntent,
    NativeJailLaunchReceipt,
    NativeJailPlacementReason,
    NativeJailPlacementResolution,
    NativeJailPlacementResolutionOptions,
    NativeJailProbeReason,
    NativeJailProbeStatus,
    NativeJailProcessStarted,
    NativeJailProcessStatus,
    NativeJailQuiescenceStatus,
    NativeJailRunner,
    NativeJailRunnerDefinition,
} from "../workspace/native-jail-types.ts";
export {
    createGrantedPlacementResolution,
    createPlacementPlatformEvidence,
    inspectLocalPlacementPlatformEvidence,
    PlacementUnavailableError,
} from "../workspace/placement.ts";
export type {
    GrantedPlacementResolution,
    GrantedPlacementResolutionOptions,
    PlacementEnvironment,
    PlacementPlatformEvidence,
    PlacementPlatformEvidenceOptions,
    PlacementPlatformFamily,
    PlacementRefusalEvidence,
    PlacementRequest,
    PlacementResolutionReason,
    PlacementResolutionStatus,
    ResolvedPlacement,
} from "../workspace/placement-types.ts";
export type {
    WorkspaceCustodyFaultEvidence,
    WorkspaceCustodyFaultInjection,
    WorkspaceGitPlatformPolicy,
    WorkspacePlatformConformance,
    WorkspacePlatformConformanceOptions,
} from "../workspace/platform-conformance.ts";
export {
    inspectWorkspacePlatformConformance,
    WorkspaceCustodyFaultError,
} from "../workspace/platform-conformance.ts";
export type {
    WorkspacePathProtectionOptions,
    WorkspacePathProtectionValidation,
} from "../workspace/protected-control-paths.ts";
export {
    inspectWorkspacePathProtection,
    WorkspaceProtectedPathError,
} from "../workspace/protected-control-paths.ts";
export { createReferenceCopyCarrier } from "../workspace/reference-copy-carrier.ts";
export type {
    GitRepositoryGrantPlan,
    GitRepositoryGrantPlanEntry,
    GitRepositoryGrantPlanOptions,
    GrantTaskRepositoriesOptions,
    RepositoryGrantAtom,
    RepositoryGrantedTask,
    RepositoryGrantProfile,
    RepositoryTaskGrantArtifact,
    RepositoryTaskGrantArtifactLock,
    RepositoryTaskGrantDefinition,
} from "../workspace/repository-grant-types.ts";
export {
    createGitRepositoryGrantPlan,
    grantTaskRepositories,
} from "../workspace/repository-grants.ts";
export { inspectRetainedWorldApplicationConflicts } from "../workspace/retained-world-application.ts";
export type {
    InspectRetainedWorldApplicationConflictsOptions,
    RetainedWorldApplicationConflict,
    RetainedWorldApplicationConflictEvidence,
    RetainedWorldApplicationConflictKind,
} from "../workspace/retained-world-application-types.ts";
export { createRetainedWorldRunner } from "../workspace/retained-world-runner.ts";
export type {
    RetainedWorldCapability,
    RetainedWorldEnforcement,
    RetainedWorldExecutionContext,
    RetainedWorldRunner,
    RetainedWorldRunnerDefinition,
} from "../workspace/retained-world-runner-types.ts";
export {
    applyRetainedWorldSettlement,
    discardRetainedWorldSettlement,
    inspectRetainedWorldApplicationPlan,
    inspectRetainedWorldRelease,
    inspectRetainedWorldSettlement,
    prepareRetainedWorldSettlement,
    releaseRetainedWorldSettlement,
    selectRetainedWorldSettlement,
} from "../workspace/retained-world-settlement.ts";
export type {
    AppliedRetainedWorldSettlement,
    ApplyRetainedWorldSettlementOptions,
    DiscardedRetainedWorldSettlement,
    DiscardRetainedWorldSettlementOptions,
    PreparedRetainedWorldSettlement,
    PrepareRetainedWorldSettlementOptions,
    ReleasedRetainedWorldSettlement,
    ReleaseRetainedWorldSettlementOptions,
    SelectedRetainedWorldSettlement,
    SelectRetainedWorldSettlementOptions,
} from "../workspace/retained-world-settlement-types.ts";
export { discardScope } from "../workspace/scope-discard.ts";
export { forkScope } from "../workspace/scope-fork.ts";
export type { ForkScopeOptions } from "../workspace/scope-fork-types.ts";
export { mergeScope } from "../workspace/scope-merge.ts";
export type {
    DiscardScopeOptions,
    MergeScopeOptions,
} from "../workspace/scope-terminal-types.ts";
export {
    captureGrantedTaskWorldDurably,
    captureJailedGrantedTaskWorldDurably,
    capturePlacedGrantedTaskWorldDurably,
    captureTaskWorldDurably,
    recoverGrantedTaskWorldDurably,
    recoverJailedGrantedTaskWorldDurably,
    recoverPlacedGrantedTaskWorldDurably,
    recoverTaskWorldDurably,
} from "../workspace/task-world-execution.ts";
export type {
    CaptureGrantedTaskWorldOptions,
    CaptureJailedGrantedTaskWorldOptions,
    CapturePlacedGrantedTaskWorldOptions,
    CaptureTaskWorldOptions,
    JailedTaskWorldCaptureResult,
    PlacedTaskWorldCaptureResult,
    RecoverGrantedTaskWorldOptions,
    RecoverJailedGrantedTaskWorldOptions,
    RecoverPlacedGrantedTaskWorldOptions,
    RecoverTaskWorldOptions,
    RetainedWorldOutput,
    TaskWorldCaptureResult,
} from "../workspace/task-world-execution-types.ts";
export { inspectTaskWorldCaptureJournal } from "../workspace/task-world-journal.ts";
export type {
    TaskWorldCaptureJournalInspection,
    TaskWorldCaptureJournalStatus,
    TaskWorldCaptureJournalTransition,
} from "../workspace/task-world-journal-types.ts";
export type {
    GitAwareCustody,
    GitAwareCustodyOptions,
    GitBasisEvidence,
    GitChangesetInspection,
    GitChangesetInspectionOptions,
    GitChangesetNode,
    GitChangesetPathChange,
    GitCustodyVerification,
    GitHeadEvidence,
    GitHeadKind,
    GitIgnoredEvidence,
    GitIndexEntry,
    GitIndexEvidence,
    GitRepositoryBinding,
    GitRepositoryBindingSet,
    GitRepositoryIdentity,
    GitRetainedOutput,
    GitSymlinkModePresentation,
    ReferenceCopyCarrier,
    ReferenceCopyCarrierOptions,
    WorkspaceAdoption,
    WorkspaceAdoptionMode,
    WorkspaceBinding,
    WorkspaceBindingDefinition,
    WorkspaceBindingOptions,
    WorkspaceBindingSet,
    WorkspaceGitState,
    WorkspaceInitializationOptions,
    WorkspaceRepositoryBindingEvidence,
    WorkspaceState,
    WorldChangeNode,
    WorldChangeOperation,
    WorldChangeset,
    WorldChangesetInspection,
    WorldChangesetInspectionOptions,
    WorldChangesetOptions,
    WorldChangesetPage,
    WorldChangesetPageOptions,
    WorldContentRead,
    WorldContentReadOptions,
    WorldCustody,
    WorldDerivedMove,
    WorldEntryKind,
    WorldManifestEntry,
    WorldPathChange,
    WorldRevision,
    WorldTextPreview,
    WorldTextPreviewOptions,
    WorldVerification,
} from "../workspace/types.ts";
