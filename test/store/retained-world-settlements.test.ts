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
import { encodeRetainedWorldApplicationPlan } from "../../src/store/retained-world-application-codec.ts";

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

test("settlement journal transitions replay exactly across connections and reopen", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-settlement-journal-"));
    context.after(() => rm(directory, { recursive: true, force: true }));
    const databasePath = path.join(directory, "trace.sqlite");
    const firstStore = new SQLiteTraceStore(databasePath);
    const admission = firstStore.admitRetainedWorldSettlement(request);
    assert.deepEqual(firstStore.readRetainedWorldSettlementJournal(request.output_id), {
        admission,
        cleanup_completed: null,
        operation: null,
        receipt: null,
        state: "prepared",
    });

    const secondStore = new SQLiteTraceStore(databasePath);
    const applying = firstStore.beginRetainedWorldSettlement(request.output_id);
    assert.equal(applying.state, "applying");
    assert.match(applying.operation?.id ?? "", /^world-settlement-operation:sha256:[0-9a-f]{64}$/u);
    assert.deepEqual(secondStore.beginRetainedWorldSettlement(request.output_id), applying);

    const selected = secondStore.retainRetainedWorldSettlementTerminal(request.output_id, {
        action: "select",
        publication_id: "world-publication:one",
        user_basis_after: "world-content:selected",
    });
    assert.equal(selected.state, "selected");
    assert.equal(selected.cleanup_completed, null);
    assert.deepEqual(
        firstStore.retainRetainedWorldSettlementTerminal(request.output_id, {
            action: "select",
            publication_id: "world-publication:one",
            user_basis_after: "world-content:selected",
        }),
        selected,
    );
    assert.throws(
        () =>
            firstStore.retainRetainedWorldSettlementTerminal(request.output_id, {
                action: "select",
                publication_id: "world-publication:different",
                user_basis_after: "world-content:selected",
            }),
        RetainedWorldSettlementConflictError,
    );
    assert.deepEqual(firstStore.readRetainedWorldSettlement(request.output_id), admission);
    firstStore.close();
    secondStore.close();

    using reopened = new SQLiteTraceStore(databasePath);
    assert.deepEqual(reopened.readRetainedWorldSettlementJournal(request.output_id), selected);
});

test("settlement journal rejects skipped transitions and validates discard receipts", () => {
    using store = new SQLiteTraceStore();
    const discardRequest = Object.freeze({
        ...request,
        action: "discard",
        command_id: "settlement-command:discard",
        output_id: "world-output:discard",
    }) satisfies RetainedWorldSettlementRequest;
    store.admitRetainedWorldSettlement(discardRequest);
    assert.throws(
        () =>
            store.retainRetainedWorldSettlementTerminal(discardRequest.output_id, {
                action: "discard",
                cleanup_completed: false,
                user_basis_after: discardRequest.user_basis_before,
            }),
        RetainedWorldSettlementConflictError,
    );
    assert.equal(
        store.readRetainedWorldSettlementJournal(discardRequest.output_id)?.state,
        "prepared",
    );
    store.beginRetainedWorldSettlement(discardRequest.output_id);
    const discarded = store.retainRetainedWorldSettlementTerminal(discardRequest.output_id, {
        action: "discard",
        cleanup_completed: false,
        user_basis_after: discardRequest.user_basis_before,
    });
    assert.equal(discarded.state, "discarded");
    assert.equal(discarded.cleanup_completed, false);
    assert.deepEqual(
        store.retainRetainedWorldSettlementTerminal(discardRequest.output_id, {
            action: "discard",
            cleanup_completed: false,
            user_basis_after: discardRequest.user_basis_before,
        }),
        discarded,
    );
    const completed = store.completeRetainedWorldSettlementCleanup(discardRequest.output_id);
    assert.equal(completed.cleanup_completed, true);
    assert.deepEqual(
        store.completeRetainedWorldSettlementCleanup(discardRequest.output_id),
        completed,
    );
    assert.deepEqual(
        store.retainRetainedWorldSettlementTerminal(discardRequest.output_id, {
            action: "discard",
            cleanup_completed: false,
            user_basis_after: discardRequest.user_basis_before,
        }),
        completed,
    );
    const pendingRequest = Object.freeze({
        ...discardRequest,
        command_id: "settlement-command:pending",
        output_id: "world-output:pending",
    }) satisfies RetainedWorldSettlementRequest;
    store.admitRetainedWorldSettlement(pendingRequest);
    assert.throws(
        () => store.completeRetainedWorldSettlementCleanup(pendingRequest.output_id),
        RetainedWorldSettlementConflictError,
    );
    assert.throws(
        () =>
            store.retainRetainedWorldSettlementTerminal(discardRequest.output_id, {
                action: "discard",
                cleanup_completed: true,
                user_basis_after: discardRequest.user_basis_before,
            }),
        TypeError,
    );
    assert.throws(
        () => store.beginRetainedWorldSettlement("world-output:missing"),
        RetainedWorldSettlementInvalidError,
    );
    assert.equal(store.readRetainedWorldSettlementJournal("world-output:missing"), undefined);
});

