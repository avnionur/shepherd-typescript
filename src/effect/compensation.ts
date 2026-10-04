import { randomUUID } from "node:crypto";
import type { SemanticValue } from "../canonical/canonical-record.ts";
import { createCanonicalSnapshot } from "../canonical/snapshot.ts";
import { effectProtocolConfig } from "../protocol/config.ts";
import {
    EFFECT_COMPENSABLE_TIERS,
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
import type { CompensationFence } from "../store/compensation-claims.ts";
import type { SQLiteTraceStore } from "../store/sqlite-trace-store.ts";
import type { StoreAppendRequest } from "../store/types.ts";
import {
    EffectCompensationConflictError,
    EffectCompensationEvidenceError,
    EffectCompensationFailedError,
    EffectCompensationHandlerNotFoundError,
} from "./compensation-errors.ts";
import { type MaterializedEffect, MaterializedEffectResolver } from "./compensation-evidence.ts";
import { foldCompensation } from "./compensation-inspection.ts";
import {
    createCompensationAppendIntentId,
    createCompensationAttemptBody,
    createCompensationIntentBody,
    createCompensationOutcomeBody,
    deriveEffectCompensationId,
    type EffectCompensationRecordBody,
} from "./compensation-records.ts";
import type {
    CompensateEffectsOptions,
    EffectCompensationHandler,
    EffectCompensationInspection,
    EffectCompensationOwnershipInspection,
    EffectCompensationReceipt,
    EffectCompensationRegistry,
    EffectCompensationTrigger,
    InspectEffectCompensationOptions,
} from "./compensation-types.ts";
import {
    readEffectReconciliationHistory,
    reconciliationSuppressesRetry,
} from "./reconciliation-inspection.ts";
import type { EffectResult } from "./types.ts";
import { readEffectResult } from "./validation.ts";

const config = effectProtocolConfig.compensation;
const [CAPTURE_MODE] = RECORD_MODES;
const [, ATTEMPT_PHASE] = EFFECT_COMPENSATION_PHASES;
const [, , FAILED_STATUS, COMPENSATED_STATUS] = EFFECT_COMPENSATION_STATUSES;
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
        store,
        fields.compensationId as string,
        store.readOwner(fields.compensationId as string),
    );
    if (inspection === undefined) {
        throw new EffectCompensationEvidenceError(
            `compensation ${fields.compensationId as string} is not retained`,
        );
    }
    return withReconciliation(store, inspection);
}

/**
 * Inspects immutable compensation evidence alongside current store-local invocation ownership.
 * An imported trace has no live ownership row; absence never proves an external effect is safe to repeat.
 * @param store - Open trace store, including read-only stores.
 * @param options - Exact compensation identity.
 * @returns Record-derived state and a separately classified live lease snapshot.
 * @throws {EffectCompensationEvidenceError} If records or ownership disagree.
 * @throws {TypeError} If the identity is malformed.
 * @throws {TraceStoreError} If the store is closed or inspection races a writer.
 */
