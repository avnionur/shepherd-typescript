/** Stable Node-only ESM subpath for effect records, in-process handler dispatch, and compensation. */
export {
    compensateEffects,
    createEffectCompensationRegistry,
    inspectEffectCompensation,
    inspectEffectCompensationOwnership,
} from "../effect/compensation.ts";
export {
    EffectCompensationConflictError,
    EffectCompensationEvidenceError,
    EffectCompensationFailedError,
    EffectCompensationHandlerNotFoundError,
} from "../effect/compensation-errors.ts";
export { deriveEffectCompensationId } from "../effect/compensation-records.ts";
export type {
    CompensateEffectsOptions,
    EffectCompensationAttemptInspection,
    EffectCompensationHandler,
    EffectCompensationInspection,
    EffectCompensationOutcomeStatus,
    EffectCompensationOwnershipInspection,
    EffectCompensationReceipt,
    EffectCompensationRegistry,
    EffectCompensationRequest,
    EffectCompensationStatus,
    EffectCompensationTrigger,
    EffectCompensationTriggerKind,
    InspectEffectCompensationOptions,
    MaterializedEffectEvidence,
    MaterializedEffectEvidenceKind,
} from "../effect/compensation-types.ts";
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
export {
    createTypedEffectHandler,
    type TypedEffectHandlerOptions,
} from "../effect/typed-handler.ts";
export type {
    EffectFailure,
    EffectIntent,
    EffectIntentDefinition,
    EffectOutcome,
    EffectResult,
    EffectReversibility,
    EffectSuccess,
} from "../effect/types.ts";
export {
    EFFECT_COMPENSABLE_TIERS,
    EFFECT_COMPENSATION_EVIDENCE_KINDS,
    EFFECT_COMPENSATION_OUTCOMES,
    EFFECT_COMPENSATION_OWNERSHIP_STATUSES,
    EFFECT_COMPENSATION_PHASES,
    EFFECT_COMPENSATION_STATUSES,
    EFFECT_COMPENSATION_TRIGGERS,
} from "../protocol/values.generated.ts";
