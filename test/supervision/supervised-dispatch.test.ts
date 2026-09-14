import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import {
    AppendIntentConflictError,
    createEffectHandlerStack,
    deriveSupervisedDispatchId,
    dispatchSupervisedEffect,
    type EffectIntent,
    inspectSupervisedDispatch,
    resolveSupervisedApproval,
    SQLiteTraceStore,
    SUPERVISION_INTERCEPTION_LIMITS,
    SupervisionApprovalConflictError,
    SupervisionEvidenceError,
    type SupervisionInterceptionRequest,
    SupervisionLeaseConflictError,
    SupervisionLeaseFencedError,
    SupervisionMaterializationUncertainError,
    validateEffectCorrelation,
} from "../../src/index.ts";
import {
    always,
    appendOwnerRecord,
    eventually,
    intentOf,
    interceptor,
    recordingHandlers,
    temporaryDatabasePath,
} from "./fixtures.ts";

test("allowed effects run interceptors in canonical order, materialize once, and replay", async () => {
    using store = new SQLiteTraceStore();
    const cited = appendOwnerRecord(store, "worker:a", "context");
    const calls: SupervisionInterceptionRequest[] = [];
    const invocations: EffectIntent[] = [];
    const record = (request: SupervisionInterceptionRequest) => {
        calls.push(request);
        return { decision: "allow" } as const;
    };
    const options = {
        citedRecordIds: [cited],
        claimId: "dispatcher:1",
        commandId: "effect:allow",
        handlers: recordingHandlers(invocations),
        intent: intentOf(),
        interceptors: [
            interceptor("policy:z", record, { priority: 1 }),
            interceptor("policy:b", record, { priority: 0 }),
            interceptor("policy:a", record, { priority: 0 }),
        ],
    };
    const result = await dispatchSupervisedEffect(store, options);
    assert.deepEqual(
        calls.map((call) => [call.interceptor_id, call.position, call.decisions.length]),
        [
            ["policy:a", 0, 0],
            ["policy:b", 1, 1],
            ["policy:z", 2, 2],
        ],
    );
    assert.equal(calls[0]?.signal.aborted, true);
    assert.deepEqual(calls[0]?.cited_record_ids, [cited]);
    assert.equal(invocations.length, 1);
    assert.equal(result.dispatch_id, deriveSupervisedDispatchId("effect:allow"));
    assert.equal(result.recovery, "resolved");
    assert.equal(result.resolution?.disposition, "materialized");
    assert.equal(result.resolution?.handler_id, "handler:file");
    validateEffectCorrelation(result.effective_intent, result.resolution?.outcome);
    assert.deepEqual(
        result.interceptors.map((entry) => entry.interceptor_id),
        ["policy:a", "policy:b", "policy:z"],
    );
    assert.equal(result.lease?.released, true);
    assert.ok(result.admission_record_id);
    const dispatchRecord = store.readRecord(result.dispatch_record_id);
    assert.deepEqual(dispatchRecord?.envelope.caused_by_record_ids, [cited]);
    assert.equal(dispatchRecord?.envelope.mode, "declaration");
    const replay = await dispatchSupervisedEffect(store, options);
    assert.deepEqual(replay, result);
    assert.equal(calls.length, 3);
    assert.equal(invocations.length, 1);
    assert.deepEqual(inspectSupervisedDispatch(store, { dispatchId: result.dispatch_id }), result);
    await assert.rejects(
        dispatchSupervisedEffect(store, { ...options, intent: intentOf("compensable") }),
        AppendIntentConflictError,
    );
    assert.equal(store.verifyIntegrity().ok, true);
});

