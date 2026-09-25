import { createHash } from "node:crypto";

import { canonicalizeSemanticValue, type SemanticValue } from "../canonical/canonical-record.ts";
import { applicationsProtocolConfig, replayProtocolConfig } from "../protocol/config.ts";
import {
    APPLICATION_KINDS,
    APPLICATION_TREE_RL_ACTION_SEGMENTS,
    APPLICATION_TREE_RL_BASELINE_KINDS,
    APPLICATION_TREE_RL_BATCH_FORMATS,
    APPLICATION_TREE_RL_LIMITS,
    APPLICATION_TREE_RL_MEMBER_KINDS,
    APPLICATION_TREE_RL_NORMALIZATIONS,
    APPLICATION_TREE_RL_PHASES,
    APPLICATION_TREE_RL_ROLLOUT_STATUSES,
} from "../protocol/values.generated.ts";
import type { RecordBody } from "../record/types.ts";
import {
    assertPrefixedDigest,
    assertScopeText,
    readScopeArray,
    readScopeDataObject,
} from "../scope/validation.ts";
import {
    assertApplicationDigest,
    assertPlainDigest,
    decodeApplicationBody,
    readApplicationCosts,
    readApplicationReason,
    readCount,
    readVersionedBody,
} from "./records.ts";
import type {
    TreeRlActionAdvantage,
    TreeRlAdvantage,
    TreeRlAdvantageTree,
    TreeRlBaselineKind,
    TreeRlBatchExport,
    TreeRlBatchFormat,
    TreeRlBatchSummary,
    TreeRlFailure,
    TreeRlForkDecision,
    TreeRlForkPoint,
    TreeRlForkProposal,
    TreeRlNormalization,
    TreeRlRolloutRecord,
    TreeRlRootRecord,
    TreeRlToolCall,
    TreeRlTrainingLine,
} from "./tree-rl-types.ts";

const config = applicationsProtocolConfig;
const treeRl = config.treeRl;
const replayIdentity = replayProtocolConfig.identity;
const [, , , TREE_RL_KIND] = APPLICATION_KINDS;
const [OPENED_PHASE, ROOT_PHASE, ROLLOUT_PHASE, BATCH_PHASE] = APPLICATION_TREE_RL_PHASES;
const [COMPLETED, FAILED] = APPLICATION_TREE_RL_ROLLOUT_STATUSES;
const [JSONL_FORMAT] = APPLICATION_TREE_RL_BATCH_FORMATS;
const [ROOT_MEMBER, BRANCH_MEMBER] = APPLICATION_TREE_RL_MEMBER_KINDS;
const [PREFIX_SEGMENT, SUFFIX_SEGMENT, FLAT_SEGMENT] = APPLICATION_TREE_RL_ACTION_SEGMENTS;
const [NO_NORMALIZATION] = APPLICATION_TREE_RL_NORMALIZATIONS;
const [POPULATION_ESTIMATOR] = treeRl.advantage.stdEstimators;

/** One prompt of a retained opened body. @internal */
export type TreeRlOpenedPrompt = {
    readonly id: string;
    readonly roots: readonly string[];
};

/** Retained opened record body of one Tree-RL run. @internal */
export type TreeRlOpenedBody = {
    readonly application_id: string;
    readonly baselines: readonly TreeRlBaselineKind[];
    readonly command_id: string;
    readonly kind: typeof TREE_RL_KIND;
    readonly normalization: TreeRlNormalization;
    readonly phase: typeof OPENED_PHASE;
    readonly prompts: readonly TreeRlOpenedPrompt[];
    readonly protocol_id: string;
    readonly seeds: readonly number[];
};

/** Retained root record body of one Tree-RL run. @internal */
export type TreeRlRootBody = Omit<TreeRlRootRecord, "record_id"> & {
    readonly application_id: string;
    readonly phase: typeof ROOT_PHASE;
};

/** Retained rollout record body of one Tree-RL run. @internal */
export type TreeRlRolloutBody = Omit<TreeRlRolloutRecord, "record_id"> & {
    readonly application_id: string;
    readonly phase: typeof ROLLOUT_PHASE;
};

/** Retained batch record body of one Tree-RL run. @internal */
export type TreeRlBatchBody = TreeRlBatchSummary & {
    readonly application_id: string;
    readonly baseline: (TreeRlBatchSummary & { readonly kind: TreeRlBaselineKind }) | null;
    readonly phase: typeof BATCH_PHASE;
};

