import type { DatabaseSync } from "node:sqlite";

import { KERNEL_ABI_V0_CONTRACT } from "../protocol/compatibility-constants.ts";
import { kernelProtocolConfig } from "../protocol/config.ts";
import {
    BLOB_STORAGE_RECEIPT_VERSION,
    STORE_INDEXES,
    STORE_TABLES,
    STORE_TRANSACTION_SQL,
} from "./constants.ts";
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
            CREATE TABLE ${STORE_TABLES.records} (
                record_id TEXT PRIMARY KEY,
                digest TEXT NOT NULL CHECK (record_id = digest),
                schema_ref TEXT NOT NULL,
                mode TEXT NOT NULL,
                witness_ref TEXT NOT NULL,
                caused_by_json TEXT NOT NULL,
                body_json TEXT NOT NULL
            ) STRICT;

            CREATE TABLE ${STORE_TABLES.recordParents} (
                child_record_id TEXT NOT NULL,
                parent_record_id TEXT NOT NULL,
                parent_position INTEGER NOT NULL CHECK (parent_position >= 0),
                PRIMARY KEY (child_record_id, parent_position),
                FOREIGN KEY (child_record_id) REFERENCES ${STORE_TABLES.records}(record_id),
                FOREIGN KEY (parent_record_id) REFERENCES ${STORE_TABLES.records}(record_id)
            ) STRICT;

            CREATE INDEX ${STORE_INDEXES.parentsByParent}
                ON ${STORE_TABLES.recordParents}(parent_record_id);

            CREATE TABLE ${STORE_TABLES.appendIntents} (
                append_intent_id TEXT PRIMARY KEY,
                batch_digest TEXT NOT NULL,
                receipt_json TEXT NOT NULL
            ) STRICT;

            CREATE TABLE ${STORE_TABLES.ownerOrdinals} (
                owner_id TEXT PRIMARY KEY CHECK (owner_id <> ''),
                next_ordinal INTEGER NOT NULL CHECK (
                    next_ordinal >= ${KERNEL_ABI_V0_CONTRACT.store.migrations[0].firstOwnerOrdinal}
                    AND next_ordinal <= ${KERNEL_ABI_V0_CONTRACT.store.migrations[0].lastOwnerOrdinal + 1}
                )
            ) STRICT;

            CREATE TABLE ${STORE_TABLES.recordViews} (
                owner_id TEXT NOT NULL CHECK (owner_id <> ''),
                owner_ordinal INTEGER NOT NULL CHECK (
                    owner_ordinal >= ${KERNEL_ABI_V0_CONTRACT.store.migrations[0].firstOwnerOrdinal}
                    AND owner_ordinal <= ${KERNEL_ABI_V0_CONTRACT.store.migrations[0].lastOwnerOrdinal}
                ),
                record_id TEXT NOT NULL,
                append_intent_id TEXT NOT NULL,
                append_position INTEGER NOT NULL CHECK (append_position >= 0),
                PRIMARY KEY (owner_id, owner_ordinal),
                UNIQUE (append_intent_id, append_position),
                FOREIGN KEY (record_id) REFERENCES ${STORE_TABLES.records}(record_id),
                FOREIGN KEY (append_intent_id) REFERENCES ${STORE_TABLES.appendIntents}(append_intent_id)
            ) STRICT;

            CREATE INDEX ${STORE_INDEXES.viewsByRecord}
                ON ${STORE_TABLES.recordViews}(record_id);
        `,
    },
    {
        version: 2,
        createSql: () => `
            CREATE TABLE ${STORE_TABLES.blobs} (
                blob_id TEXT PRIMARY KEY,
                byte_length INTEGER NOT NULL CHECK (byte_length >= 0)
            ) STRICT;

            CREATE TABLE ${STORE_TABLES.storageReceipts} (
                blob_id TEXT PRIMARY KEY,
                storage_key TEXT NOT NULL UNIQUE,
                byte_length INTEGER NOT NULL CHECK (byte_length >= 0),
                receipt_version INTEGER NOT NULL CHECK (
                    receipt_version = ${BLOB_STORAGE_RECEIPT_VERSION}
                ),
                FOREIGN KEY (blob_id) REFERENCES ${STORE_TABLES.blobs}(blob_id)
            ) STRICT;
        `,
    },
    {
        version: 3,
        createSql: () => `
            CREATE TABLE ${STORE_TABLES.cuts} (
                cut_id TEXT PRIMARY KEY CHECK (cut_id <> ''),
                target_owner_id TEXT NOT NULL CHECK (target_owner_id <> ''),
                through_record_id TEXT NOT NULL,
                through_owner_ordinal INTEGER NOT NULL CHECK (
                    through_owner_ordinal >= ${KERNEL_ABI_V0_CONTRACT.store.migrations[2].firstOwnerOrdinal}
                    AND through_owner_ordinal <= ${KERNEL_ABI_V0_CONTRACT.store.migrations[2].lastOwnerOrdinal}
                ),
                publisher_owner_id TEXT NOT NULL CHECK (publisher_owner_id <> ''),
                created_by_record_id TEXT NOT NULL UNIQUE,
                append_intent_id TEXT NOT NULL UNIQUE,
                FOREIGN KEY (through_record_id) REFERENCES ${STORE_TABLES.records}(record_id),
                FOREIGN KEY (created_by_record_id) REFERENCES ${STORE_TABLES.records}(record_id),
                FOREIGN KEY (append_intent_id)
                    REFERENCES ${STORE_TABLES.appendIntents}(append_intent_id)
            ) STRICT;
        `,
    },
    {
        version: 4,
        createSql: () => `
            CREATE TABLE ${STORE_TABLES.durableExecutionClaims} (
                run_id TEXT PRIMARY KEY CHECK (run_id <> ''),
                claim_id TEXT NOT NULL CHECK (claim_id <> ''),
                created_record_id TEXT NOT NULL,
                FOREIGN KEY (created_record_id) REFERENCES ${STORE_TABLES.records}(record_id)
            ) STRICT;
        `,
    },
    {
        version: 5,
        createSql: () => `
            ALTER TABLE ${STORE_TABLES.durableExecutionClaims}
                ADD COLUMN lease_expires_at INTEGER NOT NULL DEFAULT 0;
            ALTER TABLE ${STORE_TABLES.durableExecutionClaims}
                ADD COLUMN fencing_token INTEGER NOT NULL DEFAULT 1 CHECK (fencing_token > 0);
            ALTER TABLE ${STORE_TABLES.durableExecutionClaims}
                ADD COLUMN started INTEGER NOT NULL DEFAULT 0 CHECK (started IN (0, 1));
            UPDATE ${STORE_TABLES.durableExecutionClaims} SET started = 1;
        `,
    },
    {
        version: 6,
        createSql: () => `
            CREATE TABLE ${STORE_TABLES.retainedWorldSettlements} (
                output_id TEXT PRIMARY KEY CHECK (output_id <> ''),
                command_id TEXT NOT NULL UNIQUE CHECK (command_id <> ''),
                request_id TEXT NOT NULL UNIQUE CHECK (request_id <> ''),
                request_digest TEXT NOT NULL CHECK (request_digest <> ''),
                request_json TEXT NOT NULL,
                action TEXT NOT NULL CHECK (action <> ''),
                state TEXT NOT NULL CHECK (state <> '')
            ) STRICT;
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
        CREATE TABLE IF NOT EXISTS ${STORE_TABLES.migrations} (
            version INTEGER PRIMARY KEY
        ) STRICT;
    `);
    const row = database
        .prepare(`SELECT COALESCE(MAX(version), 0) AS version FROM ${STORE_TABLES.migrations}`)
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
        database.exec(STORE_TRANSACTION_SQL.begin);
        try {
            database.exec(migration.createSql());
            database
                .prepare(`INSERT INTO ${STORE_TABLES.migrations}(version) VALUES (?)`)
                .run(migration.version);
            database.exec(STORE_TRANSACTION_SQL.commit);
        } catch (error) {
            database.exec(STORE_TRANSACTION_SQL.rollback);
            throw error;
        }
    }
    const migrated = database
        .prepare(`SELECT COALESCE(MAX(version), 0) AS version FROM ${STORE_TABLES.migrations}`)
        .get() as { readonly version: number };
    return migrated.version;
}
