import assert from "node:assert/strict";
import { test } from "node:test";
import {
    createEffectHandlerStack,
    dispatchSupervisedEffect,
    EffectCompensationEvidenceError,
    inspectEffectReconciliation,
    replayReplaySession,
    rewindReplaySession,
    runReplaySession,
} from "../../src/index.ts";
import { replayProtocolConfig, supervisionProtocolConfig } from "../../src/protocol/config.ts";
import { exchangeOf, providerOf, requestOf } from "../replay/fixtures.ts";
import { ROW_INSERT_KIND, rowIntent } from "./compensation-fixtures.ts";
import { reconciliationFixture } from "./reconciliation-fixtures.ts";

test("source normalization follows recorded copies and completed admissions without repeating work", async (context) => {
    const { store, source, effectRecordId } = await reconciliationFixture(context, "sources");
    const admission = source.steps[0]?.effect?.admission_record_id;
    assert.ok(admission);
    assert.equal(
        inspectEffectReconciliation(store, { effectRecordId: admission }).target.effect_record_id,
        effectRecordId,
    );
    const branch = await rewindReplaySession(store, {
        commandId: "copy",
        claimId: "copy",
        sourceSessionId: source.session_id,
        target: { stepCount: 1 },
        sourceDisposition: "retain",
    });
    const copied = branch.inspection.steps[0]?.record_id;
    assert.ok(copied);
    assert.equal(
        inspectEffectReconciliation(store, { effectRecordId: copied }).target.effect_record_id,
        effectRecordId,
    );
    const failed = await runReplaySession(store, {
        commandId: "failed-effect",
        claimId: "failed-effect",
        programId: "failed-effect",
        handlers: createEffectHandlerStack([
            {
                kind: ROW_INSERT_KIND,
                handlerId: "throw",
                handle: () => {
                    throw new Error("unknown external result");
                },
            },
        ]),
        program: async (ctx) => {
            await ctx.dispatchEffect(rowIntent("b"));
            return null;
        },
    });
    const failedId = failed.inspection.steps[0]?.record_id;
    assert.ok(failedId);
    assert.equal(
        inspectEffectReconciliation(store, { effectRecordId: failedId }).target
            .successful_materialization,
        false,
    );
    const request = requestOf(0);
    const provider = await runReplaySession(store, {
        commandId: "provider",
        claimId: "provider",
        programId: "provider",
        provider: providerOf("provider", [exchangeOf(request, { value: "ok" })]),
        program: async (ctx) => {
            await ctx.invokeProvider(request);
            return null;
        },
    });
    const providerId = provider.inspection.steps[0]?.record_id;
    assert.ok(providerId);
    assert.throws(
        () => inspectEffectReconciliation(store, { effectRecordId: providerId }),
        EffectCompensationEvidenceError,
    );
    const original = store.readRecord.bind(store);
    const retained = original(effectRecordId);
    const retainedAdmission = original(admission);
    assert.ok(retained && retainedAdmission);
    const fakeId = `sha256:${"f".repeat(64)}`;
    for (const record of [retained, retainedAdmission]) {
        const mock = context.mock.method(store, "readRecord", (id: string) =>
            id === fakeId
                ? { ...record, envelope: { ...record.envelope, record_id: fakeId } }
                : original(id),
        );
        assert.throws(
            () => inspectEffectReconciliation(store, { effectRecordId: fakeId }),
            EffectCompensationEvidenceError,
        );
        mock.mock.restore();
    }
    const irreversible = await runReplaySession(store, {
        commandId: "irreversible",
        claimId: "irreversible",
        programId: "irreversible",
        handlers: createEffectHandlerStack([
            {
                kind: ROW_INSERT_KIND,
                handlerId: "success",
                handle: () => ({ ok: true, value: null }),
            },
        ]),
        program: async (ctx) => {
            await ctx.dispatchEffect(rowIntent("c", "irreversible"));
            return null;
        },
    });
    const refused = await replayReplaySession(store, {
        commandId: "refused",
        claimId: "refused",
        sourceSessionId: irreversible.inspection.session_id,
        target: { stepCount: 0 },
        sourceDisposition: "retain",
        handlers: createEffectHandlerStack([]),
        program: async (ctx) => {
            await ctx.dispatchEffect(rowIntent("c", "irreversible"));
            return null;
        },
    });
    const refusedId = refused.inspection.steps[0]?.record_id;
    assert.ok(refusedId);
    assert.throws(
        () => inspectEffectReconciliation(store, { effectRecordId: refusedId }),
        EffectCompensationEvidenceError,
    );
    assert.equal(retained.envelope.schema_ref, replayProtocolConfig.traceSchemas.step);
});

test("supervised sources expose pending and completed admissions and reject denied or foreign evidence", async (context) => {
    const { store } = await reconciliationFixture(context, "supervised-sources");
    let finish: () => void = () => {};
    const barrier = new Promise<void>((resolve) => {
        finish = resolve;
    });
    let inspectPending: () => void = () => {};
    const entered = new Promise<void>((resolve) => {
        inspectPending = resolve;
    });
    const operation = dispatchSupervisedEffect(store, {
        commandId: "pending",
        claimId: "pending",
        intent: rowIntent("pending"),
        handlers: createEffectHandlerStack([
            {
                kind: ROW_INSERT_KIND,
                handlerId: "pending",
                handle: async () => {
                    inspectPending();
                    await barrier;
                    return { ok: true, value: null };
                },
            },
        ]),
    });
    context.after(async () => {
        finish();
        await operation;
    });
    await entered;
    const owner = store.listOwnersBySchema(
        supervisionProtocolConfig.traceSchemas.admission,
        10,
        0,
    )[0];
    assert.ok(owner);
    const admission = store
        .readOwner(owner)
        .find(
            (record) =>
                record.envelope.schema_ref === supervisionProtocolConfig.traceSchemas.admission,
        );
    assert.ok(admission);
    const pending = inspectEffectReconciliation(store, {
        effectRecordId: admission.envelope.record_id,
    });
    assert.equal(pending.target.outcome, null);
    finish();
    const completed = await operation;
    const result = inspectEffectReconciliation(store, {
        effectRecordId: admission.envelope.record_id,
    });
    assert.equal(result.target.effect_record_id, completed.resolution?.record_id);
    assert.equal(result.target.successful_materialization, true);
    const denied = await dispatchSupervisedEffect(store, {
        commandId: "denied",
        claimId: "denied",
        intent: rowIntent("denied"),
        handlers: createEffectHandlerStack([]),
        interceptors: [
            {
                interceptorId: "deny",
                priority: 0,
                timeoutMilliseconds: 1000,
                timeoutPolicy: "fail_closed",
                decide: () => ({ decision: "deny", reason: "policy" }),
            },
        ],
    });
    assert.ok(denied.resolution);
    const deniedId = denied.resolution.record_id;
    assert.throws(
        () => inspectEffectReconciliation(store, { effectRecordId: deniedId }),
        EffectCompensationEvidenceError,
    );
    const original = store.readRecord.bind(store);
    const retained = original(admission.envelope.record_id);
    assert.ok(retained);
    const fakeId = `sha256:${"e".repeat(64)}`;
    for (const body of [retained.body, { ...retained.body, dispatch_id: null }]) {
        const mock = context.mock.method(store, "readRecord", (id: string) =>
            id === fakeId
                ? { ...retained, body, envelope: { ...retained.envelope, record_id: fakeId } }
                : original(id),
        );
        assert.throws(
            () => inspectEffectReconciliation(store, { effectRecordId: fakeId }),
            EffectCompensationEvidenceError,
        );
        mock.mock.restore();
    }
});
