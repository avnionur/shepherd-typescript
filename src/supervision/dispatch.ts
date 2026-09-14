import type { SemanticValue } from "../canonical/canonical-record.ts";
import { createCanonicalSnapshot } from "../canonical/snapshot.ts";
import {
    createEffectIntent,
    createIntentReference,
    validateEffectCorrelation,
} from "../effect/records.ts";
import type { EffectIntent, EffectReversibility } from "../effect/types.ts";
import { readEffectIntent } from "../effect/validation.ts";
import { effectProtocolConfig, supervisionProtocolConfig } from "../protocol/config.ts";
import {
    RECORD_MODES,
    SUPERVISION_APPROVAL_GATES,
    SUPERVISION_APPROVAL_VERDICTS,
    SUPERVISION_DECISION_SOURCES,
    SUPERVISION_DECISIONS,
    SUPERVISION_DISPOSITIONS,
    SUPERVISION_TIMEOUT_POLICIES,
} from "../protocol/values.generated.ts";
import { ROOT_WITNESS_ID } from "../record/root-witness.ts";
import type { RecordBody, RecordId } from "../record/types.ts";
import { assertScopeText, readScopeArray, readScopeDataObject } from "../scope/validation.ts";
import type { SQLiteTraceStore } from "../store/sqlite-trace-store.ts";
import type { SupervisionFence } from "../store/supervised-dispatches.ts";
import type { AppendReceipt, StoreAppendRequest } from "../store/types.ts";
import {
    applicablePolicy,
    foldSupervisedDispatch,
    type SupervisedDispatchState,
    tierIndex,
} from "./dispatch-state.ts";
import { SupervisionMaterializationUncertainError } from "./errors.ts";
import {
    assertBoundedMilliseconds,
    compareDeclarations,
    createSupervisedDispatchId,
    createSupervisionAdmissionBody,
    createSupervisionAppendIntentId,
    createSupervisionApprovalRequestBody,
    createSupervisionApprovalVerdictBody,
    createSupervisionDecisionBody,
    createSupervisionDispatchBody,
    createSupervisionResolutionBody,
    readSupervisionCitations,
    readSupervisionReason,
} from "./records.ts";
import { readSignal } from "./subscription.ts";
import type {
    DispatchSupervisedEffectOptions,
    SupervisedDispatchInspection,
    SupervisionDecision,
    SupervisionDecisionSource,
    SupervisionDisposition,
    SupervisionInterceptor,
    SupervisionInterceptorDeclaration,
    SupervisionTimeoutPolicy,
} from "./types.ts";
import { waitFor } from "./wait.ts";

const config = supervisionProtocolConfig;
const [CAPTURE_MODE, DECLARATION_MODE] = RECORD_MODES;
const [ALLOW, DENY, REPLACE, PAUSE] = SUPERVISION_DECISIONS;
const [INTERCEPTOR_SOURCE, TIMEOUT_SOURCE, FAILURE_SOURCE] = SUPERVISION_DECISION_SOURCES;
const [FAIL_OPEN] = SUPERVISION_TIMEOUT_POLICIES;
const [PAUSE_GATE, FRONTIER_GATE] = SUPERVISION_APPROVAL_GATES;
const [, , EXPIRED_VERDICT] = SUPERVISION_APPROVAL_VERDICTS;
const [MATERIALIZED, MATERIALIZATION_FAILED, DENIED, REJECTED, CANCELLED] =
    SUPERVISION_DISPOSITIONS;

type InterceptorBinding = {
    readonly declaration: SupervisionInterceptorDeclaration;
    readonly decide: SupervisionInterceptor["decide"];
};

type RetainedDecision = {
    readonly appliedPolicy: SupervisionTimeoutPolicy | null;
    readonly decision: SupervisionDecision;
    readonly reason: string | null;
    readonly replacement: EffectIntent | null;
    readonly source: SupervisionDecisionSource;
};

type WaitOutcome = "aborted" | "ready" | "timeout";

