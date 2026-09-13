import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import {
    type AppendReceipt,
    claimScopeWriter,
    discardScope,
    emitScopeRecord,
    forkScope,
    inspectScope,
    mergeScope,
    readScopeCommandReceipt,
    registerChildScope,
    releaseScopeWriter,
    ScopeQuiescenceError,
    ScopeTerminalConflictError,
    ScopeWriterFencedError,
    SQLiteTraceStore,
    WorldCarrierError,
} from "../../src/index.ts";
import { bindingGrant, createForkWorkspace, forkOptions } from "./fork-fixtures.ts";
import {
    createNestedWorld,
    forkChild,
    headOf,
    type NestedWorld,
    writeCustody,
} from "./merge-fixtures.ts";

class InterruptedBeforeReservationStore extends SQLiteTraceStore {
    override prepareScopeMerge(): never {
        throw new Error("interrupted before merge reservation");
    }
}

class InterruptedAfterReservationStore extends SQLiteTraceStore {
    override prepareScopeMerge(
        ...parameters: Parameters<SQLiteTraceStore["prepareScopeMerge"]>
    ): never {
        super.prepareScopeMerge(...parameters);
        throw new Error("interrupted after merge reservation");
    }
}

class InterruptedBeforeMergeCompletionStore extends SQLiteTraceStore {
    override completeScopeMerge(): never {
        throw new Error("interrupted after parent publication");
    }
}

class LostMergeCompletionStore extends SQLiteTraceStore {
    override completeScopeMerge(
        ...parameters: Parameters<SQLiteTraceStore["completeScopeMerge"]>
    ): AppendReceipt {
        super.completeScopeMerge(...parameters);
        throw new Error("merge completion response lost after commit");
    }
}

class InterruptedBeforeDiscardStore extends SQLiteTraceStore {
    override discardScope(): never {
        throw new Error("interrupted before discard decision");
    }
}

class InterruptedBeforeCleanupRecordStore extends SQLiteTraceStore {
    override completeScopeDiscardCleanup(): never {
        throw new Error("interrupted after custody cleanup");
    }
}

class InterruptedAfterForkPreparedStore extends SQLiteTraceStore {
    override registerChildScope(
        ...parameters: Parameters<SQLiteTraceStore["registerChildScope"]>
    ): never {
        super.registerChildScope(...parameters);
        throw new Error("interrupted after prepared fork journal");
    }
}

class InterruptedBeforeForkCompletionStore extends SQLiteTraceStore {
    override completeScopeFork(): never {
        throw new Error("interrupted after fork custody");
    }
}

function mergeRequest(world: NestedWorld, store: SQLiteTraceStore, nowMilliseconds = 1_700) {
    return {
        carrier: world.carrier,
        child: world.childWriter,
        commandId: "scope-command:merge",
        expectedChildHeadRecordId: headOf(store, world.child.scope_id),
        expectedParentHeadRecordId: headOf(store, world.parent.scope_id),
        nowMilliseconds,
        parent: world.parentWriter,
    };
}

function reopenWriters(world: NestedWorld, store: SQLiteTraceStore, nowMilliseconds: number) {
    return {
        child: claimScopeWriter(store, {
            claimId: "claim:recovered-child",
            nowMilliseconds,
            scopeId: world.child.scope_id,
        }),
        parent: claimScopeWriter(store, {
            claimId: "claim:recovered-parent",
            nowMilliseconds,
            scopeId: world.parent.scope_id,
        }),
    };
}

