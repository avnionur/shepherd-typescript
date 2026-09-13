import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import {
    type AppendReceipt,
    claimScopeWriter,
    discardScope,
    emitScopeRecord,
    forkScope,
    inspectScope,
    mergeScope,
    type RecordBody,
    ROOT_WITNESS_ID,
    readScopeCommandReceipt,
    registerChildScope,
    releaseScopeWriter,
    ScopeEvidenceError,
    type ScopeWriter,
    ScopeWriterFencedError,
    SQLiteTraceStore,
} from "../../src/index.ts";
import { createScopeCommandAppendIntentId } from "../../src/scope/records.ts";
import {
    createScopeChildMergedBody,
    createScopeDiscardAppendIntentId,
    createScopeDiscardCleanedBody,
    createScopeDiscardDecidedBody,
    createScopeMergeAppendIntentId,
    createScopeMergeCompletedBody,
    createScopeMergeCutId,
    createScopeMergePreparedBody,
    readContributions,
    readScopeChildMergedRecord,
    readScopeDiscardRecord,
    readScopeMergeRecord,
} from "../../src/scope/terminal-records.ts";
import { registerAndClaim, temporaryDatabasePath } from "./fixtures.ts";
import { createForkWorkspace, forkOptions } from "./fork-fixtures.ts";
import { headOf } from "./merge-fixtures.ts";

const RECORD = `sha256:${"1".repeat(64)}`;
const SCOPE = `scope:sha256:${"2".repeat(64)}`;
const OTHER_SCOPE = `scope:sha256:${"3".repeat(64)}`;
const CUSTODY = `world-custody:${"4".repeat(64)}`;

class DoubleCompletionStore extends SQLiteTraceStore {
    override completeScopeMerge(
        ...parameters: Parameters<SQLiteTraceStore["completeScopeMerge"]>
    ): AppendReceipt {
        super.completeScopeMerge(...parameters);
        return super.completeScopeMerge(...parameters);
    }

