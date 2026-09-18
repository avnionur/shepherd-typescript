import type { SemanticValue } from "../canonical/canonical-record.ts";
import {
    applicationsProtocolConfig,
    kernelProtocolConfig,
    providerProtocolConfig,
} from "../protocol/config.ts";
import {
    APPLICATION_KINDS,
    APPLICATION_PROTOCOL_SURFACES,
    APPLICATION_TREE_RL_BASELINE_KINDS,
    APPLICATION_TREE_RL_PHASES,
    APPLICATION_TREE_RL_ROLLOUT_STATUSES,
    RECORD_MODES,
    REPLAY_CHANGE_DIMENSIONS,
    REPLAY_RECOVERY_CLASSIFICATIONS,
    REPLAY_STEP_KINDS,
    REPLAY_TERMINAL_STATUSES,
} from "../protocol/values.generated.ts";
import type { ModelProvider } from "../provider/types.ts";
import { ROOT_WITNESS_ID } from "../record/root-witness.ts";
import type { RecordId } from "../record/types.ts";
import { analyzeReplayDependencies, analyzeReplayDivergence } from "../replay/analysis.ts";
import { replayReplaySession } from "../replay/branch.ts";
import { ReplaySessionInterruptedError } from "../replay/errors.ts";
import { inspectReplaySession } from "../replay/inspection.ts";
import { deriveReplaySessionId } from "../replay/session.ts";
import type { ReplaySessionInspection, ReplayTerminalInspection } from "../replay/types.ts";
import { assertScopeText, readScopeDataObject } from "../scope/validation.ts";
import type { SQLiteTraceStore } from "../store/sqlite-trace-store.ts";
import type { OwnerRecord } from "../store/types.ts";
import {
    ApplicationBudgetError,
    ApplicationEvidenceError,
    ApplicationProtocolError,
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
    createApplicationAppendIntentId,
    createApplicationAppendRequest,
    createApplicationCommandId,
    createVersionedApplicationBody,
    measureReplaySessionCost,
    prefixedApplicationId,
    readCount,
    ZERO_APPLICATION_COST,
} from "./records.ts";
import {
    buildTreeRlBatch,
    canonical,
    readTreeRlBaselines,
    readTreeRlBatchBody,
    readTreeRlOpenedBody,
    readTreeRlRolloutBody,
    type TreeRlBatchBody,
    type TreeRlOpenedBody,
    type TreeRlRolloutBody,
} from "./tree-rl-records.ts";
import type {
    RunTreeRlRolloutsOptions,
    SelectTreeRlForkPointsOptions,
    TreeRlBatchExport,
    TreeRlBatchSummary,
    TreeRlFailure,
    TreeRlForkPoint,
    TreeRlProviderFactory,
    TreeRlRewardFunction,
    TreeRlRolloutPlan,
    TreeRlRolloutRecord,
    TreeRlRunInspection,
    TreeRlRunReceipt,
    TreeRlSelectedForkPoint,
    TreeRlTrainingBatch,
} from "./tree-rl-types.ts";
import type { ApplicationArtifactSource, ApplicationProtocolDefinition } from "./types.ts";

const config = applicationsProtocolConfig;
const treeRl = config.treeRl;
const [CAPTURE_MODE] = RECORD_MODES;
const [, , , TREE_RL_KIND] = APPLICATION_KINDS;
const [PROMPT_KIND, SCHEMA_KIND] = APPLICATION_PROTOCOL_SURFACES;
const [OPENED_PHASE, ROLLOUT_PHASE, BATCH_PHASE] = APPLICATION_TREE_RL_PHASES;
const [COMPLETED, FAILED] = APPLICATION_TREE_RL_ROLLOUT_STATUSES;
const [SINGLE_ROLLOUT] = APPLICATION_TREE_RL_BASELINE_KINDS;
const [, PROVIDER_CHANGE] = REPLAY_CHANGE_DIMENSIONS;
const [, RUNNING_CLASSIFICATION] = REPLAY_RECOVERY_CLASSIFICATIONS;
const [FINISHED_SESSION] = REPLAY_TERMINAL_STATUSES;
const [PROVIDER_STEP] = REPLAY_STEP_KINDS;
const OPENED_STEP = "opened";
const ROLLOUT_STEP = "rollout";
const BATCH_STEP = "batch";

type TreeRlProtocol = {
    readonly branches: number;
    readonly definition: ApplicationProtocolDefinition;
    readonly forkPoints: number;
    readonly minDependents: number;
    readonly providerCalls: number;
};

type RetainedEntry<T> = {
    readonly body: T;
    readonly record_id: RecordId;
};

