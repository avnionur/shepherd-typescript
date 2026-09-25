import type { SemanticValue } from "../canonical/canonical-record.ts";
import { applicationsProtocolConfig, replayProtocolConfig } from "../protocol/config.ts";
import {
    APPLICATION_CRO_BASELINE_KINDS,
    APPLICATION_CRO_CANDIDATE_STATUSES,
    APPLICATION_CRO_EDIT_SCOPES,
    APPLICATION_CRO_EXAMPLE_ROLES,
    APPLICATION_CRO_PHASES,
    APPLICATION_CRO_SPLITS,
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
    CounterfactualBaselineExample,
    CounterfactualBaselineKind,
    CounterfactualCandidatePlan,
    CounterfactualCandidateStatus,
    CounterfactualDivergenceSummary,
    CounterfactualEdit,
    CounterfactualEditScope,
    CounterfactualExampleResult,
    CounterfactualExampleRole,
    CounterfactualFailure,
    CounterfactualGateVerdict,
    CounterfactualSplit,
    CounterfactualTarget,
} from "./counterfactual-types.ts";
import {
    assertApplicationDigest,
    assertPlainDigest,
    canonical,
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
const [OPENED_PHASE, PROPOSAL_PHASE, CANDIDATE_PHASE, SELECTION_PHASE] = APPLICATION_CRO_PHASES;
const [ARCHIVED, EVALUATED, PROMOTED, REJECTED] = APPLICATION_CRO_CANDIDATE_STATUSES;
const [REQUEST_SCOPE] = APPLICATION_CRO_EDIT_SCOPES;
const PLAN_KEYS = [
    "candidate_id",
    "changes",
    "edit_scope",
    "edited_step_index",
    "fix_set",
    "guard_set",
    "iteration",
    "mechanism",
    "name",
    "parent_candidate_id",
    "patch",
    "prior",
    "rationale",
] as const;

/** Retained opened record body of one counterfactual optimization run. @internal */
export type CroOpenedBody = {
    readonly application_id: string;
    readonly baselines: readonly CounterfactualBaselineKind[];
    readonly budgets: Readonly<Record<string, number>>;
    readonly command_id: string;
    readonly examples: readonly CounterfactualBaselineExample[];
    readonly kind: typeof CRO_KIND;
    readonly phase: typeof OPENED_PHASE;
    readonly protocol_id: string;
    readonly thresholds: Readonly<Record<string, number>>;
};

/** Retained proposal record body. @internal */
export type CroProposalBody = {
    readonly application_id: string;
    readonly attempts: number;
    readonly candidates: readonly CounterfactualCandidatePlan[];
    readonly failure: CounterfactualFailure | null;
    readonly iteration: number;
    readonly parent_candidate_id: string | null;
    readonly phase: typeof PROPOSAL_PHASE;
    readonly proposer_session_ids: readonly string[];
    readonly reflection: SemanticValue;
    readonly refusals: readonly string[];
};

/** Retained candidate outcome record body. @internal */
export type CroCandidateBody = CounterfactualCandidatePlan & {
    readonly application_id: string;
    readonly cost: ApplicationCostSummary;
    readonly dev: readonly CounterfactualExampleResult[] | null;
    readonly dev_score: number | null;
    readonly failure: CounterfactualFailure | null;
    readonly gate: CounterfactualGateVerdict | null;
    readonly phase: typeof CANDIDATE_PHASE;
    readonly promotion_reference: number | null;
    readonly status: CounterfactualCandidateStatus;
    readonly targeted: readonly CounterfactualExampleResult[];
    readonly train: readonly CounterfactualExampleResult[] | null;
};

/** Retained selection record body. @internal */
export type CroSelectionBody = {
    readonly application_id: string;
    readonly dev_score: number;
    readonly phase: typeof SELECTION_PHASE;
    readonly pool: readonly string[];
    readonly selected_candidate_id: string | null;
};

/** Reads the phase of one retained optimizer body without validating the rest. @internal */
export function readCroPhase(body: RecordBody): string {
    return (body as unknown as { readonly phase?: unknown }).phase as string;
}

/** Validates a retained optimizer opened body. @internal */
export function readCroOpenedBody(body: RecordBody): CroOpenedBody {
    return decodeApplicationBody("counterfactual opened", () => {
        const fields = readVersionedBody(body, [
            "application_id",
            "baselines",
            "budgets",
            "command_id",
            "examples",
            "kind",
            "phase",
            "protocol_id",
            "thresholds",
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
        const baselines = readScopeArray(fields.baselines, "baselines");
        const examples = readScopeArray(fields.examples, "examples").map((entry, index) =>
            readBaselineExample(entry, `examples[${index}]`),
        );
        const [train] = APPLICATION_CRO_SPLITS;
        const firstDev = examples.findIndex((example) => example.split !== train);
        if (
            fields.kind !== CRO_KIND ||
            fields.phase !== OPENED_PHASE ||
            !baselines.every((kind) => APPLICATION_CRO_BASELINE_KINDS.includes(kind as never)) ||
            new Set(baselines).size !== baselines.length ||
            examples.length > config.limits.maxDatasetItems ||
            new Set(examples.map((example) => example.example_id)).size !== examples.length ||
            firstDev <= 0 ||
            examples.slice(firstDev).some((example) => example.split === train)
        ) {
            throw new TypeError(
                "opened kind, phase, baselines, or train-then-dev examples are inconsistent",
            );
        }
        return {
            ...fields,
            baselines,
            budgets: readNumberMap(fields.budgets, "budgets", true),
            examples,
            thresholds: readNumberMap(fields.thresholds, "thresholds", false),
        } as unknown as CroOpenedBody;
    });
}

/** Validates a retained proposal body. @internal */
export function readCroProposalBody(body: RecordBody): CroProposalBody {
    return decodeApplicationBody("counterfactual proposal", () => {
        const fields = readVersionedBody(body, [
            "application_id",
            "attempts",
            "candidates",
            "failure",
            "iteration",
            "parent_candidate_id",
            "phase",
            "proposer_session_ids",
            "reflection",
            "refusals",
        ]);
        assertApplicationDigest(
            fields.application_id,
            config.identity.applicationIdPrefix,
            "application_id",
        );
        const iteration = readCount(fields.iteration, "iteration");
        const attempts = readCount(fields.attempts, "attempts");
        const parent = readNullableCandidateId(fields.parent_candidate_id, "parent_candidate_id");
        const candidates = readScopeArray(fields.candidates, "candidates").map((plan, index) =>
            readCroPlan(plan, `candidates[${index}]`),
        );
        const sessions = readScopeArray(fields.proposer_session_ids, "proposer_session_ids");
        for (const [index, session] of sessions.entries()) {
            assertPrefixedDigest(
                session,
                replayIdentity.sessionIdPrefix,
                `proposer_session_ids[${index}]`,
            );
        }
        const refusals = readScopeArray(fields.refusals, "refusals").map((reason, index) =>
            readApplicationReason(reason, `refusals[${index}]`),
        );
        const failure = fields.failure === null ? null : readFailure(fields.failure);
        if (
            fields.phase !== PROPOSAL_PHASE ||
            attempts === 0 ||
            sessions.length > attempts ||
            new Set(sessions).size !== sessions.length ||
            refusals.length !== (failure === null ? attempts - 1 : attempts) ||
            (failure === null) === (candidates.length === 0) ||
            (failure !== null && (parent !== null || fields.reflection !== null)) ||
            new Set(candidates.map((plan) => plan.candidate_id)).size !== candidates.length ||
            candidates.some(
                (plan) => plan.iteration !== iteration || plan.parent_candidate_id !== parent,
            )
        ) {
            throw new TypeError("proposal phase, attempts, refusals, or candidate plans disagree");
        }
        return {
            ...fields,
            attempts,
            candidates,
            failure,
            iteration,
            parent_candidate_id: parent,
            proposer_session_ids: sessions,
            refusals,
        } as unknown as CroProposalBody;
    });
}

/** Validates a retained candidate outcome body. @internal */
export function readCroCandidateBody(body: RecordBody): CroCandidateBody {
    return decodeApplicationBody("counterfactual candidate", () => {
        const fields = readVersionedBody(body, [
            ...PLAN_KEYS,
            "application_id",
            "cost",
            "dev",
            "dev_score",
            "failure",
            "gate",
            "phase",
            "promotion_reference",
            "status",
            "targeted",
            "train",
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
        const status = fields.status as CounterfactualCandidateStatus;
        const targeted = readResults(fields.targeted, "targeted", plan);
        const dev = fields.dev === null ? null : readResults(fields.dev, "dev", plan);
        const train = fields.train === null ? null : readResults(fields.train, "train", plan);
        const gate = fields.gate === null ? null : readGate(fields.gate);
        const failure = fields.failure === null ? null : readFailure(fields.failure);
        const devScore = readNullableFinite(fields.dev_score, "dev_score");
        const reference = readNullableFinite(fields.promotion_reference, "promotion_reference");
        const [fixRole, guardRole, devRole, trainRole] = APPLICATION_CRO_EXAMPLE_ROLES;
        const settled = status !== REJECTED;
        const targetedRoles = [
            ...plan.fix_set.map(() => fixRole),
            ...plan.guard_set.map(() => guardRole),
        ];
        if (
            fields.phase !== CANDIDATE_PHASE ||
            !APPLICATION_CRO_CANDIDATE_STATUSES.includes(status) ||
            (status === REJECTED) !== (failure !== null) ||
            targeted.some(
                (result, index) =>
                    result.role !== targetedRoles[index] ||
                    result.example_id !== [...plan.fix_set, ...plan.guard_set][index],
            ) ||
            (dev ?? []).some((result) => result.role !== devRole) ||
            (train ?? []).some((result) => result.role !== trainRole) ||
            (settled && (gate === null || targeted.length !== targetedRoles.length)) ||
            (status === ARCHIVED && ((gate as CounterfactualGateVerdict).passed || dev !== null)) ||
            ((status === EVALUATED || status === PROMOTED) &&
                (!(gate as CounterfactualGateVerdict).passed ||
                    dev === null ||
                    devScore === null ||
                    reference === null)) ||
            (settled && (status === PROMOTED) !== (train !== null)) ||
            (settled && (dev === null) !== (devScore === null)) ||
            (devScore === null && reference !== null) ||
            (status === ARCHIVED && train !== null)
        ) {
            throw new TypeError("candidate phase, status, results, gate, or promotion disagree");
        }
        return {
            ...fields,
            ...plan,
            cost: Object.freeze({ ...readApplicationCosts(fields.cost) }),
            dev,
            dev_score: devScore,
            failure,
            gate,
            promotion_reference: reference,
            targeted,
            train,
        } as unknown as CroCandidateBody;
    });
}

/** Validates a retained selection body. @internal */
export function readCroSelectionBody(body: RecordBody): CroSelectionBody {
    return decodeApplicationBody("counterfactual selection", () => {
        const fields = readVersionedBody(body, [
            "application_id",
            "dev_score",
            "phase",
            "pool",
            "selected_candidate_id",
        ]);
        assertApplicationDigest(
            fields.application_id,
            config.identity.applicationIdPrefix,
            "application_id",
        );
        const pool = readScopeArray(fields.pool, "pool").map((id, index) => {
            assertApplicationDigest(id, config.identity.candidateIdPrefix, `pool[${index}]`);
            return id as string;
        });
        const selected = readNullableCandidateId(
            fields.selected_candidate_id,
            "selected_candidate_id",
        );
        if (
            fields.phase !== SELECTION_PHASE ||
            new Set(pool).size !== pool.length ||
            (selected !== null && !pool.includes(selected))
        ) {
            throw new TypeError("selection phase, pool, or selected candidate disagree");
        }
        return {
            ...fields,
            dev_score: readFinite(fields.dev_score, "dev_score"),
            pool,
            selected_candidate_id: selected,
        } as unknown as CroSelectionBody;
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

/**
 * Validates one untrusted proposed edit's shape: configured scope and changes, a count step index,
 * non-empty distinct fix set and distinct guard set disjoint from it, bounded texts, a prior in
 * `[0, 1]`, and a canonical patch. Example membership is checked by the optimizer.
 * @internal
 */
export function readCroEdit(value: unknown, subject: string): CounterfactualEdit {
    const fields = readScopeDataObject(
        value,
        [
            "changes",
            "fix_set",
            "guard_set",
            "mechanism",
            "name",
            "patch",
            "prior",
            "rationale",
            "scope",
            "step_index",
        ],
        subject,
    );
    if (!APPLICATION_CRO_EDIT_SCOPES.includes(fields.scope as never)) {
        throw new TypeError(`${subject}.scope must be a configured edit scope`);
    }
    assertScopeText(fields.name, `${subject}.name`);
    const fix = readExampleIds(fields.fix_set, `${subject}.fix_set`);
    const guard = readExampleIds(fields.guard_set, `${subject}.guard_set`);
    if (fix.length === 0 || guard.some((id) => fix.includes(id))) {
        throw new TypeError(`${subject} needs a non-empty fix set disjoint from its guard set`);
    }
    const prior = readFinite(fields.prior, `${subject}.prior`);
    if (prior < 0 || prior > 1) {
        throw new TypeError(`${subject}.prior must lie in [0, 1]`);
    }
    return Object.freeze({
        changes: readCroChanges(fields.changes, `${subject}.changes`),
        fix_set: fix,
        guard_set: guard,
        mechanism: readApplicationReason(fields.mechanism, `${subject}.mechanism`),
        name: fields.name,
        patch: JSON.parse(canonical(fields.patch)) as SemanticValue,
        prior,
        rationale: readApplicationReason(fields.rationale, `${subject}.rationale`),
        scope: fields.scope as CounterfactualEditScope,
        step_index: readCount(fields.step_index, `${subject}.step_index`),
    });
}

function readCroPlan(value: unknown, subject: string): CounterfactualCandidatePlan {
    const fields = readScopeDataObject(value, PLAN_KEYS, subject);
    assertApplicationDigest(
        fields.candidate_id,
        config.identity.candidateIdPrefix,
        `${subject}.candidate_id`,
    );
    const edit = readCroEdit(
        {
            changes: fields.changes,
            fix_set: fields.fix_set,
            guard_set: fields.guard_set,
            mechanism: fields.mechanism,
            name: fields.name,
            patch: fields.patch,
            prior: fields.prior,
            rationale: fields.rationale,
            scope: fields.edit_scope,
            step_index: fields.edited_step_index,
        },
        subject,
    );
    if (
        edit.changes.some(
            (change, index) => change !== (fields.changes as readonly unknown[])[index],
        ) ||
        canonical(edit.patch) !== canonical(fields.patch)
    ) {
        throw new TypeError(`${subject}.changes must be in configured order and patch canonical`);
    }
    return Object.freeze({
        candidate_id: fields.candidate_id as string,
        changes: edit.changes,
        edit_scope: edit.scope,
        edited_step_index: edit.step_index,
        fix_set: edit.fix_set,
        guard_set: edit.guard_set,
        iteration: readCount(fields.iteration, `${subject}.iteration`),
        mechanism: edit.mechanism,
        name: edit.name,
        parent_candidate_id: readNullableCandidateId(
            fields.parent_candidate_id,
            `${subject}.parent_candidate_id`,
        ),
        patch: edit.patch,
        prior: edit.prior,
        rationale: edit.rationale,
    });
}

function readBaselineExample(value: unknown, subject: string): CounterfactualBaselineExample {
    const fields = readScopeDataObject(
        value,
        ["example_id", "input_digest", "score", "session_id", "split"],
        subject,
    );
    assertScopeText(fields.example_id, `${subject}.example_id`);
    assertPlainDigest(fields.input_digest, `${subject}.input_digest`);
    assertPrefixedDigest(
        fields.session_id,
        replayIdentity.sessionIdPrefix,
        `${subject}.session_id`,
    );
    if (!APPLICATION_CRO_SPLITS.includes(fields.split as never)) {
        throw new TypeError(`${subject}.split must be a configured split`);
    }
    return Object.freeze({
        example_id: fields.example_id,
        input_digest: fields.input_digest as string,
        score: readFinite(fields.score, `${subject}.score`),
        session_id: fields.session_id as string,
        split: fields.split as CounterfactualSplit,
    });
}

function readResults(
    value: unknown,
    subject: string,
    plan: CounterfactualCandidatePlan,
): readonly CounterfactualExampleResult[] {
    const results = readScopeArray(value, subject).map((entry, index) =>
        readResult(entry, `${subject}[${index}]`, plan),
    );
    if (new Set(results.map((result) => result.example_id)).size !== results.length) {
        throw new TypeError(`${subject} must name distinct examples`);
    }
    return Object.freeze(results);
}

function readResult(
    value: unknown,
    subject: string,
    plan: CounterfactualCandidatePlan,
): CounterfactualExampleResult {
    const fields = readScopeDataObject(
        value,
        [
            "affected_steps",
            "baseline",
            "cost",
            "divergence",
            "example_id",
            "parent_score",
            "role",
            "score",
            "session_id",
            "target",
        ],
        subject,
    );
    assertScopeText(fields.example_id, `${subject}.example_id`);
    assertPrefixedDigest(
        fields.session_id,
        replayIdentity.sessionIdPrefix,
        `${subject}.session_id`,
    );
    if (!APPLICATION_CRO_EXAMPLE_ROLES.includes(fields.role as never)) {
        throw new TypeError(`${subject}.role must be a configured example role`);
    }
    const affected = readIndices(fields.affected_steps, `${subject}.affected_steps`);
    const target = readTarget(fields.target, `${subject}.target`);
    const divergence = readDivergence(fields.divergence, `${subject}.divergence`);
    if (
        (plan.edit_scope === REQUEST_SCOPE
            ? target.step_index !== plan.edited_step_index
            : target.step_index <= plan.edited_step_index ||
              (affected.length > 0 && affected[0] !== target.step_index)) ||
        (target.step_index === 0) !== (target.prefix_id === null) ||
        divergence.unexplained.length > 0 ||
        (divergence.first_divergence_index ?? target.step_index) < target.step_index
    ) {
        throw new TypeError(`${subject} target, affected steps, or divergence proof disagree`);
    }
    return Object.freeze({
        affected_steps: affected,
        baseline: fields.baseline === null ? null : readBaseline(fields.baseline, subject),
        cost: Object.freeze({ ...readApplicationCosts(fields.cost) }),
        divergence,
        example_id: fields.example_id,
        parent_score: readFinite(fields.parent_score, `${subject}.parent_score`),
        role: fields.role as CounterfactualExampleRole,
        score: readFinite(fields.score, `${subject}.score`),
        session_id: fields.session_id as string,
        target,
    });
}

function readGate(value: unknown): CounterfactualGateVerdict {
    const fields = readScopeDataObject(
        value,
        ["aggregate_lift", "improve_fraction", "max_guard_drop", "passed", "reason"],
        "gate",
    );
    if (typeof fields.passed !== "boolean") {
        throw new TypeError("gate.passed must be a boolean");
    }
    return Object.freeze({
        aggregate_lift: readFinite(fields.aggregate_lift, "gate.aggregate_lift"),
        improve_fraction: readFinite(fields.improve_fraction, "gate.improve_fraction"),
        max_guard_drop: readFinite(fields.max_guard_drop, "gate.max_guard_drop"),
        passed: fields.passed,
        reason: readApplicationReason(fields.reason, "gate.reason"),
    });
}

function readTarget(value: unknown, subject: string): CounterfactualTarget {
    const fields = readScopeDataObject(
        value,
        ["prefix_id", "source_session_id", "step_index"],
        subject,
    );
    if (fields.prefix_id !== null) {
        assertPrefixedDigest(
            fields.prefix_id,
            replayIdentity.prefixIdPrefix,
            `${subject}.prefix_id`,
        );
    }
    assertPrefixedDigest(
        fields.source_session_id,
        replayIdentity.sessionIdPrefix,
        `${subject}.source_session_id`,
    );
    return Object.freeze({
        prefix_id: fields.prefix_id as string | null,
        source_session_id: fields.source_session_id as string,
        step_index: readCount(fields.step_index, `${subject}.step_index`),
    });
}

function readDivergence(value: unknown, subject: string): CounterfactualDivergenceSummary {
    const fields = readScopeDataObject(
        value,
        [
            "common_prefix_id",
            "first_divergence_index",
            "live_steps",
            "recorded_steps",
            "unexplained",
        ],
        subject,
    );
    if (fields.common_prefix_id !== null) {
        assertPrefixedDigest(
            fields.common_prefix_id,
            replayIdentity.prefixIdPrefix,
            `${subject}.common_prefix_id`,
        );
    }
    return Object.freeze({
        common_prefix_id: fields.common_prefix_id as string | null,
        first_divergence_index:
            fields.first_divergence_index === null
                ? null
                : readCount(fields.first_divergence_index, `${subject}.first_divergence_index`),
        live_steps: readCount(fields.live_steps, `${subject}.live_steps`),
        recorded_steps: readCount(fields.recorded_steps, `${subject}.recorded_steps`),
        unexplained: readIndices(fields.unexplained, `${subject}.unexplained`),
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

function readBaseline(value: unknown, subject: string): CounterfactualBaselineComparison {
    const fields = readScopeDataObject(
        value,
        ["cache_read_input_tokens", "kind", "provider_calls", "session_id"],
        `${subject}.baseline`,
    );
    assertPrefixedDigest(
        fields.session_id,
        replayIdentity.sessionIdPrefix,
        `${subject}.baseline.session_id`,
    );
    if (!APPLICATION_CRO_BASELINE_KINDS.includes(fields.kind as never)) {
        throw new TypeError(`${subject}.baseline.kind must be a configured baseline kind`);
    }
    return Object.freeze({
        cache_read_input_tokens: readCount(
            fields.cache_read_input_tokens,
            `${subject}.baseline.cache_read_input_tokens`,
        ),
        kind: fields.kind as CounterfactualBaselineKind,
        provider_calls: readCount(fields.provider_calls, `${subject}.baseline.provider_calls`),
        session_id: fields.session_id as string,
    });
}

function readExampleIds(value: unknown, subject: string): readonly string[] {
    const ids = readScopeArray(value, subject).map((id, index) => {
        assertScopeText(id, `${subject}[${index}]`);
        return id;
    });
    if (new Set(ids).size !== ids.length || ids.length > config.limits.maxDatasetItems) {
        throw new TypeError(`${subject} must be distinct and within the dataset bound`);
    }
    return Object.freeze(ids);
}

function readNullableCandidateId(value: unknown, subject: string): string | null {
    if (value !== null) {
        assertApplicationDigest(value, config.identity.candidateIdPrefix, subject);
    }
    return value as string | null;
}

function readNumberMap(
    value: unknown,
    subject: string,
    integers: boolean,
): Readonly<Record<string, number>> {
    const keys = Object.keys(Object(value));
    const fields = readScopeDataObject(value, [], subject, keys);
    return Object.freeze(
        Object.fromEntries(
            keys.map((key) => [
                key,
                integers
                    ? readCount(fields[key], `${subject}.${key}`)
                    : readFinite(fields[key], `${subject}.${key}`),
            ]),
        ),
    );
}

function readFinite(value: unknown, subject: string): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new TypeError(`${subject} must be a finite number`);
    }
    return value;
}

function readNullableFinite(value: unknown, subject: string): number | null {
    return value === null ? null : readFinite(value, subject);
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