    override completeScopeDiscardCleanup(
        ...parameters: Parameters<SQLiteTraceStore["completeScopeDiscardCleanup"]>
    ): AppendReceipt {
        super.completeScopeDiscardCleanup(...parameters);
        return super.completeScopeDiscardCleanup(...parameters);
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

class FencedAtCompletionStore extends SQLiteTraceStore {
    override completeScopeMerge(
        ...parameters: Parameters<SQLiteTraceStore["completeScopeMerge"]>
    ): AppendReceipt {
        const [completion] = parameters;
        this.releaseScopeWriter(completion.parentScopeId, completion.parentFence);
        return super.completeScopeMerge(...parameters);
    }
}

class InterruptedBeforeForkCompletionStore extends SQLiteTraceStore {
    override completeScopeFork(): never {
        throw new Error("interrupted after fork custody");
    }
}

class InterruptedBeforeCleanupRecordStore extends SQLiteTraceStore {
    override completeScopeDiscardCleanup(): never {
        throw new Error("interrupted after custody cleanup");
    }
}

function forge(
    store: SQLiteTraceStore,
    options: {
        readonly body: unknown;
        readonly causes: readonly string[];
        readonly intent: string;
        readonly owner: string;
        readonly schema: string;
    },
): string {
    return store.append({
        append_intent_id: options.intent,
        batch: {
            groups: [
                {
                    owner_id: options.owner,
                    records: [
                        {
                            body: options.body as RecordBody,
                            caused_by_record_ids: options.causes,
                            mode: "capture",
                            schema_ref: options.schema,
                            witness_ref: ROOT_WITNESS_ID,
                        },
                    ],
                },
            ],
        },
    }).record_ids[0] as string;
}

function openChild(
    store: SQLiteTraceStore,
    rootWriter: ScopeWriter,
    commandId: string,
): { readonly scopeId: string; readonly writer: ScopeWriter } {
    const child = registerChildScope(store, {
        commandId,
        expectedHeadRecordId: headOf(store, rootWriter.scope_id),
        grant: [],
        nowMilliseconds: 1_100,
        parent: rootWriter,
    });
    return {
        scopeId: child.scope_id,
        writer: claimScopeWriter(store, {
            claimId: `claim:${commandId}`,
            nowMilliseconds: 1_100,
            scopeId: child.scope_id,
        }),
    };
}

function preparedBody(overrides: Record<string, unknown> = {}) {
    return {
        ...createScopeMergePreparedBody({
            childHeadRecordId: RECORD,
            commandId: "scope-command:forged",
            contributions: [],
            mergeCutId: createScopeMergeCutId("scope-command:forged"),
            parentHeadRecordId: RECORD,
            parentScopeId: OTHER_SCOPE,
            scopeId: SCOPE,
            world: null,
        }),
        ...overrides,
    };
}

test("merge and discard codecs fail closed on malformed persisted evidence", () => {
    const prepared = preparedBody();
    assert.equal(readScopeMergeRecord(prepared as never).phase, "prepared");
    assert.throws(
        () => readScopeMergeRecord({ ...prepared, phase: "other" } as never),
        ScopeEvidenceError,
    );
    const completed = createScopeMergeCompletedBody({
        commandId: "scope-command:forged",
        parentScopeId: OTHER_SCOPE,
        publicationRevisionId: null,
        scopeId: SCOPE,
    });
    assert.equal(readScopeMergeRecord(completed as never).phase, "completed");
    assert.throws(
        () => readScopeMergeRecord({ ...completed, publication_revision_id: "x" } as never),
        ScopeEvidenceError,
    );
    const integration = createScopeChildMergedBody({
        childCheckpointRecordId: null,
        childCutId: createScopeMergeCutId("scope-command:forged"),
        childScopeId: SCOPE,
        commandId: "scope-command:forged",
        contributions: [{ owner_id: SCOPE, owner_ordinal: 2, record_id: RECORD }],
        mergedContentId: null,
        parentScopeId: OTHER_SCOPE,
        publicationRevisionId: null,
    });
    assert.equal(readScopeChildMergedRecord(integration as never).contributions.length, 1);
    for (const body of [
        { ...integration, merged_content_id: `world-content:sha256:${"5".repeat(64)}` },
        { ...integration, child_cut_id: "scope-origin:x" },
        { ...integration, child_checkpoint_record_id: "x" },
    ]) {
        assert.throws(() => readScopeChildMergedRecord(body as never), ScopeEvidenceError);
    }
    for (const contributions of [
        [{ owner_id: SCOPE, owner_ordinal: -1, record_id: RECORD }],
        [
            { owner_id: SCOPE, owner_ordinal: 1, record_id: RECORD },
            { owner_id: SCOPE, owner_ordinal: 1, record_id: RECORD },
        ],
        [{ owner_id: SCOPE, owner_ordinal: 1 }],
    ]) {
        assert.throws(() => readContributions(contributions), TypeError);
    }
    const target = createScopeDiscardDecidedBody({
        commandId: "scope-command:forged",
        custodyIds: [CUSTODY],
        discardScopeId: SCOPE,
        parentScopeId: OTHER_SCOPE,
        scopeId: SCOPE,
        sealedScopeIds: [SCOPE],
    });
    assert.equal(readScopeDiscardRecord(target as never).phase, "decided");
    for (const body of [
        { ...target, sealed_scope_ids: [OTHER_SCOPE, SCOPE] },
        { ...target, scope_id: OTHER_SCOPE },
        { ...target, custody_ids: [CUSTODY, CUSTODY] },
        { ...target, phase: "other" },
    ]) {
        assert.throws(() => readScopeDiscardRecord(body as never), ScopeEvidenceError);
    }
    const cleaned = createScopeDiscardCleanedBody({
        commandId: "scope-command:forged",
        custodyIds: [CUSTODY],
        scopeId: SCOPE,
    });
    assert.equal(readScopeDiscardRecord(cleaned as never).phase, "cleaned");
    assert.throws(
        () => readScopeDiscardRecord({ ...cleaned, custody_ids: ["x"] } as never),
        ScopeEvidenceError,
    );
});

test("inspection refuses forged merge cuts, reservations, seals, and integrations", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "terminal-forged-merge");
    using store = new SQLiteTraceStore(databasePath);
    const { writer: rootWriter } = registerAndClaim(store);
    const schemas = {
        childMerged: "shepherd.scope.child_merged.v1",
        merge: "shepherd.scope.merge.v1",
    };

    // Every scope is registered and the real merge completes before any evidence is forged.
    const lonely = openChild(store, rootWriter, "scope-command:lonely");
    const cutChildren = {
        reservation: openChild(store, rootWriter, "scope-command:cut-reservation"),
        seal: openChild(store, rootWriter, "scope-command:cut-seal"),
    };
    const mergedChild = openChild(store, rootWriter, "scope-command:merged-child");
    const merged = await mergeScope(store, {
        child: mergedChild.writer,
        commandId: "scope-command:real-merge",
        expectedChildHeadRecordId: headOf(store, mergedChild.scopeId),
        expectedParentHeadRecordId: headOf(store, rootWriter.scope_id),
        nowMilliseconds: 1_200,
        parent: rootWriter,
    });
    const archive = store.exportTrace();

    // A merge cut without its reservation.
    store.publishCut({
        cut_id: createScopeMergeCutId("scope-command:lonely-merge"),
        target_owner_id: lonely.scopeId,
        through_record_id: headOf(store, lonely.scopeId),
    });
    assert.throws(() => inspectScope(store, lonely.scopeId), /lacks its reservation/u);

    // A merge cut followed by a seal or by a reservation naming another cut.
    for (const [label, bodyOf] of [
        [
            "seal",
            (scopeId: string) =>
                createScopeMergeCompletedBody({
                    commandId: "scope-command:cut-seal-merge",
                    parentScopeId: rootWriter.scope_id,
                    publicationRevisionId: null,
                    scopeId,
                }),
        ],
        [
            "reservation",
            (scopeId: string) =>
                preparedBody({
                    command_id: "scope-command:cut-reservation-merge",
                    parent_scope_id: rootWriter.scope_id,
                    scope_id: scopeId,
                }),
        ],
    ] as const) {
        const child = cutChildren[label];
        const cut = store.publishCut({
            cut_id: createScopeMergeCutId(`scope-command:cut-${label}`),
            target_owner_id: child.scopeId,
            through_record_id: headOf(store, child.scopeId),
        });
        const body = bodyOf(child.scopeId);
        forge(store, {
            body,
            causes: [cut.created_by_record_id],
            intent: createScopeCommandAppendIntentId(body.command_id),
            owner: child.scopeId,
            schema: schemas.merge,
        });
        assert.throws(() => inspectScope(store, child.scopeId), ScopeEvidenceError, label);
    }

    // A seal that disagrees with its reservation.
    const reservingPath = await temporaryDatabasePath(context, "terminal-forged-seal");
    const reserving = new InterruptedAfterReservationStore(reservingPath);
    context.after(() => reserving.close());
    const { writer: reservingRoot } = registerAndClaim(reserving);
    const reserved = openChild(reserving, reservingRoot, "scope-command:reserved");
    await assert.rejects(
        mergeScope(reserving, {
            child: reserved.writer,
            commandId: "scope-command:reserve",
            expectedChildHeadRecordId: headOf(reserving, reserved.scopeId),
            expectedParentHeadRecordId: headOf(reserving, reservingRoot.scope_id),
            nowMilliseconds: 1_200,
            parent: reservingRoot,
        }),
        /after merge reservation/u,
    );
    forge(reserving, {
        body: createScopeMergeCompletedBody({
            commandId: "scope-command:other",
            parentScopeId: reservingRoot.scope_id,
            publicationRevisionId: null,
            scopeId: reserved.scopeId,
        }),
        causes: [headOf(reserving, reserved.scopeId)],
        intent: createScopeMergeAppendIntentId("scope-command:other", "completed"),
        owner: reserved.scopeId,
        schema: schemas.merge,
    });
    assert.throws(() => inspectScope(reserving, reserved.scopeId), /seal disagrees/u);

    // Parent-side integrations must cite their exact retained reservation.
    const cleanPath = await temporaryDatabasePath(context, "terminal-forged-integration");
    for (const [label, causesOf, commandId, reservationBody] of [
        ["without reservation", () => [], "scope-command:no-reservation", null],
        ["citing a seal", () => [merged.completed_record_id], "scope-command:seal-cause", null],
        [
            "for another child",
            (reservationId: string) => [reservationId],
            "scope-command:foreign-reservation",
            preparedBody({ command_id: "scope-command:foreign-reservation" }),
        ],
    ] as const) {
        using target = new SQLiteTraceStore(`${cleanPath}-${label.replaceAll(" ", "-")}`);
        target.importTrace(archive);
        const reservationId =
            reservationBody === null
                ? RECORD
                : forge(target, {
                      body: reservationBody,
                      causes: [],
                      intent: `intent:${label}`,
                      owner: "run:forged",
                      schema: schemas.merge,
                  });
        forge(target, {
            body: createScopeChildMergedBody({
                childCheckpointRecordId: null,
                childCutId: createScopeMergeCutId(commandId),
                childScopeId: mergedChild.scopeId,
                commandId,
                contributions: [],
                mergedContentId: null,
                parentScopeId: rootWriter.scope_id,
                publicationRevisionId: null,
            }),
            causes: [headOf(target, rootWriter.scope_id), ...causesOf(reservationId)],
            intent: createScopeMergeAppendIntentId(commandId, "completed"),
            owner: rootWriter.scope_id,
            schema: schemas.childMerged,
        });
        assert.throws(() => inspectScope(target, rootWriter.scope_id), ScopeEvidenceError, label);
    }

    // An exact-looking forged journal still needs a seal and resolvable contributions.
    for (const [label, withSeal] of [
        ["without a seal", false],
        ["with unresolvable contributions", true],
    ] as const) {
        using target = new SQLiteTraceStore(`${cleanPath}-journal-${withSeal}`);
        target.importTrace(archive);
        const commandId = `scope-command:forged-journal-${withSeal}`;
        const contributions = [{ owner_id: lonely.scopeId, owner_ordinal: 99, record_id: RECORD }];
        const rootHead = headOf(target, rootWriter.scope_id);
        const reservationId = forge(target, {
            body: preparedBody({
                child_head_record_id: headOf(target, lonely.scopeId),
                command_id: commandId,
                contributions,
                merge_cut_id: createScopeMergeCutId(commandId),
                parent_head_record_id: rootHead,
                parent_scope_id: rootWriter.scope_id,
                scope_id: lonely.scopeId,
            }),
            causes: [headOf(target, lonely.scopeId)],
            intent: createScopeCommandAppendIntentId(commandId),
            owner: lonely.scopeId,
            schema: schemas.merge,
        });
        const record = (
            owner: string,
            body: unknown,
            schema: string,
            causes: readonly string[],
        ) => ({
            owner_id: owner,
            records: [
                {
                    body: body as RecordBody,
                    caused_by_record_ids: causes,
                    mode: "capture" as const,
                    schema_ref: schema,
                    witness_ref: ROOT_WITNESS_ID,
                },
            ],
        });
        target.append({
            append_intent_id: createScopeMergeAppendIntentId(commandId, "completed"),
            batch: {
                groups: [
                    record(
                        rootWriter.scope_id,
                        createScopeChildMergedBody({
                            childCheckpointRecordId: null,
                            childCutId: createScopeMergeCutId(commandId),
                            childScopeId: lonely.scopeId,
                            commandId,
                            contributions,
                            mergedContentId: null,
                            parentScopeId: rootWriter.scope_id,
                            publicationRevisionId: null,
                        }),
                        schemas.childMerged,
                        [rootHead, reservationId],
                    ),
                    ...(withSeal
                        ? [
                              record(
                                  lonely.scopeId,
                                  createScopeMergeCompletedBody({
                                      commandId,
                                      parentScopeId: rootWriter.scope_id,
                                      publicationRevisionId: null,
                                      scopeId: lonely.scopeId,
                                  }),
                                  schemas.merge,
                                  [reservationId],
                              ),
                          ]
                        : []),
                ],
            },
        });
        assert.throws(() => inspectScope(target, rootWriter.scope_id), ScopeEvidenceError, label);
    }

    // Nothing may follow a merge seal on the child path.
    forge(store, {
        body: { note: "after seal" },
        causes: [merged.head.record_id],
        intent: "intent:after-seal",
        owner: mergedChild.scopeId,
        schema: "shepherd.scope.emission.v1",
    });
    assert.throws(() => inspectScope(store, mergedChild.scopeId), /after its terminal decision/u);
});

