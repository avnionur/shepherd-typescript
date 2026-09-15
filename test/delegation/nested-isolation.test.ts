import assert from "node:assert/strict";
import { test } from "node:test";

import { canonical, createDelegationOutputDigest } from "../../src/delegation/records.ts";
import {
    acceptChildRunResult,
    type ChildRunHandle,
    type ChildRunProgram,
    DelegationAuthorityError,
    DelegationEvidenceError,
    type DelegationTreeProjection,
    discardChildRun,
    inspectChildRun,
    type OwnerRecord,
    openChildRun,
    projectChildRunResult,
    projectDelegationTree,
    type RunBudgetDefinition,
    runChildRun,
    type ScopeResourceGrant,
    SQLiteTraceStore,
    schema,
} from "../../src/index.ts";
import { echoTask, grantOf, providerFor, summaryTask, temporaryDatabasePath } from "./fixtures.ts";

const ROOT = "supervisor:root";
const CHILD = "supervisor:child";
const CEILING = [grantOf(["read", "write"]), grantOf(["read"], "repo:docs")];
const ROOT_BUDGET: RunBudgetDefinition = { maxTurns: 6 };
const CHILD_BUDGET: RunBudgetDefinition = { maxTurns: 4 };

type Grandchildren = {
    accepted: ChildRunHandle | null;
    discarded: ChildRunHandle | null;
    refusals: unknown[];
};

function includes(
    ceiling: readonly ScopeResourceGrant[],
    effective: readonly ScopeResourceGrant[],
): boolean {
    return effective.every((grant) => {
        const above = ceiling.find((entry) => entry.resource_id === grant.resource_id);
        return above !== undefined && grant.atoms.every((atom) => above.atoms.includes(atom));
    });
}

function budgetIncludes(ceiling: RunBudgetDefinition, budget: RunBudgetDefinition): boolean {
    return Object.entries(ceiling).every(
        ([metric, limit]) =>
            (budget as Record<string, number>)[metric] !== undefined &&
            ((budget as Record<string, number>)[metric] as number) <= (limit as number),
    );
}

/** Child program: a meta-agent that opens two grandchildren, keeps one, and combines the result. */
function combining(store: SQLiteTraceStore, prefix: string, seen: Grandchildren): ChildRunProgram {
    return async ({ handle, input }) => {
        const topic = (input as { readonly topic: string }).topic;
        const kept = openChildRun(store, {
            budget: { maxTurns: 2 },
            commandId: `${prefix}:kept`,
            grant: [grantOf(["read"])],
            input: topic,
            parent: handle,
            supervisorId: CHILD,
            task: echoTask,
        });
        const dropped = openChildRun(store, {
            budget: { maxTurns: 1 },
            commandId: `${prefix}:dropped`,
            grant: [],
            input: { topic },
            parent: handle,
            supervisorId: CHILD,
            task: summaryTask,
        });
        for (const beyond of [
            { grant: [grantOf(["read"], "repo:docs")] },
            { budget: { maxTurns: (CHILD_BUDGET.maxTurns as number) + 1 } },
        ]) {
            try {
                openChildRun(store, {
                    budget: { maxTurns: 1 },
                    commandId: `${prefix}:beyond`,
                    grant: [],
                    input: topic,
                    parent: handle,
                    supervisorId: CHILD,
                    task: echoTask,
                    ...beyond,
                });
            } catch (error) {
                seen.refusals.push(error);
            }
        }
        await runChildRun(store, {
            handle: kept.handle,
            provider: providerFor(echoTask, topic, `${topic}!`),
        });
        await runChildRun(store, {
            handle: dropped.handle,
            program: () => ({ text: `discarded draft about ${topic}` }),
        });
        acceptChildRunResult(store, {
            commandId: `${prefix}:accept-kept`,
            handle: kept.handle,
            supervisorId: CHILD,
        });
        discardChildRun(store, {
            commandId: `${prefix}:discard-dropped`,
            handle: dropped.handle,
            reason: "the echo was enough",
            supervisorId: CHILD,
        });
        seen.accepted = kept.handle;
        seen.discarded = dropped.handle;
        const threaded = projectChildRunResult(store, kept.handle.handle_id, {
            schema: schema.string(),
        });
        return { text: threaded.value as string };
    };
}

function viewing(
    store: SQLiteTraceStore,
    owners: Readonly<Record<string, readonly OwnerRecord[]>>,
): SQLiteTraceStore {
    return new Proxy(store, {
        get(target, key) {
            if (key === "readOwner") {
                return (ownerId: string) => owners[ownerId] ?? target.readOwner(ownerId);
            }
            const value = Reflect.get(target, key);
            return typeof value === "function" ? value.bind(target) : value;
        },
    });
}

