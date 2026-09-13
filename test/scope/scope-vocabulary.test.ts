import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import {
    claimScopeWriter,
    discardScope,
    emitScopeRecord,
    forkScope,
    inspectScope,
    mergeScope,
    projectExecutionRelations,
    projectScopeVocabulary,
    registerChildScope,
    releaseScopeWriter,
    SQLiteTraceStore,
} from "../../src/index.ts";
import { createForkWorkspace, forkOptions } from "./fork-fixtures.ts";
import { createNestedWorld, forkChild, headOf, writeCustody } from "./merge-fixtures.ts";

class InterruptedAfterReservationStore extends SQLiteTraceStore {
    override prepareScopeMerge(
        ...parameters: Parameters<SQLiteTraceStore["prepareScopeMerge"]>
    ): never {
        super.prepareScopeMerge(...parameters);
        throw new Error("interrupted after merge reservation");
    }
}

class InterruptedBeforeForkCompletionStore extends SQLiteTraceStore {
    override completeScopeFork(): never {
        throw new Error("interrupted after fork custody");
    }
}

test("vocabulary maps spawn, adopt, publish, and abandon onto exact scope evidence", async (context) => {
    const world = await createNestedWorld(context, "vocabulary");
    const { carrier, child, childWriter, parent, parentWriter, root, store } = world;
    await writeCustody(world, child.world.custody_id, "adopted.txt", "adopted\n");
    const first = emitScopeRecord(store, {
        commandId: "scope-command:publish-1",
        data: { note: "one" },
        expectedHeadRecordId: headOf(store, child.scope_id),
        nowMilliseconds: 1_600,
        writer: childWriter,
    });
    const second = emitScopeRecord(store, {
        commandId: "scope-command:publish-2",
        data: { note: "two" },
        expectedHeadRecordId: first.head.record_id,
        nowMilliseconds: 1_600,
        writer: childWriter,
    });
    const adopted = await mergeScope(store, {
        carrier,
        child: childWriter,
        commandId: "scope-command:adopt",
        expectedChildHeadRecordId: second.head.record_id,
        expectedParentHeadRecordId: headOf(store, parent.scope_id),
        nowMilliseconds: 1_700,
        parent: parentWriter,
    });
    const abandonedChild = await forkChild(world, parent, parentWriter, "scope-command:abandoned");
    // Abandon without cleanup: no carrier is supplied, so custody remains.
    const abandoned = await discardScope(store, {
        commandId: "scope-command:abandon",
        expectedHeadRecordId: headOf(store, abandonedChild.scope_id),
        nowMilliseconds: 1_700,
        parent: parentWriter,
        scopeId: abandonedChild.scope_id,
    });
    const traceChild = registerChildScope(store, {
        commandId: "scope-command:trace-child",
        expectedHeadRecordId: headOf(store, parent.scope_id),
        grant: [],
        nowMilliseconds: 1_700,
        parent: parentWriter,
    });

    const vocabulary = projectScopeVocabulary(store, parent.scope_id);
    const childRegistered = inspectScope(store, parent.scope_id)?.history.filter(
        (entry) => entry.kind === "child_registered",
    );
    assert.deepEqual(vocabulary, {
        entries: [
            {
                child_scope_id: child.scope_id,
                command_id: "scope-command:fork-child",
                record_id: childRegistered?.[0]?.record_id,
                status: "completed",
                term: "spawn",
                world_capability: "reference_copy",
            },
            {
                child_scope_id: child.scope_id,
                command_id: "scope-command:adopt",
                record_id: adopted.child_merged_record_id,
                status: "completed",
                term: "adopt",
            },
            ...adopted.contributions.map((contribution) => ({
                command_id: "scope-command:adopt",
                contribution,
                record_id: adopted.child_merged_record_id,
                status: "completed",
                term: "publish",
            })),
            {
                child_scope_id: abandonedChild.scope_id,
                command_id: "scope-command:abandoned",
                record_id: childRegistered?.[1]?.record_id,
                status: "completed",
                term: "spawn",
                world_capability: "reference_copy",
            },
            {
                child_scope_id: traceChild.scope_id,
                command_id: "scope-command:trace-child",
                record_id: traceChild.origin.child_registered_record_id,
                status: "completed",
                term: "spawn",
                world_capability: "trace_only",
            },
            {
                child_scope_id: abandonedChild.scope_id,
                cleanup_phase: "decided",
                command_id: "scope-command:abandon",
                record_id: abandoned.decided_record_id,
                status: "completed",
                term: "abandon",
            },
        ],
        scope_id: parent.scope_id,
        vocabulary_version: 1,
    });
    assert.equal(adopted.contributions.length, 2);
    assert.equal(Object.isFrozen(vocabulary?.entries), true);
    // Abandon is not custody deletion and adopt is not user-workspace materialization.
    await carrier.openCustody(abandonedChild.world.custody_id);
    assert.equal(
        await readFile(path.join(world.workspaceRoot, "source", "file.txt"), "utf8"),
        "source\n",
    );
    await assert.rejects(readFile(path.join(world.workspaceRoot, "source", "adopted.txt")));
    // Version-1 relation projections are neither produced nor reinterpreted from scope records.
    const parentHead = inspectScope(store, parent.scope_id)?.head.owner_ordinal as number;
    assert.deepEqual(
        projectExecutionRelations(
            store.readOwnerPrefix(parent.scope_id, parentHead),
            parent.scope_id,
        ),
        [],
    );
    // A root spawn of the parent is reported on the root, and absent scopes project nothing.
    assert.equal(projectScopeVocabulary(store, root.scope_id)?.entries[0]?.term, "spawn");
    assert.equal(projectScopeVocabulary(store, `scope:sha256:${"0".repeat(64)}`), undefined);

    const archive = store.exportTrace();
    store.close();
    using readOnly = new SQLiteTraceStore(world.databasePath, { readOnly: true });
    assert.deepEqual(projectScopeVocabulary(readOnly, parent.scope_id), vocabulary);
    readOnly.close();
    using imported = new SQLiteTraceStore(path.join(world.workspaceRoot, "imported.sqlite"));
    imported.importTrace(archive);
    assert.deepEqual(projectScopeVocabulary(imported, parent.scope_id), vocabulary);
});

