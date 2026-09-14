import { readdirSync } from "node:fs";

import { canonicalizeSemanticValue, type SemanticValue } from "../canonical/canonical-record.ts";
import { replayProtocolConfig } from "../protocol/config.ts";
import {
    RECORD_MODES,
    REPLAY_CHANGE_DIMENSIONS,
    REPLAY_CHECKPOINT_CONSTITUENT_KINDS,
    REPLAY_CHECKPOINT_EVIDENCE_STATUSES,
    REPLAY_EFFECT_DISPOSITIONS,
    REPLAY_MODES,
    REPLAY_TERMINAL_STATUSES,
} from "../protocol/values.generated.ts";
import type { RecordId } from "../record/types.ts";
import { assertScopeText, readScopeDataObject } from "../scope/validation.ts";
import { TraceStoreError } from "../store/errors.ts";
import type { SQLiteTraceStore } from "../store/sqlite-trace-store.ts";
import type { Cut } from "../store/types.ts";
import {
    ReplayCheckpointUnavailableError,
    ReplayEvidenceError,
    ReplayRestoreError,
    ReplaySessionInterruptedError,
} from "./errors.ts";
import {
    inspectReplaySession,
    readReplayBoundaryRecordId,
    readReplayFrontier,
    readReplaySourceEffects,
} from "./inspection.ts";
import {
    classifyReplayConstituents,
    createReplayAppendIntentId,
    createReplayCutId,
    createReplayFailure,
    createReplayRestoreBody,
    createReplaySessionBody,
    createReplaySessionId,
    type ReplayOriginBody,
    readReplayChanges,
} from "./records.ts";
import {
    append,
    appendRecordedStep,
    appendTerminal,
    createReplayEngine,
    executeReplayProgram,
    openReplayEngine,
    type ReplayEngine,
    type ReplaySessionBindings,
    readProgram,
    readReplaySessionBindings,
    readReplaySessionTask,
    replaySessionFields,
} from "./session.ts";
import type {
    ReplayCheckpointInspection,
    ReplayConstituent,
    ReplayMode,
    ReplayReplaySessionOptions,
    ReplaySessionInspection,
    ReplaySessionProgram,
    ReplaySessionReceipt,
    ReplaySessionTask,
    RewindReplaySessionOptions,
} from "./types.ts";
import {
    type ReplayWorldImage,
    restoreReplayWorldImage,
    verifyReplayWorldImage,
} from "./world-image.ts";

const config = replayProtocolConfig;
const [CAPTURE_MODE] = RECORD_MODES;
const [, REWIND_MODE, REPLAY_MODE] = REPLAY_MODES;
const [TASK_CHANGE] = REPLAY_CHANGE_DIMENSIONS;
const [TRACE_CUT_KIND, WORLD_KIND, PROVIDER_SESSION_KIND, PROCESS_KIND, IRREVERSIBLE_KIND] =
    REPLAY_CHECKPOINT_CONSTITUENT_KINDS;
const [VERIFIED, RECONSTRUCTIVE, NOT_APPLICABLE] = REPLAY_CHECKPOINT_EVIDENCE_STATUSES;
const [MATERIALIZED] = REPLAY_EFFECT_DISPOSITIONS;
const [, FAILED, , REWOUND] = REPLAY_TERMINAL_STATUSES;
const BRANCH_KEYS = ["claimId", "commandId", "sourceSessionId", "target"] as const;
const BRANCH_OPTIONAL_KEYS = ["clock", "processes", "providerSession", "signal", "worlds"] as const;

/**
 * Rewinds a session to a retained checkpoint or step boundary as a new branch session.
 *
 * Every constituent the target claims verified is re-verified before anything is written; an
 * unavailable target is refused. Worlds are restored byte-equivalently into caller-selected empty
 * roots, verified provider-session and process captures are handed to their adapters, a restore
 * record retains the classification, the source prefix is copied as verified recorded steps, and
 * the branch ends `rewound`. No provider or handler is invoked. Repeating a completed branch command
 * returns its retained receipt without restoring anything.
 *
 * @param store - Open writable trace store holding the source session.
 * @param options - Branch command, claim, source, target, restoration roots, and adapters.
 * @returns The validated branch inspection.
 * @throws {ReplayCheckpointUnavailableError} If the target has unavailable constituents.
 * @throws {ReplayRestoreError} If a restoration root or claimed constituent fails verification.
 * @throws {ReplaySessionInterruptedError} If the branch command names a non-terminal session.
 * @throws {ReplayEvidenceError} If source or branch evidence is inconsistent.
 * @throws {ReplayCompatibilityError} If the source uses an unsupported replay version.
 * @throws {TypeError} If options are malformed or omit a required adapter or root.
 *
 * @example
 * ```ts
 * const { inspection } = await rewindReplaySession(store, {
 *     claimId: "operator",
 *     commandId: "rewind:review:1",
 *     sourceSessionId,
 *     target: { checkpointId },
 *     worlds: [{ name: "main", root: emptyDirectory }],
 * });
 * ```
 */