test("denial resolves before admission and skips later interceptors and the handler", async () => {
    using store = new SQLiteTraceStore();
    const invocations: EffectIntent[] = [];
    let later = 0;
    const result = await dispatchSupervisedEffect(store, {
        claimId: "dispatcher:1",
        commandId: "effect:deny",
        handlers: recordingHandlers(invocations),
        intent: intentOf("irreversible"),
        interceptors: [
            interceptor("policy:deny", always({ decision: "deny", reason: "destructive" })),
            interceptor(
                "policy:later",
                () => {
                    later += 1;
                    return { decision: "allow" };
                },
                { priority: 1 },
            ),
        ],
    });
    assert.equal(result.resolution?.disposition, "denied");
    assert.equal(result.resolution?.outcome, null);
    assert.equal(result.admission_record_id, null);
    assert.deepEqual(
        result.decisions.map((entry) => [entry.decision, entry.source, entry.reason]),
        [["deny", "interceptor", "destructive"]],
    );
    assert.equal(later, 0);
    assert.equal(invocations.length, 0);
});

test("replacement strengthens reversibility for later interceptors, approval, and the handler", async () => {
    using store = new SQLiteTraceStore();
    const invocations: EffectIntent[] = [];
    const seen: EffectIntent[] = [];
    const running = dispatchSupervisedEffect(store, {
        approvalTimeoutMilliseconds: 5_000,
        claimId: "dispatcher:1",
        commandId: "effect:replace",
        handlers: recordingHandlers(invocations),
        intent: intentOf("compensable"),
        interceptors: [
            interceptor(
                "policy:rewrite",
                always({
                    decision: "replace",
                    payload: { path: "drafts/notes.txt" },
                    reason: "confine writes",
                    reversibility: "irreversible",
                }),
            ),
            interceptor(
                "policy:observe",
                ({ intent }) => {
                    seen.push(intent);
                    return { decision: "replace", payload: intent.payload, reason: "same tier" };
                },
                { priority: 1 },
            ),
        ],
    });
    const dispatchId = deriveSupervisedDispatchId("effect:replace");
    await eventually(
        () => inspectSupervisedDispatch(store, { dispatchId }).pending_approval !== null,
    );
    const pending = inspectSupervisedDispatch(store, { dispatchId });
    assert.equal(pending.recovery, "approval_pending");
    assert.equal(pending.pending_approval?.gate, "irreversible_frontier");
    assert.equal(pending.pending_approval?.position, null);
    resolveSupervisedApproval(store, {
        approverId: "reviewer",
        commandId: "approval:replace",
        dispatchId,
        requestRecordId: pending.pending_approval?.request_record_id as string,
        verdict: "approved",
    });
    const result = await running;
    assert.deepEqual(
        seen.map((intent) => [intent.payload, intent.reversibility]),
        [[{ path: "drafts/notes.txt" }, "irreversible"]],
    );
    assert.deepEqual(
        result.decisions.map((entry) => [
            entry.decision,
            entry.source,
            entry.replacement?.reversibility,
        ]),
        [
            ["replace", "interceptor", "irreversible"],
            ["replace", "interceptor", "irreversible"],
        ],
    );
    assert.equal(result.intent.reversibility, "compensable");
    assert.equal(result.effective_intent.reversibility, "irreversible");
    assert.equal(result.resolution?.disposition, "materialized");
    assert.deepEqual(
        invocations.map((intent) => intent.payload),
        [{ path: "drafts/notes.txt" }],
    );
    validateEffectCorrelation(result.effective_intent, result.resolution?.outcome);
});

test("replacement keeps a reversible effect open when its failure policy fails open", async () => {
    using store = new SQLiteTraceStore();
    const invocations: EffectIntent[] = [];
    const result = await dispatchSupervisedEffect(store, {
        claimId: "dispatcher:1",
        commandId: "effect:replace-open",
        handlers: recordingHandlers(invocations),
        intent: intentOf("compensable"),
        interceptors: [
            interceptor(
                "policy:weaken",
                always({
                    decision: "replace",
                    payload: { path: "x" },
                    reason: "weaken",
                    reversibility: "reversible",
                }),
                { timeoutPolicy: "fail_open" },
            ),
            interceptor(
                "policy:rewrite",
                always({
                    decision: "replace",
                    payload: { path: "drafts/notes.txt" },
                    reason: "confine",
                }),
                { priority: 1 },
            ),
        ],
    });
    assert.deepEqual(
        result.decisions.map((entry) => [entry.decision, entry.source]),
        [
            ["allow", "failure"],
            ["replace", "interceptor"],
        ],
    );
    assert.deepEqual(
        invocations.map((intent) => intent.payload),
        [{ path: "drafts/notes.txt" }],
    );
    assert.equal(result.effective_intent.reversibility, "compensable");
    assert.equal(result.resolution?.disposition, "materialized");
});

