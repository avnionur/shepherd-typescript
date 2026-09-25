import type { SemanticValue } from "../canonical/canonical-record.ts";
import { applicationsProtocolConfig, kernelProtocolConfig } from "../protocol/config.ts";
import { deepFreeze } from "../protocol/config-value-readers.ts";
import {
    APPLICATION_CRO_BASELINE_KINDS,
    APPLICATION_CRO_CANDIDATE_STATUSES,
    APPLICATION_CRO_EDIT_SCOPES,
    APPLICATION_CRO_EXAMPLE_ROLES,
    APPLICATION_CRO_PHASES,
    APPLICATION_CRO_SPLITS,
    APPLICATION_KINDS,
    APPLICATION_PROTOCOL_SURFACES,
    RECORD_MODES,
    REPLAY_CHANGE_DIMENSIONS,
    REPLAY_RECOVERY_CLASSIFICATIONS,
    REPLAY_SOURCE_DISPOSITIONS,
    REPLAY_STEP_KINDS,
    REPLAY_STEP_SOURCES,
    REPLAY_TERMINAL_STATUSES,
} from "../protocol/values.generated.ts";
import { ROOT_WITNESS_ID } from "../record/root-witness.ts";
import type { RecordId } from "../record/types.ts";
import {
    analyzeReplayDependencies,
    analyzeReplayDivergence,
    replayChangesExplainStepKind,
} from "../replay/analysis.ts";
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
    type CroLedgerRow,
    type CroThresholds,
    checkCroReflectionContract,
    croPromotes,
    evaluateCroGate,
    mean,
    readCroThresholds,
} from "./counterfactual-gate.ts";
import {
    type CroCandidateBody,
    type CroOpenedBody,
    type CroProposalBody,
    type CroSelectionBody,
    readCroCandidateBody,
    readCroEdit,
    readCroOpenedBody,
    readCroPhase,
    readCroProposalBody,
    readCroSelectionBody,
} from "./counterfactual-records.ts";
import type {
    CounterfactualBaselineExample,
    CounterfactualBaselineKind,
    CounterfactualCandidatePlan,
    CounterfactualCandidateRecord,
    CounterfactualComputationReuse,
    CounterfactualEdit,
    CounterfactualEditApplication,
    CounterfactualEditApplier,
    CounterfactualExample,
    CounterfactualExampleResult,
    CounterfactualExampleRole,
    CounterfactualFailure,
    CounterfactualHandoff,
    CounterfactualMetric,
    CounterfactualOptimizationInspection,
    CounterfactualOptimizationReceipt,
    CounterfactualPoolMember,
    CounterfactualProposalRecord,
    CounterfactualProposer,
    CounterfactualSelection,
    CounterfactualSplit,
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
    type ApplicationSchemaSurface,
    assertApplicationMessage,
    compileApplicationSchemaSurfaces,
} from "./protocol-schemas.ts";
import {
    addApplicationCosts,
    applicationDigest,
    assertApplicationDigest,
    canonical,
    createApplicationAppendIntentId,
    createApplicationAppendRequest,
    createApplicationCommandId,
    createVersionedApplicationBody,
    measureReplaySessionCost,
    prefixedApplicationId,
    ZERO_APPLICATION_COST,
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
const [OPENED_PHASE, PROPOSAL_PHASE, CANDIDATE_PHASE, SELECTION_PHASE] = APPLICATION_CRO_PHASES;
const [ARCHIVED, EVALUATED, PROMOTED, REJECTED] = APPLICATION_CRO_CANDIDATE_STATUSES;
const [FULL_REPLAY] = APPLICATION_CRO_BASELINE_KINDS;
const [REQUEST_SCOPE] = APPLICATION_CRO_EDIT_SCOPES;
const [TRAIN_SPLIT, DEV_SPLIT] = APPLICATION_CRO_SPLITS;
const [FIX_ROLE, GUARD_ROLE, DEV_ROLE, TRAIN_ROLE] = APPLICATION_CRO_EXAMPLE_ROLES;
const [PROVIDER_STEP] = REPLAY_STEP_KINDS;
const [, RETAIN_SOURCE] = REPLAY_SOURCE_DISPOSITIONS;
const [LIVE_SOURCE] = REPLAY_STEP_SOURCES;
const [TASK_CHANGE] = REPLAY_CHANGE_DIMENSIONS;
const [, RUNNING_CLASSIFICATION] = REPLAY_RECOVERY_CLASSIFICATIONS;
const [FINISHED_SESSION] = REPLAY_TERMINAL_STATUSES;
const BASELINE_STEP = "baseline";
const BRANCH_STEP = "branch";
const OUTCOME_STEP = "outcome";
const PROPOSER_STEP = "proposer";
const SELECTION_STEP = "selection";

type CroBudgets = {
    readonly candidates: number;
    readonly iterations: number;
    readonly proposalAttempts: number;
    readonly proposals: number;
    readonly providerCalls: number;
    readonly reflectionMechanisms: number;
};

type CroProtocol = {
    readonly budgets: CroBudgets;
    readonly declaredThresholds: Readonly<Record<string, number>>;
    readonly definition: ApplicationProtocolDefinition;
    readonly handoff: readonly ApplicationSchemaSurface[];
    readonly reflection: readonly ApplicationSchemaSurface[];
    readonly thresholds: CroThresholds;
};

type ExampleEntry = {
    readonly example: CounterfactualExample;
    readonly split: CounterfactualSplit;
};

type Candidate = {
    readonly application: CounterfactualEditApplication;
    readonly plan: CounterfactualCandidatePlan;
};

type Retained<T> = { readonly body: T; readonly record_id: RecordId };

type RetainedRecords = {
    readonly head: RecordId;
    readonly manifest: ReturnType<typeof readRetainedManifest>;
    readonly opened: Retained<CroOpenedBody>;
    readonly outcomes: ReadonlyMap<string, Retained<CroCandidateBody>>;
    readonly proposals: readonly Retained<CroProposalBody>[];
    readonly selection: Retained<CroSelectionBody> | null;
};

type Run = {
    readonly applicationId: string;
    readonly applyEdit: CounterfactualEditApplier;
    readonly baseline: CounterfactualWorkflowDefinition;
    readonly baselines: readonly CounterfactualBaselineKind[];
    readonly candidates: Map<string, Candidate>;
    readonly claimId: string;
    readonly clock: { readonly clock?: () => number };
    readonly examples: ReadonlyMap<string, ExampleEntry>;
    head: RecordId;
    readonly metric: CounterfactualMetric;
    readonly outcomes: Map<string, CroCandidateBody>;
    readonly protocol: CroProtocol;
    scores: ReadonlyMap<string, CounterfactualBaselineExample>;
    spent: number;
    readonly store: SQLiteTraceStore;
};

type Progress = {
    causes: RecordId[];
    /** Measured cost of the incomplete example's branch session, retained with a failure. */
    pending: ApplicationCostSummary;
    dev: CounterfactualExampleResult[] | null;
    dev_score: number | null;
    gate: ReturnType<typeof evaluateCroGate> | null;
    promotion_reference: number | null;
    readonly targeted: CounterfactualExampleResult[];
    train: CounterfactualExampleResult[] | null;
};

/**
 * Runs Counterfactual Replay Optimization (paper §5.2, Appendix F.1 Algorithm 1) over replay
 * sessions.
 *
 * 1. The baseline workflow W0 is recorded once per train and dev example through
 *    `runReplaySession` and scored by the metric; every baseline session must finish.
 * 2. The parent pool starts as the baseline. For N iterations (the `iterations` budget) the
 *    proposer reads the run and returns a pool parent and at most k edits (the
 *    `proposalsPerIteration` budget, capped by the remaining `maxCandidates`), each with a fix set
 *    and a guard set of train examples. Before any evaluation the proposal is validated: shape,
 *    pool membership, unique names, train-only disjoint example sets, admissible edited steps on
 *    every parent example session, the caller's edit application, the reflection against every
 *    pinned `reflection` schema surface, and the reflection contract. A refused proposal is
 *    retried with the refusal reasons up to `maxProposalAttempts`; exhaustion is retained and
 *    raised as a verification failure.
 * 3. Each edit c = p ⊕ Δ is replayed counterfactually on every fix and guard example: the parent's
 *    session on the example is forked at the first affected event (the edit scope's target rule),
 *    the suffix runs under the candidate, `analyzeReplayDivergence` must prove no earlier or
 *    unexplained divergence, and the metric scores the branch. The targeted gate applies the
 *    protocol thresholds; a failing candidate is `archived`.
 * 4. A graduate is replayed counterfactually on every dev example. It is `promoted` into the
 *    parent pool when its mean dev score reaches `minPromotionScore` and lies within
 *    `promoteDevEpsilon` of the current promoted member's dev score, and is then replayed on the
 *    remaining train examples so children can fork it; otherwise it is `evaluated` and never a
 *    parent.
 * 5. After the iterations the pool member with the highest dev score is selected, the most recently
 *    promoted member winning ties; the baseline is selected as null.
 *
 * Every proposal, candidate outcome, and the selection are retained as
 * `shepherd.application.cro_candidate.v1` records, and the manifest last with the per-proposer-
 * session computation-reuse ratio. A branch or comparison session that did not finish, a disproven
 * or interrupted branch, or a failing metric retains the candidate as `rejected` and stops the run.
 * Every session's projected and measured live provider calls, the baselines' and proposer
 * sessions' included, are checked against `maxProviderCalls`. Repeating the command resumes from
 * retained evidence and never re-executes a terminal session.
 *
 * @param store - Open writable trace store.
 * @param options - Command, claim, protocol, baseline workflow, dataset, proposer, edit applier,
 * metric, and optional comparison baselines and clock.
 * @returns The retained manifest, the record-derived inspection, and the handoff manifest.
 * @throws {ApplicationProtocolError} If the protocol is malformed, is not a counterfactual
 * optimization protocol, lacks a required surface, budget, or threshold, the handoff schema refuses
 * the handoff, or the run was opened under another protocol.
 * @throws {ApplicationBudgetError} If a session's projected or measured calls exceed the budget.
 * @throws {ApplicationEvidenceError} If a baseline session did not finish (before any application
 * record), a branch failed its proof or did not finish, the run was opened with a different
 * dataset or baselines, or retained evidence is inconsistent.
 * @throws {ApplicationVerificationError} If a metric throws or returns a non-finite score, or every
 * proposer attempt of an iteration was refused.
 * @throws {ReplayLeaseConflictError} If a session is held by another writer.
 * @throws {ReplaySessionInterruptedError} If a baseline session was left non-terminal by a dead
 * writer, or a candidate session is still `running` under a live lease.
 * @throws {TraceStoreError} If the store is closed.
 * @throws {TypeError} If options or the dataset are malformed.
 *
 * @example
 * ```ts
 * const { inspection } = await runCounterfactualOptimization(store, {
 *     applyEdit: ({ edit }) => ({ provider: variants[edit.patch as string] }),
 *     baseline: { program: () => program, programId: "workflow.v1", provider },
 *     claimId: "optimizer",
 *     commandId: "application:cro:1",
 *     dataset: { dev: [{ id: "d1", input: {} }], train: [{ id: "t1", input: {} }] },
 *     metric: ({ session }) => (session.terminal?.status === "finished" ? 1 : 0),
 *     proposer: createToolLoopCounterfactualProposer({ model }),
 *     protocol,
 * });
 * console.log(inspection.selection?.selected_candidate_id);
 * ```
 */
export async function runCounterfactualOptimization(
    store: SQLiteTraceStore,
    options: RunCounterfactualOptimizationOptions,
): Promise<CounterfactualOptimizationReceipt> {
    const fields = readScopeDataObject(
        options,
        [
            "applyEdit",
            "baseline",
            "claimId",
            "commandId",
            "dataset",
            "metric",
            "protocol",
            "proposer",
        ],
        "runCounterfactualOptimization options",
        ["baselines", "clock"],
    );
    assertScopeText(fields.commandId, "commandId");
    assertScopeText(fields.claimId, "claimId");
    const protocol = readCroProtocol(fields.protocol);
    const protocolId = applicationProtocolId(protocol.definition);
    const baseline = readWorkflow(fields.baseline);
    const baselines = readBaselines(fields.baselines ?? []);
    const proposer = readFunction(fields.proposer, "proposer") as CounterfactualProposer;
    const applyEdit = readFunction(fields.applyEdit, "applyEdit") as CounterfactualEditApplier;
    const metric = readFunction(fields.metric, "metric") as CounterfactualMetric;
    const clock =
        fields.clock === undefined
            ? {}
            : { clock: readFunction(fields.clock, "clock") as () => number };
    const examples = readDataset(fields.dataset, protocol.definition);
    const applicationId = deriveApplicationOwnerId(fields.commandId);
    const digests = [...examples.values()].map(({ example, split }) => ({
        example_id: example.id,
        input_digest: applicationDigest(example.input),
        split,
    }));
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
                canonical(
                    opened.examples.map(({ example_id, input_digest, split }) => ({
                        example_id,
                        input_digest,
                        split,
                    })),
                ) === canonical(digests),
            `application ${applicationId} was opened with a different dataset or baselines`,
        );
        if (retained.manifest !== null) {
            const inspection = inspectCounterfactualOptimization(store, applicationId);
            return Object.freeze({
                handoff: readHandoff(protocol, inspection),
                inspection,
                manifest: retained.manifest.manifest,
            });
        }
    }
    const run: Run = {
        applicationId,
        applyEdit,
        baseline,
        baselines,
        candidates: new Map(),
        claimId: fields.claimId,
        clock,
        examples,
        head: "" as RecordId,
        metric,
        outcomes: new Map(),
        protocol,
        scores: new Map(),
        spent: 0,
        store,
    };
    const recorded: CounterfactualBaselineExample[] = [];
    const heads: RecordId[] = [];
    for (const { example, split } of examples.values()) {
        const session = (
            await runReplaySession(store, {
                claimId: run.claimId,
                ...clock,
                commandId: commandOf(applicationId, BASELINE_STEP, { example_id: example.id }),
                ...definedFields({
                    handlers: baseline.handlers,
                    provider: baseline.provider,
                    task: baseline.task?.(example),
                }),
                program: baseline.program(example),
                programId: baseline.programId,
            })
        ).inspection;
        const terminal = session.terminal as ReplayTerminalInspection;
        if (terminal.status !== FINISHED_SESSION) {
            throw new ApplicationEvidenceError(
                `baseline session ${session.session_id} of example ${example.id} did not finish and cannot be optimized`,
            );
        }
        run.spent += measureReplaySessionCost(session).provider_calls;
        assertMeasuredBudget(run, session.session_id);
        heads.push(terminal.record_id);
        const retainedExample = retained?.opened.body.examples.find(
            (entry) => entry.example_id === example.id,
        );
        let score = retainedExample?.score;
        if (score === undefined) {
            try {
                score = readScore(await metric({ candidate: null, example, session, split }));
            } catch (error) {
                throw new ApplicationVerificationError(
                    `metric failed for the baseline session of example ${example.id}`,
                    { cause: error },
                );
            }
        }
        recorded.push(
            Object.freeze({
                example_id: example.id,
                input_digest: applicationDigest(example.input),
                score,
                session_id: session.session_id,
                split,
            }),
        );
    }
    if (retained === null) {
        append(
            run,
            null,
            OPENED_PHASE,
            {
                application_id: applicationId,
                baselines,
                budgets: protocol.definition.budgets,
                command_id: fields.commandId,
                examples: recorded,
                kind: CRO_KIND,
                phase: OPENED_PHASE,
                protocol_id: protocolId,
                thresholds: protocol.declaredThresholds,
            },
            heads,
        );
        retained = readCroRecords(store, applicationId);
    }
    run.head = retained.head;
    run.scores = new Map(
        retained.opened.body.examples.map((example) => [example.example_id, example]),
    );
    const pool: CounterfactualPoolMember[] = [
        Object.freeze({ candidate_id: null, dev_score: baselineDevScore(run), name: null }),
    ];
    let used = 0;
    for (let iteration = 0; iteration < protocol.budgets.iterations; iteration += 1) {
        const capacity = Math.min(protocol.budgets.proposals, protocol.budgets.candidates - used);
        if (capacity === 0) {
            break;
        }
        const proposal =
            retained.proposals[iteration]?.body ??
            (await propose(run, proposer, iteration, capacity, pool));
        for (const sessionId of proposal.proposer_session_ids) {
            run.spent += measureReplaySessionCost(
                inspectReplaySession(store, { sessionId, ...clock }),
            ).provider_calls;
            assertMeasuredBudget(run, sessionId);
        }
        if (proposal.failure !== null) {
            throw failureError(proposal.failure);
        }
        for (const plan of proposal.candidates) {
            const candidate = await materialize(run, plan);
            if (candidate === null) {
                throw new ApplicationEvidenceError(
                    `retained candidate ${plan.name} no longer applies to its parent`,
                );
            }
            run.candidates.set(plan.candidate_id, candidate);
            const retainedOutcome = retained.outcomes.get(plan.candidate_id)?.body;
            let outcome: CroCandidateBody;
            if (retainedOutcome === undefined) {
                outcome = await evaluateCandidate(run, candidate, pool.at(-1)?.dev_score as number);
            } else {
                if (retainedOutcome.failure !== null) {
                    throw failureError(retainedOutcome.failure);
                }
                run.spent += retainedOutcome.cost.provider_calls + comparisonCalls(retainedOutcome);
                outcome = retainedOutcome;
            }
            run.outcomes.set(plan.candidate_id, outcome);
            if (outcome.status === PROMOTED) {
                pool.push(
                    Object.freeze({
                        candidate_id: plan.candidate_id,
                        dev_score: outcome.dev_score as number,
                        name: plan.name,
                    }),
                );
            }
            used += 1;
        }
    }
    if (readCroRecords(store, applicationId).selection === null) {
        append(run, run.head, SELECTION_STEP, selectionBody(applicationId, pool), []);
    }
    const inspection = inspectCounterfactualOptimization(store, applicationId);
    const handoff = readHandoff(protocol, inspection);
    const receipt = retainApplicationManifest(store, {
        manifest: buildManifest(run, inspection, readCroRecords(store, applicationId)),
    });
    return Object.freeze({
        handoff,
        inspection: inspectCounterfactualOptimization(store, applicationId),
        manifest: receipt.manifest,
    });
}

