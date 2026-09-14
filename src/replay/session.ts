import type { SemanticRecord, SemanticValue } from "../canonical/canonical-record.ts";
import { canonicalizeSemanticValue } from "../canonical/canonical-record.ts";
import { createCanonicalSnapshot } from "../canonical/snapshot.ts";
import type { EffectHandlerStack } from "../effect/handler-types.ts";
import { createIntentReference, validateEffectCorrelation } from "../effect/records.ts";
import type { EffectIntent, EffectOutcome } from "../effect/types.ts";
import { readEffectIntent } from "../effect/validation.ts";
import { replayProtocolConfig } from "../protocol/config.ts";
import {
    RECORD_MODES,
    REPLAY_CHECKPOINT_CONSTITUENT_KINDS,
    REPLAY_CHECKPOINT_EVIDENCE_STATUSES,
    REPLAY_EFFECT_DISPOSITIONS,
    REPLAY_MODES,
    REPLAY_PROCESS_BACKENDS,
    REPLAY_STEP_KINDS,
    REPLAY_STEP_SOURCES,
    REPLAY_TERMINAL_STATUSES,
} from "../protocol/values.generated.ts";
import type { ModelProvider, ModelRequest } from "../provider/types.ts";
import {
    readModelRequest,
    readModelResponse,
    readProviderDescriptor,
} from "../provider/validation.ts";
import { ROOT_WITNESS_ID } from "../record/root-witness.ts";
import type { RecordBody, RecordId } from "../record/types.ts";
import { normalizeTaskValue } from "../run/execution-preparation.ts";
import { assertScopeText, readScopeArray, readScopeDataObject } from "../scope/validation.ts";
import type { ReplaySessionFence } from "../store/replay-sessions.ts";
import type { SQLiteTraceStore } from "../store/sqlite-trace-store.ts";
import type { Cut, CutSpec, StoreAppendRequest } from "../store/types.ts";
import { assertTaskDescriptor } from "../task/descriptor.ts";
import {
    ReplayEffectRefusedError,
    ReplayEvidenceError,
    ReplayMaterializationUncertainError,
    ReplayPrefixMismatchError,
    ReplaySessionInterruptedError,
    ReplayStepFailureError,
} from "./errors.ts";
import {
    foldReplaySession,
    inspectReplaySession,
    type ReplaySourceEffects,
    readReplayFrontier,
    replayEffectNeedsApproval,
} from "./inspection.ts";
import {
    compareText,
    createReplayAdmissionBody,
    createReplayAppendIntentId,
    createReplayCacheEvidence,
    createReplayCheckpointBody,
    createReplayCheckpointId,
    createReplayContextPrefixId,
    createReplayCutId,
    createReplayEffectStepId,
    createReplayFailure,
    createReplayPrefixId,
    createReplayPromptId,
    createReplayProviderStepId,
    createReplayResponseId,
    createReplaySessionBody,
    createReplaySessionId,
    createReplayStepBody,
    createReplayTerminalBody,
    type ReplayEffectStepBody,
    type ReplayOriginBody,
    type ReplayProviderStepBody,
    readReplayCheckpointBody,
    readReplayReason,
} from "./records.ts";
import type {
    ReplayCheckpointInspection,
    ReplayConstituent,
    ReplayEffectApproval,
    ReplayEffectApprovalVerdict,
    ReplayEffectStepResult,
    ReplayMode,
    ReplayProcessAdapter,
    ReplayProviderSessionAdapter,
    ReplayProviderStepResult,
    ReplayReplaySessionOptions,
    ReplaySessionContext,
    ReplaySessionInspection,
    ReplaySessionProgram,
    ReplaySessionReceipt,
    ReplaySessionTask,
    ReplaySessionTaskDefinition,
    ReplayStepFailure,
    ReplayStepHandle,
    ReplayStepInspection,
    ReplayWorldBinding,
    RunReplaySessionOptions,
} from "./types.ts";
import { captureReplayWorldImage, readReplayWorldRoot } from "./world-image.ts";

const config = replayProtocolConfig;
const [CAPTURE_MODE, DECLARATION_MODE] = RECORD_MODES;
const [ROOT_MODE] = REPLAY_MODES;
const [PROVIDER_KIND, EFFECT_KIND] = REPLAY_STEP_KINDS;
const [LIVE_SOURCE, RECORDED_SOURCE] = REPLAY_STEP_SOURCES;
const [MATERIALIZED, MATERIALIZATION_FAILED, REFUSED] = REPLAY_EFFECT_DISPOSITIONS;
const [TRACE_CUT_KIND, WORLD_KIND, PROVIDER_SESSION_KIND, PROCESS_KIND, IRREVERSIBLE_KIND] =
    REPLAY_CHECKPOINT_CONSTITUENT_KINDS;
const [VERIFIED, RECONSTRUCTIVE, NOT_APPLICABLE, UNAVAILABLE] = REPLAY_CHECKPOINT_EVIDENCE_STATUSES;
const [FINISHED, FAILED, CANCELLED] = REPLAY_TERMINAL_STATUSES;

/** Validated session-level options shared by root sessions and branches. @internal */
export type ReplaySessionBindings = {
    readonly claimId: string;
    readonly clock: () => number;
    readonly commandId: string;
    readonly handlers: EffectHandlerStack | null;
    readonly processes: readonly ReplayProcessAdapter[];
    readonly provider: ModelProvider | null;
    readonly providerSession: ReplayProviderSessionAdapter | null;
    readonly signal: AbortSignal | undefined;
    readonly worlds: readonly ReplayWorldBinding[];
};

