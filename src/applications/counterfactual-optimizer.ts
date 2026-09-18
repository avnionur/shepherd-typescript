import type { SemanticValue } from "../canonical/canonical-record.ts";
import { applicationsProtocolConfig, kernelProtocolConfig } from "../protocol/config.ts";
import {
    APPLICATION_CRO_BASELINE_KINDS,
    APPLICATION_CRO_CANDIDATE_STATUSES,
    APPLICATION_CRO_PHASES,
    APPLICATION_KINDS,
    APPLICATION_PROTOCOL_SURFACES,
    RECORD_MODES,
    REPLAY_CHANGE_DIMENSIONS,
    REPLAY_RECOVERY_CLASSIFICATIONS,
    REPLAY_STEP_KINDS,
    REPLAY_STEP_SOURCES,
    REPLAY_TERMINAL_STATUSES,
} from "../protocol/values.generated.ts";
import { ROOT_WITNESS_ID } from "../record/root-witness.ts";
import type { RecordId } from "../record/types.ts";
import { analyzeReplayDependencies, analyzeReplayDivergence } from "../replay/analysis.ts";
import { replayReplaySession } from "../replay/branch.ts";
import { ReplaySessionInterruptedError } from "../replay/errors.ts";
import { inspectReplaySession } from "../replay/inspection.ts";
import { deriveReplaySessionId, runReplaySession } from "../replay/session.ts";
import type {
    ReplayReplaySessionOptions,
    ReplaySessionInspection,
    ReplayTerminalInspection,
} from "../replay/types.ts";
import { assertScopeText, readScopeArray, readScopeDataObject } from "../scope/validation.ts";
import type { SQLiteTraceStore } from "../store/sqlite-trace-store.ts";
import type { OwnerRecord } from "../store/types.ts";
import {
    type CroCandidateBody,
    type CroOpenedBody,
    readCroCandidateBody,
    readCroChanges,
    readCroOpenedBody,
    readEvaluation,
} from "./counterfactual-records.ts";
import type {
    CounterfactualBaselineKind,
    CounterfactualCandidateInspection,
    CounterfactualCandidatePlan,
    CounterfactualCandidateRecord,
    CounterfactualEvaluation,
    CounterfactualEvaluator,
    CounterfactualFailure,
    CounterfactualOptimizationInspection,
    CounterfactualOptimizationReceipt,
    CounterfactualWorkflowDefinition,
    RunCounterfactualOptimizationOptions,
} from "./counterfactual-types.ts";
import {
    ApplicationBudgetError,
    ApplicationEvidenceError,
    ApplicationProtocolError,
    ApplicationVerificationError,
} from "./errors.ts";
import {
    applicationProtocolId,
    createApplicationManifest,
    deriveApplicationOwnerId,
    readApplicationProtocol,
    readRetainedManifest,
    retainApplicationManifest,
} from "./manifest.ts";
import {
    addApplicationCosts,
    assertApplicationDigest,
    canonical,
    createApplicationAppendIntentId,
    createApplicationAppendRequest,
    createApplicationCommandId,
    createVersionedApplicationBody,
    measureReplaySessionCost,
    prefixedApplicationId,
    readCount,
} from "./records.ts";
import type {
    ApplicationArtifactSource,
    ApplicationCostSummary,
    ApplicationProtocolDefinition,
} from "./types.ts";

const config = applicationsProtocolConfig;
const cro = config.cro;
const [CAPTURE_MODE] = RECORD_MODES;
const [, CRO_KIND] = APPLICATION_KINDS;
const [PROMPT_KIND, SCHEMA_KIND, TOOL_KIND] = APPLICATION_PROTOCOL_SURFACES;
const [OPENED_PHASE, CANDIDATE_PHASE] = APPLICATION_CRO_PHASES;
const [PROPOSED, EVALUATED, PROMOTED, REJECTED] = APPLICATION_CRO_CANDIDATE_STATUSES;
const [FULL_REPLAY] = APPLICATION_CRO_BASELINE_KINDS;
const [PROVIDER_STEP] = REPLAY_STEP_KINDS;
const [LIVE_SOURCE] = REPLAY_STEP_SOURCES;
const [TASK_CHANGE] = REPLAY_CHANGE_DIMENSIONS;
const [, RUNNING_CLASSIFICATION] = REPLAY_RECOVERY_CLASSIFICATIONS;
const [FINISHED_SESSION] = REPLAY_TERMINAL_STATUSES;
const BASELINE_STEP = "baseline";
const BRANCH_STEP = "branch";
const OUTCOME_STEP = "outcome";
const PROMOTION_STEP = "promotion";

type CroProtocol = {
    readonly candidates: number;
    readonly definition: ApplicationProtocolDefinition;
    readonly minPromotionScore: number;
    readonly providerCalls: number;
};

type Candidate = {
    readonly handlers: unknown;
    readonly plan: CounterfactualCandidatePlan;
    readonly program: unknown;
    readonly provider: unknown;
    readonly task: unknown;
};

type RetainedCandidate = {
    readonly body: CroCandidateBody;
    readonly record_id: RecordId;
};

type RetainedRecords = {
    readonly candidates: ReadonlyMap<
        string,
        { proposed?: RetainedCandidate; outcome?: RetainedCandidate }
    >;
    readonly head: RecordId;
    readonly manifest: ReturnType<typeof readRetainedManifest>;
    readonly opened: { readonly body: CroOpenedBody; readonly record_id: RecordId };
    readonly promotion: RetainedCandidate | null;
};