test("inspection and replay refuse forged discard decisions and cleanup", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "terminal-forged-discard");
    const store = new InterruptedBeforeCleanupRecordStore(databasePath);
    context.after(() => store.close());
    const { writer: rootWriter } = registerAndClaim(store);
    const schema = "shepherd.scope.discard.v1";

    const early = openChild(store, rootWriter, "scope-command:early-cleanup");
    forge(store, {
        body: createScopeDiscardCleanedBody({
            commandId: "scope-command:early",
            custodyIds: [],
            scopeId: early.scopeId,
        }),
        causes: [headOf(store, early.scopeId)],
        intent: "intent:early-cleanup",
        owner: early.scopeId,
        schema,
    });
    assert.throws(() => inspectScope(store, early.scopeId), /precedes its decision/u);

    const foreign = openChild(store, rootWriter, "scope-command:foreign-decision");
    forge(store, {
        body: createScopeDiscardDecidedBody({
            commandId: "scope-command:foreign",
            custodyIds: [],
            discardScopeId: foreign.scopeId,
            parentScopeId: `scope:sha256:${"9".repeat(64)}`,
            scopeId: foreign.scopeId,
            sealedScopeIds: [foreign.scopeId],
        }),
        causes: [headOf(store, foreign.scopeId)],
        intent: createScopeCommandAppendIntentId("scope-command:foreign"),
        owner: foreign.scopeId,
        schema,
    });
    assert.throws(() => inspectScope(store, foreign.scopeId), /disagrees with its scope/u);

    const unlisted = openChild(store, rootWriter, "scope-command:unlisted-descendant");
    forge(store, {
        body: createScopeDiscardDecidedBody({
            commandId: "scope-command:unlisted",
            custodyIds: [],
            discardScopeId: SCOPE,
            parentScopeId: OTHER_SCOPE,
            scopeId: unlisted.scopeId,
            sealedScopeIds: [],
        }),
        causes: [headOf(store, unlisted.scopeId)],
        intent: createScopeCommandAppendIntentId("scope-command:unlisted"),
        owner: unlisted.scopeId,
        schema,
    });
    assert.throws(() => inspectScope(store, unlisted.scopeId), /disagrees with its scope/u);

    const decided = openChild(store, rootWriter, "scope-command:decided");
    releaseScopeWriter(store, { writer: decided.writer });
    await assert.rejects(
        discardScope(store, {
            commandId: "scope-command:discard",
            expectedHeadRecordId: headOf(store, decided.scopeId),
            nowMilliseconds: 1_200,
            parent: rootWriter,
            scopeId: decided.scopeId,
        }),
        /after custody cleanup/u,
    );
    assert.equal(readScopeCommandReceipt(store, "scope-command:discard")?.command, "discard");
    forge(store, {
        body: createScopeDiscardCleanedBody({
            commandId: "scope-command:discard",
            custodyIds: [CUSTODY],
            scopeId: decided.scopeId,
        }),
        causes: [headOf(store, decided.scopeId)],
        intent: createScopeDiscardAppendIntentId("scope-command:discard", "cleaned"),
        owner: decided.scopeId,
        schema,
    });
    assert.throws(() => inspectScope(store, decided.scopeId), /cleanup disagrees/u);

    forge(store, {
        body: createScopeDiscardDecidedBody({
            commandId: "scope-command:replay-forged",
            custodyIds: [],
            discardScopeId: SCOPE,
            parentScopeId: OTHER_SCOPE,
            scopeId: SCOPE,
            sealedScopeIds: [SCOPE, OTHER_SCOPE],
        }),
        causes: [],
        intent: createScopeCommandAppendIntentId("scope-command:replay-forged"),
        owner: "run:replay-forged",
        schema,
    });
    assert.throws(
        () => readScopeCommandReceipt(store, "scope-command:replay-forged"),
        /not a discard decision/u,
    );
});