type RetainedRecords = {
    readonly batch: RetainedEntry<TreeRlBatchBody> | null;
    readonly head: RecordId;
    readonly manifest: ReturnType<typeof readRetainedManifest>;
    readonly opened: RetainedEntry<TreeRlOpenedBody>;
    readonly plans: readonly TreeRlRolloutPlan[];
    readonly rollouts: readonly RetainedEntry<TreeRlRolloutBody>[];
};

type Run = {
    readonly applicationId: string;
    readonly claimId: string;
    readonly clock: { readonly clock?: () => number };
    readonly handlers: unknown;
    head: RecordId;
    readonly program: unknown;
    readonly protocol: TreeRlProtocol;
    readonly reward: TreeRlRewardFunction;
    readonly source: ReplaySessionInspection;
    spent: number;
    readonly store: SQLiteTraceStore;
};

/**
 * Selects deterministic trace-selected fork points of one recorded replay session.
 *
 * For each provider step of the session, in index order, `analyzeReplayDependencies` gives its
 * transitive dependents; a step qualifies when its dependent count reaches `minDependents`, and
 * qualifying steps are taken in index order up to `maxForkPoints`. Each fork point names the step
 * and the source prefix identity at its boundary (null at step 0). The selection is a pure function
 * of the retained session and writes nothing.
 *
 * @param store - Open trace store holding the session, writable or read-only.
 * @param options - Session identity, dependent-count minimum, fork-point bound, and optional clock.
 * @returns The selected fork points in step order; empty when no provider step qualifies.
 * @throws {ApplicationBudgetError} If `maxForkPoints` exceeds `APPLICATION_LIMITS.maxForkPoints`.
 * @throws {ReplayEvidenceError} If the session evidence is invalid.
 * @throws {TraceStoreError} If the store is closed.
 * @throws {TypeError} If options are malformed or the session is not retained.
 *
 * @example
 * ```ts
 * const forkPoints = selectTreeRlForkPoints(store, { maxForkPoints: 4, minDependents: 2, sessionId });
 * ```
 */
export function selectTreeRlForkPoints(
    store: SQLiteTraceStore,
    options: SelectTreeRlForkPointsOptions,
): readonly TreeRlSelectedForkPoint[] {
    const fields = readScopeDataObject(
        options,
        ["maxForkPoints", "minDependents", "sessionId"],
        "selectTreeRlForkPoints options",
        ["clock"],
    );
    assertScopeText(fields.sessionId, "sessionId");
    const minDependents = readCount(fields.minDependents, "minDependents");
    const maxForkPoints = readCount(fields.maxForkPoints, "maxForkPoints");
    if (maxForkPoints === 0) {
        throw new TypeError("maxForkPoints must be positive");
    }
    if (maxForkPoints > config.limits.maxForkPoints) {
        throw new ApplicationBudgetError(
            `${maxForkPoints} fork points exceed the configured bound ${config.limits.maxForkPoints}`,
        );
    }
    const clock =
        fields.clock === undefined
            ? {}
            : { clock: readFunction(fields.clock, "clock") as () => number };
    return selectForkPoints(
        store,
        inspectReplaySession(store, { sessionId: fields.sessionId, ...clock }),
        minDependents,
        maxForkPoints,
        clock,
    );
}

