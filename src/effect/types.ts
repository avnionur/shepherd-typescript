import type { SemanticValue } from "../canonical/canonical-record.ts";
import type { EFFECT_PHASES, EFFECT_REVERSIBILITY_TIERS } from "../protocol/values.generated.ts";

/** Reversibility guarantees attached to an effect before materialization. */
export type EffectReversibility = (typeof EFFECT_REVERSIBILITY_TIERS)[number];

/** Definition accepted by {@link createEffectIntent}. */
export type EffectIntentDefinition<K extends string, P extends SemanticValue> = {
    /** Caller-assigned identity shared by the intent and its outcome. */
    readonly effectId: string;
    /** Application-defined typed effect family. */
    readonly kind: K;
    /** Canonical semantic parameters required to materialize the effect. */
    readonly payload: P;
    /** Declared undo guarantee governing interception and compensation. */
    readonly reversibility: EffectReversibility;
};

/** Immutable canonical record emitted before an effect may materialize. */
export type EffectIntent<K extends string = string, P extends SemanticValue = SemanticValue> = {
    /** Caller-assigned identity shared with the correlated outcome. */
    readonly effect_id: string;
    /** Configured intent wire version. */
    readonly intent_version: number;
    /** Application-defined typed effect family. */
    readonly kind: K;
    /** Canonical semantic parameters for the attempted action. */
    readonly payload: P;
    /** Intent phase discriminant. */
    readonly phase: (typeof EFFECT_PHASES)["intent"];
    /** Declared undo guarantee for the attempted action. */
    readonly reversibility: EffectReversibility;
};

/** Successful effect materialization result. */
export type EffectSuccess<V extends SemanticValue> = {
    /** Indicates that the world accepted and completed the effect. */
    readonly ok: true;
    /** Canonical semantic value returned by the world. Use `null` for no value. */
    readonly value: V;
};

/** Failed effect materialization result. */
export type EffectFailure<E extends SemanticValue> = {
    /** Canonical semantic failure information returned by the world. */
    readonly error: E;
    /** Indicates that the effect did not complete successfully. */
    readonly ok: false;
};

/** Result accepted by {@link createEffectOutcome}. */
export type EffectResult<V extends SemanticValue, E extends SemanticValue> =
    | EffectFailure<E>
    | EffectSuccess<V>;

/** Immutable canonical record emitted after an effect receives a world response. */
export type EffectOutcome<
    K extends string = string,
    V extends SemanticValue = SemanticValue,
    E extends SemanticValue = SemanticValue,
> = {
    /** Caller-assigned identity copied from the correlated intent. */
    readonly effect_id: string;
    /** Digest of the complete canonical correlated intent. */
    readonly intent_ref: string;
    /** Application-defined effect family copied from the correlated intent. */
    readonly kind: K;
    /** Configured outcome wire version. */
    readonly outcome_version: number;
    /** Outcome phase discriminant. */
    readonly phase: (typeof EFFECT_PHASES)["outcome"];
    /** Canonical success or failure returned by the world. */
    readonly result: EffectResult<V, E>;
};
