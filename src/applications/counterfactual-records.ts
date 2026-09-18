import { applicationsProtocolConfig, replayProtocolConfig } from "../protocol/config.ts";
import {
    APPLICATION_CRO_BASELINE_KINDS,
    APPLICATION_CRO_CANDIDATE_STATUSES,
    APPLICATION_CRO_PHASES,
    APPLICATION_KINDS,
    REPLAY_CHANGE_DIMENSIONS,
} from "../protocol/values.generated.ts";
import type { RecordBody } from "../record/types.ts";
import type { ReplayChangeDimension } from "../replay/types.ts";
import {
    assertPrefixedDigest,
    assertScopeText,
    readScopeArray,
    readScopeDataObject,
} from "../scope/validation.ts";
import type {
    CounterfactualBaselineComparison,
    CounterfactualBaselineKind,
    CounterfactualCandidatePlan,
    CounterfactualCandidateStatus,
    CounterfactualDivergenceSummary,
    CounterfactualEvaluation,
    CounterfactualFailure,
    CounterfactualTarget,
} from "./counterfactual-types.ts";
import {
    assertApplicationDigest,
    decodeApplicationBody,
    readApplicationCosts,
    readApplicationReason,
    readCount,
    readVersionedBody,
} from "./records.ts";
import type { ApplicationCostSummary } from "./types.ts";

const config = applicationsProtocolConfig;
const replayIdentity = replayProtocolConfig.identity;
const [, CRO_KIND] = APPLICATION_KINDS;
const [OPENED_PHASE, CANDIDATE_PHASE] = APPLICATION_CRO_PHASES;
const [PROPOSED, EVALUATED, PROMOTED, REJECTED] = APPLICATION_CRO_CANDIDATE_STATUSES;
const PLAN_KEYS = [
    "candidate_id",
    "changes",
    "edited_step_index",
    "name",
    "parent_candidate_id",
] as const;

/** Retained opened record body of one counterfactual optimization run. @internal */
export type CroOpenedBody = {
    readonly application_id: string;
    readonly baseline_session_id: string;
    readonly baselines: readonly CounterfactualBaselineKind[];
    readonly candidates: readonly CounterfactualCandidatePlan[];
    readonly command_id: string;
    readonly kind: typeof CRO_KIND;
    readonly phase: typeof OPENED_PHASE;
    readonly protocol_id: string;
};

/** Retained candidate record body of one counterfactual optimization run. @internal */
export type CroCandidateBody = CounterfactualCandidatePlan & {
    readonly affected_steps: readonly number[];
    readonly application_id: string;
    readonly baseline: CounterfactualBaselineComparison | null;
    readonly branch_session_id: string;
    readonly cost: ApplicationCostSummary | null;
    readonly divergence: CounterfactualDivergenceSummary | null;
    readonly evaluation: CounterfactualEvaluation | null;
    readonly failure: CounterfactualFailure | null;
    readonly phase: typeof CANDIDATE_PHASE;
    readonly status: CounterfactualCandidateStatus;
    readonly target: CounterfactualTarget;
};

/** Validates a retained optimizer opened body. @internal */
export function readCroOpenedBody(body: RecordBody): CroOpenedBody {
    return decodeApplicationBody("counterfactual opened", () => {
        const fields = readVersionedBody(body, [
            "application_id",
            "baseline_session_id",
            "baselines",
            "candidates",
            "command_id",
            "kind",
            "phase",
            "protocol_id",
        ]);
        assertApplicationDigest(
            fields.application_id,
            config.identity.applicationIdPrefix,
            "application_id",
        );
        assertPrefixedDigest(
            fields.baseline_session_id,
            replayIdentity.sessionIdPrefix,
            "baseline_session_id",
        );
        assertScopeText(fields.command_id, "command_id");
        assertApplicationDigest(
            fields.protocol_id,
            config.identity.protocolIdPrefix,
            "protocol_id",
        );
        const baselines = readScopeArray(fields.baselines, "baselines");
        const candidates = readScopeArray(fields.candidates, "candidates").map((candidate, index) =>
            readCroPlan(candidate, `candidates[${index}]`),
        );
        const ids = candidates.map((candidate) => candidate.candidate_id);
        if (
            fields.kind !== CRO_KIND ||
            fields.phase !== OPENED_PHASE ||
            !baselines.every((kind) => APPLICATION_CRO_BASELINE_KINDS.includes(kind as never)) ||
            new Set(baselines).size !== baselines.length ||
            candidates.length === 0 ||
            candidates.length > config.limits.maxCandidates ||
            new Set(ids).size !== ids.length ||
            new Set(candidates.map((candidate) => candidate.name)).size !== ids.length ||
            !candidates.every(
                (candidate, index) =>
                    candidate.parent_candidate_id === null ||
                    ids.slice(0, index).includes(candidate.parent_candidate_id),
            )
        ) {
            throw new TypeError(
                "opened kind, phase, baselines, or candidate plan are inconsistent",
            );
        }
        return { ...fields, baselines, candidates } as unknown as CroOpenedBody;
    });
}

