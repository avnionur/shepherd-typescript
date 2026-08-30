import { publicErrorCodes } from "../errors/public-errors.ts";

/** Base error for durable task-registry contract violations. */
export class TaskRegistryError extends Error {
    /** Stable configured machine-readable task-registry error code. */
    readonly code = publicErrorCodes.tasks.registry;
}

/** Raised when one logical task ID/version is registered with different content. */
export class TaskVersionConflictError extends TaskRegistryError {
    /** Stable configured machine-readable task-version conflict code. */
    override readonly code = publicErrorCodes.tasks.versionConflict;
}

/** Raised when a task-registry database is newer than this package supports. */
export class UnsupportedTaskRegistrySchemaError extends TaskRegistryError {
    /** Stable configured machine-readable unsupported-schema code. */
    override readonly code = publicErrorCodes.tasks.schemaUnsupported;
}
