import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { createCompensationAttemptBody } from "../../src/effect/compensation-records.ts";
import {
    compensateEffects,
    createEffectCompensationRegistry,
    createEffectHandlerStack,
    createEffectIntent,
    EffectCompensationConflictError,
    EffectCompensationEvidenceError,
    EffectCompensationHandlerNotFoundError,
    inspectEffectReconciliation,
    ROOT_WITNESS_ID,
    reconcileEffect,
    runReplaySession,
} from "../../src/index.ts";
import { effectProtocolConfig } from "../../src/protocol/config.ts";
import type { RecordBody } from "../../src/record/types.ts";
import { ROW_INSERT_KIND, readRowIds, runRowSession } from "./compensation-fixtures.ts";
import { reconciliationFixture } from "./reconciliation-fixtures.ts";

test("a retry decision between trigger planning and admission still requires its missing handler", async (context) => {
    const { store, request, worldPath } = await reconciliationFixture(context, "plan-race");
    await reconcileEffect(store, request);
    const second = await runReplaySession(store, {
        commandId: "blocker",
        claimId: "blocker",
        programId: "blocker",
        handlers: createEffectHandlerStack([
            { kind: "blocker", handlerId: "blocker", handle: () => ({ ok: true, value: null }) },
        ]),
        program: async (ctx) => {
            await ctx.dispatchEffect(
                createEffectIntent({
                    effectId: "blocker",
                    kind: "blocker",
                    payload: null,
                    reversibility: "compensable",
                }),
            );
            return null;
        },
    });
    const id = second.inspection.steps[0]?.record_id;
    assert.ok(id);
    let finish: () => void = () => {};
    const blocked = new Promise<void>((resolve) => {
        finish = resolve;
    });
    const registry = createEffectCompensationRegistry([
        {
            kind: "blocker",
            handlerId: "blocker",
            compensate: async () => {
                await blocked;
                return { ok: true, value: null };
            },
        },
    ]);
    const work = compensateEffects(store, {
        commandId: "race",
        effectRecordIds: [request.effectRecordId, id],
        registry,
    });
    const failure = assert.rejects(work, EffectCompensationHandlerNotFoundError);
    try {
        const before = inspectEffectReconciliation(store, {
            effectRecordId: request.effectRecordId,
        });
        await reconcileEffect(store, {
            ...request,
            commandId: "retry",
            disposition: "retry",
            basisId: before.basis_id,
        });
    } finally {
        finish();
    }
    await failure;
    assert.deepEqual(readRowIds(worldPath), ["a"]);
    assert.equal(
        inspectEffectReconciliation(store, { effectRecordId: request.effectRecordId }).compensation
            ?.attempts.length,
        1,
    );
});

test("attempt admission compares operator heads and refuses a suppression even with the exact audit head", async (context) => {
    const { store, request, inspection } = await reconciliationFixture(context, "admission-audit");
    const accepted = await reconcileEffect(store, request);
    const id = inspection.target.compensation_id;
    const draft = { append_intent_id: "must-not-publish", batch: { groups: [] } };
    const before = store.exportTrace();
    for (const auditHead of [null, accepted.record_id])
        assert.throws(
            () =>
                store.claimEffectCompensationAttempt(
                    id,
                    accepted.record_id,
                    { claimId: "forbidden", fencingToken: 2 },
                    Date.now(),
                    draft,
                    auditHead,
                ),
            EffectCompensationConflictError,
        );
    assert.equal(store.exportTrace(), before);
});

test("guard-only or malformed paths cannot admit a compensator without a factual intent", async (context) => {
    const { store, worldPath, request } = await reconciliationFixture(context, "intent-admission");
    const source = await runRowSession(store, worldPath, "new-source", [["b", "compensable"]]);
    const effectRecordId = source.inspection.steps[0]?.record_id;
    assert.ok(effectRecordId);
    const inspected = inspectEffectReconciliation(store, { effectRecordId });
    const accepted = await reconcileEffect(store, {
        ...request,
        effectRecordId,
        basisId: inspected.basis_id,
        commandId: "accept:new",
        evidenceRecordIds: [effectRecordId],
    });
    const id = accepted.compensation_id;
    const draft = { append_intent_id: "must-not-admit", batch: { groups: [] } };
    assert.throws(
        () =>
            store.claimEffectCompensationAttempt(
                id,
                accepted.record_id,
                { claimId: "invalid", fencingToken: 1 },
                Date.now(),
                draft,
                accepted.record_id,
            ),
        EffectCompensationEvidenceError,
    );
    const appended = store.appendEffectCompensationRecord(id, accepted.record_id, {
        append_intent_id: "malformed-attempt",
        batch: {
            groups: [
                {
                    owner_id: id,
                    records: [
                        {
                            body: createCompensationAttemptBody(id, 1, "bad", {
                                kind: "command",
                                command_id: "bad",
                            }) as unknown as RecordBody,
                            caused_by_record_ids: [accepted.record_id],
                            mode: "capture",
                            schema_ref: effectProtocolConfig.compensation.traceSchema,
                            witness_ref: ROOT_WITNESS_ID,
                        },
                    ],
                },
            ],
        },
    });
    assert.equal(appended.status, "appended");
    const head = store.readOwner(id).at(-1)?.envelope.record_id;
    assert.ok(head);
    assert.throws(
        () =>
            store.claimEffectCompensationAttempt(
                id,
                head,
                { claimId: "invalid", fencingToken: 2 },
                Date.now(),
                draft,
                accepted.record_id,
            ),
        EffectCompensationEvidenceError,
    );
    assert.equal(store.readEffectCompensationClaim(id), undefined);
});

test("a corrupted release bit cannot revive an uncertain holder across a reconciliation guard", async (context) => {
    const { store, request, databasePath } = await reconciliationFixture(context, "release-guard");
    await assert.rejects(
        compensateEffects(store, {
            commandId: "uncertain",
            effectRecordIds: [request.effectRecordId],
            registry: createEffectCompensationRegistry([
                {
                    handlerId: "throw",
                    kind: ROW_INSERT_KIND,
                    compensate: () => {
                        throw new Error("lost result");
                    },
                },
            ]),
        }),
        /lost result/u,
    );
    const incident = inspectEffectReconciliation(store, { effectRecordId: request.effectRecordId });
    const receipt = await reconcileEffect(store, { ...request, basisId: incident.basis_id });
    using raw = new DatabaseSync(databasePath);
    raw.prepare("UPDATE compensation_claims SET released = 0 WHERE compensation_id = ?").run(
        receipt.compensation_id,
    );
    assert.throws(
        () => store.readEffectCompensationClaim(receipt.compensation_id),
        /reconciliation did not release/u,
    );
    assert.equal(store.verifyIntegrity().ok, false);
    raw.prepare("UPDATE compensation_claims SET released = 1 WHERE compensation_id = ?").run(
        receipt.compensation_id,
    );
    assert.equal(store.verifyIntegrity().ok, true);
});
