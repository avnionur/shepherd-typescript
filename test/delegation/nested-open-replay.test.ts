import assert from "node:assert/strict";
import { test } from "node:test";

import {
    type ChildRunHandle,
    openChildRun,
    runChildRun,
    SQLiteTraceStore,
} from "../../src/index.ts";
import { echoTask, grantOf, openOptions, temporaryDatabasePath } from "./fixtures.ts";

test("reopening a grandchild with the same command replays the handle under its child parent", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "nested-open-replay");
    using store = new SQLiteTraceStore(databasePath);
    const child = openChildRun(store, openOptions("nested-replay:child", { maxTurns: 4 }));
    const opened: ChildRunHandle[] = [];
    await runChildRun(store, {
        handle: child.handle,
        program: ({ handle }) => {
            const options = {
                budget: { maxTurns: 1 },
                commandId: "nested-replay:grandchild",
                grant: [grantOf(["read"])],
                input: "nested",
                parent: handle,
                supervisorId: "supervisor:child",
                task: echoTask,
            };
            opened.push(openChildRun(store, options).handle, openChildRun(store, options).handle);
            return "hello";
        },
    });
    const [first, replayed] = opened;
    assert.ok(first && replayed);
    assert.equal(replayed.handle_id, first.handle_id);
    assert.equal(replayed.child_run_id, first.child_run_id);
});
