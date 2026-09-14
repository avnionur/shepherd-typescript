import assert from "node:assert/strict";
import { test } from "node:test";
import { createIntentReference } from "../../src/effect/records.ts";
import {
    createEffectIntent,
    createEffectOutcome,
    createRecordId,
    dispatchSupervisedEffect,
    type EffectIntent,
    type OwnerRecord,
    type RecordBody,
    resolveSupervisedApproval,
    SQLiteTraceStore,
    SUPERVISION_LIMITS,
    SupervisionEvidenceError,
    type SupervisionInterceptorDeclaration,
} from "../../src/index.ts";
import { foldSupervisedDispatch } from "../../src/supervision/dispatch-state.ts";
import {
    createSupervisedDispatchId,
    createSupervisionAdmissionBody,
    createSupervisionApprovalRequestBody,
    createSupervisionApprovalVerdictBody,
    createSupervisionContextChannelId,
    createSupervisionDecisionBody,
    createSupervisionDispatchBody,
    createSupervisionResolutionBody,
    decodeSupervisionEvidence,
    readSupervisionApprovalBody,
    readSupervisionDecisionBody,
    readSupervisionDispatchBody,
    readSupervisionReason,
    readSupervisionResolutionBody,
} from "../../src/supervision/records.ts";
import { waitFor } from "../../src/supervision/wait.ts";
import { appendOwnerRecord, eventually, intentOf, recordingHandlers } from "./fixtures.ts";

const SCHEMAS = {
    admission: "shepherd.supervision.admission.v1",
    approval: "shepherd.supervision.approval.v1",
    decision: "shepherd.supervision.decision.v1",
    dispatch: "shepherd.supervision.dispatch.v1",
    resolution: "shepherd.supervision.resolution.v1",
} as const;
const DISPATCH_ID = createSupervisedDispatchId("effect:forged");
const DECLARATION = {
    interceptor_id: "policy:a",
    priority: 0,
    timeout_milliseconds: 10,
    timeout_policy: "fail_open",
} as const;

type Step = readonly [schema: string, body: RecordBody];

function path(
    steps: readonly Step[],
    options: {
        readonly brokenAt?: number;
        readonly extraCauseAt?: number;
        readonly wrongModeAt?: number;
    } = {},
): OwnerRecord[] {
    const records: OwnerRecord[] = [];
    for (const [index, [schema, body]] of steps.entries()) {
        const recordId = createRecordId({ forged: index, schema });
        const previous = records[index - 1]?.envelope.record_id;
        const causes =
            previous === undefined ? [] : [options.brokenAt === index ? recordId : previous];
        const declared = schema === SCHEMAS.dispatch || schema === SCHEMAS.admission;
        records.push({
            body,
            envelope: {
                caused_by_record_ids:
                    options.extraCauseAt === index ? [...causes, recordId] : causes,
                digest: recordId,
                mode: declared === (options.wrongModeAt === index) ? "capture" : "declaration",
                record_id: recordId,
                schema_ref: schema,
                witness_ref: "",
            },
            view: { owner_id: DISPATCH_ID, owner_ordinal: index },
        });
    }
    return records;
}

function dispatchStep(
    intent: EffectIntent = intentOf(),
    interceptors: readonly SupervisionInterceptorDeclaration[] = [DECLARATION],
): Step {
    return [
        SCHEMAS.dispatch,
        createSupervisionDispatchBody({
            approvalTimeoutMilliseconds: 100,
            citedRecordIds: [],
            commandId: "effect:forged",
            dispatchId: DISPATCH_ID,
            intent,
            interceptors,
        }),
    ];
}

function decisionStep(
    fields: Partial<Parameters<typeof createSupervisionDecisionBody>[0]> = {},
    intent: EffectIntent = intentOf(),
): Step {
    return [
        SCHEMAS.decision,
        createSupervisionDecisionBody({
            appliedPolicy: null,
            decision: "allow",
            dispatchId: DISPATCH_ID,
            intentRef: createIntentReference(intent),
            interceptorId: DECLARATION.interceptor_id,
            position: 0,
            reason: null,
            replacement: null,
            source: "interceptor",
            ...fields,
        }),
    ];
}

function resolutionStep(
    disposition: "cancelled" | "denied" | "rejected",
    intent: EffectIntent = intentOf(),
): Step {
    return [
        SCHEMAS.resolution,
        createSupervisionResolutionBody({
            dispatchId: DISPATCH_ID,
            disposition,
            handlerId: null,
            intentRef: createIntentReference(intent),
            outcome: null,
        }),
    ];
}