/**
 * Computes the Algorithm 2 advantages (paper Appendix F.6, lines 22-25) of a batch of trees.
 *
 * Trees sharing a `prompt_id` form one G-root group. With `R` the rewards of the completed members
 * of a group, `mean(R)` their mean, and `n` their count:
 *
 * - inter-root advantage of root `g` (its prefix actions `j < t*`):
 *   `A_inter = R_root,g - mean(R_root over the prompt's completed roots)`;
 * - intra-tree advantage of member `k` in `{root, 0..K-1}` (its suffix actions `j >= t*`):
 *   `A_intra,k = R_k - mean(R over the tree's completed members, root included)`.
 *
 * Under the `group_std` normalization (F.6: "advantages are GRPO-normalized and standardized per
 * group") each centered value is divided by `std + epsilon` of the same group, with the configured
 * estimator (`sample` divides the squared deviations by `n - 1`, `population` by `n`) and
 * `epsilon`; a group with fewer than two completed members has standard deviation `0`. Under
 * `none` the centered values are returned unchanged. Failed members (null rewards) are excluded
 * from every mean and receive null. Sums run in input order, so the result is a pure function of
 * the input sequence.
 *
 * @param trees - Trees in batch order; `group_index` values are distinct within a prompt.
 * @param normalization - Advantage normalization; defaults to the configured one.
 * @returns One advantage entry per tree, in input order.
 * @throws {TypeError} If a tree is malformed, a reward is not finite or null, identities repeat,
 * or the normalization is not configured.
 *
 * @example
 * ```ts
 * const [tree] = computeTreeRlAdvantages(
 *     [{ branches: [3, 5], group_index: 0, prompt_id: "p", root: 1 }],
 *     "none",
 * );
 * console.log(tree.branch_intra_advantages); // [0, 2]
 * ```
 */
export function computeTreeRlAdvantages(
    trees: readonly TreeRlAdvantageTree[],
    normalization: TreeRlNormalization = treeRl.advantage.normalization as TreeRlNormalization,
): readonly TreeRlAdvantage[] {
    if (!APPLICATION_TREE_RL_NORMALIZATIONS.includes(normalization)) {
        throw new TypeError("normalization must be a configured Tree-RL normalization");
    }
    const entries = readScopeArray(trees, "trees").map((tree, index) => {
        const subject = `trees[${index}]`;
        const fields = readScopeDataObject(
            tree,
            ["branches", "group_index", "prompt_id", "root"],
            subject,
        );
        assertScopeText(fields.prompt_id, `${subject}.prompt_id`);
        return {
            branches: readScopeArray(fields.branches, `${subject}.branches`).map((reward, branch) =>
                readReward(reward, `${subject}.branches[${branch}]`),
            ),
            groupIndex: readCount(fields.group_index, `${subject}.group_index`),
            promptId: fields.prompt_id,
            root: readReward(fields.root, `${subject}.root`),
        };
    });
    if (
        new Set(entries.map((entry) => canonical([entry.promptId, entry.groupIndex]))).size !==
        entries.length
    ) {
        throw new TypeError("tree identities must be distinct");
    }
    const inter = new Map<string, readonly (number | null)[]>();
    for (const promptId of new Set(entries.map((entry) => entry.promptId))) {
        inter.set(
            promptId,
            standardizeTreeRlGroup(
                entries.filter((entry) => entry.promptId === promptId).map((entry) => entry.root),
                normalization,
            ),
        );
    }
    const positions = new Map<string, number>();
    return Object.freeze(
        entries.map((entry) => {
            const position = positions.get(entry.promptId) ?? 0;
            positions.set(entry.promptId, position + 1);
            const [rootIntra, ...branchIntra] = standardizeTreeRlGroup(
                [entry.root, ...entry.branches],
                normalization,
            );
            return Object.freeze({
                branch_intra_advantages: Object.freeze(branchIntra),
                group_index: entry.groupIndex,
                inter_root_advantage: (inter.get(entry.promptId) as (number | null)[])[position] as
                    | number
                    | null,
                prompt_id: entry.promptId,
                root_intra_advantage: rootIntra as number | null,
            });
        }),
    );
}