/** Source journal consulted while a branch reconstructs its recorded prefix. @internal */
export type ReplayRecordedSource = {
    /** Validated source session. */
    readonly inspection: ReplaySessionInspection;
    /** Source effects a live suffix must treat as possibly materialized. */
    readonly effects: ReplaySourceEffects;
    /** Replay policy for approval-required suffix effects. */
    readonly policy: ReplayReplaySessionOptions["policy"] | undefined;
    /** Replacement task of the live suffix, or null. */
    readonly replacementTask: ReplaySessionTask | null;
    /** Number of recorded prefix steps. */
    readonly targetStepCount: number;
    /**
     * Returns the task the source had in force at one step index.
     *
     * @param index - Step index.
     * @returns The task, or null.
     */
    readonly taskAt: (index: number) => ReplaySessionTask | null;
};

/** Live engine state of one fenced session writer. @internal */
export type ReplayEngine = {
    readonly bindings: ReplaySessionBindings;
    readonly checkpoints: ReplayCheckpointInspection[];
    closed: boolean;
    contextPrefixId: string | null;
    readonly controller: AbortController;
    readonly fence: ReplaySessionFence;
    head: RecordId;
    readonly lease: { renewedAt: number };
    readonly mode: ReplayMode;
    poisoned: Error | null;
    prefixId: string | null;
    readonly recorded: ReplayRecordedSource | null;
    running: boolean;
    readonly sessionId: string;
    readonly steps: ReplayStepInspection[];
    readonly store: SQLiteTraceStore;
    readonly task: ReplaySessionTask | null;
};

/**
 * Runs one deterministic session program as a durable replay session.
 *
 * The session record, every provider exchange, every effect admission and step, every checkpoint,
 * and the terminal record are retained on the session's own owner path under a fenced lease. A
 * program failure is retained as a `failed` terminal and returned; caller cancellation is retained
 * as `cancelled`. Repeating a terminal command returns the retained receipt without running the
 * program; a non-terminal session is never resumed in place.
 *
 * @param store - Open writable trace store.
 * @param options - Command, claim, program, provider, handlers, task, worlds, processes, and signal.
 * @returns The validated terminal session inspection.
 * @throws {ReplaySessionInterruptedError} If the command names a non-terminal session.
 * @throws {ReplayMaterializationUncertainError} If the command names a session with an effect
 * admission but no step.
 * @throws {ReplayLeaseConflictError} If another unexpired writer holds the session.
 * @throws {ReplayLeaseFencedError} If this writer loses its lease.
 * @throws {ReplayEvidenceError} If retained evidence is inconsistent.
 * @throws {AppendIntentConflictError} If the command names different session content.
 * @throws {TraceStoreError} If the store is closed.
 * @throws {TypeError} If options are malformed.
 *
 * @example
 * ```ts
 * const { inspection } = await runReplaySession(store, {
 *     claimId: "worker-1",
 *     commandId: "session:review:1",
 *     programId: "review.v1",
 *     provider,
 *     program: async (context) => (await context.invokeProvider(request)).response.output,
 * });
 * ```
 */
export async function runReplaySession(
    store: SQLiteTraceStore,
    options: RunReplaySessionOptions,
): Promise<ReplaySessionReceipt> {
    const fields = readScopeDataObject(
        options,
        ["claimId", "commandId", "program", "programId"],
        "runReplaySession options",
        [
            "clock",
            "handlers",
            "processes",
            "provider",
            "providerSession",
            "signal",
            "task",
            "worlds",
        ],
    );
    const bindings = readReplaySessionBindings(fields);
    const program = readProgram(fields.program);
    assertScopeText(fields.programId, "programId");
    const task = fields.task === undefined ? null : readReplaySessionTask(fields.task);
    const sessionId = createReplaySessionId(bindings.commandId);
    const body = createReplaySessionBody(
        replaySessionFields(bindings, sessionId, fields.programId, ROOT_MODE, task, null),
    );
    const receipt = await openReplayEngine(store, bindings, sessionId, body, []);
    if ("inspection" in receipt) {
        return receipt;
    }
    const engine = createReplayEngine(store, bindings, sessionId, receipt, ROOT_MODE, task, null);
    return Object.freeze({ inspection: await executeReplayProgram(engine, program) });
}

/**
 * Derives the replay session identity and owner path of one session command.
 *
 * @param commandId - Globally idempotent session command identity.
 * @returns The configured session identity.
 * @throws {TypeError} If the command identity is malformed.
 *
 * @example
 * ```ts
 * const inspection = inspectReplaySession(store, {
 *     sessionId: deriveReplaySessionId("session:review:1"),
 * });
 * ```
 */
export function deriveReplaySessionId(commandId: string): string {
    return createReplaySessionId(commandId);
}

/** Opens or replays a session record and returns either a retained receipt or a new fence. @internal */
export async function openReplayEngine(
    store: SQLiteTraceStore,
    bindings: ReplaySessionBindings,
    sessionId: string,
    body: RecordBody,
    causes: readonly RecordId[],
): Promise<
    | ReplaySessionReceipt
    | { readonly fence: ReplaySessionFence; readonly head: RecordId; readonly openedAt: number }
> {
    const openedAt = readClock(bindings.clock);
    const opened = store.openReplaySession(
        sessionId,
        bindings.claimId,
        openedAt,
        appendRequest(
            bindings.commandId,
            "session",
            sessionId,
            body,
            config.traceSchemas.session,
            DECLARATION_MODE,
            causes,
        ),
    );
    if (!opened.created) {
        const inspection = inspectReplaySession(store, { clock: bindings.clock, sessionId });
        if (inspection.terminal !== null) {
            return Object.freeze({ inspection });
        }
        if (inspection.pending_admission_record_id !== null) {
            throw new ReplayMaterializationUncertainError(
                sessionId,
                inspection.pending_admission_record_id,
            );
        }
        throw new ReplaySessionInterruptedError(sessionId, inspection.classification);
    }
    const row = opened.row as NonNullable<typeof opened.row>;
    return Object.freeze({
        fence: Object.freeze({ claimId: row.claim_id, fencingToken: row.fencing_token }),
        head: row.session_record_id,
        openedAt,
    });
}