export async function rewindReplaySession(
    store: SQLiteTraceStore,
    options: RewindReplaySessionOptions,
): Promise<ReplaySessionReceipt> {
    const fields = readScopeDataObject(
        options,
        BRANCH_KEYS,
        "rewindReplaySession options",
        BRANCH_OPTIONAL_KEYS,
    );
    return branch(store, fields, REWIND_MODE, null);
}

/**
 * Replays a session from a retained checkpoint or step boundary as a new branch session.
 *
 * Restoration follows {@link rewindReplaySession}. The program is then re-executed: steps before the
 * target are served from the source journal only when the program issues the exact recorded request
 * or intent with the same dependencies, and are retained as recorded steps with no provider or
 * handler invocation. Later steps run live with the supplied provider, handler stack, and declared
 * replacement task. Approval-required suffix effects run only when `policy` approves them; otherwise
 * they are retained as refused and never reach a handler.
 *
 * @param store - Open writable trace store holding the source session.
 * @param options - Branch options plus program, suffix provider and handlers, changes, and policy.
 * @returns The validated terminal branch inspection.
 * @throws {ReplayCheckpointUnavailableError} If the target has unavailable constituents.
 * @throws {ReplayRestoreError} If a restoration root or claimed constituent fails verification.
 * @throws {ReplaySessionInterruptedError} If the branch command names a non-terminal session.
 * @throws {ReplayLeaseFencedError} If the branch writer loses its lease.
 * @throws {ReplayEvidenceError} If source or branch evidence is inconsistent.
 * @throws {ReplayCompatibilityError} If the source uses an unsupported replay version.
 * @throws {TypeError} If options or declared changes are malformed.
 *
 * @example
 * ```ts
 * const { inspection } = await replayReplaySession(store, {
 *     changes: ["provider"],
 *     claimId: "operator",
 *     commandId: "replay:review:1",
 *     program,
 *     provider: alternateProvider,
 *     sourceSessionId,
 *     target: { stepCount: 2 },
 * });
 * ```
 */
export async function replayReplaySession(
    store: SQLiteTraceStore,
    options: ReplayReplaySessionOptions,
): Promise<ReplaySessionReceipt> {
    const fields = readScopeDataObject(
        options,
        [...BRANCH_KEYS, "program"],
        "replayReplaySession options",
        [...BRANCH_OPTIONAL_KEYS, "changes", "handlers", "policy", "provider", "task"],
    );
    const changes = readReplayChanges(fields.changes ?? []);
    const program = readProgram(fields.program);
    const replacementTask = fields.task === undefined ? null : readReplaySessionTask(fields.task);
    if ((replacementTask !== null) !== changes.includes(TASK_CHANGE)) {
        throw new TypeError("a replacement task requires exactly the declared task change");
    }
    if (fields.policy !== undefined && typeof fields.policy !== "function") {
        throw new TypeError("policy must be a function");
    }
    return branch(store, fields, REPLAY_MODE, {
        changes,
        policy: fields.policy as ReplayReplaySessionOptions["policy"],
        program,
        replacementTask,
    });
}

type ReplayPlan = {
    readonly changes: ReplayOriginBody["changes"];
    readonly policy: ReplayReplaySessionOptions["policy"];
    readonly program: ReplaySessionProgram;
    readonly replacementTask: ReplaySessionTask | null;
};

type RestorePlan = {
    readonly checkpoint: ReplayCheckpointInspection | null;
    readonly constituents: readonly ReplayConstituent[];
    readonly contextPrefixId: string | null;
    readonly manifests: ReadonlyMap<string, Parameters<typeof restoreReplayWorldImage>[1]>;
    readonly prefixId: string | null;
    readonly stepCount: number;
};