/**
 * Centers the completed values of one group on their mean and, under `group_std`, divides by the
 * group standard deviation under `estimator` (the configured one by default) plus the configured
 * epsilon. @internal
 */
export function standardizeTreeRlGroup(
    values: readonly (number | null)[],
    normalization: TreeRlNormalization,
    estimator: string = treeRl.advantage.stdEstimator,
): readonly (number | null)[] {
    const completed = values.filter((value): value is number => value !== null);
    const mean = completed.reduce((sum, value) => sum + value, 0) / completed.length;
    let scale = 1;
    if (normalization !== NO_NORMALIZATION) {
        const divisor =
            estimator === POPULATION_ESTIMATOR ? completed.length : completed.length - 1;
        const squares = completed.reduce((sum, value) => sum + (value - mean) ** 2, 0);
        scale = (divisor > 0 ? Math.sqrt(squares / divisor) : 0) + treeRl.advantage.epsilon;
    }
    return values.map((value) => (value === null ? null : (value - mean) / scale));
}

/**
 * Builds one canonical `jsonl_v2` batch over retained roots and rollouts; with `flat`, the flat
 * GRPO baseline over the roots only. @internal
 */
export function buildTreeRlBatch(
    opened: TreeRlOpenedBody,
    roots: readonly Omit<TreeRlRootRecord, "record_id">[],
    rollouts: readonly Omit<TreeRlRolloutRecord, "record_id">[],
    flat: boolean,
): TreeRlBatchExport {
    const branchCount = opened.seeds.length;
    const trees = roots.map((root, index) => ({
        branches: rollouts
            .slice(index * branchCount, (index + 1) * branchCount)
            .map((rollout) => rollout.reward),
        group_index: root.group_index,
        prompt_id: root.prompt_id,
        root: root.reward,
    }));
    const advantages = computeTreeRlAdvantages(
        flat ? trees.map(rootOnly) : trees,
        opened.normalization,
    );
    const lines: TreeRlTrainingLine[] = [];
    for (const [index, root] of roots.entries()) {
        const advantage = advantages[index] as TreeRlAdvantage;
        const inter = advantage.inter_root_advantage;
        const fork = root.fork;
        const line = (
            member: {
                readonly branch: number | null;
                readonly intra: number | null;
                readonly replay_session_id: string;
                readonly reward: number;
                readonly rollout_id: string | null;
                readonly seed: number | null;
                readonly seeded: boolean;
                readonly step_count: number;
                readonly turns: readonly number[];
            },
            kind: string,
        ) =>
            Object.freeze({
                actions: Object.freeze(
                    member.turns.flatMap((stepIndex, turn): TreeRlActionAdvantage[] => {
                        const prefix = stepIndex < fork.fork_point.step_index;
                        const segment = flat
                            ? FLAT_SEGMENT
                            : prefix
                              ? PREFIX_SEGMENT
                              : SUFFIX_SEGMENT;
                        const value = flat || prefix ? inter : member.intra;
                        return value === null
                            ? []
                            : [
                                  Object.freeze({
                                      advantage: value,
                                      segment,
                                      step_index: stepIndex,
                                      turn: turn + 1,
                                  }),
                              ];
                    }),
                ),
                branch: member.branch,
                branch_turn: fork.branch_turn,
                fork_point: Object.freeze({ ...fork.fork_point }),
                group_index: root.group_index,
                inter_root_advantage: inter,
                intra_tree_advantage: flat ? null : member.intra,
                member: kind,
                prompt_id: root.prompt_id,
                replay_session_id: member.replay_session_id,
                reward: member.reward,
                rollout_id: member.rollout_id,
                root_session_id: root.root_session_id,
                seed: member.seed,
                seeded: member.seeded,
                step_count: member.step_count,
            }) as TreeRlTrainingLine;
        if (root.status === COMPLETED) {
            lines.push(
                line(
                    {
                        branch: null,
                        intra: advantage.root_intra_advantage,
                        replay_session_id: root.root_session_id,
                        reward: root.reward as number,
                        rollout_id: null,
                        seed: null,
                        seeded: false,
                        step_count: root.step_count,
                        turns: root.turns,
                    },
                    ROOT_MEMBER,
                ),
            );
        }
        if (flat) {
            continue;
        }
        for (const [branch, rollout] of rollouts
            .slice(index * branchCount, (index + 1) * branchCount)
            .entries()) {
            if (rollout.status === COMPLETED) {
                lines.push(
                    line(
                        {
                            branch: rollout.branch,
                            intra: advantage.branch_intra_advantages[branch] as number,
                            replay_session_id: rollout.replay_session_id,
                            reward: rollout.reward as number,
                            rollout_id: rollout.rollout_id,
                            seed: rollout.seed,
                            seeded: rollout.seeded,
                            step_count: rollout.step_count,
                            turns: rollout.turns,
                        },
                        BRANCH_MEMBER,
                    ),
                );
            }
        }
    }
    const text = lines
        .map((line) => `${canonicalizeSemanticValue(line as unknown as SemanticValue)}\n`)
        .join("");
    return Object.freeze({
        batch_digest: `${config.identity.digestAlgorithm}:${createHash(
            config.identity.digestAlgorithm,
        )
            .update(text, "utf8")
            .digest("hex")}`,
        format: JSONL_FORMAT as TreeRlBatchFormat,
        line_count: lines.length,
        lines: Object.freeze(lines),
        text,
    });
}

