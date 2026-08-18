import { createRecordId, type SemanticRecord } from "../canonical/canonical-record.ts";
import { createCanonicalSnapshot } from "../canonical/snapshot.ts";
import { workspaceProtocolConfig } from "../protocol/config.ts";
import { readRepositoryGrantPlanEvidence } from "../protocol/repository-grant-evidence.ts";
import { assertTaskDescriptor } from "../task/descriptor.ts";
import type { TaskSchema } from "../task/schema.ts";
import {
    assertCurrentGitRepositoryBinding,
    assertWorkspaceBinding,
    gitRepositoryBindingWorkspaceRoot,
    isGitRepositoryBinding,
} from "./bindings.ts";
import type {
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
} from "./repository-grant-types.ts";
import type { GitRepositoryBinding } from "./types.ts";

type StoredPlan = {
    readonly resources: ReadonlyMap<
        string,
        {
            readonly binding: GitRepositoryBinding;
            readonly grant: GitRepositoryGrantPlanEntry;
        }
    >;
    readonly taskArtifactDigest: string;
};

const AUTHENTICATED_GRANTED_TASKS = new WeakSet<object>();
const AUTHENTICATED_GRANT_PLANS = new WeakMap<object, StoredPlan>();
const PROFILE_ATOMS = new Map(
    workspaceProtocolConfig.repositoryGrants.profiles.map(({ atoms, name }) => [name, atoms]),
);

/**
 * Binds an explicit canonical repository grant surface to one bodyless task artifact.
 *
 * Existing task artifacts are not modified: this creates a separate versioned companion artifact
 * whose identity changes with the grant surface while preserving the exact underlying task digest.
 *
 * @param options - Exact authenticated task and complete per-binding grant declaration.
 * @returns Frozen authenticated repository-granted task artifact.
 * @throws {TypeError} If options, task, bindings, profiles, or duplicates are invalid.
 *
 * @example
 * ```ts
 * const granted = grantTaskRepositories({
 *     task: descriptor,
 *     grants: [{ binding: "source", profile: "read-write" }],
 * });
 * ```
 *
 * @public
 */
export function grantTaskRepositories<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>>(
    options: GrantTaskRepositoriesOptions<I, O>,
): RepositoryGrantedTask<I, O> {
    const fields = readExactObject(options, ["grants", "task"], "repository task grant options");
    const task = fields.task as GrantTaskRepositoriesOptions<I, O>["task"];
    assertTaskDescriptor(task);
    const grants = readGrantDefinitions(fields.grants);
    const artifact = createCanonicalSnapshot({
        compatibility_version: workspaceProtocolConfig.repositoryGrants.compatibilityVersion,
        grant_version: workspaceProtocolConfig.repositoryGrants.artifactVersion,
        grants: grants.map(({ binding, profile }) => ({ binding, profile })),
        task_artifact_digest: task.artifactLock.artifact_digest,
    }) as RepositoryTaskGrantArtifact;
    const artifactDigest = createRecordId(artifact as unknown as SemanticRecord);
    const artifactLock = createCanonicalSnapshot({
        artifact_digest: artifactDigest,
        grant_version: workspaceProtocolConfig.repositoryGrants.artifactVersion,
        task_artifact_digest: task.artifactLock.artifact_digest,
        task_grant_id: prefixedIdentity(
            workspaceProtocolConfig.repositoryGrants.taskGrantIdPrefix,
            artifactDigest,
        ),
    }) as RepositoryTaskGrantArtifactLock;
    const grantedTask = Object.freeze({ artifact, artifactLock, grants, task });
    AUTHENTICATED_GRANTED_TASKS.add(grantedTask);
    return grantedTask;
}

/**
 * Admits exact repository resources and applies a non-amplifying whole-run authority ceiling.
 *
 * @param options - Authenticated granted task, complete repository binding set, and global ceiling.
 * @returns Frozen authenticated grant plan bound to every exact repository resource identity.
 * @throws {TypeError} If the definition is malformed, forged, incomplete, duplicated, or mismatched.
 *
 * @example
 * ```ts
 * const plan = createGitRepositoryGrantPlan({
 *     authorityCeiling: "read-only",
 *     bindings: repositoryBindings.bindings,
 *     task: granted,
 * });
 * ```
 *
 * @public
 */
export function createGitRepositoryGrantPlan<
    I extends TaskSchema<unknown>,
    O extends TaskSchema<unknown>,
