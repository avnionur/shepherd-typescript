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
    APPLICATION_TREE_RL_LIMITS,
    APPLICATION_TREE_RL_MEMBER_KINDS,
    APPLICATION_TREE_RL_NORMALIZATIONS,
    APPLICATION_TREE_RL_PHASES,
    APPLICATION_TREE_RL_ROLLOUT_STATUSES,
    RECORD_MODES,
    REPLAY_CHANGE_DIMENSIONS,
    REPLAY_CHECKPOINT_CLASSIFICATIONS,
    REPLAY_RECOVERY_CLASSIFICATIONS,
    REPLAY_SOURCE_DISPOSITIONS,
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
import type {
    ReplayCheckpointInspection,
    ReplaySessionInspection,
    ReplayStepInspection,
    ReplayTarget,
    ReplayTerminalInspection,
} from "../replay/types.ts";
import { assertScopeText, readScopeDataObject } from "../scope/validation.ts";
import type { SQLiteTraceStore } from "../store/sqlite-trace-store.ts";
import type { OwnerRecord } from "../store/types.ts";
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
    readTreeRlForkProposal,
    readTreeRlOpenedBody,
    readTreeRlPrompts,
    readTreeRlRolloutBody,
    readTreeRlRootBody,
    resolveTreeRlForkTurn,
    type TreeRlBatchBody,
    type TreeRlOpenedBody,
    type TreeRlRolloutBody,
    type TreeRlRootBody,
    treeRlTurnBounds,
} from "./tree-rl-records.ts";
import type {
    MetaAgentTreeRlForkSelectorOptions,
    RunTreeRlRolloutsOptions,
    SelectTreeRlForkPointsOptions,
    TreeRlBatchExport,
    TreeRlBatchSummary,
    TreeRlBindingsFactory,
    TreeRlFailure,
    TreeRlForkDecision,
    TreeRlForkPoint,
    TreeRlForkSelector,
    TreeRlNormalization,
    TreeRlPrompt,
    TreeRlProviderContext,
    TreeRlProviderFactory,
    TreeRlRewardFunction,
    TreeRlRolloutPlan,
    TreeRlRolloutRecord,
    TreeRlRootRecord,
    TreeRlRunInspection,
    TreeRlRunReceipt,
    TreeRlSelectedForkPoint,
    TreeRlTrainerAdapter,
    TreeRlTrainingBatch,
    TreeRlTrainingLine,
    TreeRlTurn,
} from "./tree-rl-types.ts";
import type { ApplicationArtifactSource, ApplicationProtocolDefinition } from "./types.ts";

const config = applicationsProtocolConfig;
const treeRl = config.treeRl;
const [CAPTURE_MODE] = RECORD_MODES;
const [, , , TREE_RL_KIND] = APPLICATION_KINDS;
const [PROMPT_KIND, SCHEMA_KIND] = APPLICATION_PROTOCOL_SURFACES;
const [OPENED_PHASE, ROOT_PHASE, ROLLOUT_PHASE, BATCH_PHASE] = APPLICATION_TREE_RL_PHASES;
const [COMPLETED, FAILED] = APPLICATION_TREE_RL_ROLLOUT_STATUSES;
const [FLAT_GRPO] = APPLICATION_TREE_RL_BASELINE_KINDS;
const [ROOT_MEMBER, BRANCH_MEMBER] = APPLICATION_TREE_RL_MEMBER_KINDS;
const [, PROVIDER_CHANGE] = REPLAY_CHANGE_DIMENSIONS;
const [, RUNNING_CLASSIFICATION] = REPLAY_RECOVERY_CLASSIFICATIONS;
const [, RETAIN_SOURCE] = REPLAY_SOURCE_DISPOSITIONS;
const [FINISHED_SESSION] = REPLAY_TERMINAL_STATUSES;
const [PROVIDER_STEP] = REPLAY_STEP_KINDS;
const [, , UNAVAILABLE_CHECKPOINT] = REPLAY_CHECKPOINT_CLASSIFICATIONS;
const OPENED_STEP = "opened";
const ROOT_STEP = "root";
const ROLLOUT_STEP = "rollout";
const BATCH_STEP = "batch";

type TreeRlProtocol = {
    readonly batch: readonly ApplicationSchemaSurface[];
    readonly branches: number;
    readonly definition: ApplicationProtocolDefinition;
    readonly groupSize: number;
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
    readonly roots: readonly RetainedEntry<TreeRlRootBody>[];
};

/** One root of the batch with its prompt and inspection. */
type RootEntry = {
    readonly groupIndex: number;
    readonly prompt: TreeRlPrompt;
    readonly session: ReplaySessionInspection;
};

type Run = {
    readonly applicationId: string;
    readonly bindings: TreeRlBindingsFactory | null;
    readonly claimId: string;
    readonly clock: { readonly clock?: () => number };
    head: RecordId;
    readonly protocol: TreeRlProtocol;
    reserved: number;
    readonly reward: TreeRlRewardFunction;
    readonly roots: ReadonlyMap<string, RootEntry>;
    spent: number;
    readonly store: SQLiteTraceStore;
};

/**
 * Selects deterministic trace-selected fork points of one recorded replay session.
 *
 * For each provider step of the session, in index order, `analyzeReplayDependencies` gives its
 * transitive dependents; a step qualifies when its dependent count reaches `minDependents`, and
 * qualifying steps are taken in index order up to `maxForkPoints`. When the session binds worlds or
 * processes, a step qualifies only where the session retains a checkpoint at its boundary that is
 * not classified `unavailable`, since only such a boundary can be restored. Each fork point names
 * the step and the prefix identity at its boundary (null at step 0). The selection is a pure
 * function of the retained session and writes nothing.
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
    const source = inspectReplaySession(store, { sessionId: fields.sessionId, ...clock });
    const selected: TreeRlSelectedForkPoint[] = [];
    for (const step of source.steps) {
        if (selected.length === maxForkPoints) {
            break;
        }
        if (
            step.kind !== PROVIDER_STEP ||
            (bindsResources(source) && restorableCheckpoint(source, step.index) === null)
        ) {
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
                    ...forkPointOf(source, step.index),
                }),
            );
        }
    }
    return Object.freeze(selected);
}

/**
 * Creates the deterministic dependency-count fork selector: among the admissible restorable turns
 * of a root, it proposes the one whose provider step has the most transitive dependents in the
 * root's declared dependency graph (the earliest on ties), proposes no tool call, and gives the
 * configured `dependencySelection` reason. It reads only the root inspection in its context, so it
 * is a pure function of the retained root.
 *
 * @returns The fork selector.
 *
 * @example
 * ```ts
 * await runTreeRlRollouts(store, { ...options, selector: createDependencyTreeRlForkSelector() });
 * ```
 */