test("vocabulary reports in-flight commands as pending and ancestor seals as no abandonment", async (context) => {
    const world = await createNestedWorld(
        context,
        "vocabulary-pending",
        InterruptedAfterReservationStore,
    );
    const { carrier, child, childWriter, parent, parentWriter, root, rootWriter, store } = world;
    await assert.rejects(
        mergeScope(store, {
            carrier,
            child: childWriter,
            commandId: "scope-command:adopt",
            expectedChildHeadRecordId: headOf(store, child.scope_id),
            expectedParentHeadRecordId: headOf(store, parent.scope_id),
            nowMilliseconds: 1_700,
            parent: parentWriter,
        }),
        /after merge reservation/u,
    );
    const reserved = inspectScope(store, child.scope_id);
    assert.deepEqual(projectScopeVocabulary(store, parent.scope_id)?.entries.at(-1), {
        child_scope_id: child.scope_id,
        command_id: "scope-command:adopt",
        record_id: reserved?.terminal?.record_id,
        status: "pending",
        term: "adopt",
    });

    releaseScopeWriter(store, { writer: childWriter });
    releaseScopeWriter(store, { writer: parentWriter });
    await discardScope(store, {
        carrier,
        commandId: "scope-command:abandon-parent",
        expectedHeadRecordId: headOf(store, parent.scope_id),
        nowMilliseconds: 1_800,
        parent: rootWriter,
        scopeId: parent.scope_id,
    });
    assert.deepEqual(
        projectScopeVocabulary(store, root.scope_id)?.entries.map((entry) => entry.term),
        ["spawn", "abandon"],
    );
    // The child was sealed by its parent's abandonment, not abandoned by the parent.
    assert.deepEqual(
        projectScopeVocabulary(store, parent.scope_id)?.entries.map((entry) => entry.term),
        ["spawn"],
    );

    const pendingFork = await createForkWorkspace(
        context,
        "vocabulary-fork",
        InterruptedBeforeForkCompletionStore,
    );
    const origin = await pendingFork.carrier.snapshot(pendingFork.source);
    await assert.rejects(
        forkScope(pendingFork.store, forkOptions(pendingFork, origin.revision_id)),
        /after fork custody/u,
    );
    assert.equal(
        projectScopeVocabulary(pendingFork.store, pendingFork.root.scope_id)?.entries[0]?.status,
        "pending",
    );
    const claimed = claimScopeWriter(pendingFork.store, {
        claimId: "claim:root",
        nowMilliseconds: 1_600,
        scopeId: pendingFork.root.scope_id,
    });
    assert.equal(claimed.scope_id, pendingFork.root.scope_id);
});
