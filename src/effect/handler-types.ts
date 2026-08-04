import type { SemanticValue } from "../canonical/canonical-record.ts";
import type { EffectIntent, EffectOutcome, EffectResult } from "./types.ts";

/** Synchronous or asynchronous interpretation of one exact effect kind. */
export type EffectHandler<
    K extends string = string,
    P extends SemanticValue = SemanticValue,
    V extends SemanticValue = SemanticValue,
    E extends SemanticValue = SemanticValue,
> = {
    /** Interprets one validated immutable intent and returns an explicit semantic result. */
    readonly handle: (
        intent: EffectIntent<K, P>,
    ) => EffectResult<V, E> | Promise<EffectResult<V, E>>;
    /** Stable diagnostic identity for the selected handler implementation. */
    readonly handlerId: string;
    /** Exact application-defined effect kind handled by this binding. */
    readonly kind: K;
};

/** Immutable result of selecting and invoking one effect handler. */
export type EffectHandlerDispatch<
    K extends string = string,
    V extends SemanticValue = SemanticValue,
    E extends SemanticValue = SemanticValue,
> = {
    /** Stable identity of the handler selected by configured precedence. */
    readonly handlerId: string;
    /** Immutable outcome exactly correlated to the dispatched intent. */
    readonly outcome: EffectOutcome<K, V, E>;
};

/** Immutable ordered collection that dispatches validated effect intents. */
export type EffectHandlerStack = {
    /**
     * Dispatches an intent through the configured exact-kind precedence rule.
     *
     * @param intent - Untrusted or canonical effect intent to validate before handler invocation.
     * @returns The selected handler identity and exactly correlated immutable outcome.
     * @throws {EffectHandlerNotFoundError} If no handler matches the exact effect kind.
     * @throws {TypeError} If the intent or returned result is malformed.
     * @throws If the selected handler throws or rejects; the original failure is preserved.
     */
    readonly dispatch: <K extends string, P extends SemanticValue>(
        intent: EffectIntent<K, P>,
    ) => Promise<EffectHandlerDispatch<K>>;
};
