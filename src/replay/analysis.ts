import {
    REPLAY_CHANGE_DIMENSIONS,
    REPLAY_DIVERGENCE_CAUSES,
    REPLAY_DIVERGENCE_STATUSES,
    REPLAY_EFFECT_DISPOSITIONS,
    REPLAY_STEP_KINDS,
} from "../protocol/values.generated.ts";
import { assertScopeText, readScopeDataObject } from "../scope/validation.ts";
import type { SQLiteTraceStore } from "../store/sqlite-trace-store.ts";
import { ReplayEvidenceError } from "./errors.ts";
import { inspectReplaySession } from "./inspection.ts";
import { classifyReplayConstituents, readReplayConstituents } from "./records.ts";
import type {
    ReplayCheckpointClassificationResult,
    ReplayCheckpointInspection,
    ReplayDependencyAnalysis,
    ReplayDivergenceAnalysis,
    ReplayDivergenceCause,
    ReplayDivergenceStatus,
    ReplayDivergenceStep,
    ReplayStepInspection,
} from "./types.ts";

const [TASK_CHANGE, PROVIDER_CHANGE, HANDLERS_CHANGE] = REPLAY_CHANGE_DIMENSIONS;
const [ROOT_CAUSE, PROPAGATED_CAUSE, UNEXPLAINED_CAUSE] = REPLAY_DIVERGENCE_CAUSES;
const [IDENTICAL, DIVERGED, SOURCE_ONLY, REPLAY_ONLY] = REPLAY_DIVERGENCE_STATUSES;
const [PROVIDER_KIND] = REPLAY_STEP_KINDS;
const [, , REFUSED] = REPLAY_EFFECT_DISPOSITIONS;

/** Options for {@link analyzeReplayDivergence}. */
export type AnalyzeReplayDivergenceOptions = {
    /** Clock used when inspecting both sessions; defaults to `Date.now`. */
    readonly clock?: () => number;
    /** Branch session whose origin names the source. */
    readonly replaySessionId: string;
    /** Source session. */
    readonly sourceSessionId: string;
};

/** Options for {@link analyzeReplayDependencies}. */
export type AnalyzeReplayDependenciesOptions = {
    /** Clock used when inspecting the session; defaults to `Date.now`. */
    readonly clock?: () => number;
    /** Session identity. */
    readonly sessionId: string;
    /** Step whose dependents are analyzed. */
    readonly stepIndex: number;
};

/**
 * Derives from retained constituents how a checkpoint or restore can be reproduced.
 *
 * `atomic` means every constituent is verified or not applicable, `reconstructive` means some
 * constituent is re-derived from recorded evidence and none is unavailable, and `unavailable` means
 * at least one constituent cannot be restored. Receipt identifiers alone are never treated as proof:
 * rewind and replay re-verify every verified constituent before use.
 *
 * @param checkpoint - Checkpoint inspection or any value with retained constituents.
 * @returns Frozen classification with constituents grouped by status.
 * @throws {TypeError} If the constituents are malformed or out of configured order.
 *
 * @example
 * ```ts
 * const { classification, unavailable } = classifyReplayCheckpoint(inspection.checkpoints[0]);
 * ```
 */
export function classifyReplayCheckpoint(
    checkpoint: Pick<ReplayCheckpointInspection, "constituents">,
): ReplayCheckpointClassificationResult {
    const fields = readScopeDataObject(
        checkpoint,
        ["constituents"],
        "checkpoint",
        Object.keys(checkpoint as object).filter((key) => key !== "constituents"),
    );
    return classifyReplayConstituents(readReplayConstituents(fields.constituents));
}

/**
 * Aligns a branch session with its source and classifies every divergence.
 *
 * Steps are aligned by index. A step is `identical` when both sessions retain the same content
 * identity, `diverged` when both retain different content, and `source_only` or `replay_only` when
 * one session ends earlier. A non-identical step is `propagated` when one of its declared
 * dependencies is not identical, `root` when its dependencies are identical and its kind is explained
 * by a declared change (task or provider for provider steps, handlers or a replay-policy refusal for
 * effect steps), and `unexplained` otherwise. Analysis is read-only.
 *
 * @param store - Open trace store holding both sessions.
 * @param options - Source and branch session identities.
 * @returns Frozen divergence analysis.
 * @throws {ReplayEvidenceError} If the branch does not originate from the source or evidence is invalid.
 * @throws {TypeError} If options are malformed.
 *
 * @example
 * ```ts
 * const analysis = analyzeReplayDivergence(store, { replaySessionId, sourceSessionId });
 * assert.deepEqual(analysis.unexplained, []);
 * ```
 */
