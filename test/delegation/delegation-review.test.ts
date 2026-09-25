import assert from "node:assert/strict";
import { test } from "node:test";

import { createChildRunHandleId } from "../../src/delegation/records.ts";
import {
    DelegationCommandConflictError,
    discardChildRun,
    handoffChildRun,
    injectChildRunContext,
    inspectChildRun,
    openChildRun,
    retryChildRun,
    SQLiteTraceStore,
} from "../../src/index.ts";
import { appendOwnerRecord } from "../supervision/fixtures.ts";
import { openOptions, temporaryDatabasePath } from "./fixtures.ts";

const LEAD = "supervisor:lead";

test("an opening or retry cannot reuse a command identity retained by a handle command", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "review-command-ids");
    using store = new SQLiteTraceStore(databasePath);
    const first = openChildRun(store, openOptions("review:first"));
    const cited = appendOwnerRecord(store, "worker:notes", "n0");
    const injected = injectChildRunContext(store, {
        citedRecordIds: [cited],
        commandId: "review:shared",
        data: { hint: "x" },
        handle: first.handle,
        supervisorId: LEAD,
    });
    const handed = handoffChildRun(store, {
        commandId: "review:handoff",
        handle: first.handle,
        successorSupervisorId: "supervisor:next",
        supervisorId: LEAD,
    });
    for (const commandId of ["review:shared", "review:handoff"]) {
        assert.throws(
            () => openChildRun(store, openOptions(commandId)),
            (error: unknown) =>
                error instanceof DelegationCommandConflictError &&
                error.command_id === commandId &&
                error.handle_id === createChildRunHandleId(commandId),
        );
        assert.equal(store.readOwner(createChildRunHandleId(commandId)).length, 0);
    }
    const second = openChildRun(store, openOptions("review:second"));
    const discarded = discardChildRun(store, {
        commandId: "review:discard",
        handle: second.handle,
        reason: "retry elsewhere",
        supervisorId: LEAD,
    });
    for (const commandId of ["review:shared", "review:discard"]) {
        assert.throws(
            () => retryChildRun(store, { commandId, handle: second.handle, supervisorId: LEAD }),
            DelegationCommandConflictError,
        );
        assert.equal(store.readOwner(createChildRunHandleId(commandId)).length, 0);
    }
    assert.equal(inspectChildRun(store, first.handle.handle_id).head_record_id, handed.record_id);
    // A supervisor handoff forwards publication authority: an extension publication control.
    const forwarded = inspectChildRun(store, first.handle.handle_id).proof;
    assert.equal(forwarded.profile, "extension");
    assert.equal(forwarded.reference_validated, false);
    assert.deepEqual(forwarded.metadata.publication_controls, ["forwarding"]);
    assert.equal(inspectChildRun(store, second.handle.handle_id).proof.profile, "runtime_only");
    assert.equal(
        inspectChildRun(store, second.handle.handle_id).head_record_id,
        discarded.record_id,
    );
    assert.equal(injected.inspection.injections.length, 1);
    const successor = retryChildRun(store, {
        commandId: "review:retry",
        handle: second.handle,
        supervisorId: LEAD,
    });
    assert.equal(successor.inspection.predecessor?.decision_record_id, discarded.record_id);
    assert.equal(store.verifyIntegrity().ok, true);
});
