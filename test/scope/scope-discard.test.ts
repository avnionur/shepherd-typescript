import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import {
    AppendIntentConflictError,
    claimScopeWriter,
    discardScope,
    emitScopeRecord,
    inspectScope,
    mergeScope,
    readScopeCommandReceipt,
    registerChildScope,
    releaseScopeWriter,
    ScopeEvidenceError,
    ScopeHeadConflictError,
    ScopeQuiescenceError,
    ScopeTerminalConflictError,
    ScopeWriterFencedError,
    SQLiteTraceStore,
    WorldCarrierError,
} from "../../src/index.ts";
import { registerAndClaim, temporaryDatabasePath } from "./fixtures.ts";
import { createNestedWorld, forkChild, headOf, writeCustody } from "./merge-fixtures.ts";

test("discarding a trace-only child seals it while the parent keeps its current state", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "discard-trace");
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
    const childEmission = emitScopeRecord(store, {
        commandId: "scope-command:child-emit",
        data: { note: "discarded work" },
        expectedHeadRecordId: child.head.record_id,
        nowMilliseconds: 1_200,
        writer: childWriter,
    });
    // The parent advances after the fork; discard must not roll it back.
    const parentEmission = emitScopeRecord(store, {
        commandId: "scope-command:root-emit",
        data: { note: "kept" },
        expectedHeadRecordId: child.parent_head.record_id,
        nowMilliseconds: 1_200,
        writer: rootWriter,
    });
    const request = {
        commandId: "scope-command:discard",
        expectedHeadRecordId: childEmission.head.record_id,
        nowMilliseconds: 1_300,
        parent: rootWriter,
        scopeId: child.scope_id,
    };
    await assert.rejects(discardScope(store, request), ScopeQuiescenceError);
    releaseScopeWriter(store, { writer: childWriter });
    const parentBefore = inspectScope(store, root.scope_id);
    const discarded = await discardScope(store, request);

    assert.deepEqual(discarded.sealed_scope_ids, [child.scope_id]);
    assert.equal(discarded.parent_scope_id, root.scope_id);
    assert.deepEqual(discarded.cleanup.custody_ids, []);
    assert.equal(discarded.cleanup.phase, "cleaned");
    assert.notEqual(discarded.cleanup.cleaned_record_id, null);
    assert.equal(Object.isFrozen(discarded), true);
    assert.deepEqual(inspectScope(store, root.scope_id), parentBefore);
    assert.equal(inspectScope(store, root.scope_id)?.head.record_id, parentEmission.head.record_id);
    const childInspection = inspectScope(store, child.scope_id);
    assert.equal(childInspection?.state, "discarded");
    assert.deepEqual(childInspection?.terminal, {
        command_id: "scope-command:discard",
        kind: "discard",
        phase: "cleaned",
        record_id: discarded.cleanup.cleaned_record_id,
    });
    assert.deepEqual(
        childInspection?.history.slice(-2).map((entry) => entry.kind),
        ["discard_decided", "discard_cleaned"],
    );
    // Audit history is retained: the discarded emission stays readable.
    assert.ok(store.readRecord(childEmission.head.record_id));
    assert.deepEqual(readScopeCommandReceipt(store, "scope-command:discard")?.receipt, discarded);

    // Repeating the completed discard is idempotent without any live authority.
    releaseScopeWriter(store, { writer: rootWriter });
    assert.deepEqual(await discardScope(store, request), discarded);
    await assert.rejects(
        discardScope(store, { ...request, expectedHeadRecordId: child.head.record_id }),
        AppendIntentConflictError,
    );
    assert.throws(
        () =>
            claimScopeWriter(store, {
                claimId: "claim:late",
                nowMilliseconds: 1_400,
                scopeId: child.scope_id,
            }),
        ScopeTerminalConflictError,
    );
    assert.throws(
        () =>
            emitScopeRecord(store, {
                commandId: "scope-command:late-emit",
                data: { note: "late" },
                expectedHeadRecordId: headOf(store, child.scope_id),
                nowMilliseconds: 1_400,
                writer: childWriter,
            }),
        ScopeTerminalConflictError,
    );
    assert.equal(store.verifyIntegrity().ok, true);
});

