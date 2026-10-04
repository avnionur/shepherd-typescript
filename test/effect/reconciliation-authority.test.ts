import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
    compensateEffects,
    createEffectCompensationRegistry,
    createEffectReconciliationAuthority,
    EffectCompensationConflictError,
    inspectEffectCompensation,
    inspectEffectReconciliation,
    inspectReplaySession,
    ROOT_WITNESS_ID,
    reconcileEffect,
    TraceStoreError,
} from "../../src/index.ts";
import { effectProtocolConfig } from "../../src/protocol/config.ts";
import { ROW_INSERT_KIND, readRowIds, rowCompensation } from "./compensation-fixtures.ts";
import { reconciliationFixture } from "./reconciliation-fixtures.ts";

test("operator authorization, verification and exact command identity refuse without writes", async (context) => {
    const { store, request, effectRecordId } = await reconciliationFixture(
        context,
        "authorization",
    );
    const before = store.exportTrace();
    await assert.rejects(
        reconcileEffect(store, { ...request, authority: { ...request.authority } }),
        TypeError,
    );
    const denied = createEffectReconciliationAuthority({
        actorId: "operator",
        policyId: "deny",
        authorize: () => false,
        verifyCompletion: () => true,
    });
    await assert.rejects(
        reconcileEffect(store, { ...request, authority: denied }),
        /policy refused/u,
    );
    await assert.rejects(
        reconcileEffect(store, { ...request, disposition: "externally_verified_completion" }),
        /not verified/u,
    );
    await assert.rejects(reconcileEffect(store, { ...request, evidenceRecordIds: [] }), TypeError);
    await assert.rejects(
        reconcileEffect(store, { ...request, evidenceRecordIds: [`sha256:${"0".repeat(64)}`] }),
        /not retained/u,
    );
    await assert.rejects(
        reconcileEffect(store, { ...request, basisId: "stale" }),
        EffectCompensationConflictError,
    );
    await assert.rejects(
        reconcileEffect(store, {
            ...request,
            reason: "x".repeat(
                effectProtocolConfig.compensation.reconciliation.limits.maxTextBytes + 1,
            ),
        }),
        TypeError,
    );
    assert.equal(store.exportTrace(), before);
    const receipt = await reconcileEffect(store, request);
    for (const changed of [
        { reason: "another reason" },
        { disposition: "retry" as const },
        { evidenceRecordIds: [effectRecordId] },
        { basisId: "another basis" },
        {
            authority: createEffectReconciliationAuthority({
                actorId: "another-operator",
                policyId: "test-policy",
                authorize: () => true,
                verifyCompletion: () => true,
            }),
        },
    ]) {
        await assert.rejects(
            reconcileEffect(store, { ...request, ...changed }),
            EffectCompensationConflictError,
        );
    }
    await assert.rejects(
        reconcileEffect(store, {
            ...request,
            authority: createEffectReconciliationAuthority({
                actorId: "operator",
                policyId: "test-policy",
                authorize: () => false,
                verifyCompletion: () => true,
            }),
        }),
        /policy refused/u,
    );
    assert.deepEqual(await reconcileEffect(store, request), receipt);
    assert.equal(inspectEffectReconciliation(store, { effectRecordId }).decisions.length, 1);
    for (const owner of [
        effectProtocolConfig.compensation.reconciliation.identity.targetOwnerPrefix +
            effectRecordId,
        `${effectProtocolConfig.compensation.reconciliation.identity.commandOwnerPrefix}forged`,
    ]) {
        assert.throws(
            () =>
                store.append({
                    append_intent_id: owner,
                    batch: {
                        groups: [
                            {
                                owner_id: owner,
                                records: [
                                    {
                                        body: { forged: true },
                                        mode: "capture",
                                        schema_ref:
                                            effectProtocolConfig.compensation.reconciliation
                                                .traceSchema,
                                        witness_ref: ROOT_WITNESS_ID,
                                    },
                                ],
                            },
                        ],
                    },
                }),
            TraceStoreError,
        );
    }
});