test("application journal binds one exact plan and applied terminal receipt", () => {
    using store = new SQLiteTraceStore();
    const applyRequest = Object.freeze({
        ...request,
        action: "apply",
        command_id: "settlement-command:apply",
        output_id: "world-output:apply",
    }) satisfies RetainedWorldSettlementRequest;
    const admission = store.admitRetainedWorldSettlement(applyRequest);
    const plan = encodeRetainedWorldApplicationPlan({
        application_custody_id: "world-custody:application",
        base_content_id: applyRequest.user_basis_before,
        base_revision_id: applyRequest.base_revision_id,
        binding_id: applyRequest.binding_id,
        candidate_changeset_id: applyRequest.changeset_id,
        candidate_content_id: "world-content:candidate",
        candidate_paths: ["candidate.txt"],
        candidate_revision_id: applyRequest.head_revision_id,
        current_changeset_id: "world-changeset:current",
        current_content_id: "world-content:current",
        current_paths: ["current.txt"],
        current_revision_id: "world-revision:current",
        merged_content_id: "world-content:merged",
        merged_revision_id: "world-revision:merged",
        publication_changeset_id: "world-changeset:publication",
        reason: "path-disjoint",
        request_id: admission.request_id,
        status: "planned",
    });
    const applying = store.beginRetainedWorldSettlement(applyRequest.output_id, plan);
    assert.equal(applying.state, "applying");
    assert.deepEqual(store.beginRetainedWorldSettlement(applyRequest.output_id, plan), applying);
    assert.throws(
        () =>
            store.beginRetainedWorldSettlement(
                applyRequest.output_id,
                encodeRetainedWorldApplicationPlan({
                    application_custody_id: plan.application_custody_id,
                    base_content_id: plan.base_content_id,
                    base_revision_id: plan.base_revision_id,
                    binding_id: plan.binding_id,
                    candidate_changeset_id: plan.candidate_changeset_id,
                    candidate_content_id: plan.candidate_content_id,
                    candidate_paths: plan.candidate_paths,
                    candidate_revision_id: plan.candidate_revision_id,
                    current_changeset_id: plan.current_changeset_id,
                    current_content_id: plan.current_content_id,
                    current_paths: plan.current_paths,
                    current_revision_id: "world-revision:different",
                    merged_content_id: plan.merged_content_id,
                    merged_revision_id: plan.merged_revision_id,
                    publication_changeset_id: plan.publication_changeset_id,
                    reason: plan.reason,
                    request_id: plan.request_id,
                    status: plan.status,
                }),
            ),
        RetainedWorldSettlementConflictError,
    );
    const applied = store.retainRetainedWorldSettlementTerminal(applyRequest.output_id, {
        action: "apply",
        applied_revision_id: plan.merged_revision_id,
        application_plan_id: plan.plan_id,
        publication_id: "world-publication:apply",
        user_basis_after: plan.merged_content_id,
    });
    assert.equal(applied.state, "applied");
    assert.equal(applied.cleanup_completed, null);
    assert.deepEqual(
        store.retainRetainedWorldSettlementTerminal(applyRequest.output_id, {
            action: "apply",
            applied_revision_id: plan.merged_revision_id,
            application_plan_id: plan.plan_id,
            publication_id: "world-publication:apply",
            user_basis_after: plan.merged_content_id,
        }),
        applied,
    );
    assert.throws(
        () => store.completeRetainedWorldSettlementCleanup(applyRequest.output_id),
        RetainedWorldSettlementConflictError,
    );
});

