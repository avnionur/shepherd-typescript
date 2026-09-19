import { cpSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
    claimScopeWriter,
    ORPHAN_REPAIR_VERSIONS,
    openTraceSubscription,
    RETAINED_WORLD_SETTLEMENT_VERSION,
    ROOT_WITNESS_ID,
    registerRootScope,
    type ScopeResourceGrant,
    SQLiteTraceStore,
} from "../../src/index.ts";
import { kernelProtocolConfig, projectionProtocolConfig } from "../../src/protocol/config.ts";
import { STORE_TABLES } from "../../src/store/constants.ts";
import { migrateTraceStore } from "../../src/store/migrations.ts";

/** One historical-schema trace store built for a migration drill. */
export type StoreSchemaFixture = {
    /** Database file left at exactly `schemaVersion`. */
    readonly databasePath: string;
    /** Historical schema version the database was built at. */
    readonly schemaVersion: number;
    /** Number of rows copied into each table that existed at that schema. */
    readonly tableRows: Readonly<Record<string, number>>;
};

/** Store feature first introduced by a schema migration, keyed by that migration's version. */
const FEATURE_VERSIONS = Object.freeze({
    blobs: 2,
    cuts: 3,
    durableClaims: 4,
    orphanOperations: 8,
    retainedSettlements: 6,
    scopes: 9,
    subscriptions: 10,
});

const RUN_OWNER = "run:migration-drill";
const EXECUTION_CREATED_SCHEMA = projectionProtocolConfig.executionHistory.executionSchemas.created;
const SCOPE_CEILING: readonly ScopeResourceGrant[] = [
    { atoms: ["read"], resource_id: "resource:docs", resource_kind: "repository_binding" },
];

/**
 * Builds one trace store at exactly `schemaVersion` by applying the store migrations up to that
 * version and inserting rows that are valid at it.
 *
 * Rows are produced by the current store API against a scratch store that only exercises
 * features whose tables exist at `schemaVersion`, then copied column-by-column into the
 * historical database, so every copied row has exactly the columns that schema defines. Blob
 * bytes are copied into the fixture's blob directory. No historical package release exists, so
 * fixtures are synthesized from the migration steps, not produced by older package versions.
 *
 * @param directory - Existing empty scratch directory owned by the caller.
 * @param schemaVersion - Historical store schema, from `1` through the configured schema.
 * @returns The fixture database path and copied row counts.
 */
export function buildStoreSchemaFixture(
    directory: string,
    schemaVersion: number,
): StoreSchemaFixture {
    const sourceDirectory = path.join(directory, "source");
    mkdirSync(sourceDirectory);
    const sourcePath = path.join(sourceDirectory, "trace.sqlite");
    const source = new SQLiteTraceStore(sourcePath);
    try {
        populateStoreForSchema(source, schemaVersion);
    } finally {
        source.close();
    }
    const databasePath = path.join(directory, `schema-${schemaVersion}.sqlite`);
    // Rows are copied table by table; the upgraded store's integrity scan checks foreign keys.
    const database = new DatabaseSync(databasePath, { enableForeignKeyConstraints: false });
    const tableRows: Record<string, number> = {};
    try {
        migrateTraceStore(database, schemaVersion);
        database.prepare("ATTACH DATABASE ? AS source").run(sourcePath);
        const tables = database
            .prepare(
                `SELECT name FROM main.sqlite_master WHERE type = 'table' AND name <> ? ORDER BY name`,
            )
            .all(STORE_TABLES.migrations)
            .map((row) => String(row.name));
        for (const table of tables) {
            const columns = database
                .prepare(`SELECT name FROM pragma_table_info(?, 'main')`)
                .all(table)
                .map((row) => `"${String(row.name)}"`)
                .join(", ");
            database.exec(
                `INSERT INTO main."${table}" (${columns}) SELECT ${columns} FROM source."${table}"`,
            );
            tableRows[table] = Number(
                database.prepare(`SELECT COUNT(*) AS count FROM main."${table}"`).get()?.count,
            );
        }
        database.exec("DETACH DATABASE source");
    } finally {
        database.close();
    }
    const suffix = kernelProtocolConfig.store.blobs.directorySuffix;
    cpSync(`${sourcePath}${suffix}`, `${databasePath}${suffix}`, { recursive: true });
    return Object.freeze({ databasePath, schemaVersion, tableRows: Object.freeze(tableRows) });
}

