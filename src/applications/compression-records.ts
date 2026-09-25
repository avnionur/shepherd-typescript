import { canonicalizeSemanticValue, type SemanticValue } from "../canonical/canonical-record.ts";
import { createCanonicalSnapshot } from "../canonical/snapshot.ts";
import {
    applicationsProtocolConfig,
    delegationProtocolConfig,
    replayProtocolConfig,
} from "../protocol/config.ts";
import {
    APPLICATION_COMPRESSION_BASELINE_KINDS,
    APPLICATION_COMPRESSION_CANDIDATE_KINDS,
    APPLICATION_COMPRESSION_CANDIDATE_STATUSES,
    APPLICATION_COMPRESSION_FORK_STEP_POLICIES,
    APPLICATION_COMPRESSION_OUTCOMES,
    APPLICATION_COMPRESSION_PHASES,
    APPLICATION_COMPRESSION_VERDICTS,
    APPLICATION_KINDS,
    REPLAY_CHECKPOINT_CLASSIFICATIONS,
    REPLAY_CHECKPOINT_CONSTITUENT_KINDS,
    REPLAY_CHECKPOINT_EVIDENCE_STATUSES,
} from "../protocol/values.generated.ts";
import { assertRecordId } from "../record/guards.ts";
import type { RecordBody } from "../record/types.ts";
import type { ReplaySessionInspection } from "../replay/types.ts";
import {
    assertPrefixedDigest,
    assertScopeText,
    readScopeArray,
    readScopeDataObject,
} from "../scope/validation.ts";
import type {
    TrajectoryCompressionBaselineKind,
    TrajectoryCompressionCandidateRecord,
    TrajectoryCompressionFailure,
    TrajectoryCompressionOutcomeRecord,
    TrajectoryCompressionProposal,
    TrajectoryCompressionVerdict,
    TrajectoryForkClamp,
    TrajectoryForkPoint,
    TrajectoryForkStepPolicy,
    TrajectoryHint,
    TrajectoryRestoreConstituent,
    TrajectoryRestoreEvidence,
} from "./compression-types.ts";
import {
    assertApplicationDigest,
    assertPlainDigest,
    decodeApplicationBody,
    readApplicationCosts,
    readApplicationReason,
    readCount,
    readNullableText,
    readVersionedBody,
} from "./records.ts";

const config = applicationsProtocolConfig;
const compression = config.compression;
const replayIdentity = replayProtocolConfig.identity;
const [, , COMPRESSION_KIND] = APPLICATION_KINDS;
const [OPENED_PHASE, CANDIDATE_PHASE, OUTCOME_PHASE] = APPLICATION_COMPRESSION_PHASES;
const [COMPRESSION_CANDIDATE, CONTROL_CANDIDATE] = APPLICATION_COMPRESSION_CANDIDATE_KINDS;
const [, , UNAVAILABLE_CLASSIFICATION] = REPLAY_CHECKPOINT_CLASSIFICATIONS;
const [ACCEPTED] = APPLICATION_COMPRESSION_VERDICTS;
const [CLAMP_POLICY] = APPLICATION_COMPRESSION_FORK_STEP_POLICIES;
const CANDIDATE_KEYS = [
    "candidate",
    "compressor_handle_id",
    "cost",
    "failure",
    "fork_clamp",
    "fork_id",
    "fork_point",
    "hint_digest",
    "outcome",
    "reason",
    "restoration_session_id",
    "restore",
    "score",
    "seed",
    "session_id",
    "status",
    "step_count",
    "verdict",
    "verifier_handle_id",
] as const;
/**
 * Presence of the candidate fields, in order: compressor handle, fork point, hint digest, restore,
 * session, restoration session, verifier handle, verdict, score, reason, step count, cost, and
 * failure; `1` requires a value, `0` requires null, and `?` admits either.
 */
