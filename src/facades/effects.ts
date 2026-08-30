/** Stable Node-only ESM subpath for effect records and in-process handler dispatch. */
export { EffectHandlerNotFoundError } from "../effect/handler-errors.ts";
export type {
    EffectHandler,
    EffectHandlerDispatch,
    EffectHandlerStack,
} from "../effect/handler-types.ts";
export { createEffectHandlerStack } from "../effect/handlers.ts";
export {
    createEffectIntent,
    createEffectOutcome,
    validateEffectCorrelation,
} from "../effect/records.ts";
export type {
    EffectFailure,
    EffectIntent,
    EffectIntentDefinition,
    EffectOutcome,
    EffectResult,
    EffectReversibility,
    EffectSuccess,
} from "../effect/types.ts";
