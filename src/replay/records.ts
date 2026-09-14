import {
    canonicalizeSemanticValue,
    createRecordId,
    type SemanticRecord,
    type SemanticValue,
} from "../canonical/canonical-record.ts";
import { createCanonicalSnapshot } from "../canonical/snapshot.ts";
import { createIntentReference, validateEffectCorrelation } from "../effect/records.ts";
import type { EffectIntent, EffectOutcome } from "../effect/types.ts";
import { readEffectIntent } from "../effect/validation.ts";
import { replayProtocolConfig } from "../protocol/config.ts";
import {
    REPLAY_CACHE_STATUSES,
    REPLAY_CHANGE_DIMENSIONS,
    REPLAY_CHECKPOINT_CLASSIFICATIONS,
    REPLAY_CHECKPOINT_CONSTITUENT_KINDS,
    REPLAY_CHECKPOINT_EVIDENCE_STATUSES,
    REPLAY_EFFECT_DISPOSITIONS,
    REPLAY_MODES,
    REPLAY_PROCESS_BACKENDS,
    REPLAY_STEP_KINDS,
    REPLAY_STEP_SOURCES,
    REPLAY_TERMINAL_STATUSES,
} from "../protocol/values.generated.ts";
import type { ModelRequest, ProviderDescriptor } from "../provider/types.ts";
import {
    readModelRequest,
    readModelResponse,
    readProviderDescriptor,
} from "../provider/validation.ts";
import { assertRecordId } from "../record/guards.ts";
import type { RecordBody, RecordId } from "../record/types.ts";
import {
    assertPrefixedDigest,
    assertScopeText,
    readScopeArray,
    readScopeDataObject,
} from "../scope/validation.ts";
import { readTaskArtifactLock } from "../task/registry-codec.ts";
import { ReplayCompatibilityError, ReplayEvidenceError } from "./errors.ts";
import type {
    ReplayCacheEvidence,
    ReplayChangeDimension,
    ReplayCheckpointClassification,
    ReplayCheckpointClassificationResult,
    ReplayConstituent,
    ReplayEffectApproval,
    ReplayEffectDisposition,
    ReplayMode,
    ReplayProcessBackend,
    ReplaySessionTask,
    ReplayStepFailure,
    ReplayStepKind,
    ReplayStepSource,
    ReplayTerminalStatus,
} from "./types.ts";

const config = replayProtocolConfig;
const [ROOT_MODE] = REPLAY_MODES;
const [PROVIDER_KIND, EFFECT_KIND] = REPLAY_STEP_KINDS;
const [, RECORDED_SOURCE] = REPLAY_STEP_SOURCES;
const [MATERIALIZED, , REFUSED] = REPLAY_EFFECT_DISPOSITIONS;
const [HIT_STATUS, NOT_OBSERVED_STATUS] = REPLAY_CACHE_STATUSES;
const [ATOMIC, RECONSTRUCTIVE_CLASSIFICATION, UNAVAILABLE_CLASSIFICATION] =
    REPLAY_CHECKPOINT_CLASSIFICATIONS;
const [VERIFIED, RECONSTRUCTIVE, NOT_APPLICABLE, UNAVAILABLE] = REPLAY_CHECKPOINT_EVIDENCE_STATUSES;
const [FINISHED_STATUS] = REPLAY_TERMINAL_STATUSES;

/** Retained session record body. @internal */
export type ReplaySessionBody = {
    readonly command_id: string;
    readonly compatibility_version: string;
    readonly mode: ReplayMode;
    readonly origin: ReplayOriginBody | null;
    readonly processes: readonly {
        readonly backend: ReplayProcessBackend;
        readonly process_id: string;
    }[];
    readonly program_id: string;
    readonly provider: ProviderDescriptor | null;
    readonly provider_session_adapter_id: string | null;
    readonly replay_version: number;
    readonly session_id: string;
    readonly task: ReplaySessionTask | null;
    readonly worlds: readonly string[];
};

/** Retained branch origin. @internal */
export type ReplayOriginBody = {
    readonly changes: readonly ReplayChangeDimension[];
    readonly replacement_task: ReplaySessionTask | null;
    readonly source_session_id: string;
    readonly source_session_record_id: RecordId;
    readonly target_checkpoint_id: string | null;
    readonly target_step_count: number;
    readonly target_trace_cut_id: string;
};

/** Retained provider step detail. @internal */
export type ReplayProviderStepBody = {
    readonly cache: ReplayCacheEvidence | null;
    readonly context_prefix_id: string;
    readonly failure: ReplayStepFailure | null;
    readonly prompt_id: string;
    readonly request: ModelRequest;
    readonly response: {
        readonly output: SemanticValue;
        readonly usage: ReplayProviderUsage;
    } | null;
    readonly response_id: string;
};