type Run = {
    readonly applicationId: string;
    readonly baseline: CounterfactualWorkflowDefinition;
    readonly candidates: ReadonlyMap<string, Candidate>;
    readonly claimId: string;
    readonly clock: { readonly clock?: () => number };
    head: RecordId;
    readonly protocol: CroProtocol;
    spent: number;
    readonly store: SQLiteTraceStore;
};

/**
 * Runs the counterfactual workflow optimizer (Appendix F) over replay sessions.
 *
 * The baseline workflow is recorded once through `runReplaySession`. Each declared candidate, in
 * order, forks its source session (its parent candidate's branch, or the baseline): the affected
 * steps are the transitive dependents of the edited step from `analyzeReplayDependencies`, and the
 * branch replays from the step boundary immediately before the earliest affected step through
 * `replayReplaySession`, declaring exactly the candidate's change dimensions; every earlier step is
 * served from the source journal. The live suffix runs with the candidate's program, provider, and
 * handler stack where it supplies them, else those of the nearest ancestor in its parent chain that
 * did, else the baseline's; an undeclared task resolves through the source's branch ancestry. A
 * candidate whose edited step has no dependent branches at the
 * source's final boundary and replays zero live steps. The baseline session must finish. A branch
 * (or, with the `full_replay` baseline, its full replay) that ended with any terminal status other
 * than `finished` is retained as rejected with the evidence failure before the evaluator is
 * consulted, and the run stops, as for a disproven candidate. `analyzeReplayDivergence` must prove
 * that no step before the target diverged and that no divergence is unexplained. The caller's
 * evaluator gates each proven candidate, and the best passing candidate whose score reaches the protocol's
 * minimum promotion score is promoted once. Every candidate is retained as proposed and then as
 * evaluated or rejected in `shepherd.application.cro_candidate.v1` records with lineage, target,
 * affected steps, branch identity, divergence summary, verdict, and measured cost; the manifest is
 * retained last with the terminal cut. With the `full_replay` baseline, each proven candidate is
 * also replayed live from step boundary zero of its source with the same resolved workflow and its
 * measured provider calls and cache reads are retained. The baseline's measured provider calls,
 * and every candidate session's projected and then measured calls, are checked against the
 * provider-call budget.
 * Repeating the command resumes from retained evidence: terminal sessions are never re-executed,
 * and a completed run returns its retained manifest.
 *
 * @param store - Open writable trace store.
 * @param options - Command, claim, protocol, baseline workflow, candidates, evaluator, and
 * optional baselines and clock.
 * @returns The retained manifest and the record-derived inspection.
 * @throws {ApplicationProtocolError} If the protocol is malformed, is not a counterfactual
 * optimization protocol, lacks a required surface or budget, a candidate declares an edit kind
 * outside the replay change dimensions, an edited step index lies outside the baseline session (after
 * the baseline and before any application record), or the run was opened under another protocol.
 * Declared candidates are otherwise validated before any record is written.
 * @throws {ApplicationBudgetError} If the candidate set exceeds the protocol's candidate budget, the
 * measured baseline exceeds the provider-call budget (before any application record), a new
 * session's projected calls would exceed it, or a session's measured calls exceeded it.
 * @throws {ApplicationEvidenceError} If the baseline session did not finish (before any application
 * record), a branch diverged before its target or without explanation, a branch or full-replay
 * session ended failed or cancelled, or a branch or full-replay session was left interrupted by a dead writer whose lease expired (the
 * candidate is retained as rejected first), a child's edited step is not retained in its parent's
 * branch, or retained evidence is inconsistent.
 * @throws {ApplicationVerificationError} If the evaluator throws or returns a malformed verdict (the
 * candidate is retained as rejected first).
 * @throws {ReplayLeaseConflictError} If a session is held by another writer.
 * @throws {ReplaySessionInterruptedError} If the baseline session was left non-terminal by a dead
 * writer (every rerun of the command raises it; recover under a new command identity), or a
 * candidate session is still `running` under a live lease.
 * @throws {TraceStoreError} If the store is closed.
 * @throws {TypeError} If options or a candidate definition are malformed.
 *
 * @example
 * ```ts
 * const { inspection, manifest } = await runCounterfactualOptimization(store, {
 *     baseline: { program, programId: "workflow.v1", provider },
 *     baselines: ["full_replay"],
 *     candidates: [{ changes: ["provider"], name: "stronger-draft", provider: alternate, stepIndex: 0 }],
 *     claimId: "optimizer",
 *     commandId: "application:cro:1",
 *     evaluate: ({ branch }) => ({ passed: true, reason: "tests pass", score: 1 }),
 *     protocol,
 * });
 * ```
 */
