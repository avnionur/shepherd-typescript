import { replayProtocolConfig } from "../protocol/config.ts";
import {
    REPLAY_DIVERGENCE_STATUSES,
    REPLAY_REGRESSION_STRATEGIES,
    REPLAY_STEP_SOURCES,
} from "../protocol/values.generated.ts";
import { assertScopeText, readScopeArray, readScopeDataObject } from "../scope/validation.ts";
import type { SQLiteTraceStore } from "../store/sqlite-trace-store.ts";
import { ReplayEvidenceError } from "./errors.ts";
import { inspectReplaySession } from "./inspection.ts";
import type {
    ReplayBranchDiff,
    ReplayBranchDiffStep,
    ReplayCapturedEffect,
    ReplayEffectPresence,
    ReplayRegressionEvaluation,
    ReplayRegressionSearch,
    ReplayRegressionStrategy,
    ReplayRevision,
    ReplayRevisionAddress,
    ReplaySessionDiff,
    ReplaySessionInspection,
    ReplayStepInspection,
} from "./types.ts";

const [IDENTICAL, DIVERGED, ANCESTOR_ONLY, BRANCH_ONLY] = REPLAY_DIVERGENCE_STATUSES;
const [BISECT] = REPLAY_REGRESSION_STRATEGIES;
const [LIVE_SOURCE] = REPLAY_STEP_SOURCES;

/** Options for {@link diffReplaySessions}. */
export type DiffReplaySessionsOptions = {
    /** Clock used when inspecting sessions; defaults to `Date.now`. */
    readonly clock?: () => number;
    /**
     * Distinct session identities to compare, at least two and at most the configured
     * `replay.divergence.maxSessions`; order is preserved in the result.
     */
    readonly sessionIds: readonly string[];
};

/** Options for {@link findFirstReplayRegression}. */
export type FindFirstReplayRegressionOptions = {
    /** Clock used when inspecting sessions; defaults to `Date.now`. */
    readonly clock?: () => number;
    /** Searched session identity; its revisions span its whole lineage. */
    readonly sessionId: string;
    /** Configured search strategy; defaults to the first configured strategy (`bisect`). */
    readonly strategy?: ReplayRegressionStrategy;
    /**
     * Caller verdict over one revision: `true` accepts it (good), `false` rejects it (bad). It must
     * be deterministic; `bisect` additionally assumes that once rejected, every later revision is
     * rejected.
     *
     * @param revision - Revision to judge.
     * @returns Whether the revision is good.
     */
    readonly verdict: (revision: ReplayRevision) => boolean | Promise<boolean>;
};

/**
 * Diffs any set of replay sessions against their lowest common lineage ancestor by captured effects.
 *
 * The lineage of a session is the chain of retained branch origins from its root session to itself.
 * The ancestor is the deepest session present in every lineage, so sibling rollouts, workers
 * replayed from one source, and candidate branches all resolve to their shared source; sessions
 * without a shared root have no ancestor. The base is the longest ancestor prefix that every branch
 * retains with identical step identities (empty without an ancestor). Each branch is aligned by index
 * against the ancestor from the base onward, and every effect step a branch retains past the base
 * is reported per branch and once in the cross-branch effect table with the branches that captured
 * it and whether the ancestor retains it too. Effects are identified by step content identity, so
 * the same intent with another outcome is a different captured effect. Diffing is read-only.
 *
 * @param store - Open trace store holding every session and its lineage.
 * @param options - Session identities and an optional clock.
 * @returns Frozen N-way diff.
 * @throws {ReplayEvidenceError} If a session is absent or its evidence is inconsistent.
 * @throws {ReplayCompatibilityError} If retained evidence names an unsupported replay version.
 * @throws {TypeError} If options are malformed, repeat a session, or exceed the configured bound.
 *
 * @example
 * ```ts
 * const diff = diffReplaySessions(store, { sessionIds: [rolloutA, rolloutB, rolloutC] });
 * console.log(diff.ancestor_session_id, diff.effects.map((effect) => effect.session_ids));
 * ```
 */
