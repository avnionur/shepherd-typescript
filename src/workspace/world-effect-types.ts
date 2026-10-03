import type { EffectIntent, EffectOutcome } from "../effect/types.ts";
import type { WORLD_EFFECT_RECOVERY } from "../protocol/values.generated.ts";
import type { RecordId } from "../record/types.ts";
import type { DurableTaskExecutionRecovery } from "../run/durable-execution-types.ts";

/** Bounded, plaintext-free evidence of one supplied or returned text value. */
export type WorldEffectTextEvidence = {
    /** UTF-8 encoding byte length (replacement length for invalid strings), or null for non-text. */
    readonly byte_length: number | null;
    /** Configured digest, omitted for invalid or over-bound text. */
    readonly digest: string | null;
    /** Whether the input was a well-formed UTF-8 string. */
    readonly valid_text: boolean;
    /** Whether its byte length fits the configured evidence bound. */
    readonly within_bound: boolean;
};

/** Exact invocation and resource authority governing a world-operation stream. */
export type WorldEffectAuthority = {
    /** Ordered effective repository capability atoms. */
    readonly authority: readonly string[];
    /** Exact immutable base of the isolated custody. */
    readonly base_revision_id: string;
    /** Exact workspace binding. */
    readonly binding_id: string;
    /** Owning durable invocation claim. */
    readonly claim_id: string;
    /** Declared plaintext-free content policy. */
    readonly content_policy: string;
    /** Exact isolated custody. */
    readonly custody_id: string;
    /** Actual runner enforcement classification. */
    readonly enforcement: string;
    /** Monotonic invocation fence. */
    readonly fencing_token: number;
    /** Repository grant plan identity, or null for ordinary binding authority. */
    readonly grant_plan_id: string | null;
    /** Exact repository resource, or null for ordinary binding authority. */
    readonly resource_id: string | null;
};

/** Retained evidence of one built-in world capability invocation. */
export type WorldEffectOperationInspection = {
    /** Admission retained immediately before filesystem materialization, or null. */
    readonly admission_record_id: RecordId | null;
    /** Monotonic zero-based operation index within this invocation. */
    readonly index: number;
    /** Correlated typed intent containing bounded path/content evidence and required authority. */
    readonly intent: EffectIntent;
    /** Retained intent record identity. */
    readonly intent_record_id: RecordId;
    /** Correlated outcome, or null if interruption left it unknown. */
    readonly outcome: EffectOutcome | null;
    /** Outcome record identity, or null. */
    readonly outcome_record_id: RecordId | null;
    /** Whether this operation is not materialized, uncertain, or settled. */
    readonly status: (typeof WORLD_EFFECT_RECOVERY)[number];
};

/** Pure record-derived world-operation stream, independent of current process liveness. */
export type WorldEffectJournalEvidence = {
    /** Exact authority recorded when the capability was issued, or null for absent evidence. */
    readonly authority: WorldEffectAuthority | null;
    /** Authority record identity, or null. */
    readonly authority_record_id: RecordId | null;
    /** Capture correlation identity, or null. */
    readonly capture_id: string | null;
    /** Ordered invocations including refusals and an optional interrupted tail. */
    readonly operations: readonly WorldEffectOperationInspection[];
    /** Exact durable run owner. */
    readonly run_id: string;
    /** Evidence state; recording does not assert that a writer is currently alive. */
    readonly status: (typeof WORLD_EFFECT_RECOVERY)[number];
};

/** World-operation evidence paired with the enclosing durable run's recovery classification. */
export type WorldEffectJournalInspection = WorldEffectJournalEvidence & {
    /** Independent enclosing-run recovery state; uncertain execution is never retried here. */
    readonly recovery_status: DurableTaskExecutionRecovery["status"];
};
