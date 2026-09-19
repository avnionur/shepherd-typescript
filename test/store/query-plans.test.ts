import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { type TestContext, test } from "node:test";

import { ROOT_WITNESS_ID, SQLiteTraceStore } from "../../src/index.ts";
import { HOT_PATH_SQL, listCutsSql, listOwnersBySchemaSql } from "../../src/store/statements.ts";

type PlannedStatement = {
    /** Whether the statement pages a bounded ordered listing and may walk an index. */
    readonly listing: boolean;
    readonly name: string;
    readonly sql: string;
};

const POINT_STATEMENTS: readonly PlannedStatement[] = Object.entries(HOT_PATH_SQL).map(
    ([name, sql]) => ({ listing: false, name, sql }),
);
const LISTING_STATEMENTS: readonly PlannedStatement[] = [false, true].flatMap((descending) =>
    [false, true].flatMap((prefixed) => [
        {
            listing: true,
            name: `listOwnersBySchema(descending=${descending}, prefixed=${prefixed})`,
            sql: listOwnersBySchemaSql(descending, prefixed),
        },
        {
            listing: true,
            name: `listCuts(descending=${descending}, prefixed=${prefixed})`,
            sql: listCutsSql(descending, prefixed),
        },
    ]),
);

async function populatedStore(context: TestContext): Promise<string> {
    const directory = realpathSync(await mkdtemp(path.join(tmpdir(), "shepherd-query-plans-")));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const databasePath = path.join(directory, "trace.sqlite");
    using store = new SQLiteTraceStore(databasePath);
    for (let batch = 0; batch < 40; batch += 1) {
        const owner = `run:plans-${batch % 8}`;
        const receipt = store.append({
            append_intent_id: `plans:${batch}`,
            batch: {
                groups: [
                    {
                        owner_id: owner,
                        records: Array.from({ length: 10 }, (_, index) => ({
                            append_local_id: `r${index}`,
                            body: { batch, index },
                            ...(index === 0 ? {} : { caused_by_local_refs: [`r${index - 1}`] }),
                            mode: "capture" as const,
                            schema_ref: `example.plans.v${batch % 4}`,
                            witness_ref: ROOT_WITNESS_ID,
                        })),
                    },
                ],
            },
        });
        store.publishCut({
            cut_id: `cut:plans-${batch}`,
            target_owner_id: owner,
            through_record_id: receipt.record_ids.at(-1) as string,
        });
    }
    return databasePath;
}

function planOf(database: DatabaseSync, sql: string): readonly string[] {
    const parameterCount = sql.split("?").length - 1;
    return database
        .prepare(`EXPLAIN QUERY PLAN ${sql}`)
        .all(...Array.from({ length: parameterCount }, () => "x"))
        .map((row) => String(row.detail));
}

function assertNoFullScan(database: DatabaseSync, statement: PlannedStatement): void {
    const plan = planOf(database, statement.sql);
    const tableAccess = plan.filter((detail) => /^(?:SCAN|SEARCH) /u.test(detail));
    assert.ok(tableAccess.length > 0, `${statement.name} has a table access: ${plan.join(" | ")}`);
    for (const detail of tableAccess) {
        assert.doesNotMatch(
            detail,
            /^SCAN \w+(?: AS \w+)?$/u,
            `${statement.name} scans a whole table: ${plan.join(" | ")}`,
        );
        if (!statement.listing) {
            assert.match(
                detail,
                /^SEARCH /u,
                `${statement.name} must be an indexed point lookup: ${plan.join(" | ")}`,
            );
        }
    }
}

test("hot-path statements never plan a full table scan", async (context) => {
    const databasePath = await populatedStore(context);
    const database = new DatabaseSync(databasePath, { readOnly: true });
    try {
        for (const statement of [...POINT_STATEMENTS, ...LISTING_STATEMENTS]) {
            assertNoFullScan(database, statement);
        }
    } finally {
        database.close();
    }
});

test("hot-path plans stay indexed after optimize collects planner statistics", async (context) => {
    const databasePath = await populatedStore(context);
    {
        using store = new SQLiteTraceStore(databasePath);
        store.maintain({ mode: "optimize" });
    }
    const database = new DatabaseSync(databasePath);
    try {
        // Force statistics so the planner decides from measured cardinalities.
        database.exec("ANALYZE");
        for (const statement of [...POINT_STATEMENTS, ...LISTING_STATEMENTS]) {
            assertNoFullScan(database, statement);
        }
    } finally {
        database.close();
    }
});

test("the plan checker recognizes a full table scan", async (context) => {
    const databasePath = await populatedStore(context);
    const database = new DatabaseSync(databasePath, { readOnly: true });
    try {
        assert.throws(
            () =>
                assertNoFullScan(database, {
                    listing: true,
                    name: "unindexed body filter",
                    sql: "SELECT record_id FROM records WHERE body_json = ?",
                }),
            /scans a whole table/u,
        );
        assert.throws(
            () =>
                assertNoFullScan(database, {
                    listing: false,
                    name: "index walk",
                    sql: "SELECT record_id FROM records ORDER BY record_id",
                }),
            /indexed point lookup/u,
        );
    } finally {
        database.close();
    }
});