export function diffReplaySessions(
    store: SQLiteTraceStore,
    options: DiffReplaySessionsOptions,
): ReplaySessionDiff {
    const fields = readScopeDataObject(options, ["sessionIds"], "diffReplaySessions options", [
        "clock",
    ]);
    const sessionIds = readScopeArray(fields.sessionIds, "sessionIds");
    const maxSessions = replayProtocolConfig.divergence.maxSessions;
    if (sessionIds.length < 2 || sessionIds.length > maxSessions) {
        throw new TypeError(`sessionIds must name between 2 and ${maxSessions} sessions`);
    }
    for (const sessionId of sessionIds) assertScopeText(sessionId, "sessionIds entry");
    if (new Set(sessionIds).size !== sessionIds.length) {
        throw new TypeError("sessionIds must be distinct");
    }
    const read = createSessionReader(store, readClock(fields.clock));
    const lineages = (sessionIds as readonly string[]).map((sessionId) =>
        readLineage(read, sessionId),
    );
    const ancestorId = commonAncestor(lineages);
    const ancestorSteps = ancestorId === null ? [] : read(ancestorId).steps;
    const branches = lineages.map((lineage) => read(lineage.at(-1) as string));
    let base = ancestorSteps.length;
    for (const branch of branches) {
        let shared = 0;
        while (
            shared < base &&
            branch.steps[shared]?.step_id ===
                (ancestorSteps[shared] as ReplayStepInspection).step_id
        ) {
            shared += 1;
        }
        base = shared;
    }
    const ancestorEffects = new Set(
        ancestorSteps.slice(base).flatMap((step) => (step.effect === null ? [] : [step.step_id])),
    );
    const presence = new Map<string, { effect: ReplayCapturedEffect; sessions: string[] }>();
    const branchDiffs = branches.map((branch, position): ReplayBranchDiff => {
        const steps: ReplayBranchDiffStep[] = [];
        const count = Math.max(branch.steps.length, ancestorSteps.length);
        for (let index = base; index < count; index += 1) {
            const left = ancestorSteps[index];
            const right = branch.steps[index];
            steps.push(
                Object.freeze({
                    ancestor_step_id: left?.step_id ?? null,
                    branch_step_id: right?.step_id ?? null,
                    index,
                    kind: ((right ?? left) as ReplayStepInspection).kind,
                    status:
                        left !== undefined && right !== undefined
                            ? left.step_id === right.step_id
                                ? IDENTICAL
                                : DIVERGED
                            : left === undefined
                              ? BRANCH_ONLY
                              : ANCESTOR_ONLY,
                }),
            );
        }
        const effects = branch.steps.slice(base).flatMap((step) =>
            step.effect === null
                ? []
                : [
                      Object.freeze({
                          disposition: step.effect.disposition,
                          effect_id: step.effect.intent.effect_id,
                          effect_kind: step.effect.intent.kind,
                          index: step.index,
                          intent_ref: step.effect.intent_ref,
                          step_id: step.step_id,
                      }),
                  ],
        );
        const captured = new Map(effects.map((effect) => [effect.step_id, effect]));
        for (const [stepId, effect] of captured) {
            const entry = presence.get(stepId) ?? { effect, sessions: [] };
            entry.sessions.push(branch.session_id);
            presence.set(stepId, entry);
        }
        return Object.freeze({
            effects: Object.freeze(effects),
            first_divergence_index: steps.find((step) => step.status !== IDENTICAL)?.index ?? null,
            lineage: lineages[position] as readonly string[],
            session_id: branch.session_id,
            step_count: branch.steps.length,
            steps: Object.freeze(steps),
        });
    });
    return Object.freeze({
        ancestor_session_id: ancestorId,
        base_prefix_id:
            base === 0 ? null : (ancestorSteps[base - 1] as ReplayStepInspection).prefix_id,
        base_step_count: base,
        branches: Object.freeze(branchDiffs),
        effects: Object.freeze(
            [...presence.values()].map(
                ({ effect, sessions }): ReplayEffectPresence =>
                    Object.freeze({
                        disposition: effect.disposition,
                        effect_id: effect.effect_id,
                        effect_kind: effect.effect_kind,
                        in_ancestor: ancestorEffects.has(effect.step_id),
                        intent_ref: effect.intent_ref,
                        session_ids: Object.freeze(sessions),
                        step_id: effect.step_id,
                    }),
            ),
        ),
        session_ids: Object.freeze([...(sessionIds as readonly string[])]),
    });
}

