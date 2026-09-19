import type { DatabaseSync } from "node:sqlite";

import { kernelProtocolConfig } from "../protocol/config.ts";
import { SUPERVISION_SUBSCRIPTION_START_POSITIONS } from "../protocol/values.generated.ts";
import { rollbackFailedTransaction } from "../runtime/sqlite-transaction.ts";
import { SupervisionCursorConflictError } from "../supervision/errors.ts";
import {
    createTraceSubscriptionCursor,
    readTraceSubscriptionCursor,
} from "../supervision/records.ts";
import type {
    TraceSubscriptionCursor,
    TraceSubscriptionStartPosition,
} from "../supervision/types.ts";
import { STORE_TABLES, STORE_TRANSACTION_SQL } from "./constants.ts";
import { TraceStoreError } from "./errors.ts";

const [ORIGIN_POSITION] = SUPERVISION_SUBSCRIPTION_START_POSITIONS;

/** Durable subscription bookkeeping row. @internal */
export type TraceSubscriptionRow = {
    /** Acknowledged canonical cursor. */
    readonly cursor: TraceSubscriptionCursor;
    /** Selected owners in canonical order. */
    readonly owners: readonly string[];
    /** Durable subscription identity. */
    readonly subscription_id: string;
};

/** Reads the next unallocated ordinal of each owner, using the first ordinal when absent. @internal */
export function readOwnerNextOrdinals(
    database: DatabaseSync,
    owners: readonly string[],
): ReadonlyMap<string, number> {
    const statement = database.prepare(
        `SELECT next_ordinal FROM ${STORE_TABLES.ownerOrdinals} WHERE owner_id = ?`,
    );
    return new Map(
        owners.map((owner) => {
            const row = statement.get(owner);
            return [
                owner,
                row === undefined
                    ? kernelProtocolConfig.append.firstOwnerOrdinal
                    : Number(row.next_ordinal),
            ] as const;
        }),
    );
}

/** Computes a validated start cursor for canonical owners without store mutation. @internal */
export function resolveTraceSubscriptionStart(
    database: DatabaseSync,
    owners: readonly string[],
    start: TraceSubscriptionCursor | TraceSubscriptionStartPosition,
    subscriptionId: string | null,
): TraceSubscriptionCursor {
    const next = readOwnerNextOrdinals(database, owners);
    if (typeof start === "string") {
        return createTraceSubscriptionCursor(
            owners.map((owner) => ({
                next_ordinal:
                    start === ORIGIN_POSITION
                        ? kernelProtocolConfig.append.firstOwnerOrdinal
                        : (next.get(owner) as number),
                owner_id: owner,
            })),
        );
    }
    assertCursorOwners(start, owners, subscriptionId);
    if (
        start.positions.some(
            (position) => position.next_ordinal > (next.get(position.owner_id) as number),
        )
    ) {
        throw new SupervisionCursorConflictError(
            subscriptionId,
            "cursor passes records retained by this store",
        );
    }
    return start;
}

/** Creates or resumes one durable subscription row atomically. @internal */
export function openTraceSubscriptionInStore(
    database: DatabaseSync,
    subscriptionId: string,
    owners: readonly string[],
    start: TraceSubscriptionCursor | TraceSubscriptionStartPosition | undefined,
): TraceSubscriptionCursor {
    database.exec(STORE_TRANSACTION_SQL.begin);
    try {
        const existing = readTraceSubscriptionRow(database, subscriptionId);
        let cursor: TraceSubscriptionCursor;
        if (existing !== undefined) {
            if (existing.owners.join("\0") !== owners.join("\0")) {
                throw new SupervisionCursorConflictError(
                    subscriptionId,
                    "durable subscription names different owners",
                );
            }
            if (
                start !== undefined &&
                typeof start !== "string" &&
                start.cursor_id !== existing.cursor.cursor_id
            ) {
                throw new SupervisionCursorConflictError(
                    subscriptionId,
                    "start cursor differs from the acknowledged cursor",
                );
            }
            cursor = existing.cursor;
        } else {
            cursor = resolveTraceSubscriptionStart(
                database,
                owners,
                start ?? ORIGIN_POSITION,
                subscriptionId,
            );
            database
                .prepare(
                    `INSERT INTO ${STORE_TABLES.traceSubscriptions}(subscription_id, owners_json, cursor_id, cursor_json) VALUES (?, ?, ?, ?)`,
                )
                .run(
                    subscriptionId,
                    JSON.stringify(owners),
                    cursor.cursor_id,
                    JSON.stringify(cursor),
                );
        }
        database.exec(STORE_TRANSACTION_SQL.commit);
        return cursor;
    } catch (error) {
        rollbackFailedTransaction(database, STORE_TRANSACTION_SQL.rollback);
        throw error;
    }
}

