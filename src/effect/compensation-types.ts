import type { SemanticValue } from "../canonical/canonical-record.ts";
import type {
    EFFECT_COMPENSATION_EVIDENCE_KINDS,
    EFFECT_COMPENSATION_OUTCOMES,
    EFFECT_COMPENSATION_OWNERSHIP_STATUSES,
    EFFECT_COMPENSATION_STATUSES,
    EFFECT_COMPENSATION_TRIGGERS,
} from "../protocol/values.generated.ts";
import type { RecordId } from "../record/types.ts";
import type { EffectReconciliationReceipt } from "./reconciliation-types.ts";
import type { EffectIntent, EffectOutcome, EffectResult } from "./types.ts";

/** Configured materialization evidence kind. */
export type MaterializedEffectEvidenceKind = (typeof EFFECT_COMPENSATION_EVIDENCE_KINDS)[number];

/** Configured compensation trigger kind. */
export type EffectCompensationTriggerKind = (typeof EFFECT_COMPENSATION_TRIGGERS)[number];

/** Configured derived compensation status. */
export type EffectCompensationStatus = (typeof EFFECT_COMPENSATION_STATUSES)[number];

/** Configured outcome status of one compensation attempt. */
export type EffectCompensationOutcomeStatus = (typeof EFFECT_COMPENSATION_OUTCOMES)[number];

/** Record that retains the original materialization of one effect. */
export type MaterializedEffectEvidence = {
    /** Evidence kind: a live replay effect step or a supervised dispatch resolution. */
    readonly kind: MaterializedEffectEvidenceKind;
    /** Record identity of that step or resolution. */
    readonly record_id: RecordId;
};

/** Trigger that caused one compensation attempt. */
export type EffectCompensationTrigger = {
    /** Command identity of the discard, branch, or explicit compensation command. */
    readonly command_id: string;
    /** Trigger kind. */
    readonly kind: EffectCompensationTriggerKind;
};

/** Request passed to a compensation handler for one attempt. */
export type EffectCompensationRequest = {
    /** Fresh invocation holder; distinct from the stable external idempotency key. */
    readonly claimId: string;
    /** Monotonic materialization attempt fence for fence-aware external handlers. */
    readonly fencingToken: number;
    /** One-based attempt number; retries follow a failed, released or expired attempt. */
    readonly attempt: number;
    /** Compensation identity. */
    readonly compensationId: string;
    /**
     * Stable key shared by every attempt of this compensation. A handler must make its world
     * change idempotent under this key, because an attempt interrupted by a crash is invoked again.
     */
    readonly idempotencyKey: string;
    /** Immutable intent of the materialized effect. */
    readonly intent: EffectIntent;
    /** Immutable successful outcome of the materialized effect. */
    readonly outcome: EffectOutcome;
    /** Trigger of this attempt. */
    readonly trigger: EffectCompensationTrigger;
};

/** Compensation handler registered for one exact effect kind. */
export type EffectCompensationHandler = {
    /**
     * Reverses one materialized effect idempotently under `request.idempotencyKey`.
     *
     * @param request - Attempt, identity, immutable effect records, and trigger.
     * @returns `{ ok: true, value }` when the effect is compensated, or `{ ok: false, error }`
     *   when the world refused; either result is retained.
     * @throws Any failure leaves the attempt uncertain and propagates unchanged; after ownership
     *   is released or expires, a later trigger invokes the same external idempotency key.
     */
    readonly compensate: (
        request: EffectCompensationRequest,
    ) =>
        | EffectResult<SemanticValue, SemanticValue>
        | Promise<EffectResult<SemanticValue, SemanticValue>>;
    /** Stable diagnostic identity retained on every attempt record. */
    readonly handlerId: string;
    /** Exact effect kind compensated by this handler. */
    readonly kind: string;
};

