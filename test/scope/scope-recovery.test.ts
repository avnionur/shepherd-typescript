import assert from "node:assert/strict";
import { test } from "node:test";

import {
    type AppendReceipt,
    claimScopeWriter,
    discardScope,
    inspectScopeRecovery,
    mergeScope,
    registerChildScope,
    releaseScopeWriter,
    SQLiteTraceStore,
} from "../../src/index.ts";
import { createNestedWorld, forkChild, headOf, writeCustody } from "./merge-fixtures.ts";

class SwitchedStore extends SQLiteTraceStore {
    failForkCompletion = false;
    failMergeCompletion = false;

    override completeScopeFork(
        ...parameters: Parameters<SQLiteTraceStore["completeScopeFork"]>
    ): AppendReceipt {
        if (this.failForkCompletion) {
            throw new Error("interrupted fork completion");
        }
        return super.completeScopeFork(...parameters);
    }

    override completeScopeMerge(
        ...parameters: Parameters<SQLiteTraceStore["completeScopeMerge"]>
    ): AppendReceipt {
        if (this.failMergeCompletion) {
            throw new Error("interrupted merge completion");
        }
        return super.completeScopeMerge(...parameters);
    }
}

test("recovery classification names one owner and the exact command for every live scope", async (context) => {
    const world = await createNestedWorld(context, "recovery", SwitchedStore);
    const store = world.store as SwitchedStore;
    const { carrier, child, childWriter, parent, parentWriter, root, rootWriter } = world;
    const at = (nowMilliseconds: number) =>
        new Map(
            inspectScopeRecovery(store, { nowMilliseconds }).scopes.map((entry) => [
                entry.scope_id,
                entry,
            ]),
        );

    // Idle trace child, merged and discarded children, a pending fork, and a reserved merge.
    const idle = registerChildScope(store, {
        commandId: "scope-command:idle",
        expectedHeadRecordId: headOf(store, parent.scope_id),
        grant: [],
        nowMilliseconds: 1_500,
        parent: parentWriter,
    });
    const merged = await forkChild(world, parent, parentWriter, "scope-command:merged");
    await mergeScope(store, {
        carrier,
        child: claimScopeWriter(store, {
            claimId: "claim:merged",
            nowMilliseconds: 1_500,
            scopeId: merged.scope_id,
        }),
        commandId: "scope-command:merge-merged",
        expectedChildHeadRecordId: headOf(store, merged.scope_id),
        expectedParentHeadRecordId: headOf(store, parent.scope_id),
        nowMilliseconds: 1_500,
        parent: parentWriter,
    });
    const cleaned = await forkChild(world, parent, parentWriter, "scope-command:cleaned");
    await discardScope(store, {
        carrier,
        commandId: "scope-command:discard-cleaned",
        expectedHeadRecordId: headOf(store, cleaned.scope_id),
        nowMilliseconds: 1_500,
        parent: parentWriter,
        scopeId: cleaned.scope_id,
    });
    store.failForkCompletion = true;
    await assert.rejects(
        forkChild(world, parent, parentWriter, "scope-command:pending-fork"),
        /interrupted fork completion/u,
    );
    store.failForkCompletion = false;
    await writeCustody(world, child.world.custody_id, "child.txt", "child\n");
    store.failMergeCompletion = true;
    await assert.rejects(
        mergeScope(store, {
            carrier,
            child: childWriter,
            commandId: "scope-command:reserved",
            expectedChildHeadRecordId: headOf(store, child.scope_id),
            expectedParentHeadRecordId: headOf(store, parent.scope_id),
            nowMilliseconds: 1_500,
            parent: parentWriter,
        }),
        /interrupted merge completion/u,
    );
    store.failMergeCompletion = false;

    const report = inspectScopeRecovery(store, { nowMilliseconds: 20_000 });
    assert.equal(report.evaluated_at, 20_000);
    assert.equal(Object.isFrozen(report.scopes), true);
    assert.deepEqual(
        report.scopes.map((entry) => entry.scope_id),
        [...report.scopes.map((entry) => entry.scope_id)].sort(),
    );
    const early = at(20_000);
    const pendingFork = [...early.values()].find(
        (entry) => entry.classification === "fork_pending",
    );
    assert.deepEqual(
        {
            classification: early.get(root.scope_id)?.classification,
            resume: early.get(root.scope_id)?.resume,
        },
        { classification: "writer_held", resume: null },
    );
    assert.deepEqual(early.get(idle.scope_id), {
        claim: null,
        classification: "idle",
        parent_scope_id: parent.scope_id,
        recovery_owner_scope_id: null,
        resume: null,
        scope_id: idle.scope_id,
        state: "open",
    });
    assert.equal(early.get(merged.scope_id)?.classification, "terminal");
    assert.equal(early.get(cleaned.scope_id)?.classification, "terminal");
    assert.deepEqual(
        { owner: pendingFork?.recovery_owner_scope_id, resume: pendingFork?.resume },
        {
            owner: parent.scope_id,
            resume: { command_id: "scope-command:pending-fork", kind: "fork" },
        },
    );
    assert.deepEqual(
        {
            classification: early.get(child.scope_id)?.classification,
            owner: early.get(child.scope_id)?.recovery_owner_scope_id,
            resume: early.get(child.scope_id)?.resume,
        },
        {
            classification: "merge_pending",
            owner: parent.scope_id,
            resume: { command_id: "scope-command:reserved", kind: "merge" },
        },
    );

    // After every lease lapses an unreleased writer is an orphaned worker owned by its scope.
    const late = at(90_000);
    assert.deepEqual(
        {
            classification: late.get(root.scope_id)?.classification,
            owner: late.get(root.scope_id)?.recovery_owner_scope_id,
            resume: late.get(root.scope_id)?.resume,
        },
        {
            classification: "writer_expired",
            owner: root.scope_id,
            resume: { command_id: null, kind: "claim" },
        },
    );

    // Discarding the parent without a carrier leaves cleanup pending for the whole subtree.
    releaseScopeWriter(store, { writer: parentWriter });
    releaseScopeWriter(store, {
        writer: claimScopeWriter(store, {
            claimId: "claim:child",
            nowMilliseconds: 1_600,
            scopeId: child.scope_id,
        }),
    });
    await discardScope(store, {
        commandId: "scope-command:discard-parent",
        expectedHeadRecordId: headOf(store, parent.scope_id),
        nowMilliseconds: 1_600,
        parent: rootWriter,
        scopeId: parent.scope_id,
    });
    const sealed = at(1_700);
    for (const scopeId of [parent.scope_id, child.scope_id, idle.scope_id]) {
        assert.deepEqual(
            {
                classification: sealed.get(scopeId)?.classification,
                owner: sealed.get(scopeId)?.recovery_owner_scope_id,
                resume: sealed.get(scopeId)?.resume,
            },
            {
                classification: "cleanup_pending",
                owner: root.scope_id,
                resume: { command_id: "scope-command:discard-parent", kind: "discard" },
            },
        );
    }
    store.close();
    using reopened = new SQLiteTraceStore(world.databasePath);
    assert.equal(inspectScopeRecovery(reopened, { nowMilliseconds: 1_700 }).scopes.length, 7);
    assert.throws(() => inspectScopeRecovery(reopened, { extra: true } as never), TypeError);
    assert.equal(inspectScopeRecovery(reopened).evaluated_at > 1_700, true);
    // Imported archives carry no live rows and therefore no recovery obligations.
    using imported = new SQLiteTraceStore();
    imported.importTrace(reopened.exportTrace());
    assert.deepEqual(inspectScopeRecovery(imported).scopes, []);
});