test("dispatch folds classify every unfinished boundary", () => {
    const classify = (steps: readonly Step[]) =>
        foldSupervisedDispatch(DISPATCH_ID, path(steps), undefined).inspection.recovery;
    assert.equal(classify([dispatchStep()]), "decision_pending");
    assert.equal(
        classify([dispatchStep(), decisionStep({ decision: "deny", reason: "no" })]),
        "resolution_pending",
    );
    assert.equal(
        classify([dispatchStep(), decisionStep({ decision: "pause", reason: "look" })]),
        "approval_pending",
    );
    assert.equal(classify([dispatchStep(), decisionStep()]), "resolution_pending");
    assert.equal(classify([dispatchStep(intentOf("irreversible"), [])]), "approval_pending");
    const irreversible = intentOf("irreversible");
    const request: Step = [
        SCHEMAS.approval,
        createSupervisionApprovalRequestBody({
            dispatchId: DISPATCH_ID,
            gate: "irreversible_frontier",
            intentRef: createIntentReference(irreversible),
            position: null,
            reason: null,
        }),
    ];
    const requested = path([dispatchStep(irreversible, []), request]);
    const verdict: Step = [
        SCHEMAS.approval,
        createSupervisionApprovalVerdictBody({
            approverId: null,
            commandId: null,
            dispatchId: DISPATCH_ID,
            reason: null,
            requestRecordId: requested[1]?.envelope.record_id as string,
            verdict: "expired",
        }),
    ];
    assert.equal(
        classify([dispatchStep(irreversible, []), request, verdict]),
        "resolution_pending",
    );
    assert.equal(
        classify([
            dispatchStep(irreversible, []),
            request,
            verdict,
            resolutionStep("rejected", irreversible),
        ]),
        "resolved",
    );
    assert.equal(
        classify([
            dispatchStep(),
            decisionStep(),
            [
                SCHEMAS.admission,
                createSupervisionAdmissionBody(DISPATCH_ID, createIntentReference(intentOf())),
            ],
        ]),
        "materialization_uncertain",
    );
    const second = { ...DECLARATION, interceptor_id: "policy:b", priority: 1 };
    const pauseRequest: Step = [
        SCHEMAS.approval,
        createSupervisionApprovalRequestBody({
            dispatchId: DISPATCH_ID,
            gate: "interceptor_pause",
            intentRef: createIntentReference(intentOf()),
            position: 0,
            reason: "look",
        }),
    ];
    const pausePath = [
        dispatchStep(intentOf(), [DECLARATION, second]),
        decisionStep({ decision: "pause", reason: "look" }),
        pauseRequest,
    ];
    const pauseVerdict: Step = [
        SCHEMAS.approval,
        createSupervisionApprovalVerdictBody({
            approverId: "reviewer",
            commandId: "approval:pause",
            dispatchId: DISPATCH_ID,
            reason: null,
            requestRecordId: path(pausePath)[2]?.envelope.record_id as string,
            verdict: "approved",
        }),
    ];
    const strengthened = createEffectIntent({
        effectId: intentOf().effect_id,
        kind: intentOf().kind,
        payload: { path: "drafts/notes.txt" },
        reversibility: "irreversible",
    });
    const replaced = foldSupervisedDispatch(
        DISPATCH_ID,
        path([
            ...pausePath,
            pauseVerdict,
            decisionStep({
                decision: "replace",
                interceptorId: "policy:b",
                position: 1,
                reason: "confine",
                replacement: strengthened,
            }),
        ]),
        undefined,
    );
    assert.equal(replaced.inspection.recovery, "approval_pending");
    assert.equal(replaced.frontierPending, true, "an approval never carries over to a replacement");
});