async function branch(
    store: SQLiteTraceStore,
    fields: Record<string, unknown>,
    mode: ReplayMode,
    replay: ReplayPlan | null,
): Promise<ReplaySessionReceipt> {
    const bindings = readReplaySessionBindings(fields);
    assertScopeText(fields.sourceSessionId, "sourceSessionId");
    const sessionId = createReplaySessionId(bindings.commandId);
    if (store.readOwner(sessionId).length > 0) {
        const retained = inspectReplaySession(store, { clock: bindings.clock, sessionId });
        if (retained.terminal === null) {
            throw new ReplaySessionInterruptedError(sessionId, retained.classification);
        }
        return Object.freeze({ inspection: retained });
    }
    const source = inspectReplaySession(store, {
        clock: bindings.clock,
        sessionId: fields.sourceSessionId,
    });
    const taskAt = createTaskResolver(store, source, bindings.clock);
    const plan = planRestore(store, source, bindings, fields.target);
    if (
        replay !== null &&
        replay.replacementTask !== null &&
        canonical(replay.replacementTask) === canonical(taskAt(plan.stepCount))
    ) {
        throw new TypeError("a declared task change must replace the source task");
    }
    const targetTraceCutId =
        plan.checkpoint?.trace_cut_id ??
        createReplayCutId(sessionId, source.session_id, plan.stepCount);
    const origin: ReplayOriginBody = {
        changes: replay?.changes ?? [],
        replacement_task: replay?.replacementTask ?? null,
        source_session_id: source.session_id,
        source_session_record_id: source.session_record_id,
        target_checkpoint_id: plan.checkpoint?.checkpoint_id ?? null,
        target_step_count: plan.stepCount,
        target_trace_cut_id: targetTraceCutId,
    };
    const opened = await openReplayEngine(
        store,
        bindings,
        sessionId,
        createReplaySessionBody(
            replaySessionFields(bindings, sessionId, source.program_id, mode, taskAt(0), origin),
        ),
        [source.session_record_id],
    );
    // A concurrent writer can complete this branch between the retained-receipt check and open.
    /* node:coverage ignore next 3 */
    if ("inspection" in opened) {
        return opened;
    }
    const engine = createReplayEngine(store, bindings, sessionId, opened, mode, taskAt(0), {
        effects: readReplaySourceEffects(store, source),
        inspection: source,
        policy: replay?.policy,
        replacementTask: replay?.replacementTask ?? null,
        targetStepCount: plan.stepCount,
        taskAt,
    });
    try {
        await restore(engine, source, plan, targetTraceCutId);
    } catch (error) {
        if (error instanceof TraceStoreError && !(error instanceof ReplayRestoreError)) {
            throw error;
        }
        appendTerminal(engine, FAILED, null, createReplayFailure(error));
        return Object.freeze({
            inspection: inspectReplaySession(store, { clock: bindings.clock, sessionId }),
        });
    }
    if (replay === null) {
        for (const step of source.steps.slice(0, plan.stepCount)) {
            appendRecordedStep(engine, step, step.depends_on);
        }
        appendTerminal(engine, REWOUND, null, null);
        return Object.freeze({
            inspection: inspectReplaySession(store, { clock: bindings.clock, sessionId }),
        });
    }
    return Object.freeze({ inspection: await executeReplayProgram(engine, replay.program) });
}

/**
 * Resolves the task a session had in force at each step index through its branch ancestry.
 *
 * A branch uses its replacement task from its target onward and otherwise the task its source had in
 * force at the same index.
 */
function createTaskResolver(
    store: SQLiteTraceStore,
    source: ReplaySessionInspection,
    clock: () => number,
): (index: number) => ReplaySessionTask | null {
    const ancestors = new Map<string, ReplaySessionInspection>([[source.session_id, source]]);
    const resolve = (
        inspection: ReplaySessionInspection,
        index: number,
    ): ReplaySessionTask | null => {
        const origin = inspection.origin;
        if (origin === null) {
            return inspection.task;
        }
        if (origin.replacement_task !== null && index >= origin.target_step_count) {
            return origin.replacement_task;
        }
        let parent = ancestors.get(origin.source_session_id);
        if (parent === undefined) {
            parent = inspectReplaySession(store, { clock, sessionId: origin.source_session_id });
            ancestors.set(parent.session_id, parent);
        }
        return resolve(parent, index);
    };
    return (index) => resolve(source, index);
}