/**
 * Durably supervises one effect intent through ordered interceptors, approval gates, and a
 * handler.
 *
 * The dispatch record retains the intent, canonical interceptor order (priority, then identity),
 * approval wait, and cited records as causal parents. Each decision is retained before the next
 * interceptor runs. `deny` resolves without admission, `replace` may keep or strengthen but never
 * weaken reversibility, and `pause` waits for an approval verdict. A timed-out, throwing, or
 * malformed interceptor applies its declared policy; configured tiers always fail closed. Intents
 * on the approval frontier need an approved verdict for that exact intent. Admission is retained
 * immediately before the handler runs, and the resolution records the correlated outcome only for
 * a materialized effect.
 *
 * The dispatcher holds a fenced, renewed decision lease. Retrying the same command resumes from
 * retained evidence without invoking decided interceptors; a replacement dispatcher may take over
 * after lease expiry and the stale one is fenced. A retained admission without resolution fails
 * closed with {@link SupervisionMaterializationUncertainError}. An aborted signal resolves the
 * dispatch as cancelled before admission.
 *
 * @param store - Open writable trace store.
 * @param options - Command, lease, intent, handlers, interceptors, citations, wait, and signal.
 * @returns The validated resolved dispatch inspection.
 * @throws {SupervisionMaterializationUncertainError} If admission is retained without resolution.
 * @throws {SupervisionLeaseConflictError} If another unexpired dispatcher holds the lease.
 * @throws {SupervisionLeaseFencedError} If this dispatcher's lease is lost.
 * @throws {SupervisionEvidenceError} If retained evidence is inconsistent, a citation is absent, or
 * the dispatch was imported.
 * @throws {AppendIntentConflictError} If the command already names different dispatch content.
 * @throws {TraceStoreError} If the store is closed.
 * @throws {TypeError} If options are malformed.
 *
 * @example
 * ```ts
 * const result = await dispatchSupervisedEffect(store, {
 *     claimId: "worker-1",
 *     commandId: "effect:delete-branch:1",
 *     handlers,
 *     intent,
 *     interceptors: [{
 *         decide: ({ intent }) => ({ decision: "deny", reason: `blocked ${intent.kind}` }),
 *         interceptorId: "policy",
 *         priority: 0,
 *         timeoutMilliseconds: 1000,
 *         timeoutPolicy: "fail_closed",
 *     }],
 * });
 * ```
 */
export async function dispatchSupervisedEffect(
    store: SQLiteTraceStore,
    options: DispatchSupervisedEffectOptions,
): Promise<SupervisedDispatchInspection> {
    const fields = readScopeDataObject(
        options,
        ["claimId", "commandId", "handlers", "intent"],
        "dispatchSupervisedEffect options",
        ["approvalTimeoutMilliseconds", "citedRecordIds", "clock", "interceptors", "signal"],
    );
    assertScopeText(fields.claimId, "claimId");
    assertScopeText(fields.commandId, "commandId");
    const intent = createCanonicalSnapshot(
        readEffectIntent(fields.intent as EffectIntent),
    ) as EffectIntent;
    const handlers = fields.handlers as DispatchSupervisedEffectOptions["handlers"];
    if (typeof (handlers as { readonly dispatch?: unknown } | null)?.dispatch !== "function") {
        throw new TypeError("handlers must be an effect handler stack");
    }
    const clock = (fields.clock ?? Date.now) as () => number;
    if (typeof clock !== "function") {
        throw new TypeError("clock must be a function");
    }
    const approvalTimeoutMilliseconds =
        fields.approvalTimeoutMilliseconds ?? config.approval.defaultWaitMilliseconds;
    assertBoundedMilliseconds(
        approvalTimeoutMilliseconds,
        config.approval.maxWaitMilliseconds,
        "approvalTimeoutMilliseconds",
    );
    const citedRecordIds = readSupervisionCitations(fields.citedRecordIds ?? [], "dispatch", false);
    const bindings = readInterceptors(fields.interceptors ?? []);
    const signal = readSignal(fields.signal);
    const commandId = fields.commandId;
    const dispatchId = createSupervisedDispatchId(commandId);
    const body = createSupervisionDispatchBody({
        approvalTimeoutMilliseconds: approvalTimeoutMilliseconds as number,
        citedRecordIds,
        commandId,
        dispatchId,
        intent,
        interceptors: bindings.map((binding) => binding.declaration),
    });
    const openedAt = readClock(clock);
    const row = store.openSupervisedDispatch(
        dispatchId,
        fields.claimId,
        openedAt,
        citedRecordIds,
        appendRequest(
            commandId,
            "dispatch",
            dispatchId,
            body,
            config.traceSchemas.dispatch,
            DECLARATION_MODE,
            citedRecordIds,
        ),
    );
    const fence: SupervisionFence = { claimId: row.claim_id, fencingToken: row.fencing_token };
    const dispatcher = {
        bindings,
        clock,
        commandId,
        dispatchId,
        fence,
        handlers,
        lease: { renewedAt: openedAt },
        signal,
        store,
    };
    for (;;) {
        const state = foldSupervisedDispatch(
            dispatchId,
            store.readOwner(dispatchId),
            store.readSupervisedDispatch(dispatchId),
        );
        const inspection = state.inspection;
        if (inspection.resolution !== null) {
            return inspection;
        }
        if (inspection.admission_record_id !== null) {
            throw new SupervisionMaterializationUncertainError(
                dispatchId,
                inspection.admission_record_id,
            );
        }
        await advance(dispatcher, state);
    }
}