export function createDependencyTreeRlForkSelector(): TreeRlForkSelector {
    return (context) => {
        const { first, last } = context.turn_bounds;
        let best: { readonly dependents: number; readonly turn: number } | null = null;
        for (const turn of context.turns) {
            if (turn.turn < first || turn.turn > last || !turn.restorable) {
                continue;
            }
            const dependents = dependentCount(context.root.steps, turn.step_index);
            if (best === null || dependents > best.dependents) {
                best = { dependents, turn: turn.turn };
            }
        }
        return Object.freeze({
            branch_turn: best?.turn ?? first,
            reason: treeRl.reasons.dependencySelection,
            tool_call: null,
        });
    };
}

/**
 * Creates the provider-backed meta-agent fork selector of paper Appendix F.7.
 *
 * For each root it sends one structured request to `provider`: the instruction is the protocol's
 * `prompt` surface with the configured `fork_selector` role, the output schema is its `schema`
 * surface with the `fork_proposal` role, and the input is the root as a numbered turn list
 * (`{ turn, step_index, request: { instruction, input }, output }`) with the root's final reward,
 * the prompt identity, the turn count, and the admissible turn bounds. The response output must
 * satisfy every `fork_proposal` schema surface and the proposal grammar
 * `{ branch_turn, tool_call: { name, arguments } | null, reason }`. The run clamps the proposed
 * turn into `[1, T - 2]` (configured) and seeds the first branch with the tool call.
 *
 * @param options - Meta-agent provider and optional cancellation signal.
 * @returns The fork selector.
 * @throws {TypeError} If options are malformed.
 *
 * The returned selector throws {@link ApplicationProtocolError} when the protocol lacks the
 * `fork_selector` prompt or `fork_proposal` schema surface, and
 * {@link ApplicationVerificationError} when the provider output violates a proposal schema
 * surface or grammar; provider errors propagate.
 *
 * @example
 * ```ts
 * const selector = createMetaAgentTreeRlForkSelector({ provider: metaAgentProvider });
 * await runTreeRlRollouts(store, { ...options, selector });
 * ```
 */
export function createMetaAgentTreeRlForkSelector(
    options: MetaAgentTreeRlForkSelectorOptions,
): TreeRlForkSelector {
    const fields = readScopeDataObject(
        options,
        ["provider"],
        "createMetaAgentTreeRlForkSelector options",
        ["signal"],
    );
    const provider = fields.provider as Partial<ModelProvider> | null;
    if (
        provider === null ||
        typeof provider !== "object" ||
        typeof provider.invoke !== "function" ||
        typeof provider.descriptor !== "function"
    ) {
        throw new TypeError("provider must be a model provider");
    }
    if (fields.signal !== undefined && !(fields.signal instanceof AbortSignal)) {
        throw new TypeError("signal must be an AbortSignal");
    }
    const signal = (fields.signal as AbortSignal | undefined) ?? new AbortController().signal;
    const invoke = provider.invoke as ModelProvider["invoke"];
    return async (context) => {
        const roles = treeRl.surfaceRoles;
        const instruction = context.protocol.surfaces.find(
            (surface) => surface.kind === PROMPT_KIND && surface.role === roles.forkSelector,
        );
        const schema = context.protocol.surfaces.find(
            (surface) => surface.kind === SCHEMA_KIND && surface.role === roles.forkProposal,
        );
        if (
            instruction === undefined ||
            typeof instruction.content !== "string" ||
            schema === undefined
        ) {
            throw new ApplicationProtocolError(
                `the meta-agent selector requires a ${PROMPT_KIND} surface with role ${roles.forkSelector} and a ${SCHEMA_KIND} surface with role ${roles.forkProposal}`,
            );
        }
        const response = await invoke(
            {
                input: {
                    prompt_id: context.prompt_id,
                    reward: context.reward,
                    turn_bounds: { ...context.turn_bounds },
                    turn_count: context.turns.length,
                    turns: context.turns.map((turn) => ({
                        output: turn.output,
                        request: {
                            input: turn.request.input,
                            instruction: turn.request.instruction,
                        },
                        step_index: turn.step_index,
                        turn: turn.turn,
                    })),
                },
                instruction: instruction.content,
                outputSchema: schema.content as never,
            },
            signal,
        );
        try {
            assertApplicationMessage(
                compileApplicationSchemaSurfaces(context.protocol, roles.forkProposal),
                response.output,
                "fork proposal",
            );
            return readTreeRlForkProposal(response.output, "fork proposal");
        } catch (error) {
            throw new ApplicationVerificationError(
                `the meta-agent fork proposal for root ${context.root.session_id} is malformed`,
                { cause: error },
            );
        }
    };
}

