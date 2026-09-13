import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import {
    AppendIntentConflictError,
    claimScopeWriter,
    emitScopeRecord,
    forkScope,
    inspectScope,
    mergeScope,
    readScopeCommandReceipt,
    registerChildScope,
    releaseScopeWriter,
    ScopeAuthorityError,
    ScopeEvidenceError,
    ScopeHeadConflictError,
    ScopeMergeConflictError,
    ScopeQuiescenceError,
    ScopeTerminalConflictError,
    type ScopeWriter,
    ScopeWriterFencedError,
    SQLiteTraceStore,
    WorldCarrierError,
} from "../../src/index.ts";
import { registerAndClaim, temporaryDatabasePath } from "./fixtures.ts";
import { bindingGrant, createForkWorkspace, forkOptions } from "./fork-fixtures.ts";
import { createNestedWorld, forkChild, headOf, writeCustody } from "./merge-fixtures.ts";

test("a disjoint world merge publishes the child delta into current parent custody once", async (context) => {
    const world = await createNestedWorld(context, "merge-disjoint");
    const { carrier, child, childWriter, parent, parentWriter, store } = world;
    await writeCustody(world, child.world.custody_id, "child.txt", "child\n");
    await writeCustody(world, parent.world.custody_id, "file.txt", "parent edit\n");
    const emitted = emitScopeRecord(store, {
        commandId: "scope-command:child-emit",
        data: { note: "from child" },
        expectedHeadRecordId: headOf(store, child.scope_id),
        nowMilliseconds: 1_600,
        writer: childWriter,
    });
    const parentHead = inspectScope(store, parent.scope_id)?.head;
    const request = {
        carrier,
        child: childWriter,
        commandId: "scope-command:merge",
        expectedChildHeadRecordId: emitted.head.record_id,
        expectedParentHeadRecordId: parentHead?.record_id as string,
        nowMilliseconds: 1_700,
        parent: parentWriter,
    };
    const merged = await mergeScope(store, request);

    assert.deepEqual(merged.contributions, [
        {
            owner_id: child.scope_id,
            owner_ordinal: emitted.head.owner_ordinal,
            record_id: emitted.head.record_id,
        },
    ]);
    assert.equal(merged.parent_scope_id, parent.scope_id);
    assert.equal(merged.child_scope_id, child.scope_id);
    assert.equal(merged.parent_head.owner_ordinal, (parentHead?.owner_ordinal as number) + 1);
    assert.equal(Object.isFrozen(merged), true);
    const plan = merged.world;
    assert.ok(plan);
    assert.equal(plan.origin_revision_id, child.world.base_revision_id);
    assert.equal(plan.parent_custody_id, parent.world.custody_id);
    assert.notEqual(plan.application_custody_id, null);
    const parentCustody = await carrier.openCustody(parent.world.custody_id);
    assert.equal(await readFile(path.join(parentCustody.path, "child.txt"), "utf8"), "child\n");
    assert.equal(
        await readFile(path.join(parentCustody.path, "file.txt"), "utf8"),
        "parent edit\n",
    );
    const publication = await carrier.openRevision(merged.publication_revision_id as string);
    assert.equal(publication.content_id, plan.merged_content_id);
    assert.equal(
        (await carrier.verifyCustody(parent.world.custody_id)).content_id,
        plan.merged_content_id,
    );
    // The protected application custody is discarded once the merge completes.
    await assert.rejects(
        carrier.openCustody(plan.application_custody_id as string),
        WorldCarrierError,
    );

    const parentInspection = inspectScope(store, parent.scope_id);
    assert.deepEqual(parentInspection?.selected_history, merged.contributions);
    assert.deepEqual(parentInspection?.history.at(-1), {
        child_scope_id: child.scope_id,
        command_id: "scope-command:merge",
        kind: "child_merged",
        owner_ordinal: merged.parent_head.owner_ordinal,
        record_id: merged.child_merged_record_id,
    });
    const childInspection = inspectScope(store, child.scope_id);
    assert.equal(childInspection?.state, "merged");
    assert.deepEqual(childInspection?.terminal, {
        command_id: "scope-command:merge",
        kind: "merge",
        phase: "completed",
        record_id: merged.completed_record_id,
    });
    assert.deepEqual(
        childInspection?.history.slice(-3).map((entry) => entry.kind),
        ["merge_cut", "merge_prepared", "merge_completed"],
    );
    assert.deepEqual(childInspection?.head, merged.head);
    assert.deepEqual(readScopeCommandReceipt(store, "scope-command:merge")?.receipt, merged);

    // Exact replay returns the original receipt even after both writers are released.
    releaseScopeWriter(store, { writer: childWriter });
    releaseScopeWriter(store, { writer: parentWriter });
    assert.deepEqual(await mergeScope(store, request), merged);
    await assert.rejects(
        mergeScope(store, { ...request, expectedParentHeadRecordId: emitted.head.record_id }),
        AppendIntentConflictError,
    );
    assert.throws(
        () =>
            claimScopeWriter(store, {
                claimId: "claim:late-child",
                nowMilliseconds: 1_800,
                scopeId: child.scope_id,
            }),
        ScopeTerminalConflictError,
    );
    assert.equal(store.verifyIntegrity().ok, true);

    const archive = store.exportTrace();
    store.close();
    using imported = new SQLiteTraceStore(path.join(world.workspaceRoot, "imported.sqlite"));
    imported.importTrace(archive);
    assert.deepEqual(
        { ...inspectScope(imported, child.scope_id), registered_for_mutation: true },
        childInspection,
    );
    assert.deepEqual(readScopeCommandReceipt(imported, "scope-command:merge")?.receipt, merged);
});

