import assert from "node:assert/strict";
import { test } from "node:test";
import { renderResidualRisks } from "../../src/cli/reconciliation-output.ts";
import { foldCompensation } from "../../src/effect/compensation-inspection.ts";
import {
    readEffectReconciliationCommand,
    readEffectReconciliationHistory,
} from "../../src/effect/reconciliation-inspection.ts";
import {
    readReconciliationRecord,
    reconciliationCommandOwner,
    reconciliationOwner,
} from "../../src/effect/reconciliation-records.ts";
import {
    createEffectReconciliationAuthority,
    EffectCompensationEvidenceError,
    inspectEffectCompensationOwnership,
    inspectEffectReconciliation,
    ROOT_WITNESS_ID,
    reconcileEffect,
} from "../../src/index.ts";
import { effectProtocolConfig } from "../../src/protocol/config.ts";
import { readEffectReconciliationConfig } from "../../src/protocol/config-reconciliation.ts";
import { reconciliationFixture } from "./reconciliation-fixtures.ts";

const config = effectProtocolConfig.compensation.reconciliation;

test("reconciliation codecs and authority reject invalid closed evidence", async (context) => {
    const { store, request } = await reconciliationFixture(context, "codec");
    for (const change of [{ authorize: null }, { verifyCompletion: null }])
        assert.throws(
            () =>
                createEffectReconciliationAuthority({
                    actorId: "a",
                    policyId: "p",
                    authorize: () => true,
                    verifyCompletion: () => true,
                    ...change,
                } as never),
            TypeError,
        );
    await assert.rejects(
        reconcileEffect(store, { ...request, authority: null as never }),
        TypeError,
    );
    await assert.rejects(
        reconcileEffect(store, { ...request, disposition: "unknown" as never }),
        TypeError,
    );
    for (const change of [{ dispositions: ["retry"] }, { sourceKinds: ["replay"] }])
        assert.throws(() => readEffectReconciliationConfig({ ...config, ...change }), TypeError);
    const receipt = await reconcileEffect(store, request);
    const { record_id: _recordId, ...body } = receipt;
    for (const change of [
        { basis_id: "wrong" },
        { record_version: 0 },
        { completion_verified: true },
        { source_kind: "other" },
        { evidence_record_ids: [] },
    ])
        assert.throws(
            () => readReconciliationRecord({ ...body, ...change }),
            EffectCompensationEvidenceError,
        );
    assert.equal(renderResidualRisks(undefined), "");
    assert.match(renderResidualRisks([{ ...receipt, reason: "line\nnext" }]), /line\\nnext/u);
    assert.equal(
        inspectEffectCompensationOwnership(store, { compensationId: receipt.compensation_id })
            .ownership.status,
        "released",
    );
    assert.equal(store.verifyIntegrity().ok, true);
});

test("missing audit guards, source citations and command occurrences refuse instead of suppressing compensation", async (context) => {
    const { store, request } = await reconciliationFixture(context, "links");
    const receipt = await reconcileEffect(store, request);
    const target = reconciliationOwner(receipt.target_record_id);
    const command = reconciliationCommandOwner(receipt.command_id);
    const original = store.readOwner.bind(store);
    for (const owner of [receipt.compensation_id, command]) {
        const mock = context.mock.method(store, "readOwner", (id: string) =>
            id === owner ? [] : original(id),
        );
        assert.throws(
            () => readEffectReconciliationHistory(store, receipt.target_record_id),
            EffectCompensationEvidenceError,
        );
        mock.mock.restore();
    }
    const guard = original(receipt.compensation_id).at(-1);
    assert.ok(guard);
    for (const change of [
        { schema_ref: "foreign" },
        { mode: "declaration" as const },
        { caused_by_record_ids: [] },
        { witness_ref: receipt.target_record_id },
    ]) {
        const records = original(receipt.compensation_id).map((entry) =>
            entry.envelope.record_id === guard.envelope.record_id
                ? { ...entry, envelope: { ...entry.envelope, ...change } }
                : entry,
        );
        assert.throws(
            () => foldCompensation(store, receipt.compensation_id, records),
            EffectCompensationEvidenceError,
        );
    }
    const missingTarget = context.mock.method(store, "readOwner", (id: string) =>
        id === target ? [] : original(id),
    );
    assert.throws(
        () => foldCompensation(store, receipt.compensation_id, original(receipt.compensation_id)),
        EffectCompensationEvidenceError,
    );
    assert.throws(
        () => readEffectReconciliationCommand(store, receipt.command_id),
        EffectCompensationEvidenceError,
    );
    missingTarget.mock.restore();
    const tooMany = context.mock.method(store, "readOwner", (id: string) =>
        id === target
            ? Array.from({ length: config.limits.maxDecisions + 1 }, () => guard)
            : original(id),
    );
    assert.throws(
        () => readEffectReconciliationHistory(store, receipt.target_record_id),
        EffectCompensationEvidenceError,
    );
    tooMany.mock.restore();
    const duplicate = context.mock.method(store, "readOwner", (id: string) =>
        id === command ? [guard, guard] : original(id),
    );
    assert.throws(
        () => readEffectReconciliationCommand(store, receipt.command_id),
        EffectCompensationEvidenceError,
    );
    duplicate.mock.restore();
    const readRecord = store.readRecord.bind(store);
    const cited = readRecord(receipt.compensation_head_record_id as string);
    assert.ok(cited);
    const citation = context.mock.method(store, "readRecord", (id: string) =>
        id === receipt.compensation_head_record_id ? { ...cited, views: [] } : readRecord(id),
    );
    assert.throws(
        () => readEffectReconciliationHistory(store, receipt.target_record_id),
        EffectCompensationEvidenceError,
    );
    citation.mock.restore();
    assert.throws(
        () => inspectEffectReconciliation(store, { effectRecordId: ROOT_WITNESS_ID }),
        EffectCompensationEvidenceError,
    );
    assert.throws(
        () => inspectEffectReconciliation(store, { effectRecordId: `sha256:${"0".repeat(64)}` }),
        EffectCompensationEvidenceError,
    );
});

test("the configured decision bound refuses the next command without partial publication", async (context) => {
    const { store, request } = await reconciliationFixture(context, "bounds");
    for (let index = 0; index < config.limits.maxDecisions; index += 1) {
        const before = inspectEffectReconciliation(store, {
            effectRecordId: request.effectRecordId,
        });
        await reconcileEffect(store, {
            ...request,
            basisId: before.basis_id,
            commandId: `resolution:${index}`,
        });
    }
    const before = inspectEffectReconciliation(store, { effectRecordId: request.effectRecordId });
    const archive = store.exportTrace();
    await assert.rejects(
        reconcileEffect(store, { ...request, basisId: before.basis_id, commandId: "overflow" }),
        /exceeds configured bounds/u,
    );
    assert.equal(store.exportTrace(), archive);
});