/**
 * Runs the Tree-RL adapter (§5.3) over a recorded replay session and exports a training batch.
 *
 * Fork points are selected from the finished source session by {@link selectTreeRlForkPoints} with
 * the protocol's dependent-count minimum and fork-point budget. Per fork point, the protocol's
 * branch count of rollouts is replayed from the fork point's step boundary through
 * `replayReplaySession` declaring the `provider` change, branch `k` under the protocol's seed `k`
 * and the static provider cassette the caller's factory returns for it; every earlier step is
 * served from the source journal. `analyzeReplayDivergence` must show no divergence before the fork
 * point and none unexplained. The caller's reward function scores each finished, proven rollout.
 * Every rollout is retained in fork-point, then branch order as one
 * `shepherd.application.tree_rl_rollout.v1` record with status `completed` or `failed`; a session
 * that did not finish, diverged, was interrupted by a dead writer whose lease expired, or whose
 * reward threw or was not finite is retained as `failed` with its configured reason and the run
 * continues. Advantages are computed over completed rollouts only by {@link computeTreeRlAdvantages},
 * the canonical `jsonl_v1` batch and its digest (and, with the `single_rollout` baseline, the batch
 * of each fork point's first branch) are retained in a batch record, and the manifest citing the
 * source session, every rollout record, and the batch as `training_batch` is retained last with
 * the terminal cut.
 *
 * Every option, the protocol, the source session, the selection, the rollout bounds, every
 * provider, and the projected provider calls are validated before any record is written, so a
 * refusal writes nothing. Repeating the command resumes from retained evidence: a terminal rollout
 * session is never re-executed, the reward function is not called for a retained rollout, and a
 * completed run returns its retained manifest and batch.
 *
 * @param store - Open writable trace store.
 * @param options - Command, claim, protocol, source session, program, provider factory, reward
 * function, and optional baselines, handlers, and clock.
 * @returns The retained manifest, the record-derived inspection, and the exported batch.
 * @throws {ApplicationProtocolError} If the protocol is malformed, is not a Tree-RL protocol, lacks
 * a required surface or budget, declares a zero branch or fork-point budget or fewer seeds than
 * branches, or the run was opened under another protocol. Nothing is written.
 * @throws {ApplicationBudgetError} If the fork-point budget exceeds `limits.maxForkPoints`, the
 * branch budget exceeds `limits.maxBranches`, the planned rollouts exceed `limits.maxRollouts`, or
 * the projected provider calls exceed the provider-call budget; the first three and the whole-run
 * projection are checked before any record, and each new rollout session is checked before it
 * opens.
 * @throws {ApplicationEvidenceError} If the source session is not finished, binds worlds or
 * processes, has no qualifying fork point, the run was opened with a different source, selection,
 * or baselines, or retained evidence is inconsistent. Nothing is written by a refusal.
 * @throws {ReplayEvidenceError} If the source session is not retained or its evidence is invalid.
 * @throws {ReplayLeaseConflictError} If a rollout session is held by another writer.
 * @throws {ReplaySessionInterruptedError} If a rollout session is still `running` under a live
 * lease; nothing is written.
 * @throws {TraceStoreError} If the store is closed.
 * @throws {TypeError} If options are malformed or the provider factory returns a provider that is
 * not a distinct static provider.
 *
 * @example
 * ```ts
 * const { batch } = await runTreeRlRollouts(store, {
 *     claimId: "tree-rl",
 *     commandId: "application:tree-rl:1",
 *     program,
 *     protocol,
 *     provider: ({ fork_point, seed }) => cassetteFor(fork_point, seed),
 *     reward: ({ rollout }) => score(rollout.terminal?.result),
 *     sourceSessionId,
 * });
 * console.log(batch.batch_digest, batch.line_count);
 * ```
 */