function rootOnly(tree: TreeRlAdvantageTree): TreeRlAdvantageTree {
    return { ...tree, branches: [] };
}

/**
 * Resolves one fork proposal into the admissible turn range `[first, max(first, T - trailing)]`,
 * then to the nearest admissible restorable turn (earlier first on ties). @internal
 */
export function resolveTreeRlForkTurn(
    proposed: number,
    turnCount: number,
    restorable: (turn: number) => boolean,
): number | null {
    const { first, last } = treeRlTurnBounds(turnCount);
    const clamped = Math.min(Math.max(proposed, first), last);
    for (let distance = 0; distance <= last - first; distance += 1) {
        for (const turn of [clamped - distance, clamped + distance]) {
            if (turn >= first && turn <= last && restorable(turn)) {
                return turn;
            }
        }
    }
    return null;
}

/** Admissible one-based fork-turn range of a root with `turnCount` turns. @internal */
export function treeRlTurnBounds(turnCount: number): {
    readonly first: number;
    readonly last: number;
} {
    const first = treeRl.forkTurn.first;
    return Object.freeze({
        first,
        last: Math.min(turnCount, Math.max(first, turnCount - treeRl.forkTurn.trailing)),
    });
}

/** Validates one untrusted fork proposal. @internal */
export function readTreeRlForkProposal(value: unknown, subject: string): TreeRlForkProposal {
    const fields = readScopeDataObject(value, ["branch_turn", "reason", "tool_call"], subject);
    if (!Number.isSafeInteger(fields.branch_turn)) {
        throw new TypeError(`${subject}.branch_turn must be a safe integer`);
    }
    return Object.freeze({
        branch_turn: fields.branch_turn as number,
        reason: readApplicationReason(fields.reason, `${subject}.reason`),
        tool_call:
            fields.tool_call === null
                ? null
                : readToolCall(fields.tool_call, `${subject}.tool_call`),
    });
}

function readToolCall(value: unknown, subject: string): TreeRlToolCall {
    const fields = readScopeDataObject(value, ["arguments", "name"], subject);
    assertScopeText(fields.name, `${subject}.name`);
    const input = fields.arguments;
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
        throw new TypeError(`${subject}.arguments must be an object`);
    }
    const text = canonical(input);
    if (Buffer.byteLength(text, "utf8") > config.limits.maxToolBytes) {
        throw new TypeError(`${subject}.arguments exceeds the configured tool byte bound`);
    }
    return Object.freeze({
        arguments: JSON.parse(text) as TreeRlToolCall["arguments"],
        name: fields.name,
    });
}

