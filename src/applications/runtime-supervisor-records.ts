import type { SemanticRecord, SemanticValue } from "../canonical/canonical-record.ts";
import { createCanonicalSnapshot } from "../canonical/snapshot.ts";
import {
    applicationsProtocolConfig,
    kernelProtocolConfig,
    providerProtocolConfig,
    recordIdConfig,
    supervisionProtocolConfig,
} from "../protocol/config.ts";
import {
    APPLICATION_RUNTIME_SUPERVISION_PHASES,
    RECORD_MODES,
} from "../protocol/values.generated.ts";
import { readModelMessage } from "../provider/messages.ts";
import type { ModelMessage, ModelUsage } from "../provider/types.ts";
import { ROOT_WITNESS_ID } from "../record/root-witness.ts";
import type { RecordBody, RecordId } from "../record/types.ts";
import { compileJSONSchema } from "../schema/json-schema-validator.ts";
import type { SQLiteTraceStore } from "../store/sqlite-trace-store.ts";
import type { OwnerRecord } from "../store/types.ts";
import type { TraceSubscriptionCursor } from "../supervision/types.ts";
import { ApplicationEvidenceError } from "./errors.ts";
import { readRetainedManifest } from "./manifest.ts";
import {
    createApplicationAppendIntentId,
    createApplicationAppendRequest,
    decodeApplicationBody,
    prefixedApplicationId,
} from "./records.ts";
import { renderRuntimeSupervisionRecordSchema } from "./runtime-supervisor-schema.ts";
import type {
    RuntimeSupervisorAction,
    RuntimeSupervisorAttemptCause,
    RuntimeSupervisorAttemptInspection,
    RuntimeSupervisorAttemptStatus,
    RuntimeSupervisorCompletionInspection,
    RuntimeSupervisorDecision,
    RuntimeSupervisorInspection,
    RuntimeSupervisorRefusal,
    RuntimeSupervisorSettlementInspection,
    RuntimeSupervisorSnapshot,
    RuntimeSupervisorTickInspection,
    RuntimeSupervisorToolCallSummary,
    RuntimeSupervisorTurnInspection,
    RuntimeSupervisorWorkerInspection,
} from "./runtime-supervisor-types.ts";
import type { ApplicationManifest } from "./types.ts";

const config = applicationsProtocolConfig;
const schemaRef = config.traceSchemas.runtimeSupervision;
const [CAPTURE_MODE] = RECORD_MODES;
const [OPENED_PHASE, TICK_PHASE, SETTLED_PHASE, ATTEMPT_PHASE, TURN_PHASE, COMPLETED_PHASE] =
    APPLICATION_RUNTIME_SUPERVISION_PHASES;
const VERSION_FIELDS = {
    application_version: config.recordVersion,
    compatibility_version: config.compatibilityVersion,
} as const;
const recordSchema = compileJSONSchema(
    renderRuntimeSupervisionRecordSchema({
        applications: config,
        kernel: kernelProtocolConfig,
        providers: providerProtocolConfig,
        recordId: recordIdConfig,
        supervision: supervisionProtocolConfig,
    }),
);

/** Fields of one runtime supervision record body without its version fields. @internal */
export type RuntimeRecordFields = Readonly<Record<string, unknown>> & {
    readonly application_id: string;
    readonly phase: string;
};

/** Retained attempt record fields of one worker stream. @internal */
export type RuntimeAttemptFields = {
    readonly attempt: number;
    readonly cause: RuntimeSupervisorAttemptCause;
    readonly custody: {
        readonly custody_id: string;
        readonly receipt_id: string;
        readonly source_custody_id: string | null;
    };
    readonly guidance: string | null;
    readonly leader: string | null;
    readonly tick: number;
};

/** Retained turn record fields of one worker attempt. @internal */
export type RuntimeTurnFields = {
    readonly assistant: ModelMessage;
    readonly cache_prefix_messages: number;
    readonly calls: readonly RuntimeSupervisorToolCallSummary[];
    readonly guidance_ticks: readonly number[];
    readonly index: number;
    readonly message_count: number;
    readonly output: SemanticValue;
    readonly request_digest: string;
    readonly results: ModelMessage | null;
    readonly usage: ModelUsage;
};

