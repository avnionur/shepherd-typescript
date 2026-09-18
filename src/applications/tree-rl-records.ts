import { createHash } from "node:crypto";

import { canonicalizeSemanticValue, type SemanticValue } from "../canonical/canonical-record.ts";
import { applicationsProtocolConfig, replayProtocolConfig } from "../protocol/config.ts";
import {
    APPLICATION_KINDS,
    APPLICATION_TREE_RL_BASELINE_KINDS,
    APPLICATION_TREE_RL_BATCH_FORMATS,
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
    TreeRlAdvantage,
    TreeRlAdvantageInput,
    TreeRlBaselineKind,
    TreeRlBatchExport,
    TreeRlBatchFormat,
    TreeRlBatchSummary,
    TreeRlFailure,
    TreeRlForkPoint,
    TreeRlRolloutRecord,
    TreeRlSelectedForkPoint,
    TreeRlTrainingLine,
} from "./tree-rl-types.ts";

const config = applicationsProtocolConfig;
const replayIdentity = replayProtocolConfig.identity;
const [, , , TREE_RL_KIND] = APPLICATION_KINDS;
const [OPENED_PHASE, ROLLOUT_PHASE, BATCH_PHASE] = APPLICATION_TREE_RL_PHASES;
const [COMPLETED, FAILED] = APPLICATION_TREE_RL_ROLLOUT_STATUSES;
const [JSONL_FORMAT] = APPLICATION_TREE_RL_BATCH_FORMATS;