/** Creates the live engine of a newly opened session. @internal */
export function createReplayEngine(
    store: SQLiteTraceStore,
    bindings: ReplaySessionBindings,
    sessionId: string,
    opened: {
        readonly fence: ReplaySessionFence;
        readonly head: RecordId;
        readonly openedAt: number;
    },
    mode: ReplayMode,
    task: ReplaySessionTask | null,
    recorded: ReplayRecordedSource | null,
): ReplayEngine {
    return {
        bindings,
        checkpoints: [],
        closed: false,
        contextPrefixId: null,
        controller: new AbortController(),
        fence: opened.fence,
        head: opened.head,
        lease: { renewedAt: opened.openedAt },
        mode,
        poisoned: null,
        prefixId: null,
        recorded,
        running: false,
        sessionId,
        steps: [],
        store,
        task,
    };
}

/**
 * Executes the program against a live engine and retains its terminal record.
 *
 * @internal
 */
export async function executeReplayProgram(
    engine: ReplayEngine,
    program: ReplaySessionProgram,
): Promise<ReplaySessionInspection> {
    const { signal } = engine.bindings;
    const onAbort = () => engine.controller.abort(signal?.reason);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted === true) {
        onAbort();
    }
    const timer = setInterval(
        () => {
            try {
                renewIfDue(engine, readClock(engine.bindings.clock));
            } catch (error) {
                poison(engine, error as Error);
                engine.controller.abort(error);
            }
        },
        Math.max(1, Math.floor(config.lease.renewalMilliseconds / 2)),
    );
    timer.unref();
    let outcome:
        | { readonly ok: true; readonly value: unknown }
        | { readonly error: unknown; readonly ok: false };
    // Only a cancellation observed before the program settled makes the session cancelled.
    let cancelled = false;
    try {
        outcome = { ok: true, value: await program(createContext(engine)) };
    } catch (error) {
        outcome = { error, ok: false };
    } finally {
        // Runs synchronously when the program settles, before any later abort can be observed.
        cancelled = signal?.aborted === true;
        clearInterval(timer);
        signal?.removeEventListener("abort", onAbort);
        engine.closed = true;
    }
    const poisoned = engine.poisoned;
    if (poisoned !== null && !(poisoned instanceof ReplayPrefixMismatchError)) {
        throw poisoned;
    }
    const target = engine.recorded?.targetStepCount ?? 0;
    let status: string = FAILED;
    let result: { readonly value: SemanticValue } | null = null;
    let failure: ReplayStepFailure | null = null;
    if (poisoned !== null) {
        failure = createReplayFailure(poisoned);
    } else if (cancelled) {
        status = CANCELLED;
    } else if (engine.steps.length < target) {
        failure = createReplayFailure(
            new ReplayPrefixMismatchError(
                engine.steps.length,
                "the program ended before the recorded prefix",
            ),
        );
    } else if (outcome.ok) {
        try {
            result = createCanonicalSnapshot({
                value: normalizeTaskValue(outcome.value) as SemanticValue,
            }) as { readonly value: SemanticValue };
            status = FINISHED;
        } catch (error) {
            failure = createReplayFailure(error);
        }
    } else {
        failure = createReplayFailure(outcome.error);
    }
    appendTerminal(engine, status, result, failure);
    return foldReplaySession(
        engine.store,
        engine.sessionId,
        engine.store.readOwner(engine.sessionId),
        engine.store.readReplaySession(engine.sessionId),
        readClock(engine.bindings.clock),
    );
}

/** Retains the terminal record of a live engine. @internal */
export function appendTerminal(
    engine: ReplayEngine,
    status: string,
    result: { readonly value: SemanticValue } | null,
    failure: ReplayStepFailure | null,
): void {
    append(
        engine,
        "terminal",
        createReplayTerminalBody({
            failure,
            prefix_id: engine.prefixId,
            result,
            session_id: engine.sessionId,
            status: status as never,
            step_count: engine.steps.length,
        }),
        config.traceSchemas.terminal,
        CAPTURE_MODE,
        () => [engine.head],
        null,
        true,
    );
}

/**
 * Appends one recorded step copied from a verified source step without invoking anything.
 *
 * @internal
 */
export function appendRecordedStep(
    engine: ReplayEngine,
    source: ReplayStepInspection,
    dependsOn: readonly number[],
): ReplayStepInspection {
    return appendStep(engine, {
        dependsOn,
        effect:
            source.effect === null
                ? null
                : ({
                      approval: source.effect.approval,
                      disposition: source.effect.disposition,
                      failure: source.effect.failure,
                      handler_id: source.effect.handler_id,
                      intent: source.effect.intent,
                      intent_ref: source.effect.intent_ref,
                      outcome: source.effect.outcome,
                      refusal_reason: source.effect.refusal_reason,
                  } as ReplayEffectStepBody),
        kind: source.kind,
        provider: source.provider,
        source: RECORDED_SOURCE,
        sourceStepRecordId: source.record_id,
        stepId: source.step_id,
    });
}

