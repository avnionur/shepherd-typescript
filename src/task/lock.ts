import { createHash } from "node:crypto";

import { canonicalizeRecord, type SemanticRecord } from "../canonical/canonical-record.ts";
import { createCanonicalSnapshot } from "../canonical/snapshot.ts";
import { taskProtocolConfig } from "../protocol/config.ts";
import type { TaskArtifact, TaskArtifactLock } from "./types.ts";

/** Derives the exact configured lock for a validated canonical task artifact. @internal */
export function createTaskArtifactLock(artifact: TaskArtifact): TaskArtifactLock {
    return createCanonicalSnapshot({
        artifact_digest: digest(artifact),
        artifact_lock_version: taskProtocolConfig.artifactLockVersion,
        compatibility_version: taskProtocolConfig.compatibilityVersion,
        descriptor_version: taskProtocolConfig.descriptorVersion,
        schema_digest: digest({
            input_schema: artifact.input_schema,
            output_schema: artifact.output_schema,
        }),
        task_id: `${taskProtocolConfig.taskIdPrefix}${digestHex({ name: artifact.name })}`,
        task_version: artifact.task_version,
    }) as TaskArtifactLock;
}

function digest(value: SemanticRecord): string {
    return `${taskProtocolConfig.digestPrefix}${digestHex(value)}`;
}

function digestHex(value: SemanticRecord): string {
    return createHash(taskProtocolConfig.digestAlgorithm)
        .update(canonicalizeRecord(value), "utf8")
        .digest("hex");
}