/** Retained opened record body of one Tree-RL run. @internal */
export type TreeRlOpenedBody = {
    readonly application_id: string;
    readonly baselines: readonly TreeRlBaselineKind[];
    readonly command_id: string;
    readonly fork_points: readonly TreeRlSelectedForkPoint[];
    readonly kind: typeof TREE_RL_KIND;
    readonly phase: typeof OPENED_PHASE;
    readonly protocol_id: string;
    readonly seeds: readonly number[];
    readonly source_session_id: string;
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
 * Computes intra- and inter-branch advantages over completed rollouts only.
 *
 * Rollouts sharing a fork point step index form one group. For every completed rollout,
 * `intra_branch_advantage = reward - mean(completed rewards in its group)` and
 * `inter_branch_advantage = mean(completed rewards in its group) - mean(every completed reward)`.
 * Failed rollouts are excluded from every mean and receive no advantage. A group with one completed
 * rollout yields an intra-branch advantage of exactly `0`, and a run whose completed rollouts share
 * one fork point yields inter-branch advantages of exactly `0`. Means sum in input order, so the
 * result is a pure function of the input sequence.
 *
 * @param rollouts - Rollouts in batch order, such as retained rollout records; other fields are
 * ignored.
 * @returns One advantage per completed rollout, in input order.
 * @throws {TypeError} If a rollout is malformed, its status and reward disagree, a reward is not
 * finite, or rollout identities repeat.
 *
 * @example
 * ```ts
 * const advantages = computeTreeRlAdvantages(inspection.rollouts.map((entry) => entry.record!));
 * ```
 */
export function computeTreeRlAdvantages(
    rollouts: readonly TreeRlAdvantageInput[],
): readonly TreeRlAdvantage[] {
    const entries = readScopeArray(rollouts, "rollouts").map((rollout, index) => {
        const subject = `rollouts[${index}]`;
        if (rollout === null || typeof rollout !== "object") {
            throw new TypeError(`${subject} must be an object`);
        }
        const fields = rollout as unknown as Record<string, unknown>;
        assertScopeText(fields.rollout_id, `${subject}.rollout_id`);
        const stepIndex = readCount(
            (fields.fork_point as { readonly step_index?: unknown } | null)?.step_index,
            `${subject}.fork_point.step_index`,
        );
        const completed = fields.status === COMPLETED;
        if (
            (!completed && fields.status !== FAILED) ||
            completed !== (typeof fields.reward === "number") ||
            (!completed && fields.reward !== null) ||
            (completed && !Number.isFinite(fields.reward))
        ) {
            throw new TypeError(
                `${subject} must be completed with a finite reward or failed without one`,
            );
        }
        return {
            completed,
            reward: fields.reward as number,
            rolloutId: fields.rollout_id,
            stepIndex,
        };
    });
    if (new Set(entries.map((entry) => entry.rolloutId)).size !== entries.length) {
        throw new TypeError("rollout identities must be distinct");
    }
    const completed = entries.filter((entry) => entry.completed);
    const groups = new Map<number, number[]>();
    for (const entry of completed) {
        groups.set(entry.stepIndex, [...(groups.get(entry.stepIndex) ?? []), entry.reward]);
    }
    const overall = mean(completed.map((entry) => entry.reward));
    return Object.freeze(
        completed.map((entry) => {
            const group = groups.get(entry.stepIndex) as number[];
            const groupMean = mean(group);
            return Object.freeze({
                inter_branch_advantage: groups.size < 2 ? 0 : groupMean - overall,
                intra_branch_advantage: group.length < 2 ? 0 : entry.reward - groupMean,
                rollout_id: entry.rolloutId,
            });
        }),
    );
}

/** Builds one canonical `jsonl_v1` batch over rollouts in batch order. @internal */
export function buildTreeRlBatch(
    sessionId: string,
    rollouts: readonly Omit<TreeRlRolloutRecord, "record_id">[],
): TreeRlBatchExport {
    const advantages = new Map(
        computeTreeRlAdvantages(rollouts).map((entry) => [entry.rollout_id, entry]),
    );
    const lines = rollouts
        .filter((rollout) => rollout.status === COMPLETED)
        .map((rollout): TreeRlTrainingLine => {
            const advantage = advantages.get(rollout.rollout_id) as TreeRlAdvantage;
            return Object.freeze({
                fork_point: Object.freeze({
                    prefix_id: rollout.fork_point.prefix_id,
                    step_index: rollout.fork_point.step_index,
                }),
                inter_branch_advantage: advantage.inter_branch_advantage,
                intra_branch_advantage: advantage.intra_branch_advantage,
                replay_session_id: rollout.replay_session_id,
                reward: rollout.reward as number,
                rollout_id: rollout.rollout_id,
                seed: rollout.seed,
                session_id: sessionId,
                step_count: rollout.step_count,
            });
        });
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

/** Validates a retained Tree-RL opened body. @internal */
export function readTreeRlOpenedBody(body: RecordBody): TreeRlOpenedBody {
    return decodeApplicationBody("tree-rl opened", () => {
        const fields = readVersionedBody(body, [
            "application_id",
            "baselines",
            "command_id",
            "fork_points",
            "kind",
            "phase",
            "protocol_id",
            "seeds",
            "source_session_id",
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
        assertPrefixedDigest(
            fields.source_session_id,
            replayIdentity.sessionIdPrefix,
            "source_session_id",
        );
        const baselines = readTreeRlBaselines(fields.baselines);
        const forkPoints = readScopeArray(fields.fork_points, "fork_points").map(
            (entry, index): TreeRlSelectedForkPoint => {
                const subject = `fork_points[${index}]`;
                const point = readScopeDataObject(
                    entry,
                    ["dependents", "prefix_id", "step_index"],
                    subject,
                );
                return Object.freeze({
                    dependents: readCount(point.dependents, `${subject}.dependents`),
                    ...readTreeRlForkPoint(
                        { prefix_id: point.prefix_id, step_index: point.step_index },
                        subject,
                    ),
                });
            },
        );
        const seeds = readScopeArray(fields.seeds, "seeds");
        if (
            [
                fields.kind !== TREE_RL_KIND,
                fields.phase !== OPENED_PHASE,
                canonical(baselines) !== canonical(fields.baselines),
                forkPoints.length === 0,
                forkPoints.length > config.limits.maxForkPoints,
                forkPoints.some(
                    (point, index) =>
                        index > 0 &&
                        point.step_index <=
                            (forkPoints[index - 1] as TreeRlSelectedForkPoint).step_index,
                ),
                seeds.length === 0,
                seeds.length > config.limits.maxBranches,
                !seeds.every((seed) => Number.isSafeInteger(seed)),
                new Set(seeds).size !== seeds.length,
                forkPoints.length * seeds.length > config.limits.maxRollouts,
            ].includes(true)
        ) {
            throw new TypeError("opened kind, phase, baselines, fork points, or seeds disagree");
        }
        return Object.freeze({
            ...fields,
            baselines,
            fork_points: Object.freeze(forkPoints),
            seeds: Object.freeze(seeds as number[]),
        }) as unknown as TreeRlOpenedBody;
    });
}

/** Validates a retained Tree-RL rollout body. @internal */
export function readTreeRlRolloutBody(body: RecordBody): TreeRlRolloutBody {
    return decodeApplicationBody("tree-rl rollout", () => {
        const fields = readVersionedBody(body, [
            "application_id",
            "branch",
            "cost",
            "failure",
            "fork_point",
            "phase",
            "replay_session_id",
            "reward",
            "rollout_id",
            "seed",
            "status",
            "step_count",
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
        const branch = readCount(fields.branch, "branch");
        const failure = fields.failure === null ? null : readFailure(fields.failure);
        const completed = fields.status === COMPLETED;
        if (
            [
                fields.phase !== ROLLOUT_PHASE,
                !completed && fields.status !== FAILED,
                branch >= config.limits.maxBranches,
                !Number.isSafeInteger(fields.seed),
                completed !== (failure === null),
                completed !== (typeof fields.reward === "number" && Number.isFinite(fields.reward)),
                !completed && fields.reward !== null,
            ].includes(true)
        ) {
            throw new TypeError("rollout phase, status, reward, failure, or branch disagree");
        }
        return Object.freeze({
            ...fields,
            branch,
            cost: Object.freeze({ ...readApplicationCosts(fields.cost) }),
            failure,
            fork_point: readTreeRlForkPoint(fields.fork_point, "fork_point"),
            step_count: readCount(fields.step_count, "step_count"),
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
        lineCount > config.limits.maxRollouts
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

function mean(values: readonly number[]): number {
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}