/** Retained provider usage. @internal */
export type ReplayProviderUsage = {
    readonly cacheCreationInputTokens: number;
    readonly cacheReadInputTokens: number;
    readonly costUsd: number | null;
    readonly inputTokens: number;
    readonly outputTokens: number;
};

/** Retained effect step detail. @internal */
export type ReplayEffectStepBody = {
    readonly approval: ReplayEffectApproval | null;
    readonly disposition: ReplayEffectDisposition;
    readonly failure: ReplayStepFailure | null;
    readonly handler_id: string | null;
    readonly intent: EffectIntent;
    readonly intent_ref: string;
    readonly outcome: EffectOutcome | null;
    readonly refusal_reason: string | null;
};

/** Retained step record body. @internal */
export type ReplayStepBody = {
    readonly compatibility_version: string;
    readonly depends_on: readonly number[];
    readonly effect: ReplayEffectStepBody | null;
    readonly index: number;
    readonly kind: ReplayStepKind;
    readonly prefix_id: string;
    readonly provider: ReplayProviderStepBody | null;
    readonly replay_version: number;
    readonly session_id: string;
    readonly source: ReplayStepSource;
    readonly source_step_record_id: RecordId | null;
    readonly step_id: string;
};

/** Retained admission record body. @internal */
export type ReplayAdmissionBody = {
    readonly compatibility_version: string;
    readonly index: number;
    readonly intent_ref: string;
    readonly replay_version: number;
    readonly session_id: string;
};

/** Retained checkpoint record body. @internal */
export type ReplayCheckpointBody = {
    readonly checkpoint_id: string;
    readonly classification: ReplayCheckpointClassification;
    readonly compatibility_version: string;
    readonly constituents: readonly ReplayConstituent[];
    readonly context_prefix_id: string | null;
    readonly prefix_id: string | null;
    readonly replay_version: number;
    readonly session_id: string;
    readonly step_count: number;
    readonly trace_cut_id: string;
};

/** Retained restore record body. @internal */
export type ReplayRestoreBody = {
    readonly classification: ReplayCheckpointClassification;
    readonly compatibility_version: string;
    readonly constituents: readonly ReplayConstituent[];
    readonly context_prefix_id: string | null;
    readonly prefix_id: string | null;
    readonly replay_version: number;
    readonly session_id: string;
};

/** Retained terminal record body. @internal */
export type ReplayTerminalBody = {
    readonly compatibility_version: string;
    readonly failure: ReplayStepFailure | null;
    readonly prefix_id: string | null;
    readonly replay_version: number;
    readonly result: { readonly value: SemanticValue } | null;
    readonly session_id: string;
    readonly status: ReplayTerminalStatus;
    readonly step_count: number;
};

const VERSION_FIELDS = {
    compatibility_version: config.compatibilityVersion,
    replay_version: config.recordVersion,
} as const;

/** Derives the owner path and identity of one replay session command. @internal */
export function createReplaySessionId(commandId: string): string {
    assertScopeText(commandId, "commandId");
    return prefixed(config.identity.sessionIdPrefix, { replay_session: { command_id: commandId } });
}

/** Derives the append intent naming one step of one replay command. @internal */
export function createReplayAppendIntentId(commandId: string, step: string): string {
    return createRecordId({
        [config.identity.commandAppendIntentKind]: { command_id: commandId, step },
    });
}

/** Derives the checkpoint identity of one session boundary. @internal */
export function createReplayCheckpointId(sessionId: string, stepCount: number): string {
    return prefixed(config.identity.checkpointIdPrefix, {
        replay_checkpoint: { session_id: sessionId, step_count: stepCount },
    });
}

/** Derives the cut identity a publisher retains for one target prefix. @internal */
export function createReplayCutId(
    publisherSessionId: string,
    targetSessionId: string,
    stepCount: number,
): string {
    return prefixed(config.identity.cutIdPrefix, {
        replay_cut: {
            publisher: publisherSessionId,
            step_count: stepCount,
            target: targetSessionId,
        },
    });
}

/** Derives the prompt identity of one canonical provider request. @internal */
export function createReplayPromptId(request: ModelRequest): string {
    return prefixed(config.identity.promptIdPrefix, {
        replay_prompt: request as unknown as SemanticRecord,
    });
}

/** Derives the response identity of one provider output or failure. @internal */
export function createReplayResponseId(
    response: { readonly output: SemanticValue } | { readonly failure: ReplayStepFailure },
): string {
    return prefixed(config.identity.responseIdPrefix, {
        replay_response: response as unknown as SemanticRecord,
    });
}

