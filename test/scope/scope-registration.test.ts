import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import * as scopes from "../../src/facades/scopes.ts";
import {
    AppendIntentConflictError,
    claimScopeWriter,
    emitScopeRecord,
    inspectScope,
    ROOT_WITNESS_ID,
    registerChildScope,
    registerRootScope,
    releaseScopeWriter,
    SCOPE_COMPATIBILITY_VERSION,
    SCOPE_RECORD_VERSION,
    ScopeAuthorityError,
    ScopeEvidenceError,
    ScopeHeadConflictError,
    ScopeWriterFencedError,
    SQLiteTraceStore,
} from "../../src/index.ts";
import { createScopeId } from "../../src/scope/records.ts";
import {
    appendExecutionCreation,
    appendUnrelatedRecord,
    CEILING,
    registerAndClaim,
    registerFixtureRoot,
    resource,
    temporaryDatabasePath,
} from "./fixtures.ts";

test("root registration retains a trace-only first record and replays exactly", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "root");
    const store = new SQLiteTraceStore(databasePath);
    const root = registerRootScope(store, {
        authority: {
            ceiling: CEILING,
            grant: [
                resource("resource:source", ["write", "read"]),
                resource("resource:docs", ["read"]),
            ],
        },
        commandId: "scope-command:root",
    });

    assert.equal(root.kind, "root");
    assert.match(root.scope_id, /^scope:sha256:[0-9a-f]{64}$/u);
    assert.deepEqual(root.head, { owner_ordinal: 0, record_id: root.registration_record_id });
    assert.deepEqual(root.authority, {
        ceiling: CEILING,
        effective: [
            resource("resource:docs", ["read"]),
            resource("resource:source", ["read", "write"]),
        ],
    });
    assert.equal(Object.isFrozen(root), true);
    assert.equal(Object.isFrozen(root.authority.effective), true);

    const retained = store.readRecord(root.registration_record_id);
    assert.ok(retained);
    assert.equal(retained.envelope.schema_ref, "shepherd.scope.registration.v1");
    assert.deepEqual(retained.envelope.caused_by_record_ids, []);
    assert.deepEqual(retained.views, [
        {
            append_intent_id: retained.views[0]?.append_intent_id,
            owner_id: root.scope_id,
            owner_ordinal: 0,
        },
    ]);
    assert.deepEqual(retained.body, {
        authority: root.authority,
        command_id: "scope-command:root",
        compatibility_version: SCOPE_COMPATIBILITY_VERSION,
        execution_id: null,
        kind: "root",
        parent: null,
        scope_id: root.scope_id,
        scope_version: SCOPE_RECORD_VERSION,
        world_capability: "trace_only",
    });

    const replayed = registerRootScope(store, {
        authority: { ceiling: CEILING, grant: root.authority.effective },
        commandId: "scope-command:root",
    });
    assert.deepEqual(replayed, root);
    assert.throws(
        () =>
            registerRootScope(store, {
                authority: { ceiling: CEILING, grant: [resource("resource:docs", ["read"])] },
                commandId: "scope-command:root",
            }),
        AppendIntentConflictError,
    );
    const inspection = inspectScope(store, root.scope_id);
    assert.equal(inspection?.history.length, 1);
    assert.equal(inspection?.registered_for_mutation, true);
    store.close();

    using reopened = new SQLiteTraceStore(databasePath);
    assert.deepEqual(
        registerRootScope(reopened, {
            authority: { ceiling: CEILING, grant: root.authority.effective },
            commandId: "scope-command:root",
        }),
        root,
    );
    const other = registerRootScope(reopened, {
        authority: { ceiling: CEILING, grant: [] },
        commandId: "scope-command:root-2",
    });
    assert.notEqual(other.scope_id, root.scope_id);
    assert.deepEqual(other.authority.effective, []);
});

