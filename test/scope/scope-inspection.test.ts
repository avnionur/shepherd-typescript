import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import {
    claimScopeWriter,
    createRecordEnvelope,
    emitScopeRecord,
    inspectScope,
    ROOT_WITNESS_ID,
    readScopeCommandReceipt,
    registerChildScope,
    registerRootScope,
    SCOPE_COMPATIBILITY_VERSION,
    SCOPE_RECORD_VERSION,
    type ScopeEmissionReceipt,
    ScopeEvidenceError,
    SQLiteTraceStore,
    type StoreAppendRequest,
    TraceStoreError,
} from "../../src/index.ts";
import { createScopeCommandAppendIntentId } from "../../src/scope/records.ts";
import {
    appendUnrelatedRecord,
    CEILING,
    registerAndClaim,
    resource,
    temporaryDatabasePath,
} from "./fixtures.ts";

test("inspection reconstructs the same scope after reopen, read-only reopen, and import", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "inspection");
    const store = new SQLiteTraceStore(databasePath);
    const { root, writer } = registerAndClaim(store);
    const cited = appendUnrelatedRecord(store, "cited");
    const emitted = emitScopeRecord(store, {
        citedRecordIds: [cited],
        commandId: "scope-command:emit",
        data: { note: "root" },
        expectedHeadRecordId: root.head.record_id,
        nowMilliseconds: 1_500,
        writer,
    });
    const child = registerChildScope(store, {
        commandId: "scope-command:child",
        expectedHeadRecordId: emitted.head.record_id,
        grant: [resource("resource:docs", ["read"])],
        nowMilliseconds: 1_500,
        parent: writer,
    });
    const childWriter = claimScopeWriter(store, {
        claimId: "claim:child",
        nowMilliseconds: 1_500,
        scopeId: child.scope_id,
    });
    const childEmission = emitScopeRecord(store, {
        commandId: "scope-command:child-emit",
        data: { note: "child" },
        expectedHeadRecordId: child.head.record_id,
        nowMilliseconds: 1_500,
        writer: childWriter,
    });

    const rootInspection = inspectScope(store, root.scope_id);
    assert.deepEqual(rootInspection, {
        authority: root.authority,
        children: [child.scope_id],
        execution_id: null,
        head: child.parent_head,
        history: [
            {
                command_id: "scope-command:root",
                kind: "registration",
                owner_ordinal: 0,
                record_id: root.registration_record_id,
            },
            {
                cited_record_ids: [cited],
                command_id: "scope-command:emit",
                kind: "emission",
                owner_ordinal: 1,
                record_id: emitted.head.record_id,
            },
            {
                child_scope_id: child.scope_id,
                command_id: "scope-command:child",
                kind: "child_registered",
                owner_ordinal: 2,
                record_id: child.origin.child_registered_record_id,
            },
        ],
        kind: "root",
        parent: null,
        registered_for_mutation: true,
        registration_record_id: root.registration_record_id,
        scope_id: root.scope_id,
        state: "open",
        world_capability: "trace_only",
    });
    assert.equal(Object.isFrozen(rootInspection), true);
    assert.equal(Object.isFrozen(rootInspection?.history), true);
    const childInspection = inspectScope(store, child.scope_id);
    assert.deepEqual(childInspection, {
        authority: child.authority,
        children: [],
        execution_id: null,
        head: childEmission.head,
        history: [
            {
                command_id: "scope-command:child",
                kind: "registration",
                owner_ordinal: 0,
                record_id: child.registration_record_id,
            },
            {
                cut_id: child.origin.origin_cut_id,
                kind: "origin_cut",
                owner_ordinal: 1,
                record_id: child.head.record_id,
            },
            {
                cited_record_ids: [],
                command_id: "scope-command:child-emit",
                kind: "emission",
                owner_ordinal: 2,
                record_id: childEmission.head.record_id,
            },
        ],
        kind: "child",
        parent: child.origin,
        registered_for_mutation: true,
        registration_record_id: child.registration_record_id,
        scope_id: child.scope_id,
        state: "open",
        world_capability: "trace_only",
    });
    // The parent's effective history never includes child emissions.
    assert.equal(
        store
            .readOwner(root.scope_id)
            .some((record) => record.envelope.record_id === childEmission.head.record_id),
        false,
    );
    const archive = store.exportTrace();
    store.close();

    using reopened = new SQLiteTraceStore(databasePath);
    assert.deepEqual(inspectScope(reopened, root.scope_id), rootInspection);
    assert.deepEqual(inspectScope(reopened, child.scope_id), childInspection);
    assert.equal(reopened.exportTrace(), archive);
    reopened.close();

    using readOnly = new SQLiteTraceStore(databasePath, { readOnly: true });
    assert.deepEqual(inspectScope(readOnly, root.scope_id), rootInspection);
    assert.deepEqual(inspectScope(readOnly, child.scope_id), childInspection);
    readOnly.close();

    const importPath = await temporaryDatabasePath(context, "import");
    using imported = new SQLiteTraceStore(importPath);
    imported.importTrace(archive);
    assert.equal(imported.exportTrace(), archive);
    assert.deepEqual(inspectScope(imported, root.scope_id), {
        ...rootInspection,
        registered_for_mutation: false,
    });
    assert.deepEqual(inspectScope(imported, child.scope_id), {
        ...childInspection,
        registered_for_mutation: false,
    });
    // Imported evidence grants no mutation authority: claims and child registration are refused.
    assert.throws(
        () => claimScopeWriter(imported, { claimId: "claim:import", scopeId: root.scope_id }),
        ScopeEvidenceError,
    );
    assert.throws(
        () =>
            registerChildScope(imported, {
                commandId: "scope-command:import-child",
                expectedHeadRecordId: rootInspection?.head.record_id ?? "",
                grant: [],
                parent: writer,
            }),
        TypeError,
    );
    // Handles minted by another store are refused before any store access.
    assert.throws(
        () =>
            emitScopeRecord(imported, {
                citedRecordIds: [cited],
                commandId: "scope-command:emit",
                data: { note: "root" },
                expectedHeadRecordId: root.head.record_id,
                writer,
            }),
        TypeError,
    );
    // Receipt replay is a read that needs no writer authority, on live and imported stores.
    assert.deepEqual(readScopeCommandReceipt(imported, "scope-command:root"), {
        command: "register_root",
        receipt: root,
    });
    assert.deepEqual(readScopeCommandReceipt(imported, "scope-command:child"), {
        command: "register_child",
        receipt: child,
    });
    assert.deepEqual(readScopeCommandReceipt(imported, "scope-command:emit"), {
        command: "emit",
        receipt: emitted,
    });
    assert.deepEqual(readScopeCommandReceipt(imported, "scope-command:child-emit"), {
        command: "emit",
        receipt: childEmission,
    });
    assert.equal(readScopeCommandReceipt(imported, "scope-command:never"), undefined);
    assert.throws(() => readScopeCommandReceipt(imported, ""), TypeError);
    // Fresh root authority is still explicit trace authority on the imported store.
    const freshRoot = registerRootScope(imported, {
        authority: { ceiling: CEILING, grant: [] },
        commandId: "scope-command:fresh-root",
    });
    assert.equal(inspectScope(imported, freshRoot.scope_id)?.registered_for_mutation, true);
    assert.equal(imported.verifyIntegrity().ok, true);
});

