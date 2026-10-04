import type {
    EFFECT_RECONCILIATION_DISPOSITIONS,
    EFFECT_RECONCILIATION_SOURCE_KINDS,
} from "../protocol/values.generated.ts";
import type { RecordId } from "../record/types.ts";
import type { EffectCompensationInspection } from "./compensation-types.ts";
import type { EffectIntent, EffectOutcome } from "./types.ts";

/** Configured operator disposition, independent of handler success. */
export type EffectReconciliationDisposition = (typeof EFFECT_RECONCILIATION_DISPOSITIONS)[number];

/** Exact source evidence an operator is reconciling. */
export type EffectReconciliationTarget = {
    /** Requested evidence identity, before resolving recorded copies. */
    readonly requested_record_id: RecordId;
    /** Original materialization, failed resolution or pending admission. */
    readonly effect_record_id: RecordId;
    /** Stable materialization-based compensation identity. */
    readonly compensation_id: string;
    /** Validated source execution kind. */
    readonly source_kind: (typeof EFFECT_RECONCILIATION_SOURCE_KINDS)[number];
    /** Exact source owner. */
    readonly source_owner_id: string;
    /** Validated source head bounding this inspection. */
    readonly source_head_record_id: RecordId;
    /** Retained intent identity, even when a pending admission has no full payload. */
    readonly intent_ref: string;
    /** Retained full intent, or null when only its digest exists. */
    readonly intent: EffectIntent | null;
    /** Actual retained outcome; no operator disposition fabricates one. */
    readonly outcome: EffectOutcome | null;
    /** Whether the source retains an actual successful materialization outcome; grants no retry authority. */
    readonly successful_materialization: boolean;
};

/** Complete immutable request bound to operator authorization and command identity. */
export type EffectReconciliationDecision = {
    /** Operator identity supplied by the trusted authority handle. */
    readonly actor_id: string;
    /** Host authorization-policy identity. */
    readonly policy_id: string;
    /** Exact source/compensation/audit basis accepted by the operator. */
    readonly basis_id: string;
    /** Globally idempotent resolution command. */
    readonly command_id: string;
    /** Explicit requested disposition. */
    readonly disposition: EffectReconciliationDisposition;
    /** Exact requested source evidence identity. */
    readonly effect_record_id: RecordId;
    /** Retained incident evidence cited by the decision. */
    readonly evidence_record_ids: readonly RecordId[];
    /** Bounded operator explanation. */
    readonly reason: string;
};

/** Trusted host policy receives a frozen decision and validated source evidence. */
export type EffectReconciliationAuthorizationRequest = {
    /** Exact command and actor-bound request. */
    readonly decision: EffectReconciliationDecision;
    /** Independently validated source evidence. */
    readonly target: EffectReconciliationTarget;
};

/** Opaque package-created authority; applications must keep it outside untrusted agent inputs. */
export type EffectReconciliationAuthority = {
    /** Authenticated actor identity assigned by the host. */
    readonly actorId: string;
    /** Stable host-policy identity retained in each audit. */
    readonly policyId: string;
};

/** Host-provided authorization and external-completion verification policy. */
export type EffectReconciliationAuthorityOptions = {
    /** Actor identity authenticated by the hosting application. */
    readonly actorId: string;
    /** Host-policy identity. */
    readonly policyId: string;
    /**
     * Authorizes this exact immutable request; false refuses without writes.
     * @param request - Exact actor/command/target/disposition/evidence request.
     * @returns Explicit authorization verdict, synchronously or asynchronously.
     * @throws Policy failures propagate without recording a decision.
     */
    readonly authorize: (
        request: EffectReconciliationAuthorizationRequest,
    ) => boolean | Promise<boolean>;
    /**
     * Independently verifies external completion before that disposition is retained.
     * @param request - Authorized request and source evidence.
     * @returns True only when host-verified external evidence establishes completion.
     * @throws Verification failures propagate without recording success or executing external work.
     */
    readonly verifyCompletion: (
        request: EffectReconciliationAuthorizationRequest,
    ) => boolean | Promise<boolean>;
};

/** Exact heads consumed atomically by one reconciliation decision. */
export type EffectReconciliationBasis = {
    /** Normalized original effect evidence. */
    readonly target_record_id: RecordId;
    /** Stable compensation identity. */
    readonly compensation_id: string;
    /** Source execution kind. */
    readonly source_kind: EffectReconciliationTarget["source_kind"];
    /** Source owner carrying the evidence. */
    readonly source_owner_id: string;
    /** Source head used for fencing. */
    readonly source_head_record_id: RecordId;
    /** Current compensation-path head, including guards; null before any path record. */
    readonly compensation_head_record_id: RecordId | null;
    /** Current audit head, or null before the first decision. */
    readonly previous_record_id: RecordId | null;
};

/** Immutable operator audit record, separate from any EffectOutcome. */
export type EffectReconciliationRecord = EffectReconciliationDecision &
    EffectReconciliationBasis & {
        /** Audit compatibility namespace. */
        readonly compatibility_version: string;
        /** Configured audit wire version. */
        readonly record_version: number;
        /** True only for an explicitly host-verified completion disposition. */
        readonly completion_verified: boolean;
    };

/** Retained operator audit and exact record identity. */
export type EffectReconciliationReceipt = EffectReconciliationRecord & {
    /** Exact canonical audit record. */
    readonly record_id: RecordId;
};

/** Read-only reconciliation evidence and the basis for a future operator command. */
export type EffectReconciliationInspection = {
    /** Current exact basis identity. */
    readonly basis_id: string;
    /** Current head fields consumed by a command. */
    readonly basis: EffectReconciliationBasis;
    /** Validated original source evidence. */
    readonly target: EffectReconciliationTarget;
    /** Actual compensation evidence, or null before compensation begins. */
    readonly compensation: EffectCompensationInspection | null;
    /** All retained operator decisions in causal order. */
    readonly decisions: readonly EffectReconciliationReceipt[];
};

/** Exact immutable command submitted with a trusted host authority. */
export type ReconcileEffectOptions = {
    /** Package-created host authorization capability. */
    readonly authority: EffectReconciliationAuthority;
    /** Basis returned by the latest reconciliation inspection. */
    readonly basisId: string;
    /** Globally meaningful resolution command identity. */
    readonly commandId: string;
    /** Explicit requested disposition. */
    readonly disposition: EffectReconciliationDisposition;
    /** Exact source evidence, including a recorded copy resolved to its origin. */
    readonly effectRecordId: RecordId;
    /** Retained incident evidence; nonempty and bounded. */
    readonly evidenceRecordIds: readonly RecordId[];
    /** Bounded actor explanation, retained verbatim under the store's secret policy. */
    readonly reason: string;
};

/** Closed exact source selector for reconciliation inspection. */
export type InspectEffectReconciliationOptions = {
    /** Exact retained effect step, admission or dispatch resolution. */
    readonly effectRecordId: RecordId;
};