/**
 * Locates the first revision of a session lineage that a caller verdict rejects.
 *
 * Revision `k` is the first `k` steps of the searched session (revision 0 is empty). A branch
 * session retains its inherited prefix as recorded steps, so its revisions span its whole lineage;
 * each revision is attributed to the lineage session that executed its newest step live, found by
 * walking recorded steps back through their source sessions. `linear` evaluates revisions from 0
 * upward and stops at the first rejection. `bisect` evaluates the newest revision (nothing
 * regressed when accepted), then revision 0 (the first revision is bad when rejected), then halves
 * the good/bad interval at the lower midpoint; it needs `O(log n)` verdicts and assumes a monotone
 * verdict. Both are deterministic, evaluate each revision at most once, and append nothing.
 *
 * @param store - Open trace store holding the session and its lineage.
 * @param options - Session identity, verdict, and optional strategy and clock.
 * @returns Frozen search result with every evaluation in order.
 * @throws {ReplayEvidenceError} If a session is absent or its evidence is inconsistent.
 * @throws {ReplayCompatibilityError} If retained evidence names an unsupported replay version.
 * @throws {TypeError} If options are malformed or a verdict returns a non-boolean.
 *
 * @example
 * ```ts
 * const search = await findFirstReplayRegression(store, {
 *     sessionId,
 *     verdict: (revision) => revision.steps.every((step) => step.effect?.disposition !== "refused"),
 * });
 * console.log(search.first_bad?.step_count, search.first_bad?.session_id);
 * ```
 */
export async function findFirstReplayRegression(
    store: SQLiteTraceStore,
    options: FindFirstReplayRegressionOptions,
): Promise<ReplayRegressionSearch> {
    const fields = readScopeDataObject(
        options,
        ["sessionId", "verdict"],
        "findFirstReplayRegression options",
        ["clock", "strategy"],
    );
    assertScopeText(fields.sessionId, "sessionId");
    if (typeof fields.verdict !== "function") {
        throw new TypeError("verdict must be a function");
    }
    const verdict = fields.verdict as FindFirstReplayRegressionOptions["verdict"];
    const strategy = (fields.strategy ?? BISECT) as ReplayRegressionStrategy;
    if (!REPLAY_REGRESSION_STRATEGIES.includes(strategy)) {
        throw new TypeError("strategy must be a configured regression strategy");
    }
    const read = createSessionReader(store, readClock(fields.clock));
    const lineage = readLineage(read, fields.sessionId);
    const session = read(fields.sessionId);
    const address = (stepCount: number): ReplayRevisionAddress =>
        Object.freeze({
            prefix_id:
                stepCount === 0
                    ? null
                    : (session.steps[stepCount - 1] as ReplayStepInspection).prefix_id,
            session_id:
                stepCount === 0 ? session.session_id : liveExecutor(read, session, stepCount - 1),
            step_count: stepCount,
        });
    const evaluations: ReplayRegressionEvaluation[] = [];
    // Each strategy passes every revision to the verdict at most once.
    const judge = async (stepCount: number): Promise<boolean> => {
        const good = await verdict(
            Object.freeze({
                ...address(stepCount),
                steps: Object.freeze(session.steps.slice(0, stepCount)),
            }),
        );
        if (typeof good !== "boolean") {
            throw new TypeError("verdict must return a boolean");
        }
        evaluations.push(Object.freeze({ good, step_count: stepCount }));
        return good;
    };
    const newest = session.steps.length;
    let firstBad: number | null = null;
    if (strategy === BISECT) {
        if (!(await judge(newest))) {
            if (newest === 0 || !(await judge(0))) {
                firstBad = 0;
            } else {
                let good = 0;
                let bad = newest;
                while (bad - good > 1) {
                    const middle = Math.floor((good + bad) / 2);
                    if (await judge(middle)) good = middle;
                    else bad = middle;
                }
                firstBad = bad;
            }
        }
    } else {
        for (let stepCount = 0; stepCount <= newest; stepCount += 1) {
            if (!(await judge(stepCount))) {
                firstBad = stepCount;
                break;
            }
        }
    }
    return Object.freeze({
        evaluations: Object.freeze(evaluations),
        first_bad: firstBad === null ? null : address(firstBad),
        last_good:
            firstBad === null ? address(newest) : firstBad === 0 ? null : address(firstBad - 1),
        lineage,
        session_id: session.session_id,
        strategy,
    });
}