/**
 * Reads one counterfactual optimization run as an immutable record-derived view without mutation.
 *
 * Every record on the application owner path is validated: the opened record with its derived
 * baseline session identities; each proposal in iteration order with derived candidate and
 * proposer-session identities, a parent from the pool at that point, and a candidate count within
 * the iteration's capacity; each candidate outcome in proposal order with derived branch and
 * comparison session identities, targets forking the parent's session on each example, parent
 * scores, the gate verdict and the promotion decision recomputed from the retained results and
 * thresholds, and summed cost; the selection recomputed from the pool; the manifest; and the
 * terminal cut. Inspection works on reopened, read-only, and imported stores and never embeds
 * live-session state, so it is identical across them.
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
 * console.log(inspection.selection?.selected_candidate_id ?? "baseline");
 * ```
 */
export function inspectCounterfactualOptimization(
    store: SQLiteTraceStore,
    applicationId: string,
): CounterfactualOptimizationInspection {
    assertApplicationDigest(applicationId, config.identity.applicationIdPrefix, "applicationId");
    const retained = readCroRecords(store, applicationId);
    const opened = retained.opened.body;
    const proposals = retained.proposals.map(
        ({ body, record_id }): CounterfactualProposalRecord =>
            Object.freeze({
                attempts: body.attempts,
                candidates: body.candidates,
                failure: body.failure,
                iteration: body.iteration,
                parent_candidate_id: body.parent_candidate_id,
                proposer_session_ids: body.proposer_session_ids,
                record_id,
                reflection: body.reflection,
                refusals: body.refusals,
            }),
    );
    const candidates = proposals.flatMap((proposal) =>
        proposal.candidates
            .map((plan) => retained.outcomes.get(plan.candidate_id))
            .filter((entry): entry is Retained<CroCandidateBody> => entry !== undefined)
            .map(toCandidateRecord),
    );
    const devScore = mean(
        opened.examples
            .filter((example) => example.split === DEV_SPLIT)
            .map((example) => example.score),
    );
    const selection = retained.selection;
    return Object.freeze({
        application_id: applicationId,
        baselines: opened.baselines,
        budgets: opened.budgets,
        candidates: Object.freeze(candidates),
        command_id: opened.command_id,
        computation_reuse: Object.freeze(
            proposals.map((proposal) => computationReuse(proposal.iteration, candidates)),
        ),
        cut_id: retained.manifest === null ? null : retained.manifest.cut_id,
        examples: opened.examples,
        kind: opened.kind,
        manifest: retained.manifest === null ? null : retained.manifest.manifest,
        manifest_record_id: retained.manifest === null ? null : retained.manifest.record_id,
        opened_record_id: retained.opened.record_id,
        pool: Object.freeze([
            Object.freeze({ candidate_id: null, dev_score: devScore, name: null }),
            ...candidates
                .filter((candidate) => candidate.status === PROMOTED)
                .map((candidate) =>
                    Object.freeze({
                        candidate_id: candidate.candidate_id,
                        dev_score: candidate.dev_score as number,
                        name: candidate.name,
                    }),
                ),
        ]),
        proposals: Object.freeze(proposals),
        protocol_id: opened.protocol_id,
        selection:
            selection === null
                ? null
                : Object.freeze({
                      dev_score: selection.body.dev_score,
                      pool: selection.body.pool,
                      record_id: selection.record_id,
                      selected_candidate_id: selection.body.selected_candidate_id,
                  } satisfies CounterfactualSelection),
        thresholds: opened.thresholds,
    });
}