/** Derives the content identity of one provider step. @internal */
export function createReplayProviderStepId(promptId: string, responseId: string): string {
    return prefixed(config.identity.stepIdPrefix, {
        replay_step: { kind: PROVIDER_KIND, prompt_id: promptId, response_id: responseId },
    });
}

/** Derives the content identity of one effect step. @internal */
export function createReplayEffectStepId(
    intentRef: string,
    disposition: ReplayEffectDisposition,
    outcome: EffectOutcome | null,
    failure: ReplayStepFailure | null,
): string {
    return prefixed(config.identity.stepIdPrefix, {
        replay_step: {
            disposition,
            failure,
            intent_ref: intentRef,
            kind: EFFECT_KIND,
            outcome: outcome as unknown as SemanticRecord,
        },
    });
}

/** Chains one step identity onto the previous session prefix identity. @internal */
export function createReplayPrefixId(previous: string | null, stepId: string): string {
    return prefixed(config.identity.prefixIdPrefix, {
        replay_prefix: { previous, step_id: stepId },
    });
}

/** Chains one provider exchange onto the previous context prefix identity. @internal */
export function createReplayContextPrefixId(
    previous: string | null,
    promptId: string,
    responseId: string,
): string {
    return prefixed(config.identity.contextPrefixIdPrefix, {
        replay_context: { previous, prompt_id: promptId, response_id: responseId },
    });
}

/** Derives the identity of an ordered irreversible-effect frontier. @internal */
export function createReplayFrontierId(
    entries: readonly {
        readonly effect_id: string;
        readonly intent_ref: string;
        readonly step_index: number;
    }[],
): string {
    return prefixed(config.identity.frontierIdPrefix, {
        replay_frontier: { entries: entries as unknown as SemanticValue },
    });
}

/** Derives cache evidence from observed usage. @internal */
export function createReplayCacheEvidence(
    usage: ReplayProviderUsage,
    identity: string | null,
    priorContextPrefixId: string | null,
): ReplayCacheEvidence {
    return Object.freeze({
        creation_input_tokens: usage.cacheCreationInputTokens,
        identity,
        prior_context_prefix_id: priorContextPrefixId,
        read_input_tokens: usage.cacheReadInputTokens,
        status: usage.cacheReadInputTokens > 0 ? HIT_STATUS : NOT_OBSERVED_STATUS,
    }) as ReplayCacheEvidence;
}

/** Creates one retained session body. @internal */
export function createReplaySessionBody(
    fields: Omit<ReplaySessionBody, keyof typeof VERSION_FIELDS>,
): RecordBody {
    return snapshot({ ...VERSION_FIELDS, ...fields });
}

/** Creates one retained step body. @internal */
export function createReplayStepBody(
    fields: Omit<ReplayStepBody, keyof typeof VERSION_FIELDS>,
): RecordBody {
    return snapshot({ ...VERSION_FIELDS, ...fields });
}

/** Creates one retained admission body. @internal */
export function createReplayAdmissionBody(
    sessionId: string,
    index: number,
    intentRef: string,
): RecordBody {
    return snapshot({ ...VERSION_FIELDS, index, intent_ref: intentRef, session_id: sessionId });
}

/** Creates one retained checkpoint body. @internal */
export function createReplayCheckpointBody(
    fields: Omit<ReplayCheckpointBody, keyof typeof VERSION_FIELDS | "classification">,
): RecordBody {
    return snapshot({
        ...VERSION_FIELDS,
        ...fields,
        classification: classifyReplayConstituents(fields.constituents).classification,
    });
}

/** Creates one retained restore body. @internal */
export function createReplayRestoreBody(
    fields: Omit<ReplayRestoreBody, keyof typeof VERSION_FIELDS | "classification">,
): RecordBody {
    return snapshot({
        ...VERSION_FIELDS,
        ...fields,
        classification: classifyReplayConstituents(fields.constituents).classification,
    });
}

/** Creates one retained terminal body. @internal */
export function createReplayTerminalBody(
    fields: Omit<ReplayTerminalBody, keyof typeof VERSION_FIELDS>,
): RecordBody {
    return snapshot({ ...VERSION_FIELDS, ...fields });
}

/**
 * Derives a classification from retained constituents.
 *
 * `atomic` requires every constituent verified or not applicable, `reconstructive` requires none
 * unavailable, and any unavailable constituent classifies the whole as `unavailable`.
 *
 * @internal
 */