test("pauses wait for approval, rejection resolves, and expiry fails closed", async () => {
    using store = new SQLiteTraceStore();
    const invocations: EffectIntent[] = [];
    const pause = interceptor(
        "policy:pause",
        always({ decision: "pause", reason: "needs review" }),
    );
    const approved = dispatchSupervisedEffect(store, {
        claimId: "dispatcher:1",
        commandId: "effect:pause-approved",
        handlers: recordingHandlers(invocations),
        intent: intentOf("irreversible"),
        interceptors: [pause],
    });
    const approvedId = deriveSupervisedDispatchId("effect:pause-approved");
    await eventually(
        () =>
            inspectSupervisedDispatch(store, { dispatchId: approvedId }).pending_approval !== null,
    );
    const request = inspectSupervisedDispatch(store, { dispatchId: approvedId }).pending_approval;
    assert.equal(request?.gate, "interceptor_pause");
    assert.equal(request?.position, 0);
    assert.equal(request?.reason, "needs review");
    assert.throws(
        () =>
            resolveSupervisedApproval(store, {
                approverId: "reviewer",
                commandId: "approval:wrong",
                dispatchId: approvedId,
                requestRecordId: inspectSupervisedDispatch(store, { dispatchId: approvedId })
                    .dispatch_record_id,
                verdict: "approved",
            }),
        SupervisionApprovalConflictError,
    );
    const receipt = resolveSupervisedApproval(store, {
        approverId: "reviewer",
        commandId: "approval:ok",
        dispatchId: approvedId,
        reason: "looks safe",
        requestRecordId: request?.request_record_id as string,
        verdict: "approved",
    });
    const result = await approved;
    assert.equal(result.resolution?.disposition, "materialized");
    assert.equal(
        result.approvals.length,
        1,
        "the pause approval satisfies the irreversible frontier",
    );
    assert.deepEqual(result.approvals[0]?.verdict, {
        approver_id: "reviewer",
        command_id: "approval:ok",
        owner_ordinal: receipt.owner_ordinal,
        reason: "looks safe",
        record_id: receipt.record_id,
        verdict: "approved",
    });
    assert.deepEqual(
        resolveSupervisedApproval(store, {
            approverId: "reviewer",
            commandId: "approval:ok",
            dispatchId: approvedId,
            reason: "looks safe",
            requestRecordId: request?.request_record_id as string,
            verdict: "approved",
        }),
        receipt,
    );
    assert.throws(
        () =>
            resolveSupervisedApproval(store, {
                approverId: "reviewer",
                commandId: "approval:late",
                dispatchId: approvedId,
                requestRecordId: request?.request_record_id as string,
                verdict: "rejected",
            }),
        SupervisionApprovalConflictError,
    );

    const rejected = dispatchSupervisedEffect(store, {
        claimId: "dispatcher:1",
        commandId: "effect:pause-rejected",
        handlers: recordingHandlers(invocations),
        intent: intentOf(),
        interceptors: [pause],
    });
    const rejectedId = deriveSupervisedDispatchId("effect:pause-rejected");
    await eventually(
        () =>
            inspectSupervisedDispatch(store, { dispatchId: rejectedId }).pending_approval !== null,
    );
    resolveSupervisedApproval(store, {
        approverId: "reviewer",
        commandId: "approval:no",
        dispatchId: rejectedId,
        requestRecordId: inspectSupervisedDispatch(store, { dispatchId: rejectedId })
            .pending_approval?.request_record_id as string,
        verdict: "rejected",
    });
    assert.equal((await rejected).resolution?.disposition, "rejected");

    const expired = await dispatchSupervisedEffect(store, {
        approvalTimeoutMilliseconds: 20,
        claimId: "dispatcher:1",
        commandId: "effect:frontier-expired",
        handlers: recordingHandlers(invocations),
        intent: intentOf("irreversible"),
    });
    assert.equal(expired.resolution?.disposition, "rejected");
    assert.deepEqual(
        expired.approvals.map((entry) => [
            entry.gate,
            entry.verdict?.verdict,
            entry.verdict?.approver_id,
        ]),
        [["irreversible_frontier", "expired", null]],
    );
    assert.equal(invocations.length, 1);
});