test("merge recovery converges across each trace and carrier boundary", async (context) => {
    for (const [label, StoreClass, message] of [
        ["before-reservation", InterruptedBeforeReservationStore, /before merge reservation/u],
        ["after-reservation", InterruptedAfterReservationStore, /after merge reservation/u],
        ["before-completion", InterruptedBeforeMergeCompletionStore, /after parent publication/u],
        ["lost-completion", LostMergeCompletionStore, /response lost after commit/u],
    ] as const) {
        const world = await createNestedWorld(context, `merge-${label}`, StoreClass);
        await writeCustody(world, world.child.world.custody_id, "a.txt", "a\n");
        await writeCustody(world, world.child.world.custody_id, "b.txt", "b\n");
        const request = mergeRequest(world, world.store);
        await assert.rejects(mergeScope(world.store, request), message);
        world.store.close();

        using recovered = new SQLiteTraceStore(world.databasePath);
        // A merge whose completion committed is sealed: its receipt is read, not re-admitted.
        const merged =
            label === "lost-completion"
                ? readScopeCommandReceipt(recovered, "scope-command:merge")?.receipt
                : await mergeScope(recovered, {
                      ...request,
                      ...reopenWriters(world, recovered, 40_000),
                      nowMilliseconds: 40_000,
                  });
        assert.ok(merged?.command_id);
        const parentCustody = await world.carrier.openCustody(world.parent.world.custody_id);
        assert.equal(await readFile(path.join(parentCustody.path, "b.txt"), "utf8"), "b\n", label);
        assert.equal(inspectScope(recovered, world.child.scope_id)?.state, "merged", label);
        assert.deepEqual(
            readScopeCommandReceipt(recovered, "scope-command:merge")?.receipt,
            merged,
        );
        assert.equal(recovered.verifyIntegrity().ok, true, label);
    }
});

test("a reserved merge blocks competing terminal decisions and mutation of both scopes", async (context) => {
    const world = await createNestedWorld(
        context,
        "merge-reserved",
        InterruptedAfterReservationStore,
    );
    const { carrier, child, childWriter, parent, parentWriter, root, rootWriter, store } = world;
    const sibling = await forkChild(world, parent, parentWriter, "scope-command:fork-sibling");
    const siblingWriter = claimScopeWriter(store, {
        claimId: "claim:sibling",
        nowMilliseconds: 1_500,
        scopeId: sibling.scope_id,
    });
    await writeCustody(world, child.world.custody_id, "child.txt", "child\n");
    await assert.rejects(mergeScope(store, mergeRequest(world, store)), /after merge reservation/u);
    const reserved = inspectScope(store, child.scope_id);
    assert.equal(reserved?.state, "open");
    assert.equal(reserved?.terminal?.phase, "prepared");
    assert.equal(readScopeCommandReceipt(store, "scope-command:merge"), undefined);
    const parentHead = headOf(store, parent.scope_id);
    const childHead = headOf(store, child.scope_id);

    // The parent is quiescent until the reserved merge completes.
    assert.throws(
        () =>
            emitScopeRecord(store, {
                commandId: "scope-command:parent-emit",
                data: { note: "blocked" },
                expectedHeadRecordId: parentHead,
                nowMilliseconds: 1_700,
                writer: parentWriter,
            }),
        ScopeQuiescenceError,
    );
    assert.throws(
        () =>
            registerChildScope(store, {
                commandId: "scope-command:parent-child",
                expectedHeadRecordId: parentHead,
                grant: [],
                nowMilliseconds: 1_700,
                parent: parentWriter,
            }),
        ScopeQuiescenceError,
    );
    await assert.rejects(
        mergeScope(store, {
            carrier,
            child: siblingWriter,
            commandId: "scope-command:merge-sibling",
            expectedChildHeadRecordId: headOf(store, sibling.scope_id),
            expectedParentHeadRecordId: parentHead,
            nowMilliseconds: 1_700,
            parent: parentWriter,
        }),
        ScopeQuiescenceError,
    );
    // The reserved child refuses writes, other terminal decisions, and competing merges.
    assert.throws(
        () =>
            emitScopeRecord(store, {
                commandId: "scope-command:child-emit",
                data: { note: "blocked" },
                expectedHeadRecordId: childHead,
                nowMilliseconds: 1_700,
                writer: childWriter,
            }),
        ScopeTerminalConflictError,
    );
    assert.throws(
        () =>
            registerChildScope(store, {
                commandId: "scope-command:child-child",
                expectedHeadRecordId: childHead,
                grant: [],
                nowMilliseconds: 1_700,
                parent: childWriter,
            }),
        ScopeTerminalConflictError,
    );
    releaseScopeWriter(store, { writer: childWriter });
    await assert.rejects(
        discardScope(store, {
            carrier,
            commandId: "scope-command:discard-child",
            expectedHeadRecordId: childHead,
            nowMilliseconds: 1_700,
            parent: parentWriter,
            scopeId: child.scope_id,
        }),
        ScopeTerminalConflictError,
    );
    const lateChild = claimScopeWriter(store, {
        claimId: "claim:late-child",
        nowMilliseconds: 1_700,
        scopeId: child.scope_id,
    });
    await assert.rejects(
        mergeScope(store, {
            ...mergeRequest(world, store),
            child: lateChild,
            commandId: "scope-command:merge-again",
        }),
        ScopeTerminalConflictError,
    );

    // An ancestor discard seals the reserved child, which can then never complete its merge.
    releaseScopeWriter(store, { writer: lateChild });
    releaseScopeWriter(store, { writer: siblingWriter });
    releaseScopeWriter(store, { writer: parentWriter });
    const discarded = await discardScope(store, {
        carrier,
        commandId: "scope-command:discard-parent",
        expectedHeadRecordId: parentHead,
        nowMilliseconds: 1_800,
        parent: rootWriter,
        scopeId: parent.scope_id,
    });
    assert.deepEqual(
        [...discarded.sealed_scope_ids].sort(),
        [parent.scope_id, child.scope_id, sibling.scope_id].sort(),
    );
    // The reserved merge's protected application custody is owned by the discarded subtree too.
    const plan = (
        (store.readRecord(reserved?.terminal?.record_id as string) as { readonly body: unknown })
            .body as {
            readonly world: { readonly application_custody_id: string };
        }
    ).world;
    assert.ok(discarded.cleanup.custody_ids.includes(plan.application_custody_id));
    const sealed = inspectScope(store, child.scope_id);
    assert.equal(sealed?.state, "discarded");
    assert.deepEqual(
        sealed?.history.slice(-3).map((entry) => entry.kind),
        ["merge_cut", "merge_prepared", "discard_decided"],
    );
    store.close();
    using recovered = new SQLiteTraceStore(world.databasePath);
    assert.throws(
        () =>
            claimScopeWriter(recovered, {
                claimId: "claim:after-discard",
                nowMilliseconds: 1_900,
                scopeId: child.scope_id,
            }),
        ScopeTerminalConflictError,
    );
    assert.equal(inspectScope(recovered, root.scope_id)?.state, "open");
    assert.equal(recovered.verifyIntegrity().ok, true);
});

