import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import {
    RETAINED_WORLD_SETTLEMENT_VERSION,
    RetainedWorldSettlementConflictError,
    RetainedWorldSettlementInvalidError,
    type RetainedWorldSettlementRequest,
    SQLiteTraceStore,
} from "../../src/index.ts";

const request = Object.freeze({
    action: "select",
    base_revision_id: "world-revision:base",
    binding_id: "workspace-binding:one",
    capture_record_id: "sha256:capture",
    changeset_id: "world-changeset:one",
    command_id: "settlement-command:one",
    custody_id: "world-custody:one",
    execution_cut_id: "cut:one",
    head_revision_id: "world-revision:head",
    output_id: "world-output:one",
    run_id: "run:one",
    settlement_version: RETAINED_WORLD_SETTLEMENT_VERSION,
    user_basis_before: "world-revision:base",
} satisfies RetainedWorldSettlementRequest);

test("retained-world settlement admission is consume-once and replayable after reopen", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-settlement-cas-"));
    context.after(() => rm(directory, { recursive: true, force: true }));
    const databasePath = path.join(directory, "trace.sqlite");
    const firstStore = new SQLiteTraceStore(databasePath);
    const first = firstStore.admitRetainedWorldSettlement(request);
    assert.equal(first.state, "prepared");
    assert.equal(first.action, "select");
    assert.equal(first.output_id, request.output_id);
    assert.equal(first.command_id, request.command_id);
    assert.match(first.request_id, /^world-settlement:sha256:[0-9a-f]{64}$/u);
    assert.equal(Object.isFrozen(first), true);
    assert.equal(Object.isFrozen(first.request), true);
    assert.deepEqual(firstStore.admitRetainedWorldSettlement(request), first);

    const secondStore = new SQLiteTraceStore(databasePath);
    assert.throws(
        () =>
            secondStore.admitRetainedWorldSettlement({
                ...request,
                action: "discard",
                command_id: "settlement-command:two",
            }),
        RetainedWorldSettlementConflictError,
    );
    secondStore.admitRetainedWorldSettlement({
        ...request,
        command_id: "settlement-command:three",
        output_id: "world-output:three",
    });
    assert.throws(
        () =>
            secondStore.admitRetainedWorldSettlement({
                ...request,
                command_id: "settlement-command:three",
            }),
        RetainedWorldSettlementConflictError,
    );
    assert.throws(
        () =>
            secondStore.admitRetainedWorldSettlement({
                ...request,
                output_id: "world-output:two",
            }),
        RetainedWorldSettlementConflictError,
    );
    firstStore.close();
    assert.deepEqual(secondStore.readRetainedWorldSettlement(request.output_id), first);
    assert.equal(secondStore.readRetainedWorldSettlement("world-output:absent"), undefined);
    secondStore.close();
});

test("retained-world settlement reads reject malformed or inconsistent stored evidence", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-settlement-corrupt-"));
    context.after(() => rm(directory, { recursive: true, force: true }));
    const databasePath = path.join(directory, "trace.sqlite");
    const store = new SQLiteTraceStore(databasePath);
    store.admitRetainedWorldSettlement(request);
    store.close();

    const database = new DatabaseSync(databasePath);
    database
        .prepare("UPDATE retained_world_settlements SET request_json = ? WHERE output_id = ?")
        .run("{", request.output_id);
    database.close();
    assert.throws(
        () => new SQLiteTraceStore(databasePath).readRetainedWorldSettlement(request.output_id),
        RetainedWorldSettlementInvalidError,
    );

    const repaired = new DatabaseSync(databasePath);
    repaired
        .prepare(
            "UPDATE retained_world_settlements SET request_json = ?, state = ? WHERE output_id = ?",
        )
        .run(JSON.stringify(request), "applying", request.output_id);
    repaired.close();
    using reopened = new SQLiteTraceStore(databasePath);
    assert.throws(
        () => reopened.readRetainedWorldSettlement(request.output_id),
        RetainedWorldSettlementInvalidError,
    );
});

test("retained-world settlement admission rejects malformed exact requests", () => {
    using store = new SQLiteTraceStore();
    assert.throws(
        () => store.admitRetainedWorldSettlement(null as unknown as RetainedWorldSettlementRequest),
        TypeError,
    );
    assert.throws(
        () =>
            store.admitRetainedWorldSettlement({
                ...request,
                settlement_version: RETAINED_WORLD_SETTLEMENT_VERSION + 1,
            }),
        TypeError,
    );
    assert.throws(
        () =>
            store.admitRetainedWorldSettlement({
                ...request,
                action: "apply" as RetainedWorldSettlementRequest["action"],
            }),
        TypeError,
    );
    for (const field of [
        "base_revision_id",
        "binding_id",
        "capture_record_id",
        "changeset_id",
        "command_id",
        "custody_id",
        "execution_cut_id",
        "head_revision_id",
        "output_id",
        "run_id",
        "user_basis_before",
    ] as const) {
        assert.throws(
            () => store.admitRetainedWorldSettlement({ ...request, [field]: "" }),
            TypeError,
        );
    }
    assert.throws(() => store.readRetainedWorldSettlement(""), TypeError);
    assert.throws(
        () =>
            store.admitRetainedWorldSettlement({
                ...request,
                extra: true,
            } as RetainedWorldSettlementRequest),
        TypeError,
    );
    assert.throws(
        () =>
            store.admitRetainedWorldSettlement(
                Object.assign(
                    Object.create({ inherited: true }) as object,
                    request,
                ) as RetainedWorldSettlementRequest,
            ),
        TypeError,
    );
    assert.throws(
        () =>
            store.admitRetainedWorldSettlement({
                ...request,
                [Symbol("extra")]: true,
            } as RetainedWorldSettlementRequest),
        TypeError,
    );
});