/**
 * Runs Meta-Agent Guided Tree-RL (paper §5.3, Appendix F.6 Algorithm 2) over a batch of recorded
 * root rollouts and exports a per-action training batch.
 *
 * The batch is B `prompts`, each with its deterministic `program` and exactly the protocol's
 * `groupSize` G finished root sessions the caller recorded (Algorithm 2 part A, for example with
 * `runReplaySession`). Part B: every root is graded by `reward` (member `root`) and handed with its
 * reward and numbered turns (provider steps) to `selector`, whose proposed `branch_turn` is clamped
 * into the configured admissible range `[1, T - 2]` and, for a world- or process-bound root,
 * moved to the nearest turn whose boundary retains a restorable checkpoint. Each root's grading and
 * fork decision is retained as one `root` record. From the fork turn's step boundary the protocol's
 * branch count K of rollouts is replayed through `replayReplaySession` declaring the `provider`
 * change, branch `k` under the protocol's seed `k` and the static provider cassette `provider`
 * returns for it; the first branch of a root whose proposal named a tool call receives that call
 * in its provider context so its first live action carries it. `analyzeReplayDivergence` must show
 * no divergence before the fork step and none unexplained, and `reward` grades each finished,
 * proven rollout (member `branch`). Root gradings and branch rollouts run with up to `concurrency`
 * in flight; their records are appended in prompt, root, then branch order, so retained output
 * does not depend on concurrency. Part C: {@link computeTreeRlAdvantages} gives each completed
 * root its inter-root advantage and each completed member its intra-tree advantage under the
 * retained normalization, and the `jsonl_v2` batch attributes the inter-root advantage to every
 * prefix action (turns before the fork turn) and the member's intra-tree advantage to every suffix
 * action. With the `flat_grpo` baseline the batch record also retains the roots-only batch in which
 * every action carries the inter-root advantage. The manifest citing every root record, every
 * rollout record, the batch, and the baseline batch is retained last with the terminal cut.
 *
 * Every option, the protocol, every root, the bounds, and the projected provider calls (each root
 * assumed to fork at its earliest admissible turn unless its decision is retained) are validated
 * before any record is written, so a refusal writes nothing. Repeating the command resumes from
 * retained evidence: a retained root is not re-graded or re-selected, a terminal rollout session
 * is never re-executed, the reward function is not called for a retained record, and a completed
 * run returns its retained manifest and batch.
 *
 * @param store - Open writable trace store.
 * @param options - Command, claim, protocol, prompts, selector, provider factory, reward function,
 * and optional baselines, restoration bindings factory, concurrency, normalization, and clock.
 * @returns The retained manifest, the record-derived inspection, and the exported batch.
 * @throws {ApplicationProtocolError} If the protocol is malformed, is not a Tree-RL protocol, lacks
 * a required surface or budget, declares a zero branch or group size or fewer seeds than branches,
 * a prompt does not carry exactly `groupSize` roots, or the run was opened under another protocol
 * (nothing is written), or the `training_batch` schema surface refuses an exported line (records
 * stay retained; the batch record and manifest are not written).
 * @throws {ApplicationBudgetError} If the branch count exceeds `limits.maxBranches`, the group size
 * exceeds `APPLICATION_TREE_RL_LIMITS.maxGroupSize`, the prompts exceed `maxPrompts`, the
 * concurrency exceeds `maxConcurrency`, the planned rollouts exceed `limits.maxRollouts`, the cited
 * artifacts exceed `limits.maxArtifacts`, or the projected provider calls exceed the provider-call
 * budget; each new rollout session is also checked, counting in-flight projections, before it
 * opens.
 * @throws {ApplicationEvidenceError} If a root is not finished or has no turn, a world- or
 * process-bound root has no admissible restorable turn, the run was opened with different prompts,
 * baselines, or normalization, or retained evidence is inconsistent.
 * @throws {ReplayEvidenceError} If a root session is not retained or its evidence is invalid.
 * @throws {ReplayLeaseConflictError} If a rollout session is held by another writer.
 * @throws {ReplaySessionInterruptedError} If a rollout session is still `running` under a live
 * lease; nothing is written for it.
 * @throws {TraceStoreError} If the store is closed.
 * @throws {TypeError} If options are malformed, a world- or process-bound root has no `bindings`
 * factory, the selector returns a malformed proposal, or the provider factory returns a provider
 * that is not a distinct static provider. Errors thrown by the selector propagate after the root
 * records before it are retained.
 *
 * @example
 * ```ts
 * const { batch } = await runTreeRlRollouts(store, {
 *     claimId: "tree-rl",
 *     commandId: "application:tree-rl:1",
 *     prompts: [{ id: "task-1", program, roots: rootSessionIds }],
 *     protocol,
 *     provider: ({ root_session_id, seed, tool_call }) => cassetteFor(root_session_id, seed, tool_call),
 *     reward: ({ rollout }) => score(rollout.terminal?.result),
 *     selector: createMetaAgentTreeRlForkSelector({ provider: metaAgent }),
 * });
 * console.log(batch.batch_digest, batch.lines[0]?.actions);
 * ```
 */
