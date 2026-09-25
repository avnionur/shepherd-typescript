import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import {
    claimScopeWriter,
    createEffectCompensationRegistry,
    deriveEffectCompensationId,
    discardScope,
    dispatchSupervisedEffect,
    EffectCompensationFailedError,
    EffectCompensationHandlerNotFoundError,
    emitScopeRecord,
    inspectEffectCompensation,
    inspectScope,
    registerChildScope,
    releaseScopeWriter,
    ScopeEvidenceError,
    SQLiteTraceStore,
} from "../../src/index.ts";
import {
    compensateRow,
    ROW_INSERT_KIND,
    readCompensationLog,
    readRowIds,
    rowCompensation,
    rowInsertHandlers,
    rowIntent,
    runRowSession,
} from "../effect/compensation-fixtures.ts";
import { always, interceptor } from "../supervision/fixtures.ts";
import { appendUnrelatedRecord, registerAndClaim, temporaryDatabasePath } from "./fixtures.ts";

test("discard compensates the effects its sealed scopes cite, children after parents, in reverse order", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "discard-compensation");
    const world = path.join(path.dirname(databasePath), "world.sqlite");
    using store = new SQLiteTraceStore(databasePath);
    const { root, writer: rootWriter } = registerAndClaim(store);
    const child = registerChildScope(store, {
        commandId: "scope-command:child",
        expectedHeadRecordId: root.head.record_id,
        grant: [],
        nowMilliseconds: 1_100,
        parent: rootWriter,
    });
    const childWriter = claimScopeWriter(store, {
        claimId: "claim:child",
        nowMilliseconds: 1_100,
        scopeId: child.scope_id,
    });

    // Materialized effects: one supervised dispatch and a replay session of three row inserts.
    const dispatched = await dispatchSupervisedEffect(store, {
        claimId: "dispatcher",
        commandId: "dispatch:s1",
        handlers: rowInsertHandlers(world),
        intent: rowIntent("s1"),
    });
    const resolution = dispatched.resolution?.record_id as string;
    // A denied dispatch materialized nothing, so a scope citing it has nothing to compensate.
    const denied = await dispatchSupervisedEffect(store, {
        claimId: "dispatcher",
        commandId: "dispatch:denied",
        handlers: rowInsertHandlers(world),
        intent: rowIntent("denied"),
        interceptors: [interceptor("policy:deny", always({ decision: "deny", reason: "denied" }))],
    });
    assert.equal(denied.resolution?.disposition, "denied");
    const deniedResolution = denied.resolution?.record_id as string;
    const { inspection: session } = await runRowSession(store, world, "session:rows", [
        ["r1", "compensable"],
        ["r2", "compensable"],
        ["kept", "compensable"],
        ["reversible", "reversible"],
    ]);
    const [r1, r2, kept, reversible] = session.steps.map((step) => step.record_id);

    const first = emitScopeRecord(store, {
        citedRecordIds: [resolution, deniedResolution, appendUnrelatedRecord(store, "note")],
        commandId: "scope-command:child-emit-1",
        data: { note: "dispatched s1" },
        expectedHeadRecordId: child.head.record_id,
        nowMilliseconds: 1_200,
        writer: childWriter,
    });
    const grandchild = registerChildScope(store, {
        commandId: "scope-command:grandchild",
        expectedHeadRecordId: first.head.record_id,
        grant: [],
        nowMilliseconds: 1_300,
        parent: childWriter,
    });
    const second = emitScopeRecord(store, {
        citedRecordIds: [r1 as string, reversible as string],
        commandId: "scope-command:child-emit-2",
        data: { note: "inserted r1" },
        expectedHeadRecordId: grandchild.parent_head.record_id,
        nowMilliseconds: 1_400,
        writer: childWriter,
    });
    const grandchildWriter = claimScopeWriter(store, {
        claimId: "claim:grandchild",
        nowMilliseconds: 1_400,
        scopeId: grandchild.scope_id,
    });
    emitScopeRecord(store, {
        citedRecordIds: [r2 as string],
        commandId: "scope-command:grandchild-emit",
        data: { note: "inserted r2" },
        expectedHeadRecordId: grandchild.head.record_id,
        nowMilliseconds: 1_500,
        writer: grandchildWriter,
    });
    // The parent keeps its own effects.
    emitScopeRecord(store, {
        citedRecordIds: [kept as string],
        commandId: "scope-command:root-emit",
        data: { note: "kept" },
        expectedHeadRecordId: child.parent_head.record_id,
        nowMilliseconds: 1_500,
        writer: rootWriter,
    });
    releaseScopeWriter(store, { writer: grandchildWriter });
    releaseScopeWriter(store, { writer: childWriter });
    assert.deepEqual(readRowIds(world), ["kept", "r1", "r2", "reversible", "s1"]);

    const request = {
        commandId: "scope-command:discard",
        expectedHeadRecordId: second.head.record_id,
        nowMilliseconds: 1_600,
        parent: rootWriter,
        scopeId: child.scope_id,
    };
    // An unregistered subtree root has nothing to compensate and is refused by admission.
    await assert.rejects(
        discardScope(store, {
            ...request,
            scopeId: `${child.scope_id.slice(0, -8)}00000000`,
        }),
        ScopeEvidenceError,
    );
    // A missing handler is refused before the decision seals anything.
    await assert.rejects(discardScope(store, request), EffectCompensationHandlerNotFoundError);
    assert.equal(inspectScope(store, child.scope_id)?.state, "open");
    assert.equal(store.readOwner(deriveEffectCompensationId(resolution)).length, 0);

    const calls: string[] = [];
    const discarded = await discardScope(store, {
        ...request,
        compensation: rowCompensation(world, calls),
    });
    assert.deepEqual(
        [...discarded.sealed_scope_ids].sort(),
        [child.scope_id, grandchild.scope_id].sort(),
    );
    assert.equal(discarded.cleanup.phase, "cleaned");
    // Materialization order s1, r1 (child), r2 (grandchild), compensated in reverse.
    assert.deepEqual(calls, ["effect:row:r2", "effect:row:r1", "effect:row:s1"]);
    assert.deepEqual(readRowIds(world), ["kept", "reversible"]);
    const supervised = inspectEffectCompensation(store, {
        compensationId: deriveEffectCompensationId(resolution),
    });
    assert.equal(supervised.status, "compensated");
    assert.deepEqual(supervised.materialization, {
        kind: "supervised_dispatch",
        record_id: resolution,
    });
    assert.deepEqual(supervised.effect_intent, dispatched.effective_intent);
    assert.deepEqual(supervised.attempts[0]?.trigger, {
        command_id: "scope-command:discard",
        kind: "scope_discard",
    });

    // A retry returns the original receipt without compensating again.
    assert.deepEqual(
        await discardScope(store, { ...request, compensation: rowCompensation(world, calls) }),
        discarded,
    );
    assert.equal(calls.length, 3);
    assert.equal(store.readOwner(deriveEffectCompensationId(deniedResolution)).length, 0);
    for (const [key, entry] of readCompensationLog(world)) {
        assert.deepEqual(entry, { deleted: 1, invocations: 1 }, key);
    }
    assert.equal(store.verifyIntegrity().ok, true);
});

