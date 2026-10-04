import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
    claimScopeWriter,
    compensateEffects,
    createEffectCompensationRegistry,
    createEffectHandlerStack,
    createEffectReconciliationAuthority,
    dispatchSupervisedEffect,
    EffectCompensationConflictError,
    EffectCompensationEvidenceError,
    emitScopeRecord,
    inspectEffectReconciliation,
    inspectReplaySession,
    inspectScope,
    ReplayLeaseFencedError,
    reconcileEffect,
    registerRootScope,
    SQLiteTraceStore,
} from "../../src/index.ts";
import { temporaryDirectory } from "../replay/fixtures.ts";
import {
    ROW_INSERT_KIND,
    readRowIds,
    rowInsertHandlers,
    rowIntent,
} from "./compensation-fixtures.ts";

test("a killed materializer can be reconciled without fabricating its missing intent or outcome", async (context) => {
    const directory = await temporaryDirectory(context, "unknown-materialization");
    const database = path.join(directory, "trace.sqlite");
    const world = path.join(directory, "world.sqlite");
    new SQLiteTraceStore(database).close();
    const child = fork(
        fileURLToPath(new URL("../fixtures/reconciliation-source-process.ts", import.meta.url)),
        [database, world],
        { silent: true, execArgv: [] },
    );
    context.after(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    });
    const exited = once(child, "exit");
    const [message] = await once(child, "message");
    const { sessionId } = message as { readonly sessionId: string };
    child.kill("SIGKILL");
    assert.equal((await exited)[1], "SIGKILL");
    using store = new SQLiteTraceStore(database);
    const source = inspectReplaySession(store, { sessionId });
    const recordId = source.pending_admission_record_id;
    assert.ok(recordId);
    const lease = store.readReplaySession(sessionId);
    assert.ok(lease);
    const before = inspectEffectReconciliation(store, { effectRecordId: recordId });
    assert.equal(before.target.intent, null);
    assert.equal(before.target.outcome, null);
    assert.equal(before.target.successful_materialization, false);
    assert.equal(before.compensation, null);
    const authority = createEffectReconciliationAuthority({
        actorId: "operator",
        policyId: "incident",
        authorize: () => true,
        verifyCompletion: () => false,
    });
    const request = {
        authority,
        basisId: before.basis_id,
        commandId: "accept:uncertain",
        effectRecordId: recordId,
        disposition: "accepted_unresolved" as const,
        evidenceRecordIds: [recordId],
        reason: "Materializer died after external mutation; explicitly retain this uncertainty.",
    };
    await assert.rejects(reconcileEffect(store, request), EffectCompensationConflictError);
    const clock = context.mock.method(Date, "now", () => lease.lease_expires_at + 1);
    const receipt = await reconcileEffect(store, request);
    clock.mock.restore();
    assert.equal(receipt.completion_verified, false);
    const guards = store.readOwner(before.target.compensation_id);
    assert.equal(guards.length, 1);
    assert.equal(guards[0]?.envelope.record_id, receipt.record_id);
    assert.equal(
        inspectEffectReconciliation(store, { effectRecordId: recordId }).compensation,
        null,
    );
    const after = inspectReplaySession(store, { sessionId });
    assert.equal(after.classification, "materialization_uncertain");
    assert.equal(after.steps.length, 0);
    assert.equal(after.pending_admission_record_id, recordId);
    assert.deepEqual(after.residual_risks, [receipt]);
    assert.deepEqual(readRowIds(world), ["a"]);
    assert.throws(
        () =>
            store.renewReplaySessionLease(
                sessionId,
                { claimId: lease.claim_id, fencingToken: lease.fencing_token },
                Date.now(),
            ),
        ReplayLeaseFencedError,
    );
    using imported = new SQLiteTraceStore();
    imported.importTrace(store.exportTrace());
    assert.deepEqual(
        inspectEffectReconciliation(imported, { effectRecordId: recordId }).decisions,
        [receipt],
    );
    assert.deepEqual(inspectReplaySession(imported, { sessionId }).residual_risks, [receipt]);
});

test("failed supervised materialization retains real uncertainty and scope residual risk", async (context) => {
    const directory = await temporaryDirectory(context, "failed-dispatch-reconciliation");
    const world = path.join(directory, "world.sqlite");
    using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    const inserts = rowInsertHandlers(world);
    const dispatch = await dispatchSupervisedEffect(store, {
        commandId: "dispatch",
        claimId: "dispatch",
        intent: rowIntent("a"),
        handlers: createEffectHandlerStack([
            {
                handlerId: "uncertain",
                kind: ROW_INSERT_KIND,
                handle: async (intent) => {
                    await inserts.dispatch(intent);
                    throw new Error("result lost after insertion");
                },
            },
        ]),
    });
    assert.equal(dispatch.resolution?.disposition, "materialization_failed");
    const admission = dispatch.admission_record_id;
    const resolution = dispatch.resolution?.record_id;
    assert.ok(admission && resolution);
    const before = inspectEffectReconciliation(store, { effectRecordId: admission });
    assert.equal(before.target.effect_record_id, resolution);
    assert.equal(before.target.outcome, null);
    assert.deepEqual(before.target.intent, rowIntent("a"));
    const root = registerRootScope(store, {
        commandId: "scope",
        authority: { ceiling: [], grant: [] },
    });
    const writer = claimScopeWriter(store, { scopeId: root.scope_id, claimId: "scope" });
    emitScopeRecord(store, {
        commandId: "cite",
        expectedHeadRecordId: root.head.record_id,
        citedRecordIds: [resolution],
        data: { incident: true },
        writer,
    });
    const authority = createEffectReconciliationAuthority({
        actorId: "operator",
        policyId: "incident",
        authorize: () => true,
        verifyCompletion: () => false,
    });
    const receipt = await reconcileEffect(store, {
        authority,
        basisId: before.basis_id,
        commandId: "accept:dispatch",
        disposition: "accepted_unresolved",
        effectRecordId: admission,
        evidenceRecordIds: [resolution],
        reason: "Preserve external uncertainty explicitly.",
    });
    assert.deepEqual(inspectScope(store, root.scope_id)?.residual_risks, [receipt]);
    await assert.rejects(
        compensateEffects(store, {
            commandId: "no-fabricated-success",
            effectRecordIds: [resolution],
            registry: createEffectCompensationRegistry([]),
        }),
        EffectCompensationEvidenceError,
    );
    assert.deepEqual(readRowIds(world), ["a"]);
    assert.equal(store.verifyIntegrity().ok, true);
});