/** Validates session-level options shared by root sessions and branches. @internal */
export function readReplaySessionBindings(fields: Record<string, unknown>): ReplaySessionBindings {
    assertScopeText(fields.claimId, "claimId");
    assertScopeText(fields.commandId, "commandId");
    const clock = (fields.clock ?? Date.now) as () => number;
    if (typeof clock !== "function") {
        throw new TypeError("clock must be a function");
    }
    if (fields.signal !== undefined && !(fields.signal instanceof AbortSignal)) {
        throw new TypeError("signal must be an AbortSignal");
    }
    const handlers = fields.handlers ?? null;
    if (
        handlers !== null &&
        typeof (handlers as { readonly dispatch?: unknown }).dispatch !== "function"
    ) {
        throw new TypeError("handlers must be an effect handler stack");
    }
    const provider = fields.provider ?? null;
    if (provider !== null) {
        const candidate = provider as { readonly descriptor?: unknown; readonly invoke?: unknown };
        if (typeof candidate.descriptor !== "function" || typeof candidate.invoke !== "function") {
            throw new TypeError("provider must be a model provider");
        }
        readProviderDescriptor((provider as ModelProvider).descriptor());
    }
    return Object.freeze({
        claimId: fields.claimId,
        clock,
        commandId: fields.commandId,
        handlers: handlers as EffectHandlerStack | null,
        processes: readProcessAdapters(fields.processes),
        provider: provider as ModelProvider | null,
        providerSession: readProviderSessionAdapter(fields.providerSession),
        signal: fields.signal as AbortSignal | undefined,
        worlds: readWorldBindings(fields.worlds),
    });
}

/** Validates a task binding into its retained form. @internal */
export function readReplaySessionTask(value: unknown): ReplaySessionTask {
    const fields = readScopeDataObject(value, ["descriptor", "input"], "task");
    const descriptor = fields.descriptor as ReplaySessionTaskDefinition["descriptor"];
    assertTaskDescriptor(descriptor);
    return createCanonicalSnapshot({
        artifact_lock: descriptor.artifactLock as unknown as SemanticRecord,
        input: normalizeTaskValue(descriptor.parseInput(fields.input)),
        instruction: descriptor.instruction,
        output_schema: descriptor.artifact.output_schema,
    }) as unknown as ReplaySessionTask;
}

/** Validates a session program. @internal */
export function readProgram(value: unknown): ReplaySessionProgram {
    if (typeof value !== "function") {
        throw new TypeError("program must be a function");
    }
    return value as ReplaySessionProgram;
}

/** Builds the retained session body fields. @internal */
export function replaySessionFields(
    bindings: ReplaySessionBindings,
    sessionId: string,
    programId: string,
    mode: ReplayMode,
    task: ReplaySessionTask | null,
    origin: ReplayOriginBody | null,
) {
    return {
        command_id: bindings.commandId,
        mode,
        origin,
        processes: bindings.processes.map((adapter) =>
            Object.freeze({ backend: adapter.backend, process_id: adapter.processId }),
        ),
        program_id: programId,
        provider:
            bindings.provider === null
                ? null
                : readProviderDescriptor(bindings.provider.descriptor()),
        provider_session_adapter_id: bindings.providerSession?.adapterId ?? null,
        session_id: sessionId,
        task,
        worlds: bindings.worlds.map((world) => world.name),
    };
}

/** Reads the configured clock. @internal */
export function readClock(clock: () => number): number {
    const now = clock();
    if (!Number.isSafeInteger(now) || now < 0) {
        throw new TypeError("clock must return a non-negative safe integer");
    }
    return now;
}

/** Appends one fenced session record and advances the engine head. @internal */
export function append(
    engine: ReplayEngine,
    label: string,
    body: RecordBody,
    schemaRef: string,
    mode: (typeof RECORD_MODES)[number],
    causes: (cut: Cut | null) => readonly RecordId[],
    cut: CutSpec | null,
    terminal: boolean,
): { readonly cut: Cut | null; readonly recordId: RecordId } {
    const now = readClock(engine.bindings.clock);
    renewIfDue(engine, now);
    const appended = engine.store.appendReplaySessionRecord(engine.sessionId, engine.fence, now, {
        cut,
        expectedHeadRecordId: engine.head,
        request: (published) =>
            appendRequest(
                engine.bindings.commandId,
                label,
                engine.sessionId,
                body,
                schemaRef,
                mode,
                causes(published),
            ),
        terminal,
    });
    if (appended.status !== "appended") {
        throw new ReplayEvidenceError(`session ${engine.sessionId} head moved`);
    }
    engine.head = appended.receipt.record_ids[0] as RecordId;
    return Object.freeze({ cut: appended.cut, recordId: engine.head });
}

function createContext(engine: ReplayEngine): ReplaySessionContext {
    return Object.freeze({
        checkpoint: () => exclusive(engine, () => checkpoint(engine)),
        dispatchEffect: (intent: EffectIntent, options?: unknown) =>
            exclusive(engine, () => dispatchEffect(engine, intent, options)),
        invokeProvider: (request: ModelRequest, options?: unknown) =>
            exclusive(engine, () => invokeProvider(engine, request, options)),
        invokeTask: (options?: unknown) =>
            exclusive(engine, () => {
                const task = currentTask(engine);
                if (task === null) {
                    throw new TypeError("session has no task");
                }
                return invokeProvider(
                    engine,
                    {
                        input: task.input,
                        instruction: task.instruction,
                        outputSchema: task.output_schema,
                    },
                    options,
                );
            }),
        get mode() {
            return engine.mode;
        },
        get session_id() {
            return engine.sessionId;
        },
        get signal() {
            return engine.controller.signal;
        },
        get step_count() {
            return engine.steps.length;
        },
        get task() {
            return currentTask(engine);
        },
    }) as ReplaySessionContext;
}

async function exclusive<T>(engine: ReplayEngine, operation: () => Promise<T>): Promise<T> {
    if (engine.poisoned !== null) {
        throw engine.poisoned;
    }
    if (engine.closed || engine.running) {
        throw new TypeError("session context operations must be sequential within the program");
    }
    engine.controller.signal.throwIfAborted();
    engine.running = true;
    try {
        return await operation();
    } finally {
        engine.running = false;
    }
}