export function classifyReplayConstituents(
    constituents: readonly ReplayConstituent[],
): ReplayCheckpointClassificationResult {
    const named = (status: string) =>
        Object.freeze(
            constituents
                .filter((constituent) => constituent.status === status)
                .map((constituent) =>
                    Object.freeze({ kind: constituent.kind, name: constituent.name }),
                ),
        );
    const unavailable = Object.freeze(
        constituents
            .filter((constituent) => constituent.status === UNAVAILABLE)
            .map((constituent) =>
                Object.freeze({
                    kind: constituent.kind,
                    name: constituent.name,
                    reason: constituent.reason as string,
                }),
            ),
    );
    const reconstructive = named(RECONSTRUCTIVE);
    return Object.freeze({
        classification:
            unavailable.length > 0
                ? UNAVAILABLE_CLASSIFICATION
                : reconstructive.length > 0
                  ? RECONSTRUCTIVE_CLASSIFICATION
                  : ATOMIC,
        not_applicable: named(NOT_APPLICABLE),
        reconstructive,
        unavailable,
        verified: named(VERIFIED),
    }) as ReplayCheckpointClassificationResult;
}

/** Validates a retained session body. @internal */
export function readReplaySessionBody(body: RecordBody): ReplaySessionBody {
    return decode("session", body, () => {
        const fields = readVersionedBody(body, [
            "command_id",
            "mode",
            "origin",
            "processes",
            "program_id",
            "provider",
            "provider_session_adapter_id",
            "session_id",
            "task",
            "worlds",
        ]);
        assertScopeText(fields.command_id, "command_id");
        assertScopeText(fields.program_id, "program_id");
        if (fields.provider_session_adapter_id !== null) {
            assertScopeText(fields.provider_session_adapter_id, "provider_session_adapter_id");
        }
        if (fields.provider !== null) {
            readProviderDescriptor(fields.provider);
        }
        readReplayWorldNames(fields.worlds);
        readReplayProcesses(fields.processes);
        const task = fields.task === null ? null : readReplayTask(fields.task);
        const origin = fields.origin === null ? null : readOrigin(fields.origin);
        if (
            fields.session_id !== createReplaySessionId(fields.command_id) ||
            !includes(REPLAY_MODES, fields.mode) ||
            (fields.mode === ROOT_MODE) !== (origin === null)
        ) {
            throw new TypeError("session identity, mode, or origin is inconsistent");
        }
        return { ...fields, origin, task } as unknown as ReplaySessionBody;
    });
}

/** Validates a retained step body, including every derived identity. @internal */
export function readReplayStepBody(body: RecordBody): ReplayStepBody {
    return decode("step", body, () => {
        const fields = readVersionedBody(body, [
            "depends_on",
            "effect",
            "index",
            "kind",
            "prefix_id",
            "provider",
            "session_id",
            "source",
            "source_step_record_id",
            "step_id",
        ]);
        assertSessionId(fields.session_id);
        assertIndex(fields.index, "index");
        readReplayDependencies(fields.depends_on, fields.index as number);
        assertPrefixedDigest(fields.prefix_id, config.identity.prefixIdPrefix, "prefix_id");
        const recorded = fields.source === RECORDED_SOURCE;
        if (recorded) {
            assertRecordId(fields.source_step_record_id, "source_step_record_id");
        }
        if (
            !includes(REPLAY_STEP_SOURCES, fields.source) ||
            (!recorded && fields.source_step_record_id !== null)
        ) {
            throw new TypeError("step source is inconsistent");
        }
        let stepId: string;
        if (fields.kind === PROVIDER_KIND && fields.effect === null) {
            const provider = readProviderStep(fields.provider);
            stepId = createReplayProviderStepId(provider.prompt_id, provider.response_id);
        } else if (fields.kind === EFFECT_KIND && fields.provider === null) {
            const effect = readEffectStep(fields.effect);
            stepId = createReplayEffectStepId(
                effect.intent_ref,
                effect.disposition,
                effect.outcome,
                effect.failure,
            );
        } else {
            throw new TypeError("step kind and detail are inconsistent");
        }
        if (fields.step_id !== stepId) {
            throw new TypeError("step identity does not match its content");
        }
        return fields as unknown as ReplayStepBody;
    });
}

/** Validates a retained admission body. @internal */
export function readReplayAdmissionBody(body: RecordBody): ReplayAdmissionBody {
    return decode("admission", body, () => {
        const fields = readVersionedBody(body, ["index", "intent_ref", "session_id"]);
        assertSessionId(fields.session_id);
        assertIndex(fields.index, "index");
        assertScopeText(fields.intent_ref, "intent_ref");
        return fields as unknown as ReplayAdmissionBody;
    });
}

