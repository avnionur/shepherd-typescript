import type { DatabaseSync } from "node:sqlite";

import { taskProtocolConfig } from "../protocol/config.ts";
import { runInSQLiteTransaction } from "../runtime/sqlite-transaction.ts";
import { TASK_REGISTRY_TABLES, TASK_REGISTRY_TRANSACTION_SQL } from "./registry-constants.ts";
import { UnsupportedTaskRegistrySchemaError } from "./registry-errors.ts";

const migrations = [
    {
        version: 1,
        sql: `
            CREATE TABLE ${TASK_REGISTRY_TABLES.registrations} (
                task_id TEXT NOT NULL CHECK (task_id <> ''),
                task_version TEXT NOT NULL CHECK (task_version <> ''),
                artifact_digest TEXT NOT NULL CHECK (artifact_digest <> ''),
                artifact_json TEXT NOT NULL,
                artifact_lock_json TEXT NOT NULL,
                PRIMARY KEY (task_id, task_version)
            ) STRICT;
        `,
    },
] as const;

/**
 * Applies every configured task-registry migration atomically.
 *
 * Every step reads the applied schema version inside the configured `IMMEDIATE` transaction that
 * applies the next migration, so concurrent first opens serialize on SQLite's write lock and a
 * later opener that finds the schema current commits nothing.
 *
 * @internal
 */
export function migrateTaskRegistry(database: DatabaseSync): number {
    const versions = migrations.map(({ version }) => version);
    validateTaskRegistryMigrationVersions(
        versions,
        taskProtocolConfig.registry.schemaVersion,
        taskProtocolConfig.registry.migrations,
    );
    runInSQLiteTransaction(database, TASK_REGISTRY_TRANSACTION_SQL, () =>
        database.exec(`
            CREATE TABLE IF NOT EXISTS ${TASK_REGISTRY_TABLES.migrations} (
                version INTEGER PRIMARY KEY
            ) STRICT;
        `),
    );
    for (;;) {
        const applied = runInSQLiteTransaction(database, TASK_REGISTRY_TRANSACTION_SQL, () =>
            applyNextTaskRegistryMigration(database),
        );
        if (!applied) {
            return taskProtocolConfig.registry.schemaVersion;
        }
    }
}

/** Applies the next pending migration under the caller's write lock; false when none is pending. */
function applyNextTaskRegistryMigration(database: DatabaseSync): boolean {
    const current = database
        .prepare(
            `SELECT COALESCE(MAX(version), 0) AS version FROM ${TASK_REGISTRY_TABLES.migrations}`,
        )
        .get() as { readonly version: number };
    if (current.version > taskProtocolConfig.registry.schemaVersion) {
        throw new UnsupportedTaskRegistrySchemaError(
            `task registry schema ${current.version} is newer than supported schema ${taskProtocolConfig.registry.schemaVersion}`,
        );
    }
    const migration = migrations.find(({ version }) => version > current.version);
    if (migration === undefined) {
        return false;
    }
    database.exec(migration.sql);
    database
        .prepare(`INSERT INTO ${TASK_REGISTRY_TABLES.migrations}(version) VALUES (?)`)
        .run(migration.version);
    return true;
}

/** Reads and requires the exact current task-registry schema without mutation. @internal */
export function readCurrentTaskRegistrySchemaVersion(database: DatabaseSync): number {
    let version: number;
    try {
        const row = database
            .prepare(
                `SELECT COALESCE(MAX(version), 0) AS version FROM ${TASK_REGISTRY_TABLES.migrations}`,
            )
            .get() as { readonly version: number };
        version = row.version;
    } catch (error) {
        throw new UnsupportedTaskRegistrySchemaError("task registry is not initialized", {
            cause: error,
        });
    }
    if (version !== taskProtocolConfig.registry.schemaVersion) {
        throw new UnsupportedTaskRegistrySchemaError(
            `read-only task registry requires schema ${taskProtocolConfig.registry.schemaVersion}; found ${version}`,
        );
    }
    return version;
}

/** Verifies that implemented task-registry migrations match configured support. @internal */
export function validateTaskRegistryMigrationVersions(
    versions: readonly number[],
    supportedVersion: number,
    configuredVersions: readonly number[],
): void {
    if (
        versions.length !== supportedVersion ||
        configuredVersions.length !== versions.length ||
        versions.some(
            (version, index) => version !== index + 1 || version !== configuredVersions[index],
        )
    ) {
        throw new UnsupportedTaskRegistrySchemaError(
            "configured task-registry migrations do not match the implementation",
        );
    }
}
