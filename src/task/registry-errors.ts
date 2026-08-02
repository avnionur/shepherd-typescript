/** Base error for durable task-registry contract violations. */
export class TaskRegistryError extends Error {}

/** Raised when one logical task ID/version is registered with different content. */
export class TaskVersionConflictError extends TaskRegistryError {}

/** Raised when a task-registry database is newer than this package supports. */
export class UnsupportedTaskRegistrySchemaError extends TaskRegistryError {}