export async function runTreeRlRollouts(
    store: SQLiteTraceStore,
    options: RunTreeRlRolloutsOptions,
): Promise<TreeRlRunReceipt> {
    const fields = readScopeDataObject(
        options,
        ["claimId", "commandId", "program", "protocol", "provider", "reward", "sourceSessionId"],
        "runTreeRlRollouts options",
        ["baselines", "clock", "handlers"],
    );
    assertScopeText(fields.commandId, "commandId");
    assertScopeText(fields.claimId, "claimId");
    assertScopeText(fields.sourceSessionId, "sourceSessionId");
    const protocol = readTreeRlProtocol(fields.protocol);
    const protocolId = applicationProtocolId(protocol.definition);
    const baselines = readTreeRlBaselines(fields.baselines ?? []);
    readFunction(fields.program, "program");
    const factory = readFunction(fields.provider, "provider") as TreeRlProviderFactory;
    const reward = readFunction(fields.reward, "reward") as TreeRlRewardFunction;
    const clock =
        fields.clock === undefined
            ? {}
            : { clock: readFunction(fields.clock, "clock") as () => number };
    const applicationId = deriveApplicationOwnerId(fields.commandId);
    const retained =
        store.readOwner(applicationId).length === 0
            ? null
            : readTreeRlRecords(store, applicationId);
    if (retained !== null) {
        const opened = retained.opened.body;
        if (opened.protocol_id !== protocolId) {
            throw new ApplicationProtocolError(
                `application ${applicationId} was opened under another protocol`,
            );
        }
        assert(
            opened.command_id === fields.commandId &&
                opened.source_session_id === fields.sourceSessionId &&
                canonical(opened.baselines) === canonical(baselines),
            `application ${applicationId} was opened with a different source or baselines`,
        );
        if (retained.manifest !== null) {
            return receiptOf(store, applicationId, retained.manifest.manifest);
        }
    }
    const source = inspectReplaySession(store, { sessionId: fields.sourceSessionId, ...clock });
    if (
        source.terminal?.status !== FINISHED_SESSION ||
        source.worlds.length > 0 ||
        source.processes.length > 0
    ) {
        throw new ApplicationEvidenceError(
            `source session ${source.session_id} did not finish or binds worlds or processes`,
        );
    }
    const forkPoints = selectForkPoints(
        store,
        source,
        protocol.minDependents,
        protocol.forkPoints,
        clock,
    );
    if (forkPoints.length === 0) {
        throw new ApplicationEvidenceError(
            `source session ${source.session_id} has no provider step with ${protocol.minDependents} dependent(s)`,
        );
    }
    const seeds = protocol.definition.seeds.slice(0, protocol.branches);
    const rollouts = forkPoints.length * seeds.length;
    if (rollouts > config.limits.maxRollouts) {
        throw new ApplicationBudgetError(
            `${rollouts} planned rollouts exceed the configured bound ${config.limits.maxRollouts}`,
        );
    }
    const plans = planRollouts(applicationId, forkPoints, seeds);
    assert(
        retained === null || canonical(retained.opened.body.fork_points) === canonical(forkPoints),
        `application ${applicationId} was opened with a different fork-point selection`,
    );
    const providers = plans.map((plan) =>
        readRolloutProvider(
            factory(
                Object.freeze({
                    branch: plan.branch,
                    fork_point: plan.fork_point,
                    seed: plan.seed,
                    source_session_id: source.session_id,
                }),
            ),
            plan,
        ),
    );
    if (new Set(providers).size !== providers.length) {
        throw new TypeError("provider must return a distinct provider for every rollout");
    }
    const run: Run = {
        applicationId,
        claimId: fields.claimId,
        clock,
        handlers: fields.handlers,
        head: "" as RecordId,
        program: fields.program,
        protocol,
        reward,
        source,
        spent: 0,
        store,
    };
    const projected = plans.reduce(
        (total, plan, index) =>
            total +
            (retained?.rollouts[index]?.body.cost.provider_calls ??
                projectedCalls(source, plan.fork_point.step_index)),
        0,
    );
    if (projected > protocol.providerCalls) {
        throw new ApplicationBudgetError(
            `${projected} projected live provider call(s) exceed ${treeRl.budgetKeys.providerCalls} ${protocol.providerCalls}`,
        );
    }
    if (retained === null) {
        append(
            run,
            null,
            OPENED_STEP,
            {
                application_id: applicationId,
                baselines,
                command_id: fields.commandId,
                fork_points: forkPoints,
                kind: TREE_RL_KIND,
                phase: OPENED_PHASE,
                protocol_id: protocolId,
                seeds,
                source_session_id: source.session_id,
            },
            [(source.terminal as ReplayTerminalInspection).record_id],
        );
    } else {
        run.head = retained.head;
    }
    for (const [index, plan] of plans.entries()) {
        const entry = retained?.rollouts[index];
        if (entry === undefined) {
            await settleRollout(run, plan, providers[index] as ModelProvider);
        } else {
            run.spent += entry.body.cost.provider_calls;
        }
    }
    const settled = readTreeRlRecords(store, applicationId);
    if (settled.batch === null) {
        const batches = batchesOf(settled.opened.body, settled.rollouts);
        append(
            run,
            run.head,
            BATCH_STEP,
            {
                application_id: applicationId,
                baseline:
                    batches.baseline === null
                        ? null
                        : { ...summaryOf(batches.baseline), kind: SINGLE_ROLLOUT },
                ...summaryOf(batches.batch),
                phase: BATCH_PHASE,
            },
            [],
        );
    }
    const receipt = retainApplicationManifest(store, {
        manifest: buildManifest(run, readTreeRlRecords(store, applicationId)),
    });
    return receiptOf(store, applicationId, receipt.manifest);
}

/**
 * Exports the retained training batch of one Tree-RL run without mutation.
 *
 * The canonical `jsonl_v1` lines are re-derived from the retained rollout records: one line per
 * completed rollout in fork-point, then branch order, carrying its identity, source and rollout
 * sessions, fork point, seed, reward, advantages, and step count. The text is the canonical JSON of
 * each line followed by a line feed, and its digest must equal the retained batch digest. Export
 * works on reopened, read-only, and imported stores and yields an identical digest.
 *
 * @param store - Open trace store, writable or read-only.
 * @param applicationId - Application identity derived by {@link deriveApplicationOwnerId}.
 * @returns The batch lines, text, digest, and the optional single-rollout baseline batch.
 * @throws {ApplicationEvidenceError} If the application or its batch is not retained, or a
 * re-derived digest disagrees with the retained one.
 * @throws {TraceStoreError} If the store is closed.
 * @throws {TypeError} If the application identity is malformed.
 *
 * @example
 * ```ts
 * const batch = exportTreeRlTrainingBatch(store, deriveApplicationOwnerId(commandId));
 * await writeFile("batch.jsonl", batch.text);
 * ```
 */