/** Validates a retained optimizer candidate body. @internal */
export function readCroCandidateBody(body: RecordBody): CroCandidateBody {
    return decodeApplicationBody("counterfactual candidate", () => {
        const fields = readVersionedBody(body, [
            ...PLAN_KEYS,
            "affected_steps",
            "application_id",
            "baseline",
            "branch_session_id",
            "cost",
            "divergence",
            "evaluation",
            "failure",
            "phase",
            "status",
            "target",
        ]);
        const plan = readCroPlan(
            Object.fromEntries(PLAN_KEYS.map((key) => [key, fields[key]])),
            "candidate",
        );
        assertApplicationDigest(
            fields.application_id,
            config.identity.applicationIdPrefix,
            "application_id",
        );
        assertPrefixedDigest(
            fields.branch_session_id,
            replayIdentity.sessionIdPrefix,
            "branch_session_id",
        );
        const affected = readIndices(fields.affected_steps, "affected_steps");
        const target = readTarget(fields.target);
        const cost =
            fields.cost === null ? null : Object.freeze({ ...readApplicationCosts(fields.cost) });
        const divergence = fields.divergence === null ? null : readDivergence(fields.divergence);
        const evaluation = fields.evaluation === null ? null : readEvaluation(fields.evaluation);
        const failure = fields.failure === null ? null : readFailure(fields.failure);
        const baseline = fields.baseline === null ? null : readBaseline(fields.baseline);
        const status = fields.status as CounterfactualCandidateStatus;
        const proposed = status === PROPOSED;
        const passing = status === EVALUATED || status === PROMOTED;
        if (
            fields.phase !== CANDIDATE_PHASE ||
            !APPLICATION_CRO_CANDIDATE_STATUSES.includes(status) ||
            target.step_index <= plan.edited_step_index ||
            (affected.length > 0 && affected[0] !== target.step_index) ||
            proposed !== (divergence === null) ||
            (proposed &&
                (cost !== null || evaluation !== null || failure !== null || baseline !== null)) ||
            (!proposed && (cost === null || (evaluation === null) === (failure === null))) ||
            (passing && evaluation?.passed !== true) ||
            (status === REJECTED && failure === null && evaluation?.passed !== false) ||
            (passing &&
                ((divergence as CounterfactualDivergenceSummary).unexplained.length > 0 ||
                    ((divergence as CounterfactualDivergenceSummary).first_divergence_index ??
                        target.step_index) < target.step_index))
        ) {
            throw new TypeError("candidate phase, status, target, or retained evidence disagree");
        }
        return {
            ...fields,
            ...plan,
            affected_steps: affected,
            baseline,
            cost,
            divergence,
            evaluation,
            failure,
            target,
        } as unknown as CroCandidateBody;
    });
}

/** Validates one untrusted evaluator verdict. @internal */
export function readEvaluation(value: unknown): CounterfactualEvaluation {
    const fields = readScopeDataObject(value, ["passed", "reason", "score"], "evaluation");
    if (
        typeof fields.passed !== "boolean" ||
        typeof fields.score !== "number" ||
        !Number.isFinite(fields.score)
    ) {
        throw new TypeError("evaluation must carry a boolean passed and a finite score");
    }
    return Object.freeze({
        passed: fields.passed,
        reason: readApplicationReason(fields.reason, "evaluation.reason"),
        score: fields.score,
    });
}

/** Validates one declared change list in configured order. @internal */
export function readCroChanges(value: unknown, subject: string): readonly ReplayChangeDimension[] {
    const declared = readScopeArray(value, subject);
    const changes = REPLAY_CHANGE_DIMENSIONS.filter((dimension) => declared.includes(dimension));
    if (changes.length === 0 || changes.length !== declared.length) {
        throw new TypeError(`${subject} must be a non-empty distinct configured change list`);
    }
    return Object.freeze(changes);
}