test("discarding a world subtree seals open scopes and cleans every proven-owned custody", async (context) => {
    const world = await createNestedWorld(context, "discard-world");
    const { carrier, child, childWriter, parent, parentWriter, root, rootWriter, store } = world;
    await writeCustody(world, parent.world.custody_id, "file.txt", "parent current\n");
    await writeCustody(world, child.world.custody_id, "child.txt", "child\n");
    // Grandchildren of the discarded parent: one merged, one discarded, one still open.
    const mergedChild = await forkChild(world, parent, parentWriter, "scope-command:fork-merged");
    const mergedWriter = claimScopeWriter(store, {
        claimId: "claim:merged",
        nowMilliseconds: 1_500,
        scopeId: mergedChild.scope_id,
    });
    await mergeScope(store, {
        carrier,
        child: mergedWriter,
        commandId: "scope-command:merge-grandchild",
        expectedChildHeadRecordId: headOf(store, mergedChild.scope_id),
        expectedParentHeadRecordId: headOf(store, parent.scope_id),
        nowMilliseconds: 1_600,
        parent: parentWriter,
    });
    const discardedChild = await forkChild(
        world,
        parent,
        parentWriter,
        "scope-command:fork-discarded",
    );
    await discardScope(store, {
        carrier,
        commandId: "scope-command:discard-grandchild",
        expectedHeadRecordId: headOf(store, discardedChild.scope_id),
        nowMilliseconds: 1_600,
        parent: parentWriter,
        scopeId: discardedChild.scope_id,
    });
    releaseScopeWriter(store, { writer: childWriter });
    releaseScopeWriter(store, { writer: parentWriter });
    const rootBefore = inspectScope(store, root.scope_id);

    const discarded = await discardScope(store, {
        carrier,
        commandId: "scope-command:discard-parent",
        expectedHeadRecordId: headOf(store, parent.scope_id),
        nowMilliseconds: 1_700,
        parent: rootWriter,
        scopeId: parent.scope_id,
    });
    assert.deepEqual(discarded.sealed_scope_ids, [parent.scope_id, child.scope_id]);
    assert.deepEqual(
        discarded.cleanup.custody_ids,
        [
            parent.world.custody_id,
            child.world.custody_id,
            mergedChild.world.custody_id,
            discardedChild.world.custody_id,
        ].sort(),
    );
    assert.equal(discarded.cleanup.phase, "cleaned");
    for (const custodyId of discarded.cleanup.custody_ids) {
        await assert.rejects(carrier.openCustody(custodyId), WorldCarrierError);
    }
    // Ancestors keep their current state and the user binding is untouched.
    assert.deepEqual(inspectScope(store, root.scope_id), rootBefore);
    assert.equal(
        await readFile(path.join(world.workspaceRoot, "source", "file.txt"), "utf8"),
        "source\n",
    );
    assert.equal(inspectScope(store, child.scope_id)?.state, "discarded");
    assert.deepEqual(inspectScope(store, child.scope_id)?.terminal, {
        command_id: "scope-command:discard-parent",
        kind: "discard",
        phase: "decided",
        record_id: headOf(store, child.scope_id),
    });
    assert.equal(inspectScope(store, mergedChild.scope_id)?.state, "merged");
    assert.equal(inspectScope(store, discardedChild.scope_id)?.state, "discarded");
    assert.equal(store.verifyIntegrity().ok, true);
});

test("logical discard completes without a carrier and a later retry resumes cleanup", async (context) => {
    const world = await createNestedWorld(context, "discard-cleanup");
    const { carrier, child, childWriter, parent, parentWriter, store } = world;
    releaseScopeWriter(store, { writer: childWriter });
    const request = {
        commandId: "scope-command:discard",
        expectedHeadRecordId: headOf(store, child.scope_id),
        nowMilliseconds: 1_600,
        parent: parentWriter,
        scopeId: child.scope_id,
    };
    const logical = await discardScope(store, request);
    assert.equal(logical.cleanup.phase, "decided");
    assert.equal(logical.cleanup.cleaned_record_id, null);
    assert.deepEqual(logical.cleanup.custody_ids, [child.world.custody_id]);
    assert.equal(inspectScope(store, child.scope_id)?.state, "discarded");
    // Custody still exists until cleanup runs.
    await carrier.openCustody(child.world.custody_id);
    // A partially cleaned identity converges: the carrier discard is idempotent.
    await carrier.discard(child.world.custody_id);
    // Cleanup progress requires the parent's current fence.
    releaseScopeWriter(store, { writer: parentWriter });
    await assert.rejects(discardScope(store, { ...request, carrier }), ScopeWriterFencedError);
    const reclaimed = claimScopeWriter(store, {
        claimId: "claim:parent-2",
        nowMilliseconds: 1_700,
        scopeId: parent.scope_id,
    });
    const cleaned = await discardScope(store, {
        ...request,
        carrier,
        nowMilliseconds: 1_700,
        parent: reclaimed,
    });
    assert.equal(cleaned.cleanup.phase, "cleaned");
    assert.equal(cleaned.decided_record_id, logical.decided_record_id);
    assert.deepEqual(cleaned.head, logical.head);
    assert.equal(inspectScope(store, child.scope_id)?.terminal?.phase, "cleaned");
    assert.equal(store.verifyIntegrity().ok, true);
});

