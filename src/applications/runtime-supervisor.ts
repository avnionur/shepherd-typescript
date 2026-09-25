import { encodeToolTurnRequest } from "../agent/bindings.ts";
import { runToolLoop } from "../agent/tool-loop.ts";
import type {
    ToolLoopCall,
    ToolLoopEffects,
    ToolLoopModel,
    ToolLoopTool,
    ToolLoopTurn,
} from "../agent/types.ts";
import {
    canonicalizeSemanticValue,
    type SemanticRecord,
    type SemanticValue,
} from "../canonical/canonical-record.ts";
import { readSupervisorId } from "../delegation/records.ts";
import { applicationsProtocolConfig } from "../protocol/config.ts";
import {
    APPLICATION_KINDS,
    APPLICATION_RUNTIME_SUPERVISION_ACTIONS,
    APPLICATION_RUNTIME_SUPERVISION_ATTEMPT_CAUSES,
    APPLICATION_RUNTIME_SUPERVISION_ATTEMPT_STATUSES,
    APPLICATION_RUNTIME_SUPERVISION_PHASES,
    MODEL_CONTENT_BLOCK_TYPES,
    MODEL_MESSAGE_ROLES,
    TOOL_CALL_DISPOSITIONS,
    TOOL_LOOP_STATUSES,
} from "../protocol/values.generated.ts";
import { readModelMessage } from "../provider/messages.ts";
import type { ModelContentBlock, ModelMessage, ModelUsage } from "../provider/types.ts";
import type { RecordId } from "../record/types.ts";
import { compileJSONSchema } from "../schema/json-schema-validator.ts";
import { assertScopeText, readScopeArray, readScopeDataObject } from "../scope/validation.ts";
import type { SQLiteTraceStore } from "../store/sqlite-trace-store.ts";
import { openTraceSubscription } from "../supervision/subscription.ts";
import type { TraceSubscription, TraceSubscriptionDelivery } from "../supervision/types.ts";
import { waitFor } from "../supervision/wait.ts";
import {
    ApplicationBudgetError,
    ApplicationEvidenceError,
    ApplicationProtocolError,
} from "./errors.ts";
import {
    applicationProtocolId,
    createApplicationManifest,
    deriveApplicationOwnerId,
    retainApplicationManifest,
} from "./manifest.ts";
import {
    addApplicationCosts,
    applicationDigest,
    canonical,
    createApplicationCommandId,
    readChangedPaths,
    ZERO_APPLICATION_COST,
} from "./records.ts";
import {
    type RuntimeSupervisionProtocol,
    readRuntimeSupervisionProtocol,
} from "./runtime-supervisor-policy.ts";
import {
    appendRuntimeRecord,
    buildRuntimeInspection,
    deriveRuntimeStreamId,
    type RuntimeApplicationRecords,
    type RuntimeCompletionFields,
    readRuntimeApplication,
    readRuntimeStream,
} from "./runtime-supervisor-records.ts";
import { renderRuntimeSupervisionDecisionSchema } from "./runtime-supervisor-schema.ts";
import type {
    RunRuntimeSupervisorOptions,
    RuntimeSupervisorAction,
    RuntimeSupervisorAgentSnapshot,
    RuntimeSupervisorAttemptCause,
    RuntimeSupervisorAttemptInspection,
    RuntimeSupervisorAttemptStatus,
    RuntimeSupervisorDecision,
    RuntimeSupervisorInspection,
    RuntimeSupervisorPolicy,
    RuntimeSupervisorReceipt,
    RuntimeSupervisorRefusal,
    RuntimeSupervisorSnapshot,
    RuntimeSupervisorTickInspection,
    RuntimeSupervisorToolCallSummary,
    RuntimeSupervisorTurnInspection,
    RuntimeSupervisorWait,
    RuntimeSupervisorWorkerEffectsContext,
} from "./runtime-supervisor-types.ts";
import type {
    ApplicationArtifactSource,
    ApplicationWorldAdapter,
    ApplicationWorldCustody,
} from "./types.ts";

const config = applicationsProtocolConfig;
const runtime = config.runtimeSupervision;
const [CODING_SUPERVISOR_KIND] = APPLICATION_KINDS;
const [NONE, INJECT, HANDOFF, DISCARD] = APPLICATION_RUNTIME_SUPERVISION_ACTIONS;
const [OPENED_PHASE, TICK_PHASE, SETTLED_PHASE, ATTEMPT_PHASE, TURN_PHASE, COMPLETED_PHASE] =
    APPLICATION_RUNTIME_SUPERVISION_PHASES;
const [START_CAUSE, HANDOFF_CAUSE, DISCARD_CAUSE] = APPLICATION_RUNTIME_SUPERVISION_ATTEMPT_CAUSES;
const [RUNNING, COMPLETED_STATUS, TURN_LIMIT_STATUS, FAILED_STATUS, ABORTED_STATUS] =
    APPLICATION_RUNTIME_SUPERVISION_ATTEMPT_STATUSES;
const [LOOP_COMPLETED] = TOOL_LOOP_STATUSES;
const [MATERIALIZED] = TOOL_CALL_DISPOSITIONS;
const [USER_ROLE] = MODEL_MESSAGE_ROLES;
const [TEXT_BLOCK] = MODEL_CONTENT_BLOCK_TYPES;
// The fixed shape every admitted batch must have, whatever the protocol's action schema admits.
const DECISION_BATCH = compileJSONSchema({
    properties: {
        decisions: {
            items: renderRuntimeSupervisionDecisionSchema(APPLICATION_RUNTIME_SUPERVISION_ACTIONS),
            type: "array",
        },
    },
    required: ["decisions"],
    type: "object",
});
const FORK_STEP = "runtime_fork";
const DISCARD_STEP = "runtime_discard";

type WorkerDefinition = {
    readonly effects: (context: RuntimeSupervisorWorkerEffectsContext) => ToolLoopEffects;
    readonly feature: string;
    readonly model: ToolLoopModel;
    readonly outputSchema: SemanticRecord | null;
    readonly system: string | undefined;
    readonly tools: readonly ToolLoopTool[];
    readonly workerId: string;
};

type Lock = <T>(work: () => Promise<T>) => Promise<T>;

type Attempt = {
    readonly attempt: number;
    readonly cause: RuntimeSupervisorAttemptCause;
    completed: boolean;
    readonly custody: ApplicationWorldCustody;
    readonly guidance: string | null;
    readonly leader: string | null;
    readonly sourceCustodyId: string | null;
    readonly tick: number;
};

type Runner = {
    abortCause: { readonly action: RuntimeSupervisorAction; readonly tick: number } | null;
    readonly attempt: Attempt;
    readonly controller: AbortController;
    delivering: readonly number[];
    done: boolean;
    readonly pending: { readonly text: string; readonly tick: number }[];
    promise: Promise<void>;
};

