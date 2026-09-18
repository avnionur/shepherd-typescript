import { createHash } from "node:crypto";

import {
    canonicalizeSemanticValue,
    createRecordId,
    type SemanticRecord,
    type SemanticValue,
} from "../canonical/canonical-record.ts";
import { createCanonicalSnapshot } from "../canonical/snapshot.ts";
import {
    createChildRunId,
    readDelegationCitations,
    readDelegationData,
    readDelegationReason,
    readSupervisorId,
} from "../delegation/records.ts";
import {
    applicationsProtocolConfig,
    delegationProtocolConfig,
    workspaceProtocolConfig,
} from "../protocol/config.ts";
import {
    APPLICATION_KINDS,
    APPLICATION_SUPERVISION_CONFLICT_KINDS,
    APPLICATION_SUPERVISION_PHASES,
    APPLICATION_SUPERVISION_POLICY_KINDS,
    APPLICATION_SUPERVISION_WORKER_STATUSES,
    DELEGATION_STATUSES,
    RECORD_MODES,
    REPLAY_STEP_KINDS,
    REPLAY_STEP_SOURCES,
    RUN_TERMINAL_STATUSES,
} from "../protocol/values.generated.ts";
import { assertRecordId } from "../record/guards.ts";
import { ROOT_WITNESS_ID } from "../record/root-witness.ts";
import type { RecordBody, RecordId } from "../record/types.ts";
import type { ReplaySessionInspection } from "../replay/types.ts";
import type { RunUsage } from "../run/usage-types.ts";
import {
    assertPrefixedDigest,
    assertScopeText,
    readScopeArray,
    readScopeDataObject,
} from "../scope/validation.ts";
import type { StoreAppendRequest } from "../store/types.ts";
import { readTraceSubscriptionCursor } from "../supervision/records.ts";
import { ApplicationEvidenceError } from "./errors.ts";
import type {
    CodingSupervisorConflict,
    CodingSupervisorDecision,
    CodingSupervisorEvidence,
    CodingSupervisorObservation,
} from "./supervisor-types.ts";
import type { ApplicationCostSummary, ApplicationKind } from "./types.ts";

const config = applicationsProtocolConfig;
const [CAPTURE_MODE] = RECORD_MODES;
const [PROVIDER_STEP] = REPLAY_STEP_KINDS;
const [LIVE_SOURCE] = REPLAY_STEP_SOURCES;
const [CODING_SUPERVISOR_KIND] = APPLICATION_KINDS;
const [OPENED_PHASE, DECISION_PHASE] = APPLICATION_SUPERVISION_PHASES;
const [OBSERVE_KIND, INJECT_KIND, HANDOFF_KIND, DISCARD_RESTART_KIND, ACCEPT_KIND] =
    APPLICATION_SUPERVISION_POLICY_KINDS;
const DIGEST_HEX_LENGTH = createHash(config.identity.digestAlgorithm).digest("hex").length;
const VERSION_FIELDS = {
    application_version: config.recordVersion,
    compatibility_version: config.compatibilityVersion,
} as const;

/** Retained opened record body of one coding supervisor run. @internal */
export type ApplicationOpenedBody = {
    readonly application_id: string;
    readonly application_version: number;
    readonly command_id: string;
    readonly compatibility_version: string;
    readonly kind: ApplicationKind;
    readonly phase: (typeof APPLICATION_SUPERVISION_PHASES)[0];
    readonly protocol_id: string;
    readonly supervisor_id: string;
    readonly workers: readonly { readonly handle_id: string; readonly worker_id: string }[];
    readonly world: boolean;
};

/** Retained decision record body of one coding supervisor round. @internal */
export type ApplicationDecisionBody = {
    readonly application_id: string;
    readonly application_version: number;
    readonly compatibility_version: string;
    readonly conflict: CodingSupervisorConflict;
    readonly decision: CodingSupervisorDecision;
    readonly evidence: CodingSupervisorEvidence;
    readonly observations: readonly CodingSupervisorObservation[];
    readonly phase: (typeof APPLICATION_SUPERVISION_PHASES)[1];
    readonly round: number;
    readonly supervisor_id: string;
};

type Unversioned<T> = Omit<T, keyof typeof VERSION_FIELDS>;

/** Canonical text of one semantic value for exact comparison. @internal */
export function canonical(value: unknown): string {
    return canonicalizeSemanticValue(value as SemanticValue);
}

