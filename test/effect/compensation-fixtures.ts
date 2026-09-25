import { DatabaseSync } from "node:sqlite";

import {
    createEffectCompensationRegistry,
    createEffectHandlerStack,
    createEffectIntent,
    type EffectCompensationRegistry,
    type EffectCompensationRequest,
    type EffectHandlerStack,
    type EffectIntent,
    type EffectReversibility,
    type ReplaySessionProgram,
    type ReplaySessionReceipt,
    runReplaySession,
    type SQLiteTraceStore,
} from "../../src/index.ts";

/** Effect kind that inserts one row into the fixture database. */
export const ROW_INSERT_KIND = "rows.insert";

/**
 * Opens the fixture world: a node:sqlite database with the `rows` table the effect inserts into
 * and the `compensation_log` table that records every compensation attempt and every deletion
 * that actually changed the world.
 */
export function openRowWorld(databasePath: string): DatabaseSync {
    const database = new DatabaseSync(databasePath);
    database.exec(`
        CREATE TABLE IF NOT EXISTS rows (id TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS compensation_log (
            idempotency_key TEXT PRIMARY KEY,
            invocations INTEGER NOT NULL,
            deleted INTEGER NOT NULL
        );
    `);
    return database;
}

/** Builds one row-insert effect intent. */
export function rowIntent(
    id: string,
    reversibility: EffectReversibility = "compensable",
): EffectIntent {
    return createEffectIntent({
        effectId: `effect:row:${id}`,
        kind: ROW_INSERT_KIND,
        payload: { id, value: `value:${id}` },
        reversibility,
    });
}

/** Handler stack materializing row inserts into the fixture database. */
export function rowInsertHandlers(databasePath: string): EffectHandlerStack {
    return createEffectHandlerStack([
        {
            handle: (intent) => {
                const { id, value } = intent.payload as {
                    readonly id: string;
                    readonly value: string;
                };
                const database = openRowWorld(databasePath);
                try {
                    database
                        .prepare("INSERT OR REPLACE INTO rows (id, value) VALUES (?, ?)")
                        .run(id, value);
                } finally {
                    database.close();
                }
                return { ok: true, value: { inserted: id } };
            },
            handlerId: "handler:rows.insert",
            kind: ROW_INSERT_KIND,
        },
    ]);
}

/**
 * Idempotent compensation of one row insert: in one database transaction, delete the row by its
 * primary key and record the attempt under the idempotency key. `deleted` counts only deletions
 * that changed the world, so a double compensation is observable as `deleted > 1`.
 *
 * @param databasePath - Fixture database path.
 * @param request - Compensation request of one attempt.
 */
export function compensateRow(
    databasePath: string,
    request: EffectCompensationRequest,
): { readonly deleted: number } {
    const { id } = request.intent.payload as { readonly id: string };
    const database = openRowWorld(databasePath);
    try {
        database.exec("BEGIN IMMEDIATE");
        const changes = Number(database.prepare("DELETE FROM rows WHERE id = ?").run(id).changes);
        database
            .prepare(
                `INSERT INTO compensation_log (idempotency_key, invocations, deleted) VALUES (?, 1, ?)
                 ON CONFLICT (idempotency_key) DO UPDATE SET
                     invocations = invocations + 1,
                     deleted = deleted + excluded.deleted`,
            )
            .run(request.idempotencyKey, changes);
        database.exec("COMMIT");
        return { deleted: changes };
    } finally {
        database.close();
    }
}

/** Registry compensating row inserts, recording every invocation's effect id in `calls`. */
export function rowCompensation(
    databasePath: string,
    calls: string[] = [],
    after?: (request: EffectCompensationRequest) => void | Promise<void>,
): EffectCompensationRegistry {
    return createEffectCompensationRegistry([
        {
            compensate: async (request) => {
                calls.push(request.intent.effect_id);
                const { deleted } = compensateRow(databasePath, request);
                await after?.(request);
                return { ok: true, value: { deleted } };
            },
            handlerId: "compensation:rows.delete",
            kind: ROW_INSERT_KIND,
        },
    ]);
}

/** Reads the ids of the rows currently in the fixture world. */
export function readRowIds(databasePath: string): readonly string[] {
    const database = openRowWorld(databasePath);
    try {
        return database
            .prepare("SELECT id FROM rows ORDER BY id")
            .all()
            .map((row) => String(row.id));
    } finally {
        database.close();
    }
}

/** Reads the compensation log: idempotency key to invocations and world-changing deletions. */
export function readCompensationLog(
    databasePath: string,
): ReadonlyMap<string, { readonly deleted: number; readonly invocations: number }> {
    const database = openRowWorld(databasePath);
    try {
        return new Map(
            database
                .prepare("SELECT idempotency_key, invocations, deleted FROM compensation_log")
                .all()
                .map((row) => [
                    String(row.idempotency_key),
                    { deleted: Number(row.deleted), invocations: Number(row.invocations) },
                ]),
        );
    } finally {
        database.close();
    }
}

/** Program inserting the given rows as effect steps, in order, with the given tiers. */
export function rowProgram(
    rows: readonly (readonly [string, EffectReversibility])[],
): ReplaySessionProgram {
    return async (context) => {
        for (const [id, reversibility] of rows) {
            await context.dispatchEffect(rowIntent(id, reversibility), { dependsOn: [] });
        }
        return null;
    };
}

/** Runs one root replay session (no worlds) inserting the given rows. */
export function runRowSession(
    store: SQLiteTraceStore,
    databasePath: string,
    commandId: string,
    rows: readonly (readonly [string, EffectReversibility])[],
): Promise<ReplaySessionReceipt> {
    return runReplaySession(store, {
        claimId: "worker",
        commandId,
        handlers: rowInsertHandlers(databasePath),
        program: rowProgram(rows),
        programId: "program:rows.v1",
    });
}
