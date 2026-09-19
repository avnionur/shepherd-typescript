import { DatabaseSync } from "node:sqlite";

import { storageProtocolConfig } from "../protocol/config.ts";
import { assertSQLiteDefensiveSupport } from "../runtime/sqlite.ts";
import { execRetryingBusy, runInSQLiteTransaction } from "../runtime/sqlite-transaction.ts";
import { prepareOwnerOnlyDatabaseFile } from "../store/file-mode.ts";
import {
    assertFencingToken,
    assertLeaseOwner,
    assertLeaseTiming,
    assertNonNegativeInteger,
    assertOptionalFence,
    assertRefValue,
    assertStorageName,
    DURABLE_STORAGE,
    decideAcquire,
    decideRelease,
    decideRenew,
    decideSwap,
    isFenceCurrent,
    settle,
    VOLATILE_STORAGE,
} from "./coordination.ts";
import { StorageAdapterError } from "./errors.ts";
import type {
    StorageCoordinator,
    StorageFence,
    StorageLease,
    StorageLeaseAcquireResult,
    StorageLeaseReleaseResult,
    StorageLeaseRenewResult,
    StorageRef,
    StorageRefSwapResult,
} from "./types.ts";

const coordinatorConfig = storageProtocolConfig.coordinator;

/** SQLite's reserved private in-memory database name. */
const IN_MEMORY_DATABASE = ":memory:";

/** Stable table identifiers in the versioned storage-coordinator schema. */
const TABLES = Object.freeze({
    leases: "storage_leases",
    migrations: "storage_schema_migrations",
    refs: "storage_refs",
});

const TRANSACTION_SQL = Object.freeze({
    begin: `BEGIN ${coordinatorConfig.transactionMode}`,
    commit: "COMMIT",
    rollback: "ROLLBACK",
});

const migrations = [
    {
        sql: `
            CREATE TABLE ${TABLES.refs} (
                name TEXT PRIMARY KEY CHECK (name <> ''),
                generation INTEGER NOT NULL CHECK (generation > 0),
                value TEXT NOT NULL
            ) STRICT;
            CREATE TABLE ${TABLES.leases} (
                lease_key TEXT PRIMARY KEY CHECK (lease_key <> ''),
                owner TEXT NOT NULL CHECK (owner <> ''),
                fencing_token INTEGER NOT NULL CHECK (fencing_token > 0),
                expires_at INTEGER NOT NULL CHECK (expires_at >= 0)
            ) STRICT;
        `,
        version: 1,
    },
] as const;

type LeaseRow = {
    readonly expires_at: number;
    readonly fencing_token: number;
    readonly lease_key: string;
    readonly owner: string;
};

type RefRow = {
    readonly generation: number;
    readonly name: string;
    readonly value: string;
};

/** Durable SQLite storage coordinator that can be closed explicitly or with `using`. */
export type SQLiteStorageCoordinator = StorageCoordinator &
    Disposable & {
        /** Closes the SQLite connection; later operations reject. Repeated calls are harmless. */
        close(): void;
    };

/**
 * Opens or creates a durable storage coordinator in one SQLite file.
 *
 * Every swap and lease change runs in its own configured `IMMEDIATE` transaction over a WAL
 * database with the configured busy timeout and full synchronization, so any number of handles
 * in any number of processes on one host observe one serial order. A new database file is created
 * with the configured owner-only mode and an existing one owned by the current user is tightened.
 * Concurrent first opens of one new database from several processes succeed: the switch to
 * write-ahead logging retries SQLite's deadlock-avoidance `SQLITE_BUSY` within the configured
 * busy timeout, and schema migrations read the applied version and apply inside one configured
 * `IMMEDIATE` transaction, so a later opener finds the schema current. An open that cannot get
 * the lock within the busy timeout throws before returning a handle and changes nothing. Network
 * filesystems that do not honor SQLite locking are unsupported.
 *
 * @param databasePath - SQLite file path, or `:memory:` for a private volatile database.
 * @returns A coordinator declaring `durable` durability, or `volatile` for `:memory:`.
 * @throws {StorageAdapterError} If the database schema is newer than this package supports.
 * @throws {Error} If SQLite defensive support is unavailable or the database cannot be opened.
 * @example
 * ```ts
 * using coordinator = createSQLiteStorageCoordinator("coordination.sqlite");
 * const lease = await coordinator.acquireLease("jobs/nightly", "worker-a", 30_000, Date.now());
 * ```
 */