test("integrity verification classifies scope registration rows against retained records", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "integrity");
    const store = new SQLiteTraceStore(databasePath);
    const { root, writer } = registerAndClaim(store);
    const child = registerChildScope(store, {
        commandId: "scope-command:child",
        expectedHeadRecordId: root.head.record_id,
        grant: [],
        nowMilliseconds: 1_500,
        parent: writer,
    });
    const healthy = store.verifyIntegrity();
    assert.equal(healthy.ok, true);
    assert.equal(healthy.checked_scope_count, 2);
    store.close();

    const database = new DatabaseSync(databasePath);
    database
        .prepare("UPDATE scope_registrations SET state = 'bogus' WHERE scope_id = ?")
        .run(child.scope_id);
    database
        .prepare("UPDATE scope_registrations SET registration_record_id = ? WHERE scope_id = ?")
        .run(child.head.record_id, root.scope_id);
    database.close();

    using reopened = new SQLiteTraceStore(databasePath);
    const report = reopened.verifyIntegrity();
    assert.deepEqual(
        report.issues
            .filter((issue) => issue.kind === "scope_registration_mismatch")
            .map((issue) => issue.subject_id)
            .sort(),
        [child.scope_id, root.scope_id].sort(),
    );
    assert.equal(report.checked_scope_count, 2);
    assert.throws(() => inspectScope(reopened, child.scope_id), ScopeEvidenceError);
    assert.throws(() => inspectScope(reopened, root.scope_id), ScopeEvidenceError);

    // Corrupted rows refuse mutation: a non-open state and a non-registration record.
    assert.throws(
        () =>
            claimScopeWriter(reopened, {
                claimId: "claim:bogus",
                nowMilliseconds: 40_000,
                scopeId: child.scope_id,
            }),
        ScopeEvidenceError,
    );
    const rootWriter = claimScopeWriter(reopened, {
        claimId: "claim:corrupt-root",
        nowMilliseconds: 40_000,
        scopeId: root.scope_id,
    });
    assert.throws(
        () =>
            registerChildScope(reopened, {
                commandId: "scope-command:corrupt-child",
                expectedHeadRecordId: child.parent_head.record_id,
                grant: [],
                nowMilliseconds: 40_000,
                parent: rootWriter,
            }),
        ScopeEvidenceError,
    );
    reopened.close();

    // A registration row pointing at another scope's registration record is refused too.
    const renamed = new DatabaseSync(databasePath);
    renamed.prepare("DELETE FROM scope_registrations WHERE scope_id = ?").run(child.scope_id);
    renamed
        .prepare("UPDATE scope_registrations SET registration_record_id = ? WHERE scope_id = ?")
        .run(child.registration_record_id, root.scope_id);
    renamed.close();
    using misnamed = new SQLiteTraceStore(databasePath);
    assert.throws(
        () =>
            registerChildScope(misnamed, {
                commandId: "scope-command:misnamed-child",
                expectedHeadRecordId: child.parent_head.record_id,
                grant: [],
                nowMilliseconds: 40_000,
                parent: claimScopeWriter(misnamed, {
                    claimId: "claim:corrupt-root",
                    nowMilliseconds: 40_000,
                    scopeId: root.scope_id,
                }),
            }),
        ScopeEvidenceError,
    );
    assert.equal(misnamed.verifyIntegrity().checked_scope_count, 1);
});