async function propose(
    run: Run,
    proposer: CounterfactualProposer,
    iteration: number,
    capacity: number,
    pool: readonly CounterfactualPoolMember[],
): Promise<CroProposalBody> {
    const feedback: string[] = [];
    const sessions: string[] = [];
    for (let attempt = 0; attempt < run.protocol.budgets.proposalAttempts; attempt += 1) {
        const commandId = commandOf(run.applicationId, PROPOSER_STEP, {
            attempt: String(attempt),
            iteration: String(iteration),
        });
        let answer: unknown;
        try {
            answer = await proposer(
                Object.freeze({
                    applicationId: run.applicationId,
                    attempt,
                    capacity,
                    claimId: run.claimId,
                    ...run.clock,
                    commandId,
                    feedback: Object.freeze([...feedback]),
                    inspection: inspectCounterfactualOptimization(run.store, run.applicationId),
                    iteration,
                    pool: Object.freeze([...pool]),
                    protocol: run.protocol.definition,
                    store: run.store,
                }),
            );
        } catch (error) {
            if (!(error instanceof ApplicationVerificationError)) {
                throw error;
            }
            answer = error;
        }
        const sessionId = deriveReplaySessionId(commandId);
        if (run.store.readOwner(sessionId).length > 0) {
            sessions.push(sessionId);
        }
        const admitted =
            answer instanceof ApplicationVerificationError
                ? `proposer refused: ${answer.message}`
                : await admitProposal(run, answer, iteration, capacity, pool);
        if (typeof admitted !== "string") {
            const body = {
                application_id: run.applicationId,
                attempts: attempt + 1,
                candidates: admitted.plans,
                failure: null,
                iteration,
                parent_candidate_id: admitted.parent,
                phase: PROPOSAL_PHASE,
                proposer_session_ids: sessions,
                reflection: admitted.reflection,
                refusals: feedback,
            };
            append(run, run.head, `${PROPOSAL_PHASE}:${iteration}`, body, []);
            return readCroProposalBody(createVersionedApplicationBody(body));
        }
        feedback.push(bound(`attempt ${attempt}: ${admitted}`));
    }
    const failure = {
        code: config.errors.verificationCode,
        reason: `every proposer attempt of iteration ${iteration} was refused`,
    };
    const body = {
        application_id: run.applicationId,
        attempts: run.protocol.budgets.proposalAttempts,
        candidates: [],
        failure,
        iteration,
        parent_candidate_id: null,
        phase: PROPOSAL_PHASE,
        proposer_session_ids: sessions,
        reflection: null,
        refusals: feedback,
    };
    append(run, run.head, `${PROPOSAL_PHASE}:${iteration}`, body, []);
    return readCroProposalBody(createVersionedApplicationBody(body));
}