class InterruptedCleanupRecordStore extends SQLiteTraceStore {
    interruptCleanup = false;

    override completeScopeDiscardCleanup(
        ...parameters: Parameters<SQLiteTraceStore["completeScopeDiscardCleanup"]>
    ): AppendReceipt {
        if (this.interruptCleanup) {
            throw new Error("interrupted before cleanup record");
        }
        return super.completeScopeDiscardCleanup(...parameters);
    }
}

test("cleanup ownership resolves through sealed parents and empty cleanup stays pending", async (context) => {
    const world = await createNestedWorld(
        context,
        "recovery-sealed",
        InterruptedCleanupRecordStore,
    );
    const store = world.store as InterruptedCleanupRecordStore;
    const { child, childWriter, parent, parentWriter, root, rootWriter } = world;
    const entry = (scopeId: string) =>
        inspectScopeRecovery(store, { nowMilliseconds: 1_700 }).scopes.find(
            (scope) => scope.scope_id === scopeId,
        );

    // A trace-only discard interrupted before its cleanup record is still pending, not terminal.
    const trace = registerChildScope(store, {
        commandId: "scope-command:trace",
        expectedHeadRecordId: headOf(store, child.scope_id),
        grant: [],
        nowMilliseconds: 1_600,
        parent: childWriter,
    });
    store.interruptCleanup = true;
    await assert.rejects(
        discardScope(store, {
            commandId: "scope-command:discard-trace",
            expectedHeadRecordId: headOf(store, trace.scope_id),
            nowMilliseconds: 1_600,
            parent: childWriter,
            scopeId: trace.scope_id,
        }),
        /interrupted before cleanup record/u,
    );
    store.interruptCleanup = false;
    assert.deepEqual(
        {
            classification: entry(trace.scope_id)?.classification,
            owner: entry(trace.scope_id)?.recovery_owner_scope_id,
            resume: entry(trace.scope_id)?.resume,
        },
        {
            classification: "cleanup_pending",
            owner: child.scope_id,
            resume: { command_id: "scope-command:discard-trace", kind: "discard" },
        },
    );

    // A world grandchild discarded without a carrier; its parent is then sealed by an ancestor.
    const grandchild = await forkChild(world, child, childWriter, "scope-command:grandchild");
    await discardScope(store, {
        commandId: "scope-command:discard-grandchild",
        expectedHeadRecordId: headOf(store, grandchild.scope_id),
        nowMilliseconds: 1_600,
        parent: childWriter,
        scopeId: grandchild.scope_id,
    });
    releaseScopeWriter(store, { writer: childWriter });
    releaseScopeWriter(store, { writer: parentWriter });
    const parentHead = headOf(store, parent.scope_id);
    await discardScope(store, {
        commandId: "scope-command:discard-parent",
        expectedHeadRecordId: parentHead,
        nowMilliseconds: 1_700,
        parent: rootWriter,
        scopeId: parent.scope_id,
    });
    for (const scopeId of [grandchild.scope_id, trace.scope_id, child.scope_id]) {
        assert.deepEqual(
            { owner: entry(scopeId)?.recovery_owner_scope_id, resume: entry(scopeId)?.resume },
            {
                owner: root.scope_id,
                resume: { command_id: "scope-command:discard-parent", kind: "discard" },
            },
        );
    }
    // Completing the ancestor cleanup makes every sealed descendant terminal.
    await discardScope(store, {
        carrier: world.carrier,
        commandId: "scope-command:discard-parent",
        expectedHeadRecordId: parentHead,
        nowMilliseconds: 1_700,
        parent: rootWriter,
        scopeId: parent.scope_id,
    });
    for (const scopeId of [grandchild.scope_id, trace.scope_id, child.scope_id, parent.scope_id]) {
        assert.equal(entry(scopeId)?.classification, "terminal", scopeId);
    }
});