test("discard refuses roots, foreign parents, terminal scopes, reserved merges, and stale evidence", async (context) => {
    const world = await createNestedWorld(context, "discard-refusals");
    const { carrier, child, childWriter, parent, parentWriter, root, rootWriter, store } = world;
    releaseScopeWriter(store, { writer: childWriter });
    const base = {
        carrier,
        commandId: "scope-command:discard",
        expectedHeadRecordId: headOf(store, child.scope_id),
        nowMilliseconds: 1_600,
        parent: parentWriter,
        scopeId: child.scope_id,
    };
    await assert.rejects(discardScope(store, { ...base, carrier: { ...carrier } }), TypeError);
    await assert.rejects(discardScope(store, { ...base, scopeId: "scope:bad" }), TypeError);
    await assert.rejects(discardScope(store, { ...base, parent: { ...parentWriter } }), TypeError);
    // A root has no owning parent authority.
    await assert.rejects(
        discardScope(store, {
            ...base,
            expectedHeadRecordId: headOf(store, root.scope_id),
            parent: rootWriter,
            scopeId: root.scope_id,
        }),
        ScopeEvidenceError,
    );
    // The grandchild is not owned by the root, and an unreleased parent claim blocks its subtree.
    await assert.rejects(discardScope(store, { ...base, parent: rootWriter }), ScopeEvidenceError);
    await assert.rejects(
        discardScope(store, {
            ...base,
            expectedHeadRecordId: headOf(store, parent.scope_id),
            parent: rootWriter,
            scopeId: parent.scope_id,
        }),
        ScopeQuiescenceError,
    );
    await assert.rejects(
        discardScope(store, { ...base, expectedHeadRecordId: headOf(store, parent.scope_id) }),
        ScopeHeadConflictError,
    );
    // A reused emission command identity conflicts.
    emitScopeRecord(store, {
        commandId: "scope-command:reused",
        data: { note: "emission" },
        expectedHeadRecordId: headOf(store, parent.scope_id),
        nowMilliseconds: 1_600,
        writer: parentWriter,
    });
    await assert.rejects(
        discardScope(store, { ...base, commandId: "scope-command:reused" }),
        AppendIntentConflictError,
    );
    // Discard after merge is refused.
    const reclaimedChild = claimScopeWriter(store, {
        claimId: "claim:child-2",
        nowMilliseconds: 1_600,
        scopeId: child.scope_id,
    });
    await mergeScope(store, {
        carrier,
        child: reclaimedChild,
        commandId: "scope-command:merge",
        expectedChildHeadRecordId: headOf(store, child.scope_id),
        expectedParentHeadRecordId: headOf(store, parent.scope_id),
        nowMilliseconds: 1_600,
        parent: parentWriter,
    });
    await assert.rejects(
        discardScope(store, { ...base, expectedHeadRecordId: headOf(store, child.scope_id) }),
        ScopeTerminalConflictError,
    );
    assert.equal(store.verifyIntegrity().ok, true);
});

test("discard refuses a subtree beyond the configured bound", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "discard-bound");
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
    let head = child.head.record_id;
    for (let index = 0; index < 256; index += 1) {
        head = registerChildScope(store, {
            commandId: `scope-command:grandchild-${index}`,
            expectedHeadRecordId: head,
            grant: [],
            nowMilliseconds: 1_100,
            parent: childWriter,
        }).parent_head.record_id;
    }
    releaseScopeWriter(store, { writer: childWriter });
    await assert.rejects(
        discardScope(store, {
            commandId: "scope-command:discard",
            expectedHeadRecordId: head,
            nowMilliseconds: 1_200,
            parent: rootWriter,
            scopeId: child.scope_id,
        }),
        ScopeEvidenceError,
    );
    assert.equal(inspectScope(store, child.scope_id)?.state, "open");
});