/** Validates a retained checkpoint body. @internal */
export function readReplayCheckpointBody(body: RecordBody): ReplayCheckpointBody {
    return decode("checkpoint", body, () => {
        const fields = readVersionedBody(body, [
            "checkpoint_id",
            "classification",
            "constituents",
            "context_prefix_id",
            "prefix_id",
            "session_id",
            "step_count",
            "trace_cut_id",
        ]);
        assertSessionId(fields.session_id);
        assertStepCount(fields.step_count);
        assertPrefixedDigest(fields.trace_cut_id, config.identity.cutIdPrefix, "trace_cut_id");
        readPrefixes(fields.prefix_id, fields.context_prefix_id, fields.step_count as number);
        const constituents = readReplayConstituents(fields.constituents);
        const sessionId = fields.session_id as string;
        const stepCount = fields.step_count as number;
        if (
            fields.checkpoint_id !== createReplayCheckpointId(sessionId, stepCount) ||
            fields.trace_cut_id !== createReplayCutId(sessionId, sessionId, stepCount) ||
            fields.classification !== classifyReplayConstituents(constituents).classification
        ) {
            throw new TypeError("checkpoint identity, cut, or classification is inconsistent");
        }
        return fields as unknown as ReplayCheckpointBody;
    });
}

/** Validates a retained restore body. @internal */
export function readReplayRestoreBody(body: RecordBody): ReplayRestoreBody {
    return decode("restore", body, () => {
        const fields = readVersionedBody(body, [
            "classification",
            "constituents",
            "context_prefix_id",
            "prefix_id",
            "session_id",
        ]);
        assertSessionId(fields.session_id);
        const constituents = readReplayConstituents(fields.constituents);
        if (
            (fields.prefix_id !== null &&
                !isPrefixed(fields.prefix_id, config.identity.prefixIdPrefix)) ||
            (fields.context_prefix_id !== null &&
                !isPrefixed(fields.context_prefix_id, config.identity.contextPrefixIdPrefix)) ||
            fields.classification !== classifyReplayConstituents(constituents).classification
        ) {
            throw new TypeError("restore prefixes or classification are inconsistent");
        }
        return fields as unknown as ReplayRestoreBody;
    });
}

/** Validates a retained terminal body. @internal */
export function readReplayTerminalBody(body: RecordBody): ReplayTerminalBody {
    return decode("terminal", body, () => {
        const fields = readVersionedBody(body, [
            "failure",
            "prefix_id",
            "result",
            "session_id",
            "status",
            "step_count",
        ]);
        assertSessionId(fields.session_id);
        assertStepCount(fields.step_count);
        readPrefixes(fields.prefix_id, null, fields.step_count as number);
        const failure = fields.failure === null ? null : readReplayFailure(fields.failure);
        const finished = fields.status === FINISHED_STATUS;
        if (finished) {
            readScopeDataObject(fields.result, ["value"], "result");
        }
        if (
            !includes(REPLAY_TERMINAL_STATUSES, fields.status) ||
            (!finished && fields.result !== null) ||
            (finished && failure !== null)
        ) {
            throw new TypeError("terminal status, result, or failure is inconsistent");
        }
        return fields as unknown as ReplayTerminalBody;
    });
}

/** Validates a bounded failure. @internal */
export function readReplayFailure(value: unknown): ReplayStepFailure {
    const fields = readScopeDataObject(value, ["message", "name"], "failure");
    assertScopeText(fields.name, "failure.name");
    if (
        typeof fields.message !== "string" ||
        Buffer.byteLength(fields.message, "utf8") > config.limits.maxErrorMessageBytes
    ) {
        throw new TypeError("failure message must be a bounded string");
    }
    return Object.freeze(fields) as unknown as ReplayStepFailure;
}

/** Creates a bounded failure from any thrown value. @internal */
export function createReplayFailure(error: unknown): ReplayStepFailure {
    // Package errors keep the default `Error` name, so their class name identifies them instead.
    const name =
        error instanceof Error
            ? error.name !== "Error" || error.constructor.name.length === 0
                ? error.name
                : error.constructor.name
            : "Error";
    const message = error instanceof Error ? error.message : String(error);
    return Object.freeze({
        message: truncateUtf8(message, config.limits.maxErrorMessageBytes),
        name,
    });
}

/** Validates a bounded retained reason. @internal */
export function readReplayReason(value: unknown, subject: string): string {
    assertScopeText(value, subject);
    if (Buffer.byteLength(value, "utf8") > config.limits.maxReasonBytes) {
        throw new TypeError(`${subject} exceeds the configured byte bound`);
    }
    return value;
}