export async function runCounterfactualOptimization(
    store: SQLiteTraceStore,
    options: RunCounterfactualOptimizationOptions,
): Promise<CounterfactualOptimizationReceipt> {
    const fields = readScopeDataObject(
        options,
        ["baseline", "candidates", "claimId", "commandId", "evaluate", "protocol"],
        "runCounterfactualOptimization options",
        ["baselines", "clock"],
    );
    assertScopeText(fields.commandId, "commandId");
    assertScopeText(fields.claimId, "claimId");
    const protocol = readCroProtocol(fields.protocol);
    const protocolId = applicationProtocolId(protocol.definition);
    const baseline = readWorkflow(fields.baseline);
    const baselines = readBaselines(fields.baselines ?? []);
    const evaluate = readFunction(fields.evaluate, "evaluate") as CounterfactualEvaluator;
    const clock =
        fields.clock === undefined
            ? {}
            : { clock: readFunction(fields.clock, "clock") as () => number };
    const applicationId = deriveApplicationOwnerId(fields.commandId);
    const candidates = readCandidates(fields.candidates, protocol, applicationId);
    const plans = candidates.map((candidate) => candidate.plan);
    let retained =
        store.readOwner(applicationId).length === 0 ? null : readCroRecords(store, applicationId);
    if (retained !== null) {
        const opened = retained.opened.body;
        if (opened.protocol_id !== protocolId) {
            throw new ApplicationProtocolError(
                `application ${applicationId} was opened under another protocol`,
            );
        }
        assert(
            opened.command_id === fields.commandId &&
                canonical(opened.baselines) === canonical(baselines) &&
                canonical(opened.candidates) === canonical(plans),
            `application ${applicationId} was opened with different candidates or baselines`,
        );
        if (retained.manifest !== null) {
            return Object.freeze({
                inspection: inspectCounterfactualOptimization(store, applicationId),
                manifest: retained.manifest.manifest,
            });
        }
    }
    const run: Run = {
        applicationId,
        baseline,
        candidates: new Map(
            candidates.map((candidate) => [candidate.plan.candidate_id, candidate]),
        ),
        claimId: fields.claimId,
        clock,
        head: "" as RecordId,
        protocol,
        spent: 0,
        store,
    };
    const baselineCommand = commandOf(applicationId, BASELINE_STEP, {});
    const source = (
        await runReplaySession(store, {
            claimId: run.claimId,
            ...clock,
            commandId: baselineCommand,
            ...definedFields({
                handlers: baseline.handlers,
                provider: baseline.provider,
                task: baseline.task,
            }),
            program: baseline.program,
            programId: baseline.programId,
        })
    ).inspection;
    const sourceTerminal = source.terminal as ReplayTerminalInspection;
    if (sourceTerminal.status !== FINISHED_SESSION) {
        throw new ApplicationEvidenceError(
            `baseline session ${source.session_id} did not finish and cannot be optimized`,
        );
    }
    run.spent = measureReplaySessionCost(source).provider_calls;
    for (const { plan } of candidates) {
        if (plan.edited_step_index >= source.steps.length) {
            throw new ApplicationProtocolError(
                `candidate ${plan.name} edits step ${plan.edited_step_index} outside the ${source.steps.length} baseline steps`,
            );
        }
    }
    assertMeasuredBudget(run, source.session_id);
    if (retained === null) {
        append(
            run,
            null,
            OPENED_PHASE,
            createVersionedApplicationBody({
                application_id: applicationId,
                baseline_session_id: source.session_id,
                baselines,
                candidates: plans,
                command_id: fields.commandId,
                kind: CRO_KIND,
                phase: OPENED_PHASE,
                protocol_id: protocolId,
            }),
            [sourceTerminal.record_id],
        );
        retained = readCroRecords(store, applicationId);
    }
    run.head = retained.head;
    const outcomes = new Map<string, CroCandidateBody>();
    for (const candidate of candidates) {
        const retainedOutcome = retained.candidates.get(candidate.plan.candidate_id)?.outcome?.body;
        let outcome: CroCandidateBody;
        if (retainedOutcome === undefined) {
            outcome = await runCandidate(
                run,
                candidate,
                retained,
                source.session_id,
                outcomes,
                baselines,
                evaluate,
            );
        } else {
            if (retainedOutcome.failure !== null) {
                throw failureError(retainedOutcome.failure);
            }
            run.spent +=
                (retainedOutcome.cost as ApplicationCostSummary).provider_calls +
                (retainedOutcome.baseline?.provider_calls ?? 0);
            outcome = retainedOutcome;
        }
        outcomes.set(candidate.plan.candidate_id, outcome);
    }
    const settled = readCroRecords(store, applicationId);
    if (settled.promotion === null) {
        const best = plans
            .map(
                (plan) =>
                    (
                        settled.candidates.get(plan.candidate_id) as {
                            outcome: RetainedCandidate;
                        }
                    ).outcome,
            )
            .filter(
                ({ body }) =>
                    body.status === EVALUATED &&
                    (body.evaluation as CounterfactualEvaluation).score >=
                        protocol.minPromotionScore,
            )
            .reduce<RetainedCandidate | null>(
                (leader, entry) =>
                    leader !== null &&
                    (leader.body.evaluation as CounterfactualEvaluation).score >=
                        (entry.body.evaluation as CounterfactualEvaluation).score
                        ? leader
                        : entry,
                null,
            );
        if (best !== null) {
            append(run, run.head, PROMOTION_STEP, promotedBody(best.body), [best.record_id]);
        }
    }
    const receipt = retainApplicationManifest(store, {
        manifest: buildManifest(run, source, readCroRecords(store, applicationId)),
    });
    return Object.freeze({
        inspection: inspectCounterfactualOptimization(store, applicationId),
        manifest: receipt.manifest,
    });
}

/**
 * Reads one counterfactual optimization run as an immutable record-derived view without mutation.
 *
 * Every record on the application owner path is validated: the opened record and its candidate
 * plan, each candidate's proposed and outcome records in declared order with identical plan,
 * target, affected steps, and derived branch identity, the lineage of every target to its parent's
 * branch or the baseline, the single terminal promotion, the manifest, and the terminal cut.
 * Inspection works on reopened, read-only, and imported stores and never embeds live-session
 * state, so it is identical across them.
 *
 * @param store - Open trace store, writable or read-only.
 * @param applicationId - Application identity derived by {@link deriveApplicationOwnerId}.
 * @returns The validated inspection.
 * @throws {ApplicationEvidenceError} If the application is not retained or its evidence is
 * inconsistent.
 * @throws {TraceStoreError} If the store is closed.
 * @throws {TypeError} If the application identity is malformed.
 *
 * @example
 * ```ts
 * const inspection = inspectCounterfactualOptimization(store, deriveApplicationOwnerId(commandId));
 * console.log(inspection.promotion?.name ?? "nothing promoted");
 * ```
 */