test("release journal preserves custody evidence without cleanup state", () => {
    using store = new SQLiteTraceStore();
    const releaseRequest = Object.freeze({
        ...request,
        action: "release",
        command_id: "settlement-command:release",
        output_id: "world-output:release",
    }) satisfies RetainedWorldSettlementRequest;
    store.admitRetainedWorldSettlement(releaseRequest);
    const releaseBasis = "world-content:current";
    const applying = store.beginRetainedWorldSettlement(
        releaseRequest.output_id,
        null,
        releaseBasis,
    );
    assert.equal(applying.state, "applying");
    assert.deepEqual(
        store.beginRetainedWorldSettlement(
            releaseRequest.output_id,
            null,
            "world-content:later-observation",
        ),
        applying,
    );
    const released = store.retainRetainedWorldSettlementTerminal(releaseRequest.output_id, {
        action: "release",
        changeset_id: releaseRequest.changeset_id,
        custody_id: releaseRequest.custody_id,
        head_revision_id: releaseRequest.head_revision_id,
        user_basis_after: releaseBasis,
        user_basis_before: releaseBasis,
    });
    assert.equal(released.state, "released");
    assert.equal(released.cleanup_completed, null);
    assert.deepEqual(
        store.retainRetainedWorldSettlementTerminal(releaseRequest.output_id, {
            action: "release",
            changeset_id: releaseRequest.changeset_id,
            custody_id: releaseRequest.custody_id,
            head_revision_id: releaseRequest.head_revision_id,
            user_basis_after: releaseBasis,
            user_basis_before: releaseBasis,
        }),
        released,
    );
    assert.throws(
        () => store.completeRetainedWorldSettlementCleanup(releaseRequest.output_id),
        RetainedWorldSettlementConflictError,
    );
});

test("settlement journal reads fail closed for corrupt nullable evidence combinations", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-settlement-journal-corrupt-"));
    context.after(() => rm(directory, { recursive: true, force: true }));
    const corruptions = [
        { phase: "prepared", set: "request_json = 'null'" },
        { phase: "prepared", set: "request_digest = 'corrupt'" },
        { phase: "prepared", set: "operation_id = 'unexpected'" },
        { phase: "prepared", set: "receipt_digest = 'unexpected'" },
        { phase: "prepared", set: "cleanup_completed = 0" },
        { phase: "applying", set: "operation_json = NULL" },
        { phase: "applying", set: "operation_id = 'corrupt'" },
        { phase: "applying", set: "operation_digest = 'corrupt'" },
        { phase: "applying", set: "receipt_digest = 'unexpected'" },
        { phase: "applying", set: "cleanup_completed = 0" },
        { phase: "applying", set: "state = 'unknown'" },
        { phase: "selected", set: "receipt_json = NULL" },
        { phase: "selected", set: "receipt_digest = 'corrupt'" },
        { phase: "selected", set: "cleanup_completed = 1" },
        { phase: "selected", set: "state = 'discarded'" },
    ] as const;
    for (const [index, corruption] of corruptions.entries()) {
        const databasePath = path.join(directory, `trace-${index}.sqlite`);
        const store = new SQLiteTraceStore(databasePath);
        store.admitRetainedWorldSettlement(request);
        if (corruption.phase !== "prepared") store.beginRetainedWorldSettlement(request.output_id);
        if (corruption.phase === "selected") {
            store.retainRetainedWorldSettlementTerminal(request.output_id, {
                action: "select",
                publication_id: "world-publication:one",
                user_basis_after: "world-content:selected",
            });
        }
        store.close();
        const database = new DatabaseSync(databasePath);
        database.exec(
            `UPDATE retained_world_settlements SET ${corruption.set} WHERE output_id = '${request.output_id}'`,
        );
        database.close();
        using reopened = new SQLiteTraceStore(databasePath);
        assert.throws(
            () => reopened.readRetainedWorldSettlementJournal(request.output_id),
            RetainedWorldSettlementInvalidError,
        );
        assert.throws(
            () => reopened.readRetainedWorldSettlement(request.output_id),
            RetainedWorldSettlementInvalidError,
        );
    }
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
                action: "unknown" as RetainedWorldSettlementRequest["action"],
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