export async function runTreeRlRollouts(
    store: SQLiteTraceStore,
    options: RunTreeRlRolloutsOptions,
): Promise<TreeRlRunReceipt> {
    const fields = readScopeDataObject(
        options,
        ["claimId", "commandId", "prompts", "protocol", "provider", "reward", "selector"],
        "runTreeRlRollouts options",
        ["baselines", "bindings", "clock", "concurrency", "normalization"],
    );
    assertScopeText(fields.commandId, "commandId");
    assertScopeText(fields.claimId, "claimId");
    const protocol = readTreeRlProtocol(fields.protocol);
    const protocolId = applicationProtocolId(protocol.definition);
    const baselines = readTreeRlBaselines(fields.baselines ?? []);
    const factory = readFunction(fields.provider, "provider") as TreeRlProviderFactory;
    const reward = readFunction(fields.reward, "reward") as TreeRlRewardFunction;
    const selector = readFunction(fields.selector, "selector") as TreeRlForkSelector;
    const bindings =
        fields.bindings === undefined
            ? null
            : (readFunction(fields.bindings, "bindings") as TreeRlBindingsFactory);
    const clock =
        fields.clock === undefined
            ? {}
            : { clock: readFunction(fields.clock, "clock") as () => number };
    const concurrency =
        fields.concurrency === undefined
            ? APPLICATION_TREE_RL_LIMITS.defaultConcurrency
            : readCount(fields.concurrency, "concurrency");
    if (concurrency === 0) {
        throw new TypeError("concurrency must be positive");
    }
    if (concurrency > APPLICATION_TREE_RL_LIMITS.maxConcurrency) {
        throw new ApplicationBudgetError(
            `concurrency ${concurrency} exceeds the configured bound ${APPLICATION_TREE_RL_LIMITS.maxConcurrency}`,
        );
    }
    const normalization = (fields.normalization ??
        treeRl.advantage.normalization) as TreeRlNormalization;
    if (!APPLICATION_TREE_RL_NORMALIZATIONS.includes(normalization)) {
        throw new TypeError("normalization must be a configured Tree-RL normalization");
    }
    const prompts = readPrompts(fields.prompts, protocol);
    const openedPrompts = prompts.map((prompt) => ({ id: prompt.id, roots: prompt.roots }));
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
                canonical(opened.prompts) === canonical(openedPrompts) &&
                canonical(opened.baselines) === canonical(baselines) &&
                opened.normalization === normalization,
            `application ${applicationId} was opened with different prompts, baselines, or normalization`,
        );
        if (retained.manifest !== null) {
            return receiptOf(store, applicationId, retained.manifest.manifest);
        }
    }
    const roots = new Map<string, RootEntry>();
    for (const prompt of prompts) {
        for (const [groupIndex, sessionId] of prompt.roots.entries()) {
            const session = inspectReplaySession(store, { sessionId, ...clock });
            if (session.terminal?.status !== FINISHED_SESSION) {
                throw new ApplicationEvidenceError(`root session ${sessionId} did not finish`);
            }
            const turns = turnsOf(session);
            if (turns.length === 0) {
                throw new ApplicationEvidenceError(`root session ${sessionId} has no turn`);
            }
            if (bindsResources(session) && bindings === null) {
                throw new TypeError("bindings is required when a root binds worlds or processes");
            }
            if (
                resolveTreeRlForkTurn(
                    treeRl.forkTurn.first,
                    turns.length,
                    (turn) => (turns[turn - 1] as TreeRlTurn).restorable,
                ) === null
            ) {
                throw new ApplicationEvidenceError(
                    `root session ${sessionId} has no admissible restorable fork turn`,
                );
            }
            roots.set(sessionId, { groupIndex, prompt, session });
        }
    }
    const seeds = protocol.definition.seeds.slice(0, protocol.branches);
    const rollouts = roots.size * seeds.length;
    if (rollouts > config.limits.maxRollouts) {
        throw new ApplicationBudgetError(
            `${rollouts} planned rollouts exceed the configured bound ${config.limits.maxRollouts}`,
        );
    }
    if (rollouts + roots.size + 2 > config.limits.maxArtifacts) {
        throw new ApplicationBudgetError(
            `${rollouts + roots.size + 2} cited artifacts exceed the configured bound ${config.limits.maxArtifacts}`,
        );
    }
    let projected = 0;
    for (const [index, entry] of [...roots.values()].entries()) {
        const decided = retained?.roots[index]?.body.fork.fork_point.step_index;
        const turns = turnsOf(entry.session);
        const earliest = resolveTreeRlForkTurn(
            treeRl.forkTurn.first,
            turns.length,
            (turn) => (turns[turn - 1] as TreeRlTurn).restorable,
        ) as number;
        const stepIndex = decided ?? (turns[earliest - 1] as TreeRlTurn).step_index;
        for (let branch = 0; branch < seeds.length; branch += 1) {
            projected +=
                retained?.rollouts[index * seeds.length + branch]?.body.cost.provider_calls ??
                projectedCalls(entry.session, stepIndex);
        }
    }
    if (projected > protocol.providerCalls) {
        throw new ApplicationBudgetError(
            `${projected} projected live provider call(s) exceed ${treeRl.budgetKeys.providerCalls} ${protocol.providerCalls}`,
        );
    }
    const run: Run = {
        applicationId,
        bindings,
        claimId: fields.claimId,
        clock,
        head: "" as RecordId,
        protocol,
        reserved: 0,
        reward,
        roots,
        spent: 0,
        store,
    };
    if (retained === null) {
        append(run, null, OPENED_STEP, {
            application_id: applicationId,
            baselines,
            command_id: fields.commandId,
            kind: TREE_RL_KIND,
            normalization,
            phase: OPENED_PHASE,
            prompts: openedPrompts,
            protocol_id: protocolId,
            seeds,
        });
    } else {
        run.head = retained.head;
    }
    const entries = [...roots.values()];
    const retainedRoots = retained?.roots.length ?? 0;
    await settleInOrder(
        entries.length - retainedRoots,
        concurrency,
        (index) => settleRoot(run, entries[retainedRoots + index] as RootEntry, selector),
        (_index, body) =>
            append(run, run.head, `${ROOT_STEP}:${body.root_session_id}`, body, [
                (
                    (roots.get(body.root_session_id) as RootEntry).session
                        .terminal as ReplayTerminalInspection
                ).record_id,
            ]),
    );
    const rooted = readTreeRlRecords(store, applicationId);
    const pending = rooted.plans.slice(rooted.rollouts.length);
    run.spent = rooted.rollouts.reduce((total, entry) => total + entry.body.cost.provider_calls, 0);
    const toolCalls = new Map(
        rooted.roots.map((entry) => [entry.body.root_session_id, entry.body.fork.tool_call]),
    );
    const contexts = pending.map((plan) => providerContext(plan, toolCalls));
    const providers = contexts.map((context) => readRolloutProvider(factory(context), context));
    if (new Set(providers).size !== providers.length) {
        throw new TypeError("provider must return a distinct provider for every rollout");
    }
    await settleInOrder(
        pending.length,
        concurrency,
        (index) =>
            settleRollout(
                run,
                pending[index] as TreeRlRolloutPlan,
                contexts[index] as TreeRlProviderContext,
                providers[index] as ModelProvider,
            ),
        (_index, settled) =>
            append(run, run.head, `${ROLLOUT_STEP}:${settled.body.rollout_id}`, settled.body, [
                settled.head,
            ]),
    );
    const settled = readTreeRlRecords(store, applicationId);
    if (settled.batch === null) {
        const batches = batchesOf(settled);
        assertBatchLines(run.protocol, applicationId, [
            ...batches.batch.lines,
            ...(batches.baseline?.lines ?? []),
        ]);
        append(run, run.head, BATCH_STEP, {
            application_id: applicationId,
            baseline:
                batches.baseline === null
                    ? null
                    : { ...summaryOf(batches.baseline), kind: FLAT_GRPO },
            ...summaryOf(batches.batch),
            phase: BATCH_PHASE,
        });
    }
    const receipt = retainApplicationManifest(store, {
        manifest: buildManifest(run, readTreeRlRecords(store, applicationId)),
    });
    return receiptOf(store, applicationId, receipt.manifest);
}

