import { canonicalizeRecord } from "../canonical/canonical-record.ts";
import { createCanonicalSnapshot } from "../canonical/snapshot.ts";
import { taskProtocolConfig } from "../protocol/config.ts";
import { createTaskArtifactLock } from "./descriptor.ts";
import { TaskRegistryError } from "./registry-errors.ts";
import type { TaskSchema } from "./schema.ts";
import { assertSupportedTaskSchemaDocument } from "./schema-document.ts";
import type {
    ExactTaskReference,
    TaskArtifact,
    TaskArtifactLock,
    TaskDescriptor,
    TaskRegistration,
} from "./types.ts";
import { assertTaskSemanticRecord, assertTaskText, readTaskDataObject } from "./validation.ts";

/** Creates a verified durable value from one runtime task descriptor. @internal */
export function registrationFromDescriptor(
    descriptor: TaskDescriptor<TaskSchema<unknown>, TaskSchema<unknown>>,
): TaskRegistration {
    const artifact = readTaskArtifact(descriptor.artifact);
    const suppliedLock = readTaskArtifactLock(descriptor.artifactLock);
    const artifactLock = createTaskArtifactLock(artifact);
    if (canonicalizeRecord(suppliedLock) !== canonicalizeRecord(artifactLock)) {
        throw new TypeError("task descriptor artifact lock does not match its artifact");
    }
    return createCanonicalSnapshot({ artifact, artifactLock }) as TaskRegistration;
}

/** Decodes and verifies one stored task registration row. @internal */
export function decodeTaskRegistration(
    artifactJson: string,
    artifactLockJson: string,
    storedArtifactDigest: string,
): TaskRegistration {
    try {
        const artifact = readTaskArtifact(JSON.parse(artifactJson));
        const suppliedLock = readTaskArtifactLock(JSON.parse(artifactLockJson));
        const artifactLock = createTaskArtifactLock(artifact);
        if (
            canonicalizeRecord(suppliedLock) !== canonicalizeRecord(artifactLock) ||
            storedArtifactDigest !== artifactLock.artifact_digest
        ) {
            throw new TaskRegistryError(
                "stored task registration fails artifact-lock verification",
            );
        }
        return createCanonicalSnapshot({ artifact, artifactLock }) as TaskRegistration;
    } catch (error) {
        if (error instanceof TaskRegistryError) {
            throw error;
        }
        throw new TaskRegistryError("stored task registration is malformed", { cause: error });
    }
}

/** Validates and snapshots one exact registry reference. @internal */
export function readExactTaskReference(value: ExactTaskReference): ExactTaskReference {
    const fields = readTaskDataObject(value, ["taskId", "version"], "exact task reference");
    assertTaskText(fields.taskId, "exact task reference taskId");
    assertTaskText(fields.version, "exact task reference version");
    const digest = fields.taskId.slice(taskProtocolConfig.taskIdPrefix.length);
    if (
        !fields.taskId.startsWith(taskProtocolConfig.taskIdPrefix) ||
        digest.length !== taskProtocolConfig.hexLength ||
        !/^[0-9a-f]+$/u.test(digest)
    ) {
        throw new TypeError("exact task reference taskId is malformed");
    }
    return Object.freeze({ taskId: fields.taskId, version: fields.version });
}

function readTaskArtifact(value: unknown): TaskArtifact {
    const fields = readTaskDataObject(
        value,
        [
            "compatibility_version",
            "descriptor_version",
            "input_schema",
            "instruction",
            "name",
            "output_schema",
            "task_version",
        ],
        "task artifact",
    );
    if (
        fields.compatibility_version !== taskProtocolConfig.compatibilityVersion ||
        fields.descriptor_version !== taskProtocolConfig.descriptorVersion
    ) {
        throw new TypeError("task artifact protocol version is unsupported");
    }
    assertTaskText(fields.instruction, "task artifact instruction");
    assertTaskText(fields.name, "task artifact name");
    assertTaskText(fields.task_version, "task artifact version");
    assertTaskSemanticRecord(fields.input_schema, "task artifact input schema");
    assertTaskSemanticRecord(fields.output_schema, "task artifact output schema");
    assertSupportedTaskSchemaDocument(fields.input_schema, "task artifact input schema");
    assertSupportedTaskSchemaDocument(fields.output_schema, "task artifact output schema");
    return createCanonicalSnapshot(fields as TaskArtifact) as TaskArtifact;
}

function readTaskArtifactLock(value: unknown): TaskArtifactLock {
    const fields = readTaskDataObject(
        value,
        [
            "artifact_digest",
            "artifact_lock_version",
            "compatibility_version",
            "descriptor_version",
            "schema_digest",
            "task_id",
            "task_version",
        ],
        "task artifact lock",
    );
    for (const key of [
        "artifact_digest",
        "compatibility_version",
        "schema_digest",
        "task_id",
        "task_version",
    ] as const) {
        assertTaskText(fields[key], `task artifact lock ${key}`);
    }
    if (
        fields.artifact_lock_version !== taskProtocolConfig.artifactLockVersion ||
        fields.compatibility_version !== taskProtocolConfig.compatibilityVersion ||
        fields.descriptor_version !== taskProtocolConfig.descriptorVersion
    ) {
        throw new TypeError("task artifact lock protocol version is unsupported");
    }
    return createCanonicalSnapshot(fields as TaskArtifactLock) as TaskArtifactLock;
}