test("a failed discard compensation is reported after cleanup and retried by the same command", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "discard-compensation-failed");
    const world = path.join(path.dirname(databasePath), "world.sqlite");
    using store = new SQLiteTraceStore(databasePath);
    const { root, writer: rootWriter } = registerAndClaim(store);
    const child = registerChildScope(store, {
        commandId: "scope-command:child",
        expectedHeadRecordId: root.head.record_id,
        grant: [],
        nowMilliseconds: 1_100,
        parent: rootWriter,
    });
    const childWriter = claimScopeWriter(store, {
        claimId: "claim:child",
        nowMilliseconds: 1_100,
        scopeId: child.scope_id,
    });
    const { inspection: session } = await runRowSession(store, world, "session:rows", [
        ["only", "compensable"],
    ]);
    const materialization = session.steps[0]?.record_id as string;
    const emitted = emitScopeRecord(store, {
        citedRecordIds: [materialization],
        commandId: "scope-command:child-emit",
        data: { note: "inserted" },
        expectedHeadRecordId: child.head.record_id,
        nowMilliseconds: 1_200,
        writer: childWriter,
    });
    releaseScopeWriter(store, { writer: childWriter });
    let refuse = true;
    const registry = createEffectCompensationRegistry([
        {
            compensate: (request) =>
                refuse
                    ? { error: { reason: "locked" }, ok: false }
                    : { ok: true, value: compensateRow(world, request) },
            handlerId: "compensation:flaky",
            kind: ROW_INSERT_KIND,
        },
    ]);
    const request = {
        commandId: "scope-command:discard",
        compensation: registry,
        expectedHeadRecordId: emitted.head.record_id,
        nowMilliseconds: 1_300,
        parent: rootWriter,
        scopeId: child.scope_id,
    };
    await assert.rejects(discardScope(store, request), EffectCompensationFailedError);
    assert.equal(inspectScope(store, child.scope_id)?.state, "discarded");
    assert.equal(inspectScope(store, child.scope_id)?.terminal?.phase, "cleaned");
    assert.deepEqual(readRowIds(world), ["only"]);
    refuse = false;
    const discarded = await discardScope(store, request);
    assert.equal(discarded.cleanup.phase, "cleaned");
    assert.deepEqual(readRowIds(world), []);
    const compensation = inspectEffectCompensation(store, {
        compensationId: deriveEffectCompensationId(materialization),
    });
    assert.deepEqual(
        compensation.attempts.map((attempt) => attempt.outcome?.status),
        ["failed", "compensated"],
    );
});
