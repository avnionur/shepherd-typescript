import { canonicalizeSemanticValue, type SemanticValue } from "../canonical/canonical-record.ts";
import type { RepositoryTaskGrantDefinition } from "../workspace/repository-grant-types.ts";
import { grantTaskRepositories } from "../workspace/repository-grants.ts";
import { TaskRegistryError } from "./registry-errors.ts";
import type { TaskRegistration, TaskRepositoryGrantEvidence } from "./types.ts";
import { readTaskDataObject } from "./validation.ts";
import { taskDescriptorOf } from "./value.ts";

/** Decodes a persisted companion by rebuilding its exact task and configured grant artifact. @internal */
export function decodeRegisteredGrant(
    value: string,
    registration: TaskRegistration,
): TaskRepositoryGrantEvidence {
    try {
        const fields = readTaskDataObject(
            JSON.parse(value),
            ["artifact", "artifact_lock"],
            "registered grant",
        );
        const artifact = readTaskDataObject(
            fields.artifact,
            ["compatibility_version", "grant_version", "grants", "task_artifact_digest"],
            "registered grant artifact",
        );
        const rebuilt = grantTaskRepositories({
            task: taskDescriptorOf({
                artifact: registration.artifact,
                artifact_lock: registration.artifactLock,
            }),
            grants: artifact.grants as readonly RepositoryTaskGrantDefinition[],
        });
        const evidence = Object.freeze({
            artifact: rebuilt.artifact,
            artifact_lock: rebuilt.artifactLock,
        });
        if (
            canonicalizeSemanticValue(fields as SemanticValue) !==
            canonicalizeSemanticValue(evidence as unknown as SemanticValue)
        ) {
            throw new TypeError(
                "registered grant differs from its exact task or canonical companion lock",
            );
        }
        return evidence;
    } catch (error) {
        throw new TaskRegistryError("stored repository-grant declaration is malformed", {
            cause: error,
        });
    }
}