export function exportTreeRlTrainingBatch(
    store: SQLiteTraceStore,
    applicationId: string,
): TreeRlTrainingBatch {
    assertApplicationDigest(applicationId, config.identity.applicationIdPrefix, "applicationId");
    const retained = readTreeRlRecords(store, applicationId);
    assert(retained.batch !== null, `application ${applicationId} retains no training batch`);
    const { baseline, batch } = batchesOf(retained.opened.body, retained.rollouts);
    return Object.freeze({
        ...batch,
        application_id: applicationId,
        baseline: baseline === null ? null : Object.freeze({ ...baseline, kind: SINGLE_ROLLOUT }),
    }) as TreeRlTrainingBatch;
}

/**
 * Reads one Tree-RL run as an immutable record-derived view without mutation.
 *
 * Every record on the application owner path is validated: the opened record and its selection,
 * each rollout record in fork-point, then branch order with its derived rollout and session
 * identities, the batch record whose digests re-derive from the rollouts, the manifest, and the
 * terminal cut. Inspection works on reopened, read-only, and imported stores and is identical
 * across them.
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
 * const inspection = inspectTreeRlRun(store, deriveApplicationOwnerId(commandId));
 * console.log(inspection.rollouts.filter((entry) => entry.record?.status === "failed").length);
 * ```
 */
export function inspectTreeRlRun(
    store: SQLiteTraceStore,
    applicationId: string,
): TreeRlRunInspection {
    assertApplicationDigest(applicationId, config.identity.applicationIdPrefix, "applicationId");
    const retained = readTreeRlRecords(store, applicationId);
    const opened = retained.opened.body;
    const manifest = retained.manifest;
    const batch = retained.batch;
    return Object.freeze({
        application_id: applicationId,
        baselines: opened.baselines,
        batch:
            batch === null
                ? null
                : Object.freeze({
                      baseline: batch.body.baseline,
                      batch_digest: batch.body.batch_digest,
                      format: batch.body.format,
                      line_count: batch.body.line_count,
                      record_id: batch.record_id,
                  }),
        command_id: opened.command_id,
        cut_id: manifest === null ? null : manifest.cut_id,
        fork_points: opened.fork_points,
        kind: opened.kind,
        manifest: manifest === null ? null : manifest.manifest,
        manifest_record_id: manifest === null ? null : manifest.record_id,
        opened_record_id: retained.opened.record_id,
        protocol_id: opened.protocol_id,
        rollouts: Object.freeze(
            retained.plans.map((plan, index) => {
                const entry = retained.rollouts[index];
                return Object.freeze({
                    ...plan,
                    record: entry === undefined ? null : toRecord(entry),
                });
            }),
        ),
        seeds: opened.seeds,
        source_session_id: opened.source_session_id,
    });
}

function receiptOf(
    store: SQLiteTraceStore,
    applicationId: string,
    manifest: TreeRlRunReceipt["manifest"],
): TreeRlRunReceipt {
    return Object.freeze({
        batch: exportTreeRlTrainingBatch(store, applicationId),
        inspection: inspectTreeRlRun(store, applicationId),
        manifest,
    });
}