test("terminal completions replay inside the store and integrity checks terminal row state", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "terminal-replay");
    const store = new DoubleCompletionStore(databasePath);
    const { writer: rootWriter } = registerAndClaim(store);
    const merged = openChild(store, rootWriter, "scope-command:merged");
    const receipt = await mergeScope(store, {
        child: merged.writer,
        commandId: "scope-command:merge",
        expectedChildHeadRecordId: headOf(store, merged.scopeId),
        expectedParentHeadRecordId: headOf(store, rootWriter.scope_id),
        nowMilliseconds: 1_200,
        parent: rootWriter,
    });
    assert.equal(inspectScope(store, merged.scopeId)?.state, "merged");
    const discarded = openChild(store, rootWriter, "scope-command:discarded");
    releaseScopeWriter(store, { writer: discarded.writer });
    const discard = await discardScope(store, {
        commandId: "scope-command:discard",
        expectedHeadRecordId: headOf(store, discarded.scopeId),
        nowMilliseconds: 1_200,
        parent: rootWriter,
        scopeId: discarded.scopeId,
    });
    assert.equal(discard.cleanup.phase, "cleaned");
    const open = openChild(store, rootWriter, "scope-command:open");
    assert.equal(store.verifyIntegrity().ok, true);
    store.close();

    const database = new DatabaseSync(databasePath);
    database
        .prepare("UPDATE scope_registrations SET state = 'merged' WHERE scope_id = ?")
        .run(open.scopeId);
    database.close();
    using reopened = new SQLiteTraceStore(databasePath);
    assert.deepEqual(
        reopened
            .verifyIntegrity()
            .issues.filter((issue) => issue.kind === "scope_registration_mismatch")
            .map((issue) => issue.subject_id),
        [open.scopeId],
    );
    assert.deepEqual(readScopeCommandReceipt(reopened, "scope-command:merge")?.receipt, receipt);
});