>(options: GitRepositoryGrantPlanOptions<I, O>): GitRepositoryGrantPlan {
    const fields = readExactObject(
        options,
        ["authorityCeiling", "bindings", "task"],
        "repository grant plan options",
    );
    const task = fields.task as RepositoryGrantedTask<I, O>;
    if (!AUTHENTICATED_GRANTED_TASKS.has(task)) {
        throw new TypeError("repository-granted task must be created by this package instance");
    }
    const ceiling = readProfile(fields.authorityCeiling, "repository grant authority ceiling");
    if (!Array.isArray(fields.bindings)) {
        throw new TypeError("repository grant bindings must be an array");
    }
    const byName = new Map<string, GitRepositoryBinding>();
    const workspaceRoots = new Set<string>();
    for (const value of fields.bindings) {
        assertWorkspaceBinding(value);
        if (!isGitRepositoryBinding(value)) {
            throw new TypeError(
                "repository grant bindings must carry repository resource identity",
            );
        }
        if (byName.has(value.name)) {
            throw new TypeError("repository grant bindings must be unique");
        }
        byName.set(value.name, value);
        workspaceRoots.add(gitRepositoryBindingWorkspaceRoot(value));
    }
    if (
        workspaceRoots.size !== 1 ||
        byName.size !== task.grants.length ||
        task.grants.some(({ binding }) => !byName.has(binding))
    ) {
        throw new TypeError("repository grant bindings differ from the task grant surface");
    }
    const ceilingAtoms = profileAtoms(ceiling);
    const grants = Object.freeze(
        task.grants.map(({ binding, profile }): GitRepositoryGrantPlanEntry => {
            const resource = byName.get(binding) as GitRepositoryBinding;
            const requestedAtoms = profileAtoms(profile);
            return Object.freeze({
                authority: Object.freeze(
                    requestedAtoms.filter((atom) => ceilingAtoms.includes(atom)),
                ),
                binding_id: resource.binding_id,
                binding_name: binding,
                resource_id: resource.resource_id,
                task_profile: profile,
            });
        }),
    );
    const semantic = createCanonicalSnapshot({
        authority_ceiling: ceiling,
        enforcement: workspaceProtocolConfig.repositoryGrants.enforcement,
        grants,
        grant_plan_version: workspaceProtocolConfig.repositoryGrants.planVersion,
        task_artifact_digest: task.artifactLock.task_artifact_digest,
        task_grant_artifact_digest: task.artifactLock.artifact_digest,
    });
    const planDigest = createRecordId(semantic as SemanticRecord);
    const plan = Object.freeze({
        ...semantic,
        plan_id: prefixedIdentity(
            workspaceProtocolConfig.repositoryGrants.planIdPrefix,
            planDigest,
        ),
    }) as GitRepositoryGrantPlan;
    readRepositoryGrantPlanEvidence(plan);
    AUTHENTICATED_GRANT_PLANS.set(plan, {
        resources: new Map(
            grants.map((grant) => [
                grant.binding_name,
                {
                    binding: byName.get(grant.binding_name) as GitRepositoryBinding,
                    grant,
                },
            ]),
        ),
        taskArtifactDigest: task.artifactLock.task_artifact_digest,
    });
    return plan;
}

/** Authenticates one plan and returns its exact grant for an active binding. @internal */
export function assertGitRepositoryGrantPlan(
    plan: GitRepositoryGrantPlan,
    taskArtifactDigest: string,
    binding: GitRepositoryBinding,
): GitRepositoryGrantPlanEntry {
    const stored = AUTHENTICATED_GRANT_PLANS.get(plan);
    if (stored === undefined || stored.taskArtifactDigest !== taskArtifactDigest) {
        throw new TypeError("repository grant plan is invalid for the task artifact");
    }
    const active = stored.resources.get(binding.name);
    if (active === undefined || active.binding !== binding) {
        throw new TypeError("repository grant plan is invalid for the active resource");
    }
    for (const resource of stored.resources.values()) {
        assertCurrentGitRepositoryBinding(resource.binding);
    }
    return active.grant;
}

function readGrantDefinitions(value: unknown): readonly RepositoryTaskGrantDefinition[] {
    if (!Array.isArray(value) || value.length === 0) {
        throw new TypeError("repository task grants must be a non-empty array");
    }
    const grants = value.map((definition, index) => {
        const fields = readExactObject(
            definition,
            ["binding", "profile"],
            `repository task grant ${index}`,
        );
        const binding = readText(fields.binding, `repository task grant ${index} binding`);
        return Object.freeze({
            binding,
            profile: readProfile(fields.profile, `repository task grant ${index} profile`),
        });
    });
    grants.sort((left, right) =>
        left.binding < right.binding ? -1 : left.binding > right.binding ? 1 : 0,
    );
    if (grants.some((grant, index) => grant.binding === grants[index - 1]?.binding)) {
        throw new TypeError("repository task grant bindings must be unique");
    }
    return Object.freeze(grants);
}

function readProfile(value: unknown, subject: string): RepositoryGrantProfile {
    if (
        typeof value !== "string" ||
        !workspaceProtocolConfig.repositoryGrants.profiles.some(({ name }) => name === value)
    ) {
        throw new TypeError(`${subject} is unsupported`);
    }
    return value as RepositoryGrantProfile;
}

function profileAtoms(profile: RepositoryGrantProfile): readonly RepositoryGrantAtom[] {
    return PROFILE_ATOMS.get(profile) as readonly RepositoryGrantAtom[];
}

function readText(value: unknown, subject: string): string {
    if (
        typeof value !== "string" ||
        value.trim().length === 0 ||
        value === "." ||
        value === ".." ||
        value.includes("/") ||
        value.includes("\\") ||
        value.includes("\0") ||
        /[\uD800-\uDFFF]/u.test(value)
    ) {
        throw new TypeError(`${subject} is invalid`);
    }
    return value;
}

function readExactObject(
    value: unknown,
    expected: readonly string[],
    subject: string,
): Record<string, unknown> {
    if (
        value === null ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    ) {
        throw new TypeError(`${subject} must be exact data`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors).sort();
    if (
        keys.length !== expected.length ||
        keys.some((key, index) => key !== expected[index]) ||
        expected.some((key) => !("value" in (descriptors[key] as PropertyDescriptor)))
    ) {
        throw new TypeError(`${subject} must be exact data`);
    }
    return Object.fromEntries(
        expected.map((key) => [key, (descriptors[key] as PropertyDescriptor).value]),
    );
}

function prefixedIdentity(prefix: string, digest: string): string {
    return `${prefix}${digest.slice(digest.lastIndexOf(":") + 1)}`;
}