async function invokeProvider(
    engine: ReplayEngine,
    requestValue: ModelRequest,
    options: unknown,
): Promise<ReplayProviderStepResult> {
    const request = readModelRequest(requestValue);
    const index = nextIndex(engine);
    const dependsOn = readDependencies(engine, options, index);
    const source = recordedStep(engine, index);
    let step: ReplayStepInspection;
    if (source !== null) {
        if (
            source.provider === null ||
            canonical(source.provider.request) !== canonical(request) ||
            canonical(source.depends_on) !== canonical(dependsOn)
        ) {
            throw mismatch(engine, index, "provider request or dependencies differ");
        }
        step = appendRecordedStep(engine, source, dependsOn);
    } else {
        const provider = engine.bindings.provider;
        if (provider === null) {
            throw new TypeError("session has no provider");
        }
        const prior = engine.contextPrefixId;
        const cacheIdentity = readCacheIdentity(
            engine.bindings.providerSession?.cacheIdentity?.(request, prior) ?? null,
        );
        let response: { readonly output: SemanticValue; readonly usage: never } | null = null;
        let failure: ReplayStepFailure | null = null;
        try {
            const value = readModelResponse(
                await provider.invoke(request, engine.controller.signal),
            );
            response = { output: value.output, usage: value.usage as never };
        } catch (error) {
            if (engine.controller.signal.aborted) {
                throw error;
            }
            failure = createReplayFailure(error);
        }
        const promptId = createReplayPromptId(request);
        const responseId = createReplayResponseId(
            response === null
                ? { failure: failure as ReplayStepFailure }
                : { output: response.output },
        );
        step = appendStep(engine, {
            dependsOn,
            effect: null,
            kind: PROVIDER_KIND,
            provider: {
                cache:
                    response === null
                        ? null
                        : createReplayCacheEvidence(response.usage, cacheIdentity, prior),
                context_prefix_id: createReplayContextPrefixId(prior, promptId, responseId),
                failure,
                prompt_id: promptId,
                request,
                response,
                response_id: responseId,
            },
            source: LIVE_SOURCE,
            sourceStepRecordId: null,
            stepId: createReplayProviderStepId(promptId, responseId),
        });
    }
    const provider = step.provider as ReplayProviderStepBody;
    if (provider.response === null) {
        const failed = provider.failure as ReplayStepFailure;
        throw new ReplayStepFailureError(index, failed.name, failed.message);
    }
    return Object.freeze({
        handle: handleOf(step),
        response: provider.response,
        source: step.source,
    });
}

async function dispatchEffect(
    engine: ReplayEngine,
    intentValue: EffectIntent,
    options: unknown,
): Promise<ReplayEffectStepResult> {
    const intent = createCanonicalSnapshot(
        readEffectIntent(intentValue) as unknown as SemanticRecord,
    ) as unknown as EffectIntent;
    const intentRef = createIntentReference(intent);
    const index = nextIndex(engine);
    const dependsOn = readDependencies(engine, options, index);
    const source = recordedStep(engine, index);
    let step: ReplayStepInspection;
    if (source !== null) {
        if (
            source.effect === null ||
            source.effect.intent_ref !== intentRef ||
            canonical(source.depends_on) !== canonical(dependsOn)
        ) {
            throw mismatch(engine, index, "effect intent or dependencies differ");
        }
        step = appendRecordedStep(engine, source, dependsOn);
    } else {
        const handlers = engine.bindings.handlers;
        if (handlers === null) {
            throw new TypeError("session has no effect handler stack");
        }
        const approval = await approve(engine, intent, intentRef, index);
        if (typeof approval === "string") {
            step = appendEffectStep(engine, dependsOn, {
                approval: null,
                disposition: REFUSED,
                failure: null,
                handler_id: null,
                intent,
                intent_ref: intentRef,
                outcome: null,
                refusal_reason: approval,
            });
        } else {
            append(
                engine,
                `admission:${index}`,
                createReplayAdmissionBody(engine.sessionId, index, intentRef),
                config.traceSchemas.admission,
                DECLARATION_MODE,
                () => [engine.head],
                null,
                false,
            );
            let handlerId: string | null = null;
            let outcome: EffectOutcome | null = null;
            let failure: ReplayStepFailure | null = null;
            try {
                const dispatched = readScopeDataObject(
                    await handlers.dispatch(intent),
                    ["handlerId", "outcome"],
                    "handler dispatch",
                );
                assertScopeText(dispatched.handlerId, "handlerId");
                outcome = validateEffectCorrelation(intent, dispatched.outcome);
                handlerId = dispatched.handlerId;
            } catch (error) {
                failure = createReplayFailure(error);
            }
            step = appendEffectStep(engine, dependsOn, {
                approval,
                disposition: failure === null ? MATERIALIZED : MATERIALIZATION_FAILED,
                failure,
                handler_id: failure === null ? handlerId : null,
                intent,
                intent_ref: intentRef,
                outcome: failure === null ? outcome : null,
                refusal_reason: null,
            });
        }
    }
    const effect = step.effect as NonNullable<ReplayStepInspection["effect"]>;
    if (effect.disposition === REFUSED) {
        throw new ReplayEffectRefusedError(index);
    }
    if (effect.outcome === null) {
        const failed = effect.failure as ReplayStepFailure;
        throw new ReplayStepFailureError(index, failed.name, failed.message);
    }
    return Object.freeze({ handle: handleOf(step), outcome: effect.outcome, source: step.source });
}

async function approve(
    engine: ReplayEngine,
    intent: EffectIntent,
    intentRef: string,
    index: number,
): Promise<ReplayEffectApproval | string | null> {
    const recorded = engine.recorded;
    if (
        recorded === null ||
        !replayEffectNeedsApproval(recorded.effects, intentRef, intent.reversibility)
    ) {
        return null;
    }
    const sourceIndex =
        recorded.effects.materialized.get(intentRef) ??
        recorded.effects.uncertain.get(intentRef) ??
        null;
    if (recorded.policy === undefined) {
        return config.effects.reasons.missingPolicy;
    }
    let verdict: ReplayEffectApprovalVerdict;
    try {
        verdict = readVerdict(
            await recorded.policy(
                Object.freeze({
                    intent,
                    session_id: engine.sessionId,
                    source_materialized_step_index: sourceIndex,
                    step_index: index,
                }),
            ),
        );
    } catch {
        return config.effects.reasons.policyFailure;
    }
    if (!verdict.approved) {
        return verdict.reason;
    }
    return Object.freeze({
        approver_id: verdict.approverId,
        reason: verdict.reason,
        rematerialization: sourceIndex !== null,
    });
}