/**
 * Reads the replay-session lineage from the root session to a session.
 *
 * @param store - Open trace store holding the lineage.
 * @param sessionId - Session identity.
 * @param clock - Optional clock used when inspecting sessions.
 * @returns Frozen session identities, root first.
 * @throws {ReplayEvidenceError} If a lineage session is absent or inconsistent.
 * @internal
 */
export function readReplayLineage(
    store: SQLiteTraceStore,
    sessionId: string,
    clock?: () => number,
): readonly string[] {
    return readLineage(createSessionReader(store, readClock(clock)), sessionId);
}

type SessionReader = (sessionId: string) => ReplaySessionInspection;

function createSessionReader(store: SQLiteTraceStore, clock: () => number): SessionReader {
    const cache = new Map<string, ReplaySessionInspection>();
    return (sessionId) => {
        const known = cache.get(sessionId);
        if (known !== undefined) return known;
        const inspection = inspectReplaySession(store, { clock, sessionId });
        cache.set(sessionId, inspection);
        return inspection;
    };
}

function readClock(value: unknown): () => number {
    if (value !== undefined && typeof value !== "function") {
        throw new TypeError("clock must be a function");
    }
    return (value ?? Date.now) as () => number;
}

function readLineage(read: SessionReader, sessionId: string): readonly string[] {
    const reversed: string[] = [];
    let current: string | null = sessionId;
    // A branch record cites its source's retained record, so content addressing keeps lineage acyclic.
    while (current !== null) {
        reversed.push(current);
        current = read(current).origin?.source_session_id ?? null;
    }
    return Object.freeze(reversed.reverse());
}

function commonAncestor(lineages: readonly (readonly string[])[]): string | null {
    const [first, ...rest] = lineages as [readonly string[], ...(readonly string[])[]];
    let ancestor: string | null = null;
    for (let index = 0; index < first.length; index += 1) {
        const candidate = first[index] as string;
        if (rest.some((lineage) => lineage[index] !== candidate)) break;
        ancestor = candidate;
    }
    return ancestor;
}

function liveExecutor(
    read: SessionReader,
    session: ReplaySessionInspection,
    stepIndex: number,
): string {
    let current = session;
    while ((current.steps[stepIndex] as ReplayStepInspection).source !== LIVE_SOURCE) {
        const sourceId = current.origin?.source_session_id;
        // Inspection proves every recorded step against its source session's step.
        /* node:coverage disable */
        if (sourceId === undefined) {
            throw new ReplayEvidenceError("a recorded step has no source session");
        }
        /* node:coverage enable */
        current = read(sourceId);
    }
    return current.session_id;
}
