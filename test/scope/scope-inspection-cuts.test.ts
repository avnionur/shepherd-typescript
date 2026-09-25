import assert from "node:assert/strict";
import { test } from "node:test";

import {
    type Cut,
    type CutId,
    claimScopeWriter,
    emitScopeRecord,
    inspectScope,
    mergeScope,
    type OwnerRecord,
    registerChildScope,
    ScopeEvidenceError,
    SQLiteTraceStore,
} from "../../src/index.ts";
import { registerAndClaim, temporaryDatabasePath } from "./fixtures.ts";

/** Store view that can hide owner records or alter one retained cut, as corruption would. */
class TamperedStore extends SQLiteTraceStore {
    hiddenOwner: string | null = null;
    tamperCut: ((cut: Cut) => Cut) | null = null;
    override readOwner(ownerId: string): readonly OwnerRecord[] {
        const records = super.readOwner(ownerId);
        return ownerId === this.hiddenOwner ? records.slice(0, 1) : records;
    }
    override readCut(cutId: CutId): Cut {
        const cut = super.readCut(cutId);
        return this.tamperCut === null ? cut : this.tamperCut(cut);
    }
}

test("inspection refuses a child scope whose origin cut is missing or disagrees", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "inspection-origin");
    using store = new SQLiteTraceStore(databasePath);
    const { root, writer } = registerAndClaim(store);
    const child = registerChildScope(store, {
        commandId: "scope-command:child",
        expectedHeadRecordId: root.head.record_id,
        grant: [],
        nowMilliseconds: 1_500,
        parent: writer,
    });
    using tampered = new TamperedStore(databasePath);
    assert.ok(inspectScope(tampered, child.scope_id));
    const refuses = (message: RegExp) =>
        assert.throws(
            () => inspectScope(tampered, child.scope_id),
            (error: unknown) => error instanceof ScopeEvidenceError && message.test(error.message),
        );
    tampered.hiddenOwner = child.scope_id;
    refuses(/child scope lacks its origin-cut publication/u);
    tampered.hiddenOwner = null;
    tampered.tamperCut = (cut) => ({ ...cut, cut_id: `${cut.cut_id}-other` as CutId });
    refuses(/scope origin cut is not retained by its own intent/u);
    for (const field of [
        "created_by_record_id",
        "publisher_owner_id",
        "target_owner_id",
        "through_record_id",
    ] as const) {
        tampered.tamperCut = (cut) => ({ ...cut, [field]: `${String(cut[field])}-other` });
        refuses(/child scope origin disagrees with its retained cut/u);
    }
});

test("inspection refuses a merged child whose merge cut disagrees with its retained head", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "inspection-merge-cut");
    using store = new SQLiteTraceStore(databasePath);
    const { root, writer } = registerAndClaim(store);
    const child = registerChildScope(store, {
        commandId: "scope-command:child",
        expectedHeadRecordId: root.head.record_id,
        grant: [],
        nowMilliseconds: 1_200,
        parent: writer,
    });
    const childWriter = claimScopeWriter(store, {
        claimId: "claim:child",
        nowMilliseconds: 1_200,
        scopeId: child.scope_id,
    });
    const emitted = emitScopeRecord(store, {
        commandId: "scope-command:child-emit",
        data: { note: "child" },
        expectedHeadRecordId: child.head.record_id,
        nowMilliseconds: 1_300,
        writer: childWriter,
    });
    await mergeScope(store, {
        child: childWriter,
        commandId: "scope-command:merge",
        expectedChildHeadRecordId: emitted.head.record_id,
        expectedParentHeadRecordId: inspectScope(store, root.scope_id)?.head.record_id as string,
        nowMilliseconds: 1_400,
        parent: writer,
    });
    using tampered = new TamperedStore(databasePath);
    assert.equal(inspectScope(tampered, child.scope_id)?.state, "merged");
    const originCutId = child.origin.origin_cut_id;
    for (const field of [
        "created_by_record_id",
        "publisher_owner_id",
        "target_owner_id",
        "through_record_id",
    ] as const) {
        tampered.tamperCut = (cut) =>
            cut.cut_id === originCutId ? cut : { ...cut, [field]: `${String(cut[field])}-other` };
        assert.throws(
            () => inspectScope(tampered, child.scope_id),
            (error: unknown) =>
                error instanceof ScopeEvidenceError &&
                /scope merge cut disagrees with its retained head/u.test(error.message),
            field,
        );
    }
});