function planRestore(
    store: SQLiteTraceStore,
    source: ReplaySessionInspection,
    bindings: ReplaySessionBindings,
    targetValue: unknown,
): RestorePlan {
    const target = readScopeDataObject(targetValue, [], "target", ["checkpointId", "stepCount"]);
    let checkpoint: ReplayCheckpointInspection | null = null;
    let stepCount: number;
    if (target.checkpointId !== undefined && target.stepCount === undefined) {
        checkpoint =
            source.checkpoints.find(
                (candidate) => candidate.checkpoint_id === target.checkpointId,
            ) ?? null;
        if (checkpoint === null) {
            throw new ReplayEvidenceError("the source session retains no such checkpoint");
        }
        stepCount = checkpoint.step_count;
    } else if (target.stepCount !== undefined && target.checkpointId === undefined) {
        stepCount = target.stepCount as number;
        if (!Number.isSafeInteger(stepCount) || stepCount < 0 || stepCount > source.steps.length) {
            throw new TypeError("target stepCount must be a retained source step boundary");
        }
        const missing = [
            ...source.worlds.map((name) => ({ kind: WORLD_KIND, name })),
            ...source.processes.map((process) => ({
                kind: PROCESS_KIND,
                name: process.process_id,
            })),
        ].map((entry) => ({
            ...entry,
            reason: config.checkpoint.reasons.boundaryWithoutCheckpoint,
        }));
        if (missing.length > 0) {
            throw new ReplayCheckpointUnavailableError(missing);
        }
    } else {
        throw new TypeError("target must name exactly one checkpointId or stepCount");
    }
    if (checkpoint !== null) {
        const classification = classifyReplayConstituents(checkpoint.constituents);
        if (classification.unavailable.length > 0) {
            throw new ReplayCheckpointUnavailableError(classification.unavailable);
        }
    }
    if (
        !sameNames(
            bindings.worlds.map((world) => world.name),
            source.worlds,
        ) ||
        !sameNames(
            bindings.processes.map((adapter) => `${adapter.processId} ${adapter.backend}`),
            source.processes.map((process) => `${process.process_id} ${process.backend}`),
        )
    ) {
        throw new TypeError("branch worlds and processes must match the source session exactly");
    }
    const lastProvider = source.steps
        .slice(0, stepCount)
        .reverse()
        .find((step) => step.provider !== null);
    const prefixId = stepCount === 0 ? null : (source.steps[stepCount - 1]?.prefix_id as string);
    const contextPrefixId = lastProvider?.provider?.context_prefix_id ?? null;
    const frontier = readReplayFrontier(source.steps, stepCount);
    const manifests = new Map<string, Parameters<typeof restoreReplayWorldImage>[1]>();
    const constituents: ReplayConstituent[] = [];
    if (checkpoint === null) {
        constituents.push(
            constituent(TRACE_CUT_KIND, null, VERIFIED, null, null),
            constituent(
                PROVIDER_SESSION_KIND,
                null,
                source.provider === null ? NOT_APPLICABLE : RECONSTRUCTIVE,
                null,
                null,
            ),
        );
    } else {
        // Inspection already proved the checkpoint prefix, cut, and frontier against the source
        // journal; reading the cut re-verifies its resolver entry before anything is written.
        store.readCut(checkpoint.trace_cut_id);
        for (const retained of checkpoint.constituents) {
            constituents.push(planConstituent(store, retained, bindings, manifests));
        }
    }
    const withFrontier =
        checkpoint === null
            ? [
                  ...constituents,
                  constituent(IRREVERSIBLE_KIND, null, VERIFIED, frontier.frontier_id, {
                      step_indices: frontier.entries.map((entry) => entry.step_index),
                  }),
              ]
            : constituents;
    return Object.freeze({
        checkpoint,
        constituents: Object.freeze(withFrontier),
        contextPrefixId,
        manifests,
        prefixId,
        stepCount,
    });
}