function readCroPlan(value: unknown, subject: string): CounterfactualCandidatePlan {
    const fields = readScopeDataObject(value, PLAN_KEYS, subject);
    assertApplicationDigest(
        fields.candidate_id,
        config.identity.candidateIdPrefix,
        `${subject}.candidate_id`,
    );
    assertScopeText(fields.name, `${subject}.name`);
    if (fields.parent_candidate_id !== null) {
        assertApplicationDigest(
            fields.parent_candidate_id,
            config.identity.candidateIdPrefix,
            `${subject}.parent_candidate_id`,
        );
    }
    const changes = readCroChanges(fields.changes, `${subject}.changes`);
    if (changes.some((change, index) => change !== (fields.changes as readonly unknown[])[index])) {
        throw new TypeError(`${subject}.changes must be in configured order`);
    }
    return Object.freeze({
        candidate_id: fields.candidate_id as string,
        changes,
        edited_step_index: readCount(fields.edited_step_index, `${subject}.edited_step_index`),
        name: fields.name,
        parent_candidate_id: fields.parent_candidate_id as string | null,
    });
}

function readTarget(value: unknown): CounterfactualTarget {
    const fields = readScopeDataObject(
        value,
        ["prefix_id", "source_session_id", "step_index"],
        "target",
    );
    assertPrefixedDigest(fields.prefix_id, replayIdentity.prefixIdPrefix, "target.prefix_id");
    assertPrefixedDigest(
        fields.source_session_id,
        replayIdentity.sessionIdPrefix,
        "target.source_session_id",
    );
    return Object.freeze({
        prefix_id: fields.prefix_id as string,
        source_session_id: fields.source_session_id as string,
        step_index: readCount(fields.step_index, "target.step_index"),
    });
}

function readDivergence(value: unknown): CounterfactualDivergenceSummary {
    const fields = readScopeDataObject(
        value,
        [
            "common_prefix_id",
            "first_divergence_index",
            "live_steps",
            "recorded_steps",
            "unexplained",
        ],
        "divergence",
    );
    if (fields.common_prefix_id !== null) {
        assertPrefixedDigest(
            fields.common_prefix_id,
            replayIdentity.prefixIdPrefix,
            "divergence.common_prefix_id",
        );
    }
    return Object.freeze({
        common_prefix_id: fields.common_prefix_id as string | null,
        first_divergence_index:
            fields.first_divergence_index === null
                ? null
                : readCount(fields.first_divergence_index, "divergence.first_divergence_index"),
        live_steps: readCount(fields.live_steps, "divergence.live_steps"),
        recorded_steps: readCount(fields.recorded_steps, "divergence.recorded_steps"),
        unexplained: readIndices(fields.unexplained, "divergence.unexplained"),
    });
}

function readFailure(value: unknown): CounterfactualFailure {
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

function readBaseline(value: unknown): CounterfactualBaselineComparison {
    const fields = readScopeDataObject(
        value,
        ["cache_read_input_tokens", "kind", "provider_calls", "session_id"],
        "baseline",
    );
    assertPrefixedDigest(fields.session_id, replayIdentity.sessionIdPrefix, "baseline.session_id");
    if (!APPLICATION_CRO_BASELINE_KINDS.includes(fields.kind as never)) {
        throw new TypeError("baseline.kind must be a configured baseline kind");
    }
    return Object.freeze({
        cache_read_input_tokens: readCount(
            fields.cache_read_input_tokens,
            "baseline.cache_read_input_tokens",
        ),
        kind: fields.kind as CounterfactualBaselineKind,
        provider_calls: readCount(fields.provider_calls, "baseline.provider_calls"),
        session_id: fields.session_id as string,
    });
}

function readIndices(value: unknown, subject: string): readonly number[] {
    const indices = readScopeArray(value, subject).map((index, position) =>
        readCount(index, `${subject}[${position}]`),
    );
    if (
        indices.length > replayProtocolConfig.limits.maxSteps ||
        indices.some(
            (index, position) => position > 0 && index <= (indices[position - 1] as number),
        )
    ) {
        throw new TypeError(`${subject} must be strictly ascending and within the step bound`);
    }
    return Object.freeze(indices);
}
