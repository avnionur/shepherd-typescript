import assert from "node:assert/strict";
import path from "node:path";
import type { TestContext } from "node:test";
import {
    compensateEffects,
    createEffectCompensationRegistry,
    createEffectReconciliationAuthority,
    EffectCompensationFailedError,
    inspectEffectReconciliation,
    SQLiteTraceStore,
} from "../../src/index.ts";
import { temporaryDirectory } from "../replay/fixtures.ts";
import { ROW_INSERT_KIND, runRowSession } from "./compensation-fixtures.ts";

/** Creates a failed compensation with exact source/incident evidence for public-seam tests. */
export async function reconciliationFixture(context: TestContext, label: string) {
    const directory = await temporaryDirectory(context, `reconciliation-${label}`);
    const databasePath = path.join(directory, "trace.sqlite");
    const worldPath = path.join(directory, "world.sqlite");
    const store = new SQLiteTraceStore(databasePath);
    context.after(() => store.close());
    const { inspection: source } = await runRowSession(store, worldPath, "source", [
        ["a", "compensable"],
    ]);
    const effectRecordId = source.steps[0]?.record_id;
    assert.ok(effectRecordId);
    await assert.rejects(
        compensateEffects(store, {
            commandId: "failed",
            effectRecordIds: [effectRecordId],
            registry: createEffectCompensationRegistry([
                {
                    handlerId: "refused",
                    kind: ROW_INSERT_KIND,
                    compensate: () => ({ ok: false, error: "incident" }),
                },
            ]),
        }),
        EffectCompensationFailedError,
    );
    const inspection = inspectEffectReconciliation(store, { effectRecordId });
    assert.ok(inspection.compensation);
    const authority = createEffectReconciliationAuthority({
        actorId: "operator",
        policyId: "test-policy",
        authorize: () => true,
        verifyCompletion: () => false,
    });
    const request = {
        authority,
        basisId: inspection.basis_id,
        commandId: "resolution",
        disposition: "accepted_unresolved" as const,
        effectRecordId,
        evidenceRecordIds: [inspection.compensation.head_record_id],
        reason: "Accept the exact recorded external risk.",
    };
    return {
        directory,
        databasePath,
        worldPath,
        store,
        source,
        effectRecordId,
        inspection,
        authority,
        request,
    };
}
