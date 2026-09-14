import type { SemanticValue } from "../canonical/canonical-record.ts";
import type { EffectHandlerStack } from "../effect/handler-types.ts";
import type { EffectIntent, EffectOutcome, EffectReversibility } from "../effect/types.ts";
import type {
    SUPERVISION_APPROVAL_GATES,
    SUPERVISION_APPROVAL_VERDICTS,
    SUPERVISION_DECISION_SOURCES,
    SUPERVISION_DECISIONS,
    SUPERVISION_DISPOSITIONS,
    SUPERVISION_RECOVERY_CLASSIFICATIONS,
    SUPERVISION_SUBSCRIPTION_OVERFLOW_POLICIES,
    SUPERVISION_SUBSCRIPTION_START_POSITIONS,
    SUPERVISION_TIMEOUT_POLICIES,
} from "../protocol/values.generated.ts";
import type { RecordBody, RecordId } from "../record/types.ts";
import type { OwnerRecord } from "../store/types.ts";

/** Configured subscription start position. */
export type TraceSubscriptionStartPosition =
    (typeof SUPERVISION_SUBSCRIPTION_START_POSITIONS)[number];

/** Configured subscription overflow policy. */
export type TraceSubscriptionOverflowPolicy =
    (typeof SUPERVISION_SUBSCRIPTION_OVERFLOW_POLICIES)[number];

/** Configured interception decision. */
export type SupervisionDecision = (typeof SUPERVISION_DECISIONS)[number];

/** Configured source of a retained decision. */
export type SupervisionDecisionSource = (typeof SUPERVISION_DECISION_SOURCES)[number];

/** Configured timeout and failure policy. */
export type SupervisionTimeoutPolicy = (typeof SUPERVISION_TIMEOUT_POLICIES)[number];

/** Configured approval gate. */
export type SupervisionApprovalGate = (typeof SUPERVISION_APPROVAL_GATES)[number];

/** Configured approval verdict. */
export type SupervisionApprovalVerdict = (typeof SUPERVISION_APPROVAL_VERDICTS)[number];

/** Configured terminal dispatch disposition. */
export type SupervisionDisposition = (typeof SUPERVISION_DISPOSITIONS)[number];

/** Configured restart classification of a supervised dispatch. */
export type SupervisionRecoveryClassification =
    (typeof SUPERVISION_RECOVERY_CLASSIFICATIONS)[number];

/** Next unread ordinal of one owner path selected by a subscription. */
export type TraceSubscriptionPosition = {
    /** Next owner ordinal that has not been delivered or acknowledged. */
    readonly next_ordinal: number;
    /** Exact owner path. */
    readonly owner_id: string;
};

/**
 * Canonical subscription cursor.
 *
 * Identity covers only the ordered owner positions, never delivery order or time.
 */
export type TraceSubscriptionCursor = {
    /** Supervision compatibility namespace. */
    readonly compatibility_version: string;
    /** Content-addressed cursor identity. */
    readonly cursor_id: string;
    /** Canonical cursor version. */
    readonly cursor_version: number;
    /** Positions in canonical owner-identity order. */
    readonly positions: readonly TraceSubscriptionPosition[];
};

/** One record delivered by a subscription. */
export type TraceSubscriptionDelivery = {
    /** Cursor that acknowledges this delivery and every earlier delivery. */
    readonly cursor: TraceSubscriptionCursor;
    /** Committed owner occurrence. */
    readonly record: OwnerRecord;
};

/** Declared overflow behavior for a subscription. */
export type TraceSubscriptionOverflow = {
    /** Lag bound checked before each refill. */
    readonly maxLagRecords: number;
    /** Keep backpressure and report lag, or fail when lag exceeds the bound. */
    readonly policy: TraceSubscriptionOverflowPolicy;
};

/** Options accepted by {@link openTraceSubscription}. */
export type OpenTraceSubscriptionOptions = {
    /** Maximum buffered undelivered records. Defaults to the configured capacity. */
    readonly bufferCapacity?: number;
    /** Overflow policy. Defaults to backpressure without a failure bound. */
    readonly overflow?: TraceSubscriptionOverflow;
    /** Exact distinct owner paths to observe. */
    readonly owners: readonly string[];
    /** Delay between store reads while nothing new is retained. */
    readonly pollIntervalMilliseconds?: number;
    /** Ends iteration when aborted. */
    readonly signal?: AbortSignal;
    /**
     * Start position for a new or ephemeral subscription. An existing durable subscription
     * resumes from its acknowledged cursor, and any supplied start must equal that cursor.
     */
    readonly start?: TraceSubscriptionCursor | TraceSubscriptionStartPosition;
    /** Durable identity. Omit for an ephemeral subscription that retains nothing. */
    readonly subscriptionId?: string;
};