test("root registration binds an optional execution association to retained creation evidence", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "execution");
    using store = new SQLiteTraceStore(databasePath);
    assert.throws(
        () => registerFixtureRoot(store, "scope-command:missing-run", "run:absent"),
        ScopeEvidenceError,
    );
    appendExecutionCreation(store, "run:present");
    const root = registerFixtureRoot(store, "scope-command:present-run", "run:present");
    assert.equal(inspectScope(store, root.scope_id)?.execution_id, "run:present");
    assert.equal(inspectScope(store, `scope:sha256:${"0".repeat(64)}`), undefined);
    assert.throws(() => inspectScope(store, 5 as never), TypeError);

    // An owner path that already retains records cannot become a fresh root scope.
    const occupied = createScopeId("scope-command:occupied", null);
    store.append({
        append_intent_id: "intent:occupied",
        batch: {
            groups: [
                {
                    owner_id: occupied,
                    records: [
                        {
                            body: { value: 1 },
                            mode: "capture",
                            schema_ref: "example.other.v1",
                            witness_ref: ROOT_WITNESS_ID,
                        },
                    ],
                },
            ],
        },
    });
    assert.throws(() => registerFixtureRoot(store, "scope-command:occupied"), ScopeEvidenceError);
    assert.equal(store.readOwner(appendUnrelatedRecord(store, "other")).length, 0);

    // Identity is content-addressed from command and parent; a command id names one kind only.
    assert.notEqual(
        createScopeId("scope-command:x", null),
        createScopeId("scope-command:x", root.scope_id),
    );
    const writer = claimScopeWriter(store, {
        claimId: "claim:reuse",
        nowMilliseconds: 1_000,
        scopeId: root.scope_id,
    });
    assert.throws(
        () =>
            emitScopeRecord(store, {
                commandId: "scope-command:present-run",
                data: {},
                expectedHeadRecordId: root.head.record_id,
                nowMilliseconds: 1_500,
                writer,
            }),
        AppendIntentConflictError,
    );
    const emitted = emitScopeRecord(store, {
        commandId: "scope-command:emit",
        data: {},
        expectedHeadRecordId: root.head.record_id,
        nowMilliseconds: 1_500,
        writer,
    });
    assert.throws(
        () =>
            registerChildScope(store, {
                commandId: "scope-command:emit",
                expectedHeadRecordId: emitted.head.record_id,
                grant: [],
                nowMilliseconds: 1_500,
                parent: writer,
            }),
        AppendIntentConflictError,
    );
    assert.throws(
        () => registerFixtureRoot(store, "scope-command:emit"),
        AppendIntentConflictError,
    );
});

test("root authority attenuates by the ceiling and refuses unknown resources and atoms", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "ceiling");
    using store = new SQLiteTraceStore(databasePath);
    const attenuated = registerRootScope(store, {
        authority: { ceiling: CEILING, grant: [resource("resource:docs", ["read", "write"])] },
        commandId: "scope-command:attenuated",
    });
    assert.deepEqual(attenuated.authority.effective, [resource("resource:docs", ["read"])]);

    for (const [commandId, grant] of [
        ["scope-command:outside", [resource("resource:other", ["read"])]],
        [
            "scope-command:unknown-atom",
            [
                {
                    atoms: ["execute"],
                    resource_id: "resource:docs",
                    resource_kind: "repository_binding",
                },
            ],
        ],
        [
            "scope-command:unknown-kind",
            [{ atoms: ["read"], resource_id: "resource:docs", resource_kind: "network" }],
        ],
        [
            "scope-command:duplicate",
            [resource("resource:docs", ["read"]), resource("resource:docs", ["read"])],
        ],
    ] as const) {
        assert.throws(
            () =>
                registerRootScope(store, {
                    authority: { ceiling: CEILING, grant: grant as never },
                    commandId,
                }),
            ScopeAuthorityError,
        );
    }
    const tooMany = Array.from({ length: 65 }, (_, index) =>
        resource(`resource:${index}`, ["read"]),
    );
    assert.throws(
        () =>
            registerRootScope(store, {
                authority: { ceiling: tooMany, grant: [] },
                commandId: "scope-command:too-many",
            }),
        ScopeAuthorityError,
    );
});