type Worker = {
    readonly attempts: Attempt[];
    readonly definition: WorkerDefinition;
    readonly lock: Lock;
    runner: Runner | null;
    readonly streamId: string;
};

type Observed = {
    attempt: number;
    consecutiveErrors: number;
    events: number;
    status: RuntimeSupervisorAttemptStatus;
    readonly trailing: RuntimeSupervisorToolCallSummary[];
};

type Run = {
    readonly applicationId: string;
    readonly clock: () => number;
    readonly controller: AbortController;
    fatal: unknown;
    readonly policy: RuntimeSupervisorPolicy;
    readonly protocol: RuntimeSupervisionProtocol;
    providerCalls: number;
    readonly store: SQLiteTraceStore;
    readonly supervisorId: string;
    readonly ticks: RuntimeSupervisorTickInspection[];
    readonly wait: RuntimeSupervisorWait;
    readonly workers: readonly Worker[];
    readonly world: ApplicationWorldAdapter;
};

/**
 * Runs the paper's Section 5.1 runtime supervisor: two or more workers run concurrently in forked
 * custody while a supervisor ticks over their live streams and issues per-agent batched Appendix E
 * decisions that take effect on the running workers.
 *
 * Every worker is a {@link runToolLoop} session over its own custody from `world.fork`. Each
 * completed turn is retained on the worker's reserved stream (tool-call summaries, the exact
 * request digest, the assistant message, and the next user message), and every attempt opens and
 * completes on the same stream. The supervisor waits the protocol's tick cadence, drains one live
 * trace subscription over every stream, and builds one combined snapshot: per agent the truncated
 * feature, cumulative tool-call events, consecutive errors, the custody's modified files, the
 * status of the current attempt, the last non-`none` action and its age in ticks, and the trailing
 * tool-call summaries. The snapshot must satisfy the protocol's observation schema. The policy is
 * consulted once per tick; its `{ decisions }` object is validated against the protocol's action
 * schema, the fixed decision shape of the tick record schema, and the admission rules (known and
 * distinct agents, guidance required for `inject` and
 * allowed only for `inject` and `handoff`, `leader` only for `handoff`, word bounds). A refused
 * batch is retained with its issues and nothing is applied; unlisted agents are `none`. The tick
 * record, with the snapshot and the subscription cursor, is retained before any decision is
 * applied, in declared worker order:
 *
 * - `inject` appends the guidance after the tool results of the running attempt's next user message
 *   (between turns), so every earlier message and the cache prefix stay byte-identical;
 * - `handoff` aborts the attempt and starts a fresh session on the same custody whose first user
 *   message carries the feature and the guidance; with `leader` it first forks the leader's
 *   custody, quiesced between tool calls, as the agent's new root;
 * - `discard` aborts the attempt and starts a fresh session on a clean fork of the pre-run world.
 *
 * When no worker is running after a tick the run settles: the settlement record names each worker's
 * final attempt and custody and the guidance that never reached its attempt, custody abandoned by a
 * handoff or discard is discarded unless a final custody was forked from it, and the manifest is
 * retained. Final custody is left open and returned for the caller to integrate.
 *
 * A rerun of the same command replays the retained run: the opened record must match, forks are
 * re-issued under their derived command identities in creation order, each retained tick's
 * decisions are completed idempotently (the policy is never consulted for a retained tick), a
 * running attempt resumes from its retained conversation with a byte-identical prefix, undelivered
 * injected guidance is delivered at its next turn boundary, and ticking continues. A rerun after the
 * settlement record re-issues every fork, so a settlement interrupted between two discards replays
 * the completed ones and runs the rest. After the manifest is retained, a rerun returns it without
 * running a policy or a worker.
 *
 * @param store - Open writable trace store.
 * @param options - Command, supervisor, protocol, workers, world, policy, and optional clock, wait,
 * and signal.
 * @returns The retained manifest, the inspection, and every worker's final custody.
 * @throws {ApplicationProtocolError} If the protocol is malformed, differs from the retained one, or
 * refuses a runtime snapshot.
 * @throws {ApplicationBudgetError} If the tick or provider-call budget is exhausted, including by a
 * worker's own model call; every running worker is aborted first and its attempt stays open.
 * @throws {ApplicationEvidenceError} If retained evidence is inconsistent or the rerun names other
 * workers or supervisor.
 * @throws {TypeError} If options, a worker definition, or a world result are malformed.
 * @throws The policy's error or the signal's reason, after every running worker was aborted.
 *
 * @example
 * ```ts
 * const { custody, manifest } = await runRuntimeSupervisor(store, {
 *     commandId: "application:pair:1",
 *     policy: createModelRuntimeSupervisorPolicy({ model: meta, protocol }),
 *     protocol,
 *     supervisorId: "supervisor:meta",
 *     workers: [featureA, featureB],
 *     world,
 * });
 * ```
 *
 * @public
 */
