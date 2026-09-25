import type { SemanticValue } from "../canonical/canonical-record.ts";
import { createCanonicalSnapshot } from "../canonical/snapshot.ts";
import { effectProtocolConfig } from "../protocol/config.ts";
import {
    EFFECT_COMPENSABLE_TIERS,
    EFFECT_COMPENSATION_OUTCOMES,
    EFFECT_COMPENSATION_PHASES,
    EFFECT_COMPENSATION_STATUSES,
    EFFECT_COMPENSATION_TRIGGERS,
    RECORD_MODES,
} from "../protocol/values.generated.ts";
import { assertRecordId } from "../record/guards.ts";
import { ROOT_WITNESS_ID } from "../record/root-witness.ts";
import type { RecordBody, RecordId } from "../record/types.ts";
import {
    assertPrefixedDigest,
    assertScopeText,
    readScopeArray,
    readScopeDataObject,
} from "../scope/validation.ts";
import type { SQLiteTraceStore } from "../store/sqlite-trace-store.ts";
import type { OwnerRecord } from "../store/types.ts";
import {
    EffectCompensationConflictError,
    EffectCompensationEvidenceError,
    EffectCompensationFailedError,
    EffectCompensationHandlerNotFoundError,
} from "./compensation-errors.ts";
import { type MaterializedEffect, MaterializedEffectResolver } from "./compensation-evidence.ts";
import {
    createCompensationAppendIntentId,
    createCompensationAttemptBody,
    createCompensationIntentBody,
    createCompensationOutcomeBody,
    deriveEffectCompensationId,
    type EffectCompensationRecordBody,
    readCompensationRecordBody,
} from "./compensation-records.ts";
import type {
    CompensateEffectsOptions,
    EffectCompensationAttemptInspection,
    EffectCompensationHandler,
    EffectCompensationInspection,
    EffectCompensationReceipt,
    EffectCompensationRegistry,
    EffectCompensationTrigger,
    InspectEffectCompensationOptions,
} from "./compensation-types.ts";
import type { EffectResult } from "./types.ts";
import { readEffectResult } from "./validation.ts";

const config = effectProtocolConfig.compensation;
const [CAPTURE_MODE] = RECORD_MODES;
const [INTENT_PHASE, ATTEMPT_PHASE] = EFFECT_COMPENSATION_PHASES;
const [COMPENSATED] = EFFECT_COMPENSATION_OUTCOMES;
const [PENDING, UNCERTAIN, FAILED_STATUS, COMPENSATED_STATUS] = EFFECT_COMPENSATION_STATUSES;
const [, , , COMMAND_TRIGGER] = EFFECT_COMPENSATION_TRIGGERS;
const registries = new WeakSet<object>();

/**
 * Creates an immutable registry holding exactly one compensation handler per effect kind.
 *
 * Definitions are validated and snapshotted without evaluating accessors; mutating a source
 * definition afterwards changes nothing.
 *
 * @param handlers - Compensation handlers, one per exact effect kind.
 * @returns A frozen registry accepted by discard, rewind, replay, and {@link compensateEffects}.
 * @throws {TypeError} If the array or a definition is malformed, or a kind or handler identity
 *   repeats.
 *
 * @example
 * ```ts
 * const registry = createEffectCompensationRegistry([{
 *     handlerId: "rows.delete",
 *     kind: "rows.insert",
 *     compensate: ({ intent, idempotencyKey }) => deleteRow(intent.payload, idempotencyKey),
 * }]);
 * ```
 *
 * @public
 */
export function createEffectCompensationRegistry(
    handlers: readonly EffectCompensationHandler[],
): EffectCompensationRegistry {
    const byKind = new Map<string, EffectCompensationHandler>();
    const handlerIds = new Set<string>();
    readScopeArray(handlers, "compensation handlers").forEach((value, index) => {
        const subject = `compensation handlers[${index}]`;
        const fields = readScopeDataObject(value, ["compensate", "handlerId", "kind"], subject);
        assertScopeText(fields.handlerId, `${subject}.handlerId`);
        assertScopeText(fields.kind, `${subject}.kind`);
        if (typeof fields.compensate !== "function") {
            throw new TypeError(`${subject}.compensate must be a function`);
        }
        if (byKind.has(fields.kind) || handlerIds.has(fields.handlerId)) {
            throw new TypeError("compensation handler kinds and identities must be unique");
        }
        handlerIds.add(fields.handlerId);
        byKind.set(
            fields.kind,
            Object.freeze({
                compensate: fields.compensate as EffectCompensationHandler["compensate"],
                handlerId: fields.handlerId,
                kind: fields.kind,
            }),
        );
    });
    const registry = Object.freeze({
        kinds: Object.freeze([...byKind.keys()]),
        resolve: (kind: string) => byKind.get(kind),
    });
    registries.add(registry);
    return registry;
}

