import { createHash } from "node:crypto";

import {
    createRecordId,
    type SemanticRecord,
    type SemanticValue,
} from "../canonical/canonical-record.ts";
import { createCanonicalSnapshot } from "../canonical/snapshot.ts";
import { effectProtocolConfig } from "../protocol/config.ts";
import {
    EFFECT_COMPENSATION_EVIDENCE_KINDS,
    EFFECT_COMPENSATION_OUTCOMES,
    EFFECT_COMPENSATION_PHASES,
    EFFECT_COMPENSATION_TRIGGERS,
} from "../protocol/values.generated.ts";
import { assertRecordId } from "../record/guards.ts";
import type { RecordId } from "../record/types.ts";
import { EffectCompensationEvidenceError } from "./compensation-errors.ts";
import type {
    EffectCompensationTrigger,
    MaterializedEffectEvidence,
} from "./compensation-types.ts";
import type { EffectIntent, EffectOutcome, EffectResult } from "./types.ts";
import {
    readDataObject,
    readEffectIntent,
    readEffectOutcome,
    readEffectResult,
} from "./validation.ts";

const config = effectProtocolConfig.compensation;
const [INTENT_PHASE, ATTEMPT_PHASE, OUTCOME_PHASE] = EFFECT_COMPENSATION_PHASES;
const COMMON_KEYS = ["compatibility_version", "compensation_id", "phase", "record_version"];

/** Retained compensation intent: the materialized effect that must be compensated. @internal */
export type EffectCompensationIntentBody = {
    readonly compatibility_version: string;
    readonly compensation_id: string;
    readonly effect_intent: EffectIntent;
    readonly effect_outcome: EffectOutcome;
    readonly materialization: MaterializedEffectEvidence;
    readonly phase: (typeof EFFECT_COMPENSATION_PHASES)[0];
    readonly record_version: number;
};

/** Retained declaration that one handler invocation is about to start. @internal */
export type EffectCompensationAttemptBody = {
    readonly attempt: number;
    readonly compatibility_version: string;
    readonly compensation_id: string;
    readonly handler_id: string;
    readonly phase: (typeof EFFECT_COMPENSATION_PHASES)[1];
    readonly record_version: number;
    readonly trigger: EffectCompensationTrigger;
};

/** Retained result of one handler invocation. @internal */
export type EffectCompensationOutcomeBody = {
    readonly attempt: number;
    readonly compatibility_version: string;
    readonly compensation_id: string;
    readonly phase: (typeof EFFECT_COMPENSATION_PHASES)[2];
    readonly record_version: number;
    readonly result: EffectResult<SemanticValue, SemanticValue>;
    readonly status: (typeof EFFECT_COMPENSATION_OUTCOMES)[number];
};

/** Any retained compensation record body. @internal */
export type EffectCompensationRecordBody =
    | EffectCompensationAttemptBody
    | EffectCompensationIntentBody
    | EffectCompensationOutcomeBody;

/**
 * Derives the compensation identity of one materialized effect. The identity is also the owner
 * path retaining its compensation records, so every trigger that reaches the same materialization
 * shares one compensation.
 *
 * @param materializationRecordId - Record that retains the original materialization.
 * @returns The configured compensation identity.
 * @throws {TypeError} If the record identity is malformed.
 *
 * @example
 * ```ts
 * const compensationId = deriveEffectCompensationId(step.record_id);
 * ```
 *
 * @public
 */
export function deriveEffectCompensationId(materializationRecordId: RecordId): string {
    assertRecordId(materializationRecordId, "materializationRecordId");
    const digest = createHash(effectProtocolConfig.digestAlgorithm)
        .update(materializationRecordId, "utf8")
        .digest("hex");
    return `${config.identity.compensationIdPrefix}${digest}`;
}

/** Derives the append intent of one record at one ordinal of a compensation path. @internal */
export function createCompensationAppendIntentId(
    body: EffectCompensationRecordBody,
    ordinal: number,
): string {
    return createRecordId({
        [config.identity.appendIntentKind]: {
            compensation_id: body.compensation_id,
            ordinal,
            record_id: createRecordId(body as unknown as SemanticRecord),
        },
    });
}

/** Creates the canonical compensation intent body. @internal */
export function createCompensationIntentBody(
    compensationId: string,
    materialization: MaterializedEffectEvidence,
    intent: EffectIntent,
    outcome: EffectOutcome,
): EffectCompensationIntentBody {
    return createCanonicalSnapshot({
        compatibility_version: config.compatibilityVersion,
        compensation_id: compensationId,
        effect_intent: intent,
        effect_outcome: outcome,
        materialization,
        phase: INTENT_PHASE,
        record_version: config.recordVersion,
    }) as EffectCompensationIntentBody;
}