test("a pending descendant cleanup blocks consuming its parent, and a sealed parent defers cleanup", async (context) => {
    const world = await createNestedWorld(context, "discard-pending-cleanup");
    const { carrier, child, childWriter, parent, parentWriter, root, rootWriter, store } = world;
    const grandchild = await forkChild(world, child, childWriter, "scope-command:fork-grandchild");
    const request = {
        commandId: "scope-command:discard-grandchild",
        expectedHeadRecordId: headOf(store, grandchild.scope_id),
        nowMilliseconds: 1_600,
        parent: childWriter,
        scopeId: grandchild.scope_id,
    };
    const logical = await discardScope(store, request);
    assert.equal(logical.cleanup.phase, "decided");
    // The child cannot be merged while its discarded child's cleanup is still pending.
    await assert.rejects(
        mergeScope(store, {
            carrier,
            child: childWriter,
            commandId: "scope-command:merge-child",
            expectedChildHeadRecordId: headOf(store, child.scope_id),
            expectedParentHeadRecordId: headOf(store, parent.scope_id),
            nowMilliseconds: 1_600,
            parent: parentWriter,
        }),
        ScopeQuiescenceError,
    );
    // Sealing the child by an ancestor discard moves cleanup ownership to that ancestor.
    releaseScopeWriter(store, { writer: childWriter });
    releaseScopeWriter(store, { writer: parentWriter });
    const ancestor = await discardScope(store, {
        carrier,
        commandId: "scope-command:discard-parent",
        expectedHeadRecordId: headOf(store, parent.scope_id),
        nowMilliseconds: 1_700,
        parent: rootWriter,
        scopeId: parent.scope_id,
    });
    assert.ok(ancestor.cleanup.custody_ids.includes(grandchild.world.custody_id));
    assert.equal(ancestor.cleanup.phase, "cleaned");
    // Retrying the descendant discard returns its decided receipt instead of throwing.
    assert.deepEqual(await discardScope(store, { ...request, carrier }), logical);
    assert.equal(inspectScope(store, root.scope_id)?.state, "open");
    // A stale child handle is refused before any carrier work.
    await assert.rejects(
        mergeScope(store, {
            carrier,
            child: childWriter,
            commandId: "scope-command:merge-sealed",
            expectedChildHeadRecordId: headOf(store, child.scope_id),
            expectedParentHeadRecordId: headOf(store, parent.scope_id),
            nowMilliseconds: 1_800,
            parent: parentWriter,
        }),
        ScopeTerminalConflictError,
    );
});

test("merge and discard racing across store connections admit exactly one terminal decision", async (context) => {
    const world = await createNestedWorld(context, "discard-race");
    const { carrier, child, parent, store } = world;
    releaseScopeWriter(store, { writer: world.childWriter });
    using other = new SQLiteTraceStore(world.databasePath);
    const childWriter = claimScopeWriter(store, {
        claimId: "claim:race-child",
        nowMilliseconds: 1_600,
        scopeId: child.scope_id,
    });
    const otherParent = claimScopeWriter(other, {
        claimId: "claim:parent",
        nowMilliseconds: 1_600,
        scopeId: parent.scope_id,
    });
    const childHead = headOf(store, child.scope_id);
    const outcomes = await Promise.allSettled([
        mergeScope(store, {
            carrier,
            child: childWriter,
            commandId: "scope-command:race-merge",
            expectedChildHeadRecordId: childHead,
            expectedParentHeadRecordId: headOf(store, parent.scope_id),
            nowMilliseconds: 1_600,
            parent: world.parentWriter,
        }),
        discardScope(other, {
            carrier,
            commandId: "scope-command:race-discard",
            expectedHeadRecordId: childHead,
            nowMilliseconds: 1_600,
            parent: otherParent,
            scopeId: child.scope_id,
        }),
    ]);
    assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
    const state = inspectScope(store, child.scope_id)?.state;
    assert.ok(state === "merged" || state === "discarded");
    assert.equal(store.verifyIntegrity().ok, true);
});