export function createSQLiteStorageCoordinator(databasePath: string): SQLiteStorageCoordinator {
    if (typeof databasePath !== "string" || databasePath.length === 0) {
        throw new TypeError("databasePath must be a non-empty string");
    }
    assertSQLiteDefensiveSupport(coordinatorConfig.defensive);
    prepareOwnerOnlyDatabaseFile(databasePath);
    const database = new DatabaseSync(databasePath, {
        defensive: coordinatorConfig.defensive,
        timeout: coordinatorConfig.busyTimeoutMilliseconds,
    });
    try {
        database.exec(`PRAGMA foreign_keys = ${Number(coordinatorConfig.foreignKeys)}`);
        execRetryingBusy(
            database,
            `PRAGMA journal_mode = ${coordinatorConfig.journalMode}`,
            coordinatorConfig.busyTimeoutMilliseconds,
        );
        database.exec(`PRAGMA synchronous = ${coordinatorConfig.synchronous}`);
        transact(database, () => migrate(database));
    } catch (error) {
        database.close();
        throw error;
    }
    let closed = false;
    const run = <T>(operation: () => T): Promise<T> =>
        settle(() => {
            if (closed) {
                throw new StorageAdapterError("storage coordinator is closed");
            }
            return operation();
        });
    const close = (): void => {
        if (!closed) {
            closed = true;
            database.close();
        }
    };
    return Object.freeze({
        [Symbol.dispose]: close,
        acquireLease(
            key: string,
            owner: string,
            ttlMilliseconds: number,
            nowMilliseconds: number,
        ): Promise<StorageLeaseAcquireResult> {
            return run(() => {
                assertStorageName(key, "key");
                assertLeaseOwner(owner);
                assertLeaseTiming(ttlMilliseconds, nowMilliseconds);
                return transact(database, () => {
                    const decision = decideAcquire(
                        readLeaseRow(database, key),
                        key,
                        owner,
                        ttlMilliseconds,
                        nowMilliseconds,
                    );
                    writeLease(database, decision.next);
                    return decision.result;
                });
            });
        },
        close,
        compareAndSwapRef(
            name: string,
            expectedGeneration: number,
            value: string,
            fence?: StorageFence,
        ): Promise<StorageRefSwapResult> {
            return run(() => {
                assertStorageName(name, "name");
                assertNonNegativeInteger(expectedGeneration, "expectedGeneration");
                assertRefValue(value);
                assertOptionalFence(fence);
                return transact(database, () => {
                    const fenced =
                        fence !== undefined &&
                        !isFenceCurrent(readLeaseRow(database, fence.key), fence);
                    const decision = decideSwap(
                        readRefRow(database, name),
                        name,
                        expectedGeneration,
                        value,
                        fenced,
                    );
                    if (decision.next !== undefined) {
                        database
                            .prepare(
                                `INSERT INTO ${TABLES.refs}(name, generation, value) VALUES (?, ?, ?)
                                 ON CONFLICT(name) DO UPDATE SET generation = excluded.generation, value = excluded.value`,
                            )
                            .run(decision.next.name, decision.next.generation, decision.next.value);
                    }
                    return decision.result;
                });
            });
        },
        durability: databasePath === IN_MEMORY_DATABASE ? VOLATILE_STORAGE : DURABLE_STORAGE,
        readLease(key: string): Promise<StorageLease | undefined> {
            return run(() => {
                assertStorageName(key, "key");
                return readLeaseRow(database, key);
            });
        },
        readRef(name: string): Promise<StorageRef | undefined> {
            return run(() => {
                assertStorageName(name, "name");
                return readRefRow(database, name);
            });
        },
        releaseLease(
            key: string,
            owner: string,
            fencingToken: number,
        ): Promise<StorageLeaseReleaseResult> {
            return run(() => {
                assertStorageName(key, "key");
                assertLeaseOwner(owner);
                assertFencingToken(fencingToken);
                return transact(database, () => {
                    const decision = decideRelease(
                        readLeaseRow(database, key),
                        owner,
                        fencingToken,
                    );
                    writeLease(database, decision.next);
                    return decision.result;
                });
            });
        },
        renewLease(
            key: string,
            owner: string,
            fencingToken: number,
            ttlMilliseconds: number,
            nowMilliseconds: number,
        ): Promise<StorageLeaseRenewResult> {
            return run(() => {
                assertStorageName(key, "key");
                assertLeaseOwner(owner);
                assertFencingToken(fencingToken);
                assertLeaseTiming(ttlMilliseconds, nowMilliseconds);
                return transact(database, () => {
                    const decision = decideRenew(
                        readLeaseRow(database, key),
                        owner,
                        fencingToken,
                        ttlMilliseconds,
                        nowMilliseconds,
                    );
                    writeLease(database, decision.next);
                    return decision.result;
                });
            });
        },
    });
}