/** Creates the canonical attempt declaration body. @internal */
export function createCompensationAttemptBody(
    compensationId: string,
    attempt: number,
    handlerId: string,
    trigger: EffectCompensationTrigger,
): EffectCompensationAttemptBody {
    return createCanonicalSnapshot({
        attempt,
        compatibility_version: config.compatibilityVersion,
        compensation_id: compensationId,
        handler_id: handlerId,
        phase: ATTEMPT_PHASE,
        record_version: config.recordVersion,
        trigger: { command_id: trigger.command_id, kind: trigger.kind },
    }) as EffectCompensationAttemptBody;
}

/** Creates the canonical outcome body of one attempt. @internal */
export function createCompensationOutcomeBody(
    compensationId: string,
    attempt: number,
    result: EffectCompensationOutcomeBody["result"],
): EffectCompensationOutcomeBody {
    const [COMPENSATED, FAILED] = EFFECT_COMPENSATION_OUTCOMES;
    return createCanonicalSnapshot({
        attempt,
        compatibility_version: config.compatibilityVersion,
        compensation_id: compensationId,
        phase: OUTCOME_PHASE,
        record_version: config.recordVersion,
        result,
        status: result.ok ? COMPENSATED : FAILED,
    }) as EffectCompensationOutcomeBody;
}

/** Validates one retained compensation record body of an exact compensation path. @internal */
export function readCompensationRecordBody(
    body: unknown,
    compensationId: string,
): EffectCompensationRecordBody {
    try {
        const phase = (body as { readonly phase?: unknown } | null)?.phase;
        if (!(EFFECT_COMPENSATION_PHASES as readonly unknown[]).includes(phase)) {
            throw new TypeError("compensation record phase is not configured");
        }
        const keys =
            phase === INTENT_PHASE
                ? [...COMMON_KEYS, "effect_intent", "effect_outcome", "materialization"]
                : phase === ATTEMPT_PHASE
                  ? [...COMMON_KEYS, "attempt", "handler_id", "trigger"]
                  : [...COMMON_KEYS, "attempt", "result", "status"];
        const fields = readDataObject(body, keys, "compensation record");
        if (
            fields.compatibility_version !== config.compatibilityVersion ||
            fields.record_version !== config.recordVersion ||
            fields.compensation_id !== compensationId
        ) {
            throw new TypeError("compensation record names another version or compensation");
        }
        if (phase === INTENT_PHASE) {
            const materialization = readDataObject(
                fields.materialization,
                ["kind", "record_id"],
                "compensation materialization",
            );
            if (
                !(EFFECT_COMPENSATION_EVIDENCE_KINDS as readonly unknown[]).includes(
                    materialization.kind,
                )
            ) {
                throw new TypeError("compensation materialization kind is not configured");
            }
            assertRecordId(materialization.record_id, "materialization.record_id");
            if (deriveEffectCompensationId(materialization.record_id) !== compensationId) {
                throw new TypeError(
                    "compensation identity does not derive from its materialization",
                );
            }
            readEffectIntent(fields.effect_intent as EffectIntent);
            readEffectOutcome(fields.effect_outcome);
            return body as EffectCompensationIntentBody;
        }
        if (!Number.isSafeInteger(fields.attempt) || (fields.attempt as number) < 1) {
            throw new TypeError("compensation attempt must be a positive integer");
        }
        if (phase === ATTEMPT_PHASE) {
            if (typeof fields.handler_id !== "string" || fields.handler_id.length === 0) {
                throw new TypeError("compensation handler_id must be a non-empty string");
            }
            const trigger = readDataObject(
                fields.trigger,
                ["command_id", "kind"],
                "compensation trigger",
            );
            if (
                typeof trigger.command_id !== "string" ||
                trigger.command_id.length === 0 ||
                !(EFFECT_COMPENSATION_TRIGGERS as readonly unknown[]).includes(trigger.kind)
            ) {
                throw new TypeError("compensation trigger is malformed");
            }
            return body as EffectCompensationAttemptBody;
        }
        const result = readEffectResult(
            fields.result as EffectResult<SemanticValue, SemanticValue>,
        );
        const [COMPENSATED, FAILED] = EFFECT_COMPENSATION_OUTCOMES;
        if (fields.status !== (result.ok ? COMPENSATED : FAILED)) {
            throw new TypeError("compensation status disagrees with its result");
        }
        return body as EffectCompensationOutcomeBody;
    } catch (error) {
        throw new EffectCompensationEvidenceError(
            `compensation ${compensationId} retains a malformed record`,
            { cause: error },
        );
    }
}