test("verified external completion preserves the failed handler result and skips verification on replay", async (context) => {
    const { store, worldPath, request, inspection, source } = await reconciliationFixture(
        context,
        "verified",
    );
    let verifications = 0;
    const authority = createEffectReconciliationAuthority({
        actorId: "operator",
        policyId: "external-ledger",
        authorize: () => true,
        verifyCompletion: () => {
            verifications += 1;
            return readRowIds(worldPath).length === 0;
        },
    });
    await assert.rejects(
        reconcileEffect(store, {
            ...request,
            authority,
            disposition: "externally_verified_completion",
        }),
        /not verified/u,
    );
    using world = new DatabaseSync(worldPath);
    world.prepare("DELETE FROM rows WHERE id = ?").run("a");
    const evidence = store.append({
        append_intent_id: "external:receipt",
        batch: {
            groups: [
                {
                    owner_id: "incident:evidence",
                    records: [
                        {
                            body: {
                                compensation_id: inspection.target.compensation_id,
                                remaining_rows: readRowIds(worldPath),
                            },
                            mode: "capture",
                            schema_ref: "incident.receipt.v1",
                            witness_ref: ROOT_WITNESS_ID,
                        },
                    ],
                },
            ],
        },
    }).record_ids[0];
    assert.ok(evidence);
    const verified = {
        ...request,
        authority,
        disposition: "externally_verified_completion" as const,
        evidenceRecordIds: [evidence],
    };
    const receipt = await reconcileEffect(store, verified);
    assert.equal(receipt.completion_verified, true);
    assert.deepEqual(await reconcileEffect(store, verified), receipt);
    assert.equal(verifications, 2);
    const result = await compensateEffects(store, {
        commandId: "after-verified",
        effectRecordIds: [request.effectRecordId],
        registry: createEffectCompensationRegistry([]),
    });
    assert.equal(result.compensations[0]?.status, "failed");
    assert.equal(
        inspectReplaySession(store, { sessionId: source.session_id }).residual_risks,
        undefined,
    );
});

test("retry audit performs no external work and accepted risk persists until real compensation", async (context) => {
    const { store, worldPath, request, source, inspection } = await reconciliationFixture(
        context,
        "retry",
    );
    const accepted = await reconcileEffect(store, request);
    const beforeRetry = inspectEffectReconciliation(store, {
        effectRecordId: request.effectRecordId,
    });
    const retry = await reconcileEffect(store, {
        ...request,
        commandId: "retry",
        basisId: beforeRetry.basis_id,
        disposition: "retry",
    });
    assert.equal(retry.completion_verified, false);
    assert.deepEqual(readRowIds(worldPath), ["a"]);
    assert.equal(
        inspectReplaySession(store, { sessionId: source.session_id }).residual_risks?.length,
        1,
    );
    await compensateEffects(store, {
        commandId: "retry-compensation",
        effectRecordIds: [request.effectRecordId],
        registry: rowCompensation(worldPath),
    });
    assert.deepEqual(readRowIds(worldPath), []);
    assert.equal(
        inspectReplaySession(store, { sessionId: source.session_id }).residual_risks,
        undefined,
    );
    assert.equal(
        inspectEffectCompensation(store, { compensationId: inspection.target.compensation_id })
            .status,
        "compensated",
    );
    assert.deepEqual(await reconcileEffect(store, request), accepted);
    assert.equal(
        inspectEffectReconciliation(store, { effectRecordId: request.effectRecordId }).decisions.at(
            -1,
        )?.record_id,
        retry.record_id,
    );

    const settled = inspectEffectReconciliation(store, { effectRecordId: request.effectRecordId });
    await assert.rejects(
        reconcileEffect(store, { ...request, commandId: "too-late", basisId: settled.basis_id }),
        /already compensated/u,
    );
});

test("an active compensation or a changed audit basis prevents operator decisions", async (context) => {
    const { store, request } = await reconciliationFixture(context, "active");
    let finish: () => void = () => {};
    const pending = new Promise<void>((resolve) => {
        finish = resolve;
    });
    const work = compensateEffects(store, {
        commandId: "working",
        effectRecordIds: [request.effectRecordId],
        registry: createEffectCompensationRegistry([
            {
                handlerId: "holding",
                kind: ROW_INSERT_KIND,
                compensate: async () => {
                    await pending;
                    return { ok: true, value: null };
                },
            },
        ]),
    });
    const active = inspectEffectReconciliation(store, { effectRecordId: request.effectRecordId });
    await assert.rejects(
        reconcileEffect(store, { ...request, basisId: active.basis_id }),
        EffectCompensationConflictError,
    );
    assert.equal(
        inspectEffectReconciliation(store, { effectRecordId: request.effectRecordId }).decisions
            .length,
        0,
    );
    finish();
    await work;
    assert.equal(store.verifyIntegrity().ok, true);
});
