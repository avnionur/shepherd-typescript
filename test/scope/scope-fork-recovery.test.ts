import assert from "node:assert/strict";
import { readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import {
    type AppendReceipt,
    claimScopeWriter,
    claimScopeWriters,
    forkScope,
    inspectScope,
    readScopeCommandReceipt,
    registerRootScope,
    releaseScopeWriter,
    ScopeEvidenceError,
    ScopeWriterFencedError,
    SQLiteTraceStore,
    WorldCarrierError,
} from "../../src/index.ts";
import { createForkWorkspace, forkOptions } from "./fork-fixtures.ts";

class InterruptedBeforeAdmissionStore extends SQLiteTraceStore {
    override registerChildScope(): never {
        throw new Error("interrupted before fork admission");
    }
}

class InterruptedAfterPreparedStore extends SQLiteTraceStore {
    override registerChildScope(
        ...parameters: Parameters<SQLiteTraceStore["registerChildScope"]>
    ): never {
        super.registerChildScope(...parameters);
        throw new Error("interrupted after prepared fork journal");
    }
}

class InterruptedBeforeCompletionStore extends SQLiteTraceStore {
    override completeScopeFork(): never {
        throw new Error("interrupted after physical custody");
    }
}

class LostCompletionResponseStore extends SQLiteTraceStore {
    override completeScopeFork(
        ...parameters: Parameters<SQLiteTraceStore["completeScopeFork"]>
    ): AppendReceipt {
        super.completeScopeFork(...parameters);
        throw new Error("fork completion response lost after commit");
    }
}

class MissingPreparedJournalStore extends SQLiteTraceStore {
    override readAppendIntentRecords(
        appendIntentId: string,
    ): ReturnType<SQLiteTraceStore["readAppendIntentRecords"]> {
        const records = super.readAppendIntentRecords(appendIntentId);
        return records.some((record) => record.body.phase === "prepared") ? [] : records;
    }
}

test("fork recovery converges across each trace and physical boundary", async (context) => {
    for (const [label, StoreClass, message, expectedCustodies] of [
        ["before-admission", InterruptedBeforeAdmissionStore, /before fork admission/u, 0],
        ["after-prepared", InterruptedAfterPreparedStore, /after prepared fork journal/u, 0],
        ["before-completion", InterruptedBeforeCompletionStore, /after physical custody/u, 1],
        ["lost-completion", LostCompletionResponseStore, /response lost after commit/u, 1],
    ] as const) {
        const workspace = await createForkWorkspace(context, label, StoreClass);
        const origin = await workspace.carrier.snapshot(workspace.source);
        await assert.rejects(
            forkScope(workspace.store, forkOptions(workspace, origin.revision_id)),
            message,
        );
        const custodiesRoot = path.join(workspace.workspaceRoot, ".vcscore", "worlds", "custodies");
        assert.equal((await readdir(custodiesRoot)).length, expectedCustodies, label);
        releaseScopeWriter(workspace.store, { writer: workspace.rootWriter });
        workspace.store.close();

        using recovered = new SQLiteTraceStore(workspace.databasePath);
        const parent = claimScopeWriter(recovered, {
            claimId: "claim:recovered-root",
            nowMilliseconds: 2_000,
            scopeId: workspace.root.scope_id,
        });
        const fork = await forkScope(recovered, {
            ...forkOptions(workspace, origin.revision_id),
            nowMilliseconds: 2_000,
            parent,
        });
        assert.equal(fork.world.status, "completed", label);
        assert.equal((await readdir(custodiesRoot)).length, 1, label);
        assert.deepEqual(readScopeCommandReceipt(recovered, "scope-command:fork")?.receipt, fork);
        assert.equal(recovered.verifyIntegrity().ok, true, label);
    }
});

test("an incomplete fork blocks writers and refuses contradictory or stale physical evidence", async (context) => {
    const workspace = await createForkWorkspace(
        context,
        "contradictory",
        InterruptedBeforeCompletionStore,
    );
    const origin = await workspace.carrier.snapshot(workspace.source);
    await assert.rejects(forkScope(workspace.store, forkOptions(workspace, origin.revision_id)));
    const [childScopeId] = inspectScope(workspace.store, workspace.root.scope_id)?.children ?? [];
    assert.ok(childScopeId);
    const prepared = inspectScope(workspace.store, childScopeId);
    assert.equal(prepared?.world?.status, "prepared");
    assert.equal(prepared?.world?.checkpoint, null);
    assert.equal(prepared?.world?.completed_record_id, null);
    assert.equal(readScopeCommandReceipt(workspace.store, "scope-command:fork"), undefined);
    assert.throws(
        () =>
            claimScopeWriter(workspace.store, {
                claimId: "claim:early-child",
                nowMilliseconds: 1_500,
                scopeId: childScopeId,
            }),
        ScopeEvidenceError,
    );
    assert.throws(
        () =>
            claimScopeWriters(workspace.store, {
                claims: [
                    { claimId: "claim:early-child", scopeId: childScopeId },
                    { claimId: "claim:root", scopeId: workspace.root.scope_id },
                ],
                nowMilliseconds: 1_500,
            }),
        ScopeEvidenceError,
    );
    const custodyId = prepared?.world?.custody_id ?? "";
    const custody = await workspace.carrier.openCustody(custodyId);
    workspace.store.close();

    using recovered = new SQLiteTraceStore(workspace.databasePath);
    // An expired parent fence cannot complete the prepared fork.
    await assert.rejects(
        forkScope(recovered, {
            ...forkOptions(workspace, origin.revision_id),
            parent: claimScopeWriter(recovered, {
                claimId: "claim:root",
                nowMilliseconds: 1_500,
                scopeId: workspace.root.scope_id,
            }),
            nowMilliseconds: 40_000,
        }),
        ScopeWriterFencedError,
    );
    const parent = claimScopeWriter(recovered, {
        claimId: "claim:recovered-root",
        nowMilliseconds: 40_000,
        scopeId: workspace.root.scope_id,
    });
    const retry = {
        ...forkOptions(workspace, origin.revision_id),
        nowMilliseconds: 40_000,
        parent,
    };

    // Modified custody is an unknown physical state and is never re-copied over.
    await writeFile(path.join(custody.path, "file.txt"), "tampered\n");
    await assert.rejects(forkScope(recovered, retry), ScopeEvidenceError);
    assert.equal(inspectScope(recovered, childScopeId)?.world?.status, "prepared");

    // Discarded custody is contradictory carrier evidence.
    await workspace.carrier.discard(custodyId);
    await assert.rejects(forkScope(recovered, retry), WorldCarrierError);
    assert.equal(inspectScope(recovered, childScopeId)?.world?.status, "prepared");
});

test("an absent custody receipt is republished by deterministic identity and completes", async (context) => {
    const workspace = await createForkWorkspace(
        context,
        "absent",
        InterruptedBeforeCompletionStore,
    );
    const origin = await workspace.carrier.snapshot(workspace.source);
    await assert.rejects(forkScope(workspace.store, forkOptions(workspace, origin.revision_id)));
    const [childScopeId] = inspectScope(workspace.store, workspace.root.scope_id)?.children ?? [];
    const custodyId = inspectScope(workspace.store, childScopeId ?? "")?.world?.custody_id ?? "";
    const custody = await workspace.carrier.openCustody(custodyId);
    await rm(path.dirname(custody.path), { force: true, recursive: true });
    releaseScopeWriter(workspace.store, { writer: workspace.rootWriter });
    workspace.store.close();

    using recovered = new SQLiteTraceStore(workspace.databasePath);
    const parent = claimScopeWriter(recovered, {
        claimId: "claim:recovered-root",
        nowMilliseconds: 2_000,
        scopeId: workspace.root.scope_id,
    });
    const fork = await forkScope(recovered, {
        ...forkOptions(workspace, origin.revision_id),
        nowMilliseconds: 2_000,
        parent,
    });
    assert.equal(fork.world.custody_id, custodyId);
    assert.equal((await workspace.carrier.verifyCustody(custodyId)).modified, false);
});

test("fork receipt replay fails closed when retained journal evidence is inconsistent", async (context) => {
    const workspace = await createForkWorkspace(context, "inconsistent");
    const origin = await workspace.carrier.snapshot(workspace.source);
    await forkScope(workspace.store, forkOptions(workspace, origin.revision_id));
    workspace.store.close();
    using missing = new MissingPreparedJournalStore(workspace.databasePath);
    assert.throws(() => readScopeCommandReceipt(missing, "scope-command:fork"), ScopeEvidenceError);
});

test("physical fork work requires a current parent fence and no admitted child writer", async (context) => {
    for (const label of ["stale-fence", "admitted-writer"] as const) {
        const workspace = await createForkWorkspace(context, label, InterruptedAfterPreparedStore);
        const origin = await workspace.carrier.snapshot(workspace.source);
        await assert.rejects(
            forkScope(workspace.store, forkOptions(workspace, origin.revision_id)),
        );
        const [childScopeId] =
            inspectScope(workspace.store, workspace.root.scope_id)?.children ?? [];
        assert.ok(childScopeId);
        workspace.store.close();
        const custodiesRoot = path.join(workspace.workspaceRoot, ".vcscore", "worlds", "custodies");
        assert.deepEqual(await readdir(custodiesRoot), []);

        using recovered = new SQLiteTraceStore(workspace.databasePath);
        if (label === "stale-fence") {
            // The unexpired original claim is re-minted, then used after its lease expired.
            const stale = claimScopeWriter(recovered, {
                claimId: "claim:root",
                nowMilliseconds: 1_500,
                scopeId: workspace.root.scope_id,
            });
            await assert.rejects(
                forkScope(recovered, {
                    ...forkOptions(workspace, origin.revision_id),
                    nowMilliseconds: 40_000,
                    parent: stale,
                }),
                ScopeWriterFencedError,
            );
        } else {
            const database = new DatabaseSync(workspace.databasePath);
            database
                .prepare(
                    "INSERT INTO scope_writer_claims(scope_id, claim_id, fencing_token, lease_expires_at, released) VALUES (?, ?, 1, 0, 1)",
                )
                .run(childScopeId, "claim:smuggled");
            database.close();
            const parent = claimScopeWriter(recovered, {
                claimId: "claim:root",
                nowMilliseconds: 1_500,
                scopeId: workspace.root.scope_id,
            });
            await assert.rejects(
                forkScope(recovered, { ...forkOptions(workspace, origin.revision_id), parent }),
                ScopeEvidenceError,
            );
        }
        assert.deepEqual(await readdir(custodiesRoot), [], label);
        assert.equal(inspectScope(recovered, childScopeId)?.world?.status, "prepared", label);
    }
});