test("trace-only merges integrate selected history without a carrier and exclude common origin", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "merge-trace");
    using store = new SQLiteTraceStore(databasePath);
    const { root, writer: rootWriter } = registerAndClaim(store);
    const inherited = emitScopeRecord(store, {
        commandId: "scope-command:root-emit",
        data: { note: "common origin" },
        expectedHeadRecordId: root.head.record_id,
        nowMilliseconds: 1_100,
        writer: rootWriter,
    });
    const child = registerChildScope(store, {
        commandId: "scope-command:child",
        expectedHeadRecordId: inherited.head.record_id,
        grant: [],
        nowMilliseconds: 1_200,
        parent: rootWriter,
    });
    const childWriter = claimScopeWriter(store, {
        claimId: "claim:child",
        nowMilliseconds: 1_200,
        scopeId: child.scope_id,
    });
    const grandchild = registerChildScope(store, {
        commandId: "scope-command:grandchild",
        expectedHeadRecordId: child.head.record_id,
        grant: [],
        nowMilliseconds: 1_300,
        parent: childWriter,
    });
    const grandchildWriter = claimScopeWriter(store, {
        claimId: "claim:grandchild",
        nowMilliseconds: 1_300,
        scopeId: grandchild.scope_id,
    });
    const emit = (writer: ScopeWriter, commandId: string, note: string) =>
        emitScopeRecord(store, {
            commandId,
            data: { note },
            expectedHeadRecordId: headOf(store, writer.scope_id),
            nowMilliseconds: 1_400,
            writer,
        });
    const nested = emit(grandchildWriter, "scope-command:grandchild-emit", "nested");
    // An open grandchild blocks its parent merge.
    await assert.rejects(
        mergeScope(store, {
            child: childWriter,
            commandId: "scope-command:early-merge",
            expectedChildHeadRecordId: headOf(store, child.scope_id),
            expectedParentHeadRecordId: headOf(store, root.scope_id),
            nowMilliseconds: 1_400,
            parent: rootWriter,
        }),
        ScopeQuiescenceError,
    );
    const nestedMerge = await mergeScope(store, {
        child: grandchildWriter,
        commandId: "scope-command:merge-grandchild",
        expectedChildHeadRecordId: nested.head.record_id,
        expectedParentHeadRecordId: headOf(store, child.scope_id),
        nowMilliseconds: 1_500,
        parent: childWriter,
    });
    assert.equal(nestedMerge.world, null);
    assert.equal(nestedMerge.publication_revision_id, null);
    const first = emit(childWriter, "scope-command:child-emit-1", "same");
    const second = emit(childWriter, "scope-command:child-emit-2", "same");
    const merged = await mergeScope(store, {
        child: childWriter,
        commandId: "scope-command:merge-child",
        expectedChildHeadRecordId: second.head.record_id,
        expectedParentHeadRecordId: headOf(store, root.scope_id),
        nowMilliseconds: 1_600,
        parent: rootWriter,
    });
    const occurrence = (receipt: typeof first) => ({
        owner_id: receipt.scope_id,
        owner_ordinal: receipt.head.owner_ordinal,
        record_id: receipt.head.record_id,
    });
    // The grandchild occurrence arrives once through the child, the common-origin emission is not
    // re-added, and equal data emitted twice stays two distinct occurrences.
    assert.deepEqual(merged.contributions, [
        occurrence(nested),
        occurrence(first),
        occurrence(second),
    ]);
    assert.deepEqual(inspectScope(store, root.scope_id)?.selected_history, [
        occurrence(inherited),
        occurrence(nested),
        occurrence(first),
        occurrence(second),
    ]);
    assert.equal(inspectScope(store, grandchild.scope_id)?.state, "merged");
    // An already merged descendant is never consumed a second time.
    await assert.rejects(
        mergeScope(store, {
            child: grandchildWriter,
            commandId: "scope-command:merge-grandchild-again",
            expectedChildHeadRecordId: headOf(store, grandchild.scope_id),
            expectedParentHeadRecordId: headOf(store, child.scope_id),
            nowMilliseconds: 1_700,
            parent: childWriter,
        }),
        ScopeTerminalConflictError,
    );
    assert.equal(store.verifyIntegrity().ok, true);
});