test("child registration fixes the parent origin, attenuates authority, and preserves siblings", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "child");
    const store = new SQLiteTraceStore(databasePath);
    const { root, writer } = registerAndClaim(store);
    const child = registerChildScope(store, {
        commandId: "scope-command:child-a",
        expectedHeadRecordId: root.head.record_id,
        grant: [
            resource("resource:source", ["read", "write"]),
            resource("resource:docs", ["read", "write"]),
        ],
        nowMilliseconds: 1_500,
        parent: writer,
    });

    assert.equal(child.kind, "child");
    assert.notEqual(child.scope_id, root.scope_id);
    assert.deepEqual(child.authority, {
        ceiling: CEILING,
        effective: [
            resource("resource:docs", ["read"]),
            resource("resource:source", ["read", "write"]),
        ],
    });
    assert.equal(child.origin.scope_id, root.scope_id);
    assert.equal(child.origin.origin_record_id, root.head.record_id);
    assert.match(child.origin.origin_cut_id, /^scope-origin:[0-9a-f]{64}$/u);
    assert.deepEqual(child.parent_head, {
        owner_ordinal: 1,
        record_id: child.origin.child_registered_record_id,
    });
    assert.equal(child.head.owner_ordinal, 1);

    const cut = store.readCut(child.origin.origin_cut_id);
    assert.equal(cut.target_owner_id, root.scope_id);
    assert.equal(cut.through_record_id, root.head.record_id);
    assert.equal(cut.through_owner_ordinal, 0);
    assert.equal(cut.publisher_owner_id, child.scope_id);
    assert.equal(cut.created_by_record_id, child.head.record_id);

    const childPath = store.readOwner(child.scope_id);
    assert.deepEqual(
        childPath.map((record) => record.envelope.schema_ref),
        ["shepherd.scope.registration.v1", "kernel.cut.owner-prefix.v1"],
    );
    assert.deepEqual(childPath[0]?.envelope.caused_by_record_ids, [
        child.origin.child_registered_record_id,
    ]);
    assert.deepEqual(childPath[1]?.envelope.caused_by_record_ids, [
        root.head.record_id,
        child.registration_record_id,
    ]);
    const parentPath = store.readOwner(root.scope_id);
    assert.deepEqual(
        parentPath.map((record) => record.envelope.schema_ref),
        ["shepherd.scope.registration.v1", "shepherd.scope.child_registered.v1"],
    );
    assert.deepEqual(parentPath[1]?.body, {
        child_scope_id: child.scope_id,
        command_id: "scope-command:child-a",
        compatibility_version: SCOPE_COMPATIBILITY_VERSION,
        origin_cut_id: child.origin.origin_cut_id,
        origin_record_id: root.head.record_id,
        parent_scope_id: root.scope_id,
        scope_version: SCOPE_RECORD_VERSION,
    });

    // A sibling registered from the advanced parent head cites a distinct origin.
    const sibling = registerChildScope(store, {
        commandId: "scope-command:child-b",
        expectedHeadRecordId: child.parent_head.record_id,
        grant: [resource("resource:docs", ["read"])],
        nowMilliseconds: 1_500,
        parent: writer,
    });
    assert.notEqual(sibling.scope_id, child.scope_id);
    assert.equal(sibling.origin.origin_record_id, child.parent_head.record_id);
    assert.deepEqual(sibling.authority.effective, [resource("resource:docs", ["read"])]);
    assert.deepEqual(inspectScope(store, child.scope_id), inspectScope(store, child.scope_id));
    assert.equal(inspectScope(store, child.scope_id)?.children.length, 0);
    assert.deepEqual(inspectScope(store, root.scope_id)?.children, [
        child.scope_id,
        sibling.scope_id,
    ]);

    // Nested child attenuates from the child's effective authority.
    const childWriter = claimScopeWriter(store, {
        claimId: "claim:child",
        nowMilliseconds: 1_500,
        scopeId: child.scope_id,
    });
    const grandchild = registerChildScope(store, {
        commandId: "scope-command:grandchild",
        expectedHeadRecordId: child.head.record_id,
        grant: [resource("resource:source", ["write"])],
        nowMilliseconds: 1_500,
        parent: childWriter,
    });
    assert.deepEqual(grandchild.authority.effective, [resource("resource:source", ["write"])]);
    // Requesting write on a parent read-only resource attenuates to no atoms; it is not refused.
    const attenuated = registerChildScope(store, {
        commandId: "scope-command:grandchild-docs-write",
        expectedHeadRecordId: grandchild.parent_head.record_id,
        grant: [resource("resource:docs", ["write"])],
        nowMilliseconds: 1_500,
        parent: childWriter,
    });
    assert.deepEqual(attenuated.authority.effective, [resource("resource:docs", [])]);
    const grandchildWriter = claimScopeWriter(store, {
        claimId: "claim:grandchild",
        nowMilliseconds: 1_500,
        scopeId: grandchild.scope_id,
    });
    assert.throws(
        () =>
            registerChildScope(store, {
                commandId: "scope-command:great-grandchild",
                expectedHeadRecordId: grandchild.head.record_id,
                grant: [resource("resource:docs", ["read"])],
                nowMilliseconds: 1_500,
                parent: grandchildWriter,
            }),
        ScopeAuthorityError,
    );
    store.close();

    using reopened = new SQLiteTraceStore(databasePath);
    assert.deepEqual(
        registerChildScope(reopened, {
            commandId: "scope-command:child-a",
            expectedHeadRecordId: root.head.record_id,
            grant: [
                resource("resource:docs", ["read", "write"]),
                resource("resource:source", ["read", "write"]),
            ],
            nowMilliseconds: 9_999_999,
            parent: claimScopeWriter(reopened, {
                claimId: "claim:root-after-restart",
                nowMilliseconds: 9_999_999,
                scopeId: root.scope_id,
            }),
        }),
        child,
    );
});