const PRESENCE_FIELDS = [
    "compressor_handle_id",
    "fork_point",
    "hint_digest",
    "restore",
    "session_id",
    "restoration_session_id",
    "verifier_handle_id",
    "verdict",
    "score",
    "reason",
    "step_count",
    "cost",
    "failure",
] as const;
const [PROPOSED, REWOUND, SETTLED, REJECTED] = APPLICATION_COMPRESSION_CANDIDATE_STATUSES;
const [PRUNED, NO_PRUNE, RESTORED] = APPLICATION_COMPRESSION_OUTCOMES;
const PRESENCE: Readonly<Record<string, string>> = {
    [`${COMPRESSION_CANDIDATE}:${PROPOSED}:`]: "1??0000000000",
    [`${COMPRESSION_CANDIDATE}:${REWOUND}:`]: "11?1000000000",
    [`${COMPRESSION_CANDIDATE}:${SETTLED}:${NO_PRUNE}`]: "1???000001110",
    [`${COMPRESSION_CANDIDATE}:${SETTLED}:${PRUNED}`]: "11?1101111110",
    [`${COMPRESSION_CANDIDATE}:${SETTLED}:${RESTORED}`]: "11?111???1110",
    [`${COMPRESSION_CANDIDATE}:${REJECTED}:`]: "1????0?000001",
    [`${CONTROL_CANDIDATE}:${SETTLED}:`]: "0000101111110",
    [`${CONTROL_CANDIDATE}:${REJECTED}:`]: "0000?0?000001",
};

/** Retained opened record body of one trajectory compression run. @internal */
export type CompressionOpenedBody = {
    readonly application_id: string;
    readonly baselines: readonly TrajectoryCompressionBaselineKind[];
    readonly command_id: string;
    readonly controls: readonly number[];
    readonly kind: typeof COMPRESSION_KIND;
    readonly phase: typeof OPENED_PHASE;
    readonly protocol_id: string;
    readonly source_session_id: string;
};

/** Retained candidate record body of one trajectory compression run. @internal */
export type CompressionCandidateBody = Omit<TrajectoryCompressionCandidateRecord, "record_id"> & {
    readonly application_id: string;
    readonly phase: typeof CANDIDATE_PHASE;
};

/** Retained aggregate outcome record body of one trajectory compression run. @internal */
export type CompressionOutcomeBody = Omit<TrajectoryCompressionOutcomeRecord, "record_id"> & {
    readonly application_id: string;
    readonly phase: typeof OUTCOME_PHASE;
};

