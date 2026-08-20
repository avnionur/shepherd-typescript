import type {
    PLACEMENT_ENVIRONMENTS,
    PLACEMENT_PLATFORM_FAMILIES,
    PLACEMENT_REQUESTS,
    PLACEMENT_RESOLUTION_REASONS,
    PLACEMENT_RESOLUTION_STATUSES,
    RESOLVED_PLACEMENTS,
} from "../protocol/values.generated.ts";
import type { TaskSchema } from "../task/schema.ts";
import type { GitRepositoryGrantPlan } from "./repository-grant-types.ts";
import type {
    RetainedWorldEnforcement,
    RetainedWorldRunner,
} from "./retained-world-runner-types.ts";

/** One configured per-run placement request. */
export type PlacementRequest = (typeof PLACEMENT_REQUESTS)[number];

/** One configured effective placement implemented by the current runtime. */
export type ResolvedPlacement = (typeof RESOLVED_PLACEMENTS)[number];

/** One configured placement-resolution reason. */
export type PlacementResolutionReason = (typeof PLACEMENT_RESOLUTION_REASONS)[number];

/** One configured placement resolution or refusal status. */
export type PlacementResolutionStatus = (typeof PLACEMENT_RESOLUTION_STATUSES)[number];

/** One configured platform-family classification. */
export type PlacementPlatformFamily = (typeof PLACEMENT_PLATFORM_FAMILIES)[number];

/** One configured execution-environment classification. */
export type PlacementEnvironment = (typeof PLACEMENT_ENVIRONMENTS)[number];

/** Closed deterministic probe accepted by {@link createPlacementPlatformEvidence}. */
export type PlacementPlatformEvidenceOptions = {
    /** Names of present environment variables; values are never retained. */
    readonly environmentVariables: readonly string[];
    /** Exact Node platform spelling reported for the execution environment. */
    readonly nodePlatform: string;
    /** Exact operating-system release text used for WSL classification. */
    readonly osRelease: string;
};

/** Immutable content-addressed platform classification used by placement resolution. */
export type PlacementPlatformEvidence = {
    /** Compatibility namespace governing placement evidence. */
    readonly compatibility_version: string;
    /** Classified execution environment. */
    readonly environment: PlacementEnvironment;
    /** Classified platform family. */
    readonly family: PlacementPlatformFamily;
    /** Exact Node platform spelling supplied by the probe. */
    readonly node_platform: string;
    /** Exact operating-system release supplied by the probe. */
    readonly os_release: string;
    /** Content-addressed identity of the complete platform evidence. */
    readonly platform_id: string;
    /** Public platform-evidence protocol version. */
    readonly platform_version: number;
    /** Configured present environment-variable names that contributed WSL evidence. */
    readonly wsl_markers: readonly string[];
};

/** Closed options accepted by {@link createGrantedPlacementResolution}. */
export type GrantedPlacementResolutionOptions<
    I extends TaskSchema<unknown>,
    O extends TaskSchema<unknown>,
> = {
    /** Exact durable capture identity governed by the resolution. */
    readonly captureId: string;
    /** Explicit per-run placement request. */
    readonly placement: PlacementRequest;
    /** Authenticated declared platform classification; local execution requires local inspection. */
    readonly platform: PlacementPlatformEvidence;
    /** Authenticated repository grant plan enforced by this resolution. */
    readonly repositoryGrantPlan: GitRepositoryGrantPlan;
    /** Exact durable run identity governed by the resolution. */
    readonly runId: string;
    /** Authenticated runner whose actual enforcement is reported. */
    readonly runner: RetainedWorldRunner<I, O>;
};

/** Immutable content-addressed placement resolution for one exact granted run capture. */
export type GrantedPlacementResolution = {
    /** Exact durable capture identity governed by the resolution. */
    readonly capture_id: string;
    /** Compatibility namespace governing placement resolution. */
    readonly compatibility_version: string;
    /** Actual enforcement provided by the resolved execution seam. */
    readonly enforcement: RetainedWorldEnforcement;
    /** Complete authenticated execution-platform evidence. */
    readonly platform: PlacementPlatformEvidence;
    /** Public placement-resolution artifact version. */
    readonly placement_version: number;
    /** Configured reason explaining the resolution or visible fallback. */
    readonly reason: PlacementResolutionReason;
    /** Exact repository grant plan governed by the placement. */
    readonly repository_grant_plan_id: string;
    /** Explicit caller-requested placement. */
    readonly requested_placement: PlacementRequest;
    /** Content-addressed identity of the complete resolution. */
    readonly resolution_id: string;
    /** Effective placement actually supplied by this runtime. */
    readonly resolved_placement: ResolvedPlacement;
    /** Exact durable run identity governed by the resolution. */
    readonly run_id: string;
    /** Exact authenticated runner identity. */
    readonly runner_id: string;
    /** Configured successful resolution status. */
    readonly status: PlacementResolutionStatus;
    /** Exact bodyless task artifact governed by the grant plan. */
    readonly task_artifact_digest: string;
};

/** Stable public evidence attached to a fail-closed unavailable placement request. */
export type PlacementRefusalEvidence = {
    /** Public placement artifact protocol version. */
    readonly placement_version: number;
    /** Configured reason the request cannot resolve. */
    readonly reason: PlacementResolutionReason;
    /** Exact refused placement request. */
    readonly requested_placement: PlacementRequest;
    /** Configured refusal status. */
    readonly status: PlacementResolutionStatus;
};
