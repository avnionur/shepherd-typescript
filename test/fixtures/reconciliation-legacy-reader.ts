import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import * as current from "../../src/index.ts";
import {
    compensateRow,
    ROW_INSERT_KIND,
    readRowIds,
    runRowSession,
} from "../effect/compensation-fixtures.ts";

// Manual N-1 binary drill. Build commit e794508 separately, then supply its absolute dist path.
const legacyDist = process.argv[2];
assert.ok(legacyDist, "usage: node test/fixtures/reconciliation-legacy-reader.ts <legacy-dist>");
const legacy = createRequire(import.meta.url)(
    path.join(path.resolve(legacyDist), "src/index.js"),
) as typeof current;
const directory = mkdtempSync(path.join(tmpdir(), "shepherd-reconciliation-legacy-"));
const database = path.join(directory, "trace.sqlite");
const world = path.join(directory, "world.sqlite");
using store = new current.SQLiteTraceStore(database);
const source = await runRowSession(store, world, "source", [["a", "compensable"]]);
const effectRecordId = source.inspection.steps[0]?.record_id;
assert.ok(effectRecordId);
await assert.rejects(
    current.compensateEffects(store, {
        commandId: "failed",
        effectRecordIds: [effectRecordId],
        registry: current.createEffectCompensationRegistry([
            {
                handlerId: "refused",
                kind: ROW_INSERT_KIND,
                compensate: () => ({ ok: false, error: "refused" }),
            },
        ]),
    }),
    current.EffectCompensationFailedError,
);
const inspection = current.inspectEffectReconciliation(store, { effectRecordId });
const authority = current.createEffectReconciliationAuthority({
    actorId: "operator",
    policyId: "incident",
    authorize: () => true,
    verifyCompletion: () => false,
});
await current.reconcileEffect(store, {
    authority,
    basisId: inspection.basis_id,
    commandId: "accept",
    disposition: "accepted_unresolved",
    effectRecordId,
    evidenceRecordIds: [effectRecordId],
    reason: "Retain this external row under explicit risk acceptance.",
});
assert.throws(() => new legacy.SQLiteTraceStore(database), legacy.UnsupportedStoreSchemaError);
using imported = new legacy.SQLiteTraceStore();
imported.importTrace(store.exportTrace());
let calls = 0;
await assert.rejects(
    legacy.compensateEffects(imported, {
        commandId: "legacy-retry",
        effectRecordIds: [effectRecordId],
        registry: legacy.createEffectCompensationRegistry([
            {
                handlerId: "legacy-delete",
                kind: ROW_INSERT_KIND,
                compensate: (request) => {
                    calls += 1;
                    return { ok: true, value: compensateRow(world, request) };
                },
            },
        ]),
    }),
    legacy.EffectCompensationEvidenceError,
);
assert.equal(calls, 0);
assert.deepEqual(readRowIds(world), ["a"]);
assert.equal(store.verifyIntegrity().ok, true);
console.log(
    JSON.stringify({ directory, legacyHandlerCalls: calls, remainingRows: readRowIds(world) }),
);