/** Validates a retained compression opened body. @internal */
export function readCompressionOpenedBody(body: RecordBody): CompressionOpenedBody {
    return decodeApplicationBody("trajectory compression opened", () => {
        const fields = readVersionedBody(body, [
            "application_id",
            "baselines",
            "command_id",
            "controls",
            "kind",
            "phase",
            "protocol_id",
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
        const baselines = readCompressionBaselines(fields.baselines);
        const controls = readScopeArray(fields.controls, "controls");
        if (
            fields.kind !== COMPRESSION_KIND ||
            fields.phase !== OPENED_PHASE ||
            canonical(baselines) !== canonical(fields.baselines) ||
            !controls.every((seed) => Number.isSafeInteger(seed)) ||
            new Set(controls).size !== controls.length ||
            controls.length > config.limits.maxBestOfN
        ) {
            throw new TypeError("opened kind, phase, baselines, or control seeds are inconsistent");
        }
        return Object.freeze({
            ...fields,
            baselines,
            controls: Object.freeze(controls as number[]),
        }) as unknown as CompressionOpenedBody;
    });
}

/** Validates a retained compression candidate body. @internal */
export function readCompressionCandidateBody(body: RecordBody): CompressionCandidateBody {
    return decodeApplicationBody("trajectory compression candidate", () => {
        const fields = readVersionedBody(body, ["application_id", "phase", ...CANDIDATE_KEYS]);
        assertApplicationDigest(
            fields.application_id,
            config.identity.applicationIdPrefix,
            "application_id",
        );
        for (const key of ["compressor_handle_id", "verifier_handle_id"]) {
            if (fields[key] !== null) {
                assertPrefixedDigest(
                    fields[key],
                    delegationProtocolConfig.identity.handleIdPrefix,
                    key,
                );
            }
        }
        for (const key of ["session_id", "restoration_session_id"]) {
            if (fields[key] !== null) {
                assertPrefixedDigest(fields[key], replayIdentity.sessionIdPrefix, key);
            }
        }
        if (fields.fork_id !== null) {
            assertApplicationDigest(fields.fork_id, config.identity.forkPointIdPrefix, "fork_id");
        }
        if (fields.hint_digest !== null) {
            assertPlainDigest(fields.hint_digest, "hint_digest");
        }
        if (fields.seed !== null && !Number.isSafeInteger(fields.seed)) {
            throw new TypeError("seed must be null or a safe integer");
        }
        if (fields.score !== null && !Number.isFinite(fields.score)) {
            throw new TypeError("score must be null or a finite number");
        }
        const record = {
            ...fields,
            cost:
                fields.cost === null
                    ? null
                    : Object.freeze({ ...readApplicationCosts(fields.cost) }),
            failure: fields.failure === null ? null : readFailure(fields.failure),
            fork_clamp: fields.fork_clamp === null ? null : readForkClamp(fields.fork_clamp),
            fork_point: fields.fork_point === null ? null : readForkPoint(fields.fork_point),
            reason: fields.reason === null ? null : readApplicationReason(fields.reason, "reason"),
            restore: fields.restore === null ? null : readRestore(fields.restore),
            step_count:
                fields.step_count === null ? null : readCount(fields.step_count, "step_count"),
        } as unknown as CompressionCandidateBody;
        const presence = PRESENCE_FIELDS.map((key) =>
            (record as unknown as Record<string, unknown>)[key] === null ? "0" : "1",
        ).join("");
        const expected =
            PRESENCE[
                `${String(fields.candidate)}:${String(fields.status)}:${fields.outcome ?? ""}`
            ];
        const restore = record.restore;
        const clamp = record.fork_clamp;
        const forkPoint = record.fork_point;
        if (
            [
                fields.phase !== CANDIDATE_PHASE,
                clamp !== null &&
                    (forkPoint === null ||
                        (clamp.proposed_step_index < 0
                            ? forkPoint.step_index !== 0
                            : clamp.proposed_step_index <= forkPoint.step_index)),
                expected === undefined,
                [...(expected ?? "")].some(
                    (flag, index) => flag !== "?" && flag !== presence[index],
                ),
                (fields.candidate === COMPRESSION_CANDIDATE) !== (fields.seed === null),
                (fields.fork_id === null) !== (record.fork_point === null),
                (fields.verdict === null) !== (fields.score === null),
                fields.verdict !== null &&
                    !APPLICATION_COMPRESSION_VERDICTS.includes(fields.verdict as never),
                fields.outcome === PRUNED && fields.verdict !== ACCEPTED,
                fields.outcome === RESTORED && fields.verdict === ACCEPTED,
                restore !== null &&
                    ((restore.classification === UNAVAILABLE_CLASSIFICATION) !==
                        (restore.rewind_session_id === null) ||
                        (restore.rewind_session_id === null) !==
                            (restore.restore_record_id === null)),
                restore !== null &&
                    fields.outcome === NO_PRUNE &&
                    restore.rewind_session_id !== null,
                restore !== null && fields.status === REWOUND && restore.rewind_session_id === null,
                restore !== null &&
                    (fields.outcome === PRUNED || fields.outcome === RESTORED) &&
                    restore.rewind_session_id === null,
            ].includes(true)
        ) {
            throw new TypeError("candidate phase, status, outcome, or retained evidence disagree");
        }
        return Object.freeze(record);
    });
}

/** Validates a retained compression outcome body. @internal */
export function readCompressionOutcomeBody(body: RecordBody): CompressionOutcomeBody {
    return decodeApplicationBody("trajectory compression outcome", () => {
        const fields = readVersionedBody(body, [
            "application_id",
            "baseline",
            "control",
            "original_step_count",
            "outcome",
            "phase",
            "result_session_id",
            "result_step_count",
            "step_count_ratio",
        ]);
        assertApplicationDigest(
            fields.application_id,
            config.identity.applicationIdPrefix,
            "application_id",
        );
        assertPrefixedDigest(
            fields.result_session_id,
            replayIdentity.sessionIdPrefix,
            "result_session_id",
        );
        const original = readCount(fields.original_step_count, "original_step_count");
        const result = readCount(fields.result_step_count, "result_step_count");
        const baseline =
            fields.baseline === null
                ? null
                : readComparison(fields.baseline, "baseline", ["kind"], original);
        const control =
            fields.control === null
                ? null
                : readComparison(fields.control, "control", ["seed"], original);
        if (
            [
                fields.phase !== OUTCOME_PHASE,
                !APPLICATION_COMPRESSION_OUTCOMES.includes(fields.outcome as never),
                original === 0,
                fields.step_count_ratio !== stepCountRatio(result, original),
                baseline !== null &&
                    !APPLICATION_COMPRESSION_BASELINE_KINDS.includes(baseline.kind as never),
                control !== null && !Number.isSafeInteger(control.seed),
            ].includes(true)
        ) {
            throw new TypeError("outcome phase, kind, step counts, or comparisons disagree");
        }
        return Object.freeze({ ...fields, baseline, control }) as unknown as CompressionOutcomeBody;
    });
}

/**
 * Validates one untrusted compressor proposal against the closed fork-point and hint grammar.
 *
 * Both fields are optional. An absent or null fork point, or a fork point without `step_index`, is
 * a missing fork step and validates to a null fork point (Appendix D.6: it settles `no_prune`). A
 * present step index is any safe integer; range is resolved by {@link resolveTrajectoryProposal}.
 *
 * @internal
 */
export function readTrajectoryProposal(value: unknown): TrajectoryCompressionProposal {
    const fields = readScopeDataObject(value, [], "proposal", ["fork_point", "hint"]);
    const forkPoint = fields.fork_point == null ? null : readProposedForkPoint(fields.fork_point);
    const hint = fields.hint == null ? null : readHint(fields.hint);
    return Object.freeze({ fork_point: forkPoint, hint });
}

/**
 * Resolves a validated proposal against the finished source session under a fork-step policy.
 *
 * A null fork point resolves to null (settled `no_prune` by the caller). A fork point must name the
 * source session. With `n` source steps, a step index in `[0, n - 1]` must carry the retained
 * prefix identity (null for step `0`, which restarts from the initial prefix). An index outside that
 * range is refused under the reject policy; under the clamp policy it is moved to the nearest bound
 * (`0` below, `n - 1` above), the fork point takes the retained prefix identity at that bound, and
 * the clamp is returned as retained evidence. Every cited hint step must exist in the source.
 *
 * @param proposal - Proposal validated by {@link readTrajectoryProposal}.
 * @param source - Finished source session inspection.
 * @param policy - Configured fork-step policy.
 * @returns The resolved fork point and clamp evidence, both null for a missing fork step.
 * @throws {TypeError} If the fork point names another session, an in-range prefix identity differs
 * from the retained one, the source retains no step, the reject policy refuses an out-of-range step,
 * or the hint cites a step outside the source.
 * @internal
 */
export function resolveTrajectoryProposal(
    proposal: TrajectoryCompressionProposal,
    source: Pick<ReplaySessionInspection, "session_id" | "steps">,
    policy: TrajectoryForkStepPolicy,
): {
    readonly fork_clamp: TrajectoryForkClamp | null;
    readonly fork_point: TrajectoryForkPoint | null;
} {
    const { fork_point: proposed, hint } = proposal;
    const steps = source.steps;
    // Cited indices are non-negative and strictly ascending by the grammar.
    if (hint?.cited_step_indices.some((index) => index >= steps.length)) {
        throw new TypeError("hint cites a step outside the source session");
    }
    if (proposed === null) {
        return Object.freeze({ fork_clamp: null, fork_point: null });
    }
    if (proposed.session_id !== source.session_id) {
        throw new TypeError("fork point must name a step boundary of the source session");
    }
    if (steps.length === 0) {
        throw new TypeError("the source session retains no step boundary to fork from");
    }
    const prefixAt = (index: number) =>
        index === 0 ? null : (steps[index - 1] as { readonly prefix_id: string }).prefix_id;
    const index = proposed.step_index;
    if (index >= 0 && index < steps.length) {
        if (proposed.prefix_id !== prefixAt(index)) {
            throw new TypeError("fork point prefix identity does not equal the retained prefix");
        }
        return Object.freeze({ fork_clamp: null, fork_point: proposed });
    }
    if (policy !== CLAMP_POLICY) {
        throw new TypeError(
            `fork point step ${index} is outside [0, ${steps.length - 1}] and the ${policy} fork-step policy refuses it`,
        );
    }
    const clamped = index < 0 ? 0 : steps.length - 1;
    return Object.freeze({
        fork_clamp: Object.freeze({
            policy,
            proposed_prefix_id: proposed.prefix_id,
            proposed_step_index: index,
        }),
        fork_point: Object.freeze({
            prefix_id: prefixAt(clamped),
            session_id: proposed.session_id,
            step_index: clamped,
        }),
    });
}

/** Validates one untrusted verifier verdict. @internal */
export function readTrajectoryVerdict(value: unknown): {
    readonly reason: string;
    readonly score: number;
    readonly verdict: TrajectoryCompressionVerdict;
} {
    const fields = readScopeDataObject(value, ["reason", "score", "verdict"], "verdict");
    if (
        !APPLICATION_COMPRESSION_VERDICTS.includes(fields.verdict as never) ||
        typeof fields.score !== "number" ||
        !Number.isFinite(fields.score)
    ) {
        throw new TypeError("verdict must name a configured verdict and a finite score");
    }
    return Object.freeze({
        reason: readApplicationReason(fields.reason, "verdict.reason"),
        score: fields.score,
        verdict: fields.verdict as TrajectoryCompressionVerdict,
    });
}

/**
 * Reads the canonical JSON text a delegated child returned in its configured output field.
 *
 * @internal
 */
export function readChildOutputText(value: unknown): unknown {
    const fields = readScopeDataObject(value, [compression.childFields.output], "child output");
    const text = fields[compression.childFields.output];
    assertScopeText(text, "child output text");
    return JSON.parse(text) as unknown;
}

/** Measured step-count ratio of one session against the original. @internal */
export function stepCountRatio(steps: number, original: number): number {
    return steps / original;
}

/** Validates one configured baseline list in configured order. @internal */
export function readCompressionBaselines(
    value: unknown,
): readonly TrajectoryCompressionBaselineKind[] {
    const declared = readScopeArray(value, "baselines");
    const baselines = APPLICATION_COMPRESSION_BASELINE_KINDS.filter((kind) =>
        declared.includes(kind),
    );
    if (baselines.length !== declared.length) {
        throw new TypeError("baselines must be distinct configured baseline kinds");
    }
    return Object.freeze(baselines);
}

/** Canonical text of one semantic value. @internal */
export function canonical(value: unknown): string {
    return canonicalizeSemanticValue(value as SemanticValue);
}

/** Canonical frozen copy of one semantic value. @internal */
export function snapshot<T>(value: T): T {
    return createCanonicalSnapshot(value as unknown as RecordBody) as unknown as T;
}

function readForkPoint(value: unknown): TrajectoryForkPoint {
    const fields = readScopeDataObject(
        value,
        ["prefix_id", "session_id", "step_index"],
        "fork_point",
    );
    const stepIndex = readCount(fields.step_index, "fork_point.step_index");
    if ((stepIndex === 0) !== (fields.prefix_id === null)) {
        throw new TypeError("fork_point.prefix_id must be null exactly at step 0");
    }
    return readForkPointFields(fields, stepIndex);
}

/** Reads a proposed fork point; a missing `step_index` is a missing fork step (null). */
function readProposedForkPoint(value: unknown): TrajectoryForkPoint | null {
    const fields = readScopeDataObject(value, ["prefix_id", "session_id"], "fork_point", [
        "step_index",
    ]);
    if (fields.step_index === undefined) {
        return null;
    }
    if (!Number.isSafeInteger(fields.step_index)) {
        throw new TypeError("fork_point.step_index must be a safe integer");
    }
    return readForkPointFields(fields, fields.step_index as number);
}

function readForkPointFields(
    fields: Record<string, unknown>,
    stepIndex: number,
): TrajectoryForkPoint {
    if (fields.prefix_id !== null) {
        assertPrefixedDigest(
            fields.prefix_id,
            replayIdentity.prefixIdPrefix,
            "fork_point.prefix_id",
        );
    }
    assertPrefixedDigest(
        fields.session_id,
        replayIdentity.sessionIdPrefix,
        "fork_point.session_id",
    );
    return Object.freeze({
        prefix_id: fields.prefix_id as string | null,
        session_id: fields.session_id as string,
        step_index: stepIndex,
    });
}

function readForkClamp(value: unknown): TrajectoryForkClamp {
    const fields = readScopeDataObject(
        value,
        ["policy", "proposed_prefix_id", "proposed_step_index"],
        "fork_clamp",
    );
    if (fields.policy !== CLAMP_POLICY || !Number.isSafeInteger(fields.proposed_step_index)) {
        throw new TypeError("fork_clamp must name the clamp policy and a safe integer step");
    }
    if (fields.proposed_prefix_id !== null) {
        assertPrefixedDigest(
            fields.proposed_prefix_id,
            replayIdentity.prefixIdPrefix,
            "fork_clamp.proposed_prefix_id",
        );
    }
    return Object.freeze({
        policy: fields.policy as TrajectoryForkStepPolicy,
        proposed_prefix_id: fields.proposed_prefix_id as string | null,
        proposed_step_index: fields.proposed_step_index as number,
    });
}

function readHint(value: unknown): TrajectoryHint {
    const fields = readScopeDataObject(value, ["cited_step_indices", "text"], "hint");
    assertScopeText(fields.text, "hint.text");
    const cited = readScopeArray(fields.cited_step_indices, "hint.cited_step_indices").map(
        (index, position) => readCount(index, `hint.cited_step_indices[${position}]`),
    );
    if (
        Buffer.byteLength(fields.text, "utf8") > config.limits.maxPromptBytes ||
        cited.length > replayProtocolConfig.limits.maxSteps ||
        cited.some((index, position) => position > 0 && index <= (cited[position - 1] as number))
    ) {
        throw new TypeError(
            "hint text must fit the prompt bound and cited steps must be strictly ascending",
        );
    }
    return Object.freeze({ cited_step_indices: Object.freeze(cited), text: fields.text });
}

function readRestore(value: unknown): TrajectoryRestoreEvidence {
    const fields = readScopeDataObject(
        value,
        ["classification", "constituents", "restore_record_id", "rewind_session_id"],
        "restore",
    );
    if (fields.restore_record_id !== null) {
        assertRecordId(fields.restore_record_id, "restore.restore_record_id");
    }
    if (fields.rewind_session_id !== null) {
        assertPrefixedDigest(
            fields.rewind_session_id,
            replayIdentity.sessionIdPrefix,
            "restore.rewind_session_id",
        );
    }
    const constituents = readScopeArray(fields.constituents, "restore.constituents").map(
        (entry, index): TrajectoryRestoreConstituent => {
            const subject = `restore.constituents[${index}]`;
            const constituent = readScopeDataObject(
                entry,
                ["kind", "name", "reason", "status"],
                subject,
            );
            if (
                !REPLAY_CHECKPOINT_CONSTITUENT_KINDS.includes(constituent.kind as never) ||
                !REPLAY_CHECKPOINT_EVIDENCE_STATUSES.includes(constituent.status as never)
            ) {
                throw new TypeError(`${subject} must name a configured kind and status`);
            }
            return Object.freeze({
                kind: constituent.kind,
                name: readNullableText(constituent.name, `${subject}.name`),
                reason: readNullableText(constituent.reason, `${subject}.reason`),
                status: constituent.status,
            }) as TrajectoryRestoreConstituent;
        },
    );
    if (
        !REPLAY_CHECKPOINT_CLASSIFICATIONS.includes(fields.classification as never) ||
        constituents.length === 0
    ) {
        throw new TypeError("restore must name a configured classification and constituents");
    }
    return Object.freeze({
        classification: fields.classification,
        constituents: Object.freeze(constituents),
        restore_record_id: fields.restore_record_id,
        rewind_session_id: fields.rewind_session_id,
    }) as TrajectoryRestoreEvidence;
}

function readFailure(value: unknown): TrajectoryCompressionFailure {
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

function readComparison(
    value: unknown,
    subject: string,
    extra: readonly string[],
    original: number,
): Readonly<Record<string, unknown>> & {
    readonly kind?: unknown;
    readonly seed?: unknown;
} {
    const fields = readScopeDataObject(
        value,
        [...extra, "session_id", "step_count", "step_count_ratio"],
        subject,
    );
    assertPrefixedDigest(
        fields.session_id,
        replayIdentity.sessionIdPrefix,
        `${subject}.session_id`,
    );
    const steps = readCount(fields.step_count, `${subject}.step_count`);
    if (fields.step_count_ratio !== stepCountRatio(steps, original)) {
        throw new TypeError(`${subject}.step_count_ratio must be the measured ratio`);
    }
    return Object.freeze({ ...fields });
}