/** Retained completion record fields of one worker attempt. @internal */
export type RuntimeCompletionFields = {
    readonly cause: { readonly action: RuntimeSupervisorAction; readonly tick: number } | null;
    readonly error: string | null;
    readonly output: SemanticValue;
    readonly status: RuntimeSupervisorAttemptStatus;
};

/** Validated application path of one runtime supervisor run. @internal */
export type RuntimeApplicationRecords = {
    readonly head: RecordId;
    readonly manifest: {
        readonly cut_id: string;
        readonly manifest: ApplicationManifest;
        readonly record_id: RecordId;
    } | null;
    readonly opened: {
        readonly command_id: string;
        readonly protocol_id: string;
        readonly record_id: RecordId;
        readonly supervisor_id: string;
        readonly workers: readonly { readonly stream_id: string; readonly worker_id: string }[];
    };
    readonly settlement: RuntimeSupervisorSettlementInspection | null;
    readonly ticks: readonly RuntimeSupervisorTickInspection[];
};

/**
 * Derives the reserved owner path of one worker's live stream. Streams share the application
 * identity prefix, so general appends can never forge a worker record. @internal
 */
export function deriveRuntimeStreamId(applicationId: string, workerId: string): string {
    return prefixedApplicationId(config.identity.applicationIdPrefix, {
        application_id: applicationId,
        worker_id: workerId,
    });
}

/**
 * Validates and appends one runtime supervision record on an application or stream owner path at
 * its exact head. A record retained under the same intent replays identically.
 *
 * @returns The record identity.
 * @throws {JSONSchemaValidationError} If the body violates the runtime supervision record schema.
 * @throws {ApplicationEvidenceError} If the owner head moved.
 * @internal
 */
export function appendRuntimeRecord(
    store: SQLiteTraceStore,
    ownerId: string,
    step: string,
    fields: RuntimeRecordFields,
    causes: readonly RecordId[],
): RecordId {
    const body = createCanonicalSnapshot({
        ...VERSION_FIELDS,
        ...fields,
    } as unknown as SemanticRecord) as RecordBody;
    recordSchema.parse(body, `runtime supervision ${fields.phase} record`);
    const head = store.readOwner(ownerId).at(-1)?.envelope.record_id ?? null;
    const appended = store.appendApplicationRecord(
        ownerId,
        head,
        createApplicationAppendRequest(
            createApplicationAppendIntentId(ownerId, step),
            ownerId,
            body,
            schemaRef,
            [...new Set([...(head === null ? [] : [head]), ...causes])],
        ),
        null,
    );
    if (appended.status === "head_moved") {
        throw new ApplicationEvidenceError(`owner path ${ownerId} head moved`);
    }
    return appended.receipt.record_ids[0] as RecordId;
}

/**
 * Reads and validates the application path of one runtime supervisor run: the opened record,
 * contiguous ticks, the optional settlement, and the optional manifest and terminal cut.
 *
 * @returns The validated records, or null when nothing is retained.
 * @throws {ApplicationEvidenceError} If any record is malformed or out of order, or the path was
 * opened by another application.
 * @internal
 */