/**
 * Validates one proposer answer against the run; returns the admitted plans or the refusal
 * reasons joined into one text.
 */
async function admitProposal(
    run: Run,
    answer: unknown,
    iteration: number,
    capacity: number,
    pool: readonly CounterfactualPoolMember[],
): Promise<
    | {
          readonly parent: string | null;
          readonly plans: readonly CounterfactualCandidatePlan[];
          readonly reflection: SemanticValue;
      }
    | string
> {
    let edits: readonly CounterfactualEdit[];
    let parentName: unknown;
    let reflection: SemanticValue;
    try {
        const fields = readScopeDataObject(answer, ["edits", "parent", "reflection"], "proposal");
        edits = readScopeArray(fields.edits, "proposal.edits").map((edit, index) =>
            readCroEdit(edit, `proposal.edits[${index}]`),
        );
        parentName = fields.parent;
        reflection = JSON.parse(canonical(fields.reflection)) as SemanticValue;
    } catch (error) {
        return `malformed proposal: ${messageOf(error)}`;
    }
    const reasons: string[] = [];
    const parent = pool.find((member) => member.name === parentName);
    if (parent === undefined) {
        reasons.push(`parent ${String(parentName)} is not in the parent pool`);
    }
    if (edits.length === 0 || edits.length > capacity) {
        reasons.push(`a proposal carries between 1 and ${capacity} edits, not ${edits.length}`);
    }
    const taken = new Set([...run.outcomes.values()].map((outcome) => outcome.name));
    for (const edit of edits) {
        if (taken.has(edit.name)) {
            reasons.push(`candidate name ${edit.name} is not unique in the run`);
        }
        taken.add(edit.name);
        for (const id of [...edit.fix_set, ...edit.guard_set]) {
            if (run.examples.get(id)?.split !== TRAIN_SPLIT) {
                reasons.push(`edit ${edit.name} names ${id}, which is not a train example`);
            }
        }
    }
    const reflectionParent = (reflection as Readonly<Record<string, unknown>> | null)?.[
        cro.reflection.fields.parent
    ];
    if (reflectionParent !== undefined && reflectionParent !== parentName) {
        reasons.push(`reflection ${cro.reflection.fields.parent} disagrees with the proposal`);
    }
    try {
        assertApplicationMessage(run.protocol.reflection, reflection, "reflection");
        reasons.push(
            ...checkCroReflectionContract(
                reflection,
                edits,
                [...run.outcomes.values()].map(
                    (outcome): CroLedgerRow => ({
                        mechanism: outcome.mechanism,
                        name: outcome.name,
                        promoted: outcome.status === PROMOTED,
                    }),
                ),
                run.protocol.thresholds,
                run.protocol.budgets.reflectionMechanisms,
            ),
        );
    } catch (error) {
        reasons.push(`reflection is not admitted by the reflection schema: ${messageOf(error)}`);
    }
    if (reasons.length > 0 || parent === undefined) {
        return reasons.join("; ");
    }
    const parentId = parent.candidate_id;
    const plans = edits.map((edit) => {
        const plan = {
            changes: edit.changes,
            edit_scope: edit.scope,
            edited_step_index: edit.step_index,
            fix_set: edit.fix_set,
            guard_set: edit.guard_set,
            iteration,
            mechanism: edit.mechanism,
            name: edit.name,
            parent_candidate_id: parentId,
            patch: edit.patch,
            prior: edit.prior,
            rationale: edit.rationale,
        };
        return Object.freeze({ candidate_id: candidateIdOf(run.applicationId, plan), ...plan });
    });
    for (const plan of plans) {
        const inadmissible = [...run.examples.keys()].find((exampleId) => {
            const source = inspectReplaySession(run.store, {
                sessionId: sourceSessionOf(run, parentId, exampleId),
                ...run.clock,
            });
            return !admitsStep(plan, source);
        });
        if (inadmissible !== undefined) {
            reasons.push(
                `edit ${plan.name} edits step ${plan.edited_step_index}, which its ${plan.edit_scope} edit cannot alter on example ${inadmissible}`,
            );
            continue;
        }
        try {
            if ((await materialize(run, plan)) === null) {
                reasons.push(
                    `edit ${plan.name} was applied without exactly its declared replacements`,
                );
            }
        } catch (error) {
            reasons.push(`edit ${plan.name} could not be applied: ${messageOf(error)}`);
        }
    }
    return reasons.length > 0
        ? reasons.join("; ")
        : Object.freeze({ parent: parentId, plans: Object.freeze(plans), reflection });
}

/**
 * Applies one plan through the caller's applier; returns null when the application does not supply
 * exactly the declared replacements.
 */
async function materialize(run: Run, plan: CounterfactualCandidatePlan): Promise<Candidate | null> {
    const parent =
        plan.parent_candidate_id === null
            ? null
            : // Admission only names a parent from the pool, whose members are materialized.
              (run.candidates.get(plan.parent_candidate_id) as Candidate).plan;
    const application = (await run.applyEdit(
        Object.freeze({
            edit: Object.freeze({
                changes: plan.changes,
                fix_set: plan.fix_set,
                guard_set: plan.guard_set,
                mechanism: plan.mechanism,
                name: plan.name,
                patch: plan.patch,
                prior: plan.prior,
                rationale: plan.rationale,
                scope: plan.edit_scope,
                step_index: plan.edited_step_index,
            }),
            parent,
            protocol: run.protocol.definition,
        }),
    )) as unknown;
    const fields = readScopeDataObject(application ?? {}, [], "edit application", [
        "handlers",
        "program",
        "provider",
        "task",
    ]) as CounterfactualEditApplication;
    const exact = REPLAY_CHANGE_DIMENSIONS.every(
        (dimension) => (fields[dimension] !== undefined) === plan.changes.includes(dimension),
    );
    if (
        !exact ||
        (fields.program !== undefined && typeof fields.program !== "function") ||
        (fields.task !== undefined && typeof fields.task !== "function")
    ) {
        return null;
    }
    return Object.freeze({ application: fields, plan });
}