export function inspectCounterfactualOptimization(
    store: SQLiteTraceStore,
    applicationId: string,
): CounterfactualOptimizationInspection {
    assertApplicationDigest(applicationId, config.identity.applicationIdPrefix, "applicationId");
    const retained = readCroRecords(store, applicationId);
    const opened = retained.opened.body;
    return Object.freeze({
        application_id: applicationId,
        baseline_session_id: opened.baseline_session_id,
        baselines: opened.baselines,
        candidates: Object.freeze(
            opened.candidates.map((plan): CounterfactualCandidateInspection => {
                const state = retained.candidates.get(plan.candidate_id);
                return Object.freeze({
                    ...plan,
                    outcome: toRecord(state?.outcome),
                    proposed: toRecord(state?.proposed),
                });
            }),
        ),
        command_id: opened.command_id,
        cut_id: retained.manifest === null ? null : retained.manifest.cut_id,
        kind: opened.kind,
        manifest: retained.manifest === null ? null : retained.manifest.manifest,
        manifest_record_id: retained.manifest === null ? null : retained.manifest.record_id,
        opened_record_id: retained.opened.record_id,
        promotion: toRecord(retained.promotion),
        protocol_id: opened.protocol_id,
    });
}

async function runCandidate(
    run: Run,
    candidate: Candidate,
    retained: RetainedRecords,
    baselineSessionId: string,
    outcomes: ReadonlyMap<string, CroCandidateBody>,
    baselines: readonly CounterfactualBaselineKind[],
    evaluate: CounterfactualEvaluator,
): Promise<CroCandidateBody> {
    const { applicationId, clock, store } = run;
    const plan = candidate.plan;
    const sourceSessionId =
        plan.parent_candidate_id === null
            ? baselineSessionId
            : (outcomes.get(plan.parent_candidate_id) as CroCandidateBody).branch_session_id;
    const source = inspectReplaySession(store, { sessionId: sourceSessionId, ...clock });
    if (plan.edited_step_index >= source.steps.length) {
        throw new ApplicationEvidenceError(
            `candidate ${plan.name} edits step ${plan.edited_step_index} but its source retains ${source.steps.length} steps`,
        );
    }
    const { dependents } = analyzeReplayDependencies(store, {
        sessionId: sourceSessionId,
        stepIndex: plan.edited_step_index,
        ...clock,
    });
    const stepCount = dependents[0] ?? source.steps.length;
    const target = Object.freeze({
        prefix_id: (source.steps[stepCount - 1] as { readonly prefix_id: string }).prefix_id,
        source_session_id: sourceSessionId,
        step_index: stepCount,
    });
    const branchCommand = commandOf(applicationId, BRANCH_STEP, {
        candidate_id: plan.candidate_id,
    });
    const proposed = {
        ...plan,
        affected_steps: dependents,
        application_id: applicationId,
        baseline: null,
        branch_session_id: deriveReplaySessionId(branchCommand),
        cost: null,
        divergence: null,
        evaluation: null,
        failure: null,
        phase: CANDIDATE_PHASE,
        status: PROPOSED,
        target,
    };
    if (retained.candidates.get(plan.candidate_id)?.proposed === undefined) {
        append(run, run.head, `${PROPOSED}:${plan.candidate_id}`, proposed, []);
    }
    const replayed = await replayCandidate(run, candidate, branchCommand, source, stepCount);
    const branch = replayed.session;
    const cost = measureReplaySessionCost(branch);
    const analysis = analyzeReplayDivergence(store, {
        replaySessionId: branch.session_id,
        sourceSessionId,
        ...clock,
    });
    const settled = {
        ...proposed,
        cost,
        divergence: {
            common_prefix_id: analysis.common_prefix_id,
            first_divergence_index: analysis.first_divergence_index,
            live_steps: branch.steps.filter((step) => step.source === LIVE_SOURCE).length,
            recorded_steps: branch.steps.filter((step) => step.source !== LIVE_SOURCE).length,
            unexplained: analysis.unexplained,
        },
    };
    const causes = [branch.head_record_id as RecordId];
    if (replayed.interrupted !== null) {
        return retainInterruption(run, settled, causes, replayed.interrupted);
    }
    // A branch that failed or was cancelled proves nothing about the edit: it is rejected before
    // the divergence proof and the evaluator, like a disproven candidate, and the run stops.
    assertFinished(run, settled, causes, "branch", branch);
    if (
        analysis.unexplained.length > 0 ||
        (analysis.first_divergence_index ?? stepCount) < stepCount
    ) {
        return retainFailure(run, settled, causes, {
            code: config.errors.evidenceCode,
            reason: `candidate ${plan.candidate_id} diverged before its target or without explanation`,
        });
    }
    let comparison = null;
    if (baselines.includes(FULL_REPLAY)) {
        const replayedFull = await replayCandidate(
            run,
            candidate,
            commandOf(applicationId, FULL_REPLAY, { candidate_id: plan.candidate_id }),
            source,
            0,
        );
        const full = replayedFull.session;
        if (replayedFull.interrupted !== null) {
            return retainInterruption(
                run,
                settled,
                [...causes, full.head_record_id as RecordId],
                replayedFull.interrupted,
            );
        }
        assertFinished(
            run,
            settled,
            [...causes, full.head_record_id as RecordId],
            "full replay",
            full,
        );
        const measured = measureReplaySessionCost(full);
        comparison = {
            cache_read_input_tokens: measured.cache_read_input_tokens,
            kind: FULL_REPLAY,
            provider_calls: measured.provider_calls,
            session_id: full.session_id,
        };
        causes.push(full.head_record_id as RecordId);
    }
    const evaluated = { ...settled, baseline: comparison };
    let verdict: CounterfactualEvaluation;
    try {
        verdict = readEvaluation(
            await evaluate(
                Object.freeze({
                    affectedSteps: dependents,
                    branch,
                    candidate: plan,
                    cost,
                    divergence: analysis,
                    protocol: run.protocol.definition,
                    target,
                }),
            ),
        );
    } catch (error) {
        return retainFailure(
            run,
            evaluated,
            causes,
            {
                code: config.errors.verificationCode,
                reason: `evaluator failed for candidate ${plan.candidate_id}`,
            },
            error,
        );
    }
    const outcome = {
        ...evaluated,
        evaluation: verdict,
        status: verdict.passed ? EVALUATED : REJECTED,
    };
    append(run, run.head, `${OUTCOME_STEP}:${plan.candidate_id}`, outcome, causes);
    return outcome as unknown as CroCandidateBody;
}