test("a reserved merge refuses contradictory parent custody and resumes from a publication prefix", async (context) => {
    const world = await createNestedWorld(
        context,
        "merge-physical",
        InterruptedAfterReservationStore,
    );
    await writeCustody(world, world.child.world.custody_id, "a.txt", "a\n");
    await writeCustody(world, world.child.world.custody_id, "b.txt", "b\n");
    const request = mergeRequest(world, world.store);
    await assert.rejects(mergeScope(world.store, request), /after merge reservation/u);
    world.store.close();
    using recovered = new SQLiteTraceStore(world.databasePath);
    const writers = reopenWriters(world, recovered, 40_000);
    const retry = {
        ...request,
        child: writers.child,
        nowMilliseconds: 40_000,
        parent: writers.parent,
    };
    const parentCustody = await world.carrier.openCustody(world.parent.world.custody_id);

    // A retry without a carrier cannot publish the reserved world plan.
    const { carrier: _omitted, ...withoutCarrier } = retry;
    await assert.rejects(mergeScope(recovered, withoutCarrier), TypeError);
    // A planned path in a third state is unknown physical state.
    await writeFile(path.join(parentCustody.path, "a.txt"), "third state\n");
    await assert.rejects(mergeScope(recovered, retry), WorldCarrierError);
    // An unplanned path changed outside the merge is refused before anything is written.
    await writeFile(path.join(parentCustody.path, "a.txt"), "a\n");
    await writeFile(path.join(parentCustody.path, "file.txt"), "ambient edit\n");
    await assert.rejects(mergeScope(recovered, retry), WorldCarrierError);
    await assert.rejects(readFile(path.join(parentCustody.path, "b.txt")));
    assert.equal(inspectScope(recovered, world.child.scope_id)?.terminal?.phase, "prepared");
    // Restoring the unplanned path leaves a valid publication prefix that converges.
    await writeFile(path.join(parentCustody.path, "file.txt"), "source\n");
    // An expired parent fence cannot complete the reservation.
    await assert.rejects(
        mergeScope(recovered, { ...retry, nowMilliseconds: 90_000 }),
        ScopeWriterFencedError,
    );
    const merged = await mergeScope(recovered, retry);
    assert.equal(await readFile(path.join(parentCustody.path, "b.txt"), "utf8"), "b\n");
    assert.equal(
        (await world.carrier.verifyCustody(world.parent.world.custody_id)).content_id,
        merged.merged_content_id,
    );
    assert.equal(recovered.verifyIntegrity().ok, true);
});