test("overlapping world changes are refused without consuming or changing either scope", async (context) => {
    const world = await createNestedWorld(context, "merge-overlap");
    const { carrier, child, childWriter, parent, parentWriter, store } = world;
    await writeCustody(world, child.world.custody_id, "file.txt", "child edit\n");
    await writeCustody(world, parent.world.custody_id, "file.txt", "parent edit\n");
    const childHead = headOf(store, child.scope_id);
    const parentHead = headOf(store, parent.scope_id);
    const request = {
        carrier,
        child: childWriter,
        commandId: "scope-command:merge",
        expectedChildHeadRecordId: childHead,
        expectedParentHeadRecordId: parentHead,
        nowMilliseconds: 1_700,
        parent: parentWriter,
    };
    const refusal = await mergeScope(store, request).then(
        () => assert.fail("overlapping merge must be refused"),
        (error: unknown) => error,
    );
    assert.ok(refusal instanceof ScopeMergeConflictError);
    assert.equal(refusal.code, "SCOPE_MERGE_CONFLICT");
    assert.deepEqual(refusal.conflict.conflicts, [
        { candidate_path: "file.txt", current_path: "file.txt", kind: "equal-path" },
    ]);
    assert.equal(headOf(store, child.scope_id), childHead);
    assert.equal(headOf(store, parent.scope_id), parentHead);
    assert.equal(readScopeCommandReceipt(store, "scope-command:merge"), undefined);
    assert.equal(inspectScope(store, child.scope_id)?.terminal, null);
    const parentCustody = await carrier.openCustody(parent.world.custody_id);
    assert.equal(
        await readFile(path.join(parentCustody.path, "file.txt"), "utf8"),
        "parent edit\n",
    );

    // A structural ancestor/descendant overlap is also refused.
    await writeCustody(world, child.world.custody_id, "file.txt", "source\n");
    const childCustody = await carrier.openCustody(child.world.custody_id);
    await mkdir(path.join(childCustody.path, "tree"));
    await writeCustody(world, child.world.custody_id, "tree/leaf.txt", "leaf\n");
    await writeCustody(world, parent.world.custody_id, "file.txt", "source\n");
    await writeCustody(world, parent.world.custody_id, "tree", "not a directory\n");
    const structural = await mergeScope(store, request).then(
        () => assert.fail("structural overlap must be refused"),
        (error: unknown) => error,
    );
    assert.ok(structural instanceof ScopeMergeConflictError);
    assert.ok(structural.conflict.conflicts.length > 0);
    // The unconsumed child keeps writing.
    emitScopeRecord(store, {
        commandId: "scope-command:child-after-refusal",
        data: { note: "still open" },
        expectedHeadRecordId: childHead,
        nowMilliseconds: 1_800,
        writer: childWriter,
    });
    assert.equal(store.verifyIntegrity().ok, true);
});