/**
 * Opens or returns one candidate session and measures it against the provider-call budget.
 *
 * A session left non-terminal by a dead writer (no live lease) is returned with its interruption
 * instead of raising, so the caller can retain the candidate as rejected; a session still held
 * under a live lease raises.
 */
async function replayCandidate(
    run: Run,
    candidate: Candidate,
    commandId: string,
    source: ReplaySessionInspection,
    stepCount: number,
): Promise<{
    readonly interrupted: ReplaySessionInterruptedError | null;
    readonly session: ReplaySessionInspection;
}> {
    const { changes } = candidate.plan;
    if (run.store.readOwner(deriveReplaySessionId(commandId)).length === 0) {
        assertBudget(
            run,
            source.steps.filter((step) => step.index >= stepCount && step.kind === PROVIDER_STEP)
                .length,
        );
    }
    const workflow = resolveWorkflow(run, candidate);
    let inspection: ReplaySessionInspection;
    try {
        inspection = (
            await replayReplaySession(run.store, {
                changes,
                claimId: run.claimId,
                ...run.clock,
                commandId,
                // The replay substrate resolves an undeclared task through the source's branch
                // ancestry, so only a declared replacement task is passed.
                ...definedFields({
                    handlers: workflow.handlers,
                    provider: workflow.provider,
                    task: changes.includes(TASK_CHANGE) ? candidate.task : undefined,
                }),
                program: workflow.program,
                sourceSessionId: source.session_id,
                target: { stepCount },
            } as ReplayReplaySessionOptions)
        ).inspection;
    } catch (error) {
        if (
            !(error instanceof ReplaySessionInterruptedError) ||
            error.classification === RUNNING_CLASSIFICATION
        ) {
            throw error;
        }
        return Object.freeze({
            interrupted: error,
            session: inspectReplaySession(run.store, { sessionId: error.session_id, ...run.clock }),
        });
    }
    run.spent += measureReplaySessionCost(inspection).provider_calls;
    assertMeasuredBudget(run, inspection.session_id);
    return Object.freeze({ interrupted: null, session: inspection });
}

/**
 * Resolves the program, provider, and handler stack a candidate's sessions run with: the
 * candidate's own replacement, else that of the nearest ancestor in its parent chain that supplied
 * one, else the baseline's.
 */
function resolveWorkflow(
    run: Run,
    candidate: Candidate,
): Pick<Candidate, "handlers" | "program" | "provider"> {
    let { handlers, program, provider } = candidate;
    let parent = candidate.plan.parent_candidate_id;
    while (parent !== null) {
        const ancestor = run.candidates.get(parent) as Candidate;
        handlers ??= ancestor.handlers;
        program ??= ancestor.program;
        provider ??= ancestor.provider;
        parent = ancestor.plan.parent_candidate_id;
    }
    return {
        handlers: handlers ?? run.baseline.handlers,
        program: program ?? run.baseline.program,
        provider: provider ?? run.baseline.provider,
    };
}

/**
 * Retains the candidate as rejected with the evidence failure and raises when a candidate session
 * ended with any terminal status other than finished.
 */
function assertFinished(
    run: Run,
    settled: Readonly<Record<string, unknown>>,
    causes: readonly RecordId[],
    role: string,
    session: ReplaySessionInspection,
): void {
    const status = (session.terminal as ReplayTerminalInspection).status;
    if (status !== FINISHED_SESSION) {
        retainFailure(run, settled, causes, {
            code: config.errors.evidenceCode,
            reason: `candidate ${settled.candidate_id as string} ${role} session ${session.session_id} ended ${status} instead of finished`,
        });
    }
}

function retainInterruption(
    run: Run,
    settled: Readonly<Record<string, unknown>>,
    causes: readonly RecordId[],
    interrupted: ReplaySessionInterruptedError,
): never {
    return retainFailure(
        run,
        settled,
        causes,
        {
            code: config.errors.evidenceCode,
            reason: `candidate ${settled.candidate_id as string} session ${interrupted.session_id} was interrupted before its terminal record`,
        },
        interrupted,
    );
}