/** Digest of one canonical semantic value under the configured algorithm. @internal */
export function applicationDigest(value: SemanticValue): string {
    return `${config.identity.digestAlgorithm}:${digestHex(value)}`;
}

/** Configured-prefix identity of one canonical semantic value. @internal */
export function prefixedApplicationId(prefix: string, value: SemanticValue): string {
    return `${prefix}${digestHex(value)}`;
}

/** Validates one configured-prefix application identity or plain digest. @internal */
export function assertApplicationDigest(value: unknown, prefix: string, subject: string): void {
    if (typeof value !== "string") {
        throw new TypeError(`${subject} must be a string`);
    }
    const hex = value.slice(prefix.length);
    if (
        !value.startsWith(prefix) ||
        hex.length !== DIGEST_HEX_LENGTH ||
        !/^[0-9a-f]+$/u.test(hex)
    ) {
        throw new TypeError(`${subject} must be a configured ${prefix} identifier`);
    }
}

/** Validates one plain content digest. @internal */
export function assertPlainDigest(value: unknown, subject: string): void {
    assertApplicationDigest(value, `${config.identity.digestAlgorithm}:`, subject);
}

/** Derives the globally idempotent identity of one command an application issues. @internal */
export function createApplicationCommandId(
    applicationId: string,
    step: string,
    fields: SemanticRecord,
): string {
    return createRecordId({
        [config.identity.commandAppendIntentKind]: {
            application_id: applicationId,
            step,
            ...fields,
        },
    });
}

/** Derives the append intent naming one application record. @internal */
export function createApplicationAppendIntentId(applicationId: string, step: string): string {
    return createRecordId({
        [config.identity.commandAppendIntentKind]: { application_id: applicationId, step },
    });
}

/** Derives the terminal cut identity published through one manifest record. @internal */
export function createApplicationCutId(manifestId: string): string {
    return prefixedApplicationId(config.identity.cutIdPrefix, { manifest_id: manifestId });
}

/** Builds one single-record append on an application owner path. @internal */
export function createApplicationAppendRequest(
    appendIntentId: string,
    ownerId: string,
    body: RecordBody,
    schemaRef: string,
    causes: readonly RecordId[],
): StoreAppendRequest {
    return {
        append_intent_id: appendIntentId,
        batch: {
            groups: [
                {
                    owner_id: ownerId,
                    records: [
                        {
                            body,
                            caused_by_record_ids: causes,
                            mode: CAPTURE_MODE,
                            schema_ref: schemaRef,
                            witness_ref: ROOT_WITNESS_ID,
                        },
                    ],
                },
            ],
        },
    };
}

/** Folds observed run usage into a measured cost summary. @internal */
export function foldApplicationCosts(
    usages: readonly RunUsage[],
    providerCalls: number,
): ApplicationCostSummary {
    let cacheCreation = 0;
    let cacheRead = 0;
    let input = 0;
    let output = 0;
    let cost: number | null = 0;
    for (const usage of usages) {
        cacheCreation += usage.cache_creation_input_tokens;
        cacheRead += usage.cache_read_input_tokens;
        input += usage.input_tokens;
        output += usage.output_tokens;
        cost = cost === null || usage.cost_usd === null ? null : cost + usage.cost_usd;
    }
    return Object.freeze({
        cache_creation_input_tokens: cacheCreation,
        cache_read_input_tokens: cacheRead,
        cost_usd: cost,
        input_tokens: input,
        output_tokens: output,
        provider_calls: providerCalls,
    });
}

/** Measured cost summary of no work. @internal */
export const ZERO_APPLICATION_COST: ApplicationCostSummary = foldApplicationCosts([], 0);

/**
 * Adds two measured cost summaries; `cost_usd` is null when either side is null, because an unknown
 * cost cannot be summed into a known one. @internal
 */
export function addApplicationCosts(
    left: ApplicationCostSummary,
    right: ApplicationCostSummary,
): ApplicationCostSummary {
    return Object.freeze({
        cache_creation_input_tokens:
            left.cache_creation_input_tokens + right.cache_creation_input_tokens,
        cache_read_input_tokens: left.cache_read_input_tokens + right.cache_read_input_tokens,
        cost_usd:
            left.cost_usd === null || right.cost_usd === null
                ? null
                : left.cost_usd + right.cost_usd,
        input_tokens: left.input_tokens + right.input_tokens,
        output_tokens: left.output_tokens + right.output_tokens,
        provider_calls: left.provider_calls + right.provider_calls,
    });
}