/** Non-semantic delivery metrics. */
export type TraceSubscriptionMetrics = {
    /** Records currently buffered and not yet delivered. */
    readonly buffered_records: number;
    /** Records delivered by this subscription object. */
    readonly delivered_records: number;
    /** Largest lag observed by this subscription object. */
    readonly high_water_lag_records: number;
    /** Retained records not yet delivered at the last refill. */
    readonly lag_records: number;
};

/** Live cursor subscription over committed owner-path records. */
export type TraceSubscription = AsyncIterable<TraceSubscriptionDelivery> & {
    /** Durable acknowledged cursor, or the ephemeral acknowledged cursor. */
    readonly acknowledgedCursor: TraceSubscriptionCursor;
    /** Cursor after the last delivered record. */
    readonly deliveredCursor: TraceSubscriptionCursor;
    /** Durable identity, or null when ephemeral. */
    readonly subscriptionId: string | null;
    /**
     * Acknowledges every delivery up to and including the supplied cursor.
     *
     * @param cursor - Cursor of a delivery made by this subscription.
     * @returns The acknowledged cursor.
     * @throws {SupervisionCursorConflictError} If the cursor regresses, names other owners, or
     * passes delivered records.
     * @throws {TraceStoreError} If the store is closed.
     */
    readonly acknowledge: (cursor: TraceSubscriptionCursor) => TraceSubscriptionCursor;
    /** Ends iteration and releases buffered records without changing the acknowledged cursor. */
    readonly close: () => void;
    /** Returns current non-semantic delivery metrics. */
    readonly metrics: () => TraceSubscriptionMetrics;
    /**
     * Waits for the next committed record.
     *
     * @returns The next delivery, or undefined after close or abort.
     * @throws {SupervisionSubscriptionOverflowError} If lag exceeds a `fail` overflow bound.
     * @throws {TraceStoreError} If the store is closed.
     */
    readonly next: () => Promise<TraceSubscriptionDelivery | undefined>;
};

/** Canonical interceptor declaration retained in dispatch identity. */
export type SupervisionInterceptorDeclaration = {
    /** Stable interceptor identity. */
    readonly interceptor_id: string;
    /** Ordering key; lower runs first, ties are ordered by identity. */
    readonly priority: number;
    /** Bounded wait for this interceptor's decision. */
    readonly timeout_milliseconds: number;
    /** Policy applied on timeout or failure. */
    readonly timeout_policy: SupervisionTimeoutPolicy;
};

/** Frozen request presented to one interceptor. */
export type SupervisionInterceptionRequest = {
    /** Records cited by the dispatch. */
    readonly cited_record_ids: readonly RecordId[];
    /** Decisions retained before this interceptor. */
    readonly decisions: readonly SupervisionDecisionInspection[];
    /** Dispatch identity. */
    readonly dispatch_id: string;
    /** Effective intent after earlier replacements. */
    readonly intent: EffectIntent;
    /** Interceptor receiving the request. */
    readonly interceptor_id: string;
    /** Intent originally supplied by the worker. */
    readonly original_intent: EffectIntent;
    /** Zero-based position in canonical interceptor order. */
    readonly position: number;
    /** Aborted when the interceptor times out or the dispatcher stops. */
    readonly signal: AbortSignal;
};

/** Decision returned by an interceptor. */
export type SupervisionInterceptorResult =
    | {
          /** Allows the effective intent to continue. */
          readonly decision: "allow";
      }
    | {
          /** Denies the effect before admission. */
          readonly decision: "deny";
          /** Retained reason. */
          readonly reason: string;
      }
    | {
          /** Pauses at the effect boundary until an approval verdict. */
          readonly decision: "pause";
          /** Retained reason. */
          readonly reason: string;
      }
    | {
          /** Replaces the effective intent payload. */
          readonly decision: "replace";
          /** Canonical replacement payload. */
          readonly payload: SemanticValue;
          /** Retained reason. */
          readonly reason: string;
          /** Equal or stronger reversibility tier. Defaults to the current tier. */
          readonly reversibility?: EffectReversibility;
      };

