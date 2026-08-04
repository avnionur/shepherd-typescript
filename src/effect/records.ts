import { createHash } from "node:crypto";

import { canonicalizeRecord, type SemanticValue } from "../canonical/canonical-record.ts";
import { createCanonicalSnapshot } from "../canonical/snapshot.ts";
import { effectProtocolConfig } from "../protocol/config.ts";
import type { EffectIntent, EffectIntentDefinition, EffectOutcome, EffectResult } from "./types.ts";
import {
    readEffectIntent,
    readEffectIntentDefinition,
    readEffectOutcome,
    readEffectResult,
} from "./validation.ts";

/**
 * Creates the immutable versioned record emitted before an effect may materialize.
 *
 * @param definition - Typed identity, family, payload, and reversibility declaration.
 * @returns A deeply frozen canonical effect intent.
 * @throws {TypeError} If the definition or payload is malformed.
 *
 * @example
 * ```ts
 * const intent = createEffectIntent({
 *     effectId: "effect:tool:1",
 *     kind: "tool.call",
 *     payload: { command: "pnpm test" },
 *     reversibility: "irreversible",
 * });
 * ```
 */
export function createEffectIntent<K extends string, P extends SemanticValue>(
    definition: EffectIntentDefinition<K, P>,
): EffectIntent<K, P> {
    const values = readEffectIntentDefinition(definition);
    return createCanonicalSnapshot({
        effect_id: values.effectId,
        intent_version: effectProtocolConfig.intentVersion,
        kind: values.kind,
        payload: values.payload,
        phase: effectProtocolConfig.phases.intent,
        reversibility: values.reversibility,
    }) as EffectIntent<K, P>;
}

/**
 * Creates an immutable outcome bound to the complete canonical effect intent.
 *
 * @param intent - Valid canonical intent that preceded world interaction.
 * @param result - Typed success value or failure information returned by the world.
 * @returns A deeply frozen canonical outcome containing the intent digest.
 * @throws {TypeError} If the intent or result is malformed.
 *
 * @example
 * ```ts
 * const outcome = createEffectOutcome(intent, {
 *     ok: true,
 *     value: { exitCode: 0 },
 * });
 * ```
 */
export function createEffectOutcome<
    K extends string,
    P extends SemanticValue,
    V extends SemanticValue,
    E extends SemanticValue = SemanticValue,
>(intent: EffectIntent<K, P>, result: EffectResult<V, E>): EffectOutcome<K, V, E> {
    const validatedIntent = readEffectIntent(intent);
    const validatedResult = readEffectResult(result);
    return createCanonicalSnapshot({
        effect_id: validatedIntent.effect_id,
        intent_ref: createIntentReference(validatedIntent),
        kind: validatedIntent.kind,
        outcome_version: effectProtocolConfig.outcomeVersion,
        phase: effectProtocolConfig.phases.outcome,
        result: validatedResult,
    }) as EffectOutcome<K, V, E>;
}

/**
 * Validates that an outcome exactly cites the supplied canonical intent.
 *
 * Correlation covers the intent version, ID, kind, payload, phase, and reversibility through
 * `intent_ref`, while the ID and kind are repeated for direct indexing.
 *
 * @param intent - Canonical intent expected to precede the outcome.
 * @param outcome - Untrusted candidate outcome to validate.
 * @returns The validated outcome with its typed effect family and result.
 * @throws {TypeError} If either record is malformed or correlation does not match exactly.
 */
export function validateEffectCorrelation<
    K extends string,
    P extends SemanticValue,
    V extends SemanticValue = SemanticValue,
    E extends SemanticValue = SemanticValue,
>(intent: EffectIntent<K, P>, outcome: unknown): EffectOutcome<K, V, E> {
    const validatedIntent = readEffectIntent(intent);
    const validatedOutcome = readEffectOutcome<K, V, E>(outcome);
    if (
        validatedOutcome.effect_id !== validatedIntent.effect_id ||
        validatedOutcome.kind !== validatedIntent.kind ||
        validatedOutcome.intent_ref !== createIntentReference(validatedIntent)
    ) {
        throw new TypeError("effect outcome does not exactly correlate to the supplied intent");
    }
    return outcome as EffectOutcome<K, V, E>;
}

function createIntentReference(intent: EffectIntent): string {
    const digest = createHash(effectProtocolConfig.digestAlgorithm)
        .update(canonicalizeRecord(intent), "utf8")
        .digest("hex");
    return `${effectProtocolConfig.digestPrefix}${digest}`;
}