export async function runRuntimeSupervisor(
    store: SQLiteTraceStore,
    options: RunRuntimeSupervisorOptions,
): Promise<RuntimeSupervisorReceipt> {
    const fields = readScopeDataObject(
        options,
        ["commandId", "policy", "protocol", "supervisorId", "workers", "world"],
        "runRuntimeSupervisor options",
        ["clock", "signal", "wait"],
    );
    assertScopeText(fields.commandId, "commandId");
    const supervisorId = readSupervisorId(fields.supervisorId, "supervisorId");
    const policy = readFunction(fields.policy, "policy") as RuntimeSupervisorPolicy;
    const clock =
        fields.clock === undefined
            ? Date.now
            : (readFunction(fields.clock, "clock") as () => number);
    const wait =
        fields.wait === undefined
            ? defaultWait
            : (readFunction(fields.wait, "wait") as RuntimeSupervisorWait);
    const signal =
        fields.signal === undefined ? new AbortController().signal : readSignal(fields.signal);
    const protocol = readRuntimeSupervisionProtocol(fields.protocol);
    const definitions = readWorkers(fields.workers);
    const world = readWorldAdapter(fields.world);
    const applicationId = deriveApplicationOwnerId(fields.commandId);
    const opened = {
        application_id: applicationId,
        command_id: fields.commandId,
        kind: CODING_SUPERVISOR_KIND,
        phase: OPENED_PHASE,
        protocol_id: applicationProtocolId(protocol.definition),
        supervisor_id: supervisorId,
        workers: definitions.map((definition) => ({
            stream_id: deriveRuntimeStreamId(applicationId, definition.workerId),
            worker_id: definition.workerId,
        })),
    };
    const retained = readRuntimeApplication(store, applicationId);
    if (retained === null) {
        appendRuntimeRecord(store, applicationId, OPENED_PHASE, opened, []);
    } else {
        assertReopened(retained, opened);
    }
    const controller = new AbortController();
    const onAbort = () => controller.abort(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    const run: Run = {
        applicationId,
        clock,
        controller,
        fatal: null,
        policy,
        protocol,
        providerCalls: 0,
        store,
        supervisorId,
        ticks: [...(retained?.ticks ?? [])],
        wait,
        workers: definitions.map((definition) => ({
            attempts: [],
            definition,
            lock: createLock(),
            runner: null,
            streamId: deriveRuntimeStreamId(applicationId, definition.workerId),
        })),
        world,
    };
    try {
        signal.throwIfAborted();
        await restore(run, retained?.settlement?.discard_custody_ids ?? []);
        if ((retained?.settlement ?? null) === null) {
            await supervise(run);
        }
        const receipt = await settle(run);
        signal.removeEventListener("abort", onAbort);
        return receipt;
    } catch (error) {
        signal.removeEventListener("abort", onAbort);
        controller.abort(error);
        await Promise.all(run.workers.map((worker) => worker.runner?.promise));
        throw error;
    }
}

/**
 * Reads one runtime supervisor run as an immutable record-derived view without mutation.
 *
 * The application path (opened record, contiguous ticks, settlement, manifest, terminal cut) and
 * every worker stream (attempts numbered from one, contiguous turns, one completion per attempt)
 * are validated against the runtime supervision record schema. Inspection works on reopened,
 * read-only, and imported stores.
 *
 * @param store - Open trace store, writable or read-only.
 * @param applicationId - Application identity derived by {@link deriveApplicationOwnerId}.
 * @returns The validated inspection.
 * @throws {ApplicationEvidenceError} If the run is not retained or its evidence is inconsistent.
 * @throws {TraceStoreError} If the store is closed.
 *
 * @example
 * ```ts
 * const inspection = inspectRuntimeSupervisorRun(store, deriveApplicationOwnerId(commandId));
 * console.log(inspection.ticks.map((tick) => tick.decisions));
 * ```
 *
 * @public
 */
export function inspectRuntimeSupervisorRun(
    store: SQLiteTraceStore,
    applicationId: string,
): RuntimeSupervisorInspection {
    return buildRuntimeInspection(store, applicationId);
}

function assertReopened(
    retained: RuntimeApplicationRecords,
    expected: {
        readonly command_id: string;
        readonly protocol_id: string;
        readonly supervisor_id: string;
        readonly workers: readonly { readonly stream_id: string; readonly worker_id: string }[];
    },
): void {
    if (retained.opened.protocol_id !== expected.protocol_id) {
        throw new ApplicationProtocolError("the application was opened under another protocol");
    }
    if (
        retained.opened.command_id !== expected.command_id ||
        retained.opened.supervisor_id !== expected.supervisor_id ||
        canonical(retained.opened.workers) !== canonical(expected.workers)
    ) {
        throw new ApplicationEvidenceError(
            "the application was opened with different workers or supervisor",
        );
    }
}

/**
 * Re-derives every attempt in creation order: initial starts in worker order, then each retained
 * tick's handoffs and discards in worker order. Retained attempts re-issue their forks so the world
 * adapter resolves their custody again; missing ones are created as the tick decided. Running
 * attempts then resume, with undelivered guidance queued.
 */
async function restore(run: Run, discarded: readonly string[]): Promise<void> {
    const streams = new Map(
        run.workers.map((worker) => [
            worker,
            readRuntimeStream(
                run.store,
                run.applicationId,
                worker.streamId,
                worker.definition.workerId,
            ),
        ]),
    );
    const retainedAttempt = (worker: Worker, tick: number) =>
        (streams.get(worker) as readonly RuntimeSupervisorAttemptInspection[]).find(
            (attempt) => attempt.tick === tick && attempt.attempt === worker.attempts.length + 1,
        );
    for (const worker of run.workers) {
        const attempt = retainedAttempt(worker, 0);
        if (attempt === undefined) {
            await createAttempt(run, worker, 0, START_CAUSE, null, null);
        } else {
            await registerAttempt(run, worker, attempt, discarded);
        }
    }
    for (const tick of run.ticks) {
        for (const worker of run.workers) {
            const decision = tick.decisions.find(
                (candidate) => candidate.agent === worker.definition.workerId,
            );
            if (decision?.action !== HANDOFF && decision?.action !== DISCARD) {
                continue;
            }
            const attempt = retainedAttempt(worker, tick.tick);
            if (attempt === undefined) {
                await replaceAttempt(run, worker, tick.tick, decision, false);
            } else {
                assert(
                    attempt.cause === causeOf(decision) &&
                        attempt.leader === (decision.leader ?? null),
                    `attempt ${attempt.attempt} of ${worker.definition.workerId} does not follow tick ${tick.tick}`,
                );
                await registerAttempt(run, worker, attempt, discarded);
            }
        }
    }
    for (const worker of run.workers) {
        const stream = readRuntimeStream(
            run.store,
            run.applicationId,
            worker.streamId,
            worker.definition.workerId,
        );
        assert(
            stream.length === worker.attempts.length,
            `worker ${worker.definition.workerId} retains attempts no tick decided`,
        );
        const current = stream.at(-1) as RuntimeSupervisorAttemptInspection;
        run.providerCalls += stream.reduce((total, attempt) => total + attempt.turns.length, 0);
        if (current.completion === null) {
            startRunner(run, worker, current.turns);
            const runner = worker.runner as Runner;
            for (const tick of run.ticks) {
                const decision = tick.decisions.find(
                    (candidate) =>
                        candidate.agent === worker.definition.workerId &&
                        candidate.action === INJECT,
                );
                if (
                    decision !== undefined &&
                    current.tick <= tick.tick &&
                    !current.turns.some((turn) => turn.guidance_ticks.includes(tick.tick))
                ) {
                    runner.pending.push({ text: decision.guidance as string, tick: tick.tick });
                }
            }
        }
    }
    run.providerCalls += run.ticks.length;
}

async function registerAttempt(
    run: Run,
    worker: Worker,
    retained: RuntimeSupervisorAttemptInspection,
    discarded: readonly string[],
): Promise<void> {
    const previous = worker.attempts.at(-1);
    let custody: ApplicationWorldCustody;
    if (previous !== undefined && retained.custody.custody_id === previous.custody.custody_id) {
        custody = previous.custody;
    } else {
        const reforked = forkCustody(
            run,
            worker,
            retained.attempt,
            retained.custody.source_custody_id,
        );
        if (discarded.includes(retained.custody.custody_id)) {
            // Settlement discards this custody. Re-issuing its fork lets the world resolve it again
            // so a settlement interrupted between two discards can finish the rest; a custody whose
            // discard already completed cannot be reopened, and nothing needs its root.
            custody = await reforked.catch(() =>
                Object.freeze({
                    custody_id: retained.custody.custody_id,
                    receipt_id: retained.custody.receipt_id,
                    root: "",
                }),
            );
        } else {
            custody = await reforked;
        }
        assert(
            custody.custody_id === retained.custody.custody_id &&
                custody.receipt_id === retained.custody.receipt_id,
            `the world resolved other custody for ${worker.definition.workerId} attempt ${retained.attempt}`,
        );
    }
    worker.attempts.push({
        attempt: retained.attempt,
        cause: retained.cause,
        completed: retained.completion !== null,
        custody,
        guidance: retained.guidance,
        leader: retained.leader,
        sourceCustodyId: retained.custody.source_custody_id,
        tick: retained.tick,
    });
}

async function forkCustody(
    run: Run,
    worker: Worker,
    attempt: number,
    sourceCustodyId: string | null,
): Promise<ApplicationWorldCustody> {
    return readCustody(
        await run.world.fork({
            commandId: createApplicationCommandId(run.applicationId, FORK_STEP, {
                attempt,
                worker_id: worker.definition.workerId,
            }),
            nowMilliseconds: run.clock(),
            ...(sourceCustodyId === null ? {} : { sourceCustodyId }),
            workerId: worker.definition.workerId,
        }),
    );
}

/**
 * Creates the next attempt of one worker: a clean fork for a start or a discard, a fork of the
 * leader's quiesced custody for a cross-agent handoff, or the current custody for a handoff without
 * a leader; then retains its attempt record.
 */
async function createAttempt(
    run: Run,
    worker: Worker,
    tick: number,
    cause: RuntimeSupervisorAttemptCause,
    decision: RuntimeSupervisorDecision | null,
    previous: Attempt | null,
): Promise<Attempt> {
    const number = worker.attempts.length + 1;
    const leader =
        decision?.leader === undefined ? null : (workerById(run, decision.leader) as Worker);
    let custody: ApplicationWorldCustody;
    let sourceCustodyId: string | null = null;
    if (cause === HANDOFF_CAUSE && leader === null) {
        custody = (previous as Attempt).custody;
        sourceCustodyId = (previous as Attempt).sourceCustodyId;
    } else if (leader !== null) {
        const source = (leader.attempts.at(-1) as Attempt).custody;
        sourceCustodyId = source.custody_id;
        custody = await leader.lock(() => forkCustody(run, worker, number, source.custody_id));
    } else {
        custody = await forkCustody(run, worker, number, null);
    }
    const attempt: Attempt = {
        attempt: number,
        cause,
        completed: false,
        custody,
        guidance: decision?.guidance ?? null,
        leader: decision?.leader ?? null,
        sourceCustodyId,
        tick,
    };
    appendRuntimeRecord(
        run.store,
        worker.streamId,
        `${ATTEMPT_PHASE}:${number}`,
        {
            application_id: run.applicationId,
            attempt: number,
            cause,
            custody: {
                custody_id: custody.custody_id,
                receipt_id: custody.receipt_id,
                source_custody_id: sourceCustodyId,
            },
            guidance: attempt.guidance,
            leader: attempt.leader,
            phase: ATTEMPT_PHASE,
            tick,
            worker_id: worker.definition.workerId,
        },
        [],
    );
    worker.attempts.push(attempt);
    return attempt;
}

/**
 * Applies one handoff or discard: aborts and awaits the running attempt (which retains its
 * `aborted` completion), or retains that completion for an attempt a crash left open, then creates
 * the next attempt and, live, starts it.
 */
async function replaceAttempt(
    run: Run,
    worker: Worker,
    tick: number,
    decision: RuntimeSupervisorDecision,
    live: boolean,
): Promise<void> {
    const previous = worker.attempts.at(-1) as Attempt;
    const cause = { action: decision.action, tick };
    const runner = worker.runner;
    if (runner !== null && !runner.done) {
        runner.abortCause = cause;
        runner.controller.abort(new Error(`${decision.action} at tick ${tick}`));
        await runner.promise;
    }
    if (!previous.completed) {
        appendCompletion(run, worker, previous, {
            cause,
            error: null,
            output: null,
            status: ABORTED_STATUS,
        });
    }
    if (live) {
        // A run stopped while the old attempt wound down leaves the replacement to a rerun.
        run.controller.signal.throwIfAborted();
    }
    await createAttempt(run, worker, tick, causeOf(decision), decision, previous);
    if (live) {
        startRunner(run, worker, []);
    }
}

function causeOf(decision: RuntimeSupervisorDecision): RuntimeSupervisorAttemptCause {
    return decision.action === DISCARD ? DISCARD_CAUSE : HANDOFF_CAUSE;
}

function appendCompletion(
    run: Run,
    worker: Worker,
    attempt: Attempt,
    completion: RuntimeCompletionFields,
): void {
    appendRuntimeRecord(
        run.store,
        worker.streamId,
        `${COMPLETED_PHASE}:${attempt.attempt}`,
        {
            ...completion,
            application_id: run.applicationId,
            attempt: attempt.attempt,
            phase: COMPLETED_PHASE,
            worker_id: worker.definition.workerId,
        },
        [],
    );
    attempt.completed = true;
}

/**
 * Starts (or resumes from its retained turns) the current attempt of one worker as a tool-use loop.
 * The conversation is rebuilt byte for byte from the first user message and every retained
 * assistant and next-user message; the runner retains each turn and exactly one completion.
 */
function startRunner(
    run: Run,
    worker: Worker,
    retainedTurns: readonly RuntimeSupervisorTurnInspection[],
): void {
    const attempt = worker.attempts.at(-1) as Attempt;
    const { definition } = worker;
    const controller = new AbortController();
    const runner: Runner = {
        abortCause: null,
        attempt,
        controller,
        delivering: [],
        done: false,
        pending: [],
        promise: Promise.resolve(),
    };
    worker.runner = runner;
    const onRunAbort = () => controller.abort(run.controller.signal.reason);
    // A run stopped before this attempt starts (for example while its fork was created) aborts it
    // at once; it then retains no completion and stays open for a rerun.
    if (run.controller.signal.aborted) {
        onRunAbort();
    } else {
        run.controller.signal.addEventListener("abort", onRunAbort, { once: true });
    }
    const first: ModelContentBlock[] = [{ text: definition.feature, type: TEXT_BLOCK }];
    if (attempt.guidance !== null) {
        first.push({ text: attempt.guidance, type: TEXT_BLOCK });
    }
    const messages: ModelMessage[] = [
        readModelMessage({ content: first, role: USER_ROLE }, "first user message"),
    ];
    for (const turn of retainedTurns) {
        messages.push(turn.assistant, ...(turn.results === null ? [] : [turn.results]));
    }
    const offset = retainedTurns.length;
    const last = retainedTurns.at(-1);
    const remaining = run.protocol.budgets.turnsPerWorker - offset;
    runner.promise = (async () => {
        let completion: RuntimeCompletionFields | null;
        try {
            if (last !== undefined && last.results === null) {
                completion = {
                    cause: null,
                    error: null,
                    output: last.output,
                    status: COMPLETED_STATUS,
                };
            } else if (remaining < 1) {
                completion = { cause: null, error: null, output: null, status: TURN_LIMIT_STATUS };
            } else {
                const effects = readEffects(
                    definition.effects(
                        Object.freeze({
                            attempt: attempt.attempt,
                            custody: attempt.custody,
                            workerId: definition.workerId,
                        }),
                    ),
                );
                const result = await runToolLoop({
                    effects: {
                        dispatch: (intent, signal) =>
                            worker.lock(() => effects.dispatch(intent, signal)),
                    },
                    guidance: () => takeGuidance(runner),
                    loopId: `${worker.streamId}:${attempt.attempt}:${offset}`,
                    maxTurns: remaining,
                    messages,
                    model: {
                        converse: (request, signal) => {
                            chargeProviderCall(run);
                            return definition.model.converse(request, signal);
                        },
                    },
                    onTurn: (turn) => appendTurn(run, worker, runner, offset, turn),
                    outputSchema: definition.outputSchema,
                    signal: controller.signal,
                    ...(definition.system === undefined ? {} : { system: definition.system }),
                    tools: definition.tools,
                });
                completion = {
                    cause: null,
                    error: null,
                    output: result.output,
                    status: result.status === LOOP_COMPLETED ? COMPLETED_STATUS : TURN_LIMIT_STATUS,
                };
            }
        } catch (error) {
            if (controller.signal.aborted) {
                // A decision's abort completes the attempt; a run-level abort (an error, the
                // caller's signal) leaves it open, exactly as a crash would, for a rerun to resume.
                completion =
                    runner.abortCause === null
                        ? null
                        : {
                              cause: runner.abortCause,
                              error: null,
                              output: null,
                              status: ABORTED_STATUS,
                          };
            } else {
                completion = {
                    cause: null,
                    error: boundedMessage(error),
                    output: null,
                    status: FAILED_STATUS,
                };
            }
        }
        try {
            if (completion !== null) {
                appendCompletion(run, worker, attempt, completion);
            }
        } catch (error) {
            run.fatal ??= error;
        } finally {
            runner.done = true;
            run.controller.signal.removeEventListener("abort", onRunAbort);
        }
    })();
}

function takeGuidance(runner: Runner): string | null {
    if (runner.pending.length === 0) {
        return null;
    }
    const taken = runner.pending.splice(0, runner.pending.length);
    runner.delivering = taken.map((entry) => entry.tick);
    return taken.map((entry) => entry.text).join(runtime.guidanceSeparator);
}

function appendTurn(
    run: Run,
    worker: Worker,
    runner: Runner,
    offset: number,
    turn: ToolLoopTurn,
): void {
    const results =
        turn.calls.length === 0
            ? null
            : readModelMessage(
                  {
                      content: [
                          ...turn.calls.map((call) => call.result),
                          ...(turn.guidance === null
                              ? []
                              : [{ text: turn.guidance, type: TEXT_BLOCK }]),
                      ],
                      role: USER_ROLE,
                  },
                  "turn results message",
              );
    const guidanceTicks = turn.guidance === null ? [] : runner.delivering;
    runner.delivering = [];
    appendRuntimeRecord(
        run.store,
        worker.streamId,
        `${TURN_PHASE}:${runner.attempt.attempt}:${offset + turn.index}`,
        {
            application_id: run.applicationId,
            assistant: turn.response.message,
            attempt: runner.attempt.attempt,
            cache_prefix_messages: turn.request.cachePrefixMessages,
            calls: turn.calls.map((call) => summarize(run, call)),
            guidance_ticks: guidanceTicks,
            index: offset + turn.index,
            message_count: turn.request.messages.length,
            output: turn.response.output,
            phase: TURN_PHASE,
            request_digest: applicationDigest(encodeToolTurnRequest(turn.request).input),
            results,
            usage: turn.response.usage,
            worker_id: worker.definition.workerId,
        },
        [],
    );
}

function chargeProviderCall(run: Run): void {
    const bound = run.protocol.budgets.providerCalls;
    if (run.providerCalls >= bound) {
        const error = new ApplicationBudgetError(
            `a provider call would exceed ${runtime.budgetKeys.providerCalls} ${bound}`,
        );
        run.fatal ??= error;
        // Exhaustion is a run-level abort: every running attempt stops and stays open, exactly as a
        // crash leaves it, before the worker that asked for the call observes the error.
        run.controller.abort(error);
        throw error;
    }
    run.providerCalls += 1;
}

/** Ticks until no worker is running after a tick, or a budget, policy, or signal ends the run. */
async function supervise(run: Run): Promise<void> {
    const { budgets } = run.protocol;
    const subscription = openTraceSubscription(run.store, {
        owners: run.workers.map((worker) => worker.streamId),
    });
    const observed = new Map<string, Observed>(
        run.workers.map((worker) => [
            worker.streamId,
            { attempt: 0, consecutiveErrors: 0, events: 0, status: RUNNING, trailing: [] },
        ]),
    );
    try {
        for (let tick = run.ticks.length + 1; ; tick += 1) {
            if (run.ticks.length > 0 && run.workers.every((worker) => isIdle(worker))) {
                return;
            }
            if (tick > budgets.ticks) {
                throw new ApplicationBudgetError(
                    `tick ${tick} exceeds ${runtime.budgetKeys.ticks} ${budgets.ticks}`,
                );
            }
            await run.wait(budgets.tickInterval, run.controller.signal);
            run.controller.signal.throwIfAborted();
            if (run.fatal !== null) {
                throw run.fatal;
            }
            await drain(run, subscription, observed);
            const snapshot = await buildSnapshot(run, tick, observed);
            chargeProviderCall(run);
            const result = readPolicyResult(
                await run.policy(
                    Object.freeze({
                        protocol: run.protocol.definition,
                        signal: run.controller.signal,
                        snapshot,
                        tick,
                    }),
                ),
            );
            run.controller.signal.throwIfAborted();
            const { decisions, output, refusal } = admit(run, result.output);
            const recordId = appendRuntimeRecord(
                run.store,
                run.applicationId,
                `${TICK_PHASE}:${tick}`,
                {
                    application_id: run.applicationId,
                    cursor: subscription.deliveredCursor,
                    decisions,
                    output,
                    phase: TICK_PHASE,
                    refusal,
                    snapshot,
                    supervisor_id: run.supervisorId,
                    tick,
                    usage: result.usage,
                },
                [],
            );
            run.ticks.push(
                Object.freeze({
                    cursor: subscription.deliveredCursor,
                    decisions,
                    output,
                    record_id: recordId,
                    refusal,
                    snapshot,
                    tick,
                    usage: result.usage,
                }),
            );
            for (const worker of run.workers) {
                const decision = decisions.find(
                    (candidate) => candidate.agent === worker.definition.workerId,
                );
                if (decision?.action === INJECT) {
                    const runner = worker.runner;
                    if (runner !== null && !runner.done) {
                        runner.pending.push({ text: decision.guidance as string, tick });
                    }
                } else if (decision?.action === HANDOFF || decision?.action === DISCARD) {
                    await replaceAttempt(run, worker, tick, decision, true);
                }
            }
        }
    } finally {
        subscription.close();
    }
}

function isIdle(worker: Worker): boolean {
    return (worker.attempts.at(-1) as Attempt).completed;
}

/** Folds every stream record retained before this tick into the observed per-agent state. */
async function drain(
    run: Run,
    subscription: TraceSubscription,
    observed: Map<string, Observed>,
): Promise<void> {
    const targets = run.store.readOwnerNextOrdinals(run.workers.map((worker) => worker.streamId));
    const trailing = run.protocol.budgets.trailingToolCalls;
    const behind = () =>
        subscription.deliveredCursor.positions.some(
            (position) => position.next_ordinal < (targets.get(position.owner_id) as number),
        );
    while (behind()) {
        // The subscription is closed only after ticking stops, so a delivery always arrives.
        const delivery = (await subscription.next()) as TraceSubscriptionDelivery;
        const body = delivery.record.body as Readonly<Record<string, unknown>>;
        const state = observed.get(delivery.record.view.owner_id) as Observed;
        if (body.phase === ATTEMPT_PHASE) {
            state.attempt = body.attempt as number;
            state.consecutiveErrors = 0;
            state.status = RUNNING;
        } else if (body.phase === TURN_PHASE) {
            for (const call of body.calls as readonly RuntimeSupervisorToolCallSummary[]) {
                state.events += 1;
                state.consecutiveErrors = call.error === null ? 0 : state.consecutiveErrors + 1;
                state.trailing.push(call);
            }
            state.trailing.splice(0, Math.max(0, state.trailing.length - trailing));
        } else if (body.phase === COMPLETED_PHASE) {
            state.status = body.status as RuntimeSupervisorAttemptStatus;
        }
    }
}

async function buildSnapshot(
    run: Run,
    tick: number,
    observed: ReadonlyMap<string, Observed>,
): Promise<RuntimeSupervisorSnapshot> {
    const agents: RuntimeSupervisorAgentSnapshot[] = [];
    for (const worker of run.workers) {
        const state = observed.get(worker.streamId) as Observed;
        const attempt = worker.attempts[state.attempt - 1] as Attempt;
        const modified = await worker.lock(() =>
            run.world.changedPaths(attempt.custody.custody_id),
        );
        agents.push({
            agent: worker.definition.workerId,
            attempt: state.attempt,
            consecutive_errors: state.consecutiveErrors,
            events: state.events,
            feature: truncate(worker.definition.feature, run.protocol.budgets.featureCharacters),
            last_action: lastAction(run, worker.definition.workerId, tick),
            modified_files: readChangedPaths(modified, "world changed paths"),
            status: state.status,
            trailing_tool_calls: [...state.trailing],
        });
    }
    const snapshot: RuntimeSupervisorSnapshot = { agents, tick };
    for (const surface of run.protocol.observation) {
        const issues = surface.validator.validate(snapshot);
        if (issues.length > 0) {
            throw new ApplicationProtocolError(
                `the snapshot of tick ${tick} is not admitted by schema surface ${surface.id}: ${issues
                    .map((issue) => `${issue.path}: ${issue.message}`)
                    .join("; ")}`,
            );
        }
    }
    return snapshot;
}

function lastAction(
    run: Run,
    workerId: string,
    tick: number,
): RuntimeSupervisorAgentSnapshot["last_action"] {
    for (let index = run.ticks.length - 1; index >= 0; index -= 1) {
        const retained = run.ticks[index] as RuntimeSupervisorTickInspection;
        const decision = retained.decisions.find(
            (candidate) => candidate.agent === workerId && candidate.action !== NONE,
        );
        if (decision !== undefined) {
            return { action: decision.action, ticks_ago: tick - retained.tick };
        }
    }
    return null;
}

/**
 * Validates one raw policy output against the protocol's decision schema and the admission rules.
 * Any issue refuses the whole batch.
 */
function admit(
    run: Run,
    value: unknown,
): {
    readonly decisions: readonly RuntimeSupervisorDecision[];
    readonly output: SemanticValue;
    readonly refusal: RuntimeSupervisorRefusal | null;
} {
    let output: SemanticValue = null;
    try {
        output = JSON.parse(canonicalizeSemanticValue(value as SemanticValue)) as SemanticValue;
    } catch {
        return refuse(null, ["$: the policy output is not canonical JSON"]);
    }
    const issues = run.protocol.action.flatMap((surface) =>
        surface.validator
            .validate(output)
            .map((issue) => `${surface.id} ${issue.path}: ${issue.message}`),
    );
    if (issues.length === 0) {
        issues.push(
            ...DECISION_BATCH.validate(output).map(
                (issue) =>
                    `${config.traceSchemas.runtimeSupervision} ${issue.path}: ${issue.message}`,
            ),
        );
    }
    if (issues.length > 0) {
        return refuse(output, issues);
    }
    const decisions = (output as { readonly decisions: readonly RuntimeSupervisorDecision[] })
        .decisions;
    const { guidanceWords, reasonWords } = run.protocol.budgets;
    const seen = new Set<string>();
    for (const [index, decision] of decisions.entries()) {
        const at = `$.decisions[${index}]`;
        const known = (workerId: string) => workerById(run, workerId) !== undefined;
        if (!known(decision.agent)) {
            issues.push(`${at}.agent: names no worker of the run`);
        }
        if (seen.has(decision.agent)) {
            issues.push(`${at}.agent: names an agent already decided in this batch`);
        }
        seen.add(decision.agent);
        if (decision.action === INJECT && decision.guidance === undefined) {
            issues.push(`${at}.guidance: is required for ${INJECT}`);
        }
        if (
            decision.guidance !== undefined &&
            decision.action !== INJECT &&
            decision.action !== HANDOFF
        ) {
            issues.push(`${at}.guidance: is allowed only for ${INJECT} and ${HANDOFF}`);
        }
        if (decision.leader !== undefined) {
            if (decision.action !== HANDOFF) {
                issues.push(`${at}.leader: is allowed only for ${HANDOFF}`);
            } else if (!known(decision.leader) || decision.leader === decision.agent) {
                issues.push(`${at}.leader: must name another worker of the run`);
            } else if (
                decisions.some(
                    (other) =>
                        other.agent === decision.leader &&
                        (other.action === HANDOFF || other.action === DISCARD),
                )
            ) {
                issues.push(`${at}.leader: is itself handed off or discarded in this batch`);
            }
        }
        if (wordCount(decision.reason) > reasonWords) {
            issues.push(`${at}.reason: exceeds ${reasonWords} words`);
        }
        if (decision.guidance !== undefined && wordCount(decision.guidance) > guidanceWords) {
            issues.push(`${at}.guidance: exceeds ${guidanceWords} words`);
        }
    }
    if (issues.length > 0) {
        return refuse(output, issues);
    }
    return { decisions, output, refusal: null };
}

function refuse(
    output: SemanticValue,
    issues: readonly string[],
): {
    readonly decisions: readonly RuntimeSupervisorDecision[];
    readonly output: SemanticValue;
    readonly refusal: RuntimeSupervisorRefusal;
} {
    return { decisions: [], output, refusal: { issues } };
}

function wordCount(text: string): number {
    return text.split(/\s+/u).filter((word) => word.length > 0).length;
}

/** Settles an idle run: retains the settlement, discards abandoned custody, retains the manifest. */
async function settle(run: Run): Promise<RuntimeSupervisorReceipt> {
    const { applicationId, store } = run;
    const inspection = buildRuntimeInspection(store, applicationId);
    if (inspection.manifest === null) {
        const finals = run.workers.map((worker) => worker.attempts.at(-1) as Attempt);
        const plan = discardPlan(run);
        const settlement =
            inspection.settlement?.record_id ??
            appendRuntimeRecord(
                store,
                applicationId,
                SETTLED_PHASE,
                {
                    application_id: applicationId,
                    discard_custody_ids: plan.map(({ custodyId }) => custodyId),
                    phase: SETTLED_PHASE,
                    ticks: run.ticks.length,
                    undelivered: undelivered(inspection),
                    workers: inspection.workers.map((worker) => {
                        const attempt = worker.attempts.at(
                            -1,
                        ) as RuntimeSupervisorAttemptInspection;
                        return {
                            attempt: attempt.attempt,
                            custody_id: attempt.custody.custody_id,
                            status: (attempt.completion as { readonly status: string }).status,
                            worker_id: worker.worker_id,
                        };
                    }),
                },
                inspection.workers.map(
                    (worker) =>
                        store.readOwner(worker.stream_id).at(-1)?.envelope.record_id as RecordId,
                ),
            );
        const discards: string[] = [];
        for (const { custodyId, workerId } of plan) {
            discards.push(
                (
                    await run.world.discard({
                        commandId: createApplicationCommandId(applicationId, DISCARD_STEP, {
                            custody_id: custodyId,
                        }),
                        custodyId,
                        nowMilliseconds: run.clock(),
                        workerId,
                    })
                ).receipt_id,
            );
        }
        const roles = runtime.artifactRoles;
        const artifacts: ApplicationArtifactSource[] = [
            {
                content: { settlement_record_id: settlement },
                cut_id: null,
                record_id: settlement as RecordId,
                role: roles.settlement,
            },
            ...inspection.workers.map((worker) => {
                const head = store.readOwner(worker.stream_id).at(-1)?.envelope
                    .record_id as RecordId;
                return {
                    content: {
                        head_record_id: head,
                        stream_id: worker.stream_id,
                        worker_id: worker.worker_id,
                    },
                    cut_id: null,
                    record_id: head,
                    role: roles.workerStream,
                };
            }),
            ...finals.map((attempt) => ({
                content: {
                    custody_id: attempt.custody.custody_id,
                    receipt_id: attempt.custody.receipt_id,
                },
                cut_id: null,
                record_id: null,
                role: roles.worldFork,
            })),
            ...(discards.length === 0
                ? []
                : [
                      {
                          content: { receipt_ids: discards },
                          cut_id: null,
                          record_id: null,
                          role: roles.worldDiscard,
                      },
                  ]),
        ];
        retainApplicationManifest(store, {
            manifest: createApplicationManifest({
                applicationId,
                artifacts,
                costs: measureCosts(inspection),
                protocol: run.protocol.definition,
            }),
        });
    }
    const settled = buildRuntimeInspection(store, applicationId);
    return Object.freeze({
        custody: Object.freeze(
            run.workers.map((worker) =>
                Object.freeze({
                    custody: (worker.attempts.at(-1) as Attempt).custody,
                    worker_id: worker.definition.workerId,
                }),
            ),
        ),
        inspection: settled,
        manifest: settled.manifest as NonNullable<typeof settled.manifest>,
    });
}

/**
 * Abandoned custody to discard, deepest first: every custody some attempt used that is neither a
 * worker's final custody nor one a final custody was forked from.
 */
function discardPlan(
    run: Run,
): readonly { readonly custodyId: string; readonly workerId: string }[] {
    const sources = new Map<string, string | null>();
    const owners = new Map<string, string>();
    const created: string[] = [];
    const ordered = run.workers
        .flatMap((worker) => worker.attempts.map((attempt) => ({ attempt, worker })))
        .sort(
            (left, right) =>
                left.attempt.tick - right.attempt.tick ||
                run.workers.indexOf(left.worker) - run.workers.indexOf(right.worker),
        );
    for (const { attempt, worker } of ordered) {
        if (!sources.has(attempt.custody.custody_id)) {
            sources.set(attempt.custody.custody_id, attempt.sourceCustodyId);
            owners.set(attempt.custody.custody_id, worker.definition.workerId);
            created.push(attempt.custody.custody_id);
        }
    }
    const kept = new Set<string>();
    for (const worker of run.workers) {
        for (
            let custodyId: string | null | undefined = (worker.attempts.at(-1) as Attempt).custody
                .custody_id;
            custodyId !== null && custodyId !== undefined;
            custodyId = sources.get(custodyId)
        ) {
            kept.add(custodyId);
        }
    }
    return created
        .filter((custodyId) => !kept.has(custodyId))
        .reverse()
        .map((custodyId) => ({ custodyId, workerId: owners.get(custodyId) as string }));
}

function undelivered(
    inspection: RuntimeSupervisorInspection,
): readonly { readonly tick: number; readonly worker_id: string }[] {
    const missing: { readonly tick: number; readonly worker_id: string }[] = [];
    for (const tick of inspection.ticks) {
        for (const decision of tick.decisions) {
            if (decision.action !== INJECT) {
                continue;
            }
            const worker = inspection.workers.find(
                (candidate) => candidate.worker_id === decision.agent,
            );
            const target = worker?.attempts.filter((attempt) => attempt.tick <= tick.tick).at(-1);
            if (!target?.turns.some((turn) => turn.guidance_ticks.includes(tick.tick))) {
                missing.push({ tick: tick.tick, worker_id: decision.agent });
            }
        }
    }
    return missing;
}

function measureCosts(inspection: RuntimeSupervisorInspection) {
    const usages: ModelUsage[] = [
        ...inspection.workers.flatMap((worker) =>
            worker.attempts.flatMap((attempt) => attempt.turns.map((turn) => turn.usage)),
        ),
        ...inspection.ticks.flatMap((tick) => (tick.usage === null ? [] : [tick.usage])),
    ];
    return usages.reduce(
        (total, usage) =>
            addApplicationCosts(total, {
                cache_creation_input_tokens: usage.cacheCreationInputTokens,
                cache_read_input_tokens: usage.cacheReadInputTokens,
                cost_usd: usage.costUsd,
                input_tokens: usage.inputTokens,
                output_tokens: usage.outputTokens,
                provider_calls: 1,
            }),
        ZERO_APPLICATION_COST,
    );
}

function summarize(run: Run, call: ToolLoopCall): RuntimeSupervisorToolCallSummary {
    const input = call.input as Readonly<Record<string, unknown>>;
    const targetKey = runtime.targetInputKeys.find(
        (key) => typeof input[key] === "string" && (input[key] as string).length > 0,
    );
    let error: string | null = null;
    if (call.disposition !== MATERIALIZED) {
        error = call.reason;
    } else if (call.outcome !== null && !call.outcome.result.ok) {
        error = canonicalizeSemanticValue(call.outcome.result.error);
    }
    const summary: {
        error: string | null;
        status: RuntimeSupervisorToolCallSummary["status"];
        target: string | null;
        tool: string;
    } = {
        error,
        status: call.disposition,
        target: targetKey === undefined ? null : (input[targetKey] as string),
        tool: call.name,
    };
    const bound = run.protocol.budgets.toolCallSummaryBytes;
    for (const key of ["error", "target"] as const) {
        for (;;) {
            const over = Buffer.byteLength(canonical(summary), "utf8") - bound;
            const value = summary[key];
            if (over <= 0 || value === null || value === runtime.truncationMarker) {
                break;
            }
            const kept = Array.from(value);
            const keep = Math.max(
                0,
                kept.length - Math.max(1, over) - Array.from(runtime.truncationMarker).length,
            );
            summary[key] = `${kept.slice(0, keep).join("")}${runtime.truncationMarker}`;
        }
    }
    return Object.freeze(summary);
}

function truncate(text: string, characters: number): string {
    const kept = Array.from(text);
    if (kept.length <= characters) {
        return text;
    }
    const marker = Array.from(runtime.truncationMarker);
    return `${kept.slice(0, Math.max(0, characters - marker.length)).join("")}${runtime.truncationMarker}`;
}

function boundedMessage(error: unknown): string {
    // An error renders as "<name>: <message>", never as empty text.
    return truncate(String(error), config.limits.maxReasonLength);
}

function workerById(run: Run, workerId: string): Worker | undefined {
    return run.workers.find((worker) => worker.definition.workerId === workerId);
}

function createLock(): Lock {
    let tail: Promise<unknown> = Promise.resolve();
    return <T>(work: () => Promise<T>): Promise<T> => {
        const current = tail.then(work);
        tail = Promise.allSettled([current]);
        return current;
    };
}

async function defaultWait(milliseconds: number, signal: AbortSignal): Promise<void> {
    await waitFor(milliseconds, [signal]);
}

function readPolicyResult(value: unknown): {
    readonly output: unknown;
    readonly usage: ModelUsage | null;
} {
    const fields = readScopeDataObject(
        value,
        ["output", "usage"],
        "runtime supervisor policy result",
    );
    return { output: fields.output, usage: fields.usage as ModelUsage | null };
}

function readWorkers(value: unknown): readonly WorkerDefinition[] {
    const workers = readScopeArray(value, "workers").map((worker, index) => {
        const subject = `workers[${index}]`;
        const fields = readScopeDataObject(
            worker,
            ["effects", "feature", "model", "tools", "workerId"],
            subject,
            ["outputSchema", "system"],
        );
        assertScopeText(fields.workerId, `${subject}.workerId`);
        assertScopeText(fields.feature, `${subject}.feature`);
        const model = fields.model as { readonly converse?: unknown } | null;
        if (model === null || typeof model !== "object" || typeof model.converse !== "function") {
            throw new TypeError(`${subject}.model must provide converse`);
        }
        if (!Array.isArray(fields.tools)) {
            throw new TypeError(`${subject}.tools must be an array`);
        }
        if (fields.system !== undefined) {
            assertScopeText(fields.system, `${subject}.system`);
        }
        return Object.freeze({
            effects: readFunction(
                fields.effects,
                `${subject}.effects`,
            ) as WorkerDefinition["effects"],
            feature: fields.feature,
            model: fields.model as ToolLoopModel,
            outputSchema: (fields.outputSchema as SemanticRecord | null | undefined) ?? null,
            system: fields.system as string | undefined,
            tools: fields.tools as readonly ToolLoopTool[],
            workerId: fields.workerId,
        });
    });
    if (
        workers.length < config.limits.minWorkers ||
        workers.length > config.limits.maxWorkers ||
        new Set(workers.map((worker) => worker.workerId)).size !== workers.length
    ) {
        throw new TypeError("workers must be distinct and within the configured worker bounds");
    }
    return Object.freeze(workers);
}

function readEffects(value: unknown): ToolLoopEffects {
    if (typeof (value as { readonly dispatch?: unknown } | null)?.dispatch !== "function") {
        throw new TypeError("worker effects must provide dispatch");
    }
    return value as ToolLoopEffects;
}

function readWorldAdapter(value: unknown): ApplicationWorldAdapter {
    if (value === null || typeof value !== "object") {
        throw new TypeError("world must be a world adapter object");
    }
    const adapter = value as Readonly<Record<string, unknown>>;
    const [changedPaths, discard, fork, merge] = ["changedPaths", "discard", "fork", "merge"].map(
        (key) => readFunction(adapter[key], `world.${key}`).bind(value),
    );
    return Object.freeze({
        changedPaths,
        discard,
        fork,
        merge,
    }) as unknown as ApplicationWorldAdapter;
}

function readCustody(value: unknown): ApplicationWorldCustody {
    const fields = readScopeDataObject(
        value,
        ["custody_id", "receipt_id", "root"],
        "world custody",
    );
    assertScopeText(fields.custody_id, "world custody custody_id");
    assertScopeText(fields.receipt_id, "world custody receipt_id");
    assertScopeText(fields.root, "world custody root");
    return Object.freeze({
        custody_id: fields.custody_id,
        receipt_id: fields.receipt_id,
        root: fields.root,
    });
}

function readSignal(value: unknown): AbortSignal {
    if (!(value instanceof AbortSignal)) {
        throw new TypeError("signal must be an AbortSignal");
    }
    return value;
}

function readFunction(value: unknown, subject: string): (...args: never[]) => unknown {
    if (typeof value !== "function") {
        throw new TypeError(`${subject} must be a function`);
    }
    return value as (...args: never[]) => unknown;
}

function assert(condition: boolean, message: string): asserts condition {
    if (!condition) {
        throw new ApplicationEvidenceError(message);
    }
}