/** Validates unique world names within the configured bound. @internal */
export function readReplayWorldNames(value: unknown): readonly string[] {
    const names = readScopeArray(value, "worlds").map((name, index) => {
        assertScopeText(name, `worlds[${index}]`);
        return name;
    });
    assertCanonicalUnique(names, config.limits.maxWorlds, "worlds");
    return Object.freeze(names);
}

/** Validates bound process declarations. @internal */
export function readReplayProcesses(
    value: unknown,
): readonly { readonly backend: ReplayProcessBackend; readonly process_id: string }[] {
    const processes = readScopeArray(value, "processes").map((entry, index) => {
        const fields = readScopeDataObject(entry, ["backend", "process_id"], `processes[${index}]`);
        assertScopeText(fields.process_id, `processes[${index}].process_id`);
        if (!includes(REPLAY_PROCESS_BACKENDS, fields.backend)) {
            throw new TypeError(`processes[${index}].backend is not configured`);
        }
        return Object.freeze(fields) as unknown as {
            readonly backend: ReplayProcessBackend;
            readonly process_id: string;
        };
    });
    assertCanonicalUnique(
        processes.map((entry) => entry.process_id),
        config.limits.maxProcesses,
        "processes",
    );
    return Object.freeze(processes);
}

/** Validates declared dependencies of one step. @internal */
export function readReplayDependencies(value: unknown, index: number): readonly number[] {
    const dependencies = readScopeArray(value, "depends_on").map((entry, position) => {
        assertIndex(entry, `depends_on[${position}]`);
        return entry as number;
    });
    if (
        dependencies.length > config.limits.maxDependencies ||
        dependencies.some(
            (dependency, position) =>
                dependency >= index ||
                (position > 0 && dependency <= (dependencies[position - 1] as number)),
        )
    ) {
        throw new TypeError("depends_on must be bounded, strictly ascending, and earlier steps");
    }
    return Object.freeze(dependencies);
}

/** Validates retained constituents in configured kind order. @internal */
export function readReplayConstituents(value: unknown): readonly ReplayConstituent[] {
    const constituents = readScopeArray(value, "constituents").map((entry, index) => {
        const fields = readScopeDataObject(
            entry,
            ["evidence", "kind", "name", "reason", "receipt_id", "status"],
            `constituents[${index}]`,
        );
        if (fields.name !== null) {
            assertScopeText(fields.name, `constituents[${index}].name`);
        }
        if (fields.evidence !== null) {
            readScopeDataObject(
                fields.evidence,
                Object.keys(fields.evidence as object),
                "evidence",
            );
        }
        const verified = fields.status === VERIFIED;
        const unavailable = fields.status === UNAVAILABLE;
        if (verified) {
            assertScopeText(fields.receipt_id, `constituents[${index}].receipt_id`);
        }
        if (unavailable) {
            readReplayReason(fields.reason, `constituents[${index}].reason`);
        }
        if (
            !includes(REPLAY_CHECKPOINT_CONSTITUENT_KINDS, fields.kind) ||
            !includes(REPLAY_CHECKPOINT_EVIDENCE_STATUSES, fields.status) ||
            (!verified && fields.receipt_id !== null) ||
            (!unavailable && fields.reason !== null)
        ) {
            throw new TypeError(`constituents[${index}] kind, status, or evidence is inconsistent`);
        }
        return Object.freeze(fields) as unknown as ReplayConstituent;
    });
    const order = constituents.map((constituent) =>
        REPLAY_CHECKPOINT_CONSTITUENT_KINDS.indexOf(constituent.kind),
    );
    if (
        constituents.length === 0 ||
        constituents.some((constituent, index) => {
            const previous = constituents[index - 1];
            return (
                previous !== undefined &&
                ((order[index] as number) < (order[index - 1] as number) ||
                    (order[index] === order[index - 1] &&
                        compareText(previous.name ?? "", constituent.name ?? "") >= 0))
            );
        })
    ) {
        throw new TypeError("constituents must be non-empty and in configured canonical order");
    }
    return Object.freeze(constituents);
}

/** Compares text by code units for canonical ordering. @internal */
export function compareText(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}

/** Classifies any decoding failure as malformed or incompatible replay evidence. @internal */
function decode<T>(subject: string, body: RecordBody, read: () => T): T {
    const versions = body as {
        readonly compatibility_version?: unknown;
        readonly replay_version?: unknown;
    };
    if (
        versions.compatibility_version !== config.compatibilityVersion ||
        versions.replay_version !== config.recordVersion
    ) {
        throw new ReplayCompatibilityError(versions.compatibility_version, versions.replay_version);
    }
    try {
        return read();
    } catch (error) {
        throw new ReplayEvidenceError(`${subject} evidence is malformed`, { cause: error });
    }
}