async function evaluateCandidate(
    run: Run,
    candidate: Candidate,
    reference: number,
): Promise<CroCandidateBody> {
    const { plan } = candidate;
    const progress: Progress = {
        causes: [],
        pending: ZERO_APPLICATION_COST,
        dev: null,
        dev_score: null,
        gate: null,
        promotion_reference: null,
        targeted: [],
        train: null,
    };
    for (const [exampleId, role] of [
        ...plan.fix_set.map((id) => [id, FIX_ROLE] as const),
        ...plan.guard_set.map((id) => [id, GUARD_ROLE] as const),
    ]) {
        progress.targeted.push(await runExample(run, candidate, exampleId, role, progress));
    }
    progress.gate = evaluateCroGate(run.protocol.thresholds, progress.targeted);
    if (!progress.gate.passed) {
        return settle(run, candidate, progress, ARCHIVED);
    }
    const splitIds = (split: CounterfactualSplit) =>
        [...run.examples.values()]
            .filter((entry) => entry.split === split)
            .map((entry) => entry.example.id);
    progress.dev = [];
    for (const exampleId of splitIds(DEV_SPLIT)) {
        progress.dev.push(await runExample(run, candidate, exampleId, DEV_ROLE, progress));
    }
    progress.dev_score = mean(progress.dev.map((result) => result.score));
    progress.promotion_reference = reference;
    if (!croPromotes(run.protocol.thresholds, progress.dev_score, reference)) {
        return settle(run, candidate, progress, EVALUATED);
    }
    progress.train = [];
    const targeted = new Set([...plan.fix_set, ...plan.guard_set]);
    for (const exampleId of splitIds(TRAIN_SPLIT).filter((id) => !targeted.has(id))) {
        progress.train.push(await runExample(run, candidate, exampleId, TRAIN_ROLE, progress));
    }
    return settle(run, candidate, progress, PROMOTED);
}

function settle(
    run: Run,
    candidate: Candidate,
    progress: Progress,
    status: string,
): CroCandidateBody {
    const body = outcomeBody(run, candidate, progress, status, null);
    append(run, run.head, `${OUTCOME_STEP}:${candidate.plan.candidate_id}`, body, progress.causes);
    return readCroCandidateBody(createVersionedApplicationBody(body));
}

function outcomeBody(
    run: Run,
    candidate: Candidate,
    progress: Progress,
    status: string,
    failure: CounterfactualFailure | null,
): Readonly<Record<string, unknown>> {
    const results = [...progress.targeted, ...(progress.dev ?? []), ...(progress.train ?? [])];
    return {
        ...candidate.plan,
        application_id: run.applicationId,
        cost: results.reduce<ApplicationCostSummary>(
            (sum, result) => addApplicationCosts(sum, result.cost),
            failure === null ? ZERO_APPLICATION_COST : progress.pending,
        ),
        dev: progress.dev,
        dev_score: failure === null ? progress.dev_score : null,
        failure,
        gate: progress.gate,
        phase: CANDIDATE_PHASE,
        promotion_reference: progress.dev_score === null ? null : progress.promotion_reference,
        status,
        targeted: progress.targeted,
        train: progress.train,
    };
}

async function runExample(
    run: Run,
    candidate: Candidate,
    exampleId: string,
    role: CounterfactualExampleRole,
    progress: Progress,
): Promise<CounterfactualExampleResult> {
    const { applicationId, clock, store } = run;
    const plan = candidate.plan;
    const entry = run.examples.get(exampleId) as ExampleEntry;
    const sourceSessionId = sourceSessionOf(run, plan.parent_candidate_id, exampleId);
    const source = inspectReplaySession(store, { sessionId: sourceSessionId, ...clock });
    const { dependents } = analyzeReplayDependencies(store, {
        sessionId: sourceSessionId,
        stepIndex: plan.edited_step_index,
        ...clock,
    });
    const stepCount =
        plan.edit_scope === REQUEST_SCOPE
            ? plan.edited_step_index
            : (dependents[0] ?? source.steps.length);
    const target = Object.freeze({
        prefix_id: source.steps[stepCount - 1]?.prefix_id ?? null,
        source_session_id: sourceSessionId,
        step_index: stepCount,
    });
    const replayed = await replayCandidate(
        run,
        candidate,
        entry.example,
        commandOf(applicationId, BRANCH_STEP, {
            candidate_id: plan.candidate_id,
            example_id: exampleId,
        }),
        source,
        stepCount,
    );
    const branch = replayed.session;
    progress.causes.push(branch.head_record_id as RecordId);
    progress.pending = measureReplaySessionCost(branch);
    if (replayed.interrupted !== null) {
        return retainInterruption(run, candidate, progress, replayed.interrupted);
    }
    assertFinished(run, candidate, progress, "branch", branch);
    const analysis = analyzeReplayDivergence(store, {
        replaySessionId: branch.session_id,
        sourceSessionId,
        ...clock,
    });
    if (
        analysis.unexplained.length > 0 ||
        (analysis.first_divergence_index ?? stepCount) < stepCount
    ) {
        return retainFailure(run, candidate, progress, {
            code: config.errors.evidenceCode,
            reason: `candidate ${plan.candidate_id} diverged before its target or without explanation on example ${exampleId}: branch session ${branch.session_id}, first divergence ${String(analysis.first_divergence_index)}, unexplained [${analysis.unexplained.join(", ")}]`,
        });
    }
    let comparison = null;
    if (run.baselines.includes(FULL_REPLAY)) {
        const replayedFull = await replayCandidate(
            run,
            candidate,
            entry.example,
            commandOf(applicationId, FULL_REPLAY, {
                candidate_id: plan.candidate_id,
                example_id: exampleId,
            }),
            source,
            0,
        );
        const full = replayedFull.session;
        progress.causes.push(full.head_record_id as RecordId);
        if (replayedFull.interrupted !== null) {
            return retainInterruption(run, candidate, progress, replayedFull.interrupted);
        }
        assertFinished(run, candidate, progress, "full replay", full);
        const measured = measureReplaySessionCost(full);
        comparison = {
            cache_read_input_tokens: measured.cache_read_input_tokens,
            kind: FULL_REPLAY,
            provider_calls: measured.provider_calls,
            session_id: full.session_id,
        };
    }
    let score: number;
    try {
        score = readScore(
            await run.metric(
                Object.freeze({
                    candidate: plan,
                    example: entry.example,
                    session: branch,
                    split: entry.split,
                }),
            ),
        );
    } catch (error) {
        return retainFailure(
            run,
            candidate,
            progress,
            {
                code: config.errors.verificationCode,
                reason: `metric failed for candidate ${plan.candidate_id} on example ${exampleId}`,
            },
            error,
        );
    }
    progress.pending = ZERO_APPLICATION_COST;
    return Object.freeze({
        affected_steps: dependents,
        baseline: comparison,
        cost: measureReplaySessionCost(branch),
        divergence: {
            common_prefix_id: analysis.common_prefix_id,
            first_divergence_index: analysis.first_divergence_index,
            live_steps: branch.steps.filter((step) => step.source === LIVE_SOURCE).length,
            recorded_steps: branch.steps.filter((step) => step.source !== LIVE_SOURCE).length,
            unexplained: analysis.unexplained,
        },
        example_id: exampleId,
        parent_score: parentScoreOf(run, plan.parent_candidate_id, exampleId),
        role,
        score,
        session_id: branch.session_id,
        target,
    });
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
    example: CounterfactualExample,
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
                    task: changes.includes(TASK_CHANGE)
                        ? candidate.application.task?.(example)
                        : undefined,
                }),
                program: workflow.program(example),
                // Every candidate is compared against the same retained parent: none abandons it.
                sourceDisposition: RETAIN_SOURCE,
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
 * Reports whether a plan's edited step exists in a source session and, for a `request` edit, has a
 * kind its declared changes can alter.
 */
function admitsStep(plan: CounterfactualCandidatePlan, source: ReplaySessionInspection): boolean {
    const step = source.steps[plan.edited_step_index];
    return (
        step !== undefined &&
        (plan.edit_scope !== REQUEST_SCOPE || replayChangesExplainStepKind(step.kind, plan.changes))
    );
}

/**
 * Resolves the program, provider, and handler stack a candidate's sessions run with: the
 * candidate's own replacement, else that of the nearest ancestor in its parent chain that supplied
 * one, else the baseline's.
 */