/** One ordered interceptor supplied to a dispatch. */
export type SupervisionInterceptor = {
    /**
     * Returns one decision for the effective intent.
     *
     * A thrown error, rejected promise, or malformed result applies the timeout policy.
     */
    readonly decide: (
        request: SupervisionInterceptionRequest,
    ) => Promise<SupervisionInterceptorResult> | SupervisionInterceptorResult;
    /** Stable interceptor identity. */
    readonly interceptorId: string;
    /** Ordering key; lower runs first, ties are ordered by identity. */
    readonly priority: number;
    /** Bounded wait for this interceptor. */
    readonly timeoutMilliseconds: number;
    /** Policy applied on timeout or failure. */
    readonly timeoutPolicy: SupervisionTimeoutPolicy;
};

/** Options accepted by {@link dispatchSupervisedEffect}. */
export type DispatchSupervisedEffectOptions = {
    /** Bounded wait for each approval verdict. Defaults to the configured wait. */
    readonly approvalTimeoutMilliseconds?: number;
    /** Retained records cited as causal parents of the dispatch record. */
    readonly citedRecordIds?: readonly RecordId[];
    /** Dispatcher lease identity. */
    readonly claimId: string;
    /** Lease clock in Unix milliseconds. Defaults to `Date.now`. */
    readonly clock?: () => number;
    /** Globally idempotent dispatch command identity. */
    readonly commandId: string;
    /** Handler stack that materializes the admitted intent. */
    readonly handlers: EffectHandlerStack;
    /** Canonical effect intent to supervise. */
    readonly intent: EffectIntent;
    /** Ordered interceptors. */
    readonly interceptors?: readonly SupervisionInterceptor[];
    /** Cancels the dispatch before admission. */
    readonly signal?: AbortSignal;
};

/** Retained interception decision. */
export type SupervisionDecisionInspection = {
    /** Applied timeout policy, or null when the interceptor decided. */
    readonly applied_policy: SupervisionTimeoutPolicy | null;
    /** Retained decision. */
    readonly decision: SupervisionDecision;
    /** Effective intent reference the decision applied to. */
    readonly intent_ref: string;
    /** Deciding interceptor. */
    readonly interceptor_id: string;
    /** Owner ordinal of the decision record. */
    readonly owner_ordinal: number;
    /** Canonical interceptor position. */
    readonly position: number;
    /** Retained reason, or null. */
    readonly reason: string | null;
    /** Decision record identity. */
    readonly record_id: RecordId;
    /** Replacement intent for `replace`, otherwise null. */
    readonly replacement: EffectIntent | null;
    /** Whether the interceptor, a timeout, or a failure produced the decision. */
    readonly source: SupervisionDecisionSource;
};

/** Retained approval verdict. */
export type SupervisionApprovalVerdictInspection = {
    /** Approver identity, or null for expiry. */
    readonly approver_id: string | null;
    /** Approver command identity, or null for expiry. */
    readonly command_id: string | null;
    /** Owner ordinal of the verdict record. */
    readonly owner_ordinal: number;
    /** Retained reason, or null. */
    readonly reason: string | null;
    /** Verdict record identity. */
    readonly record_id: RecordId;
    /** Retained verdict. */
    readonly verdict: SupervisionApprovalVerdict;
};

/** Retained approval request and its verdict. */
export type SupervisionApprovalInspection = {
    /** Gate that requested approval. */
    readonly gate: SupervisionApprovalGate;
    /** Effective intent reference awaiting approval. */
    readonly intent_ref: string;
    /** Owner ordinal of the request record. */
    readonly owner_ordinal: number;
    /** Pausing interceptor position, or null for the frontier. */
    readonly position: number | null;
    /** Retained request reason, or null. */
    readonly reason: string | null;
    /** Request record identity. */
    readonly request_record_id: RecordId;
    /** Verdict, or null while pending. */
    readonly verdict: SupervisionApprovalVerdictInspection | null;
};

/** Retained terminal resolution. */
export type SupervisionResolutionInspection = {
    /** Terminal disposition. */
    readonly disposition: SupervisionDisposition;
    /** Selected handler for materialized effects, otherwise null. */
    readonly handler_id: string | null;
    /** Correlated outcome for materialized effects, otherwise null. */
    readonly outcome: EffectOutcome | null;
    /** Owner ordinal of the resolution record. */
    readonly owner_ordinal: number;
    /** Resolution record identity. */
    readonly record_id: RecordId;
};