function readProviderStep(value: unknown): ReplayProviderStepBody {
    const fields = readScopeDataObject(
        value,
        [
            "cache",
            "context_prefix_id",
            "failure",
            "prompt_id",
            "request",
            "response",
            "response_id",
        ],
        "provider",
    );
    const request = readModelRequest(fields.request);
    assertPrefixedDigest(
        fields.context_prefix_id,
        config.identity.contextPrefixIdPrefix,
        "context_prefix_id",
    );
    let responseId: string;
    if (fields.response !== null && fields.failure === null) {
        const response = readModelResponse(fields.response);
        readCacheEvidence(fields.cache, response.usage);
        responseId = createReplayResponseId({ output: response.output });
    } else if (fields.response === null && fields.failure !== null && fields.cache === null) {
        responseId = createReplayResponseId({ failure: readReplayFailure(fields.failure) });
    } else {
        throw new TypeError("provider response, failure, and cache are inconsistent");
    }
    if (fields.prompt_id !== createReplayPromptId(request) || fields.response_id !== responseId) {
        throw new TypeError("provider prompt or response identity does not match its content");
    }
    return fields as unknown as ReplayProviderStepBody;
}

function readCacheEvidence(value: unknown, usage: ReplayProviderUsage): void {
    const fields = readScopeDataObject(
        value,
        [
            "creation_input_tokens",
            "identity",
            "prior_context_prefix_id",
            "read_input_tokens",
            "status",
        ],
        "cache",
    );
    if (fields.identity !== null) {
        assertScopeText(fields.identity, "cache.identity");
    }
    if (fields.prior_context_prefix_id !== null) {
        assertPrefixedDigest(
            fields.prior_context_prefix_id,
            config.identity.contextPrefixIdPrefix,
            "prior_context_prefix_id",
        );
    }
    const expected = createReplayCacheEvidence(
        usage,
        fields.identity as string | null,
        fields.prior_context_prefix_id as string | null,
    );
    if (
        canonicalizeSemanticValue(fields as SemanticRecord) !== canonicalizeSemanticValue(expected)
    ) {
        throw new TypeError("cache evidence does not match observed usage");
    }
}

function readEffectStep(value: unknown): ReplayEffectStepBody {
    const fields = readScopeDataObject(
        value,
        [
            "approval",
            "disposition",
            "failure",
            "handler_id",
            "intent",
            "intent_ref",
            "outcome",
            "refusal_reason",
        ],
        "effect",
    );
    const intent = readEffectIntent(fields.intent as EffectIntent);
    if (fields.intent_ref !== createIntentReference(intent)) {
        throw new TypeError("effect intent reference does not match its intent");
    }
    if (fields.approval !== null) {
        const approval = readScopeDataObject(
            fields.approval,
            ["approver_id", "reason", "rematerialization"],
            "approval",
        );
        assertScopeText(approval.approver_id, "approval.approver_id");
        readReplayReason(approval.reason, "approval.reason");
        if (typeof approval.rematerialization !== "boolean") {
            throw new TypeError("approval.rematerialization must be a boolean");
        }
    }
    const materialized = fields.disposition === MATERIALIZED;
    const refused = fields.disposition === REFUSED;
    if (materialized) {
        assertScopeText(fields.handler_id, "handler_id");
        validateEffectCorrelation(intent, fields.outcome);
    } else if (refused) {
        readReplayReason(fields.refusal_reason, "refusal_reason");
    } else {
        readReplayFailure(fields.failure);
    }
    if (
        !includes(REPLAY_EFFECT_DISPOSITIONS, fields.disposition) ||
        (!materialized && (fields.handler_id !== null || fields.outcome !== null)) ||
        (materialized !== (fields.failure === null) && !refused) ||
        (refused && (fields.failure !== null || fields.approval !== null)) ||
        (!refused && fields.refusal_reason !== null)
    ) {
        throw new TypeError("effect disposition, handler, outcome, or failure is inconsistent");
    }
    return fields as unknown as ReplayEffectStepBody;
}

function readReplayTask(value: unknown): ReplaySessionTask {
    const fields = readScopeDataObject(
        value,
        ["artifact_lock", "input", "instruction", "output_schema"],
        "task",
    );
    readTaskArtifactLock(fields.artifact_lock);
    assertScopeText(fields.instruction, "task.instruction");
    readScopeDataObject(
        fields.output_schema,
        Object.keys(fields.output_schema as object),
        "output_schema",
    );
    return fields as unknown as ReplaySessionTask;
}

