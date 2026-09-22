import { canonicalizeRecord, type SemanticValue } from "../canonical/canonical-record.ts";
import { CanonicalNestingLimitError } from "../canonical/errors.ts";
import { effectProtocolConfig } from "../protocol/config.ts";
import type {
    EffectFailure,
    EffectIntent,
    EffectIntentDefinition,
    EffectOutcome,
    EffectResult,
    EffectSuccess,
} from "./types.ts";

/** Reads and validates an exact effect intent definition. @internal */
export function readEffectIntentDefinition<K extends string, P extends SemanticValue>(
    value: EffectIntentDefinition<K, P>,
): EffectIntentDefinition<K, P> {
    const fields = readDataObject(
        value,
        ["effectId", "kind", "payload", "reversibility"],
        "effect intent definition",
    );
    assertText(fields.effectId, "effectId");
    assertText(fields.kind, "kind");
    if (!effectProtocolConfig.reversibilityTiers.includes(fields.reversibility as string)) {
        throw new TypeError("reversibility must be a configured effect tier");
    }
    assertSemanticValue(fields.payload, "payload");
    return fields as EffectIntentDefinition<K, P>;
}

/** Reads and validates an exact canonical effect intent. @internal */
export function readEffectIntent<K extends string, P extends SemanticValue>(
    value: EffectIntent<K, P>,
): EffectIntent<K, P> {
    const fields = readDataObject(
        value,
        ["effect_id", "intent_version", "kind", "payload", "phase", "reversibility"],
        "effect intent",
    );
    assertText(fields.effect_id, "effect_id");
    assertText(fields.kind, "kind");
    if (fields.intent_version !== effectProtocolConfig.intentVersion) {
        throw new TypeError("intent_version is not supported");
    }
    if (fields.phase !== effectProtocolConfig.phases.intent) {
        throw new TypeError("effect intent phase is invalid");
    }
    if (!effectProtocolConfig.reversibilityTiers.includes(fields.reversibility as string)) {
        throw new TypeError("reversibility must be a configured effect tier");
    }
    assertSemanticValue(fields.payload, "payload");
    return fields as EffectIntent<K, P>;
}

/** Reads and validates an exact effect result. @internal */
export function readEffectResult<V extends SemanticValue, E extends SemanticValue>(
    value: EffectResult<V, E>,
): EffectResult<V, E> {
    const candidate = readDataObjectWithKnownShape(value, "effect result");
    if (candidate.ok === true) {
        const fields = readExactFields(candidate, ["ok", "value"], "successful effect result");
        assertSemanticValue(fields.value, "effect result value");
        return fields as EffectSuccess<V>;
    }
    if (candidate.ok === false) {
        const fields = readExactFields(candidate, ["error", "ok"], "failed effect result");
        assertSemanticValue(fields.error, "effect result error");
        return fields as EffectFailure<E>;
    }
    throw new TypeError("effect result ok must be a boolean discriminant");
}

/** Reads and validates an exact canonical effect outcome. @internal */
export function readEffectOutcome<
    K extends string,
    V extends SemanticValue,
    E extends SemanticValue,
>(value: unknown): EffectOutcome<K, V, E> {
    const fields = readDataObject(
        value,
        ["effect_id", "intent_ref", "kind", "outcome_version", "phase", "result"],
        "effect outcome",
    );
    assertText(fields.effect_id, "effect_id");
    assertText(fields.intent_ref, "intent_ref");
    assertText(fields.kind, "kind");
    if (fields.outcome_version !== effectProtocolConfig.outcomeVersion) {
        throw new TypeError("outcome_version is not supported");
    }
    if (fields.phase !== effectProtocolConfig.phases.outcome) {
        throw new TypeError("effect outcome phase is invalid");
    }
    readEffectResult(fields.result as EffectResult<V, E>);
    return fields as EffectOutcome<K, V, E>;
}

function assertSemanticValue(value: unknown, subject: string): asserts value is SemanticValue {
    if (value === undefined) {
        throw new TypeError(`${subject} must be a canonical semantic value`);
    }
    try {
        canonicalizeRecord({ value: value as SemanticValue });
    } catch (error) {
        if (error instanceof CanonicalNestingLimitError) throw error;
        throw new TypeError(`${subject} must be a canonical semantic value`, { cause: error });
    }
}

function assertText(value: unknown, subject: string): asserts value is string {
    if (typeof value !== "string" || value.length === 0 || /[\uD800-\uDFFF]/u.test(value)) {
        throw new TypeError(`${subject} must be a non-empty well-formed string`);
    }
}

/** Reads an exact descriptor-safe effect option object. @internal */
export function readDataObject(
    value: unknown,
    keys: readonly string[],
    subject: string,
): Record<string, unknown> {
    return readExactFields(readDataObjectWithKnownShape(value, subject), keys, subject);
}

function readDataObjectWithKnownShape(value: unknown, subject: string): Record<string, unknown> {
    if (
        value === null ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        (Object.getPrototypeOf(value) !== Object.prototype &&
            Object.getPrototypeOf(value) !== null) ||
        Object.getOwnPropertySymbols(value).length > 0
    ) {
        throw new TypeError(`${subject} must be a plain data object`);
    }
    const fields = Object.create(null) as Record<string, unknown>;
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
        if (!("value" in descriptor)) {
            throw new TypeError(`${subject} ${key} must be a data property`);
        }
        fields[key] = descriptor.value;
    }
    return fields;
}

function readExactFields(
    fields: Record<string, unknown>,
    keys: readonly string[],
    subject: string,
): Record<string, unknown> {
    if (Object.keys(fields).sort().join("\0") !== [...keys].sort().join("\0")) {
        throw new TypeError(`${subject} must contain exactly its declared fields`);
    }
    return fields;
}