test("inspection fails closed on malformed or bypassed scope evidence", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "malformed-evidence");
    using store = new SQLiteTraceStore(databasePath);
    const { root, writer } = registerAndClaim(store);
    const child = registerChildScope(store, {
        commandId: "scope-command:child",
        expectedHeadRecordId: root.head.record_id,
        grant: [],
        nowMilliseconds: 1_500,
        parent: writer,
    });
    const rootRegistration = store.readRecord(root.registration_record_id);
    assert.ok(rootRegistration);

    // A bare owner path whose first record is not a registration.
    const bareScope = `scope:sha256:${"d".repeat(64)}`;
    store.append(rawAppend("intent:bare", bareScope, "example.other.v1", { value: 1 }));
    assert.throws(() => inspectScope(store, bareScope), ScopeEvidenceError);

    // A registration body naming another scope.
    const wrongScope = `scope:sha256:${"e".repeat(64)}`;
    store.append(
        rawAppend(
            "intent:wrong-scope",
            wrongScope,
            "shepherd.scope.registration.v1",
            rootRegistration.body,
        ),
    );
    assert.throws(() => inspectScope(store, wrongScope), ScopeEvidenceError);

    // A registration body that is structurally malformed.
    const malformedScope = `scope:sha256:${"f".repeat(64)}`;
    store.append(
        rawAppend("intent:malformed", malformedScope, "shepherd.scope.registration.v1", {
            ...rootRegistration.body,
            scope_id: malformedScope,
            kind: "child",
        }),
    );
    assert.throws(() => inspectScope(store, malformedScope), ScopeEvidenceError);
    for (const body of [
        { ...rootRegistration.body, scope_id: malformedScope, compatibility_version: "other" },
        { ...rootRegistration.body, scope_id: malformedScope, kind: "other" },
        { ...rootRegistration.body, scope_id: malformedScope, world_capability: "world" },
        { ...rootRegistration.body, scope_id: malformedScope, execution_id: 5 },
        { ...rootRegistration.body, scope_id: malformedScope, authority: { ceiling: [] } },
        {
            ...rootRegistration.body,
            scope_id: malformedScope,
            kind: "child",
            parent: {
                child_registered_record_id: "x",
                origin_cut_id: "y",
                origin_record_id: "z",
                scope_id: "w",
            },
        },
    ]) {
        const owner = `scope:sha256:${createRecordEnvelope({ body, mode: "capture", schema_ref: "probe", witness_ref: ROOT_WITNESS_ID }).record_id.slice(7)}`;
        store.append(
            rawAppend(`intent:${owner}`, owner, "shepherd.scope.registration.v1", {
                ...body,
                scope_id: owner,
            }),
        );
        assert.throws(() => inspectScope(store, owner), ScopeEvidenceError);
    }

    // Bypassing the command seam with a raw record on a registered path fails inspection.
    store.append(
        rawAppend(
            "intent:bypass",
            root.scope_id,
            "shepherd.scope.emission.v1",
            {
                cited_record_ids: [],
                command_id: "scope-command:bypass",
                compatibility_version: SCOPE_COMPATIBILITY_VERSION,
                data: {},
                expected_head_record_id: root.head.record_id,
                scope_id: child.scope_id,
                scope_version: SCOPE_RECORD_VERSION,
            },
            [child.parent_head.record_id],
        ),
    );
    assert.throws(() => inspectScope(store, root.scope_id), ScopeEvidenceError);

    const second = registerAndClaim(store, "scope-command:root-2", "claim:root-2");
    store.append(
        rawAppend("intent:bypass-2", second.root.scope_id, "example.other.v1", {}, [
            second.root.head.record_id,
        ]),
    );
    assert.throws(() => inspectScope(store, second.root.scope_id), ScopeEvidenceError);
    const third = registerAndClaim(store, "scope-command:root-3", "claim:root-3");
    store.append(
        rawAppend("intent:bypass-3", third.root.scope_id, "shepherd.scope.emission.v1", {}, []),
    );
    assert.throws(() => inspectScope(store, third.root.scope_id), ScopeEvidenceError);
    // A well-formed emission appended outside the command seam is not retained by its intent.
    const sixth = registerAndClaim(store, "scope-command:root-6", "claim:root-6");
    const genuine = emitScopeRecord(store, {
        commandId: "scope-command:genuine-6",
        data: { note: "genuine" },
        expectedHeadRecordId: sixth.root.head.record_id,
        nowMilliseconds: 1_500,
        writer: sixth.writer,
    });
    store.append(
        rawAppend(
            "intent:bypass-6",
            sixth.root.scope_id,
            "shepherd.scope.emission.v1",
            {
                cited_record_ids: [],
                command_id: "scope-command:bypass-6",
                compatibility_version: SCOPE_COMPATIBILITY_VERSION,
                data: { note: "bypass" },
                expected_head_record_id: genuine.head.record_id,
                scope_id: sixth.root.scope_id,
                scope_version: SCOPE_RECORD_VERSION,
            },
            [genuine.head.record_id],
        ),
    );
    assert.throws(() => inspectScope(store, sixth.root.scope_id), ScopeEvidenceError);
    assert.equal(readScopeCommandReceipt(store, "scope-command:bypass-6"), undefined);
    // Evidence retained under a command intent that is not scope evidence fails closed.
    store.append(
        rawAppend(
            createScopeCommandAppendIntentId("scope-command:foreign-intent"),
            "run:foreign-intent",
            "example.other.v1",
            {},
        ),
    );
    assert.throws(
        () => readScopeCommandReceipt(store, "scope-command:foreign-intent"),
        ScopeEvidenceError,
    );
    store.append(
        rawAppend(
            createScopeCommandAppendIntentId("scope-command:misnamed-emit"),
            "run:misnamed-emit",
            "shepherd.scope.emission.v1",
            {
                cited_record_ids: [],
                command_id: "scope-command:other",
                compatibility_version: SCOPE_COMPATIBILITY_VERSION,
                data: {},
                expected_head_record_id: genuine.head.record_id,
                scope_id: sixth.root.scope_id,
                scope_version: SCOPE_RECORD_VERSION,
            },
        ),
    );
    assert.throws(
        () => readScopeCommandReceipt(store, "scope-command:misnamed-emit"),
        ScopeEvidenceError,
    );
    store.append(
        rawAppend(
            createScopeCommandAppendIntentId("scope-command:misnamed-root"),
            `scope:sha256:${"7".repeat(64)}`,
            "shepherd.scope.registration.v1",
            { ...rootRegistration.body, scope_id: `scope:sha256:${"7".repeat(64)}` },
        ),
    );
    assert.throws(
        () => readScopeCommandReceipt(store, "scope-command:misnamed-root"),
        ScopeEvidenceError,
    );
    const fifth = registerAndClaim(store, "scope-command:root-5", "claim:root-5");
    store.append(
        rawAppend(
            "intent:bypass-5",
            fifth.root.scope_id,
            "shepherd.scope.emission.v1",
            {
                cited_record_ids: [fifth.root.head.record_id],
                command_id: "scope-command:bypass-5",
                compatibility_version: SCOPE_COMPATIBILITY_VERSION,
                data: {},
                expected_head_record_id: fifth.root.head.record_id,
                scope_id: fifth.root.scope_id,
                scope_version: SCOPE_RECORD_VERSION,
            },
            [fifth.root.head.record_id],
        ),
    );
    assert.throws(() => inspectScope(store, fifth.root.scope_id), ScopeEvidenceError);
    const fourth = registerAndClaim(store, "scope-command:root-4", "claim:root-4");
    store.append(
        rawAppend(
            "intent:bypass-4",
            fourth.root.scope_id,
            "shepherd.scope.child_registered.v1",
            {
                child_scope_id: child.scope_id,
                command_id: "scope-command:bypass-4",
                compatibility_version: SCOPE_COMPATIBILITY_VERSION,
                origin_cut_id: child.origin.origin_cut_id,
                origin_record_id: root.head.record_id,
                parent_scope_id: root.scope_id,
                scope_version: SCOPE_RECORD_VERSION,
            },
            [fourth.root.head.record_id],
        ),
    );
    assert.throws(() => inspectScope(store, fourth.root.scope_id), ScopeEvidenceError);

    // A child registration without its origin-cut publication or with a wrong cut fails closed.
    const orphanChild = `scope:sha256:${"9".repeat(64)}`;
    const childRegistration = store.readRecord(child.registration_record_id);
    assert.ok(childRegistration);
    store.append(
        rawAppend("intent:orphan-child", orphanChild, "shepherd.scope.registration.v1", {
            ...childRegistration.body,
            scope_id: orphanChild,
        }),
    );
    assert.throws(() => inspectScope(store, orphanChild), ScopeEvidenceError);
    store.append(rawAppend("intent:orphan-child-cut", orphanChild, "example.other.v1", {}));
    assert.throws(() => inspectScope(store, orphanChild), ScopeEvidenceError);
    assert.throws(() => inspectScope(store, "scope:bad"), TypeError);
});