/**
 * Exports the retained training batch of one Tree-RL run without mutation.
 *
 * The canonical `jsonl_v2` lines are re-derived from the retained root and rollout records: one
 * line per completed tree member in prompt, root, then member (root first, then branches) order,
 * carrying its prompt, root, member session, fork turn and point, seed, whether the proposed tool
 * call seeded it, reward, inter-root and intra-tree advantages, and the per-action attribution
 * (`prefix` actions carry the inter-root advantage, `suffix` actions the member's intra-tree
 * advantage; the flat baseline marks every action `flat` with the inter-root advantage). The text
 * is the canonical JSON of each line followed by a line feed, and its digest must equal the
 * retained batch digest. Export works on reopened, read-only, and imported stores and yields an
 * identical digest.
 *
 * @param store - Open trace store, writable or read-only.
 * @param applicationId - Application identity derived by {@link deriveApplicationOwnerId}.
 * @returns The batch lines, text, digest, normalization, and the optional flat GRPO baseline batch.
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
    const { baseline, batch } = batchesOf(retained);
    return Object.freeze({
        ...batch,
        application_id: applicationId,
        baseline: baseline === null ? null : Object.freeze({ ...baseline, kind: FLAT_GRPO }),
        normalization: retained.opened.body.normalization,
    }) as TreeRlTrainingBatch;
}

/**
 * Hands the retained training batch of one Tree-RL run to a trainer-export adapter.
 *
 * The batch is exported with {@link exportTreeRlTrainingBatch} (so its digest equals the retained
 * one) and passed to `adapter.submit` when the adapter accepts its format. Nothing is written; the
 * adapter's result is returned unchanged. No trainer ships with this package: the adapter is the
 * seam a trainer integration implements.
 *
 * @param store - Open trace store, writable or read-only.
 * @param applicationId - Application identity derived by {@link deriveApplicationOwnerId}.
 * @param adapter - Trainer-export adapter.
 * @returns The adapter's result.
 * @throws {ApplicationProtocolError} If the adapter does not accept the batch format.
 * @throws {ApplicationEvidenceError} If the batch is not retained or does not re-derive.
 * @throws {TypeError} If the adapter or application identity is malformed.
 * @throws Errors thrown by `adapter.submit` propagate.
 *
 * @example
 * ```ts
 * const jobId = await exportTreeRlBatchToTrainer(store, applicationId, {
 *     formats: ["jsonl_v2"],
 *     id: "my-trainer",
 *     submit: (batch) => trainer.enqueue(batch.text),
 * });
 * ```
 */
export async function exportTreeRlBatchToTrainer<TResult>(
    store: SQLiteTraceStore,
    applicationId: string,
    adapter: TreeRlTrainerAdapter<TResult>,
): Promise<TResult> {
    const fields = readScopeDataObject(adapter, ["formats", "id", "submit"], "trainer adapter");
    assertScopeText(fields.id, "trainer adapter id");
    const submit = readFunction(
        fields.submit,
        "trainer adapter submit",
    ) as TreeRlTrainerAdapter<TResult>["submit"];
    if (!Array.isArray(fields.formats)) {
        throw new TypeError("trainer adapter formats must be an array");
    }
    const batch = exportTreeRlTrainingBatch(store, applicationId);
    if (!fields.formats.includes(batch.format)) {
        throw new ApplicationProtocolError(
            `trainer adapter ${fields.id} does not accept the ${batch.format} batch format`,
        );
    }
    return await submit(batch);
}

/**
 * Reads one Tree-RL run as an immutable record-derived view without mutation.
 *
 * Every record on the application owner path is validated: the opened record and its prompts, each
 * root record in prompt then root order with its fork decision, each rollout record in plan order
 * with its derived rollout and session identities, the batch record whose digests re-derive from
 * the records, the manifest, and the terminal cut. Inspection works on reopened, read-only, and
 * imported stores and is identical across them.
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
 * console.log(inspection.roots.map((root) => root.fork.branch_turn));
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
        kind: opened.kind,
        manifest: manifest === null ? null : manifest.manifest,
        manifest_record_id: manifest === null ? null : manifest.record_id,
        normalization: opened.normalization,
        opened_record_id: retained.opened.record_id,
        prompts: opened.prompts,
        protocol_id: opened.protocol_id,
        rollouts: Object.freeze(
            retained.plans.map((plan, index) => {
                const entry = retained.rollouts[index];
                return Object.freeze({
                    ...plan,
                    record: entry === undefined ? null : (toRecord(entry) as TreeRlRolloutRecord),
                });
            }),
        ),
        roots: Object.freeze(retained.roots.map((entry) => toRecord(entry) as TreeRlRootRecord)),
        seeds: opened.seeds,
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

/**
 * Runs `work` for indices `0..count-1` with at most `concurrency` in flight and commits each
 * result in index order as soon as every earlier one has been committed. After the first failure
 * no new work starts; the in-flight work settles, the contiguous committed prefix stays, and the
 * first error is rethrown.
 */
async function settleInOrder<T>(
    count: number,
    concurrency: number,
    work: (index: number) => Promise<T>,
    commit: (index: number, value: T) => void,
): Promise<void> {
    const results = new Map<number, T>();
    let next = 0;
    let committed = 0;
    type Failure = { readonly error: unknown; readonly index: number };
    const state: { failure: Failure | null } = { failure: null };
    const flush = () => {
        while (results.has(committed)) {
            commit(committed, results.get(committed) as T);
            results.delete(committed);
            committed += 1;
        }
    };
    const worker = async () => {
        while (state.failure === null && next < count) {
            const index = next;
            next += 1;
            try {
                results.set(index, await work(index));
                flush();
            } catch (error) {
                const current = state.failure as Failure | null;
                if (current === null || index < current.index) {
                    state.failure = { error, index };
                }
            }
        }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, count) }, worker));
    if (state.failure !== null) {
        throw state.failure.error;
    }
}

