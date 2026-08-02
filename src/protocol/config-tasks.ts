import type { ProtocolConfig } from "./config-types.ts";
import { SECURE_HASH_ALGORITHMS } from "./config-types.ts";
import {
    readAbsoluteUrl,
    readEnum,
    readNonEmptyString,
    readObject,
    readPositiveInteger,
} from "./config-value-readers.ts";

/** Validates the configured task descriptor, identity, schema, and artifact contract. */
export function readTaskConfig(value: unknown): ProtocolConfig["tasks"] {
    const task = readObject(
        value,
        [
            "artifactLockVersion",
            "artifacts",
            "compatibilityVersion",
            "descriptorVersion",
            "digestAlgorithm",
            "digestPrefix",
            "hexLength",
            "schemas",
            "taskIdPrefix",
        ],
        "tasks",
    );
    const artifacts = readObject(
        task.artifacts,
        ["artifactLockSchema", "descriptorSchema"],
        "tasks.artifacts",
    );
    const schemas = readObject(task.schemas, ["artifactLockId", "descriptorId"], "tasks.schemas");
    return {
        artifactLockVersion: readPositiveInteger(
            task.artifactLockVersion,
            "tasks.artifactLockVersion",
        ),
        artifacts: {
            artifactLockSchema: readNonEmptyString(
                artifacts.artifactLockSchema,
                "tasks.artifacts.artifactLockSchema",
            ),
            descriptorSchema: readNonEmptyString(
                artifacts.descriptorSchema,
                "tasks.artifacts.descriptorSchema",
            ),
        },
        compatibilityVersion: readNonEmptyString(
            task.compatibilityVersion,
            "tasks.compatibilityVersion",
        ),
        descriptorVersion: readPositiveInteger(task.descriptorVersion, "tasks.descriptorVersion"),
        digestAlgorithm: readEnum(
            task.digestAlgorithm,
            SECURE_HASH_ALGORITHMS,
            "tasks.digestAlgorithm",
        ),
        digestPrefix: readNonEmptyString(task.digestPrefix, "tasks.digestPrefix"),
        hexLength: readPositiveInteger(task.hexLength, "tasks.hexLength"),
        schemas: {
            artifactLockId: readAbsoluteUrl(schemas.artifactLockId, "tasks.schemas.artifactLockId"),
            descriptorId: readAbsoluteUrl(schemas.descriptorId, "tasks.schemas.descriptorId"),
        },
        taskIdPrefix: readNonEmptyString(task.taskIdPrefix, "tasks.taskIdPrefix"),
    };
}