/**
 * Validates an optional package-created compensation registry. @internal
 *
 * @throws {TypeError} If the value is neither undefined nor a registry created by
 *   {@link createEffectCompensationRegistry}.
 */
export function readEffectCompensationRegistry(value: unknown): EffectCompensationRegistry | null {
    if (value === undefined) {
        return null;
    }
    if (value === null || typeof value !== "object" || !registries.has(value)) {
        throw new TypeError(
            "compensation must be a registry from createEffectCompensationRegistry",
        );
    }
    return value as EffectCompensationRegistry;
}

/**
 * Validates and projects one compensation path from its retained records without mutation.
 *
 * @param store - Open trace store, writable or read-only.
 * @param options - Exact compensation identity.
 * @returns The frozen inspection with its derived status.
 * @throws {EffectCompensationEvidenceError} If the path is absent or its records are inconsistent.
 * @throws {TypeError} If options are malformed.
 *
 * @example
 * ```ts
 * const inspection = inspectEffectCompensation(store, {
 *     compensationId: deriveEffectCompensationId(step.record_id),
 * });
 * console.log(inspection.status, inspection.attempts.length);
 * ```
 *
 * @public
 */
export function inspectEffectCompensation(
    store: SQLiteTraceStore,
    options: InspectEffectCompensationOptions,
): EffectCompensationInspection {
    const fields = readScopeDataObject(
        options,
        ["compensationId"],
        "inspectEffectCompensation options",
    );
    assertPrefixedDigest(
        fields.compensationId,
        config.identity.compensationIdPrefix,
        "compensationId",
    );
    const inspection = foldCompensation(
        fields.compensationId as string,
        store.readOwner(fields.compensationId as string),
    );
    if (inspection === undefined) {
        throw new EffectCompensationEvidenceError(
            `compensation ${fields.compensationId as string} is not retained`,
        );
    }
    return inspection;
}

/**
 * Compensates explicitly named materialized effects in reverse order under one command.
 *
 * Each record must retain a successful materialization of a compensable effect: a live or
 * recorded replay effect step (resolved to the live step it copies) or a supervised dispatch
 * resolution. Every compensation path is keyed by its original materialization, so an effect
 * already compensated by a discard, a branch, or an earlier command is never compensated again.
 * The compensation intent is retained before the first attempt, each attempt before its handler
 * runs, and each outcome after it returns. A handler that throws leaves its attempt uncertain and
 * the error propagates; the next trigger invokes the handler again under the same idempotency key.
 *
 * @param store - Open writable trace store.
 * @param options - Command identity, materialization records in materialization order, registry.
 * @returns The compensations in the order they ran.
 * @throws {EffectCompensationHandlerNotFoundError} Before anything runs, if an effect that still
 *   needs compensation has no handler.
 * @throws {EffectCompensationEvidenceError} If a record is absent, is not a successful compensable
 *   materialization, or the command exceeds the configured bound.
 * @throws {EffectCompensationFailedError} After every effect was attempted, if a handler returned
 *   a failure result.
 * @throws {EffectCompensationConflictError} If another compensator advanced the same path
 *   concurrently.
 * @throws {TypeError} If options are malformed.
 * @throws Handler failures propagate unchanged.
 *
 * @example
 * ```ts
 * const { compensations } = await compensateEffects(store, {
 *     commandId: "compensate:order:1",
 *     effectRecordIds: [resolution.record_id],
 *     registry,
 * });
 * ```
 *
 * @public
 */
export async function compensateEffects(
    store: SQLiteTraceStore,
    options: CompensateEffectsOptions,
): Promise<EffectCompensationReceipt> {
    const fields = readScopeDataObject(
        options,
        ["commandId", "effectRecordIds", "registry"],
        "compensateEffects options",
    );
    assertScopeText(fields.commandId, "commandId");
    const registry = readEffectCompensationRegistry(fields.registry);
    const resolver = new MaterializedEffectResolver(store);
    const effects = readScopeArray(fields.effectRecordIds, "effectRecordIds").map(
        (recordId, index) => {
            assertRecordId(recordId, `effectRecordIds[${index}]`);
            const effect = resolver.resolve(recordId);
            if (effect === undefined || !isCompensable(effect)) {
                throw new EffectCompensationEvidenceError(
                    `record ${recordId} is not a successful compensable materialization`,
                );
            }
            return effect;
        },
    );
    const { compensations, failed } = await runEffectCompensations(store, effects, registry, {
        command_id: fields.commandId,
        kind: COMMAND_TRIGGER,
    });
    if (failed.length > 0) {
        throw new EffectCompensationFailedError(failed);
    }
    return Object.freeze({ compensations });
}

