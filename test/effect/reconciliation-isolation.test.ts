import assert from "node:assert/strict";
import { test } from "node:test";
import { reconciliationBasisId } from "../../src/effect/reconciliation-records.ts";
import {
    claimScopeWriter,
    createEffectHandlerStack,
    createEffectIntent,
    createEffectReconciliationAuthority,
    createStaticProvider,
    deriveEffectCompensationId,
    EffectCompensationEvidenceError,
    emitScopeRecord,
    executeTaskDurably,
    inspectDurableTaskExecution,
    inspectEffectReconciliation,
    inspectReplaySession,
    inspectScope,
    reconcileEffect,
    registerRootScope,
    rewindReplaySession,
    runReplaySession,
    SQLiteTraceStore,
    schema,
    task,
} from "../../src/index.ts";
import { effectProtocolConfig, scopeProtocolConfig } from "../../src/protocol/config.ts";
import { EFFECT_RECONCILIATION_SOURCE_KINDS } from "../../src/protocol/values.generated.ts";

// Fixture audit writes use the internal transaction seam after establishing all source facts;
// assertions exercise public inspection and branching, not a mocked target-count response.
test("more than the per-inspection bound of unrelated resolved audits cannot block other executions", async () => {
    using store = new SQLiteTraceStore();
    const config = effectProtocolConfig.compensation.reconciliation;
    const unaffected = await runReplaySession(store, {
        commandId: "unaffected",
        claimId: "unaffected",
        programId: "unaffected",
        program: () => null,
    });
    const external = new Set<number>();
    const source = await runReplaySession(store, {
        commandId: "incidents",
        claimId: "incidents",
        programId: "incidents",
        handlers: createEffectHandlerStack([
            {
                handlerId: "fixture",
                kind: "fixture",
                handle: (intent) => {
                    external.add(intent.payload as number);
                    return { ok: true, value: null };
                },
            },
        ]),
        program: async (context) => {
            for (let index = 0; index <= config.limits.maxTargets; index += 1)
                await context.dispatchEffect(
                    createEffectIntent({
                        effectId: `fixture:${index}`,
                        kind: "fixture",
                        payload: index,
                        reversibility: "compensable",
                    }),
                );
            return null;
        },
    });
    external.clear(); // Independently completed fixture work; each audited outcome is factual.
    assert.equal(external.size, 0);
    for (const step of source.inspection.steps) {
        const basis = {
            target_record_id: step.record_id,
            compensation_id: deriveEffectCompensationId(step.record_id),
            source_kind: EFFECT_RECONCILIATION_SOURCE_KINDS[0],
            source_owner_id: source.inspection.session_id,
            source_head_record_id: source.inspection.head_record_id,
            compensation_head_record_id: null,
            previous_record_id: null,
        };
        store.appendEffectReconciliationRecord(
            {
                ...basis,
                actor_id: "fixture-operator",
                policy_id: "fixture-policy",
                basis_id: reconciliationBasisId(basis),
                command_id: `resolved:${step.index}`,
                disposition: "externally_verified_completion",
                effect_record_id: step.record_id,
                evidence_record_ids: [step.record_id],
                reason: "Independent fixture completion verified.",
                compatibility_version: config.compatibilityVersion,
                record_version: config.recordVersion,
                completion_verified: true,
            },
            Date.now(),
        );
    }
    assert.equal(
        store.listOwnersBySchema(
            config.traceSchema,
            config.limits.maxTargets + 2,
            0,
            false,
            config.identity.targetOwnerPrefix,
        ).length,
        config.limits.maxTargets + 1,
    );
    assert.equal(
        inspectReplaySession(store, { sessionId: unaffected.inspection.session_id }).residual_risks,
        undefined,
    );
    const branch = await rewindReplaySession(store, {
        commandId: "branch:unaffected",
        claimId: "branch",
        sourceSessionId: unaffected.inspection.session_id,
        sourceDisposition: "retain",
        target: { stepCount: 0 },
    });
    assert.equal(branch.inspection.terminal?.status, "rewound");
    const root = registerRootScope(store, {
        commandId: "scope:unaffected",
        authority: { ceiling: [], grant: [] },
    });
    assert.equal(inspectScope(store, root.scope_id)?.residual_risks, undefined);
    const audited = source.inspection.steps[0]?.record_id;
    assert.ok(audited);
    const originalRead = store.readOwner.bind(store);
    store.readOwner = (ownerId) =>
        originalRead(ownerId).map((record) =>
            ownerId === config.identity.targetOwnerPrefix + audited
                ? { ...record, body: { ...record.body, record_version: 0 } }
                : record,
        );
    assert.throws(
        () => inspectEffectReconciliation(store, { effectRecordId: audited }),
        EffectCompensationEvidenceError,
    );
    assert.equal(
        inspectReplaySession(store, { sessionId: unaffected.inspection.session_id }).residual_risks,
        undefined,
    );
    assert.equal(inspectScope(store, root.scope_id)?.residual_risks, undefined);
    store.readOwner = originalRead;
    assert.equal(
        inspectReplaySession(store, { sessionId: source.inspection.session_id }).residual_risks,
        undefined,
    );
    const descriptor = task({
        name: "association-pages",
        version: "1",
        instruction: "Return done.",
        input: schema.string(),
        output: schema.string(),
    });
    const runId = "run:association-pages";
    await executeTaskDurably(store, {
        runId,
        task: descriptor,
        input: "input",
        budget: { maxTurns: 1 },
        provider: createStaticProvider({
            descriptor: { id: "association-provider", model: "fixture" },
            exchanges: [
                {
                    request: {
                        input: "input",
                        instruction: descriptor.instruction,
                        outputSchema: descriptor.artifact.output_schema,
                    },
                    response: {
                        output: "done",
                        usage: {
                            inputTokens: 1,
                            outputTokens: 1,
                            cacheCreationInputTokens: 0,
                            cacheReadInputTokens: 0,
                            costUsd: null,
                        },
                    },
                },
            ],
        }),
    });
    for (let index = 0; index <= config.limits.maxTargets; index += 1)
        registerRootScope(store, {
            commandId: `association:${index}`,
            executionId: runId,
            authority: { ceiling: [], grant: [] },
        });
    const associated = store.listOwnersBySchemaBodyText(
        scopeProtocolConfig.traceSchemas.registration,
        "$.execution_id",
        runId,
        config.limits.maxTargets + 1,
    );
    const lastScope = associated.at(-1);
    assert.ok(lastScope);
    const scoped = inspectScope(store, lastScope);
    assert.ok(scoped);
    const incident = await runReplaySession(store, {
        commandId: "single-risk",
        claimId: "single-risk",
        programId: "single-risk",
        handlers: createEffectHandlerStack([
            {
                handlerId: "single-risk",
                kind: "fixture",
                handle: () => ({ ok: true, value: null }),
            },
        ]),
        program: async (context) => {
            await context.dispatchEffect(
                createEffectIntent({
                    effectId: "single-risk",
                    kind: "fixture",
                    payload: null,
                    reversibility: "compensable",
                }),
            );
            return null;
        },
    });
    const effectRecordId = incident.inspection.steps[0]?.record_id;
    assert.ok(effectRecordId);
    const before = inspectEffectReconciliation(store, { effectRecordId });
    const authority = createEffectReconciliationAuthority({
        actorId: "operator",
        policyId: "pages",
        authorize: () => true,
        verifyCompletion: () => false,
    });
    const risk = await reconcileEffect(store, {
        authority,
        basisId: before.basis_id,
        commandId: "accept:single-risk",
        disposition: "accepted_unresolved",
        effectRecordId,
        evidenceRecordIds: [effectRecordId],
        reason: "An unresolved effect on the final associated scope page.",
    });
    const writer = claimScopeWriter(store, { scopeId: lastScope, claimId: "last-page" });
    emitScopeRecord(store, {
        commandId: "cite:last-page",
        expectedHeadRecordId: scoped.head.record_id,
        citedRecordIds: [effectRecordId],
        data: { page: "last" },
        writer,
    });
    assert.deepEqual(inspectDurableTaskExecution(store, runId).residual_risks, [risk]);
    // Aggregate bounds must not strand exact incident recovery.
    for (const step of source.inspection.steps) {
        const prior = store.readOwner(deriveEffectCompensationId(step.record_id)).at(-1);
        assert.ok(prior);
        const basis = {
            target_record_id: step.record_id,
            compensation_id: deriveEffectCompensationId(step.record_id),
            source_kind: EFFECT_RECONCILIATION_SOURCE_KINDS[0],
            source_owner_id: source.inspection.session_id,
            source_head_record_id: source.inspection.head_record_id,
            compensation_head_record_id: prior.envelope.record_id,
            previous_record_id: prior.envelope.record_id,
        };
        store.appendEffectReconciliationRecord(
            {
                ...basis,
                actor_id: "operator",
                policy_id: "pages",
                basis_id: reconciliationBasisId(basis),
                command_id: `accepted:${step.index}`,
                disposition: "accepted_unresolved",
                effect_record_id: step.record_id,
                evidence_record_ids: [step.record_id],
                reason: "New external uncertainty established.",
                compatibility_version: config.compatibilityVersion,
                record_version: config.recordVersion,
                completion_verified: false,
            },
            Date.now(),
        );
    }
    assert.throws(
        () => inspectReplaySession(store, { sessionId: source.inspection.session_id }),
        /related residual risks exceed/u,
    );
    const exact = inspectEffectReconciliation(store, { effectRecordId: audited });
    const retried = await reconcileEffect(store, {
        authority,
        basisId: exact.basis_id,
        commandId: "retry:overflow-incident",
        effectRecordId: audited,
        disposition: "retry",
        evidenceRecordIds: [audited],
        reason: "Authorize a safe retry despite aggregate view limits.",
    });
    assert.equal(retried.disposition, "retry");
    assert.equal(
        inspectEffectReconciliation(store, { effectRecordId: audited }).decisions.length,
        3,
    );
});