async function checkpoint(engine: ReplayEngine): Promise<ReplayCheckpointInspection> {
    const stepCount = engine.steps.length;
    const recorded = engine.recorded;
    if (recorded !== null && stepCount < recorded.targetStepCount) {
        const source = recorded.inspection.checkpoints.find(
            (candidate) => candidate.step_count === stepCount,
        );
        if (source === undefined) {
            throw mismatch(engine, stepCount, "the source retains no checkpoint at this boundary");
        }
        return source;
    }
    const existing = engine.checkpoints.find((candidate) => candidate.step_count === stepCount);
    if (existing !== undefined) {
        return existing;
    }
    const traceCutId = createReplayCutId(engine.sessionId, engine.sessionId, stepCount);
    const context = Object.freeze({
        context_prefix_id: engine.contextPrefixId,
        session_id: engine.sessionId,
        step_count: stepCount,
    });
    const constituents: ReplayConstituent[] = [
        constituent(TRACE_CUT_KIND, null, VERIFIED, traceCutId, null, null),
    ];
    for (const world of engine.bindings.worlds) {
        constituents.push(captureWorld(engine, world));
    }
    constituents.push(await captureProviderSession(engine, context));
    for (const adapter of engine.bindings.processes) {
        constituents.push(await captureProcess(engine, adapter, stepCount));
    }
    const frontier = readReplayFrontier(engine.steps, stepCount);
    constituents.push(
        constituent(IRREVERSIBLE_KIND, null, VERIFIED, frontier.frontier_id, null, {
            step_indices: frontier.entries.map((entry) => entry.step_index),
        }),
    );
    const body = createReplayCheckpointBody({
        checkpoint_id: createReplayCheckpointId(engine.sessionId, stepCount),
        constituents,
        context_prefix_id: engine.contextPrefixId,
        prefix_id: engine.prefixId,
        session_id: engine.sessionId,
        step_count: stepCount,
        trace_cut_id: traceCutId,
    });
    const through = engine.head;
    const appended = append(
        engine,
        `checkpoint:${stepCount}`,
        body,
        config.traceSchemas.checkpoint,
        CAPTURE_MODE,
        (cut) => [(cut as Cut).created_by_record_id],
        {
            append_intent_id: createReplayAppendIntentId(
                engine.bindings.commandId,
                `cut:${stepCount}`,
            ),
            cut_id: traceCutId,
            publisher_owner_id: engine.sessionId,
            target_owner_id: engine.sessionId,
            through_record_id: through,
        },
        false,
    );
    const retained = readReplayCheckpointBody(body);
    const inspection = Object.freeze({
        classification: retained.classification,
        checkpoint_id: retained.checkpoint_id,
        constituents: retained.constituents,
        context_prefix_id: retained.context_prefix_id,
        prefix_id: retained.prefix_id,
        record_id: appended.recordId,
        session_id: retained.session_id,
        step_count: retained.step_count,
        trace_cut_id: retained.trace_cut_id,
    });
    engine.checkpoints.push(inspection);
    return inspection;
}

function captureWorld(engine: ReplayEngine, world: ReplayWorldBinding): ReplayConstituent {
    try {
        const image = captureReplayWorldImage(engine.store, world.root);
        return constituent(WORLD_KIND, world.name, VERIFIED, image.content_id, null, {
            entry_count: image.entry_count,
            manifest_blob_id: image.manifest_blob_id,
        });
    } catch (error) {
        const code = (error as { readonly code?: unknown }).code;
        return constituent(
            WORLD_KIND,
            world.name,
            UNAVAILABLE,
            null,
            typeof code === "string"
                ? `${config.checkpoint.reasons.worldCapture}: ${code}`
                : config.checkpoint.reasons.worldCapture,
            null,
        );
    }
}

async function captureProviderSession(
    engine: ReplayEngine,
    context: {
        readonly context_prefix_id: string | null;
        readonly session_id: string;
        readonly step_count: number;
    },
): Promise<ReplayConstituent> {
    const adapter = engine.bindings.providerSession;
    if (adapter === null) {
        return constituent(
            PROVIDER_SESSION_KIND,
            null,
            engine.bindings.provider === null ? NOT_APPLICABLE : RECONSTRUCTIVE,
            null,
            null,
            null,
        );
    }
    try {
        const evidence = readScopeDataObject(
            await adapter.checkpoint(context),
            ["status"],
            "provider session evidence",
            ["contextPrefixId", "reason", "receiptId"],
        );
        if (evidence.status === UNAVAILABLE) {
            return constituent(
                PROVIDER_SESSION_KIND,
                adapter.adapterId,
                UNAVAILABLE,
                null,
                readReplayReason(evidence.reason, "provider session reason"),
                null,
            );
        }
        assertScopeText(evidence.receiptId, "provider session receiptId");
        if (evidence.status !== VERIFIED || evidence.contextPrefixId === undefined) {
            throw new TypeError("provider session evidence is malformed");
        }
        if (evidence.contextPrefixId !== context.context_prefix_id) {
            return constituent(
                PROVIDER_SESSION_KIND,
                adapter.adapterId,
                UNAVAILABLE,
                null,
                config.checkpoint.reasons.providerPrefixMismatch,
                null,
            );
        }
        return constituent(
            PROVIDER_SESSION_KIND,
            adapter.adapterId,
            VERIFIED,
            evidence.receiptId,
            null,
            {
                context_prefix_id: context.context_prefix_id,
            },
        );
    } catch {
        return constituent(
            PROVIDER_SESSION_KIND,
            adapter.adapterId,
            UNAVAILABLE,
            null,
            config.checkpoint.reasons.adapterFailure,
            null,
        );
    }
}