/**
 * Refuses, before any write, a trigger whose compensable effects still needing compensation lack
 * a handler, and returns the deduplicated compensable effects in materialization order. @internal
 */
export function planEffectCompensations(
    store: SQLiteTraceStore,
    effects: readonly MaterializedEffect[],
    registry: EffectCompensationRegistry | null,
): readonly MaterializedEffect[] {
    const unique = new Map<string, MaterializedEffect>();
    for (const effect of effects) {
        if (isCompensable(effect) && !unique.has(effect.evidence.record_id)) {
            unique.set(effect.evidence.record_id, effect);
        }
    }
    if (unique.size > config.limits.maxEffectsPerTrigger) {
        throw new EffectCompensationEvidenceError(
            `trigger names ${unique.size} compensable effects, above the configured bound`,
        );
    }
    for (const effect of unique.values()) {
        const compensationId = deriveEffectCompensationId(effect.evidence.record_id);
        const retained = foldCompensation(compensationId, store.readOwner(compensationId));
        if (
            retained?.status !== COMPENSATED_STATUS &&
            registry?.resolve(effect.intent.kind) === undefined
        ) {
            throw new EffectCompensationHandlerNotFoundError(compensationId, effect.intent.kind);
        }
    }
    return Object.freeze([...unique.values()]);
}

/**
 * Compensates the compensable effects of one trigger in reverse materialization order, attempting
 * every effect before reporting failures. @internal
 */
export async function runEffectCompensations(
    store: SQLiteTraceStore,
    effects: readonly MaterializedEffect[],
    registry: EffectCompensationRegistry | null,
    trigger: EffectCompensationTrigger,
): Promise<{
    readonly compensations: readonly EffectCompensationInspection[];
    readonly failed: readonly string[];
}> {
    const planned = planEffectCompensations(store, effects, registry);
    const compensations: EffectCompensationInspection[] = [];
    for (const effect of [...planned].reverse()) {
        compensations.push(
            await compensateOne(store, effect, registry as EffectCompensationRegistry, trigger),
        );
    }
    return Object.freeze({
        compensations: Object.freeze(compensations),
        failed: Object.freeze(
            compensations
                .filter((inspection) => inspection.status === FAILED_STATUS)
                .map((inspection) => inspection.compensation_id),
        ),
    });
}

function isCompensable(effect: MaterializedEffect): boolean {
    return (
        (EFFECT_COMPENSABLE_TIERS as readonly string[]).includes(effect.intent.reversibility) &&
        effect.outcome.result.ok
    );
}

async function compensateOne(
    store: SQLiteTraceStore,
    effect: MaterializedEffect,
    registry: EffectCompensationRegistry,
    trigger: EffectCompensationTrigger,
): Promise<EffectCompensationInspection> {
    const compensationId = deriveEffectCompensationId(effect.evidence.record_id);
    let inspection = foldCompensation(compensationId, store.readOwner(compensationId));
    if (inspection === undefined) {
        appendCompensationRecord(
            store,
            compensationId,
            null,
            [effect.evidence.record_id],
            0,
            createCompensationIntentBody(
                compensationId,
                effect.evidence,
                effect.intent,
                effect.outcome,
            ),
        );
        inspection = foldCompensation(
            compensationId,
            store.readOwner(compensationId),
        ) as EffectCompensationInspection;
    }
    if (inspection.status === COMPENSATED_STATUS) {
        return inspection;
    }
    const handler = registry.resolve(effect.intent.kind) as EffectCompensationHandler;
    const attempt = inspection.attempts.length + 1;
    const attemptRecordId = appendCompensationRecord(
        store,
        compensationId,
        inspection.head_record_id,
        [inspection.head_record_id],
        store.readOwner(compensationId).length,
        createCompensationAttemptBody(compensationId, attempt, handler.handlerId, trigger),
    );
    const result = readEffectResult(
        await handler.compensate(
            Object.freeze({
                attempt,
                compensationId,
                idempotencyKey: compensationId,
                intent: inspection.effect_intent,
                outcome: inspection.effect_outcome,
                trigger: Object.freeze({ ...trigger }),
            }),
        ),
    );
    appendCompensationRecord(
        store,
        compensationId,
        attemptRecordId,
        [attemptRecordId],
        store.readOwner(compensationId).length,
        createCompensationOutcomeBody(
            compensationId,
            attempt,
            createCanonicalSnapshot(result) as EffectResult<SemanticValue, SemanticValue>,
        ),
    );
    return foldCompensation(
        compensationId,
        store.readOwner(compensationId),
    ) as EffectCompensationInspection;
}