test("discard recovery converges across decision and cleanup boundaries", async (context) => {
    for (const [label, StoreClass, message] of [
        ["before-decision", InterruptedBeforeDiscardStore, /before discard decision/u],
        ["before-cleanup-record", InterruptedBeforeCleanupRecordStore, /after custody cleanup/u],
    ] as const) {
        const world = await createNestedWorld(context, `discard-${label}`, StoreClass);
        releaseScopeWriter(world.store, { writer: world.childWriter });
        const request = {
            carrier: world.carrier,
            commandId: "scope-command:discard",
            expectedHeadRecordId: headOf(world.store, world.child.scope_id),
            nowMilliseconds: 1_600,
            parent: world.parentWriter,
            scopeId: world.child.scope_id,
        };
        await assert.rejects(discardScope(world.store, request), message);
        world.store.close();
        using recovered = new SQLiteTraceStore(world.databasePath);
        const parent = claimScopeWriter(recovered, {
            claimId: "claim:recovered-parent",
            nowMilliseconds: 40_000,
            scopeId: world.parent.scope_id,
        });
        const discarded = await discardScope(recovered, {
            ...request,
            nowMilliseconds: 40_000,
            parent,
        });
        assert.equal(discarded.cleanup.phase, "cleaned", label);
        await assert.rejects(
            world.carrier.openCustody(world.child.world.custody_id),
            WorldCarrierError,
        );
        assert.equal(recovered.verifyIntegrity().ok, true, label);
    }
});

test("discarding an incomplete fork seals it so the fork can never complete", async (context) => {
    for (const [label, StoreClass, message] of [
        ["never-published", InterruptedAfterForkPreparedStore, /after prepared fork journal/u],
        ["published", InterruptedBeforeForkCompletionStore, /after fork custody/u],
    ] as const) {
        const workspace = await createForkWorkspace(context, `discard-fork-${label}`, StoreClass);
        const origin = await workspace.carrier.snapshot(workspace.source);
        const request = {
            ...forkOptions(workspace, origin.revision_id),
            grant: [bindingGrant(workspace.source)],
        };
        await assert.rejects(forkScope(workspace.store, request), message);
        const [childScopeId] =
            inspectScope(workspace.store, workspace.root.scope_id)?.children ?? [];
        assert.ok(childScopeId);
        const prepared = inspectScope(workspace.store, childScopeId);
        const discarded = await discardScope(workspace.store, {
            carrier: workspace.carrier,
            commandId: "scope-command:discard",
            expectedHeadRecordId: prepared?.head.record_id as string,
            nowMilliseconds: 1_600,
            parent: workspace.rootWriter,
            scopeId: childScopeId,
        });
        assert.deepEqual(discarded.cleanup.custody_ids, [prepared?.world?.custody_id], label);
        assert.equal(discarded.cleanup.phase, "cleaned", label);
        // The identity is tombstoned whether or not custody was ever published.
        await assert.rejects(
            workspace.carrier.openCustody(prepared?.world?.custody_id as string),
            WorldCarrierError,
        );
        using retrying = new SQLiteTraceStore(workspace.databasePath);
        const parent = claimScopeWriter(retrying, {
            claimId: "claim:root",
            nowMilliseconds: 1_600,
            scopeId: workspace.root.scope_id,
        });
        await assert.rejects(
            forkScope(retrying, { ...request, nowMilliseconds: 1_600, parent }),
            ScopeTerminalConflictError,
        );
        const sealed = inspectScope(workspace.store, childScopeId);
        assert.equal(sealed?.state, "discarded", label);
        assert.equal(sealed?.world?.status, "prepared", label);
        assert.equal(workspace.store.verifyIntegrity().ok, true, label);
    }
});