function retainFailure(
    run: Run,
    settled: Readonly<Record<string, unknown>>,
    causes: readonly RecordId[],
    failure: CounterfactualFailure,
    cause?: unknown,
): never {
    append(
        run,
        run.head,
        `${OUTCOME_STEP}:${settled.candidate_id as string}`,
        { ...settled, failure, status: REJECTED },
        causes,
    );
    throw failureError(failure, cause);
}

function failureError(
    failure: CounterfactualFailure,
    cause?: unknown,
): ApplicationEvidenceError | ApplicationVerificationError {
    return failure.code === config.errors.verificationCode
        ? new ApplicationVerificationError(failure.reason, { cause })
        : new ApplicationEvidenceError(failure.reason, { cause });
}

function promotedBody(body: CroCandidateBody): Readonly<Record<string, unknown>> {
    return { ...stripVersions(body), status: PROMOTED };
}

function append(
    run: Run,
    head: RecordId | null,
    step: string,
    fields: Readonly<Record<string, unknown>>,
    causes: readonly RecordId[],
): void {
    const body = createVersionedApplicationBody(stripVersions(fields));
    const appended = run.store.appendApplicationRecord(
        run.applicationId,
        head,
        createApplicationAppendRequest(
            createApplicationAppendIntentId(run.applicationId, step),
            run.applicationId,
            body,
            config.traceSchemas.croCandidate,
            [...new Set([...(head === null ? [] : [head]), ...causes])],
        ),
        null,
    );
    if (appended.status === "head_moved") {
        throw new ApplicationEvidenceError(`application ${run.applicationId} head moved`);
    }
    run.head = appended.receipt.record_ids[0] as RecordId;
}

function buildManifest(run: Run, baseline: ReplaySessionInspection, retained: RetainedRecords) {
    const roles = cro.artifactRoles;
    const artifacts: ApplicationArtifactSource[] = [sessionArtifact(roles.baseline, baseline)];
    let costs = measureReplaySessionCost(baseline);
    for (const plan of retained.opened.body.candidates) {
        const { outcome } = retained.candidates.get(plan.candidate_id) as {
            outcome: RetainedCandidate;
        };
        artifacts.push(recordArtifact(roles.candidate, outcome));
        for (const [role, sessionId] of [
            [roles.branch, outcome.body.branch_session_id],
            [roles.fullReplay, outcome.body.baseline?.session_id],
        ] as const) {
            if (sessionId !== undefined) {
                const session = inspectReplaySession(run.store, {
                    sessionId,
                    ...run.clock,
                });
                artifacts.push(sessionArtifact(role, session));
                costs = addApplicationCosts(costs, measureReplaySessionCost(session));
            }
        }
    }
    if (retained.promotion !== null) {
        artifacts.push(recordArtifact(roles.promotion, retained.promotion));
    }
    return createApplicationManifest({
        applicationId: run.applicationId,
        artifacts,
        costs,
        protocol: run.protocol.definition,
    });
}

function sessionArtifact(
    role: string,
    session: ReplaySessionInspection,
): ApplicationArtifactSource {
    const terminal = session.terminal as ReplayTerminalInspection;
    return {
        content: {
            prefix_id: terminal.prefix_id,
            session_id: session.session_id,
            status: terminal.status,
            step_count: terminal.step_count,
            terminal_record_id: terminal.record_id,
        },
        cut_id: null,
        record_id: terminal.record_id,
        role,
    };
}

function recordArtifact(role: string, entry: RetainedCandidate): ApplicationArtifactSource {
    return {
        content: entry.body as unknown as SemanticValue,
        cut_id: null,
        record_id: entry.record_id,
        role,
    };
}

function assertMeasuredBudget(run: Run, sessionId: string): void {
    const budget = run.protocol.providerCalls;
    if (run.spent > budget) {
        throw new ApplicationBudgetError(
            `${run.spent} measured live provider call(s) through session ${sessionId} exceed ${cro.budgetKeys.providerCalls} ${budget}`,
        );
    }
}

function assertBudget(run: Run, projected: number): void {
    const budget = run.protocol.providerCalls;
    if (run.spent + projected > budget) {
        throw new ApplicationBudgetError(
            `${projected} projected live provider call(s) after ${run.spent} exceed ${cro.budgetKeys.providerCalls} ${budget}`,
        );
    }
}