async function settleRoot(
    run: Run,
    entry: RootEntry,
    selector: TreeRlForkSelector,
): Promise<Readonly<Record<string, unknown>> & { readonly root_session_id: string }> {
    const { session } = entry;
    const cost = measureReplaySessionCost(session);
    let reward: number | null = null;
    let failure: TreeRlFailure | null = null;
    try {
        reward = await grade(run, {
            branch: null,
            cost,
            fork_point: null,
            group_index: entry.groupIndex,
            member: ROOT_MEMBER,
            prompt_id: entry.prompt.id,
            protocol: run.protocol.definition,
            root: session,
            rollout: session,
            seed: null,
        });
    } catch {
        failure = { code: config.errors.verificationCode, reason: treeRl.reasons.rewardFailed };
    }
    const turns = turnsOf(session);
    const bounds = treeRlTurnBounds(turns.length);
    const proposal = readTreeRlForkProposal(
        await selector(
            Object.freeze({
                group_index: entry.groupIndex,
                prompt_id: entry.prompt.id,
                protocol: run.protocol.definition,
                reward,
                root: session,
                turn_bounds: bounds,
                turns,
            }),
        ),
        `fork proposal for root ${session.session_id}`,
    );
    const branchTurn = resolveTreeRlForkTurn(
        proposal.branch_turn,
        turns.length,
        (turn) => (turns[turn - 1] as TreeRlTurn).restorable,
    ) as number;
    const fork: TreeRlForkDecision = {
        branch_turn: branchTurn,
        fork_point: forkPointOf(session, (turns[branchTurn - 1] as TreeRlTurn).step_index),
        proposed_turn: proposal.branch_turn,
        reason: proposal.reason,
        tool_call: proposal.tool_call,
    };
    return {
        application_id: run.applicationId,
        cost,
        failure,
        fork,
        group_index: entry.groupIndex,
        phase: ROOT_PHASE,
        prompt_id: entry.prompt.id,
        reward,
        root_session_id: session.session_id,
        status: failure === null ? COMPLETED : FAILED,
        step_count: (session.terminal as ReplayTerminalInspection).step_count,
        turns: turns.map((turn) => turn.step_index),
    };
}

async function grade(run: Run, context: Parameters<TreeRlRewardFunction>[0]): Promise<number> {
    const scored = await run.reward(Object.freeze(context));
    if (typeof scored !== "number" || !Number.isFinite(scored)) {
        throw new TypeError("reward must be a finite number");
    }
    return scored;
}