type Dispatcher = {
    readonly bindings: readonly InterceptorBinding[];
    readonly clock: () => number;
    readonly commandId: string;
    readonly dispatchId: string;
    readonly fence: SupervisionFence;
    readonly handlers: DispatchSupervisedEffectOptions["handlers"];
    /** Lease time of the last open or renewal, shared by every wait and append of this dispatch. */
    readonly lease: { renewedAt: number };
    readonly signal: AbortSignal | undefined;
    readonly store: SQLiteTraceStore;
};

async function advance(dispatcher: Dispatcher, state: SupervisedDispatchState): Promise<void> {
    const { inspection } = state;
    const intentRef = createIntentReference(inspection.effective_intent);
    const resolve = (disposition: SupervisionDisposition) =>
        append(
            dispatcher,
            inspection,
            "resolution",
            createSupervisionResolutionBody({
                dispatchId: dispatcher.dispatchId,
                disposition,
                handlerId: null,
                intentRef,
                outcome: null,
            }),
            config.traceSchemas.resolution,
            CAPTURE_MODE,
            true,
        );
    if (state.denied || state.rejected) {
        resolve(state.denied ? DENIED : REJECTED);
    } else if (dispatcher.signal?.aborted === true) {
        resolve(CANCELLED);
    } else if (inspection.pending_approval !== null) {
        await awaitVerdict(dispatcher, inspection);
    } else if (state.pauseAwaitingRequest !== null) {
        appendApprovalRequest(
            dispatcher,
            inspection,
            PAUSE_GATE,
            state.pauseAwaitingRequest.position,
            state.pauseAwaitingRequest.reason,
            intentRef,
        );
    } else if (state.nextPosition < dispatcher.bindings.length) {
        await decide(dispatcher, state, intentRef);
    } else if (state.frontierPending) {
        appendApprovalRequest(dispatcher, inspection, FRONTIER_GATE, null, null, intentRef);
    } else {
        await materialize(dispatcher, inspection, intentRef);
    }
}