test("timeouts and failures apply declared policy, and irreversible tiers always fail closed", async () => {
    using store = new SQLiteTraceStore();
    const invocations: EffectIntent[] = [];
    const hang = () => new Promise<never>(() => {});
    const open = await dispatchSupervisedEffect(store, {
        claimId: "dispatcher:1",
        commandId: "effect:timeout-open",
        handlers: recordingHandlers(invocations),
        intent: intentOf(),
        interceptors: [
            interceptor("policy:hang", hang, {
                timeoutMilliseconds: 20,
                timeoutPolicy: "fail_open",
            }),
            interceptor(
                "policy:throw",
                () => {
                    throw new Error("supervisor crashed");
                },
                { priority: 1, timeoutPolicy: "fail_open" },
            ),
            interceptor("policy:malformed", () => ({ decision: "maybe" }) as never, {
                priority: 2,
                timeoutPolicy: "fail_open",
            }),
            interceptor("policy:extra", () => ({ decision: "allow", extra: true }) as never, {
                priority: 3,
                timeoutPolicy: "fail_open",
            }),
        ],
    });
    assert.deepEqual(
        open.decisions.map((entry) => [entry.decision, entry.source, entry.applied_policy]),
        [
            ["allow", "timeout", "fail_open"],
            ["allow", "failure", "fail_open"],
            ["allow", "failure", "fail_open"],
            ["allow", "failure", "fail_open"],
        ],
    );
    assert.equal(open.resolution?.disposition, "materialized");
    const closed = await dispatchSupervisedEffect(store, {
        claimId: "dispatcher:1",
        commandId: "effect:timeout-irreversible",
        handlers: recordingHandlers(invocations),
        intent: intentOf("irreversible"),
        interceptors: [
            interceptor("policy:hang", hang, {
                timeoutMilliseconds: 20,
                timeoutPolicy: "fail_open",
            }),
        ],
    });
    assert.deepEqual(
        closed.decisions.map((entry) => [entry.decision, entry.source, entry.applied_policy]),
        [["deny", "timeout", "fail_closed"]],
    );
    assert.equal(closed.resolution?.disposition, "denied");
    assert.equal(invocations.length, 1);
});

