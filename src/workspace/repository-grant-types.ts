import type {
    REPOSITORY_GRANT_ATOMS,
    REPOSITORY_GRANT_PROFILES,
} from "../protocol/values.generated.ts";
import type { TaskSchema } from "../task/schema.ts";
import type { TaskDescriptor } from "../task/types.ts";
import type { RetainedWorldEnforcement } from "./retained-world-runner-types.ts";
import type { GitRepositoryBinding } from "./types.ts";

/** One configured repository authority atom. */
export type RepositoryGrantAtom = (typeof REPOSITORY_GRANT_ATOMS)[number];

/** One configured whole-repository authority profile. */
export type RepositoryGrantProfile = (typeof REPOSITORY_GRANT_PROFILES)[number];

/** One logical per-binding repository grant declared by a task. */
export type RepositoryTaskGrantDefinition = {
    /** Logical binding name resolved to one exact repository resource at run admission. */
    readonly binding: string;
    /** Configured whole-repository authority profile. */
    readonly profile: RepositoryGrantProfile;
};

/** Closed options accepted by {@link grantTaskRepositories}. */
export type GrantTaskRepositoriesOptions<
    I extends TaskSchema<unknown>,
    O extends TaskSchema<unknown>,
> = {
    /** Complete declared repository authority surface for the task. */
    readonly grants: readonly RepositoryTaskGrantDefinition[];
    /** Package-created bodyless task whose exact artifact is governed by the grants. */
    readonly task: TaskDescriptor<I, O>;
};

/** Canonical identity-bearing task repository-grant artifact. */
export type RepositoryTaskGrantArtifact = {
    /** Compatibility namespace governing repository task-grant semantics. */
    readonly compatibility_version: string;
    /** Public repository task-grant artifact version. */
    readonly grant_version: number;
    /** Canonically ordered complete per-binding grant surface. */
    readonly grants: readonly {
        /** Logical binding name. */
        readonly binding: string;
        /** Configured whole-repository grant profile. */
        readonly profile: RepositoryGrantProfile;
    }[];
    /** Exact underlying bodyless task artifact digest. */
    readonly task_artifact_digest: string;
};

/** Exact content-addressed lock for one repository task-grant artifact. */
export type RepositoryTaskGrantArtifactLock = {
    /** Digest of the complete canonical repository task-grant artifact. */
    readonly artifact_digest: string;
    /** Public repository task-grant artifact version. */
    readonly grant_version: number;
    /** Exact underlying bodyless task artifact digest. */
    readonly task_artifact_digest: string;
    /** Stable identity of this exact task and grant surface. */
    readonly task_grant_id: string;
};

/** Authenticated task plus its immutable explicit repository grant surface. */
export type RepositoryGrantedTask<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>> = {
    /** Canonical task-grant artifact. */
    readonly artifact: RepositoryTaskGrantArtifact;
    /** Exact content-addressed artifact lock. */
    readonly artifactLock: RepositoryTaskGrantArtifactLock;
    /** Canonically ordered task declarations. */
    readonly grants: readonly RepositoryTaskGrantDefinition[];
    /** Exact authenticated bodyless task governed by this grant artifact. */
    readonly task: TaskDescriptor<I, O>;
};

/** Closed options accepted by {@link createGitRepositoryGrantPlan}. */
export type GitRepositoryGrantPlanOptions<
    I extends TaskSchema<unknown>,
    O extends TaskSchema<unknown>,
> = {
    /** Whole-run ceiling intersected with every task-declared binding profile. */
    readonly authorityCeiling: RepositoryGrantProfile;
    /** Complete package-created repository resource set resolved by logical binding name. */
    readonly bindings: readonly GitRepositoryBinding[];
    /** Authenticated task repository-grant artifact admitted for this exact run resource set. */
    readonly task: RepositoryGrantedTask<I, O>;
};

/** One admitted repository resource and its non-amplifying effective authority. */
export type GitRepositoryGrantPlanEntry = {
    /** Configured authority atoms remaining after whole-run attenuation. */
    readonly authority: readonly RepositoryGrantAtom[];
    /** Exact canonical workspace binding identity. */
    readonly binding_id: string;
    /** Logical binding name declared by the task. */
    readonly binding_name: string;
    /** Stable exact repository resource identity. */
    readonly resource_id: string;
    /** Task-declared whole-repository profile before attenuation. */
    readonly task_profile: RepositoryGrantProfile;
};

/** Authenticated exact resource admission plan for one repository-granted task run. */
export type GitRepositoryGrantPlan = {
    /** Whole-run authority ceiling applied to every admitted binding. */
    readonly authority_ceiling: RepositoryGrantProfile;
    /** Truthful enforcement classification provided by this plan's runtime seam. */
    readonly enforcement: RetainedWorldEnforcement;
    /** Canonically ordered exact resource grants. */
    readonly grants: readonly GitRepositoryGrantPlanEntry[];
    /** Public repository grant-plan protocol version. */
    readonly grant_plan_version: number;
    /** Content-addressed identity of the complete admitted grant plan. */
    readonly plan_id: string;
    /** Exact bodyless task artifact governed by this plan. */
    readonly task_artifact_digest: string;
    /** Exact task repository-grant artifact governed by this plan. */
    readonly task_grant_artifact_digest: string;
};