test("child registration requires a current parent fence and exact head", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "child-fence");
    using store = new SQLiteTraceStore(databasePath);
    const { root, writer } = registerAndClaim(store);
    const other = registerFixtureRoot(store, "scope-command:other-root");

    assert.throws(
        () =>
            registerChildScope(store, {
                commandId: "scope-command:stale-head",
                expectedHeadRecordId: other.head.record_id,
                grant: [],
                nowMilliseconds: 1_500,
                parent: writer,
            }),
        ScopeHeadConflictError,
    );
    assert.throws(
        () =>
            registerChildScope(store, {
                commandId: "scope-command:expired",
                expectedHeadRecordId: root.head.record_id,
                grant: [],
                nowMilliseconds: 1_000 + 30_000,
                parent: writer,
            }),
        ScopeWriterFencedError,
    );
    const child = registerChildScope(store, {
        commandId: "scope-command:child",
        expectedHeadRecordId: root.head.record_id,
        grant: [],
        nowMilliseconds: 1_500,
        parent: writer,
    });
    assert.throws(
        () =>
            registerChildScope(store, {
                commandId: "scope-command:duplicate-head",
                expectedHeadRecordId: root.head.record_id,
                grant: [],
                nowMilliseconds: 1_500,
                parent: writer,
            }),
        ScopeHeadConflictError,
    );
    releaseScopeWriter(store, { writer });
    assert.throws(
        () =>
            registerChildScope(store, {
                commandId: "scope-command:released",
                expectedHeadRecordId: child.parent_head.record_id,
                grant: [],
                nowMilliseconds: 1_500,
                parent: writer,
            }),
        ScopeWriterFencedError,
    );
    // Exact replay after release still returns the original receipt.
    assert.deepEqual(
        registerChildScope(store, {
            commandId: "scope-command:child",
            expectedHeadRecordId: root.head.record_id,
            grant: [],
            nowMilliseconds: 1_500,
            parent: writer,
        }),
        child,
    );
    assert.throws(
        () =>
            registerChildScope(store, {
                commandId: "scope-command:child",
                expectedHeadRecordId: root.head.record_id,
                grant: [resource("resource:docs", ["read"])],
                nowMilliseconds: 1_500,
                parent: writer,
            }),
        AppendIntentConflictError,
    );
    assert.throws(
        () =>
            registerChildScope(store, {
                commandId: "scope-command:missing-run",
                executionId: "run:absent",
                expectedHeadRecordId: child.parent_head.record_id,
                grant: [],
                nowMilliseconds: 1_500,
                parent: claimScopeWriter(store, {
                    claimId: "claim:root-2",
                    nowMilliseconds: 1_500,
                    scopeId: root.scope_id,
                }),
            }),
        ScopeEvidenceError,
    );
});