/** Live decision lease evidence of a dispatch registered in this store. */
export type SupervisionLeaseInspection = {
    /** Current holder. */
    readonly claim_id: string;
    /** Monotonic fencing token. */
    readonly fencing_token: number;
    /** Lease expiry in Unix milliseconds. */
    readonly lease_expires_at: number;
    /** Whether the lease was released at resolution. */
    readonly released: boolean;
};

/** Validated read-only view of one supervised dispatch. */
export type SupervisedDispatchInspection = {
    /** Admission record identity, or null. */
    readonly admission_record_id: RecordId | null;
    /** Declared approval wait. */
    readonly approval_timeout_milliseconds: number;
    /** Approval requests in retained order. */
    readonly approvals: readonly SupervisionApprovalInspection[];
    /** Records cited by the dispatch. */
    readonly cited_record_ids: readonly RecordId[];
    /** Dispatch command identity. */
    readonly command_id: string;
    /** Decisions in canonical position order. */
    readonly decisions: readonly SupervisionDecisionInspection[];
    /** Dispatch identity and owner path. */
    readonly dispatch_id: string;
    /** Dispatch record identity. */
    readonly dispatch_record_id: RecordId;
    /** Effective intent after retained replacements. */
    readonly effective_intent: EffectIntent;
    /** Current owner-path head. */
    readonly head: { readonly owner_ordinal: number; readonly record_id: RecordId };
    /** Intent supplied by the worker. */
    readonly intent: EffectIntent;
    /** Interceptor declarations in canonical order. */
    readonly interceptors: readonly SupervisionInterceptorDeclaration[];
    /** Live lease evidence, or null for imported evidence. */
    readonly lease: SupervisionLeaseInspection | null;
    /** Pending approval request, or null. */
    readonly pending_approval: SupervisionApprovalInspection | null;
    /** Restart classification. */
    readonly recovery: SupervisionRecoveryClassification;
    /** Terminal resolution, or null. */
    readonly resolution: SupervisionResolutionInspection | null;
};

/** Options accepted by {@link inspectSupervisedDispatch}. */
export type InspectSupervisedDispatchOptions = {
    /** Exact dispatch identity. */
    readonly dispatchId: string;
};

/** Options accepted by {@link resolveSupervisedApproval}. */
export type ResolveSupervisedApprovalOptions = {
    /** Caller-supplied approver identity. */
    readonly approverId: string;
    /** Globally idempotent verdict command identity. */
    readonly commandId: string;
    /** Exact dispatch identity. */
    readonly dispatchId: string;
    /** Optional retained reason. */
    readonly reason?: string;
    /** Exact pending request record. */
    readonly requestRecordId: RecordId;
    /** Approve or reject. */
    readonly verdict: "approved" | "rejected";
};

/** Receipt returned by {@link resolveSupervisedApproval}. */
export type SupervisedApprovalReceipt = {
    /** Verdict command identity. */
    readonly command_id: string;
    /** Dispatch identity. */
    readonly dispatch_id: string;
    /** Owner ordinal of the verdict record. */
    readonly owner_ordinal: number;
    /** Verdict record identity. */
    readonly record_id: RecordId;
    /** Approved request record. */
    readonly request_record_id: RecordId;
    /** Retained verdict. */
    readonly verdict: "approved" | "rejected";
};

/** Options accepted by {@link injectSupervisionContext}. */
export type InjectSupervisionContextOptions = {
    /** Caller-selected channel name. */
    readonly channel: string;
    /** At least one retained record cited as causal parents. */
    readonly citedRecordIds: readonly RecordId[];
    /** Globally idempotent injection command identity. */
    readonly commandId: string;
    /** Canonical application data. */
    readonly data: RecordBody;
    /** Caller-supplied supervisor identity. */
    readonly supervisorId: string;
};

/** One retained context injection. */
export type SupervisionContextInjection = {
    /** Context channel identity and owner path. */
    readonly channel_id: string;
    /** Cited retained records. */
    readonly cited_record_ids: readonly RecordId[];
    /** Injection command identity. */
    readonly command_id: string;
    /** Canonical application data. */
    readonly data: RecordBody;
    /** Owner ordinal of the injection record. */
    readonly owner_ordinal: number;
    /** Injection record identity. */
    readonly record_id: RecordId;
    /** Supervisor identity. */
    readonly supervisor_id: string;
};

/** Options accepted by {@link readSupervisionContext}. */
export type ReadSupervisionContextOptions = {
    /** Returns injections after this owner ordinal. Defaults to all injections. */
    readonly afterOwnerOrdinal?: number;
    /** Caller-selected channel name. */
    readonly channel: string;
};