async function captureProcess(
    engine: ReplayEngine,
    adapter: ReplayProcessAdapter,
    stepCount: number,
): Promise<ReplayConstituent> {
    const unavailable = (reason: string) =>
        constituent(PROCESS_KIND, adapter.processId, UNAVAILABLE, null, reason, null);
    try {
        const probe = readScopeDataObject(await adapter.probe(), ["available"], "process probe", [
            "reason",
        ]);
        if (probe.available !== true) {
            return unavailable(readReplayReason(probe.reason, "process probe reason"));
        }
        const image = await adapter.checkpoint(
            Object.freeze({
                process_id: adapter.processId,
                session_id: engine.sessionId,
                step_count: stepCount,
            }),
        );
        if (!(image instanceof Uint8Array)) {
            throw new TypeError("process image must be bytes");
        }
        if (image.byteLength > config.limits.maxProcessImageBytes) {
            return unavailable(config.checkpoint.reasons.processImageBound);
        }
        const receipt = engine.store.putBlob(image);
        return constituent(PROCESS_KIND, adapter.processId, VERIFIED, receipt.blob_id, null, {
            backend: adapter.backend,
            byte_length: receipt.byte_length,
        });
    } catch {
        return unavailable(config.checkpoint.reasons.adapterFailure);
    }
}

function appendEffectStep(
    engine: ReplayEngine,
    dependsOn: readonly number[],
    effect: ReplayEffectStepBody,
): ReplayStepInspection {
    return appendStep(engine, {
        dependsOn,
        effect,
        kind: EFFECT_KIND,
        provider: null,
        source: LIVE_SOURCE,
        sourceStepRecordId: null,
        stepId: createReplayEffectStepId(
            effect.intent_ref,
            effect.disposition,
            effect.outcome,
            effect.failure,
        ),
    });
}

function appendStep(
    engine: ReplayEngine,
    fields: {
        readonly dependsOn: readonly number[];
        readonly effect: ReplayEffectStepBody | null;
        readonly kind: string;
        readonly provider: ReplayProviderStepBody | null;
        readonly source: string;
        readonly sourceStepRecordId: RecordId | null;
        readonly stepId: string;
    },
): ReplayStepInspection {
    const index = engine.steps.length;
    const admissionRecordId =
        fields.effect !== null &&
        fields.source === LIVE_SOURCE &&
        fields.effect.disposition !== REFUSED
            ? engine.head
            : null;
    const prefixId = createReplayPrefixId(engine.prefixId, fields.stepId);
    const body = createReplayStepBody({
        depends_on: fields.dependsOn,
        effect: fields.effect,
        index,
        kind: fields.kind as never,
        prefix_id: prefixId,
        provider: fields.provider,
        session_id: engine.sessionId,
        source: fields.source as never,
        source_step_record_id: fields.sourceStepRecordId,
        step_id: fields.stepId,
    });
    const appended = append(
        engine,
        `step:${index}`,
        body,
        config.traceSchemas.step,
        CAPTURE_MODE,
        () => [
            ...new Set([
                engine.head,
                ...fields.dependsOn.map(
                    (dependency) => (engine.steps[dependency] as ReplayStepInspection).record_id,
                ),
                ...(fields.sourceStepRecordId === null ? [] : [fields.sourceStepRecordId]),
            ]),
        ],
        null,
        false,
    );
    engine.prefixId = prefixId;
    if (fields.provider !== null) {
        engine.contextPrefixId = fields.provider.context_prefix_id;
    }
    const retained = body as unknown as {
        readonly effect: ReplayEffectStepBody | null;
        readonly provider: ReplayProviderStepBody | null;
    };
    const step = Object.freeze({
        depends_on: Object.freeze([...fields.dependsOn]),
        effect:
            retained.effect === null
                ? null
                : Object.freeze({ ...retained.effect, admission_record_id: admissionRecordId }),
        index,
        kind: fields.kind,
        prefix_id: prefixId,
        provider: retained.provider,
        record_id: appended.recordId,
        source: fields.source,
        source_step_record_id: fields.sourceStepRecordId,
        step_id: fields.stepId,
    }) as ReplayStepInspection;
    engine.steps.push(step);
    return step;
}

function recordedStep(engine: ReplayEngine, index: number): ReplayStepInspection | null {
    const recorded = engine.recorded;
    return recorded !== null && index < recorded.targetStepCount
        ? (recorded.inspection.steps[index] as ReplayStepInspection)
        : null;
}

function currentTask(engine: ReplayEngine): ReplaySessionTask | null {
    const recorded = engine.recorded;
    const index = engine.steps.length;
    if (recorded === null) {
        return engine.task;
    }
    return recorded.replacementTask !== null && index >= recorded.targetStepCount
        ? recorded.replacementTask
        : recorded.taskAt(index);
}

function nextIndex(engine: ReplayEngine): number {
    const index = engine.steps.length;
    if (index >= config.limits.maxSteps) {
        throw new RangeError("session exceeds the configured step bound");
    }
    return index;
}

function readDependencies(
    engine: ReplayEngine,
    options: unknown,
    index: number,
): readonly number[] {
    const fields = readScopeDataObject(options ?? {}, [], "step options", ["dependsOn"]);
    if (fields.dependsOn === undefined) {
        return Object.freeze(index > 0 ? [index - 1] : []);
    }
    const indices = readScopeArray(fields.dependsOn, "dependsOn").map((entry, position) => {
        const handle = readScopeDataObject(entry, ["index", "record_id"], `dependsOn[${position}]`);
        const step = engine.steps[handle.index as number];
        if (
            !Number.isSafeInteger(handle.index) ||
            step === undefined ||
            step.record_id !== handle.record_id
        ) {
            throw new TypeError(`dependsOn[${position}] must name a retained step of this session`);
        }
        return step.index;
    });
    const ordered = [...new Set(indices)].sort((left, right) => left - right);
    if (ordered.length > config.limits.maxDependencies) {
        throw new RangeError("dependsOn exceeds the configured dependency bound");
    }
    return Object.freeze(ordered);
}