async function decide(
    dispatcher: Dispatcher,
    state: SupervisedDispatchState,
    intentRef: string,
): Promise<void> {
    const { inspection } = state;
    const position = state.nextPosition;
    const binding = dispatcher.bindings[position] as InterceptorBinding;
    const effective = inspection.effective_intent;
    const controller = new AbortController();
    let settled: { readonly ok: true; readonly value: unknown } | { readonly ok: false } | null =
        null;
    const settledSignal = new AbortController();
    void Promise.resolve()
        .then(() =>
            binding.decide(
                Object.freeze({
                    cited_record_ids: inspection.cited_record_ids,
                    decisions: inspection.decisions,
                    dispatch_id: dispatcher.dispatchId,
                    intent: effective,
                    interceptor_id: binding.declaration.interceptor_id,
                    original_intent: inspection.intent,
                    position,
                    signal: controller.signal,
                }),
            ),
        )
        .then(
            (value) => {
                settled = { ok: true, value };
            },
            () => {
                settled = { ok: false };
            },
        )
        .finally(() => settledSignal.abort());
    let outcome: WaitOutcome;
    try {
        outcome = await waitWithLease(
            dispatcher,
            binding.declaration.timeout_milliseconds,
            () => settled !== null,
            settledSignal.signal,
        );
    } finally {
        controller.abort();
    }
    if (outcome === "aborted") {
        return;
    }
    const result = (outcome === "ready" ? settled : null) as
        | { readonly ok: true; readonly value: unknown }
        | { readonly ok: false }
        | null;
    let retained: RetainedDecision;
    try {
        if (result === null || !result.ok) {
            throw new TypeError("interceptor timed out or failed");
        }
        retained = readInterceptorResult(result.value, effective);
    } catch {
        const policy = applicablePolicy(binding.declaration, effective);
        retained = {
            appliedPolicy: policy,
            decision: policy === FAIL_OPEN ? ALLOW : DENY,
            reason: null,
            replacement: null,
            source: result === null ? TIMEOUT_SOURCE : FAILURE_SOURCE,
        };
    }
    append(
        dispatcher,
        inspection,
        `decision:${position}`,
        createSupervisionDecisionBody({
            appliedPolicy: retained.appliedPolicy,
            decision: retained.decision,
            dispatchId: dispatcher.dispatchId,
            intentRef,
            interceptorId: binding.declaration.interceptor_id,
            position,
            reason: retained.reason,
            replacement: retained.replacement,
            source: retained.source,
        }),
        config.traceSchemas.decision,
        CAPTURE_MODE,
        false,
    );
}

async function awaitVerdict(
    dispatcher: Dispatcher,
    inspection: SupervisedDispatchInspection,
): Promise<void> {
    const request = inspection.pending_approval as NonNullable<
        SupervisedDispatchInspection["pending_approval"]
    >;
    const outcome = await waitWithLease(
        dispatcher,
        inspection.approval_timeout_milliseconds,
        () =>
            (dispatcher.store
                .readOwnerNextOrdinals([dispatcher.dispatchId])
                .get(dispatcher.dispatchId) as number) >
            inspection.head.owner_ordinal + 1,
        undefined,
    );
    if (outcome === "timeout") {
        append(
            dispatcher,
            inspection,
            `approval-expired:${inspection.approvals.length - 1}`,
            createSupervisionApprovalVerdictBody({
                approverId: null,
                commandId: null,
                dispatchId: dispatcher.dispatchId,
                reason: null,
                requestRecordId: request.request_record_id,
                verdict: EXPIRED_VERDICT,
            }),
            config.traceSchemas.approval,
            CAPTURE_MODE,
            false,
        );
    }
}

async function materialize(
    dispatcher: Dispatcher,
    inspection: SupervisedDispatchInspection,
    intentRef: string,
): Promise<void> {
    const admission = append(
        dispatcher,
        inspection,
        "admission",
        createSupervisionAdmissionBody(dispatcher.dispatchId, intentRef),
        config.traceSchemas.admission,
        DECLARATION_MODE,
        false,
    );
    if (admission === null) {
        return;
    }
    let settled:
        | { readonly handlerId: string; readonly outcome: RecordBody; readonly ok: true }
        | { readonly ok: false }
        | null = null;
    const settledSignal = new AbortController();
    void Promise.resolve()
        .then(() => dispatcher.handlers.dispatch(inspection.effective_intent))
        .then((dispatch) => {
            // A malformed dispatch is a handler failure: the world may have changed, so no
            // outcome is fabricated and the resolution stays readable.
            const fields = readScopeDataObject(dispatch, ["handlerId", "outcome"], "dispatch");
            assertScopeText(fields.handlerId, "handlerId");
            settled = {
                handlerId: fields.handlerId,
                ok: true,
                outcome: validateEffectCorrelation(
                    inspection.effective_intent,
                    fields.outcome,
                ) as unknown as RecordBody,
            };
        })
        .catch(() => {
            settled = { ok: false };
        })
        .finally(() => settledSignal.abort());
    await waitWithLease(
        dispatcher,
        Number.POSITIVE_INFINITY,
        () => settled !== null,
        settledSignal.signal,
        false,
    );
    const result = settled as unknown as
        | { readonly handlerId: string; readonly outcome: RecordBody; readonly ok: true }
        | { readonly ok: false };
    append(
        dispatcher,
        admission.record_ids[0] as RecordId,
        "resolution",
        createSupervisionResolutionBody({
            dispatchId: dispatcher.dispatchId,
            disposition: result.ok ? MATERIALIZED : MATERIALIZATION_FAILED,
            handlerId: result.ok ? result.handlerId : null,
            intentRef,
            outcome: result.ok ? (result.outcome as never) : null,
        }),
        config.traceSchemas.resolution,
        CAPTURE_MODE,
        true,
    );
}