function readCroRecords(store: SQLiteTraceStore, applicationId: string): RetainedRecords {
    const records = store.readOwner(applicationId);
    const [first, ...rest] = records;
    assert(first !== undefined, `application ${applicationId} is not retained`);
    assertRecord(first, config.traceSchemas.croCandidate);
    const opened = readCroOpenedBody(first.body);
    assert(
        opened.application_id === applicationId &&
            deriveApplicationOwnerId(opened.command_id) === applicationId &&
            opened.baseline_session_id ===
                deriveReplaySessionId(commandOf(applicationId, BASELINE_STEP, {})) &&
            opened.candidates.every(
                ({ candidate_id, ...plan }) => candidate_id === candidateIdOf(applicationId, plan),
            ),
        "opened record names another application, baseline, or candidate identity",
    );
    const manifest = readRetainedManifest(store, applicationId);
    const candidates = new Map<
        string,
        { proposed?: RetainedCandidate; outcome?: RetainedCandidate }
    >();
    const plans = opened.candidates;
    let head = first.envelope.record_id;
    let next = 0;
    let promotion: RetainedCandidate | null = null;
    let stopped = false;
    let manifestSeen = false;
    let terminal = false;
    for (const record of rest) {
        const schemaRef = record.envelope.schema_ref;
        assert(!terminal, "application retains a record after its terminal cut");
        if (schemaRef === config.traceSchemas.croCandidate) {
            assertRecord(record, schemaRef);
            const body = readCroCandidateBody(record.body);
            const entry = Object.freeze({ body, record_id: record.envelope.record_id });
            const plan = plans[next];
            const state = candidates.get(body.candidate_id) ?? {};
            assert(
                !stopped &&
                    !manifestSeen &&
                    promotion === null &&
                    body.application_id === applicationId &&
                    record.envelope.caused_by_record_ids[0] === head,
                "candidate record is late or names another application",
            );
            if (body.status === PROMOTED) {
                const outcome = state.outcome;
                assert(
                    next === plans.length &&
                        outcome?.body.status === EVALUATED &&
                        canonical(promotedBody(outcome.body)) === canonical(stripVersions(body)),
                    "promotion does not repeat one evaluated candidate after every outcome",
                );
                promotion = entry;
            } else {
                const expected = state.proposed;
                assert(
                    plan !== undefined &&
                        body.candidate_id === plan.candidate_id &&
                        canonical(planOf(body)) === canonical(plan) &&
                        (body.status === PROPOSED) === (expected === undefined) &&
                        (expected === undefined ||
                            canonical(proposalOf(expected.body)) === canonical(proposalOf(body))) &&
                        body.branch_session_id ===
                            deriveReplaySessionId(
                                commandOf(applicationId, BRANCH_STEP, {
                                    candidate_id: body.candidate_id,
                                }),
                            ) &&
                        body.target.source_session_id ===
                            (body.parent_candidate_id === null
                                ? opened.baseline_session_id
                                : candidates.get(body.parent_candidate_id)?.outcome?.body
                                      .branch_session_id) &&
                        (body.baseline === null ||
                            body.baseline.session_id ===
                                deriveReplaySessionId(
                                    commandOf(applicationId, FULL_REPLAY, {
                                        candidate_id: body.candidate_id,
                                    }),
                                )) &&
                        (body.status === PROPOSED ||
                            (body.baseline !== null) ===
                                (opened.baselines.includes(FULL_REPLAY) &&
                                    body.failure?.code !== config.errors.evidenceCode)),
                    "candidate record is out of order or disagrees with its plan, proposal, or lineage",
                );
                if (body.status === PROPOSED) {
                    state.proposed = entry;
                } else {
                    state.outcome = entry;
                    next += 1;
                    stopped = body.failure !== null;
                }
                candidates.set(body.candidate_id, state);
            }
        } else if (schemaRef === config.traceSchemas.manifest) {
            assertRecord(record, schemaRef);
            assert(
                !stopped &&
                    next === plans.length &&
                    manifest !== null &&
                    manifest.record_id === record.envelope.record_id &&
                    manifest.manifest.protocol_id === opened.protocol_id &&
                    manifest.manifest.kind === CRO_KIND &&
                    record.envelope.caused_by_record_ids[0] === head,
                "manifest record does not follow every candidate outcome",
            );
            manifestSeen = true;
        } else {
            assertRecord(record, kernelProtocolConfig.queries.cutSchemaRef);
            assert(
                manifestSeen &&
                    record.body.cut_id === (manifest as { readonly cut_id: string }).cut_id,
                "application retains an unsupported record",
            );
            terminal = true;
        }
        head = record.envelope.record_id;
    }
    return Object.freeze({
        candidates,
        head,
        manifest,
        opened: Object.freeze({ body: opened, record_id: first.envelope.record_id }),
        promotion,
    });
}

function planOf(body: CroCandidateBody): CounterfactualCandidatePlan {
    return {
        candidate_id: body.candidate_id,
        changes: body.changes,
        edited_step_index: body.edited_step_index,
        name: body.name,
        parent_candidate_id: body.parent_candidate_id,
    };
}

function proposalOf(body: CroCandidateBody): SemanticValue {
    return {
        affected_steps: body.affected_steps,
        branch_session_id: body.branch_session_id,
        target: body.target,
    };
}

function toRecord(
    entry: RetainedCandidate | null | undefined,
): CounterfactualCandidateRecord | null {
    if (!entry) {
        return null;
    }
    const {
        application_id: _application,
        phase: _phase,
        ...record
    } = stripVersions(entry.body) as CroCandidateBody;
    return Object.freeze({ ...record, record_id: entry.record_id });
}

function stripVersions(fields: object): Readonly<Record<string, unknown>> {
    const {
        application_version: _version,
        compatibility_version: _compatibility,
        ...rest
    } = fields as Record<string, unknown>;
    return rest;
}

