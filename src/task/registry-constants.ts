import { taskProtocolConfig } from "../protocol/config.ts";

/** Stable table identifiers in the versioned task-registry schema. */
export const TASK_REGISTRY_TABLES = Object.freeze({
    migrations: "task_schema_migrations",
    registrations: "task_registrations",
});

/** Transaction commands derived from validated registry configuration. */
export const TASK_REGISTRY_TRANSACTION_SQL = Object.freeze({
    begin: `BEGIN ${taskProtocolConfig.registry.transactionMode}`,
    commit: "COMMIT",
    rollback: "ROLLBACK",
});

/** SQLite PRAGMA commands derived from validated registry configuration. */
export const TASK_REGISTRY_PRAGMA_SQL = Object.freeze({
    foreignKeys: `PRAGMA foreign_keys = ${Number(taskProtocolConfig.registry.foreignKeys)}`,
    journalMode: `PRAGMA journal_mode = ${taskProtocolConfig.registry.journalMode}`,
    synchronous: `PRAGMA synchronous = ${taskProtocolConfig.registry.synchronous}`,
});