test("dispatch folds refuse evidence that violates the protocol", () => {
    const intent = intentOf();
    const ref = createIntentReference(intent);
    const refuse = (records: readonly OwnerRecord[], dispatchId = DISPATCH_ID, row?: never) =>
        assert.throws(
            () => foldSupervisedDispatch(dispatchId, records, row),
            SupervisionEvidenceError,
        );
    refuse([]);
    refuse(path([decisionStep()]));
    refuse(path([dispatchStep()]), createSupervisedDispatchId("effect:other"));
    refuse(path([dispatchStep(), decisionStep()], { brokenAt: 1 }));
    refuse(path([dispatchStep(), decisionStep()], { extraCauseAt: 1 }));
    refuse(path([dispatchStep(), decisionStep()], { wrongModeAt: 1 }));
    refuse(path([dispatchStep()], { wrongModeAt: 0 }));
    refuse(path([dispatchStep()], { extraCauseAt: 0 }));
    refuse(
        path([
            dispatchStep(),
            decisionStep({ decision: "deny", reason: "no" }),
            resolutionStep("denied"),
            decisionStep(),
        ]),
    );
    refuse(path([dispatchStep(), decisionStep({ position: 1 })]));
    refuse(
        path([
            dispatchStep(),
            decisionStep({ decision: "deny", reason: "no" }),
            [SCHEMAS.admission, createSupervisionAdmissionBody(DISPATCH_ID, ref)],
        ]),
    );
    refuse(
        path([
            dispatchStep(),
            decisionStep({ appliedPolicy: "fail_closed", decision: "deny", source: "timeout" }),
        ]),
    );
    refuse(
        path([
            dispatchStep(),
            decisionStep({
                decision: "replace",
                reason: "rename",
                replacement: createEffectIntent({
                    effectId: intent.effect_id,
                    kind: "file.delete",
                    payload: intent.payload,
                    reversibility: "reversible",
                }),
            }),
        ]),
    );
    refuse(
        path([
            dispatchStep(),
            [
                SCHEMAS.approval,
                createSupervisionApprovalRequestBody({
                    dispatchId: createSupervisedDispatchId("effect:other"),
                    gate: "irreversible_frontier",
                    intentRef: ref,
                    position: null,
                    reason: null,
                }),
            ],
        ]),
    );
    refuse(
        path([
            dispatchStep(intent, []),
            [
                SCHEMAS.approval,
                createSupervisionApprovalRequestBody({
                    dispatchId: DISPATCH_ID,
                    gate: "irreversible_frontier",
                    intentRef: ref,
                    position: null,
                    reason: null,
                }),
            ],
        ]),
    );
    refuse(
        path([
            dispatchStep(),
            [
                SCHEMAS.approval,
                createSupervisionApprovalVerdictBody({
                    approverId: "reviewer",
                    commandId: "approval:1",
                    dispatchId: DISPATCH_ID,
                    reason: null,
                    requestRecordId: createRecordId({ absent: true }),
                    verdict: "approved",
                }),
            ],
        ]),
    );
    refuse(
        path([
            dispatchStep(),
            [SCHEMAS.admission, createSupervisionAdmissionBody(DISPATCH_ID, ref)],
        ]),
    );
    refuse(path([dispatchStep(), resolutionStep("denied")]));
    refuse(path([dispatchStep(), ["example.other.v1", { other: true }]]));
    refuse(path([dispatchStep()]), DISPATCH_ID, {
        dispatch_record_id: createRecordId({ other: true }),
    } as never);
});

test("record readers refuse malformed supervision bodies", () => {
    const intent = intentOf();
    const ref = createIntentReference(intent);
    const [, dispatch] = dispatchStep();
    const [, decision] = decisionStep();
    const malformed: readonly (() => unknown)[] = [
        () =>
            readSupervisionDispatchBody({
                ...dispatch,
                intent_ref: createIntentReference(intentOf("compensable")),
            }),
        () => readSupervisionDispatchBody({ ...dispatch, supervision_version: 99 }),
        () =>
            readSupervisionDispatchBody({
                ...dispatch,
                interceptors: [{ ...DECLARATION, priority: 0.5 }],
            }),
        () =>
            readSupervisionDispatchBody({
                ...dispatch,
                interceptors: [
                    { ...DECLARATION, interceptor_id: "policy:b" },
                    { ...DECLARATION, interceptor_id: "policy:a" },
                ],
            }),
        () => readSupervisionDecisionBody({ ...decision, decision: "maybe" }),
        () => readSupervisionDecisionBody({ ...decision, decision: "pause" }),
        () => readSupervisionDecisionBody({ ...decision, reason: "unexplained allow" }),
        () =>
            readSupervisionApprovalBody(
                createSupervisionApprovalRequestBody({
                    dispatchId: DISPATCH_ID,
                    gate: "interceptor_pause",
                    intentRef: ref,
                    position: null,
                    reason: null,
                }),
            ),
        () =>
            readSupervisionApprovalBody({
                ...createSupervisionApprovalVerdictBody({
                    approverId: null,
                    commandId: null,
                    dispatchId: DISPATCH_ID,
                    reason: null,
                    requestRecordId: createRecordId({ request: true }),
                    verdict: "expired",
                }),
                reason: "late",
            }),
        () =>
            readSupervisionResolutionBody(
                { ...resolutionStep("denied")[1], handler_id: "handler:file" },
                intent,
            ),
    ];
    for (const read of malformed) {
        assert.throws(read, SupervisionEvidenceError);
    }
    assert.ok(
        readSupervisionResolutionBody(
            createSupervisionResolutionBody({
                dispatchId: DISPATCH_ID,
                disposition: "materialized",
                handlerId: "handler:file",
                intentRef: ref,
                outcome: createEffectOutcome(intent, { ok: true, value: null }),
            }),
            intent,
        ),
    );
    assert.throws(
        () => readSupervisionReason("x".repeat(SUPERVISION_LIMITS.maxReasonBytes + 1), false),
        TypeError,
    );
    const original = new SupervisionEvidenceError("original");
    assert.throws(
        () =>
            decodeSupervisionEvidence("dispatch", () => {
                throw original;
            }),
        (error) => error === original,
    );
});