export function readRuntimeApplication(
    store: SQLiteTraceStore,
    applicationId: string,
): RuntimeApplicationRecords | null {
    const [first, ...rest] = store.readOwner(applicationId);
    if (first === undefined) {
        return null;
    }
    const opened = readBody(first, applicationId, OPENED_PHASE);
    const ticks: RuntimeSupervisorTickInspection[] = [];
    let settlement: RuntimeSupervisorSettlementInspection | null = null;
    let head = first.envelope.record_id;
    let manifestSeen = false;
    let terminal = false;
    const manifest = readRetainedManifest(store, applicationId);
    for (const record of rest) {
        assert(!terminal, "application retains a record after its terminal cut");
        if (record.envelope.schema_ref === schemaRef && !manifestSeen) {
            const body = readBody(record, applicationId, null);
            if (body.phase === TICK_PHASE) {
                assert(
                    settlement === null && body.tick === ticks.length + 1,
                    "tick records are late or out of order",
                );
                ticks.push(readTick(body, record.envelope.record_id));
            } else {
                assert(
                    body.phase === SETTLED_PHASE && settlement === null,
                    "application retains an unexpected runtime supervision record",
                );
                settlement = readSettlement(body, record.envelope.record_id);
            }
        } else if (record.envelope.schema_ref === config.traceSchemas.manifest) {
            assert(
                settlement !== null && manifest?.record_id === record.envelope.record_id,
                "manifest record does not follow the settlement",
            );
            manifestSeen = true;
        } else {
            assert(
                manifestSeen &&
                    record.envelope.schema_ref === kernelProtocolConfig.queries.cutSchemaRef &&
                    record.body.cut_id === manifest?.cut_id,
                "application retains an unsupported record",
            );
            terminal = true;
        }
        assert(
            terminal || record.envelope.caused_by_record_ids[0] === head,
            "application record does not extend the head",
        );
        head = record.envelope.record_id;
    }
    return Object.freeze({
        head,
        manifest: manifestSeen ? manifest : null,
        opened: Object.freeze({
            command_id: opened.command_id as string,
            protocol_id: opened.protocol_id as string,
            record_id: first.envelope.record_id,
            supervisor_id: opened.supervisor_id as string,
            workers: opened.workers as RuntimeApplicationRecords["opened"]["workers"],
        }),
        settlement,
        ticks: Object.freeze(ticks),
    });
}

/**
 * Reads and validates one worker stream: attempts numbered from one, each followed by contiguous
 * turns and at most one completion, and every attempt after the first opened only after its
 * predecessor completed.
 *
 * @returns The attempts in order.
 * @throws {ApplicationEvidenceError} If the stream is malformed or out of order.
 * @internal
 */
export function readRuntimeStream(
    store: SQLiteTraceStore,
    applicationId: string,
    streamId: string,
    workerId: string,
): readonly RuntimeSupervisorAttemptInspection[] {
    const attempts: {
        fields: RuntimeAttemptFields;
        record_id: RecordId;
        turns: RuntimeSupervisorTurnInspection[];
        completion: RuntimeSupervisorCompletionInspection | null;
    }[] = [];
    for (const record of store.readOwner(streamId)) {
        assert(record.envelope.schema_ref === schemaRef, "worker stream retains a foreign record");
        const body = readBody(record, applicationId, null);
        assert(body.worker_id === workerId, "worker stream names another worker");
        const current = attempts.at(-1);
        if (body.phase === ATTEMPT_PHASE) {
            assert(
                body.attempt === attempts.length + 1 &&
                    (current === undefined || current.completion !== null),
                "attempt records are out of order",
            );
            attempts.push({
                completion: null,
                fields: readAttemptFields(body),
                record_id: record.envelope.record_id,
                turns: [],
            });
            continue;
        }
        assert(
            current !== undefined &&
                body.attempt === current.fields.attempt &&
                current.completion === null,
            "worker record names no open attempt",
        );
        if (body.phase === TURN_PHASE) {
            assert(body.index === current.turns.length, "turn records are out of order");
            current.turns.push(readTurn(body, record.envelope.record_id));
        } else {
            assert(body.phase === COMPLETED_PHASE, "worker stream retains an unexpected phase");
            current.completion = Object.freeze({
                cause: body.cause as RuntimeCompletionFields["cause"],
                error: body.error as string | null,
                output: body.output as SemanticValue,
                record_id: record.envelope.record_id,
                status: body.status as RuntimeSupervisorAttemptStatus,
            });
        }
    }
    return Object.freeze(
        attempts.map((attempt) =>
            Object.freeze({
                ...attempt.fields,
                completion: attempt.completion,
                record_id: attempt.record_id,
                turns: Object.freeze(attempt.turns),
            }),
        ),
    );
}

/**
 * Builds the record-derived inspection of one runtime supervisor run.
 *
 * @throws {ApplicationEvidenceError} If the application is not retained or inconsistent.
 * @internal
 */
