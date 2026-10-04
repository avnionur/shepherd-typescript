import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import * as effects from "../../src/facades/effects.ts";
import {
    claimScopeWriter,
    createStaticProvider,
    discardScope,
    emitScopeRecord,
    executeTaskDurably,
    inspectDurableTaskExecution,
    inspectReplaySession,
    inspectScope,
    registerChildScope,
    registerRootScope,
    releaseScopeWriter,
    rewindReplaySession,
    runCli,
    SQLiteTraceStore,
    schema,
    task,
} from "../../src/index.ts";
import { temporaryDirectory } from "../replay/fixtures.ts";
import { ROW_INSERT_KIND, readRowIds, runRowSession } from "./compensation-fixtures.ts";

test("an accepted unresolved compensation remains failed with an authorized durable audit", async (context) => {
    const directory = await temporaryDirectory(context, "reconciliation");
    using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    const { inspection } = await runRowSession(
        store,
        path.join(directory, "world.sqlite"),
        "source",
        [["a", "compensable"]],
    );
    const effectRecordId = inspection.steps[0]?.record_id;
    assert.ok(effectRecordId);
    const refusing = effects.createEffectCompensationRegistry([
        {
            handlerId: "refusing",
            kind: ROW_INSERT_KIND,
            compensate: () => ({ ok: false, error: "external resource unavailable" }),
        },
    ]);
    await assert.rejects(
        effects.compensateEffects(store, {
            commandId: "failed",
            effectRecordIds: [effectRecordId],
            registry: refusing,
        }),
        effects.EffectCompensationFailedError,
    );
    const authority = effects.createEffectReconciliationAuthority({
        actorId: "operator",
        policyId: "test-policy",
        authorize: () => true,
        verifyCompletion: () => false,
    });
    const before = effects.inspectEffectReconciliation(store, { effectRecordId });
    assert.ok(before.compensation);
    const request = {
        authority,
        basisId: before.basis_id,
        commandId: "accept-risk",
        disposition: "accepted_unresolved" as const,
        effectRecordId,
        evidenceRecordIds: [before.compensation.head_record_id],
        reason: "External resource remains unavailable; operator accepts the recorded risk.",
    };
    const receipt = await effects.reconcileEffect(store, request);
    assert.equal(receipt.disposition, "accepted_unresolved");
    assert.deepEqual(await effects.reconcileEffect(store, request), receipt);
    const compensation = effects.inspectEffectCompensation(store, {
        compensationId: effects.deriveEffectCompensationId(effectRecordId),
    });
    assert.equal(compensation.status, "failed");
    assert.equal(compensation.reconciliation?.disposition, "accepted_unresolved");
    const repeated = await effects.compensateEffects(store, {
        commandId: "after-resolution",
        effectRecordIds: [effectRecordId],
        registry: effects.createEffectCompensationRegistry([]),
    });
    assert.equal(repeated.compensations[0]?.status, "failed");
});

test("accepted residual risk survives discard and follows the affected run and replay lineage", async (context) => {
    const directory = await temporaryDirectory(context, "reconciliation-risk");
    using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    const world = path.join(directory, "world.sqlite");
    const { inspection: source } = await runRowSession(store, world, "source", [
        ["a", "compensable"],
    ]);
    const effectRecordId = source.steps[0]?.record_id;
    assert.ok(effectRecordId);
    const descriptor = task({
        name: "incident-run",
        version: "1",
        instruction: "Return done.",
        input: schema.string(),
        output: schema.string(),
    });
    await executeTaskDurably(store, {
        runId: "run:incident",
        task: descriptor,
        input: "input",
        budget: { maxTurns: 1 },
        provider: createStaticProvider({
            descriptor: { id: "incident-provider", model: "fixture" },
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
    const root = registerRootScope(store, {
        commandId: "scope:incident-root",
        executionId: "run:incident",
        authority: { ceiling: [], grant: [] },
    });
    const parent = claimScopeWriter(store, { scopeId: root.scope_id, claimId: "parent" });
    const child = registerChildScope(store, {
        commandId: "scope:incident-child",
        executionId: "run:incident",
        expectedHeadRecordId: root.head.record_id,
        grant: [],
        parent,
    });
    const writer = claimScopeWriter(store, { scopeId: child.scope_id, claimId: "child" });
    const emitted = emitScopeRecord(store, {
        commandId: "scope:cite",
        expectedHeadRecordId: child.head.record_id,
        citedRecordIds: [effectRecordId],
        data: { incident: "external resource" },
        writer,
    });
    releaseScopeWriter(store, { writer });
    const before = effects.inspectEffectReconciliation(store, { effectRecordId });
    const authority = effects.createEffectReconciliationAuthority({
        actorId: "operator",
        policyId: "incident",
        authorize: () => true,
        verifyCompletion: () => false,
    });
    const decision = await effects.reconcileEffect(store, {
        authority,
        basisId: before.basis_id,
        commandId: "accept",
        disposition: "accepted_unresolved",
        effectRecordId,
        evidenceRecordIds: [effectRecordId],
        reason: "Retain the external row as an explicitly accepted residual risk.",
    });
    assert.equal(
        inspectScope(store, child.scope_id)?.residual_risks?.[0]?.record_id,
        decision.record_id,
    );
    assert.equal(
        inspectDurableTaskExecution(store, "run:incident").residual_risks?.[0]?.record_id,
        decision.record_id,
    );
    assert.equal(
        inspectReplaySession(store, { sessionId: source.session_id }).residual_risks?.[0]
            ?.record_id,
        decision.record_id,
    );
    const discarded = await discardScope(store, {
        commandId: "discard:accepted",
        scopeId: child.scope_id,
        expectedHeadRecordId: emitted.head.record_id,
        parent,
        compensation: effects.createEffectCompensationRegistry([]),
    });
    assert.equal(discarded.cleanup.phase, "cleaned");
    assert.deepEqual(readRowIds(world), ["a"]);
    assert.equal(
        inspectScope(store, root.scope_id)?.residual_risks?.[0]?.record_id,
        decision.record_id,
    );
    const branch = await rewindReplaySession(store, {
        commandId: "rewind:accepted",
        claimId: "branch",
        sourceSessionId: source.session_id,
        target: { stepCount: 0 },
        compensation: effects.createEffectCompensationRegistry([]),
    });
    assert.equal(branch.inspection.residual_risks?.[0]?.record_id, decision.record_id);
    for (const args of [
        ["run", "show", "run:incident"],
        ["replay", "show", branch.inspection.session_id],
        ["scope", "show", child.scope_id],
    ]) {
        let output = "";
        assert.equal(
            await runCli([...args, "--store", path.join(directory, "trace.sqlite")], {
                cwd: directory,
                stdout: (text) => {
                    output += text;
                },
                stderr: (text) => assert.fail(text),
            }),
            0,
        );
        assert.match(output, /Accepted unresolved effects: 1/u);
        assert.ok(output.includes(decision.target_record_id));
        output = "";
        assert.equal(
            await runCli([...args, "--store", path.join(directory, "trace.sqlite"), "--json"], {
                cwd: directory,
                stdout: (text) => {
                    output += text;
                },
                stderr: (text) => assert.fail(text),
            }),
            0,
        );
        assert.ok(output.includes('"residual_risks"'));
        assert.ok(output.includes(decision.record_id));
    }

    using imported = new SQLiteTraceStore();
    imported.importTrace(store.exportTrace());
    assert.deepEqual(inspectDurableTaskExecution(imported, "run:incident").residual_risks, [
        decision,
    ]);
});