/** Validates a retained Tree-RL opened body. @internal */
export function readTreeRlOpenedBody(body: RecordBody): TreeRlOpenedBody {
    return decodeApplicationBody("tree-rl opened", () => {
        const fields = readVersionedBody(body, [
            "application_id",
            "baselines",
            "command_id",
            "kind",
            "normalization",
            "phase",
            "prompts",
            "protocol_id",
            "seeds",
        ]);
        assertApplicationDigest(
            fields.application_id,
            config.identity.applicationIdPrefix,
            "application_id",
        );
        assertScopeText(fields.command_id, "command_id");
        assertApplicationDigest(
            fields.protocol_id,
            config.identity.protocolIdPrefix,
            "protocol_id",
        );
        const baselines = readTreeRlBaselines(fields.baselines);
        const prompts = readTreeRlPrompts(fields.prompts, "prompts");
        const seeds = readScopeArray(fields.seeds, "seeds");
        if (
            [
                fields.kind !== TREE_RL_KIND,
                fields.phase !== OPENED_PHASE,
                !APPLICATION_TREE_RL_NORMALIZATIONS.includes(fields.normalization as never),
                canonical(baselines) !== canonical(fields.baselines),
                seeds.length === 0,
                seeds.length > config.limits.maxBranches,
                !seeds.every((seed) => Number.isSafeInteger(seed)),
                new Set(seeds).size !== seeds.length,
                prompts.length * (prompts[0] as TreeRlOpenedPrompt).roots.length * seeds.length >
                    config.limits.maxRollouts,
            ].includes(true)
        ) {
            throw new TypeError("opened kind, phase, normalization, baselines, or seeds disagree");
        }
        return Object.freeze({
            ...fields,
            baselines,
            prompts,
            seeds: Object.freeze(seeds as number[]),
        }) as unknown as TreeRlOpenedBody;
    });
}

/**
 * Validates one prompt batch: distinct prompt identities, the same positive group size for every
 * prompt within the configured bounds, and distinct root session identities. @internal
 */
export function readTreeRlPrompts(value: unknown, subject: string): readonly TreeRlOpenedPrompt[] {
    const prompts = readScopeArray(value, subject).map((entry, index) => {
        const fields = readScopeDataObject(entry, ["id", "roots"], `${subject}[${index}]`);
        assertScopeText(fields.id, `${subject}[${index}].id`);
        const roots = readScopeArray(fields.roots, `${subject}[${index}].roots`).map(
            (root, position) => {
                assertPrefixedDigest(
                    root,
                    replayIdentity.sessionIdPrefix,
                    `${subject}[${index}].roots[${position}]`,
                );
                return root as string;
            },
        );
        return Object.freeze({ id: fields.id, roots: Object.freeze(roots) });
    });
    const groupSize = prompts[0]?.roots.length ?? 0;
    if (
        [
            prompts.length === 0,
            prompts.length > APPLICATION_TREE_RL_LIMITS.maxPrompts,
            groupSize === 0,
            groupSize > APPLICATION_TREE_RL_LIMITS.maxGroupSize,
            prompts.some((prompt) => prompt.roots.length !== groupSize),
            new Set(prompts.map((prompt) => prompt.id)).size !== prompts.length,
            new Set(prompts.flatMap((prompt) => prompt.roots)).size !== prompts.length * groupSize,
        ].includes(true)
    ) {
        throw new TypeError(
            `${subject} must be distinct prompts with equal, bounded groups of distinct roots`,
        );
    }
    return Object.freeze(prompts);
}

/** Validates a retained Tree-RL root body. @internal */
export function readTreeRlRootBody(body: RecordBody): TreeRlRootBody {
    return decodeApplicationBody("tree-rl root", () => {
        const fields = readVersionedBody(body, [
            "application_id",
            "cost",
            "failure",
            "fork",
            "group_index",
            "phase",
            "prompt_id",
            "reward",
            "root_session_id",
            "status",
            "step_count",
            "turns",
        ]);
        assertApplicationDigest(
            fields.application_id,
            config.identity.applicationIdPrefix,
            "application_id",
        );
        assertScopeText(fields.prompt_id, "prompt_id");
        assertPrefixedDigest(
            fields.root_session_id,
            replayIdentity.sessionIdPrefix,
            "root_session_id",
        );
        const turns = readTurns(fields.turns, "turns");
        const status = readStatus(fields.status, fields.reward, fields.failure);
        const fork = readFork(fields.fork, turns);
        if (fields.phase !== ROOT_PHASE || turns.length === 0) {
            throw new TypeError("root phase or turns disagree");
        }
        return Object.freeze({
            ...fields,
            cost: Object.freeze({ ...readApplicationCosts(fields.cost) }),
            failure: status.failure,
            fork,
            group_index: readCount(fields.group_index, "group_index"),
            step_count: readCount(fields.step_count, "step_count"),
            turns,
        }) as unknown as TreeRlRootBody;
    });
}