async function settleRollout(run: Run, plan: TreeRlRolloutPlan, provider: ModelProvider) {
    const { source, store } = run;
    const stepIndex = plan.fork_point.step_index;
    if (store.readOwner(plan.replay_session_id).length === 0) {
        const projected = projectedCalls(source, stepIndex);
        if (run.spent + projected > run.protocol.providerCalls) {
            throw new ApplicationBudgetError(
                `${projected} projected live provider call(s) after ${run.spent} exceed ${treeRl.budgetKeys.providerCalls} ${run.protocol.providerCalls}`,
            );
        }
    }
    let session: ReplaySessionInspection;
    let failure: TreeRlFailure | null = null;
    try {
        session = (
            await replayReplaySession(store, {
                changes: [PROVIDER_CHANGE],
                claimId: run.claimId,
                ...run.clock,
                commandId: rolloutCommand(run.applicationId, plan),
                ...(run.handlers === undefined ? {} : { handlers: run.handlers as never }),
                program: run.program as never,
                provider,
                sourceSessionId: source.session_id,
                target: { stepCount: stepIndex },
            })
        ).inspection;
    } catch (error) {
        if (
            !(error instanceof ReplaySessionInterruptedError) ||
            error.classification === RUNNING_CLASSIFICATION ||
            error.session_id !== plan.replay_session_id
        ) {
            throw error;
        }
        session = inspectReplaySession(store, { sessionId: error.session_id, ...run.clock });
        failure = { code: config.errors.evidenceCode, reason: treeRl.reasons.interrupted };
    }
    const cost = measureReplaySessionCost(session);
    run.spent += cost.provider_calls;
    const terminal = session.terminal;
    if (failure === null && terminal?.status !== FINISHED_SESSION) {
        failure = { code: config.errors.evidenceCode, reason: treeRl.reasons.notFinished };
    }
    if (failure === null) {
        const analysis = analyzeReplayDivergence(store, {
            replaySessionId: session.session_id,
            sourceSessionId: source.session_id,
            ...run.clock,
        });
        if (
            analysis.unexplained.length > 0 ||
            (analysis.first_divergence_index ?? stepIndex) < stepIndex
        ) {
            failure = { code: config.errors.evidenceCode, reason: treeRl.reasons.diverged };
        }
    }
    let reward: number | null = null;
    if (failure === null) {
        try {
            const scored = await run.reward(
                Object.freeze({
                    branch: plan.branch,
                    cost,
                    fork_point: plan.fork_point,
                    protocol: run.protocol.definition,
                    rollout: session,
                    seed: plan.seed,
                    source,
                }),
            );
            if (typeof scored !== "number" || !Number.isFinite(scored)) {
                throw new TypeError("reward must be a finite number");
            }
            reward = scored;
        } catch {
            failure = { code: config.errors.verificationCode, reason: treeRl.reasons.rewardFailed };
        }
    }
    append(
        run,
        run.head,
        `${ROLLOUT_STEP}:${plan.rollout_id}`,
        {
            ...plan,
            application_id: run.applicationId,
            cost,
            failure,
            phase: ROLLOUT_PHASE,
            reward,
            status: failure === null ? COMPLETED : FAILED,
            step_count: terminal?.step_count ?? session.steps.length,
        },
        [session.head_record_id],
    );
}

function selectForkPoints(
    store: SQLiteTraceStore,
    source: ReplaySessionInspection,
    minDependents: number,
    maxForkPoints: number,
    clock: { readonly clock?: () => number },
): readonly TreeRlSelectedForkPoint[] {
    const selected: TreeRlSelectedForkPoint[] = [];
    for (const step of source.steps) {
        if (selected.length === maxForkPoints) {
            break;
        }
        if (step.kind !== PROVIDER_STEP) {
            continue;
        }
        const { dependents } = analyzeReplayDependencies(store, {
            sessionId: source.session_id,
            stepIndex: step.index,
            ...clock,
        });
        if (dependents.length >= minDependents) {
            selected.push(
                Object.freeze({
                    dependents: dependents.length,
                    prefix_id:
                        step.index === 0
                            ? null
                            : (source.steps[step.index - 1] as { readonly prefix_id: string })
                                  .prefix_id,
                    step_index: step.index,
                }),
            );
        }
    }
    return Object.freeze(selected);
}

function planRollouts(
    applicationId: string,
    forkPoints: readonly TreeRlForkPoint[],
    seeds: readonly number[],
): readonly TreeRlRolloutPlan[] {
    return Object.freeze(
        forkPoints.flatMap((point) =>
            seeds.map((seed, branch) => {
                const forkPoint = Object.freeze({
                    prefix_id: point.prefix_id,
                    step_index: point.step_index,
                });
                const plan = { branch, fork_point: forkPoint, rollout_id: "", seed };
                return Object.freeze({
                    ...plan,
                    replay_session_id: deriveReplaySessionId(rolloutCommand(applicationId, plan)),
                    rollout_id: prefixedApplicationId(config.identity.rolloutIdPrefix, {
                        application_id: applicationId,
                        fork_point: forkPoint,
                        seed,
                    }),
                });
            }),
        ),
    );
}

function rolloutCommand(
    applicationId: string,
    plan: Pick<TreeRlRolloutPlan, "fork_point" | "seed">,
): string {
    return createApplicationCommandId(applicationId, ROLLOUT_STEP, {
        seed: plan.seed,
        step_index: plan.fork_point.step_index,
    });
}

function readRolloutProvider(value: unknown, plan: TreeRlRolloutPlan): ModelProvider {
    const subject = `provider for rollout ${plan.fork_point.step_index}:${plan.seed}`;
    const provider = value as Partial<ModelProvider> | null;
    if (
        provider === null ||
        typeof provider !== "object" ||
        typeof provider.descriptor !== "function" ||
        typeof provider.invoke !== "function" ||
        provider.descriptor().kind !== providerProtocolConfig.static.kind
    ) {
        throw new TypeError(`${subject} must be a static provider`);
    }
    return provider as ModelProvider;
}