export function inspectEffectCompensationOwnership(
    store: SQLiteTraceStore,
    options: InspectEffectCompensationOptions,
): EffectCompensationOwnershipInspection {
    const compensation = inspectEffectCompensation(store, options);
    const claim = store.readEffectCompensationClaim(compensation.compensation_id);
    const after = inspectEffectCompensation(store, options);
    if (
        compensation.head_record_id !== after.head_record_id ||
        (claim !== undefined && claim.attempt_record_id !== compensation.attempts.at(-1)?.record_id)
    ) {
        throw new EffectCompensationEvidenceError(
            "compensation ownership changed during inspection or differs from latest attempt",
        );
    }
    const [absent, active, expired, released] = config.ownership.statuses;
    return Object.freeze({
        compensation,
        ownership: Object.freeze({
            claim_id: claim?.claim_id ?? null,
            fencing_token: claim?.fencing_token ?? null,
            lease_expires_at: claim?.lease_expires_at ?? null,
            status: (claim === undefined
                ? absent
                : claim.released
                  ? released
                  : claim.lease_expires_at <= Date.now()
                    ? expired
                    : active) as EffectCompensationOwnershipInspection["ownership"]["status"],
        }),
    });
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
 * the error propagates; after ownership releases or expires, the next trigger uses the same key.
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
 *   concurrently, owns an active lease, or fences this expired/replaced holder.
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
        const retained = foldCompensation(store, compensationId, store.readOwner(compensationId));
        if (
            retained?.status !== COMPENSATED_STATUS &&
            !reconciliationSuppressesRetry(
                readEffectReconciliationHistory(store, effect.evidence.record_id).at(-1),
            ) &&
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
        compensations.push(await compensateOne(store, effect, registry, trigger));
    }
    return Object.freeze({
        compensations: Object.freeze(compensations),
        failed: Object.freeze(
            compensations
                .filter(
                    (inspection) =>
                        inspection.status === FAILED_STATUS &&
                        !reconciliationSuppressesRetry(inspection.reconciliation),
                )
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
    registry: EffectCompensationRegistry | null,
    trigger: EffectCompensationTrigger,
): Promise<EffectCompensationInspection> {
    const compensationId = deriveEffectCompensationId(effect.evidence.record_id);
    let inspection = foldCompensation(store, compensationId, store.readOwner(compensationId));
    if (inspection === undefined) {
        const previous = store.readOwner(compensationId).at(-1)?.envelope.record_id ?? null;
        appendCompensationRecord(
            store,
            compensationId,
            previous,
            [...new Set([effect.evidence.record_id, ...(previous === null ? [] : [previous])])],
            store.readOwner(compensationId).length,
            createCompensationIntentBody(
                compensationId,
                effect.evidence,
                effect.intent,
                effect.outcome,
            ),
        );
        inspection = foldCompensation(
            store,
            compensationId,
            store.readOwner(compensationId),
        ) as EffectCompensationInspection;
    }
    const reconciliation = readEffectReconciliationHistory(store, effect.evidence.record_id).at(-1);
    if (inspection.status === COMPENSATED_STATUS || reconciliationSuppressesRetry(reconciliation)) {
        return withReconciliation(store, inspection);
    }
    const handler = registry?.resolve(effect.intent.kind);
    if (handler === undefined)
        throw new EffectCompensationHandlerNotFoundError(compensationId, effect.intent.kind);
    const attempt = inspection.attempts.length + 1;
    const fence = Object.freeze({
        claimId: config.ownership.claimIdPrefix + randomUUID(),
        fencingToken: attempt,
    });
    const attemptRecordId = appendCompensationRecord(
        store,
        compensationId,
        inspection.head_record_id,
        [inspection.head_record_id],
        store.readOwner(compensationId).length,
        createCompensationAttemptBody(compensationId, attempt, handler.handlerId, trigger),
        fence,
        reconciliation?.record_id ?? null,
    );
    let heartbeatFailure: unknown;
    const heartbeat = setInterval(() => {
        try {
            store.renewEffectCompensationClaim(compensationId, fence, Date.now());
        } catch (error) {
            heartbeatFailure = error;
            clearInterval(heartbeat);
        }
    }, config.ownership.renewalMilliseconds);
    heartbeat.unref();
    try {
        // Admission is durable before entering the handler; recheck just before invocation.
        store.renewEffectCompensationClaim(compensationId, fence, Date.now());
        const result = readEffectResult(
            await handler.compensate(
                Object.freeze({
                    attempt,
                    compensationId,
                    idempotencyKey: compensationId,
                    claimId: fence.claimId,
                    fencingToken: fence.fencingToken,
                    intent: inspection.effect_intent,
                    outcome: inspection.effect_outcome,
                    trigger: Object.freeze({ ...trigger }),
                }),
            ),
        );
        if (heartbeatFailure !== undefined) throw heartbeatFailure;
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
            fence,
        );
    } finally {
        clearInterval(heartbeat);
        // A release failure leaves the durable lease to expire; it must not replace a handler error.
        try {
            store.releaseEffectCompensationClaim(compensationId, fence);
        } catch {
            /* Expiry remains the recovery boundary. */
        }
    }
    return inspectEffectCompensation(store, { compensationId });
}

function withReconciliation(
    store: SQLiteTraceStore,
    inspection: EffectCompensationInspection,
): EffectCompensationInspection {
    const reconciliation = readEffectReconciliationHistory(
        store,
        inspection.materialization.record_id,
    ).at(-1);
    return reconciliation === undefined
        ? inspection
        : Object.freeze({ ...inspection, reconciliation });
}

function appendCompensationRecord(
    store: SQLiteTraceStore,
    compensationId: string,
    expectedHeadRecordId: RecordId | null,
    causes: readonly RecordId[],
    ordinal: number,
    body: EffectCompensationRecordBody,
    fence?: CompensationFence,
    reconciliationHead: RecordId | null = null,
): RecordId {
    const request: StoreAppendRequest = {
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
    };
    if (fence !== undefined) {
        const receipt =
            body.phase === ATTEMPT_PHASE
                ? store.claimEffectCompensationAttempt(
                      compensationId,
                      expectedHeadRecordId as RecordId,
                      fence,
                      Date.now(),
                      request,
                      reconciliationHead,
                  )
                : store.appendEffectCompensationOutcome(compensationId, fence, Date.now(), request);
        return receipt.record_ids[0] as RecordId;
    }
    const appended = store.appendEffectCompensationRecord(
        compensationId,
        expectedHeadRecordId,
        request,
    );
    if (appended.status === "head_moved") {
        throw new EffectCompensationConflictError(compensationId);
    }
    return appended.receipt.record_ids[0] as RecordId;
}
