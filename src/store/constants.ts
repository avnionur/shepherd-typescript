import { KERNEL_ABI_V0_CONTRACT } from "../protocol/compatibility-constants.ts";
import { kernelProtocolConfig } from "../protocol/config.ts";

/** Default SQLite target for an ephemeral trace store. */
export const DEFAULT_STORE_DATABASE_PATH = ":memory:";

/** Stable table identifiers in the versioned trace-store schema. */
export const STORE_TABLES = Object.freeze({
    appendIntents: "append_intents",
    blobs: "blobs",
    cuts: "trace_cuts",
    durableExecutionClaims: "durable_execution_claims",
    migrations: "schema_migrations",
    ownerOrdinals: "owner_ordinals",
    orphanOperations: "orphan_operations",
    orphanOperationRepairs: "orphan_operation_repairs",
    recordParents: "record_parents",
    recordViews: "record_views",
    records: "records",
    retainedWorldSettlements: "retained_world_settlements",
    scopeRegistrations: "scope_registrations",
    scopeWriterClaims: "scope_writer_claims",
    storageReceipts: "storage_receipts",
    supervisedDispatches: "supervised_dispatches",
    traceSubscriptions: "trace_subscriptions",
});

/** Version of filesystem blob receipts stored by schema migration two. */
export const BLOB_STORAGE_RECEIPT_VERSION = KERNEL_ABI_V0_CONTRACT.store.blobs.receiptVersion;

/** Stable index identifiers in the versioned trace-store schema. */
export const STORE_INDEXES = Object.freeze({
    parentsByParent: "record_parents_by_parent",
    viewsByRecord: "record_views_by_record",
});

/** Transaction commands derived from validated store configuration. */
export const STORE_TRANSACTION_SQL = Object.freeze({
    begin: `BEGIN ${kernelProtocolConfig.store.transactionMode}`,
    commit: "COMMIT",
    rollback: "ROLLBACK",
});

/** Read-snapshot transaction commands for a coherent whole-store diagnostic scan. */
export const STORE_READ_TRANSACTION_SQL = Object.freeze({
    begin: "BEGIN",
    commit: "COMMIT",
    rollback: "ROLLBACK",
});

/** SQLite PRAGMA commands derived from validated store configuration. */
export const STORE_PRAGMA_SQL = Object.freeze({
    foreignKeys: `PRAGMA foreign_keys = ${Number(kernelProtocolConfig.store.foreignKeys)}`,
    journalMode: `PRAGMA journal_mode = ${kernelProtocolConfig.store.journalMode}`,
    synchronous: `PRAGMA synchronous = ${kernelProtocolConfig.store.synchronous}`,
});