function batchesOf(
    opened: TreeRlOpenedBody,
    entries: readonly RetainedEntry<TreeRlRolloutBody>[],
): {
    readonly baseline: TreeRlBatchExport | null;
    readonly batch: TreeRlBatchExport;
} {
    const sessionId = opened.source_session_id;
    const rollouts = entries.map((entry) => entry.body);
    return {
        baseline: opened.baselines.includes(SINGLE_ROLLOUT)
            ? buildTreeRlBatch(
                  sessionId,
                  rollouts.filter((rollout) => rollout.branch === 0),
              )
            : null,
        batch: buildTreeRlBatch(sessionId, rollouts),
    };
}

function summaryOf(batch: TreeRlBatchSummary): TreeRlBatchSummary {
    return {
        batch_digest: batch.batch_digest,
        format: batch.format,
        line_count: batch.line_count,
    };
}

function buildManifest(run: Run, retained: RetainedRecords) {
    const roles = treeRl.artifactRoles;
    const source = run.source;
    const terminal = source.terminal as ReplayTerminalInspection;
    const artifacts: ApplicationArtifactSource[] = [
        {
            content: {
                prefix_id: terminal.prefix_id,
                session_id: source.session_id,
                status: terminal.status,
                step_count: terminal.step_count,
                terminal_record_id: terminal.record_id,
            },
            cut_id: null,
            record_id: terminal.record_id,
            role: roles.source,
        },
    ];
    let costs = ZERO_APPLICATION_COST;
    for (const entry of retained.rollouts) {
        artifacts.push({
            content: entry.body as unknown as SemanticValue,
            cut_id: null,
            record_id: entry.record_id,
            role: roles.rollout,
        });
        costs = addApplicationCosts(costs, entry.body.cost);
    }
    const batch = retained.batch as RetainedEntry<TreeRlBatchBody>;
    artifacts.push({
        content: summaryOf(batch.body),
        cut_id: null,
        record_id: batch.record_id,
        role: roles.batch,
    });
    if (batch.body.baseline !== null) {
        artifacts.push({
            content: batch.body.baseline as unknown as SemanticValue,
            cut_id: null,
            record_id: batch.record_id,
            role: roles.baselineBatch,
        });
    }
    return createApplicationManifest({
        applicationId: run.applicationId,
        artifacts,
        costs,
        protocol: run.protocol.definition,
    });
}

function append(
    run: Run,
    head: RecordId | null,
    step: string,
    fields: Readonly<Record<string, unknown>>,
    causes: readonly RecordId[],
): void {
    const appended = run.store.appendApplicationRecord(
        run.applicationId,
        head,
        createApplicationAppendRequest(
            createApplicationAppendIntentId(run.applicationId, step),
            run.applicationId,
            createVersionedApplicationBody(fields),
            config.traceSchemas.treeRlRollout,
            [...new Set([...(head === null ? [] : [head]), ...causes])],
        ),
        null,
    );
    if (appended.status === "head_moved") {
        throw new ApplicationEvidenceError(`application ${run.applicationId} head moved`);
    }
    run.head = appended.receipt.record_ids[0] as RecordId;
}