/**
 * Exercises, in `store`, every deterministic store feature whose tables exist at `schemaVersion`.
 *
 * @param store - Writable current-schema scratch store.
 * @param schemaVersion - Historical schema whose features may be used.
 */
export function populateStoreForSchema(store: SQLiteTraceStore, schemaVersion: number): void {
    const created = store.append({
        append_intent_id: "migration-drill:created",
        batch: {
            groups: [
                {
                    owner_id: RUN_OWNER,
                    records: [
                        {
                            body: { phase: "created" },
                            mode: "declaration",
                            schema_ref: EXECUTION_CREATED_SCHEMA,
                            witness_ref: ROOT_WITNESS_ID,
                        },
                    ],
                },
                {
                    owner_id: "task:migration-drill",
                    records: [
                        {
                            body: { phase: "observed", values: [1, 2, 3] },
                            mode: "capture",
                            schema_ref: "example.migration-drill.v1",
                            witness_ref: ROOT_WITNESS_ID,
                        },
                    ],
                },
            ],
        },
    });
    const createdRecordId = created.record_ids[0] as string;
    const followUp = store.append({
        append_intent_id: "migration-drill:follow-up",
        batch: {
            groups: [
                {
                    owner_id: RUN_OWNER,
                    records: [
                        {
                            body: { phase: "follow-up" },
                            caused_by_record_ids: [createdRecordId],
                            mode: "capture",
                            schema_ref: "example.migration-drill.v1",
                            witness_ref: ROOT_WITNESS_ID,
                        },
                    ],
                },
            ],
        },
    });
    if (schemaVersion >= FEATURE_VERSIONS.blobs) {
        store.putBlob(new TextEncoder().encode("migration drill blob"));
    }
    if (schemaVersion >= FEATURE_VERSIONS.cuts) {
        store.publishCut({
            append_intent_id: "migration-drill:cut",
            cut_id: "cut:migration-drill",
            target_owner_id: RUN_OWNER,
            through_record_id: followUp.record_ids[0] as string,
        });
    }
    if (schemaVersion >= FEATURE_VERSIONS.durableClaims) {
        store.claimDurableExecutionInvocation(
            RUN_OWNER,
            createdRecordId,
            "claim:migration-drill",
            0,
        );
    }
    if (schemaVersion >= FEATURE_VERSIONS.retainedSettlements) {
        store.admitRetainedWorldSettlement({
            action: "select",
            base_revision_id: "world-revision:base",
            binding_id: "workspace-binding:drill",
            capture_record_id: createdRecordId,
            changeset_id: "world-changeset:drill",
            command_id: "settlement-command:drill",
            custody_id: "world-custody:drill",
            execution_cut_id: "cut:migration-drill",
            head_revision_id: "world-revision:head",
            output_id: "world-output:drill",
            run_id: RUN_OWNER,
            settlement_version: RETAINED_WORLD_SETTLEMENT_VERSION,
            user_basis_before: "world-revision:base",
        });
    }
    if (schemaVersion >= FEATURE_VERSIONS.orphanOperations) {
        store.recordOpenOperation({
            cause_record_id: null,
            operation_id: "operation:migration-drill",
            operation_version: ORPHAN_REPAIR_VERSIONS.operation,
            owner_id: RUN_OWNER,
            provider_call_started: false,
            retained_cause: "migration drill fixture",
            scope_id: null,
            scope_owned: false,
            session_id: "session:migration-drill",
        });
    }
    if (schemaVersion >= FEATURE_VERSIONS.scopes) {
        const root = registerRootScope(store, {
            authority: { ceiling: SCOPE_CEILING, grant: SCOPE_CEILING },
            commandId: "scope-command:migration-drill",
        });
        claimScopeWriter(store, {
            claimId: "claim:migration-drill-scope",
            nowMilliseconds: 1_000,
            scopeId: root.scope_id,
        });
    }
    if (schemaVersion >= FEATURE_VERSIONS.subscriptions) {
        openTraceSubscription(store, {
            owners: [RUN_OWNER],
            subscriptionId: "subscription:migration-drill",
        }).close();
    }
}