function appendCompensationRecord(
    store: SQLiteTraceStore,
    compensationId: string,
    expectedHeadRecordId: RecordId | null,
    causes: readonly RecordId[],
    ordinal: number,
    body: EffectCompensationRecordBody,
): RecordId {
    const appended = store.appendEffectCompensationRecord(compensationId, expectedHeadRecordId, {
        append_intent_id: createCompensationAppendIntentId(body, ordinal),
        batch: {
            groups: [
                {
                    owner_id: compensationId,
                    records: [
                        {
                            body: body as unknown as RecordBody,
                            caused_by_record_ids: [...causes],
                            mode: CAPTURE_MODE,
                            schema_ref: config.traceSchema,
                            witness_ref: ROOT_WITNESS_ID,
                        },
                    ],
                },
            ],
        },
    });
    if (appended.status === "head_moved") {
        throw new EffectCompensationConflictError(compensationId);
    }
    return appended.receipt.record_ids[0] as RecordId;
}

function foldCompensation(
    compensationId: string,
    records: readonly OwnerRecord[],
): EffectCompensationInspection | undefined {
    const [first, ...rest] = records;
    if (first === undefined) {
        return undefined;
    }
    const read = (record: OwnerRecord): EffectCompensationRecordBody => {
        if (
            record.envelope.schema_ref !== config.traceSchema ||
            record.envelope.mode !== CAPTURE_MODE
        ) {
            throw new EffectCompensationEvidenceError(
                `compensation ${compensationId} retains a foreign record`,
            );
        }
        return readCompensationRecordBody(record.body, compensationId);
    };
    const intent = read(first);
    if (
        intent.phase !== INTENT_PHASE ||
        first.envelope.caused_by_record_ids.join("\0") !== intent.materialization.record_id
    ) {
        throw new EffectCompensationEvidenceError(
            `compensation ${compensationId} does not start with its intent`,
        );
    }
    const attempts: {
        attempt: number;
        handler_id: string;
        outcome: EffectCompensationAttemptInspection["outcome"];
        record_id: RecordId;
        trigger: EffectCompensationTrigger;
    }[] = [];
    let previous = first;
    for (const record of rest) {
        const body = read(record);
        const last = attempts.at(-1);
        if (
            record.envelope.caused_by_record_ids.join("\0") !== previous.envelope.record_id ||
            last?.outcome?.status === COMPENSATED ||
            (body.phase === ATTEMPT_PHASE
                ? body.attempt !== attempts.length + 1
                : body.phase === INTENT_PHASE ||
                  last === undefined ||
                  last.outcome !== null ||
                  body.attempt !== last.attempt)
        ) {
            throw new EffectCompensationEvidenceError(
                `compensation ${compensationId} retains an out-of-order record`,
            );
        }
        if (body.phase === ATTEMPT_PHASE) {
            attempts.push({
                attempt: body.attempt,
                handler_id: body.handler_id,
                outcome: null,
                record_id: record.envelope.record_id as RecordId,
                trigger: body.trigger,
            });
        } else if (body.phase !== INTENT_PHASE) {
            (last as NonNullable<typeof last>).outcome = Object.freeze({
                record_id: record.envelope.record_id as RecordId,
                result: body.result,
                status: body.status,
            });
        }
        previous = record;
    }
    const latest = attempts.at(-1);
    return createCanonicalSnapshot({
        attempts: attempts.map((entry) => ({ ...entry })),
        compensation_id: compensationId,
        effect_intent: intent.effect_intent,
        effect_outcome: intent.effect_outcome,
        head_record_id: previous.envelope.record_id,
        intent_record_id: first.envelope.record_id,
        materialization: intent.materialization,
        status:
            latest === undefined
                ? PENDING
                : latest.outcome === null
                  ? UNCERTAIN
                  : latest.outcome.status === COMPENSATED
                    ? COMPENSATED_STATUS
                    : FAILED_STATUS,
    }) as unknown as EffectCompensationInspection;
}