function readTreeRlRecords(store: SQLiteTraceStore, applicationId: string): RetainedRecords {
    const [first, ...rest] = store.readOwner(applicationId);
    assert(first !== undefined, `application ${applicationId} is not retained`);
    assertRecord(first, config.traceSchemas.treeRlRollout);
    const opened = readTreeRlOpenedBody(first.body);
    assert(
        opened.application_id === applicationId &&
            deriveApplicationOwnerId(opened.command_id) === applicationId,
        "opened record names another application",
    );
    const plans = planRollouts(applicationId, opened.fork_points, opened.seeds);
    const manifest = readRetainedManifest(store, applicationId);
    const rollouts: RetainedEntry<TreeRlRolloutBody>[] = [];
    let batch: RetainedEntry<TreeRlBatchBody> | null = null;
    let head = first.envelope.record_id;
    let manifestSeen = false;
    let terminal = false;
    for (const record of rest) {
        const schemaRef = record.envelope.schema_ref;
        assert(!terminal, "application retains a record after its terminal cut");
        assert(
            record.envelope.caused_by_record_ids[0] === head,
            "tree-rl record does not follow the application head",
        );
        if (schemaRef === config.traceSchemas.treeRlRollout && batch === null) {
            assertRecord(record, schemaRef);
            if (record.body.phase === BATCH_PHASE) {
                const body = readTreeRlBatchBody(record.body);
                const entry = Object.freeze({ body, record_id: record.envelope.record_id });
                const expected = batchesOf(opened, rollouts);
                assert(
                    body.application_id === applicationId &&
                        rollouts.length === plans.length &&
                        canonical(summaryOf(body)) === canonical(summaryOf(expected.batch)) &&
                        canonical(body.baseline) ===
                            canonical(
                                expected.baseline === null
                                    ? null
                                    : { ...summaryOf(expected.baseline), kind: SINGLE_ROLLOUT },
                            ),
                    "batch record does not re-derive from every rollout",
                );
                batch = entry;
            } else {
                const body = readTreeRlRolloutBody(record.body);
                const plan = plans[rollouts.length];
                assert(
                    plan !== undefined &&
                        body.application_id === applicationId &&
                        canonical(planOf(body)) === canonical(plan),
                    "rollout record is out of order or disagrees with its plan",
                );
                rollouts.push(Object.freeze({ body, record_id: record.envelope.record_id }));
            }
        } else if (schemaRef === config.traceSchemas.manifest) {
            assertRecord(record, schemaRef);
            assert(
                batch !== null &&
                    manifest !== null &&
                    manifest.record_id === record.envelope.record_id &&
                    manifest.manifest.protocol_id === opened.protocol_id &&
                    manifest.manifest.kind === TREE_RL_KIND,
                "manifest record does not follow the batch",
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
        batch,
        head,
        manifest,
        opened: Object.freeze({ body: opened, record_id: first.envelope.record_id }),
        plans,
        rollouts,
    });
}

function planOf(body: TreeRlRolloutBody): TreeRlRolloutPlan {
    return {
        branch: body.branch,
        fork_point: body.fork_point,
        replay_session_id: body.replay_session_id,
        rollout_id: body.rollout_id,
        seed: body.seed,
    };
}

function toRecord(entry: RetainedEntry<TreeRlRolloutBody>): TreeRlRolloutRecord {
    const {
        application_id: _application,
        application_version: _version,
        compatibility_version: _compatibility,
        phase: _phase,
        ...record
    } = entry.body as TreeRlRolloutBody & {
        readonly application_version: number;
        readonly compatibility_version: string;
    };
    return Object.freeze({ ...record, record_id: entry.record_id });
}

function projectedCalls(source: ReplaySessionInspection, from: number): number {
    return source.steps.filter((step) => step.index >= from && step.kind === PROVIDER_STEP).length;
}

function readTreeRlProtocol(value: unknown): TreeRlProtocol {
    const definition = readApplicationProtocol(value);
    if (definition.kind !== TREE_RL_KIND) {
        throw new ApplicationProtocolError(`kind must be ${TREE_RL_KIND}`);
    }
    const roles = treeRl.surfaceRoles;
    for (const [kind, role] of [
        [PROMPT_KIND, roles.rollout],
        [SCHEMA_KIND, roles.batch],
    ]) {
        if (
            !definition.surfaces.some((surface) => surface.kind === kind && surface.role === role)
        ) {
            throw new ApplicationProtocolError(`a ${kind} surface with role ${role} is required`);
        }
    }
    const keys = treeRl.budgetKeys;
    const [branches, forkPoints, minDependents, providerCalls] = [
        keys.branches,
        keys.forkPoints,
        keys.minDependents,
        keys.providerCalls,
    ].map((key) => definition.budgets[key]);
    if (
        branches === undefined ||
        forkPoints === undefined ||
        minDependents === undefined ||
        providerCalls === undefined
    ) {
        throw new ApplicationProtocolError(
            `budgets must declare ${keys.branches}, ${keys.forkPoints}, ${keys.minDependents}, and ${keys.providerCalls}`,
        );
    }
    if (branches === 0 || forkPoints === 0) {
        throw new ApplicationProtocolError(
            `${keys.branches} and ${keys.forkPoints} must be positive`,
        );
    }
    if (forkPoints > config.limits.maxForkPoints) {
        throw new ApplicationBudgetError(
            `${keys.forkPoints} ${forkPoints} exceeds the configured bound ${config.limits.maxForkPoints}`,
        );
    }
    if (branches > config.limits.maxBranches) {
        throw new ApplicationBudgetError(
            `${keys.branches} ${branches} exceeds the configured bound ${config.limits.maxBranches}`,
        );
    }
    if (branches > definition.seeds.length) {
        throw new ApplicationProtocolError(
            `${keys.branches} ${branches} exceeds the ${definition.seeds.length} declared seed(s)`,
        );
    }
    return { branches, definition, forkPoints, minDependents, providerCalls };
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
