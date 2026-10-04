import assert from "node:assert/strict";
import { test } from "node:test";
import { readOwnerEffectResidualRisks } from "../../src/effect/reconciliation-inspection.ts";
import {
    claimScopeWriter,
    EffectCompensationEvidenceError,
    emitScopeRecord,
    inspectEffectReconciliation,
    inspectScope,
    reconcileEffect,
    registerChildScope,
    registerRootScope,
} from "../../src/index.ts";
import { runRowSession } from "./compensation-fixtures.ts";
import { reconciliationFixture } from "./reconciliation-fixtures.ts";

test("residual projections order distinct risks and refuse inconsistent related ownership or causal evidence", async (context) => {
    const { store, request, worldPath } = await reconciliationFixture(context, "risk-evidence");
    await reconcileEffect(store, request);
    const second = await runRowSession(store, worldPath, "second", [["b", "compensable"]]);
    const id = second.inspection.steps[0]?.record_id;
    assert.ok(id);
    await reconcileEffect(store, {
        ...request,
        effectRecordId: id,
        evidenceRecordIds: [id],
        commandId: "accept:second",
        basisId: inspectEffectReconciliation(store, { effectRecordId: id }).basis_id,
    });
    const root = registerRootScope(store, {
        commandId: "root",
        authority: { ceiling: [], grant: [] },
    });
    const writer = claimScopeWriter(store, { scopeId: root.scope_id, claimId: "writer" });
    const emitted = emitScopeRecord(store, {
        writer,
        commandId: "cite:risks",
        expectedHeadRecordId: root.head.record_id,
        citedRecordIds: [id, request.effectRecordId],
        data: {},
    });
    const risks = inspectScope(store, root.scope_id)?.residual_risks;
    assert.deepEqual(
        risks?.map((risk) => risk.target_record_id),
        [id, request.effectRecordId].sort(),
    );
    const child = registerChildScope(store, {
        commandId: "child",
        parent: writer,
        expectedHeadRecordId: emitted.head.record_id,
        grant: [],
    });
    const original = store.readOwner.bind(store);
    const missingChild = context.mock.method(store, "readOwner", (owner: string) =>
        owner === child.scope_id ? [] : original(owner),
    );
    assert.throws(
        () => readOwnerEffectResidualRisks(store, root.scope_id),
        EffectCompensationEvidenceError,
    );
    missingChild.mock.restore();
    const association = context.mock.method(store, "listOwnersBySchemaBodyText", () => [
        "missing:scope",
    ]);
    assert.throws(
        () => readOwnerEffectResidualRisks(store, root.scope_id),
        EffectCompensationEvidenceError,
    );
    association.mock.restore();
    const readRecord = store.readRecord.bind(store);
    const missingCause = context.mock.method(store, "readRecord", (recordId: string) =>
        recordId === id ? undefined : readRecord(recordId),
    );
    assert.throws(
        () => readOwnerEffectResidualRisks(store, root.scope_id),
        EffectCompensationEvidenceError,
    );
    missingCause.mock.restore();
});