test("moved heads are re-validated, lease expiry is bounded, and waits end on prior aborts", async () => {
    using store = new SQLiteTraceStore();
    for (const reserved of [
        createSupervisedDispatchId("effect:forged-append"),
        createSupervisionContextChannelId("forged"),
    ]) {
        assert.throws(() => appendOwnerRecord(store, reserved, "forged"), /reserved/u);
        assert.equal(store.readOwner(reserved).length, 0);
    }
    const pausedId = createSupervisedDispatchId("effect:paused");
    const paused = dispatchSupervisedEffect(store, {
        claimId: "dispatcher:1",
        commandId: "effect:paused",
        handlers: recordingHandlers(),
        intent: intentOf("irreversible"),
    });
    await eventually(() => store.readOwner(pausedId).length === 2);
    const row = store.readSupervisedDispatch(pausedId);
    const [dispatchRecord, requestRecord] = store.readOwner(pausedId);
    assert.deepEqual(
        store.appendSupervisedDispatchRecord(
            pausedId,
            { claimId: row?.claim_id as string, fencingToken: row?.fencing_token as number },
            dispatchRecord?.envelope.record_id as string,
            Date.now(),
            { append_intent_id: "intent:moved", batch: { groups: [] } },
            false,
        ),
        { status: "head_moved" },
    );
    resolveSupervisedApproval(store, {
        approverId: "reviewer",
        commandId: "approval:paused",
        dispatchId: pausedId,
        requestRecordId: requestRecord?.envelope.record_id as string,
        verdict: "rejected",
    });
    assert.equal((await paused).resolution?.disposition, "rejected");
    assert.throws(
        () =>
            store.openSupervisedDispatch(pausedId, "dispatcher:2", Date.now(), [], {
                append_intent_id: "intent:other-dispatch",
                batch: { groups: [] },
            }),
        /already retains records/u,
    );
    const invocations: EffectIntent[] = [];
    const original = store.appendSupervisedDispatchRecord.bind(store);
    let moved = false;
    store.appendSupervisedDispatchRecord = (...args) => {
        if (!moved && args[4].batch.groups[0]?.records[0]?.schema_ref === SCHEMAS.admission) {
            moved = true;
            return { status: "head_moved" };
        }
        return original(...args);
    };
    const retried = await dispatchSupervisedEffect(store, {
        claimId: "dispatcher:1",
        commandId: "effect:admission-retry",
        handlers: recordingHandlers(invocations),
        intent: intentOf(),
    });
    assert.equal(moved, true);
    assert.equal(retried.resolution?.disposition, "materialized");
    assert.equal(invocations.length, 1);
    assert.throws(
        () =>
            store.openSupervisedDispatch(
                createSupervisedDispatchId("effect:overflow"),
                "dispatcher:1",
                Number.MAX_SAFE_INTEGER,
                [],
                { append_intent_id: "intent:overflow", batch: { groups: [] } },
            ),
        /safe integer/u,
    );
    const aborted = new AbortController();
    aborted.abort();
    assert.equal(await waitFor(60_000, [undefined, aborted.signal]), true);
    assert.equal(await waitFor(1, [undefined]), false);
});