/**
 * Measures the live provider steps of one replay session: each is one provider call folded from its
 * observed response usage. A live call that failed before a response retains no usage, so it adds
 * no tokens and makes `cost_usd` null: its cost is unknown, never zero. Recorded (journal-served)
 * steps cost nothing. @internal
 */
export function measureReplaySessionCost(session: ReplaySessionInspection): ApplicationCostSummary {
    let costs = ZERO_APPLICATION_COST;
    for (const step of session.steps) {
        if (step.source === LIVE_SOURCE && step.kind === PROVIDER_STEP) {
            const usage = step.provider?.response?.usage;
            costs = addApplicationCosts(
                costs,
                usage === undefined
                    ? { ...ZERO_APPLICATION_COST, cost_usd: null, provider_calls: 1 }
                    : {
                          cache_creation_input_tokens: usage.cacheCreationInputTokens,
                          cache_read_input_tokens: usage.cacheReadInputTokens,
                          cost_usd: usage.costUsd,
                          input_tokens: usage.inputTokens,
                          output_tokens: usage.outputTokens,
                          provider_calls: 1,
                      },
            );
        }
    }
    return costs;
}

/** Validates one measured cost summary. @internal */
export function readApplicationCosts(value: unknown): ApplicationCostSummary {
    const fields = readScopeDataObject(
        value,
        [
            "cache_creation_input_tokens",
            "cache_read_input_tokens",
            "cost_usd",
            "input_tokens",
            "output_tokens",
            "provider_calls",
        ],
        "costs",
    );
    for (const key of [
        "cache_creation_input_tokens",
        "cache_read_input_tokens",
        "input_tokens",
        "output_tokens",
        "provider_calls",
    ]) {
        readCount(fields[key], `costs.${key}`);
    }
    if (
        fields.cost_usd !== null &&
        (typeof fields.cost_usd !== "number" ||
            !Number.isFinite(fields.cost_usd) ||
            fields.cost_usd < 0)
    ) {
        throw new TypeError("costs.cost_usd must be null or a non-negative finite number");
    }
    return fields as unknown as ApplicationCostSummary;
}

/** Validates one non-negative safe integer. @internal */
export function readCount(value: unknown, subject: string): number {
    if (!Number.isSafeInteger(value) || (value as number) < 0) {
        throw new TypeError(`${subject} must be a non-negative safe integer`);
    }
    return value as number;
}

/** Validates one dense array of distinct changed paths within the configured bound. @internal */
export function readChangedPaths(value: unknown, subject: string): readonly string[] {
    const paths = readScopeArray(value, subject).map((path, index) => {
        assertScopeText(path, `${subject}[${index}]`);
        return path;
    });
    if (
        paths.length > workspaceProtocolConfig.changesets.maxChanges ||
        new Set(paths).size !== paths.length
    ) {
        throw new TypeError(`${subject} must be distinct and within the configured bound`);
    }
    return Object.freeze(paths);
}

/** Validates one retained supervision reason within the configured bound. @internal */
export function readApplicationReason(value: unknown, subject: string): string {
    assertScopeText(value, subject);
    if (value.length > config.limits.maxReasonLength) {
        throw new TypeError(`${subject} exceeds the configured length bound`);
    }
    return value;
}

/** Creates one canonical application body carrying the configured version fields. @internal */
export function createVersionedApplicationBody(
    fields: Readonly<Record<string, unknown>>,
): RecordBody {
    return createCanonicalSnapshot({ ...VERSION_FIELDS, ...fields } as unknown as RecordBody);
}

/** Creates one retained opened body. @internal */
export function createApplicationOpenedBody(
    fields: Unversioned<ApplicationOpenedBody>,
): RecordBody {
    return createCanonicalSnapshot({ ...VERSION_FIELDS, ...fields } as unknown as RecordBody);
}

/** Creates one retained decision body. @internal */
export function createApplicationDecisionBody(
    fields: Unversioned<ApplicationDecisionBody>,
): RecordBody {
    return createCanonicalSnapshot({ ...VERSION_FIELDS, ...fields } as unknown as RecordBody);
}