test("an empty child delta merges history and republishes the unchanged parent content", async (context) => {
    const world = await createNestedWorld(context, "merge-empty");
    const { carrier, child, childWriter, parent, parentWriter, store } = world;
    await writeCustody(world, parent.world.custody_id, "file.txt", "parent only\n");
    const merged = await mergeScope(store, {
        carrier,
        child: childWriter,
        commandId: "scope-command:merge",
        expectedChildHeadRecordId: headOf(store, child.scope_id),
        expectedParentHeadRecordId: headOf(store, parent.scope_id),
        nowMilliseconds: 1_700,
        parent: parentWriter,
    });
    assert.equal(merged.world?.application_custody_id, null);
    assert.equal(merged.world?.merged_revision_id, merged.world?.parent_revision_id);
    assert.deepEqual(merged.contributions, []);
    const verification = await carrier.verifyCustody(parent.world.custody_id);
    assert.equal(verification.content_id, merged.world?.parent_content_id);
});

test("merge admission refuses missing authority, custody, ownership, carriers, and stale evidence", async (context) => {
    const world = await createNestedWorld(context, "merge-refusals");
    const { carrier, child, childWriter, parent, parentWriter, root, rootWriter, store } = world;
    const base = {
        carrier,
        child: childWriter,
        commandId: "scope-command:merge",
        expectedChildHeadRecordId: headOf(store, child.scope_id),
        expectedParentHeadRecordId: headOf(store, parent.scope_id),
        nowMilliseconds: 1_700,
        parent: parentWriter,
    };
    const { carrier: _omitted, ...withoutCarrier } = base;
    await assert.rejects(mergeScope(store, withoutCarrier), TypeError);
    await assert.rejects(mergeScope(store, { ...base, carrier: { ...carrier } }), TypeError);
    await assert.rejects(mergeScope(store, { ...base, child: { ...childWriter } }), TypeError);
    await assert.rejects(mergeScope(store, { ...base, commandId: "" }), TypeError);
    await assert.rejects(mergeScope(store, { ...base, extra: true } as never), TypeError);
    await assert.rejects(
        mergeScope(store, { ...base, expectedChildHeadRecordId: base.expectedParentHeadRecordId }),
        ScopeHeadConflictError,
    );
    await assert.rejects(
        mergeScope(store, { ...base, expectedParentHeadRecordId: base.expectedChildHeadRecordId }),
        ScopeHeadConflictError,
    );
    // The child is not owned by the root.
    await assert.rejects(
        mergeScope(store, {
            ...base,
            expectedParentHeadRecordId: headOf(store, root.scope_id),
            parent: rootWriter,
        }),
        ScopeEvidenceError,
    );
    // A reference-copy child of a trace-only parent has no parent-managed custody to publish into.
    await assert.rejects(
        mergeScope(store, {
            ...base,
            child: parentWriter,
            expectedChildHeadRecordId: headOf(store, parent.scope_id),
            expectedParentHeadRecordId: headOf(store, root.scope_id),
            parent: rootWriter,
        }),
        ScopeEvidenceError,
    );
    // A released parent fence cannot admit the reservation.
    releaseScopeWriter(store, { writer: parentWriter });
    await assert.rejects(mergeScope(store, base), ScopeWriterFencedError);
    assert.equal(readScopeCommandReceipt(store, "scope-command:merge"), undefined);
    // A command identity already naming an emission conflicts.
    const reclaimed = claimScopeWriter(store, {
        claimId: "claim:parent-2",
        nowMilliseconds: 1_700,
        scopeId: parent.scope_id,
    });
    emitScopeRecord(store, {
        commandId: "scope-command:reused",
        data: { note: "emission" },
        expectedHeadRecordId: base.expectedChildHeadRecordId,
        nowMilliseconds: 1_700,
        writer: childWriter,
    });
    await assert.rejects(
        mergeScope(store, {
            ...base,
            commandId: "scope-command:reused",
            expectedChildHeadRecordId: headOf(store, child.scope_id),
            parent: reclaimed,
        }),
        AppendIntentConflictError,
    );
    assert.equal(store.verifyIntegrity().ok, true);
});