function forged(
    source: readonly OwnerRecord[],
    index: number,
    body: Record<string, unknown>,
): OwnerRecord[] {
    return source.map((record, position) =>
        position === index ? ({ ...record, body } as OwnerRecord) : record,
    );
}

function ownedRecordIds(store: SQLiteTraceStore, handle: ChildRunHandle): readonly string[] {
    return [...store.readOwner(handle.handle_id), ...store.readOwner(handle.child_run_id)].map(
        (record) => record.envelope.record_id,
    );
}

test("a program-serviced child opens isolated grandchildren whose accepted value threads upward", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "nested");
    using store = new SQLiteTraceStore(databasePath);
    const child = openChildRun(store, {
        budget: CHILD_BUDGET,
        commandId: "nested:child",
        grant: [grantOf(["read", "write"])],
        input: { topic: "release" },
        parent: { budget: ROOT_BUDGET, ceiling: CEILING, kind: "root" },
        supervisorId: ROOT,
        task: summaryTask,
    });
    const seen: Grandchildren = { accepted: null, discarded: null, refusals: [] };
    const ran = await runChildRun(store, {
        handle: child.handle,
        program: combining(store, "nested:child", seen),
    });
    assert.equal(ran.inspection.completion?.status, "finished");
    const accepted = acceptChildRunResult(store, {
        commandId: "nested:accept-child",
        handle: child.handle,
        supervisorId: ROOT,
    });
    assert.equal(accepted.inspection.status, "accepted");
    const kept = seen.accepted as ChildRunHandle;
    const dropped = seen.discarded as ChildRunHandle;
    assert.ok(kept !== null && dropped !== null);

    // Authority and budget: grandchild effective ⊆ child effective ⊆ root ceiling.
    assert.equal(seen.refusals.length, 2);
    for (const refusal of seen.refusals) {
        assert.ok(refusal instanceof DelegationAuthorityError);
    }
    for (const grandchild of [kept, dropped]) {
        const inspection = inspectChildRun(store, grandchild.handle_id);
        assert.equal(inspection.depth, 2);
        assert.ok(includes(child.handle.authority.effective, inspection.authority.effective));
        assert.ok(includes(CEILING, child.handle.authority.effective));
        assert.deepEqual(inspection.authority.ceiling, child.handle.authority.effective);
        assert.ok(budgetIncludes(CHILD_BUDGET, inspection.budget.effective));
        assert.ok(budgetIncludes(ROOT_BUDGET, CHILD_BUDGET));
        assert.deepEqual(inspection.budget.ceiling, CHILD_BUDGET);
        assert.equal(store.readOwner(`delegation:sha256:${"0".repeat(64)}`).length, 0);
    }
    assert.ok(
        !includes(child.handle.authority.effective, [grantOf(["read"], "repo:docs")]),
        "the child never held the docs resource the refused grandchild asked for",
    );

    // Trees: the root sees exactly the child; the child sees exactly its grandchildren.
    const rootTree = projectDelegationTree(store, { kind: "supervisor", supervisorId: ROOT });
    assert.deepEqual(rootTree.root, { kind: "supervisor", supervisorId: ROOT });
    assert.equal(rootTree.entries.length, 1);
    const [rootEntry] = rootTree.entries;
    assert.equal(rootEntry?.handle_id, child.handle.handle_id);
    assert.equal(rootEntry?.status, "accepted");
    assert.equal(rootEntry?.depth, 1);
    assert.equal(rootEntry?.supervisor_id, ROOT);
    assert.deepEqual(rootEntry?.authority, child.handle.authority);
    assert.deepEqual(rootEntry?.budget, child.handle.budget);
    assert.deepEqual(rootEntry?.result.value, { text: "release!" });
    const childTree = projectDelegationTree(store, {
        handleId: child.handle.handle_id,
        kind: "handle",
    });
    assert.deepEqual(
        childTree.entries.map((entry) => entry.handle_id),
        [kept.handle_id, dropped.handle_id].sort(),
    );
    const keptEntry = childTree.entries.find((entry) => entry.handle_id === kept.handle_id);
    const droppedEntry = childTree.entries.find((entry) => entry.handle_id === dropped.handle_id);
    assert.equal(keptEntry?.status, "accepted");
    assert.equal(keptEntry?.result.value, "release!");
    assert.equal(keptEntry?.result.output_id, createDelegationOutputDigest("release!"));
    assert.equal(keptEntry?.supervisor_id, CHILD);
    assert.equal(keptEntry?.depth, 2);
    assert.equal(droppedEntry?.status, "discarded");
    assert.equal(droppedEntry?.result.value, null);
    assert.equal(droppedEntry?.result.output_id, null);
    assert.equal(droppedEntry?.result.child_outcome_record_id, null);
    assert.notEqual(droppedEntry?.result.decision_record_id, null);
    assert.deepEqual(
        projectDelegationTree(store, { kind: "supervisor", supervisorId: CHILD }).entries,
        [],
    );
    assert.deepEqual(
        projectDelegationTree(store, { handleId: kept.handle_id, kind: "handle" }).entries,
        [],
    );
    assert.equal(Object.isFrozen(rootTree), true);
    assert.equal(Object.isFrozen(rootTree.entries), true);
    assert.equal(Object.isFrozen(rootEntry), true);

    // Isolation: grandchild records live only on their own owner paths, and nothing on the
    // child's handle or child run path cites or names them.
    const grandchildIds = new Set([
        kept.handle_id,
        kept.child_run_id,
        dropped.handle_id,
        dropped.child_run_id,
        ...ownedRecordIds(store, kept),
        ...ownedRecordIds(store, dropped),
    ]);
    assert.ok(grandchildIds.size >= 12);
    for (const grandchild of [kept, dropped]) {
        for (const recordId of ownedRecordIds(store, grandchild)) {
            const owners = store.readRecord(recordId)?.views.map((view) => view.owner_id) ?? [];
            assert.ok(owners.length > 0);
            for (const owner of owners) {
                assert.ok([grandchild.handle_id, grandchild.child_run_id].includes(owner));
            }
        }
    }
    const childRecords = [
        ...store.readOwner(child.handle.handle_id),
        ...store.readOwner(child.handle.child_run_id),
    ];
    assert.ok(childRecords.length >= 5);
    for (const record of childRecords) {
        for (const cause of record.envelope.caused_by_record_ids) {
            assert.ok(!grandchildIds.has(cause));
        }
        const text = canonical(record.body);
        for (const identity of grandchildIds) {
            assert.ok(!text.includes(identity), `${record.envelope.schema_ref} names ${identity}`);
        }
        assert.ok(!text.includes("discarded draft"));
    }

    // Threading: the root's projected value is the child's accepted output, which embeds only
    // the accepted grandchild's value.
    const rootResult = projectChildRunResult(store, child.handle.handle_id, {
        schema: schema.object({ text: schema.string() }),
    });
    assert.deepEqual(rootResult.value, { text: "release!" });
    assert.equal(rootResult.status, "accepted");
    assert.equal(rootResult.output_id, accepted.inspection.decision?.output_id);
    assert.equal(rootResult.decision_record_id, accepted.record_id);
    assert.equal(
        rootResult.child_outcome_record_id,
        accepted.inspection.decision?.child_outcome_record_id,
    );
    assert.deepEqual(rootResult.task, child.inspection.task);
    const keptResult = projectChildRunResult(store, kept.handle_id, { schema: schema.string() });
    assert.deepEqual(rootResult.value, { text: keptResult.value });
    assert.equal(projectChildRunResult(store, dropped.handle_id).value, null);
    assert.ok(!canonical(rootResult.value).includes("discarded draft"));
    assert.equal(Object.isFrozen(rootResult), true);

    // Forged accept evidence is refused by the projection.
    const childId = child.handle.handle_id;
    const childRunId = child.handle.child_run_id;
    const handleRecords = store.readOwner(childId);
    const decision = handleRecords[2] as OwnerRecord;
    assert.equal(decision.envelope.schema_ref, "shepherd.delegation.decision.v1");
    const runRecords = store.readOwner(childRunId);
    const outcomeIndex = runRecords.findIndex(
        (record) => record.body.outcome_version !== undefined,
    );
    const outcome = runRecords[outcomeIndex] as OwnerRecord;
    const terminalIndex = runRecords.findIndex(
        (record) =>
            (record.body.payload as { readonly outputs?: unknown } | undefined)?.outputs !==
            undefined,
    );
    const terminal = runRecords[terminalIndex] as OwnerRecord;
    const terminalPayload = terminal.body.payload as Record<string, unknown>;
    const keptOutcome = inspectChildRun(store, kept.handle_id).child?.outcome?.record_id as string;
    const forgedOutputId = viewing(store, {
        [childId]: forged(handleRecords, 2, {
            ...decision.body,
            output_id: createDelegationOutputDigest({ text: "forged" }),
        }),
    });
    assert.throws(() => projectChildRunResult(forgedOutputId, childId), DelegationEvidenceError);
    const swappedOutcome = viewing(store, {
        [childId]: forged(handleRecords, 2, {
            ...decision.body,
            child_outcome_record_id: keptOutcome,
        }),
    });
    assert.throws(() => projectChildRunResult(swappedOutcome, childId), DelegationEvidenceError);
    const invalidOutcome = viewing(store, {
        [childId]: forged(handleRecords, 2, {
            ...decision.body,
            output_id: createDelegationOutputDigest(42),
        }),
        [childRunId]: forged(
            forged(runRecords, outcomeIndex, {
                ...outcome.body,
                outcome: { ...(outcome.body.outcome as Record<string, unknown>), value: 42 },
            }),
            terminalIndex,
            { ...terminal.body, payload: { ...terminalPayload, outputs: { value: 42 } } },
        ),
    });
    assert.equal(inspectChildRun(invalidOutcome, childId).status, "accepted");
    assert.throws(
        () => projectChildRunResult(invalidOutcome, childId),
        (error: unknown) =>
            error instanceof DelegationEvidenceError &&
            /fails the retained output schema/u.test(error.message),
    );
    assert.throws(
        () => projectDelegationTree(invalidOutcome, { kind: "supervisor", supervisorId: ROOT }),
        DelegationEvidenceError,
    );
    assert.deepEqual(projectChildRunResult(viewing(store, {}), childId), rootResult);

    // Discarding a child removes its value and everything threaded through it from the root's
    // projection, while the grandchild it accepted stays accepted on its own handle.
    const second = openChildRun(store, {
        budget: CHILD_BUDGET,
        commandId: "nested:second",
        grant: [grantOf(["read", "write"])],
        input: { topic: "docs" },
        parent: { budget: ROOT_BUDGET, ceiling: CEILING, kind: "root" },
        supervisorId: ROOT,
        task: summaryTask,
    });
    const secondSeen: Grandchildren = { accepted: null, discarded: null, refusals: [] };
    await runChildRun(store, {
        handle: second.handle,
        program: combining(store, "nested:second", secondSeen),
    });
    assert.deepEqual(projectChildRunResult(store, second.handle.handle_id).value, null);
    assert.equal(projectChildRunResult(store, second.handle.handle_id).status, "settling");
    discardChildRun(store, {
        commandId: "nested:discard-second",
        handle: second.handle,
        reason: "not needed",
        supervisorId: ROOT,
    });
    const afterDiscard = projectDelegationTree(store, { kind: "supervisor", supervisorId: ROOT });
    assert.deepEqual(
        afterDiscard.entries.map((entry) => [entry.handle_id, entry.status, entry.result.value]),
        [
            [child.handle.handle_id, "accepted", { text: "release!" }],
            [second.handle.handle_id, "discarded", null],
        ].sort(),
    );
    const secondKept = secondSeen.accepted as ChildRunHandle;
    assert.equal(projectChildRunResult(store, secondKept.handle_id).value, "docs!");
    assert.equal(
        projectDelegationTree(store, { handleId: second.handle.handle_id, kind: "handle" }).entries
            .length,
        2,
    );
    for (const entry of afterDiscard.entries) {
        assert.ok(!canonical(entry).includes("docs!"));
    }

    // Stability on reopened, read-only, and imported stores.
    const expectTrees = (source: SQLiteTraceStore) => {
        const root = projectDelegationTree(source, { kind: "supervisor", supervisorId: ROOT });
        const handle = projectDelegationTree(source, {
            handleId: child.handle.handle_id,
            kind: "handle",
        });
        return [root, handle, projectChildRunResult(source, child.handle.handle_id)] as const;
    };
    const live = expectTrees(store);
    using readOnly = new SQLiteTraceStore(databasePath, { readOnly: true });
    assert.deepEqual(expectTrees(readOnly), live);
    using imported = new SQLiteTraceStore();
    imported.importTrace(store.exportTrace());
    assert.deepEqual(expectTrees(imported), live);
    assert.equal(imported.verifyIntegrity().ok, true);
    assert.equal(store.verifyIntegrity().ok, true);
    const [liveRoot] = live as readonly [DelegationTreeProjection, unknown, unknown];
    assert.equal(liveRoot.entries.length, 2);
});