function readCroProtocol(value: unknown): CroProtocol {
    const definition = readApplicationProtocol(value);
    if (definition.kind !== CRO_KIND) {
        throw new ApplicationProtocolError(`kind must be ${CRO_KIND}`);
    }
    const roles = cro.surfaceRoles;
    for (const [kind, role] of [
        [PROMPT_KIND, roles.proposer],
        [TOOL_KIND, roles.proposer],
        [SCHEMA_KIND, roles.reflection],
        [SCHEMA_KIND, roles.handoff],
    ]) {
        if (
            !definition.surfaces.some((surface) => surface.kind === kind && surface.role === role)
        ) {
            throw new ApplicationProtocolError(`a ${kind} surface with role ${role} is required`);
        }
    }
    const keys = cro.budgetKeys;
    const [candidates, minPromotionScore, providerCalls] = [
        keys.candidates,
        keys.minPromotionScore,
        keys.providerCalls,
    ].map((key) => definition.budgets[key]);
    if (
        candidates === undefined ||
        minPromotionScore === undefined ||
        providerCalls === undefined
    ) {
        throw new ApplicationProtocolError(
            `budgets must declare ${keys.candidates}, ${keys.minPromotionScore}, and ${keys.providerCalls}`,
        );
    }
    if (candidates === 0 || candidates > config.limits.maxCandidates) {
        throw new ApplicationProtocolError(
            `${keys.candidates} must be positive and within the configured bound ${config.limits.maxCandidates}`,
        );
    }
    return { candidates, definition, minPromotionScore, providerCalls };
}

function readWorkflow(value: unknown): CounterfactualWorkflowDefinition {
    const fields = readScopeDataObject(value, ["program", "programId"], "baseline", [
        "handlers",
        "provider",
        "task",
    ]);
    readFunction(fields.program, "baseline.program");
    assertScopeText(fields.programId, "baseline.programId");
    return fields as unknown as CounterfactualWorkflowDefinition;
}

function readBaselines(value: unknown): readonly CounterfactualBaselineKind[] {
    const baselines = readScopeArray(value, "baselines");
    const known = APPLICATION_CRO_BASELINE_KINDS.filter((kind) => baselines.includes(kind));
    if (known.length !== baselines.length) {
        throw new TypeError("baselines must be distinct configured baseline kinds");
    }
    return Object.freeze(known);
}

function readCandidates(
    value: unknown,
    protocol: CroProtocol,
    applicationId: string,
): readonly Candidate[] {
    const entries = readScopeArray(value, "candidates");
    if (entries.length === 0) {
        throw new TypeError("candidates must be non-empty");
    }
    if (entries.length > protocol.candidates) {
        throw new ApplicationBudgetError(
            `${entries.length} candidates exceed ${cro.budgetKeys.candidates} ${protocol.candidates}`,
        );
    }
    const identities = new Map<string, string>();
    return Object.freeze(
        entries.map((entry, index): Candidate => {
            const subject = `candidates[${index}]`;
            const fields = readScopeDataObject(entry, ["changes", "name", "stepIndex"], subject, [
                "handlers",
                "parent",
                "program",
                "provider",
                "task",
            ]);
            for (const kind of readScopeArray(fields.changes, `${subject}.changes`)) {
                if (!REPLAY_CHANGE_DIMENSIONS.includes(kind as never)) {
                    throw new ApplicationProtocolError(
                        `${subject} declares unsupported edit kind ${String(kind)}`,
                    );
                }
            }
            const changes = readCroChanges(fields.changes, `${subject}.changes`);
            for (const dimension of REPLAY_CHANGE_DIMENSIONS) {
                if ((fields[dimension] !== undefined) !== changes.includes(dimension)) {
                    throw new TypeError(
                        `${subject}.${dimension} must be supplied exactly with the ${dimension} change`,
                    );
                }
            }
            assertScopeText(fields.name, `${subject}.name`);
            const parent = fields.parent === undefined ? null : fields.parent;
            if (
                identities.has(fields.name) ||
                (parent !== null && !identities.has(parent as string))
            ) {
                throw new TypeError(
                    `${subject} must have a unique name and name an earlier candidate as parent`,
                );
            }
            if (fields.program !== undefined) {
                readFunction(fields.program, `${subject}.program`);
            }
            const plan = {
                changes,
                edited_step_index: readCount(fields.stepIndex, `${subject}.stepIndex`),
                name: fields.name,
                parent_candidate_id:
                    parent === null ? null : (identities.get(parent as string) as string),
            };
            const candidateId = candidateIdOf(applicationId, plan);
            identities.set(fields.name, candidateId);
            return Object.freeze({
                handlers: fields.handlers,
                plan: Object.freeze({ candidate_id: candidateId, ...plan }),
                program: fields.program,
                provider: fields.provider,
                task: fields.task,
            });
        }),
    );
}

function candidateIdOf(
    applicationId: string,
    plan: Omit<CounterfactualCandidatePlan, "candidate_id">,
): string {
    return prefixedApplicationId(config.identity.candidateIdPrefix, {
        application_id: applicationId,
        changes: plan.changes,
        edited_step_index: plan.edited_step_index,
        name: plan.name,
        parent_candidate_id: plan.parent_candidate_id,
    });
}

function commandOf(
    applicationId: string,
    step: string,
    fields: Readonly<Record<string, string>>,
): string {
    return createApplicationCommandId(applicationId, step, fields);
}

function definedFields(fields: Readonly<Record<string, unknown>>): Record<string, unknown> {
    return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
}

function readFunction(value: unknown, subject: string): (...args: never[]) => unknown {
    if (typeof value !== "function") {
        throw new TypeError(`${subject} must be a function`);
    }
    return value as (...args: never[]) => unknown;
}

function assertRecord(record: OwnerRecord, schema: string): void {
    assert(
        record.envelope.schema_ref === schema &&
            record.envelope.mode === CAPTURE_MODE &&
            record.envelope.witness_ref === ROOT_WITNESS_ID,
        `record ${record.envelope.record_id} has an unexpected schema, mode, or witness`,
    );
}

function assert(condition: boolean, message: string): asserts condition {
    if (!condition) {
        throw new ApplicationEvidenceError(message);
    }
}