test("a writer whose registration row disappeared cannot register children", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "missing-row");
    using store = new SQLiteTraceStore(databasePath);
    const { root, writer } = registerAndClaim(store);
    const child = registerChildScope(store, {
        commandId: "scope-command:child",
        expectedHeadRecordId: root.head.record_id,
        grant: [],
        nowMilliseconds: 1_500,
        parent: writer,
    });
    const childWriter = claimScopeWriter(store, {
        claimId: "claim:child",
        nowMilliseconds: 1_500,
        scopeId: child.scope_id,
    });
    const database = new DatabaseSync(databasePath);
    database.prepare("DELETE FROM scope_writer_claims WHERE scope_id = ?").run(child.scope_id);
    database.prepare("DELETE FROM scope_registrations WHERE scope_id = ?").run(child.scope_id);
    database.close();
    assert.throws(
        () =>
            registerChildScope(store, {
                commandId: "scope-command:grandchild",
                expectedHeadRecordId: child.head.record_id,
                grant: [],
                nowMilliseconds: 1_500,
                parent: childWriter,
            }),
        ScopeEvidenceError,
    );
    assert.equal(inspectScope(store, child.scope_id)?.registered_for_mutation, false);
});

test("scope commands reject forged handles and malformed options", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "malformed");
    using store = new SQLiteTraceStore(databasePath);
    const { root, writer } = registerAndClaim(store);
    const forged = { ...writer };
    using foreign = new SQLiteTraceStore(await temporaryDatabasePath(context, "foreign"));
    registerFixtureRoot(foreign);
    const foreignWriter = claimScopeWriter(foreign, {
        claimId: "claim:foreign",
        nowMilliseconds: 1_000,
        scopeId: root.scope_id,
    });
    const valid = {
        commandId: "scope-command:forged",
        expectedHeadRecordId: root.head.record_id,
        grant: [],
        nowMilliseconds: 1_500,
    };
    assert.throws(() => registerChildScope(store, { ...valid, parent: forged }), TypeError);
    assert.throws(() => registerChildScope(store, { ...valid, parent: foreignWriter }), TypeError);
    assert.equal(inspectScope(foreign, root.scope_id)?.history.length, 1);
    assert.throws(() => registerChildScope(store, { ...valid, parent: null as never }), TypeError);
    const accessorGrant = [] as unknown[];
    Object.defineProperty(accessorGrant, "0", {
        enumerable: true,
        get: () => {
            throw new Error("accessor invoked");
        },
    });
    for (const options of [
        null,
        [],
        Object.create({ inherited: true }),
        { ...valid, parent: writer, extra: true },
        { ...valid, parent: writer, commandId: "" },
        { ...valid, parent: writer, expectedHeadRecordId: "sha256:short" },
        { ...valid, parent: writer, nowMilliseconds: -1 },
        { ...valid, parent: writer, executionId: "" },
        { ...valid, parent: writer, grant: "read" },
        { ...valid, parent: writer, grant: [null] },
        {
            ...valid,
            parent: writer,
            grant: [{ atoms: "read", resource_id: "r", resource_kind: "repository_binding" }],
        },
        {
            ...valid,
            parent: writer,
            grant: [
                {
                    atoms: ["read", "read"],
                    resource_id: "resource:docs",
                    resource_kind: "repository_binding",
                },
            ],
        },
        {
            ...valid,
            parent: writer,
            grant: [{ atoms: ["read"], resource_id: "", resource_kind: "repository_binding" }],
        },
        { ...valid, parent: writer, grant: Object.assign([], { custom: true }) },
        { ...valid, parent: writer, grant: accessorGrant },
        Object.defineProperty({ ...valid, parent: writer }, "commandId", {
            get: () => "scope-command:x",
        }),
        Object.assign({ ...valid, parent: writer }, { [Symbol("hidden")]: true }),
    ]) {
        assert.throws(() => registerChildScope(store, options as never), TypeError);
    }
    for (const options of [
        { authority: { ceiling: CEILING, grant: [] } },
        { authority: { ceiling: CEILING }, commandId: "scope-command:a" },
        { authority: [], commandId: "scope-command:a" },
        {
            authority: { ceiling: CEILING, grant: [] },
            commandId: "scope-command:a",
            executionId: 1,
        },
    ]) {
        assert.throws(() => registerRootScope(store, options as never), TypeError);
    }
    assert.equal(inspectScope(store, root.scope_id)?.history.length, 1);
});