export function buildRuntimeInspection(
    store: SQLiteTraceStore,
    applicationId: string,
): RuntimeSupervisorInspection {
    const retained = readRuntimeApplication(store, applicationId);
    assert(retained !== null, `application ${applicationId} is not retained`);
    const workers: RuntimeSupervisorWorkerInspection[] = retained.opened.workers.map(
        ({ stream_id, worker_id }) => {
            assert(
                stream_id === deriveRuntimeStreamId(applicationId, worker_id),
                `worker ${worker_id} names a stream this application did not derive`,
            );
            return Object.freeze({
                attempts: readRuntimeStream(store, applicationId, stream_id, worker_id),
                stream_id,
                worker_id,
            });
        },
    );
    return Object.freeze({
        application_id: applicationId,
        command_id: retained.opened.command_id,
        cut_id: retained.manifest === null ? null : retained.manifest.cut_id,
        manifest: retained.manifest === null ? null : retained.manifest.manifest,
        opened_record_id: retained.opened.record_id,
        protocol_id: retained.opened.protocol_id,
        settlement: retained.settlement,
        supervisor_id: retained.opened.supervisor_id,
        ticks: retained.ticks,
        workers: Object.freeze(workers),
    });
}

function readBody(
    record: OwnerRecord,
    applicationId: string,
    phase: string | null,
): Readonly<Record<string, unknown>> {
    assert(
        record.envelope.schema_ref === schemaRef &&
            record.envelope.mode === CAPTURE_MODE &&
            record.envelope.witness_ref === ROOT_WITNESS_ID,
        `record ${record.envelope.record_id} is not a runtime supervision record`,
    );
    const body = decodeApplicationBody("runtime supervision", () =>
        recordSchema.parse(record.body, "runtime supervision record"),
    ) as Readonly<Record<string, unknown>>;
    assert(
        body.application_id === applicationId && (phase === null || body.phase === phase),
        `record ${record.envelope.record_id} names another application or phase`,
    );
    return body;
}

function readTick(
    body: Readonly<Record<string, unknown>>,
    recordId: RecordId,
): RuntimeSupervisorTickInspection {
    return Object.freeze({
        cursor: body.cursor as TraceSubscriptionCursor,
        decisions: body.decisions as readonly RuntimeSupervisorDecision[],
        output: body.output as SemanticValue,
        record_id: recordId,
        refusal: body.refusal as RuntimeSupervisorRefusal | null,
        snapshot: body.snapshot as unknown as RuntimeSupervisorSnapshot,
        tick: body.tick as number,
        usage: body.usage as ModelUsage | null,
    });
}

function readSettlement(
    body: Readonly<Record<string, unknown>>,
    recordId: RecordId,
): RuntimeSupervisorSettlementInspection {
    return Object.freeze({
        discard_custody_ids: body.discard_custody_ids as readonly string[],
        record_id: recordId,
        ticks: body.ticks as number,
        undelivered: body.undelivered as RuntimeSupervisorSettlementInspection["undelivered"],
        workers: body.workers as RuntimeSupervisorSettlementInspection["workers"],
    });
}

function readAttemptFields(body: Readonly<Record<string, unknown>>): RuntimeAttemptFields {
    return {
        attempt: body.attempt as number,
        cause: body.cause as RuntimeSupervisorAttemptCause,
        custody: body.custody as RuntimeAttemptFields["custody"],
        guidance: body.guidance as string | null,
        leader: body.leader as string | null,
        tick: body.tick as number,
    };
}

function readTurn(
    body: Readonly<Record<string, unknown>>,
    recordId: RecordId,
): RuntimeSupervisorTurnInspection {
    return Object.freeze({
        assistant: decodeApplicationBody("runtime supervision turn", () =>
            readModelMessage(body.assistant, "turn assistant message"),
        ),
        cache_prefix_messages: body.cache_prefix_messages as number,
        calls: body.calls as readonly RuntimeSupervisorToolCallSummary[],
        guidance_ticks: body.guidance_ticks as readonly number[],
        index: body.index as number,
        message_count: body.message_count as number,
        output: body.output as SemanticValue,
        record_id: recordId,
        request_digest: body.request_digest as string,
        results:
            body.results === null
                ? null
                : decodeApplicationBody("runtime supervision turn", () =>
                      readModelMessage(body.results, "turn results message"),
                  ),
        usage: body.usage as ModelUsage,
    });
}

function assert(condition: boolean, message: string): asserts condition {
    if (!condition) {
        throw new ApplicationEvidenceError(message);
    }
}