async function settleRollout(
    run: Run,
    plan: TreeRlRolloutPlan,
    context: TreeRlProviderContext,
    provider: ModelProvider,
): Promise<{
    readonly body: Readonly<Record<string, unknown>> & { readonly rollout_id: string };
    readonly head: RecordId;
}> {
    const { store } = run;
    const entry = run.roots.get(plan.root_session_id) as RootEntry;
    const root = entry.session;
    const stepIndex = plan.fork_point.step_index;
    let reservation = 0;
    if (store.readOwner(plan.replay_session_id).length === 0) {
        const projected = projectedCalls(root, stepIndex);
        if (run.spent + run.reserved + projected > run.protocol.providerCalls) {
            throw new ApplicationBudgetError(
                `${projected} projected live provider call(s) after ${run.spent + run.reserved} exceed ${treeRl.budgetKeys.providerCalls} ${run.protocol.providerCalls}`,
            );
        }
        reservation = projected;
        run.reserved += reservation;
    }
    let session: ReplaySessionInspection;
    let failure: TreeRlFailure | null = null;
    try {
        const checkpoint = restorableCheckpoint(root, stepIndex);
        const target: ReplayTarget =
            checkpoint === null
                ? { stepCount: stepIndex }
                : { checkpointId: checkpoint.checkpoint_id };
        const restoration =
            run.bindings === null
                ? {}
                : readScopeDataObject(
                      await run.bindings(context),
                      [],
                      `bindings for rollout ${plan.rollout_id}`,
                      ["handlers", "processes", "worlds"],
                  );
        const handlers = restoration.handlers ?? entry.prompt.handlers;
        try {
            session = (
                await replayReplaySession(store, {
                    changes: [PROVIDER_CHANGE],
                    claimId: run.claimId,
                    ...run.clock,
                    commandId: rolloutCommand(run.applicationId, plan),
                    ...(handlers === undefined ? {} : { handlers: handlers as never }),
                    ...(restoration.processes === undefined
                        ? {}
                        : { processes: restoration.processes as never }),
                    ...(restoration.worlds === undefined
                        ? {}
                        : { worlds: restoration.worlds as never }),
                    program: entry.prompt.program,
                    provider,
                    // Sibling rollouts branch from the same retained root: none abandons it.
                    sourceDisposition: RETAIN_SOURCE,
                    sourceSessionId: root.session_id,
                    target,
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
    } finally {
        run.reserved -= reservation;
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
            sourceSessionId: root.session_id,
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
            reward = await grade(run, {
                branch: plan.branch,
                cost,
                fork_point: plan.fork_point,
                group_index: plan.group_index,
                member: BRANCH_MEMBER,
                prompt_id: plan.prompt_id,
                protocol: run.protocol.definition,
                root,
                rollout: session,
                seed: plan.seed,
            });
        } catch {
            failure = { code: config.errors.verificationCode, reason: treeRl.reasons.rewardFailed };
        }
    }
    return {
        body: {
            ...plan,
            application_id: run.applicationId,
            cost,
            failure,
            phase: ROLLOUT_PHASE,
            reward,
            status: failure === null ? COMPLETED : FAILED,
            step_count: terminal?.step_count ?? session.steps.length,
            turns: session.steps
                .filter((step) => step.kind === PROVIDER_STEP)
                .map((step) => step.index),
        },
        head: session.head_record_id,
    };
}

/** Every provider step of a session as a numbered turn, with its boundary restorability. */
function turnsOf(session: ReplaySessionInspection): readonly TreeRlTurn[] {
    return Object.freeze(
        session.steps
            .filter((step) => step.kind === PROVIDER_STEP)
            .map((step, index) =>
                Object.freeze({
                    output: step.provider?.response?.output ?? null,
                    request: step.provider?.request as TreeRlTurn["request"],
                    restorable:
                        !bindsResources(session) ||
                        restorableCheckpoint(session, step.index) !== null,
                    step_index: step.index,
                    turn: index + 1,
                }),
            ),
    );
}

/** Number of transitive dependents of one step in a session's declared dependency graph. */
function dependentCount(steps: readonly ReplayStepInspection[], stepIndex: number): number {
    const affected = new Set([stepIndex]);
    for (const step of steps.slice(stepIndex + 1)) {
        if (step.depends_on.some((dependency) => affected.has(dependency))) {
            affected.add(step.index);
        }
    }
    return affected.size - 1;
}

function forkPointOf(session: ReplaySessionInspection, stepIndex: number): TreeRlForkPoint {
    return Object.freeze({
        prefix_id:
            stepIndex === 0
                ? null
                : (session.steps[stepIndex - 1] as { readonly prefix_id: string }).prefix_id,
        step_index: stepIndex,
    });
}

function bindsResources(session: ReplaySessionInspection): boolean {
    return session.worlds.length > 0 || session.processes.length > 0;
}

/**
 * Returns the checkpoint a world- or process-bound session retains at `stepCount` when it can be
 * restored, and null for a session that binds neither (its step boundaries are admissible targets).
 */
function restorableCheckpoint(
    session: ReplaySessionInspection,
    stepCount: number,
): ReplayCheckpointInspection | null {
    if (!bindsResources(session)) {
        return null;
    }
    return (
        session.checkpoints.find(
            (checkpoint) =>
                checkpoint.step_count === stepCount &&
                checkpoint.classification !== UNAVAILABLE_CHECKPOINT,
        ) ?? null
    );
}

function planRollouts(
    applicationId: string,
    roots: readonly RetainedEntry<TreeRlRootBody>[],
    seeds: readonly number[],
): readonly TreeRlRolloutPlan[] {
    return Object.freeze(
        roots.flatMap(({ body }) =>
            seeds.map((seed, branch) => {
                const forkPoint = Object.freeze({ ...body.fork.fork_point });
                const identity = {
                    branch,
                    branch_turn: body.fork.branch_turn,
                    fork_point: forkPoint,
                    group_index: body.group_index,
                    prompt_id: body.prompt_id,
                    root_session_id: body.root_session_id,
                    seed,
                    seeded: branch === 0 && body.fork.tool_call !== null,
                };
                return Object.freeze({
                    ...identity,
                    replay_session_id: deriveReplaySessionId(
                        rolloutCommand(applicationId, identity),
                    ),
                    rollout_id: prefixedApplicationId(config.identity.rolloutIdPrefix, {
                        application_id: applicationId,
                        fork_point: forkPoint,
                        root_session_id: body.root_session_id,
                        seed,
                    }),
                });
            }),
        ),
    );
}

function rolloutCommand(
    applicationId: string,
    plan: Pick<TreeRlRolloutPlan, "fork_point" | "root_session_id" | "seed">,
): string {
    return createApplicationCommandId(applicationId, ROLLOUT_STEP, {
        root_session_id: plan.root_session_id,
        seed: plan.seed,
        step_index: plan.fork_point.step_index,
    });
}

function providerContext(
    plan: TreeRlRolloutPlan,
    toolCalls: ReadonlyMap<string, TreeRlForkDecision["tool_call"]>,
): TreeRlProviderContext {
    return Object.freeze({
        branch: plan.branch,
        branch_turn: plan.branch_turn,
        fork_point: plan.fork_point,
        group_index: plan.group_index,
        prompt_id: plan.prompt_id,
        root_session_id: plan.root_session_id,
        seed: plan.seed,
        // A seeded plan is derived from a retained root whose fork decision carries the tool call.
        tool_call: plan.seeded
            ? (toolCalls.get(plan.root_session_id) as TreeRlForkDecision["tool_call"])
            : null,
    });
}

function readRolloutProvider(value: unknown, context: TreeRlProviderContext): ModelProvider {
    const subject = `provider for rollout ${context.root_session_id}:${context.seed}`;
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

function readPrompts(value: unknown, protocol: TreeRlProtocol): readonly TreeRlPrompt[] {
    const entries = Array.isArray(value)
        ? value.map((entry, index) => {
              const fields = readScopeDataObject(
                  entry,
                  ["id", "program", "roots"],
                  `prompts[${index}]`,
                  ["handlers"],
              );
              readFunction(fields.program, `prompts[${index}].program`);
              return fields;
          })
        : value;
    const data = readTreeRlPrompts(
        Array.isArray(entries)
            ? entries.map((entry) => ({ id: entry.id, roots: entry.roots }))
            : entries,
        "prompts",
    );
    if ((data[0] as { readonly roots: readonly string[] }).roots.length !== protocol.groupSize) {
        throw new ApplicationProtocolError(
            `${treeRl.budgetKeys.groupSize} ${protocol.groupSize} requires exactly ${protocol.groupSize} root(s) per prompt`,
        );
    }
    return Object.freeze(
        data.map((prompt, index) => {
            const fields = (entries as Record<string, unknown>[])[index] as Record<string, unknown>;
            return Object.freeze({
                ...(fields.handlers === undefined
                    ? {}
                    : { handlers: fields.handlers as NonNullable<TreeRlPrompt["handlers"]> }),
                id: prompt.id,
                program: fields.program as TreeRlPrompt["program"],
                roots: prompt.roots,
            });
        }),
    );
}

function batchesOf(retained: RetainedRecords): {
    readonly baseline: TreeRlBatchExport | null;
    readonly batch: TreeRlBatchExport;
} {
    const opened = retained.opened.body;
    const roots = retained.roots.map((entry) => entry.body);
    const rollouts = retained.rollouts.map((entry) => entry.body);
    return {
        baseline: opened.baselines.includes(FLAT_GRPO)
            ? buildTreeRlBatch(opened, roots, [], true)
            : null,
        batch: buildTreeRlBatch(opened, roots, rollouts, false),
    };
}

/**
 * Validates every exported line against the protocol's training-batch schema surfaces before the
 * batch record is retained. A line the pinned schema refuses is a protocol mismatch.
 */
function assertBatchLines(
    protocol: TreeRlProtocol,
    applicationId: string,
    lines: readonly TreeRlTrainingLine[],
): void {
    try {
        for (const [index, line] of lines.entries()) {
            assertApplicationMessage(
                protocol.batch,
                line as unknown as SemanticValue,
                `training batch line ${index}`,
            );
        }
    } catch (error) {
        throw new ApplicationProtocolError(
            `training batch of application ${applicationId} is not admitted by the protocol batch schema`,
            { cause: error },
        );
    }
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
    const artifacts: ApplicationArtifactSource[] = [];
    let costs = ZERO_APPLICATION_COST;
    for (const [role, entries] of [
        [roles.root, retained.roots],
        [roles.rollout, retained.rollouts],
    ] as const) {
        for (const entry of entries) {
            artifacts.push({
                content: entry.body as unknown as SemanticValue,
                cut_id: null,
                record_id: entry.record_id,
                role,
            });
            costs = addApplicationCosts(costs, entry.body.cost);
        }
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
    causes: readonly RecordId[] = [],
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
    const expectedRoots = opened.prompts.flatMap((prompt) =>
        prompt.roots.map((root, groupIndex) => ({ groupIndex, promptId: prompt.id, root })),
    );
    const manifest = readRetainedManifest(store, applicationId);
    const roots: RetainedEntry<TreeRlRootBody>[] = [];
    const rollouts: RetainedEntry<TreeRlRolloutBody>[] = [];
    let plans: readonly TreeRlRolloutPlan[] = [];
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
            const entry = { record_id: record.envelope.record_id };
            if (record.body.phase === ROOT_PHASE) {
                const body = readTreeRlRootBody(record.body);
                const expected = expectedRoots[roots.length];
                assert(
                    expected !== undefined &&
                        rollouts.length === 0 &&
                        body.application_id === applicationId &&
                        body.prompt_id === expected.promptId &&
                        body.group_index === expected.groupIndex &&
                        body.root_session_id === expected.root,
                    "root record is out of order or names another root",
                );
                roots.push(Object.freeze({ ...entry, body }));
                if (roots.length === expectedRoots.length) {
                    plans = planRollouts(applicationId, roots, opened.seeds);
                }
            } else if (record.body.phase === BATCH_PHASE) {
                const body = readTreeRlBatchBody(record.body);
                const expected = batchesOf({
                    batch: null,
                    head,
                    manifest: null,
                    opened: Object.freeze({ body: opened, record_id: first.envelope.record_id }),
                    plans,
                    rollouts,
                    roots,
                });
                assert(
                    body.application_id === applicationId &&
                        roots.length === expectedRoots.length &&
                        rollouts.length === plans.length &&
                        canonical(summaryOf(body)) === canonical(summaryOf(expected.batch)) &&
                        canonical(body.baseline) ===
                            canonical(
                                expected.baseline === null
                                    ? null
                                    : { ...summaryOf(expected.baseline), kind: FLAT_GRPO },
                            ),
                    "batch record does not re-derive from every root and rollout",
                );
                batch = Object.freeze({ ...entry, body });
            } else {
                const body = readTreeRlRolloutBody(record.body);
                const plan = plans[rollouts.length];
                assert(
                    plan !== undefined &&
                        body.application_id === applicationId &&
                        canonical(planOf(body)) === canonical(plan),
                    "rollout record is out of order or disagrees with its plan",
                );
                rollouts.push(Object.freeze({ ...entry, body }));
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
        roots,
    });
}

function planOf(body: TreeRlRolloutBody): TreeRlRolloutPlan {
    return {
        branch: body.branch,
        branch_turn: body.branch_turn,
        fork_point: body.fork_point,
        group_index: body.group_index,
        prompt_id: body.prompt_id,
        replay_session_id: body.replay_session_id,
        rollout_id: body.rollout_id,
        root_session_id: body.root_session_id,
        seed: body.seed,
        seeded: body.seeded,
    };
}

function toRecord(
    entry: RetainedEntry<TreeRlRolloutBody> | RetainedEntry<TreeRlRootBody>,
): TreeRlRolloutRecord | TreeRlRootRecord {
    const {
        application_id: _application,
        application_version: _version,
        compatibility_version: _compatibility,
        phase: _phase,
        ...record
    } = entry.body as (TreeRlRolloutBody | TreeRlRootBody) & {
        readonly application_version: number;
        readonly compatibility_version: string;
    };
    return Object.freeze({ ...record, record_id: entry.record_id }) as
        | TreeRlRolloutRecord
        | TreeRlRootRecord;
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
    const [branches, groupSize, providerCalls] = [
        keys.branches,
        keys.groupSize,
        keys.providerCalls,
    ].map((key) => definition.budgets[key]);
    if (branches === undefined || groupSize === undefined || providerCalls === undefined) {
        throw new ApplicationProtocolError(
            `budgets must declare ${keys.branches}, ${keys.groupSize}, and ${keys.providerCalls}`,
        );
    }
    if (branches === 0 || groupSize === 0) {
        throw new ApplicationProtocolError(
            `${keys.branches} and ${keys.groupSize} must be positive`,
        );
    }
    if (branches > config.limits.maxBranches) {
        throw new ApplicationBudgetError(
            `${keys.branches} ${branches} exceeds the configured bound ${config.limits.maxBranches}`,
        );
    }
    if (groupSize > APPLICATION_TREE_RL_LIMITS.maxGroupSize) {
        throw new ApplicationBudgetError(
            `${keys.groupSize} ${groupSize} exceeds the configured bound ${APPLICATION_TREE_RL_LIMITS.maxGroupSize}`,
        );
    }
    if (branches > definition.seeds.length) {
        throw new ApplicationProtocolError(
            `${keys.branches} ${branches} exceeds the ${definition.seeds.length} declared seed(s)`,
        );
    }
    return {
        batch: compileApplicationSchemaSurfaces(definition, roles.batch),
        branches,
        definition,
        groupSize,
        providerCalls,
    };
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