function resolveWorkflow(
    run: Run,
    candidate: Candidate,
): {
    readonly handlers: CounterfactualWorkflowDefinition["handlers"] | undefined;
    readonly program: CounterfactualWorkflowDefinition["program"];
    readonly provider: CounterfactualWorkflowDefinition["provider"] | undefined;
} {
    let { handlers, program, provider } = candidate.application;
    let parent = candidate.plan.parent_candidate_id;
    while (parent !== null) {
        const ancestor = run.candidates.get(parent) as Candidate;
        handlers ??= ancestor.application.handlers;
        program ??= ancestor.application.program;
        provider ??= ancestor.application.provider;
        parent = ancestor.plan.parent_candidate_id;
    }
    return {
        handlers: handlers ?? run.baseline.handlers,
        program: program ?? run.baseline.program,
        provider: provider ?? run.baseline.provider,
    };
}

/** Session of a pool member (or the baseline) on one example. */
function sourceSessionOf(run: Run, parentId: string | null, exampleId: string): string {
    if (parentId === null) {
        return (run.scores.get(exampleId) as CounterfactualBaselineExample).session_id;
    }
    return resultOf(run.outcomes.get(parentId) as CroCandidateBody, exampleId).session_id;
}

function parentScoreOf(run: Run, parentId: string | null, exampleId: string): number {
    if (parentId === null) {
        return (run.scores.get(exampleId) as CounterfactualBaselineExample).score;
    }
    return resultOf(run.outcomes.get(parentId) as CroCandidateBody, exampleId).score;
}

function resultOf(
    outcome: Pick<CroCandidateBody, "dev" | "targeted" | "train">,
    exampleId: string,
): CounterfactualExampleResult {
    // Only promoted candidates are parents, and they retain dev and train results.
    const result = [
        ...outcome.targeted,
        ...(outcome.dev as readonly CounterfactualExampleResult[]),
        ...(outcome.train as readonly CounterfactualExampleResult[]),
    ].find((entry) => entry.example_id === exampleId);
    assert(result !== undefined, `parent retains no session on example ${exampleId}`);
    return result;
}

function baselineDevScore(run: Run): number {
    return mean(
        [...run.scores.values()]
            .filter((example) => example.split === DEV_SPLIT)
            .map((example) => example.score),
    );
}

function comparisonCalls(outcome: CroCandidateBody): number {
    return [...outcome.targeted, ...(outcome.dev ?? []), ...(outcome.train ?? [])].reduce(
        (sum, result) => sum + (result.baseline?.provider_calls ?? 0),
        0,
    );
}

function selectionBody(
    applicationId: string,
    pool: readonly CounterfactualPoolMember[],
): Readonly<Record<string, unknown>> {
    const selected = pool.reduce((best, member) =>
        member.dev_score >= best.dev_score ? member : best,
    );
    return {
        application_id: applicationId,
        dev_score: selected.dev_score,
        phase: SELECTION_PHASE,
        pool: pool.slice(1).map((member) => member.candidate_id as string),
        selected_candidate_id: selected.candidate_id,
    };
}

function computationReuse(
    iteration: number,
    candidates: readonly CounterfactualCandidateRecord[],
): CounterfactualComputationReuse {
    let live = 0;
    let recorded = 0;
    for (const candidate of candidates.filter((entry) => entry.iteration === iteration)) {
        for (const result of [
            ...candidate.targeted,
            ...(candidate.dev ?? []),
            ...(candidate.train ?? []),
        ]) {
            live += result.divergence.live_steps;
            recorded += result.divergence.recorded_steps;
        }
    }
    return Object.freeze({
        live_steps: live,
        recorded_steps: recorded,
        reuse_ratio: live + recorded === 0 ? null : recorded / (live + recorded),
        session_index: iteration,
    });
}

/**
 * Retains the candidate as rejected with the evidence failure and raises when a candidate session
 * ended with any terminal status other than finished.
 */
function assertFinished(
    run: Run,
    candidate: Candidate,
    progress: Progress,
    role: string,
    session: ReplaySessionInspection,
): void {
    const status = (session.terminal as ReplayTerminalInspection).status;
    if (status !== FINISHED_SESSION) {
        retainFailure(run, candidate, progress, {
            code: config.errors.evidenceCode,
            reason: `candidate ${candidate.plan.candidate_id} ${role} session ${session.session_id} ended ${status} instead of finished`,
        });
    }
}

function retainInterruption(
    run: Run,
    candidate: Candidate,
    progress: Progress,
    interrupted: ReplaySessionInterruptedError,
): never {
    return retainFailure(
        run,
        candidate,
        progress,
        {
            code: config.errors.evidenceCode,
            reason: `candidate ${candidate.plan.candidate_id} session ${interrupted.session_id} was interrupted before its terminal record`,
        },
        interrupted,
    );
}