/** Validates a retained Tree-RL rollout body. @internal */
export function readTreeRlRolloutBody(body: RecordBody): TreeRlRolloutBody {
    return decodeApplicationBody("tree-rl rollout", () => {
        const fields = readVersionedBody(body, [
            "application_id",
            "branch",
            "branch_turn",
            "cost",
            "failure",
            "fork_point",
            "group_index",
            "phase",
            "prompt_id",
            "replay_session_id",
            "reward",
            "rollout_id",
            "root_session_id",
            "seed",
            "seeded",
            "status",
            "step_count",
            "turns",
        ]);
        assertApplicationDigest(
            fields.application_id,
            config.identity.applicationIdPrefix,
            "application_id",
        );
        assertApplicationDigest(fields.rollout_id, config.identity.rolloutIdPrefix, "rollout_id");
        assertPrefixedDigest(
            fields.replay_session_id,
            replayIdentity.sessionIdPrefix,
            "replay_session_id",
        );
        assertPrefixedDigest(
            fields.root_session_id,
            replayIdentity.sessionIdPrefix,
            "root_session_id",
        );
        assertScopeText(fields.prompt_id, "prompt_id");
        const branch = readCount(fields.branch, "branch");
        const branchTurn = readCount(fields.branch_turn, "branch_turn");
        const status = readStatus(fields.status, fields.reward, fields.failure);
        if (
            [
                fields.phase !== ROLLOUT_PHASE,
                branch >= config.limits.maxBranches,
                branchTurn === 0,
                !Number.isSafeInteger(fields.seed),
                typeof fields.seeded !== "boolean",
                fields.seeded === true && branch !== 0,
            ].includes(true)
        ) {
            throw new TypeError("rollout phase, branch, fork turn, seed, or seeding disagree");
        }
        return Object.freeze({
            ...fields,
            branch,
            branch_turn: branchTurn,
            cost: Object.freeze({ ...readApplicationCosts(fields.cost) }),
            failure: status.failure,
            fork_point: readTreeRlForkPoint(fields.fork_point, "fork_point"),
            group_index: readCount(fields.group_index, "group_index"),
            step_count: readCount(fields.step_count, "step_count"),
            turns: readTurns(fields.turns, "turns"),
        }) as unknown as TreeRlRolloutBody;
    });
}

/** Validates a retained Tree-RL batch body. @internal */
export function readTreeRlBatchBody(body: RecordBody): TreeRlBatchBody {
    return decodeApplicationBody("tree-rl batch", () => {
        const fields = readVersionedBody(body, [
            "application_id",
            "baseline",
            "batch_digest",
            "format",
            "line_count",
            "phase",
        ]);
        assertApplicationDigest(
            fields.application_id,
            config.identity.applicationIdPrefix,
            "application_id",
        );
        const summary = readSummary(fields, "batch");
        let baseline = null;
        if (fields.baseline !== null) {
            const entry = readScopeDataObject(
                fields.baseline,
                ["batch_digest", "format", "kind", "line_count"],
                "baseline",
            );
            if (!APPLICATION_TREE_RL_BASELINE_KINDS.includes(entry.kind as never)) {
                throw new TypeError("baseline.kind must be a configured baseline kind");
            }
            baseline = Object.freeze({
                ...readSummary(entry, "baseline"),
                kind: entry.kind as TreeRlBaselineKind,
            });
        }
        if (fields.phase !== BATCH_PHASE) {
            throw new TypeError("batch phase is inconsistent");
        }
        return Object.freeze({
            ...fields,
            ...summary,
            baseline,
        }) as unknown as TreeRlBatchBody;
    });
}

/** Validates one configured baseline list in configured order. @internal */
export function readTreeRlBaselines(value: unknown): readonly TreeRlBaselineKind[] {
    const declared = readScopeArray(value, "baselines");
    const baselines = APPLICATION_TREE_RL_BASELINE_KINDS.filter((kind) => declared.includes(kind));
    if (baselines.length !== declared.length) {
        throw new TypeError("baselines must be distinct configured baseline kinds");
    }
    return Object.freeze(baselines);
}

/** Canonical text of one semantic value. @internal */
export function canonical(value: unknown): string {
    return canonicalizeSemanticValue(value as SemanticValue);
}