test("interrupted scope commands converge on retry without duplicate evidence", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "interrupt");
    class LostResponseStore extends SQLiteTraceStore {
        override emitScopeRecord(
            ...parameters: Parameters<SQLiteTraceStore["emitScopeRecord"]>
        ): never {
            super.emitScopeRecord(...parameters);
            throw new Error("emission receipt lost after commit");
        }
        override registerChildScope(): never {
            throw new Error("child registration interrupted before durable admission");
        }
    }
    const store = new LostResponseStore(databasePath);
    const { root, writer } = registerAndClaim(store);
    const options = {
        commandId: "scope-command:lost",
        data: { note: "lost" },
        expectedHeadRecordId: root.head.record_id,
        nowMilliseconds: 1_500,
        writer,
    };
    assert.throws(() => emitScopeRecord(store, options), /receipt lost after commit/u);
    assert.throws(
        () =>
            registerChildScope(store, {
                commandId: "scope-command:interrupted-child",
                expectedHeadRecordId: root.head.record_id,
                grant: [],
                nowMilliseconds: 1_500,
                parent: writer,
            }),
        /interrupted before durable admission/u,
    );
    store.close();

    using recovered = new SQLiteTraceStore(databasePath);
    assert.deepEqual(readScopeCommandReceipt(recovered, "scope-command:lost")?.command, "emit");
    const recoveredWriter = claimScopeWriter(recovered, {
        claimId: "claim:recovered",
        nowMilliseconds: 40_000,
        scopeId: root.scope_id,
    });
    const replayed: ScopeEmissionReceipt = emitScopeRecord(recovered, {
        ...options,
        writer: recoveredWriter,
    });
    assert.equal(replayed.head.owner_ordinal, 1);
    assert.equal(recovered.readOwner(root.scope_id).length, 2);
    const child = registerChildScope(recovered, {
        commandId: "scope-command:interrupted-child",
        expectedHeadRecordId: replayed.head.record_id,
        grant: [],
        nowMilliseconds: 40_000,
        parent: recoveredWriter,
    });
    assert.equal(recovered.readOwner(child.scope_id).length, 2);
    assert.equal(recovered.verifyIntegrity().ok, true);
    assert.throws(() => recovered.readCut("scope-origin:missing"), TraceStoreError);
});

function rawAppend(
    appendIntentId: string,
    ownerId: string,
    schemaRef: string,
    body: Record<string, unknown>,
    causedBy: readonly string[] = [],
): StoreAppendRequest {
    return {
        append_intent_id: appendIntentId,
        batch: {
            groups: [
                {
                    owner_id: ownerId,
                    records: [
                        {
                            body: body as never,
                            caused_by_record_ids: causedBy,
                            mode: "capture",
                            schema_ref: schemaRef,
                            witness_ref: ROOT_WITNESS_ID,
                        },
                    ],
                },
            ],
        },
    };
}