function appendApprovalRequest(
    dispatcher: Dispatcher,
    inspection: SupervisedDispatchInspection,
    gate: (typeof SUPERVISION_APPROVAL_GATES)[number],
    position: number | null,
    reason: string | null,
    intentRef: string,
): void {
    append(
        dispatcher,
        inspection,
        `approval-request:${inspection.approvals.length}`,
        createSupervisionApprovalRequestBody({
            dispatchId: dispatcher.dispatchId,
            gate,
            intentRef,
            position,
            reason,
        }),
        config.traceSchemas.approval,
        CAPTURE_MODE,
        false,
    );
}

/**
 * Waits for readiness, a timeout, or the dispatcher's abort signal while renewing the lease.
 *
 * @internal
 */
async function waitWithLease(
    dispatcher: Dispatcher,
    timeoutMilliseconds: number,
    ready: () => boolean,
    wake: AbortSignal | undefined,
    abortable = true,
): Promise<WaitOutcome> {
    const started = performance.now();
    for (;;) {
        if (ready()) {
            return "ready";
        }
        if (abortable && dispatcher.signal?.aborted === true) {
            return "aborted";
        }
        const remaining = timeoutMilliseconds - (performance.now() - started);
        if (remaining <= 0) {
            return "timeout";
        }
        renewIfDue(dispatcher, readClock(dispatcher.clock));
        await waitFor(Math.min(config.approval.pollIntervalMilliseconds, remaining), [
            wake,
            abortable ? dispatcher.signal : undefined,
        ]);
    }
}

/**
 * Renews the decision lease once the renewal interval has elapsed since the last open or renewal.
 *
 * The interval is measured across the whole dispatch, not per wait, so many short waits and appends
 * cannot outlive the lease.
 */
function renewIfDue(dispatcher: Dispatcher, now: number): void {
    if (now - dispatcher.lease.renewedAt >= config.interception.leaseRenewalMilliseconds) {
        dispatcher.store.renewSupervisedDispatchLease(dispatcher.dispatchId, dispatcher.fence, now);
        dispatcher.lease.renewedAt = now;
    }
}

function append(
    dispatcher: Dispatcher,
    head: SupervisedDispatchInspection | RecordId,
    step: string,
    body: RecordBody,
    schemaRef: string,
    mode: (typeof RECORD_MODES)[number],
    resolves: boolean,
): AppendReceipt | null {
    const headRecordId = typeof head === "string" ? head : head.head.record_id;
    const now = readClock(dispatcher.clock);
    renewIfDue(dispatcher, now);
    const appended = dispatcher.store.appendSupervisedDispatchRecord(
        dispatcher.dispatchId,
        dispatcher.fence,
        headRecordId,
        now,
        appendRequest(dispatcher.commandId, step, dispatcher.dispatchId, body, schemaRef, mode, [
            headRecordId,
        ]),
        resolves,
    );
    return appended.status === "appended" ? appended.receipt : null;
}