test("abort signals cancel dispatches before admission, including while waiting", async () => {
    using store = new SQLiteTraceStore();
    const invocations: EffectIntent[] = [];
    const early = new AbortController();
    early.abort();
    const before = await dispatchSupervisedEffect(store, {
        claimId: "dispatcher:1",
        commandId: "effect:cancel-early",
        handlers: recordingHandlers(invocations),
        intent: intentOf(),
        signal: early.signal,
    });
    assert.equal(before.resolution?.disposition, "cancelled");

    const deciding = new AbortController();
    let interceptorSignal: AbortSignal | undefined;
    const duringDecision = dispatchSupervisedEffect(store, {
        claimId: "dispatcher:1",
        commandId: "effect:cancel-deciding",
        handlers: recordingHandlers(invocations),
        intent: intentOf(),
        interceptors: [
            interceptor(
                "policy:hang",
                ({ signal }) => {
                    interceptorSignal = signal;
                    return new Promise<never>(() => {});
                },
                { timeoutMilliseconds: 60_000 },
            ),
        ],
        signal: deciding.signal,
    });
    await eventually(() => interceptorSignal !== undefined);
    deciding.abort();
    const decided = await duringDecision;
    assert.equal(decided.resolution?.disposition, "cancelled");
    assert.equal(decided.decisions.length, 0);
    assert.equal(interceptorSignal?.aborted, true);

    const approving = new AbortController();
    const duringApproval = dispatchSupervisedEffect(store, {
        claimId: "dispatcher:1",
        commandId: "effect:cancel-approval",
        handlers: recordingHandlers(invocations),
        intent: intentOf("irreversible"),
        signal: approving.signal,
    });
    const approvalId = deriveSupervisedDispatchId("effect:cancel-approval");
    await eventually(
        () =>
            inspectSupervisedDispatch(store, { dispatchId: approvalId }).pending_approval !== null,
    );
    approving.abort();
    const cancelled = await duringApproval;
    assert.equal(cancelled.resolution?.disposition, "cancelled");
    assert.equal(cancelled.pending_approval?.verdict, null);
    assert.equal(invocations.length, 0);
});

test("handler failures resolve without an outcome", async () => {
    using store = new SQLiteTraceStore();
    const result = await dispatchSupervisedEffect(store, {
        claimId: "dispatcher:1",
        commandId: "effect:handler-throws",
        handlers: createEffectHandlerStack([
            {
                handle: () => {
                    throw new Error("disk full");
                },
                handlerId: "handler:file",
                kind: "file.write",
            },
        ]),
        intent: intentOf(),
    });
    assert.equal(result.resolution?.disposition, "materialization_failed");
    assert.equal(result.resolution?.outcome, null);
    assert.equal(result.resolution?.handler_id, null);
    const malformed: readonly (() => unknown)[] = [
        () => {
            throw new Error("synchronous dispatch failure");
        },
        async () => ({ handlerId: "handler:file", outcome: { bogus: true } }),
        async () => ({ handlerId: "", outcome: null }),
    ];
    for (const [index, dispatch] of malformed.entries()) {
        const failed = await dispatchSupervisedEffect(store, {
            claimId: "dispatcher:1",
            commandId: `effect:handler-malformed:${index}`,
            handlers: { dispatch } as never,
            intent: intentOf(),
        });
        assert.equal(failed.resolution?.disposition, "materialization_failed");
        assert.equal(failed.recovery, "resolved");
    }
});

test("decision leases fence stale dispatchers and a replacement resumes without re-deciding", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "lease");
    using store = new SQLiteTraceStore(databasePath);
    using other = new SQLiteTraceStore(databasePath);
    const invocations: EffectIntent[] = [];
    let release: (() => void) | undefined;
    let firstCalls = 0;
    const first = dispatchSupervisedEffect(store, {
        claimId: "dispatcher:first",
        commandId: "effect:lease",
        handlers: recordingHandlers(invocations),
        intent: intentOf(),
        interceptors: [
            interceptor("policy:allow", () => {
                firstCalls += 1;
                return new Promise((resolve) => {
                    release = () => resolve({ decision: "allow" });
                });
            }),
            interceptor("policy:second", always({ decision: "allow" }), { priority: 1 }),
        ],
    });
    await eventually(() => release !== undefined);
    const dispatchId = deriveSupervisedDispatchId("effect:lease");
    const pendingInspection = inspectSupervisedDispatch(other, { dispatchId });
    assert.equal(pendingInspection.recovery, "decision_pending");
    assert.equal(pendingInspection.lease?.claim_id, "dispatcher:first");
    const replacementOptions = {
        claimId: "dispatcher:second",
        commandId: "effect:lease",
        handlers: recordingHandlers(invocations),
        intent: intentOf(),
        interceptors: [
            interceptor("policy:allow", always({ decision: "allow" })),
            interceptor("policy:second", always({ decision: "allow" }), { priority: 1 }),
        ],
    };
    await assert.rejects(
        dispatchSupervisedEffect(other, replacementOptions),
        (error) =>
            error instanceof SupervisionLeaseConflictError && error.claim_id === "dispatcher:first",
    );
    const expiredClock = () =>
        Date.now() + SUPERVISION_INTERCEPTION_LIMITS.decisionLeaseMilliseconds + 1;
    const replaced = await dispatchSupervisedEffect(other, {
        ...replacementOptions,
        clock: expiredClock,
    });
    assert.equal(replaced.resolution?.disposition, "materialized");
    assert.equal(replaced.lease?.fencing_token, 2);
    release?.();
    await assert.rejects(
        first,
        (error) =>
            error instanceof SupervisionLeaseFencedError && error.claim_id === "dispatcher:first",
    );
    assert.equal(firstCalls, 1);
    assert.equal(invocations.length, 1);
    assert.equal(store.verifyIntegrity().ok, true);
});