/** Advances one durable acknowledged cursor monotonically. @internal */
export function acknowledgeTraceSubscriptionInStore(
    database: DatabaseSync,
    subscriptionId: string,
    cursor: TraceSubscriptionCursor,
): TraceSubscriptionCursor {
    database.exec(STORE_TRANSACTION_SQL.begin);
    try {
        const existing = readTraceSubscriptionRow(database, subscriptionId);
        if (existing === undefined) {
            throw new TraceStoreError(`subscription ${subscriptionId} is not retained`);
        }
        assertCursorOwners(cursor, existing.owners, subscriptionId);
        const next = readOwnerNextOrdinals(database, existing.owners);
        for (const [index, position] of cursor.positions.entries()) {
            if (
                position.next_ordinal <
                    (existing.cursor.positions[index] as { readonly next_ordinal: number })
                        .next_ordinal ||
                position.next_ordinal > (next.get(position.owner_id) as number)
            ) {
                throw new SupervisionCursorConflictError(
                    subscriptionId,
                    "acknowledgement regresses or passes retained records",
                );
            }
        }
        if (cursor.cursor_id !== existing.cursor.cursor_id) {
            database
                .prepare(
                    `UPDATE ${STORE_TABLES.traceSubscriptions} SET cursor_id = ?, cursor_json = ? WHERE subscription_id = ?`,
                )
                .run(cursor.cursor_id, JSON.stringify(cursor), subscriptionId);
        }
        database.exec(STORE_TRANSACTION_SQL.commit);
        return cursor;
    } catch (error) {
        rollbackFailedTransaction(database, STORE_TRANSACTION_SQL.rollback);
        throw error;
    }
}

/** Reads and validates one durable subscription row. @internal */
export function readTraceSubscriptionRow(
    database: DatabaseSync,
    subscriptionId: string,
): TraceSubscriptionRow | undefined {
    const row = database
        .prepare(
            `SELECT subscription_id, owners_json, cursor_id, cursor_json FROM ${STORE_TABLES.traceSubscriptions} WHERE subscription_id = ?`,
        )
        .get(subscriptionId);
    return row === undefined ? undefined : decodeTraceSubscriptionRow(row);
}

/** Lists every durable subscription identity in canonical order. @internal */
export function readTraceSubscriptionIds(database: DatabaseSync): readonly string[] {
    return database
        .prepare(
            `SELECT subscription_id FROM ${STORE_TABLES.traceSubscriptions} ORDER BY subscription_id`,
        )
        .all()
        .map((row) => String(row.subscription_id));
}

/** Verifies that one durable cursor is canonical and within retained owner paths. @internal */
export function verifyTraceSubscriptionRow(database: DatabaseSync, subscriptionId: string): void {
    const row = readTraceSubscriptionRow(database, subscriptionId) as TraceSubscriptionRow;
    const next = readOwnerNextOrdinals(database, row.owners);
    if (
        row.cursor.positions.some(
            (position) => position.next_ordinal > (next.get(position.owner_id) as number),
        )
    ) {
        throw new TraceStoreError(`subscription ${subscriptionId} cursor passes retained records`);
    }
}

function decodeTraceSubscriptionRow(row: Record<string, unknown>): TraceSubscriptionRow {
    const subscriptionId = String(row.subscription_id);
    try {
        const owners = JSON.parse(String(row.owners_json)) as unknown;
        const cursor = readTraceSubscriptionCursor(JSON.parse(String(row.cursor_json)));
        if (
            !Array.isArray(owners) ||
            cursor.cursor_id !== row.cursor_id ||
            cursor.positions.map((position) => position.owner_id).join("\0") !== owners.join("\0")
        ) {
            throw new TypeError("subscription row owners or cursor identity disagree");
        }
        return Object.freeze({
            cursor,
            owners: Object.freeze(owners.map(String)),
            subscription_id: subscriptionId,
        });
    } catch (error) {
        throw new TraceStoreError(`subscription ${subscriptionId} bookkeeping is corrupt`, {
            cause: error,
        });
    }
}

function assertCursorOwners(
    cursor: TraceSubscriptionCursor,
    owners: readonly string[],
    subscriptionId: string | null,
): void {
    if (cursor.positions.map((position) => position.owner_id).join("\0") !== owners.join("\0")) {
        throw new SupervisionCursorConflictError(subscriptionId, "cursor names different owners");
    }
}