function readVerdict(value: unknown): ReplayEffectApprovalVerdict {
    const approved = (value as { readonly approved?: unknown } | null)?.approved;
    if (approved === true) {
        const fields = readScopeDataObject(value, ["approved", "approverId", "reason"], "verdict");
        assertScopeText(fields.approverId, "approverId");
        return {
            approved: true,
            approverId: fields.approverId,
            reason: readReplayReason(fields.reason, "approval reason"),
        };
    }
    const fields = readScopeDataObject(value, ["approved", "reason"], "verdict");
    if (fields.approved !== false) {
        throw new TypeError("verdict approved must be a boolean");
    }
    return { approved: false, reason: readReplayReason(fields.reason, "refusal reason") };
}

function readCacheIdentity(value: unknown): string | null {
    if (value !== null) {
        assertScopeText(value, "cache identity");
    }
    return value as string | null;
}

function readWorldBindings(value: unknown): readonly ReplayWorldBinding[] {
    const worlds = readScopeArray(value ?? [], "worlds").map((entry, index) => {
        const fields = readScopeDataObject(entry, ["name", "root"], `worlds[${index}]`);
        assertScopeText(fields.name, `worlds[${index}].name`);
        return Object.freeze({
            name: fields.name,
            root: readReplayWorldRoot(fields.root, `worlds[${index}].root`),
        });
    });
    const ordered = [...worlds].sort((left, right) => compareText(left.name, right.name));
    if (
        ordered.length > config.limits.maxWorlds ||
        new Set(ordered.map((world) => world.name)).size !== ordered.length ||
        new Set(ordered.map((world) => world.root)).size !== ordered.length
    ) {
        throw new TypeError("worlds must have unique names and roots within the configured bound");
    }
    return Object.freeze(ordered);
}

function readProcessAdapters(value: unknown): readonly ReplayProcessAdapter[] {
    const adapters = readScopeArray(value ?? [], "processes").map((entry, index) => {
        const adapter = readAdapterObject(
            entry,
            `processes[${index}]`,
        ) as Partial<ReplayProcessAdapter>;
        assertScopeText(adapter.processId, `processes[${index}].processId`);
        if (
            !REPLAY_PROCESS_BACKENDS.includes(adapter.backend as never) ||
            typeof adapter.checkpoint !== "function" ||
            typeof adapter.probe !== "function" ||
            typeof adapter.restore !== "function"
        ) {
            throw new TypeError(`processes[${index}] must be a configured process adapter`);
        }
        return adapter as ReplayProcessAdapter;
    });
    const ordered = [...adapters].sort((left, right) =>
        compareText(left.processId, right.processId),
    );
    if (
        ordered.length > config.limits.maxProcesses ||
        new Set(ordered.map((adapter) => adapter.processId)).size !== ordered.length
    ) {
        throw new TypeError("processes must have unique identities within the configured bound");
    }
    return Object.freeze(ordered);
}

function readProviderSessionAdapter(value: unknown): ReplayProviderSessionAdapter | null {
    if (value === undefined) {
        return null;
    }
    const adapter = readAdapterObject(
        value,
        "providerSession",
    ) as Partial<ReplayProviderSessionAdapter>;
    assertScopeText(adapter.adapterId, "providerSession.adapterId");
    if (
        typeof adapter.checkpoint !== "function" ||
        typeof adapter.restore !== "function" ||
        (adapter.cacheIdentity !== undefined && typeof adapter.cacheIdentity !== "function")
    ) {
        throw new TypeError("providerSession must be a provider-session adapter");
    }
    return adapter as ReplayProviderSessionAdapter;
}

/** Reads a caller adapter object that may carry additional application members. */
function readAdapterObject(value: unknown, subject: string): object {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new TypeError(`${subject} must be an adapter object`);
    }
    return value;
}

function renewIfDue(engine: ReplayEngine, now: number): void {
    if (now - engine.lease.renewedAt >= config.lease.renewalMilliseconds) {
        engine.store.renewReplaySessionLease(engine.sessionId, engine.fence, now);
        engine.lease.renewedAt = now;
    }
}

function mismatch(engine: ReplayEngine, index: number, detail: string): ReplayPrefixMismatchError {
    const error = new ReplayPrefixMismatchError(index, detail);
    poison(engine, error);
    return error;
}

function poison(engine: ReplayEngine, error: Error): void {
    engine.poisoned ??= error;
}

function constituent(
    kind: string,
    name: string | null,
    status: string,
    receiptId: string | null,
    reason: string | null,
    evidence: SemanticRecord | null,
): ReplayConstituent {
    return Object.freeze({
        evidence,
        kind,
        name,
        reason,
        receipt_id: receiptId,
        status,
    }) as ReplayConstituent;
}

function handleOf(step: ReplayStepInspection): ReplayStepHandle {
    return Object.freeze({ index: step.index, record_id: step.record_id });
}

function canonical(value: unknown): string {
    return canonicalizeSemanticValue(value as SemanticValue);
}

/** Builds one single-record append request on a session owner path. @internal */
export function appendRequest(
    commandId: string,
    label: string,
    ownerId: string,
    body: RecordBody,
    schemaRef: string,
    mode: (typeof RECORD_MODES)[number],
    causes: readonly RecordId[],
): StoreAppendRequest {
    return {
        append_intent_id: createReplayAppendIntentId(commandId, label),
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
