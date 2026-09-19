import type { DatabaseSync } from "node:sqlite";

/**
 * SQLite primary result code `SQLITE_BUSY` and the mask that strips extended-code bits from an
 * error's `errcode`. Both are fixed by the SQLite C ABI, not by Shepherd configuration.
 */
const SQLITE_BUSY = 5;
const SQLITE_PRIMARY_RESULT_CODE_MASK = 0xff;

/** Configured begin, commit, and rollback statements for one SQLite transaction. @internal */
export type SQLiteTransactionSql = {
    readonly begin: string;
    readonly commit: string;
    readonly rollback: string;
};

/**
 * Rolls back the connection's open transaction after a failed operation, so the caller can
 * rethrow the original error.
 *
 * SQLite already rolls a transaction back itself after some errors, such as `SQLITE_FULL` or an
 * I/O error; an unconditional `ROLLBACK` then fails with "no transaction is active" and would
 * replace the original error. This module imports `node:sqlite` for types only, so entry points
 * that never open a database do not load it.
 *
 * @param database - Connection whose transaction failed.
 * @param rollbackSql - Configured rollback statement.
 * @internal
 */
export function rollbackFailedTransaction(database: DatabaseSync, rollbackSql: string): void {
    if (database.isTransaction) {
        database.exec(rollbackSql);
    }
}

/**
 * Runs one operation inside the configured transaction, committing its result or rolling back
 * and rethrowing its error.
 *
 * @param database - Open writable connection with no transaction active.
 * @param sql - Configured transaction statements.
 * @param operation - Work to run while the transaction's lock is held.
 * @returns The operation's result after commit.
 * @internal
 */
export function runInSQLiteTransaction<T>(
    database: DatabaseSync,
    sql: SQLiteTransactionSql,
    operation: () => T,
): T {
    database.exec(sql.begin);
    try {
        const result = operation();
        database.exec(sql.commit);
        return result;
    } catch (error) {
        rollbackFailedTransaction(database, sql.rollback);
        throw error;
    }
}

/**
 * Reports whether an error is SQLite `SQLITE_BUSY` or one of its extended codes.
 *
 * @param error - Value thrown by `node:sqlite`.
 * @returns Whether another connection's lock refused the statement.
 * @internal
 */
export function isSQLiteBusyError(error: unknown): boolean {
    if (typeof error !== "object" || error === null || !("errcode" in error)) {
        return false;
    }
    const { errcode } = error;
    return (
        typeof errcode === "number" && (errcode & SQLITE_PRIMARY_RESULT_CODE_MASK) === SQLITE_BUSY
    );
}

/**
 * Executes a statement outside any transaction, retrying `SQLITE_BUSY` until the connection's
 * configured busy timeout has elapsed.
 *
 * SQLite returns `SQLITE_BUSY` without consulting the busy handler when waiting could deadlock,
 * for example when two connections that both hold a shared lock on a new rollback-journal database
 * try to switch it to write-ahead logging. The losing statement releases its locks when it fails,
 * so the retry waits for the winner through the busy handler instead of spinning.
 *
 * @param database - Open connection with no transaction active.
 * @param sql - Statement to execute, such as the configured journal-mode pragma.
 * @param busyTimeoutMilliseconds - Configured busy timeout that bounds the retries.
 * @param now - Monotonic millisecond clock; tests inject one.
 * @throws {Error} The last SQLite error once the timeout elapses, or any non-busy error at once.
 * @internal
 */
export function execRetryingBusy(
    database: Pick<DatabaseSync, "exec">,
    sql: string,
    busyTimeoutMilliseconds: number,
    now: () => number = () => performance.now(),
): void {
    const deadline = now() + busyTimeoutMilliseconds;
    for (;;) {
        try {
            database.exec(sql);
            return;
        } catch (error) {
            if (!isSQLiteBusyError(error) || now() >= deadline) {
                throw error;
            }
        }
    }
}