test("lease renewal keeps a waiting dispatcher authoritative and detects loss", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "renewal");
    using store = new SQLiteTraceStore(databasePath);
    let now = 1_000_000;
    const renewal = SUPERVISION_INTERCEPTION_LIMITS.leaseRenewalMilliseconds;
    const advancing = () => {
        now += renewal / 4;
        return now;
    };
    let resolveDecision: (() => void) | undefined;
    const running = dispatchSupervisedEffect(store, {
        claimId: "dispatcher:renewing",
        clock: advancing,
        commandId: "effect:renewal",
        handlers: recordingHandlers(),
        intent: intentOf(),
        interceptors: [
            interceptor(
                "policy:slow",
                () =>
                    new Promise((resolve) => {
                        resolveDecision = () => resolve({ decision: "allow" });
                    }),
            ),
        ],
    });
    await eventually(() => resolveDecision !== undefined);
    const dispatchId = deriveSupervisedDispatchId("effect:renewal");
    const before = inspectSupervisedDispatch(store, { dispatchId }).lease
        ?.lease_expires_at as number;
    await eventually(
        () =>
            (inspectSupervisedDispatch(store, { dispatchId }).lease?.lease_expires_at as number) >
            before,
    );
    resolveDecision?.();
    assert.equal((await running).resolution?.disposition, "materialized");

    let stalled: (() => void) | undefined;
    const losing = dispatchSupervisedEffect(store, {
        claimId: "dispatcher:losing",
        clock: advancing,
        commandId: "effect:renewal-lost",
        handlers: recordingHandlers(),
        intent: intentOf(),
        interceptors: [
            interceptor(
                "policy:stall",
                () =>
                    new Promise((resolve) => {
                        stalled = () => resolve({ decision: "allow" });
                    }),
            ),
        ],
    });
    await eventually(() => stalled !== undefined);
    const database = new DatabaseSync(databasePath);
    database
        .prepare(
            "UPDATE supervised_dispatches SET fencing_token = fencing_token + 1 WHERE dispatch_id = ?",
        )
        .run(deriveSupervisedDispatchId("effect:renewal-lost"));
    database.close();
    await assert.rejects(losing, SupervisionLeaseFencedError);

    // Each wait and append stays below the renewal interval, but together they outlive the lease.
    let stepped = 2_000_000;
    const shortSteps = () => {
        stepped += Math.floor(renewal * 0.6);
        return stepped;
    };
    const manySteps = await dispatchSupervisedEffect(store, {
        claimId: "dispatcher:cumulative",
        clock: shortSteps,
        commandId: "effect:renewal-cumulative",
        handlers: recordingHandlers(),
        intent: intentOf(),
        interceptors: Array.from({ length: 6 }, (_, index) =>
            interceptor(`policy:${index}`, always({ decision: "allow" }), { priority: index }),
        ),
    });
    assert.equal(manySteps.resolution?.disposition, "materialized");
});

