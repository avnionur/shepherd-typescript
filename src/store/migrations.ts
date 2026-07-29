import type { DatabaseSync } from "node:sqlite";

import { kernelProtocolConfig } from "../protocol/config.ts";
import { UnsupportedStoreSchemaError } from "./errors.ts";

type Migration = {
    readonly createSql: () => string;
    readonly version: number;
};

type ConfiguredMigration = {
    readonly firstOwnerOrdinal: number;
    readonly lastOwnerOrdinal: number;
    readonly version: number;
};

const migrations: readonly Migration[] = [
    {
        version: 1,
        createSql: () => `
            CREATE TABLE records (
                record_id TEXT PRIMARY KEY,
                digest TEXT NOT NULL CHECK (record_id = digest),
                schema_ref TEXT NOT NULL,
                mode TEXT NOT NULL,
                witness_ref TEXT NOT NULL,
                caused_by_json TEXT NOT NULL,
                body_json TEXT NOT NULL
            ) STRICT;

            CREATE TABLE record_parents (
                child_record_id TEXT NOT NULL,
                parent_record_id TEXT NOT NULL,
                parent_position INTEGER NOT NULL CHECK (parent_position >= 0),
                PRIMARY KEY (child_record_id, parent_position),
                FOREIGN KEY (child_record_id) REFERENCES records(record_id),
                FOREIGN KEY (parent_record_id) REFERENCES records(record_id)
            ) STRICT;

            CREATE INDEX record_parents_by_parent
                ON record_parents(parent_record_id);

            CREATE TABLE append_intents (
                append_intent_id TEXT PRIMARY KEY,
                batch_digest TEXT NOT NULL,
                receipt_json TEXT NOT NULL
            ) STRICT;

            CREATE TABLE owner_ordinals (
                owner_id TEXT PRIMARY KEY CHECK (owner_id <> ''),
                next_ordinal INTEGER NOT NULL CHECK (
                    next_ordinal >= ${kernelProtocolConfig.store.migrations[0].firstOwnerOrdinal}
                    AND next_ordinal <= ${kernelProtocolConfig.store.migrations[0].lastOwnerOrdinal + 1}
                )
            ) STRICT;

            CREATE TABLE record_views (
                owner_id TEXT NOT NULL CHECK (owner_id <> ''),
                owner_ordinal INTEGER NOT NULL CHECK (
                    owner_ordinal >= ${kernelProtocolConfig.store.migrations[0].firstOwnerOrdinal}
                    AND owner_ordinal <= ${kernelProtocolConfig.store.migrations[0].lastOwnerOrdinal}
                ),
                record_id TEXT NOT NULL,
                append_intent_id TEXT NOT NULL,
                append_position INTEGER NOT NULL CHECK (append_position >= 0),
                PRIMARY KEY (owner_id, owner_ordinal),
                UNIQUE (append_intent_id, append_position),
                FOREIGN KEY (record_id) REFERENCES records(record_id),
                FOREIGN KEY (append_intent_id) REFERENCES append_intents(append_intent_id)
            ) STRICT;

            CREATE INDEX record_views_by_record
                ON record_views(record_id);
        `,
    },
];

/**
 * Verifies that migration versions are contiguous and match configured support.
 *
 * @internal
 */
export function validateMigrationRegistry(
    versions: readonly number[],
    supportedVersion: number,
    configuredMigrations: readonly ConfiguredMigration[] = kernelProtocolConfig.store.migrations,
): void {
    for (const [index, version] of versions.entries()) {
        if (version !== index + 1) {
            throw new UnsupportedStoreSchemaError(
                `store migration registry must be contiguous from version 1; found ${version} at position ${index}`,
            );
        }
    }
    if (versions.length !== supportedVersion) {
        throw new UnsupportedStoreSchemaError(
            `implemented store schema ${versions.length} does not match configured schema ${supportedVersion}`,
        );
    }
    if (
        configuredMigrations.length !== versions.length ||
        configuredMigrations.some(({ version }, index) => version !== versions[index])
    ) {
        throw new UnsupportedStoreSchemaError(
            "configured store migrations do not match the implemented migration registry",
        );
    }
    const latest = configuredMigrations[configuredMigrations.length - 1];
    if (
        latest === undefined ||
        latest.firstOwnerOrdinal !== kernelProtocolConfig.append.firstOwnerOrdinal ||
        latest.lastOwnerOrdinal !== kernelProtocolConfig.append.lastOwnerOrdinal
    ) {
        throw new UnsupportedStoreSchemaError(
            "configured append ordinal bounds require a new store migration",
        );
    }
}

/** Applies every pending trace-store migration atomically. */
export function migrateTraceStore(database: DatabaseSync): number {
    validateMigrationRegistry(
        migrations.map(({ version }) => version),
        kernelProtocolConfig.store.schemaVersion,
    );
    database.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY
        ) STRICT;
    `);
    const row = database
        .prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations")
        .get() as { readonly version: number };
    const currentVersion = row.version;
    if (currentVersion > kernelProtocolConfig.store.schemaVersion) {
        throw new UnsupportedStoreSchemaError(
            `store schema ${currentVersion} is newer than supported schema ${kernelProtocolConfig.store.schemaVersion}`,
        );
    }

    for (const migration of migrations) {
        if (migration.version <= currentVersion) {
            continue;
        }
        database.exec("BEGIN IMMEDIATE");
        try {
            database.exec(migration.createSql());
            database
                .prepare("INSERT INTO schema_migrations(version) VALUES (?)")
                .run(migration.version);
            database.exec("COMMIT");
        } catch (error) {
            database.exec("ROLLBACK");
            throw error;
        }
    }
    const migrated = database
        .prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations")
        .get() as { readonly version: number };
    return migrated.version;
}
