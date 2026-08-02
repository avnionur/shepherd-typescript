import { DatabaseSync } from "node:sqlite";

import { taskProtocolConfig } from "../protocol/config.ts";
import {
    decodeTaskRegistration,
    readExactTaskReference,
    registrationFromDescriptor,
} from "./registry-codec.ts";
import {
    TASK_REGISTRY_PRAGMA_SQL,
    TASK_REGISTRY_TABLES,
    TASK_REGISTRY_TRANSACTION_SQL,
} from "./registry-constants.ts";
import { TaskRegistryError, TaskVersionConflictError } from "./registry-errors.ts";
import { migrateTaskRegistry } from "./registry-migrations.ts";
import type { TaskSchema } from "./schema.ts";
import type { ExactTaskReference, TaskDescriptor, TaskRegistration } from "./types.ts";

type StoredRegistrationRow = {
    readonly artifact_digest: string;
    readonly artifact_json: string;
    readonly artifact_lock_json: string;
};

/** Synchronous SQLite-backed registry for exact immutable task artifact versions. */
export class SQLiteTaskRegistry implements Disposable {
    readonly #database: DatabaseSync;
    #closed = false;
    readonly #schemaVersion: number;

    /**
     * Opens or creates a durable task registry.
     *
     * @param databasePath - SQLite file path, or the configured in-memory default.
     * @throws {UnsupportedTaskRegistrySchemaError} If the schema is newer than supported.
     * @throws {Error} If SQLite cannot open or migrate the registry.
     */
    constructor(databasePath = taskProtocolConfig.registry.defaultDatabasePath) {
        this.#database = new DatabaseSync(databasePath, {
            defensive: taskProtocolConfig.registry.defensive,
            timeout: taskProtocolConfig.registry.busyTimeoutMilliseconds,
        });
        try {
            this.#database.exec(TASK_REGISTRY_PRAGMA_SQL.foreignKeys);
            this.#database.exec(TASK_REGISTRY_PRAGMA_SQL.journalMode);
            this.#database.exec(TASK_REGISTRY_PRAGMA_SQL.synchronous);
            this.#schemaVersion = migrateTaskRegistry(this.#database);
        } catch (error) {
            this.#database.close();
            throw error;
        }
    }

    /** Current migrated task-registry schema version. */
    get schemaVersion(): number {
        return this.#schemaVersion;
    }

    /**
     * Durably registers one exact task descriptor version.
     *
     * Equal re-registration is idempotent and returns the retained registration.
     *
     * @param descriptor - Immutable task descriptor produced by `task()`.
     * @returns The verified canonical artifact and exact artifact lock.
     * @throws {TaskVersionConflictError} If the task ID/version names different content.
     * @throws {TaskRegistryError} If the registry is closed or retained data is corrupt.
     * @throws {TypeError} If the descriptor or artifact lock is malformed.
     * @throws {Error} If SQLite cannot read or commit the registration.
     */
    register(
        descriptor: TaskDescriptor<TaskSchema<unknown>, TaskSchema<unknown>>,
    ): TaskRegistration {
        this.#assertOpen();
        const registration = registrationFromDescriptor(descriptor);
        const { artifact, artifactLock } = registration;
        this.#database.exec(TASK_REGISTRY_TRANSACTION_SQL.begin);
        try {
            const retained = this.#read(artifactLock.task_id, artifactLock.task_version);
            if (retained !== undefined) {
                if (retained.artifactLock.artifact_digest !== artifactLock.artifact_digest) {
                    throw new TaskVersionConflictError(
                        `task ${artifactLock.task_id}@${artifactLock.task_version} is already registered with different content`,
                    );
                }
                this.#database.exec(TASK_REGISTRY_TRANSACTION_SQL.commit);
                return retained;
            }
            this.#database
                .prepare(
                    `INSERT INTO ${TASK_REGISTRY_TABLES.registrations}(
                        task_id, task_version, artifact_digest, artifact_json, artifact_lock_json
                    ) VALUES (?, ?, ?, ?, ?)`,
                )
                .run(
                    artifactLock.task_id,
                    artifactLock.task_version,
                    artifactLock.artifact_digest,
                    JSON.stringify(artifact),
                    JSON.stringify(artifactLock),
                );
            this.#database.exec(TASK_REGISTRY_TRANSACTION_SQL.commit);
            return registration;
        } catch (error) {
            this.#database.exec(TASK_REGISTRY_TRANSACTION_SQL.rollback);
            throw error;
        }
    }

    /**
     * Resolves one exact task ID and version without aliases or fallback selection.
     *
     * @param reference - Exact stable task identity and caller-declared version.
     * @returns The verified registration, or `undefined` when it is absent.
     * @throws {TaskRegistryError} If the registry is closed or retained data is corrupt.
     * @throws {TypeError} If the exact reference is malformed.
     * @throws {Error} If SQLite cannot read the registration.
     */
    resolve(reference: ExactTaskReference): TaskRegistration | undefined {
        this.#assertOpen();
        const exact = readExactTaskReference(reference);
        return this.#read(exact.taskId, exact.version);
    }

    /** Closes the SQLite connection. Repeated calls are harmless. */
    close(): void {
        if (!this.#closed) {
            this.#database.close();
            this.#closed = true;
        }
    }

    /** Closes the registry when used with explicit resource management. */
    [Symbol.dispose](): void {
        this.close();
    }

    #assertOpen(): void {
        if (this.#closed) {
            throw new TaskRegistryError("task registry is closed");
        }
    }

    #read(taskId: string, version: string): TaskRegistration | undefined {
        const row = this.#database
            .prepare(
                `SELECT artifact_digest, artifact_json, artifact_lock_json
                 FROM ${TASK_REGISTRY_TABLES.registrations}
                 WHERE task_id = ? AND task_version = ?`,
            )
            .get(taskId, version) as StoredRegistrationRow | undefined;
        if (row === undefined) {
            return undefined;
        }
        const registration = decodeTaskRegistration(
            row.artifact_json,
            row.artifact_lock_json,
            row.artifact_digest,
        );
        if (
            registration.artifactLock.task_id !== taskId ||
            registration.artifactLock.task_version !== version
        ) {
            throw new TaskRegistryError(
                "stored task registration key disagrees with its artifact lock",
            );
        }
        return registration;
    }
}