function retainFailure(
    run: Run,
    candidate: Candidate,
    progress: Progress,
    failure: CounterfactualFailure,
    cause?: unknown,
): never {
    append(
        run,
        run.head,
        `${OUTCOME_STEP}:${candidate.plan.candidate_id}`,
        outcomeBody(run, candidate, progress, REJECTED, failure),
        progress.causes,
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

function append(
    run: Run,
    head: RecordId | null,
    step: string,
    fields: Readonly<Record<string, unknown>>,
    causes: readonly RecordId[],
): void {
    const body = createVersionedApplicationBody(fields);
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

/**
 * Derives the handoff manifest from a settled inspection and validates it against the protocol's
 * handoff schema surfaces. A handoff the pinned schema refuses is a protocol mismatch.
 */
function readHandoff(
    protocol: CroProtocol,
    inspection: CounterfactualOptimizationInspection,
): CounterfactualHandoff {
    const handoff: CounterfactualHandoff = {
        candidates: inspection.candidates.map((candidate) => ({
            candidate_id: candidate.candidate_id,
            parent_candidate_id: candidate.parent_candidate_id,
            status: candidate.status,
        })),
        selected_candidate_id: inspection.selection?.selected_candidate_id ?? null,
    };
    try {
        assertApplicationMessage(
            protocol.handoff,
            handoff as unknown as SemanticValue,
            "handoff manifest",
        );
    } catch (error) {
        throw new ApplicationProtocolError(
            `handoff manifest of application ${inspection.application_id} is not admitted by the protocol handoff schema`,
            { cause: error },
        );
    }
    return deepFreeze(handoff);
}

function buildManifest(
    run: Run,
    inspection: CounterfactualOptimizationInspection,
    retained: RetainedRecords,
) {
    const roles = cro.artifactRoles;
    const artifacts: ApplicationArtifactSource[] = [
        recordArtifact(roles.baseline, retained.opened),
    ];
    const sessions = [
        ...inspection.examples.map((example) => example.session_id),
        ...inspection.proposals.flatMap((proposal) => proposal.proposer_session_ids),
    ];
    for (const proposal of retained.proposals) {
        artifacts.push(recordArtifact(roles.proposal, proposal));
        for (const plan of proposal.body.candidates) {
            const outcome = retained.outcomes.get(plan.candidate_id) as Retained<CroCandidateBody>;
            artifacts.push(recordArtifact(roles.candidate, outcome));
            for (const result of [
                ...outcome.body.targeted,
                ...(outcome.body.dev ?? []),
                ...(outcome.body.train ?? []),
            ]) {
                sessions.push(result.session_id);
                if (result.baseline !== null) {
                    sessions.push(result.baseline.session_id);
                }
            }
        }
    }
    artifacts.push(
        recordArtifact(roles.selection, retained.selection as Retained<CroSelectionBody>),
    );
    const costs = sessions.reduce<ApplicationCostSummary>(
        (sum, sessionId) =>
            addApplicationCosts(
                sum,
                measureReplaySessionCost(
                    inspectReplaySession(run.store, { sessionId, ...run.clock }),
                ),
            ),
        ZERO_APPLICATION_COST,
    );
    return createApplicationManifest({
        applicationId: run.applicationId,
        artifacts,
        computationReuse: inspection.computation_reuse,
        costs,
        protocol: run.protocol.definition,
    });
}

function recordArtifact(role: string, entry: Retained<object>): ApplicationArtifactSource {
    return {
        content: entry.body as unknown as SemanticValue,
        cut_id: null,
        record_id: entry.record_id,
        role,
    };
}

function assertMeasuredBudget(run: Run, sessionId: string): void {
    const budget = run.protocol.budgets.providerCalls;
    if (run.spent > budget) {
        throw new ApplicationBudgetError(
            `${run.spent} measured live provider call(s) through session ${sessionId} exceed ${cro.budgetKeys.providerCalls} ${budget}`,
        );
    }
}

function assertBudget(run: Run, projected: number): void {
    const budget = run.protocol.budgets.providerCalls;
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
    assert(readCroPhase(first.body) === OPENED_PHASE, "the first record is not the opened record");
    const opened = readCroOpenedBody(first.body);
    const thresholds = readCroThresholds(opened.thresholds);
    const budgets = readBudgetsOf(opened.budgets);
    assert(
        typeof thresholds !== "string" &&
            budgets !== null &&
            opened.application_id === applicationId &&
            deriveApplicationOwnerId(opened.command_id) === applicationId &&
            opened.examples.every(
                (example) =>
                    example.session_id ===
                    deriveReplaySessionId(
                        commandOf(applicationId, BASELINE_STEP, { example_id: example.example_id }),
                    ),
            ),
        "opened record names another application, baseline session, budget, or threshold",
    );
    const gate = thresholds as CroThresholds;
    const loop = budgets as CroBudgets;
    const examples = new Map(opened.examples.map((example) => [example.example_id, example]));
    const trainIds = opened.examples
        .filter((example) => example.split === TRAIN_SPLIT)
        .map((example) => example.example_id);
    const devIds = opened.examples
        .filter((example) => example.split === DEV_SPLIT)
        .map((example) => example.example_id);
    const manifest = readRetainedManifest(store, applicationId);
    const proposals: Retained<CroProposalBody>[] = [];
    const outcomes = new Map<string, Retained<CroCandidateBody>>();
    const names = new Set<string>();
    const pool: CounterfactualPoolMember[] = [
        {
            candidate_id: null,
            dev_score: mean(devIds.map((id) => (examples.get(id) as { score: number }).score)),
            name: null,
        },
    ];
    let pending: CounterfactualCandidatePlan[] = [];
    let used = 0;
    let head = first.envelope.record_id;
    let stopped = false;
    let selection: Retained<CroSelectionBody> | null = null;
    let manifestSeen = false;
    let terminal = false;
    for (const record of rest) {
        const schemaRef = record.envelope.schema_ref;
        assert(!terminal, "application retains a record after its terminal cut");
        assert(record.envelope.caused_by_record_ids[0] === head, "record does not follow the head");
        if (schemaRef === config.traceSchemas.croCandidate) {
            assertRecord(record, schemaRef);
            assert(!stopped && selection === null, "record follows a stop or the selection");
            const phase = readCroPhase(record.body);
            if (phase === PROPOSAL_PHASE) {
                const body = readCroProposalBody(record.body);
                const iteration = proposals.length;
                const capacity = Math.min(loop.proposals, loop.candidates - used);
                const attemptSessions = Array.from({ length: body.attempts }, (_, attempt) =>
                    deriveReplaySessionId(
                        commandOf(applicationId, PROPOSER_STEP, {
                            attempt: String(attempt),
                            iteration: String(iteration),
                        }),
                    ),
                );
                assert(
                    pending.length === 0 &&
                        body.application_id === applicationId &&
                        body.iteration === iteration &&
                        iteration < loop.iterations &&
                        capacity > 0 &&
                        body.attempts <= loop.proposalAttempts &&
                        (body.failure === null || body.attempts === loop.proposalAttempts) &&
                        body.candidates.length <= capacity &&
                        isOrderedSubset(body.proposer_session_ids, attemptSessions) &&
                        (body.failure !== null ||
                            pool.some(
                                (member) => member.candidate_id === body.parent_candidate_id,
                            )) &&
                        body.candidates.every(
                            ({ candidate_id, ...plan }) =>
                                candidate_id === candidateIdOf(applicationId, plan) &&
                                !names.has(plan.name) &&
                                [...plan.fix_set, ...plan.guard_set].every((id) =>
                                    trainIds.includes(id),
                                ),
                        ) &&
                        new Set(body.candidates.map((plan) => plan.name)).size ===
                            body.candidates.length,
                    "proposal is out of order or disagrees with the pool, budgets, or identities",
                );
                for (const plan of body.candidates) {
                    names.add(plan.name);
                }
                proposals.push(Object.freeze({ body, record_id: record.envelope.record_id }));
                pending = [...body.candidates];
                stopped = body.failure !== null;
            } else if (phase === CANDIDATE_PHASE) {
                const body = readCroCandidateBody(record.body);
                const plan = pending.shift();
                assert(
                    plan !== undefined &&
                        body.application_id === applicationId &&
                        canonical(planOf(body)) === canonical(plan),
                    "candidate outcome is out of order or disagrees with its plan",
                );
                validateOutcome(applicationId, body, {
                    baselines: opened.baselines,
                    devIds,
                    examples,
                    outcomes,
                    reference: pool.at(-1)?.dev_score as number,
                    thresholds: gate,
                    trainIds,
                });
                outcomes.set(body.candidate_id, {
                    body,
                    record_id: record.envelope.record_id,
                });
                used += 1;
                stopped = body.failure !== null;
                if (body.status === PROMOTED) {
                    pool.push({
                        candidate_id: body.candidate_id,
                        dev_score: body.dev_score as number,
                        name: body.name,
                    });
                }
            } else {
                assert(phase === SELECTION_PHASE, "record carries an unknown phase");
                const body = readCroSelectionBody(record.body);
                assert(
                    pending.length === 0 &&
                        body.application_id === applicationId &&
                        (proposals.length === loop.iterations ||
                            Math.min(loop.proposals, loop.candidates - used) === 0) &&
                        canonical(stripVersions(body)) ===
                            canonical(selectionBody(applicationId, pool)),
                    "selection does not follow every proposal or disagrees with the pool",
                );
                selection = Object.freeze({ body, record_id: record.envelope.record_id });
            }
        } else if (schemaRef === config.traceSchemas.manifest) {
            assertRecord(record, schemaRef);
            assert(
                selection !== null &&
                    manifest !== null &&
                    manifest.record_id === record.envelope.record_id &&
                    manifest.manifest.protocol_id === opened.protocol_id &&
                    manifest.manifest.kind === CRO_KIND,
                "manifest record does not follow the selection",
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
        head,
        manifest,
        opened: Object.freeze({ body: opened, record_id: first.envelope.record_id }),
        outcomes,
        proposals: Object.freeze(proposals),
        selection,
    });
}

/**
 * Validates one retained candidate outcome against the run: derived session identities, parent
 * forks and scores, example order, the recomputed gate and promotion, and summed cost.
 */
function validateOutcome(
    applicationId: string,
    body: CroCandidateBody,
    context: {
        readonly baselines: readonly CounterfactualBaselineKind[];
        readonly devIds: readonly string[];
        readonly examples: ReadonlyMap<string, CounterfactualBaselineExample>;
        readonly outcomes: ReadonlyMap<string, Retained<CroCandidateBody>>;
        readonly reference: number;
        readonly thresholds: CroThresholds;
        readonly trainIds: readonly string[];
    },
): void {
    const parent =
        body.parent_candidate_id === null
            ? null
            : context.outcomes.get(body.parent_candidate_id)?.body;
    const parentResult = (exampleId: string) =>
        parent === null || parent === undefined
            ? (context.examples.get(exampleId) as CounterfactualBaselineExample | undefined)
            : resultOf(parent, exampleId);
    const results = [...body.targeted, ...(body.dev ?? []), ...(body.train ?? [])];
    const settled = body.failure === null;
    const targetedIds = new Set([...body.fix_set, ...body.guard_set]);
    const trainRest = context.trainIds.filter((id) => !targetedIds.has(id));
    const isPrefix = (actual: readonly { example_id: string }[] | null, expected: string[]) =>
        actual === null ||
        (actual.length <= expected.length &&
            actual.every((result, index) => result.example_id === expected[index]) &&
            (!settled || actual.length === expected.length));
    const recomputedGate =
        body.targeted.length === body.fix_set.length + body.guard_set.length
            ? evaluateCroGate(context.thresholds, body.targeted)
            : null;
    assert(
        (parent === null || parent?.status === PROMOTED) &&
            results.every((result) => {
                const source = parentResult(result.example_id);
                return (
                    source !== undefined &&
                    result.target.source_session_id === source.session_id &&
                    result.parent_score === source.score &&
                    result.session_id ===
                        deriveReplaySessionId(
                            commandOf(applicationId, BRANCH_STEP, {
                                candidate_id: body.candidate_id,
                                example_id: result.example_id,
                            }),
                        ) &&
                    (result.baseline === null) !== context.baselines.includes(FULL_REPLAY) &&
                    (result.baseline === null ||
                        result.baseline.session_id ===
                            deriveReplaySessionId(
                                commandOf(applicationId, FULL_REPLAY, {
                                    candidate_id: body.candidate_id,
                                    example_id: result.example_id,
                                }),
                            ))
                );
            }) &&
            isPrefix(body.dev, [...context.devIds]) &&
            isPrefix(body.train, trainRest) &&
            (body.gate === null || canonical(body.gate) === canonical(recomputedGate)) &&
            (!settled ||
                body.dev === null ||
                (body.dev_score === mean(body.dev.map((result) => result.score)) &&
                    body.promotion_reference === context.reference &&
                    (body.status === PROMOTED) ===
                        croPromotes(context.thresholds, body.dev_score, context.reference))) &&
            (!settled ||
                canonical(body.cost) ===
                    canonical(
                        results.reduce<ApplicationCostSummary>(
                            (sum, result) => addApplicationCosts(sum, result.cost),
                            ZERO_APPLICATION_COST,
                        ),
                    )),
        `candidate ${body.candidate_id} outcome disagrees with its parent, examples, gate, promotion, or cost`,
    );
}

function isOrderedSubset(values: readonly string[], order: readonly string[]): boolean {
    const positions = values.map((value) => order.indexOf(value));
    return positions.every(
        (position, index) =>
            position >= 0 && (index === 0 || position > (positions[index - 1] as number)),
    );
}

function planOf(body: CroCandidateBody): CounterfactualCandidatePlan {
    return {
        candidate_id: body.candidate_id,
        changes: body.changes,
        edit_scope: body.edit_scope,
        edited_step_index: body.edited_step_index,
        fix_set: body.fix_set,
        guard_set: body.guard_set,
        iteration: body.iteration,
        mechanism: body.mechanism,
        name: body.name,
        parent_candidate_id: body.parent_candidate_id,
        patch: body.patch,
        prior: body.prior,
        rationale: body.rationale,
    };
}

function toCandidateRecord({
    body,
    record_id,
}: Retained<CroCandidateBody>): CounterfactualCandidateRecord {
    const {
        application_id: _application,
        phase: _phase,
        ...record
    } = stripVersions(body) as CroCandidateBody;
    return Object.freeze({ ...record, record_id });
}

function stripVersions(fields: object): Readonly<Record<string, unknown>> {
    const {
        application_version: _version,
        compatibility_version: _compatibility,
        ...rest
    } = fields as Record<string, unknown>;
    return rest;
}

function readBudgetsOf(budgets: Readonly<Record<string, number>>): CroBudgets | null {
    const resolved: Record<string, number> = {};
    for (const [field, key] of Object.entries(cro.budgetKeys)) {
        const value = budgets[key];
        if (value === undefined) {
            return null;
        }
        resolved[field] = value;
    }
    return resolved as CroBudgets;
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
    const budgets = readBudgetsOf(definition.budgets);
    if (budgets === null) {
        throw new ApplicationProtocolError(
            `budgets must declare ${Object.values(cro.budgetKeys).join(", ")}`,
        );
    }
    const limits = config.limits;
    const keys = cro.budgetKeys;
    for (const [key, value, bound] of [
        [keys.candidates, budgets.candidates, limits.maxCandidates],
        [keys.proposals, budgets.proposals, limits.maxCandidates],
        [keys.iterations, budgets.iterations, limits.maxRounds],
        [keys.proposalAttempts, budgets.proposalAttempts, limits.maxRounds],
    ] as const) {
        if (value === 0 || value > bound) {
            throw new ApplicationProtocolError(
                `${key} must be positive and within the configured bound ${bound}`,
            );
        }
    }
    const declaredThresholds = definition.thresholds;
    const thresholds = readCroThresholds(declaredThresholds);
    // A missing map always yields a missing key, so the undefined check only narrows the type.
    if (typeof thresholds === "string" || declaredThresholds === undefined) {
        throw new ApplicationProtocolError(`thresholds must declare ${String(thresholds)}`);
    }
    return {
        budgets,
        declaredThresholds,
        definition,
        handoff: compileApplicationSchemaSurfaces(definition, roles.handoff),
        reflection: compileApplicationSchemaSurfaces(definition, roles.reflection),
        thresholds,
    };
}

function readWorkflow(value: unknown): CounterfactualWorkflowDefinition {
    const fields = readScopeDataObject(value, ["program", "programId"], "baseline", [
        "handlers",
        "provider",
        "task",
    ]);
    readFunction(fields.program, "baseline.program");
    assertScopeText(fields.programId, "baseline.programId");
    if (fields.task !== undefined) {
        readFunction(fields.task, "baseline.task");
    }
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

/**
 * Validates the train and dev splits: non-empty splits of canonical examples whose identities are
 * distinct and drawn from the protocol's dataset items. Returns train then dev entries.
 */
function readDataset(
    value: unknown,
    protocol: ApplicationProtocolDefinition,
): ReadonlyMap<string, ExampleEntry> {
    const fields = readScopeDataObject(value, [DEV_SPLIT, TRAIN_SPLIT], "dataset");
    const entries = new Map<string, ExampleEntry>();
    for (const split of APPLICATION_CRO_SPLITS) {
        const examples = readScopeArray(fields[split], `dataset.${split}`);
        if (examples.length === 0) {
            throw new TypeError(`dataset.${split} must be non-empty`);
        }
        for (const [index, entry] of examples.entries()) {
            const subject = `dataset.${split}[${index}]`;
            const example = readScopeDataObject(entry, ["id", "input"], subject);
            assertScopeText(example.id, `${subject}.id`);
            if (entries.has(example.id) || !protocol.dataset.items.includes(example.id)) {
                throw new TypeError(
                    `${subject}.id must be distinct and one of the protocol's dataset items`,
                );
            }
            entries.set(
                example.id,
                Object.freeze({
                    example: Object.freeze({
                        id: example.id,
                        input: JSON.parse(canonical(example.input)) as SemanticValue,
                    }),
                    split,
                }),
            );
        }
    }
    return entries;
}

function readScore(value: unknown): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new TypeError("metric must return a finite score");
    }
    return value;
}

function candidateIdOf(
    applicationId: string,
    plan: Omit<CounterfactualCandidatePlan, "candidate_id">,
): string {
    return prefixedApplicationId(config.identity.candidateIdPrefix, {
        application_id: applicationId,
        changes: plan.changes,
        edit_scope: plan.edit_scope,
        edited_step_index: plan.edited_step_index,
        fix_set: plan.fix_set,
        guard_set: plan.guard_set,
        iteration: plan.iteration,
        mechanism: plan.mechanism,
        name: plan.name,
        parent_candidate_id: plan.parent_candidate_id,
        patch: plan.patch,
        prior: plan.prior,
        rationale: plan.rationale,
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

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function bound(text: string): string {
    const limit = config.limits.maxReasonLength;
    return text.length <= limit ? text : text.slice(0, limit);
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