test("the scopes facade exposes the complete runtime surface", () => {
    assert.deepEqual(Object.keys(scopes).sort(), [
        "AppendIntentConflictError",
        "SCOPE_AUTHORITY_ATOMS",
        "SCOPE_COMMAND_KINDS",
        "SCOPE_COMPATIBILITY_VERSION",
        "SCOPE_EVIDENCE_KINDS",
        "SCOPE_KINDS",
        "SCOPE_LIMITS",
        "SCOPE_RECORD_VERSION",
        "SCOPE_RESOURCE_KINDS",
        "SCOPE_STATES",
        "SCOPE_WORLD_CAPABILITIES",
        "ScopeAuthorityError",
        "ScopeEvidenceError",
        "ScopeHeadConflictError",
        "ScopeWriterConflictError",
        "ScopeWriterFencedError",
        "TraceStoreError",
        "claimScopeWriter",
        "emitScopeRecord",
        "inspectScope",
        "readScopeCommandReceipt",
        "registerChildScope",
        "registerRootScope",
        "releaseScopeWriter",
    ]);
    assert.deepEqual(scopes.SCOPE_KINDS, ["root", "child"]);
    assert.deepEqual(scopes.SCOPE_STATES, ["open", "merged", "discarded"]);
    assert.deepEqual(scopes.SCOPE_COMMAND_KINDS, ["register_root", "register_child", "emit"]);
    assert.deepEqual(scopes.SCOPE_LIMITS, {
        maxCitedRecords: 64,
        maxDataCanonicalBytes: 65_536,
        maxResources: 64,
    });
    assert.equal(new scopes.ScopeAuthorityError().code, "SCOPE_AUTHORITY_REFUSED");
    assert.equal(new scopes.ScopeEvidenceError().code, "SCOPE_EVIDENCE_INVALID");
    assert.equal(new scopes.ScopeHeadConflictError("scope").code, "SCOPE_HEAD_CONFLICT");
    assert.equal(
        new scopes.ScopeWriterConflictError("scope", "claim").code,
        "SCOPE_WRITER_CONFLICT",
    );
    assert.equal(new scopes.ScopeWriterFencedError("scope", "claim").code, "SCOPE_WRITER_FENCED");
});