/** Validates a retained opened body. @internal */
export function readApplicationOpenedBody(body: RecordBody): ApplicationOpenedBody {
    return decodeApplicationBody("opened", () => {
        const fields = readVersionedBody(body, [
            "application_id",
            "command_id",
            "kind",
            "phase",
            "protocol_id",
            "supervisor_id",
            "workers",
            "world",
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
        readSupervisorId(fields.supervisor_id, "supervisor_id");
        const workers = readScopeArray(fields.workers, "workers").map((worker, index) => {
            const entry = readScopeDataObject(
                worker,
                ["handle_id", "worker_id"],
                `workers[${index}]`,
            );
            assertPrefixedDigest(
                entry.handle_id,
                delegationProtocolConfig.identity.handleIdPrefix,
                `workers[${index}].handle_id`,
            );
            assertScopeText(entry.worker_id, `workers[${index}].worker_id`);
            return Object.freeze({
                handle_id: entry.handle_id as string,
                worker_id: entry.worker_id,
            });
        });
        if (
            fields.kind !== CODING_SUPERVISOR_KIND ||
            fields.phase !== OPENED_PHASE ||
            typeof fields.world !== "boolean" ||
            workers.length < config.limits.minWorkers ||
            workers.length > config.limits.maxWorkers ||
            new Set(workers.map((worker) => worker.worker_id)).size !== workers.length
        ) {
            throw new TypeError("opened kind, phase, world flag, or workers are inconsistent");
        }
        return { ...fields, workers } as unknown as ApplicationOpenedBody;
    });
}

/** Validates a retained decision body. @internal */
export function readApplicationDecisionBody(body: RecordBody): ApplicationDecisionBody {
    return decodeApplicationBody("decision", () => {
        const fields = readVersionedBody(body, [
            "application_id",
            "conflict",
            "decision",
            "evidence",
            "observations",
            "phase",
            "round",
            "supervisor_id",
        ]);
        assertApplicationDigest(
            fields.application_id,
            config.identity.applicationIdPrefix,
            "application_id",
        );
        readSupervisorId(fields.supervisor_id, "supervisor_id");
        const round = readCount(fields.round, "round");
        if (fields.phase !== DECISION_PHASE || round < 1 || round > config.limits.maxRounds) {
            throw new TypeError("decision phase or round is inconsistent");
        }
        const observations = readScopeArray(fields.observations, "observations").map(
            (observation, index) => readObservation(observation, `observations[${index}]`),
        );
        if (
            observations.length < config.limits.minWorkers ||
            observations.length > config.limits.maxWorkers ||
            new Set(observations.map((observation) => observation.worker_id)).size !==
                observations.length
        ) {
            throw new TypeError("observations must name each worker exactly once");
        }
        const decision = readSupervisorDecision(fields.decision);
        const evidence = readEvidence(fields.evidence);
        if (decision.kind !== evidence.kind) {
            throw new TypeError("decision and evidence kinds differ");
        }
        return {
            ...fields,
            conflict: readConflict(fields.conflict),
            decision,
            evidence,
            observations,
            round,
        } as unknown as ApplicationDecisionBody;
    });
}

function readObservation(value: unknown, subject: string): CodingSupervisorObservation {
    const fields = readScopeDataObject(
        value,
        [
            "attempt",
            "changed_paths",
            "child_run_id",
            "completion_status",
            "custody_id",
            "delivered_cursor",
            "handle_id",
            "head_record_id",
            "status",
            "supervisor_id",
            "worker_id",
            "worker_status",
        ],
        subject,
    );
    const attempt = readCount(fields.attempt, `${subject}.attempt`);
    assertPrefixedDigest(
        fields.handle_id,
        delegationProtocolConfig.identity.handleIdPrefix,
        `${subject}.handle_id`,
    );
    assertRecordId(fields.head_record_id, `${subject}.head_record_id`);
    readSupervisorId(fields.supervisor_id, `${subject}.supervisor_id`);
    assertScopeText(fields.worker_id, `${subject}.worker_id`);
    if (fields.custody_id !== null) {
        assertScopeText(fields.custody_id, `${subject}.custody_id`);
    }
    if (
        attempt < 1 ||
        fields.child_run_id !== createChildRunId(fields.handle_id as string) ||
        !DELEGATION_STATUSES.includes(fields.status as never) ||
        !APPLICATION_SUPERVISION_WORKER_STATUSES.includes(fields.worker_status as never) ||
        (fields.completion_status !== null &&
            !RUN_TERMINAL_STATUSES.includes(fields.completion_status as never))
    ) {
        throw new TypeError(`${subject} attempt, identities, or statuses are inconsistent`);
    }
    return Object.freeze({
        ...fields,
        changed_paths: readChangedPaths(fields.changed_paths, `${subject}.changed_paths`),
        delivered_cursor: readTraceSubscriptionCursor(fields.delivered_cursor),
    }) as unknown as CodingSupervisorObservation;
}

function readConflict(value: unknown): CodingSupervisorConflict {
    const fields = readScopeDataObject(value, ["kind", "paths", "worker_ids"], "conflict");
    const paths = readChangedPaths(fields.paths, "conflict.paths");
    const workerIds = readScopeArray(fields.worker_ids, "conflict.worker_ids").map(
        (workerId, index) => {
            assertScopeText(workerId, `conflict.worker_ids[${index}]`);
            return workerId;
        },
    );
    if (
        !APPLICATION_SUPERVISION_CONFLICT_KINDS.includes(fields.kind as never) ||
        workerIds.length > config.limits.maxWorkers ||
        new Set(workerIds).size !== workerIds.length ||
        (paths.length === 0) !== (fields.kind === APPLICATION_SUPERVISION_CONFLICT_KINDS[0]) ||
        (workerIds.length === 0) !== (paths.length === 0)
    ) {
        throw new TypeError("conflict kind, paths, and workers are inconsistent");
    }
    return Object.freeze({
        kind: fields.kind as CodingSupervisorConflict["kind"],
        paths,
        worker_ids: Object.freeze(workerIds),
    });
}

/** Validates one policy or retained decision. @internal */
export function readSupervisorDecision(value: unknown): CodingSupervisorDecision {
    const kind = kindOf(value);
    if (kind === OBSERVE_KIND) {
        readScopeDataObject(value, ["kind"], "decision");
        return Object.freeze({ kind: OBSERVE_KIND });
    }
    if (kind === INJECT_KIND) {
        const fields = readScopeDataObject(
            value,
            ["cited_record_ids", "data", "kind", "worker_id"],
            "decision",
        );
        assertScopeText(fields.worker_id, "decision.worker_id");
        return Object.freeze({
            cited_record_ids: readDelegationCitations(
                fields.cited_record_ids,
                "decision.cited_record_ids",
                delegationProtocolConfig.limits.maxCitedRecords,
            ),
            data: readDelegationData(fields.data),
            kind: INJECT_KIND,
            worker_id: fields.worker_id,
        });
    }
    if (kind === HANDOFF_KIND) {
        const fields = readScopeDataObject(
            value,
            ["kind", "reason", "successor_supervisor_id", "worker_id"],
            "decision",
        );
        assertScopeText(fields.worker_id, "decision.worker_id");
        return Object.freeze({
            kind: HANDOFF_KIND,
            reason: readDelegationReason(fields.reason, "decision.reason"),
            successor_supervisor_id: readSupervisorId(
                fields.successor_supervisor_id,
                "decision.successor_supervisor_id",
            ),
            worker_id: fields.worker_id,
        });
    }
    if (kind === DISCARD_RESTART_KIND) {
        const fields = readScopeDataObject(value, ["kind", "reason", "worker_id"], "decision");
        assertScopeText(fields.worker_id, "decision.worker_id");
        return Object.freeze({
            kind: DISCARD_RESTART_KIND,
            reason: readApplicationReason(fields.reason, "decision.reason"),
            worker_id: fields.worker_id,
        });
    }
    const fields = readScopeDataObject(value, ["kind", "worker_id"], "decision");
    if (fields.kind !== ACCEPT_KIND) {
        throw new TypeError("decision kind is not configured");
    }
    assertScopeText(fields.worker_id, "decision.worker_id");
    return Object.freeze({ kind: ACCEPT_KIND, worker_id: fields.worker_id });
}

function readEvidence(value: unknown): CodingSupervisorEvidence {
    const kind = kindOf(value);
    if (kind === OBSERVE_KIND) {
        readScopeDataObject(value, ["kind"], "evidence");
        return Object.freeze({ kind: OBSERVE_KIND });
    }
    if (kind === INJECT_KIND) {
        const fields = readScopeDataObject(value, ["injection_record_id", "kind"], "evidence");
        assertRecordId(fields.injection_record_id, "evidence.injection_record_id");
        return Object.freeze({
            injection_record_id: fields.injection_record_id,
            kind: INJECT_KIND,
        });
    }
    if (kind === HANDOFF_KIND) {
        const fields = readScopeDataObject(value, ["handoff_record_id", "kind"], "evidence");
        assertRecordId(fields.handoff_record_id, "evidence.handoff_record_id");
        return Object.freeze({ handoff_record_id: fields.handoff_record_id, kind: HANDOFF_KIND });
    }
    if (kind === DISCARD_RESTART_KIND) {
        const fields = readScopeDataObject(
            value,
            [
                "decision_record_id",
                "discard_receipt_id",
                "fork_receipt_id",
                "kind",
                "retry_cut_id",
                "successor_handle_id",
            ],
            "evidence",
        );
        assertRecordId(fields.decision_record_id, "evidence.decision_record_id");
        assertPrefixedDigest(
            fields.retry_cut_id,
            delegationProtocolConfig.identity.retryCutIdPrefix,
            "evidence.retry_cut_id",
        );
        assertPrefixedDigest(
            fields.successor_handle_id,
            delegationProtocolConfig.identity.handleIdPrefix,
            "evidence.successor_handle_id",
        );
        return Object.freeze({
            decision_record_id: fields.decision_record_id,
            discard_receipt_id: readNullableText(
                fields.discard_receipt_id,
                "evidence.discard_receipt_id",
            ),
            fork_receipt_id: readNullableText(fields.fork_receipt_id, "evidence.fork_receipt_id"),
            kind: DISCARD_RESTART_KIND,
            retry_cut_id: fields.retry_cut_id as string,
            successor_handle_id: fields.successor_handle_id as string,
        });
    }
    const fields = readScopeDataObject(
        value,
        ["decision_record_id", "discarded", "kind", "merge_receipt_id"],
        "evidence",
    );
    if (fields.kind !== ACCEPT_KIND) {
        throw new TypeError("evidence kind is not configured");
    }
    assertRecordId(fields.decision_record_id, "evidence.decision_record_id");
    const discarded = readScopeArray(fields.discarded, "evidence.discarded").map((entry, index) => {
        const subject = `evidence.discarded[${index}]`;
        const worker = readScopeDataObject(
            entry,
            ["decision_record_id", "discard_receipt_id", "worker_id"],
            subject,
        );
        assertRecordId(worker.decision_record_id, `${subject}.decision_record_id`);
        assertScopeText(worker.worker_id, `${subject}.worker_id`);
        return Object.freeze({
            decision_record_id: worker.decision_record_id,
            discard_receipt_id: readNullableText(
                worker.discard_receipt_id,
                `${subject}.discard_receipt_id`,
            ),
            worker_id: worker.worker_id,
        });
    });
    if (discarded.length >= config.limits.maxWorkers) {
        throw new TypeError("evidence.discarded exceeds the configured worker bound");
    }
    return Object.freeze({
        decision_record_id: fields.decision_record_id,
        discarded: Object.freeze(discarded),
        kind: ACCEPT_KIND,
        merge_receipt_id: readNullableText(fields.merge_receipt_id, "evidence.merge_receipt_id"),
    });
}

/** Validates one nullable non-empty text. @internal */
export function readNullableText(value: unknown, subject: string): string | null {
    if (value === null) {
        return null;
    }
    assertScopeText(value, subject);
    return value;
}

function kindOf(value: unknown): unknown {
    return (value as { readonly kind?: unknown } | null)?.kind;
}

/** Decodes one retained application body, wrapping every refusal as invalid evidence. @internal */
export function decodeApplicationBody<T>(subject: string, read: () => T): T {
    try {
        return read();
    } catch (error) {
        throw new ApplicationEvidenceError(`${subject} evidence is malformed`, { cause: error });
    }
}

/** Validates the version fields and exact keys of one retained application body. @internal */
export function readVersionedBody(
    body: RecordBody,
    keys: readonly string[],
): Record<string, unknown> {
    const fields = readScopeDataObject(
        body,
        ["application_version", "compatibility_version", ...keys],
        "application record",
    );
    if (
        fields.compatibility_version !== config.compatibilityVersion ||
        fields.application_version !== config.recordVersion
    ) {
        throw new TypeError("application record version is unsupported");
    }
    return fields;
}

function digestHex(value: SemanticValue): string {
    return createHash(config.identity.digestAlgorithm)
        .update(canonicalizeSemanticValue(value), "utf8")
        .digest("hex");
}