function planConstituent(
    store: SQLiteTraceStore,
    retained: ReplayConstituent,
    bindings: ReplaySessionBindings,
    manifests: Map<string, Parameters<typeof restoreReplayWorldImage>[1]>,
): ReplayConstituent {
    if (retained.kind === WORLD_KIND) {
        const world = bindings.worlds.find((candidate) => candidate.name === retained.name);
        const root = (world as NonNullable<typeof world>).root;
        if (readdirSync(root).length > 0) {
            throw new ReplayRestoreError(
                `restoration root for world ${retained.name} is not empty`,
            );
        }
        manifests.set(
            retained.name as string,
            verifyReplayWorldImage(
                store,
                {
                    content_id: retained.receipt_id as string,
                    ...(retained.evidence as unknown as Omit<ReplayWorldImage, "content_id">),
                },
                root,
            ),
        );
        return retained;
    }
    if (retained.kind === PROVIDER_SESSION_KIND && retained.status === VERIFIED) {
        if (bindings.providerSession === null) {
            throw new TypeError("a verified provider session requires a providerSession adapter");
        }
        return constituent(
            PROVIDER_SESSION_KIND,
            bindings.providerSession.adapterId,
            VERIFIED,
            retained.receipt_id,
            retained.evidence,
        );
    }
    if (retained.kind === PROCESS_KIND) {
        let image: Uint8Array | undefined;
        try {
            image = store.readBlob(retained.receipt_id as string);
        } catch (error) {
            throw new ReplayRestoreError(`process image for ${retained.name} is corrupt`, {
                cause: error,
            });
        }
        if (
            image === undefined ||
            image.byteLength !== (retained.evidence?.byte_length as number)
        ) {
            throw new ReplayRestoreError(`process image for ${retained.name} is incomplete`);
        }
        return retained;
    }
    return retained;
}

async function restore(
    engine: ReplayEngine,
    source: ReplaySessionInspection,
    plan: RestorePlan,
    targetTraceCutId: string,
): Promise<void> {
    const context = Object.freeze({
        context_prefix_id: plan.contextPrefixId,
        session_id: source.session_id,
        step_count: plan.stepCount,
    });
    for (const retained of plan.constituents) {
        if (retained.kind === WORLD_KIND) {
            const world = engine.bindings.worlds.find(
                (candidate) => candidate.name === retained.name,
            );
            restoreReplayWorldImage(
                engine.store,
                plan.manifests.get(retained.name as string) as Parameters<
                    typeof restoreReplayWorldImage
                >[1],
                (world as NonNullable<typeof world>).root,
            );
        } else if (retained.kind === PROVIDER_SESSION_KIND && retained.status === VERIFIED) {
            const adapter = engine.bindings.providerSession as NonNullable<
                ReplaySessionBindings["providerSession"]
            >;
            const restored = await adapter.restore(retained.receipt_id as string, context);
            if (restored !== plan.contextPrefixId) {
                throw new ReplayRestoreError(
                    "provider session restored a different context prefix",
                );
            }
        } else if (retained.kind === PROCESS_KIND) {
            const adapter = engine.bindings.processes.find(
                (candidate) => candidate.processId === retained.name,
            ) as ReplaySessionBindings["processes"][number];
            await adapter.restore(
                engine.store.readBlob(retained.receipt_id as string) as Uint8Array,
                Object.freeze({
                    process_id: adapter.processId,
                    session_id: source.session_id,
                    step_count: plan.stepCount,
                }),
            );
        }
    }
    const constituents = plan.constituents.map((retained) =>
        retained.kind === TRACE_CUT_KIND
            ? constituent(TRACE_CUT_KIND, null, VERIFIED, targetTraceCutId, null)
            : retained,
    );
    const body = createReplayRestoreBody({
        constituents,
        context_prefix_id: plan.contextPrefixId,
        prefix_id: plan.prefixId,
        session_id: engine.sessionId,
    });
    const checkpoint = plan.checkpoint;
    append(
        engine,
        "restore",
        body,
        config.traceSchemas.restore,
        CAPTURE_MODE,
        (cut) =>
            checkpoint === null
                ? [(cut as Cut).created_by_record_id]
                : [engine.head, checkpoint.record_id as RecordId],
        checkpoint === null
            ? {
                  append_intent_id: createReplayAppendIntentId(
                      engine.bindings.commandId,
                      "cut:restore",
                  ),
                  cut_id: targetTraceCutId,
                  publisher_owner_id: engine.sessionId,
                  target_owner_id: source.session_id,
                  through_record_id: readReplayBoundaryRecordId(source, plan.stepCount),
              }
            : null,
        false,
    );
}

function constituent(
    kind: string,
    name: string | null,
    status: string,
    receiptId: string | null,
    evidence: ReplayConstituent["evidence"],
): ReplayConstituent {
    return Object.freeze({
        evidence,
        kind,
        name,
        reason: null,
        receipt_id: receiptId,
        status,
    }) as ReplayConstituent;
}

function sameNames(left: readonly string[], right: readonly string[]): boolean {
    return canonical([...left].sort()) === canonical([...right].sort());
}

function canonical(value: unknown): string {
    return canonicalizeSemanticValue(value as SemanticValue);
}