/** Immutable registry holding exactly one compensation handler per effect kind. */
export type EffectCompensationRegistry = {
    /** Registered effect kinds in registration order. */
    readonly kinds: readonly string[];
    /**
     * Returns the handler registered for an exact effect kind.
     *
     * @param kind - Exact effect kind.
     * @returns The handler, or undefined when the kind is not registered.
     */
    readonly resolve: (kind: string) => EffectCompensationHandler | undefined;
};

/** One retained attempt and its outcome. */
export type EffectCompensationAttemptInspection = {
    /** One-based attempt number. */
    readonly attempt: number;
    /** Handler identity retained before the invocation. */
    readonly handler_id: string;
    /** Retained outcome, or null while the attempt is uncertain. */
    readonly outcome: {
        /** Outcome record identity. */
        readonly record_id: RecordId;
        /** Semantic result returned by the handler. */
        readonly result: EffectResult<SemanticValue, SemanticValue>;
        /** Compensated or failed. */
        readonly status: EffectCompensationOutcomeStatus;
    } | null;
    /** Attempt record identity. */
    readonly record_id: RecordId;
    /** Trigger of this attempt. */
    readonly trigger: EffectCompensationTrigger;
};

/** Record-derived view of one compensation path. */
export type EffectCompensationInspection = {
    /** Latest operator audit, when present; never changes the factual outcome status. */
    readonly reconciliation?: EffectReconciliationReceipt;
    /** Attempts in retained order. */
    readonly attempts: readonly EffectCompensationAttemptInspection[];
    /** Compensation identity and owner path. */
    readonly compensation_id: string;
    /** Intent of the materialized effect. */
    readonly effect_intent: EffectIntent;
    /** Successful outcome of the materialized effect. */
    readonly effect_outcome: EffectOutcome;
    /** Current owner-path head. */
    readonly head_record_id: RecordId;
    /** Compensation intent record identity. */
    readonly intent_record_id: RecordId;
    /** Original materialization evidence. */
    readonly materialization: MaterializedEffectEvidence;
    /**
     * `pending` before any attempt, `uncertain` when the latest attempt has no outcome, `failed`
     * when it failed, and `compensated` once an attempt compensated the effect; nothing follows.
     */
    readonly status: EffectCompensationStatus;
};

/** Options accepted by {@link inspectEffectCompensation}. */
export type InspectEffectCompensationOptions = {
    /** Exact compensation identity. */
    readonly compensationId: string;
};

/** Options accepted by {@link compensateEffects}. */
export type CompensateEffectsOptions = {
    /** Globally meaningful command identity retained on every attempt as the trigger. */
    readonly commandId: string;
    /**
     * Materialization evidence records in materialization order: live or recorded replay effect
     * steps and supervised dispatch resolutions. Compensation runs in reverse order.
     */
    readonly effectRecordIds: readonly RecordId[];
    /** Compensation handlers by effect kind. */
    readonly registry: EffectCompensationRegistry;
};

/** Receipt of one trigger's compensation pass. */
export type EffectCompensationReceipt = {
    /** Compensations in the order they ran: reverse materialization order. */
    readonly compensations: readonly EffectCompensationInspection[];
};

/** Immutable evidence plus a separate live store-local ownership snapshot. */
export type EffectCompensationOwnershipInspection = {
    /** Immutable record-derived compensation status, including uncertain attempts. */
    readonly compensation: EffectCompensationInspection;
    /** Operational lease; imported semantic archives do not transfer a live holder. */
    readonly ownership: {
        /** Current or last holder; null for absent ownership. */
        readonly claim_id: string | null;
        /** Canonical attempt fence; null for absent ownership. */
        readonly fencing_token: number | null;
        /** Unix-millisecond expiry; null for absent ownership. */
        readonly lease_expires_at: number | null;
        /** Configured live ownership classification, independent of compensation outcome. */
        readonly status: (typeof EFFECT_COMPENSATION_OWNERSHIP_STATUSES)[number];
    };
};
