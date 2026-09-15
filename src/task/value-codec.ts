import { canonicalizeRecord } from "../canonical/canonical-record.ts";
import { createCanonicalSnapshot } from "../canonical/snapshot.ts";
import { createTaskArtifactLock } from "./lock.ts";
import { readTaskArtifact, readTaskArtifactLock } from "./registry-codec.ts";
import type { TaskValue } from "./types.ts";
import { readTaskDataObject } from "./validation.ts";

/**
 * Validates one untrusted task value: a plain data object with exactly `artifact` and
 * `artifact_lock`, whose lock re-derives from the artifact.
 *
 * Extra keys, accessors, foreign schema documents, unsupported schema grammar, unsupported
 * protocol versions, and a lock that disagrees with the artifact are refused. Nothing in a task
 * value is evaluated.
 *
 * @param value - Untrusted task value.
 * @returns The frozen canonical task value.
 * @throws {TypeError} If the value is malformed or its lock does not match its artifact.
 *
 * @example
 * ```ts
 * const value = readTaskValue(JSON.parse(text));
 * ```
 *
 * @public
 */
export function readTaskValue(value: unknown): TaskValue {
    const fields = readTaskDataObject(value, ["artifact", "artifact_lock"], "task value");
    const artifact = readTaskArtifact(fields.artifact);
    const suppliedLock = readTaskArtifactLock(fields.artifact_lock);
    const artifactLock = createTaskArtifactLock(artifact);
    if (canonicalizeRecord(suppliedLock) !== canonicalizeRecord(artifactLock)) {
        throw new TypeError("task value artifact lock does not match its artifact");
    }
    return createCanonicalSnapshot({ artifact, artifact_lock: artifactLock }) as TaskValue;
}
