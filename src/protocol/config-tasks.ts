import type { NonEmptyReadonlyArray, ProtocolConfig } from "./config-types.ts";
import {
    SECURE_HASH_ALGORITHMS,
    STORE_JOURNAL_MODES,
    STORE_SYNCHRONOUS_LEVELS,
    STORE_TRANSACTION_MODES,
} from "./config-types.ts";
import {
    readAbsoluteUrl,
    readArray,
    readEnum,
    readNonEmptyString,
    readNonNegativeInteger,
    readObject,
    readPositiveInteger,
    readRequiredTrue,
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
            "registry",
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
    const registry = readObject(
        task.registry,
        [
            "busyTimeoutMilliseconds",
            "defaultDatabasePath",
            "defensive",
            "foreignKeys",
            "journalMode",
            "migrations",
            "schemaVersion",
            "synchronous",
            "transactionMode",
        ],
        "tasks.registry",
    );
    const migrations = readRegistryMigrations(registry.migrations);
    const schemaVersion = readPositiveInteger(
        registry.schemaVersion,
        "tasks.registry.schemaVersion",
    );
    if (migrations.at(-1) !== schemaVersion) {
        throw new TypeError("tasks.registry.schemaVersion must match the latest migration");
    }
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
        registry: {
            busyTimeoutMilliseconds: readNonNegativeInteger(
                registry.busyTimeoutMilliseconds,
                "tasks.registry.busyTimeoutMilliseconds",
            ),
            defaultDatabasePath: readNonEmptyString(
                registry.defaultDatabasePath,
                "tasks.registry.defaultDatabasePath",
            ),
            defensive: readRequiredTrue(registry.defensive, "tasks.registry.defensive"),
            foreignKeys: readRequiredTrue(registry.foreignKeys, "tasks.registry.foreignKeys"),
            journalMode: readEnum(
                registry.journalMode,
                STORE_JOURNAL_MODES,
                "tasks.registry.journalMode",
            ),
            migrations,
            schemaVersion,
            synchronous: readEnum(
                registry.synchronous,
                STORE_SYNCHRONOUS_LEVELS,
                "tasks.registry.synchronous",
            ),
            transactionMode: readEnum(
                registry.transactionMode,
                STORE_TRANSACTION_MODES,
                "tasks.registry.transactionMode",
            ),
        },
        schemas: {
            artifactLockId: readAbsoluteUrl(schemas.artifactLockId, "tasks.schemas.artifactLockId"),
            descriptorId: readAbsoluteUrl(schemas.descriptorId, "tasks.schemas.descriptorId"),
        },
        taskIdPrefix: readNonEmptyString(task.taskIdPrefix, "tasks.taskIdPrefix"),
    };
}

function readRegistryMigrations(value: unknown): NonEmptyReadonlyArray<number> {
    const migrations = readArray(value, "tasks.registry.migrations").map((version, index) => {
        const parsed = readPositiveInteger(version, `tasks.registry.migrations[${index}]`);
        if (parsed !== index + 1) {
            throw new TypeError("tasks.registry.migrations must be contiguous from version 1");
        }
        return parsed;
    });
    const [first, ...remaining] = migrations;
    if (first === undefined) {
        throw new TypeError("tasks.registry.migrations must not be empty");
    }
    return [first, ...remaining];
}
