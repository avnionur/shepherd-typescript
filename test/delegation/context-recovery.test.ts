import assert from "node:assert/strict";
import { test } from "node:test";

import {
    type ChildRunSupervisorContextEntry,
    injectChildRunContext,
    inspectChildRun,
    openChildRun,
    runChildRun,
    SQLiteTraceStore,
    type StoreAppendRequest,
} from "../../src/index.ts";
import { appendOwnerRecord } from "../supervision/fixtures.ts";
import { openOptions, temporaryDatabasePath } from "./fixtures.ts";

const LEAD = "supervisor:lead";

class CrashingStore extends SQLiteTraceStore {
    crashNextAppend = false;

    override append(request: StoreAppendRequest) {
        if (this.crashNextAppend) {
            this.crashNextAppend = false;
            throw new Error("simulated crash after context consumption");
        }
        return super.append(request);
    }
}

test("a crash between context consumption and the child creation reuses the consumed context", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "context-recovery");
    using store = new CrashingStore(databasePath);
    const { handle } = openChildRun(store, openOptions("delegate:context-recovery"));
    const cited = appendOwnerRecord(store, "worker:notes", "n0");
    const injected = injectChildRunContext(store, {
        citedRecordIds: [cited],
        commandId: "inject:recovery",
        data: { hint: "first" },
        handle,
        supervisorId: LEAD,
    });
    store.crashNextAppend = true;
    await assert.rejects(runChildRun(store, { handle, program: () => "never" }), /simulated crash/);
    const interrupted = inspectChildRun(store, handle.handle_id);
    assert.equal(interrupted.status, "ready");
    assert.equal(interrupted.child, null);
    assert.deepEqual(interrupted.consumed_context?.consumed_record_ids, [injected.record_id]);
    assert.equal(interrupted.injections[0]?.consumed, true);

    const late = injectChildRunContext(store, {
        citedRecordIds: [cited],
        commandId: "inject:late",
        data: { hint: "late" },
        handle,
        supervisorId: LEAD,
    });
    assert.equal(late.inspection.injections[1]?.consumed, false);

    let received: readonly ChildRunSupervisorContextEntry[] = [];
    const ran = await runChildRun(store, {
        handle,
        program: ({ supervisor_context }) => {
            received = supervisor_context;
            return "hi";
        },
    });
    assert.deepEqual(received, [
        { cited_record_ids: [cited], data: { hint: "first" }, record_id: injected.record_id },
    ]);
    assert.equal(ran.inspection.status, "settling");
    assert.equal(
        ran.inspection.consumed_context?.record_id,
        interrupted.consumed_context?.record_id,
    );
    assert.equal(
        store.readOwner(handle.handle_id).filter((record) => record.body.phase === "consumed")
            .length,
        1,
    );
    assert.deepEqual(
        ran.inspection.injections.map((injection) => injection.consumed),
        [true, false],
    );
    assert.equal(store.verifyIntegrity().ok, true);
});