test("merge refuses contributions beyond the configured bound", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "terminal-contributions");
    using store = new SQLiteTraceStore(databasePath);
    const { writer: rootWriter } = registerAndClaim(store);
    const child = openChild(store, rootWriter, "scope-command:busy");
    let head = headOf(store, child.scopeId);
    for (let index = 0; index <= 1_024; index += 1) {
        head = emitScopeRecord(store, {
            commandId: `scope-command:busy-${index}`,
            data: { index },
            expectedHeadRecordId: head,
            nowMilliseconds: 1_200,
            writer: child.writer,
        }).head.record_id;
    }
    await assert.rejects(
        mergeScope(store, {
            child: child.writer,
            commandId: "scope-command:merge",
            expectedChildHeadRecordId: head,
            expectedParentHeadRecordId: headOf(store, rootWriter.scope_id),
            nowMilliseconds: 1_200,
            parent: rootWriter,
        }),
        /exceed the configured bound/u,
    );
});

test("a completion whose parent fence is lost rolls back and a prepared fork refuses other records", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "terminal-fenced");
    using store = new FencedAtCompletionStore(databasePath);
    const { writer: rootWriter } = registerAndClaim(store);
    const child = openChild(store, rootWriter, "scope-command:fenced");
    await assert.rejects(
        mergeScope(store, {
            child: child.writer,
            commandId: "scope-command:merge",
            expectedChildHeadRecordId: headOf(store, child.scopeId),
            expectedParentHeadRecordId: headOf(store, rootWriter.scope_id),
            nowMilliseconds: 1_200,
            parent: rootWriter,
        }),
        ScopeWriterFencedError,
    );
    assert.equal(inspectScope(store, child.scopeId)?.terminal?.phase, "prepared");

    const workspace = await createForkWorkspace(
        context,
        "terminal-fork-pending",
        InterruptedBeforeForkCompletionStore,
    );
    const origin = await workspace.carrier.snapshot(workspace.source);
    await assert.rejects(
        forkScope(workspace.store, forkOptions(workspace, origin.revision_id)),
        /after fork custody/u,
    );
    const [pendingScopeId] = inspectScope(workspace.store, workspace.root.scope_id)?.children ?? [];
    assert.ok(pendingScopeId);
    forge(workspace.store, {
        body: { note: "before completion" },
        causes: [headOf(workspace.store, pendingScopeId)],
        intent: "intent:before-completion",
        owner: pendingScopeId,
        schema: "shepherd.scope.emission.v1",
    });
    assert.throws(() => inspectScope(workspace.store, pendingScopeId), /fork is not complete/u);
});