export function analyzeReplayDivergence(
    store: SQLiteTraceStore,
    options: AnalyzeReplayDivergenceOptions,
): ReplayDivergenceAnalysis {
    const fields = readScopeDataObject(
        options,
        ["replaySessionId", "sourceSessionId"],
        "analyzeReplayDivergence options",
        ["clock"],
    );
    assertScopeText(fields.replaySessionId, "replaySessionId");
    assertScopeText(fields.sourceSessionId, "sourceSessionId");
    const clock = fields.clock as (() => number) | undefined;
    const source = inspectReplaySession(store, {
        sessionId: fields.sourceSessionId,
        ...(clock === undefined ? {} : { clock }),
    });
    const replay = inspectReplaySession(store, {
        sessionId: fields.replaySessionId,
        ...(clock === undefined ? {} : { clock }),
    });
    if (replay.origin?.source_session_id !== source.session_id) {
        throw new ReplayEvidenceError("the branch session does not originate from the source");
    }
    const changes = replay.origin.changes;
    const statuses: ReplayDivergenceStatus[] = [];
    const steps: ReplayDivergenceStep[] = [];
    const count = Math.max(source.steps.length, replay.steps.length);
    for (let index = 0; index < count; index += 1) {
        const left = source.steps[index];
        const right = replay.steps[index];
        const status =
            left !== undefined && right !== undefined
                ? left.step_id === right.step_id
                    ? IDENTICAL
                    : DIVERGED
                : left === undefined
                  ? REPLAY_ONLY
                  : SOURCE_ONLY;
        statuses.push(status);
        steps.push(
            Object.freeze({
                cause:
                    status === IDENTICAL
                        ? null
                        : divergenceCause(
                              (right ?? left) as ReplayStepInspection,
                              statuses,
                              changes,
                          ),
                index,
                replay_step_id: right?.step_id ?? null,
                source_step_id: left?.step_id ?? null,
                status,
            }),
        );
    }
    const first = steps.find((step) => step.status !== IDENTICAL)?.index ?? null;
    const commonLength = first ?? count;
    return Object.freeze({
        changes,
        common_prefix_id:
            commonLength === 0
                ? null
                : (replay.steps[commonLength - 1] as ReplayStepInspection).prefix_id,
        first_divergence_index: first,
        replay_session_id: replay.session_id,
        source_session_id: source.session_id,
        steps: Object.freeze(steps),
        unexplained: Object.freeze(
            steps.filter((step) => step.cause === UNEXPLAINED_CAUSE).map((step) => step.index),
        ),
    });
}

/**
 * Returns the steps a change at one step can affect through declared dependencies.
 *
 * Dependents are the transitive closure of later steps that declare a dependency on the step or on
 * another dependent; every other later step is independent. Analysis is read-only and relies on the
 * program's declared dependencies.
 *
 * @param store - Open trace store holding the session.
 * @param options - Session identity and step index.
 * @returns Frozen dependency analysis.
 * @throws {ReplayEvidenceError} If session evidence is invalid.
 * @throws {TypeError} If options are malformed or the step is not retained.
 *
 * @example
 * ```ts
 * const { dependents } = analyzeReplayDependencies(store, { sessionId, stepIndex: 0 });
 * ```
 */
export function analyzeReplayDependencies(
    store: SQLiteTraceStore,
    options: AnalyzeReplayDependenciesOptions,
): ReplayDependencyAnalysis {
    const fields = readScopeDataObject(
        options,
        ["sessionId", "stepIndex"],
        "analyzeReplayDependencies options",
        ["clock"],
    );
    assertScopeText(fields.sessionId, "sessionId");
    const clock = fields.clock as (() => number) | undefined;
    const inspection = inspectReplaySession(store, {
        sessionId: fields.sessionId,
        ...(clock === undefined ? {} : { clock }),
    });
    const stepIndex = fields.stepIndex as number;
    if (!Number.isSafeInteger(stepIndex) || stepIndex < 0 || stepIndex >= inspection.steps.length) {
        throw new TypeError("stepIndex must name a retained step");
    }
    const affected = new Set([stepIndex]);
    const dependents: number[] = [];
    const independent: number[] = [];
    for (const step of inspection.steps.slice(stepIndex + 1)) {
        if (step.depends_on.some((dependency) => affected.has(dependency))) {
            affected.add(step.index);
            dependents.push(step.index);
        } else {
            independent.push(step.index);
        }
    }
    return Object.freeze({
        dependents: Object.freeze(dependents),
        independent: Object.freeze(independent),
        session_id: inspection.session_id,
        step_index: stepIndex,
    });
}

function divergenceCause(
    step: ReplayStepInspection,
    statuses: readonly ReplayDivergenceStatus[],
    changes: readonly string[],
): ReplayDivergenceCause {
    if (step.depends_on.some((dependency) => statuses[dependency] !== IDENTICAL)) {
        return PROPAGATED_CAUSE;
    }
    const explained =
        step.kind === PROVIDER_KIND
            ? changes.includes(TASK_CHANGE) || changes.includes(PROVIDER_CHANGE)
            : changes.includes(HANDLERS_CHANGE) || step.effect?.disposition === REFUSED;
    return explained ? ROOT_CAUSE : UNEXPLAINED_CAUSE;
}