function readOrigin(value: unknown): ReplayOriginBody {
    const fields = readScopeDataObject(
        value,
        [
            "changes",
            "replacement_task",
            "source_session_id",
            "source_session_record_id",
            "target_checkpoint_id",
            "target_step_count",
            "target_trace_cut_id",
        ],
        "origin",
    );
    assertSessionId(fields.source_session_id);
    assertRecordId(fields.source_session_record_id, "source_session_record_id");
    assertStepCount(fields.target_step_count);
    assertPrefixedDigest(
        fields.target_trace_cut_id,
        config.identity.cutIdPrefix,
        "target_trace_cut_id",
    );
    if (fields.target_checkpoint_id !== null) {
        assertPrefixedDigest(
            fields.target_checkpoint_id,
            config.identity.checkpointIdPrefix,
            "target_checkpoint_id",
        );
    }
    const changes = readReplayChanges(fields.changes);
    const replacement =
        fields.replacement_task === null ? null : readReplayTask(fields.replacement_task);
    if ((replacement !== null) !== changes.includes(REPLAY_CHANGE_DIMENSIONS[0])) {
        throw new TypeError("origin replacement task and declared task change are inconsistent");
    }
    return { ...fields, replacement_task: replacement } as unknown as ReplayOriginBody;
}

/** Validates declared changes in configured order. @internal */
export function readReplayChanges(value: unknown): readonly ReplayChangeDimension[] {
    const changes = readScopeArray(value, "changes");
    const order = changes.map((change) => REPLAY_CHANGE_DIMENSIONS.indexOf(change as never));
    if (
        order.some(
            (position, index) =>
                position < 0 || (index > 0 && position <= (order[index - 1] as number)),
        )
    ) {
        throw new TypeError("changes must be unique configured dimensions in configured order");
    }
    return Object.freeze(changes) as readonly ReplayChangeDimension[];
}

function readPrefixes(prefixId: unknown, contextPrefixId: unknown, stepCount: number): void {
    if (
        stepCount === 0 ? prefixId !== null : !isPrefixed(prefixId, config.identity.prefixIdPrefix)
    ) {
        throw new TypeError("prefix_id must be null exactly at zero steps");
    }
    if (
        contextPrefixId !== null &&
        !isPrefixed(contextPrefixId, config.identity.contextPrefixIdPrefix)
    ) {
        throw new TypeError("context_prefix_id is malformed");
    }
}

function readVersionedBody(body: RecordBody, keys: readonly string[]): Record<string, unknown> {
    return readScopeDataObject(
        body,
        ["compatibility_version", "replay_version", ...keys],
        "replay record",
    );
}

function assertSessionId(value: unknown): void {
    assertPrefixedDigest(value, config.identity.sessionIdPrefix, "session_id");
}

function assertIndex(value: unknown, subject: string): void {
    if (
        !Number.isSafeInteger(value) ||
        (value as number) < 0 ||
        (value as number) >= config.limits.maxSteps
    ) {
        throw new TypeError(`${subject} must be a step index within the configured bound`);
    }
}

function assertStepCount(value: unknown): void {
    if (
        !Number.isSafeInteger(value) ||
        (value as number) < 0 ||
        (value as number) > config.limits.maxSteps
    ) {
        throw new TypeError("step_count must be within the configured bound");
    }
}

function assertCanonicalUnique(values: readonly string[], maximum: number, subject: string): void {
    if (
        values.length > maximum ||
        values.some(
            (value, index) => index > 0 && compareText(values[index - 1] as string, value) >= 0,
        )
    ) {
        throw new TypeError(`${subject} must be bounded, unique, and canonically ordered`);
    }
}

function isPrefixed(value: unknown, prefix: string): boolean {
    try {
        assertPrefixedDigest(value, prefix, "identity");
        return true;
    } catch {
        return false;
    }
}

function includes(values: readonly string[], value: unknown): boolean {
    return values.includes(value as string);
}

function prefixed(prefix: string, value: SemanticRecord): string {
    const recordId = createRecordId(value);
    return `${prefix}${recordId.slice(recordId.lastIndexOf(":") + 1)}`;
}

function snapshot(value: object): RecordBody {
    return createCanonicalSnapshot(value as RecordBody);
}

function truncateUtf8(value: string, maximumBytes: number): string {
    const bytes = Buffer.from(value, "utf8");
    if (bytes.length <= maximumBytes) {
        return value;
    }
    let end = maximumBytes;
    // Step back over UTF-8 continuation bytes so the retained message stays well-formed.
    while (end > 0 && ((bytes[end] as number) & 0xc0) === 0x80) {
        end -= 1;
    }
    return bytes.subarray(0, end).toString("utf8");
}