function appendRequest(
    commandId: string,
    step: string,
    ownerId: string,
    body: RecordBody,
    schemaRef: string,
    mode: (typeof RECORD_MODES)[number],
    causes: readonly RecordId[],
): StoreAppendRequest {
    return {
        append_intent_id: createSupervisionAppendIntentId(commandId, step),
        batch: {
            groups: [
                {
                    owner_id: ownerId,
                    records: [
                        {
                            body,
                            caused_by_record_ids: causes,
                            mode,
                            schema_ref: schemaRef,
                            witness_ref: ROOT_WITNESS_ID,
                        },
                    ],
                },
            ],
        },
    };
}

function readInterceptors(value: unknown): readonly InterceptorBinding[] {
    const bindings = readScopeArray(value, "interceptors").map((entry, index) => {
        const fields = readScopeDataObject(
            entry,
            ["decide", "interceptorId", "priority", "timeoutMilliseconds", "timeoutPolicy"],
            `interceptors[${index}]`,
        );
        assertScopeText(fields.interceptorId, `interceptors[${index}].interceptorId`);
        assertBoundedMilliseconds(
            fields.timeoutMilliseconds,
            config.interception.maxTimeoutMilliseconds,
            `interceptors[${index}].timeoutMilliseconds`,
        );
        if (
            typeof fields.decide !== "function" ||
            !Number.isSafeInteger(fields.priority) ||
            !SUPERVISION_TIMEOUT_POLICIES.includes(fields.timeoutPolicy as SupervisionTimeoutPolicy)
        ) {
            throw new TypeError(`interceptors[${index}] decide, priority, or policy is invalid`);
        }
        return Object.freeze({
            declaration: Object.freeze({
                interceptor_id: fields.interceptorId,
                priority: fields.priority as number,
                timeout_milliseconds: fields.timeoutMilliseconds as number,
                timeout_policy: fields.timeoutPolicy as SupervisionTimeoutPolicy,
            }),
            decide: fields.decide as SupervisionInterceptor["decide"],
        });
    });
    if (
        bindings.length > config.interception.maxInterceptors ||
        new Set(bindings.map((binding) => binding.declaration.interceptor_id)).size !==
            bindings.length
    ) {
        throw new TypeError("interceptors must have unique identities within the configured bound");
    }
    return Object.freeze(
        [...bindings].sort((left, right) =>
            compareDeclarations(left.declaration, right.declaration),
        ),
    );
}

function readInterceptorResult(value: unknown, effective: EffectIntent): RetainedDecision {
    const decision = (value as { readonly decision?: unknown } | null)?.decision;
    if (decision === ALLOW) {
        readScopeDataObject(value, ["decision"], "interceptor result");
        return {
            appliedPolicy: null,
            decision,
            reason: null,
            replacement: null,
            source: INTERCEPTOR_SOURCE,
        };
    }
    if (decision === DENY || decision === PAUSE) {
        const fields = readScopeDataObject(value, ["decision", "reason"], "interceptor result");
        return {
            appliedPolicy: null,
            decision,
            reason: readSupervisionReason(fields.reason, false),
            replacement: null,
            source: INTERCEPTOR_SOURCE,
        };
    }
    if (decision !== REPLACE) {
        throw new TypeError("interceptor result decision is not configured");
    }
    const fields = readScopeDataObject(
        value,
        ["decision", "payload", "reason"],
        "interceptor result",
        ["reversibility"],
    );
    const replacement = createEffectIntent({
        effectId: effective.effect_id,
        kind: effective.kind,
        payload: fields.payload as SemanticValue,
        reversibility: (fields.reversibility ?? effective.reversibility) as EffectReversibility,
    });
    if (tierIndex(replacement) < tierIndex(effective)) {
        throw new TypeError(
            `replacement must not weaken ${effectProtocolConfig.reversibilityTiers.join(" < ")} reversibility`,
        );
    }
    return {
        appliedPolicy: null,
        decision,
        reason: readSupervisionReason(fields.reason, false),
        replacement: replacement as EffectIntent,
        source: INTERCEPTOR_SOURCE,
    };
}

function readClock(clock: () => number): number {
    const now = clock();
    if (!Number.isSafeInteger(now) || now < 0) {
        throw new TypeError("clock must return a non-negative safe integer");
    }
    return now;
}