function readFork(value: unknown, turns: readonly number[]): TreeRlForkDecision {
    const fields = readScopeDataObject(
        value,
        ["branch_turn", "fork_point", "proposed_turn", "reason", "tool_call"],
        "fork",
    );
    const proposal = readTreeRlForkProposal(
        { branch_turn: fields.proposed_turn, reason: fields.reason, tool_call: fields.tool_call },
        "fork",
    );
    const branchTurn = readCount(fields.branch_turn, "fork.branch_turn");
    const forkPoint = readTreeRlForkPoint(fields.fork_point, "fork.fork_point");
    const bounds = treeRlTurnBounds(turns.length);
    if (
        branchTurn < bounds.first ||
        branchTurn > bounds.last ||
        turns[branchTurn - 1] !== forkPoint.step_index
    ) {
        throw new TypeError("fork turn is outside the admissible range or disagrees with its step");
    }
    return Object.freeze({
        branch_turn: branchTurn,
        fork_point: forkPoint,
        proposed_turn: proposal.branch_turn,
        reason: proposal.reason,
        tool_call: proposal.tool_call,
    });
}

function readStatus(
    status: unknown,
    reward: unknown,
    failureValue: unknown,
): { readonly failure: TreeRlFailure | null } {
    const failure = failureValue === null ? null : readFailure(failureValue);
    const completed = status === COMPLETED;
    if (
        (!completed && status !== FAILED) ||
        completed !== (failure === null) ||
        completed !== (typeof reward === "number" && Number.isFinite(reward)) ||
        (!completed && reward !== null)
    ) {
        throw new TypeError("status, reward, and failure disagree");
    }
    return { failure };
}

function readTurns(value: unknown, subject: string): readonly number[] {
    const turns = readScopeArray(value, subject).map((turn, index) =>
        readCount(turn, `${subject}[${index}]`),
    );
    if (turns.some((turn, index) => index > 0 && turn <= (turns[index - 1] as number))) {
        throw new TypeError(`${subject} must be strictly increasing step indices`);
    }
    return Object.freeze(turns);
}

function readReward(value: unknown, subject: string): number | null {
    if (value !== null && (typeof value !== "number" || !Number.isFinite(value))) {
        throw new TypeError(`${subject} must be a finite reward or null`);
    }
    return value;
}

function readTreeRlForkPoint(value: unknown, subject: string): TreeRlForkPoint {
    const fields = readScopeDataObject(value, ["prefix_id", "step_index"], subject);
    const stepIndex = readCount(fields.step_index, `${subject}.step_index`);
    if (fields.prefix_id !== null) {
        assertPrefixedDigest(
            fields.prefix_id,
            replayIdentity.prefixIdPrefix,
            `${subject}.prefix_id`,
        );
    }
    if ((stepIndex === 0) !== (fields.prefix_id === null)) {
        throw new TypeError(`${subject}.prefix_id must be null exactly at step 0`);
    }
    return Object.freeze({ prefix_id: fields.prefix_id as string | null, step_index: stepIndex });
}

function readSummary(fields: Record<string, unknown>, subject: string): TreeRlBatchSummary {
    assertPlainDigest(fields.batch_digest, `${subject}.batch_digest`);
    const lineCount = readCount(fields.line_count, `${subject}.line_count`);
    if (
        !APPLICATION_TREE_RL_BATCH_FORMATS.includes(fields.format as never) ||
        lineCount >
            config.limits.maxRollouts +
                APPLICATION_TREE_RL_LIMITS.maxPrompts * APPLICATION_TREE_RL_LIMITS.maxGroupSize
    ) {
        throw new TypeError(`${subject} format or line count is inconsistent`);
    }
    return Object.freeze({
        batch_digest: fields.batch_digest as string,
        format: fields.format as TreeRlBatchFormat,
        line_count: lineCount,
    });
}

function readFailure(value: unknown): TreeRlFailure {
    const fields = readScopeDataObject(value, ["code", "reason"], "failure");
    if (
        fields.code !== config.errors.evidenceCode &&
        fields.code !== config.errors.verificationCode
    ) {
        throw new TypeError("failure.code must be the evidence or verification code");
    }
    return Object.freeze({
        code: fields.code,
        reason: readApplicationReason(fields.reason, "failure.reason"),
    });
}
