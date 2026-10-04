import assert from "node:assert/strict";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
    compensateEffects,
    createEffectCompensationRegistry,
    deriveEffectCompensationId,
    EffectCompensationConflictError,
    EffectCompensationEvidenceError,
    inspectEffectCompensationOwnership,
    SQLiteTraceStore,
    TraceStoreError,
} from "../../src/index.ts";
import { temporaryDirectory } from "../replay/fixtures.ts";
import { ROW_INSERT_KIND, rowCompensation, runRowSession } from "./compensation-fixtures.ts";

test("ownership transactions refuse malformed, stale and unfenced writes without partial admission", async (context) => {
    const directory = await temporaryDirectory(context, "claim-validation");
    using store = new SQLiteTraceStore(path.join(directory, "trace.sqlite"));
    const world = path.join(directory, "world.sqlite");
    const { inspection } = await runRowSession(store, world, "source", [["a", "compensable"]]);
    const recordId = inspection.steps[0]?.record_id;
    assert.ok(recordId);
    const compensationId = deriveEffectCompensationId(recordId);
    const append = store.appendEffectCompensationRecord.bind(store);
    store.appendEffectCompensationRecord = (id, head, request) => {
        const receipt = append(id, head, request);
        assert.equal(append(id, head, request).status, "replayed");
        assert.equal(
            append(id, null, { ...request, append_intent_id: "different" }).status,
            "head_moved",
        );
        return receipt;
    };
    const claim = store.claimEffectCompensationAttempt.bind(store);
    store.claimEffectCompensationAttempt = (id, head, fence, now, request) => {
        assert.throws(() => claim(id, head, fence, Number.MAX_SAFE_INTEGER, request), TypeError);
        assert.throws(() => claim(id, head, fence, -1, request), TypeError);
        assert.throws(
            () => claim(id, recordId, fence, now, request),
            EffectCompensationConflictError,
        );
        assert.throws(() => claim(id, head, { ...fence, claimId: "" }, now, request), TypeError);
        assert.throws(
            () => claim(id, head, fence, now, { ...request, batch: { groups: [] } }),
            TypeError,
        );
        const receipt = claim(id, head, fence, now, request);
        assert.throws(
            () => append(id, receipt.record_ids[0] as string, request),
            EffectCompensationConflictError,
        );
        assert.throws(
            () => store.renewEffectCompensationClaim(id, { ...fence, claimId: "stale" }, now),
            EffectCompensationConflictError,
        );
        return receipt;
    };
    const outcome = store.appendEffectCompensationOutcome.bind(store);
    store.appendEffectCompensationOutcome = (id, fence, now, request) => {
        assert.throws(
            () => outcome(id, fence, now, { ...request, batch: { groups: [] } }),
            TypeError,
        );
        assert.throws(
            () => outcome(id, { ...fence, fencingToken: 0 }, now, request),
            EffectCompensationConflictError,
        );
        return outcome(id, fence, now, request);
    };
    await compensateEffects(store, {
        commandId: "validate",
        effectRecordIds: [recordId],
        registry: rowCompensation(world),
    });
    assert.equal(
        inspectEffectCompensationOwnership(store, { compensationId }).compensation.status,
        "compensated",
    );
});

test("ownership inspection and integrity reject corrupt operational claims", async (context) => {
    const directory = await temporaryDirectory(context, "claim-corruption");
    const database = path.join(directory, "trace.sqlite");
    const world = path.join(directory, "world.sqlite");
    using store = new SQLiteTraceStore(database);
    const { inspection } = await runRowSession(store, world, "source", [["a", "compensable"]]);
    const recordId = inspection.steps[0]?.record_id;
    assert.ok(recordId);
    const compensationId = deriveEffectCompensationId(recordId);
    await compensateEffects(store, {
        commandId: "complete",
        effectRecordIds: [recordId],
        registry: rowCompensation(world),
    });
    const saved = store.readEffectCompensationClaim(compensationId);
    assert.ok(saved);
    using raw = new DatabaseSync(database);
    raw.exec("PRAGMA ignore_check_constraints = ON; PRAGMA foreign_keys = OFF");
    for (const [column, value] of [
        ["attempt_record_id", "missing"],
        ["attempt_record_id", recordId],
        ["fencing_token", 2],
        ["claim_id", ""],
        ["lease_expires_at", -1],
        ["released", 2],
        ["released", 0],
    ] as const) {
        raw.prepare(`UPDATE compensation_claims SET ${column} = ? WHERE compensation_id = ?`).run(
            value,
            compensationId,
        );
        assert.throws(
            () => inspectEffectCompensationOwnership(store, { compensationId }),
            EffectCompensationEvidenceError,
        );
        assert.equal(store.verifyIntegrity().ok, false);
        raw.prepare(
            `UPDATE compensation_claims SET attempt_record_id = ?, claim_id = ?, fencing_token = ?, lease_expires_at = ?, released = ? WHERE compensation_id = ?`,
        ).run(
            saved.attempt_record_id,
            saved.claim_id,
            saved.fencing_token,
            saved.lease_expires_at,
            Number(saved.released),
            compensationId,
        );
    }
    assert.equal(store.verifyIntegrity().ok, true);
    const read = store.readEffectCompensationClaim.bind(store);
    store.readEffectCompensationClaim = (id) => {
        const row = read(id);
        assert.ok(row);
        return { ...row, attempt_record_id: recordId };
    };
    assert.throws(
        () => inspectEffectCompensationOwnership(store, { compensationId }),
        /changed during inspection/u,
    );
});

test("lost initial head and a closed store never publish a fabricated compensation result", async (context) => {
    const directory = await temporaryDirectory(context, "claim-publication");
    const database = path.join(directory, "trace.sqlite");
    const world = path.join(directory, "world.sqlite");
    const store = new SQLiteTraceStore(database);
    context.after(() => store.close());
    const { inspection } = await runRowSession(store, world, "source", [["a", "compensable"]]);
    const recordId = inspection.steps[0]?.record_id;
    assert.ok(recordId);
    const append = store.appendEffectCompensationRecord.bind(store);
    store.appendEffectCompensationRecord = () => ({ status: "head_moved" });
    await assert.rejects(
        compensateEffects(store, {
            commandId: "conflict",
            effectRecordIds: [recordId],
            registry: rowCompensation(world),
        }),
        EffectCompensationConflictError,
    );
    store.appendEffectCompensationRecord = append;
    const registry = createEffectCompensationRegistry([
        {
            handlerId: "closing",
            kind: ROW_INSERT_KIND,
            compensate: () => {
                store.close();
                return { ok: true, value: null };
            },
        },
    ]);
    await assert.rejects(
        compensateEffects(store, { commandId: "closed", effectRecordIds: [recordId], registry }),
        TraceStoreError,
    );
    using reopened = new SQLiteTraceStore(database, { readOnly: true });
    const view = inspectEffectCompensationOwnership(reopened, {
        compensationId: deriveEffectCompensationId(recordId),
    });
    assert.equal(view.compensation.status, "uncertain");
    assert.equal(view.ownership.status, "active");
});