test("reopening with the same claim identity mints a new fence", async () => {
    using store = new SQLiteTraceStore();
    let release: (() => void) | undefined;
    const options = {
        claimId: "dispatcher:shared",
        commandId: "effect:shared-claim",
        handlers: recordingHandlers(),
        intent: intentOf(),
        interceptors: [
            interceptor(
                "policy:slow",
                () =>
                    new Promise<{ readonly decision: "allow" }>((resolve) => {
                        release = () => resolve({ decision: "allow" });
                    }),
            ),
        ],
    };
    const first = dispatchSupervisedEffect(store, options);
    await eventually(() => release !== undefined);
    const firstRelease = release as () => void;
    release = undefined;
    const second = dispatchSupervisedEffect(store, options);
    await eventually(() => release !== undefined);
    const dispatchId = deriveSupervisedDispatchId("effect:shared-claim");
    assert.equal(inspectSupervisedDispatch(store, { dispatchId }).lease?.fencing_token, 2);
    firstRelease();
    await assert.rejects(first, SupervisionLeaseFencedError);
    (release as (() => void) | undefined)?.();
    assert.equal((await second).resolution?.disposition, "materialized");
});

test("admission without resolution is uncertain and never re-invokes the handler", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "uncertain");
    using store = new SQLiteTraceStore(databasePath);
    using other = new SQLiteTraceStore(databasePath);
    let invoked = 0;
    let finish: (() => void) | undefined;
    const hanging = createEffectHandlerStack([
        {
            handle: () => {
                invoked += 1;
                return new Promise((resolve) => {
                    finish = () => resolve({ ok: true, value: null });
                });
            },
            handlerId: "handler:hang",
            kind: "file.write",
        },
    ]);
    const first = dispatchSupervisedEffect(store, {
        claimId: "dispatcher:first",
        commandId: "effect:uncertain",
        handlers: hanging,
        intent: intentOf(),
    });
    await eventually(() => invoked === 1);
    const dispatchId = deriveSupervisedDispatchId("effect:uncertain");
    const inspection = inspectSupervisedDispatch(other, { dispatchId });
    assert.equal(inspection.recovery, "materialization_uncertain");
    await assert.rejects(
        dispatchSupervisedEffect(other, {
            claimId: "dispatcher:second",
            clock: () => Date.now() + SUPERVISION_INTERCEPTION_LIMITS.decisionLeaseMilliseconds + 1,
            commandId: "effect:uncertain",
            handlers: recordingHandlers(),
            intent: intentOf(),
        }),
        (error) =>
            error instanceof SupervisionMaterializationUncertainError &&
            error.dispatch_id === dispatchId &&
            error.admission_record_id === inspection.admission_record_id,
    );
    assert.equal(invoked, 1);
    finish?.();
    await assert.rejects(first, SupervisionLeaseFencedError);
    assert.equal(
        inspectSupervisedDispatch(other, { dispatchId }).recovery,
        "materialization_uncertain",
    );
});

test("imported dispatches are inspectable without lease evidence and cannot be resumed", async () => {
    using source = new SQLiteTraceStore();
    const result = await dispatchSupervisedEffect(source, {
        claimId: "dispatcher:1",
        commandId: "effect:imported",
        handlers: recordingHandlers(),
        intent: intentOf(),
        interceptors: [interceptor("policy:allow", always({ decision: "allow" }))],
    });
    using imported = new SQLiteTraceStore();
    imported.importTrace(source.exportTrace());
    const inspection = inspectSupervisedDispatch(imported, { dispatchId: result.dispatch_id });
    assert.deepEqual(inspection, { ...result, lease: null });
    await assert.rejects(
        dispatchSupervisedEffect(imported, {
            claimId: "dispatcher:1",
            commandId: "effect:imported",
            handlers: recordingHandlers(),
            intent: intentOf(),
            interceptors: [interceptor("policy:allow", always({ decision: "allow" }))],
        }),
        /not registered for mutation/u,
    );
    assert.throws(
        () =>
            resolveSupervisedApproval(imported, {
                approverId: "reviewer",
                commandId: "approval:imported",
                dispatchId: result.dispatch_id,
                requestRecordId: result.dispatch_record_id,
                verdict: "approved",
            }),
        /not registered for mutation/u,
    );
    assert.throws(
        () =>
            inspectSupervisedDispatch(imported, {
                dispatchId: deriveSupervisedDispatchId("effect:absent"),
            }),
        SupervisionEvidenceError,
    );
});