function transact<T>(database: DatabaseSync, operation: () => T): T {
    return runInSQLiteTransaction(database, TRANSACTION_SQL, operation);
}

/**
 * Verifies that implemented coordinator migrations match the configured versions.
 *
 * @throws {StorageAdapterError} If the lists differ.
 * @internal
 */
export function assertStorageCoordinatorMigrations(
    implemented: readonly number[],
    configured: readonly number[],
): void {
    if (
        implemented.length !== configured.length ||
        implemented.some((version, index) => version !== configured[index])
    ) {
        throw new StorageAdapterError(
            "configured storage-coordinator migrations do not match the implementation",
        );
    }
}

function migrate(database: DatabaseSync): void {
    assertStorageCoordinatorMigrations(
        migrations.map(({ version }) => version),
        coordinatorConfig.migrations,
    );
    database.exec(
        `CREATE TABLE IF NOT EXISTS ${TABLES.migrations} (version INTEGER PRIMARY KEY) STRICT`,
    );
    const { version: current } = database
        .prepare(`SELECT COALESCE(MAX(version), 0) AS version FROM ${TABLES.migrations}`)
        .get() as { readonly version: number };
    if (current > coordinatorConfig.schemaVersion) {
        throw new StorageAdapterError(
            `storage coordinator schema ${current} is newer than supported schema ${coordinatorConfig.schemaVersion}`,
        );
    }
    for (const migration of migrations) {
        if (migration.version > current) {
            database.exec(migration.sql);
            database
                .prepare(`INSERT INTO ${TABLES.migrations}(version) VALUES (?)`)
                .run(migration.version);
        }
    }
}

function readRefRow(database: DatabaseSync, name: string): StorageRef | undefined {
    const row = database
        .prepare(`SELECT name, generation, value FROM ${TABLES.refs} WHERE name = ?`)
        .get(name) as RefRow | undefined;
    return row === undefined
        ? undefined
        : Object.freeze({ generation: row.generation, name: row.name, value: row.value });
}

function readLeaseRow(database: DatabaseSync, key: string): StorageLease | undefined {
    const row = database
        .prepare(
            `SELECT lease_key, owner, fencing_token, expires_at FROM ${TABLES.leases} WHERE lease_key = ?`,
        )
        .get(key) as LeaseRow | undefined;
    return row === undefined
        ? undefined
        : Object.freeze({
              expiresAt: row.expires_at,
              fencingToken: row.fencing_token,
              key: row.lease_key,
              owner: row.owner,
          });
}

function writeLease(database: DatabaseSync, lease: StorageLease | undefined): void {
    if (lease === undefined) {
        return;
    }
    database
        .prepare(
            `INSERT INTO ${TABLES.leases}(lease_key, owner, fencing_token, expires_at) VALUES (?, ?, ?, ?)
             ON CONFLICT(lease_key) DO UPDATE SET owner = excluded.owner, fencing_token = excluded.fencing_token, expires_at = excluded.expires_at`,
        )
        .run(lease.key, lease.owner, lease.fencingToken, lease.expiresAt);
}