test("a world child of a trace-only parent has no parent-managed custody to merge into", async (context) => {
    const workspace = await createForkWorkspace(context, "merge-no-custody");
    const snapshot = await workspace.carrier.snapshot(workspace.source);
    const child = await forkScope(workspace.store, forkOptions(workspace, snapshot.revision_id));
    const childWriter = claimScopeWriter(workspace.store, {
        claimId: "claim:child",
        nowMilliseconds: 1_500,
        scopeId: child.scope_id,
    });
    await assert.rejects(
        mergeScope(workspace.store, {
            carrier: workspace.carrier,
            child: childWriter,
            commandId: "scope-command:merge",
            expectedChildHeadRecordId: headOf(workspace.store, child.scope_id),
            expectedParentHeadRecordId: headOf(workspace.store, workspace.root.scope_id),
            nowMilliseconds: 1_600,
            parent: workspace.rootWriter,
        }),
        ScopeEvidenceError,
    );
    assert.equal(inspectScope(workspace.store, child.scope_id)?.terminal, null);
});

test("a parent without write authority on the bound resource cannot receive a world merge", async (context) => {
    const workspace = await createForkWorkspace(context, "merge-read-only");
    const snapshot = await workspace.carrier.snapshot(workspace.source);
    const parent = await forkScope(workspace.store, {
        ...forkOptions(workspace, snapshot.revision_id),
        grant: [bindingGrant(workspace.source, ["read"])],
    });
    const parentWriter = claimScopeWriter(workspace.store, {
        claimId: "claim:parent",
        nowMilliseconds: 1_500,
        scopeId: parent.scope_id,
    });
    const child = await forkChild(workspace, parent, parentWriter, "scope-command:fork-child");
    const childWriter = claimScopeWriter(workspace.store, {
        claimId: "claim:child",
        nowMilliseconds: 1_500,
        scopeId: child.scope_id,
    });
    await assert.rejects(
        mergeScope(workspace.store, {
            carrier: workspace.carrier,
            child: childWriter,
            commandId: "scope-command:merge",
            expectedChildHeadRecordId: headOf(workspace.store, child.scope_id),
            expectedParentHeadRecordId: headOf(workspace.store, parent.scope_id),
            nowMilliseconds: 1_600,
            parent: parentWriter,
        }),
        ScopeAuthorityError,
    );
});

test("concurrent merges of one child across store connections admit exactly one winner", async (context) => {
    const world = await createNestedWorld(context, "merge-race");
    const { carrier, child, childWriter, parent, parentWriter, store } = world;
    await writeCustody(world, child.world.custody_id, "child.txt", "child\n");
    const childHead = headOf(store, child.scope_id);
    const parentHead = headOf(store, parent.scope_id);
    const attempt = (commandId: string) =>
        mergeScope(store, {
            carrier,
            child: childWriter,
            commandId,
            expectedChildHeadRecordId: childHead,
            expectedParentHeadRecordId: parentHead,
            nowMilliseconds: 1_700,
            parent: parentWriter,
        });
    const outcomes = await Promise.allSettled([
        attempt("scope-command:merge-a"),
        attempt("scope-command:merge-b"),
    ]);
    const fulfilled = outcomes.filter((outcome) => outcome.status === "fulfilled");
    const rejected = outcomes.filter((outcome) => outcome.status === "rejected");
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assert.ok(
        (rejected[0] as PromiseRejectedResult).reason instanceof ScopeTerminalConflictError ||
            (rejected[0] as PromiseRejectedResult).reason instanceof ScopeHeadConflictError,
    );
    using observer = new SQLiteTraceStore(world.databasePath, { readOnly: true });
    assert.equal(
        inspectScope(observer, parent.scope_id)?.history.filter(
            (entry) => entry.kind === "child_merged",
        ).length,
        1,
    );
    assert.equal(inspectScope(observer, child.scope_id)?.state, "merged");
});