test("dispatch options are validated before any record is retained", async () => {
    using store = new SQLiteTraceStore();
    const base = {
        claimId: "dispatcher:1",
        commandId: "effect:invalid",
        handlers: recordingHandlers(),
        intent: intentOf(),
    };
    const decide = always({ decision: "allow" });
    const tooMany = Array.from(
        { length: SUPERVISION_INTERCEPTION_LIMITS.maxInterceptors + 1 },
        (_, index) => interceptor(`policy:${index}`, decide),
    );
    const invalid: readonly unknown[] = [
        { ...base, claimId: "" },
        { ...base, handlers: {} },
        { ...base, clock: 5 },
        { ...base, clock: () => -1 },
        { ...base, approvalTimeoutMilliseconds: 0 },
        { ...base, citedRecordIds: ["sha256:bad"] },
        { ...base, interceptors: tooMany },
        {
            ...base,
            interceptors: [interceptor("policy:a", decide), interceptor("policy:a", decide)],
        },
        { ...base, interceptors: [{ ...interceptor("policy:a", decide), priority: 0.5 }] },
        { ...base, interceptors: [{ ...interceptor("policy:a", decide), timeoutMilliseconds: 0 }] },
        { ...base, interceptors: [{ ...interceptor("policy:a", decide), timeoutPolicy: "maybe" }] },
        { ...base, interceptors: [{ ...interceptor("policy:a", decide), decide: "allow" }] },
        { ...base, signal: {} },
    ];
    for (const options of invalid) {
        await assert.rejects(dispatchSupervisedEffect(store, options as never), TypeError);
    }
    await assert.rejects(
        dispatchSupervisedEffect(store, { ...base, citedRecordIds: [`sha256:${"0".repeat(64)}`] }),
        SupervisionEvidenceError,
    );
    assert.equal(store.readOwner(deriveSupervisedDispatchId("effect:invalid")).length, 0);
    assert.throws(() => inspectSupervisedDispatch(store, { dispatchId: "dispatch" }), TypeError);
    const resolveBase = {
        approverId: "reviewer",
        commandId: "approval:invalid",
        dispatchId: deriveSupervisedDispatchId("effect:invalid"),
        requestRecordId: `sha256:${"0".repeat(64)}`,
        verdict: "approved",
    };
    for (const options of [
        { ...resolveBase, verdict: "expired" },
        { ...resolveBase, approverId: "" },
        { ...resolveBase, reason: "" },
        { ...resolveBase, dispatchId: "scope:x" },
    ]) {
        assert.throws(() => resolveSupervisedApproval(store, options as never), TypeError);
    }
    assert.throws(() => resolveSupervisedApproval(store, resolveBase as never), /not registered/u);
});

test("integrity verification classifies dispatch rows that disagree with their records", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "dispatch-integrity");
    {
        using store = new SQLiteTraceStore(databasePath);
        await dispatchSupervisedEffect(store, {
            claimId: "dispatcher:1",
            commandId: "effect:integrity",
            handlers: recordingHandlers(),
            intent: intentOf(),
        });
    }
    const database = new DatabaseSync(databasePath);
    database.prepare("UPDATE supervised_dispatches SET resolved = 0").run();
    database.close();
    using store = new SQLiteTraceStore(databasePath);
    assert.deepEqual(
        store.verifyIntegrity().issues.map((issue) => issue.kind),
        ["supervised_dispatch_mismatch"],
    );
});
